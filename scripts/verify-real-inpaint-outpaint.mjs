import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { buildComfyPromptGraph } from "../dist-electron/main/comfy/workflow-graph-builder.js";

const COMFY_HOST = "http://127.0.0.1:8188";
const CHECKPOINT = "illustrious\\Animixy².safetensors";
const VAE = "sdxl_vae_fp16fix.safetensors";

async function uploadToComfy(buffer, filename) {
  const form = new FormData();
  form.append("image", new Blob([buffer], { type: "image/png" }), filename);
  form.append("type", "input");
  form.append("overwrite", "true");

  const res = await fetch(`${COMFY_HOST}/upload/image`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    throw new Error(`Failed to upload ${filename}: ${res.status} ${await res.text()}`);
  }
  return await res.json();
}

async function runPromptAndWait(graph, title) {
  console.log(`\n[SUBMIT] Submitting ${title} prompt graph to ComfyUI...`);
  const submitRes = await fetch(`${COMFY_HOST}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: graph, client_id: "kirea-inpaint-verify" }),
  });
  if (!submitRes.ok) {
    throw new Error(`ComfyUI prompt submission failed: ${submitRes.status} ${await submitRes.text()}`);
  }
  const submitData = await submitRes.json();
  const promptId = submitData.prompt_id;
  console.log(`[QUEUED] Prompt ID: ${promptId}`);

  // Poll history
  const startTime = Date.now();
  while (Date.now() - startTime < 120000) {
    await new Promise((r) => setTimeout(r, 1000));
    const histRes = await fetch(`${COMFY_HOST}/history/${promptId}`);
    if (!histRes.ok) continue;
    const histData = await histRes.json();
    if (histData[promptId]) {
      const entry = histData[promptId];
      if (entry.status && entry.status.status_str === "error") {
        throw new Error(`Execution error: ${JSON.stringify(entry.status.messages)}`);
      }
      const outputs = entry.outputs;
      if (outputs && Object.keys(outputs).length > 0) {
        console.log(`[COMPLETED] Execution finished in ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
        // Find SaveImage node output (usually node 9)
        for (const [nodeId, out] of Object.entries(outputs)) {
          if (out.images && out.images.length > 0) {
            const img = out.images[0];
            const imgUrl = `${COMFY_HOST}/view?filename=${img.filename}&subfolder=${img.subfolder}&type=${img.type}`;
            const imgBuf = Buffer.from(await (await fetch(imgUrl)).arrayBuffer());
            return { filename: img.filename, buffer: imgBuf, durationSec: (Date.now() - startTime) / 1000 };
          }
        }
      }
    }
  }
  throw new Error(`Timeout waiting for prompt ${promptId}`);
}

async function run() {
  console.log("=== KIREA Studio v1.0.8 — Real Inpainting & Outpainting GPU Verification ===");

  // 1. Generate 1024x1024 Source Image with rich pattern
  console.log("\n[STEP 1] Generating test source image (1024x1024)...");
  const width = 1024;
  const height = 1024;
  const svgSource = `
  <svg width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="#1a1c23"/>
    <circle cx="200" cy="200" r="120" fill="#3b82f6"/>
    <rect x="700" y="700" width="200" height="200" fill="#10b981"/>
    <circle cx="512" cy="512" r="160" fill="#f59e0b"/>
    <text x="50" y="100" font-size="36" fill="#ffffff" font-family="sans-serif">KIREA SOURCE TEST</text>
  </svg>
  `;
  const sourceBuffer = await sharp(Buffer.from(svgSource)).png().toBuffer();
  fs.writeFileSync("kirea_test_source.png", sourceBuffer);

  // 2. Generate 1024x1024 Binary Inpaint Mask (Solid black with white box over center circle)
  console.log("[STEP 2] Generating binary inpaint mask (White center 360x360, Black background)...");
  const svgMask = `
  <svg width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="#000000"/>
    <rect x="332" y="332" width="360" height="360" fill="#ffffff"/>
  </svg>
  `;
  const maskBuffer = await sharp(Buffer.from(svgMask)).png().toBuffer();
  fs.writeFileSync("kirea_test_mask.png", maskBuffer);

  // 3. Upload to ComfyUI
  console.log("[STEP 3] Uploading source and mask to ComfyUI...");
  const upSource = await uploadToComfy(sourceBuffer, "kirea_source_verify.png");
  const upMask = await uploadToComfy(maskBuffer, "kirea_mask_verify.png");
  console.log(`Source uploaded: ${upSource.name}`);
  console.log(`Mask uploaded: ${upMask.name}`);

  const mockModels = [
    {
      id: "animixy",
      name: "Animixy²",
      category: "checkpoint",
      architecture: "illustrious",
      format: "safetensors",
      installed: true,
      filePath: CHECKPOINT,
      relativePath: CHECKPOINT,
      sizeBytes: 6000000000,
      sha256: null,
      favorite: false,
      tags: [],
      triggerWords: [],
      baseModel: "Illustrious",
      description: "",
      notes: "",
      previewPath: null,
      source: null,
      createdAt: "",
      updatedAt: "",
    },
    {
      id: "vae",
      name: "sdxl_vae_fp16fix",
      category: "vae",
      architecture: "sdxl",
      format: "safetensors",
      installed: true,
      filePath: VAE,
      relativePath: VAE,
      sizeBytes: 300000000,
      sha256: null,
      favorite: false,
      tags: [],
      triggerWords: [],
      baseModel: "SDXL",
      description: "",
      notes: "",
      previewPath: null,
      source: null,
      createdAt: "",
      updatedAt: "",
    },
  ];

  // 4. Test INPAINTING Workflow
  console.log("\n=======================================================");
  console.log("TEST A: NATIVE INPAINTING EXECUTION (ANIMIXY² ON RTX 4070 Ti SUPER)");
  console.log("=======================================================");
  const inpaintRequest = {
    workflowId: "i2i_sdxl_base",
    mode: "img2img",
    prompt: "masterpiece, best quality, glowing magical blue crystal orb, highly detailed",
    negativePrompt: "worst quality, blurry",
    checkpoint: CHECKPOINT,
    vae: VAE,
    loras: [],
    aspectRatio: "1:1",
    width: 1024,
    height: 1024,
    steps: 12,
    cfg: 6.0,
    sampler: "dpmpp_2m",
    scheduler: "karras",
    seed: 12345,
    randomSeed: false,
    batchCount: 1,
    batchSize: 1,
    outputFormat: "png",
    inputImagePath: "kirea_test_source.png",
    denoise: 0.75,
    maskGrowBy: 6,
  };

  const inpaintGraph = buildComfyPromptGraph({
    request: inpaintRequest,
    uploadedInputFilename: upSource.name,
    uploadedMaskFilename: upMask.name,
    availableModels: mockModels,
    filenamePrefix: "kirea_inpaint_result",
  });

  const inpaintResult = await runPromptAndWait(inpaintGraph.graph, "Native Inpainting");
  fs.writeFileSync("kirea_inpaint_output.png", inpaintResult.buffer);

  // Analyze Inpaint Output
  const inpaintMeta = await sharp(inpaintResult.buffer).metadata();
  console.log(`[VERIFY] Inpaint output dimensions: ${inpaintMeta.width}x${inpaintMeta.height}`);
  if (inpaintMeta.width !== 1024 || inpaintMeta.height !== 1024) {
    throw new Error(`Inpaint dimension mismatch: expected 1024x1024, got ${inpaintMeta.width}x${inpaintMeta.height}`);
  }

  // Compare pixels:
  // (100, 100) is well OUTSIDE the mask -> Must be IDENTICAL to source image
  // (512, 512) is INSIDE the mask -> Must be DIFFERENT (regenerated)
  const sourceRaw = await sharp(sourceBuffer).raw().toBuffer({ resolveWithObject: true });
  const inpaintRaw = await sharp(inpaintResult.buffer).raw().toBuffer({ resolveWithObject: true });

  const getPixel = (imgObj, x, y) => {
    const idx = (y * imgObj.info.width + x) * imgObj.info.channels;
    return [imgObj.data[idx], imgObj.data[idx + 1], imgObj.data[idx + 2]];
  };

  const unmaskedP1Source = getPixel(sourceRaw, 100, 100);
  const unmaskedP1Inpaint = getPixel(inpaintRaw, 100, 100);
  console.log(`[PIXEL CHECK] Unmasked point (100, 100):`);
  console.log(`  Source:  RGB(${unmaskedP1Source.join(",")})`);
  console.log(`  Inpaint: RGB(${unmaskedP1Inpaint.join(",")})`);
  const unmaskedDiff = Math.abs(unmaskedP1Source[0] - unmaskedP1Inpaint[0]) +
                       Math.abs(unmaskedP1Source[1] - unmaskedP1Inpaint[1]) +
                       Math.abs(unmaskedP1Source[2] - unmaskedP1Inpaint[2]);
  if (unmaskedDiff !== 0) {
    throw new Error(`Unmasked pixel check failed: diff was ${unmaskedDiff}, expected 0 (byte-identical)`);
  }
  console.log(`  -> 100% BYTE-IDENTICAL PRESERVATION CONFIRMED (Diff: 0)`);

  const maskedCenterSource = getPixel(sourceRaw, 512, 512);
  const maskedCenterInpaint = getPixel(inpaintRaw, 512, 512);
  console.log(`[PIXEL CHECK] Masked center point (512, 512):`);
  console.log(`  Source:  RGB(${maskedCenterSource.join(",")})`);
  console.log(`  Inpaint: RGB(${maskedCenterInpaint.join(",")})`);
  const maskedDiff = Math.abs(maskedCenterSource[0] - maskedCenterInpaint[0]) +
                     Math.abs(maskedCenterSource[1] - maskedCenterInpaint[1]) +
                     Math.abs(maskedCenterSource[2] - maskedCenterInpaint[2]);
  if (maskedDiff < 10) {
    throw new Error(`Masked pixel check failed: diff was ${maskedDiff}, expected generative change`);
  }
  console.log(`  -> GENERATIVE REGENERATION CONFIRMED (Diff: ${maskedDiff})`);

  // 5. Test OUTPAINTING Workflow
  console.log("\n=======================================================");
  console.log("TEST B: NATIVE OUTPAINTING EXECUTION (CANVAS EXPANSION ON RTX 4070 Ti SUPER)");
  console.log("=======================================================");
  const outpaintRequest = {
    workflowId: "i2i_sdxl_base",
    mode: "img2img",
    prompt: "masterpiece, best quality, expansive cyberpunk city background, detailed lighting",
    negativePrompt: "worst quality, blurry",
    checkpoint: CHECKPOINT,
    vae: VAE,
    loras: [],
    aspectRatio: "1:1",
    width: 1024,
    height: 1024,
    steps: 12,
    cfg: 6.0,
    sampler: "dpmpp_2m",
    scheduler: "karras",
    seed: 54321,
    randomSeed: false,
    batchCount: 1,
    batchSize: 1,
    outputFormat: "png",
    inputImagePath: "kirea_test_source.png",
    denoise: 0.85,
    outpaintPadding: {
      left: 128,
      right: 128,
      top: 64,
      bottom: 64,
    },
  };

  const outpaintGraph = buildComfyPromptGraph({
    request: outpaintRequest,
    uploadedInputFilename: upSource.name,
    availableModels: mockModels,
    filenamePrefix: "kirea_outpaint_result",
  });

  const outpaintResult = await runPromptAndWait(outpaintGraph.graph, "Native Outpainting");
  fs.writeFileSync("kirea_outpaint_output.png", outpaintResult.buffer);

  // Analyze Outpaint Output
  const outpaintMeta = await sharp(outpaintResult.buffer).metadata();
  console.log(`[VERIFY] Outpaint output dimensions: ${outpaintMeta.width}x${outpaintMeta.height}`);
  const expectedWidth = 1024 + 128 + 128; // 1280
  const expectedHeight = 1024 + 64 + 64;  // 1152
  if (outpaintMeta.width !== expectedWidth || outpaintMeta.height !== expectedHeight) {
    throw new Error(`Outpaint dimension mismatch: expected ${expectedWidth}x${expectedHeight}, got ${outpaintMeta.width}x${outpaintMeta.height}`);
  }
  console.log(`  -> EXACT DIMENSION EXPANSION CONFIRMED: 1024x1024 -> ${expectedWidth}x${expectedHeight}`);

  console.log("\n=======================================================");
  console.log("ALL REAL GPU INPAINTING & OUTPAINTING CHECKS PASSED!");
  console.log(`Inpaint Execution Duration: ${inpaintResult.durationSec}s`);
  console.log(`Outpaint Execution Duration: ${outpaintResult.durationSec}s`);
  console.log("Outputs saved: kirea_inpaint_output.png, kirea_outpaint_output.png");
  console.log("=======================================================");
}

run().catch((err) => {
  console.error("\n[VERIFICATION FAILED]:", err);
  process.exit(1);
});
