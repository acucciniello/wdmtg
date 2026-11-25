// Writers for synthetic SEGB files and AppInFocus records (tests only).
import zlib from 'node:zlib';

function varint(n) {
  const out = [];
  while (n >= 0x80) {
    out.push((n % 128) | 0x80);
    n = Math.floor(n / 128);
  }
  out.push(n);
  return Buffer.from(out);
}

/** AppInFocus protobuf: field 3 gained, field 4 time (double), field 6 bundle id. */
export function focusRecord(time, bundle, gained) {
  const t = Buffer.alloc(8);
  t.writeDoubleLE(time);
  const b = Buffer.from(bundle, 'utf8');
  return Buffer.concat([
    Buffer.from([0x0a]), varint(4), Buffer.from('abcd'), // field 1: another string, must be skipped
    Buffer.from([0x18]), varint(gained ? 1 : 0),
    Buffer.from([0x21]), t,
    Buffer.from([0x32]), varint(b.length), b,
  ]);
}

/** records: [{data:Buffer, state?:number}] */
export function writeSegbV2(records) {
  const header = Buffer.alloc(32);
  header.write('SEGB', 0, 'latin1');
  header.writeInt32LE(records.length, 4);
  header.writeDoubleLE(700000000, 8);
  const body = [];
  const trailer = [];
  let pos = 0; // relative to the end of the header
  for (const { data, state = 1 } of records) {
    const head = Buffer.alloc(8);
    head.writeUInt32LE(zlib.crc32(data), 0);
    body.push(head, data);
    pos += 8 + data.length;
    const row = Buffer.alloc(16);
    row.writeInt32LE(pos, 0);
    row.writeInt32LE(state, 4);
    row.writeDoubleLE(700000000, 8);
    trailer.push(row);
    if (pos % 4) {
      const pad = 4 - (pos % 4);
      body.push(Buffer.alloc(pad));
      pos += pad;
    }
  }
  return Buffer.concat([header, ...body, ...trailer]);
}

export function writeSegbV1(records) {
  const parts = [];
  let pos = 56;
  for (const { data, state = 1 } of records) {
    const head = Buffer.alloc(32);
    head.writeInt32LE(data.length, 0);
    head.writeInt32LE(state, 4);
    head.writeDoubleLE(700000000, 8);
    head.writeDoubleLE(700000000, 16);
    head.writeUInt32LE(zlib.crc32(data), 24);
    parts.push(head, data);
    pos += 32 + data.length;
    if (pos % 8) {
      const pad = 8 - (pos % 8);
      parts.push(Buffer.alloc(pad));
      pos += pad;
    }
  }
  const header = Buffer.alloc(56);
  header.writeUInt32LE(pos, 0);
  header.write('SEGB', 52, 'latin1');
  return Buffer.concat([header, ...parts]);
}
