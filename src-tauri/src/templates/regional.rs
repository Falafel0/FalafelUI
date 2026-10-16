use serde_json::json;

use super::{is_sdxl_like_family, strip_lora_tags};
use crate::comfyui::types::GenerationParams;

/// Inject regional conditioning nodes for models that support it (SDXL-family).
///
/// Encodes positive region text (with CLIPTextEncode), applies spatial bounds
/// (with ConditioningSetAreaPercentage), and chains onto the base positive
/// conditioning (with ConditioningCombine).
///
/// If `negative_text` is present and non-empty, sets area percentage for the
/// negative prompt and combines onto the base negative conditioning.
pub fn inject_regional_conditioning(
    workflow: &mut serde_json::Map<String, serde_json::Value>,
    next_id: &mut u32,
    clip_source: &(String, u32),
    pos_source: &mut (String, u32),
    neg_source: &mut (String, u32),
    params: &GenerationParams,
) {
    if !is_sdxl_like_family(&params.model_architecture) || params.positive_regions.is_empty() {
        return;
    }

    for region in &params.positive_regions {
        let x = region.x.clamp(0.0, 1.0);
        let y = region.y.clamp(0.0, 1.0);
        let w = region.width.clamp(0.0, 1.0 - x);
        let h = region.height.clamp(0.0, 1.0 - y);
        if w <= 0.0 || h <= 0.0 {
            continue;
        }

        let strength = region.strength.clamp(0.0, 2.0);

        // Positive regional conditioning
        let pos_text = strip_lora_tags(&region.text).trim().to_string();
        if !pos_text.is_empty() {
            let region_encode_id = next_id.to_string();
            workflow.insert(
                region_encode_id.clone(),
                json!({
                    "class_type": "CLIPTextEncode",
                    "inputs": {
                        "text": pos_text,
                        "clip": [clip_source.0.clone(), clip_source.1]
                    }
                }),
            );
            *next_id += 1;

            let region_area_id = next_id.to_string();
            workflow.insert(
                region_area_id.clone(),
                json!({
                    "class_type": "ConditioningSetAreaPercentage",
                    "inputs": {
                        "conditioning": [region_encode_id, 0],
                        "x": x,
                        "y": y,
                        "width": w,
                        "height": h,
                        "strength": strength
                    }
                }),
            );
            *next_id += 1;

            let region_combine_id = next_id.to_string();
            workflow.insert(
                region_combine_id.clone(),
                json!({
                    "class_type": "ConditioningCombine",
                    "inputs": {
                        "conditioning_1": [pos_source.0.clone(), pos_source.1],
                        "conditioning_2": [region_area_id, 0]
                    }
                }),
            );
            *pos_source = (region_combine_id, 0);
            *next_id += 1;
        }

        // Negative regional conditioning (if negative_text is present and non-empty)
        let neg_text = region
            .negative_text
            .as_deref()
            .map(|t| strip_lora_tags(t).trim().to_string())
            .unwrap_or_default();

        if !neg_text.is_empty() {
            let neg_encode_id = next_id.to_string();
            workflow.insert(
                neg_encode_id.clone(),
                json!({
                    "class_type": "CLIPTextEncode",
                    "inputs": {
                        "text": neg_text,
                        "clip": [clip_source.0.clone(), clip_source.1]
                    }
                }),
            );
            *next_id += 1;

            let neg_area_id = next_id.to_string();
            workflow.insert(
                neg_area_id.clone(),
                json!({
                    "class_type": "ConditioningSetAreaPercentage",
                    "inputs": {
                        "conditioning": [neg_encode_id, 0],
                        "x": x,
                        "y": y,
                        "width": w,
                        "height": h,
                        "strength": strength
                    }
                }),
            );
            *next_id += 1;

            let neg_combine_id = next_id.to_string();
            workflow.insert(
                neg_combine_id.clone(),
                json!({
                    "class_type": "ConditioningCombine",
                    "inputs": {
                        "conditioning_1": [neg_source.0.clone(), neg_source.1],
                        "conditioning_2": [neg_area_id, 0]
                    }
                }),
            );
            *neg_source = (neg_combine_id, 0);
            *next_id += 1;
        }
    }
}
