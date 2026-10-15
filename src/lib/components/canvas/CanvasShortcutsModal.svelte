<script lang="ts">
  import { locale } from "../../stores/locale.svelte.js";

  let { onclose }: { onclose: () => void } = $props();

  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return {
      destroy() {
        node.remove();
      },
    };
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      onclose();
    }
  }

  const toolShortcuts = [
    { key: "B", label: locale.t("canvas.shortcuts.brush") },
    { key: "E", label: locale.t("canvas.shortcuts.eraser") },
    { key: "U", label: locale.t("canvas.shortcuts.inpaint_brush") },
    { key: "Q", label: locale.t("canvas.shortcuts.select_rect") },
    { key: "I", label: locale.t("canvas.shortcuts.eyedropper") },
    { key: "V / H", label: locale.t("canvas.shortcuts.pan_move") },
    { key: "T", label: locale.t("canvas.shortcuts.transform") },
  ];

  const navigationShortcuts = [
    { key: "Space + Drag", label: locale.t("canvas.shortcuts.pan_canvas") },
    { key: "Alt + Wheel", label: locale.t("canvas.shortcuts.zoom_canvas") },
    { key: "[ / ]", label: locale.t("canvas.shortcuts.brush_size") },
    { key: "X", label: locale.t("canvas.color_swap") },
    { key: "D", label: locale.t("canvas.color_reset") },
  ];

  const transformShortcuts = [
    { key: "Enter", label: locale.t("canvas.shortcuts.commit_transform") },
    { key: "Esc", label: locale.t("canvas.shortcuts.cancel_transform") },
    { key: "Del", label: locale.t("canvas.clear") },
  ];

  const layerShortcuts = [
    { key: "Ctrl + Z", label: locale.t("canvas.undo") },
    { key: "Ctrl + Y / ⇧Z", label: locale.t("canvas.redo") },
    { key: "Ctrl + J", label: locale.t("canvas.shortcuts.duplicate_layer") },
    { key: "Ctrl + E", label: locale.t("canvas.shortcuts.merge_down") },
    { key: "Ctrl + ⇧E", label: locale.t("canvas.shortcuts.flatten") },
  ];
</script>

<svelte:window onkeydown={handleKeydown} />

<div
  use:portal
  class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
  role="dialog"
  aria-modal="true"
  aria-labelledby="shortcuts-modal-title"
  tabindex="-1"
  onclick={(e) => {
    if (e.target === e.currentTarget) onclose();
  }}
  onkeydown={(e) => {
    if (e.key === "Escape") onclose();
  }}
>
  <div class="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border border-neutral-700 bg-neutral-900 shadow-2xl overflow-hidden">
    <!-- Header -->
    <div class="flex items-center justify-between border-b border-neutral-800 px-6 py-4">
      <div class="flex items-center gap-2">
        <span class="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-400 font-mono text-sm font-bold">?</span>
        <h2 id="shortcuts-modal-title" class="text-base font-semibold text-neutral-100">{locale.t("canvas.shortcuts.title")}</h2>
      </div>
      <button
        type="button"
        onclick={onclose}
        class="rounded-lg p-1.5 text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-200 cursor-pointer"
        aria-label={locale.t("common.close")}
        title={locale.t("common.close")}
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>

    <!-- Content: 2-column shortcut matrix -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-6 p-6 overflow-y-auto">
      <!-- Tools Column -->
      <div class="space-y-4">
        <div>
          <h3 class="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-2.5 flex items-center gap-1.5">
            <span class="h-1.5 w-1.5 rounded-full bg-indigo-400"></span>
            {locale.t("canvas.shortcuts.tools")}
          </h3>
          <div class="space-y-1.5 rounded-xl border border-neutral-800 bg-neutral-950/60 p-2.5">
            {#each toolShortcuts as item}
              <div class="flex items-center justify-between py-1 px-1.5 rounded hover:bg-neutral-800/40">
                <span class="text-xs text-neutral-300">{item.label}</span>
                <kbd class="rounded border border-neutral-700 bg-neutral-800 px-2 py-0.5 font-mono text-[11px] font-semibold text-neutral-200 shadow-sm">{item.key}</kbd>
              </div>
            {/each}
          </div>
        </div>

        <div>
          <h3 class="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-2.5 flex items-center gap-1.5">
            <span class="h-1.5 w-1.5 rounded-full bg-amber-400"></span>
            {locale.t("canvas.shortcuts.navigation")}
          </h3>
          <div class="space-y-1.5 rounded-xl border border-neutral-800 bg-neutral-950/60 p-2.5">
            {#each navigationShortcuts as item}
              <div class="flex items-center justify-between py-1 px-1.5 rounded hover:bg-neutral-800/40">
                <span class="text-xs text-neutral-300">{item.label}</span>
                <kbd class="rounded border border-neutral-700 bg-neutral-800 px-2 py-0.5 font-mono text-[11px] font-semibold text-neutral-200 shadow-sm">{item.key}</kbd>
              </div>
            {/each}
          </div>
        </div>
      </div>

      <!-- Layers & Transform Column -->
      <div class="space-y-4">
        <div>
          <h3 class="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-2.5 flex items-center gap-1.5">
            <span class="h-1.5 w-1.5 rounded-full bg-emerald-400"></span>
            {locale.t("canvas.shortcuts.layers")}
          </h3>
          <div class="space-y-1.5 rounded-xl border border-neutral-800 bg-neutral-950/60 p-2.5">
            {#each layerShortcuts as item}
              <div class="flex items-center justify-between py-1 px-1.5 rounded hover:bg-neutral-800/40">
                <span class="text-xs text-neutral-300">{item.label}</span>
                <kbd class="rounded border border-neutral-700 bg-neutral-800 px-2 py-0.5 font-mono text-[11px] font-semibold text-neutral-200 shadow-sm">{item.key}</kbd>
              </div>
            {/each}
          </div>
        </div>

        <div>
          <h3 class="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-2.5 flex items-center gap-1.5">
            <span class="h-1.5 w-1.5 rounded-full bg-purple-400"></span>
            {locale.t("canvas.shortcuts.transform")}
          </h3>
          <div class="space-y-1.5 rounded-xl border border-neutral-800 bg-neutral-950/60 p-2.5">
            {#each transformShortcuts as item}
              <div class="flex items-center justify-between py-1 px-1.5 rounded hover:bg-neutral-800/40">
                <span class="text-xs text-neutral-300">{item.label}</span>
                <kbd class="rounded border border-neutral-700 bg-neutral-800 px-2 py-0.5 font-mono text-[11px] font-semibold text-neutral-200 shadow-sm">{item.key}</kbd>
              </div>
            {/each}
          </div>
        </div>
      </div>
    </div>

    <!-- Footer tip -->
    <div class="flex items-center justify-between border-t border-neutral-800 bg-neutral-950/40 px-6 py-3 text-[11px] text-neutral-500">
      <span>Tip: Press <kbd class="rounded bg-neutral-800 px-1.5 py-0.5 font-mono text-neutral-300">?</kbd> anywhere in Studio to open this sheet.</span>
      <button
        type="button"
        onclick={onclose}
        class="rounded-lg bg-neutral-800 hover:bg-neutral-700 px-3 py-1 text-xs text-neutral-200 transition-colors cursor-pointer"
      >
        {locale.t("common.close")}
      </button>
    </div>
  </div>
</div>
