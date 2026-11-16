import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, FolderOpen, Package } from "lucide-react";
import type {
  PixelPackageContainer,
  PixelPackageDirection,
  PixelPackagePlan,
  PixelPackagePreset,
  PixelPackageProgress,
  PixelPackageRequest,
  PixelPackageResult,
  PixelPackageScope,
  PixelPivotPreset,
  PixelPackageOutputs,
  PixelSheetLayout,
  PixelPackageFileKind,
} from "../../../shared/pixel-package-types";
import {
  DEFAULT_PACKAGE_OUTPUTS,
  DEFAULT_SHEET_LAYOUT,
} from "../../../shared/pixel-package-types";
import {
  Button,
  ProgressBar,
  Input,
  Modal,
  Select,
} from "../ui/Primitives";
import { PixelField, PixelImage } from "./pixel-ui";

export interface PackageExportTarget {
  scope: PixelPackageScope;
  label: string;
  projectId?: string;
  characterId?: string;
  assetId?: string;
  animation?: string;
}

interface PackageExportDialogProps {
  open: boolean;
  onClose: () => void;
  target: PackageExportTarget | null;
  onToast: (message: string, tone?: "info" | "error") => void;
}

const PRESETS: Array<{
  id: PixelPackagePreset;
  label: string;
  hint: string;
}> = [
  {
    id: "generic",
    label: "Generic package",
    hint: "PNG frames and stills, spritesheets, GIF/APNG previews and a JSON manifest. No engine-specific files.",
  },
  {
    id: "godot",
    label: "Godot 4 · SpriteFrames",
    hint: "Adds SpriteFrames .tres resources and a scene. Structure is validated; not loaded inside Godot.",
  },
  {
    id: "unity",
    label: "Unity · sprites & clips",
    hint: "Adds an uncompressed TextureImporter .meta, an editor import script and clip definitions. Structure is validated; Unity is not run at export time.",
  },
  {
    id: "phaser",
    label: "Phaser 3 · atlas",
    hint: "Adds a JSONHash atlas and animation JSON. Structure is validated; Phaser is not run at export time.",
  },
];

const OUTPUT_LABELS: Array<{ key: keyof PixelPackageOutputs; label: string }> = [
  { key: "frames", label: "Individual frames" },
  { key: "stills", label: "Direction stills" },
  { key: "combinedSheet", label: "Combined spritesheet" },
  { key: "animationSheets", label: "Sheet per animation" },
  { key: "directionSheets", label: "Sheet per direction" },
  { key: "gif", label: "GIF previews" },
  { key: "apng", label: "APNG previews" },
];

const PIVOTS: Array<{ id: PixelPivotPreset; label: string }> = [
  { id: "bottom-center", label: "Bottom centre" },
  { id: "center", label: "Centre" },
  { id: "top-left", label: "Top left" },
];

const KIND_LABELS: Partial<Record<PixelPackageFileKind, string>> = {
  frame: "frames",
  still: "stills",
  sheet: "sheets",
  atlas: "atlases",
  gif: "GIFs",
  apng: "APNGs",
  godot: "Godot files",
  unity: "Unity files",
  phaser: "Phaser files",
  provenance: "provenance",
  readme: "readmes",
};

const STAGE_LABELS: Record<PixelPackageProgress["stage"], string> = {
  collect: "Collecting frames",
  pack: "Packing sheets",
  encode: "Encoding previews",
  write: "Writing package",
  verify: "Verifying package",
  done: "Done",
  cancelled: "Cancelled",
  failed: "Failed",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function directionList(directions: PixelPackageDirection[]): string {
  return directions.length ? directions.join(", ") : "none";
}

export const PackageExportDialog: React.FC<PackageExportDialogProps> = ({
  open,
  onClose,
  target,
  onToast,
}) => {
  const [preset, setPreset] = useState<PixelPackagePreset>("generic");
  const [container, setContainer] = useState<PixelPackageContainer>("zip");
  const [scale, setScale] = useState(1);
  const [layout, setLayout] = useState<PixelSheetLayout>({ ...DEFAULT_SHEET_LAYOUT });
  const [outputs, setOutputs] = useState<PixelPackageOutputs>({ ...DEFAULT_PACKAGE_OUTPUTS });
  const [transparent, setTransparent] = useState(true);
  const [background, setBackground] = useState("#1b1b1f");
  const [pivot, setPivot] = useState<PixelPivotPreset>("bottom-center");
  const [pixelsPerUnit, setPixelsPerUnit] = useState(100);
  const [version, setVersion] = useState<string>("");
  const [destination, setDestination] = useState<string | null>(null);
  const [plan, setPlan] = useState<PixelPackagePlan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planning, setPlanning] = useState(false);
  const [result, setResult] = useState<PixelPackageResult | null>(null);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState<PixelPackageProgress | null>(null);
  const jobRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPreset("generic");
    setContainer("zip");
    setScale(1);
    setLayout({ ...DEFAULT_SHEET_LAYOUT });
    setOutputs({ ...DEFAULT_PACKAGE_OUTPUTS });
    setTransparent(true);
    setBackground("#1b1b1f");
    setPivot("bottom-center");
    setPixelsPerUnit(100);
    setVersion("");
    setDestination(null);
    setPlan(null);
    setPlanError(null);
    setResult(null);
    setProgress(null);
    setExporting(false);
    jobRef.current = null;
  }, [open, target]);

  useEffect(
    () =>
      window.kirea.onPixelPackageProgress((update) => {
        if (jobRef.current && update.jobId === jobRef.current) setProgress(update);
      }),
    []
  );

  const versionNumber = Number(version);
  const request = useMemo<PixelPackageRequest | null>(() => {
    if (!target) return null;
    return {
      scope: target.scope,
      ...(target.projectId ? { projectId: target.projectId } : {}),
      ...(target.characterId ? { characterId: target.characterId } : {}),
      ...(target.assetId ? { assetId: target.assetId } : {}),
      ...(target.animation ? { animation: target.animation } : {}),
      ...(target.scope !== "character" && target.scope !== "project" && Number.isInteger(versionNumber) && versionNumber > 0
        ? { version: versionNumber }
        : {}),
      preset,
      container,
      scale,
      layout,
      outputs,
      background: transparent ? null : background,
      pivot,
      pixelsPerUnit,
      destination,
    };
  }, [
    target,
    preset,
    container,
    scale,
    layout,
    outputs,
    transparent,
    background,
    pivot,
    pixelsPerUnit,
    destination,
    versionNumber,
  ]);

  const requestKey = useMemo(() => (request ? JSON.stringify(request) : ""), [request]);

  useEffect(() => {
    if (!open || !request) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setPlanning(true);
      void window.kirea
        .planPixelPackage(request)
        .then((next) => {
          if (cancelled) return;
          setPlan(next);
          setPlanError(null);
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          setPlan(null);
          setPlanError(error instanceof Error ? error.message : "Could not build the export plan.");
        })
        .finally(() => {
          if (!cancelled) setPlanning(false);
        });
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, requestKey, request]);

  const patchLayout = useCallback((patch: Partial<PixelSheetLayout>): void => {
    setLayout((current) => ({ ...current, ...patch }));
  }, []);

  const toggleOutput = (key: keyof PixelPackageOutputs): void => {
    setOutputs((current) => ({ ...current, [key]: !current[key] }));
  };

  const chooseDestination = async (): Promise<void> => {
    const picked = await window.kirea.pickPixelPackageDestination();
    if (picked) setDestination(picked);
  };

  const runExport = async (): Promise<void> => {
    if (!request) return;
    const jobId = crypto.randomUUID();
    jobRef.current = jobId;
    setExporting(true);
    setResult(null);
    setProgress({ jobId, stage: "collect", done: 0, total: 1, message: "Reading sprites" });
    try {
      const exported = await window.kirea.exportPixelPackage({ ...request, jobId });
      setResult(exported);
      setPlan(exported.plan);
      onToast(`Exported ${exported.plan.summary.root}.`, "info");
    } catch (error) {
      onToast(error instanceof Error ? error.message : "The export failed.", "error");
    } finally {
      setExporting(false);
      jobRef.current = null;
    }
  };

  const cancelExport = async (): Promise<void> => {
    if (!jobRef.current) return;
    await window.kirea.cancelPixelPackage(jobRef.current);
  };

  const fileGroups = useMemo(() => {
    const groups = new Map<string, { count: number; bytes: number }>();
    for (const file of plan?.files ?? []) {
      const label = KIND_LABELS[file.kind] ?? file.kind;
      const entry = groups.get(label) ?? { count: 0, bytes: 0 };
      entry.count += 1;
      entry.bytes += file.bytes;
      groups.set(label, entry);
    }
    return [...groups.entries()];
  }, [plan]);

  const errors = plan?.issues.filter((issue) => issue.severity === "error") ?? [];
  const warnings = plan?.issues.filter((issue) => issue.severity === "warning") ?? [];
  const progressPercent =
    progress && progress.total > 0 ? (progress.done / progress.total) * 100 : 0;

  const scopeLabel = target
    ? `${target.scope === "animation" ? "Animation" : target.scope[0]?.toUpperCase() + target.scope.slice(1)} · ${target.label}`
    : "";

  return (
    <Modal
      open={open}
      onClose={exporting ? () => undefined : onClose}
      title="Export game-ready package"
      maxWidthClass="max-w-5xl"
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-surface-subtle px-3 py-2">
            <span className="label-mono text-fg-muted">Scope</span>
            <p className="mt-0.5 text-small text-fg">{scopeLabel}</p>
          </div>

          <PixelField label="Preset" hint={PRESETS.find((entry) => entry.id === preset)?.hint}>
            <Select
              value={preset}
              disabled={exporting}
              onChange={(event) => setPreset(event.target.value as PixelPackagePreset)}
            >
              {PRESETS.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </Select>
          </PixelField>

          <div className="grid grid-cols-2 gap-3">
            <PixelField label="Container">
              <Select
                value={container}
                disabled={exporting}
                onChange={(event) => setContainer(event.target.value as PixelPackageContainer)}
              >
                <option value="zip">ZIP archive</option>
                <option value="folder">Folder</option>
              </Select>
            </PixelField>
            <PixelField label="Scale (nearest neighbour)">
              <Select
                value={String(scale)}
                disabled={exporting}
                onChange={(event) => setScale(Number(event.target.value))}
              >
                {[1, 2, 3, 4, 6, 8].map((value) => (
                  <option key={value} value={value}>
                    {value}×
                  </option>
                ))}
              </Select>
            </PixelField>
          </div>

          <div className="space-y-1.5">
            <span className="label-mono text-fg-muted">Include</span>
            <div className="grid grid-cols-2 gap-1.5">
              {OUTPUT_LABELS.map((entry) => (
                <label
                  key={entry.key}
                  className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-[11px] text-fg-muted cursor-pointer hover:border-border-strong"
                >
                  <input
                    type="checkbox"
                    checked={outputs[entry.key]}
                    disabled={exporting}
                    onChange={() => toggleOutput(entry.key)}
                  />
                  {entry.label}
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <PixelField label="Columns (0 = auto)">
              <Input
                type="number"
                min={0}
                max={256}
                value={layout.columns}
                disabled={exporting}
                onChange={(event) => patchLayout({ columns: Number(event.target.value) || 0 })}
              />
            </PixelField>
            <PixelField label="Rows (0 = auto)">
              <Input
                type="number"
                min={0}
                max={256}
                value={layout.rows}
                disabled={exporting}
                onChange={(event) => patchLayout({ rows: Number(event.target.value) || 0 })}
              />
            </PixelField>
            <PixelField label="Padding">
              <Input
                type="number"
                min={0}
                max={64}
                value={layout.padding}
                disabled={exporting}
                onChange={(event) => patchLayout({ padding: Number(event.target.value) || 0 })}
              />
            </PixelField>
            <PixelField label="Spacing">
              <Input
                type="number"
                min={0}
                max={64}
                value={layout.spacing}
                disabled={exporting}
                onChange={(event) => patchLayout({ spacing: Number(event.target.value) || 0 })}
              />
            </PixelField>
            <PixelField label="Extrude edge">
              <Input
                type="number"
                min={0}
                max={8}
                value={layout.extrude}
                disabled={exporting}
                onChange={(event) => patchLayout({ extrude: Number(event.target.value) || 0 })}
              />
            </PixelField>
            <PixelField label="Max sheet size">
              <Select
                value={String(layout.maxSize)}
                disabled={exporting}
                onChange={(event) => patchLayout({ maxSize: Number(event.target.value) })}
              >
                {[512, 1024, 2048, 4096, 8192].map((value) => (
                  <option key={value} value={value}>
                    {value} px
                  </option>
                ))}
              </Select>
            </PixelField>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-[11px] text-fg-muted">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={layout.trim}
                disabled={exporting}
                onChange={() => patchLayout({ trim: !layout.trim })}
              />
              Trim transparent edges
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={layout.uniformFrames}
                disabled={exporting}
                onChange={() => patchLayout({ uniformFrames: !layout.uniformFrames })}
              />
              Uniform frame cells
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <PixelField label="Pivot">
              <Select
                value={pivot}
                disabled={exporting}
                onChange={(event) => setPivot(event.target.value as PixelPivotPreset)}
              >
                {PIVOTS.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                  </option>
                ))}
              </Select>
            </PixelField>
            {preset === "unity" ? (
              <PixelField label="Pixels per unit">
                <Input
                  type="number"
                  min={1}
                  max={10000}
                  value={pixelsPerUnit}
                  disabled={exporting}
                  onChange={(event) => setPixelsPerUnit(Number(event.target.value) || 100)}
                />
              </PixelField>
            ) : (
              <PixelField label="Background" hint="Generic PNG and GIF flattening.">
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1.5 text-[11px] text-fg-muted">
                    <input
                      type="checkbox"
                      checked={transparent}
                      disabled={exporting}
                      onChange={() => setTransparent((value) => !value)}
                    />
                    Transparent
                  </label>
                  {!transparent && (
                    <Input
                      type="color"
                      className="h-8 w-16 p-1"
                      value={background}
                      disabled={exporting}
                      onChange={(event) => setBackground(event.target.value)}
                    />
                  )}
                </div>
              </PixelField>
            )}
          </div>

          {(target?.scope === "asset" || target?.scope === "animation") && (
            <PixelField label="Version" hint="Leave empty to export the current version.">
              <Input
                type="number"
                min={1}
                placeholder="current"
                value={version}
                disabled={exporting}
                onChange={(event) => setVersion(event.target.value)}
              />
            </PixelField>
          )}

          <PixelField
            label="Destination"
            hint={plan?.destination ?? "KIREA's own export folder is used until you choose one."}
          >
            <div className="flex gap-2">
              <Input readOnly value={destination ?? ""} placeholder="Default export folder" />
              <Button variant="secondary" disabled={exporting} onClick={() => void chooseDestination()}>
                Choose…
              </Button>
              {destination && (
                <Button variant="utility" disabled={exporting} onClick={() => setDestination(null)}>
                  Reset
                </Button>
              )}
            </div>
          </PixelField>
        </div>

        <div className="space-y-3">
          <div className="rounded-xl border border-border bg-surface-subtle p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="label-mono text-fg-muted">Package contents</span>
              {planning && <span className="text-[10px] text-fg-faint">Planning…</span>}
            </div>

            {planError && (
              <p className="text-[11px] text-danger leading-relaxed">{planError}</p>
            )}

            {plan && (
              <>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-fg-muted">Root</span>
                    <span className="font-mono text-fg truncate max-w-[140px]" title={plan.summary.root}>
                      {plan.summary.root}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-fg-muted">Assets</span>
                    <span className="font-mono text-fg">{plan.summary.assets}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-fg-muted">Frames</span>
                    <span className="font-mono text-fg">{plan.summary.frames}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-fg-muted">Animations</span>
                    <span className="font-mono text-fg">{plan.summary.animations}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-fg-muted">Sheets</span>
                    <span className="font-mono text-fg">{plan.summary.sheets}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-fg-muted">Files</span>
                    <span className="font-mono text-fg">
                      {plan.files.length} · {formatBytes(plan.totalBytes)}
                    </span>
                  </div>
                  <div className="col-span-2 flex justify-between gap-3">
                    <span className="text-fg-muted shrink-0">Directions</span>
                    <span className="font-mono text-fg text-right truncate">
                      {directionList(plan.summary.directions)}
                    </span>
                  </div>
                </div>

                {plan.summary.versions.length > 0 && (
                  <div className="border-t border-border pt-1.5 space-y-1">
                    <span className="label-mono text-fg-muted">Versions</span>
                    <div className="max-h-20 overflow-y-auto space-y-0.5">
                      {plan.summary.versions.map((entry) => (
                        <div
                          key={entry.assetId}
                          className="flex items-center justify-between gap-2 text-[10px] font-mono text-fg-muted"
                        >
                          <span className="truncate">{entry.name}</span>
                          <span className="text-fg-faint">
                            v{entry.version}
                            {entry.current ? " · current" : " · historical"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {plan.preview && (
                  <div className="border-t border-border pt-2 space-y-1">
                    <span className="label-mono text-fg-muted">Preview</span>
                    <PixelImage
                      src={plan.preview.dataUrl}
                      alt={plan.preview.label}
                      className="h-36 w-full rounded-md border border-border"
                    />
                    <p className="text-[10px] text-fg-faint">
                      {plan.preview.label} · {plan.preview.width}×{plan.preview.height}
                    </p>
                  </div>
                )}

                <div className="border-t border-border pt-1.5 space-y-1">
                  <span className="label-mono text-fg-muted">File groups</span>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px]">
                    {fileGroups.map(([label, entry]) => (
                      <div key={label} className="flex justify-between">
                        <span className="text-fg-muted truncate">{label}</span>
                        <span className="font-mono text-fg-faint">
                          {entry.count} · {formatBytes(entry.bytes)}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="max-h-28 overflow-y-auto border border-border rounded-md divide-y divide-border mt-1">
                    {plan.files.slice(0, 18).map((file) => (
                      <div key={file.path} className="flex justify-between gap-2 px-2 py-1 text-[10px]">
                        <span className="font-mono text-fg-muted truncate">{file.path}</span>
                        <span className="text-fg-faint shrink-0">{formatBytes(file.bytes)}</span>
                      </div>
                    ))}
                    {plan.files.length > 18 && (
                      <p className="px-2 py-1 text-[10px] text-fg-faint">
                        …and {plan.files.length - 18} more files
                      </p>
                    )}
                  </div>
                </div>

                {errors.length > 0 && (
                  <div className="border border-danger/40 bg-danger-soft/30 rounded-md p-2 space-y-1">
                    {errors.map((issue, index) => (
                      <p key={`${issue.code}-${index}`} className="text-[11px] text-danger leading-snug">
                        {issue.message}
                      </p>
                    ))}
                  </div>
                )}
                {warnings.length > 0 && (
                  <div className="border border-warning/40 bg-warning-soft/30 rounded-md p-2 space-y-1">
                    {warnings.slice(0, 6).map((issue, index) => (
                      <p
                        key={`${issue.code}-${index}`}
                        className="text-[11px] text-warning leading-snug"
                      >
                        {issue.message}
                      </p>
                    ))}
                    {warnings.length > 6 && (
                      <p className="text-[10px] text-fg-faint">
                        …and {warnings.length - 6} more warnings
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          {exporting && progress && (
            <div className="rounded-xl border border-border p-3 space-y-2">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-fg-muted">{STAGE_LABELS[progress.stage]}</span>
                <span className="font-mono text-fg-faint">
                  {progress.total > 1 ? `${progress.done}/${progress.total}` : ""}
                </span>
              </div>
              <ProgressBar value={progressPercent} label="Package export progress" />
              <p className="text-[10px] text-fg-faint">{progress.message}</p>
            </div>
          )}

          {result && (
            <div className="rounded-xl border border-success/40 bg-success-soft/30 p-3 space-y-1.5">
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-success" />
                <span className="text-[11px] font-semibold text-fg">Package verified</span>
              </div>
              <p className="font-mono text-[10px] text-fg-muted break-all">{result.filePath}</p>
              <p className="text-[10px] text-fg-muted">
                {result.verification.checkedFiles} files · {result.verification.checkedImages} images
                · {result.verification.checkedRegions} sheet regions ·{" "}
                {result.verification.checkedPixels} pixels compared
              </p>
              <Button
                size="sm"
                variant="utility"
                onClick={() => void window.kirea.revealPixelPackage(result.filePath)}
              >
                <FolderOpen className="w-3 h-3" /> Show package
              </Button>
            </div>
          )}

          {plan?.blocked && !exporting && (
            <p className="text-[11px] text-danger flex items-center gap-1.5">
              <AlertTriangle className="w-3 h-3" /> Fix the errors above to export.
            </p>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            {exporting ? (
              <Button variant="danger" onClick={() => void cancelExport()}>
                Cancel export
              </Button>
            ) : (
              <>
                {result ? (
                  <Button variant="secondary" onClick={onClose}>
                    Close
                  </Button>
                ) : (
                  <Button variant="secondary" onClick={onClose}>
                    Cancel
                  </Button>
                )}
                <Button
                  variant="accent"
                  loading={exporting}
                  disabled={!plan || plan.blocked || planning}
                  onClick={() => void runExport()}
                >
                  <Package className="w-3.5 h-3.5" /> Export package
                </Button>
              </>
            )}
          </div>

          {result && (
            <p className="text-[10px] text-fg-faint leading-relaxed">
              Original assets, generation metadata and version history were read only. Closing the
              dialog keeps the package where it was written.
            </p>
          )}
          {!result && preset !== "generic" && (
            <p className="text-[10px] text-fg-faint leading-relaxed">
              {preset === "godot"
                ? "Godot output is validated structurally only — the package is not opened in the Godot editor."
                : preset === "unity"
                  ? "Unity output is validated structurally. A real Unity 6 batch-mode import is part of KIREA's engine test suite, not of this export."
                  : "Phaser output is validated structurally. A real Phaser 3.90 atlas load is part of KIREA's engine test suite, not of this export."}
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
};
