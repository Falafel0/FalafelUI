// scripts/test-stress-history-pruning.mjs
// Adversarial Stress-Test Harness for Unreferenced Layer Pruning in History Snapshots
// Author: Milestone 3 Challenger 1 Iteration 2 (Staging Stress & History Bounds Challenger)
// Run: node scripts/test-stress-history-pruning.mjs

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const PROJECT_ROOT = new URL("../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

console.log("=================================================================");
console.log("MooshieUI Milestone 3 History Unreferenced Layer Pruning Harness");
console.log("Testing: Rapid Creation (20), Deletion (15), COW Sharing,");
console.log("         Dictionary Key Pruning, Memory Non-Bloat, Undo/Redo Integrity");
console.log("=================================================================\n");

let passed = 0;
let failed = 0;
const failures = [];
const testQueue = [];

function challenge(title, fn) {
  testQueue.push({ title, fn });
}

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
      createObjectURL: (blob) => `blob:mock-url-${Date.now()}`,
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

const { canvasHistory, CanvasHistoryStore, MAX_HISTORY } = canvasHistoryModule;
const canvasStore = canvasStoreModule.canvas;

function resetCanvas() {
  canvasStore.initCanvas(1024, 1024);
  canvasStore.clearStaging();
  canvasHistory.clear();
}

// ============================================================================
// TEST SUITE: UNREFERENCED LAYER PRUNING & MEMORY BOUNDS
// ============================================================================

challenge("P1. Rapidly create 20 layers, delete 15, verify snapshot dictionary prunes unreferenced layers", async () => {
  resetCanvas();
  canvasHistory.connectCanvasStore(canvasStore);

  // Setup mock Konva layer map
  const mockKonvaMap = new Map();
  const makeMockKonva = (id, payloadSize = 256) => ({
    scaleX: () => 1,
    scaleY: () => 1,
    x: () => 0,
    y: () => 0,
    toDataURL: () => `data:image/png;base64,${"A".repeat(payloadSize)}_${id}`,
  });

  // Clear existing default layers to start with known state
  canvasStore.layers = [];

  // 1. Create 20 raster layers rapidly
  const createdIds = [];
  for (let i = 1; i <= 20; i++) {
    const id = canvasStore.addLayer("raster", `Layer ${i}`);
    createdIds.push(id);
    mockKonvaMap.set(id, makeMockKonva(id));
  }
  assert.equal(canvasStore.layers.length, 20, "Must have created exactly 20 layers");
  assert.equal(createdIds.length, 20);

  canvasHistory.setRefs(mockKonvaMap, 1024, 1024);

  // 2. Take initial snapshot of all 20 layers
  canvasHistory.snapshot("All 20 layers created");
  assert.equal(canvasHistory.undoStack.length, 1);
  const snap0 = canvasHistory.undoStack[0];
  assert.equal(snap0.layers.length, 20, "Snapshot 0 must have 20 layer metadata entries");
  assert.equal(Object.keys(snap0.layerPixels).length, 20, "Snapshot 0 must have 20 pixel dictionary entries");
  for (const id of createdIds) {
    assert.ok(snap0.layerPixels[id], `snap0 must contain pixel entry for ${id}`);
  }

  // 3. Delete 15 layers (keep first 5, delete 15)
  const keptIds = createdIds.slice(0, 5);
  const deletedIds = createdIds.slice(5);
  assert.equal(keptIds.length, 5);
  assert.equal(deletedIds.length, 15);

  for (const id of deletedIds) {
    canvasStore.deleteLayer(id);
    mockKonvaMap.delete(id);
  }
  assert.equal(canvasStore.layers.length, 5, "Store must now have exactly 5 layers");

  // 4. Take snapshot after deleting 15 layers
  canvasHistory.snapshot("Deleted 15 layers");
  assert.equal(canvasHistory.undoStack.length, 2);
  const snap1 = canvasHistory.undoStack[1];

  // Verify snap1 metadata
  assert.equal(snap1.layers.length, 5, "Snapshot 1 must have exactly 5 layer metadata entries");
  assert.deepEqual(
    JSON.parse(JSON.stringify(snap1.layers.map((l) => l.id))),
    keptIds,
    "Snapshot 1 layers must match kept IDs"
  );

  // Verify snap1 pixel dictionary DOES NOT bloat with pruned layers
  const snap1PixelKeys = Object.keys(snap1.layerPixels);
  assert.equal(
    snap1PixelKeys.length,
    5,
    `Snapshot 1 must have exactly 5 pixel entries, but has ${snap1PixelKeys.length}`
  );

  // Assert that NONE of the 15 deleted IDs exist in snap1.layerPixels
  for (const deletedId of deletedIds) {
    assert.equal(
      snap1.layerPixels[deletedId],
      undefined,
      `Pruned layer ${deletedId} MUST NOT exist in snapshot 1 layerPixels dictionary`
    );
  }

  // Assert that ALL kept IDs exist in snap1.layerPixels
  for (const keptId of keptIds) {
    assert.ok(
      snap1.layerPixels[keptId],
      `Kept layer ${keptId} must exist in snapshot 1 layerPixels`
    );
  }
});

challenge("P2. Multi-round subsequent snapshots never resurrect pruned layers (COW leak prevention)", async () => {
  resetCanvas();
  canvasHistory.connectCanvasStore(canvasStore);

  const mockKonvaMap = new Map();
  const makeMockKonva = (id) => ({
    scaleX: () => 1,
    scaleY: () => 1,
    x: () => 0,
    y: () => 0,
    toDataURL: () => `data:image/png;base64,PIXELS_${id}`,
  });

  canvasStore.layers = [];
  const createdIds = [];
  for (let i = 1; i <= 20; i++) {
    const id = canvasStore.addLayer("raster", `L_${i}`);
    createdIds.push(id);
    mockKonvaMap.set(id, makeMockKonva(id));
  }
  canvasHistory.setRefs(mockKonvaMap, 1024, 1024);

  // Snapshot with 20
  canvasHistory.snapshot("Initial 20");

  // Delete 15
  const deletedIds = createdIds.slice(5);
  for (const id of deletedIds) {
    canvasStore.deleteLayer(id);
    mockKonvaMap.delete(id);
  }

  // Take 10 subsequent snapshots with mutations on the kept 5 layers
  for (let round = 1; round <= 10; round++) {
    const keptLayer = canvasStore.layers[round % 5];
    keptLayer.opacity = 0.5 + (round * 0.04);
    canvasHistory.snapshot(`Round ${round} modification on ${keptLayer.id}`);

    const latestSnap = canvasHistory.undoStack[canvasHistory.undoStack.length - 1];
    const keys = Object.keys(latestSnap.layerPixels);
    assert.equal(
      keys.length,
      5,
      `Round ${round}: layerPixels must stay at exactly 5 entries, found ${keys.length}`
    );

    // Ensure zero zombie entries across all rounds
    for (const dId of deletedIds) {
      assert.equal(
        latestSnap.layerPixels[dId],
        undefined,
        `Round ${round}: zombie key ${dId} found in snapshot layerPixels!`
      );
    }
  }
});

challenge("P3. Dictionary memory overhead scales O(current_layers), not O(all_created_layers)", async () => {
  resetCanvas();
  canvasHistory.connectCanvasStore(canvasStore);

  const mockKonvaMap = new Map();
  // Large payload per layer (4KB per mock data URL)
  const makeLargeMockKonva = (id) => ({
    scaleX: () => 1,
    scaleY: () => 1,
    x: () => 0,
    y: () => 0,
    toDataURL: () => `data:image/png;base64,${"X".repeat(4096)}_${id}`,
  });

  canvasStore.layers = [];
  const allCreated = [];
  for (let i = 1; i <= 20; i++) {
    const id = canvasStore.addLayer("raster", `Heavy_${i}`);
    allCreated.push(id);
    mockKonvaMap.set(id, makeLargeMockKonva(id));
  }
  canvasHistory.setRefs(mockKonvaMap, 1024, 1024);

  canvasHistory.snapshot("20 Heavy Layers");
  const heavySnap0 = canvasHistory.undoStack[0];
  const sizeWith20 = JSON.stringify(heavySnap0.layerPixels).length;

  // Delete 15 heavy layers
  for (let i = 5; i < 20; i++) {
    canvasStore.deleteLayer(allCreated[i]);
    mockKonvaMap.delete(allCreated[i]);
  }

  canvasHistory.snapshot("Pruned to 5 Heavy Layers");
  const prunedSnap = canvasHistory.undoStack[1];
  const sizeWith5 = JSON.stringify(prunedSnap.layerPixels).length;

  // Expected size with 5 should be approximately 25% of size with 20 (plus small JSON overhead)
  const ratio = sizeWith5 / sizeWith20;
  console.log(`     Memory footprint check: 20 layers = ${sizeWith20} bytes, 5 layers = ${sizeWith5} bytes (ratio: ${(ratio * 100).toFixed(1)}%)`);
  assert.ok(
    ratio < 0.35,
    `Memory footprint must drop proportionally (expected ratio < 0.35, got ${ratio})`
  );
});

challenge("P4. Incremental deletion of 19 layers monotonically shrinks dictionary count", async () => {
  resetCanvas();
  canvasHistory.connectCanvasStore(canvasStore);

  const mockKonvaMap = new Map();
  canvasStore.layers = [];
  const layerIds = [];
  for (let i = 1; i <= 20; i++) {
    const id = canvasStore.addLayer("raster", `Inc_${i}`);
    layerIds.push(id);
    mockKonvaMap.set(id, {
      scaleX: () => 1, scaleY: () => 1, x: () => 0, y: () => 0,
      toDataURL: () => `data:image/png;base64,INC_${id}`,
    });
  }
  canvasHistory.setRefs(mockKonvaMap, 1024, 1024);
  canvasHistory.snapshot("Full 20");

  // Incrementally delete 19 layers (store preserves invariant: last raster layer cannot be deleted)
  for (let i = 19; i >= 1; i--) {
    const idToDelete = layerIds[i];
    const ok = canvasStore.deleteLayer(idToDelete);
    assert.equal(ok, true, `Deleting layer ${idToDelete} must return true`);
    mockKonvaMap.delete(idToDelete);
    canvasHistory.snapshot(`After deleting ${idToDelete}`);

    const snap = canvasHistory.undoStack[canvasHistory.undoStack.length - 1];
    const keyCount = Object.keys(snap.layerPixels).length;
    assert.equal(
      keyCount,
      i,
      `After deleting layer index ${i}, dictionary must have exactly ${i} keys, got ${keyCount}`
    );
  }

  // Clear store completely to test 0 layers boundary snapshot
  canvasStore.layers = [];
  canvasHistory.snapshot("Forced empty 0 layers");
  const emptySnap = canvasHistory.undoStack[canvasHistory.undoStack.length - 1];
  assert.equal(Object.keys(emptySnap.layerPixels).length, 0, "Empty canvas snapshot must have 0 pixel keys");
  assert.equal(emptySnap.layers.length, 0, "Empty canvas snapshot must have 0 layers");
});

challenge("P5. Undo / Redo restores historical layers and preserves pruned state across timeline steps", async () => {
  resetCanvas();
  canvasHistory.connectCanvasStore(canvasStore);

  const mockKonvaMap = new Map();
  canvasStore.layers = [];
  const layerIds = [];
  for (let i = 1; i <= 20; i++) {
    const id = canvasStore.addLayer("raster", `Timeline_${i}`);
    layerIds.push(id);
    mockKonvaMap.set(id, {
      scaleX: () => 1, scaleY: () => 1, x: () => 0, y: () => 0,
      toDataURL: () => `data:image/png;base64,TL_${id}`,
      destroyChildren: () => {},
      add: () => {},
      batchDraw: () => {},
    });
  }
  canvasHistory.setRefs(mockKonvaMap, 1024, 1024);

  // Checkpoint 0: Snapshot before deleting 15 layers (captures 20 layers)
  canvasHistory.snapshot("Before deleting 15 layers");

  // Perform Action 1: Delete 15 layers (leaving 5 layers)
  for (let i = 5; i < 20; i++) {
    canvasStore.deleteLayer(layerIds[i]);
    mockKonvaMap.delete(layerIds[i]);
  }
  assert.equal(canvasStore.layers.length, 5);

  // Checkpoint 1: Snapshot before modifying layer 0 (captures 5 layers, opacity = 1.0)
  canvasHistory.snapshot("Before modifying layer 0");

  // Perform Action 2: Modify Layer 0 opacity
  canvasStore.layers[0].opacity = 0.2;

  // Currently: canvas has 5 layers with opacity = 0.2; undoStack has 2 checkpoints
  assert.equal(canvasHistory.undoStack.length, 2);

  // Step 1: Undo Action 2 -> restores Checkpoint 1 (5 layers, opacity 1.0)
  const snap1 = canvasHistory.undo();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(canvasStore.layers.length, 5, "Undo 1 must restore 5 layers");
  assert.equal(canvasStore.layers[0].opacity, 1.0, "Undo 1 must restore original opacity 1.0");
  assert.equal(Object.keys(snap1.layerPixels).length, 5, "snap1 must have 5 pruned keys");

  // Step 2: Undo Action 1 -> restores Checkpoint 0 (20 layers intact)
  const snap0 = canvasHistory.undo();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(canvasStore.layers.length, 20, "Undo 2 must restore all 20 layers");
  assert.equal(Object.keys(snap0.layerPixels).length, 20, "snap0 must have all 20 historical keys");

  // Step 3: Redo Action 1 -> re-applies Checkpoint 1 (5 layers)
  const redoSnap1 = canvasHistory.redo();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(canvasStore.layers.length, 5, "Redo 1 must restore 5 layers");
  assert.equal(canvasStore.layers[0].opacity, 1.0, "Redo 1 must have opacity 1.0");
  assert.equal(Object.keys(redoSnap1.layerPixels).length, 5, "redoSnap1 must have 5 keys");

  // Step 4: Redo Action 2 -> re-applies Action 2 (5 layers, opacity 0.2)
  const redoSnap2 = canvasHistory.redo();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(canvasStore.layers.length, 5, "Redo 2 must restore 5 layers");
  assert.equal(canvasStore.layers[0].opacity, 0.2, "Redo 2 must restore opacity 0.2");
});

challenge("P6. Re-adding layer with recycled ID binds clean state without phantom leakage", async () => {
  resetCanvas();
  canvasHistory.connectCanvasStore(canvasStore);

  const mockKonvaMap = new Map();
  canvasStore.layers = [];
  const id1 = canvasStore.addLayer("raster", "Original Layer 1");
  const id2 = canvasStore.addLayer("raster", "Original Layer 2");
  mockKonvaMap.set(id1, {
    scaleX: () => 1, scaleY: () => 1, x: () => 0, y: () => 0,
    toDataURL: () => "data:image/png;base64,OLD_PIXELS",
  });
  mockKonvaMap.set(id2, {
    scaleX: () => 1, scaleY: () => 1, x: () => 0, y: () => 0,
    toDataURL: () => "data:image/png;base64,LAYER2_PIXELS",
  });
  canvasHistory.setRefs(mockKonvaMap, 1024, 1024);

  canvasHistory.snapshot("Original");
  assert.equal(canvasHistory.undoStack[0].layerPixels[id1], "data:image/png;base64,OLD_PIXELS");

  // Delete layer 1 (layer 2 remains, satisfying rasterCount invariant)
  const delOk = canvasStore.deleteLayer(id1);
  assert.equal(delOk, true, "deleteLayer must return true when another raster exists");
  mockKonvaMap.delete(id1);
  canvasHistory.snapshot("Deleted");
  assert.equal(canvasHistory.undoStack[1].layerPixels[id1], undefined, "Must be pruned");

  // Manually re-insert a layer with the exact same ID but new pixels
  canvasStore.layers.push({
    id: id1,
    name: "Recycled ID Layer",
    type: "raster",
    visible: true,
    locked: false,
    opacity: 1,
    order: 1,
  });
  mockKonvaMap.set(id1, {
    scaleX: () => 1, scaleY: () => 1, x: () => 0, y: () => 0,
    toDataURL: () => "data:image/png;base64,BRAND_NEW_PIXELS",
  });

  canvasHistory.snapshot("Re-added recycled ID");
  const snap2 = canvasHistory.undoStack[2];
  assert.equal(
    snap2.layerPixels[id1],
    "data:image/png;base64,BRAND_NEW_PIXELS",
    "Recycled ID must bind brand new pixels, not stale old pixels"
  );
});

// ============================================================================
// RUNNER
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
  console.log(`UNREFERENCED PRUNING TEST COMPLETE: ${passed} Passed, ${failed} Failed`);
  console.log("=================================================================");

  if (failed > 0) {
    console.error(`\nFAILURES (${failed}):`);
    for (const f of failures) {
      console.error(`  - ${f.title}: ${f.error.message}`);
    }
    process.exit(1);
  } else {
    console.log("\nALL UNREFERENCED PRUNING STRESS CHALLENGES PASSED (100% GREEN)!");
    process.exit(0);
  }
}

runAllTests().catch((err) => {
  console.error("Fatal runner error:", err);
  process.exit(1);
});
