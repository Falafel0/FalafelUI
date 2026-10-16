<script lang="ts">
  import { canvas, type CanvasLayerType } from "../../../stores/canvas.svelte.js";
  import { locale } from "../../../stores/locale.svelte.js";
  import LayerItem from "./LayerItem.svelte";

  let draggedLayerId = $state<string | null>(null);
  let dragOverIndex = $state<number | null>(null);

  const rasterLayers = $derived(canvas.layers.filter((l) => l.type === "raster"));
  const sortedLayers = $derived(canvas.sortedLayers);

  function handleAddLayer(type: CanvasLayerType) {
    canvas.addLayer(type);
  }

  function handleDragStart(e: DragEvent, id: string) {
    draggedLayerId = id;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", id);
    }
  }

  function handleDragOver(e: DragEvent, index: number) {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "move";
    }
    dragOverIndex = index;
  }

  function handleDragLeave() {
    dragOverIndex = null;
  }

  function handleDrop(e: DragEvent, targetVisualIndex: number) {
    e.preventDefault();
    const sourceId = draggedLayerId || e.dataTransfer?.getData("text/plain");
    draggedLayerId = null;
    dragOverIndex = null;

    if (!sourceId) return;

    // In canvas.sortedLayers (descending by order):
    // visual index 0 is top-most (order = N-1)
    // visual index N-1 is bottom-most (order = 0)
    // So target order = (canvas.layers.length - 1) - targetVisualIndex
    const total = canvas.layers.length;
    const targetOrder = Math.max(0, Math.min(total - 1, total - 1 - targetVisualIndex));
    canvas.reorderLayer(sourceId, targetOrder);
  }
</script>

<div class="flex flex-col h-full space-y-2 select-none">
  <!-- Top Layer Actions Bar -->
  <div class="flex items-center justify-between pb-2 border-b border-neutral-800 text-[11px] text-neutral-400">
    <div class="flex items-center gap-1.5">
      <span class="font-semibold text-neutral-200">{locale.t("canvas.layers") || "Layers"}</span>
      <span class="px-1.5 py-0.2 rounded-full bg-neutral-800 text-[10px] text-neutral-400 font-medium tabular-nums">
        {canvas.layers.length}
      </span>
    </div>

    <!-- Quick action buttons -->
    <div class="flex items-center gap-1 bg-neutral-900/60 p-0.5 rounded-lg border border-neutral-800">
      <button
        onclick={() => canvas.duplicateActiveLayer()}
        disabled={!canvas.activeLayerId}
        class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-neutral-800/80 hover:bg-neutral-700 disabled:opacity-30 disabled:pointer-events-none text-neutral-300 hover:text-white transition-colors"
        title="{locale.t('canvas.duplicate') || 'Duplicate Layer'} (Ctrl+J)"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3 text-neutral-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
      </button>
      <button
        onclick={() => void canvas.mergeDownActiveLayer()}
        disabled={!canvas.activeLayerId || canvas.activeLayer?.type !== 'raster'}
        class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-neutral-800/80 hover:bg-neutral-700 disabled:opacity-30 disabled:pointer-events-none text-neutral-300 hover:text-white transition-colors"
        title="{locale.t('canvas.layer.merge_down') || 'Merge Down'} (Ctrl+E)"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3 text-neutral-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7 15 5 5 5-5"/><path d="M12 9v11"/><path d="M4 4h16"/></svg>
      </button>
      <button
        onclick={() => void canvas.flattenLayers()}
        disabled={rasterLayers.length <= 1}
        class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-neutral-800/80 hover:bg-neutral-700 disabled:opacity-30 disabled:pointer-events-none text-neutral-300 hover:text-white transition-colors"
        title="{locale.t('canvas.layer.flatten') || 'Flatten Layers'} (Ctrl+Shift+E)"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3 text-neutral-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2"/><path d="m9 12 2 2 4-4"/></svg>
      </button>
    </div>
  </div>

  <!-- Add Layer Type Selector Bar -->
  <div class="grid grid-cols-4 gap-1 p-1 rounded-lg bg-neutral-900/60 border border-neutral-800/80">
    <button
      onclick={() => handleAddLayer("raster")}
      class="flex items-center justify-center gap-1 py-1 px-1.5 rounded text-[10px] font-medium bg-neutral-800/60 hover:bg-sky-500/20 hover:text-sky-300 border border-transparent hover:border-sky-500/40 text-neutral-300 transition-colors"
      title={locale.t("canvas.add_raster") || "Add Raster Layer"}
    >
      <span class="w-2 h-2 rounded-full bg-sky-400"></span>
      <span>+Raster</span>
    </button>
    <button
      onclick={() => handleAddLayer("mask")}
      class="flex items-center justify-center gap-1 py-1 px-1.5 rounded text-[10px] font-medium bg-neutral-800/60 hover:bg-rose-500/20 hover:text-rose-300 border border-transparent hover:border-rose-500/40 text-neutral-300 transition-colors"
      title={locale.t("canvas.add_mask") || "Add Mask Layer"}
    >
      <span class="w-2 h-2 rounded-full bg-rose-400"></span>
      <span>+Mask</span>
    </button>
    <button
      onclick={() => handleAddLayer("regional")}
      class="flex items-center justify-center gap-1 py-1 px-1.5 rounded text-[10px] font-medium bg-neutral-800/60 hover:bg-emerald-500/20 hover:text-emerald-300 border border-transparent hover:border-emerald-500/40 text-neutral-300 transition-colors"
      title={locale.t("canvas.layer.add_regional") || "Add Regional Conditioning Layer"}
    >
      <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
      <span>+Region</span>
    </button>
    <button
      onclick={() => handleAddLayer("controlnet")}
      class="flex items-center justify-center gap-1 py-1 px-1.5 rounded text-[10px] font-medium bg-neutral-800/60 hover:bg-violet-500/20 hover:text-violet-300 border border-transparent hover:border-violet-500/40 text-neutral-300 transition-colors"
      title={locale.t("canvas.layer.add_controlnet") || "Add ControlNet Layer"}
    >
      <span class="w-2 h-2 rounded-full bg-violet-400"></span>
      <span>+CN</span>
    </button>
  </div>

  <!-- Unified Flat Layer Stack (Top = Highest Z-Index) -->
  <div class="flex-1 overflow-y-auto space-y-1 min-h-[140px] pr-0.5">
    {#if sortedLayers.length === 0}
      <div class="flex flex-col items-center justify-center h-28 text-neutral-500 text-xs italic">
        {locale.t("canvas.no_layers") || "No layers yet"}
      </div>
    {:else}
      {#each sortedLayers as layer, visualIdx (layer.id)}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          draggable={!layer.locked}
          ondragstart={(e) => handleDragStart(e, layer.id)}
          ondragover={(e) => handleDragOver(e, visualIdx)}
          ondragleave={handleDragLeave}
          ondrop={(e) => handleDrop(e, visualIdx)}
          class="relative transition-all"
        >
          {#if dragOverIndex === visualIdx}
            <div class="absolute -top-1 left-0 right-0 h-0.5 bg-indigo-500 z-10 rounded-full shadow-xs"></div>
          {/if}

          <LayerItem {layer} />
        </div>
      {/each}
    {/if}
  </div>
</div>
