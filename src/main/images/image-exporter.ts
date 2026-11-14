import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import type { GenerationRequest, OutputFormat } from "../../shared/types";

export interface KireaImageMetadataPayload {
  app: "Kirea Studio";
  version: string;
  jobId: string;
  workflowId: string;
  workflowVersion: string;
  mode: string;
  prompt: string;
  negativePrompt: string;
  checkpoint: string;
  vae: string | null;
  loras: GenerationRequest["loras"];
  seed: number;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  sampler: string;
  scheduler: string;
  denoise: number;
  hiresFix?: GenerationRequest["hiresFix"];
  upscale?: GenerationRequest["upscale"];
  createdAt: string;
}

export interface SavedImageResult {
  filePath: string;
  fileName: string;
  format: OutputFormat;
  width: number;
  height: number;
  sizeBytes: number;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    const byte = buf[i] ?? 0;
    c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/**
 * Inserts a valid uncompressed PNG `tEXt` chunk right before `IEND` so ComfyUI's
 * existing `prompt` and `workflow` chunks stay intact alongside Kirea Studio's
 * `kirea_meta` JSON chunk.
 */
export function injectPngTextChunk(
  pngBuffer: Buffer,
  keyword: string,
  text: string
): Buffer {
  if (pngBuffer.length < 24 || !pngBuffer.subarray(0, 8).equals(PNG_SIG)) {
    return pngBuffer;
  }

  let offset = 8;
  let iendOffset = -1;
  while (offset + 8 <= pngBuffer.length) {
    const len = pngBuffer.readUInt32BE(offset);
    const type = pngBuffer.subarray(offset + 4, offset + 8).toString("ascii");
    const totalChunkBytes = 12 + len;
    if (offset + totalChunkBytes > pngBuffer.length) break;
    if (type === "IEND") {
      iendOffset = offset;
      break;
    }
    offset += totalChunkBytes;
  }

  if (iendOffset < 0) return pngBuffer;

  const cleanKeyword = keyword.replace(/\0/g, "").slice(0, 79);
  const data = Buffer.concat([
    Buffer.from(cleanKeyword, "latin1"),
    Buffer.from([0]),
    Buffer.from(text, "utf8"),
  ]);

  const typeBuf = Buffer.from("tEXt", "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);

  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);

  const newChunk = Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
  return Buffer.concat([
    pngBuffer.subarray(0, iendOffset),
    newChunk,
    pngBuffer.subarray(iendOffset),
  ]);
}

export function extractPngTextChunks(pngBuffer: Buffer): Record<string, string> {
  const result: Record<string, string> = {};
  if (pngBuffer.length < 24 || !pngBuffer.subarray(0, 8).equals(PNG_SIG)) {
    return result;
  }

  let offset = 8;
  while (offset + 12 <= pngBuffer.length) {
    const len = pngBuffer.readUInt32BE(offset);
    const type = pngBuffer.subarray(offset + 4, offset + 8).toString("ascii");
    if (offset + 12 + len > pngBuffer.length) break;

    if (type === "tEXt") {
      const payload = pngBuffer.subarray(offset + 8, offset + 8 + len);
      const sep = payload.indexOf(0);
      if (sep > 0) {
        const k = payload.subarray(0, sep).toString("latin1");
        const v = payload.subarray(sep + 1).toString("utf8");
        result[k] = v;
      }
    }
    offset += 12 + len;
  }
  return result;
}

export function getCollisionFreeFilePath(targetPath: string): string {
  const dir = path.dirname(targetPath);
  const ext = path.extname(targetPath);
  const stem = path.basename(targetPath, ext);
  let candidate = targetPath;
  let counter = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${stem}-${counter}${ext}`);
    counter++;
  }
  return candidate;
}

export async function saveGeneratedImage(
  rawPngBuffer: Buffer,
  outputRootDir: string,
  format: OutputFormat,
  meta: KireaImageMetadataPayload,
  imageIndex: number
): Promise<SavedImageResult> {
  const dateFolder = meta.createdAt.slice(0, 10) || new Date().toISOString().slice(0, 10);
  const targetDir = path.join(outputRootDir, dateFolder);
  await fs.promises.mkdir(targetDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const ext = format === "jpeg" ? "jpg" : format;
  const baseName = `kirea_${stamp}_s${meta.seed}_${imageIndex + 1}.${ext}`;
  const targetPath = getCollisionFreeFilePath(path.join(targetDir, baseName));

  let outputBuffer: Buffer;
  const metaJson = JSON.stringify(meta);

  if (format === "png") {
    outputBuffer = injectPngTextChunk(rawPngBuffer, "kirea_meta", metaJson);
  } else if (format === "jpeg") {
    outputBuffer = await sharp(rawPngBuffer)
      .withMetadata({
        exif: {
          IFD0: {
            ImageDescription: metaJson,
            Software: "Kirea Studio",
          },
        },
      })
      .jpeg({ quality: 94, mozjpeg: true })
      .toBuffer();
  } else {
    outputBuffer = await sharp(rawPngBuffer)
      .withMetadata({
        exif: {
          IFD0: {
            ImageDescription: metaJson,
            Software: "Kirea Studio",
          },
        },
      })
      .webp({ quality: 92 })
      .toBuffer();
  }

  const parsedMeta = await sharp(outputBuffer).metadata();
  await fs.promises.writeFile(targetPath, outputBuffer);

  return {
    filePath: targetPath,
    fileName: path.basename(targetPath),
    format,
    width: parsedMeta.width ?? meta.width,
    height: parsedMeta.height ?? meta.height,
    sizeBytes: outputBuffer.length,
  };
}

export async function exportImageToDestination(
  sourceFilePath: string,
  destinationPath: string,
  format: OutputFormat,
  stripMetadata: boolean
): Promise<string> {
  const safeDest = getCollisionFreeFilePath(path.resolve(destinationPath));
  await fs.promises.mkdir(path.dirname(safeDest), { recursive: true });

  const inputBuf = await fs.promises.readFile(sourceFilePath);
  const sourceExt = path.extname(sourceFilePath).toLowerCase();
  const samePngWithMeta =
    format === "png" && !stripMetadata && sourceExt === ".png";

  if (samePngWithMeta) {
    await fs.promises.writeFile(safeDest, inputBuf);
    return safeDest;
  }

  let pipeline = sharp(inputBuf);
  if (!stripMetadata) {
    pipeline = pipeline.withMetadata();
  }

  let outBuf: Buffer;
  if (format === "png") {
    outBuf = await pipeline.png().toBuffer();
  } else if (format === "jpeg") {
    outBuf = await pipeline.jpeg({ quality: 94, mozjpeg: true }).toBuffer();
  } else {
    outBuf = await pipeline.webp({ quality: 92 }).toBuffer();
  }

  await fs.promises.writeFile(safeDest, outBuf);
  return safeDest;
}
