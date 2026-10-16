<script lang="ts">
  import {
    canvas,
    type CanvasLayer,
    type CanvasBlendMode,
    CANVAS_BLEND_MODES,
  } from "../../../stores/canvas.svelte.js";
  import { locale } from "../../../stores/locale.svelte.js";

  interface Props {
    layer: CanvasLayer;
  }

  let { layer }: Props = $props();
  let isRenaming = $state(false);
  let renameValue = $state("");

  function startRename() {
    renameValue = layer.name;
    isRenaming = true;
  }

  function commitRename() {
    canvas.renameLayer(layer.id, renameValue);
    isRenaming = false;
  }

  function handleRenameKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") commitRename();
    if (e.key === "Escape") isRenaming = false;
  }

  const isActive = $derived(canvas.activeLayerId === layer.id);
  const thumb = $derived(canvas.layerThumbnails[layer.id]);

  // Last raster layer cannot be deleted per [T1-F01-09]
  const isLastRaster = $derived(
    layer.type === "raster" && canvas.layers.filter((l) => l.type === "raster").length <= 1
  );
  const canDelete = $derived(!isLastRaster && canvas.layers.length > 1);

  // Badge styles per layer type
  const typeBadge = $derived.by(() => {
    switch (layer.type) {
      case "raster":
        return { label: "R", color: "bg-sky-500/20 text-sky-400 border-sky-500/40", title: "Raster Layer" };
      case "mask":
        return { label: "M", color: "bg-rose-500/20 text-rose-400 border-rose-500/40", title: "Mask Layer" };
      case "regional":
        return { label: "REG", color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/40", title: "Regional Conditioning" };
      case "controlnet":
        return { label: "CN", color: "bg-violet-500/20 text-violet-400 border-violet-500/40", title: "ControlNet Guidance" };
    }
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="group rounded-md transition-colors cursor-pointer border {isActive
    ? 'bg-neutral-800/80 border-indigo-500/60 shadow-xs'
    : 'bg-neutral-900/60 hover:bg-neutral-800/40 border-neutral-800/80'}"
  onclick={() => canvas.setActiveLayer(layer.id)}
  ondblclick={startRename}
>
  <div class="flex items-center gap-2 px-2 py-1.5">
    <!-- Visibility toggle (eye icon) -->
    <button
      onclick={(e) => { e.stopPropagation(); canvas.toggleLayerVisibility(layer.id); }}
      class="shrink-0 w-5 h-5 flex items-center justify-center rounded hover:bg-neutral-700/70 transition-colors {layer.visible ? 'text-indigo-400' : 'text-neutral-600'}"
      title={layer.visible ? locale.t('canvas.hide_layer') || 'Hide layer' : locale.t('canvas.show_layer') || 'Show layer'}
    >
      <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        {#if layer.visible}
          <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/>
          <circle cx="12" cy="12" r="3"/>
        {:else}
          <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/>
          <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/>
          <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/>
          <line x1="2" y1="2" x2="22" y2="22"/>
        {/if}
      </svg>
    </button>

    <!-- Thumbnail or Layer Type Visual Icon -->
    <div
      class="relative shrink-0 w-8 h-8 rounded overflow-hidden border border-neutral-700/60 shadow-xs flex items-center justify-center bg-neutral-950"
      style="background-image:linear-gradient(45deg,#262626 25%,transparent 25%),linear-gradient(-45deg,#262626 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#262626 75%),linear-gradient(-45deg,transparent 75%,#262626 75%);background-size:8px 8px;background-position:0 0,0 4px,4px -4px,-4px 0;"
    >
      {#if thumb}
        <img src={thumb} alt="" class="absolute inset-0 w-full h-full object-contain" />
      {:else}
        {#if layer.type === "regional"}
          <span class="text-xs">📍</span>
        {:else}
          {#if layer.type === "controlnet"}
            <span class="text-xs">🎮</span>
          {:else}
            {#if layer.type === "mask"}
              <span class="text-xs">🎭</span>
            {:else}
              <span class="text-xs">🖼️</span>
            {/if}
          {/if}
        {/if}
      {/if}
    </div>

    <!-- Type Badge -->
    <span
      class="px-1 py-0.2 rounded border text-[9px] font-mono font-bold shrink-0 {typeBadge.color}"
      title={typeBadge.title}
    >
      {typeBadge.label}
    </span>

    <!-- Name / Renaming Input -->
    <div class="flex-1 min-w-0">
      {#if isRenaming}
        <!-- svelte-ignore a11y_autofocus -->
        <input
          type="text"
          bind:value={renameValue}
          onblur={commitRename}
          onkeydown={handleRenameKeydown}
          onclick={(e) => e.stopPropagation()}
          class="w-full bg-neutral-900 border border-indigo-500 rounded px-1.5 py-0.5 text-xs text-neutral-100 outline-none"
          autofocus
        />
      {:else}
        <span class="block truncate text-xs font-medium {isActive ? 'text-neutral-100 font-semibold' : 'text-neutral-400'}">
          {layer.name}
        </span>
      {/if}
    </div>

    <!-- Row Actions (shown on hover or when active) -->
    <div class="{isActive ? 'flex' : 'hidden group-hover:flex'} items-center gap-0.5 shrink-0">
      <button
        onclick={(e) => { e.stopPropagation(); canvas.reorderLayer(layer.id, 'up'); }}
        class="w-5 h-5 flex items-center justify-center rounded text-neutral-400 hover:text-neutral-100 hover:bg-neutral-700 transition-colors"
        title={locale.t('canvas.move_up_title') || 'Move Up'}
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
      </button>
      <button
        onclick={(e) => { e.stopPropagation(); canvas.reorderLayer(layer.id, 'down'); }}
        class="w-5 h-5 flex items-center justify-center rounded text-neutral-400 hover:text-neutral-100 hover:bg-neutral-700 transition-colors"
        title={locale.t('canvas.move_down_title') || 'Move Down'}
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <button
        onclick={(e) => { e.stopPropagation(); canvas.duplicateLayer(layer.id); }}
        class="w-5 h-5 flex items-center justify-center rounded text-neutral-400 hover:text-neutral-100 hover:bg-neutral-700 transition-colors"
        title={locale.t('canvas.duplicate') || 'Duplicate'}
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
      </button>
      <button
        onclick={(e) => { e.stopPropagation(); if (canDelete) canvas.removeLayer(layer.id); }}
        class="w-5 h-5 flex items-center justify-center rounded transition-colors {canDelete ? 'text-neutral-400 hover:text-rose-400 hover:bg-neutral-700' : 'text-neutral-700 cursor-not-allowed opacity-30'}"
        title={isLastRaster ? "Cannot delete the last raster layer" : (locale.t('canvas.delete_layer') || 'Delete')}
        disabled={!canDelete}
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      </button>
    </div>

    <!-- Lock toggle -->
    <button
      onclick={(e) => { e.stopPropagation(); canvas.toggleLayerLock(layer.id); }}
      class="shrink-0 w-5 h-5 flex items-center justify-center rounded hover:bg-neutral-700/70 transition-colors {layer.locked ? 'text-amber-400' : 'text-neutral-600'}"
      title={layer.locked ? locale.t('canvas.unlock_layer') || 'Unlock' : locale.t('canvas.lock_layer') || 'Lock'}
    >
      <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        {#if layer.locked}
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        {:else}
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>
        {/if}
      </svg>
    </button>
  </div>

  <!-- Active Layer Quick Controls (Blend mode, Opacity) -->
  {#if isActive}
    <div
      class="flex items-center gap-2 px-2.5 py-1 border-t border-neutral-700/40 bg-neutral-950/60"
      onclick={(e) => e.stopPropagation()}
    >
      {#if layer.type === "raster"}
        <select
          value={layer.blendMode ?? 'normal'}
          onchange={(e) => canvas.setLayerBlendMode(layer.id, (e.target as HTMLSelectElement).value as CanvasBlendMode)}
          class="bg-neutral-900 text-[10px] font-medium text-neutral-200 rounded border border-neutral-700 px-1 py-0.5 outline-none focus:border-indigo-500 cursor-pointer"
          title="Blend Mode"
        >
          {#each CANVAS_BLEND_MODES as mode}
            <option value={mode}>{mode.charAt(0).toUpperCase() + mode.slice(1)}</option>
          {/each}
        </select>
      {/if}

      <span class="text-[10px] text-neutral-400 shrink-0">{locale.t('canvas.opacity') || 'Opacity'}:</span>
      <input
        type="range"
        value={layer.opacity}
        oninput={(e) => canvas.setLayerOpacity(layer.id, parseFloat((e.target as HTMLInputElement).value))}
        min="0"
        max="1"
        step="0.05"
        class="flex-1 accent-indigo-500 h-1.5 cursor-pointer"
      />
      <span class="text-[10px] text-neutral-300 font-mono tabular-nums shrink-0 w-8 text-right">
        {Math.round(layer.opacity * 100)}%
      </span>
    </div>
  {/if}
</div>
