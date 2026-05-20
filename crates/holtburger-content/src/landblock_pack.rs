use std::collections::HashSet;
use std::io::Cursor;

use binrw::BinRead;
use holtburger_dat::file_type::{CellStruct, EnvCell, Environment};
use holtburger_dat::graphics::{Frame, Polygon};
use holtburger_dat::landblock::{CellLandblock, LandblockInfo};
use holtburger_dat::physics::BspNode;
use holtburger_dat::{EOR_CELL_NAMESPACE, EOR_PORTAL_NAMESPACE, ResourceKey};

use crate::static_outdoor_scene::{StaticOutdoorScene, StaticOutdoorSceneAssembler};
use crate::{ContentRepository, normalize_landblock_id};

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
    pub diagnostics: LandblockPackSourceDiagnostics,
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
    pub interior_cells: Vec<PreparedInteriorCell>,
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
    pub static_object_count: usize,
    pub render_geometry: PreparedPolygonSetRenderGeometry,
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
pub struct LandblockPackSourceDiagnostics {
    pub source_records: Vec<SourceRecordDiagnostic>,
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
pub struct SourceLoadError {
    pub namespace: &'static str,
    pub file_id: u32,
    pub role: &'static str,
    pub error_code: &'static str,
    pub detail: String,
}

#[derive(Debug, Default, Clone, Copy)]
pub struct LandblockPackAssembler;

impl LandblockPackAssembler {
    pub fn new() -> Self {
        Self
    }

    pub fn assemble_landblock(
        &self,
        content: &ContentRepository,
        raw_landblock_id: u32,
    ) -> LandblockPack {
        let landblock_id = normalize_landblock_id(raw_landblock_id);
        let landblock_info_id = derive_landblock_info_id(landblock_id);
        let mut diagnostics = LandblockPackSourceDiagnostics::default();
        let cell_landblock = load_cell_landblock_fact(content, landblock_id, &mut diagnostics);
        let landblock_info = load_landblock_info_fact(content, landblock_id, &mut diagnostics);
        let interiors = landblock_info
            .as_ref()
            .map(|info| load_interior_facts(content, landblock_id, info, &mut diagnostics))
            .unwrap_or_default();
        let prepared = prepare_landblock_facts(cell_landblock.as_ref(), &interiors);
        let outdoor_scene =
            match StaticOutdoorSceneAssembler::new().assemble_landblock(content, landblock_id) {
                Ok(scene) => Some(scene),
                Err(error) => {
                    diagnostics.errors.push(SourceLoadError {
                        namespace: EOR_CELL_NAMESPACE,
                        file_id: landblock_id,
                        role: "outdoor-static-scene",
                        error_code: "asset-decode-failed",
                        detail: format!(
                            "Could not assemble outdoor static scene 0x{landblock_id:08X}: {error}"
                        ),
                    });
                    None
                }
            };
        let classification = classify_landblock(cell_landblock.as_ref(), landblock_info.as_ref());

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

pub fn derive_landblock_info_id(raw_landblock_id: u32) -> u32 {
    normalize_landblock_id(raw_landblock_id) & 0xffff_fffe
}

pub fn derive_first_env_cell_id(raw_landblock_id: u32, num_env_cells: u32) -> Option<u32> {
    (num_env_cells > 0).then_some((normalize_landblock_id(raw_landblock_id) & 0xffff_0000) | 0x0100)
}

pub fn derive_landblock_env_cell_id(raw_landblock_id: u32, index: u32) -> u32 {
    ((normalize_landblock_id(raw_landblock_id) & 0xffff_0000) | 0x0100) + index
}

fn load_cell_landblock_fact(
    content: &ContentRepository,
    landblock_id: u32,
    diagnostics: &mut LandblockPackSourceDiagnostics,
) -> Option<CellLandblockFact> {
    let resource = match content.read_resource(ResourceKey::new(EOR_CELL_NAMESPACE, landblock_id)) {
        Ok(resource) => resource,
        Err(error) => {
            diagnostics.source_records.push(SourceRecordDiagnostic {
                namespace: EOR_CELL_NAMESPACE,
                file_id: landblock_id,
                role: "cell-landblock",
                status: SourceRecordStatus::Missing,
            });
            diagnostics.errors.push(SourceLoadError {
                namespace: EOR_CELL_NAMESPACE,
                file_id: landblock_id,
                role: "cell-landblock",
                error_code: "asset-read-failed",
                detail: format!("Could not read CellLandblock 0x{landblock_id:08X}: {error}"),
            });
            return None;
        }
    };

    match CellLandblock::unpack(&resource.bytes) {
        Ok(landblock) => {
            diagnostics.source_records.push(SourceRecordDiagnostic {
                namespace: EOR_CELL_NAMESPACE,
                file_id: landblock_id,
                role: "cell-landblock",
                status: SourceRecordStatus::Loaded,
            });
            Some(CellLandblockFact::from_landblock(&landblock))
        }
        Err(error) => {
            diagnostics.source_records.push(SourceRecordDiagnostic {
                namespace: EOR_CELL_NAMESPACE,
                file_id: landblock_id,
                role: "cell-landblock",
                status: SourceRecordStatus::DecodeFailed,
            });
            diagnostics.errors.push(SourceLoadError {
                namespace: EOR_CELL_NAMESPACE,
                file_id: landblock_id,
                role: "cell-landblock",
                error_code: "asset-decode-failed",
                detail: format!("Could not decode CellLandblock 0x{landblock_id:08X}: {error}"),
            });
            None
        }
    }
}

fn load_landblock_info_fact(
    content: &ContentRepository,
    landblock_id: u32,
    diagnostics: &mut LandblockPackSourceDiagnostics,
) -> Option<LandblockInfoFact> {
    let landblock_info_id = derive_landblock_info_id(landblock_id);
    let resource = match content
        .read_resource(ResourceKey::new(EOR_CELL_NAMESPACE, landblock_info_id))
    {
        Ok(resource) => resource,
        Err(error) => {
            diagnostics.source_records.push(SourceRecordDiagnostic {
                namespace: EOR_CELL_NAMESPACE,
                file_id: landblock_info_id,
                role: "landblock-info",
                status: SourceRecordStatus::Missing,
            });
            diagnostics.errors.push(SourceLoadError {
                namespace: EOR_CELL_NAMESPACE,
                file_id: landblock_info_id,
                role: "landblock-info",
                error_code: "asset-read-failed",
                detail: format!("Could not read LandblockInfo 0x{landblock_info_id:08X}: {error}"),
            });
            return None;
        }
    };

    match LandblockInfo::read(&mut Cursor::new(resource.bytes)) {
        Ok(info) => {
            diagnostics.source_records.push(SourceRecordDiagnostic {
                namespace: EOR_CELL_NAMESPACE,
                file_id: landblock_info_id,
                role: "landblock-info",
                status: SourceRecordStatus::Loaded,
            });
            Some(LandblockInfoFact::from_info(&info, landblock_id))
        }
        Err(error) => {
            diagnostics.source_records.push(SourceRecordDiagnostic {
                namespace: EOR_CELL_NAMESPACE,
                file_id: landblock_info_id,
                role: "landblock-info",
                status: SourceRecordStatus::DecodeFailed,
            });
            diagnostics.errors.push(SourceLoadError {
                namespace: EOR_CELL_NAMESPACE,
                file_id: landblock_info_id,
                role: "landblock-info",
                error_code: "asset-decode-failed",
                detail: format!(
                    "Could not decode LandblockInfo 0x{landblock_info_id:08X}: {error}"
                ),
            });
            None
        }
    }
}

fn load_interior_facts(
    content: &ContentRepository,
    landblock_id: u32,
    landblock_info: &LandblockInfoFact,
    diagnostics: &mut LandblockPackSourceDiagnostics,
) -> LandblockInteriorFacts {
    let mut env_cells = Vec::new();
    for index in 0..landblock_info.num_env_cells {
        let env_cell_id = derive_landblock_env_cell_id(landblock_id, index);
        if let Some(env_cell) = load_env_cell_fact(content, env_cell_id, diagnostics) {
            env_cells.push(env_cell);
        }
    }

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
            load_environment_fact(content, environment_id, &selected_ids, diagnostics)
        })
        .collect();

    LandblockInteriorFacts {
        env_cells,
        environments,
    }
}

fn load_env_cell_fact(
    content: &ContentRepository,
    env_cell_id: u32,
    diagnostics: &mut LandblockPackSourceDiagnostics,
) -> Option<EnvCellFact> {
    let resource = match content.read_resource(ResourceKey::new(EOR_CELL_NAMESPACE, env_cell_id)) {
        Ok(resource) => resource,
        Err(error) => {
            diagnostics.source_records.push(SourceRecordDiagnostic {
                namespace: EOR_CELL_NAMESPACE,
                file_id: env_cell_id,
                role: "env-cell",
                status: SourceRecordStatus::Missing,
            });
            diagnostics.errors.push(SourceLoadError {
                namespace: EOR_CELL_NAMESPACE,
                file_id: env_cell_id,
                role: "env-cell",
                error_code: "asset-read-failed",
                detail: format!("Could not read EnvCell 0x{env_cell_id:08X}: {error}"),
            });
            return None;
        }
    };

    match EnvCell::unpack(&mut Cursor::new(resource.bytes)) {
        Ok(env_cell) => {
            diagnostics.source_records.push(SourceRecordDiagnostic {
                namespace: EOR_CELL_NAMESPACE,
                file_id: env_cell_id,
                role: "env-cell",
                status: SourceRecordStatus::Loaded,
            });
            Some(EnvCellFact::from_env_cell(env_cell_id, &env_cell))
        }
        Err(error) => {
            diagnostics.source_records.push(SourceRecordDiagnostic {
                namespace: EOR_CELL_NAMESPACE,
                file_id: env_cell_id,
                role: "env-cell",
                status: SourceRecordStatus::DecodeFailed,
            });
            diagnostics.errors.push(SourceLoadError {
                namespace: EOR_CELL_NAMESPACE,
                file_id: env_cell_id,
                role: "env-cell",
                error_code: "asset-decode-failed",
                detail: format!("Could not decode EnvCell 0x{env_cell_id:08X}: {error}"),
            });
            None
        }
    }
}

fn load_environment_fact(
    content: &ContentRepository,
    environment_id: u32,
    selected_cell_structure_ids: &[u32],
    diagnostics: &mut LandblockPackSourceDiagnostics,
) -> Option<EnvironmentFact> {
    let resource =
        match content.read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, environment_id)) {
            Ok(resource) => resource,
            Err(error) => {
                diagnostics.source_records.push(SourceRecordDiagnostic {
                    namespace: EOR_PORTAL_NAMESPACE,
                    file_id: environment_id,
                    role: "environment",
                    status: SourceRecordStatus::Missing,
                });
                diagnostics.errors.push(SourceLoadError {
                    namespace: EOR_PORTAL_NAMESPACE,
                    file_id: environment_id,
                    role: "environment",
                    error_code: "asset-read-failed",
                    detail: format!("Could not read Environment 0x{environment_id:08X}: {error}"),
                });
                return None;
            }
        };

    match Environment::unpack(&mut Cursor::new(resource.bytes)) {
        Ok(environment) => {
            diagnostics.source_records.push(SourceRecordDiagnostic {
                namespace: EOR_PORTAL_NAMESPACE,
                file_id: environment_id,
                role: "environment",
                status: SourceRecordStatus::Loaded,
            });
            Some(EnvironmentFact::from_environment(
                &environment,
                selected_cell_structure_ids,
                diagnostics,
            ))
        }
        Err(error) => {
            diagnostics.source_records.push(SourceRecordDiagnostic {
                namespace: EOR_PORTAL_NAMESPACE,
                file_id: environment_id,
                role: "environment",
                status: SourceRecordStatus::DecodeFailed,
            });
            diagnostics.errors.push(SourceLoadError {
                namespace: EOR_PORTAL_NAMESPACE,
                file_id: environment_id,
                role: "environment",
                error_code: "asset-decode-failed",
                detail: format!("Could not decode Environment 0x{environment_id:08X}: {error}"),
            });
            None
        }
    }
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
                        portal_id: format!("env-cell/{env_cell_id:08x}/portal/{source_index:02x}"),
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
        diagnostics: &mut LandblockPackSourceDiagnostics,
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

fn prepare_landblock_facts(
    cell_landblock: Option<&CellLandblockFact>,
    interiors: &LandblockInteriorFacts,
) -> LandblockPreparedFacts {
    LandblockPreparedFacts {
        terrain_mesh: cell_landblock.map(build_terrain_mesh),
        interior_cells: build_prepared_interior_cells(interiors),
    }
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

        cells.push(PreparedInteriorCell {
            env_cell_id: env_cell.env_cell_id,
            environment_id,
            cell_structure_id,
            local_placement: env_cell.local_placement.clone(),
            surface_ids: env_cell.surface_ids.clone(),
            portals: env_cell.portals.clone(),
            static_object_count: env_cell.static_objects.len(),
            render_geometry,
        });
    }
    cells
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn env_cell_helpers_derive_contiguous_landblock_namespace_ids() {
        assert_eq!(derive_landblock_info_id(0xda55012e), 0xda55fffe);
        assert_eq!(derive_first_env_cell_id(0xda55ffff, 0), None);
        assert_eq!(derive_first_env_cell_id(0xda55ffff, 3), Some(0xda550100));
        assert_eq!(derive_landblock_env_cell_id(0xda55ffff, 2), 0xda550102);
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
}
