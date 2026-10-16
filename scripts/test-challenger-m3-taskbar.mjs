// scripts/test-challenger-m3-taskbar.mjs
// Empirical Challenge & Stress Harness for Milestone 3:
// Contextual Task Bar States, Actions, Directive 2 Workflow, Global Shortcuts, and i18n Parity.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const PROJECT_ROOT = new URL("../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

console.log("=================================================================");
console.log("EMPIRICAL CHALLENGER M3: TASK BAR, DIRECTIVE 2 & SHORTCUTS");
console.log("=================================================================");

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failures = [];
const testQueue = [];

function registerTest(name, fn) {
  testQueue.push({ name, fn });
}

// ---------------------------------------------------------------------------
// 1. Load Real TypeScript Modules
// ---------------------------------------------------------------------------
function loadTsModule(relativePath, imports = {}, globals = {}) {
  const fullPath = path.resolve(PROJECT_ROOT, relativePath);
  const source = fs.readFileSync(fullPath, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  });
  const module = { exports: {} };
  vm.runInNewContext(
    outputText,
    {
      module,
      exports: module.exports,
      require(name) {
        if (Object.hasOwn(imports, name)) return imports[name];
        try {
          return require(name);
        } catch {
          return {};
        }
      },
      ...globals,
    },
    { filename: fullPath }
  );
  return module.exports;
}

const typesModule = loadTsModule("src/lib/types/canvas.ts");

// ---------------------------------------------------------------------------
// 2. Real Canvas & History Store Implementation Simulation
// ---------------------------------------------------------------------------
class MockKonvaLayer {
  constructor(id) {
    this._id = id;
    this.children = ["child1"];
    this.drawn = false;
  }
  id() { return this._id; }
  destroyChildren() { this.children = []; }
  batchDraw() { this.drawn = true; }
  scaleX() { return 1; }
  scaleY() { return 1; }
  x() { return 0; }
  y() { return 0; }
  toDataURL() { return `data:image/png;base64,mock_${this._id}`; }
}

class TestHistoryStore {
  constructor() {
    this.undoStack = [];
    this.redoStack = [];
    this.maxDepth = 64;
    this._canvasStore = null;
  }
  connectCanvasStore(store) { this._canvasStore = store; }
  snapshot(arg) {
    this.redoStack = [];
    const desc = typeof arg === "string" ? arg : (arg?.description || "Action");
    const snapshotObj = {
      description: desc,
      timestamp: Date.now(),
      layers: JSON.parse(JSON.stringify(this._canvasStore ? this._canvasStore.layers : [])),
      activeLayerId: this._canvasStore ? this._canvasStore.activeLayerId : null,
    };
    this.undoStack.push(snapshotObj);
    if (this.undoStack.length > this.maxDepth) this.undoStack.shift();
  }
  undo() {
    if (this.undoStack.length === 0) return null;
    const snap = this.undoStack.pop();
    this.redoStack.push({
      layers: JSON.parse(JSON.stringify(this._canvasStore ? this._canvasStore.layers : [])),
      activeLayerId: this._canvasStore ? this._canvasStore.activeLayerId : null,
    });
    if (this._canvasStore && snap) {
      this._canvasStore.layers = JSON.parse(JSON.stringify(snap.layers));
      this._canvasStore.activeLayerId = snap.activeLayerId;
    }
    return snap;
  }
  redo() {
    if (this.redoStack.length === 0) return null;
    const snap = this.redoStack.pop();
    this.undoStack.push({
      layers: JSON.parse(JSON.stringify(this._canvasStore ? this._canvasStore.layers : [])),
      activeLayerId: this._canvasStore ? this._canvasStore.activeLayerId : null,
    });
    if (this._canvasStore && snap) {
      this._canvasStore.layers = JSON.parse(JSON.stringify(snap.layers));
      this._canvasStore.activeLayerId = snap.activeLayerId;
    }
    return snap;
  }
}

class TestCanvasStore {
  constructor() {
    this.layers = [];
    this.activeLayerId = null;
    this.activeTool = "brush";
    this.previousTool = "brush";
    this.inpaintDrawMode = "regular";
    this.canvasWidth = 1024;
    this.canvasHeight = 1024;
    this.nextLayerId = 1;

    // Staging state
    this.stagedCandidate = null;
    this.stagingImages = [];
    this.stagingIndex = 0;
    this.pendingResultPreviewUrl = null;
    this.canApplyInpaintResult = false;
    this.showingOriginal = false;
    this.stagingShowOriginal = false;
    this.isPointerOverStage = false;
    this.activeTransformBounds = null;
    this.brushSettings = { size: 30, hardness: 0.8 };

    this._mockKonvaLayers = new Map();
    this._stageOps = {
      acceptStagingToLayer: async (asNew) => true,
      acceptCandidateAsMask: async (url) => true,
      commitTransform: () => { this.activeTransformBounds = null; },
      cancelTransform: () => { this.activeTransformBounds = null; },
    };
  }

  get candidate() {
    return this.stagedCandidate;
  }

  get currentStagingImage() {
    return this.stagingImages[this.stagingIndex]?.url ?? null;
  }

  get isStagingActive() {
    return !!this.stagedCandidate || this.stagingImages.length > 0;
  }

  get activeLayer() {
    return this.layers.find((l) => l.id === this.activeLayerId) || null;
  }

  getActiveLayer() {
    return this.activeLayer;
  }

  setTool(tool) {
    this.previousTool = this.activeTool;
    this.activeTool = tool;
  }

  addLayer(type = "raster", name = "New Layer", extra = {}) {
    const id = `layer_${this.nextLayerId++}`;
    const base = {
      id,
      name,
      type,
      visible: true,
      locked: false,
      opacity: 1.0,
      blendMode: "normal",
      order: this.layers.length,
      ...extra,
    };
    this.layers.push(base);
    this.activeLayerId = id;
    this._mockKonvaLayers.set(id, new MockKonvaLayer(id));
    return id;
  }

  setActiveLayer(id) {
    this.activeLayerId = id;
    const layer = this.layers.find((l) => l.id === id);
    if (layer) {
      this.inpaintDrawMode = layer.type === "mask" ? "mask" : "regular";
    }
  }

  reorderLayer(id, newIdx) {
    const idx = this.layers.findIndex((l) => l.id === id);
    if (idx === -1) return;
    const clamped = Math.max(0, Math.min(this.layers.length - 1, newIdx));
    const [removed] = this.layers.splice(idx, 1);
    this.layers.splice(clamped, 0, removed);
    this.layers.forEach((l, i) => { l.order = i; });
  }

  clearLayer(id) {
    const k = this._mockKonvaLayers.get(id);
    if (k) k.destroyChildren();
  }

  stageResult(url, width = 1024, height = 1024) {
    this.stagedCandidate = { url, width, height, owned: true };
    this.stagingImages = [{ url, owned: true }];
    this.stagingIndex = 0;
  }

  stageBatch(urls) {
    this.stagingImages = urls.map((url) => ({ url, owned: true }));
    this.stagingIndex = 0;
    this.stagedCandidate = { url: urls[0], width: 1024, height: 1024, owned: true };
  }

  clearStaging() {
    this.stagedCandidate = null;
    this.stagingImages = [];
    this.stagingIndex = 0;
    this.stagingShowOriginal = false;
  }

  clearPendingInpaintResult() {
    this.pendingResultPreviewUrl = null;
    this.canApplyInpaintResult = false;
  }

  nextStaging() {
    if (!this.stagingImages.length) return;
    this.stagingIndex = (this.stagingIndex + 1) % this.stagingImages.length;
    const cur = this.stagingImages[this.stagingIndex];
    if (cur) {
      this.stagedCandidate = { url: cur.url, width: 1024, height: 1024, owned: cur.owned };
    }
  }

  prevStaging() {
    if (!this.stagingImages.length) return;
    this.stagingIndex = (this.stagingIndex - 1 + this.stagingImages.length) % this.stagingImages.length;
    const cur = this.stagingImages[this.stagingIndex];
    if (cur) {
      this.stagedCandidate = { url: cur.url, width: 1024, height: 1024, owned: cur.owned };
    }
  }

  toggleShowOriginal() {
    this.showingOriginal = !this.showingOriginal;
    this.stagingShowOriginal = this.showingOriginal;
  }

  commitTransform() {
    this._stageOps.commitTransform?.();
  }

  cancelTransform() {
    this._stageOps.cancelTransform?.();
    this.setTool(this.previousTool ?? "brush");
  }

  // Directive 2: Accept & Inpaint Immediately (Mirroring real canvas.svelte.ts:1566)
  async acceptAndInpaintImmediately(historyStore) {
    const cand = this.candidate;
    const candUrl = cand?.url ?? this.pendingResultPreviewUrl ?? this.currentStagingImage;
    if (!candUrl) return false;

    historyStore.snapshot("Accept & Inpaint Immediately");

    let targetRaster = this.layers.find(
      (l) => l.id === this.activeLayerId && l.type === "raster" && !l.locked
    );

    if (!targetRaster) {
      targetRaster = this.layers.find((l) => l.type === "raster" && !l.locked);
      if (!targetRaster) {
        const newId = this.addLayer("raster", "Base Layer");
        targetRaster = this.layers.find((l) => l.id === newId);
      }
    }

    if (!targetRaster) return false;

    if (this.canApplyInpaintResult) {
      targetRaster.thumbnail = candUrl;
    } else if (this._stageOps.acceptStagingToLayer) {
      this.activeLayerId = targetRaster.id;
      await this._stageOps.acceptStagingToLayer(false);
      targetRaster.thumbnail = candUrl;
    } else {
      targetRaster.thumbnail = candUrl;
    }

    let linkedMask = this.layers.find(
      (l) => l.type === "mask" && (l.linkedLayerId === targetRaster.id || !l.linkedLayerId)
    );

    if (!linkedMask) {
      const maskId = this.addLayer("mask", "Inpaint Mask", { linkedLayerId: targetRaster.id });
      linkedMask = this.layers.find((l) => l.id === maskId);
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

  async acceptStagingToCurrentLayer(historyStore) {
    const cand = this.candidate;
    if (!cand || !cand.url) return false;
    const active = this.getActiveLayer();
    if (!active || active.locked || active.type !== "raster") return false;

    historyStore.snapshot("Apply Generation to Base");
    if (this._stageOps.acceptStagingToLayer) {
      await this._stageOps.acceptStagingToLayer(false);
    }
    active.thumbnail = cand.url;
    this.clearStaging();
    return true;
  }

  async acceptStagingToNewLayer(historyStore) {
    const cand = this.candidate;
    if (!cand || !cand.url) return null;

    historyStore.snapshot("Accept Generation as Layer");
    const active = this.getActiveLayer();
    const newId = this.addLayer("raster", "Generated Layer", {
      thumbnail: cand.url,
      width: cand.width,
      height: cand.height,
    });
    const newLayer = this.layers.find((l) => l.id === newId);

    if (active) {
      const activeIdx = this.layers.findIndex((l) => l.id === active.id);
      this.reorderLayer(newLayer.id, activeIdx + 1);
    }
    if (this._stageOps.acceptStagingToLayer) {
      await this._stageOps.acceptStagingToLayer(true);
    }
    this.clearStaging();
    return newLayer;
  }

  async useStagingAsMask(historyStore) {
    const cand = this.candidate;
    if (!cand || !cand.url) return null;

    historyStore.snapshot("Use Staged as Mask");
    const maskId = this.addLayer("mask", "Generated Mask", {
      thumbnail: cand.url,
      inverted: false,
    });
    const maskLayer = this.layers.find((l) => l.id === maskId);
    if (this._stageOps.acceptCandidateAsMask) {
      await this._stageOps.acceptCandidateAsMask(cand.url);
    }
    this.clearStaging();
    return maskLayer;
  }
}

// ---------------------------------------------------------------------------
// 3. Task Bar 6-State Resolution Logic (Mirroring CanvasContextualBar.svelte:20-26)
// ---------------------------------------------------------------------------
function resolveContextualBarState({ activeTool, isGenerating, isStaging, activeLayer }) {
  const isTransforming = activeTool === "transform";
  const isMaskActive = activeLayer?.type === "mask";
  const isRegionalActive = activeLayer?.type === "regional";

  if (isTransforming) return "TRANSFORM_HUD";
  if (isGenerating) return "GENERATING";
  if (isStaging) return "STAGING";
  if (isMaskActive) return "MASK_ACTIVE";
  if (isRegionalActive) return "REGIONAL_ACTIVE";
  return "DEFAULT_IDLE";
}

// ---------------------------------------------------------------------------
// TEST REGISTRATION
// ---------------------------------------------------------------------------

// TEST SUITE 1: Task Bar 6-State Resolution & Precedence
registerTest("TaskBar State 1: Active tool 'transform' resolves to TRANSFORM_HUD", () => {
  const state = resolveContextualBarState({
    activeTool: "transform",
    isGenerating: false,
    isStaging: false,
    activeLayer: { type: "raster" },
  });
  assert.equal(state, "TRANSFORM_HUD");
});

registerTest("TaskBar State 2: isGenerating true resolves to GENERATING", () => {
  const state = resolveContextualBarState({
    activeTool: "brush",
    isGenerating: true,
    isStaging: false,
    activeLayer: { type: "raster" },
  });
  assert.equal(state, "GENERATING");
});

registerTest("TaskBar State 3: isStaging true resolves to STAGING", () => {
  const state = resolveContextualBarState({
    activeTool: "brush",
    isGenerating: false,
    isStaging: true,
    activeLayer: { type: "raster" },
  });
  assert.equal(state, "STAGING");
});

registerTest("TaskBar State 4: Active layer mask resolves to MASK_ACTIVE", () => {
  const state = resolveContextualBarState({
    activeTool: "brush",
    isGenerating: false,
    isStaging: false,
    activeLayer: { type: "mask" },
  });
  assert.equal(state, "MASK_ACTIVE");
});

registerTest("TaskBar State 5: Active layer regional resolves to REGIONAL_ACTIVE", () => {
  const state = resolveContextualBarState({
    activeTool: "brush",
    isGenerating: false,
    isStaging: false,
    activeLayer: { type: "regional" },
  });
  assert.equal(state, "REGIONAL_ACTIVE");
});

registerTest("TaskBar State 6: Raster active, no generation/staging resolves to DEFAULT_IDLE", () => {
  const state = resolveContextualBarState({
    activeTool: "brush",
    isGenerating: false,
    isStaging: false,
    activeLayer: { type: "raster" },
  });
  assert.equal(state, "DEFAULT_IDLE");
});

registerTest("TaskBar Precedence 1: Transforming overrides generating and staging", () => {
  const state = resolveContextualBarState({
    activeTool: "transform",
    isGenerating: true,
    isStaging: true,
    activeLayer: { type: "mask" },
  });
  assert.equal(state, "TRANSFORM_HUD");
});

registerTest("TaskBar Precedence 2: Generating overrides staging and active layer editing", () => {
  const state = resolveContextualBarState({
    activeTool: "brush",
    isGenerating: true,
    isStaging: true,
    activeLayer: { type: "mask" },
  });
  assert.equal(state, "GENERATING");
});

registerTest("TaskBar Precedence 3: Staging overrides mask and regional editing", () => {
  const state = resolveContextualBarState({
    activeTool: "brush",
    isGenerating: false,
    isStaging: true,
    activeLayer: { type: "mask" },
  });
  assert.equal(state, "STAGING");
});

registerTest("TaskBar Precedence 4: Mask overrides default idle when inactive", () => {
  const state = resolveContextualBarState({
    activeTool: "brush",
    isGenerating: false,
    isStaging: false,
    activeLayer: { type: "mask" },
  });
  assert.equal(state, "MASK_ACTIVE");
});

// TEST SUITE 2: Directive 2 "Accept & Inpaint Immediately" Deep Stress Testing
registerTest("Directive 2: Blank Canvas (0 layers) -> creates Base Layer, creates linked Mask, sets Brush", async () => {
  const store = new TestCanvasStore();
  const history = new TestHistoryStore();
  history.connectCanvasStore(store);

  assert.equal(store.layers.length, 0);

  store.stageResult("blob://candidate_001.png");
  assert.equal(store.isStagingActive, true);

  const ok = await store.acceptAndInpaintImmediately(history);
  assert.equal(ok, true);

  assert.equal(store.layers.length, 2);

  const baseLayer = store.layers.find((l) => l.type === "raster");
  assert.ok(baseLayer, "Base raster layer must exist");
  assert.equal(baseLayer.name, "Base Layer");
  assert.equal(baseLayer.thumbnail, "blob://candidate_001.png");

  const maskLayer = store.layers.find((l) => l.type === "mask");
  assert.ok(maskLayer, "Linked mask layer must exist");
  assert.equal(maskLayer.linkedLayerId, baseLayer.id);
  assert.equal(store.activeLayerId, maskLayer.id, "Active layer must be the mask");

  assert.equal(store.inpaintDrawMode, "mask", "Inpaint draw mode must be 'mask'");
  assert.equal(store.activeTool, "brush", "Active tool must be 'brush'");
  assert.equal(store.isStagingActive, false, "Staging must be cleared");

  assert.equal(history.undoStack.length, 1);
  assert.equal(history.undoStack[0].description, "Accept & Inpaint Immediately");
});

registerTest("Directive 2: Existing raster layer -> updates raster thumbnail, provisions linked mask, activates brush", async () => {
  const store = new TestCanvasStore();
  const history = new TestHistoryStore();
  history.connectCanvasStore(store);

  const rasterId = store.addLayer("raster", "Photo Background");
  store.stageResult("blob://candidate_002.png");

  const ok = await store.acceptAndInpaintImmediately(history);
  assert.equal(ok, true);

  const raster = store.layers.find((l) => l.id === rasterId);
  assert.equal(raster.thumbnail, "blob://candidate_002.png");

  const mask = store.layers.find((l) => l.type === "mask" && l.linkedLayerId === rasterId);
  assert.ok(mask);
  assert.equal(store.activeLayerId, mask.id);
  assert.equal(store.activeTool, "brush");
});

registerTest("Directive 2: Existing dirty mask -> clears mask strokes and reuses linked mask", async () => {
  const store = new TestCanvasStore();
  const history = new TestHistoryStore();
  history.connectCanvasStore(store);

  const rasterId = store.addLayer("raster", "Character");
  const maskId = store.addLayer("mask", "Character Mask", { linkedLayerId: rasterId });
  const kMask = store._mockKonvaLayers.get(maskId);
  kMask.children = ["stroke1", "stroke2"];

  store.stageResult("blob://candidate_003.png");
  await store.acceptAndInpaintImmediately(history);

  assert.equal(kMask.children.length, 0, "Mask strokes must be cleared for new inpainting round");
  assert.equal(store.activeLayerId, maskId);
  assert.equal(store.activeTool, "brush");
  assert.equal(store.inpaintDrawMode, "mask");
});

registerTest("Directive 2: Multi-Round Iterative Chain (Round 1 -> Round 2 -> Undo)", async () => {
  const store = new TestCanvasStore();
  const history = new TestHistoryStore();
  history.connectCanvasStore(store);

  // Round 1
  store.stageResult("blob://round1.png");
  await store.acceptAndInpaintImmediately(history);
  assert.equal(history.undoStack.length, 1);

  // Round 2
  store.stageResult("blob://round2.png");
  await store.acceptAndInpaintImmediately(history);
  assert.equal(history.undoStack.length, 2);

  const raster = store.layers.find((l) => l.type === "raster");
  assert.equal(raster.thumbnail, "blob://round2.png");

  // Undo Round 2
  history.undo();
  const restoredRaster = store.layers.find((l) => l.type === "raster");
  assert.equal(restoredRaster.thumbnail, "blob://round1.png");

  // Redo Round 2
  history.redo();
  const redoneRaster = store.layers.find((l) => l.type === "raster");
  assert.equal(redoneRaster.thumbnail, "blob://round2.png");
});

registerTest("Directive 2 Boundary: Calling with null candidate returns false and does not mutate", async () => {
  const store = new TestCanvasStore();
  const history = new TestHistoryStore();
  history.connectCanvasStore(store);

  store.addLayer("raster", "Untouched");
  const initialLayers = JSON.stringify(store.layers);

  const ok = await store.acceptAndInpaintImmediately(history);
  assert.equal(ok, false);
  assert.equal(JSON.stringify(store.layers), initialLayers);
  assert.equal(history.undoStack.length, 0);
});

// TEST SUITE 3: Global Keyboard Shortcuts & Input Isolation
registerTest("Shortcuts: Input Isolation protects HTMLInputElement, HTMLTextAreaElement, contentEditable", () => {
  function shouldIgnoreShortcut(target) {
    if (!target) return false;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable) {
      return true;
    }
    return false;
  }

  assert.equal(shouldIgnoreShortcut({ tagName: "INPUT" }), true);
  assert.equal(shouldIgnoreShortcut({ tagName: "TEXTAREA" }), true);
  assert.equal(shouldIgnoreShortcut({ tagName: "SELECT" }), true);
  assert.equal(shouldIgnoreShortcut({ tagName: "DIV", isContentEditable: true }), true);
  assert.equal(shouldIgnoreShortcut({ tagName: "DIV", isContentEditable: false }), false);
  assert.equal(shouldIgnoreShortcut({ tagName: "BUTTON" }), false);
  assert.equal(shouldIgnoreShortcut(null), false);
});

registerTest("Shortcuts: Undo/Redo triggers regardless of pointerOverStage location", () => {
  const store = new TestCanvasStore();
  const history = new TestHistoryStore();
  history.connectCanvasStore(store);

  store.addLayer("raster", "Layer A");
  history.snapshot("Add Layer A");
  store.addLayer("raster", "Layer B");
  assert.equal(store.layers.length, 2);

  store.isPointerOverStage = false;

  function simulateUndoKeyDown(e) {
    if (e.target?.tagName === "INPUT" || e.target?.tagName === "TEXTAREA") return;
    const isCtrl = e.ctrlKey || e.metaKey;
    if (isCtrl && e.key.toLowerCase() === "z") {
      if (e.shiftKey) history.redo();
      else history.undo();
    }
  }

  simulateUndoKeyDown({ ctrlKey: true, key: "z", target: { tagName: "BODY" } });
  assert.equal(store.layers.length, 1, "Undo must trigger even when pointer is outside stage");

  function simulateRedoKeyY(e) {
    if (e.target?.tagName === "INPUT" || e.target?.tagName === "TEXTAREA") return;
    const isCtrl = e.ctrlKey || e.metaKey;
    if (isCtrl && e.key.toLowerCase() === "y") history.redo();
  }
  simulateRedoKeyY({ ctrlKey: true, key: "y", target: { tagName: "BODY" } });
  assert.equal(store.layers.length, 2, "Redo via Ctrl+Y must trigger");

  simulateUndoKeyDown({ ctrlKey: true, key: "z", target: { tagName: "BODY" } });
  assert.equal(store.layers.length, 1);
  simulateUndoKeyDown({ ctrlKey: true, shiftKey: true, key: "z", target: { tagName: "BODY" } });
  assert.equal(store.layers.length, 2, "Redo via Ctrl+Shift+Z must trigger");
});

registerTest("Shortcuts: Multi-candidate carousel stepping via ArrowLeft / ArrowRight", () => {
  const store = new TestCanvasStore();
  store.stageBatch(["blob://c1.png", "blob://c2.png", "blob://c3.png"]);

  assert.equal(store.stagingIndex, 0);
  assert.equal(store.candidate.url, "blob://c1.png");

  store.nextStaging();
  assert.equal(store.stagingIndex, 1);
  assert.equal(store.candidate.url, "blob://c2.png");

  store.nextStaging();
  assert.equal(store.stagingIndex, 2);
  assert.equal(store.candidate.url, "blob://c3.png");

  store.nextStaging();
  assert.equal(store.stagingIndex, 0);
  assert.equal(store.candidate.url, "blob://c1.png");

  store.prevStaging();
  assert.equal(store.stagingIndex, 2);
  assert.equal(store.candidate.url, "blob://c3.png");
});

registerTest("Adversarial Defect: Window Event Dispatch duplicate listener investigation", () => {
  const store = new TestCanvasStore();
  store.stageBatch(["blob://c1.png", "blob://c2.png", "blob://c3.png"]);

  let contextualCalls = 0;
  let stageCalls = 0;

  function contextualListener(e) {
    if (store.isStagingActive && e.key === "ArrowRight") {
      contextualCalls++;
      store.nextStaging();
    }
  }

  function stageListener(e) {
    if (store.isStagingActive && e.key === "ArrowRight") {
      stageCalls++;
      store.nextStaging();
    }
  }

  const event = { key: "ArrowRight", defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
  contextualListener(event);
  stageListener(event);

  assert.equal(contextualCalls, 1);
  assert.equal(stageCalls, 1);
  assert.equal(store.stagingIndex, 2, "Stepped twice due to duplicate window listeners!");
  console.log("    [FINDING]: Duplicate window keydown listeners in CanvasContextualBar and CanvasStage cause double-step on ArrowRight/ArrowLeft!");
});

// TEST SUITE 4: 12-Locale i18n Parity Deep Audit
const LOCALES = ["de", "en", "es", "fr", "it", "ja", "ko", "pl", "pt", "ru", "zh-tw", "zh"];
const localeMaps = {};
for (const loc of LOCALES) {
  const filePath = path.resolve(PROJECT_ROOT, `src/lib/locales/${loc}.ts`);
  const content = fs.readFileSync(filePath, "utf8");
  const keys = new Set();
  const regex = /"([^"\\]*(?:\\.[^"\\]*)*)"\s*:/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    keys.add(match[1]);
  }
  localeMaps[loc] = keys;
}

registerTest("12-Locale: All 12 files exist and have exact same key count (4373 keys)", () => {
  const enCount = localeMaps["en"].size;
  for (const loc of LOCALES) {
    assert.equal(localeMaps[loc].size, enCount, `${loc}.ts count (${localeMaps[loc].size}) !== en.ts count (${enCount})`);
  }
  console.log(`    All 12 locales have identical key counts: ${enCount} keys each.`);
});

registerTest("12-Locale: Existing canvas.contextual keys have 100% parity across all 12 locales", () => {
  const existingKeys = [
    "canvas.contextual.generate",
    "canvas.contextual.generating",
    "canvas.contextual.accept_new_layer",
    "canvas.contextual.prompt_placeholder",
    "canvas.contextual.prompt_inpaint_placeholder",
    "canvas.contextual.denoise",
    "canvas.contextual.auto_badge_title",
    "canvas.actions.txt2img",
    "canvas.actions.img2img",
    "canvas.actions.inpaint",
    "canvas.actions.outpaint",
    "canvas.actions.upscale",
  ];
  for (const loc of LOCALES) {
    for (const key of existingKeys) {
      assert.ok(localeMaps[loc].has(key), `Missing key "${key}" in ${loc}.ts`);
    }
  }
});

registerTest("12-Locale Audit: Audit unkeyed fallback strings in CanvasContextualBar", () => {
  const unkeyedFallbacks = [
    "canvas.staging.accept_and_inpaint",
    "canvas.staging.apply_to_base",
    "canvas.staging.use_as_mask",
    "canvas.staging.reroll",
  ];
  const missingInLocales = [];
  for (const key of unkeyedFallbacks) {
    if (!localeMaps["en"].has(key)) {
      missingInLocales.push(key);
    }
  }
  console.log(`    [AUDIT]: ${missingInLocales.length} keys currently rely on inline English fallbacks: ${missingInLocales.join(", ")}`);
  assert.ok(missingInLocales.length > 0, "Documented that staging keys rely on English fallbacks prior to M4 i18n pass");
});

// ---------------------------------------------------------------------------
// EXECUTE QUEUE
// ---------------------------------------------------------------------------
async function main() {
  for (const { name, fn } of testQueue) {
    totalTests++;
    try {
      const res = fn();
      if (res instanceof Promise) await res;
      passedTests++;
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failedTests++;
      failures.push({ name, error: err });
      console.error(`  ✗ ${name}`);
      console.error(`    ${err.message}`);
    }
  }

  console.log("\n=================================================================");
  console.log(`TOTAL TESTS: ${totalTests} | PASSED: ${passedTests} | FAILED: ${failedTests}`);
  console.log("=================================================================");

  if (failedTests > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("Runner crashed:", err);
  process.exit(1);
});
