import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkflowImportLedger } from "../../src/main/workflows/workflow-ledger";
import type { WorkflowImportRecord } from "../../src/shared/workflow-import";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kirea-ledger-"));
  tempDirs.push(dir);
  return dir;
}

function ledgerPath(dir: string): string {
  return path.join(dir, "cache", "workflow-import-ledger.json");
}

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

const FOLDER = "C:\\ComfyUI\\user\\default\\workflows";

function makeRecord(overrides: Partial<WorkflowImportRecord> = {}): WorkflowImportRecord {
  return {
    id: "rec_1",
    workflowName: "Detail pass",
    sourceKind: "file",
    sourceLabel: "C:\\workflows\\detail.json",
    sourceUrl: null,
    civitaiModelId: null,
    civitaiVersionId: null,
    originalFileName: null,
    fileName: "detail.json",
    filePath: path.join(FOLDER, "detail.json"),
    folder: FOLDER,
    importedAt: "2026-11-11T10:00:00.000Z",
    format: "ui",
    compatibility: "unknown",
    missingNodeCount: 0,
    missingModelCount: 0,
    archiveEntry: null,
    ...overrides,
  };
}

describe("Workflow import ledger", () => {
  it("returns nothing before the first write and persists atomically", () => {
    const dir = makeTempDir();
    const file = ledgerPath(dir);
    const ledger = new WorkflowImportLedger(file);

    expect(ledger.list()).toEqual([]);

    ledger.upsert(makeRecord());
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.existsSync(`${file}.tmp`)).toBe(false);

    const reloaded = new WorkflowImportLedger(file);
    expect(reloaded.list()).toEqual([makeRecord()]);
    expect(reloaded.getByFilePath(path.join(FOLDER, "detail.json"))?.id).toBe("rec_1");
    expect(reloaded.getByFilePath(path.join(FOLDER, "missing.json"))).toBeNull();
  });

  it("deduplicates by resolved path and keeps newest entries first", () => {
    const dir = makeTempDir();
    const ledger = new WorkflowImportLedger(ledgerPath(dir));

    ledger.upsert(makeRecord({ id: "old", fileName: "detail.json" }));
    ledger.upsert(
      makeRecord({
        id: "new",
        workflowName: "Detail pass v2",
        filePath: path.join(FOLDER, "passes", "..", "detail.json"),
        importedAt: "2026-11-12T10:00:00.000Z",
      })
    );
    ledger.upsert(
      makeRecord({
        id: "other",
        fileName: "portrait.json",
        filePath: path.join(FOLDER, "portrait.json"),
      })
    );

    const records = ledger.list();
    expect(records.map((record) => record.id)).toEqual(["other", "new"]);
    expect(records[1]!.workflowName).toBe("Detail pass v2");
    expect(ledger.list()).toHaveLength(2);
  });

  it("removes records by resolved path and reports misses", () => {
    const dir = makeTempDir();
    const ledger = new WorkflowImportLedger(ledgerPath(dir));
    ledger.upsert(makeRecord());

    expect(ledger.removeByFilePath(path.join(FOLDER, "other.json"))).toBe(false);
    expect(
      ledger.removeByFilePath(path.join(FOLDER, "legacy", "..", "detail.json"))
    ).toBe(true);
    expect(ledger.list()).toEqual([]);
  });

  it("tolerates a corrupt ledger and repairs it on the next write", () => {
    const dir = makeTempDir();
    const file = ledgerPath(dir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "{ this is not json", "utf8");

    const ledger = new WorkflowImportLedger(file);
    expect(ledger.list()).toEqual([]);
    expect(ledger.getByFilePath(path.join(FOLDER, "detail.json"))).toBeNull();

    ledger.upsert(makeRecord());
    expect(ledger.list()).toHaveLength(1);
  });

  it("drops malformed records and coerces unknown enums to safe defaults", () => {
    const dir = makeTempDir();
    const file = ledgerPath(dir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify([
        { id: "broken" },
        {
          ...makeRecord({ id: "coerced" }),
          sourceKind: "mystery",
          format: "legacy",
          compatibility: "probably",
          missingNodeCount: "lots",
        },
      ]),
      "utf8"
    );

    const [record] = new WorkflowImportLedger(file).list();
    expect(record).toMatchObject({
      id: "coerced",
      sourceKind: "url",
      format: "ui",
      compatibility: "unknown",
      missingNodeCount: 0,
      missingModelCount: 0,
    });
  });
});
