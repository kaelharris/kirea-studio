import { describe, expect, it } from "vitest";
import {
  enhancePromptWithDanbooru,
  extractPreservedTokens,
  MODEL_PROMPT_PROFILES,
} from "../../src/renderer/components/create/DanbooruEnhancer";

describe("Danbooru Assistant & Model-Aware Prompt Enhancement", () => {
  it("converts natural language descriptions into canonical Danbooru tags", () => {
    const input =
      "A beautiful red-haired anime girl standing in a garden during a rainy afternoon, wearing an elegant white dress.";
    const result = enhancePromptWithDanbooru(input, "illustrious");

    expect(result.originalPrompt).toBe(input);
    expect(result.architecture).toBe("illustrious");

    const tagTexts = result.tags.map((t) => t.text.toLowerCase());
    // Should recognize subject
    expect(tagTexts).toContain("1girl");
    // Should recognize hair
    expect(tagTexts).toContain("red hair");
    // Should recognize clothing
    expect(tagTexts).toContain("white dress");
    // Should recognize action/pose
    expect(tagTexts).toContain("standing");
    // Should recognize environment & weather
    expect(tagTexts).toContain("garden");
    expect(tagTexts).toContain("rain");
  });

  it("applies Illustrious-specific quality prefix and score tags", () => {
    const input = "1girl, kimono, cherry blossoms";
    const result = enhancePromptWithDanbooru(input, "illustrious");

    expect(result.enhancedPrompt).toContain("score_9");
    expect(result.enhancedPrompt).toContain("score_8_up");
    expect(result.enhancedPrompt).toContain("source_anime");
    expect(result.enhancedPrompt).toContain("kimono");
    expect(result.enhancedPrompt).toContain("cherry blossoms");
  });

  it("applies Pony-specific quality prefix and rating tags", () => {
    const input = "solo, cyber girl in neo tokyo";
    const result = enhancePromptWithDanbooru(input, "pony");

    expect(result.enhancedPrompt).toContain("score_9");
    expect(result.enhancedPrompt).toContain("score_8_up");
    expect(result.enhancedPrompt).toContain("source_anime");
    expect(result.enhancedPrompt).toContain("rating_safe");
  });

  it("applies Animagine-specific masterpiece tags", () => {
    const input = "magical girl holding a glowing staff";
    const result = enhancePromptWithDanbooru(input, "animagine");

    expect(result.enhancedPrompt).toContain("masterpiece");
    expect(result.enhancedPrompt).toContain("high quality");
    expect(result.enhancedPrompt).toContain("absurdres");
  });

  it("applies Anima-specific style tags", () => {
    const input = "warrior maiden with a katana";
    const result = enhancePromptWithDanbooru(input, "anima");

    expect(result.enhancedPrompt).toContain("score_9");
    expect(result.enhancedPrompt).toContain("clean linework");
    expect(result.enhancedPrompt).toContain("detailed anime art");
  });

  it("applies MOSS and Flux natural photographic prompt enrichments", () => {
    const mossResult = enhancePromptWithDanbooru("portrait of a young woman in studio", "moss_image");
    expect(mossResult.enhancedPrompt).toContain("cinematic lighting");

    const fluxResult = enhancePromptWithDanbooru("cyberpunk city street at dusk", "flux");
    expect(fluxResult.enhancedPrompt).toContain("photorealistic");
  });

  it("preserves LoRA tokens and triggers without altering syntax", () => {
    const input = "1girl, gothic lolita, dark castle <lora:gothic_v2:0.85> <lora:eye_detail:0.6>";
    const result = enhancePromptWithDanbooru(input, "illustrious");

    expect(result.preservedTokens).toEqual([
      "<lora:gothic_v2:0.85>",
      "<lora:eye_detail:0.6>",
    ]);
    expect(result.enhancedPrompt).toContain("<lora:gothic_v2:0.85>");
    expect(result.enhancedPrompt).toContain("<lora:eye_detail:0.6>");
  });

  it("extracts preserved tokens cleanly with helper", () => {
    const text = "A knight in shining armor <lora:knight_armor:0.9> in a forest <lora:forest_v1:0.5>";
    const { cleanText, preservedTokens } = extractPreservedTokens(text);

    expect(preservedTokens).toEqual([
      "<lora:knight_armor:0.9>",
      "<lora:forest_v1:0.5>",
    ]);
    expect(cleanText).toBe("A knight in shining armor in a forest");
  });

  it("deduplicates redundant tags case-insensitively while preserving order", () => {
    const input = "1girl, 1GIRL, red hair, Red Hair, Red hair, garden";
    const result = enhancePromptWithDanbooru(input, "generic");

    const parts = result.enhancedPrompt.split(", ").map((p) => p.toLowerCase());
    const count1Girl = parts.filter((p) => p === "1girl").length;
    const countRedHair = parts.filter((p) => p === "red hair").length;

    expect(count1Girl).toBe(1);
    expect(countRedHair).toBe(1);
  });

  it("preserves unmapped creative natural language fragments", () => {
    const input = "1girl, holding a celestial clockwork gyroscope from antiquity";
    const result = enhancePromptWithDanbooru(input, "illustrious");

    // The unmapped phrase should be preserved
    expect(result.enhancedPrompt.toLowerCase()).toContain("celestial clockwork gyroscope from antiquity");
  });

  it("sorts recognized tags by canonical categories (character before environment)", () => {
    const input = "garden, 1girl, rain, red hair, white dress";
    const result = enhancePromptWithDanbooru(input, "generic");

    const parts = result.enhancedPrompt.split(", ");
    const girlIndex = parts.findIndex((p) => p.includes("1girl"));
    const hairIndex = parts.findIndex((p) => p.includes("red hair"));
    const dressIndex = parts.findIndex((p) => p.includes("white dress"));
    const gardenIndex = parts.findIndex((p) => p.includes("garden"));

    // Character attributes should appear before environment
    expect(girlIndex).toBeLessThan(gardenIndex);
    expect(hairIndex).toBeLessThan(gardenIndex);
    expect(dressIndex).toBeLessThan(gardenIndex);
  });
});
