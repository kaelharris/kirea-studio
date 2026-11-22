import type React from "react";
import { LATENT_UPSCALER_BISLERP } from "../../../shared/aspect-ratios";
import type {
  AppSettings,
  CharacterProfile,
  GeneratedImageRecord,
  GenerationJob,
  GenerationRequest,
  HiresFixConfig,
  LoraRecipe,
  LoraRecipeInput,
  ModelRecord,
  PerformanceProfile,
  RuntimeState,
  UpscaleConfig,
  WorkflowTemplate,
} from "../../../shared/types";

export interface CreatePageProps {
  draft: GenerationRequest;
  setDraft: React.Dispatch<React.SetStateAction<GenerationRequest>>;
  settings: AppSettings;
  runtime: RuntimeState;
  models: ModelRecord[];
  workflows: WorkflowTemplate[];
  samplersAndSchedulers: { samplers: string[]; schedulers: string[] };
  jobs: GenerationJob[];
  images: GeneratedImageRecord[];
  recipes: LoraRecipe[];
  characters: CharacterProfile[];
  activeCharacterId: string | null;
  onSelectCharacter: (characterId: string | null) => void;
  onOpenCharacters: () => void;
  activeRecipeId: string | null;
  onSelectRecipe: (recipeId: string | null) => void;
  onSaveRecipe: (input: LoraRecipeInput) => Promise<LoraRecipe>;
  onChangeProfile: (profile: PerformanceProfile) => Promise<void>;
  onInspectImage: (
    img: GeneratedImageRecord,
    collection?: GeneratedImageRecord[]
  ) => void;
  onToggleFavorite: (id: string) => Promise<void>;
  onSavePrompt: (record: {
    title: string;
    prompt: string;
    negativePrompt: string;
  }) => Promise<void>;
  onUpdateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  onToast: (msg: string, tone?: "info" | "error") => void;
}

export const DEFAULT_HIRES_CONFIG: HiresFixConfig = {
  enabled: false,
  upscaler: LATENT_UPSCALER_BISLERP,
  scale: 1.5,
  steps: 14,
  denoise: 0.42,
};

export const DEFAULT_UPSCALE_CONFIG: UpscaleConfig = {
  upscaler: "",
  scale: 4,
};

export function describeUpscalerLabel(name: string): string {
  const lower = name.toLowerCase();
  const stem = name.replace(/\.[^.]+$/, "");
  if (lower.includes("animesharp")) return `[Anime Sharp 4×] ${stem}`;
  if (lower.includes("anime_6b")) return `[Anime 4×] ${stem}`;
  if (lower.includes("remacri")) return `[Sharp Detail 4×] ${stem}`;
  if (lower.includes("realesrgan_x4plus")) return `[Photo 4×] ${stem}`;
  return stem;
}
