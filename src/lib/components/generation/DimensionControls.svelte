<script lang="ts">
  import { untrack } from "svelte";
  import { generation } from "../../stores/generation.svelte.js";
  import { canvas } from "../../stores/canvas.svelte.js";
  import { locale } from "../../stores/locale.svelte.js";
  import InfoTip from "../ui/InfoTip.svelte";
  import { MODEL_FAMILY_LABELS, type ModelFamily } from "../../utils/modelFamily.js";
  import { NOVELAI_DIMENSION_STEP, naiV5Variant } from "../../utils/novelaiModels.js";
  import { novelai } from "../../stores/novelai.svelte.js";
  import { novelAiOpusCovers } from "../../utils/novelaiCost.js";

  interface Props {
    suggestedAspect?: { w: number; h: number } | null;
  }
  let { suggestedAspect = null }: Props = $props();

  const AR_COLLAPSE_KEY = "mooshieui.generation.aspectRatioCollapsed.v1";
  let arOpen = $state(localStorage.getItem(AR_COLLAPSE_KEY) !== "true");
  let arSaveTimer: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    const collapsed = String(!arOpen);
    if (arSaveTimer) clearTimeout(arSaveTimer);
    arSaveTimer = setTimeout(() => {
      try { localStorage.setItem(AR_COLLAPSE_KEY, collapsed); } catch {}
    }, 300);
  });

  let aspectW = $state(1);
  let aspectH = $state(1);
  let sideLength = $state(1024);
  let aspectWInput = $state("1");
  let aspectHInput = $state("1");
  let lastSyncedDimensions = "";

  /**
   * The pixel grid every dimension has to land on.
   *
   * NovelAI rejects anything that is not a multiple of 64, and its own UI steps
   * the side length 1024 -> 1088 -> 1152. Local backends accept 8, so the
   * coarser grid applies in NovelAI mode only.
   */
  const quantum = $derived(generation.isNovelAi ? NOVELAI_DIMENSION_STEP : 8);

  /** Try to match persisted width/height back to a preset or simplified ratio. */
  /**
   * Largest pair on the pixel grid whose area does not go over `area`.
   *
   * NovelAI prices by pixel count and Opus only covers a generation while it
   * stays at or under one megapixel, so rounding a ratio up past the requested
   * area is what quietly turns a free 1024 generation into a paid one. That is
   * what 2:3 did: the area-faithful formula picked 832x1280, 1.06 MP, while
   * 3:4 happened to round down and stayed free. Walking the width across a few
   * grid steps and taking the tallest height that still fits lands on
   * 832x1216, which is NovelAI's own portrait preset.
   */
  function dimsUnderArea(aw: number, ah: number, area: number, q: number): { w: number; h: number } {
    const target = aw / ah;
    let best: { w: number; h: number; err: number } | null = null;
    const mid = Math.round(Math.sqrt(area * target) / q);
    for (let k = Math.max(1, mid - 2); k <= mid + 2; k++) {
      const w = k * q;
      const h = Math.floor(area / w / q) * q;
      if (h < q) continue;
      // Scored in log space so a result that is too wide and one that is too
      // tall by the same factor are treated as equally far off.
      const err = Math.abs(Math.log(w / h / target));
      if (!best || err < best.err) best = { w, h, err };
    }
    return best ? { w: best.w, h: best.h } : { w: q, h: q };
  }

  /** Compute dimensions for a given aspect ratio using the area-faithful formula. */
  function dimsForAspect(aw: number, ah: number, side: number, q = quantum): { w: number; h: number } {
    const area = side * side;
    if (generation.isNovelAi) return dimsUnderArea(aw, ah, area, q);
    const wA = Math.max(q, Math.round(Math.sqrt(area * (aw / ah)) / q) * q);
    const hA = Math.max(q, Math.round(area / wA / q) * q);
    const hB = Math.max(q, Math.round(Math.sqrt(area * (ah / aw)) / q) * q);
    const wB = Math.max(q, Math.round(area / hB / q) * q);
    return Math.abs(wA * hA - area) <= Math.abs(wB * hB - area)
      ? { w: wA, h: hA }
      : { w: wB, h: hB };
  }

  /**
   * How far (in log space) a pixel ratio may sit from a preset and still be
   * shown as that preset. 0.04 comfortably covers grid snapping (NovelAI's
   * 1216x832 is 2.6% off a true 3:2) while staying well inside half the gap
   * between the closest presets, 4:3 and 3:2 (0.059).
   */
  const PRESET_RATIO_TOLERANCE = 0.04;

  function inferAspectFromDimensions(w: number, h: number) {
    // Check presets first (exact match on resulting dimensions)
    for (const p of presets) {
      const dims = dimsForAspect(p.w, p.h, sideLength);
      if (dims.w === w && dims.h === h) {
        return { w: p.w, h: p.h };
      }
    }
    // Then the nearest preset by ratio. Imported images land on the pixel
    // grid, not on an exact ratio, so 1216x832 should still read as 3:2.
    const ratio = w / h;
    let nearest: { w: number; h: number; err: number } | null = null;
    for (const p of presets) {
      const err = Math.abs(Math.log(ratio / (p.w / p.h)));
      if (!nearest || err < nearest.err) nearest = { w: p.w, h: p.h, err };
    }
    if (nearest && nearest.err <= PRESET_RATIO_TOLERANCE) {
      return { w: nearest.w, h: nearest.h };
    }
    // Fallback: reduce to simplest ratio via GCD
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    const d = gcd(w, h);
    return { w: w / d, h: h / d };
  }

  // Sync aspect ratio UI from generation dimensions (including async settings load)
  $effect(() => {
    const w = generation.width;
    const h = generation.height;
    if (w && h) {
      const key = `${w}x${h}`;
      if (key === lastSyncedDimensions) return;
      lastSyncedDimensions = key;

      syncControlsFromDimensions(w, h);
    }
  });

  // Point the aspect and side-length readouts at the given dimensions without
  // writing anything back to the store.
  function syncControlsFromDimensions(w: number, h: number) {
    const inferred = inferAspectFromDimensions(w, h);
    aspectW = inferred.w;
    aspectH = inferred.h;
    aspectWInput = String(inferred.w);
    aspectHInput = String(inferred.h);

    // Keep side-length control aligned with the current generated area.
    sideLength = Math.max(quantum, Math.round(Math.sqrt(w * h) / quantum) * quantum);
  }

  // When an input image is loaded, adopt its aspect ratio at the current side
  // length. The suggestion arrives as raw pixel dimensions, so reduce it to a
  // ratio first; otherwise the inputs would read "1024 : 1536" instead of
  // "2 : 3". The image never sets the raw pixel size, but the highlighted
  // preset has to be the shape actually requested, so width and height are
  // recomputed from the ratio the same way clicking that preset would.
  // Inpainting is skipped because the store already holds the image's exact
  // size for the mask canvas, and a locked resolution is left alone entirely
  // rather than showing a ratio that is not the one being generated.
  let lastAppliedKey = "";
  $effect(() => {
    if (!suggestedAspect || suggestedAspect.w <= 0 || suggestedAspect.h <= 0) return;
    const key = `${suggestedAspect.w}:${suggestedAspect.h}`;
    if (key === lastAppliedKey) return;
    lastAppliedKey = key;
    const { w, h } = suggestedAspect;
    untrack(() => {
      if (generation.resolutionLocked || generation.mode === "inpainting") return;
      const inferred = inferAspectFromDimensions(w, h);
      applyPreset(inferred.w, inferred.h);
    });
  });

  // The same eight shortcuts on every backend. NovelAI accepts any size on its
  // 64px grid, so the ratio itself is unrestricted there too; only the grid
  // (`quantum`) and the round-down area rule in `dimsUnderArea` differ.
  const presets: ReadonlyArray<{ label: string; w: number; h: number }> = [
    { label: "1:1", w: 1, h: 1 },
    { label: "4:3", w: 4, h: 3 },
    { label: "3:2", w: 3, h: 2 },
    { label: "16:9", w: 16, h: 9 },
    { label: "21:9", w: 21, h: 9 },
    { label: "3:4", w: 3, h: 4 },
    { label: "2:3", w: 2, h: 3 },
    { label: "9:16", w: 9, h: 16 },
  ];

  function recalc() {
    const dims = dimsForAspect(
      Math.max(0.01, aspectW),
      Math.max(0.01, aspectH),
      Math.max(quantum, sideLength),
    );
    generation.width = dims.w;
    generation.height = dims.h;
    // Mark these dimensions as already synced so the $effect doesn't
    // re-infer the aspect ratio and overwrite the user's input.
    lastSyncedDimensions = `${dims.w}x${dims.h}`;
  }

  function applyPreset(w: number, h: number) {
    aspectW = w;
    aspectH = h;
    aspectWInput = String(w);
    aspectHInput = String(h);
    recalc();
  }

  function swapAspect() {
    const tmp = aspectW;
    aspectW = aspectH;
    aspectH = tmp;
    aspectWInput = String(aspectW);
    aspectHInput = String(aspectH);
    recalc();
  }

  function onAspectInput(kind: "w" | "h", value: string) {
    if (kind === "w") {
      aspectWInput = value;
      const parsed = Number.parseFloat(value);
      if (!Number.isNaN(parsed) && Number.isFinite(parsed) && parsed > 0) {
        aspectW = parsed;
        recalc();
      }
      return;
    }

    aspectHInput = value;
    const parsed = Number.parseFloat(value);
    if (!Number.isNaN(parsed) && Number.isFinite(parsed) && parsed > 0) {
      aspectH = parsed;
      recalc();
    }
  }

  const activePreset = $derived(
    presets.find((p) => p.w === aspectW && p.h === aspectH)?.label ?? ""
  );

  /**
   * Which presets Opus covers at the current side length and step count.
   *
   * Only ever populated on an Opus account in NovelAI mode, generating one
   * image at a time: on any other plan, or in a batch, every generation costs
   * Anlas and marking them all would say nothing. The dimensions come from the
   * same `dimsForAspect` the buttons apply, so a green border cannot disagree
   * with what clicking one produces.
   */
  const freePresets = $derived.by(() => {
    const free = new Set<string>();
    if (!generation.isNovelAi || !novelai.isOpus || generation.batchSize !== 1)
      return free;
    // V5 is outside Opus unlimited: with the allowance drained nothing is free.
    if (naiV5Variant(generation.checkpoint) !== null && novelai.opusAllowanceEmpty)
      return free;
    for (const p of presets) {
      const dims = dimsForAspect(p.w, p.h, sideLength);
      if (novelAiOpusCovers(dims.w, dims.h, generation.novelAiSteps, true))
        free.add(p.label);
    }
    return free;
  });

  const DEFAULT_SIDE = 1024;
  const sidePresets = [512, 768, 1024, 1536, 2048];

  function applySideLength(side: number) {
    sideLength = side;
    recalc();
  }

  // Switching backends changes the legal grid, but never the resolution: the
  // store already snaps width and height to 64 when a NovelAI model is
  // selected (1024 stays 1024), and nothing here writes them. Only the
  // readouts (ratio and side length) are re-derived from the dimensions.
  let lastQuantum = 0;
  $effect(() => {
    const q = quantum;
    if (q === lastQuantum) return;
    const first = lastQuantum === 0;
    lastQuantum = q;
    if (first) return;
    untrack(() => {
      const w = generation.width;
      const h = generation.height;
      if (w && h) syncControlsFromDimensions(w, h);
    });
  });

  /** Recommended initial-generation side-length range per model family. */
  function recommendedRange(family: ModelFamily): { min: number; max: number } | null {
    switch (family) {
      case "unknown":
        return null;
      case "sd15":
        return { min: 512, max: 768 };
      case "flux2d":
      case "flux2klein9b":
      case "flux2klein9bbase":
      case "flux2klein4b":
      case "flux2klein4bbase":
        return { min: 1024, max: 2048 };
      case "qwen":
        return { min: 1024, max: 1536 };
      default:
        return { min: 1024, max: 1024 };
    }
  }

  const recommended = $derived(recommendedRange(generation.modelFamily));
  const recommendedLabel = $derived(
    recommended
      ? recommended.min === recommended.max
        ? String(recommended.min)
        : `${recommended.min}–${recommended.max}`
      : ""
  );
  const familyLabel = $derived(MODEL_FAMILY_LABELS[generation.modelFamily] ?? "");

  /** Fit a w:h ratio into a max bounding box for preset preview chips. */
  function aspectPreviewSize(w: number, h: number, boxPx = 12): { w: number; h: number } {
    const ratio = w / h;
    if (ratio >= 1) {
      return { w: boxPx, h: Math.max(3, Math.round(boxPx / ratio)) };
    }
    return { w: Math.max(3, Math.round(boxPx * ratio)), h: boxPx };
  }

  // ── Mask Resize & Forge Inpaint Controls ───────────────────────────────────
  const isInpaintMode = $derived(generation.mode === "inpainting" || canvas.isCanvasMode);

  let maskTargetW = $state(1024);
  let maskTargetH = $state(1024);
  let maskScaleCustom = $state("2");

  $effect(() => {
    maskTargetW = canvas.canvasWidth;
    maskTargetH = canvas.canvasHeight;
  });

  function applyMaskUpscale(factor: number) {
    canvas.upscaleMask(Math.round(canvas.canvasWidth * factor), Math.round(canvas.canvasHeight * factor));
  }

  function applyMaskDownscale() {
    canvas.resetMaskScale();
  }

  function applyMaskCustomSize() {
    if (maskTargetW <= 0 || maskTargetH <= 0) return;
    if (maskTargetW === canvas.canvasWidth && maskTargetH === canvas.canvasHeight) return;

    if (maskTargetW > canvas.canvasWidth || maskTargetH > canvas.canvasHeight) {
      canvas.upscaleMask(Math.round(maskTargetW), Math.round(maskTargetH));
    } else {
      canvas.resetMaskScale();
    }
  }
</script>

<div class="space-y-3">
  <!-- Aspect Ratio -->
  <div>
    <div class="flex items-center mb-1.5">
      <button
        class="flex items-center text-xs text-neutral-400 hover:text-neutral-200 focus:outline-none"
        onclick={() => (arOpen = !arOpen)}
        title={arOpen ? locale.t('common.collapse', { section: locale.t('generation.dimensions.aspect_ratio') }) : locale.t('common.expand', { section: locale.t('generation.dimensions.aspect_ratio') })}
      >{locale.t('generation.dimensions.aspect_ratio')}</button>
      <InfoTip text={locale.t('generation.dimensions.aspect_ratio_tip')} />
      {#if freePresets.size > 0}
        <span
          class="ml-auto mr-1 inline-flex items-center gap-1 rounded-full border border-green-500/40 bg-green-500/10 px-1.5 py-0.5 text-[10px] text-green-400"
          title={locale.t('generation.dimensions.free_opus_tip')}
        >
          <span class="h-1.5 w-1.5 rounded-full bg-green-400"></span>
          {locale.t('generation.dimensions.free_opus')}
        </span>
      {/if}
      <button
        class="{freePresets.size > 0 ? '' : 'ml-auto '}text-neutral-400 hover:text-neutral-200 focus:outline-none"
        onclick={() => (arOpen = !arOpen)}
        title={arOpen ? locale.t('common.collapse', { section: locale.t('generation.dimensions.aspect_ratio') }) : locale.t('common.expand', { section: locale.t('generation.dimensions.aspect_ratio') })}
        aria-label={arOpen ? locale.t('common.collapse', { section: locale.t('generation.dimensions.aspect_ratio') }) : locale.t('common.expand', { section: locale.t('generation.dimensions.aspect_ratio') })}
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5 transition-transform {arOpen ? '' : '-rotate-90'}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
    </div>
    {#if arOpen}
    <div class="flex items-center gap-1 flex-wrap mb-2">
      {#each presets as preset (preset.label)}
        {@const preview = aspectPreviewSize(preset.w, preset.h)}
        {@const isFree = freePresets.has(preset.label)}
        <button
          onclick={() => applyPreset(preset.w, preset.h)}
          class="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded border transition-colors {activePreset === preset.label
            ? isFree
              ? 'bg-indigo-600 border-green-400 text-white'
              : 'bg-indigo-600 border-indigo-600 text-white'
            : isFree
              ? 'bg-neutral-800 border-green-500/60 text-neutral-400 hover:bg-neutral-700'
              : 'bg-neutral-800 border-neutral-700 text-neutral-400 hover:bg-neutral-700'}"
          title={isFree
            ? `${preset.label} - ${locale.t('generation.dimensions.free_opus_tip')}`
            : preset.label}
        >
          <span
            class="inline-flex h-4 w-4 shrink-0 items-center justify-center overflow-visible"
            aria-hidden="true"
          >
            <span
              class="box-border rounded-sm border {activePreset === preset.label
                ? 'border-white/70 bg-white/25'
                : 'border-neutral-500 bg-neutral-600/50'}"
              style="width: {preview.w}px; height: {preview.h}px"
            ></span>
          </span>
          {preset.label}
        </button>
      {/each}
    </div>
    <div class="flex items-center gap-1.5">
      <div class="flex-1">
        <span class="block text-[10px] text-neutral-500 mb-0.5">{locale.t('generation.dimensions.width')}</span>
        <input
          type="text"
          inputmode="decimal"
          value={aspectWInput}
          oninput={(e) => onAspectInput("w", (e.target as HTMLInputElement).value)}
          class="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-2 py-1.5 text-sm text-neutral-100 text-center focus:outline-none focus:border-indigo-500 transition-colors"
        />
      </div>
      <span class="text-neutral-500 text-sm mt-4">:</span>
      <div class="flex-1">
        <span class="block text-[10px] text-neutral-500 mb-0.5">{locale.t('generation.dimensions.height')}</span>
        <input
          type="text"
          inputmode="decimal"
          value={aspectHInput}
          oninput={(e) => onAspectInput("h", (e.target as HTMLInputElement).value)}
          class="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-2 py-1.5 text-sm text-neutral-100 text-center focus:outline-none focus:border-indigo-500 transition-colors"
        />
      </div>
      <button
        onclick={swapAspect}
        class="text-neutral-400 hover:text-neutral-200 transition-colors shrink-0 mt-4"
        title={locale.t('generation.dimensions.swap')}
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4"/>
        </svg>
      </button>
    </div>
    <p class="text-[10px] text-neutral-500 mt-1">{locale.t('generation.dimensions.ratio_hint')}</p>
    {/if}
  </div>

  <!-- Side Length -->
  <div>
    <div class="flex items-center justify-between mb-1.5">
      <label class="text-xs text-neutral-400">{locale.t('generation.dimensions.resolution')}<InfoTip text={locale.t('generation.dimensions.resolution_tip')} /></label>
      <div class="flex items-center gap-2">
        <button
          onclick={() => { generation.resolutionLocked = !generation.resolutionLocked; generation.saveSettings(); }}
          class="inline-flex items-center gap-1 text-[10px] transition-colors {generation.resolutionLocked ? 'text-indigo-400 hover:text-indigo-300' : 'text-neutral-400 hover:text-neutral-200'}"
          title={locale.t('generation.dimensions.lock_tip')}
          aria-pressed={generation.resolutionLocked}
        >
          {#if generation.resolutionLocked}
            <svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
          {:else}
            <svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2"/>
              <path d="M7 11V7a5 5 0 0 1 9.9-1"/>
            </svg>
          {/if}
          {locale.t('generation.dimensions.lock')}
        </button>
        <button
          onclick={() => applySideLength(DEFAULT_SIDE)}
          class="inline-flex items-center gap-1 text-[10px] text-neutral-400 hover:text-neutral-200 transition-colors"
          title={locale.t('generation.dimensions.reset', { res: DEFAULT_SIDE })}
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
            <path d="M3 3v5h5"/>
          </svg>
          {locale.t('generation.dimensions.reset', { res: DEFAULT_SIDE })}
        </button>
      </div>
    </div>
    <div class="flex items-center gap-1 flex-wrap mb-2">
      {#each sidePresets as side (side)}
        {@const isRecommended = recommended !== null && side >= recommended.min && side <= recommended.max}
        <button
          onclick={() => applySideLength(side)}
          class="relative text-xs px-2 py-1 rounded transition-colors {sideLength === side
            ? 'bg-indigo-600 text-white'
            : 'bg-neutral-800 border border-neutral-700 text-neutral-400 hover:bg-neutral-700'}"
          title={isRecommended && familyLabel
            ? locale.t('generation.dimensions.recommended', { model: familyLabel, res: recommendedLabel })
            : String(side)}
        >
          {side}
          {#if isRecommended}
            <span class="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true"></span>
          {/if}
        </button>
      {/each}
    </div>
    <input
      type="number"
      bind:value={sideLength}
      oninput={recalc}
      min="64"
      max="2048"
      step={quantum}
      class="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-1.5 text-sm text-neutral-100 focus:outline-none focus:border-indigo-500 transition-colors"
    />
    {#if recommended && familyLabel}
      {@const targetSide = recommended.min}
      {@const isOptimal = sideLength >= recommended.min && sideLength <= recommended.max}
      <div class="mt-2 flex items-center justify-between">
        <button
          type="button"
          onclick={() => applySideLength(targetSide)}
          class="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition-colors {isOptimal
            ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
            : 'border border-amber-500/40 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25 hover:border-amber-400 cursor-pointer'}"
          title={isOptimal ? locale.t('generation.dimensions.optimal_tip') : locale.t('generation.dimensions.apply_recommended_tip')}
        >
          <span>{isOptimal ? '✓' : '✨'}</span>
          <span>{locale.t('generation.dimensions.recommended_badge', { model: familyLabel, res: recommendedLabel })}</span>
          {#if !isOptimal}
            <span class="underline decoration-dotted text-[10px] ml-1 opacity-90 font-semibold">{locale.t('common.apply')}</span>
          {/if}
        </button>
      </div>
    {/if}
  </div>

  <!-- Resulting dimensions -->
  <div class="flex items-center justify-between text-xs text-neutral-400">
    <span>{locale.t('generation.dimensions.result')}</span>
    <span class="text-neutral-200">{generation.width} &times; {generation.height}</span>
  </div>

  <!-- Mask Resize (whole-picture inpainting only — "Only masked" handles sizing via crop) -->
  {#if isInpaintMode && !canvas.inpaintFullRes}
    <div class="pt-2 border-t border-neutral-800">
      <div class="flex items-center justify-between mb-2">
        <label class="text-xs text-neutral-400">{locale.t('generation.dimensions.mask_resize')}<InfoTip text={locale.t('generation.dimensions.mask_resize_tip')} /></label>
        {#if canvas.isCanvasUpscaled}
          <button
            onclick={applyMaskDownscale}
            class="text-[10px] px-2 py-0.5 rounded border border-amber-600 text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 transition-colors"
          >
            {locale.t('canvas.downscale_mask')}
          </button>
        {/if}
      </div>

      <!-- Current canvas size -->
      <p class="text-[10px] text-neutral-500 mb-2">
        {locale.t('generation.dimensions.mask_current')}: <span class="text-neutral-300">{canvas.canvasWidth} &times; {canvas.canvasHeight}</span>
        {#if canvas.isCanvasUpscaled}
          <span class="text-amber-400 ml-1">({canvas.maskUpscaleFactor}x)</span>
        {/if}
      </p>

      <!-- Quick scale buttons -->
      <div class="flex items-center gap-1 mb-2">
        {#each [2, 3, 4] as factor (factor)}
          <button
            onclick={() => applyMaskUpscale(factor)}
            class="text-xs px-2 py-1 rounded border transition-colors {canvas.maskUpscaleFactor === factor
              ? 'border-indigo-500 text-indigo-300 bg-indigo-500/10'
              : 'border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-neutral-200'}"
          >
            {factor}x
          </button>
        {/each}
        <span class="text-neutral-600 text-xs mx-1">|</span>
        <button
          onclick={() => {
            const f = Number.parseFloat(maskScaleCustom);
            if (Number.isFinite(f) && f > 0.1) applyMaskUpscale(f);
          }}
          class="text-xs px-2 py-1 rounded border border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-neutral-200 transition-colors"
          title={locale.t('generation.dimensions.mask_scale_custom')}
        >
          <input
            type="text"
            inputmode="decimal"
            bind:value={maskScaleCustom}
            class="w-8 bg-transparent text-center text-neutral-200 outline-none text-xs"
            placeholder="?x"
          />x
        </button>
      </div>

      <!-- Custom size inputs -->
      <div class="flex items-center gap-1.5">
        <div class="flex-1">
          <input
            type="number"
            bind:value={maskTargetW}
            min="64"
            max="8192"
            step="8"
            class="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-2 py-1.5 text-xs text-neutral-100 text-center focus:outline-none focus:border-indigo-500 transition-colors"
            placeholder="W"
          />
        </div>
        <span class="text-neutral-600 text-xs">&times;</span>
        <div class="flex-1">
          <input
            type="number"
            bind:value={maskTargetH}
            min="64"
            max="8192"
            step="8"
            class="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-2 py-1.5 text-xs text-neutral-100 text-center focus:outline-none focus:border-indigo-500 transition-colors"
            placeholder="H"
          />
        </div>
        <button
          onclick={applyMaskCustomSize}
          class="text-xs px-3 py-1.5 rounded bg-indigo-600 text-white hover:bg-indigo-500 transition-colors shrink-0"
        >
          {locale.t('generation.dimensions.mask_apply')}
        </button>
      </div>
    </div>
  {/if}

  <!-- Inpaint Controls (Forge-style, canvas mode only) -->
  {#if isInpaintMode && canvas.isCanvasMode}
    <div class="pt-2 border-t border-neutral-800 space-y-2">
      <label class="text-xs text-neutral-400">{locale.t('generation.inpaint.area')}</label>

      <!-- Inpaint area: Whole picture / Only masked -->
      <div class="flex gap-1">
        <button
          onclick={() => canvas.inpaintFullRes = false}
          class="flex-1 text-[10px] px-2 py-1 rounded border transition-colors {!canvas.inpaintFullRes
            ? 'border-indigo-500 text-indigo-300 bg-indigo-500/10'
            : 'border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-neutral-200'}"
        >{locale.t('generation.inpaint.whole_picture')}</button>
        <button
          onclick={() => canvas.inpaintFullRes = true}
          class="flex-1 text-[10px] px-2 py-1 rounded border transition-colors {canvas.inpaintFullRes
            ? 'border-indigo-500 text-indigo-300 bg-indigo-500/10'
            : 'border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-neutral-200'}"
        >{locale.t('generation.inpaint.only_masked')}</button>
      </div>

      {#if canvas.inpaintFullRes}
        <!-- Only masked padding -->
        <div class="flex items-center justify-between gap-2">
          <span class="text-[10px] text-neutral-500">{locale.t('generation.inpaint.padding')}</span>
          <input
            type="range"
            value={canvas.inpaintFullResPadding}
            oninput={(e) => canvas.inpaintFullResPadding = parseInt((e.target as HTMLInputElement).value)}
            min="0"
            max="256"
            step="8"
            class="flex-1 accent-indigo-500 h-1"
          />
          <span class="text-[10px] text-neutral-400 w-7 text-right">{canvas.inpaintFullResPadding}</span>
        </div>
      {/if}

      <!-- Mask blur -->
      <div class="flex items-center justify-between gap-2">
        <span class="text-[10px] text-neutral-500">{locale.t('generation.inpaint.mask_blur')}</span>
        <input
          type="range"
          value={canvas.maskBlur}
          oninput={(e) => canvas.maskBlur = parseInt((e.target as HTMLInputElement).value)}
          min="0"
          max="64"
          step="4"
          class="flex-1 accent-indigo-500 h-1"
        />
        <span class="text-[10px] text-neutral-400 w-5 text-right">{canvas.maskBlur}</span>
      </div>

      <!-- Mask mode -->
      <div class="flex gap-1">
        <button
          onclick={() => canvas.inpaintMaskInvert = false}
          class="flex-1 text-[10px] px-2 py-1 rounded border transition-colors {!canvas.inpaintMaskInvert
            ? 'border-indigo-500 text-indigo-300 bg-indigo-500/10'
            : 'border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-neutral-200'}"
        >{locale.t('generation.inpaint.inpaint_masked')}</button>
        <button
          onclick={() => canvas.inpaintMaskInvert = true}
          class="flex-1 text-[10px] px-2 py-1 rounded border transition-colors {canvas.inpaintMaskInvert
            ? 'border-indigo-500 text-indigo-300 bg-indigo-500/10'
            : 'border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-neutral-200'}"
        >{locale.t('generation.inpaint.inpaint_not_masked')}</button>
      </div>

      <!-- Masked content -->
      <label class="text-[10px] text-neutral-500">{locale.t('generation.inpaint.masked_content')}</label>
      <div class="flex gap-1 flex-wrap">
        {#each [
          { value: 1, key: 'generation.inpaint.fill_original' },
          { value: 0, key: 'generation.inpaint.fill_fill' },
        ] as opt (opt.value)}
          <button
            onclick={() => canvas.inpaintingFill = opt.value}
            class="text-[10px] px-2 py-1 rounded border transition-colors {canvas.inpaintingFill === opt.value
              ? 'border-indigo-500 text-indigo-300 bg-indigo-500/10'
              : 'border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-neutral-200'}"
          >{locale.t(opt.key)}</button>
        {/each}
      </div>
    </div>
  {/if}
</div>
