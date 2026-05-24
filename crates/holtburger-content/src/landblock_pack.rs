use std::collections::{HashMap, HashSet};

use holtburger_dat::file_type::{CellStruct, EnvCell, Environment, GfxObj, SetupModel};
use holtburger_dat::graphics::{Frame, Polygon};
use holtburger_dat::landblock::{CellLandblock, LandblockInfo};
use holtburger_dat::physics::BspNode;
use holtburger_dat::{EOR_CELL_NAMESPACE, EOR_PORTAL_NAMESPACE};

use crate::source_reader::ContentSourceReader;
use crate::static_outdoor_scene::{StaticOutdoorScene, StaticOutdoorSceneAssembler};
use crate::{ContentDecodeCache, ContentRepository, normalize_landblock_id};

pub const LANDBLOCK_GRID_SIZE: usize = 9;
pub const LANDBLOCK_TILE_SIZE: f32 = 24.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LandblockClassification {
    Outdoor,
    Dungeon,
}

#[derive(Debug, Clone)]
pub struct LandblockPack {
    pub landblock_id: u32,
    pub landblock_info_id: u32,
    pub classification: LandblockClassification,
    pub cell_landblock: Option<CellLandblockFact>,
    pub landblock_info: Option<LandblockInfoFact>,
    pub outdoor_scene: Option<StaticOutdoorScene>,
    pub interiors: LandblockInteriorFacts,
    pub prepared: LandblockPreparedFacts,
    pub diagnostics: PreparedContentSourceDiagnostics,
}

#[derive(Debug, Clone)]
pub struct LandblockSummary {
    pub landblock_id: u32,
    pub landblock_info_id: u32,
    pub classification: LandblockClassification,
    pub cell_landblock: Option<CellLandblockFact>,
    pub landblock_info: Option<LandblockInfoFact>,
    pub terrain_mesh: Option<PreparedTerrainMesh>,
    pub objects: Vec<LandblockSummaryObject>,
    pub buildings: Vec<LandblockSummaryBuilding>,
    pub diagnostics: PreparedContentSourceDiagnostics,
}

#[derive(Debug, Clone)]
pub struct EnvCellAsset {
    pub env_cell: EnvCellFact,
    pub prepared_cell: PreparedInteriorCell,
    pub static_meshes: Vec<PreparedStaticMesh>,
    pub diagnostics: PreparedContentSourceDiagnostics,
}

#[derive(Debug, Clone)]
pub struct LandblockTerrainAsset {
    pub landblock_id: u32,
    pub cell_landblock: Option<CellLandblockFact>,
    pub terrain_mesh: Option<PreparedTerrainMesh>,
    pub diagnostics: PreparedContentSourceDiagnostics,
}

#[derive(Debug, Clone)]
pub struct LandblockOutdoorAsset {
    pub landblock_id: u32,
    pub cell_landblock: Option<CellLandblockFact>,
    pub terrain_mesh: Option<PreparedTerrainMesh>,
    pub statics: Vec<LandblockOutdoorStaticMember>,
    pub outdoor_bvh: Option<PreparedBvh>,
    pub diagnostics: PreparedContentSourceDiagnostics,
}

#[derive(Debug, Clone)]
pub struct LandblockBuildingShellsAsset {
    pub landblock_id: u32,
    pub landblock_info_id: u32,
    pub shells: Vec<LandblockBuildingShell>,
    pub diagnostics: PreparedContentSourceDiagnostics,
}

#[derive(Debug, Clone)]
pub struct LandblockSceneAsset {
    pub landblock_id: u32,
    pub landblock_info_id: u32,
    pub classification: LandblockClassification,
    pub statics: Vec<LandblockSceneStaticMember>,
    pub buildings: Vec<LandblockSceneBuildingMember>,
    pub env_cells: Vec<EnvCellFact>,
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
pub struct LandblockBuildingShell {
    pub shell_id: String,
    pub building_index: usize,
    pub source_did: u32,
    pub source_asset_id: String,
    pub local_placement: Frame,
    pub source_scale: PreparedVec3,
    pub source_bounds: Option<PreparedAabb>,
    pub instance_bounds: Option<PreparedAabb>,
}

#[derive(Debug, Clone)]
pub struct LandblockSceneStaticMember {
    pub instance: PreparedStaticInstance,
    pub source_bounds: Option<PreparedAabb>,
    pub instance_bounds: Option<PreparedAabb>,
}

#[derive(Debug, Clone)]
pub struct LandblockSceneBuildingMember {
    pub instance: PreparedStaticInstance,
    pub source_bounds: Option<PreparedAabb>,
    pub instance_bounds: Option<PreparedAabb>,
    pub num_leaves: u32,
    pub portals: Vec<LandblockBuildingPortal>,
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

#[derive(Debug, Clone)]
pub struct LandblockSummaryObject {
    pub instance_id: String,
    pub owning_landblock_id: u32,
    pub source_did: u32,
    pub source_asset_id: Option<String>,
    pub source_index: usize,
    pub local_placement: Frame,
}

#[derive(Debug, Clone)]
pub struct LandblockSummaryBuilding {
    pub instance_id: String,
    pub owning_landblock_id: u32,
    pub source_did: u32,
    pub source_asset_id: Option<String>,
    pub source_index: usize,
    pub local_placement: Frame,
    pub num_leaves: u32,
    pub portals: Vec<LandblockBuildingPortal>,
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
pub struct LandblockInteriorFacts {
    pub env_cells: Vec<EnvCellFact>,
    pub environments: Vec<EnvironmentFact>,
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

#[derive(Debug, Default, Clone)]
pub struct LandblockPreparedFacts {
    pub terrain_mesh: Option<PreparedTerrainMesh>,
    pub outdoor_static_instances: Vec<PreparedStaticInstance>,
    pub interior_cells: Vec<PreparedInteriorCell>,
    pub static_meshes: Vec<PreparedStaticMesh>,
    pub spatial_items: Vec<PreparedSpatialItem>,
    pub static_landblock_bvh: Option<PreparedBvh>,
}

#[derive(Debug, Clone)]
pub struct PreparedTerrainMesh {
    pub landblock_id: u32,
    pub grid_size: usize,
    pub tile_size: f32,
    pub vertices: Vec<PreparedVec3>,
    pub triangles: Vec<PreparedTerrainTriangle>,
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
pub struct PreparedSpatialItem {
    pub id: String,
    pub kind: PreparedSpatialItemKind,
    pub owner_id: Option<u32>,
    pub source_asset_id: Option<String>,
    pub bounds: PreparedAabb,
    pub metadata: PreparedSpatialItemMetadata,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PreparedSpatialItemKind {
    Terrain,
    OutdoorStatic,
    Building,
    EnvCell,
    IndoorStatic,
    Portal,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PreparedSpatialItemMetadata {
    None,
    TerrainQuad(PreparedTerrainQuadSpatialMetadata),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreparedTerrainQuadSpatialMetadata {
    pub row: usize,
    pub col: usize,
    pub quad_index: usize,
    pub triangle_indices: [usize; 2],
}

#[derive(Debug, Clone)]
pub struct PreparedBvh {
    pub coordinate_space: &'static str,
    pub landblock_id: u32,
    pub scope: &'static str,
    pub nodes: Vec<PreparedBvhNode>,
}

#[derive(Debug, Clone)]
pub struct PreparedBvhNode {
    pub bounds: PreparedAabb,
    pub left: Option<usize>,
    pub right: Option<usize>,
    pub item_indices: Vec<usize>,
    pub kind_mask: u32,
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
    pub first_vertex: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreparedPolygonSetInvalidPolygon {
    pub polygon_id: u16,
    pub vertex_ids: Vec<u16>,
    pub missing_vertex_ids: Vec<u16>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PreparedAabb {
    pub min: PreparedVec3,
    pub max: PreparedVec3,
}

#[derive(Debug, Default, Clone)]
pub struct PreparedContentSourceDiagnostics {
    pub source_records: Vec<SourceRecordDiagnostic>,
    pub omissions: Vec<SourceOmissionDiagnostic>,
    pub errors: Vec<SourceLoadError>,
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
pub struct LandblockPackAssembler;

#[derive(Debug, Default, Clone, Copy)]
pub struct LandblockSummaryAssembler;

#[derive(Debug, Default, Clone, Copy)]
pub struct EnvCellAssetAssembler;

#[derive(Debug, Default, Clone, Copy)]
pub struct LandblockTerrainAssetAssembler;

#[derive(Debug, Default, Clone, Copy)]
pub struct LandblockOutdoorAssetAssembler;

#[derive(Debug, Default, Clone, Copy)]
pub struct LandblockBuildingShellsAssetAssembler;

#[derive(Debug, Default, Clone, Copy)]
pub struct LandblockSceneAssetAssembler;

#[derive(Debug, Default, Clone, Copy)]
pub struct LandblockTopologyAssetAssembler;

struct LandblockPackAssemblyContext<'a> {
    source: ContentSourceReader<'a>,
    diagnostics: PreparedContentSourceDiagnostics,
}

impl<'a> LandblockPackAssemblyContext<'a> {
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
        let landblock_info_id = derive_landblock_info_id(landblock_id);
        match self.source.landblock_info(landblock_info_id) {
            Ok(info) => {
                self.report_source_record(
                    EOR_CELL_NAMESPACE,
                    landblock_info_id,
                    "landblock-info",
                    SourceRecordStatus::Loaded,
                );
                Some(info)
            }
            Err(error) => {
                self.report_source_record(
                    EOR_CELL_NAMESPACE,
                    landblock_info_id,
                    "landblock-info",
                    source_status_from_error(&error),
                );
                self.report_source_error(
                    EOR_CELL_NAMESPACE,
                    landblock_info_id,
                    "landblock-info",
                    source_error_code_from_error(&error),
                    format!("Could not load LandblockInfo 0x{landblock_info_id:08X}: {error:#}"),
                );
                None
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

impl LandblockPackAssembler {
    pub fn new() -> Self {
        Self
    }

    pub fn assemble_landblock(
        &self,
        content: &ContentRepository,
        raw_landblock_id: u32,
    ) -> LandblockPack {
        self.assemble_landblock_with_context(
            LandblockPackAssemblyContext::new(content),
            raw_landblock_id,
        )
    }

    pub fn assemble_landblock_with_cache(
        &self,
        content: &ContentRepository,
        decode_cache: &ContentDecodeCache,
        raw_landblock_id: u32,
    ) -> LandblockPack {
        self.assemble_landblock_with_context(
            LandblockPackAssemblyContext::with_decode_cache(content, decode_cache),
            raw_landblock_id,
        )
    }

    fn assemble_landblock_with_context(
        &self,
        mut context: LandblockPackAssemblyContext<'_>,
        raw_landblock_id: u32,
    ) -> LandblockPack {
        let landblock_id = normalize_landblock_id(raw_landblock_id);
        let landblock_info_id = derive_landblock_info_id(landblock_id);
        let cell_landblock_source = context.load_cell_landblock(landblock_id);
        let landblock_info_source = context.load_landblock_info(landblock_id);
        let cell_landblock = cell_landblock_source
            .as_ref()
            .map(CellLandblockFact::from_landblock);
        let landblock_info = landblock_info_source
            .as_ref()
            .map(|info| LandblockInfoFact::from_info(info, landblock_id));
        let classification = classify_landblock(cell_landblock.as_ref(), landblock_info.as_ref());
        let interiors = landblock_info
            .as_ref()
            .map(|info| load_interior_facts(&mut context, landblock_id, info))
            .unwrap_or_default();
        let outdoor_scene = match classification {
            LandblockClassification::Dungeon => {
                context.report_source_omission(
                    EOR_CELL_NAMESPACE,
                    landblock_id,
                    "landblock-static",
                    "proven-dungeon-landblock",
                    format!(
                        "Skipped outdoor static scene assembly for proven dungeon landblock 0x{landblock_id:08X}."
                    ),
                );
                None
            }
            LandblockClassification::Outdoor => match StaticOutdoorSceneAssembler::new()
                .assemble_landblock_with_source(&mut context.source, landblock_id)
            {
                Ok(scene) => Some(scene),
                Err(error) => {
                    context.report_source_error(
                        EOR_CELL_NAMESPACE,
                        landblock_id,
                        "landblock-static",
                        "asset-decode-failed",
                        format!(
                            "Could not assemble outdoor static scene 0x{landblock_id:08X}: {error}"
                        ),
                    );
                    None
                }
            },
        };
        let prepared = prepare_landblock_facts(
            &mut context,
            landblock_id,
            cell_landblock.as_ref(),
            &interiors,
            outdoor_scene.as_ref(),
        );
        let diagnostics = context.into_diagnostics();

        LandblockPack {
            landblock_id,
            landblock_info_id,
            classification,
            cell_landblock,
            landblock_info,
            outdoor_scene,
            interiors,
            prepared,
            diagnostics,
        }
    }
}

impl LandblockSummaryAssembler {
    pub fn new() -> Self {
        Self
    }

    pub fn assemble_landblock(
        &self,
        content: &ContentRepository,
        raw_landblock_id: u32,
    ) -> LandblockSummary {
        self.assemble_landblock_with_context(
            LandblockPackAssemblyContext::new(content),
            raw_landblock_id,
        )
    }

    pub fn assemble_landblock_with_cache(
        &self,
        content: &ContentRepository,
        decode_cache: &ContentDecodeCache,
        raw_landblock_id: u32,
    ) -> LandblockSummary {
        self.assemble_landblock_with_context(
            LandblockPackAssemblyContext::with_decode_cache(content, decode_cache),
            raw_landblock_id,
        )
    }

    fn assemble_landblock_with_context(
        &self,
        mut context: LandblockPackAssemblyContext<'_>,
        raw_landblock_id: u32,
    ) -> LandblockSummary {
        let landblock_id = normalize_landblock_id(raw_landblock_id);
        let landblock_info_id = derive_landblock_info_id(landblock_id);
        let cell_landblock_source = context.load_cell_landblock(landblock_id);
        let landblock_info_source = context.load_landblock_info(landblock_id);
        let cell_landblock = cell_landblock_source
            .as_ref()
            .map(CellLandblockFact::from_landblock);
        let landblock_info = landblock_info_source
            .as_ref()
            .map(|info| LandblockInfoFact::from_info(info, landblock_id));
        let terrain_mesh = cell_landblock.as_ref().map(build_terrain_mesh);
        let objects = landblock_info_source
            .as_ref()
            .map(|info| build_landblock_summary_objects(landblock_id, info))
            .unwrap_or_default();
        let buildings = landblock_info_source
            .as_ref()
            .map(|info| build_landblock_summary_buildings(landblock_id, info))
            .unwrap_or_default();
        let classification = classify_landblock(cell_landblock.as_ref(), landblock_info.as_ref());
        let diagnostics = context.into_diagnostics();

        LandblockSummary {
            landblock_id,
            landblock_info_id,
            classification,
            cell_landblock,
            landblock_info,
            terrain_mesh,
            objects,
            buildings,
            diagnostics,
        }
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
        self.assemble_env_cell_with_context(LandblockPackAssemblyContext::new(content), env_cell_id)
    }

    pub fn assemble_env_cell_with_cache(
        &self,
        content: &ContentRepository,
        decode_cache: &ContentDecodeCache,
        env_cell_id: u32,
    ) -> Option<EnvCellAsset> {
        self.assemble_env_cell_with_context(
            LandblockPackAssemblyContext::with_decode_cache(content, decode_cache),
            env_cell_id,
        )
    }

    fn assemble_env_cell_with_context(
        &self,
        mut context: LandblockPackAssemblyContext<'_>,
        env_cell_id: u32,
    ) -> Option<EnvCellAsset> {
        let source = context.load_env_cell(env_cell_id)?;
        let env_cell = EnvCellFact::from_env_cell(env_cell_id, &source);
        let environment_id = env_cell.environment_id?;
        let cell_structure_id = env_cell.cell_structure_id?;
        let environment =
            load_environment_fact(&mut context, environment_id, &[cell_structure_id])?;
        let interiors = LandblockInteriorFacts {
            env_cells: vec![env_cell.clone()],
            environments: vec![environment],
        };
        let prepared_cell = build_prepared_interior_cells(&interiors)
            .into_iter()
            .next()?;
        let landblock_id = normalize_landblock_id(env_cell_id & 0xffff_0000);
        let indoor_instances =
            build_prepared_indoor_static_instances(landblock_id, &interiors).collect::<Vec<_>>();
        let static_meshes = build_prepared_static_meshes(&mut context, indoor_instances.iter());
        let diagnostics = context.into_diagnostics();

        Some(EnvCellAsset {
            env_cell,
            prepared_cell,
            static_meshes,
            diagnostics,
        })
    }
}

impl LandblockTerrainAssetAssembler {
    pub fn new() -> Self {
        Self
    }

    pub fn assemble_landblock(
        &self,
        content: &ContentRepository,
        raw_landblock_id: u32,
    ) -> LandblockTerrainAsset {
        self.assemble_landblock_with_context(
            LandblockPackAssemblyContext::new(content),
            raw_landblock_id,
        )
    }

    pub fn assemble_landblock_with_cache(
        &self,
        content: &ContentRepository,
        decode_cache: &ContentDecodeCache,
        raw_landblock_id: u32,
    ) -> LandblockTerrainAsset {
        self.assemble_landblock_with_context(
            LandblockPackAssemblyContext::with_decode_cache(content, decode_cache),
            raw_landblock_id,
        )
    }

    fn assemble_landblock_with_context(
        &self,
        mut context: LandblockPackAssemblyContext<'_>,
        raw_landblock_id: u32,
    ) -> LandblockTerrainAsset {
        let landblock_id = normalize_landblock_id(raw_landblock_id);
        let cell_landblock = context
            .load_cell_landblock(landblock_id)
            .as_ref()
            .map(CellLandblockFact::from_landblock);
        let terrain_mesh = cell_landblock.as_ref().map(build_terrain_mesh);
        let diagnostics = context.into_diagnostics();

        LandblockTerrainAsset {
            landblock_id,
            cell_landblock,
            terrain_mesh,
            diagnostics,
        }
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
            LandblockPackAssemblyContext::new(content),
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
            LandblockPackAssemblyContext::with_decode_cache(content, decode_cache),
            raw_landblock_id,
        )
    }

    fn assemble_landblock_with_context(
        &self,
        mut context: LandblockPackAssemblyContext<'_>,
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
                    source_landblock,
                    landblock_info_source.as_ref(),
                    None,
                    &region,
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
        let static_meshes = build_prepared_static_meshes(&mut context, instances.iter());
        let statics = build_landblock_outdoor_static_members(
            outdoor_scene.as_ref(),
            instances,
            &static_meshes,
        );
        let spatial_items = build_outdoor_member_spatial_items(landblock_id, &statics);
        let outdoor_bvh = build_prepared_bvh(landblock_id, &spatial_items);
        let diagnostics = context.into_diagnostics();

        LandblockOutdoorAsset {
            landblock_id,
            cell_landblock,
            terrain_mesh,
            statics,
            outdoor_bvh,
            diagnostics,
        }
    }
}

impl LandblockBuildingShellsAssetAssembler {
    pub fn new() -> Self {
        Self
    }

    pub fn assemble_landblock(
        &self,
        content: &ContentRepository,
        raw_landblock_id: u32,
    ) -> LandblockBuildingShellsAsset {
        self.assemble_landblock_with_context(
            LandblockPackAssemblyContext::new(content),
            raw_landblock_id,
        )
    }

    pub fn assemble_landblock_with_cache(
        &self,
        content: &ContentRepository,
        decode_cache: &ContentDecodeCache,
        raw_landblock_id: u32,
    ) -> LandblockBuildingShellsAsset {
        self.assemble_landblock_with_context(
            LandblockPackAssemblyContext::with_decode_cache(content, decode_cache),
            raw_landblock_id,
        )
    }

    fn assemble_landblock_with_context(
        &self,
        mut context: LandblockPackAssemblyContext<'_>,
        raw_landblock_id: u32,
    ) -> LandblockBuildingShellsAsset {
        let landblock_id = normalize_landblock_id(raw_landblock_id);
        let landblock_info_id = derive_landblock_info_id(landblock_id);
        let instances = context
            .load_landblock_info(landblock_id)
            .as_ref()
            .map(|info| build_landblock_building_shell_instances(landblock_id, info))
            .unwrap_or_default();
        let static_meshes = build_prepared_static_meshes(&mut context, instances.iter());
        let shells = instances
            .iter()
            .map(|instance| {
                let (source_bounds, instance_bounds) =
                    prepared_static_instance_bounds(instance, &static_meshes);
                LandblockBuildingShell {
                    shell_id: instance.instance_id.clone(),
                    building_index: instance.source_index,
                    source_did: instance.source_did,
                    source_asset_id: instance.source_asset_id.clone(),
                    local_placement: instance.local_placement.clone(),
                    source_scale: instance.source_scale,
                    source_bounds,
                    instance_bounds,
                }
            })
            .collect();
        let diagnostics = context.into_diagnostics();

        LandblockBuildingShellsAsset {
            landblock_id,
            landblock_info_id,
            shells,
            diagnostics,
        }
    }
}

impl LandblockSceneAssetAssembler {
    pub fn new() -> Self {
        Self
    }

    pub fn assemble_landblock(
        &self,
        content: &ContentRepository,
        raw_landblock_id: u32,
    ) -> LandblockSceneAsset {
        self.assemble_landblock_with_context(
            LandblockPackAssemblyContext::new(content),
            raw_landblock_id,
        )
    }

    pub fn assemble_landblock_with_cache(
        &self,
        content: &ContentRepository,
        decode_cache: &ContentDecodeCache,
        raw_landblock_id: u32,
    ) -> LandblockSceneAsset {
        self.assemble_landblock_with_context(
            LandblockPackAssemblyContext::with_decode_cache(content, decode_cache),
            raw_landblock_id,
        )
    }

    fn assemble_landblock_with_context(
        &self,
        mut context: LandblockPackAssemblyContext<'_>,
        raw_landblock_id: u32,
    ) -> LandblockSceneAsset {
        let landblock_id = normalize_landblock_id(raw_landblock_id);
        let landblock_info_id = derive_landblock_info_id(landblock_id);
        let landblock_info_source = context.load_landblock_info(landblock_id);
        let landblock_info = landblock_info_source
            .as_ref()
            .map(|info| LandblockInfoFact::from_info(info, landblock_id));
        let classification = classify_scene_landblock(landblock_info.as_ref());
        let env_cells = landblock_info
            .as_ref()
            .map(|info| load_env_cell_facts(&mut context, landblock_id, info))
            .unwrap_or_default();
        let (static_instances, building_specs) = landblock_info_source
            .as_ref()
            .map(|info| build_landblock_scene_instances(landblock_id, info))
            .unwrap_or_default();
        let static_meshes = build_prepared_static_meshes(&mut context, static_instances.iter());
        let (statics, buildings) =
            build_landblock_scene_members(static_instances, building_specs, &static_meshes);
        let diagnostics = context.into_diagnostics();

        LandblockSceneAsset {
            landblock_id,
            landblock_info_id,
            classification,
            statics,
            buildings,
            env_cells,
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
            LandblockPackAssemblyContext::new(content),
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
            LandblockPackAssemblyContext::with_decode_cache(content, decode_cache),
            raw_landblock_id,
        )
    }

    fn assemble_landblock_with_context(
        &self,
        mut context: LandblockPackAssemblyContext<'_>,
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

fn load_interior_facts(
    context: &mut LandblockPackAssemblyContext<'_>,
    landblock_id: u32,
    landblock_info: &LandblockInfoFact,
) -> LandblockInteriorFacts {
    let env_cells = load_env_cell_facts(context, landblock_id, landblock_info);

    let mut selected_cell_structures = env_cells
        .iter()
        .filter_map(|env_cell| Some((env_cell.environment_id?, env_cell.cell_structure_id?)))
        .collect::<Vec<_>>();
    selected_cell_structures.sort_unstable();
    selected_cell_structures.dedup();

    let mut environment_ids = selected_cell_structures
        .iter()
        .map(|(environment_id, _)| *environment_id)
        .collect::<Vec<_>>();
    environment_ids.sort_unstable();
    environment_ids.dedup();

    let environments = environment_ids
        .into_iter()
        .filter_map(|environment_id| {
            let selected_ids = selected_cell_structures
                .iter()
                .filter_map(|(selected_environment_id, cell_structure_id)| {
                    (*selected_environment_id == environment_id).then_some(*cell_structure_id)
                })
                .collect::<Vec<_>>();
            load_environment_fact(context, environment_id, &selected_ids)
        })
        .collect();

    LandblockInteriorFacts {
        env_cells,
        environments,
    }
}

fn load_env_cell_facts(
    context: &mut LandblockPackAssemblyContext<'_>,
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
    context: &mut LandblockPackAssemblyContext<'_>,
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

fn build_landblock_summary_objects(
    landblock_id: u32,
    info: &LandblockInfo,
) -> Vec<LandblockSummaryObject> {
    info.objects
        .iter()
        .enumerate()
        .map(|(source_index, object)| LandblockSummaryObject {
            instance_id: format!(
                "landblock-summary/{landblock_id:08x}/object/{source_index:04x}/{:08x}",
                object.id
            ),
            owning_landblock_id: landblock_id,
            source_did: object.id,
            source_asset_id: renderable_source_asset_id(object.id),
            source_index,
            local_placement: Frame {
                origin: object.frame.origin,
                orientation: object.frame.orientation,
            },
        })
        .collect()
}

fn build_landblock_summary_buildings(
    landblock_id: u32,
    info: &LandblockInfo,
) -> Vec<LandblockSummaryBuilding> {
    info.buildings
        .iter()
        .enumerate()
        .map(|(source_index, building)| LandblockSummaryBuilding {
            instance_id: format!(
                "landblock-summary/{landblock_id:08x}/building/{source_index:04x}/{:08x}",
                building.model_id
            ),
            owning_landblock_id: landblock_id,
            source_did: building.model_id,
            source_asset_id: renderable_source_asset_id(building.model_id),
            source_index,
            local_placement: Frame {
                origin: building.frame.origin,
                orientation: building.frame.orientation,
            },
            num_leaves: building.num_leaves,
            portals: building
                .portals
                .iter()
                .enumerate()
                .map(|(portal_index, portal)| LandblockBuildingPortal {
                    portal_id: format!(
                        "landblock-summary/{landblock_id:08x}/building/{source_index:04x}/portal/{portal_index:04x}"
                    ),
                    source_index: portal_index,
                    flags: portal.flags,
                    other_cell_id: portal.other_cell_id,
                    other_portal_id: portal.other_portal_id,
                    stab_list: portal.stab_list.clone(),
                    linked_env_cell_ids: portal
                        .stab_list
                        .iter()
                        .copied()
                        .map(|stab| crate::normalize_landblock_env_cell_id(landblock_id, stab))
                        .collect(),
                })
                .collect(),
        })
        .collect()
}

fn build_landblock_building_shell_instances(
    landblock_id: u32,
    info: &LandblockInfo,
) -> Vec<PreparedStaticInstance> {
    info.buildings
        .iter()
        .enumerate()
        .filter_map(|(source_index, building)| {
            build_prepared_static_instance(PreparedStaticInstanceSpec {
                kind: PreparedStaticInstanceKind::Building,
                instance_id: format!(
                    "landblock/{landblock_id:08x}/building-shell/{source_index:04x}/{:08x}",
                    building.model_id
                ),
                owning_landblock_id: landblock_id,
                owning_env_cell_id: None,
                source_did: building.model_id,
                source_index,
                local_placement: Frame {
                    origin: building.frame.origin,
                    orientation: building.frame.orientation,
                },
                source_scale: unit_prepared_vec3(),
            })
        })
        .collect()
}

#[derive(Debug, Clone)]
struct LandblockSceneBuildingSpec {
    instance_id: String,
    num_leaves: u32,
    portals: Vec<LandblockBuildingPortal>,
}

fn build_landblock_scene_instances(
    landblock_id: u32,
    info: &LandblockInfo,
) -> (Vec<PreparedStaticInstance>, Vec<LandblockSceneBuildingSpec>) {
    let mut instances = Vec::new();
    let mut buildings = Vec::new();

    instances.extend(
        info.objects
            .iter()
            .enumerate()
            .filter_map(|(source_index, object)| {
                build_prepared_static_instance(PreparedStaticInstanceSpec {
                    kind: PreparedStaticInstanceKind::Scenery,
                    instance_id: format!(
                        "landblock-static/{landblock_id:08x}/object/{source_index:04x}/{:08x}",
                        object.id
                    ),
                    owning_landblock_id: landblock_id,
                    owning_env_cell_id: None,
                    source_did: object.id,
                    source_index,
                    local_placement: Frame {
                        origin: object.frame.origin,
                        orientation: object.frame.orientation,
                    },
                    source_scale: unit_prepared_vec3(),
                })
            }),
    );

    for (source_index, building) in info.buildings.iter().enumerate() {
        let instance_id = format!(
            "landblock-static/{landblock_id:08x}/building/{source_index:04x}/{:08x}",
            building.model_id
        );
        let Some(instance) = build_prepared_static_instance(PreparedStaticInstanceSpec {
            kind: PreparedStaticInstanceKind::Building,
            instance_id: instance_id.clone(),
            owning_landblock_id: landblock_id,
            owning_env_cell_id: None,
            source_did: building.model_id,
            source_index,
            local_placement: Frame {
                origin: building.frame.origin,
                orientation: building.frame.orientation,
            },
            source_scale: unit_prepared_vec3(),
        }) else {
            continue;
        };

        let portals = building
            .portals
            .iter()
            .enumerate()
            .map(|(portal_index, portal)| LandblockBuildingPortal {
                portal_id: format!(
                    "landblock-scene/{landblock_id:08x}/building/{source_index:04x}/portal/{portal_index:04x}"
                ),
                source_index: portal_index,
                flags: portal.flags,
                other_cell_id: portal.other_cell_id,
                other_portal_id: portal.other_portal_id,
                stab_list: portal.stab_list.clone(),
                linked_env_cell_ids: portal
                    .stab_list
                    .iter()
                    .copied()
                    .map(|stab| crate::normalize_landblock_env_cell_id(landblock_id, stab))
                    .collect(),
            })
            .collect();
        buildings.push(LandblockSceneBuildingSpec {
            instance_id: instance_id.clone(),
            num_leaves: building.num_leaves,
            portals,
        });
        instances.push(instance);
    }

    (instances, buildings)
}

fn build_landblock_scene_members(
    instances: Vec<PreparedStaticInstance>,
    building_specs: Vec<LandblockSceneBuildingSpec>,
    static_meshes: &[PreparedStaticMesh],
) -> (
    Vec<LandblockSceneStaticMember>,
    Vec<LandblockSceneBuildingMember>,
) {
    let mut statics = Vec::new();
    let mut buildings = Vec::new();

    for instance in instances {
        let (source_bounds, instance_bounds) =
            prepared_static_instance_bounds(&instance, static_meshes);
        if instance.kind == PreparedStaticInstanceKind::Building {
            let spec = building_specs
                .iter()
                .find(|spec| spec.instance_id == instance.instance_id);
            buildings.push(LandblockSceneBuildingMember {
                instance,
                source_bounds,
                instance_bounds,
                num_leaves: spec.map(|spec| spec.num_leaves).unwrap_or_default(),
                portals: spec.map(|spec| spec.portals.clone()).unwrap_or_default(),
            });
        } else {
            statics.push(LandblockSceneStaticMember {
                instance,
                source_bounds,
                instance_bounds,
            });
        }
    }

    (statics, buildings)
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

fn prepare_landblock_facts(
    context: &mut LandblockPackAssemblyContext<'_>,
    landblock_id: u32,
    cell_landblock: Option<&CellLandblockFact>,
    interiors: &LandblockInteriorFacts,
    outdoor_scene: Option<&StaticOutdoorScene>,
) -> LandblockPreparedFacts {
    let outdoor_static_instances =
        build_prepared_outdoor_static_instances(outdoor_scene).collect::<Vec<_>>();
    let indoor_static_instances =
        build_prepared_indoor_static_instances(landblock_id, interiors).collect::<Vec<_>>();
    let static_meshes = build_prepared_static_meshes(
        context,
        outdoor_static_instances
            .iter()
            .chain(indoor_static_instances.iter()),
    );
    let terrain_mesh = cell_landblock.map(build_terrain_mesh);
    let interior_cells = build_prepared_interior_cells(interiors);
    let spatial_items = build_prepared_spatial_items(
        landblock_id,
        terrain_mesh.as_ref(),
        &interior_cells,
        &static_meshes,
    );
    let static_landblock_bvh = build_prepared_bvh(landblock_id, &spatial_items);

    LandblockPreparedFacts {
        terrain_mesh,
        outdoor_static_instances,
        interior_cells,
        static_meshes,
        spatial_items,
        static_landblock_bvh,
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
                    owning_landblock_id: instance.owning_landblock_id,
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
                    owning_landblock_id: instance.owning_landblock_id,
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
                    owning_landblock_id: instance.owning_landblock_id,
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
    context: &mut LandblockPackAssemblyContext<'_>,
    instances: impl Iterator<Item = &'a PreparedStaticInstance>,
) -> Vec<PreparedStaticMesh> {
    let mut meshes = Vec::new();
    let mut reported_missing = HashSet::new();
    for instance in instances {
        match instance.source_did >> 24 {
            0x01 => {
                let source_bounds =
                    load_gfx_obj_render_bounds(context, instance.source_did, &mut reported_missing);
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
                let Some(setup_model) =
                    load_setup_model_for_pack(context, instance.source_did, &mut reported_missing)
                else {
                    continue;
                };
                for (part_index, gfx_obj_id) in setup_model.parts.iter().copied().enumerate() {
                    let source_bounds =
                        load_gfx_obj_render_bounds(context, gfx_obj_id, &mut reported_missing);
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
        instance_bounds: source_bounds.map(|bounds| {
            conservative_instance_bounds(&instance.local_placement, bounds, combined_scale)
        }),
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

fn build_prepared_spatial_items(
    landblock_id: u32,
    terrain_mesh: Option<&PreparedTerrainMesh>,
    interior_cells: &[PreparedInteriorCell],
    static_meshes: &[PreparedStaticMesh],
) -> Vec<PreparedSpatialItem> {
    let mut items = Vec::new();

    if let Some(terrain_mesh) = terrain_mesh {
        items.extend(build_terrain_quad_spatial_items(landblock_id, terrain_mesh));
    }

    items.extend(interior_cells.iter().filter_map(|cell| {
        let bounds = transform_render_bounds_by_ac_placement(
            cell.render_geometry.bounds?,
            &cell.local_placement,
            unit_prepared_vec3(),
        );
        Some(PreparedSpatialItem {
            id: format!(
                "landblock-pack/{landblock_id:08x}/spatial/interior-cell/{:08x}",
                cell.env_cell_id
            ),
            kind: PreparedSpatialItemKind::EnvCell,
            owner_id: Some(cell.env_cell_id),
            source_asset_id: None,
            bounds,
            metadata: PreparedSpatialItemMetadata::None,
        })
    }));

    items.extend(static_meshes.iter().filter_map(|mesh| {
        let bounds = mesh.instance_bounds?;
        Some(PreparedSpatialItem {
            id: format!(
                "landblock-pack/{landblock_id:08x}/spatial/static/{}/part/{:04x}/{:08x}",
                mesh.instance_id, mesh.part_index, mesh.gfx_obj_id
            ),
            kind: match mesh.kind {
                PreparedStaticInstanceKind::Building => PreparedSpatialItemKind::Building,
                PreparedStaticInstanceKind::IndoorStatic => PreparedSpatialItemKind::IndoorStatic,
                PreparedStaticInstanceKind::Scenery
                | PreparedStaticInstanceKind::GeneratedScenery => {
                    PreparedSpatialItemKind::OutdoorStatic
                }
            },
            owner_id: mesh.owning_env_cell_id.or(Some(mesh.owning_landblock_id)),
            source_asset_id: Some(mesh.gfx_obj_asset_id.clone()),
            bounds,
            metadata: PreparedSpatialItemMetadata::None,
        })
    }));

    items.sort_by(|left, right| left.id.cmp(&right.id));
    items
}

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
                owner_id: Some(member.instance.owning_landblock_id),
                source_asset_id: Some(member.instance.source_asset_id.clone()),
                bounds,
                metadata: PreparedSpatialItemMetadata::None,
            })
        })
        .collect::<Vec<_>>();
    items.sort_by(|left, right| left.id.cmp(&right.id));
    items
}

fn build_terrain_quad_spatial_items(
    landblock_id: u32,
    mesh: &PreparedTerrainMesh,
) -> Vec<PreparedSpatialItem> {
    if mesh.grid_size < 2 {
        return Vec::new();
    }

    let quad_width = mesh.grid_size - 1;
    let mut items = Vec::with_capacity(quad_width * quad_width);
    for row in 0..quad_width {
        for col in 0..quad_width {
            let southwest = row * mesh.grid_size + col;
            let southeast = southwest + 1;
            let northwest = southwest + mesh.grid_size;
            let northeast = northwest + 1;
            let Some(bounds) =
                terrain_vertex_bounds(mesh, [southwest, southeast, northwest, northeast])
            else {
                continue;
            };
            let quad_index = row * quad_width + col;
            let first_triangle_index = quad_index * 2;
            items.push(PreparedSpatialItem {
                id: format!(
                    "landblock-pack/{landblock_id:08x}/spatial/terrain-quad/{row:02x}/{col:02x}"
                ),
                kind: PreparedSpatialItemKind::Terrain,
                owner_id: Some(landblock_id),
                source_asset_id: None,
                bounds,
                metadata: PreparedSpatialItemMetadata::TerrainQuad(
                    PreparedTerrainQuadSpatialMetadata {
                        row,
                        col,
                        quad_index,
                        triangle_indices: [first_triangle_index, first_triangle_index + 1],
                    },
                ),
            });
        }
    }
    items
}

fn terrain_vertex_bounds<const N: usize>(
    mesh: &PreparedTerrainMesh,
    vertex_indices: [usize; N],
) -> Option<PreparedAabb> {
    vertex_indices
        .into_iter()
        .filter_map(|index| mesh.vertices.get(index))
        .map(|vertex| PreparedVec3 {
            x: vertex.x,
            y: vertex.z,
            z: if vertex.y == 0.0 { 0.0 } else { -vertex.y },
        })
        .fold(None, |bounds, point| Some(expand_bounds(bounds, point)))
}

fn transform_render_bounds_by_ac_placement(
    bounds: PreparedAabb,
    placement: &Frame,
    scale: PreparedVec3,
) -> PreparedAabb {
    let center = PreparedVec3 {
        x: (bounds.min.x + bounds.max.x) * 0.5,
        y: (bounds.min.y + bounds.max.y) * 0.5,
        z: (bounds.min.z + bounds.max.z) * 0.5,
    };
    let half_extent = PreparedVec3 {
        x: (bounds.max.x - bounds.min.x).abs() * 0.5 * scale.x.abs(),
        y: (bounds.max.y - bounds.min.y).abs() * 0.5 * scale.y.abs(),
        z: (bounds.max.z - bounds.min.z).abs() * 0.5 * scale.z.abs(),
    };
    let radius = (half_extent.x * half_extent.x
        + half_extent.y * half_extent.y
        + half_extent.z * half_extent.z)
        .sqrt();
    let origin = convert_ac_vector_to_render_space(placement.origin);
    let center = PreparedVec3 {
        x: origin.x + center.x * scale.x,
        y: origin.y + center.y * scale.y,
        z: origin.z + center.z * scale.z,
    };
    PreparedAabb {
        min: PreparedVec3 {
            x: center.x - radius,
            y: center.y - radius,
            z: center.z - radius,
        },
        max: PreparedVec3 {
            x: center.x + radius,
            y: center.y + radius,
            z: center.z + radius,
        },
    }
}

fn build_prepared_bvh(landblock_id: u32, items: &[PreparedSpatialItem]) -> Option<PreparedBvh> {
    if items.is_empty() {
        return None;
    }

    let mut nodes = Vec::new();
    let item_indices = (0..items.len()).collect::<Vec<_>>();
    build_prepared_bvh_node(items, item_indices, &mut nodes);
    Some(PreparedBvh {
        coordinate_space: "landblock-render-local",
        landblock_id,
        scope: "static-landblock",
        nodes,
    })
}

fn build_prepared_bvh_node(
    items: &[PreparedSpatialItem],
    mut item_indices: Vec<usize>,
    nodes: &mut Vec<PreparedBvhNode>,
) -> usize {
    let bounds = item_indices
        .iter()
        .map(|index| items[*index].bounds)
        .reduce(union_bounds)
        .expect("BVH nodes require at least one spatial item");
    let kind_mask = item_indices.iter().fold(0, |mask, index| {
        mask | spatial_item_kind_mask(items[*index].kind)
    });
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
    let left = build_prepared_bvh_node(items, item_indices, nodes);
    let right = build_prepared_bvh_node(items, right_indices, nodes);
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

fn spatial_item_kind_mask(kind: PreparedSpatialItemKind) -> u32 {
    match kind {
        PreparedSpatialItemKind::Terrain => 1 << 0,
        PreparedSpatialItemKind::OutdoorStatic => 1 << 1,
        PreparedSpatialItemKind::Building => 1 << 2,
        PreparedSpatialItemKind::EnvCell => 1 << 3,
        PreparedSpatialItemKind::IndoorStatic => 1 << 4,
        PreparedSpatialItemKind::Portal => 1 << 5,
    }
}

fn load_setup_model_for_pack(
    context: &mut LandblockPackAssemblyContext<'_>,
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
    context: &mut LandblockPackAssemblyContext<'_>,
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
    source_bounds: PreparedAabb,
    scale: PreparedVec3,
) -> PreparedAabb {
    transform_render_bounds_by_ac_placement(source_bounds, placement, scale)
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
    for row in 0..(grid_size - 1) {
        for col in 0..(grid_size - 1) {
            let southwest = row * grid_size + col;
            let southeast = southwest + 1;
            let northwest = southwest + grid_size;
            let northeast = northwest + 1;
            let terrain_type = normalized_terrain_types
                .get(southwest)
                .copied()
                .unwrap_or(0);
            let average_height = (normalized_heights[southwest]
                + normalized_heights[southeast]
                + normalized_heights[northwest]
                + normalized_heights[northeast])
                / 4.0;

            if uses_southwest_to_northeast_cut(cell_landblock.id, col as u32, row as u32) {
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
        }
    }

    PreparedTerrainMesh {
        landblock_id: cell_landblock.id,
        grid_size,
        tile_size,
        vertices,
        triangles,
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
        if render_geometry.vertex_count == 0 {
            continue;
        }

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
        .map(|vertex| convert_ac_vector_to_render_space(vertex.origin))
        .collect()
}

fn derive_portal_aperture_source_plane(
    drawing_bsp: Option<&BspNode>,
    portal: &EnvCellPortalFact,
) -> Option<PreparedPortalAperturePlane> {
    let source_plane = find_portal_plane_by_portal_reference(drawing_bsp?, portal)?;
    Some(PreparedPortalAperturePlane {
        normal: convert_ac_vector_to_render_space(source_plane.normal),
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
    build_polygon_set_render_geometry(
        cell_structure.id,
        &cell_structure.vertex_array,
        &cell_structure.polygons,
        cell_structure.drawing_bsp.as_ref(),
    )
}

fn build_polygon_set_render_geometry(
    source_id: u32,
    vertex_array: &holtburger_dat::graphics::CVertexArray,
    drawing_polygons: &std::collections::HashMap<u16, Polygon>,
    drawing_bsp: Option<&BspNode>,
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
        let Some(render_side) = derive_environment_polygon_render_side(polygon) else {
            skipped_polygon_count += 1;
            continue;
        };
        let missing_vertex_ids = polygon
            .vertex_ids
            .iter()
            .copied()
            .filter(|vertex_id| !vertex_array.vertices.contains_key(vertex_id))
            .collect::<Vec<_>>();
        if !missing_vertex_ids.is_empty() {
            invalid_polygons.push(PreparedPolygonSetInvalidPolygon {
                polygon_id: *polygon_id,
                vertex_ids: polygon.vertex_ids.clone(),
                missing_vertex_ids,
            });
            skipped_polygon_count += 1;
            continue;
        }

        if let Some(surface_id) = render_side.surface_id {
            surface_ids.insert(surface_id);
        }

        for vertex_index in 1..(polygon.vertex_ids.len() - 1) {
            let triangle_vertex_offsets = if render_side.counter_clockwise_culled {
                [0, vertex_index + 1, vertex_index]
            } else {
                [0, vertex_index, vertex_index + 1]
            };
            triangles.push(PreparedPolygonSetRenderTriangle {
                polygon_id: *polygon_id,
                surface_id: render_side.surface_id,
                first_vertex: positions.len() / 3,
            });

            for polygon_vertex_offset in triangle_vertex_offsets {
                let vertex_id = polygon.vertex_ids[polygon_vertex_offset];
                let vertex = vertex_array
                    .vertices
                    .get(&vertex_id)
                    .expect("missing vertices were filtered before triangulation");
                let render_position = convert_ac_vector_to_render_space(vertex.origin);
                let render_normal = convert_ac_vector_to_render_space(vertex.normal);
                positions.extend([render_position.x, render_position.y, render_position.z]);
                normals.extend([
                    scale_normal_component(render_normal.x, render_side.normal_scale),
                    scale_normal_component(render_normal.y, render_side.normal_scale),
                    scale_normal_component(render_normal.z, render_side.normal_scale),
                ]);

                let uv_index = render_side.uv_indices[polygon_vertex_offset] as usize;
                let uv = vertex.uvs.get(uv_index);
                uvs.extend([uv.map_or(0.0, |uv| uv.u), uv.map_or(0.0, |uv| uv.v)]);
                bounds = Some(expand_bounds(bounds, render_position));
            }
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

struct PolygonRenderSide<'a> {
    surface_id: Option<i16>,
    uv_indices: &'a [u8],
    normal_scale: f32,
    counter_clockwise_culled: bool,
}

const STIPPLING_NO_POS: u8 = 0x04;
const CULL_MODE_COUNTER_CLOCKWISE: i32 = 3;

fn derive_environment_polygon_render_side(polygon: &Polygon) -> Option<PolygonRenderSide<'_>> {
    if (polygon.stippling & STIPPLING_NO_POS) != 0 {
        return None;
    }
    if polygon.pos_uv_indices.len() != polygon.vertex_ids.len() {
        return None;
    }
    let counter_clockwise_culled = polygon.sides_type == CULL_MODE_COUNTER_CLOCKWISE;
    Some(PolygonRenderSide {
        surface_id: normalize_surface_id(polygon.pos_surface),
        uv_indices: &polygon.pos_uv_indices,
        normal_scale: if counter_clockwise_culled { -1.0 } else { 1.0 },
        counter_clockwise_culled,
    })
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

fn convert_ac_vector_to_render_space(vector: holtburger_common::Vector3) -> PreparedVec3 {
    PreparedVec3 {
        x: vector.x,
        y: vector.z,
        z: if vector.y == 0.0 { 0.0 } else { -vector.y },
    }
}

fn scale_normal_component(value: f32, scale: f32) -> f32 {
    let scaled = value * scale;
    if scaled == 0.0 { 0.0 } else { scaled }
}

fn normalize_surface_id(surface_id: i16) -> Option<i16> {
    (surface_id > 0).then_some(surface_id)
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

fn classify_landblock(
    cell_landblock: Option<&CellLandblockFact>,
    landblock_info: Option<&LandblockInfoFact>,
) -> LandblockClassification {
    match (cell_landblock, landblock_info) {
        (Some(cell_landblock), Some(landblock_info))
            if cell_landblock.all_heights_zero
                && landblock_info.num_env_cells > 0
                && landblock_info.building_count == 0 =>
        {
            LandblockClassification::Dungeon
        }
        _ => LandblockClassification::Outdoor,
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
    use holtburger_dat::{
        DatError, DatFileType, FileMetadata, HbaReader, ResourceKey, ResourceSource,
    };
    use std::collections::HashMap;
    use std::path::PathBuf;
    use std::sync::{Arc, Mutex};

    #[derive(Debug)]
    struct CountingSource {
        files: HashMap<(String, u32), Vec<u8>>,
        reads: Mutex<HashMap<(String, u32), usize>>,
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

    fn minimal_cell_landblock_bytes(landblock_id: u32) -> Vec<u8> {
        minimal_cell_landblock_bytes_with_height(landblock_id, 0)
    }

    fn minimal_cell_landblock_bytes_with_height(landblock_id: u32, height: u8) -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&landblock_id.to_le_bytes());
        bytes.extend_from_slice(&0u32.to_le_bytes());
        for _ in 0..81 {
            bytes.extend_from_slice(&0u16.to_le_bytes());
        }
        bytes.extend(std::iter::repeat_n(height, 81));
        bytes.push(0);
        bytes
    }

    fn minimal_landblock_info_bytes(landblock_info_id: u32) -> Vec<u8> {
        minimal_landblock_info_bytes_with_env_cells(landblock_info_id, 0)
    }

    fn repo_assets_hba_path() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../dats/assets.hba")
    }

    fn minimal_landblock_info_bytes_with_env_cells(
        landblock_info_id: u32,
        num_cells: u32,
    ) -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&landblock_info_id.to_le_bytes());
        bytes.extend_from_slice(&num_cells.to_le_bytes());
        bytes.extend_from_slice(&0u32.to_le_bytes());
        bytes.extend_from_slice(&0u16.to_le_bytes());
        bytes.extend_from_slice(&0u16.to_le_bytes());
        bytes
    }

    #[test]
    fn env_cell_helpers_derive_contiguous_landblock_namespace_ids() {
        assert_eq!(derive_landblock_info_id(0xda55012e), 0xda55fffe);
        assert_eq!(derive_first_env_cell_id(0xda55ffff, 0), None);
        assert_eq!(derive_first_env_cell_id(0xda55ffff, 3), Some(0xda550100));
        assert_eq!(derive_landblock_env_cell_id(0xda55ffff, 2), 0xda550102);
    }

    #[test]
    fn env_cell_asset_assembly_does_not_read_landblock_pack_roots() {
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
    fn terrain_asset_assembly_reads_only_cell_landblock_root() {
        let landblock_id = 0x0102ffff;
        let landblock_info_id = 0x0102fffe;
        let source = Arc::new(CountingSource::new(HashMap::from([(
            (EOR_CELL_NAMESPACE.to_string(), landblock_id),
            minimal_cell_landblock_bytes_with_height(landblock_id, 1),
        )])));
        let repository = ContentRepository::from_mounts(vec![source.clone()]);

        let asset =
            LandblockTerrainAssetAssembler::new().assemble_landblock(&repository, landblock_id);

        assert_eq!(asset.landblock_id, landblock_id);
        assert!(asset.cell_landblock.is_some());
        assert!(asset.terrain_mesh.is_some());
        assert_eq!(source.read_count(EOR_CELL_NAMESPACE, landblock_id), 1);
        assert_eq!(source.read_count(EOR_CELL_NAMESPACE, landblock_info_id), 0);
    }

    #[test]
    fn building_shell_asset_assembly_does_not_read_terrain_or_env_cells() {
        let source_path = repo_assets_hba_path();
        if !source_path.is_file() {
            eprintln!(
                "skipping building shell asset assembly test; missing repo-local {}",
                source_path.display()
            );
            return;
        }

        let archive = HbaReader::open(&source_path).expect("repo assets.hba should open");
        let Some((landblock_id, landblock_info_id, landblock_info_bytes)) =
            find_landblock_info_with_buildings_fixture(&archive)
        else {
            panic!("repo assets.hba should contain a LandblockInfo with buildings");
        };
        let source = Arc::new(CountingSource::new(HashMap::from([(
            (EOR_CELL_NAMESPACE.to_string(), landblock_info_id),
            landblock_info_bytes,
        )])));
        let repository = ContentRepository::from_mounts(vec![source.clone()]);

        let asset = LandblockBuildingShellsAssetAssembler::new()
            .assemble_landblock(&repository, landblock_id);

        assert_eq!(asset.landblock_id, landblock_id);
        assert_eq!(asset.landblock_info_id, landblock_info_id);
        assert!(!asset.shells.is_empty());
        assert!(
            asset
                .shells
                .iter()
                .all(|shell| shell.source_asset_id.starts_with("setup-model/")
                    || shell.source_asset_id.starts_with("gfx-obj/"))
        );
        assert_eq!(source.read_count(EOR_CELL_NAMESPACE, landblock_info_id), 1);
        assert_eq!(source.read_count(EOR_CELL_NAMESPACE, landblock_id), 0);
        for index in 0..16 {
            assert_eq!(
                source.read_count(
                    EOR_CELL_NAMESPACE,
                    derive_landblock_env_cell_id(landblock_id, index)
                ),
                0
            );
        }
    }

    #[test]
    fn scene_asset_assembly_does_not_read_terrain_or_environment_geometry() {
        let source_path = repo_assets_hba_path();
        if !source_path.is_file() {
            eprintln!(
                "skipping scene asset assembly test; missing repo-local {}",
                source_path.display()
            );
            return;
        }

        let archive = HbaReader::open(&source_path).expect("repo assets.hba should open");
        let Some((landblock_id, landblock_info_id, landblock_info_bytes, env_cell_files)) =
            find_landblock_scene_fixture(&archive)
        else {
            panic!("repo assets.hba should contain a LandblockInfo with env cells");
        };
        let mut files = HashMap::from([(
            (EOR_CELL_NAMESPACE.to_string(), landblock_info_id),
            landblock_info_bytes,
        )]);
        files.extend(
            env_cell_files
                .into_iter()
                .map(|(env_cell_id, bytes)| ((EOR_CELL_NAMESPACE.to_string(), env_cell_id), bytes)),
        );
        let source = Arc::new(CountingSource::new(files));
        let repository = ContentRepository::from_mounts(vec![source.clone()]);

        let asset =
            LandblockSceneAssetAssembler::new().assemble_landblock(&repository, landblock_id);

        assert_eq!(asset.landblock_id, landblock_id);
        assert!(!asset.env_cells.is_empty());
        assert_eq!(source.read_count(EOR_CELL_NAMESPACE, landblock_info_id), 1);
        assert_eq!(source.read_count(EOR_CELL_NAMESPACE, landblock_id), 0);
        assert_eq!(source.read_count(EOR_PORTAL_NAMESPACE, 0x0d000000), 0);
        assert!(
            source
                .reads
                .lock()
                .expect("counting source reads should not be poisoned")
                .keys()
                .all(|(namespace, file_id)| namespace != EOR_PORTAL_NAMESPACE
                    || (*file_id >> 24 != 0x0d && *file_id >> 24 != 0x0e))
        );
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

    fn find_landblock_scene_fixture(
        archive: &HbaReader,
    ) -> Option<(u32, u32, Vec<u8>, Vec<(u32, Vec<u8>)>)> {
        for entry in archive
            .entries()
            .collect::<holtburger_dat::Result<Vec<_>>>()
            .ok()?
        {
            if entry.namespace_id().ok()?.as_str() != EOR_CELL_NAMESPACE {
                continue;
            }
            if DatFileType::from_id(entry.file_id) != DatFileType::LandblockInfo {
                continue;
            }
            let landblock_info_bytes = archive
                .get_file_in_namespace(EOR_CELL_NAMESPACE, entry.file_id)
                .ok()?;
            let landblock_info = LandblockInfo::unpack(&landblock_info_bytes).ok()?;
            if landblock_info.num_cells == 0 {
                continue;
            }
            let landblock_id = entry.file_id | 1;
            let env_cell_files = (0..landblock_info.num_cells)
                .filter_map(|index| {
                    let env_cell_id = derive_landblock_env_cell_id(landblock_id, index);
                    archive
                        .get_file_in_namespace(EOR_CELL_NAMESPACE, env_cell_id)
                        .ok()
                        .map(|bytes| (env_cell_id, bytes))
                })
                .collect::<Vec<_>>();
            if env_cell_files.is_empty() {
                continue;
            }
            return Some((
                landblock_id,
                entry.file_id,
                landblock_info_bytes,
                env_cell_files,
            ));
        }
        None
    }

    fn find_landblock_info_with_buildings_fixture(
        archive: &HbaReader,
    ) -> Option<(u32, u32, Vec<u8>)> {
        for entry in archive
            .entries()
            .collect::<holtburger_dat::Result<Vec<_>>>()
            .ok()?
        {
            if entry.namespace_id().ok()?.as_str() != EOR_CELL_NAMESPACE {
                continue;
            }
            if DatFileType::from_id(entry.file_id) != DatFileType::LandblockInfo {
                continue;
            }
            let landblock_info_bytes = archive
                .get_file_in_namespace(EOR_CELL_NAMESPACE, entry.file_id)
                .ok()?;
            let landblock_info = LandblockInfo::unpack(&landblock_info_bytes).ok()?;
            if landblock_info.buildings.is_empty() {
                continue;
            }
            return Some((entry.file_id | 1, entry.file_id, landblock_info_bytes));
        }
        None
    }

    #[test]
    fn pack_static_outdoor_assembly_reuses_loaded_landblock_roots() {
        let landblock_id = 0x0102ffff;
        let landblock_info_id = 0x0102fffe;
        let source = Arc::new(CountingSource::new(HashMap::from([
            (
                (EOR_CELL_NAMESPACE.to_string(), landblock_id),
                minimal_cell_landblock_bytes(landblock_id),
            ),
            (
                (EOR_CELL_NAMESPACE.to_string(), landblock_info_id),
                minimal_landblock_info_bytes(landblock_info_id),
            ),
        ])));
        let repository = ContentRepository::from_mounts(vec![source.clone()]);

        let pack = LandblockPackAssembler::new().assemble_landblock(&repository, landblock_id);

        assert!(pack.cell_landblock.is_some());
        assert!(pack.landblock_info.is_some());
        assert!(pack.outdoor_scene.is_none());
        assert_eq!(source.read_count(EOR_CELL_NAMESPACE, landblock_id), 1);
        assert_eq!(source.read_count(EOR_CELL_NAMESPACE, landblock_info_id), 1);
    }

    #[test]
    fn dungeon_classification_requires_zero_heights_env_cells_and_no_buildings() {
        let cell = CellLandblockFact {
            id: 0x0102ffff,
            has_objects: false,
            grid_size: LANDBLOCK_GRID_SIZE,
            tile_size: LANDBLOCK_TILE_SIZE,
            terrain_types: vec![0; 81],
            heights: vec![0.0; 81],
            min_height: 0.0,
            max_height: 0.0,
            all_heights_zero: true,
        };
        let info = LandblockInfoFact {
            id: 0x0102fffe,
            first_env_cell_id: Some(0x01020100),
            num_env_cells: 2,
            object_count: 0,
            building_count: 0,
            pack_mask: 0,
            restrictions: Vec::new(),
        };

        assert_eq!(
            classify_landblock(Some(&cell), Some(&info)),
            LandblockClassification::Dungeon
        );
    }

    #[test]
    fn dungeon_pack_skips_outdoor_static_scene_assembly() {
        let landblock_id = 0x0102ffff;
        let landblock_info_id = 0x0102fffe;
        let source = Arc::new(CountingSource::new(HashMap::from([
            (
                (EOR_CELL_NAMESPACE.to_string(), landblock_id),
                minimal_cell_landblock_bytes(landblock_id),
            ),
            (
                (EOR_CELL_NAMESPACE.to_string(), landblock_info_id),
                minimal_landblock_info_bytes_with_env_cells(landblock_info_id, 2),
            ),
        ])));
        let repository = ContentRepository::from_mounts(vec![source.clone()]);

        let pack = LandblockPackAssembler::new().assemble_landblock(&repository, landblock_id);

        assert_eq!(pack.classification, LandblockClassification::Dungeon);
        assert!(pack.outdoor_scene.is_none());
        assert!(pack.prepared.outdoor_static_instances.is_empty());
        assert!(
            pack.diagnostics
                .omissions
                .iter()
                .any(|omission| omission.role == "landblock-static"
                    && omission.reason == "proven-dungeon-landblock")
        );
        assert_eq!(source.read_count(EOR_CELL_NAMESPACE, landblock_id), 1);
        assert_eq!(source.read_count(EOR_CELL_NAMESPACE, landblock_info_id), 1);
    }

    #[test]
    fn nonzero_height_landblock_does_not_skip_outdoor_static_scene_assembly() {
        let landblock_id = 0x0102ffff;
        let landblock_info_id = 0x0102fffe;
        let source = Arc::new(CountingSource::new(HashMap::from([
            (
                (EOR_CELL_NAMESPACE.to_string(), landblock_id),
                minimal_cell_landblock_bytes_with_height(landblock_id, 1),
            ),
            (
                (EOR_CELL_NAMESPACE.to_string(), landblock_info_id),
                minimal_landblock_info_bytes_with_env_cells(landblock_info_id, 2),
            ),
        ])));
        let repository = ContentRepository::from_mounts(vec![source]);

        let pack = LandblockPackAssembler::new().assemble_landblock(&repository, landblock_id);

        assert_eq!(pack.classification, LandblockClassification::Outdoor);
        assert!(pack.diagnostics.omissions.iter().all(|omission| {
            omission.role != "landblock-static" || omission.reason != "proven-dungeon-landblock"
        }));
        assert!(pack.diagnostics.errors.iter().any(|error| {
            error.role == "landblock-static" && error.error_code == "asset-decode-failed"
        }));
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
    fn terrain_spatial_items_are_quad_level_with_triangle_metadata() {
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
        let items = build_terrain_quad_spatial_items(cell.id, &mesh);

        assert_eq!(items.len(), 64);
        assert_eq!(
            items[0].id,
            "landblock-pack/0102ffff/spatial/terrain-quad/00/00"
        );
        assert_eq!(items[0].kind, PreparedSpatialItemKind::Terrain);
        assert_eq!(
            items[0].bounds,
            PreparedAabb {
                min: PreparedVec3 {
                    x: 0.0,
                    y: 0.0,
                    z: -24.0,
                },
                max: PreparedVec3 {
                    x: 24.0,
                    y: 10.0,
                    z: 0.0,
                },
            }
        );
        assert_eq!(
            items[0].metadata,
            PreparedSpatialItemMetadata::TerrainQuad(PreparedTerrainQuadSpatialMetadata {
                row: 0,
                col: 0,
                quad_index: 0,
                triangle_indices: [0, 1],
            })
        );

        assert_eq!(
            items[63].metadata,
            PreparedSpatialItemMetadata::TerrainQuad(PreparedTerrainQuadSpatialMetadata {
                row: 7,
                col: 7,
                quad_index: 63,
                triangle_indices: [126, 127],
            })
        );
    }
}
