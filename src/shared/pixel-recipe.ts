import type { PixelDirection, PixelKind, PixelPalettePreset, PixelPalettePreset as Preset } from "./pixel-types";
import { PIXEL_PALETTES } from "./pixel-types";

export interface PixelRecipeFrame {
  name: string;
  duration: number;
  from?: string;
  translate?: [number, number];
  flipX?: boolean;
  ops?: Array<Record<string, unknown>>;
  pixels?: Array<{ x: number; y: number; color: string }>;
}

export interface PixelRecipe {
  version: 1;
  name: string;
  width: number;
  height: number;
  palette: Record<string, string>;
  symbols?: Record<string, string[]>;
  frames: PixelRecipeFrame[];
  animations?: Record<string, { frames: string[]; loop?: boolean }>;
  sheet?: { columns: number; padding: number; scale: number };
}

export interface BuildRecipeInput {
  kind: PixelKind;
  name: string;
  width: number;
  height: number;
  paletteId: string;
  seed: number;
  direction?: PixelDirection;
}

const clampByte = (n: number): number => Math.max(0, Math.min(255, Math.round(n)));

function mix(hex: string, target: string, amount: number): string {
  const from = hex.replace("#", "");
  const to = target.replace("#", "");
  const pick = (s: string, i: number): number => parseInt(s.slice(i, i + 2), 16);
  const channel = (i: number): string =>
    clampByte(pick(from, i) + (pick(to, i) - pick(from, i)) * amount)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(0)}${channel(2)}${channel(4)}`;
}

const lighten = (hex: string, amount: number): string => mix(hex, "#ffffff", amount);
const darken = (hex: string, amount: number): string => mix(hex, "#000000", amount);

export function getPalettePreset(paletteId: string): PixelPalettePreset {
  return PIXEL_PALETTES.find((preset) => preset.id === paletteId) ?? PIXEL_PALETTES[0]!;
}

export function buildPalette(preset: Preset): Record<string, string> {
  return {
    k: preset.ink,
    d: darken(preset.garment, 0.42),
    b: preset.garment,
    l: lighten(preset.garment, 0.26),
    h: preset.skin,
    H: lighten(preset.skin, 0.32),
    s: darken(preset.skin, 0.28),
    r: preset.hair,
    R: lighten(preset.hair, 0.3),
    a: preset.accent,
    A: lighten(preset.accent, 0.35),
    w: "#f7f3e8",
    t: "transparent",
  };
}

export function paletteColors(preset: Preset): string[] {
  const palette = buildPalette(preset);
  return Object.values(palette).filter((value) => value !== "transparent");
}

export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "pixel-asset";
}

export function defaultSizeFor(kind: PixelKind): { width: number; height: number } {
  switch (kind) {
    case "tileset":
      return { width: 48, height: 48 };
    case "environment":
      return { width: 64, height: 48 };
    case "effect":
      return { width: 32, height: 32 };
    case "weapon":
    case "item":
    case "object":
      return { width: 32, height: 32 };
    default:
      return { width: 32, height: 32 };
  }
}

function padRows(rows: string[], width: number, height: number): string[] {
  const out = rows.slice(0, height).map((row) => row.slice(0, width).padEnd(width, "."));
  while (out.length < height) out.push(".".repeat(width));
  return out;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SWORD = padRows(
  [
    ".l...",
    ".wl..",
    ".wl..",
    ".wl..",
    ".wl..",
    ".wl..",
    ".wl..",
    ".wl..",
    "kaAk.",
    "..a..",
    "..A..",
    "..a..",
    "..k..",
  ],
  5,
  13
);

function characterRows(direction: PixelDirection): string[] {
  const base = [
    "................",
    ".....kkkkkk.....",
    "....krrrrrrk....",
    "...krrRRrrrrk...",
    "...krhhhhhhrk...",
    "...khHhhhhHhk...",
    "...khkhhhhkhk...",
    "...khhhhhhhhk...",
    "....khhhhhhk....",
    ".....kssssk.....",
    "....kbbbbbbk....",
    "...kbllbbllbk...",
    "..khkbbbbbbkhk..",
    "..kskbbbbbbksk..",
    "...kkbbbbbbkk...",
    "....kdk..kdk....",
  ];
  if (direction === "back") {
    return [
      "................",
      ".....kkkkkk.....",
      "....krrrrrrk....",
      "...krrRRrrrrk...",
      "...krrrrrrrrk...",
      "...krRrrrrRrk...",
      "...krrrrrrrrk...",
      "...krrrrrrrrk...",
      "....krrrrrrk....",
      ".....kssssk.....",
      "....kbbbbbbk....",
      "...kbllbbllbk...",
      "..khkbbbbbbkhk..",
      "..kskbbbbbbksk..",
      "...kkbbbbbbkk...",
      "....kdk..kdk....",
    ];
  }
  if (direction === "side") {
    return [
      "................",
      ".....kkkkkk.....",
      "....krrrrrrk....",
      "...krrRRrrrrk...",
      "...krhhhhhhrk...",
      "...khHhhhhHhk...",
      "...khhkhhhhhk...",
      "...khhhhhhhhk...",
      "....khhhhhhk....",
      ".....kssssk.....",
      "....kbbbbbbk....",
      "...kbllbbllbk...",
      "...khkbbbbbbk...",
      "...kskbbbbbbk...",
      "....kkbbbbbbk...",
      "....kdk..kdk....",
    ];
  }
  return base;
}

const CREATURE = padRows(
  [
    "................",
    "................",
    "................",
    "................",
    "................",
    "......kkkk......",
    "....kkllllkk....",
    "...kllbbbbllk...",
    "..klbbbbbbbbbk..",
    "..kbbwbbbwbbbk..",
    ".kbbbbbbbbbbbk..",
    ".kbbbbbbbbbbbk..",
    ".kbbbbbbbbbbbk..",
    "..kddddddddddk..",
    "...kkkkkkkkkk...",
    "................",
  ],
  16,
  16
);

function characterRecipe(input: BuildRecipeInput, palette: Record<string, string>): PixelRecipe {
  const scale = Math.max(1, Math.floor(Math.min(input.width, input.height) / 16));
  const rows = padRows(characterRows(input.direction ?? "front"), 16, 16);
  const step = scale;
  return {
    version: 1,
    name: slugify(input.name),
    width: input.width,
    height: input.height,
    palette,
    symbols: { sword: SWORD },
    frames: [
      { name: "idle_1", duration: 320, ops: [{ op: "grid", x: 0, y: 0, rows, scale }] },
      {
        name: "idle_2",
        duration: 320,
        from: "idle_1",
        translate: [0, -step],
      },
      { name: "walk_1", duration: 130, from: "idle_1", translate: [-step, 0] },
      { name: "walk_2", duration: 130, from: "idle_2" },
      { name: "walk_3", duration: 130, from: "idle_1", translate: [step, 0] },
      { name: "walk_4", duration: 130, from: "idle_2" },
      {
        name: "attack_1",
        duration: 110,
        from: "idle_1",
        ops: [{ op: "stamp", symbol: "sword", x: 11 * scale, y: 2 * scale, scale }],
      },
      {
        name: "attack_2",
        duration: 110,
        from: "attack_1",
        translate: [step, 0],
      },
      { name: "run_1", duration: 90, from: "idle_1", translate: [-2 * step, 0] },
      { name: "run_2", duration: 90, from: "idle_2" },
      { name: "run_3", duration: 90, from: "idle_1", translate: [2 * step, 0] },
      { name: "run_4", duration: 90, from: "idle_2" },
      { name: "jump_1", duration: 120, from: "idle_1", translate: [0, -2 * step] },
      { name: "jump_2", duration: 140, from: "idle_1", translate: [0, -3 * step] },
      { name: "jump_3", duration: 120, from: "idle_1", translate: [0, -step] },
      { name: "hurt_1", duration: 120, from: "idle_1", translate: [-step, 0] },
      { name: "hurt_2", duration: 160, from: "idle_1", translate: [-2 * step, 0] },
      { name: "death_1", duration: 140, from: "idle_1", translate: [0, step] },
      { name: "death_2", duration: 180, from: "idle_1", translate: [step, 2 * step] },
      { name: "death_3", duration: 320, from: "idle_1", translate: [2 * step, 3 * step] },
    ],
    animations: {
      idle: { frames: ["idle_1", "idle_2"] },
      walk: { frames: ["walk_1", "walk_2", "walk_3", "walk_4"] },
      run: { frames: ["run_1", "run_2", "run_3", "run_4"] },
      attack: { frames: ["attack_1", "attack_2"] },
      jump: { frames: ["jump_1", "jump_2", "jump_3"], loop: false },
      hurt: { frames: ["hurt_1", "hurt_2"], loop: false },
      death: { frames: ["death_1", "death_2", "death_3"], loop: false },
    },
    sheet: { columns: 4, padding: 0, scale: input.width <= 32 ? 4 : input.width <= 64 ? 2 : 1 },
  };
}

function creatureRecipe(input: BuildRecipeInput, palette: Record<string, string>): PixelRecipe {
  const scale = Math.max(1, Math.floor(Math.min(input.width, input.height) / 16));
  return {
    version: 1,
    name: slugify(input.name),
    width: input.width,
    height: input.height,
    palette,
    frames: [
      { name: "rest", duration: 420, ops: [{ op: "grid", x: 0, y: 0, rows: CREATURE, scale }] },
      { name: "squish", duration: 260, from: "rest", translate: [0, scale] },
      {
        name: "blink",
        duration: 140,
        from: "rest",
        ops: [
          { op: "pixel", x: 5 * scale, y: 9 * scale, color: "b" },
          { op: "pixel", x: 10 * scale, y: 9 * scale, color: "b" },
        ],
      },
    ],
    animations: {
      idle: { frames: ["rest", "squish"] },
      blink: { frames: ["rest", "blink", "rest"], loop: false },
    },
    sheet: { columns: 3, padding: 0, scale: input.width <= 32 ? 4 : 2 },
  };
}

function weaponRecipe(input: BuildRecipeInput, palette: Record<string, string>): PixelRecipe {
  const w = input.width;
  const h = input.height;
  const ops: Array<Record<string, unknown>> = [
    { op: "rect", x: Math.round(w * 0.44), y: Math.round(h * 0.08), w: Math.max(2, Math.round(w * 0.12)), h: Math.round(h * 0.5), color: "l" },
    { op: "rect", x: Math.round(w * 0.47), y: Math.round(h * 0.1), w: 1, h: Math.round(h * 0.44), color: "w" },
    { op: "rect", x: Math.round(w * 0.38), y: Math.round(h * 0.58), w: Math.round(w * 0.24), h: Math.max(1, Math.round(h * 0.05)), color: "a" },
    { op: "rect", x: Math.round(w * 0.47), y: Math.round(h * 0.62), w: Math.max(1, Math.round(w * 0.06)), h: Math.round(h * 0.2), color: "a" },
    { op: "rect", x: Math.round(w * 0.44), y: Math.round(h * 0.82), w: Math.max(2, Math.round(w * 0.12)), h: Math.max(1, Math.round(h * 0.05)), color: "A" },
    { op: "rect", x: Math.round(w * 0.43), y: Math.round(h * 0.87), w: Math.max(2, Math.round(w * 0.14)), h: Math.max(1, Math.round(h * 0.06)), color: "k" },
  ];
  return {
    version: 1,
    name: slugify(input.name),
    width: w,
    height: h,
    palette,
    frames: [{ name: "rest", duration: 400, ops }],
    animations: { idle: { frames: ["rest"] } },
    sheet: { columns: 1, padding: 0, scale: w <= 32 ? 4 : 2 },
  };
}

function itemRecipe(input: BuildRecipeInput, palette: Record<string, string>): PixelRecipe {
  const w = input.width;
  const h = input.height;
  const ops: Array<Record<string, unknown>> = [
    { op: "rect", x: Math.round(w * 0.44), y: Math.round(h * 0.1), w: Math.round(w * 0.12), h: Math.round(h * 0.12), color: "a" },
    { op: "rect", x: Math.round(w * 0.38), y: Math.round(h * 0.24), w: Math.round(w * 0.24), h: Math.round(h * 0.5), color: "w" },
    { op: "rect", x: Math.round(w * 0.32), y: Math.round(h * 0.44), w: Math.round(w * 0.36), h: Math.round(h * 0.3), color: "w" },
    { op: "rect", x: Math.round(w * 0.36), y: Math.round(h * 0.52), w: Math.round(w * 0.28), h: Math.round(h * 0.2), color: "b" },
    { op: "rect", x: Math.round(w * 0.38), y: Math.round(h * 0.46), w: Math.round(w * 0.08), h: Math.round(h * 0.2), color: "l" },
    { op: "pixel", x: Math.round(w * 0.4), y: Math.round(h * 0.3), color: "w" },
    { op: "rect", x: Math.round(w * 0.34), y: Math.round(h * 0.74), w: Math.round(w * 0.32), h: Math.round(h * 0.04), color: "k" },
  ];
  return {
    version: 1,
    name: slugify(input.name),
    width: w,
    height: h,
    palette,
    frames: [{ name: "rest", duration: 400, ops }],
    animations: { idle: { frames: ["rest"] } },
    sheet: { columns: 1, padding: 0, scale: w <= 32 ? 4 : 2 },
  };
}

function objectRecipe(input: BuildRecipeInput, palette: Record<string, string>): PixelRecipe {
  const w = input.width;
  const h = input.height;
  const ops: Array<Record<string, unknown>> = [
    { op: "rect", x: Math.round(w * 0.2), y: Math.round(h * 0.34), w: Math.round(w * 0.6), h: Math.round(h * 0.5), color: "b" },
    { op: "rect", x: Math.round(w * 0.18), y: Math.round(h * 0.28), w: Math.round(w * 0.64), h: Math.round(h * 0.12), color: "l" },
    { op: "rect", x: Math.round(w * 0.2), y: Math.round(h * 0.42), w: Math.round(w * 0.6), h: Math.round(h * 0.04), color: "d" },
    { op: "rect", x: Math.round(w * 0.46), y: Math.round(h * 0.44), w: Math.round(w * 0.08), h: Math.round(h * 0.16), color: "a" },
    { op: "pixel", x: Math.round(w * 0.49), y: Math.round(h * 0.5), color: "A" },
    { op: "rect", x: Math.round(w * 0.22), y: Math.round(h * 0.82), w: Math.round(w * 0.06), h: Math.round(h * 0.06), color: "k" },
    { op: "rect", x: Math.round(w * 0.72), y: Math.round(h * 0.82), w: Math.round(w * 0.06), h: Math.round(h * 0.06), color: "k" },
  ];
  return {
    version: 1,
    name: slugify(input.name),
    width: w,
    height: h,
    palette,
    frames: [{ name: "rest", duration: 400, ops }],
    animations: { idle: { frames: ["rest"] } },
    sheet: { columns: 1, padding: 0, scale: w <= 32 ? 4 : 2 },
  };
}

function tilesetRecipe(input: BuildRecipeInput, palette: Record<string, string>): PixelRecipe {
  const w = Math.max(48, Math.round(input.width / 16) * 16);
  const h = Math.max(48, Math.round(input.height / 16) * 16);
  const tile = 16;
  const random = mulberry32(input.seed);
  const ops: Array<Record<string, unknown>> = [
    { op: "rect", x: 0, y: 0, w, h, color: "d" },
  ];
  const tilesX = Math.floor(w / tile);
  const tilesY = Math.floor(h / tile);
  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const x = tx * tile;
      const y = ty * tile;
      const row = ty % 3;
      const base = row === 0 ? "l" : row === 1 ? "b" : "l";
      ops.push({ op: "rect", x: x + 1, y: y + 1, w: tile - 2, h: tile - 2, color: base });
      ops.push({ op: "rect", x: x, y: y, w: tile, h: 1, color: "k" });
      ops.push({ op: "rect", x: x, y: y, w: 1, h: tile, color: "k" });
      if (row === 2) {
        for (let line = 0; line < 3; line++) {
          ops.push({
            op: "rect",
            x: x + 2,
            y: y + 4 + line * 4 + (line % 2),
            w: tile - 4,
            h: 1,
            color: "w",
          });
        }
      } else {
        for (let dot = 0; dot < 10; dot++) {
          ops.push({
            op: "pixel",
            x: x + 2 + Math.floor(random() * (tile - 4)),
            y: y + 2 + Math.floor(random() * (tile - 4)),
            color: random() > 0.5 ? "b" : "A",
          });
        }
      }
    }
  }
  return {
    version: 1,
    name: slugify(input.name),
    width: w,
    height: h,
    palette,
    frames: [{ name: "sheet", duration: 400, ops }],
    animations: { idle: { frames: ["sheet"] } },
    sheet: { columns: 1, padding: 0, scale: 1 },
  };
}

function environmentRecipe(input: BuildRecipeInput, palette: Record<string, string>): PixelRecipe {
  const w = input.width;
  const h = input.height;
  const horizon = Math.round(h * 0.58);
  const ops: Array<Record<string, unknown>> = [
    { op: "rect", x: 0, y: 0, w, h: horizon, color: "l" },
    { op: "rect", x: 0, y: horizon, w, h: h - horizon, color: "b" },
    { op: "ellipse", x: Math.round(w * 0.68), y: Math.round(h * 0.12), w: Math.round(w * 0.14), h: Math.round(h * 0.14), color: "a" },
    { op: "ellipse", x: Math.round(w * 0.02), y: Math.round(h * 0.35), w: Math.round(w * 0.45), h: Math.round(h * 0.3), color: "d" },
    { op: "ellipse", x: Math.round(w * 0.4), y: Math.round(h * 0.4), w: Math.round(w * 0.55), h: Math.round(h * 0.28), color: "b" },
    { op: "rect", x: Math.round(w * 0.12), y: Math.round(h * 0.42), w: Math.max(2, Math.round(w * 0.03)), h: Math.round(h * 0.16), color: "k" },
    { op: "ellipse", x: Math.round(w * 0.08), y: Math.round(h * 0.36), w: Math.round(w * 0.11), h: Math.round(h * 0.12), color: "r" },
    { op: "rect", x: Math.round(w * 0.78), y: Math.round(h * 0.46), w: Math.max(2, Math.round(w * 0.025)), h: Math.round(h * 0.12), color: "k" },
    { op: "ellipse", x: Math.round(w * 0.75), y: Math.round(h * 0.4), w: Math.round(w * 0.09), h: Math.round(h * 0.1), color: "R" },
    { op: "rect", x: 0, y: h - Math.max(2, Math.round(h * 0.06)), w, h: Math.max(2, Math.round(h * 0.06)), color: "d" },
  ];
  return {
    version: 1,
    name: slugify(input.name),
    width: w,
    height: h,
    palette,
    frames: [{ name: "vista", duration: 400, ops }],
    animations: { idle: { frames: ["vista"] } },
    sheet: { columns: 1, padding: 0, scale: w <= 64 ? 3 : 2 },
  };
}

function effectRecipe(input: BuildRecipeInput, palette: Record<string, string>): PixelRecipe {
  const w = input.width;
  const h = input.height;
  const frames: PixelRecipeFrame[] = [];
  const steps = 6;
  for (let i = 0; i < steps; i++) {
    const radius = Math.round((Math.min(w, h) / 2) * ((i + 1) / steps));
    const color = i < 2 ? "w" : i < 4 ? "A" : "a";
    const ops: Array<Record<string, unknown>> = [
      { op: "ellipse", x: Math.round(w / 2 - radius), y: Math.round(h / 2 - radius), w: radius * 2, h: radius * 2, color, filled: false },
    ];
    if (i >= 2) {
      ops.push({ op: "ellipse", x: Math.round(w / 2 - radius * 0.6), y: Math.round(h / 2 - radius * 0.6), w: Math.round(radius * 1.2), h: Math.round(radius * 1.2), color: "d", filled: true });
    }
    const random = mulberry32(input.seed + i);
    for (let spark = 0; spark < 8; spark++) {
      ops.push({
        op: "pixel",
        x: Math.round(w / 2 + (random() - 0.5) * radius * 2.2),
        y: Math.round(h / 2 + (random() - 0.5) * radius * 2.2),
        color: random() > 0.5 ? "A" : "w",
      });
    }
    frames.push({ name: `burst_${i + 1}`, duration: i === steps - 1 ? 180 : 90, ops });
  }
  return {
    version: 1,
    name: slugify(input.name),
    width: w,
    height: h,
    palette,
    frames,
    animations: { burst: { frames: frames.map((frame) => frame.name), loop: false } },
    sheet: { columns: steps, padding: 0, scale: w <= 32 ? 4 : 2 },
  };
}

export function buildPixelRecipe(input: BuildRecipeInput): PixelRecipe {
  const preset = getPalettePreset(input.paletteId);
  const palette = buildPalette(preset);
  switch (input.kind) {
    case "character":
      return characterRecipe(input, palette);
    case "creature":
      return creatureRecipe(input, palette);
    case "weapon":
      return weaponRecipe(input, palette);
    case "item":
      return itemRecipe(input, palette);
    case "object":
      return objectRecipe(input, palette);
    case "tileset":
      return tilesetRecipe(input, palette);
    case "environment":
      return environmentRecipe(input, palette);
    case "effect":
      return effectRecipe(input, palette);
  }
}
