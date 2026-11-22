import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clapperboard,
  Download,
  Film,
  Heart,
  ImagePlus,
  Play,
  RefreshCw,
  Square,
  Trash2,
} from "lucide-react";
import {
  ASPECT_RATIOS,
  CUSTOM_ASPECT_ID,
  resolveVideoDimensions,
} from "../../shared/aspect-ratios";
import type {
  AppSettings,
  GeneratedVideoRecord,
  GenerationJob,
  GenerationRequest,
  GpuStats,
  ModelRecord,
  RuntimeState,
  ValidationIssue,
  VideoContainerFormat,
  WorkflowTemplate,
} from "../../shared/types";
import {
  formatDurationSeconds,
  formatFileSize,
  resolveVideoFrameCount,
  videoDurationOptions,
} from "../../shared/video-utils";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Input,
  SectionHeader,
  Select,
  SliderField,
  Textarea,
} from "../components/ui/Primitives";
import { getModelDisplayName } from "../../shared/model-utils";
import { toMediaUrl } from "../utils/format";

interface VideoStudioPageProps {
  workflows: WorkflowTemplate[];
  models: ModelRecord[];
  settings: AppSettings;
  runtime: RuntimeState;
  hardware: GpuStats | null;
  jobs: GenerationJob[];
  initialVideoId?: string;
  onFocusApplied?: () => void;
  onToast: (message: string, tone?: "info" | "error") => void;
}

const ACTIVE_STATUSES = new Set([
  "IDLE",
  "VALIDATING",
  "SUBMITTING",
  "QUEUED",
  "RUNNING",
  "PROCESSING_OUTPUT",
]);

function basename(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  return (normalized.split("/").pop() ?? normalized).toLowerCase();
}

const STATUS_LABEL: Record<string, string> = {
  IDLE: "Preparing",
  VALIDATING: "Validating",
  SUBMITTING: "Submitting",
  QUEUED: "Queued",
  RUNNING: "Rendering",
  PROCESSING_OUTPUT: "Saving video",
  COMPLETED: "Completed",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

export const VideoStudioPage: React.FC<VideoStudioPageProps> = ({
  workflows,
  models,
  settings,
  runtime,
  hardware,
  jobs,
  initialVideoId,
  onFocusApplied,
  onToast,
}) => {
  const videoWorkflows = useMemo(() => workflows.filter((wf) => wf.video), [workflows]);
  const [mode, setMode] = useState<"t2v" | "i2v">("t2v");
  const [workflowId, setWorkflowId] = useState("");

  const candidates = useMemo(
    () => videoWorkflows.filter((wf) => wf.mode === mode),
    [videoWorkflows, mode]
  );
  const wf = useMemo(
    () => candidates.find((c) => c.id === workflowId) ?? candidates[0] ?? null,
    [candidates, workflowId]
  );
  const spec = wf?.video ?? null;

  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState(
    "blurry, low quality, watermark, static, frozen frame, distorted anatomy"
  );
  const [checkpoint, setCheckpoint] = useState("");
  const [aspect, setAspect] = useState("16:9");
  const [customWidth, setCustomWidth] = useState(832);
  const [customHeight, setCustomHeight] = useState(480);
  const [durationSeconds, setDurationSeconds] = useState(2.06);
  const [format, setFormat] = useState<VideoContainerFormat>("mp4");
  const [seed, setSeed] = useState(42);
  const [randomSeed, setRandomSeed] = useState(true);
  const [steps, setSteps] = useState(30);
  const [cfg, setCfg] = useState(6);
  const [inputImagePath, setInputImagePath] = useState<string | null>(null);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const [videos, setVideos] = useState<GeneratedVideoRecord[]>([]);
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<GeneratedVideoRecord | null>(null);

  const compatibleModels = useMemo(
    () =>
      wf
        ? models.filter((m) => m.installed && m.compatibleWorkflows.includes(wf.id))
        : [],
    [models, wf]
  );

  useEffect(() => {
    if (!wf) return;
    setWorkflowId(wf.id);
    setAspect(wf.video?.presets[0]?.id ?? "16:9");
    const specNow = wf.video;
    setDurationSeconds(
      specNow ? Number((specNow.defaultFrameCount / specNow.fps).toFixed(2)) : 2
    );
    setFormat(specNow?.formats[0] ?? "mp4");
    setCustomWidth(wf.defaults.width);
    setCustomHeight(wf.defaults.height);
    setSteps(wf.defaults.steps);
    setCfg(wf.defaults.cfg);
    setIssues([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wf?.id]);

  useEffect(() => {
    if (!wf) return;
    if (!compatibleModels.some((m) => m.relativePath === checkpoint)) {
      setCheckpoint(compatibleModels[0]?.relativePath ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wf?.id, models]);

  useEffect(() => {
    let cancelled = false;
    void window.kirea.listVideos().then((list) => {
      if (cancelled) return;
      setVideos(list);
      const focus =
        initialVideoId && list.some((video) => video.id === initialVideoId)
          ? initialVideoId
          : null;
      setSelectedVideoId((prev) => focus ?? prev ?? list[0]?.id ?? null);
      if (focus) onFocusApplied?.();
    });
    const unsubscribe = window.kirea.onVideoCreated((video) => {
      setVideos((prev) => [video, ...prev.filter((v) => v.id !== video.id)]);
      setSelectedVideoId(video.id);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
    // The library focus is applied once when the studio opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resolved = spec ? resolveVideoFrameCount(durationSeconds, spec) : null;

  const dimensions = useMemo(() => {
    if (!wf) return null;
    const template =
      aspect === CUSTOM_ASPECT_ID
        ? {
            ...wf,
            defaults: { ...wf.defaults, width: customWidth, height: customHeight },
          }
        : wf;
    return resolveVideoDimensions(aspect, template);
  }, [wf, aspect, customWidth, customHeight]);

  const durationOptions = useMemo(() => (spec ? videoDurationOptions(spec) : []), [spec]);

  const aspectOptions = useMemo(() => {
    if (!spec) return [];
    const curated = spec.presets.map((preset) => ({
      id: preset.id,
      label: `${preset.id} · ${preset.width}×${preset.height}`,
      curated: true,
    }));
    const ids = new Set(curated.map((c) => c.id));
    const extra = ASPECT_RATIOS.filter((ratio) => !ids.has(ratio.id)).map((ratio) => ({
      id: ratio.id,
      label: ratio.label,
      curated: false,
    }));
    return [...curated, ...extra, { id: CUSTOM_ASPECT_ID, label: "Custom", curated: false }];
  }, [spec]);

  const companionStatus = useMemo(
    () =>
      (spec?.companionModels ?? []).map((requirement) => ({
        requirement,
        installed: models.some(
          (model) =>
            model.installed &&
            model.category === requirement.category &&
            basename(model.relativePath) === requirement.fileName.toLowerCase()
        ),
      })),
    [spec, models]
  );

  const vramMB = hardware?.vramTotalMB ?? 0;
  const vramTooLow = Boolean(spec && vramMB > 0 && vramMB < spec.minVramMB);
  const vramBelowRecommended = Boolean(
    spec && vramMB > 0 && vramMB >= spec.minVramMB && vramMB < spec.recommendedVramMB
  );

  const activeJob = useMemo(
    () =>
      jobs
        .filter((job) => job.mode === "t2v" || job.mode === "i2v")
        .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
        .find((job) => ACTIVE_STATUSES.has(job.status)) ?? null,
    [jobs]
  );

  const latestJob = useMemo(
    () =>
      jobs
        .filter((job) => job.mode === "t2v" || job.mode === "i2v")
        .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))[0] ?? null,
    [jobs]
  );

  const displayJob = activeJob ?? (latestJob?.status === "FAILED" ? latestJob : null);
  const selectedVideo =
    videos.find((video) => video.id === selectedVideoId) ?? videos[0] ?? null;

  const nativeModelMissing = compatibleModels.length === 0;
  const missingCompanions = companionStatus.filter((c) => !c.installed);

  const canSubmit =
    Boolean(wf) &&
    runtime.status === "connected" &&
    prompt.trim().length > 0 &&
    !nativeModelMissing &&
    (mode === "t2v" || Boolean(inputImagePath)) &&
    !vramTooLow &&
    !submitting;

  const buildRequest = useCallback((): GenerationRequest | null => {
    if (!wf || !spec || !dimensions || !resolved) return null;
    return {
      workflowId: wf.id,
      mode: wf.mode,
      prompt,
      negativePrompt,
      checkpoint,
      vae: null,
      loras: [],
      aspectRatio: aspect,
      width: dimensions.width,
      height: dimensions.height,
      steps,
      cfg,
      sampler: wf.defaults.sampler,
      scheduler: wf.defaults.scheduler,
      seed,
      randomSeed,
      batchCount: 1,
      batchSize: 1,
      outputFormat: settings.defaultOutputFormat,
      inputImagePath: mode === "i2v" ? inputImagePath : null,
      denoise: 1,
      video: {
        fps: spec.fps,
        frameCount: resolved.frameCount,
        durationSeconds: resolved.durationSeconds,
        format,
      },
    };
  }, [
    wf,
    spec,
    dimensions,
    resolved,
    prompt,
    negativePrompt,
    checkpoint,
    aspect,
    steps,
    cfg,
    seed,
    randomSeed,
    settings.defaultOutputFormat,
    mode,
    inputImagePath,
    format,
  ]);

  const handleGenerate = async (): Promise<void> => {
    const request = buildRequest();
    if (!request) return;
    setSubmitting(true);
    try {
      const validation = await window.kirea.validateJob(request);
      setIssues(validation);
      if (validation.some((issue) => issue.severity === "error")) {
        onToast("Resolve the blocking video validation issues first.", "error");
        return;
      }
      await window.kirea.submitJob(request);
      onToast("Video job queued.");
    } catch (err) {
      onToast(err instanceof Error ? err.message : "Could not submit video job.", "error");
    } finally {
      setSubmitting(false);
    }
  };

  const handlePickImage = async (): Promise<void> => {
    const picked = await window.kirea.pickImage();
    if (picked) setInputImagePath(picked);
  };

  const handleCancel = async (jobId: string): Promise<void> => {
    await window.kirea.cancelJob(jobId);
  };

  const handleToggleFavorite = async (video: GeneratedVideoRecord): Promise<void> => {
    const updated = await window.kirea.toggleVideoFavorite(video.id);
    if (updated) {
      setVideos((prev) => prev.map((v) => (v.id === updated.id ? updated : v)));
    }
  };

  const handleDelete = async (video: GeneratedVideoRecord): Promise<void> => {
    await window.kirea.deleteVideo(video.id);
    setVideos((prev) => prev.filter((v) => v.id !== video.id));
    setSelectedVideoId((prev) => (prev === video.id ? null : prev));
    onToast("Deleted video and sidecar metadata.");
  };

  const handleExport = async (video: GeneratedVideoRecord): Promise<void> => {
    const saved = await window.kirea.exportVideo(video.id);
    if (saved) onToast(`Exported to ${saved}`);
  };

  const activePercent = displayJob
    ? displayJob.progressMax > 0
      ? Math.min(100, (displayJob.progressStep / displayJob.progressMax) * 100)
      : 0
    : 0;

  return (
    <div className="space-y-6">
      <SectionHeader
        sticky
        title="Video Studio"
        subtitle="Local text-to-video and image-to-video through native ComfyUI video nodes. Aspect ratios and durations follow each model's validated grid instead of a fixed 16:9 frame."
        actions={
          <div className="flex items-center gap-2">
            <Badge tone={runtime.status === "connected" ? "success" : "warning"}>
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  runtime.status === "connected" ? "bg-success" : "bg-warning"
                }`}
              />
              {runtime.status === "connected"
                ? `ComfyUI v${runtime.comfyVersion ?? "connected"}`
                : "ComfyUI offline"}
            </Badge>
            <Badge tone="accent">{videoWorkflows.length} video workflows</Badge>
          </div>
        }
      />

      <div className="inline-flex rounded-lg border border-border bg-surface p-0.5" role="tablist">
        {(
          [
            { id: "t2v" as const, label: "Text to Video" },
            { id: "i2v" as const, label: "Image to Video" },
          ]
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={mode === tab.id}
            onClick={() => setMode(tab.id)}
            className={`h-7 px-3.5 rounded-md text-xs font-semibold transition-colors ${
              mode === tab.id
                ? "bg-sand text-sand-fg"
                : "text-fg-muted hover:text-fg hover:bg-surface-subtle"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,430px)_minmax(0,1fr)] gap-5 items-start">
        {/* CONTROL COLUMN */}
        <div className="space-y-4">
          <Card className="p-4 space-y-4">
            <div className="space-y-2">
              <div className="label-mono text-label">Workflow</div>
              <Select
                value={wf?.id ?? ""}
                onChange={(e) => setWorkflowId(e.target.value)}
                disabled={candidates.length <= 1}
                aria-label="Video workflow"
              >
                {candidates.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
              </Select>
              {wf && <p className="text-small text-fg-muted leading-relaxed">{wf.description}</p>}
            </div>

            <div className="space-y-2">
              <div className="label-mono text-label">
                {spec?.family === "wan21_t2v"
                  ? "Wan diffusion model"
                  : "LTX-Video checkpoint"}
              </div>
              {compatibleModels.length > 0 ? (
                <Select
                  value={checkpoint}
                  onChange={(e) => setCheckpoint(e.target.value)}
                  aria-label="Video model"
                >
                  {compatibleModels.map((model) => (
                    <option key={model.id} value={model.relativePath}>
                      {getModelDisplayName(model)}
                    </option>
                  ))}
                </Select>
              ) : (
                <div className="rounded-lg border border-warning/30 bg-warning-soft p-3 space-y-1">
                  <div className="flex items-center gap-1.5 text-small font-semibold text-warning">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    No compatible video model found
                  </div>
                  <p className="text-small text-fg-muted leading-relaxed">
                    {spec?.family === "wan21_t2v"
                      ? "Place the Wan 2.1 1.3B T2V diffusion model (e.g. wan2.1_t2v_1.3B_fp16.safetensors) in ComfyUI/models/diffusion_models, then rescan Models."
                      : "Place an LTX-Video 2B checkpoint (e.g. ltx-video-2b-v0.9.5.safetensors) in ComfyUI/models/checkpoints, then rescan Models."}
                  </p>
                </div>
              )}
            </div>

            {mode === "i2v" && (
              <div className="space-y-2">
                <div className="label-mono text-label">Source image</div>
                {inputImagePath ? (
                  <div className="flex items-center gap-3 rounded-lg border border-border bg-bg p-2">
                    <img
                      src={toMediaUrl(inputImagePath)}
                      alt="Image-to-video source"
                      className="w-16 h-16 rounded-md object-contain object-center bg-surface-subtle p-0.5"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-small font-medium text-fg truncate">
                        {inputImagePath.split(/[\\/]/).pop()}
                      </div>
                      <div className="text-[11px] text-fg-subtle">
                        Resized to the output frame with Lanczos
                      </div>
                    </div>
                    <Button size="sm" variant="secondary" onClick={() => void handlePickImage()}>
                      Replace
                    </Button>
                  </div>
                ) : (
                  <Button variant="secondary" size="md" onClick={() => void handlePickImage()}>
                    <ImagePlus className="w-3.5 h-3.5" />
                    Choose image
                  </Button>
                )}
              </div>
            )}

            <div className="space-y-2">
              <div className="label-mono text-label">Prompt</div>
              <Textarea
                rows={5}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe subject, motion, camera movement and lighting…"
              />
              <Textarea
                rows={2}
                value={negativePrompt}
                onChange={(e) => setNegativePrompt(e.target.value)}
                placeholder="Negative prompt"
                className="text-[11px]"
              />
            </div>

            <div className="grid grid-cols-2 gap-3 border-t border-border pt-4">
              <div className="space-y-1.5">
                <div className="label-mono text-label">Duration</div>
                <Select
                  value={durationSeconds}
                  onChange={(e) => setDurationSeconds(Number(e.target.value))}
                  aria-label="Video duration"
                >
                  {durationOptions.map((duration) => {
                    const frames = spec ? Math.round(duration * spec.fps) : 0;
                    return (
                      <option key={duration} value={duration}>
                        {formatDurationSeconds(duration)} · {frames}f
                      </option>
                    );
                  })}
                </Select>
              </div>
              <div className="space-y-1.5">
                <div className="label-mono text-label">Frame rate</div>
                <div className="h-8 flex items-center gap-2 px-2.5 rounded-md border border-border bg-surface-subtle">
                  <span className="font-mono text-tech text-fg">{spec?.fps ?? 0} fps</span>
                  <span className="text-[10px] text-fg-subtle">fixed</span>
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="label-mono text-label">Container</div>
                <Select
                  value={format}
                  onChange={(e) => setFormat(e.target.value as VideoContainerFormat)}
                  aria-label="Video container"
                >
                  {(spec?.formats ?? ["mp4"]).map((container) => (
                    <option key={container} value={container}>
                      {container.toUpperCase()}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <div className="label-mono text-label">Seed</div>
                <div className="flex items-center gap-1.5">
                  <Input
                    type="number"
                    value={seed}
                    min={0}
                    max={4294967295}
                    disabled={randomSeed}
                    onChange={(e) => setSeed(Number(e.target.value))}
                  />
                  <Button
                    size="sm"
                    variant={randomSeed ? "accent" : "secondary"}
                    onClick={() => setRandomSeed((value) => !value)}
                    title="Randomize seed"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            </div>

            <div className="space-y-3 border-t border-border pt-4">
              <div className="flex items-center justify-between">
                <div className="label-mono text-label">Frame</div>
                <Badge tone={dimensions?.validated ? "success" : "warning"}>
                  {dimensions?.validated ? "Model-validated" : "Fitted to grid"}
                </Badge>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {aspectOptions.map((option) => (
                  <Button
                    key={option.id}
                    size="sm"
                    variant={aspect === option.id ? "primary" : "secondary"}
                    onClick={() => setAspect(option.id)}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
              {aspect === CUSTOM_ASPECT_ID && (
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    type="number"
                    value={customWidth}
                    min={wf?.minDim ?? 256}
                    max={wf?.maxDim ?? 1280}
                    onChange={(e) => setCustomWidth(Number(e.target.value))}
                    aria-label="Custom width"
                  />
                  <Input
                    type="number"
                    value={customHeight}
                    min={wf?.minDim ?? 256}
                    max={wf?.maxDim ?? 1280}
                    onChange={(e) => setCustomHeight(Number(e.target.value))}
                    aria-label="Custom height"
                  />
                </div>
              )}
              {dimensions && (
                <div className="rounded-lg border border-border bg-bg p-2.5 space-y-1">
                  <div className="font-mono text-tech text-fg">
                    {dimensions.width}×{dimensions.height} ·{" "}
                    {formatDurationSeconds(resolved?.durationSeconds ?? 0)} ·{" "}
                    {resolved?.frameCount ?? 0} frames
                  </div>
                  {dimensions.notes.map((note) => (
                    <p key={note} className="text-[11px] text-fg-subtle leading-relaxed">
                      {note}
                    </p>
                  ))}
                  {resolved?.snapped && !dimensions.notes.length && (
                    <p className="text-[11px] text-fg-subtle leading-relaxed">
                      Duration snapped to the {spec?.frameStep}-frame stride required by this
                      model.
                    </p>
                  )}
                </div>
              )}
            </div>

            <details className="border-t border-border pt-3">
              <summary className="label-mono text-label cursor-pointer select-none">
                Advanced sampling
              </summary>
              <div className="mt-3 space-y-3">
                <SliderField
                  label="Steps"
                  value={steps}
                  min={4}
                  max={60}
                  step={1}
                  onChange={setSteps}
                />
                <SliderField
                  label="CFG"
                  value={cfg}
                  min={1}
                  max={12}
                  step={0.5}
                  onChange={setCfg}
                />
                <p className="text-[11px] text-fg-subtle">
                  Sampler {wf?.defaults.sampler ?? "—"} · Scheduler{" "}
                  {wf?.defaults.scheduler ?? "—"} (fixed by the workflow)
                </p>
              </div>
            </details>
          </Card>

          <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="label-mono text-label">Readiness</div>
              <Badge
                tone={
                  nativeModelMissing || missingCompanions.length > 0 || vramTooLow
                    ? "danger"
                    : vramBelowRecommended
                      ? "warning"
                      : "success"
                }
              >
                {nativeModelMissing || missingCompanions.length > 0 || vramTooLow
                  ? "Action needed"
                  : vramBelowRecommended
                    ? "Tight VRAM"
                    : "Ready"}
              </Badge>
            </div>

            <div className="space-y-2">
              {(spec?.companionModels ?? []).map((requirement) => {
                const installed = companionStatus.find(
                  (c) => c.requirement.fileName === requirement.fileName
                )?.installed;
                return (
                  <div key={requirement.fileName} className="flex items-start gap-2">
                    {installed ? (
                      <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 text-success shrink-0" />
                    ) : (
                      <AlertTriangle className="w-3.5 h-3.5 mt-0.5 text-warning shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="text-small text-fg">{requirement.label}</div>
                      <div className="font-mono text-[10px] text-fg-subtle break-all">
                        {requirement.fileName} · ~{requirement.approxSizeGB} GB ·{" "}
                        {requirement.category === "text_encoder"
                          ? "text_encoders"
                          : requirement.category}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {spec && (
              <div className="border-t border-border pt-2 text-[11px] text-fg-muted leading-relaxed">
                VRAM: minimum {Math.round(spec.minVramMB / 1024)} GB, recommended{" "}
                {Math.round(spec.recommendedVramMB / 1024)} GB
                {vramMB > 0
                  ? ` (detected ${Math.round(vramMB / 1024)} GB)`
                  : " (no GPU telemetry)"}
                . {spec.notes}
              </div>
            )}
          </Card>

          {issues.length > 0 && (
            <Card className="p-3 space-y-1.5">
              {issues.map((issue, index) => (
                <div
                  key={`${issue.field}-${index}`}
                  className={`flex items-start gap-2 text-small ${
                    issue.severity === "error" ? "text-danger" : "text-warning"
                  }`}
                >
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>{issue.message}</span>
                </div>
              ))}
            </Card>
          )}

          <Button
            variant="accent"
            size="lg"
            className="w-full"
            disabled={!canSubmit}
            loading={submitting}
            onClick={() => void handleGenerate()}
          >
            <Clapperboard className="w-4 h-4" />
            Generate video
          </Button>
          {runtime.status !== "connected" && (
            <p className="text-[11px] text-fg-subtle text-center">
              Connect or start ComfyUI to render.
            </p>
          )}
        </div>

        {/* PREVIEW & HISTORY */}
        <div className="space-y-4 min-w-0">
          {displayJob && (
            <Card className="p-4 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Badge
                    tone={
                      displayJob.status === "FAILED"
                        ? "danger"
                        : displayJob.status === "COMPLETED"
                          ? "success"
                          : "accent"
                    }
                  >
                    {STATUS_LABEL[displayJob.status] ?? displayJob.status}
                  </Badge>
                  <span className="font-mono text-[11px] text-fg-subtle">
                    {displayJob.workflowId} · {displayJob.settings.width}×
                    {displayJob.settings.height}
                  </span>
                </div>
                {ACTIVE_STATUSES.has(displayJob.status) && (
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => void handleCancel(displayJob.id)}
                  >
                    <Square className="w-3 h-3" />
                    Cancel
                  </Button>
                )}
              </div>
              {ACTIVE_STATUSES.has(displayJob.status) && (
                <>
                  <div className="h-1.5 bg-surface-subtle rounded-full overflow-hidden">
                    <div
                      className="h-full bg-accent rounded-full transition-[width] duration-300 ease-out"
                      style={{ width: `${activePercent}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between font-mono text-[11px] text-fg-subtle">
                    <span>
                      {displayJob.currentNode ?? "Waiting for ComfyUI…"}
                    </span>
                    <span className="tabular-nums">
                      {displayJob.progressStep}/{displayJob.progressMax}
                    </span>
                  </div>
                </>
              )}
              {displayJob.status === "FAILED" && displayJob.errorMessage && (
                <p className="text-small text-danger leading-relaxed">
                  {displayJob.errorMessage}
                </p>
              )}
            </Card>
          )}

          <Card className="overflow-hidden">
            {selectedVideo ? (
              <div className="space-y-3 p-4">
                <div className="rounded-lg bg-black overflow-hidden flex items-center justify-center">
                  <video
                    key={selectedVideo.id}
                    src={toMediaUrl(selectedVideo.filePath)}
                    controls
                    loop
                    playsInline
                    className="w-full max-h-[60vh] object-contain"
                  />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="neutral">{selectedVideo.container.toUpperCase()}</Badge>
                    <span className="font-mono text-[11px] text-fg-muted">
                      {selectedVideo.width}×{selectedVideo.height} ·{" "}
                      {formatDurationSeconds(selectedVideo.durationSeconds)} ·{" "}
                      {selectedVideo.fps} fps · {selectedVideo.frameCount} frames
                    </span>
                    <span className="font-mono text-[11px] text-fg-subtle">
                      {formatFileSize(selectedVideo.sizeBytes)} · seed {selectedVideo.seed}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button
                      size="sm"
                      variant={selectedVideo.favorite ? "primary" : "secondary"}
                      onClick={() => void handleToggleFavorite(selectedVideo)}
                      title="Favorite"
                    >
                      <Heart
                        className={`w-3.5 h-3.5 ${
                          selectedVideo.favorite ? "fill-current" : ""
                        }`}
                      />
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void handleExport(selectedVideo)}
                    >
                      <Download className="w-3.5 h-3.5" />
                      Export
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => setPendingDelete(selectedVideo)}
                      title="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
                <p className="text-small text-fg-muted leading-relaxed line-clamp-3">
                  {selectedVideo.prompt}
                </p>
              </div>
            ) : (
              <div className="p-4">
                <EmptyState
                  icon={<Film />}
                  title="No generated videos yet"
                  description="Video renders appear here with their exact frame, seed and duration metadata. Nothing is cropped to a fixed preview container."
                />
              </div>
            )}
          </Card>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="label-mono text-label">Video history</div>
              <span className="font-mono text-[11px] text-fg-subtle">
                {videos.length} saved
              </span>
            </div>
            {videos.length > 0 ? (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {videos.slice(0, 12).map((video) => (
                  <button
                    key={video.id}
                    type="button"
                    onClick={() => setSelectedVideoId(video.id)}
                    className={`group relative text-left rounded-lg overflow-hidden border transition-colors ${
                      selectedVideo?.id === video.id
                        ? "border-accent"
                        : "border-border hover:border-border-strong"
                    }`}
                  >
                    <div className="bg-black flex items-center justify-center" style={{ aspectRatio: `${video.width}/${video.height}` }}>
                      <video
                        src={`${toMediaUrl(video.filePath)}#t=0.1`}
                        preload="metadata"
                        muted
                        className="w-full h-full object-contain object-center"
                      />
                    </div>
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/35">
                      <Play className="w-6 h-6 text-white" />
                    </div>
                    <div className="p-2 space-y-0.5 bg-surface">
                      <div className="font-mono text-[10px] text-fg-muted tabular-nums">
                        {video.width}×{video.height} · {formatDurationSeconds(video.durationSeconds)}
                      </div>
                      <div className="text-[11px] text-fg-subtle truncate">
                        {video.prompt || video.fileName}
                      </div>
                    </div>
                    {video.favorite && (
                      <Heart className="absolute top-1.5 right-1.5 w-3.5 h-3.5 text-white fill-current drop-shadow" />
                    )}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-small text-fg-subtle">
                Completed videos are stored in your output folder with a JSON metadata sidecar.
              </p>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) void handleDelete(pendingDelete);
        }}
        title="Delete generated video"
        description="This removes the video file and its metadata sidecar from the output folder. This cannot be undone."
        confirmLabel="Delete video"
      />
    </div>
  );
};
