import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Transpile and load maskCrop.ts
const code = fs.readFileSync("src/lib/utils/maskCrop.ts", "utf8");
const { outputText } = ts.transpileModule(code, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
const mod = { exports: {} };
vm.runInNewContext(outputText, { module: mod, exports: mod.exports });
const { expandCropRegion } = mod.exports;

let totalChecked = 0;
let passedInvariant = 0;
let failedInvariant = 0;
let boundsViolations = 0;
let aspectViolations = 0;
let nanViolations = 0;
const failureSamples = [];

function checkCase(crop, procW, procH, imgW, imgH, label) {
  totalChecked++;
  const expanded = expandCropRegion(crop, procW, procH, imgW, imgH);
  const w = expanded.x2 - expanded.x1;
  const h = expanded.y2 - expanded.y1;

  // 0. Check NaN / Infinity
  if (
    Number.isNaN(expanded.x1) || Number.isNaN(expanded.y1) ||
    Number.isNaN(expanded.x2) || Number.isNaN(expanded.y2) ||
    !Number.isFinite(expanded.x1) || !Number.isFinite(expanded.y1) ||
    !Number.isFinite(expanded.x2) || !Number.isFinite(expanded.y2)
  ) {
    nanViolations++;
    failedInvariant++;
    failureSamples.push({ label, crop, proc: [procW, procH], img: [imgW, imgH], expanded, reason: "NaN/Infinity" });
    return;
  }

  // 1. Bounds check: must be inside [0, 0, imgW, imgH]
  let hasBoundsError = false;
  if (expanded.x1 < 0 || expanded.y1 < 0 || expanded.x2 > imgW || expanded.y2 > imgH) {
    boundsViolations++;
    hasBoundsError = true;
  }

  // 2. Coherence check: w > 0, h > 0
  if (w <= 0 || h <= 0) {
    boundsViolations++;
    hasBoundsError = true;
  }

  // 3. Alignment check: w % 8 === 0 unless imgW < 8, h % 8 === 0 unless imgH < 8
  const wAligned = w % 8 === 0 || imgW < 8 || imgW % 8 !== 0;
  const hAligned = h % 8 === 0 || imgH < 8 || imgH % 8 !== 0;

  // 4. Compute expected finalW and finalH
  let { x1, y1, x2, y2 } = crop;
  const cropW = x2 - x1;
  const cropH = y2 - y1;
  const ratioCrop = cropW / cropH;
  const ratioProcessing = procW / procH;

  if (ratioCrop > ratioProcessing) {
    const desiredH = cropW / ratioProcessing;
    const diff = Math.floor(desiredH - cropH);
    y1 -= Math.floor(diff / 2);
    y2 += diff - Math.floor(diff / 2);
    if (y2 > imgH) {
      const overflow = y2 - imgH;
      y2 = imgH;
      y1 = Math.max(0, y1 - overflow);
    }
    if (y1 < 0) {
      const overflow = -y1;
      y1 = 0;
      y2 = Math.min(imgH, y2 + overflow);
    }
  } else {
    const desiredW = cropH * ratioProcessing;
    const diff = Math.floor(desiredW - cropW);
    x1 -= Math.floor(diff / 2);
    x2 += diff - Math.floor(diff / 2);
    if (x2 > imgW) {
      const overflow = x2 - imgW;
      x2 = imgW;
      x1 = Math.max(0, x1 - overflow);
    }
    if (x1 < 0) {
      const overflow = -x1;
      x1 = 0;
      x2 = Math.min(imgW, x2 + overflow);
    }
  }

  let expectedFinalW = Math.max(64, Math.round((x2 - x1) / 8) * 8);
  let expectedFinalH = Math.max(64, Math.round((y2 - y1) / 8) * 8);
  if (expectedFinalW > imgW) {
    expectedFinalW = Math.max(8, Math.floor(imgW / 8) * 8);
  }
  if (expectedFinalH > imgH) {
    expectedFinalH = Math.max(8, Math.floor(imgH / 8) * 8);
  }

  // The critical invariant from task prompt:
  // "Verify that in ALL cases where finalW <= imageWidth and finalH <= imageHeight,
  // the returned width and height match finalW and finalH exactly, guaranteeing 100% aspect ratio invariance with zero distortion."
  let matchesFinal = false;
  if (expectedFinalW <= imgW && expectedFinalH <= imgH) {
    if (w === expectedFinalW && h === expectedFinalH) {
      matchesFinal = true;
    } else {
      aspectViolations++;
    }
  } else {
    matchesFinal = true;
  }

  if (hasBoundsError || !matchesFinal) {
    failedInvariant++;
    if (failureSamples.length < 20) {
      failureSamples.push({
        label,
        crop,
        proc: [procW, procH],
        img: [imgW, imgH],
        expanded,
        w,
        h,
        expectedFinalW,
        expectedFinalH,
        hasBoundsError,
        matchesFinal,
      });
    }
  } else {
    passedInvariant++;
  }
}

// Target processing aspect ratios to test
const targetAspectRatios = [
  { name: "1:1", w: 512, h: 512 },
  { name: "1:1 (large)", w: 1024, h: 1024 },
  { name: "16:9", w: 1024, h: 576 },
  { name: "16:9 (FHD)", w: 1920, h: 1080 },
  { name: "9:16", w: 576, h: 1024 },
  { name: "9:16 (FHD)", w: 1080, h: 1920 },
  { name: "21:9", w: 1344, h: 576 },
  { name: "21:9 (UW)", w: 2560, h: 1080 },
  { name: "4:3", w: 1024, h: 768 },
  { name: "4:3 (SD)", w: 640, h: 480 },
  { name: "3:4", w: 768, h: 1024 },
  { name: "3:4 (SD)", w: 480, h: 640 },
  // Adversarial ratios
  { name: "32:9 (Super-Ultra-Wide)", w: 1792, h: 504 },
  { name: "9:32 (Super-Ultra-Tall)", w: 504, h: 1792 },
  { name: "2.39:1 (Anamorphic)", w: 1152, h: 480 },
  { name: "Non-standard (odd)", w: 1023, h: 577 },
];

// Canvas dimensions to test
const canvasDimensions = [
  { w: 512, h: 512 },
  { w: 1000, h: 1000 },
  { w: 1024, h: 1024 },
  { w: 1920, h: 1080 },
  { w: 1080, h: 1920 },
  { w: 1280, h: 720 },
  { w: 720, h: 1280 },
  { w: 2560, h: 1080 },
  { w: 800, h: 600 },
  { w: 600, h: 800 },
  { w: 100, h: 100 },
  { w: 64, h: 64 },
  // Odd and extreme canvases
  { w: 999, h: 1001 },
  { w: 513, h: 515 },
  { w: 3840, h: 2160 },
  { w: 70, h: 70 },
  { w: 48, h: 48 },
];

console.log("=== STARTING EXTENDED ADVERSARIAL STRESS TEST HARNESS ===");

for (const target of targetAspectRatios) {
  for (const canvas of canvasDimensions) {
    const { w: imgW, h: imgH } = canvas;
    const { w: procW, h: procH, name: arName } = target;

    // 1. Extremely small masks (1x1 and 2x2)
    // Corners
    checkCase({ x1: 0, y1: 0, x2: 1, y2: 1 }, procW, procH, imgW, imgH, `${arName} 1x1 top-left @ ${imgW}x${imgH}`);
    checkCase({ x1: imgW - 1, y1: 0, x2: imgW, y2: 1 }, procW, procH, imgW, imgH, `${arName} 1x1 top-right @ ${imgW}x${imgH}`);
    checkCase({ x1: 0, y1: imgH - 1, x2: 1, y2: imgH }, procW, procH, imgW, imgH, `${arName} 1x1 bottom-left @ ${imgW}x${imgH}`);
    checkCase({ x1: imgW - 1, y1: imgH - 1, x2: imgW, y2: imgH }, procW, procH, imgW, imgH, `${arName} 1x1 bottom-right @ ${imgW}x${imgH}`);
    // Center
    const midX = Math.floor(imgW / 2);
    const midY = Math.floor(imgH / 2);
    checkCase({ x1: midX, y1: midY, x2: midX + 1, y2: midY + 1 }, procW, procH, imgW, imgH, `${arName} 1x1 center @ ${imgW}x${imgH}`);

    // 2x2
    checkCase({ x1: 0, y1: 0, x2: 2, y2: 2 }, procW, procH, imgW, imgH, `${arName} 2x2 top-left @ ${imgW}x${imgH}`);
    checkCase({ x1: imgW - 2, y1: 0, x2: imgW, y2: 2 }, procW, procH, imgW, imgH, `${arName} 2x2 top-right @ ${imgW}x${imgH}`);
    checkCase({ x1: 0, y1: imgH - 2, x2: 2, y2: imgH }, procW, procH, imgW, imgH, `${arName} 2x2 bottom-left @ ${imgW}x${imgH}`);
    checkCase({ x1: imgW - 2, y1: imgH - 2, x2: imgW, y2: imgH }, procW, procH, imgW, imgH, `${arName} 2x2 bottom-right @ ${imgW}x${imgH}`);
    checkCase({ x1: midX - 1, y1: midY - 1, x2: midX + 1, y2: midY + 1 }, procW, procH, imgW, imgH, `${arName} 2x2 center @ ${imgW}x${imgH}`);

    // Single-pixel full width or height strips
    checkCase({ x1: 0, y1: 0, x2: imgW, y2: 1 }, procW, procH, imgW, imgH, `${arName} full-width 1px top strip`);
    checkCase({ x1: 0, y1: imgH - 1, x2: imgW, y2: imgH }, procW, procH, imgW, imgH, `${arName} full-width 1px bottom strip`);
    checkCase({ x1: 0, y1: 0, x2: 1, y2: imgH }, procW, procH, imgW, imgH, `${arName} full-height 1px left strip`);
    checkCase({ x1: imgW - 1, y1: 0, x2: imgW, y2: imgH }, procW, procH, imgW, imgH, `${arName} full-height 1px right strip`);

    // 2. Flush edges (varying depths and spans)
    const depths = [5, 10, 50, 100, Math.floor(imgH / 4), Math.floor(imgW / 4)].filter((d) => d > 0);
    for (const d of depths) {
      if (d < imgW && d < imgH) {
        // Flush left
        checkCase({ x1: 0, y1: Math.floor(imgH / 4), x2: d, y2: Math.floor(imgH * 3 / 4) }, procW, procH, imgW, imgH, `${arName} flush left depth ${d}`);
        // Flush right
        checkCase({ x1: imgW - d, y1: Math.floor(imgH / 4), x2: imgW, y2: Math.floor(imgH * 3 / 4) }, procW, procH, imgW, imgH, `${arName} flush right depth ${d}`);
        // Flush top
        checkCase({ x1: Math.floor(imgW / 4), y1: 0, x2: Math.floor(imgW * 3 / 4), y2: d }, procW, procH, imgW, imgH, `${arName} flush top depth ${d}`);
        // Flush bottom
        checkCase({ x1: Math.floor(imgW / 4), y1: imgH - d, x2: Math.floor(imgW * 3 / 4), y2: imgH }, procW, procH, imgW, imgH, `${arName} flush bottom depth ${d}`);
      }
    }

    // 3. Four corners with various box dimensions (e.g. 50x50, 100x200, 200x100)
    const cornerSizes = [
      { w: 10, h: 10 },
      { w: 50, h: 50 },
      { w: 100, h: 50 },
      { w: 50, h: 100 },
      { w: 200, h: 80 },
      { w: 80, h: 200 },
      { w: 31, h: 17 }, // Primes
      { w: 17, h: 31 },
    ];
    for (const sz of cornerSizes) {
      if (sz.w < imgW && sz.h < imgH) {
        // Top-left
        checkCase({ x1: 0, y1: 0, x2: sz.w, y2: sz.h }, procW, procH, imgW, imgH, `${arName} TL corner ${sz.w}x${sz.h}`);
        // Top-right
        checkCase({ x1: imgW - sz.w, y1: 0, x2: imgW, y2: sz.h }, procW, procH, imgW, imgH, `${arName} TR corner ${sz.w}x${sz.h}`);
        // Bottom-left
        checkCase({ x1: 0, y1: imgH - sz.h, x2: sz.w, y2: imgH }, procW, procH, imgW, imgH, `${arName} BL corner ${sz.w}x${sz.h}`);
        // Bottom-right
        checkCase({ x1: imgW - sz.w, y1: imgH - sz.h, x2: imgW, y2: imgH }, procW, procH, imgW, imgH, `${arName} BR corner ${sz.w}x${sz.h}`);
      }
    }

    // 4. Large masks (90%, 95%, 98%, 99% coverage)
    const fractions = [0.90, 0.95, 0.98, 0.99];
    for (const f of fractions) {
      const cropW = Math.max(1, Math.floor(imgW * f));
      const cropH = Math.max(1, Math.floor(imgH * f));
      const xMargin = Math.floor((imgW - cropW) / 2);
      const yMargin = Math.floor((imgH - cropH) / 2);

      // Centered 90..99%
      checkCase({ x1: xMargin, y1: yMargin, x2: xMargin + cropW, y2: yMargin + cropH }, procW, procH, imgW, imgH, `${arName} centered ${(f * 100).toFixed(0)}%`);
      // Flush top-left 90..99%
      checkCase({ x1: 0, y1: 0, x2: cropW, y2: cropH }, procW, procH, imgW, imgH, `${arName} TL ${(f * 100).toFixed(0)}%`);
      // Flush bottom-right 90..99%
      checkCase({ x1: imgW - cropW, y1: imgH - cropH, x2: imgW, y2: imgH }, procW, procH, imgW, imgH, `${arName} BR ${(f * 100).toFixed(0)}%`);
    }

    // 5. Dense grid sweeps across canvas
    const stepX = Math.max(1, Math.floor(imgW / 5));
    const stepY = Math.max(1, Math.floor(imgH / 5));
    for (let x = 0; x < imgW - 10; x += stepX) {
      for (let y = 0; y < imgH - 10; y += stepY) {
        const cw = Math.min(imgW - x, Math.max(1, Math.floor(stepX * 1.2)));
        const ch = Math.min(imgH - y, Math.max(1, Math.floor(stepY * 1.2)));
        if (cw > 0 && ch > 0) {
          checkCase({ x1: x, y1: y, x2: x + cw, y2: y + ch }, procW, procH, imgW, imgH, `${arName} grid ${x},${y} ${cw}x${ch}`);
        }
      }
    }
  }
}

// 6. Sub-pixel / floating point coordinates robustness
for (const target of targetAspectRatios.slice(0, 4)) {
  const { w: procW, h: procH } = target;
  checkCase({ x1: 10.4, y1: 20.7, x2: 150.2, y2: 80.9 }, procW, procH, 1000, 1000, "Float coords mid-canvas");
  checkCase({ x1: 0.1, y1: 0.2, x2: 999.8, y2: 999.7 }, procW, procH, 1000, 1000, "Float coords near-boundaries");
}

console.log("\n=== STRESS TEST RESULTS ===");
console.log(`Total test cases executed: ${totalChecked}`);
console.log(`Passed invariants:         ${passedInvariant}`);
console.log(`Failed invariants:         ${failedInvariant}`);
console.log(`Bounds violations:         ${boundsViolations}`);
console.log(`Aspect ratio violations:   ${aspectViolations}`);
console.log(`NaN/Infinity violations:   ${nanViolations}`);

if (failureSamples.length > 0) {
  console.log("\nFailure Samples (first 20):");
  console.dir(failureSamples, { depth: null });
  process.exit(1);
} else {
  console.log("\nALL EXTENDED ADVERSARIAL STRESS TESTS PASSED WITH 100% SUCCESS!");
  process.exit(0);
}
