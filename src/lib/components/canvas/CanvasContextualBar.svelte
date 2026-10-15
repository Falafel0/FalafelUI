<script lang="ts">
  import { canvas } from "../../stores/canvas.svelte.js";
  import { generation } from "../../stores/generation.svelte.js";
  import { progress } from "../../stores/progress.svelte.js";
  import { locale } from "../../stores/locale.svelte.js";
  import { scrubbable } from "../../utils/scrubbable.js";

  interface Props {
    onGenerate?: () => void;
    onUpscale?: () => void;
  }

  let { onGenerate, onUpscale }: Props = $props();

  const action = $derived(canvas.currentUnifiedAction);

  const actionBadges = $derived<Record<string, { label: string; icon: string; color: string }>>({
    txt2img: {
      label: locale.t("canvas.actions.txt2img"),
      icon: "✨",
      color: "bg-purple-900/60 text-purple-300 border-purple-700/60",
    },
    img2img: {
      label: locale.t("canvas.actions.img2img"),
      icon: "🔄",
      color: "bg-blue-900/60 text-blue-300 border-blue-700/60",
    },
    inpaint: {
      label: locale.t("canvas.actions.inpaint"),
      icon: "🖌️",
      color: "bg-emerald-900/60 text-emerald-300 border-emerald-700/60",
    },
    outpaint: {
      label: locale.t("canvas.actions.outpaint"),
      icon: "🖼️",
      color: "bg-amber-900/60 text-amber-300 border-amber-700/60",
    },
    upscale: {
      label: locale.t("canvas.actions.upscale"),
      icon: "🔍",
      color: "bg-indigo-900/60 text-indigo-300 border-indigo-700/60",
    },
  });

  const badge = $derived(actionBadges[action] ?? actionBadges.txt2img);

  function handlePromptKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (!progress.isGenerating) {
        onGenerate?.();
      }
    } else if (e.key === "Escape") {
      (e.target as HTMLInputElement).blur();
    }
  }
</script>

<div class="absolute inset-x-0 bottom-6 z-30 flex justify-center px-4 pointer-events-none">
  <div
    class="pointer-events-auto flex items-center gap-2 p-1.5 rounded-2xl border border-neutral-700/90 bg-neutral-950/90 shadow-2xl backdrop-blur-md max-w-2xl w-full"
    role="toolbar"
    aria-label="Canvas contextual actions"
    tabindex="-1"
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => e.stopPropagation()}
  >
    {#if canvas.activeTool === "transform"}
      <!-- Free Transform HUD -->
      <div class="flex items-center justify-between gap-3 w-full px-2 py-0.5">
        <div class="flex items-center gap-2 text-xs text-indigo-300 font-medium">
          <span class="text-sm">🔄</span>
          <span>{locale.t("canvas.transform_active_tip")}</span>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <button
            onclick={() => {
              canvas.commitTransform();
              canvas.setTool(canvas.previousTool ?? "brush");
            }}
            class="flex items-center gap-1.5 px-3 py-1 rounded-xl border border-emerald-500 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer shadow-md shadow-emerald-900/30 transition-all"
            title="Enter"
          >
            <span>✓</span>
            <span>{locale.t("canvas.commit")}</span>
          </button>
          <button
            onclick={() => canvas.cancelTransform()}
            class="flex items-center gap-1.5 px-3 py-1 rounded-xl border border-neutral-700 bg-neutral-900 hover:bg-neutral-800 text-neutral-300 hover:text-white text-xs cursor-pointer transition-all"
            title="Esc"
          >
            <span>✕</span>
            <span>{locale.t("canvas.cancel")}</span>
          </button>
        </div>
      </div>
    {:else}
      <!-- Dynamic Mode Indicator Badge -->
      <div
        class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-[11px] font-medium shrink-0 {badge.color}"
        title={locale.t("canvas.contextual.auto_badge_title")}
      >
        <span>{badge.icon}</span>
        <span class="hidden sm:inline">{badge.label}</span>
      </div>

    <!-- Quick Prompt Input -->
    <div class="flex-1 min-w-0 relative">
      <input
        type="text"
        bind:value={generation.positivePrompt}
        onkeydown={handlePromptKeyDown}
        placeholder={action === "inpaint" || action === "outpaint" ? locale.t("canvas.contextual.prompt_inpaint_placeholder") : locale.t("canvas.contextual.prompt_placeholder")}
        class="w-full bg-neutral-900/80 hover:bg-neutral-900 focus:bg-neutral-900 border border-neutral-700/80 focus:border-indigo-500 rounded-xl px-3 py-1.5 text-xs text-neutral-100 placeholder-neutral-500 outline-none transition-colors"
      />
    </div>

    <!-- Denoise Slider (only shown when pixels exist under frame and not in fresh txt2img) -->
    {#if action === "img2img" || action === "inpaint" || action === "outpaint"}
      <div class="hidden md:flex items-center gap-1.5 px-2 py-1 rounded-xl bg-neutral-900 border border-neutral-800 shrink-0" title={locale.t("canvas.contextual.denoise")}>
        <span
          use:scrubbable={{
            value: () => generation.denoise,
            min: 0.05,
            max: 1,
            step: 0.05,
            decimals: 2,
            onchange: (v) => { generation.denoise = v; },
            onend: () => { generation.saveSettings(); },
          }}
          class="text-[10px] text-neutral-400 font-mono cursor-ew-resize hover:text-indigo-300 select-none"
          title={locale.t("common.scrub_tip")}
        >D:</span>
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
      title={locale.t("canvas.actions.upscale")}
    >
      <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
      <span>Upscale</span>
    </button>

    <!-- Staging Carousel & Controls / Generate Button -->
    {#if (canvas.isStagingActive || canvas.canApplyInpaintResult) && !progress.isGenerating}
      <div class="flex items-center gap-1.5 shrink-0">
        {#if canvas.stagingImages.length > 1}
          <div class="flex items-center gap-1 px-1.5 py-1 rounded-xl bg-neutral-900 border border-neutral-800">
            <button
              onclick={() => canvas.prevStaging()}
              class="w-5 h-5 flex items-center justify-center rounded hover:bg-neutral-800 text-neutral-400 hover:text-white transition-colors"
              title={locale.t("canvas.prev_staged")}
            >
              ◀
            </button>
            <span class="text-[10px] text-neutral-300 font-mono tabular-nums px-1">
              {canvas.stagingIndex + 1} / {canvas.stagingImages.length}
            </span>
            <button
              onclick={() => canvas.nextStaging()}
              class="w-5 h-5 flex items-center justify-center rounded hover:bg-neutral-800 text-neutral-400 hover:text-white transition-colors"
              title={locale.t("canvas.next_staged")}
            >
              ▶
            </button>
          </div>
        {/if}

        <button
          onclick={() => void canvas.acceptStagingToCurrentLayer()}
          class="flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-emerald-500 bg-emerald-600/30 text-emerald-200 hover:bg-emerald-600/50 text-xs font-medium transition-colors"
          title={locale.t("canvas.contextual.accept")}
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          <span>{locale.t("canvas.accept")}</span>
        </button>

        <button
          onclick={() => void canvas.acceptStagingToNewLayer()}
          class="hidden sm:flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-indigo-500/70 bg-indigo-600/20 text-indigo-200 hover:bg-indigo-600/40 text-xs font-medium transition-colors"
          title={locale.t("canvas.contextual.accept_new_layer")}
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          <span>{locale.t("canvas.contextual.accept_new_layer")}</span>
        </button>

        <button
          onclick={() => {
            if (canvas.canApplyInpaintResult) canvas.clearInpaintSession();
            canvas.clearStaging();
          }}
          class="w-7 h-7 flex items-center justify-center rounded-xl border border-neutral-700 hover:border-neutral-500 bg-neutral-900 text-neutral-400 hover:text-red-400 text-xs transition-colors"
          title={locale.t("canvas.contextual.dismiss")}
        >
          ✕
        </button>
      </div>
    {:else}
      <button
        onclick={() => onGenerate?.()}
        disabled={progress.isGenerating}
        class="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border border-indigo-500 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-xs font-semibold text-white shadow-lg shadow-indigo-600/20 transition-all shrink-0 cursor-pointer"
        title="Ctrl+Enter"
      >
        {#if progress.isGenerating}
          <div class="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
          <span>{Math.round(progress.percentage)}%</span>
        {:else}
          <span>{badge.icon}</span>
          <span>{locale.t("canvas.contextual.generate")}</span>
        {/if}
      </button>
    {/if}
    {/if}
  </div>
</div>
