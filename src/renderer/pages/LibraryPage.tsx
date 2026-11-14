import React, { useCallback, useMemo, useState } from "react";
import {
  FolderOpen,
  FolderPlus,
  Heart,
  Image as ImageIcon,
  ImageOff,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import type {
  CollectionRecord,
  GeneratedImageRecord,
  NavSection,
} from "../../shared/types";
import {
  Button,
  EmptyState,
  Input,
  Modal,
  SectionHeader,
  Select,
} from "../components/ui/Primitives";
import { MediaImage } from "../components/ui/MediaImage";
import { formatRelativeTime, shortModelLabel, toMediaUrl } from "../utils/format";

interface LibraryPageProps {
  images: GeneratedImageRecord[];
  collections: CollectionRecord[];
  density: "comfortable" | "compact";
  onInspectImage: (img: GeneratedImageRecord) => void;
  onReuseSettings: (img: GeneratedImageRecord) => void;
  onToggleFavorite: (id: string) => Promise<void>;
  /** Removes library entries whose files can no longer be loaded. */
  onRemoveMissing: (ids: string[]) => Promise<void>;
  onCreateCollection: (name: string, desc: string) => Promise<void>;
  onDeleteCollection: (id: string) => Promise<void>;
  onNavigate: (page: NavSection) => void;
}

export const LibraryPage: React.FC<LibraryPageProps> = ({
  images,
  collections,
  density,
  onInspectImage,
  onReuseSettings,
  onToggleFavorite,
  onRemoveMissing,
  onCreateCollection,
  onDeleteCollection,
  onNavigate,
}) => {
  const [search, setSearch] = useState("");
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [collectionFilter, setCollectionFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"newest" | "oldest" | "name">("newest");
  const [newColOpen, setNewColOpen] = useState(false);
  const [colName, setColName] = useState("");
  const [colDesc, setColDesc] = useState("");
  const [missingIds, setMissingIds] = useState<Set<string>>(() => new Set());
  const [pendingRemoval, setPendingRemoval] = useState<string[]>([]);
  const [removing, setRemoving] = useState(false);

  const markMissing = useCallback((id: string) => {
    setMissingIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  // Only count entries that are still in the library.
  const missingInLibrary = useMemo(
    () => images.filter((img) => missingIds.has(img.id)).map((img) => img.id),
    [images, missingIds]
  );

  const confirmRemoval = async (): Promise<void> => {
    if (pendingRemoval.length === 0) return;
    setRemoving(true);
    try {
      await onRemoveMissing(pendingRemoval);
    } finally {
      setRemoving(false);
      setPendingRemoval([]);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = images.filter((img) => {
      if (favoriteOnly && !img.favorite) return false;
      if (collectionFilter === "none" && img.collectionId !== null) return false;
      if (
        collectionFilter !== "all" &&
        collectionFilter !== "none" &&
        img.collectionId !== collectionFilter
      ) {
        return false;
      }
      if (!q) return true;
      return (
        img.prompt.toLowerCase().includes(q) ||
        img.checkpoint.toLowerCase().includes(q) ||
        img.fileName.toLowerCase().includes(q) ||
        img.tags.some((t) => t.toLowerCase().includes(q)) ||
        String(img.seed).includes(q)
      );
    });

    return [...list].sort((a, b) => {
      if (sortBy === "oldest") return a.createdAt.localeCompare(b.createdAt);
      if (sortBy === "name") return a.fileName.localeCompare(b.fileName);
      return b.createdAt.localeCompare(a.createdAt);
    });
  }, [images, search, favoriteOnly, collectionFilter, sortBy]);

  const handleCreateCol = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!colName.trim()) return;
    await onCreateCollection(colName.trim(), colDesc.trim());
    setColName("");
    setColDesc("");
    setNewColOpen(false);
  };

  return (
    <div className="space-y-5">
      <div className="sticky -top-6 z-10 -mx-6 space-y-3 border-b border-border bg-bg px-6 pb-3 pt-6">
        <SectionHeader
          title="Image Library"
          subtitle="Browse, organize, inspect metadata, export formats, or reuse any previous generation."
          actions={
            <Button variant="secondary" onClick={() => setNewColOpen(true)}>
              <FolderPlus className="w-4 h-4" />
              New Collection
            </Button>
          }
        />

        {/* Filter Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface p-3">
        <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[260px]">
          <div className="relative flex-1 max-w-sm">
            <Search className="w-4 h-4 text-fg-subtle absolute left-3 top-2.5" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search library"
              placeholder="Search prompts, models, tags, seeds..."
              className="pl-9"
            />
          </div>

          <Button
            size="sm"
            variant={favoriteOnly ? "primary" : "secondary"}
            onClick={() => setFavoriteOnly((v) => !v)}
          >
            <Heart
              className={`w-3.5 h-3.5 ${favoriteOnly ? "fill-current" : ""}`}
            />
            Favorites
          </Button>

          <Select
            value={collectionFilter}
            onChange={(e) => setCollectionFilter(e.target.value)}
            className="w-44 h-8 text-xs"
          >
            <option value="all">All Collections ({images.length})</option>
            <option value="none">Uncollected</option>
            {collections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.imageCount})
              </option>
            ))}
          </Select>

          {collectionFilter !== "all" && collectionFilter !== "none" && (
            <Button
              size="sm"
              variant="ghost"
              title="Delete selected collection (images remain safe)"
              onClick={() => {
                void onDeleteCollection(collectionFilter).then(() =>
                  setCollectionFilter("all")
                );
              }}
            >
              <Trash2 className="w-3.5 h-3.5 text-fg-muted hover:text-danger" />
            </Button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Select
            value={sortBy}
            onChange={(e) =>
              setSortBy(e.target.value as "newest" | "oldest" | "name")
            }
            className="h-8 w-36 text-xs"
          >
            <option value="newest">Newest First</option>
            <option value="oldest">Oldest First</option>
            <option value="name">Filename A–Z</option>
          </Select>
        </div>
        </div>
      </div>

      {/* Grid */}
      {missingInLibrary.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <ImageOff className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-small font-semibold text-fg">
                {missingInLibrary.length === 1
                  ? "1 image can't be found on disk"
                  : `${missingInLibrary.length} images can't be found on disk`}
              </p>
              <p className="text-caption font-normal text-fg-muted">
                The files were moved or deleted outside Kirea. Their settings are
                still here until you remove them.
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setPendingRemoval(missingInLibrary)}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {missingInLibrary.length === 1
              ? "Remove entry"
              : `Remove ${missingInLibrary.length} entries`}
          </Button>
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState
          icon={<ImageIcon className="w-5 h-5" />}
          title={
            images.length === 0
              ? "Your local library is empty"
              : "No matching images found"
          }
          description={
            images.length === 0
              ? "Images you create are automatically indexed here with complete workflow & seed history."
              : "Adjust your search query, favorite toggle, or collection filter."
          }
          action={
            images.length === 0 ? (
              <Button variant="primary" onClick={() => onNavigate("create")}>
                Open Create Studio
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div
          className={`grid gap-3.5 ${
            density === "compact"
              ? "grid-cols-2 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-6"
              : "grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4"
          }`}
        >
          {filtered.map((img) => {
            const missing = missingIds.has(img.id);
            return (
            <div
              key={img.id}
              className={`group relative flex flex-col overflow-hidden rounded-xl border bg-surface transition-colors ${
                missing
                  ? "border-dashed border-border-strong"
                  : "border-border hover:border-accent"
              }`}
            >
              {missing ? (
                <div className="relative flex aspect-square flex-col items-center justify-center gap-2 bg-surface-subtle p-3 text-center">
                  <ImageOff className="h-5 w-5 text-fg-subtle" aria-hidden="true" />
                  <div className="min-w-0 max-w-full space-y-0.5">
                    <p className="text-caption font-semibold text-fg">File missing</p>
                    <p
                      className="truncate font-mono text-[11px] text-fg-muted"
                      title={img.filePath}
                    >
                      {img.fileName}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center justify-center gap-1.5">
                    <Button
                      size="sm"
                      variant="secondary"
                      aria-label={`Details for ${img.fileName}`}
                      onClick={() => onInspectImage(img)}
                    >
                      Details
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Remove ${img.fileName} from library`}
                      onClick={() => setPendingRemoval([img.id])}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Remove
                    </Button>
                  </div>
                </div>
              ) : (
              <button
                type="button"
                onClick={() => onInspectImage(img)}
                className="relative aspect-square bg-well overflow-hidden cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <MediaImage
                  src={toMediaUrl(img.filePath)}
                  alt={img.prompt}
                  loading="lazy"
                  onLoadFailure={() => markMissing(img.id)}
                  className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-200"
                />
              </button>
              )}

              <div className="p-2.5 space-y-1.5 flex-1 flex flex-col justify-between">
                <p className="text-xs text-fg line-clamp-2">{img.prompt}</p>
                <div className="flex items-center justify-between gap-1 pt-1 border-t border-border/60">
                  <div className="min-w-0">
                    <div className="text-[11px] font-medium text-fg-muted truncate">
                      {shortModelLabel(img.checkpoint)}
                    </div>
                    <div className="text-[11px] text-fg-subtle tabular-nums">
                      {img.width}×{img.height} • {formatRelativeTime(img.createdAt)}
                    </div>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => void onToggleFavorite(img.id)}
                      aria-label="Favorite"
                      className="p-1.5 rounded-lg hover:bg-surface-subtle cursor-pointer"
                    >
                      <Heart
                        className={`w-3.5 h-3.5 ${
                          img.favorite ? "fill-danger text-danger" : "text-fg-muted"
                        }`}
                      />
                    </button>
                    <button
                      type="button"
                      onClick={() => onReuseSettings(img)}
                      title="Reuse settings in Create"
                      aria-label="Reuse settings"
                      className="p-1.5 rounded-lg text-fg-muted hover:text-accent hover:bg-surface-subtle cursor-pointer"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void window.kirea.openPath(img.filePath)}
                      title="Open in folder"
                      aria-label="Open in folder"
                      className="p-1.5 rounded-lg text-fg-muted hover:text-fg hover:bg-surface-subtle cursor-pointer"
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
            );
          })}
        </div>
      )}

      <Modal
        open={pendingRemoval.length > 0}
        onClose={() => {
          if (!removing) setPendingRemoval([]);
        }}
        title={
          pendingRemoval.length === 1
            ? "Remove missing image?"
            : `Remove ${pendingRemoval.length} missing images?`
        }
      >
        <div className="space-y-4">
          <p className="text-small text-fg-muted">
            {pendingRemoval.length === 1
              ? "This library entry points to a file that can't be loaded"
              : `These ${pendingRemoval.length} library entries point to files that can't be loaded`}
            , usually because the file was moved or deleted outside Kirea.
            Removing clears the entry and its settings history. If a file still
            exists at that path, it is deleted too.
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              disabled={removing}
              onClick={() => setPendingRemoval([])}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={removing}
              onClick={() => void confirmRemoval()}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {pendingRemoval.length === 1
                ? "Remove entry"
                : `Remove ${pendingRemoval.length} entries`}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={newColOpen}
        onClose={() => setNewColOpen(false)}
        title="Create Image Collection"
      >
        <form onSubmit={(e) => void handleCreateCol(e)} className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-fg-muted">Collection Name</label>
            <Input
              value={colName}
              onChange={(e) => setColName(e.target.value)}
              placeholder="e.g., Character Concepts"
              required
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-fg-muted">Description</label>
            <Input
              value={colDesc}
              onChange={(e) => setColDesc(e.target.value)}
              placeholder="Optional description..."
            />
          </div>
          <div className="pt-2 flex justify-end gap-2">
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

