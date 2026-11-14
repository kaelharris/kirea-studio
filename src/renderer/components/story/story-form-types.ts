import type {
  CharacterReferenceMode,
  GenerationJob,
  Story,
  StoryCastInput,
  StoryCastRole,
  StoryScene,
  StorySceneCastInput,
  StorySceneStatus,
} from "../../../shared/types";

export type StoryStudioMode = "scenes" | "canvas";

export const CAST_ROLES: StoryCastRole[] = ["lead", "supporting", "cameo"];
export const REFERENCE_MODES: Array<{ value: "" | CharacterReferenceMode; label: string }> = [
  { value: "", label: "Character default" },
  { value: "none", label: "Text only" },
  { value: "img2img", label: "img2img identity" },
  { value: "ipadapter", label: "IPAdapter (not installed)" },
  { value: "controlnet", label: "ControlNet (not installed)" },
];

export const ACTIVE_JOB_STATUSES = new Set<GenerationJob["status"]>([
  "IDLE",
  "VALIDATING",
  "SUBMITTING",
  "QUEUED",
  "RUNNING",
  "PROCESSING_OUTPUT",
]);

export function sceneStatusTone(
  status: StorySceneStatus
): "neutral" | "accent" | "success" | "warning" | "danger" {
  switch (status) {
    case "queued":
      return "warning";
    case "generating":
      return "accent";
    case "completed":
      return "success";
    case "failed":
      return "danger";
    default:
      return "neutral";
  }
}

export function storyStatusTone(
  status: Story["status"]
): "neutral" | "accent" | "success" {
  if (status === "complete") return "success";
  if (status === "in_progress") return "accent";
  return "neutral";
}

export interface StoryFormState {
  title: string;
  logline: string;
  stylePrompt: string;
  negativePrompt: string;
  defaultCharacterId: string;
  defaultCheckpointPath: string;
  defaultLoraRecipeId: string;
  cast: StoryCastInput[];
}

export function toStoryForm(story: Story | null): StoryFormState {
  return {
    title: story?.title ?? "",
    logline: story?.logline ?? "",
    stylePrompt: story?.stylePrompt ?? "",
    negativePrompt: story?.negativePrompt ?? "",
    defaultCharacterId: story?.defaultCharacterId ?? "",
    defaultCheckpointPath: story?.defaultCheckpointPath ?? "",
    defaultLoraRecipeId: story?.defaultLoraRecipeId ?? "",
    cast: (story?.cast ?? []).map((member) => ({
      characterId: member.characterId,
      storyRole: member.storyRole,
    })),
  };
}

export interface SceneFormState {
  title: string;
  synopsis: string;
  prompt: string;
  negativePrompt: string;
  checkpointPath: string;
  loraRecipeId: string;
  aspectRatio: string;
  width: string;
  height: string;
  steps: string;
  cfg: string;
  seed: string;
  denoise: string;
  referenceModeOverride: "" | CharacterReferenceMode;
  batchCount: string;
  cast: StorySceneCastInput[];
}

export function toSceneForm(scene: StoryScene | null): SceneFormState {
  return {
    title: scene?.title ?? "",
    synopsis: scene?.synopsis ?? "",
    prompt: scene?.prompt ?? "",
    negativePrompt: scene?.negativePrompt ?? "",
    checkpointPath: scene?.checkpointPath ?? "",
    loraRecipeId: scene?.loraRecipeId ?? "",
    aspectRatio: scene?.aspectRatio ?? "",
    width: scene?.width != null ? String(scene.width) : "",
    height: scene?.height != null ? String(scene.height) : "",
    steps: scene?.steps != null ? String(scene.steps) : "",
    cfg: scene?.cfg != null ? String(scene.cfg) : "",
    seed: scene?.seed != null ? String(scene.seed) : "-1",
    denoise: scene?.denoise != null ? String(scene.denoise) : "",
    referenceModeOverride: scene?.referenceModeOverride ?? "",
    batchCount: scene ? String(scene.batchCount) : "1",
    cast: (scene?.cast ?? []).map((member) => ({
      characterId: member.characterId,
      roleHint: member.roleHint,
    })),
  };
}

export function parseOptionalNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}
