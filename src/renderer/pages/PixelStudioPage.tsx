import React, { useCallback, useEffect, useState } from "react";
import {
  Boxes,
  Film,
  FolderKanban,
  Grid3X3,
  Pencil,
  Plus,
  Trash2,
  Trees,
  Users,
  Wand2,
} from "lucide-react";
import type {
  PixelAssetDetail,
  PixelAssetRecord,
  PixelCharacter,
  PixelFrameInput,
  PixelProject,
} from "../../shared/pixel-types";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Input,
  Modal,
  SectionHeader,
  Select,
  Skeleton,
  Textarea,
} from "../components/ui/Primitives";
import { GenerateStudioPanel } from "../components/pixel/GenerateStudioPanel";
import { CharacterStudioPanel } from "../components/pixel/CharacterStudioPanel";
import { AnimationStudioPanel } from "../components/pixel/AnimationStudioPanel";
import { PixelEditorPanel } from "../components/pixel/PixelEditorPanel";
import { AssetLibraryPanel } from "../components/pixel/AssetLibraryPanel";
import { PixelField } from "../components/pixel/pixel-ui";

type PixelTab =
  | "generate"
  | "characters"
  | "animation"
  | "environment"
  | "objects"
  | "editor"
  | "library";

interface PixelStudioPageProps {
  onToast: (message: string, tone?: "info" | "error") => void;
}

const TABS: Array<{ id: PixelTab; label: string; icon: React.ReactNode }> = [
  { id: "generate", label: "Generate", icon: <Wand2 className="w-3.5 h-3.5" /> },
  { id: "characters", label: "Characters", icon: <Users className="w-3.5 h-3.5" /> },
  { id: "animation", label: "Animation", icon: <Film className="w-3.5 h-3.5" /> },
  { id: "environment", label: "Environment", icon: <Trees className="w-3.5 h-3.5" /> },
  { id: "objects", label: "Objects & FX", icon: <Boxes className="w-3.5 h-3.5" /> },
  { id: "editor", label: "Editor", icon: <Pencil className="w-3.5 h-3.5" /> },
  { id: "library", label: "Library", icon: <FolderKanban className="w-3.5 h-3.5" /> },
];

const PROJECT_STORAGE_KEY = "kirea.pixel.project";

export const PixelStudioPage: React.FC<PixelStudioPageProps> = ({ onToast }) => {
  const [projects, setProjects] = useState<PixelProject[]>([]);
  const [projectId, setProjectId] = useState("");
  const [characters, setCharacters] = useState<PixelCharacter[]>([]);
  const [assets, setAssets] = useState<PixelAssetRecord[]>([]);
  const [tab, setTab] = useState<PixelTab>("generate");
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [detail, setDetail] = useState<PixelAssetDetail | null>(null);
  const [initialFrameIndex, setInitialFrameIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [projectForm, setProjectForm] = useState({
    name: "",
    description: "",
    width: 32,
    height: 32,
  });
  const [projectSaving, setProjectSaving] = useState(false);
  const [deleteProjectOpen, setDeleteProjectOpen] = useState(false);

  const activeProject = projects.find((project) => project.id === projectId) ?? null;

  const loadProjects = useCallback(async (selectId?: string): Promise<void> => {
    const list = await window.kirea.listPixelProjects();
    setProjects(list);
    setProjectId((current) => {
      if (selectId && list.some((project) => project.id === selectId)) return selectId;
      if (current && list.some((project) => project.id === current)) return current;
      const stored = localStorage.getItem(PROJECT_STORAGE_KEY);
      const storedMatch = stored ? list.find((project) => project.id === stored) : undefined;
      return storedMatch ? storedMatch.id : list[0]?.id ?? "";
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await window.kirea.listPixelProjects();
        if (cancelled) return;
        setProjects(list);
        const stored = localStorage.getItem(PROJECT_STORAGE_KEY);
        const storedMatch = stored ? list.find((project) => project.id === stored) : undefined;
        const chosen = storedMatch?.id ?? list[0]?.id ?? "";
        setProjectId(chosen);
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error ? loadError.message : "Could not open Pixel Studio."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!projectId) {
      setCharacters([]);
      setAssets([]);
      return;
    }
    localStorage.setItem(PROJECT_STORAGE_KEY, projectId);
    let cancelled = false;
    setError(null);
    setSelectedAssetId("");
    setDetail(null);
    void (async () => {
      try {
        const [characterList, assetList] = await Promise.all([
          window.kirea.listPixelCharacters(projectId),
          window.kirea.listPixelAssets({ projectId }),
        ]);
        if (cancelled) return;
        setCharacters(characterList);
        setAssets(assetList);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Could not load the project.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    if (!selectedAssetId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    void window.kirea
      .getPixelAsset(selectedAssetId)
      .then((asset) => {
        if (!cancelled) setDetail(asset);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setDetail(null);
          onToast(
            loadError instanceof Error ? loadError.message : "Could not open the asset.",
            "error"
          );
        }
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedAssetId, onToast]);

  const refreshAssets = useCallback(async (): Promise<void> => {
    if (!projectId) return;
    const list = await window.kirea.listPixelAssets({ projectId });
    setAssets(list);
    setSelectedAssetId((current) => {
      if (current && list.some((asset) => asset.id === current)) return current;
      return "";
    });
  }, [projectId]);

  const refreshCharacters = useCallback(async (): Promise<void> => {
    if (!projectId) return;
    setCharacters(await window.kirea.listPixelCharacters(projectId));
  }, [projectId]);

  const inspect = (assetId: string, target: "animation" | "editor"): void => {
    setSelectedAssetId(assetId);
    setInitialFrameIndex(0);
    setTab(target);
  };

  const openEditorAt = (assetId: string, frameIndex: number): void => {
    setSelectedAssetId(assetId);
    setInitialFrameIndex(frameIndex);
    setTab("editor");
  };

  const handleGenerated = async (details: PixelAssetDetail[]): Promise<void> => {
    await refreshAssets();
    if (details[0]) setSelectedAssetId(details[0].id);
  };

  const handleImported = async (imported: PixelAssetDetail): Promise<void> => {
    await refreshAssets();
    setSelectedAssetId(imported.id);
  };

  const saveFrames = async (
    assetId: string,
    frames: PixelFrameInput[],
    dimensions?: { width: number; height: number }
  ): Promise<void> => {
    const updated = await window.kirea.savePixelAssetFrames(assetId, frames, dimensions);
    setDetail(updated);
    await refreshAssets();
  };

  const saveProject = async (): Promise<void> => {
    if (!projectForm.name.trim()) {
      onToast("Give the project a name.", "error");
      return;
    }
    setProjectSaving(true);
    try {
      const saved = await window.kirea.savePixelProject({
        name: projectForm.name.trim(),
        description: projectForm.description.trim(),
        width: Math.max(8, Math.min(256, projectForm.width)),
        height: Math.max(8, Math.min(256, projectForm.height)),
      });
      await loadProjects(saved.id);
      setProjectModalOpen(false);
      setProjectForm({ name: "", description: "", width: 32, height: 32 });
      onToast(`Created project ${saved.name}.`, "info");
    } catch (saveError) {
      onToast(
        saveError instanceof Error ? saveError.message : "Could not create the project.",
        "error"
      );
    } finally {
      setProjectSaving(false);
    }
  };

  const removeProject = async (): Promise<void> => {
    if (!activeProject) return;
    try {
      await window.kirea.deletePixelProject(activeProject.id);
      setSelectedAssetId("");
      setDetail(null);
      await loadProjects();
      onToast(`Deleted project ${activeProject.name}.`, "info");
    } catch (deleteError) {
      onToast(
        deleteError instanceof Error ? deleteError.message : "Could not delete the project.",
        "error"
      );
    }
  };

  if (loading) {
    return (
      <div className="space-y-4 p-1">
        <Skeleton height={48} />
        <Skeleton height={36} />
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton height={320} />
          <Skeleton height={320} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-8">
      <SectionHeader
        title="Pixel Studio"
        subtitle="Local pixel art and game-asset production: real frames, real timelines, real exports. ComfyUI image generation stays untouched in Create Studio."
        actions={
          <>
            <Select
              className="w-56"
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              aria-label="Pixel project"
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </Select>
            <Button variant="secondary" onClick={() => setProjectModalOpen(true)}>
              <Plus className="w-3.5 h-3.5" /> Project
            </Button>
            <Button
              variant="utility"
              aria-label="Delete project"
              disabled={!activeProject || projects.length <= 1}
              onClick={() => setDeleteProjectOpen(true)}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="accent">Pixelbolt 0.17 · local</Badge>
        <Badge tone="neutral">{assets.length} assets</Badge>
        <Badge tone="neutral">{characters.length} characters</Badge>
        {activeProject && (
          <span className="text-[11px] text-fg-faint">
            {activeProject.name}
            {activeProject.description ? ` — ${activeProject.description}` : ""}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1.5 text-[11px] text-fg-faint">
          <Grid3X3 className="w-3 h-3" /> 8–256 px per side · nearest-neighbour exports
        </span>
      </div>

      <Card className="p-1.5">
        <nav className="flex flex-wrap gap-1" aria-label="Pixel Studio sections">
          {TABS.map((entry) => {
            const active = tab === entry.id;
            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => setTab(entry.id)}
                aria-current={active ? "page" : undefined}
                className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-[11px] font-semibold transition-colors ${
                  active
                    ? "bg-surface-subtle text-fg border border-border-strong"
                    : "text-fg-muted border border-transparent hover:text-fg hover:bg-surface-subtle"
                }`}
              >
                {entry.icon}
                {entry.label}
              </button>
            );
          })}
        </nav>
      </Card>

      {error && (
        <Card className="p-3 border-danger/40 bg-danger-soft/40">
          <p className="text-[12px] text-danger">{error}</p>
        </Card>
      )}

      {!projectId ? (
        <Card className="p-6 text-center space-y-3">
          <p className="text-h2 text-fg">Create your first pixel project</p>
          <p className="text-small text-fg-muted">
            Projects group characters, assets, animations and exports.
          </p>
          <Button variant="accent" onClick={() => setProjectModalOpen(true)}>
            <Plus className="w-4 h-4" /> New project
          </Button>
        </Card>
      ) : (
        <>
          {tab === "generate" && (
            <GenerateStudioPanel
              mode="all"
              projectId={projectId}
              characters={characters}
              onGenerated={(details) => void handleGenerated(details)}
              onInspect={inspect}
              onToast={onToast}
            />
          )}

          {tab === "characters" && (
            <CharacterStudioPanel
              projectId={projectId}
              characters={characters}
              assets={assets}
              onCharactersChanged={refreshCharacters}
              onGenerated={(details) => void handleGenerated(details)}
              onInspect={inspect}
              onToast={onToast}
            />
          )}

          {tab === "animation" && (
            <AnimationStudioPanel
              assets={assets}
              detail={detail}
              selectedAssetId={selectedAssetId}
              onSelectAsset={(id) => {
                setSelectedAssetId(id);
                setInitialFrameIndex(0);
              }}
              onSaveFrames={saveFrames}
              onOpenEditor={openEditorAt}
              onToast={onToast}
            />
          )}

          {tab === "environment" && (
            <GenerateStudioPanel
              mode="environment"
              projectId={projectId}
              characters={characters}
              onGenerated={(details) => void handleGenerated(details)}
              onInspect={inspect}
              onToast={onToast}
            />
          )}

          {tab === "objects" && (
            <GenerateStudioPanel
              mode="objects"
              projectId={projectId}
              characters={characters}
              onGenerated={(details) => void handleGenerated(details)}
              onInspect={inspect}
              onToast={onToast}
            />
          )}

          {tab === "editor" && (
            <PixelEditorPanel
              assets={assets}
              detail={detail}
              selectedAssetId={selectedAssetId}
              initialFrameIndex={initialFrameIndex}
              onSelectAsset={(id) => {
                setSelectedAssetId(id);
                setInitialFrameIndex(0);
              }}
              onSaveFrames={saveFrames}
              onToast={onToast}
            />
          )}

          {tab === "library" && (
            <AssetLibraryPanel
              projectId={projectId}
              assets={assets}
              characters={characters}
              selectedAssetId={selectedAssetId}
              onSelectAsset={setSelectedAssetId}
              onAssetsChanged={refreshAssets}
              onImported={(imported) => void handleImported(imported)}
              onInspect={inspect}
              onToast={onToast}
            />
          )}

          {detailLoading && (tab === "animation" || tab === "editor") && (
            <p className="text-[11px] text-fg-faint">Loading frames…</p>
          )}
        </>
      )}

      <Modal
        open={projectModalOpen}
        onClose={() => setProjectModalOpen(false)}
        title="New pixel project"
        maxWidthClass="max-w-md"
      >
        <div className="space-y-3">
          <PixelField label="Name">
            <Input
              value={projectForm.name}
              onChange={(event) =>
                setProjectForm((prev) => ({ ...prev, name: event.target.value }))
              }
              maxLength={120}
              autoFocus
            />
          </PixelField>
          <PixelField label="Description">
            <Textarea
              rows={2}
              value={projectForm.description}
              onChange={(event) =>
                setProjectForm((prev) => ({ ...prev, description: event.target.value }))
              }
              maxLength={500}
            />
          </PixelField>
          <div className="grid grid-cols-2 gap-3">
            <PixelField label="Default width">
              <Input
                type="number"
                min={8}
                max={256}
                value={projectForm.width}
                onChange={(event) =>
                  setProjectForm((prev) => ({
                    ...prev,
                    width: Number(event.target.value) || 8,
                  }))
                }
              />
            </PixelField>
            <PixelField label="Default height">
              <Input
                type="number"
                min={8}
                max={256}
                value={projectForm.height}
                onChange={(event) =>
                  setProjectForm((prev) => ({
                    ...prev,
                    height: Number(event.target.value) || 8,
                  }))
                }
              />
            </PixelField>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setProjectModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="accent" loading={projectSaving} onClick={() => void saveProject()}>
              Create project
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={deleteProjectOpen}
        onClose={() => setDeleteProjectOpen(false)}
        onConfirm={() => void removeProject()}
        title="Delete project"
        description={`Delete ${activeProject?.name ?? "this project"} and every asset file inside it? This cannot be undone.`}
        confirmLabel="Delete project"
      />
    </div>
  );
};
