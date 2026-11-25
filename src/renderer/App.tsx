import React from "react";
import { Cpu, Play, Wand2 } from "lucide-react";
import { Toaster } from "sonner";
import {
  dimensionBoundsFromWorkflow,
  resolveDimensionsForAspect,
} from "../shared/aspect-ratios";
import {
  getEffectiveArchitecture,
  getEffectiveModelInfo,
} from "../shared/model-utils";
import type { GeneratedImageRecord, PerformanceProfile } from "../shared/types";
import { ImagePreviewModal } from "./components/ImagePreviewModal";
import { RuntimeSetupBanner } from "./components/RuntimeSetupBanner";
import { Badge, Button, ContextMenuProvider } from "./components/ui/Primitives";
import { CharactersPage } from "./pages/CharactersPage";
import { CreatePage } from "./pages/CreatePage";
import { ExplorePage } from "./pages/ExplorePage";
import { HomePage } from "./pages/HomePage";
import { LibraryPage } from "./pages/LibraryPage";
import { ModelsPage } from "./pages/ModelsPage";
import { QueuePage } from "./pages/QueuePage";
import { SettingsPage } from "./pages/SettingsPage";
import { StoryStudioPage } from "./pages/StoryStudioPage";
import { VideoStudioPage } from "./pages/VideoStudioPage";
import { PixelStudioPage } from "./pages/PixelStudioPage";
import { WorkflowsPage } from "./pages/WorkflowsPage";
import { SidebarNav } from "./app/SidebarNav";
import { JobStatusAnnouncer } from "./app/JobStatusAnnouncer";
import { UpdateNotice } from "./components/UpdateNotice";
import { useAppController } from "./app/useAppController";

export const App: React.FC = () => {
  const {
    activePage,
    setActivePage,
    settings,
    setSettings,
    resolvedTheme,
    runtime,
    updateState,
    hardware,
    models,
    setModels,
    catalog,
    downloads,
    civitaiDownloads,
    workflows,
    samplersAndSchedulers,
    jobs,
    setJobs,
    images,
    setImages,
    collections,
    setCollections,
    prompts,
    setPrompts,
    recipes,
    characters,
    stories,
    canvases,
    activeCharacterId,
    setActiveCharacterId,
    activeRecipeId,
    setActiveRecipeId,
    draft,
    setDraft,
    inspectedImage,
    setInspectedImage,
    startingRuntime,
    pushToast,
    activeWorkCount,
    handleUpdateSettings,
    handleCheckForUpdates,
    handleDownloadUpdate,
    handleCancelUpdateDownload,
    handleDismissUpdate,
    handleSetUpdateChannel,
    handleInstallUpdate,
    handleStartRuntime,
    handleStopRuntime,
    handleTestConnection,
    handleApplyPreset,
    handleUpscaleImage,
    handleReuseImageSettings,
    handleSendImageToWorkflow,
    handleToggleFavorite,
    handleUpdateImageMeta,
    handleDeleteImage,
    handleDeleteJob,
    handleDeleteJobs,
    handleClearDownloadHistory,
    handleRemoveMissingImages,
    handleSaveRecipe,
    handleDeleteRecipe,
    handleLoadRecipe,
    handleSaveCharacter,
    handleDeleteCharacter,
    applyCharacterUpdate,
    handleUseCharacter,
    handleAddImageToCharacter,
    handleSaveStory,
    handleDeleteStory,
    handleSaveStoryScene,
    handleDeleteStoryScene,
    handleReorderStoryScenes,
    handleSelectStorySceneImage,
    handleGenerateStoryScene,
    handleGenerateStory,
    handleSaveCanvas,
    handleDeleteCanvas,
    handleSaveCanvasItem,
    handleDeleteCanvasItem,
    handleReorderCanvasItems,
    handleSyncCanvas,
    handleExportCanvasPng,
    handleExportCanvasPdf,
    handleOpenCanvasExportFolder,
  } = useAppController();

  const [libraryFocus, setLibraryFocus] = React.useState<{
    videoId?: string;
    pixelAssetId?: string;
    pixelAssetTab?: "editor" | "animation";
    characterId?: string;
  } | null>(null);
  const clearLibraryFocus = React.useCallback(() => setLibraryFocus(null), []);

  // The viewer navigates within the collection that launched it. Pages that
  // show a filtered list pass that list so arrow keys cannot escape the filter.
  const [viewerImageIds, setViewerImageIds] = React.useState<string[] | null>(
    null
  );
  const openImageInspector = React.useCallback(
    (img: GeneratedImageRecord, collection?: GeneratedImageRecord[]) => {
      setViewerImageIds(collection ? collection.map((item) => item.id) : null);
      setInspectedImage(img);
    },
    [setInspectedImage]
  );
  const closeImageInspector = React.useCallback(() => {
    setViewerImageIds(null);
    setInspectedImage(null);
  }, [setInspectedImage]);
  const viewerImages = React.useMemo(() => {
    if (!viewerImageIds) return null;
    const byId = new Map(images.map((img) => [img.id, img]));
    return viewerImageIds.flatMap((id) => {
      const match = byId.get(id);
      return match ? [match] : [];
    });
  }, [viewerImageIds, images]);

  // The setup banner carries its own Start Engine action, so the header copy
  // is only shown on pages where the banner is not rendered.
  const showRuntimeBanner =
    runtime.status !== "connected" &&
    (activePage === "home" ||
      activePage === "create" ||
      activePage === "video" ||
      activePage === "workflows");

  return (
    <ContextMenuProvider>
      <div className="h-screen w-screen overflow-hidden flex bg-bg text-fg">
      <SidebarNav
        activePage={activePage}
        activeWorkCount={activeWorkCount}
        theme={resolvedTheme}
        followsSystem={settings.theme === "system"}
        onSelectPage={setActivePage}
        onToggleTheme={() =>
          void handleUpdateSettings({
            theme: resolvedTheme === "dark" ? "light" : "dark",
          })
        }
      />

      {/* MAIN CONTENT SHELL */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* TOP STATUS BAR */}
        <header className="h-12 shrink-0 px-4 sm:px-5 border-b border-border bg-surface flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <Cpu className="w-4 h-4 text-fg-subtle shrink-0" />
            <span className="text-small font-semibold text-fg truncate">
              {hardware?.name ?? "No NVIDIA GPU detected"}
            </span>
            {hardware?.available && (
              <span className="font-mono text-[11px] text-fg-subtle tabular-nums hidden lg:inline">
                {Math.round((hardware.vramFreeMB / 1024) * 10) / 10} /{" "}
                {Math.round((hardware.vramTotalMB / 1024) * 10) / 10} GB VRAM
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Badge
              tone={
                runtime.status === "connected"
                  ? "success"
                  : runtime.status === "error"
                    ? "danger"
                    : "warning"
              }
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  runtime.status === "connected"
                    ? "bg-success"
                    : runtime.status === "error"
                      ? "bg-danger"
                      : "bg-warning animate-pulse"
                }`}
              />
              ComfyUI:{" "}
              {runtime.status === "connected"
                ? `Connected${runtime.comfyVersion ? ` v${runtime.comfyVersion}` : ""}`
                : runtime.status}
            </Badge>

            {runtime.status !== "connected" &&
              runtime.isConfiguredPathValid &&
              !showRuntimeBanner && (
              <Button
                size="sm"
                variant="primary"
                loading={startingRuntime || runtime.status === "starting"}
                onClick={() => void handleStartRuntime()}
              >
                <Play className="w-3 h-3" />
                Start Engine
              </Button>
            )}

            {activePage !== "create" && activePage !== "home" && (
              <Button
                size="sm"
                variant={runtime.status === "connected" ? "primary" : "secondary"}
                onClick={() => setActivePage("create")}
              >
                <Wand2 className="w-3.5 h-3.5" />
                New generation
              </Button>
            )}
          </div>
        </header>

        {/* WORKSPACE VIEWPORT */}
        <main
          className={
            activePage === "create"
              ? "flex-1 min-h-0 overflow-hidden"
              : "flex-1 overflow-y-auto"
          }
        >
          <div
            className={`mx-auto w-full ${
              activePage === "create"
                ? "flex h-full min-h-0 flex-col max-w-none gap-2 p-2 sm:p-2.5"
                : activePage === "video"
                  ? "max-w-none p-2.5 sm:p-3 space-y-2.5"
                  : "max-w-[1600px] p-4 sm:p-5 space-y-4 sm:space-y-5"
            }`}
          >
          {showRuntimeBanner && (
            <RuntimeSetupBanner
              runtime={runtime}
              starting={startingRuntime}
              onStartRuntime={() => void handleStartRuntime()}
              onTestConnection={() => void handleTestConnection()}
              onNavigate={setActivePage}
            />
          )}

          {activePage === "home" && (
            <HomePage
              runtime={runtime}
              hardware={hardware}
              models={models}
              images={images}
              jobs={jobs}
              downloads={downloads}
              onNavigate={setActivePage}
              onApplyPreset={handleApplyPreset}
              onInspectImage={openImageInspector}
              onStartMode={(mode) => {
                setDraft((p) => ({
                  ...p,
                  mode,
                  workflowId:
                    mode === "img2img" ? "i2i_sdxl_base" : "t2i_sdxl_base",
                }));
                setActivePage("create");
              }}
            />
          )}

          {activePage === "explore" && (
            <ExplorePage
              prompts={prompts}
              recipes={recipes}
              activeRecipeId={activeRecipeId}
              models={models}
              onApplyPreset={handleApplyPreset}
              onLoadRecipe={handleLoadRecipe}
              onSaveRecipe={handleSaveRecipe}
              onDeleteRecipe={handleDeleteRecipe}
              onApplyPrompt={(prompt, negativePrompt) => {
                setDraft((p) => ({ ...p, prompt, negativePrompt }));
                setActivePage("create");
                pushToast("Loaded prompt into Create Studio.");
              }}
              onSavePrompt={async (rec) => {
                const saved = await window.kirea.savePrompt(rec);
                setPrompts((prev) => [
                  saved,
                  ...prev.filter((p) => p.id !== saved.id),
                ]);
              }}
              onDeletePrompt={async (id) => {
                await window.kirea.deletePrompt(id);
                setPrompts((prev) => prev.filter((p) => p.id !== id));
              }}
              onToast={pushToast}
            />
          )}

          {activePage === "create" && (
            <CreatePage
              draft={draft}
              setDraft={setDraft}
              settings={settings}
              runtime={runtime}
              models={models}
              workflows={workflows}
              samplersAndSchedulers={samplersAndSchedulers}
              jobs={jobs}
              images={images}
              recipes={recipes}
              characters={characters}
              activeCharacterId={activeCharacterId}
              onSelectCharacter={setActiveCharacterId}
              onOpenCharacters={() => setActivePage("characters")}
              activeRecipeId={activeRecipeId}
              onSelectRecipe={setActiveRecipeId}
              onSaveRecipe={handleSaveRecipe}
              onChangeProfile={async (profile: PerformanceProfile) => {
                await handleUpdateSettings({ performanceProfile: profile });
              }}
              onInspectImage={openImageInspector}
              onToggleFavorite={handleToggleFavorite}
              onDeleteImage={handleDeleteImage}
              onDeleteJob={handleDeleteJob}
              onSavePrompt={async (rec) => {
                const saved = await window.kirea.savePrompt(rec);
                setPrompts((prev) => [
                  saved,
                  ...prev.filter((p) => p.id !== saved.id),
                ]);
              }}
              onUpdateSettings={handleUpdateSettings}
              onToast={pushToast}
            />
          )}

          {activePage === "video" && (
            <VideoStudioPage
              workflows={workflows}
              models={models}
              settings={settings}
              runtime={runtime}
              hardware={hardware}
              jobs={jobs}
              initialVideoId={libraryFocus?.videoId}
              onFocusApplied={clearLibraryFocus}
              onToast={pushToast}
            />
          )}

          {activePage === "library" && (
            <LibraryPage
              images={images}
              collections={collections}
              density={settings.galleryLayout}
              onInspectImage={openImageInspector}
              onReuseSettings={handleReuseImageSettings}
              onSendToWorkflow={handleSendImageToWorkflow}
              onToggleFavorite={handleToggleFavorite}
              onDeleteImage={handleDeleteImage}
              onRemoveMissing={handleRemoveMissingImages}
              onDeleteCharacter={handleDeleteCharacter}
              onSaveCharacter={handleSaveCharacter}
              onCreateCollection={async (name, desc) => {
                const col = await window.kirea.createCollection(name, desc);
                setCollections((prev) => [...prev, col]);
                pushToast(`Created collection '${col.name}'.`);
              }}
              onDeleteCollection={async (id) => {
                await window.kirea.deleteCollection(id);
                setCollections((prev) => prev.filter((c) => c.id !== id));
                setImages(await window.kirea.listImages());
                pushToast("Deleted collection.");
              }}
              onOpenVideo={(videoId) => {
                setLibraryFocus({ videoId });
                setActivePage("video");
              }}
              onOpenPixelAsset={(pixelAssetId, pixelAssetTab) => {
                setLibraryFocus({ pixelAssetId, pixelAssetTab });
                setActivePage("pixel");
              }}
              onOpenCharacter={(characterId) => {
                setLibraryFocus({ characterId });
                setActivePage("characters");
              }}
              onNavigate={setActivePage}
              onToast={pushToast}
            />
          )}

          {activePage === "characters" && (
            <CharactersPage
              characters={characters}
              models={models}
              recipes={recipes}
              initialCharacterId={libraryFocus?.characterId}
              onFocusApplied={clearLibraryFocus}
              onSaveCharacter={handleSaveCharacter}
              onDeleteCharacter={handleDeleteCharacter}
              onPickReference={async (characterId, role) => {
                const updated = await window.kirea.pickCharacterReference(
                  characterId,
                  role
                );
                applyCharacterUpdate(updated);
                return updated;
              }}
              onUpdateReference={async (characterId, referenceId, patch) => {
                const updated = await window.kirea.updateCharacterReference(
                  characterId,
                  referenceId,
                  patch
                );
                applyCharacterUpdate(updated);
                return updated;
              }}
              onRemoveReference={async (characterId, referenceId) => {
                const updated = await window.kirea.removeCharacterReference(
                  characterId,
                  referenceId
                );
                applyCharacterUpdate(updated);
                return updated;
              }}
              onUseCharacter={handleUseCharacter}
              onToast={pushToast}
            />
          )}

          {activePage === "stories" && (
            <StoryStudioPage
              stories={stories}
              canvases={canvases}
              characters={characters}
              models={models}
              recipes={recipes}
              images={images}
              jobs={jobs}
              settings={settings}
              onSaveStory={handleSaveStory}
              onDeleteStory={handleDeleteStory}
              onSaveScene={handleSaveStoryScene}
              onDeleteScene={handleDeleteStoryScene}
              onReorderScenes={handleReorderStoryScenes}
              onSelectSceneImage={handleSelectStorySceneImage}
              onGenerateScene={handleGenerateStoryScene}
              onGenerateStory={handleGenerateStory}
              onSaveCanvas={handleSaveCanvas}
              onDeleteCanvas={handleDeleteCanvas}
              onSaveCanvasItem={handleSaveCanvasItem}
              onDeleteCanvasItem={handleDeleteCanvasItem}
              onReorderCanvasItems={handleReorderCanvasItems}
              onSyncCanvas={handleSyncCanvas}
              onExportCanvasPng={handleExportCanvasPng}
              onExportCanvasPdf={handleExportCanvasPdf}
              onOpenCanvasExportFolder={handleOpenCanvasExportFolder}
              onInspectImage={openImageInspector}
              onToast={pushToast}
            />
          )}

          {activePage === "pixel" && (
            <PixelStudioPage
              initialAssetId={libraryFocus?.pixelAssetId}
              initialAssetTab={libraryFocus?.pixelAssetTab}
              onFocusApplied={clearLibraryFocus}
              onToast={pushToast}
            />
          )}

          {activePage === "models" && (
            <ModelsPage
              models={models}
              images={images}
              catalog={catalog}
              downloads={downloads}
              civitaiDownloads={civitaiDownloads}
              settings={settings}
              hardware={hardware}
              workflows={workflows}
              managedModelsRootHint={
                settings.cacheDirectory
                  ? settings.cacheDirectory.replace(/[\\/]cache$/i, "\\models")
                  : ""
              }
              onScanModels={async () => {
                const scanned = await window.kirea.scanModels();
                setModels(scanned);
              }}
              onUpdateModelMetadata={async (modelId, patch) => {
                const updated = await window.kirea.updateModelMetadata(
                  modelId,
                  patch
                );
                setModels((prev) =>
                  prev.map((m) => (m.id === updated.id ? updated : m))
                );
                return updated;
              }}
              onImportPreview={async (modelId, sourceFilePath) => {
                const updated = await window.kirea.importModelPreview(modelId, sourceFilePath);
                if (updated) {
                  setModels((prev) =>
                    prev.map((m) => (m.id === updated.id ? updated : m))
                  );
                }
                return updated;
              }}
              onClearDownloadHistory={handleClearDownloadHistory}
              onUpdateSettings={handleUpdateSettings}
              onOpenSettings={() => setActivePage("settings")}
              onUseModel={(model) => {
                if (model.category === "lora") {
                  const info = getEffectiveModelInfo(model);
                  const activeWf = workflows.find((w) => w.id === draft.workflowId);
                  const isIllustrious =
                    activeWf?.id === "t2i_illustrious_base" ||
                    activeWf?.id === "i2i_illustrious_base" ||
                    (models.find((m) => m.relativePath === draft.checkpoint)?.architecture === "illustrious" &&
                      (draft.workflowId === "t2i_sdxl_base" || draft.workflowId === "i2i_sdxl_base"));
                  const maxLoras = isIllustrious ? 10 : (activeWf?.maxLoras ?? 4);
                  if (draft.loras.some((l) => l.name === model.relativePath)) {
                    pushToast(`${info.name} is already in the LoRA stack.`);
                    return;
                  }
                  if (draft.loras.length >= maxLoras) {
                    pushToast(
                      `The active workflow accepts at most ${maxLoras} LoRAs.`,
                      "error"
                    );
                    return;
                  }
                  setDraft((p) => ({
                    ...p,
                    loras: [
                      ...p.loras,
                      {
                        name: model.relativePath,
                        strengthModel: 0.85,
                        strengthClip: 0.85,
                      },
                    ],
                  }));
                  setActivePage("create");
                  pushToast(`Added ${info.name} to the LoRA stack.`);
                  return;
                }

                if (model.category === "upscale") {
                  setDraft((p) => ({
                    ...p,
                    mode: "upscale",
                    workflowId: "upscale_model_v1",
                    upscale: {
                      upscaler: model.relativePath,
                      scale: p.upscale?.scale ?? 4,
                    },
                  }));
                  setActivePage("create");
                  pushToast(`Selected ${getEffectiveModelInfo(model).name} in Upscale Studio.`);
                  return;
                }

                const arch = getEffectiveArchitecture(model);
                const isBase = model.relativePath.toLowerCase().includes("moss_image_base_");
                const isTurbo = model.relativePath.toLowerCase().includes("turbo") || model.name.toLowerCase().includes("turbo");
                const wfId =
                  arch === "z_image"
                    ? "t2i_z_image_turbo"
                    : arch === "anima"
                      ? "t2i_anima_base"
                      : arch === "krea2"
                        ? "t2i_krea2_base"
                        : arch === "illustrious"
                          ? "t2i_illustrious_base"
                        : arch === "moss_image"
                          ? isTurbo
                            ? "t2i_moss_image_turbo"
                            : isBase
                              ? "t2i_moss_image_base"
                              : "t2i_moss_image"
                          : arch === "sd15"
                            ? "t2i_sd15_base"
                            : "t2i_sdxl_base";
                const wf = workflows.find((w) => w.id === wfId);
                const dims = resolveDimensionsForAspect(
                  draft.aspectRatio,
                  arch,
                  settings.performanceProfile,
                  dimensionBoundsFromWorkflow(wf)
                );
                setDraft((p) => ({
                  ...p,
                  mode: "txt2img",
                  workflowId: wfId,
                  checkpoint: model.relativePath,
                  width: dims.width,
                  height: dims.height,
                  ...(wf && (arch === "z_image" || arch === "moss_image" || arch === "anima")
                    ? {
                        steps: wf.defaults.steps,
                        cfg: wf.defaults.cfg,
                        sampler: wf.defaults.sampler,
                        scheduler: wf.defaults.scheduler,
                      }
                    : {}),
                }));
                setActivePage("create");
                pushToast(`Selected ${getEffectiveModelInfo(model).name} in Create Studio.`);
              }}
              onDeleteModel={async (filePath) => {
                await window.kirea.deleteModel(filePath);
                setModels(await window.kirea.listModels());
                pushToast("Deleted app-managed model.");
              }}
              onToast={pushToast}
            />
          )}

          {activePage === "workflows" && (
            <WorkflowsPage
              workflows={workflows}
              models={models}
              runtime={runtime}
              onToast={pushToast}
              onUseWorkflow={(wf) => {
                const installedUpscaler =
                  models.find((m) => m.installed && m.category === "upscale")
                    ?.relativePath ?? "lanczos";
                setDraft((p) =>
                  wf.mode === "upscale"
                    ? {
                        ...p,
                        mode: "upscale",
                        workflowId: wf.id,
                        upscale: {
                          upscaler: p.upscale?.upscaler || installedUpscaler,
                          scale: p.upscale?.scale ?? 4,
                        },
                      }
                    : {
                        ...p,
                        mode: wf.mode,
                        workflowId: wf.id,
                        steps: wf.defaults.steps,
                        cfg: wf.defaults.cfg,
                        sampler: wf.defaults.sampler,
                        scheduler: wf.defaults.scheduler,
                        denoise: wf.defaults.denoise,
                        width: wf.defaults.width,
                        height: wf.defaults.height,
                      }
                );
                setActivePage("create");
                pushToast(`Loaded workflow '${wf.name}'.`);
              }}
            />
          )}

          {activePage === "queue" && (
            <QueuePage
              jobs={jobs}
              models={models}
              downloads={downloads}
              onNavigate={setActivePage}
              onClearDownloads={handleClearDownloadHistory}
              onDeleteJob={handleDeleteJob}
              onDeleteJobs={handleDeleteJobs}
              onToast={pushToast}
            />
          )}

          {activePage === "settings" && (
            <SettingsPage
              settings={settings}
              runtime={runtime}
              hardware={hardware}
              downloads={downloads}
              samplersAndSchedulers={samplersAndSchedulers}
              updateState={updateState}
              onUpdateSettings={handleUpdateSettings}
              onStartRuntime={handleStartRuntime}
              onStopRuntime={handleStopRuntime}
              onTestConnection={handleTestConnection}
              onCheckForUpdates={handleCheckForUpdates}
              onDownloadUpdate={handleDownloadUpdate}
              onCancelUpdateDownload={handleCancelUpdateDownload}
              onInstallUpdate={handleInstallUpdate}
              onSetUpdateChannel={handleSetUpdateChannel}
              onToast={pushToast}
            />
          )}
          </div>
        </main>
      </div>

      {/* GLOBAL IMAGE METADATA LIGHTBOX */}
      <ImagePreviewModal
        image={inspectedImage}
        images={viewerImages ?? images}
        onSelectImage={setInspectedImage}
        collections={collections}
        characters={characters}
        models={models}
        onClose={closeImageInspector}
        onReuseSettings={handleReuseImageSettings}
        onUpscaleImage={handleUpscaleImage}
        onSendToWorkflow={handleSendImageToWorkflow}
        onToggleFavorite={handleToggleFavorite}
        onUpdateMeta={handleUpdateImageMeta}
        onAddToCharacter={handleAddImageToCharacter}
        onDelete={handleDeleteImage}
        onToast={pushToast}
      />

      <UpdateNotice
        state={updateState}
        onDownload={() => void handleDownloadUpdate()}
        onCancel={() => void handleCancelUpdateDownload()}
        onLater={() => void handleDismissUpdate()}
        onInstall={handleInstallUpdate}
      />

      <Toaster
        theme={resolvedTheme}
        position="bottom-right"
        duration={4500}
        closeButton
        visibleToasts={3}
        gap={8}
        offset={16}
        toastOptions={{
          duration: 4500,
          style: {
            background: "var(--surface-elevated)",
            color: "var(--fg)",
            border: "1px solid var(--border-strong)",
            borderRadius: "var(--radius-lg)",
            boxShadow: "var(--shadow-float)",
            fontFamily: "var(--font-sans)",
          },
        }}
      />
      <JobStatusAnnouncer jobs={jobs} />
    </div>
  </ContextMenuProvider>
);
};
