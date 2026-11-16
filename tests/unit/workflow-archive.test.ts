import { describe, expect, it } from "vitest";
import {
  ARCHIVE_LIMITS,
  assertSafeArchivePath,
  inspectWorkflowArchive,
  readWorkflowArchiveJson,
} from "../../src/main/workflows/workflow-archive";
import { buildZip } from "../helpers/workflow-zip";

const WORKFLOW = JSON.stringify({ nodes: [{ id: 1, type: "KSampler", widgets_values: [] }] });

describe("workflow ZIP inspection security", () => {
  it("classifies workflow, image, executable and nested entries without extracting", () => {
    const zip = buildZip([
      { path: "workflows/" },
      { path: "workflows/detail.json", data: WORKFLOW },
      { path: "previews/detail.png", data: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
      { path: "scripts/install.py", data: "print('no')" },
      { path: "bundle/nested.zip", data: buildZip([{ path: "a.txt", data: "a" }]) },
    ]);
    const inspection = inspectWorkflowArchive(zip);
    expect(inspection.jsonEntries).toHaveLength(1);
    expect(inspection.jsonEntries[0]?.path).toBe("workflows/detail.json");
    expect(inspection.entries.map((entry) => entry.kind)).toEqual([
      "json",
      "image",
      "executable",
      "nested-archive",
    ]);
    expect(inspection.warnings.join(" ")).toMatch(/Executable.*ignored/);
    expect(inspection.warnings.join(" ")).toMatch(/Nested archive.*ignored/);
  });

  it("rejects traversal, absolute, UNC, drive-letter and unsafe paths", () => {
    expect(() => assertSafeArchivePath("../escape.json")).toThrow(/traversal/);
    expect(() => assertSafeArchivePath("a/../../b.json")).toThrow(/traversal/);
    expect(() => assertSafeArchivePath("/etc/passwd")).toThrow(/absolute/i);
    expect(() => assertSafeArchivePath("\\\\server\\share\\a.json")).toThrow(/absolute/i);
    expect(() => assertSafeArchivePath("C:\\Temp\\a.json")).toThrow(/absolute/i);
    expect(() => assertSafeArchivePath("a\u0000b.json")).toThrow(/null byte/i);
    expect(() => assertSafeArchivePath("a/bad:name.json")).toThrow(/unsafe path/i);
    expect(() => assertSafeArchivePath("a/b/c/d/e/f/g/h/i.json")).toThrow(/nested too deeply/i);
    expect(() =>
      inspectWorkflowArchive(
        buildZip([{ path: "../escape.json", data: WORKFLOW }])
      )
    ).toThrow(/traversal/);
  });

  it("rejects encrypted entries and symbolic links", () => {
    expect(() =>
      inspectWorkflowArchive(
        buildZip([{ path: "locked.json", data: WORKFLOW, flags: 0x0001 }])
      )
    ).toThrow(/encrypted/i);
    expect(() =>
      inspectWorkflowArchive(
        buildZip([
          { path: "link.json", data: "target", externalAttributes: 0o120777 << 16 },
        ])
      )
    ).toThrow(/symbolic link/i);
  });

  it("rejects ZIP bombs by per-entry size and compression ratio", () => {
    expect(() =>
      inspectWorkflowArchive(
        buildZip([
          {
            path: "huge.json",
            data: "{}",
            reportedUncompressedSize: ARCHIVE_LIMITS.maxEntryUncompressedBytes + 1,
          },
        ])
      )
    ).toThrow(/per-file limit/i);

    expect(() =>
      inspectWorkflowArchive(
        buildZip([
          {
            path: "bomb.json",
            data: Buffer.alloc(ARCHIVE_LIMITS.ratioCheckThreshold + 1024, 0x20),
          },
        ])
      )
    ).toThrow(/compression ratio/i);
  });

  it("rejects excessive entry counts and corrupt archives", () => {
    const entries = Array.from({ length: ARCHIVE_LIMITS.maxEntries + 1 }, (_, index) => ({
      path: `file-${index}.txt`,
      data: "x",
    }));
    expect(() => inspectWorkflowArchive(buildZip(entries))).toThrow(/limit/i);
    expect(() => inspectWorkflowArchive(Buffer.from("definitely not a zip"))).toThrow(
      /not a valid ZIP/i
    );
  });

  it("validates CRC and size when reading workflow JSON", () => {
    const zip = buildZip([{ path: "workflow.json", data: WORKFLOW }]);
    const inspection = inspectWorkflowArchive(zip);
    expect(readWorkflowArchiveJson(zip, inspection.jsonEntries[0]!)).toBe(WORKFLOW);

    const badCrc = buildZip([
      { path: "workflow.json", data: WORKFLOW, crcOverride: 0xdeadbeef },
    ]);
    const badInspection = inspectWorkflowArchive(badCrc);
    expect(() => readWorkflowArchiveJson(badCrc, badInspection.jsonEntries[0]!)).toThrow(
      /CRC check/i
    );
  });
});
