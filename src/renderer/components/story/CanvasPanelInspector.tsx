import React from "react";
import {
  ArrowDown,
  ArrowUp,
  MessageSquare,
  Plus,
  Trash2,
} from "lucide-react";
import {
  CANVAS_FIT_LABELS,
  CANVAS_OVERLAY_KINDS,
  CANVAS_OVERLAY_KIND_LABELS,
} from "../../../shared/canvas-layout";
import type {
  CanvasFit,
  CanvasOverlayKind,
  GeneratedImageRecord,
  Story,
  StoryCanvas,
  StoryCanvasItem,
  StoryScene,
} from "../../../shared/types";
import {
  Badge,
  Button,
  Card,
  Input,
  Select,
  SliderField,
  Textarea,
} from "../ui/Primitives";
import {
  newOverlayForm,
  type OverlayFormState,
  type PanelFormState,
} from "./canvas-workspace-types";

interface CanvasPanelInspectorProps {
  story: Story;
  activeCanvas: StoryCanvas;
  selectedItem: StoryCanvasItem | null;
  images: GeneratedImageRecord[];
  imagesForScene: GeneratedImageRecord[];
  sceneMap: Map<string, StoryScene>;
  panelForm: PanelFormState;
  setPanelForm: React.Dispatch<React.SetStateAction<PanelFormState>>;
  savingPanel: boolean;
  overlayForm: OverlayFormState;
  setOverlayForm: React.Dispatch<React.SetStateAction<OverlayFormState>>;
  savingOverlay: boolean;
  onSavePanel: () => void;
  onMovePanel: (direction: -1 | 1) => void;
  onRemovePanel: () => void;
  onSaveOverlay: () => void;
  onRemoveOverlay: (id: string) => void;
}

export const CanvasPanelInspector: React.FC<CanvasPanelInspectorProps> = ({
  story,
  activeCanvas,
  selectedItem,
  images,
  imagesForScene,
  sceneMap,
  panelForm,
  setPanelForm,
  savingPanel,
  overlayForm,
  setOverlayForm,
  savingOverlay,
  onSavePanel,
  onMovePanel,
  onRemovePanel,
  onSaveOverlay,
  onRemoveOverlay,
}) => (
          <div className="space-y-3 min-w-0">
            {selectedItem ? (
              <>
                <Card className="p-3.5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-fg">Panel</h4>
                    <Badge tone="neutral">
                      {activeCanvas?.items.findIndex(
                        (item) => item.id === selectedItem.id
                      )! + 1}
                    </Badge>
                  </div>

                  <div>
                    <label className="text-[11px] font-medium text-fg-muted">
                      Scene
                    </label>
                    <Select
                      value={panelForm.sceneId}
                      onChange={(event) => {
                        const sceneId = event.target.value;
                        const scene = sceneMap.get(sceneId) ?? null;
                        const sceneImages = images.filter(
                          (image) => image.storySceneId === sceneId
                        );
                        setPanelForm((prev) => ({
                          ...prev,
                          sceneId,
                          imageId:
                            scene?.selectedImageId ??
                            sceneImages[0]?.id ??
                            "",
                        }));
                      }}
                      className="mt-1"
                    >
                      <option value="">No scene link</option>
                      {story.scenes.map((scene, index) => (
                        <option key={scene.id} value={scene.id}>
                          {index + 1}. {scene.title || "Untitled scene"}
                        </option>
                      ))}
                    </Select>
                  </div>

                  <div>
                    <label className="text-[11px] font-medium text-fg-muted">
                      Image
                    </label>
                    <Select
                      value={panelForm.imageId}
                      onChange={(event) =>
                        setPanelForm((prev) => ({
                          ...prev,
                          imageId: event.target.value,
                        }))
                      }
                      className="mt-1"
                      disabled={!panelForm.sceneId}
                    >
                      <option value="">No image</option>
                      {imagesForScene.map((image) => (
                        <option key={image.id} value={image.id}>
                          {image.fileName}
                        </option>
                      ))}
                      {panelForm.imageId &&
                        !imagesForScene.some(
                          (image) => image.id === panelForm.imageId
                        ) && (
                          <option value={panelForm.imageId}>
                            Current image (
                            {images.find((image) => image.id === panelForm.imageId)
                              ?.fileName ?? "not in library"}
                            )
                          </option>
                        )}
                    </Select>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[11px] font-medium text-fg-muted">
                        Fit
                      </label>
                      <Select
                        value={panelForm.fit}
                        onChange={(event) =>
                          setPanelForm((prev) => ({
                            ...prev,
                            fit: event.target.value as CanvasFit,
                          }))
                        }
                        className="mt-1"
                      >
                        {(["cover", "contain"] as CanvasFit[]).map((fit) => (
                          <option key={fit} value={fit}>
                            {CANVAS_FIT_LABELS[fit]}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div className="flex items-end gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label="Move panel up"
                        onClick={() => onMovePanel(-1)}
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label="Move panel down"
                        onClick={() => onMovePanel(1)}
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>

                  <div>
                    <label className="text-[11px] font-medium text-fg-muted">
                      Caption override
                    </label>
                    <Textarea
                      rows={2}
                      value={panelForm.captionOverride}
                      onChange={(event) =>
                        setPanelForm((prev) => ({
                          ...prev,
                          captionOverride: event.target.value,
                        }))
                      }
                      placeholder="Leave empty to use the caption mode"
                      className="mt-1"
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="primary"
                      loading={savingPanel}
                      onClick={() => onSavePanel()}
                    >
                      <CheckIcon />
                      Apply panel
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onRemovePanel()}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Remove
                    </Button>
                  </div>
                </Card>

                <Card className="p-3.5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-fg flex items-center gap-1.5">
                      <MessageSquare className="w-3.5 h-3.5" />
                      Dialogue & overlays
                    </h4>
                    <span className="text-[11px] text-fg-subtle">
                      {selectedItem.overlays.length}
                    </span>
                  </div>

                  {selectedItem.overlays.length > 0 && (
                    <div className="space-y-1.5">
                      {selectedItem.overlays.map((overlay) => (
                        <div
                          key={overlay.id}
                          className="flex items-center gap-2 p-1.5 rounded-lg bg-surface-subtle border border-border"
                        >
                          <button
                            type="button"
                            className="flex-1 min-w-0 text-left cursor-pointer"
                            onClick={() =>
                              setOverlayForm({
                                id: overlay.id,
                                kind: overlay.kind,
                                speaker: overlay.speaker ?? "",
                                text: overlay.text,
                                x: overlay.x,
                                y: overlay.y,
                              })
                            }
                          >
                            <span className="text-[11px] uppercase tracking-wide text-fg-subtle">
                              {CANVAS_OVERLAY_KIND_LABELS[overlay.kind]}
                              {overlay.speaker ? ` · ${overlay.speaker}` : ""}
                            </span>
                            <span className="block text-xs text-fg truncate">
                              {overlay.text}
                            </span>
                          </button>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label="Remove overlay"
                            onClick={() => onRemoveOverlay(overlay.id)}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[11px] font-medium text-fg-muted">
                        Type
                      </label>
                      <Select
                        value={overlayForm.kind}
                        onChange={(event) =>
                          setOverlayForm((prev) => ({
                            ...prev,
                            kind: event.target.value as CanvasOverlayKind,
                          }))
                        }
                        className="mt-1"
                      >
                        {CANVAS_OVERLAY_KINDS.map((kind) => (
                          <option key={kind} value={kind}>
                            {CANVAS_OVERLAY_KIND_LABELS[kind]}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-fg-muted">
                        Speaker
                      </label>
                      <Input
                        value={overlayForm.speaker}
                        onChange={(event) =>
                          setOverlayForm((prev) => ({
                            ...prev,
                            speaker: event.target.value,
                          }))
                        }
                        placeholder="Mira"
                        className="mt-1"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-[11px] font-medium text-fg-muted">
                      Text
                    </label>
                    <Textarea
                      rows={2}
                      value={overlayForm.text}
                      onChange={(event) =>
                        setOverlayForm((prev) => ({
                          ...prev,
                          text: event.target.value,
                        }))
                      }
                      placeholder="The lantern is out on the cliff walk."
                      className="mt-1"
                    />
                  </div>

                  <SliderField
                    label="X position"
                    value={Number(overlayForm.x.toFixed(2))}
                    min={0}
                    max={1}
                    step={0.01}
                    onChange={(value) =>
                      setOverlayForm((prev) => ({ ...prev, x: value }))
                    }
                  />
                  <SliderField
                    label="Y position"
                    value={Number(overlayForm.y.toFixed(2))}
                    min={0}
                    max={1}
                    step={0.01}
                    onChange={(value) =>
                      setOverlayForm((prev) => ({ ...prev, y: value }))
                    }
                  />

                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="primary"
                      loading={savingOverlay}
                      onClick={() => onSaveOverlay()}
                    >
                      <Plus className="w-3 h-3" />
                      {overlayForm.id ? "Save overlay" : "Add overlay"}
                    </Button>
                    {overlayForm.id && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setOverlayForm(newOverlayForm())}
                      >
                        New overlay
                      </Button>
                    )}
                  </div>
                </Card>
              </>
            ) : (
              <Card className="p-4 text-sm text-fg-muted">
                Select a panel to swap its scene and image, edit the caption, or add
                dialogue.
              </Card>
            )}
          </div>
);

const CheckIcon: React.FC = () => (
  <svg
    viewBox="0 0 16 16"
    className="w-3.5 h-3.5"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    aria-hidden="true"
  >
    <path d="M3 8.5l3.2 3.2L13 5" />
  </svg>
);
