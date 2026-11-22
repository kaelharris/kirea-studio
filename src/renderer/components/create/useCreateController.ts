import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ASPECT_RATIOS,
  CUSTOM_ASPECT_ID,
  calculateHiresDimensions,
  dimensionBoundsFromWorkflow,
  IMAGE_UPSCALER_LANCZOS,
  inferModelArchitecture,
  LATENT_UPSCALER_BICUBIC,
  LATENT_UPSCALER_BISLERP,
  resolveCustomDimensions,
  resolveDimensionsForAspect,
  snapDimension,
} from "../../../shared/aspect-ratios";
import {
  characterTextWorkflowId,
  composeCharacterPrompt,
  getPrimaryCharacterReference,
  removeCharacterIdentityTokens,
  resolveCharacterReferencePlan,
} from "../../../shared/character-utils";
import {
  ARCHITECTURE_LABELS,
  evaluateLoraCompatibility,
  findPresetUpscaler,
  getEffectiveArchitecture,
  getEffectiveModelInfo,
  getModelDisplayName,
  isGenerationSupportedArchitecture,
  resolveAutoVaeName,
  UPSCALE_PRESETS,
  VAE_AUTO,
} from "../../../shared/model-utils";
import {
  isMossWorkflow,
  isMossWorkflowReady,
} from "../../../shared/moss-image";
import type {
  CharacterProfile,
  GenerationMode,
  GenerationRequest,
  HiresFixConfig,
  LoraRecipeInput,
  ModelRecord,
  PerformanceProfile,
  UpscaleConfig,
  ValidationIssue,
} from "../../../shared/types";
import { shortModelLabel } from "../../utils/format";
import type { StudioWorkflowMode } from "./WorkflowSelector";
import {
  type CreatePageProps,
  DEFAULT_HIRES_CONFIG,
  DEFAULT_UPSCALE_CONFIG,
} from "./create-helpers";

export function useCreateController(props: CreatePageProps) {
  const {
    draft,
    setDraft,
    settings,
    runtime,
    models,
    workflows,
    samplersAndSchedulers,
    jobs,
    images,
    recipes,
    characters,
    activeCharacterId,
    onSelectCharacter,
    onOpenCharacters,
    activeRecipeId,
    onSelectRecipe,
    onSaveRecipe,
    onChangeProfile,
    onInspectImage,
    onToggleFavorite,
    onSavePrompt,
    onToast,
  } = props;
  const [validationIssues, setValidationIssues] = useState<ValidationIssue[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [sourceImageDims, setSourceImageDims] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [loraPickerOpen, setLoraPickerOpen] = useState(false);
  const [loraSearch, setLoraSearch] = useState("");
  const [showIncompatibleLoras, setShowIncompatibleLoras] = useState(false);
  const [recipeModalOpen, setRecipeModalOpen] = useState(false);
  const [recipeName, setRecipeName] = useState("");
  const [recipeDescription, setRecipeDescription] = useState("");
  const [savingRecipe, setSavingRecipe] = useState(false);
  const [uiMode, setUiMode] = useState<"creative" | "advanced">("creative");
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [inspectorTab, setInspectorTab] = useState<"result" | "history">("result");
  const [workflowMode, setWorkflowMode] = useState<StudioWorkflowMode>(() => {
    if (draft.mode === "upscale") return "upscale";
    if (draft.mode === "img2img") return "edit";
    return "generate";
  });

  // Keep workflowMode in sync when draft.mode is altered externally
  useEffect(() => {
    if (draft.mode === "upscale" && workflowMode !== "upscale") {
      setWorkflowMode("upscale");
    } else if (draft.mode === "txt2img" && workflowMode !== "generate") {
      setWorkflowMode("generate");
    } else if (
      draft.mode === "img2img" &&
      workflowMode !== "edit" &&
      workflowMode !== "inpaint" &&
      workflowMode !== "outpaint" &&
      workflowMode !== "variations"
    ) {
      setWorkflowMode("edit");
    }
  }, [draft.mode]);

  const [currentMaskDataUrl, setCurrentMaskDataUrl] = useState<string | null>(null);
  const [outpaintPadding, setOutpaintPadding] = useState<{
    top: number;
    bottom: number;
    left: number;
    right: number;
  }>({ top: 0, bottom: 0, left: 0, right: 0 });

  const handleMaskChange = useCallback(
    (maskDataUrl: string | null) => {
      setCurrentMaskDataUrl(maskDataUrl);
      setDraft((prev) => ({ ...prev, maskDataUrl }));
    },
    [setDraft]
  );

  const handleOutpaintParamsChange = useCallback(
    (padding: { top: number; bottom: number; left: number; right: number }) => {
      setOutpaintPadding(padding);
      setDraft((prev) => ({ ...prev, outpaintPadding: padding }));
    },
    [setDraft]
  );

  const primaryModels = useMemo(
    () =>
      models.filter(
        (m) =>
          m.installed &&
          (m.category === "checkpoint" ||
            (m.category === "diffusion_model" &&
              ["z_image", "anima", "moss_image"].includes(
                getEffectiveArchitecture(m)
              ))) &&
          isGenerationSupportedArchitecture(getEffectiveArchitecture(m))
      ),
    [models]
  );

  const currentCheckpointModel = useMemo(
    () =>
      primaryModels.find(
        (m) => m.relativePath === draft.checkpoint || m.name === draft.checkpoint
      ) ?? null,
    [primaryModels, draft.checkpoint]
  );

  const currentArch = useMemo(() => {
    if (currentCheckpointModel) {
      return getEffectiveArchitecture(currentCheckpointModel);
    }
    return inferModelArchitecture(draft.checkpoint);
  }, [currentCheckpointModel, draft.checkpoint]);

  const checkpointGroups = useMemo(() => {
    const groups = new Map<string, ModelRecord[]>();
    for (const model of primaryModels) {
      const label = ARCHITECTURE_LABELS[getEffectiveArchitecture(model)];
      const bucket = groups.get(label) ?? [];
      bucket.push(model);
      groups.set(label, bucket);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [primaryModels]);

  const loraModels = useMemo(
    () => models.filter((m) => m.installed && m.category === "lora"),
    [models]
  );

  const filteredLoraModels = useMemo(() => {
    const q = loraSearch.trim().toLowerCase();
    return loraModels.filter((m) => {
      const info = getEffectiveModelInfo(m);
      const compatible =
        showIncompatibleLoras ||
        evaluateLoraCompatibility(info.architecture, currentArch).compatible;
      if (!compatible) return false;
      if (!q) return true;
      return (
        info.name.toLowerCase().includes(q) ||
        m.relativePath.toLowerCase().includes(q) ||
        info.architecture.toLowerCase().includes(q) ||
        info.triggerWords.some((word) => word.toLowerCase().includes(q))
      );
    });
  }, [loraModels, loraSearch, currentArch, showIncompatibleLoras]);

  const activeRecipe = useMemo(
    () => recipes.find((r) => r.id === activeRecipeId) ?? null,
    [recipes, activeRecipeId]
  );

  const vaeModels = useMemo(
    () => models.filter((m) => m.installed && m.category === "vae"),
    [models]
  );

  const autoVaeName = useMemo(
    () => resolveAutoVaeName(currentArch, vaeModels),
    [currentArch, vaeModels]
  );

  const upscaleModels = useMemo(
    () => models.filter((m) => m.installed && m.category === "upscale"),
    [models]
  );

  const hiresConfig: HiresFixConfig = draft.hiresFix ?? DEFAULT_HIRES_CONFIG;
  const upscaleConfig: UpscaleConfig = draft.upscale ?? DEFAULT_UPSCALE_CONFIG;

  const compatibleWorkflows = useMemo(
    () =>
      workflows.filter(
        (w) =>
          w.mode === draft.mode &&
          (currentArch === "unknown" ||
            w.supportedArchitectures.includes(currentArch) ||
            w.supportedArchitectures.includes("unknown"))
      ),
    [workflows, draft.mode, currentArch]
  );

  const activeWorkflow = useMemo(() => {
    const candidate =
      compatibleWorkflows.find((w) => w.id === draft.workflowId) ??
      compatibleWorkflows[0] ??
      workflows.find((w) => w.id === draft.workflowId);
    if (!candidate) return candidate;
    if (
      currentArch === "illustrious" &&
      (candidate.id === "t2i_sdxl_base" || candidate.id === "i2i_sdxl_base")
    ) {
      return { ...candidate, maxLoras: 10 };
    }
    return candidate;
  }, [workflows, compatibleWorkflows, draft.workflowId, currentArch]);

  useEffect(() => {
    if (
      compatibleWorkflows.length > 0 &&
      !compatibleWorkflows.some((w) => w.id === draft.workflowId)
    ) {
      setDraft((prev) => ({ ...prev, workflowId: compatibleWorkflows[0]!.id }));
    }
  }, [compatibleWorkflows, draft.workflowId, setDraft]);

  const dimensionBounds = useMemo(
    () => dimensionBoundsFromWorkflow(activeWorkflow),
    [activeWorkflow]
  );

  const dimensionInfo = useMemo(
    () => resolveCustomDimensions(draft.width, draft.height, dimensionBounds),
    [draft.width, draft.height, dimensionBounds]
  );

  const activeJob = useMemo(
    () =>
      jobs.find(
        (j) =>
          j.status === "RUNNING" ||
          j.status === "QUEUED" ||
          j.status === "SUBMITTING" ||
          j.status === "VALIDATING" ||
          j.status === "PROCESSING_OUTPUT"
      ) ?? null,
    [jobs]
  );

  const latestImage = images[0] ?? null;

  // Auto-select initial checkpoint if empty
  useEffect(() => {
    if (!draft.checkpoint && primaryModels.length > 0) {
      const preferred =
        primaryModels.find((m) => getEffectiveArchitecture(m) === "sdxl") ??
        primaryModels.find((m) => getEffectiveArchitecture(m) === "sd15") ??
        primaryModels[0];
      if (preferred) {
        handleCheckpointChange(preferred.relativePath);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primaryModels.length]);

  // Auto-select initial upscale model when upscalers are scanned
  useEffect(() => {
    if (!draft.upscale?.upscaler && upscaleModels.length > 0) {
      setDraft((prev) => ({
        ...prev,
        upscale: {
          upscaler: upscaleModels[0]!.relativePath,
          scale: prev.upscale?.scale ?? 4,
        },
      }));
    }
  }, [upscaleModels, draft.upscale?.upscaler, setDraft]);

  useEffect(() => {
    if (!draft.inputImagePath) {
      setSourceImageDims(null);
    }
  }, [draft.inputImagePath]);

  const [promptTouched, setPromptTouched] = useState(false);
  useEffect(() => {
    if (!promptTouched && draft.prompt.trim().length > 0) setPromptTouched(true);
  }, [draft.prompt, promptTouched]);
  const revealPromptErrors = useCallback(() => setPromptTouched(true), []);

  // Run backend Zod & compatibility validation whenever key settings change
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void window.kirea
        .validateJob(draft)
        .then((issues) => {
          if (!cancelled) setValidationIssues(issues);
        })
        .catch(() => undefined);
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [draft]);

  const currentCheckpointInfo = currentCheckpointModel
    ? getEffectiveModelInfo(currentCheckpointModel)
    : null;

  const loraWarnings = useMemo(
    () =>
      draft.loras.filter((sel) => {
        const model = loraModels.find((m) => m.relativePath === sel.name);
        if (!model) return true;
        return !evaluateLoraCompatibility(
          getEffectiveArchitecture(model),
          currentArch
        ).compatible;
      }),
    [draft.loras, loraModels, currentArch]
  );

  const activeCharacter = useMemo(
    () => characters.find((c) => c.id === activeCharacterId) ?? null,
    [characters, activeCharacterId]
  );

  const activeCharacterPlan = useMemo(
    () => (activeCharacter ? resolveCharacterReferencePlan(activeCharacter, currentArch) : null),
    [activeCharacter, currentArch]
  );

  const appliedCharacterRef = useRef<string | null>(null);
  const lastAppliedCharacterRef = useRef<CharacterProfile | null>(null);

  const applyCharacterToDraft = (
    prev: GenerationRequest,
    next: CharacterProfile | null,
    previous: CharacterProfile | null
  ): GenerationRequest => {
    if (!next) {
      if (!previous) return prev;
      const prompt = removeCharacterIdentityTokens(prev.prompt, previous);
      const prevPrimary = getPrimaryCharacterReference(previous);
      const isAutoInput =
        prev.mode === "img2img" &&
        Boolean(prev.inputImagePath) &&
        prev.inputImagePath === prevPrimary?.filePath;
      if (!isAutoInput) {
        return { ...prev, prompt, characterId: null };
      }
      return {
        ...prev,
        prompt,
        characterId: null,
        mode: "txt2img",
        inputImagePath: null,
        workflowId: characterTextWorkflowId(currentArch),
        denoise: 1.0,
      };
    }

    const checkpointRel =
      next.checkpointPath &&
      primaryModels.some((m) => m.relativePath === next.checkpointPath)
        ? next.checkpointPath
        : prev.checkpoint;
    const checkpointModel = primaryModels.find(
      (m) => m.relativePath === checkpointRel
    );
    const arch = checkpointModel
      ? getEffectiveArchitecture(checkpointModel)
      : inferModelArchitecture(checkpointRel);
    const supported = isGenerationSupportedArchitecture(arch);

    let prompt = prev.prompt;
    if (previous && previous.id !== next.id) {
      prompt = removeCharacterIdentityTokens(prompt, previous);
    }
    prompt = composeCharacterPrompt(next, prompt);

    let negativePrompt = prev.negativePrompt.trim();
    const characterNegative = next.negativePrompt.trim();
    if (
      characterNegative &&
      !negativePrompt.toLowerCase().includes(characterNegative.toLowerCase())
    ) {
      negativePrompt = negativePrompt
        ? `${negativePrompt}, ${characterNegative}`
        : characterNegative;
    }

    const plan = resolveCharacterReferencePlan(next, arch);

    let mode: GenerationMode = prev.mode;
    let workflowId = prev.workflowId;
    let inputImagePath = prev.inputImagePath;
    let denoise = prev.denoise;

    if (supported) {
      if (plan.active && plan.reference && plan.workflowId) {
        mode = "img2img";
        workflowId = plan.workflowId;
        inputImagePath = plan.reference.filePath;
        denoise = plan.denoise;
      } else {
        mode = "txt2img";
        workflowId = characterTextWorkflowId(arch);
        const previousPrimary = previous
          ? getPrimaryCharacterReference(previous)
          : null;
        if (
          prev.mode === "img2img" &&
          inputImagePath &&
          inputImagePath === previousPrimary?.filePath
        ) {
          inputImagePath = null;
        }
        denoise = 1.0;
      }
    }

    const recipe = next.loraRecipeId
      ? recipes.find((r) => r.id === next.loraRecipeId) ?? null
      : null;
    const loras = recipe
      ? recipe.items
          .filter((item) => item.enabled)
          .slice(0, 4)
          .map((item) => ({
            name: item.loraPath,
            strengthModel: item.strengthModel,
            strengthClip: item.strengthClip,
          }))
      : prev.loras;

    const wf = workflows.find((w) => w.id === workflowId);
    const dims = resolveDimensionsForAspect(
      prev.aspectRatio,
      arch,
      settings.performanceProfile,
      dimensionBoundsFromWorkflow(wf)
    );
    const zImageOverrides =
      supported && arch === "z_image" && mode === "txt2img" && wf
        ? {
            steps: wf.defaults.steps,
            cfg: wf.defaults.cfg,
            sampler: wf.defaults.sampler,
            scheduler: wf.defaults.scheduler,
          }
        : {};

    return {
      ...prev,
      ...zImageOverrides,
      characterId: next.id,
      prompt,
      negativePrompt,
      checkpoint: checkpointRel,
      mode,
      workflowId,
      inputImagePath,
      denoise,
      loras,
      width: dims.width,
      height: dims.height,
    };
  };

  // Apply or clear character identity whenever the active selection changes.
  useEffect(() => {
    if (activeCharacterId === appliedCharacterRef.current) return;
    appliedCharacterRef.current = activeCharacterId;
    const next = characters.find((c) => c.id === activeCharacterId) ?? null;
    const previous = lastAppliedCharacterRef.current;
    lastAppliedCharacterRef.current = next;
    setDraft((prev) => applyCharacterToDraft(prev, next, previous));
    if (next) {
      onSelectRecipe(next.loraRecipeId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCharacterId, characters]);

  const appendToPrompt = (text: string): void => {
    setDraft((p) => ({
      ...p,
      prompt: p.prompt.trim() ? `${p.prompt.trim()}, ${text}` : text,
    }));
  };

  const handleModeSwitch = (mode: GenerationMode): void => {
    const targetWf =
      workflows.find(
        (w) =>
          w.mode === mode &&
          (currentArch === "unknown" || w.supportedArchitectures.includes(currentArch))
      ) ?? workflows.find((w) => w.mode === mode);

    setDraft((prev) => {
      if (mode === "upscale") {
        const preferredUpscaler =
          prev.upscale?.upscaler ||
          upscaleModels[0]?.relativePath ||
          IMAGE_UPSCALER_LANCZOS;
        const workflowId =
          prev.upscale?.pipeline === "refiner"
            ? "upscale_refiner_v1"
            : targetWf?.id ?? "upscale_model_v1";
        return {
          ...prev,
          mode,
          workflowId,
          upscale: {
            ...prev.upscale,
            upscaler: preferredUpscaler,
            scale: prev.upscale?.scale ?? 4,
          },
        };
      }

      const nextDims =
        prev.mode === "upscale"
          ? resolveDimensionsForAspect(
              prev.aspectRatio,
              currentArch,
              settings.performanceProfile,
              dimensionBoundsFromWorkflow(targetWf)
            )
          : { width: prev.width, height: prev.height };

      return {
        ...prev,
        mode,
        workflowId: targetWf?.id ?? prev.workflowId,
        width: nextDims.width,
        height: nextDims.height,
        denoise: mode === "img2img" ? Math.min(0.75, prev.denoise || 0.55) : 1.0,
      };
    });
  };

  const handleSelectWorkflowMode = useCallback(
    (mode: StudioWorkflowMode, sourceImage?: { filePath: string } | null): void => {
      setWorkflowMode(mode);
      const chosenImagePath =
        sourceImage?.filePath || draft.inputImagePath || (images[0]?.filePath ?? null);

      if (mode === "generate") {
        handleModeSwitch("txt2img");
        setDraft((p) => ({
          ...p,
          inputImagePath: null,
        }));
      } else if (mode === "edit") {
        handleModeSwitch("img2img");
        if (chosenImagePath && !draft.inputImagePath) {
          setDraft((p) => ({
            ...p,
            inputImagePath: chosenImagePath,
            denoise: Math.min(0.75, p.denoise || 0.55),
          }));
        }
      } else if (mode === "variations") {
        handleModeSwitch("img2img");
        setDraft((p) => ({
          ...p,
          inputImagePath: chosenImagePath || p.inputImagePath,
          randomSeed: true,
          denoise: 0.55,
        }));
      } else if (mode === "inpaint") {
        handleModeSwitch("img2img");
        setDraft((p) => ({
          ...p,
          inputImagePath: chosenImagePath || p.inputImagePath,
          denoise: 0.75,
        }));
      } else if (mode === "outpaint") {
        handleModeSwitch("img2img");
        setDraft((p) => ({
          ...p,
          inputImagePath: chosenImagePath || p.inputImagePath,
          denoise: 0.85,
        }));
      } else if (mode === "upscale") {
        handleModeSwitch("upscale");
        if (chosenImagePath && !draft.inputImagePath) {
          setDraft((p) => ({
            ...p,
            inputImagePath: chosenImagePath,
          }));
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draft.inputImagePath, images]
  );

  const handleWorkflowChange = (wfId: string): void => {
    const wf = workflows.find((w) => w.id === wfId);
    if (!wf) return;
    const width = snapDimension(wf.defaults.width, wf.dimStep, wf.minDim, wf.maxDim);
    const height = snapDimension(wf.defaults.height, wf.dimStep, wf.minDim, wf.maxDim);
    const ratio = width / height;
    const matchingPreset = ASPECT_RATIOS.find(
      (preset) => Math.abs(preset.ratioW / preset.ratioH - ratio) / ratio < 0.02
    );
    setDraft((prev) => ({
      ...prev,
      workflowId: wf.id,
      mode: wf.mode,
      aspectRatio: matchingPreset?.id ?? CUSTOM_ASPECT_ID,
      steps: wf.defaults.steps,
      cfg: wf.defaults.cfg,
      sampler: wf.defaults.sampler,
      scheduler: wf.defaults.scheduler,
      denoise: wf.defaults.denoise,
      width,
      height,
    }));
  };

  const handleCheckpointChange = (relPath: string): void => {
    const matched = primaryModels.find((m) => m.relativePath === relPath);
    const arch = matched
      ? getEffectiveArchitecture(matched)
      : inferModelArchitecture(relPath);

    // Choose appropriate default workflow for model architecture
    let nextWfId = draft.workflowId;
    let extraOverrides: Partial<GenerationRequest> = {};

    if (arch === "moss_image") {
      const isBase = relPath.toLowerCase().includes("moss_image_base_");
      const preferred =
        draft.mode === "img2img"
          ? "i2i_moss_image_edit"
          : isBase
            ? "t2i_moss_image_base"
            : "t2i_moss_image";
      const mossWf = workflows.find((w) => w.id === preferred);
      if (mossWf) {
        nextWfId = mossWf.id;
        extraOverrides = {
          steps: mossWf.defaults.steps,
          cfg: mossWf.defaults.cfg,
          sampler: mossWf.defaults.sampler,
          scheduler: mossWf.defaults.scheduler,
          denoise: mossWf.defaults.denoise,
        };
      }
    } else if (arch === "anima") {
      const animaWf = workflows.find(
        (w) => w.id === (draft.mode === "img2img" ? "i2i_anima_base" : "t2i_anima_base")
      );
      if (animaWf) {
        nextWfId = animaWf.id;
        extraOverrides = {
          steps: animaWf.defaults.steps,
          cfg: animaWf.defaults.cfg,
          sampler: animaWf.defaults.sampler,
          scheduler: animaWf.defaults.scheduler,
        };
      }
    } else if (arch === "z_image" && draft.mode === "txt2img") {
      const zWf = workflows.find((w) => w.id === "t2i_z_image_turbo");
      if (zWf) {
        nextWfId = zWf.id;
        extraOverrides = {
          steps: zWf.defaults.steps,
          cfg: zWf.defaults.cfg,
          sampler: zWf.defaults.sampler,
          scheduler: zWf.defaults.scheduler,
        };
      }
    } else if (arch === "illustrious") {
      const illWf = workflows.find(
        (w) => w.id === (draft.mode === "img2img" ? "i2i_illustrious_base" : "t2i_illustrious_base")
      );
      if (illWf) {
        nextWfId = illWf.id;
        extraOverrides = {
          steps: illWf.defaults.steps,
          cfg: illWf.defaults.cfg,
          sampler: illWf.defaults.sampler,
          scheduler: illWf.defaults.scheduler,
        };
      }
    } else if (arch === "sd15") {
      const sd15Wf = workflows.find(
        (w) => w.id === (draft.mode === "img2img" ? "i2i_sd15_base" : "t2i_sd15_base")
      );
      if (sd15Wf) nextWfId = sd15Wf.id;
    } else {
      const sdxlWf = workflows.find(
        (w) => w.id === (draft.mode === "img2img" ? "i2i_sdxl_base" : "t2i_sdxl_base")
      );
      if (sdxlWf) nextWfId = sdxlWf.id;
    }

    const incompatible = draft.loras.filter((sel) => {
      const model = loraModels.find((m) => m.relativePath === sel.name);
      if (!model) return false;
      return !evaluateLoraCompatibility(
        getEffectiveArchitecture(model),
        arch
      ).compatible;
    });

    const nextWf = workflows.find((w) => w.id === nextWfId);
    const maxAllowed =
      arch === "illustrious" ||
      nextWf?.id === "t2i_illustrious_base" ||
      nextWf?.id === "i2i_illustrious_base"
        ? 10
        : (nextWf?.maxLoras ?? 4);

    const dims = resolveDimensionsForAspect(
      draft.aspectRatio,
      arch,
      settings.performanceProfile,
      dimensionBoundsFromWorkflow(nextWf)
    );

    let trimmedDueToCapacity = 0;
    setDraft((prev) => {
      const compatibleLoras = prev.loras.filter(
        (sel) => !incompatible.some((dropped) => dropped.name === sel.name)
      );
      const finalLoras = compatibleLoras.slice(0, maxAllowed);
      trimmedDueToCapacity = compatibleLoras.length - finalLoras.length;
      return {
        ...prev,
        checkpoint: relPath,
        workflowId: nextWfId,
        width: dims.width,
        height: dims.height,
        ...extraOverrides,
        loras: finalLoras,
      };
    });

    if (incompatible.length > 0) {
      onToast(
        `${incompatible.length} incompatible LoRA${
          incompatible.length === 1 ? "" : "s"
        } removed for ${ARCHITECTURE_LABELS[arch]}.`
      );
    }
    if (trimmedDueToCapacity > 0) {
      onToast(
        `${trimmedDueToCapacity} excess LoRA${
          trimmedDueToCapacity === 1 ? "" : "s"
        } trimmed to fit workflow capacity (${maxAllowed}).`
      );
    }
  };

  const handleAspectChange = (ratioId: string): void => {
    if (ratioId === CUSTOM_ASPECT_ID) {
      setDraft((prev) => ({ ...prev, aspectRatio: CUSTOM_ASPECT_ID }));
      return;
    }
    const dims = resolveDimensionsForAspect(
      ratioId,
      currentArch,
      settings.performanceProfile,
      dimensionBounds
    );
    setDraft((prev) => ({
      ...prev,
      aspectRatio: ratioId,
      width: dims.width,
      height: dims.height,
    }));
  };

  const handleDimensionChange = (
    axis: "width" | "height",
    value: number
  ): void => {
    setDraft((prev) => {
      const resolved = resolveCustomDimensions(
        axis === "width" ? value : prev.width,
        axis === "height" ? value : prev.height,
        dimensionBounds
      );
      return {
        ...prev,
        aspectRatio: CUSTOM_ASPECT_ID,
        width: resolved.width,
        height: resolved.height,
      };
    });
  };

  const handleProfileChange = async (profile: PerformanceProfile): Promise<void> => {
    await onChangeProfile(profile);
    if (draft.aspectRatio === CUSTOM_ASPECT_ID) return;
    const dims = resolveDimensionsForAspect(
      draft.aspectRatio,
      currentArch,
      profile,
      dimensionBounds
    );
    setDraft((prev) => ({
      ...prev,
      width: dims.width,
      height: dims.height,
    }));
  };

  const handleAddLora = (relPath?: string): void => {
    const maxLoras = activeWorkflow?.maxLoras ?? 4;
    if (draft.loras.length >= maxLoras) {
      onToast(`This workflow accepts at most ${maxLoras} LoRAs.`);
      return;
    }
    const targetPath = relPath ?? loraModels[0]?.relativePath;
    if (!targetPath) return;
    if (draft.loras.some((sel) => sel.name === targetPath)) {
      onToast("That LoRA is already in the stack.");
      return;
    }

    const model = loraModels.find((m) => m.relativePath === targetPath);
    const info = model ? getEffectiveModelInfo(model) : null;
    setDraft((prev) => ({
      ...prev,
      loras: [
        ...prev.loras,
        { name: targetPath, strengthModel: 0.85, strengthClip: 0.85 },
      ],
    }));
    setLoraPickerOpen(false);
    setLoraSearch("");

    if (
      model &&
      info &&
      !evaluateLoraCompatibility(info.architecture, currentArch).compatible
    ) {
      onToast(
        `${info.name} targets ${ARCHITECTURE_LABELS[info.architecture]} — it is incompatible with ${
          ARCHITECTURE_LABELS[currentArch]
        } and will block generation.`,
        "error"
      );
    }
  };

  const updateLora = (
    index: number,
    patch: Partial<GenerationRequest["loras"][number]>
  ): void => {
    setDraft((p) => {
      const next = [...p.loras];
      next[index] = { ...next[index]!, ...patch };
      return { ...p, loras: next };
    });
  };

  const handleOpenSaveRecipe = (): void => {
    if (draft.mode === "upscale") return;
    const fallbackName =
      draft.prompt.trim().slice(0, 48) ||
      currentCheckpointInfo?.name ||
      "Untitled LoRA Recipe";
    setRecipeName(activeRecipe?.name ?? fallbackName);
    setRecipeDescription(activeRecipe?.description ?? "");
    setRecipeModalOpen(true);
  };

  const handleSaveRecipe = async (): Promise<void> => {
    const name = recipeName.trim();
    if (!name) return;
    setSavingRecipe(true);
    try {
      const recipeInput: LoraRecipeInput = {
        id: activeRecipe?.id,
        name,
        description: recipeDescription.trim(),
        mode: draft.mode === "img2img" ? "img2img" : "txt2img",
        workflowId: draft.workflowId,
        architecture: currentArch,
        checkpointPath: draft.checkpoint || null,
        checkpointName: currentCheckpointInfo?.name ?? null,
        basePrompt: draft.prompt,
        negativePrompt: draft.negativePrompt,
        settings: {
          aspectRatio: draft.aspectRatio,
          width: draft.width,
          height: draft.height,
          steps: draft.steps,
          cfg: draft.cfg,
          sampler: draft.sampler,
          scheduler: draft.scheduler,
          seed: draft.randomSeed ? undefined : draft.seed,
          denoise: draft.denoise,
          batchCount: draft.batchCount,
          outputFormat: draft.outputFormat,
          hiresFix: draft.hiresFix,
        },
        items: draft.loras.map((sel) => {
          const model = loraModels.find((m) => m.relativePath === sel.name);
          const info = model ? getEffectiveModelInfo(model) : null;
          return {
            loraPath: sel.name,
            loraName: info?.name ?? shortModelLabel(sel.name),
            architecture: info?.architecture ?? currentArch,
            strengthModel: sel.strengthModel,
            strengthClip: sel.strengthClip,
            enabled: true,
            triggerWords: info?.triggerWords ?? [],
          };
        }),
      };
      const saved = await onSaveRecipe(recipeInput);
      onSelectRecipe(saved.id);
      setRecipeModalOpen(false);
      onToast(`Saved LoRA recipe '${saved.name}'.`);
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setSavingRecipe(false);
    }
  };

  const handleApplyRecipe = (recipeId: string): void => {
    if (!recipeId) {
      onSelectRecipe(null);
      return;
    }
    const recipe = recipes.find((r) => r.id === recipeId);
    if (!recipe) return;

    const installedCheckpoint = recipe.checkpointPath
      ? primaryModels.find((m) => m.relativePath === recipe.checkpointPath)
      : null;
    const settings = recipe.settings;
    const restoredLoras = recipe.items
      .filter((item) => item.enabled)
      .slice(0, 4)
      .map((item) => ({
        name: item.loraPath,
        strengthModel: item.strengthModel,
        strengthClip: item.strengthClip,
      }));

    setDraft((prev) => ({
      ...prev,
      mode: recipe.mode === "img2img" ? "img2img" : "txt2img",
      workflowId: recipe.workflowId ?? prev.workflowId,
      checkpoint: installedCheckpoint?.relativePath ?? prev.checkpoint,
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
      loras: restoredLoras,
    }));
    onSelectRecipe(recipe.id);
    onToast(`Loaded LoRA recipe '${recipe.name}'.`);
    if (recipe.checkpointPath && !installedCheckpoint) {
      onToast(
        `Checkpoint for '${recipe.name}' is not installed; kept the current checkpoint.`
      );
    }
  };

  const handlePickInputImage = async (): Promise<void> => {
    const picked = await window.kirea.pickImage();
    if (picked) {
      setDraft((prev) => ({ ...prev, inputImagePath: picked }));
    }
  };

  const handlePickReference = async (): Promise<void> => {
    const picked = await window.kirea.pickImage();
    if (!picked) return;
    handleModeSwitch("img2img");
    setDraft((prev) => ({ ...prev, inputImagePath: picked }));
  };

  const handleClearReference = (): void => {
    setDraft((prev) => ({ ...prev, inputImagePath: null }));
    if (draft.mode === "img2img") handleModeSwitch("txt2img");
  };

  const checkpointOptions = useMemo(
    () =>
      primaryModels.map((model) => ({
        path: model.relativePath,
        label: getModelDisplayName(model),
      })),
    [primaryModels]
  );

  const hiresDims = useMemo(
    () =>
      calculateHiresDimensions(
        draft.width,
        draft.height,
        hiresConfig.scale,
        activeWorkflow?.dimStep ?? 8,
        activeWorkflow?.minDim ?? 256,
        4096
      ),
    [draft.width, draft.height, hiresConfig.scale, activeWorkflow?.dimStep, activeWorkflow?.minDim]
  );

  const upscaleSourceWidth = sourceImageDims?.width ?? draft.width;
  const upscaleSourceHeight = sourceImageDims?.height ?? draft.height;
  const upscaleTargetWidth = Math.round(upscaleSourceWidth * upscaleConfig.scale);
  const upscaleTargetHeight = Math.round(upscaleSourceHeight * upscaleConfig.scale);

  const isRefinerPipeline =
    draft.workflowId === "upscale_refiner_v1" ||
    upscaleConfig.pipeline === "refiner";

  const refinerCheckpointModels = useMemo(
    () =>
      models.filter(
        (m) =>
          m.installed &&
          m.category === "checkpoint" &&
          ["sd15", "sdxl", "illustrious", "pony", "unknown"].includes(
            getEffectiveArchitecture(m)
          )
      ),
    [models]
  );

  const refinerArch = useMemo(() => {
    const ref = upscaleConfig.checkpoint || draft.checkpoint;
    const model = refinerCheckpointModels.find(
      (m) => m.relativePath === ref || m.name === ref
    );
    return model ? getEffectiveArchitecture(model) : inferModelArchitecture(ref);
  }, [refinerCheckpointModels, upscaleConfig.checkpoint, draft.checkpoint]);

  const refinerCompatibleLoras = useMemo(
    () =>
      loraModels.filter(
        (m) =>
          evaluateLoraCompatibility(
            getEffectiveArchitecture(m),
            refinerArch
          ).compatible
      ),
    [loraModels, refinerArch]
  );

  const setUpscalePipeline = (pipeline: "crisp" | "refiner"): void => {
    setDraft((prev) => ({
      ...prev,
      workflowId:
        pipeline === "refiner" ? "upscale_refiner_v1" : "upscale_model_v1",
      upscale: {
        ...prev.upscale,
        upscaler:
          prev.upscale?.upscaler ||
          upscaleModels[0]?.relativePath ||
          IMAGE_UPSCALER_LANCZOS,
        scale: prev.upscale?.scale ?? 4,
        pipeline,
        preset: pipeline === "refiner" ? prev.upscale?.preset : undefined,
        creativity:
          pipeline === "refiner"
            ? prev.upscale?.creativity ?? 0.35
            : prev.upscale?.creativity,
        steps: pipeline === "refiner" ? prev.upscale?.steps ?? 20 : prev.upscale?.steps,
      },
    }));
  };

  const applyUpscalePreset = (
    presetId: (typeof UPSCALE_PRESETS)[number]["id"]
  ): void => {
    const preset = UPSCALE_PRESETS.find((candidate) => candidate.id === presetId);
    const resolvedUpscaler = findPresetUpscaler(presetId, upscaleModels);
    setDraft((prev) => ({
      ...prev,
      workflowId: "upscale_refiner_v1",
      upscale: {
        ...prev.upscale,
        upscaler:
          resolvedUpscaler ||
          prev.upscale?.upscaler ||
          IMAGE_UPSCALER_LANCZOS,
        scale: prev.upscale?.scale ?? 4,
        pipeline: "refiner",
        preset: presetId,
        creativity: preset?.creativity ?? 0.35,
        steps: prev.upscale?.steps ?? 20,
      },
    }));
  };

  const setHiresPipeline = (pipeline: "latent" | "refiner"): void => {
    setDraft((prev) => {
      const config = prev.hiresFix ?? DEFAULT_HIRES_CONFIG;
      const latentUpscaler =
        config.upscaler === LATENT_UPSCALER_BISLERP ||
        config.upscaler === LATENT_UPSCALER_BICUBIC;
      return {
        ...prev,
        hiresFix: {
          ...config,
          enabled: true,
          pipeline,
          upscaler:
            pipeline === "refiner" && latentUpscaler
              ? upscaleModels[0]?.relativePath ?? config.upscaler
              : config.upscaler,
          creativity: config.creativity ?? 0.35,
        },
      };
    });
  };

  const handleGenerate = async (): Promise<void> => {
    if (workflowMode !== "generate" && !draft.inputImagePath) {
      onToast(`Please load or select a source image to begin ${workflowMode}.`, "error");
      return;
    }
    if (workflowMode === "inpaint" && !draft.maskDataUrl && !currentMaskDataUrl) {
      onToast("Please brush an inpaint mask over the area you want to regenerate.", "error");
      return;
    }
    if (
      workflowMode === "outpaint" &&
      (!draft.outpaintPadding ||
        (draft.outpaintPadding.top === 0 &&
          draft.outpaintPadding.bottom === 0 &&
          draft.outpaintPadding.left === 0 &&
          draft.outpaintPadding.right === 0))
    ) {
      onToast("Please expand at least one border (+64px) to outpaint.", "error");
      return;
    }
    setSubmitting(true);
    try {
      const payload: GenerationRequest = {
        ...draft,
        maskDataUrl: workflowMode === "inpaint" ? (draft.maskDataUrl ?? currentMaskDataUrl) : null,
        outpaintPadding: workflowMode === "outpaint" ? draft.outpaintPadding : null,
      };
      await window.kirea.submitJob(payload);
      if (draft.mode === "upscale") {
        onToast("Upscale job queued.");
      } else {
        onToast(
          draft.batchCount > 1
            ? `Queued ${draft.batchCount} generation jobs.`
            : "Generation job queued."
        );
      }
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setSubmitting(false);
    }
  };

  const blockingErrors = validationIssues.filter((v) => v.severity === "error");
  const warnings = validationIssues.filter((v) => v.severity === "warning");
  // An untouched, empty prompt is the normal starting state, not a mistake.
  // Validation still blocks generation; the red message only appears once
  // the user has written (then cleared) a prompt or tried to generate.
  const promptPending =
    !promptTouched && draft.mode !== "upscale" && draft.prompt.trim().length === 0;
  const visibleBlockingErrors = promptPending
    ? blockingErrors.filter((v) => v.field !== "prompt")
    : blockingErrors;

  const progressPercent =
    activeJob && activeJob.progressMax > 0
      ? Math.min(100, Math.round((activeJob.progressStep / activeJob.progressMax) * 100))
      : 0;
  return {
    ...props,
    validationIssues,
    submitting,
    sourceImageDims,
    setSourceImageDims,
    loraPickerOpen,
    setLoraPickerOpen,
    loraSearch,
    setLoraSearch,
    showIncompatibleLoras,
    setShowIncompatibleLoras,
    recipeModalOpen,
    setRecipeModalOpen,
    recipeName,
    setRecipeName,
    recipeDescription,
    setRecipeDescription,
    savingRecipe,
    uiMode,
    setUiMode,
    leftPanelOpen,
    setLeftPanelOpen,
    inspectorOpen,
    setInspectorOpen,
    inspectorTab,
    setInspectorTab,
    primaryModels,
    currentCheckpointModel,
    currentArch,
    checkpointGroups,
    loraModels,
    filteredLoraModels,
    activeRecipe,
    vaeModels,
    autoVaeName,
    upscaleModels,
    hiresConfig,
    upscaleConfig,
    compatibleWorkflows,
    activeWorkflow,
    dimensionBounds,
    dimensionInfo,
    activeJob,
    latestImage,
    currentCheckpointInfo,
    loraWarnings,
    activeCharacter,
    activeCharacterPlan,
    appendToPrompt,
    workflowMode,
    setWorkflowMode,
    handleSelectWorkflowMode,
    handleModeSwitch,
    handleWorkflowChange,
    handleCheckpointChange,
    handleAspectChange,
    handleDimensionChange,
    handleProfileChange,
    handleAddLora,
    updateLora,
    handleOpenSaveRecipe,
    handleSaveRecipe,
    handleApplyRecipe,
    handlePickInputImage,
    handlePickReference,
    handleClearReference,
    checkpointOptions,
    hiresDims,
    upscaleSourceWidth,
    upscaleSourceHeight,
    upscaleTargetWidth,
    upscaleTargetHeight,
    isRefinerPipeline,
    refinerCheckpointModels,
    refinerArch,
    refinerCompatibleLoras,
    setUpscalePipeline,
    applyUpscalePreset,
    setHiresPipeline,
    currentMaskDataUrl,
    outpaintPadding,
    handleMaskChange,
    handleOutpaintParamsChange,
    handleGenerate,
    blockingErrors,
    visibleBlockingErrors,
    promptPending,
    revealPromptErrors,
    warnings,
    progressPercent,
  };
}

export type CreateController = ReturnType<typeof useCreateController>;
