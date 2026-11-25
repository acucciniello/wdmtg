import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../src/core/store.js';
import { importCalls, loadContacts, decryptAddress, encryptAddress, formatNumber } from '../src/core/collectors/calls.js';
import { importMacHistory } from '../src/core/collectors/knowledgec.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wdmtg-calls-'));
const key = crypto.randomBytes(16);
const APPLE = 978307200;

function callDb() {
  const file = path.join(fs.mkdtempSync(path.join(tmp, 'c-')), 'CallHistory.storedata');
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE ZCALLRECORD (Z_PK INTEGER PRIMARY KEY, ZDATE REAL, ZDURATION REAL, ZADDRESS BLOB, ZNAME TEXT, ZSERVICE_PROVIDER TEXT, ZUNIQUE_ID TEXT, ZORIGINATED INTEGER)');
  const ins = db.prepare('INSERT INTO ZCALLRECORD (ZDATE, ZDURATION, ZADDRESS, ZNAME, ZSERVICE_PROVIDER, ZUNIQUE_ID, ZORIGINATED) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const day = Date.UTC(2026, 2, 10, 15, 0, 0) / 1000 - APPLE;
  ins.run(day, 1325.4, encryptAddress('+16145550142', key), null, 'com.apple.Telephony', 'A', 1);
  ins.run(day + 3600, 300, encryptAddress('+16145550199', key), null, 'com.apple.Telephony', 'B', 0);
  ins.run(day + 7200, 0, encryptAddress('+16145550000', key), null, 'com.apple.Telephony', 'C', 0); // missed
  ins.run(day + 9000, 620, encryptAddress('mom@example.com', key), null, 'com.apple.FaceTime', 'D', 1);
  db.close();
  return file;
}

function contactsDb() {
  const root = path.join(tmp, 'AddressBook');
  const dir = path.join(root, 'Sources', 'X');
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, 'AddressBook-v22.abcddb'));
  db.exec(`CREATE TABLE ZABCDRECORD (Z_PK INTEGER PRIMARY KEY, ZFIRSTNAME TEXT, ZLASTNAME TEXT, ZORGANIZATION TEXT);
           CREATE TABLE ZABCDPHONENUMBER (Z_PK INTEGER PRIMARY KEY, ZOWNER INTEGER, ZFULLNUMBER TEXT);
           CREATE TABLE ZABCDEMAILADDRESS (Z_PK INTEGER PRIMARY KEY, ZOWNER INTEGER, ZADDRESS TEXT);
           INSERT INTO ZABCDRECORD VALUES (1, 'Mike', 'Russo', NULL), (2, NULL, NULL, 'Title Co'), (3, 'Mom', NULL, NULL);
           INSERT INTO ZABCDPHONENUMBER VALUES (1, 1, '(614) 555-0142');
           INSERT INTO ZABCDEMAILADDRESS VALUES (1, 3, 'Mom@Example.com');`);
  db.close();
  return root;
}

test('address encryption round trip, and a wrong key fails cleanly', () => {
  const blob = encryptAddress('+16145550142', key);
  assert.equal(decryptAddress(blob, key), '+16145550142');
  assert.equal(decryptAddress(blob, crypto.randomBytes(16)), null);
  assert.equal(decryptAddress(blob, null), null);
});

test('importCalls: names from contacts, numbers when unknown, missed calls skipped', () => {
  const store = new Store();
  const res = importCalls(store, { file: callDb(), key, contacts: loadContacts(contactsDb()) });
  assert.equal(res.ok, true);
  const calls = store.range(0, Number.MAX_SAFE_INTEGER);
  assert.deepEqual(calls.map((c) => [c.title, c.app, Math.round((c.end - c.start) / 1000)]), [
    ['Mike Russo', 'Phone', 1325],
    ['(614) 555-0199', 'Phone', 300],
    ['Mom', 'FaceTime', 620],
  ]);
  assert.equal(new Date(calls[0].start).toISOString(), '2026-03-10T15:00:00.000Z');
  importCalls(store, { file: callDb(), key });
  assert.equal(store.count('call'), 3, 'repeat imports do not duplicate');
});

test('importCalls: without the key you still get durations', () => {
  const store = new Store();
  const res = importCalls(store, { file: callDb(), key: null });
  assert.equal(res.unnamed, 3);
  assert.equal(store.range(0, Number.MAX_SAFE_INTEGER)[0].title, 'Unknown caller');
});

test('importCalls: missing file is reported, not thrown', () => {
  assert.equal(importCalls(new Store(), { file: path.join(tmp, 'nope') }).reason, 'not-found');
});

test('formatNumber', () => {
  assert.equal(formatNumber('+16145550142'), '(614) 555-0142');
  assert.equal(formatNumber('a@b.com'), 'a@b.com');
});

test('importMacHistory: only this Mac, only before install', () => {
  const file = path.join(tmp, 'knowledgeC.db');
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE ZOBJECT (Z_PK INTEGER PRIMARY KEY, ZSTREAMNAME TEXT, ZVALUESTRING TEXT, ZSTARTDATE REAL, ZENDDATE REAL, ZSOURCE INTEGER);
           CREATE TABLE ZSOURCE (Z_PK INTEGER PRIMARY KEY, ZDEVICEID TEXT);
           INSERT INTO ZSOURCE VALUES (1, 'IPHONE-ID');
           INSERT INTO ZOBJECT VALUES (1, '/app/usage', 'com.apple.Safari', 800000000, 800000600, NULL),
                                      (2, '/app/usage', 'com.burbn.instagram', 800000000, 800000600, 1),
                                      (3, '/app/intents', 'com.apple.Safari', 800000000, 800000600, NULL),
                                      (4, '/app/usage', 'com.apple.mail', 800001000, 800009000, NULL);`);
  db.close();
  const store = new Store();
  const before = (800001000 + 100 + APPLE) * 1000;
  const res = importMacHistory(store, { file, before });
  assert.equal(res.ok, true);
  const segs = store.range(0, Number.MAX_SAFE_INTEGER);
  assert.deepEqual(segs.map((s) => [s.bundle, (s.end - s.start) / 1000]), [['com.apple.Safari', 600], ['com.apple.mail', 100]]);
});
