const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const RESULT_PATH = path.join(__dirname, "..", "canvas-export-check.log");
const trace = (line) => fs.appendFileSync(RESULT_PATH, `${line}\n`);
fs.writeFileSync(RESULT_PATH, "boot\n");
process.on("uncaughtException", (error) => {
  trace(`uncaught: ${error.stack}`);
  process.exit(1);
});
process.on("unhandledRejection", (error) => {
  trace(`rejection: ${error instanceof Error ? error.stack : String(error)}`);
  process.exit(1);
});

const { app } = require("electron");
app.on("window-all-closed", () => {
  // Keep the harness alive while the exporter cycles hidden render windows.
});
trace(`electron module loaded: ${typeof app?.whenReady}`);

let exportCanvasPdf;
let exportCanvasPng;
try {
  ({ exportCanvasPdf, exportCanvasPng } = require(
    path.join(__dirname, "..", "dist-electron", "main", "stories", "canvas-exporter.js")
  ));
} catch (error) {
  fs.appendFileSync(RESULT_PATH, `require-fail: ${error.stack}\n`);
  process.exit(1);
}

function report(line) {
  fs.writeFileSync(RESULT_PATH, `${line}\n`);
  try {
    console.log(line);
  } catch {
    // GUI subsystem may not have a console attached
  }
}

function fail(message) {
  report(`FAIL: ${message}`);
  app.exit(1);
}

function makeCanvas() {
  const items = Array.from({ length: 7 }, (_, index) => ({
    id: `item_${index}`,
    canvasId: "canvas_smoke",
    sceneId: null,
    imageId: null,
    position: index,
    x: null,
    y: null,
    width: null,
    height: null,
    fit: index % 2 === 0 ? "cover" : "contain",
    captionOverride: `Beat ${index + 1}`,
    overlays:
      index === 0
        ? [
            {
              id: "ov_1",
              kind: "speech",
              speaker: "Mira",
              text: "Hold the light.",
              x: 0.5,
              y: 0.25,
            },
            {
              id: "ov_2",
              kind: "narration",
              text: "Night falls.",
              x: 0.5,
              y: 0.85,
            },
          ]
        : [],
  }));

  return {
    id: "canvas_smoke",
    storyId: "story_smoke",
    name: "Storyboard",
    template: "grid_2x3",
    pageSize: "a4_landscape",
    pageWidth: 1123,
    pageHeight: 794,
    margin: 32,
    gutter: 16,
    background: "#101018",
    captionMode: "scene_title",
    settings: {},
    createdAt: "2026-11-11T10:00:00.000Z",
    updatedAt: "2026-11-11T10:00:00.000Z",
    items,
  };
}

trace("registering whenReady");
app.whenReady().then(async () => {
  trace("app ready");
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "kirea-canvas-export-"));
  const input = {
    canvas: makeCanvas(),
    storyTitle: "Smoke & Export",
    scenes: [],
    images: [],
    allowedRoots: [outDir],
  };

  const png = await exportCanvasPng(input, outDir);
  if (png.pageCount !== 2 || png.files.length !== 2) {
    fail(`expected 2 PNG pages, received ${png.pageCount}/${png.files.length}`);
  }
  for (const file of png.files) {
    const buffer = fs.readFileSync(file.filePath);
    if (buffer.readUInt32BE(0) !== 0x89504e47) {
      fail(`${file.filePath} is not a PNG`);
    }
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    if (width !== 1123 || height !== 794) {
      fail(`unexpected PNG dimensions ${width}x${height}`);
    }
  }

  const pdfPath = path.join(outDir, "storyboard.pdf");
  const pdf = await exportCanvasPdf(input, pdfPath);
  if (pdf.pageCount !== 2) fail(`expected 2 PDF pages, received ${pdf.pageCount}`);
  const pdfBuffer = fs.readFileSync(pdfPath);
  if (pdfBuffer.subarray(0, 5).toString() !== "%PDF-") {
    fail("PDF header missing");
  }
  if (pdfBuffer.length < 10_000) {
    fail(`PDF unexpectedly small (${pdfBuffer.length} bytes)`);
  }

  report(
    JSON.stringify({
      status: "PASS",
      outputDir: outDir,
      pngPages: png.files.map((file) => path.basename(file.filePath)),
      pngSize: `${png.width}x${png.height}`,
      pdfBytes: pdfBuffer.length,
    })
  );
  fs.rmSync(outDir, { recursive: true, force: true });
  app.quit();
}).catch((error) => {
  fail(error instanceof Error ? error.stack : String(error));
});
