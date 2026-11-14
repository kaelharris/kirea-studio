import React, { useMemo, useState } from "react";
import {
  Bookmark,
  Copy,
  Layers,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Star,
  Trash2,
} from "lucide-react";
import { PROMPT_SNIPPETS, STUDIO_PRESETS } from "../../shared/presets";
import {
  ARCHITECTURE_LABELS,
  architectureBadgeTone,
  evaluateLoraCompatibility,
  getEffectiveArchitecture,
  getEffectiveModelInfo,
  isGenerationSupportedArchitecture,
} from "../../shared/model-utils";
import type {
  LoraRecipe,
  LoraRecipeInput,
  ModelRecord,
  PromptRecord,
  StudioPreset,
} from "../../shared/types";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Input,
  Modal,
  SectionHeader,
  Select,
  SliderField,
  Textarea,
} from "../components/ui/Primitives";
import { formatRelativeTime, shortModelLabel } from "../utils/format";

interface ExplorePageProps {
  prompts: PromptRecord[];
  recipes: LoraRecipe[];
  activeRecipeId: string | null;
  models: ModelRecord[];
  onApplyPreset: (preset: StudioPreset) => void;
  onApplyPrompt: (prompt: string, negativePrompt: string) => void;
  onLoadRecipe: (recipe: LoraRecipe) => void;
  onSaveRecipe: (input: LoraRecipeInput) => Promise<LoraRecipe>;
  onDeleteRecipe: (id: string) => Promise<void>;
  onSavePrompt: (record: {
    id?: string;
    title: string;
    prompt: string;
    negativePrompt: string;
    tags?: string[];
  }) => Promise<void>;
  onDeletePrompt: (id: string) => Promise<void>;
  onToast: (msg: string, tone?: "info" | "error") => void;
}

interface RecipeLoraDraft {
  name: string;
  strengthModel: number;
  strengthClip: number;
}

interface RecipeEditorState {
  id: string | null;
  name: string;
  description: string;
  basePrompt: string;
  negativePrompt: string;
  checkpointPath: string;
  items: RecipeLoraDraft[];
}

const EMPTY_EDITOR: RecipeEditorState = {
  id: null,
  name: "",
  description: "",
  basePrompt: "",
  negativePrompt: "",
  checkpointPath: "",
  items: [],
};

export const ExplorePage: React.FC<ExplorePageProps> = ({
  prompts,
  recipes,
  activeRecipeId,
  models,
  onApplyPreset,
  onApplyPrompt,
  onLoadRecipe,
  onSaveRecipe,
  onDeleteRecipe,
  onSavePrompt,
  onDeletePrompt,
  onToast,
}) => {
  const [search, setSearch] = useState("");
  const [newModalOpen, setNewModalOpen] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [promptDraft, setPromptDraft] = useState("");
  const [negDraft, setNegDraft] = useState("");
  const [tagsDraft, setTagsDraft] = useState("");

  const [editorOpen, setEditorOpen] = useState(false);
  const [editor, setEditor] = useState<RecipeEditorState>(EMPTY_EDITOR);
  const [savingRecipe, setSavingRecipe] = useState(false);
  const [deleteRecipe, setDeleteRecipe] = useState<LoraRecipe | null>(null);
  const [showIncompatibleLoras, setShowIncompatibleLoras] = useState(false);

  const q = search.trim().toLowerCase();

  const installedCheckpoints = useMemo(
    () =>
      models.filter(
        (m) =>
          m.installed &&
          (m.category === "checkpoint" ||
            (m.category === "diffusion_model" &&
              ["z_image", "anima"].includes(getEffectiveArchitecture(m)))) &&
          isGenerationSupportedArchitecture(getEffectiveArchitecture(m))
      ),
    [models]
  );

  const installedLoras = useMemo(
    () => models.filter((m) => m.installed && m.category === "lora"),
    [models]
  );

  const compatibleEditorLoras = useMemo(() => {
    const checkpoint = installedCheckpoints.find(
      (m) => m.relativePath === editor.checkpointPath
    );
    const arch = checkpoint ? getEffectiveArchitecture(checkpoint) : "unknown";
    return installedLoras.filter(
      (lora) =>
        showIncompatibleLoras ||
        evaluateLoraCompatibility(getEffectiveArchitecture(lora), arch)
          .compatible
    );
  }, [
    installedLoras,
    installedCheckpoints,
    editor.checkpointPath,
    showIncompatibleLoras,
  ]);

  const filteredRecipes = useMemo(() => {
    if (!q) return recipes;
    return recipes.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) ||
        r.basePrompt.toLowerCase().includes(q) ||
        r.tags.some((t) => t.toLowerCase().includes(q)) ||
        r.items.some((item) => item.loraName.toLowerCase().includes(q))
    );
  }, [recipes, q]);

  const filteredPresets = STUDIO_PRESETS.filter(
    (p) =>
      !q ||
      p.title.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      p.category.toLowerCase().includes(q) ||
      p.prompt.toLowerCase().includes(q)
  );

  const filteredSaved = prompts.filter(
    (p) =>
      !q ||
      p.title.toLowerCase().includes(q) ||
      p.prompt.toLowerCase().includes(q) ||
      p.tags.some((t) => t.toLowerCase().includes(q))
  );

  const handleSaveNew = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!titleDraft.trim() || !promptDraft.trim()) return;
    await onSavePrompt({
      title: titleDraft.trim(),
      prompt: promptDraft.trim(),
      negativePrompt: negDraft.trim(),
      tags: tagsDraft
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    });
    setTitleDraft("");
    setPromptDraft("");
    setNegDraft("");
    setTagsDraft("");
    setNewModalOpen(false);
    onToast("Prompt saved to local library.");
  };

  const openEditor = (recipe?: LoraRecipe): void => {
    if (!recipe) {
      setEditor({
        ...EMPTY_EDITOR,
        checkpointPath: installedCheckpoints[0]?.relativePath ?? "",
      });
      setEditorOpen(true);
      return;
    }
    setEditor({
      id: recipe.id,
      name: recipe.name,
      description: recipe.description,
      basePrompt: recipe.basePrompt,
      negativePrompt: recipe.negativePrompt,
      checkpointPath: recipe.checkpointPath ?? "",
      items: recipe.items.map((item) => ({
        name: item.loraPath,
        strengthModel: item.strengthModel,
        strengthClip: item.strengthClip,
      })),
    });
    setEditorOpen(true);
  };

  const addEditorLora = (): void => {
    const unused =
      compatibleEditorLoras.find(
        (l) => !editor.items.some((item) => item.name === l.relativePath)
      ) ?? compatibleEditorLoras[0];
    if (!unused) return;
    setEditor((prev) => ({
      ...prev,
      items: [
        ...prev.items,
        {
          name: unused.relativePath,
          strengthModel: 0.85,
          strengthClip: 0.85,
        },
      ],
    }));
  };

  const handleSaveRecipe = async (): Promise<void> => {
    if (!editor.name.trim()) return;
    setSavingRecipe(true);
    try {
      const checkpoint = installedCheckpoints.find(
        (m) => m.relativePath === editor.checkpointPath
      );
      const architecture = checkpoint
        ? getEffectiveArchitecture(checkpoint)
        : "unknown";
      const existing = recipes.find((r) => r.id === editor.id);

      const saved = await onSaveRecipe({
        id: editor.id ?? undefined,
        name: editor.name.trim(),
        description: editor.description.trim(),
        mode: existing?.mode ?? "txt2img",
        workflowId: existing?.workflowId ?? null,
        architecture,
        checkpointPath: checkpoint?.relativePath ?? null,
        checkpointName: checkpoint
          ? getEffectiveModelInfo(checkpoint).name
          : null,
        basePrompt: editor.basePrompt,
        negativePrompt: editor.negativePrompt,
        settings: existing?.settings ?? {},
        tags: existing?.tags ?? [],
        favorite: existing?.favorite ?? false,
        items: editor.items
          .filter((item) => item.name)
          .map((item) => {
            const model = installedLoras.find(
              (m) => m.relativePath === item.name
            );
            const info = model ? getEffectiveModelInfo(model) : null;
            return {
              loraPath: item.name,
              loraName: info?.name ?? shortModelLabel(item.name),
              architecture: info?.architecture ?? architecture,
              strengthModel: item.strengthModel,
              strengthClip: item.strengthClip,
              enabled: true,
              triggerWords: info?.triggerWords ?? [],
            };
          }),
      });
      setEditorOpen(false);
      onToast(`Saved LoRA recipe '${saved.name}'.`);
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setSavingRecipe(false);
    }
  };

  const toggleFavorite = async (recipe: LoraRecipe): Promise<void> => {
    try {
      await onSaveRecipe({
        id: recipe.id,
        name: recipe.name,
        description: recipe.description,
        mode: recipe.mode,
        workflowId: recipe.workflowId,
        architecture: recipe.architecture,
        checkpointPath: recipe.checkpointPath,
        checkpointName: recipe.checkpointName,
        basePrompt: recipe.basePrompt,
        negativePrompt: recipe.negativePrompt,
        settings: recipe.settings,
        tags: recipe.tags,
        favorite: !recipe.favorite,
        items: recipe.items.map((item) => ({
          loraPath: item.loraPath,
          loraName: item.loraName,
          architecture: item.architecture,
          strengthModel: item.strengthModel,
          strengthClip: item.strengthClip,
          enabled: item.enabled,
          triggerWords: item.triggerWords,
        })),
      });
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "error");
    }
  };

  const editorArch = useMemo(() => {
    const checkpoint = installedCheckpoints.find(
      (m) => m.relativePath === editor.checkpointPath
    );
    return checkpoint ? getEffectiveArchitecture(checkpoint) : "unknown";
  }, [installedCheckpoints, editor.checkpointPath]);

  return (
    <div className="space-y-6">
      <SectionHeader
        sticky
        title="Starter Presets & Prompt Library"
        subtitle="Offline curated starters, reusable LoRA recipes, modular modifiers, and your local saved prompt history."
        actions={
          <div className="flex items-center gap-2">
            <div className="relative w-64">
              <Search className="w-4 h-4 text-fg-subtle absolute left-3 top-2.5" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search presets"
                placeholder="Search presets, recipes, prompts..."
                className="pl-9"
              />
            </div>
            <Button variant="primary" onClick={() => setNewModalOpen(true)}>
              <Plus className="w-4 h-4" />
              New Saved Prompt
            </Button>
          </div>
        }
      />

      {/* LoRA Recipes */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-label">
            LoRA Recipes ({filteredRecipes.length})
          </h2>
          <Button size="sm" variant="secondary" onClick={() => openEditor()}>
            <Plus className="w-3.5 h-3.5" />
            New LoRA Recipe
          </Button>
        </div>

        {filteredRecipes.length === 0 ? (
          <EmptyState
            icon={<Layers className="w-5 h-5" />}
            title="No LoRA recipes yet"
            description="Build a checkpoint plus multi-LoRA stack in Create Studio, then save it as a recipe. Recipes can also be authored here without starting a generation."
            action={
              <Button variant="secondary" onClick={() => openEditor()}>
                <Plus className="w-4 h-4" />
                Create Recipe
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3.5">
            {filteredRecipes.map((recipe) => (
              <Card
                key={recipe.id}
                className={`p-4 flex flex-col justify-between gap-3 ${
                  activeRecipeId === recipe.id ? "border-accent" : ""
                }`}
              >
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={architectureBadgeTone(recipe.architecture)}>
                      {ARCHITECTURE_LABELS[recipe.architecture]}
                    </Badge>
                    {recipe.favorite && <Badge tone="warning">Favorite</Badge>}
                    {activeRecipeId === recipe.id && (
                      <Badge tone="accent">Active in Create</Badge>
                    )}
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-fg">{recipe.name}</h3>
                    {recipe.description && (
                      <p className="text-xs text-fg-muted mt-0.5">
                        {recipe.description}
                      </p>
                    )}
                  </div>
                  <div className="text-[11px] text-fg-subtle">
                    Checkpoint:{" "}
                    <span className="text-fg-muted">
                      {recipe.checkpointName ??
                        (recipe.checkpointPath
                          ? shortModelLabel(recipe.checkpointPath)
                          : "Not pinned")}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {recipe.items.length === 0 ? (
                      <span className="text-[11px] text-fg-subtle">
                        No adapters in this recipe.
                      </span>
                    ) : (
                      recipe.items.map((item) => (
                        <span
                          key={`${recipe.id}-${item.position}-${item.loraPath}`}
                          className="px-1.5 py-0.5 rounded-md bg-bg border border-border text-[11px] text-fg-muted tabular-nums"
                          title={`${item.loraName} — model ${item.strengthModel}, clip ${item.strengthClip}`}
                        >
                          {item.loraName} · {item.strengthModel.toFixed(2)}/
                          {item.strengthClip.toFixed(2)}
                        </span>
                      ))
                    )}
                  </div>
                  {recipe.basePrompt && (
                    <p className="text-[11px] text-fg-muted bg-bg border border-border rounded-lg p-2 line-clamp-2">
                      {recipe.basePrompt}
                    </p>
                  )}
                </div>

                <div className="flex items-center justify-between gap-2 pt-2 border-t border-border/70">
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      title={recipe.favorite ? "Remove favorite" : "Favorite recipe"}
                      onClick={() => void toggleFavorite(recipe)}
                    >
                      <Star
                        className={`w-3.5 h-3.5 ${
                          recipe.favorite ? "fill-warning text-warning" : ""
                        }`}
                      />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      title="Edit recipe"
                      onClick={() => openEditor(recipe)}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      title="Delete recipe"
                      onClick={() => setDeleteRecipe(recipe)}
                    >
                      <Trash2 className="w-3.5 h-3.5 text-fg-muted hover:text-danger" />
                    </Button>
                  </div>
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => onLoadRecipe(recipe)}
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    Load in Create
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Curated Starter Presets */}
      <div className="space-y-3">
        <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-label">
          Starter Presets ({filteredPresets.length})
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredPresets.map((preset) => (
            <Card key={preset.id} className="p-4 flex flex-col justify-between gap-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Badge tone="accent">{preset.category}</Badge>
                  <Badge tone="neutral">{preset.mode}</Badge>
                </div>
                <h3 className="text-sm font-semibold text-fg">{preset.title}</h3>
                <p className="text-xs text-fg-muted">{preset.description}</p>
                <div className="p-2.5 rounded-lg bg-bg border border-border text-xs text-fg-muted line-clamp-3">
                  {preset.prompt}
                </div>
                <div className="flex flex-wrap gap-1.5 text-[11px] text-fg-subtle tabular-nums">
                  <span>{preset.aspectRatio}</span>
                  <span>•</span>
                  <span>{preset.steps} steps</span>
                  <span>•</span>
                  <span>CFG {preset.cfg}</span>
                  <span>•</span>
                  <span>{preset.sampler}</span>
                </div>
              </div>
              <Button
                variant="primary"
                size="sm"
                onClick={() => onApplyPreset(preset)}
              >
                <Sparkles className="w-3.5 h-3.5" />
                Load Preset in Create
              </Button>
            </Card>
          ))}
        </div>
      </div>

      {/* Modular Prompt Modifiers */}
      <div className="space-y-3">
        <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-label">
          Quick Prompt Snippets
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {PROMPT_SNIPPETS.map((s) => (
            <Card key={s.label} className="p-3.5 flex flex-col justify-between gap-2.5">
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-fg">{s.label}</span>
                  <Badge tone="neutral">{s.category}</Badge>
                </div>
                <p className="mt-1.5 text-xs text-fg-muted line-clamp-2">{s.text}</p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  void navigator.clipboard.writeText(s.text);
                  onToast(`Copied '${s.label}' snippet.`);
                }}
              >
                <Copy className="w-3.5 h-3.5" />
                Copy Snippet
              </Button>
            </Card>
          ))}
        </div>
      </div>

      {/* User Saved Prompts */}
      <div className="space-y-3">
        <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-label">
          Your Saved &amp; Recent Prompts ({filteredSaved.length})
        </h2>

        {filteredSaved.length === 0 ? (
          <EmptyState
            icon={<Bookmark className="w-5 h-5" />}
            title="No saved prompts yet"
            description="Every successful generation automatically records its prompt here for quick reuse, or you can save custom prompts manually."
            action={
              <Button variant="secondary" onClick={() => setNewModalOpen(true)}>
                <Plus className="w-4 h-4" />
                Create Prompt Entry
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {filteredSaved.map((pr) => (
              <Card key={pr.id} className="p-4 space-y-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-fg">{pr.title}</h3>
                    <p className="text-[11px] text-fg-subtle tabular-nums">
                      Used {pr.usageCount}× •{" "}
                      {formatRelativeTime(pr.lastUsedAt ?? pr.createdAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => onApplyPrompt(pr.prompt, pr.negativePrompt)}
                    >
                      Reuse
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Delete prompt ${pr.title}`}
                      onClick={() => void onDeletePrompt(pr.id)}
                    >
                      <Trash2 className="w-3.5 h-3.5 text-fg-muted hover:text-danger" />
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-fg bg-bg border border-border rounded-lg p-2.5 line-clamp-3">
                  {pr.prompt}
                </p>
                {pr.negativePrompt && (
                  <p className="text-[11px] text-fg-muted line-clamp-2">
                    <span className="font-semibold text-fg-subtle">Negative:</span>{" "}
                    {pr.negativePrompt}
                  </p>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>

      <Modal
        open={newModalOpen}
        onClose={() => setNewModalOpen(false)}
        title="Save Prompt Template"
      >
        <form onSubmit={(e) => void handleSaveNew(e)} className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-fg-muted">Title</label>
            <Input
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              placeholder="e.g., Soft Studio Rim Portrait"
              required
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-fg-muted">Prompt</label>
            <Textarea
              rows={4}
              value={promptDraft}
              onChange={(e) => setPromptDraft(e.target.value)}
              placeholder="Detailed scene, lighting, composition..."
              required
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-fg-muted">Negative Prompt</label>
            <Textarea
              rows={2}
              value={negDraft}
              onChange={(e) => setNegDraft(e.target.value)}
              placeholder="Things to exclude..."
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-fg-muted">
              Tags (comma separated)
            </label>
            <Input
              value={tagsDraft}
              onChange={(e) => setTagsDraft(e.target.value)}
              placeholder="portrait, studio, sdxl"
            />
          </div>
          <div className="pt-2 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setNewModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary">
              Save Prompt
            </Button>
          </div>
        </form>
      </Modal>

      {/* LoRA RECIPE EDITOR */}
      <Modal
        open={editorOpen}
        onClose={() => {
          if (!savingRecipe) setEditorOpen(false);
        }}
        title={editor.id ? "Edit LoRA Recipe" : "New LoRA Recipe"}
        maxWidthClass="max-w-2xl"
      >
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-[11px] text-fg-subtle">Recipe Name</label>
              <Input
                value={editor.name}
                onChange={(e) =>
                  setEditor((prev) => ({ ...prev, name: e.target.value }))
                }
                placeholder="e.g. Cinematic Portrait Stack"
                autoFocus
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] text-fg-subtle">
                Checkpoint (optional)
              </label>
              <Select
                value={editor.checkpointPath}
                onChange={(e) =>
                  setEditor((prev) => ({
                    ...prev,
                    checkpointPath: e.target.value,
                  }))
                }
                className="h-9 text-xs"
              >
                <option value="">Do not pin a checkpoint</option>
                {installedCheckpoints.map((m) => (
                  <option key={m.id} value={m.relativePath}>
                    [{ARCHITECTURE_LABELS[getEffectiveArchitecture(m)]}]{" "}
                    {getEffectiveModelInfo(m).name}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[11px] text-fg-subtle">Description</label>
            <Input
              value={editor.description}
              onChange={(e) =>
                setEditor((prev) => ({ ...prev, description: e.target.value }))
              }
              placeholder="What this stack achieves..."
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-[11px] text-fg-subtle">Base Prompt</label>
              <Textarea
                rows={3}
                value={editor.basePrompt}
                onChange={(e) =>
                  setEditor((prev) => ({ ...prev, basePrompt: e.target.value }))
                }
                placeholder="Prompt to seed Create Studio..."
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] text-fg-subtle">Negative Prompt</label>
              <Textarea
                rows={3}
                value={editor.negativePrompt}
                onChange={(e) =>
                  setEditor((prev) => ({
                    ...prev,
                    negativePrompt: e.target.value,
                  }))
                }
                placeholder="Things to exclude..."
              />
            </div>
          </div>

          <div className="space-y-2 pt-1 border-t border-border">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-fg-muted">
                Adapters ({editor.items.length})
              </span>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-[11px] text-fg-subtle cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showIncompatibleLoras}
                    onChange={(e) => setShowIncompatibleLoras(e.target.checked)}
                    className="accent-accent"
                  />
                  Show incompatible
                </label>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={compatibleEditorLoras.length === 0}
                  onClick={addEditorLora}
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add LoRA
                </Button>
              </div>
            </div>
            {editor.items.length === 0 ? (
              <p className="text-[11px] text-fg-subtle">
                No adapters yet. A recipe can also pin just a checkpoint and
                prompt.
              </p>
            ) : (
              editor.items.map((item, index) => {
                const model = installedLoras.find(
                  (m) => m.relativePath === item.name
                );
                const info = model ? getEffectiveModelInfo(model) : null;
                const mismatched =
                  info != null &&
                  !evaluateLoraCompatibility(info.architecture, editorArch)
                    .compatible;

                return (
                  <div
                    key={index}
                    className="p-2 rounded-xl bg-bg border border-border space-y-2"
                  >
                    <div className="flex items-center gap-1.5">
                      <Select
                        value={item.name}
                        onChange={(e) =>
                          setEditor((prev) => ({
                            ...prev,
                            items: prev.items.map((it, i) =>
                              i === index ? { ...it, name: e.target.value } : it
                            ),
                          }))
                        }
                        className="h-8 flex-1 text-xs"
                      >
                        {compatibleEditorLoras
                          .filter(
                            (l) =>
                              l.relativePath === item.name ||
                              !editor.items.some(
                                (other) => other.name === l.relativePath
                              )
                          )
                          .map((l) => (
                            <option key={l.id} value={l.relativePath}>
                              [{ARCHITECTURE_LABELS[getEffectiveArchitecture(l)]}]{" "}
                              {getEffectiveModelInfo(l).name}
                            </option>
                          ))}
                      </Select>
                      {mismatched && <Badge tone="warning">Incompatible</Badge>}
                      <button
                        type="button"
                        aria-label="Remove adapter"
                        onClick={() =>
                          setEditor((prev) => ({
                            ...prev,
                            items: prev.items.filter((_, i) => i !== index),
                          }))
                        }
                        className="p-1.5 rounded-lg text-fg-muted hover:text-danger hover:bg-danger-soft cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <SliderField
                        label="Model Weight"
                        value={item.strengthModel}
                        min={-1.5}
                        max={1.5}
                        step={0.05}
                        onChange={(v) =>
                          setEditor((prev) => ({
                            ...prev,
                            items: prev.items.map((it, i) =>
                              i === index ? { ...it, strengthModel: v } : it
                            ),
                          }))
                        }
                      />
                      <SliderField
                        label="CLIP Weight"
                        value={item.strengthClip}
                        min={-1.5}
                        max={1.5}
                        step={0.05}
                        onChange={(v) =>
                          setEditor((prev) => ({
                            ...prev,
                            items: prev.items.map((it, i) =>
                              i === index ? { ...it, strengthClip: v } : it
                            ),
                          }))
                        }
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button
              variant="secondary"
              onClick={() => setEditorOpen(false)}
              disabled={savingRecipe}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={savingRecipe}
              disabled={!editor.name.trim()}
              onClick={() => void handleSaveRecipe()}
            >
              <Bookmark className="w-3.5 h-3.5" />
              {editor.id ? "Update Recipe" : "Save Recipe"}
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteRecipe)}
        onClose={() => setDeleteRecipe(null)}
        onConfirm={() => {
          if (deleteRecipe) {
            void onDeleteRecipe(deleteRecipe.id).then(() => {
              setDeleteRecipe(null);
              onToast("Deleted LoRA recipe.");
            });
          }
        }}
        title="Delete LoRA Recipe"
        description={`Remove '${deleteRecipe?.name ?? ""}' from your recipe library? Images already generated are unaffected.`}
        confirmLabel="Delete Recipe"
        danger
      />
    </div>
  );
};
