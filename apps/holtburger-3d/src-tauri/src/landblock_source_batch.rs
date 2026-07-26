use std::collections::BTreeSet;

use anyhow::{Context, Result, bail};
use holtburger_content::{
    LandblockSceneLodAsset, LandblockSceneLodLayer, LandblockSceneLodLevel,
    LandblockSceneLodOutdoorBuildingsLayer, LandblockSceneLodOutdoorStaticLayer,
    LandblockSceneLodRequest, LandblockSceneLodTerrainLayer, PreparedContentSourceDiagnostics,
    normalize_landblock_id,
};
use holtburger_core::{ContentAsset, ContentAssetRequest, ContentAssetRuntime};
use serde::{Deserialize, Serialize};

pub(crate) const LANDBLOCK_SOURCE_BATCH_BINARY_MAGIC: &[u8; 4] = b"HBLB";
pub(crate) const LANDBLOCK_SOURCE_BATCH_BINARY_VERSION: u32 = 2;
const LANDBLOCK_SOURCE_BATCH_BINARY_HEADER_LEN: usize = 16;

/// A scene layer that the app-local landblock source boundary can request.
///
/// Env cells remain outside this outdoor source boundary and must not become an incidental batch
/// branch.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum LandblockSourceLayer {
    Terrain,
    Buildings,
    Objects,
    Generated,
}

impl LandblockSourceLayer {
    /// Highest cumulative scene LoD required to project this layer from content.
    pub fn required_lod_level(self) -> u8 {
        self.required_lod().as_u8()
    }

    fn required_lod(self) -> LandblockSceneLodLevel {
        match self {
            Self::Terrain => LandblockSceneLodLevel::Level0,
            Self::Buildings => LandblockSceneLodLevel::Level1,
            Self::Objects => LandblockSceneLodLevel::Level2,
            Self::Generated => LandblockSceneLodLevel::Level3,
        }
    }
}

/// The complete layer set needed for one landblock source acquisition.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct LandblockSourceBatchRequest {
    landblock_id: u32,
    layers: BTreeSet<LandblockSourceLayer>,
}

impl LandblockSourceBatchRequest {
    pub(crate) fn new(
        landblock_id: u32,
        layers: impl IntoIterator<Item = LandblockSourceLayer>,
    ) -> Result<Self> {
        let layers = layers.into_iter().collect::<BTreeSet<_>>();
        if layers.is_empty() {
            bail!("landblock source batches must request at least one layer");
        }
        Ok(Self {
            landblock_id: normalize_landblock_id(landblock_id),
            layers,
        })
    }

    fn maximum_lod(&self) -> LandblockSceneLodLevel {
        self.layers
            .iter()
            .map(|layer| layer.required_lod())
            .max_by_key(|level| level.as_u8())
            .expect("landblock source batches always contain at least one layer")
    }

    fn contains(&self, layer: LandblockSourceLayer) -> bool {
        self.layers.contains(&layer)
    }

    pub(crate) fn layers(&self) -> impl Iterator<Item = LandblockSourceLayer> + '_ {
        self.layers.iter().copied()
    }
}

/// The requested subset of a cumulative landblock scene asset.
///
/// Callers cannot reach unrequested source layers through this type, preserving independent layer
/// commit ownership after source acquisition.
#[derive(Debug, Clone)]
pub(crate) struct LoadedLandblockSourceBatch {
    landblock_id: u32,
    diagnostics: PreparedContentSourceDiagnostics,
    terrain: Option<LandblockSceneLodTerrainLayer>,
    buildings: Option<LandblockSceneLodOutdoorBuildingsLayer>,
    objects: Option<LandblockSceneLodOutdoorStaticLayer>,
    generated: Option<LandblockSceneLodOutdoorStaticLayer>,
}

impl LoadedLandblockSourceBatch {
    pub(crate) fn landblock_id(&self) -> u32 {
        self.landblock_id
    }

    pub(crate) fn diagnostics(&self) -> &PreparedContentSourceDiagnostics {
        &self.diagnostics
    }

    pub(crate) fn terrain(&self) -> Result<&LandblockSceneLodTerrainLayer> {
        self.terrain
            .as_ref()
            .context("landblock source batch did not project Terrain")
    }

    pub(crate) fn buildings(&self) -> Result<&LandblockSceneLodOutdoorBuildingsLayer> {
        self.buildings
            .as_ref()
            .context("landblock source batch did not project Buildings")
    }

    pub(crate) fn objects(&self) -> Result<&LandblockSceneLodOutdoorStaticLayer> {
        self.objects
            .as_ref()
            .context("landblock source batch did not project Objects")
    }

    pub(crate) fn generated(&self) -> Result<&LandblockSceneLodOutdoorStaticLayer> {
        self.generated
            .as_ref()
            .context("landblock source batch did not project Generated")
    }
}

/// One independently decodable source-record payload carried by a landblock batch.
pub(crate) struct LandblockSourceBatchRecord {
    pub(crate) layer: LandblockSourceLayer,
    pub(crate) bytes: Vec<u8>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LandblockSourceBatchManifest {
    transport: &'static str,
    version: u32,
    byte_order: &'static str,
    record_byte_offset_base: &'static str,
    landblock_id: String,
    requested_layers: Vec<LandblockSourceLayer>,
    records: Vec<LandblockSourceBatchRecordManifest>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LandblockSourceBatchRecordManifest {
    layer: LandblockSourceLayer,
    byte_offset: usize,
    byte_length: usize,
}

/// Serializes one versioned landblock batch whose nested records stay independently decodable.
pub(crate) fn serialize_landblock_source_batch(
    request: &LandblockSourceBatchRequest,
    records: Vec<LandblockSourceBatchRecord>,
) -> Result<Vec<u8>> {
    let record_layers = records
        .iter()
        .map(|record| record.layer)
        .collect::<BTreeSet<_>>();
    if record_layers != request.layers {
        bail!("landblock source batch records do not match the requested layer set");
    }

    let mut record_offset = 0;
    let mut manifest_records = Vec::with_capacity(records.len());
    for record in &records {
        manifest_records.push(LandblockSourceBatchRecordManifest {
            layer: record.layer,
            byte_offset: record_offset,
            byte_length: record.bytes.len(),
        });
        record_offset += record.bytes.len();
    }
    let manifest = LandblockSourceBatchManifest {
        transport: "holtburger-landblock-source-batch",
        version: LANDBLOCK_SOURCE_BATCH_BINARY_VERSION,
        byte_order: "little-endian",
        record_byte_offset_base: "record-data",
        landblock_id: format!("0x{:08x}", request.landblock_id),
        requested_layers: request.layers().collect(),
        records: manifest_records,
    };
    let mut manifest_bytes = serde_json::to_vec(&manifest)?;
    while !(LANDBLOCK_SOURCE_BATCH_BINARY_HEADER_LEN + manifest_bytes.len()).is_multiple_of(4) {
        manifest_bytes.push(b' ');
    }
    let total_length = LANDBLOCK_SOURCE_BATCH_BINARY_HEADER_LEN
        + manifest_bytes.len()
        + records
            .iter()
            .map(|record| record.bytes.len())
            .sum::<usize>();
    let mut bytes = Vec::with_capacity(total_length);
    bytes.extend(LANDBLOCK_SOURCE_BATCH_BINARY_MAGIC);
    bytes.extend(LANDBLOCK_SOURCE_BATCH_BINARY_VERSION.to_le_bytes());
    bytes.extend(u32::try_from(manifest_bytes.len())?.to_le_bytes());
    bytes.extend(u32::try_from(total_length)?.to_le_bytes());
    bytes.extend(manifest_bytes);
    for record in records {
        bytes.extend(record.bytes);
    }
    Ok(bytes)
}

/// Loads one cumulative scene asset and projects only the app-local layers requested by the caller.
pub(crate) async fn load_landblock_source_batch(
    runtime: &ContentAssetRuntime,
    request: LandblockSourceBatchRequest,
) -> Result<LoadedLandblockSourceBatch> {
    let asset = runtime
        .load(ContentAssetRequest::LandblockSceneLod(
            LandblockSceneLodRequest::outdoor(request.landblock_id, request.maximum_lod()),
        ))
        .await
        .with_context(|| {
            format!(
                "Could not load scene source batch for 0x{:08X} through Level {}",
                request.landblock_id,
                request.maximum_lod().as_u8()
            )
        })?;
    let ContentAsset::LandblockSceneLod { scene_lod, .. } = asset else {
        bail!("scene source batch request returned a non-scene-LoD asset");
    };
    project_landblock_source_batch(*scene_lod, &request)
}

fn project_landblock_source_batch(
    scene_lod: LandblockSceneLodAsset,
    request: &LandblockSourceBatchRequest,
) -> Result<LoadedLandblockSourceBatch> {
    if scene_lod.landblock_id != request.landblock_id {
        bail!(
            "content runtime returned landblock 0x{:08X} for source batch 0x{:08X}",
            scene_lod.landblock_id,
            request.landblock_id
        );
    }

    let mut batch = LoadedLandblockSourceBatch {
        landblock_id: scene_lod.landblock_id,
        diagnostics: scene_lod.diagnostics,
        terrain: None,
        buildings: None,
        objects: None,
        generated: None,
    };
    for layer in scene_lod.layers {
        match layer {
            LandblockSceneLodLayer::Terrain(layer)
                if request.contains(LandblockSourceLayer::Terrain) =>
            {
                batch.terrain = Some(layer);
            }
            LandblockSceneLodLayer::OutdoorBuildings(layer)
                if request.contains(LandblockSourceLayer::Buildings) =>
            {
                batch.buildings = Some(layer);
            }
            LandblockSceneLodLayer::OutdoorExplicitObjects(layer)
                if request.contains(LandblockSourceLayer::Objects) =>
            {
                batch.objects = Some(layer);
            }
            LandblockSceneLodLayer::OutdoorGeneratedScenery(layer)
                if request.contains(LandblockSourceLayer::Generated) =>
            {
                batch.generated = Some(layer);
            }
            _ => {}
        }
    }

    if request.contains(LandblockSourceLayer::Terrain) && batch.terrain.is_none() {
        bail!("source batch omitted requested Terrain layer");
    }
    if request.contains(LandblockSourceLayer::Buildings) && batch.buildings.is_none() {
        bail!("source batch omitted requested Buildings layer");
    }
    if request.contains(LandblockSourceLayer::Objects) && batch.objects.is_none() {
        bail!("source batch omitted requested Objects layer");
    }
    if request.contains(LandblockSourceLayer::Generated) && batch.generated.is_none() {
        bail!("source batch omitted requested Generated layer");
    }
    Ok(batch)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn batch_request_selects_the_highest_requested_cumulative_lod() {
        let request = LandblockSourceBatchRequest::new(
            0x0c78_0001,
            [
                LandblockSourceLayer::Terrain,
                LandblockSourceLayer::Objects,
                LandblockSourceLayer::Generated,
            ],
        )
        .expect("source batch should be valid");

        assert_eq!(request.landblock_id, 0x0c78_ffff);
        assert_eq!(request.maximum_lod(), LandblockSceneLodLevel::Level3);
    }

    #[test]
    fn empty_batch_request_is_rejected() {
        let error = LandblockSourceBatchRequest::new(0x0c78_ffff, [])
            .expect_err("source batch without layers should fail");

        assert!(error.to_string().contains("at least one layer"));
    }

    #[test]
    fn missing_object_projection_is_rejected() {
        let batch = LoadedLandblockSourceBatch {
            landblock_id: 0x0c78_ffff,
            diagnostics: PreparedContentSourceDiagnostics::default(),
            terrain: None,
            buildings: None,
            objects: None,
            generated: None,
        };

        assert!(batch.objects().is_err());
    }

    #[test]
    fn missing_generated_projection_is_rejected() {
        let batch = LoadedLandblockSourceBatch {
            landblock_id: 0x0c78_ffff,
            diagnostics: PreparedContentSourceDiagnostics::default(),
            terrain: None,
            buildings: None,
            objects: None,
            generated: None,
        };

        assert!(batch.generated().is_err());
    }

    #[test]
    fn level_three_asset_projects_every_requested_outdoor_layer_once() {
        let request = LandblockSourceBatchRequest::new(
            0x0c78_ffff,
            [
                LandblockSourceLayer::Terrain,
                LandblockSourceLayer::Buildings,
                LandblockSourceLayer::Objects,
                LandblockSourceLayer::Generated,
            ],
        )
        .expect("complete outdoor source request should be valid");
        let empty_static_layer = || LandblockSceneLodOutdoorStaticLayer {
            statics: Vec::new(),
            outdoor_bvh: None,
        };
        let asset = LandblockSceneLodAsset {
            landblock_id: 0x0c78_ffff,
            level: LandblockSceneLodLevel::Level3,
            layers: vec![
                LandblockSceneLodLayer::Terrain(LandblockSceneLodTerrainLayer {
                    terrain: None,
                    terrain_mesh: None,
                }),
                LandblockSceneLodLayer::OutdoorBuildings(LandblockSceneLodOutdoorBuildingsLayer {
                    statics: Vec::new(),
                    building_transition_apertures: Vec::new(),
                    outdoor_bvh: None,
                }),
                LandblockSceneLodLayer::OutdoorExplicitObjects(empty_static_layer()),
                LandblockSceneLodLayer::OutdoorGeneratedScenery(empty_static_layer()),
            ],
            diagnostics: PreparedContentSourceDiagnostics::default(),
        };

        let projected = project_landblock_source_batch(asset, &request)
            .expect("every requested Level 3 projection should be present");

        assert!(projected.terrain().is_ok());
        assert!(projected.buildings().is_ok());
        assert!(projected.objects().is_ok());
        assert!(projected.generated().is_ok());
    }
}
