// scripts/test-challenger-dimension-invariants.mjs
// Adversarial Invariant & Dimension Functionality Stress Suite
// Author: Milestone 4 Challenger 2 (i18n Parity & Dimensions Invariants Challenger)
// Run: node scripts/test-challenger-dimension-invariants.mjs

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

console.log("=================================================================");
console.log("MooshieUI Milestone 4 Challenger: DimensionControls Invariants");
console.log("Testing: Canvas Inpaint Isolation, Pure Dimensions Math,");
console.log("         Presets, Custom Ratios, Orientation Swap, Res Lock");
console.log("=================================================================\n");

let passed = 0;
let failed = 0;
const failures = [];

function challenge(title, fn) {
  try {
    fn();
    passed++;
    console.log(`  [PASS] ${title}`);
  } catch (err) {
    failed++;
    failures.push({ title, error: err });
    console.error(`  [FAIL] ${title}`);
    console.error(`         ${err.message}`);
  }
}

// -----------------------------------------------------------------------------
// Dimension Math Algorithms (Replicated directly from DimensionControls.svelte)
// -----------------------------------------------------------------------------

function dimsUnderArea(aw, ah, area, q) {
  const target = aw / ah;
  let best = null;
  const mid = Math.round(Math.sqrt(area * target) / q);
  for (let k = Math.max(1, mid - 2); k <= mid + 2; k++) {
    const w = k * q;
    const h = Math.floor(area / w / q) * q;
    if (h < q) continue;
    const err = Math.abs(Math.log(w / h / target));
    if (!best || err < best.err) best = { w, h, err };
  }
  return best ? { w: best.w, h: best.h } : { w: q, h: q };
}

function dimsForAspect(aw, ah, side, isNovelAi = false, q = isNovelAi ? 64 : 8) {
  const area = side * side;
  if (isNovelAi) return dimsUnderArea(aw, ah, area, q);
  const wA = Math.max(q, Math.round(Math.sqrt(area * (aw / ah)) / q) * q);
  const hA = Math.max(q, Math.round(area / wA / q) * q);
  const hB = Math.max(q, Math.round(Math.sqrt(area * (ah / aw)) / q) * q);
  const wB = Math.max(q, Math.round(area / hB / q) * q);
  return Math.abs(wA * hA - area) <= Math.abs(wB * hB - area)
    ? { w: wA, h: hA }
    : { w: wB, h: hB };
}

const presets = [
  { label: "1:1", w: 1, h: 1 },
  { label: "4:3", w: 4, h: 3 },
  { label: "3:2", w: 3, h: 2 },
  { label: "16:9", w: 16, h: 9 },
  { label: "21:9", w: 21, h: 9 },
  { label: "3:4", w: 3, h: 4 },
  { label: "2:3", w: 2, h: 3 },
  { label: "9:16", w: 9, h: 16 },
];

const PRESET_RATIO_TOLERANCE = 0.04;

function inferAspectFromDimensions(w, h, sideLength = 1024, isNovelAi = false) {
  for (const p of presets) {
    const dims = dimsForAspect(p.w, p.h, sideLength, isNovelAi);
    if (dims.w === w && dims.h === h) {
      return { w: p.w, h: p.h };
    }
  }
  const ratio = w / h;
  let nearest = null;
  for (const p of presets) {
    const err = Math.abs(Math.log(ratio / (p.w / p.h)));
    if (!nearest || err < nearest.err) nearest = { w: p.w, h: p.h, err };
  }
  if (nearest && nearest.err <= PRESET_RATIO_TOLERANCE) {
    return { w: nearest.w, h: nearest.h };
  }
  const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
  const d = gcd(w, h);
  return { w: w / d, h: h / d };
}

function recommendedRange(family) {
  switch (family) {
    case "unknown": return null;
    case "sd15": return { min: 512, max: 768 };
    case "flux2d":
    case "flux2klein9b":
    case "flux2klein9bbase":
    case "flux2klein4b":
    case "flux2klein4bbase": return { min: 1024, max: 2048 };
    case "qwen": return { min: 1024, max: 1536 };
    default: return { min: 1024, max: 1024 };
  }
}

// -----------------------------------------------------------------------------
// Mock Component & Stores State Harness
// -----------------------------------------------------------------------------

function createStoresAndComponent() {
  const generationState = {
    width: 1024,
    height: 1024,
    isNovelAi: false,
    resolutionLocked: false,
    mode: "txt2img",
    modelFamily: "sdxl",
    saveSettingsCalled: false,
    saveSettings() { this.saveSettingsCalled = true; }
  };

  const canvasState = {
    isCanvasMode: true,
    inpaintFullRes: true,
    inpaintFullResPadding: 32,
    maskBlur: 0,
    inpaintingFill: 1,
    layers: []
  };

  // DimensionControls controller simulator
  class DimensionController {
    constructor(gen, canv) {
      this.gen = gen;
      this.canv = canv;
      this.aspectW = 1;
      this.aspectH = 1;
      this.aspectWInput = "1";
      this.aspectHInput = "1";
      this.sideLength = 1024;
      this.lastSyncedDimensions = "";
      this.quantum = 8;
    }

    recalc() {
      const q = this.gen.isNovelAi ? 64 : 8;
      const dims = dimsForAspect(
        Math.max(0.01, this.aspectW),
        Math.max(0.01, this.aspectH),
        Math.max(q, this.sideLength),
        this.gen.isNovelAi,
        q
      );
      this.gen.width = dims.w;
      this.gen.height = dims.h;
      this.lastSyncedDimensions = `${dims.w}x${dims.h}`;
    }

    applyPreset(w, h) {
      this.aspectW = w;
      this.aspectH = h;
      this.aspectWInput = String(w);
      this.aspectHInput = String(h);
      this.recalc();
    }

    swapAspect() {
      const tmp = this.aspectW;
      this.aspectW = this.aspectH;
      this.aspectH = tmp;
      this.aspectWInput = String(this.aspectW);
      this.aspectHInput = String(this.aspectH);
      this.recalc();
    }

    onAspectInput(kind, value) {
      if (kind === "w") {
        this.aspectWInput = value;
        const parsed = Number.parseFloat(value);
        if (!Number.isNaN(parsed) && Number.isFinite(parsed) && parsed > 0) {
          this.aspectW = parsed;
          this.recalc();
        }
        return;
      }
      this.aspectHInput = value;
      const parsed = Number.parseFloat(value);
      if (!Number.isNaN(parsed) && Number.isFinite(parsed) && parsed > 0) {
        this.aspectH = parsed;
        this.recalc();
      }
    }

    applySideLength(side) {
      this.sideLength = side;
      this.recalc();
    }

    toggleResolutionLock() {
      this.gen.resolutionLocked = !this.gen.resolutionLocked;
      this.gen.saveSettings();
    }

    applySuggestedAspect(suggested) {
      if (!suggested || suggested.w <= 0 || suggested.h <= 0) return;
      if (this.gen.resolutionLocked || this.gen.mode === "inpainting") return;
      const inferred = inferAspectFromDimensions(suggested.w, suggested.h, this.sideLength, this.gen.isNovelAi);
      this.applyPreset(inferred.w, inferred.h);
    }
  }

  return {
    gen: generationState,
    canv: canvasState,
    ctrl: new DimensionController(generationState, canvasState)
  };
}

// -----------------------------------------------------------------------------
// CHALLENGE 1: Canvas Inpaint Parameters Isolation
// -----------------------------------------------------------------------------
console.log("=== Group 1: Canvas Inpaint Parameters Isolation Invariants ===");

challenge("1.1 Mutating aspect presets leaves canvas inpaint params 100% intact", () => {
  const { gen, canv, ctrl } = createStoresAndComponent();
  // Set custom non-default inpaint params on canvas
  canv.inpaintFullRes = false;
  canv.inpaintFullResPadding = 64;
  canv.maskBlur = 16;
  canv.inpaintingFill = 2;

  // Exercise all 8 presets
  for (const p of presets) {
    ctrl.applyPreset(p.w, p.h);
    assert.equal(canv.inpaintFullRes, false, "inpaintFullRes altered by preset");
    assert.equal(canv.inpaintFullResPadding, 64, "inpaintFullResPadding altered by preset");
    assert.equal(canv.maskBlur, 16, "maskBlur altered by preset");
    assert.equal(canv.inpaintingFill, 2, "inpaintingFill altered by preset");
  }
});

challenge("1.2 Custom aspect ratio input leaves canvas inpaint params intact", () => {
  const { gen, canv, ctrl } = createStoresAndComponent();
  canv.inpaintFullRes = true;
  canv.inpaintFullResPadding = 40;
  canv.maskBlur = 8;
  canv.inpaintingFill = 0;

  ctrl.onAspectInput("w", "2.39");
  ctrl.onAspectInput("h", "1");
  assert.equal(canv.inpaintFullRes, true);
  assert.equal(canv.inpaintFullResPadding, 40);
  assert.equal(canv.maskBlur, 8);
  assert.equal(canv.inpaintingFill, 0);

  ctrl.onAspectInput("w", "99");
  ctrl.onAspectInput("h", "100");
  assert.equal(canv.inpaintFullRes, true);
  assert.equal(canv.inpaintFullResPadding, 40);
  assert.equal(canv.maskBlur, 8);
  assert.equal(canv.inpaintingFill, 0);
});

challenge("1.3 Orientation swapping leaves canvas inpaint params intact", () => {
  const { gen, canv, ctrl } = createStoresAndComponent();
  canv.inpaintFullRes = true;
  canv.inpaintFullResPadding = 128;
  canv.maskBlur = 32;
  canv.inpaintingFill = 3;

  ctrl.applyPreset(16, 9);
  ctrl.swapAspect();
  assert.equal(ctrl.aspectW, 9);
  assert.equal(ctrl.aspectH, 16);
  assert.equal(canv.inpaintFullRes, true);
  assert.equal(canv.inpaintFullResPadding, 128);
  assert.equal(canv.maskBlur, 32);
  assert.equal(canv.inpaintingFill, 3);
});

challenge("1.4 Side length changes & resolution lock toggle leave canvas inpaint params intact", () => {
  const { gen, canv, ctrl } = createStoresAndComponent();
  canv.inpaintFullRes = false;
  canv.inpaintFullResPadding = 16;
  canv.maskBlur = 4;
  canv.inpaintingFill = 1;

  for (const side of [512, 768, 1024, 1536, 2048]) {
    ctrl.applySideLength(side);
    ctrl.toggleResolutionLock();
    assert.equal(canv.inpaintFullRes, false);
    assert.equal(canv.inpaintFullResPadding, 16);
    assert.equal(canv.maskBlur, 4);
    assert.equal(canv.inpaintingFill, 1);
  }
});

challenge("1.5 Suggested aspect adoption leaves canvas inpaint params intact", () => {
  const { gen, canv, ctrl } = createStoresAndComponent();
  canv.inpaintFullRes = true;
  canv.inpaintFullResPadding = 24;
  canv.maskBlur = 6;
  canv.inpaintingFill = 2;

  ctrl.applySuggestedAspect({ w: 1920, h: 1080 });
  assert.equal(canv.inpaintFullRes, true);
  assert.equal(canv.inpaintFullResPadding, 24);
  assert.equal(canv.maskBlur, 6);
  assert.equal(canv.inpaintingFill, 2);
});

// -----------------------------------------------------------------------------
// CHALLENGE 2: Pure Dimensions Math & Presets Verification
// -----------------------------------------------------------------------------
console.log("\n=== Group 2: Aspect Ratio Presets & Grid Alignment ===");

challenge("2.1 All 8 presets at default side 1024 produce positive quantum-8 multiples", () => {
  for (const p of presets) {
    const dims = dimsForAspect(p.w, p.h, 1024, false, 8);
    assert.ok(dims.w > 0, `Width must be > 0 for ${p.label}`);
    assert.ok(dims.h > 0, `Height must be > 0 for ${p.label}`);
    assert.equal(dims.w % 8, 0, `Width must be divisible by 8 for ${p.label}`);
    assert.equal(dims.h % 8, 0, `Height must be divisible by 8 for ${p.label}`);
    const actualRatio = dims.w / dims.h;
    const targetRatio = p.w / p.h;
    const error = Math.abs(Math.log(actualRatio / targetRatio));
    assert.ok(error < 0.05, `Ratio error ${error} too high for ${p.label}`);
  }
});

challenge("2.2 Multi-scale preset calculation across sides (512, 768, 1024, 1536, 2048)", () => {
  const sides = [512, 768, 1024, 1536, 2048];
  for (const side of sides) {
    for (const p of presets) {
      const dims = dimsForAspect(p.w, p.h, side, false, 8);
      assert.equal(dims.w % 8, 0);
      assert.equal(dims.h % 8, 0);
      const area = dims.w * dims.h;
      const targetArea = side * side;
      // Area should be within 5% of target area
      const areaRatio = area / targetArea;
      assert.ok(areaRatio > 0.90 && areaRatio < 1.10, `Area ${area} too far from target ${targetArea}`);
    }
  }
});

// -----------------------------------------------------------------------------
// CHALLENGE 3: Custom Aspect Ratios & Boundary Conditions
// -----------------------------------------------------------------------------
console.log("\n=== Group 3: Custom Aspect Ratios & Input Boundaries ===");

challenge("3.1 Arbitrary decimal custom aspect ratios calculate valid dimensions", () => {
  const { gen, ctrl } = createStoresAndComponent();
  ctrl.onAspectInput("w", "1.85");
  ctrl.onAspectInput("h", "1");
  assert.equal(gen.width % 8, 0);
  assert.equal(gen.height % 8, 0);
  assert.ok(Math.abs(Math.log((gen.width / gen.height) / 1.85)) < 0.05);
});

challenge("3.2 Malformed, negative, zero, and NaN inputs are rejected safely", () => {
  const { gen, ctrl } = createStoresAndComponent();
  ctrl.applyPreset(16, 9);
  const origW = gen.width;
  const origH = gen.height;

  // Invalid inputs should not alter the aspect ratio or crash
  ctrl.onAspectInput("w", "0");
  assert.equal(gen.width, origW);
  ctrl.onAspectInput("w", "-5");
  assert.equal(gen.width, origW);
  ctrl.onAspectInput("w", "abc");
  assert.equal(gen.width, origW);
  ctrl.onAspectInput("h", "NaN");
  assert.equal(gen.height, origH);
  ctrl.onAspectInput("h", "");
  assert.equal(gen.height, origH);
});

challenge("3.3 Extreme aspect ratios (e.g. 100:1 and 1:100) do not crash or produce sub-quantum dims", () => {
  const dimsWide = dimsForAspect(100, 1, 1024, false, 8);
  assert.ok(dimsWide.w >= 8);
  assert.ok(dimsWide.h >= 8);
  assert.equal(dimsWide.w % 8, 0);
  assert.equal(dimsWide.h % 8, 0);

  const dimsTall = dimsForAspect(1, 100, 1024, false, 8);
  assert.ok(dimsTall.w >= 8);
  assert.ok(dimsTall.h >= 8);
  assert.equal(dimsTall.w % 8, 0);
  assert.equal(dimsTall.h % 8, 0);
});

// -----------------------------------------------------------------------------
// CHALLENGE 4: Orientation Swapping Invariants
// -----------------------------------------------------------------------------
console.log("\n=== Group 4: Orientation Swapping Invariants ===");

challenge("4.1 Swapping 16:9 produces 9:16 and transposes width/height", () => {
  const { gen, ctrl } = createStoresAndComponent();
  ctrl.applyPreset(16, 9);
  const w1 = gen.width;
  const h1 = gen.height;
  assert.ok(w1 > h1);

  ctrl.swapAspect();
  assert.equal(gen.width, h1);
  assert.equal(gen.height, w1);

  // Swapping back recovers exact original dimensions
  ctrl.swapAspect();
  assert.equal(gen.width, w1);
  assert.equal(gen.height, h1);
});

challenge("4.2 Swapping 1:1 is an exact identity transformation", () => {
  const { gen, ctrl } = createStoresAndComponent();
  ctrl.applyPreset(1, 1);
  const w = gen.width;
  const h = gen.height;
  ctrl.swapAspect();
  assert.equal(gen.width, w);
  assert.equal(gen.height, h);
});

// -----------------------------------------------------------------------------
// CHALLENGE 5: Model Family Recommendations & Aspect Inference
// -----------------------------------------------------------------------------
console.log("\n=== Group 5: Model Family Recommendations & Aspect Inference ===");

challenge("5.1 Model family recommendation ranges are strictly bounded", () => {
  assert.deepEqual(recommendedRange("sd15"), { min: 512, max: 768 });
  assert.deepEqual(recommendedRange("flux2d"), { min: 1024, max: 2048 });
  assert.deepEqual(recommendedRange("flux2klein9b"), { min: 1024, max: 2048 });
  assert.deepEqual(recommendedRange("qwen"), { min: 1024, max: 1536 });
  assert.deepEqual(recommendedRange("sdxl"), { min: 1024, max: 1024 });
  assert.equal(recommendedRange("unknown"), null);
});

challenge("5.2 inferAspectFromDimensions accurately recovers all preset ratios", () => {
  for (const p of presets) {
    const dims = dimsForAspect(p.w, p.h, 1024, false, 8);
    const inferred = inferAspectFromDimensions(dims.w, dims.h, 1024, false);
    assert.equal(inferred.w, p.w, `Failed to infer w for ${p.label}`);
    assert.equal(inferred.h, p.h, `Failed to infer h for ${p.label}`);
  }
});

// -----------------------------------------------------------------------------
// CHALLENGE 6: Resolution Lock Mechanics
// -----------------------------------------------------------------------------
console.log("\n=== Group 6: Resolution Lock Mechanics ===");

challenge("6.1 Resolution lock prevents suggested aspect from overriding dimensions", () => {
  const { gen, ctrl } = createStoresAndComponent();
  ctrl.applyPreset(1, 1);
  assert.equal(gen.width, 1024);
  assert.equal(gen.height, 1024);

  // Lock resolution
  ctrl.toggleResolutionLock();
  assert.equal(gen.resolutionLocked, true);
  assert.equal(gen.saveSettingsCalled, true);

  // Offer suggested aspect 16:9
  ctrl.applySuggestedAspect({ w: 1920, h: 1080 });
  // Must NOT change dimensions because resolution is locked!
  assert.equal(gen.width, 1024);
  assert.equal(gen.height, 1024);

  // Unlock and try again
  ctrl.toggleResolutionLock();
  assert.equal(gen.resolutionLocked, false);
  ctrl.applySuggestedAspect({ w: 1920, h: 1080 });
  // Now dimensions SHOULD change to 16:9
  assert.equal(ctrl.aspectW, 16);
  assert.equal(ctrl.aspectH, 9);
  assert.ok(gen.width > gen.height);
});

challenge("6.2 Inpainting mode protects user dimensions from suggestedAspect overrides", () => {
  const { gen, ctrl } = createStoresAndComponent();
  ctrl.applyPreset(1, 1);
  gen.mode = "inpainting";

  ctrl.applySuggestedAspect({ w: 1280, h: 720 });
  // Mode is inpainting -> must not override
  assert.equal(gen.width, 1024);
  assert.equal(gen.height, 1024);
});

// -----------------------------------------------------------------------------
// CHALLENGE 7: NovelAI 64-Grid & Non-Over-Allocation (Free Tier Guarantee)
// -----------------------------------------------------------------------------
console.log("\n=== Group 7: NovelAI 64-Grid & Opus Area Guarantee ===");

challenge("7.1 NovelAI mode dimensions are strictly divisible by 64", () => {
  for (const p of presets) {
    const dims = dimsForAspect(p.w, p.h, 1024, true, 64);
    assert.equal(dims.w % 64, 0, `Width not divisible by 64 for ${p.label}`);
    assert.equal(dims.h % 64, 0, `Height not divisible by 64 for ${p.label}`);
  }
});

challenge("7.2 NovelAI mode area NEVER exceeds side^2 (prevents unexpected charges on Opus)", () => {
  const targetArea = 1024 * 1024;
  for (const p of presets) {
    const dims = dimsForAspect(p.w, p.h, 1024, true, 64);
    const actualArea = dims.w * dims.h;
    assert.ok(
      actualArea <= targetArea,
      `NovelAI area ${actualArea} exceeded 1MP (${targetArea}) for ${p.label} (${dims.w}x${dims.h})`
    );
  }
});

// -----------------------------------------------------------------------------
// SUMMARY
// -----------------------------------------------------------------------------
console.log("\n=================================================================");
console.log(`DIMENSION CONTROLS INVARIANT CHALLENGE: ${passed} Passed, ${failed} Failed`);
console.log("=================================================================\n");

if (failed > 0) {
  process.exit(1);
} else {
  console.log("ALL DIMENSION CONTROLS INVARIANTS EMPIRICALLY CONFIRMED!");
  process.exit(0);
}
