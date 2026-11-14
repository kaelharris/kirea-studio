import React from "react";
import { Cpu, Play, Wand2 } from "lucide-react";
import { calculateDimensionsForAspect } from "../shared/aspect-ratios";
import {
  getEffectiveArchitecture,
  getEffectiveModelInfo,
} from "../shared/model-utils";
import type { PerformanceProfile } from "../shared/types";
import { ImagePreviewModal } from "./components/ImagePreviewModal";
import { RuntimeSetupBanner } from "./components/RuntimeSetupBanner";
import { Badge, Button } from "./components/ui/Primitives";
import { CharactersPage } from "./pages/CharactersPage";
import { CreatePage } from "./pages/CreatePage";
import { ExplorePage } from "./pages/ExplorePage";
import { HomePage } from "./pages/HomePage";
import { LibraryPage } from "./pages/LibraryPage";
import { ModelsPage } from "./pages/ModelsPage";
import { QueuePage } from "./pages/QueuePage";
import { SettingsPage } from "./pages/SettingsPage";
import { StoryStudioPage } from "./pages/StoryStudioPage";
import { WorkflowsPage } from "./pages/WorkflowsPage";
import { SidebarNav } from "./app/SidebarNav";
import { ToastStack } from "./app/ToastStack";
import { JobStatusAnnouncer } from "./app/JobStatusAnnouncer";
import { useAppController } from "./app/useAppController";

export const App: React.FC = () => {
  const {
    activePage,
    setActivePage,
    settings,
    setSettings,
    resolvedTheme,
    runtime,
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
    toasts,
    pushToast,
    activeWorkCount,
    handleUpdateSettings,
    handleStartRuntime,
    handleStopRuntime,
    handleTestConnection,
    handleApplyPreset,
    handleUpscaleImage,
    handleReuseImageSettings,
    handleToggleFavorite,
    handleUpdateImageMeta,
    handleDeleteImage,
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

  // The setup banner carries its own Start Engine action, so the header copy
  // is only shown on pages where the banner is not rendered.
  const showRuntimeBanner =
    runtime.status !== "connected" &&
    (activePage === "home" ||
      activePage === "create" ||
      activePage === "workflows");

  return (
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
        <header className="h-12 shrink-0 px-6 border-b border-border bg-surface flex items-center justify-between gap-4">
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
        <main className="flex-1 overflow-y-auto">
          <div
            className={`mx-auto w-full p-6 space-y-6 ${
              activePage === "create" ? "max-w-none" : "max-w-[1600px]"
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
              onInspectImage={setInspectedImage}
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
              onInspectImage={setInspectedImage}
              onToggleFavorite={handleToggleFavorite}
              onSavePrompt={async (rec) => {
                const saved = await window.kirea.savePrompt(rec);
                setPrompts((prev) => [
                  saved,
                  ...prev.filter((p) => p.id !== saved.id),
                ]);
              }}
              onToast={pushToast}
            />
          )}

          {activePage === "library" && (
            <LibraryPage
              images={images}
              collections={collections}
              density={settings.galleryLayout}
              onInspectImage={setInspectedImage}
              onReuseSettings={handleReuseImageSettings}
              onToggleFavorite={handleToggleFavorite}
              onRemoveMissing={handleRemoveMissingImages}
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
              onNavigate={setActivePage}
            />
          )}

          {activePage === "characters" && (
            <CharactersPage
              characters={characters}
              models={models}
              recipes={recipes}
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
              onInspectImage={setInspectedImage}
              onToast={pushToast}
            />
          )}

          {activePage === "models" && (            <ModelsPage
              models={models}
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
              onImportPreview={async (modelId) => {
                const updated = await window.kirea.importModelPreview(modelId);
                if (updated) {
                  setModels((prev) =>
                    prev.map((m) => (m.id === updated.id ? updated : m))
                  );
                }
                return updated;
              }}
              onUseModel={(model) => {
                if (model.category === "lora") {
                  const info = getEffectiveModelInfo(model);
                  const maxLoras =
                    workflows.find((w) => w.id === draft.workflowId)?.maxLoras ??
                    4;
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
                  pushToast(`Selected ${model.name} in Upscale Studio.`);
                  return;
                }

                const arch = getEffectiveArchitecture(model);
                const dims = calculateDimensionsForAspect(
                  draft.aspectRatio,
                  arch,
                  settings.performanceProfile
                );
                const wfId =
                  arch === "z_image"
                    ? "t2i_z_image_turbo"
                    : arch === "sd15"
                      ? "t2i_sd15_base"
                      : "t2i_sdxl_base";
                const wf = workflows.find((w) => w.id === wfId);
                setDraft((p) => ({
                  ...p,
                  mode: "txt2img",
                  workflowId: wfId,
                  checkpoint: model.relativePath,
                  width: dims.width,
                  height: dims.height,
                  ...(wf && arch === "z_image"
                    ? {
                        steps: wf.defaults.steps,
                        cfg: wf.defaults.cfg,
                        sampler: wf.defaults.sampler,
                        scheduler: wf.defaults.scheduler,
                      }
                    : {}),
                }));
                setActivePage("create");
                pushToast(`Selected ${model.name} in Create Studio.`);
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
              downloads={downloads}
              onNavigate={setActivePage}
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
              onUpdateSettings={handleUpdateSettings}
              onStartRuntime={handleStartRuntime}
              onStopRuntime={handleStopRuntime}
              onTestConnection={handleTestConnection}
              onToast={pushToast}
            />
          )}
          </div>
        </main>
      </div>

      {/* GLOBAL IMAGE METADATA LIGHTBOX */}
      <ImagePreviewModal
        image={inspectedImage}
        collections={collections}
        characters={characters}
        onClose={() => setInspectedImage(null)}
        onReuseSettings={handleReuseImageSettings}
        onUpscaleImage={handleUpscaleImage}
        onToggleFavorite={handleToggleFavorite}
        onUpdateMeta={handleUpdateImageMeta}
        onAddToCharacter={handleAddImageToCharacter}
        onDelete={handleDeleteImage}
        onToast={pushToast}
      />

      <ToastStack toasts={toasts} />
      <JobStatusAnnouncer jobs={jobs} />
    </div>
  );
};
