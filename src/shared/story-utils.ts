import type {
  CharacterProfile,
  LoraRecipe,
  LoraSelection,
  ModelRecord,
  OutputFormat,
  PerformanceProfile,
  Story,
  StoryCastRole,
  StoryScene,
  StoryScenePlan,
  StorySceneStatus,
  WorkflowTemplate,
} from "./types";
import {
  dimensionBoundsFromWorkflow,
  inferModelArchitecture,
  resolveDimensionsForAspect,
} from "./aspect-ratios";
import {
  ARCHITECTURE_LABELS,
  evaluateLoraCompatibility,
  getEffectiveArchitecture,
  isGenerationSupportedArchitecture,
} from "./model-utils";
import {
  characterTextWorkflowId,
  composeCharacterPrompt,
  resolveCharacterReferencePlan,
} from "./character-utils";

export const STORY_STATUS_LABELS = {
  draft: "Draft",
  in_progress: "In progress",
  complete: "Complete",
} as const;

export const STORY_CAST_ROLE_LABELS: Record<StoryCastRole, string> = {
  lead: "Lead",
  supporting: "Supporting",
  cameo: "Cameo",
};

export const STORY_SCENE_STATUS_LABELS: Record<StorySceneStatus, string> = {
  draft: "Draft",
  queued: "Queued",
  generating: "Generating",
  completed: "Completed",
  failed: "Failed",
};

export interface StoryPlanDefaults {
  width: number;
  height: number;
  steps: number;
  cfg: number;
  sampler: string;
  scheduler: string;
  aspectRatio: string;
  outputFormat: OutputFormat;
  performanceProfile: PerformanceProfile;
}

export interface StoryScenePlanInput {
  story: Story;
  scene: StoryScene;
  characters: CharacterProfile[];
  recipes: LoraRecipe[];
  models: ModelRecord[];
  workflows: WorkflowTemplate[];
  defaults: StoryPlanDefaults;
  referenceFileExists: (filePath: string) => boolean;
}

function normalizeSegment(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^[,;\s]+/, "")
    .replace(/[,;\s]+$/, "");
}

export function mergePromptSegments(
  ...parts: Array<string | null | undefined>
): string {
  const seen = new Set<string>();
  const segments: string[] = [];
  for (const part of parts) {
    for (const piece of (part ?? "").split(",")) {
      const segment = normalizeSegment(piece);
      if (!segment) continue;
      const key = segment.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      segments.push(segment);
    }
  }
  return segments.join(", ");
}

export function resolveStorySceneCastIds(
  story: Pick<Story, "cast" | "defaultCharacterId">,
  scene: Pick<StoryScene, "cast">
): string[] {
  if (scene.cast.length > 0) return scene.cast.map((member) => member.characterId);
  if (story.cast.length > 0) return story.cast.map((member) => member.characterId);
  return story.defaultCharacterId ? [story.defaultCharacterId] : [];
}

function findCheckpoint(models: ModelRecord[], reference: string | null) {
  if (!reference) return null;
  return (
    models.find(
      (model) =>
        model.installed &&
        (model.category === "checkpoint" || model.category === "diffusion_model") &&
        (model.relativePath === reference ||
          model.name === reference ||
          model.filePath === reference)
    ) ?? null
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Builds the deterministic generation plan for one story scene. Precedence is
 * scene override > linked LoRA recipe > workflow defaults > app defaults.
 */
export function buildStoryScenePlan(input: StoryScenePlanInput): StoryScenePlan {
  const { story, scene, characters, recipes, models, workflows, defaults } = input;
  const issues: string[] = [];
  const blockingIssues: string[] = [];

  const castIds = resolveStorySceneCastIds(story, scene);
  const cast = castIds
    .map((id) => characters.find((character) => character.id === id) ?? null)
    .filter((character): character is CharacterProfile => character !== null);
  const lead = cast[0] ?? null;

  const recipeId =
    scene.loraRecipeId ?? story.defaultLoraRecipeId ?? lead?.loraRecipeId ?? null;
  const recipe = recipeId
    ? recipes.find((candidate) => candidate.id === recipeId) ?? null
    : null;
  const recipeSettings = recipe?.settings ?? {};

  const checkpointRef =
    scene.checkpointPath ??
    story.defaultCheckpointPath ??
    lead?.checkpointPath ??
    null;
  const checkpointModel = findCheckpoint(models, checkpointRef);
  const checkpoint = checkpointRef ?? "";
  const architecture = checkpointRef
    ? checkpointModel
      ? getEffectiveArchitecture(checkpointModel)
      : inferModelArchitecture(checkpointRef)
    : "unknown";

  if (!checkpoint) {
    blockingIssues.push(
      "No checkpoint selected. Set a scene, story, or character checkpoint before generating."
    );
  }
  if (checkpoint && !isGenerationSupportedArchitecture(architecture)) {
    blockingIssues.push(
      `${ARCHITECTURE_LABELS[architecture]} checkpoints are not supported by the stock workflows yet.`
    );
  }

  const effectiveLead =
    lead && scene.referenceModeOverride
      ? { ...lead, referenceMode: scene.referenceModeOverride }
      : lead;
  const referencePlan = effectiveLead
    ? resolveCharacterReferencePlan(effectiveLead, architecture)
    : null;

  let mode: StoryScenePlan["mode"] = "txt2img";
  let workflowId = characterTextWorkflowId(architecture);
  let inputImagePath: string | null = null;
  let denoise = 1;
  let referenceActive = false;

  if (effectiveLead && referencePlan) {
    if (referencePlan.active && referencePlan.reference && referencePlan.workflowId) {
      if (input.referenceFileExists(referencePlan.reference.filePath)) {
        mode = "img2img";
        workflowId = referencePlan.workflowId;
        inputImagePath = referencePlan.reference.filePath;
        denoise = referencePlan.denoise;
        referenceActive = true;
      } else {
        issues.push(
          `Primary reference for ${effectiveLead.name} is missing on disk; using text-only identity.`
        );
      }
    } else if (
      effectiveLead.referenceMode === "img2img" &&
      referencePlan.reason === "missing_primary"
    ) {
      issues.push(
        `${effectiveLead.name} uses img2img identity but has no primary reference; using text-only identity.`
      );
    } else if (
      effectiveLead.referenceMode === "ipadapter" ||
      effectiveLead.referenceMode === "controlnet"
    ) {
      issues.push(
        `${effectiveLead.name} requests ${effectiveLead.referenceMode}, which is not installed. Using text-only identity.`
      );
    }
  }

  const workflow = workflows.find((candidate) => candidate.id === workflowId);
  const workflowDefaults = workflow?.defaults;
  const aspectRatio =
    scene.aspectRatio ?? recipeSettings.aspectRatio ?? defaults.aspectRatio;

  let width = scene.width ?? recipeSettings.width ?? null;
  let height = scene.height ?? recipeSettings.height ?? null;
  if (!width || !height) {
    const computed = resolveDimensionsForAspect(
      aspectRatio,
      architecture === "unknown" ? "sdxl" : architecture,
      defaults.performanceProfile,
      dimensionBoundsFromWorkflow(workflow)
    );
    width = width ?? computed.width;
    height = height ?? computed.height;
  }

  let prompt = mergePromptSegments(story.stylePrompt, recipe?.basePrompt, scene.prompt);
  for (const character of cast) {
    prompt = composeCharacterPrompt(character, prompt);
  }

  const negativePrompt = mergePromptSegments(
    story.negativePrompt,
    recipe?.negativePrompt,
    scene.negativePrompt,
    ...cast.map((character) => character.negativePrompt)
  );

  const recipeItems = (recipe?.items ?? []).filter((item) => item.enabled);
  const compatibleItems = recipeItems.filter((item) => {
    const model =
      models.find(
        (candidate) =>
          candidate.category === "lora" &&
          (candidate.relativePath === item.loraPath ||
            candidate.name === item.loraPath)
      ) ?? null;
    const loraArch = model ? getEffectiveArchitecture(model) : item.architecture;
    return evaluateLoraCompatibility(loraArch, architecture).compatible;
  });
  if (compatibleItems.length < recipeItems.length) {
    issues.push(
      `${recipeItems.length - compatibleItems.length} LoRA(s) from recipe '${
        recipe?.name ?? "Unknown"
      }' were skipped because they are not compatible with ${
        ARCHITECTURE_LABELS[architecture]
      }.`
    );
  }

  const loras: LoraSelection[] = compatibleItems.slice(0, 4).map((item) => ({
    name: item.loraPath,
    strengthModel: item.strengthModel,
    strengthClip: item.strengthClip,
  }));

  const randomSeed = !Number.isFinite(scene.seed) || scene.seed < 0;
  const seed = randomSeed ? 0 : Math.floor(scene.seed);
  const sceneDenoise =
    scene.denoise !== null ? clamp(scene.denoise, 0.05, 1) : null;

  if (!scene.prompt.trim() && !story.stylePrompt.trim() && !prompt) {
    issues.push("This scene has no prompt or story style yet.");
  }

  return {
    storyId: story.id,
    sceneId: scene.id,
    workflowId,
    mode,
    prompt,
    negativePrompt,
    checkpoint,
    loras,
    aspectRatio,
    width,
    height,
    steps:
      scene.steps ??
      recipeSettings.steps ??
      workflowDefaults?.steps ??
      defaults.steps,
    cfg:
      scene.cfg ??
      recipeSettings.cfg ??
      workflowDefaults?.cfg ??
      defaults.cfg,
    sampler:
      scene.sampler ??
      recipeSettings.sampler ??
      workflowDefaults?.sampler ??
      defaults.sampler,
    scheduler:
      scene.scheduler ??
      recipeSettings.scheduler ??
      workflowDefaults?.scheduler ??
      defaults.scheduler,
    seed,
    randomSeed,
    batchCount: clamp(
      Math.floor(
        scene.batchCount > 1
          ? scene.batchCount
          : recipeSettings.batchCount ?? scene.batchCount ?? 1
      ),
      1,
      8
    ),
    denoise: mode === "img2img" ? sceneDenoise ?? denoise : 1,
    inputImagePath,
    characterId: lead?.id ?? null,
    loraRecipeId: recipe?.id ?? null,
    architecture,
    referenceActive,
    issues,
    blockingIssues,
  };
}
