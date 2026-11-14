import React from "react";
import {
  CANVAS_CAPTION_MODES,
  CANVAS_CAPTION_MODE_LABELS,
  CANVAS_PAGE_SIZES,
  CANVAS_PAGE_SIZE_LABELS,
  CANVAS_TEMPLATES,
  CANVAS_TEMPLATE_LABELS,
} from "../../../shared/canvas-layout";
import type {
  CanvasCaptionMode,
  CanvasPageSize,
  CanvasTemplate,
  StoryCanvas,
} from "../../../shared/types";
import { Button, Input, Modal, Select } from "../ui/Primitives";
import type { CanvasFormState } from "./canvas-workspace-types";

interface CanvasSettingsModalProps {
  open: boolean;
  editingCanvas: StoryCanvas | null;
  canvasForm: CanvasFormState;
  savingCanvas: boolean;
  onClose: () => void;
  onChangeForm: React.Dispatch<React.SetStateAction<CanvasFormState>>;
  onSave: () => void;
}

export const CanvasSettingsModal: React.FC<CanvasSettingsModalProps> = ({
  open,
  editingCanvas,
  canvasForm,
  savingCanvas,
  onClose,
  onChangeForm,
  onSave,
}) => (
      <Modal
        open={open}
        onClose={onClose}
        title={editingCanvas ? "Canvas settings" : "New storyboard canvas"}
        maxWidthClass="max-w-xl"
      >
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-fg-muted">Name</label>
            <Input
              value={canvasForm.name}
              onChange={(event) =>
                onChangeForm((prev) => ({ ...prev, name: event.target.value }))
              }
              className="mt-1"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium text-fg-muted">Template</label>
              <Select
                value={canvasForm.template}
                onChange={(event) =>
                  onChangeForm((prev) => ({
                    ...prev,
                    template: event.target.value as CanvasTemplate,
                  }))
                }
                className="mt-1"
              >
                {CANVAS_TEMPLATES.map((template) => (
                  <option key={template} value={template}>
                    {CANVAS_TEMPLATE_LABELS[template]}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-fg-muted">Page size</label>
              <Select
                value={canvasForm.pageSize}
                onChange={(event) =>
                  onChangeForm((prev) => ({
                    ...prev,
                    pageSize: event.target.value as CanvasPageSize,
                  }))
                }
                className="mt-1"
              >
                {CANVAS_PAGE_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {CANVAS_PAGE_SIZE_LABELS[size]}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-fg-muted">
                Caption mode
              </label>
              <Select
                value={canvasForm.captionMode}
                onChange={(event) =>
                  onChangeForm((prev) => ({
                    ...prev,
                    captionMode: event.target.value as CanvasCaptionMode,
                  }))
                }
                className="mt-1"
              >
                {CANVAS_CAPTION_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {CANVAS_CAPTION_MODE_LABELS[mode]}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-fg-muted">Background</label>
              <div className="flex items-center gap-2 mt-1">
                <input
                  type="color"
                  value={canvasForm.background}
                  onChange={(event) =>
                    onChangeForm((prev) => ({
                      ...prev,
                      background: event.target.value,
                    }))
                  }
                  className="w-9 h-9 rounded-lg bg-bg border border-border cursor-pointer"
                />
                <Input
                  value={canvasForm.background}
                  onChange={(event) =>
                    onChangeForm((prev) => ({
                      ...prev,
                      background: event.target.value,
                    }))
                  }
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-fg-muted">Margin</label>
              <Input
                type="number"
                min={0}
                max={240}
                value={canvasForm.margin}
                onChange={(event) =>
                  onChangeForm((prev) => ({
                    ...prev,
                    margin: event.target.value,
                  }))
                }
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-fg-muted">Gutter</label>
              <Input
                type="number"
                min={0}
                max={120}
                value={canvasForm.gutter}
                onChange={(event) =>
                  onChangeForm((prev) => ({
                    ...prev,
                    gutter: event.target.value,
                  }))
                }
                className="mt-1"
              />
            </div>
          </div>

          {canvasForm.pageSize === "custom" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-fg-muted">
                  Width (px)
                </label>
                <Input
                  type="number"
                  min={320}
                  max={4096}
                  value={canvasForm.pageWidth}
                  onChange={(event) =>
                    onChangeForm((prev) => ({
                      ...prev,
                      pageWidth: event.target.value,
                    }))
                  }
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-fg-muted">
                  Height (px)
                </label>
                <Input
                  type="number"
                  min={320}
                  max={4096}
                  value={canvasForm.pageHeight}
                  onChange={(event) =>
                    onChangeForm((prev) => ({
                      ...prev,
                      pageHeight: event.target.value,
                    }))
                  }
                  className="mt-1"
                />
              </div>
            </div>
          )}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={savingCanvas}
            onClick={() => onSave()}
          >
            {editingCanvas ? "Save canvas" : "Create canvas"}
          </Button>
        </div>
      </Modal>
);
