export interface SplashRevealState {
  mainWindowReady: boolean;
  minimumVisibleElapsed: boolean;
  runtimeStartupFinished: boolean;
  runtimeStatus: string;
  openAnywayRequested: boolean;
}

export interface SplashPresentation {
  message: string;
  detail: string;
  progress: number;
  showOpenAnyway: boolean;
  tone: "normal" | "success" | "error";
}

export function shouldRevealMainWindow(state: SplashRevealState): boolean {
  if (!state.mainWindowReady) return false;
  if (state.openAnywayRequested) return true;
  return (
    state.minimumVisibleElapsed &&
    state.runtimeStartupFinished &&
    state.runtimeStatus === "connected"
  );
}

export function getSplashPresentation(
  runtimeStatus: string,
  lastError: string | null,
  configured: boolean
): SplashPresentation {
  if (runtimeStatus === "connected") {
    return {
      message: "ComfyUI connected. Opening studio...",
      detail: "Local inference is ready.",
      progress: 100,
      showOpenAnyway: false,
      tone: "success",
    };
  }

  if (!configured) {
    return {
      message: "ComfyUI is not configured.",
      detail: "Open Kirea Studio to choose a local ComfyUI installation.",
      progress: 100,
      showOpenAnyway: true,
      tone: "error",
    };
  }

  if (runtimeStatus === "error") {
    return {
      message: "ComfyUI could not start.",
      detail: lastError || "The local runtime did not become ready.",
      progress: 100,
      showOpenAnyway: true,
      tone: "error",
    };
  }

  if (runtimeStatus === "starting" || runtimeStatus === "installing") {
    return {
      message: "Starting ComfyUI runtime...",
      detail: "Loading the local inference engine.",
      progress: 38,
      showOpenAnyway: false,
      tone: "normal",
    };
  }

  return {
    message: "Checking ComfyUI runtime...",
    detail: "Looking for a local engine on loopback.",
    progress: 18,
    showOpenAnyway: false,
    tone: "normal",
  };
}
