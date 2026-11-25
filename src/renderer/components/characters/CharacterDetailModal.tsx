import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertCircle,
  BookOpen,
  Check,
  CheckCircle,
  Clock,
  Copy,
  Cpu,
  Database,
  Download,
  Eye,
  FolderOpen,
  ImagePlus,
  Info,
  Layers,
  Lock,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Scissors,
  Sliders,
  Sparkles,
  StopCircle,
  Tag,
  Terminal,
  Trash2,
  Unlock,
  UserCheck,
  Users,
  Wand2,
  X,
} from "lucide-react";
import { ARCHITECTURE_LABELS } from "../../../shared/model-utils";
import {
  CHARACTER_REFERENCE_APPROVAL_LABELS,
  CHARACTER_REFERENCE_CATEGORY_LABELS,
  CHARACTER_REFERENCE_ROLE_LABELS,
  getCharacterCoverReference,
  getCharacterIdentityTokens,
} from "../../../shared/character-utils";
import {
  GENDER_CATALOG,
  POPULAR_GENDER_PRESETS,
  SPECIES_CATALOG,
  POPULAR_SPECIES_PRESETS,
  ARCHETYPE_CATALOG,
  POPULAR_ARCHETYPE_PRESETS,
} from "../../../shared/character-catalog";
import { TraitSelectGroup } from "./TraitSelectGroup";
import type {
  CharacterAdapter,
  CharacterIdentityCore,
  CharacterKnowledge,
  CharacterOutfit,
  CharacterProfile,
  CharacterProfileInput,
  CharacterReference,
  CharacterReferenceApproval,
  CharacterReferenceCategory,
  CharacterReferenceRole,
  CharacterTrainingConfig,
  CharacterTrainingJob,
  CharacterTrainingTelemetry,
  DatasetValidationReport,
  ModelArchitecture,
  ModelRecord,
  TrainingPreflightResult,
  VisionModelStatus,
  VisualTag,
  VisualTagApproval,
  VisualTagCategory,
} from "../../../shared/types";
import { toMediaUrl } from "../../utils/format";
import { Badge, Button, Input, Modal, Select, SliderField, Textarea } from "../ui/Primitives";
import { CropReferenceModal } from "./CropReferenceModal";
import { VisionTagModal } from "./VisionTagModal";

const MAX_TRAIN_LOG_LINES = 1000;

type CharacterWorkspaceApi = {
  listCharacterOutfits: (characterId: string) => Promise<CharacterOutfit[]>;
  listCharacterAdapters: (characterId: string) => Promise<CharacterAdapter[]>;
  listCharacterTrainingJobs: (characterId: string) => Promise<CharacterTrainingJob[]>;
};

type CharacterWorkspaceData = {
  outfits: CharacterOutfit[];
  adapters: CharacterAdapter[];
  jobs: CharacterTrainingJob[];
};

export function buildCharacterKnowledgeInput(
  characterId: string,
  knowledge: CharacterKnowledge
): Pick<CharacterProfileInput, "id" | "knowledge"> {
  return { id: characterId, knowledge };
}

export function appendTrainingLogLine(
  lines: string[],
  line: string,
  limit = MAX_TRAIN_LOG_LINES
): string[] {
  return [...lines, line].slice(-limit);
}

export function shouldHandleTrainingEvent(
  event: { jobId?: string; trainingId?: string; characterId?: string },
  activeJobId: string | null,
  characterId: string | null
): boolean {
  if (!activeJobId || !characterId) return false;
  const eventJobId = event.jobId ?? event.trainingId;
  return (
    eventJobId === activeJobId &&
    (event.characterId === undefined || event.characterId === characterId)
  );
}

export async function loadCharacterWorkspace(
  characterId: string,
  api: CharacterWorkspaceApi,
  isCurrent: () => boolean,
  apply: (data: CharacterWorkspaceData) => void
): Promise<void> {
  try {
    const [outfits, adapters, jobs] = await Promise.all([
      api.listCharacterOutfits(characterId),
      api.listCharacterAdapters(characterId),
      api.listCharacterTrainingJobs(characterId),
    ]);
    if (isCurrent()) apply({ outfits, adapters, jobs });
  } catch {
    // Best-effort workspace loading.
  }
}

function formatRemainingMs(ms?: number | null): string {
  if (ms === undefined || ms === null || isNaN(ms) || ms <= 0) return "Calculating...";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

interface LiveLossGraphProps {
  telemetry: CharacterTrainingTelemetry | null;
  activeJob: CharacterTrainingJob | null;
}

function LiveLossGraph({ telemetry, activeJob }: LiveLossGraphProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const history = telemetry?.lossHistory ?? [];
  const totalSteps = telemetry?.totalSteps || activeJob?.progressMax || Math.max(history.length, 1);

  if (history.length === 0) {
    return (
      <div className="w-full h-44 border-2 border-border bg-[#0B0C10] flex flex-col items-center justify-center text-fg-subtle font-mono text-xs space-y-1.5 p-4">
        <Activity className="w-6 h-6 text-accent/50 animate-pulse" />
        <span className="text-fg font-semibold">Live Training Telemetry Graph</span>
        <span className="text-[11px] text-fg-subtle text-center">
          Step loss and smoothed EMA curves will plot dynamically as PyTorch diffusion steps execute.
        </span>
      </div>
    );
  }

  const rawLosses = history.map((h) => h.loss).filter((l) => typeof l === "number" && !isNaN(l) && isFinite(l));
  const minLoss = Math.max(0, Math.min(...rawLosses, 0.01));
  const maxLoss = Math.max(...rawLosses, minLoss + 0.1);
  const lossRange = Math.max(0.01, maxLoss - minLoss);

  const width = 600;
  const height = 180;
  const padLeft = 45;
  const padRight = 15;
  const padTop = 15;
  const padBottom = 25;

  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;

  const getX = (step: number) => padLeft + (step / totalSteps) * chartW;
  const getY = (loss: number) => padTop + chartH - ((loss - minLoss) / lossRange) * chartH;

  const rawPath = history
    .map((pt, i) => `${i === 0 ? "M" : "L"} ${getX(pt.step).toFixed(1)} ${getY(pt.loss).toFixed(1)}`)
    .join(" ");

  let currentSmoothed = history[0]?.loss ?? 0;
  const smoothedPts = history.map((pt) => {
    currentSmoothed = 0.1 * pt.loss + 0.9 * currentSmoothed;
    return { step: pt.step, loss: currentSmoothed };
  });
  const smoothedPath = smoothedPts
    .map((pt, i) => `${i === 0 ? "M" : "L"} ${getX(pt.step).toFixed(1)} ${getY(pt.loss).toFixed(1)}`)
    .join(" ");

  const totalEpochs = telemetry?.totalEpochs || activeJob?.totalEpochs || 10;
  const stepsPerEpoch = Math.max(1, Math.round(totalSteps / totalEpochs));
  const epochLines: Array<{ epoch: number; x: number }> = [];
  for (let e = 1; e < totalEpochs; e++) {
    const epochStep = e * stepsPerEpoch;
    if (epochStep <= totalSteps) {
      epochLines.push({ epoch: e, x: getX(epochStep) });
    }
  }

  const activeIdx = hoveredIndex !== null && history[hoveredIndex] ? hoveredIndex : history.length - 1;
  const activePoint = history[activeIdx];
  const activeSmoothed = smoothedPts[activeIdx];

  return (
    <div className="border-2 border-border bg-[#0B0C10] p-3 space-y-2 relative">
      <div className="flex flex-wrap items-center justify-between text-xs font-mono border-b border-border/40 pb-2 gap-2">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 font-bold text-fg">
            <Activity className="w-3.5 h-3.5 text-accent" /> Live Loss Curves
          </span>
          <span className="flex items-center gap-1 text-[11px] text-fg-subtle">
            <span className="w-2.5 h-0.5 bg-accent/40 inline-block" /> Raw:{" "}
            <b className="text-fg">{activePoint?.loss.toFixed(4) ?? "—"}</b>
          </span>
          <span className="flex items-center gap-1 text-[11px] text-accent">
            <span className="w-2.5 h-0.5 bg-accent inline-block" /> EMA Smoothed:{" "}
            <b>{activeSmoothed?.loss.toFixed(4) ?? "—"}</b>
          </span>
        </div>
        <div className="text-[11px] text-fg-subtle">
          Step {activePoint?.step ?? 0} / {totalSteps}
        </div>
      </div>

      <div className="w-full relative overflow-hidden">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-44 select-none"
          onMouseLeave={() => setHoveredIndex(null)}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const relX = ((e.clientX - rect.left) / rect.width) * width;
            if (relX >= padLeft && relX <= width - padRight) {
              const approxStep = ((relX - padLeft) / chartW) * totalSteps;
              let bestIdx = 0;
              let bestDist = Infinity;
              for (let i = 0; i < history.length; i++) {
                const dist = Math.abs(history[i]!.step - approxStep);
                if (dist < bestDist) {
                  bestDist = dist;
                  bestIdx = i;
                }
              }
              setHoveredIndex(bestIdx);
            }
          }}
        >
          {/* Grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
            const y = padTop + chartH * ratio;
            const val = maxLoss - ratio * lossRange;
            return (
              <g key={ratio}>
                <line
                  x1={padLeft}
                  y1={y}
                  x2={width - padRight}
                  y2={y}
                  stroke="#2A2F3D"
                  strokeDasharray="2,2"
                  strokeWidth="1"
                />
                <text
                  x={padLeft - 6}
                  y={y + 3}
                  textAnchor="end"
                  fill="#717888"
                  fontSize="9"
                  fontFamily="monospace"
                >
                  {val.toFixed(2)}
                </text>
              </g>
            );
          })}

          {/* Epoch boundary vertical markers */}
          {epochLines.map((el) => (
            <g key={el.epoch}>
              <line
                x1={el.x}
                y1={padTop}
                x2={el.x}
                y2={padTop + chartH}
                stroke="#3B4252"
                strokeDasharray="3,3"
                strokeWidth="1"
              />
              <text
                x={el.x + 3}
                y={padTop + 10}
                fill="#94A3B8"
                fontSize="8"
                fontFamily="monospace"
              >
                E{el.epoch}
              </text>
            </g>
          ))}

          {/* Raw loss path */}
          <path
            d={rawPath}
            fill="none"
            stroke="#1E3BFF"
            strokeOpacity="0.4"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />

          {/* Smoothed EMA curve */}
          <path
            d={smoothedPath}
            fill="none"
            stroke="#1E3BFF"
            strokeWidth="2.5"
            strokeLinejoin="round"
          />

          {/* Hover crosshair and marker */}
          {activePoint && (
            <g>
              <line
                x1={getX(activePoint.step)}
                y1={padTop}
                x2={getX(activePoint.step)}
                y2={padTop + chartH}
                stroke="#FFFFFF"
                strokeOpacity="0.3"
                strokeWidth="1"
              />
              <circle
                cx={getX(activePoint.step)}
                cy={getY(activePoint.loss)}
                r="3.5"
                fill="#1E3BFF"
                stroke="#FFFFFF"
                strokeWidth="1.5"
              />
            </g>
          )}

          {/* X axis labels */}
          <text
            x={padLeft}
            y={height - 6}
            fill="#717888"
            fontSize="9"
            fontFamily="monospace"
          >
            Step 1
          </text>
          <text
            x={width - padRight}
            y={height - 6}
            textAnchor="end"
            fill="#717888"
            fontSize="9"
            fontFamily="monospace"
          >
            Step {totalSteps}
          </text>
        </svg>
      </div>
    </div>
  );
}

interface CharacterDetailModalProps {
  open: boolean;
  onClose: () => void;
  character: CharacterProfile | null;
  models: ModelRecord[];
  onSaveCharacter: (input: CharacterProfileInput) => Promise<CharacterProfile>;
  onPickReference: (
    characterId: string,
    role: CharacterReferenceRole
  ) => Promise<CharacterProfile | null>;
  onUpdateReference: (
    characterId: string,
    referenceId: string,
    patch: {
      role?: CharacterReferenceRole;
      caption?: string;
      category?: CharacterReferenceCategory;
      approvalStatus?: CharacterReferenceApproval;
      includedInTraining?: boolean;
    }
  ) => Promise<CharacterProfile | null>;
  onRemoveReference: (
    characterId: string,
    referenceId: string
  ) => Promise<CharacterProfile | null>;
  onUseCharacter: (character: CharacterProfile) => void;
  onToast: (msg: string, tone?: "info" | "error") => void;
}

type WorkspaceTab = "overview" | "appearance" | "references" | "training" | "knowledge";

export const CharacterDetailModal: React.FC<CharacterDetailModalProps> = ({
  open,
  onClose,
  character,
  models,
  onSaveCharacter,
  onPickReference,
  onUpdateReference,
  onRemoveReference,
  onUseCharacter,
  onToast,
}) => {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("overview");
  const [charData, setCharData] = useState<CharacterProfile | null>(character);
  const requestedCharacterIdRef = useRef<string | null>(character?.id ?? null);
  const activeJobIdRef = useRef<string | null>(null);
  const workspaceRequestRef = useRef(0);
  requestedCharacterIdRef.current = character?.id ?? null;

  // Sync prop changes
  useEffect(() => {
    setCharData(character);
  }, [character]);

  // Tab 2: Appearance & DNA State
  const [dna, setDna] = useState<Partial<CharacterIdentityCore>>({});
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [architecture, setArchitecture] = useState<ModelArchitecture>("illustrious");
  const [checkpointPath, setCheckpointPath] = useState("");
  const [savingDna, setSavingDna] = useState(false);

  // Outfits State
  const [outfits, setOutfits] = useState<CharacterOutfit[]>([]);
  const [newOutfitName, setNewOutfitName] = useState("");
  const [newOutfitTokens, setNewOutfitTokens] = useState("");
  const [newOutfitDesc, setNewOutfitDesc] = useState("");
  const [addingOutfit, setAddingOutfit] = useState(false);

  // Tab 3: References Filter & Crop Modal
  const [refCategoryFilter, setRefCategoryFilter] = useState<string>("ALL");
  const [cropTarget, setCropTarget] = useState<CharacterReference | null>(null);

  // Tab 4: Training & Dataset Builder State
  const [datasetReport, setDatasetReport] = useState<DatasetValidationReport | null>(null);
  const [loadingValidation, setLoadingValidation] = useState(false);
  const [exportingDataset, setExportingDataset] = useState(false);
  const [adapters, setAdapters] = useState<CharacterAdapter[]>([]);

  // Training Execution State
  const [preflight, setPreflight] = useState<TrainingPreflightResult | null>(null);
  const [checkingPreflight, setCheckingPreflight] = useState(false);
  const [trainConfig, setTrainConfig] = useState<CharacterTrainingConfig>({
    baseModelFamily: "illustrious",
    baseCheckpointPath: "",
    triggerToken: "",
    rank: 16,
    alpha: 16,
    learningRate: 0.0001,
    epochs: 10,
    batchSize: 1,
    resolution: 1024,
    gradientAccumulationSteps: 1,
    gradientCheckpointing: true,
    precision: "bf16",
  });
  const [activeJob, setActiveJob] = useState<CharacterTrainingJob | null>(null);
  const [startingTraining, setStartingTraining] = useState(false);
  const trainingStartPendingRef = useRef<symbol | null>(null);
  const [trainLogs, setTrainLogs] = useState<string[]>([]);
  const logsEndRef = useRef<HTMLDivElement | null>(null);

  // Vision Tag Interrogation & Training Telemetry State
  const [telemetry, setTelemetry] = useState<CharacterTrainingTelemetry | null>(null);
  const [visionModelStatus, setVisionModelStatus] = useState<VisionModelStatus | null>(null);
  const [autoTagging, setAutoTagging] = useState(false);
  const [taggingProgress, setTaggingProgress] = useState<{ current: number; total: number; referenceId: string; status: string } | null>(null);
  const [selectedTagRef, setSelectedTagRef] = useState<CharacterReference | null>(null);

  // Tab 5: Knowledge & Lore State
  const [knowledge, setKnowledge] = useState<Partial<CharacterKnowledge>>({});
  const [personalityInput, setPersonalityInput] = useState("");
  const [speechStyleInput, setSpeechStyleInput] = useState("");
  const [backgroundInput, setBackgroundInput] = useState("");
  const [historyInput, setHistoryInput] = useState("");
  const [worldbuildingInput, setWorldbuildingInput] = useState("");
  const [motivationsInput, setMotivationsInput] = useState("");
  const [savingKnowledge, setSavingKnowledge] = useState(false);

  // Initialize data when character opens
  useEffect(() => {
    const requestId = ++workspaceRequestRef.current;
    activeJobIdRef.current = null;
    trainingStartPendingRef.current = null;
    setActiveJob(null);
    setTrainLogs([]);
    setTelemetry(null);
    setOutfits([]);
    setAdapters([]);
    setStartingTraining(false);
    setDatasetReport(null);
    setPreflight(null);
    setCropTarget(null);
    setSelectedTagRef(null);
    if (!character) return;
    setName(character.name);
    setDescription(character.description || "");
    setArchitecture(character.architecture);
    setCheckpointPath(character.checkpointPath || "");
    setDna(character.dna || {
      triggerToken: character.triggerWords[0] || `kirea_${character.name.toLowerCase().replace(/[^a-z0-9]/g, "_")}`,
      gender: "Female",
      ageCategory: "Young Adult",
      species: "Human",
      archetype: "",
      hairColor: "",
      hairStyle: "",
      eyeColor: "",
      skinTone: "",
      facialCharacteristics: "",
      distinctiveFeatures: [],
      bodyCharacteristics: "",
      signatureAccessories: [],
      preferredStyle: "Anime",
      negativeConstraints: character.negativePrompt || "",
      dnaLocked: true,
    });
    setTrainConfig((prev) => ({
      ...prev,
      triggerToken: character.dna?.triggerToken || character.triggerWords[0] || `kirea_${character.name.toLowerCase().replace(/[^a-z0-9]/g, "_")}`,
      baseModelFamily: character.architecture === "sdxl" ? "sdxl" : "illustrious",
    }));

    // Knowledge
    const k: Partial<CharacterKnowledge> = character.knowledge || {};
    setKnowledge(k);
    setPersonalityInput(k.personality || "");
    setSpeechStyleInput(k.speechStyle || "");
    setBackgroundInput(k.background || "");
    setHistoryInput(k.history || "");
    setWorldbuildingInput(k.worldbuilding || "");
    setMotivationsInput(k.motivations || "");

    // Load Outfits & Adapters & Training Jobs via IPC
    void loadOutfitsAndAdapters(character.id, requestId);
  }, [character]);

  const loadOutfitsAndAdapters = async (charId: string, requestId = workspaceRequestRef.current) => {
    await loadCharacterWorkspace(
      charId,
      window.kirea,
      () =>
        workspaceRequestRef.current === requestId &&
        requestedCharacterIdRef.current === charId,
      ({ outfits: oList, adapters: aList, jobs }) => {
        setOutfits(oList);
        setAdapters(aList);
        const running = jobs.find((j) => j.status === "RUNNING" || j.status === "QUEUED");
        if (running) {
          activeJobIdRef.current = running.id;
          setActiveJob(running);
          setTrainLogs(running.logsText ? running.logsText.split("\n").slice(-MAX_TRAIN_LOG_LINES) : []);
        }
      }
    );
  };

  // Listen to live training progress and logs for the active job only.
  useEffect(() => {
    if (!open || !charData) return;
    const characterId = charData.id;
    let cancelled = false;
    const matchesActiveJob = (event: { jobId?: string; trainingId?: string; characterId?: string }) =>
      shouldHandleTrainingEvent(event, activeJobIdRef.current, characterId);

    const unsubProgress = window.kirea.onTrainingProgress((payload) => {
      if (!matchesActiveJob(payload)) return;
      setActiveJob((prev) => {
        if (!prev || prev.id !== payload.jobId) return prev;
        return {
          ...prev,
          progressStep: payload.step,
          progressMax: payload.maxSteps,
          currentEpoch: payload.epoch,
          loss: payload.loss,
          status: "RUNNING",
        };
      });
    });

    const unsubTelemetry = window.kirea.onTrainingTelemetry((tel) => {
      if (!matchesActiveJob(tel)) return;
      setTelemetry(tel);
      setActiveJob((prev) => {
        if (!prev || prev.id !== tel.trainingId) return prev;
        return {
          ...prev,
          progressStep: tel.step,
          progressMax: tel.totalSteps,
          currentEpoch: tel.epoch,
          totalEpochs: tel.totalEpochs,
          loss: tel.loss,
          status: "RUNNING",
        };
      });
    });

    const unsubVisionProgress = window.kirea.onVisionTaggingProgress((payload) => {
      setTaggingProgress(payload.status === "completed" ? null : payload);
    });

    window.kirea
      .getVisionModelStatus()
      .then((status) => {
        if (!cancelled) setVisionModelStatus(status);
      })
      .catch(() => undefined);

    const unsubLog = window.kirea.onTrainingLog((payload) => {
      if (!matchesActiveJob(payload)) return;
      setTrainLogs((prev) => appendTrainingLogLine(prev, payload.line));
    });

    const unsubCompleted = window.kirea.onTrainingCompleted((payload) => {
      if (!matchesActiveJob(payload)) return;
      setActiveJob((prev) => {
        if (!prev || prev.id !== payload.jobId) return prev;
        return {
          ...prev,
          status: payload.status as CharacterTrainingJob["status"],
          adapterId: payload.adapterId,
          errorMessage: payload.error || null,
          completedAt: new Date().toISOString(),
        };
      });
      if (payload.status === "COMPLETED") {
        onToast("Character LoRA training completed successfully!");
        void loadOutfitsAndAdapters(characterId);
      } else if (payload.status === "FAILED") {
        onToast(`Training failed: ${payload.error || "Unknown error"}`, "error");
      }
    });

    return () => {
      cancelled = true;
      unsubProgress();
      unsubTelemetry();
      unsubVisionProgress();
      unsubLog();
      unsubCompleted();
    };
  }, [charData, open, onToast]);

  // Auto-scroll training logs terminal
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [trainLogs]);

  if (!charData) return null;

  // --- Handlers ---
  const handleSaveDna = async () => {
    setSavingDna(true);
    try {
      const updated = await onSaveCharacter({
        id: charData.id,
        name: name.trim(),
        description: description.trim(),
        architecture,
        checkpointPath: checkpointPath || null,
        dna,
        negativePrompt: dna.negativeConstraints,
        triggerWords: [dna.triggerToken || ""].filter(Boolean),
      });
      setCharData(updated);
      onToast("Character DNA saved successfully.");
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setSavingDna(false);
    }
  };

  const handleSaveKnowledge = async () => {
    setSavingKnowledge(true);
    try {
      const updatedKnowledge: CharacterKnowledge = {
        personality: personalityInput.trim(),
        speechStyle: speechStyleInput.trim(),
        background: backgroundInput.trim(),
        history: historyInput.trim(),
        worldbuilding: worldbuildingInput.trim(),
        motivations: motivationsInput.trim(),
        relationships: knowledge.relationships || [],
        likes: knowledge.likes || [],
        dislikes: knowledge.dislikes || [],
        rules: knowledge.rules || [],
        dialogueExamples: knowledge.dialogueExamples || [],
      };
      const updated = await onSaveCharacter(
        buildCharacterKnowledgeInput(charData.id, updatedKnowledge) as CharacterProfileInput
      );
      setCharData(updated);
      setKnowledge(updatedKnowledge);
      onToast("Character knowledge & lore updated.");
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setSavingKnowledge(false);
    }
  };

  const handleAddOutfit = async () => {
    if (!newOutfitName.trim()) {
      onToast("Outfit needs a name.", "error");
      return;
    }
    try {
      const promptTokens = newOutfitTokens
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const outfit = await window.kirea.saveCharacterOutfit({
        id: "",
        characterId: charData.id,
        name: newOutfitName.trim(),
        description: newOutfitDesc.trim(),
        promptTokens,
        isDefault: outfits.length === 0,
        previewImagePath: null,
      });
      setOutfits((prev) => [...prev, outfit]);
      setNewOutfitName("");
      setNewOutfitTokens("");
      setNewOutfitDesc("");
      setAddingOutfit(false);
      onToast(`Outfit '${outfit.name}' added.`);
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "error");
    }
  };

  const handleDeleteOutfit = async (outfitId: string) => {
    try {
      await window.kirea.deleteCharacterOutfit(charData.id, outfitId);
      setOutfits((prev) => prev.filter((o) => o.id !== outfitId));
      onToast("Outfit deleted.");
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "error");
    }
  };

  const handleAutoTagAll = async () => {
    if (!charData) return;
    setAutoTagging(true);
    try {
      const updated = await window.kirea.interrogateCharacterReferenceTags(charData.id);
      if (updated) {
        setCharData(updated);
        onToast(`Auto-tagged ${updated.references.length} reference images.`);
      }
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setAutoTagging(false);
    }
  };

  const handleUpdateReferenceTags = async (referenceId: string, tags: VisualTag[]) => {
    if (!charData) return;
    try {
      const updated = await window.kirea.updateCharacterReferenceTags(charData.id, referenceId, tags);
      if (updated) {
        setCharData(updated);
        const updatedRef = updated.references.find((r) => r.id === referenceId);
        if (updatedRef && selectedTagRef?.id === referenceId) {
          setSelectedTagRef(updatedRef);
        }
      }
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "error");
    }
  };

  const handleRunValidation = async () => {
    setLoadingValidation(true);
    try {
      const report = await window.kirea.validateCharacterDataset(charData.id);
      setDatasetReport(report);
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setLoadingValidation(false);
    }
  };

  const handleExportDataset = async () => {
    setExportingDataset(true);
    try {
      const result = await window.kirea.exportCharacterDataset(charData.id);
      onToast(`Dataset exported with ${result.count} images.`);
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setExportingDataset(false);
    }
  };

  const handleRunPreflight = async () => {
    setCheckingPreflight(true);
    try {
      const res = await window.kirea.preflightCharacterTraining(charData.id, trainConfig);
      setPreflight(res);
      if (res.canTrain) {
        onToast("Hardware & dataset preflight checks passed!");
      } else {
        onToast(`Preflight warning: ${res.blockers[0] || "Review warnings"}`, "error");
      }
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setCheckingPreflight(false);
    }
  };

  const handleStartTraining = async () => {
    if (trainingStartPendingRef.current) return;
    const request = Symbol("training-start");
    const characterId = charData.id;
    trainingStartPendingRef.current = request;
    setStartingTraining(true);
    try {
      setTrainLogs(["[KIREA STUDIO] Initializing native PyTorch LoRA training environment..."]);
      const job = await window.kirea.startCharacterTraining(characterId, {
        ...trainConfig,
        triggerToken: dna.triggerToken || charData.name.toLowerCase().replace(/[^a-z0-9]/g, "_"),
      });
      if (requestedCharacterIdRef.current !== characterId) return;
      activeJobIdRef.current = job.id;
      setTelemetry(null);
      setActiveJob(job);
      onToast(`Training job ${job.id} dispatched!`);
    } catch (err) {
      if (requestedCharacterIdRef.current === characterId) {
        onToast(err instanceof Error ? err.message : String(err), "error");
      }
    } finally {
      if (trainingStartPendingRef.current === request) {
        trainingStartPendingRef.current = null;
        setStartingTraining(false);
      }
    }
  };

  const handleCancelTraining = async () => {
    if (!activeJob) return;
    try {
      await window.kirea.cancelCharacterTraining(activeJob.id);
      onToast("Training job cancellation requested.");
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "error");
    }
  };

  const handleDeleteAdapter = async (adapterId: string) => {
    try {
      await window.kirea.deleteCharacterAdapter(charData.id, adapterId);
      setAdapters((prev) => prev.filter((a) => a.id !== adapterId));
      onToast("Character adapter removed.");
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "error");
    }
  };

  const cover = getCharacterCoverReference(charData);

  // Filtered references
  const visibleReferences = useMemo(() => {
    if (refCategoryFilter === "ALL") return charData.references;
    return charData.references.filter((r) => r.category === refCategoryFilter);
  }, [charData.references, refCategoryFilter]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      closeOnBackdropClick={false}
      title={`${charData.name} — Character Studio`}
      maxWidthClass="max-w-6xl"
    >
      <div className="space-y-4">
        {/* Workspace Navigation Bar */}
        <div className="flex items-center gap-1 border-b-2 border-border pb-2 overflow-x-auto">
          {[
            { id: "overview", label: "Overview", icon: <UserCheck className="w-4 h-4" /> },
            { id: "appearance", label: "Appearance & Outfits", icon: <Pencil className="w-4 h-4" /> },
            { id: "references", label: `Visual Memory (${charData.references.length})`, icon: <Layers className="w-4 h-4" /> },
            { id: "training", label: "Training & Dataset", icon: <Cpu className="w-4 h-4" /> },
            { id: "knowledge", label: "Knowledge & Lore", icon: <BookOpen className="w-4 h-4" /> },
          ].map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as WorkspaceTab)}
                className={`flex items-center gap-2 px-3.5 py-1.5 font-mono text-xs uppercase tracking-wider border-2 transition-all shrink-0 ${
                  isActive
                    ? "bg-accent text-white border-accent shadow-[2px_2px_0px_#0B0C10]"
                    : "bg-surface-subtle text-fg border-border/60 hover:border-border hover:bg-surface"
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* WORKSPACE 1: OVERVIEW */}
        {activeTab === "overview" && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 animate-fadeIn">
            {/* Left Cover / Artwork */}
            <div className="border-2 border-border bg-surface-subtle p-3 flex flex-col items-center justify-center space-y-3">
              <div className="w-full aspect-[4/5] border-2 border-border bg-[#0B0C10] flex items-center justify-center overflow-hidden relative">
                {cover ? (
                  <img
                    src={toMediaUrl(cover.filePath)}
                    alt={charData.name}
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <div className="text-fg-subtle text-center p-4">
                    <UserCheck className="w-10 h-10 mx-auto mb-2 opacity-40" />
                    <span className="text-xs font-mono uppercase">No references yet</span>
                  </div>
                )}
                {dna.dnaLocked && (
                  <div className="absolute top-2 left-2 bg-[#1E3BFF] text-white px-2 py-0.5 text-[10px] font-mono font-bold border border-white">
                    DNA LOCKED
                  </div>
                )}
              </div>

              <Button
                variant="primary"
                className="w-full"
                onClick={() => {
                  onUseCharacter(charData);
                  onClose();
                }}
              >
                <Wand2 className="w-4 h-4" />
                Use in Creation Studio
              </Button>
            </div>

            {/* Right Telemetry & Traits */}
            <div className="md:col-span-2 space-y-4">
              <div className="p-4 border-2 border-border bg-bg space-y-2">
                <div className="flex items-center justify-between border-b border-border/50 pb-2">
                  <h3 className="text-xl font-bold text-fg">{charData.name}</h3>
                  <div className="flex items-center gap-1.5">
                    <Badge tone="accent">{dna.gender || "Female"}</Badge>
                    <Badge tone="neutral">{dna.ageCategory || "Young Adult"}</Badge>
                    <Badge tone="neutral">{dna.species || "Human"}</Badge>
                    {dna.archetype && (
                      <Badge tone="accent">{dna.archetype}</Badge>
                    )}
                    <Badge tone="neutral">{ARCHITECTURE_LABELS[charData.architecture]}</Badge>
                  </div>
                </div>

                <p className="text-xs text-fg-muted leading-relaxed">
                  {charData.description || "No general description configured."}
                </p>

                {/* Trigger Token */}
                <div className="pt-2 flex items-center gap-2">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-label">
                    Trigger Token:
                  </span>
                  <div className="flex items-center gap-1.5 bg-accent/10 border border-accent/30 px-2 py-0.5 text-accent font-mono text-xs">
                    <span>{dna.triggerToken || charData.triggerWords[0] || charData.name}</span>
                    <button
                      onClick={() => {
                        void navigator.clipboard.writeText(
                          dna.triggerToken || charData.triggerWords[0] || charData.name
                        );
                        onToast("Trigger token copied!");
                      }}
                      className="hover:text-white"
                      title="Copy token"
                    >
                      <Copy className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Fixed Traits vs Variable Traits */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 border-2 border-border bg-surface-subtle space-y-2">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-label flex items-center gap-1 text-fg">
                    <Lock className="w-3 h-3 text-accent" /> Fixed Biological Traits
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {dna.hairColor && <Badge tone="neutral">{dna.hairColor} hair</Badge>}
                    {dna.hairStyle && <Badge tone="neutral">{dna.hairStyle}</Badge>}
                    {dna.eyeColor && <Badge tone="neutral">{dna.eyeColor} eyes</Badge>}
                    {dna.skinTone && <Badge tone="neutral">{dna.skinTone} skin</Badge>}
                    {dna.distinctiveFeatures?.map((f, i) => (
                      <Badge key={i} tone="accent">{f}</Badge>
                    ))}
                    {!dna.hairColor && !dna.eyeColor && (
                      <span className="text-[11px] text-fg-subtle">No fixed traits defined yet.</span>
                    )}
                  </div>
                </div>

                <div className="p-3 border-2 border-border bg-surface-subtle space-y-2">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-label flex items-center gap-1 text-fg">
                    <Sparkles className="w-3 h-3 text-accent" /> Active Visual Adapters
                  </span>
                  {adapters.length > 0 ? (
                    <div className="space-y-1 text-xs">
                      {adapters.map((a) => (
                        <div key={a.id} className="flex items-center justify-between p-1.5 border border-border bg-bg font-mono text-[11px]">
                          <span>[{a.baseModelFamily.toUpperCase()}] Rank {a.rank}</span>
                          <span className="text-accent">{a.recommendedStrength} str</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-fg-subtle leading-relaxed">
                      No LoRA adapters trained yet. Go to the <b>Training & Dataset</b> workspace to build and train one locally.
                    </p>
                  )}
                </div>
              </div>

              {/* Readiness Pipeline Checklist */}
              <div className="p-3 border-2 border-border bg-bg space-y-2">
                <span className="text-[10px] font-mono uppercase tracking-wider text-label block">
                  Character Visual Identity Pipeline
                </span>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-accent" />
                    <span>Identity Core Defined</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {dna.hairColor || dna.eyeColor ? (
                      <CheckCircle className="w-4 h-4 text-accent" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-warning" />
                    )}
                    <span>Fixed Traits Specified</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {charData.references.length >= 4 ? (
                      <CheckCircle className="w-4 h-4 text-accent" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-warning" />
                    )}
                    <span>Visual References ({charData.references.length}/4 minimum)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {adapters.length > 0 ? (
                      <CheckCircle className="w-4 h-4 text-accent" />
                    ) : (
                      <span className="w-4 h-4 rounded-none border border-border flex items-center justify-center text-[10px] font-mono">0</span>
                    )}
                    <span>LoRA Adapter Registered</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* WORKSPACE 2: APPEARANCE & OUTFITS */}
        {activeTab === "appearance" && (
          <div className="space-y-5 animate-fadeIn">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Core Physical Features */}
              <div className="p-4 border-2 border-border bg-bg space-y-3">
                <div className="flex items-center justify-between border-b border-border/50 pb-2">
                  <span className="font-mono text-xs font-bold uppercase tracking-wider text-fg flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5 text-accent" /> Immutable Physical DNA
                  </span>
                  <label className="flex items-center gap-2 text-xs font-mono cursor-pointer">
                    <input
                      type="checkbox"
                      checked={dna.dnaLocked ?? true}
                      onChange={(e) => setDna((p) => ({ ...p, dnaLocked: e.target.checked }))}
                      className="accent-accent"
                    />
                    DNA Locked
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] font-mono text-fg-subtle block">Trigger Token</label>
                    <Input
                      value={dna.triggerToken || ""}
                      onChange={(e) => setDna((p) => ({ ...p, triggerToken: e.target.value }))}
                      className="h-8 text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-mono text-fg-subtle block">Age Category</label>
                    <Input
                      value={dna.ageCategory || ""}
                      onChange={(e) => setDna((p) => ({ ...p, ageCategory: e.target.value }))}
                      className="h-8 text-xs font-mono"
                    />
                  </div>
                </div>

                <div className="pt-1">
                  <TraitSelectGroup
                    label="1. Gender Specification (Primary Anchor)"
                    value={dna.gender || "Female"}
                    onChange={(val) => setDna((p) => ({ ...p, gender: val }))}
                    catalog={GENDER_CATALOG}
                    popularPresets={POPULAR_GENDER_PRESETS}
                    placeholder="e.g. Female, Male, Transgender, Femboy..."
                    description="Primary anatomical anchor (1girl, 1boy, femboy, etc.)."
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                  <TraitSelectGroup
                    label="Species"
                    value={dna.species || "Human"}
                    onChange={(val) => setDna((p) => ({ ...p, species: val }))}
                    catalog={SPECIES_CATALOG}
                    popularPresets={POPULAR_SPECIES_PRESETS}
                    placeholder="e.g. Kitsune, Cyborg, Elf, Android..."
                  />
                  <TraitSelectGroup
                    label="Archetype"
                    value={dna.archetype || ""}
                    onChange={(val) => setDna((p) => ({ ...p, archetype: val }))}
                    catalog={ARCHETYPE_CATALOG}
                    popularPresets={POPULAR_ARCHETYPE_PRESETS}
                    placeholder="e.g. Ronin, Netrunner, Assassin, Mage..."
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] font-mono text-fg-subtle block">Hair Color</label>
                    <Input
                      value={dna.hairColor || ""}
                      onChange={(e) => setDna((p) => ({ ...p, hairColor: e.target.value }))}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-mono text-fg-subtle block">Hair Style</label>
                    <Input
                      value={dna.hairStyle || ""}
                      onChange={(e) => setDna((p) => ({ ...p, hairStyle: e.target.value }))}
                      className="h-8 text-xs"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] font-mono text-fg-subtle block">Eye Color</label>
                    <Input
                      value={dna.eyeColor || ""}
                      onChange={(e) => setDna((p) => ({ ...p, eyeColor: e.target.value }))}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-mono text-fg-subtle block">Skin Tone</label>
                    <Input
                      value={dna.skinTone || ""}
                      onChange={(e) => setDna((p) => ({ ...p, skinTone: e.target.value }))}
                      className="h-8 text-xs"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[11px] font-mono text-fg-subtle block">
                    Distinctive Marks (scars, beauty marks, tattoos)
                  </label>
                  <Input
                    value={(dna.distinctiveFeatures || []).join(", ")}
                    onChange={(e) =>
                      setDna((p) => ({
                        ...p,
                        distinctiveFeatures: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                      }))
                    }
                    placeholder="scar over eye, beauty mark"
                    className="h-8 text-xs"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-mono text-fg-subtle block">
                    Negative Identity Constraints (Never generate)
                  </label>
                  <Input
                    value={dna.negativeConstraints || ""}
                    onChange={(e) => setDna((p) => ({ ...p, negativeConstraints: e.target.value }))}
                    placeholder="glasses, blonde hair, earrings"
                    className="h-8 text-xs font-mono"
                  />
                </div>
              </div>

              {/* Outfits Management */}
              <div className="p-4 border-2 border-border bg-bg space-y-3">
                <div className="flex items-center justify-between border-b border-border/50 pb-2">
                  <span className="font-mono text-xs font-bold uppercase tracking-wider text-fg">
                    Outfits ({outfits.length})
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setAddingOutfit((p) => !p)}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    {addingOutfit ? "Cancel" : "Add Outfit"}
                  </Button>
                </div>

                {addingOutfit && (
                  <div className="p-3 border-2 border-accent/40 bg-accent/5 space-y-2">
                    <span className="text-[10px] font-mono uppercase text-accent font-bold block">
                      New Character Outfit
                    </span>
                    <Input
                      value={newOutfitName}
                      onChange={(e) => setNewOutfitName(e.target.value)}
                      placeholder="Outfit Name (e.g. Combat Gear, Formal Yukata)"
                      className="h-8 text-xs"
                    />
                    <Input
                      value={newOutfitTokens}
                      onChange={(e) => setNewOutfitTokens(e.target.value)}
                      placeholder="Prompt Tokens (e.g. tactical vest, cargo pants, fingerless gloves)"
                      className="h-8 text-xs font-mono"
                    />
                    <Textarea
                      rows={2}
                      value={newOutfitDesc}
                      onChange={(e) => setNewOutfitDesc(e.target.value)}
                      placeholder="Description of colors, fabrics, and styling..."
                    />
                    <Button size="sm" variant="accent" onClick={handleAddOutfit}>
                      Save Outfit
                    </Button>
                  </div>
                )}

                <div className="space-y-2 max-h-[300px] overflow-y-auto">
                  {outfits.map((outfit) => (
                    <div
                      key={outfit.id}
                      className="p-2 border border-border bg-surface-subtle flex items-start justify-between gap-2"
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-xs text-fg">{outfit.name}</span>
                          {outfit.isDefault && <Badge tone="accent">Default</Badge>}
                        </div>
                        <div className="font-mono text-[10px] text-fg-subtle break-all">
                          {outfit.promptTokens.join(", ") || outfit.description}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDeleteOutfit(outfit.id)}
                      >
                        <Trash2 className="w-3.5 h-3.5 text-danger" />
                      </Button>
                    </div>
                  ))}
                  {outfits.length === 0 && !addingOutfit && (
                    <div className="text-center py-6 text-fg-subtle text-xs">
                      No outfits defined yet. Add custom outfits to easily switch character wardrobe in Creation Studio.
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t border-border">
              <Button variant="primary" loading={savingDna} onClick={handleSaveDna}>
                Save Identity DNA
              </Button>
            </div>
          </div>
        )}

        {/* WORKSPACE 3: VISUAL MEMORY (REFERENCES) */}
        {activeTab === "references" && (
          <div className="space-y-4 animate-fadeIn">
            {/* Filter Pills */}
            <div className="flex flex-wrap items-center gap-1.5 border-b border-border/50 pb-2">
              <span className="text-[10px] font-mono uppercase tracking-wider text-label mr-1">Filter:</span>
              {["ALL", "canonical_face", "front_view", "three_quarter", "full_body", "expression", "pose", "clothing_variant", "approved_artwork"].map((cat) => (
                <button
                  key={cat}
                  onClick={() => setRefCategoryFilter(cat)}
                  className={`px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider border transition-all ${
                    refCategoryFilter === cat
                      ? "bg-accent text-white border-accent font-bold"
                      : "bg-surface-subtle text-fg-subtle border-border hover:text-fg"
                  }`}
                >
                  {cat === "ALL" ? "All References" : CHARACTER_REFERENCE_CATEGORY_LABELS[cat as CharacterReferenceCategory]}
                </button>
              ))}

              <div className="ml-auto flex items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  loading={autoTagging}
                  onClick={handleAutoTagAll}
                  disabled={charData.references.length === 0}
                  title="Interrogate and extract tags across all reference images"
                >
                  <Wand2 className="w-3.5 h-3.5 text-accent" />
                  Auto-Tag All References
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={async () => {
                    const updated = await onPickReference(charData.id, "secondary");
                    if (updated) setCharData(updated);
                  }}
                >
                  <ImagePlus className="w-3.5 h-3.5" />
                  Add Reference Image
                </Button>
              </div>
            </div>

            {/* Auto-tagging progress banner */}
            {taggingProgress && (
              <div className="p-2 border-2 border-accent bg-accent/10 flex items-center justify-between text-xs font-mono">
                <div className="flex items-center gap-2">
                  <RefreshCw className="w-3.5 h-3.5 text-accent animate-spin" />
                  <span>Vision Interrogation: Analyzing reference {taggingProgress.current} of {taggingProgress.total}...</span>
                </div>
                <div className="w-36 h-2 bg-bg border border-accent/40 overflow-hidden">
                  <div
                    className="h-full bg-accent transition-all duration-300"
                    style={{ width: `${Math.round((taggingProgress.current / Math.max(1, taggingProgress.total)) * 100)}%` }}
                  />
                </div>
              </div>
            )}

            {/* Vision model status notice */}
            {visionModelStatus && !visionModelStatus.available && (
              <div className="p-2.5 border-2 border-border/80 bg-surface-subtle flex items-start gap-2.5 text-xs">
                <Info className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <div className="font-bold text-fg flex items-center gap-2">
                    <span>Vision Engine: Local Visual Heuristics Active</span>
                    <Badge tone="neutral">Neural Tagger Optional</Badge>
                  </div>
                  <p className="text-[11px] text-fg-subtle leading-relaxed">
                    {visionModelStatus.instructionMessage}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto shrink-0 text-[10px]"
                  onClick={() => window.kirea.getVisionModelStatus().then(setVisionModelStatus)}
                >
                  <RefreshCw className="w-3 h-3" /> Re-check
                </Button>
              </div>
            )}

            {/* Reference Gallery Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 max-h-[500px] overflow-y-auto p-1">
              {visibleReferences.map((ref) => {
                const approvalTone =
                  ref.approvalStatus === "approved"
                    ? "accent"
                    : ref.approvalStatus === "rejected"
                    ? "danger"
                    : "neutral";
                return (
                  <div
                    key={ref.id}
                    className="border-2 border-border bg-bg flex flex-col overflow-hidden relative group"
                  >
                    <div className="aspect-square bg-surface-subtle overflow-hidden relative">
                      <img
                        src={toMediaUrl(ref.filePath)}
                        alt={ref.caption || "Reference"}
                        className="w-full h-full object-contain"
                      />
                      <div className="absolute top-1.5 left-1.5 flex flex-col gap-1">
                        <Badge tone={ref.role === "primary" ? "accent" : "neutral"}>
                          {ref.role}
                        </Badge>
                        <Badge tone={approvalTone}>
                          {CHARACTER_REFERENCE_APPROVAL_LABELS[ref.approvalStatus || "approved"]}
                        </Badge>
                      </div>
                    </div>

                    <div className="p-2 space-y-1.5 text-xs flex-1 flex flex-col">
                      <Select
                        className="h-7 text-[10px] font-mono"
                        value={ref.category || "canonical_face"}
                        onChange={async (e) => {
                          const cat = e.target.value as CharacterReferenceCategory;
                          const res = await onUpdateReference(charData.id, ref.id, { category: cat });
                          if (res) setCharData(res);
                        }}
                      >
                        {Object.keys(CHARACTER_REFERENCE_CATEGORY_LABELS).map((cKey) => (
                          <option key={cKey} value={cKey}>
                            {CHARACTER_REFERENCE_CATEGORY_LABELS[cKey as CharacterReferenceCategory]}
                          </option>
                        ))}
                      </Select>

                      <Input
                        defaultValue={ref.caption}
                        placeholder="Caption description..."
                        className="h-6 text-[10px]"
                        onBlur={async (e) => {
                          const res = await onUpdateReference(charData.id, ref.id, { caption: e.target.value });
                          if (res) setCharData(res);
                        }}
                      />

                      {/* Vision Tags Preview */}
                      <div className="py-1 border-t border-border/40 mt-1">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[9px] font-mono uppercase text-fg-subtle">
                            Tags ({ref.suggestedTags?.length ?? 0})
                          </span>
                          <button
                            onClick={() => setSelectedTagRef(ref)}
                            className="text-[10px] font-mono text-accent hover:underline flex items-center gap-0.5"
                          >
                            <Sliders className="w-2.5 h-2.5" />
                            Manage
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-1 max-h-12 overflow-hidden">
                          {(ref.suggestedTags ?? []).slice(0, 3).map((vt) => (
                            <span
                              key={vt.id}
                              className={`px-1 py-0.5 text-[9px] font-mono border ${
                                vt.approvalStatus === "approved"
                                  ? "bg-accent/15 border-accent text-accent font-semibold"
                                  : vt.approvalStatus === "rejected"
                                  ? "bg-danger/10 border-danger/40 text-danger line-through"
                                  : "bg-surface-subtle border-border text-fg-subtle"
                              }`}
                            >
                              {vt.tag}
                            </span>
                          ))}
                          {(ref.suggestedTags?.length ?? 0) === 0 && (
                            <span className="text-[9px] text-fg-subtle italic">No tags yet</span>
                          )}
                        </div>
                      </div>

                      <div className="mt-auto pt-1.5 border-t border-border flex items-center justify-between">
                        <button
                          onClick={() => setCropTarget(ref)}
                          className="flex items-center gap-1 text-[10px] font-mono text-accent hover:underline"
                          title="Split / Crop turnaround sheet"
                        >
                          <Scissors className="w-3 h-3" />
                          Crop Sheet
                        </button>

                        <button
                          onClick={async () => {
                            const res = await onRemoveReference(charData.id, ref.id);
                            if (res) setCharData(res);
                          }}
                          className="text-danger hover:opacity-80 p-1"
                          title="Remove reference"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {charData.references.length === 0 && (
              <div className="text-center py-12 border-2 border-dashed border-border bg-surface-subtle p-6 space-y-2">
                <ImagePlus className="w-8 h-8 text-fg-subtle mx-auto" />
                <h4 className="text-sm font-bold text-fg">No references yet</h4>
                <p className="text-xs text-fg-muted max-w-md mx-auto">
                  Add full body sheets, turnaround angles, or expression portraits to build a rich visual memory for LoRA training and image conditioning.
                </p>
              </div>
            )}
          </div>
        )}

        {/* WORKSPACE 4: TRAINING & DATASET BUILDER */}
        {activeTab === "training" && (
          <div className="space-y-4 animate-fadeIn">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Dataset Builder Section */}
              <div className="p-4 border-2 border-border bg-bg space-y-3">
                <div className="flex items-center justify-between border-b border-border/50 pb-2">
                  <span className="font-mono text-xs font-bold uppercase tracking-wider text-fg flex items-center gap-1.5">
                    <Database className="w-3.5 h-3.5 text-accent" /> Dataset Preparation
                  </span>
                  <div className="flex items-center gap-1.5">
                    <Button size="sm" variant="secondary" loading={loadingValidation} onClick={handleRunValidation}>
                      <RefreshCw className="w-3 h-3" />
                      Validate
                    </Button>
                    <Button size="sm" variant="ghost" loading={exportingDataset} onClick={handleExportDataset}>
                      <Download className="w-3 h-3" />
                      Export
                    </Button>
                  </div>
                </div>

                {datasetReport ? (
                  <div className="space-y-2 text-xs">
                    <div className="grid grid-cols-2 gap-2 p-2 border border-border bg-surface-subtle font-mono text-[11px]">
                      <div>Total Images: <b>{datasetReport.totalImages}</b></div>
                      <div>Approved: <b>{datasetReport.selectedImages}</b></div>
                      <div>Caption Coverage: <b>{datasetReport.captionCoveragePercent}%</b></div>
                      <div>Quality Status: <b className={datasetReport.isValid ? "text-accent" : "text-warning"}>{datasetReport.isValid ? "READY" : "INSUFFICIENT"}</b></div>
                    </div>

                    {datasetReport.warnings.length > 0 && (
                      <div className="p-2 border border-warning/40 bg-warning/10 text-warning text-[11px] space-y-1">
                        {datasetReport.warnings.map((w, idx) => (
                          <div key={idx}>⚠ {w}</div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-xs text-fg-muted leading-relaxed">
                    Click <b>Validate</b> to analyze your attached references, check category balance, verify aspect ratios, and generate structured captions for training.
                  </div>
                )}

                {/* Registered Adapters */}
                <div className="pt-2 border-t border-border space-y-2">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-label block">
                    Registered Visual Adapters ({adapters.length})
                  </span>
                  <div className="space-y-1.5 max-h-[160px] overflow-y-auto">
                    {adapters.map((a) => (
                      <div key={a.id} className="p-2 border border-border bg-surface-subtle flex items-center justify-between text-xs">
                        <div className="font-mono">
                          <span className="font-bold text-accent">[{a.baseModelFamily.toUpperCase()}]</span> {a.triggerToken}
                          <div className="text-[10px] text-fg-subtle truncate max-w-xs">{a.fileLocation}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono">{a.recommendedStrength} str</span>
                          <button onClick={() => handleDeleteAdapter(a.id)} className="text-danger hover:opacity-80">
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                    {adapters.length === 0 && (
                      <span className="text-[11px] text-fg-subtle block">No visual adapters created yet.</span>
                    )}
                  </div>
                </div>
              </div>

              {/* LoRA Training Studio Section */}
              <div className="p-4 border-2 border-border bg-bg space-y-3">
                <div className="flex items-center justify-between border-b border-border/50 pb-2">
                  <span className="font-mono text-xs font-bold uppercase tracking-wider text-fg flex items-center gap-1.5">
                    <Cpu className="w-3.5 h-3.5 text-accent" /> Local LoRA Training
                  </span>
                  <Button size="sm" variant="secondary" loading={checkingPreflight} onClick={handleRunPreflight}>
                    Preflight Check
                  </Button>
                </div>

                {preflight && (
                  <div className="p-2 border border-border bg-surface-subtle font-mono text-[11px] space-y-1">
                    <div>GPU: <b>{preflight.gpuName}</b> ({Math.round(preflight.vramTotalMB / 1024)}GB VRAM)</div>
                    <div>Backend: <b className="text-accent">Python PyTorch CUDA ({preflight.cudaAvailable ? "Ready" : "Missing"})</b></div>
                    <div>Free Disk: <b>{preflight.diskFreeGB} GB</b></div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <label className="text-[10px] font-mono text-fg-subtle block uppercase">Base Architecture</label>
                    <Select
                      value={trainConfig.baseModelFamily}
                      onChange={(e) => setTrainConfig((p) => ({ ...p, baseModelFamily: e.target.value }))}
                      className="h-8 text-xs font-mono"
                    >
                      <option value="illustrious">Illustrious XL</option>
                      <option value="sdxl">SDXL 1.0</option>
                      <option value="pony">Pony Diffusion</option>
                    </Select>
                  </div>
                  <div>
                    <label className="text-[10px] font-mono text-fg-subtle block uppercase">Epochs</label>
                    <Input
                      type="number"
                      value={trainConfig.epochs}
                      onChange={(e) => setTrainConfig((p) => ({ ...p, epochs: Number(e.target.value) }))}
                      className="h-8 text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-mono text-fg-subtle block uppercase">Rank / Alpha</label>
                    <Input
                      value={`${trainConfig.rank} / ${trainConfig.alpha}`}
                      disabled
                      className="h-8 text-xs font-mono opacity-80"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-mono text-fg-subtle block uppercase">Resolution</label>
                    <Input
                      value={trainConfig.resolution}
                      onChange={(e) => setTrainConfig((p) => ({ ...p, resolution: Number(e.target.value) }))}
                      className="h-8 text-xs font-mono"
                    />
                  </div>
                </div>

                {/* Training Actions & Checkpoint Status */}
                <div className="pt-2 flex flex-wrap items-center justify-between border-t border-border gap-2">
                  <div className="flex items-center gap-2">
                    {activeJob?.status === "RUNNING" ? (
                      <Button variant="danger" size="sm" onClick={handleCancelTraining}>
                        <StopCircle className="w-3.5 h-3.5" />
                        Cancel Training
                      </Button>
                    ) : (
                      <Button
                        variant="accent"
                        size="sm"
                        onClick={handleStartTraining}
                        loading={startingTraining}
                        disabled={charData.references.length < 2 || activeJob?.status === "QUEUED"}
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        Start Local LoRA Training
                      </Button>
                    )}
                    {activeJob && (
                      <Badge tone={activeJob.status === "RUNNING" ? "accent" : activeJob.status === "COMPLETED" ? "accent" : "warning"}>
                        {activeJob.status}
                      </Badge>
                    )}
                  </div>
                  {activeJob?.outputAdapterPath && (
                    <div className="text-[10px] font-mono text-fg-subtle truncate max-w-xs">
                      Saved: <b>{activeJob.outputAdapterPath.split(/[/\\]/).pop()}</b>
                    </div>
                  )}
                </div>

                {/* Real-time Telemetry Readout Grid */}
                {activeJob?.status === "RUNNING" && (
                  <div className="space-y-3 pt-2 border-t border-border/40">
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
                      <div className="p-2 border border-border bg-surface-subtle">
                        <span className="text-[9px] font-mono text-fg-subtle uppercase block">Step</span>
                        <span className="font-mono text-xs font-bold text-fg">
                          {activeJob.progressStep} / {activeJob.progressMax}
                        </span>
                        <div className="text-[9px] text-accent font-mono">
                          {Math.round((activeJob.progressStep / Math.max(1, activeJob.progressMax)) * 100)}%
                        </div>
                      </div>

                      <div className="p-2 border border-border bg-surface-subtle">
                        <span className="text-[9px] font-mono text-fg-subtle uppercase block">Epoch</span>
                        <span className="font-mono text-xs font-bold text-fg">
                          {activeJob.currentEpoch ?? 1} / {activeJob.totalEpochs ?? trainConfig.epochs}
                        </span>
                      </div>

                      <div className="p-2 border border-border bg-surface-subtle">
                        <span className="text-[9px] font-mono text-fg-subtle uppercase block">Current Loss</span>
                        <span className="font-mono text-xs font-bold text-fg">
                          {telemetry?.loss?.toFixed(4) ?? activeJob.loss?.toFixed(4) ?? "..."}
                        </span>
                      </div>

                      <div className="p-2 border border-border bg-surface-subtle">
                        <span className="text-[9px] font-mono text-accent uppercase block">Smoothed EMA</span>
                        <span className="font-mono text-xs font-bold text-accent">
                          {telemetry?.smoothedLoss?.toFixed(4) ?? "..."}
                        </span>
                      </div>

                      <div className="p-2 border border-border bg-surface-subtle">
                        <span className="text-[9px] font-mono text-fg-subtle uppercase block">Learning Rate</span>
                        <span className="font-mono text-xs font-bold text-fg">
                          {telemetry?.learningRate ?? trainConfig.learningRate}
                        </span>
                      </div>

                      <div className="p-2 border border-border bg-surface-subtle">
                        <span className="text-[9px] font-mono text-fg-subtle uppercase block">Est. Remaining</span>
                        <span className="font-mono text-xs font-bold text-fg flex items-center gap-1">
                          <Clock className="w-3 h-3 text-fg-subtle" />
                          {formatRemainingMs(telemetry?.estimatedRemainingMs)}
                        </span>
                      </div>
                    </div>

                    {/* Live Progress Bar */}
                    <div className="w-full h-2 bg-surface-subtle border border-border overflow-hidden">
                      <div
                        className="h-full bg-accent transition-all duration-300"
                        style={{
                          width: `${Math.round(
                            (activeJob.progressStep / Math.max(1, activeJob.progressMax)) * 100
                          )}%`,
                        }}
                      />
                    </div>

                    {/* SVG Live Loss Graph */}
                    <LiveLossGraph telemetry={telemetry} activeJob={activeJob} />
                  </div>
                )}
              </div>
            </div>

            {/* Live Monospace Training Logs Terminal */}
            <div className="border-2 border-border bg-[#0B0C10] p-3 space-y-2">
              <div className="flex items-center justify-between text-xs font-mono text-[#F2F2EE]/70 border-b border-border/40 pb-1">
                <span className="flex items-center gap-1.5">
                  <Terminal className="w-3.5 h-3.5 text-accent" /> Training Telemetry Stream
                </span>
                <span className="text-[10px]">{trainLogs.length} lines logged</span>
              </div>
              <div className="h-32 overflow-y-auto font-mono text-[11px] text-[#F2F2EE]/90 space-y-0.5 leading-relaxed">
                {trainLogs.length === 0 ? (
                  <span className="text-fg-subtle italic">No active training logs.</span>
                ) : (
                  trainLogs.map((line, idx) => (
                    <div key={idx} className="break-all">{line}</div>
                  ))
                )}
                <div ref={logsEndRef} />
              </div>
            </div>
          </div>
        )}

        {/* WORKSPACE 5: KNOWLEDGE & LORE */}
        {activeTab === "knowledge" && (
          <div className="space-y-4 animate-fadeIn">
            <div className="p-3 border-2 border-border bg-surface-subtle space-y-1">
              <h3 className="text-sm font-bold text-fg">Character Knowledge, Dialogue & Lore</h3>
              <p className="text-xs text-fg-muted">
                Structured persona information ready for prompt generation, dialogue injection, and future local RAG integration.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-mono uppercase tracking-wider text-fg-muted block">
                  Personality Traits & Disposition
                </label>
                <Textarea
                  rows={3}
                  value={personalityInput}
                  onChange={(e) => setPersonalityInput(e.target.value)}
                  placeholder="Stoic, analytical, fiercely loyal, dry sense of humor..."
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-mono uppercase tracking-wider text-fg-muted block">
                  Speech Style & Catchphrases
                </label>
                <Textarea
                  rows={3}
                  value={speechStyleInput}
                  onChange={(e) => setSpeechStyleInput(e.target.value)}
                  placeholder="Speaks in concise sentences, uses technological jargon, rarely raises voice..."
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-mono uppercase tracking-wider text-fg-muted block">
                  Background Lore & Origins
                </label>
                <Textarea
                  rows={4}
                  value={backgroundInput}
                  onChange={(e) => setBackgroundInput(e.target.value)}
                  placeholder="Born in the lower sectors of Neo-Kyoto, trained by the last ronin hacker syndicate..."
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-mono uppercase tracking-wider text-fg-muted block">
                  Worldbuilding & Cultural Notes
                </label>
                <Textarea
                  rows={4}
                  value={worldbuildingInput}
                  onChange={(e) => setWorldbuildingInput(e.target.value)}
                  placeholder="Operates in the Year 2184 under the shadow of the Megacorporate Council..."
                />
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t border-border">
              <Button variant="primary" loading={savingKnowledge} onClick={handleSaveKnowledge}>
                Save Knowledge & Lore
              </Button>
            </div>
          </div>
        )}

        {/* Footer Actions */}
        <div className="pt-3 border-t-2 border-border flex items-center justify-between">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              onClick={() => {
                onUseCharacter(charData);
                onClose();
              }}
            >
              <Wand2 className="w-3.5 h-3.5" />
              Use in Creation Studio
            </Button>
          </div>
        </div>
      </div>

      {/* Turnaround Sheet Crop Modal */}
      {cropTarget && (
        <CropReferenceModal
          open={Boolean(cropTarget)}
          onClose={() => setCropTarget(null)}
          characterId={charData.id}
          reference={cropTarget}
          onCropSuccess={(updated) => setCharData(updated)}
          onToast={onToast}
        />
      )}

      {/* Vision Tag Interrogation Modal */}
      {selectedTagRef && (
        <VisionTagModal
          open={Boolean(selectedTagRef)}
          onClose={() => setSelectedTagRef(null)}
          reference={selectedTagRef}
          characterId={charData.id}
          visionModelStatus={visionModelStatus}
          onUpdateTags={handleUpdateReferenceTags}
          onToast={onToast}
        />
      )}
    </Modal>
  );
};
