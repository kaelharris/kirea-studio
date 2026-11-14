import React from "react";
import { Check } from "lucide-react";
import { ASPECT_RATIOS } from "../../../shared/aspect-ratios";
import { STORY_CAST_ROLE_LABELS } from "../../../shared/story-utils";
import type {
  AppSettings,
  CharacterProfile,
  CharacterReferenceMode,
  LoraRecipe,
  ModelRecord,
  Story,
  StoryScenePlan,
} from "../../../shared/types";
import { shortModelLabel } from "../../utils/format";
import { Badge, Button, Input, Modal, Select, Textarea } from "../ui/Primitives";
import { REFERENCE_MODES, type SceneFormState } from "./story-form-types";

interface SceneEditorModalProps {
  open: boolean;
  editingSceneId: string | null;
  activeStory: Story | null;
  sceneForm: SceneFormState;
  setSceneForm: React.Dispatch<React.SetStateAction<SceneFormState>>;
  characters: CharacterProfile[];
  checkpointModels: ModelRecord[];
  sceneRecipes: LoraRecipe[];
  characterMap: Map<string, CharacterProfile>;
  settings: AppSettings;
  plan: StoryScenePlan | null;
  planLoading: boolean;
  savingScene: boolean;
  onToggleCastMember: (characterId: string) => void;
  onClose: () => void;
  onSave: () => void;
}

export const SceneEditorModal: React.FC<SceneEditorModalProps> = ({
  open,
  editingSceneId,
  activeStory,
  sceneForm,
  setSceneForm,
  characters,
  checkpointModels,
  sceneRecipes,
  characterMap,
  settings,
  plan,
  planLoading,
  savingScene,
  onToggleCastMember,
  onClose,
  onSave,
}) => (
      <Modal
        open={open}
        onClose={onClose}
        title={editingSceneId ? "Scene" : "New scene"}
        maxWidthClass="max-w-3xl"
      >
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] max-h-[72vh] overflow-y-auto pr-1">
          <div className="space-y-3">
            <div>
              <label className="text-small font-medium text-fg-muted">Title</label>
              <Input
                value={sceneForm.title}
                onChange={(e) =>
                  setSceneForm((prev) => ({ ...prev, title: e.target.value }))
                }
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-small font-medium text-fg-muted">Synopsis</label>
              <Textarea
                rows={2}
                value={sceneForm.synopsis}
                onChange={(e) =>
                  setSceneForm((prev) => ({ ...prev, synopsis: e.target.value }))
                }
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-small font-medium text-fg-muted">Prompt</label>
              <Textarea
                rows={5}
                value={sceneForm.prompt}
                onChange={(e) =>
                  setSceneForm((prev) => ({ ...prev, prompt: e.target.value }))
                }
                placeholder="Wide shot, the keeper raising the lantern on the cliff walk…"
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-small font-medium text-fg-muted">
                Negative prompt
              </label>
              <Textarea
                rows={2}
                value={sceneForm.negativePrompt}
                onChange={(e) =>
                  setSceneForm((prev) => ({
                    ...prev,
                    negativePrompt: e.target.value,
                  }))
                }
                className="mt-1"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-small font-medium text-fg-muted">Checkpoint</label>
                <Select
                  value={sceneForm.checkpointPath}
                  onChange={(e) =>
                    setSceneForm((prev) => ({
                      ...prev,
                      checkpointPath: e.target.value,
                    }))
                  }
                  className="mt-1"
                >
                  <option value="">Inherit from story / lead</option>
                  {checkpointModels.map((model) => (
                    <option key={model.id} value={model.relativePath}>
                      {shortModelLabel(model.relativePath)}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="text-small font-medium text-fg-muted">LoRA recipe</label>
                <Select
                  value={sceneForm.loraRecipeId}
                  onChange={(e) =>
                    setSceneForm((prev) => ({
                      ...prev,
                      loraRecipeId: e.target.value,
                    }))
                  }
                  className="mt-1"
                >
                  <option value="">Inherit from story / lead</option>
                  {sceneRecipes.map((recipe) => (
                    <option key={recipe.id} value={recipe.id}>
                      {recipe.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="text-small font-medium text-fg-muted">Aspect ratio</label>
                <Select
                  value={sceneForm.aspectRatio}
                  onChange={(e) =>
                    setSceneForm((prev) => ({
                      ...prev,
                      aspectRatio: e.target.value,
                    }))
                  }
                  className="mt-1"
                >
                  <option value="">App default ({settings.performanceProfile})</option>
                  {ASPECT_RATIOS.map((ratio) => (
                    <option key={ratio.id} value={ratio.id}>
                      {ratio.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="text-small font-medium text-fg-muted">
                  Reference mode override
                </label>
                <Select
                  value={sceneForm.referenceModeOverride}
                  onChange={(e) =>
                    setSceneForm((prev) => ({
                      ...prev,
                      referenceModeOverride: e.target.value as
                        | ""
                        | CharacterReferenceMode,
                    }))
                  }
                  className="mt-1"
                >
                  {REFERENCE_MODES.map((mode) => (
                    <option key={mode.value || "inherit"} value={mode.value}>
                      {mode.label}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-small font-medium text-fg-muted">Steps</label>
                <Input
                  type="number"
                  min={1}
                  max={150}
                  value={sceneForm.steps}
                  onChange={(e) =>
                    setSceneForm((prev) => ({ ...prev, steps: e.target.value }))
                  }
                  placeholder="auto"
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-small font-medium text-fg-muted">CFG</label>
                <Input
                  type="number"
                  step="0.1"
                  min={0.5}
                  max={30}
                  value={sceneForm.cfg}
                  onChange={(e) =>
                    setSceneForm((prev) => ({ ...prev, cfg: e.target.value }))
                  }
                  placeholder="auto"
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-small font-medium text-fg-muted">Seed</label>
                <Input
                  type="number"
                  value={sceneForm.seed}
                  onChange={(e) =>
                    setSceneForm((prev) => ({ ...prev, seed: e.target.value }))
                  }
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-small font-medium text-fg-muted">Batch</label>
                <Input
                  type="number"
                  min={1}
                  max={8}
                  value={sceneForm.batchCount}
                  onChange={(e) =>
                    setSceneForm((prev) => ({
                      ...prev,
                      batchCount: e.target.value,
                    }))
                  }
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-small font-medium text-fg-muted">Width</label>
                <Input
                  type="number"
                  min={64}
                  max={4096}
                  step={8}
                  value={sceneForm.width}
                  onChange={(e) =>
                    setSceneForm((prev) => ({ ...prev, width: e.target.value }))
                  }
                  placeholder="auto"
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-small font-medium text-fg-muted">Height</label>
                <Input
                  type="number"
                  min={64}
                  max={4096}
                  step={8}
                  value={sceneForm.height}
                  onChange={(e) =>
                    setSceneForm((prev) => ({ ...prev, height: e.target.value }))
                  }
                  placeholder="auto"
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-small font-medium text-fg-muted">Denoise</label>
                <Input
                  type="number"
                  min={0.05}
                  max={1}
                  step="0.01"
                  value={sceneForm.denoise}
                  onChange={(e) =>
                    setSceneForm((prev) => ({ ...prev, denoise: e.target.value }))
                  }
                  placeholder="identity default"
                  className="mt-1"
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-small font-medium text-fg-muted">Scene cast</div>
              <p className="text-[11px] text-fg-subtle">
                Leave empty to inherit the story cast. The first member is the lead and
                can drive stock img2img identity; others contribute prompt tokens only.
              </p>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {characters.map((character) => {
                  const member = sceneForm.cast.find(
                    (candidate) => candidate.characterId === character.id
                  );
                  const checked = Boolean(member);
                  const inherited =
                    sceneForm.cast.length === 0 &&
                    activeStory?.cast.some(
                      (storyMember) => storyMember.characterId === character.id
                    );
                  return (
                    <label
                      key={character.id}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded-lg border cursor-pointer ${
                        checked
                          ? "bg-accent-soft border-accent/40"
                          : "bg-surface-subtle border-border"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => onToggleCastMember(character.id)}
                        className="accent-accent"
                      />
                      <span className="flex-1 text-small text-fg truncate">
                        {character.name}
                      </span>
                      {inherited && (
                        <span className="font-mono text-[10px] font-semibold tracking-[0.12em] text-fg-subtle uppercase">
                          inherited
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>
          </div>

          {/* PLAN PREVIEW */}
          <div className="space-y-3">
            <div className="p-3 rounded-xl bg-surface-subtle border border-border space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-small font-semibold text-fg">Generation plan</span>
                <span className="text-[11px] text-fg-subtle">
                  {planLoading ? "Updating…" : "Saved scene settings"}
                </span>
              </div>
              {!plan && !planLoading && (
                <p className="text-small text-fg-subtle">
                  Save the scene to preview the resolved plan.
                </p>
              )}
              {plan && (
                <>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge tone={plan.mode === "img2img" ? "accent" : "neutral"}>
                      {plan.mode}
                    </Badge>
                    <Badge tone="neutral">{plan.workflowId}</Badge>
                    <Badge tone="neutral">
                      {plan.width}×{plan.height}
                    </Badge>
                    <Badge tone="neutral">{plan.steps} steps</Badge>
                    <Badge tone="neutral">CFG {plan.cfg}</Badge>
                    <Badge tone={plan.randomSeed ? "warning" : "neutral"}>
                      seed {plan.randomSeed ? "random" : plan.seed}
                    </Badge>
                    {plan.referenceActive && <Badge tone="accent">identity img2img</Badge>}
                  </div>
                  <div className="text-[11px] text-fg-muted">
                    <span className="text-fg-subtle">Checkpoint:</span>{" "}
                    {plan.checkpoint ? shortModelLabel(plan.checkpoint) : "none"} ·{" "}
                    {plan.architecture}
                  </div>
                  {plan.loras.length > 0 && (
                    <div className="text-[11px] text-fg-muted space-y-0.5">
                      {plan.loras.map((lora) => (
                        <div key={lora.name}>
                          LoRA {shortModelLabel(lora.name)} ·{" "}
                          {lora.strengthModel}/{lora.strengthClip}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="text-[11px] text-fg-subtle line-clamp-4">
                    {plan.prompt || "Empty prompt"}
                  </div>
                </>
              )}
            </div>

            {plan && plan.blockingIssues.length > 0 && (
              <div className="p-3 rounded-xl bg-danger-soft border border-danger/30 space-y-1">
                <div className="text-small font-semibold text-danger">Blocking</div>
                {plan.blockingIssues.map((issue) => (
                  <p key={issue} className="text-[11px] text-danger">
                    {issue}
                  </p>
                ))}
              </div>
            )}
            {plan && plan.issues.length > 0 && (
              <div className="p-3 rounded-xl bg-warning-soft border border-warning/30 space-y-1">
                <div className="text-small font-semibold text-warning">Warnings</div>
                {plan.issues.map((issue) => (
                  <p key={issue} className="text-[11px] text-warning">
                    {issue}
                  </p>
                ))}
              </div>
            )}
            <p className="text-[11px] text-fg-subtle leading-relaxed">
              The plan inherits scene overrides, then the linked LoRA recipe, then
              workflow defaults and app defaults. Character identity uses stock img2img
              only when the lead has a primary reference on disk.
            </p>
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button variant="primary" loading={savingScene} onClick={() => onSave()}>
            Save scene
          </Button>
        </div>
      </Modal>
);
