<script lang="ts">
  import { canvas } from "../../../stores/canvas.svelte.js";
  import { locale } from "../../../stores/locale.svelte.js";
  import LayerItem from "./LayerItem.svelte";

  type GroupKey = "mask" | "raster";

  let collapsed = $state<Record<GroupKey, boolean>>({ mask: false, raster: false });

  const maskLayers = $derived(canvas.sortedLayers.filter((l) => l.type === "mask"));
  const rasterLayers = $derived(canvas.sortedLayers.filter((l) => l.type === "raster"));
  const activeType = $derived(canvas.activeLayer?.type ?? null);

  const groups = $derived([
    { key: "mask" as GroupKey, titleKey: "canvas.mask_layers", addKey: "canvas.add_mask", layers: maskLayers },
    { key: "raster" as GroupKey, titleKey: "canvas.raster_layers", addKey: "canvas.add_raster", layers: rasterLayers },
  ]);

  function toggleGroup(key: GroupKey) {
    collapsed = { ...collapsed, [key]: !collapsed[key] };
  }

  function addToGroup(key: GroupKey) {
    canvas.addLayer(key);
    // Adding a layer should reveal it, so make sure the group is open.
    collapsed = { ...collapsed, [key]: false };
  }

  function handleSendToMask() {
    canvas.sendActiveLayerToMask();
  }

  const activeIsRaster = $derived(canvas.activeLayer?.type === "raster" && !canvas.activeLayer?.locked);
</script>

<div class="space-y-2">
  <!-- Top Layer Actions Bar -->
  <div class="flex items-center justify-between pb-2 border-b border-neutral-800 text-[11px] text-neutral-400">
    <span class="font-semibold text-neutral-200">{locale.t("canvas.layers")}</span>
    <div class="flex items-center gap-1 bg-neutral-900/60 p-0.5 rounded-lg border border-neutral-800">
      <button
        onclick={() => canvas.duplicateActiveLayer()}
        disabled={!canvas.activeLayerId}
        class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-neutral-800/80 hover:bg-neutral-700 disabled:opacity-30 disabled:pointer-events-none text-neutral-300 hover:text-white transition-colors"
        title={locale.t("canvas.layer.duplicate")}
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3 text-neutral-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        <span>Ctrl+J</span>
      </button>
      <button
        onclick={() => void canvas.mergeDownActiveLayer()}
        disabled={!canvas.activeLayerId || canvas.activeLayer?.type !== 'raster'}
        class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-neutral-800/80 hover:bg-neutral-700 disabled:opacity-30 disabled:pointer-events-none text-neutral-300 hover:text-white transition-colors"
        title={locale.t("canvas.layer.merge_down")}
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3 text-neutral-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7 15 5 5 5-5"/><path d="M12 9v11"/><path d="M4 4h16"/></svg>
        <span>Ctrl+E</span>
      </button>
      <button
        onclick={() => void canvas.flattenLayers()}
        disabled={rasterLayers.length <= 1}
        class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-neutral-800/80 hover:bg-neutral-700 disabled:opacity-30 disabled:pointer-events-none text-neutral-300 hover:text-white transition-colors"
        title={locale.t("canvas.layer.flatten")}
      >
        <span>Ctrl+Shift+E</span>
      </button>
    </div>
  </div>

  {#each groups as group (group.key)}
    <div>
      <!-- Group header -->
      <div class="flex items-center gap-1 py-0.5">
        <button
          onclick={() => toggleGroup(group.key)}
          class="flex-1 flex items-center gap-1.5 py-1 text-left select-none group/title"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="w-3 h-3 shrink-0 text-neutral-500 group-hover/title:text-neutral-300 transition-transform {collapsed[group.key] ? '' : 'rotate-90'}"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
          <span class="text-xs font-semibold {activeType === group.key ? 'text-neutral-200' : 'text-neutral-400 group-hover/title:text-neutral-300'}">
            {locale.t(group.titleKey)}
          </span>
          <span class="px-1.5 py-0.2 rounded-full bg-neutral-800 text-[10px] text-neutral-400 font-medium tabular-nums">
            {group.layers.length}
          </span>
        </button>
        {#if group.key === "mask" && group.layers.length > 0}
          <button
            onclick={() => canvas.invertMask()}
            class="w-6 h-6 flex items-center justify-center rounded-md text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors cursor-pointer"
            title={locale.t("canvas.invert_mask")}
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <path d="M12 2a10 10 0 0 1 0 20Z" fill="currentColor"/>
            </svg>
          </button>
          <button
            onclick={() => canvas.clearMask()}
            class="w-6 h-6 flex items-center justify-center rounded-md text-neutral-400 hover:text-red-400 hover:bg-neutral-800 transition-colors cursor-pointer"
            title={locale.t("canvas.clear")}
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        {/if}
        <button
          onclick={() => addToGroup(group.key)}
          class="w-6 h-6 flex items-center justify-center rounded-md text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 transition-colors"
          title={locale.t(group.addKey)}
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
        {#if group.key === "raster" && activeIsRaster}
          <button
            onclick={handleSendToMask}
            class="w-6 h-6 flex items-center justify-center rounded-md text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/10 transition-colors"
            title={locale.t('canvas.send_to_mask')}
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/></svg>
          </button>
        {/if}
      </div>

      <!-- Group body -->
      {#if !collapsed[group.key]}
        <div class="space-y-0.5 mt-1">
          {#if group.layers.length === 0}
            <p class="px-2 py-1.5 text-[10px] text-neutral-600 italic">{locale.t('canvas.no_layers')}</p>
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
