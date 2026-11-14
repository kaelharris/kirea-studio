import React from "react";

interface BrandMarkProps {
  size?: number;
  showWordmark?: boolean;
}

// Line-art mark used as a mask so it takes the theme ink (off-white on dark, charcoal on light).
const MARK_URL = "url(./brand/kirea-mark.svg)";

export const BrandMark: React.FC<BrandMarkProps> = ({
  size = 32,
  showWordmark = false,
}) => {
  return (
    <div className="inline-flex items-center gap-2.5 select-none">
      <span
        aria-hidden="true"
        className="block shrink-0 bg-fg"
        style={{
          width: size,
          height: size,
          WebkitMaskImage: MARK_URL,
          maskImage: MARK_URL,
          WebkitMaskSize: "contain",
          maskSize: "contain",
          WebkitMaskRepeat: "no-repeat",
          maskRepeat: "no-repeat",
          WebkitMaskPosition: "center",
          maskPosition: "center",
        }}
      />
      {showWordmark && (
        <div className="hidden min-[1280px]:flex flex-col leading-none">
          <span className="text-h3 font-bold tracking-tight text-fg">
            Kirea Studio
          </span>
          <span className="mt-1 text-[11px] font-semibold tracking-[0.08em] uppercase text-fg-subtle">
            Local AI
          </span>
        </div>
      )}
    </div>
  );
};
