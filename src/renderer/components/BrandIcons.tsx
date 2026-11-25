import React from "react";

interface IconBaseProps extends React.SVGProps<SVGSVGElement> {
  size?: number;
  className?: string;
}

/**
 * Kirea Winged Muse Emblem:
 * Sharp geometric winged muse insignia in inherited foreground ink
 * with the active theme's accent color for the eye/accent reticle.
 */
export const KireaWingedMuse: React.FC<IconBaseProps> = ({
  size = 32,
  className = "",
  ...props
}) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`shrink-0 select-none ${className}`}
      {...props}
    >
      {/* Outer framing geometric reticle brackets */}
      <path
        d="M2 10V2H10M38 2H46V10M46 38V46H38M10 46H2V38"
        stroke="var(--accent-solid)"
        strokeWidth="2"
        strokeLinecap="square"
      />

      {/* Left Wing - Sharp Origami Feathers */}
      <path
        d="M6 14L18 8L20 18L10 22L6 14Z"
        fill="currentColor"
      />
      <path
        d="M4 22L16 18L18 28L8 30L4 22Z"
        fill="currentColor"
        fillOpacity="0.85"
      />
      <path
        d="M6 30L16 26L16 36L8 38L6 30Z"
        fill="currentColor"
        fillOpacity="0.7"
      />

      {/* Right Wing - Sharp Origami Feathers */}
      <path
        d="M42 14L30 8L28 18L38 22L42 14Z"
        fill="currentColor"
      />
      <path
        d="M44 22L32 18L30 28L40 30L44 22Z"
        fill="currentColor"
        fillOpacity="0.85"
      />
      <path
        d="M42 30L32 26L32 36L40 38L42 30Z"
        fill="currentColor"
        fillOpacity="0.7"
      />

      {/* Central Muse Visor & Crown */}
      <polygon
        points="24,6 29,14 24,19 19,14"
        fill="var(--accent-solid)"
      />
      <polygon
        points="24,18 30,26 24,42 18,26"
        fill="currentColor"
      />

      {/* Electric Ultramarine Center Ocular Reticle */}
      <rect x="22" y="24" width="4" height="4" fill="var(--accent-solid)" />
      <circle cx="24" cy="26" r="1.5" fill="var(--emblem-plate)" />
    </svg>
  );
};

/* -------------------------------------------------------------------------- */
/* Architecture & Engine Badges                                              */
/* -------------------------------------------------------------------------- */

interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
}

export const ComfyUiBadge: React.FC<BadgeProps> = ({ className = "", ...props }) => (
  <div
    className={`inline-flex items-center gap-1.5 px-2 py-0.5 border-2 border-border-strong bg-surface text-fg font-mono text-[10px] font-bold tracking-wider uppercase select-none shadow-[var(--shadow-float)] ${className}`}
    {...props}
  >
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
      <rect x="1" y="1" width="6" height="6" fill="var(--accent-solid)" stroke="currentColor" strokeWidth="1.5" />
      <rect x="9" y="9" width="6" height="6" fill="currentColor" stroke="var(--surface)" strokeWidth="1.5" />
      <path d="M7 4H12V9" stroke="var(--accent-solid)" strokeWidth="1.5" />
    </svg>
    <span>COMFYUI</span>
  </div>
);

export const CivitaiBadge: React.FC<BadgeProps> = ({ className = "", ...props }) => (
  <div
    className={`inline-flex items-center gap-1.5 px-2 py-0.5 border-2 border-accent bg-surface text-fg font-mono text-[10px] font-bold tracking-wider uppercase select-none shadow-[var(--shadow-float)] ${className}`}
    {...props}
  >
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
      <path d="M8 1L15 5V11L8 15L1 11V5L8 1Z" stroke="var(--accent-solid)" strokeWidth="1.5" fill="var(--accent-solid)" fillOpacity="0.2" />
      <circle cx="8" cy="8" r="2.5" fill="currentColor" />
    </svg>
    <span>CIVITAI</span>
  </div>
);

export const SdxlBadge: React.FC<BadgeProps> = ({ className = "", ...props }) => (
  <div
    className={`inline-flex items-center gap-1.5 px-2 py-0.5 border-2 border-border-strong bg-surface text-fg font-mono text-[10px] font-bold tracking-wider uppercase select-none ${className}`}
    {...props}
  >
    <span className="w-2 h-2 bg-accent-solid" />
    <span>SDXL 1.0</span>
  </div>
);

export const FluxBadge: React.FC<BadgeProps> = ({ className = "", ...props }) => (
  <div
    className={`inline-flex items-center gap-1.5 px-2 py-0.5 border-2 border-accent bg-surface text-fg font-mono text-[10px] font-bold tracking-wider uppercase select-none ${className}`}
    {...props}
  >
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
      <polygon points="6,0 12,6 6,12 0,6" fill="var(--accent-solid)" />
    </svg>
    <span>FLUX.1</span>
  </div>
);

export const IllustriousBadge: React.FC<BadgeProps> = ({ className = "", ...props }) => (
  <div
    className={`inline-flex items-center gap-1.5 px-2 py-0.5 border-2 border-border-strong bg-surface text-fg font-mono text-[10px] font-bold tracking-wider uppercase select-none ${className}`}
    {...props}
  >
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
      <path d="M6 0L7.5 4.5L12 6L7.5 7.5L6 12L4.5 7.5L0 6L4.5 4.5L6 0Z" fill="currentColor" />
    </svg>
    <span>ILLUSTRIOUS</span>
  </div>
);

export const PonyBadge: React.FC<BadgeProps> = ({ className = "", ...props }) => (
  <div
    className={`inline-flex items-center gap-1.5 px-2 py-0.5 border-2 border-border-strong bg-surface text-fg font-mono text-[10px] font-bold tracking-wider uppercase select-none ${className}`}
    {...props}
  >
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
      <path d="M2 10L6 2L10 10H2Z" stroke="var(--accent-solid)" strokeWidth="2" fill="none" />
    </svg>
    <span>PONY</span>
  </div>
);

export const WanVideoBadge: React.FC<BadgeProps> = ({ className = "", ...props }) => (
  <div
    className={`inline-flex items-center gap-1.5 px-2 py-0.5 border-2 border-accent bg-surface text-fg font-mono text-[10px] font-bold tracking-wider uppercase select-none ${className}`}
    {...props}
  >
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
      <rect x="1" y="2" width="10" height="8" stroke="currentColor" strokeWidth="1.5" />
      <polygon points="4.5,4 8.5,6 4.5,8" fill="var(--accent-solid)" />
    </svg>
    <span>WAN 2.1</span>
  </div>
);

/* -------------------------------------------------------------------------- */
/* Halftone Corner Brackets & Pixel Dividers                                  */
/* -------------------------------------------------------------------------- */

interface ReticleCornerBracketsProps {
  className?: string;
  size?: number;
  bracketColor?: string;
  accentColor?: string;
}

/**
 * Reusable SVG reticle corner marks for framing the adaptive aspect-ratio viewport
 * with 90-degree 2px crosshairs, ticking lines, and corner pixel boxes.
 */
export const ReticleCornerBrackets: React.FC<ReticleCornerBracketsProps> = ({
  className = "",
  size = 20,
  bracketColor = "currentColor",
  accentColor = "var(--accent-solid)",
}) => {
  return (
    <div className={`pointer-events-none absolute inset-0 select-none ${className}`}>
      {/* Top Left Bracket */}
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        className="absolute top-2 left-2"
      >
        <path d="M2 14V2H14" stroke={bracketColor} strokeWidth="2" />
        <rect x="2" y="2" width="4" height="4" fill={accentColor} />
      </svg>

      {/* Top Right Bracket */}
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        className="absolute top-2 right-2"
      >
        <path d="M22 14V2H10" stroke={bracketColor} strokeWidth="2" />
        <rect x="18" y="2" width="4" height="4" fill={accentColor} />
      </svg>

      {/* Bottom Left Bracket */}
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        className="absolute bottom-2 left-2"
      >
        <path d="M2 10V22H14" stroke={bracketColor} strokeWidth="2" />
        <rect x="2" y="18" width="4" height="4" fill={accentColor} />
      </svg>

      {/* Bottom Right Bracket */}
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        className="absolute bottom-2 right-2"
      >
        <path d="M22 10V22H10" stroke={bracketColor} strokeWidth="2" />
        <rect x="18" y="18" width="4" height="4" fill={accentColor} />
      </svg>
    </div>
  );
};

interface PixelDividerProps {
  orientation?: "horizontal" | "vertical";
  className?: string;
  color?: string;
}

/**
 * Halftone Pixel Divider: crisp 2px square dash-dot pattern for segmenting workstation panels.
 */
export const PixelDivider: React.FC<PixelDividerProps> = ({
  orientation = "horizontal",
  className = "",
  color = "currentColor",
}) => {
  if (orientation === "vertical") {
    return (
      <svg
        width="4"
        height="100%"
        className={`shrink-0 select-none ${className}`}
        style={{ minHeight: "16px" }}
      >
        <defs>
          <pattern id="pixel-dot-v" width="4" height="8" patternUnits="userSpaceOnUse">
            <rect x="1" y="1" width="2" height="2" fill={color} fillOpacity="0.4" />
          </pattern>
        </defs>
        <rect width="4" height="100%" fill="url(#pixel-dot-v)" />
      </svg>
    );
  }

  return (
    <svg
      width="100%"
      height="4"
      className={`shrink-0 select-none ${className}`}
      style={{ minWidth: "16px" }}
    >
      <defs>
        <pattern id="pixel-dot-h" width="8" height="4" patternUnits="userSpaceOnUse">
          <rect x="1" y="1" width="2" height="2" fill={color} fillOpacity="0.4" />
        </pattern>
      </defs>
      <rect width="100%" height="4" fill="url(#pixel-dot-h)" />
    </svg>
  );
};
