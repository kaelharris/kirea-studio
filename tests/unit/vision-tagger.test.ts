import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DatasetBuilder } from "../../src/main/characters/dataset-builder";
import { VisionTaggerService } from "../../src/main/characters/vision-tagger";
import { StudioDatabase } from "../../src/main/db/database";
import { StudioRepository } from "../../src/main/db/repositories";
import type {
  CharacterProfile,
  CharacterReference,
  VisualTag,
} from "../../src/shared/types";

const tempDirs: string[] = [];
const openDbs: StudioDatabase[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kirea-vision-test-"));
  tempDirs.push(dir);
  return dir;
}

function makeDb(): { repo: StudioRepository; db: StudioDatabase } {
  const db = new StudioDatabase(":memory:");
  openDbs.push(db);
  return { repo: new StudioRepository(db), db };
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

describe("Vision Tag Interrogation Service", () => {
  it("detects when local neural tagger is missing and provides clear instructional notice", () => {
    const { repo } = makeDb();
    const tempDir = makeTempDir();

    const mockPaths = {
      defaultManagedModelsDir: tempDir,
    } as any;
    const mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as any;
    const emitEvent = vi.fn();

    const tagger = new VisionTaggerService(repo, mockPaths, mockLogger, emitEvent);
    const status = tagger.getModelStatus();

    expect(status.available).toBe(false);
    expect(status.backendType).toBe("heuristic_fallback");
    expect(status.instructionMessage).toContain("WD14 ONNX model");
  });

  it("reports heuristic fallback when WD14 files exist but neural inference is unavailable", () => {
    const { repo } = makeDb();
    const tempDir = makeTempDir();

    const taggersDir = path.join(tempDir, "taggers");
    fs.mkdirSync(taggersDir, { recursive: true });
    fs.writeFileSync(path.join(taggersDir, "wd-v1-4-convnext-tagger.onnx"), "mock onnx weights");
    fs.writeFileSync(path.join(taggersDir, "selected_tags.csv"), "tag_id,name,category,count\n1,1girl,0,1000\n");

    const mockPaths = {
      defaultManagedModelsDir: tempDir,
    } as any;
    const mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as any;
    const emitEvent = vi.fn();

    const tagger = new VisionTaggerService(repo, mockPaths, mockLogger, emitEvent);
    const status = tagger.getModelStatus();

    expect(status.available).toBe(false);
    expect(status.backendType).toBe("heuristic_fallback");
    expect(status.modelName).toBe("wd-v1-4-convnext-tagger.onnx");
    expect(status.tagsPath).toBe(path.join(taggersDir, "selected_tags.csv"));
    expect(status.instructionMessage).toContain("inference is not available");
  });

  it("computes deterministic SHA-256 hash for image files", async () => {
    const { repo } = makeDb();
    const tempDir = makeTempDir();
    const imagePath = path.join(tempDir, "sample.png");

    await sharp({
      create: {
        width: 100,
        height: 100,
        channels: 3,
        background: { r: 255, g: 0, b: 0 },
      },
    })
      .png()
      .toFile(imagePath);

    const mockPaths = { defaultManagedModelsDir: tempDir } as any;
    const tagger = new VisionTaggerService(repo, mockPaths, { info: vi.fn(), warn: vi.fn() } as any, vi.fn());

    const hash1 = await tagger.computeImageHash(imagePath);
    const hash2 = await tagger.computeImageHash(imagePath);

    expect(hash1).toBeDefined();
    expect(hash1.length).toBe(64); // SHA-256 hex string
    expect(hash1).toBe(hash2);
  });

  it("interrogates image features, categorizes tags, and caches in visual_tag_cache", async () => {
    const { repo } = makeDb();
    const tempDir = makeTempDir();

    // Create a tall portrait image (e.g. 512x1024)
    const portraitPath = path.join(tempDir, "portrait.png");
    await sharp({
      create: {
        width: 512,
        height: 1024,
        channels: 3,
        background: { r: 240, g: 240, b: 240 },
      },
    })
      .png()
      .toFile(portraitPath);

    const mockPaths = { defaultManagedModelsDir: tempDir } as any;
    const tagger = new VisionTaggerService(repo, mockPaths, { info: vi.fn(), warn: vi.fn() } as any, vi.fn());
    const cacheWrites = vi.spyOn(repo, "setVisualTagCache");

    const result = await tagger.interrogateImage(portraitPath);

    expect(result.imageHash).toBeDefined();
    expect(result.tags.length).toBeGreaterThan(0);

    // Should classify as full body / standing for tall framing
    const tagNames = result.tags.map((t) => t.tag);
    expect(tagNames).toContain("full body");
    expect(tagNames).toContain("standing");

    // Check categories
    const categories = new Set(result.tags.map((t) => t.category));
    expect(categories.has("pose_expression") || categories.has("environment")).toBe(true);

    // Cache identity is context-sensitive while the returned content hash stays stable.
    expect(cacheWrites).toHaveBeenCalledTimes(1);
    const [cacheKey, , taggerVersion] = cacheWrites.mock.calls[0]!;
    expect(cacheKey).toMatch(/^[a-f0-9]{64}$/);
    expect(cacheKey).not.toBe(result.imageHash);
    expect(taggerVersion).toBe("heuristic_fallback_v1");
    const cached = repo.getVisualTagCache(cacheKey);
    expect(cached?.tags.length).toBe(result.tags.length);
    expect(cached?.taggerVersion).toBe("heuristic_fallback_v1");

    // Second interrogation on the same file and context should hit cache.
    const secondResult = await tagger.interrogateImage(portraitPath);
    expect(secondResult.tags.length).toBe(result.tags.length);
    expect(cacheWrites).toHaveBeenCalledTimes(1);
  });

  it("separates heuristic cache entries by category and character without claiming neural inference", async () => {
    const { repo } = makeDb();
    const tempDir = makeTempDir();
    const imagePath = path.join(tempDir, "shared-reference.png");
    await sharp({
      create: {
        width: 512,
        height: 512,
        channels: 3,
        background: { r: 120, g: 120, b: 120 },
      },
    })
      .png()
      .toFile(imagePath);

    const taggersDir = path.join(tempDir, "taggers");
    fs.mkdirSync(taggersDir, { recursive: true });
    fs.writeFileSync(path.join(taggersDir, "wd-v1-4-convnext-tagger.onnx"), "mock onnx weights");

    const tagger = new VisionTaggerService(
      repo,
      { defaultManagedModelsDir: tempDir } as any,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any,
      vi.fn()
    );
    const cacheWrites = vi.spyOn(repo, "setVisualTagCache");
    const silverHero = {
      id: "char-silver",
      name: "Silver Hero",
      clothing: "white coat",
      dna: { hairColor: "silver" },
    } as CharacterProfile;
    const crimsonHero = {
      id: "char-crimson",
      name: "Crimson Hero",
      clothing: "black coat",
      dna: { hairColor: "crimson" },
    } as CharacterProfile;

    const uncategorized = await tagger.interrogateImage(imagePath);
    const face = await tagger.interrogateImage(imagePath, "canonical_face");
    const silver = await tagger.interrogateImage(imagePath, "canonical_face", silverHero);
    const crimson = await tagger.interrogateImage(imagePath, "canonical_face", crimsonHero);

    expect(new Set([uncategorized.imageHash, face.imageHash, silver.imageHash, crimson.imageHash]).size).toBe(1);
    expect(cacheWrites).toHaveBeenCalledTimes(4);
    const cacheKeys = cacheWrites.mock.calls.map(([key]) => key);
    expect(new Set(cacheKeys).size).toBe(4);
    expect(cacheKeys.every((key) => /^[a-f0-9]{64}$/.test(key))).toBe(true);
    expect(cacheWrites.mock.calls.every(([, , version]) => version === "heuristic_fallback_v1")).toBe(true);
    expect(face.tags.map((tag) => tag.tag)).toContain("looking at viewer");
    expect(silver.tags.map((tag) => tag.tag)).toContain("silver hair");
    expect(crimson.tags.map((tag) => tag.tag)).toContain("crimson hair");
    expect([...uncategorized.tags, ...face.tags, ...silver.tags, ...crimson.tags].every(
      (tag) => tag.source === "visual_heuristic"
    )).toBe(true);
  });

  it("updates reference tags with approvals, rejections, and custom tags", async () => {
    const { repo } = makeDb();
    const tempDir = makeTempDir();

    const mockPaths = { defaultManagedModelsDir: tempDir } as any;
    const tagger = new VisionTaggerService(repo, mockPaths, { info: vi.fn(), warn: vi.fn() } as any, vi.fn());

    const dummyImg = path.join(tempDir, "test.png");
    fs.writeFileSync(dummyImg, "mock content");

    const char = {
      id: "char_tag_test",
      name: "Kirea Hero",
      triggerWords: ["kirea_hero"],
      description: "Tag test",
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      identityCore: {
        triggerToken: "kirea_hero",
        hairColor: "silver",
        eyeColor: "amber",
      },
      visualMemory: [],
      modelMemory: [],
      characterKnowledge: { rules: [], dialogueExamples: [] },
      references: [],
    } as any;

    repo.saveCharacter(char);

    const addedRef = repo.addCharacterReference({
      characterId: "char_tag_test",
      filePath: dummyImg,
      category: "canonical_face",
      approvalStatus: "approved",
      suggestedTags: [
        {
          id: "t1",
          tag: "amber eyes",
          category: "identity",
          confidence: 0.95,
          source: "visual_heuristic",
          approvalStatus: "pending",
        },
        {
          id: "t2",
          tag: "cyberpunk jacket",
          category: "clothing",
          confidence: 0.88,
          source: "visual_heuristic",
          approvalStatus: "pending",
        },
      ],
    });

    // Approve tag 1, reject tag 2, add new manual tag
    const updatedTags: VisualTag[] = [
      {
        id: "t1",
        tag: "amber eyes",
        category: "identity",
        confidence: 0.95,
        source: "visual_heuristic",
        approvalStatus: "approved",
      },
      {
        id: "t2",
        tag: "cyberpunk jacket",
        category: "clothing",
        confidence: 0.88,
        source: "visual_heuristic",
        approvalStatus: "rejected",
      },
      {
        id: "t3",
        tag: "neon katana",
        category: "clothing",
        confidence: 1.0,
        source: "manual",
        approvalStatus: "approved",
      },
    ];

    const updatedChar = await tagger.updateReferenceTags("char_tag_test", addedRef.id, updatedTags);
    const ref = updatedChar.references.find((r) => r.id === addedRef.id);
    expect(ref?.suggestedTags).toBeDefined();
    expect(ref?.suggestedTags?.length).toBe(3);

    const approvedTags = ref?.suggestedTags?.filter((t) => t.approvalStatus === "approved");
    expect(approvedTags?.length).toBe(2);
    expect(approvedTags?.some((t) => t.tag === "neon katana")).toBe(true);
  });

  it("incorporates approved tags into dataset captions while omitting pending and rejected tags", () => {
    const char = {
      id: "char_dataset_tag_test",
      name: "Aria Valkyrie",
      triggerWords: ["aria_valkyrie"],
      description: "Dataset tag integration test",
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      identityCore: {
        triggerToken: "aria_valkyrie",
        species: "Human",
        hairColor: "crimson hair",
        eyeColor: "emerald eyes",
        fixedTraits: ["long braided hair"],
        variableTraits: ["flight jacket"],
      },
      visualMemory: [],
      modelMemory: [],
      characterKnowledge: { rules: [], dialogueExamples: [] },
      references: [],
    } as any;

    const refWithTags = {
      id: "ref_caption_test",
      characterId: "char_dataset_tag_test",
      filePath: "aria.png",
      category: "full_body",
      approvalStatus: "approved",
      suggestedTags: [
        {
          id: "tag_approved_id",
          tag: "cybernetic visor",
          category: "identity",
          confidence: 0.92,
          source: "visual_heuristic",
          approvalStatus: "approved",
        },
        {
          id: "tag_approved_cloth",
          tag: "tactical armor",
          category: "clothing",
          confidence: 0.85,
          source: "visual_heuristic",
          approvalStatus: "approved",
        },
        {
          id: "tag_rejected_cloth",
          tag: "swimsuit",
          category: "clothing",
          confidence: 0.3,
          source: "visual_heuristic",
          approvalStatus: "rejected",
        },
        {
          id: "tag_pending_env",
          tag: "city skyline",
          category: "environment",
          confidence: 0.5,
          source: "visual_heuristic",
          approvalStatus: "pending",
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const captionRes = DatasetBuilder.generateCaption(char, refWithTags as any);
    const caption = captionRes.fullCaption;

    // Caption should include trigger token and canonical identity
    expect(caption).toContain("aria_valkyrie");
    expect(caption).toContain("crimson hair");
    expect(caption).toContain("emerald eyes");

    // Caption should include APPROVED suggested tags
    expect(caption).toContain("cybernetic visor");
    expect(caption).toContain("tactical armor");

    // Caption should NEVER include rejected or pending tags
    expect(caption).not.toContain("swimsuit");
    expect(caption).not.toContain("city skyline");

    // Canonical character identity should remain intact (not mutated)
    expect(char.identityCore?.fixedTraits).toEqual(["long braided hair"]);
  });
});
