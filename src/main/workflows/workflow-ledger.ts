import fs from "node:fs";
import path from "node:path";
import type {
  WorkflowCompatibilityStatus,
  WorkflowImportRecord,
  WorkflowJsonFormat,
  WorkflowSourceKind,
} from "../../shared/workflow-import";

const MAX_RECORDS = 500;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseRecord(value: unknown): WorkflowImportRecord | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== "string" ||
    typeof value.workflowName !== "string" ||
    typeof value.fileName !== "string" ||
    typeof value.filePath !== "string" ||
    typeof value.folder !== "string" ||
    typeof value.importedAt !== "string"
  ) {
    return null;
  }
  const sourceKind: WorkflowSourceKind =
    value.sourceKind === "file" ||
    value.sourceKind === "civitai" ||
    value.sourceKind === "archive"
      ? value.sourceKind
      : "url";
  const format: WorkflowJsonFormat = value.format === "api" ? "api" : "ui";
  const compatibility: WorkflowCompatibilityStatus =
    value.compatibility === "compatible" || value.compatibility === "incompatible"
      ? value.compatibility
      : "unknown";
  return {
    id: value.id,
    workflowName: value.workflowName,
    sourceKind,
    sourceLabel: typeof value.sourceLabel === "string" ? value.sourceLabel : "",
    sourceUrl: optionalString(value.sourceUrl),
    civitaiModelId: optionalNumber(value.civitaiModelId),
    civitaiVersionId: optionalNumber(value.civitaiVersionId),
    originalFileName: optionalString(value.originalFileName),
    fileName: value.fileName,
    filePath: value.filePath,
    folder: value.folder,
    importedAt: value.importedAt,
    format,
    compatibility,
    missingNodeCount: optionalNumber(value.missingNodeCount) ?? 0,
    missingModelCount: optionalNumber(value.missingModelCount) ?? 0,
    archiveEntry: optionalString(value.archiveEntry),
  };
}

export class WorkflowImportLedger {
  constructor(private readonly filePath: string) {}

  list(): WorkflowImportRecord[] {
    if (!fs.existsSync(this.filePath)) return [];
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map(parseRecord)
        .filter((record): record is WorkflowImportRecord => record !== null);
    } catch {
      return [];
    }
  }

  getByFilePath(filePath: string): WorkflowImportRecord | null {
    const resolved = path.resolve(filePath);
    return (
      this.list().find((record) => path.resolve(record.filePath) === resolved) ?? null
    );
  }

  upsert(record: WorkflowImportRecord): void {
    const records = this.list().filter(
      (entry) => path.resolve(entry.filePath) !== path.resolve(record.filePath)
    );
    records.unshift(record);
    this.write(records.slice(0, MAX_RECORDS));
  }

  removeByFilePath(filePath: string): boolean {
    const resolved = path.resolve(filePath);
    const records = this.list();
    const next = records.filter((record) => path.resolve(record.filePath) !== resolved);
    if (next.length === records.length) return false;
    this.write(next);
    return true;
  }

  private write(records: WorkflowImportRecord[]): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.tmp`;
    fs.writeFileSync(temp, `${JSON.stringify(records, null, 2)}\n`, "utf8");
    fs.renameSync(temp, this.filePath);
  }
}
