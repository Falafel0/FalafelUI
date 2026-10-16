<script lang="ts">
  import { canvas, type ToolType } from "../../stores/canvas.svelte.js";
  import { canvasHistory } from "../../stores/canvasHistory.svelte.js";
  import { locale } from "../../stores/locale.svelte.js";
  import BrushSettings from "./controls/BrushSettings.svelte";
  import ToolOptionsBar from "./controls/ToolOptionsBar.svelte";
  import ColorPicker from "./controls/ColorPicker.svelte";
  import CanvasShortcutsModal from "./CanvasShortcutsModal.svelte";

  let showShortcutsModal = $state(false);

  type ToolbarToolId = ToolType | "quickMask";

  interface CanvasToolbarTool {
    id: ToolbarToolId;
    labelKey: string;
    hotkey: string;
    icon: string;
    isToggle?: boolean;
  }

  const tools: CanvasToolbarTool[] = [
    {
      id: "move",
      labelKey: "canvas.move",
      hotkey: "V",
      icon: `<polyline points="5 9 2 12 5 15"/><polyline points="9 5 12 2 15 5"/><polyline points="15 19 12 22 9 19"/><polyline points="19 9 22 12 19 15"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/>`,
    },
    {
      id: "transform",
      labelKey: "canvas.transform",
      hotkey: "T",
      icon: `<path d="M3 7V3h4"/><path d="M17 3h4v4"/><path d="M21 17v4h-4"/><path d="M7 21H3v-4"/><rect x="7" y="7" width="10" height="10" stroke-dasharray="2 2"/>`,
    },
    {
      id: "brush",
      labelKey: "canvas.brush",
      hotkey: "B",
      icon: `<path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/>`,
    },
    {
      id: "eraser",
      labelKey: "canvas.eraser",
      hotkey: "E",
      icon: `<path d="M20 20H7L3 16c-.8-.8-.8-2 0-2.8L13.8 2.4c.8-.8 2-.8 2.8 0L21 6.8c.8.8.8 2 0 2.8L12 18"/>`,
    },
    {
      id: "lasso",
      labelKey: "canvas.lasso",
      hotkey: "L",
      icon: `<path d="M3 14.5A6.5 6.5 0 0 1 2 11c0-4.4 4.5-8 10-8s10 3.6 10 8-4.5 8-10 8a12.6 12.6 0 0 1-4.7-.9"/><path d="M7 21.5a5 5 0 0 1-2-4"/><circle cx="5" cy="16" r="2"/>`,
    },
    {
      id: "rectFill",
      labelKey: "canvas.rectangle",
      hotkey: "M",
      icon: `<rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-dasharray="3 3" fill="none"/>`,
    },
    {
      id: "eyedropper",
      labelKey: "canvas.eyedropper",
      hotkey: "I",
      icon: `<path d="M2 22l1-1h3l9-9"/><path d="M3 21v-3l9-9"/><path d="M14.5 5.5l4-4a1.4 1.4 0 0 1 2 2l-4 4"/>`,
    },
    {
      id: "view",
      labelKey: "canvas.pan",
      hotkey: "H",
      icon: `<path d="M18 11V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2"/><path d="M14 10V4a2 2 0 0 0-2-2 2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-5.7-2.4L3.4 16a2 2 0 0 1 3.2-2.4L8 15"/>`,
    },
    {
      id: "zoom",
      labelKey: "canvas.zoom_in",
      hotkey: "Z",
      icon: `<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>`,
    },
    {
      id: "quickMask",
      labelKey: "canvas.inpaint_mask",
      hotkey: "Q",
      isToggle: true,
      icon: `<rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-dasharray="2 2" fill="none"/><circle cx="12" cy="12" r="5" fill="currentColor"/>`,
    },
  ];

  let fileInputEl: HTMLInputElement | undefined = $state();

  function handleFileSelected(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) {
      void canvas.importProject(file);
      input.value = "";
    }
  }

  function handleToolClick(tool: CanvasToolbarTool) {
    if (tool.id === "quickMask") {
      canvas.toggleQuickMask();
      return;
    }
    canvas.setTool(tool.id as ToolType);
  }

  function handleKeyDown(e: KeyboardEvent) {
    // Don't trigger if typing in an input
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;

    // Toggle Shortcuts Modal (? or F1)
    if (e.key === "?" || (e.shiftKey && e.key === "/") || e.key === "F1") {
      e.preventDefault();
      showShortcutsModal = !showShortcutsModal;
      return;
    }

    // Undo/Redo
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) {
        canvasHistory.redo();
      } else {
        canvasHistory.undo();
      }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
      e.preventDefault();
      canvasHistory.redo();
      return;
    }

    // Free Transform via Ctrl+T
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "t") {
      e.preventDefault();
      canvas.setTool("transform");
      return;
    }

    // Duplicate Layer via Ctrl+J
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "j") {
      e.preventDefault();
      void canvas.duplicateActiveLayer();
      return;
    }

    // Merge Down / Flatten via Ctrl+E / Ctrl+Shift+E
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "e") {
      e.preventDefault();
      if (e.shiftKey) {
        void canvas.flattenLayers();
      } else {
        void canvas.mergeDownActiveLayer();
      }
      return;
    }

    // Delete key — clear active layer
    if (e.key === "Delete") {
      const layer = canvas.activeLayer;
      if (layer && !layer.locked && canvas.activeLayerId) {
        canvasHistory.snapshot(layer.id);
        canvas.clearLayer(layer.id);
      }
      return;
    }

    if (e.key === "\\" || e.key === "|") {
      e.preventDefault();
      canvas.toggleShowOriginal();
      return;
    }

    switch (e.key.toLowerCase()) {
      case "v": canvas.setTool("move"); break;
      case "t": canvas.setTool("transform"); break;
      case "b": canvas.setTool("brush"); break;
      case "e": canvas.setTool("eraser"); break;
      case "l": canvas.setTool("lasso"); break;
      case "m":
      case "u":
        canvas.setTool("rectFill");
        break;
      case "i": canvas.setTool("eyedropper"); break;
      case "h": canvas.setTool("view"); break;
      case "z": canvas.setTool("zoom"); break;
      case "q": canvas.toggleQuickMask(); break;
      case "x": canvas.swapColors(); break;
      case "d": canvas.resetColors(); break;
      case "[": canvas.adjustBrushSize(-5); break;
      case "]": canvas.adjustBrushSize(5); break;
      case "{": canvas.adjustBrushHardness(-0.1); break;
      case "}": canvas.adjustBrushHardness(0.1); break;
    }
  }
</script>

<svelte:window onkeydown={handleKeyDown} />

<div class="flex items-center gap-1.5 px-3 py-1.5 bg-neutral-900/95 border-b border-neutral-800 flex-wrap select-none backdrop-blur-sm">
  <!-- Tool buttons -->
  <div class="flex items-center gap-0.5 bg-neutral-800/40 p-0.5 rounded-lg border border-neutral-800">
    {#each tools as tool}
      <button
        onclick={() => handleToolClick(tool)}
        class="relative w-7 h-7 flex items-center justify-center rounded-md transition-colors {
          tool.id === 'quickMask'
            ? canvas.quickMaskMode
              ? 'bg-rose-600 text-white shadow-sm'
              : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800'
            : canvas.activeTool === tool.id
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800'
        }"
        title="{locale.t(tool.labelKey)} ({tool.hotkey})"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          {@html tool.icon}
        </svg>
      </button>
    {/each}
  </div>

  <div class="w-px h-5 bg-neutral-800 mx-1"></div>

  <BrushSettings />

  <div class="w-px h-5 bg-neutral-800 mx-1"></div>

  <ColorPicker />

  <div class="w-px h-5 bg-neutral-800 mx-1"></div>

  <!-- History: Undo / Redo with icons -->
  <div class="flex items-center gap-1">
    <button
      onclick={() => canvasHistory.undo()}
      disabled={!canvasHistory.canUndo}
      class="w-7 h-7 flex items-center justify-center rounded-md border transition-colors {canvasHistory.canUndo
        ? 'border-neutral-700 bg-neutral-800/80 text-neutral-300 hover:border-indigo-500 hover:text-indigo-300 cursor-pointer'
        : 'border-neutral-800/60 bg-neutral-900/40 text-neutral-600 cursor-not-allowed'}"
      title={locale.t('canvas.undo') + ' (Ctrl+Z)'}
      aria-label={locale.t('canvas.undo')}
    >
      <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>
    </button>
    <button
      onclick={() => canvasHistory.redo()}
      disabled={!canvasHistory.canRedo}
      class="w-7 h-7 flex items-center justify-center rounded-md border transition-colors {canvasHistory.canRedo
        ? 'border-neutral-700 bg-neutral-800/80 text-neutral-300 hover:border-indigo-500 hover:text-indigo-300 cursor-pointer'
        : 'border-neutral-800/60 bg-neutral-900/40 text-neutral-600 cursor-not-allowed'}"
      title={locale.t('canvas.redo') + ' (Ctrl+Shift+Z / Ctrl+Y)'}
      aria-label={locale.t('canvas.redo')}
    >
      <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7"/></svg>
    </button>
  </div>

  <div class="w-px h-5 bg-neutral-800 mx-1"></div>

  <!-- Zoom controls segmented bar -->
  <div class="flex items-center gap-1 bg-neutral-800/50 rounded-md p-0.5 border border-neutral-700/60">
    <button
      onclick={() => canvas.zoomOut()}
      class="w-5 h-5 flex items-center justify-center rounded text-neutral-400 hover:text-neutral-100 hover:bg-neutral-700 transition-colors cursor-pointer"
      title={locale.t('canvas.zoom_out')}
      aria-label={locale.t('canvas.zoom_out')}
    >
      <svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>
    </button>
    <span class="text-[11px] font-mono text-neutral-300 tabular-nums w-9 text-center select-none">{canvas.zoomPercent}%</span>
    <button
      onclick={() => canvas.zoomIn()}
      class="w-5 h-5 flex items-center justify-center rounded text-neutral-400 hover:text-neutral-100 hover:bg-neutral-700 transition-colors cursor-pointer"
      title={locale.t('canvas.zoom_in')}
      aria-label={locale.t('canvas.zoom_in')}
    >
      <svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
    </button>
    <button
      onclick={() => canvas.resetZoom()}
      class="text-[10px] font-mono px-1 py-0.5 rounded text-neutral-400 hover:text-neutral-100 hover:bg-neutral-700 transition-colors cursor-pointer"
      title={locale.t('canvas.reset_zoom')}
    >
      1:1
    </button>
  </div>



  <div class="w-px h-5 bg-neutral-800 mx-1"></div>

  <!-- Before / After comparison toggle -->
  <button
    type="button"
    onclick={() => canvas.toggleShowOriginal()}
    class="px-2 py-1 text-[10px] rounded border transition-colors flex items-center gap-1 cursor-pointer {canvas.showingOriginal
      ? 'border-amber-500 text-amber-300 bg-amber-500/20'
      : 'border-neutral-700 text-neutral-300 hover:border-neutral-500 hover:text-white'}"
    title="{locale.t('canvas.show_original')} ( \ )"
  >
    <svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
    <span>{canvas.showingOriginal ? locale.t('canvas.original_active') : locale.t('canvas.show_original')}</span>
  </button>

  <div class="w-px h-5 bg-neutral-800 mx-1"></div>

  <!-- Project & Export Actions -->
  <input
    bind:this={fileInputEl}
    type="file"
    accept=".falafel,.json"
    class="hidden"
    onchange={handleFileSelected}
  />
  <div class="flex items-center gap-1">
    <button
      onclick={() => void canvas.exportProject()}
      class="px-2 py-1 text-[10px] rounded border border-neutral-700 hover:border-indigo-500 text-neutral-300 hover:text-white transition-colors flex items-center gap-1 cursor-pointer"
      title={locale.t("canvas.project_save")}
    >
      <svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
      <span>{locale.t("canvas.project_save")}</span>
    </button>
    <button
      onclick={() => fileInputEl?.click()}
      class="px-2 py-1 text-[10px] rounded border border-neutral-700 hover:border-indigo-500 text-neutral-300 hover:text-white transition-colors flex items-center gap-1 cursor-pointer"
      title={locale.t("canvas.project_open")}
    >
      <svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
      <span>{locale.t("canvas.project_open")}</span>
    </button>
    <button
      onclick={() => canvas.exportCompositePng()}
      class="px-2 py-1 text-[10px] rounded border border-neutral-700 hover:border-indigo-500 text-neutral-300 hover:text-white transition-colors flex items-center gap-1 cursor-pointer"
      title={locale.t("canvas.export_png")}
    >
      <svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      <span>PNG</span>
    </button>
    <button
      type="button"
      onclick={() => (showShortcutsModal = true)}
      class="w-6 h-6 flex items-center justify-center rounded border border-neutral-700 hover:border-indigo-500 text-neutral-400 hover:text-white hover:bg-neutral-800 text-[11px] font-mono font-bold transition-colors cursor-pointer"
      title={locale.t("canvas.shortcuts.title")}
      aria-label={locale.t("canvas.shortcuts.title")}
    >
      ?
    </button>
  </div>
</div>

<ToolOptionsBar />

{#if showShortcutsModal}
  <CanvasShortcutsModal onclose={() => (showShortcutsModal = false)} />
{/if}
