import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  Check,
  ImageIcon,
  LayoutGrid,
  ListOrdered,
  Pencil,
  Play,
  Plus,
  Sparkles,
  Trash2,
  UserRound,
  Users,
} from "lucide-react";
import {
  STORY_CAST_ROLE_LABELS,
  STORY_SCENE_STATUS_LABELS,
} from "../../shared/story-utils";
import {
  evaluateLoraCompatibility,
  getEffectiveArchitecture,
  isGenerationSupportedArchitecture,
} from "../../shared/model-utils";
import type {
  AppSettings,
  CharacterProfile,
  CharacterReferenceMode,
  GeneratedImageRecord,
  GenerationJob,
  LoraRecipe,
  ModelRecord,
  Story,
  StoryCanvas,
  StoryCanvasInput,
  StoryCanvasItemInput,
  StoryCastInput,
  StoryCastRole,
  StoryExportResult,
  StoryInput,
  StoryScene,
  StorySceneCastInput,
  StorySceneInput,
  StoryScenePlan,
  StorySceneStatus,
} from "../../shared/types";
import { shortModelLabel, toMediaUrl } from "../utils/format";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  SectionHeader,
  Select,
} from "../components/ui/Primitives";
import { StoryCanvasWorkspace } from "../components/story/StoryCanvasWorkspace";
import {
  ACTIVE_JOB_STATUSES,
  parseOptionalNumber,
  type SceneFormState,
  sceneStatusTone,
  type StoryFormState,
  storyStatusTone,
  type StoryStudioMode,
  toSceneForm,
  toStoryForm,
} from "../components/story/story-form-types";
import { SceneEditorModal } from "../components/story/SceneEditorModal";
import { StoryEditorModal } from "../components/story/StoryEditorModal";

interface StoryStudioPageProps {
  stories: Story[];
  canvases: StoryCanvas[];
  characters: CharacterProfile[];
  models: ModelRecord[];
  recipes: LoraRecipe[];
  images: GeneratedImageRecord[];
  jobs: GenerationJob[];
  settings: AppSettings;
  onSaveStory: (input: StoryInput) => Promise<Story>;
  onDeleteStory: (id: string) => Promise<boolean>;
  onSaveScene: (input: StorySceneInput) => Promise<Story>;
  onDeleteScene: (storyId: string, sceneId: string) => Promise<Story | null>;
  onReorderScenes: (storyId: string, sceneIds: string[]) => Promise<Story | null>;
  onSelectSceneImage: (
    storyId: string,
    sceneId: string,
    imageId: string | null
  ) => Promise<Story | null>;
  onGenerateScene: (storyId: string, sceneId: string) => Promise<GenerationJob[]>;
  onGenerateStory: (storyId: string) => Promise<GenerationJob[]>;
  onSaveCanvas: (input: StoryCanvasInput) => Promise<StoryCanvas>;
  onDeleteCanvas: (id: string) => Promise<boolean>;
  onSaveCanvasItem: (input: StoryCanvasItemInput) => Promise<StoryCanvas>;
  onDeleteCanvasItem: (
    canvasId: string,
    itemId: string
  ) => Promise<StoryCanvas | null>;
  onReorderCanvasItems: (
    canvasId: string,
    itemIds: string[]
  ) => Promise<StoryCanvas | null>;
  onSyncCanvas: (canvasId: string) => Promise<StoryCanvas | null>;
  onExportCanvasPng: (canvasId: string) => Promise<StoryExportResult | null>;
  onExportCanvasPdf: (canvasId: string) => Promise<StoryExportResult | null>;
  onOpenCanvasExportFolder: (storyId: string) => Promise<void>;
  onInspectImage: (image: GeneratedImageRecord) => void;
  onToast: (message: string, tone?: "info" | "error") => void;
}

export const StoryStudioPage: React.FC<StoryStudioPageProps> = ({
  stories,
  canvases,
  characters,
  models,
  recipes,
  images,
  jobs,
  settings,
  onSaveStory,
  onDeleteStory,
  onSaveScene,
  onDeleteScene,
  onReorderScenes,
  onSelectSceneImage,
  onGenerateScene,
  onGenerateStory,
  onSaveCanvas,
  onDeleteCanvas,
  onSaveCanvasItem,
  onDeleteCanvasItem,
  onReorderCanvasItems,
  onSyncCanvas,
  onExportCanvasPng,
  onExportCanvasPdf,
  onOpenCanvasExportFolder,
  onInspectImage,
  onToast,
}) => {
  const [studioMode, setStudioMode] = useState<StoryStudioMode>("scenes");
  const [selectedStoryId, setSelectedStoryId] = useState<string | null>(null);
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);

  const [storyModalOpen, setStoryModalOpen] = useState(false);
  const [storyForm, setStoryForm] = useState<StoryFormState>(() => toStoryForm(null));
  const [savingStory, setSavingStory] = useState(false);

  const [newCastId, setNewCastId] = useState("");

  const [sceneModalOpen, setSceneModalOpen] = useState(false);
  const [sceneForm, setSceneForm] = useState<SceneFormState>(() => toSceneForm(null));
  const [editingSceneId, setEditingSceneId] = useState<string | null>(null);
  const [savingScene, setSavingScene] = useState(false);
  const [plan, setPlan] = useState<StoryScenePlan | null>(null);
  const [planLoading, setPlanLoading] = useState(false);

  const [generatingSceneId, setGeneratingSceneId] = useState<string | null>(null);
  const [generatingStory, setGeneratingStory] = useState(false);
  const [confirmGenerateStory, setConfirmGenerateStory] = useState(false);
  const [deleteStoryOpen, setDeleteStoryOpen] = useState(false);
  const [sceneDeleteTarget, setSceneDeleteTarget] = useState<StoryScene | null>(null);

  const activeStory = useMemo(
    () =>
      stories.find((story) => story.id === selectedStoryId) ??
      stories[0] ??
      null,
    [stories, selectedStoryId]
  );

  const activeScene = useMemo(
    () =>
      activeStory?.scenes.find((scene) => scene.id === selectedSceneId) ??
      activeStory?.scenes[0] ??
      null,
    [activeStory, selectedSceneId]
  );

  const characterMap = useMemo(
    () => new Map(characters.map((character) => [character.id, character])),
    [characters]
  );

  const checkpointModels = useMemo(
    () =>
      models.filter(
        (model) =>
          model.installed &&
          (model.category === "checkpoint" ||
            (model.category === "diffusion_model" &&
              ["z_image", "anima"].includes(getEffectiveArchitecture(model)))) &&
          isGenerationSupportedArchitecture(getEffectiveArchitecture(model))
      ),
    [models]
  );

  const storyCheckpointArch = useMemo(() => {
    const model = checkpointModels.find(
      (candidate) =>
        candidate.relativePath === storyForm.defaultCheckpointPath
    );
    return model ? getEffectiveArchitecture(model) : "unknown";
  }, [checkpointModels, storyForm.defaultCheckpointPath]);

  const storyRecipes = useMemo(
    () =>
      recipes.filter(
        (recipe) =>
          recipe.id === storyForm.defaultLoraRecipeId ||
          recipe.items
            .filter((item) => item.enabled)
            .every(
              (item) =>
                evaluateLoraCompatibility(item.architecture, storyCheckpointArch)
                  .compatible
            )
      ),
    [recipes, storyForm.defaultLoraRecipeId, storyCheckpointArch]
  );

  const sceneCheckpointArch = useMemo(() => {
    const reference = sceneForm.checkpointPath || storyForm.defaultCheckpointPath;
    const model = checkpointModels.find(
      (candidate) => candidate.relativePath === reference
    );
    return model ? getEffectiveArchitecture(model) : "unknown";
  }, [checkpointModels, sceneForm.checkpointPath, storyForm.defaultCheckpointPath]);

  const sceneRecipes = useMemo(
    () =>
      recipes.filter(
        (recipe) =>
          recipe.id === sceneForm.loraRecipeId ||
          recipe.items
            .filter((item) => item.enabled)
            .every(
              (item) =>
                evaluateLoraCompatibility(item.architecture, sceneCheckpointArch)
                  .compatible
            )
      ),
    [recipes, sceneForm.loraRecipeId, sceneCheckpointArch]
  );

  const importedImagesByScene = useMemo(() => {
    const map = new Map<string, GeneratedImageRecord[]>();
    for (const image of images) {
      if (!image.storySceneId) continue;
      const bucket = map.get(image.storySceneId) ?? [];
      bucket.push(image);
      map.set(image.storySceneId, bucket);
    }
    return map;
  }, [images]);

  const availableCastCharacters = useMemo(() => {
    const used = new Set(storyForm.cast.map((member) => member.characterId));
    return characters.filter((character) => !used.has(character.id));
  }, [characters, storyForm.cast]);

  const sceneJobBySceneId = useMemo(() => {
    const map = new Map<string, GenerationJob>();
    for (const job of jobs) {
      if (!job.storySceneId || !ACTIVE_JOB_STATUSES.has(job.status)) continue;
      map.set(job.storySceneId, job);
    }
    return map;
  }, [jobs]);

  const openNewStory = (): void => {
    setStoryForm(toStoryForm(null));
    setNewCastId("");
    setStoryModalOpen(true);
  };

  const openEditStory = (): void => {
    if (!activeStory) return;
    setStoryForm(toStoryForm(activeStory));
    setNewCastId("");
    setStoryModalOpen(true);
  };

  const handleSaveStory = async (): Promise<void> => {
    if (!storyForm.title.trim()) {
      onToast("Give the story a title first.", "error");
      return;
    }
    setSavingStory(true);
    try {
      const saved = await onSaveStory({
        ...(activeStory ? { id: activeStory.id } : {}),
        title: storyForm.title.trim(),
        logline: storyForm.logline,
        stylePrompt: storyForm.stylePrompt,
        negativePrompt: storyForm.negativePrompt,
        defaultCharacterId: storyForm.defaultCharacterId || null,
        defaultCheckpointPath: storyForm.defaultCheckpointPath || null,
        defaultLoraRecipeId: storyForm.defaultLoraRecipeId || null,
        cast: storyForm.cast.filter((member) => member.characterId),
      });
      setSelectedStoryId(saved.id);
      setSelectedSceneId(saved.scenes[0]?.id ?? null);
      setStoryModalOpen(false);
      onToast(activeStory ? `Saved '${saved.title}'.` : `Created '${saved.title}'.`);
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setSavingStory(false);
    }
  };

  const addStoryCastMember = (): void => {
    if (!newCastId) return;
    setStoryForm((prev) => ({
      ...prev,
      cast: [...prev.cast, { characterId: newCastId, storyRole: "supporting" }],
    }));
    setNewCastId("");
  };

  const updateStoryCastRole = (characterId: string, role: StoryCastRole): void => {
    setStoryForm((prev) => ({
      ...prev,
      cast: prev.cast.map((member) =>
        member.characterId === characterId ? { ...member, storyRole: role } : member
      ),
    }));
  };

  const removeStoryCastMember = (characterId: string): void => {
    setStoryForm((prev) => ({
      ...prev,
      cast: prev.cast.filter((member) => member.characterId !== characterId),
    }));
  };

  const openNewScene = async (): Promise<void> => {
    if (!activeStory) return;
    try {
      const updated = await onSaveScene({
        storyId: activeStory.id,
        title: `Scene ${activeStory.scenes.length + 1}`,
        prompt: "",
      });
      const created = updated.scenes[updated.scenes.length - 1] ?? null;
      setSelectedSceneId(created?.id ?? null);
      if (created) {
        setEditingSceneId(created.id);
        setSceneForm(toSceneForm(created));
        setSceneModalOpen(true);
      }
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "error");
    }
  };

  const openEditScene = (scene: StoryScene): void => {
    setSelectedSceneId(scene.id);
    setEditingSceneId(scene.id);
    setSceneForm(toSceneForm(scene));
    setSceneModalOpen(true);
  };

  const handleSaveScene = async (): Promise<void> => {
    if (!activeStory || !editingSceneId) return;
    const seed = parseOptionalNumber(sceneForm.seed);
    setSavingScene(true);
    try {
      const updated = await onSaveScene({
        id: editingSceneId,
        storyId: activeStory.id,
        title: sceneForm.title.trim() || "Untitled scene",
        synopsis: sceneForm.synopsis,
        prompt: sceneForm.prompt,
        negativePrompt: sceneForm.negativePrompt,
        checkpointPath: sceneForm.checkpointPath || null,
        loraRecipeId: sceneForm.loraRecipeId || null,
        aspectRatio: sceneForm.aspectRatio || null,
        width: parseOptionalNumber(sceneForm.width),
        height: parseOptionalNumber(sceneForm.height),
        steps: parseOptionalNumber(sceneForm.steps),
        cfg: parseOptionalNumber(sceneForm.cfg),
        seed: seed !== null ? Math.floor(seed) : -1,
        denoise: parseOptionalNumber(sceneForm.denoise),
        referenceModeOverride: sceneForm.referenceModeOverride || null,
        batchCount: Math.max(
          1,
          Math.min(8, Math.floor(parseOptionalNumber(sceneForm.batchCount) ?? 1))
        ),
        cast: sceneForm.cast,
      });
      setSelectedSceneId(editingSceneId);
      setSavingScene(false);
      setSceneModalOpen(false);
      onToast(`Saved '${updated.scenes.find((s) => s.id === editingSceneId)?.title ?? "scene"}'.`);
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "error");
      setSavingScene(false);
    }
  };

  const toggleSceneCastMember = (characterId: string): void => {
    setSceneForm((prev) => {
      const exists = prev.cast.some((member) => member.characterId === characterId);
      return {
        ...prev,
        cast: exists
          ? prev.cast.filter((member) => member.characterId !== characterId)
          : [...prev.cast, { characterId, roleHint: "" }],
      };
    });
  };

  const moveScene = async (scene: StoryScene, direction: -1 | 1): Promise<void> => {
    if (!activeStory) return;
    const ids = activeStory.scenes.map((item) => item.id);
    const index = ids.indexOf(scene.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ids.length) return;
    const next = [...ids];
    const [moved] = next.splice(index, 1);
    if (!moved) return;
    next.splice(target, 0, moved);
    try {
      await onReorderScenes(activeStory.id, next);
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "error");
    }
  };

  const handleGenerateScene = async (scene: StoryScene): Promise<void> => {
    if (!activeStory) return;
    setGeneratingSceneId(scene.id);
    try {
      const created = await onGenerateScene(activeStory.id, scene.id);
      onToast(`Queued ${created.length} job${created.length === 1 ? "" : "s"} for '${scene.title}'.`);
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setGeneratingSceneId(null);
    }
  };

  const handleGenerateStory = async (): Promise<void> => {
    if (!activeStory) return;
    setGeneratingStory(true);
    try {
      const created = await onGenerateStory(activeStory.id);
      onToast(
        `Queued ${created.length} job${created.length === 1 ? "" : "s"} across ${activeStory.scenes.length} scene${activeStory.scenes.length === 1 ? "" : "s"}.`
      );
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setGeneratingStory(false);
    }
  };

  const handleSelectSceneImage = async (
    scene: StoryScene,
    imageId: string | null
  ): Promise<void> => {
    if (!activeStory) return;
    try {
      await onSelectSceneImage(activeStory.id, scene.id, imageId);
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "error");
    }
  };

  // Refresh the plan preview whenever the saved scene changes.
  useEffect(() => {
    if (!sceneModalOpen || !activeStory || !editingSceneId) {
      setPlan(null);
      return;
    }
    let cancelled = false;
    setPlanLoading(true);
    const timer = setTimeout(() => {
      void window.kirea
        .planStoryScene(activeStory.id, editingSceneId)
        .then((next) => {
          if (!cancelled) setPlan(next);
        })
        .catch(() => {
          if (!cancelled) setPlan(null);
        })
        .finally(() => {
          if (!cancelled) setPlanLoading(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    sceneModalOpen,
    activeStory?.id,
    activeStory?.updatedAt,
    editingSceneId,
  ]);

  const renderCastNames = (scene: StoryScene): string => {
    if (!activeStory) return "";
    const ids =
      scene.cast.length > 0
        ? scene.cast.map((member) => member.characterId)
        : activeStory.cast.length > 0
          ? activeStory.cast.map((member) => member.characterId)
          : activeStory.defaultCharacterId
            ? [activeStory.defaultCharacterId]
            : [];
    const names = ids
      .map((id) => characterMap.get(id)?.name)
      .filter((name): name is string => Boolean(name));
    return names.length > 0 ? names.join(" · ") : "No cast";
  };

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Story Studio"
        subtitle="Sequence scenes, inherit characters and LoRA recipes, and render the story on stock workflows."
        actions={
          <>
            {activeStory && (
              <Button
                variant="primary"
                loading={generatingStory}
                disabled={activeStory.scenes.length === 0}
                onClick={() => setConfirmGenerateStory(true)}
              >
                <Play className="w-3.5 h-3.5" />
                Queue Story
              </Button>
            )}
            <Button variant="secondary" onClick={openNewStory}>
              <Plus className="w-3.5 h-3.5" />
              New Story
            </Button>
          </>
        }
      />

      {activeStory && (
        <div
          role="tablist"
          aria-label="Story workspace mode"
          className="inline-flex items-center gap-1 p-1 rounded-xl bg-surface border border-border"
        >
          <button
            type="button"
            role="tab"
            aria-selected={studioMode === "scenes"}
            onClick={() => setStudioMode("scenes")}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-small font-semibold transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              studioMode === "scenes"
                ? "bg-accent-solid text-accent-fg"
                : "text-fg-muted hover:text-fg hover:bg-surface-subtle"
            }`}
          >
            <ListOrdered className="w-3.5 h-3.5" />
            Scene Builder
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={studioMode === "canvas"}
            onClick={() => setStudioMode("canvas")}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-small font-semibold transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              studioMode === "canvas"
                ? "bg-accent-solid text-accent-fg"
                : "text-fg-muted hover:text-fg hover:bg-surface-subtle"
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            Story Canvas
          </button>
        </div>
      )}

      {stories.length === 0 ? (
        <EmptyState
          icon={<BookOpen className="w-6 h-6" />}
          title="No stories yet"
          description="Create a story to sequence prompts across scenes. Cast members and LoRA recipes carry through every scene automatically."
          action={
            <Button variant="primary" onClick={openNewStory}>
              <Plus className="w-3.5 h-3.5" />
              Create your first story
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
          {/* STORY RAIL */}
          <aside className="space-y-2" aria-label="Stories">
            {stories.map((story) => {
              const isActive = story.id === activeStory?.id;
              return (
                <button
                  key={story.id}
                  type="button"
                  onClick={() => {
                    setSelectedStoryId(story.id);
                    setSelectedSceneId(story.scenes[0]?.id ?? null);
                  }}
                  className={`w-full text-left p-3 rounded-xl border transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    isActive
                      ? "bg-accent-soft border-accent/40"
                      : "bg-surface border-border hover:border-border-strong"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-h3 text-fg">
                      {story.title}
                    </span>
                    <Badge tone={storyStatusTone(story.status)}>
                      {story.status === "in_progress"
                        ? "In progress"
                        : story.status === "complete"
                          ? "Complete"
                          : "Draft"}
                    </Badge>
                  </div>
                  <p className="mt-1 text-small text-fg-muted line-clamp-2 min-h-[2rem]">
                    {story.logline || "No logline yet."}
                  </p>
                  <div className="mt-2 flex items-center gap-2 text-[11px] text-fg-subtle">
                    <span className="inline-flex items-center gap-1">
                      <Sparkles className="w-3 h-3" />
                      {story.scenes.length} scene
                      {story.scenes.length === 1 ? "" : "s"}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Users className="w-3 h-3" />
                      {story.cast.length} cast
                    </span>
                  </div>
                </button>
              );
            })}
          </aside>

          {/* STORY WORKSPACE */}
          {activeStory && (
            <section className="space-y-4 min-w-0">
              <Card className="p-4 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-bold text-fg truncate">
                        {activeStory.title}
                      </h2>
                      <Badge tone={storyStatusTone(activeStory.status)}>
                        {activeStory.status === "in_progress"
                          ? "In progress"
                          : activeStory.status === "complete"
                            ? "Complete"
                            : "Draft"}
                      </Badge>
                    </div>
                    <p className="mt-1 text-small text-fg-muted">
                      {activeStory.logline || "No logline yet."}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="secondary" onClick={openEditStory}>
                      <Pencil className="w-3.5 h-3.5" />
                      Edit story
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => setDeleteStoryOpen(true)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Delete
                    </Button>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {activeStory.cast.length === 0 && !activeStory.defaultCharacterId && (
                    <span className="text-small text-fg-subtle">
                      No story cast yet — scenes can still add their own cast.
                    </span>
                  )}
                  {activeStory.cast.map((member) => {
                    const character = characterMap.get(member.characterId);
                    if (!character) return null;
                    return (
                      <Badge key={member.characterId} tone="neutral">
                        <UserRound className="w-3 h-3" />
                        {character.name}
                        <span className="text-fg-subtle">
                          {STORY_CAST_ROLE_LABELS[member.storyRole].toLowerCase()}
                        </span>
                      </Badge>
                    );
                  })}
                  {activeStory.defaultCharacterId &&
                    !activeStory.cast.some(
                      (member) => member.characterId === activeStory.defaultCharacterId
                    ) && (
                      <Badge tone="neutral">
                        <UserRound className="w-3 h-3" />
                        {characterMap.get(activeStory.defaultCharacterId)?.name ??
                          "Default character"}
                        <span className="text-fg-subtle">default</span>
                      </Badge>
                    )}
                </div>
              </Card>

              {studioMode === "canvas" ? (
                <StoryCanvasWorkspace
                  story={activeStory}
                  canvases={canvases}
                  images={images}
                  onSaveCanvas={onSaveCanvas}
                  onDeleteCanvas={onDeleteCanvas}
                  onSaveCanvasItem={onSaveCanvasItem}
                  onDeleteCanvasItem={onDeleteCanvasItem}
                  onReorderCanvasItems={onReorderCanvasItems}
                  onSyncCanvas={onSyncCanvas}
                  onExportCanvasPng={onExportCanvasPng}
                  onExportCanvasPdf={onExportCanvasPdf}
                  onOpenExportFolder={onOpenCanvasExportFolder}
                  onToast={onToast}
                />
              ) : (
                <>
              <div className="flex items-center justify-between">
                <h3 className="text-h3 text-fg">
                  Scene timeline
                  <span className="ml-2 text-small font-normal text-fg-subtle">
                    {activeStory.scenes.length} scene
                    {activeStory.scenes.length === 1 ? "" : "s"}
                  </span>
                </h3>
                <Button size="sm" variant="secondary" onClick={() => void openNewScene()}>
                  <Plus className="w-3.5 h-3.5" />
                  Add scene
                </Button>
              </div>

              {activeStory.scenes.length === 0 ? (
                <EmptyState
                  icon={<Sparkles className="w-6 h-6" />}
                  title="This story has no scenes"
                  description="Add the first scene, write the prompt, and assign cast. Queue the whole story once the sequence reads well."
                  action={
                    <Button variant="primary" onClick={() => void openNewScene()}>
                      <Plus className="w-3.5 h-3.5" />
                      Add the first scene
                    </Button>
                  }
                />
              ) : (
                <div className="space-y-3">
                  {activeStory.scenes.map((scene, index) => {
                    const sceneImages = importedImagesByScene.get(scene.id) ?? [];
                    const selectedImage =
                      sceneImages.find((image) => image.id === scene.selectedImageId) ??
                      null;
                    const activeJob = sceneJobBySceneId.get(scene.id) ?? null;
                    const isSelected = scene.id === activeScene?.id;
                    const isGenerating = generatingSceneId === scene.id;

                    return (
                      <Card
                        key={scene.id}
                        className={`p-3.5 transition-colors ${
                          isSelected ? "border-accent/50" : ""
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <button
                            type="button"
                            onClick={() => setSelectedSceneId(scene.id)}
                            aria-label={`Select scene ${index + 1}`}
                            className={`w-8 h-8 shrink-0 rounded-full border text-small font-bold tabular-nums flex items-center justify-center cursor-pointer ${
                              isSelected
                                ? "bg-accent-solid text-accent-fg border-accent"
                                : "bg-surface-subtle text-fg-muted border-border"
                            }`}
                          >
                            {index + 1}
                          </button>

                          <div className="flex-1 min-w-0 space-y-1.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setSelectedSceneId(scene.id)}
                                className="truncate text-h3 text-fg hover:text-accent cursor-pointer py-0.5"
                              >
                                {scene.title || "Untitled scene"}
                              </button>
                              <Badge tone={sceneStatusTone(scene.status)}>
                                {STORY_SCENE_STATUS_LABELS[scene.status]}
                                {activeJob &&
                                  activeJob.progressMax > 0 &&
                                  ` ${Math.round(
                                    (activeJob.progressStep / activeJob.progressMax) * 100
                                  )}%`}
                              </Badge>
                              {scene.referenceModeOverride && (
                                <Badge tone="neutral">
                                  ref: {scene.referenceModeOverride}
                                </Badge>
                              )}
                            </div>
                            <p className="text-small text-fg-muted line-clamp-2">
                              {scene.prompt || scene.synopsis || "No prompt yet."}
                            </p>
                            <p className="text-[11px] text-fg-subtle truncate">
                              Cast: {renderCastNames(scene)}
                            </p>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-label="Move scene up"
                              disabled={index === 0}
                              onClick={() => void moveScene(scene, -1)}
                            >
                              <ArrowUp className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-label="Move scene down"
                              disabled={index === activeStory.scenes.length - 1}
                              onClick={() => void moveScene(scene, 1)}
                            >
                              <ArrowDown className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-label="Edit scene"
                              onClick={() => openEditScene(scene)}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="primary"
                              loading={isGenerating}
                              disabled={Boolean(activeJob)}
                              onClick={() => void handleGenerateScene(scene)}
                            >
                              <Play className="w-3.5 h-3.5" />
                              Generate
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-label="Delete scene"
                              onClick={() => setSceneDeleteTarget(scene)}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </div>

                        {(selectedImage || sceneImages.length > 0) && (
                          <div className="mt-3 pt-3 border-t border-border flex items-start gap-3">
                            {selectedImage ? (
                              <button
                                type="button"
                                onClick={() => onInspectImage(selectedImage)}
                                className="shrink-0 cursor-pointer group"
                                aria-label="Inspect selected scene image"
                              >
                                <img
                                  src={toMediaUrl(selectedImage.filePath)}
                                  alt={`${scene.title} selected result`}
                                  className="w-20 h-20 rounded-lg object-cover border border-accent/40 group-hover:opacity-90"
                                />
                              </button>
                            ) : (
                              <div className="w-20 h-20 rounded-lg bg-surface-subtle border border-border flex items-center justify-center text-fg-subtle shrink-0">
                                <ImageIcon className="w-5 h-5" />
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="text-[11px] text-fg-subtle mb-1.5">
                                {sceneImages.length} render
                                {sceneImages.length === 1 ? "" : "s"} for this scene
                                {selectedImage ? " · selected" : " · pick a key frame"}
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {sceneImages.slice(0, 6).map((image) => {
                                  const isChosen = image.id === scene.selectedImageId;
                                  return (
                                    <button
                                      key={image.id}
                                      type="button"
                                      onClick={() =>
                                        void handleSelectSceneImage(
                                          scene,
                                          isChosen ? null : image.id
                                        )
                                      }
                                      aria-label={
                                        isChosen
                                          ? "Clear selected scene image"
                                          : "Use as selected scene image"
                                      }
                                      className={`relative w-12 h-12 rounded-md overflow-hidden border cursor-pointer ${
                                        isChosen
                                          ? "border-accent ring-1 ring-accent"
                                          : "border-border hover:border-border-strong"
                                      }`}
                                    >
                                      <img
                                        src={toMediaUrl(image.filePath)}
                                        alt={image.fileName}
                                        className="w-full h-full object-cover"
                                      />
                                      {isChosen && (
                                        <span className="absolute inset-0 bg-accent/30 flex items-center justify-center">
                                          <Check className="w-4 h-4 text-white" />
                                        </span>
                                      )}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        )}
                      </Card>
                    );
                  })}
                </div>
              )}
                </>
              )}
            </section>
          )}
        </div>
      )}

      <StoryEditorModal
        open={storyModalOpen}
        activeStory={activeStory}
        storyForm={storyForm}
        setStoryForm={setStoryForm}
        characters={characters}
        checkpointModels={checkpointModels}
        storyRecipes={storyRecipes}
        characterMap={characterMap}
        availableCastCharacters={availableCastCharacters}
        newCastId={newCastId}
        setNewCastId={setNewCastId}
        savingStory={savingStory}
        onAddCastMember={addStoryCastMember}
        onUpdateCastRole={updateStoryCastRole}
        onRemoveCastMember={removeStoryCastMember}
        onClose={() => setStoryModalOpen(false)}
        onSave={() => void handleSaveStory()}
      />

      <SceneEditorModal
        open={sceneModalOpen}
        editingSceneId={editingSceneId}
        activeStory={activeStory}
        sceneForm={sceneForm}
        setSceneForm={setSceneForm}
        characters={characters}
        checkpointModels={checkpointModels}
        sceneRecipes={sceneRecipes}
        characterMap={characterMap}
        settings={settings}
        plan={plan}
        planLoading={planLoading}
        savingScene={savingScene}
        onToggleCastMember={toggleSceneCastMember}
        onClose={() => setSceneModalOpen(false)}
        onSave={() => void handleSaveScene()}
      />

      <ConfirmDialog
        open={confirmGenerateStory}
        onClose={() => setConfirmGenerateStory(false)}
        onConfirm={() => void handleGenerateStory()}
        title="Queue the whole story?"
        description={`This submits ${activeStory?.scenes.length ?? 0} scene${
          (activeStory?.scenes.length ?? 0) === 1 ? "" : "s"
        } through the existing job queue. Jobs run sequentially on the connected ComfyUI engine.`}
        confirmLabel="Queue story"
        danger={false}
      />

      <ConfirmDialog
        open={deleteStoryOpen}
        onClose={() => setDeleteStoryOpen(false)}
        onConfirm={() => {
          if (!activeStory) return;
          void onDeleteStory(activeStory.id)
            .then((deleted) => {
              if (deleted) {
                setSelectedStoryId(null);
                setSelectedSceneId(null);
                onToast("Deleted story.");
              }
            })
            .catch((err: unknown) =>
              onToast(err instanceof Error ? err.message : String(err), "error")
            );
        }}
        title="Delete story"
        description={`Delete '${activeStory?.title ?? "this story"}' and all of its scenes? Generated images stay in the library.`}
        confirmLabel="Delete story"
      />

      <ConfirmDialog
        open={sceneDeleteTarget !== null}
        onClose={() => setSceneDeleteTarget(null)}
        onConfirm={() => {
          if (!activeStory || !sceneDeleteTarget) return;
          void onDeleteScene(activeStory.id, sceneDeleteTarget.id)
            .then(() => {
              if (selectedSceneId === sceneDeleteTarget.id) {
                setSelectedSceneId(null);
              }
              onToast("Deleted scene.");
            })
            .catch((err: unknown) =>
              onToast(err instanceof Error ? err.message : String(err), "error")
            );
        }}
        title="Delete scene"
        description={`Delete '${sceneDeleteTarget?.title ?? "this scene"}'? Remaining scenes renumber automatically.`}
        confirmLabel="Delete scene"
      />
    </div>
  );
};