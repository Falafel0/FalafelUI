use serde_json::json;

use super::{
    build_scheduled_conditioning, insert_vae_decode, is_vpred_model, load_model_nodes,
    WorkflowResult,
};
use crate::comfyui::types::GenerationParams;

pub fn build(params: &GenerationParams, seed: i64) -> WorkflowResult {
    let mut workflow = serde_json::Map::new();
    let next_id: u32 = 1;

    // Load model (checkpoint or split UNETLoader + CLIPLoader + VAELoader)
    let ml = load_model_nodes(&mut workflow, next_id, params);
    let mut next_id = ml.next_id;
    let model_source = ml.model_source;
    let clip_source = ml.clip_source;
    let vae_source = ml.vae_source;

    // Positive conditioning (with optional timestep scheduling)
    let (mut pos_source, nid) = build_scheduled_conditioning(
        &mut workflow,
        next_id,
        &clip_source,
        &params.positive_prompt,
        &params.positive_segments,
        params.steps,
    );
    next_id = nid;

    // Negative conditioning (with optional timestep scheduling)
    let (mut neg_source, nid) = build_scheduled_conditioning(
        &mut workflow,
        next_id,
        &clip_source,
        &params.negative_prompt,
        &params.negative_segments,
        params.steps,
    );
    next_id = nid;

    // Regional conditioning (positive and optional negative area conditioning)
    super::regional::inject_regional_conditioning(
        &mut workflow,
        &mut next_id,
        &clip_source,
        &mut pos_source,
        &mut neg_source,
        params,
    );

    // Load input image
    let load_img_id = next_id.to_string();
    workflow.insert(
        load_img_id.clone(),
        json!({
            "class_type": "LoadImage",
            "inputs": {
                "image": params.input_image.as_deref().unwrap_or("")
            }
        }),
    );
    next_id += 1;

    // Resize input image to target dimensions
    let resize_id = next_id.to_string();
    workflow.insert(
        resize_id.clone(),
        json!({
            "class_type": "ImageScale",
            "inputs": {
                "image": [load_img_id, 0],
                "width": params.width,
                "height": params.height,
                "upscale_method": "lanczos",
                "crop": "disabled"
            }
        }),
    );
    next_id += 1;

    // Load mask
    let load_mask_id = next_id.to_string();
    workflow.insert(
        load_mask_id.clone(),
        json!({
            "class_type": "LoadImageMask",
            "inputs": {
                "image": params.mask_image.as_deref().unwrap_or(""),
                "channel": "red"
            }
        }),
    );
    next_id += 1;

    // Optionally grow (dilate) the mask so the inpaint blends past the hard
    // mask edge. The user-configured `grow_mask_by` was previously read into
    // GenerationParams but never wired into the graph. Skipped when 0/None.
    let mask_source = if params.grow_mask_by.unwrap_or(0) > 0 {
        let grow_id = next_id.to_string();
        workflow.insert(
            grow_id.clone(),
            json!({
                "class_type": "GrowMask",
                "inputs": {
                    "mask": [load_mask_id, 0],
                    "expand": params.grow_mask_by.unwrap_or(0),
                    "tapered_corners": true
                }
            }),
        );
        next_id += 1;
        grow_id
    } else {
        load_mask_id
    };

    // Encode source image to latent space.
    let encode_id = next_id.to_string();
    workflow.insert(
        encode_id.clone(),
        json!({
            "class_type": "VAEEncode",
            "inputs": {
                "pixels": [resize_id, 0],
                "vae": [vae_source.0.clone(), vae_source.1]
            }
        }),
    );
    next_id += 1;

    // Apply noise mask so only masked areas get denoised/re-sampled.
    let masked_latent_id = next_id.to_string();
    workflow.insert(
        masked_latent_id.clone(),
        json!({
            "class_type": "SetLatentNoiseMask",
            "inputs": {
                "samples": [encode_id, 0],
                "mask": [mask_source, 0]
            }
        }),
    );
    next_id += 1;

    // VAEEncode yields one latent per input image, so a batch has to be
    // repeated explicitly or batch_size is silently ignored. RepeatLatentBatch
    // carries the noise mask along with the samples.
    let latent_source = if params.batch_size > 1 {
        let repeat_id = next_id.to_string();
        workflow.insert(
            repeat_id.clone(),
            json!({
                "class_type": "RepeatLatentBatch",
                "inputs": {
                    "samples": [masked_latent_id, 0],
                    "amount": params.batch_size
                }
            }),
        );
        next_id += 1;
        repeat_id
    } else {
        masked_latent_id
    };

    let sampler_name_lc = params.sampler_name.to_lowercase();
    let is_cfgpp_sampler = sampler_name_lc.contains("cfg_pp");
    let is_vpred_or_anima = is_vpred_model(params) || params.model_architecture == "anima";

    let use_differential_diffusion = params.differential_diffusion
        || (is_vpred_or_anima && !is_cfgpp_sampler && params.denoise < 1.0);

    let mut sampler_model_source = model_source.clone();
    if use_differential_diffusion {
        let differential_id = next_id.to_string();
        workflow.insert(
            differential_id.clone(),
            json!({
                "class_type": "DifferentialDiffusion",
                "inputs": {
                    "model": [model_source.0.clone(), model_source.1]
                }
            }),
        );
        sampler_model_source = (differential_id, 0);
        next_id += 1;
    }

    // KSampler
    let sampler_id = next_id.to_string();
    workflow.insert(
        sampler_id.clone(),
        json!({
            "class_type": "KSampler",
            "inputs": {
                "model": [sampler_model_source.0.clone(), sampler_model_source.1],
                "positive": [pos_source.0.clone(), pos_source.1],
                "negative": [neg_source.0.clone(), neg_source.1],
                "latent_image": [latent_source, 0],
                "seed": seed,
                "steps": params.steps,
                "cfg": params.cfg,
                "sampler_name": params.sampler_name,
                "scheduler": params.scheduler,
                "denoise": params.denoise
            }
        }),
    );
    next_id += 1;

    // VAE Decode — VAEDecodeTiled for Mugen (Flux2VAE SDXL), VAEDecode otherwise
    let (decode_id, next_id) =
        insert_vae_decode(&mut workflow, next_id, &sampler_id, &vae_source, params);

    WorkflowResult {
        workflow,
        next_id,
        image_output: (decode_id, 0),
        // Expose the model the KSampler is actually wired to (the
        // DifferentialDiffusion node when enabled), not the raw checkpoint.
        // The post-build injectors (vpred/zsnr, cascade, smart-guidance, ...)
        // chain new model patches onto `model_source` and rewire the sampler
        // to them. Returning the raw model here let those injectors re-point
        // the sampler past the DifferentialDiffusion node, silently dropping
        // it — which is exactly the v-pred/Anima inpaint case where it is
        // auto-enabled. Anchoring on the wired model keeps it in the chain.
        model_source: sampler_model_source,
        clip_source,
        positive_source: pos_source,
        negative_source: neg_source,
        vae_source,
        sampler_id,
        refiner_model_source: None,
        base_sources: None,
    }
}

/// Mask-only inpaint using the native `ComfyUI-Inpaint-CropAndStitch` nodes
/// (InpaintCropImproved → sample → InpaintStitchImproved). The crop node trims
/// the base image to the mask bbox + context, scales it to the box resolution,
/// and returns both the cropped image and a stitcher handle. The stitcher
/// stitches the generated patch directly back into the un-cropped base image,
/// so the unmasked area is never touched and never passes through the VAE.
pub fn build_crop_upscale(params: &GenerationParams, seed: i64) -> WorkflowResult {
    let mut workflow = serde_json::Map::new();
    let next_id: u32 = 1;

    // Load model (checkpoint or split UNET/CLIP/VAE)
    let ml = load_model_nodes(&mut workflow, next_id, params);
    let mut next_id = ml.next_id;
    let model_source = ml.model_source;
    let clip_source = ml.clip_source;
    let vae_source = ml.vae_source;

    // Positive / negative conditioning
    let (mut pos_source, nid) = build_scheduled_conditioning(
        &mut workflow,
        next_id,
        &clip_source,
        &params.positive_prompt,
        &params.positive_segments,
        params.steps,
    );
    next_id = nid;
    let (mut neg_source, nid) = build_scheduled_conditioning(
        &mut workflow,
        next_id,
        &clip_source,
        &params.negative_prompt,
        &params.negative_segments,
        params.steps,
    );
    next_id = nid;

    // Regional conditioning (positive and optional negative area conditioning)
    super::regional::inject_regional_conditioning(
        &mut workflow,
        &mut next_id,
        &clip_source,
        &mut pos_source,
        &mut neg_source,
        params,
    );

    // Load input image
    let load_img_id = next_id.to_string();
    workflow.insert(
        load_img_id.clone(),
        json!({
            "class_type": "LoadImage",
            "inputs": { "image": params.input_image.as_deref().unwrap_or("") }
        }),
    );
    next_id += 1;

    // Resize input image to the canvas dimensions so it matches the mask.
    // The mask is drawn on a canvas of params.width x params.height, while the
    // on-disk source file can differ by a pixel or two (887x1182 vs 888x1184),
    // which InpaintCrop's mask/image equality assertion would reject.
    let resize_id = next_id.to_string();
    workflow.insert(
        resize_id.clone(),
        json!({
            "class_type": "ImageScale",
            "inputs": {
                "image": [load_img_id, 0],
                "width": params.width,
                "height": params.height,
                "upscale_method": "lanczos",
                "crop": "disabled"
            }
        }),
    );
    next_id += 1;

    // Load mask
    let load_mask_id = next_id.to_string();
    workflow.insert(
        load_mask_id.clone(),
        json!({
            "class_type": "LoadImageMask",
            "inputs": {
                "image": params.mask_image.as_deref().unwrap_or(""),
                "channel": "red"
            }
        }),
    );
    next_id += 1;

    // Box resolution for the cropped area (falls back to global dimensions)
    let box_w = params.inpaint_mask_width.unwrap_or(params.width);
    let box_h = params.inpaint_mask_height.unwrap_or(params.height);

    // Resize the mask to the same dimensions as the resized image so
    // InpaintCrop's mask==image equality assertion holds (the on-disk mask
    // file and the resized source can differ by a pixel).
    let mask_toimg_id = next_id.to_string();
    workflow.insert(
        mask_toimg_id.clone(),
        json!({
            "class_type": "MaskToImage",
            "inputs": { "mask": [load_mask_id, 0] }
        }),
    );
    next_id += 1;

    let mask_resize_id = next_id.to_string();
    workflow.insert(
        mask_resize_id.clone(),
        json!({
            "class_type": "ImageScale",
            "inputs": {
                "image": [mask_toimg_id, 0],
                "width": params.width,
                "height": params.height,
                "upscale_method": "nearest-exact",
                "crop": "disabled"
            }
        }),
    );
    next_id += 1;

    let mask_convert_id = next_id.to_string();
    workflow.insert(
        mask_convert_id.clone(),
        json!({
            "class_type": "ImageToMask",
            "inputs": {
                "image": [mask_resize_id, 0],
                "channel": "red"
            }
        }),
    );
    next_id += 1;

    // InpaintCropImproved: crop + resize around the mask, hand back a STITCHER.
    let crop_id = next_id.to_string();
    workflow.insert(
        crop_id.clone(),
        json!({
            "class_type": "InpaintCropImproved",
            "inputs": {
                "image": [resize_id, 0],
                "downscale_algorithm": "bicubic",
                "upscale_algorithm": "bicubic",
                "preresize": false,
                "preresize_mode": "ensure minimum resolution",
                "preresize_min_width": 64,
                "preresize_min_height": 64,
                "preresize_max_width": 8192,
                "preresize_max_height": 8192,
                "mask_fill_holes": true,
                "mask_expand_pixels": params.grow_mask_by.unwrap_or(0),
                "mask_invert": false,
                "mask_blend_pixels": params.inpaint_mask_blend.min(64),
                "mask_hipass_filter": params.inpaint_mask_hipass.clamp(0.0, 1.0),
                "extend_for_outpainting": false,
                "extend_up_factor": 1.0,
                "extend_down_factor": 1.0,
                "extend_left_factor": 1.0,
                "extend_right_factor": 1.0,
                "context_from_mask_extend_factor": params.inpaint_context_factor.max(1.0),
                "output_resize_to_target_size": true,
                "output_target_width": box_w,
                "output_target_height": box_h,
                "output_padding": "32",
                "device_mode": params.inpaint_device_mode.clone(),

                // Mask input (resized to match the image dimensions)
                "mask": [mask_convert_id, 0]
            }
        }),
    );
    next_id += 1;

    // VAEEncode the cropped image → latent
    let encode_id = next_id.to_string();
    workflow.insert(
        encode_id.clone(),
        json!({
            "class_type": "VAEEncode",
            "inputs": {
                "pixels": [crop_id.clone(), 1],
                "vae": [vae_source.0.clone(), vae_source.1]
            }
        }),
    );
    next_id += 1;

    // SetLatentNoiseMask on the cropped mask (also from the crop node, index 2)
    let masked_latent_id = next_id.to_string();
    workflow.insert(
        masked_latent_id.clone(),
        json!({
            "class_type": "SetLatentNoiseMask",
            "inputs": {
                "samples": [encode_id, 0],
                "mask": [crop_id.clone(), 2]
            }
        }),
    );
    next_id += 1;

    let latent_source = if params.batch_size > 1 {
        let repeat_id = next_id.to_string();
        workflow.insert(
            repeat_id.clone(),
            json!({
                "class_type": "RepeatLatentBatch",
                "inputs": {
                    "samples": [masked_latent_id, 0],
                    "amount": params.batch_size
                }
            }),
        );
        next_id += 1;
        repeat_id
    } else {
        masked_latent_id
    };

    let sampler_name_lc = params.sampler_name.to_lowercase();
    let is_cfgpp_sampler = sampler_name_lc.contains("cfg_pp");
    let is_vpred_or_anima = is_vpred_model(params) || params.model_architecture == "anima";
    let use_differential_diffusion = params.differential_diffusion
        || (is_vpred_or_anima && !is_cfgpp_sampler && params.denoise < 1.0);

    let mut sampler_model_source = model_source.clone();
    if use_differential_diffusion {
        let differential_id = next_id.to_string();
        workflow.insert(
            differential_id.clone(),
            json!({
                "class_type": "DifferentialDiffusion",
                "inputs": { "model": [model_source.0.clone(), model_source.1] }
            }),
        );
        sampler_model_source = (differential_id, 0);
        next_id += 1;
    }

    // KSampler
    let sampler_id = next_id.to_string();
    workflow.insert(
        sampler_id.clone(),
        json!({
            "class_type": "KSampler",
            "inputs": {
                "model": [sampler_model_source.0.clone(), sampler_model_source.1],
                "positive": [pos_source.0.clone(), pos_source.1],
                "negative": [neg_source.0.clone(), neg_source.1],
                "latent_image": [latent_source, 0],
                "seed": seed,
                "steps": params.steps,
                "cfg": params.cfg,
                "sampler_name": params.sampler_name,
                "scheduler": params.scheduler,
                "denoise": params.denoise
            }
        }),
    );
    next_id += 1;

    // VAE Decode
    let (decode_id, nid) =
        insert_vae_decode(&mut workflow, next_id, &sampler_id, &vae_source, params);
    next_id = nid;

    // InpaintStitchImproved: stitch the inpainted crop back into the original
    let stitch_id = next_id.to_string();
    workflow.insert(
        stitch_id.clone(),
        json!({
            "class_type": "InpaintStitchImproved",
            "inputs": {
                "stitcher": [crop_id, 0],
                "inpainted_image": [decode_id, 0]
            }
        }),
    );
    next_id += 1;

    WorkflowResult {
        workflow,
        next_id,
        image_output: (stitch_id, 0),
        model_source: sampler_model_source,
        clip_source,
        positive_source: pos_source,
        negative_source: neg_source,
        vae_source,
        sampler_id,
        refiner_model_source: None,
        base_sources: None,
    }
}

#[cfg(test)]
mod tests {
    use crate::templates::graph_test_util::{build, linked, nodes, params, single};

    #[test]
    fn batch_size_repeats_the_masked_latent() {
        let mut p = params("inpainting", "sdxl");
        p.batch_size = 4;
        let workflow = build(&p);

        let sampler = single(&workflow, "KSampler");
        let repeat = linked(&workflow, &sampler["inputs"]["latent_image"]);
        assert_eq!(repeat["class_type"], "RepeatLatentBatch");
        assert_eq!(repeat["inputs"]["amount"], 4);
        // Repeated after the noise mask is set, so every copy keeps it.
        assert_eq!(
            linked(&workflow, &repeat["inputs"]["samples"])["class_type"],
            "SetLatentNoiseMask"
        );
    }

    #[test]
    fn single_image_feeds_the_masked_latent_directly() {
        let workflow = build(&params("inpainting", "sdxl"));
        let sampler = single(&workflow, "KSampler");
        assert_eq!(
            linked(&workflow, &sampler["inputs"]["latent_image"])["class_type"],
            "SetLatentNoiseMask"
        );
        assert!(nodes(&workflow, "RepeatLatentBatch").is_empty());
    }

    #[test]
    fn mask_only_inpaint_uses_crop_and_stitch() {
        let mut p = params("inpainting", "sdxl");
        p.inpaint_area = "mask_only".to_string();
        p.inpaint_mask_width = Some(512);
        p.inpaint_mask_height = Some(512);
        let workflow = build(&p);

        let crop = single(&workflow, "InpaintCropImproved");
        assert_eq!(crop["inputs"]["output_target_width"], 512);
        assert_eq!(crop["inputs"]["output_target_height"], 512);

        let stitch = single(&workflow, "InpaintStitchImproved");
        assert_eq!(
            linked(&workflow, &stitch["inputs"]["stitcher"])["class_type"],
            "InpaintCropImproved"
        );
    }
}
