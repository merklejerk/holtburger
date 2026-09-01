use std::fs;
use std::path::Path;

use tempfile::tempdir;

use crate::codec::{HEADER_LENGTH, INDEX_ENTRY_LENGTH, MAX_STRING_BYTES};
use crate::{
    AnimPartChange, CATALOG_FORMAT_VERSION, CatalogLookupError, CatalogOpenError,
    CatalogWriteError, PhysicsBoolOverrides, SubPalette, TemplateAppearance, TemplatePhysics,
    TextureChange, WeenieCatalog, WeenieTemplate, WeenieTemplateIdentity, WieldEntry,
    write_catalog_atomic,
};

fn template(wcid: u32) -> WeenieTemplate {
    WeenieTemplate {
        wcid,
        class_name: format!("wcid_{wcid}_class"),
        weenie_type: 10,
        name: Some(format!("WCID {wcid}")),
        level: Some(42),
        setup_did: Some(0x0200_0001),
        motion_table_did: Some(0x0900_0001),
        sound_table_did: Some(0x2000_0001),
        physics_effect_table_did: Some(0x3400_0001),
        palette_base_did: Some(0x0400_0001),
        default_scale: Some(1.25),
        friction: Some(0.95),
        elasticity: Some(0.05),
        maximum_velocity: Some(15.0),
        rotation_speed: Some(2.0),
        radar_blip_color: Some(3),
        radar_behavior: Some(4),
        obvious_radar_range: Some(60.0),
        attackable: Some(false),
        appearance: TemplateAppearance {
            clothing_base_did: None,
            head_object_did: Some(0x0200_1234),
            skin_palette_did: Some(0x0400_0100),
            hair_palette_did: Some(0x0400_0101),
            eyes_palette_did: None,
            eyes_texture_did: Some(0x0500_0001),
            default_eyes_texture_did: None,
            nose_texture_did: None,
            default_nose_texture_did: None,
            mouth_texture_did: None,
            default_mouth_texture_did: None,
            heritage_group: Some(2),
            gender: None,
            heritage_group_name: Some("Gharu'ndim".to_owned()),
            sex: Some("Male".to_owned()),
            item_type: Some(2),
            default_combat_style: Some(2),
            clothing_priority: Some(65_536),
            valid_locations: Some(384),
            palette_template: Some(61),
            shade: Some(0.5),
        },
        wielded: vec![
            WieldEntry {
                wcid: 130,
                destination_type: 2,
                palette_template: 5,
                shade: 0.67,
            },
            WieldEntry {
                wcid: 115,
                destination_type: 10,
                palette_template: 0,
                shade: 0.0,
            },
        ],
        physics: TemplatePhysics {
            base_mask: Some(0x0040_0c08),
            overrides: PhysicsBoolOverrides {
                ethereal: None,
                report_collisions: Some(true),
                ignore_collisions: Some(false),
                no_draw: None,
                gravity: Some(true),
                lighting: Some(true),
                scripted_collision: None,
                inelastic: Some(false),
                report_collisions_as_environment: None,
                allow_edge_slide: Some(true),
                frozen: Some(false),
            },
        },
        sub_palettes: vec![
            SubPalette {
                sub_palette_did: 0x0400_0010,
                offset: 8,
                length: 2,
            },
            SubPalette {
                sub_palette_did: 0x0400_000f,
                offset: 0,
                length: 1,
            },
        ],
        texture_changes: vec![
            TextureChange {
                part_index: 2,
                old_texture_did: 0x0500_0002,
                new_texture_did: 0x0500_0012,
            },
            TextureChange {
                part_index: 1,
                old_texture_did: 0x0500_0001,
                new_texture_did: 0x0500_0011,
            },
        ],
        anim_part_changes: vec![
            AnimPartChange {
                part_index: 2,
                animation_part_did: 0x0100_0012,
            },
            AnimPartChange {
                part_index: 1,
                animation_part_did: 0x0100_0011,
            },
        ],
    }
}

#[test]
fn empty_catalog_reopens_as_a_valid_empty_catalog() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("empty.hwc");

    write_catalog_atomic(&path, &[]).unwrap();

    let catalog = WeenieCatalog::open(path).unwrap();
    assert!(catalog.is_empty());
    assert!(catalog.lookup(0).unwrap().is_none());
}

#[test]
fn record_census_exposes_only_sorted_identity_and_encoded_size() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("census.hwc");
    write_catalog_atomic(&path, &[template(9), template(2)]).unwrap();

    let catalog = WeenieCatalog::open(path).unwrap();
    let records = catalog.records().collect::<Vec<_>>();

    assert_eq!(
        records.iter().map(|record| record.wcid).collect::<Vec<_>>(),
        [2, 9]
    );
    assert!(records.iter().all(|record| record.encoded_length > 0));
}

#[test]
fn identity_scan_decodes_only_canonical_identity_prefixes() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("identities.hwc");
    let mut unnamed = template(9);
    unnamed.name = None;
    write_catalog_atomic(&path, &[unnamed, template(2)]).unwrap();

    let catalog = WeenieCatalog::open(path).unwrap();

    assert_eq!(
        catalog.template_identities().unwrap(),
        [
            WeenieTemplateIdentity {
                wcid: 2,
                class_name: "wcid_2_class".to_owned(),
                name: Some("WCID 2".to_owned()),
            },
            WeenieTemplateIdentity {
                wcid: 9,
                class_name: "wcid_9_class".to_owned(),
                name: None,
            },
        ]
    );
}

#[test]
fn writer_canonicalizes_input_and_produces_deterministic_bytes() {
    let directory = tempdir().unwrap();
    let first_path = directory.path().join("first.hwc");
    let second_path = directory.path().join("second.hwc");
    let low = template(0);
    let high = template(u32::MAX);

    write_catalog_atomic(&first_path, &[high.clone(), low.clone()]).unwrap();
    write_catalog_atomic(&second_path, &[low.clone(), high.clone()]).unwrap();

    assert_eq!(
        fs::read(&first_path).unwrap(),
        fs::read(&second_path).unwrap()
    );
    let catalog = WeenieCatalog::open(first_path).unwrap();
    assert_eq!(catalog.lookup(0).unwrap(), Some(canonicalized(low)));
    assert_eq!(catalog.lookup(u32::MAX).unwrap(), Some(canonicalized(high)));
    assert!(catalog.lookup(42).unwrap().is_none());
}

#[test]
fn absent_zero_and_false_survive_round_trip_distinctly() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("nullable.hwc");
    let mut absent = template(1);
    absent.physics.base_mask = None;
    absent.physics.overrides.frozen = None;
    absent.maximum_velocity = None;
    absent.rotation_speed = None;
    absent.appearance.skin_palette_did = None;
    absent.appearance.heritage_group = None;
    absent.appearance.default_combat_style = None;
    absent.appearance.clothing_priority = None;
    absent.appearance.sex = None;
    absent.appearance.palette_template = None;
    absent.appearance.shade = None;
    let mut explicit = template(2);
    explicit.physics.base_mask = Some(0);
    explicit.physics.overrides.frozen = Some(false);
    explicit.maximum_velocity = Some(0.0);
    explicit.rotation_speed = Some(0.0);
    explicit.appearance.skin_palette_did = Some(0);
    explicit.appearance.heritage_group = Some(0);
    explicit.appearance.default_combat_style = Some(0);
    explicit.appearance.clothing_priority = Some(0);
    explicit.appearance.sex = Some(String::new());
    explicit.appearance.palette_template = Some(0);
    explicit.appearance.shade = Some(0.0);

    write_catalog_atomic(&path, &[absent, explicit]).unwrap();

    let catalog = WeenieCatalog::open(path).unwrap();
    let absent = catalog.lookup(1).unwrap().unwrap();
    let explicit = catalog.lookup(2).unwrap().unwrap();
    assert_eq!(absent.physics.base_mask, None);
    assert_eq!(absent.physics.overrides.frozen, None);
    assert_eq!(absent.maximum_velocity, None);
    assert_eq!(absent.rotation_speed, None);
    assert_eq!(explicit.physics.base_mask, Some(0));
    assert_eq!(explicit.physics.overrides.frozen, Some(false));
    assert_eq!(explicit.maximum_velocity, Some(0.0));
    assert_eq!(explicit.rotation_speed, Some(0.0));
    assert_eq!(absent.appearance.skin_palette_did, None);
    assert_eq!(absent.appearance.heritage_group, None);
    assert_eq!(absent.appearance.default_combat_style, None);
    assert_eq!(absent.appearance.clothing_priority, None);
    assert_eq!(absent.appearance.sex, None);
    assert_eq!(absent.appearance.palette_template, None);
    assert_eq!(absent.appearance.shade, None);
    assert_eq!(explicit.appearance.skin_palette_did, Some(0));
    assert_eq!(explicit.appearance.heritage_group, Some(0));
    assert_eq!(explicit.appearance.default_combat_style, Some(0));
    assert_eq!(explicit.appearance.clothing_priority, Some(0));
    assert_eq!(explicit.appearance.sex.as_deref(), Some(""));
    assert_eq!(explicit.appearance.palette_template, Some(0));
    assert_eq!(explicit.appearance.shade, Some(0.0));
}

/// Wielded entries are positional: probability grouping depends on source order, so the codec
/// must not sort or dedupe them the way canonical appearance collections are sorted.
#[test]
fn wielded_entries_survive_round_trip_in_source_order() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("wielded.hwc");
    let mut template = template(3);
    template.wielded = vec![
        WieldEntry {
            wcid: 2606,
            destination_type: 10,
            palette_template: 17,
            shade: 1.0,
        },
        WieldEntry {
            wcid: 115,
            destination_type: 2,
            palette_template: 4,
            shade: 0.8,
        },
        WieldEntry {
            wcid: 115,
            destination_type: 2,
            palette_template: 4,
            shade: 0.8,
        },
    ];
    let expected = template.wielded.clone();

    write_catalog_atomic(&path, &[template]).unwrap();

    let catalog = WeenieCatalog::open(path).unwrap();
    let decoded = catalog.lookup(3).unwrap().unwrap();
    assert_eq!(decoded.wielded, expected);
}

#[test]
fn duplicate_wcid_is_rejected() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("duplicate.hwc");

    let error = write_catalog_atomic(&path, &[template(7), template(7)]).unwrap_err();

    assert!(matches!(
        error,
        CatalogWriteError::DuplicateWcid { wcid: 7 }
    ));
    assert!(!path.exists());
}

#[test]
fn failed_replacement_preserves_existing_catalog() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("preserved.hwc");
    write_catalog_atomic(&path, &[template(1)]).unwrap();
    let original = fs::read(&path).unwrap();

    let error = write_catalog_atomic(&path, &[template(2), template(2)]).unwrap_err();

    assert!(matches!(
        error,
        CatalogWriteError::DuplicateWcid { wcid: 2 }
    ));
    assert_eq!(fs::read(path).unwrap(), original);
}

#[test]
fn duplicate_appearance_semantic_key_is_rejected() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("duplicate-appearance.hwc");
    let mut value = template(7);
    value.texture_changes.push(TextureChange {
        part_index: 1,
        old_texture_did: 0x0500_0001,
        new_texture_did: 0x0500_0099,
    });

    let error = write_catalog_atomic(&path, &[value]).unwrap_err();

    assert!(matches!(error, CatalogWriteError::Record { wcid: 7, .. }));
    assert!(
        error
            .to_string()
            .contains("duplicate (part index, old DID)")
    );
}

#[test]
fn nonfinite_source_float_is_rejected_with_wcid_and_field() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("nonfinite.hwc");
    let mut value = template(9);
    value.friction = Some(f64::NAN);

    let error = write_catalog_atomic(&path, &[value]).unwrap_err();

    assert!(matches!(error, CatalogWriteError::Record { wcid: 9, .. }));
    assert!(error.to_string().contains("friction"));
}

#[test]
fn oversized_source_string_is_rejected_with_wcid_and_field() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("oversized-string.hwc");
    let mut value = template(10);
    value.class_name = "x".repeat(MAX_STRING_BYTES + 1);

    let error = write_catalog_atomic(&path, &[value]).unwrap_err();

    assert!(matches!(error, CatalogWriteError::Record { wcid: 10, .. }));
    assert!(error.to_string().contains("class_name"));
}

#[test]
fn unavailable_catalog_is_distinct() {
    let directory = tempdir().unwrap();
    let error = WeenieCatalog::open(directory.path().join("missing.hwc")).unwrap_err();
    assert!(matches!(error, CatalogOpenError::Unavailable { .. }));
}

#[test]
fn truncated_header_is_corrupt() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("truncated.hwc");
    fs::write(&path, [0_u8; HEADER_LENGTH - 1]).unwrap();

    let error = WeenieCatalog::open(path).unwrap_err();

    assert!(matches!(error, CatalogOpenError::Corrupt { .. }));
    assert!(error.to_string().contains("shorter than header"));
}

/// Both neighbours of the supported version must be rejected by the same distinct error, so a
/// stale v1 artifact and a future format are equally unreadable rather than silently misparsed.
#[test]
fn unsupported_version_is_distinct() {
    for unsupported in [CATALOG_FORMAT_VERSION - 1, CATALOG_FORMAT_VERSION + 1] {
        let directory = tempdir().unwrap();
        let path = directory.path().join("version.hwc");
        write_catalog_atomic(&path, &[]).unwrap();
        mutate(&path, |bytes| {
            bytes[8..12].copy_from_slice(&unsupported.to_le_bytes())
        });

        let error = WeenieCatalog::open(path).unwrap_err();

        assert!(
            matches!(error, CatalogOpenError::UnsupportedVersion { version, .. } if version == unsupported),
            "version {unsupported} must be rejected distinctly, got {error:?}"
        );
    }
}

#[test]
fn unsorted_index_is_corrupt() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("unsorted.hwc");
    write_catalog_atomic(&path, &[template(1), template(2)]).unwrap();
    mutate(&path, |bytes| {
        let index_offset = read_u64(bytes, 40) as usize;
        let (prefix, suffix) = bytes.split_at_mut(index_offset + INDEX_ENTRY_LENGTH);
        let first = &mut prefix[index_offset..index_offset + INDEX_ENTRY_LENGTH];
        let second = &mut suffix[..INDEX_ENTRY_LENGTH];
        first.swap_with_slice(second);
    });

    let error = WeenieCatalog::open(path).unwrap_err();

    assert!(matches!(error, CatalogOpenError::Corrupt { .. }));
    assert!(error.to_string().contains("not strictly sorted"));
}

#[test]
fn overlapping_index_ranges_are_corrupt() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("overlap.hwc");
    write_catalog_atomic(&path, &[template(1), template(2)]).unwrap();
    mutate(&path, |bytes| {
        let index_offset = read_u64(bytes, 40) as usize;
        let first_payload_offset = read_u64(bytes, index_offset + 4);
        let second_offset_field = index_offset + INDEX_ENTRY_LENGTH + 4;
        bytes[second_offset_field..second_offset_field + 8]
            .copy_from_slice(&first_payload_offset.to_le_bytes());
    });

    let error = WeenieCatalog::open(path).unwrap_err();

    assert!(matches!(error, CatalogOpenError::Corrupt { .. }));
    assert!(error.to_string().contains("contiguous offset"));
}

#[test]
fn out_of_range_index_payload_is_corrupt() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("out-of-range.hwc");
    write_catalog_atomic(&path, &[template(1)]).unwrap();
    mutate(&path, |bytes| {
        let index_offset = read_u64(bytes, 40) as usize;
        bytes[index_offset + 4..index_offset + 12].copy_from_slice(&u64::MAX.to_le_bytes());
    });

    let error = WeenieCatalog::open(path).unwrap_err();

    assert!(matches!(error, CatalogOpenError::Corrupt { .. }));
}

#[test]
fn malformed_record_is_reported_at_lookup() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("malformed-record.hwc");
    let value = template(1);
    write_catalog_atomic(&path, std::slice::from_ref(&value)).unwrap();
    mutate(&path, |bytes| {
        let payload_offset = read_u64(bytes, 24) as usize;
        let name_tag_offset = payload_offset + 4 + 4 + 4 + value.class_name.len();
        bytes[name_tag_offset] = 3;
    });

    let catalog = WeenieCatalog::open(path).unwrap();
    let error = catalog.lookup(1).unwrap_err();

    assert!(matches!(
        error,
        CatalogLookupError::MalformedRecord { wcid: 1, .. }
    ));
    assert!(error.to_string().contains("invalid option tag 3"));

    let identity_error = catalog.template_identities().unwrap_err();
    assert!(identity_error.to_string().contains("invalid option tag 3"));
}

#[test]
fn identity_scan_rejects_invalid_prefix_utf8_with_the_indexed_wcid() {
    let directory = tempdir().unwrap();
    let path = directory.path().join("malformed-identity-utf8.hwc");
    write_catalog_atomic(&path, &[template(7)]).unwrap();
    mutate(&path, |bytes| {
        let payload_offset = read_u64(bytes, 24) as usize;
        let class_name_offset = payload_offset + 4 + 4 + 4;
        bytes[class_name_offset] = 0xff;
    });

    let catalog = WeenieCatalog::open(path).unwrap();
    let error = catalog.template_identities().unwrap_err();

    assert!(error.to_string().contains("WCID 7 identity"));
    assert!(error.to_string().contains("class_name is not UTF-8"));
}

fn canonicalized(mut value: WeenieTemplate) -> WeenieTemplate {
    value
        .sub_palettes
        .sort_by_key(|entry| (entry.offset, entry.length, entry.sub_palette_did));
    value.texture_changes.sort_by_key(|entry| {
        (
            entry.part_index,
            entry.old_texture_did,
            entry.new_texture_did,
        )
    });
    value
        .anim_part_changes
        .sort_by_key(|entry| entry.part_index);
    value
}

fn mutate(path: &Path, mutation: impl FnOnce(&mut Vec<u8>)) {
    let mut bytes = fs::read(path).unwrap();
    mutation(&mut bytes);
    fs::write(path, bytes).unwrap();
}

fn read_u64(bytes: &[u8], offset: usize) -> u64 {
    u64::from_le_bytes(bytes[offset..offset + 8].try_into().unwrap())
}
