<script lang="ts">
  import { canvas, type CanvasLayerType } from "../../../stores/canvas.svelte.js";
  import { locale } from "../../../stores/locale.svelte.js";
  import LayerItem from "./LayerItem.svelte";

  type GroupKey = "raster" | "mask" | "controlnet" | "regional";

  let collapsed = $state<Record<GroupKey, boolean>>({
    raster: false,
    mask: false,
    controlnet: false,
    regional: false,
  });

  const rasterLayers = $derived(canvas.sortedLayers.filter((l) => l.type === "raster"));
  const maskLayers = $derived(canvas.sortedLayers.filter((l) => l.type === "mask"));
  const controlnetLayers = $derived(canvas.sortedLayers.filter((l) => l.type === "controlnet"));
  const regionalLayers = $derived(canvas.sortedLayers.filter((l) => l.type === "regional"));

  const activeType = $derived(canvas.activeLayer?.type ?? null);

  const groups = $derived([
    {
      key: "raster" as GroupKey,
      title: locale.t("canvas.raster_layers") || "Raster Layers",
      addTitle: locale.t("canvas.add_raster") || "Add Raster Layer",
      layers: rasterLayers,
      dotColor: "bg-sky-400",
    },
    {
      key: "mask" as GroupKey,
      title: locale.t("canvas.mask_layers") || "Mask Layers",
      addTitle: locale.t("canvas.add_mask") || "Add Mask Layer",
      layers: maskLayers,
      dotColor: "bg-rose-400",
    },
    {
      key: "controlnet" as GroupKey,
      title: locale.t("canvas.layer.type_controlnet") || "ControlNet Guidance",
      addTitle: locale.t("canvas.layer.add_controlnet") || "Add ControlNet Layer",
      layers: controlnetLayers,
      dotColor: "bg-violet-400",
    },
    {
      key: "regional" as GroupKey,
      title: locale.t("canvas.layer.type_regional") || "Regional Conditioning",
      addTitle: locale.t("canvas.layer.add_regional") || "Add Regional Layer",
      layers: regionalLayers,
      dotColor: "bg-emerald-400",
    },
  ]);

  function toggleGroup(key: GroupKey) {
    collapsed = { ...collapsed, [key]: !collapsed[key] };
  }

  function addToGroup(key: GroupKey) {
    canvas.addLayer(key);
    collapsed = { ...collapsed, [key]: false };
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

  <!-- Collapsible Groups (Mooshie UI standard) -->
  <div class="flex-1 overflow-y-auto space-y-2 min-h-[140px] pr-0.5">
    {#each groups as group (group.key)}
      <div class="rounded-lg border border-neutral-800/80 bg-neutral-900/30 overflow-hidden">
        <!-- Group header -->
        <div class="flex items-center gap-1 px-2 py-1.5 bg-neutral-900/60 hover:bg-neutral-800/40 transition-colors">
          <button
            onclick={() => toggleGroup(group.key)}
            class="flex-1 flex items-center gap-1.5 text-left cursor-pointer"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="w-3 h-3 shrink-0 text-neutral-500 transition-transform {collapsed[group.key] ? '' : 'rotate-90'}"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
            <span class="w-2 h-2 rounded-full {group.dotColor} shrink-0"></span>
            <span class="text-xs font-medium {activeType === group.key ? 'text-neutral-100 font-semibold' : 'text-neutral-400'}">
              {group.title}
            </span>
            <span class="px-1.5 rounded-full bg-neutral-800 text-[10px] text-neutral-400 tabular-nums">
              {group.layers.length}
            </span>
          </button>
          <button
            onclick={() => addToGroup(group.key)}
            class="w-5 h-5 flex items-center justify-center rounded text-neutral-500 hover:text-neutral-200 hover:bg-neutral-800 transition-colors"
            title={group.addTitle}
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
        </div>

        <!-- Group body -->
        {#if !collapsed[group.key]}
          <div class="p-1 space-y-1">
            {#if group.layers.length === 0}
              <p class="px-2 py-1.5 text-[10px] text-neutral-600 italic">{locale.t('canvas.no_layers') || 'No layers'}</p>
            {:else}
              {#each group.layers as layer (layer.id)}
                <LayerItem {layer} />
              {/each}
            {/if}
          </div>
        {/if}
      </div>
    {/each}
  </div>
</div>
