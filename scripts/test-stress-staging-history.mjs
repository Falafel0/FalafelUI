// scripts/test-stress-staging-history.mjs
// Adversarial Stress-Test Harness for Milestone 3 Staging Actions & History Snapshot Stack
// Author: Milestone 3 Challenger 1 (Staging & History Stress Challenger)
// Run: node scripts/test-stress-staging-history.mjs

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const PROJECT_ROOT = new URL("../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

console.log("=================================================================");
console.log("MooshieUI Milestone 3 Adversarial Staging & History Stress Harness");
console.log("Testing: Staging Actions, Contextual Task Bar Transitions,");
console.log("         History 64-Cap, Undo/Redo Bounds, COW Sharing, Boundaries");
console.log("=================================================================\n");

let passed = 0;
let failed = 0;
const failures = [];
const testQueue = [];

function challenge(title, fn) {
  testQueue.push({ title, fn });
}

// ----------------------------------------------------------------------------
// Load Modules with Mock Context
// ----------------------------------------------------------------------------

const revokedUrls = new Set();
let blobCounter = 0;

function createMockEnvironment() {
  const env = {
    revokedUrls,
    resetRevoked() {
      revokedUrls.clear();
      blobCounter = 0;
    },
  };
  return env;
}

const mockEnv = createMockEnvironment();

function loadModule(relativePath, extraContext = {}) {
  const fullPath = path.resolve(PROJECT_ROOT, relativePath);
  const source = fs.readFileSync(fullPath, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  });

  const moduleObj = { exports: {} };
  const mockContext = {
    module: moduleObj,
    exports: moduleObj.exports,
    Promise,
    setTimeout,
    clearTimeout,
    require(id) {
      if (id.includes("locale")) {
        return {
          locale: {
            t: (k, vars) => (vars?.n ? `${k}_${vars.n}` : k),
            formatDecimal: (n, d) => Number(n).toFixed(d),
            formatPercent: (n, d) => `${Number(n).toFixed(d)}%`,
          },
        };
      }
      if (id.includes("generation")) {
        return {
          generation: {
            mode: "txt2img",
            positivePrompt: "",
            negativePrompt: "",
            inputImage: null,
            maskImage: null,
            width: 1024,
            height: 1024,
            postScaleWidth: null,
            postScaleHeight: null,
          },
        };
      }
      if (id.includes("canvasHistory")) {
        return canvasHistoryModule;
      }
      if (id.includes("canvasProject")) {
        return {
          saveFalafelProject: async () => {},
          loadFalafelProjectFile: async () => ({}),
          downloadCanvasImage: () => {},
        };
      }
      if (id.includes("maskCrop")) {
        return {
          getCropRegionV2: () => null,
          expandCropRegion: (c) => c,
          cropCanvas: () => null,
        };
      }
      if (id.includes("maskBlur")) {
        return { gaussianBlurCanvas: () => {} };
      }
      if (id.includes("maskFill")) {
        return { fillMaskedRegion: () => {} };
      }
      if (id.includes("api")) {
        return { uploadImageBytes: async () => ({ name: "test", subfolder: "", type: "input" }) };
      }
      if (id.includes("canvas.js")) {
        return canvasTypes;
      }
      if (id === "konva") {
        return {
          Layer: class MockKonvaLayer {
            constructor(opts) {
              this._opts = opts;
              this._scaleX = 1;
              this._scaleY = 1;
              this._x = 0;
              this._y = 0;
              this._children = [];
            }
            scaleX(v) { if (v !== undefined) this._scaleX = v; return this._scaleX; }
            scaleY(v) { if (v !== undefined) this._scaleY = v; return this._scaleY; }
            x(v) { if (v !== undefined) this._x = v; return this._x; }
            y(v) { if (v !== undefined) this._y = v; return this._y; }
            toDataURL(opts) { return `data:image/png;base64,mock_${opts?.width || 512}x${opts?.height || 512}`; }
            destroyChildren() { this._children = []; }
            add(child) { this._children.push(child); }
            batchDraw() {}
          },
          Image: class MockKonvaImage {
            constructor(opts) { this.opts = opts; }
          },
        };
      }
      return {};
    },
    $state: (val) => val,
    $derived: (val) => val,
    URL: {
      createObjectURL: (blob) => {
        const url = `blob:mock-url-${++blobCounter}`;
        return url;
      },
      revokeObjectURL: (url) => {
        revokedUrls.add(url);
      },
    },
    document: {
      createElement: () => ({
        getContext: () => ({
          fillRect: () => {},
          drawImage: () => {},
          getImageData: () => ({ data: new Uint8ClampedArray(400) }),
          putImageData: () => {},
        }),
        toBlob: (cb) => cb(new Blob(["mock"])),
      }),
    },
    Image: class MockImage {
      constructor() {
        this.src = "";
        setTimeout(() => {
          if (this.onload) this.onload();
        }, 1);
      }
    },
    Blob: class MockBlob {
      constructor(parts) { this.parts = parts; }
      async arrayBuffer() { return new ArrayBuffer(8); }
    },
    console,
    ...extraContext,
  };

  vm.createContext(mockContext);
  vm.runInContext(outputText, mockContext, { filename: fullPath });
  return moduleObj.exports;
}

// 1. Load types
const canvasTypes = loadModule("src/lib/types/canvas.ts");
// 2. Load canvasHistory
const canvasHistoryModule = loadModule("src/lib/stores/canvasHistory.svelte.ts");
// 3. Load canvas store
const canvasStoreModule = loadModule("src/lib/stores/canvas.svelte.ts");

const { canvasHistory, CanvasHistoryStore, MAX_HISTORY } = canvasHistoryModule;
const canvasStore = canvasStoreModule.canvas;

function resetCanvas() {
  canvasStore.initCanvas(1024, 1024);
  canvasStore.clearStaging();
  canvasHistory.clear();
  mockEnv.resetRevoked();
}

// ============================================================================
// SUITE 1: RAPID STAGING OPERATIONS & TRANSITIONS
// ============================================================================

challenge("1.1 Rapid stageResult -> discardStaging (50 cycles) maintains clean zero-leak state", async () => {
  resetCanvas();
  for (let i = 0; i < 50; i++) {
    const url = `blob:mock-url-${i}`;
    canvasStore.stageResult(url, 1024, 1024, undefined, { owned: true });
    assert.equal(canvasStore.isStagingActive, true, `staging must be active at cycle ${i}`);
    assert.ok(canvasStore.candidate, `candidate must exist at cycle ${i}`);
    assert.equal(canvasStore.candidate.url, url);

    canvasStore.discardStaging();
    assert.equal(canvasStore.isStagingActive, false, `staging must be inactive after discard at cycle ${i}`);
    assert.equal(canvasStore.candidate, null, `candidate must be null after discard at cycle ${i}`);
    assert.equal(canvasStore.stagingImages.length, 0, `stagingImages must be empty after discard at cycle ${i}`);
  }
});

challenge("1.2 Rapid stageResult -> acceptAsNewLayer creates distinct layers above active layer", async () => {
  resetCanvas();
  // initCanvas creates 2 default layers: raster background and mask
  assert.equal(canvasStore.layers.length, 2);

  for (let i = 1; i <= 10; i++) {
    const candUrl = `https://test.images/candidate_${i}.png`;
    canvasStore.stageResult(candUrl, 1024, 1024);
    assert.ok(canvasStore.candidate);

    const prevLayerCount = canvasStore.layers.length;

    const newLayer = await canvasStore.acceptAsNewLayer();
    assert.ok(newLayer, `acceptAsNewLayer must return new layer at step ${i}`);
    assert.equal(newLayer.type, "raster");
    assert.equal(newLayer.thumbnail, candUrl);
    assert.equal(canvasStore.layers.length, prevLayerCount + 1);

    // Staging must be cleared
    assert.equal(canvasStore.candidate, null);
    assert.equal(canvasStore.isStagingActive, false);

    // Order invariant: all layers must maintain strict contiguous order
    const sorted = [...canvasStore.layers].sort((a, b) => a.order - b.order);
    sorted.forEach((l, idx) => {
      assert.equal(l.order, idx, `Layer ${l.id} has order ${l.order}, expected ${idx}`);
    });
  }
});

challenge("1.3 Rapid stageResult -> applyToBase commits to active raster layer and rejects locked/non-raster", async () => {
  resetCanvas();
  // Active layer is initial raster layer from initCanvas
  const activeRaster = canvasStore.getActiveLayer();
  assert.ok(activeRaster && activeRaster.type === "raster");
  const rasterId = activeRaster.id;

  // Successful apply to active raster
  canvasStore.stageResult("https://test.images/applied_base.png", 1024, 1024);
  const success = await canvasStore.applyToBase();
  assert.equal(success, true, "applyToBase must succeed on unlocked raster layer");
  const target = canvasStore.layers.find((l) => l.id === rasterId);
  assert.ok(target);
  assert.equal(target.thumbnail, "https://test.images/applied_base.png");
  assert.equal(canvasStore.candidate, null, "staging candidate cleared after applyToBase");

  // Rejection when target layer is locked
  canvasStore.toggleLayerLock(rasterId);
  canvasStore.stageResult("https://test.images/reject_locked.png", 1024, 1024);
  const lockedResult = await canvasStore.applyToBase();
  assert.equal(lockedResult, false, "applyToBase must reject locked layer");
  assert.equal(target.thumbnail, "https://test.images/applied_base.png", "locked thumbnail unchanged");
  canvasStore.clearStaging();
  canvasStore.toggleLayerLock(rasterId); // Unlock

  // Rejection when active layer is a mask layer
  const maskLayer = canvasStore.layers.find((l) => l.type === "mask");
  assert.ok(maskLayer);
  canvasStore.setActiveLayer(maskLayer.id);
  canvasStore.stageResult("https://test.images/reject_mask.png", 1024, 1024);
  const maskApplyResult = await canvasStore.applyToBase();
  assert.equal(maskApplyResult, false, "applyToBase must reject active mask layer");
});

challenge("1.4 Direct single-click 'Accept & Inpaint Immediately' (Directive 2 Hero Action)", async () => {
  resetCanvas();
  const baseRaster = canvasStore.layers.find((l) => l.type === "raster");
  assert.ok(baseRaster);
  const baseRasterId = baseRaster.id;
  canvasStore.setActiveLayer(baseRasterId);
  canvasStore.setTool("move");

  canvasStore.stageResult("https://test.images/hero_inpaint_cand.png", 1024, 1024);
  assert.ok(canvasStore.candidate);

  const ok = await canvasStore.acceptAndInpaintImmediately();
  assert.equal(ok, true, "acceptAndInpaintImmediately must return true");

  // Staging must be cleared
  assert.equal(canvasStore.candidate, null, "staging candidate must be cleared");
  assert.equal(canvasStore.isStagingActive, false, "staging must be inactive");

  // Base raster thumbnail updated
  const base = canvasStore.layers.find((l) => l.id === baseRasterId);
  assert.ok(base);
  assert.equal(base.thumbnail, "https://test.images/hero_inpaint_cand.png");

  // Linked mask layer must be created or activated
  const linkedMask = canvasStore.layers.find((l) => l.type === "mask");
  assert.ok(linkedMask, "mask layer must exist");
  assert.equal(canvasStore.activeLayerId, linkedMask.id, "activeLayer must be the mask layer");

  // Tool must immediately switch to brush with mask draw mode
  assert.equal(canvasStore.activeTool, "brush", "tool must be brush");
  assert.equal(canvasStore.inpaintDrawMode, "mask", "inpaint draw mode must be mask");
});

challenge("1.5 stageResult -> useAsMask derives and provisions new MaskCanvasLayer", async () => {
  resetCanvas();
  canvasStore.stageResult("https://test.images/mask_candidate.png", 1024, 1024);

  const maskLayer = await canvasStore.useAsMask();
  assert.ok(maskLayer, "useAsMask must return new mask layer");
  assert.equal(maskLayer.type, "mask");
  assert.equal(maskLayer.thumbnail, "https://test.images/mask_candidate.png");
  assert.equal(maskLayer.inverted, false, "derived mask inverted must be false by default");
  assert.equal(canvasStore.candidate, null, "staging candidate must be cleared");
  assert.equal(canvasStore.isStagingActive, false);
});

challenge("1.6 Alternating Stress Sequence (100 rapid multi-action rounds)", async () => {
  resetCanvas();

  const actions = ["discard", "newLayer", "applyToBase", "acceptAndInpaint", "useAsMask"];
  for (let i = 0; i < 100; i++) {
    const action = actions[i % actions.length];
    const url = `https://test.images/seq_${i}.png`;
    canvasStore.stageResult(url, 1024, 1024);

    if (action === "discard") {
      canvasStore.discardStaging();
      assert.equal(canvasStore.candidate, null);
    } else if (action === "newLayer") {
      const l = await canvasStore.acceptAsNewLayer();
      assert.ok(l);
      assert.equal(canvasStore.candidate, null);
    } else if (action === "applyToBase") {
      const active = canvasStore.getActiveLayer();
      if (!active || active.type !== "raster" || active.locked) {
        const raster = canvasStore.layers.find((l) => l.type === "raster" && !l.locked);
        if (raster) canvasStore.setActiveLayer(raster.id);
      }
      await canvasStore.applyToBase();
      assert.equal(canvasStore.candidate, null);
    } else if (action === "acceptAndInpaint") {
      const ok = await canvasStore.acceptAndInpaintImmediately();
      assert.equal(ok, true);
      assert.equal(canvasStore.candidate, null);
    } else if (action === "useAsMask") {
      const m = await canvasStore.useAsMask();
      assert.ok(m);
      assert.equal(canvasStore.candidate, null);
    }
  }

  // Verify layer order invariant survived 100 mixed rounds
  const sorted = [...canvasStore.layers].sort((a, b) => a.order - b.order);
  sorted.forEach((l, idx) => {
    assert.equal(l.order, idx, `Order must be unbroken contiguous at index ${idx}`);
  });
});

challenge("1.7 Multi-candidate cycling (nextStaging, prevStaging, dismissCurrentStaging)", async () => {
  resetCanvas();
  const urls = ["url_1.png", "url_2.png", "url_3.png", "url_4.png", "url_5.png"];
  for (const u of urls) {
    canvasStore.stageResult(u, 1024, 1024);
  }

  assert.equal(canvasStore.stagingImages.length, 5);
  assert.equal(canvasStore.stagingIndex, 4); // Points to latest staged

  // Cycle forward
  canvasStore.nextStaging();
  assert.equal(canvasStore.stagingIndex, 0);
  assert.equal(canvasStore.candidate.url, "url_1.png");

  canvasStore.nextStaging();
  assert.equal(canvasStore.stagingIndex, 1);
  assert.equal(canvasStore.candidate.url, "url_2.png");

  // Cycle backward
  canvasStore.prevStaging();
  assert.equal(canvasStore.stagingIndex, 0);
  assert.equal(canvasStore.candidate.url, "url_1.png");

  canvasStore.prevStaging();
  assert.equal(canvasStore.stagingIndex, 4);
  assert.equal(canvasStore.candidate.url, "url_5.png");

  // Dismiss current staging (url_5.png)
  canvasStore.dismissCurrentStaging();
  assert.equal(canvasStore.stagingImages.length, 4);
  assert.ok(canvasStore.stagingIndex < 4);
  assert.ok(canvasStore.isStagingActive);
});

// ============================================================================
// SUITE 2: HISTORY STACK STRESS & INVARIANTS
// ============================================================================

challenge("2.1 75 sequential snapshots strictly capped at MAX_HISTORY = 64 (FIFO eviction)", async () => {
  resetCanvas();
  assert.equal(MAX_HISTORY, 64, "MAX_HISTORY constant must be 64");
  assert.equal(canvasHistory.maxDepth, 64, "canvasHistory.maxDepth must be 64");

  for (let i = 1; i <= 75; i++) {
    canvasHistory.snapshot({
      description: `Snapshot round ${i}`,
      layers: [
        { id: "layer_0", order: 0, opacity: i / 75 },
        { id: `layer_${i}`, order: 1, opacity: 1.0 },
      ],
    });

    assert.ok(
      canvasHistory.undoStack.length <= 64,
      `undoStack length ${canvasHistory.undoStack.length} must never exceed 64 (at push ${i})`
    );
  }

  assert.equal(canvasHistory.undoStack.length, 64, "undoStack must be exactly 64 after 75 pushes");
  // Oldest entries 1..11 must have been evicted, newest must be round 75
  const newest = canvasHistory.undoStack[canvasHistory.undoStack.length - 1];
  assert.equal(newest.description, "Snapshot round 75");
  const oldest = canvasHistory.undoStack[0];
  assert.equal(oldest.description, "Snapshot round 12");
});

challenge("2.2 Undo past index 0 (100 undos on 64 items) handles boundary safely without throwing", async () => {
  resetCanvas();
  for (let i = 0; i < 64; i++) {
    canvasHistory.snapshot({ step: i });
  }
  assert.equal(canvasHistory.undoStack.length, 64);

  // Undo all 64 items plus 36 extra undos
  let currentState = { step: 64 };
  for (let i = 0; i < 100; i++) {
    const prev = canvasHistory.undo(currentState);
    if (canvasHistory.undoStack.length > 0) {
      assert.ok(prev !== undefined);
      currentState = prev;
    }
  }

  assert.equal(canvasHistory.undoStack.length, 0, "undoStack must be empty");
  assert.equal(canvasHistory.canUndo, false, "canUndo must be false when stack is empty");
  // Undoing on empty stack returns current state without throwing
  const resultOnEmpty = canvasHistory.undo(currentState);
  assert.equal(resultOnEmpty, currentState, "undo on empty stack returns current state");
});

challenge("2.3 Redo past end (100 redos on 64 items) stops at end safely without throwing", async () => {
  resetCanvas();
  for (let i = 0; i < 64; i++) {
    canvasHistory.snapshot({ step: i });
  }

  // Undo all 64 items to populate redoStack
  let currentState = { step: 64 };
  for (let i = 0; i < 64; i++) {
    currentState = canvasHistory.undo(currentState);
  }
  assert.equal(canvasHistory.redoStack.length, 64, "redoStack must have 64 items");
  assert.equal(canvasHistory.canRedo, true);

  // Redo 100 times
  for (let i = 0; i < 100; i++) {
    const next = canvasHistory.redo(currentState);
    if (canvasHistory.redoStack.length > 0) {
      assert.ok(next !== undefined);
      currentState = next;
    }
  }

  assert.equal(canvasHistory.redoStack.length, 0, "redoStack must be empty after full redo");
  assert.equal(canvasHistory.canRedo, false, "canRedo must be false when redo stack is exhausted");
  // Redoing on empty stack returns current state without throwing
  const resultOnEmpty = canvasHistory.redo(currentState);
  assert.equal(resultOnEmpty, currentState, "redo on empty stack returns current state");
});

challenge("2.4 New action immediately clears redo stack", async () => {
  resetCanvas();
  for (let i = 0; i < 10; i++) {
    canvasHistory.snapshot({ step: i });
  }
  assert.equal(canvasHistory.undoStack.length, 10);

  // Undo 4 times -> redoStack has 4 items
  let cur = { step: 10 };
  for (let i = 0; i < 4; i++) {
    cur = canvasHistory.undo(cur);
  }
  assert.equal(canvasHistory.redoStack.length, 4, "redoStack has 4 items");
  assert.equal(canvasHistory.canRedo, true);

  // Record a new action
  canvasHistory.snapshot({ step: "divergent_path" });

  // Redo stack MUST be completely cleared
  assert.equal(canvasHistory.redoStack.length, 0, "redoStack must be immediately cleared on new action");
  assert.equal(canvasHistory.canRedo, false, "canRedo must be false after new action");
});

challenge("2.5 Copy-on-Write (COW) layer pixel structural sharing in Live Mode", async () => {
  resetCanvas();
  canvasHistory.connectCanvasStore(canvasStore);

  const rasterA = canvasStore.layers.find((l) => l.type === "raster");
  const maskB = canvasStore.layers.find((l) => l.type === "mask");
  assert.ok(rasterA && maskB);

  // Simulate mock Konva layers in canvasHistory
  const mockKonvaMap = new Map();
  mockKonvaMap.set(rasterA.id, {
    scaleX: () => 1, scaleY: () => 1, x: () => 0, y: () => 0,
    toDataURL: () => "data:image/png;base64,PIXELS_A",
  });
  mockKonvaMap.set(maskB.id, {
    scaleX: () => 1, scaleY: () => 1, x: () => 0, y: () => 0,
    toDataURL: () => "data:image/png;base64,PIXELS_B",
  });

  canvasHistory.setRefs(mockKonvaMap, 1024, 1024);

  // Live snapshot: targeting only rasterA
  canvasHistory.snapshotLayers([rasterA.id]);
  assert.equal(canvasHistory.undoStack.length, 1);
  const snap1 = canvasHistory.undoStack[0];
  assert.ok(snap1.layerPixels, "snap1 must have layerPixels");
  assert.equal(snap1.layerPixels[rasterA.id], "data:image/png;base64,PIXELS_A");

  // Live snapshot: targeting only maskB
  canvasHistory.snapshotLayers([maskB.id]);
  assert.equal(canvasHistory.undoStack.length, 2);
  const snap2 = canvasHistory.undoStack[1];
  assert.ok(snap2.layerPixels, "snap2 must have layerPixels");

  // Structural sharing: unmutated rasterA pixels in snap2 reference identical string
  assert.equal(snap1.layerPixels[rasterA.id], snap2.layerPixels[rasterA.id]);
  assert.equal(snap2.layerPixels[maskB.id], "data:image/png;base64,PIXELS_B");
});

challenge("2.6 Deep state isolation across history snapshots", async () => {
  resetCanvas();
  const stateA = { layers: [{ id: "l1", name: "Initial", opacity: 0.5 }] };
  canvasHistory.snapshot(stateA);

  // Mutate stateA outside
  stateA.layers[0].name = "Mutated Externally";
  stateA.layers[0].opacity = 1.0;

  // History snapshot must remain completely pristine
  const snapshot = canvasHistory.undoStack[0];
  assert.equal(snapshot.layers[0].name, "Initial", "snapshot must not be contaminated by external mutation");
  assert.equal(snapshot.layers[0].opacity, 0.5, "opacity must remain 0.5");
});

// ============================================================================
// SUITE 3: BOUNDARY & ADVERSARIAL EDGE CASES
// ============================================================================

challenge("3.1 Empty string candidate URL `\"\"` handled safely without invalid entries or throws", async () => {
  resetCanvas();
  // Stage empty string
  canvasStore.stageResult("");
  assert.equal(canvasStore.stagingImages.length, 0, "empty string URL must not be pushed to stagingImages");
  assert.equal(canvasStore.candidate.url, "", "candidate url is empty string");

  // Accept with empty string URL returns null/false safely
  const resNew = await canvasStore.acceptAsNewLayer();
  assert.equal(resNew, null, "acceptAsNewLayer must return null when candidate URL is empty string");

  const applied = await canvasStore.applyToBase();
  assert.equal(applied, false, "applyToBase must return false when candidate URL is empty string");

  const inpainted = await canvasStore.acceptAndInpaintImmediately();
  assert.equal(inpainted, false, "acceptAndInpaintImmediately must return false when candidate URL is empty");

  const masked = await canvasStore.useAsMask();
  assert.equal(masked, null, "useAsMask must return null when candidate URL is empty");
});

challenge("3.2 Null / undefined candidate accept calls reject gracefully without throwing", async () => {
  resetCanvas();
  assert.equal(canvasStore.candidate, null);

  const l1 = await canvasStore.acceptAsNewLayer();
  assert.equal(l1, null, "acceptAsNewLayer returns null when candidate is null");

  const l2 = await canvasStore.applyToBase();
  assert.equal(l2, false, "applyToBase returns false when candidate is null");

  const l3 = await canvasStore.acceptAndInpaintImmediately();
  assert.equal(l3, false, "acceptAndInpaintImmediately returns false when candidate is null");

  const l4 = await canvasStore.useAsMask();
  assert.equal(l4, null, "useAsMask returns null when candidate is null");
});

challenge("3.3 Extreme candidate dimensions (4096x4096, 8192x8192, 1x1, 0x0)", async () => {
  resetCanvas();
  const testCases = [
    { w: 4096, h: 4096 },
    { w: 8192, h: 8192 },
    { w: 1, h: 1 },
    { w: 0, h: 0 },
  ];

  for (const tc of testCases) {
    canvasStore.stageResult(`https://test.images/dim_${tc.w}x${tc.h}.png`, tc.w, tc.h);
    assert.equal(canvasStore.candidate.width, tc.w);
    assert.equal(canvasStore.candidate.height, tc.h);

    const layer = await canvasStore.acceptAsNewLayer();
    assert.ok(layer);
    assert.equal(layer.width, tc.w);
    assert.equal(layer.height, tc.h);
  }
});

challenge("3.4 Rapid consecutive staging cycles (500 cycles) revoke Blob URLs without memory leak", async () => {
  resetCanvas();
  mockEnv.resetRevoked();

  for (let i = 0; i < 500; i++) {
    const mockBlob = new Blob(["test"]);
    canvasStore.stageBlob(mockBlob);
    assert.equal(canvasStore.stagingImages.length, 1);
    canvasStore.clearStaging();
    assert.equal(canvasStore.stagingImages.length, 0);
  }

  // All 500 generated blob URLs must be revoked by URL.revokeObjectURL
  assert.equal(mockEnv.revokedUrls.size, 500, `Expected 500 revoked Blob URLs, got ${mockEnv.revokedUrls.size}`);
});

challenge("3.5 acceptAndInpaintImmediately with zero initial layers auto-creates Base Layer & Inpaint Mask", async () => {
  resetCanvas();
  // Clear all layers
  canvasStore.layers = [];
  canvasStore.activeLayerId = null;
  assert.equal(canvasStore.layers.length, 0);

  canvasStore.stageResult("https://test.images/zero_layer_cand.png", 1024, 1024);
  const ok = await canvasStore.acceptAndInpaintImmediately();
  assert.equal(ok, true);

  // Must have created exactly 2 layers: 1 raster base and 1 mask linked to base
  assert.equal(canvasStore.layers.length, 2, "must auto-create 2 layers (base raster + linked mask)");
  const raster = canvasStore.layers.find((l) => l.type === "raster");
  const mask = canvasStore.layers.find((l) => l.type === "mask");
  assert.ok(raster, "base raster layer must exist");
  assert.ok(mask, "inpaint mask layer must exist");
  assert.equal(mask.linkedLayerId, raster.id, "mask must be linked to base raster");
  assert.equal(canvasStore.activeLayerId, mask.id, "mask must be active layer");
  assert.equal(canvasStore.activeTool, "brush", "tool must be brush");
});

challenge("3.6 Staging compare properties (opacity, split ratio, show original)", async () => {
  resetCanvas();
  canvasStore.stageResult("https://test.images/compare.png", 1024, 1024);

  // Initial defaults
  assert.equal(canvasStore.stagingOpacity, 1.0);
  assert.equal(canvasStore.stagingShowOriginal, false);
  assert.equal(canvasStore.stagingCompareMode, "overlay");

  // Modify
  canvasStore.stagingOpacity = 0.65;
  canvasStore.stagingCompareMode = "split";
  canvasStore.stagingSplitRatio = 0.42;
  canvasStore.stagingShowOriginal = true;

  assert.equal(canvasStore.stagingOpacity, 0.65);
  assert.equal(canvasStore.stagingCompareMode, "split");
  assert.equal(canvasStore.stagingSplitRatio, 0.42);
  assert.equal(canvasStore.stagingShowOriginal, true);

  // Clearing staging resets compare settings
  canvasStore.clearStaging();
  assert.equal(canvasStore.stagingOpacity, 1.0);
  assert.equal(canvasStore.stagingShowOriginal, false);
  assert.equal(canvasStore.stagingCompareMode, "overlay");
});

// ============================================================================
// SUITE 4: END-TO-END STAGING + HISTORY ROUND-TRIP WORKFLOWS
// ============================================================================

challenge("4.1 Multi-round generation, staging acceptance, and multi-step undo/redo", async () => {
  resetCanvas();
  // Start with 2 default layers (raster background, mask)
  assert.equal(canvasStore.layers.length, 2);

  // Round 1: Accept as New Layer
  canvasStore.stageResult("https://test.images/round_1.png", 1024, 1024);
  const layerR1 = await canvasStore.acceptAsNewLayer();
  assert.ok(layerR1);
  assert.equal(canvasStore.layers.length, 3);
  assert.equal(canvasHistory.undoStack.length, 1);

  // Round 2: Apply to Base
  canvasStore.setActiveLayer(layerR1.id);
  canvasStore.stageResult("https://test.images/round_2.png", 1024, 1024);
  const okR2 = await canvasStore.applyToBase();
  assert.equal(okR2, true);
  assert.equal(canvasStore.layers.length, 3);
  assert.equal(layerR1.thumbnail, "https://test.images/round_2.png");
  assert.equal(canvasHistory.undoStack.length, 2);

  // Round 3: Accept & Inpaint Immediately
  canvasStore.stageResult("https://test.images/round_3.png", 1024, 1024);
  const okR3 = await canvasStore.acceptAndInpaintImmediately();
  assert.equal(okR3, true);
  assert.equal(canvasHistory.undoStack.length, 3);
  assert.equal(canvasStore.activeTool, "brush");

  // Undo Round 3
  const snapBeforeR3 = canvasHistory.undo();
  assert.ok(snapBeforeR3);
  assert.equal(canvasHistory.undoStack.length, 2);
  assert.equal(canvasHistory.redoStack.length, 1);

  // Undo Round 2
  const snapBeforeR2 = canvasHistory.undo();
  assert.ok(snapBeforeR2);
  assert.equal(canvasHistory.undoStack.length, 1);
  assert.equal(canvasHistory.redoStack.length, 2);

  // Undo Round 1
  const snapBeforeR1 = canvasHistory.undo();
  assert.ok(snapBeforeR1);
  assert.equal(canvasHistory.undoStack.length, 0);
  assert.equal(canvasHistory.redoStack.length, 3);

  // Redo back to Round 3
  canvasHistory.redo();
  assert.equal(canvasHistory.undoStack.length, 1);
  canvasHistory.redo();
  assert.equal(canvasHistory.undoStack.length, 2);
  canvasHistory.redo();
  assert.equal(canvasHistory.undoStack.length, 3);
  assert.equal(canvasHistory.redoStack.length, 0);
});

challenge("4.2 Staging with localized bounding box bounds coordinates", async () => {
  resetCanvas();
  const box = { x: 128, y: 256, width: 512, height: 384 };
  canvasStore.stageResult("https://test.images/boxed.png", 512, 384, box);

  assert.ok(canvasStore.candidate);
  assert.equal(canvasStore.candidate.width, 512);
  assert.equal(canvasStore.candidate.height, 384);
  assert.deepEqual(canvasStore.candidate.bounds, box);

  const layer = await canvasStore.acceptAsNewLayer();
  assert.ok(layer);
  assert.equal(layer.width, 512);
  assert.equal(layer.height, 384);
});

challenge("4.3 Before/After comparison toggleShowOriginal toggle mechanics", async () => {
  resetCanvas();
  assert.equal(canvasStore.showingOriginal, false);

  canvasStore.stageResult("https://test.images/cand.png", 1024, 1024);
  assert.equal(canvasStore.showingOriginal, false);

  canvasStore.toggleShowOriginal();
  assert.equal(canvasStore.showingOriginal, true);

  canvasStore.toggleShowOriginal();
  assert.equal(canvasStore.showingOriginal, false);
});
// ============================================================================

async function runAllTests() {
  for (const { title, fn } of testQueue) {
    try {
      const res = fn();
      if (res instanceof Promise) await res;
      passed++;
      console.log(`  [PASS] ${title}`);
    } catch (err) {
      failed++;
      failures.push({ title, error: err });
      console.error(`  [FAIL] ${title}`);
      console.error(`         ${err.message}`);
      if (err.stack) {
        const line = err.stack.split("\n")[1];
        if (line) console.error(`         ${line.trim()}`);
      }
    }
  }

  console.log("\n=================================================================");
  console.log(`STRESS TEST EXECUTION COMPLETE: ${passed} Passed, ${failed} Failed`);
  console.log("=================================================================");

  if (failed > 0) {
    console.error(`\nFAILURES (${failed}):`);
    for (const f of failures) {
      console.error(`  - ${f.title}: ${f.error.message}`);
    }
    process.exit(1);
  } else {
    console.log("\nALL ADVERSARIAL STRESS CHALLENGES PASSED EMPIRICALLY (100% GREEN)!");
    process.exit(0);
  }
}

runAllTests().catch((err) => {
  console.error("Fatal runner error:", err);
  process.exit(1);
});
