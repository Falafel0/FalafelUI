<script lang="ts">
  import { onMount, onDestroy, tick } from "svelte";
  import Konva from "konva";
  import { generation } from "../../stores/generation.svelte.js";
  import { canvas, type ToolType } from "../../stores/canvas.svelte.js";
  import { canvasHistory } from "../../stores/canvasHistory.svelte.js";
  import { progress } from "../../stores/progress.svelte.js";
  import { locale } from "../../stores/locale.svelte.js";
  import type { FalafelProjectDocument } from "../../utils/canvasProject.js";
  import { gaussianBlurCanvas } from "../../utils/maskBlur.js";
  import ColorTooltip from "../ui/ColorTooltip.svelte";

  // Hide the editable inpaint mask while a finished result is being previewed, so
  // the clean output is visible. Use a one-frame-delayed wasGenerating to suppress
  // the flicker when isGenerating briefly flips false between clearing the old prompt
  // and submitting the new one.
  let wasGenerating = $state(false);
  $effect(() => {
    if (progress.isGenerating) {
      wasGenerating = true;
    } else {
      tick().then(() => { wasGenerating = false; });
    }
  });

  const hideInpaintMask = $derived(
    canvas.shouldHideInpaintMask && !progress.isGenerating && !wasGenerating
  );

  let containerEl: HTMLDivElement | undefined = $state();
  let stage: Konva.Stage | null = null;

  // Tooltip state
  let tooltipVisible = $state(false);
  let tooltipColor = $state("#000000");
  let tooltipPos = $state({ x: 0, y: 0 });
  let tooltipRaf: number | null = null;

  // Konva layers keyed by canvas layer ID
  let konvaLayers = new Map<string, Konva.Layer>();
  // Background layer (checkerboard)
  let bgLayer: Konva.Layer | null = null;
  let checkerRect: Konva.Rect | null = null;
  let borderRect: Konva.Rect | null = null;
  let checkerPatternCanvas: HTMLCanvasElement | null = null;
  // Reference image layer (under paint layers)
  let refLayer: Konva.Layer | null = null;
  let refImageNode: Konva.Image | null = null;
  let lastRefSource: string | null = null;
  // Persisted mask preview layer (shows last exported/uploaded mask after remount)
  let persistedMaskLayer: Konva.Layer | null = null;
  let persistedMaskNode: Konva.Image | null = null;
  let lastMaskSource: string | null = null;
  // UI overlay layer (brush cursor, bounding box)
  let uiLayer: Konva.Layer | null = null;

  // Drawing state (not reactive — performance-critical)
  let isDrawing = false;
  let isPanning = false;
  let isSpacePanning = false;
  let currentLine: Konva.Line | null = null;
  let activeStrokeTool: "brush" | "eraser" | null = null;
  let lastPointerPos: { x: number; y: number } | null = null;
  let brushCursor: Konva.Circle | null = null;

  // Rectangle tool state
  let isDrawingRect = false;
  let rectStartPos: { x: number; y: number } | null = null;
  let rectPreview: Konva.Rect | null = null;
  let isMovingLayer = false;
  let moveStartPos: { x: number; y: number } | null = null;
  let moveNodeStarts: Array<{ node: Konva.Node; x: number; y: number }> = [];
  let viewportRaf: number | null = null;

  // Free Transform state
  let transformer: Konva.Transformer | null = null;
  let transformTargetGroup: Konva.Group | null = null;
  let transformActiveLayerId: string | null = null;

  // Lasso tool state (points kept in canvas space; preview drawn on the UI layer in screen space)
  let isLasso = false;
  let lassoPoints: number[] = [];
  let lassoPreviewLine: Konva.Line | null = null;

  // Alt-held quick eyedropper
  let isAltEyedropper = false;

  // Per-layer thumbnail regeneration (RAF-deduped per layer id)
  let thumbRafs = new Map<string, number>();
  let thumbInitialized = new Set<string>();

  // Container size
  let containerW = 0;
  let containerH = 0;

  onMount(() => {
    if (!containerEl) return;
    initStage();
    const observer = new ResizeObserver(handleResize);
    observer.observe(containerEl);
    return () => observer.disconnect();
  });

  onDestroy(() => {
    if (tooltipRaf !== null) {
      cancelAnimationFrame(tooltipRaf);
    }
    canvas.isPointerOverStage = false;
    if (viewportRaf !== null) {
      cancelAnimationFrame(viewportRaf);
      viewportRaf = null;
    }
    for (const raf of thumbRafs.values()) {
      cancelAnimationFrame(raf);
    }
    thumbRafs.clear();
    // Drop the restore callback so a stale closure can't fire after unmount.
    canvasHistory.setOnRestored(null);
    if (transformer) {
      transformer.destroy();
      transformer = null;
    }
    if (transformTargetGroup) {
      transformTargetGroup.destroy();
      transformTargetGroup = null;
    }
    canvas.registerStageOps({
      mergeDown: undefined,
      flatten: undefined,
      duplicateLayer: undefined,
      applyInpaintAsLayer: undefined,
      acceptStagingToLayer: undefined,
      getLayerDataUrls: undefined,
      loadLayersFromProject: undefined,
      invertMask: undefined,
      commitTransform: undefined,
      cancelTransform: undefined,
      getRasterComposite: undefined,
      getMaskCanvas: undefined,
      getLayerCanvas: undefined,
    });
    if (stage) {
      stage.destroy();
      stage = null;
    }
  });

  function scheduleViewportApply() {
    if (viewportRaf !== null) return;
    viewportRaf = requestAnimationFrame(() => {
      viewportRaf = null;
      applyViewport();
    });
  }

  function updateTooltip(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    tooltipRaf = null;
    if (!stage || isDrawing || isPanning || isDrawingRect || isMovingLayer) {
      tooltipVisible = false;
      return;
    }
    
    const pointerPos = stage.getPointerPosition();
    if (!pointerPos) {
      tooltipVisible = false;
      return;
    }
    
    // Sample color from all layers
    const compositeCanvas = stage.toCanvas({ pixelRatio: 1 });
    const ctx = compositeCanvas.getContext("2d")!;
    const pixel = ctx.getImageData(Math.round(pointerPos.x), Math.round(pointerPos.y), 1, 1).data;

    if (pixel[3] > 0) {
      const hex = `#${pixel[0].toString(16).padStart(2, "0")}${pixel[1].toString(16).padStart(2, "0")}${pixel[2].toString(16).padStart(2, "0")}`;
      tooltipColor = hex;
      tooltipPos = { x: pointerPos.x + 15, y: pointerPos.y + 15 };
      tooltipVisible = true;
    } else {
      tooltipVisible = false;
    }
  }

  function initStage() {
    if (!containerEl) return;

    const rect = containerEl.getBoundingClientRect();
    containerW = rect.width;
    containerH = rect.height;

    stage = new Konva.Stage({
      container: containerEl,
      width: containerW,
      height: containerH,
    });

    canvas.setStageRef(stage);

    // Background layer (checkerboard)
    bgLayer = new Konva.Layer({ listening: false });
    stage.add(bgLayer);
    drawCheckerboard();

    // Reference image layer (input/staged image underlay)
    refLayer = new Konva.Layer({ listening: false });
    stage.add(refLayer);
    updateReferenceImage(canvas.effectiveReferenceImage);

    // Persisted mask preview layer (sits above reference, below paint layers)
    persistedMaskLayer = new Konva.Layer({ listening: false });
    stage.add(persistedMaskLayer);
    updatePersistedMaskOverlay(canvas.persistedMaskPreviewUrl);

    // Create Konva layers for each canvas layer
    syncKonvaLayers();

    // UI overlay layer
    uiLayer = new Konva.Layer({ listening: false });
    stage.add(uiLayer);

    // Brush cursor
    brushCursor = new Konva.Circle({
      radius: canvas.brushSettings.size / 2,
      stroke: "#ffffff",
      strokeWidth: 1.5,
      dash: [4, 4],
      visible: false,
      listening: false,
    });
    uiLayer.add(brushCursor);

    // Set history refs
    canvasHistory.setRefs(konvaLayers, canvas.canvasWidth, canvas.canvasHeight);
    canvasHistory.setOnRestored((layerIds) => {
      for (const id of layerIds) scheduleThumbRefresh(id);
      stage?.batchDraw();
    });

    // Apply initial viewport
    applyViewport();

    // Fit canvas to view
    canvas.zoomToFit(containerW, containerH);
    applyViewport();

    // Event handlers
    stage.on("mousedown touchstart", handlePointerDown);
    stage.on("mousemove touchmove", handlePointerMove);
    stage.on("mouseup touchend", handlePointerUp);
    stage.on("mouseenter", handlePointerEnter);
    stage.on("mouseleave", handlePointerLeave);
    stage.on("wheel", handleWheel);
    stage.on("contextmenu", (e) => e.evt.preventDefault());

    canvas.registerStageOps({
      mergeDown: handleMergeDown,
      flatten: handleFlatten,
      duplicateLayer: handleDuplicateLayer,
      applyInpaintAsLayer: handleApplyInpaintAsLayer,
      acceptStagingToLayer: handleAcceptStagingToLayer,
      getLayerDataUrls,
      loadLayersFromProject,
      invertMask: handleInvertMask,
      commitTransform,
      cancelTransform,
      getRasterComposite,
      getMaskCanvas,
      getLayerCanvas,
    });

    reorderStageLayers();
  }

  function reorderStageLayers() {
    if (!stage) return;

    bgLayer?.moveToBottom();
    if (refLayer) {
      refLayer.moveToBottom();
      refLayer.moveUp();
    }
    if (persistedMaskLayer) {
      persistedMaskLayer.moveToBottom();
      persistedMaskLayer.moveUp();
      persistedMaskLayer.moveUp();
    }

    const sorted = [...canvas.layers].sort((a, b) => a.order - b.order);
    for (const layer of sorted) {
      const kLayer = konvaLayers.get(layer.id);
      if (kLayer) kLayer.moveToTop();
    }

    uiLayer?.moveToTop();
  }

  function updateReferenceImage(url: string | null) {
    if (!refLayer) return;

    if (!url) {
      lastRefSource = null;
      if (refImageNode) {
        refImageNode.destroy();
        refImageNode = null;
      }
      refLayer.batchDraw();
      return;
    }

    lastRefSource = url;
    const img = new Image();
    img.onload = () => {
      if (!refLayer || lastRefSource !== url) return;

      const imageRatio = img.naturalWidth / img.naturalHeight;
      const canvasRatio = canvas.canvasWidth / canvas.canvasHeight;

      let drawWidth = canvas.canvasWidth;
      let drawHeight = canvas.canvasHeight;
      if (imageRatio > canvasRatio) {
        drawHeight = canvas.canvasWidth / imageRatio;
      } else {
        drawWidth = canvas.canvasHeight * imageRatio;
      }

      const offsetX = (canvas.canvasWidth - drawWidth) / 2;
      const offsetY = (canvas.canvasHeight - drawHeight) / 2;

      if (!refImageNode) {
        refImageNode = new Konva.Image({
          image: img,
          x: offsetX,
          y: offsetY,
          width: drawWidth,
          height: drawHeight,
          listening: false,
          opacity: 0.95,
        });
        refLayer.add(refImageNode);
      } else {
        refImageNode.image(img);
        refImageNode.x(offsetX);
        refImageNode.y(offsetY);
        refImageNode.width(drawWidth);
        refImageNode.height(drawHeight);
      }

      reorderStageLayers();
      refLayer.batchDraw();
    };
    img.onerror = () => {
      if (!refLayer || lastRefSource !== url) return;
      if (refImageNode) {
        refImageNode.destroy();
        refImageNode = null;
        refLayer.batchDraw();
      }
    };
    img.src = url;
  }

  function parseHexColor(hex: string): { r: number; g: number; b: number } {
    const clean = hex.replace("#", "");
    const value = clean.length === 3
      ? clean.split("").map((ch) => ch + ch).join("")
      : clean;
    const num = Number.parseInt(value, 16);
    if (!Number.isFinite(num)) return { r: 255, g: 51, b: 51 };
    return {
      r: (num >> 16) & 255,
      g: (num >> 8) & 255,
      b: num & 255,
    };
  }

  function updatePersistedMaskOverlay(url: string | null) {
    if (!persistedMaskLayer) return;

    if (!url || !canvas.maskOverlayVisible) {
      lastMaskSource = null;
      if (persistedMaskNode) {
        persistedMaskNode.destroy();
        persistedMaskNode = null;
      }
      persistedMaskLayer.batchDraw();
      return;
    }

    lastMaskSource = url;
    const img = new Image();
    img.onload = () => {
      if (!persistedMaskLayer || lastMaskSource !== url) return;

      const overlayCanvas = document.createElement("canvas");
      overlayCanvas.width = img.naturalWidth;
      overlayCanvas.height = img.naturalHeight;
      const ctx = overlayCanvas.getContext("2d");
      if (!ctx) return;

      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, overlayCanvas.width, overlayCanvas.height);
      const pixels = data.data;
      const color = parseHexColor(canvas.maskOverlayColor);
      const baseAlpha = Math.max(0, Math.min(1, canvas.maskOverlayOpacity));

      for (let i = 0; i < pixels.length; i += 4) {
        const maskValue = pixels[i];
        if (maskValue > 8) {
          pixels[i] = color.r;
          pixels[i + 1] = color.g;
          pixels[i + 2] = color.b;
          pixels[i + 3] = Math.round(maskValue * baseAlpha);
        } else {
          pixels[i + 3] = 0;
        }
      }
      ctx.putImageData(data, 0, 0);

      const overlayImg = new Image();
      overlayImg.onload = () => {
        if (!persistedMaskLayer || lastMaskSource !== url) return;

        if (!persistedMaskNode) {
          persistedMaskNode = new Konva.Image({
            image: overlayImg,
            x: 0,
            y: 0,
            width: canvas.canvasWidth,
            height: canvas.canvasHeight,
            listening: false,
          });
          persistedMaskLayer.add(persistedMaskNode);
        } else {
          persistedMaskNode.image(overlayImg);
          persistedMaskNode.x(0);
          persistedMaskNode.y(0);
          persistedMaskNode.width(canvas.canvasWidth);
          persistedMaskNode.height(canvas.canvasHeight);
        }

        reorderStageLayers();
        persistedMaskLayer.batchDraw();
      };
      overlayImg.src = overlayCanvas.toDataURL("image/png");
    };
    img.onerror = () => {
      if (!persistedMaskLayer || lastMaskSource !== url) return;
      if (persistedMaskNode) {
        persistedMaskNode.destroy();
        persistedMaskNode = null;
        persistedMaskLayer.batchDraw();
      }
    };
    img.src = url;
  }

  function handleResize() {
    if (!containerEl || !stage) return;
    const rect = containerEl.getBoundingClientRect();
    containerW = rect.width;
    containerH = rect.height;
    stage.width(containerW);
    stage.height(containerH);
    drawCheckerboard();
  }

  function drawCheckerboard() {
    if (!bgLayer) return;
    bgLayer.destroyChildren();

    // Use one pattern-filled rect instead of thousands of tiles for smooth panning.
    if (!checkerPatternCanvas) {
      const tileSize = 16;
      const pattern = document.createElement("canvas");
      pattern.width = tileSize * 2;
      pattern.height = tileSize * 2;
      const ctx = pattern.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#1a1a1a";
        ctx.fillRect(0, 0, pattern.width, pattern.height);
        ctx.fillStyle = "#2a2a2a";
        ctx.fillRect(tileSize, 0, tileSize, tileSize);
        ctx.fillRect(0, tileSize, tileSize, tileSize);
      }
      checkerPatternCanvas = pattern;
    }

    if (canvas.showCheckerboard && checkerPatternCanvas) {
      checkerRect = new Konva.Rect({
        x: 0,
        y: 0,
        width: canvas.canvasWidth,
        height: canvas.canvasHeight,
        fillPatternImage: checkerPatternCanvas as unknown as HTMLImageElement,
        fillPatternRepeat: "repeat",
        listening: false,
      });
      bgLayer.add(checkerRect);
    }

    // Canvas border
    borderRect = new Konva.Rect({
      x: 0,
      y: 0,
      width: canvas.canvasWidth,
      height: canvas.canvasHeight,
      stroke: "#555",
      strokeWidth: 1 / canvas.viewport.zoom,
      listening: false,
    });
    bgLayer.add(borderRect);

    bgLayer.batchDraw();
  }

  // Sync Konva layers with canvas store layers
  function syncKonvaLayers() {
    if (!stage) return;

    const sorted = [...canvas.layers].sort((a, b) => a.order - b.order);

    for (const layer of sorted) {
      const effectiveVisible =
        !canvas.showingOriginal &&
        layer.visible && !(layer.type === "mask" && hideInpaintMask);
      let kLayer: Konva.Layer;
      if (!konvaLayers.has(layer.id)) {
        kLayer = new Konva.Layer({
          id: layer.id,
          opacity: layer.opacity,
          visible: effectiveVisible,
        });

        // Clip to canvas bounds
        kLayer.clip({
          x: 0,
          y: 0,
          width: canvas.canvasWidth,
          height: canvas.canvasHeight,
        });

        stage.add(kLayer);

        konvaLayers.set(layer.id, kLayer);
      } else {
        kLayer = konvaLayers.get(layer.id)!;
        kLayer.opacity(layer.opacity);
        kLayer.visible(effectiveVisible);
      }

      // Apply CSS mixBlendMode to HTML5 canvas element of this Konva Layer
      const canvasEl = (kLayer as any).getCanvas?.()?._canvas as HTMLCanvasElement | undefined;
      if (canvasEl) {
        canvasEl.style.mixBlendMode = layer.blendMode || "normal";
      }
    }

    // Remove any Konva layers that no longer exist in store
    for (const [id, kLayer] of konvaLayers) {
      if (!canvas.layers.find((l) => l.id === id)) {
        kLayer.destroy();
        konvaLayers.delete(id);
      }
    }

    reorderStageLayers();
  }

  function applyViewport() {
    if (!stage) return;
    const { zoom, panX, panY } = canvas.viewport;

    if (borderRect) {
      borderRect.strokeWidth(1 / zoom);
    }

    // Apply to all content layers (bg + reference + persisted mask + canvas layers), but NOT the UI layer.
    const layers = [bgLayer, refLayer, persistedMaskLayer, ...konvaLayers.values()];
    for (const layer of layers) {
      if (!layer) continue;
      layer.scaleX(zoom);
      layer.scaleY(zoom);
      layer.x(panX);
      layer.y(panY);
    }

    stage.batchDraw();
  }

  // Get pointer position in canvas coordinates (accounting for zoom/pan)
  function getCanvasPos(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>): { x: number; y: number } | null {
    if (!stage) return null;
    const pointerPos = stage.getPointerPosition();
    if (!pointerPos) return null;

    const { zoom, panX, panY } = canvas.viewport;
    return {
      x: (pointerPos.x - panX) / zoom,
      y: (pointerPos.y - panY) / zoom,
    };
  }

  function getActiveKonvaLayer(): Konva.Layer | null {
    if (!canvas.activeLayerId) return null;
    return konvaLayers.get(canvas.activeLayerId) ?? null;
  }

  function isInpaintMaskMode(): boolean {
    return generation.mode === "inpainting" && canvas.inpaintDrawMode === "mask";
  }

  function isInpaintingMode(): boolean {
    return generation.mode === "inpainting";
  }

  function getMaskTargetLayer(): { layer: (typeof canvas.layers)[number]; kLayer: Konva.Layer } | null {
    const maskLayer = canvas.layers.find((l) => l.type === "mask");
    if (!maskLayer || maskLayer.locked) return null;

    const kLayer = konvaLayers.get(maskLayer.id) ?? null;
    if (!kLayer) return null;

    return { layer: maskLayer, kLayer };
  }

  function getDrawingTargetLayer(): { layer: (typeof canvas.layers)[number]; kLayer: Konva.Layer } | null {
    if (isInpaintMaskMode()) {
      return getMaskTargetLayer();
    }

    const layer = canvas.activeLayer;
    if (!layer || layer.locked) return null;

    const kLayer = getActiveKonvaLayer();
    if (!kLayer) return null;

    return { layer, kLayer };
  }

  async function autoCommitMaskIfNeeded() {
    if (!isInpaintMaskMode()) return;
    try {
      await canvas.syncMaskToGeneration(getMaskCanvas(), false);
    } catch (error) {
      console.error("Failed to auto-sync inpaint mask:", error);
    }
  }

  // Regenerate the small pixel preview shown for a layer in the layer panel.
  function refreshLayerThumbnail(id: string) {
    const kLayer = konvaLayers.get(id);
    if (!kLayer) return;

    const w = canvas.canvasWidth;
    const h = canvas.canvasHeight;
    const maxDim = Math.max(w, h);
    if (maxDim <= 0) return;

    // The viewport is applied as a layer transform; reset it so the thumbnail
    // captures canvas-space pixels at a fixed scale, then restore it.
    const origScale = kLayer.scaleX();
    const origX = kLayer.x();
    const origY = kLayer.y();
    kLayer.scaleX(1);
    kLayer.scaleY(1);
    kLayer.x(0);
    kLayer.y(0);

    let url: string | null = null;
    try {
      url = kLayer.toDataURL({
        pixelRatio: 64 / maxDim,
        width: w,
        height: h,
        x: 0,
        y: 0,
      });
    } catch (error) {
      console.error("Failed to generate layer thumbnail:", error);
    } finally {
      kLayer.scaleX(origScale);
      kLayer.scaleY(origScale);
      kLayer.x(origX);
      kLayer.y(origY);
    }

    if (url) canvas.setLayerThumbnail(id, url);
  }

  // Coalesce thumbnail regeneration to one per frame per layer so painting
  // never regenerates a thumbnail mid-stroke.
  function scheduleThumbRefresh(id: string) {
    if (thumbRafs.has(id)) return;
    const raf = requestAnimationFrame(() => {
      thumbRafs.delete(id);
      refreshLayerThumbnail(id);
    });
    thumbRafs.set(id, raf);
  }

  function loadImageEl(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  // Re-hydrate a preserved inpaint mask (tinted, transparent-bg data URL) onto
  // the freshly-rebuilt mask layer after a base swap or an inpaint-base undo.
  async function restoreMaskFromSnapshot(url: string) {
    if (!stage) return;
    const maskMeta = canvas.layers.find((l) => l.type === "mask");
    if (!maskMeta) return;
    const kLayer = konvaLayers.get(maskMeta.id);
    if (!kLayer) return;

    let img: HTMLImageElement;
    try {
      img = await loadImageEl(url);
    } catch {
      return;
    }

    // The layer may have been rebuilt again while the image loaded; bail if so.
    if (!stage || konvaLayers.get(maskMeta.id) !== kLayer) return;

    kLayer.destroyChildren();
    // Place the restored mask proportionally within the new canvas, letterboxed
    // when the aspect ratio changed (e.g. 1:1 → 16:9). The mask is stretched to
    // fill while preserving its original proportions; areas outside the mask's
    // native aspect ratio are left unmasked (transparent).
    const maskAspect = img.naturalWidth / img.naturalHeight;
    const canvasAspect = canvas.canvasWidth / canvas.canvasHeight;
    let drawW = canvas.canvasWidth;
    let drawH = canvas.canvasHeight;
    let drawX = 0;
    let drawY = 0;
    if (maskAspect > canvasAspect) {
      drawH = canvas.canvasWidth / maskAspect;
      drawY = (canvas.canvasHeight - drawH) / 2;
    } else if (maskAspect < canvasAspect) {
      drawW = canvas.canvasHeight * maskAspect;
      drawX = (canvas.canvasWidth - drawW) / 2;
    }
    const kImage = new Konva.Image({
      image: img,
      x: drawX,
      y: drawY,
      width: drawW,
      height: drawH,
      listening: false,
    });
    kLayer.add(kImage);
    kLayer.batchDraw();
    scheduleThumbRefresh(maskMeta.id);
  }

  async function handleMergeDown(upperLayerId: string): Promise<boolean> {
    if (!stage) return false;
    const sorted = [...canvas.layers].sort((a, b) => b.order - a.order);
    const index = sorted.findIndex((l) => l.id === upperLayerId);
    if (index < 0 || index >= sorted.length - 1) return false;
    const upperMeta = sorted[index];
    const lowerMeta = sorted[index + 1];
    if (upperMeta.type !== "raster" || lowerMeta.type !== "raster") return false;

    const kUpper = konvaLayers.get(upperMeta.id);
    const kLower = konvaLayers.get(lowerMeta.id);
    if (!kUpper || !kLower) return false;

    const uScaleX = kUpper.scaleX(); const uScaleY = kUpper.scaleY(); const uX = kUpper.x(); const uY = kUpper.y();
    const lScaleX = kLower.scaleX(); const lScaleY = kLower.scaleY(); const lX = kLower.x(); const lY = kLower.y();
    kUpper.scaleX(1); kUpper.scaleY(1); kUpper.x(0); kUpper.y(0);
    kLower.scaleX(1); kLower.scaleY(1); kLower.x(0); kLower.y(0);

    const offscreen = document.createElement("canvas");
    offscreen.width = canvas.canvasWidth;
    offscreen.height = canvas.canvasHeight;
    const ctx = offscreen.getContext("2d")!;

    // 1. Draw lower layer
    const lowerCanvas = kLower.toCanvas({ pixelRatio: 1, width: canvas.canvasWidth, height: canvas.canvasHeight });
    ctx.globalAlpha = lowerMeta.opacity;
    const lowerBlend = (lowerMeta.blendMode && lowerMeta.blendMode !== "normal") ? lowerMeta.blendMode : "source-over";
    ctx.globalCompositeOperation = lowerBlend as GlobalCompositeOperation;
    ctx.drawImage(lowerCanvas, 0, 0);

    // 2. Draw upper layer on top
    const upperCanvas = kUpper.toCanvas({ pixelRatio: 1, width: canvas.canvasWidth, height: canvas.canvasHeight });
    ctx.globalAlpha = upperMeta.opacity;
    const upperBlend = (upperMeta.blendMode && upperMeta.blendMode !== "normal") ? upperMeta.blendMode : "source-over";
    ctx.globalCompositeOperation = upperBlend as GlobalCompositeOperation;
    ctx.drawImage(upperCanvas, 0, 0);

    kUpper.scaleX(uScaleX); kUpper.scaleY(uScaleY); kUpper.x(uX); kUpper.y(uY);
    kLower.scaleX(lScaleX); kLower.scaleY(lScaleY); kLower.x(lX); kLower.y(lY);

    const mergedDataUrl = offscreen.toDataURL();
    try {
      const img = await loadImageEl(mergedDataUrl);
      kLower.destroyChildren();
      const kImg = new Konva.Image({
        image: img,
        x: 0,
        y: 0,
        width: canvas.canvasWidth,
        height: canvas.canvasHeight,
        listening: false,
      });
      kLower.add(kImg);
      kLower.batchDraw();
      scheduleThumbRefresh(lowerMeta.id);

      canvas.removeLayer(upperMeta.id);
      canvas.setActiveLayer(lowerMeta.id);
      return true;
    } catch {
      return false;
    }
  }

  async function handleFlatten(): Promise<boolean> {
    if (!stage) return false;
    const compositeCanvas = getRasterComposite();
    if (!compositeCanvas) return false;

    const rasterLayers = [...canvas.layers].filter((l) => l.type === "raster").sort((a, b) => a.order - b.order);
    if (rasterLayers.length <= 1) return false;

    const baseLayer = rasterLayers[0];
    const kBase = konvaLayers.get(baseLayer.id);
    if (!kBase) return false;

    const mergedDataUrl = compositeCanvas.toDataURL();
    try {
      const img = await loadImageEl(mergedDataUrl);
      kBase.destroyChildren();
      const kImg = new Konva.Image({
        image: img,
        x: 0,
        y: 0,
        width: canvas.canvasWidth,
        height: canvas.canvasHeight,
        listening: false,
      });
      kBase.add(kImg);
      kBase.opacity(1);
      canvas.setLayerOpacity(baseLayer.id, 1);
      canvas.setLayerBlendMode(baseLayer.id, "normal");
      canvas.renameLayer(baseLayer.id, locale.t("canvas.layer.background") || "Background");
      kBase.batchDraw();
      scheduleThumbRefresh(baseLayer.id);

      for (let i = 1; i < rasterLayers.length; i++) {
        canvas.removeLayer(rasterLayers[i].id);
      }
      canvas.setActiveLayer(baseLayer.id);
      return true;
    } catch {
      return false;
    }
  }

  async function handleAcceptStagingToLayer(asNewLayer: boolean): Promise<boolean> {
    if (!stage || !canvas.currentStagingImage) return false;
    try {
      const img = await loadImageEl(canvas.currentStagingImage);

      let targetLayerId = canvas.activeLayerId;
      if (asNewLayer || !targetLayerId) {
        targetLayerId = canvas.addLayer("raster");
        syncKonvaLayers();
      }

      const kLayer = konvaLayers.get(targetLayerId);
      if (!kLayer) return false;

      const kImage = new Konva.Image({
        image: img,
        x: 0,
        y: 0,
        width: canvas.canvasWidth,
        height: canvas.canvasHeight,
        listening: false,
      });
      kLayer.add(kImage);
      kLayer.batchDraw();
      scheduleThumbRefresh(targetLayerId);
      return true;
    } catch {
      return false;
    }
  }

  async function handleDuplicateLayer(sourceId: string, newId: string): Promise<boolean> {
    if (!stage) return false;
    const sourceMeta = canvas.layers.find((l) => l.id === sourceId);
    if (!sourceMeta) return false;

    const kSource = konvaLayers.get(sourceId);
    if (!kSource) return false;

    syncKonvaLayers();
    const kNew = konvaLayers.get(newId);
    if (!kNew) return false;

    const sX = kSource.scaleX();
    const sY = kSource.scaleY();
    const origX = kSource.x();
    const origY = kSource.y();

    // 1. Vector clone: preserves individual Konva Line, Rect, and Image shapes
    try {
      const children = kSource.getChildren();
      if (children && children.length > 0) {
        kNew.destroyChildren();
        for (const child of children) {
          kNew.add(child.clone());
        }
        kNew.scaleX(sX);
        kNew.scaleY(sY);
        kNew.x(origX);
        kNew.y(origY);
        kNew.batchDraw();
        scheduleThumbRefresh(newId);
        return true;
      }
    } catch (e) {
      console.warn("Vector layer clone failed, falling back to raster:", e);
    }

    // 2. Fallback to raster snapshot
    kSource.scaleX(1);
    kSource.scaleY(1);
    kSource.x(0);
    kSource.y(0);

    let srcCanvas: HTMLCanvasElement;
    try {
      srcCanvas = kSource.toCanvas({
        pixelRatio: 1,
        width: canvas.canvasWidth,
        height: canvas.canvasHeight,
      });
    } finally {
      kSource.scaleX(sX);
      kSource.scaleY(sY);
      kSource.x(origX);
      kSource.y(origY);
    }

    const dataUrl = srcCanvas.toDataURL();
    try {
      const img = await loadImageEl(dataUrl);
      kNew.destroyChildren();
      const kImg = new Konva.Image({
        image: img,
        x: 0,
        y: 0,
        width: canvas.canvasWidth,
        height: canvas.canvasHeight,
        listening: false,
      });
      kNew.add(kImg);
      kNew.scaleX(sX);
      kNew.scaleY(sY);
      kNew.x(origX);
      kNew.y(origY);
      kNew.batchDraw();
      scheduleThumbRefresh(newId);
      return true;
    } catch (e) {
      console.error("Failed to clone duplicate layer pixels:", e);
      return false;
    }
  }

  async function handleApplyInpaintAsLayer(): Promise<boolean> {
    if (!stage || !canvas.pendingResultPreviewUrl) return false;
    try {
      const resultImg = await loadImageEl(canvas.pendingResultPreviewUrl);
      const maskCanvas = getMaskCanvas();
      const rasterComposite = getRasterComposite();

      const width = canvas.canvasWidth;
      const height = canvas.canvasHeight;

      // 1. Create solid alpha cutout mask with edge feathering
      const alphaCanvas = document.createElement("canvas");
      alphaCanvas.width = width;
      alphaCanvas.height = height;
      const actx = alphaCanvas.getContext("2d");
      if (!actx) return false;

      let hasAlphaData = false;
      if (maskCanvas) {
        const mctx = maskCanvas.getContext("2d");
        if (mctx) {
          const mdata = mctx.getImageData(0, 0, width, height);
          const adata = actx.createImageData(width, height);
          for (let i = 0; i < mdata.data.length; i += 4) {
            if (mdata.data[i + 3] > 0 && (mdata.data[i] > 16 || mdata.data[i + 1] > 16 || mdata.data[i + 2] > 16)) {
              adata.data[i] = 255;
              adata.data[i + 1] = 255;
              adata.data[i + 2] = 255;
              adata.data[i + 3] = 255;
              hasAlphaData = true;
            }
          }
          actx.putImageData(adata, 0, 0);
        }
      }

      // If no explicit mask content, compute pixel diff against baseline
      if (!hasAlphaData && rasterComposite) {
        const bctx = rasterComposite.getContext("2d");
        const tempCanvas = document.createElement("canvas");
        tempCanvas.width = width;
        tempCanvas.height = height;
        const tctx = tempCanvas.getContext("2d");
        if (bctx && tctx) {
          tctx.drawImage(resultImg, 0, 0, width, height);
          const bdata = bctx.getImageData(0, 0, width, height);
          const rdata = tctx.getImageData(0, 0, width, height);
          const adata = actx.createImageData(width, height);
          for (let i = 0; i < bdata.data.length; i += 4) {
            const diff = Math.abs(bdata.data[i] - rdata.data[i]) +
                         Math.abs(bdata.data[i + 1] - rdata.data[i + 1]) +
                         Math.abs(bdata.data[i + 2] - rdata.data[i + 2]);
            if (diff > 20) {
              adata.data[i] = 255;
              adata.data[i + 1] = 255;
              adata.data[i + 2] = 255;
              adata.data[i + 3] = 255;
              hasAlphaData = true;
            }
          }
          actx.putImageData(adata, 0, 0);
        }
      }

      // 2. Feather mask edges (radius 2px) for seamless boundary blending
      if (hasAlphaData) {
        gaussianBlurCanvas(alphaCanvas, 2);
      }

      // 3. Cut out result image using the feathered alpha mask
      const patchCanvas = document.createElement("canvas");
      patchCanvas.width = width;
      patchCanvas.height = height;
      const pctx = patchCanvas.getContext("2d");
      if (!pctx) return false;

      pctx.drawImage(resultImg, 0, 0, width, height);
      if (hasAlphaData) {
        pctx.globalCompositeOperation = "destination-in";
        pctx.drawImage(alphaCanvas, 0, 0);
      }

      const patchDataUrl = patchCanvas.toDataURL("image/png");
      const patchImg = await loadImageEl(patchDataUrl);

      const targetLayerId = canvas.addLayer("raster", "Inpaint Patch");
      syncKonvaLayers();

      const kLayer = konvaLayers.get(targetLayerId);
      if (!kLayer) return false;

      const { zoom, panX, panY } = canvas.viewport;
      kLayer.scaleX(zoom);
      kLayer.scaleY(zoom);
      kLayer.x(panX);
      kLayer.y(panY);

      const kImage = new Konva.Image({
        image: patchImg,
        x: 0,
        y: 0,
        width,
        height,
        listening: false,
      });
      kLayer.add(kImage);
      kLayer.batchDraw();
      scheduleThumbRefresh(targetLayerId);

      canvas.consumePendingInpaintResult();
      stage.batchDraw();
      return true;
    } catch (err) {
      console.error("Failed to apply inpaint as layer:", err);
      return false;
    }
  }

  function handleInvertMask(): boolean {
    const maskMeta = canvas.layers.find((l) => l.type === "mask");
    if (!maskMeta) return false;
    const kLayer = konvaLayers.get(maskMeta.id);
    if (!kLayer) return false;

    canvasHistory.snapshot(maskMeta.id);

    const origScale = kLayer.scaleX();
    const origX = kLayer.x();
    const origY = kLayer.y();
    kLayer.scaleX(1);
    kLayer.scaleY(1);
    kLayer.x(0);
    kLayer.y(0);

    const currentMaskCanvas = kLayer.toCanvas({
      pixelRatio: 1,
      width: canvas.canvasWidth,
      height: canvas.canvasHeight,
    });

    kLayer.scaleX(origScale);
    kLayer.scaleY(origScale);
    kLayer.x(origX);
    kLayer.y(origY);

    const ctx = currentMaskCanvas.getContext("2d");
    if (!ctx) return false;

    const imgData = ctx.getImageData(0, 0, canvas.canvasWidth, canvas.canvasHeight);
    const data = imgData.data;

    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] > 20) {
        data[i + 3] = 0;
      } else {
        data[i] = 255;
        data[i + 1] = 51;
        data[i + 2] = 51;
        data[i + 3] = 115;
      }
    }
    ctx.putImageData(imgData, 0, 0);

    kLayer.destroyChildren();
    const invImg = new Image();
    invImg.onload = () => {
      const kImage = new Konva.Image({
        image: invImg,
        x: 0,
        y: 0,
        width: canvas.canvasWidth,
        height: canvas.canvasHeight,
        listening: false,
      });
      kLayer.add(kImage);
      kLayer.batchDraw();
      scheduleThumbRefresh(maskMeta.id);
    };
    invImg.src = currentMaskCanvas.toDataURL();
    return true;
  }

  async function getLayerDataUrls(): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    for (const layer of canvas.layers) {
      const kLayer = konvaLayers.get(layer.id);
      if (!kLayer) continue;

      const origScale = kLayer.scaleX();
      const origX = kLayer.x();
      const origY = kLayer.y();
      kLayer.scaleX(1);
      kLayer.scaleY(1);
      kLayer.x(0);
      kLayer.y(0);

      const dataUrl = kLayer.toDataURL({
        pixelRatio: 1,
        width: canvas.canvasWidth,
        height: canvas.canvasHeight,
      });

      kLayer.scaleX(origScale);
      kLayer.scaleY(origScale);
      kLayer.x(origX);
      kLayer.y(origY);

      result[layer.id] = dataUrl;
    }
    return result;
  }

  async function loadLayersFromProject(project: FalafelProjectDocument): Promise<void> {
    if (!stage) return;
    if (transformTargetGroup) {
      commitTransform();
    }

    for (const [id, kLayer] of konvaLayers) {
      kLayer.destroy();
    }
    konvaLayers.clear();

    canvas.canvasWidth = project.canvas.width;
    canvas.canvasHeight = project.canvas.height;
    generation.width = project.canvas.width;
    generation.height = project.canvas.height;
    if (project.canvas.positivePrompt) generation.positivePrompt = project.canvas.positivePrompt;
    if (project.canvas.negativePrompt) generation.negativePrompt = project.canvas.negativePrompt;

    canvas.layers = project.layers.map((l) => ({
      id: l.id,
      name: l.name,
      type: l.type,
      visible: l.visible,
      opacity: l.opacity,
      locked: l.locked,
      order: l.order,
      blendMode: (l.blendMode as any) || "normal",
      denoise: (l as any).denoise ?? (l.type === "mask" ? 0.7 : 1.0),
      prompt: l.prompt,
    }));

    syncKonvaLayers();

    for (const l of project.layers) {
      if (!l.dataUrl) continue;
      const kLayer = konvaLayers.get(l.id);
      if (!kLayer) continue;

      try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = reject;
          image.src = l.dataUrl;
        });

        const kImage = new Konva.Image({
          image: img,
          x: 0,
          y: 0,
          width: project.canvas.width,
          height: project.canvas.height,
          listening: false,
        });
        kLayer.add(kImage);
        kLayer.batchDraw();
        scheduleThumbRefresh(l.id);
      } catch (err) {
        console.error("Failed to load project layer image:", l.id, err);
      }
    }

    const topRaster = [...canvas.layers].filter((l) => l.type === "raster").sort((a, b) => b.order - a.order)[0];
    canvas.activeLayerId = topRaster ? topRaster.id : canvas.layers[0]?.id ?? null;
    applyViewport();
  }

  function activateTransform(targetLayerId: string | null) {
    if (!stage || !targetLayerId) return;
    if (transformTargetGroup && transformActiveLayerId === targetLayerId) return;
    if (transformTargetGroup) {
      commitTransform();
    }

    const activeMeta = canvas.layers.find((l) => l.id === targetLayerId);
    if (!activeMeta || activeMeta.locked || !activeMeta.visible) {
      canvas.setTool(canvas.previousTool ?? "brush");
      return;
    }

    const kLayer = konvaLayers.get(targetLayerId);
    if (!kLayer) {
      canvas.setTool(canvas.previousTool ?? "brush");
      return;
    }

    const children = kLayer.getChildren().filter((node) => node !== transformer && node.name() !== "active-transform-group");
    if (children.length === 0) {
      canvas.setTool(canvas.previousTool ?? "brush");
      return;
    }

    canvasHistory.snapshot(targetLayerId);

    transformTargetGroup = new Konva.Group({
      draggable: true,
      name: "active-transform-group",
    });

    for (const child of children) {
      child.moveTo(transformTargetGroup);
    }
    kLayer.add(transformTargetGroup);

    transformer = new Konva.Transformer({
      nodes: [transformTargetGroup],
      rotateEnabled: true,
      rotationSnaps: [0, 45, 90, 135, 180, 225, 270, 315],
      borderStroke: "#6366f1",
      borderStrokeWidth: 1.5,
      borderDash: [4, 4],
      anchorStroke: "#4f46e5",
      anchorFill: "#ffffff",
      anchorSize: 10,
      anchorCornerRadius: 2,
      keepRatio: false,
    });
    kLayer.add(transformer);
    transformActiveLayerId = targetLayerId;
    kLayer.batchDraw();
  }

  function commitTransform() {
    if (!transformTargetGroup || !transformActiveLayerId) return;

    const kLayer = konvaLayers.get(transformActiveLayerId);
    if (transformer) {
      transformer.destroy();
      transformer = null;
    }

    if (!kLayer) {
      transformTargetGroup.destroy();
      transformTargetGroup = null;
      transformActiveLayerId = null;
      return;
    }

    const origScale = kLayer.scaleX();
    const origX = kLayer.x();
    const origY = kLayer.y();
    kLayer.scaleX(1);
    kLayer.scaleY(1);
    kLayer.x(0);
    kLayer.y(0);

    const bakedCanvas = kLayer.toCanvas({
      pixelRatio: 1,
      width: canvas.canvasWidth,
      height: canvas.canvasHeight,
    });

    kLayer.scaleX(origScale);
    kLayer.scaleY(origScale);
    kLayer.x(origX);
    kLayer.y(origY);

    const layerId = transformActiveLayerId;
    transformTargetGroup.destroy();
    transformTargetGroup = null;
    transformActiveLayerId = null;

    kLayer.destroyChildren();

    const img = new Image();
    img.onload = () => {
      const kImage = new Konva.Image({
        image: img,
        x: 0,
        y: 0,
        width: canvas.canvasWidth,
        height: canvas.canvasHeight,
        listening: false,
      });
      kLayer.add(kImage);
      kLayer.batchDraw();
      scheduleThumbRefresh(layerId);
    };
    img.src = bakedCanvas.toDataURL();
  }

  function cancelTransform() {
    if (!transformTargetGroup || !transformActiveLayerId) return;

    if (transformer) {
      transformer.destroy();
      transformer = null;
    }
    transformTargetGroup.destroy();
    transformTargetGroup = null;

    const layerId = transformActiveLayerId;
    transformActiveLayerId = null;

    void canvasHistory.undo();
    scheduleThumbRefresh(layerId);
    canvas.setTool(canvas.previousTool ?? "brush");
  }

  // Drawing handlers
  function handlePointerDown(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    const evt = e.evt as MouseEvent;

    // Middle mouse → pan
    if (evt.button === 1) {
      isPanning = true;
      lastPointerPos = stage!.getPointerPosition();
      e.evt.preventDefault();
      return;
    }

    // Right click → ignore (context menu)
    const isTemporaryInpaintErase = evt.button === 2 && isInpaintingMode();
    if (evt.button === 2 && !isTemporaryInpaintErase) return;
    if (isTemporaryInpaintErase) e.evt.preventDefault();

    const tool = isTemporaryInpaintErase ? "eraser" : canvas.activeTool;
    const pos = getCanvasPos(e);
    if (!pos) return;

    if (tool === "view") {
      isPanning = true;
      lastPointerPos = stage!.getPointerPosition();
      return;
    }

    if (tool === "transform") {
      return;
    }

    if (tool === "brush" || tool === "eraser") {
      const target = getDrawingTargetLayer();
      if (!target) return;
      const { layer, kLayer } = target;

      // Painting more mask over a previewed result brings the mask back on screen.
      if (layer.type === "mask") canvas.markMaskEdited();

      // Snapshot for undo before drawing
      canvasHistory.snapshot(layer.id);

      isDrawing = true;
      activeStrokeTool = tool;

      const inpaintMaskMode = isInpaintMaskMode();

      const color = tool === "eraser"
        ? "#000000"
        : inpaintMaskMode
          ? canvas.maskOverlayColor
          : layer.type === "mask"
          ? canvas.maskOverlayColor
          : canvas.foregroundColor;

      const drawOpacity = tool === "eraser"
        ? 1
        : inpaintMaskMode
          ? Math.min(canvas.brushSettings.opacity, 0.45)
          : canvas.brushSettings.opacity;

      currentLine = new Konva.Line({
        stroke: color,
        strokeWidth: canvas.brushSettings.size,
        opacity: drawOpacity,
        globalCompositeOperation: tool === "eraser" ? "destination-out" : "source-over",
        lineCap: "round",
        lineJoin: "round",
        tension: 0,
        points: [pos.x, pos.y, pos.x, pos.y],
        listening: false,
      });

      kLayer.add(currentLine);
      kLayer.batchDraw();
    }

    if (tool === "rectFill") {
      const target = getDrawingTargetLayer();
      if (!target) return;
      const { layer } = target;

      if (layer.type === "mask") canvas.markMaskEdited();

      // Snapshot for undo before rect fill
      canvasHistory.snapshot(layer.id);

      isDrawingRect = true;
      rectStartPos = pos;

      const inpaintMaskMode = isInpaintMaskMode();

      // Create preview rect on UI layer
      const color = inpaintMaskMode
        ? canvas.maskOverlayColor
        : layer.type === "mask"
          ? canvas.maskOverlayColor
          : canvas.foregroundColor;
      rectPreview = new Konva.Rect({
        x: pos.x,
        y: pos.y,
        width: 0,
        height: 0,
        fill: color,
        opacity: inpaintMaskMode ? 0.35 : 0.4,
        listening: false,
      });
      uiLayer?.add(rectPreview);
    }

    if (tool === "eyedropper") {
      sampleColor(pos);
    }

    if (tool === "lasso") {
      const target = getDrawingTargetLayer();
      if (!target) return;
      const { layer } = target;

      if (layer.type === "mask") canvas.markMaskEdited();

      // Snapshot for undo before committing the lasso fill.
      canvasHistory.snapshot(layer.id);

      isLasso = true;
      lassoPoints = [pos.x, pos.y];

      const inpaintMaskMode = isInpaintMaskMode();
      const color = inpaintMaskMode
        ? canvas.maskOverlayColor
        : layer.type === "mask"
          ? canvas.maskOverlayColor
          : canvas.foregroundColor;

      // Preview lives on the unscaled UI layer, so points are in screen space.
      const { zoom, panX, panY } = canvas.viewport;
      lassoPreviewLine = new Konva.Line({
        points: [pos.x * zoom + panX, pos.y * zoom + panY],
        stroke: color,
        strokeWidth: 1.5,
        dash: [4, 4],
        closed: false,
        listening: false,
      });
      uiLayer?.add(lassoPreviewLine);
      uiLayer?.batchDraw();
    }

    if (tool === "move") {
      const layer = canvas.activeLayer;
      if (!layer || layer.locked) return;

      const kLayer = getActiveKonvaLayer();
      if (!kLayer) return;

      canvasHistory.snapshot(layer.id);
      canvas.beginMove(layer.id, pos.x, pos.y);

      isMovingLayer = true;
      moveStartPos = pos;
      moveNodeStarts = kLayer.getChildren().map((node) => ({
        node,
        x: node.x(),
        y: node.y(),
      }));
    }
  }

  function handlePointerMove(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    if (!stage) return;

    const pointerPos = stage.getPointerPosition();
    if (!pointerPos) return;

    // Update canvas cursor position
    const canvasPos = getCanvasPos(e);
    canvas.cursorPos = canvasPos;

    // Update brush cursor
    if (brushCursor && canvasPos) {
      const tool = activeStrokeTool ?? canvas.activeTool;
      const showCursor = tool === "brush" || tool === "eraser";
      brushCursor.visible(showCursor);
      if (showCursor) {
        brushCursor.x(canvasPos.x);
        brushCursor.y(canvasPos.y);
        brushCursor.radius(canvas.brushSettings.size / 2);
        brushCursor.stroke(tool === "eraser" ? "#ffffff" : canvas.foregroundColor);
        // Position brush cursor in screen space within UI layer
        const { zoom, panX, panY } = canvas.viewport;
        brushCursor.x(canvasPos.x * zoom + panX);
        brushCursor.y(canvasPos.y * zoom + panY);
        brushCursor.radius((canvas.brushSettings.size * zoom) / 2);
        brushCursor.strokeWidth(1.5);
        uiLayer?.batchDraw();
      }
    }

    // Panning
    if (isPanning && lastPointerPos) {
      const dx = pointerPos.x - lastPointerPos.x;
      const dy = pointerPos.y - lastPointerPos.y;
      canvas.viewport = {
        ...canvas.viewport,
        panX: canvas.viewport.panX + dx,
        panY: canvas.viewport.panY + dy,
      };
      lastPointerPos = pointerPos;
      scheduleViewportApply();
      return;
    }

    // Drawing
    if (isDrawing && currentLine) {
      const pos = getCanvasPos(e);
      if (!pos) return;

      const points = currentLine.points();
      currentLine.points([...points, pos.x, pos.y]);
      // Redraw the layer the stroke actually lives on. In inpaint-mask mode the
      // line is added to the mask layer, not the active layer, so redrawing the
      // active layer here would leave the in-progress stroke invisible.
      currentLine.getLayer()?.batchDraw();
    }

    // Rectangle preview
    if (isDrawingRect && rectPreview && rectStartPos) {
      const pos = getCanvasPos(e);
      if (!pos) return;

      const x = Math.min(rectStartPos.x, pos.x);
      const y = Math.min(rectStartPos.y, pos.y);
      const w = Math.abs(pos.x - rectStartPos.x);
      const h = Math.abs(pos.y - rectStartPos.y);

      // Position in screen space for UI layer
      const { zoom, panX, panY } = canvas.viewport;
      rectPreview.x(x * zoom + panX);
      rectPreview.y(y * zoom + panY);
      rectPreview.width(w * zoom);
      rectPreview.height(h * zoom);
      uiLayer?.batchDraw();
    }

    if (isMovingLayer && moveStartPos) {
      const pos = getCanvasPos(e);
      if (!pos) return;

      const dx = pos.x - moveStartPos.x;
      const dy = pos.y - moveStartPos.y;
      canvas.updateMove(pos.x, pos.y);

      for (const entry of moveNodeStarts) {
        entry.node.x(entry.x + dx);
        entry.node.y(entry.y + dy);
      }
      getActiveKonvaLayer()?.batchDraw();
    }

    // Lasso preview (append screen-space point to the dashed outline)
    if (isLasso && lassoPreviewLine) {
      const pos = getCanvasPos(e);
      if (!pos) return;

      lassoPoints = [...lassoPoints, pos.x, pos.y];
      const { zoom, panX, panY } = canvas.viewport;
      const prev = lassoPreviewLine.points();
      lassoPreviewLine.points([...prev, pos.x * zoom + panX, pos.y * zoom + panY]);
      uiLayer?.batchDraw();
    }

    if (tooltipRaf === null) {
      tooltipRaf = requestAnimationFrame(() => updateTooltip(e));
    }
  }

  function handlePointerUp(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    if (isPanning) {
      isPanning = false;
      lastPointerPos = null;
      return;
    }
    
    if (tooltipVisible) {
      tooltipVisible = false;
    }

    let shouldAutoCommitMask = false;

    if (isDrawing) {
      // Capture the layer the stroke lives on before clearing currentLine.
      const strokeLayerId = currentLine?.getLayer()?.id();
      isDrawing = false;
      currentLine = null;
      activeStrokeTool = null;
      shouldAutoCommitMask = true;
      if (strokeLayerId) scheduleThumbRefresh(strokeLayerId);
    }
    
    if (isDrawingRect && rectStartPos) {
      isDrawingRect = false;
      const pos = getCanvasPos(e);
      if (pos) {
        // Create final rect on the active Konva layer
        const target = getDrawingTargetLayer();
        if (target) {
          const { layer, kLayer } = target;
          const x = Math.min(rectStartPos.x, pos.x);
          const y = Math.min(rectStartPos.y, pos.y);
          const w = Math.abs(pos.x - rectStartPos.x);
          const h = Math.abs(pos.y - rectStartPos.y);

          if (w > 1 && h > 1) {
            const inpaintMaskMode = isInpaintMaskMode();

            const color = inpaintMaskMode
              ? canvas.maskOverlayColor
              : layer.type === "mask"
                ? canvas.maskOverlayColor
                : canvas.foregroundColor;
            const rect = new Konva.Rect({
              x, y, width: w, height: h,
              fill: color,
              opacity: inpaintMaskMode
                ? Math.min(canvas.brushSettings.opacity, 0.45)
                : canvas.brushSettings.opacity,
              listening: false,
            });
            kLayer.add(rect);
            kLayer.batchDraw();
            shouldAutoCommitMask = true;
            scheduleThumbRefresh(layer.id);
          }
        }
      }

      // Remove preview from UI layer
      if (rectPreview) {
        rectPreview.destroy();
        rectPreview = null;
        uiLayer?.batchDraw();
      }
      rectStartPos = null;
    }

    if (isLasso) {
      isLasso = false;
      const target = getDrawingTargetLayer();
      if (target && lassoPoints.length >= 6) {
        const { layer, kLayer } = target;
        const inpaintMaskMode = isInpaintMaskMode();
        const color = inpaintMaskMode
          ? canvas.maskOverlayColor
          : layer.type === "mask"
            ? canvas.maskOverlayColor
            : canvas.foregroundColor;
        const shape = new Konva.Line({
          points: [...lassoPoints],
          closed: true,
          fill: color,
          opacity: inpaintMaskMode
            ? Math.min(canvas.brushSettings.opacity, 0.45)
            : canvas.brushSettings.opacity,
          listening: false,
        });
        kLayer.add(shape);
        kLayer.batchDraw();
        shouldAutoCommitMask = true;
        scheduleThumbRefresh(layer.id);
      }
      lassoPoints = [];
      if (lassoPreviewLine) {
        lassoPreviewLine.destroy();
        lassoPreviewLine = null;
        uiLayer?.batchDraw();
      }
    }

    if (isMovingLayer) {
      isMovingLayer = false;
      moveStartPos = null;
      moveNodeStarts = [];
      canvas.endMove();
    }

    if (shouldAutoCommitMask) {
      void autoCommitMaskIfNeeded();
    }
  }

  function handlePointerLeave(e?: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
    tooltipVisible = false;
    canvas.isPointerOverStage = false;
    canvas.cursorPos = null;
    if (brushCursor) {
      brushCursor.visible(false);
      uiLayer?.batchDraw();
    }

    if (isSpacePanning) {
      isSpacePanning = false;
      canvas.restorePreviousTool();
    }

    if (isPanning) {
      isPanning = false;
      lastPointerPos = null;
    }

    // If a drawing operation is active when pointer leaves stage, finalize it cleanly
    // so strokes and shapes aren't lost or left in dangling state.
    if ((isDrawing || isDrawingRect || isLasso) && e) {
      handlePointerUp(e);
      return;
    }

    if (isDrawing) {
      const strokeLayerId = currentLine?.getLayer()?.id();
      isDrawing = false;
      currentLine = null;
      activeStrokeTool = null;
      if (strokeLayerId) scheduleThumbRefresh(strokeLayerId);
      void autoCommitMaskIfNeeded();
    }

    if (isDrawingRect) {
      isDrawingRect = false;
      if (rectStartPos) {
        const target = getDrawingTargetLayer();
        if (target) {
          const { layer, kLayer } = target;
          const x = rectStartPos.x;
          const y = rectStartPos.y;
          const w = 1;
          const h = 1;
          if (w > 0 && h > 0) {
            const inpaintMaskMode = isInpaintMaskMode();
            const color = inpaintMaskMode
              ? canvas.maskOverlayColor
              : layer.type === "mask"
                ? canvas.maskOverlayColor
                : canvas.foregroundColor;
            const rect = new Konva.Rect({
              x, y, width: w, height: h,
              fill: color,
              opacity: inpaintMaskMode
                ? Math.min(canvas.brushSettings.opacity, 0.45)
                : canvas.brushSettings.opacity,
              listening: false,
            });
            kLayer.add(rect);
            kLayer.batchDraw();
            scheduleThumbRefresh(layer.id);
          }
        }
      }
      rectStartPos = null;
      if (rectPreview) {
        rectPreview.destroy();
        rectPreview = null;
        uiLayer?.batchDraw();
      }
      void autoCommitMaskIfNeeded();
    }

    if (isLasso) {
      isLasso = false;
      const target = getDrawingTargetLayer();
      if (target && lassoPoints.length >= 6) {
        const { layer, kLayer } = target;
        const inpaintMaskMode = isInpaintMaskMode();
        const color = inpaintMaskMode
          ? canvas.maskOverlayColor
          : layer.type === "mask"
            ? canvas.maskOverlayColor
            : canvas.foregroundColor;
        const shape = new Konva.Line({
          points: [...lassoPoints],
          closed: true,
          fill: color,
          opacity: inpaintMaskMode
            ? Math.min(canvas.brushSettings.opacity, 0.45)
            : canvas.brushSettings.opacity,
          listening: false,
        });
        kLayer.add(shape);
        kLayer.batchDraw();
        scheduleThumbRefresh(layer.id);
      }
      lassoPoints = [];
      if (lassoPreviewLine) {
        lassoPreviewLine.destroy();
        lassoPreviewLine = null;
        uiLayer?.batchDraw();
      }
      void autoCommitMaskIfNeeded();
    }

    if (isMovingLayer) {
      isMovingLayer = false;
      moveStartPos = null;
      moveNodeStarts = [];
      canvas.endMove();
    }
  }

  function handlePointerEnter() {
    canvas.isPointerOverStage = true;
  }

  function handleWheel(e: Konva.KonvaEventObject<WheelEvent>) {
    e.evt.preventDefault();
    const pointerPos = stage!.getPointerPosition();
    if (!pointerPos) return;

    const delta = e.evt.deltaY;
    const scaleBy = 1.08;
    const oldZoom = canvas.viewport.zoom;
    const newZoom = delta > 0 ? oldZoom / scaleBy : oldZoom * scaleBy;

    canvas.setZoom(newZoom, pointerPos.x, pointerPos.y);
    scheduleViewportApply();
  }

  function sampleColor(pos: { x: number; y: number }) {
    if (!stage) return;

    // Composite all visible layers
    const compositeCanvas = stage.toCanvas({
      pixelRatio: 1,
    });
    const ctx = compositeCanvas.getContext("2d")!;
    const { zoom, panX, panY } = canvas.viewport;
    const screenX = pos.x * zoom + panX;
    const screenY = pos.y * zoom + panY;
    const pixel = ctx.getImageData(Math.round(screenX), Math.round(screenY), 1, 1).data;

    if (pixel[3] > 0) {
      const hex = `#${pixel[0].toString(16).padStart(2, "0")}${pixel[1].toString(16).padStart(2, "0")}${pixel[2].toString(16).padStart(2, "0")}`;
      canvas.foregroundColor = hex;
    }
  }

  // Keyboard shortcuts (Space pan, Eyedropper, Layer management, Staging)
  function handleKeyDown(e: KeyboardEvent) {
    // If typing in an input/textarea, ignore shortcuts
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
      return;
    }

    // Escape cancels an in-progress lasso even if the pointer left the stage.
    if (e.code === "Escape" && isLasso) {
      isLasso = false;
      lassoPoints = [];
      if (lassoPreviewLine) {
        lassoPreviewLine.destroy();
        lassoPreviewLine = null;
        uiLayer?.batchDraw();
      }
      return;
    }

    // Staging keyboard shortcuts
    if (canvas.isStagingActive) {
      if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey) {
        e.preventDefault();
        void canvas.acceptStagingToCurrentLayer();
        return;
      }
      if (e.key === "Enter" && e.shiftKey && !e.ctrlKey) {
        e.preventDefault();
        void canvas.acceptStagingToNewLayer();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        canvas.clearStaging();
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        canvas.prevStaging();
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        canvas.nextStaging();
        return;
      }
    }

    // Layer management shortcuts (Photoshop standard)
    const isCtrl = e.ctrlKey || e.metaKey;
    if (isCtrl && e.key.toLowerCase() === "j") {
      e.preventDefault();
      canvas.duplicateActiveLayer();
      return;
    }
    if (isCtrl && !e.shiftKey && e.key.toLowerCase() === "e") {
      e.preventDefault();
      void canvas.mergeDownActiveLayer();
      return;
    }
    if (isCtrl && e.shiftKey && e.key.toLowerCase() === "e") {
      e.preventDefault();
      void canvas.flattenLayers();
      return;
    }
    if (e.key === "\\" || e.key === "|") {
      e.preventDefault();
      canvas.toggleShowOriginal();
      return;
    }

    if (canvas.activeTool === "transform") {
      if (e.key === "Enter") {
        e.preventDefault();
        commitTransform();
        canvas.setTool(canvas.previousTool ?? "brush");
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        cancelTransform();
        return;
      }
    }

    if (!canvas.isPointerOverStage) return;

    if (e.code === "Space" && !isSpacePanning && !e.repeat) {
      isSpacePanning = true;
      canvas.setTool("view");
      e.preventDefault();
    }

    // Hold Alt for a quick eyedropper; release restores the previous tool.
    if (e.altKey && !isAltEyedropper && !e.repeat && canvas.activeTool !== "eyedropper") {
      isAltEyedropper = true;
      canvas.setTool("eyedropper");
      e.preventDefault();
    }
  }

  function handleKeyUp(e: KeyboardEvent) {
    if (e.code === "Space" && isSpacePanning) {
      isSpacePanning = false;
      canvas.restorePreviousTool();
    }

    if (isAltEyedropper && !e.altKey) {
      isAltEyedropper = false;
      canvas.restorePreviousTool();
    }
  }

  // Reactive effects
  $effect(() => {
    // Re-sync Konva layers when canvas layers change
    void canvas.layers;
    syncKonvaLayers();
    applyViewport();

    // Re-hydrate a preserved inpaint mask onto the freshly-rebuilt mask layer
    // (set by the store on a base swap or an inpaint-base undo).
    const restoreUrl = canvas.pendingMaskRestoreUrl;
    if (restoreUrl) {
      canvas.pendingMaskRestoreUrl = null;
      void restoreMaskFromSnapshot(restoreUrl);
    }

    // Generate an initial thumbnail for any layer we haven't captured yet.
    for (const layer of canvas.layers) {
      if (!thumbInitialized.has(layer.id)) {
        thumbInitialized.add(layer.id);
        scheduleThumbRefresh(layer.id);
      }
    }
    // Forget removed layers so a re-added id regenerates and drop pending RAFs.
    for (const id of [...thumbInitialized]) {
      if (!canvas.layers.find((l) => l.id === id)) {
        thumbInitialized.delete(id);
        const raf = thumbRafs.get(id);
        if (raf !== undefined) {
          cancelAnimationFrame(raf);
          thumbRafs.delete(id);
        }
      }
    }
  });

  let historyDims = { w: 0, h: 0 };
  $effect(() => {
    // Keep undo/redo snapshot dimensions in sync with the canvas. When the
    // canvas is resized (e.g. a new image is loaded) existing snapshots no
    // longer match the new dimensions, so discard them rather than restoring
    // stretched or clipped pixels.
    const w = canvas.canvasWidth;
    const h = canvas.canvasHeight;
    if (w === historyDims.w && h === historyDims.h) return;
    const hadDims = historyDims.w !== 0 || historyDims.h !== 0;
    historyDims = { w, h };
    canvasHistory.setRefs(konvaLayers, w, h);
    if (hadDims) canvasHistory.clear();
  });

  $effect(() => {
    // Re-apply viewport when it changes (coalesced to one frame)
    void canvas.viewport;
    scheduleViewportApply();
  });

  $effect(() => {
    // Redraw checkerboard when toggle changes
    void canvas.showCheckerboard;
    if (bgLayer) {
      if (canvas.showCheckerboard) {
        drawCheckerboard();
      } else {
        bgLayer.destroyChildren();
        bgLayer.batchDraw();
      }
    }
  });

  $effect(() => {
    void canvas.effectiveReferenceImage;
    updateReferenceImage(canvas.effectiveReferenceImage);
  });

  $effect(() => {
    // Toggle layer visibility when showingOriginal or pending-result hide state changes.
    // Only the Konva node's visibility is touched, never the layer model's
    // `visible`, so the panel toggle and mask export (which reads the model) are
    // unaffected.
    const showOrig = canvas.showingOriginal;
    const hide = hideInpaintMask;
    void canvas.layers;
    if (!stage) return;
    for (const layer of canvas.layers) {
      const kLayer = konvaLayers.get(layer.id);
      if (!kLayer) continue;
      kLayer.visible(!showOrig && layer.visible && !(layer.type === "mask" && hide));
    }
    stage.batchDraw();
  });

  $effect(() => {
    void canvas.persistedMaskPreviewUrl;
    void canvas.maskOverlayVisible;
    void canvas.maskOverlayColor;
    void canvas.maskOverlayOpacity;
    void canvas.canvasWidth;
    void canvas.canvasHeight;
    updatePersistedMaskOverlay(canvas.persistedMaskPreviewUrl);
  });

  $effect(() => {
    const tool = canvas.activeTool;
    const activeId = canvas.activeLayerId;
    if (tool === "transform") {
      activateTransform(activeId);
    } else {
      if (transformTargetGroup) {
        commitTransform();
      }
    }
  });

  // Public API for export
  export function getRasterComposite(): HTMLCanvasElement | null {
    if (!stage) return null;

    const offscreen = document.createElement("canvas");
    offscreen.width = canvas.canvasWidth;
    offscreen.height = canvas.canvasHeight;
    const ctx = offscreen.getContext("2d")!;

    const sorted = [...canvas.layers]
      .filter((l) => l.type === "raster" && l.visible)
      .sort((a, b) => a.order - b.order);

    for (const layer of sorted) {
      const kLayer = konvaLayers.get(layer.id);
      if (!kLayer) continue;

      // Reset layer transform temporarily for export
      const origScaleX = kLayer.scaleX();
      const origScaleY = kLayer.scaleY();
      const origX = kLayer.x();
      const origY = kLayer.y();
      const origVisible = kLayer.visible();
      kLayer.scaleX(1);
      kLayer.scaleY(1);
      kLayer.x(0);
      kLayer.y(0);
      kLayer.visible(true);

      try {
        const layerCanvas = kLayer.toCanvas({
          pixelRatio: 1,
          width: canvas.canvasWidth,
          height: canvas.canvasHeight,
        });

        ctx.globalAlpha = layer.opacity;
        const blend = (layer.blendMode && layer.blendMode !== "normal") ? layer.blendMode : "source-over";
        ctx.globalCompositeOperation = blend as GlobalCompositeOperation;
        ctx.drawImage(layerCanvas, 0, 0);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
      } catch (err) {
        console.error("Failed to capture raster layer:", err);
      } finally {
        kLayer.scaleX(origScaleX);
        kLayer.scaleY(origScaleY);
        kLayer.x(origX);
        kLayer.y(origY);
        kLayer.visible(origVisible);
      }
    }

    return offscreen;
  }

  export function getMaskCanvas(): HTMLCanvasElement | null {
    if (!stage) return null;

    const maskLayers = canvas.layers.filter((l) => l.type === "mask" && l.visible);
    if (maskLayers.length === 0) return null;

    const offscreen = document.createElement("canvas");
    offscreen.width = canvas.canvasWidth;
    offscreen.height = canvas.canvasHeight;
    const ctx = offscreen.getContext("2d")!;

    for (const layer of maskLayers) {
      const kLayer = konvaLayers.get(layer.id);
      if (!kLayer) continue;

      const origScaleX = kLayer.scaleX();
      const origScaleY = kLayer.scaleY();
      const origX = kLayer.x();
      const origY = kLayer.y();
      // The mask node may be visually hidden while a result is previewed; Konva
      // renders nothing for an invisible node, so force it visible for the capture
      // and restore afterwards (no on-screen redraw happens in between).
      const origVisible = kLayer.visible();
      kLayer.scaleX(1);
      kLayer.scaleY(1);
      kLayer.x(0);
      kLayer.y(0);
      kLayer.visible(true);

      try {
        const layerCanvas = kLayer.toCanvas({
          pixelRatio: 1,
          width: canvas.canvasWidth,
          height: canvas.canvasHeight,
        });

        ctx.drawImage(layerCanvas, 0, 0);
      } catch (err) {
        console.error("Failed to capture mask layer:", err);
      } finally {
        kLayer.scaleX(origScaleX);
        kLayer.scaleY(origScaleY);
        kLayer.x(origX);
        kLayer.y(origY);
        kLayer.visible(origVisible);
      }
    }

    return offscreen;
  }

  export function getLayerCanvas(layerId: string): HTMLCanvasElement | null {
    if (!stage) return null;
    const kLayer = konvaLayers.get(layerId);
    if (!kLayer) return null;

    const offscreen = document.createElement("canvas");
    offscreen.width = canvas.canvasWidth;
    offscreen.height = canvas.canvasHeight;
    const ctx = offscreen.getContext("2d");
    if (!ctx) return null;

    const origScaleX = kLayer.scaleX();
    const origScaleY = kLayer.scaleY();
    const origX = kLayer.x();
    const origY = kLayer.y();
    const origVisible = kLayer.visible();
    kLayer.scaleX(1);
    kLayer.scaleY(1);
    kLayer.x(0);
    kLayer.y(0);
    kLayer.visible(true);

    try {
      const layerCanvas = kLayer.toCanvas({
        pixelRatio: 1,
        width: canvas.canvasWidth,
        height: canvas.canvasHeight,
      });
      ctx.drawImage(layerCanvas, 0, 0);
    } catch (err) {
      console.error("Failed to capture layer:", err);
      return null;
    } finally {
      kLayer.scaleX(origScaleX);
      kLayer.scaleY(origScaleY);
      kLayer.x(origX);
      kLayer.y(origY);
      kLayer.visible(origVisible);
    }

    return offscreen;
  }

  // Get cursor style based on active tool
  function getCursorClass(): string {
    const tool = canvas.activeTool;
    if (isPanning || tool === "view") return "cursor-grab";
    if (tool === "move") return "cursor-move";
    if (tool === "transform") return "cursor-default";
    if (tool === "eyedropper" || tool === "lasso") return "cursor-crosshair";
    if (tool === "brush" || tool === "eraser") return "cursor-none";
    return "cursor-default";
  }

  // Mask upscale/downscale support
  export function captureContentForResize(): { maskUrl: string | null; rasterUrl: string | null } {
    const maskCanvas = getMaskCanvas();
    const rasterCanvas = getRasterComposite();
    return {
      maskUrl: maskCanvas ? maskCanvas.toDataURL("image/png") : null,
      rasterUrl: rasterCanvas ? rasterCanvas.toDataURL("image/png") : null,
    };
  }

  function stampImageOnLayer(kLayer: Konva.Layer, dataUrl: string, targetW: number, targetH: number) {
    const img = new Image();
    img.onload = () => {
      kLayer.destroyChildren();
      const konvaImg = new Konva.Image({
        image: img,
        x: 0,
        y: 0,
        width: targetW,
        height: targetH,
        listening: false,
      });
      kLayer.add(konvaImg);
      kLayer.batchDraw();
    };
    img.src = dataUrl;
  }

  $effect(() => {
    const pending = canvas._maskRestorePending;
    if (!pending) return;

    // Use rAF to guarantee Konva layers are synchronised before stamping.
    const restore = () => {
      if (konvaLayers.size === 0) {
        // Layers not ready yet — retry once on next frame.
        requestAnimationFrame(restore);
        return;
      }

      const sorted = [...canvas.layers].sort((a, b) => a.order - b.order);

      for (const layerMeta of sorted) {
        const kLayer = konvaLayers.get(layerMeta.id);
        if (!kLayer) continue;

        if (layerMeta.type === "raster" && pending.rasterUrl) {
          stampImageOnLayer(kLayer, pending.rasterUrl, canvas.canvasWidth, canvas.canvasHeight);
        } else if (layerMeta.type === "mask" && pending.maskUrl) {
          stampImageOnLayer(kLayer, pending.maskUrl, canvas.canvasWidth, canvas.canvasHeight);
        }
      }

      // Re-load reference image at the new canvas dimensions
      if (refLayer && lastRefSource) {
        updateReferenceImage(lastRefSource);
      }

      drawCheckerboard();
      reorderStageLayers();

      // Restore layer properties (denoise, opacity, etc.) from saved state
      if (pending.savedLayers) {
        const sortedSavedRaster = pending.savedLayers.filter((l) => l.type === "raster");
        const sortedSavedMask = pending.savedLayers.filter((l) => l.type === "mask");
        const currentRaster = sorted.filter((l) => l.type === "raster");
        const currentMask = sorted.filter((l) => l.type === "mask");

        for (let i = 0; i < currentRaster.length && i < sortedSavedRaster.length; i++) {
          canvas.setLayerOpacity(currentRaster[i].id, sortedSavedRaster[i].opacity);
          canvas.setLayerDenoise(currentRaster[i].id, sortedSavedRaster[i].denoise);
          canvas.renameLayer(currentRaster[i].id, sortedSavedRaster[i].name);
          if (sortedSavedRaster[i].visible !== currentRaster[i].visible) canvas.toggleLayerVisibility(currentRaster[i].id);
          if (sortedSavedRaster[i].locked !== currentRaster[i].locked) canvas.toggleLayerLock(currentRaster[i].id);
        }
        for (let i = 0; i < currentMask.length && i < sortedSavedMask.length; i++) {
          canvas.setLayerOpacity(currentMask[i].id, sortedSavedMask[i].opacity);
          canvas.setLayerDenoise(currentMask[i].id, sortedSavedMask[i].denoise);
          canvas.renameLayer(currentMask[i].id, sortedSavedMask[i].name);
          if (sortedSavedMask[i].visible !== currentMask[i].visible) canvas.toggleLayerVisibility(currentMask[i].id);
          if (sortedSavedMask[i].locked !== currentMask[i].locked) canvas.toggleLayerLock(currentMask[i].id);
        }
      }

      canvas._maskRestorePending = null;
    };

    requestAnimationFrame(restore);
  });
</script>

<svelte:window onkeydown={handleKeyDown} onkeyup={handleKeyUp} />

<div
  class="w-full h-full relative overflow-hidden bg-neutral-950 {getCursorClass()}"
  bind:this={containerEl}
>
  {#if tooltipVisible}
    <div class="fixed" style="left: {tooltipPos.x}px; top: {tooltipPos.y}px; z-index: 100; pointer-events: none;">
      <ColorTooltip color={tooltipColor} />
    </div>
  {/if}
</div>
