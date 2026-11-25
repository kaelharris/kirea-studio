import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { GeneratedImageRecord, WorkflowTemplate } from "../../src/shared/types";
import {
  removeJobIfConfirmed,
  removeJobsIfConfirmed,
  resolveImageWorkflowHandoff,
  summarizeJobDeletion,
} from "../../src/renderer/app/useAppController";
import {
  resolveCreationWorkflowMode,
  type CreationDraft,
} from "../../src/renderer/components/create/useCreateController";
import {
  ConfirmDialog,
  isInteractiveKeyboardTarget,
} from "../../src/renderer/components/ui/Primitives";
import { shouldHandleGenerationDeleteKey } from "../../src/renderer/pages/CreateCreativeMode";
import {
  buildPromptCopyText,
  CopyPromptButton,
} from "../../src/renderer/components/CopyPromptButton";
import {
  ComfyUiBadge,
  KireaWingedMuse,
  PixelDivider,
  ReticleCornerBrackets,
} from "../../src/renderer/components/BrandIcons";

function workflow(
  id: string,
  supportedArchitectures: WorkflowTemplate["supportedArchitectures"],
  tags: string[] = []
): WorkflowTemplate {
  return {
    id,
    version: "1.0.0",
    name: id,
    description: "",
    mode: "img2img",
    supportedArchitectures,
    requiredNodes: [],
    outputNodeId: "9",
    supportsLora: true,
    maxLoras: 4,
    minDim: 512,
    maxDim: 1536,
    dimStep: 8,
    defaults: {
      steps: 24,
      cfg: 6.5,
      sampler: "euler",
      scheduler: "normal",
      denoise: 0.55,
      width: 1024,
      height: 1024,
    },
    tags,
  };
}

const REGISTERED_IMAGE_WORKFLOWS = [
  workflow("i2i_illustrious_base", ["illustrious"], ["Variation"]),
  workflow("i2i_sdxl_base", ["sdxl", "illustrious", "pony", "unknown"], ["Variation"]),
  workflow("i2i_sd15_base", ["sd15", "unknown"]),
  workflow("i2i_anima_base", ["anima"]),
  workflow("i2i_moss_image_edit", ["moss_image"], ["Edit"]),
  workflow("i2i_krea2_base", ["krea2"]),
];

function image(checkpoint: string): GeneratedImageRecord {
  return {
    id: "image-1",
    jobId: "job-1",
    filePath: "/media/source.png",
    fileName: "source.png",
    format: "png",
    width: 1024,
    height: 1024,
    sizeBytes: 1024,
    prompt: "source prompt",
    negativePrompt: "",
    seed: 42,
    steps: 24,
    cfg: 6.5,
    denoise: 1,
    loras: [],
    workflowId: "t2i_sdxl_base",
    sampler: "euler",
    scheduler: "normal",
    checkpoint,
    mode: "txt2img",
    favorite: false,
    tags: [],
    collectionId: null,
    characterId: null,
    sourceImagePath: null,
    createdAt: "2026-11-20T00:00:00.000Z",
  };
}

describe("image-to-workspace handoff", () => {
  it.each([
    ["sd15", "v1-5-pruned.safetensors", "i2i_sd15_base"],
    ["sdxl", "juggernautXL.safetensors", "i2i_sdxl_base"],
    ["illustrious", "illustrious_v1.safetensors", "i2i_illustrious_base"],
    ["anima", "anima_base.safetensors", "i2i_anima_base"],
    ["moss_image", "moss-image.safetensors", "i2i_moss_image_edit"],
    ["krea2", "krea2.safetensors", "i2i_krea2_base"],
  ])("uses a registered %s img2img template for inpaint and outpaint", (_, checkpoint, workflowId) => {
    for (const target of ["inpaint", "outpaint"] as const) {
      expect(
        resolveImageWorkflowHandoff(image(checkpoint), target, REGISTERED_IMAGE_WORKFLOWS)
      ).toEqual({ workflowId, workspaceMode: target });
    }
  });

  it("keeps variations on the registered variation template", () => {
    expect(
      resolveImageWorkflowHandoff(
        image("illustrious_v1.safetensors"),
        "variations",
        REGISTERED_IMAGE_WORKFLOWS
      )
    ).toEqual({ workflowId: "i2i_illustrious_base", workspaceMode: "variations" });
  });

  it("leaves upscale routing to the existing upscale handler", () => {
    expect(
      resolveImageWorkflowHandoff(image("sd15.safetensors"), "upscale", REGISTERED_IMAGE_WORKFLOWS)
    ).toBeNull();
  });

  it("prefers a registered task-specific template when one exists", () => {
    const nativeInpaint = workflow("custom_native_inpaint", ["sd15"], ["Inpaint"]);
    expect(
      resolveImageWorkflowHandoff(
        image("sd15.safetensors"),
        "inpaint",
        [...REGISTERED_IMAGE_WORKFLOWS, nativeInpaint]
      )
    ).toEqual({ workflowId: "custom_native_inpaint", workspaceMode: "inpaint" });
  });

  it("fails explicitly instead of selecting an incompatible workflow", () => {
    expect(() =>
      resolveImageWorkflowHandoff(image("sd15.safetensors"), "inpaint", [])
    ).toThrow(/No registered image-to-image workflow/);
  });
});

describe("creation workspace mode", () => {
  const draft = {
    mode: "img2img",
    workflowId: "i2i_sdxl_base",
  } as CreationDraft;

  it("preserves explicit inpaint and outpaint handoffs", () => {
    expect(resolveCreationWorkflowMode({ ...draft, workspaceWorkflow: "inpaint" })).toBe("inpaint");
    expect(resolveCreationWorkflowMode({ ...draft, workspaceWorkflow: "outpaint" })).toBe("outpaint");
  });

  it("only falls back to Edit for a generic img2img draft", () => {
    expect(resolveCreationWorkflowMode(draft)).toBe("edit");
    expect(
      resolveCreationWorkflowMode({ ...draft, workflowId: "custom_native_inpaint" }, [
        workflow("custom_native_inpaint", ["sd15"], ["Inpaint"]),
      ])
    ).toBe("inpaint");
  });
});

describe("interactive keyboard target guard", () => {
  it("ignores buttons, editable fields, and contenteditable descendants", () => {
    expect(
      isInteractiveKeyboardTarget({ closest: (selector: string) => selector.includes("button") ? {} : null })
    ).toBe(true);
    expect(
      isInteractiveKeyboardTarget({ closest: (selector: string) => selector.includes("input") ? {} : null })
    ).toBe(true);
    expect(isInteractiveKeyboardTarget({ isContentEditable: true })).toBe(true);
  });

  it("allows shortcuts from ordinary page content", () => {
    expect(isInteractiveKeyboardTarget({ closest: () => null })).toBe(false);
    expect(isInteractiveKeyboardTarget(null)).toBe(false);
  });
});

describe("theme-aware brand artwork", () => {
  it("renders the emblem with inherited ink and theme tokens", () => {
    const html = renderToStaticMarkup(createElement(KireaWingedMuse));
    expect(html).toContain('fill="currentColor"');
    expect(html).toContain("var(--accent-solid)");
    expect(html).not.toContain("#F2F2EE");
    expect(html).not.toContain("#1E3BFF");
    expect(html).not.toContain("#0B0C10");
  });

  it("uses currentColor for decorative defaults and badge ink", () => {
    expect(renderToStaticMarkup(createElement(ReticleCornerBrackets))).toContain('stroke="currentColor"');
    expect(renderToStaticMarkup(createElement(PixelDivider))).toContain('fill="currentColor"');
    const badge = renderToStaticMarkup(createElement(ComfyUiBadge));
    expect(badge).toContain("text-fg");
    expect(badge).toContain("currentColor");
    expect(badge).not.toContain("#F2F2EE");
    expect(badge).not.toContain("#0B0C10");
  });
});

describe("prompt copy keyboard and feedback contract", () => {
  it("builds prompt-only and full-parameter clipboard text", () => {
    const props = {
      prompt: "a red kite",
      negativePrompt: "blurry",
      seed: 0,
      steps: 20,
      cfg: 7,
      sampler: "euler",
      scheduler: "karras",
      checkpoint: "sd15.safetensors",
      loras: [{ name: "style", strengthModel: 0.8 }],
      width: 512,
      height: 768,
    };
    expect(buildPromptCopyText(props, false)).toBe("a red kite");
    expect(buildPromptCopyText(props, true)).toBe(
      [
        "Positive Prompt: a red kite",
        "Negative Prompt: blurry",
        "Seed: 0",
        "Steps: 20 | CFG: 7 | Sampler: euler (karras)",
        "Checkpoint: sd15.safetensors",
        "LoRAs: style (0.8)",
        "Dimensions: 512×768",
      ].join("\n")
    );
  });

  it("provides a live status region for clipboard failures", () => {
    const html = renderToStaticMarkup(createElement(CopyPromptButton, { prompt: "a red kite" }));
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
  });

  it("maps Shift+Enter to the same full-parameter copy as Shift-click", () => {
    const source = readFileSync("src/renderer/components/CopyPromptButton.tsx", "utf8");
    expect(source).toContain("onKeyDown={handleKeyDown}");
    expect(source).toMatch(/e\.key === "Enter" && e\.shiftKey/);
    expect(source).toContain("copyText(true)");
    expect(source).toContain('onToast?.(message, "error")');
  });
});

describe("creative mode deletion shortcut", () => {
  const keyEvent = {
    key: "Delete",
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    repeat: false,
    defaultPrevented: false,
  };

  it("handles Delete and Backspace only from non-interactive page content", () => {
    expect(shouldHandleGenerationDeleteKey(keyEvent, { closest: () => null }, false)).toBe(true);
    expect(
      shouldHandleGenerationDeleteKey({ ...keyEvent, key: "Backspace" }, { closest: () => null }, false)
    ).toBe(true);
    expect(
      shouldHandleGenerationDeleteKey(
        keyEvent,
        { closest: (selector: string) => selector.includes("button") ? {} : null },
        false
      )
    ).toBe(false);
    expect(shouldHandleGenerationDeleteKey(keyEvent, { isContentEditable: true }, false)).toBe(false);
  });

  it("ignores open confirmations, repeated keys, modifiers, and unrelated keys", () => {
    expect(shouldHandleGenerationDeleteKey(keyEvent, null, true)).toBe(false);
    expect(shouldHandleGenerationDeleteKey({ ...keyEvent, repeat: true }, null, false)).toBe(false);
    expect(shouldHandleGenerationDeleteKey({ ...keyEvent, ctrlKey: true }, null, false)).toBe(false);
    expect(shouldHandleGenerationDeleteKey({ ...keyEvent, key: "a" }, null, false)).toBe(false);
  });
});

describe("creative mode deletion await contract", () => {
  const source = readFileSync("src/renderer/pages/CreateCreativeMode.tsx", "utf8");

  it("awaits callback and fallback deletions instead of reporting immediate success", () => {
    expect(source).toContain("await onDeleteJob(deleteConfirmTarget.id)");
    expect(source).toContain("await window.kirea.deleteJob(deleteConfirmTarget.id)");
    expect(source).toContain("await onDeleteImage(deleteConfirmTarget.id)");
    expect(source).toContain("await window.kirea.deleteImage(deleteConfirmTarget.id)");
    expect(source).not.toContain("void onDeleteJob");
    expect(source).not.toContain("void onDeleteImage");
  });

  it("checks the fallback job deletion result before showing success", () => {
    expect(source).toMatch(/const removed = await window\.kirea\.deleteJob[\s\S]*?if \(!removed\)/);
  });
});

describe("image viewer lifecycle and accessibility contract", () => {
  const source = readFileSync("src/renderer/components/ImagePreviewModal.tsx", "utf8");

  it("uses the shared focus trap only while the viewer is active", () => {
    expect(source).toContain("useDialogFocus(Boolean(image) && !confirmDeleteOpen, onClose, panelRef)");
  });

  it("guards global listeners and inactivity timers while no image is open", () => {
    const timerEffect = source.slice(
      source.indexOf("// 3-second auto-hiding"),
      source.indexOf("// Activity listeners")
    );
    const pointerEffect = source.slice(
      source.indexOf("// Activity listeners"),
      source.indexOf("const areControlsVisible")
    );
    const fullscreenEffect = source.slice(
      source.indexOf("// Fullscreen event listener"),
      source.indexOf("const toggleFullscreen")
    );
    expect(timerEffect).toContain("if (!image) return");
    expect(pointerEffect).toContain("if (!image) return");
    expect(fullscreenEffect).toContain("if (!image) return");
  });

  it("raises deletion confirmation above the viewer and hides controls from focus", () => {
    expect(source).toContain('zIndexClass="z-[60]"');
    expect(source).toContain("inert={!areControlsVisible}");
    expect(source).toContain("inert={!showDetails}");
  });
});

describe("confirmation dialog keyboard and layering contract", () => {
  const props = {
    open: true,
    onClose: () => undefined,
    onConfirm: () => undefined,
    title: "Delete item?",
    description: "This cannot be undone.",
  };

  it("passes an explicit stacking class through to Modal", () => {
    const html = renderToStaticMarkup(
      createElement(ConfirmDialog, { ...props, zIndexClass: "z-[60]" })
    );
    expect(html).toContain("z-[60]");
  });

  it("places safe initial focus on Cancel when confirm autofocus is disabled", () => {
    const html = renderToStaticMarkup(
      createElement(ConfirmDialog, { ...props, defaultFocusConfirm: false })
    );
    expect(html).toMatch(/data-autofocus="true"[^>]*>Cancel/);
  });

  it("does not translate wrapper Enter events into confirmation", () => {
    const source = readFileSync("src/renderer/components/ui/Primitives.tsx", "utf8");
    const confirmSource = source.slice(
      source.indexOf("export const ConfirmDialog"),
      source.indexOf("export {", source.indexOf("export const ConfirmDialog"))
    );
    expect(confirmSource).not.toContain("onKeyDown");
    expect(confirmSource).not.toContain('e.key === "Enter"');
  });
});

describe("confirmed job deletion", () => {
  const jobs = [{ id: "job-1" }, { id: "job-2" }, { id: "job-3" }];

  it("does not remove state when single deletion is not confirmed", () => {
    expect(removeJobIfConfirmed(jobs, "job-1", false)).toBe(jobs);
    expect(removeJobIfConfirmed(jobs, "job-1", true)).toEqual([{ id: "job-2" }, { id: "job-3" }]);
  });

  it("does not guess which jobs were removed during a partial batch", () => {
    expect(removeJobsIfConfirmed(jobs, ["job-1", "job-2"], 1)).toBe(jobs);
    expect(removeJobsIfConfirmed(jobs, ["job-1", "job-1", "job-2"], 2)).toEqual([
      { id: "job-3" },
    ]);
  });

  it("reports zero, partial, and complete batch results accurately", () => {
    expect(summarizeJobDeletion(["job-1", "job-2"], 0)).toEqual({
      requestedCount: 2,
      removedCount: 0,
      complete: false,
      tone: "error",
      message: "No generation jobs were removed.",
    });
    expect(summarizeJobDeletion(["job-1", "job-2"], 1)).toEqual({
      requestedCount: 2,
      removedCount: 1,
      complete: false,
      tone: "error",
      message: "Removed 1 of 2 generation jobs.",
    });
    expect(summarizeJobDeletion(["job-1", "job-1", "job-2"], 2)).toEqual({
      requestedCount: 2,
      removedCount: 2,
      complete: true,
      tone: "info",
      message: "Removed 2 generation jobs.",
    });
  });
});
