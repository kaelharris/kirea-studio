import React, { useState } from "react";
import { ImageOff } from "lucide-react";

export const MediaImage: React.FC<
  React.ImgHTMLAttributes<HTMLImageElement> & {
    fallbackLabel?: string;
    compact?: boolean;
    /** Called once when the file cannot be loaded (moved, deleted, unreadable). */
    onLoadFailure?: () => void;
  }
> = ({
  className = "",
  fallbackLabel = "File not found",
  compact = false,
  onLoadFailure,
  alt,
  ...rest
}) => {
  const [failed, setFailed] = useState(false);

  if (failed) {
    const decorative = !alt;
    return (
      <div
        role={decorative ? undefined : "img"}
        aria-label={decorative ? undefined : alt}
        aria-hidden={decorative || undefined}
        className={`flex flex-col items-center justify-center gap-1.5 overflow-hidden bg-surface-subtle ${className}`}
      >
        <ImageOff
          className={`${compact ? "h-4 w-4" : "h-5 w-5"} text-fg-subtle`}
          aria-hidden="true"
        />
        {!compact && (
          <span className="text-caption text-fg-muted">{fallbackLabel}</span>
        )}
      </div>
    );
  }

  // Enforce global aspect-ratio preservation: always contain and center, never crop
  const normalizedClass = className.includes("object-cover")
    ? className.replace(/\bobject-cover\b/g, "object-contain object-center")
    : className.includes("object-contain")
      ? (!className.includes("object-center") && !className.includes("object-top") && !className.includes("object-bottom") && !className.includes("object-left") && !className.includes("object-right")
          ? `${className} object-center`
          : className)
      : `object-contain object-center ${className}`;

  return (
    <img
      alt={alt}
      className={normalizedClass}
      onError={() => {
        setFailed(true);
        onLoadFailure?.();
      }}
      {...rest}
    />
  );
};
