import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AppSettings, ModelRecord } from "../../src/shared/types";
import {
  analyzeWorkflowText,
  assertSafeWorkflowUrl,
  isPathInsideWorkflowsDir,
  parseWorkflowJson,
  resolveWorkflowsDir,
  sanitizeWorkflowFileBase,
  WorkflowImporter,
} from "../../src/main/workflows/workflow-importer";
import { WorkflowImportLedger } from "../../src/main/workflows/workflow-ledger";
import { buildZip } from "../helpers/workflow-zip";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kirea-workflow-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

function makeModel(overrides: Partial<ModelRecord>): ModelRecord {
  return {
    id: `model_${overrides.name ?? "x"}`,
    name: "model.safetensors",
    relativePath: "folder/model.safetensors",
    filePath: "C:\\Comfy\\models\\folder\\model.safetensors",
    category: "checkpoint",
    architecture: "sdxl",
    sizeBytes: 1024,
    sha256: null,
    sourceRoot: "C:\\Comfy\\models",
    isDuplicate: false,
    duplicateOf: null,
    isIncomplete: false,
    compatibleWorkflows: [],
    license: null,
    description: null,
    installed: true,
    lastSeenAt: "2026-11-11T10:00:00.000Z",
    ...overrides,
  };
}

const API_WORKFLOW = JSON.stringify({
  "3": {
    class_type: "KSampler",
    inputs: { seed: 1, steps: 20 },
  },
  "4": {
    class_type: "CheckpointLoaderSimple",
    inputs: { ckpt_name: "dream.safetensors" },
  },
  "5": {
    class_type: "CLIPLoader",
    inputs: { clip_name: "missing_t5.safetensors", type: "wan" },
  },
  "6": {
    class_type: "SaveVideo",
    inputs: { filename_prefix: "kirea/video", format: "mp4", codec: "auto" },
  },
});

const UI_WORKFLOW = JSON.stringify({
  nodes: [
    {
      id: 1,
      type: "CheckpointLoaderSimple",
      widgets_values: ["sdxl.safetensors"],
    },
    { id: 2, type: "Note", widgets_values: ["remember to add detail"] },
    {
      id: 3,
      type: "LoraLoader",
      widgets_values: ["detail.safetensors", 0.8, 0.8],
    },
  ],
  links: [],
  definitions: { subgraphs: [{}] },
});

describe("ComfyUI workflow import analysis", () => {
  it("parses API graphs, flags missing nodes and models, and stays non-installable", () => {
    const parsed = parseWorkflowJson(API_WORKFLOW);
    expect(parsed.format).toBe("api");
    expect(parsed.nodes).toHaveLength(4);

    const analysis = analyzeWorkflowText(API_WORKFLOW, {
      name: "Wan test",
      sourceKind: "url",
      sourceLabel: "https://example.com/wan.json",
      models: [
        makeModel({
          name: "dream.safetensors",
          relativePath: "checkpoints/dream.safetensors",
          filePath: "C:\\Comfy\\models\\checkpoints\\dream.safetensors",
        }),
      ],
      availableNodeClasses: new Set(["KSampler", "CheckpointLoaderSimple", "SaveVideo"]),
      runtimeChecked: true,
    });

    expect(analysis.format).toBe("api");
    expect(analysis.video).toBe(true);
    expect(analysis.installable).toBe(false);
    expect(analysis.runtimeChecked).toBe(true);
    expect(analysis.missingNodeClasses).toEqual(["CLIPLoader"]);

    const installed = analysis.modelReferences.filter((reference) => reference.installed);
    const missing = analysis.modelReferences.filter((reference) => !reference.installed);
    expect(installed.map((reference) => reference.filename)).toEqual(["dream.safetensors"]);
    expect(installed[0]?.expectedFolder).toBe("checkpoints");
    expect(missing.map((reference) => reference.filename)).toEqual(["missing_t5.safetensors"]);
    expect(missing[0]?.expectedFolder).toBe("text_encoders");
    expect(analysis.warnings.join(" ")).toContain("not found");
  });

  it("parses UI workflows, ignores frontend notes, and reports subgraphs", () => {
    const parsed = parseWorkflowJson(UI_WORKFLOW);
    expect(parsed.format).toBe("ui");
    expect(parsed.subgraphCount).toBe(1);

    const analysis = analyzeWorkflowText(UI_WORKFLOW, {
      name: "Detail pass",
      sourceKind: "file",
      sourceLabel: "C:\\workflows\\detail.json",
      models: [
        makeModel({
          name: "sdxl.safetensors",
          relativePath: "checkpoints/sdxl.safetensors",
          filePath: "C:\\Comfy\\models\\checkpoints\\sdxl.safetensors",
          category: "checkpoint",
        }),
        makeModel({
          name: "detail.safetensors",
          relativePath: "loras/detail.safetensors",
          filePath: "C:\\Comfy\\models\\loras\\detail.safetensors",
          category: "lora",
        }),
      ],
      availableNodeClasses: new Set(["CheckpointLoaderSimple", "LoraLoader"]),
      runtimeChecked: true,
    });

    expect(analysis.installable).toBe(true);
    expect(analysis.nodeClasses.map((node) => node.classType)).toEqual([
      "CheckpointLoaderSimple",
      "LoraLoader",
    ]);
    expect(analysis.missingNodeClasses).toEqual([]);
    expect(analysis.modelReferences).toHaveLength(2);
    expect(analysis.modelReferences.every((reference) => reference.installed)).toBe(true);
    expect(analysis.warnings.join(" ")).toContain("subgraph");
  });

  it("rejects non-workflow JSON and skips availability checks when disconnected", () => {
    expect(() => parseWorkflowJson("{ \"hello\": true }")).toThrow(/not a ComfyUI workflow/i);
    expect(() => parseWorkflowJson("not json")).toThrow(/not valid JSON/i);

    const analysis = analyzeWorkflowText(UI_WORKFLOW, {
      name: "Offline",
      sourceKind: "file",
      sourceLabel: "detail.json",
      models: [],
      availableNodeClasses: null,
      runtimeChecked: false,
    });
    expect(analysis.nodeClasses.every((node) => node.available === null)).toBe(true);
    expect(analysis.missingNodeClasses).toEqual([]);
    expect(analysis.notes.join(" ")).toContain("not verified");
  });
});

describe("Workflow URL and install safety", () => {
  it("accepts public HTTPS URLs and rejects private or credential-bearing URLs", () => {
    expect(assertSafeWorkflowUrl("https://civitai.com/models/123").hostname).toBe("civitai.com");
    expect(() => assertSafeWorkflowUrl("http://example.com/a.json")).toThrow(/HTTPS/i);
    expect(() => assertSafeWorkflowUrl("https://127.0.0.1/a.json")).toThrow(/private/i);
    expect(() => assertSafeWorkflowUrl("https://192.168.1.20/a.json")).toThrow(/private/i);
    expect(() => assertSafeWorkflowUrl("https://localhost/a.json")).toThrow(/private/i);
    expect(() => assertSafeWorkflowUrl("https://user:pass@example.com/a.json")).toThrow(
      /credentials/i
    );
  });

  it("sanitizes workflow file names and confines reveal paths", () => {
    expect(sanitizeWorkflowFileBase("My: Workflow / v2")).toBe("My_ Workflow _ v2");
    expect(sanitizeWorkflowFileBase("..")).toBe("imported-workflow");
    expect(isPathInsideWorkflowsDir("C:\\Comfy\\user\\default\\workflows\\a.json", "C:\\Comfy\\user\\default\\workflows")).toBe(true);
    expect(isPathInsideWorkflowsDir("C:\\Comfy\\user\\default\\other\\a.json", "C:\\Comfy\\user\\default\\workflows")).toBe(false);
  });

  it("resolves the managed workflows folder and installs without overwriting", async () => {
    const sourceDir = makeTempDir();
    const cacheDir = makeTempDir();
    const sourcePath = path.join(sourceDir, "detail.json");
    fs.writeFileSync(sourcePath, UI_WORKFLOW, "utf8");

    const settings = { runtimeMode: "managed" } as AppSettings;
    expect(resolveWorkflowsDir(settings, cacheDir)).toBe(
      path.join(cacheDir, "comfy-user", "default", "workflows")
    );

    const importer = new WorkflowImporter({
      getSettings: () => settings,
      getModels: () => [],
      getConnectedApi: () => null,
      getCivitaiApiKey: () => null,
      cacheDir,
    });

    const first = await importer.analyzeFile(sourcePath);
    const installed = importer.install(first.previewId);
    expect(fs.existsSync(installed.filePath)).toBe(true);
    expect(fs.readFileSync(installed.filePath, "utf8")).toBe(UI_WORKFLOW);
    expect(importer.listInstalled().map((file) => file.fileName)).toEqual(["detail.json"]);

    const second = await importer.analyzeFile(sourcePath);
    const secondInstall = importer.install(second.previewId);
    expect(secondInstall.fileName).toBe("detail-1.json");
    expect(importer.listInstalled()).toHaveLength(2);
  });

  it("refuses to install API prompt graphs", async () => {
    const sourceDir = makeTempDir();
    const cacheDir = makeTempDir();
    const sourcePath = path.join(sourceDir, "api.json");
    fs.writeFileSync(sourcePath, API_WORKFLOW, "utf8");

    const importer = new WorkflowImporter({
      getSettings: () => ({ runtimeMode: "managed" } as AppSettings),
      getModels: () => [],
      getConnectedApi: () => null,
      getCivitaiApiKey: () => null,
      cacheDir,
    });

    const report = await importer.analyzeFile(sourcePath);
    expect(report.installable).toBe(false);
    expect(() => importer.install(report.previewId)).toThrow(/API prompt/i);
  });
});

function listFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const output: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) output.push(...listFiles(full));
    else output.push(full);
  }
  return output;
}

describe("Workflow ZIP import", () => {
  it("analyzes a ZIP in memory and installs only the selected workflow JSON", async () => {
    const sourceDir = makeTempDir();
    const cacheDir = makeTempDir();
    const zipPath = path.join(sourceDir, "pack.zip");
    fs.writeFileSync(
      zipPath,
      buildZip([
        { path: "workflows/detail.json", data: UI_WORKFLOW },
        { path: "previews/detail.png", data: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
        { path: "scripts/setup.py", data: "print('never run')" },
      ])
    );

    const importer = new WorkflowImporter({
      getSettings: () => ({ runtimeMode: "managed" } as AppSettings),
      getModels: () => [],
      getConnectedApi: () => null,
      getCivitaiApiKey: () => null,
      cacheDir,
      ledger: new WorkflowImportLedger(path.join(cacheDir, "workflow-import-ledger.json")),
    });

    const preview = await importer.analyzeWorkflowArchiveFile(zipPath);
    expect(preview.archiveName).toBe("pack.zip");
    expect(preview.candidates).toHaveLength(1);
    const candidate = preview.candidates[0]!;
    expect(candidate.entryPath).toBe("workflows/detail.json");
    expect(candidate.report.sourceKind).toBe("archive");
    expect(candidate.report.archiveEntry).toBe("workflows/detail.json");
    expect(candidate.report.originalFileName).toBe("workflows/detail.json");
    expect(candidate.report.installable).toBe(true);
    expect(candidate.report.runtimeChecked).toBe(false);
    expect(preview.warnings.join(" ")).toMatch(/Executable 'scripts\/setup.py' was ignored/);

    const workflowsDir = path.join(cacheDir, "comfy-user", "default", "workflows");
    expect(listFiles(workflowsDir)).toHaveLength(0);

    const installed = importer.install(candidate.report.previewId);
    expect(fs.readFileSync(installed.filePath, "utf8")).toBe(UI_WORKFLOW);
    expect(listFiles(workflowsDir)).toEqual([installed.filePath]);

    const files = listFiles(cacheDir);
    expect(files.some((file) => file.endsWith(".py"))).toBe(false);
    expect(files.some((file) => file.endsWith(".png"))).toBe(false);
    expect(files.filter((file) => !file.endsWith("workflow-import-ledger.json"))).toEqual([
      installed.filePath,
    ]);

    const [record] = importer.listInstalled();
    expect(record?.importRecord?.sourceKind).toBe("archive");
    expect(record?.importRecord?.archiveEntry).toBe("workflows/detail.json");
    expect(record?.importRecord?.compatibility).toBe("unknown");
  });

  it("offers every workflow candidate and marks API graphs as non-installable", async () => {
    const sourceDir = makeTempDir();
    const cacheDir = makeTempDir();
    const zipPath = path.join(sourceDir, "bundle.zip");
    fs.writeFileSync(
      zipPath,
      buildZip([
        { path: "a/one.json", data: UI_WORKFLOW },
        { path: "b/two.json", data: UI_WORKFLOW },
        { path: "c/api.json", data: API_WORKFLOW },
      ])
    );

    const importer = new WorkflowImporter({
      getSettings: () => ({ runtimeMode: "managed" } as AppSettings),
      getModels: () => [],
      getConnectedApi: () => null,
      getCivitaiApiKey: () => null,
      cacheDir,
    });

    const preview = await importer.analyzeWorkflowArchiveFile(zipPath);
    expect(preview.candidates).toHaveLength(3);
    expect(preview.candidates.map((candidate) => candidate.report.installable)).toEqual([
      true,
      true,
      false,
    ]);
    expect(preview.candidates.map((candidate) => candidate.report.name)).toEqual([
      "bundle - one",
      "bundle - two",
      "bundle - api",
    ]);

    const api = preview.candidates.find(
      (candidate) => candidate.entryPath === "c/api.json"
    )!;
    expect(() => importer.install(api.report.previewId)).toThrow(/API prompt/i);

    const installed = importer.install(preview.candidates[0]!.report.previewId);
    expect(installed.fileName).toBe("bundle - one.json");
    expect(listFiles(path.join(cacheDir, "comfy-user", "default", "workflows"))).toHaveLength(1);
  });

  it("rejects archives without a workflow or with malformed workflow JSON", async () => {
    const sourceDir = makeTempDir();
    const cacheDir = makeTempDir();
    const importer = new WorkflowImporter({
      getSettings: () => ({ runtimeMode: "managed" } as AppSettings),
      getModels: () => [],
      getConnectedApi: () => null,
      getCivitaiApiKey: () => null,
      cacheDir,
    });

    const imageOnly = path.join(sourceDir, "images.zip");
    fs.writeFileSync(
      imageOnly,
      buildZip([{ path: "preview.png", data: Buffer.from([1, 2, 3]) }])
    );
    await expect(importer.analyzeWorkflowArchiveFile(imageOnly)).rejects.toThrow(
      /does not contain a JSON workflow/i
    );

    const malformed = path.join(sourceDir, "malformed.zip");
    fs.writeFileSync(malformed, buildZip([{ path: "broken.json", data: "{ not json" }]));
    await expect(importer.analyzeWorkflowArchiveFile(malformed)).rejects.toThrow(
      /No valid ComfyUI workflow JSON/i
    );

    const notZip = path.join(sourceDir, "workflow.json");
    fs.writeFileSync(notZip, UI_WORKFLOW);
    await expect(importer.analyzeWorkflowArchiveFile(notZip)).rejects.toThrow(
      /ZIP archive/i
    );
  });
});
