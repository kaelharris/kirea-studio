import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { buildComfyPromptGraph } = require("../dist-electron/main/comfy/workflow-registry.js");

const HOST = process.env.KIREA_COMFY_HOST ?? "127.0.0.1";
const PORT = Number(process.env.KIREA_COMFY_PORT ?? 8188);
const BASE = `http://${HOST}:${PORT}`;
const OUT_DIR = path.resolve("verification");

const models = [
  {
    name: "z_image_turbo_bf16.safetensors",
    relativePath: "z_image_turbo_bf16.safetensors",
    category: "diffusion_model",
    architecture: "z_image",
    installed: true,
  },
  {
    name: "qwen_3_4b.safetensors",
    relativePath: "qwen_3_4b.safetensors",
    category: "text_encoder",
    architecture: "z_image",
    installed: true,
  },
  {
    name: "ae.safetensors",
    relativePath: "ae.safetensors",
    category: "vae",
    architecture: "z_image",
    installed: true,
  },
];

const request = {
  workflowId: "t2i_z_image_turbo",
  mode: "txt2img",
  prompt:
    "Editorial photograph of a red fox curled asleep on a mossy forest floor, soft morning light, shallow depth of field, 85mm lens, fine fur detail",
  negativePrompt: "",
  checkpoint: "z_image_turbo_bf16.safetensors",
  vae: "ae.safetensors",
  loras: [],
  aspectRatio: "1:1",
  width: 1024,
  height: 1024,
  steps: 8,
  cfg: 1,
  sampler: "res_multistep",
  scheduler: "simple",
  seed: 771122,
  randomSeed: false,
  batchCount: 1,
  batchSize: 1,
  outputFormat: "png",
  inputImagePath: null,
  denoise: 1,
};

const built = buildComfyPromptGraph({
  request,
  availableModels: models,
  filenamePrefix: "kirea_z_image_live",
});
const graph = built.graph;

const checks = {
  unet: graph["28"]?.class_type === "UNETLoader",
  clip: graph["30"]?.class_type === "CLIPLoader" && graph["30"]?.inputs.type === "lumina2",
  vae: graph["29"]?.inputs.vae_name === "ae.safetensors",
  sampler:
    graph["3"]?.inputs.steps === 8 &&
    graph["3"]?.inputs.cfg === 1 &&
    graph["3"]?.inputs.sampler_name === "res_multistep",
  guidance: graph["11"]?.inputs.shift === 3,
};
if (Object.values(checks).some((ok) => !ok)) {
  throw new Error(`Graph mismatch: ${JSON.stringify(checks)}`);
}

const submit = await fetch(`${BASE}/prompt`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ prompt: graph, client_id: `kirea-verify-${Date.now()}` }),
});
const submitted = await submit.json();
if (!submit.ok || !submitted.prompt_id) {
  throw new Error(`Queue rejected: ${submit.status} ${JSON.stringify(submitted)}`);
}
console.log(`queued ${submitted.prompt_id}`);

const started = Date.now();
let entry = null;
while (Date.now() - started < 10 * 60 * 1000) {
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const history = await fetch(`${BASE}/history/${submitted.prompt_id}`).then((r) => r.json());
  entry = history?.[submitted.prompt_id];
  if (entry) break;
}
if (!entry) throw new Error("Generation timed out after 10 minutes");
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
const target = path.join(OUT_DIR, "z-image-turbo-live.png");
fs.writeFileSync(target, buffer);
console.log(
  JSON.stringify(
    {
      status: "PASS",
      promptId: submitted.prompt_id,
      elapsedSeconds: Math.round((Date.now() - started) / 1000),
      width: image.width ?? null,
      height: image.height ?? null,
      bytes: buffer.length,
      saved: target,
      checks,
    },
    null,
    2
  )
);
