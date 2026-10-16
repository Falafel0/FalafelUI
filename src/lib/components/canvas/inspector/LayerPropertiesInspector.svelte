<script lang="ts">
  import {
    canvas,
    type CanvasBlendMode,
    CANVAS_BLEND_MODES,
    isRasterLayer,
    isMaskLayer,
    isRegionalLayer,
    isControlNetLayer,
  } from "../../../stores/canvas.svelte.js";
  import { locale } from "../../../stores/locale.svelte.js";

  const layer = $derived(canvas.activeLayer);

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

  function handleRegionalPromptChange(prompt: string) {
    if (!layer || layer.type !== "regional") return;
    // Auto-strip any inline <lora:...> tags per ComfyUI backend spec
    const cleanPrompt = prompt.replace(/<lora:[^>]+>/gi, "").trim();
    canvas.setRegionalProps(layer.id, { prompt: cleanPrompt });
  }
</script>

<div class="flex flex-col space-y-3 p-3 bg-neutral-900/60 rounded-xl border border-neutral-800 text-xs text-neutral-300">
  <div class="flex items-center justify-between pb-2 border-b border-neutral-800">
    <div class="flex items-center gap-1.5 font-semibold text-neutral-200">
      <span>{locale.t("canvas.layer.properties") || "Layer Properties"}</span>
    </div>
    {#if layer}
      <span
        class="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold uppercase tracking-wider {layer.type === 'raster'
          ? 'bg-sky-500/20 text-sky-400 border border-sky-500/40'
          : layer.type === 'mask'
            ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
            : layer.type === 'regional'
              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
              : 'bg-violet-500/20 text-violet-400 border border-violet-500/40'}"
      >
        {layer.type}
      </span>
    {/if}
  </div>

  {#if !layer}
    <div class="py-8 text-center text-neutral-500 italic text-[11px]">
      {locale.t("canvas.layer.no_selection") || "Select a layer in the stack to inspect its properties."}
    </div>
  {:else}
    <!-- Common Controls: Name & Opacity -->
    <div class="space-y-2">
      <div class="flex items-center justify-between gap-2">
        <span class="text-neutral-400">{locale.t("canvas.layer.name") || "Name"}</span>
        <input
          type="text"
          value={layer.name}
          onchange={(e) => canvas.renameLayer(layer.id, (e.target as HTMLInputElement).value)}
          class="flex-1 max-w-[180px] bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-neutral-100 text-[11px] outline-none focus:border-indigo-500"
        />
      </div>

      <div class="flex items-center justify-between gap-2">
        <span class="text-neutral-400">{locale.t("canvas.opacity") || "Opacity"}</span>
        <div class="flex items-center gap-2 flex-1 max-w-[180px]">
          <input
            type="range"
            value={layer.opacity}
            oninput={(e) => canvas.setLayerOpacity(layer.id, parseFloat((e.target as HTMLInputElement).value))}
            min="0"
            max="1"
            step="0.05"
            class="flex-1 accent-indigo-500 h-1.5 cursor-pointer"
          />
          <span class="font-mono text-neutral-300 w-8 text-right tabular-nums text-[11px]">
            {Math.round(layer.opacity * 100)}%
          </span>
        </div>
      </div>
    </div>

    <!-- TYPE SPECIFIC INSPECTOR -->
    {#if isRasterLayer(layer)}
      <!-- Raster Layer Inspector -->
      <div class="pt-2 border-t border-neutral-800 space-y-2.5">
        <div class="flex items-center justify-between">
          <span class="text-neutral-400">Blend Mode</span>
          <select
            value={layer.blendMode ?? "normal"}
            onchange={(e) => canvas.setLayerBlendMode(layer.id, (e.target as HTMLSelectElement).value as CanvasBlendMode)}
            class="bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-neutral-200 text-[11px] outline-none focus:border-indigo-500 cursor-pointer"
          >
            {#each CANVAS_BLEND_MODES as mode}
              <option value={mode}>{mode.charAt(0).toUpperCase() + mode.slice(1)}</option>
            {/each}
          </select>
        </div>

        <div class="flex items-center justify-between">
          <span class="text-neutral-400">{locale.t("canvas.layer.denoise") || "Denoise"}</span>
          <div class="flex items-center gap-2 flex-1 max-w-[180px]">
            <input
              type="range"
              value={layer.denoise ?? 1.0}
              oninput={(e) => canvas.setLayerDenoise(layer.id, parseFloat((e.target as HTMLInputElement).value))}
              min="0.05"
              max="1.0"
              step="0.01"
              class="flex-1 accent-indigo-500 h-1.5 cursor-pointer"
            />
            <span class="font-mono text-neutral-300 w-8 text-right tabular-nums text-[11px]">
              {(layer.denoise ?? 1.0).toFixed(2)}
            </span>
          </div>
        </div>

        <div class="pt-2 flex items-center gap-1.5">
          <button
            onclick={() => canvas.sendActiveLayerToMask()}
            class="flex-1 py-1 px-2 rounded bg-indigo-600/20 hover:bg-indigo-600/40 border border-indigo-500/40 text-indigo-300 text-[10px] font-medium transition-colors"
          >
            {locale.t("canvas.send_to_mask") || "Send to Mask"}
          </button>
          <button
            onclick={() => canvas.exportCompositePng()}
            class="py-1 px-2 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-neutral-300 text-[10px] font-medium transition-colors"
          >
            Export PNG
          </button>
        </div>
      </div>

    {:else if isMaskLayer(layer)}
      <!-- Mask Layer Inspector -->
      <div class="pt-2 border-t border-neutral-800 space-y-2.5">
        <div class="flex items-center justify-between">
          <span class="text-neutral-400">{locale.t("canvas.invert_mask") || "Invert Mask"}</span>
          <button
            onclick={() => canvas.invertMask()}
            class="px-2.5 py-1 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-neutral-200 text-[10px] font-medium transition-colors"
          >
            {locale.t("canvas.invert_mask") || "Invert Colors"}
          </button>
        </div>

        <div class="flex items-center justify-between">
          <span class="text-neutral-400">Mask Blur</span>
          <div class="flex items-center gap-2 flex-1 max-w-[180px]">
            <input
              type="range"
              value={layer.maskBlur ?? 0}
              oninput={(e) => canvas.setMaskProps(layer.id, { maskBlur: parseInt((e.target as HTMLInputElement).value, 10) })}
              min="0"
              max="64"
              step="1"
              class="flex-1 accent-indigo-500 h-1.5 cursor-pointer"
            />
            <span class="font-mono text-neutral-300 w-8 text-right tabular-nums text-[11px]">
              {layer.maskBlur ?? 0}px
            </span>
          </div>
        </div>

        <div class="flex items-center justify-between">
          <span class="text-neutral-400">{locale.t("canvas.layer.denoise") || "Inpaint Denoise"}</span>
          <div class="flex items-center gap-2 flex-1 max-w-[180px]">
            <input
              type="range"
              value={layer.denoise ?? 0.7}
              oninput={(e) => canvas.setLayerDenoise(layer.id, parseFloat((e.target as HTMLInputElement).value))}
              min="0.05"
              max="1.0"
              step="0.01"
              class="flex-1 accent-indigo-500 h-1.5 cursor-pointer"
            />
            <span class="font-mono text-neutral-300 w-8 text-right tabular-nums text-[11px]">
              {(layer.denoise ?? 0.7).toFixed(2)}
            </span>
          </div>
        </div>

        <div>
          <span class="text-neutral-400 block mb-1">Mask Prompt Override</span>
          <input
            type="text"
            value={layer.prompt ?? ""}
            oninput={(e) => canvas.setLayerPrompt(layer.id, (e.target as HTMLInputElement).value)}
            placeholder="Optional prompt override for this mask..."
            class="w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-neutral-200 text-[11px] outline-none focus:border-indigo-500"
          />
        </div>

        <button
          onclick={() => canvas.clearMask()}
          class="w-full py-1 rounded bg-rose-600/20 hover:bg-rose-600/40 border border-rose-500/40 text-rose-300 text-[10px] font-medium transition-colors"
        >
          {locale.t("canvas.clear_mask") || "Clear Mask Strokes"}
        </button>
      </div>

    {:else if isRegionalLayer(layer)}
      <!-- Regional Conditioning Inspector -->
      <div class="pt-2 border-t border-neutral-800 space-y-2.5">
        <div class="grid grid-cols-2 gap-2 font-mono text-[10px]">
          <label class="flex items-center justify-between gap-1 text-neutral-400 bg-neutral-900 p-1.5 rounded border border-neutral-800">
            <span>X:</span>
            <input
              type="number"
              step="0.05"
              min="0"
              max="1"
              value={layer.x}
              onchange={(e) => canvas.setRegionalProps(layer.id, { x: Math.max(0, Math.min(1, parseFloat((e.target as HTMLInputElement).value) || 0)) })}
              class="w-12 bg-neutral-950 border border-neutral-700 rounded px-1 py-0.5 text-neutral-200 text-center"
            />
          </label>
          <label class="flex items-center justify-between gap-1 text-neutral-400 bg-neutral-900 p-1.5 rounded border border-neutral-800">
            <span>Y:</span>
            <input
              type="number"
              step="0.05"
              min="0"
              max="1"
              value={layer.y}
              onchange={(e) => canvas.setRegionalProps(layer.id, { y: Math.max(0, Math.min(1, parseFloat((e.target as HTMLInputElement).value) || 0)) })}
              class="w-12 bg-neutral-950 border border-neutral-700 rounded px-1 py-0.5 text-neutral-200 text-center"
            />
          </label>
          <label class="flex items-center justify-between gap-1 text-neutral-400 bg-neutral-900 p-1.5 rounded border border-neutral-800">
            <span>W:</span>
            <input
              type="number"
              step="0.05"
              min="0.05"
              max="1"
              value={layer.width}
              onchange={(e) => canvas.setRegionalProps(layer.id, { width: Math.max(0.05, Math.min(1 - layer.x, parseFloat((e.target as HTMLInputElement).value) || 0.5)) })}
              class="w-12 bg-neutral-950 border border-neutral-700 rounded px-1 py-0.5 text-neutral-200 text-center"
            />
          </label>
          <label class="flex items-center justify-between gap-1 text-neutral-400 bg-neutral-900 p-1.5 rounded border border-neutral-800">
            <span>H:</span>
            <input
              type="number"
              step="0.05"
              min="0.05"
              max="1"
              value={layer.height}
              onchange={(e) => canvas.setRegionalProps(layer.id, { height: Math.max(0.05, Math.min(1 - layer.y, parseFloat((e.target as HTMLInputElement).value) || 0.5)) })}
              class="w-12 bg-neutral-950 border border-neutral-700 rounded px-1 py-0.5 text-neutral-200 text-center"
            />
          </label>
        </div>

        <div class="flex items-center justify-between">
          <span class="text-neutral-400">{locale.t("canvas.layer.regional_weight") || "Conditioning Weight"}</span>
          <div class="flex items-center gap-2 flex-1 max-w-[160px]">
            <input
              type="range"
              value={layer.weight}
              oninput={(e) => canvas.setRegionalProps(layer.id, { weight: parseFloat((e.target as HTMLInputElement).value) })}
              min="0"
              max="2"
              step="0.05"
              class="flex-1 accent-emerald-500 h-1.5 cursor-pointer"
            />
            <span class="font-mono text-neutral-300 w-8 text-right tabular-nums text-[11px]">
              {layer.weight.toFixed(2)}x
            </span>
          </div>
        </div>

        <div>
          <span class="text-neutral-400 block mb-1">{locale.t("canvas.layer.regional_prompt") || "Regional Positive Prompt"}</span>
          <textarea
            value={layer.prompt}
            oninput={(e) => handleRegionalPromptChange((e.target as HTMLTextAreaElement).value)}
            placeholder="Prompts focused on this specific sub-region..."
            rows={2}
            class="w-full bg-neutral-900 border border-neutral-700 rounded p-1.5 text-neutral-200 text-[11px] outline-none focus:border-emerald-500"
          ></textarea>
        </div>

        <div>
          <span class="text-neutral-400 block mb-1">{locale.t("canvas.layer.regional_neg_prompt") || "Regional Negative Prompt"}</span>
          <textarea
            value={layer.negativePrompt ?? ""}
            oninput={(e) => canvas.setRegionalProps(layer.id, { negativePrompt: (e.target as HTMLTextAreaElement).value })}
            placeholder="Negative prompt override for this sub-region..."
            rows={2}
            class="w-full bg-neutral-900 border border-neutral-700 rounded p-1.5 text-neutral-200 text-[11px] outline-none focus:border-emerald-500"
          ></textarea>
        </div>
      </div>

    {:else if isControlNetLayer(layer)}
      <!-- ControlNet Guidance Inspector -->
      <div class="pt-2 border-t border-neutral-800 space-y-2.5">
        <div>
          <span class="text-neutral-400 block mb-1">{locale.t("canvas.layer.controlnet_model") || "ControlNet Model"}</span>
          <input
            type="text"
            value={layer.model}
            onchange={(e) => canvas.setControlNetProps(layer.id, { model: (e.target as HTMLInputElement).value })}
            placeholder="e.g. control_v11p_sd15_canny.pth"
            class="w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-neutral-200 text-[11px] outline-none focus:border-violet-500 font-mono"
          />
        </div>

        <div class="flex items-center justify-between">
          <span class="text-neutral-400">{locale.t("canvas.layer.controlnet_preprocessor") || "Preprocessor"}</span>
          <select
            value={layer.preprocessor}
            onchange={(e) => canvas.setControlNetProps(layer.id, { preprocessor: (e.target as HTMLSelectElement).value })}
            class="bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-neutral-200 text-[11px] outline-none focus:border-violet-500 cursor-pointer"
          >
            {#each PREPROCESSORS as p}
              <option value={p}>{p}</option>
            {/each}
          </select>
        </div>

        <div class="flex items-center justify-between">
          <span class="text-neutral-400">{locale.t("canvas.layer.controlnet_strength") || "Guidance Strength"}</span>
          <div class="flex items-center gap-2 flex-1 max-w-[160px]">
            <input
              type="range"
              value={layer.strength}
              oninput={(e) => canvas.setControlNetProps(layer.id, { strength: parseFloat((e.target as HTMLInputElement).value) })}
              min="0"
              max="2"
              step="0.05"
              class="flex-1 accent-violet-500 h-1.5 cursor-pointer"
            />
            <span class="font-mono text-neutral-300 w-8 text-right tabular-nums text-[11px]">
              {layer.strength.toFixed(2)}
            </span>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-2">
          <label class="flex items-center justify-between gap-1 text-neutral-400 bg-neutral-900 p-1.5 rounded border border-neutral-800 text-[10px]">
            <span>Start:</span>
            <input
              type="number"
              step="0.05"
              min="0"
              max="1"
              value={layer.startPercent}
              onchange={(e) => canvas.setControlNetProps(layer.id, { startPercent: Math.max(0, Math.min(1, parseFloat((e.target as HTMLInputElement).value) || 0)) })}
              class="w-12 bg-neutral-950 border border-neutral-700 rounded px-1 py-0.5 text-neutral-200 text-center font-mono"
            />
          </label>
          <label class="flex items-center justify-between gap-1 text-neutral-400 bg-neutral-900 p-1.5 rounded border border-neutral-800 text-[10px]">
            <span>End:</span>
            <input
              type="number"
              step="0.05"
              min="0"
              max="1"
              value={layer.endPercent}
              onchange={(e) => canvas.setControlNetProps(layer.id, { endPercent: Math.max(0, Math.min(1, parseFloat((e.target as HTMLInputElement).value) || 1)) })}
              class="w-12 bg-neutral-950 border border-neutral-700 rounded px-1 py-0.5 text-neutral-200 text-center font-mono"
            />
          </label>
        </div>
      </div>
    {/if}
  {/if}
</div>
