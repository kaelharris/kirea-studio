export type UpdateChannel = "stable" | "prerelease";

export type UpdatePhase =
  /** Unpackaged/dev builds or updates explicitly disabled. */
  | "disabled"
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "downloaded"
  | "installing"
  | "error";

export interface UpdateProgress {
  percent: number;
  transferredBytes: number;
  totalBytes: number;
  bytesPerSecond: number;
}

export interface UpdateState {
  phase: UpdatePhase;
  currentVersion: string;
  availableVersion: string | null;
  releaseNotes: string | null;
  releaseDate: string | null;
  progress: UpdateProgress | null;
  error: string | null;
  lastCheckedAt: string | null;
  channel: UpdateChannel;
  /** False in unpackaged/dev builds where no update feed exists. */
  canCheck: boolean;
  /** True when the user pressed "Later" for this exact version. */
  dismissed: boolean;
}

export type UpdateInstallBlockReason = "active-jobs" | "not-ready" | "disabled";

export interface UpdateInstallResult {
  started: boolean;
  activeJobs: number;
  reason: UpdateInstallBlockReason | null;
}
