import React, { useEffect, useMemo, useState } from "react";
import {
  Download,
  FolderOpen,
  LayoutGrid,
  Plus,
  RefreshCw,
  Settings2,
  Trash2,
} from "lucide-react";
import {
  CANVAS_CAPTION_MODES,
  CANVAS_CAPTION_MODE_LABELS,
  CANVAS_PAGE_SIZES,
  CANVAS_PAGE_SIZE_LABELS,
  CANVAS_TEMPLATES,
  CANVAS_TEMPLATE_LABELS,
  buildCanvasPages,
} from "../../../shared/canvas-layout";
import type {
  CanvasCaptionMode,
  CanvasFit,
  CanvasOverlay,
  CanvasOverlayKind,
  CanvasPageSize,
  CanvasTemplate,
  GeneratedImageRecord,
  Story,
  StoryCanvas,
  StoryCanvasInput,
  StoryCanvasItem,
  StoryCanvasItemInput,
  StoryExportResult,
} from "../../../shared/types";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Select,
} from "../ui/Primitives";
import {
  type CanvasFormState,
  newOverlayForm,
  nextCanvasName,
  type OverlayFormState,
  overlayId,
  type PanelFormState,
} from "./canvas-workspace-types";
import { CanvasPagesStage } from "./CanvasPagesStage";
import { CanvasPanelInspector } from "./CanvasPanelInspector";
import { CanvasSettingsModal } from "./CanvasSettingsModal";

interface StoryCanvasWorkspaceProps {
  story: Story;
  canvases: StoryCanvas[];
  images: GeneratedImageRecord[];
  onSaveCanvas: (input: StoryCanvasInput) => Promise<StoryCanvas>;
  onDeleteCanvas: (id: string) => Promise<boolean>;
  onSaveCanvasItem: (input: StoryCanvasItemInput) => Promise<StoryCanvas>;
  onDeleteCanvasItem: (
    canvasId: string,
    itemId: string
  ) => Promise<StoryCanvas | null>;
  onReorderCanvasItems: (
    canvasId: string,
    itemIds: string[]
  ) => Promise<StoryCanvas | null>;
  onSyncCanvas: (canvasId: string) => Promise<StoryCanvas | null>;
  onExportCanvasPng: (canvasId: string) => Promise<StoryExportResult | null>;
  onExportCanvasPdf: (canvasId: string) => Promise<StoryExportResult | null>;
  onOpenExportFolder: (storyId: string) => Promise<void>;
  onToast: (message: string, tone?: "info" | "error") => void;
}

export const StoryCanvasWorkspace: React.FC<StoryCanvasWorkspaceProps> = ({
  story,
  canvases,
  images,
  onSaveCanvas,
  onDeleteCanvas,
  onSaveCanvasItem,
  onDeleteCanvasItem,
  onReorderCanvasItems,
  onSyncCanvas,
  onExportCanvasPng,
  onExportCanvasPdf,
  onOpenExportFolder,
  onToast,
}) => {
  const storyCanvases = useMemo(
    () =>
      canvases
        .filter((canvas) => canvas.storyId === story.id)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [canvases, story.id]
  );

  const [selectedCanvasId, setSelectedCanvasId] = useState<string | null>(null);
  const activeCanvas = useMemo(
    () =>
      storyCanvases.find((canvas) => canvas.id === selectedCanvasId) ??
      storyCanvases[0] ??
      null,
    [storyCanvases, selectedCanvasId]
  );

  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const selectedItem = useMemo(
    () =>
      activeCanvas?.items.find((item) => item.id === selectedItemId) ?? null,
    [activeCanvas, selectedItemId]
  );

  const [canvasModalOpen, setCanvasModalOpen] = useState(false);
  const [editingCanvas, setEditingCanvas] = useState<StoryCanvas | null>(null);
  const [canvasForm, setCanvasForm] = useState<CanvasFormState>({
    name: "Storyboard",
    template: "grid_2x3",
    pageSize: "a4_landscape",
    captionMode: "scene_title",
    margin: "32",
    gutter: "16",
    background: "#0B0B0F",
    pageWidth: "1123",
    pageHeight: "794",
  });
  const [savingCanvas, setSavingCanvas] = useState(false);
  const [deleteCanvasOpen, setDeleteCanvasOpen] = useState(false);

  const [panelForm, setPanelForm] = useState<PanelFormState>({
    sceneId: "",
    imageId: "",
    fit: "cover",
    captionOverride: "",
  });
  const [savingPanel, setSavingPanel] = useState(false);
  const [overlayForm, setOverlayForm] = useState<OverlayFormState>(() =>
    newOverlayForm()
  );
  const [savingOverlay, setSavingOverlay] = useState(false);

  const [syncing, setSyncing] = useState(false);
  const [exporting, setExporting] = useState<"png" | "pdf" | null>(null);
  const [openingFolder, setOpeningFolder] = useState(false);

  const pages = useMemo(
    () =>
      activeCanvas
        ? buildCanvasPages(activeCanvas, activeCanvas.items, story.scenes)
        : [],
    [activeCanvas, story.scenes]
  );

  const sceneMap = useMemo(
    () => new Map(story.scenes.map((scene) => [scene.id, scene])),
    [story.scenes]
  );

  useEffect(() => {
    if (
      selectedCanvasId &&
      storyCanvases.some((canvas) => canvas.id === selectedCanvasId)
    ) {
      return;
    }
    setSelectedCanvasId(storyCanvases[0]?.id ?? null);
  }, [storyCanvases, selectedCanvasId]);

  useEffect(() => {
    if (!activeCanvas) {
      setSelectedItemId(null);
      return;
    }
    if (
      selectedItemId &&
      activeCanvas.items.some((item) => item.id === selectedItemId)
    ) {
      return;
    }
    setSelectedItemId(activeCanvas.items[0]?.id ?? null);
  }, [activeCanvas, selectedItemId]);

  useEffect(() => {
    if (!selectedItem) return;
    setPanelForm({
      sceneId: selectedItem.sceneId ?? "",
      imageId: selectedItem.imageId ?? "",
      fit: selectedItem.fit,
      captionOverride: selectedItem.captionOverride,
    });
    setOverlayForm(newOverlayForm());
  }, [selectedItem?.id]);

  const imagesForScene = useMemo(() => {
    if (!panelForm.sceneId) return [];
    return images.filter((image) => image.storySceneId === panelForm.sceneId);
  }, [images, panelForm.sceneId]);

  const openCreateCanvas = (): void => {
    setEditingCanvas(null);
    setCanvasForm({
      name: nextCanvasName(storyCanvases),
      template: "grid_2x3",
      pageSize: "a4_landscape",
      captionMode: "scene_title",
      margin: "32",
      gutter: "16",
      background: "#0B0B0F",
      pageWidth: "1123",
      pageHeight: "794",
    });
    setCanvasModalOpen(true);
  };

  const openCanvasSettings = (): void => {
    if (!activeCanvas) return;
    setEditingCanvas(activeCanvas);
    setCanvasForm({
      name: activeCanvas.name,
      template: activeCanvas.template,
      pageSize: activeCanvas.pageSize,
      captionMode: activeCanvas.captionMode,
      margin: String(activeCanvas.margin),
      gutter: String(activeCanvas.gutter),
      background: activeCanvas.background,
      pageWidth: String(activeCanvas.pageWidth),
      pageHeight: String(activeCanvas.pageHeight),
    });
    setCanvasModalOpen(true);
  };

  const handleSaveCanvasForm = async (): Promise<void> => {
    if (!canvasForm.name.trim()) {
      onToast("Give the canvas a name first.", "error");
      return;
    }
    setSavingCanvas(true);
    try {
      const margin = Math.max(0, Math.min(240, Number(canvasForm.margin) || 0));
      const gutter = Math.max(0, Math.min(120, Number(canvasForm.gutter) || 0));
      const saved = await onSaveCanvas({
        ...(editingCanvas ? { id: editingCanvas.id } : {}),
        storyId: story.id,
        name: canvasForm.name.trim(),
        template: canvasForm.template,
        pageSize: canvasForm.pageSize,
        captionMode: canvasForm.captionMode,
        margin,
        gutter,
        background: canvasForm.background,
        ...(canvasForm.pageSize === "custom"
          ? {
              pageWidth: Math.max(
                320,
                Math.min(4096, Number(canvasForm.pageWidth) || 1123)
              ),
              pageHeight: Math.max(
                320,
                Math.min(4096, Number(canvasForm.pageHeight) || 794)
              ),
            }
          : {}),
      });
      setSelectedCanvasId(saved.id);
      setCanvasModalOpen(false);
      onToast(editingCanvas ? `Saved '${saved.name}'.` : `Created '${saved.name}'.`);
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setSavingCanvas(false);
    }
  };

  const handleDeleteCanvas = async (): Promise<void> => {
    if (!activeCanvas) return;
    try {
      await onDeleteCanvas(activeCanvas.id);
      setDeleteCanvasOpen(false);
      onToast(`Deleted '${activeCanvas.name}'.`);
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "error");
    }
  };

  const handleCanvasSettingChange = async (
    patch: Partial<StoryCanvasInput>
  ): Promise<void> => {
    if (!activeCanvas) return;
    try {
      const saved = await onSaveCanvas({
        id: activeCanvas.id,
        storyId: story.id,
        name: activeCanvas.name,
        ...patch,
      });
      setSelectedCanvasId(saved.id);
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "error");
    }
  };

  const handleSync = async (): Promise<void> => {
    if (!activeCanvas) return;
    setSyncing(true);
    try {
      const synced = await onSyncCanvas(activeCanvas.id);
      if (synced) {
        setSelectedCanvasId(synced.id);
        onToast(
          `Synced ${synced.items.length} panel${synced.items.length === 1 ? "" : "s"} from scenes.`
        );
      }
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setSyncing(false);
    }
  };

  const handleSavePanel = async (): Promise<void> => {
    if (!activeCanvas || !selectedItem) return;
    setSavingPanel(true);
    try {
      await onSaveCanvasItem({
        id: selectedItem.id,
        canvasId: activeCanvas.id,
        sceneId: panelForm.sceneId || null,
        imageId: panelForm.imageId || null,
        fit: panelForm.fit,
        captionOverride: panelForm.captionOverride,
      });
      onToast("Panel updated.");
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setSavingPanel(false);
    }
  };

  const movePanel = async (direction: -1 | 1): Promise<void> => {
    if (!activeCanvas || !selectedItem) return;
    const ids = activeCanvas.items.map((item) => item.id);
    const index = ids.indexOf(selectedItem.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ids.length) return;
    const next = [...ids];
    const [moved] = next.splice(index, 1);
    if (!moved) return;
    next.splice(target, 0, moved);
    try {
      await onReorderCanvasItems(activeCanvas.id, next);
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "error");
    }
  };

  const removePanel = async (): Promise<void> => {
    if (!activeCanvas || !selectedItem) return;
    try {
      await onDeleteCanvasItem(activeCanvas.id, selectedItem.id);
      setSelectedItemId(null);
      onToast("Panel removed.");
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "error");
    }
  };

  const saveOverlays = async (overlays: CanvasOverlay[]): Promise<void> => {
    if (!activeCanvas || !selectedItem) return;
    await onSaveCanvasItem({
      id: selectedItem.id,
      canvasId: activeCanvas.id,
      overlays,
    });
  };

  const handleSaveOverlay = async (): Promise<void> => {
    if (!activeCanvas || !selectedItem) return;
    const text = overlayForm.text.trim();
    if (!text) {
      onToast("Write the dialogue or overlay text first.", "error");
      return;
    }
    setSavingOverlay(true);
    try {
      const overlay: CanvasOverlay = {
        id: overlayForm.id ?? overlayId(),
        kind: overlayForm.kind,
        ...(overlayForm.speaker.trim()
          ? { speaker: overlayForm.speaker.trim() }
          : {}),
        text,
        x: Math.min(1, Math.max(0, overlayForm.x)),
        y: Math.min(1, Math.max(0, overlayForm.y)),
      };
      const existing = selectedItem.overlays;
      const next = overlayForm.id
        ? existing.map((item) => (item.id === overlayForm.id ? overlay : item))
        : [...existing, overlay];
      await saveOverlays(next);
      setOverlayForm({
        id: overlay.id,
        kind: overlay.kind,
        speaker: overlay.speaker ?? "",
        text: overlay.text,
        x: overlay.x,
        y: overlay.y,
      });
      onToast(overlayForm.id ? "Overlay updated." : "Overlay added.");
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setSavingOverlay(false);
    }
  };

  const handleRemoveOverlay = async (id: string): Promise<void> => {
    if (!selectedItem) return;
    try {
      await saveOverlays(selectedItem.overlays.filter((item) => item.id !== id));
      if (overlayForm.id === id) setOverlayForm(newOverlayForm());
      onToast("Overlay removed.");
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "error");
    }
  };

  const handleExport = async (kind: "png" | "pdf"): Promise<void> => {
    if (!activeCanvas) return;
    if (activeCanvas.items.length === 0) {
      onToast("Sync the canvas from scenes before exporting.", "error");
      return;
    }
    setExporting(kind);
    try {
      const result =
        kind === "png"
          ? await onExportCanvasPng(activeCanvas.id)
          : await onExportCanvasPdf(activeCanvas.id);
      if (!result) {
        onToast("Export cancelled.");
        return;
      }
      onToast(
        `Exported ${result.pageCount} page${result.pageCount === 1 ? "" : "s"} as ${kind.toUpperCase()} to ${result.outputDir}.`
      );
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setExporting(null);
    }
  };

  const handleOpenFolder = async (): Promise<void> => {
    setOpeningFolder(true);
    try {
      await onOpenExportFolder(story.id);
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setOpeningFolder(false);
    }
  };

  if (storyCanvases.length === 0) {
    return (
      <>
        <EmptyState
          icon={<LayoutGrid className="w-6 h-6" />}
          title="No storyboard canvas yet"
          description="Create a canvas to lay out scenes as a paginated storyboard, add captions and dialogue, then export PNG pages or a PDF."
          action={
            <Button variant="primary" onClick={openCreateCanvas}>
              <Plus className="w-3.5 h-3.5" />
              Create storyboard
            </Button>
          }
        />
        <CanvasSettingsModal
          open={canvasModalOpen}
          editingCanvas={editingCanvas}
          canvasForm={canvasForm}
          savingCanvas={savingCanvas}
          onClose={() => setCanvasModalOpen(false)}
          onChangeForm={setCanvasForm}
          onSave={() => void handleSaveCanvasForm()}
        />
      </>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="p-3.5 space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[11rem]">
            <label className="text-[11px] font-medium text-fg-muted">Canvas</label>
            <Select
              value={activeCanvas?.id ?? ""}
              onChange={(event) => setSelectedCanvasId(event.target.value)}
              className="mt-1"
            >
              {storyCanvases.map((canvas) => (
                <option key={canvas.id} value={canvas.id}>
                  {canvas.name}
                </option>
              ))}
            </Select>
          </div>
          <Button size="sm" variant="secondary" onClick={openCreateCanvas}>
            <Plus className="w-3.5 h-3.5" />
            New
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={!activeCanvas}
            onClick={openCanvasSettings}
          >
            <Settings2 className="w-3.5 h-3.5" />
            Settings
          </Button>
          <Button
            size="sm"
            variant="danger"
            disabled={!activeCanvas}
            onClick={() => setDeleteCanvasOpen(true)}
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete
          </Button>
          <div className="flex-1" />
          <Button
            size="sm"
            variant="primary"
            loading={syncing}
            disabled={!activeCanvas}
            onClick={() => void handleSync()}
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Sync from Scenes
          </Button>
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          <div>
            <label className="text-[11px] font-medium text-fg-muted">Template</label>
            <Select
              value={activeCanvas?.template ?? "grid_2x3"}
              onChange={(event) =>
                void handleCanvasSettingChange({
                  template: event.target.value as CanvasTemplate,
                })
              }
              className="mt-1"
            >
              {CANVAS_TEMPLATES.map((template) => (
                <option key={template} value={template}>
                  {CANVAS_TEMPLATE_LABELS[template]}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className="text-[11px] font-medium text-fg-muted">Page size</label>
            <Select
              value={activeCanvas?.pageSize ?? "a4_landscape"}
              onChange={(event) =>
                void handleCanvasSettingChange({
                  pageSize: event.target.value as CanvasPageSize,
                })
              }
              className="mt-1"
            >
              {CANVAS_PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {CANVAS_PAGE_SIZE_LABELS[size]}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className="text-[11px] font-medium text-fg-muted">Caption mode</label>
            <Select
              value={activeCanvas?.captionMode ?? "scene_title"}
              onChange={(event) =>
                void handleCanvasSettingChange({
                  captionMode: event.target.value as CanvasCaptionMode,
                })
              }
              className="mt-1"
            >
              {CANVAS_CAPTION_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {CANVAS_CAPTION_MODE_LABELS[mode]}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border">
          <Button
            size="sm"
            variant="secondary"
            loading={exporting === "png"}
            disabled={Boolean(exporting) || !activeCanvas}
            onClick={() => void handleExport("png")}
          >
            <Download className="w-3.5 h-3.5" />
            Export PNG
          </Button>
          <Button
            size="sm"
            variant="secondary"
            loading={exporting === "pdf"}
            disabled={Boolean(exporting) || !activeCanvas}
            onClick={() => void handleExport("pdf")}
          >
            <Download className="w-3.5 h-3.5" />
            Export PDF
          </Button>
          <Button
            size="sm"
            variant="ghost"
            loading={openingFolder}
            onClick={() => void handleOpenFolder()}
          >
            <FolderOpen className="w-3.5 h-3.5" />
            Open export folder
          </Button>
          <div className="flex-1" />
          <span className="text-[11px] text-fg-subtle">
            {activeCanvas?.items.length ?? 0} panel
            {(activeCanvas?.items.length ?? 0) === 1 ? "" : "s"} ·{" "}
            {pages.length} page{pages.length === 1 ? "" : "s"}
          </span>
        </div>
      </Card>

      {!activeCanvas || activeCanvas.items.length === 0 ? (
        <EmptyState
          icon={<RefreshCw className="w-6 h-6" />}
          title="This canvas is empty"
          description="Sync from scenes to place every scene on the board using its selected key frame, then refine captions and dialogue."
          action={
            <Button variant="primary" loading={syncing} onClick={() => void handleSync()}>
              <RefreshCw className="w-3.5 h-3.5" />
              Sync from Scenes
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]">
          <CanvasPagesStage
            pages={pages}
            images={images}
            selectedItem={selectedItem}
            onSelectItem={setSelectedItemId}
          />
          <CanvasPanelInspector
            story={story}
            activeCanvas={activeCanvas}
            selectedItem={selectedItem}
            images={images}
            imagesForScene={imagesForScene}
            sceneMap={sceneMap}
            panelForm={panelForm}
            setPanelForm={setPanelForm}
            savingPanel={savingPanel}
            overlayForm={overlayForm}
            setOverlayForm={setOverlayForm}
            savingOverlay={savingOverlay}
            onSavePanel={() => void handleSavePanel()}
            onMovePanel={(direction) => void movePanel(direction)}
            onRemovePanel={() => void removePanel()}
            onSaveOverlay={() => void handleSaveOverlay()}
            onRemoveOverlay={(id) => void handleRemoveOverlay(id)}
          />
        </div>
      )}
      <CanvasSettingsModal
        open={canvasModalOpen}
        editingCanvas={editingCanvas}
        canvasForm={canvasForm}
        savingCanvas={savingCanvas}
        onClose={() => setCanvasModalOpen(false)}
        onChangeForm={setCanvasForm}
        onSave={() => void handleSaveCanvasForm()}
      />
      <ConfirmDialog
        open={deleteCanvasOpen}
        title="Delete canvas"
        description={`Delete '${activeCanvas?.name ?? "canvas"}' and all of its panels? Exported files stay on disk.`}
        confirmLabel="Delete canvas"
        danger
        onClose={() => setDeleteCanvasOpen(false)}
        onConfirm={() => void handleDeleteCanvas()}
      />
    </div>
  );
};