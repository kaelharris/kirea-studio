/**
 * Danbooru Assistant & Model-Aware Prompt Enhancement System
 *
 * Provides:
 * 1. Comprehensive canonical Danbooru tag dictionary & ontology.
 * 2. Natural-language to Danbooru tag conversion.
 * 3. Architecture-aware prompt formatting for:
 *    - Illustrious (quality tags, score tags, aesthetic tags, rating)
 *    - Pony (score_9, score_8_up, score_7_up, source_anime, rating_safe)
 *    - Animagine (masterpiece, high quality, absurdres)
 *    - Anima (masterpiece, high quality, score_9, score_8_up)
 *    - MOSS (natural descriptive composition + clean lighting tags)
 *    - KREA / Flux (natural language descriptors)
 *    - SDXL / SD 1.5 / Generic (masterpiece, best quality, highly detailed)
 * 4. Preserves LoRA trigger words (<lora:name:weight>), character names, and unmapped natural text.
 * 5. Tag validation (validated tag vs natural language fragment vs model quality token).
 */

import type { ModelArchitecture } from "../../../shared/types";

export type TagCategory =
  | "general"
  | "character"
  | "clothing"
  | "action"
  | "environment"
  | "lighting"
  | "camera"
  | "quality"
  | "meta"
  | "lora"
  | "natural";

export interface AnalyzedTag {
  text: string;
  category: TagCategory;
  isValidated: boolean;
  isModelSpecific?: boolean;
}

export interface EnhancementResult {
  originalPrompt: string;
  enhancedPrompt: string;
  architecture: ModelArchitecture | "unknown" | string;
  tags: AnalyzedTag[];
  modelQualityPrefix: string[];
  modelQualitySuffix: string[];
  preservedTokens: string[];
  naturalLanguageFragments: string[];
}

/**
 * Canonical Danbooru Tag Knowledge Base
 * Maps common natural language phrases to standardized Danbooru tags.
 */
export const DANBOORU_SYNONYM_MAP: Record<string, { tag: string; category: TagCategory }> = {
  // Subjects
  "1girl": { tag: "1girl", category: "character" },
  "1boy": { tag: "1boy", category: "character" },
  "1woman": { tag: "1woman", category: "character" },
  "1man": { tag: "1man", category: "character" },
  "girl": { tag: "1girl", category: "character" },
  "anime girl": { tag: "1girl", category: "character" },
  "woman": { tag: "1woman", category: "character" },
  "female": { tag: "1girl", category: "character" },
  "solo": { tag: "solo", category: "character" },
  "single girl": { tag: "solo, 1girl", category: "character" },
  "boy": { tag: "1boy", category: "character" },
  "anime boy": { tag: "1boy", category: "character" },
  "man": { tag: "1man", category: "character" },
  "2girls": { tag: "2girls", category: "character" },
  "two girls": { tag: "2girls", category: "character" },
  "couple": { tag: "1boy, 1girl, couple", category: "character" },

  // Hair & Face
  "red hair": { tag: "red hair", category: "character" },
  "red-haired": { tag: "red hair", category: "character" },
  "long red hair": { tag: "long hair, red hair", category: "character" },
  "short red hair": { tag: "short hair, red hair", category: "character" },
  "blue hair": { tag: "blue hair", category: "character" },
  "blonde hair": { tag: "blonde hair", category: "character" },
  "blonde": { tag: "blonde hair", category: "character" },
  "black hair": { tag: "black hair", category: "character" },
  "brown hair": { tag: "brown hair", category: "character" },
  "white hair": { tag: "white hair", category: "character" },
  "silver hair": { tag: "silver hair", category: "character" },
  "pink hair": { tag: "pink hair", category: "character" },
  "purple hair": { tag: "purple hair", category: "character" },
  "green hair": { tag: "green hair", category: "character" },
  "long hair": { tag: "long hair", category: "character" },
  "short hair": { tag: "short hair", category: "character" },
  "ponytail": { tag: "ponytail", category: "character" },
  "twintails": { tag: "twintails", category: "character" },
  "twin tails": { tag: "twintails", category: "character" },
  "braid": { tag: "braid", category: "character" },
  "braided hair": { tag: "braid", category: "character" },
  "bangs": { tag: "bangs", category: "character" },
  "hair over one eye": { tag: "hair over one eye", category: "character" },
  "messy hair": { tag: "messy hair", category: "character" },
  "wavy hair": { tag: "wavy hair", category: "character" },
  "curly hair": { tag: "curly hair", category: "character" },
  "bob cut": { tag: "bob cut", category: "character" },

  // Eyes & Expression
  "blue eyes": { tag: "blue eyes", category: "character" },
  "red eyes": { tag: "red eyes", category: "character" },
  "green eyes": { tag: "green eyes", category: "character" },
  "brown eyes": { tag: "brown eyes", category: "character" },
  "amber eyes": { tag: "amber eyes", category: "character" },
  "purple eyes": { tag: "purple eyes", category: "character" },
  "yellow eyes": { tag: "yellow eyes", category: "character" },
  "golden eyes": { tag: "yellow eyes", category: "character" },
  "beautiful eyes": { tag: "detailed eyes", category: "quality" },
  "detailed eyes": { tag: "detailed eyes", category: "quality" },
  "smiling": { tag: "smile", category: "character" },
  "smile": { tag: "smile", category: "character" },
  "gentle smile": { tag: "gentle smile", category: "character" },
  "blushing": { tag: "blush", category: "character" },
  "blush": { tag: "blush", category: "character" },
  "open mouth": { tag: "open mouth", category: "character" },
  "looking at viewer": { tag: "looking at viewer", category: "character" },
  "looking at camera": { tag: "looking at viewer", category: "character" },
  "looking away": { tag: "looking away", category: "character" },
  "serious": { tag: "serious", category: "character" },
  "wink": { tag: "wink", category: "character" },

  // Clothing & Style
  "white dress": { tag: "white dress", category: "clothing" },
  "black dress": { tag: "black dress", category: "clothing" },
  "red dress": { tag: "red dress", category: "clothing" },
  "elegant dress": { tag: "dress, elegant", category: "clothing" },
  "dress": { tag: "dress", category: "clothing" },
  "skirt": { tag: "skirt", category: "clothing" },
  "pleated skirt": { tag: "pleated skirt", category: "clothing" },
  "miniskirt": { tag: "miniskirt", category: "clothing" },
  "corset": { tag: "corset", category: "clothing" },
  "school uniform": { tag: "school uniform", category: "clothing" },
  "sailor suit": { tag: "sailor suit", category: "clothing" },
  "kimono": { tag: "kimono", category: "clothing" },
  "yukata": { tag: "yukata", category: "clothing" },
  "armor": { tag: "armor", category: "clothing" },
  "jacket": { tag: "jacket", category: "clothing" },
  "hoodie": { tag: "hoodie", category: "clothing" },
  "sweater": { tag: "sweater", category: "clothing" },
  "ribbon": { tag: "ribbon", category: "clothing" },
  "stockings": { tag: "stockings", category: "clothing" },
  "thighhighs": { tag: "thighhighs", category: "clothing" },
  "thigh highs": { tag: "thighhighs", category: "clothing" },
  "gloves": { tag: "gloves", category: "clothing" },
  "glasses": { tag: "glasses", category: "clothing" },
  "sunglasses": { tag: "sunglasses", category: "clothing" },
  "necklace": { tag: "necklace", category: "clothing" },
  "earrings": { tag: "earrings", category: "clothing" },
  "boots": { tag: "boots", category: "clothing" },
  "high heels": { tag: "high heels", category: "clothing" },
  "hijab": { tag: "hijab", category: "clothing" },

  // Pose & Framing
  "standing": { tag: "standing", category: "action" },
  "sitting": { tag: "sitting", category: "action" },
  "sitting on couch": { tag: "sitting, couch", category: "action" },
  "lying down": { tag: "lying", category: "action" },
  "walking": { tag: "walking", category: "action" },
  "running": { tag: "running", category: "action" },
  "holding hands": { tag: "holding hands", category: "action" },
  "full body": { tag: "full body", category: "camera" },
  "full length": { tag: "full body", category: "camera" },
  "upper body": { tag: "upper body", category: "camera" },
  "portrait": { tag: "portrait", category: "camera" },
  "close-up": { tag: "close-up", category: "camera" },
  "close up": { tag: "close-up", category: "camera" },
  "cowboy shot": { tag: "cowboy shot", category: "camera" },
  "from side": { tag: "profile", category: "camera" },
  "from behind": { tag: "from behind", category: "camera" },
  "from above": { tag: "from above", category: "camera" },
  "from below": { tag: "from below", category: "camera" },
  "low angle": { tag: "low angle", category: "camera" },
  "high angle": { tag: "high angle", category: "camera" },
  "dynamic angle": { tag: "dynamic angle", category: "camera" },
  "dynamic pose": { tag: "dynamic pose", category: "action" },

  // Environment & Scenery
  "garden": { tag: "garden", category: "environment" },
  "flowers": { tag: "flowers", category: "environment" },
  "flower garden": { tag: "garden, flowers", category: "environment" },
  "wet flowers": { tag: "flowers, wet", category: "environment" },
  "rain": { tag: "rain", category: "environment" },
  "rainy": { tag: "rain", category: "environment" },
  "rainy day": { tag: "rain, overcast", category: "environment" },
  "rainy afternoon": { tag: "rain, overcast, outdoors", category: "environment" },
  "puddles": { tag: "puddle, reflection", category: "environment" },
  "umbrella": { tag: "umbrella", category: "environment" },
  "bedroom": { tag: "bedroom, indoors", category: "environment" },
  "couch": { tag: "couch", category: "environment" },
  "sofa": { tag: "couch", category: "environment" },
  "room": { tag: "indoors", category: "environment" },
  "classroom": { tag: "classroom, indoors", category: "environment" },
  "street": { tag: "street, outdoors", category: "environment" },
  "city": { tag: "cityscape, outdoors", category: "environment" },
  "city skyline": { tag: "cityscape, skyline", category: "environment" },
  "night city": { tag: "cityscape, night", category: "environment" },
  "forest": { tag: "forest, nature", category: "environment" },
  "beach": { tag: "beach, ocean", category: "environment" },
  "sunset": { tag: "sunset, dusk", category: "environment" },
  "twilight": { tag: "twilight, dusk", category: "environment" },
  "night": { tag: "night, night sky", category: "environment" },
  "stars": { tag: "starry sky", category: "environment" },
  "detailed background": { tag: "detailed background", category: "environment" },
  "simple background": { tag: "simple background", category: "environment" },

  // Lighting & Atmosphere
  "cinematic lighting": { tag: "cinematic lighting", category: "lighting" },
  "dramatic lighting": { tag: "dramatic lighting", category: "lighting" },
  "soft lighting": { tag: "soft lighting", category: "lighting" },
  "atmospheric lighting": { tag: "atmospheric lighting", category: "lighting" },
  "overcast lighting": { tag: "overcast", category: "lighting" },
  "rim light": { tag: "rim light", category: "lighting" },
  "volumetric lighting": { tag: "volumetric lighting", category: "lighting" },
  "sunlight": { tag: "sunlight", category: "lighting" },
  "sunbeams": { tag: "sunbeams", category: "lighting" },
  "backlighting": { tag: "backlighting", category: "lighting" },
  "depth of field": { tag: "depth of field", category: "camera" },
  "blurry background": { tag: "blurry background", category: "camera" },
  "bokeh": { tag: "bokeh", category: "camera" },
};

/**
 * Common canonical tags recognized as validated Danbooru tags
 */
export const VALIDATED_DANBOORU_TAGS = new Set<string>([
  "1girl", "1boy", "1man", "1woman", "2girls", "2boys", "solo", "multiple girls",
  "long hair", "short hair", "medium hair", "very long hair",
  "black hair", "blonde hair", "brown hair", "blue hair", "red hair", "white hair", "silver hair", "pink hair", "purple hair", "green hair",
  "blue eyes", "red eyes", "green eyes", "brown eyes", "amber eyes", "purple eyes", "yellow eyes", "heterochromia", "detailed eyes",
  "ponytail", "twintails", "braid", "bangs", "bob cut", "hair over one eye",
  "smile", "gentle smile", "open mouth", "blush", "looking at viewer", "looking away", "wink", "serious",
  "dress", "white dress", "black dress", "skirt", "pleated skirt", "miniskirt", "corset", "school uniform", "sailor suit", "kimono", "yukata", "jacket", "hoodie", "sweater", "ribbon", "stockings", "thighhighs", "gloves", "glasses", "boots", "hijab",
  "standing", "sitting", "lying", "walking", "running", "full body", "upper body", "portrait", "close-up", "cowboy shot", "profile", "from behind", "from above", "from below", "low angle", "high angle",
  "garden", "flowers", "rain", "overcast", "outdoors", "indoors", "bedroom", "couch", "street", "cityscape", "skyline", "forest", "beach", "sunset", "twilight", "night", "starry sky", "detailed background", "simple background",
  "cinematic lighting", "dramatic lighting", "soft lighting", "atmospheric lighting", "rim light", "volumetric lighting", "sunlight", "depth of field", "bokeh"
]);

/**
 * Model-Aware Quality and Formatting Conventions
 */
export interface ModelPromptProfile {
  name: string;
  qualityPrefix: string[];
  qualitySuffix: string[];
  negativeDefaults: string;
  styleSeparator: string;
  supportsDanbooruTags: boolean;
  notes: string;
}

export const MODEL_PROMPT_PROFILES: Record<string, ModelPromptProfile> = {
  illustrious: {
    name: "Illustrious-XL / NoobAI",
    qualityPrefix: [
      "masterpiece",
      "best quality",
      "very aesthetic",
      "score_9",
      "score_8_up",
      "score_7_up",
      "source_anime",
      "rating_safe",
    ],
    qualitySuffix: ["extremely detailed", "perfect lighting"],
    negativeDefaults:
      "worst quality, low quality, score_1, score_2, score_3, score_4, score_5, blurry, jpeg artifacts, signature, watermark",
    styleSeparator: ", ",
    supportsDanbooruTags: true,
    notes: "Tuned for Danbooru tags with official scoring tokens (score_9, score_8_up).",
  },
  pony: {
    name: "Pony Diffusion V6",
    qualityPrefix: [
      "score_9",
      "score_8_up",
      "score_7_up",
      "score_6_up",
      "source_anime",
      "rating_safe",
    ],
    qualitySuffix: [],
    negativeDefaults:
      "score_4, score_5, score_1, worst quality, low quality, bad anatomy, bad hands, blurry, signature",
    styleSeparator: ", ",
    supportsDanbooruTags: true,
    notes: "Strict requirement for Pony score tags (score_9, score_8_up) at prompt start.",
  },
  anima: {
    name: "Anima Pencil-XL",
    qualityPrefix: [
      "masterpiece",
      "high quality",
      "score_9",
      "score_8_up",
    ],
    qualitySuffix: ["clean linework", "detailed anime art"],
    negativeDefaults:
      "worst quality, low quality, score_1, score_2, score_3, blurry, jpeg artifacts, sepia",
    styleSeparator: ", ",
    supportsDanbooruTags: true,
    notes: "Anime-tuned checkpoint with dual scoring and quality keywords.",
  },
  animagine: {
    name: "Animagine-XL",
    qualityPrefix: ["masterpiece", "high quality", "absurdres"],
    qualitySuffix: ["ultra-detailed"],
    negativeDefaults:
      "lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry",
    styleSeparator: ", ",
    supportsDanbooruTags: true,
    notes: "Optimized for standardized Danbooru syntax with absurdres tag.",
  },
  moss_image: {
    name: "MOSS-Image",
    qualityPrefix: ["cinematic lighting", "photorealistic anime concept"],
    qualitySuffix: ["masterful composition", "high resolution", "octane render"],
    negativeDefaults: "low quality, distorted, blurry, artifacts, watermark",
    styleSeparator: ", ",
    supportsDanbooruTags: false,
    notes: "Responds best to cohesive natural phrasing with targeted stylistic modifiers.",
  },
  krea2: {
    name: "Krea 2",
    qualityPrefix: ["hyper-realistic", "detailed rendering"],
    qualitySuffix: ["cinematic mood", "studio lighting"],
    negativeDefaults: "ugly, blurry, distorted, low quality",
    styleSeparator: ", ",
    supportsDanbooruTags: false,
    notes: "Natural language aesthetic descriptions.",
  },
  flux: {
    name: "Flux.1",
    qualityPrefix: ["photorealistic", "award-winning photograph"],
    qualitySuffix: ["natural lighting", "film grain", "shallow depth of field"],
    negativeDefaults: "bad quality, blurry, artifacts",
    styleSeparator: ", ",
    supportsDanbooruTags: false,
    notes: "Responds best to descriptive natural language sentences.",
  },
  sdxl: {
    name: "Standard SDXL",
    qualityPrefix: ["masterpiece", "best quality", "highly detailed"],
    qualitySuffix: ["sharp focus", "volumetric lighting"],
    negativeDefaults: "blurry, low quality, distorted anatomy, watermark",
    styleSeparator: ", ",
    supportsDanbooruTags: true,
    notes: "Versatile support for combined Danbooru tags and descriptive phrases.",
  },
  sd15: {
    name: "Stable Diffusion 1.5",
    qualityPrefix: ["masterpiece", "best quality", "ultra-detailed"],
    qualitySuffix: ["illustration", "8k resolution"],
    negativeDefaults: "lowres, bad anatomy, bad hands, text, error, missing fingers, cropped, worst quality, low quality, blurry",
    styleSeparator: ", ",
    supportsDanbooruTags: true,
    notes: "Classic tag-based prompt structure.",
  },
  unknown: {
    name: "Generic / Unknown",
    qualityPrefix: ["masterpiece", "high quality"],
    qualitySuffix: ["detailed"],
    negativeDefaults: "blurry, low quality, artifacts",
    styleSeparator: ", ",
    supportsDanbooruTags: true,
    notes: "Conservative enhancements preserving user input.",
  },
};

/**
 * Extracts LoRA tokens <lora:name:weight> and special bracket tokens without alteration
 */
export function extractPreservedTokens(prompt: string): {
  cleanText: string;
  preservedTokens: string[];
} {
  const loraRegex = /<lora:[^>]+>/gi;
  const preservedTokens: string[] = [];
  const matches = prompt.match(loraRegex);
  if (matches) {
    for (const match of matches) {
      preservedTokens.push(match);
    }
  }

  const cleanText = prompt.replace(loraRegex, "").replace(/\s+/g, " ").trim();
  return { cleanText, preservedTokens };
}

/**
 * Performs intelligent, model-aware Danbooru prompt enhancement
 */
export function enhancePromptWithDanbooru(
  rawPrompt: string,
  architecture: ModelArchitecture | "unknown" | string = "illustrious"
): EnhancementResult {
  const { cleanText, preservedTokens } = extractPreservedTokens(rawPrompt);
  const profileKey =
    architecture in MODEL_PROMPT_PROFILES ? architecture : "unknown";
  const profile = (MODEL_PROMPT_PROFILES[profileKey] ?? MODEL_PROMPT_PROFILES.unknown)!;

  if (!cleanText.trim()) {
    return {
      originalPrompt: rawPrompt,
      enhancedPrompt: rawPrompt,
      architecture,
      tags: [],
      modelQualityPrefix: profile.qualityPrefix,
      modelQualitySuffix: profile.qualitySuffix,
      preservedTokens,
      naturalLanguageFragments: [],
    };
  }

  // If prompt is structured JSON (e.g. MOSS layout prompt), preserve exactly as-is
  const trimmedClean = cleanText.trim();
  if (trimmedClean.startsWith("{") || trimmedClean.startsWith("[")) {
    try {
      JSON.parse(trimmedClean);
      return {
        originalPrompt: rawPrompt,
        enhancedPrompt: rawPrompt,
        architecture,
        tags: [],
        modelQualityPrefix: [],
        modelQualitySuffix: [],
        preservedTokens,
        naturalLanguageFragments: [rawPrompt],
      };
    } catch {
      // Not valid JSON, continue normal enhancement
    }
  }

  // MOSS and Flux expect natural language descriptions, not Danbooru anime tags
  if (!profile.supportsDanbooruTags) {
    const finalParts: string[] = [
      ...profile.qualityPrefix,
      cleanText,
      ...profile.qualitySuffix,
      ...preservedTokens,
    ];
    return {
      originalPrompt: rawPrompt,
      enhancedPrompt: finalParts.join(profile.styleSeparator),
      architecture,
      tags: [],
      modelQualityPrefix: profile.qualityPrefix,
      modelQualitySuffix: profile.qualitySuffix,
      preservedTokens,
      naturalLanguageFragments: [cleanText],
    };
  }

  // Split prompt into segments by comma or sentence boundaries
  const segments = cleanText
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const recognizedTags: AnalyzedTag[] = [];
  const unmappedFragments: string[] = [];
  const seenTags = new Set<string>();

  const addTag = (text: string, category: TagCategory, isValidated: boolean) => {
    const norm = text.toLowerCase().trim();
    if (!norm || seenTags.has(norm)) return;
    seenTags.add(norm);
    recognizedTags.push({ text, category, isValidated });
  };

  // Process segments through Danbooru dictionary & synonym lookup
  for (const segment of segments) {
    const lower = segment.toLowerCase();

    // Check direct dictionary match
    const directMatch = DANBOORU_SYNONYM_MAP[lower];
    if (directMatch) {
      // May contain multiple tags like "solo, 1girl"
      const parts = directMatch.tag.split(",").map((p) => p.trim());
      for (const part of parts) {
        addTag(part, directMatch.category, true);
      }
      continue;
    }

    // Check partial phrase matching for multi-word descriptions
    let matchedAny = false;
    // Sort keys by descending length so "long red hair" matches before "red hair"
    const sortedKeys = Object.keys(DANBOORU_SYNONYM_MAP).sort(
      (a, b) => b.length - a.length
    );

    let remainingSegment = lower;
    for (const key of sortedKeys) {
      const regex = new RegExp(`\\b${key}\\b`, "i");
      if (regex.test(remainingSegment)) {
        const match = DANBOORU_SYNONYM_MAP[key];
        if (match) {
          const parts = match.tag.split(",").map((p) => p.trim());
          for (const part of parts) {
            addTag(part, match.category, true);
          }
          remainingSegment = remainingSegment.replace(regex, "").trim();
          matchedAny = true;
        }
      }
    }

    // Check if what remains is a validated Danbooru tag
    const trimmedRemaining = remainingSegment.replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, "").trim();
    if (trimmedRemaining) {
      if (VALIDATED_DANBOORU_TAGS.has(trimmedRemaining)) {
        addTag(trimmedRemaining, "general", true);
      } else if (!matchedAny) {
        // Keep original fragment as natural language description
        unmappedFragments.push(segment);
      }
    }
  }

  // Ensure baseline subject tag exists if gender was mentioned
  const hasSubject = recognizedTags.some((t) =>
    ["1girl", "1boy", "1man", "1woman", "2girls", "couple"].includes(t.text)
  );
  if (!hasSubject) {
    if (/\b(girl|woman|she|her|female|maiden|princess)\b/i.test(cleanText)) {
      addTag("1girl", "character", true);
      addTag("solo", "character", true);
    } else if (/\b(boy|man|he|his|male|guy|prince)\b/i.test(cleanText)) {
      addTag("1boy", "character", true);
      addTag("solo", "character", true);
    }
  }

  // Ensure camera/composition tag if missing and appropriate
  const hasCamera = recognizedTags.some((t) => t.category === "camera");
  if (!hasCamera && recognizedTags.length > 0) {
    if (/\b(standing|full body|legs|shoes|feet)\b/i.test(cleanText)) {
      addTag("full body", "camera", true);
    } else if (/\b(face|eyes|lips|portrait)\b/i.test(cleanText)) {
      addTag("portrait", "camera", true);
    }
  }

  // Construct final model-specific output
  const outputParts: string[] = [];

  // 1. Model Quality & Scoring Prefix (e.g. score_9, masterpiece...)
  for (const q of profile.qualityPrefix) {
    outputParts.push(q);
  }

  // 2. Recognized Danbooru tags sorted by canonical order:
  // Subject -> Character attributes -> Clothing -> Action -> Environment -> Lighting -> Camera
  const categoryOrder: Record<TagCategory, number> = {
    quality: 0,
    character: 1,
    clothing: 2,
    action: 3,
    environment: 4,
    lighting: 5,
    camera: 6,
    general: 7,
    natural: 8,
    meta: 9,
    lora: 10,
  };

  const sortedTags = [...recognizedTags].sort((a, b) => {
    const diff = (categoryOrder[a.category] ?? 5) - (categoryOrder[b.category] ?? 5);
    return diff !== 0 ? diff : a.text.localeCompare(b.text);
  });

  for (const tag of sortedTags) {
    outputParts.push(tag.text);
  }

  // 3. Natural Language Fragments (preserving concepts without exact Danbooru tags)
  for (const fragment of unmappedFragments) {
    outputParts.push(fragment);
  }

  // 4. Model Quality Suffix
  for (const s of profile.qualitySuffix) {
    outputParts.push(s);
  }

  // 5. Preserved LoRA syntax and special tokens (<lora:...>)
  for (const lora of preservedTokens) {
    outputParts.push(lora);
  }

  // Remove duplicates while preserving order
  const finalTagsSet = new Set<string>();
  const finalParts: string[] = [];
  for (const part of outputParts) {
    const trimmed = part.trim();
    if (trimmed && !finalTagsSet.has(trimmed.toLowerCase())) {
      finalTagsSet.add(trimmed.toLowerCase());
      finalParts.push(trimmed);
    }
  }

  const enhancedPrompt = finalParts.join(profile.styleSeparator);

  return {
    originalPrompt: rawPrompt,
    enhancedPrompt,
    architecture,
    tags: sortedTags,
    modelQualityPrefix: profile.qualityPrefix,
    modelQualitySuffix: profile.qualitySuffix,
    preservedTokens,
    naturalLanguageFragments: unmappedFragments,
  };
}

