import {
  BookOpen,
  Clapperboard,
  Compass,
  FolderKanban,
  Grid3X3,
  Home,
  Layers,
  ListChecks,
  Settings,
  Users,
  Wand2,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import type {
  AppSettings,
  GenerationRequest,
  NavSection,
  RuntimeState,
} from "../../shared/types";
import type { UpdateState } from "../../shared/update-types";

export interface ToastItem {
  id: string;
  message: string;
  tone: "info" | "error";
}

export const DEFAULT_SETTINGS: AppSettings = {
  runtimeMode: "external",
  externalComfyPath: "",
  comfyHost: "127.0.0.1",
  comfyPort: 8188,
  pixelBackendHost: "127.0.0.1",
  pixelBackendPort: 8189,
  pixelBackendWorkflowRoot: "",
  managedComfyPath: "",
  autoStartRuntime: false,
  outputDirectory: "",
  extraModelDirs: [],
  downloadDirectory: "",
  cacheDirectory: "",
  tempDirectory: "",
  performanceProfile: "balanced",
  maxActiveJobs: 1,
  defaultBatchSize: 1,
  enableMemoryWarnings: true,
  theme: "dark",
  galleryLayout: "comfortable",
  startupPage: "home",
  defaultSampler: "dpmpp_2m",
  defaultScheduler: "karras",
  defaultSteps: 24,
  defaultCfg: 6.5,
  defaultOutputFormat: "png",
  checkUpdatesAutomatically: true,
  nsfwFilter: true,
  civitaiApiKeySet: false,
  huggingfaceTokenSet: false,
};

export const DEFAULT_UPDATE_STATE: UpdateState = {
  phase: "disabled",
  currentVersion: "",
  availableVersion: null,
  releaseNotes: null,
  releaseDate: null,
  progress: null,
  error: null,
  lastCheckedAt: null,
  channel: "stable",
  canCheck: false,
  dismissed: false,
};

export const DEFAULT_RUNTIME: RuntimeState = {
  status: "disconnected",
  mode: "external",
  apiUrl: "http://127.0.0.1:8188",
  comfyVersion: null,
  pythonVersion: null,
  pytorchVersion: null,
  managedPid: null,
  managedOwned: false,
  detectedExternalPaths: [],
  installedManagedPath: null,
  isConfiguredPathValid: false,
  lastError: null,
  devices: [],
  nodeTypesCount: 0,
  warnings: [],
  wsConnected: false,
};

export const INITIAL_DRAFT: GenerationRequest = {
  workflowId: "t2i_sdxl_base",
  mode: "txt2img",
  prompt: "",
  negativePrompt: "blurry, lowres, watermark, artifacts, distorted anatomy",
  checkpoint: "",
  vae: null,
  loras: [],
  aspectRatio: "1:1",
  width: 1024,
  height: 1024,
  steps: 24,
  cfg: 6.5,
  sampler: "dpmpp_2m",
  scheduler: "karras",
  seed: 42,
  randomSeed: true,
  batchCount: 1,
  batchSize: 1,
  outputFormat: "png",
  inputImagePath: null,
  denoise: 0.55,
  layoutJson: null,
  hiresFix: {
    enabled: false,
    upscaler: "latent_bislerp",
    scale: 1.5,
    steps: 14,
    denoise: 0.42,
  },
  upscale: {
    upscaler: "",
    scale: 4,
  },
};

export const NAV_ITEMS: Array<{
  id: NavSection;
  label: string;
  icon: LucideIcon;
}> = [
  { id: "home", label: "Home", icon: Home },
  { id: "create", label: "Create", icon: Wand2 },
  { id: "video", label: "Video Studio", icon: Clapperboard },
  { id: "explore", label: "Explore", icon: Compass },
  { id: "library", label: "Library", icon: FolderKanban },
  { id: "characters", label: "Characters", icon: Users },
  { id: "pixel", label: "Pixel Studio", icon: Grid3X3 },
  { id: "stories", label: "Stories", icon: BookOpen },
  { id: "models", label: "Models", icon: Layers },
  { id: "workflows", label: "Workflows", icon: Workflow },
  { id: "queue", label: "Queue", icon: ListChecks },
  { id: "settings", label: "Settings", icon: Settings },
];

export const NAV_GROUPS: Array<{ label: string; items: NavSection[] }> = [
  { label: "Workspace", items: ["home", "create", "video", "explore", "library"] },
  { label: "Studio", items: ["characters", "pixel", "stories", "models", "workflows"] },
  { label: "System", items: ["queue", "settings"] },
];

