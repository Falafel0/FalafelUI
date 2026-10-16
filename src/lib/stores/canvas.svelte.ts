import { uploadImageBytes } from "../utils/api.js";
import {
  saveFalafelProject,
  loadFalafelProjectFile,
  downloadCanvasImage,
  type FalafelProjectDocument,
} from "../utils/canvasProject.js";
import { generation } from "./generation.svelte.js";
import { locale } from "./locale.svelte.js";
import { getCropRegionV2, expandCropRegion, cropCanvas, type CropRegion } from "../utils/maskCrop.js";
import { gaussianBlurCanvas } from "../utils/maskBlur.js";
import { fillMaskedRegion } from "../utils/maskFill.js";
import { canvasHistory } from "./canvasHistory.svelte.js";
import type { GenerationMode } from "../types/index.js";

import type {
  CanvasBlendMode,
  CanvasLayerBlendMode,
  CanvasLayerType,
  CanvasLayerBase,
  RasterCanvasLayer,
  MaskCanvasLayer,
  RegionalCanvasLayer,
  ControlNetCanvasLayer,
  CanvasLayer,
  SampledColorInfo,
  ActiveTransformBounds,
  ZoomToolMode,
} from "../types/canvas.js";

export type {
  CanvasBlendMode,
  CanvasLayerBlendMode,
  CanvasLayerType,
  CanvasLayerBase,
  RasterCanvasLayer,
  MaskCanvasLayer,
  RegionalCanvasLayer,
  ControlNetCanvasLayer,
  CanvasLayer,
  SampledColorInfo,
  ActiveTransformBounds,
  ZoomToolMode,
};
export {
  CANVAS_BLEND_MODES,
  BLEND_MODE_COMPOSITE_MAP,
  BLEND_MODE_CSS_MAP,
  isRasterLayer,
  isMaskLayer,
  isRegionalLayer,
  isControlNetLayer,
} from "../types/canvas.js";

export type ToolType =
  | "brush"
  | "eraser"
  | "rectFill"
  | "lasso"
  | "eyedropper"
  | "move"
  | "view"
  | "transform"
  | "zoom";

export type UnifiedCanvasAction = "txt2img" | "img2img" | "inpaint" | "outpaint" | "upscale";

export interface BrushSettings {
  size: number;
  opacity: number;
  hardness: number;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
  locked: boolean;
}

export type StagingCompareMode = "overlay" | "split" | "original";

export interface CanvasStagedCandidate {
  url: string;
  owned: boolean;
  width: number;
  height: number;
  bounds?: { x: number; y: number; width: number; height: number };
}

export interface CanvasStagingEntry {
  url: string;
  owned: boolean;
}

export interface InpaintBaseSnapshot {
  previewUrl: string | null;
  uploadedInputName: string | null;
  width: number;
  height: number;
  maskSnapshotUrl: string | null;
  owned: boolean;
}

export interface CanvasViewport {
  zoom: number;
  panX: number;
  panY: number;
}

export interface TransformState {
  isMoving: boolean;
  targetLayerId: string | null;
  startX: number;
  startY: number;
  deltaX: number;
  deltaY: number;
}

let nextLayerId = 0;
function genLayerId(): string {
  return `layer_${++nextLayerId}`;
}

class CanvasStore {
  // Tool state
  activeTool = $state<ToolType>("brush");
  previousTool = $state<ToolType | null>(null);
  brushSettings = $state<BrushSettings>({ size: 20, opacity: 1, hardness: 0.8 });
  foregroundColor = $state("#ffffff");
  backgroundColor = $state("#000000");

  // Eyedropper sampled color info
  sampledColor = $state<SampledColorInfo | null>(null);

  // Active transform bounds
  activeTransformBounds = $state<ActiveTransformBounds | null>(null);

  // Quick mask mode
  quickMaskMode = $state(false);

  // Zoom tool sub-mode
  zoomToolMode = $state<ZoomToolMode>("in");

  // Layers
  layers = $state<CanvasLayer[]>([]);
  activeLayerId = $state<string | null>(null);

  // Per-layer pixel thumbnails (data URLs), keyed by layer id
  layerThumbnails = $state<Record<string, string>>({});

  // Canvas document dimensions
  canvasWidth = $state(1024);
  canvasHeight = $state(1024);

  // Viewport
  viewport = $state<CanvasViewport>({ zoom: 1, panX: 0, panY: 0 });

  // Bounding box (generation region)
  boundingBox = $state<BoundingBox>({ x: 0, y: 0, width: 1024, height: 1024, locked: false });

  // Mask overlay
  maskOverlayColor = $state("#ff3333");
  maskOverlayOpacity = $state(0.45);
  maskOverlayVisible = $state(true);

  // UI state
  isCanvasMode = $state(true);
  isPointerOverStage = $state(false);
  inpaintDrawMode = $state<"mask" | "regular">("regular");
  showGrid = $state(false);
  showRuleOfThirds = $state(false);
  showCheckerboard = $state(true);
  cursorPos = $state<{ x: number; y: number } | null>(null);
  referenceImageUrl = $state<string | null>(null);
  showingOriginal = $state(false);
  originalInpaintInputImageName = $state<string | null>(null);
  originalInpaintWidth = $state<number | null>(null);
  originalInpaintHeight = $state<number | null>(null);
  preparedInpaintPreviewUrl = $state<string | null>(null);
  preparedInpaintOwned = $state(false);
  inpaintSourceVersion = $state(0);
  persistedMaskPreviewUrl = $state<string | null>(null);
  // Base-image undo history for iterative inpainting. Each entry is a base that
  // was inpainted plus the mask that was applied to it, so the user can step
  // back and so the same mask can be re-hydrated onto the incoming result.
  inpaintBaseHistory = $state<InpaintBaseSnapshot[]>([]);
  // A tinted mask snapshot waiting to be re-hydrated onto the freshly-rebuilt
  // mask layer after a base swap (consumed by CanvasStage).
  pendingMaskRestoreUrl = $state<string | null>(null);
  // The latest inpaint result, held for DISPLAY ONLY. Pressing "Generate" always
  // re-rolls the current base + mask (never this result); it is only shown as the
  // canvas background so the user can preview it. "Apply" promotes it to the base.
  pendingResultPreviewUrl = $state<string | null>(null);
  pendingResultOwned = $state(false);
  pendingResultInputName = $state<string | null>(null);
  pendingResultWidth = $state<number | null>(null);
  pendingResultHeight = $state<number | null>(null);
  // While a finished inpaint result is being previewed, the editable mask strokes
  // are hidden so the clean result is visible. This flips true once the user starts
  // painting more mask, bringing the mask back so they can see what they're editing.
  maskEditedSinceResult = $state(false);

  // Mask upscale/downscale
  maskUpscaleFactor = $state(1);
  _preUpscaleCanvasWidth: number | null = null;
  _preUpscaleCanvasHeight: number | null = null;

  // Inpainting settings (Forge-style)
  inpaintFullRes = $state(true);
  inpaintFullResPadding = $state(32);
  maskBlur = $state(0);
  inpaintMaskInvert = $state(false);
  inpaintingFill = $state(1);

  _maskRestorePending = $state<{
    maskUrl: string | null;
    rasterUrl: string | null;
    scale: number;
    restoreOriginal: boolean;
    savedLayers?: Array<{ name: string; type: string; visible: boolean; opacity: number; locked: boolean; denoise: number }>;
  } | null>(null);

  _pendingPaste = $state<{
    x: number;
    y: number;
    width: number;
    height: number;
    originalUrl: string;
  } | null>(null);

  _preCropGenDims: { width: number; height: number } | null = null;

  get isCanvasUpscaled(): boolean {
    return this.maskUpscaleFactor > 1;
  }

  get hasPendingPaste(): boolean {
    return this._pendingPaste !== null;
  }

  // Staging
  stagedCandidate = $state<CanvasStagedCandidate | null>(null);
  stagingImages = $state<CanvasStagingEntry[]>([]);
  stagingIndex = $state(0);
  isStagingActive = $state(false);

  // Staging comparison & inspection controls
  stagingOpacity = $state(1.0);
  stagingCompareMode = $state<StagingCompareMode>("overlay");
  stagingSplitRatio = $state(0.5);
  stagingShowOriginal = $state(false);

  constructor() {
    canvasHistory.connectCanvasStore(this);
  }

  // Move/transform
  transform = $state<TransformState>({
    isMoving: false,
    targetLayerId: null,
    startX: 0,
    startY: 0,
    deltaX: 0,
    deltaY: 0,
  });

  // Reference to the Konva stage (set by CanvasStage)
  private _stageRef: any = null;
  private _stageOps: {
    mergeDown?: (id: string) => Promise<boolean>;
    flatten?: () => Promise<boolean>;
    duplicateLayer?: (sourceId: string, newId: string) => Promise<boolean>;
    applyInpaintAsLayer?: () => Promise<boolean>;
    acceptStagingToLayer?: (asNewLayer: boolean) => Promise<boolean>;
    acceptCandidateAsMask?: (url: string) => Promise<boolean>;
    reorderStageLayers?: () => void;
    syncKonvaLayers?: () => void;
    getLayerDataUrls?: () => Promise<Record<string, string>>;
    loadLayersFromProject?: (project: FalafelProjectDocument) => Promise<void>;
    invertMask?: () => boolean;
    commitTransform?: () => void;
    cancelTransform?: () => void;
    getRasterComposite?: () => HTMLCanvasElement | null;
    getMaskCanvas?: () => HTMLCanvasElement | null;
    getLayerCanvas?: (layerId: string) => HTMLCanvasElement | null;
    setTransformBounds?: (bounds: ActiveTransformBounds) => void;
  } = {};

  setStageRef(stage: any) {
    this._stageRef = stage;
  }

  getStageRef(): any {
    return this._stageRef;
  }

  registerStageOps(ops: {
    mergeDown?: (id: string) => Promise<boolean>;
    flatten?: () => Promise<boolean>;
    duplicateLayer?: (sourceId: string, newId: string) => Promise<boolean>;
    applyInpaintAsLayer?: () => Promise<boolean>;
    acceptStagingToLayer?: (asNewLayer: boolean) => Promise<boolean>;
    acceptCandidateAsMask?: (url: string) => Promise<boolean>;
    reorderStageLayers?: () => void;
    syncKonvaLayers?: () => void;
    getLayerDataUrls?: () => Promise<Record<string, string>>;
    loadLayersFromProject?: (project: FalafelProjectDocument) => Promise<void>;
    invertMask?: () => boolean;
    commitTransform?: () => void;
    cancelTransform?: () => void;
    getRasterComposite?: () => HTMLCanvasElement | null;
    getMaskCanvas?: () => HTMLCanvasElement | null;
    getLayerCanvas?: (layerId: string) => HTMLCanvasElement | null;
    setTransformBounds?: (bounds: ActiveTransformBounds) => void;
  }) {
    this._stageOps = { ...this._stageOps, ...ops };
  }

  async exportProject(filename?: string): Promise<void> {
    if (!this._stageOps.getLayerDataUrls) return;
    const urls = await this._stageOps.getLayerDataUrls();
    await saveFalafelProject(
      this.layers,
      urls,
      this.canvasWidth,
      this.canvasHeight,
      generation.positivePrompt,
      generation.negativePrompt,
      filename
    );
  }

  async importProject(file: File): Promise<void> {
    if (!this._stageOps.loadLayersFromProject) return;
    const doc = await loadFalafelProjectFile(file);
    await this._stageOps.loadLayersFromProject(doc);
  }

  exportCompositePng(filename?: string): void {
    const composite = this._stageOps.getRasterComposite?.();
    if (!composite) return;
    downloadCanvasImage(composite, filename || `canvas_composite_${Date.now()}.png`);
  }

  exportMaskPng(filename?: string): void {
    const mask = this._stageOps.getMaskCanvas?.();
    if (!mask) return;
    downloadCanvasImage(mask, filename || `canvas_mask_${Date.now()}.png`);
  }

  invertMask(): boolean {
    return this._stageOps.invertMask?.() ?? false;
  }

  commitTransform(): void {
    this._stageOps.commitTransform?.();
  }

  cancelTransform(): void {
    this._stageOps.cancelTransform?.();
  }

  // Derived
  get activeLayer(): CanvasLayer | null {
    return this.layers.find((l) => l.id === this.activeLayerId) ?? null;
  }

  getActiveLayer(): CanvasLayer | null {
    return this.activeLayer;
  }

  get candidate(): CanvasStagedCandidate | null {
    if (this.stagedCandidate) return this.stagedCandidate;
    const current = this.stagingImages[this.stagingIndex];
    if (current) {
      return {
        url: current.url,
        owned: current.owned,
        width: this.canvasWidth,
        height: this.canvasHeight,
        bounds: this.boundingBox ? { ...this.boundingBox } : undefined,
      };
    }
    return null;
  }

  get visibleLayers(): CanvasLayer[] {
    return this.layers.filter((l) => l.visible).sort((a, b) => a.order - b.order);
  }

  get sortedLayers(): CanvasLayer[] {
    return [...this.layers].sort((a, b) => b.order - a.order);
  }

  get zoomPercent(): number {
    return Math.round(this.viewport.zoom * 100);
  }

  // Colors
  swapColors() {
    const tmp = this.foregroundColor;
    this.foregroundColor = this.backgroundColor;
    this.backgroundColor = tmp;
  }

  resetColors() {
    this.foregroundColor = "#ffffff";
    this.backgroundColor = "#000000";
  }

  // Tools
  setTool(tool: ToolType) {
    if (tool !== this.activeTool) {
      this.previousTool = this.activeTool;
      this.activeTool = tool;
    }
  }

  restorePreviousTool() {
    if (this.previousTool) {
      this.activeTool = this.previousTool;
      this.previousTool = null;
    }
  }

  beginMove(layerId: string, startX: number, startY: number) {
    this.transform = {
      isMoving: true,
      targetLayerId: layerId,
      startX,
      startY,
      deltaX: 0,
      deltaY: 0,
    };
  }

  updateMove(currentX: number, currentY: number) {
    if (!this.transform.isMoving) return;
    this.transform = {
      ...this.transform,
      deltaX: currentX - this.transform.startX,
      deltaY: currentY - this.transform.startY,
    };
  }

  endMove() {
    this.transform = {
      isMoving: false,
      targetLayerId: null,
      startX: 0,
      startY: 0,
      deltaX: 0,
      deltaY: 0,
    };
  }

  private revokeOwnedUrls(urls: string[]) {
    const seen = new Set<string>();
    for (const url of urls) {
      if (!url || seen.has(url)) continue;
      seen.add(url);
      URL.revokeObjectURL(url);
    }
  }

  private clearPreparedInpaintOverride() {
    if (this.preparedInpaintOwned && this.preparedInpaintPreviewUrl) {
      URL.revokeObjectURL(this.preparedInpaintPreviewUrl);
    }
    this.preparedInpaintPreviewUrl = null;
    this.preparedInpaintOwned = false;
  }

  // Discard the display-only pending inpaint result, revoking its owned URL.
  private clearPendingInpaintResult() {
    if (this.pendingResultOwned && this.pendingResultPreviewUrl) {
      URL.revokeObjectURL(this.pendingResultPreviewUrl);
    }
    this.pendingResultPreviewUrl = null;
    this.pendingResultOwned = false;
    this.pendingResultInputName = null;
    this.pendingResultWidth = null;
    this.pendingResultHeight = null;
    this.maskEditedSinceResult = false;
  }

  setInpaintOriginalSource(source: {
    previewUrl: string;
    width: number;
    height: number;
    uploadedInputName: string | null;
  } | null) {
    this.clearPreparedInpaintOverride();
    this.clearPendingInpaintResult();
    this.clearInpaintBaseHistory();
    this.inpaintSourceVersion += 1;

    if (!source) {
      this.originalInpaintInputImageName = null;
      this.originalInpaintWidth = null;
      this.originalInpaintHeight = null;
      this.referenceImageUrl = null;
      return;
    }

    this.referenceImageUrl = source.previewUrl;
    this.originalInpaintInputImageName = source.uploadedInputName;
    this.originalInpaintWidth = source.width;
    this.originalInpaintHeight = source.height;
    generation.inputImage = source.uploadedInputName;
    generation.width = source.width;
    generation.height = source.height;
    this.clearMask();
    this.initCanvas(source.width, source.height);
  }

  private _maskSyncInFlight: Promise<boolean> | null = null;

  private pushInpaintBaseSnapshot(snapshot: InpaintBaseSnapshot) {
    const history = [...this.inpaintBaseHistory, snapshot];
    if (history.length > 64) {
      const evicted = history.shift();
      if (evicted?.owned && evicted.previewUrl) URL.revokeObjectURL(evicted.previewUrl);
    }
    this.inpaintBaseHistory = history;
  }

  setPreparedInpaintOverride(source: {
    previewUrl: string;
    width: number;
    height: number;
    uploadedInputName: string | null;
    owned: boolean;
  }) {
    // Swapping to an explicit new base discards any display-only pending result.
    this.clearPendingInpaintResult();
    // Snapshot the outgoing base and the mask applied to it so the user can undo
    // back to it, and so the same mask can be re-hydrated onto the incoming
    // result (letting "Generate" re-roll the same region without repainting).
    const outgoingMask = this.snapshotInpaintMask();
    this.pushInpaintBaseSnapshot({
      previewUrl: this.preparedInpaintPreviewUrl ?? this.referenceImageUrl,
      uploadedInputName: generation.inputImage,
      width: generation.width,
      height: generation.height,
      maskSnapshotUrl: outgoingMask,
      // Only a prepared preview is an owned object URL; the session-original
      // referenceImageUrl is owned elsewhere and must not be revoked here.
      owned: this.preparedInpaintPreviewUrl ? this.preparedInpaintOwned : false,
    });

    // Swap in the new base. Do NOT revoke the outgoing prepared URL: the history
    // entry above now owns it.
    this.preparedInpaintPreviewUrl = source.previewUrl;
    this.preparedInpaintOwned = source.owned;
    generation.inputImage = source.uploadedInputName;
    generation.width = source.width;
    generation.height = source.height;

    // Rebuild layers for the new base, then re-hydrate the mask onto the fresh
    // mask layer. Clear the persisted (non-editable) overlay so the mask isn't
    // drawn twice.
    this.persistedMaskPreviewUrl = null;
    this.initCanvas(source.width, source.height);
    this.pendingMaskRestoreUrl = outgoingMask;
  }

  // Called on inpaint completion. Holds the result for DISPLAY ONLY: it becomes
  // the canvas background so the user can preview it, but the generation base
  // (generation.inputImage) and the editable mask are left untouched, so the next
  // "Generate" re-rolls the ORIGINAL base + mask instead of iterating on the
  // result. Promoting the result to the base is an explicit "Apply" action.
  setPendingInpaintResult(source: {
    previewUrl: string;
    width: number;
    height: number;
    uploadedInputName: string | null;
    owned: boolean;
  }) {
    // A superseded re-roll: revoke the previous pending preview before replacing.
    this.clearPendingInpaintResult();
    this.pendingResultPreviewUrl = source.previewUrl;
    this.pendingResultOwned = source.owned;
    this.pendingResultInputName = source.uploadedInputName;
    this.pendingResultWidth = source.width;
    this.pendingResultHeight = source.height;
  }

  // Promote the pending inpaint result to be the new base: checkpoint the current
  // base + its mask for undo, adopt the result as the base, then start a fresh
  // mask on top. Ownership of the pending preview URL transfers to the prepared
  // override (so it is NOT revoked here).
  applyInpaintResult() {
    if (!this.pendingResultPreviewUrl || this.pendingResultWidth == null || this.pendingResultHeight == null) {
      return;
    }

    const outgoingMask = this.snapshotInpaintMask();
    this.pushInpaintBaseSnapshot({
      previewUrl: this.preparedInpaintPreviewUrl ?? this.referenceImageUrl,
      uploadedInputName: generation.inputImage,
      width: generation.width,
      height: generation.height,
      maskSnapshotUrl: outgoingMask,
      // Only a prepared preview is an owned object URL; the session-original
      // referenceImageUrl is owned elsewhere and must not be revoked here.
      owned: this.preparedInpaintPreviewUrl ? this.preparedInpaintOwned : false,
    });

    // Transfer the pending result into the prepared override. Do NOT revoke the
    // pending URL: the prepared override now owns it. Do NOT revoke the outgoing
    // prepared URL either: the history entry above now owns it.
    this.preparedInpaintPreviewUrl = this.pendingResultPreviewUrl;
    this.preparedInpaintOwned = this.pendingResultOwned;
    generation.inputImage = this.pendingResultInputName;
    generation.width = this.pendingResultWidth;
    generation.height = this.pendingResultHeight;

    // Clear pending WITHOUT revoking (ownership was transferred above).
    this.pendingResultPreviewUrl = null;
    this.pendingResultOwned = false;
    this.pendingResultInputName = null;
    this.pendingResultWidth = null;
    this.pendingResultHeight = null;

    // Fresh mask on the new base. Only clear Konva children if the stage is
    // mounted; if the canvas panel is closed, the next initCanvas call will
    // rebuild layers from scratch anyway.
    this.persistedMaskPreviewUrl = null;
    if (this._stageRef) {
      this.clearMask();
    }
    this.initCanvas(generation.width, generation.height);
  }

  async applyInpaintAsLayer(): Promise<boolean> {
    if (this._stageOps.applyInpaintAsLayer) {
      return await this._stageOps.applyInpaintAsLayer();
    }
    return false;
  }

  consumePendingInpaintResult() {
    this.clearPendingInpaintResult();
    this.clearMask();
  }

  toggleShowOriginal() {
    this.showingOriginal = !this.showingOriginal;
  }

  get canApplyInpaintResult(): boolean {
    return generation.mode === "inpainting" && this.pendingResultPreviewUrl !== null;
  }

  // Called by the canvas when the user paints/edits the mask. While a pending
  // inpaint result is on screen the mask is hidden; this brings it back so the
  // user can see the region they're adding to.
  markMaskEdited() {
    if (this.pendingResultPreviewUrl && !this.maskEditedSinceResult) {
      this.maskEditedSinceResult = true;
    }
  }

  // Whether the editable inpaint mask strokes should be hidden on the canvas. True
  // only while a finished result is being previewed and the user is not painting
  // more mask. The caller additionally keeps the mask visible during a re-roll
  // (via progress.isGenerating), which the store deliberately does not know about.
  get shouldHideInpaintMask(): boolean {
    return (
      generation.mode === "inpainting" &&
      this.pendingResultPreviewUrl !== null &&
      !this.maskEditedSinceResult
    );
  }

  restoreOriginalInpaintSource() {
    if (!this.originalInpaintInputImageName || this.originalInpaintWidth == null || this.originalInpaintHeight == null) {
      return;
    }
    this.clearPreparedInpaintOverride();
    this.clearPendingInpaintResult();
    this.clearInpaintBaseHistory();
    this.pendingMaskRestoreUrl = null;
    this.persistedMaskPreviewUrl = null;
    this._pendingPaste = null;
    this._preCropGenDims = null;
    this.resetMaskScale();
    generation.inputImage = this.originalInpaintInputImageName;
    generation.width = this.originalInpaintWidth;
    generation.height = this.originalInpaintHeight;
    this.clearMask();
    this.initCanvas(this.originalInpaintWidth, this.originalInpaintHeight);
  }

  clearInpaintSession() {
    this.clearMask();
    this.clearPreparedInpaintOverride();
    this.clearPendingInpaintResult();
    this.clearInpaintBaseHistory();
    this.inpaintSourceVersion += 1;
    this.originalInpaintInputImageName = null;
    this.originalInpaintWidth = null;
    this.originalInpaintHeight = null;
    this.referenceImageUrl = null;
    this.inpaintDrawMode = "regular";
    this.persistedMaskPreviewUrl = null;
    this.pendingMaskRestoreUrl = null;
    this._pendingPaste = null;
    this._preCropGenDims = null;
    this.resetMaskScale();
  }

  private clearInpaintBaseHistory() {
    for (const entry of this.inpaintBaseHistory) {
      if (entry.owned && entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
    }
    this.inpaintBaseHistory = [];
  }

  // Step the inpaint base back to the previous image, re-applying the mask that
  // was on it. The current (discarded) prepared preview is revoked.
  undoInpaintBase() {
    if (!this.inpaintBaseHistory.length) return;

    // Stepping back discards any un-applied result being previewed.
    this.clearPendingInpaintResult();

    const entry = this.inpaintBaseHistory[this.inpaintBaseHistory.length - 1];
    this.inpaintBaseHistory = this.inpaintBaseHistory.slice(0, -1);

    // Discard the base we're leaving (the current prepared override, if any).
    if (this.preparedInpaintOwned && this.preparedInpaintPreviewUrl) {
      URL.revokeObjectURL(this.preparedInpaintPreviewUrl);
    }

    if (entry.previewUrl && entry.previewUrl === this.referenceImageUrl) {
      // Stepping back to the session original: no prepared override.
      this.preparedInpaintPreviewUrl = null;
      this.preparedInpaintOwned = false;
    } else {
      this.preparedInpaintPreviewUrl = entry.previewUrl;
      this.preparedInpaintOwned = entry.owned;
    }

    generation.inputImage = entry.uploadedInputName;
    generation.width = entry.width;
    generation.height = entry.height;

    this.persistedMaskPreviewUrl = null;
    this.initCanvas(entry.width, entry.height);
    this.pendingMaskRestoreUrl = entry.maskSnapshotUrl;
  }

  get canUndoInpaintBase(): boolean {
    return generation.mode === "inpainting" && this.inpaintBaseHistory.length > 0;
  }

  get currentPreparedInputImage(): string | null {
    if (generation.mode === "inpainting") {
      return this.preparedInpaintPreviewUrl;
    }
    return this.currentStagingImage;
  }

  get hasResettableInpaintSource(): boolean {
    return generation.mode === "inpainting" && !!this.referenceImageUrl && !!this.originalInpaintInputImageName;
  }

  get resettableInpaintPreviewImage(): string | null {
    if (generation.mode === "inpainting") {
      return this.preparedInpaintPreviewUrl ?? this.referenceImageUrl;
    }
    return this.currentStagingImage;
  }

  clearPreparedInputs() {
    if (generation.mode === "inpainting" && this.hasResettableInpaintSource) {
      this.restoreOriginalInpaintSource();
      return;
    }
    this.clearStaging();
  }

  dismissPreparedInput() {
    if (generation.mode === "inpainting" && this.currentPreparedInputImage) {
      this.restoreOriginalInpaintSource();
      return;
    }
    this.dismissCurrentStaging();
  }

  stageResult(
    url: string,
    width?: number,
    height?: number,
    bounds?: { x: number; y: number; width: number; height: number },
    options?: { owned?: boolean }
  ) {
    if (url === undefined || url === null) return;
    const candidate: CanvasStagedCandidate = {
      url,
      owned: options?.owned ?? true,
      width: width ?? this.canvasWidth,
      height: height ?? this.canvasHeight,
      bounds: bounds ?? (this.boundingBox ? { ...this.boundingBox } : undefined),
    };

    this.stagedCandidate = candidate;
    if (url !== "") {
      if (!this.stagingImages.some((e) => e.url === url)) {
        this.stagingImages = [
          ...this.stagingImages,
          {
            url,
            owned: candidate.owned,
          },
        ];
      }
      this.stagingIndex = this.stagingImages.length - 1;
    }
    this.isStagingActive = true;
    this.stagingOpacity = 1.0;
    this.stagingShowOriginal = false;
    this.stagingCompareMode = "overlay";
  }

  stageImage(url: string, options?: { owned?: boolean; width?: number; height?: number; bounds?: any }) {
    if (!url) {
      if (url === "") {
        this.stagedCandidate = { url: "", owned: false, width: this.canvasWidth, height: this.canvasHeight };
      }
      return;
    }
    this.stageResult(url, options?.width, options?.height, options?.bounds, options);
  }

  stageBlob(blob: Blob) {
    this.stageImage(URL.createObjectURL(blob), { owned: true });
  }

  clearStaging() {
    for (const entry of this.stagingImages) {
      if (entry.owned && entry.url.startsWith("blob:")) URL.revokeObjectURL(entry.url);
    }
    if (this.stagedCandidate?.owned && this.stagedCandidate.url.startsWith("blob:")) {
      URL.revokeObjectURL(this.stagedCandidate.url);
    }
    this.stagedCandidate = null;
    this.stagingImages = [];
    this.stagingIndex = 0;
    this.isStagingActive = false;
    this.stagingOpacity = 1.0;
    this.stagingShowOriginal = false;
    this.stagingCompareMode = "overlay";
  }

  discard() {
    this.clearStaging();
  }

  discardStaging() {
    this.discard();
  }

  nextStaging() {
    if (!this.stagingImages.length) return;
    this.stagingIndex = (this.stagingIndex + 1) % this.stagingImages.length;
    const current = this.stagingImages[this.stagingIndex];
    if (current) {
      this.stagedCandidate = {
        url: current.url,
        owned: current.owned,
        width: this.canvasWidth,
        height: this.canvasHeight,
        bounds: this.boundingBox ? { ...this.boundingBox } : undefined,
      };
    }
  }

  prevStaging() {
    if (!this.stagingImages.length) return;
    this.stagingIndex = (this.stagingIndex - 1 + this.stagingImages.length) % this.stagingImages.length;
    const current = this.stagingImages[this.stagingIndex];
    if (current) {
      this.stagedCandidate = {
        url: current.url,
        owned: current.owned,
        width: this.canvasWidth,
        height: this.canvasHeight,
        bounds: this.boundingBox ? { ...this.boundingBox } : undefined,
      };
    }
  }

  dismissCurrentStaging() {
    if (!this.stagingImages.length) {
      this.clearStaging();
      return;
    }
    const current = this.stagingImages[this.stagingIndex];
    if (current?.owned && current.url.startsWith("blob:")) URL.revokeObjectURL(current.url);
    this.stagingImages = this.stagingImages.filter((_, index) => index !== this.stagingIndex);

    if (!this.stagingImages.length) {
      this.clearStaging();
      return;
    }

    if (this.stagingIndex >= this.stagingImages.length) {
      this.stagingIndex = this.stagingImages.length - 1;
    }
    const nextEntry = this.stagingImages[this.stagingIndex];
    if (nextEntry) {
      this.stagedCandidate = {
        url: nextEntry.url,
        owned: nextEntry.owned,
        width: this.canvasWidth,
        height: this.canvasHeight,
        bounds: this.boundingBox ? { ...this.boundingBox } : undefined,
      };
    }
    this.isStagingActive = true;
  }

  get currentStagingImage(): string | null {
    if (!this.stagingImages.length) return null;
    return this.stagingImages[this.stagingIndex]?.url ?? null;
  }

  get effectiveReferenceImage(): string | null {
    if (this.showingOriginal) {
      return this.referenceImageUrl;
    }
    if (generation.mode === "inpainting") {
      // A just-generated result is previewed as the background; below it the base
      // override (or session original) shows through until the user applies/undoes.
      if (this.pendingResultPreviewUrl) return this.pendingResultPreviewUrl;
      if (this.preparedInpaintPreviewUrl) return this.preparedInpaintPreviewUrl;
    }
    return this.currentStagingImage ?? this.referenceImageUrl;
  }

  setReferenceImage(url: string | null) {
    this.referenceImageUrl = url;
  }

  setPersistedMaskPreview(url: string | null) {
    this.persistedMaskPreviewUrl = url;
  }

  clearMask() {
    generation.maskImage = null;
    this.persistedMaskPreviewUrl = null;

    for (const layerMeta of this.layers.filter((l) => l.type === "mask")) {
      this.clearLayerThumbnail(layerMeta.id);
      delete this.layerThumbnails[layerMeta.id];
    }

    if (!this._stageRef) return;
    const stageLayers = this._stageRef.getLayers?.() ?? [];
    for (const layerMeta of this.layers.filter((l) => l.type === "mask")) {
      const layer = stageLayers.find((l: any) => l.id?.() === layerMeta.id);
      layer?.destroyChildren?.();
      layer?.batchDraw?.();
    }
  }

  // Composite the editable inpaint mask layer(s) into a tinted, transparent-bg
  // data URL so the mask survives a base swap (layers are rebuilt on swap).
  // Returns null when there is no mask layer or the mask is empty.
  snapshotInpaintMask(): string | null {
    const stage = this._stageRef;
    if (!stage) return null;

    const maskMetas = this.layers.filter((l) => l.type === "mask");
    if (!maskMetas.length) return null;

    const stageLayers = stage.getLayers?.() ?? [];
    const offscreen = document.createElement("canvas");
    offscreen.width = this.canvasWidth;
    offscreen.height = this.canvasHeight;
    const ctx = offscreen.getContext("2d");
    if (!ctx) return null;

    let drew = false;
    for (const meta of maskMetas) {
      const layer = stageLayers.find((l: any) => l.id?.() === meta.id);
      if (!layer) continue;

      // The viewport is applied as a layer transform; reset it so the snapshot
      // captures canvas-space pixels, then restore it.
      // Force layer visible so Konva's toCanvas returns actual mask content even
      // when the mask is hidden while a pending result is on screen.
      const origScaleX = layer.scaleX();
      const origScaleY = layer.scaleY();
      const origX = layer.x();
      const origY = layer.y();
      const origVisible = layer.visible();
      layer.scaleX(1);
      layer.scaleY(1);
      layer.x(0);
      layer.y(0);
      layer.visible(true);
      try {
        const layerCanvas = layer.toCanvas({
          pixelRatio: 1,
          width: this.canvasWidth,
          height: this.canvasHeight,
        });
        ctx.drawImage(layerCanvas, 0, 0);
        drew = true;
      } catch (error) {
        console.error("Failed to snapshot inpaint mask:", error);
      } finally {
        layer.scaleX(origScaleX);
        layer.scaleY(origScaleY);
        layer.x(origX);
        layer.y(origY);
        layer.visible(origVisible);
      }
    }

    if (!drew) return null;

    // Skip blank masks so undo never restores an empty mask.
    const data = ctx.getImageData(0, 0, offscreen.width, offscreen.height).data;
    let hasPixels = false;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > 0) {
        hasPixels = true;
        break;
      }
    }
    if (!hasPixels) return null;

    return offscreen.toDataURL("image/png");
  }

  setInpaintDrawMode(mode: "mask" | "regular") {
    this.inpaintDrawMode = mode;
    if (mode === "mask") {
      const maskLayer = this.layers.find((l) => l.type === "mask");
      if (maskLayer && this.activeLayerId !== maskLayer.id) {
        this.activeLayerId = maskLayer.id;
      }
    } else {
      const active = this.layers.find((l) => l.id === this.activeLayerId);
      if (active?.type === "mask") {
        const rasterLayer = this.layers.find((l) => l.type === "raster");
        if (rasterLayer) {
          this.activeLayerId = rasterLayer.id;
        }
      }
    }
  }

  sendActiveLayerToMask(): boolean {
    if (!this._stageRef || !this.activeLayerId) return false;

    const sourceLayerMeta = this.layers.find((l) => l.id === this.activeLayerId);
    if (!sourceLayerMeta) return false;

    let maskLayerMeta = this.layers.find((l): l is MaskCanvasLayer => l.type === "mask");
    if (!maskLayerMeta) {
      const newId = this.addLayer("mask", locale.t("canvas.layer.inpaint_mask"));
      maskLayerMeta = this.layers.find((l): l is MaskCanvasLayer => l.id === newId) ?? undefined;
    }
    if (!maskLayerMeta) return false;

    if (sourceLayerMeta.id === maskLayerMeta.id) {
      this.activeLayerId = maskLayerMeta.id;
      this.inpaintDrawMode = "mask";
      return true;
    }

    const stageLayers = this._stageRef.getLayers?.() ?? [];
    const sourceLayer = stageLayers.find((layer: any) => layer.id?.() === sourceLayerMeta.id);
    const maskLayer = stageLayers.find((layer: any) => layer.id?.() === maskLayerMeta.id);
    if (!sourceLayer || !maskLayer) return false;

    const sourceNodes = sourceLayer.getChildren?.() ?? [];
    if (!sourceNodes.length) return false;

    for (const node of sourceNodes) {
      const gco = node.globalCompositeOperation?.();
      if (gco === "destination-out") continue;

      const clone = node.clone?.();
      if (!clone) continue;

      clone.globalCompositeOperation?.("source-over");
      clone.opacity?.(1);

      if (clone.stroke && typeof clone.stroke === "function") {
        clone.stroke(this.maskOverlayColor);
      }
      if (clone.fill && typeof clone.fill === "function") {
        clone.fill(this.maskOverlayColor);
      }

      maskLayer.add(clone);
    }

    sourceLayer.destroyChildren?.();
    sourceLayer.batchDraw?.();
    maskLayer.batchDraw?.();

    this.activeLayerId = maskLayerMeta.id;
    this.inpaintDrawMode = "mask";
    if (this._stageOps.getMaskCanvas) {
      const maskCanvas = this._stageOps.getMaskCanvas();
      void this.syncMaskToGeneration(maskCanvas, false);
    }
    return true;
  }

  // Brush
  adjustBrushSize(delta: number) {
    this.brushSettings = {
      ...this.brushSettings,
      size: Math.max(1, Math.min(500, this.brushSettings.size + delta)),
    };
  }

  setBrushHardness(hardness: number) {
    const clamped = Math.max(0.0, Math.min(1.0, Number.isFinite(hardness) ? hardness : 0.8));
    this.brushSettings = {
      ...this.brushSettings,
      hardness: clamped,
    };
  }

  adjustBrushHardness(delta: number) {
    this.setBrushHardness(this.brushSettings.hardness + delta);
  }

  // Layers
  addLayer(
    type: CanvasLayerType = "raster",
    name?: string,
    extraProps: Partial<CanvasLayer> = {}
  ): string {
    const id = genLayerId();
    const maxOrder = this.layers.reduce((max, l) => Math.max(max, l.order), -1);
    const nextOrder = maxOrder + 1;

    let layerName = name;
    if (!layerName) {
      switch (type) {
        case "mask":
          layerName = locale.t("canvas.layer.inpaint_mask") || "Inpaint Mask";
          break;
        case "regional":
          layerName =
            locale.t("canvas.layer.type_regional", {
              n: String(this.layers.filter((l) => l.type === "regional").length + 1),
            }) || `Region ${this.layers.filter((l) => l.type === "regional").length + 1}`;
          break;
        case "controlnet":
          layerName =
            locale.t("canvas.layer.type_controlnet", {
              n: String(this.layers.filter((l) => l.type === "controlnet").length + 1),
            }) || `ControlNet ${this.layers.filter((l) => l.type === "controlnet").length + 1}`;
          break;
        case "raster":
        default:
          layerName =
            locale.t("canvas.layer.raster", {
              n: String(this.layers.filter((l) => l.type === "raster").length + 1),
            }) || `Layer ${this.layers.filter((l) => l.type === "raster").length + 1}`;
          break;
      }
    }

    const base: CanvasLayerBase = {
      id,
      name: layerName,
      type,
      visible: true,
      locked: false,
      opacity: 1.0,
      order: nextOrder,
      zIndex: nextOrder,
      blendMode: "normal",
    };

    let newLayer: CanvasLayer;
    switch (type) {
      case "mask":
        newLayer = {
          ...base,
          type: "mask",
          denoise: 0.7,
          inverted: false,
          maskBlur: 0,
          color: this.maskOverlayColor,
          ...(extraProps as Partial<MaskCanvasLayer>),
        };
        break;
      case "regional":
        newLayer = {
          ...base,
          type: "regional",
          x: 0.0,
          y: 0.0,
          width: 0.5,
          height: 0.5,
          prompt: "",
          negativePrompt: "",
          weight: 1.0,
          ...(extraProps as Partial<RegionalCanvasLayer>),
        };
        break;
      case "controlnet":
        newLayer = {
          ...base,
          type: "controlnet",
          model: "",
          preprocessor: "none",
          strength: 1.0,
          startPercent: 0.0,
          endPercent: 1.0,
          ...(extraProps as Partial<ControlNetCanvasLayer>),
        };
        break;
      case "raster":
      default:
        newLayer = {
          ...base,
          type: "raster",
          denoise: 1.0,
          ...(extraProps as Partial<RasterCanvasLayer>),
        };
        break;
    }

    this.layers = [...this.layers, newLayer];
    this.activeLayerId = id;
    return id;
  }

  addRasterLayer(name?: string, extraProps?: Partial<RasterCanvasLayer>): string {
    return this.addLayer("raster", name, extraProps);
  }

  addMaskLayer(name?: string, linkedLayerId?: string, extraProps?: Partial<MaskCanvasLayer>): string {
    return this.addLayer("mask", name, { linkedLayerId, ...extraProps });
  }

  addRegionalLayer(name?: string, extraProps?: Partial<RegionalCanvasLayer>): string {
    return this.addLayer("regional", name, extraProps);
  }

  addControlNetLayer(name?: string, extraProps?: Partial<ControlNetCanvasLayer>): string {
    return this.addLayer("controlnet", name, extraProps);
  }

  removeLayer(id: string): boolean {
    const layer = this.layers.find((l) => l.id === id);
    if (!layer) return false;

    const rasterCount = this.layers.filter((l) => l.type === "raster").length;
    if (layer.type === "raster" && rasterCount <= 1) {
      // Invariant: Cannot delete the last remaining raster layer
      return false;
    }

    const removedIndex = this.layers.findIndex((l) => l.id === id);
    const nextLayers = this.layers.filter((l) => l.id !== id);
    nextLayers.forEach((l, idx) => {
      l.order = idx;
      l.zIndex = idx;
    });

    this.layers = nextLayers;
    this.clearLayerThumbnail(id);

    if (this.activeLayerId === id) {
      if (nextLayers.length === 0) {
        this.activeLayerId = null;
      } else {
        const nextActive = nextLayers[Math.max(0, removedIndex - 1)];
        this.activeLayerId = nextActive ? nextActive.id : nextLayers[0].id;
      }
    }

    return true;
  }

  deleteLayer(id: string): boolean {
    return this.removeLayer(id);
  }

  setLayerThumbnail(id: string, dataUrl: string) {
    this.layerThumbnails = { ...this.layerThumbnails, [id]: dataUrl };
  }

  clearLayerThumbnail(id: string) {
    if (!(id in this.layerThumbnails)) return;
    const next = { ...this.layerThumbnails };
    delete next[id];
    this.layerThumbnails = next;
  }

  async duplicateLayer(id: string): Promise<string | null> {
    const source = this.layers.find((l) => l.id === id);
    if (!source) return null;
    const newId = genLayerId();
    const sourceIndex = this.layers.findIndex((l) => l.id === id);
    const targetIndex = sourceIndex + 1;

    const copy: CanvasLayer = {
      ...JSON.parse(JSON.stringify(source)),
      id: newId,
      name: `${source.name} copy`,
    };

    const nextLayers = [...this.layers];
    nextLayers.splice(targetIndex, 0, copy);
    nextLayers.forEach((l, idx) => {
      l.order = idx;
      l.zIndex = idx;
    });

    this.layers = nextLayers;
    this.activeLayerId = newId;

    if (this._stageOps.duplicateLayer && (source.type === "raster" || source.type === "mask")) {
      await this._stageOps.duplicateLayer(id, newId);
    }
    return newId;
  }

  reorderLayer(id: string, targetOrDirection: number | "up" | "down") {
    const currentIndex = this.layers.findIndex((l) => l.id === id);
    if (currentIndex === -1) return;

    let targetIndex: number;
    if (typeof targetOrDirection === "number") {
      targetIndex = Math.max(0, Math.min(this.layers.length - 1, targetOrDirection));
    } else if (targetOrDirection === "up") {
      targetIndex = Math.min(this.layers.length - 1, currentIndex + 1);
    } else {
      targetIndex = Math.max(0, currentIndex - 1);
    }

    if (currentIndex === targetIndex) return;

    const nextLayers = [...this.layers];
    const [removed] = nextLayers.splice(currentIndex, 1);
    nextLayers.splice(targetIndex, 0, removed);

    nextLayers.forEach((layer, idx) => {
      layer.order = idx;
      layer.zIndex = idx;
    });

    this.layers = nextLayers;
  }

  renameLayer(id: string, name: string) {
    if (typeof name !== "string") return;
    const trimmed = name.trim();
    this.layers = this.layers.map((l) => (l.id === id ? { ...l, name: trimmed } : l));
  }

  toggleLayerVisibility(id: string) {
    this.layers = this.layers.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l));
  }

  setLayerOpacity(id: string, opacity: number) {
    const clamped = Math.max(0.0, Math.min(1.0, Number.isFinite(opacity) ? opacity : 1.0));
    this.layers = this.layers.map((l) => (l.id === id ? { ...l, opacity: clamped } : l));
  }

  setLayerDenoise(id: string, denoise: number) {
    this.layers = this.layers.map((l) => (l.id === id ? { ...l, denoise } : l));
  }

  setLayerPrompt(id: string, prompt: string) {
    this.layers = this.layers.map((l) => (l.id === id ? { ...l, prompt } : l));
  }

  setLayerBlendMode(id: string, blendMode: CanvasBlendMode) {
    this.layers = this.layers.map((l) => (l.id === id ? { ...l, blendMode } : l));
  }

  setSampledColor(info: SampledColorInfo | null) {
    this.sampledColor = info;
  }

  setActiveTransformBounds(bounds: ActiveTransformBounds | null) {
    this.activeTransformBounds = bounds;
  }

  toggleQuickMask(): boolean {
    this.quickMaskMode = !this.quickMaskMode;
    return this.quickMaskMode;
  }

  setZoomToolMode(mode: ZoomToolMode) {
    this.zoomToolMode = mode;
  }

  setRegionalProps(id: string, props: Partial<RegionalCanvasLayer>) {
    this.layers = this.layers.map((l) => {
      if (l.id !== id || l.type !== "regional") return l;
      return { ...l, ...props };
    });
  }

  setControlNetProps(id: string, props: Partial<ControlNetCanvasLayer>) {
    this.layers = this.layers.map((l) => {
      if (l.id !== id || l.type !== "controlnet") return l;
      return { ...l, ...props };
    });
  }

  setMaskProps(id: string, props: Partial<MaskCanvasLayer>) {
    this.layers = this.layers.map((l) => {
      if (l.id !== id || l.type !== "mask") return l;
      return { ...l, ...props };
    });
  }

  snapBoundingBoxToLayer(layerId?: string) {
    const targetId = layerId ?? this.activeLayerId;
    if (!targetId) return;
    const layer = this.layers.find((l) => l.id === targetId);
    if (!layer) return;

    if (layer.type === "regional") {
      this.boundingBox = {
        x: Math.round(layer.x * this.canvasWidth),
        y: Math.round(layer.y * this.canvasHeight),
        width: Math.max(64, Math.round(layer.width * this.canvasWidth)),
        height: Math.max(64, Math.round(layer.height * this.canvasHeight)),
        locked: this.boundingBox.locked,
      };
    } else {
      this.boundingBox = {
        x: 0,
        y: 0,
        width: this.canvasWidth,
        height: this.canvasHeight,
        locked: this.boundingBox.locked,
      };
    }
  }

  resetBoundingBoxToCanvas() {
    this.boundingBox = {
      x: 0,
      y: 0,
      width: this.canvasWidth,
      height: this.canvasHeight,
      locked: false,
    };
  }

  getLayerCanvas(layerId: string): HTMLCanvasElement | null {
    return this._stageOps.getLayerCanvas ? this._stageOps.getLayerCanvas(layerId) : null;
  }

  async duplicateActiveLayer(): Promise<string | null> {
    if (!this.activeLayerId) return null;
    return await this.duplicateLayer(this.activeLayerId);
  }

  async mergeDownLayer(id: string) {
    if (this._stageOps.mergeDown) {
      const handled = await this._stageOps.mergeDown(id);
      if (handled) return;
    }
    const sorted = [...this.layers].sort((a, b) => b.order - a.order);
    const index = sorted.findIndex((l) => l.id === id);
    if (index < 0 || index >= sorted.length - 1) return;
    const current = sorted[index];
    const target = sorted[index + 1];
    this.removeLayer(current.id);
    this.setActiveLayer(target.id);
  }

  async mergeDownActiveLayer() {
    if (!this.activeLayerId) return;
    const layer = this.layers.find((l) => l.id === this.activeLayerId);
    if (!layer || layer.type !== "raster") return;
    await this.mergeDownLayer(this.activeLayerId);
  }

  async flattenLayers() {
    if (this._stageOps.flatten) {
      await this._stageOps.flatten();
    }
  }

  async acceptAsNewLayer(): Promise<CanvasLayer | null> {
    const cand = this.candidate;
    if (!cand || !cand.url) return null;

    canvasHistory.snapshot("Accept Generation as New Layer");

    const active = this.getActiveLayer();
    const newLayerId = this.addLayer("raster", "Generated Layer");
    const newLayer = this.layers.find((l) => l.id === newLayerId);
    if (!newLayer) return null;

    if (newLayer.type === "raster") {
      newLayer.thumbnail = cand.url;
      newLayer.width = cand.width;
      newLayer.height = cand.height;
    }

    if (active) {
      const activeIdx = this.layers.findIndex((l) => l.id === active.id);
      this.reorderLayer(newLayer.id, activeIdx + 1);
    }

    if (this._stageOps.acceptStagingToLayer) {
      await this._stageOps.acceptStagingToLayer(false);
    }

    this.clearStaging();
    return newLayer;
  }

  async acceptStagingToNewLayer(): Promise<CanvasLayer | null> {
    if (this.canApplyInpaintResult) {
      const ok = await this.applyInpaintAsLayer();
      if (ok) {
        this.clearStaging();
      }
      return this.getActiveLayer();
    }
    return await this.acceptAsNewLayer();
  }

  async applyToBase(): Promise<boolean> {
    const cand = this.candidate;
    if (!cand || !cand.url) return false;

    const active = this.getActiveLayer();
    if (!active || active.locked || active.type !== "raster") {
      return false;
    }

    canvasHistory.snapshot("Apply Generation to Base");

    if (this._stageOps.acceptStagingToLayer) {
      const success = await this._stageOps.acceptStagingToLayer(false);
      if (!success) return false;
    }

    active.thumbnail = cand.url;
    this.clearStaging();
    return true;
  }

  async acceptStagingToCurrentLayer(): Promise<boolean> {
    if (this.canApplyInpaintResult) {
      this.applyInpaintResult();
      this.clearStaging();
      return true;
    }
    return await this.applyToBase();
  }

  async acceptAndInpaintImmediately(): Promise<boolean> {
    const cand = this.candidate;
    const candUrl = cand?.url ?? this.pendingResultPreviewUrl ?? this.currentStagingImage;
    if (!candUrl) return false;

    canvasHistory.snapshot("Accept & Inpaint Immediately");

    let targetRaster = this.layers.find(
      (l): l is RasterCanvasLayer => l.id === this.activeLayerId && l.type === "raster" && !l.locked
    );

    if (!targetRaster) {
      targetRaster = this.layers.find((l): l is RasterCanvasLayer => l.type === "raster" && !l.locked);
      if (!targetRaster) {
        const newId = this.addLayer("raster", "Base Layer");
        targetRaster = this.layers.find((l): l is RasterCanvasLayer => l.id === newId);
      }
    }

    if (!targetRaster) return false;

    if (this.canApplyInpaintResult) {
      this.applyInpaintResult();
    } else if (this._stageOps.acceptStagingToLayer) {
      this.activeLayerId = targetRaster.id;
      await this._stageOps.acceptStagingToLayer(false);
    } else {
      targetRaster.thumbnail = candUrl;
    }

    let linkedMask = this.layers.find(
      (l): l is MaskCanvasLayer => l.type === "mask" && (l.linkedLayerId === targetRaster!.id || !l.linkedLayerId)
    );

    if (!linkedMask) {
      const maskId = this.addLayer("mask", "Inpaint Mask", { linkedLayerId: targetRaster.id });
      linkedMask = this.layers.find((l): l is MaskCanvasLayer => l.id === maskId);
    }

    if (linkedMask) {
      this.clearLayer(linkedMask.id);
      this.setActiveLayer(linkedMask.id);
    }

    this.inpaintDrawMode = "mask";
    this.setTool("brush");

    this.clearStaging();
    this.clearPendingInpaintResult();
    return true;
  }

  async useAsMask(): Promise<CanvasLayer | null> {
    const cand = this.candidate;
    if (!cand || !cand.url) return null;

    canvasHistory.snapshot("Use Staged as Mask");

    const maskLayerId = this.addLayer("mask", "Generated Mask");
    const maskLayer = this.layers.find((l) => l.id === maskLayerId);
    if (!maskLayer) return null;

    if (maskLayer.type === "mask") {
      maskLayer.thumbnail = cand.url;
      maskLayer.inverted = false;
    }

    if (this._stageOps.acceptCandidateAsMask) {
      await this._stageOps.acceptCandidateAsMask(cand.url);
    }

    this.clearStaging();
    return maskLayer;
  }

  async useStagingAsMask(): Promise<CanvasLayer | null> {
    return await this.useAsMask();
  }

  /**
   * Unified Canvas Engine: Intelligently detects whether the current canvas state,
   * mask coverage, and bounding box correspond to txt2img, img2img, inpaint, outpaint, or upscale.
   */
  get currentUnifiedAction(): UnifiedCanvasAction {
    if (this.hasActiveMask) {
      if (
        this.boundingBox.x < 0 ||
        this.boundingBox.y < 0 ||
        this.boundingBox.x + this.boundingBox.width > this.canvasWidth ||
        this.boundingBox.y + this.boundingBox.height > this.canvasHeight
      ) {
        return "outpaint";
      }
      return "inpaint";
    }

    if (this.referenceImageUrl || this.currentPreparedInputImage || this.hasRasterContent) {
      return "img2img";
    }

    return "txt2img";
  }

  resolveUnifiedGenerationMode(): GenerationMode {
    if (generation.mode === "video") return "video";
    if (generation.editReferenceImages && generation.editReferenceImages.length > 0) {
      return "image_edit";
    }
    if (this.hasActiveMask) {
      return "inpainting";
    }
    if (this.referenceImageUrl || this.currentPreparedInputImage || this.hasRasterContent) {
      return "img2img";
    }
    return "txt2img";
  }

  get hasActiveMask(): boolean {
    return !!(
      this.persistedMaskPreviewUrl ||
      this.preparedInpaintPreviewUrl ||
      (this.activeLayer?.type === "mask" && this.activeLayer.visible && !!this.layerThumbnails[this.activeLayer.id]) ||
      this.layers.some((l) => l.type === "mask" && l.visible && !!this.layerThumbnails[l.id])
    );
  }

  get hasRasterContent(): boolean {
    return this.layers.some((l) => l.type === "raster" && l.visible && !!this.layerThumbnails[l.id]);
  }

  toggleLayerLock(id: string) {
    this.layers = this.layers.map((l) => (l.id === id ? { ...l, locked: !l.locked } : l));
  }

  setActiveLayer(id: string) {
    this.activeLayerId = id;
    const layer = this.layers.find((l) => l.id === id);
    if (layer) {
      if (layer.type === "mask") {
        this.inpaintDrawMode = "mask";
      } else {
        this.inpaintDrawMode = "regular";
      }
    }
  }

  // Clear all content from a layer (via Konva stage ref)
  clearLayer(id: string) {
    this.clearLayerThumbnail(id);
    delete this.layerThumbnails[id];
    const layer = this.layers.find((l) => l.id === id);
    if (layer && (layer as any).thumbnail) {
      (layer as any).thumbnail = undefined;
    }
    if (!this._stageRef) return;
    const layers = this._stageRef.getLayers();
    for (const kLayer of layers) {
      if (kLayer.id() === id) {
        kLayer.destroyChildren();
        kLayer.batchDraw();
        break;
      }
    }
  }

  // Viewport
  zoomIn() {
    this.setZoom(Math.min(20, this.viewport.zoom * 1.2));
  }

  zoomOut() {
    this.setZoom(Math.max(0.05, this.viewport.zoom / 1.2));
  }

  setZoom(zoom: number, centerX?: number, centerY?: number) {
    const oldZoom = this.viewport.zoom;
    const newZoom = Math.max(0.05, Math.min(20, zoom));

    if (centerX !== undefined && centerY !== undefined) {
      // Zoom toward the cursor position
      const scale = newZoom / oldZoom;
      this.viewport = {
        zoom: newZoom,
        panX: centerX - (centerX - this.viewport.panX) * scale,
        panY: centerY - (centerY - this.viewport.panY) * scale,
      };
    } else {
      this.viewport = { ...this.viewport, zoom: newZoom };
    }
  }

  zoomToFit(containerWidth: number, containerHeight: number) {
    const scaleX = containerWidth / this.canvasWidth;
    const scaleY = containerHeight / this.canvasHeight;
    const zoom = Math.min(scaleX, scaleY) * 0.9;
    this.viewport = {
      zoom,
      panX: (containerWidth - this.canvasWidth * zoom) / 2,
      panY: (containerHeight - this.canvasHeight * zoom) / 2,
    };
  }

  resetZoom() {
    this.viewport = { zoom: 1, panX: 0, panY: 0 };
  }

  // Canvas init — creates default layers
  initCanvas(width: number, height: number) {
    this.canvasWidth = width;
    this.canvasHeight = height;
    this.layers = [];
    this.activeLayerId = null;
    this.layerThumbnails = {};
    this.persistedMaskPreviewUrl = null;
    this.maskEditedSinceResult = false;
    this.pendingMaskRestoreUrl = null;
    this._pendingPaste = null;
    this._preCropGenDims = null;

    this.addLayer("raster", locale.t("canvas.layer.background"));
    this.addLayer("mask", locale.t("canvas.layer.inpaint_mask"));

    // Set active to the raster layer
    const rasterLayer = this.layers.find((l) => l.type === "raster");
    if (rasterLayer) this.activeLayerId = rasterLayer.id;

    this.boundingBox = { x: 0, y: 0, width, height, locked: false };
  }

  saveLayerState(): Array<{ name: string; type: string; visible: boolean; opacity: number; locked: boolean; denoise: number }> {
    return this.layers.map((l) => ({
      name: l.name,
      type: l.type,
      visible: l.visible,
      opacity: l.opacity,
      locked: l.locked,
      denoise: ("denoise" in l ? (l as any).denoise : undefined) ?? (l.type === "mask" ? 0.7 : 1.0),
    }));
  }

  /**
   * Set mask upscale for high-res inpainting.
   * Canvas stays at original size — only generation dimensions change.
   * Image + mask are upscaled transparently before upload to ComfyUI,
   * and the Rust template downscales the output back via ImageScale.
   */
  upscaleMask(targetW: number, targetH: number): void {
    if (targetW <= 0 || targetH <= 0) return;
    if (targetW === this.canvasWidth && targetH === this.canvasHeight) return;

    const origW = this.canvasWidth;
    const origH = this.canvasHeight;

    this._preUpscaleCanvasWidth = origW;
    this._preUpscaleCanvasHeight = origH;

    const tw = Math.round(targetW);
    const th = Math.round(targetH);

    generation.width = tw;
    generation.height = th;
    generation.postScaleWidth = origW;
    generation.postScaleHeight = origH;
    this.maskUpscaleFactor = tw / origW;
  }

  /**
   * Clear mask upscale — reset generation dimensions and post-scale params.
   * Canvas is not resized (it never changed).
   */
  resetMaskScale(): void {
    if (this._preUpscaleCanvasWidth == null || this._preUpscaleCanvasHeight == null) return;

    generation.width = this._preUpscaleCanvasWidth;
    generation.height = this._preUpscaleCanvasHeight;
    generation.postScaleWidth = null;
    generation.postScaleHeight = null;
    this.maskUpscaleFactor = 1;
    this._preUpscaleCanvasWidth = null;
    this._preUpscaleCanvasHeight = null;
  }

  /** Restore generation dimensions after "Only masked" inpainting completes. */
  restoreGenerationDims() {
    if (this._preCropGenDims) {
      generation.width = this._preCropGenDims.width;
      generation.height = this._preCropGenDims.height;
      this._preCropGenDims = null;
    }
  }

  // Export
  async exportLayerAsImage(layerCanvas: HTMLCanvasElement, filename: string): Promise<{ name: string; subfolder: string; type: string }> {
    const blob = await new Promise<Blob>((resolve) => {
      layerCanvas.toBlob((b) => resolve(b!), "image/png");
    });
    const arrayBuffer = await blob.arrayBuffer();
    const bytes = Array.from(new Uint8Array(arrayBuffer));
    return uploadImageBytes(bytes, filename);
  }

  async syncMaskToGeneration(maskCanvas: HTMLCanvasElement | null, uploadToComfy: boolean = true): Promise<boolean> {
    this._maskSyncInFlight = this._syncMaskToGenerationImpl(maskCanvas, uploadToComfy);
    return this._maskSyncInFlight;
  }

  private async _syncMaskToGenerationImpl(maskCanvas: HTMLCanvasElement | null, uploadToComfy: boolean = true): Promise<boolean> {
    if (!maskCanvas) {
      generation.maskImage = null;
      this.persistedMaskPreviewUrl = null;
      return false;
    }

    const ctx = maskCanvas.getContext("2d")!;
    const data = ctx.getImageData(0, 0, maskCanvas.width, maskCanvas.height).data;
    let hasMask = false;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > 0) {
        hasMask = true;
        break;
      }
    }

    if (!hasMask) {
      generation.maskImage = null;
      this.persistedMaskPreviewUrl = null;
      return false;
    }

    // Convert mask to white-on-black grayscale for ComfyUI (preserves soft edges).
    const exportW = this.maskUpscaleFactor > 1 ? generation.width : maskCanvas.width;
    const exportH = this.maskUpscaleFactor > 1 ? generation.height : maskCanvas.height;
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = exportW;
    exportCanvas.height = exportH;
    const exportCtx = exportCanvas.getContext("2d")!;
    exportCtx.fillStyle = "black";
    exportCtx.fillRect(0, 0, exportW, exportH);
    exportCtx.drawImage(maskCanvas, 0, 0, exportW, exportH);

    const imgData = exportCtx.getImageData(0, 0, exportCanvas.width, exportCanvas.height);
    const pixels = imgData.data;
    for (let i = 0; i < pixels.length; i += 4) {
      // Lower threshold to 16 so dark and semi-transparent mask strokes aren't dropped.
      if (pixels[i + 3] > 0 && (pixels[i] > 16 || pixels[i + 1] > 16 || pixels[i + 2] > 16)) {
        pixels[i] = pixels[i + 1] = pixels[i + 2] = 255;
        pixels[i + 3] = 255;
      } else {
        pixels[i] = pixels[i + 1] = pixels[i + 2] = 0;
        pixels[i + 3] = 255;
      }
    }
    exportCtx.putImageData(imgData, 0, 0);

    // Persist the mask preview overlay — always, so auto-commit (uploadToComfy=false)
    // keeps the visual overlay in sync with the actual mask pixels.
    this.persistedMaskPreviewUrl = exportCanvas.toDataURL("image/png");

    if (uploadToComfy) {
      const result = await this.exportLayerAsImage(exportCanvas, "canvas_mask.png");
      generation.maskImage = result.name;
    }

    return true;
  }

  /** Helper: clone a canvas to a new canvas element. */
  private async _cloneCanvas(src: HTMLCanvasElement): Promise<HTMLCanvasElement> {
    const clone = document.createElement("canvas");
    clone.width = src.width;
    clone.height = src.height;
    const ctx = clone.getContext("2d")!;
    ctx.drawImage(src, 0, 0);
    return clone;
  }

  /** Helper: upscale a canvas to generation dimensions. */
  private _upscaleToGen(src: HTMLCanvasElement): HTMLCanvasElement {
    const upscaled = document.createElement("canvas");
    upscaled.width = generation.width;
    upscaled.height = generation.height;
    const ctx = upscaled.getContext("2d")!;
    ctx.drawImage(src, 0, 0, generation.width, generation.height);
    return upscaled;
  }

  /**
   * Convert mask to white-on-black grayscale (Forge-compatible).
   * Uses alpha channel as grayscale value so blurred soft edges are preserved.
   */
  private async _uploadMask(maskCanvas: HTMLCanvasElement, uploadToComfy: boolean): Promise<boolean> {
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = maskCanvas.width;
    exportCanvas.height = maskCanvas.height;
    const exportCtx = exportCanvas.getContext("2d")!;
    exportCtx.fillStyle = "black";
    exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
    exportCtx.drawImage(maskCanvas, 0, 0);

    const imgData = exportCtx.getImageData(0, 0, exportCanvas.width, exportCanvas.height);
    const pixels = imgData.data;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] > 0 && (pixels[i] > 16 || pixels[i + 1] > 16 || pixels[i + 2] > 16)) {
        pixels[i] = pixels[i + 1] = pixels[i + 2] = 255;
        pixels[i + 3] = 255;
      } else {
        pixels[i] = pixels[i + 1] = pixels[i + 2] = 0;
        pixels[i + 3] = 255;
      }
    }
    exportCtx.putImageData(imgData, 0, 0);

    if (uploadToComfy) {
      this.persistedMaskPreviewUrl = exportCanvas.toDataURL("image/png");
      const result = await this.exportLayerAsImage(exportCanvas, "canvas_mask.png");
      generation.maskImage = result.name;
    }

    return true;
  }

  /**
   * Composite the generation output back into the original full-size canvas.
   * The output is at crop dimensions (post_scale'd by ImageScale), so we paste
   * it into the original image at the stored coordinates.
   */
  pasteBackOutput(outputBlob: Blob): Promise<string | null> {
    const pending = this._pendingPaste;
    if (!pending) return Promise.resolve(null);

    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const origImg = new Image();
        origImg.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = origImg.width;
          canvas.height = origImg.height;
          const ctx = canvas.getContext("2d")!;
          ctx.drawImage(origImg, 0, 0);
          ctx.drawImage(img, pending.x, pending.y, pending.width, pending.height);
          const resultUrl = canvas.toDataURL("image/png");
          this._pendingPaste = null;
          resolve(resultUrl);
        };
        origImg.src = pending.originalUrl;
      };
      img.src = URL.createObjectURL(outputBlob);
    });
  }

  // Sync canvas to generation store before generating
  async syncToGeneration(
    getRasterComposite: () => HTMLCanvasElement | null,
    getMaskCanvas: () => HTMLCanvasElement | null
  ) {
    // Modeless Smart Dispatch: dynamically infer pipeline from canvas state
    if (generation.mode !== "video") {
      generation.mode = this.resolveUnifiedGenerationMode();
    }

    const rasterCanvas = getRasterComposite();
    const maskCanvas = getMaskCanvas();
    const isInpainting = generation.mode === "inpainting";

    let hasRaster = false;
    let hasMask = false;
    let cropRegion: CropRegion | null = null;

    // Wait for any in-flight auto-commit of the mask so we never snapshot
    // a stale/intermediate mask state.
    if (this._maskSyncInFlight) {
      try {
        await this._maskSyncInFlight;
      } catch {
        // auto-commit failure is non-fatal; proceed with current mask state
      }
      this._maskSyncInFlight = null;
    }

    // Clear any pending paste-back from previous generation.
    this._pendingPaste = null;

    // ── "Only masked" crop / upscale pipeline (Forge inpaint_full_res) ──
    if (isInpainting && this.inpaintFullRes && maskCanvas) {
      const maskCtx = maskCanvas.getContext("2d")!;

      // 1. Find mask bounding box
      cropRegion = getCropRegionV2(maskCtx, this.inpaintFullResPadding);

      if (cropRegion && rasterCanvas) {
        // 2. Expand to match generation aspect ratio
        cropRegion = expandCropRegion(
          cropRegion,
          generation.width,
          generation.height,
          rasterCanvas.width,
          rasterCanvas.height,
        );

        const cropW = cropRegion.x2 - cropRegion.x1;
        const cropH = cropRegion.y2 - cropRegion.y1;

        // 3. Prepare mask: blur → crop → upscale → white-on-black
        let processedMask = maskCanvas;
        if (this.maskBlur > 0) {
          processedMask = await this._cloneCanvas(maskCanvas);
          gaussianBlurCanvas(processedMask, this.maskBlur);
        }
        if (this.inpaintMaskInvert) {
          processedMask = await this._cloneCanvas(processedMask);
          const ictx = processedMask.getContext("2d")!;
          const idata = ictx.getImageData(0, 0, processedMask.width, processedMask.height);
          for (let i = 0; i < idata.data.length; i += 4) {
            idata.data[i + 3] = 255 - idata.data[i + 3];
          }
          ictx.putImageData(idata, 0, 0);
        }

        let croppedMask = cropCanvas(processedMask, cropRegion);
        let upscaledMask = this._upscaleToGen(croppedMask);

        // 4. Convert mask to grayscale + upload (preserves blur soft edges).
        hasMask = await this._uploadMask(upscaledMask, true);

        // 5. Prepare image: crop → upscale → optional fill → upload.
        let croppedImage = cropCanvas(rasterCanvas, cropRegion);
        let upscaledImage = this._upscaleToGen(croppedImage);

        if (this.inpaintingFill === 0) {
          let fillMaskCanvas = upscaledMask;
          if (this.inpaintMaskInvert) {
            fillMaskCanvas = await this._cloneCanvas(upscaledMask);
            const fctx = fillMaskCanvas.getContext("2d")!;
            const fdata = fctx.getImageData(0, 0, fillMaskCanvas.width, fillMaskCanvas.height);
            for (let i = 0; i < fdata.data.length; i += 4) {
              fdata.data[i + 3] = 255 - fdata.data[i + 3];
            }
            fctx.putImageData(fdata, 0, 0);
          }
          upscaledImage = fillMaskedRegion(upscaledImage, fillMaskCanvas);
        }

        const result = await this.exportLayerAsImage(upscaledImage, "canvas_input.png");
        generation.inputImage = result.name;
        hasRaster = true;

        // 6. Save original dims, then set post_scale for ImageScale.
        this._preCropGenDims = { width: generation.width, height: generation.height };
        generation.postScaleWidth = cropW;
        generation.postScaleHeight = cropH;
        generation.width = upscaledImage.width;
        generation.height = upscaledImage.height;

        // 7. Store paste-back coordinates
        this._pendingPaste = {
          x: cropRegion.x1,
          y: cropRegion.y1,
          width: cropW,
          height: cropH,
          originalUrl: rasterCanvas.toDataURL("image/png"),
        };
      } else {
        cropRegion = null;
      }
    }

    // ── Fallback: whole-image inpainting or non-crop modes ──
    if (!cropRegion) {
      const maybeUpscale = (src: HTMLCanvasElement): HTMLCanvasElement => {
        if (this.maskUpscaleFactor <= 1) return src;
        const upscaled = document.createElement("canvas");
        upscaled.width = generation.width;
        upscaled.height = generation.height;
        const uctx = upscaled.getContext("2d")!;
        uctx.drawImage(src, 0, 0, generation.width, generation.height);
        return upscaled;
      };

      // In inpainting mode, raster drawn by the user takes priority over the
      // session original input — the user may have painted touch-ups that need
      // to be sent as the new baseline for this generation.
      if (isInpainting) {
        if (rasterCanvas) {
          const ctx = rasterCanvas.getContext("2d")!;
          const data = ctx.getImageData(0, 0, rasterCanvas.width, rasterCanvas.height).data;
          for (let i = 3; i < data.length; i += 4) {
            if (data[i] > 0) {
              hasRaster = true;
              break;
            }
          }
          if (hasRaster) {
            const exportSrc = maybeUpscale(rasterCanvas);
            const result = await this.exportLayerAsImage(exportSrc, "canvas_input.png");
            generation.inputImage = result.name;
          }
        }
        if (!hasRaster && generation.inputImage) {
          hasRaster = true;
        }
      } else {
        if (rasterCanvas) {
          const ctx = rasterCanvas.getContext("2d")!;
          const data = ctx.getImageData(0, 0, rasterCanvas.width, rasterCanvas.height).data;
          for (let i = 3; i < data.length; i += 4) {
            if (data[i] > 0) { hasRaster = true; break; }
          }
          if (hasRaster) {
            const exportSrc = maybeUpscale(rasterCanvas);
            const result = await this.exportLayerAsImage(exportSrc, "canvas_input.png");
            generation.inputImage = result.name;
          }
        }

        if (!hasRaster && this.currentStagingImage) {
          const response = await fetch(this.currentStagingImage);
          const blob = await response.blob();
          const arrayBuffer = await blob.arrayBuffer();
          const bytes = Array.from(new Uint8Array(arrayBuffer));
          const result = await uploadImageBytes(bytes, "staged_input.png");
          generation.inputImage = result.name;
          hasRaster = true;
        }
      }

      // Export mask (whole-image path)
      hasMask = await this.syncMaskToGeneration(maskCanvas, true);

      // Sync dimensions from bounding box — but preserve mask-upscale overrides.
      if (this.maskUpscaleFactor <= 1) {
        generation.width = this.boundingBox.width;
        generation.height = this.boundingBox.height;
      }
    }

    // Use per-layer denoise from the first visible mask layer
    if (hasMask) {
      const firstMask = this.layers.find((l): l is MaskCanvasLayer => l.type === "mask" && l.visible);
      if (firstMask && firstMask.denoise !== undefined) {
        generation.denoise = firstMask.denoise;
      }
    }
  }
}

export const canvas = new CanvasStore();

export function resolveUnifiedGenerationMode(): GenerationMode {
  return canvas.resolveUnifiedGenerationMode();
}
