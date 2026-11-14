import React, { useEffect, useMemo, useState } from "react";
import {
  Copy,
  Download,
  FolderOpen,
  History,
  ImagePlus,
  Pencil,
  PencilLine,
  Play,
  Search,
  Trash2,
} from "lucide-react";
import type { GeneratedImageRecord } from "../../../shared/types";
import type {
  PixelAssetDetail,
  PixelAssetRecord,
  PixelAssetVersion,
  PixelCharacter,
  PixelExportFormat,
  PixelExportResult,
  PixelKind,
} from "../../../shared/pixel-types";
import {
  PIXEL_KIND_LABELS,
  PIXEL_PALETTES,
} from "../../../shared/pixel-types";
import { toMediaUrl } from "../../utils/format";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Input,
  Modal,
  Select,
} from "../ui/Primitives";
import {
  KindBadgeLabel,
  PixelField,
  PixelImage,
  formatPixelDate,
} from "./pixel-ui";
import { SpriteKilnPanel } from "./SpriteKilnPanel";

const KIND_OPTIONS: PixelKind[] = [
  "character",
  "creature",
  "weapon",
  "item",
  "object",
  "tileset",
  "environment",
  "effect",
];

const EXPORT_FORMATS: Array<{ id: PixelExportFormat; label: string; hint: string }> = [
  { id: "png", label: "PNG frame", hint: "Single frame at native pixels." },
  { id: "sheet", label: "Sprite sheet", hint: "All frames atlased horizontally." },
  { id: "gif", label: "Animated GIF", hint: "Looping animation at the chosen scale." },
  { id: "apng", label: "Animated APNG", hint: "Lossless animation with alpha." },
  { id: "zip", label: "ZIP bundle", hint: "Frames, sheet, recipe and metadata." },
  { id: "godot", label: "Godot SpriteFrames", hint: ".tres plus sheet PNG." },
  { id: "unity", label: "Unity atlas JSON", hint: "Sheet plus frame rectangles." },
  { id: "phaser", label: "Phaser atlas JSON", hint: "Atlas metadata for Phaser 3." },
];

interface AssetLibraryProps {
  projectId: string;
  assets: PixelAssetRecord[];
  characters: PixelCharacter[];
  selectedAssetId: string;
  onSelectAsset: (id: string) => void;
  onAssetsChanged: () => Promise<void> | void;
  onImported: (detail: PixelAssetDetail) => void;
  onInspect: (id: string, target: "animation" | "editor") => void;
  onToast: (message: string, tone?: "info" | "error") => void;
}

export const AssetLibraryPanel: React.FC<AssetLibraryProps> = ({
  projectId,
  assets,
  characters,
  selectedAssetId,
  onSelectAsset,
  onAssetsChanged,
  onImported,
  onInspect,
  onToast,
}) => {
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<PixelKind | "">("");
  const [characterId, setCharacterId] = useState("");

  const [renameTarget, setRenameTarget] = useState<PixelAssetRecord | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<PixelAssetRecord | null>(null);

  const [exportTarget, setExportTarget] = useState<PixelAssetRecord | null>(null);
  const [exportDetail, setExportDetail] = useState<PixelAssetDetail | null>(null);
  const [exportFormat, setExportFormat] = useState<PixelExportFormat>("sheet");
  const [exportScale, setExportScale] = useState(2);
  const [exportAnimation, setExportAnimation] = useState("");
  const [exportFrame, setExportFrame] = useState(0);
  const [exportResult, setExportResult] = useState<PixelExportResult | null>(null);
  const [exporting, setExporting] = useState(false);

  const [versionsTarget, setVersionsTarget] = useState<PixelAssetRecord | null>(null);
  const [versions, setVersions] = useState<PixelAssetVersion[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);

  const [importOpen, setImportOpen] = useState(false);
  const [libraryImages, setLibraryImages] = useState<GeneratedImageRecord[]>([]);
  const [imagesLoading, setImagesLoading] = useState(false);
  const [importImageId, setImportImageId] = useState("");
  const [importForm, setImportForm] = useState({
    name: "",
    width: 32,
    height: 32,
    paletteId: "kirea",
    transparent: true,
  });
  const [importing, setImporting] = useState(false);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return assets.filter((asset) => {
      if (kind && asset.kind !== kind) return false;
      if (characterId && asset.characterId !== characterId) return false;
      if (!term) return true;
      return (
        asset.name.toLowerCase().includes(term) ||
        asset.prompt.toLowerCase().includes(term) ||
        PIXEL_KIND_LABELS[asset.kind].toLowerCase().includes(term)
      );
    });
  }, [assets, search, kind, characterId]);

  const characterName = (id: string | null): string | null =>
    characters.find((character) => character.id === id)?.name ?? null;

  const openRename = (asset: PixelAssetRecord): void => {
    setRenameTarget(asset);
    setRenameValue(asset.name);
  };

  const commitRename = async (): Promise<void> => {
    if (!renameTarget) return;
    const name = renameValue.trim();
    if (!name || name === renameTarget.name) {
      setRenameTarget(null);
      return;
    }
    try {
      await window.kirea.renamePixelAsset(renameTarget.id, name);
      await onAssetsChanged();
      onToast("Asset renamed.", "info");
    } catch (error) {
      onToast(error instanceof Error ? error.message : "Could not rename the asset.", "error");
    } finally {
      setRenameTarget(null);
    }
  };

  const duplicate = async (asset: PixelAssetRecord): Promise<void> => {
    try {
      const copy = await window.kirea.duplicatePixelAsset(asset.id);
      await onAssetsChanged();
      onSelectAsset(copy.id);
      onToast(`Duplicated ${asset.name}.`, "info");
    } catch (error) {
      onToast(error instanceof Error ? error.message : "Could not duplicate the asset.", "error");
    }
  };

  const remove = async (): Promise<void> => {
    if (!deleteTarget) return;
    try {
      await window.kirea.deletePixelAsset(deleteTarget.id);
      await onAssetsChanged();
      if (selectedAssetId === deleteTarget.id) onSelectAsset("");
      onToast(`${deleteTarget.name} deleted.`, "info");
    } catch (error) {
      onToast(error instanceof Error ? error.message : "Could not delete the asset.", "error");
    }
  };

  const openExport = async (asset: PixelAssetRecord): Promise<void> => {
    setExportTarget(asset);
    setExportResult(null);
    setExportDetail(null);
    setExportScale(asset.width <= 32 ? 4 : 2);
    setExportFormat("sheet");
    setExportFrame(0);
    setExportAnimation("");
    try {
      const detail = await window.kirea.getPixelAsset(asset.id);
      setExportDetail(detail);
      setExportAnimation(Object.keys(detail.animations)[0] ?? "");
    } catch (error) {
      onToast(error instanceof Error ? error.message : "Could not read the asset.", "error");
    }
  };

  const runExport = async (): Promise<void> => {
    if (!exportTarget) return;
    setExporting(true);
    try {
      const result = await window.kirea.exportPixelAsset(exportTarget.id, exportFormat, {
        scale: exportScale,
        animation:
          exportFormat === "gif" || exportFormat === "apng" ? exportAnimation || undefined : undefined,
        frameIndex: exportFormat === "png" ? exportFrame : undefined,
      });
      setExportResult(result);
      onToast(`Exported ${result.frameCount} frame(s) to ${result.filePath}`, "info");
    } catch (error) {
      onToast(error instanceof Error ? error.message : "Export failed.", "error");
    } finally {
      setExporting(false);
    }
  };

  const openVersions = async (asset: PixelAssetRecord): Promise<void> => {
    setVersionsTarget(asset);
    setVersions([]);
    setVersionsLoading(true);
    try {
      setVersions(await window.kirea.listPixelAssetVersions(asset.id));
    } catch (error) {
      onToast(error instanceof Error ? error.message : "Could not load version history.", "error");
    } finally {
      setVersionsLoading(false);
    }
  };

  useEffect(() => {
    if (!importOpen) return;
    let cancelled = false;
    setImagesLoading(true);
    void window.kirea
      .listImages({ sortBy: "newest" })
      .then((images) => {
        if (!cancelled) {
          setLibraryImages(images);
          setImportImageId((current) => current || images[0]?.id || "");
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          onToast(
            error instanceof Error ? error.message : "Could not list library images.",
            "error"
          );
        }
      })
      .finally(() => {
        if (!cancelled) setImagesLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importOpen]);

  const runImport = async (): Promise<void> => {
    if (!projectId || !importImageId) return;
    const selectedImage = libraryImages.find((image) => image.id === importImageId);
    const name =
      importForm.name.trim() ||
      selectedImage?.fileName.replace(/\.[a-z0-9]+$/i, "") ||
      "Imported sprite";
    setImporting(true);
    try {
      const detail = await window.kirea.importPixelAsset({
        projectId,
        imageId: importImageId,
        name,
        width: Math.max(8, Math.min(256, importForm.width)),
        height: Math.max(8, Math.min(256, importForm.height)),
        paletteId: importForm.paletteId,
        transparent: importForm.transparent,
      });
      setImportOpen(false);
      setImportImageId("");
      setImportForm({ name: "", width: 32, height: 32, paletteId: "kirea", transparent: true });
      onImported(detail);
      onToast(`Imported ${detail.name} as ${detail.width}×${detail.height} pixels.`, "info");
    } catch (error) {
      onToast(error instanceof Error ? error.message : "Import failed.", "error");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-4 min-w-0">
        <Card className="p-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-faint" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search name, kind or prompt"
                className="pl-8"
              />
            </div>
            <Select
              className="w-36"
              value={kind}
              onChange={(event) => setKind(event.target.value as PixelKind | "")}
            >
              <option value="">All kinds</option>
              {KIND_OPTIONS.map((entry) => (
                <option key={entry} value={entry}>
                  {PIXEL_KIND_LABELS[entry]}
                </option>
              ))}
            </Select>
            <Select
              className="w-40"
              value={characterId}
              onChange={(event) => setCharacterId(event.target.value)}
            >
              <option value="">All characters</option>
              {characters.map((character) => (
                <option key={character.id} value={character.id}>
                  {character.name}
                </option>
              ))}
            </Select>
            <Button variant="secondary" onClick={() => setImportOpen(true)}>
              <ImagePlus className="w-3.5 h-3.5" /> Import from library
            </Button>
          </div>
        </Card>

        {assets.length === 0 ? (
          <EmptyState
            icon={<ImagePlus />}
            title="The asset library is empty"
            description="Generate a character or effect, or import an existing Kirea image and quantize it to the pixel palette. Assets keep their frames, versions and exports."
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Search />}
            title="No assets match"
            description="Try a different kind, character or search term."
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  setSearch("");
                  setKind("");
                  setCharacterId("");
                }}
              >
                Reset filters
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 2xl:grid-cols-4 gap-3">
            {filtered.map((asset) => (
              <Card
                key={asset.id}
                className={`overflow-hidden ${
                  asset.id === selectedAssetId ? "border-accent" : ""
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelectAsset(asset.id)}
                  className="block w-full"
                  aria-label={`Select ${asset.name}`}
                >
                  <PixelImage
                    src={asset.previewDataUrl}
                    alt={asset.name}
                    node={asset.kind}
                    className="aspect-square w-full"
                  />
                </button>
                <div className="p-2.5 space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[12px] font-semibold text-fg leading-tight truncate">
                      {asset.name}
                    </p>
                    <Badge tone="neutral">v{asset.version}</Badge>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <KindBadgeLabel kind={asset.kind} />
                    <span className="font-mono text-[10px] text-fg-faint">
                      {asset.width}×{asset.height} · {asset.frameCount}f
                    </span>
                  </div>
                  <p className="font-mono text-[10px] text-fg-faint truncate">
                    seed {asset.seed ?? "—"} · {asset.paletteId} ·{" "}
                    {characterName(asset.characterId) ?? "unlinked"}
                  </p>
                  <p className="font-mono text-[10px] text-fg-faint">
                    {formatPixelDate(asset.updatedAt)}
                  </p>
                  <div className="flex flex-wrap gap-1 pt-1">
                    <Button size="sm" variant="utility" onClick={() => onInspect(asset.id, "editor")}>
                      <Pencil className="w-3 h-3" /> Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="utility"
                      onClick={() => onInspect(asset.id, "animation")}
                    >
                      <Play className="w-3 h-3" /> Animate
                    </Button>
                    <Button
                      size="sm"
                      variant="utility"
                      onClick={() => void openExport(asset)}
                      aria-label={`Export ${asset.name}`}
                    >
                      <Download className="w-3 h-3" />
                    </Button>
                    <Button
                      size="sm"
                      variant="utility"
                      onClick={() => void openVersions(asset)}
                      aria-label={`Version history for ${asset.name}`}
                    >
                      <History className="w-3 h-3" />
                    </Button>
                    <Button
                      size="sm"
                      variant="utility"
                      onClick={() => openRename(asset)}
                      aria-label={`Rename ${asset.name}`}
                    >
                      <PencilLine className="w-3 h-3" />
                    </Button>
                    <Button
                      size="sm"
                      variant="utility"
                      onClick={() => void duplicate(asset)}
                      aria-label={`Duplicate ${asset.name}`}
                    >
                      <Copy className="w-3 h-3" />
                    </Button>
                    <Button
                      size="sm"
                      variant="utility"
                      onClick={() => setDeleteTarget(asset)}
                      aria-label={`Delete ${asset.name}`}
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-4">
        <Card className="p-4 space-y-2">
          <span className="label-mono text-fg-muted">Library summary</span>
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="flex justify-between">
              <span className="text-fg-muted">Assets</span>
              <span className="font-mono text-fg">{assets.length}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-fg-muted">Frames</span>
              <span className="font-mono text-fg">
                {assets.reduce((sum, asset) => sum + asset.frameCount, 0)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-fg-muted">Characters</span>
              <span className="font-mono text-fg">{characters.length}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-fg-muted">Kinds</span>
              <span className="font-mono text-fg">
                {new Set(assets.map((asset) => asset.kind)).size}
              </span>
            </div>
          </div>
          <p className="text-[11px] text-fg-faint leading-relaxed">
            Files live under the app data pixel-assets directory; SQLite stores metadata, frame
            rows, recipes and exports, not image blobs.
          </p>
        </Card>
        <SpriteKilnPanel />
      </div>

      <Modal
        open={!!renameTarget}
        onClose={() => setRenameTarget(null)}
        title="Rename asset"
        maxWidthClass="max-w-md"
      >
        <PixelField label="Name">
          <Input
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            maxLength={120}
            autoFocus
          />
        </PixelField>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setRenameTarget(null)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void commitRename()}>
            Rename
          </Button>
        </div>
      </Modal>

      <Modal
        open={!!exportTarget}
        onClose={() => {
          setExportTarget(null);
          setExportResult(null);
        }}
        title={`Export ${exportTarget?.name ?? "asset"}`}
        maxWidthClass="max-w-xl"
      >
        <div className="space-y-3">
          <PixelField label="Format">
            <Select
              value={exportFormat}
              onChange={(event) => setExportFormat(event.target.value as PixelExportFormat)}
            >
              {EXPORT_FORMATS.map((format) => (
                <option key={format.id} value={format.id}>
                  {format.label}
                </option>
              ))}
            </Select>
          </PixelField>
          <p className="text-[11px] text-fg-faint">
            {EXPORT_FORMATS.find((format) => format.id === exportFormat)?.hint}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <PixelField label="Scale (nearest neighbour)">
              <Select
                value={String(exportScale)}
                onChange={(event) => setExportScale(Number(event.target.value))}
              >
                {[1, 2, 3, 4, 6, 8].map((scale) => (
                  <option key={scale} value={scale}>
                    {scale}×
                  </option>
                ))}
              </Select>
            </PixelField>
            {(exportFormat === "gif" || exportFormat === "apng") && (
              <PixelField label="Animation">
                <Select
                  value={exportAnimation}
                  onChange={(event) => setExportAnimation(event.target.value)}
                >
                  {Object.keys(exportDetail?.animations ?? {}).map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </Select>
              </PixelField>
            )}
            {exportFormat === "png" && (
              <PixelField label="Frame">
                <Select
                  value={String(exportFrame)}
                  onChange={(event) => setExportFrame(Number(event.target.value))}
                >
                  {(exportDetail?.frames ?? []).map((frame, index) => (
                    <option key={`${frame.name}-${index}`} value={index}>
                      {index + 1}. {frame.name}
                    </option>
                  ))}
                </Select>
              </PixelField>
            )}
          </div>
          {exportResult && (
            <div className="border border-border rounded-md p-2.5 text-[11px] space-y-1">
              <p className="font-mono text-fg break-all">{exportResult.filePath}</p>
              <p className="text-fg-muted">
                {exportResult.width}×{exportResult.height} · {exportResult.frameCount} frame(s)
              </p>
              {exportResult.note && <p className="text-fg-faint">{exportResult.note}</p>}
              <Button
                size="sm"
                variant="utility"
                onClick={() =>
                  exportTarget && void window.kirea.openPixelExportFolder(exportTarget.id)
                }
              >
                <FolderOpen className="w-3 h-3" /> Open export folder
              </Button>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setExportTarget(null)}>
              Close
            </Button>
            <Button variant="accent" loading={exporting} onClick={() => void runExport()}>
              <Download className="w-3.5 h-3.5" /> Export
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={!!versionsTarget}
        onClose={() => setVersionsTarget(null)}
        title={`Version history · ${versionsTarget?.name ?? ""}`}
        maxWidthClass="max-w-2xl"
      >
        {versionsLoading ? (
          <p className="text-small text-fg-muted">Loading versions…</p>
        ) : versions.length === 0 ? (
          <p className="text-small text-fg-muted">
            No versions recorded yet. Saving frames creates the next version.
          </p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 max-h-[420px] overflow-y-auto">
            {versions.map((version) => (
              <div key={version.id} className="border border-border rounded-lg overflow-hidden">
                <PixelImage
                  src={version.previewDataUrl}
                  alt={`Version ${version.version}`}
                  className="aspect-square w-full"
                />
                <div className="p-2">
                  <p className="font-mono text-[11px] text-fg">v{version.version}</p>
                  <p className="font-mono text-[10px] text-fg-faint">
                    {formatPixelDate(version.createdAt)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>

      <Modal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Import from Kirea library"
        maxWidthClass="max-w-3xl"
      >
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_240px]">
          <div>
            {imagesLoading ? (
              <p className="text-small text-fg-muted">Loading library images…</p>
            ) : libraryImages.length === 0 ? (
              <p className="text-small text-fg-muted">
                No generated images yet. Create an image in Create Studio, then return here to
                pixelize it.
              </p>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-[340px] overflow-y-auto pr-1">
                {libraryImages.map((image) => (
                  <button
                    key={image.id}
                    type="button"
                    onClick={() => {
                      setImportImageId(image.id);
                      setImportForm((prev) => ({
                        ...prev,
                        name:
                          prev.name ||
                          image.fileName.replace(/\.[a-z0-9]+$/i, "").slice(0, 120),
                      }));
                    }}
                    className={`rounded-md overflow-hidden border ${
                      importImageId === image.id ? "border-accent ring-1 ring-accent" : "border-border"
                    }`}
                  >
                    <img
                      src={toMediaUrl(image.filePath)}
                      alt={image.fileName}
                      className="aspect-square w-full object-cover"
                      loading="lazy"
                    />
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="space-y-3">
            <PixelField label="Name">
              <Input
                value={importForm.name}
                onChange={(event) =>
                  setImportForm((prev) => ({ ...prev, name: event.target.value }))
                }
                maxLength={120}
              />
            </PixelField>
            <div className="grid grid-cols-2 gap-2">
              <PixelField label="Width">
                <Input
                  type="number"
                  min={8}
                  max={256}
                  value={importForm.width}
                  onChange={(event) =>
                    setImportForm((prev) => ({
                      ...prev,
                      width: Number(event.target.value) || 8,
                    }))
                  }
                />
              </PixelField>
              <PixelField label="Height">
                <Input
                  type="number"
                  min={8}
                  max={256}
                  value={importForm.height}
                  onChange={(event) =>
                    setImportForm((prev) => ({
                      ...prev,
                      height: Number(event.target.value) || 8,
                    }))
                  }
                />
              </PixelField>
            </div>
            <PixelField label="Palette">
              <Select
                value={importForm.paletteId}
                onChange={(event) =>
                  setImportForm((prev) => ({ ...prev, paletteId: event.target.value }))
                }
              >
                {PIXEL_PALETTES.map((palette) => (
                  <option key={palette.id} value={palette.id}>
                    {palette.name}
                  </option>
                ))}
              </Select>
            </PixelField>
            <label className="flex items-center gap-2 text-[11px] text-fg-muted">
              <input
                type="checkbox"
                checked={importForm.transparent}
                onChange={(event) =>
                  setImportForm((prev) => ({ ...prev, transparent: event.target.checked }))
                }
              />
              Knock out the corner colour
            </label>
            <Button
              variant="accent"
              className="w-full"
              loading={importing}
              disabled={!importImageId || !projectId}
              onClick={() => void runImport()}
            >
              Import image
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void remove()}
        title="Delete asset"
        description={`Delete ${deleteTarget?.name ?? "this asset"} and its frame files? This cannot be undone.`}
        confirmLabel="Delete asset"
      />
    </div>
  );
};
