import { useCallback, useEffect, useRef, useState } from "react";
import {
  dimensionBoundsFromWorkflow,
  inferModelArchitecture,
  resolveDimensionsForAspect,
} from "../../shared/aspect-ratios";
import {
  getEffectiveArchitecture,
  getEffectiveModelInfo,
  isGenerationSupportedArchitecture,
} from "../../shared/model-utils";
import type { CivitaiDownloadTask } from "../../shared/civitai";
import type {
  AppSettings,
  CharacterProfile,
  CharacterProfileInput,
  CharacterReferenceRole,
  CollectionRecord,
  CuratedModelCatalogItem,
  DownloadTask,
  GeneratedImageRecord,
  GenerationJob,
  GenerationRequest,
  GpuStats,
  LoraRecipe,
  LoraRecipeInput,
  ModelRecord,
  NavSection,
  PerformanceProfile,
  PromptRecord,
  RuntimeMode,
  RuntimeState,
  Story,
  StoryCanvas,
  StoryCanvasInput,
  StoryCanvasItemInput,
  StoryExportResult,
  StoryInput,
  StorySceneInput,
  StudioPreset,
  WorkflowTemplate,
} from "../../shared/types";
import {
  DEFAULT_RUNTIME,
  DEFAULT_SETTINGS,
  DEFAULT_UPDATE_STATE,
  INITIAL_DRAFT,
  type ToastItem,
} from "./app-constants";
import type {
  UpdateChannel,
  UpdateInstallResult,
  UpdateState,
} from "../../shared/update-types";
import {
  applyTheme,
  commitPersistedTheme,
  readStoredThemePreference,
  resolveTheme,
  watchSystemTheme,
  type ResolvedTheme,
} from "./theme";

export function useAppController() {
  const [activePage, setActivePage] = useState<NavSection>("home");
  // Seed the theme from the pre-paint mirror so the first render matches theme-boot.js.
  const [settings, setSettings] = useState<AppSettings>(() => ({
    ...DEFAULT_SETTINGS,
    theme: readStoredThemePreference() ?? DEFAULT_SETTINGS.theme,
  }));
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    resolveTheme(settings.theme)
  );
  const [runtime, setRuntime] = useState<RuntimeState>(DEFAULT_RUNTIME);
  const [updateState, setUpdateState] = useState<UpdateState>(DEFAULT_UPDATE_STATE);
  const [hardware, setHardware] = useState<GpuStats | null>(null);
  const [models, setModels] = useState<ModelRecord[]>([]);
  const [catalog, setCatalog] = useState<CuratedModelCatalogItem[]>([]);
  const [downloads, setDownloads] = useState<DownloadTask[]>([]);
  const [civitaiDownloads, setCivitaiDownloads] = useState<CivitaiDownloadTask[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowTemplate[]>([]);
  const [samplersAndSchedulers, setSamplersAndSchedulers] = useState<{
    samplers: string[];
    schedulers: string[];
  }>({
    samplers: ["euler", "euler_ancestral", "dpmpp_2m", "dpmpp_2m_sde", "res_multistep"],
    schedulers: ["normal", "karras", "simple", "exponential"],
  });
  const [jobs, setJobs] = useState<GenerationJob[]>([]);
  const [images, setImages] = useState<GeneratedImageRecord[]>([]);
  const [collections, setCollections] = useState<CollectionRecord[]>([]);
  const [prompts, setPrompts] = useState<PromptRecord[]>([]);
  const [recipes, setRecipes] = useState<LoraRecipe[]>([]);
  const [characters, setCharacters] = useState<CharacterProfile[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [canvases, setCanvases] = useState<StoryCanvas[]>([]);
  const [activeCharacterId, setActiveCharacterId] = useState<string | null>(null);
  const [activeRecipeId, setActiveRecipeId] = useState<string | null>(null);
  const [draft, setDraft] = useState<GenerationRequest>(INITIAL_DRAFT);
  const [inspectedImage, setInspectedImage] = useState<GeneratedImageRecord | null>(null);
  const [startingRuntime, setStartingRuntime] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const appliedStartupPageRef = useRef(false);

  const pushToast = useCallback((message: string, tone: "info" | "error" = "info") => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [...prev.slice(-3), { id, message, tone }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  // Keep the HTML data-theme attribute synchronized; follow the OS while on "system".
  useEffect(() => {
    setResolvedTheme(applyTheme(settings.theme));
    if (settings.theme !== "system") return;
    return watchSystemTheme(() => setResolvedTheme(applyTheme("system")));
  }, [settings.theme]);

  // Initial hydration + subscriptions
  useEffect(() => {
    let active = true;

    const loadInitial = async (): Promise<void> => {
      try {
        const [
          loadedSettings,
          loadedRuntime,
          loadedHardware,
          loadedModels,
          loadedCatalog,
          loadedDownloads,
          loadedWorkflows,
          loadedSamplers,
          loadedJobs,
          loadedImages,
          loadedCollections,
          loadedPrompts,
          loadedRecipes,
          loadedCharacters,
          loadedStories,
          loadedCanvases,
          loadedUpdate,
        ] = await Promise.all([
          window.kirea.getSettings(),
          window.kirea.getRuntimeState(),
          window.kirea.getHardwareStats(),
          window.kirea.listModels(),
          window.kirea.getCuratedCatalog(),
          window.kirea.listDownloads(),
          window.kirea.listWorkflows(),
          window.kirea.getSamplersAndSchedulers(),
          window.kirea.listJobs(),
          window.kirea.listImages(),
          window.kirea.listCollections(),
          window.kirea.listPrompts(),
          window.kirea.listLoraRecipes(),
          window.kirea.listCharacters(),
          window.kirea.listStories(),
          window.kirea.listCanvases(),
          window.kirea.getUpdateState(),
        ]);

        if (!active) return;
        setSettings(loadedSettings);
        setResolvedTheme(commitPersistedTheme(loadedSettings.theme));
        setRuntime(loadedRuntime);
        setHardware(loadedHardware);
        setModels(loadedModels);
        setCatalog(loadedCatalog);
        setDownloads(loadedDownloads);
        setWorkflows(loadedWorkflows);
        setSamplersAndSchedulers(loadedSamplers);
        setJobs(loadedJobs);
        setImages(loadedImages);
        setCollections(loadedCollections);
        setPrompts(loadedPrompts);
        setRecipes(loadedRecipes);
        setCharacters(loadedCharacters);
        setStories(loadedStories);
        setCanvases(loadedCanvases);
        setUpdateState(loadedUpdate);

        void window.kirea
          .listCivitaiDownloads()
          .then((tasks) => {
            if (active) setCivitaiDownloads(tasks);
          })
          .catch(() => undefined);

        setDraft((prev) => ({
          ...prev,
          sampler: loadedSettings.defaultSampler,
          scheduler: loadedSettings.defaultScheduler,
          steps: loadedSettings.defaultSteps,
          cfg: loadedSettings.defaultCfg,
          outputFormat: loadedSettings.defaultOutputFormat,
        }));

        if (!appliedStartupPageRef.current) {
          appliedStartupPageRef.current = true;
          setActivePage(loadedSettings.startupPage);
        }

        // Trigger fresh non-blocking model scan in case files changed while app was closed
        void window.kirea.scanModels().then((fresh) => {
          if (active) setModels(fresh);
        });
      } catch (err) {
        document.documentElement.removeAttribute("data-theme-pending");
        if (active) {
          pushToast(err instanceof Error ? err.message : String(err), "error");
        }
      }
    };

    void loadInitial();

    const unsubRuntime = window.kirea.onRuntimeChanged((nextRuntime) => {
      setRuntime(nextRuntime);
      if (nextRuntime.status === "connected") {
        void window.kirea.getSamplersAndSchedulers().then(setSamplersAndSchedulers);
        void window.kirea.listModels().then(setModels);
      }
    });

    const unsubJob = window.kirea.onJobUpdated((updatedJob) => {
      setJobs((prev) => {
        const idx = prev.findIndex((j) => j.id === updatedJob.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = updatedJob;
          return next;
        }
        return [updatedJob, ...prev];
      });
      if (updatedJob.storyId) {
        void Promise.all([
          window.kirea.listStories(),
          window.kirea.listCanvases(),
        ]).then(([nextStories, nextCanvases]) => {
          setStories(nextStories);
          setCanvases(nextCanvases);
        });
      }
    });

    const unsubDownload = window.kirea.onDownloadUpdated((updatedTask) => {
      setDownloads((prev) => {
        const idx = prev.findIndex((d) => d.id === updatedTask.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = updatedTask;
          return next;
        }
        return [updatedTask, ...prev];
      });
      if (updatedTask.status === "completed") {
        void window.kirea.listModels().then(setModels);
        void window.kirea.getRuntimeState().then(setRuntime);
      }
    });

    const unsubImage = window.kirea.onImageCreated((img) => {
      setImages((prev) => [img, ...prev.filter((i) => i.id !== img.id)]);
      void window.kirea.listPrompts().then(setPrompts);
      void window.kirea.listCollections().then(setCollections);
      void window.kirea.getHardwareStats().then(setHardware);
      if (img.storyId) {
        void Promise.all([
          window.kirea.listStories(),
          window.kirea.listCanvases(),
        ]).then(([nextStories, nextCanvases]) => {
          setStories(nextStories);
          setCanvases(nextCanvases);
        });
      }
    });

    const unsubCivitai = window.kirea.onCivitaiDownloadProgress((task) => {
      setCivitaiDownloads((prev) => {
        const idx = prev.findIndex((t) => t.id === task.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = task;
          return next;
        }
        return [task, ...prev];
      });
      if (task.status === "completed") {
        void window.kirea.scanModels().then(setModels);
      }
    });

    const unsubUpdate = window.kirea.onUpdateStateChanged((nextState) => {
      setUpdateState(nextState);
    });

    // Periodic lightweight GPU VRAM refresh
    const hwInterval = setInterval(() => {
      void window.kirea.getHardwareStats().then(setHardware).catch(() => undefined);
    }, 15_000);

    return () => {
      active = false;
      clearInterval(hwInterval);
      unsubRuntime();
      unsubJob();
      unsubDownload();
      unsubCivitai();
      unsubImage();
      unsubUpdate();
    };
  }, [pushToast]);

  const handleUpdateSettings = async (partial: Partial<AppSettings>): Promise<void> => {
    const previousTheme = settings.theme;
    if (partial.theme && partial.theme !== previousTheme) {
      // Apply the theme on the same frame as the click; persistence follows.
      const nextTheme = partial.theme;
      setSettings((prev) => ({ ...prev, theme: nextTheme }));
    }
    try {
      const saved = await window.kirea.updateSettings(partial);
      setSettings(saved);
      const refreshedModels = await window.kirea.listModels();
      setModels(refreshedModels);
    } catch (err) {
      if (partial.theme && partial.theme !== previousTheme) {
        setSettings((prev) => ({ ...prev, theme: previousTheme }));
      }
      pushToast(err instanceof Error ? err.message : String(err), "error");
    }
  };

  const handleCheckForUpdates = async (): Promise<void> => {
    try {
      setUpdateState(await window.kirea.checkForUpdates());
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), "error");
    }
  };

  const handleDownloadUpdate = async (): Promise<void> => {
    try {
      setUpdateState(await window.kirea.downloadUpdate());
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), "error");
    }
  };

  const handleCancelUpdateDownload = async (): Promise<void> => {
    try {
      setUpdateState(await window.kirea.cancelUpdateDownload());
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), "error");
    }
  };

  const handleDismissUpdate = async (): Promise<void> => {
    try {
      setUpdateState(await window.kirea.dismissUpdate());
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), "error");
    }
  };

  const handleSetUpdateChannel = async (channel: UpdateChannel): Promise<void> => {
    try {
      setUpdateState(await window.kirea.setUpdateChannel(channel));
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), "error");
    }
  };

  const handleInstallUpdate = async (force = false): Promise<UpdateInstallResult> => {
    try {
      return await window.kirea.installUpdate(force);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), "error");
      return { started: false, activeJobs: 0, reason: "not-ready" };
    }
  };

  const handleStartRuntime = async (mode?: RuntimeMode): Promise<void> => {
    setStartingRuntime(true);
    try {
      const next = await window.kirea.startRuntime(mode);
      setRuntime(next);
      const scanned = await window.kirea.listModels();
      setModels(scanned);
      pushToast("Connected to local ComfyUI engine.");
    } catch (err) {
      pushToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setStartingRuntime(false);
    }
  };

  const handleStopRuntime = async (): Promise<void> => {
    const next = await window.kirea.stopRuntime();
    setRuntime(next);
    pushToast("Stopped Kirea-managed ComfyUI process.");
  };

  const handleTestConnection = async (): Promise<void> => {
    const next = await window.kirea.testRuntimeConnection();
    setRuntime(next);
    if (next.status === "connected") {
      pushToast(`Connected cleanly to ${next.apiUrl}`);
    } else {
      pushToast(next.lastError ?? "ComfyUI API is not reachable.", "error");
    }
  };

  const handleApplyPreset = (preset: StudioPreset): void => {
    const matchingCheckpoint =
      models.find(
        (m) =>
          m.installed &&
          m.category === "checkpoint" &&
          isGenerationSupportedArchitecture(getEffectiveArchitecture(m)) &&
          preset.recommendedArch.includes(getEffectiveArchitecture(m))
      ) ??
      models.find(
        (m) =>
          m.installed &&
          m.category === "checkpoint" &&
          isGenerationSupportedArchitecture(getEffectiveArchitecture(m))
      );

    const arch = matchingCheckpoint
      ? getEffectiveArchitecture(matchingCheckpoint)
      : "sdxl";
    const targetWfId =
      preset.mode === "img2img"
        ? arch === "sd15"
          ? "i2i_sd15_base"
          : "i2i_sdxl_base"
        : arch === "sd15"
          ? "t2i_sd15_base"
          : "t2i_sdxl_base";
    const targetWf = workflows.find((w) => w.id === targetWfId);
    const dims = resolveDimensionsForAspect(
      preset.aspectRatio,
      arch,
      settings.performanceProfile,
      dimensionBoundsFromWorkflow(targetWf)
    );

    setDraft((prev) => ({
      ...prev,
      mode: preset.mode,
      workflowId: targetWfId,
      checkpoint: matchingCheckpoint?.relativePath ?? prev.checkpoint,
      aspectRatio: preset.aspectRatio,
      width: dims.width,
      height: dims.height,
      prompt: preset.prompt,
      negativePrompt: preset.negativePrompt,
      steps: preset.steps,
      cfg: preset.cfg,
      sampler: preset.sampler,
      scheduler: preset.scheduler,
      denoise: preset.denoise ?? prev.denoise,
      layoutJson: null,
    }));
    setActivePage("create");
    pushToast(`Loaded '${preset.title}' into Create Studio.`);
  };

  const handleUpscaleImage = (img: GeneratedImageRecord): void => {
    const installedUpscalers = models.filter(
      (m) => m.installed && m.category === "upscale"
    );
    const preferredUpscaler =
      (img.mode === "upscale" ? img.checkpoint : "") ||
      draft.upscale?.upscaler ||
      installedUpscalers[0]?.relativePath ||
      "lanczos";

    setDraft((prev) => ({
      ...prev,
      mode: "upscale",
      workflowId: "upscale_model_v1",
      inputImagePath: img.filePath,
      width: img.width,
      height: img.height,
      upscale: {
        upscaler:
          (img.mode === "upscale" ? img.checkpoint : "") ||
          prev.upscale?.upscaler ||
          preferredUpscaler,
        scale: prev.upscale?.scale ?? 4,
      },
    }));
    setActivePage("create");
    pushToast(
      `Loaded '${img.fileName}' (${img.width}×${img.height}) into Upscale Studio.`
    );
  };

  const handleReuseImageSettings = (img: GeneratedImageRecord): void => {
    if (img.mode === "upscale") {
      handleUpscaleImage(img);
      return;
    }

    const arch = inferModelArchitecture(img.checkpoint);
    const fallbackWf =
      img.workflowId ||
      (img.mode === "img2img"
        ? arch === "sd15"
          ? "i2i_sd15_base"
          : "i2i_sdxl_base"
        : arch === "sd15"
          ? "t2i_sd15_base"
          : "t2i_sdxl_base");

    setDraft((prev) => ({
      ...prev,
      workflowId: fallbackWf,
      mode: img.mode,
      prompt: img.prompt,
      negativePrompt: img.negativePrompt,
      checkpoint: img.checkpoint,
      loras: img.loras ?? [],
      width: Math.min(2048, img.width),
      height: Math.min(2048, img.height),
      steps: img.steps,
      cfg: img.cfg,
      sampler: img.sampler,
      scheduler: img.scheduler,
      seed: img.seed,
      layoutJson: null,
      randomSeed: false,
      denoise: img.denoise,
    }));
    setActivePage("create");
    pushToast("Restored prompt, model, and seed into Create Studio.");
  };

  const handleSendImageToWorkflow = (
    img: GeneratedImageRecord,
    targetWorkflow: "edit" | "inpaint" | "outpaint" | "variations" | "upscale"
  ): void => {
    if (targetWorkflow === "upscale") {
      handleUpscaleImage(img);
      return;
    }
    const arch = inferModelArchitecture(img.checkpoint);
    const fallbackWf =
      img.workflowId ||
      (arch === "sd15" ? "i2i_sd15_base" : "i2i_sdxl_base");

    setDraft((prev) => ({
      ...prev,
      mode: "img2img",
      workflowId: fallbackWf,
      prompt: img.prompt,
      negativePrompt: img.negativePrompt,
      checkpoint: img.checkpoint,
      loras: img.loras ?? [],
      inputImagePath: img.filePath,
      width: Math.min(2048, img.width),
      height: Math.min(2048, img.height),
      steps: img.steps,
      cfg: img.cfg,
      sampler: img.sampler,
      scheduler: img.scheduler,
      seed:
        targetWorkflow === "variations"
          ? Math.floor(Math.random() * 2147483647)
          : img.seed,
      randomSeed: targetWorkflow === "variations",
      denoise:
        targetWorkflow === "inpaint"
          ? 0.75
          : targetWorkflow === "outpaint"
          ? 0.85
          : 0.55,
    }));
    setActivePage("create");
    pushToast(
      `Loaded '${img.fileName}' into ${targetWorkflow.toUpperCase()} workspace.`
    );
  };


  const handleToggleFavorite = async (id: string): Promise<void> => {
    const updated = await window.kirea.toggleImageFavorite(id);
    if (updated) {
      setImages((prev) => prev.map((img) => (img.id === id ? updated : img)));
      setInspectedImage((prev) => (prev && prev.id === id ? updated : prev));
    }
  };

  const handleUpdateImageMeta = async (
    id: string,
    updates: { tags?: string[]; collectionId?: string | null }
  ): Promise<void> => {
    await window.kirea.updateImageMeta(id, updates);
    const fresh = await window.kirea.listImages();
    setImages(fresh);
    setCollections(await window.kirea.listCollections());
    setInspectedImage((prev) =>
      prev && prev.id === id ? fresh.find((f) => f.id === id) ?? null : prev
    );
  };

  const handleDeleteImage = async (id: string): Promise<void> => {
    await window.kirea.deleteImage(id);
    setImages((prev) => prev.filter((img) => img.id !== id));
    setCollections(await window.kirea.listCollections());
    pushToast("Deleted image from library.");
  };

  /** Clears library entries whose files were moved or deleted outside Kirea. */
  const handleRemoveMissingImages = async (ids: string[]): Promise<void> => {
    if (ids.length === 0) return;
    const removed = new Set<string>();
    for (const id of ids) {
      try {
        await window.kirea.deleteImage(id);
        removed.add(id);
      } catch {
        // Leave the entry in place; the toast below reports the shortfall.
      }
    }
    setImages((prev) => prev.filter((img) => !removed.has(img.id)));
    setInspectedImage((prev) => (prev && removed.has(prev.id) ? null : prev));
    setCollections(await window.kirea.listCollections());
    if (removed.size === ids.length) {
      pushToast(
        `Removed ${removed.size} missing ${removed.size === 1 ? "entry" : "entries"} from the library.`
      );
    } else {
      pushToast(
        `Removed ${removed.size} of ${ids.length} missing entries. Try again for the rest.`,
        "error"
      );
    }
  };

  const handleSaveRecipe = async (input: LoraRecipeInput): Promise<LoraRecipe> => {
    const saved = await window.kirea.saveLoraRecipe(input);
    setRecipes((prev) => [saved, ...prev.filter((r) => r.id !== saved.id)]);
    return saved;
  };

  const handleDeleteRecipe = async (id: string): Promise<void> => {
    await window.kirea.deleteLoraRecipe(id);
    setRecipes((prev) => prev.filter((r) => r.id !== id));
    setActiveRecipeId((prev) => (prev === id ? null : prev));
    // characters.lora_recipe_id is ON DELETE SET NULL, so refresh link state
    setCharacters(await window.kirea.listCharacters());
  };

  const handleLoadRecipe = (recipe: LoraRecipe): void => {
    const checkpoint = recipe.checkpointPath
      ? models.find((m) => m.installed && m.relativePath === recipe.checkpointPath)
      : null;
    const settings = recipe.settings ?? {};

    setDraft((prev) => ({
      ...prev,
      mode: recipe.mode === "img2img" ? "img2img" : "txt2img",
      workflowId: recipe.workflowId ?? prev.workflowId,
      checkpoint: checkpoint?.relativePath ?? prev.checkpoint,
      prompt: recipe.basePrompt,
      negativePrompt: recipe.negativePrompt,
      aspectRatio: settings.aspectRatio ?? prev.aspectRatio,
      width: settings.width ?? prev.width,
      height: settings.height ?? prev.height,
      steps: settings.steps ?? prev.steps,
      cfg: settings.cfg ?? prev.cfg,
      sampler: settings.sampler ?? prev.sampler,
      scheduler: settings.scheduler ?? prev.scheduler,
      seed: settings.seed ?? prev.seed,
      randomSeed: settings.seed == null,
      denoise: settings.denoise ?? prev.denoise,
      batchCount: settings.batchCount ?? prev.batchCount,
      outputFormat: settings.outputFormat ?? prev.outputFormat,
      hiresFix: settings.hiresFix ?? prev.hiresFix,
      loras: recipe.items
        .filter((item) => item.enabled)
        .slice(0, 4)
        .map((item) => ({
          name: item.loraPath,
          strengthModel: item.strengthModel,
          strengthClip: item.strengthClip,
        })),
    }));
    setActiveRecipeId(recipe.id);
    setActivePage("create");
    pushToast(`Loaded LoRA recipe '${recipe.name}' into Create Studio.`);
    if (recipe.checkpointPath && !checkpoint) {
      pushToast("Recipe checkpoint is not installed; kept the current checkpoint.");
    }
  };

  const handleSaveCharacter = async (
    input: CharacterProfileInput
  ): Promise<CharacterProfile> => {
    const saved = await window.kirea.saveCharacter(input);
    setCharacters((prev) => [saved, ...prev.filter((c) => c.id !== saved.id)]);
    return saved;
  };

  const handleDeleteCharacter = async (id: string): Promise<boolean> => {
    const deleted = await window.kirea.deleteCharacter(id);
    if (deleted) {
      setCharacters((prev) => prev.filter((c) => c.id !== id));
      setActiveCharacterId((prev) => (prev === id ? null : prev));
      setDraft((prev) =>
        prev.characterId === id ? { ...prev, characterId: null } : prev
      );
    }
    return deleted;
  };

  const applyCharacterUpdate = (updated: CharacterProfile | null): void => {
    if (!updated) return;
    setCharacters((prev) =>
      prev.map((c) => (c.id === updated.id ? updated : c))
    );
  };

  const handleUseCharacter = (character: CharacterProfile): void => {
    setActiveCharacterId(character.id);
    setActivePage("create");
    pushToast(
      `Character '${character.name}' is active in Create Studio.`
    );
  };

  const handleAddImageToCharacter = async (
    image: GeneratedImageRecord,
    characterId: string,
    role: CharacterReferenceRole
  ): Promise<void> => {
    const updated = await window.kirea.addCharacterReferenceFromImage(
      characterId,
      image.id,
      role
    );
    if (updated) {
      applyCharacterUpdate(updated);
      pushToast(
        `Added '${image.fileName}' to ${updated.name} as a ${role} reference.`
      );
    }
  };

  const applyStoryUpdate = (updated: Story | null): Story | null => {
    if (updated) {
      setStories((prev) => [updated, ...prev.filter((s) => s.id !== updated.id)]);
    }
    return updated;
  };

  const handleSaveStory = async (input: StoryInput): Promise<Story> => {
    const saved = await window.kirea.saveStory(input);
    applyStoryUpdate(saved);
    return saved;
  };

  const handleDeleteStory = async (id: string): Promise<boolean> => {
    const deleted = await window.kirea.deleteStory(id);
    if (deleted) {
      setStories((prev) => prev.filter((s) => s.id !== id));
      setCanvases((prev) => prev.filter((canvas) => canvas.storyId !== id));
    }
    return deleted;
  };

  const handleSaveStoryScene = async (input: StorySceneInput): Promise<Story> => {
    const updated = await window.kirea.saveStoryScene(input);
    applyStoryUpdate(updated);
    return updated;
  };

  const handleDeleteStoryScene = async (
    storyId: string,
    sceneId: string
  ): Promise<Story | null> => {
    const updated = await window.kirea.deleteStoryScene(storyId, sceneId);
    applyStoryUpdate(updated);
    return updated;
  };

  const handleReorderStoryScenes = async (
    storyId: string,
    sceneIds: string[]
  ): Promise<Story | null> => {
    const updated = await window.kirea.reorderStoryScenes(storyId, sceneIds);
    applyStoryUpdate(updated);
    return updated;
  };

  const handleSelectStorySceneImage = async (
    storyId: string,
    sceneId: string,
    imageId: string | null
  ): Promise<Story | null> => {
    const updated = await window.kirea.selectStorySceneImage(
      storyId,
      sceneId,
      imageId
    );
    applyStoryUpdate(updated);
    return updated;
  };

  const handleGenerateStoryScene = async (
    storyId: string,
    sceneId: string
  ): Promise<GenerationJob[]> => {
    const created = await window.kirea.generateStoryScene(storyId, sceneId);
    setStories(await window.kirea.listStories());
    return created;
  };

  const handleGenerateStory = async (storyId: string): Promise<GenerationJob[]> => {
    const created = await window.kirea.generateStory(storyId);
    setStories(await window.kirea.listStories());
    return created;
  };

  const applyCanvasUpdate = (updated: StoryCanvas | null): StoryCanvas | null => {
    if (updated) {
      setCanvases((prev) => [
        updated,
        ...prev.filter((canvas) => canvas.id !== updated.id),
      ]);
    }
    return updated;
  };

  const handleSaveCanvas = async (
    input: StoryCanvasInput
  ): Promise<StoryCanvas> => {
    const saved = await window.kirea.saveCanvas(input);
    applyCanvasUpdate(saved);
    return saved;
  };

  const handleDeleteCanvas = async (id: string): Promise<boolean> => {
    const deleted = await window.kirea.deleteCanvas(id);
    if (deleted) {
      setCanvases((prev) => prev.filter((canvas) => canvas.id !== id));
    }
    return deleted;
  };

  const handleSaveCanvasItem = async (
    input: StoryCanvasItemInput
  ): Promise<StoryCanvas> => {
    const saved = await window.kirea.saveCanvasItem(input);
    applyCanvasUpdate(saved);
    return saved;
  };

  const handleDeleteCanvasItem = async (
    canvasId: string,
    itemId: string
  ): Promise<StoryCanvas | null> => {
    const updated = await window.kirea.deleteCanvasItem(canvasId, itemId);
    return applyCanvasUpdate(updated);
  };

  const handleReorderCanvasItems = async (
    canvasId: string,
    itemIds: string[]
  ): Promise<StoryCanvas | null> => {
    const updated = await window.kirea.reorderCanvasItems(canvasId, itemIds);
    return applyCanvasUpdate(updated);
  };

  const handleSyncCanvas = async (
    canvasId: string
  ): Promise<StoryCanvas | null> => {
    const updated = await window.kirea.syncCanvas(canvasId);
    return applyCanvasUpdate(updated);
  };

  const handleExportCanvasPng = async (
    canvasId: string
  ): Promise<StoryExportResult | null> =>
    window.kirea.exportCanvasPng(canvasId);

  const handleExportCanvasPdf = async (
    canvasId: string
  ): Promise<StoryExportResult | null> =>
    window.kirea.exportCanvasPdf(canvasId);

  const handleOpenCanvasExportFolder = async (
    storyId: string
  ): Promise<void> => {
    await window.kirea.openCanvasExportFolder(storyId);
  };

  const activeWorkCount =
    jobs.filter(
      (j) =>
        j.status === "IDLE" ||
        j.status === "VALIDATING" ||
        j.status === "SUBMITTING" ||
        j.status === "QUEUED" ||
        j.status === "RUNNING" ||
        j.status === "PROCESSING_OUTPUT"
    ).length +
    downloads.filter(
      (d) =>
        d.status === "downloading" ||
        d.status === "verifying" ||
        d.status === "extracting"
    ).length;

  return {
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
    toasts,
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
  };
}
