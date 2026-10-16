// scripts/test-adversarial-backend.mjs
// Adversarial Challenger Test Harness for MooshieUI M1 Backend & Crop Pipeline
// Run: node scripts/test-adversarial-backend.mjs

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
  const module = { exports: {} };
  vm.runInNewContext(
    outputText,
    {
      module,
      exports: module.exports,
      require() { return {}; },
    },
    { filename: fullPath }
  );
  return module.exports;
}

const { expandCropRegion } = loadTsModule("src/lib/utils/maskCrop.ts");
const { familyIsSdxlLike } = loadTsModule("src/lib/utils/modelFamily.ts");

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failedTests++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
  }
}

console.log("\n=======================================================");
console.log("CHALLENGER HARNESS: ADVERSARIAL STRESS-TEST SUITE");
console.log("=======================================================\n");

// 1. Mask crop shift-back aspect ratio invariance under extreme aspect ratios & bounds
console.log("--- Suite 1: Mask Crop Shift-Back Aspect Ratio & Bounds Invariance ---");

runTest("Crop expansion at right edge: shifts left without exceeding imageWidth", () => {
  const imageW = 1024;
  const imageH = 1024;
  // Crop at right edge: 900..1024 (width 124, height 100)
  const crop = { x1: 900, y1: 400, x2: 1024, y2: 500 };
  const expanded = expandCropRegion(crop, 512, 512, imageW, imageH);

  assert.ok(expanded.x1 >= 0, `x1 (${expanded.x1}) must be >= 0`);
  assert.ok(expanded.x2 <= imageW, `x2 (${expanded.x2}) must be <= ${imageW}`);
  assert.ok(expanded.y1 >= 0, `y1 (${expanded.y1}) must be >= 0`);
  assert.ok(expanded.y2 <= imageH, `y2 (${expanded.y2}) must be <= ${imageH}`);
  const finalW = expanded.x2 - expanded.x1;
  const finalH = expanded.y2 - expanded.y1;
  assert.equal(finalW, finalH, "1:1 target ratio must result in square crop");
  assert.equal(finalW % 8, 0, "width must be aligned to 8");
  assert.equal(finalH % 8, 0, "height must be aligned to 8");
});

runTest("Crop expansion at bottom edge: shifts top without exceeding imageHeight", () => {
  const imageW = 1024;
  const imageH = 1024;
  const crop = { x1: 400, y1: 900, x2: 500, y2: 1024 };
  const expanded = expandCropRegion(crop, 512, 512, imageW, imageH);

  assert.ok(expanded.y1 >= 0, `y1 (${expanded.y1}) must be >= 0`);
  assert.ok(expanded.y2 <= imageH, `y2 (${expanded.y2}) must be <= ${imageH}`);
  const finalW = expanded.x2 - expanded.x1;
  const finalH = expanded.y2 - expanded.y1;
  assert.equal(finalW, finalH, "1:1 target ratio must result in square crop");
  assert.equal(finalW % 8, 0, "width must be aligned to 8");
});

runTest("Extreme 16:9 target ratio with narrow vertical mask crop", () => {
  const imageW = 1920;
  const imageH = 1080;
  // Narrow vertical strip: 50x500
  const crop = { x1: 100, y1: 200, x2: 150, y2: 700 };
  const expanded = expandCropRegion(crop, 1920, 1080, imageW, imageH);

  assert.ok(expanded.x1 >= 0);
  assert.ok(expanded.x2 <= imageW);
  assert.ok(expanded.y1 >= 0);
  assert.ok(expanded.y2 <= imageH);
  const finalW = expanded.x2 - expanded.x1;
  const finalH = expanded.y2 - expanded.y1;
  const actualRatio = finalW / finalH;
  const targetRatio = 1920 / 1080;
  // Ratio should be very close to target ratio within 8-pixel quantization
  assert.ok(Math.abs(actualRatio - targetRatio) < 0.05, `Ratio ${actualRatio} should match target ${targetRatio}`);
});

runTest("Tiny 1x1 pixel crop expands to minimum 64x64 aligned to 8", () => {
  const imageW = 512;
  const imageH = 512;
  const crop = { x1: 256, y1: 256, x2: 257, y2: 257 };
  const expanded = expandCropRegion(crop, 512, 512, imageW, imageH);

  const finalW = expanded.x2 - expanded.x1;
  const finalH = expanded.y2 - expanded.y1;
  assert.ok(finalW >= 64, `Width ${finalW} must be >= 64`);
  assert.ok(finalH >= 64, `Height ${finalH} must be >= 64`);
  assert.equal(finalW % 8, 0);
  assert.equal(finalH % 8, 0);
});

// 2. Model Family Detection Parity
console.log("\n--- Suite 2: Model Architecture Family Compatibility ---");

runTest("SDXL-like families return true for regional conditioning support", () => {
  assert.equal(familyIsSdxlLike("sdxl"), true);
  assert.equal(familyIsSdxlLike("illustrious"), true);
  assert.equal(familyIsSdxlLike("pony"), true);
  assert.equal(familyIsSdxlLike("mugen"), true);
});

runTest("Non-SDXL families return false for regional conditioning bypass", () => {
  assert.equal(familyIsSdxlLike("sd15"), false);
  assert.equal(familyIsSdxlLike("sd3"), false);
  assert.equal(familyIsSdxlLike("flux1d"), false);
  assert.equal(familyIsSdxlLike("wan"), false);
  assert.equal(familyIsSdxlLike("qwen"), false);
  assert.equal(familyIsSdxlLike("chroma"), false);
  assert.equal(familyIsSdxlLike("unknown"), false);
});

// 3. Multi-ControlNet Deduplication Oracle Simulation
console.log("\n--- Suite 3: Multi-ControlNet Deduplication & Validation Oracle ---");

function simulateActiveControlnets(legacy, list) {
  const isValid = (cn) => cn && cn.enabled && cn.controlnet_model?.trim() && cn.image?.trim();
  const isEqual = (a, b) =>
    a && b &&
    a.enabled === b.enabled &&
    a.controlnet_model === b.controlnet_model &&
    a.image === b.image &&
    a.strength === b.strength &&
    a.start_percent === b.start_percent &&
    a.end_percent === b.end_percent &&
    a.preset === b.preset &&
    a.preprocessor === b.preprocessor;

  const result = [];
  if (legacy && isValid(legacy)) {
    result.push(legacy);
  }
  for (const cn of list || []) {
    if (isValid(cn)) {
      if (!legacy || !isEqual(legacy, cn)) {
        result.push(cn);
      }
    }
  }
  return result;
}

runTest("Oracle deduplicates identical legacy and vector item", () => {
  const item = {
    enabled: true,
    controlnet_model: "pose.safetensors",
    image: "pose.png",
    strength: 0.85,
    start_percent: 0.0,
    end_percent: 1.0,
  };
  const active = simulateActiveControlnets(item, [item]);
  assert.equal(active.length, 1);
  assert.equal(active[0].controlnet_model, "pose.safetensors");
});

runTest("Oracle retains 4 distinct ControlNet layers in sequential order", () => {
  const cns = [
    { enabled: true, controlnet_model: "cn0.safetensors", image: "img0.png", strength: 0.9, start_percent: 0.0, end_percent: 1.0 },
    { enabled: true, controlnet_model: "cn1.safetensors", image: "img1.png", strength: 0.8, start_percent: 0.0, end_percent: 1.0 },
    { enabled: true, controlnet_model: "cn2.safetensors", image: "img2.png", strength: 0.7, start_percent: 0.1, end_percent: 0.9 },
    { enabled: true, controlnet_model: "cn3.safetensors", image: "img3.png", strength: 0.6, start_percent: 0.2, end_percent: 0.8 },
  ];
  const active = simulateActiveControlnets(null, cns);
  assert.equal(active.length, 4);
  assert.equal(active[0].controlnet_model, "cn0.safetensors");
  assert.equal(active[3].controlnet_model, "cn3.safetensors");
});

runTest("Oracle skips disabled items and items with missing/empty image or model", () => {
  const cns = [
    { enabled: false, controlnet_model: "cn0.safetensors", image: "img0.png" }, // disabled
    { enabled: true, controlnet_model: "  ", image: "img1.png" }, // empty model
    { enabled: true, controlnet_model: "cn2.safetensors", image: "" }, // empty image
    { enabled: true, controlnet_model: "cn3.safetensors", image: "img3.png", strength: 1.0, start_percent: 0.0, end_percent: 1.0 }, // valid!
  ];
  const active = simulateActiveControlnets(null, cns);
  assert.equal(active.length, 1);
  assert.equal(active[0].controlnet_model, "cn3.safetensors");
});

// Summary
console.log("\n=======================================================");
console.log(`TOTAL ADVERSARIAL TESTS: ${totalTests}`);
console.log(`PASSED: ${passedTests}`);
console.log(`FAILED: ${failedTests}`);
console.log("=======================================================\n");

if (failedTests > 0) {
  process.exit(1);
} else {
  console.log("ALL ADVERSARIAL STRESS TESTS PASSED CLEANLY (Exit Code 0).");
  process.exit(0);
}
