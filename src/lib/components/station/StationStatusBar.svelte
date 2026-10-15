<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { connection } from "../../stores/connection.svelte.js";
  import { progress } from "../../stores/progress.svelte.js";
  import { queue } from "../../stores/queue.svelte.js";
  import { downloads } from "../../stores/downloads.svelte.js";
  import { generation } from "../../stores/generation.svelte.js";
  import { locale } from "../../stores/locale.svelte.js";
  import { getGpuStats } from "../../utils/api.js";
  import { MODEL_FAMILY_LABELS } from "../../utils/modelFamily.js";
  import type { GpuStats } from "../../types/index.js";

  let gpuStats = $state<GpuStats[]>([]);
  let pollInterval: ReturnType<typeof setInterval> | null = null;
  let fetching = false;

  const primaryGpu = $derived(gpuStats.length > 0 ? gpuStats[0] : null);

  const shortGpuName = $derived.by(() => {
    if (!primaryGpu?.name) return "GPU";
    return primaryGpu.name
      .replace(/^NVIDIA\s+GeForce\s+/i, "")
      .replace(/^NVIDIA\s+/i, "")
      .replace(/^AMD\s+Radeon\s+/i, "")
      .replace(/^AMD\s+/i, "");
  });

  const vramUsedGb = $derived(
    primaryGpu ? (primaryGpu.vram_used_mb / 1024).toFixed(1) : "0"
  );
  const vramTotalGb = $derived(
    primaryGpu ? (primaryGpu.vram_total_mb / 1024).toFixed(1) : "0"
  );
  const vramPercent = $derived.by(() => {
    if (!primaryGpu || primaryGpu.vram_total_mb <= 0) return 0;
    return Math.min(100, Math.round((primaryGpu.vram_used_mb / primaryGpu.vram_total_mb) * 100));
  });

  const activeDownloads = $derived(Array.from(downloads.active.values()));
  const totalDownloadSpeed = $derived.by(() => {
    const bytesPerSec = activeDownloads.reduce((sum, d) => sum + (d.speed || 0), 0);
    if (bytesPerSec <= 0) return "";
    if (bytesPerSec >= 1024 * 1024) {
      return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
    }
    return `${Math.round(bytesPerSec / 1024)} KB/s`;
  });

  const familyLabel = $derived.by(() => {
    if (generation.modelFamily === "unknown") return null;
    return MODEL_FAMILY_LABELS[generation.modelFamily] ?? generation.modelFamily.toUpperCase();
  });

  async function updateGpuStats() {
    if (fetching) return;
    fetching = true;
    try {
      const stats = await getGpuStats();
      if (Array.isArray(stats)) {
        gpuStats = stats;
      }
    } catch {
      // Quiet fail if nvidia-smi / GPU stats unavailable
    } finally {
      fetching = false;
    }
  }

  onMount(() => {
    void updateGpuStats();
    pollInterval = setInterval(() => {
      // Poll only when window is visible to save CPU cycles
      if (typeof document !== "undefined" && document.hidden) return;
      void updateGpuStats();
    }, 3000);
  });

  onDestroy(() => {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  });
</script>

<footer
  class="station-status-bar flex h-7 shrink-0 items-center justify-between border-t border-neutral-800 bg-neutral-950/95 px-3 text-[11px] text-neutral-400 select-none backdrop-blur-md z-40"
  aria-label="Workstation Status Bar"
>
  <!-- Left Section: Backend & GPU Telemetry -->
  <div class="flex items-center gap-3 overflow-hidden">
    <!-- ComfyUI Health Indicator -->
    <div
      class="flex items-center gap-1.5 transition-colors"
      title={connection.connected
        ? locale.t("station.status.comfyui_connected", { url: connection.serverUrl })
        : locale.t("station.status.comfyui_disconnected")}
    >
      <span
        class="h-2 w-2 rounded-full transition-colors {connection.connected
          ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.7)]'
          : 'bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.7)]'}"
        aria-hidden="true"
      ></span>
      <span class="font-medium text-neutral-300">ComfyUI</span>
      <span class="text-[10px] text-neutral-500">
        {connection.connected
          ? locale.t("station.status.connected")
          : locale.t("station.status.offline")}
      </span>
    </div>

    <div class="h-3 w-px bg-neutral-800" aria-hidden="true"></div>

    <!-- GPU Telemetry -->
    {#if primaryGpu}
      <div
        class="flex items-center gap-2"
        title="{primaryGpu.name} (VRAM: {primaryGpu.vram_used_mb}MB / {primaryGpu.vram_total_mb}MB, {primaryGpu.temperature}°C, {primaryGpu.gpu_util}% Util)"
      >
        <span class="text-neutral-300 font-mono text-[10px]">{shortGpuName}</span>
        
        <!-- VRAM Gauge -->
        <div class="flex items-center gap-1.5">
          <span class="text-neutral-400">VRAM:</span>
          <span class="font-mono text-neutral-200">{vramUsedGb}/{vramTotalGb} GB</span>
          
          <div class="relative h-1.5 w-10 overflow-hidden rounded-full bg-neutral-800">
            <div
              class="h-full rounded-full transition-all duration-500 {vramPercent >= 85
                ? 'bg-rose-500'
                : vramPercent >= 70
                  ? 'bg-amber-500'
                  : 'bg-emerald-500'}"
              style="width: {vramPercent}%"
            ></div>
          </div>
          <span class="font-mono text-[10px] text-neutral-500">({vramPercent}%)</span>
        </div>

        <!-- Temp & Util -->
        <span class="text-neutral-500">•</span>
        <span class="font-mono text-neutral-300">{primaryGpu.temperature}°C</span>
        <span class="text-neutral-500">•</span>
        <span class="font-mono text-neutral-300">{primaryGpu.gpu_util}%</span>
      </div>
    {:else}
      <span class="text-neutral-500 font-mono text-[10px]">{locale.t("station.status.gpu_idle")}</span>
    {/if}
  </div>

  <!-- Center Section: Active Model Family Badge -->
  <div class="hidden sm:flex items-center gap-2">
    {#if familyLabel}
      <div
        class="inline-flex items-center gap-1 rounded border border-indigo-500/30 bg-indigo-500/10 px-1.5 py-0.5 text-[10px] text-indigo-300"
        title={generation.checkpoint || generation.diffusionModel || ""}
      >
        <span class="h-1 w-1 rounded-full bg-indigo-400" aria-hidden="true"></span>
        <span class="font-medium">{familyLabel}</span>
      </div>
    {/if}
  </div>

  <!-- Right Section: Queue & Downloads Status -->
  <div class="flex items-center gap-3">
    <!-- Active Downloads Indicator -->
    {#if downloads.hasActive}
      <div
        class="flex items-center gap-1.5 text-amber-300 animate-pulse"
        title={activeDownloads.map((d) => d.filename).join(", ")}
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        <span class="font-mono text-[10px]">
          {locale.t("station.status.downloading", { count: activeDownloads.length })}
          {#if totalDownloadSpeed}({totalDownloadSpeed}){/if}
        </span>
      </div>
      <div class="h-3 w-px bg-neutral-800" aria-hidden="true"></div>
    {/if}

    <!-- Generation Live Progress -->
    {#if progress.isGenerating}
      <div class="flex items-center gap-1.5 text-indigo-400">
        <div class="h-2.5 w-2.5 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent"></div>
        <span class="font-mono text-[10px] text-neutral-300">
          [{progress.currentMode}] {locale.t("station.status.step", {
            current: progress.currentStep,
            total: progress.totalSteps || 1,
          })}
        </span>
      </div>
    {/if}

    <!-- Queue Drawer Toggle -->
    <button
      type="button"
      onclick={() => queue.togglePanel()}
      class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 transition-colors {progress.queueCount > 0
        ? 'bg-neutral-800 text-neutral-200 hover:bg-neutral-700'
        : 'text-neutral-500 hover:text-neutral-300'}"
      title={locale.t("queue.panel.title")}
    >
      <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="8" y1="6" x2="21" y2="6"/>
        <line x1="8" y1="12" x2="21" y2="12"/>
        <line x1="8" y1="18" x2="21" y2="18"/>
        <line x1="3" y1="6" x2="3.01" y2="6"/>
        <line x1="3" y1="12" x2="3.01" y2="12"/>
        <line x1="3" y1="18" x2="3.01" y2="18"/>
      </svg>
      <span class="font-mono text-[10px]">{locale.t("station.status.queue", { count: progress.queueCount })}</span>
    </button>
  </div>
</footer>
