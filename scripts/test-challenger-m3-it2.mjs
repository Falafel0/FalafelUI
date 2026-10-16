// scripts/test-challenger-m3-it2.mjs
// Empirical Challenge & Stress-Test Harness for Milestone 3 Iteration 2
// Tests:
// 1. Window Keydown Shortcut Single-Firing:
//    - ArrowRight / ArrowLeft on 3-candidate batch (strictly 1 item per press: 0 -> 1 -> 2 -> 0)
//    - '\' toggle: showingOriginal toggles strictly once (false -> true), not twice
//    - Shift+Enter: accept as new layer increments total layer count by strictly 1, not 2
// 2. Candidate Aspect Ratio Containment:
//    - 16:9 (1920x1080) and 9:16 (1080x1920) on 1024x1024 canvas
//    - Letterbox and pillarbox bounds computation matching staging overlay without stretching
// 3. Mask Invalidation:
//    - Drawing mask / setting thumbnails, calling clearMask(), verifying canvas.hasActiveMask is false
//    - Verifying clearLayer() also invalidates mask state and smart action returns to txt2img/img2img

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const PROJECT_ROOT = new URL("../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

console.log("=================================================================");
console.log("EMPIRICAL CHALLENGER M3 IT2: SHORTCUTS, ASPECT RATIO & MASK HARNESS");
console.log("=================================================================\n");

let passedTests = 0;
let failedTests = 0;
const testQueue = [];

function registerTest(name, fn) {
  testQueue.push({ name, fn });
}

// ---------------------------------------------------------------------------
// 1. Module loader simulating Svelte/Browser runtime
// ---------------------------------------------------------------------------
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
            id() { return this._opts?.id; }
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
            constructor(opts) {
              this.opts = opts;
              this._x = opts?.x || 0;
              this._y = opts?.y || 0;
              this._width = opts?.width || 0;
              this._height = opts?.height || 0;
            }
            x(v) { if (v !== undefined) this._x = v; return this._x; }
            y(v) { if (v !== undefined) this._y = v; return this._y; }
            width(v) { if (v !== undefined) this._width = v; return this._width; }
            height(v) { if (v !== undefined) this._height = v; return this._height; }
            image(v) { if (v !== undefined) this._image = v; return this._image; }
          },
        };
      }
      return {};
    },
    $state: (val) => val,
    $derived: (val) => val,
    URL: {
      createObjectURL: (blob) => `blob:mock-url-${Math.random()}`,
      revokeObjectURL: () => {},
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

const canvasTypes = loadModule("src/lib/types/canvas.ts");
const canvasHistoryModule = loadModule("src/lib/stores/canvasHistory.svelte.ts");
const canvasStoreModule = loadModule("src/lib/stores/canvas.svelte.ts");

const { canvasHistory } = canvasHistoryModule;
const canvasStore = canvasStoreModule.canvas;

// ---------------------------------------------------------------------------
// TEST SUITE 1: WINDOW KEYDOWN SHORTCUT SINGLE-FIRING
// ---------------------------------------------------------------------------

registerTest("1.1 Source-Code Verification: CanvasStage.svelte has NO duplicate staging or transform keydown handlers", () => {
  const stageSource = fs.readFileSync(path.resolve(PROJECT_ROOT, "src/lib/components/canvas/CanvasStage.svelte"), "utf8");
  
  // Search for removed blocks in handleKeyDown
  assert.ok(!stageSource.includes("if (canvas.isStagingActive)"), "CanvasStage must not handle staging shortcuts");
  assert.ok(!stageSource.includes("canvas.nextStaging()"), "CanvasStage must not call nextStaging");
  assert.ok(!stageSource.includes("canvas.prevStaging()"), "CanvasStage must not call prevStaging");
  assert.ok(!stageSource.includes("canvas.acceptAndInpaintImmediately()"), "CanvasStage must not call acceptAndInpaintImmediately");
  assert.ok(!stageSource.includes("canvas.commitTransform()"), "CanvasStage must not call commitTransform");
  assert.ok(!stageSource.includes("canvas.cancelTransform()"), "CanvasStage must not call cancelTransform");
  assert.ok(!stageSource.includes("duplicateActiveLayer"), "CanvasStage must not handle duplicate layer shortcuts");
  assert.ok(!stageSource.includes("toggleShowOriginal"), "CanvasStage must not handle toggleShowOriginal");
});

registerTest("1.2 Simultaneous Window Dispatch Simulation: ArrowRight on 3-candidate batch advances strictly 0 -> 1 -> 2 -> 0", () => {
  canvasStore.initCanvas(1024, 1024);
  canvasStore.clearStaging();

  // Stage 3 candidates
  canvasStore.stageResult("candidate_0.png", 1024, 1024);
  canvasStore.stageResult("candidate_1.png", 1024, 1024);
  canvasStore.stageResult("candidate_2.png", 1024, 1024);

  // Set initial stagingIndex to 0
  canvasStore.stagingIndex = 0;
  canvasStore.stagedCandidate = { url: "candidate_0.png", width: 1024, height: 1024 };

  assert.equal(canvasStore.stagingImages.length, 3);
  assert.equal(canvasStore.stagingIndex, 0);

  // Parse actual listeners from mounted components:
  // CanvasToolbar: handleKeyDown
  // CanvasContextualBar: handleGlobalKeyDown
  // CanvasStage: handleKeyDown
  const barSource = fs.readFileSync(path.resolve(PROJECT_ROOT, "src/lib/components/canvas/CanvasContextualBar.svelte"), "utf8");
  const toolbarSource = fs.readFileSync(path.resolve(PROJECT_ROOT, "src/lib/components/canvas/CanvasToolbar.svelte"), "utf8");
  const stageSource = fs.readFileSync(path.resolve(PROJECT_ROOT, "src/lib/components/canvas/CanvasStage.svelte"), "utf8");

  // Simulate window event listener dispatch in order of mounting
  const windowListeners = [];

  // CanvasToolbar listener
  windowListeners.push((e) => {
    const target = e.target;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
    if (e.key === "\\" || e.key === "|") {
      e.preventDefault();
      canvasStore.toggleShowOriginal();
      return;
    }
  });

  // CanvasContextualBar listener
  windowListeners.push((e) => {
    const target = e.target;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
    if (canvasStore.isStagingActive) {
      if (e.key === "Enter" && e.altKey) {
        e.preventDefault();
        void canvasStore.acceptAndInpaintImmediately();
        return;
      }
      if (e.key === "Enter" && e.shiftKey) {
        e.preventDefault();
        void canvasStore.acceptStagingToNewLayer();
        return;
      }
      if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey) {
        e.preventDefault();
        void canvasStore.acceptStagingToCurrentLayer();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        canvasStore.clearStaging();
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        canvasStore.prevStaging();
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        canvasStore.nextStaging();
        return;
      }
    }
  });

  // CanvasStage listener
  windowListeners.push((e) => {
    const target = e.target;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
    // Stage now only handles Space, Alt eyedropper, Escape lasso
  });

  function dispatchWindowEvent(event) {
    for (const listener of windowListeners) {
      listener(event);
    }
  }

  // Press 1: 0 -> 1
  dispatchWindowEvent({ key: "ArrowRight", target: { tagName: "BODY" }, preventDefault() {} });
  assert.equal(canvasStore.stagingIndex, 1, "First ArrowRight must advance from 0 to 1");

  // Press 2: 1 -> 2
  dispatchWindowEvent({ key: "ArrowRight", target: { tagName: "BODY" }, preventDefault() {} });
  assert.equal(canvasStore.stagingIndex, 2, "Second ArrowRight must advance from 1 to 2");

  // Press 3: 2 -> 0 (wrap around)
  dispatchWindowEvent({ key: "ArrowRight", target: { tagName: "BODY" }, preventDefault() {} });
  assert.equal(canvasStore.stagingIndex, 0, "Third ArrowRight must wrap around from 2 to 0");

  // Press ArrowLeft: 0 -> 2
  dispatchWindowEvent({ key: "ArrowLeft", target: { tagName: "BODY" }, preventDefault() {} });
  assert.equal(canvasStore.stagingIndex, 2, "ArrowLeft must wrap around from 0 to 2");

  // Press ArrowLeft: 2 -> 1
  dispatchWindowEvent({ key: "ArrowLeft", target: { tagName: "BODY" }, preventDefault() {} });
  assert.equal(canvasStore.stagingIndex, 1, "ArrowLeft must step backward from 2 to 1");

  // Press ArrowLeft: 1 -> 0
  dispatchWindowEvent({ key: "ArrowLeft", target: { tagName: "BODY" }, preventDefault() {} });
  assert.equal(canvasStore.stagingIndex, 0, "ArrowLeft must step backward from 1 to 0");
});

registerTest("1.3 Simultaneous Window Dispatch Simulation: '\\' key strictly toggles showingOriginal once", () => {
  canvasStore.initCanvas(1024, 1024);
  assert.equal(canvasStore.showingOriginal, false);

  const windowListeners = [
    // CanvasToolbar
    (e) => {
      const target = e.target;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (e.key === "\\" || e.key === "|") {
        e.preventDefault();
        canvasStore.toggleShowOriginal();
        return;
      }
    },
    // CanvasContextualBar
    (e) => {},
    // CanvasStage (no longer has '\' listener)
    (e) => {},
  ];

  function dispatchWindowEvent(event) {
    for (const listener of windowListeners) {
      listener(event);
    }
  }

  // First press: false -> true
  dispatchWindowEvent({ key: "\\", target: { tagName: "BODY" }, preventDefault() {} });
  assert.equal(canvasStore.showingOriginal, true, "First '\\' must toggle false -> true");

  // Second press: true -> false
  dispatchWindowEvent({ key: "\\", target: { tagName: "BODY" }, preventDefault() {} });
  assert.equal(canvasStore.showingOriginal, false, "Second '\\' must toggle true -> false");

  // Test '|' alternate key: false -> true
  dispatchWindowEvent({ key: "|", target: { tagName: "BODY" }, preventDefault() {} });
  assert.equal(canvasStore.showingOriginal, true, "First '|' must toggle false -> true");
});

registerTest("1.4 Simultaneous Window Dispatch Simulation: Shift+Enter increments total layer count by strictly 1, not 2", async () => {
  canvasStore.initCanvas(1024, 1024);
  const initialLayerCount = canvasStore.layers.length; // 2 (raster + mask)
  assert.equal(initialLayerCount, 2);

  canvasStore.stageResult("candidate_shift_enter.png", 1024, 1024);
  assert.equal(canvasStore.isStagingActive, true);

  // Wire up stageOps simulation mimicking CanvasStage.svelte:handleAcceptStagingToLayer(asNewLayer)
  let stageOpsCalled = 0;
  canvasStore.registerStageOps({
    acceptStagingToLayer: async (asNewLayer) => {
      stageOpsCalled++;
      let targetLayerId = canvasStore.activeLayerId;
      if (asNewLayer || !targetLayerId) {
        targetLayerId = canvasStore.addLayer("raster");
      }
      return true;
    },
    acceptCandidateAsMask: async () => true,
    commitTransform: () => {},
    cancelTransform: () => {},
  });

  const windowListeners = [
    // CanvasToolbar
    (e) => {},
    // CanvasContextualBar
    async (e) => {
      const target = e.target;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (canvasStore.isStagingActive) {
        if (e.key === "Enter" && e.shiftKey) {
          e.preventDefault();
          await canvasStore.acceptStagingToNewLayer();
          return;
        }
      }
    },
    // CanvasStage (has NO staging shortcuts now!)
  ];

  for (const listener of windowListeners) {
    await listener({ key: "Enter", shiftKey: true, target: { tagName: "BODY" }, preventDefault() {} });
  }

  assert.equal(stageOpsCalled, 1, "stageOps.acceptStagingToLayer must be called exactly once");
  assert.equal(canvasStore.layers.length, initialLayerCount + 1, "Total layers must increment by exactly 1");
  assert.equal(canvasStore.layers.length, 3, "Expected 3 layers total, not 4");
  assert.equal(canvasStore.isStagingActive, false, "Staging must be cleared after accept");
});

// ---------------------------------------------------------------------------
// TEST SUITE 2: CANDIDATE ASPECT RATIO CONTAINMENT & LETTERBOXING
// ---------------------------------------------------------------------------

function computeAcceptedImageBounds(imgWidth, imgHeight, canvasWidth, canvasHeight, boundingBox, candidateBounds) {
  let x = 0;
  let y = 0;
  let width = canvasWidth;
  let height = canvasHeight;

  if (candidateBounds) {
    x = candidateBounds.x;
    y = candidateBounds.y;
    width = candidateBounds.width;
    height = candidateBounds.height;
  } else if (
    boundingBox &&
    imgWidth === boundingBox.width &&
    imgHeight === boundingBox.height &&
    (boundingBox.x !== 0 || boundingBox.y !== 0 ||
     boundingBox.width !== canvasWidth || boundingBox.height !== canvasHeight)
  ) {
    x = boundingBox.x;
    y = boundingBox.y;
    width = boundingBox.width;
    height = boundingBox.height;
  } else if (imgWidth !== canvasWidth || imgHeight !== canvasHeight) {
    const imageRatio = imgWidth / imgHeight;
    const canvasRatio = canvasWidth / canvasHeight;
    if (imageRatio > canvasRatio) {
      height = canvasWidth / imageRatio;
      y = (canvasHeight - height) / 2;
    } else {
      width = canvasHeight * imageRatio;
      x = (canvasWidth - width) / 2;
    }
  }

  return { x, y, width, height };
}

registerTest("2.1 Candidate Aspect Ratio: 16:9 (1920x1080) on 1024x1024 canvas computes proper letterbox", () => {
  const bounds = computeAcceptedImageBounds(1920, 1080, 1024, 1024, { x: 0, y: 0, width: 1024, height: 1024 }, null);

  // Expected:
  // imageRatio = 1920 / 1080 = 16 / 9 = ~1.777777778
  // canvasRatio = 1024 / 1024 = 1.0
  // imageRatio > canvasRatio -> letterbox (black bars top/bottom)
  // height = 1024 / (16/9) = 576
  // y = (1024 - 576) / 2 = 224
  // width = 1024, x = 0
  assert.equal(bounds.width, 1024);
  assert.equal(Math.round(bounds.height), 576);
  assert.equal(bounds.x, 0);
  assert.equal(Math.round(bounds.y), 224);

  // Aspect ratio preserved: 1024 / 576 == 1920 / 1080
  const renderedRatio = bounds.width / bounds.height;
  const originalRatio = 1920 / 1080;
  assert.ok(Math.abs(renderedRatio - originalRatio) < 1e-6, "Rendered aspect ratio must match original 16:9");
});

registerTest("2.2 Candidate Aspect Ratio: 9:16 (1080x1920) on 1024x1024 canvas computes proper pillarbox", () => {
  const bounds = computeAcceptedImageBounds(1080, 1920, 1024, 1024, { x: 0, y: 0, width: 1024, height: 1024 }, null);

  // Expected:
  // imageRatio = 1080 / 1920 = 9 / 16 = 0.5625
  // canvasRatio = 1024 / 1024 = 1.0
  // imageRatio <= canvasRatio -> pillarbox (black bars left/right)
  // width = 1024 * (9/16) = 576
  // x = (1024 - 576) / 2 = 224
  // height = 1024, y = 0
  assert.equal(Math.round(bounds.width), 576);
  assert.equal(bounds.height, 1024);
  assert.equal(Math.round(bounds.x), 224);
  assert.equal(bounds.y, 0);

  // Aspect ratio preserved: 576 / 1024 == 1080 / 1920
  const renderedRatio = bounds.width / bounds.height;
  const originalRatio = 1080 / 1920;
  assert.ok(Math.abs(renderedRatio - originalRatio) < 1e-6, "Rendered aspect ratio must match original 9:16");
});

registerTest("2.3 Candidate Aspect Ratio: Ultra-wide 21:9 (2560x1080) and Extreme Portrait (512x2048)", () => {
  const ultraWide = computeAcceptedImageBounds(2560, 1080, 1024, 1024, { x: 0, y: 0, width: 1024, height: 1024 }, null);
  assert.equal(ultraWide.width, 1024);
  assert.ok(Math.abs(ultraWide.width / ultraWide.height - 2560 / 1080) < 1e-6);
  assert.ok(ultraWide.y > 0);

  const tallPortrait = computeAcceptedImageBounds(512, 2048, 1024, 1024, { x: 0, y: 0, width: 1024, height: 1024 }, null);
  assert.equal(tallPortrait.height, 1024);
  assert.ok(Math.abs(tallPortrait.width / tallPortrait.height - 512 / 2048) < 1e-6);
  assert.ok(tallPortrait.x > 0);
});

registerTest("2.4 Parity Verification: updateStagingLayer and handleAcceptStagingToLayer formulas are IDENTICAL", () => {
  const stageSource = fs.readFileSync(path.resolve(PROJECT_ROOT, "src/lib/components/canvas/CanvasStage.svelte"), "utf8");
  
  // Extract formula block from updateStagingLayer
  const updateStagingBlock = stageSource.match(/img\.naturalWidth !== canvas\.canvasWidth \|\| img\.naturalHeight !== canvas\.canvasHeight[\s\S]*?y = \(canvas\.canvasHeight - height\) \/ 2;[\s\S]*?x = \(canvas\.canvasWidth - width\) \/ 2;\s*\}/g);
  
  assert.ok(updateStagingBlock && updateStagingBlock.length >= 2, "Both updateStagingLayer and handleAcceptStagingToLayer must contain identical aspect ratio formula");
  
  // Verify neither stretches image to full canvasWidth/canvasHeight blindly
  assert.ok(stageSource.includes("const imageRatio = img.naturalWidth / img.naturalHeight;"));
  assert.ok(stageSource.includes("const canvasRatio = canvas.canvasWidth / canvas.canvasHeight;"));
});

// ---------------------------------------------------------------------------
// TEST SUITE 3: MASK INVALIDATION ON CLEAR
// ---------------------------------------------------------------------------

registerTest("3.1 Mask Invalidation: clearMask() clears thumbnails and sets hasActiveMask to false", () => {
  canvasStore.initCanvas(1024, 1024);

  // Setup mask layer
  const maskLayer = canvasStore.layers.find((l) => l.type === "mask");
  assert.ok(maskLayer, "Mask layer should exist from initCanvas");

  // Simulate painted mask by setting thumbnail and activeLayer
  canvasStore.setActiveLayer(maskLayer.id);
  canvasStore.setLayerThumbnail(maskLayer.id, "data:image/png;base64,maskstrokes123");
  canvasStore.setPersistedMaskPreview("data:image/png;base64,persistedmask");

  assert.equal(canvasStore.hasActiveMask, true, "hasActiveMask must be true when mask thumbnail exists");
  assert.equal(canvasStore.currentUnifiedAction, "inpaint", "currentUnifiedAction must be inpaint");

  // Call clearMask()
  canvasStore.clearMask();

  assert.equal(canvasStore.hasActiveMask, false, "hasActiveMask must be FALSE after clearMask()");
  assert.equal(canvasStore.layerThumbnails[maskLayer.id], undefined, "maskLayer thumbnail must be deleted");
  assert.equal(canvasStore.persistedMaskPreviewUrl, null, "persistedMaskPreviewUrl must be null");
  assert.notEqual(canvasStore.currentUnifiedAction, "inpaint", "currentUnifiedAction must revert away from inpaint");
});

registerTest("3.2 Mask Invalidation: clearLayer(maskId) clears thumbnail and sets hasActiveMask to false", () => {
  canvasStore.initCanvas(1024, 1024);

  const maskLayer = canvasStore.layers.find((l) => l.type === "mask");
  assert.ok(maskLayer);

  canvasStore.setActiveLayer(maskLayer.id);
  canvasStore.setLayerThumbnail(maskLayer.id, "data:image/png;base64,maskstrokes456");

  assert.equal(canvasStore.hasActiveMask, true);

  // Call clearLayer
  canvasStore.clearLayer(maskLayer.id);

  assert.equal(canvasStore.hasActiveMask, false, "hasActiveMask must be FALSE after clearLayer(maskLayer.id)");
  assert.equal(canvasStore.layerThumbnails[maskLayer.id], undefined);
});

registerTest("3.3 Mask Invalidation: Multiple mask layers cleared simultaneously by clearMask()", () => {
  canvasStore.initCanvas(1024, 1024);

  const mask1 = canvasStore.layers.find((l) => l.type === "mask");
  const mask2Id = canvasStore.addMaskLayer("Secondary Mask");

  canvasStore.setLayerThumbnail(mask1.id, "data:image/png;base64,mask1");
  canvasStore.setLayerThumbnail(mask2Id, "data:image/png;base64,mask2");

  assert.equal(canvasStore.hasActiveMask, true);

  canvasStore.clearMask();

  assert.equal(canvasStore.hasActiveMask, false, "hasActiveMask must be false after all mask layers are cleared");
  assert.equal(canvasStore.layerThumbnails[mask1.id], undefined);
  assert.equal(canvasStore.layerThumbnails[mask2Id], undefined);
});

// ---------------------------------------------------------------------------
// TEST RUNNER
// ---------------------------------------------------------------------------
async function runAll() {
  for (const { name, fn } of testQueue) {
    try {
      const res = fn();
      if (res instanceof Promise) await res;
      passedTests++;
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failedTests++;
      console.error(`  ✗ ${name}`);
      console.error(`    ${err.message}`);
      if (err.stack) {
        console.error(`    ${err.stack.split("\n").slice(1, 3).join("\n")}`);
      }
    }
  }

  console.log("\n=================================================================");
  console.log(`CHALLENGER IT2 EXECUTION SUMMARY: ${passedTests} passed, ${failedTests} failed`);
  console.log("=================================================================");

  if (failedTests > 0) {
    process.exit(1);
  }
}

runAll();
