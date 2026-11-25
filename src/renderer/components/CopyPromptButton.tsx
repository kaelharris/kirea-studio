import React, { useState, useRef, useEffect } from "react";
import { Check, Copy } from "lucide-react";

export interface CopyPromptButtonProps {
  prompt: string;
  negativePrompt?: string;
  seed?: number | string;
  steps?: number;
  cfg?: number;
  sampler?: string;
  scheduler?: string;
  checkpoint?: string;
  loras?: unknown;
  width?: number;
  height?: number;
  className?: string;
  variant?: "default" | "compact" | "filmstrip" | "icon";
  onToast?: (msg: string, tone?: "info" | "error") => void;
}

export function buildPromptCopyText(
  props: CopyPromptButtonProps,
  includeParameters: boolean
): string {
  if (!includeParameters) return props.prompt;

  const loraSummary = Array.isArray(props.loras)
    ? props.loras
        .map((value: unknown) => {
          if (!value || typeof value !== "object") return "LoRA (1)";
          const lora = value as Record<string, unknown>;
          const name = lora.name || lora.loraName || lora.loraPath || "LoRA";
          const weight = lora.strengthModel ?? lora.weight ?? 1;
          return `${String(name)} (${String(weight)})`;
        })
        .join(", ")
    : "";

  return [
    `Positive Prompt: ${props.prompt}`,
    props.negativePrompt ? `Negative Prompt: ${props.negativePrompt}` : null,
    props.seed !== undefined && props.seed !== null ? `Seed: ${props.seed}` : null,
    props.steps || props.cfg || props.sampler
      ? `Steps: ${props.steps ?? "N/A"} | CFG: ${props.cfg ?? "N/A"} | Sampler: ${props.sampler ?? "N/A"}${props.scheduler ? ` (${props.scheduler})` : ""}`
      : null,
    props.checkpoint ? `Checkpoint: ${props.checkpoint}` : null,
    loraSummary ? `LoRAs: ${loraSummary}` : null,
    props.width && props.height ? `Dimensions: ${props.width}×${props.height}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export const CopyPromptButton: React.FC<CopyPromptButtonProps> = ({
  prompt,
  negativePrompt,
  seed,
  steps,
  cfg,
  sampler,
  scheduler,
  checkpoint,
  loras,
  width,
  height,
  className = "",
  variant = "default",
  onToast,
}) => {
  const [copiedState, setCopiedState] = useState<"idle" | "prompt" | "params">("idle");
  const [copyError, setCopyError] = useState("");
  const timerRef = useRef<NodeJS.Timeout | number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  const copyText = async (includeParameters: boolean): Promise<void> => {
    if (!prompt) return;
    setCopyError("");
    try {
      await navigator.clipboard.writeText(
        buildPromptCopyText(
          { prompt, negativePrompt, seed, steps, cfg, sampler, scheduler, checkpoint, loras, width, height },
          includeParameters
        )
      );
      setCopiedState(includeParameters ? "params" : "prompt");
      onToast?.(
        includeParameters
          ? "Copied full generation parameters to clipboard."
          : "Copied positive prompt to clipboard."
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Prompt could not be copied.";
      setCopiedState("idle");
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      setCopyError(`Copy failed: ${message}`);
      onToast?.(message, "error");
      return;
    }

    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setCopiedState("idle");
    }, 1500);
  };

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation();
    event.preventDefault();
    void copyText(event.shiftKey);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>): void => {
    if (e.key === "Enter" && e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      void copyText(true);
    }
  };

  const isCopied = copiedState !== "idle";
  const statusMessage =
    copyError ||
    (copiedState === "params"
      ? "Copied full generation parameters to clipboard."
      : copiedState === "prompt"
        ? "Copied positive prompt to clipboard."
        : "");
  const liveStatus = (
    <span role="status" aria-live="polite" className="sr-only">
      {statusMessage}
    </span>
  );
  const title =
    "[COPY_PROMPT] Click to copy positive prompt. Shift+click or Shift+Enter for full generation parameters.";

  if (variant === "filmstrip") {
    return (
      <>
        <button
          type="button"
          onClick={handleClick}
          onKeyDown={handleKeyDown}
          title={title}
          aria-label={copyError ? "Copy prompt failed. Activate to retry." : "Copy prompt"}
          className={`absolute bottom-0 inset-x-0 h-4.5 flex items-center justify-center font-mono text-[9px] font-bold tracking-wider uppercase select-none transition-none z-20 ${
            isCopied
              ? "bg-[#1E3BFF] text-[#F2F2EE]"
              : "bg-[#0B0C10]/90 text-[#F2F2EE]/90 hover:bg-[#1E3BFF] hover:text-[#F2F2EE]"
          } ${className}`}
        >
          {copyError ? "COPY FAILED" : isCopied ? "COPIED ✓" : "PROMPT"}
        </button>
        {liveStatus}
      </>
    );
  }

  if (variant === "compact") {
    return (
      <>
        <button
          type="button"
          onClick={handleClick}
          onKeyDown={handleKeyDown}
          title={title}
          aria-label={copyError ? "Copy prompt failed. Activate to retry." : "Copy prompt"}
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-none border-2 font-mono text-[10px] font-bold tracking-wider uppercase select-none cursor-pointer transition-none ${
            isCopied
              ? "border-[#1E3BFF] bg-[#1E3BFF] text-[#F2F2EE]"
              : "border-[#F2F2EE]/60 bg-[#0B0C10] text-[#F2F2EE] hover:border-[#1E3BFF] hover:bg-[#1E3BFF]"
          } ${className}`}
        >
          {isCopied ? (
            <>
              <Check className="w-3 h-3" strokeWidth={2} />
              <span>{copiedState === "params" ? "PARAMS ✓" : "COPIED ✓"}</span>
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" strokeWidth={2} />
              <span>{copyError ? "COPY FAILED" : "COPY"}</span>
            </>
          )}
        </button>
        {liveStatus}
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        title={title}
        aria-label={
          copyError ? "Copy generation prompt failed. Activate to retry." : "Copy generation prompt"
        }
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-none border-2 font-mono text-[11px] font-bold tracking-wider uppercase select-none cursor-pointer shadow-[2px_2px_0px_#0B0C10] transition-none ${
          isCopied
            ? "border-[#1E3BFF] bg-[#1E3BFF] text-[#F2F2EE]"
            : "border-[#F2F2EE] bg-[#0B0C10] text-[#F2F2EE] hover:border-[#1E3BFF] hover:bg-[#1E3BFF]"
        } ${className}`}
      >
        {isCopied ? (
          <>
            <Check className="w-3.5 h-3.5" strokeWidth={2} />
            <span>{copiedState === "params" ? "[PARAMS COPIED ✓]" : "[COPIED ✓]"}</span>
          </>
        ) : (
          <>
            <Copy className="w-3.5 h-3.5" strokeWidth={2} />
            <span>{copyError ? "[COPY FAILED]" : "[COPY_PROMPT]"}</span>
          </>
        )}
      </button>
      {liveStatus}
    </>
  );
};
