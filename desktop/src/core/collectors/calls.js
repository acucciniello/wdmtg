// Phone calls: who and how long. iPhone apps cannot read the call log, but the
// Mac keeps a copy of it (synced through iCloud) in
//   ~/Library/Application Support/CallHistoryDB/CallHistory.storedata
// Reading it needs Full Disk Access. On the Mac the phone number column is
// encrypted with a key that lives in your login keychain ("Call History User
// Data Key"); macOS asks you before handing it over.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { withCopy, columns, tables, appleToMs } from './sqlcopy.js';

const home = os.homedir();
export const CALL_DB = path.join(home, 'Library/Application Support/CallHistoryDB/CallHistory.storedata');
const ADDRESS_BOOK = path.join(home, 'Library/Application Support/AddressBook');

const PROVIDERS = {
  'com.apple.Telephony': 'Phone',
  'com.apple.FaceTime': 'FaceTime',
  'net.whatsapp.WhatsApp': 'WhatsApp',
};

/** Ask the keychain for the call history key (macOS shows a permission prompt). */
export function fetchCallKey() {
  return new Promise((resolve) => {
    execFile('/usr/bin/security', ['find-generic-password', '-s', 'Call History User Data Key', '-w'], { timeout: 120_000 }, (err, stdout) => {
      const text = (stdout || '').trim();
      if (err || !text) return resolve(null);
      const key = Buffer.from(text, 'base64');
      resolve([16, 24, 32].includes(key.length) ? key : null);
    });
  });
}

/** Encrypted address layout: 16-byte tag, 16-byte IV, ciphertext (AES-GCM). */
export function decryptAddress(blob, key) {
  if (!key || !blob || blob.length <= 32) return null;
  try {
    const d = crypto.createDecipheriv(`aes-${key.length * 8}-gcm`, key, blob.subarray(16, 32));
    d.setAuthTag(blob.subarray(0, 16));
    return Buffer.concat([d.update(blob.subarray(32)), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** Test helper: the inverse of decryptAddress. */
export function encryptAddress(text, key) {
  const iv = crypto.randomBytes(16);
  const c = crypto.createCipheriv(`aes-${key.length * 8}-gcm`, key, iv);
  const body = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return Buffer.concat([c.getAuthTag(), iv, body]);
}

const digits = (s) => String(s || '').replace(/\D/g, '');
const last10 = (s) => digits(s).slice(-10);

function addressText(value, key) {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  const buf = Buffer.from(value);
  const plain = decryptAddress(buf, key);
  if (plain) return plain;
  // Older systems store the number as plain bytes.
  const text = buf.toString('utf8');
  return /^[\x20-\x7e]+$/.test(text) ? text : null;
}

/** Phone number / email -> contact name, from the Mac's Contacts database. */
export function loadContacts(root = ADDRESS_BOOK) {
  const byPhone = new Map();
  const byEmail = new Map();
  const files = [];
  try {
    const top = path.join(root, 'AddressBook-v22.abcddb');
    if (fs.existsSync(top)) files.push(top);
    const sources = path.join(root, 'Sources');
    for (const dir of fs.readdirSync(sources)) {
      const f = path.join(sources, dir, 'AddressBook-v22.abcddb');
      if (fs.existsSync(f)) files.push(f);
    }
  } catch {
    // no contacts available
  }
  for (const file of files) {
    try {
      withCopy(file, (db) => {
        const name = "TRIM(COALESCE(r.ZFIRSTNAME, '') || ' ' || COALESCE(r.ZLASTNAME, ''))";
        const who = `CASE WHEN ${name} = '' THEN r.ZORGANIZATION ELSE ${name} END`;
        for (const row of db.prepare(`SELECT p.ZFULLNUMBER AS v, ${who} AS name FROM ZABCDPHONENUMBER p JOIN ZABCDRECORD r ON r.Z_PK = p.ZOWNER`).all()) {
          if (row.name && last10(row.v).length >= 7) byPhone.set(last10(row.v), row.name);
        }
        for (const row of db.prepare(`SELECT e.ZADDRESS AS v, ${who} AS name FROM ZABCDEMAILADDRESS e JOIN ZABCDRECORD r ON r.Z_PK = e.ZOWNER`).all()) {
          if (row.name && row.v) byEmail.set(String(row.v).toLowerCase(), row.name);
        }
      });
    } catch {
      // skip unreadable source
    }
  }
  return {
    size: byPhone.size + byEmail.size,
    lookup(address) {
      if (!address) return null;
      if (address.includes('@')) return byEmail.get(address.toLowerCase()) || null;
      return byPhone.get(last10(address)) || null;
    },
  };
}

export function formatNumber(address) {
  if (!address || address.includes('@')) return address;
  const d = digits(address);
  const ten = d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
  return ten.length === 10 ? `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}` : address;
}

/**
 * Import answered calls into the store.
 * @returns {{ok:boolean, reason?:string, imported:number, named:number, unnamed:number}}
 */
export function importCalls(store, { file = CALL_DB, key = null, contacts = null } = {}) {
  let rows;
  try {
    rows = withCopy(file, (db) => {
      if (!tables(db).includes('ZCALLRECORD')) throw new Error('unexpected call history layout');
      const cols = new Set(columns(db, 'ZCALLRECORD'));
      const pick = (c) => (cols.has(c) ? `c.${c}` : 'NULL');
      return db.prepare(
        `SELECT c.Z_PK AS pk, c.ZDATE AS date, c.ZDURATION AS duration, ${pick('ZADDRESS')} AS address,
                ${pick('ZNAME')} AS name, ${pick('ZSERVICE_PROVIDER')} AS provider, ${pick('ZUNIQUE_ID')} AS uid,
                ${pick('ZORIGINATED')} AS originated
         FROM ZCALLRECORD c WHERE c.ZDURATION > 0 AND c.ZDATE IS NOT NULL`
      ).all();
    });
  } catch (err) {
    const reason = err.code === 'ENOENT' ? 'not-found' : err.code === 'EPERM' || err.code === 'EACCES' ? 'no-access' : 'error';
    return { ok: false, reason, imported: 0, named: 0, unnamed: 0, detail: String(err.message || err) };
  }
  const segs = [];
  let named = 0;
  for (const r of rows) {
    const address = addressText(r.address, key);
    const who = r.name || contacts?.lookup(address) || formatNumber(address);
    if (who) named++;
    const start = appleToMs(r.date);
    segs.push({
      source: 'call',
      device: 'Phone',
      start,
      end: start + Math.round(r.duration * 1000),
      app: PROVIDERS[r.provider] || 'Call',
      bundle: r.provider || null,
      title: who || 'Unknown caller',
      extId: `call:${r.uid || r.pk}`,
    });
  }
  return { ok: true, imported: store.upsertMany(segs), named, unnamed: segs.length - named };
}
