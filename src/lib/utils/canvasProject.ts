import type { CanvasLayer, CanvasLayerBlendMode, CanvasLayerType } from "../stores/canvas.svelte.js";

export interface FalafelLayerData {
  id: string;
  name: string;
  type: CanvasLayerType;
  visible: boolean;
  opacity: number;
  locked: boolean;
  order: number;
  denoise?: number;
  prompt?: string;
  blendMode?: CanvasLayerBlendMode;
  dataUrl: string;
}

export interface FalafelProjectDocument {
  format: "falafel-canvas-project";
  version: 1;
  created_at: string;
  canvas: {
    width: number;
    height: number;
    positivePrompt?: string;
    negativePrompt?: string;
  };
  layers: FalafelLayerData[];
}

export function downloadJsonFile(data: unknown, filename: string): void {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

export function downloadCanvasImage(canvasEl: HTMLCanvasElement, filename: string): void {
  const url = canvasEl.toDataURL("image/png");
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
  }
}

export async function saveFalafelProject(
  layers: CanvasLayer[],
  layerDataUrls: Record<string, string>,
  width: number,
  height: number,
  positivePrompt?: string,
  negativePrompt?: string,
  filename?: string,
): Promise<void> {
  const projectLayers: FalafelLayerData[] = layers.map((layer) => ({
    id: layer.id,
    name: layer.name,
    type: layer.type,
    visible: layer.visible,
    opacity: layer.opacity,
    locked: layer.locked,
    order: layer.order,
    denoise: "denoise" in layer ? (layer as any).denoise : undefined,
    prompt: "prompt" in layer ? (layer as any).prompt : undefined,
    blendMode: layer.blendMode,
    dataUrl: layerDataUrls[layer.id] || "",
  }));

  const doc: FalafelProjectDocument = {
    format: "falafel-canvas-project",
    version: 1,
    created_at: new Date().toISOString(),
    canvas: {
      width,
      height,
      positivePrompt,
      negativePrompt,
    },
    layers: projectLayers,
  };

  const name = filename || `falafel_canvas_${Date.now()}.falafel`;
  downloadJsonFile(doc, name);
}

export async function loadFalafelProjectFile(file: File): Promise<FalafelProjectDocument> {
  const text = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Invalid project file: Not a valid JSON document");
  }

  const doc = parsed as FalafelProjectDocument;
  if (!doc || doc.format !== "falafel-canvas-project" || doc.version !== 1) {
    throw new Error("Invalid project file: Unsupported format or version");
  }

  if (!doc.canvas || typeof doc.canvas.width !== "number" || typeof doc.canvas.height !== "number") {
    throw new Error("Invalid project file: Missing or invalid canvas dimensions");
  }

  if (!Array.isArray(doc.layers)) {
    throw new Error("Invalid project file: Missing layers array");
  }

  return doc;
}
