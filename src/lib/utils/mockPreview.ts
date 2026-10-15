/**
 * Lightweight mock preview harness for offline UI testing and capturing screenshots.
 * Only active when `window.location.search` contains `preview=`.
 */
import { connection } from "../stores/connection.svelte.js";
import { startup } from "../stores/startup.svelte.js";
import { models } from "../stores/models.svelte.js";
import { generation } from "../stores/generation.svelte.js";
import { locale } from "../stores/locale.svelte.js";

export function initMockPreview() {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  const preview = params.get("preview");
  if (!preview) return;

  const targetLang = (params.get("lang") as any) || "ru";
  locale.current = targetLang;

  // Dismiss interrogation sidebar hint for clean screenshots
  try {
    localStorage.setItem("mooshieui.hint.interrogate-sidebar.v1", "true");
  } catch {}

  console.info(`[MockPreview] Initializing mock mode: ${preview}, lang: ${targetLang}`);

  const isMain = preview === "main" || preview === "gallery" || preview === "settings";
  const isDetected = preview === "setup_detected";

  (window as any).__IPC_MOCK__ = async (command: string, args?: any) => {
    switch (command) {
      case "check_setup":
        return isMain;

      case "get_config":
        return {
          theme_palette: "falafel",
          accent_color: "#a855f7",
          theme_tone: "#a855f7",
          font_scale: 1,
          locale: targetLang,
          server_mode: "autolaunch",
          server_url: "http://127.0.0.1:8188",
          server_port: 8188,
          auto_start: true,
          keep_alive: false,
          allow_remote: false,
          extra_args: [],
          attention_backend: "default",
          extra_model_paths: "",
          comfyui_path: "C:\\Users\\FSD\\AppData\\Roaming\\com.falafelui.desktop\\ComfyUI",
          models_path: "C:\\Users\\FSD\\AppData\\Roaming\\com.falafelui.desktop\\ComfyUI\\models",
          output_path: "C:\\Users\\FSD\\AppData\\Roaming\\com.falafelui.desktop\\outputs",
        };

      case "detect_gpu":
        return "nvidia";

      case "get_install_path":
        return "C:\\Users\\FSD\\AppData\\Roaming\\com.falafelui.desktop";

      case "detect_model_directories":
        return [];

      case "detect_existing_mooshie_install":
        if (isDetected) {
          return {
            found: true,
            path: "C:\\Users\\FSD\\AppData\\Roaming\\com.mooshieui.desktop",
            has_comfyui: true,
            has_venv: true,
            has_models: true,
            model_count: 14,
          };
        }
        return { found: false, path: "", has_comfyui: false, has_venv: false, has_models: false, model_count: 0 };

      case "validate_existing_install":
        return {
          valid: true,
          has_comfyui: true,
          has_venv: true,
          has_models: true,
          model_count: 14,
          error: null,
        };

      case "get_models": {
        const cat = args?.category;
        if (cat === "checkpoints") {
          return ["FalafelAnime_v1.safetensors", "AnimagineXL_v3.safetensors", "PonyDiffusionV6.safetensors"];
        }
        if (cat === "vae") {
          return ["sdxl_vae.safetensors", "vae-ft-mse-840000-ema-pruned.safetensors"];
        }
        if (cat === "loras") {
          return ["detail_enhancer.safetensors", "lineart_master.safetensors"];
        }
        return [];
      }

      case "get_samplers":
        return {
          samplers: ["euler_ancestral", "euler", "dpmpp_2m_sde", "ddim", "uni_pc"],
          schedulers: ["karras", "normal", "exponential", "sgm_uniform", "beta"],
        };

      case "get_embeddings":
        return ["easynegative", "badhandv4", "verybadimagenegative"];

      case "list_model_files":
        return [];

      case "get_queue":
        return { queue_running: [], queue_pending: [] };

      case "get_system_info":
        return {
          os: "windows",
          cpu: "AMD Ryzen 7 7800X3D",
          gpu: "NVIDIA GeForce RTX 4070 Ti SUPER (16GB)",
          ram_total: 34359738368,
          ram_free: 20000000000,
          vram_total: 17179869184,
          vram_free: 14000000000,
        };

      case "check_attention_backend":
        return { supported: true, backends: [] };

      case "get_backend_status":
        return { running: true, pid: 1234, port: 8188 };

      case "get_gpu_stats":
        return [
          {
            index: 0,
            name: "NVIDIA GeForce RTX 3060",
            vram_used_mb: 2840,
            vram_total_mb: 12288,
            gpu_util: 18,
            temperature: 46,
            power_draw_w: 68,
            worker: null,
          },
        ];

      case "get_gallery_images":
        return [];

      default:
        return null;
    }
  };

  if (isMain) {
    // Unlock and connect stores
    setTimeout(() => {
      connection.connected = true;
      connection.serverUrl = "http://127.0.0.1:8188";
      startup.locked = false;

      models.checkpoints = ["FalafelAnime_v1.safetensors", "AnimagineXL_v3.safetensors", "PonyDiffusionV6.safetensors"];
      models.vaes = ["sdxl_vae.safetensors"];
      models.loras = ["detail_enhancer.safetensors", "lineart_master.safetensors"];
      models.samplers = ["euler_ancestral", "euler", "dpmpp_2m_sde", "ddim"];
      models.schedulers = ["karras", "normal", "exponential", "sgm_uniform"];

      generation.checkpoint = "FalafelAnime_v1.safetensors";
      generation.positivePrompt = "1girl, solo, purple eyes, violet hair, glowing neon accents, cyberpunk city, detailed, masterpiece";
      generation.samplerName = "euler_ancestral";
      generation.scheduler = "karras";
      generation.steps = 28;
      generation.cfg = 6.5;
      generation.width = 1024;
      generation.height = 1024;
    }, 150);
  }
}
