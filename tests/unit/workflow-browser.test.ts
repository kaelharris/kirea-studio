import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CivitaiClient } from "../../src/main/civitai/civitai-client";
import type {
  CivitaiWorkflowFile,
  CivitaiWorkflowSummary,
  CivitaiWorkflowVersion,
} from "../../src/shared/civitai-workflows";
import type { AppSettings } from "../../src/shared/types";
import { WorkflowBrowser } from "../../src/main/workflows/workflow-browser";
import { WorkflowImporter } from "../../src/main/workflows/workflow-importer";
import { WorkflowImportLedger } from "../../src/main/workflows/workflow-ledger";
import type { WorkflowImportRecord } from "../../src/shared/workflow-import";
import { buildZip } from "../helpers/workflow-zip";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kirea-browser-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  vi.unstubAllGlobals();
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

const UI_WORKFLOW = JSON.stringify({
  nodes: [{ id: 1, type: "CheckpointLoaderSimple", widgets_values: ["sdxl.safetensors"] }],
  links: [],
});

function makeFile(overrides: Partial<CivitaiWorkflowFile> = {}): CivitaiWorkflowFile {
  return {
    id: 1,
    fileName: "flow.json",
    fileType: "Config",
    kind: "json",
    sizeBytes: 512,
    downloadUrl: "https://workflows.example.com/flow.json",
    sha256: null,
    primary: true,
    ...overrides,
  };
}

function makeVersion(overrides: Partial<CivitaiWorkflowVersion> = {}): CivitaiWorkflowVersion {
  const files = overrides.files ?? [makeFile()];
  return {
    id: 3001,
    name: "v1",
    baseModel: "SDXL 1.0",
    publishedAt: null,
    description: null,
    previewImageUrls: [],
    files,
    primaryFile: files[0] ?? null,
    categories: ["image-generation"],
    stats: { downloads: 0, thumbsUp: 0, thumbsDown: 0 },
    installed: false,
    installedFileName: null,
    ...overrides,
  };
}

function makeSummary(
  versions: CivitaiWorkflowVersion[] = [makeVersion()],
  overrides: Partial<CivitaiWorkflowSummary> = {}
): CivitaiWorkflowSummary {
  return {
    id: 777,
    name: "Flux flow",
    creator: "flowmaster",
    description: null,
    tags: ["flux"],
    baseModels: ["SDXL 1.0"],
    categories: ["image-generation"],
    nsfw: false,
    stats: { downloads: 10, thumbsUp: 2, rating: 4.5 },
    primaryPreviewUrl: null,
    versions,
    installed: false,
    importedAt: null,
    ...overrides,
  };
}

function stubClient(summary: CivitaiWorkflowSummary): CivitaiClient {
  return {
    searchWorkflows: async () => ({
      items: [summary],
      nextCursor: null,
      categoryFiltered: false,
    }),
    getWorkflowDetails: async () => summary,
  } as unknown as CivitaiClient;
}

function makeLedgerRecord(overrides: Partial<WorkflowImportRecord> = {}): WorkflowImportRecord {
  return {
    id: "rec_ledger",
    workflowName: "Flux flow - v1",
    sourceKind: "civitai",
    sourceLabel: "https://civitai.com/api/download/models/3001",
    sourceUrl: "https://civitai.com/api/download/models/3001",
    civitaiModelId: 777,
    civitaiVersionId: 3001,
    originalFileName: "flow.json",
    fileName: "Flux flow - v1.json",
    filePath: "C:\\ComfyUI\\user\\default\\workflows\\Flux flow - v1.json",
    folder: "C:\\ComfyUI\\user\\default\\workflows",
    importedAt: "2026-11-12T10:00:00.000Z",
    format: "ui",
    compatibility: "unknown",
    missingNodeCount: 0,
    missingModelCount: 0,
    archiveEntry: null,
    ...overrides,
  };
}

function makeBrowser(options: {
  summary: CivitaiWorkflowSummary;
  ledger?: WorkflowImportLedger;
  cacheDir?: string;
}): WorkflowBrowser {
  const cacheDir = options.cacheDir ?? makeTempDir();
  const importer = new WorkflowImporter({
    getSettings: () => ({ runtimeMode: "managed" } as AppSettings),
    getModels: () => [],
    getConnectedApi: () => null,
    getCivitaiApiKey: () => null,
    cacheDir,
    ledger: options.ledger,
  });
  return new WorkflowBrowser({
    client: stubClient(options.summary),
    importer,
    ledger: options.ledger ?? new WorkflowImportLedger(path.join(cacheDir, "ledger.json")),
  });
}

describe("Workflow browser installed-state decoration", () => {
  it("marks versions installed by Civitai version ID", async () => {
    const cacheDir = makeTempDir();
    const ledger = new WorkflowImportLedger(path.join(cacheDir, "ledger.json"));
    ledger.upsert(makeLedgerRecord());

    const browser = makeBrowser({ summary: makeSummary(), ledger, cacheDir });
    const result = await browser.search({});
    const summary = result.items[0]!;

    expect(summary.installed).toBe(true);
    expect(summary.importedAt).toBe("2026-11-12T10:00:00.000Z");
    expect(summary.versions[0]).toMatchObject({
      installed: true,
      installedFileName: "Flux flow - v1.json",
    });
  });

  it("falls back to matching the original archive filename", async () => {
    const cacheDir = makeTempDir();
    const ledger = new WorkflowImportLedger(path.join(cacheDir, "ledger.json"));
    ledger.upsert(
      makeLedgerRecord({
        civitaiVersionId: null,
        originalFileName: "bundle.zip",
        fileName: "bundle - detail.json",
      })
    );

    const summary = makeSummary([
      makeVersion({
        id: 3002,
        files: [
          makeFile({
            fileName: "bundle.zip",
            kind: "zip",
            downloadUrl: "https://civitai.com/api/download/models/3002",
          }),
        ],
        primaryFile: null,
      }),
    ]);
    const decorated = await makeBrowser({ summary, ledger, cacheDir }).details(777);

    expect(decorated.installed).toBe(true);
    expect(decorated.versions[0]!.installedFileName).toBe("bundle - detail.json");
  });

  it("leaves unmatched workflows uninstalled", async () => {
    const cacheDir = makeTempDir();
    const ledger = new WorkflowImportLedger(path.join(cacheDir, "ledger.json"));
    ledger.upsert(makeLedgerRecord({ civitaiVersionId: 9999, originalFileName: "other.json" }));

    const decorated = await makeBrowser({
      summary: makeSummary([makeVersion({ id: 4004 })]),
      ledger,
      cacheDir,
    }).details(777);

    expect(decorated.installed).toBe(false);
    expect(decorated.importedAt).toBeNull();
    expect(decorated.versions[0]!.installed).toBe(false);
    expect(decorated.versions[0]!.installedFileName).toBeNull();
  });
});

describe("Workflow browser import preparation", () => {
  it("rejects unknown versions and versions without an installable file", async () => {
    const browser = makeBrowser({ summary: makeSummary() });
    await expect(
      browser.prepareImport({ modelId: 777, versionId: 1 })
    ).rejects.toThrow(/is not available/i);

    const noFiles = makeSummary([
      makeVersion({ files: [], primaryFile: null }),
    ]);
    await expect(
      makeBrowser({ summary: noFiles }).prepareImport({ modelId: 777, versionId: 3001 })
    ).rejects.toThrow(/no installable \.json or \.zip file/i);
  });

  it("refuses unsupported primary files and insecure download URLs", async () => {
    const unsupportedFile = makeFile({
      fileName: "weights.safetensors",
      kind: "unsupported",
    });
    const unsupported = makeSummary([
      makeVersion({ files: [unsupportedFile], primaryFile: unsupportedFile }),
    ]);
    await expect(
      makeBrowser({ summary: unsupported }).prepareImport({ modelId: 777, versionId: 3001 })
    ).rejects.toThrow(/not a workflow JSON or ZIP archive/i);

    const insecure = makeSummary([
      makeVersion({
        files: [makeFile({ downloadUrl: "http://civitai.com/api/download/models/3001" })],
      }),
    ]);
    await expect(
      makeBrowser({ summary: insecure }).prepareImport({ modelId: 777, versionId: 3001 })
    ).rejects.toThrow(/secure download URL/i);
  });

  it("analyzes a JSON workflow without downloading any model weights", async () => {
    const fetched: string[] = [];
    vi.stubGlobal(
      "fetch",
      (async (input: RequestInfo | URL) => {
        fetched.push(String(input));
        return new Response(UI_WORKFLOW, { status: 200 });
      }) as typeof fetch
    );

    const preview = await makeBrowser({ summary: makeSummary() }).prepareImport({
      modelId: 777,
      versionId: 3001,
    });

    expect(fetched).toEqual(["https://workflows.example.com/flow.json"]);
    expect(preview).toMatchObject({
      modelId: 777,
      versionId: 3001,
      fileKind: "json",
      originalFileName: "flow.json",
      candidates: [],
    });
    expect(preview.report?.installable).toBe(true);
    expect(preview.report?.name).toBe("Flux flow - v1");
    expect(preview.report?.civitaiModelId).toBe(777);
    expect(preview.report?.civitaiVersionId).toBe(3001);
    expect(preview.notes.join(" ")).toMatch(/UI-format workflow/i);
  });

  it("analyzes a ZIP archive in memory and lists candidates", async () => {
    const fetched: string[] = [];
    vi.stubGlobal(
      "fetch",
      (async (input: RequestInfo | URL) => {
        fetched.push(String(input));
        return new Response(
          new Uint8Array(
            buildZip([
              { path: "workflows/detail.json", data: UI_WORKFLOW },
              { path: "previews/detail.png", data: Buffer.from([0x89, 0x50]) },
            ])
          ),
          { status: 200 }
        );
      }) as typeof fetch
    );

    const zipFile = makeFile({
      fileName: "bundle.zip",
      kind: "zip",
      downloadUrl: "https://civitai.com/api/download/models/3001?type=Archive",
    });
    const preview = await makeBrowser({
      summary: makeSummary([
        makeVersion({ files: [zipFile], primaryFile: zipFile }),
      ]),
    }).prepareImport({ modelId: 777, versionId: 3001 });

    expect(fetched).toEqual(["https://civitai.com/api/download/models/3001?type=Archive"]);
    expect(preview.fileKind).toBe("zip");
    expect(preview.report).toBeNull();
    expect(preview.originalFileName).toBe("bundle.zip");
    expect(preview.candidates).toHaveLength(1);
    expect(preview.candidates[0]!.entryPath).toBe("workflows/detail.json");
    expect(preview.notes.join(" ")).toMatch(/contains 1 usable workflow candidate/i);
  });
});
