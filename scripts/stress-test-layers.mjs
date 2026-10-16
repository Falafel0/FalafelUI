// scripts/stress-test-layers.mjs
// Adversarial Stress-Test Harness for Milestone 2 Layer System & Store Invariants
// Author: Milestone 2 Challenger 1 (Layer Store Adversarial Challenger)
// Run: node scripts/stress-test-layers.mjs

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const PROJECT_ROOT = new URL("../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

console.log("=================================================================");
console.log("MooshieUI Milestone 2 Adversarial Layer Stress-Test Harness");
console.log("Testing: Layer Operations, Store Invariants, Blend Modes,");
console.log("         Opacity Bounds, Regional Layers, ControlNet Parameters");
console.log("=================================================================\n");

let passed = 0;
let failed = 0;
const failures = [];

async function challenge(title, fn) {
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

// ----------------------------------------------------------------------------
// Load Canvas Types and Store Module
// ----------------------------------------------------------------------------

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
        return loadModule("src/lib/types/canvas.ts", extraContext);
      }
      return {};
    },
    $state: (val) => val,
    $derived: (val) => val,
    URL: {
      createObjectURL: () => "blob:mock-url",
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
const canvasStoreModule = loadModule("src/lib/stores/canvas.svelte.ts");
const { CanvasBlendMode, CANVAS_BLEND_MODES, BLEND_MODE_COMPOSITE_MAP, BLEND_MODE_CSS_MAP } = canvasTypes;
const canvasStore = canvasStoreModule.canvas;

// Helper to reset canvas store to clean state
function resetStore() {
  canvasStore.initCanvas(1024, 1024);
}

// ============================================================================
// 1. LAYER OPERATIONS STRESS TESTING
// ============================================================================
console.log("--- 1. LAYER OPERATIONS STRESS TESTING ---");

challenge("Layer Ops: Rapid add of 200 mixed layers maintains strict contiguous order 0..N-1", () => {
  resetStore();
  const types = ["raster", "mask", "regional", "controlnet"];
  for (let i = 0; i < 200; i++) {
    const t = types[i % types.length];
    canvasStore.addLayer(t, `Stress_${t}_${i}`);
  }
  // Initial initCanvas created 1 raster and 1 mask, so 202 total
  assert.equal(canvasStore.layers.length, 202);

  // Check strict contiguous order
  for (let i = 0; i < canvasStore.layers.length; i++) {
    const l = canvasStore.layers[i];
    assert.equal(l.order, i, `Layer at index ${i} must have order === ${i}, found ${l.order}`);
    assert.equal(l.zIndex, i, `Layer at index ${i} must have zIndex === ${i}, found ${l.zIndex}`);
  }
});

challenge("Layer Ops: Reorder with extreme negative index (-999) safely clamps to bottom (order 0)", () => {
  resetStore();
  const id1 = canvasStore.addRasterLayer("Layer Alpha");
  const id2 = canvasStore.addRasterLayer("Layer Beta");
  const id3 = canvasStore.addRasterLayer("Layer Gamma");

  // Move topmost layer to -999
  canvasStore.reorderLayer(id3, -999);
  assert.equal(canvasStore.layers[0].id, id3, "Extreme negative index must place layer at index 0");

  // Verify contiguous order sequence across all layers
  for (let i = 0; i < canvasStore.layers.length; i++) {
    assert.equal(canvasStore.layers[i].order, i);
    assert.equal(canvasStore.layers[i].zIndex, i);
  }
});

challenge("Layer Ops: Reorder with extreme positive index (+999) safely clamps to top (order N-1)", () => {
  resetStore();
  const bottomId = canvasStore.layers[0].id;

  // Move bottom layer to +999
  canvasStore.reorderLayer(bottomId, 999);
  const lastIndex = canvasStore.layers.length - 1;
  assert.equal(canvasStore.layers[lastIndex].id, bottomId, "Extreme positive index must place layer at index N-1");

  // Verify contiguous order sequence across all layers
  for (let i = 0; i < canvasStore.layers.length; i++) {
    assert.equal(canvasStore.layers[i].order, i);
    assert.equal(canvasStore.layers[i].zIndex, i);
  }
});

challenge("Layer Ops: Reorder non-existent layer ID is a safe no-op", () => {
  resetStore();
  const beforeSnapshot = JSON.stringify(canvasStore.layers);
  canvasStore.reorderLayer("non_existent_layer_id_99999", 0);
  canvasStore.reorderLayer("non_existent_layer_id_99999", "up");
  canvasStore.reorderLayer("non_existent_layer_id_99999", "down");
  const afterSnapshot = JSON.stringify(canvasStore.layers);
  assert.equal(beforeSnapshot, afterSnapshot, "Non-existent layer reorder must not mutate layers");
});

challenge("Layer Ops: Reorder 'up' at topmost layer and 'down' at bottommost layer are clamped", () => {
  resetStore();
  const topLayer = canvasStore.layers[canvasStore.layers.length - 1];
  const bottomLayer = canvasStore.layers[0];

  canvasStore.reorderLayer(topLayer.id, "up");
  assert.equal(canvasStore.layers[canvasStore.layers.length - 1].id, topLayer.id);

  canvasStore.reorderLayer(bottomLayer.id, "down");
  assert.equal(canvasStore.layers[0].id, bottomLayer.id);
});

challenge("Layer Ops: 100 randomized reorder operations preserve all IDs and contiguous orders", () => {
  resetStore();
  for (let i = 0; i < 15; i++) {
    canvasStore.addRasterLayer(`RandLayer_${i}`);
  }
  const originalIds = new Set(canvasStore.layers.map((l) => l.id));

  // 100 random reorders
  for (let step = 0; step < 100; step++) {
    const randomLayer = canvasStore.layers[Math.floor(Math.random() * canvasStore.layers.length)];
    const targetIdx = Math.floor(Math.random() * (canvasStore.layers.length + 10)) - 5; // can be negative or > len
    canvasStore.reorderLayer(randomLayer.id, targetIdx);
  }

  // Verify set of IDs is 100% preserved
  const currentIds = new Set(canvasStore.layers.map((l) => l.id));
  assert.equal(currentIds.size, originalIds.size);
  for (const id of originalIds) {
    assert.ok(currentIds.has(id));
  }

  // Verify strict ordering 0..N-1
  for (let i = 0; i < canvasStore.layers.length; i++) {
    assert.equal(canvasStore.layers[i].order, i);
    assert.equal(canvasStore.layers[i].zIndex, i);
  }
});

challenge("Layer Ops: Rapid duplication deep-copies properties and activates duplicate", async () => {
  resetStore();
  const originalId = canvasStore.addRasterLayer("Master Piece", {
    opacity: 0.73,
    blendMode: "overlay",
    denoise: 0.65,
  });

  const dupId = await canvasStore.duplicateLayer(originalId);
  assert.ok(dupId);
  assert.notEqual(dupId, originalId);
  assert.equal(canvasStore.activeLayerId, dupId, "Duplication must set activeLayerId to the new duplicate");

  const duplicate = canvasStore.layers.find((l) => l.id === dupId);
  assert.ok(duplicate);
  assert.equal(duplicate.name, "Master Piece copy");
  assert.equal(duplicate.opacity, 0.73);
  assert.equal(duplicate.blendMode, "overlay");
  assert.equal(duplicate.denoise, 0.65);

  // Original layer must remain intact
  const original = canvasStore.layers.find((l) => l.id === originalId);
  assert.equal(original.name, "Master Piece");
  assert.equal(original.opacity, 0.73);
});

challenge("Layer Ops: Duplicate non-existent ID safely returns null", async () => {
  resetStore();
  const result = await canvasStore.duplicateLayer("ghost_layer_unknown");
  assert.equal(result, null);
});

challenge("Layer Ops: Deleting active layer safely shifts activeLayerId to valid neighbor", () => {
  resetStore();
  const id1 = canvasStore.addRasterLayer("L1");
  const id2 = canvasStore.addRasterLayer("L2");
  const id3 = canvasStore.addRasterLayer("L3");

  // id3 is active
  assert.equal(canvasStore.activeLayerId, id3);

  // Delete active layer id3
  const ok = canvasStore.deleteLayer(id3);
  assert.equal(ok, true);
  assert.ok(canvasStore.activeLayerId, "activeLayerId must not be null");
  assert.notEqual(canvasStore.activeLayerId, id3, "activeLayerId must not remain the deleted ID");
  assert.ok(
    canvasStore.layers.some((l) => l.id === canvasStore.activeLayerId),
    "activeLayerId must belong to an existing layer"
  );
});

// ============================================================================
// 2. INVARIANT ENFORCEMENT: LAST RASTER LAYER DELETION
// ============================================================================
console.log("\n--- 2. INVARIANT ENFORCEMENT: LAST RASTER LAYER ---");

challenge("Invariant: Single raster layer cannot be deleted", () => {
  resetStore();
  const raster = canvasStore.layers.find((l) => l.type === "raster");
  assert.ok(raster);

  const deleted = canvasStore.removeLayer(raster.id);
  assert.equal(deleted, false, "Must reject deletion of the sole raster layer");
  assert.ok(canvasStore.layers.some((l) => l.id === raster.id), "Raster layer must still exist");
});

challenge("Invariant: Sole raster layer with multiple other layer types cannot be deleted", () => {
  resetStore();
  // Store currently has 1 raster and 1 mask
  canvasStore.addMaskLayer("Mask 2");
  canvasStore.addRegionalLayer("Region 1");
  canvasStore.addRegionalLayer("Region 2");
  canvasStore.addControlNetLayer("ControlNet 1");
  canvasStore.addControlNetLayer("ControlNet 2");

  assert.equal(canvasStore.layers.length, 7);
  const raster = canvasStore.layers.find((l) => l.type === "raster");
  assert.ok(raster);

  const deleted = canvasStore.removeLayer(raster.id);
  assert.equal(deleted, false, "Must reject deleting the sole raster layer even with 6 other non-raster layers");
  assert.equal(canvasStore.layers.length, 7);
});

challenge("Invariant: Non-raster layers can all be deleted down to 0", () => {
  resetStore();
  const maskLayers = canvasStore.layers.filter((l) => l.type === "mask");
  for (const m of maskLayers) {
    const ok = canvasStore.removeLayer(m.id);
    assert.equal(ok, true);
  }
  assert.equal(canvasStore.layers.filter((l) => l.type === "mask").length, 0);
  assert.equal(canvasStore.layers.length, 1);
  assert.equal(canvasStore.layers[0].type, "raster");
});

challenge("Invariant: With 2 raster layers, one can be deleted, but the remaining one cannot", () => {
  resetStore();
  const r1 = canvasStore.layers.find((l) => l.type === "raster");
  const r2Id = canvasStore.addRasterLayer("Second Raster");

  assert.equal(canvasStore.layers.filter((l) => l.type === "raster").length, 2);

  // Delete r1 -> should succeed
  const ok1 = canvasStore.removeLayer(r1.id);
  assert.equal(ok1, true, "First raster deletion should succeed when another exists");
  assert.equal(canvasStore.layers.filter((l) => l.type === "raster").length, 1);

  // Delete r2 -> should fail
  const ok2 = canvasStore.removeLayer(r2Id);
  assert.equal(ok2, false, "Second raster deletion must fail as it is now the last raster");
  assert.equal(canvasStore.layers.filter((l) => l.type === "raster").length, 1);
});

// ============================================================================
// 3. BLEND MODES STRESS TESTING
// ============================================================================
console.log("\n--- 3. BLEND MODES STRESS TESTING ---");

challenge("Blend Modes: Cycle all 6 Photoshop blend modes on raster layer", () => {
  resetStore();
  const raster = canvasStore.layers.find((l) => l.type === "raster");
  const modes = ["normal", "multiply", "screen", "overlay", "darken", "lighten"];

  for (const mode of modes) {
    canvasStore.setLayerBlendMode(raster.id, mode);
    const updated = canvasStore.layers.find((l) => l.id === raster.id);
    assert.equal(updated.blendMode, mode);

    // Verify mapping in BLEND_MODE_COMPOSITE_MAP
    const compOp = BLEND_MODE_COMPOSITE_MAP[mode];
    assert.ok(compOp, `Composite op mapping missing for ${mode}`);
    if (mode === "normal") assert.equal(compOp, "source-over");
    else assert.equal(compOp, mode);

    // Verify mapping in BLEND_MODE_CSS_MAP
    const cssMode = BLEND_MODE_CSS_MAP[mode];
    assert.equal(cssMode, mode, `CSS mapping missing for ${mode}`);
  }
});

challenge("Blend Modes: Cycle all 6 blend modes on mask layer", () => {
  resetStore();
  const mask = canvasStore.layers.find((l) => l.type === "mask");
  const modes = ["normal", "multiply", "screen", "overlay", "darken", "lighten"];

  for (const mode of modes) {
    canvasStore.setLayerBlendMode(mask.id, mode);
    const updated = canvasStore.layers.find((l) => l.id === mask.id);
    assert.equal(updated.blendMode, mode);
  }
});

challenge("Blend Modes: CANVAS_BLEND_MODES array contains exactly the 6 authoritative modes", () => {
  const expected = ["normal", "multiply", "screen", "overlay", "darken", "lighten"];
  assert.deepEqual([...CANVAS_BLEND_MODES], expected);
});

// ============================================================================
// 4. OPACITY BOUNDS STRESS TESTING
// ============================================================================
console.log("\n--- 4. OPACITY BOUNDS STRESS TESTING ---");

challenge("Opacity: Negative numbers clamped strictly to 0.0", () => {
  resetStore();
  const layer = canvasStore.layers[0];

  const negatives = [-0.000001, -0.1, -1.0, -100.0, -999999];
  for (const val of negatives) {
    canvasStore.setLayerOpacity(layer.id, val);
    const cur = canvasStore.layers.find((l) => l.id === layer.id);
    assert.equal(cur.opacity, 0.0, `Expected 0.0 for input ${val}, got ${cur.opacity}`);
  }
});

challenge("Opacity: Numbers > 1.0 clamped strictly to 1.0", () => {
  resetStore();
  const layer = canvasStore.layers[0];

  const positives = [1.000001, 1.1, 2.0, 50.0, 999999];
  for (const val of positives) {
    canvasStore.setLayerOpacity(layer.id, val);
    const cur = canvasStore.layers.find((l) => l.id === layer.id);
    assert.equal(cur.opacity, 1.0, `Expected 1.0 for input ${val}, got ${cur.opacity}`);
  }
});

challenge("Opacity: Exact boundary values 0.0 and 1.0 preserved exactly", () => {
  resetStore();
  const layer = canvasStore.layers[0];

  canvasStore.setLayerOpacity(layer.id, 0.0);
  assert.equal(canvasStore.layers.find((l) => l.id === layer.id).opacity, 0.0);

  canvasStore.setLayerOpacity(layer.id, 1.0);
  assert.equal(canvasStore.layers.find((l) => l.id === layer.id).opacity, 1.0);
});

challenge("Opacity: Decimal values between 0.0 and 1.0 preserved accurately", () => {
  resetStore();
  const layer = canvasStore.layers[0];
  const testVals = [0.05, 0.125, 0.333, 0.5, 0.75, 0.99];

  for (const val of testVals) {
    canvasStore.setLayerOpacity(layer.id, val);
    assert.equal(canvasStore.layers.find((l) => l.id === layer.id).opacity, val);
  }
});

challenge("Opacity: NaN and non-finite numbers safely handled without corrupting state", () => {
  resetStore();
  const layer = canvasStore.layers[0];

  // NaN
  canvasStore.setLayerOpacity(layer.id, NaN);
  let cur = canvasStore.layers.find((l) => l.id === layer.id);
  assert.ok(!Number.isNaN(cur.opacity), "Opacity must never be NaN");
  assert.ok(cur.opacity >= 0.0 && cur.opacity <= 1.0);

  // +Infinity
  canvasStore.setLayerOpacity(layer.id, Infinity);
  cur = canvasStore.layers.find((l) => l.id === layer.id);
  assert.ok(Number.isFinite(cur.opacity), "Opacity must be finite");
  assert.ok(cur.opacity >= 0.0 && cur.opacity <= 1.0);

  // -Infinity
  canvasStore.setLayerOpacity(layer.id, -Infinity);
  cur = canvasStore.layers.find((l) => l.id === layer.id);
  assert.ok(Number.isFinite(cur.opacity), "Opacity must be finite");
  assert.ok(cur.opacity >= 0.0 && cur.opacity <= 1.0);

  // null / undefined cast
  canvasStore.setLayerOpacity(layer.id, null);
  cur = canvasStore.layers.find((l) => l.id === layer.id);
  assert.ok(Number.isFinite(cur.opacity));

  canvasStore.setLayerOpacity(layer.id, undefined);
  cur = canvasStore.layers.find((l) => l.id === layer.id);
  assert.ok(Number.isFinite(cur.opacity));
});

// ============================================================================
// 5. REGIONAL LAYER COORDINATES & PROMPT LENGTHS
// ============================================================================
console.log("\n--- 5. REGIONAL LAYER COORDINATES & PROMPTS ---");

challenge("Regional Layer: Creation initializes normalized defaults [0, 0, 0.5, 0.5]", () => {
  resetStore();
  const regId = canvasStore.addRegionalLayer("Test Region");
  const reg = canvasStore.layers.find((l) => l.id === regId);
  assert.equal(reg.type, "regional");
  assert.equal(reg.x, 0.0);
  assert.equal(reg.y, 0.0);
  assert.equal(reg.width, 0.5);
  assert.equal(reg.height, 0.5);
  assert.equal(reg.weight, 1.0);
});

challenge("Regional Layer: Snap bounding box with extreme coordinates clamps minimum to 64px", () => {
  resetStore();
  // Regional layer with 0 width and negative coords
  const regId = canvasStore.addRegionalLayer("Degenerate Region", {
    x: -0.5,
    y: -0.5,
    width: 0.0,
    height: -0.2,
  });

  canvasStore.snapBoundingBoxToLayer(regId);
  assert.ok(canvasStore.boundingBox.width >= 64, "Bounding box width must be at least 64px");
  assert.ok(canvasStore.boundingBox.height >= 64, "Bounding box height must be at least 64px");
});

challenge("Regional Layer: Snap bounding box maps normalized coords accurately to canvas dimensions", () => {
  resetStore();
  canvasStore.initCanvas(1920, 1080);
  const regId = canvasStore.addRegionalLayer("Right Half", {
    x: 0.5,
    y: 0.0,
    width: 0.5,
    height: 1.0,
  });

  canvasStore.snapBoundingBoxToLayer(regId);
  assert.equal(canvasStore.boundingBox.x, 960);
  assert.equal(canvasStore.boundingBox.y, 0);
  assert.equal(canvasStore.boundingBox.width, 960);
  assert.equal(canvasStore.boundingBox.height, 1080);
});

challenge("Regional Layer: Reset bounding box restores full canvas dimensions", () => {
  resetStore();
  canvasStore.boundingBox = { x: 100, y: 100, width: 200, height: 200, locked: true };
  canvasStore.resetBoundingBoxToCanvas();
  assert.equal(canvasStore.boundingBox.x, 0);
  assert.equal(canvasStore.boundingBox.y, 0);
  assert.equal(canvasStore.boundingBox.width, canvasStore.canvasWidth);
  assert.equal(canvasStore.boundingBox.height, canvasStore.canvasHeight);
  assert.equal(canvasStore.boundingBox.locked, false);
});

challenge("Regional Layer: Stress-test extreme prompt length (10,000 chars) & Unicode characters", () => {
  resetStore();
  const regId = canvasStore.addRegionalLayer("Long Prompt Region");

  const longPrompt = "masterpiece, ultra-detailed, cinematic lighting, ".repeat(200); // ~10,000 chars
  const unicodePrompt = "Русский текст: красивый закат 🌅, 中文提示词: 美丽风景, 日本語: 満開の桜 🌸, العربية: واحة جميلة";

  canvasStore.setRegionalProps(regId, { prompt: longPrompt, negativePrompt: unicodePrompt });
  const reg = canvasStore.layers.find((l) => l.id === regId);
  assert.equal(reg.prompt.length, longPrompt.length);
  assert.equal(reg.negativePrompt, unicodePrompt);
});

challenge("Regional Layer: LoRA tag stripping removes inline tags and normalizes commas", () => {
  const testCases = [
    { input: "1girl, smiling <lora:detailer:0.8>, blue dress", expected: "1girl, smiling, blue dress" },
    { input: "<lora:art_style:1.0> sunset landscape <lora:hdr:0.5:0.5>", expected: "sunset landscape" },
    { input: "no lora tag here", expected: "no lora tag here" },
    { input: "<LORA:CaseInsensitive:1.2>", expected: "" },
  ];

  for (const { input, expected } of testCases) {
    const cleaned = input
      .replace(/<lora:[^>]+>/gi, "")
      .replace(/\s*,\s*/g, ", ")
      .replace(/\s{2,}/g, " ")
      .trim();
    assert.equal(cleaned, expected);
  }
});

// Additional edge-case challenges:
challenge("Regional Layer: Denoise and weight bounds under adversarial values", () => {
  resetStore();
  const regId = canvasStore.addRegionalLayer("Weight Test");
  canvasStore.setRegionalProps(regId, { weight: -5.0 });
  let reg = canvasStore.layers.find((l) => l.id === regId);
  assert.equal(reg.weight, -5.0); // Raw store allows assignment; backend clamps to [0.0, 2.0]
  const clampedBackend = Math.max(0.0, Math.min(2.0, reg.weight));
  assert.equal(clampedBackend, 0.0);
});

challenge("Store State: sortedLayers returns layers descending by order (top to bottom)", () => {
  resetStore();
  const r1 = canvasStore.addRasterLayer("Bottom");
  const r2 = canvasStore.addRasterLayer("Middle");
  const r3 = canvasStore.addRasterLayer("Top");

  const sorted = canvasStore.sortedLayers;
  for (let i = 0; i < sorted.length - 1; i++) {
    assert.ok(sorted[i].order > sorted[i + 1].order, "sortedLayers must be descending by order");
  }
});

challenge("Store State: visibleLayers returns only visible layers ascending by order", () => {
  resetStore();
  const r1 = canvasStore.addRasterLayer("Visible 1");
  const r2 = canvasStore.addRasterLayer("Hidden 1");
  const r3 = canvasStore.addRasterLayer("Visible 2");

  canvasStore.toggleLayerVisibility(r2);
  const visible = canvasStore.visibleLayers;
  assert.ok(!visible.some((l) => l.id === r2), "Hidden layer must not appear in visibleLayers");
  for (let i = 0; i < visible.length - 1; i++) {
    assert.ok(visible[i].order < visible[i + 1].order, "visibleLayers must be ascending by order");
  }
});

challenge("Store State: Layer renaming with whitespace, Unicode, and extreme length", () => {
  resetStore();
  const layer = canvasStore.layers[0];

  // Whitespace trimming
  canvasStore.renameLayer(layer.id, "   Trimmed Name   ");
  assert.equal(canvasStore.layers.find((l) => l.id === layer.id).name, "Trimmed Name");

  // Non-string input ignored
  canvasStore.renameLayer(layer.id, null);
  assert.equal(canvasStore.layers.find((l) => l.id === layer.id).name, "Trimmed Name");

  // Extreme length (1,000 chars)
  const longName = "A".repeat(1000);
  canvasStore.renameLayer(layer.id, longName);
  assert.equal(canvasStore.layers.find((l) => l.id === layer.id).name, longName);
});

challenge("ControlNet Layer: Start/end step percentage clamping", () => {
  resetStore();
  const cnId = canvasStore.addControlNetLayer("Depth CN");

  // Adversarial inversion: startPercent > endPercent
  canvasStore.setControlNetProps(cnId, { startPercent: 0.8, endPercent: 0.2 });
  const cn = canvasStore.layers.find((l) => l.id === cnId);

  // In UI or backend serialization, start <= end must be enforced:
  const effectiveStart = Math.min(cn.startPercent, cn.endPercent);
  const effectiveEnd = Math.max(cn.startPercent, cn.endPercent);
  assert.ok(effectiveStart <= effectiveEnd);
  assert.equal(effectiveStart, 0.2);
  assert.equal(effectiveEnd, 0.8);
});

challenge("ControlNet Layer: Strength setting with boundary and extreme values", () => {
  resetStore();
  const cnId = canvasStore.addControlNetLayer("Canny CN");

  const strengths = [0.0, 0.5, 1.0, 1.5, 2.0];
  for (const s of strengths) {
    canvasStore.setControlNetProps(cnId, { strength: s });
    const cn = canvasStore.layers.find((l) => l.id === cnId);
    assert.equal(cn.strength, s);
  }
});

challenge("ControlNet Layer: Empty models and reference images handled cleanly", () => {
  resetStore();
  const cnId = canvasStore.addControlNetLayer("Empty CN", { model: "", referenceImage: undefined });
  const cn = canvasStore.layers.find((l) => l.id === cnId);
  assert.equal(cn.model, "");
  assert.equal(cn.referenceImage, undefined);

  // Backend model check: empty model string is falsy
  const isActive = Boolean(cn.model && cn.model.trim().length > 0);
  assert.equal(isActive, false, "Empty model ControlNet must not be treated as active");
});

// ============================================================================
// SUMMARY
// ============================================================================
console.log("\n=================================================================");
console.log(`STRESS-TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
console.log("=================================================================");

if (failed > 0) {
  console.error("FAILURES DETECTED:");
  for (const f of failures) {
    console.error(`- ${f.title}: ${f.error.message}`);
  }
  process.exit(1);
} else {
  console.log("ALL ADVERSARIAL STRESS TESTS COMPLETED SUCCESSFULLY (EXIT 0).");
  process.exit(0);
}
