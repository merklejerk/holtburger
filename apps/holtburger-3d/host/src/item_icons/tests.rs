use super::*;

#[derive(Default)]
struct Assets {
    mappings: HashMap<(u32, u32), u32>,
    images: HashMap<u32, Arc<UiImage>>,
}
impl UiAssets for Assets {
    fn enum_did(&mut self, group: u32, entry: u32) -> Result<u32, UiAssetError> {
        self.mappings
            .get(&(group, entry))
            .copied()
            .ok_or(UiAssetError::MissingMapping {
                mapper: group,
                entry,
            })
    }
    fn image(&mut self, id: u32) -> Result<Arc<UiImage>, UiAssetError> {
        self.images
            .get(&id)
            .cloned()
            .ok_or(UiAssetError::MissingAsset { id })
    }
}
fn fixtures() -> Assets {
    Assets {
        mappings: HashMap::from([
            ((BACKGROUNDS, DEFAULT_ENTRY), 2),
            ((BACKGROUNDS, 1), 2),
            ((BACKGROUNDS, CONTAINER_ENTRY), 5),
            ((EFFECTS, DEFAULT_ENTRY), 3),
            ((EFFECTS, 1), 6),
            ((UI_ASSETS, PLAYER_ICON), 7),
        ]),
        images: [
            (1, [255, 255, 255, 255]),
            (2, [10, 20, 30, 255]),
            (3, [0, 0, 0, 255]),
            (5, [50, 60, 70, 255]),
            (6, [80, 90, 100, 255]),
            (7, [101, 102, 103, 255]),
        ]
        .into_iter()
        .map(|(id, color)| {
            (
                id,
                Arc::new(UiImage {
                    width: ICON_SIZE as u32,
                    height: ICON_SIZE as u32,
                    pixels: color.repeat(ICON_SIZE * ICON_SIZE),
                }),
            )
        })
        .collect(),
    }
}
fn spec(base: u32, item_type: u32, ui_effects: u32) -> ItemIconSpec {
    ItemIconSpec::Item {
        base: NonZeroU32::new(base),
        item_type,
        ui_effects,
        overlay: None,
        underlay: None,
    }
}
fn request(specs: Vec<ItemIconSpec>) -> PrepareItemIconsRequest {
    PrepareItemIconsRequest {
        icons: specs
            .into_iter()
            .enumerate()
            .map(|(index, spec)| ItemIconRequest {
                key: index.to_string(),
                spec,
            })
            .collect(),
    }
}
fn rgba(result: &ItemIconResult) -> Vec<u8> {
    let bytes = match result {
        ItemIconResult::Ready { image } | ItemIconResult::Degraded { image, .. } => image,
        ItemIconResult::Failed { .. } => panic!("expected image"),
    };
    let decoder = png::Decoder::new(std::io::Cursor::new(bytes));
    let mut reader = decoder.read_info().unwrap();
    let mut pixels = vec![0; reader.output_buffer_size().unwrap()];
    let info = reader.next_frame(&mut pixels).unwrap();
    assert_eq!(
        (info.width, info.height),
        (ICON_SIZE as u32, ICON_SIZE as u32)
    );
    pixels.truncate(info.buffer_size());
    pixels
}

#[test]
fn main_pack_overrides_base_and_background_without_changing_other_player_icons() {
    let mut assets = fixtures();
    let regular = resolve(&mut assets, &spec(1, 0, 0), &mut Vec::new()).unwrap();
    let main = resolve(
        &mut assets,
        &ItemIconSpec::MainPack {
            overlay: None,
            underlay: None,
            ui_effects: 0,
        },
        &mut Vec::new(),
    )
    .unwrap();
    assert_eq!((regular.recipe.base, regular.recipe.background), (1, 2));
    assert_eq!((main.recipe.base, main.recipe.background), (7, 5));
}

#[test]
fn lowest_bits_choose_the_same_recipe_despite_different_raw_masks() {
    let mut assets = fixtures();
    let a = resolve(&mut assets, &spec(1, 1, 1), &mut Vec::new()).unwrap();
    let b = resolve(&mut assets, &spec(1, 0x80000001, 3), &mut Vec::new()).unwrap();
    assert_eq!(a.recipe, b.recipe);
    assert_eq!(mask_entry(0), DEFAULT_ENTRY);
    assert_eq!(mask_entry(0x80000000), 32);
}

#[test]
fn default_effects_replace_white_and_preferred_effects_fall_back_with_a_report() {
    let mut assets = fixtures();
    let result = prepare_with_assets(
        &mut assets,
        &request(vec![spec(1, 0, 0), spec(1, 0, 1), spec(1, 0, 0x1000)]),
    )
    .unwrap();
    assert!(matches!(result[0].result, ItemIconResult::Ready { .. }));
    assert_eq!(&rgba(&result[0].result)[..4], &[0, 0, 0, 255]);
    assert_eq!(&rgba(&result[1].result)[..4], &[80, 90, 100, 255]);
    let ItemIconResult::Degraded { issues, .. } = &result[2].result else {
        panic!("fallback must be reported");
    };
    assert_eq!(issues.0[0].code, IconIssueCode::MissingMapping);
    assert_eq!(rgba(&result[2].result), rgba(&result[0].result));
    assets.images.remove(&6);
    let result = prepare_with_assets(&mut assets, &request(vec![spec(1, 0, 1)])).unwrap();
    let ItemIconResult::Degraded { issues, .. } = &result[0].result else {
        panic!("missing preferred image must be reported");
    };
    assert_eq!(issues.0[0].asset_id, Some(6));
}

#[test]
fn missing_optional_art_degrades_only_its_item_and_required_art_fails_only_its_item() {
    let mut with_layers = spec(1, 0, 0);
    let ItemIconSpec::Item {
        overlay, underlay, ..
    } = &mut with_layers
    else {
        unreachable!()
    };
    *overlay = NonZeroU32::new(99);
    *underlay = NonZeroU32::new(98);
    let result = prepare_with_assets(
        &mut fixtures(),
        &request(vec![
            with_layers,
            spec(90, 0, 0),
            spec(1, 0, 0),
            spec(0, 0, 0),
        ]),
    )
    .unwrap();
    let ItemIconResult::Degraded { issues, .. } = &result[0].result else {
        panic!("optional layers degrade");
    };
    assert_eq!(
        issues.0.iter().map(|i| i.layer).collect::<Vec<_>>(),
        [IconLayer::Overlay, IconLayer::Underlay]
    );
    assert!(matches!(result[1].result, ItemIconResult::Failed { .. }));
    assert!(matches!(result[2].result, ItemIconResult::Ready { .. }));
    assert_eq!(rgba(&result[0].result), rgba(&result[2].result));
    let ItemIconResult::Failed { issues } = &result[3].result else {
        panic!("unassigned base fails");
    };
    assert_eq!(issues.0[0].code, IconIssueCode::UnassignedBase);
}

#[test]
fn missing_background_and_default_effects_are_not_successful_blank_images() {
    let unknown_type = prepare_with_assets(&mut fixtures(), &request(vec![spec(1, 2, 0)])).unwrap();
    assert!(matches!(
        unknown_type[0].result,
        ItemIconResult::Failed { .. }
    ));
    let mut assets = fixtures();
    assets.images.remove(&3);
    let result = prepare_with_assets(&mut assets, &request(vec![spec(1, 0, 0)])).unwrap();
    let ItemIconResult::Failed { issues } = &result[0].result else {
        panic!("default required");
    };
    assert_eq!(issues.0[0].layer, IconLayer::Effects);
}

#[test]
fn rejects_bad_request_envelopes_before_asset_access() {
    assert!(request(vec![]).validate().is_err());
    assert!(
        request(vec![spec(1, 0, 0); MAX_ICON_BATCH + 1])
            .validate()
            .is_err()
    );
    let mut duplicate = request(vec![spec(1, 0, 0), spec(1, 0, 0)]);
    duplicate.icons[1].key = duplicate.icons[0].key.clone();
    assert!(duplicate.validate().is_err());
    let mut long = request(vec![spec(1, 0, 0)]);
    long.icons[0].key = "x".repeat(MAX_ICON_KEY_BYTES + 1);
    assert!(long.validate().is_err());
    assert!(
        serde_json::from_value::<ItemIconSpec>(
            serde_json::json!({"kind":"item","base":0,"itemType":0,"uiEffects":0})
        )
        .is_err()
    );
}

#[test]
fn request_and_response_bounds_include_keys_diagnostics_and_frame_envelope() {
    use crate::protocol::{
        HostCommand, HostResponse, MAX_FRAME_BYTES, ProtocolFrame, encode_frame,
    };
    let mut request = request(vec![spec(1, 0, 0); MAX_ICON_BATCH]);
    // Worst JSON expansion per allowed key byte, with enough suffix space for uniqueness.
    for (index, icon) in request.icons.iter_mut().enumerate() {
        icon.key = format!("{}{:02}", "\0".repeat(MAX_ICON_KEY_BYTES - 2), index);
    }
    request.validate().unwrap();
    let wire = serde_json::json!({"command":"prepare_item_icons","request":request});
    assert!(serde_json::to_vec(&wire).unwrap().len() < MAX_ICON_FRAME_BYTES);
    assert!(matches!(
        serde_json::from_value::<HostCommand>(wire).unwrap(),
        HostCommand::Shared(_)
    ));
    let responses = prepare_with_assets(&mut fixtures(), &request).unwrap();
    let bytes = encode_response(&responses).unwrap();
    let frame = encode_frame(&ProtocolFrame::Response {
        id: u64::MAX,
        result: Ok(HostResponse::Binary(bytes)),
    })
    .unwrap();
    assert!(frame.len() <= MAX_ICON_FRAME_BYTES && frame.len() < MAX_FRAME_BYTES);
    let oversized = [PreparedItemIcon {
        key: "x".into(),
        result: ItemIconResult::Ready {
            image: vec![0; MAX_ICON_FRAME_BYTES],
        },
    }];
    assert!(
        encode_response(&oversized)
            .unwrap_err()
            .to_string()
            .contains("byte limit")
    );
    let bounded = issue(
        IconLayer::Base,
        IconIssueCode::Decode,
        Some(1),
        "🦀".repeat(MAX_ICON_FRAME_BYTES),
    );
    assert!(bounded.detail.len() <= 1024);
}
