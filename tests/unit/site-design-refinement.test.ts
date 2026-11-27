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

  it("delays a subtle header compact and mark-only logo transition after slight scrolling", () => {
    const css = read("site/styles.css");
    const js = read("site/main.js");
    expect(js).toContain("is-compact");
    expect(js).toContain("window.scrollY > 32");
    expect(js).toContain("window.setTimeout");
    expect(js).toContain("140");
    const compactHeader = css.match(/\.site-header\.is-compact\s*\{([^}]*)\}/)?.[1] || "";
    const headerWord = css.match(/\.site-header \.brand__word\s*\{([^}]*)\}/)?.[1] || "";
    const compactWord = css.match(/\.site-header\.is-compact \.brand__word\s*\{([^}]*)\}/)?.[1] || "";
    expect(compactHeader).toContain("height: calc(var(--header-height) - 8px);");
    expect(headerWord).toContain("transition:");
    expect(compactWord).toContain("max-width: 0;");
    expect(compactWord).toContain("opacity: 0;");
  });

  it("frames hero media below a dedicated header band with wider gutters and smaller copy", () => {
    const html = read("site/index.html");
    const css = read("site/styles.css");
    expect(html).toContain('class="hero__frame"');
    expect(html).toContain('class="hero__preview"');
    expect(html).toContain("./assets/shots/home-dark.webp");
    expect(css).toContain("--header-height: 72px;");
    const header = css.match(/\.site-header\s*\{([^}]*)\}/)?.[1] || "";
    const heroStage = css.match(/\.hero__stage\s*\{([^}]*)\}/)?.[1] || "";
    expect(header).toContain("height: var(--header-height);");
    expect(header).toContain("background: rgba(15, 16, 21, 0.96);");
    expect(heroStage).toContain("padding-block: var(--header-height) 0;");
    expect(css).toContain("padding-inline: clamp(16px, 3vw, 40px);");
    expect(css).toContain("height: calc(100svh - var(--header-height));");
    expect(css).toContain("width: min(100%, 620px);");
    expect(css).toContain("font-size: clamp(34px, 3.8vw, 54px);");
  });

  it("shows official engine marks for Pixel Studio exports", () => {
    const html = read("site/index.html");
    const css = read("site/styles.css");
    const js = read("site/main.js");
    expect(html).toContain("data-engine-logos");
    expect(html).toContain("./assets/brand/godot.svg");
    expect(html).toContain("./assets/brand/unity.svg");
    expect(html).toContain("./assets/brand/phaser.svg");
    expect(js).toContain("data-engine-logos");
    expect(js).toContain('orbitSection.querySelector(".engine-logos")');
    expect(js).not.toContain('orbitSection.querySelector("[data-engine-logos]")');
    expect(css).toContain(".engine-logos[hidden]");
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

  it("splits the product tour into 30% copy and 70% rounded screenshot space", () => {
    const html = read("site/index.html");
    const css = read("site/styles.css");
    expect(html).toContain("showcase__description");
    expect(html.indexOf("showcase__description")).toBeLessThan(html.indexOf("showcase__panel"));
    expect(css).toContain("grid-template-columns: minmax(0, 0.3fr) minmax(0, 0.7fr)");
    expect(css).toContain("border-radius: 20px;");
    expect(css).toContain("animation: showcase-shot-in 900ms var(--ease) both");
    const showcasePanel = css.match(/\.showcase__panel\s*\{([^}]*)\}/)?.[1] || "";
    expect(showcasePanel).toContain("align-self: stretch;");
    const pinnedShowcase = css.match(/\.sc-act--pinned \.app-window--showcase\s*\{([^}]*)\}/)?.[1] || "";
    const pinnedStack = css.match(/\.sc-act--pinned \.showcase__stack\s*\{([^}]*)\}/)?.[1] || "";
    expect(pinnedShowcase).toContain("align-self: center;");
    expect(pinnedStack).toContain("aspect-ratio: 1600 / 940;");
  });

  it("restores the local 3D tilt and settles it at the final image position", () => {
    const css = read("site/styles.css");
    const js = read("site/main.js");
    expect(css).toContain("perspective(1100px) rotateX");
    expect(css).not.toContain("local-light-sweep");
    expect(css).not.toContain("local-art-drift");
    expect(js).toContain("initLocalTilt");
    expect(js).toContain("0.3");
    expect(css).toContain("aspect-ratio: 1254 / 1176;");
    const localImage = css.match(/\.local__frame img\s*\{([^}]*)\}/)?.[1] || "";
    expect(localImage).toContain("height: 100%;");
    expect(localImage).not.toContain("height: calc(100% + 32px)");
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

  it("tightens requirements spacing without collapsing the content", () => {
    const css = read("site/styles.css");
    expect(css).toContain("padding-block: clamp(48px, 6vw, 80px);");
    expect(css).toContain("margin-bottom: 28px;");
    expect(css).toContain("gap: 32px;");
    expect(css).toContain("padding: 10px 0 12px;");
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
    expect(css).toContain("width: 44px;");
    expect(css).toContain(".site-footer__brand .brand__word");
    expect(css).toContain("font-size: 20px;");
    expect(css).toContain(".site-footer__bottom");
    expect(css).not.toContain(".site-footer__legal");
    expect(css).toContain(".back-to-top");
  });
});
