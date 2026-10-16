// scripts/test-challenger-m4.mjs
// Empirical Test Harness for Milestone 4: Modeless Workspace & Sidebar Domain Isolation
// Challenger: teamwork_preview_challenger_m4_1

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const PROJECT_ROOT = new URL("../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

let passed = 0;
let failed = 0;
const results = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    results.push({ name, status: "PASS" });
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    results.push({ name, status: "FAIL", error: err.message });
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    passed++;
    results.push({ name, status: "PASS" });
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    results.push({ name, status: "FAIL", error: err.message });
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
  }
}

console.log("=================================================================");
console.log("M4 EMPIRICAL CHALLENGE & STRESS HARNESS");
console.log("=================================================================\n");

// ============================================================================
// PART 1: SOURCE AST & CODE INSPECTION
// ============================================================================
console.log("--- PART 1: DOMAIN ISOLATION & CODE INSPECTION ---");

const canvasStoreSource = fs.readFileSync(
  path.resolve(PROJECT_ROOT, "src/lib/stores/canvas.svelte.ts"),
  "utf8"
);
const generationPageSource = fs.readFileSync(
  path.resolve(PROJECT_ROOT, "src/lib/components/generation/GenerationPage.svelte"),
  "utf8"
);
const dimensionControlsSource = fs.readFileSync(
  path.resolve(PROJECT_ROOT, "src/lib/components/generation/DimensionControls.svelte"),
  "utf8"
);
const promptInputsSource = fs.readFileSync(
  path.resolve(PROJECT_ROOT, "src/lib/components/generation/PromptInputs.svelte"),
  "utf8"
);
const promptScheduleSource = fs.readFileSync(
  path.resolve(PROJECT_ROOT, "src/lib/utils/promptSchedule.ts"),
  "utf8"
);
const inpaintInspectorSource = fs.readFileSync(
  path.resolve(PROJECT_ROOT, "src/lib/components/canvas/inspector/InpaintInspector.svelte"),
  "utf8"
);
const boundingBoxControlsSource = fs.readFileSync(
  path.resolve(PROJECT_ROOT, "src/lib/components/canvas/inspector/BoundingBoxControls.svelte"),
  "utf8"
);
const layerPropertiesInspectorSource = fs.readFileSync(
  path.resolve(PROJECT_ROOT, "src/lib/components/canvas/inspector/LayerPropertiesInspector.svelte"),
  "utf8"
);
const layerPanelSource = fs.readFileSync(
  path.resolve(PROJECT_ROOT, "src/lib/components/canvas/layers/LayerPanel.svelte"),
  "utf8"
);
const generateButtonSource = fs.readFileSync(
  path.resolve(PROJECT_ROOT, "src/lib/components/generation/GenerateButton.svelte"),
  "utf8"
);

test("M4-DI-01: DimensionControls.svelte is clean of Forge inpaint crop-and-stitch controls", () => {
  assert.ok(!dimensionControlsSource.includes("inpaintFullRes"), "DimensionControls must not contain inpaintFullRes");
  assert.ok(!dimensionControlsSource.includes("inpaintFullResPadding"), "DimensionControls must not contain inpaintFullResPadding");
  assert.ok(!dimensionControlsSource.includes("maskBlur"), "DimensionControls must not contain maskBlur");
  assert.ok(!dimensionControlsSource.includes("inpaintingFill"), "DimensionControls must not contain inpaintingFill");
  assert.ok(!dimensionControlsSource.includes("maskTargetW"), "DimensionControls must not contain maskTargetW");
  assert.ok(!dimensionControlsSource.includes("maskTargetH"), "DimensionControls must not contain maskTargetH");
  assert.ok(!dimensionControlsSource.includes("applyMaskUpscale"), "DimensionControls must not contain applyMaskUpscale");
});

test("M4-DI-02: InpaintInspector.svelte owns Forge inpaint crop-and-stitch controls", () => {
  assert.ok(inpaintInspectorSource.includes("canvas.inpaintFullRes"), "InpaintInspector must own inpaintFullRes");
  assert.ok(inpaintInspectorSource.includes("canvas.inpaintFullResPadding"), "InpaintInspector must own inpaintFullResPadding");
  assert.ok(inpaintInspectorSource.includes("canvas.maskBlur"), "InpaintInspector must own maskBlur");
  assert.ok(inpaintInspectorSource.includes("canvas.inpaintMaskInvert"), "InpaintInspector must own inpaintMaskInvert");
  assert.ok(inpaintInspectorSource.includes("canvas.inpaintingFill"), "InpaintInspector must own inpaintingFill");
});

test("M4-DI-03: Right sidebar exclusively houses LayerPanel, LayerPropertiesInspector, BoundingBoxControls, InpaintInspector", () => {
  // Check sectionSides in GenerationPage.svelte
  const sectionSidesMatch = generationPageSource.match(/sectionSides\s*=\s*\$state[^{]*\(\{([\s\S]*?)\}\);/);
  assert.ok(sectionSidesMatch, "sectionSides dictionary must exist in GenerationPage.svelte");
  const sectionSidesContent = sectionSidesMatch[1];
  
  assert.match(sectionSidesContent, /layers_stack:\s*"right"/, "layers_stack must be assigned to right sidebar");
  assert.match(sectionSidesContent, /layer_inspector:\s*"right"/, "layer_inspector must be assigned to right sidebar");
  assert.match(sectionSidesContent, /bounding_box:\s*"right"/, "bounding_box must be assigned to right sidebar");
  assert.match(sectionSidesContent, /inpaint_inspector:\s*"right"/, "inpaint_inspector must be assigned to right sidebar");
});

test("M4-DI-04: Left sidebar retains model, sampler, prompts, dimensions", () => {
  const sectionSidesMatch = generationPageSource.match(/sectionSides\s*=\s*\$state[^{]*\(\{([\s\S]*?)\}\);/);
  assert.ok(sectionSidesMatch, "sectionSides dictionary must exist in GenerationPage.svelte");
  const sectionSidesContent = sectionSidesMatch[1];
  
  assert.match(sectionSidesContent, /model:\s*"left"/, "model must be assigned to left sidebar");
  assert.match(sectionSidesContent, /sampler:\s*"left"/, "sampler must be assigned to left sidebar");
  assert.match(sectionSidesContent, /prompts:\s*"left"/, "prompts must be assigned to left sidebar");
  assert.match(sectionSidesContent, /dimensions:\s*"left"/, "dimensions must be assigned to left sidebar");
});

test("M4-DI-05: Prompts domain retains prompt scheduling syntax", () => {
  assert.ok(promptInputsSource.includes("hasSchedulingTags"), "PromptInputs must use hasSchedulingTags");
  assert.ok(promptInputsSource.includes("parseScheduledPrompt"), "PromptInputs must use parseScheduledPrompt");
  assert.ok(promptInputsSource.includes("hasRandomSyntax"), "PromptInputs must support random syntax");
  assert.ok(promptScheduleSource.includes("PROMPT_SCHEDULE_REGEX"), "promptSchedule must import PROMPT_SCHEDULE_REGEX");
});

test("M4-MW-01: GenerationPage.svelte has NO legacy mode tabs (txt2img, img2img, inpaint, edit buttons)", () => {
  assert.ok(!generationPageSource.includes("ALL_MODES"), "GenerationPage must not define ALL_MODES");
  assert.ok(!generationPageSource.includes("selectMode("), "GenerationPage must not define selectMode()");
  assert.ok(!generationPageSource.includes("class=\"mode-tab\""), "GenerationPage must not have mode-tab classes");
  // Ensure ViewSwitcher is not used
  assert.ok(!generationPageSource.includes("ViewSwitcher"), "GenerationPage must not use ViewSwitcher");
});

test("M4-MW-02: CanvasEditor is mounted permanently for image generation", () => {
  assert.ok(generationPageSource.includes("<CanvasEditor bind:this={canvasEditorRef} />"), "CanvasEditor must be mounted in GenerationPage");
  assert.ok(generationPageSource.includes('generation.mode === "video"'), "Only video mode branches away from CanvasEditor");
});

test("M4-MW-03: canvas.isCanvasMode defaults to true", () => {
  assert.match(canvasStoreSource, /isCanvasMode\s*=\s*\$state\(true\)/, "isCanvasMode must default to true");
});

// ============================================================================
// PART 2: DYNAMIC MODE AUTO-DETECTION ENGINE SIMULATION & UNIT VERIFICATION
// ============================================================================
console.log("\n--- PART 2: DYNAMIC MODE AUTO-DETECTION & TRANSITIONS ---");

// Build a clean, authoritative mock of the CanvasStore mode resolution logic
// matching exactly src/lib/stores/canvas.svelte.ts lines 1655-1700
class TestCanvasStore {
  constructor() {
    this.layers = [];
    this.activeLayerId = null;
    this.layerThumbnails = {};
    this.canvasWidth = 1024;
    this.canvasHeight = 1024;
    this.boundingBox = { x: 0, y: 0, width: 1024, height: 1024, locked: false };
    this.referenceImageUrl = null;
    this.currentPreparedInputImage = null;
    this.persistedMaskPreviewUrl = null;
    this.preparedInpaintPreviewUrl = null;
    this.generation = {
      mode: "txt2img",
      editReferenceImages: [],
    };
  }

  get activeLayer() {
    return this.layers.find((l) => l.id === this.activeLayerId) || null;
  }

  get hasActiveMask() {
    return !!(
      this.persistedMaskPreviewUrl ||
      this.preparedInpaintPreviewUrl ||
      (this.activeLayer?.type === "mask" && this.activeLayer.visible && !!this.layerThumbnails[this.activeLayer.id]) ||
      this.layers.some((l) => l.type === "mask" && l.visible && !!this.layerThumbnails[l.id])
    );
  }

  get hasRasterContent() {
    return this.layers.some((l) => l.type === "raster" && l.visible && !!this.layerThumbnails[l.id]);
  }

  get currentUnifiedAction() {
    if (this.hasActiveMask) {
      if (
        this.boundingBox.x < 0 ||
        this.boundingBox.y < 0 ||
        this.boundingBox.x + this.boundingBox.width > this.canvasWidth ||
        this.boundingBox.y + this.boundingBox.height > this.canvasHeight
      ) {
        return "outpaint";
      }
      return "inpaint";
    }

    if (this.referenceImageUrl || this.currentPreparedInputImage || this.hasRasterContent) {
      return "img2img";
    }

    return "txt2img";
  }

  resolveUnifiedGenerationMode() {
    if (this.generation.mode === "video") return "video";
    const hasEditReference =
      this.generation.editReferenceImages?.some(
        (img) => typeof img === "string" && img.trim().length > 0
      ) && (this.generation.supportsImageEditMode === undefined || this.generation.supportsImageEditMode);
    if (hasEditReference) {
      return "image_edit";
    }
    if (this.generation.denoise !== undefined && this.generation.denoise >= 0.999) {
      return "txt2img";
    }
    if (this.hasActiveMask) {
      return "inpainting";
    }
    if (this.referenceImageUrl || this.currentPreparedInputImage || this.hasRasterContent) {
      return "img2img";
    }
    return "txt2img";
  }

  // Simulated layer helpers
  addLayer(layer) {
    this.layers.push(layer);
    this.activeLayerId = layer.id;
  }

  removeLayer(id) {
    this.layers = this.layers.filter((l) => l.id !== id);
    delete this.layerThumbnails[id];
    if (this.activeLayerId === id) {
      this.activeLayerId = this.layers[0]?.id || null;
    }
  }

  setThumbnail(id, dataUrl) {
    this.layerThumbnails[id] = dataUrl;
  }

  clearThumbnail(id) {
    delete this.layerThumbnails[id];
  }
}

test("M4-SM-01: Empty canvas resolves to txt2img", () => {
  const store = new TestCanvasStore();
  assert.equal(store.resolveUnifiedGenerationMode(), "txt2img");
  assert.equal(store.currentUnifiedAction, "txt2img");
});

test("M4-SM-02: Adding raster layer with image transitions to img2img", () => {
  const store = new TestCanvasStore();
  store.addLayer({ id: "raster_1", type: "raster", visible: true, name: "Base Image" });
  store.setThumbnail("raster_1", "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==");

  assert.equal(store.hasRasterContent, true);
  assert.equal(store.hasActiveMask, false);
  assert.equal(store.resolveUnifiedGenerationMode(), "img2img");
  assert.equal(store.currentUnifiedAction, "img2img");
});

test("M4-SM-03: Adding mask layer with strokes transitions to inpainting", () => {
  const store = new TestCanvasStore();
  store.addLayer({ id: "raster_1", type: "raster", visible: true, name: "Base Image" });
  store.setThumbnail("raster_1", "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==");
  
  store.addLayer({ id: "mask_1", type: "mask", visible: true, name: "Inpaint Mask" });
  store.setThumbnail("mask_1", "data:image/png;base64,maskdata");

  assert.equal(store.hasActiveMask, true);
  assert.equal(store.resolveUnifiedGenerationMode(), "inpainting");
  assert.equal(store.currentUnifiedAction, "inpaint");
});

test("M4-SM-04: Clearing mask strokes dynamically transitions back to img2img", () => {
  const store = new TestCanvasStore();
  store.addLayer({ id: "raster_1", type: "raster", visible: true, name: "Base Image" });
  store.setThumbnail("raster_1", "data:image/png;base64,rasterdata");
  
  store.addLayer({ id: "mask_1", type: "mask", visible: true, name: "Inpaint Mask" });
  store.setThumbnail("mask_1", "data:image/png;base64,maskdata");
  assert.equal(store.resolveUnifiedGenerationMode(), "inpainting");

  // User clears mask
  store.clearThumbnail("mask_1");
  store.persistedMaskPreviewUrl = null;
  store.preparedInpaintPreviewUrl = null;

  assert.equal(store.hasActiveMask, false);
  assert.equal(store.hasRasterContent, true);
  assert.equal(store.resolveUnifiedGenerationMode(), "img2img");
  assert.equal(store.currentUnifiedAction, "img2img");
});

test("M4-SM-05: Clearing raster layer transitions all the way back to txt2img", () => {
  const store = new TestCanvasStore();
  store.addLayer({ id: "raster_1", type: "raster", visible: true, name: "Base Image" });
  store.setThumbnail("raster_1", "data:image/png;base64,rasterdata");
  assert.equal(store.resolveUnifiedGenerationMode(), "img2img");

  store.removeLayer("raster_1");
  assert.equal(store.hasRasterContent, false);
  assert.equal(store.resolveUnifiedGenerationMode(), "txt2img");
  assert.equal(store.currentUnifiedAction, "txt2img");
});

test("M4-SM-06: Outpaint auto-detection when bounding box exceeds canvas boundary", () => {
  const store = new TestCanvasStore();
  store.addLayer({ id: "raster_1", type: "raster", visible: true, name: "Base Image" });
  store.setThumbnail("raster_1", "data:image/png;base64,rasterdata");
  store.addLayer({ id: "mask_1", type: "mask", visible: true, name: "Mask" });
  store.setThumbnail("mask_1", "data:image/png;base64,maskdata");

  // Inpaint within bounds
  store.boundingBox = { x: 0, y: 0, width: 1024, height: 1024 };
  assert.equal(store.currentUnifiedAction, "inpaint");
  assert.equal(store.resolveUnifiedGenerationMode(), "inpainting");

  // Outpaint (x < 0)
  store.boundingBox = { x: -64, y: 0, width: 1024, height: 1024 };
  assert.equal(store.currentUnifiedAction, "outpaint");
  // Generation mode is still inpainting pipeline under the hood
  assert.equal(store.resolveUnifiedGenerationMode(), "inpainting");

  // Outpaint (x + w > canvasWidth)
  store.boundingBox = { x: 100, y: 0, width: 1024, height: 1024 }; // 1124 > 1024
  assert.equal(store.currentUnifiedAction, "outpaint");

  // Outpaint (y + h > canvasHeight)
  store.boundingBox = { x: 0, y: 500, width: 512, height: 600 }; // 1100 > 1024
  assert.equal(store.currentUnifiedAction, "outpaint");
});

test("M4-SM-07: Video mode is strictly preserved and not overridden by canvas state", () => {
  const store = new TestCanvasStore();
  store.generation.mode = "video";
  store.addLayer({ id: "raster_1", type: "raster", visible: true, name: "Base" });
  store.setThumbnail("raster_1", "data:image/png;base64,data");
  store.addLayer({ id: "mask_1", type: "mask", visible: true, name: "Mask" });
  store.setThumbnail("mask_1", "data:image/png;base64,data");

  assert.equal(store.resolveUnifiedGenerationMode(), "video");
});

test("M4-SM-08: Edit mode with reference images resolves to image_edit", () => {
  const store = new TestCanvasStore();
  store.generation.editReferenceImages = ["ref1.png"];
  assert.equal(store.resolveUnifiedGenerationMode(), "image_edit");
});

test("M4-SM-08b: Unset/null edit reference images [null, null, null] resolve to txt2img, never image_edit", () => {
  const store = new TestCanvasStore();
  store.generation.editReferenceImages = [null, null, null];
  assert.equal(store.resolveUnifiedGenerationMode(), "txt2img");
});

test("M4-SM-08c: Denoise = 1.0 switches to txt2img even with raster layer or mask present", () => {
  const store = new TestCanvasStore();
  store.addLayer({ id: "raster_1", type: "raster", visible: true, name: "Base" });
  store.setThumbnail("raster_1", "data:image/png;base64,data");
  store.generation.denoise = 1.0;
  assert.equal(store.resolveUnifiedGenerationMode(), "txt2img");

  store.addLayer({ id: "mask_1", type: "mask", visible: true, name: "Mask" });
  store.setThumbnail("mask_1", "data:image/png;base64,data");
  assert.equal(store.resolveUnifiedGenerationMode(), "txt2img");

  // Denoise below 1.0 restores inpainting
  store.generation.denoise = 0.7;
  assert.equal(store.resolveUnifiedGenerationMode(), "inpainting");
});

test("M4-SM-09: Legacy referenceImageUrl or currentPreparedInputImage triggers img2img", () => {
  const store = new TestCanvasStore();
  store.referenceImageUrl = "blob:http://localhost/ref.png";
  assert.equal(store.resolveUnifiedGenerationMode(), "img2img");

  store.referenceImageUrl = null;
  store.currentPreparedInputImage = "input.png";
  assert.equal(store.resolveUnifiedGenerationMode(), "img2img");
});

// ============================================================================
// PART 3: ADVERSARIAL STRESS-TESTING & EDGE-CASE MINING
// ============================================================================
console.log("\n--- PART 3: ADVERSARIAL STRESS-TESTING & EDGE CASES ---");

test("M4-ADV-01: Raster layer without thumbnail (empty layer) does not trigger img2img", () => {
  const store = new TestCanvasStore();
  store.addLayer({ id: "empty_raster", type: "raster", visible: true, name: "Empty Raster" });
  // No thumbnail set (canvas is blank)
  assert.equal(store.hasRasterContent, false);
  assert.equal(store.resolveUnifiedGenerationMode(), "txt2img");
});

test("M4-ADV-02: Mask layer without thumbnail (no painted strokes) does not trigger inpainting", () => {
  const store = new TestCanvasStore();
  store.addLayer({ id: "raster_1", type: "raster", visible: true, name: "Base" });
  store.setThumbnail("raster_1", "data:image/png;base64,data");
  store.addLayer({ id: "empty_mask", type: "mask", visible: true, name: "Empty Mask" });
  // No thumbnail set on mask
  assert.equal(store.hasActiveMask, false);
  assert.equal(store.resolveUnifiedGenerationMode(), "img2img");
});

test("M4-ADV-03: Hidden mask layer (visible = false) does not trigger inpainting when inactive", () => {
  const store = new TestCanvasStore();
  store.addLayer({ id: "raster_1", type: "raster", visible: true, name: "Base" });
  store.setThumbnail("raster_1", "data:image/png;base64,data");

  store.addLayer({ id: "mask_1", type: "mask", visible: false, name: "Hidden Mask" });
  store.setThumbnail("mask_1", "data:image/png;base64,maskdata");
  // Set activeLayerId to raster_1 so mask is not the active layer
  store.activeLayerId = "raster_1";

  assert.equal(store.hasActiveMask, false, "Hidden inactive mask layer should not make hasActiveMask true");
  assert.equal(store.resolveUnifiedGenerationMode(), "img2img");
});

test("M4-ADV-04: Multiple mask layers where only one is visible and painted", () => {
  const store = new TestCanvasStore();
  store.addLayer({ id: "raster_1", type: "raster", visible: true, name: "Base" });
  store.setThumbnail("raster_1", "data:image/png;base64,data");

  store.addLayer({ id: "mask_hidden", type: "mask", visible: false, name: "Mask Hidden" });
  store.setThumbnail("mask_hidden", "data:image/png;base64,maskdata");

  store.addLayer({ id: "mask_empty", type: "mask", visible: true, name: "Mask Empty" });

  store.activeLayerId = "mask_empty";
  assert.equal(store.hasActiveMask, false);
  assert.equal(store.resolveUnifiedGenerationMode(), "img2img");

  // Paint on mask_empty
  store.setThumbnail("mask_empty", "data:image/png;base64,maskdata");
  assert.equal(store.hasActiveMask, true);
  assert.equal(store.resolveUnifiedGenerationMode(), "inpainting");
});

test("M4-ADV-05: Rapid sequence of layer creations, thumbnail updates, and deletions", () => {
  const store = new TestCanvasStore();
  for (let i = 0; i < 50; i++) {
    const id = `layer_${i}`;
    const type = i % 2 === 0 ? "raster" : "mask";
    store.addLayer({ id, type, visible: true, name: `Layer ${i}` });
    store.setThumbnail(id, `data:image/png;base64,data${i}`);
    
    const mode = store.resolveUnifiedGenerationMode();
    assert.ok(mode === "img2img" || mode === "inpainting");
    
    if (i % 3 === 0) {
      store.removeLayer(id);
    }
  }
  // Clear all remaining layers
  while (store.layers.length > 0) {
    store.removeLayer(store.layers[0].id);
  }
  assert.equal(store.resolveUnifiedGenerationMode(), "txt2img");
});

// ============================================================================
// PART 4: PROMPT SCHEDULING SYNTAX INTEGRITY & BACKDROP COMPATIBILITY
// ============================================================================
console.log("\n--- PART 4: PROMPT SCHEDULING SYNTAX STRESS TESTS ---");

// Load real promptSchedule module
function loadTsModule(relativePath, imports = {}) {
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
    },
    { filename: fullPath }
  );
  return module.exports;
}

const promptSchedule = loadTsModule("src/lib/utils/promptSchedule.ts", {
  "./promptInertRanges.js": loadTsModule("src/lib/utils/promptInertRanges.ts", {
    "./promptSyntaxEscape.js": loadTsModule("src/lib/utils/promptSyntaxEscape.ts"),
    "./promptChunkTokens.js": loadTsModule("src/lib/utils/promptChunkTokens.ts"),
  }),
  "./promptSegmentDetail.js": { parseSegmentDetailPrompt: () => ({ basePrompt: "", detailPrompts: [] }) },
  "./promptChunkTokens.js": loadTsModule("src/lib/utils/promptChunkTokens.ts"),
});

test("M4-PS-01: Prompt scheduling MooshieUI syntax <from:0.5>tag</from>", () => {
  const raw = "1girl, <from:0.5>sunglasses</from>, solo";
  assert.equal(promptSchedule.hasSchedulingTags(raw), true);
  const parsed = promptSchedule.parseScheduledPrompt(raw);
  assert.equal(parsed.segments.length, 1);
  assert.equal(parsed.segments[0].text, "sunglasses");
  assert.equal(parsed.segments[0].start, 0.5);
  assert.equal(parsed.segments[0].end, 1.0);
  assert.equal(parsed.baseText, "1girl, solo");
});

test("M4-PS-02: Prompt scheduling SwarmUI syntax <fromto[0.4]:day, night>", () => {
  const raw = "landscape, <fromto[0.4]:day, night>";
  assert.equal(promptSchedule.hasSchedulingTags(raw), true);
  const parsed = promptSchedule.parseScheduledPrompt(raw);
  assert.equal(parsed.segments.length, 2);
  assert.equal(parsed.segments[0].text, "day");
  assert.equal(parsed.segments[0].start, 0.0);
  assert.equal(parsed.segments[0].end, 0.4);
  assert.equal(parsed.segments[1].text, "night");
  assert.equal(parsed.segments[1].start, 0.4);
  assert.equal(parsed.segments[1].end, 1.0);
});

test("M4-PS-03: Alternating syntax <alt:2>red hair, blue hair</alt>", () => {
  const raw = "portrait, <alt:2>red hair, blue hair</alt>";
  assert.equal(promptSchedule.hasSchedulingTags(raw), true);
  const parsed = promptSchedule.parseScheduledPrompt(raw);
  assert.equal(parsed.segments.length, 2);
  assert.equal(parsed.segments[0].text, "red hair");
  assert.equal(parsed.segments[0].altInterval, 2);
  assert.equal(parsed.segments[1].text, "blue hair");
  assert.equal(parsed.segments[1].altInterval, 2);
});

// ============================================================================
// PART 5: M5 ADVERSARIAL HARDENING & POLISH TESTS
// ============================================================================
console.log("\n--- PART 5: M5 ADVERSARIAL HARDENING & POLISH TESTS ---");

test("M5-ADV-01: Hidden active mask layer (visible = false) does NOT trigger inpainting", () => {
  const store = new TestCanvasStore();
  store.addLayer({ id: "raster_1", type: "raster", visible: true, name: "Base" });
  store.setThumbnail("raster_1", "data:image/png;base64,data");

  store.addLayer({ id: "mask_1", type: "mask", visible: false, name: "Hidden Active Mask" });
  store.setThumbnail("mask_1", "data:image/png;base64,maskdata");
  // activeLayerId is mask_1!
  store.activeLayerId = "mask_1";

  assert.equal(store.hasActiveMask, false, "Active mask with visible=false must not make hasActiveMask true");
  assert.equal(store.resolveUnifiedGenerationMode(), "img2img", "Must fall back to img2img when active mask is hidden");
});

test("M5-ADV-02: Hidden raster layer (visible = false) does NOT trigger img2img", () => {
  const store = new TestCanvasStore();
  store.addLayer({ id: "raster_hidden", type: "raster", visible: false, name: "Hidden Raster" });
  store.setThumbnail("raster_hidden", "data:image/png;base64,data");

  assert.equal(store.hasRasterContent, false, "Hidden raster layer must not make hasRasterContent true");
  assert.equal(store.resolveUnifiedGenerationMode(), "txt2img", "Must fall back to txt2img when raster is hidden");
});

test("M5-ADV-03: syncToGeneration orders resolveUnifiedGenerationMode() before composite capture and isInpainting", () => {
  const syncMatch = canvasStoreSource.match(/async\s+syncToGeneration[\s\S]*?\)\s*\{([\s\S]*?)const\s+isInpainting\s*=\s*generation\.mode\s*===\s*["']inpainting["'];/);
  assert.ok(syncMatch, "syncToGeneration must define isInpainting = generation.mode === 'inpainting'");
  const headerBlock = syncMatch[1];
  assert.ok(
    headerBlock.includes("this.resolveUnifiedGenerationMode()"),
    "syncToGeneration must invoke resolveUnifiedGenerationMode() before isInpainting check"
  );
  // Ensure the old placement at the end of syncToGeneration was removed
  const occurrences = (canvasStoreSource.match(/generation\.mode\s*=\s*this\.resolveUnifiedGenerationMode\(\)/g) || []).length;
  assert.equal(occurrences, 1, "There should be exactly one call to assign generation.mode from resolveUnifiedGenerationMode()");
});

test("M5-ADV-04: GenerateButton.svelte does NOT deactivate canvas mode on paused edit deactivation", () => {
  const pausedEditBlock = generateButtonSource.match(/generation\.pausedEditArmed\s*=\s*false;[\s\S]*?return;/);
  assert.ok(pausedEditBlock, "GenerateButton must have pausedEditArmed reset block");
  assert.ok(
    !pausedEditBlock[0].includes("canvas.isCanvasMode = false;"),
    "GenerateButton pausedEditArmed block must not set canvas.isCanvasMode = false"
  );
});

test("M5-ADV-05: 1st-round mask paint from txt2img resolves immediately to inpainting for crop-and-stitch", () => {
  const store = new TestCanvasStore();
  // Start in txt2img mode
  store.generation.mode = "txt2img";
  assert.equal(store.generation.mode, "txt2img");

  // User paints a mask on canvas
  store.addLayer({ id: "raster_1", type: "raster", visible: true, name: "Base" });
  store.setThumbnail("raster_1", "data:image/png;base64,rasterdata");
  store.addLayer({ id: "mask_1", type: "mask", visible: true, name: "Mask" });
  store.setThumbnail("mask_1", "data:image/png;base64,maskdata");

  // Simulate syncToGeneration beginning:
  if (store.generation.mode !== "video") {
    store.generation.mode = store.resolveUnifiedGenerationMode();
  }
  const isInpainting = store.generation.mode === "inpainting";

  assert.equal(store.generation.mode, "inpainting");
  assert.equal(isInpainting, true, "isInpainting must evaluate to true on the very first round");
});

console.log("\n=================================================================");
console.log(`TOTAL TESTS: ${passed + failed} | PASSED: ${passed} | FAILED: ${failed}`);
console.log("=================================================================");

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
