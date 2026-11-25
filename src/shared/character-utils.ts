import type {
  CharacterAdapter,
  CharacterOutfit,
  CharacterProfile,
  CharacterReference,
  CharacterReferenceApproval,
  CharacterReferenceCategory,
  CharacterReferenceMode,
  CharacterReferenceRole,
  ModelArchitecture,
} from "./types";

export const CHARACTER_REFERENCE_MODE_LABELS: Record<CharacterReferenceMode, string> = {
  none: "Identity text only",
  img2img: "Img2Img reference",
  ipadapter: "IPAdapter (not installed)",
  controlnet: "ControlNet (not installed)",
};

export const CHARACTER_REFERENCE_ROLE_LABELS: Record<CharacterReferenceRole, string> = {
  primary: "Primary",
  secondary: "Secondary",
  expression: "Expression",
  outfit: "Outfit",
  pose: "Pose",
};

export const CHARACTER_REFERENCE_CATEGORY_LABELS: Record<CharacterReferenceCategory, string> = {
  canonical_face: "Canonical Face",
  front_view: "Front View",
  three_quarter: "3/4 View",
  side_profile: "Side Profile",
  full_body: "Full Body",
  expression: "Expression",
  pose: "Pose",
  clothing_variant: "Clothing Variant",
  approved_artwork: "Approved Artwork",
  other: "Other Reference",
};

export const CHARACTER_REFERENCE_APPROVAL_LABELS: Record<CharacterReferenceApproval, string> = {
  approved: "Approved",
  pending: "Pending Review",
  rejected: "Rejected",
};

const CHARACTER_REFERENCE_DENOISE_MIN = 0.35;
const CHARACTER_REFERENCE_DENOISE_MAX = 0.75;

export function characterReferenceDenoise(referenceWeight: number): number {
  const clamped = Math.min(1, Math.max(0, referenceWeight));
  const denoise =
    CHARACTER_REFERENCE_DENOISE_MAX -
    clamped * (CHARACTER_REFERENCE_DENOISE_MAX - CHARACTER_REFERENCE_DENOISE_MIN);
  return Number(denoise.toFixed(2));
}

export function getPrimaryCharacterReference(
  character: Pick<CharacterProfile, "references">
): CharacterReference | null {
  return character.references.find((ref) => ref.role === "primary") ?? null;
}

export function getCharacterCoverReference(
  character: Pick<CharacterProfile, "references">
): CharacterReference | null {
  return (
    getPrimaryCharacterReference(character) ??
    character.references.find((ref) => ref.role === "outfit") ??
    character.references.find((ref) => ref.category === "canonical_face") ??
    character.references[0] ??
    null
  );
}

function normalizeToken(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^[,;\s]+/, "")
    .replace(/[,;\s]+$/, "");
}

export function getCharacterIdentityTokens(
  character: Pick<
    CharacterProfile,
    | "promptPrefix"
    | "appearance"
    | "clothing"
    | "triggerWords"
    | "dna"
    | "outfits"
    | "activeOutfitId"
  >,
  overrideOutfitId?: string | null
): string[] {
  const tokens: string[] = [];
  const seen = new Set<string>();

  const addToken = (token: string) => {
    for (const piece of token.split(",")) {
      const clean = normalizeToken(piece);
      if (!clean) continue;
      const key = clean.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      tokens.push(clean);
    }
  };

  const dna = character.dna;

  if (!dna) {
    const raw = [
      character.promptPrefix,
      character.appearance,
      character.clothing,
      ...(character.triggerWords ?? []),
    ];
    for (const item of raw) {
      if (item) addToken(item);
    }
    return tokens;
  }

  // 1. Primary trigger token
  if (dna.triggerToken) {
    addToken(dna.triggerToken);
  } else if (character.triggerWords && character.triggerWords.length > 0) {
    for (const tw of character.triggerWords) {
      if (tw) addToken(tw);
    }
  }

  // 2. Fixed appearance traits
  if (dna.gender) {
    const g = dna.gender.trim().toLowerCase();
    if (g === "female") {
      addToken("1girl");
    } else if (g === "male") {
      addToken("1boy");
    } else {
      addToken(dna.gender);
    }
  }
  if (dna.hairColor && !dna.hairColor.toLowerCase().includes("hair")) {
    addToken(`${dna.hairColor} hair`);
  } else if (dna.hairColor) {
    addToken(dna.hairColor);
  }
  if (dna.hairStyle) addToken(dna.hairStyle);
  if (dna.eyeColor && !dna.eyeColor.toLowerCase().includes("eyes") && !dna.eyeColor.toLowerCase().includes("eye")) {
    addToken(`${dna.eyeColor} eyes`);
  } else if (dna.eyeColor) {
    addToken(dna.eyeColor);
  }
  if (dna.skinTone) addToken(dna.skinTone);
  if (dna.species && dna.species.toLowerCase() !== "human") addToken(dna.species);
  if (dna.archetype) addToken(dna.archetype);
  for (const feat of dna.distinctiveFeatures ?? []) {
    if (feat) addToken(feat);
  }
  for (const trait of dna.fixedTraits ?? []) {
    if (trait) addToken(trait);
  }
  if (dna.facialCharacteristics) addToken(dna.facialCharacteristics);
  if (dna.bodyCharacteristics) addToken(dna.bodyCharacteristics);
  for (const acc of dna.signatureAccessories ?? []) {
    if (acc) addToken(acc);
  }
  if (dna.preferredStyle) addToken(dna.preferredStyle);

  // 3. Outfits
  const targetOutfitId =
    overrideOutfitId !== undefined ? overrideOutfitId : character.activeOutfitId;
  if (targetOutfitId && character.outfits) {
    const outfit = character.outfits.find((o) => o.id === targetOutfitId);
    if (outfit) {
      for (const t of outfit.promptTokens ?? []) {
        if (t) addToken(t);
      }
      if (outfit.description && (!outfit.promptTokens || outfit.promptTokens.length === 0)) {
        addToken(outfit.description);
      }
    }
  }

  // 4. Legacy fields fallback
  if (character.promptPrefix) addToken(character.promptPrefix);
  if (!targetOutfitId && character.clothing) addToken(character.clothing);

  return tokens;
}

function splitPromptSegments(prompt: string): string[] {
  return prompt
    .split(",")
    .map((segment) => normalizeToken(segment))
    .filter(Boolean);
}

/**
 * Prepends identity tokens without duplicating tokens already present in the
 * base prompt.
 */
export function composeCharacterPrompt(
  character: Pick<
    CharacterProfile,
    | "promptPrefix"
    | "appearance"
    | "clothing"
    | "triggerWords"
    | "dna"
    | "outfits"
    | "activeOutfitId"
  >,
  basePrompt: string,
  outfitId?: string | null
): string {
  const tokens = getCharacterIdentityTokens(character, outfitId);
  if (tokens.length === 0) return basePrompt.trim();

  const segments = splitPromptSegments(basePrompt);
  const present = new Set(segments.map((segment) => segment.toLowerCase()));
  const missing = tokens.filter((token) => !present.has(token.toLowerCase()));
  return [...missing, ...segments].join(", ");
}

export function removeCharacterIdentityTokens(
  prompt: string,
  character: Pick<
    CharacterProfile,
    | "promptPrefix"
    | "appearance"
    | "clothing"
    | "triggerWords"
    | "dna"
    | "outfits"
    | "activeOutfitId"
  >,
  outfitId?: string | null
): string {
  const tokens = new Set(
    getCharacterIdentityTokens(character, outfitId).map((token) => token.toLowerCase())
  );
  if (tokens.size === 0) return prompt;
  return splitPromptSegments(prompt)
    .filter((segment) => !tokens.has(segment.toLowerCase()))
    .join(", ");
}

/**
 * Finds the best compatible trained character visual adapter for the active model architecture.
 */
export function resolveCharacterAdapter(
  character: Pick<CharacterProfile, "adapters" | "activeAdapterId">,
  architecture: ModelArchitecture
): CharacterAdapter | null {
  if (!character.adapters || character.adapters.length === 0) return null;
  const targetFamily = architecture.toLowerCase();

  const isFamilyMatch = (family: string) => {
    const f = family.toLowerCase();
    if (f === targetFamily) return true;
    if ((targetFamily === "pony" || targetFamily === "illustrious") && (f === "sdxl" || f === "illustrious")) {
      return true;
    }
    if (targetFamily === "sdxl" && f === "sdxl") return true;
    return false;
  };

  // Check active adapter first
  if (character.activeAdapterId) {
    const active = character.adapters.find((a) => a.id === character.activeAdapterId);
    if (active && isFamilyMatch(active.baseModelFamily)) {
      return active;
    }
  }

  // Fallback to first compatible adapter
  return character.adapters.find((a) => isFamilyMatch(a.baseModelFamily)) ?? null;
}

export function characterTextWorkflowId(architecture: ModelArchitecture): string {
  if (architecture === "illustrious") return "t2i_illustrious_base";
  if (architecture === "moss_image") return "t2i_moss_image";
  if (architecture === "anima") return "t2i_anima_base";
  if (architecture === "krea2") return "t2i_krea2_base";
  if (architecture === "z_image") return "t2i_z_image_turbo";
  if (architecture === "sd15") return "t2i_sd15_base";
  return "t2i_sdxl_base";
}

export function characterImg2ImgWorkflowId(
  architecture: ModelArchitecture
): string | null {
  if (architecture === "illustrious") return "i2i_illustrious_base";
  if (architecture === "moss_image") return "i2i_moss_image_edit";
  if (architecture === "anima") return "i2i_anima_base";
  if (architecture === "krea2") return "i2i_krea2_base";
  if (architecture === "sd15") return "i2i_sd15_base";
  if (
    architecture === "sdxl" ||
    architecture === "pony" ||
    architecture === "unknown"
  ) {
    return "i2i_sdxl_base";
  }
  return null;
}

export type CharacterReferenceInactiveReason =
  | "mode_none"
  | "missing_primary"
  | "unsupported_architecture";

export interface CharacterReferencePlan {
  active: boolean;
  reason: CharacterReferenceInactiveReason | null;
  reference: CharacterReference | null;
  denoise: number;
  workflowId: string | null;
}

/**
 * Resolves whether the stock img2img reference path should be used. IPAdapter
 * and ControlNet stay inactive until those optional integrations are installed.
 */
export function resolveCharacterReferencePlan(
  character: CharacterProfile,
  architecture: ModelArchitecture
): CharacterReferencePlan {
  const reference = getPrimaryCharacterReference(character);
  const denoise = characterReferenceDenoise(character.referenceWeight);
  const workflowId = characterImg2ImgWorkflowId(architecture);

  if (character.referenceMode !== "img2img") {
    return {
      active: false,
      reason: "mode_none",
      reference,
      denoise,
      workflowId: null,
    };
  }
  if (!reference) {
    return {
      active: false,
      reason: "missing_primary",
      reference: null,
      denoise,
      workflowId: null,
    };
  }
  if (!workflowId) {
    return {
      active: false,
      reason: "unsupported_architecture",
      reference,
      denoise,
      workflowId: null,
    };
  }
  return { active: true, reason: null, reference, denoise, workflowId };
}
