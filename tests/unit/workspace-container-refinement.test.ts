import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  Card,
  ContextMenuProvider,
} from "../../src/renderer/components/ui/Primitives";
import { CompactPromptComposer } from "../../src/renderer/components/create/CompactPromptComposer";

const read = (file: string) => readFileSync(file, "utf8");

describe("flatter card system", () => {
  it("renders flat sections without a box surface", () => {
    const html = renderToStaticMarkup(createElement(Card, null, "Content"));
    expect(html).toContain("bg-transparent");
    expect(html).toContain('data-card-variant="flat"');
    expect(html).not.toContain("bg-surface");
    expect(html).not.toContain("rounded-xl");
    expect(html).not.toContain("border-border");
  });

  it("keeps an explicit raised card variant for surfaces that need a boundary", () => {
    const html = renderToStaticMarkup(createElement(Card, { variant: "raised" }, "Content"));
    expect(html).toContain("bg-surface");
    expect(html).toContain("rounded-xl");
    expect(html).toContain("border-border");
    expect(html).toContain('data-card-variant="raised"');
  });
});

describe("Advanced Create workspace layout", () => {
  it("renders the prompt composer in the center creation flow", () => {
    const page = read("src/renderer/pages/CreatePage.tsx");
    const stage = read("src/renderer/components/create/CreateCenterStage.tsx");
    expect(page).not.toContain("CompactPromptComposer");
    expect(stage).toContain("<CompactPromptComposer");
    expect(stage.indexOf("<CompactPromptComposer")).toBeLessThan(
      stage.indexOf("Results Workspace Toolbar")
    );
  });

  it("embeds Generate inside the prompt input on the right", () => {
    const html = renderToStaticMarkup(
      createElement(
        ContextMenuProvider,
        null,
        createElement(CompactPromptComposer, {
          prompt: "",
          negativePrompt: "",
          onPromptChange: () => {},
          onNegativePromptChange: () => {},
          onGenerate: () => {},
          submitting: false,
          blockingErrors: [],
          warnings: [],
          onToast: () => {},
        })
      )
    );
    const textareaStart = html.indexOf("<textarea");
    const textareaEnd = html.indexOf("</textarea>", textareaStart);
    const generateIndex = html.indexOf("Generate Image");
    const textarea = html.slice(textareaStart, textareaEnd);
    const between = html.slice(textareaEnd, generateIndex);

    expect(textareaStart).toBeGreaterThan(-1);
    expect(generateIndex).toBeGreaterThan(textareaEnd);
    expect(textarea).toContain("pr-36");
    expect(textarea).toContain("pb-12");
    expect(between).not.toContain("</div>");
    const buttonStart = html.lastIndexOf("<button", generateIndex);
    const buttonOpenEnd = html.indexOf(">", buttonStart);
    expect(html.slice(buttonStart, buttonOpenEnd)).toContain(
      "absolute bottom-2 right-2"
    );
  });

  it("flattens the settings and results toolbar containers", () => {
    const sidebar = read("src/renderer/components/create/CreateGenerationSidebar.tsx");
    const stage = read("src/renderer/components/create/CreateCenterStage.tsx");
    expect(sidebar).not.toContain('className="rounded-xl border border-border bg-surface p-3 space-y-2.5"');
    expect(sidebar).not.toContain('className="p-2.5 rounded-xl bg-bg border border-border space-y-2"');
    expect(stage).not.toContain('className="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface px-2.5 py-2"');
  });

  it("uses dividers instead of nested inspector cards", () => {
    const inspector = read("src/renderer/components/create/CreateRightInspector.tsx");
    expect(inspector).not.toContain('className="rounded-lg border border-border bg-bg/60 p-2.5"');
    expect(inspector).not.toContain('className="flex items-baseline justify-between gap-2 rounded-md border border-border bg-bg/60 px-2 py-1"');
  });

  it("fills the remaining shell height instead of reserving a bottom gap", () => {
    const app = read("src/renderer/App.tsx");
    const page = read("src/renderer/pages/CreatePage.tsx");
    expect(page).not.toContain("h-[calc(100vh-7.5rem)]");
    expect(page).not.toContain("min-h-[580px]");
    expect(page).toContain("min-h-0 flex-1");
    expect(app).toContain('activePage === "create"');
    expect(app).toContain("flex-1 min-h-0 overflow-hidden");
    expect(app).toContain("flex h-full min-h-0 flex-col");
  });

  it("uses open workbench zones instead of bordered outer panels", () => {
    const page = read("src/renderer/pages/CreatePage.tsx");
    const stage = read("src/renderer/components/create/CreateCenterStage.tsx");
    const inspector = read("src/renderer/components/create/CreateRightInspector.tsx");
    const creative = read("src/renderer/pages/CreateCreativeMode.tsx");
    expect(page).not.toContain("overflow-hidden rounded-xl border bg-surface");
    expect(stage).not.toContain("overflow-hidden rounded-xl border border-border bg-surface");
    expect(inspector).not.toContain("overflow-hidden rounded-xl border border-border bg-surface");
    expect(creative).not.toContain("overflow-hidden rounded-xl border border-border bg-surface");
  });

  it("removes bordered nested settings groups from Advanced Create", () => {
    const sidebar = read("src/renderer/components/create/CreateGenerationSidebar.tsx");
    const upscale = read("src/renderer/components/create/CreateUpscaleSidebar.tsx");
    const workflow = read("src/renderer/components/create/WorkflowSelector.tsx");
    expect(sidebar).not.toContain('className="p-3 rounded-xl bg-bg border border-border space-y-3"');
    expect(upscale).not.toContain('className="p-3 rounded-xl bg-bg border border-border space-y-3"');
    expect(workflow).not.toContain("rounded-xl border border-border bg-bg/80");
  });
});
