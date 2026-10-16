<script lang="ts">
  import { canvas } from "../../../stores/canvas.svelte.js";
  import { generation } from "../../../stores/generation.svelte.js";
  import { locale } from "../../../stores/locale.svelte.js";

  let lockedAspect = $state(false);
  let initialAspect = $state(1.0);

  function alignQuantum8(val: number): number {
    return Math.max(64, Math.round(val / 8) * 8);
  }

  function handleWidthChange(newWidth: number) {
    const w = alignQuantum8(newWidth);
    if (lockedAspect && initialAspect > 0) {
      const h = alignQuantum8(w / initialAspect);
      canvas.boundingBox = { ...canvas.boundingBox, width: w, height: h };
      generation.width = w;
      generation.height = h;
    } else {
      canvas.boundingBox = { ...canvas.boundingBox, width: w };
      generation.width = w;
    }
  }

  function handleHeightChange(newHeight: number) {
    const h = alignQuantum8(newHeight);
    if (lockedAspect && initialAspect > 0) {
      const w = alignQuantum8(h * initialAspect);
      canvas.boundingBox = { ...canvas.boundingBox, width: w, height: h };
      generation.width = w;
      generation.height = h;
    } else {
      canvas.boundingBox = { ...canvas.boundingBox, height: h };
      generation.height = h;
    }
  }

  function toggleAspectLock() {
    lockedAspect = !lockedAspect;
    if (lockedAspect && canvas.boundingBox.height > 0) {
      initialAspect = canvas.boundingBox.width / canvas.boundingBox.height;
    }
  }

  function setAspectPreset(wRatio: number, hRatio: number) {
    const baseDim = 1024;
    const w = alignQuantum8((baseDim * wRatio) / Math.max(wRatio, hRatio));
    const h = alignQuantum8((baseDim * hRatio) / Math.max(wRatio, hRatio));
    canvas.boundingBox = { ...canvas.boundingBox, width: w, height: h };
    generation.width = w;
    generation.height = h;
    initialAspect = w / h;
  }

  const smartModeBadge = $derived.by(() => {
    const act = canvas.currentUnifiedAction;
    switch (act) {
      case "outpaint":
        return { label: "Outpaint", color: "bg-amber-500/20 text-amber-300 border-amber-500/40" };
      case "inpaint":
        return { label: "Inpaint", color: "bg-rose-500/20 text-rose-300 border-rose-500/40" };
      case "img2img":
        return { label: "Img2Img", color: "bg-indigo-500/20 text-indigo-300 border-indigo-500/40" };
      case "txt2img":
      default:
        return { label: "Txt2Img", color: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40" };
    }
  });
</script>

<div class="flex flex-col space-y-3 p-3 bg-neutral-900/60 rounded-xl border border-neutral-800 text-xs text-neutral-300 select-none">
  <!-- Header with Smart Mode indicator -->
  <div class="flex items-center justify-between pb-2 border-b border-neutral-800">
    <div class="flex items-center gap-1.5 font-semibold text-neutral-200">
      <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5 text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>
      <span>Bounding Box & Generation Bounds</span>
    </div>
    <span
      class="px-2 py-0.5 rounded text-[10px] font-mono font-bold border {smartModeBadge.color}"
      title="Auto-detected generation dispatch action"
    >
      {smartModeBadge.label}
    </span>
  </div>

  <!-- Numeric Box Inputs (X, Y, W, H) -->
  <div class="grid grid-cols-2 gap-2 font-mono text-[11px]">
    <label class="flex items-center justify-between gap-1 text-neutral-400 bg-neutral-900 p-1.5 rounded border border-neutral-800">
      <span>X:</span>
      <input
        type="number"
        value={canvas.boundingBox.x}
        onchange={(e) => canvas.boundingBox = { ...canvas.boundingBox, x: Math.round(parseFloat((e.target as HTMLInputElement).value) || 0) }}
        class="w-14 bg-neutral-950 border border-neutral-700 rounded px-1.5 py-0.5 text-neutral-200 text-right outline-none focus:border-indigo-500"
      />
    </label>
    <label class="flex items-center justify-between gap-1 text-neutral-400 bg-neutral-900 p-1.5 rounded border border-neutral-800">
      <span>Y:</span>
      <input
        type="number"
        value={canvas.boundingBox.y}
        onchange={(e) => canvas.boundingBox = { ...canvas.boundingBox, y: Math.round(parseFloat((e.target as HTMLInputElement).value) || 0) }}
        class="w-14 bg-neutral-950 border border-neutral-700 rounded px-1.5 py-0.5 text-neutral-200 text-right outline-none focus:border-indigo-500"
      />
    </label>
    <label class="flex items-center justify-between gap-1 text-neutral-400 bg-neutral-900 p-1.5 rounded border border-neutral-800">
      <span>W:</span>
      <input
        type="number"
        step="8"
        min="64"
        max="8192"
        value={canvas.boundingBox.width}
        onchange={(e) => handleWidthChange(parseFloat((e.target as HTMLInputElement).value) || 1024)}
        class="w-14 bg-neutral-950 border border-neutral-700 rounded px-1.5 py-0.5 text-neutral-200 text-right outline-none focus:border-indigo-500"
      />
    </label>
    <label class="flex items-center justify-between gap-1 text-neutral-400 bg-neutral-900 p-1.5 rounded border border-neutral-800">
      <span>H:</span>
      <input
        type="number"
        step="8"
        min="64"
        max="8192"
        value={canvas.boundingBox.height}
        onchange={(e) => handleHeightChange(parseFloat((e.target as HTMLInputElement).value) || 1024)}
        class="w-14 bg-neutral-950 border border-neutral-700 rounded px-1.5 py-0.5 text-neutral-200 text-right outline-none focus:border-indigo-500"
      />
    </label>
  </div>

  <!-- Aspect Ratio Presets and Lock Toggle -->
  <div class="flex items-center justify-between gap-1 pt-1">
    <div class="flex items-center gap-1">
      <button
        onclick={() => setAspectPreset(1, 1)}
        class="px-1.5 py-0.5 rounded text-[10px] font-mono border border-neutral-700 hover:border-neutral-500 text-neutral-300 hover:text-white transition-colors"
      >1:1</button>
      <button
        onclick={() => setAspectPreset(16, 9)}
        class="px-1.5 py-0.5 rounded text-[10px] font-mono border border-neutral-700 hover:border-neutral-500 text-neutral-300 hover:text-white transition-colors"
      >16:9</button>
      <button
        onclick={() => setAspectPreset(9, 16)}
        class="px-1.5 py-0.5 rounded text-[10px] font-mono border border-neutral-700 hover:border-neutral-500 text-neutral-300 hover:text-white transition-colors"
      >9:16</button>
      <button
        onclick={() => setAspectPreset(4, 3)}
        class="px-1.5 py-0.5 rounded text-[10px] font-mono border border-neutral-700 hover:border-neutral-500 text-neutral-300 hover:text-white transition-colors"
      >4:3</button>
    </div>

    <button
      onclick={toggleAspectLock}
      class="px-2 py-0.5 rounded text-[10px] font-medium border transition-colors {lockedAspect
        ? 'bg-indigo-600/30 border-indigo-500/60 text-indigo-300'
        : 'bg-neutral-800 border-neutral-700 text-neutral-400 hover:text-neutral-200'}"
      title="Lock Aspect Ratio"
    >
      {lockedAspect ? "🔒 Locked" : "🔓 Unlocked"}
    </button>
  </div>

  <!-- Snap to Layer and Reset Actions -->
  <div class="grid grid-cols-2 gap-2 pt-1 border-t border-neutral-800">
    <button
      onclick={() => canvas.snapBoundingBoxToLayer()}
      class="py-1 px-2 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-neutral-200 text-[10px] font-medium transition-colors text-center"
      title="Snap bounding box to the currently selected layer bounds"
    >
      Snap to Layer
    </button>
    <button
      onclick={() => canvas.resetBoundingBoxToCanvas()}
      class="py-1 px-2 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-neutral-200 text-[10px] font-medium transition-colors text-center"
      title="Reset bounding box to fill the entire canvas"
    >
      Reset to Canvas
    </button>
  </div>
</div>
