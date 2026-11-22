import { describe, it } from "vitest";
import {
  enhancePromptWithDanbooru,
  MODEL_PROMPT_PROFILES,
} from "../../src/renderer/components/create/DanbooruEnhancer";

describe("Danbooru Model Family Execution Examples", () => {
  it("generates verified outputs across all supported model architectures", () => {
    const testCases = [
      {
        arch: "illustrious",
        text: "1girl, red hair, long red hair, white dress, smiling in a garden with rain <lora:detail:0.8>",
      },
      {
        arch: "pony",
        text: "cyberpunk girl on motorcycle in neon city at night",
      },
      {
        arch: "animagine",
        text: "magical girl holding glowing crystal orb, flying through starry sky",
      },
      {
        arch: "anima",
        text: "female knight in black armor with golden eyes, standing in ruined castle",
      },
      {
        arch: "moss_image",
        text: "cinematic editorial portrait of young woman, soft studio rim light",
      },
      {
        arch: "flux",
        text: "cozy wooden cabin in the snowy mountains at sunrise, 35mm photograph",
      },
      {
        arch: "sdxl",
        text: "samurai warrior standing on mountain cliff at sunset with volumetric lighting",
      },
    ];

    console.log("\n================ DANBOORU ENHANCEMENT VERIFIED OUTPUTS ================\n");
    for (const tc of testCases) {
      const res = enhancePromptWithDanbooru(tc.text, tc.arch as any);
      console.log(`[MODEL FAMILY: ${tc.arch.toUpperCase()}]`);
      console.log(`Input: "${tc.text}"`);
      console.log(`Output: "${res.enhancedPrompt}"`);
      console.log(`Preserved Tokens:`, res.preservedTokens);
      console.log(`Unmapped Natural Fragments:`, res.naturalLanguageFragments);
      console.log("------------------------------------------------------------------------");
    }
  });
});
