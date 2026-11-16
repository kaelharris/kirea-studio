import path from "node:path";
import type { CivitaiClient } from "../civitai/civitai-client";
import type {
  CivitaiWorkflowFile,
  CivitaiWorkflowImportPreview,
  CivitaiWorkflowImportRequest,
  CivitaiWorkflowSearchQuery,
  CivitaiWorkflowSearchResult,
  CivitaiWorkflowSummary,
  CivitaiWorkflowVersion,
} from "../../shared/civitai-workflows";
import type { WorkflowImportLedger } from "./workflow-ledger";
import type { WorkflowImportRecord } from "../../shared/workflow-import";
import type { WorkflowImporter } from "./workflow-importer";

interface LedgerIndex {
  records: WorkflowImportRecord[];
  versionIds: Set<number>;
  modelIds: Set<number>;
  fileNames: Set<string>;
}

function buildLedgerIndex(records: WorkflowImportRecord[]): LedgerIndex {
  const versionIds = new Set<number>();
  const modelIds = new Set<number>();
  const fileNames = new Set<string>();
  for (const record of records) {
    if (record.civitaiVersionId !== null) versionIds.add(record.civitaiVersionId);
    if (record.civitaiModelId !== null) modelIds.add(record.civitaiModelId);
    if (record.originalFileName) {
      fileNames.add(path.basename(record.originalFileName).toLowerCase());
    }
    fileNames.add(path.basename(record.fileName).toLowerCase());
  }
  return { records, versionIds, modelIds, fileNames };
}

function matchingRecord(
  index: LedgerIndex,
  version: CivitaiWorkflowVersion
): WorkflowImportRecord | null {
  const byVersion = index.records.find(
    (record) => record.civitaiVersionId === version.id
  );
  if (byVersion) return byVersion;
  return (
    index.records.find((record) => {
      const names = [
        record.originalFileName ? path.basename(record.originalFileName) : "",
        path.basename(record.fileName),
      ]
        .filter(Boolean)
        .map((name) => name.toLowerCase());
      return version.files.some((file) =>
        names.includes(path.basename(file.fileName).toLowerCase())
      );
    }) ?? null
  );
}

export interface WorkflowBrowserDeps {
  client: CivitaiClient;
  importer: WorkflowImporter;
  ledger: WorkflowImportLedger;
}

export class WorkflowBrowser {
  constructor(private readonly deps: WorkflowBrowserDeps) {}

  private decorate(summary: CivitaiWorkflowSummary): CivitaiWorkflowSummary {
    const index = buildLedgerIndex(this.deps.ledger.list());
    let importedAt: string | null = null;
    const versions = summary.versions.map((version) => {
      const record = matchingRecord(index, version);
      if (record && (!importedAt || record.importedAt > importedAt)) {
        importedAt = record.importedAt;
      }
      return {
        ...version,
        installed: Boolean(record),
        installedFileName: record?.fileName ?? null,
      };
    });
    return {
      ...summary,
      versions,
      installed: versions.some((version) => version.installed),
      importedAt,
    };
  }

  async search(query: CivitaiWorkflowSearchQuery): Promise<CivitaiWorkflowSearchResult> {
    const result = await this.deps.client.searchWorkflows(query);
    return {
      ...result,
      items: result.items.map((item) => this.decorate(item)),
    };
  }

  async details(modelId: number): Promise<CivitaiWorkflowSummary> {
    return this.decorate(await this.deps.client.getWorkflowDetails(modelId));
  }

  async prepareImport(
    request: CivitaiWorkflowImportRequest
  ): Promise<CivitaiWorkflowImportPreview> {
    const summary = await this.deps.client.getWorkflowDetails(request.modelId);
    const version = summary.versions.find((entry) => entry.id === request.versionId);
    if (!version) {
      throw new Error(
        `Civitai version ${request.versionId} is not available for workflow ${request.modelId}.`
      );
    }
    const file = version.primaryFile;
    if (!file) {
      const names = version.files.map((entry) => entry.fileName).join(", ") || "none";
      throw new Error(
        `This workflow version has no installable .json or .zip file (files: ${names}). Kirea will not download model weights from a workflow listing.`
      );
    }
    if (file.kind === "unsupported") {
      throw new Error(
        `Kirea will not download '${file.fileName}' because it is not a workflow JSON or ZIP archive.`
      );
    }
    if (!/^https:\/\//i.test(file.downloadUrl)) {
      throw new Error("Civitai did not return a secure download URL for this workflow file.");
    }
    if (file.kind === "zip") {
      return this.prepareArchive(summary, version, file);
    }

    const name = `${summary.name} - ${version.name}`;
    const report = await this.deps.importer.analyzeUrl(file.downloadUrl, {
      name,
      civitaiModelId: summary.id,
      civitaiVersionId: version.id,
      originalFileName: file.fileName,
      sourceUrl: file.downloadUrl,
    });
    return {
      modelId: summary.id,
      modelName: summary.name,
      versionId: version.id,
      versionName: version.name,
      originalFileName: file.fileName,
      fileKind: "json",
      report,
      candidates: [],
      notes: [
        report.installable
          ? "UI-format workflow. Review the analysis, then install it into ComfyUI."
          : "This is an API prompt graph. It can be analyzed but not installed into ComfyUI's workflow browser.",
      ],
    };
  }

  private async prepareArchive(
    summary: CivitaiWorkflowSummary,
    version: CivitaiWorkflowVersion,
    file: CivitaiWorkflowFile
  ): Promise<CivitaiWorkflowImportPreview> {
    const preview = await this.deps.importer.analyzeWorkflowArchiveUrl(file.downloadUrl, {
      archiveName: file.fileName,
      namePrefix: `${summary.name} - ${version.name}`,
      sourceLabel: file.downloadUrl,
      civitaiModelId: summary.id,
      civitaiVersionId: version.id,
      sourceUrl: file.downloadUrl,
    });
    return {
      modelId: summary.id,
      modelName: summary.name,
      versionId: version.id,
      versionName: version.name,
      originalFileName: file.fileName,
      fileKind: "zip",
      report: null,
      candidates: preview.candidates,
      notes: [
        `Archive '${preview.archiveName}' contains ${preview.candidates.length} usable workflow candidate(s).`,
        ...preview.warnings,
      ],
    };
  }
}
