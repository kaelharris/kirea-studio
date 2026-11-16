import type { PixelSheetLayout } from "../../../shared/pixel-package-types";

export interface RgbaImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SheetRegion {
  frame: Rect;
  trimmed: boolean;
  spriteSourceSize: Rect;
  sourceSize: { w: number; h: number };
  /** Where the original frame sits inside sourceSize when uniformFrames padded it. */
  canvasOffset: { x: number; y: number };
  cell: { column: number; row: number };
}

export interface PackedSheet {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  columns: number;
  rows: number;
  cell: { w: number; h: number };
  regions: Map<string, SheetRegion>;
  order: string[];
}

export interface PackCell {
  key: string;
  image: RgbaImage;
}

export const MAX_SHEET_PIXELS = 16_777_216;

export function scaleNearest(image: RgbaImage, scale: number): RgbaImage {
  if (scale === 1) return image;
  const width = image.width * scale;
  const height = image.height * scale;
  const data = new Uint8ClampedArray(width * height * 4);
  const aligned = image.data.byteOffset % 4 === 0 ? image.data : new Uint8ClampedArray(image.data);
  const source = new Uint32Array(aligned.buffer, aligned.byteOffset, image.width * image.height);
  const target = new Uint32Array(data.buffer);
  for (let y = 0; y < height; y++) {
    const row = Math.floor(y / scale) * image.width;
    for (let x = 0; x < width; x++) target[y * width + x] = source[row + Math.floor(x / scale)]!;
  }
  return { data, width, height };
}

export function flattenOnto(image: RgbaImage, background: [number, number, number]): RgbaImage {
  const data = new Uint8ClampedArray(image.data.length);
  for (let i = 0; i < data.length; i += 4) {
    const alpha = image.data[i + 3]! / 255;
    for (let c = 0; c < 3; c++) {
      data[i + c] = Math.round(image.data[i + c]! * alpha + background[c]! * (1 - alpha));
    }
    data[i + 3] = 255;
  }
  return { data, width: image.width, height: image.height };
}

export function opaqueBounds(image: RgbaImage): Rect | null {
  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (image.data[(y * image.width + x) * 4 + 3] === 0) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

export function crop(image: RgbaImage, rect: Rect): RgbaImage {
  const data = new Uint8ClampedArray(rect.w * rect.h * 4);
  for (let y = 0; y < rect.h; y++) {
    const start = ((rect.y + y) * image.width + rect.x) * 4;
    data.set(image.data.subarray(start, start + rect.w * 4), y * rect.w * 4);
  }
  return { data, width: rect.w, height: rect.h };
}

/** Places the image on a larger transparent canvas, centred horizontally and resting on the bottom edge. */
export function padTo(image: RgbaImage, width: number, height: number): { image: RgbaImage; offset: { x: number; y: number } } {
  if (image.width === width && image.height === height) return { image, offset: { x: 0, y: 0 } };
  const offset = { x: Math.floor((width - image.width) / 2), y: height - image.height };
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < image.height; y++) {
    data.set(
      image.data.subarray(y * image.width * 4, (y + 1) * image.width * 4),
      ((offset.y + y) * width + offset.x) * 4
    );
  }
  return { image: { data, width, height }, offset };
}

/**
 * Packs cells on a grid in the order given. A null cell leaves its grid slot empty, which keeps
 * each animation or direction on its own row. `rowLength` is used when the layout picks columns.
 */
export function packSheet(
  cells: Array<PackCell | null>,
  layout: PixelSheetLayout,
  options: { rowLength?: number } = {}
): PackedSheet {
  const filled = cells.filter((cell): cell is PackCell => cell !== null);
  if (!filled.length) throw new Error("A sprite sheet needs at least one frame.");
  const keys = new Set<string>();
  for (const cell of filled) {
    if (keys.has(cell.key)) throw new Error(`Frame "${cell.key}" appears twice in one sheet.`);
    keys.add(cell.key);
  }
  let uniform: { w: number; h: number } | null = null;
  if (layout.uniformFrames) {
    uniform = {
      w: Math.max(...filled.map((cell) => cell.image.width)),
      h: Math.max(...filled.map((cell) => cell.image.height)),
    };
  }
  const prepared = cells.map((cell) => {
    if (!cell) return null;
    let image = cell.image;
    let base = { x: 0, y: 0 };
    if (uniform) {
      const padded = padTo(image, uniform.w, uniform.h);
      image = padded.image;
      base = padded.offset;
    }
    const sourceSize = { w: image.width, h: image.height };
    if (!layout.trim) {
      return {
        key: cell.key,
        image,
        trimmed: false,
        spriteSourceSize: { x: 0, y: 0, w: image.width, h: image.height },
        sourceSize,
        base,
      };
    }
    const bounds = opaqueBounds(image) ?? { x: 0, y: 0, w: 1, h: 1 };
    const trimmed = bounds.x !== 0 || bounds.y !== 0 || bounds.w !== image.width || bounds.h !== image.height;
    return {
      key: cell.key,
      image: trimmed ? crop(image, bounds) : image,
      trimmed,
      spriteSourceSize: bounds,
      sourceSize,
      base,
    };
  });

  const present = prepared.filter((cell): cell is NonNullable<typeof cell> => cell !== null);
  const innerW = Math.max(...present.map((cell) => cell.image.width));
  const innerH = Math.max(...present.map((cell) => cell.image.height));
  const cellW = innerW + layout.extrude * 2;
  const cellH = innerH + layout.extrude * 2;
  const count = prepared.length;
  const span = (cellsAcross: number, size: number): number =>
    layout.padding * 2 + cellsAcross * size + Math.max(0, cellsAcross - 1) * layout.spacing;

  let columns = layout.columns;
  if (columns <= 0) {
    if (layout.rows > 0) columns = Math.ceil(count / layout.rows);
    else if (options.rowLength && span(options.rowLength, cellW) <= layout.maxSize) columns = options.rowLength;
    else columns = Math.max(1, Math.ceil(Math.sqrt(count)));
  }
  const rows = layout.rows > 0 ? layout.rows : Math.ceil(count / columns);
  if (columns * rows < count) {
    throw new Error(`${columns}×${rows} cells hold ${columns * rows} frames, but the sheet needs ${count}.`);
  }
  const width = span(columns, cellW);
  const height = span(rows, cellH);
  if (width > layout.maxSize || height > layout.maxSize) {
    throw new Error(
      `The sheet would be ${width}×${height} px, larger than the ${layout.maxSize} px limit. Raise the limit, lower the scale, or export per-animation sheets.`
    );
  }
  if (width * height > MAX_SHEET_PIXELS) {
    throw new Error(`The sheet would be ${width}×${height} px, more than a PNG can hold here.`);
  }

  const data = new Uint8ClampedArray(width * height * 4);
  const regions = new Map<string, SheetRegion>();
  const order: string[] = [];
  prepared.forEach((cell, index) => {
    if (!cell) return;
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = layout.padding + column * (cellW + layout.spacing) + layout.extrude;
    const y = layout.padding + row * (cellH + layout.spacing) + layout.extrude;
    blit(data, width, cell.image, x, y, layout.extrude);
    regions.set(cell.key, {
      frame: { x, y, w: cell.image.width, h: cell.image.height },
      trimmed: cell.trimmed,
      spriteSourceSize: cell.spriteSourceSize,
      sourceSize: cell.sourceSize,
      canvasOffset: cell.base,
      cell: { column, row },
    });
    order.push(cell.key);
  });
  return { data, width, height, columns, rows, cell: { w: cellW, h: cellH }, regions, order };
}

function blit(
  target: Uint8ClampedArray,
  targetWidth: number,
  image: RgbaImage,
  x: number,
  y: number,
  extrude: number
): void {
  for (let dy = -extrude; dy < image.height + extrude; dy++) {
    const sy = Math.min(image.height - 1, Math.max(0, dy));
    for (let dx = -extrude; dx < image.width + extrude; dx++) {
      const sx = Math.min(image.width - 1, Math.max(0, dx));
      const from = (sy * image.width + sx) * 4;
      const to = ((y + dy) * targetWidth + (x + dx)) * 4;
      target[to] = image.data[from]!;
      target[to + 1] = image.data[from + 1]!;
      target[to + 2] = image.data[from + 2]!;
      target[to + 3] = image.data[from + 3]!;
    }
  }
}

/** Restores a frame from its sheet region to its full source canvas. */
export function unpackRegion(sheet: RgbaImage, region: SheetRegion): RgbaImage {
  const cropped = crop(sheet, region.frame);
  if (!region.trimmed) return cropped;
  const data = new Uint8ClampedArray(region.sourceSize.w * region.sourceSize.h * 4);
  for (let y = 0; y < cropped.height; y++) {
    data.set(
      cropped.data.subarray(y * cropped.width * 4, (y + 1) * cropped.width * 4),
      ((region.spriteSourceSize.y + y) * region.sourceSize.w + region.spriteSourceSize.x) * 4
    );
  }
  return { data, width: region.sourceSize.w, height: region.sourceSize.h };
}

export function samePixels(a: RgbaImage, b: RgbaImage): boolean {
  if (a.width !== b.width || a.height !== b.height) return false;
  for (let i = 0; i < a.data.length; i++) if (a.data[i] !== b.data[i]) return false;
  return true;
}

export function parseHexColor(value: string): [number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (!match) throw new Error(`"${value}" is not a #rrggbb colour.`);
  const hex = match[1]!;
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}
