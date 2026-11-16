import { crc32, inflateRawSync } from "node:zlib";

/** Reads every entry of a ZIP32 archive (stored or deflated) into memory. */
export function readZip(archive: Buffer): Map<string, Buffer> {
  const end = findEndOfCentralDirectory(archive);
  const count = archive.readUInt16LE(end + 10);
  let offset = archive.readUInt32LE(end + 16);
  const entries = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    if (archive.readUInt32LE(offset) !== 0x02014b50) throw new Error("ZIP central directory is damaged.");
    const method = archive.readUInt16LE(offset + 10);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const size = archive.readUInt32LE(offset + 24);
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const localOffset = archive.readUInt32LE(offset + 42);
    const name = archive.toString("utf8", offset + 46, offset + 46 + nameLength);
    if (archive.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`ZIP entry ${name} is damaged.`);
    const localName = archive.readUInt16LE(localOffset + 26);
    const localExtra = archive.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localName + localExtra;
    const raw = archive.subarray(start, start + compressedSize);
    let data: Buffer;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = inflateRawSync(raw);
    else throw new Error(`ZIP entry ${name} uses unsupported compression method ${method}.`);
    if (data.length !== size) throw new Error(`ZIP entry ${name} has ${data.length} bytes; expected ${size}.`);
    if (crc32(data) !== archive.readUInt32LE(offset + 16)) throw new Error(`ZIP entry ${name} fails its CRC check.`);
    if (entries.has(name)) throw new Error(`ZIP contains ${name} twice.`);
    entries.set(name, data);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function findEndOfCentralDirectory(archive: Buffer): number {
  const earliest = Math.max(0, archive.length - 22 - 65535);
  for (let i = archive.length - 22; i >= earliest; i--) {
    if (archive.readUInt32LE(i) === 0x06054b50) return i;
  }
  throw new Error("Not a ZIP archive: no end-of-central-directory record.");
}
