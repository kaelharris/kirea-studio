import type { ModelCategory } from "./types";

export type WorkflowJsonFormat = "ui" | "api";

export type WorkflowSourceKind = "url" | "file" | "civitai" | "archive";

export type WorkflowCompatibilityStatus = "compatible" | "incompatible" | "unknown";

export interface WorkflowNodeClassReport {
  classType: string;
  count: number;
  available: boolean | null;
}

export interface WorkflowModelReference {
  nodeId: string;
  nodeClass: string;
  inputName: string;
  filename: string;
  category: ModelCategory | "unknown";
  expectedFolder: string;
  installed: boolean;
}

export interface WorkflowImportReport {
  previewId: string;
  name: string;
  format: WorkflowJsonFormat;
  sourceKind: WorkflowSourceKind;
  sourceLabel: string;
  sizeBytes: number;
  nodeCount: number;
  video: boolean;
  runtimeChecked: boolean;
  installable: boolean;
  nodeClasses: WorkflowNodeClassReport[];
  missingNodeClasses: string[];
  modelReferences: WorkflowModelReference[];
  warnings: string[];
  notes: string[];
  civitaiModelId: number | null;
  civitaiVersionId: number | null;
  originalFileName: string | null;
  sourceUrl: string | null;
  archiveEntry: string | null;
}

export interface WorkflowInstallResult {
  fileName: string;
  filePath: string;
  folder: string;
}

export interface InstalledWorkflowFile {
  fileName: string;
  filePath: string;
  sizeBytes: number;
  modifiedAt: string;
  importRecord?: WorkflowImportRecord | null;
}

export interface WorkflowImportRecord {
  id: string;
  workflowName: string;
  sourceKind: WorkflowSourceKind;
  sourceLabel: string;
  sourceUrl: string | null;
  civitaiModelId: number | null;
  civitaiVersionId: number | null;
  originalFileName: string | null;
  fileName: string;
  filePath: string;
  folder: string;
  importedAt: string;
  format: WorkflowJsonFormat;
  compatibility: WorkflowCompatibilityStatus;
  missingNodeCount: number;
  missingModelCount: number;
  archiveEntry: string | null;
}

export interface WorkflowArchiveCandidate {
  entryPath: string;
  fileName: string;
  sizeBytes: number;
  report: WorkflowImportReport;
}

export interface WorkflowArchivePreview {
  archiveName: string;
  sourceLabel: string;
  candidates: WorkflowArchiveCandidate[];
  warnings: string[];
}

export interface WorkflowRevalidationResult {
  report: WorkflowImportReport;
  record: WorkflowImportRecord | null;
}

export type WorkflowFileAnalysisResult =
  | { kind: "json"; report: WorkflowImportReport }
  | { kind: "archive"; preview: WorkflowArchivePreview };
