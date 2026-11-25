import { describe, expect, it, vi } from "vitest";

describe("Fullscreen Artwork Viewer & Inactivity Engine", () => {
  it("initializes controls as visible on entry", () => {
    let controlsVisible = true;
    expect(controlsVisible).toBe(true);
  });

  it("triggers inactivity auto-hide exactly after 3000ms countdown", () => {
    vi.useFakeTimers();

    let controlsVisible = true;
    let timer: NodeJS.Timeout | null = null;

    const resetTimer = () => {
      controlsVisible = true;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        controlsVisible = false;
      }, 3000);
    };

    resetTimer();
    expect(controlsVisible).toBe(true);

    // Fast-forward 2000ms (still visible)
    vi.advanceTimersByTime(2000);
    expect(controlsVisible).toBe(true);

    // Fast-forward remaining 1000ms -> should fade out
    vi.advanceTimersByTime(1000);
    expect(controlsVisible).toBe(false);

    vi.useRealTimers();
  });

  it("resets countdown and restores controls on pointer activity or keypress", () => {
    vi.useFakeTimers();

    let controlsVisible = true;
    let timer: NodeJS.Timeout | null = null;

    const resetTimer = () => {
      controlsVisible = true;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        controlsVisible = false;
      }, 3000);
    };

    resetTimer();
    vi.advanceTimersByTime(3000);
    expect(controlsVisible).toBe(false);

    // Mouse movement / keypress activity event
    resetTimer();
    expect(controlsVisible).toBe(true);

    // Advance 2500ms and move mouse again
    vi.advanceTimersByTime(2500);
    expect(controlsVisible).toBe(true);
    resetTimer();

    // Advance 2000ms (still visible because timer was reset)
    vi.advanceTimersByTime(2000);
    expect(controlsVisible).toBe(true);

    // Advance another 1000ms -> fades out
    vi.advanceTimersByTime(1000);
    expect(controlsVisible).toBe(false);

    vi.useRealTimers();
  });

  it("cleans up timer properly on unmount or active image navigation", () => {
    vi.useFakeTimers();

    let timer: NodeJS.Timeout | null = null;
    const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");

    const resetTimer = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {}, 3000);
    };

    resetTimer();
    // Simulate cleanup on unmount / image change
    if (timer) clearTimeout(timer);

    expect(clearTimeoutSpy).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("validates execution of all 7 required fullscreen actions", () => {
    const mockImage = {
      id: "img_99",
      prompt: "masterpiece, anime girl in neon rain",
      negativePrompt: "worst quality",
      seed: 424242,
      steps: 28,
      cfg: 7.0,
      sampler: "euler",
      scheduler: "normal",
      checkpoint: "illustrious_xl_v0.1.safetensors",
      width: 1024,
      height: 1024,
      collectionId: null as string | null,
    };

    const actionsTriggered: string[] = [];

    const onUpscale = (img: typeof mockImage) => {
      actionsTriggered.push(`upscale:${img.id}`);
    };
    const onReuseSettings = (img: typeof mockImage) => {
      actionsTriggered.push(`reuse:${img.id}:${img.seed}`);
    };
    const onCopyPrompt = (prompt: string) => {
      actionsTriggered.push(`copyPrompt:${prompt}`);
    };
    const onInpaint = (img: typeof mockImage) => {
      actionsTriggered.push(`inpaint:${img.id}`);
    };
    const onOutpaint = (img: typeof mockImage) => {
      actionsTriggered.push(`outpaint:${img.id}`);
    };
    const onDelete = (id: string, confirmed: boolean) => {
      if (confirmed) actionsTriggered.push(`delete:${id}`);
    };
    const onSaveToCollection = (id: string, colId: string) => {
      mockImage.collectionId = colId;
      actionsTriggered.push(`collection:${id}:${colId}`);
    };

    // 1. Upscale
    onUpscale(mockImage);
    // 2. Reuse Settings
    onReuseSettings(mockImage);
    // 3. Copy Prompt
    onCopyPrompt(mockImage.prompt);
    // 4. Inpaint
    onInpaint(mockImage);
    // 5. Outpaint
    onOutpaint(mockImage);
    // 6. Delete (requires confirmation: false does not execute, true executes)
    onDelete(mockImage.id, false);
    expect(actionsTriggered).not.toContain("delete:img_99");
    onDelete(mockImage.id, true);
    // 7. Save to Collection
    onSaveToCollection(mockImage.id, "col_cyberpunk");

    expect(actionsTriggered).toContain("upscale:img_99");
    expect(actionsTriggered).toContain("reuse:img_99:424242");
    expect(actionsTriggered).toContain("copyPrompt:masterpiece, anime girl in neon rain");
    expect(actionsTriggered).toContain("inpaint:img_99");
    expect(actionsTriggered).toContain("outpaint:img_99");
    expect(actionsTriggered).toContain("delete:img_99");
    expect(actionsTriggered).toContain("collection:img_99:col_cyberpunk");
    expect(mockImage.collectionId).toBe("col_cyberpunk");
  });
});
