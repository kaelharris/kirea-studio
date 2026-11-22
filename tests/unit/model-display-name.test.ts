import { describe, expect, it } from "vitest";
import {
  getModelDisplayName,
  getModelRefDisplayName,
  humanizeModelName,
  normalizeModelTitle,
} from "../../src/shared/model-utils";
import type { ModelRecord } from "../../src/shared/types";

function makeModel(overrides: Partial<ModelRecord>): ModelRecord {
  return {
    id: "model-1",
    name: "novaAnimeXL_v1",
    relativePath: "SDXL/novaAnimeXL_v1.safetensors",
    filePath: "C:\\Comfy\\models\\checkpoints\\SDXL\\novaAnimeXL_v1.safetensors",
    category: "checkpoint",
    architecture: "sdxl",
    sizeBytes: 1000,
    sha256: null,
    sourceRoot: "C:\\Comfy\\models\\checkpoints",
    isDuplicate: false,
    duplicateOf: null,
    isIncomplete: false,
    compatibleWorkflows: [],
    license: null,
    description: null,
    installed: true,
    lastSeenAt: "2026-11-17T00:00:00.000Z",
    metadata: null,
    discovery: null,
    ...overrides,
  };
}

describe("checkpoint display names", () => {
  it("prefers metadata displayName over the scanned filename", () => {
    expect(
      getModelDisplayName({
        name: "novaAnimeXL_v1",
        metadata: { displayName: "Nova Anime XL" },
      })
    ).toBe("Nova Anime XL");
  });

  it("prefers stored Civitai source names over filenames", () => {
    expect(
      getModelDisplayName({
        name: "UnholyDesireMixDarkSerenity_V3_Anima",
        discovery: {
          source: {
            modelName: "Unholy Desire Mix - Dark Serenity (Anima-2B | Anima-2.9B)",
          },
        },
      })
    ).toBe("Unholy Desire Mix - Dark Serenity (Anima-2B | Anima-2.9B)");
  });

  it("uses embedded titles when no source name exists", () => {
    expect(
      getModelDisplayName({
        name: "SemiRealisticAnimeStyle.rzWp",
        discovery: {
          source: null,
          embeddedTitle: "Semi Realistic Anime Style Illustrious",
        },
      })
    ).toBe("Semi Realistic Anime Style Illustrious");
  });

  it("humanizes scanner names when metadata is unavailable", () => {
    expect(getModelDisplayName({ name: "novaAnimeXL_v1", metadata: null })).toBe(
      "novaAnimeXL v1"
    );
    expect(getModelDisplayName({ name: "my_model-name.safetensors" })).toBe(
      "my model name"
    );
    expect(getModelDisplayName({ name: "C:\\models\\fine_tune-v2.ckpt" })).toBe(
      "fine tune v2"
    );
    expect(
      getModelDisplayName({ name: "C:\\models\\NovaAnimeILV190.safetensors.part" })
    ).toBe("NovaAnimeILV190");
  });

  it("keeps the cleaner filename when an embedded title is a near-duplicate", () => {
    expect(
      getModelDisplayName({
        name: "HIJABOLIC_Style_IL",
        discovery: { source: null, embeddedTitle: "HUJABOLIC Style IL" },
      })
    ).toBe("HIJABOLIC Style IL");
    expect(
      getModelDisplayName({
        name: "AddMicroDetails_Illustrious_v7",
        discovery: {
          source: null,
          embeddedTitle: "AddMicroDetails Illustrious",
        },
      })
    ).toBe("AddMicroDetails Illustrious v7");
  });

  it("resolves checkpoint and LoRA references used by jobs and drafts", () => {
    const model = makeModel({
      metadata: {
        modelId: "model-1",
        filePath: "C:\\Comfy\\models\\checkpoints\\SDXL\\novaAnimeXL_v1.safetensors",
        displayName: "Nova Anime XL",
        description: "",
        architectureOverride: null,
        baseModel: null,
        previewMode: "auto",
        previewPath: null,
        triggerWords: [],
        tags: [],
        notes: "",
        favorite: false,
        createdAt: "2026-11-17T00:00:00.000Z",
        updatedAt: "2026-11-17T00:00:00.000Z",
      },
    });
    expect(getModelRefDisplayName([model], "SDXL\\novaAnimeXL_v1.safetensors")).toBe(
      "Nova Anime XL"
    );
    expect(getModelRefDisplayName([model], "novaAnimeXL_v1.safetensors")).toBe(
      "Nova Anime XL"
    );
    expect(getModelRefDisplayName([model], "missing_model.safetensors")).toBe(
      "missing model"
    );
    expect(getModelRefDisplayName([model], null)).toBe("");
  });

  it("rejects generic embedded training titles", () => {
    expect(normalizeModelTitle("lora")).toBeNull();
    expect(normalizeModelTitle("epoch_1")).toBeNull();
    expect(normalizeModelTitle("training_4745674-20260806110524833")).toBeNull();
    expect(normalizeModelTitle("my_first_lora_v1_copy_copy")).toBeNull();
    expect(normalizeModelTitle("-")).toBeNull();
    expect(normalizeModelTitle("Anima-Dit 1_0 Annerose")).toBe(
      "Anima-Dit 1 0 Annerose"
    );
  });

  it("leaves already-readable names intact", () => {
    expect(humanizeModelName("Nova Anime XL")).toBe("Nova Anime XL");
  });
});
