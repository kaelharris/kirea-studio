import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  NAV_GROUPS,
  PINNED_NAV_IDS,
} from "../../src/renderer/app/app-constants";
import {
  DEFAULT_INSPECTOR_OPEN,
} from "../../src/renderer/components/create/useCreateController";
import {
  LORA_PREVIEW_SIZES,
} from "../../src/renderer/components/create/create-helpers";

const read = (file: string) => readFileSync(file, "utf8");

describe("workspace navigation and panels", () => {
  it("pins Settings outside the main navigation groups", () => {
    expect(PINNED_NAV_IDS).toEqual(["settings"]);
    expect(NAV_GROUPS.flatMap((group) => group.items)).not.toContain("settings");
    expect(read("src/renderer/app/SidebarNav.tsx")).toContain("PINNED_NAV_IDS");
  });

  it("defaults the Inspector closed and exposes a dedicated toggle", () => {
    expect(DEFAULT_INSPECTOR_OPEN).toBe(false);
    const controller = read("src/renderer/components/create/useCreateController.ts");
    const page = read("src/renderer/pages/CreatePage.tsx");
    expect(controller).toContain("useState(DEFAULT_INSPECTOR_OPEN)");
    expect(page).toContain("setInspectorOpen((open) => !open)");
    expect(page).not.toContain('className="hidden min-[1600px]:inline-flex"');
  });
});

describe("LoRA preview sizing", () => {
  it("uses larger previews in the picker and selected stack", () => {
    expect(LORA_PREVIEW_SIZES.picker).toBe(72);
    expect(LORA_PREVIEW_SIZES.stack).toBe(52);
    const modals = read("src/renderer/components/create/CreateModals.tsx");
    const sidebar = read("src/renderer/components/create/CreateGenerationSidebar.tsx");
    expect(modals).toContain("LORA_PREVIEW_SIZES.picker");
    expect(sidebar).toContain("LORA_PREVIEW_SIZES.stack");
  });
});

describe("visual tokens and Create density", () => {
  it("uses softer global radii", () => {
    const css = read("src/renderer/index.css");
    expect(css).toMatch(/--radius-sm:\s*6px/);
    expect(css).toMatch(/--radius-md:\s*8px/);
    expect(css).toMatch(/--radius-lg:\s*10px/);
    expect(css).toMatch(/--radius-xl:\s*12px/);
  });

  it("defines terracotta tokens for both themes", () => {
    const css = read("src/renderer/index.css");
    expect(css).toMatch(/--terracotta:\s*#d9846f/i);
    expect(css).toMatch(/--terracotta:\s*#a94f37/i);
    expect(css).toContain("--color-terracotta: var(--terracotta)");
    expect(css).toContain("--color-terracotta-soft: var(--terracotta-soft)");
  });

  it("widens and compacts the Create Studio thread", () => {
    const source = read("src/renderer/pages/CreateCreativeMode.tsx");
    expect(source).not.toContain("max-w-[980px]");
    expect(source).toContain("max-w-[1240px]");
    expect(source).toContain("px-4 sm:px-5");
    expect(source).toContain("gap-3 py-3");
    expect(source).toContain("md:grid-cols-[128px_minmax(0,1fr)]");
  });

  it("uses terracotta visibly for creative tools and LoRA accents", () => {
    const creative = read("src/renderer/pages/CreateCreativeMode.tsx");
    const sidebar = read("src/renderer/components/create/CreateGenerationSidebar.tsx");
    expect(creative).toContain("border-terracotta/40");
    expect(creative).toContain("text-terracotta");
    expect(sidebar).toContain("text-terracotta");
  });
});
