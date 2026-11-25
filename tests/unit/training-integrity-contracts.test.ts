import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DatasetBuilder } from "../../src/main/characters/dataset-builder";
import { CharacterTrainingConfigSchema } from "../../src/main/ipc/schemas";
import type { CharacterProfile, CharacterReference } from "../../src/shared/types";

function reference(
  id: string,
  approvalStatus: CharacterReference["approvalStatus"],
  overrides: Partial<CharacterReference> = {}
): CharacterReference {
  return {
    id,
    characterId: "char_aria",
    role: "secondary",
    filePath: path.join("C:/fixtures", `${id}.png`),
    sourcePath: null,
    caption: "",
    weight: 1,
    position: 0,
    approvalStatus,
    includedInTraining: true,
    createdAt: "2026-11-01T00:00:00.000Z",
    ...overrides,
  };
}

const character = {
  id: "char_aria",
  name: "Aria",
  description: "",
  appearance: "",
  clothing: "",
  promptPrefix: "kirea_aria",
  negativePrompt: "",
  triggerWords: ["kirea_aria"],
  architecture: "sdxl",
  checkpointPath: null,
  checkpointName: null,
  loraRecipeId: null,
  referenceMode: "none",
  referenceWeight: 0.5,
  referenceStart: 0,
  referenceEnd: 1,
  tags: [],
  favorite: false,
  usageCount: 0,
  lastUsedAt: null,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  references: [
    reference("approved", "approved"),
    reference("pending", "pending"),
    reference("rejected", "rejected"),
    reference("excluded", "approved", { includedInTraining: false }),
  ],
} as CharacterProfile;

const validConfig = {
  baseModelFamily: "illustrious",
  baseCheckpointPath: "C:/models/illustrious.safetensors",
  triggerToken: "kirea_aria",
  rank: 16,
  alpha: 16,
  learningRate: 0.0001,
  epochs: 10,
  batchSize: 1,
  resolution: 1024,
  gradientAccumulationSteps: 2,
  gradientCheckpointing: true,
  precision: "bf16",
  outputDirectory: "C:/models/loras/characters/aria",
  saveEveryNEpochs: 2,
};

describe("training dataset and input contracts", () => {
  it("selects only approved references for training", () => {
    const trainingItems = DatasetBuilder.buildDatasetItems(character, true);

    expect(trainingItems.map((item) => item.referenceId)).toEqual(["approved"]);
    expect(trainingItems.every((item) => item.selected)).toBe(true);
  });

  it("allows pending references only in an unfiltered preview", () => {
    const previewItems = DatasetBuilder.buildDatasetItems(character, false);

    expect(previewItems.map((item) => item.referenceId)).toEqual([
      "approved",
      "pending",
    ]);
    expect(previewItems.every((item) => item.selected)).toBe(true);
  });

  it("accepts supported SDXL families and all forwarded training settings", () => {
    expect(CharacterTrainingConfigSchema.parse(validConfig)).toEqual(validConfig);
    expect(
      CharacterTrainingConfigSchema.parse({
        ...validConfig,
        baseModelFamily: "sdxl",
      }).baseModelFamily
    ).toBe("sdxl");
    expect(
      CharacterTrainingConfigSchema.parse({
        ...validConfig,
        baseModelFamily: "pony",
      }).baseModelFamily
    ).toBe("pony");
  });

  it("rejects free-form model families and empty output directories", () => {
    expect(() =>
      CharacterTrainingConfigSchema.parse({
        ...validConfig,
        baseModelFamily: "../../escape",
      })
    ).toThrow();
    expect(() =>
      CharacterTrainingConfigSchema.parse({
        ...validConfig,
        outputDirectory: "",
      })
    ).toThrow();
  });
});

describe("training production packaging", () => {
  it("packages only the sd-scripts adapter and never references the synthetic trainer", () => {
    const root = process.cwd();
    const builderConfig = fs.readFileSync(
      path.join(root, "electron-builder.yml"),
      "utf8"
    );
    const managerSource = fs.readFileSync(
      path.join(root, "src/main/training/training-manager.ts"),
      "utf8"
    );

    expect(builderConfig).toContain("from: external/training/sd_scripts_adapter.py");
    expect(builderConfig).toContain("to: training/sd_scripts_adapter.py");
    expect(builderConfig).not.toContain("train_lora.py");
    expect(managerSource).not.toContain("train_lora.py");
    expect(managerSource).not.toContain("C:\\Users\\Harris");
    expect(
      fs.existsSync(path.join(root, "external/training/sd_scripts_adapter.py"))
    ).toBe(true);
  });
});
