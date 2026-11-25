import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(file, "utf8");

describe("Sonner toast migration", () => {
  it("declares Sonner as a runtime dependency", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.dependencies.sonner).toBeTruthy();
  });

  it("mounts one themed Toaster instead of the custom toast stack", () => {
    const app = read("src/renderer/App.tsx");
    expect(app).toContain('import { Toaster } from "sonner"');
    expect(app).toContain("<Toaster");
    expect(app).toContain('theme={resolvedTheme}');
    expect(app).toContain('position="bottom-right"');
    expect(app).toContain("duration={4500}");
    expect(app).toContain("duration: 4500");
    expect(app).toContain("closeButton");
    expect(app).not.toContain("ToastStack");
  });

  it("keeps pushToast as the app-wide API without local toast state", () => {
    const controller = read("src/renderer/app/useAppController.ts");
    expect(controller).toContain('import { toast } from "sonner"');
    expect(controller).toContain("toast.error(message)");
    expect(controller).toContain("toast.info(message)");
    expect(controller).not.toContain("setToasts");
    expect(controller).not.toContain("useState<ToastItem[]>");
  });
});

describe("duplicate control cleanup", () => {
  it("uses only the dedicated header toggle to close the Inspector", () => {
    const inspector = read("src/renderer/components/create/CreateRightInspector.tsx");
    expect(inspector).not.toContain('aria-label="Collapse inspector"');
    expect(inspector).not.toContain("PanelRightClose");
  });

  it("keeps Compare and Fullscreen only in the explicit action row", () => {
    const stage = read("src/renderer/components/create/CreateCenterStage.tsx");
    expect(stage).not.toContain('title="Toggle Interactive Comparison Slider"');
    expect(stage).not.toContain('aria-label="Open fullscreen lightbox"');
    expect(stage).toContain('title="Toggle Before / After Comparison Slider"');
    expect(stage).toContain("Fullscreen");
  });

  it("uses the Creative thumbnail as the single Inspect control", () => {
    const creative = read("src/renderer/pages/CreateCreativeMode.tsx");
    expect(creative.match(/onClick=\{\(\) => onInspectImage\(img\)\}/g)).toHaveLength(1);
  });
});
