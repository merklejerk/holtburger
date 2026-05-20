use std::io::Cursor;

use binrw::BinRead;
use holtburger_dat::landblock::{CellLandblock, LandblockInfo};
use holtburger_dat::{EOR_CELL_NAMESPACE, ResourceKey};

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
}
