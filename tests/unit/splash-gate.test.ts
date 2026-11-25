import { describe, expect, it } from "vitest";
import {
  getSplashPresentation,
  shouldRevealMainWindow,
} from "../../src/main/startup/splash-gate";

const readyGate = {
  mainWindowReady: true,
  minimumVisibleElapsed: true,
  runtimeStartupFinished: true,
  runtimeStatus: "connected",
  openAnywayRequested: false,
};

describe("splash reveal gate", () => {
  it("stays on the splash while the main window is still rendering", () => {
    expect(
      shouldRevealMainWindow({ ...readyGate, mainWindowReady: false })
    ).toBe(false);
  });

  it("stays on the splash until the minimum visible time elapses", () => {
    expect(
      shouldRevealMainWindow({ ...readyGate, minimumVisibleElapsed: false })
    ).toBe(false);
  });

  it("stays on the splash until runtime startup finishes", () => {
    expect(
      shouldRevealMainWindow({ ...readyGate, runtimeStartupFinished: false })
    ).toBe(false);
  });

  it("stays on the splash until ComfyUI is connected", () => {
    expect(
      shouldRevealMainWindow({ ...readyGate, runtimeStatus: "starting" })
    ).toBe(false);
    expect(
      shouldRevealMainWindow({ ...readyGate, runtimeStatus: "error" })
    ).toBe(false);
  });

  it("reveals the app when every startup condition is satisfied", () => {
    expect(shouldRevealMainWindow(readyGate)).toBe(true);
  });

  it("allows Open anyway to bypass a failed runtime startup", () => {
    expect(
      shouldRevealMainWindow({
        ...readyGate,
        runtimeStartupFinished: true,
        runtimeStatus: "error",
        openAnywayRequested: true,
      })
    ).toBe(true);
  });
});

describe("splash runtime presentation", () => {
  it("shows real probing and starting states", () => {
    expect(getSplashPresentation("disconnected", null, true)).toMatchObject({
      message: "Checking ComfyUI runtime...",
      progress: 18,
      showOpenAnyway: false,
    });
    expect(getSplashPresentation("starting", null, true)).toMatchObject({
      message: "Starting ComfyUI runtime...",
      progress: 38,
      showOpenAnyway: false,
    });
  });

  it("shows a connected state without an escape hatch", () => {
    expect(getSplashPresentation("connected", null, true)).toMatchObject({
      message: "ComfyUI connected. Opening studio...",
      progress: 100,
      showOpenAnyway: false,
      tone: "success",
    });
  });

  it("offers Open anyway when no runtime is configured", () => {
    expect(getSplashPresentation("disconnected", null, false)).toMatchObject({
      message: "ComfyUI is not configured.",
      showOpenAnyway: true,
      tone: "error",
    });
  });

  it("offers Open anyway and preserves the runtime error after a failed start", () => {
    expect(getSplashPresentation("error", "ComfyUI exited early", true)).toMatchObject({
      message: "ComfyUI could not start.",
      detail: "ComfyUI exited early",
      showOpenAnyway: true,
      tone: "error",
    });
  });
});
