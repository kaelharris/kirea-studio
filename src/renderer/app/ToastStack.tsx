import React from "react";
import type { ToastItem } from "./app-constants";

export const ToastStack: React.FC<{ toasts: ToastItem[] }> = ({ toasts }) => (
  <div
    className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm pointer-events-none"
    aria-live="polite"
  >
    {toasts.map((t) => (
      <div
        key={t.id}
        className={`px-3.5 py-2 rounded-lg border text-small font-medium pointer-events-auto shadow-[var(--shadow-float)] animate-[kirea-panel-in_180ms_ease-out] ${
          t.tone === "error"
            ? "bg-surface border-danger/40 text-danger"
            : "bg-surface-elevated border-border-strong text-fg"
        }`}
      >
        {t.message}
      </div>
    ))}
  </div>
);
