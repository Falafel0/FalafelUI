<script lang="ts">
  import {
    canvas,
    type CanvasLayer,
    type CanvasBlendMode,
    CANVAS_BLEND_MODES,
    isRasterLayer,
    isMaskLayer,
    isRegionalLayer,
    isControlNetLayer,
  } from "../../../stores/canvas.svelte.js";
  import { locale } from "../../../stores/locale.svelte.js";
  import { models } from "../../../stores/models.svelte.js";

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
    if (renameValue.trim()) {
      canvas.renameLayer(layer.id, renameValue.trim());
    }
    isRenaming = false;
  }

  function handleRenameKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") commitRename();
    if (e.key === "Escape") isRenaming = false;
  }

  const isActive = $derived(canvas.activeLayerId === layer.id);
  const thumb = $derived(canvas.layerThumbnails[layer.id]);

  const isLastRaster = $derived(
    layer.type === "raster" && canvas.layers.filter((l) => l.type === "raster").length <= 1,
  );
  const canDelete = $derived(!isLastRaster && canvas.layers.length > 1);

  const PREPROCESSORS = [
    "none",
    "canny",
    "depth",
    "openpose",
    "lineart",
    "softedge",
    "scribble",
    "seg",
  ];
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="group rounded-md transition-colors cursor-pointer border
    {isActive
      ? 'bg-neutral-800/70 border-indigo-500/60 ring-1 ring-inset ring-indigo-500/50 shadow-xs'
      : 'bg-neutral-900/40 hover:bg-neutral-800/40 border-neutral-800/80 ring-1 ring-inset ring-transparent'}"
  onclick={() => canvas.setActiveLayer(layer.id)}
  ondblclick={startRename}
>
  <div class="flex items-center gap-2 px-1.5 py-1.5">
    <!-- Circular Visibility toggle (filled circle when visible, hollow when hidden) -->
    <button
      onclick={(e) => { e.stopPropagation(); canvas.toggleLayerVisibility(layer.id); }}
      class="shrink-0 w-5 h-5 flex items-center justify-center rounded hover:bg-neutral-700 {layer.visible ? 'text-indigo-400' : 'text-neutral-600'}"
      title={layer.visible ? (locale.t('canvas.hide_layer') || 'Hide Layer') : (locale.t('canvas.show_layer') || 'Show Layer')}
    >
      <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        {#if layer.visible}
          <circle cx="12" cy="12" r="6" fill="currentColor" stroke="none" />
        {:else}
          <circle cx="12" cy="12" r="6" fill="none" />
        {/if}
      </svg>
    </button>

    <!-- Checkerboard Pixel Thumbnail -->
    <div
      class="relative shrink-0 w-9 h-9 rounded overflow-hidden border border-neutral-700/60 flex items-center justify-center"
      style="background-color:#262626;background-image:linear-gradient(45deg,#333 25%,transparent 25%),linear-gradient(-45deg,#333 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#333 75%),linear-gradient(-45deg,transparent 75%,#333 75%);background-size:8px 8px;background-position:0 0,0 4px,4px -4px,-4px 0;"
    >
      {#if thumb}
        <img src={thumb} alt="" class="absolute inset-0 w-full h-full object-contain" />
      {:else}
        {#if layer.type === "raster"}
          <span class="text-xs opacity-50">🖼</span>
        {:else if layer.type === "mask"}
          <span class="text-xs opacity-50">🎭</span>
        {:else if layer.type === "controlnet"}
          <span class="text-xs opacity-50">🎮</span>
        {:else if layer.type === "regional"}
          <span class="text-xs opacity-50">📍</span>
        {/if}
      {/if}
    </div>

    <!-- Name / Inline rename input -->
    <div class="flex-1 min-w-0">
      {#if isRenaming}
        <!-- svelte-ignore a11y_autofocus -->
        <input
          type="text"
          bind:value={renameValue}
          onblur={commitRename}
          onkeydown={handleRenameKeydown}
          onclick={(e) => e.stopPropagation()}
          class="w-full bg-neutral-800 border border-indigo-500 rounded px-1 py-0.5 text-xs text-neutral-200 outline-none focus:border-indigo-400"
          autofocus
        />
      {:else}
        <span class="block truncate text-xs {isActive ? 'text-neutral-200 font-medium' : 'text-neutral-400'}">
          {layer.name}
        </span>
      {/if}
    </div>

    <!-- Per-row actions (shown on hover, always on the active row) -->
    <div class="{isActive ? 'flex' : 'hidden group-hover:flex'} items-center gap-0.5 shrink-0">
      <button
        onclick={(e) => { e.stopPropagation(); canvas.reorderLayer(layer.id, 'up'); }}
        class="w-5 h-5 flex items-center justify-center rounded text-neutral-500 hover:text-neutral-200 hover:bg-neutral-700 transition-colors"
        title={locale.t('canvas.move_up_title') || 'Move Up'}
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
      </button>
      <button
        onclick={(e) => { e.stopPropagation(); canvas.reorderLayer(layer.id, 'down'); }}
        class="w-5 h-5 flex items-center justify-center rounded text-neutral-500 hover:text-neutral-200 hover:bg-neutral-700 transition-colors"
        title={locale.t('canvas.move_down_title') || 'Move Down'}
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <button
        onclick={(e) => { e.stopPropagation(); canvas.duplicateLayer(layer.id); }}
        class="w-5 h-5 flex items-center justify-center rounded text-neutral-500 hover:text-neutral-200 hover:bg-neutral-700 transition-colors"
        title="{locale.t('canvas.duplicate') || 'Duplicate Layer'} (Ctrl+J)"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
      </button>
      <button
        onclick={(e) => { e.stopPropagation(); if (canDelete) canvas.removeLayer(layer.id); }}
        class="w-5 h-5 flex items-center justify-center rounded text-neutral-500 hover:text-red-400 hover:bg-neutral-700 transition-colors {canDelete ? '' : 'opacity-40 cursor-not-allowed'}"
        title={locale.t('canvas.delete_layer') || 'Delete Layer'}
        disabled={!canDelete}
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      </button>
    </div>

    <!-- Lock toggle -->
    <button
      onclick={(e) => { e.stopPropagation(); canvas.toggleLayerLock(layer.id); }}
      class="shrink-0 w-5 h-5 flex items-center justify-center rounded hover:bg-neutral-700 {layer.locked ? 'text-indigo-400' : 'text-neutral-600'}"
      title={layer.locked ? (locale.t('canvas.unlock_layer') || 'Unlock Layer') : (locale.t('canvas.lock_layer') || 'Lock Layer')}
    >
      <svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        {#if layer.locked}
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        {:else}
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>
        {/if}
      </svg>
    </button>
  </div>

  <!-- CONTEXTUAL SETTINGS FOR ACTIVE LAYER (Embedded directly in the selected layer!) -->
  {#if isActive}
    <div
      class="px-2.5 py-2 border-t border-neutral-700/60 bg-neutral-900/60 space-y-2 text-[11px] text-neutral-300"
      onclick={(e) => e.stopPropagation()}
    >
      <!-- Opacity row (All layers) -->
      <div class="flex items-center gap-2">
        <span class="text-[10px] text-neutral-400 shrink-0 w-12">{locale.t('canvas.opacity') || 'Opacity'}</span>
        <input
          type="range"
          value={layer.opacity}
          oninput={(e) => canvas.setLayerOpacity(layer.id, parseFloat((e.target as HTMLInputElement).value))}
          min="0"
          max="1"
          step="0.05"
          class="flex-1 accent-indigo-500 h-1.5 cursor-pointer"
        />
        <span class="font-mono text-neutral-400 tabular-nums shrink-0 w-8 text-right text-[10px]">
          {Math.round(layer.opacity * 100)}%
        </span>
      </div>

      <!-- TYPE-SPECIFIC CONTEXTUAL SETTINGS -->
      {#if isRasterLayer(layer)}
        <!-- Raster Settings -->
        <div class="pt-1.5 border-t border-neutral-800/80 space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-[10px] text-neutral-400">Blend Mode</span>
            <select
              value={layer.blendMode ?? "normal"}
              onchange={(e) => canvas.setLayerBlendMode(layer.id, (e.target as HTMLSelectElement).value as CanvasBlendMode)}
              class="bg-neutral-950 border border-neutral-700 rounded px-1.5 py-0.5 text-neutral-200 text-[10px] outline-none focus:border-indigo-500 cursor-pointer"
            >
              {#each CANVAS_BLEND_MODES as mode}
                <option value={mode}>{mode.charAt(0).toUpperCase() + mode.slice(1)}</option>
              {/each}
            </select>
          </div>

          <div class="flex items-center justify-between">
            <span class="text-[10px] text-neutral-400">{locale.t('canvas.layer.denoise') || 'Denoise'}</span>
            <div class="flex items-center gap-2 flex-1 max-w-[140px]">
              <input
                type="range"
                value={layer.denoise ?? 1.0}
                oninput={(e) => canvas.setLayerDenoise(layer.id, parseFloat((e.target as HTMLInputElement).value))}
                min="0.05"
                max="1.0"
                step="0.01"
                class="flex-1 accent-indigo-500 h-1.5 cursor-pointer"
              />
              <span class="font-mono text-neutral-400 w-7 text-right tabular-nums text-[10px]">
                {(layer.denoise ?? 1.0).toFixed(2)}
              </span>
            </div>
          </div>

          <div class="pt-1 flex items-center gap-1.5">
            <button
              onclick={() => canvas.sendActiveLayerToMask()}
              class="flex-1 py-1 px-1.5 rounded bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/40 text-indigo-300 text-[10px] font-medium transition-colors"
            >
              {locale.t('canvas.send_to_mask') || 'Send to Mask'}
            </button>
          </div>
        </div>

      {:else if isMaskLayer(layer)}
        <!-- Mask Settings -->
        <div class="pt-1.5 border-t border-neutral-800/80 space-y-2">
          <div class="flex items-center gap-1.5">
            <button
              onclick={() => canvas.invertMask()}
              class="flex-1 py-1 px-1.5 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-neutral-200 text-[10px] font-medium transition-colors"
            >
              {locale.t('canvas.invert_mask') || 'Invert Mask'}
            </button>
            <button
              onclick={() => canvas.clearMask()}
              class="py-1 px-2 rounded bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/40 text-rose-300 text-[10px] font-medium transition-colors"
            >
              {locale.t('canvas.clear_mask') || 'Clear'}
            </button>
          </div>

          <div class="flex items-center justify-between">
            <span class="text-[10px] text-neutral-400">Mask Blur</span>
            <div class="flex items-center gap-2 flex-1 max-w-[140px]">
              <input
                type="range"
                value={layer.maskBlur ?? 0}
                oninput={(e) => canvas.setMaskProps(layer.id, { maskBlur: parseInt((e.target as HTMLInputElement).value, 10) })}
                min="0"
                max="64"
                step="1"
                class="flex-1 accent-indigo-500 h-1.5 cursor-pointer"
              />
              <span class="font-mono text-neutral-400 w-7 text-right tabular-nums text-[10px]">
                {layer.maskBlur ?? 0}px
              </span>
            </div>
          </div>

          <div class="flex items-center justify-between">
            <span class="text-[10px] text-neutral-400">{locale.t('canvas.layer.denoise') || 'Denoise'}</span>
            <div class="flex items-center gap-2 flex-1 max-w-[140px]">
              <input
                type="range"
                value={layer.denoise ?? 0.7}
                oninput={(e) => canvas.setLayerDenoise(layer.id, parseFloat((e.target as HTMLInputElement).value))}
                min="0.05"
                max="1.0"
                step="0.01"
                class="flex-1 accent-indigo-500 h-1.5 cursor-pointer"
              />
              <span class="font-mono text-neutral-400 w-7 text-right tabular-nums text-[10px]">
                {(layer.denoise ?? 0.7).toFixed(2)}
              </span>
            </div>
          </div>

          <div>
            <span class="text-[10px] text-neutral-400 block mb-1">Mask Prompt Override</span>
            <input
              type="text"
              value={layer.prompt ?? ""}
              oninput={(e) => canvas.setLayerPrompt(layer.id, (e.target as HTMLInputElement).value)}
              placeholder="Optional prompt override for this mask..."
              class="w-full bg-neutral-950 border border-neutral-700 rounded px-1.5 py-0.5 text-neutral-200 text-[10px] outline-none focus:border-indigo-500"
            />
          </div>
        </div>

      {:else if isControlNetLayer(layer)}
        <!-- ControlNet Guidance Settings -->
        <div class="pt-1.5 border-t border-neutral-800/80 space-y-2">
          <div>
            <span class="text-[10px] text-neutral-400 block mb-1">{locale.t("canvas.layer.controlnet_model") || "ControlNet Model"}</span>
            {#if models.controlnetModels.length > 0}
              <select
                value={layer.model}
                onchange={(e) => canvas.setControlNetProps(layer.id, { model: (e.target as HTMLSelectElement).value })}
                class="w-full bg-neutral-950 border border-neutral-700 rounded px-1.5 py-0.5 text-neutral-200 text-[10px] outline-none focus:border-violet-500 cursor-pointer font-mono"
              >
                <option value="">-- Select Model --</option>
                {#each models.controlnetModels as m}
                  <option value={m}>{m}</option>
                {/each}
              </select>
            {:else}
              <input
                type="text"
                value={layer.model}
                onchange={(e) => canvas.setControlNetProps(layer.id, { model: (e.target as HTMLInputElement).value })}
                placeholder="e.g. control_v11p_sd15_canny.pth"
                class="w-full bg-neutral-950 border border-neutral-700 rounded px-1.5 py-0.5 text-neutral-200 text-[10px] outline-none focus:border-violet-500 font-mono"
              />
            {/if}
          </div>

          <div class="flex items-center justify-between">
            <span class="text-[10px] text-neutral-400">{locale.t("canvas.layer.controlnet_preprocessor") || "Preprocessor"}</span>
            <select
              value={layer.preprocessor}
              onchange={(e) => canvas.setControlNetProps(layer.id, { preprocessor: (e.target as HTMLSelectElement).value })}
              class="bg-neutral-950 border border-neutral-700 rounded px-1.5 py-0.5 text-neutral-200 text-[10px] outline-none focus:border-violet-500 cursor-pointer"
            >
              {#each PREPROCESSORS as p}
                <option value={p}>{p}</option>
              {/each}
            </select>
          </div>

          <div class="flex items-center justify-between">
            <span class="text-[10px] text-neutral-400">{locale.t("canvas.layer.controlnet_strength") || "Strength"}</span>
            <div class="flex items-center gap-2 flex-1 max-w-[140px]">
              <input
                type="range"
                value={layer.strength}
                oninput={(e) => canvas.setControlNetProps(layer.id, { strength: parseFloat((e.target as HTMLInputElement).value) })}
                min="0"
                max="2"
                step="0.05"
                class="flex-1 accent-violet-500 h-1.5 cursor-pointer"
              />
              <span class="font-mono text-neutral-400 w-7 text-right tabular-nums text-[10px]">
                {layer.strength.toFixed(2)}
              </span>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-1.5">
            <label class="flex items-center justify-between gap-1 text-neutral-400 bg-neutral-950 p-1 rounded border border-neutral-800 text-[9px]">
              <span>Start:</span>
              <input
                type="number"
                step="0.05"
                min="0"
                max="1"
                value={layer.startPercent}
                onchange={(e) => canvas.setControlNetProps(layer.id, { startPercent: Math.max(0, Math.min(1, parseFloat((e.target as HTMLInputElement).value) || 0)) })}
                class="w-10 bg-neutral-900 border border-neutral-700 rounded px-1 py-0.2 text-neutral-200 text-center font-mono"
              />
            </label>
            <label class="flex items-center justify-between gap-1 text-neutral-400 bg-neutral-950 p-1 rounded border border-neutral-800 text-[9px]">
              <span>End:</span>
              <input
                type="number"
                step="0.05"
                min="0"
                max="1"
                value={layer.endPercent}
                onchange={(e) => canvas.setControlNetProps(layer.id, { endPercent: Math.max(0, Math.min(1, parseFloat((e.target as HTMLInputElement).value) || 1)) })}
                class="w-10 bg-neutral-900 border border-neutral-700 rounded px-1 py-0.2 text-neutral-200 text-center font-mono"
              />
            </label>
          </div>
        </div>

      {:else if isRegionalLayer(layer)}
        <!-- Regional Conditioning Settings -->
        <div class="pt-1.5 border-t border-neutral-800/80 space-y-2">
          <div class="grid grid-cols-4 gap-1 font-mono text-[9px]">
            <label class="flex flex-col items-center gap-0.5 text-neutral-400 bg-neutral-950 p-1 rounded border border-neutral-800">
              <span>X</span>
              <input
                type="number"
                step="0.05"
                min="0"
                max="1"
                value={layer.x}
                onchange={(e) => canvas.setRegionalProps(layer.id, { x: Math.max(0, Math.min(1, parseFloat((e.target as HTMLInputElement).value) || 0)) })}
                class="w-full bg-neutral-900 border border-neutral-700 rounded text-neutral-200 text-center"
              />
            </label>
            <label class="flex flex-col items-center gap-0.5 text-neutral-400 bg-neutral-950 p-1 rounded border border-neutral-800">
              <span>Y</span>
              <input
                type="number"
                step="0.05"
                min="0"
                max="1"
                value={layer.y}
                onchange={(e) => canvas.setRegionalProps(layer.id, { y: Math.max(0, Math.min(1, parseFloat((e.target as HTMLInputElement).value) || 0)) })}
                class="w-full bg-neutral-900 border border-neutral-700 rounded text-neutral-200 text-center"
              />
            </label>
            <label class="flex flex-col items-center gap-0.5 text-neutral-400 bg-neutral-950 p-1 rounded border border-neutral-800">
              <span>W</span>
              <input
                type="number"
                step="0.05"
                min="0.05"
                max="1"
                value={layer.width}
                onchange={(e) => canvas.setRegionalProps(layer.id, { width: Math.max(0.05, Math.min(1 - layer.x, parseFloat((e.target as HTMLInputElement).value) || 0.5)) })}
                class="w-full bg-neutral-900 border border-neutral-700 rounded text-neutral-200 text-center"
              />
            </label>
            <label class="flex flex-col items-center gap-0.5 text-neutral-400 bg-neutral-950 p-1 rounded border border-neutral-800">
              <span>H</span>
              <input
                type="number"
                step="0.05"
                min="0.05"
                max="1"
                value={layer.height}
                onchange={(e) => canvas.setRegionalProps(layer.id, { height: Math.max(0.05, Math.min(1 - layer.y, parseFloat((e.target as HTMLInputElement).value) || 0.5)) })}
                class="w-full bg-neutral-900 border border-neutral-700 rounded text-neutral-200 text-center"
              />
            </label>
          </div>

          <div class="flex items-center justify-between">
            <span class="text-[10px] text-neutral-400">Weight</span>
            <div class="flex items-center gap-2 flex-1 max-w-[140px]">
              <input
                type="range"
                value={layer.weight}
                oninput={(e) => canvas.setRegionalProps(layer.id, { weight: parseFloat((e.target as HTMLInputElement).value) })}
                min="0.1"
                max="2.0"
                step="0.05"
                class="flex-1 accent-emerald-500 h-1.5 cursor-pointer"
              />
              <span class="font-mono text-neutral-400 w-7 text-right tabular-nums text-[10px]">
                {layer.weight.toFixed(2)}
              </span>
            </div>
          </div>

          <div>
            <span class="text-[10px] text-neutral-400 block mb-1">Regional Prompt</span>
            <textarea
              rows={2}
              value={layer.prompt}
              oninput={(e) => {
                const clean = (e.target as HTMLTextAreaElement).value.replace(/<lora:[^>]+>/gi, "").trim();
                canvas.setRegionalProps(layer.id, { prompt: clean });
              }}
              placeholder="Prompt for this region only..."
              class="w-full bg-neutral-950 border border-neutral-700 rounded px-1.5 py-1 text-neutral-200 text-[10px] outline-none focus:border-emerald-500 resize-none"
            ></textarea>
          </div>
        </div>
      {/if}
    </div>
  {/if}
</div>
