use std::sync::Arc;

use holtburger_content::{
    ActiveRegionData, ContentDecodeCache, ContentRepository, LandblockTerrain, TexturePixelFormat,
};
use holtburger_core::{ContentAssetRuntime, ContentAssetService};
use holtburger_dat::file_type::PixelFormatId;
use holtburger_dat::file_type::region::{GameTime, LandDefs, RegionDesc, TerrainDesc};
use holtburger_dat::{DatFileType, EOR_CELL_NAMESPACE, EOR_PORTAL_NAMESPACE, HbaWriter};
use tempfile::tempdir;

use super::active_region::{ACTIVE_REGION_BINARY_MAGIC, serialize_active_region_binary};
use super::terrain::{
    TERRAIN_SOURCE_BINARY_MAGIC, TerrainAvailabilityManifest, TerrainSourceManifest,
    parse_landblock_id, serialize_terrain_source_binary, terrain_availability, terrain_sections,
};
use super::textures::{
    TEXTURE_PIXELS_BINARY_MAGIC, TexturePixelsManifest, TexturePixelsSurfaceFields,
    TexturePixelsSurfaceManifest, build_texture_pixels_response, parse_surface_texture_asset_id,
    serialize_texture_pixels_binary, texture_output_format,
};
use super::{
    BINARY_ENVELOPE_HEADER_LEN, BinarySectionManifest, LoadPaletteCompositeRequest,
    LoadPaletteRangeRequest, LoadTexturePixelsRequest, load_landblock_profile_response,
};
use crate::SharedHostContent;
use crate::binary_source_record::BinarySectionWriter;
use crate::landblock_profile;
use crate::landblock_source_batch::{
    LANDBLOCK_SOURCE_BATCH_BINARY_MAGIC, LandblockSourceBatchRecord, LandblockSourceBatchRequest,
    LandblockSourceLayer, serialize_landblock_source_batch,
};
use crate::object_resource_closure::StaticGeometryBuffers;
use crate::outdoor_static_source::{
    OUTDOOR_STATIC_RECORD_BINARY_MAGIC, OutdoorStaticSourceRecordManifest,
    serialize_outdoor_static_record_binary,
};
use crate::terrain_color::{mean_rgb_from_rgba8_texels, mean_rgb_rgba8};

#[test]
fn terrain_source_binary_aligns_and_describes_each_grid_section() {
    let terrain = LandblockTerrain {
        grid_size: 3,
        tile_size: 24.0,
        height_indices: (0..9).collect(),
        heights: (0..9).map(|value| value as f32 + 0.5).collect(),
        terrain_samples: (10..19).collect(),
        cell_diagonals: holtburger_content::TerrainCellDiagonals::for_landblock(0x0102_ffff),
    };
    let manifest = TerrainSourceManifest {
        transport: "holtburger-landblock-terrain-record",
        byte_order: "little-endian",
        section_byte_offset_base: "section-data",
        landblock_id: "0x0102ffff".to_string(),
        terrain_availability: TerrainAvailabilityManifest::Available,
        sections: terrain_sections(&terrain),
    };

    let bytes = serialize_terrain_source_binary(&manifest, Some(&terrain))
        .expect("terrain source binary should serialize");

    assert_eq!(&bytes[..4], TERRAIN_SOURCE_BINARY_MAGIC);
    let manifest_length = u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize;
    assert_eq!(
        u32::from_le_bytes(bytes[8..12].try_into().unwrap()) as usize,
        bytes.len()
    );
    let section_data_offset = BINARY_ENVELOPE_HEADER_LEN + manifest_length;
    let decoded_manifest: serde_json::Value =
        serde_json::from_slice(&bytes[BINARY_ENVELOPE_HEADER_LEN..section_data_offset])
            .expect("padded manifest should remain JSON");
    let sections = decoded_manifest["sections"]
        .as_array()
        .expect("manifest should describe binary sections");
    assert_eq!(sections.len(), 4);
    assert_eq!(sections[1]["name"], "resolvedHeights");
    assert_eq!(sections[1]["byteOffset"], 12);
    assert_eq!(sections[2]["name"], "terrainSamples");
    assert_eq!(sections[2]["byteOffset"], 48);
    assert_eq!(sections[3]["name"], "cellDiagonals");
    assert_eq!(sections[3]["byteOffset"], 66);
    assert_eq!(bytes[section_data_offset], 0);
    assert_eq!(bytes[section_data_offset + 9], 0);
    assert_eq!(
        f32::from_le_bytes(
            bytes[section_data_offset + 12..section_data_offset + 16]
                .try_into()
                .unwrap()
        ),
        0.5
    );
    assert_eq!(bytes[section_data_offset + 48], 10);
    let expected_diagonals = terrain.cell_diagonals.to_cell_bytes();
    assert_eq!(
        &bytes[section_data_offset + 66..section_data_offset + 66 + expected_diagonals.len()],
        expected_diagonals
    );
}

#[test]
fn outdoor_static_record_binary_aligns_and_describes_geometry_sections() {
    let buffers = StaticGeometryBuffers {
        positions: vec![0.0, 0.0, 0.0],
        normals: vec![0.0, 0.0, 1.0],
        texture_coordinates: vec![0.0, 0.0],
        indices: vec![0, 0, 0],
        material_slots: vec![0],
        material_wrap_modes: vec![1],
        material_side_kinds: vec![0],
        material_side_types: vec![0],
        material_stippling: vec![0],
    };
    let mut section_writer = BinarySectionWriter::default();
    buffers
        .append_sections(&mut section_writer, "")
        .expect("geometry sections should encode");
    let (sections, section_bytes) = section_writer.finish();
    let manifest = OutdoorStaticSourceRecordManifest {
        transport: "holtburger-outdoor-static-record",
        byte_order: "little-endian",
        section_byte_offset_base: "section-data",
        landblock_id: "0x0102ffff".to_string(),
        layer: "buildings",
        residents: Vec::new(),
        map_blockers: Some(Vec::new()),
        definitions: Vec::new(),
        geometries: Vec::new(),
        materials: Vec::new(),
        texture_dependencies: Vec::new(),
        sections,
    };
    let bytes = serialize_outdoor_static_record_binary(&manifest, section_bytes)
        .expect("outdoor static record should serialize");

    assert_eq!(&bytes[..4], OUTDOOR_STATIC_RECORD_BINARY_MAGIC);
    let manifest_length = u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize;
    let section_offset = BINARY_ENVELOPE_HEADER_LEN + manifest_length;
    let decoded: serde_json::Value =
        serde_json::from_slice(&bytes[BINARY_ENVELOPE_HEADER_LEN..section_offset])
            .expect("outdoor static record manifest should remain JSON");
    assert_eq!(decoded["sections"][0]["name"], "positions");
    assert_eq!(decoded["sections"][4]["name"], "materialSlots");
    assert_eq!(
        u32::from_le_bytes(
            bytes[section_offset + 32..section_offset + 36]
                .try_into()
                .unwrap()
        ),
        0
    );
}

#[test]
fn landblock_source_batch_serializes_exactly_the_requested_record_set() {
    let request = LandblockSourceBatchRequest::new(
        0x0102_ffff,
        [
            LandblockSourceLayer::Terrain,
            LandblockSourceLayer::Buildings,
            LandblockSourceLayer::Objects,
            LandblockSourceLayer::Generated,
            LandblockSourceLayer::EnvCells,
        ],
    )
    .expect("source batch request should be valid");
    let bytes = serialize_landblock_source_batch(
        &request,
        vec![
            LandblockSourceBatchRecord {
                layer: LandblockSourceLayer::Terrain,
                bytes: vec![1, 2, 3],
            },
            LandblockSourceBatchRecord {
                layer: LandblockSourceLayer::Buildings,
                bytes: vec![4, 5],
            },
            LandblockSourceBatchRecord {
                layer: LandblockSourceLayer::Objects,
                bytes: vec![6],
            },
            LandblockSourceBatchRecord {
                layer: LandblockSourceLayer::Generated,
                bytes: vec![7, 8],
            },
            LandblockSourceBatchRecord {
                layer: LandblockSourceLayer::EnvCells,
                bytes: vec![9, 10],
            },
        ],
    )
    .expect("source batch should serialize");

    assert_eq!(&bytes[..4], LANDBLOCK_SOURCE_BATCH_BINARY_MAGIC);
    let manifest_length = u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize;
    let record_offset = BINARY_ENVELOPE_HEADER_LEN + manifest_length;
    let manifest: serde_json::Value =
        serde_json::from_slice(&bytes[BINARY_ENVELOPE_HEADER_LEN..record_offset])
            .expect("batch manifest should remain JSON");
    assert_eq!(
        manifest["requestedLayers"],
        serde_json::json!(["terrain", "buildings", "objects", "generated", "env-cells"])
    );
    assert_eq!(manifest["records"].as_array().map(Vec::len), Some(5));
    assert_eq!(&bytes[record_offset..], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
}

#[test]
fn active_region_binary_projects_semantic_records_and_height_table() {
    let mut land_height_table = [0.0; 256];
    let sample_height_index = land_height_table.len() / 2;
    let expected_height = 42.5;
    land_height_table[sample_height_index] = expected_height;
    let active_region = ActiveRegionData::new(Arc::new(RegionDesc {
        id: 0x1300_0000,
        region_number: 1,
        version: 3,
        region_name: "Dereth".to_owned(),
        land_defs: LandDefs {
            num_block_length: 255,
            num_block_width: 255,
            square_length: 24.0,
            lblock_length: 192,
            vertex_per_cell: 8,
            max_obj_height: 64.0,
            sky_height: 500.0,
            road_width: 1.0,
            land_height_table,
        },
        game_time: GameTime {
            zero_time_of_year: 0.0,
            zero_year: 0,
            day_length: 1.0,
            days_per_year: 365,
            year_spec: "year".to_owned(),
            times_of_day: Vec::new(),
            days_of_the_week: Vec::new(),
            seasons: Vec::new(),
        },
        parts_mask: 0x04,
        sky_info: None,
        sound_info: None,
        scene_info: None,
        terrain_info: Some(TerrainDesc::default()),
        region_misc: None,
    }));

    let bytes = serialize_active_region_binary(&active_region)
        .expect("active-region response should serialize");

    assert_eq!(&bytes[..4], ACTIVE_REGION_BINARY_MAGIC);
    let manifest_length = u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize;
    let section_offset = BINARY_ENVELOPE_HEADER_LEN + manifest_length;
    let manifest: serde_json::Value =
        serde_json::from_slice(&bytes[BINARY_ENVELOPE_HEADER_LEN..section_offset])
            .expect("active-region manifest should remain JSON");
    assert_eq!(manifest["provenance"]["sourceRecordId"], "0x13000000");
    assert_eq!(manifest["data"]["land"]["squareLength"], 24.0);
    assert_eq!(
        manifest["data"]["terrain"]["landSurface"]["kind"],
        "texture-merge"
    );
    assert_eq!(manifest["sections"][0]["name"], "landHeightTable");
    let scalar_size = std::mem::size_of::<f32>();
    let sample_offset = section_offset + sample_height_index * scalar_size;
    assert_eq!(
        f32::from_le_bytes(
            bytes[sample_offset..sample_offset + scalar_size]
                .try_into()
                .unwrap()
        ),
        expected_height
    );
}

#[test]
fn landblock_parser_normalizes_cell_suffix() {
    assert_eq!(parse_landblock_id("0x0102abcd").unwrap(), 0x0102ffff);
    assert!(parse_landblock_id("not-a-landblock").is_err());
}

#[tokio::test]
async fn landblock_profile_projects_classification_and_normalized_identity() {
    let directory = tempdir().expect("temporary directory should be created");
    let path = directory.path().join("landblock-profile.hba");
    write_profile_hba(&path);
    let repository =
        Arc::new(ContentRepository::from_hba_path(&path).expect("profile HBA should be readable"));
    let service = ContentAssetService::new(repository, Arc::new(ContentDecodeCache::new()));
    let runtime = ContentAssetRuntime::new(service);

    let dungeon = load_landblock_profile_response(&runtime, "0x00050123")
        .await
        .expect("dungeon profile should load")
        .expect("dungeon CellLandblock should exist");
    assert_eq!(dungeon.landblock_id, "0x0005ffff");
    assert_eq!(
        dungeon.scene_class,
        landblock_profile::LandblockSceneClassWire::DungeonOnly
    );

    let outdoor = load_landblock_profile_response(&runtime, "0x0102ffff")
        .await
        .expect("outdoor profile should load")
        .expect("outdoor CellLandblock should exist");
    assert_eq!(outdoor.landblock_id, "0x0102ffff");
    assert_eq!(
        outdoor.scene_class,
        landblock_profile::LandblockSceneClassWire::OutdoorWithEnvCells
    );
}

#[tokio::test]
async fn landblock_profile_preserves_absence_and_content_failures() {
    let directory = tempdir().expect("temporary directory should be created");
    let path = directory.path().join("landblock-profile-errors.hba");
    write_profile_hba(&path);
    let repository =
        Arc::new(ContentRepository::from_hba_path(&path).expect("profile HBA should be readable"));
    let service = ContentAssetService::new(repository, Arc::new(ContentDecodeCache::new()));
    let runtime = ContentAssetRuntime::new(service);

    assert!(
        load_landblock_profile_response(&runtime, "0x0103ffff")
            .await
            .expect("absent profile should be a successful lookup")
            .is_none()
    );
    let error = load_landblock_profile_response(&runtime, "0x0104ffff")
        .await
        .expect_err("a promised LandblockInfo failure must propagate");
    assert!(format!("{error:#}").contains("promises required LandblockInfo"));
}

#[test]
fn terrain_availability_represents_only_valid_absence() {
    assert!(matches!(
        terrain_availability(None),
        TerrainAvailabilityManifest::MissingCellLandblock
    ));
}

#[test]
fn texture_pixel_binary_preserves_declared_pixel_section() {
    let manifest = TexturePixelsManifest {
        transport: "holtburger-texture-pixels",
        byte_order: "little-endian",
        section_byte_offset_base: "section-data",
        source_asset_id: "surface-texture/0x05000001".to_string(),
        purpose: "terrain-blend-mask".to_string(),
        surface: TexturePixelsSurfaceManifest::Conventional(TexturePixelsSurfaceFields {
            source_record_id: "0x06000001".to_string(),
            format: "r8",
            width: 2,
            height: 2,
        }),
        sections: vec![BinarySectionManifest {
            name: "pixels",
            scalar_type: "u8",
            element_count: 4,
            byte_offset: 0,
            byte_length: 4,
        }],
    };
    let bytes = serialize_texture_pixels_binary(&manifest, &[1, 2, 3, 4])
        .expect("texture pixels should serialize");

    assert_eq!(&bytes[..4], TEXTURE_PIXELS_BINARY_MAGIC);
    let manifest_length = u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize;
    let encoded_manifest: serde_json::Value = serde_json::from_slice(
        &bytes[BINARY_ENVELOPE_HEADER_LEN..BINARY_ENVELOPE_HEADER_LEN + manifest_length],
    )
    .expect("texture manifest should remain JSON");
    assert!(encoded_manifest["surface"].get("meanRgb").is_none());
    assert_eq!(
        u32::from_le_bytes(bytes[8..12].try_into().unwrap()) as usize,
        bytes.len()
    );
    assert_eq!(
        &bytes[BINARY_ENVELOPE_HEADER_LEN + manifest_length..],
        &[1, 2, 3, 4]
    );
}

#[test]
fn texture_request_rejects_untyped_or_non_surface_texture_ids() {
    assert_eq!(
        parse_surface_texture_asset_id("surface-texture/0x05001234").unwrap(),
        0x0500_1234
    );
    assert!(parse_surface_texture_asset_id("render-surface/0x06001234").is_err());
    assert!(parse_surface_texture_asset_id("surface-texture/0x06001234").is_err());
    assert_eq!(
        texture_output_format("terrain-road-mask").unwrap(),
        TexturePixelFormat::R8
    );
    assert!(texture_output_format("object-detail").is_err());
}

#[tokio::test]
async fn texture_pixel_response_loads_normalized_content_through_the_runtime() {
    let directory = tempdir().expect("temporary directory should be created");
    let path = directory.path().join("texture-response.hba");
    let mut writer = HbaWriter::new();
    writer.set_compression(false);
    writer
        .add(
            EOR_PORTAL_NAMESPACE,
            holtburger_dat::file_type::REGION_DESC_FILE_ID,
            DatFileType::Region as u32,
            test_region_desc_bytes(),
        )
        .expect("active region should be added");
    writer
        .add(
            EOR_PORTAL_NAMESPACE,
            0x0500_0001,
            DatFileType::SurfaceTexture as u32,
            test_surface_texture_bytes(0x0500_0001, &[0x0600_0001]),
        )
        .expect("surface texture should be added");
    writer
        .add(
            EOR_PORTAL_NAMESPACE,
            0x0600_0001,
            DatFileType::Texture as u32,
            test_render_surface_bytes(
                0x0600_0001,
                PixelFormatId::A8R8G8B8,
                &[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
            ),
        )
        .expect("render surface should be added");
    writer.write(&path).expect("test HBA should be written");

    let repository = Arc::new(
        ContentRepository::from_hba_path(&path).expect("test repository should be opened"),
    );
    let state = SharedHostContent::from_repository(repository)
        .expect("test content repository should initialize");
    let bytes = build_texture_pixels_response(
        &state.runtime,
        LoadTexturePixelsRequest {
            kind: "prepared-texture-surface".to_string(),
            purpose: "terrain-color".to_string(),
            source_asset_id: "surface-texture/0x05000001".to_string(),
            palette_composite: None,
        },
    )
    .await
    .expect("texture pixels should load through the content runtime");

    assert_eq!(&bytes[..4], TEXTURE_PIXELS_BINARY_MAGIC);
    let manifest_length = u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize;
    let section_data_offset = BINARY_ENVELOPE_HEADER_LEN + manifest_length;
    let manifest: serde_json::Value =
        serde_json::from_slice(&bytes[BINARY_ENVELOPE_HEADER_LEN..section_data_offset])
            .expect("response manifest should decode");
    assert_eq!(manifest["surface"]["format"], "rgba8");
    let mean = manifest["surface"]["meanRgb"]
        .as_array()
        .expect("terrain color should carry a mean RGB");
    assert!((mean[0].as_f64().unwrap() - 9.0 / 255.0).abs() < 1.0e-6);
    assert!((mean[1].as_f64().unwrap() - 8.0 / 255.0).abs() < 1.0e-6);
    assert!((mean[2].as_f64().unwrap() - 7.0 / 255.0).abs() < 1.0e-6);
    assert_eq!(
        &bytes[section_data_offset..section_data_offset + 4],
        &[3, 2, 1, 4]
    );
}

#[test]
fn texture_mean_uses_wide_rgba8_channel_sums_and_ignores_alpha() {
    let mean = mean_rgb_rgba8(
        3,
        2,
        &[
            255, 0, 127, 0, 0, 255, 127, 255, 255, 0, 127, 1, 0, 255, 127, 2, 255, 0, 127, 3, 0,
            255, 127, 4,
        ],
    )
    .expect("complete non-square RGBA8 pixels should have a mean");
    assert!((mean[0] - 0.5).abs() < f32::EPSILON);
    assert!((mean[1] - 0.5).abs() < f32::EPSILON);
    assert!((mean[2] - 127.0 / 255.0).abs() < f32::EPSILON);

    let wide_texel_count = usize::try_from(u64::from(u32::MAX) / u64::from(u8::MAX) + 1)
        .expect("wide fixture count should fit usize");
    let wide_mean = mean_rgb_from_rgba8_texels(
        wide_texel_count,
        std::iter::repeat_n([255, 1, 0, 255], wide_texel_count),
    )
    .expect("channel sums larger than u32 should remain exact");
    assert_eq!(wide_mean[0], 1.0);
    assert!((wide_mean[1] - 1.0 / 255.0).abs() < f32::EPSILON);
    assert_eq!(wide_mean[2], 0.0);

    assert!(mean_rgb_rgba8(0, 0, &[]).is_err());
    assert!(mean_rgb_rgba8(1, 1, &[1, 2, 3]).is_err());
}

#[tokio::test]
async fn palette_pixel_response_composites_ranges_and_echoes_the_requested_identity() {
    let directory = tempdir().expect("temporary directory should be created");
    let path = directory.path().join("palette-composite.hba");
    let mut writer = HbaWriter::new();
    writer.set_compression(false);
    for (palette_id, colors) in [
        (0x0400_0001_u32, [0xFF11_1111_u32, 0xFF22_2222, 0xFF33_3333]),
        (0x0400_0002, [0xFF44_4444, 0xFF55_5555, 0xFF66_6666]),
    ] {
        writer
            .add(
                EOR_PORTAL_NAMESPACE,
                palette_id,
                DatFileType::Palette as u32,
                test_palette_bytes(palette_id, &colors),
            )
            .expect("palette should be added");
    }
    writer.write(&path).expect("test HBA should be written");

    let repository = Arc::new(
        ContentRepository::from_hba_path(&path).expect("test repository should be opened"),
    );
    let state = SharedHostContent::from_repository(repository)
        .expect("test content repository should initialize");
    let identity = "palette-composite:04000001:04000002+1+1".to_string();
    let bytes = build_texture_pixels_response(
        &state.runtime,
        LoadTexturePixelsRequest {
            kind: "prepared-object-palette".to_string(),
            purpose: "object-palette".to_string(),
            source_asset_id: identity.clone(),
            palette_composite: Some(LoadPaletteCompositeRequest {
                base_palette_id: "0x04000001".to_string(),
                ranges: vec![LoadPaletteRangeRequest {
                    replacement_palette_id: "0x04000002".to_string(),
                    offset: 1,
                    color_count: 1,
                }],
            }),
        },
    )
    .await
    .expect("composited palette pixels should load");

    let manifest_length = u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize;
    let section_data_offset = BINARY_ENVELOPE_HEADER_LEN + manifest_length;
    let manifest: serde_json::Value =
        serde_json::from_slice(&bytes[BINARY_ENVELOPE_HEADER_LEN..section_data_offset])
            .expect("response manifest should decode");
    // The caller keyed its request on the composition, so that is what must come back.
    assert_eq!(manifest["sourceAssetId"], identity);

    // Only the requested range changes, and it takes the replacement's color from the same
    // absolute index rather than from the replacement's start.
    let pixels = &bytes[section_data_offset..];
    assert_eq!(&pixels[..4], &[0x11, 0x11, 0x11, 0xFF]);
    assert_eq!(&pixels[4..8], &[0x55, 0x55, 0x55, 0xFF]);
    assert_eq!(&pixels[8..12], &[0x33, 0x33, 0x33, 0xFF]);
}

fn write_profile_hba(path: &std::path::Path) {
    let mut writer = HbaWriter::new();
    writer.set_compression(false);
    writer
        .add(
            EOR_PORTAL_NAMESPACE,
            holtburger_dat::file_type::REGION_DESC_FILE_ID,
            DatFileType::Region as u32,
            test_region_desc_bytes(),
        )
        .expect("profile region should be added");

    writer
        .add(
            EOR_CELL_NAMESPACE,
            0x0005_ffff,
            DatFileType::Landblock as u32,
            test_cell_landblock_bytes(0x0005_ffff, true, false),
        )
        .expect("dungeon CellLandblock should be added");
    writer
        .add(
            EOR_CELL_NAMESPACE,
            0x0005_fffe,
            DatFileType::LandblockInfo as u32,
            test_landblock_info_bytes(0x0005_fffe, 817),
        )
        .expect("dungeon LandblockInfo should be added");

    writer
        .add(
            EOR_CELL_NAMESPACE,
            0x0102_ffff,
            DatFileType::Landblock as u32,
            test_cell_landblock_bytes(0x0102_ffff, true, true),
        )
        .expect("outdoor CellLandblock should be added");
    writer
        .add(
            EOR_CELL_NAMESPACE,
            0x0102_fffe,
            DatFileType::LandblockInfo as u32,
            test_landblock_info_bytes(0x0102_fffe, 1),
        )
        .expect("outdoor LandblockInfo should be added");

    writer
        .add(
            EOR_CELL_NAMESPACE,
            0x0104_ffff,
            DatFileType::Landblock as u32,
            test_cell_landblock_bytes(0x0104_ffff, true, false),
        )
        .expect("failing CellLandblock should be added");
    writer.write(path).expect("profile HBA should be written");
}

fn test_cell_landblock_bytes(id: u32, has_objects: bool, nonzero_height: bool) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(252);
    bytes.extend(id.to_le_bytes());
    bytes.extend(u32::from(has_objects).to_le_bytes());
    bytes.extend(std::iter::repeat_n(0u16, 81).flat_map(u16::to_le_bytes));
    for index in 0..81 {
        bytes.push(u8::from(nonzero_height && index == 0));
    }
    while !bytes.len().is_multiple_of(4) {
        bytes.push(0);
    }
    bytes
}

fn test_landblock_info_bytes(id: u32, num_cells: u32) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(16);
    bytes.extend(id.to_le_bytes());
    bytes.extend(num_cells.to_le_bytes());
    bytes.extend(0u32.to_le_bytes());
    bytes.extend(0u16.to_le_bytes());
    bytes.extend(0u16.to_le_bytes());
    bytes
}

fn test_palette_bytes(id: u32, colors_argb: &[u32]) -> Vec<u8> {
    let mut bytes = Vec::new();
    bytes.extend(id.to_le_bytes());
    bytes.extend((colors_argb.len() as u32).to_le_bytes());
    for color in colors_argb {
        bytes.extend(color.to_le_bytes());
    }
    bytes
}

fn test_surface_texture_bytes(id: u32, render_surface_ids: &[u32]) -> Vec<u8> {
    let mut bytes = Vec::new();
    bytes.extend(id.to_le_bytes());
    bytes.extend(0i32.to_le_bytes());
    bytes.push(1);
    bytes.extend(
        u32::try_from(render_surface_ids.len())
            .unwrap()
            .to_le_bytes(),
    );
    for render_surface_id in render_surface_ids {
        bytes.extend(render_surface_id.to_le_bytes());
    }
    bytes
}

fn test_render_surface_bytes(id: u32, format: PixelFormatId, source_data: &[u8]) -> Vec<u8> {
    let mut bytes = Vec::new();
    bytes.extend(id.to_le_bytes());
    bytes.extend(0i32.to_le_bytes());
    bytes.extend(2u32.to_le_bytes());
    bytes.extend(2u32.to_le_bytes());
    bytes.extend(format.raw().to_le_bytes());
    bytes.extend(u32::try_from(source_data.len()).unwrap().to_le_bytes());
    bytes.extend(source_data);
    bytes
}

fn test_region_desc_bytes() -> Vec<u8> {
    let mut bytes = Vec::new();
    bytes.extend_from_slice(&holtburger_dat::file_type::REGION_DESC_FILE_ID.to_le_bytes());
    bytes.extend_from_slice(&1_u32.to_le_bytes());
    bytes.extend_from_slice(&1_u32.to_le_bytes());
    push_test_pstring(&mut bytes, "");
    bytes.resize(bytes.len() + 32 + 256 * 4, 0);
    bytes.resize(bytes.len() + 8 + 4 + 4 + 4, 0);
    push_test_pstring(&mut bytes, "");
    bytes.extend_from_slice(&0_u32.to_le_bytes());
    bytes.extend_from_slice(&0_u32.to_le_bytes());
    bytes.extend_from_slice(&0_u32.to_le_bytes());
    bytes.extend_from_slice(&0_u32.to_le_bytes());
    bytes
}

fn push_test_pstring(bytes: &mut Vec<u8>, value: &str) {
    bytes.extend_from_slice(&(value.len() as u16).to_le_bytes());
    bytes.extend_from_slice(value.as_bytes());
    while !bytes.len().is_multiple_of(4) {
        bytes.push(0);
    }
}
