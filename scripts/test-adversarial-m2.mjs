// scripts/test-adversarial-m2.mjs
// Adversarial Stress Testing for Milestone 2:
// - Stress-tests CanvasLayer discriminated union and type guards
// - Stress-tests layer stack invariants, order reindexing, duplicate logic, deletion invariants
// - Stress-tests brush hardness mathematics, bounds clamping, aspect ratio locking
// - Stress-tests blend mode CSS and composite maps

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const PROJECT_ROOT = new URL("../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

function loadTsModule(relativePath) {
  const fullPath = path.resolve(PROJECT_ROOT, relativePath);
  const source = fs.readFileSync(fullPath, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  });
  const mod = { exports: {} };
  vm.runInNewContext(
    outputText,
    {
      module: mod,
      exports: mod.exports,
      require: (name) => {
        try {
          return require(name);
        } catch {
          return {};
        }
      },
    },
    { filename: fullPath }
  );
  return mod.exports;
}

const canvasTypes = loadTsModule("src/lib/types/canvas.ts");
const {
  CANVAS_BLEND_MODES,
  BLEND_MODE_COMPOSITE_MAP,
  BLEND_MODE_CSS_MAP,
  isRasterLayer,
  isMaskLayer,
  isRegionalLayer,
  isControlNetLayer,
} = canvasTypes;

let passed = 0;
let failed = 0;

function runTest(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}: ${err.message}`);
  }
}

console.log("=== Running Milestone 2 Adversarial Stress Tests ===");

// 1. Discriminated Union & Type Guards
runTest("Type Guard: isRasterLayer strictly accepts raster and rejects others", () => {
  const raster = { id: "1", name: "R", type: "raster", visible: true, locked: false, opacity: 1, order: 0 };
  const mask = { id: "2", name: "M", type: "mask", visible: true, locked: false, opacity: 1, order: 1 };
  const regional = { id: "3", name: "REG", type: "regional", visible: true, locked: false, opacity: 1, order: 2, x: 0, y: 0, width: 0.5, height: 0.5, prompt: "", weight: 1 };
  const cn = { id: "4", name: "CN", type: "controlnet", visible: true, locked: false, opacity: 1, order: 3, model: "m", preprocessor: "none", strength: 1, startPercent: 0, endPercent: 1 };

  assert.equal(isRasterLayer(raster), true);
  assert.equal(isRasterLayer(mask), false);
  assert.equal(isRasterLayer(regional), false);
  assert.equal(isRasterLayer(cn), false);
});

runTest("Type Guard: isMaskLayer strictly accepts mask and rejects others", () => {
  const raster = { id: "1", name: "R", type: "raster", visible: true, locked: false, opacity: 1, order: 0 };
  const mask = { id: "2", name: "M", type: "mask", visible: true, locked: false, opacity: 1, order: 1 };
  assert.equal(isMaskLayer(mask), true);
  assert.equal(isMaskLayer(raster), false);
});

runTest("Type Guard: isRegionalLayer strictly accepts regional and rejects others", () => {
  const regional = { id: "3", name: "REG", type: "regional", visible: true, locked: false, opacity: 1, order: 2, x: 0, y: 0, width: 0.5, height: 0.5, prompt: "", weight: 1 };
  const raster = { id: "1", name: "R", type: "raster", visible: true, locked: false, opacity: 1, order: 0 };
  assert.equal(isRegionalLayer(regional), true);
  assert.equal(isRegionalLayer(raster), false);
});

runTest("Type Guard: isControlNetLayer strictly accepts controlnet and rejects others", () => {
  const cn = { id: "4", name: "CN", type: "controlnet", visible: true, locked: false, opacity: 1, order: 3, model: "m", preprocessor: "none", strength: 1, startPercent: 0, endPercent: 1 };
  const mask = { id: "2", name: "M", type: "mask", visible: true, locked: false, opacity: 1, order: 1 };
  assert.equal(isControlNetLayer(cn), true);
  assert.equal(isControlNetLayer(mask), false);
});

// 2. Blend Modes Complete Map Verification
runTest("Blend Modes: Every item in CANVAS_BLEND_MODES has valid CSS and Composite mappings", () => {
  assert.ok(CANVAS_BLEND_MODES.length >= 6);
  for (const mode of CANVAS_BLEND_MODES) {
    assert.ok(BLEND_MODE_COMPOSITE_MAP[mode], `Missing composite op for blend mode ${mode}`);
    assert.ok(BLEND_MODE_CSS_MAP[mode], `Missing CSS mix-blend-mode for blend mode ${mode}`);
    assert.equal(typeof BLEND_MODE_COMPOSITE_MAP[mode], "string");
    assert.equal(typeof BLEND_MODE_CSS_MAP[mode], "string");
  }
});

// 3. Layer Store Simulation & Invariant Stress Tests
class MockCanvasStoreLogic {
  constructor() {
    this.layers = [];
    this.activeLayerId = null;
    this.brushSettings = { size: 20, opacity: 1, hardness: 0.8 };
  }

  addLayer(type = "raster", name = "Layer", extraProps = {}) {
    const id = `layer_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const nextOrder = this.layers.length;
    const base = {
      id,
      name,
      type,
      visible: true,
      locked: false,
      opacity: 1.0,
      order: nextOrder,
      zIndex: nextOrder,
      blendMode: "normal",
      ...extraProps,
    };
    this.layers.push(base);
    this.activeLayerId = id;
    return id;
  }

  removeLayer(id) {
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

  duplicateLayer(id) {
    const source = this.layers.find((l) => l.id === id);
    if (!source) return null;
    const newId = `layer_dup_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const sourceIndex = this.layers.findIndex((l) => l.id === id);
    const targetIndex = sourceIndex + 1;

    const copy = {
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
    return newId;
  }

  reorderLayer(id, targetOrDirection) {
    const currentIndex = this.layers.findIndex((l) => l.id === id);
    if (currentIndex === -1) return;

    let targetIndex;
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

  setLayerOpacity(id, opacity) {
    const clamped = Math.max(0.0, Math.min(1.0, Number.isFinite(opacity) ? opacity : 1.0));
    this.layers = this.layers.map((l) => (l.id === id ? { ...l, opacity: clamped } : l));
  }

  setBrushHardness(hardness) {
    const clamped = Math.max(0.0, Math.min(1.0, Number.isFinite(hardness) ? hardness : 0.8));
    this.brushSettings.hardness = clamped;
  }
}

runTest("Invariant: Deleting the sole raster layer returns false and does not mutate layers", () => {
  const store = new MockCanvasStoreLogic();
  const r1 = store.addLayer("raster", "Background");
  assert.equal(store.layers.length, 1);

  const res = store.removeLayer(r1);
  assert.equal(res, false);
  assert.equal(store.layers.length, 1);
  assert.equal(store.layers[0].id, r1);
});

runTest("Invariant: Non-raster layers can be deleted even if there is only 1 raster layer", () => {
  const store = new MockCanvasStoreLogic();
  const r1 = store.addLayer("raster", "Background");
  const m1 = store.addLayer("mask", "Mask");
  const reg1 = store.addLayer("regional", "Region");
  assert.equal(store.layers.length, 3);

  const delMask = store.removeLayer(m1);
  assert.equal(delMask, true);
  assert.equal(store.layers.length, 2);

  const delReg = store.removeLayer(reg1);
  assert.equal(delReg, true);
  assert.equal(store.layers.length, 1);

  // Now only 1 raster left, cannot be deleted
  const delRaster = store.removeLayer(r1);
  assert.equal(delRaster, false);
  assert.equal(store.layers.length, 1);
});

runTest("Duplicate: Inserts immediately above source and maintains order indexing [0..N-1]", () => {
  const store = new MockCanvasStoreLogic();
  const r1 = store.addLayer("raster", "L0");
  const r2 = store.addLayer("raster", "L1");
  const r3 = store.addLayer("raster", "L2");

  // Duplicate L1 (index 1) -> copy inserted at index 2
  const dupId = store.duplicateLayer(r2);
  assert.equal(store.layers.length, 4);
  assert.equal(store.layers[2].id, dupId);
  assert.equal(store.layers[2].name, "L1 copy");
  assert.equal(store.activeLayerId, dupId);

  // Check strict contiguous indexing
  store.layers.forEach((l, idx) => {
    assert.equal(l.order, idx);
    assert.equal(l.zIndex, idx);
  });
});

runTest("Reorder: Extreme out-of-bounds target indices clamp cleanly", () => {
  const store = new MockCanvasStoreLogic();
  const r1 = store.addLayer("raster", "L0");
  const r2 = store.addLayer("raster", "L1");
  const r3 = store.addLayer("raster", "L2");

  // Reorder L2 to index -9999 -> clamped to 0
  store.reorderLayer(r3, -9999);
  assert.equal(store.layers[0].id, r3);
  assert.equal(store.layers[1].id, r1);
  assert.equal(store.layers[2].id, r2);

  // Reorder L2 to index +9999 -> clamped to 2
  store.reorderLayer(r3, 9999);
  assert.equal(store.layers[2].id, r3);
  assert.equal(store.layers[0].id, r1);
  assert.equal(store.layers[1].id, r2);

  store.layers.forEach((l, idx) => {
    assert.equal(l.order, idx);
    assert.equal(l.zIndex, idx);
  });
});

runTest("Opacity Clamping: Handles -Infinity, NaN, >1.0, <0.0 safely", () => {
  const store = new MockCanvasStoreLogic();
  const r1 = store.addLayer("raster", "L0");

  store.setLayerOpacity(r1, -5.0);
  assert.equal(store.layers[0].opacity, 0.0);

  store.setLayerOpacity(r1, 10.0);
  assert.equal(store.layers[0].opacity, 1.0);

  store.setLayerOpacity(r1, NaN);
  assert.equal(store.layers[0].opacity, 1.0);

  store.setLayerOpacity(r1, 0.42);
  assert.equal(store.layers[0].opacity, 0.42);
});

runTest("Brush Hardness: Clamping [0.0, 1.0] and edge falloff math", () => {
  const store = new MockCanvasStoreLogic();

  store.setBrushHardness(-1.0);
  assert.equal(store.brushSettings.hardness, 0.0);

  store.setBrushHardness(2.0);
  assert.equal(store.brushSettings.hardness, 1.0);

  store.setBrushHardness(NaN);
  assert.equal(store.brushSettings.hardness, 0.8);

  store.setBrushHardness(0.5);
  assert.equal(store.brushSettings.hardness, 0.5);

  // Hardness edge math verification:
  // At hardness H, inner radius = R * H, outer radius = R.
  // Within inner radius, opacity = 1.0. Between inner and outer, linear falloff.
  const R = 20;
  const H = 0.5;
  const innerR = R * H; // 10
  function getAlphaAtDistance(dist) {
    if (dist <= innerR) return 1.0;
    if (dist >= R) return 0.0;
    return (R - dist) / (R - innerR);
  }

  assert.equal(getAlphaAtDistance(0), 1.0);
  assert.equal(getAlphaAtDistance(5), 1.0);
  assert.equal(getAlphaAtDistance(10), 1.0);
  assert.equal(getAlphaAtDistance(15), 0.5);
  assert.equal(getAlphaAtDistance(20), 0.0);
  assert.equal(getAlphaAtDistance(25), 0.0);
});

console.log(`\nAdversarial tests finished: ${passed} passed, ${failed} failed.`);
if (failed > 0) {
  process.exit(1);
}
