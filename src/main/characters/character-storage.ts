import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { isPathInsideAnyRoot } from "../security";

const REFERENCE_IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const MAX_REFERENCE_BYTES = 64 * 1024 * 1024;
const CHARACTER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export interface ImportedCharacterReference {
  referenceId: string;
  filePath: string;
  width?: number;
  height?: number;
  aspectRatio?: string;
}

export class CharacterStorage {
  constructor(private readonly charactersRoot: string) {}

  characterDir(characterId: string): string {
    if (!CHARACTER_ID_PATTERN.test(characterId)) {
      throw new Error("Invalid character identifier.");
    }
    return path.join(this.charactersRoot, characterId);
  }

  private thumbnailPath(filePath: string): string {
    const dir = path.dirname(filePath);
    const stem = path.basename(filePath, path.extname(filePath));
    return path.join(dir, `${stem}.thumb.webp`);
  }

  async importFromFile(
    characterId: string,
    sourcePath: string
  ): Promise<ImportedCharacterReference> {
    const ext = path.extname(sourcePath).toLowerCase();
    if (!REFERENCE_IMAGE_EXTS.has(ext)) {
      throw new Error("Character references must be PNG, JPEG, or WebP images.");
    }

    const resolvedSource = path.resolve(sourcePath);
    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(resolvedSource);
    } catch {
      throw new Error("Selected reference image was not found on disk.");
    }
    if (!stat.isFile()) {
      throw new Error("Selected reference is not a file.");
    }
    if (stat.size <= 0 || stat.size > MAX_REFERENCE_BYTES) {
      throw new Error("Reference image must be larger than 0 bytes and under 64 MB.");
    }

    const referenceId = `ref_${crypto.randomUUID().slice(0, 12)}`;
    const destinationDir = this.characterDir(characterId);
    await fs.promises.mkdir(destinationDir, { recursive: true });
    const destination = path.join(destinationDir, `${referenceId}${ext}`);
    await fs.promises.copyFile(resolvedSource, destination);

    let width: number | undefined;
    let height: number | undefined;
    let aspectRatio: string | undefined;

    try {
      const meta = await sharp(destination).metadata();
      width = meta.width;
      height = meta.height;
      if (width && height) {
        aspectRatio = `${width}:${height}`;
      }
      await this.writeThumbnail(destination);
    } catch {
      // The original remains usable even if thumbnail generation fails.
    }

    return { referenceId, filePath: destination, width, height, aspectRatio };
  }

  async cropReference(
    characterId: string,
    sourcePath: string,
    crop: { left: number; top: number; width: number; height: number }
  ): Promise<ImportedCharacterReference> {
    const resolvedSource = path.resolve(sourcePath);
    if (!fs.existsSync(resolvedSource)) {
      throw new Error("Source image for cropping was not found.");
    }

    const referenceId = `ref_crop_${crypto.randomUUID().slice(0, 10)}`;
    const destinationDir = this.characterDir(characterId);
    await fs.promises.mkdir(destinationDir, { recursive: true });
    const destination = path.join(destinationDir, `${referenceId}.png`);

    await sharp(resolvedSource)
      .extract({
        left: Math.max(0, Math.round(crop.left)),
        top: Math.max(0, Math.round(crop.top)),
        width: Math.max(16, Math.round(crop.width)),
        height: Math.max(16, Math.round(crop.height)),
      })
      .png()
      .toFile(destination);

    const meta = await sharp(destination).metadata();
    const width = meta.width ?? Math.round(crop.width);
    const height = meta.height ?? Math.round(crop.height);
    const aspectRatio = `${width}:${height}`;

    try {
      await this.writeThumbnail(destination);
    } catch {
      // Best-effort thumbnail
    }

    return { referenceId, filePath: destination, width, height, aspectRatio };
  }

  private async writeThumbnail(filePath: string): Promise<void> {
    await sharp(filePath)
      .rotate()
      .resize({ width: 480, height: 480, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toFile(this.thumbnailPath(filePath));
  }

  async readPreviewDataUrl(filePath: string): Promise<string | null> {
    const resolved = path.resolve(filePath);
    if (!isPathInsideAnyRoot(resolved, [this.charactersRoot])) return null;
    if (!fs.existsSync(resolved)) return null;

    const thumb = this.thumbnailPath(resolved);
    try {
      if (!fs.existsSync(thumb)) {
        await this.writeThumbnail(resolved);
      }
      const target = fs.existsSync(thumb) ? thumb : resolved;
      const buf = await fs.promises.readFile(target);
      return `data:image/webp;base64,${buf.toString("base64")}`;
    } catch {
      return null;
    }
  }

  async removeReferenceFile(filePath: string): Promise<boolean> {
    const resolved = path.resolve(filePath);
    if (!isPathInsideAnyRoot(resolved, [this.charactersRoot])) return false;

    let removed = false;
    for (const target of [resolved, this.thumbnailPath(resolved)]) {
      try {
        if (fs.existsSync(target)) {
          await fs.promises.rm(target, { force: true });
          removed = true;
        }
      } catch {
        // Best-effort cleanup; the database row is removed either way.
      }
    }
    return removed;
  }

  async removeCharacterFiles(characterId: string): Promise<void> {
    const dir = this.characterDir(characterId);
    if (!isPathInsideAnyRoot(dir, [this.charactersRoot])) return;
    if (!fs.existsSync(dir)) return;
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
