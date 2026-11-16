import zlib from "node:zlib";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

export const ARCHIVE_LIMITS = {
  maxEntries: 200,
  maxEntryUncompressedBytes: 8 * 1024 * 1024,
  maxTotalUncompressedBytes: 64 * 1024 * 1024,
  maxPathDepth: 8,
  maxCompressionRatio: 200,
  ratioCheckThreshold: 2 * 1024 * 1024,
};

export type ArchiveEntryKind =
  | "json"
  | "image"
  | "nested-archive"
  | "executable"
  | "other";

export interface WorkflowArchiveEntry {
  path: string;
  fileName: string;
  kind: ArchiveEntryKind;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  crc32: number;
  localHeaderOffset: number;
  isDirectory: boolean;
}

export interface WorkflowArchiveInspection {
  entries: WorkflowArchiveEntry[];
  jsonEntries: WorkflowArchiveEntry[];
  warnings: string[];
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

export function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function assertSafeArchivePath(raw: string): string {
  const name = raw.replace(/\\/g, "/");
  if (!name.trim()) {
    throw new Error("Archive contains an entry with an empty path.");
  }
  if (name.includes("\u0000")) {
    throw new Error("Archive contains a path with a null byte.");
  }
  if (name.startsWith("/") || name.startsWith("//") || /^[A-Za-z]:/.test(name)) {
    throw new Error(`Archive contains an absolute path: '${raw}'.`);
  }
  const parts = name.split("/").filter((part) => part.length > 0);
  if (parts.length === 0) {
    throw new Error(`Archive contains an invalid path: '${raw}'.`);
  }
  if (parts.length > ARCHIVE_LIMITS.maxPathDepth) {
    throw new Error(`Archive path is nested too deeply: '${raw}'.`);
  }
  for (const part of parts) {
    if (part === "." || part === "..") {
      throw new Error(`Archive contains a path traversal entry: '${raw}'.`);
    }
    if (/[<>:"|?*\u0000-\u001f]/.test(part)) {
      throw new Error(`Archive contains an unsafe path segment: '${raw}'.`);
    }
  }
  return parts.join("/");
}

function classifyEntry(fileName: string): ArchiveEntryKind {
  if (/\.json$/i.test(fileName)) return "json";
  if (/\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(fileName)) return "image";
  if (/\.(zip|7z|rar|tar|gz|tgz|bz2|xz)$/i.test(fileName)) return "nested-archive";
  if (/\.(exe|dll|com|bat|cmd|ps1|sh|bash|py|pyc|js|mjs|cjs|vbs|scr|msi|jar)$/i.test(fileName)) {
    return "executable";
  }
  return "other";
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  if (buffer.length < 22) {
    throw new Error("The archive is not a valid ZIP file (missing end-of-central-directory record).");
  }
  const minimum = Math.max(0, buffer.length - 0xffff - 22);
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) return offset;
  }
  throw new Error("The archive is not a valid ZIP file (missing end-of-central-directory record).");
}

export function inspectWorkflowArchive(buffer: Buffer): WorkflowArchiveInspection {
  const eocd = findEndOfCentralDirectory(buffer);
  const diskNumber = buffer.readUInt16LE(eocd + 4);
  const centralDisk = buffer.readUInt16LE(eocd + 6);
  const entriesOnDisk = buffer.readUInt16LE(eocd + 8);
  const totalEntries = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  const commentLength = buffer.readUInt16LE(eocd + 20);

  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== totalEntries) {
    throw new Error("Multi-disk ZIP archives are not supported.");
  }
  if (
    totalEntries === 0xffff ||
    entriesOnDisk === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff
  ) {
    throw new Error("ZIP64 archives are not supported for workflow import.");
  }
  if (totalEntries > ARCHIVE_LIMITS.maxEntries) {
    throw new Error(
      `The archive contains ${totalEntries} entries; the workflow import limit is ${ARCHIVE_LIMITS.maxEntries}.`
    );
  }
  if (eocd + 22 + commentLength > buffer.length) {
    throw new Error("The archive is corrupt (invalid end-of-central-directory comment).");
  }
  const centralEnd = centralOffset + centralSize;
  if (centralEnd > buffer.length) {
    throw new Error("The archive is corrupt (central directory is out of bounds).");
  }

  const entries: WorkflowArchiveEntry[] = [];
  const warnings: string[] = [];
  let totalUncompressed = 0;
  let offset = centralOffset;

  for (let index = 0; index < totalEntries; index += 1) {
    if (offset + 46 > buffer.length) {
      throw new Error("The archive is corrupt (truncated central directory).");
    }
    if (buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      throw new Error("The archive is corrupt (invalid central directory signature).");
    }
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const crc = buffer.readUInt32LE(offset + 16);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const entryCommentLength = buffer.readUInt16LE(offset + 32);
    const diskStart = buffer.readUInt16LE(offset + 34);
    const externalAttributes = buffer.readUInt32LE(offset + 38);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const entryEnd = offset + 46 + nameLength + extraLength + entryCommentLength;
    if (entryEnd > buffer.length) {
      throw new Error("The archive is corrupt (entry name or extra data is out of bounds).");
    }
    const rawName = buffer
      .subarray(offset + 46, offset + 46 + nameLength)
      .toString("utf8");
    offset = entryEnd;

    if (diskStart !== 0) {
      throw new Error("Multi-disk ZIP archives are not supported.");
    }
    if ((flags & 0x0001) !== 0 || (flags & 0x0040) !== 0) {
      throw new Error(`Archive entry '${rawName}' is encrypted; encrypted archives are not supported.`);
    }
    const isDirectory =
      rawName.endsWith("/") || rawName.endsWith("\\") || (externalAttributes & 0x10) !== 0;
    const safePath = assertSafeArchivePath(rawName);
    if (isDirectory) continue;

    const mode = (externalAttributes >>> 16) & 0xffff;
    if ((mode & 0o170000) === 0o120000) {
      throw new Error(`Archive entry '${rawName}' is a symbolic link; symbolic links are not allowed.`);
    }
    if (compressedSize === 0 && uncompressedSize > 0) {
      throw new Error(`Archive entry '${rawName}' has an invalid compressed size.`);
    }
    if (uncompressedSize > ARCHIVE_LIMITS.maxEntryUncompressedBytes) {
      throw new Error(
        `Archive entry '${rawName}' expands to ${uncompressedSize} bytes, above the per-file limit.`
      );
    }
    if (
      uncompressedSize > ARCHIVE_LIMITS.ratioCheckThreshold &&
      compressedSize > 0 &&
      uncompressedSize / compressedSize > ARCHIVE_LIMITS.maxCompressionRatio
    ) {
      throw new Error(`Archive entry '${rawName}' has an unsafe compression ratio.`);
    }
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > ARCHIVE_LIMITS.maxTotalUncompressedBytes) {
      throw new Error("The archive expands beyond the total uncompressed size limit.");
    }

    const fileName = safePath.split("/").pop() ?? safePath;
    const kind = classifyEntry(fileName);
    if (kind === "nested-archive") {
      warnings.push(`Nested archive '${safePath}' was ignored; Kirea does not extract nested archives.`);
    } else if (kind === "executable") {
      warnings.push(`Executable '${safePath}' was ignored; Kirea never extracts or runs archive programs.`);
    }

    entries.push({
      path: safePath,
      fileName,
      kind,
      method,
      compressedSize,
      uncompressedSize,
      crc32: crc,
      localHeaderOffset,
      isDirectory: false,
    });
  }

  return {
    entries,
    jsonEntries: entries.filter((entry) => entry.kind === "json"),
    warnings,
  };
}

export function readWorkflowArchiveJson(
  buffer: Buffer,
  entry: WorkflowArchiveEntry
): string {
  if (entry.kind !== "json") {
    throw new Error("Only JSON workflow entries can be read from an archive.");
  }
  if (entry.method !== 0 && entry.method !== 8) {
    throw new Error(
      `Archive entry '${entry.path}' uses an unsupported compression method (${entry.method}).`
    );
  }
  const local = entry.localHeaderOffset;
  if (local + 30 > buffer.length) {
    throw new Error("The archive is corrupt (local file header is out of bounds).");
  }
  if (buffer.readUInt32LE(local) !== LOCAL_SIGNATURE) {
    throw new Error("The archive is corrupt (invalid local file header).");
  }
  const nameLength = buffer.readUInt16LE(local + 26);
  const extraLength = buffer.readUInt16LE(local + 28);
  const dataStart = local + 30 + nameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > buffer.length) {
    throw new Error("The archive is corrupt (compressed data is out of bounds).");
  }
  const compressed = buffer.subarray(dataStart, dataEnd);

  let output: Buffer;
  if (entry.method === 0) {
    output = Buffer.from(compressed);
  } else {
    try {
      output = zlib.inflateRawSync(compressed, {
        maxOutputLength: ARCHIVE_LIMITS.maxEntryUncompressedBytes,
      });
    } catch {
      throw new Error(`Archive entry '${entry.path}' could not be decompressed; the archive may be corrupt.`);
    }
  }
  if (output.length !== entry.uncompressedSize) {
    throw new Error(`Archive entry '${entry.path}' has an unexpected uncompressed size.`);
  }
  if (crc32(output) !== entry.crc32) {
    throw new Error(`Archive entry '${entry.path}' failed its CRC check; the archive is corrupt.`);
  }
  return output.toString("utf8");
}
