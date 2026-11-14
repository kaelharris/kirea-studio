import React, { useEffect, useRef, useState } from "react";
import { ImageOff, Loader2 } from "lucide-react";
import type { ModelRecord } from "../../shared/types";

interface ModelPreviewProps {
  model: ModelRecord;
  className?: string;
  iconSizeClass?: string;
}

/**
 * Lazily fetches a model's effective preview through the dedicated, main-process
 * allowlisted IPC channel. Nothing is read from disk inside the renderer.
 */
export const ModelPreview: React.FC<ModelPreviewProps> = ({
  model,
  className = "h-36",
  iconSizeClass = "w-5 h-5",
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const previewKey = `${model.metadata?.previewMode ?? "auto"}|${
    model.metadata?.previewPath ?? ""
  }|${model.metadata?.updatedAt ?? ""}|${model.discovery?.previewPath ?? ""}`;

  useEffect(() => {
    setSrc(null);
  }, [previewKey]);

  useEffect(() => {
    if (visible) return;
    const el = containerRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "240px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoading(true);
    window.kirea
      .getModelPreview(model.id)
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setSrc(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, model.id, previewKey]);

  return (
    <div
      ref={containerRef}
      className={`relative w-full overflow-hidden rounded-xl border border-border bg-bg/70 flex items-center justify-center ${className}`}
    >
      {src ? (
        <img
          src={src}
          alt={`${model.name} preview`}
          className="w-full h-full object-cover"
          draggable={false}
        />
      ) : loading ? (
        <Loader2 className={`${iconSizeClass} text-fg-subtle animate-spin`} />
      ) : (
        <div className="flex flex-col items-center gap-1 text-fg-subtle">
          <ImageOff className={iconSizeClass} />
          <span className="text-[11px] uppercase tracking-wider">No preview</span>
        </div>
      )}
    </div>
  );
};
