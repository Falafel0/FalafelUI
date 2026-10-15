/**
 * Per-model sampling recommendations, in one place.
 *
 * These are the numbers the "Apply" button in the sampler panel writes. The
 * NovelAI local post-process borrows the sampler, schedule and guidance from
 * the same table: it cannot inherit NovelAI's, because those describe
 * NovelAI's own model and "k_euler_ancestral" / "karras" are not even names
 * ComfyUI's KSampler knows, and the sampler panel is hidden in NovelAI mode so
 * nothing else fills them. Its step count and denoise come from the upscale
 * and face-fix panels instead, which the user can see. The table lives here
 * rather than inside a component because both callers need it.
 */

export interface SamplingRecommendation {
  steps: number;
  cfg: number;
  samplerName: string;
  scheduler: string;
  /** Refine steps for the upscale pass. Left out where the model card has no opinion. */
  upscaleSteps?: number;
  /** Refine steps for FaceDetailer. Left out where the model card has no opinion. */
  facefixSteps?: number;
  upscaleDenoise?: number;
}

/** Anima. Face fix and upscale steps are a third of main steps. */
export const ANIMA_SAMPLING: SamplingRecommendation = {
  steps: 30,
  cfg: 4.0,
  samplerName: "er_sde",
  scheduler: "sgm_uniform",
  upscaleSteps: 10,
  facefixSteps: 10,
};

/**
 * RES4LYF's beta57 scheduler. The Anima model card suggests it for a more
 * painterly or realistic look, since it spends more of the schedule on
 * low-noise steps. It only exists when the RES4LYF node pack is installed, so
 * it is offered only while ComfyUI lists it.
 */
export const BETA57_SCHEDULER = "beta57";

/** Juice / Seele / SIH. */
export const JUICE_SAMPLING: SamplingRecommendation = {
  steps: 20,
  cfg: 1.4,
  samplerName: "euler_cfg_pp",
  scheduler: "sgm_uniform",
  upscaleSteps: 7,
  facefixSteps: 7,
};

/** Nanosaur, which asks for a much heavier refine pass than the others. */
export const NANOSAUR_SAMPLING: SamplingRecommendation = {
  steps: 40,
  cfg: 7,
  samplerName: "euler",
  scheduler: "simple",
  upscaleSteps: 20,
  upscaleDenoise: 0.5,
};

/**
 * Krea 2 Turbo (and Turbo merges such as Wulver). Distilled to run without
 * guidance, so CFG stays at 1: anything higher burns the image and doubles
 * the work. Euler/simple is Krea's own ComfyUI setup; see `kreaFewStep.ts`.
 */
export const KREA2_TURBO_SAMPLING: SamplingRecommendation = {
  steps: 8,
  cfg: 1.0,
  samplerName: "euler",
  scheduler: "simple",
  upscaleSteps: 3,
  facefixSteps: 3,
};

/** Krea 2 Raw, the undistilled weights. Matches the store's Krea 2 preset. */
export const KREA2_SAMPLING: SamplingRecommendation = {
  steps: 30,
  cfg: 4.0,
  samplerName: "er_sde",
  scheduler: "sgm_uniform",
  upscaleSteps: 10,
  facefixSteps: 10,
};

export const PONY_SAMPLING: SamplingRecommendation = {
  steps: 28,
  cfg: 6.0,
  samplerName: "euler_ancestral",
  scheduler: "karras",
  upscaleSteps: 12,
  facefixSteps: 10,
};

export const ILLUSTRIOUS_SAMPLING: SamplingRecommendation = {
  steps: 28,
  cfg: 6.0,
  samplerName: "euler",
  scheduler: "normal",
  upscaleSteps: 10,
  facefixSteps: 10,
};

export const SDXL_SAMPLING: SamplingRecommendation = {
  steps: 30,
  cfg: 6.5,
  samplerName: "dpmpp_2m",
  scheduler: "karras",
  upscaleSteps: 12,
  facefixSteps: 10,
};

export const SD15_SAMPLING: SamplingRecommendation = {
  steps: 25,
  cfg: 7.0,
  samplerName: "dpmpp_2m",
  scheduler: "karras",
  upscaleSteps: 10,
  facefixSteps: 8,
};

export const FLUX_DEV_SAMPLING: SamplingRecommendation = {
  steps: 20,
  cfg: 1.0,
  samplerName: "euler",
  scheduler: "simple",
  upscaleSteps: 8,
};

export const FLUX_SCHNELL_SAMPLING: SamplingRecommendation = {
  steps: 4,
  cfg: 1.0,
  samplerName: "euler",
  scheduler: "simple",
  upscaleSteps: 2,
};

/**
 * A conservative middle for a model nothing is known about.
 *
 * Only the NovelAI local pass uses this: it has to put some sampler in the
 * graph no matter what was picked, whereas the sampler panel simply shows no
 * recommendation and leaves an unrecognised model on the user's own settings.
 */
export const GENERIC_SAMPLING: SamplingRecommendation = {
  steps: 25,
  cfg: 6.0,
  samplerName: "euler",
  scheduler: "normal",
  upscaleSteps: 9,
  facefixSteps: 9,
};

/**
 * The recommendation for a model, or `null` when none is known.
 *
 * The filename is matched as well as the detected `family` because a finetune
 * keeps its base family but is named after the model whose settings it wants.
 * `turbo` is the detected turbo variant, which picks between a family's
 * distilled and undistilled settings where they differ.
 */
export function recommendedSamplingFor(
  filename: string | null | undefined,
  family?: string | null,
  turbo = false,
): SamplingRecommendation | null {
  const name = (filename ?? "").toLowerCase();
  const fam = (family ?? "").toLowerCase();
  if (fam === "krea2") return turbo ? KREA2_TURBO_SAMPLING : KREA2_SAMPLING;
  if (fam === "anima" || name.includes("anima")) return ANIMA_SAMPLING;
  if (name.includes("nanosaur")) return NANOSAUR_SAMPLING;
  if (
    name.includes("juice") ||
    name.includes("seele") ||
    name.includes("sih") ||
    name.includes("σih")
  ) {
    return JUICE_SAMPLING;
  }
  if (fam === "pony" || name.includes("pony")) return PONY_SAMPLING;
  if (fam === "illustrious" || name.includes("illustrious") || name.includes("animagine")) return ILLUSTRIOUS_SAMPLING;
  if (fam === "flux1s") return FLUX_SCHNELL_SAMPLING;
  if (fam.startsWith("flux")) return FLUX_DEV_SAMPLING;
  if (fam === "sdxl" || name.includes("xl")) return SDXL_SAMPLING;
  if (fam === "sd15" || name.includes("v1-5") || name.includes("1.5")) return SD15_SAMPLING;
  return null;
}

/**
 * Ideal baseline resolution for a given model family.
 */
export function recommendedResolutionFor(family?: string | null): { width: number; height: number } | null {
  const fam = (family ?? "").toLowerCase();
  switch (fam) {
    case "sd15":
      return { width: 512, height: 512 };
    case "sdxl":
    case "pony":
    case "illustrious":
    case "anima":
    case "nanosaur":
    case "krea2":
    case "sd3":
    case "cascade":
    case "kolors":
    case "pixart":
    case "hunyuandit":
    case "flux":
    case "flux1d":
    case "flux1s":
    case "flux1krea":
    case "flux2d":
    case "flux2klein9b":
    case "flux2klein9bbase":
    case "flux2klein4b":
    case "flux2klein4bbase":
      return { width: 1024, height: 1024 };
    case "wan":
      return { width: 832, height: 480 };
    default:
      return null;
  }
}

