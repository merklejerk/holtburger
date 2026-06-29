use std::collections::{HashMap, HashSet};

use holtburger_dat::file_type::{CellStruct, EnvCell, Environment, GfxObj, SetupModel};
use holtburger_dat::graphics::{Frame, Polygon};
use holtburger_dat::landblock::{CellLandblock, LandblockInfo};
use holtburger_dat::physics::BspNode;
use holtburger_dat::{EOR_CELL_NAMESPACE, EOR_PORTAL_NAMESPACE};

use crate::material_variants::legacy_sampler_material_variant_signature;
use crate::source_reader::ContentSourceReader;
use crate::static_outdoor_scene::{
    StaticOutdoorScene, StaticOutdoorSceneAssembler, StaticOutdoorSceneSourceFamilies,
};
use crate::{ContentDecodeCache, ContentRepository, normalize_landblock_id};

pub const LANDBLOCK_GRID_SIZE: usize = 9;
pub const LANDBLOCK_TILE_SIZE: f32 = 24.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LandblockClassification {
    Outdoor,
    Dungeon,
}

#[derive(Debug, Clone)]
pub struct EnvCellAsset {
    pub env_cell: EnvCellFact,
    pub prepared_cell: PreparedInteriorCell,
    pub static_meshes: Vec<PreparedStaticMesh>,
    pub diagnostics: PreparedContentSourceDiagnostics,
}

#[derive(Debug, Clone)]
pub struct LandblockOutdoorAsset {
    pub landblock_id: u32,
    pub cell_landblock: Option<CellLandblockFact>,
    pub terrain_mesh: Option<PreparedTerrainMesh>,
    pub statics: Vec<LandblockOutdoorStaticMember>,
    pub building_transition_apertures: Vec<PreparedBuildingTransitionAperture>,
    pub outdoor_bvh: Option<PreparedBvh>,
    pub diagnostics: PreparedContentSourceDiagnostics,
}

#[derive(Debug, Clone)]
pub struct LandblockTopologyAsset {
    pub landblock_id: u32,
    pub landblock_info_id: u32,
    pub classification: LandblockClassification,
    pub env_cells: Vec<EnvCellFact>,
    pub diagnostics: PreparedContentSourceDiagnostics,
}

#[derive(Debug, Clone)]
pub struct LandblockEnvCellsAsset {
    pub landblock_id: u32,
    pub landblock_info_id: u32,
    pub env_cells: Vec<LandblockEnvCellBundleCell>,
    pub landblock_bvh_items: Vec<LandblockEnvCellBvhItem>,
    pub landblock_bvh: Option<PreparedBvh>,
    pub diagnostics: PreparedContentSourceDiagnostics,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum LandblockSceneLodLevel {
    /// Terrain source only.
    Level0,
    /// Terrain plus outdoor building source.
    Level1,
    /// Level 1 plus explicit outdoor object source.
    Level2,
    /// Level 2 plus generated outdoor scenery source.
    Level3,
    /// Level 3 plus env-cell system source.
    Level4,
}

impl LandblockSceneLodLevel {
    pub fn from_u8(value: u8) -> Option<Self> {
        match value {
            0 => Some(Self::Level0),
            1 => Some(Self::Level1),
            2 => Some(Self::Level2),
            3 => Some(Self::Level3),
            4 => Some(Self::Level4),
            _ => None,
        }
    }

    pub fn as_u8(self) -> u8 {
        match self {
            Self::Level0 => 0,
            Self::Level1 => 1,
            Self::Level2 => 2,
            Self::Level3 => 3,
            Self::Level4 => 4,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum LandblockSceneLodContext {
    Outdoor,
    Interior,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct LandblockSceneLodRequest {
    pub landblock_id: u32,
    pub level: LandblockSceneLodLevel,
    pub context: LandblockSceneLodContext,
}

impl LandblockSceneLodRequest {
    pub fn outdoor(raw_landblock_id: u32, level: LandblockSceneLodLevel) -> Self {
        Self {
            landblock_id: normalize_landblock_id(raw_landblock_id),
            level,
            context: LandblockSceneLodContext::Outdoor,
        }
    }
}

#[derive(Debug, Clone)]
pub struct LandblockSceneLodAsset {
    pub landblock_id: u32,
    pub level: LandblockSceneLodLevel,
    pub context: LandblockSceneLodContext,
    pub layers: Vec<LandblockSceneLodLayer>,
    pub diagnostics: PreparedContentSourceDiagnostics,
}

#[derive(Debug, Clone)]
pub enum LandblockSceneLodLayer {
    Terrain(LandblockSceneLodTerrainLayer),
    OutdoorBuildings(LandblockSceneLodOutdoorBuildingsLayer),
    OutdoorExplicitObjects(LandblockSceneLodOutdoorStaticLayer),
    OutdoorGeneratedScenery(LandblockSceneLodOutdoorStaticLayer),
    EnvCellSystem(LandblockSceneLodEnvCellSystemLayer),
}

#[derive(Debug, Clone)]
pub struct LandblockSceneLodTerrainLayer {
    /// Terrain mesh for the requested landblock, or `None` when source records were unavailable.
    pub terrain_mesh: Option<PreparedTerrainMesh>,
}

#[derive(Debug, Clone)]
pub struct LandblockSceneLodOutdoorBuildingsLayer {
    /// Prepared outdoor building members for this landblock LoD layer.
    pub statics: Vec<LandblockOutdoorStaticMember>,
    /// Transition apertures derived from building portal geometry.
    pub building_transition_apertures: Vec<PreparedBuildingTransitionAperture>,
    /// Layer-local BVH for building members with finite instance bounds.
    pub outdoor_bvh: Option<PreparedBvh>,
}

#[derive(Debug, Clone)]
pub struct LandblockSceneLodOutdoorStaticLayer {
    /// Prepared static members for this landblock LoD layer.
    pub statics: Vec<LandblockOutdoorStaticMember>,
    /// Layer-local BVH for static members with finite instance bounds.
    pub outdoor_bvh: Option<PreparedBvh>,
}

#[derive(Debug, Clone)]
pub struct LandblockSceneLodEnvCellSystemLayer {
    /// Normalized outdoor landblock id that owns this env-cell system.
    pub landblock_id: u32,
    /// Normalized landblock-info record id used to discover env cells.
    pub landblock_info_id: u32,
    /// Building transition apertures needed to connect outdoor building portals to env cells.
    pub building_transition_apertures: Vec<PreparedBuildingTransitionAperture>,
    /// Prepared env-cell bundle cells for this landblock.
    pub env_cells: Vec<LandblockEnvCellBundleCell>,
    /// Landblock-space env-cell BVH item records.
    pub landblock_bvh_items: Vec<LandblockEnvCellBvhItem>,
    /// Landblock-space env-cell BVH.
    pub landblock_bvh: Option<PreparedBvh>,
    /// Diagnostics collected while preparing the env-cell system layer.
    pub diagnostics: PreparedContentSourceDiagnostics,
}

#[derive(Debug, Clone)]
pub struct LandblockEnvCellBundleCell {
    pub env_cell: EnvCellFact,
    pub prepared_cell: PreparedInteriorCell,
    pub static_meshes: Vec<PreparedStaticMesh>,
    pub landblock_bounds: Option<PreparedAabb>,
    pub diagnostics: PreparedContentSourceDiagnostics,
}

#[derive(Debug, Clone)]
pub struct LandblockEnvCellBvhItem {
    pub env_cell_id: u32,
    pub member_id: String,
    pub bounds: PreparedAabb,
    pub source: LandblockEnvCellBvhItemSource,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LandblockEnvCellBvhItemSource {
    EnvCellRoot,
    Derived,
}

#[derive(Debug, Clone)]
pub struct LandblockOutdoorStaticMember {
    pub instance: PreparedStaticInstance,
    pub source_bounds: Option<PreparedAabb>,
    pub instance_bounds: Option<PreparedAabb>,
    pub building: Option<LandblockOutdoorBuildingFacts>,
    pub generated: Option<LandblockGeneratedSceneryFacts>,
}

#[derive(Debug, Clone)]
pub struct LandblockOutdoorBuildingFacts {
    pub num_leaves: u32,
    pub portals: Vec<LandblockBuildingPortal>,
}

#[derive(Debug, Clone)]
pub struct LandblockGeneratedSceneryFacts {
    pub terrain_index: usize,
    pub scene_id: u32,
    pub scene_template_index: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LandblockBuildingPortal {
    pub portal_id: String,
    pub source_index: usize,
    pub flags: u16,
    pub other_cell_id: u16,
    pub other_portal_id: u16,
    pub stab_list: Vec<u16>,
    pub linked_env_cell_ids: Vec<u32>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PreparedBuildingTransitionAperture {
    pub aperture_id: String,
    pub building_instance_id: String,
    pub source_did: u32,
    pub source_asset_id: String,
    pub portal_index: i16,
    pub poly_id: u16,
    pub building_portal_id: String,
    pub building_portal_source_index: usize,
    pub flags: u16,
    pub other_cell_id: u16,
    pub other_portal_id: u16,
    pub linked_env_cell_ids: Vec<u32>,
    pub points: Vec<PreparedVec3>,
}

#[derive(Debug, Clone)]
pub struct CellLandblockFact {
    pub id: u32,
    pub has_objects: bool,
    pub grid_size: usize,
    pub tile_size: f32,
    pub terrain_types: Vec<u16>,
    pub heights: Vec<f32>,
    pub min_height: f32,
    pub max_height: f32,
    pub all_heights_zero: bool,
}

#[derive(Debug, Clone)]
pub struct LandblockInfoFact {
    pub id: u32,
    pub first_env_cell_id: Option<u32>,
    pub num_env_cells: u32,
    pub object_count: usize,
    pub building_count: usize,
    pub pack_mask: u16,
    pub restrictions: Vec<LandblockRestriction>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LandblockRestriction {
    pub cell_id: u32,
    pub restriction_object_id: u32,
}

#[derive(Debug, Default, Clone)]
struct LandblockInteriorFacts {
    env_cells: Vec<EnvCellFact>,
    environments: Vec<EnvironmentFact>,
}

#[derive(Debug, Clone)]
pub struct EnvCellFact {
    pub env_cell_id: u32,
    pub environment_id: Option<u32>,
    pub cell_structure_id: Option<u32>,
    pub local_placement: Frame,
    pub surface_ids: Vec<u32>,
    pub visible_cell_ids: Vec<u32>,
    pub portals: Vec<EnvCellPortalFact>,
    pub static_objects: Vec<IndoorStaticObjectFact>,
    pub seen_outside: Option<bool>,
    pub restriction_object_id: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EnvCellPortalFact {
    pub portal_id: String,
    pub source_index: usize,
    pub flags: u16,
    pub polygon_id: u16,
    pub other_cell_id: u16,
    pub other_portal_id: u16,
    pub target_env_cell_id: Option<u32>,
    pub is_outside_transition: bool,
}

#[derive(Debug, Clone)]
pub struct IndoorStaticObjectFact {
    pub instance_id: String,
    pub owning_env_cell_id: u32,
    pub source_did: u32,
    pub source_asset_id: String,
    pub source_index: usize,
    pub local_placement: Frame,
}

#[derive(Debug, Clone)]
pub struct EnvironmentFact {
    pub id: u32,
    pub cell_structure_ids: Vec<u32>,
    pub cell_structures: Vec<CellStruct>,
}

#[derive(Debug, Clone)]
pub struct PreparedTerrainMesh {
    pub landblock_id: u32,
    pub grid_size: usize,
    pub tile_size: f32,
    pub vertices: Vec<PreparedVec3>,
    pub triangles: Vec<PreparedTerrainTriangle>,
    pub quads: Vec<PreparedTerrainQuad>,
    pub terrain_bvh_items: Vec<PreparedTerrainBvhItem>,
    pub terrain_bvh: Option<PreparedBvh>,
    pub min_height: f32,
    pub max_height: f32,
}

#[derive(Debug, Clone)]
pub struct PreparedTerrainTriangle {
    pub a: usize,
    pub b: usize,
    pub c: usize,
    pub terrain_type: u16,
    pub average_height: f32,
}

#[derive(Debug, Clone)]
pub struct PreparedTerrainQuad {
    pub terrain_quad_id: String,
    pub row: usize,
    pub col: usize,
    pub quad_index: usize,
    pub source_terrain_indices: [usize; 4],
    pub vertex_indices: [usize; 4],
    pub triangle_indices: [usize; 2],
    pub diagonal: PreparedTerrainQuadDiagonal,
    pub corner_terrain_codes: [u32; 4],
    pub pcode: u32,
    pub average_height: f32,
    pub bounds: PreparedAabb,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PreparedTerrainQuadDiagonal {
    SouthwestNortheast,
    SoutheastNorthwest,
}

#[derive(Debug, Clone)]
pub struct PreparedTerrainBvhItem {
    pub row: usize,
    pub col: usize,
    pub quad_index: usize,
    pub triangle_indices: [usize; 2],
}

#[derive(Debug, Clone)]
pub struct PreparedInteriorCell {
    pub env_cell_id: u32,
    pub environment_id: u32,
    pub cell_structure_id: u32,
    pub local_placement: Frame,
    pub surface_ids: Vec<u32>,
    pub portals: Vec<EnvCellPortalFact>,
    pub portal_apertures: Vec<PreparedPortalAperture>,
    pub static_object_count: usize,
    pub cell_bsp: BspNode,
    pub render_geometry: PreparedPolygonSetRenderGeometry,
}

#[derive(Debug, Clone)]
pub struct PreparedPortalAperture {
    pub portal_id: String,
    pub source_index: usize,
    pub polygon_id: u16,
    pub points: Vec<PreparedVec3>,
    pub plane: Option<PreparedPortalAperturePlane>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PreparedPortalAperturePlane {
    pub normal: PreparedVec3,
    pub constant: f32,
    pub source: PreparedPortalAperturePlaneSource,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PreparedPortalAperturePlaneSource {
    DrawingBspPortal,
    DerivedFromRenderPoints,
}

#[derive(Debug, Clone)]
pub struct PreparedStaticInstance {
    pub instance_id: String,
    pub kind: PreparedStaticInstanceKind,
    pub owning_landblock_id: u32,
    pub owning_env_cell_id: Option<u32>,
    pub source_did: u32,
    pub source_asset_id: String,
    pub source_index: usize,
    pub local_placement: Frame,
    pub source_scale: PreparedVec3,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PreparedStaticInstanceKind {
    Scenery,
    Building,
    GeneratedScenery,
    IndoorStatic,
}

struct PreparedStaticInstanceSpec {
    kind: PreparedStaticInstanceKind,
    instance_id: String,
    owning_landblock_id: u32,
    owning_env_cell_id: Option<u32>,
    source_did: u32,
    source_index: usize,
    local_placement: Frame,
    source_scale: PreparedVec3,
}

#[derive(Debug, Clone)]
pub struct PreparedStaticMesh {
    pub instance_id: String,
    pub kind: PreparedStaticInstanceKind,
    pub owning_landblock_id: u32,
    pub owning_env_cell_id: Option<u32>,
    pub source_did: u32,
    pub source_asset_id: String,
    pub source_index: usize,
    pub local_placement: Frame,
    pub source_scale: PreparedVec3,
    pub part_index: usize,
    pub gfx_obj_id: u32,
    pub gfx_obj_asset_id: String,
    pub part_placements: Vec<Frame>,
    pub part_scale: PreparedVec3,
    pub source_bounds: Option<PreparedAabb>,
    pub instance_bounds: Option<PreparedAabb>,
}

#[derive(Debug, Clone)]
struct PreparedSpatialItem {
    id: String,
    kind: PreparedSpatialItemKind,
    bounds: PreparedAabb,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PreparedSpatialItemKind {
    TerrainQuad,
    EnvCellRoot,
    OutdoorStatic,
    Building,
    IndoorStatic,
}

#[derive(Debug, Clone)]
pub struct PreparedBvh {
    pub coordinate_space: &'static str,
    pub landblock_id: u32,
    pub scope: PreparedBvhScope,
    pub nodes: Vec<PreparedBvhNode>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PreparedBvhScope {
    OutdoorTerrain,
    OutdoorStatic,
    LandblockEnvCells,
    EnvCellLocal,
}

#[derive(Debug, Clone)]
pub struct PreparedBvhNode {
    pub bounds: PreparedAabb,
    pub left: Option<usize>,
    pub right: Option<usize>,
    pub item_indices: Vec<usize>,
    pub kind_mask: PreparedBvhKindMask,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PreparedBvhKindMask {
    OutdoorTerrain {
        terrain_quad: bool,
    },
    OutdoorStatic {
        static_object: bool,
        building: bool,
    },
    LandblockEnvCells {
        env_cell_root: bool,
    },
    EnvCellLocal {
        cell_structure_geometry: bool,
        static_object: bool,
        portal: bool,
    },
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PreparedVec3 {
    pub x: f32,
    pub y: f32,
    pub z: f32,
}

#[derive(Debug, Clone)]
pub struct PreparedPolygonSetRenderGeometry {
    pub source_id: u32,
    pub vertex_count: usize,
    pub triangle_count: usize,
    pub positions: Vec<f32>,
    pub normals: Vec<f32>,
    pub uvs: Vec<f32>,
    pub triangles: Vec<PreparedPolygonSetRenderTriangle>,
    pub surface_ids: Vec<i16>,
    pub invalid_polygons: Vec<PreparedPolygonSetInvalidPolygon>,
    pub skipped_polygon_count: usize,
    pub bounds: Option<PreparedAabb>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreparedPolygonSetRenderTriangle {
    pub polygon_id: u16,
    pub surface_id: Option<i16>,
    pub material_variant_signature: String,
    pub first_vertex: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreparedPolygonSetInvalidPolygon {
    pub polygon_id: u16,
    pub reason: &'static str,
    pub vertex_ids: Vec<u16>,
    pub missing_vertex_ids: Vec<u16>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PreparedAabb {
    pub min: PreparedVec3,
    pub max: PreparedVec3,
}

pub fn pad_bvh_bounds(mut bounds: PreparedAabb) -> PreparedAabb {
    const EPSILON: f32 = 0.001;
    if bounds.max.x - bounds.min.x < EPSILON {
        bounds.min.x -= EPSILON;
        bounds.max.x += EPSILON;
    }
    if bounds.max.y - bounds.min.y < EPSILON {
        bounds.min.y -= EPSILON;
        bounds.max.y += EPSILON;
    }
    if bounds.max.z - bounds.min.z < EPSILON {
        bounds.min.z -= EPSILON;
        bounds.max.z += EPSILON;
    }
    bounds
}

#[derive(Debug, Default, Clone)]
pub struct PreparedContentSourceDiagnostics {
    pub source_records: Vec<SourceRecordDiagnostic>,
    pub omissions: Vec<SourceOmissionDiagnostic>,
    pub errors: Vec<SourceLoadError>,
}

impl PreparedContentSourceDiagnostics {
    pub fn extend(&mut self, other: Self) {
        self.source_records.extend(other.source_records);
        self.omissions.extend(other.omissions);
        self.errors.extend(other.errors);
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceRecordDiagnostic {
    pub namespace: &'static str,
    pub file_id: u32,
    pub role: &'static str,
    pub status: SourceRecordStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SourceRecordStatus {
    Loaded,
    Missing,
    DecodeFailed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceOmissionDiagnostic {
    pub namespace: &'static str,
    pub file_id: u32,
    pub role: &'static str,
    pub reason: &'static str,
    pub detail: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceLoadError {
    pub namespace: &'static str,
    pub file_id: u32,
    pub role: &'static str,
    pub error_code: &'static str,
    pub detail: String,
}

#[derive(Debug, Default, Clone, Copy)]
pub struct EnvCellAssetAssembler;

#[derive(Debug, Default, Clone, Copy)]
pub struct LandblockOutdoorAssetAssembler;

#[derive(Debug, Default, Clone, Copy)]
pub struct LandblockTopologyAssetAssembler;

#[derive(Debug, Default, Clone, Copy)]
pub struct LandblockEnvCellsAssetAssembler;

#[derive(Debug, Default, Clone, Copy)]
pub struct LandblockSceneLodAssetAssembler;

struct PreparedContentAssemblyContext<'a> {
    source: ContentSourceReader<'a>,
    diagnostics: PreparedContentSourceDiagnostics,
}

/// Source record load result with missing assets separated from corrupt/unreadable assets.
enum SourceRecordLoad<T> {
    Loaded(T),
    Missing,
    DecodeFailed,
}

impl<'a> PreparedContentAssemblyContext<'a> {
    fn new(content: &'a ContentRepository) -> Self {
        Self {
            source: ContentSourceReader::new(content),
            diagnostics: PreparedContentSourceDiagnostics::default(),
        }
    }

    fn with_decode_cache(
        content: &'a ContentRepository,
        decode_cache: &'a ContentDecodeCache,
    ) -> Self {
        Self {
            source: ContentSourceReader::with_decode_cache(content, decode_cache),
            diagnostics: PreparedContentSourceDiagnostics::default(),
        }
    }

    fn load_cell_landblock(&mut self, landblock_id: u32) -> Option<CellLandblock> {
        match self.source.cell_landblock(landblock_id) {
            Ok(landblock) => {
                self.report_source_record(
                    EOR_CELL_NAMESPACE,
                    landblock_id,
                    "cell-landblock",
                    SourceRecordStatus::Loaded,
                );
                Some(landblock)
            }
            Err(error) => {
                self.report_source_record(
                    EOR_CELL_NAMESPACE,
                    landblock_id,
                    "cell-landblock",
                    source_status_from_error(&error),
                );
                self.report_source_error(
                    EOR_CELL_NAMESPACE,
                    landblock_id,
                    "cell-landblock",
                    source_error_code_from_error(&error),
                    format!("Could not load CellLandblock 0x{landblock_id:08X}: {error:#}"),
                );
                None
            }
        }
    }

    fn load_landblock_info(&mut self, landblock_id: u32) -> Option<LandblockInfo> {
        match self.load_landblock_info_record(landblock_id) {
            SourceRecordLoad::Loaded(info) => Some(info),
            SourceRecordLoad::Missing | SourceRecordLoad::DecodeFailed => None,
        }
    }

    fn load_landblock_info_record(&mut self, landblock_id: u32) -> SourceRecordLoad<LandblockInfo> {
        let landblock_info_id = derive_landblock_info_id(landblock_id);
        match self.source.landblock_info(landblock_info_id) {
            Ok(info) => {
                self.report_source_record(
                    EOR_CELL_NAMESPACE,
                    landblock_info_id,
                    "landblock-info",
                    SourceRecordStatus::Loaded,
                );
                SourceRecordLoad::Loaded(info)
            }
            Err(error) => {
                let status = source_status_from_error(&error);
                self.report_source_record(
                    EOR_CELL_NAMESPACE,
                    landblock_info_id,
                    "landblock-info",
                    status,
                );
                self.report_source_error(
                    EOR_CELL_NAMESPACE,
                    landblock_info_id,
                    "landblock-info",
                    source_error_code_from_error(&error),
                    format!("Could not load LandblockInfo 0x{landblock_info_id:08X}: {error:#}"),
                );
                match status {
                    SourceRecordStatus::Missing => SourceRecordLoad::Missing,
                    SourceRecordStatus::DecodeFailed => SourceRecordLoad::DecodeFailed,
                    SourceRecordStatus::Loaded => unreachable!("source error cannot be loaded"),
                }
            }
        }
    }

    fn load_env_cell(&mut self, env_cell_id: u32) -> Option<EnvCell> {
        match self.source.env_cell(env_cell_id) {
            Ok(env_cell) => {
                self.report_source_record(
                    EOR_CELL_NAMESPACE,
                    env_cell_id,
                    "env-cell",
                    SourceRecordStatus::Loaded,
                );
                Some(env_cell)
            }
            Err(error) => {
                self.report_source_record(
                    EOR_CELL_NAMESPACE,
                    env_cell_id,
                    "env-cell",
                    source_status_from_error(&error),
                );
                self.report_source_error(
                    EOR_CELL_NAMESPACE,
                    env_cell_id,
                    "env-cell",
                    source_error_code_from_error(&error),
                    format!("Could not load EnvCell 0x{env_cell_id:08X}: {error:#}"),
                );
                None
            }
        }
    }

    fn load_environment(&mut self, environment_id: u32) -> Option<Environment> {
        match self.source.environment(environment_id) {
            Ok(environment) => {
                self.report_source_record(
                    EOR_PORTAL_NAMESPACE,
                    environment_id,
                    "environment",
                    SourceRecordStatus::Loaded,
                );
                Some(environment)
            }
            Err(error) => {
                self.report_source_record(
                    EOR_PORTAL_NAMESPACE,
                    environment_id,
                    "environment",
                    source_status_from_error(&error),
                );
                self.report_source_error(
                    EOR_PORTAL_NAMESPACE,
                    environment_id,
                    "environment",
                    source_error_code_from_error(&error),
                    format!("Could not load Environment 0x{environment_id:08X}: {error:#}"),
                );
                None
            }
        }
    }

    fn report_source_record(
        &mut self,
        namespace: &'static str,
        file_id: u32,
        role: &'static str,
        status: SourceRecordStatus,
    ) {
        self.diagnostics
            .source_records
            .push(SourceRecordDiagnostic {
                namespace,
                file_id,
                role,
                status,
            });
    }

    fn report_source_error(
        &mut self,
        namespace: &'static str,
        file_id: u32,
        role: &'static str,
        error_code: &'static str,
        detail: String,
    ) {
        self.diagnostics.errors.push(SourceLoadError {
            namespace,
            file_id,
            role,
            error_code,
            detail,
        });
    }

    fn report_source_omission(
        &mut self,
        namespace: &'static str,
        file_id: u32,
        role: &'static str,
        reason: &'static str,
        detail: String,
    ) {
        self.diagnostics.omissions.push(SourceOmissionDiagnostic {
            namespace,
            file_id,
            role,
            reason,
            detail,
        });
    }

    fn into_diagnostics(self) -> PreparedContentSourceDiagnostics {
        self.diagnostics
    }
}

impl EnvCellAssetAssembler {
    pub fn new() -> Self {
        Self
    }

    pub fn assemble_env_cell(
        &self,
        content: &ContentRepository,
        env_cell_id: u32,
    ) -> Option<EnvCellAsset> {
        self.assemble_env_cell_with_context(
            PreparedContentAssemblyContext::new(content),
            env_cell_id,
        )
    }

    pub fn assemble_env_cell_with_cache(
        &self,
        content: &ContentRepository,
        decode_cache: &ContentDecodeCache,
        env_cell_id: u32,
    ) -> Option<EnvCellAsset> {
        self.try_assemble_env_cell_with_context(
            PreparedContentAssemblyContext::with_decode_cache(content, decode_cache),
            env_cell_id,
        )
        .ok()
    }

    pub fn try_assemble_env_cell_with_cache(
        &self,
        content: &ContentRepository,
        decode_cache: &ContentDecodeCache,
        env_cell_id: u32,
    ) -> anyhow::Result<EnvCellAsset> {
        self.try_assemble_env_cell_with_context(
            PreparedContentAssemblyContext::with_decode_cache(content, decode_cache),
            env_cell_id,
        )
    }

    fn assemble_env_cell_with_context(
        &self,
        context: PreparedContentAssemblyContext<'_>,
        env_cell_id: u32,
    ) -> Option<EnvCellAsset> {
        self.try_assemble_env_cell_with_context(context, env_cell_id)
            .ok()
    }

    fn try_assemble_env_cell_with_context(
        &self,
        mut context: PreparedContentAssemblyContext<'_>,
        env_cell_id: u32,
    ) -> anyhow::Result<EnvCellAsset> {
        let source = context
            .load_env_cell(env_cell_id)
            .ok_or_else(|| env_cell_assembly_error(env_cell_id, &context.diagnostics))?;
        let env_cell = EnvCellFact::from_env_cell(env_cell_id, &source);
        let environment_id = env_cell.environment_id.ok_or_else(|| {
            anyhow::anyhow!("EnvCell 0x{env_cell_id:08X} did not declare an environment id")
        })?;
        let cell_structure_id = env_cell.cell_structure_id.ok_or_else(|| {
            anyhow::anyhow!("EnvCell 0x{env_cell_id:08X} did not declare a cell structure id")
        })?;
        let environment = load_environment_fact(&mut context, environment_id, &[cell_structure_id])
            .ok_or_else(|| env_cell_assembly_error(env_cell_id, &context.diagnostics))?;
        let interiors = LandblockInteriorFacts {
            env_cells: vec![env_cell.clone()],
            environments: vec![environment],
        };
        let prepared_cell = build_prepared_interior_cells(&interiors)
            .into_iter()
            .next()
            .ok_or_else(|| {
                anyhow::anyhow!(
                    "EnvCell 0x{env_cell_id:08X} could not produce prepared interior geometry"
                )
            })?;
        let landblock_id = normalize_landblock_id(env_cell_id & 0xffff_0000);
        let indoor_instances =
            build_prepared_indoor_static_instances(landblock_id, &interiors).collect::<Vec<_>>();
        let static_meshes =
            build_prepared_static_meshes(&mut context, indoor_instances.iter(), true);
        let diagnostics = context.into_diagnostics();

        Ok(EnvCellAsset {
            env_cell,
            prepared_cell,
            static_meshes,
            diagnostics,
        })
    }
}

fn env_cell_assembly_error(
    env_cell_id: u32,
    diagnostics: &PreparedContentSourceDiagnostics,
) -> anyhow::Error {
    let details = diagnostics
        .errors
        .iter()
        .map(|error| {
            format!(
                "{}:0x{:08X} {} {}: {}",
                error.namespace, error.file_id, error.role, error.error_code, error.detail
            )
        })
        .collect::<Vec<_>>();
    if details.is_empty() {
        anyhow::anyhow!(
            "Could not assemble EnvCell 0x{env_cell_id:08X}; no source diagnostics were recorded"
        )
    } else {
        anyhow::anyhow!(
            "Could not assemble EnvCell 0x{env_cell_id:08X}; {}",
            details.join("; ")
        )
    }
}

fn landblock_env_cells_assembly_error(
    landblock_id: u32,
    diagnostics: &PreparedContentSourceDiagnostics,
) -> anyhow::Error {
    let details = diagnostics
        .errors
        .iter()
        .map(|error| {
            format!(
                "{}:0x{:08X} {} {}: {}",
                error.namespace, error.file_id, error.role, error.error_code, error.detail
            )
        })
        .collect::<Vec<_>>();
    if details.is_empty() {
        anyhow::anyhow!(
            "Could not assemble landblock env-cell bundle 0x{landblock_id:08X}; no source diagnostics were recorded"
        )
    } else {
        anyhow::anyhow!(
            "Could not assemble landblock env-cell bundle 0x{landblock_id:08X}; {}",
            details.join("; ")
        )
    }
}

impl LandblockOutdoorAssetAssembler {
    pub fn new() -> Self {
        Self
    }

    pub fn assemble_landblock(
        &self,
        content: &ContentRepository,
        raw_landblock_id: u32,
    ) -> LandblockOutdoorAsset {
        self.assemble_landblock_with_context(
            PreparedContentAssemblyContext::new(content),
            raw_landblock_id,
        )
    }

    pub fn assemble_landblock_with_cache(
        &self,
        content: &ContentRepository,
        decode_cache: &ContentDecodeCache,
        raw_landblock_id: u32,
    ) -> LandblockOutdoorAsset {
        self.assemble_landblock_with_context(
            PreparedContentAssemblyContext::with_decode_cache(content, decode_cache),
            raw_landblock_id,
        )
    }

    fn assemble_landblock_with_context(
        &self,
        mut context: PreparedContentAssemblyContext<'_>,
        raw_landblock_id: u32,
    ) -> LandblockOutdoorAsset {
        let landblock_id = normalize_landblock_id(raw_landblock_id);
        let cell_landblock_source = context.load_cell_landblock(landblock_id);
        let cell_landblock = cell_landblock_source
            .as_ref()
            .map(CellLandblockFact::from_landblock);
        let landblock_info_source = context.load_landblock_info(landblock_id);
        let terrain_mesh = cell_landblock.as_ref().map(build_terrain_mesh);
        let outdoor_scene = match cell_landblock_source.as_ref() {
            Some(source_landblock) => match context.source.region_desc() {
                Ok(region) => match StaticOutdoorSceneAssembler::new().assemble_from_loaded(
                    &mut context.source,
                    landblock_id,
                    Some(source_landblock),
                    landblock_info_source.as_ref(),
                    None,
                    Some(&region),
                    StaticOutdoorSceneSourceFamilies::ALL,
                ) {
                    Ok(scene) => Some(scene),
                    Err(error) => {
                        context.report_source_error(
                            EOR_CELL_NAMESPACE,
                            landblock_id,
                            "landblock-outdoor",
                            "asset-decode-failed",
                            format!(
                                "Could not assemble outdoor static scene 0x{landblock_id:08X}: {error}"
                            ),
                        );
                        None
                    }
                },
                Err(error) => {
                    context.report_source_error(
                        EOR_CELL_NAMESPACE,
                        landblock_id,
                        "region-desc",
                        "asset-decode-failed",
                        format!("Could not load RegionDesc for outdoor landblock 0x{landblock_id:08X}: {error:#}"),
                    );
                    None
                }
            },
            None => None,
        };
        let instances =
            build_prepared_outdoor_static_instances(outdoor_scene.as_ref()).collect::<Vec<_>>();
        let static_meshes = build_prepared_static_meshes(&mut context, instances.iter(), true);
        let statics = build_landblock_outdoor_static_members(
            outdoor_scene.as_ref(),
            instances,
            &static_meshes,
        );
        let building_transition_apertures =
            build_prepared_building_transition_apertures(&mut context, outdoor_scene.as_ref());
        let spatial_items = build_outdoor_member_spatial_items(landblock_id, &statics);
        let outdoor_bvh = build_prepared_bvh(landblock_id, &spatial_items);
        let diagnostics = context.into_diagnostics();

        LandblockOutdoorAsset {
            landblock_id,
            cell_landblock,
            terrain_mesh,
            statics,
            building_transition_apertures,
            outdoor_bvh,
            diagnostics,
        }
    }
}

impl LandblockTopologyAssetAssembler {
    pub fn new() -> Self {
        Self
    }

    pub fn assemble_landblock(
        &self,
        content: &ContentRepository,
        raw_landblock_id: u32,
    ) -> LandblockTopologyAsset {
        self.assemble_landblock_with_context(
            PreparedContentAssemblyContext::new(content),
            raw_landblock_id,
        )
    }

    pub fn assemble_landblock_with_cache(
        &self,
        content: &ContentRepository,
        decode_cache: &ContentDecodeCache,
        raw_landblock_id: u32,
    ) -> LandblockTopologyAsset {
        self.assemble_landblock_with_context(
            PreparedContentAssemblyContext::with_decode_cache(content, decode_cache),
            raw_landblock_id,
        )
    }

    fn assemble_landblock_with_context(
        &self,
        mut context: PreparedContentAssemblyContext<'_>,
        raw_landblock_id: u32,
    ) -> LandblockTopologyAsset {
        let landblock_id = normalize_landblock_id(raw_landblock_id);
        let landblock_info_id = derive_landblock_info_id(landblock_id);
        let landblock_info = context
            .load_landblock_info(landblock_id)
            .as_ref()
            .map(|info| LandblockInfoFact::from_info(info, landblock_id));
        let classification = classify_scene_landblock(landblock_info.as_ref());
        let env_cells = landblock_info
            .as_ref()
            .map(|info| load_env_cell_facts(&mut context, landblock_id, info))
            .unwrap_or_default();
        let diagnostics = context.into_diagnostics();

        LandblockTopologyAsset {
            landblock_id,
            landblock_info_id,
            classification,
            env_cells,
            diagnostics,
        }
    }
}

impl LandblockEnvCellsAssetAssembler {
    pub fn new() -> Self {
        Self
    }

    pub fn assemble_landblock_with_cache(
        &self,
        content: &ContentRepository,
        decode_cache: &ContentDecodeCache,
        raw_landblock_id: u32,
    ) -> anyhow::Result<LandblockEnvCellsAsset> {
        self.assemble_landblock_with_context(
            PreparedContentAssemblyContext::with_decode_cache(content, decode_cache),
            raw_landblock_id,
        )
    }

    fn assemble_landblock_with_context(
        &self,
        mut context: PreparedContentAssemblyContext<'_>,
        raw_landblock_id: u32,
    ) -> anyhow::Result<LandblockEnvCellsAsset> {
        let landblock_id = normalize_landblock_id(raw_landblock_id);
        let landblock_info_id = derive_landblock_info_id(landblock_id);
        let landblock_info = match context.load_landblock_info_record(landblock_id) {
            SourceRecordLoad::Loaded(info) => LandblockInfoFact::from_info(&info, landblock_id),
            SourceRecordLoad::Missing => {
                let diagnostics = context.into_diagnostics();
                return Ok(empty_landblock_env_cells_asset(
                    landblock_id,
                    landblock_info_id,
                    diagnostics,
                ));
            }
            SourceRecordLoad::DecodeFailed => {
                let diagnostics = context.into_diagnostics();
                return Err(landblock_env_cells_assembly_error(
                    landblock_id,
                    &diagnostics,
                ));
            }
        };
        let env_cell_facts = load_env_cell_facts(&mut context, landblock_id, &landblock_info);
        let environments = load_bundle_environment_facts(&mut context, &env_cell_facts);
        let interiors = LandblockInteriorFacts {
            env_cells: env_cell_facts,
            environments,
        };
        let prepared_cells_by_id = build_prepared_interior_cells(&interiors)
            .into_iter()
            .map(|cell| (cell.env_cell_id, cell))
            .collect::<HashMap<_, _>>();
        let indoor_instances =
            build_prepared_indoor_static_instances(landblock_id, &interiors).collect::<Vec<_>>();
        let static_meshes =
            build_prepared_static_meshes(&mut context, indoor_instances.iter(), false);
        let mut static_meshes_by_env_cell = static_meshes.into_iter().fold(
            HashMap::<u32, Vec<PreparedStaticMesh>>::new(),
            |mut cells, mesh| {
                if let Some(env_cell_id) = mesh.owning_env_cell_id {
                    cells.entry(env_cell_id).or_default().push(mesh);
                }
                cells
            },
        );
        let env_cells = interiors
            .env_cells
            .into_iter()
            .filter_map(|env_cell| {
                let prepared_cell = prepared_cells_by_id.get(&env_cell.env_cell_id)?.clone();
                let static_meshes = static_meshes_by_env_cell
                    .remove(&env_cell.env_cell_id)
                    .unwrap_or_default();
                let landblock_bounds = derive_cell_bsp_render_bounds_by_plane_triples(
                    &prepared_cell.cell_bsp,
                )
                .map(|bounds| {
                    pad_bvh_bounds(transform_render_local_bounds_by_ac_frame(
                        bounds,
                        &prepared_cell.local_placement,
                        unit_prepared_vec3(),
                    ))
                });
                if landblock_bounds.is_none() {
                    context.report_source_omission(
                        EOR_CELL_NAMESPACE,
                        env_cell.env_cell_id,
                        "landblock-env-cell-bvh",
                        "missing-bounds",
                        format!(
                            "EnvCell 0x{:08X} CellBSP did not produce finite bounds for landblock-wide BVH inclusion",
                            env_cell.env_cell_id
                        ),
                    );
                }
                Some(LandblockEnvCellBundleCell {
                    diagnostics: PreparedContentSourceDiagnostics::default(),
                    static_meshes,
                    landblock_bounds,
                    env_cell,
                    prepared_cell,
                })
            })
            .collect::<Vec<_>>();
        let landblock_bvh_items = build_landblock_env_cell_bvh_items(&env_cells);
        let landblock_bvh_spatial_items =
            build_landblock_env_cell_bvh_spatial_items(&landblock_bvh_items);
        let landblock_bvh = build_prepared_bvh_with_scope(
            landblock_id,
            "landblock-env-cell-root",
            PreparedBvhScope::LandblockEnvCells,
            &landblock_bvh_spatial_items,
        );
        let diagnostics = context.into_diagnostics();

        Ok(LandblockEnvCellsAsset {
            landblock_id,
            landblock_info_id,
            env_cells,
            landblock_bvh_items,
            landblock_bvh,
            diagnostics,
        })
    }
}

impl LandblockSceneLodAssetAssembler {
    pub fn new() -> Self {
        Self
    }

    pub fn assemble_landblock_with_cache(
        &self,
        content: &ContentRepository,
        decode_cache: &ContentDecodeCache,
        request: LandblockSceneLodRequest,
    ) -> LandblockSceneLodAsset {
        self.assemble_landblock_extending_cached_asset(content, decode_cache, request, None)
    }

    pub fn assemble_landblock_extending_cached_asset(
        &self,
        content: &ContentRepository,
        decode_cache: &ContentDecodeCache,
        request: LandblockSceneLodRequest,
        cached: Option<&LandblockSceneLodAsset>,
    ) -> LandblockSceneLodAsset {
        let mut context = PreparedContentAssemblyContext::with_decode_cache(content, decode_cache);
        let cached_level = cached
            .filter(|asset| {
                asset.landblock_id == request.landblock_id && asset.context == request.context
            })
            .map(|asset| asset.level);
        let mut layers = cached
            .into_iter()
            .flat_map(|asset| &asset.layers)
            .filter(|layer| {
                landblock_scene_lod_layer_level(layer).as_u8()
                    <= cached_level
                        .expect("cached layer iteration requires cached level")
                        .as_u8()
                    && landblock_scene_lod_layer_level(layer).as_u8() <= request.level.as_u8()
            })
            .cloned()
            .collect::<Vec<_>>();
        layers.extend(match request.context {
            LandblockSceneLodContext::Outdoor => {
                self.assemble_outdoor_layers(&mut context, request, cached_level)
            }
            LandblockSceneLodContext::Interior => Vec::new(),
        });
        let mut diagnostics = cached
            .filter(|asset| asset.level.as_u8() <= request.level.as_u8())
            .map(|asset| asset.diagnostics.clone())
            .unwrap_or_default();
        diagnostics.extend(context.into_diagnostics());
        if request.level == LandblockSceneLodLevel::Level4
            && cached_level
                .is_none_or(|level| level.as_u8() < LandblockSceneLodLevel::Level4.as_u8())
        {
            let building_transition_apertures =
                collect_scene_lod_building_transition_apertures(&layers);
            match LandblockEnvCellsAssetAssembler::new().assemble_landblock_with_cache(
                content,
                decode_cache,
                request.landblock_id,
            ) {
                Ok(env_cells) => layers.push(LandblockSceneLodLayer::EnvCellSystem(
                    landblock_scene_lod_env_cell_system_layer(
                        env_cells,
                        building_transition_apertures,
                    ),
                )),
                Err(error) => diagnostics.errors.push(SourceLoadError {
                    namespace: EOR_CELL_NAMESPACE,
                    file_id: request.landblock_id,
                    role: "landblock-scene-lod-env-cell-system",
                    error_code: "asset-decode-failed",
                    detail: format!(
                        "Could not assemble scene LoD 4 env-cell system for landblock 0x{:08X}: {error:#}",
                        request.landblock_id
                    ),
                }),
            }
        }

        LandblockSceneLodAsset {
            landblock_id: request.landblock_id,
            level: request.level,
            context: request.context,
            layers,
            diagnostics,
        }
    }

    fn assemble_outdoor_layers(
        &self,
        context: &mut PreparedContentAssemblyContext<'_>,
        request: LandblockSceneLodRequest,
        cached_level: Option<LandblockSceneLodLevel>,
    ) -> Vec<LandblockSceneLodLayer> {
        let landblock_id = request.landblock_id;
        let static_families = scene_lod_missing_static_source_families(request.level, cached_level);
        let needs_terrain = cached_level.is_none();
        let needs_cell_landblock = needs_terrain || static_families.generated_scenery;
        let cell_landblock_source = needs_cell_landblock
            .then(|| context.load_cell_landblock(landblock_id))
            .flatten();
        let terrain_mesh = needs_terrain
            .then(|| {
                cell_landblock_source
                    .as_ref()
                    .map(CellLandblockFact::from_landblock)
                    .map(|cell_landblock| build_terrain_mesh(&cell_landblock))
            })
            .flatten();
        let landblock_info_source = if static_families.is_empty() {
            None
        } else {
            context.load_landblock_info(landblock_id)
        };
        let outdoor_scene = self.assemble_gated_outdoor_scene(
            context,
            request,
            cell_landblock_source.as_ref(),
            landblock_info_source.as_ref(),
            static_families,
        );
        let instances =
            build_prepared_outdoor_static_instances(outdoor_scene.as_ref()).collect::<Vec<_>>();
        let static_meshes = build_prepared_static_meshes(context, instances.iter(), true);
        let statics = build_landblock_outdoor_static_members(
            outdoor_scene.as_ref(),
            instances,
            &static_meshes,
        );
        let building_transition_apertures =
            build_prepared_building_transition_apertures(context, outdoor_scene.as_ref());

        build_scene_lod_outdoor_layers(
            landblock_id,
            request.level,
            cached_level,
            terrain_mesh,
            statics,
            building_transition_apertures,
        )
    }

    fn assemble_gated_outdoor_scene(
        &self,
        context: &mut PreparedContentAssemblyContext<'_>,
        request: LandblockSceneLodRequest,
        cell_landblock: Option<&CellLandblock>,
        landblock_info: Option<&LandblockInfo>,
        static_families: StaticOutdoorSceneSourceFamilies,
    ) -> Option<StaticOutdoorScene> {
        if static_families.is_empty() {
            return None;
        }
        let region = if static_families.generated_scenery {
            match context.source.region_desc() {
                Ok(region) => Some(region),
                Err(error) => {
                    context.report_source_error(
                        EOR_CELL_NAMESPACE,
                        request.landblock_id,
                        "region-desc",
                        "asset-decode-failed",
                        format!(
                            "Could not load RegionDesc for scene LoD {} landblock 0x{:08X}: {error:#}",
                            request.level.as_u8(),
                            request.landblock_id
                        ),
                    );
                    None
                }
            }
        } else {
            None
        };
        let region_ref = region.as_ref();
        match StaticOutdoorSceneAssembler::new().assemble_from_loaded(
            &mut context.source,
            request.landblock_id,
            cell_landblock,
            landblock_info,
            None,
            region_ref,
            static_families,
        ) {
            Ok(scene) => Some(scene),
            Err(error) => {
                context.report_source_error(
                    EOR_CELL_NAMESPACE,
                    request.landblock_id,
                    "landblock-scene-lod",
                    "asset-decode-failed",
                    format!(
                        "Could not assemble scene LoD {} for landblock 0x{:08X}: {error:#}",
                        request.level.as_u8(),
                        request.landblock_id
                    ),
                );
                None
            }
        }
    }
}

fn landblock_scene_lod_env_cell_system_layer(
    asset: LandblockEnvCellsAsset,
    building_transition_apertures: Vec<PreparedBuildingTransitionAperture>,
) -> LandblockSceneLodEnvCellSystemLayer {
    LandblockSceneLodEnvCellSystemLayer {
        landblock_id: asset.landblock_id,
        landblock_info_id: asset.landblock_info_id,
        building_transition_apertures,
        env_cells: asset.env_cells,
        landblock_bvh_items: asset.landblock_bvh_items,
        landblock_bvh: asset.landblock_bvh,
        diagnostics: asset.diagnostics,
    }
}

fn collect_scene_lod_building_transition_apertures(
    layers: &[LandblockSceneLodLayer],
) -> Vec<PreparedBuildingTransitionAperture> {
    layers
        .iter()
        .flat_map(|layer| match layer {
            LandblockSceneLodLayer::OutdoorBuildings(layer) => {
                layer.building_transition_apertures.as_slice()
            }
            LandblockSceneLodLayer::Terrain(_)
            | LandblockSceneLodLayer::OutdoorExplicitObjects(_)
            | LandblockSceneLodLayer::OutdoorGeneratedScenery(_)
            | LandblockSceneLodLayer::EnvCellSystem(_) => &[],
        })
        .cloned()
        .collect()
}

#[cfg(test)]
fn scene_lod_static_source_families(
    level: LandblockSceneLodLevel,
) -> StaticOutdoorSceneSourceFamilies {
    match level {
        LandblockSceneLodLevel::Level0 => {
            StaticOutdoorSceneSourceFamilies::new(false, false, false)
        }
        LandblockSceneLodLevel::Level1 => StaticOutdoorSceneSourceFamilies::new(false, true, false),
        LandblockSceneLodLevel::Level2 => StaticOutdoorSceneSourceFamilies::new(true, true, false),
        LandblockSceneLodLevel::Level3 | LandblockSceneLodLevel::Level4 => {
            StaticOutdoorSceneSourceFamilies::ALL
        }
    }
}

fn scene_lod_missing_static_source_families(
    requested_level: LandblockSceneLodLevel,
    cached_level: Option<LandblockSceneLodLevel>,
) -> StaticOutdoorSceneSourceFamilies {
    let cached_level = cached_level.map(|level| level.as_u8()).unwrap_or(0);
    StaticOutdoorSceneSourceFamilies::new(
        requested_level.as_u8() >= LandblockSceneLodLevel::Level2.as_u8()
            && cached_level < LandblockSceneLodLevel::Level2.as_u8(),
        requested_level.as_u8() >= LandblockSceneLodLevel::Level1.as_u8()
            && cached_level < LandblockSceneLodLevel::Level1.as_u8(),
        requested_level.as_u8() >= LandblockSceneLodLevel::Level3.as_u8()
            && cached_level < LandblockSceneLodLevel::Level3.as_u8(),
    )
}

fn build_scene_lod_outdoor_layers(
    landblock_id: u32,
    level: LandblockSceneLodLevel,
    cached_level: Option<LandblockSceneLodLevel>,
    terrain_mesh: Option<PreparedTerrainMesh>,
    statics: Vec<LandblockOutdoorStaticMember>,
    building_transition_apertures: Vec<PreparedBuildingTransitionAperture>,
) -> Vec<LandblockSceneLodLayer> {
    let mut building_statics = Vec::new();
    let mut explicit_statics = Vec::new();
    let mut generated_statics = Vec::new();
    for member in statics {
        match member.instance.kind {
            PreparedStaticInstanceKind::Building => building_statics.push(member),
            PreparedStaticInstanceKind::Scenery => explicit_statics.push(member),
            PreparedStaticInstanceKind::GeneratedScenery => generated_statics.push(member),
            PreparedStaticInstanceKind::IndoorStatic => {}
        }
    }

    let has_cached_layers = cached_level.is_some();
    let cached_level = cached_level.map(|level| level.as_u8()).unwrap_or(0);
    let mut layers = Vec::new();
    if !has_cached_layers {
        layers.push(LandblockSceneLodLayer::Terrain(
            LandblockSceneLodTerrainLayer { terrain_mesh },
        ));
    }
    if level.as_u8() >= LandblockSceneLodLevel::Level1.as_u8()
        && cached_level < LandblockSceneLodLevel::Level1.as_u8()
    {
        let spatial_items = build_outdoor_member_spatial_items(landblock_id, &building_statics);
        layers.push(LandblockSceneLodLayer::OutdoorBuildings(
            LandblockSceneLodOutdoorBuildingsLayer {
                statics: building_statics,
                building_transition_apertures,
                outdoor_bvh: build_prepared_bvh(landblock_id, &spatial_items),
            },
        ));
    }
    if level.as_u8() >= LandblockSceneLodLevel::Level2.as_u8()
        && cached_level < LandblockSceneLodLevel::Level2.as_u8()
    {
        let spatial_items = build_outdoor_member_spatial_items(landblock_id, &explicit_statics);
        layers.push(LandblockSceneLodLayer::OutdoorExplicitObjects(
            LandblockSceneLodOutdoorStaticLayer {
                statics: explicit_statics,
                outdoor_bvh: build_prepared_bvh(landblock_id, &spatial_items),
            },
        ));
    }
    if level.as_u8() >= LandblockSceneLodLevel::Level3.as_u8()
        && cached_level < LandblockSceneLodLevel::Level3.as_u8()
    {
        let spatial_items = build_outdoor_member_spatial_items(landblock_id, &generated_statics);
        layers.push(LandblockSceneLodLayer::OutdoorGeneratedScenery(
            LandblockSceneLodOutdoorStaticLayer {
                statics: generated_statics,
                outdoor_bvh: build_prepared_bvh(landblock_id, &spatial_items),
            },
        ));
    }
    layers
}

fn landblock_scene_lod_layer_level(layer: &LandblockSceneLodLayer) -> LandblockSceneLodLevel {
    match layer {
        LandblockSceneLodLayer::Terrain(_) => LandblockSceneLodLevel::Level0,
        LandblockSceneLodLayer::OutdoorBuildings(_) => LandblockSceneLodLevel::Level1,
        LandblockSceneLodLayer::OutdoorExplicitObjects(_) => LandblockSceneLodLevel::Level2,
        LandblockSceneLodLayer::OutdoorGeneratedScenery(_) => LandblockSceneLodLevel::Level3,
        LandblockSceneLodLayer::EnvCellSystem(_) => LandblockSceneLodLevel::Level4,
    }
}

fn empty_landblock_env_cells_asset(
    landblock_id: u32,
    landblock_info_id: u32,
    diagnostics: PreparedContentSourceDiagnostics,
) -> LandblockEnvCellsAsset {
    LandblockEnvCellsAsset {
        landblock_id,
        landblock_info_id,
        env_cells: Vec::new(),
        landblock_bvh_items: Vec::new(),
        landblock_bvh: None,
        diagnostics,
    }
}

pub fn derive_landblock_info_id(raw_landblock_id: u32) -> u32 {
    normalize_landblock_id(raw_landblock_id) & 0xffff_fffe
}

pub fn derive_first_env_cell_id(raw_landblock_id: u32, num_env_cells: u32) -> Option<u32> {
    (num_env_cells > 0).then_some((normalize_landblock_id(raw_landblock_id) & 0xffff_0000) | 0x0100)
}

pub fn derive_landblock_env_cell_id(raw_landblock_id: u32, index: u32) -> u32 {
    ((normalize_landblock_id(raw_landblock_id) & 0xffff_0000) | 0x0100) + index
}

fn source_status_from_error(error: &anyhow::Error) -> SourceRecordStatus {
    if error.to_string().starts_with("Could not read ") {
        SourceRecordStatus::Missing
    } else {
        SourceRecordStatus::DecodeFailed
    }
}

fn source_error_code_from_error(error: &anyhow::Error) -> &'static str {
    if source_status_from_error(error) == SourceRecordStatus::Missing {
        "asset-read-failed"
    } else {
        "asset-decode-failed"
    }
}

fn load_env_cell_facts(
    context: &mut PreparedContentAssemblyContext<'_>,
    landblock_id: u32,
    landblock_info: &LandblockInfoFact,
) -> Vec<EnvCellFact> {
    let mut env_cells = Vec::new();
    for index in 0..landblock_info.num_env_cells {
        let env_cell_id = derive_landblock_env_cell_id(landblock_id, index);
        if let Some(env_cell) = context.load_env_cell(env_cell_id) {
            env_cells.push(EnvCellFact::from_env_cell(env_cell_id, &env_cell));
        }
    }
    env_cells
}

fn load_environment_fact(
    context: &mut PreparedContentAssemblyContext<'_>,
    environment_id: u32,
    selected_cell_structure_ids: &[u32],
) -> Option<EnvironmentFact> {
    let environment = context.load_environment(environment_id)?;
    Some(EnvironmentFact::from_environment(
        &environment,
        selected_cell_structure_ids,
        &mut context.diagnostics,
    ))
}

fn load_bundle_environment_facts(
    context: &mut PreparedContentAssemblyContext<'_>,
    env_cells: &[EnvCellFact],
) -> Vec<EnvironmentFact> {
    let mut selected_cell_structure_ids_by_environment = HashMap::<u32, Vec<u32>>::new();
    for env_cell in env_cells {
        let (Some(environment_id), Some(cell_structure_id)) =
            (env_cell.environment_id, env_cell.cell_structure_id)
        else {
            continue;
        };
        selected_cell_structure_ids_by_environment
            .entry(environment_id)
            .or_default()
            .push(cell_structure_id);
    }

    let mut environments = Vec::new();
    for (environment_id, mut cell_structure_ids) in selected_cell_structure_ids_by_environment {
        cell_structure_ids.sort_unstable();
        cell_structure_ids.dedup();
        if let Some(environment) =
            load_environment_fact(context, environment_id, &cell_structure_ids)
        {
            environments.push(environment);
        }
    }
    environments
}

impl CellLandblockFact {
    fn from_landblock(landblock: &CellLandblock) -> Self {
        let heights = landblock
            .height
            .iter()
            .map(|height| f32::from(*height) * 2.0)
            .collect::<Vec<_>>();
        let min_height = heights.iter().copied().reduce(f32::min).unwrap_or_default();
        let max_height = heights.iter().copied().reduce(f32::max).unwrap_or_default();

        Self {
            id: landblock.id,
            has_objects: landblock.has_objects != 0,
            grid_size: LANDBLOCK_GRID_SIZE,
            tile_size: LANDBLOCK_TILE_SIZE,
            terrain_types: landblock.terrain.clone(),
            heights,
            min_height,
            max_height,
            all_heights_zero: min_height == 0.0 && max_height == 0.0,
        }
    }
}

impl LandblockInfoFact {
    fn from_info(info: &LandblockInfo, landblock_id: u32) -> Self {
        let mut restrictions = info
            .restriction_tables
            .as_ref()
            .map(|table| {
                table
                    .tables
                    .iter()
                    .map(|(cell_id, restriction_object_id)| LandblockRestriction {
                        cell_id: *cell_id,
                        restriction_object_id: *restriction_object_id,
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        restrictions.sort_by_key(|restriction| restriction.cell_id);

        Self {
            id: info.id,
            first_env_cell_id: derive_first_env_cell_id(landblock_id, info.num_cells),
            num_env_cells: info.num_cells,
            object_count: info.objects.len(),
            building_count: info.buildings.len(),
            pack_mask: info.pack_mask,
            restrictions,
        }
    }
}

impl EnvCellFact {
    fn from_env_cell(env_cell_id: u32, env_cell: &EnvCell) -> Self {
        Self {
            env_cell_id,
            environment_id: Some(0x0D00_0000 | u32::from(env_cell.environment_id)),
            cell_structure_id: Some(u32::from(env_cell.cell_structure)),
            local_placement: env_cell.position.clone(),
            surface_ids: env_cell
                .surfaces
                .iter()
                .map(|surface_id| 0x0800_0000 | u32::from(*surface_id))
                .collect(),
            visible_cell_ids: env_cell
                .visible_cells
                .iter()
                .map(|cell_id| (env_cell_id & 0xffff_0000) | u32::from(*cell_id))
                .collect(),
            portals: env_cell
                .portals
                .iter()
                .enumerate()
                .map(|(source_index, portal)| {
                    let is_outside_transition = (portal.flags & 0x4) != 0;
                    EnvCellPortalFact {
                        portal_id: format!(
                            "interior-cell/{env_cell_id:08x}/portal/{source_index:02x}"
                        ),
                        source_index,
                        flags: portal.flags,
                        polygon_id: portal.polygon_id,
                        other_cell_id: portal.other_cell_id,
                        other_portal_id: portal.other_portal_id,
                        target_env_cell_id: (!is_outside_transition).then_some(
                            (env_cell_id & 0xffff_0000) | u32::from(portal.other_cell_id),
                        ),
                        is_outside_transition,
                    }
                })
                .collect(),
            static_objects: env_cell
                .static_objects
                .iter()
                .enumerate()
                .map(|(source_index, static_object)| IndoorStaticObjectFact {
                    instance_id: format!(
                        "env-cell-{env_cell_id:08x}-static-{source_index}-{:08x}",
                        static_object.stab_id
                    ),
                    owning_env_cell_id: env_cell_id,
                    source_did: static_object.stab_id,
                    source_asset_id: format_static_object_source_asset_id(static_object.stab_id),
                    source_index,
                    local_placement: static_object.position.clone(),
                })
                .collect(),
            seen_outside: Some((env_cell.flags & 0x01) != 0),
            restriction_object_id: env_cell.restriction_obj,
        }
    }
}

impl EnvironmentFact {
    fn from_environment(
        environment: &Environment,
        selected_cell_structure_ids: &[u32],
        diagnostics: &mut PreparedContentSourceDiagnostics,
    ) -> Self {
        let mut cell_structure_ids = selected_cell_structure_ids.to_vec();
        cell_structure_ids.sort_unstable();
        cell_structure_ids.dedup();

        let mut cell_structures = Vec::new();
        for cell_structure_id in &cell_structure_ids {
            match environment.cells.get(cell_structure_id) {
                Some(cell_structure) => cell_structures.push(cell_structure.clone()),
                None => diagnostics.errors.push(SourceLoadError {
                    namespace: EOR_PORTAL_NAMESPACE,
                    file_id: environment.id,
                    role: "environment-cell-structure",
                    error_code: "asset-decode-failed",
                    detail: format!(
                        "Environment 0x{:08X} did not contain selected CellStruct 0x{cell_structure_id:04X}",
                        environment.id
                    ),
                }),
            }
        }

        Self {
            id: environment.id,
            cell_structure_ids,
            cell_structures,
        }
    }
}

fn build_landblock_outdoor_static_members(
    outdoor_scene: Option<&StaticOutdoorScene>,
    instances: Vec<PreparedStaticInstance>,
    static_meshes: &[PreparedStaticMesh],
) -> Vec<LandblockOutdoorStaticMember> {
    let building_facts = outdoor_scene
        .into_iter()
        .flat_map(|scene| &scene.buildings)
        .map(|building| {
            (
                building.instance.identity.stable_id(),
                LandblockOutdoorBuildingFacts {
                    num_leaves: building.num_leaves,
                    portals: building
                        .portals
                        .iter()
                        .map(|portal| LandblockBuildingPortal {
                            portal_id: format!(
                                "{}/portal/{:04x}",
                                building.instance.identity.stable_id(),
                                portal.source_index
                            ),
                            source_index: portal.source_index,
                            flags: portal.flags,
                            other_cell_id: portal.other_cell_id,
                            other_portal_id: portal.other_portal_id,
                            stab_list: portal.stab_list.clone(),
                            linked_env_cell_ids: portal.linked_env_cell_ids.clone(),
                        })
                        .collect(),
                },
            )
        })
        .collect::<HashMap<_, _>>();
    let generated_facts = outdoor_scene
        .into_iter()
        .flat_map(|scene| &scene.generated_scenery)
        .map(|generated| {
            (
                generated.instance.identity.stable_id(),
                LandblockGeneratedSceneryFacts {
                    terrain_index: generated.terrain_index,
                    scene_id: generated.scene_id,
                    scene_template_index: generated.scene_template_index,
                },
            )
        })
        .collect::<HashMap<_, _>>();

    instances
        .into_iter()
        .map(|instance| {
            let (source_bounds, instance_bounds) =
                prepared_static_instance_bounds(&instance, static_meshes);
            LandblockOutdoorStaticMember {
                building: building_facts.get(&instance.instance_id).cloned(),
                generated: generated_facts.get(&instance.instance_id).cloned(),
                instance,
                source_bounds,
                instance_bounds,
            }
        })
        .collect()
}

fn build_prepared_building_transition_apertures(
    context: &mut PreparedContentAssemblyContext<'_>,
    outdoor_scene: Option<&StaticOutdoorScene>,
) -> Vec<PreparedBuildingTransitionAperture> {
    let Some(outdoor_scene) = outdoor_scene else {
        return Vec::new();
    };

    let mut apertures = Vec::new();
    let mut reported_missing = HashSet::new();
    for building in &outdoor_scene.buildings {
        let gfx_obj_id = building.instance.source.did;
        if gfx_obj_id >> 24 != 0x01 {
            context.report_source_omission(
                EOR_PORTAL_NAMESPACE,
                gfx_obj_id,
                "building-transition-aperture",
                "unsupported-building-source",
                format!(
                    "Building {} uses non-GfxObj source 0x{gfx_obj_id:08X}; transition aperture geometry was omitted",
                    building.instance.identity.stable_id()
                ),
            );
            continue;
        }

        match context.source.gfx_obj(gfx_obj_id) {
            Ok(gfx_obj) => apertures.extend(build_building_transition_apertures_from_gfx_obj(
                building,
                &gfx_obj,
                &mut context.diagnostics,
            )),
            Err(error) => report_renderable_load_error(
                &mut context.diagnostics,
                &mut reported_missing,
                gfx_obj_id,
                "building-transition-aperture",
                source_error_code_from_error(&error),
                format!(
                    "Could not load building GfxObj 0x{gfx_obj_id:08X} for transition apertures: {error:#}"
                ),
            ),
        }
    }
    apertures
}

fn build_building_transition_apertures_from_gfx_obj(
    building: &crate::static_outdoor_scene::StaticOutdoorBuilding,
    gfx_obj: &GfxObj,
    diagnostics: &mut PreparedContentSourceDiagnostics,
) -> Vec<PreparedBuildingTransitionAperture> {
    let building_instance_id = building.instance.identity.stable_id();
    let Some(drawing_bsp) = gfx_obj.drawing_bsp.as_ref() else {
        diagnostics.omissions.push(SourceOmissionDiagnostic {
            namespace: EOR_PORTAL_NAMESPACE,
            file_id: gfx_obj.id,
            role: "building-transition-aperture",
            reason: "missing-drawing-bsp",
            detail: format!(
                "Building {building_instance_id} GfxObj 0x{:08X} has no drawing BSP; transition aperture geometry was omitted",
                gfx_obj.id
            ),
        });
        return Vec::new();
    };

    let mut portal_polys = Vec::new();
    collect_bsp_portal_polys(drawing_bsp, &mut portal_polys);

    let source_asset_id = renderable_source_asset_id(gfx_obj.id)
        .unwrap_or_else(|| format!("gfx-obj/{:08x}", gfx_obj.id));
    let building_frame = convert_static_outdoor_frame(&building.instance.frame);
    let mut apertures = Vec::new();
    for portal_poly in portal_polys {
        let portal_index = portal_poly.portal_index;
        if portal_index < 0 {
            diagnostics.omissions.push(SourceOmissionDiagnostic {
                namespace: EOR_PORTAL_NAMESPACE,
                file_id: gfx_obj.id,
                role: "building-transition-aperture",
                reason: "negative-portal-index",
                detail: format!(
                    "Building {building_instance_id} GfxObj 0x{:08X} PortalPoly had negative portal_index {portal_index}; aperture was omitted",
                    gfx_obj.id
                ),
            });
            continue;
        }

        let Some(building_portal) = building.portals.get(portal_index as usize) else {
            diagnostics.omissions.push(SourceOmissionDiagnostic {
                namespace: EOR_PORTAL_NAMESPACE,
                file_id: gfx_obj.id,
                role: "building-transition-aperture",
                reason: "missing-building-portal",
                detail: format!(
                    "Building {building_instance_id} GfxObj 0x{:08X} PortalPoly portal_index {portal_index} did not match any CBldPortal metadata; aperture was omitted",
                    gfx_obj.id
                ),
            });
            continue;
        };

        if portal_poly.poly_id < 0 {
            diagnostics.omissions.push(SourceOmissionDiagnostic {
                namespace: EOR_PORTAL_NAMESPACE,
                file_id: gfx_obj.id,
                role: "building-transition-aperture",
                reason: "negative-polygon-id",
                detail: format!(
                    "Building {building_instance_id} GfxObj 0x{:08X} PortalPoly portal_index {portal_index} had negative poly_id {}; aperture was omitted",
                    gfx_obj.id, portal_poly.poly_id
                ),
            });
            continue;
        }

        let poly_id = portal_poly.poly_id as u16;
        let Some(polygon) = gfx_obj.polygons.get(&poly_id) else {
            diagnostics.omissions.push(SourceOmissionDiagnostic {
                namespace: EOR_PORTAL_NAMESPACE,
                file_id: gfx_obj.id,
                role: "building-transition-aperture",
                reason: "missing-drawing-polygon",
                detail: format!(
                    "Building {building_instance_id} GfxObj 0x{:08X} PortalPoly portal_index {portal_index} referenced missing drawing polygon {poly_id}; aperture was omitted",
                    gfx_obj.id
                ),
            });
            continue;
        };

        let model_points = build_portal_polygon_points(&gfx_obj.vertex_array, polygon);
        if model_points.len() < 3 {
            diagnostics.omissions.push(SourceOmissionDiagnostic {
                namespace: EOR_PORTAL_NAMESPACE,
                file_id: gfx_obj.id,
                role: "building-transition-aperture",
                reason: "malformed-drawing-polygon",
                detail: format!(
                    "Building {building_instance_id} GfxObj 0x{:08X} PortalPoly portal_index {portal_index} polygon {poly_id} produced {} points; aperture was omitted",
                    gfx_obj.id,
                    model_points.len()
                ),
            });
            continue;
        }

        let points = model_points
            .into_iter()
            .map(|point| {
                transform_render_local_point_by_ac_frame(
                    point,
                    &building_frame,
                    unit_prepared_vec3(),
                )
            })
            .collect::<Vec<_>>();
        apertures.push(PreparedBuildingTransitionAperture {
            aperture_id: format!(
                "building-transition-aperture:{building_instance_id}:{portal_index:04x}:{poly_id:04x}"
            ),
            building_instance_id: building_instance_id.clone(),
            source_did: gfx_obj.id,
            source_asset_id: source_asset_id.clone(),
            portal_index,
            poly_id,
            building_portal_id: format!("{building_instance_id}/portal/{portal_index:04x}"),
            building_portal_source_index: building_portal.source_index,
            flags: building_portal.flags,
            other_cell_id: building_portal.other_cell_id,
            other_portal_id: building_portal.other_portal_id,
            linked_env_cell_ids: building_portal.linked_env_cell_ids.clone(),
            points,
        });
    }
    apertures
}

fn collect_bsp_portal_polys<'a>(
    node: &'a BspNode,
    portal_polys: &mut Vec<&'a holtburger_dat::physics::PortalPoly>,
) {
    match node {
        BspNode::Port(portal) => {
            portal_polys.extend(portal.portal_polys.iter());
            collect_bsp_portal_polys(&portal.pos, portal_polys);
            collect_bsp_portal_polys(&portal.neg, portal_polys);
        }
        BspNode::Internal(internal) => {
            if let Some(pos) = internal.pos.as_deref() {
                collect_bsp_portal_polys(pos, portal_polys);
            }
            if let Some(neg) = internal.neg.as_deref() {
                collect_bsp_portal_polys(neg, portal_polys);
            }
        }
        BspNode::Leaf(_) => {}
    }
}

fn build_prepared_outdoor_static_instances(
    outdoor_scene: Option<&StaticOutdoorScene>,
) -> impl Iterator<Item = PreparedStaticInstance> + '_ {
    outdoor_scene.into_iter().flat_map(|scene| {
        scene
            .explicit_objects
            .iter()
            .filter_map(|instance| {
                build_prepared_static_instance(PreparedStaticInstanceSpec {
                    kind: PreparedStaticInstanceKind::Scenery,
                    instance_id: instance.identity.stable_id(),
                    owning_landblock_id: normalize_landblock_id(instance.owning_landblock_id),
                    owning_env_cell_id: None,
                    source_did: instance.source.did,
                    source_index: instance.source_index,
                    local_placement: convert_static_outdoor_frame(&instance.frame),
                    source_scale: unit_prepared_vec3(),
                })
            })
            .chain(scene.buildings.iter().filter_map(|building| {
                let instance = &building.instance;
                build_prepared_static_instance(PreparedStaticInstanceSpec {
                    kind: PreparedStaticInstanceKind::Building,
                    instance_id: instance.identity.stable_id(),
                    owning_landblock_id: normalize_landblock_id(instance.owning_landblock_id),
                    owning_env_cell_id: None,
                    source_did: instance.source.did,
                    source_index: instance.source_index,
                    local_placement: convert_static_outdoor_frame(&instance.frame),
                    source_scale: unit_prepared_vec3(),
                })
            }))
            .chain(scene.generated_scenery.iter().filter_map(|generated| {
                let instance = &generated.instance;
                build_prepared_static_instance(PreparedStaticInstanceSpec {
                    kind: PreparedStaticInstanceKind::GeneratedScenery,
                    instance_id: instance.identity.stable_id(),
                    owning_landblock_id: normalize_landblock_id(instance.owning_landblock_id),
                    owning_env_cell_id: None,
                    source_did: instance.source.did,
                    source_index: instance.source_index,
                    local_placement: convert_static_outdoor_frame(&instance.frame),
                    source_scale: PreparedVec3 {
                        x: generated.scale,
                        y: generated.scale,
                        z: generated.scale,
                    },
                })
            }))
    })
}

fn build_prepared_indoor_static_instances(
    landblock_id: u32,
    interiors: &LandblockInteriorFacts,
) -> impl Iterator<Item = PreparedStaticInstance> + '_ {
    interiors.env_cells.iter().flat_map(move |env_cell| {
        env_cell
            .static_objects
            .iter()
            .filter_map(move |static_object| {
                build_prepared_static_instance(PreparedStaticInstanceSpec {
                    kind: PreparedStaticInstanceKind::IndoorStatic,
                    instance_id: static_object.instance_id.clone(),
                    owning_landblock_id: landblock_id,
                    owning_env_cell_id: Some(static_object.owning_env_cell_id),
                    source_did: static_object.source_did,
                    source_index: static_object.source_index,
                    local_placement: static_object.local_placement.clone(),
                    source_scale: unit_prepared_vec3(),
                })
            })
    })
}

fn build_prepared_static_instance(
    spec: PreparedStaticInstanceSpec,
) -> Option<PreparedStaticInstance> {
    let source_asset_id = renderable_source_asset_id(spec.source_did)?;
    Some(PreparedStaticInstance {
        instance_id: spec.instance_id,
        kind: spec.kind,
        owning_landblock_id: spec.owning_landblock_id,
        owning_env_cell_id: spec.owning_env_cell_id,
        source_did: spec.source_did,
        source_asset_id,
        source_index: spec.source_index,
        local_placement: spec.local_placement,
        source_scale: spec.source_scale,
    })
}

fn build_prepared_static_meshes<'a>(
    context: &mut PreparedContentAssemblyContext<'_>,
    instances: impl Iterator<Item = &'a PreparedStaticInstance>,
    load_render_bounds: bool,
) -> Vec<PreparedStaticMesh> {
    let mut meshes = Vec::new();
    let mut reported_missing = HashSet::new();
    for instance in instances {
        match instance.source_did >> 24 {
            0x01 => {
                let source_bounds = if load_render_bounds {
                    load_gfx_obj_render_bounds(context, instance.source_did, &mut reported_missing)
                } else {
                    None
                };
                meshes.push(build_prepared_static_mesh(
                    instance,
                    0,
                    instance.source_did,
                    Vec::new(),
                    unit_prepared_vec3(),
                    source_bounds,
                ));
            }
            0x02 => {
                let Some(setup_model) = load_setup_model_for_static_mesh(
                    context,
                    instance.source_did,
                    &mut reported_missing,
                ) else {
                    continue;
                };
                for (part_index, gfx_obj_id) in setup_model.parts.iter().copied().enumerate() {
                    let source_bounds = if load_render_bounds {
                        load_gfx_obj_render_bounds(context, gfx_obj_id, &mut reported_missing)
                    } else {
                        None
                    };
                    meshes.push(build_prepared_static_mesh(
                        instance,
                        part_index,
                        gfx_obj_id,
                        derive_setup_part_default_placements(&setup_model, part_index),
                        setup_model
                            .default_scale
                            .get(part_index)
                            .copied()
                            .map(prepared_vec3_from_ac)
                            .unwrap_or_else(unit_prepared_vec3),
                        source_bounds,
                    ));
                }
            }
            _ => {}
        }
    }

    meshes.sort_by(|left, right| {
        left.instance_id
            .cmp(&right.instance_id)
            .then(left.part_index.cmp(&right.part_index))
    });
    meshes
}

fn build_prepared_static_mesh(
    instance: &PreparedStaticInstance,
    part_index: usize,
    gfx_obj_id: u32,
    part_placements: Vec<Frame>,
    part_scale: PreparedVec3,
    source_bounds: Option<PreparedAabb>,
) -> PreparedStaticMesh {
    let combined_scale = multiply_prepared_vec3(instance.source_scale, part_scale);
    let instance_bounds = source_bounds.map(|bounds| {
        conservative_instance_bounds(
            &instance.local_placement,
            &part_placements,
            bounds,
            combined_scale,
        )
    });
    PreparedStaticMesh {
        instance_id: instance.instance_id.clone(),
        kind: instance.kind,
        owning_landblock_id: instance.owning_landblock_id,
        owning_env_cell_id: instance.owning_env_cell_id,
        source_did: instance.source_did,
        source_asset_id: instance.source_asset_id.clone(),
        source_index: instance.source_index,
        local_placement: instance.local_placement.clone(),
        source_scale: instance.source_scale,
        part_index,
        gfx_obj_id,
        gfx_obj_asset_id: format!("gfx-obj/{gfx_obj_id:08x}"),
        part_placements,
        part_scale,
        source_bounds,
        instance_bounds,
    }
}

fn prepared_static_instance_bounds(
    instance: &PreparedStaticInstance,
    static_meshes: &[PreparedStaticMesh],
) -> (Option<PreparedAabb>, Option<PreparedAabb>) {
    static_meshes
        .iter()
        .filter(|mesh| {
            mesh.kind == instance.kind
                && mesh.instance_id == instance.instance_id
                && mesh.owning_env_cell_id == instance.owning_env_cell_id
        })
        .fold((None, None), |(source_bounds, instance_bounds), mesh| {
            (
                union_optional_bounds(source_bounds, mesh.source_bounds),
                union_optional_bounds(instance_bounds, mesh.instance_bounds),
            )
        })
}

fn union_optional_bounds(
    left: Option<PreparedAabb>,
    right: Option<PreparedAabb>,
) -> Option<PreparedAabb> {
    match (left, right) {
        (Some(left), Some(right)) => Some(union_bounds(left, right)),
        (Some(bounds), None) | (None, Some(bounds)) => Some(bounds),
        (None, None) => None,
    }
}

const BVH_LEAF_ITEM_LIMIT: usize = 4;

fn build_outdoor_member_spatial_items(
    landblock_id: u32,
    statics: &[LandblockOutdoorStaticMember],
) -> Vec<PreparedSpatialItem> {
    let mut items = statics
        .iter()
        .filter_map(|member| {
            let bounds = member.instance_bounds?;
            Some(PreparedSpatialItem {
                id: format!(
                    "landblock/{landblock_id:08x}/outdoor/spatial/static/{}",
                    member.instance.instance_id
                ),
                kind: match member.instance.kind {
                    PreparedStaticInstanceKind::Building => PreparedSpatialItemKind::Building,
                    PreparedStaticInstanceKind::Scenery
                    | PreparedStaticInstanceKind::GeneratedScenery => {
                        PreparedSpatialItemKind::OutdoorStatic
                    }
                    PreparedStaticInstanceKind::IndoorStatic => {
                        PreparedSpatialItemKind::IndoorStatic
                    }
                },
                bounds: pad_bvh_bounds(bounds),
            })
        })
        .collect::<Vec<_>>();
    items.sort_by(|left, right| left.id.cmp(&right.id));
    items
}

fn build_landblock_env_cell_bvh_items(
    env_cells: &[LandblockEnvCellBundleCell],
) -> Vec<LandblockEnvCellBvhItem> {
    let mut items = env_cells
        .iter()
        .filter_map(|cell| {
            let bounds = cell.landblock_bounds?;
            Some(LandblockEnvCellBvhItem {
                env_cell_id: cell.env_cell.env_cell_id,
                member_id: format!("env-cell/{:08x}", cell.env_cell.env_cell_id),
                bounds,
                source: LandblockEnvCellBvhItemSource::EnvCellRoot,
            })
        })
        .collect::<Vec<_>>();
    items.sort_by_key(|item| item.env_cell_id);
    items
}

fn build_landblock_env_cell_bvh_spatial_items(
    items: &[LandblockEnvCellBvhItem],
) -> Vec<PreparedSpatialItem> {
    items
        .iter()
        .map(|item| PreparedSpatialItem {
            id: item.member_id.clone(),
            kind: PreparedSpatialItemKind::EnvCellRoot,
            bounds: item.bounds,
        })
        .collect()
}

fn derive_cell_bsp_render_bounds_by_plane_triples(node: &BspNode) -> Option<PreparedAabb> {
    let mut planes = Vec::new();
    collect_bsp_planes(node, &mut planes);
    let mut bounds = None;
    for first_index in 0..planes.len() {
        for second_index in (first_index + 1)..planes.len() {
            for third_index in (second_index + 1)..planes.len() {
                let Some(point) = intersect_planes(
                    planes[first_index],
                    planes[second_index],
                    planes[third_index],
                ) else {
                    continue;
                };
                if point_inside_cell_bsp(node, point) {
                    bounds = Some(expand_bounds(bounds, ac_vector_to_render_space(point)));
                }
            }
        }
    }
    bounds
}

fn collect_bsp_planes(node: &BspNode, planes: &mut Vec<holtburger_common::Plane>) {
    match node {
        BspNode::Port(portal) => {
            planes.push(portal.plane);
            collect_bsp_planes(&portal.pos, planes);
            collect_bsp_planes(&portal.neg, planes);
        }
        BspNode::Leaf(_) => {}
        BspNode::Internal(internal) => {
            planes.push(internal.plane);
            if let Some(pos) = &internal.pos {
                collect_bsp_planes(pos, planes);
            }
            if let Some(neg) = &internal.neg {
                collect_bsp_planes(neg, planes);
            }
        }
    }
}

fn intersect_planes(
    first: holtburger_common::Plane,
    second: holtburger_common::Plane,
    third: holtburger_common::Plane,
) -> Option<holtburger_common::Vector3> {
    let second_cross_third = second.normal.cross(&third.normal);
    let third_cross_first = third.normal.cross(&first.normal);
    let first_cross_second = first.normal.cross(&second.normal);
    let denominator = first.normal.dot(&second_cross_third);
    if denominator.abs() < 0.00001 {
        return None;
    }

    Some(
        (second_cross_third * -first.d
            + third_cross_first * -second.d
            + first_cross_second * -third.d)
            * (1.0 / denominator),
    )
}

fn point_inside_cell_bsp(node: &BspNode, point: holtburger_common::Vector3) -> bool {
    const EPSILON: f32 = 0.0002;
    let mut current = Some(node);
    while let Some(node) = current {
        match node {
            BspNode::Port(portal) => {
                if portal.plane.distance_to_point(&point) < -EPSILON {
                    return false;
                }
                current = Some(&portal.pos);
            }
            BspNode::Leaf(_) => return true,
            BspNode::Internal(internal) => {
                if internal.plane.distance_to_point(&point) < -EPSILON {
                    return false;
                }
                current = internal.pos.as_deref();
                if current.is_none() {
                    return true;
                }
            }
        }
    }
    true
}

fn transform_render_local_bounds_by_ac_frame(
    render_bounds: PreparedAabb,
    ac_frame: &Frame,
    ac_scale: PreparedVec3,
) -> PreparedAabb {
    // Source render geometry is already in renderer axes ({x, z, -y}); DAT
    // placement frames and source scale are still in AC axes.
    let mut bounds = None;
    for x in [render_bounds.min.x, render_bounds.max.x] {
        for y in [render_bounds.min.y, render_bounds.max.y] {
            for z in [render_bounds.min.z, render_bounds.max.z] {
                let point = transform_render_local_point_by_ac_frame(
                    PreparedVec3 { x, y, z },
                    ac_frame,
                    ac_scale,
                );
                bounds = Some(expand_bounds(bounds, point));
            }
        }
    }
    bounds.expect("AABB corners should always produce transformed bounds")
}

fn transform_render_local_point_by_ac_frame(
    point: PreparedVec3,
    ac_frame: &Frame,
    ac_scale: PreparedVec3,
) -> PreparedVec3 {
    let ac_point = render_vector_to_ac_space(point);
    let scaled_point = holtburger_common::Vector3 {
        x: ac_point.x * ac_scale.x,
        y: ac_point.y * ac_scale.y,
        z: ac_point.z * ac_scale.z,
    };
    ac_vector_to_render_space(
        ac_frame.origin + rotate_ac_vector(scaled_point, ac_frame.orientation),
    )
}

fn combine_ac_frames(parent: &Frame, child: &Frame) -> Frame {
    Frame {
        origin: parent.origin + rotate_ac_vector(child.origin, parent.orientation),
        orientation: multiply_ac_quaternion(parent.orientation, child.orientation),
    }
}

fn rotate_ac_vector(
    vector: holtburger_common::Vector3,
    rotation: holtburger_common::Quaternion,
) -> holtburger_common::Vector3 {
    let q_vector = holtburger_common::Vector3 {
        x: rotation.x,
        y: rotation.y,
        z: rotation.z,
    };
    let uv = q_vector.cross(&vector);
    let uuv = q_vector.cross(&uv);
    vector + uv * (2.0 * rotation.w) + uuv * 2.0
}

fn multiply_ac_quaternion(
    left: holtburger_common::Quaternion,
    right: holtburger_common::Quaternion,
) -> holtburger_common::Quaternion {
    holtburger_common::Quaternion {
        w: left.w * right.w - left.x * right.x - left.y * right.y - left.z * right.z,
        x: left.w * right.x + left.x * right.w + left.y * right.z - left.z * right.y,
        y: left.w * right.y - left.x * right.z + left.y * right.w + left.z * right.x,
        z: left.w * right.z + left.x * right.y - left.y * right.x + left.z * right.w,
    }
}

fn build_prepared_bvh(landblock_id: u32, items: &[PreparedSpatialItem]) -> Option<PreparedBvh> {
    build_prepared_bvh_with_scope(
        landblock_id,
        "landblock-render-local",
        PreparedBvhScope::OutdoorStatic,
        items,
    )
}

fn build_prepared_bvh_with_scope(
    landblock_id: u32,
    coordinate_space: &'static str,
    scope: PreparedBvhScope,
    items: &[PreparedSpatialItem],
) -> Option<PreparedBvh> {
    if items.is_empty() {
        return None;
    }

    let mut nodes = Vec::new();
    let item_indices = (0..items.len()).collect::<Vec<_>>();
    build_prepared_bvh_node(scope, items, item_indices, &mut nodes);
    Some(PreparedBvh {
        coordinate_space,
        landblock_id,
        scope,
        nodes,
    })
}

fn build_prepared_bvh_node(
    scope: PreparedBvhScope,
    items: &[PreparedSpatialItem],
    mut item_indices: Vec<usize>,
    nodes: &mut Vec<PreparedBvhNode>,
) -> usize {
    let bounds = item_indices
        .iter()
        .map(|index| items[*index].bounds)
        .reduce(union_bounds)
        .expect("BVH nodes require at least one spatial item");
    let kind_mask = prepared_bvh_kind_mask(scope, items, &item_indices);
    let node_index = nodes.len();
    nodes.push(PreparedBvhNode {
        bounds,
        left: None,
        right: None,
        item_indices: Vec::new(),
        kind_mask,
    });

    if item_indices.len() <= BVH_LEAF_ITEM_LIMIT {
        nodes[node_index].item_indices = item_indices;
        return node_index;
    }

    let axis = longest_bounds_axis(bounds);
    item_indices.sort_by(|left, right| {
        let left_center = bounds_center_component(items[*left].bounds, axis);
        let right_center = bounds_center_component(items[*right].bounds, axis);
        left_center
            .partial_cmp(&right_center)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(left.cmp(right))
    });
    let right_indices = item_indices.split_off(item_indices.len() / 2);
    let left = build_prepared_bvh_node(scope, items, item_indices, nodes);
    let right = build_prepared_bvh_node(scope, items, right_indices, nodes);
    nodes[node_index].left = Some(left);
    nodes[node_index].right = Some(right);
    node_index
}

#[derive(Debug, Clone, Copy)]
enum BvhSplitAxis {
    X,
    Y,
    Z,
}

fn longest_bounds_axis(bounds: PreparedAabb) -> BvhSplitAxis {
    let x = bounds.max.x - bounds.min.x;
    let y = bounds.max.y - bounds.min.y;
    let z = bounds.max.z - bounds.min.z;
    if x >= y && x >= z {
        BvhSplitAxis::X
    } else if y >= z {
        BvhSplitAxis::Y
    } else {
        BvhSplitAxis::Z
    }
}

fn bounds_center_component(bounds: PreparedAabb, axis: BvhSplitAxis) -> f32 {
    match axis {
        BvhSplitAxis::X => (bounds.min.x + bounds.max.x) * 0.5,
        BvhSplitAxis::Y => (bounds.min.y + bounds.max.y) * 0.5,
        BvhSplitAxis::Z => (bounds.min.z + bounds.max.z) * 0.5,
    }
}

fn union_bounds(left: PreparedAabb, right: PreparedAabb) -> PreparedAabb {
    PreparedAabb {
        min: PreparedVec3 {
            x: left.min.x.min(right.min.x),
            y: left.min.y.min(right.min.y),
            z: left.min.z.min(right.min.z),
        },
        max: PreparedVec3 {
            x: left.max.x.max(right.max.x),
            y: left.max.y.max(right.max.y),
            z: left.max.z.max(right.max.z),
        },
    }
}

fn prepared_bvh_kind_mask(
    scope: PreparedBvhScope,
    items: &[PreparedSpatialItem],
    item_indices: &[usize],
) -> PreparedBvhKindMask {
    match scope {
        PreparedBvhScope::OutdoorTerrain => {
            for index in item_indices {
                if items[*index].kind != PreparedSpatialItemKind::TerrainQuad {
                    panic!(
                        "invalid outdoor terrain BVH item kind: {:?}",
                        items[*index].kind
                    );
                }
            }
            PreparedBvhKindMask::OutdoorTerrain {
                terrain_quad: !item_indices.is_empty(),
            }
        }
        PreparedBvhScope::OutdoorStatic => {
            let mut static_object = false;
            let mut building = false;
            for index in item_indices {
                match items[*index].kind {
                    PreparedSpatialItemKind::OutdoorStatic => static_object = true,
                    PreparedSpatialItemKind::Building => building = true,
                    kind => panic!("invalid outdoor static BVH item kind: {kind:?}"),
                }
            }
            PreparedBvhKindMask::OutdoorStatic {
                static_object,
                building,
            }
        }
        PreparedBvhScope::LandblockEnvCells => {
            for index in item_indices {
                if items[*index].kind != PreparedSpatialItemKind::EnvCellRoot {
                    panic!(
                        "invalid landblock env-cell BVH item kind: {:?}",
                        items[*index].kind
                    );
                }
            }
            PreparedBvhKindMask::LandblockEnvCells {
                env_cell_root: !item_indices.is_empty(),
            }
        }
        PreparedBvhScope::EnvCellLocal => {
            let mut static_object = false;
            for index in item_indices {
                match items[*index].kind {
                    PreparedSpatialItemKind::IndoorStatic => static_object = true,
                    kind => panic!("invalid env-cell local BVH item kind: {kind:?}"),
                }
            }
            PreparedBvhKindMask::EnvCellLocal {
                cell_structure_geometry: false,
                static_object,
                portal: false,
            }
        }
    }
}

fn load_setup_model_for_static_mesh(
    context: &mut PreparedContentAssemblyContext<'_>,
    setup_model_id: u32,
    reported_missing: &mut HashSet<u32>,
) -> Option<SetupModel> {
    match context.source.setup_model(setup_model_id) {
        Ok(setup_model) => Some(setup_model),
        Err(error) => {
            report_renderable_load_error(
                &mut context.diagnostics,
                reported_missing,
                setup_model_id,
                "setup-model",
                source_error_code_from_error(&error),
                format!("Could not load SetupModel 0x{setup_model_id:08X}: {error:#}"),
            );
            None
        }
    }
}

fn load_gfx_obj_render_bounds(
    context: &mut PreparedContentAssemblyContext<'_>,
    gfx_obj_id: u32,
    reported_missing: &mut HashSet<u32>,
) -> Option<PreparedAabb> {
    match context.source.gfx_obj(gfx_obj_id) {
        Ok(gfx_obj) => build_gfx_obj_render_geometry(&gfx_obj).bounds,
        Err(error) => {
            report_renderable_load_error(
                &mut context.diagnostics,
                reported_missing,
                gfx_obj_id,
                "gfx-obj",
                source_error_code_from_error(&error),
                format!("Could not load GfxObj 0x{gfx_obj_id:08X}: {error:#}"),
            );
            None
        }
    }
}

fn report_renderable_load_error(
    diagnostics: &mut PreparedContentSourceDiagnostics,
    reported_missing: &mut HashSet<u32>,
    file_id: u32,
    role: &'static str,
    error_code: &'static str,
    detail: String,
) {
    if reported_missing.insert(file_id) {
        diagnostics.errors.push(SourceLoadError {
            namespace: EOR_PORTAL_NAMESPACE,
            file_id,
            role,
            error_code,
            detail,
        });
    }
}

fn derive_setup_part_default_placements(setup_model: &SetupModel, part_index: usize) -> Vec<Frame> {
    select_default_placement_frames(setup_model)
        .and_then(|placements| placements.get(part_index).cloned())
        .into_iter()
        .collect()
}

fn select_default_placement_frames(setup_model: &SetupModel) -> Option<&[Frame]> {
    setup_model
        .placement_frames
        .get(&0x65)
        .or_else(|| setup_model.placement_frames.get(&0))
        .or_else(|| {
            setup_model
                .placement_frames
                .iter()
                .min_by_key(|(key, _)| **key)
                .map(|(_, placement)| placement)
        })
        .map(|placement| placement.anim_frame.frames.as_slice())
}

pub fn build_gfx_obj_render_geometry(gfx_obj: &GfxObj) -> PreparedPolygonSetRenderGeometry {
    build_polygon_set_render_geometry(
        gfx_obj.id,
        &gfx_obj.vertex_array,
        &gfx_obj.polygons,
        gfx_obj.drawing_bsp.as_ref(),
    )
}

fn renderable_source_asset_id(did: u32) -> Option<String> {
    match did >> 24 {
        0x01 => Some(format!("gfx-obj/{did:08x}")),
        0x02 => Some(format!("setup-model/{did:08x}")),
        _ => None,
    }
}

fn convert_static_outdoor_frame(frame: &crate::static_outdoor_scene::StaticOutdoorFrame) -> Frame {
    Frame {
        origin: frame.origin,
        orientation: frame.orientation,
    }
}

fn prepared_vec3_from_ac(vector: holtburger_common::Vector3) -> PreparedVec3 {
    PreparedVec3 {
        x: vector.x,
        y: vector.y,
        z: vector.z,
    }
}

fn unit_prepared_vec3() -> PreparedVec3 {
    PreparedVec3 {
        x: 1.0,
        y: 1.0,
        z: 1.0,
    }
}

fn multiply_prepared_vec3(left: PreparedVec3, right: PreparedVec3) -> PreparedVec3 {
    PreparedVec3 {
        x: left.x * right.x,
        y: left.y * right.y,
        z: left.z * right.z,
    }
}

fn subtract_prepared_vec3(left: PreparedVec3, right: PreparedVec3) -> PreparedVec3 {
    PreparedVec3 {
        x: left.x - right.x,
        y: left.y - right.y,
        z: left.z - right.z,
    }
}

fn cross_prepared_vec3(left: PreparedVec3, right: PreparedVec3) -> PreparedVec3 {
    PreparedVec3 {
        x: left.y * right.z - left.z * right.y,
        y: left.z * right.x - left.x * right.z,
        z: left.x * right.y - left.y * right.x,
    }
}

fn normalize_prepared_vec3(vector: PreparedVec3) -> Option<PreparedVec3> {
    let length = (vector.x * vector.x + vector.y * vector.y + vector.z * vector.z).sqrt();
    (length != 0.0).then_some(PreparedVec3 {
        x: vector.x / length,
        y: vector.y / length,
        z: vector.z / length,
    })
}

fn dot_prepared_vec3(left: PreparedVec3, right: PreparedVec3) -> f32 {
    left.x * right.x + left.y * right.y + left.z * right.z
}

fn conservative_instance_bounds(
    placement: &Frame,
    part_placements: &[Frame],
    source_bounds: PreparedAabb,
    scale: PreparedVec3,
) -> PreparedAabb {
    if part_placements.is_empty() {
        return transform_render_local_bounds_by_ac_frame(source_bounds, placement, scale);
    }

    part_placements
        .iter()
        .map(|part_placement| {
            transform_render_local_bounds_by_ac_frame(
                source_bounds,
                &combine_ac_frames(placement, part_placement),
                scale,
            )
        })
        .reduce(union_bounds)
        .expect("non-empty part placements should yield bounds")
}

fn build_terrain_mesh(cell_landblock: &CellLandblockFact) -> PreparedTerrainMesh {
    let grid_size = cell_landblock.grid_size;
    let tile_size = cell_landblock.tile_size;
    let mut normalized_heights = Vec::with_capacity(cell_landblock.heights.len());
    let mut normalized_terrain_types = Vec::with_capacity(cell_landblock.terrain_types.len());

    for row in 0..grid_size {
        for col in 0..grid_size {
            let source_index = col * grid_size + row;
            normalized_heights.push(
                cell_landblock
                    .heights
                    .get(source_index)
                    .copied()
                    .unwrap_or(0.0),
            );
            normalized_terrain_types.push(
                cell_landblock
                    .terrain_types
                    .get(source_index)
                    .copied()
                    .unwrap_or(0),
            );
        }
    }

    let vertices = normalized_heights
        .iter()
        .enumerate()
        .map(|(index, height)| {
            let row = index / grid_size;
            let col = index % grid_size;
            PreparedVec3 {
                x: col as f32 * tile_size,
                y: row as f32 * tile_size,
                z: *height,
            }
        })
        .collect::<Vec<_>>();

    let mut triangles = Vec::new();
    let mut quads = Vec::new();
    for row in 0..(grid_size - 1) {
        for col in 0..(grid_size - 1) {
            let southwest = row * grid_size + col;
            let southeast = southwest + 1;
            let northwest = southwest + grid_size;
            let northeast = northwest + 1;
            let quad_index = row * (grid_size - 1) + col;
            let triangle_indices = [quad_index * 2, quad_index * 2 + 1];
            let terrain_type = normalized_terrain_types
                .get(southwest)
                .copied()
                .unwrap_or(0);
            let average_height = (normalized_heights[southwest]
                + normalized_heights[southeast]
                + normalized_heights[northwest]
                + normalized_heights[northeast])
                / 4.0;

            let uses_southwest_to_northeast =
                uses_southwest_to_northeast_cut(cell_landblock.id, col as u32, row as u32);
            if uses_southwest_to_northeast {
                triangles.push(PreparedTerrainTriangle {
                    a: southwest,
                    b: southeast,
                    c: northeast,
                    terrain_type,
                    average_height,
                });
                triangles.push(PreparedTerrainTriangle {
                    a: southwest,
                    b: northeast,
                    c: northwest,
                    terrain_type,
                    average_height,
                });
            } else {
                triangles.push(PreparedTerrainTriangle {
                    a: southwest,
                    b: southeast,
                    c: northwest,
                    terrain_type,
                    average_height,
                });
                triangles.push(PreparedTerrainTriangle {
                    a: northeast,
                    b: northwest,
                    c: southeast,
                    terrain_type,
                    average_height,
                });
            }

            if let Some(bounds) =
                terrain_vertex_bounds(&vertices, [southwest, southeast, northwest, northeast])
            {
                let raw_corners = [
                    normalized_terrain_types[southwest],
                    normalized_terrain_types[southeast],
                    normalized_terrain_types[northeast],
                    normalized_terrain_types[northwest],
                ];
                let corner_terrain_codes = raw_corners.map(terrain_code_from_cell_terrain);
                let corner_road_codes = raw_corners.map(road_code_from_cell_terrain);
                quads.push(PreparedTerrainQuad {
                    terrain_quad_id: format!(
                        "landblock/{:08x}/outdoor/terrain/quad/{row:02x}/{col:02x}",
                        cell_landblock.id
                    ),
                    row,
                    col,
                    quad_index,
                    source_terrain_indices: [southwest, southeast, northeast, northwest],
                    vertex_indices: [southwest, southeast, northeast, northwest],
                    triangle_indices,
                    diagonal: if uses_southwest_to_northeast {
                        PreparedTerrainQuadDiagonal::SouthwestNortheast
                    } else {
                        PreparedTerrainQuadDiagonal::SoutheastNorthwest
                    },
                    corner_terrain_codes,
                    pcode: terrain_pcode(corner_road_codes, corner_terrain_codes),
                    average_height,
                    bounds,
                });
            }
        }
    }

    let terrain_bvh_items = quads
        .iter()
        .map(|quad| PreparedTerrainBvhItem {
            row: quad.row,
            col: quad.col,
            quad_index: quad.quad_index,
            triangle_indices: quad.triangle_indices,
        })
        .collect::<Vec<_>>();
    let terrain_spatial_items = quads
        .iter()
        .map(|quad| PreparedSpatialItem {
            id: quad.terrain_quad_id.clone(),
            kind: PreparedSpatialItemKind::TerrainQuad,
            bounds: pad_bvh_bounds(quad.bounds),
        })
        .collect::<Vec<_>>();
    let terrain_bvh = build_prepared_bvh_with_scope(
        cell_landblock.id,
        "landblock-outdoor-terrain-local",
        PreparedBvhScope::OutdoorTerrain,
        &terrain_spatial_items,
    );

    PreparedTerrainMesh {
        landblock_id: cell_landblock.id,
        grid_size,
        tile_size,
        vertices,
        triangles,
        quads,
        terrain_bvh_items,
        terrain_bvh,
        min_height: normalized_heights
            .iter()
            .copied()
            .reduce(f32::min)
            .unwrap_or(0.0),
        max_height: normalized_heights
            .iter()
            .copied()
            .reduce(f32::max)
            .unwrap_or(0.0),
    }
}

pub fn terrain_code_from_cell_terrain(value: u16) -> u32 {
    u32::from((value >> 2) & 0x1f)
}

pub fn road_code_from_cell_terrain(value: u16) -> u32 {
    u32::from(value & 0x03)
}

pub fn terrain_pcode(road_codes: [u32; 4], terrain_codes: [u32; 4]) -> u32 {
    (1 << 28)
        | (road_codes[0] << 26)
        | (road_codes[1] << 24)
        | (road_codes[2] << 22)
        | (road_codes[3] << 20)
        | (terrain_codes[0] << 15)
        | (terrain_codes[1] << 10)
        | (terrain_codes[2] << 5)
        | terrain_codes[3]
}

fn terrain_vertex_bounds<const N: usize>(
    vertices: &[PreparedVec3],
    vertex_indices: [usize; N],
) -> Option<PreparedAabb> {
    vertex_indices
        .iter()
        .filter_map(|index| vertices.get(*index))
        .copied()
        .fold(None, |bounds, point| Some(expand_bounds(bounds, point)))
}

fn uses_southwest_to_northeast_cut(landblock_id: u32, cell_x: u32, cell_y: u32) -> bool {
    let landblock_x = (landblock_id >> 24) & 0xff;
    let landblock_y = (landblock_id >> 16) & 0xff;
    let global_cell_x = landblock_x * 8 + cell_x;
    let global_cell_y = landblock_y * 8 + cell_y;
    let magic_a = global_cell_x
        .wrapping_mul(214_614_067)
        .wrapping_add(1_813_693_831);
    let magic_b = global_cell_x.wrapping_mul(1_109_124_029);
    let split_direction = global_cell_y
        .wrapping_mul(magic_a)
        .wrapping_sub(magic_b)
        .wrapping_sub(1_369_149_221);

    split_direction >= 0x8000_0000
}

fn build_prepared_interior_cells(interiors: &LandblockInteriorFacts) -> Vec<PreparedInteriorCell> {
    let mut cells = Vec::new();
    for env_cell in &interiors.env_cells {
        let Some(environment_id) = env_cell.environment_id else {
            continue;
        };
        let Some(cell_structure_id) = env_cell.cell_structure_id else {
            continue;
        };
        let Some(cell_structure) = interiors
            .environments
            .iter()
            .find(|environment| environment.id == environment_id)
            .and_then(|environment| {
                environment
                    .cell_structures
                    .iter()
                    .find(|cell_structure| cell_structure.id == cell_structure_id)
            })
        else {
            continue;
        };

        let render_geometry = build_cell_structure_render_geometry(cell_structure);
        let portal_apertures = build_prepared_portal_apertures(cell_structure, &env_cell.portals);
        cells.push(PreparedInteriorCell {
            env_cell_id: env_cell.env_cell_id,
            environment_id,
            cell_structure_id,
            local_placement: env_cell.local_placement.clone(),
            surface_ids: env_cell.surface_ids.clone(),
            portals: env_cell.portals.clone(),
            portal_apertures,
            static_object_count: env_cell.static_objects.len(),
            cell_bsp: cell_structure.cell_bsp.clone(),
            render_geometry,
        });
    }
    cells
}

fn build_prepared_portal_apertures(
    cell_structure: &CellStruct,
    portals: &[EnvCellPortalFact],
) -> Vec<PreparedPortalAperture> {
    portals
        .iter()
        .map(|portal| {
            let points = cell_structure
                .polygons
                .get(&portal.polygon_id)
                .map(|polygon| build_portal_polygon_points(&cell_structure.vertex_array, polygon))
                .unwrap_or_default();
            let plane =
                derive_portal_aperture_source_plane(cell_structure.drawing_bsp.as_ref(), portal)
                    .or_else(|| derive_portal_aperture_plane_from_points(&points));

            PreparedPortalAperture {
                portal_id: portal.portal_id.clone(),
                source_index: portal.source_index,
                polygon_id: portal.polygon_id,
                points,
                plane,
            }
        })
        .collect()
}

fn build_portal_polygon_points(
    vertex_array: &holtburger_dat::graphics::CVertexArray,
    polygon: &Polygon,
) -> Vec<PreparedVec3> {
    polygon
        .vertex_ids
        .iter()
        .filter_map(|vertex_id| vertex_array.vertices.get(vertex_id))
        .map(|vertex| ac_vector_to_render_space(vertex.origin))
        .collect()
}

fn derive_portal_aperture_source_plane(
    drawing_bsp: Option<&BspNode>,
    portal: &EnvCellPortalFact,
) -> Option<PreparedPortalAperturePlane> {
    let source_plane = find_portal_plane_by_portal_reference(drawing_bsp?, portal)?;
    Some(PreparedPortalAperturePlane {
        normal: ac_vector_to_render_space(source_plane.normal),
        constant: -source_plane.d,
        source: PreparedPortalAperturePlaneSource::DrawingBspPortal,
    })
}

fn find_portal_plane_by_portal_reference<'a>(
    node: &'a BspNode,
    portal: &EnvCellPortalFact,
) -> Option<&'a holtburger_common::Plane> {
    match node {
        BspNode::Port(bsp_portal) => {
            let has_portal_poly = bsp_portal.portal_polys.iter().any(|portal_poly| {
                portal_poly.portal_index as usize == portal.source_index
                    || (portal_poly.poly_id >= 0 && portal_poly.poly_id as u16 == portal.polygon_id)
            });
            if has_portal_poly {
                return Some(&bsp_portal.plane);
            }

            find_portal_plane_by_portal_reference(&bsp_portal.pos, portal)
                .or_else(|| find_portal_plane_by_portal_reference(&bsp_portal.neg, portal))
        }
        BspNode::Internal(internal) => internal
            .pos
            .as_deref()
            .and_then(|pos| find_portal_plane_by_portal_reference(pos, portal))
            .or_else(|| {
                internal
                    .neg
                    .as_deref()
                    .and_then(|neg| find_portal_plane_by_portal_reference(neg, portal))
            }),
        BspNode::Leaf(_) => None,
    }
}

fn derive_portal_aperture_plane_from_points(
    points: &[PreparedVec3],
) -> Option<PreparedPortalAperturePlane> {
    let first = *points.first()?;
    let second = *points.get(1)?;
    let third = *points.get(2)?;
    let edge_a = subtract_prepared_vec3(second, first);
    let edge_b = subtract_prepared_vec3(third, first);
    let normal = normalize_prepared_vec3(cross_prepared_vec3(edge_a, edge_b))?;

    Some(PreparedPortalAperturePlane {
        normal,
        constant: dot_prepared_vec3(normal, first),
        source: PreparedPortalAperturePlaneSource::DerivedFromRenderPoints,
    })
}

fn build_cell_structure_render_geometry(
    cell_structure: &CellStruct,
) -> PreparedPolygonSetRenderGeometry {
    // Retail and ACViewer draw the full CellStruct polygon list for env cells.
    // The drawing BSP is still useful for culling/visibility, but it is not the
    // authoritative render polygon set for cell shell geometry.
    build_polygon_set_render_geometry_with_side_policy(
        cell_structure.id,
        &cell_structure.vertex_array,
        &cell_structure.polygons,
        None,
        PolygonRenderSidePolicy::EnvCellPositiveOnly,
    )
}

fn build_polygon_set_render_geometry(
    source_id: u32,
    vertex_array: &holtburger_dat::graphics::CVertexArray,
    drawing_polygons: &std::collections::HashMap<u16, Polygon>,
    drawing_bsp: Option<&BspNode>,
) -> PreparedPolygonSetRenderGeometry {
    build_polygon_set_render_geometry_with_side_policy(
        source_id,
        vertex_array,
        drawing_polygons,
        drawing_bsp,
        PolygonRenderSidePolicy::VisualSides,
    )
}

fn build_polygon_set_render_geometry_with_side_policy(
    source_id: u32,
    vertex_array: &holtburger_dat::graphics::CVertexArray,
    drawing_polygons: &std::collections::HashMap<u16, Polygon>,
    drawing_bsp: Option<&BspNode>,
    side_policy: PolygonRenderSidePolicy,
) -> PreparedPolygonSetRenderGeometry {
    let render_polygon_ids = drawing_bsp.map(collect_drawing_bsp_renderable_polygon_ids);
    let mut polygon_entries = drawing_polygons.iter().collect::<Vec<_>>();
    polygon_entries.sort_by_key(|(id, _)| **id);

    let mut positions = Vec::new();
    let mut normals = Vec::new();
    let mut uvs = Vec::new();
    let mut triangles = Vec::new();
    let mut surface_ids = HashSet::new();
    let mut invalid_polygons = Vec::new();
    let mut skipped_polygon_count = 0;
    let mut bounds: Option<PreparedAabb> = None;

    for (polygon_id, polygon) in polygon_entries {
        if render_polygon_ids
            .as_ref()
            .is_some_and(|ids| !ids.contains(polygon_id))
        {
            continue;
        }
        if polygon.vertex_ids.len() < 3 {
            continue;
        }
        if polygon.num_pts as usize != polygon.vertex_ids.len() {
            skipped_polygon_count += 1;
            continue;
        }
        let missing_vertex_ids = polygon
            .vertex_ids
            .iter()
            .copied()
            .filter(|vertex_id| !vertex_array.vertices.contains_key(vertex_id))
            .collect::<Vec<_>>();
        if !missing_vertex_ids.is_empty() {
            invalid_polygons.push(PreparedPolygonSetInvalidPolygon {
                polygon_id: *polygon_id,
                reason: INVALID_POLYGON_REASON_MISSING_VERTICES,
                vertex_ids: polygon.vertex_ids.clone(),
                missing_vertex_ids,
            });
            skipped_polygon_count += 1;
            continue;
        }
        record_polygon_side_diagnostics(*polygon_id, polygon, side_policy, &mut invalid_polygons);

        let render_sides = derive_polygon_render_sides(polygon, side_policy);
        if render_sides.is_empty() {
            skipped_polygon_count += 1;
            continue;
        }
        for render_side in render_sides {
            if let Some(surface_id) = render_side.surface_id {
                surface_ids.insert(surface_id);
            }
            append_polygon_render_side_geometry(
                *polygon_id,
                polygon,
                vertex_array,
                render_side,
                &mut PolygonRenderGeometryBuffers {
                    positions: &mut positions,
                    normals: &mut normals,
                    uvs: &mut uvs,
                    triangles: &mut triangles,
                    bounds: &mut bounds,
                },
            );
        }
    }

    let vertex_count = positions.len() / 3;
    let mut surface_ids = surface_ids.into_iter().collect::<Vec<_>>();
    surface_ids.sort_unstable();

    PreparedPolygonSetRenderGeometry {
        source_id,
        vertex_count,
        triangle_count: triangles.len(),
        positions,
        normals,
        uvs,
        triangles,
        surface_ids,
        invalid_polygons,
        skipped_polygon_count,
        bounds,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PolygonRenderSidePolicy {
    VisualSides,
    EnvCellPositiveOnly,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PreparedPolygonRenderSideKind {
    Positive,
    PositiveReversed,
    Negative,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PreparedPolygonWinding {
    Source,
    Reversed,
}

#[derive(Debug, Clone, Copy)]
struct PreparedPolygonRenderSide<'a> {
    kind: PreparedPolygonRenderSideKind,
    surface_id: Option<i16>,
    material_variant_signature: &'static str,
    /// Authored UV indices for this side. Some legacy solid-color polygons
    /// omit UV indices entirely; those still produce geometry with zero UVs.
    uv_indices: Option<&'a [u8]>,
    winding: PreparedPolygonWinding,
    normal_scale: f32,
}

const STIPPLING_REPEAT_POS: u8 = 0x01;
const STIPPLING_REPEAT_NEG: u8 = 0x02;
const STIPPLING_NO_POS: u8 = 0x04;
const STIPPLING_NO_NEG: u8 = 0x08;
const CULL_MODE_NONE: i32 = 1;
const CULL_MODE_CLOCKWISE: i32 = 2;
const CULL_MODE_COUNTER_CLOCKWISE: i32 = 3;
const INVALID_POLYGON_REASON_MISSING_VERTICES: &str = "missing-vertices";
const INVALID_POLYGON_REASON_MALFORMED_POSITIVE_UV_INDICES: &str = "malformed-positive-uv-indices";
const INVALID_POLYGON_REASON_MALFORMED_NEGATIVE_UV_INDICES: &str = "malformed-negative-uv-indices";

fn record_polygon_side_diagnostics(
    polygon_id: u16,
    polygon: &Polygon,
    side_policy: PolygonRenderSidePolicy,
    invalid_polygons: &mut Vec<PreparedPolygonSetInvalidPolygon>,
) {
    if (polygon.stippling & STIPPLING_NO_POS) == 0
        && polygon.pos_uv_indices.len() != polygon.vertex_ids.len()
    {
        invalid_polygons.push(PreparedPolygonSetInvalidPolygon {
            polygon_id,
            reason: INVALID_POLYGON_REASON_MALFORMED_POSITIVE_UV_INDICES,
            vertex_ids: polygon.vertex_ids.clone(),
            missing_vertex_ids: Vec::new(),
        });
    }
    if polygon.sides_type == CULL_MODE_CLOCKWISE
        && side_policy == PolygonRenderSidePolicy::VisualSides
        && (polygon.stippling & STIPPLING_NO_NEG) == 0
        && polygon.neg_uv_indices.len() != polygon.vertex_ids.len()
    {
        invalid_polygons.push(PreparedPolygonSetInvalidPolygon {
            polygon_id,
            reason: INVALID_POLYGON_REASON_MALFORMED_NEGATIVE_UV_INDICES,
            vertex_ids: polygon.vertex_ids.clone(),
            missing_vertex_ids: Vec::new(),
        });
    }
}

fn derive_polygon_render_sides(
    polygon: &Polygon,
    side_policy: PolygonRenderSidePolicy,
) -> Vec<PreparedPolygonRenderSide<'_>> {
    // Retail CPolygon::UnPack aliases CullMode.None negative side data to the
    // positive side, and D3DPolyRender::ConstructMesh expands CullMode.None and
    // CullMode.Clockwise into explicit geometry. ACE's Polygon.Unpack and
    // holtburger-dat's Polygon decoder mirror the same stored side model.
    let mut sides = Vec::with_capacity(2);
    if positive_polygon_side_is_renderable(polygon) {
        sides.push(PreparedPolygonRenderSide {
            kind: PreparedPolygonRenderSideKind::Positive,
            surface_id: normalize_surface_id(polygon.pos_surface),
            material_variant_signature: positive_polygon_side_material_variant(polygon),
            uv_indices: polygon_side_uv_indices(polygon, PolygonSideKind::Positive),
            winding: PreparedPolygonWinding::Source,
            normal_scale: 1.0,
        });
    }

    if side_policy == PolygonRenderSidePolicy::EnvCellPositiveOnly {
        return sides;
    }

    match polygon.sides_type {
        CULL_MODE_NONE if positive_polygon_side_is_renderable(polygon) => {
            sides.push(PreparedPolygonRenderSide {
                kind: PreparedPolygonRenderSideKind::PositiveReversed,
                surface_id: normalize_surface_id(polygon.pos_surface),
                material_variant_signature: positive_polygon_side_material_variant(polygon),
                uv_indices: polygon_side_uv_indices(polygon, PolygonSideKind::Positive),
                winding: PreparedPolygonWinding::Reversed,
                normal_scale: -1.0,
            });
        }
        CULL_MODE_CLOCKWISE if negative_polygon_side_is_renderable(polygon) => {
            sides.push(PreparedPolygonRenderSide {
                kind: PreparedPolygonRenderSideKind::Negative,
                surface_id: normalize_surface_id(polygon.neg_surface),
                material_variant_signature: negative_polygon_side_material_variant(polygon),
                uv_indices: polygon_side_uv_indices(polygon, PolygonSideKind::Negative),
                winding: PreparedPolygonWinding::Reversed,
                normal_scale: -1.0,
            });
        }
        // The retail constructed mesh path reviewed so far has no special
        // CounterClockwise expansion branch. Treat it as positive-only instead
        // of preserving the old Holtburger winding flip.
        CULL_MODE_COUNTER_CLOCKWISE => {}
        _ => {}
    }

    sides
}

fn positive_polygon_side_is_renderable(polygon: &Polygon) -> bool {
    polygon_side_uv_indices(polygon, PolygonSideKind::Positive).is_some()
        || (polygon.stippling & STIPPLING_NO_POS) != 0
}

fn negative_polygon_side_is_renderable(polygon: &Polygon) -> bool {
    polygon.sides_type == CULL_MODE_CLOCKWISE
        && polygon_side_uv_indices(polygon, PolygonSideKind::Negative).is_some()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PolygonSideKind {
    Positive,
    Negative,
}

fn polygon_side_uv_indices(polygon: &Polygon, side: PolygonSideKind) -> Option<&[u8]> {
    let (omit_uv_bit, uv_indices) = match side {
        PolygonSideKind::Positive => (STIPPLING_NO_POS, polygon.pos_uv_indices.as_slice()),
        PolygonSideKind::Negative => (STIPPLING_NO_NEG, polygon.neg_uv_indices.as_slice()),
    };
    if (polygon.stippling & omit_uv_bit) != 0 {
        return None;
    }
    if uv_indices.len() == polygon.vertex_ids.len() {
        Some(uv_indices)
    } else {
        None
    }
}

fn positive_polygon_side_material_variant(polygon: &Polygon) -> &'static str {
    legacy_sampler_material_variant((polygon.stippling & STIPPLING_REPEAT_POS) != 0)
}

fn negative_polygon_side_material_variant(polygon: &Polygon) -> &'static str {
    legacy_sampler_material_variant((polygon.stippling & STIPPLING_REPEAT_NEG) != 0)
}

fn legacy_sampler_material_variant(repeats: bool) -> &'static str {
    if repeats {
        legacy_sampler_material_variant_signature(true)
    } else {
        legacy_sampler_material_variant_signature(false)
    }
}

struct PolygonRenderGeometryBuffers<'a> {
    positions: &'a mut Vec<f32>,
    normals: &'a mut Vec<f32>,
    uvs: &'a mut Vec<f32>,
    triangles: &'a mut Vec<PreparedPolygonSetRenderTriangle>,
    bounds: &'a mut Option<PreparedAabb>,
}

fn append_polygon_render_side_geometry(
    polygon_id: u16,
    polygon: &Polygon,
    vertex_array: &holtburger_dat::graphics::CVertexArray,
    render_side: PreparedPolygonRenderSide<'_>,
    buffers: &mut PolygonRenderGeometryBuffers<'_>,
) {
    let _side_kind = render_side.kind;
    for vertex_index in 1..(polygon.vertex_ids.len() - 1) {
        let triangle_vertex_offsets = match render_side.winding {
            PreparedPolygonWinding::Source => [0, vertex_index, vertex_index + 1],
            PreparedPolygonWinding::Reversed => [0, vertex_index + 1, vertex_index],
        };
        buffers.triangles.push(PreparedPolygonSetRenderTriangle {
            polygon_id,
            surface_id: render_side.surface_id,
            material_variant_signature: render_side.material_variant_signature.to_string(),
            first_vertex: buffers.positions.len() / 3,
        });

        for polygon_vertex_offset in triangle_vertex_offsets {
            let vertex_id = polygon.vertex_ids[polygon_vertex_offset];
            let vertex = vertex_array
                .vertices
                .get(&vertex_id)
                .expect("missing vertices were filtered before triangulation");
            let render_position = ac_vector_to_render_space(vertex.origin);
            let render_normal = ac_vector_to_render_space(vertex.normal);
            buffers
                .positions
                .extend([render_position.x, render_position.y, render_position.z]);
            buffers.normals.extend([
                scale_normal_component(render_normal.x, render_side.normal_scale),
                scale_normal_component(render_normal.y, render_side.normal_scale),
                scale_normal_component(render_normal.z, render_side.normal_scale),
            ]);

            let uv = render_side
                .uv_indices
                .and_then(|indices| indices.get(polygon_vertex_offset))
                .and_then(|uv_index| vertex.uvs.get(usize::from(*uv_index)));
            buffers
                .uvs
                .extend([uv.map_or(0.0, |uv| uv.u), uv.map_or(0.0, |uv| uv.v)]);
            *buffers.bounds = Some(expand_bounds(*buffers.bounds, render_position));
        }
    }
}

fn collect_drawing_bsp_renderable_polygon_ids(node: &BspNode) -> HashSet<u16> {
    let mut polygon_ids = HashSet::new();
    collect_drawing_bsp_node_polygon_ids(node, &mut polygon_ids);
    polygon_ids
}

fn collect_drawing_bsp_node_polygon_ids(node: &BspNode, polygon_ids: &mut HashSet<u16>) {
    match node {
        BspNode::Port(portal) => {
            polygon_ids.extend(portal.poly_ids.iter().copied());
            collect_drawing_bsp_node_polygon_ids(&portal.pos, polygon_ids);
            collect_drawing_bsp_node_polygon_ids(&portal.neg, polygon_ids);
        }
        BspNode::Leaf(leaf) => {
            polygon_ids.extend(leaf.poly_ids.iter().copied());
        }
        BspNode::Internal(internal) => {
            polygon_ids.extend(internal.poly_ids.iter().copied());
            if let Some(pos) = &internal.pos {
                collect_drawing_bsp_node_polygon_ids(pos, polygon_ids);
            }
            if let Some(neg) = &internal.neg {
                collect_drawing_bsp_node_polygon_ids(neg, polygon_ids);
            }
        }
    }
}

fn ac_vector_to_render_space(vector: holtburger_common::Vector3) -> PreparedVec3 {
    PreparedVec3 {
        x: vector.x,
        y: vector.z,
        z: if vector.y == 0.0 { 0.0 } else { -vector.y },
    }
}

fn render_vector_to_ac_space(vector: PreparedVec3) -> holtburger_common::Vector3 {
    holtburger_common::Vector3 {
        x: vector.x,
        y: if vector.z == 0.0 { 0.0 } else { -vector.z },
        z: vector.y,
    }
}

fn scale_normal_component(value: f32, scale: f32) -> f32 {
    let scaled = value * scale;
    if scaled == 0.0 { 0.0 } else { scaled }
}

fn normalize_surface_id(surface_id: i16) -> Option<i16> {
    (surface_id >= 0).then_some(surface_id)
}

fn expand_bounds(bounds: Option<PreparedAabb>, point: PreparedVec3) -> PreparedAabb {
    match bounds {
        Some(bounds) => PreparedAabb {
            min: PreparedVec3 {
                x: bounds.min.x.min(point.x),
                y: bounds.min.y.min(point.y),
                z: bounds.min.z.min(point.z),
            },
            max: PreparedVec3 {
                x: bounds.max.x.max(point.x),
                y: bounds.max.y.max(point.y),
                z: bounds.max.z.max(point.z),
            },
        },
        None => PreparedAabb {
            min: point,
            max: point,
        },
    }
}

pub fn format_static_object_source_asset_id(did: u32) -> String {
    match did >> 24 {
        0x01 => format!("gfx-obj/{did:08x}"),
        0x02 => format!("setup-model/{did:08x}"),
        _ => format!("unsupported-static/{did:08x}"),
    }
}

fn classify_scene_landblock(landblock_info: Option<&LandblockInfoFact>) -> LandblockClassification {
    match landblock_info {
        Some(info)
            if info.num_env_cells > 0 && info.object_count == 0 && info.building_count == 0 =>
        {
            LandblockClassification::Dungeon
        }
        _ => LandblockClassification::Outdoor,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::static_outdoor_scene::{
        StaticOutdoorBuilding, StaticOutdoorBuildingPortal, StaticOutdoorFrame,
        StaticOutdoorInstance, StaticOutdoorInstanceIdentity, StaticRenderableSourceRef,
    };
    use holtburger_common::properties::GfxObjFlags;
    use holtburger_common::{Plane, Quaternion, Vector3};
    use holtburger_dat::graphics::{CVertexArray, SWVertex};
    use holtburger_dat::physics::{BspLeaf, BspPortal, PortalPoly};
    use holtburger_dat::{
        DatError, DatFileType, FileMetadata, HbaReader, ResourceKey, ResourceSource,
    };
    use std::collections::HashMap;
    use std::path::PathBuf;
    use std::sync::{Arc, Mutex};

    #[test]
    fn building_transition_apertures_resolve_portal_poly_geometry() {
        let building = synthetic_static_building(vec![StaticOutdoorBuildingPortal {
            source_index: 0,
            flags: 0x0001,
            other_cell_id: 0x0100,
            other_portal_id: 0xffff,
            stab_list: vec![0x0100],
            linked_env_cell_ids: vec![0xda55_0100],
        }]);
        let gfx_obj = synthetic_building_gfx_obj(PortalPoly {
            portal_index: 0,
            poly_id: 7,
        });
        let mut diagnostics = PreparedContentSourceDiagnostics::default();

        let apertures =
            build_building_transition_apertures_from_gfx_obj(&building, &gfx_obj, &mut diagnostics);

        assert_eq!(diagnostics.omissions, Vec::new());
        assert_eq!(apertures.len(), 1);
        let aperture = &apertures[0];
        assert_eq!(
            aperture.building_instance_id,
            "landblock-static/da55ffff/building/0000/01001234"
        );
        assert_eq!(aperture.source_did, 0x0100_1234);
        assert_eq!(aperture.source_asset_id, "gfx-obj/01001234");
        assert_eq!(aperture.portal_index, 0);
        assert_eq!(aperture.poly_id, 7);
        assert_eq!(aperture.building_portal_source_index, 0);
        assert_eq!(aperture.other_cell_id, 0x0100);
        assert_eq!(aperture.other_portal_id, 0xffff);
        assert_eq!(aperture.linked_env_cell_ids, vec![0xda55_0100]);
        assert_eq!(
            aperture.points,
            vec![
                PreparedVec3 {
                    x: 10.0,
                    y: 3.0,
                    z: -2.0,
                },
                PreparedVec3 {
                    x: 11.0,
                    y: 3.0,
                    z: -2.0,
                },
                PreparedVec3 {
                    x: 10.0,
                    y: 4.0,
                    z: -2.0,
                },
            ]
        );
    }

    #[test]
    fn building_transition_apertures_omit_unmatched_portal_poly_metadata() {
        let building = synthetic_static_building(Vec::new());
        let gfx_obj = synthetic_building_gfx_obj(PortalPoly {
            portal_index: 3,
            poly_id: 7,
        });
        let mut diagnostics = PreparedContentSourceDiagnostics::default();

        let apertures =
            build_building_transition_apertures_from_gfx_obj(&building, &gfx_obj, &mut diagnostics);

        assert!(apertures.is_empty());
        assert_eq!(diagnostics.omissions.len(), 1);
        assert_eq!(diagnostics.omissions[0].reason, "missing-building-portal");
    }

    #[test]
    fn building_transition_apertures_preserve_duplicate_portal_geometry() {
        let building = synthetic_static_building(vec![
            StaticOutdoorBuildingPortal {
                source_index: 0,
                flags: 0x0001,
                other_cell_id: 0x0100,
                other_portal_id: 0xffff,
                stab_list: vec![0x0100],
                linked_env_cell_ids: vec![0xda55_0100],
            },
            StaticOutdoorBuildingPortal {
                source_index: 1,
                flags: 0x0001,
                other_cell_id: 0x0101,
                other_portal_id: 0xffff,
                stab_list: vec![0x0101],
                linked_env_cell_ids: vec![0xda55_0101],
            },
        ]);
        let gfx_obj = synthetic_building_gfx_obj_with_portal_polys(vec![
            PortalPoly {
                portal_index: 0,
                poly_id: 7,
            },
            PortalPoly {
                portal_index: 1,
                poly_id: 7,
            },
        ]);
        let mut diagnostics = PreparedContentSourceDiagnostics::default();

        let apertures =
            build_building_transition_apertures_from_gfx_obj(&building, &gfx_obj, &mut diagnostics);

        assert_eq!(
            apertures
                .iter()
                .map(|aperture| (aperture.portal_index, aperture.other_cell_id))
                .collect::<Vec<_>>(),
            vec![(0, 0x0100), (1, 0x0101)]
        );
        assert_eq!(apertures[0].points, apertures[1].points);
        assert!(diagnostics.omissions.is_empty());
    }

    #[derive(Debug)]
    struct CountingSource {
        files: HashMap<(String, u32), Vec<u8>>,
        reads: Mutex<HashMap<(String, u32), usize>>,
    }

    fn synthetic_static_building(
        portals: Vec<StaticOutdoorBuildingPortal>,
    ) -> StaticOutdoorBuilding {
        StaticOutdoorBuilding {
            instance: StaticOutdoorInstance {
                identity: StaticOutdoorInstanceIdentity::Building {
                    landblock_id: 0xda55_ffff,
                    source_index: 0,
                    source_did: 0x0100_1234,
                },
                owning_landblock_id: 0xda55_ffff,
                source: StaticRenderableSourceRef::from_did(0x0100_1234),
                source_index: 0,
                frame: StaticOutdoorFrame {
                    origin: Vector3 {
                        x: 10.0,
                        y: 2.0,
                        z: 3.0,
                    },
                    orientation: Quaternion::identity(),
                },
            },
            num_leaves: 1,
            portals,
        }
    }

    fn synthetic_building_gfx_obj(portal_poly: PortalPoly) -> GfxObj {
        synthetic_building_gfx_obj_with_portal_polys(vec![portal_poly])
    }

    fn synthetic_building_gfx_obj_with_portal_polys(portal_polys: Vec<PortalPoly>) -> GfxObj {
        let mut vertices = HashMap::new();
        vertices.insert(0, synthetic_vertex(Vector3::zero()));
        vertices.insert(
            1,
            synthetic_vertex(Vector3 {
                x: 1.0,
                y: 0.0,
                z: 0.0,
            }),
        );
        vertices.insert(
            2,
            synthetic_vertex(Vector3 {
                x: 0.0,
                y: 0.0,
                z: 1.0,
            }),
        );

        let mut polygons = HashMap::new();
        polygons.insert(
            7,
            Polygon {
                num_pts: 3,
                stippling: 0,
                sides_type: CULL_MODE_COUNTER_CLOCKWISE,
                pos_surface: -1,
                neg_surface: -1,
                vertex_ids: vec![0, 1, 2],
                pos_uv_indices: vec![0, 0, 0],
                neg_uv_indices: Vec::new(),
            },
        );

        GfxObj {
            id: 0x0100_1234,
            flags: GfxObjFlags::HAS_DRAWING,
            surfaces: Vec::new(),
            vertex_array: CVertexArray {
                vertex_type: 1,
                vertices,
            },
            physics_polygons: HashMap::new(),
            physics_bsp: None,
            sort_center: Vector3::zero(),
            polygons,
            drawing_bsp: Some(BspNode::Port(BspPortal {
                plane: Plane {
                    normal: Vector3 {
                        x: 0.0,
                        y: 1.0,
                        z: 0.0,
                    },
                    d: 0.0,
                },
                pos: Box::new(BspNode::Leaf(BspLeaf {
                    index: 0,
                    solid: 0,
                    sphere: None,
                    poly_ids: Vec::new(),
                })),
                neg: Box::new(BspNode::Leaf(BspLeaf {
                    index: 1,
                    solid: 0,
                    sphere: None,
                    poly_ids: Vec::new(),
                })),
                sphere: None,
                poly_ids: Vec::new(),
                portal_polys,
            })),
            did_degrade: None,
        }
    }

    fn synthetic_vertex(origin: Vector3) -> SWVertex {
        SWVertex {
            num_uvs: 0,
            origin,
            normal: Vector3::zero(),
            uvs: Vec::new(),
        }
    }

    impl CountingSource {
        fn new(files: HashMap<(String, u32), Vec<u8>>) -> Self {
            Self {
                files,
                reads: Mutex::new(HashMap::new()),
            }
        }

        fn read_count(&self, namespace: &str, file_id: u32) -> usize {
            self.reads
                .lock()
                .expect("counting source reads should not be poisoned")
                .get(&(namespace.to_string(), file_id))
                .copied()
                .unwrap_or_default()
        }
    }

    impl ResourceSource for CountingSource {
        fn get_file_by_key(&self, key: ResourceKey<'_>) -> holtburger_dat::Result<Vec<u8>> {
            let lookup_key = (key.namespace.to_string(), key.file_id);
            *self
                .reads
                .lock()
                .expect("counting source reads should not be poisoned")
                .entry(lookup_key.clone())
                .or_default() += 1;
            self.files
                .get(&lookup_key)
                .cloned()
                .ok_or(DatError::NotFound(key.file_id))
        }

        fn get_metadata_by_key(&self, key: ResourceKey<'_>) -> Option<FileMetadata> {
            self.files
                .get(&(key.namespace.to_string(), key.file_id))
                .map(|bytes| FileMetadata {
                    id: key.file_id,
                    size: bytes.len() as u32,
                    is_pruned: false,
                })
        }

        fn has_namespace(&self, namespace: &str) -> bool {
            self.files
                .keys()
                .any(|(source_namespace, _)| source_namespace == namespace)
        }
    }

    fn repo_assets_hba_path() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../dats/assets.hba")
    }

    #[test]
    fn env_cell_helpers_derive_contiguous_landblock_namespace_ids() {
        assert_eq!(derive_landblock_info_id(0xda55012e), 0xda55fffe);
        assert_eq!(derive_first_env_cell_id(0xda55ffff, 0), None);
        assert_eq!(derive_first_env_cell_id(0xda55ffff, 3), Some(0xda550100));
        assert_eq!(derive_landblock_env_cell_id(0xda55ffff, 2), 0xda550102);
    }

    #[test]
    fn prepared_bvh_builder_splits_non_trivial_env_cell_roots() {
        let items = (0..6)
            .map(|index| PreparedSpatialItem {
                id: format!("env-cell/{:08x}", 0xda550100_u32 + index as u32),
                kind: PreparedSpatialItemKind::EnvCellRoot,
                bounds: test_aabb(index as f32 * 10.0, 0.0, 0.0, 1.0),
            })
            .collect::<Vec<_>>();

        let bvh = build_prepared_bvh_with_scope(
            0xda55ffff,
            "landblock-env-cell-root",
            PreparedBvhScope::LandblockEnvCells,
            &items,
        )
        .expect("non-empty env-cell roots should build a BVH");

        assert_eq!(bvh.coordinate_space, "landblock-env-cell-root");
        assert_eq!(bvh.scope, PreparedBvhScope::LandblockEnvCells);
        assert!(bvh.nodes.len() > 1);
        assert!(bvh.nodes[0].left.is_some());
        assert!(bvh.nodes[0].right.is_some());
        assert!(bvh.nodes[0].item_indices.is_empty());
        assert_eq!(
            bvh.nodes[0].kind_mask,
            PreparedBvhKindMask::LandblockEnvCells {
                env_cell_root: true
            }
        );
    }

    #[test]
    fn landblock_env_cell_bundle_treats_missing_landblock_info_as_empty() {
        let source = Arc::new(CountingSource::new(HashMap::new()));
        let repository = ContentRepository::from_mounts(vec![source.clone()]);
        let landblock_id = 0xe25b_ffff;
        let landblock_info_id = derive_landblock_info_id(landblock_id);
        let decode_cache = ContentDecodeCache::new();

        let asset = LandblockEnvCellsAssetAssembler::new()
            .assemble_landblock_with_cache(&repository, &decode_cache, landblock_id)
            .expect("missing LandblockInfo should mean no env-cell bundle content");

        assert_eq!(asset.landblock_id, landblock_id);
        assert_eq!(asset.landblock_info_id, landblock_info_id);
        assert!(asset.env_cells.is_empty());
        assert!(asset.landblock_bvh_items.is_empty());
        assert!(asset.landblock_bvh.is_none());
        assert_eq!(
            asset.diagnostics.source_records,
            vec![SourceRecordDiagnostic {
                namespace: EOR_CELL_NAMESPACE,
                file_id: landblock_info_id,
                role: "landblock-info",
                status: SourceRecordStatus::Missing,
            }]
        );
        assert_eq!(asset.diagnostics.errors.len(), 1);
        assert_eq!(asset.diagnostics.errors[0].error_code, "asset-read-failed");
    }

    #[test]
    fn landblock_env_cell_bundle_rejects_decode_failed_landblock_info() {
        let landblock_id = 0xe25b_ffff;
        let landblock_info_id = derive_landblock_info_id(landblock_id);
        let source = Arc::new(CountingSource::new(HashMap::from([(
            (EOR_CELL_NAMESPACE.to_string(), landblock_info_id),
            vec![0; 4],
        )])));
        let repository = ContentRepository::from_mounts(vec![source]);
        let decode_cache = ContentDecodeCache::new();

        let error = LandblockEnvCellsAssetAssembler::new()
            .assemble_landblock_with_cache(&repository, &decode_cache, landblock_id)
            .expect_err("corrupt LandblockInfo should remain a hard assembly error");

        let message = error.to_string();
        assert!(message.contains("Could not assemble landblock env-cell bundle 0xE25BFFFF"));
        assert!(message.contains("landblock-info asset-decode-failed"));
    }

    #[test]
    fn env_cell_landblock_bounds_transform_render_local_bounds_through_ac_frame() {
        let local_bounds = test_aabb(-1.0, -2.0, -3.0, 2.0);
        let frame = Frame {
            origin: holtburger_common::Vector3 {
                x: 10.0,
                y: -20.0,
                z: 5.0,
            },
            orientation: holtburger_common::Quaternion {
                w: 1.0,
                x: 0.0,
                y: 0.0,
                z: 0.0,
            },
        };

        let bounds =
            transform_render_local_bounds_by_ac_frame(local_bounds, &frame, unit_prepared_vec3());

        let center_x = (bounds.min.x + bounds.max.x) * 0.5;
        let center_y = (bounds.min.y + bounds.max.y) * 0.5;
        let center_z = (bounds.min.z + bounds.max.z) * 0.5;
        assert!((center_x - 10.0).abs() < 0.0001);
        assert!((center_y - 4.0).abs() < 0.0001);
        assert!((center_z - 18.0).abs() < 0.0001);
        assert!(bounds.max.x > bounds.min.x);
        assert!(bounds.max.y > bounds.min.y);
        assert!(bounds.max.z > bounds.min.z);
    }

    #[test]
    fn cell_bsp_plane_triples_derive_closed_cell_render_bounds() {
        let bsp = test_cell_bsp_box(
            holtburger_common::Vector3::new(-1.0, -2.0, -3.0),
            holtburger_common::Vector3::new(4.0, 5.0, 6.0),
        );

        let bounds = derive_cell_bsp_render_bounds_by_plane_triples(&bsp)
            .expect("closed CellBSP box should produce finite bounds");

        assert!((bounds.min.x - -1.0).abs() < 0.0001);
        assert!((bounds.max.x - 4.0).abs() < 0.0001);
        assert!((bounds.min.y - -3.0).abs() < 0.0001);
        assert!((bounds.max.y - 6.0).abs() < 0.0001);
        assert!((bounds.min.z - -5.0).abs() < 0.0001);
        assert!((bounds.max.z - 2.0).abs() < 0.0001);
    }

    #[test]
    fn cell_bsp_plane_triples_do_not_invent_bounds_for_unclosed_cells() {
        let bsp = BspNode::Internal(holtburger_dat::physics::InternalNode {
            tag: *b"BPnn",
            plane: holtburger_common::Plane {
                d: 0.0,
                normal: holtburger_common::Vector3::new(1.0, 0.0, 0.0),
            },
            pos: Some(Box::new(BspNode::Leaf(holtburger_dat::physics::BspLeaf {
                index: 0,
                poly_ids: Vec::new(),
                solid: 0,
                sphere: None,
            }))),
            neg: None,
            sphere: None,
            poly_ids: Vec::new(),
        });

        assert!(derive_cell_bsp_render_bounds_by_plane_triples(&bsp).is_none());
    }

    #[test]
    fn env_cell_landblock_bvh_uses_cell_local_bounds_without_static_double_transform() {
        let source_path = repo_assets_hba_path();
        if !source_path.is_file() {
            eprintln!(
                "skipping env-cell BVH double-transform regression; missing repo-local {}",
                source_path.display()
            );
            return;
        }

        let content =
            ContentRepository::from_hba_path(source_path).expect("repo assets.hba should open");
        let cache = ContentDecodeCache::new();
        let asset = LandblockEnvCellsAssetAssembler::new()
            .assemble_landblock_with_cache(&content, &cache, 0xda55ffff)
            .expect("da55ffff env-cell bundle should assemble");
        let cell = asset
            .env_cells
            .iter()
            .find(|cell| cell.env_cell.env_cell_id == 0xda550102)
            .expect("fixture landblock should include env cell 0xda550102");
        let bounds = cell
            .landblock_bounds
            .expect("fixture env cell should have landblock bounds");

        assert!(
            bounds.max.x - bounds.min.x < 20.0,
            "env-cell x extent should not include double-transformed indoor statics: {:?}",
            bounds
        );
        assert!(
            bounds.max.z - bounds.min.z < 20.0,
            "env-cell z extent should not include double-transformed indoor statics: {:?}",
            bounds
        );
    }

    #[test]
    fn env_cell_asset_assembly_does_not_read_landblock_roots() {
        let source_path = repo_assets_hba_path();
        if !source_path.is_file() {
            eprintln!(
                "skipping env-cell asset assembly test; missing repo-local {}",
                source_path.display()
            );
            return;
        }

        let archive = HbaReader::open(&source_path).expect("repo assets.hba should open");
        let Some((env_cell_id, env_cell_bytes, environment_id, environment_bytes)) =
            find_env_cell_asset_fixture(&archive)
        else {
            panic!("repo assets.hba should contain an env-cell with a resolvable environment");
        };
        let landblock_id = normalize_landblock_id(env_cell_id & 0xffff_0000);
        let landblock_info_id = landblock_id & 0xffff_fffe;
        let source = Arc::new(CountingSource::new(HashMap::from([
            (
                (EOR_CELL_NAMESPACE.to_string(), env_cell_id),
                env_cell_bytes,
            ),
            (
                (EOR_PORTAL_NAMESPACE.to_string(), environment_id),
                environment_bytes,
            ),
        ])));
        let repository = ContentRepository::from_mounts(vec![source.clone()]);

        let asset = EnvCellAssetAssembler::new()
            .assemble_env_cell(&repository, env_cell_id)
            .expect("env-cell asset should assemble from env-cell and environment records");

        assert_eq!(asset.prepared_cell.env_cell_id, env_cell_id);
        assert!(asset.prepared_cell.render_geometry.vertex_count > 0);
        assert_eq!(source.read_count(EOR_CELL_NAMESPACE, landblock_id), 0);
        assert_eq!(source.read_count(EOR_CELL_NAMESPACE, landblock_info_id), 0);
    }

    #[test]
    fn cell_structure_render_geometry_does_not_filter_to_drawing_bsp_polygons() {
        let vertex_array = test_vertex_array();
        let polygons = HashMap::from([
            (10, test_triangle_polygon([0, 1, 2])),
            (20, test_triangle_polygon([1, 3, 2])),
        ]);
        let cell_structure = CellStruct {
            id: 0x1234,
            vertex_array,
            polygons,
            portals: Vec::new(),
            cell_bsp: BspNode::Leaf(holtburger_dat::physics::BspLeaf {
                index: 0,
                solid: 0,
                sphere: None,
                poly_ids: Vec::new(),
            }),
            physics_polygons: HashMap::new(),
            physics_bsp: BspNode::Leaf(holtburger_dat::physics::BspLeaf {
                index: 0,
                solid: 0,
                sphere: None,
                poly_ids: Vec::new(),
            }),
            drawing_bsp: Some(BspNode::Leaf(holtburger_dat::physics::BspLeaf {
                index: 0,
                solid: 0,
                sphere: None,
                poly_ids: vec![10],
            })),
        };

        let geometry = build_cell_structure_render_geometry(&cell_structure);

        assert_eq!(geometry.triangle_count, 2);
        assert_eq!(
            geometry
                .triangles
                .iter()
                .map(|triangle| triangle.polygon_id)
                .collect::<Vec<_>>(),
            vec![10, 20]
        );
    }

    #[test]
    fn cell_structure_render_geometry_uses_positive_polygon_sides_only() {
        let vertex_array = test_vertex_array();
        let mut polygon = test_triangle_polygon([0, 1, 2]);
        polygon.sides_type = CULL_MODE_CLOCKWISE;
        polygon.pos_surface = 4;
        polygon.neg_surface = 7;
        polygon.neg_uv_indices = vec![1, 1, 1];
        let cell_structure = test_cell_structure(vertex_array, HashMap::from([(11, polygon)]));

        let geometry = build_cell_structure_render_geometry(&cell_structure);

        assert_eq!(geometry.triangle_count, 1);
        assert_eq!(
            geometry
                .triangles
                .iter()
                .map(|triangle| (
                    triangle.polygon_id,
                    triangle.surface_id,
                    triangle.material_variant_signature.as_str(),
                    triangle.first_vertex
                ))
                .collect::<Vec<_>>(),
            vec![(
                11,
                Some(4),
                legacy_sampler_material_variant_signature(false),
                0,
            )]
        );
        assert_eq!(geometry.surface_ids, vec![4]);
    }

    #[test]
    fn cell_structure_render_geometry_does_not_duplicate_cull_none_polygons() {
        let vertex_array = test_vertex_array();
        let mut polygon = test_triangle_polygon([0, 1, 2]);
        polygon.sides_type = CULL_MODE_NONE;
        polygon.pos_surface = 4;
        let cell_structure = test_cell_structure(vertex_array, HashMap::from([(12, polygon)]));

        let geometry = build_cell_structure_render_geometry(&cell_structure);

        assert_eq!(geometry.triangle_count, 1);
        assert_eq!(geometry.triangles[0].surface_id, Some(4));
    }

    #[test]
    fn cell_structure_render_geometry_ignores_malformed_negative_uvs() {
        let vertex_array = test_vertex_array();
        let mut polygon = test_triangle_polygon([0, 1, 2]);
        polygon.sides_type = CULL_MODE_CLOCKWISE;
        polygon.pos_surface = 4;
        polygon.neg_surface = 7;
        polygon.neg_uv_indices = vec![1, 1];
        let cell_structure = test_cell_structure(vertex_array, HashMap::from([(13, polygon)]));

        let geometry = build_cell_structure_render_geometry(&cell_structure);

        assert_eq!(geometry.triangle_count, 1);
        assert_eq!(geometry.skipped_polygon_count, 0);
        assert!(geometry.invalid_polygons.is_empty());
        assert_eq!(geometry.triangles[0].surface_id, Some(4));
    }

    #[test]
    fn polygon_side_expansion_emits_no_pos_positive_side_without_uvs() {
        let mut polygon = test_triangle_polygon([0, 1, 2]);
        polygon.stippling = STIPPLING_NO_POS;
        polygon.pos_uv_indices.clear();

        let sides = derive_polygon_render_sides(&polygon, PolygonRenderSidePolicy::VisualSides);

        assert_eq!(sides.len(), 1);
        assert_eq!(sides[0].kind, PreparedPolygonRenderSideKind::Positive);
        assert_eq!(sides[0].uv_indices, None);
    }

    #[test]
    fn polygon_side_expansion_duplicates_cull_none_with_reversed_positive_side() {
        let mut polygon = test_triangle_polygon([0, 1, 2]);
        polygon.sides_type = CULL_MODE_NONE;
        polygon.pos_surface = 4;

        let sides = derive_polygon_render_sides(&polygon, PolygonRenderSidePolicy::VisualSides);

        assert_eq!(sides.len(), 2);
        assert_eq!(sides[0].kind, PreparedPolygonRenderSideKind::Positive);
        assert_eq!(sides[0].surface_id, Some(4));
        assert_eq!(
            sides[0].material_variant_signature,
            legacy_sampler_material_variant_signature(false)
        );
        assert_eq!(sides[0].winding, PreparedPolygonWinding::Source);
        assert_eq!(sides[0].normal_scale, 1.0);
        assert_eq!(
            sides[1].kind,
            PreparedPolygonRenderSideKind::PositiveReversed
        );
        assert_eq!(sides[1].surface_id, Some(4));
        assert_eq!(
            sides[1].material_variant_signature,
            legacy_sampler_material_variant_signature(false)
        );
        assert_eq!(sides[1].uv_indices, Some(polygon.pos_uv_indices.as_slice()));
        assert_eq!(sides[1].winding, PreparedPolygonWinding::Reversed);
        assert_eq!(sides[1].normal_scale, -1.0);
    }

    #[test]
    fn polygon_side_expansion_emits_clockwise_negative_side_with_negative_surface() {
        let mut polygon = test_triangle_polygon([0, 1, 2]);
        polygon.sides_type = CULL_MODE_CLOCKWISE;
        polygon.pos_surface = 4;
        polygon.neg_surface = 7;
        polygon.neg_uv_indices = vec![1, 1, 1];

        let sides = derive_polygon_render_sides(&polygon, PolygonRenderSidePolicy::VisualSides);

        assert_eq!(sides.len(), 2);
        assert_eq!(sides[0].kind, PreparedPolygonRenderSideKind::Positive);
        assert_eq!(sides[0].surface_id, Some(4));
        assert_eq!(
            sides[0].material_variant_signature,
            legacy_sampler_material_variant_signature(false)
        );
        assert_eq!(sides[0].uv_indices, Some(polygon.pos_uv_indices.as_slice()));
        assert_eq!(sides[0].winding, PreparedPolygonWinding::Source);
        assert_eq!(sides[1].kind, PreparedPolygonRenderSideKind::Negative);
        assert_eq!(sides[1].surface_id, Some(7));
        assert_eq!(
            sides[1].material_variant_signature,
            legacy_sampler_material_variant_signature(false)
        );
        assert_eq!(sides[1].uv_indices, Some(polygon.neg_uv_indices.as_slice()));
        assert_eq!(sides[1].winding, PreparedPolygonWinding::Reversed);
        assert_eq!(sides[1].normal_scale, -1.0);
    }

    #[test]
    fn polygon_side_expansion_suppresses_clockwise_no_neg_negative_side() {
        let mut polygon = test_triangle_polygon([0, 1, 2]);
        polygon.sides_type = CULL_MODE_CLOCKWISE;
        polygon.stippling = STIPPLING_NO_NEG;
        polygon.neg_uv_indices.clear();

        let sides = derive_polygon_render_sides(&polygon, PolygonRenderSidePolicy::VisualSides);

        assert_eq!(sides.len(), 1);
        assert_eq!(sides[0].kind, PreparedPolygonRenderSideKind::Positive);
    }

    #[test]
    fn polygon_side_expansion_treats_counter_clockwise_as_positive_only() {
        let mut polygon = test_triangle_polygon([0, 1, 2]);
        polygon.sides_type = CULL_MODE_COUNTER_CLOCKWISE;

        let sides = derive_polygon_render_sides(&polygon, PolygonRenderSidePolicy::VisualSides);

        assert_eq!(sides.len(), 1);
        assert_eq!(sides[0].kind, PreparedPolygonRenderSideKind::Positive);
        assert_eq!(sides[0].winding, PreparedPolygonWinding::Source);
        assert_eq!(sides[0].normal_scale, 1.0);
    }

    #[test]
    fn polygon_render_geometry_uses_retail_side_winding_and_surfaces() {
        let vertex_array = test_vertex_array();
        let mut polygon = test_triangle_polygon([0, 1, 2]);
        polygon.sides_type = CULL_MODE_CLOCKWISE;
        polygon.pos_surface = 4;
        polygon.neg_surface = 7;
        polygon.neg_uv_indices = vec![1, 1, 1];
        let polygons = HashMap::from([(11, polygon)]);

        let geometry =
            build_polygon_set_render_geometry(0x0200_0001, &vertex_array, &polygons, None);

        assert_eq!(geometry.triangle_count, 2);
        assert_eq!(
            geometry
                .triangles
                .iter()
                .map(|triangle| (
                    triangle.polygon_id,
                    triangle.surface_id,
                    triangle.material_variant_signature.as_str(),
                    triangle.first_vertex
                ))
                .collect::<Vec<_>>(),
            vec![
                (
                    11,
                    Some(4),
                    legacy_sampler_material_variant_signature(false),
                    0,
                ),
                (
                    11,
                    Some(7),
                    legacy_sampler_material_variant_signature(false),
                    3,
                )
            ]
        );
        assert_eq!(
            geometry.positions,
            vec![
                0.0, 0.0, -0.0, 1.0, 0.0, -0.0, 0.0, 0.0, -1.0, 0.0, 0.0, -0.0, 0.0, 0.0, -1.0,
                1.0, 0.0, -0.0,
            ]
        );
        assert_eq!(
            geometry.normals,
            vec![
                0.0, 1.0, -0.0, 0.0, 1.0, -0.0, 0.0, 1.0, -0.0, -0.0, -1.0, 0.0, -0.0, -1.0, 0.0,
                -0.0, -1.0, 0.0,
            ]
        );
    }

    #[test]
    fn polygon_render_geometry_derives_sampler_variants_from_stippling_side_bits() {
        let vertex_array = test_vertex_array();
        let mut polygon = test_triangle_polygon([0, 1, 2]);
        polygon.sides_type = CULL_MODE_CLOCKWISE;
        polygon.stippling = STIPPLING_REPEAT_POS;
        polygon.pos_surface = 4;
        polygon.neg_surface = 4;
        polygon.neg_uv_indices = vec![1, 1, 1];
        let polygons = HashMap::from([(14, polygon)]);

        let geometry =
            build_polygon_set_render_geometry(0x0200_0001, &vertex_array, &polygons, None);

        assert_eq!(
            geometry
                .triangles
                .iter()
                .map(|triangle| (
                    triangle.surface_id,
                    triangle.material_variant_signature.as_str()
                ))
                .collect::<Vec<_>>(),
            vec![
                (Some(4), legacy_sampler_material_variant_signature(true)),
                (Some(4), legacy_sampler_material_variant_signature(false))
            ]
        );
    }

    #[test]
    fn polygon_render_geometry_emits_no_pos_polygons_with_zero_uvs() {
        let vertex_array = test_vertex_array();
        let mut polygon = test_triangle_polygon([0, 1, 2]);
        polygon.stippling = STIPPLING_NO_POS;
        polygon.pos_uv_indices.clear();
        let polygons = HashMap::from([(15, polygon)]);

        let geometry =
            build_polygon_set_render_geometry(0x0200_0001, &vertex_array, &polygons, None);

        assert_eq!(geometry.triangle_count, 1);
        assert_eq!(geometry.skipped_polygon_count, 0);
        assert!(geometry.invalid_polygons.is_empty());
        assert_eq!(geometry.triangles[0].surface_id, Some(0));
        assert_eq!(geometry.uvs, vec![0.0, 0.0, 0.0, 0.0, 0.0, 0.0]);
    }

    #[test]
    fn polygon_render_geometry_reports_malformed_positive_uvs() {
        let vertex_array = test_vertex_array();
        let mut polygon = test_triangle_polygon([0, 1, 2]);
        polygon.pos_uv_indices = vec![0, 0];
        let polygons = HashMap::from([(12, polygon)]);

        let geometry =
            build_polygon_set_render_geometry(0x0200_0001, &vertex_array, &polygons, None);

        assert_eq!(geometry.triangle_count, 0);
        assert_eq!(geometry.skipped_polygon_count, 1);
        assert_eq!(
            geometry.invalid_polygons,
            vec![PreparedPolygonSetInvalidPolygon {
                polygon_id: 12,
                reason: INVALID_POLYGON_REASON_MALFORMED_POSITIVE_UV_INDICES,
                vertex_ids: vec![0, 1, 2],
                missing_vertex_ids: Vec::new(),
            }]
        );
    }

    #[test]
    fn polygon_render_geometry_reports_malformed_negative_uvs_without_dropping_positive_side() {
        let vertex_array = test_vertex_array();
        let mut polygon = test_triangle_polygon([0, 1, 2]);
        polygon.sides_type = CULL_MODE_CLOCKWISE;
        polygon.neg_uv_indices = vec![1, 1];
        let polygons = HashMap::from([(13, polygon)]);

        let geometry =
            build_polygon_set_render_geometry(0x0200_0001, &vertex_array, &polygons, None);

        assert_eq!(geometry.triangle_count, 1);
        assert_eq!(geometry.skipped_polygon_count, 0);
        assert_eq!(
            geometry.invalid_polygons,
            vec![PreparedPolygonSetInvalidPolygon {
                polygon_id: 13,
                reason: INVALID_POLYGON_REASON_MALFORMED_NEGATIVE_UV_INDICES,
                vertex_ids: vec![0, 1, 2],
                missing_vertex_ids: Vec::new(),
            }]
        );
    }

    #[test]
    fn terrain_mesh_prepares_quads_and_hierarchical_bvh() {
        let cell = CellLandblockFact {
            id: 0xda55ffff,
            has_objects: false,
            grid_size: 9,
            tile_size: 24.0,
            terrain_types: (0..81)
                .map(|index| {
                    let terrain_code = ((index % 5) + 1) as u16;
                    let road_code = (index % 4) as u16;
                    (terrain_code << 2) | road_code
                })
                .collect(),
            heights: (0..81).map(|index| index as f32 * 0.25).collect(),
            min_height: 0.0,
            max_height: 20.0,
            all_heights_zero: false,
        };

        let mesh = build_terrain_mesh(&cell);

        assert_eq!(mesh.quads.len(), 64);
        assert_eq!(mesh.terrain_bvh_items.len(), 64);
        assert_eq!(mesh.quads[0].corner_terrain_codes, [1, 5, 1, 2]);
        assert_eq!(
            mesh.quads[0].pcode,
            terrain_pcode([0, 1, 2, 1], [1, 5, 1, 2])
        );
        let terrain_bvh = mesh.terrain_bvh.as_ref().expect("terrain bvh");
        assert_eq!(terrain_bvh.scope, PreparedBvhScope::OutdoorTerrain);
        assert!(terrain_bvh.nodes.len() > 1);
        assert!(terrain_bvh.nodes[0].left.is_some());
        assert!(terrain_bvh.nodes[0].right.is_some());
        assert!(terrain_bvh.nodes[0].item_indices.is_empty());
        assert_eq!(
            terrain_bvh.nodes[0].kind_mask,
            PreparedBvhKindMask::OutdoorTerrain { terrain_quad: true }
        );
    }

    fn test_vertex_array() -> holtburger_dat::graphics::CVertexArray {
        let mut vertex_array = holtburger_dat::graphics::CVertexArray::new();
        vertex_array.vertices.extend([
            (0, test_vertex(0.0, 0.0, 0.0, 0.0, 0.0)),
            (1, test_vertex(1.0, 0.0, 0.0, 1.0, 0.0)),
            (2, test_vertex(0.0, 1.0, 0.0, 0.0, 1.0)),
            (3, test_vertex(1.0, 1.0, 0.0, 1.0, 1.0)),
        ]);
        vertex_array
    }

    fn test_cell_structure(
        vertex_array: holtburger_dat::graphics::CVertexArray,
        polygons: HashMap<u16, Polygon>,
    ) -> CellStruct {
        CellStruct {
            id: 0x1234,
            vertex_array,
            polygons,
            portals: Vec::new(),
            cell_bsp: BspNode::Leaf(holtburger_dat::physics::BspLeaf {
                index: 0,
                solid: 0,
                sphere: None,
                poly_ids: Vec::new(),
            }),
            physics_polygons: HashMap::new(),
            physics_bsp: BspNode::Leaf(holtburger_dat::physics::BspLeaf {
                index: 0,
                solid: 0,
                sphere: None,
                poly_ids: Vec::new(),
            }),
            drawing_bsp: None,
        }
    }

    fn test_aabb(x: f32, y: f32, z: f32, size: f32) -> PreparedAabb {
        PreparedAabb {
            min: PreparedVec3 { x, y, z },
            max: PreparedVec3 {
                x: x + size,
                y: y + size,
                z: z + size,
            },
        }
    }

    fn test_cell_bsp_box(
        min: holtburger_common::Vector3,
        max: holtburger_common::Vector3,
    ) -> BspNode {
        let planes = [
            holtburger_common::Plane {
                d: -min.x,
                normal: holtburger_common::Vector3::new(1.0, 0.0, 0.0),
            },
            holtburger_common::Plane {
                d: max.x,
                normal: holtburger_common::Vector3::new(-1.0, 0.0, 0.0),
            },
            holtburger_common::Plane {
                d: -min.y,
                normal: holtburger_common::Vector3::new(0.0, 1.0, 0.0),
            },
            holtburger_common::Plane {
                d: max.y,
                normal: holtburger_common::Vector3::new(0.0, -1.0, 0.0),
            },
            holtburger_common::Plane {
                d: -min.z,
                normal: holtburger_common::Vector3::new(0.0, 0.0, 1.0),
            },
            holtburger_common::Plane {
                d: max.z,
                normal: holtburger_common::Vector3::new(0.0, 0.0, -1.0),
            },
        ];
        test_cell_bsp_half_space_chain(&planes)
    }

    fn test_cell_bsp_half_space_chain(planes: &[holtburger_common::Plane]) -> BspNode {
        let Some((plane, rest)) = planes.split_first() else {
            return BspNode::Leaf(holtburger_dat::physics::BspLeaf {
                index: 0,
                poly_ids: Vec::new(),
                solid: 0,
                sphere: None,
            });
        };
        BspNode::Internal(holtburger_dat::physics::InternalNode {
            tag: *b"BPnn",
            plane: *plane,
            pos: Some(Box::new(test_cell_bsp_half_space_chain(rest))),
            neg: None,
            sphere: None,
            poly_ids: Vec::new(),
        })
    }

    fn test_vertex(x: f32, y: f32, z: f32, u: f32, v: f32) -> holtburger_dat::graphics::SWVertex {
        holtburger_dat::graphics::SWVertex {
            num_uvs: 2,
            origin: holtburger_common::Vector3::new(x, y, z),
            normal: holtburger_common::Vector3::new(0.0, 0.0, 1.0),
            uvs: vec![
                holtburger_dat::graphics::Vec2Duv { u, v },
                holtburger_dat::graphics::Vec2Duv {
                    u: u + 0.5,
                    v: v + 0.5,
                },
            ],
        }
    }

    fn test_triangle_polygon(vertex_ids: [u16; 3]) -> Polygon {
        Polygon {
            num_pts: 3,
            stippling: 0,
            sides_type: 0,
            pos_surface: 0,
            neg_surface: 0,
            vertex_ids: vertex_ids.to_vec(),
            pos_uv_indices: vec![0, 0, 0],
            neg_uv_indices: vec![0, 0, 0],
        }
    }

    fn find_env_cell_asset_fixture(archive: &HbaReader) -> Option<(u32, Vec<u8>, u32, Vec<u8>)> {
        for entry in archive
            .entries()
            .collect::<holtburger_dat::Result<Vec<_>>>()
            .ok()?
        {
            if entry.namespace_id().ok()?.as_str() != EOR_CELL_NAMESPACE {
                continue;
            }
            if DatFileType::from_id(entry.file_id) != DatFileType::IndoorCell {
                continue;
            }
            let env_cell_bytes = archive
                .get_file_in_namespace(EOR_CELL_NAMESPACE, entry.file_id)
                .ok()?;
            let env_cell =
                EnvCell::unpack(&mut std::io::Cursor::new(env_cell_bytes.clone())).ok()?;
            let environment_id = 0x0D00_0000 | u32::from(env_cell.environment_id);
            let environment_bytes = archive
                .get_file_in_namespace(EOR_PORTAL_NAMESPACE, environment_id)
                .ok()?;
            let environment =
                Environment::unpack(&mut std::io::Cursor::new(environment_bytes.clone())).ok()?;
            let Some(cell_structure) = environment.cells.get(&u32::from(env_cell.cell_structure))
            else {
                continue;
            };
            if cell_structure.polygons.is_empty() || cell_structure.vertex_array.vertices.is_empty()
            {
                continue;
            }
            return Some((
                entry.file_id,
                env_cell_bytes,
                environment_id,
                environment_bytes,
            ));
        }
        None
    }

    #[test]
    fn prepared_terrain_mesh_matches_frontend_landblock_basis() {
        let cell = CellLandblockFact {
            id: 0x0102ffff,
            has_objects: false,
            grid_size: LANDBLOCK_GRID_SIZE,
            tile_size: LANDBLOCK_TILE_SIZE,
            terrain_types: (0..81).collect(),
            heights: (0..81).map(|height| height as f32).collect(),
            min_height: 0.0,
            max_height: 80.0,
            all_heights_zero: false,
        };

        let mesh = build_terrain_mesh(&cell);

        assert_eq!(mesh.vertices.len(), 81);
        assert_eq!(mesh.triangles.len(), 128);
        assert_eq!(
            mesh.vertices[1],
            PreparedVec3 {
                x: 24.0,
                y: 0.0,
                z: 9.0
            }
        );
        assert_eq!(
            mesh.vertices[9],
            PreparedVec3 {
                x: 0.0,
                y: 24.0,
                z: 1.0
            }
        );
        assert_eq!(mesh.triangles[0].terrain_type, 0);
        assert_eq!(mesh.triangles[2].terrain_type, 9);
    }

    #[test]
    fn outdoor_static_frames_remain_source_landblock_owned_when_overhanging() {
        use crate::static_outdoor_scene::{
            StaticOutdoorInstance, StaticOutdoorInstanceIdentity, StaticOutdoorLayerDiagnostics,
            StaticOutdoorScene, StaticOutdoorSceneDiagnostics, StaticRenderableSourceRef,
        };

        let frame = crate::static_outdoor_scene::StaticOutdoorFrame {
            origin: holtburger_common::Vector3 {
                x: 200.0,
                y: -5.0,
                z: 2.0,
            },
            orientation: holtburger_common::Quaternion::identity(),
        };
        let source_landblock_id = 0x0203fffe;
        let scene = StaticOutdoorScene {
            landblock_id: source_landblock_id,
            explicit_objects: vec![StaticOutdoorInstance {
                identity: StaticOutdoorInstanceIdentity::ExplicitObject {
                    landblock_id: source_landblock_id,
                    source_index: 0,
                    source_did: 0x0100_0001,
                },
                owning_landblock_id: source_landblock_id,
                source: StaticRenderableSourceRef::from_did(0x0100_0001),
                source_index: 0,
                frame,
            }],
            buildings: Vec::new(),
            generated_scenery: Vec::new(),
            diagnostics: StaticOutdoorSceneDiagnostics {
                landblock_info_available: true,
                landblock_info_error: None,
                explicit: StaticOutdoorLayerDiagnostics {
                    attempted: 1,
                    accepted: 1,
                    rejected_unsupported_source: 0,
                },
                ..StaticOutdoorSceneDiagnostics::default()
            },
        };

        let instances = build_prepared_outdoor_static_instances(Some(&scene)).collect::<Vec<_>>();

        assert_eq!(instances.len(), 1);
        let instance = &instances[0];
        assert_eq!(instance.owning_landblock_id, 0x0203ffff);
        assert_eq!(
            instance.local_placement.origin,
            holtburger_common::Vector3 {
                x: 200.0,
                y: -5.0,
                z: 2.0,
            }
        );

        let instance_bounds = conservative_instance_bounds(
            &instance.local_placement,
            &[],
            PreparedAabb {
                min: PreparedVec3 {
                    x: -1.0,
                    y: -1.0,
                    z: 0.0,
                },
                max: PreparedVec3 {
                    x: 1.0,
                    y: 1.0,
                    z: 2.0,
                },
            },
            unit_prepared_vec3(),
        );
        let spatial_items = build_outdoor_member_spatial_items(
            source_landblock_id,
            &[LandblockOutdoorStaticMember {
                instance: instance.clone(),
                source_bounds: None,
                instance_bounds: Some(instance_bounds),
                building: None,
                generated: None,
            }],
        );

        assert_eq!(
            spatial_items[0].id,
            format!(
                "landblock/{source_landblock_id:08x}/outdoor/spatial/static/{}",
                instance.instance_id
            )
        );
        assert!(spatial_items[0].bounds.min.x > 192.0);
        assert!(spatial_items[0].bounds.min.z > 0.0);
    }

    #[test]
    fn scene_lod_static_source_families_follow_level_contract() {
        assert_eq!(
            scene_lod_static_source_families(LandblockSceneLodLevel::Level0),
            StaticOutdoorSceneSourceFamilies::new(false, false, false)
        );
        assert_eq!(
            scene_lod_static_source_families(LandblockSceneLodLevel::Level1),
            StaticOutdoorSceneSourceFamilies::new(false, true, false)
        );
        assert_eq!(
            scene_lod_static_source_families(LandblockSceneLodLevel::Level2),
            StaticOutdoorSceneSourceFamilies::new(true, true, false)
        );
        assert_eq!(
            scene_lod_static_source_families(LandblockSceneLodLevel::Level3),
            StaticOutdoorSceneSourceFamilies::ALL
        );
        assert_eq!(
            scene_lod_static_source_families(LandblockSceneLodLevel::Level4),
            StaticOutdoorSceneSourceFamilies::ALL
        );
    }

    #[test]
    fn scene_lod_outdoor_layers_partition_static_families_by_level() {
        let layers = build_scene_lod_outdoor_layers(
            0xda55ffff,
            LandblockSceneLodLevel::Level3,
            None,
            None,
            vec![
                synthetic_outdoor_static_member(
                    "building",
                    PreparedStaticInstanceKind::Building,
                    Some(LandblockOutdoorBuildingFacts {
                        num_leaves: 1,
                        portals: Vec::new(),
                    }),
                    None,
                ),
                synthetic_outdoor_static_member(
                    "explicit",
                    PreparedStaticInstanceKind::Scenery,
                    None,
                    None,
                ),
                synthetic_outdoor_static_member(
                    "generated",
                    PreparedStaticInstanceKind::GeneratedScenery,
                    None,
                    Some(LandblockGeneratedSceneryFacts {
                        terrain_index: 4,
                        scene_id: 0x1200_0001,
                        scene_template_index: 9,
                    }),
                ),
            ],
            Vec::new(),
        );

        assert_eq!(layers.len(), 4);
        assert!(matches!(layers[0], LandblockSceneLodLayer::Terrain(_)));
        let LandblockSceneLodLayer::OutdoorBuildings(buildings) = &layers[1] else {
            panic!("level 3 should include an outdoor building layer");
        };
        let LandblockSceneLodLayer::OutdoorExplicitObjects(explicit) = &layers[2] else {
            panic!("level 3 should include an explicit outdoor object layer");
        };
        let LandblockSceneLodLayer::OutdoorGeneratedScenery(generated) = &layers[3] else {
            panic!("level 3 should include a generated scenery layer");
        };
        assert_eq!(buildings.statics[0].instance.instance_id, "building");
        assert_eq!(explicit.statics[0].instance.instance_id, "explicit");
        assert_eq!(generated.statics[0].instance.instance_id, "generated");

        let level_1 = build_scene_lod_outdoor_layers(
            0xda55ffff,
            LandblockSceneLodLevel::Level1,
            None,
            None,
            vec![synthetic_outdoor_static_member(
                "explicit",
                PreparedStaticInstanceKind::Scenery,
                None,
                None,
            )],
            Vec::new(),
        );
        assert_eq!(level_1.len(), 2);
        assert!(matches!(
            level_1[1],
            LandblockSceneLodLayer::OutdoorBuildings(_)
        ));
    }

    #[test]
    fn scene_lod_level_4_includes_env_cell_system_layer() {
        let source = Arc::new(CountingSource::new(HashMap::new()));
        let repository = ContentRepository::from_mounts(vec![source]);
        let decode_cache = ContentDecodeCache::new();

        let asset = LandblockSceneLodAssetAssembler::new().assemble_landblock_with_cache(
            &repository,
            &decode_cache,
            LandblockSceneLodRequest::outdoor(0xda55_0123, LandblockSceneLodLevel::Level4),
        );

        assert_eq!(asset.landblock_id, 0xda55ffff);
        assert_eq!(asset.layers.len(), 5);
        assert!(matches!(
            asset.layers[4],
            LandblockSceneLodLayer::EnvCellSystem(_)
        ));
        let LandblockSceneLodLayer::EnvCellSystem(layer) = &asset.layers[4] else {
            panic!("level 4 should include env-cell system output");
        };
        assert_eq!(layer.landblock_info_id, 0xda55fffe);
        assert!(layer.building_transition_apertures.is_empty());
        assert!(layer.env_cells.is_empty());
        assert_eq!(layer.diagnostics.source_records.len(), 1);
        assert_eq!(layer.diagnostics.source_records[0].role, "landblock-info");
        assert_eq!(
            layer.diagnostics.source_records[0].status,
            SourceRecordStatus::Missing
        );
    }

    #[test]
    fn scene_lod_level_4_carries_cached_building_transition_apertures() {
        let source = Arc::new(CountingSource::new(HashMap::new()));
        let repository = ContentRepository::from_mounts(vec![source]);
        let decode_cache = ContentDecodeCache::new();
        let cached = LandblockSceneLodAsset {
            landblock_id: 0xda55ffff,
            level: LandblockSceneLodLevel::Level3,
            context: LandblockSceneLodContext::Outdoor,
            layers: vec![LandblockSceneLodLayer::OutdoorBuildings(
                LandblockSceneLodOutdoorBuildingsLayer {
                    statics: Vec::new(),
                    building_transition_apertures: vec![synthetic_building_transition_aperture()],
                    outdoor_bvh: None,
                },
            )],
            diagnostics: PreparedContentSourceDiagnostics::default(),
        };

        let asset = LandblockSceneLodAssetAssembler::new()
            .assemble_landblock_extending_cached_asset(
                &repository,
                &decode_cache,
                LandblockSceneLodRequest::outdoor(0xda55_0123, LandblockSceneLodLevel::Level4),
                Some(&cached),
            );

        let LandblockSceneLodLayer::EnvCellSystem(layer) = asset.layers.last().unwrap() else {
            panic!("level 4 cache extension should append env-cell system output");
        };
        assert_eq!(layer.building_transition_apertures.len(), 1);
        assert_eq!(
            layer.building_transition_apertures[0].aperture_id,
            "building-transition-aperture:building-01:0"
        );
    }

    #[test]
    fn scene_lod_level_4_interior_emits_env_cells_without_outdoor_layers() {
        let source = Arc::new(CountingSource::new(HashMap::new()));
        let repository = ContentRepository::from_mounts(vec![source]);
        let decode_cache = ContentDecodeCache::new();

        let asset = LandblockSceneLodAssetAssembler::new().assemble_landblock_with_cache(
            &repository,
            &decode_cache,
            LandblockSceneLodRequest {
                landblock_id: 0xda55ffff,
                level: LandblockSceneLodLevel::Level4,
                context: LandblockSceneLodContext::Interior,
            },
        );

        assert_eq!(asset.context, LandblockSceneLodContext::Interior);
        assert_eq!(asset.layers.len(), 1);
        let LandblockSceneLodLayer::EnvCellSystem(layer) = &asset.layers[0] else {
            panic!("interior level 4 should include env-cell system output");
        };
        assert!(layer.building_transition_apertures.is_empty());
    }

    #[test]
    fn scene_lod_lower_levels_do_not_include_env_cell_system_layer() {
        let source = Arc::new(CountingSource::new(HashMap::new()));
        let repository = ContentRepository::from_mounts(vec![source]);
        let decode_cache = ContentDecodeCache::new();

        let asset = LandblockSceneLodAssetAssembler::new().assemble_landblock_with_cache(
            &repository,
            &decode_cache,
            LandblockSceneLodRequest::outdoor(0xda55_0123, LandblockSceneLodLevel::Level3),
        );

        assert!(
            asset
                .layers
                .iter()
                .all(|layer| !matches!(layer, LandblockSceneLodLayer::EnvCellSystem(_)))
        );
    }

    #[test]
    fn static_instance_bounds_include_setup_part_placements() {
        let instance = Frame {
            origin: holtburger_common::Vector3 {
                x: 10.0,
                y: 20.0,
                z: 2.0,
            },
            orientation: holtburger_common::Quaternion::identity(),
        };
        let part = Frame {
            origin: holtburger_common::Vector3 {
                x: 3.0,
                y: 4.0,
                z: 5.0,
            },
            orientation: holtburger_common::Quaternion::identity(),
        };
        let bounds = conservative_instance_bounds(
            &instance,
            &[part],
            PreparedAabb {
                min: PreparedVec3 {
                    x: 0.0,
                    y: 0.0,
                    z: 0.0,
                },
                max: PreparedVec3 {
                    x: 0.0,
                    y: 0.0,
                    z: 0.0,
                },
            },
            unit_prepared_vec3(),
        );

        assert_eq!(
            bounds.min,
            PreparedVec3 {
                x: 13.0,
                y: 7.0,
                z: -24.0,
            }
        );
        assert_eq!(bounds.max, bounds.min);
    }

    #[test]
    fn static_instance_bounds_convert_render_local_center_before_ac_placement() {
        let placement = Frame {
            origin: holtburger_common::Vector3 {
                x: 10.0,
                y: 20.0,
                z: 2.0,
            },
            orientation: holtburger_common::Quaternion::identity(),
        };
        let bounds = conservative_instance_bounds(
            &placement,
            &[],
            PreparedAabb {
                min: PreparedVec3 {
                    x: 1.0,
                    y: 3.0,
                    z: -4.0,
                },
                max: PreparedVec3 {
                    x: 1.0,
                    y: 3.0,
                    z: -4.0,
                },
            },
            PreparedVec3 {
                x: 2.0,
                y: 3.0,
                z: 5.0,
            },
        );

        assert_eq!(
            bounds.min,
            PreparedVec3 {
                x: 12.0,
                y: 17.0,
                z: -32.0,
            }
        );
        assert_eq!(bounds.max, bounds.min);
    }

    #[test]
    fn static_instance_bounds_transform_scaled_corners_without_radius_cube_inflation() {
        let placement = Frame {
            origin: holtburger_common::Vector3 {
                x: 0.0,
                y: 0.0,
                z: 0.0,
            },
            orientation: holtburger_common::Quaternion::identity(),
        };
        let bounds = conservative_instance_bounds(
            &placement,
            &[],
            PreparedAabb {
                min: PreparedVec3 {
                    x: 0.0,
                    y: 0.0,
                    z: 0.0,
                },
                max: PreparedVec3 {
                    x: 2.0,
                    y: 4.0,
                    z: 6.0,
                },
            },
            PreparedVec3 {
                x: 2.0,
                y: 3.0,
                z: 5.0,
            },
        );

        assert_eq!(
            bounds,
            PreparedAabb {
                min: PreparedVec3 {
                    x: 0.0,
                    y: 0.0,
                    z: 0.0,
                },
                max: PreparedVec3 {
                    x: 4.0,
                    y: 20.0,
                    z: 18.0,
                },
            }
        );
    }

    #[test]
    fn static_instance_bounds_rotate_source_centers() {
        let placement = Frame {
            origin: holtburger_common::Vector3 {
                x: 10.0,
                y: 20.0,
                z: 2.0,
            },
            orientation: holtburger_common::Quaternion::from_heading(180.0_f32.to_radians()),
        };
        let bounds = conservative_instance_bounds(
            &placement,
            &[],
            PreparedAabb {
                min: PreparedVec3 {
                    x: 1.0,
                    y: 0.0,
                    z: 0.0,
                },
                max: PreparedVec3 {
                    x: 1.0,
                    y: 0.0,
                    z: 0.0,
                },
            },
            unit_prepared_vec3(),
        );

        assert!((bounds.min.x - 10.0).abs() < 0.001);
        assert!((bounds.min.y - 2.0).abs() < 0.001);
        assert!((bounds.min.z + 19.0).abs() < 0.001);
        assert_eq!(bounds.max, bounds.min);
    }

    fn synthetic_outdoor_static_member(
        instance_id: &str,
        kind: PreparedStaticInstanceKind,
        building: Option<LandblockOutdoorBuildingFacts>,
        generated: Option<LandblockGeneratedSceneryFacts>,
    ) -> LandblockOutdoorStaticMember {
        LandblockOutdoorStaticMember {
            instance: PreparedStaticInstance {
                instance_id: instance_id.to_string(),
                kind,
                owning_landblock_id: 0xda55ffff,
                owning_env_cell_id: None,
                source_did: 0x0100_0001,
                source_asset_id: "gfx-obj/01000001".to_string(),
                source_index: 0,
                local_placement: Frame {
                    origin: holtburger_common::Vector3::zero(),
                    orientation: holtburger_common::Quaternion::identity(),
                },
                source_scale: unit_prepared_vec3(),
            },
            source_bounds: None,
            instance_bounds: None,
            building,
            generated,
        }
    }

    fn synthetic_building_transition_aperture() -> PreparedBuildingTransitionAperture {
        PreparedBuildingTransitionAperture {
            aperture_id: "building-transition-aperture:building-01:0".to_string(),
            building_instance_id: "building-01".to_string(),
            source_did: 0x0200_1234,
            source_asset_id: "gfxobj/02001234".to_string(),
            portal_index: 0,
            poly_id: 42,
            building_portal_id: "building-portal-0".to_string(),
            building_portal_source_index: 0,
            flags: 1,
            other_cell_id: 0x0100,
            other_portal_id: 0xffff,
            linked_env_cell_ids: vec![0x0102_0100],
            points: vec![
                PreparedVec3 {
                    x: 0.0,
                    y: 0.0,
                    z: 0.0,
                },
                PreparedVec3 {
                    x: 1.0,
                    y: 0.0,
                    z: 0.0,
                },
                PreparedVec3 {
                    x: 0.0,
                    y: 1.0,
                    z: 0.0,
                },
            ],
        }
    }
}
