import React, { useState } from "react";
import {
  AlertCircle,
  Check,
  Copy,
  Plus,
  RefreshCw,
  Sparkles,
  Wand2,
  X,
} from "lucide-react";
import { Badge, Button, Modal } from "../ui/Primitives";
import {
  enhancePromptWithDanbooru,
  type EnhancementResult,
  type TagCategory,
} from "./DanbooruEnhancer";
import type { ModelArchitecture } from "../../../shared/types";

interface MagicPromptModalProps {
  open: boolean;
  onClose: () => void;
  currentPrompt: string;
  architecture: ModelArchitecture | "unknown";
  onApply: (newPrompt: string) => void;
  onAppend: (appendedPrompt: string) => void;
  onToast?: (msg: string) => void;
}

const CATEGORY_COLORS: Record<TagCategory, "accent" | "success" | "creative" | "sand" | "warning" | "neutral"> = {
  quality: "accent",
  character: "creative",
  clothing: "success",
  action: "warning",
  environment: "sand",
  lighting: "accent",
  camera: "neutral",
  general: "neutral",
  natural: "neutral",
  meta: "neutral",
  lora: "accent",
};

export const MagicPromptModal: React.FC<MagicPromptModalProps> = ({
  open,
  onClose,
  currentPrompt,
  architecture,
  onApply,
  onAppend,
  onToast,
}) => {
  const [result, setResult] = useState<EnhancementResult>(() =>
    enhancePromptWithDanbooru(currentPrompt, architecture)
  );
  const [editedPrompt, setEditedPrompt] = useState<string>(() => result.enhancedPrompt);
  const [copied, setCopied] = useState(false);

  // Recalculate when modal opens or prompt changes
  React.useEffect(() => {
    if (open) {
      const res = enhancePromptWithDanbooru(currentPrompt, architecture);
      setResult(res);
      setEditedPrompt(res.enhancedPrompt);
      setCopied(false);
    }
  }, [open, currentPrompt, architecture]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(editedPrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    onToast?.("Copied enhanced prompt to clipboard.");
  };

  const handleRegenerate = () => {
    const res = enhancePromptWithDanbooru(currentPrompt, architecture);
    setResult(res);
    setEditedPrompt(res.enhancedPrompt);
    onToast?.("Prompt re-enhanced with fresh Danbooru tags.");
  };

  const handleApplyReplace = () => {
    onApply(editedPrompt);
    onClose();
    onToast?.("Applied enhanced Danbooru prompt.");
  };

  const handleApplyAppend = () => {
    const combined = currentPrompt.trim()
      ? `${currentPrompt.trim()}, ${editedPrompt}`
      : editedPrompt;
    onAppend(combined);
    onClose();
    onToast?.("Appended enhanced tags to existing prompt.");
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Magic Prompt — Danbooru Assistant"
      maxWidthClass="max-w-2xl"
    >
      <div className="space-y-4">
        {/* Architecture & Engine Banner */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface-subtle p-3">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-soft text-accent">
              <Sparkles className="h-4 w-4" />
            </span>
            <div>
              <p className="text-xs font-semibold text-fg">
                Model Architecture: <span className="uppercase text-accent font-mono">{architecture}</span>
              </p>
              <p className="text-[11px] text-fg-subtle">
                Local Danbooru Tag Engine (Fast, private & offline)
              </p>
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={handleRegenerate} title="Re-evaluate tags">
            <RefreshCw className="h-3.5 w-3.5" />
            Re-enhance
          </Button>
        </div>

        {/* Original Prompt Preview */}
        <div>
          <label className="text-xs font-medium text-fg-muted block mb-1">
            Original User Brief:
          </label>
          <div className="rounded-lg border border-border bg-bg/80 px-3 py-2 text-xs text-fg-muted max-h-24 overflow-y-auto">
            {currentPrompt.trim() ? currentPrompt : <span className="italic text-fg-subtle">No prompt entered yet</span>}
          </div>
        </div>

        {/* Tag Breakdown Pills */}
        {result.tags.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-fg">
                Extracted Danbooru Tags ({result.tags.length}):
              </label>
              <span className="text-[11px] text-fg-subtle">Click to toggle or review</span>
            </div>
            <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto p-1 rounded-lg border border-border/70 bg-bg/40">
              {result.tags.map((tag, idx) => (
                <Badge
                  key={idx}
                  tone={CATEGORY_COLORS[tag.category] ?? "neutral"}
                  className="text-[11px] py-0.5 cursor-default"
                >
                  {tag.text}
                </Badge>
              ))}
              {result.preservedTokens.map((token, idx) => (
                <Badge key={`lora-${idx}`} tone="accent" className="text-[11px] font-mono py-0.5">
                  {token}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Enhanced Editable Output */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-fg flex items-center gap-1.5">
              <span>Enhanced Prompt:</span>
              <span className="text-[10px] text-accent font-semibold px-1.5 py-0.2 rounded bg-accent-soft">
                Ready to render
              </span>
            </label>
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1 text-[11px] text-fg-subtle hover:text-fg transition-colors"
            >
              {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
              {copied ? "Copied" : "Copy text"}
            </button>
          </div>
          <textarea
            rows={4}
            value={editedPrompt}
            onChange={(e) => setEditedPrompt(e.target.value)}
            className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-xs text-fg leading-relaxed focus:border-accent focus:outline-none"
            placeholder="Enhanced prompt tags will appear here..."
          />
        </div>

        {/* Footer Actions */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>

          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              onClick={handleApplyAppend}
              disabled={!editedPrompt.trim()}
              title="Append enhanced tags to the end of your existing text"
            >
              <Plus className="h-3.5 w-3.5" />
              Append Tags
            </Button>
            <Button
              variant="accent"
              onClick={handleApplyReplace}
              disabled={!editedPrompt.trim()}
              title="Replace prompt with this enhanced version"
            >
              <Wand2 className="h-3.5 w-3.5" />
              Replace Prompt
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
};

