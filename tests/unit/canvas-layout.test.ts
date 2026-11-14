import { describe, expect, it } from "vitest";
import {
  buildCanvasPages,
  buildCanvasSyncPanels,
  canvasGridFor,
  canvasPanelsPerPage,
  computeCanvasSlots,
  normalizeCanvasOverlays,
  resolveCanvasCaption,
  resolveCanvasPageDimensions,
} from "../../src/shared/canvas-layout";
import type {
  GeneratedImageRecord,
  Story,
  StoryCanvas,
  StoryCanvasItem,
  StoryScene,
} from "../../src/shared/types";

const NOW = "2026-11-11T10:00:00.000Z";

function makeScene(overrides: Partial<StoryScene> = {}): StoryScene {
  return {
    id: "scene_1",
    storyId: "story_1",
    position: 0,
    title: "Cliff walk",
    synopsis: "The keeper raises the lantern.",
    prompt: "wide shot, cliff walk, dusk",
    negativePrompt: "",
    checkpointPath: null,
    loraRecipeId: null,
    aspectRatio: null,
    width: null,
    height: null,
    steps: null,
    cfg: null,
    sampler: null,
    scheduler: null,
    seed: -1,
    denoise: null,
    referenceModeOverride: null,
    batchCount: 1,
    status: "draft",
    lastJobId: null,
    selectedImageId: null,
    createdAt: NOW,
    updatedAt: NOW,
    cast: [],
    ...overrides,
  };
}

function makeItem(
  id: string,
  overrides: Partial<StoryCanvasItem> = {}
): StoryCanvasItem {
  return {
    id,
    canvasId: "canvas_1",
    sceneId: null,
    imageId: null,
    position: 0,
    x: null,
    y: null,
    width: null,
    height: null,
    fit: "cover",
    captionOverride: "",
    overlays: [],
    ...overrides,
  };
}

function makeCanvas(
  overrides: Partial<
    Pick<
      StoryCanvas,
      | "template"
      | "pageWidth"
      | "pageHeight"
      | "margin"
      | "gutter"
      | "captionMode"
    >
  > = {}
) {
  return {
    template: "grid_2x3" as const,
    pageWidth: 1123,
    pageHeight: 794,
    margin: 32,
    gutter: 16,
    captionMode: "scene_title" as const,
    ...overrides,
  };
}

function makeImage(
  id: string,
  overrides: Partial<GeneratedImageRecord> = {}
): GeneratedImageRecord {
  return {
    id,
    jobId: `job_${id}`,
    filePath: `C:\\out\\${id}.png`,
    fileName: `${id}.png`,
    format: "png",
    width: 1024,
    height: 1024,
    sizeBytes: 1024,
    prompt: "",
    negativePrompt: "",
    seed: 1,
    checkpoint: "SDXL/base.safetensors",
    loras: [],
    workflowId: "t2i_sdxl_base",
    sampler: "dpmpp_2m",
    scheduler: "karras",
    steps: 24,
    cfg: 6.5,
    denoise: 1,
    mode: "txt2img",
    favorite: false,
    tags: [],
    collectionId: null,
    createdAt: NOW,
    storyId: "story_1",
    storySceneId: null,
    ...overrides,
  };
}

describe("Canvas layout", () => {
  it("resolves fixed page sizes and clamps custom dimensions", () => {
    expect(resolveCanvasPageDimensions("a4_portrait")).toEqual({
      width: 794,
      height: 1123,
    });
    expect(resolveCanvasPageDimensions("a4_landscape")).toEqual({
      width: 1123,
      height: 794,
    });
    expect(resolveCanvasPageDimensions("letter")).toEqual({
      width: 816,
      height: 1056,
    });
    expect(resolveCanvasPageDimensions("square")).toEqual({
      width: 1080,
      height: 1080,
    });

    expect(resolveCanvasPageDimensions("custom", 100, 99999)).toEqual({
      width: 320,
      height: 4096,
    });
    expect(resolveCanvasPageDimensions("custom", 1280, 800)).toEqual({
      width: 1280,
      height: 800,
    });
    expect(resolveCanvasPageDimensions("custom", null, null)).toEqual({
      width: 1123,
      height: 794,
    });
  });

  it("chooses template grids and rotates filmstrips by orientation", () => {
    expect(canvasGridFor("grid_2x3", 1123, 794)).toEqual({ columns: 2, rows: 3 });
    expect(canvasGridFor("grid_3x3", 1123, 794)).toEqual({ columns: 3, rows: 3 });
    expect(canvasGridFor("filmstrip", 1123, 794)).toEqual({ columns: 4, rows: 1 });
    expect(canvasGridFor("filmstrip", 794, 1123)).toEqual({ columns: 1, rows: 4 });
    expect(canvasPanelsPerPage("grid_2x3", 1123, 794)).toBe(6);
  });

  it("places slots inside the margin and honours the gutter", () => {
    const slots = computeCanvasSlots(1000, 1000, 50, 20, {
      columns: 2,
      rows: 2,
    });
    expect(slots).toHaveLength(4);
    expect(slots[0]).toEqual({ x: 50, y: 50, width: 440, height: 440 });
    expect(slots[1]).toEqual({ x: 510, y: 50, width: 440, height: 440 });
    expect(slots[2]).toEqual({ x: 50, y: 510, width: 440, height: 440 });
    expect(slots[3]).toEqual({ x: 510, y: 510, width: 440, height: 440 });
  });

  it("paginates items in position order across pages", () => {
    const items = Array.from({ length: 7 }, (_, index) =>
      makeItem(`panel_${index}`, { position: index })
    );
    const pages = buildCanvasPages(makeCanvas(), items, []);
    expect(pages).toHaveLength(2);
    expect(pages[0]?.panels).toHaveLength(6);
    expect(pages[1]?.panels).toHaveLength(1);
    expect(pages[1]?.panels[0]?.item.id).toBe("panel_6");
    expect(pages[1]?.panels[0]?.pagePosition).toBe(0);
    expect(pages[0]?.width).toBe(1123);
    expect(pages[0]?.height).toBe(794);
  });

  it("uses stored normalized geometry for freeform panels", () => {
    const pages = buildCanvasPages(
      makeCanvas({ template: "freeform" }),
      [
        makeItem("panel_free", {
          x: 0.1,
          y: 0.2,
          width: 0.4,
          height: 0.5,
        }),
      ],
      []
    );
    const slot = pages[0]!.panels[0]!.slot;
    expect(slot.x).toBeCloseTo(32 + 0.1 * (1123 - 64), 3);
    expect(slot.y).toBeCloseTo(32 + 0.2 * (794 - 64), 3);
    expect(slot.width).toBeCloseTo(0.4 * (1123 - 64), 3);
    expect(slot.height).toBeCloseTo(0.5 * (794 - 64), 3);
  });

  it("falls back to the grid slot when freeform geometry is missing", () => {
    const pages = buildCanvasPages(
      makeCanvas({ template: "freeform" }),
      [makeItem("panel_grid")],
      []
    );
    const slot = pages[0]!.panels[0]!.slot;
    expect(slot.x).toBe(32);
    expect(slot.y).toBe(32);
    expect(slot.width).toBeCloseTo(521.5, 3);
    expect(slot.height).toBeCloseTo((794 - 64 - 32) / 3, 3);
  });

  it("resolves captions with overrides and mode fallbacks", () => {
    const scene = makeScene();
    expect(
      resolveCanvasCaption("scene_title", { captionOverride: "" }, scene)
    ).toBe("Cliff walk");
    expect(
      resolveCanvasCaption("synopsis", { captionOverride: "" }, scene)
    ).toBe("The keeper raises the lantern.");
    expect(
      resolveCanvasCaption("prompt", { captionOverride: "" }, scene)
    ).toBe("wide shot, cliff walk, dusk");
    expect(
      resolveCanvasCaption("none", { captionOverride: "" }, scene)
    ).toBe("");
    expect(
      resolveCanvasCaption("none", { captionOverride: "Custom beat" }, scene)
    ).toBe("Custom beat");
    expect(
      resolveCanvasCaption("scene_title", { captionOverride: "" }, null)
    ).toBe("");
  });

  it("normalizes overlay arrays and clamps positions", () => {
    const overlays = normalizeCanvasOverlays([
      { kind: "speech", speaker: "Mira", text: "  Hold the light. ", x: 1.4, y: -2 },
      { kind: "bogus", text: "   " },
      { kind: "thought", text: "Maybe", x: "nope", y: 0.25 },
      null,
      "not-an-overlay",
    ]);
    expect(overlays).toHaveLength(2);
    expect(overlays[0]).toEqual({
      id: "overlay_1",
      kind: "speech",
      speaker: "Mira",
      text: "Hold the light.",
      x: 1,
      y: 0,
    });
    expect(overlays[1]?.kind).toBe("thought");
    expect(overlays[1]?.x).toBe(0.5);
    expect(overlays[1]?.y).toBe(0.25);
    expect(overlays[1]?.speaker).toBeUndefined();
    expect(normalizeCanvasOverlays("nope")).toEqual([]);
  });

  it("builds sync panels from selected images with newest-render fallback", () => {
    const story = {
      scenes: [
        makeScene({ id: "scene_a", title: "A", selectedImageId: "img_selected" }),
        makeScene({
          id: "scene_b",
          title: "B",
          synopsis: "",
          selectedImageId: null,
        }),
      ],
    } as Pick<Story, "scenes">;
    const images = [
      makeImage("img_new", { storySceneId: "scene_b" }),
      makeImage("img_old", { storySceneId: "scene_b" }),
      makeImage("img_selected", { storySceneId: "scene_a" }),
    ];

    const panels = buildCanvasSyncPanels(story, images);
    expect(panels).toEqual([
      { sceneId: "scene_a", imageId: "img_selected", caption: "The keeper raises the lantern." },
      { sceneId: "scene_b", imageId: "img_new", caption: "B" },
    ]);
  });
});
