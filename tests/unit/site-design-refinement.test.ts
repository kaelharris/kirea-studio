import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(file, "utf8");

describe("Kirea site design refinement", () => {
  it("centers the brand between left and right header controls without a Sections menu", () => {
    const html = read("site/index.html");
    const css = read("site/styles.css");
    expect(html).toContain("site-header__nav--left");
    expect(html).toContain("site-header__center");
    expect(html.indexOf("site-header__nav--left")).toBeLessThan(
      html.indexOf("site-header__center")
    );
    expect(html.indexOf("site-header__center")).toBeLessThan(
      html.indexOf("site-header__tools")
    );
    expect(html).not.toContain("site-header__where");
    expect(html).not.toContain("data-menu-toggle");
    expect(html).not.toContain('class="site-menu"');
    expect(css).not.toContain(".nav-toggle");
    expect(css).not.toContain(".site-menu");
    expect(html).toContain("brand__mark--asset");
    expect(html).toContain("./assets/brand/logoAsset-2.svg");
  });

  it("frames hero media full-width with a tight inset and overlaps a real Home screenshot", () => {
    const html = read("site/index.html");
    const css = read("site/styles.css");
    expect(html).toContain('class="hero__frame"');
    expect(html).toContain('class="hero__preview"');
    expect(html).toContain("./assets/shots/home-dark.webp");
    expect(css).toContain("max-width: none;");
    expect(css).toContain("padding-inline: 5px;");
    expect(css).toContain("border-radius: 14px;");
  });

  it("widens the studio orbit, enlarges the muse, and keeps text above cards", () => {
    const css = read("site/styles.css");
    const js = read("site/main.js");
    expect(css).toContain("width: 88%");
    expect(css).toContain("width: min(54vw, 820px");
    expect(css).toContain("z-index: 140");
    expect(js).toContain("radiusX = (path.offsetWidth / 2) * 1.08");
    expect(js).toContain("radiusY = path.offsetHeight / 2");
    expect(css).toContain("@keyframes showcase-shot-in");
  });

  it("restores the local 3D tilt and settles it at the final image position", () => {
    const css = read("site/styles.css");
    const js = read("site/main.js");
    expect(css).toContain("perspective(1100px) rotateX");
    expect(css).not.toContain("local-light-sweep");
    expect(css).not.toContain("local-art-drift");
    expect(js).toContain("initLocalTilt");
    expect(js).toContain("0.3");
  });

  it("uses interruptible interpolation and compositor-friendly motion", () => {
    const css = read("site/styles.css");
    const js = read("site/main.js");
    expect(js).toContain("easeOutCubic");
    expect(js).toContain("currentTilt");
    expect(js).toContain("targetTilt");
    expect(css).toContain("transform 520ms var(--ease)");
  });

  it("removes the GPU badge and compacts the download section", () => {
    const html = read("site/index.html");
    const css = read("site/styles.css");
    expect(html).not.toContain("spec__gpu-mark");
    expect(html).toMatch(/class="close"[\s\S]*?data-sc-act="flow"/);
    expect(css).toContain("height: min(720px, 82svh)");
  });

  it("renders a taller standalone footer with bottom copyright and floating back-to-top", () => {
    const html = read("site/index.html");
    const css = read("site/styles.css");
    expect(html).toMatch(/<\/section>\s*<footer class="site-footer">/);
    expect(html).toContain("site-footer__grid");
    expect(html).toContain("site-footer__column");
    expect(html).toContain("site-footer__bottom");
    expect(html).toContain("site-footer__copyright");
    expect(html).not.toContain("site-footer__legal");
    expect(html).toContain('class="back-to-top"');
    expect(html).not.toContain("ComfyUI is a separate GPL-3.0 project");
    expect(html).not.toContain("site-footer__hash");
    expect(css).toContain("min-height: 620px");
    expect(css).toContain(".site-footer__brand .brand__mark");
    expect(css).toContain(".site-footer__bottom");
    expect(css).not.toContain(".site-footer__legal");
    expect(css).toContain(".back-to-top");
  });
});
