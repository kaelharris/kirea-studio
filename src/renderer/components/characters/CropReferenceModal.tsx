import React, { useState } from "react";
import { Crop, Scissors } from "lucide-react";
import { CHARACTER_REFERENCE_CATEGORY_LABELS } from "../../../shared/character-utils";
import type { CharacterProfile, CharacterReference, CharacterReferenceCategory } from "../../../shared/types";
import { toMediaUrl } from "../../utils/format";
import { Badge, Button, Input, Modal, Select } from "../ui/Primitives";

interface CropReferenceModalProps {
  open: boolean;
  onClose: () => void;
  characterId: string;
  reference: CharacterReference | null;
  onCropSuccess: (updated: CharacterProfile) => void;
  onToast: (msg: string, tone?: "info" | "error") => void;
}

const CATEGORY_OPTIONS = Object.keys(
  CHARACTER_REFERENCE_CATEGORY_LABELS
) as CharacterReferenceCategory[];

export const CropReferenceModal: React.FC<CropReferenceModalProps> = ({
  open,
  onClose,
  characterId,
  reference,
  onCropSuccess,
  onToast,
}) => {
  const [left, setLeft] = useState(0);
  const [top, setTop] = useState(0);
  const [width, setWidth] = useState(512);
  const [height, setHeight] = useState(512);
  const [category, setCategory] = useState<CharacterReferenceCategory>("canonical_face");
  const [caption, setCaption] = useState("");
  const [cropping, setCropping] = useState(false);

  if (!reference) return null;

  const originalWidth = reference.width || 1024;
  const originalHeight = reference.height || 1024;

  const handleCrop = async () => {
    setCropping(true);
    try {
      const updated = await window.kirea.cropCharacterReference(
        characterId,
        reference.id,
        {
          left: Math.round(left),
          top: Math.round(top),
          width: Math.max(32, Math.round(width)),
          height: Math.max(32, Math.round(height)),
          category,
          caption: caption.trim() || undefined,
        }
      );
      if (updated) {
        onCropSuccess(updated);
        onToast("Turnaround sheet cropped into new reference sample!");
        onClose();
      }
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setCropping(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Split / Crop Character Sheet Reference"
      maxWidthClass="max-w-3xl"
    >
      <div className="space-y-4">
        <p className="text-xs text-fg-muted">
          Extract sub-regions (such as face closeups, expressions, or front/back views) from turnaround character sheets into dedicated training and reference items.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="border-2 border-border p-2 bg-surface-subtle flex flex-col items-center justify-center min-h-[300px]">
            <div className="relative max-w-full max-h-[360px] overflow-hidden border border-border/60">
              <img
                src={toMediaUrl(reference.filePath)}
                alt="Source sheet"
                className="max-h-[340px] w-auto object-contain"
              />
            </div>
            <div className="mt-2 text-[11px] font-mono text-fg-subtle">
              Source Dimensions: {originalWidth} × {originalHeight} px
            </div>
          </div>

          <div className="space-y-3">
            <div className="p-3 border-2 border-border bg-bg space-y-2">
              <span className="text-[10px] font-mono uppercase tracking-wider text-label block">
                Crop Rectangle (Pixels)
              </span>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <label className="text-fg-subtle text-[11px] block">Left (X)</label>
                  <Input
                    type="number"
                    min={0}
                    max={originalWidth}
                    value={left}
                    onChange={(e) => setLeft(Math.max(0, Number(e.target.value)))}
                    className="h-7 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="text-fg-subtle text-[11px] block">Top (Y)</label>
                  <Input
                    type="number"
                    min={0}
                    max={originalHeight}
                    value={top}
                    onChange={(e) => setTop(Math.max(0, Number(e.target.value)))}
                    className="h-7 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="text-fg-subtle text-[11px] block">Width</label>
                  <Input
                    type="number"
                    min={32}
                    max={originalWidth}
                    value={width}
                    onChange={(e) => setWidth(Math.max(32, Number(e.target.value)))}
                    className="h-7 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="text-fg-subtle text-[11px] block">Height</label>
                  <Input
                    type="number"
                    min={32}
                    max={originalHeight}
                    value={height}
                    onChange={(e) => setHeight(Math.max(32, Number(e.target.value)))}
                    className="h-7 text-xs font-mono"
                  />
                </div>
              </div>

              {/* Quick Presets */}
              <div className="flex flex-wrap gap-1 pt-1 border-t border-border/40">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setLeft(0);
                    setTop(0);
                    setWidth(Math.round(originalWidth / 2));
                    setHeight(originalHeight);
                  }}
                  className="text-[10px]"
                >
                  Left Half
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setLeft(Math.round(originalWidth / 2));
                    setTop(0);
                    setWidth(Math.round(originalWidth / 2));
                    setHeight(originalHeight);
                  }}
                  className="text-[10px]"
                >
                  Right Half
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setLeft(0);
                    setTop(0);
                    setWidth(Math.min(512, originalWidth));
                    setHeight(Math.min(512, originalHeight));
                  }}
                  className="text-[10px]"
                >
                  Headshot 512
                </Button>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-fg-muted font-mono uppercase tracking-wider block">
                Extracted Category
              </label>
              <Select
                value={category}
                onChange={(e) => setCategory(e.target.value as CharacterReferenceCategory)}
                className="h-8 text-xs w-full"
              >
                {CATEGORY_OPTIONS.map((cat) => (
                  <option key={cat} value={cat}>
                    {CHARACTER_REFERENCE_CATEGORY_LABELS[cat]}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-fg-muted font-mono uppercase tracking-wider block">
                Caption / Description (Optional)
              </label>
              <Input
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="e.g. front close-up portrait, neutral expression"
                className="h-8 text-xs"
              />
            </div>
          </div>
        </div>

        <div className="pt-3 border-t border-border flex items-center justify-between">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="accent" loading={cropping} onClick={handleCrop}>
            <Scissors className="w-3.5 h-3.5" />
            Extract Cropped Sample
          </Button>
        </div>
      </div>
    </Modal>
  );
};
