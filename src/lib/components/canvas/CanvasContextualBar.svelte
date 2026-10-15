<script lang="ts">
  import { canvas } from "../../stores/canvas.svelte.js";
  import { generation } from "../../stores/generation.svelte.js";
  import { progress } from "../../stores/progress.svelte.js";
  import { locale } from "../../stores/locale.svelte.js";

  interface Props {
    onGenerate?: () => void;
    onUpscale?: () => void;
  }

  let { onGenerate, onUpscale }: Props = $props();

  const action = $derived(canvas.currentUnifiedAction);

  const actionBadges: Record<string, { label: string; icon: string; color: string }> = {
    txt2img: {
      label: "Text-to-Image",
      icon: "✨",
      color: "bg-purple-900/60 text-purple-300 border-purple-700/60",
    },
    img2img: {
      label: "Image-to-Image",
      icon: "🔄",
      color: "bg-blue-900/60 text-blue-300 border-blue-700/60",
    },
    inpaint: {
      label: "Generative Fill",
      icon: "🖌️",
      color: "bg-emerald-900/60 text-emerald-300 border-emerald-700/60",
    },
    outpaint: {
      label: "Generative Expand",
      icon: "🖼️",
      color: "bg-amber-900/60 text-amber-300 border-amber-700/60",
    },
    upscale: {
      label: "Tile Upscale",
      icon: "🔍",
      color: "bg-indigo-900/60 text-indigo-300 border-indigo-700/60",
    },
  };

  const badge = $derived(actionBadges[action] ?? actionBadges.txt2img);
</script>

<div class="absolute inset-x-0 bottom-6 z-30 flex justify-center px-4 pointer-events-none">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="pointer-events-auto flex items-center gap-2 p-1.5 rounded-2xl border border-neutral-700/90 bg-neutral-950/90 shadow-2xl backdrop-blur-md max-w-2xl w-full"
    onclick={(e) => e.stopPropagation()}
  >
    <!-- Dynamic Mode Indicator Badge -->
    <div
      class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-[11px] font-medium shrink-0 {badge.color}"
      title="Автоматически определено на основе состояния холста"
    >
      <span>{badge.icon}</span>
      <span class="hidden sm:inline">{badge.label}</span>
    </div>

    <!-- Quick Prompt Input -->
    <div class="flex-1 min-w-0 relative">
      <input
        type="text"
        bind:value={generation.positivePrompt}
        placeholder={action === "inpaint" ? "Что сгенерировать в маске (Generative Fill)..." : "Опишите сцену..."}
        class="w-full bg-neutral-900/80 hover:bg-neutral-900 focus:bg-neutral-900 border border-neutral-700/80 focus:border-indigo-500 rounded-xl px-3 py-1.5 text-xs text-neutral-100 placeholder-neutral-500 outline-none transition-colors"
      />
    </div>

    <!-- Denoise Slider (only shown when pixels exist under frame and not in fresh txt2img) -->
    {#if action === "img2img" || action === "inpaint" || action === "outpaint"}
      <div class="hidden md:flex items-center gap-1.5 px-2 py-1 rounded-xl bg-neutral-900 border border-neutral-800 shrink-0" title="Сила трансформации (Denoise)">
        <span class="text-[10px] text-neutral-400 font-mono">D:</span>
        <input
          type="range"
          bind:value={generation.denoise}
          min="0.1"
          max="1"
          step="0.05"
          class="w-16 h-1 accent-indigo-500 cursor-pointer"
        />
        <span class="text-[10px] text-neutral-300 tabular-nums font-mono">{generation.denoise.toFixed(2)}</span>
      </div>
    {/if}

    <!-- Quick Upscale Action Button -->
    <button
      onclick={() => onUpscale?.()}
      class="hidden lg:flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-neutral-700 hover:border-indigo-500 bg-neutral-900 hover:bg-neutral-800 text-xs text-neutral-300 hover:text-white transition-colors shrink-0"
      title="Увеличить разрешение (Hi-Res Upscale)"
    >
      <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
      <span>Upscale</span>
    </button>

    <!-- Generate Button / Staging Accept -->
    {#if canvas.canApplyInpaintResult && !progress.isGenerating}
      <div class="flex items-center gap-1 shrink-0">
        <button
          onclick={() => canvas.applyInpaintResult()}
          class="flex items-center gap-1 px-3 py-1.5 rounded-xl border border-emerald-500 bg-emerald-600/30 text-emerald-200 hover:bg-emerald-600/50 text-xs font-medium transition-colors"
          title="Принять результат на текущий слой (Enter)"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          <span>Принять</span>
        </button>
        <button
          onclick={() => canvas.clearInpaintSession()}
          class="w-7 h-7 flex items-center justify-center rounded-xl border border-neutral-700 hover:border-neutral-500 bg-neutral-900 text-neutral-400 hover:text-red-400 text-xs transition-colors"
          title="Отклонить вариант (Esc)"
        >
          ✕
        </button>
      </div>
    {:else}
      <button
        onclick={() => onGenerate?.()}
        disabled={progress.isGenerating}
        class="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border border-indigo-500 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-xs font-semibold text-white shadow-lg shadow-indigo-600/20 transition-all shrink-0 cursor-pointer"
        title="Запустить генерацию (Ctrl+Enter)"
      >
        {#if progress.isGenerating}
          <div class="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
          <span>{Math.round(progress.percentage)}%</span>
        {:else}
          <span>{badge.icon}</span>
          <span>Генерировать</span>
        {/if}
      </button>
    {/if}
  </div>
</div>
