import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const rootDir = path.resolve(import.meta.dirname, "..");
const svgPath = path.join(rootDir, "assets", "brand", "kirea-icon.svg");
const brandDir = path.join(rootDir, "assets", "brand");
const buildDir = path.join(rootDir, "build");

fs.mkdirSync(brandDir, { recursive: true });
fs.mkdirSync(buildDir, { recursive: true });

const svgBuffer = fs.readFileSync(svgPath);

const pngSizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const icoPayloads = [];

for (const size of pngSizes) {
  const pngBuffer = await sharp(svgBuffer, { density: 384 })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer();

  fs.writeFileSync(path.join(brandDir, `kirea-icon-${size}.png`), pngBuffer);
  if (size === 1024) {
    fs.writeFileSync(path.join(buildDir, "icon.png"), pngBuffer);
  }
  if (icoSizes.includes(size)) {
    icoPayloads.push({ size, buffer: pngBuffer });
  }
}

function buildIco(entries) {
  const headerSize = 6;
  const dirEntrySize = 16;
  let offset = headerSize + entries.length * dirEntrySize;

  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type = 1 (icon)
  header.writeUInt16LE(entries.length, 4);

  const dirBuffers = [];
  const dataBuffers = [];

  for (const entry of entries) {
    const dir = Buffer.alloc(dirEntrySize);
    dir.writeUInt8(entry.size >= 256 ? 0 : entry.size, 0); // width (0 = 256)
    dir.writeUInt8(entry.size >= 256 ? 0 : entry.size, 1); // height (0 = 256)
    dir.writeUInt8(0, 2); // color palette count
    dir.writeUInt8(0, 3); // reserved
    dir.writeUInt16LE(1, 4); // color planes
    dir.writeUInt16LE(32, 6); // bits per pixel
    dir.writeUInt32LE(entry.buffer.length, 8); // byte size
    dir.writeUInt32LE(offset, 12); // image offset

    offset += entry.buffer.length;
    dirBuffers.push(dir);
    dataBuffers.push(entry.buffer);
  }

  return Buffer.concat([header, ...dirBuffers, ...dataBuffers]);
}

const icoBuffer = buildIco(icoPayloads);
fs.writeFileSync(path.join(buildDir, "icon.ico"), icoBuffer);

// Renderer favicons (public/ is copied verbatim into dist by Vite).
const publicDir = path.join(rootDir, "public");
const pngBySize = new Map(
  pngSizes.map((size) => [size, fs.readFileSync(path.join(brandDir, `kirea-icon-${size}.png`))])
);
for (const size of [16, 32, 48, 64]) {
  fs.writeFileSync(path.join(publicDir, `favicon-${size}x${size}.png`), pngBySize.get(size));
}
fs.writeFileSync(path.join(publicDir, "favicon.png"), pngBySize.get(512));
fs.writeFileSync(
  path.join(publicDir, "favicon.ico"),
  buildIco([16, 32, 48, 64, 256].map((size) => ({ size, buffer: pngBySize.get(size) })))
);

console.log(`Generated PNG icons (${pngSizes.join(", ")}), multi-res build/icon.ico (${icoBuffer.length} bytes) and public favicons`);

