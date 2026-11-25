import fs from "node:fs";
import path from "node:path";
import type {
  CharacterDataset,
  CharacterIdentityCore,
  CharacterProfile,
  CharacterReference,
  DatasetItem,
  DatasetValidationReport,
} from "../../shared/types";

export class DatasetBuilder {
  /**
   * Generates intelligent, structured training captions distinguishing:
   * 1. Identity traits (trigger token, hair, eyes, distinctive features)
   * 2. Variable appearance (outfit, pose, category)
   * 3. Environment (background, style)
   */
  static generateCaption(
    character: CharacterProfile,
    reference: CharacterReference,
    outfitName?: string
  ): {
    fullCaption: string;
    identityTokens: string[];
    clothingTokens: string[];
    environmentTokens: string[];
  } {
    const dna = character.dna || character.identityCore;
    const triggerToken =
      dna?.triggerToken ||
      character.triggerWords?.[0] ||
      `kirea_${character.name.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;

    const identityTokens: string[] = [triggerToken];

    if (dna?.hairColor) identityTokens.push(`${dna.hairColor} hair`);
    if (dna?.hairStyle) identityTokens.push(dna.hairStyle);
    if (dna?.eyeColor) identityTokens.push(`${dna.eyeColor} eyes`);
    if (dna?.skinTone) identityTokens.push(`${dna.skinTone} skin`);
    if (dna?.species && dna.species.toLowerCase() !== "human") {
      identityTokens.push(dna.species);
    }
    for (const feat of dna?.distinctiveFeatures ?? []) {
      if (feat.trim()) identityTokens.push(feat.trim());
    }

    const clothingTokens: string[] = [];
    if (outfitName) {
      clothingTokens.push(outfitName);
    } else if (character.clothing) {
      clothingTokens.push(character.clothing);
    }
    for (const acc of dna?.signatureAccessories ?? []) {
      if (acc.trim()) clothingTokens.push(acc.trim());
    }

    const environmentTokens: string[] = [];
    // Category hints
    switch (reference.category) {
      case "canonical_face":
      case "front_view":
        environmentTokens.push("front view", "close-up portrait");
        break;
      case "three_quarter":
        environmentTokens.push("three-quarter view", "upper body");
        break;
      case "side_profile":
        environmentTokens.push("side profile");
        break;
      case "full_body":
        environmentTokens.push("full body", "standing");
        break;
      case "expression":
        environmentTokens.push("expressive portrait");
        break;
      case "pose":
        environmentTokens.push("dynamic pose");
        break;
      case "clothing_variant":
        environmentTokens.push("outfit showcase");
        break;
      default:
        break;
    }

    if (reference.caption?.trim()) {
      environmentTokens.push(reference.caption.trim());
    }

    // Integrate approved vision tags without mutating canonical Character DNA
    if (reference.suggestedTags && reference.suggestedTags.length > 0) {
      for (const vt of reference.suggestedTags) {
        if (vt.approvalStatus === "approved") {
          const t = vt.tag.trim();
          if (!t) continue;
          if (vt.category === "identity") {
            identityTokens.push(t);
          } else if (vt.category === "clothing") {
            clothingTokens.push(t);
          } else if (vt.category === "pose_expression" || vt.category === "environment") {
            environmentTokens.push(t);
          }
        }
      }
    }

    const allTokens = [
      ...identityTokens,
      ...clothingTokens,
      ...environmentTokens,
    ];

    // Deduplicate tokens case-insensitively while preserving formatting
    const seen = new Set<string>();
    const deduplicated: string[] = [];
    for (const t of allTokens) {
      const normalized = t.toLowerCase().trim();
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      deduplicated.push(t.trim());
    }

    return {
      fullCaption: deduplicated.join(", "),
      identityTokens,
      clothingTokens,
      environmentTokens,
    };
  }

  /**
   * Builds an active dataset manifest from character references
   */
  static buildDatasetItems(
    character: CharacterProfile,
    filterApprovedOnly = true
  ): DatasetItem[] {
    const refs = character.references.filter((ref) => {
      if (ref.includedInTraining === false) return false;
      if (ref.approvalStatus === "rejected") return false;
      if (filterApprovedOnly && ref.approvalStatus !== "approved") return false;
      return true;
    });

    const outfitsMap = new Map((character.outfits ?? []).map((o) => [o.id, o.name]));

    return refs.map((ref) => {
      const outfitName = ref.associatedOutfitId
        ? outfitsMap.get(ref.associatedOutfitId)
        : undefined;

      const generated = this.generateCaption(character, ref, outfitName);
      const activeCaption = ref.caption?.trim()
        ? `${character.dna?.triggerToken || character.triggerWords[0] || character.name}, ${ref.caption.trim()}`
        : generated.fullCaption;

      return {
        referenceId: ref.id,
        filePath: ref.filePath,
        caption: activeCaption,
        identityTokens: generated.identityTokens,
        clothingTokens: generated.clothingTokens,
        environmentTokens: generated.environmentTokens,
        category: ref.category ?? "other",
        width: ref.width ?? undefined,
        height: ref.height ?? undefined,
        aspectRatio: ref.aspectRatio ?? undefined,
        selected: ref.approvalStatus === "approved" || ref.approvalStatus === "pending",
      };
    });
  }

  /**
   * Validates dataset quality, balance, and diversity before LoRA training
   */
  static validateDataset(items: DatasetItem[]): DatasetValidationReport {
    const selected = items.filter((i) => i.selected);
    const totalImages = items.length;
    const selectedImages = selected.length;

    const categoriesPresent: Record<string, number> = {};
    const aspectRatiosPresent: Record<string, number> = {};
    let captionsCount = 0;

    for (const item of selected) {
      categoriesPresent[item.category] = (categoriesPresent[item.category] ?? 0) + 1;
      const ar = item.aspectRatio || (item.width && item.height ? `${item.width}:${item.height}` : "unknown");
      aspectRatiosPresent[ar] = (aspectRatiosPresent[ar] ?? 0) + 1;
      if (item.caption && item.caption.trim().length > 5) {
        captionsCount++;
      }
    }

    const captionCoveragePercent =
      selectedImages > 0 ? Math.round((captionsCount / selectedImages) * 100) : 0;

    // Duplicate detection based on identical file paths or identical dimensions/names
    const duplicatesDetected: Array<{ idA: string; idB: string; reason: string }> = [];
    for (let i = 0; i < selected.length; i++) {
      for (let j = i + 1; j < selected.length; j++) {
        const a = selected[i]!;
        const b = selected[j]!;
        if (a.filePath.toLowerCase() === b.filePath.toLowerCase()) {
          duplicatesDetected.push({
            idA: a.referenceId,
            idB: b.referenceId,
            reason: "Identical file path",
          });
        }
      }
    }

    const warnings: string[] = [];
    const suggestions: string[] = [];

    if (selectedImages < 4) {
      warnings.push(`Dataset contains only ${selectedImages} image(s). Recommended minimum is 6-15 curated references.`);
    }

    if (captionCoveragePercent < 80) {
      warnings.push(`Only ${captionCoveragePercent}% of images have descriptive captions.`);
    }

    // Category diversity suggestions
    const hasFace = (categoriesPresent["canonical_face"] ?? 0) > 0 || (categoriesPresent["front_view"] ?? 0) > 0;
    const hasThreeQuarter = (categoriesPresent["three_quarter"] ?? 0) > 0;
    const hasFullBody = (categoriesPresent["full_body"] ?? 0) > 0;

    if (!hasFace) {
      suggestions.push("Adding a clear front-facing portrait will significantly stabilize facial likeness.");
    }
    if (!hasThreeQuarter) {
      suggestions.push("Adding three-quarter angle references helps the model generalize across camera perspectives.");
    }
    if (!hasFullBody) {
      suggestions.push("Adding full-body shots ensures the model understands proportions and signature footwear/clothing.");
    }

    const isValid = selectedImages >= 2 && duplicatesDetected.length === 0;

    return {
      isValid,
      totalImages,
      selectedImages,
      categoriesPresent,
      aspectRatiosPresent,
      duplicatesDetected,
      captionCoveragePercent,
      warnings,
      suggestions,
    };
  }

  /**
   * Exports a prepared training dataset to disk:
   * Copies images and writes matching `.txt` captions.
   */
  static async exportDatasetToDisk(
    destinationDir: string,
    items: DatasetItem[],
    characterName: string
  ): Promise<{ exportedCount: number; destinationDir: string }> {
    await fs.promises.mkdir(destinationDir, { recursive: true });

    let count = 0;
    const manifest: Array<{ index: number; file: string; caption: string; category: string }> = [];

    for (let idx = 0; idx < items.length; idx++) {
      const item = items[idx]!;
      if (!item.selected) continue;
      if (!fs.existsSync(item.filePath)) continue;

      const ext = path.extname(item.filePath).toLowerCase() || ".png";
      const padIndex = String(count + 1).padStart(3, "0");
      const baseName = `${characterName.toLowerCase().replace(/[^a-z0-9]/g, "_")}_${padIndex}`;
      const targetImgPath = path.join(destinationDir, `${baseName}${ext}`);
      const targetTxtPath = path.join(destinationDir, `${baseName}.txt`);

      await fs.promises.copyFile(item.filePath, targetImgPath);
      await fs.promises.writeFile(targetTxtPath, item.caption.trim(), "utf8");

      manifest.push({
        index: count + 1,
        file: `${baseName}${ext}`,
        caption: item.caption.trim(),
        category: item.category,
      });

      count++;
    }

    const manifestPath = path.join(destinationDir, "dataset_manifest.json");
    await fs.promises.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

    return { exportedCount: count, destinationDir };
  }
}
