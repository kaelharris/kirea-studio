import path from "node:path";

export const PIXEL_ASSET_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isPixelAssetId(value: unknown): value is string {
  return typeof value === "string" && PIXEL_ASSET_ID_PATTERN.test(value);
}

export function resolvePixelExportDirectory(exportRoot: string, assetId: unknown): string {
  if (!isPixelAssetId(assetId)) throw new Error("Invalid export folder.");
  const root = path.resolve(exportRoot);
  const target = path.resolve(root, assetId);
  const relative = path.relative(root, target);
  if (!relative || relative !== assetId || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Invalid export folder.");
  }
  return target;
}
