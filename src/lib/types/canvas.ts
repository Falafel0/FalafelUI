// src/lib/types/canvas.ts
// Authoritative type definitions for MooshieUI Photoshop-Grade Layer System

export type CanvasLayerType = "raster" | "mask" | "regional" | "controlnet";

export type CanvasBlendMode =
  | "normal"
  | "multiply"
  | "screen"
  | "overlay"
  | "darken"
  | "lighten";

// Backward-compatible alias
export type CanvasLayerBlendMode = CanvasBlendMode;

export const CANVAS_BLEND_MODES: readonly CanvasBlendMode[] = [
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
] as const;

/**
 * Maps CanvasBlendMode to standard HTML5 Canvas 2D GlobalCompositeOperation
 */
export const BLEND_MODE_COMPOSITE_MAP: Record<CanvasBlendMode, GlobalCompositeOperation> = {
  normal: "source-over",
  multiply: "multiply",
  screen: "screen",
  overlay: "overlay",
  darken: "darken",
  lighten: "lighten",
};

/**
 * Maps CanvasBlendMode to CSS mix-blend-mode string for live DOM rendering
 */
export const BLEND_MODE_CSS_MAP: Record<CanvasBlendMode, string> = {
  normal: "normal",
  multiply: "multiply",
  screen: "screen",
  overlay: "overlay",
  darken: "darken",
  lighten: "lighten",
};

/**
 * Common base interface for all canvas layers
 */
export interface CanvasLayerBase {
  id: string;
  name: string;
  type: CanvasLayerType;
  visible: boolean;
  locked: boolean;
  opacity: number; // Clamped [0.0, 1.0]
  order: number; // 0-indexed stacking order: 0 = bottom-most, N-1 = top-most
  zIndex?: number; // Backward-compatible alias for order
  blendMode?: CanvasBlendMode;
}

/**
 * Raster layer: Standard bitmap image, drawing strokes, or imported images
 */
export interface RasterCanvasLayer extends CanvasLayerBase {
  type: "raster";
  canvasElement?: HTMLCanvasElement;
  thumbnail?: string; // Base64 data URL preview
  denoise?: number; // Img2img denoise strength [0.0, 1.0], default 1.0
  prompt?: string;
  x?: number; // Transformation offset X
  y?: number; // Transformation offset Y
  width?: number; // Bounding width
  height?: number; // Bounding height
  rotation?: number; // Rotation degrees [0, 360)
  scaleX?: number; // Scale factor X
  scaleY?: number; // Scale factor Y
}

/**
 * Mask layer: Binary or alpha mask linked to raster content for inpainting and erasing
 */
export interface MaskCanvasLayer extends CanvasLayerBase {
  type: "mask";
  linkedLayerId?: string; // ID of parent raster layer this mask clips/links to
  canvasElement?: HTMLCanvasElement;
  thumbnail?: string;
  inverted?: boolean; // Invert mask values (white <-> black), default false
  maskBlur?: number; // Gaussian blur feather radius in px [0, 64], default 0
  color?: string; // Visual mask tint hex code, default "#ff3333"
  denoise?: number; // Inpaint denoise strength [0.0, 1.0], default 0.7
  prompt?: string; // Dedicated prompt override for this mask region
}

/**
 * Regional Conditioning layer: Canvas sub-region with dedicated prompt and weight
 */
export interface RegionalCanvasLayer extends CanvasLayerBase {
  type: "regional";
  x: number; // Sub-region X: normalized [0.0, 1.0]
  y: number; // Sub-region Y: normalized [0.0, 1.0]
  width: number; // Sub-region width: normalized [0.0, 1.0]
  height: number; // Sub-region height: normalized [0.0, 1.0]
  prompt: string; // Dedicated positive regional prompt
  negativePrompt?: string; // Dedicated negative regional prompt
  weight: number; // Conditioning strength [0.0, 2.0], default 1.0
  color?: string; // Visual accent color for Konva region box
}

/**
 * ControlNet layer: Reference image layer configured with ControlNet model selector & strength
 */
export interface ControlNetCanvasLayer extends CanvasLayerBase {
  type: "controlnet";
  referenceImage?: string; // Base64 data URL, image URL, or ComfyUI upload name
  model: string; // ControlNet checkpoint filename (e.g. "canny.pth", "depth.pth")
  preprocessor: string; // Preprocessor name (e.g. "canny", "depth", "openpose", "none")
  strength: number; // Guidance strength [0.0, 2.0], default 1.0
  startPercent: number; // Start step fraction [0.0, 1.0], default 0.0
  endPercent: number; // End step fraction [0.0, 1.0], default 1.0
}

/**
 * Discriminated union of all supported canvas layers
 */
export type CanvasLayer =
  | RasterCanvasLayer
  | MaskCanvasLayer
  | RegionalCanvasLayer
  | ControlNetCanvasLayer;

// Type guards
export function isRasterLayer(layer: CanvasLayer): layer is RasterCanvasLayer {
  return layer.type === "raster";
}

export function isMaskLayer(layer: CanvasLayer): layer is MaskCanvasLayer {
  return layer.type === "mask";
}

export function isRegionalLayer(layer: CanvasLayer): layer is RegionalCanvasLayer {
  return layer.type === "regional";
}

export function isControlNetLayer(layer: CanvasLayer): layer is ControlNetCanvasLayer {
  return layer.type === "controlnet";
}

// Supporting UI state types
export interface SampledColorInfo {
  hex: string;
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface ActiveTransformBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  aspectLocked?: boolean;
}

export type ZoomToolMode = "in" | "out";
