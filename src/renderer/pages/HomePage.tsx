import React from "react";
import {
  ArrowRight,
  Eye,
  EyeOff,
  FolderOpen,
  Image as ImageIcon,
  Sparkles,
  Wand2,
} from "lucide-react";
import { STUDIO_PRESETS } from "../../shared/presets";
import type {
  DownloadTask,
  GeneratedImageRecord,
  GenerationJob,
  GpuStats,
  JobLifecycleState,
  ModelRecord,
  NavSection,
  RuntimeState,
  StudioPreset,
} from "../../shared/types";
import { Button, EmptyState } from "../components/ui/Primitives";
import { MediaImage } from "../components/ui/MediaImage";
import {
  formatBytes,
  formatRelativeTime,
  shortModelLabel,
  toMediaUrl,
} from "../utils/format";

const BLUR_THUMBS_KEY = "kirea.home.blurThumbnails";

function readBlurPreference(): boolean {
  try {
    return window.localStorage.getItem(BLUR_THUMBS_KEY) === "1";
  } catch {
    return false;
  }
}

const JOB_ACTIVITY: Record<JobLifecycleState, { label: string; dot: string }> = {
  IDLE: { label: "Idle", dot: "bg-fg-subtle" },
  VALIDATING: { label: "Validating", dot: "bg-warning" },
  SUBMITTING: { label: "Submitting graph", dot: "bg-accent" },
  QUEUED: { label: "Queued", dot: "bg-warning" },
  RUNNING: { label: "Sampling", dot: "bg-accent" },
  PROCESSING_OUTPUT: { label: "Finalizing", dot: "bg-accent" },
  COMPLETED: { label: "Completed", dot: "bg-success" },
  FAILED: { label: "Failed", dot: "bg-danger" },
  CANCELLED: { label: "Cancelled", dot: "bg-fg-subtle" },
};

const gigabyte = (mb: number) => `${(mb / 1024).toFixed(1)}`;

interface HomePageProps {
  runtime: RuntimeState;
  hardware: GpuStats | null;
  models: ModelRecord[];
  images: GeneratedImageRecord[];
  jobs: GenerationJob[];
  downloads: DownloadTask[];
  onNavigate: (page: NavSection) => void;
  onApplyPreset: (preset: StudioPreset) => void;
  onInspectImage: (img: GeneratedImageRecord) => void;
  onStartMode: (mode: "txt2img" | "img2img") => void;
}

export const HomePage: React.FC<HomePageProps> = ({
  runtime,
  hardware,
  models,
  images,
  jobs,
  downloads,
  onNavigate,
  onApplyPreset,
  onInspectImage,
  onStartMode,
}) => {
  const connected = runtime.status === "connected";
  const installedCount = models.filter((m) => m.installed).length;
  const checkpointCount = models.filter(
    (m) => m.installed && m.category === "checkpoint"
  ).length;
  const loraCount = models.filter(
    (m) => m.installed && m.category === "lora"
  ).length;

  const activeJobs = jobs.filter(
    (j) =>
      j.status === "QUEUED" ||
      j.status === "RUNNING" ||
      j.status === "SUBMITTING" ||
      j.status === "PROCESSING_OUTPUT"
  );
  const activeDownloads = downloads.filter(
    (d) =>
      d.status === "downloading" || d.status === "verifying" || d.status === "extracting"
  );
  const recentImages = images.slice(0, 8);
  const [blurThumbs, setBlurThumbs] = React.useState(readBlurPreference);
  const toggleBlurThumbs = React.useCallback(() => {
    setBlurThumbs((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(BLUR_THUMBS_KEY, next ? "1" : "0");
      } catch {
        /* storage unavailable: keep the in-memory preference */
      }
      return next;
    });
  }, []);

  const activity = [
    ...jobs.slice(0, 5).map((job) => ({
      key: `job-${job.id}`,
      title: job.prompt || "Untitled generation",
      dot: JOB_ACTIVITY[job.status].dot,
      meta: `${JOB_ACTIVITY[job.status].label} · ${shortModelLabel(job.checkpoint)}`,
      when: formatRelativeTime(job.submittedAt),
    })),
    ...activeDownloads.slice(0, 2).map((task) => ({
      key: `download-${task.id}`,
      title: task.title,
      dot: "bg-info",
      meta: `${formatBytes(task.downloadedBytes)} of ${formatBytes(task.totalBytes)}`,
      when: formatRelativeTime(task.createdAt),
    })),
  ];

  return (
    <div className="space-y-6">
      <section
        aria-labelledby="home-title"
        className="relative overflow-hidden rounded-xl border border-border bg-surface"
      >
        <img
          src="./brand/hero-surreal-wide.webp"
          alt=""
          aria-hidden="true"
          draggable={false}
          width={2400}
          height={1013}
          className="hero-wide-art pointer-events-none absolute inset-y-0 right-0 hidden h-full w-[68%] select-none object-cover object-right lg:block xl:w-[66%]"
        />
        <div className="relative flex min-h-[22rem] items-center p-6 lg:p-8 xl:min-h-[25rem]">
          <div className="max-w-[46rem] space-y-4 lg:max-w-[min(46rem,48%)]">
            <h1
              id="home-title"
              className="text-display text-fg text-balance"
            >
              Create something worth keeping.
            </h1>
            <p className="max-w-[58ch] text-body text-fg-muted">
              Local generation with full parameter control: checkpoints, LoRA
              layering, image-to-image, and every prompt written straight to
              your own disk.
            </p>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button
                variant="primary"
                size="lg"
                onClick={() => onStartMode("txt2img")}
              >
                <Wand2 className="h-4 w-4" />
                New generation
              </Button>
              <Button
                variant="secondary"
                size="lg"
                onClick={() => onStartMode("img2img")}
              >
                <ImageIcon className="h-4 w-4" />
                Image to image
              </Button>
              <Button
                variant="ghost"
                size="lg"
                onClick={() => onNavigate("models")}
              >
                Browse models ({installedCount})
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-caption text-fg-subtle">
              <span className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className={`h-1.5 w-1.5 rounded-full ${
                    connected ? "bg-success" : "bg-warning"
                  }`}
                />
                {connected
                  ? `ComfyUI ${runtime.comfyVersion ? `v${runtime.comfyVersion}` : "connected"}`
                  : runtime.status === "starting"
                    ? "ComfyUI starting"
                    : "ComfyUI offline"}
              </span>
              <span aria-hidden="true" className="text-border-strong">
                |
              </span>
              <span className="font-mono text-tech tabular-nums">
                {hardware?.available
                  ? `VRAM ${gigabyte(hardware.vramFreeMB)} / ${gigabyte(hardware.vramTotalMB)} GB`
                  : "No GPU attached"}
              </span>
              <span aria-hidden="true" className="text-border-strong">
                |
              </span>
              <span className="font-mono text-tech tabular-nums">
                {checkpointCount} ckpt · {loraCount} LoRA
              </span>
            </div>
          </div>
        </div>
      </section>

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-divider lg:grid-cols-4">
        {[
          {
            label: "Models installed",
            value: installedCount,
            sub: `${checkpointCount} checkpoints · ${loraCount} LoRA`,
          },
          {
            label: "Images kept",
            value: images.length,
            sub: images.length === 1 ? "1 local render" : "Local renders on disk",
          },
          {
            label: "Active jobs",
            value: activeJobs.length,
            sub: `${downloads.length} download${downloads.length === 1 ? "" : "s"} tracked`,
          },
          {
            label: "VRAM free",
            value: hardware?.available ? gigabyte(hardware.vramFreeMB) : "—",
            unit: "GB",
            sub: hardware?.available
              ? `of ${gigabyte(hardware.vramTotalMB)} GB total`
              : "No NVIDIA device",
          },
        ].map((stat) => (
          <div key={stat.label} className="bg-surface px-4 py-3.5">
            <dt className="label-mono text-label">{stat.label}</dt>
            <dd className="mt-1.5 flex items-baseline gap-1 font-mono text-xl font-semibold leading-none tabular-nums text-fg">
              {stat.value}
              {stat.unit && (
                <span className="text-caption font-normal text-fg-subtle">
                  {stat.unit}
                </span>
              )}
            </dd>
            <dd className="mt-1.5 text-caption font-normal text-fg-subtle">
              {stat.sub}
            </dd>
          </div>
        ))}
      </dl>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px] xl:grid-cols-[minmax(0,1fr)_320px]">
        <section aria-labelledby="recent-title" className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 id="recent-title" className="text-h2 text-fg">
                Recent creations
              </h2>
              <p className="mt-0.5 text-small text-fg-muted">
                Open any render to inspect its embedded prompt and reuse the
                settings.
              </p>
            </div>
            {images.length > 0 && (
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="utility"
                  aria-pressed={blurThumbs}
                  title="Blur Home thumbnails until hovered (screen-share friendly)"
                  onClick={toggleBlurThumbs}
                >
                  {blurThumbs ? (
                    <Eye className="h-3.5 w-3.5" />
                  ) : (
                    <EyeOff className="h-3.5 w-3.5" />
                  )}
                  {blurThumbs ? "Show" : "Blur"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onNavigate("library")}
                >
                  Open library
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>

          {recentImages.length === 0 ? (
            <EmptyState
              icon={<FolderOpen className="h-5 w-5" />}
              title="No local generations yet"
              description="Generate your first image in Create. Every output keeps its prompt and parameters on this machine."
              action={
                <Button variant="primary" onClick={() => onStartMode("txt2img")}>
                  <Wand2 className="h-4 w-4" />
                  Create first image
                </Button>
              }
            />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {recentImages.map((img) => (
                <button
                  key={img.id}
                  type="button"
                  onClick={() => onInspectImage(img)}
                  className="group relative aspect-square overflow-hidden rounded-lg border border-border bg-well flex items-center justify-center p-1.5 text-left transition-colors hover:border-accent"
                >
                  <MediaImage
                    src={toMediaUrl(img.filePath)}
                    alt={img.prompt}
                    loading="lazy"
                    className={`h-full w-full bg-surface-subtle object-contain transition-[filter,transform] duration-200 ${
                      blurThumbs
                        ? "scale-110 blur-xl group-hover:scale-100 group-hover:blur-none group-focus-visible:scale-100 group-focus-visible:blur-none"
                        : ""
                    }`}
                  />
                  <div className="absolute inset-x-0 bottom-0 bg-black/75 p-2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                    <p className="text-caption leading-snug text-white line-clamp-2">
                      {img.prompt}
                    </p>
                    <p className="mt-0.5 font-mono text-tech tabular-nums text-white/75">
                      {img.width}×{img.height} · {formatRelativeTime(img.createdAt)}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        <aside aria-labelledby="activity-title" className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 id="activity-title" className="text-h2 text-fg">
                Activity
              </h2>
              <p className="mt-0.5 text-small text-fg-muted">
                Renders and downloads.
              </p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => onNavigate("queue")}>
              Open queue
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>

          <div className="rounded-xl border border-border bg-surface">
            {activity.length === 0 ? (
              <p className="px-4 py-6 text-center text-small text-fg-subtle">
                Nothing queued. Renders and downloads appear here as they run.
              </p>
            ) : (
              <ul className="divide-y divide-divider">
                {activity.map((item) => (
                  <li key={item.key} className="flex items-start gap-2.5 px-4 py-3">
                    <span
                      aria-hidden="true"
                      className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${item.dot}`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-small font-medium text-fg">
                        {item.title}
                      </p>
                      <p className="mt-0.5 truncate text-caption font-normal text-fg-subtle">
                        {item.meta}
                      </p>
                    </div>
                    <span className="shrink-0 font-mono text-tech tabular-nums text-fg-subtle">
                      {item.when}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>

      <section aria-labelledby="recipes-title" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="recipes-title" className="text-h2 text-fg">
              Starter recipes
            </h2>
            <p className="mt-0.5 text-small text-fg-muted">
              Curated starting points that load straight into Create.
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={() => onNavigate("explore")}>
            All presets
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 xl:grid-cols-4">
          {STUDIO_PRESETS.slice(0, 4).map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => onApplyPreset(preset)}
              className="group flex flex-col bg-surface p-4 text-left transition-colors hover:bg-surface-subtle"
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-h3 text-fg">{preset.title}</h3>
                <ArrowRight
                  aria-hidden="true"
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-fg-subtle transition-colors group-hover:text-accent"
                />
              </div>
              <p className="mt-1 text-small text-fg-muted line-clamp-2">
                {preset.description}
              </p>
              <span className="mt-auto pt-3 font-mono text-tech tabular-nums text-fg-subtle">
                {preset.category} · {preset.aspectRatio} · {preset.steps} steps
              </span>
            </button>
          ))}
        </div>
      </section>

      <p className="flex items-center gap-2 pb-1 text-caption font-normal text-fg-subtle">
        <Sparkles aria-hidden="true" className="h-3.5 w-3.5" />
        Every render, prompt, and recipe is stored locally in your studio
        library. Nothing leaves this machine.
      </p>
    </div>
  );
};

