import type {
  CharacterProfile,
  CharacterReference,
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
    "promptPrefix" | "appearance" | "clothing" | "triggerWords"
  >
): string[] {
  const raw = [
    character.promptPrefix,
    character.appearance,
    character.clothing,
    ...(character.triggerWords ?? []),
  ];
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const item of raw) {
    // Split multi-clause fields so prompt composition and token removal stay
    // symmetric (removal works on comma-separated prompt segments).
    for (const piece of (item ?? "").split(",")) {
      const token = normalizeToken(piece);
      if (!token) continue;
      const key = token.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      tokens.push(token);
    }
  }
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
    "promptPrefix" | "appearance" | "clothing" | "triggerWords"
  >,
  basePrompt: string
): string {
  const tokens = getCharacterIdentityTokens(character);
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
    "promptPrefix" | "appearance" | "clothing" | "triggerWords"
  >
): string {
  const tokens = new Set(
    getCharacterIdentityTokens(character).map((token) => token.toLowerCase())
  );
  if (tokens.size === 0) return prompt;
  return splitPromptSegments(prompt)
    .filter((segment) => !tokens.has(segment.toLowerCase()))
    .join(", ");
}

export function characterTextWorkflowId(architecture: ModelArchitecture): string {
  if (architecture === "illustrious") return "t2i_illustrious_base";
  if (architecture === "moss_image") return "t2i_moss_image";
  if (architecture === "anima") return "t2i_anima_base";
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
