import React from "react";
import { KireaWingedMuse } from "./BrandIcons";

interface BrandMarkProps {
  size?: number;
  showWordmark?: boolean;
}

export const BrandMark: React.FC<BrandMarkProps> = ({
  size = 32,
  showWordmark = false,
}) => {
  return (
    <div className="inline-flex items-center gap-2.5 select-none">
      <KireaWingedMuse size={size} />
      {showWordmark && (
        <div className="hidden min-[1280px]:flex flex-col leading-none">
          <span className="font-mono text-sm font-bold tracking-tight text-fg uppercase">
            Kirea Studio
          </span>
          <span className="mt-1 font-mono text-[10px] font-semibold tracking-[0.12em] uppercase text-accent">
            Local AI
          </span>
        </div>
      )}
    </div>
  );
};
