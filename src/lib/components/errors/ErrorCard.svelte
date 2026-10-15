<script lang="ts">
  import { locale } from "../../stores/locale.svelte.js";
  import { exportLogsContent, freeComfyuiMemory } from "../../utils/api.js";
  import type { FriendlyError } from "../../errors/types.js";
  import ReportErrorModal from "./ReportErrorModal.svelte";

  let { error, compact = false }: { error: FriendlyError; compact?: boolean } = $props();

  let detailsOpen = $state(false);
  let copied = $state(false);
  let showReport = $state(false);
  let purging = $state(false);
  let purged = $state(false);

  async function purgeVram() {
    if (purging) return;
    purging = true;
    try {
      await freeComfyuiMemory(true);
      purged = true;
      setTimeout(() => (purged = false), 4000);
    } catch {
      // ignore
    } finally {
      purging = false;
    }
  }

  async function copyDiagnostics() {
    try {
      const logs = await exportLogsContent();
      await navigator.clipboard.writeText(logs || error.raw);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch {
      // Clipboard unavailable; ignore.
    }
  }
</script>

<div class="rounded-lg border border-neutral-700 bg-neutral-900 p-4 text-sm text-neutral-200">
  <h3 class="text-base font-semibold text-neutral-100">{error.title}</h3>
  <p class="mt-1 text-neutral-300">{error.what}</p>

  {#if !compact}
    <p class="mt-2 text-neutral-400"><span class="text-neutral-500">{locale.t("errors.card.why_label")}:</span> {error.why}</p>

    {#if error.fixes.length}
      <p class="mt-3 text-neutral-300">{locale.t("errors.card.fix_label")}</p>
      <ol class="mt-1 list-decimal space-y-1 pl-5 text-neutral-300">
        {#each error.fixes as fix}
          <li>{fix}</li>
        {/each}
      </ol>
    {/if}
  {/if}

  <div class="mt-3 flex flex-wrap items-center gap-2">
    {#if error.code === "out_of_memory"}
      <button
        type="button"
        onclick={purgeVram}
        disabled={purging}
        class="rounded-lg {purged ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-amber-600 hover:bg-amber-500'} px-3 py-1.5 text-white transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50 text-xs font-medium"
      >
        {#if purged}
          <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
          {locale.t("station.status.vram_purged")}
        {:else if purging}
          <div class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
          {locale.t("station.status.purging")}
        {:else}
          <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
          {locale.t("station.status.purge_vram")}
        {/if}
      </button>
    {/if}
    {#if error.reportable}
      <button
        onclick={() => (showReport = true)}
        class="rounded-lg bg-indigo-600 px-3 py-1.5 text-white transition-colors hover:bg-indigo-500"
      >
        {locale.t("errors.card.report")}
      </button>
    {/if}
    <button
      onclick={() => (detailsOpen = !detailsOpen)}
      class="rounded-lg bg-neutral-800 px-3 py-1.5 text-neutral-300 transition-colors hover:bg-neutral-700"
    >
      {locale.t("errors.card.details")}
    </button>
  </div>

  {#if detailsOpen}
    <div class="mt-3 rounded-lg bg-neutral-950 p-3">
      <pre class="max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs text-neutral-400">{error.raw}</pre>
      <button
        onclick={copyDiagnostics}
        class="mt-2 rounded-lg bg-neutral-800 px-3 py-1.5 text-xs text-neutral-300 transition-colors hover:bg-neutral-700"
      >
        {copied ? locale.t("errors.card.copied") : locale.t("errors.card.copy_diagnostics")}
      </button>
    </div>
  {/if}
</div>

{#if showReport}
  <ReportErrorModal {error} onclose={() => (showReport = false)} />
{/if}
