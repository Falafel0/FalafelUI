<script lang="ts">
  import { canvas } from "../../../stores/canvas.svelte.js";
  import { locale } from "../../../stores/locale.svelte.js";

  const FILL_MODES = [
    { value: 0, label: "Fill" },
    { value: 1, label: "Original" },
    { value: 2, label: "Latent Noise" },
    { value: 3, label: "Latent Nothing" },
  ];
</script>

<div class="flex flex-col space-y-3 p-3 bg-neutral-900/60 rounded-xl border border-neutral-800 text-xs text-neutral-300 select-none">
  <!-- Header -->
  <div class="flex items-center justify-between pb-2 border-b border-neutral-800">
    <div class="flex items-center gap-1.5 font-semibold text-neutral-200">
      <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5 text-rose-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/></svg>
      <span>{locale.t("generation.inpaint.inspector_title") || "Inpainting & Mask Pipeline"}</span>
    </div>
    {#if canvas.inpaintBaseHistory.length > 0}
      <span class="px-1.5 py-0.2 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30 text-[10px] font-mono">
        Pass {canvas.inpaintBaseHistory.length}
      </span>
    {/if}
  </div>

  <!-- Crop and Stitch (Only Masked vs Whole Picture) -->
  <div class="space-y-2">
    <div class="flex items-center justify-between">
      <div>
        <span class="font-medium text-neutral-200 block text-[11px]">{locale.t("generation.inpaint.crop_stitch") || "Crop & Stitch (Only Masked)"}</span>
        <span class="text-neutral-500 text-[10px]">Crops bounding region, upscales for detail, then stitches back</span>
      </div>
      <input
        type="checkbox"
        bind:checked={canvas.inpaintFullRes}
        class="w-4 h-4 rounded accent-indigo-500 cursor-pointer"
      />
    </div>

    {#if canvas.inpaintFullRes}
      <div class="p-2 rounded bg-neutral-900 border border-neutral-800 space-y-2">
        <div class="flex items-center justify-between">
          <span class="text-neutral-400 text-[11px]">{locale.t("generation.inpaint.padding") || "Padding"}</span>
          <div class="flex items-center gap-2 flex-1 max-w-[160px]">
            <input
              type="range"
              bind:value={canvas.inpaintFullResPadding}
              min="0"
              max="256"
              step="8"
              class="flex-1 accent-indigo-500 h-1.5 cursor-pointer"
            />
            <span class="font-mono text-neutral-300 w-8 text-right tabular-nums text-[11px]">
              {canvas.inpaintFullResPadding}px
            </span>
          </div>
        </div>
      </div>
    {/if}
  </div>

  <!-- Mask Blur & Feathering -->
  <div class="flex items-center justify-between">
    <span class="text-neutral-400">{locale.t("generation.inpaint.mask_blur") || "Mask Blur"}</span>
    <div class="flex items-center gap-2 flex-1 max-w-[160px]">
      <input
        type="range"
        bind:value={canvas.maskBlur}
        min="0"
        max="64"
        step="1"
        class="flex-1 accent-indigo-500 h-1.5 cursor-pointer"
      />
      <span class="font-mono text-neutral-300 w-8 text-right tabular-nums text-[11px]">
        {canvas.maskBlur}px
      </span>
    </div>
  </div>

  <!-- Mask Invert -->
  <div class="flex items-center justify-between">
    <span class="text-neutral-400">{locale.t("canvas.invert_mask") || "Invert Mask"}</span>
    <button
      onclick={() => canvas.inpaintMaskInvert = !canvas.inpaintMaskInvert}
      class="px-2 py-0.5 rounded border text-[10px] font-medium transition-colors {canvas.inpaintMaskInvert
        ? 'bg-indigo-600/30 border-indigo-500/60 text-indigo-300'
        : 'bg-neutral-800 border-neutral-700 text-neutral-400 hover:text-neutral-200'}"
    >
      {canvas.inpaintMaskInvert ? "Inverted (Black)" : "Standard (White)"}
    </button>
  </div>

  <!-- Masked Content Fill Mode -->
  <div class="flex items-center justify-between">
    <span class="text-neutral-400">{locale.t("generation.inpaint.masked_content") || "Masked Content"}</span>
    <select
      bind:value={canvas.inpaintingFill}
      class="bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-neutral-200 text-[11px] outline-none focus:border-indigo-500 cursor-pointer"
    >
      {#each FILL_MODES as mode}
        <option value={mode.value}>{mode.label}</option>
      {/each}
    </select>
  </div>

  <!-- Inpaint Chain History Actions -->
  {#if canvas.canUndoInpaintBase || canvas.canApplyInpaintResult}
    <div class="pt-2 border-t border-neutral-800 space-y-1.5">
      <span class="text-[10px] uppercase font-bold text-neutral-400 tracking-wider">Iterative Chain Actions</span>
      <div class="grid grid-cols-2 gap-1.5">
        {#if canvas.canUndoInpaintBase}
          <button
            onclick={() => canvas.undoInpaintBase()}
            class="py-1 px-2 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-neutral-200 text-[10px] font-medium transition-colors flex items-center justify-center gap-1"
          >
            <span>↶ Step Back Base</span>
          </button>
        {/if}
        {#if canvas.canApplyInpaintResult}
          <button
            onclick={() => canvas.applyInpaintResult()}
            class="py-1 px-2 rounded bg-emerald-600/30 hover:bg-emerald-600/50 border border-emerald-500/50 text-emerald-200 text-[10px] font-medium transition-colors flex items-center justify-center gap-1"
          >
            <span>✓ Apply to Base</span>
          </button>
        {/if}
      </div>
    </div>
  {/if}
</div>
