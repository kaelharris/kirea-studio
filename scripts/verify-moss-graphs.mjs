import { buildComfyPromptGraph } from "../dist-electron/main/comfy/workflow-graph-builder.js";
import { WORKFLOW_TEMPLATES } from "../dist-electron/main/comfy/workflow-templates.js";

const COMFY = "http://127.0.0.1:8188";

const baseRequest = {
  workflowId: "",
  mode: "txt2img",
  prompt: "a quiet test scene",
  negativePrompt: "",
  checkpoint: "moss_image_sft_int8_convrot.safetensors",
  vae: null,
  loras: [],
  aspectRatio: "1:1",
  width: 1024,
  height: 1024,
  steps: 25,
  cfg: 2.5,
  sampler: "er_sde",
  scheduler: "simple",
  seed: 7,
  randomSeed: false,
  batchCount: 1,
  batchSize: 1,
  outputFormat: "png",
  inputImagePath: null,
  denoise: 1,
};

const cases = [
  { id: "t2i_moss_image" },
  { id: "t2i_moss_image_base", checkpoint: "moss_image_base_int8_convrot.safetensors" },
  {
    id: "t2i_moss_image_layout",
    layoutJson: JSON.stringify([
      {
        x: 128,
        y: 128,
        width: 768,
        height: 384,
        metadata: { type: "text", text: "MOSS", desc: "Title", palette: [] },
      },
      {
        x: 256,
        y: 512,
        width: 512,
        height: 384,
        metadata: { type: "obj", text: "", desc: "Subject", palette: [] },
      },
    ]),
  },
  {
    id: "i2i_moss_image_edit",
    mode: "img2img",
    checkpoint: "moss_image_sft_int8_convrot.safetensors",
    steps: 30,
    cfg: 4,
    sampler: "euler",
    scheduler: "normal",
  },
  {
    id: "i2i_moss_image_color_control",
    mode: "img2img",
    checkpoint: "moss_image_sft_int8_convrot.safetensors",
    steps: 25,
    cfg: 2.5,
    sampler: "er_sde",
    scheduler: "simple",
  },
  {
    id: "i2i_moss_image_depth_control",
    mode: "img2img",
    checkpoint: "moss_image_sft_int8_convrot.safetensors",
    steps: 25,
    cfg: 2.5,
    sampler: "er_sde",
    scheduler: "simple",
  },
];

let failed = false;
for (const testCase of cases) {
  const template = WORKFLOW_TEMPLATES.find((entry) => entry.id === testCase.id);
  if (!template) {
    console.error(`${testCase.id}: template missing`);
    failed = true;
    continue;
  }
  const request = { ...baseRequest, ...testCase, workflowId: testCase.id };
  const { graph } = buildComfyPromptGraph({
    request,
    uploadedInputFilename:
      request.mode === "img2img" ? "example.png" : undefined,
    availableModels: [],
  });
  const response = await fetch(`${COMFY}/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: graph, client_id: "kirea-moss-schema-check" }),
  });
  const result = await response.json();
  const nodeErrors = result.node_errors ?? {};
  const errorNodes = Object.keys(nodeErrors);
  const unexpected = errorNodes.filter(
    (nodeId) => !["28", "29", "30", "45"].includes(nodeId)
  );
  const classTypes = Object.fromEntries(
    Object.entries(nodeErrors).map(([nodeId, value]) => [
      nodeId,
      graph[nodeId]?.class_type ?? "?",
    ])
  );
  const ok = response.ok || (unexpected.length === 0 && errorNodes.length > 0);
  console.log(
    `${ok ? "SCHEMA-OK" : "SCHEMA-FAIL"} ${testCase.id}: HTTP ${response.status}; error nodes ${JSON.stringify(classTypes)}`
  );
  if (!ok) {
    failed = true;
    console.log(JSON.stringify(result, null, 2).slice(0, 4000));
  }
}

process.exit(failed ? 1 : 0);
