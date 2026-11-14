import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Copy,
  FolderOpen,
  Grid3X3,
  Layers,
  Pause,
  Pencil,
  Play,
  Repeat,
  Trash2,
} from "lucide-react";
import type {
  PixelAssetDetail,
  PixelAssetRecord,
  PixelFrameInput,
} from "../../../shared/pixel-types";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Select,
} from "../ui/Primitives";
import { PixelImage, checkerStyle } from "./pixel-ui";

interface AnimationStudioProps {
  assets: PixelAssetRecord[];
  detail: PixelAssetDetail | null;
  selectedAssetId: string;
  onSelectAsset: (id: string) => void;
  onSaveFrames: (assetId: string, frames: PixelFrameInput[]) => Promise<void>;
  onOpenEditor: (assetId: string, frameIndex: number) => void;
  onToast: (message: string, tone?: "info" | "error") => void;
}

const ALL = "__all__";
const SPEEDS = [0.5, 1, 1.5, 2];

export const AnimationStudioPanel: React.FC<AnimationStudioProps> = ({
  assets,
  detail,
  selectedAssetId,
  onSelectAsset,
  onSaveFrames,
  onOpenEditor,
  onToast,
}) => {
  const [animation, setAnimation] = useState<string>(ALL);
  const [playPos, setPlayPos] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [onion, setOnion] = useState(false);
  const [zoom, setZoom] = useState(4);
  const [saving, setSaving] = useState(false);
  const [durationDraft, setDurationDraft] = useState<Record<number, number>>({});
  const [nameDraft, setNameDraft] = useState<Record<number, string>>({});
  const clipRef = useRef<HTMLDivElement | null>(null);

  const frameCount = detail?.frames.length ?? 0;

  const sequence = useMemo<number[]>(() => {
    if (!detail) return [];
    if (animation === ALL) return detail.frames.map((_, index) => index);
    const animationRecord = detail.animations[animation];
    if (!animationRecord) return [];
    return animationRecord.frames
      .map((frameIndex) =>
        detail.frames.findIndex((frame) => frame.index === frameIndex)
      )
      .filter((index) => index >= 0);
  }, [detail, animation]);

  useEffect(() => {
    setAnimation(ALL);
    setPlayPos(0);
    setPlaying(false);
    setDurationDraft({});
    setNameDraft({});
  }, [detail?.id]);

  useEffect(() => {
    if (animation !== ALL && !detail?.animations[animation]) setAnimation(ALL);
  }, [animation, detail]);

  useEffect(() => {
    if (playPos >= sequence.length) setPlayPos(0);
  }, [sequence.length, playPos]);

  const currentArrayIndex = sequence[playPos] ?? 0;
  const currentFrame = detail?.frames[currentArrayIndex] ?? null;
  const previousFrame =
    detail?.frames[sequence[(playPos - 1 + sequence.length) % sequence.length] ?? 0] ?? null;
  const nextFrame =
    detail?.frames[sequence[(playPos + 1) % sequence.length] ?? 0] ?? null;

  const durationFor = (index: number): number =>
    durationDraft[index] ?? detail?.frames[index]?.durationMs ?? 100;
  const nameFor = (index: number): string =>
    nameDraft[index] ?? detail?.frames[index]?.name ?? `frame_${index + 1}`;

  useEffect(() => {
    if (!playing || !detail || sequence.length === 0 || !currentFrame) return;
    const wait = Math.max(16, durationFor(currentArrayIndex) / speed);
    const timer = window.setTimeout(() => {
      setPlayPos((position) => {
        const next = position + 1;
        if (next < sequence.length) return next;
        if (loop) return 0;
        setPlaying(false);
        return position;
      });
    }, wait);
    return () => window.clearTimeout(timer);
  }, [
    playing,
    playPos,
    detail,
    sequence.length,
    currentArrayIndex,
    speed,
    loop,
    durationDraft,
  ]);

  const buildFrames = (): PixelFrameInput[] =>
    (detail?.frames ?? []).map((frame, index) => ({
      index,
      name: (nameDraft[index] ?? frame.name).trim() || `frame_${index + 1}`,
      durationMs: Math.max(1, Math.round(durationDraft[index] ?? frame.durationMs)),
      dataUrl: frame.dataUrl,
    }));

  const persist = async (frames: PixelFrameInput[], message: string): Promise<void> => {
    if (!detail) return;
    setSaving(true);
    try {
      await onSaveFrames(detail.id, frames);
      setDurationDraft({});
      setNameDraft({});
      onToast(message, "info");
    } catch (error) {
      onToast(error instanceof Error ? error.message : "Could not save the animation.", "error");
    } finally {
      setSaving(false);
    }
  };

  const moveFrame = async (index: number, delta: number): Promise<void> => {
    if (!detail) return;
    const target = index + delta;
    if (target < 0 || target >= detail.frames.length) return;
    const frames = buildFrames();
    const [removed] = frames.splice(index, 1);
    if (!removed) return;
    frames.splice(target, 0, removed);
    await persist(frames.map((frame, position) => ({ ...frame, index: position })), "Frame reordered.");
  };

  const duplicateFrame = async (index: number): Promise<void> => {
    if (!detail) return;
    const frames = buildFrames();
    const source = frames[index];
    if (!source) return;
    const copies = frames.map((frame) =>
      frame.index >= index ? { ...frame, index: frame.index + 1 } : frame
    );
    copies.splice(index + 1, 0, {
      ...source,
      index: index + 1,
      name: `${source.name}_copy`.slice(0, 60),
    });
    await persist(
      copies.map((frame, position) => ({ ...frame, index: position })),
      "Frame duplicated."
    );
  };

  const deleteFrame = async (index: number): Promise<void> => {
    if (!detail || detail.frames.length <= 1) return;
    const frames = buildFrames().filter((_, position) => position !== index);
    await persist(
      frames.map((frame, position) => ({ ...frame, index: position })),
      "Frame deleted."
    );
  };

  const commitTiming = async (index: number): Promise<void> => {
    if (!detail) return;
    const original = detail.frames[index];
    const nextName = nameFor(index);
    const nextDuration = durationFor(index);
    if (
      !original ||
      (nextName === original.name && nextDuration === original.durationMs)
    ) {
      return;
    }
    await persist(buildFrames(), `Frame ${index + 1} updated.`);
  };

  const exportNow = async (format: "sheet" | "gif"): Promise<void> => {
    if (!detail) return;
    try {
      const result = await window.kirea.exportPixelAsset(detail.id, format, {
        scale: zoom <= 2 ? 4 : 2,
        animation: format === "gif" && animation !== ALL ? animation : undefined,
      });
      await window.kirea.openPixelExportFolder(detail.id);
      onToast(`Exported ${result.frameCount} frames to ${result.filePath}`, "info");
    } catch (error) {
      onToast(error instanceof Error ? error.message : "Export failed.", "error");
    }
  };

  const assetOptions = assets.filter((asset) => asset.frameCount > 0);

  if (!detail) {
    return (
      <Card className="p-4">
        <EmptyState
          icon={<Layers />}
          title={assetOptions.length ? "Pick an asset to animate" : "Nothing to animate yet"}
          description={
            assetOptions.length
              ? "Select an asset below. Every generated asset already carries real frames with their own durations."
              : "Generate a character, creature or effect first. Their frames appear here on a real timeline."
          }
          action={
            assetOptions.length ? (
              <Select
                className="w-72"
                value={selectedAssetId}
                onChange={(event) => onSelectAsset(event.target.value)}
              >
                <option value="">Choose an asset…</option>
                {assetOptions.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.name} · {asset.frameCount}f
                  </option>
                ))}
              </Select>
            ) : undefined
          }
        />
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <Card className="p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select
            className="w-72"
            value={detail.id}
            onChange={(event) => onSelectAsset(event.target.value)}
          >
            {assetOptions.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.name} · {asset.frameCount}f
              </option>
            ))}
          </Select>
          <Badge tone="accent">
            {detail.width}×{detail.height}
          </Badge>
          <Badge tone="neutral">v{detail.version}</Badge>
          <Badge tone="sand">{detail.paletteId}</Badge>
          <span className="ml-auto flex items-center gap-1.5">
            <Button size="sm" variant="utility" onClick={() => void exportNow("sheet")}>
              <Grid3X3 className="w-3 h-3" /> Sheet
            </Button>
            <Button size="sm" variant="utility" onClick={() => void exportNow("gif")}>
              <Repeat className="w-3 h-3" /> GIF
            </Button>
            <Button
              size="sm"
              variant="utility"
              onClick={() => onOpenEditor(detail.id, currentArrayIndex)}
            >
              <Pencil className="w-3 h-3" /> Edit frame
            </Button>
          </span>
        </div>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_280px]">
        <Card className="p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant={playing ? "primary" : "secondary"}
                onClick={() => {
                  setPlaying((prev) => !prev);
                  if (!playing && sequence.length <= 1) setPlayPos(0);
                }}
                disabled={sequence.length <= 1}
              >
                {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                {playing ? "Pause" : "Play"}
              </Button>
              <Button
                size="sm"
                variant="utility"
                aria-pressed={loop}
                onClick={() => setLoop((prev) => !prev)}
                className={loop ? "border-accent text-fg" : ""}
              >
                <Repeat className="w-3.5 h-3.5" /> Loop
              </Button>
              <Button
                size="sm"
                variant="utility"
                aria-pressed={onion}
                onClick={() => setOnion((prev) => !prev)}
                className={onion ? "border-accent text-fg" : ""}
              >
                <Layers className="w-3.5 h-3.5" /> Onion
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Select
                className="w-36"
                value={String(speed)}
                onChange={(event) => setSpeed(Number(event.target.value))}
              >
                {SPEEDS.map((entry) => (
                  <option key={entry} value={entry}>
                    {entry}× speed
                  </option>
                ))}
              </Select>
              <Select
                className="w-40"
                value={animation}
                onChange={(event) => {
                  setAnimation(event.target.value);
                  setPlayPos(0);
                }}
              >
                <option value={ALL}>All frames</option>
                {Object.keys(detail.animations).map((name) => (
                  <option key={name} value={name}>
                    {name} · {detail.animations[name]!.frames.length}f
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div
            className="rounded-lg border border-border overflow-auto flex items-center justify-center p-3 min-h-[280px] max-h-[460px]"
            style={checkerStyle(10)}
          >
            <div className="relative shrink-0" style={{ width: detail.width * zoom }}>
              {onion && previousFrame?.dataUrl && (
                <img
                  src={previousFrame.dataUrl}
                  alt="Previous frame onion skin"
                  className="absolute inset-0 w-full h-full opacity-25 pointer-events-none"
                  style={{ imageRendering: "pixelated" }}
                />
              )}
              {onion && nextFrame?.dataUrl && (
                <img
                  src={nextFrame.dataUrl}
                  alt="Next frame onion skin"
                  className="absolute inset-0 w-full h-full opacity-10 pointer-events-none"
                  style={{ imageRendering: "pixelated" }}
                />
              )}
              {currentFrame?.dataUrl ? (
                <img
                  src={currentFrame.dataUrl}
                  alt={currentFrame.name}
                  className="relative w-full block"
                  style={{ imageRendering: "pixelated" }}
                />
              ) : (
                <div className="aspect-square" />
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-fg-muted">
            <span className="font-mono">
              {playing || playPos > 0 ? `${playPos + 1}/${sequence.length}` : `0/${sequence.length}`} ·{" "}
              {currentFrame?.name ?? "—"} · {Math.round(durationFor(currentArrayIndex))} ms
            </span>
            <div className="flex items-center gap-2">
              <span className="font-mono text-fg-faint">Total</span>
              <span className="font-mono">
                {sequence.reduce((sum, index) => sum + durationFor(index), 0)} ms
              </span>
              <span className="font-mono text-fg-faint">Zoom</span>
              <Select
                className="w-20"
                value={String(zoom)}
                onChange={(event) => setZoom(Number(event.target.value))}
              >
                {[2, 4, 6, 8, 12, 16].map((entry) => (
                  <option key={entry} value={entry}>
                    {entry}×
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </Card>

        <Card className="p-4 space-y-3 self-start">
          <span className="label-mono text-fg-muted">Clip data</span>
          <dl className="space-y-2 text-[11px]">
            <div className="flex justify-between gap-3">
              <dt className="text-fg-muted">Frames</dt>
              <dd className="font-mono text-fg">{frameCount}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-fg-muted">Animations</dt>
              <dd className="font-mono text-fg">
                {Object.keys(detail.animations).join(", ") || "—"}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-fg-muted">Canvas</dt>
              <dd className="font-mono text-fg">
                {detail.width}×{detail.height}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-fg-muted">Engine</dt>
              <dd className="font-mono text-fg">{detail.engine}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-fg-muted">Seed</dt>
              <dd className="font-mono text-fg">{detail.seed ?? "—"}</dd>
            </div>
          </dl>
          {detail.prompt && (
            <p className="text-[11px] text-fg-faint leading-relaxed border-t border-border pt-2">
              {detail.prompt}
            </p>
          )}
          <p className="text-[11px] text-fg-faint leading-relaxed border-t border-border pt-2">
            Frame edits are versioned. Saving a change increments the asset version and rewrites
            the preview and sheet.
          </p>
        </Card>
      </div>

      <Card className="p-3">
        <div className="flex items-center justify-between mb-2 px-1">
          <span className="label-mono text-fg-muted">
            Timeline · {detail.frames.length} frames
          </span>
          <span className="text-[11px] text-fg-faint">
            Durations are per frame; reorder, duplicate or delete writes a new version.
          </span>
        </div>
        <div ref={clipRef} className="flex gap-2 overflow-x-auto pb-2">
          {detail.frames.map((frame, index) => {
            const active = index === currentArrayIndex && detail.id === selectedAssetId;
            const inAnimation =
              animation === ALL ||
              (detail.animations[animation]?.frames ?? []).some(
                (frameIndex) => detail.frames.findIndex((entry) => entry.index === frameIndex) === index
              );
            return (
              <div
                key={`${frame.index}-${index}`}
                className={`w-36 shrink-0 rounded-lg border overflow-hidden ${
                  active ? "border-accent" : "border-border"
                } ${inAnimation ? "" : "opacity-45"}`}
              >
                <button
                  type="button"
                  onClick={() => {
                    setAnimation(ALL);
                    setPlayPos(index);
                    setPlaying(false);
                  }}
                  className="block w-full text-left"
                >
                  <PixelImage src={frame.dataUrl} alt={frame.name} className="aspect-square w-full" />
                </button>
                <div className="p-2 space-y-1.5">
                  <Input
                    value={nameFor(index)}
                    onChange={(event) =>
                      setNameDraft((prev) => ({ ...prev, [index]: event.target.value }))
                    }
                    onBlur={() => void commitTiming(index)}
                    className="h-6 text-[10px] font-mono"
                    maxLength={60}
                  />
                  <div className="flex items-center gap-1">
                    <Input
                      type="number"
                      min={1}
                      max={60000}
                      value={durationFor(index)}
                      onChange={(event) =>
                        setDurationDraft((prev) => ({
                          ...prev,
                          [index]: Number(event.target.value) || 1,
                        }))
                      }
                      onBlur={() => void commitTiming(index)}
                      className="h-6 text-[10px] font-mono"
                    />
                    <span className="text-[9px] font-mono text-fg-faint">ms</span>
                  </div>
                  <div className="flex gap-0.5">
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label="Move frame left"
                      disabled={index === 0 || saving}
                      onClick={() => void moveFrame(index, -1)}
                    >
                      <ArrowLeft className="w-3 h-3" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label="Move frame right"
                      disabled={index === detail.frames.length - 1 || saving}
                      onClick={() => void moveFrame(index, 1)}
                    >
                      <ArrowRight className="w-3 h-3" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label="Duplicate frame"
                      disabled={saving}
                      onClick={() => void duplicateFrame(index)}
                    >
                      <Copy className="w-3 h-3" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label="Delete frame"
                      disabled={saving || detail.frames.length <= 1}
                      onClick={() => void deleteFrame(index)}
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <div className="flex items-center gap-2 text-[11px] text-fg-faint">
        <FolderOpen className="w-3 h-3" />
        {saving ? "Writing frames, preview and sheet…" : "All frame data is stored on disk."}
      </div>
    </div>
  );
};
