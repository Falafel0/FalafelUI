// scripts/test-adversarial-canvas-store.mjs
// Adversarial Stress-Test Suite directly exercising the REAL compiled src/lib/stores/canvas.svelte.ts
// and src/lib/types/canvas.ts implementations.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";
import * as svelte from "svelte/compiler";

const require = createRequire(import.meta.url);

const PROJECT_ROOT = new URL("../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

console.log("=================================================================");
console.log("ADVERSARIAL STRESS-TEST SUITE: REAL CANVAS STORE & TYPES");
console.log("=================================================================");

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failures = [];

async function test(name, fn) {
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
    console.error(err.stack);
  }
}

// 1. Transpile and load types/canvas.ts
const typesTs = fs.readFileSync(path.resolve(PROJECT_ROOT, "src/lib/types/canvas.ts"), "utf8");
const typesTranspiled = ts.transpileModule(typesTs, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
});

const typesExports = {};
const typesModule = { exports: typesExports };
vm.runInNewContext(
  typesTranspiled.outputText,
  {
    module: typesModule,
    exports: typesExports,
  },
  { filename: path.resolve(PROJECT_ROOT, "src/lib/types/canvas.ts") }
);

const {
  CANVAS_BLEND_MODES,
  BLEND_MODE_COMPOSITE_MAP,
  BLEND_MODE_CSS_MAP,
  isRasterLayer,
  isMaskLayer,
  isRegionalLayer,
  isControlNetLayer,
} = typesExports;

// 2. Transpile and compile canvas.svelte.ts into working JS
const storeTs = fs.readFileSync(path.resolve(PROJECT_ROOT, "src/lib/stores/canvas.svelte.ts"), "utf8");
const storeTranspiled = ts.transpileModule(storeTs, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
});

const storeCompiled = svelte.compileModule(storeTranspiled.outputText, {
  filename: "src/lib/stores/canvas.svelte.ts",
});

// Transpile compiled ES module to CommonJS for VM execution
const storeCjs = ts.transpileModule(storeCompiled.js.code, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
});

// Mock environment for Svelte runes runtime & browser APIs
const mockGeneration = {
  mode: "txt2img",
  positivePrompt: "cyberpunk cat",
  negativePrompt: "low quality",
  inputImage: null,
  maskImage: null,
  width: 1024,
  height: 1024,
  denoise: 1.0,
  postScaleWidth: null,
  postScaleHeight: null,
};

const mockLocale = {
  t(key, params) {
    if (key === "canvas.layer.background") return "Background";
    if (key === "canvas.layer.inpaint_mask") return "Inpaint Mask";
    if (key === "canvas.layer.raster") return `Layer ${params?.n ?? 1}`;
    if (key === "canvas.layer.type_regional") return `Region ${params?.n ?? 1}`;
    if (key === "canvas.layer.type_controlnet") return `ControlNet ${params?.n ?? 1}`;
    return key;
  },
};

// Svelte 5 runtime mock for $state and $derived in Node VM
const svelteInternal = {
  state(initial) {
    let val = initial;
    return val;
  },
  derived(fn) {
    return { get: fn };
  },
};

const storeExports = {};
const storeModule = { exports: storeExports };

const mockGlobals = {
  module: storeModule,
  exports: storeExports,
  require(name) {
    if (name.includes("types/canvas")) return typesExports;
    if (name.includes("generation.svelte")) return { generation: mockGeneration };
    if (name.includes("locale.svelte")) return { locale: mockLocale };
    if (name.includes("api")) return { uploadImageBytes: async () => ({ name: "mock.png" }) };
    if (name.includes("canvasProject")) {
      return {
        saveFalafelProject: async () => {},
        loadFalafelProjectFile: async () => ({}),
        downloadCanvasImage: () => {},
      };
    }
    if (name.includes("maskCrop")) {
      return {
        getCropRegionV2: () => ({ x1: 0, y1: 0, x2: 100, y2: 100 }),
        expandCropRegion: (r) => r,
        cropCanvas: (c) => c,
      };
    }
    if (name.includes("maskBlur")) return { gaussianBlurCanvas: () => {} };
    if (name.includes("maskFill")) return { fillMaskedRegion: () => {} };
    if (name.startsWith("svelte")) {
      return require(name);
    }
    try {
      return require(name);
    } catch {
      return {};
    }
  },
  URL: {
    createObjectURL: () => "blob:mock",
    revokeObjectURL: () => {},
  },
  document: {
    createElement: () => ({
      width: 100,
      height: 100,
      getContext: () => ({
        fillRect: () => {},
        drawImage: () => {},
        getImageData: () => ({ data: new Uint8ClampedArray(400) }),
        putImageData: () => {},
      }),
      toDataURL: () => "data:image/png;base64,mock",
    }),
  },
  console,
};

vm.runInNewContext(storeCjs.outputText, mockGlobals, {
  filename: path.resolve(PROJECT_ROOT, "src/lib/stores/canvas.svelte.ts"),
});

const { canvas } = storeExports;

// ============================================================================
// ADVERSARIAL TEST SUITE EXECUTION
// ============================================================================

async function run() {
  await test("Real Types: BLEND_MODE_COMPOSITE_MAP and BLEND_MODE_CSS_MAP have all 6 blend modes", () => {
    assert.equal(CANVAS_BLEND_MODES.length, 6);
    for (const mode of ["normal", "multiply", "screen", "overlay", "darken", "lighten"]) {
      assert.ok(CANVAS_BLEND_MODES.includes(mode), `Missing blend mode ${mode}`);
      assert.ok(BLEND_MODE_COMPOSITE_MAP[mode], `Missing composite op for ${mode}`);
      assert.ok(BLEND_MODE_CSS_MAP[mode], `Missing CSS mix-blend-mode for ${mode}`);
    }
  });

  await test("Real Types: Type guards properly discriminate layer types", () => {
    const raster = { id: "1", type: "raster", name: "R", visible: true, locked: false, opacity: 1, order: 0 };
    const mask = { id: "2", type: "mask", name: "M", visible: true, locked: false, opacity: 1, order: 1 };
    const regional = { id: "3", type: "regional", name: "REG", visible: true, locked: false, opacity: 1, order: 2, x: 0, y: 0, width: 0.5, height: 0.5, prompt: "p", weight: 1 };
    const controlnet = { id: "4", type: "controlnet", name: "CN", visible: true, locked: false, opacity: 1, order: 3, model: "m", preprocessor: "none", strength: 1, startPercent: 0, endPercent: 1 };

    assert.equal(isRasterLayer(raster), true);
    assert.equal(isRasterLayer(mask), false);
    assert.equal(isMaskLayer(mask), true);
    assert.equal(isMaskLayer(regional), false);
    assert.equal(isRegionalLayer(regional), true);
    assert.equal(isRegionalLayer(controlnet), false);
    assert.equal(isControlNetLayer(controlnet), true);
    assert.equal(isControlNetLayer(raster), false);
  });

  await test("Real Store: Brush hardness default is 0.8 and clamps [0.0, 1.0]", () => {
    assert.equal(canvas.brushSettings.hardness, 0.8);

    canvas.setBrushHardness(0.5);
    assert.equal(canvas.brushSettings.hardness, 0.5);

    canvas.setBrushHardness(-10);
    assert.equal(canvas.brushSettings.hardness, 0.0);

    canvas.setBrushHardness(99.9);
    assert.equal(canvas.brushSettings.hardness, 1.0);

    // Non-finite fallback
    canvas.setBrushHardness(NaN);
    assert.equal(canvas.brushSettings.hardness, 0.8);

    canvas.setBrushHardness(Infinity);
    assert.equal(canvas.brushSettings.hardness, 0.8);

    // Delta adjust
    canvas.setBrushHardness(0.5);
    canvas.adjustBrushHardness(0.2);
    assert.equal(Math.round(canvas.brushSettings.hardness * 100) / 100, 0.7);

    canvas.adjustBrushHardness(2.0);
    assert.equal(canvas.brushSettings.hardness, 1.0);

    canvas.adjustBrushHardness(-5.0);
    assert.equal(canvas.brushSettings.hardness, 0.0);
  });

  await test("Real Store: initCanvas initializes raster background + mask layer", () => {
    canvas.initCanvas(800, 600);
    assert.equal(canvas.canvasWidth, 800);
    assert.equal(canvas.canvasHeight, 600);
    assert.equal(canvas.layers.length, 2);
    assert.equal(canvas.layers[0].type, "raster");
    assert.equal(canvas.layers[1].type, "mask");
    assert.equal(canvas.layers[0].order, 0);
    assert.equal(canvas.layers[1].order, 1);
    assert.equal(canvas.activeLayerId, canvas.layers[0].id);
  });

  await test("Real Store: Layer constructors add valid layer defaults", () => {
    canvas.initCanvas(1024, 1024);

    const rId = canvas.addRasterLayer("Custom Raster", { denoise: 0.85 });
    const rLayer = canvas.layers.find((l) => l.id === rId);
    assert.ok(rLayer);
    assert.equal(rLayer.type, "raster");
    assert.equal(rLayer.name, "Custom Raster");
    assert.equal(rLayer.denoise, 0.85);
    assert.equal(rLayer.opacity, 1.0);

    const mId = canvas.addMaskLayer("Extra Mask", rId, { maskBlur: 4 });
    const mLayer = canvas.layers.find((l) => l.id === mId);
    assert.ok(mLayer);
    assert.equal(mLayer.type, "mask");
    assert.equal(mLayer.linkedLayerId, rId);
    assert.equal(mLayer.maskBlur, 4);
    assert.equal(mLayer.denoise, 0.7);

    const regId = canvas.addRegionalLayer("Forest Region", { prompt: "dense trees", weight: 1.2 });
    const regLayer = canvas.layers.find((l) => l.id === regId);
    assert.ok(regLayer);
    assert.equal(regLayer.type, "regional");
    assert.equal(regLayer.prompt, "dense trees");
    assert.equal(regLayer.weight, 1.2);
    assert.equal(regLayer.width, 0.5);
    assert.equal(regLayer.height, 0.5);

    const cnId = canvas.addControlNetLayer("Pose CN", { model: "openpose.pth", preprocessor: "openpose" });
    const cnLayer = canvas.layers.find((l) => l.id === cnId);
    assert.ok(cnLayer);
    assert.equal(cnLayer.type, "controlnet");
    assert.equal(cnLayer.model, "openpose.pth");
    assert.equal(cnLayer.preprocessor, "openpose");
    assert.equal(cnLayer.strength, 1.0);
    assert.equal(cnLayer.startPercent, 0.0);
    assert.equal(cnLayer.endPercent, 1.0);
  });

  await test("Real Store Invariant: Last remaining raster layer CANNOT be deleted", () => {
    canvas.initCanvas(1024, 1024);
    // There is 1 raster and 1 mask
    const raster = canvas.layers.find((l) => l.type === "raster");
    const mask = canvas.layers.find((l) => l.type === "mask");

    // Deleting the mask layer should succeed
    const maskDeleted = canvas.removeLayer(mask.id);
    assert.equal(maskDeleted, true);
    assert.equal(canvas.layers.length, 1);
    assert.equal(canvas.layers[0].id, raster.id);

    // Deleting the last remaining raster layer MUST fail
    const rasterDeleted = canvas.removeLayer(raster.id);
    assert.equal(rasterDeleted, false, "Store allowed deleting the last raster layer!");
    assert.equal(canvas.layers.length, 1);
    assert.equal(canvas.layers[0].id, raster.id);

    // If we add another raster layer, now raster deletion is allowed
    const r2Id = canvas.addRasterLayer("Layer 2");
    assert.equal(canvas.layers.length, 2);
    const r1Deleted = canvas.removeLayer(raster.id);
    assert.equal(r1Deleted, true);
    assert.equal(canvas.layers.length, 1);
    assert.equal(canvas.layers[0].id, r2Id);

    // Now r2 is the last raster layer -> deletion blocked again
    const r2Deleted = canvas.removeLayer(r2Id);
    assert.equal(r2Deleted, false);
    assert.equal(canvas.layers.length, 1);
  });

  await test("Real Store Invariant: Delete non-existent ID returns false", () => {
    const res = canvas.deleteLayer("non_existent_random_id_9999");
    assert.equal(res, false);
  });

  await test("Real Store Invariant: Opacity clamped [0.0, 1.0]", () => {
    canvas.initCanvas(1024, 1024);
    const id = canvas.layers[0].id;

    canvas.setLayerOpacity(id, 0.35);
    assert.equal(canvas.layers.find((l) => l.id === id).opacity, 0.35);

    canvas.setLayerOpacity(id, -1.5);
    assert.equal(canvas.layers.find((l) => l.id === id).opacity, 0.0);

    canvas.setLayerOpacity(id, 5.0);
    assert.equal(canvas.layers.find((l) => l.id === id).opacity, 1.0);

    canvas.setLayerOpacity(id, NaN);
    assert.equal(canvas.layers.find((l) => l.id === id).opacity, 1.0);
  });

  await test("Real Store Invariant: Rename trims whitespace", () => {
    canvas.initCanvas(1024, 1024);
    const id = canvas.layers[0].id;

    canvas.renameLayer(id, "   Trimmed Layer Name   ");
    assert.equal(canvas.layers.find((l) => l.id === id).name, "Trimmed Layer Name");

    // Rename with non-string is ignored
    canvas.renameLayer(id, null);
    assert.equal(canvas.layers.find((l) => l.id === id).name, "Trimmed Layer Name");
  });

  await test("Real Store Invariant: Reorder clamps out-of-bounds indices", () => {
    canvas.initCanvas(1024, 1024);
    const l1 = canvas.layers[0].id;
    const l2 = canvas.layers[1].id;
    const l3 = canvas.addRasterLayer("Layer 3");
    // Layers: [l1 (0), l2 (1), l3 (2)]

    // Reorder l1 to negative index (-50) -> clamps to 0 (no move)
    canvas.reorderLayer(l1, -50);
    assert.equal(canvas.layers[0].id, l1);

    // Reorder l1 to extreme high index (1000) -> clamps to 2 (top)
    canvas.reorderLayer(l1, 1000);
    assert.equal(canvas.layers[2].id, l1);
    assert.equal(canvas.layers[2].order, 2);
    assert.equal(canvas.layers[0].order, 0);

    // Reorder "down" on bottom-most layer -> clamped, no-op
    const bottomId = canvas.layers[0].id;
    canvas.reorderLayer(bottomId, "down");
    assert.equal(canvas.layers[0].id, bottomId);

    // Reorder "up" on top-most layer -> clamped, no-op
    const topId = canvas.layers[canvas.layers.length - 1].id;
    canvas.reorderLayer(topId, "up");
    assert.equal(canvas.layers[canvas.layers.length - 1].id, topId);
  });

  await test("Real Store Invariant: duplicateLayer deep copies and inserts above source", async () => {
    canvas.initCanvas(1024, 1024);
    const baseId = canvas.layers[0].id;
    canvas.setLayerBlendMode(baseId, "multiply");
    canvas.setLayerOpacity(baseId, 0.65);

    const copyId = await canvas.duplicateLayer(baseId);
    assert.ok(copyId);
    assert.notEqual(copyId, baseId);

    const copy = canvas.layers.find((l) => l.id === copyId);
    assert.ok(copy);
    assert.equal(copy.name, `${canvas.layers[0].name} copy`);
    assert.equal(copy.blendMode, "multiply");
    assert.equal(copy.opacity, 0.65);
    assert.equal(canvas.activeLayerId, copyId);
    assert.equal(canvas.layers[1].id, copyId); // placed directly above index 0
  });

  await test("Real Store Invariant: Type-specific property mutators only touch matching types", () => {
    canvas.initCanvas(1024, 1024);
    const rasterId = canvas.layers[0].id;
    const regId = canvas.addRegionalLayer("Region");

    // Setting regional props on raster layer is ignored
    canvas.setRegionalProps(rasterId, { prompt: "should not apply" });
    assert.equal("prompt" in canvas.layers.find((l) => l.id === rasterId), false);

    // Setting regional props on regional layer applies
    canvas.setRegionalProps(regId, { prompt: "applied prompt", weight: 1.5 });
    const reg = canvas.layers.find((l) => l.id === regId);
    assert.equal(reg.prompt, "applied prompt");
    assert.equal(reg.weight, 1.5);
  });

  await test("Real Store: snapBoundingBoxToLayer calculates normalized bounds", () => {
    canvas.initCanvas(1000, 1000);
    const regId = canvas.addRegionalLayer("Sub-Region", { x: 0.2, y: 0.3, width: 0.4, height: 0.5 });
    canvas.snapBoundingBoxToLayer(regId);

    assert.equal(canvas.boundingBox.x, 200);
    assert.equal(canvas.boundingBox.y, 300);
    assert.equal(canvas.boundingBox.width, 400);
    assert.equal(canvas.boundingBox.height, 500);

    canvas.resetBoundingBoxToCanvas();
    assert.equal(canvas.boundingBox.x, 0);
    assert.equal(canvas.boundingBox.y, 0);
    assert.equal(canvas.boundingBox.width, 1000);
    assert.equal(canvas.boundingBox.height, 1000);
  });

  console.log("=================================================================");
  console.log(`TOTAL REAL STORE TESTS: ${totalTests} | PASSED: ${passedTests} | FAILED: ${failedTests}`);
  console.log("=================================================================");

  if (failedTests > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("Adversarial runner failed:", err);
  process.exit(1);
});
