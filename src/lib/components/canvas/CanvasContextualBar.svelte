<script lang="ts">
  import { canvas } from "../../stores/canvas.svelte.js";
  import { generation } from "../../stores/generation.svelte.js";
  import { progress } from "../../stores/progress.svelte.js";
  import { queue } from "../../stores/queue.svelte.js";
  import { locale } from "../../stores/locale.svelte.js";
  import { scrubbable } from "../../utils/scrubbable.js";
  import { interruptGeneration } from "../../utils/api.js";

  interface Props {
    onGenerate?: () => void;
    onUpscale?: () => void;
  }

  let { onGenerate, onUpscale }: Props = $props();

  let isMinimized = $state(false);

  // Active layer and tool derived helpers
  const activeLayer = $derived(canvas.activeLayer);
  const isTransforming = $derived(canvas.activeTool === "transform");
  const isGenerating = $derived(progress.isGenerating);
  const isStaging = $derived(canvas.isStagingActive || canvas.canApplyInpaintResult);
  const isMaskActive = $derived(activeLayer?.type === "mask");
  const isRegionalActive = $derived(activeLayer?.type === "regional");

  const action = $derived(canvas.currentUnifiedAction);

  const actionBadges = $derived<Record<string, { label: string; icon: string; color: string }>>({
    txt2img: {
      label: locale.t("canvas.actions.txt2img") || "Text-to-Image",
      icon: "✨",
      color: "bg-purple-900/60 text-purple-300 border-purple-700/60",
    },
    img2img: {
      label: locale.t("canvas.actions.img2img") || "Image-to-Image",
      icon: "🔄",
      color: "bg-blue-900/60 text-blue-300 border-blue-700/60",
    },
    inpaint: {
      label: locale.t("canvas.actions.inpaint") || "Generative Fill",
      icon: "🖌️",
      color: "bg-emerald-900/60 text-emerald-300 border-emerald-700/60",
    },
    outpaint: {
      label: locale.t("canvas.actions.outpaint") || "Generative Expand",
      icon: "🖼️",
      color: "bg-amber-900/60 text-amber-300 border-amber-700/60",
    },
    upscale: {
      label: locale.t("canvas.actions.upscale") || "Tile Upscale",
      icon: "🔍",
      color: "bg-indigo-900/60 text-indigo-300 border-indigo-700/60",
    },
  });

  const badge = $derived(actionBadges[action] ?? actionBadges.txt2img);

  function handlePromptKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (!isGenerating) {
        onGenerate?.();
      }
    } else if (e.key === "Escape") {
      (e.target as HTMLInputElement).blur();
    }
  }

  async function handleCancelGeneration() {
    try {
      await queue.interrupt();
    } catch {
      await interruptGeneration();
    }
  }

  // Keyboard shortcuts window listener for staging, transform, and cancel
  function handleGlobalKeyDown(e: KeyboardEvent) {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
      return;
    }

    if (isGenerating && e.key === "Escape") {
      e.preventDefault();
      void handleCancelGeneration();
      return;
    }

    if (isStaging) {
      if (e.key === "Enter" && e.altKey) {
        e.preventDefault();
        void canvas.acceptAndInpaintImmediately();
        return;
      }
      if (e.key === "Enter" && e.shiftKey) {
        e.preventDefault();
        void canvas.acceptStagingToNewLayer();
        return;
      }
      if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey) {
        e.preventDefault();
        void canvas.acceptStagingToCurrentLayer();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        if (canvas.canApplyInpaintResult) canvas.clearInpaintSession();
        canvas.clearStaging();
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        canvas.prevStaging();
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        canvas.nextStaging();
        return;
      }
    }

    if (isTransforming) {
      if (e.key === "Enter") {
        e.preventDefault();
        canvas.commitTransform();
        canvas.setTool(canvas.previousTool ?? "brush");
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        canvas.cancelTransform();
        return;
      }
    }
  }
</script>

<svelte:window onkeydown={handleGlobalKeyDown} />

<div class="absolute inset-x-0 bottom-6 z-30 flex justify-center px-4 pointer-events-none select-none transition-all duration-200">
  {#if isMinimized}
    <!-- Minimized Floating Pill -->
    <div
      class="pointer-events-auto flex items-center gap-2 px-3 py-1.5 rounded-full border border-neutral-700/80 bg-neutral-950/90 shadow-xl backdrop-blur-md transition-all"
      role="toolbar"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
    >
      <button
        onclick={() => onGenerate?.()}
        disabled={isGenerating}
        class="flex items-center gap-1.5 text-xs font-semibold text-indigo-400 hover:text-indigo-300 disabled:opacity-50 cursor-pointer"
      >
        <span>{badge.icon}</span>
        <span>{locale.t("canvas.contextual.generate") || "Generate"}</span>
      </button>
      <div class="w-px h-3.5 bg-neutral-700"></div>
      <button
        onclick={() => { isMinimized = false; }}
        class="text-neutral-400 hover:text-neutral-200 text-xs cursor-pointer p-0.5"
        title="Expand Task Bar"
      >
        ▲
      </button>
    </div>
  {:else}
    <!-- Full Contextual Task Bar -->
    <div
      class="pointer-events-auto flex items-center gap-2 p-1.5 rounded-2xl border border-neutral-700/85 bg-neutral-950/88 shadow-2xl backdrop-blur-md max-w-3xl w-full transition-all"
      role="toolbar"
      aria-label="Canvas contextual actions"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
    >
      {#if isTransforming}
        <!-- 1. FREE TRANSFORM HUD -->
        <div class="flex items-center justify-between gap-3 w-full px-2 py-0.5">
          <div class="flex items-center gap-2 text-xs text-indigo-300 font-medium truncate">
            <span class="text-sm">🔄</span>
            <span>{locale.t("canvas.transform_active_tip") || "Free Transform active"}</span>
            {#if canvas.activeTransformBounds}
              <span class="text-[11px] text-neutral-400 font-mono hidden sm:inline">
                {canvas.activeTransformBounds.width}×{canvas.activeTransformBounds.height}px ∠{canvas.activeTransformBounds.rotation}°
              </span>
            {/if}
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
              <span>{locale.t("canvas.commit") || "Commit"}</span>
            </button>
            <button
              onclick={() => canvas.cancelTransform()}
              class="flex items-center gap-1.5 px-3 py-1 rounded-xl border border-neutral-700 bg-neutral-900 hover:bg-neutral-800 text-neutral-300 hover:text-white text-xs cursor-pointer transition-all"
              title="Esc"
            >
              <span>✕</span>
              <span>{locale.t("canvas.cancel") || "Cancel"}</span>
            </button>
          </div>
        </div>

      {:else if isGenerating}
        <!-- 2. GENERATING STATE -->
        <div class="flex items-center justify-between gap-3 w-full px-2 py-0.5">
          <div class="flex items-center gap-2 text-xs text-indigo-300 font-medium shrink-0">
            <div class="w-3.5 h-3.5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin"></div>
            <span>{progress.phaseLabel || locale.t("canvas.contextual.generating") || "Generating..."}</span>
          </div>

          <!-- Progress Bar & Step Readout -->
          <div class="flex-1 flex items-center gap-3 max-w-md">
            <div class="flex-1 h-2 rounded-full bg-neutral-800 overflow-hidden">
              <div
                class="h-full rounded-full transition-all duration-150 {progress.isUpscalePhase ? 'bg-emerald-500' : 'bg-indigo-500'}"
                style="width: {Math.max(4, Math.round(progress.percentage))}%"
              ></div>
            </div>
            <div class="text-[11px] text-neutral-300 font-mono tabular-nums shrink-0">
              {#if progress.hasReliableStepProgress}
                <span>{progress.currentStep}/{progress.totalSteps}</span>
                <span class="text-neutral-500 ml-1">({Math.round(progress.percentage)}%)</span>
              {:else}
                <span>{Math.round(progress.percentage)}%</span>
              {/if}
              {#if progress.elapsedSeconds > 0}
                <span class="text-neutral-500 ml-1">({progress.elapsedSeconds}s)</span>
              {/if}
            </div>
          </div>

          <!-- Cancel / Interrupt Button -->
          <button
            onclick={handleCancelGeneration}
            class="flex items-center gap-1.5 px-3 py-1 rounded-xl border border-rose-500/80 bg-rose-600/25 hover:bg-rose-600/40 text-rose-200 text-xs font-semibold cursor-pointer transition-all shrink-0"
            title="Esc"
          >
            <span class="text-[10px]">■</span>
            <span>{locale.t("common.cancel") || "Cancel"}</span>
          </button>
        </div>

      {:else if isStaging}
        <!-- 3. STAGING CANDIDATE READY -->
        <div class="flex items-center justify-between gap-2 w-full px-1">
          <!-- Multi-Candidate Carousel Stepper -->
          {#if canvas.stagingImages.length > 1}
            <div class="flex items-center gap-1 px-1.5 py-1 rounded-xl bg-neutral-900 border border-neutral-800 shrink-0">
              <button
                onclick={() => canvas.prevStaging()}
                class="w-5 h-5 flex items-center justify-center rounded hover:bg-neutral-800 text-neutral-400 hover:text-white transition-colors cursor-pointer"
                title={locale.t("canvas.prev_staged") || "Previous"}
              >◀</button>
              <span class="text-[10px] text-neutral-300 font-mono tabular-nums px-1">
                {canvas.stagingIndex + 1} / {canvas.stagingImages.length}
              </span>
              <button
                onclick={() => canvas.nextStaging()}
                class="w-5 h-5 flex items-center justify-center rounded hover:bg-neutral-800 text-neutral-400 hover:text-white transition-colors cursor-pointer"
                title={locale.t("canvas.next_staged") || "Next"}
              >▶</button>
            </div>
          {/if}

          <!-- DIRECTIVE 2 HERO ACTION: Accept & Inpaint Immediately -->
          <button
            onclick={() => void canvas.acceptAndInpaintImmediately()}
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-emerald-500 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-md shadow-emerald-900/30 transition-all cursor-pointer active:scale-95 shrink-0"
            title="Alt+Enter"
          >
            <span class="text-sm">🎨</span>
            <span>{locale.t("canvas.staging.accept_and_inpaint") || "Accept & Inpaint"}</span>
            <kbd class="hidden md:inline text-[9px] font-mono px-1 py-0.5 bg-emerald-800/60 rounded text-emerald-200">Alt+↵</kbd>
          </button>

          <!-- Accept as New Layer -->
          <button
            onclick={() => void canvas.acceptStagingToNewLayer()}
            class="hidden sm:flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-indigo-500/70 bg-indigo-600/25 hover:bg-indigo-600/40 text-indigo-200 text-xs font-medium transition-colors cursor-pointer shrink-0"
            title="Shift+Enter"
          >
            <span>+</span>
            <span>{locale.t("canvas.contextual.accept_new_layer") || "To New Layer"}</span>
            <kbd class="hidden lg:inline text-[9px] font-mono px-1 py-0.5 bg-indigo-900/60 rounded text-indigo-300">⇧↵</kbd>
          </button>

          <!-- Apply to Base -->
          <button
            onclick={() => void canvas.acceptStagingToCurrentLayer()}
            class="flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-neutral-700 bg-neutral-900 hover:bg-neutral-800 text-neutral-200 text-xs font-medium transition-colors cursor-pointer shrink-0"
            title="Enter"
          >
            <span>✓</span>
            <span>{locale.t("canvas.staging.apply_to_base") || "Apply to Base"}</span>
            <kbd class="hidden lg:inline text-[9px] font-mono px-1 py-0.5 bg-neutral-800 rounded text-neutral-400">↵</kbd>
          </button>

          <!-- Use as Mask -->
          <button
            onclick={() => void canvas.useStagingAsMask()}
            class="hidden md:flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-purple-500/60 bg-purple-600/20 hover:bg-purple-600/35 text-purple-200 text-xs font-medium transition-colors cursor-pointer shrink-0"
            title={locale.t("canvas.staging.use_as_mask") || "Use as Mask"}
          >
            <span>🎭</span>
            <span>{locale.t("canvas.staging.use_as_mask") || "Use as Mask"}</span>
          </button>

          <!-- Before/After Comparison Toggle -->
          <button
            onclick={() => canvas.toggleShowOriginal()}
            class="hidden lg:flex items-center gap-1 px-2 py-1.5 rounded-xl border text-xs font-medium transition-colors cursor-pointer shrink-0 {canvas.showingOriginal || canvas.stagingShowOriginal ? 'border-amber-500/80 bg-amber-600/25 text-amber-200' : 'border-neutral-700 bg-neutral-900 hover:bg-neutral-800 text-neutral-300'}"
            title={locale.t("canvas.show_original") || "Before / After"}
          >
            <span>👁️</span>
            <span class="text-[11px]">{canvas.showingOriginal || canvas.stagingShowOriginal ? (locale.t("canvas.original_active") || "Original") : (locale.t("canvas.show_original") || "Compare")}</span>
          </button>

          <!-- Reroll -->
          <button
            onclick={() => {
              canvas.clearStaging();
              onGenerate?.();
            }}
            class="hidden lg:flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-neutral-700 bg-neutral-900 hover:bg-neutral-800 text-neutral-300 hover:text-white text-xs font-medium transition-colors cursor-pointer shrink-0"
            title={locale.t("canvas.staging.reroll") || "Discard and Reroll"}
          >
            <span>🔄</span>
            <span>{locale.t("canvas.staging.reroll") || "Reroll"}</span>
          </button>

          <!-- Discard -->
          <button
            onclick={() => {
              if (canvas.canApplyInpaintResult) canvas.clearInpaintSession();
              canvas.clearStaging();
            }}
            class="w-7 h-7 flex items-center justify-center rounded-xl border border-neutral-700 hover:border-neutral-500 bg-neutral-900 text-neutral-400 hover:text-rose-400 text-xs transition-colors cursor-pointer shrink-0"
            title="Esc"
          >
            ✕
          </button>
        </div>

      {:else if isMaskActive}
        <!-- 4. MASK LAYER ACTIVE -->
        <div class="flex items-center justify-between gap-2.5 w-full px-1">
          <div class="flex items-center gap-1.5 px-2 py-1 rounded-xl border border-emerald-700/60 bg-emerald-950/60 text-emerald-300 text-[11px] font-medium shrink-0">
            <span>🎭</span>
            <span>{locale.t("canvas.layer.type_mask") || "Inpaint Mask"}</span>
          </div>

          <!-- Tool Switcher: Brush vs Eraser -->
          <div class="flex items-center gap-1 p-0.5 rounded-xl bg-neutral-900 border border-neutral-800 shrink-0">
            <button
              onclick={() => canvas.setTool("brush")}
              class="px-2 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer {canvas.activeTool === 'brush' ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:text-white'}"
              title="Brush (B)"
            >🖌️</button>
            <button
              onclick={() => canvas.setTool("eraser")}
              class="px-2 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer {canvas.activeTool === 'eraser' ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:text-white'}"
              title="Eraser (E)"
            >🧹</button>
          </div>

          <!-- Brush Size Scrubbable -->
          <div class="flex items-center gap-1.5 px-2 py-1 rounded-xl bg-neutral-900 border border-neutral-800 shrink-0">
            <span
              use:scrubbable={{
                value: () => canvas.brushSettings.size,
                min: 1,
                max: 500,
                step: 1,
                decimals: 0,
                onchange: (v) => { canvas.brushSettings.size = v; },
              }}
              class="text-[10px] text-neutral-400 font-mono cursor-ew-resize hover:text-indigo-300 select-none"
              title="Brush size ([ / ])"
            >Size:</span>
            <input
              type="range"
              bind:value={canvas.brushSettings.size}
              min="1"
              max="250"
              class="w-14 sm:w-20 h-1 accent-indigo-500 cursor-pointer"
            />
            <span class="text-[10px] text-neutral-300 font-mono tabular-nums w-8">{canvas.brushSettings.size}px</span>
          </div>

          <!-- Brush Hardness Scrubbable -->
          <div class="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-xl bg-neutral-900 border border-neutral-800 shrink-0">
            <span
              use:scrubbable={{
                value: () => canvas.brushSettings.hardness,
                min: 0,
                max: 1,
                step: 0.05,
                decimals: 2,
                onchange: (v) => { canvas.brushSettings.hardness = v; },
              }}
              class="text-[10px] text-neutral-400 font-mono cursor-ew-resize hover:text-indigo-300 select-none"
              title="Hardness (Shift+[ / Shift+])"
            >Hard:</span>
            <input
              type="range"
              bind:value={canvas.brushSettings.hardness}
              min="0"
              max="1"
              step="0.05"
              class="w-12 h-1 accent-indigo-500 cursor-pointer"
            />
            <span class="text-[10px] text-neutral-300 font-mono tabular-nums w-8">{Math.round(canvas.brushSettings.hardness * 100)}%</span>
          </div>

          <!-- Invert Mask -->
          <button
            onclick={() => canvas.invertMask()}
            class="flex items-center gap-1 px-2.5 py-1 rounded-xl border border-neutral-700 bg-neutral-900 hover:bg-neutral-800 text-neutral-300 hover:text-white text-xs transition-colors cursor-pointer shrink-0"
            title={locale.t("canvas.invert_mask") || "Invert Mask"}
          >
            <span>⇄</span>
            <span class="hidden sm:inline">{locale.t("canvas.invert_mask") || "Invert"}</span>
          </button>

          <!-- Clear Mask -->
          <button
            onclick={() => canvas.clearMask()}
            class="flex items-center gap-1 px-2.5 py-1 rounded-xl border border-neutral-700 bg-neutral-900 hover:bg-neutral-800 text-neutral-300 hover:text-rose-300 text-xs transition-colors cursor-pointer shrink-0"
            title={locale.t("canvas.clear_mask") || "Clear Mask"}
          >
            <span>🗑️</span>
            <span class="hidden sm:inline">{locale.t("canvas.clear_mask") || "Clear"}</span>
          </button>
        </div>

      {:else if isRegionalActive && activeLayer && activeLayer.type === "regional"}
        <!-- 5. REGIONAL CONDITIONING LAYER ACTIVE -->
        <div class="flex items-center justify-between gap-2 w-full px-1">
          <div class="flex items-center gap-1.5 px-2 py-1 rounded-xl border border-cyan-700/60 bg-cyan-950/60 text-cyan-300 text-[11px] font-medium shrink-0">
            <span>📍</span>
            <span class="truncate max-w-[80px] sm:max-w-none">{activeLayer.name}</span>
          </div>

          <!-- Regional Prompt Input -->
          <div class="flex-1 min-w-0">
            <input
              type="text"
              bind:value={activeLayer.prompt}
              placeholder={locale.t("canvas.layer.regional_prompt") || "Regional sub-prompt..."}
              class="w-full bg-neutral-900/80 hover:bg-neutral-900 focus:bg-neutral-900 border border-neutral-700/80 focus:border-cyan-500 rounded-xl px-3 py-1.5 text-xs text-neutral-100 placeholder-neutral-500 outline-none transition-colors"
            />
          </div>

          <!-- Weight Slider -->
          <div class="flex items-center gap-1.5 px-2 py-1 rounded-xl bg-neutral-900 border border-neutral-800 shrink-0">
            <span class="text-[10px] text-neutral-400 font-mono">W:</span>
            <input
              type="range"
              bind:value={activeLayer.weight}
              min="0.1"
              max="2.0"
              step="0.05"
              class="w-14 sm:w-20 h-1 accent-cyan-500 cursor-pointer"
            />
            <span class="text-[10px] text-neutral-300 font-mono tabular-nums">{activeLayer.weight.toFixed(2)}</span>
          </div>

          <!-- Snap Bounding Box Button -->
          <button
            onclick={() => canvas.snapBoundingBoxToLayer(activeLayer.id)}
            class="flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-neutral-700 bg-neutral-900 hover:bg-neutral-800 text-neutral-300 hover:text-white text-xs transition-colors cursor-pointer shrink-0"
            title="Snap Bounding Box to Region"
          >
            <span>🎯</span>
            <span class="hidden sm:inline">Snap</span>
          </button>
        </div>

      {:else}
        <!-- 6. DEFAULT IDLE CANVAS WORKSPACE -->
        <!-- Dynamic Mode Indicator Badge -->
        <div
          class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-[11px] font-medium shrink-0 {badge.color}"
          title={locale.t("canvas.contextual.auto_badge_title") || "Smart Modeless Dispatch"}
        >
          <span>{badge.icon}</span>
          <span class="hidden sm:inline">{badge.label}</span>
        </div>

        <!-- Quick Positive Prompt Input -->
        <div class="flex-1 min-w-0 relative">
          <input
            type="text"
            bind:value={generation.positivePrompt}
            onkeydown={handlePromptKeyDown}
            placeholder={action === "inpaint" || action === "outpaint" ? (locale.t("canvas.contextual.prompt_inpaint_placeholder") || "What to paint in mask...") : (locale.t("canvas.contextual.prompt_placeholder") || "Describe the image to generate...")}
            class="w-full bg-neutral-900/80 hover:bg-neutral-900 focus:bg-neutral-900 border border-neutral-700/80 focus:border-indigo-500 rounded-xl px-3 py-1.5 text-xs text-neutral-100 placeholder-neutral-500 outline-none transition-colors"
          />
        </div>

        <!-- Denoise Slider (for img2img / inpaint / outpaint) -->
        {#if action === "img2img" || action === "inpaint" || action === "outpaint"}
          <div class="hidden md:flex items-center gap-1.5 px-2 py-1 rounded-xl bg-neutral-900 border border-neutral-800 shrink-0" title={locale.t("canvas.contextual.denoise") || "Denoise"}>
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
              title="Denoise"
            >D:</span>
            <input
              type="range"
              bind:value={generation.denoise}
              min="0.1"
              max="1"
              step="0.05"
              class="w-14 sm:w-16 h-1 accent-indigo-500 cursor-pointer"
            />
            <span class="text-[10px] text-neutral-300 tabular-nums font-mono">{generation.denoise.toFixed(2)}</span>
          </div>
        {/if}

        <!-- Quick Upscale Action Button -->
        <button
          onclick={() => onUpscale?.()}
          class="hidden lg:flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-neutral-700 hover:border-indigo-500 bg-neutral-900 hover:bg-neutral-800 text-xs text-neutral-300 hover:text-white transition-colors shrink-0 cursor-pointer"
          title={locale.t("canvas.actions.upscale") || "Tile Upscale"}
        >
          <span>🔍</span>
          <span>Upscale</span>
        </button>

        <!-- Main Generate CTA -->
        <button
          onclick={() => onGenerate?.()}
          disabled={isGenerating}
          class="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border border-indigo-500 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-xs font-semibold text-white shadow-lg shadow-indigo-600/20 transition-all shrink-0 cursor-pointer"
          title="Ctrl+Enter"
        >
          <span>{badge.icon}</span>
          <span>{locale.t("canvas.contextual.generate") || "Generate"}</span>
          <kbd class="hidden sm:inline text-[9px] font-mono px-1 py-0.5 bg-indigo-800/60 rounded text-indigo-200">Ctrl+↵</kbd>
        </button>

        <!-- Minimize Button -->
        <button
          onclick={() => { isMinimized = true; }}
          class="text-neutral-500 hover:text-neutral-300 text-xs px-1 py-1 cursor-pointer transition-colors"
          title="Minimize Task Bar"
        >
          ▾
        </button>
      {/if}
    </div>
  {/if}
</div>
