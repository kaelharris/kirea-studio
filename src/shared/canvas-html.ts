import type { CanvasFit, CanvasOverlay, StoryCanvas } from "./types";
import type { CanvasSlot } from "./canvas-layout";

export interface StoryboardHtmlPanel {
  slot: CanvasSlot;
  imageSrc: string | null;
  fit: CanvasFit;
  caption: string;
  overlays: CanvasOverlay[];
  alt: string;
}

export interface StoryboardHtmlPage {
  width: number;
  height: number;
  panels: StoryboardHtmlPanel[];
}

export interface StoryboardHtmlOptions {
  canvas: Pick<StoryCanvas, "background" | "pageWidth" | "pageHeight">;
  pages: StoryboardHtmlPage[];
  title: string;
}

const SAFE_KINDS = new Set(["speech", "thought", "narration", "text"]);

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizeColor(value: string): string {
  const trimmed = value.trim();
  if (/^#[0-9a-f]{3}$/i.test(trimmed) || /^#[0-9a-f]{6}$/i.test(trimmed)) {
    return trimmed;
  }
  return "#0B0B0F";
}

function px(value: number): string {
  return `${Math.max(0, Math.round(value * 100) / 100)}px`;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

export function storySlug(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "story";
}

export function buildStoryboardHtml(options: StoryboardHtmlOptions): string {
  const { canvas, pages, title } = options;
  const firstPage = pages[0];
  const pageWidth = firstPage?.width ?? canvas.pageWidth;
  const pageHeight = firstPage?.height ?? canvas.pageHeight;
  const background = sanitizeColor(canvas.background);
  const multiPage = pages.length > 1;

  const pageMarkup = pages
    .map((page, pageIndex) => {
      const panels = page.panels
        .map((panel) => {
          const slot = panel.slot;
          const panelStyle = [
            `left:${px(slot.x)}`,
            `top:${px(slot.y)}`,
            `width:${px(slot.width)}`,
            `height:${px(slot.height)}`,
          ].join(";");

          const media = panel.imageSrc
            ? `<img src="${escapeHtml(panel.imageSrc)}" alt="${escapeHtml(
                panel.alt
              )}" style="object-fit:${panel.fit === "contain" ? "contain" : "cover"}" />`
            : `<div class="placeholder">No image</div>`;

          const caption = panel.caption.trim()
            ? `<div class="caption">${escapeHtml(panel.caption.trim())}</div>`
            : "";

          const overlays = panel.overlays
            .map((overlay) => {
              const kind = SAFE_KINDS.has(overlay.kind) ? overlay.kind : "text";
              const x = clamp01(overlay.x) * 100;
              const y = clamp01(overlay.y) * 100;
              const speaker = overlay.speaker?.trim()
                ? `<span class="speaker">${escapeHtml(
                    overlay.speaker.trim()
                  )}</span>`
                : "";
              return `<div class="overlay ${kind}" style="left:${x.toFixed(
                2
              )}%;top:${y.toFixed(2)}%">${speaker}<span class="overlay-text">${escapeHtml(
                overlay.text
              )}</span></div>`;
            })
            .join("");

          return `<div class="panel" style="${panelStyle}">${media}${caption}${overlays}</div>`;
        })
        .join("");

      const pageNumber = multiPage
        ? `<div class="page-number">${pageIndex + 1} / ${pages.length}</div>`
        : "";

      return `<section class="page" style="width:${px(
        page.width
      )};height:${px(page.height)};background:${background}">${panels}${pageNumber}</section>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  @page { size: ${px(pageWidth)} ${px(pageHeight)}; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: transparent; }
  body {
    font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .page {
    position: relative;
    overflow: hidden;
    break-after: page;
    page-break-after: always;
  }
  .page:last-child {
    break-after: auto;
    page-break-after: auto;
  }
  .panel {
    position: absolute;
    overflow: hidden;
    background: #111118;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 6px;
  }
  .panel img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    color: rgba(255, 255, 255, 0.32);
    font-size: 13px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    background: repeating-linear-gradient(
      45deg,
      rgba(255, 255, 255, 0.03),
      rgba(255, 255, 255, 0.03) 10px,
      transparent 10px,
      transparent 20px
    );
  }
  .caption {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    padding: 28px 12px 10px;
    color: #f7f7fb;
    font-size: 13px;
    line-height: 1.35;
    font-weight: 500;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.65);
    background: linear-gradient(
      to top,
      rgba(5, 5, 10, 0.88),
      rgba(5, 5, 10, 0.45) 45%,
      transparent
    );
  }
  .overlay {
    position: absolute;
    transform: translate(-50%, -50%);
    max-width: 78%;
    padding: 7px 10px;
    font-size: 12px;
    line-height: 1.3;
    color: #101014;
    background: rgba(255, 255, 255, 0.94);
    border-radius: 10px;
    border: 1px solid rgba(0, 0, 0, 0.14);
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.28);
    overflow-wrap: anywhere;
  }
  .overlay .speaker {
    display: block;
    margin-bottom: 2px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    opacity: 0.68;
  }
  .overlay.thought {
    font-style: italic;
    background: rgba(240, 244, 255, 0.9);
    border-style: dashed;
    border-radius: 16px;
  }
  .overlay.narration {
    color: #f4f1e6;
    background: rgba(12, 12, 16, 0.82);
    border-left: 3px solid rgba(230, 196, 122, 0.85);
    border-radius: 4px;
  }
  .overlay.text {
    color: #ffffff;
    background: transparent;
    border: none;
    box-shadow: none;
    font-size: 15px;
    font-weight: 700;
    text-shadow: 0 2px 8px rgba(0, 0, 0, 0.75);
    text-align: center;
  }
  .page-number {
    position: absolute;
    right: 12px;
    bottom: 6px;
    color: rgba(255, 255, 255, 0.38);
    font-size: 10px;
    letter-spacing: 0.12em;
  }
</style>
</head>
<body>
<div class="storyboard">
${pageMarkup}
</div>
</body>
</html>`;
}
