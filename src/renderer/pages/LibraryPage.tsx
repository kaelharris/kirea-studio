import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Boxes,
  Brush,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Expand,
  ExternalLink,
  FileText,
  Film,
  FolderOpen,
  FolderPlus,
  Grid,
  Heart,
  Image as ImageIcon,
  ImageOff,
  Layers,
  LayoutGrid,
  List,
  Maximize2,
  Pause,
  Play,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  Users,
  Volume2,
  VolumeX,
  Wand2,
  X,
} from "lucide-react";
import type {
  CharacterProfile,
  CharacterProfileInput,
  CollectionRecord,
  GeneratedImageRecord,
  NavSection,
} from "../../shared/types";
import {
  LIBRARY_MEDIA_LABELS,
  LIBRARY_MEDIA_TYPES,
  type LibraryAspectRatioFilter,
  type LibraryMediaFilter,
  type LibraryMediaItem,
  type LibraryMediaQuery,
  type LibraryMediaResult,
  type LibraryMediaType,
} from "../../shared/library";
import { imageWorkflowLabels } from "../../shared/image-labels";
import {
  Badge,
  Button,
  EmptyState,
  Input,
  Modal,
  SectionHeader,
  Select,
  useContextMenu,
  type ContextMenuItem,
} from "../components/ui/Primitives";
import { MediaImage } from "../components/ui/MediaImage";
import { CopyPromptButton } from "../components/CopyPromptButton";
import {
  formatBytes,
  formatDurationSeconds,
  formatRelativeTime,
  shortModelLabel,
  toMediaUrl,
} from "../utils/format";

interface LibraryPageProps {
  /** Refresh signal: new image ids while the page is mounted. */
  images: GeneratedImageRecord[];
  collections: CollectionRecord[];
  density: "comfortable" | "compact";
  onInspectImage: (
    img: GeneratedImageRecord,
    collection?: GeneratedImageRecord[]
  ) => void;
  onReuseSettings: (img: GeneratedImageRecord) => void;
  onSendToWorkflow?: (
    img: GeneratedImageRecord,
    workflow: "edit" | "inpaint" | "outpaint" | "variations" | "upscale"
  ) => void;
  onToggleFavorite: (id: string) => Promise<void>;
  onDeleteImage: (id: string) => Promise<void>;
  /** Removes library entries whose files can no longer be loaded. */
  onRemoveMissing: (ids: string[]) => Promise<void>;
  onDeleteCharacter: (id: string) => Promise<boolean>;
  onSaveCharacter: (input: CharacterProfileInput) => Promise<CharacterProfile>;
  onCreateCollection: (name: string, desc: string) => Promise<void>;
  onDeleteCollection: (id: string) => Promise<void>;
  onOpenVideo: (videoId: string) => void;
  onOpenPixelAsset: (assetId: string, tab: "editor" | "animation") => void;
  onOpenCharacter: (characterId: string) => void;
  onNavigate: (page: NavSection) => void;
  onToast: (message: string, tone?: "info" | "error") => void;
}

const EMPTY_RESULT: LibraryMediaResult = {
  items: [],
  counts: { all: 0, image: 0, video: 0, pixel: 0, character: 0, animation: 0 },
  models: [],
};

const VIEW_STORAGE_KEY = "kirea.library.view";
const TYPE_ICONS: Record<LibraryMediaType, React.ReactNode> = {
  image: <ImageIcon className="h-3 w-3" />,
  video: <Film className="h-3 w-3" />,
  pixel: <Boxes className="h-3 w-3" />,
  character: <Users className="h-3 w-3" />,
  animation: <Play className="h-3 w-3" />,
};
const TYPE_TONES: Record<
  LibraryMediaType,
  "neutral" | "accent" | "creative" | "success" | "sand" | "warning"
> = {
  image: "accent",
  video: "creative",
  pixel: "success",
  character: "sand",
  animation: "warning",
};

export const LibraryPage: React.FC<LibraryPageProps> = ({
  images,
  collections,
  density,
  onInspectImage,
  onReuseSettings,
  onSendToWorkflow,
  onToggleFavorite,
  onDeleteImage,
  onRemoveMissing,
  onDeleteCharacter,
  onSaveCharacter,
  onCreateCollection,
  onDeleteCollection,
  onOpenVideo,
  onOpenPixelAsset,
  onOpenCharacter,
  onNavigate,
  onToast,
}) => {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [mediaType, setMediaType] = useState<LibraryMediaFilter>("all");
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [collectionFilter, setCollectionFilter] = useState<string>("all");
  const [modelFilter, setModelFilter] = useState<string>("all");
  const [aspectRatioFilter, setAspectRatioFilter] = useState<LibraryAspectRatioFilter>("all");
  const [sortBy, setSortBy] = useState<"newest" | "oldest" | "name">("newest");
  const [view, setView] = useState<"grid" | "list">(() => {
    const stored = localStorage.getItem(VIEW_STORAGE_KEY);
    return stored === "list" ? "list" : "grid";
  });
  const [galleryMode, setGalleryMode] = useState<"natural" | "square">(() => {
    const stored = localStorage.getItem("kirea.library.gallery_mode");
    return stored === "square" ? "square" : "natural";
  });
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const lastSelectedIndexRef = useRef<number | null>(null);
  const [result, setResult] = useState<LibraryMediaResult>(EMPTY_RESULT);
  const [loading, setLoading] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);
  const [failedIds, setFailedIds] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState<LibraryMediaItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<LibraryMediaItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [missingRemovalOpen, setMissingRemovalOpen] = useState(false);
  const [removingMissing, setRemovingMissing] = useState(false);
  const [newColOpen, setNewColOpen] = useState(false);
  const [colName, setColName] = useState("");
  const [colDesc, setColDesc] = useState("");

  // Batch Selection State
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [batchDeleteModalOpen, setBatchDeleteModalOpen] = useState(false);
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [batchExporting, setBatchExporting] = useState(false);
  const [batchFavoriting, setBatchFavoriting] = useState(false);
  const [batchCollectionModalOpen, setBatchCollectionModalOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem(VIEW_STORAGE_KEY, view);
  }, [view]);

  useEffect(() => {
    localStorage.setItem("kirea.library.gallery_mode", galleryMode);
  }, [galleryMode]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 200);
    return () => clearTimeout(timer);
  }, [search]);

  const imagesKey = useMemo(() => images.map((image) => image.id).join("|"), [images]);

  const query = useMemo<LibraryMediaQuery>(
    () => ({
      mediaType,
      search: debouncedSearch.trim() || undefined,
      favoriteOnly: favoriteOnly || undefined,
      collectionId: collectionFilter === "all" ? null : collectionFilter,
      sortBy,
      model: modelFilter === "all" ? undefined : modelFilter,
      aspectRatio: aspectRatioFilter === "all" ? undefined : aspectRatioFilter,
    }),
    [mediaType, debouncedSearch, favoriteOnly, collectionFilter, sortBy, modelFilter, aspectRatioFilter]
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    window.kirea
      .listLibraryMedia(query)
      .then((res) => {
        if (cancelled) return;
        setResult(res);
        setFailedIds(new Set());
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setResult(EMPTY_RESULT);
        onToast(
          error instanceof Error ? error.message : "Could not load the media library.",
          "error"
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query, imagesKey, refreshTick, onToast]);

  useEffect(() => {
    return window.kirea.onVideoCreated(() => setRefreshTick((tick) => tick + 1));
  }, []);

  useEffect(() => {
    if (!selected) return;
    const match = result.items.find((item) => item.id === selected.id);
    if (match && match !== selected) setSelected(match);
  }, [result.items, selected]);

  const refresh = useCallback(() => setRefreshTick((tick) => tick + 1), []);

  const isAvailable = useCallback(
    (item: LibraryMediaItem): boolean => item.available && !failedIds.has(item.id),
    [failedIds]
  );

  const markFailed = useCallback((id: string) => {
    setFailedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  const missingItems = useMemo(
    () =>
      result.items.filter(
        (item) => item.mediaType !== "animation" && !isAvailable(item)
      ),
    [result.items, isAvailable]
  );

  // Images in the order currently rendered, so the viewer's arrows stay inside
  // the active search, type, collection, model and orientation filters.
  const visibleImages = useMemo(
    () =>
      result.items.flatMap((item) =>
        item.mediaType === "image" && item.image ? [item.image] : []
      ),
    [result.items]
  );

  // Keyboard navigation across library items inside the inspector
  const selectedIndex = useMemo(() => {
    if (!selected) return -1;
    return result.items.findIndex((item) => item.id === selected.id);
  }, [selected, result.items]);

  const handlePrevItem = useCallback(() => {
    if (result.items.length === 0) return;
    if (selectedIndex > 0) {
      setSelected(result.items[selectedIndex - 1]!);
    } else if (selectedIndex === 0) {
      setSelected(result.items[result.items.length - 1]!);
    }
  }, [selectedIndex, result.items]);

  const handleNextItem = useCallback(() => {
    if (result.items.length === 0) return;
    if (selectedIndex >= 0 && selectedIndex < result.items.length - 1) {
      setSelected(result.items[selectedIndex + 1]!);
    } else if (selectedIndex === result.items.length - 1) {
      setSelected(result.items[0]!);
    }
  }, [selectedIndex, result.items]);

  useEffect(() => {
    if (!selected) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || target?.isContentEditable) {
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        handlePrevItem();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        handleNextItem();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selected, handlePrevItem, handleNextItem]);

  useEffect(() => {
    setFocusedIndex(-1);
    lastSelectedIndexRef.current = null;
  }, [query]);

  // Batch selection handlers
  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelectedIds(new Set(result.items.map((item) => item.id)));
  }, [result.items]);

  const handleInvertSelection = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set<string>();
      for (const item of result.items) {
        if (!prev.has(item.id)) {
          next.add(item.id);
        }
      }
      return next;
    });
  }, [result.items]);

  const handleDeselectAll = useCallback(() => {
    setSelectedIds(new Set());
    setIsSelectMode(false);
    lastSelectedIndexRef.current = null;
  }, []);

  const handleCardClick = useCallback(
    (index: number, item: LibraryMediaItem, e?: React.MouseEvent) => {
      setFocusedIndex(index);
      if (e?.shiftKey && lastSelectedIndexRef.current !== null) {
        const start = Math.min(lastSelectedIndexRef.current, index);
        const end = Math.max(lastSelectedIndexRef.current, index);
        const rangeIds = result.items.slice(start, end + 1).map((it) => it.id);
        setSelectedIds((prev) => {
          const next = new Set(prev);
          for (const id of rangeIds) next.add(id);
          return next;
        });
        setIsSelectMode(true);
        return;
      }

      if (isSelectMode || e?.ctrlKey || e?.metaKey) {
        handleToggleSelect(item.id);
        lastSelectedIndexRef.current = index;
        return;
      }

      lastSelectedIndexRef.current = index;
      if (item.mediaType === "image" && item.image && onInspectImage) {
        onInspectImage(item.image, visibleImages);
      } else {
        setSelected(item);
      }
    },
    [isSelectMode, result.items, handleToggleSelect, onInspectImage, visibleImages]
  );

  const handleCheckboxClick = useCallback(
    (index: number, item: LibraryMediaItem, e?: React.MouseEvent) => {
      setFocusedIndex(index);
      if (e?.shiftKey && lastSelectedIndexRef.current !== null) {
        const start = Math.min(lastSelectedIndexRef.current, index);
        const end = Math.max(lastSelectedIndexRef.current, index);
        const rangeIds = result.items.slice(start, end + 1).map((it) => it.id);
        setSelectedIds((prev) => {
          const next = new Set(prev);
          for (const id of rangeIds) next.add(id);
          return next;
        });
        setIsSelectMode(true);
        return;
      }
      handleToggleSelect(item.id);
      lastSelectedIndexRef.current = index;
    },
    [result.items, handleToggleSelect]
  );

  // Gallery keyboard navigation (Active when no modal is open)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || target?.isContentEditable) {
        return;
      }
      if (
        selected ||
        deleteTarget ||
        missingRemovalOpen ||
        newColOpen ||
        batchDeleteModalOpen ||
        batchCollectionModalOpen
      ) {
        return;
      }

      // Alt+A or Ctrl+A (Select All)
      if ((e.ctrlKey || e.altKey) && (e.key === "a" || e.key === "A")) {
        e.preventDefault();
        handleSelectAll();
        return;
      }

      // Alt+I or Ctrl+I (Invert Selection)
      if ((e.ctrlKey || e.altKey) && (e.key === "i" || e.key === "I") && isSelectMode) {
        e.preventDefault();
        handleInvertSelection();
        return;
      }

      // Escape (Deselect All)
      if (e.key === "Escape") {
        if (selectedIds.size > 0 || isSelectMode) {
          e.preventDefault();
          handleDeselectAll();
          return;
        }
      }

      if (result.items.length === 0) return;

      // Home & End
      if (e.key === "Home") {
        e.preventDefault();
        setFocusedIndex(0);
        lastSelectedIndexRef.current = 0;
        return;
      }
      if (e.key === "End") {
        e.preventDefault();
        const lastIdx = result.items.length - 1;
        setFocusedIndex(lastIdx);
        lastSelectedIndexRef.current = lastIdx;
        return;
      }

      // Space: Toggle selection
      if (e.key === " ") {
        if (focusedIndex >= 0 && focusedIndex < result.items.length) {
          e.preventDefault();
          const item = result.items[focusedIndex];
          if (item) {
            handleToggleSelect(item.id);
            lastSelectedIndexRef.current = focusedIndex;
          }
        }
        return;
      }

      // Enter: Inspect / Open
      if (e.key === "Enter") {
        if (focusedIndex >= 0 && focusedIndex < result.items.length) {
          e.preventDefault();
          const item = result.items[focusedIndex];
          if (item) {
            if (item.mediaType === "image" && onInspectImage) {
              onInspectImage(item.image, visibleImages);
            } else {
              setSelected(item);
            }
          }
        }
        return;
      }

      // Delete / Backspace: Delete with confirmation
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedIds.size > 0) {
          e.preventDefault();
          setBatchDeleteModalOpen(true);
          return;
        } else if (focusedIndex >= 0 && focusedIndex < result.items.length) {
          e.preventDefault();
          const item = result.items[focusedIndex];
          if (item && item.mediaType !== "animation") {
            setDeleteTarget(item);
          }
          return;
        }
      }

      // Arrow keys navigation
      let nextIndex = focusedIndex;
      const total = result.items.length;
      const columns = density === "compact" ? 5 : 3;

      if (e.key === "ArrowRight") {
        e.preventDefault();
        nextIndex = focusedIndex < 0 ? 0 : Math.min(total - 1, focusedIndex + 1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        nextIndex = focusedIndex < 0 ? 0 : Math.max(0, focusedIndex - 1);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        nextIndex = focusedIndex < 0 ? 0 : Math.min(total - 1, focusedIndex + columns);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        nextIndex = focusedIndex < 0 ? 0 : Math.max(0, focusedIndex - columns);
      } else {
        return;
      }

      if (nextIndex !== focusedIndex) {
        setFocusedIndex(nextIndex);
        if (e.shiftKey && lastSelectedIndexRef.current !== null) {
          const start = Math.min(lastSelectedIndexRef.current, nextIndex);
          const end = Math.max(lastSelectedIndexRef.current, nextIndex);
          const rangeIds = result.items.slice(start, end + 1).map((it) => it.id);
          setSelectedIds((prev) => {
            const next = new Set(prev);
            for (const id of rangeIds) next.add(id);
            return next;
          });
          setIsSelectMode(true);
        } else if (!e.shiftKey) {
          lastSelectedIndexRef.current = nextIndex;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    selected,
    deleteTarget,
    missingRemovalOpen,
    newColOpen,
    batchDeleteModalOpen,
    batchCollectionModalOpen,
    result.items,
    focusedIndex,
    density,
    selectedIds,
    isSelectMode,
    handleSelectAll,
    handleDeselectAll,
    handleToggleSelect,
    onInspectImage,
    visibleImages,
  ]);

  useEffect(() => {
    if (focusedIndex >= 0 && focusedIndex < result.items.length) {
      const item = result.items[focusedIndex];
      if (item) {
        const el = document.querySelector(`[data-library-card-id="${item.id}"]`);
        if (el) {
          el.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }
      }
    }
  }, [focusedIndex, result.items]);

  const handleBatchFavorite = async (favorite: boolean) => {
    if (selectedIds.size === 0) return;
    setBatchFavoriting(true);
    try {
      const res = await window.kirea.batchSetLibraryFavorite(Array.from(selectedIds), favorite);
      onToast(
        favorite
          ? `Added ${res.updatedCount} item${res.updatedCount === 1 ? "" : "s"} to favorites.`
          : `Removed ${res.updatedCount} item${res.updatedCount === 1 ? "" : "s"} from favorites.`
      );
      refresh();
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Failed to update favorites.", "error");
    } finally {
      setBatchFavoriting(false);
    }
  };

  const handleBatchAssignCollection = async (collectionId: string | null) => {
    if (selectedIds.size === 0) return;
    try {
      const res = await window.kirea.batchSetLibraryCollection(Array.from(selectedIds), collectionId);
      onToast(`Updated collection for ${res.updatedCount} image${res.updatedCount === 1 ? "" : "s"}.`);
      setBatchCollectionModalOpen(false);
      refresh();
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Failed to update collection.", "error");
    }
  };

  const handleBatchExport = async () => {
    if (selectedIds.size === 0) return;
    const dest = await window.kirea.pickDirectory("Select destination folder for batch export");
    if (!dest) return;
    setBatchExporting(true);
    try {
      const res = await window.kirea.batchExportLibraryMedia(Array.from(selectedIds), dest);
      onToast(`Exported ${res.exportedCount} item${res.exportedCount === 1 ? "" : "s"} to ${pathBasename(dest)}.`);
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Failed to export selected items.", "error");
    } finally {
      setBatchExporting(false);
    }
  };

  const handleConfirmBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    setBatchDeleting(true);
    try {
      const res = await window.kirea.batchDeleteLibraryMedia(Array.from(selectedIds));
      onToast(`Deleted ${res.deletedIds.length} item${res.deletedIds.length === 1 ? "" : "s"}.`);
      setBatchDeleteModalOpen(false);
      setSelectedIds(new Set());
      setIsSelectMode(false);
      if (selected && selectedIds.has(selected.id)) {
        setSelected(null);
      }
      refresh();
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Failed to delete items.", "error");
    } finally {
      setBatchDeleting(false);
    }
  };

  const selectedBreakdown = useMemo(() => {
    let imageCount = 0;
    let videoCount = 0;
    let pixelCount = 0;
    let characterCount = 0;
    for (const id of selectedIds) {
      if (id.startsWith("image:")) imageCount++;
      else if (id.startsWith("video:")) videoCount++;
      else if (id.startsWith("pixel:")) pixelCount++;
      else if (id.startsWith("character:")) characterCount++;
    }
    return { imageCount, videoCount, pixelCount, characterCount, total: selectedIds.size };
  }, [selectedIds]);

  const closeInspector = (): void => setSelected(null);

  const openWorkspace = (item: LibraryMediaItem): void => {
    switch (item.mediaType) {
      case "image":
        onReuseSettings(item.image);
        break;
      case "video":
        onOpenVideo(item.sourceId);
        break;
      case "pixel":
        onOpenPixelAsset(item.sourceId, "editor");
        break;
      case "animation":
        onOpenPixelAsset(item.sourceId, "animation");
        break;
      case "character":
        onOpenCharacter(item.sourceId);
        break;
    }
    closeInspector();
  };

  const toggleFavorite = async (item: LibraryMediaItem): Promise<void> => {
    try {
      if (item.mediaType === "image") {
        await onToggleFavorite(item.sourceId);
      } else if (item.mediaType === "video") {
        await window.kirea.toggleVideoFavorite(item.sourceId);
      } else if (item.mediaType === "character") {
        await onSaveCharacter(characterInputWithFavorite(item.character));
      } else {
        return;
      }
      refresh();
    } catch (error) {
      onToast(
        error instanceof Error ? error.message : "Could not update the favorite.",
        "error"
      );
    }
  };

  const removeItem = async (item: LibraryMediaItem): Promise<void> => {
    switch (item.mediaType) {
      case "image":
        await onDeleteImage(item.sourceId);
        break;
      case "video":
        await window.kirea.deleteVideo(item.sourceId);
        break;
      case "pixel":
        await window.kirea.deletePixelAsset(item.sourceId);
        break;
      case "character":
        await onDeleteCharacter(item.sourceId);
        break;
      case "animation":
        return;
    }
    onToast("Removed from the library. The workspace repository was updated.");
    refresh();
  };

  const confirmDelete = async (): Promise<void> => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await removeItem(deleteTarget);
      setDeleteTarget(null);
      if (selected?.id === deleteTarget.id) setSelected(null);
    } catch (error) {
      onToast(
        error instanceof Error ? error.message : "Could not delete this item.",
        "error"
      );
    } finally {
      setDeleting(false);
    }
  };

  const confirmRemoveMissing = async (): Promise<void> => {
    setRemovingMissing(true);
    try {
      const images = missingItems.filter((item) => item.mediaType === "image");
      const videos = missingItems.filter((item) => item.mediaType === "video");
      const pixels = new Set(
        missingItems
          .filter((item) => item.mediaType === "pixel")
          .map((item) => item.sourceId)
      );
      const characters = missingItems.filter((item) => item.mediaType === "character");

      if (images.length > 0) {
        await onRemoveMissing(images.map((item) => item.sourceId));
      }
      for (const item of videos) {
        await window.kirea.deleteVideo(item.sourceId);
      }
      for (const assetId of pixels) {
        await window.kirea.deletePixelAsset(assetId);
      }
      for (const item of characters) {
        await onDeleteCharacter(item.sourceId);
      }
      onToast(
        `Cleared ${missingItems.length} missing ${
          missingItems.length === 1 ? "entry" : "entries"
        }.`
      );
      setMissingRemovalOpen(false);
      setSelected(null);
      refresh();
    } catch (error) {
      onToast(
        error instanceof Error ? error.message : "Could not clear every missing entry.",
        "error"
      );
    } finally {
      setRemovingMissing(false);
    }
  };

  const handleCreateCollection = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (!colName.trim()) return;
    await onCreateCollection(colName.trim(), colDesc.trim());
    setColName("");
    setColDesc("");
    setNewColOpen(false);
  };

  const { showContextMenu } = useContextMenu();

  const handleAssignItemCollection = async (itemId: string, collectionId: string | null) => {
    try {
      await window.kirea.batchSetLibraryCollection([itemId], collectionId);
      onToast("Updated collection.");
      refresh();
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Failed to update collection.", "error");
    }
  };

  const handleItemContextMenu = useCallback(
    (e: React.MouseEvent, item: LibraryMediaItem) => {
      e.preventDefault();
      e.stopPropagation();

      const isItemInMultiSelection = selectedIds.has(item.id) && selectedIds.size > 1;

      if (isItemInMultiSelection) {
        const items: ContextMenuItem[] = [
          {
            id: "bulk-collection",
            label: `Add ${selectedIds.size} items to collection...`,
            icon: <FolderPlus className="w-3.5 h-3.5" />,
            onClick: () => setBatchCollectionModalOpen(true),
          },
          {
            id: "bulk-favorite",
            label: `Favorite ${selectedIds.size} items`,
            icon: <Heart className="w-3.5 h-3.5" />,
            onClick: () => void handleBatchFavorite(true),
          },
          {
            id: "bulk-unfavorite",
            label: `Unfavorite ${selectedIds.size} items`,
            icon: <Heart className="w-3.5 h-3.5" />,
            onClick: () => void handleBatchFavorite(false),
          },
          {
            id: "bulk-export",
            label: `Export ${selectedIds.size} items...`,
            icon: <Download className="w-3.5 h-3.5" />,
            onClick: () => void handleBatchExport(),
            separator: true,
          },
          {
            id: "bulk-select-all",
            label: "Select All",
            shortcut: "Ctrl+A",
            onClick: handleSelectAll,
          },
          {
            id: "bulk-deselect",
            label: "Deselect All",
            shortcut: "Esc",
            onClick: handleDeselectAll,
            separator: true,
          },
          {
            id: "bulk-delete",
            label: `Delete ${selectedIds.size} items`,
            icon: <Trash2 className="w-3.5 h-3.5" />,
            destructive: true,
            onClick: () => setBatchDeleteModalOpen(true),
          },
        ];

        showContextMenu({
          x: e.clientX,
          y: e.clientY,
          title: `${selectedIds.size} items selected`,
          items,
        });
        return;
      }

      // Single item context menu
      const isImage = item.mediaType === "image" && item.image;
      const menuItems: ContextMenuItem[] = [
        {
          id: "open-item",
          label: isImage ? "Open in Fullscreen Preview" : "Open Asset",
          icon: <Maximize2 className="w-3.5 h-3.5" />,
          onClick: () => {
            if (isImage && item.image) {
              onInspectImage(item.image, visibleImages);
            } else {
              setSelected(item);
            }
          },
        },
        {
          id: "show-details",
          label: "Show Details & Metadata",
          icon: <FileText className="w-3.5 h-3.5" />,
          onClick: () => setSelected(item),
          separator: Boolean(isImage),
        },
      ];

      if (isImage && item.image) {
        const img = item.image;
        menuItems.push(
          {
            id: "create-edit",
            label: "Edit Image / Img2Img",
            icon: <Wand2 className="w-3.5 h-3.5" />,
            onClick: () => {
              if (onSendToWorkflow) onSendToWorkflow(img, "edit");
              else onReuseSettings(img);
            },
          },
          {
            id: "create-inpaint",
            label: "Inpaint (Brush Mask)",
            icon: <Brush className="w-3.5 h-3.5" />,
            onClick: () => {
              if (onSendToWorkflow) onSendToWorkflow(img, "inpaint");
              else onReuseSettings(img);
            },
          },
          {
            id: "create-outpaint",
            label: "Outpaint (Expand Canvas)",
            icon: <Expand className="w-3.5 h-3.5" />,
            onClick: () => {
              if (onSendToWorkflow) onSendToWorkflow(img, "outpaint");
              else onReuseSettings(img);
            },
          },
          {
            id: "create-variations",
            label: "Generate Variations",
            icon: <Layers className="w-3.5 h-3.5" />,
            onClick: () => {
              if (onSendToWorkflow) onSendToWorkflow(img, "variations");
              else onReuseSettings(img);
            },
          },
          {
            id: "create-upscale",
            label: "Upscale 4×",
            icon: <Maximize2 className="w-3.5 h-3.5" />,
            onClick: () => {
              if (onSendToWorkflow) onSendToWorkflow(img, "upscale");
              else onReuseSettings(img);
            },
            separator: true,
          }
        );
      }

      // Manage group
      if (item.favoriteSupported) {
        menuItems.push({
          id: "toggle-fav",
          label: item.favorite ? "Remove from Favorites" : "Add to Favorites",
          icon: <Heart className="w-3.5 h-3.5" />,
          onClick: () => void toggleFavorite(item),
        });
      }

      if (collections.length > 0) {
        menuItems.push({
          id: "add-to-collection",
          label: "Add to Collection...",
          icon: <FolderPlus className="w-3.5 h-3.5" />,
          children: [
            ...collections.map((col) => ({
              id: `col-${col.id}`,
              label: col.name,
              onClick: () => {
                void handleAssignItemCollection(item.id, col.id);
              },
            })),
            {
              id: "col-none",
              label: "Remove from Collections",
              onClick: () => {
                void handleAssignItemCollection(item.id, null);
              },
            },
          ],
        });
      }

      if (isImage && item.image?.prompt) {
        menuItems.push({
          id: "copy-prompt",
          label: "Copy Prompt",
          icon: <Copy className="w-3.5 h-3.5" />,
          onClick: () => {
            void navigator.clipboard.writeText(item.image!.prompt);
            onToast("Prompt copied to clipboard.");
          },
        });
      }

      if (item.mediaPath) {
        menuItems.push({
          id: "copy-path",
          label: "Copy File Path",
          icon: <Copy className="w-3.5 h-3.5" />,
          onClick: () => {
            void navigator.clipboard.writeText(item.mediaPath!);
            onToast("File path copied to clipboard.");
          },
        });
        menuItems.push({
          id: "reveal-path",
          label: "Reveal in File Explorer",
          icon: <FolderOpen className="w-3.5 h-3.5" />,
          onClick: () => {
            void window.kirea.openPath(item.mediaPath!);
          },
          separator: item.mediaType !== "animation",
        });
      }

      if (item.mediaType !== "animation") {
        menuItems.push({
          id: "delete-item",
          label: "Delete Asset",
          icon: <Trash2 className="w-3.5 h-3.5" />,
          destructive: true,
          onClick: () => setDeleteTarget(item),
        });
      }

      showContextMenu({
        x: e.clientX,
        y: e.clientY,
        title: item.title,
        items: menuItems,
      });
    },
    [
      selectedIds,
      visibleImages,
      onInspectImage,
      onSendToWorkflow,
      onReuseSettings,
      toggleFavorite,
      collections,
      onToast,
      showContextMenu,
    ]
  );

  const handleEmptyAreaContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest("[data-library-card-id]")) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();

      const items: ContextMenuItem[] = [
        {
          id: "empty-refresh",
          label: "Refresh Library",
          icon: <RotateCcw className="w-3.5 h-3.5" />,
          onClick: refresh,
        },
        {
          id: "empty-new-col",
          label: "New Collection...",
          icon: <FolderPlus className="w-3.5 h-3.5" />,
          onClick: () => setNewColOpen(true),
          separator: true,
        },
        {
          id: "empty-select-all",
          label: "Select All",
          shortcut: "Ctrl+A",
          disabled: result.items.length === 0,
          onClick: handleSelectAll,
        },
      ];

      if (selectedIds.size > 0) {
        items.push({
          id: "empty-deselect",
          label: "Deselect All",
          shortcut: "Esc",
          onClick: handleDeselectAll,
        });
      }

      showContextMenu({
        x: e.clientX,
        y: e.clientY,
        title: "Library Workspace",
        items,
      });
    },
    [refresh, result.items.length, selectedIds.size, handleSelectAll, handleDeselectAll, showContextMenu]
  );

  const isEmptyLibrary =
    result.counts.all === 0 && result.counts.animation === 0 && !debouncedSearch;

  return (
    <div className="relative space-y-3.5 pb-16" onContextMenu={handleEmptyAreaContextMenu}>
      <div className="sticky -top-6 z-10 -mx-6 space-y-2.5 border-b border-border bg-bg px-5 pb-2.5 pt-4">
        <SectionHeader
          title="Media Library"
          subtitle="Every image, video, pixel asset, character and animation created in Kirea — inspect, organize, batch export, and jump back into the studio that owns it."
          actions={
            <div className="flex items-center gap-2">
              <Button
                variant={isSelectMode ? "accent" : "secondary"}
                onClick={() => {
                  if (isSelectMode) {
                    setIsSelectMode(false);
                    setSelectedIds(new Set());
                  } else {
                    setIsSelectMode(true);
                  }
                }}
              >
                {isSelectMode ? "Done Selecting" : "Select"}
              </Button>
              <div className="flex items-center rounded-md border border-border p-0.5">
                <button
                  type="button"
                  aria-label="Grid view"
                  aria-pressed={view === "grid"}
                  onClick={() => setView("grid")}
                  className={`rounded p-1.5 transition-colors ${
                    view === "grid"
                      ? "bg-surface-subtle text-fg"
                      : "text-fg-muted hover:text-fg"
                  }`}
                >
                  <LayoutGrid className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="List view"
                  aria-pressed={view === "list"}
                  onClick={() => setView("list")}
                  className={`rounded p-1.5 transition-colors ${
                    view === "list"
                      ? "bg-surface-subtle text-fg"
                      : "text-fg-muted hover:text-fg"
                  }`}
                >
                  <List className="h-3.5 w-3.5" />
                </button>
              </div>
              {view === "grid" && (
                <div
                  className="flex items-center rounded-md border border-border p-0.5"
                  title="Gallery thumbnail aspect ratio mode"
                >
                  <button
                    type="button"
                    aria-label="Original natural aspect ratio"
                    title="Natural (original aspect ratio)"
                    aria-pressed={galleryMode === "natural"}
                    onClick={() => setGalleryMode("natural")}
                    className={`flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors ${
                      galleryMode === "natural"
                        ? "bg-surface-subtle text-fg font-medium"
                        : "text-fg-muted hover:text-fg"
                    }`}
                  >
                    <Maximize2 className="h-3 w-3" />
                    <span>Natural</span>
                  </button>
                  <button
                    type="button"
                    aria-label="1:1 Square thumbnail mode"
                    title="Square (1:1 uniform thumbnail grid)"
                    aria-pressed={galleryMode === "square"}
                    onClick={() => setGalleryMode("square")}
                    className={`flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors ${
                      galleryMode === "square"
                        ? "bg-surface-subtle text-fg font-medium"
                        : "text-fg-muted hover:text-fg"
                    }`}
                  >
                    <Grid className="h-3 w-3" />
                    <span>Square</span>
                  </button>
                </div>
              )}
              <Button variant="secondary" onClick={() => setNewColOpen(true)}>
                <FolderPlus className="h-4 w-4" />
                New Collection
              </Button>
            </div>
          }
        />

        <div className="flex flex-wrap items-center gap-1.5">
          {LIBRARY_MEDIA_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => setMediaType(type)}
              aria-pressed={mediaType === type}
              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                mediaType === type
                  ? "border-accent bg-accent-soft text-accent-hover"
                  : "border-border bg-surface text-fg-muted hover:border-border-strong hover:text-fg"
              }`}
            >
              {type !== "all" && TYPE_ICONS[type]}
              {LIBRARY_MEDIA_LABELS[type]}
              <span className="font-mono text-[10px] tabular-nums opacity-70">
                {result.counts[type]}
              </span>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface p-3">
          <div className="flex min-w-[260px] flex-1 flex-wrap items-center gap-2">
            <div className="relative min-w-[200px] max-w-sm flex-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-fg-subtle" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                aria-label="Search media library"
                placeholder="Search prompts, models, tags, characters…"
                className="pl-9"
              />
            </div>
            <Button
              size="sm"
              variant={favoriteOnly ? "primary" : "secondary"}
              aria-pressed={favoriteOnly}
              onClick={() => setFavoriteOnly((value) => !value)}
            >
              <Heart className={`h-3.5 w-3.5 ${favoriteOnly ? "fill-current" : ""}`} />
              Favorites
            </Button>
            <Select
              value={collectionFilter}
              onChange={(event) => setCollectionFilter(event.target.value)}
              className="h-8 w-48 text-xs"
              aria-label="Filter by image collection"
            >
              <option value="all">All Collections</option>
              {collections.map((collection) => (
                <option key={collection.id} value={collection.id}>
                  {collection.name} ({collection.imageCount})
                </option>
              ))}
            </Select>
            {collectionFilter !== "all" && (
              <Button
                size="sm"
                variant="ghost"
                title="Delete this collection (images remain in the library)"
                onClick={() => {
                  void onDeleteCollection(collectionFilter).then(() => {
                    setCollectionFilter("all");
                    refresh();
                  });
                }}
              >
                <Trash2 className="h-3.5 w-3.5 text-fg-muted hover:text-danger" />
              </Button>
            )}

            {/* Model Filter */}
            {result.models && result.models.length > 0 && (
              <Select
                value={modelFilter}
                onChange={(event) => setModelFilter(event.target.value)}
                className="h-8 w-44 text-xs"
                aria-label="Filter by model"
              >
                <option value="all">All Models</option>
                {result.models.map((model) => (
                  <option key={model} value={model}>
                    {shortModelLabel(model)}
                  </option>
                ))}
              </Select>
            )}

            {/* Aspect Ratio Filter */}
            <Select
              value={aspectRatioFilter}
              onChange={(event) => setAspectRatioFilter(event.target.value as LibraryAspectRatioFilter)}
              className="h-8 w-36 text-xs"
              aria-label="Filter by orientation"
            >
              <option value="all">All Orientations</option>
              <option value="landscape">Landscape</option>
              <option value="portrait">Portrait</option>
              <option value="square">Square (1:1)</option>
            </Select>
          </div>

          <Select
            value={sortBy}
            onChange={(event) =>
              setSortBy(event.target.value as "newest" | "oldest" | "name")
            }
            className="h-8 w-36 text-xs"
            aria-label="Sort media"
          >
            <option value="newest">Newest First</option>
            <option value="oldest">Oldest First</option>
            <option value="name">Title A–Z</option>
          </Select>
        </div>
      </div>

      {missingItems.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <ImageOff className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-small font-semibold text-fg">
                {missingItems.length === 1
                  ? "1 media file can't be found on disk"
                  : `${missingItems.length} media files can't be found on disk`}
              </p>
              <p className="text-caption font-normal text-fg-muted">
                The files were moved or deleted outside Kirea. Their database records
                and metadata are still available.
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setMissingRemovalOpen(true)}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Remove missing entries
          </Button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center rounded-xl border border-dashed border-border py-16 text-small text-fg-muted">
          Loading media…
        </div>
      ) : result.items.length === 0 ? (
        <EmptyState
          icon={
            mediaType === "video" ? (
              <Film className="h-5 w-5" />
            ) : mediaType === "character" ? (
              <Users className="h-5 w-5" />
            ) : mediaType === "pixel" || mediaType === "animation" ? (
              <Boxes className="h-5 w-5" />
            ) : (
              <ImageIcon className="h-5 w-5" />
            )
          }
          title={isEmptyLibrary ? "Your media library is empty" : "No matching media found"}
          description={
            isEmptyLibrary
              ? "Images, videos, pixel art, characters and animations are indexed here automatically, with their original metadata intact."
              : "Adjust the media type, search query, favorites toggle, model or orientation filter."
          }
          action={
            isEmptyLibrary ? (
              <Button variant="primary" onClick={() => onNavigate("create")}>
                Open Create Studio
              </Button>
            ) : undefined
          }
        />
      ) : view === "grid" ? (
        <div
          className={`grid gap-2.5 ${
            density === "compact"
              ? "grid-cols-2 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-6"
              : "grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4"
          }`}
        >
          {result.items.map((item, index) => (
            <MediaCard
              key={item.id}
              item={item}
              available={isAvailable(item)}
              isSelected={selectedIds.has(item.id)}
              isFocused={focusedIndex === index}
              isSelectMode={isSelectMode || selectedIds.size > 0}
              galleryMode={galleryMode}
              onToggleSelect={(e) => handleCheckboxClick(index, item, e)}
              onOpen={(e) => handleCardClick(index, item, e)}
              onInspect={(it) => {
                if (it.mediaType === "image" && it.image && onInspectImage) {
                  onInspectImage(it.image, visibleImages);
                } else {
                  setSelected(it);
                }
              }}
              onFavorite={() => void toggleFavorite(item)}
              onOpenWorkspace={() => openWorkspace(item)}
              onReveal={() => {
                if (item.available && item.mediaPath) {
                  void window.kirea.openPath(item.mediaPath);
                }
              }}
              onDelete={() => setDeleteTarget(item)}
              onLoadFailure={() => markFailed(item.id)}
              onContextMenu={(e) => handleItemContextMenu(e, item)}
            />
          ))}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          {result.items.map((item, index) => (
            <MediaRow
              key={item.id}
              item={item}
              available={isAvailable(item)}
              isSelected={selectedIds.has(item.id)}
              isFocused={focusedIndex === index}
              isSelectMode={isSelectMode || selectedIds.size > 0}
              onToggleSelect={(e) => handleCheckboxClick(index, item, e)}
              onOpen={(e) => handleCardClick(index, item, e)}
              onInspect={(it) => {
                if (it.mediaType === "image" && it.image && onInspectImage) {
                  onInspectImage(it.image, visibleImages);
                } else {
                  setSelected(it);
                }
              }}
              onFavorite={() => void toggleFavorite(item)}
              onOpenWorkspace={() => openWorkspace(item)}
              onDelete={() => setDeleteTarget(item)}
              onLoadFailure={() => markFailed(item.id)}
              onContextMenu={(e) => handleItemContextMenu(e, item)}
            />
          ))}
        </div>
      )}

      {/* FLOATING BATCH ACTIONS BAR */}
      {(isSelectMode || selectedIds.size > 0) && (
        <div className="fixed bottom-6 left-1/2 z-30 -translate-x-1/2 flex items-center gap-3 rounded-2xl border border-border-strong bg-surface/95 px-5 py-3 shadow-2xl backdrop-blur-md animate-[kirea-panel-in_180ms_ease-out]">
          <div className="flex items-center gap-2 border-r border-border pr-3">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent font-mono text-xs font-semibold text-white">
              {selectedIds.size}
            </span>
            <span className="text-xs font-medium text-fg">
              {selectedIds.size === 1 ? "item selected" : "items selected"}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="ghost" onClick={handleSelectAll}>
              Select All ({result.items.length})
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleInvertSelection}
              title="Invert Selection (Ctrl+I)"
            >
              Invert
            </Button>
            <Button size="sm" variant="ghost" onClick={handleDeselectAll} title="Clear Selection">
              Clear
            </Button>

            <div className="h-4 w-px bg-border" />

            <Button
              size="sm"
              variant="secondary"
              disabled={selectedIds.size === 0}
              loading={batchFavoriting}
              onClick={() => void handleBatchFavorite(true)}
            >
              <Heart className="h-3.5 w-3.5 fill-danger text-danger" />
              Favorite
            </Button>

            <Button
              size="sm"
              variant="secondary"
              disabled={selectedIds.size === 0}
              onClick={() => setBatchCollectionModalOpen(true)}
            >
              <FolderPlus className="h-3.5 w-3.5" />
              Collection
            </Button>

            <Button
              size="sm"
              variant="secondary"
              disabled={selectedIds.size === 0}
              loading={batchExporting}
              onClick={() => void handleBatchExport()}
            >
              <Download className="h-3.5 w-3.5" />
              Export…
            </Button>

            <Button
              size="sm"
              variant="danger"
              disabled={selectedIds.size === 0}
              onClick={() => setBatchDeleteModalOpen(true)}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </Button>

            <div className="h-4 w-px bg-border" />

            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setIsSelectMode(false);
                setSelectedIds(new Set());
              }}
              className="text-xs font-mono uppercase text-fg-subtle hover:text-fg"
              title="Exit selection mode"
            >
              Done
            </Button>
          </div>
        </div>
      )}

      {/* MULTI-MODAL LIGHTBOX & INSPECTOR */}
      <MediaInspector
        item={selected}
        itemIndex={selectedIndex}
        totalItems={result.items.length}
        available={selected ? isAvailable(selected) : false}
        onClose={closeInspector}
        onPrevItem={handlePrevItem}
        onNextItem={handleNextItem}
        onOpenWorkspace={openWorkspace}
        onFavorite={() => {
          if (selected) void toggleFavorite(selected);
        }}
        onDelete={() => {
          if (selected) setDeleteTarget(selected);
        }}
        onExportVideo={() => {
          if (!selected || selected.mediaType !== "video") return;
          void window.kirea
            .exportVideo(selected.sourceId)
            .then((path) => {
              if (path) onToast("Video exported.");
            })
            .catch((error: unknown) =>
              onToast(
                error instanceof Error ? error.message : "Could not export the video.",
                "error"
              )
            );
        }}
        onInspectImage={(img) => onInspectImage(img, visibleImages)}
        onReuseSettings={onReuseSettings}
        onReveal={() => {
          if (selected?.mediaPath) void window.kirea.openPath(selected.mediaPath);
        }}
        onToast={onToast}
      />

      {/* SINGLE ITEM DELETE MODAL */}
      <Modal
        open={deleteTarget !== null}
        onClose={() => {
          if (!deleting) setDeleteTarget(null);
        }}
        title={
          deleteTarget?.mediaType === "character"
            ? "Delete character?"
            : deleteTarget?.mediaType === "pixel"
              ? "Delete pixel asset?"
              : deleteTarget?.mediaType === "video"
                ? "Delete video?"
                : "Delete image?"
        }
      >
        <div className="space-y-4">
          <p className="text-small text-fg-muted">
            {deleteTarget?.mediaType === "character"
              ? "This removes the character profile and its references from Character Studio. Generated images are not deleted."
              : deleteTarget?.mediaType === "pixel"
                ? "This removes the pixel asset, its frames and its version history from Pixel Studio. Exported files are not deleted."
                : deleteTarget?.mediaType === "video"
                  ? "This removes the video and its metadata sidecar from Video Studio history and deletes the file. Other media is unaffected."
                  : "This removes the image from the library and deletes its file, along with its metadata history. Other media is unaffected."}
          </p>
          <p className="truncate rounded-md border border-border bg-surface-subtle px-3 py-2 font-mono text-[11px] text-fg-muted">
            {deleteTarget?.title}
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              disabled={deleting}
              onClick={() => setDeleteTarget(null)}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={deleting}
              onClick={() => void confirmDelete()}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </Button>
          </div>
        </div>
      </Modal>

      {/* BATCH DELETE CONFIRMATION MODAL */}
      <Modal
        open={batchDeleteModalOpen}
        onClose={() => {
          if (!batchDeleting) setBatchDeleteModalOpen(false);
        }}
        title={`Delete ${selectedBreakdown.total} selected items?`}
      >
        <div className="space-y-4">
          <p className="text-small text-fg-muted">
            This action will permanently remove the following items from their workspaces and disk:
          </p>
          <ul className="space-y-1.5 rounded-lg border border-border bg-surface-subtle p-3 text-xs text-fg">
            {selectedBreakdown.imageCount > 0 && (
              <li className="flex items-center gap-2">
                <ImageIcon className="h-3.5 w-3.5 text-accent" />
                <span>
                  <strong>{selectedBreakdown.imageCount}</strong> image{selectedBreakdown.imageCount === 1 ? "" : "s"} (disk files deleted)
                </span>
              </li>
            )}
            {selectedBreakdown.videoCount > 0 && (
              <li className="flex items-center gap-2">
                <Film className="h-3.5 w-3.5 text-creative" />
                <span>
                  <strong>{selectedBreakdown.videoCount}</strong> video{selectedBreakdown.videoCount === 1 ? "" : "s"} (video files and sidecars deleted)
                </span>
              </li>
            )}
            {selectedBreakdown.pixelCount > 0 && (
              <li className="flex items-center gap-2">
                <Boxes className="h-3.5 w-3.5 text-success" />
                <span>
                  <strong>{selectedBreakdown.pixelCount}</strong> pixel asset{selectedBreakdown.pixelCount === 1 ? "" : "s"} (assets and frames deleted)
                </span>
              </li>
            )}
            {selectedBreakdown.characterCount > 0 && (
              <li className="flex items-center gap-2">
                <Users className="h-3.5 w-3.5 text-sand" />
                <span>
                  <strong>{selectedBreakdown.characterCount}</strong> character profile{selectedBreakdown.characterCount === 1 ? "" : "s"} deleted
                </span>
              </li>
            )}
          </ul>
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              disabled={batchDeleting}
              onClick={() => setBatchDeleteModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={batchDeleting}
              onClick={() => void handleConfirmBatchDelete()}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete {selectedBreakdown.total} items
            </Button>
          </div>
        </div>
      </Modal>

      {/* BATCH COLLECTION MODAL */}
      <Modal
        open={batchCollectionModalOpen}
        onClose={() => setBatchCollectionModalOpen(false)}
        title="Add Selected Images to Collection"
      >
        <div className="space-y-4">
          <p className="text-small text-fg-muted">
            Choose a collection to organize the selected images:
          </p>
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => void handleBatchAssignCollection(null)}
              className="flex w-full items-center justify-between rounded-lg border border-border p-3 text-left text-xs hover:border-accent hover:bg-surface-subtle"
            >
              <span className="font-medium text-fg">None (Remove from Collection)</span>
              <span className="text-[11px] text-fg-subtle">Unassigns collection</span>
            </button>
            {collections.map((col) => (
              <button
                key={col.id}
                type="button"
                onClick={() => void handleBatchAssignCollection(col.id)}
                className="flex w-full items-center justify-between rounded-lg border border-border p-3 text-left text-xs hover:border-accent hover:bg-surface-subtle"
              >
                <div>
                  <p className="font-semibold text-fg">{col.name}</p>
                  {col.description && (
                    <p className="text-[11px] text-fg-subtle">{col.description}</p>
                  )}
                </div>
                <Badge tone="neutral">{col.imageCount} items</Badge>
              </button>
            ))}
          </div>
          <div className="flex justify-end">
            <Button variant="secondary" onClick={() => setBatchCollectionModalOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      {/* REMOVE MISSING MODAL */}
      <Modal
        open={missingRemovalOpen}
        onClose={() => {
          if (!removingMissing) setMissingRemovalOpen(false);
        }}
        title={`Remove ${missingItems.length} missing ${
          missingItems.length === 1 ? "entry" : "entries"
        }?`}
      >
        <div className="space-y-4">
          <p className="text-small text-fg-muted">
            These library entries point to files that can no longer be loaded, usually
            because they were moved or deleted outside Kirea. Removing them clears the
            records in their original workspace repositories. Files that still exist are
            not touched by this clean-up.
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              disabled={removingMissing}
              onClick={() => setMissingRemovalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={removingMissing}
              onClick={() => void confirmRemoveMissing()}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Remove entries
            </Button>
          </div>
        </div>
      </Modal>

      {/* NEW COLLECTION MODAL */}
      <Modal
        open={newColOpen}
        onClose={() => setNewColOpen(false)}
        title="Create Image Collection"
      >
        <form onSubmit={(event) => void handleCreateCollection(event)} className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-fg-muted">Collection Name</label>
            <Input
              value={colName}
              onChange={(event) => setColName(event.target.value)}
              placeholder="e.g., Character Concepts"
              required
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-fg-muted">Description</label>
            <Input
              value={colDesc}
              onChange={(event) => setColDesc(event.target.value)}
              placeholder="Optional description…"
            />
          </div>
          <p className="text-caption text-fg-subtle">
            Collections organize generated images. Videos, pixel assets, characters and
            animations keep their own workspace grouping.
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setNewColOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary">
              Create Collection
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

/* ------------------------------- Cards ------------------------------- */

const MediaCard: React.FC<{
  item: LibraryMediaItem;
  available: boolean;
  isSelected: boolean;
  isFocused?: boolean;
  isSelectMode: boolean;
  galleryMode: "natural" | "square";
  onToggleSelect: (e?: React.MouseEvent) => void;
  onOpen: (e?: React.MouseEvent) => void;
  onInspect?: (item: LibraryMediaItem) => void;
  onFavorite: () => void;
  onOpenWorkspace: () => void;
  onReveal: () => void;
  onDelete: () => void;
  onLoadFailure: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}> = ({
  item,
  available,
  isSelected,
  isFocused = false,
  isSelectMode,
  galleryMode,
  onToggleSelect,
  onOpen,
  onInspect,
  onFavorite,
  onOpenWorkspace,
  onReveal,
  onDelete,
  onLoadFailure,
  onContextMenu,
}) => {
  const canFavorite = item.favoriteSupported;
  const canDelete = item.mediaType !== "animation";

  return (
    <div
      data-library-card-id={item.id}
      onContextMenu={onContextMenu}
      onClick={isSelectMode ? (e) => onOpen(e) : undefined}
      onDoubleClick={(e) => {
        if (isSelectMode) {
          e.stopPropagation();
          onInspect?.(item);
        }
      }}
      className={`group relative flex flex-col overflow-hidden rounded-xl border bg-surface transition-all ${
        isSelected
          ? "border-accent ring-2 ring-accent/60 bg-accent/5 shadow-md"
          : isFocused
            ? "border-accent ring-2 ring-accent/60 shadow-lg"
            : isSelectMode
              ? "border-border hover:border-accent hover:bg-surface-hover shadow-sm cursor-pointer"
              : available
                ? "border-border hover:border-accent hover:shadow-md"
                : "border-dashed border-border-strong opacity-80"
      }`}
    >
      {/* SELECTION CHECKBOX OVERLAY */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggleSelect(e);
        }}
        aria-label={isSelected ? `Deselect ${item.title}` : `Select ${item.title}`}
        aria-pressed={isSelected}
        className={`absolute left-2.5 top-2.5 z-20 flex h-6 w-6 items-center justify-center rounded-md border shadow-sm transition-all ${
          isSelected
            ? "border-accent bg-accent text-white opacity-100"
            : isSelectMode
              ? "border-border-strong bg-surface/90 text-transparent opacity-90 hover:border-accent hover:text-accent/40"
              : "border-border-strong bg-surface/80 text-transparent opacity-0 group-hover:opacity-90 hover:border-accent hover:text-accent/40"
        }`}
      >
        <Check className="h-3.5 w-3.5 stroke-[2.5]" />
      </button>

      {available ? (
        <button
          type="button"
          onClick={(e) => {
            if (isSelectMode) {
              e.stopPropagation();
            }
            onOpen(e);
          }}
          style={{
            aspectRatio:
              galleryMode === "square"
                ? "1 / 1"
                : item.width && item.height
                  ? `${item.width} / ${item.height}`
                  : "1 / 1",
            maxHeight: galleryMode === "square" ? undefined : "540px",
          }}
          className="relative w-full cursor-pointer overflow-hidden bg-surface-subtle flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          aria-label={`Inspect ${item.title}`}
        >
          <MediaPreview
            item={item}
            fitMode="cover"
            onLoadFailure={onLoadFailure}
          />
          <span className="absolute right-2 top-2">
            <TypeBadge item={item} />
          </span>
          {item.mediaType === "video" && (
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/55 text-white shadow">
                <Play className="h-4 w-4 fill-current" />
              </span>
            </span>
          )}
          {item.mediaType === "video" && (
            <span className="absolute bottom-2 right-2 rounded bg-black/65 px-1.5 py-0.5 font-mono text-[10px] text-white">
              {formatDurationSeconds(item.durationSeconds)}
            </span>
          )}
          {item.mediaType === "animation" && (
            <span className="absolute bottom-2 right-2 rounded bg-black/65 px-1.5 py-0.5 font-mono text-[10px] text-white">
              {item.animationName}
            </span>
          )}
        </button>
      ) : (
        <div className="relative flex aspect-square flex-col items-center justify-center gap-2 bg-surface-subtle p-3 text-center">
          <ImageOff className="h-5 w-5 text-fg-subtle" aria-hidden="true" />
          <p className="text-caption font-semibold text-fg">File missing</p>
          <p className="line-clamp-2 max-w-full text-[11px] text-fg-muted">{item.title}</p>
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="secondary" onClick={(e) => onOpen(e)}>
              Details
            </Button>
            {canDelete && (
              <Button size="sm" variant="ghost" onClick={onDelete}>
                <Trash2 className="h-3.5 w-3.5" />
                Remove
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-1 flex-col justify-between space-y-1.5 p-2.5">
        <div className="space-y-1">
          <p className="line-clamp-2 text-xs font-medium text-fg">{cardPrimaryText(item)}</p>
          <p className="truncate text-[11px] text-fg-subtle">{cardSecondaryText(item)}</p>
        </div>
        <div className="flex items-center justify-between gap-1 border-t border-border/60 pt-1.5">
          <div className="min-w-0">
            <div className="truncate text-[11px] font-medium text-fg-muted">
              {cardModelText(item)}
            </div>
            <div className="text-[11px] tabular-nums text-fg-subtle">
              {cardMetaText(item)}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {item.mediaType === "image" && item.image?.prompt && (
              <CopyPromptButton
                variant="compact"
                prompt={item.image.prompt}
                negativePrompt={item.image.negativePrompt}
                seed={item.image.seed}
                steps={item.image.steps}
                cfg={item.image.cfg}
                sampler={item.image.sampler}
                checkpoint={item.image.checkpoint}
                loras={item.image.loras}
                width={item.image.width}
                height={item.image.height}
              />
            )}
            {canFavorite && (
              <button
                type="button"
                onClick={onFavorite}
                aria-label={item.favorite ? "Remove favorite" : "Favorite"}
                className="rounded-lg p-1.5 hover:bg-surface-subtle"
              >
                <Heart
                  className={`h-3.5 w-3.5 ${
                    item.favorite ? "fill-danger text-danger" : "text-fg-muted"
                  }`}
                />
              </button>
            )}
            <button
              type="button"
              onClick={onOpenWorkspace}
              title={workspaceActionLabel(item)}
              aria-label={workspaceActionLabel(item)}
              className="rounded-lg p-1.5 text-fg-muted hover:bg-surface-subtle hover:text-accent"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </button>
            {available && (
              <button
                type="button"
                onClick={onReveal}
                title="Reveal in folder"
                aria-label="Reveal in folder"
                className="rounded-lg p-1.5 text-fg-muted hover:bg-surface-subtle hover:text-fg"
              >
                <FolderOpen className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const MediaRow: React.FC<{
  item: LibraryMediaItem;
  available: boolean;
  isSelected: boolean;
  isFocused?: boolean;
  isSelectMode: boolean;
  onToggleSelect: (e?: React.MouseEvent) => void;
  onOpen: (e?: React.MouseEvent) => void;
  onInspect?: (item: LibraryMediaItem) => void;
  onFavorite: () => void;
  onOpenWorkspace: () => void;
  onDelete: () => void;
  onLoadFailure: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}> = ({
  item,
  available,
  isSelected,
  isFocused = false,
  isSelectMode,
  onToggleSelect,
  onOpen,
  onInspect,
  onFavorite,
  onOpenWorkspace,
  onDelete,
  onLoadFailure,
  onContextMenu,
}) => (
  <div
    data-library-card-id={item.id}
    onContextMenu={onContextMenu}
    onClick={isSelectMode ? (e) => onOpen(e) : undefined}
    onDoubleClick={(e) => {
      if (isSelectMode) {
        e.stopPropagation();
        onInspect?.(item);
      }
    }}
    className={`flex items-center gap-3 border-b border-border px-3 py-2 last:border-b-0 transition-colors ${
      isSelectMode ? "cursor-pointer hover:bg-surface-subtle" : "hover:bg-surface-subtle/60"
    } ${
      isSelected
        ? "bg-accent-soft/40 ring-1 ring-accent/30"
        : isFocused
          ? "bg-surface-subtle ring-1 ring-accent/50"
          : ""
    }`}
  >
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggleSelect(e);
      }}
      aria-label={isSelected ? `Deselect ${item.title}` : `Select ${item.title}`}
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors ${
        isSelected
          ? "border-accent bg-accent text-white"
          : "border-border-strong bg-surface text-transparent hover:border-accent hover:text-accent/40"
      }`}
    >
      <Check className="h-3.5 w-3.5 stroke-[2.5]" />
    </button>
    <button
      type="button"
      onClick={(e) => {
        if (isSelectMode) {
          e.stopPropagation();
        }
        onOpen(e);
      }}
      className="relative h-12 w-16 shrink-0 overflow-hidden rounded-md border border-border bg-surface-subtle flex items-center justify-center"
      aria-label={`Inspect ${item.title}`}
    >
      {available ? (
        <MediaPreview item={item} fitMode="cover" onLoadFailure={onLoadFailure} compact />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-fg-subtle">
          <ImageOff className="h-4 w-4" />
        </span>
      )}
    </button>
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2">
        <TypeBadge item={item} />
        <p className="truncate text-xs font-medium text-fg">{item.title}</p>
      </div>
      <p className="truncate text-[11px] text-fg-subtle">{cardSecondaryText(item)}</p>
    </div>
    <div className="hidden w-40 shrink-0 text-right text-[11px] text-fg-muted md:block">
      <div className="truncate">{cardModelText(item)}</div>
      <div className="tabular-nums">{cardMetaText(item)}</div>
    </div>
    <div className="flex shrink-0 items-center gap-1">
      {item.favoriteSupported && (
        <button
          type="button"
          onClick={onFavorite}
          aria-label={item.favorite ? "Remove favorite" : "Favorite"}
          className="rounded-lg p-1.5 hover:bg-surface-subtle"
        >
          <Heart
            className={`h-3.5 w-3.5 ${
              item.favorite ? "fill-danger text-danger" : "text-fg-muted"
            }`}
          />
        </button>
      )}
      {item.mediaType === "image" && item.image?.prompt && (
        <CopyPromptButton
          variant="compact"
          prompt={item.image.prompt}
          negativePrompt={item.image.negativePrompt}
          seed={item.image.seed}
          steps={item.image.steps}
          cfg={item.image.cfg}
          sampler={item.image.sampler}
          checkpoint={item.image.checkpoint}
          loras={item.image.loras}
          width={item.image.width}
          height={item.image.height}
        />
      )}
      <Button size="sm" variant="secondary" onClick={onOpenWorkspace}>
        {workspaceActionLabel(item)}
      </Button>
      {item.mediaType !== "animation" && (
        <button
          type="button"
          onClick={onDelete}
          aria-label="Delete"
          className="rounded-lg p-1.5 text-fg-muted hover:bg-surface-subtle hover:text-danger"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  </div>
);

const MediaPreview: React.FC<{
  item: LibraryMediaItem;
  compact?: boolean;
  fitMode?: "cover" | "contain";
  onLoadFailure?: () => void;
}> = ({ item, compact = false, fitMode = "cover", onLoadFailure }) => {
  if (!item.thumbnailPath && !item.mediaPath) {
    return (
      <span className="flex h-full w-full items-center justify-center text-fg-subtle">
        <ImageOff className="h-4 w-4" />
      </span>
    );
  }
  if (item.mediaType === "video" && item.mediaPath) {
    return (
      <video
        src={`${toMediaUrl(item.mediaPath)}#t=0.1`}
        preload="metadata"
        muted
        playsInline
        className={`pointer-events-none h-full w-full ${fitMode === "cover" ? "object-cover" : "object-contain"} object-center`}
        aria-hidden="true"
      />
    );
  }
  const source = item.thumbnailPath || item.mediaPath;
  if (!source) {
    return (
      <span className="flex h-full w-full items-center justify-center text-fg-subtle">
        <ImageOff className="h-4 w-4" />
      </span>
    );
  }
  return (
    <MediaImage
      src={toMediaUrl(source)}
      alt={item.title}
      loading="lazy"
      compact={compact}
      onLoadFailure={onLoadFailure}
      className={`h-full w-full ${fitMode === "cover" ? "object-cover object-center" : "object-contain object-center"} ${
        item.mediaType === "pixel" || item.mediaType === "animation"
          ? "[image-rendering:pixelated]"
          : ""
      } ${compact ? "" : "transition-transform duration-200 group-hover:scale-[1.03]"}`}
    />
  );
};

const TypeBadge: React.FC<{ item: LibraryMediaItem }> = ({ item }) => (
  <Badge tone={TYPE_TONES[item.mediaType]}>
    {TYPE_ICONS[item.mediaType]}
    {LIBRARY_MEDIA_LABELS[item.mediaType].replace(/s$/, "")}
  </Badge>
);

/* ------------------------------ Inspector ----------------------------- */

const MediaInspector: React.FC<{
  item: LibraryMediaItem | null;
  itemIndex: number;
  totalItems: number;
  available: boolean;
  onClose: () => void;
  onPrevItem: () => void;
  onNextItem: () => void;
  onOpenWorkspace: (item: LibraryMediaItem) => void;
  onFavorite: () => void;
  onDelete: () => void;
  onExportVideo: () => void;
  onInspectImage?: (img: GeneratedImageRecord) => void;
  onReuseSettings?: (img: GeneratedImageRecord) => void;
  onReveal: () => void;
  onToast: (msg: string, tone?: "info" | "error") => void;
}> = ({
  item,
  itemIndex,
  totalItems,
  available,
  onClose,
  onPrevItem,
  onNextItem,
  onOpenWorkspace,
  onFavorite,
  onDelete,
  onExportVideo,
  onInspectImage,
  onReuseSettings,
  onReveal,
  onToast,
}) => {
  if (!item) return null;

  return (
    <Modal
      open
      onClose={onClose}
      title={
        <div className="flex items-center justify-between gap-3 w-full pr-6">
          <div className="flex items-center gap-2 min-w-0">
            <TypeBadge item={item} />
            <span className="truncate text-small font-semibold text-fg" title={item.title}>
              {item.title}
            </span>
          </div>
          {totalItems > 1 && (
            <div className="flex items-center gap-1 rounded-md border border-border bg-surface p-0.5 shrink-0">
              <button
                type="button"
                onClick={onPrevItem}
                title="Previous (Left Arrow ←)"
                aria-label="Previous item"
                className="rounded p-1 text-fg-muted hover:bg-surface-subtle hover:text-fg transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="px-1.5 font-mono text-[11px] tabular-nums text-fg-subtle">
                {itemIndex + 1} / {totalItems}
              </span>
              <button
                type="button"
                onClick={onNextItem}
                title="Next (Right Arrow →)"
                aria-label="Next item"
                className="rounded p-1 text-fg-muted hover:bg-surface-subtle hover:text-fg transition-colors"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      }
      maxWidthClass="max-w-4xl"
    >
      <div className="space-y-4">
        {/* PREVIEW CONTAINER */}
        <div className="overflow-hidden rounded-xl border border-border bg-well">
          {!available ? (
            <div className="flex h-56 flex-col items-center justify-center gap-2 text-fg-muted">
              <ImageOff className="h-6 w-6" />
              <p className="text-small">The source file can no longer be loaded.</p>
            </div>
          ) : item.mediaType === "video" && item.mediaPath ? (
            <InspectorVideoPlayer
              mediaPath={item.mediaPath}
              durationSeconds={item.durationSeconds}
            />
          ) : item.mediaType === "pixel" || item.mediaType === "animation" ? (
            <InspectorPixelViewer item={item} />
          ) : item.mediaType === "character" ? (
            <InspectorCharacterViewer character={item.character} onToast={onToast} />
          ) : item.mediaType === "image" ? (
            <InspectorImageViewer image={item.image} onToast={onToast} />
          ) : (
            item.mediaPath && (
              <MediaImage
                src={toMediaUrl(item.mediaPath)}
                alt={item.title}
                className="mx-auto max-h-[52vh] object-contain"
              />
            )
          )}
        </div>

        {/* ACTION BUTTONS */}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="accent" onClick={() => onOpenWorkspace(item)}>
            <ExternalLink className="h-3.5 w-3.5" />
            {workspaceActionLabel(item)}
          </Button>
          {item.favoriteSupported && (
            <Button variant={item.favorite ? "primary" : "secondary"} onClick={onFavorite}>
              <Heart className={`h-3.5 w-3.5 ${item.favorite ? "fill-current" : ""}`} />
              {item.favorite ? "Favorited" : "Favorite"}
            </Button>
          )}
          {item.mediaType === "image" && onInspectImage && (
            <Button
              variant="secondary"
              onClick={() => {
                onInspectImage(item.image);
                onClose();
              }}
            >
              <Maximize2 className="h-3.5 w-3.5" />
              Full Lightbox
            </Button>
          )}
          {item.mediaType === "video" && available && (
            <Button variant="secondary" onClick={onExportVideo}>
              <Download className="h-3.5 w-3.5" />
              Export video…
            </Button>
          )}
          {available && item.mediaPath && (
            <Button variant="secondary" onClick={onReveal}>
              <FolderOpen className="h-3.5 w-3.5" />
              Reveal in folder
            </Button>
          )}
          {item.mediaType !== "animation" && (
            <Button variant="danger" onClick={onDelete}>
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </Button>
          )}
        </div>

        {/* METADATA DETAILS */}
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-small sm:grid-cols-2">
          <DetailRow label="Type" value={LIBRARY_MEDIA_LABELS[item.mediaType]} />
          <DetailRow label="Created" value={formatRelativeTime(item.createdAt)} />
          {item.width && item.height && (
            <DetailRow label="Dimensions" value={`${item.width} × ${item.height}`} />
          )}
          {item.model && <DetailRow label="Model" value={shortModelLabel(item.model)} />}
          {item.mediaType === "video" && (
            <>
              <DetailRow
                label="Duration"
                value={formatDurationSeconds(item.durationSeconds)}
              />
              <DetailRow label="Frame rate" value={`${item.fps} FPS`} />
              <DetailRow label="Frames" value={`${item.frameCount}`} />
              <DetailRow label="Workflow" value={item.workflowId ?? "Not recorded"} />
            </>
          )}
          {item.mediaType === "pixel" && (
            <>
              <DetailRow label="Pixel kind" value={item.pixelKind} />
              <DetailRow
                label="Character"
                value={item.characterName ?? "Not linked"}
              />
              <DetailRow label="Direction" value={item.direction ?? "Not recorded"} />
              <DetailRow label="Frames" value={`${item.frameCount}`} />
              <DetailRow label="Version" value={`v${item.version}`} />
              <DetailRow
                label="Animation clips"
                value={
                  item.animations.length > 0
                    ? item.animations.map((animation) => animation.name).join(", ")
                    : "None"
                }
              />
            </>
          )}
          {item.mediaType === "animation" && (
            <>
              <DetailRow label="Animation clip" value={item.animationName} />
              <DetailRow
                label="Character"
                value={item.characterName ?? "Not linked"}
              />
              <DetailRow label="Pixel kind" value={item.pixelKind} />
              <DetailRow label="Frames" value={`${item.frameCount}`} />
              <DetailRow
                label="Clip duration"
                value={formatClipDuration(item.durationMs)}
              />
              <DetailRow label="Loop" value={item.loop ? "Yes" : "No"} />
              <DetailRow label="Asset version" value={`v${item.pixel.version}`} />
            </>
          )}
          {item.mediaType === "character" && (
            <>
              <DetailRow label="Architecture" value={item.architecture} />
              <DetailRow label="References" value={`${item.referenceCount}`} />
              <DetailRow
                label="Checkpoint"
                value={
                  item.character.checkpointName
                    ? shortModelLabel(item.character.checkpointName)
                    : "Not set"
                }
              />
              <DetailRow
                label="Trigger words"
                value={
                  item.character.triggerWords.length > 0
                    ? item.character.triggerWords.join(", ")
                    : "None"
                }
              />
            </>
          )}
          {item.mediaType === "image" && (
            <>
              <DetailRow
                label="Operations"
                value={imageWorkflowLabels(item.image)
                  .map((label) => label.label)
                  .join(" → ")}
              />
              <DetailRow label="Sampler" value={item.image.sampler} />
              <DetailRow label="Scheduler" value={item.image.scheduler} />
              <DetailRow label="Steps" value={`${item.image.steps}`} />
              <DetailRow label="CFG" value={`${item.image.cfg}`} />
              <DetailRow label="Seed" value={`${item.image.seed}`} />
              <DetailRow label="Workflow" value={item.image.workflowId} />
            </>
          )}
        </dl>

        {item.description && (
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-subtle">
              {item.mediaType === "character" ? "Description" : "Prompt"}
            </p>
            <p className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-surface-subtle p-3 text-xs text-fg-muted">
              {item.description}
            </p>
          </div>
        )}

        {item.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {item.tags.map((tag) => (
              <Badge key={tag}>{tag}</Badge>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
};

/* -------------------------- Sub-Viewers ------------------------------ */

const InspectorVideoPlayer: React.FC<{
  mediaPath: string;
  durationSeconds: number;
}> = ({ mediaPath, durationSeconds }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(durationSeconds || 0);
  const [muted, setMuted] = useState(false);
  const [loop, setLoop] = useState(true);
  const [playbackRate, setPlaybackRate] = useState(1);

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (playing) {
      videoRef.current.pause();
    } else {
      void videoRef.current.play();
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setCurrentTime(val);
    if (videoRef.current) {
      videoRef.current.currentTime = val;
    }
  };

  const handleSpeedChange = (speed: number) => {
    setPlaybackRate(speed);
    if (videoRef.current) {
      videoRef.current.playbackRate = speed;
    }
  };

  return (
    <div className="relative flex flex-col bg-black overflow-hidden rounded-xl">
      <video
        ref={videoRef}
        src={toMediaUrl(mediaPath)}
        playsInline
        loop={loop}
        muted={muted}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={() => {
          if (videoRef.current) setCurrentTime(videoRef.current.currentTime);
        }}
        onLoadedMetadata={() => {
          if (videoRef.current && videoRef.current.duration) {
            setDuration(videoRef.current.duration);
          }
        }}
        onClick={togglePlay}
        className="max-h-[50vh] w-full cursor-pointer object-contain"
      />
      <div className="flex flex-col gap-1.5 bg-surface-elevated/95 p-3 border-t border-border">
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={0}
            max={duration || 1}
            step={0.05}
            value={currentTime}
            onChange={handleSeek}
            aria-label="Seek video"
            className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-surface-subtle accent-accent focus:outline-none"
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={togglePlay}
              className="flex h-7 w-7 items-center justify-center rounded-md bg-surface hover:bg-surface-subtle text-fg"
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 fill-current" />}
            </button>
            <span className="font-mono text-[11px] tabular-nums text-fg-muted">
              {formatDurationSeconds(currentTime)} / {formatDurationSeconds(duration)}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <div className="flex items-center rounded-md border border-border p-0.5">
              {[0.5, 1, 1.5, 2].map((speed) => (
                <button
                  key={speed}
                  type="button"
                  onClick={() => handleSpeedChange(speed)}
                  className={`px-1.5 py-0.5 font-mono text-[10px] rounded transition-colors ${
                    playbackRate === speed
                      ? "bg-accent-soft text-accent-hover font-semibold"
                      : "text-fg-muted hover:text-fg"
                  }`}
                >
                  {speed}x
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setLoop(!loop)}
              title={loop ? "Looping enabled" : "Looping disabled"}
              aria-pressed={loop}
              className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium border ${
                loop ? "border-accent bg-accent-soft text-accent-hover" : "border-border text-fg-muted hover:text-fg"
              }`}
            >
              <RotateCcw className="h-3 w-3" />
              Loop
            </button>

            <button
              type="button"
              onClick={() => setMuted(!muted)}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-fg-muted hover:text-fg"
              aria-label={muted ? "Unmute" : "Mute"}
            >
              {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const InspectorPixelViewer: React.FC<{
  item: LibraryMediaItem;
}> = ({ item }) => {
  const [zoom, setZoom] = useState<number>(2);
  const [checkerboard, setCheckerboard] = useState<boolean>(true);

  const mediaSource = item.mediaPath || item.thumbnailPath;

  return (
    <div className="flex flex-col gap-2">
      <div
        className={`relative flex min-h-[300px] max-h-[52vh] items-center justify-center overflow-auto rounded-xl border border-border p-6 transition-colors ${
          checkerboard
            ? "bg-[repeating-conic-gradient(#262626_0%_25%,#171717_0%_50%)] [background-size:16px_16px]"
            : "bg-well"
        }`}
      >
        {mediaSource ? (
          <img
            src={toMediaUrl(mediaSource)}
            alt={item.title}
            style={{ transform: `scale(${zoom})`, transformOrigin: "center" }}
            className="transition-transform duration-100 ease-out [image-rendering:pixelated]"
          />
        ) : (
          <div className="flex flex-col items-center gap-2 text-fg-muted">
            <ImageOff className="h-6 w-6" />
            <p className="text-small">No preview available</p>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 px-1 text-xs">
        <div className="flex items-center gap-1">
          <span className="text-[11px] font-medium text-fg-muted mr-1">Zoom:</span>
          {[1, 2, 4, 8].map((z) => (
            <button
              key={z}
              type="button"
              onClick={() => setZoom(z)}
              className={`rounded px-2 py-0.5 font-mono text-[11px] border transition-colors ${
                zoom === z
                  ? "border-accent bg-accent-soft text-accent-hover font-bold"
                  : "border-border text-fg-muted hover:text-fg"
              }`}
            >
              {z}x
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setCheckerboard(!checkerboard)}
          className={`flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors ${
            checkerboard ? "border-accent bg-accent-soft text-accent-hover" : "border-border text-fg-muted hover:text-fg"
          }`}
        >
          <Grid className="h-3 w-3" />
          {checkerboard ? "Checkerboard" : "Solid"}
        </button>
      </div>
    </div>
  );
};

const InspectorCharacterViewer: React.FC<{
  character: CharacterProfile;
  onToast: (msg: string, tone?: "info" | "error") => void;
}> = ({ character, onToast }) => {
  const [copiedWords, setCopiedWords] = useState(false);
  const [copiedPrefix, setCopiedPrefix] = useState(false);

  const copyTriggerWords = async () => {
    if (character.triggerWords.length === 0) return;
    await navigator.clipboard.writeText(character.triggerWords.join(", "));
    setCopiedWords(true);
    onToast("Trigger words copied to clipboard.");
    setTimeout(() => setCopiedWords(false), 2000);
  };

  const copyPrefix = async () => {
    if (!character.promptPrefix) return;
    await navigator.clipboard.writeText(character.promptPrefix);
    setCopiedPrefix(true);
    onToast("Prompt prefix copied to clipboard.");
    setTimeout(() => setCopiedPrefix(false), 2000);
  };

  return (
    <div className="space-y-3">
      {character.references.length > 0 && (
        <div className="space-y-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-subtle">
            Reference Images ({character.references.length})
          </span>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
            {character.references.map((ref) => (
              <div
                key={ref.id}
                className="group relative aspect-square overflow-hidden rounded-lg border border-border bg-well flex items-center justify-center p-1"
              >
                <MediaImage
                  src={toMediaUrl(ref.filePath)}
                  alt={ref.caption || character.name}
                  className="h-full w-full object-contain object-center transition-transform group-hover:scale-105"
                />
                <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1 py-0.5 text-[9px] font-medium text-white uppercase">
                  {ref.role}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        {character.promptPrefix && (
          <Button size="sm" variant="secondary" onClick={() => void copyPrefix()}>
            {copiedPrefix ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
            Copy Prefix
          </Button>
        )}
        {character.triggerWords.length > 0 && (
          <Button size="sm" variant="secondary" onClick={() => void copyTriggerWords()}>
            {copiedWords ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
            Copy Trigger Words
          </Button>
        )}
      </div>
    </div>
  );
};

const InspectorImageViewer: React.FC<{
  image: GeneratedImageRecord;
  onToast: (msg: string, tone?: "info" | "error") => void;
}> = ({ image, onToast }) => {
  return (
    <div className="space-y-3">
      <div className="relative flex max-h-[52vh] items-center justify-center overflow-hidden rounded-none border-2 border-border bg-well p-2">
        <MediaImage
          src={toMediaUrl(image.filePath)}
          alt={image.prompt}
          className="max-h-[50vh] max-w-full object-contain rounded-none shadow-sm"
        />
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-tech tabular-nums text-fg-subtle">
          {image.width}×{image.height} · {image.format.toUpperCase()} · {formatBytes(image.sizeBytes)}
        </span>
        <CopyPromptButton
          prompt={image.prompt}
          negativePrompt={image.negativePrompt}
          seed={image.seed}
          steps={image.steps}
          cfg={image.cfg}
          sampler={image.sampler}
          checkpoint={image.checkpoint}
          loras={image.loras}
          width={image.width}
          height={image.height}
          onToast={onToast}
        />
      </div>
    </div>
  );
};

const DetailRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex items-baseline justify-between gap-3 border-b border-border/60 pb-1.5">
    <dt className="shrink-0 text-[11px] uppercase tracking-[0.06em] text-fg-subtle">
      {label}
    </dt>
    <dd className="truncate text-right text-xs text-fg" title={value}>
      {value}
    </dd>
  </div>
);

/* ------------------------------- Helpers ------------------------------ */

function cardPrimaryText(item: LibraryMediaItem): string {
  if (item.mediaType === "character") {
    return item.title;
  }
  if (item.mediaType === "pixel") {
    return item.title;
  }
  if (item.mediaType === "animation") {
    return `${item.pixel.name} · ${item.animationName}`;
  }
  return item.title;
}

function cardSecondaryText(item: LibraryMediaItem): string {
  if (item.mediaType === "character") {
    return item.description || `${item.referenceCount} reference${item.referenceCount === 1 ? "" : "s"}`;
  }
  if (item.mediaType === "pixel") {
    return [item.characterName, item.pixelKind, `${item.frameCount} frame${item.frameCount === 1 ? "" : "s"}`]
      .filter(Boolean)
      .join(" · ");
  }
  if (item.mediaType === "animation") {
    return [item.characterName, item.pixelKind, `${item.frameCount} frames`, formatClipDuration(item.durationMs)]
      .filter(Boolean)
      .join(" · ");
  }
  return item.description || "No prompt recorded";
}

function cardModelText(item: LibraryMediaItem): string {
  if (item.mediaType === "character") {
    return item.character.checkpointName
      ? shortModelLabel(item.character.checkpointName)
      : item.architecture;
  }
  if (item.mediaType === "pixel" || item.mediaType === "animation") {
    return `${item.pixel.engine} · v${item.pixel.version}`;
  }
  return item.model ? shortModelLabel(item.model) : "Model not recorded";
}

function cardMetaText(item: LibraryMediaItem): string {
  if (item.mediaType === "video") {
    return `${item.fps} FPS · ${formatDurationSeconds(item.durationSeconds)} · ${formatRelativeTime(item.createdAt)}`;
  }
  if (item.mediaType === "animation") {
    return `${item.loop ? "Loop" : "One-shot"} · ${formatRelativeTime(item.createdAt)}`;
  }
  const dimensions =
    item.width && item.height ? `${item.width}×${item.height} · ` : "";
  return `${dimensions}${formatRelativeTime(item.createdAt)}`;
}

function workspaceActionLabel(item: LibraryMediaItem): string {
  switch (item.mediaType) {
    case "image":
      return "Open in Create";
    case "video":
      return "Open in Video Studio";
    case "pixel":
      return "Open in Pixel Studio";
    case "animation":
      return "Open animation";
    case "character":
      return "Open in Character Studio";
  }
}

function formatClipDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1)} s`;
}

function pathBasename(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || filePath;
}

function characterInputWithFavorite(character: CharacterProfile): CharacterProfileInput {
  return {
    id: character.id,
    name: character.name,
    description: character.description,
    appearance: character.appearance,
    clothing: character.clothing,
    promptPrefix: character.promptPrefix,
    negativePrompt: character.negativePrompt,
    triggerWords: character.triggerWords,
    architecture: character.architecture,
    checkpointPath: character.checkpointPath,
    checkpointName: character.checkpointName,
    loraRecipeId: character.loraRecipeId,
    referenceMode: character.referenceMode,
    referenceWeight: character.referenceWeight,
    referenceStart: character.referenceStart,
    referenceEnd: character.referenceEnd,
    tags: character.tags,
    favorite: !character.favorite,
  };
}
