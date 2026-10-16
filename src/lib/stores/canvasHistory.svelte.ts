import Konva from "konva";
import type { CanvasLayer, CanvasBlendMode, CanvasLayerType } from "../types/canvas.js";

export interface LayerMetadataSnapshot {
  id: string;
  name: string;
  type: CanvasLayerType;
  visible: boolean;
  locked: boolean;
  opacity: number;
  order: number;
  blendMode?: CanvasBlendMode;
  denoise?: number;
  prompt?: string;
  linkedLayerId?: string;
  inverted?: boolean;
  maskBlur?: number;
  color?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  negativePrompt?: string;
  weight?: number;
  model?: string;
  preprocessor?: string;
  strength?: number;
  startPercent?: number;
  endPercent?: number;
  referenceImage?: string;
  thumbnail?: string;
}

export interface CanvasHistorySnapshot {
  id: string;
  timestamp: number;
  description: string;
  canvasWidth: number;
  canvasHeight: number;
  activeLayerId: string | null;
  layers: LayerMetadataSnapshot[];
  layerPixels: Record<string, string>;
}

export const MAX_HISTORY = 64;

export class CanvasHistoryStore {
  undoStack = $state<any[]>([]);
  redoStack = $state<any[]>([]);
  maxDepth = MAX_HISTORY;

  private _konvaLayers: Map<string, Konva.Layer> | null = null;
  private _canvasWidth = 0;
  private _canvasHeight = 0;
  private _canvasStore: any = null;
  private _onRestored: ((layerIds: string[]) => void) | null = null;

  connectCanvasStore(store: any) {
    this._canvasStore = store;
  }

  setRefs(konvaLayers: Map<string, Konva.Layer>, canvasWidth: number, canvasHeight: number) {
    this._konvaLayers = konvaLayers;
    this._canvasWidth = canvasWidth;
    this._canvasHeight = canvasHeight;
  }

  setOnRestored(cb: ((layerIds: string[]) => void) | null) {
    this._onRestored = cb;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  // Snapshot specific layers before a destructive operation
  snapshotLayers(layerIds: string[]) {
    this.snapshot({ layerIds });
  }

  // Dual-mode snapshot: supports pure functional state (E2E tests) AND live canvas store capture
  snapshot(arg?: any) {
    // Clear redo when a new action is recorded
    this.redoStack = [];

    // Check if this is a functional state snapshot (e.g. from E2E test or unit test: { layers: [...] } or array)
    if (arg && typeof arg === "object" && !("layerIds" in arg && Object.keys(arg).length === 1)) {
      const cloned = JSON.parse(JSON.stringify(arg));
      this.undoStack = [...this.undoStack.slice(-(this.maxDepth - 1)), cloned];
      return;
    }

    // Live canvas store snapshot
    if (!this._canvasStore) {
      if (!this._konvaLayers) return;
      const targetIds = (arg && arg.layerIds) ? arg.layerIds : (typeof arg === "string" ? [arg] : Array.from(this._konvaLayers.keys()));
      const fallbackEntry: Record<string, string> = {};
      for (const id of targetIds) {
        const kLayer = this._konvaLayers.get(id);
        if (kLayer) {
          const origScaleX = kLayer.scaleX();
          const origScaleY = kLayer.scaleY();
          const origX = kLayer.x();
          const origY = kLayer.y();
          kLayer.scaleX(1);
          kLayer.scaleY(1);
          kLayer.x(0);
          kLayer.y(0);
          fallbackEntry[id] = kLayer.toDataURL({
            pixelRatio: 1,
            width: this._canvasWidth || 512,
            height: this._canvasHeight || 512,
          });
          kLayer.scaleX(origScaleX);
          kLayer.scaleY(origScaleY);
          kLayer.x(origX);
          kLayer.y(origY);
        }
      }
      this.undoStack = [...this.undoStack.slice(-(this.maxDepth - 1)), fallbackEntry];
      return;
    }

    const store = this._canvasStore;
    const description = typeof arg === "string" ? arg : (arg?.description || "Canvas Modification");
    const targetLayerIds: string[] | null = arg?.layerIds ?? (typeof arg === "string" && store.layers.some((l: any) => l.id === arg) ? [arg] : null);

    // Snapshot layer metadata
    const layersClone: LayerMetadataSnapshot[] = store.layers.map((l: CanvasLayer) => ({
      ...JSON.parse(JSON.stringify(l)),
    }));

    // Copy-on-write structural sharing for layerPixels
    const previousSnapshot = this.undoStack[this.undoStack.length - 1];
    const previousPixels = (previousSnapshot && typeof previousSnapshot === "object" && "layerPixels" in previousSnapshot)
      ? previousSnapshot.layerPixels
      : {};
    // Copy-on-write structural sharing for layerPixels (pruning unreferenced deleted layers)
    const currentLayerIds = new Set(store.layers.map((l: CanvasLayer) => l.id));
    const layerPixels: Record<string, string> = {};
    for (const [id, pixels] of Object.entries(previousPixels)) {
      if (currentLayerIds.has(id)) {
        layerPixels[id] = pixels as string;
      }
    }

    if (this._konvaLayers) {
      for (const l of store.layers) {
        if (l.type === "raster" || l.type === "mask") {
          // If specific targetLayerIds are specified, only export those (COW)
          if (targetLayerIds && !targetLayerIds.includes(l.id) && layerPixels[l.id]) {
            continue;
          }
          const kLayer = this._konvaLayers.get(l.id);
          if (kLayer) {
            const origScaleX = kLayer.scaleX();
            const origScaleY = kLayer.scaleY();
            const origX = kLayer.x();
            const origY = kLayer.y();
            kLayer.scaleX(1);
            kLayer.scaleY(1);
            kLayer.x(0);
            kLayer.y(0);

            layerPixels[l.id] = kLayer.toDataURL({
              pixelRatio: 1,
              width: store.canvasWidth,
              height: store.canvasHeight,
            });

            kLayer.scaleX(origScaleX);
            kLayer.scaleY(origScaleY);
            kLayer.x(origX);
            kLayer.y(origY);
          }
        }
      }
    }

    const snapshotObj: CanvasHistorySnapshot = {
      id: `snap_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: Date.now(),
      description,
      canvasWidth: store.canvasWidth,
      canvasHeight: store.canvasHeight,
      activeLayerId: store.activeLayerId,
      layers: layersClone,
      layerPixels,
    };

    this.undoStack = [...this.undoStack.slice(-(this.maxDepth - 1)), snapshotObj];
  }

  // Dual-mode undo
  undo(currentState?: any): any {
    if (this.undoStack.length === 0) {
      return currentState;
    }

    if (currentState !== undefined) {
      // Functional mode
      this.redoStack.push(JSON.parse(JSON.stringify(currentState)));
      return this.undoStack.pop();
    }

    // Live UI mode
    const targetSnapshot = this.undoStack[this.undoStack.length - 1];
    if (!targetSnapshot) return;

    // Capture current state for redo
    const currentSnapshot = this._captureCurrentSnapshot("Before Undo");
    this.redoStack = [...this.redoStack.slice(-(this.maxDepth - 1)), currentSnapshot];
    this.undoStack = this.undoStack.slice(0, -1);

    void this._applySnapshot(targetSnapshot);
    return targetSnapshot;
  }

  // Dual-mode redo
  redo(currentState?: any): any {
    if (this.redoStack.length === 0) {
      return currentState;
    }

    if (currentState !== undefined) {
      // Functional mode
      this.undoStack.push(JSON.parse(JSON.stringify(currentState)));
      return this.redoStack.pop();
    }

    // Live UI mode
    const targetSnapshot = this.redoStack[this.redoStack.length - 1];
    if (!targetSnapshot) return;

    // Capture current state for undo
    const currentSnapshot = this._captureCurrentSnapshot("Before Redo");
    this.undoStack = [...this.undoStack.slice(-(this.maxDepth - 1)), currentSnapshot];
    this.redoStack = this.redoStack.slice(0, -1);

    void this._applySnapshot(targetSnapshot);
    return targetSnapshot;
  }

  private _captureCurrentSnapshot(description: string): CanvasHistorySnapshot {
    const store = this._canvasStore;
    if (!store) {
      return {
        id: `snap_${Date.now()}`,
        timestamp: Date.now(),
        description,
        canvasWidth: this._canvasWidth,
        canvasHeight: this._canvasHeight,
        activeLayerId: null,
        layers: [],
        layerPixels: {},
      };
    }

    const layersClone: LayerMetadataSnapshot[] = store.layers.map((l: any) => ({
      ...JSON.parse(JSON.stringify(l)),
    }));
    const layerPixels: Record<string, string> = {};

    if (this._konvaLayers) {
      for (const l of store.layers) {
        if (l.type === "raster" || l.type === "mask") {
          const kLayer = this._konvaLayers.get(l.id);
          if (kLayer) {
            const origScaleX = kLayer.scaleX();
            const origScaleY = kLayer.scaleY();
            const origX = kLayer.x();
            const origY = kLayer.y();
            kLayer.scaleX(1);
            kLayer.scaleY(1);
            kLayer.x(0);
            kLayer.y(0);

            layerPixels[l.id] = kLayer.toDataURL({
              pixelRatio: 1,
              width: store.canvasWidth,
              height: store.canvasHeight,
            });

            kLayer.scaleX(origScaleX);
            kLayer.scaleY(origScaleY);
            kLayer.x(origX);
            kLayer.y(origY);
          }
        }
      }
    }

    return {
      id: `snap_${Date.now()}`,
      timestamp: Date.now(),
      description,
      canvasWidth: store.canvasWidth,
      canvasHeight: store.canvasHeight,
      activeLayerId: store.activeLayerId,
      layers: layersClone,
      layerPixels,
    };
  }

  private async _applySnapshot(snapshot: any) {
    if (!snapshot) return;

    // If it's a legacy HistoryEntry[] or record
    if (Array.isArray(snapshot)) {
      if (!this._konvaLayers) return;
      for (const entry of snapshot) {
        const kLayer = this._konvaLayers.get(entry.layerId);
        if (!kLayer) continue;
        const img = await this._loadImage(entry.imageData);
        kLayer.destroyChildren();
        const kImage = new Konva.Image({
          image: img,
          x: 0,
          y: 0,
          width: this._canvasWidth,
          height: this._canvasHeight,
          listening: false,
        });
        kLayer.add(kImage);
        kLayer.batchDraw();
      }
      this._onRestored?.(snapshot.map((e: any) => e.layerId));
      return;
    }

    // Full CanvasHistorySnapshot
    const snap = snapshot as CanvasHistorySnapshot;
    const store = this._canvasStore;

    // Phase 1: Preload all images in parallel (Zero-flicker double buffering)
    const entries = Object.entries(snap.layerPixels || {});
    const preloadedImages = new Map<string, HTMLImageElement>();
    await Promise.all(
      entries.map(async ([layerId, dataUrl]) => {
        try {
          const img = await this._loadImage(dataUrl);
          preloadedImages.set(layerId, img);
        } catch (e) {
          console.warn("Failed to preload history image for layer:", layerId, e);
        }
      })
    );

    // Phase 2: Restore store metadata
    if (store) {
      if (snap.canvasWidth && snap.canvasHeight) {
        store.canvasWidth = snap.canvasWidth;
        store.canvasHeight = snap.canvasHeight;
      }
      if (Array.isArray(snap.layers)) {
        store.layers = snap.layers.map((l) => ({ ...l }));
      }
      store.activeLayerId = snap.activeLayerId;

      // Sync Konva layer objects
      if (store._stageOps?.syncKonvaLayers) {
        store._stageOps.syncKonvaLayers();
      }
    }

    // Phase 3: Swap image nodes on Konva layers atomically
    if (this._konvaLayers) {
      for (const l of snap.layers || []) {
        const kLayer = this._konvaLayers.get(l.id);
        if (!kLayer) continue;

        const preloaded = preloadedImages.get(l.id);
        if (preloaded) {
          kLayer.destroyChildren();
          const kImage = new Konva.Image({
            image: preloaded,
            x: 0,
            y: 0,
            width: snap.canvasWidth || this._canvasWidth,
            height: snap.canvasHeight || this._canvasHeight,
            listening: false,
          });
          kLayer.add(kImage);
          kLayer.batchDraw();
        } else if (l.type === "raster" || l.type === "mask") {
          kLayer.destroyChildren();
          kLayer.batchDraw();
        }

        if (store?.setLayerThumbnail) {
          store.setLayerThumbnail(l.id, snap.layerPixels?.[l.id] || "");
        }
      }
    }

    // Phase 4: Stage redraw and notifications
    if (store?._stageOps?.reorderStageLayers) {
      store._stageOps.reorderStageLayers();
    }
    const layerIds = (snap.layers || []).map((l) => l.id);
    this._onRestored?.(layerIds);
  }

  private _loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
  }
}

export const canvasHistory = new CanvasHistoryStore();
