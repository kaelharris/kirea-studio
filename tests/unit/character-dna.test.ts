import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { CharacterStorage } from "../../src/main/characters/character-storage";
import { DatasetBuilder } from "../../src/main/characters/dataset-builder";
import { StudioDatabase } from "../../src/main/db/database";
import { StudioRepository } from "../../src/main/db/repositories";
import { TrainingManager } from "../../src/main/training/training-manager";
import {
  composeCharacterPrompt,
  getCharacterIdentityTokens,
  removeCharacterIdentityTokens,
  resolveCharacterAdapter,
} from "../../src/shared/character-utils";
import type {
  CharacterAdapter,
  CharacterIdentityCore,
  CharacterKnowledge,
  CharacterOutfit,
  CharacterProfile,
  CharacterProfileInput,
  CharacterReference,
  CharacterTrainingConfig,
  DatasetItem,
  ModelArchitecture,
} from "../../src/shared/types";

const tempDirs: string[] = [];
const openDbs: StudioDatabase[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kirea-dna-test-"));
  tempDirs.push(dir);
  return dir;
}

function makeDb(): StudioRepository {
  const db = new StudioDatabase(":memory:");
  openDbs.push(db);
  return new StudioRepository(db);
}

afterEach(() => {
  while (openDbs.length > 0) {
    openDbs.pop()!.close();
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

describe("Character DNA System — Layer A: Identity Core", () => {
  it("persists structured identity core fields and maintains backward compatibility", () => {
    const repo = makeDb();

    const dnaInput: Partial<CharacterIdentityCore> = {
      triggerToken: "kirea_aria",
      gender: "Female",
      ageCategory: "Young Adult",
      species: "Human",
      archetype: "Ronin",
      hairColor: "silver",
      hairStyle: "messy ponytail",
      eyeColor: "amber",
      skinTone: "pale",
      facialCharacteristics: "sharp features, beauty mark under left eye",
      distinctiveFeatures: ["scar over right shoulder", "neural interface port"],
      bodyCharacteristics: "slender, athletic build",
      signatureAccessories: ["crimson scarf", "antique silver ring"],
      preferredStyle: "Anime Halftone",
      negativeConstraints: "glasses, blue hair, earrings",
      dnaLocked: true,
      fixedTraits: ["silver hair", "amber eyes", "crimson scarf"],
      variableTraits: ["tactical jacket", "casual hoodie"],
    };

    const saved = repo.saveCharacter({
      name: "Aria Kisaragi",
      description: "Protagonist hacker ronin.",
      architecture: "illustrious",
      dna: dnaInput,
    });

    expect(saved.id).toBeTruthy();
    expect(saved.name).toBe("Aria Kisaragi");
    expect(saved.dna).toBeDefined();
    expect(saved.dna?.triggerToken).toBe("kirea_aria");
    expect(saved.dna?.gender).toBe("Female");
    expect(saved.dna?.archetype).toBe("Ronin");
    expect(saved.dna?.hairColor).toBe("silver");
    expect(saved.dna?.eyeColor).toBe("amber");
    expect(saved.dna?.distinctiveFeatures).toEqual([
      "scar over right shoulder",
      "neural interface port",
    ]);
    expect(saved.dna?.dnaLocked).toBe(true);

    // Verify retrieval by id
    const retrieved = repo.getCharacterById(saved.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.dna?.triggerToken).toBe("kirea_aria");
    expect(retrieved?.dna?.negativeConstraints).toBe("glasses, blue hair, earrings");
  });

  it("handles legacy characters with null DNA columns gracefully via fallback mapping", () => {
    const repo = makeDb();

    // Legacy character without dna object
    const legacy = repo.saveCharacter({
      name: "Legacy Character",
      appearance: "blonde hair, blue eyes",
      clothing: "leather jacket",
      triggerWords: ["legacy_char"],
      architecture: "sdxl",
    });

    const retrieved = repo.getCharacterById(legacy.id);
    expect(retrieved).not.toBeNull();
    // DNA is populated with fallback values from appearance/clothing/triggerWords
    expect(retrieved?.dna?.triggerToken).toBe("legacy_char");
    expect(retrieved?.dna?.canonicalDescription).toBe("blonde hair, blue eyes");
    expect(retrieved?.dna?.dnaLocked).toBe(false);
  });
});

describe("Character DNA System — Layer B: Visual Memory & References", () => {
  it("stores references with category, approval status, dimensions and training flags", async () => {
    const repo = makeDb();
    const tempDir = makeTempDir();
    const storage = new CharacterStorage(tempDir);

    const char = repo.saveCharacter({
      name: "Ren",
      architecture: "illustrious",
    });

    // Create a dummy image
    const dummyPath = path.join(tempDir, "test_ref.png");
    await sharp({
      create: {
        width: 1024,
        height: 1024,
        channels: 4,
        background: { r: 30, g: 30, b: 30, alpha: 1 },
      },
    })
      .png()
      .toFile(dummyPath);

    const imported = await storage.importFromFile(char.id, dummyPath);
    expect(imported.width).toBe(1024);
    expect(imported.height).toBe(1024);
    expect(imported.aspectRatio).toBe("1024:1024");

    const added = repo.addCharacterReference({
      characterId: char.id,
      filePath: imported.filePath,
      sourcePath: dummyPath,
      role: "primary",
      category: "canonical_face",
      approvalStatus: "approved",
      caption: "front face closeup",
      width: imported.width,
      height: imported.height,
      aspectRatio: imported.aspectRatio,
      includedInTraining: true,
    });

    expect(added.category).toBe("canonical_face");
    expect(added.approvalStatus).toBe("approved");
    expect(added.includedInTraining).toBe(true);

    // Update approval status to rejected
    const updated = repo.updateCharacterReference(char.id, added.id, {
      approvalStatus: "rejected",
      includedInTraining: false,
    });
    expect(updated?.approvalStatus).toBe("rejected");
    expect(updated?.includedInTraining).toBe(false);
  });

  it("crops sub-regions from turnaround character sheets into separate reference samples", async () => {
    const tempDir = makeTempDir();
    const storage = new CharacterStorage(tempDir);

    // Create a 1024x512 turnaround sheet
    const sheetPath = path.join(tempDir, "sheet.png");
    await sharp({
      create: {
        width: 1024,
        height: 512,
        channels: 4,
        background: { r: 50, g: 100, b: 150, alpha: 1 },
      },
    })
      .png()
      .toFile(sheetPath);

    // Crop the left 512x512 half (front view)
    const cropped = await storage.cropReference("char_123", sheetPath, {
      left: 0,
      top: 0,
      width: 512,
      height: 512,
    });

    expect(fs.existsSync(cropped.filePath)).toBe(true);
    expect(cropped.width).toBe(512);
    expect(cropped.height).toBe(512);
    expect(cropped.aspectRatio).toBe("512:512");
  });
});

describe("Character DNA System — Layer C: Model Memory & Visual Adapters", () => {
  it("persists and manages trained CharacterAdapter records", () => {
    const repo = makeDb();
    const char = repo.saveCharacter({
      name: "Tsubasa",
      architecture: "illustrious",
    });

    const adapterInput: Omit<CharacterAdapter, "createdAt" | "updatedAt"> = {
      id: "adapter_1",
      characterId: char.id,
      baseModelFamily: "illustrious",
      triggerToken: "kirea_tsubasa",
      fileLocation: "loras/characters/tsubasa_illustrious.safetensors",
      rank: 16,
      alpha: 16,
      recommendedStrength: 0.85,
      status: "trained",
    };

    const saved = repo.saveAdapter(adapterInput);
    expect(saved.id).toBe("adapter_1");
    expect(saved.rank).toBe(16);
    expect(saved.recommendedStrength).toBe(0.85);

    const listed = repo.listAdapters(char.id);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.baseModelFamily).toBe("illustrious");

    // Delete adapter
    const deleted = repo.deleteAdapter("adapter_1");
    expect(deleted).toBe(true);
    expect(repo.listAdapters(char.id)).toHaveLength(0);
  });

  it("resolves compatible adapters matching the active model architecture", () => {
    const char: CharacterProfile = {
      id: "char_test",
      name: "Lyra",
      description: "",
      appearance: "",
      clothing: "",
      promptPrefix: "",
      negativePrompt: "",
      triggerWords: [],
      architecture: "illustrious",
      checkpointPath: null,
      checkpointName: null,
      loraRecipeId: null,
      referenceMode: "none",
      referenceWeight: 0.75,
      referenceStart: 0,
      referenceEnd: 1,
      tags: [],
      usageCount: 0,
      lastUsedAt: null,
      favorite: false,
      createdAt: "",
      updatedAt: "",
      references: [],
      activeAdapterId: "adapter_illustrious",
      adapters: [
        {
          id: "adapter_illustrious",
          characterId: "char_test",
          baseModelFamily: "illustrious",
          triggerToken: "kirea_lyra",
          fileLocation: "loras/lyra_illustrious.safetensors",
          rank: 16,
          alpha: 16,
          recommendedStrength: 0.85,
          status: "active",
          createdAt: "",
          updatedAt: "",
        },
        {
          id: "adapter_sdxl",
          characterId: "char_test",
          baseModelFamily: "sdxl",
          triggerToken: "kirea_lyra",
          fileLocation: "loras/lyra_sdxl.safetensors",
          rank: 16,
          alpha: 16,
          recommendedStrength: 0.9,
          status: "active",
          createdAt: "",
          updatedAt: "",
        },
      ],
    };

    // When generating on illustrious, resolves the illustrious adapter
    const matchIllustrious = resolveCharacterAdapter(char, "illustrious");
    expect(matchIllustrious).not.toBeNull();
    expect(matchIllustrious?.id).toBe("adapter_illustrious");

    // When generating on sdxl, resolves the sdxl adapter
    const matchSdxl = resolveCharacterAdapter(char, "sdxl");
    expect(matchSdxl).not.toBeNull();
    expect(matchSdxl?.id).toBe("adapter_sdxl");

    // When generating on an unsupported architecture with no adapter, returns null
    const matchAnima = resolveCharacterAdapter(char, "anima");
    expect(matchAnima).toBeNull();
  });
});

describe("Character DNA System — Outfits Management", () => {
  it("creates, lists, and removes wardrobe outfits", () => {
    const repo = makeDb();
    const char = repo.saveCharacter({ name: "Kael" });

    const outfit1 = repo.saveOutfit({
      id: "outfit_combat",
      characterId: char.id,
      name: "Combat Tactical",
      description: "Tactical vest with cargo pants",
      promptTokens: ["tactical vest", "cargo pants", "fingerless gloves"],
      isDefault: true,
      previewImagePath: null,
    });
    expect(outfit1.name).toBe("Combat Tactical");

    const outfit2 = repo.saveOutfit({
      id: "outfit_formal",
      characterId: char.id,
      name: "Formal Kimono",
      description: "Midnight blue silk kimono",
      promptTokens: ["midnight blue kimono", "silk obi"],
      isDefault: false,
      previewImagePath: null,
    });
    expect(outfit2.name).toBe("Formal Kimono");

    const list = repo.listOutfits(char.id);
    expect(list).toHaveLength(2);
    expect(list[0]?.isDefault).toBe(true);

    const deleted = repo.deleteOutfit("outfit_combat");
    expect(deleted).toBe(true);
    expect(repo.listOutfits(char.id)).toHaveLength(1);
  });
});

describe("Character DNA System — Layer D: Knowledge & Persona", () => {
  it("persists structured character knowledge, dialogue, and relationships", () => {
    const repo = makeDb();

    const knowledge: CharacterKnowledge = {
      personality: "Analytical, quiet, fiercely protective of her crew.",
      speechStyle: "Precise, rarely uses contractions, speaks in low tones.",
      background: "Former neural engineer at Cyberdyne Neo-Tokyo.",
      history: "Defected during the 2182 AI uprising.",
      worldbuilding: "Set in Sector 7 under megacorp surveillance.",
      motivations: "Uncover the truth behind the Ghost Network.",
      likes: ["earl grey tea", "analog clocks"],
      dislikes: ["corrupt syndicates", "unencrypted transmissions"],
      rules: ["Never leaves a teammate behind", "Always carries two knives"],
      relationships: [
        {
          target: "Ren",
          relation: "Squad Leader",
          notes: "Trusted mentor and tactician.",
        },
      ],
      dialogueExamples: [
        {
          context: "Under enemy surveillance",
          quote: "Maintain radio silence. Their sensors are sweeping this frequency.",
        },
      ],
    };

    const saved = repo.saveCharacter({
      name: "Yuki",
      knowledge,
    });

    const retrieved = repo.getCharacterById(saved.id);
    expect(retrieved?.knowledge?.personality).toBe(knowledge.personality);
    expect(retrieved?.knowledge?.speechStyle).toBe(knowledge.speechStyle);
    expect(retrieved?.knowledge?.relationships?.[0]?.target).toBe("Ren");
    expect(retrieved?.knowledge?.dialogueExamples?.[0]?.quote).toContain("Maintain radio silence");
  });
});

describe("DatasetBuilder & Captions", () => {
  it("generates structured training captions with separated identity, clothing, and environment tokens", () => {
    const char: CharacterProfile = {
      id: "char_1",
      name: "Maya",
      description: "",
      appearance: "",
      clothing: "black biker jacket",
      promptPrefix: "",
      negativePrompt: "",
      triggerWords: ["kirea_maya"],
      architecture: "illustrious",
      checkpointPath: null,
      checkpointName: null,
      loraRecipeId: null,
      referenceMode: "none",
      referenceWeight: 0.75,
      referenceStart: 0,
      referenceEnd: 1,
      tags: [],
      usageCount: 0,
      lastUsedAt: null,
      favorite: false,
      createdAt: "",
      updatedAt: "",
      references: [],
      dna: {
        triggerToken: "kirea_maya",
        ageCategory: "Adult",
        species: "Human",
        facialCharacteristics: "",
        hairColor: "crimson",
        hairStyle: "asymmetrical bob",
        eyeColor: "gold",
        skinTone: "tanned",
        distinctiveFeatures: ["scar over eyebrow"],
        signatureAccessories: ["silver chain necklace"],
        bodyCharacteristics: "",
        canonicalDescription: "",
        fixedTraits: [],
        variableTraits: [],
        preferredStyle: "",
        negativeConstraints: "",
        dnaLocked: true,
      },
    };

    const ref: CharacterReference = {
      id: "ref_1",
      characterId: "char_1",
      role: "primary",
      category: "canonical_face",
      filePath: "/path/to/img.png",
      sourcePath: null,
      caption: "",
      weight: 1,
      position: 0,
      createdAt: "",
    };

    const caption = DatasetBuilder.generateCaption(char, ref);
    expect(caption.identityTokens).toContain("kirea_maya");
    expect(caption.identityTokens).toContain("crimson hair");
    expect(caption.identityTokens).toContain("gold eyes");
    expect(caption.identityTokens).toContain("scar over eyebrow");
    expect(caption.clothingTokens).toContain("black biker jacket");
    expect(caption.environmentTokens).toContain("front view");
    expect(caption.environmentTokens).toContain("close-up portrait");

    // Full caption puts identity tokens first without duplicates
    expect(caption.fullCaption.startsWith("kirea_maya")).toBe(true);
  });

  it("validates dataset metrics and detects category balance and duplicates", () => {
    const items: DatasetItem[] = [
      {
        referenceId: "r1",
        filePath: "/mock/img1.png",
        caption: "kirea_char, front portrait, blue eyes",
        identityTokens: ["kirea_char"],
        clothingTokens: [],
        environmentTokens: ["front view"],
        category: "canonical_face",
        selected: true,
      },
      {
        referenceId: "r2",
        filePath: "/mock/img2.png",
        caption: "kirea_char, upper body, expression",
        identityTokens: ["kirea_char"],
        clothingTokens: [],
        environmentTokens: ["upper body"],
        category: "expression",
        selected: true,
      },
      {
        referenceId: "r3",
        filePath: "/mock/img3.png",
        caption: "kirea_char, full body standing",
        identityTokens: ["kirea_char"],
        clothingTokens: [],
        environmentTokens: ["full body"],
        category: "full_body",
        selected: true,
      },
    ];

    const report = DatasetBuilder.validateDataset(items);
    expect(report.totalImages).toBe(3);
    expect(report.selectedImages).toBe(3);
    expect(report.isValid).toBe(true);
    expect(report.categoriesPresent["canonical_face"]).toBe(1);
    expect(report.categoriesPresent["expression"]).toBe(1);
    expect(report.captionCoveragePercent).toBe(100);
  });
});

describe("Creation Studio Prompt Composition & Integration", () => {
  it("composes character prompt by placing trigger token and fixed traits first without duplicate tokens", () => {
    const char: Pick<
      CharacterProfile,
      "promptPrefix" | "appearance" | "clothing" | "triggerWords" | "dna" | "outfits" | "activeOutfitId"
    > = {
      promptPrefix: "",
      appearance: "",
      clothing: "",
      triggerWords: [],
      dna: {
        triggerToken: "kirea_valerie",
        ageCategory: "Adult",
        species: "Human",
        facialCharacteristics: "",
        hairColor: "silver",
        hairStyle: "braided hair",
        eyeColor: "emerald",
        skinTone: "pale",
        bodyCharacteristics: "",
        canonicalDescription: "",
        fixedTraits: [],
        variableTraits: [],
        preferredStyle: "",
        negativeConstraints: "",
        distinctiveFeatures: ["freckles"],
        signatureAccessories: ["gold goggles"],
        dnaLocked: true,
      },
      outfits: [
        {
          id: "outfit_steampunk",
          characterId: "char_1",
          name: "Steampunk Pilot",
          description: "leather pilot jacket, brass gear brooch",
          promptTokens: ["leather pilot jacket", "brass brooch"],
          isDefault: true,
          createdAt: "",
          updatedAt: "",
        },
      ],
      activeOutfitId: "outfit_steampunk",
    };

    const userPrompt = "sitting in a cozy cafe, drinking tea, silver hair";
    const composed = composeCharacterPrompt(char, userPrompt);

    // Trigger token placed first
    expect(composed.startsWith("kirea_valerie")).toBe(true);
    // Includes fixed traits
    expect(composed).toContain("emerald eyes");
    expect(composed).toContain("freckles");
    // Includes outfit tokens
    expect(composed).toContain("leather pilot jacket");
    // Does not duplicate "silver hair" which user already wrote
    const occurrences = (composed.match(/silver hair/gi) || []).length;
    expect(occurrences).toBe(1);
  });

  it("removes identity tokens symmetrically when deselecting character", () => {
    const char: Pick<
      CharacterProfile,
      "promptPrefix" | "appearance" | "clothing" | "triggerWords" | "dna" | "outfits" | "activeOutfitId"
    > = {
      promptPrefix: "",
      appearance: "",
      clothing: "",
      triggerWords: [],
      dna: {
        triggerToken: "kirea_alex",
        ageCategory: "Adult",
        species: "Human",
        facialCharacteristics: "",
        hairColor: "neon pink",
        hairStyle: "undercut",
        eyeColor: "violet",
        skinTone: "fair",
        bodyCharacteristics: "",
        canonicalDescription: "",
        fixedTraits: [],
        variableTraits: [],
        preferredStyle: "",
        negativeConstraints: "",
        distinctiveFeatures: [],
        signatureAccessories: [],
        dnaLocked: true,
      },
    };

    const composed = "kirea_alex, neon pink hair, undercut, violet eyes, raining neon city street, cyberpunk";
    const cleaned = removeCharacterIdentityTokens(composed, char);

    expect(cleaned).not.toContain("kirea_alex");
    expect(cleaned).not.toContain("neon pink hair");
    expect(cleaned).not.toContain("undercut");
    expect(cleaned).not.toContain("violet eyes");
    expect(cleaned).toContain("raining neon city street");
    expect(cleaned).toContain("cyberpunk");
  });

  it("injects gender tokens correctly for female, male, femboy, and transgender characters", () => {
    const makeChar = (gender: string) => ({
      dna: {
        triggerToken: "kirea_test",
        gender,
        ageCategory: "Adult",
        species: "Human",
        facialCharacteristics: "",
        hairColor: "black",
        hairStyle: "short",
        eyeColor: "brown",
        skinTone: "fair",
        bodyCharacteristics: "",
        canonicalDescription: "",
        fixedTraits: [],
        variableTraits: [],
        preferredStyle: "",
        negativeConstraints: "",
        distinctiveFeatures: [],
        signatureAccessories: [],
        dnaLocked: true,
      },
    });

    expect(composeCharacterPrompt(makeChar("Female") as any, "smiling")).toContain("1girl");
    expect(composeCharacterPrompt(makeChar("Male") as any, "smiling")).toContain("1boy");
    expect(composeCharacterPrompt(makeChar("Femboy") as any, "smiling")).toContain("Femboy");
    expect(composeCharacterPrompt(makeChar("Transgender") as any, "smiling")).toContain("Transgender");
  });
});
