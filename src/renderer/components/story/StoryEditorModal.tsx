import React from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  getEffectiveArchitecture,
  getEffectiveModelInfo,
} from "../../../shared/model-utils";
import { STORY_CAST_ROLE_LABELS } from "../../../shared/story-utils";
import type {
  CharacterProfile,
  LoraRecipe,
  ModelRecord,
  Story,
  StoryCastRole,
} from "../../../shared/types";
import { Button, Input, Modal, Select, Textarea } from "../ui/Primitives";
import { CAST_ROLES, type StoryFormState } from "./story-form-types";

interface StoryEditorModalProps {
  open: boolean;
  activeStory: Story | null;
  storyForm: StoryFormState;
  setStoryForm: React.Dispatch<React.SetStateAction<StoryFormState>>;
  characters: CharacterProfile[];
  checkpointModels: ModelRecord[];
  storyRecipes: LoraRecipe[];
  characterMap: Map<string, CharacterProfile>;
  availableCastCharacters: CharacterProfile[];
  newCastId: string;
  setNewCastId: (id: string) => void;
  savingStory: boolean;
  onAddCastMember: () => void;
  onUpdateCastRole: (characterId: string, role: StoryCastRole) => void;
  onRemoveCastMember: (characterId: string) => void;
  onClose: () => void;
  onSave: () => void;
}

export const StoryEditorModal: React.FC<StoryEditorModalProps> = ({
  open,
  activeStory,
  storyForm,
  setStoryForm,
  characters,
  checkpointModels,
  storyRecipes,
  characterMap,
  availableCastCharacters,
  newCastId,
  setNewCastId,
  savingStory,
  onAddCastMember,
  onUpdateCastRole,
  onRemoveCastMember,
  onClose,
  onSave,
}) => (
      <Modal
        open={open}
        onClose={onClose}
        title={activeStory ? "Edit story" : "New story"}
        maxWidthClass="max-w-2xl"
      >
        <div className="space-y-3 max-h-[72vh] overflow-y-auto pr-1">
          <div>
            <label className="text-small font-medium text-fg-muted">Title</label>
            <Input
              value={storyForm.title}
              onChange={(e) =>
                setStoryForm((prev) => ({ ...prev, title: e.target.value }))
              }
              placeholder="The Lantern Keeper"
              className="mt-1"
            />
          </div>
          <div>
            <label className="text-small font-medium text-fg-muted">Logline</label>
            <Textarea
              rows={3}
              value={storyForm.logline}
              onChange={(e) =>
                setStoryForm((prev) => ({ ...prev, logline: e.target.value }))
              }
              placeholder="One or two sentences that anchor the visual arc."
              className="mt-1"
            />
          </div>
          <div>
            <label className="text-small font-medium text-fg-muted">
              Style prompt (applied to every scene)
            </label>
            <Textarea
              rows={3}
              value={storyForm.stylePrompt}
              onChange={(e) =>
                setStoryForm((prev) => ({ ...prev, stylePrompt: e.target.value }))
              }
              placeholder="Editorial fantasy photography, soft volumetric light, muted teal grade"
              className="mt-1"
            />
          </div>
          <div>
            <label className="text-small font-medium text-fg-muted">
              Story negative prompt
            </label>
            <Textarea
              rows={2}
              value={storyForm.negativePrompt}
              onChange={(e) =>
                setStoryForm((prev) => ({ ...prev, negativePrompt: e.target.value }))
              }
              placeholder="blurry, lowres, watermark"
              className="mt-1"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-small font-medium text-fg-muted">
                Default checkpoint
              </label>
              <Select
                value={storyForm.defaultCheckpointPath}
                onChange={(e) =>
                  setStoryForm((prev) => ({
                    ...prev,
                    defaultCheckpointPath: e.target.value,
                  }))
                }
                className="mt-1"
              >
                <option value="">Inherit from lead character</option>
                {checkpointModels.map((model) => (
                  <option key={model.id} value={model.relativePath}>
                    {getEffectiveModelInfo(model).name} ·{" "}
                    {getEffectiveArchitecture(model)}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className="text-small font-medium text-fg-muted">
                Default LoRA recipe
              </label>
              <Select
                value={storyForm.defaultLoraRecipeId}
                onChange={(e) =>
                  setStoryForm((prev) => ({
                    ...prev,
                    defaultLoraRecipeId: e.target.value,
                  }))
                }
                className="mt-1"
              >
                <option value="">Inherit from lead character</option>
                {storyRecipes.map((recipe) => (
                  <option key={recipe.id} value={recipe.id}>
                    {recipe.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div>
            <label className="text-small font-medium text-fg-muted">
              Default character (used when the cast is empty)
            </label>
            <Select
              value={storyForm.defaultCharacterId}
              onChange={(e) =>
                setStoryForm((prev) => ({
                  ...prev,
                  defaultCharacterId: e.target.value,
                }))
              }
              className="mt-1"
            >
              <option value="">None</option>
              {characters.map((character) => (
                <option key={character.id} value={character.id}>
                  {character.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-2">
            <div className="text-small font-medium text-fg-muted">Story cast</div>
            {storyForm.cast.length === 0 && (
              <p className="text-small text-fg-subtle">
                No cast members yet. The first cast member becomes the lead and can
                drive img2img identity.
              </p>
            )}
            {storyForm.cast.map((member, index) => {
              const character = characterMap.get(member.characterId);
              return (
                <div
                  key={member.characterId}
                  className="flex items-center gap-2 p-2 rounded-lg bg-surface-subtle border border-border"
                >
                  <span className="w-5 text-[11px] text-fg-subtle tabular-nums">
                    {index + 1}
                  </span>
                  <span className="flex-1 truncate text-small text-fg">
                    {character?.name ?? member.characterId}
                  </span>
                  <Select
                    value={member.storyRole ?? "supporting"}
                    onChange={(e) =>
                      onUpdateCastRole(
                        member.characterId,
                        e.target.value as StoryCastRole
                      )
                    }
                    className="w-32"
                  >
                    {CAST_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {STORY_CAST_ROLE_LABELS[role]}
                      </option>
                    ))}
                  </Select>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Remove cast member"
                    onClick={() => onRemoveCastMember(member.characterId)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              );
            })}
            <div className="flex items-center gap-2">
              <Select
                value={newCastId}
                onChange={(e) => setNewCastId(e.target.value)}
                className="flex-1"
              >
                <option value="">Add character to cast…</option>
                {availableCastCharacters.map((character) => (
                  <option key={character.id} value={character.id}>
                    {character.name}
                  </option>
                ))}
              </Select>
              <Button
                size="sm"
                variant="secondary"
                disabled={!newCastId}
                onClick={onAddCastMember}
              >
                <Plus className="w-3.5 h-3.5" />
                Add
              </Button>
            </div>
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={savingStory} onClick={() => onSave()}>
            {activeStory ? "Save story" : "Create story"}
          </Button>
        </div>
      </Modal>
);
