<script lang="ts">
  import { canvas } from "../../../stores/canvas.svelte.js";
  import { locale } from "../../../stores/locale.svelte.js";

  let copiedHex = $state(false);

  function copyHex(hex: string) {
    if (!navigator?.clipboard) return;
    navigator.clipboard.writeText(hex).then(() => {
      copiedHex = true;
      setTimeout(() => {
        copiedHex = false;
      }, 1500);
    });
  }

  function handleTransformBoundChange(field: "x" | "y" | "width" | "height", val: number) {
    if (!canvas.activeTransformBounds) return;
    canvas.setActiveTransformBounds({
      ...canvas.activeTransformBounds,
      [field]: Math.round(val),
    });
  }
</script>

<div class="flex items-center gap-2 px-3 py-1 bg-neutral-950/80 border-b border-neutral-800/80 text-[11px] select-none text-neutral-300 min-h-[34px] overflow-x-auto">
  <!-- Quick Mask Mode Banner if active -->
  {#if canvas.quickMaskMode}
    <div class="flex items-center gap-1.5 px-2 py-0.5 rounded bg-rose-500/20 border border-rose-500/40 text-rose-300 mr-2 shrink-0">
      <span class="w-2 h-2 rounded-full bg-rose-500 animate-pulse"></span>
      <span class="font-semibold">{locale.t("canvas.quick_mask") || "Quick Mask Mode"} (Q)</span>
      <button
        onclick={() => canvas.invertMask()}
        class="ml-1 px-1.5 py-0.5 rounded text-[10px] bg-rose-600/30 hover:bg-rose-600/50 text-rose-200 transition-colors"
        title={locale.t("canvas.invert_mask") || "Invert Mask"}
      >
        {locale.t("canvas.invert_mask") || "Invert"}
      </button>
      <button
        onclick={() => canvas.toggleQuickMask()}
        class="px-1.5 py-0.5 rounded text-[10px] bg-rose-900/40 hover:bg-rose-900/70 text-rose-300 transition-colors"
      >
        ✕
      </button>
    </div>
  {/if}

  <!-- Contextual Controls per active tool -->
  {#if canvas.activeTool === "brush" || canvas.activeTool === "eraser"}
    <!-- Tool Badge -->
    <span class="font-semibold text-neutral-200 uppercase tracking-wider text-[10px] mr-1 shrink-0">
      {canvas.activeTool === "brush" ? locale.t("canvas.brush") || "Brush" : locale.t("canvas.eraser") || "Eraser"}
    </span>

    <div class="w-px h-4 bg-neutral-800 shrink-0"></div>

    <!-- Brush Size -->
    <div class="flex items-center gap-1.5 shrink-0">
      <span class="text-neutral-400 text-[10px]">{locale.t("canvas.brush_size") || "Size"}:</span>
      <input
        type="range"
        bind:value={canvas.brushSettings.size}
        min="1"
        max="500"
        step="1"
        class="w-20 accent-indigo-500 h-1.5 cursor-pointer"
      />
      <input
        type="number"
        bind:value={canvas.brushSettings.size}
        min="1"
        max="500"
        class="w-10 bg-neutral-900 border border-neutral-700 rounded px-1 py-0.5 text-center text-[10px] font-mono text-neutral-200"
      />
      <span class="text-neutral-500 text-[10px]">px</span>
    </div>

    <div class="w-px h-4 bg-neutral-800 shrink-0"></div>

    <!-- Brush Opacity -->
    <div class="flex items-center gap-1.5 shrink-0">
      <span class="text-neutral-400 text-[10px]">{locale.t("canvas.opacity") || "Opacity"}:</span>
      <input
        type="range"
        bind:value={canvas.brushSettings.opacity}
        min="0.01"
        max="1"
        step="0.01"
        class="w-16 accent-indigo-500 h-1.5 cursor-pointer"
      />
      <span class="text-[10px] font-mono tabular-nums text-neutral-200 w-8 text-right">
        {Math.round(canvas.brushSettings.opacity * 100)}%
      </span>
    </div>

    <div class="w-px h-4 bg-neutral-800 shrink-0"></div>

    <!-- Brush Hardness -->
    <div class="flex items-center gap-1.5 shrink-0">
      <span class="text-neutral-400 text-[10px]">{locale.t("canvas.brush_hardness") || "Hardness"}:</span>
      <input
        type="range"
        value={canvas.brushSettings.hardness ?? 0.8}
        oninput={(e) => canvas.setBrushHardness(parseFloat((e.target as HTMLInputElement).value))}
        min="0"
        max="1"
        step="0.05"
        class="w-16 accent-indigo-500 h-1.5 cursor-pointer"
      />
      <span class="text-[10px] font-mono tabular-nums text-neutral-200 w-8 text-right">
        {Math.round((canvas.brushSettings.hardness ?? 0.8) * 100)}%
      </span>
      <div class="flex items-center gap-0.5 ml-1">
        <button
          onclick={() => canvas.setBrushHardness(0.0)}
          class="px-1.5 py-0.5 rounded text-[9px] border border-neutral-700 hover:border-neutral-500 text-neutral-400 hover:text-neutral-200 transition-colors"
          title="Soft 0%"
        >0%</button>
        <button
          onclick={() => canvas.setBrushHardness(0.5)}
          class="px-1.5 py-0.5 rounded text-[9px] border border-neutral-700 hover:border-neutral-500 text-neutral-400 hover:text-neutral-200 transition-colors"
          title="Medium 50%"
        >50%</button>
        <button
          onclick={() => canvas.setBrushHardness(1.0)}
          class="px-1.5 py-0.5 rounded text-[9px] border border-neutral-700 hover:border-neutral-500 text-neutral-400 hover:text-neutral-200 transition-colors"
          title="Hard 100%"
        >100%</button>
      </div>
    </div>

  {:else}
    {#if canvas.activeTool === "eyedropper"}
    <!-- Eyedropper Inspector -->
    <span class="font-semibold text-neutral-200 uppercase tracking-wider text-[10px] mr-1 shrink-0">
      {locale.t("canvas.eyedropper") || "Eyedropper"}
    </span>

    <div class="w-px h-4 bg-neutral-800 shrink-0"></div>

    {#if canvas.sampledColor}
      <div class="flex items-center gap-2 shrink-0">
        <!-- Color Chip with alpha preview -->
        <div
          class="w-5 h-5 rounded border border-neutral-600 shadow-xs relative overflow-hidden"
          style="background-color: {canvas.sampledColor.hex};"
        ></div>

        <!-- Hex badge with copy -->
        <button
          onclick={() => canvas.sampledColor && copyHex(canvas.sampledColor.hex)}
          class="px-2 py-0.5 rounded border border-neutral-700 bg-neutral-900 font-mono text-[10px] text-neutral-200 hover:border-indigo-500 hover:text-white transition-colors cursor-pointer flex items-center gap-1"
          title="Click to copy HEX"
        >
          <span>{canvas.sampledColor.hex.toUpperCase()}</span>
          {#if copiedHex}
            <span class="text-emerald-400 text-[9px]">✓</span>
          {/if}
        </button>

        <!-- RGBA readout -->
        <div class="flex items-center gap-1.5 font-mono text-[10px] text-neutral-400">
          <span>R: <strong class="text-neutral-200">{canvas.sampledColor.r}</strong></span>
          <span>G: <strong class="text-neutral-200">{canvas.sampledColor.g}</strong></span>
          <span>B: <strong class="text-neutral-200">{canvas.sampledColor.b}</strong></span>
          <span>A: <strong class="text-neutral-200">{Math.round(canvas.sampledColor.a * 100)}%</strong></span>
        </div>
      </div>
    {:else}
      <span class="text-neutral-500 italic text-[10px]">Click or drag on the canvas to sample a color.</span>
    {/if}

  {:else}
    {#if canvas.activeTool === "transform"}
    <!-- Free Transform Inspector -->
    <span class="font-semibold text-neutral-200 uppercase tracking-wider text-[10px] mr-1 shrink-0">
      {locale.t("canvas.transform") || "Transform"}
    </span>

    <div class="w-px h-4 bg-neutral-800 shrink-0"></div>

    {#if canvas.activeTransformBounds}
      <div class="flex items-center gap-2 shrink-0">
        <label class="flex items-center gap-1 text-[10px] text-neutral-400 font-mono">
          X:
          <input
            type="number"
            value={canvas.activeTransformBounds.x}
            onchange={(e) => handleTransformBoundChange("x", parseFloat((e.target as HTMLInputElement).value) || 0)}
            class="w-12 bg-neutral-900 border border-neutral-700 rounded px-1 py-0.5 text-center text-[10px] text-neutral-200"
          />
        </label>
        <label class="flex items-center gap-1 text-[10px] text-neutral-400 font-mono">
          Y:
          <input
            type="number"
            value={canvas.activeTransformBounds.y}
            onchange={(e) => handleTransformBoundChange("y", parseFloat((e.target as HTMLInputElement).value) || 0)}
            class="w-12 bg-neutral-900 border border-neutral-700 rounded px-1 py-0.5 text-center text-[10px] text-neutral-200"
          />
        </label>
        <label class="flex items-center gap-1 text-[10px] text-neutral-400 font-mono">
          W:
          <input
            type="number"
            value={canvas.activeTransformBounds.width}
            onchange={(e) => handleTransformBoundChange("width", parseFloat((e.target as HTMLInputElement).value) || 1)}
            class="w-12 bg-neutral-900 border border-neutral-700 rounded px-1 py-0.5 text-center text-[10px] text-neutral-200"
          />
        </label>
        <label class="flex items-center gap-1 text-[10px] text-neutral-400 font-mono">
          H:
          <input
            type="number"
            value={canvas.activeTransformBounds.height}
            onchange={(e) => handleTransformBoundChange("height", parseFloat((e.target as HTMLInputElement).value) || 1)}
            class="w-12 bg-neutral-900 border border-neutral-700 rounded px-1 py-0.5 text-center text-[10px] text-neutral-200"
          />
        </label>
        <span class="text-[10px] text-neutral-400 font-mono">
          ∠ {canvas.activeTransformBounds.rotation}°
        </span>
      </div>
    {/if}

    <div class="flex items-center gap-1 ml-auto">
      <button
        onclick={() => canvas.commitTransform()}
        class="px-2 py-0.5 rounded bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-200 border border-emerald-500/40 text-[10px] font-medium transition-colors"
        title="Commit Transform (Enter)"
      >
        ✓ {locale.t("canvas.commit") || "Apply"}
      </button>
      <button
        onclick={() => canvas.cancelTransform()}
        class="px-2 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border border-neutral-700 text-[10px] font-medium transition-colors"
        title="Cancel Transform (Esc)"
      >
        ✕ {locale.t("canvas.cancel") || "Cancel"}
      </button>
    </div>

  {:else}
    {#if canvas.activeTool === "zoom" || canvas.activeTool === "view"}
    <!-- Zoom / Pan Inspector -->
    <span class="font-semibold text-neutral-200 uppercase tracking-wider text-[10px] mr-1 shrink-0">
      {canvas.activeTool === "zoom" ? locale.t("canvas.zoom_in") || "Zoom Tool" : locale.t("canvas.pan") || "Hand Tool"}
    </span>

    <div class="w-px h-4 bg-neutral-800 shrink-0"></div>

    <div class="flex items-center gap-1 bg-neutral-900 p-0.5 rounded border border-neutral-800 shrink-0">
      <button
        onclick={() => canvas.setZoomToolMode("in")}
        class="px-2 py-0.5 rounded text-[10px] {canvas.zoomToolMode === 'in' ? 'bg-indigo-600 text-white font-medium' : 'text-neutral-400 hover:text-neutral-200'}"
      >
        + Zoom In
      </button>
      <button
        onclick={() => canvas.setZoomToolMode("out")}
        class="px-2 py-0.5 rounded text-[10px] {canvas.zoomToolMode === 'out' ? 'bg-indigo-600 text-white font-medium' : 'text-neutral-400 hover:text-neutral-200'}"
      >
        - Zoom Out
      </button>
    </div>

    <div class="flex items-center gap-1.5 shrink-0 ml-1">
      <span class="text-neutral-400 text-[10px]">Level:</span>
      <span class="font-mono text-neutral-200 tabular-nums text-[10px]">{canvas.zoomPercent}%</span>
    </div>

    <div class="flex items-center gap-1 shrink-0 ml-1">
      <button
        onclick={() => canvas.resetZoom()}
        class="px-1.5 py-0.5 rounded border border-neutral-700 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 text-[10px] transition-colors"
      >
        100% (1:1)
      </button>
    </div>

  {:else}
    {#if canvas.activeTool === "rectFill"}
    <!-- Rectangular Marquee / Fill Inspector -->
    <span class="font-semibold text-neutral-200 uppercase tracking-wider text-[10px] mr-1 shrink-0">
      {locale.t("canvas.rectangle") || "Rectangle / Marquee"}
    </span>

    <div class="w-px h-4 bg-neutral-800 shrink-0"></div>

    <span class="text-neutral-400 text-[10px]">
      Click and drag on canvas to fill a rectangular area with foreground color.
    </span>

  {:else}
    <!-- Move / Lasso default options -->
    <span class="font-semibold text-neutral-200 uppercase tracking-wider text-[10px] mr-1 shrink-0">
      {canvas.activeTool === "move" ? locale.t("canvas.move") || "Move Tool" : locale.t("canvas.lasso") || "Lasso Tool"}
    </span>

    <div class="w-px h-4 bg-neutral-800 shrink-0"></div>

    <span class="text-neutral-400 text-[10px]">
      {canvas.activeTool === "move"
        ? "Drag on stage to move active layer content."
        : "Draw a freehand polygon on the canvas to fill."}
    </span>
  {/if}
  {/if}
  {/if}
  {/if}
  {/if}
</div>
