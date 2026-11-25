// Reader for Apple's SEGB container (the file format behind Biome streams such
// as App.InFocus). Layout follows CCL Forensics' ccl-segb reader (MIT), as used
// by nichtlegacy/screentime (MIT). Two versions exist in the wild.
import zlib from 'node:zlib';

const MAGIC = Buffer.from('SEGB');
export const WRITTEN = 1; // other states: 3 = deleted, 4 = empty

/** @returns {{state:number, data:Buffer, crcOk:boolean}[]} */
export function readSegb(buf) {
  if (buf.length >= 56 && buf.subarray(52, 56).equals(MAGIC)) return readV1(buf);
  if (buf.length >= 32 && buf.subarray(0, 4).equals(MAGIC)) return readV2(buf);
  throw new Error('Not a SEGB file');
}

// v1: 56-byte header (end-of-data offset first, magic last), then records with a
// 32-byte header: length i32, state i32, two f64 timestamps, crc u32, unknown i32.
// Records are padded to 8 bytes.
function readV1(buf) {
  const out = [];
  const endOfData = Math.min(buf.readUInt32LE(0), buf.length);
  let pos = 56;
  while (pos + 32 <= endOfData) {
    const length = buf.readInt32LE(pos);
    const state = buf.readInt32LE(pos + 4);
    const crc = buf.readUInt32LE(pos + 24);
    pos += 32;
    if (length < 0 || pos + length > buf.length) break;
    const data = buf.subarray(pos, pos + length);
    out.push({ state, data, crcOk: zlib.crc32(data) === crc });
    pos += length;
    if (pos % 8) pos += 8 - (pos % 8);
  }
  return out;
}

// v2: 32-byte header (magic, entry count, creation time), entries from offset 32,
// and a trailer at the end of the file with one 16-byte row per entry:
// end offset i32 (relative to the end of the header), state i32, f64 timestamp.
// Each entry starts with crc u32 + unknown i32 and is padded to 4 bytes.
function readV2(buf) {
  const HEADER = 32;
  const count = buf.readInt32LE(4);
  const trailerStart = buf.length - 16 * count;
  if (count < 0 || trailerStart < HEADER) throw new Error('Corrupt SEGB trailer');
  const trailer = [];
  for (let i = 0; i < count; i++) {
    const o = trailerStart + i * 16;
    trailer.push({ end: buf.readInt32LE(o), state: buf.readInt32LE(o + 4) });
  }
  trailer.sort((a, b) => a.end - b.end);

  const out = [];
  let pos = HEADER;
  let prevEnd = null;
  for (const t of trailer) {
    if (t.state === 4) continue;
    if (prevEnd !== null && t.end === prevEnd) continue; // duplicate trailer row for the same entry
    const length = t.end - pos + HEADER;
    if (length < 8) continue;
    if (pos + length > trailerStart) break;
    const crc = buf.readUInt32LE(pos);
    const data = buf.subarray(pos + 8, pos + length);
    out.push({ state: t.state, data, crcOk: zlib.crc32(data) === crc });
    pos += length;
    if (t.end % 4) pos += 4 - (t.end % 4);
    prevEnd = t.end;
  }
  return out;
}
