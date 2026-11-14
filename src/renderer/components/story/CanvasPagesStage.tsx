import React from "react";
import { ImageIcon } from "lucide-react";
import type { buildCanvasPages } from "../../../shared/canvas-layout";
import type { GeneratedImageRecord, StoryCanvasItem } from "../../../shared/types";
import { toMediaUrl } from "../../utils/format";
import { overlayClass } from "./canvas-workspace-types";

interface CanvasPagesStageProps {
  pages: ReturnType<typeof buildCanvasPages>;
  images: GeneratedImageRecord[];
  selectedItem: StoryCanvasItem | null;
  onSelectItem: (itemId: string) => void;
}

export const CanvasPagesStage: React.FC<CanvasPagesStageProps> = ({
  pages,
  images,
  selectedItem,
  onSelectItem,
}) => (
          <div className="space-y-4 min-w-0">
            {pages.map((page) => (
              <div key={page.index} className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px] text-fg-subtle">
                  <span>
                    Page {page.index + 1} of {pages.length}
                  </span>
                  <span className="tabular-nums">
                    {page.width} × {page.height} px
                  </span>
                </div>
                <div
                  className="relative w-full rounded-xl overflow-hidden border border-border bg-surface"
                  style={{ aspectRatio: `${page.width} / ${page.height}` }}
                >
                  {page.panels.map((panel) => {
                    const image = panel.item.imageId
                      ? images.find((candidate) => candidate.id === panel.item.imageId) ??
                        null
                      : null;
                    const isSelected = panel.item.id === selectedItem?.id;
                    return (
                      <button
                        key={panel.item.id}
                        type="button"
                        onClick={() => onSelectItem(panel.item.id)}
                        aria-label={`Select panel ${panel.pagePosition + 1}`}
                        className={`absolute overflow-hidden bg-[#111118] text-left cursor-pointer focus-visible:outline-none ${
                          isSelected
                            ? "ring-2 ring-accent z-10"
                            : "ring-1 ring-black/40 hover:ring-border-strong"
                        }`}
                        style={{
                          left: `${(panel.slot.x / page.width) * 100}%`,
                          top: `${(panel.slot.y / page.height) * 100}%`,
                          width: `${(panel.slot.width / page.width) * 100}%`,
                          height: `${(panel.slot.height / page.height) * 100}%`,
                        }}
                      >
                        {image ? (
                          <img
                            src={toMediaUrl(image.filePath)}
                            alt={panel.scene?.title ?? "Story panel"}
                            className={`w-full h-full ${
                              panel.item.fit === "contain"
                                ? "object-contain"
                                : "object-cover"
                            }`}
                          />
                        ) : (
                          <span className="flex flex-col items-center justify-center gap-1 w-full h-full text-fg-subtle text-[11px] uppercase tracking-wider">
                            <ImageIcon className="w-4 h-4" />
                            No image
                          </span>
                        )}
                        {panel.caption && (
                          <span className="absolute left-0 right-0 bottom-0 px-1.5 pb-1 pt-4 text-[9px] leading-tight text-white bg-gradient-to-t from-black/85 via-black/40 to-transparent line-clamp-2 text-left">
                            {panel.caption}
                          </span>
                        )}
                        {panel.item.overlays.map((overlay) => (
                          <span
                            key={overlay.id}
                            className={`absolute -translate-x-1/2 -translate-y-1/2 max-w-[78%] px-1.5 py-1 text-[8px] leading-tight overflow-hidden ${overlayClass(
                              overlay.kind
                            )}`}
                            style={{
                              left: `${overlay.x * 100}%`,
                              top: `${overlay.y * 100}%`,
                            }}
                          >
                            {overlay.speaker && (
                              <span className="block text-[6px] font-bold tracking-wide uppercase opacity-70">
                                {overlay.speaker}
                              </span>
                            )}
                            {overlay.text}
                          </span>
                        ))}
                        <span className="absolute top-1 left-1 w-4 h-4 rounded bg-black/60 text-white text-[8px] font-bold flex items-center justify-center">
                          {panel.pagePosition + 1}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
);
