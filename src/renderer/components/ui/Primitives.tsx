import React, { useEffect, useRef } from "react";
import { X } from "lucide-react";

type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "accent"
  | "danger"
  | "creative"
  | "utility";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

/*
 * Primary  — sand ground, charcoal ink: the studio's identity action.
 * Accent   — electric blue, white ink: interactive commits such as Generate.
 * Secondary/Ghost — transparent, border or none.
 * Utility  — compact mono uppercase chip for technical toggles and tools.
 */
const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "bg-sand text-sand-fg border border-sand hover:bg-sand-hover hover:border-sand-hover disabled:opacity-45",
  secondary:
    "bg-transparent text-fg border border-border hover:border-border-strong hover:bg-surface-subtle disabled:opacity-45",
  ghost:
    "bg-transparent text-fg-muted border border-transparent hover:text-fg hover:bg-surface-subtle disabled:opacity-40",
  accent:
    "bg-accent-solid text-white border border-accent-solid hover:bg-accent-solid-hover hover:border-accent-solid-hover disabled:bg-[var(--accent-disabled-bg)] disabled:border-[var(--accent-disabled-border)] disabled:text-[var(--accent-disabled-fg)]",
  danger:
    "bg-transparent text-danger border border-danger/40 hover:border-danger/70 hover:bg-danger-soft disabled:opacity-45",
  creative:
    "bg-accent-solid text-white border border-accent-solid hover:bg-accent-solid-hover hover:border-accent-solid-hover disabled:bg-[var(--accent-disabled-bg)] disabled:border-[var(--accent-disabled-border)] disabled:text-[var(--accent-disabled-fg)]",
  utility:
    "bg-transparent text-fg-muted border border-border hover:text-fg hover:border-border-strong disabled:opacity-40",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-[11px] gap-1.5 rounded-sm",
  md: "h-8 px-3 text-xs gap-1.5 rounded-md",
  lg: "h-9 px-4 text-xs gap-2 rounded-lg",
};

const UTILITY_SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "h-6 px-2 text-[10px] gap-1 rounded-sm",
  md: "h-7 px-2.5 text-[10px] gap-1.5 rounded-sm",
  lg: "h-8 px-3 text-[10px] gap-1.5 rounded-sm",
};

export const Button: React.FC<ButtonProps> = ({
  variant = "secondary",
  size = "md",
  loading = false,
  disabled,
  className = "",
  children,
  type = "button",
  ...rest
}) => {
  const isUtility = variant === "utility";
  const typeClasses = isUtility
    ? "font-mono font-semibold uppercase tracking-[0.1em]"
    : "font-sans font-semibold tracking-[0.01em]";
  const sizeClasses = isUtility ? UTILITY_SIZE_CLASSES[size] : SIZE_CLASSES[size];
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center whitespace-nowrap transition-[background-color,border-color,color,transform] duration-150 ease-out active:scale-[0.98] disabled:active:scale-100 disabled:cursor-not-allowed ${typeClasses} ${VARIANT_CLASSES[variant]} ${sizeClasses} ${className}`}
      {...rest}
    >
      {loading && (
        <span
          className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin shrink-0"
          aria-hidden="true"
        />
      )}
      {children}
    </button>
  );
};

export const Card: React.FC<{
  className?: string;
  children: React.ReactNode;
}> = ({ className = "", children }) => (
  <div className={`bg-surface border border-border rounded-xl ${className}`}>
    {children}
  </div>
);

type BadgeTone = "neutral" | "sand" | "accent" | "creative" | "success" | "warning" | "danger" | "info";
const BADGE_CLASSES: Record<BadgeTone, string> = {
  neutral: "bg-surface-subtle text-fg-muted border-border",
  sand: "bg-sand-soft text-label border-sand-muted/35",
  accent: "bg-accent-soft text-accent-hover border-accent/25",
  creative: "bg-creative-soft text-creative border-creative/25",
  success: "bg-success-soft text-success border-success/25",
  warning: "bg-warning-soft text-warning border-warning/25",
  danger: "bg-danger-soft text-danger border-danger/25",
  info: "bg-info/10 text-info border-info/25",
};

export const Badge: React.FC<{
  tone?: BadgeTone;
  className?: string;
  children: React.ReactNode;
}> = ({ tone = "neutral", className = "", children }) => (
  <span
    className={`inline-flex items-center gap-1 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase leading-4 tracking-[0.08em] rounded-sm border whitespace-nowrap ${BADGE_CLASSES[tone]} ${className}`}
  >
    {children}
  </span>
);

export const Input: React.FC<React.InputHTMLAttributes<HTMLInputElement>> = ({
  className = "",
  ...props
}) => (
  <input
    className={`w-full h-8 px-2.5 text-small bg-bg border border-border rounded-md text-fg placeholder:text-fg-faint hover:border-border-strong focus-visible:border-accent transition-colors disabled:opacity-50 ${className}`}
    {...props}
  />
);

export const Textarea: React.FC<React.TextareaHTMLAttributes<HTMLTextAreaElement>> = ({
  className = "",
  ...props
}) => (
  <textarea
    className={`w-full p-2.5 text-small bg-bg border border-border rounded-md text-fg placeholder:text-fg-faint hover:border-border-strong focus-visible:border-accent transition-colors resize-none disabled:opacity-50 ${className}`}
    {...props}
  />
);

export const Select: React.FC<React.SelectHTMLAttributes<HTMLSelectElement>> = ({
  className = "",
  children,
  ...props
}) => (
  <select
    className={`w-full h-8 px-2 text-small bg-bg border border-border rounded-md text-fg hover:border-border-strong focus-visible:border-accent transition-colors cursor-pointer disabled:opacity-50 ${className}`}
    {...props}
  >
    {children}
  </select>
);

export const SliderField: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (value: number) => void;
}> = ({ label, value, min, max, step, suffix = "", onChange }) => (
  <div className="space-y-1.5">
    <div className="flex items-center justify-between text-xs">
      <span className="text-fg-muted font-medium">{label}</span>
      <span className="font-mono text-tech font-medium text-fg">
        {value}
        {suffix}
      </span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full cursor-pointer"
    />
  </div>
);

export const SectionHeader: React.FC<{
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  sticky?: boolean;
}> = ({ title, subtitle, actions, sticky = false }) => (
  <div
    className={`flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-border ${
      sticky
        ? "sticky -top-6 z-10 -mx-6 px-6 pt-6 bg-bg"
        : ""
    }`}
  >
    <div className="min-w-0">
      <h1 className="text-h1 text-fg">{title}</h1>
      {subtitle && (
        <p className="mt-1 text-small text-fg-muted max-w-2xl">{subtitle}</p>
      )}
    </div>
    {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
  </div>
);

export const PageHeader = SectionHeader;

export const EmptyState: React.FC<{
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
}> = ({ icon, title, description, action }) => (
  <div className="flex flex-col items-center justify-center text-center py-14 px-6 border border-dashed border-border rounded-xl bg-surface/60">
    <div className="text-fg-subtle mb-3 [&_svg]:w-6 [&_svg]:h-6">{icon}</div>
    <h3 className="text-h2 text-fg">{title}</h3>
    <p className="mt-1.5 text-small text-fg-muted max-w-md leading-relaxed">
      {description}
    </p>
    {action && <div className="mt-4">{action}</div>}
  </div>
);

export const Skeleton: React.FC<{
  className?: string;
  height?: number;
}> = ({ className = "", height }) => (
  <div
    aria-hidden="true"
    className={`bg-surface-subtle rounded-md ${className}`}
    style={height ? { height } : undefined}
  />
);

export const ProgressBar: React.FC<{
  value: number;
  label?: string;
  className?: string;
}> = ({ value, label, className = "" }) => (
  <div
    role="progressbar"
    aria-valuemin={0}
    aria-valuemax={100}
    aria-valuenow={Math.round(value)}
    aria-label={label}
    className={`w-full h-1.5 bg-surface-subtle rounded-full overflow-hidden ${className}`}
  >
    <div
      className="h-full bg-accent rounded-full transition-[width] duration-200 ease-out"
      style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
    />
  </div>
);

export const useDialogFocus = (
  open: boolean,
  onClose: () => void,
  panelRef: React.RefObject<HTMLElement | null>
): void => {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const focusables = (): HTMLElement[] =>
      panel
        ? Array.from(
            panel.querySelectorAll<HTMLElement>(
              'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
            )
          ).filter((node) => node.offsetParent !== null)
        : [];

    const first = focusables()[0];
    (first ?? panel)?.focus();

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const nodes = focusables();
      if (nodes.length === 0) return;
      const head = nodes[0]!;
      const tail = nodes[nodes.length - 1]!;
      if (!panel.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? tail : head).focus();
      } else if (event.shiftKey && document.activeElement === head) {
        event.preventDefault();
        tail.focus();
      } else if (!event.shiftKey && document.activeElement === tail) {
        event.preventDefault();
        head.focus();
      }
    };

    document.addEventListener("keydown", onKey, true);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = previousOverflow;
      previous?.focus?.();
    };
  }, [open, panelRef]);
};

export const Modal: React.FC<{
  open: boolean;
  onClose: () => void;
  title: string | React.ReactNode;
  maxWidthClass?: string;
  children: React.ReactNode;
}> = ({ open, onClose, title, maxWidthClass = "max-w-lg", children }) => {
  const panelRef = useRef<HTMLDivElement | null>(null);
  useDialogFocus(open, onClose, panelRef);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-[var(--scrim)] animate-[kirea-overlay-in_140ms_ease-out]"
      role="dialog"
      aria-modal="true"
      aria-label={typeof title === "string" ? title : "Dialog"}
      onClick={onClose}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className={`w-full ${maxWidthClass} bg-surface border border-border-strong rounded-2xl overflow-hidden shadow-[var(--shadow-float)] animate-[kirea-panel-in_180ms_ease-out] focus-visible:outline-none`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-surface-elevated">
          {typeof title === "string" ? <h2 className="text-h2 text-fg">{title}</h2> : title}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="p-1.5 rounded-lg text-fg-muted hover:text-fg hover:bg-surface-subtle transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
};

export const ConfirmDialog: React.FC<{
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmLabel?: string;
  danger?: boolean;
}> = ({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirm",
  danger = true,
}) => (
  <Modal open={open} onClose={onClose} title={title} maxWidthClass="max-w-md">
    <p className="text-small text-fg-muted leading-relaxed">{description}</p>
    <div className="mt-5 flex justify-end gap-2">
      <Button variant="secondary" onClick={onClose}>
        Cancel
      </Button>
      <Button
        variant={danger ? "danger" : "primary"}
        onClick={() => {
          onConfirm();
          onClose();
        }}
      >
        {confirmLabel}
      </Button>
    </div>
  </Modal>
);
