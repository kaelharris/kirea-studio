import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { buildComfyPromptGraph } = require("../dist-electron/main/comfy/workflow-registry.js");

const HOST = process.env.KIREA_COMFY_HOST ?? "127.0.0.1";
const PORT = Number(process.env.KIREA_COMFY_PORT ?? 8188);
const BASE = `http://${HOST}:${PORT}`;
const OUT_DIR = path.resolve("verification");

// 1. Fetch available checkpoints and loras from running ComfyUI
const objectInfoRes = await fetch(`${BASE}/object_info`);
if (!objectInfoRes.ok) {
  throw new Error(`Failed to query ComfyUI object_info: ${objectInfoRes.status}`);
}
const objectInfo = await objectInfoRes.json();
const availableCkpts = objectInfo.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] || [];
const availableLoras = objectInfo.LoraLoader?.input?.required?.lora_name?.[0] || [];

console.log(`Found ${availableCkpts.length} checkpoints and ${availableLoras.length} LoRAs in ComfyUI.`);

// Find Illustrious checkpoint
const ckptName = availableCkpts.find((c) => c.includes("Animixy²") || c.includes("illustrious")) || availableCkpts[0];
if (!ckptName) {
  throw new Error("No checkpoint found in ComfyUI!");
}
console.log(`Selected checkpoint: ${ckptName}`);

// Select 10 Illustrious LoRAs
const illuLoras = availableLoras.filter((l) => l.startsWith("illustrious\\") || l.startsWith("illustrious/"));
if (illuLoras.length < 10) {
  throw new Error(`Expected at least 10 Illustrious LoRAs, found ${illuLoras.length}`);
}
const selectedLoras = illuLoras.slice(0, 10);
console.log(`Selected 10 LoRAs:\n  ${selectedLoras.join("\n  ")}`);

const models = [
  {
    name: path.basename(ckptName),
    relativePath: ckptName,
    category: "checkpoint",
    architecture: "illustrious",
    installed: true,
  },
  ...selectedLoras.map((l, i) => ({
    name: path.basename(l),
    relativePath: l,
    category: "lora",
    architecture: "illustrious",
    installed: true,
  })),
];

const request = {
  workflowId: "t2i_illustrious_base",
  mode: "txt2img",
  prompt: "masterpiece, 1girl, serene expression, sunset light, kimono, highly detailed",
  negativePrompt: "worst quality, low quality",
  checkpoint: ckptName,
  vae: null,
  loras: selectedLoras.map((l, i) => ({
    name: l,
    strengthModel: 0.35 + (i % 3) * 0.1,
    strengthClip: 0.35 + (i % 3) * 0.1,
  })),
  aspectRatio: "1:1",
  width: 512,
  height: 512,
  steps: 8,
  cfg: 7.0,
  sampler: "euler",
  scheduler: "normal",
  seed: 889911,
  randomSeed: false,
  batchCount: 1,
  batchSize: 1,
  outputFormat: "png",
  inputImagePath: null,
  denoise: 1.0,
};

const built = buildComfyPromptGraph({
  request,
  availableModels: models,
  filenamePrefix: "kirea_illustrious_10lora_live",
});
const graph = built.graph;

// Graph structure verification: Check 10 chained LoRA nodes (20 to 29)
console.log("Verifying compiled prompt graph nodes...");
for (let i = 0; i < 10; i++) {
  const nodeId = `2${i}`;
  if (!graph[nodeId]) {
    throw new Error(`Missing expected LoRA node ${nodeId}`);
  }
  if (graph[nodeId].class_type !== "LoraLoader") {
    throw new Error(`Node ${nodeId} is ${graph[nodeId].class_type}, expected LoraLoader`);
  }
  if (graph[nodeId].inputs.lora_name !== selectedLoras[i]) {
    throw new Error(`Node ${nodeId} lora_name mismatch`);
  }
}

// Check KSampler connects to 10th LoRA ("29", 0)
if (graph["3"].inputs.model[0] !== "29") {
  throw new Error(`KSampler model is ${graph["3"].inputs.model}, expected ["29", 0]`);
}
// Check CLIP prompts connect to 10th LoRA ("29", 1)
if (graph["6"].inputs.clip[0] !== "29" || graph["7"].inputs.clip[0] !== "29") {
  throw new Error(`CLIP prompt clip input is not ["29", 1]`);
}
console.log("Graph verification: 10 LoRAs sequentially and deterministically chained!");

// Submit to live ComfyUI
console.log("Submitting 10-LoRA generation to live ComfyUI instance...");
const submitRes = await fetch(`${BASE}/prompt`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ prompt: graph, client_id: `kirea-illu10-${Date.now()}` }),
});
const submitted = await submitRes.json();
if (!submitRes.ok || !submitted.prompt_id) {
  throw new Error(`Queue rejected: ${submitRes.status} ${JSON.stringify(submitted)}`);
}
console.log(`Queued prompt_id: ${submitted.prompt_id}`);

const started = Date.now();
let entry = null;
while (Date.now() - started < 5 * 60 * 1000) {
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const history = await fetch(`${BASE}/history/${submitted.prompt_id}`).then((r) => r.json());
  entry = history?.[submitted.prompt_id];
  if (entry) break;
  process.stdout.write(".");
}
console.log("");
if (!entry) throw new Error("Generation timed out after 5 minutes");
const status = entry.status ?? {};
if (status.status_str === "error" || status.completed === false) {
  throw new Error(`Generation failed: ${JSON.stringify(status)}`);
}

const image = Object.values(entry.outputs ?? {})
  .flatMap((out) => out.images ?? [])
  .find((item) => item.type === "output");
if (!image) throw new Error("No output image in history entry");

const params = new URLSearchParams({
  filename: image.filename,
  subfolder: image.subfolder ?? "",
  type: image.type ?? "output",
});
const response = await fetch(`${BASE}/view?${params}`);
if (!response.ok) throw new Error(`Could not download output: ${response.status}`);
const buffer = Buffer.from(await response.arrayBuffer());
fs.mkdirSync(OUT_DIR, { recursive: true });
const target = path.join(OUT_DIR, "illustrious-10-lora-live.png");
fs.writeFileSync(target, buffer);

console.log(
  JSON.stringify(
    {
      status: "PASS",
      promptId: submitted.prompt_id,
      elapsedSeconds: Math.round((Date.now() - started) / 1000),
      loraCount: selectedLoras.length,
      checkpoint: ckptName,
      width: 512,
      height: 512,
      outputBytes: buffer.length,
      saved: target,
    },
    null,
    2
  )
);
