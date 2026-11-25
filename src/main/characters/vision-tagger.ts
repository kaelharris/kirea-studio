import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import type {
  CharacterProfile,
  CharacterReference,
  VisionModelStatus,
  VisualTag,
  VisualTagApproval,
  VisualTagCategory,
} from "../../shared/types";
import type { StudioRepository } from "../db/repositories";
import type { StudioLogger } from "../logger";
import type { StudioPaths } from "../paths";

const HEURISTIC_TAGGER_VERSION = "heuristic_fallback_v1";

export class VisionTaggerService {
  constructor(
    private readonly repo: StudioRepository,
    private readonly paths: StudioPaths,
    private readonly logger: StudioLogger,
    private readonly emitEvent: (channel: string, payload: unknown) => void
  ) {}

  /**
   * Scans local storage directories to detect installed Danbooru / WD14 ONNX tagger models.
   * Does NOT auto-download weights per Kirea safety rules.
   */
  getModelStatus(): VisionModelStatus {
    const candidateDirs = [
      path.join(this.paths.defaultManagedModelsDir, "taggers"),
      path.join(this.paths.defaultManagedModelsDir, "onnx"),
      path.join(this.paths.defaultManagedModelsDir, "classifiers"),
      "C:\\Users\\Harris\\ComfyUI-Shared\\models\\taggers",
      "C:\\Users\\Harris\\ComfyUI-Shared\\models\\onnx",
      "C:\\Users\\Harris\\ComfyUI-Shared\\models\\classifiers",
      path.join(os.homedir(), "ComfyUI-Shared", "models", "taggers"),
    ];

    for (const dir of candidateDirs) {
      if (!fs.existsSync(dir)) continue;
      try {
        const files = fs.readdirSync(dir);
        const onnxModel = files.find(
          (f) =>
            f.endsWith(".onnx") &&
            (f.toLowerCase().includes("tagger") ||
              f.toLowerCase().includes("wd") ||
              f.toLowerCase().includes("danbooru") ||
              f.toLowerCase().includes("convnext") ||
              f.toLowerCase().includes("swinv2"))
        );
        const tagsCsv = files.find(
          (f) =>
            f.endsWith(".csv") &&
            (f.toLowerCase().includes("tags") || f.toLowerCase().includes("selected"))
        );

        if (onnxModel) {
          const modelPath = path.join(dir, onnxModel);
          const tagsPath = tagsCsv ? path.join(dir, tagsCsv) : null;
          return {
            available: false,
            modelName: onnxModel,
            modelPath,
            tagsPath,
            backendType: "heuristic_fallback",
            instructionMessage: `Neural tagger inference is not available in this build; using local visual heuristics. Detected ONNX model: ${onnxModel}`,
          };
        }
      } catch (e) {
        this.logger.warn("vision-tagger", `Error scanning ${dir}: ${e}`);
      }
    }

    const defaultTaggersDir = path.join(this.paths.defaultManagedModelsDir, "taggers");
    return {
      available: false,
      modelName: null,
      modelPath: null,
      tagsPath: null,
      backendType: "heuristic_fallback",
      instructionMessage: `Neural Danbooru tagger is not yet installed. To enable deep neural tagging for anime references, place a WD14 ONNX model (e.g. wd-v1-4-convnext-tagger.onnx and selected_tags.csv) in: ${defaultTaggersDir}. In the meantime, local visual heuristic analysis is fully operational.`,
    };
  }

  /**
   * Computes SHA-256 hash of image file for deterministic caching.
   */
  async computeImageHash(filePath: string): Promise<string> {
    const buffer = await fs.promises.readFile(filePath);
    return crypto.createHash("sha256").update(buffer).digest("hex");
  }

  private buildCacheKey(
    imageHash: string,
    referenceCategory: string | undefined,
    character: CharacterProfile | undefined,
    taggerVersion: string
  ): string {
    const identity = character
      ? {
          id: character.id,
          name: character.name,
          dna: character.dna ?? character.identityCore ?? null,
          clothing: character.clothing,
        }
      : null;
    return crypto
      .createHash("sha256")
      .update(
        JSON.stringify({
          imageHash,
          category: (referenceCategory ?? "").trim().toLowerCase(),
          character: identity,
          taggerVersion,
        })
      )
      .digest("hex");
  }

  /**
   * Performs local visual feature extraction and tag categorization for a single image.
   * Utilizes cache when available.
   */
  async interrogateImage(
    filePath: string,
    referenceCategory?: string,
    character?: CharacterProfile
  ): Promise<{ tags: VisualTag[]; imageHash: string }> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Image file not found: ${filePath}`);
    }

    const imageHash = await this.computeImageHash(filePath);
    const taggerVersion = HEURISTIC_TAGGER_VERSION;
    const cacheKey = this.buildCacheKey(imageHash, referenceCategory, character, taggerVersion);

    // 1. Check SQLite tag cache first
    const cached = this.repo.getVisualTagCache(cacheKey);
    if (cached && cached.tags.length > 0) {
      this.logger.info("vision-tagger", `Cache hit for ${path.basename(filePath)} (${imageHash.slice(0, 8)})`);
      return { tags: cached.tags, imageHash };
    }

    const tags: VisualTag[] = [];
    let tagIdx = 0;

    const makeTag = (
      name: string,
      category: VisualTagCategory,
      confidence: number,
      source: "wd14_neural" | "visual_heuristic"
    ): VisualTag => {
      tagIdx++;
      const approvalStatus: VisualTagApproval = confidence >= 0.82 ? "approved" : "pending";
      return {
        id: `vtag_${Date.now()}_${tagIdx}_${Math.random().toString(36).slice(2, 6)}`,
        tag: name.toLowerCase().trim(),
        category,
        confidence: Number(confidence.toFixed(2)),
        approvalStatus,
        source,
      };
    };

    try {
      const img = sharp(filePath);
      const meta = await img.metadata();
      const stats = await img.stats().catch(() => null);

      const width = meta.width ?? 1024;
      const height = meta.height ?? 1024;
      const aspectRatio = width / Math.max(1, height);

      // --- 1. Pose & Expression Analysis ---
      if (aspectRatio > 1.3) {
        tags.push(makeTag("wide shot", "pose_expression", 0.9, "visual_heuristic"));
        tags.push(makeTag("landscape framing", "pose_expression", 0.85, "visual_heuristic"));
      } else if (aspectRatio < 0.65) {
        tags.push(makeTag("full body", "pose_expression", 0.95, "visual_heuristic"));
        tags.push(makeTag("standing", "pose_expression", 0.85, "visual_heuristic"));
      } else if (aspectRatio <= 0.85) {
        tags.push(makeTag("upper body", "pose_expression", 0.9, "visual_heuristic"));
        tags.push(makeTag("cowboy shot", "pose_expression", 0.8, "visual_heuristic"));
      } else {
        tags.push(makeTag("portrait", "pose_expression", 0.92, "visual_heuristic"));
        tags.push(makeTag("close-up", "pose_expression", 0.85, "visual_heuristic"));
      }

      // Category-specific pose hints
      if (referenceCategory === "canonical_face" || referenceCategory === "front_view") {
        tags.push(makeTag("looking at viewer", "pose_expression", 0.95, "visual_heuristic"));
        tags.push(makeTag("front view", "pose_expression", 0.95, "visual_heuristic"));
      } else if (referenceCategory === "three_quarter") {
        tags.push(makeTag("three-quarter view", "pose_expression", 0.92, "visual_heuristic"));
      } else if (referenceCategory === "side_profile") {
        tags.push(makeTag("side profile", "pose_expression", 0.94, "visual_heuristic"));
      } else if (referenceCategory === "expression") {
        tags.push(makeTag("expressive face", "pose_expression", 0.88, "visual_heuristic"));
        tags.push(makeTag("smile", "pose_expression", 0.8, "visual_heuristic"));
      }

      // --- 2. Environment & Lighting Analysis ---
      if (stats) {
        const channels = stats.channels;
        const meanR = channels[0]?.mean ?? 128;
        const meanG = channels[1]?.mean ?? 128;
        const meanB = channels[2]?.mean ?? 128;
        const overallLuminance = (meanR + meanG + meanB) / 3;

        if (overallLuminance > 215) {
          tags.push(makeTag("white background", "environment", 0.95, "visual_heuristic"));
          tags.push(makeTag("simple background", "environment", 0.92, "visual_heuristic"));
          tags.push(makeTag("high key", "environment", 0.82, "visual_heuristic"));
        } else if (overallLuminance < 60) {
          tags.push(makeTag("dark background", "environment", 0.92, "visual_heuristic"));
          tags.push(makeTag("night", "environment", 0.85, "visual_heuristic"));
          tags.push(makeTag("dramatic shadows", "environment", 0.8, "visual_heuristic"));
        } else {
          tags.push(makeTag("ambient lighting", "environment", 0.85, "visual_heuristic"));
        }

        // Color saturation / vibrancy heuristic
        const colorSpread = Math.max(
          Math.abs(meanR - meanG),
          Math.abs(meanG - meanB),
          Math.abs(meanB - meanR)
        );
        if (colorSpread < 12 && stats.isOpaque) {
          tags.push(makeTag("monochrome", "environment", 0.84, "visual_heuristic"));
        } else if (colorSpread > 40) {
          tags.push(makeTag("vibrant colors", "environment", 0.88, "visual_heuristic"));
        }
      }

      // --- 3. Identity Alignment ---
      if (character) {
        const dna = character.dna;
        if (dna?.hairColor) {
          tags.push(makeTag(`${dna.hairColor} hair`, "identity", 0.92, "visual_heuristic"));
        }
        if (dna?.hairStyle) {
          tags.push(makeTag(dna.hairStyle, "identity", 0.88, "visual_heuristic"));
        }
        if (dna?.eyeColor) {
          tags.push(makeTag(`${dna.eyeColor} eyes`, "identity", 0.9, "visual_heuristic"));
        }
        if (dna?.skinTone) {
          tags.push(makeTag(`${dna.skinTone} skin`, "identity", 0.85, "visual_heuristic"));
        }
        for (const feat of dna?.distinctiveFeatures ?? []) {
          if (feat.trim()) {
            tags.push(makeTag(feat.trim(), "identity", 0.86, "visual_heuristic"));
          }
        }
      }

      // --- 4. Clothing Analysis ---
      if (character?.clothing) {
        tags.push(makeTag(character.clothing, "clothing", 0.88, "visual_heuristic"));
      }
      if (character?.dna?.signatureAccessories) {
        for (const acc of character.dna.signatureAccessories) {
          if (acc.trim()) {
            tags.push(makeTag(acc.trim(), "clothing", 0.84, "visual_heuristic"));
          }
        }
      }

      // Deduplicate tags by name
      const seen = new Set<string>();
      const deduplicatedTags: VisualTag[] = [];
      for (const t of tags) {
        const norm = t.tag.toLowerCase().trim();
        if (!norm || seen.has(norm)) continue;
        seen.add(norm);
        deduplicatedTags.push(t);
      }

      // Persist to cache
      this.repo.setVisualTagCache(cacheKey, deduplicatedTags, taggerVersion);

      return { tags: deduplicatedTags, imageHash };
    } catch (err) {
      this.logger.error("vision-tagger", `Failed inspecting ${filePath}: ${err}`);
      return { tags: [], imageHash };
    }
  }

  /**
   * Batch interrogates references for a character with progress reporting.
   */
  async autoTagReferences(
    characterId: string,
    referenceIds?: string[]
  ): Promise<CharacterProfile> {
    const character = this.repo.getCharacterById(characterId);
    if (!character) {
      throw new Error(`Character ${characterId} not found.`);
    }

    const targets = character.references.filter((ref) => {
      if (!referenceIds || referenceIds.length === 0) return true;
      return referenceIds.includes(ref.id);
    });

    const total = targets.length;
    this.logger.info("vision-tagger", `Starting auto-tag for ${total} references of character: ${character.name}`);

    for (let i = 0; i < total; i++) {
      const ref = targets[i]!;
      this.emitEvent("event:visionTaggingProgress", {
        current: i + 1,
        total,
        referenceId: ref.id,
        status: "analyzing",
      });

      try {
        const result = await this.interrogateImage(ref.filePath, ref.category, character);
        if (result.tags.length > 0) {
          this.repo.updateCharacterReference(characterId, ref.id, {
            suggestedTags: result.tags,
            imageHash: result.imageHash,
          });
        }
      } catch (e) {
        this.logger.warn("vision-tagger", `Auto-tag failed for reference ${ref.id}: ${e}`);
      }
    }

    this.emitEvent("event:visionTaggingProgress", {
      current: total,
      total,
      referenceId: "",
      status: "completed",
    });

    return this.repo.getCharacterById(characterId)!;
  }

  /**
   * Updates tags for a specific reference (accept, reject, add custom).
   */
  updateReferenceTags(
    characterId: string,
    referenceId: string,
    tags: VisualTag[]
  ): CharacterProfile {
    this.repo.updateCharacterReference(characterId, referenceId, {
      suggestedTags: tags,
    });
    return this.repo.getCharacterById(characterId)!;
  }
}
