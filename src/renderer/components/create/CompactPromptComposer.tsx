import React, { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  BookmarkPlus,
  ChevronDown,
  ChevronUp,
  Copy,
  Eraser,
  Lock,
  Sparkles,
  Square,
  Wand2,
} from "lucide-react";
import {
  Button,
  useContextMenu,
  type ContextMenuItem,
} from "../ui/Primitives";
import { PROMPT_SNIPPETS } from "../../../shared/presets";
import { MagicPromptModal } from "./MagicPromptModal";
import type { ModelArchitecture, ValidationIssue } from "../../../shared/types";

export interface CompactPromptComposerProps {
  prompt: string;
  negativePrompt: string;
  onPromptChange: (newPrompt: string) => void;
  onNegativePromptChange: (newNegative: string) => void;
  onGenerate: () => void;
  onCancel?: () => void;
  submitting: boolean;
  blockingErrors: ValidationIssue[];
  warnings: ValidationIssue[];
  architecture?: ModelArchitecture | "unknown";
  onSavePrompt?: () => void;
  onToast: (msg: string) => void;
  isEngineOnline?: boolean;
  activeJob?: boolean;
}

export const CompactPromptComposer: React.FC<CompactPromptComposerProps> = ({
  prompt,
  negativePrompt,
  onPromptChange,
  onNegativePromptChange,
  onGenerate,
  onCancel,
  submitting,
  blockingErrors,
  warnings,
  architecture = "illustrious",
  onSavePrompt,
  onToast,
  isEngineOnline = true,
  activeJob = false,
}) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [showNegative, setShowNegative] = useState(false);
  const [magicModalOpen, setMagicModalOpen] = useState(false);

  const negativeTagCount = negativePrompt
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean).length;

  // Content-aware expansion state:
  // Expanded if user is interacting (focus or hover) OR prompt has multiple lines / length > 70
  const isMultiLine = prompt.includes("\n") || prompt.length > 70;
  const isExpanded = isFocused || isHovered || isMultiLine;

  // Auto-resize textarea height to content with smooth transition
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    if (!isExpanded && !isMultiLine) {
      el.style.height = "38px";
      return;
    }
    el.style.height = "auto";
    const nextHeight = Math.min(220, Math.max(68, el.scrollHeight));
    el.style.height = `${nextHeight}px`;
  }, [prompt, isExpanded, isMultiLine]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      if (!submitting && blockingErrors.length === 0) {
        onGenerate();
      }
    }
  };

  const handleApplySnippet = (snippetText: string) => {
    const trimmed = prompt.trim();
    const updated = trimmed ? `${trimmed}, ${snippetText}` : snippetText;
    onPromptChange(updated);
    textareaRef.current?.focus();
  };

  const { showContextMenu } = useContextMenu();

  const handlePromptContextMenu = (e: React.MouseEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    e.stopPropagation();

    const textarea = textareaRef.current;
    const selectedText = textarea
      ? textarea.value.substring(textarea.selectionStart, textarea.selectionEnd)
      : "";
    const hasSelection = selectedText.length > 0;

    const items: ContextMenuItem[] = [
      {
        id: "prompt-undo",
        label: "Undo",
        shortcut: "Ctrl+Z",
        onClick: () => {
          textarea?.focus();
          document.execCommand("undo");
        },
      },
      {
        id: "prompt-redo",
        label: "Redo",
        shortcut: "Ctrl+Y",
        onClick: () => {
          textarea?.focus();
          document.execCommand("redo");
        },
        separator: true,
      },
      {
        id: "prompt-cut",
        label: "Cut",
        shortcut: "Ctrl+X",
        disabled: !hasSelection,
        disabledReason: "No text selected to cut",
        onClick: () => {
          if (!textarea) return;
          const start = textarea.selectionStart;
          const end = textarea.selectionEnd;
          void navigator.clipboard.writeText(selectedText).catch(() => {});
          const nextVal =
            textarea.value.substring(0, start) + textarea.value.substring(end);
          onPromptChange(nextVal);
        },
      },
      {
        id: "prompt-copy",
        label: hasSelection ? "Copy Selection" : "Copy Entire Prompt",
        shortcut: "Ctrl+C",
        disabled: !prompt,
        disabledReason: "Prompt is empty",
        onClick: () => {
          const textToCopy = hasSelection ? selectedText : prompt;
          void navigator.clipboard.writeText(textToCopy).catch(() => {});
          onToast("Copied to clipboard.");
        },
      },
      {
        id: "prompt-paste",
        label: "Paste",
        shortcut: "Ctrl+V",
        onClick: () => {
          void navigator.clipboard
            .readText()
            .then((clipText) => {
              if (!clipText || !textarea) return;
              const start = textarea.selectionStart;
              const end = textarea.selectionEnd;
              const nextVal =
                textarea.value.substring(0, start) +
                clipText +
                textarea.value.substring(end);
              onPromptChange(nextVal);
            })
            .catch(() => {});
        },
      },
      {
        id: "prompt-select-all",
        label: "Select All",
        shortcut: "Ctrl+A",
        onClick: () => {
          textarea?.select();
        },
        separator: true,
      },
      {
        id: "prompt-magic",
        label: "Magic Prompt Enhancement...",
        icon: <Wand2 className="w-3.5 h-3.5 text-accent" />,
        onClick: () => setMagicModalOpen(true),
      },
      {
        id: "prompt-snippets",
        label: "Append Snippet",
        icon: <Sparkles className="w-3.5 h-3.5 text-creative" />,
        children: PROMPT_SNIPPETS.map((snip, idx) => ({
          id: `snippet-${idx}`,
          label: snip.label,
          onClick: () => handleApplySnippet(snip.text),
        })),
        separator: Boolean(onSavePrompt),
      },
    ];

    if (onSavePrompt) {
      items.push({
        id: "prompt-save",
        label: "Save Prompt to Library",
        icon: <BookmarkPlus className="w-3.5 h-3.5" />,
        disabled: !prompt.trim(),
        disabledReason: "Prompt is empty",
        onClick: onSavePrompt,
        separator: true,
      });
    }

    items.push({
      id: "prompt-clear",
      label: "Clear Prompt",
      icon: <Eraser className="w-3.5 h-3.5" />,
      disabled: !prompt,
      disabledReason: "Prompt is empty",
      destructive: true,
      onClick: () => onPromptChange(""),
    });

    showContextMenu({
      x: e.clientX,
      y: e.clientY,
      title: "Prompt Composer",
      items,
    });
  };

  const handleNegativePromptContextMenu = (
    e: React.MouseEvent<HTMLTextAreaElement>
  ) => {
    e.preventDefault();
    e.stopPropagation();

    const target = e.currentTarget;
    const selectedText = target.value.substring(
      target.selectionStart,
      target.selectionEnd
    );
    const hasSelection = selectedText.length > 0;

    const items: ContextMenuItem[] = [
      {
        id: "neg-cut",
        label: "Cut",
        shortcut: "Ctrl+X",
        disabled: !hasSelection,
        disabledReason: "No text selected",
        onClick: () => {
          const start = target.selectionStart;
          const end = target.selectionEnd;
          void navigator.clipboard.writeText(selectedText).catch(() => {});
          const nextVal =
            target.value.substring(0, start) + target.value.substring(end);
          onNegativePromptChange(nextVal);
        },
      },
      {
        id: "neg-copy",
        label: hasSelection ? "Copy Selection" : "Copy Entire Negative Prompt",
        shortcut: "Ctrl+C",
        disabled: !negativePrompt,
        disabledReason: "Negative prompt is empty",
        onClick: () => {
          const textToCopy = hasSelection ? selectedText : negativePrompt;
          void navigator.clipboard.writeText(textToCopy).catch(() => {});
          onToast("Copied to clipboard.");
        },
      },
      {
        id: "neg-paste",
        label: "Paste",
        shortcut: "Ctrl+V",
        onClick: () => {
          void navigator.clipboard
            .readText()
            .then((clipText) => {
              if (!clipText) return;
              const start = target.selectionStart;
              const end = target.selectionEnd;
              const nextVal =
                target.value.substring(0, start) +
                clipText +
                target.value.substring(end);
              onNegativePromptChange(nextVal);
            })
            .catch(() => {});
        },
      },
      {
        id: "neg-select-all",
        label: "Select All",
        shortcut: "Ctrl+A",
        onClick: () => target.select(),
        separator: true,
      },
      {
        id: "neg-clear",
        label: "Clear Negative Prompt",
        icon: <Eraser className="w-3.5 h-3.5" />,
        disabled: !negativePrompt,
        disabledReason: "Negative prompt is empty",
        destructive: true,
        onClick: () => onNegativePromptChange(""),
      },
    ];

    showContextMenu({
      x: e.clientX,
      y: e.clientY,
      title: "Negative Prompt",
      items,
    });
  };

  return (
    <div
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="order-2 shrink-0 space-y-2 rounded-xl border border-border bg-surface-elevated p-3 shadow-[var(--shadow-float)] transition-all duration-200 focus-within:border-accent/80"
    >
      {/* Top Composer Bar: Architecture indicator, Magic Prompt, Snippets & Actions */}
      <div className="flex flex-wrap items-center justify-between gap-1.5 text-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-label">
            Prompt
          </span>

          {/* Magic Danbooru Enhancer Trigger */}
          <button
            type="button"
            onClick={() => setMagicModalOpen(true)}
            className="inline-flex items-center gap-1 rounded-md border border-accent/40 bg-accent-soft/40 px-2 py-0.5 font-medium text-accent hover:bg-accent-soft hover:border-accent transition-colors cursor-pointer text-[11px]"
            title="Enhance natural language into model-aware Danbooru tags"
          >
            <Sparkles className="h-3 w-3 animate-pulse" />
            <span>Magic Danbooru</span>
          </button>

          {/* Quick Snippets (visible when expanded or prompt has content) */}
          {isExpanded &&
            PROMPT_SNIPPETS.slice(0, 3).map((snippet) => (
              <button
                key={snippet.label}
                type="button"
                onClick={() => handleApplySnippet(snippet.text)}
                className="hidden sm:inline-flex items-center rounded-md border border-border bg-surface-subtle px-1.5 py-0.5 text-[10px] text-fg-muted hover:border-border-strong hover:text-fg transition-colors cursor-pointer"
              >
                + {snippet.label}
              </button>
            ))}
        </div>

        {/* Right Tool Buttons */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setShowNegative((open) => !open)}
            aria-expanded={showNegative}
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors cursor-pointer border ${
              showNegative
                ? "bg-accent-soft text-accent border-accent/40"
                : negativeTagCount > 0
                  ? "bg-surface-subtle text-fg-muted border-border hover:border-border-strong"
                  : "text-fg-subtle hover:text-fg border-transparent hover:bg-surface-subtle"
            }`}
          >
            <span>
              Negative{negativeTagCount > 0 ? ` · ${negativeTagCount} tags` : ""}
            </span>
            {showNegative ? (
              <ChevronUp className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
          </button>

          {onSavePrompt && (
            <button
              type="button"
              onClick={onSavePrompt}
              disabled={!prompt.trim()}
              title="Save current prompt to Library"
              className="inline-flex items-center gap-1 rounded-md p-1 text-fg-subtle hover:text-fg disabled:opacity-40 transition-colors cursor-pointer"
            >
              <BookmarkPlus className="h-3.5 w-3.5" />
            </button>
          )}

          {prompt.trim() && (
            <button
              type="button"
              onClick={() => {
                onPromptChange("");
                onNegativePromptChange("");
              }}
              title="Clear prompt fields"
              className="inline-flex items-center gap-1 rounded-md p-1 text-fg-subtle hover:text-danger transition-colors cursor-pointer"
            >
              <Eraser className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Main Prompt Input Field (Single-line to Multi-line Auto-expanding) */}
      <div className="relative">
        <textarea
          ref={textareaRef}
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onKeyDown={handleKeyDown}
          onContextMenu={handlePromptContextMenu}
          placeholder="Describe your scene, characters, lighting, framing, aesthetic mood... (Ctrl+Enter to render)"
          style={{
            minHeight: isExpanded ? "68px" : "38px",
            maxHeight: "220px",
          }}
          className="w-full resize-none rounded-lg border border-border bg-bg/90 px-3 py-2 text-xs text-fg leading-relaxed placeholder:text-fg-subtle focus:border-accent focus:outline-none transition-[min-height] duration-200 ease-out"
        />
      </div>

      {/* Collapsible Negative Prompt Field */}
      {showNegative && (
        <div className="pt-0.5 animate-[kirea-panel-in_150ms_ease-out]">
          <textarea
            rows={2}
            value={negativePrompt}
            onChange={(e) => onNegativePromptChange(e.target.value)}
            onContextMenu={handleNegativePromptContextMenu}
            placeholder="Negative prompt: blurry, artifacts, bad anatomy, text, low quality..."
            className="w-full resize-none rounded-lg border border-border bg-bg/70 px-3 py-1.5 text-xs text-fg-muted placeholder:text-fg-subtle focus:border-border-strong focus:outline-none"
          />
        </div>
      )}

      {/* Bottom Status & Execution Row */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-border/60">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {blockingErrors.map((err, i) => (
            <span
              key={`err-${i}`}
              className="inline-flex items-center gap-1 rounded bg-danger-soft px-2 py-0.5 text-[11px] text-danger"
            >
              <AlertCircle className="h-3 w-3 shrink-0" />
              {err.message}
            </span>
          ))}

          {blockingErrors.length === 0 &&
            warnings.map((w, i) => (
              <span
                key={`warn-${i}`}
                className="inline-flex items-center gap-1 rounded bg-warning-soft px-2 py-0.5 text-[11px] text-warning"
              >
                <AlertTriangle className="h-3 w-3 shrink-0" />
                {w.message}
              </span>
            ))}

          {blockingErrors.length === 0 && warnings.length === 0 && (
            <span className="inline-flex items-center gap-1.5 text-[11px] text-fg-subtle">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  isEngineOnline ? "bg-success" : "bg-warning"
                }`}
              />
              <span>{isEngineOnline ? "Engine online" : "Engine idle"} · Ctrl+Enter</span>
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {activeJob && onCancel && (
            <Button variant="danger" size="sm" onClick={onCancel}>
              <Square className="h-3.5 w-3.5 fill-current" />
              Cancel
            </Button>
          )}

          <Button
            variant="accent"
            size="md"
            loading={submitting}
            disabled={blockingErrors.length > 0}
            onClick={onGenerate}
          >
            <Sparkles className="h-3.5 w-3.5" />
            {activeJob ? "Queue Another" : "Generate Image"}
          </Button>
        </div>
      </div>

      {/* Magic Danbooru Prompt Modal */}
      <MagicPromptModal
        open={magicModalOpen}
        onClose={() => setMagicModalOpen(false)}
        currentPrompt={prompt}
        architecture={architecture}
        onApply={(newPrompt) => {
          onPromptChange(newPrompt);
          setMagicModalOpen(false);
        }}
        onAppend={(appendedPrompt) => {
          onPromptChange(appendedPrompt);
          setMagicModalOpen(false);
        }}
        onToast={onToast}
      />
    </div>
  );
};
