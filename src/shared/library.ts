import type {
  CharacterProfile,
  GeneratedImageRecord,
  GeneratedVideoRecord,
} from "./types";
import type {
  PixelAssetRecord,
  PixelDirection,
  PixelKind,
} from "./pixel-types";

export type LibraryMediaType =
  | "image"
  | "video"
  | "pixel"
  | "character"
  | "animation";

export type LibraryMediaFilter = "all" | LibraryMediaType;

export type LibraryWorkspace = "create" | "video" | "pixel" | "characters";

export interface LibraryPixelAnimationSummary {
  name: string;
  frameCount: number;
  durationMs: number;
  loop: boolean;
}

interface LibraryMediaBase {
  /** Stable, namespaced identity (`image:<id>`) so repository IDs can never collide. */
  id: string;
  mediaType: LibraryMediaType;
  sourceId: string;
  title: string;
  description: string;
  /** Metadata-only path used for a thumbnail. Never a loaded bitmap. */
  thumbnailPath: string | null;
  /** Original media path for playback or full preview. */
  mediaPath: string | null;
  width: number | null;
  height: number | null;
  model: string | null;
  workflowId: string | null;
  tags: string[];
  favorite: boolean;
  favoriteSupported: boolean;
  collectionId: string | null;
  createdAt: string;
  updatedAt: string;
  available: boolean;
  workspace: LibraryWorkspace;
}

export interface LibraryImageItem extends LibraryMediaBase {
  mediaType: "image";
  image: GeneratedImageRecord;
}

export interface LibraryVideoItem extends LibraryMediaBase {
  mediaType: "video";
  video: GeneratedVideoRecord;
  durationSeconds: number;
  fps: number;
  frameCount: number;
}

export interface LibraryPixelItem extends LibraryMediaBase {
  mediaType: "pixel";
  pixel: PixelAssetRecord;
  pixelKind: PixelKind;
  characterId: string | null;
  characterName: string | null;
  direction: PixelDirection | null;
  version: number;
  frameCount: number;
  animations: LibraryPixelAnimationSummary[];
}

export interface LibraryAnimationItem extends LibraryMediaBase {
  mediaType: "animation";
  pixel: PixelAssetRecord;
  animationName: string;
  pixelKind: PixelKind;
  characterId: string | null;
  characterName: string | null;
  frameCount: number;
  durationMs: number;
  loop: boolean;
}

export interface LibraryCharacterItem extends LibraryMediaBase {
  mediaType: "character";
  character: CharacterProfile;
  referenceCount: number;
  architecture: string;
}

export type LibraryMediaItem =
  | LibraryImageItem
  | LibraryVideoItem
  | LibraryPixelItem
  | LibraryAnimationItem
  | LibraryCharacterItem;

export type LibraryAspectRatioFilter = "all" | "landscape" | "portrait" | "square";

export interface LibraryMediaQuery {
  mediaType?: LibraryMediaFilter;
  search?: string;
  favoriteOnly?: boolean;
  collectionId?: string | null;
  sortBy?: "newest" | "oldest" | "name";
  model?: string;
  aspectRatio?: LibraryAspectRatioFilter;
}

export interface LibraryMediaResult {
  items: LibraryMediaItem[];
  counts: Record<LibraryMediaFilter, number>;
  models: string[];
}

export interface LibraryBatchDeleteResult {
  deletedIds: string[];
  failedIds: string[];
}

export interface LibraryBatchExportResult {
  exportedCount: number;
  destinationDir: string;
}

export interface LibraryBatchCollectionResult {
  updatedCount: number;
}

export interface LibraryBatchFavoriteResult {
  updatedCount: number;
}

export const LIBRARY_MEDIA_LABELS: Record<LibraryMediaFilter, string> = {
  all: "All",
  image: "Images",
  video: "Videos",
  pixel: "Pixel Art",
  character: "Characters",
  animation: "Animations",
};

export const LIBRARY_MEDIA_TYPES: LibraryMediaFilter[] = [
  "all",
  "image",
  "video",
  "pixel",
  "character",
  "animation",
];
