import { generation } from "../stores/generation.svelte.js";
import { canvas, type CanvasLayer } from "../stores/canvas.svelte.js";
import { progress } from "../stores/progress.svelte.js";
import type { GenerationParams } from "../types/index.js";
import { uploadImageBytes } from "./api.js";
import {
  tempOutputToUploadBytes,
  waitForPromptCompletion,
  waitForPromptOutput,
} from "./waitForPrompt.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface MaskInpaintChainStepContext {
  index: number;
  total: number;
  layerName: string;
  isFinalOutput: boolean;
}

export interface MaskInpaintChainCallbacks {
  submit: (
    params: GenerationParams,
    ctx: MaskInpaintChainStepContext,
  ) => Promise<{ promptId: string; seed: string | number }>;
  onStep?: (info: { index: number; total: number; layerName: string }) => void;
  onWaitingForOutput?: () => void;
  shouldCancel?: () => boolean;
}

export interface MaskInpaintChainResult {
  lastPromptId: string;
  stepCount: number;
  finalTempFilename: string;
}

async function waitForChainStepOutput(
  promptId: string,
  isFinalOutput: boolean,
): Promise<string> {
  const temp = await waitForPromptOutput(promptId);
  if (isFinalOutput) {
    await waitForPromptCompletion(promptId);
    await sleep(600);
  }
  return temp;
}

/**
 * Render a mask canvas to white-on-black PNG bytes suitable for ComfyUI.
 */
async function renderMaskCanvasToPngBytes(
  maskCanvas: HTMLCanvasElement,
): Promise<number[]> {
  const offscreen = document.createElement("canvas");
  offscreen.width = maskCanvas.width;
  offscreen.height = maskCanvas.height;
  const ctx = offscreen.getContext("2d");
  if (!ctx) throw new Error("Failed to create 2D context for mask export");

  ctx.drawImage(maskCanvas, 0, 0);
  const imgData = ctx.getImageData(0, 0, offscreen.width, offscreen.height);
  const pixels = imgData.data;

  // Threshold 16: preserve dark & semi-transparent mask strokes
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] > 0 && (pixels[i] > 16 || pixels[i + 1] > 16 || pixels[i + 2] > 16)) {
      pixels[i] = 255;
      pixels[i + 1] = 255;
      pixels[i + 2] = 255;
      pixels[i + 3] = 255;
    } else {
      pixels[i] = 0;
      pixels[i + 1] = 0;
      pixels[i + 2] = 0;
      pixels[i + 3] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);

  const blob = await new Promise<Blob | null>((resolve) =>
    offscreen.toBlob(resolve, "image/png"),
  );
  if (!blob) throw new Error("Failed to export mask blob");

  const buffer = await blob.arrayBuffer();
  return Array.from(new Uint8Array(buffer));
}

/**
 * Check if a mask canvas has any non-black/non-transparent pixels.
 */
function maskCanvasHasContent(maskCanvas: HTMLCanvasElement): boolean {
  const ctx = maskCanvas.getContext("2d");
  if (!ctx) return false;
  const data = ctx.getImageData(0, 0, maskCanvas.width, maskCanvas.height).data;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] > 0 && (data[i] > 16 || data[i + 1] > 16 || data[i + 2] > 16)) {
      return true;
    }
  }
  return false;
}

/**
 * Run a multi-mask sequential inpainting chain across multiple canvas mask layers.
 * Each mask layer is inpainted in sequence; the output of layer N becomes the input of layer N+1.
 */
export async function runMaskInpaintChain(
  maskLayers: CanvasLayer[],
  callbacks: MaskInpaintChainCallbacks,
): Promise<MaskInpaintChainResult> {
  if (maskLayers.length === 0) {
    throw new Error("No visible mask layers for inpaint chain");
  }

  // Pre-filter layers that actually have drawn mask content
  const validLayers: Array<{ layer: CanvasLayer; maskCanvas: HTMLCanvasElement }> = [];
  for (const layer of maskLayers) {
    const layerCanvas = canvas.getLayerCanvas(layer.id);
    if (layerCanvas && maskCanvasHasContent(layerCanvas)) {
      validLayers.push({ layer, maskCanvas: layerCanvas });
    }
  }

  if (validLayers.length === 0) {
    throw new Error("No mask layers contain drawn content");
  }

  const totalSteps = validLayers.length;
  const baseParams = generation.toParams({ includeConditioningRegions: false });
  const facefixOnFinal = baseParams.facefix_enabled;

  let currentInputImage = generation.inputImage;
  let lastPromptId = "";
  let lastTempOutput = "";

  for (let i = 0; i < validLayers.length; i++) {
    const { layer, maskCanvas } = validLayers[i];
    const isFinalOutput = i === validLayers.length - 1;

    callbacks.onStep?.({
      index: i + 1,
      total: totalSteps,
      layerName: layer.name,
    });

    if (callbacks.shouldCancel?.()) {
      throw new Error("Mask inpaint chain cancelled");
    }

    // Prepare input image for this step
    if (i > 0 && lastTempOutput) {
      const inputBytes = await tempOutputToUploadBytes(lastTempOutput);
      const inputUpload = await uploadImageBytes(
        inputBytes,
        `mask_chain_input_${i}_${Date.now()}.png`,
      );
      currentInputImage = inputUpload.name;
    }

    // Render & upload this layer's mask
    const maskBytes = await renderMaskCanvasToPngBytes(maskCanvas);
    const maskUpload = await uploadImageBytes(
      maskBytes,
      `mask_chain_mask_${layer.id}_${Date.now()}.png`,
    );

    // Prompt composition: per-layer prompt override or augmentation
    let promptForStep = baseParams.positive_prompt;
    if (layer.prompt && layer.prompt.trim()) {
      promptForStep = `${promptForStep}, ${layer.prompt.trim()}`;
    }

    const stepParams: GenerationParams = {
      ...baseParams,
      mode: "inpainting",
      input_image: currentInputImage,
      mask_image: maskUpload.name,
      positive_prompt: promptForStep,
      denoise: layer.denoise ?? baseParams.denoise,
      differential_diffusion: generation.isAnima || generation.differentialDiffusion,
      facefix_enabled: isFinalOutput && facefixOnFinal,
    };

    const stepResult = await callbacks.submit(stepParams, {
      index: i + 1,
      total: totalSteps,
      layerName: layer.name,
      isFinalOutput,
    });

    callbacks.onWaitingForOutput?.();
    lastTempOutput = await waitForChainStepOutput(stepResult.promptId, isFinalOutput);
    lastPromptId = stepResult.promptId;
    progress.clearPromptOutput(stepResult.promptId);

    if (callbacks.shouldCancel?.()) {
      throw new Error("Mask inpaint chain cancelled");
    }
  }

  return {
    lastPromptId,
    stepCount: totalSteps,
    finalTempFilename: lastTempOutput,
  };
}
