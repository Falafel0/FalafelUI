use comfyui_desktop_lib::comfyui::types::{ControlNetParam, GenerationParams, PositiveRegion};
use comfyui_desktop_lib::templates::{build_workflow, validate_generation_params};
use serde_json::{json, Value};

fn base_test_params(mode: &str, arch: &str) -> GenerationParams {
    let mut p = GenerationParams::default();
    p.mode = mode.to_string();
    p.model_architecture = arch.to_string();
    p.checkpoint = "sd_xl_base_1.0.safetensors".to_string();
    p.sampler_name = "euler".to_string();
    p.scheduler = "normal".to_string();
    p.steps = 20;
    p.cfg = 7.0;
    p.width = 1024;
    p.height = 1024;
    p.positive_prompt = "masterpiece, best quality".to_string();
    p.negative_prompt = "low quality, blurry".to_string();
    if mode == "img2img" || mode == "inpainting" {
        p.input_image = Some("input.png".to_string());
    }
    if mode == "inpainting" {
        p.mask_image = Some("mask.png".to_string());
    }
    p
}

fn count_nodes_by_type(workflow: &Value, class_type: &str) -> usize {
    workflow
        .as_object()
        .map(|map| {
            map.values()
                .filter(|node| {
                    node.get("class_type")
                        .and_then(|ct| ct.as_str())
                        .map(|ct| ct == class_type)
                        .unwrap_or(false)
                })
                .count()
        })
        .unwrap_or(0)
}

fn get_nodes_by_type<'a>(
    workflow: &'a Value,
    class_type: &str,
) -> Vec<(&'a String, &'a serde_json::Map<String, Value>)> {
    let mut result = Vec::new();
    if let Some(map) = workflow.as_object() {
        for (id, node) in map {
            if let Some(node_obj) = node.as_object() {
                if node_obj
                    .get("class_type")
                    .and_then(|ct| ct.as_str())
                    .map(|ct| ct == class_type)
                    .unwrap_or(false)
                {
                    result.push((id, node_obj));
                }
            }
        }
    }
    result
}

// ============================================================================
// 1. Regional Conditioning Adversarial Tests: 0, 1, 5 Overlapping Regions
// ============================================================================

#[test]
fn test_regional_0_regions_produces_no_area_nodes() {
    let mut p = base_test_params("txt2img", "sdxl");
    p.positive_regions = vec![];

    let wf = build_workflow(&p, 42, false);
    assert_eq!(
        count_nodes_by_type(&wf, "ConditioningSetAreaPercentage"),
        0,
        "0 regions must produce 0 ConditioningSetAreaPercentage nodes"
    );
    assert_eq!(
        count_nodes_by_type(&wf, "ConditioningCombine"),
        0,
        "0 regions must produce 0 ConditioningCombine nodes"
    );
}

#[test]
fn test_regional_1_region_pos_and_neg() {
    let mut p = base_test_params("txt2img", "sdxl");
    p.positive_regions = vec![PositiveRegion {
        text: "red hat".to_string(),
        negative_text: Some("blue hat".to_string()),
        x: 0.1,
        y: 0.1,
        width: 0.4,
        height: 0.3,
        strength: 0.8,
    }];

    let wf = build_workflow(&p, 42, false);
    assert_eq!(
        count_nodes_by_type(&wf, "ConditioningSetAreaPercentage"),
        2,
        "1 region with pos & neg must produce exactly 2 ConditioningSetAreaPercentage nodes"
    );
    assert_eq!(
        count_nodes_by_type(&wf, "ConditioningCombine"),
        2,
        "1 region with pos & neg must produce exactly 2 ConditioningCombine nodes"
    );
}

#[test]
fn test_regional_5_overlapping_regions_in_txt2img_and_inpainting() {
    for mode in ["txt2img", "img2img", "inpainting"] {
        let mut p = base_test_params(mode, "sdxl");
        p.positive_regions = (0..5)
            .map(|i| PositiveRegion {
                text: format!("layer {} details, gold filigree", i),
                negative_text: Some(format!("layer {} artifacts", i)),
                x: 0.05 * (i as f64),
                y: 0.05 * (i as f64),
                width: 0.6,
                height: 0.6,
                strength: 1.0,
            })
            .collect();

        let wf = build_workflow(&p, 42, false);
        // 5 regions * 2 (pos + neg) = 10 area nodes
        assert_eq!(
            count_nodes_by_type(&wf, "ConditioningSetAreaPercentage"),
            10,
            "mode {mode}: 5 overlapping regions must produce 10 ConditioningSetAreaPercentage nodes"
        );
        assert_eq!(
            count_nodes_by_type(&wf, "ConditioningCombine"),
            10,
            "mode {mode}: 5 overlapping regions must produce 10 ConditioningCombine nodes"
        );

        // Verify KSampler receives the final combined conditioning
        let samplers = get_nodes_by_type(&wf, "KSampler");
        assert!(!samplers.is_empty(), "mode {mode}: must contain KSampler");
        let sampler_inputs = samplers[0].1.get("inputs").unwrap();
        let pos_link = sampler_inputs.get("positive").unwrap().as_array().unwrap();
        let neg_link = sampler_inputs.get("negative").unwrap().as_array().unwrap();

        let pos_final_node = wf.get(pos_link[0].as_str().unwrap()).unwrap();
        let neg_final_node = wf.get(neg_link[0].as_str().unwrap()).unwrap();

        assert_eq!(
            pos_final_node.get("class_type").unwrap().as_str().unwrap(),
            "ConditioningCombine",
            "pos link must terminate in ConditioningCombine"
        );
        assert_eq!(
            neg_final_node.get("class_type").unwrap().as_str().unwrap(),
            "ConditioningCombine",
            "neg link must terminate in ConditioningCombine"
        );
    }
}

// ============================================================================
// 2. Negative Prompt Regions: Empty, Whitespace, Unicode, LoRA Stripping
// ============================================================================

#[test]
fn test_regional_negative_empty_and_whitespace_skipped() {
    let mut p = base_test_params("txt2img", "sdxl");
    p.positive_regions = vec![
        PositiveRegion {
            text: "pos text 1".to_string(),
            negative_text: None,
            x: 0.0,
            y: 0.0,
            width: 0.5,
            height: 0.5,
            strength: 1.0,
        },
        PositiveRegion {
            text: "pos text 2".to_string(),
            negative_text: Some("".to_string()),
            x: 0.1,
            y: 0.1,
            width: 0.5,
            height: 0.5,
            strength: 1.0,
        },
        PositiveRegion {
            text: "pos text 3".to_string(),
            negative_text: Some("   \t\n  \r\n  ".to_string()),
            x: 0.2,
            y: 0.2,
            width: 0.5,
            height: 0.5,
            strength: 1.0,
        },
    ];

    let wf = build_workflow(&p, 42, false);
    // Only 3 positive regions should be encoded, 0 negative regions
    assert_eq!(
        count_nodes_by_type(&wf, "ConditioningSetAreaPercentage"),
        3,
        "empty/whitespace negative prompts must not generate area nodes"
    );
    assert_eq!(
        count_nodes_by_type(&wf, "ConditioningCombine"),
        3,
        "empty/whitespace negative prompts must not generate negative combine nodes"
    );
}

#[test]
fn test_regional_negative_unicode_prompts() {
    let mut p = base_test_params("txt2img", "sdxl");
    let unicode_pos = "красивая корона 👑, 美しい花 🌸, élégante vôtre";
    let unicode_neg = "грязь, ぼやけた, flou désastreux, 💩 <lora:bad_face:1.0>";

    p.positive_regions = vec![PositiveRegion {
        text: unicode_pos.to_string(),
        negative_text: Some(unicode_neg.to_string()),
        x: 0.2,
        y: 0.2,
        width: 0.5,
        height: 0.5,
        strength: 1.1,
    }];

    let wf = build_workflow(&p, 42, false);
    assert_eq!(count_nodes_by_type(&wf, "ConditioningSetAreaPercentage"), 2);

    // Verify encoded texts include unicode and stripped lora
    let clip_encodes = get_nodes_by_type(&wf, "CLIPTextEncode");
    let texts: Vec<&str> = clip_encodes
        .iter()
        .filter_map(|(_, n)| {
            n.get("inputs")
                .and_then(|i| i.get("text"))
                .and_then(|t| t.as_str())
        })
        .collect();

    assert!(
        texts.iter().any(|t| t.contains("красивая корона 👑")),
        "must contain cyrillic & emoji pos prompt"
    );
    assert!(
        texts
            .iter()
            .any(|t| t.contains("грязь, ぼやけた, flou désastreux, 💩")),
        "must contain multi-script unicode neg prompt without lora tag"
    );
    assert!(
        !texts.iter().any(|t| t.contains("<lora:")),
        "LoRA tags must be completely stripped"
    );
}

#[test]
fn test_regional_empty_positive_with_valid_negative() {
    let mut p = base_test_params("txt2img", "sdxl");
    p.positive_regions = vec![PositiveRegion {
        text: "   ".to_string(), // Empty pos
        negative_text: Some("no defects".to_string()),
        x: 0.1,
        y: 0.1,
        width: 0.4,
        height: 0.4,
        strength: 1.0,
    }];

    let wf = build_workflow(&p, 42, false);
    // Exactly 1 area node for negative, 0 for positive
    assert_eq!(
        count_nodes_by_type(&wf, "ConditioningSetAreaPercentage"),
        1,
        "empty positive with valid negative must inject only 1 negative area node"
    );
    assert_eq!(
        count_nodes_by_type(&wf, "ConditioningCombine"),
        1,
        "empty positive with valid negative must inject only 1 negative combine node"
    );
}

// ============================================================================
// 3. Non-SDXL Model Architectures: Graceful Bypass Without Crashes
// ============================================================================

#[test]
fn test_non_sdxl_architectures_bypass_regional_conditioning() {
    let non_sdxl_archs = [
        "sd15",
        "flux1d",
        "flux2_klein",
        "sd3",
        "wan",
        "qwen",
        "chroma",
        "auraflow",
        "unknown",
        "unrecognized_future_model",
    ];

    for arch in non_sdxl_archs {
        let mut p = base_test_params("txt2img", arch);
        p.positive_regions = vec![PositiveRegion {
            text: "cyberpunk skyline".to_string(),
            negative_text: Some("smog, fog".to_string()),
            x: 0.0,
            y: 0.0,
            width: 1.0,
            height: 0.5,
            strength: 1.0,
        }];

        let wf = build_workflow(&p, 42, false);
        assert_eq!(
            count_nodes_by_type(&wf, "ConditioningSetAreaPercentage"),
            0,
            "architecture {arch} must gracefully bypass regional conditioning without nodes"
        );
        assert_eq!(
            count_nodes_by_type(&wf, "ConditioningCombine"),
            0,
            "architecture {arch} must gracefully bypass regional combine nodes"
        );
    }
}

#[test]
fn test_sdxl_like_architectures_support_regional_conditioning() {
    let sdxl_like_archs = ["sdxl", "illustrious", "pony", "mugen"];

    for arch in sdxl_like_archs {
        let mut p = base_test_params("txt2img", arch);
        p.positive_regions = vec![PositiveRegion {
            text: "ruby gemstone".to_string(),
            negative_text: Some("scratches".to_string()),
            x: 0.2,
            y: 0.2,
            width: 0.4,
            height: 0.4,
            strength: 1.0,
        }];

        let wf = build_workflow(&p, 42, false);
        assert_eq!(
            count_nodes_by_type(&wf, "ConditioningSetAreaPercentage"),
            2,
            "SDXL-like architecture {arch} must inject area conditioning nodes"
        );
        assert_eq!(
            count_nodes_by_type(&wf, "ConditioningCombine"),
            2,
            "SDXL-like architecture {arch} must inject combine nodes"
        );
    }
}

// ============================================================================
// 4. Multi-ControlNet Chains: 1, 2, 4 ControlNets, Mixed Flags, Missing Fields
// ============================================================================

#[test]
fn test_multi_controlnet_chains_1_2_4_layers() {
    for count in [1, 2, 4] {
        let mut p = base_test_params("txt2img", "sdxl");
        p.controlnets = (0..count)
            .map(|i| ControlNetParam {
                enabled: true,
                preset: None,
                controlnet_model: Some(format!("model_{}.safetensors", i)),
                image: Some(format!("image_{}.png", i)),
                preprocessor: None,
                strength: 0.5 + (i as f64 * 0.1),
                start_percent: 0.0,
                end_percent: 1.0,
            })
            .collect();

        assert!(
            validate_generation_params(&p).is_ok(),
            "validation must pass for {count} valid controlnets"
        );

        let wf = build_workflow(&p, 42, false);
        assert_eq!(
            count_nodes_by_type(&wf, "ControlNetApplyAdvanced"),
            count,
            "must emit exactly {count} ControlNetApplyAdvanced nodes"
        );
        assert_eq!(
            count_nodes_by_type(&wf, "ControlNetLoader"),
            count,
            "must emit exactly {count} ControlNetLoader nodes"
        );
        assert_eq!(
            count_nodes_by_type(&wf, "LoadImage"),
            count,
            "must emit exactly {count} LoadImage nodes"
        );
    }
}

#[test]
fn test_multi_controlnet_mixed_enabled_disabled() {
    let mut p = base_test_params("txt2img", "sdxl");
    p.controlnets = vec![
        ControlNetParam {
            enabled: false,
            preset: None,
            controlnet_model: None, // Missing model on disabled is OK
            image: None,            // Missing image on disabled is OK
            preprocessor: None,
            strength: 1.0,
            start_percent: 0.0,
            end_percent: 1.0,
        },
        ControlNetParam {
            enabled: true,
            preset: None,
            controlnet_model: Some("pose.safetensors".into()),
            image: Some("pose.png".into()),
            preprocessor: None,
            strength: 0.8,
            start_percent: 0.0,
            end_percent: 0.9,
        },
        ControlNetParam {
            enabled: false,
            preset: None,
            controlnet_model: Some("disabled_depth.safetensors".into()),
            image: Some("disabled_depth.png".into()),
            preprocessor: None,
            strength: 1.0,
            start_percent: 0.0,
            end_percent: 1.0,
        },
        ControlNetParam {
            enabled: true,
            preset: None,
            controlnet_model: Some("canny.safetensors".into()),
            image: Some("canny.png".into()),
            preprocessor: None,
            strength: 0.6,
            start_percent: 0.1,
            end_percent: 0.8,
        },
    ];

    assert!(
        validate_generation_params(&p).is_ok(),
        "mixed controlnet list with disabled invalid items must validate cleanly"
    );

    let wf = build_workflow(&p, 42, false);
    assert_eq!(
        count_nodes_by_type(&wf, "ControlNetApplyAdvanced"),
        2,
        "only the 2 enabled controlnets must be injected"
    );
}

#[test]
fn test_multi_controlnet_validation_rejects_missing_fields_when_enabled() {
    let mut p = base_test_params("txt2img", "sdxl");

    // Missing image when enabled
    p.controlnets = vec![ControlNetParam {
        enabled: true,
        preset: None,
        controlnet_model: Some("pose.safetensors".into()),
        image: None,
        preprocessor: None,
        strength: 1.0,
        start_percent: 0.0,
        end_percent: 1.0,
    }];
    let err1 = validate_generation_params(&p).unwrap_err();
    assert!(
        err1.contains("no reference image"),
        "expected image error: {err1}"
    );

    // Whitespace image when enabled
    p.controlnets[0].image = Some("   \t  ".into());
    let err2 = validate_generation_params(&p).unwrap_err();
    assert!(
        err2.contains("no reference image"),
        "expected image error: {err2}"
    );

    // Missing model when enabled
    p.controlnets[0].image = Some("valid_image.png".into());
    p.controlnets[0].controlnet_model = None;
    let err3 = validate_generation_params(&p).unwrap_err();
    assert!(
        err3.contains("no ControlNet model is selected"),
        "expected model error: {err3}"
    );

    // Whitespace model when enabled
    p.controlnets[0].controlnet_model = Some("   ".into());
    let err4 = validate_generation_params(&p).unwrap_err();
    assert!(
        err4.contains("no ControlNet model is selected"),
        "expected model error: {err4}"
    );

    // Inpainting preset without mask
    p.controlnets[0].controlnet_model = Some("anima_inpaint.safetensors".into());
    p.controlnets[0].preset = Some("inpainting".into());
    p.mask_image = None;
    let err5 = validate_generation_params(&p).unwrap_err();
    assert!(
        err5.contains("requires a mask"),
        "expected mask error: {err5}"
    );
}

// ============================================================================
// 5. Deserialization & Deduplication: Legacy `controlnet` and Vector `controlnets`
// ============================================================================

#[test]
fn test_deserialization_deduplication_exact_match() {
    let mut base_val = serde_json::to_value(base_test_params("txt2img", "sdxl")).unwrap();
    let map = base_val.as_object_mut().unwrap();
    map.insert(
        "controlnet".into(),
        json!({
            "enabled": true,
            "controlnet_model": "pose.safetensors",
            "image": "pose.png",
            "strength": 0.85,
            "start_percent": 0.0,
            "end_percent": 1.0
        }),
    );
    map.insert(
        "controlnets".into(),
        json!([
            {
                "enabled": true,
                "controlnet_model": "pose.safetensors",
                "image": "pose.png",
                "strength": 0.85,
                "start_percent": 0.0,
                "end_percent": 1.0
            }
        ]),
    );

    let params: GenerationParams =
        serde_json::from_value(base_val).expect("must deserialize cleanly");
    let active = params.active_controlnets();
    assert_eq!(
        active.len(),
        1,
        "active_controlnets must deduplicate legacy and identical vector item"
    );
    assert_eq!(
        active[0].controlnet_model.as_deref(),
        Some("pose.safetensors")
    );

    let wf = build_workflow(&params, 42, false);
    assert_eq!(
        count_nodes_by_type(&wf, "ControlNetApplyAdvanced"),
        1,
        "deduplicated controlnet must emit only 1 ControlNetApplyAdvanced node"
    );
}

#[test]
fn test_deserialization_deduplication_distinct_items_preserved() {
    let mut base_val = serde_json::to_value(base_test_params("txt2img", "sdxl")).unwrap();
    let map = base_val.as_object_mut().unwrap();
    map.insert(
        "controlnet".into(),
        json!({
            "enabled": true,
            "controlnet_model": "pose.safetensors",
            "image": "pose.png",
            "strength": 0.85,
            "start_percent": 0.0,
            "end_percent": 1.0
        }),
    );
    map.insert(
        "controlnets".into(),
        json!([
            {
                "enabled": true,
                "controlnet_model": "depth.safetensors",
                "image": "depth.png",
                "strength": 0.6,
                "start_percent": 0.1,
                "end_percent": 0.9
            }
        ]),
    );

    let params: GenerationParams =
        serde_json::from_value(base_val).expect("must deserialize cleanly");
    let active = params.active_controlnets();
    assert_eq!(
        active.len(),
        2,
        "distinct legacy and vector items must both be preserved"
    );
    assert_eq!(
        active[0].controlnet_model.as_deref(),
        Some("pose.safetensors")
    );
    assert_eq!(
        active[1].controlnet_model.as_deref(),
        Some("depth.safetensors")
    );

    let wf = build_workflow(&params, 42, false);
    assert_eq!(
        count_nodes_by_type(&wf, "ControlNetApplyAdvanced"),
        2,
        "2 distinct controlnets must emit 2 ControlNetApplyAdvanced nodes"
    );
}

#[test]
fn test_deserialization_regional_negative_text_camelcase_alias() {
    let mut base_val = serde_json::to_value(base_test_params("txt2img", "sdxl")).unwrap();
    let map = base_val.as_object_mut().unwrap();
    map.insert(
        "positive_regions".into(),
        json!([
            {
                "text": "ruby gem",
                "negativeText": "emerald gem, scratches",
                "x": 0.3,
                "y": 0.3,
                "width": 0.4,
                "height": 0.4,
                "strength": 1.5
            }
        ]),
    );

    let params: GenerationParams =
        serde_json::from_value(base_val).expect("must deserialize cleanly");
    assert_eq!(params.positive_regions.len(), 1);
    assert_eq!(
        params.positive_regions[0].negative_text.as_deref(),
        Some("emerald gem, scratches"),
        "negativeText camelCase alias must deserialize into negative_text"
    );

    let wf = build_workflow(&params, 42, false);
    assert_eq!(count_nodes_by_type(&wf, "ConditioningSetAreaPercentage"), 2);
    assert_eq!(count_nodes_by_type(&wf, "ConditioningCombine"), 2);
}

#[test]
fn test_cross_architecture_modes_matrix() {
    let architectures = vec![
        "sd15",
        "sdxl",
        "illustrious",
        "pony",
        "flux",
        "sd3",
        "anima",
        "cascade",
    ];

    let modes = vec!["txt2img", "img2img", "inpainting"];

    for arch in &architectures {
        for mode in &modes {
            let mut params = base_test_params(mode, arch);
            params.checkpoint = match *arch {
                "sd15" => "v1-5-pruned-emaonly.safetensors".to_string(),
                "sdxl" | "illustrious" | "pony" => "sd_xl_base_1.0.safetensors".to_string(),
                "flux" => "flux1-dev.safetensors".to_string(),
                "sd3" => "sd3_medium.safetensors".to_string(),
                "anima" => "anima_pencil_xl.safetensors".to_string(),
                "cascade" => "cascade_stage_c.safetensors".to_string(),
                _ => "model.safetensors".to_string(),
            };

            let wf = build_workflow(&params, 12345, false);
            assert!(
                wf.is_object(),
                "Workflow must build a valid JSON map for arch: {} in mode: {}",
                arch,
                mode
            );
            assert!(
                !wf.as_object().unwrap().is_empty(),
                "Workflow must contain nodes for arch: {} in mode: {}",
                arch,
                mode
            );

            // Inpainting with Crop & Stitch (inpaint_area = "mask_only")
            if *mode == "inpainting" {
                let mut crop_params = params.clone();
                crop_params.inpaint_area = "mask_only".to_string();
                crop_params.inpaint_context_factor = 1.5;
                crop_params.inpaint_mask_blend = 16;
                let crop_wf = build_workflow(&crop_params, 12345, false);
                assert!(
                    crop_wf.is_object(),
                    "Crop & Stitch workflow must build cleanly for arch: {}",
                    arch
                );
            }
        }
    }
}

#[test]
fn test_image_edit_architecture_support() {
    let mut edit_params = base_test_params("image_edit", "qwen_edit");
    edit_params.checkpoint = "qwen_image_edit.safetensors".to_string();
    edit_params.input_image = Some("source_photo.png".to_string());
    edit_params.positive_prompt = "add sunglasses and change jacket to blue".to_string();

    let wf = build_workflow(&edit_params, 999, false);
    assert!(wf.is_object());
    assert!(!wf.as_object().unwrap().is_empty());
}
