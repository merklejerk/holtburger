use std::collections::BTreeSet;

use anyhow::{Context, Result, bail};
use holtburger_content::{
    GeneratedSceneryAsset, LandblockAsset, LandblockInteriorSystemAsset, LandblockPlacement,
    LandblockTerrain, normalize_landblock_id,
};
use holtburger_core::{ContentAsset, ContentAssetRequest, ContentAssetRuntime};
use serde::{Deserialize, Serialize};

pub(crate) const LANDBLOCK_SOURCE_BATCH_BINARY_MAGIC: &[u8; 4] = b"HBLB";
const LANDBLOCK_SOURCE_BATCH_BINARY_HEADER_LEN: usize = 12;

/// A scene layer that the app-local landblock source boundary can request.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum LandblockSourceLayer {
    Terrain,
    Buildings,
    Objects,
    Generated,
    EnvCells,
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

    fn contains(&self, layer: LandblockSourceLayer) -> bool {
        self.layers.contains(&layer)
    }

    pub(crate) fn layers(&self) -> impl Iterator<Item = LandblockSourceLayer> + '_ {
        self.layers.iter().copied()
    }
}

/// The app-local projection of one exact landblock source acquisition.
#[derive(Debug, Clone)]
pub(crate) struct LoadedLandblockSourceBatch {
    landblock_id: u32,
    landblock: Option<LandblockAsset>,
    terrain: TerrainSourceProjection,
    buildings: Option<Vec<OutdoorStaticResident>>,
    objects: Option<Vec<OutdoorStaticResident>>,
    generated: Option<Vec<OutdoorStaticResident>>,
    interior: InteriorSourceProjection,
}

/// Distinguishes an unrequested terrain layer from a requested but absent DAT source.
#[derive(Debug, Clone)]
enum TerrainSourceProjection {
    Unrequested,
    Requested(Option<LandblockTerrain>),
}

/// Distinguishes an unrequested EnvCell layer from a requested but absent interior.
#[derive(Debug, Clone)]
enum InteriorSourceProjection {
    Unrequested,
    Requested(Option<LandblockInteriorSystemAsset>),
}

/// App-local presentation input for one outdoor static resident.
#[derive(Debug, Clone)]
pub(crate) struct OutdoorStaticResident {
    pub(crate) id: String,
    pub(crate) source_did: u32,
    pub(crate) placement: LandblockPlacement,
    pub(crate) scale: holtburger_common::Vector3,
}

impl LoadedLandblockSourceBatch {
    pub(crate) fn landblock_id(&self) -> u32 {
        self.landblock_id
    }

    pub(crate) fn landblock(&self) -> Option<&LandblockAsset> {
        self.landblock.as_ref()
    }

    pub(crate) fn terrain(&self) -> Result<Option<&LandblockTerrain>> {
        match &self.terrain {
            TerrainSourceProjection::Requested(terrain) => Ok(terrain.as_ref()),
            TerrainSourceProjection::Unrequested => {
                bail!("landblock source batch did not project Terrain")
            }
        }
    }

    pub(crate) fn buildings(&self) -> Result<&[OutdoorStaticResident]> {
        self.buildings
            .as_deref()
            .context("landblock source batch did not project Buildings")
    }

    pub(crate) fn objects(&self) -> Result<&[OutdoorStaticResident]> {
        self.objects
            .as_deref()
            .context("landblock source batch did not project Objects")
    }

    pub(crate) fn generated(&self) -> Result<&[OutdoorStaticResident]> {
        self.generated
            .as_deref()
            .context("landblock source batch did not project Generated")
    }

    pub(crate) fn interior(&self) -> Result<Option<&LandblockInteriorSystemAsset>> {
        match &self.interior {
            InteriorSourceProjection::Requested(interior) => Ok(interior.as_ref()),
            InteriorSourceProjection::Unrequested => {
                bail!("landblock source batch did not project EnvCells")
            }
        }
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

/// Serializes one closed landblock batch whose nested records stay independently decodable.
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
    bytes.extend(u32::try_from(manifest_bytes.len())?.to_le_bytes());
    bytes.extend(u32::try_from(total_length)?.to_le_bytes());
    bytes.extend(manifest_bytes);
    for record in records {
        bytes.extend(record.bytes);
    }
    Ok(bytes)
}

/// Loads one shared shallow foundation and only the explicitly requested deep products.
pub(crate) async fn load_landblock_source_batch(
    runtime: &ContentAssetRuntime,
    request: LandblockSourceBatchRequest,
) -> Result<LoadedLandblockSourceBatch> {
    let asset = runtime
        .load(ContentAssetRequest::Landblock(request.landblock_id))
        .await
        .with_context(|| {
            format!(
                "Could not load shallow landblock foundation for 0x{:08X}",
                request.landblock_id
            )
        })?;
    let ContentAsset::Landblock(landblock) = asset else {
        bail!("landblock foundation request returned a different content asset");
    };
    let generated = if request.contains(LandblockSourceLayer::Generated) && landblock.is_some() {
        let generated_asset = runtime
            .load(ContentAssetRequest::GeneratedScenery(request.landblock_id))
            .await
            .with_context(|| {
                format!(
                    "Could not resolve generated scenery for 0x{:08X}",
                    request.landblock_id
                )
            })?;
        let ContentAsset::GeneratedScenery(generated) = generated_asset else {
            bail!("generated scenery request returned a different content asset");
        };
        generated
    } else {
        None
    };
    let interior = if request.contains(LandblockSourceLayer::EnvCells) && landblock.is_some() {
        let interior_asset = runtime
            .load(ContentAssetRequest::LandblockInteriorSystem(
                request.landblock_id,
            ))
            .await
            .with_context(|| {
                format!(
                    "Could not resolve EnvCells for 0x{:08X}",
                    request.landblock_id
                )
            })?;
        let ContentAsset::LandblockInteriorSystem(interior) = interior_asset else {
            bail!("EnvCell request returned a different content asset");
        };
        interior.as_deref().cloned()
    } else {
        None
    };

    project_landblock_source_batch(
        landblock.as_deref(),
        generated.as_deref(),
        interior.as_ref(),
        &request,
    )
}

fn project_landblock_source_batch(
    landblock: Option<&LandblockAsset>,
    generated: Option<&GeneratedSceneryAsset>,
    interior: Option<&LandblockInteriorSystemAsset>,
    request: &LandblockSourceBatchRequest,
) -> Result<LoadedLandblockSourceBatch> {
    if let Some(landblock) = landblock
        && landblock.landblock_id != request.landblock_id
    {
        bail!(
            "content runtime returned landblock 0x{:08X} for source batch 0x{:08X}",
            landblock.landblock_id,
            request.landblock_id
        );
    }
    if let Some(generated) = generated
        && generated.landblock_id != request.landblock_id
    {
        bail!(
            "content runtime returned generated landblock 0x{:08X} for source batch 0x{:08X}",
            generated.landblock_id,
            request.landblock_id
        );
    }
    if let Some(interior) = interior
        && interior.landblock_id != request.landblock_id
    {
        bail!(
            "content runtime returned interior landblock 0x{:08X} for source batch 0x{:08X}",
            interior.landblock_id,
            request.landblock_id
        );
    }

    Ok(LoadedLandblockSourceBatch {
        landblock_id: request.landblock_id,
        landblock: landblock.cloned(),
        terrain: if request.contains(LandblockSourceLayer::Terrain) {
            TerrainSourceProjection::Requested(landblock.map(|asset| asset.terrain.clone()))
        } else {
            TerrainSourceProjection::Unrequested
        },
        buildings: request.contains(LandblockSourceLayer::Buildings).then(|| {
            landblock
                .into_iter()
                .flat_map(|asset| &asset.buildings)
                .map(|building| OutdoorStaticResident {
                    id: format!(
                        "landblock-static/{:08x}/building/{:04x}/{:08x}",
                        request.landblock_id, building.source_index, building.source_did
                    ),
                    source_did: building.source_did,
                    placement: building.placement,
                    scale: unit_scale(),
                })
                .collect()
        }),
        objects: request.contains(LandblockSourceLayer::Objects).then(|| {
            landblock
                .into_iter()
                .flat_map(|asset| &asset.explicit_objects)
                .map(|object| OutdoorStaticResident {
                    id: format!(
                        "landblock-static/{:08x}/object/{:04x}/{:08x}",
                        request.landblock_id, object.source_index, object.source_did
                    ),
                    source_did: object.source_did,
                    placement: object.placement,
                    scale: unit_scale(),
                })
                .collect()
        }),
        generated: request.contains(LandblockSourceLayer::Generated).then(|| {
            generated
                .into_iter()
                .flat_map(|asset| &asset.objects)
                .map(|object| OutdoorStaticResident {
                    id: format!(
                        "landblock-static/{:08x}/generated/scene/{:08x}/cell/{:02x}/template/{:04x}/{:08x}",
                        request.landblock_id,
                        object.identity.scene_id,
                        object.identity.terrain_index,
                        object.identity.template_index,
                        object.source_did
                    ),
                    source_did: object.source_did,
                    placement: object.placement,
                    scale: holtburger_common::Vector3::new(
                        object.scale,
                        object.scale,
                        object.scale,
                    ),
                })
                .collect()
        }),
        interior: if request.contains(LandblockSourceLayer::EnvCells) {
            InteriorSourceProjection::Requested(interior.cloned())
        } else {
            InteriorSourceProjection::Unrequested
        },
    })
}

fn unit_scale() -> holtburger_common::Vector3 {
    holtburger_common::Vector3::new(1.0, 1.0, 1.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn batch_request_preserves_the_exact_requested_layer_set() {
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
        assert_eq!(
            request.layers().collect::<Vec<_>>(),
            vec![
                LandblockSourceLayer::Terrain,
                LandblockSourceLayer::Objects,
                LandblockSourceLayer::Generated,
            ]
        );
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
            landblock: None,
            terrain: TerrainSourceProjection::Unrequested,
            buildings: None,
            objects: None,
            generated: None,
            interior: InteriorSourceProjection::Unrequested,
        };

        assert!(batch.objects().is_err());
    }

    #[test]
    fn missing_generated_projection_is_rejected() {
        let batch = LoadedLandblockSourceBatch {
            landblock_id: 0x0c78_ffff,
            landblock: None,
            terrain: TerrainSourceProjection::Unrequested,
            buildings: None,
            objects: None,
            generated: None,
            interior: InteriorSourceProjection::Unrequested,
        };

        assert!(batch.generated().is_err());
    }

    #[test]
    fn landblock_asset_projects_every_requested_transport_layer_once() {
        let request = LandblockSourceBatchRequest::new(
            0x0c78_ffff,
            [
                LandblockSourceLayer::Terrain,
                LandblockSourceLayer::Buildings,
                LandblockSourceLayer::Objects,
                LandblockSourceLayer::Generated,
                LandblockSourceLayer::EnvCells,
            ],
        )
        .expect("complete landblock source request should be valid");
        let projected = project_landblock_source_batch(None, None, None, &request)
            .expect("every requested transport projection should be present");

        assert!(projected.terrain().is_ok());
        assert!(projected.buildings().is_ok());
        assert!(projected.objects().is_ok());
        assert!(projected.generated().is_ok());
        assert!(matches!(projected.interior(), Ok(None)));
    }
}
