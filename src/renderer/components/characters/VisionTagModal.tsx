import React, { useState } from "react";
import {
  Check,
  CheckCircle,
  Eye,
  Info,
  Plus,
  Sparkles,
  Tag,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import type {
  CharacterReference,
  VisionModelStatus,
  VisualTag,
  VisualTagApproval,
  VisualTagCategory,
} from "../../../shared/types";
import { toMediaUrl } from "../../utils/format";
import { Badge, Button, Input, Modal, Select } from "../ui/Primitives";

interface VisionTagModalProps {
  open: boolean;
  onClose: () => void;
  reference: CharacterReference | null;
  characterId: string;
  visionModelStatus: VisionModelStatus | null;
  onUpdateTags: (referenceId: string, tags: VisualTag[]) => Promise<void>;
  onToast: (msg: string, tone?: "info" | "error") => void;
}

const CATEGORY_LABELS: Record<VisualTagCategory, { label: string; desc: string; tone: "accent" | "neutral" | "warning" }> = {
  identity: {
    label: "Identity & Features",
    desc: "Hair color/style, eye color, markings, distinctive traits",
    tone: "accent",
  },
  clothing: {
    label: "Clothing & Wardrobe",
    desc: "Garments, footwear, signature accessories, fabrics",
    tone: "neutral",
  },
  pose_expression: {
    label: "Pose & Expression",
    desc: "Framing (close-up/full body), facing direction, expressions",
    tone: "warning",
  },
  environment: {
    label: "Environment & Lighting",
    desc: "Background setting, ambient lighting, color atmosphere",
    tone: "neutral",
  },
};

export function VisionTagModal({
  open,
  onClose,
  reference,
  characterId,
  visionModelStatus,
  onUpdateTags,
  onToast,
}: VisionTagModalProps) {
  const [customTag, setCustomTag] = useState("");
  const [customCategory, setCustomCategory] = useState<VisualTagCategory>("identity");
  const [saving, setSaving] = useState(false);

  if (!reference) return null;

  const currentTags = reference.suggestedTags ?? [];

  const handleToggleStatus = async (tagId: string, newStatus: VisualTagApproval) => {
    setSaving(true);
    try {
      const updated = currentTags.map((t) =>
        t.id === tagId ? { ...t, approvalStatus: newStatus } : t
      );
      await onUpdateTags(reference.id, updated);
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setSaving(false);
    }
  };

  const handleAcceptAllAbove = async (threshold = 0.8) => {
    setSaving(true);
    try {
      const updated = currentTags.map((t) =>
        t.confidence >= threshold
          ? { ...t, approvalStatus: "approved" as VisualTagApproval }
          : t
      );
      await onUpdateTags(reference.id, updated);
      onToast(`Approved all tags with confidence >= ${Math.round(threshold * 100)}%`);
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setSaving(false);
    }
  };

  const handleAddCustom = async () => {
    if (!customTag.trim()) return;
    setSaving(true);
    try {
      const newTagItem: VisualTag = {
        id: `vtag_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        tag: customTag.trim().toLowerCase(),
        category: customCategory,
        confidence: 1.0,
        approvalStatus: "approved",
        source: "manual",
      };
      const updated = [...currentTags, newTagItem];
      await onUpdateTags(reference.id, updated);
      setCustomTag("");
      onToast(`Added tag '${newTagItem.tag}'`);
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteTag = async (tagId: string) => {
    setSaving(true);
    try {
      const updated = currentTags.filter((t) => t.id !== tagId);
      await onUpdateTags(reference.id, updated);
    } catch (err) {
      onToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setSaving(false);
    }
  };

  const categories: VisualTagCategory[] = ["identity", "clothing", "pose_expression", "environment"];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Vision Tag Interrogation"
      maxWidthClass="max-w-4xl"
    >
      <div className="space-y-4">
        {/* Model status header notice */}
        <div className="p-2.5 border-2 border-border bg-surface-subtle flex items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <Tag className="w-4 h-4 text-accent" />
            <span className="font-bold text-fg">Engine Status:</span>
            {visionModelStatus?.available ? (
              <Badge tone="accent">WD14 Neural Tagger ({visionModelStatus.modelName})</Badge>
            ) : (
              <Badge tone="neutral">Local Visual Heuristics (Aspect, Luminance, Framing)</Badge>
            )}
          </div>
          <Button
            size="sm"
            variant="secondary"
            loading={saving}
            onClick={() => handleAcceptAllAbove(0.8)}
          >
            <Sparkles className="w-3.5 h-3.5 text-accent" />
            Accept All (≥ 80%)
          </Button>
        </div>

        {/* 2-Column Inspector Layout */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
          {/* Left Preview Column */}
          <div className="md:col-span-4 border-2 border-border bg-[#0B0C10] p-2 flex flex-col space-y-2">
            <div className="aspect-square bg-surface-subtle border border-border flex items-center justify-center overflow-hidden">
              <img
                src={toMediaUrl(reference.filePath)}
                alt={reference.caption || "Reference"}
                className="w-full h-full object-contain"
              />
            </div>
            <div className="p-2 border border-border/60 bg-surface-subtle font-mono text-[10px] space-y-1 text-fg-subtle">
              <div>Category: <b className="text-fg">{reference.category}</b></div>
              <div>Role: <b className="text-fg">{reference.role}</b></div>
              {reference.width && reference.height && (
                <div>Dimensions: <b>{reference.width} × {reference.height}</b></div>
              )}
              {reference.aspectRatio && (
                <div>Ratio: <b>{reference.aspectRatio}</b></div>
              )}
            </div>
          </div>

          {/* Right Tags Workspace Column */}
          <div className="md:col-span-8 space-y-3 max-h-[480px] overflow-y-auto pr-1">
            {categories.map((cat) => {
              const info = CATEGORY_LABELS[cat];
              const tagsInCat = currentTags.filter((t) => t.category === cat);
              return (
                <div key={cat} className="p-3 border-2 border-border bg-bg space-y-2">
                  <div className="flex items-center justify-between border-b border-border/40 pb-1.5">
                    <div>
                      <span className="font-mono text-xs font-bold uppercase tracking-wider text-fg">
                        {info.label} ({tagsInCat.length})
                      </span>
                      <p className="text-[10px] text-fg-subtle">{info.desc}</p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {tagsInCat.map((t) => {
                      const isApproved = t.approvalStatus === "approved";
                      const isRejected = t.approvalStatus === "rejected";
                      return (
                        <div
                          key={t.id}
                          className={`flex items-center gap-1.5 px-2 py-1 border text-xs font-mono transition-all ${
                            isApproved
                              ? "bg-accent/15 border-accent text-accent font-bold"
                              : isRejected
                              ? "bg-danger/10 border-danger/40 text-danger line-through opacity-70"
                              : "bg-surface-subtle border-border text-fg"
                          }`}
                        >
                          <span>{t.tag}</span>
                          <span className="text-[10px] opacity-75">
                            {Math.round(t.confidence * 100)}%
                          </span>

                          <div className="flex items-center gap-0.5 ml-1">
                            {!isApproved && (
                              <button
                                onClick={() => handleToggleStatus(t.id, "approved")}
                                className="p-0.5 text-accent hover:bg-accent/20 rounded"
                                title="Approve tag"
                              >
                                <Check className="w-3 h-3" />
                              </button>
                            )}
                            {!isRejected && (
                              <button
                                onClick={() => handleToggleStatus(t.id, "rejected")}
                                className="p-0.5 text-danger hover:bg-danger/20 rounded"
                                title="Reject tag"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            )}
                            <button
                              onClick={() => handleDeleteTag(t.id)}
                              className="p-0.5 text-fg-subtle hover:text-danger rounded ml-0.5"
                              title="Delete tag"
                            >
                              <Trash2 className="w-2.5 h-2.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}

                    {tagsInCat.length === 0 && (
                      <span className="text-[11px] text-fg-subtle italic py-1 block">
                        No {info.label.toLowerCase()} tags detected.
                      </span>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Custom Tag Form */}
            <div className="p-3 border-2 border-border bg-surface-subtle space-y-2">
              <span className="text-xs font-mono font-bold uppercase tracking-wider text-fg block">
                Add Custom Tag
              </span>
              <div className="flex items-center gap-2">
                <Input
                  value={customTag}
                  onChange={(e) => setCustomTag(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddCustom()}
                  placeholder="e.g. golden earrings, cybernetic arm, smile..."
                  className="h-8 text-xs font-mono flex-1"
                />
                <Select
                  value={customCategory}
                  onChange={(e) => setCustomCategory(e.target.value as VisualTagCategory)}
                  className="h-8 text-xs font-mono w-40"
                >
                  <option value="identity">Identity</option>
                  <option value="clothing">Clothing</option>
                  <option value="pose_expression">Pose / Expression</option>
                  <option value="environment">Environment</option>
                </Select>
                <Button size="sm" variant="accent" loading={saving} onClick={handleAddCustom}>
                  <Plus className="w-3 h-3" /> Add
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex justify-end pt-2 border-t border-border">
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Modal>
  );
}
