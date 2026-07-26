use std::collections::BTreeSet;

use anyhow::{Context, Result, bail};
use holtburger_content::{
    LandblockOutdoorAsset, LandblockOutdoorAssetRequest, LandblockOutdoorStaticMember,
    PreparedContentSourceDiagnostics, PreparedStaticInstanceKind, StaticOutdoorSceneSourceFamilies,
    TerrainGridSource, normalize_landblock_id,
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

/// The app-local projection of one exact outdoor source acquisition.
#[derive(Debug, Clone)]
pub(crate) struct LoadedLandblockSourceBatch {
    landblock_id: u32,
    diagnostics: PreparedContentSourceDiagnostics,
    terrain: TerrainSourceProjection,
    buildings: Option<Vec<LandblockOutdoorStaticMember>>,
    objects: Option<Vec<LandblockOutdoorStaticMember>>,
    generated: Option<Vec<LandblockOutdoorStaticMember>>,
}

/// Distinguishes an unrequested terrain layer from a requested but absent DAT source.
#[derive(Debug, Clone)]
enum TerrainSourceProjection {
    Unrequested,
    Requested(Option<TerrainGridSource>),
}

impl LoadedLandblockSourceBatch {
    pub(crate) fn landblock_id(&self) -> u32 {
        self.landblock_id
    }

    pub(crate) fn diagnostics(&self) -> &PreparedContentSourceDiagnostics {
        &self.diagnostics
    }

    pub(crate) fn terrain(&self) -> Result<Option<&TerrainGridSource>> {
        match &self.terrain {
            TerrainSourceProjection::Requested(terrain) => Ok(terrain.as_ref()),
            TerrainSourceProjection::Unrequested => {
                bail!("landblock source batch did not project Terrain")
            }
        }
    }

    pub(crate) fn buildings(&self) -> Result<&[LandblockOutdoorStaticMember]> {
        self.buildings
            .as_deref()
            .context("landblock source batch did not project Buildings")
    }

    pub(crate) fn objects(&self) -> Result<&[LandblockOutdoorStaticMember]> {
        self.objects
            .as_deref()
            .context("landblock source batch did not project Objects")
    }

    pub(crate) fn generated(&self) -> Result<&[LandblockOutdoorStaticMember]> {
        self.generated
            .as_deref()
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

/// Loads exact outdoor source families and projects them into app-local transport layers.
pub(crate) async fn load_landblock_source_batch(
    runtime: &ContentAssetRuntime,
    request: LandblockSourceBatchRequest,
) -> Result<LoadedLandblockSourceBatch> {
    let source_request = LandblockOutdoorAssetRequest::new(
        request.landblock_id,
        request.contains(LandblockSourceLayer::Terrain),
        StaticOutdoorSceneSourceFamilies::new(
            request.contains(LandblockSourceLayer::Objects),
            request.contains(LandblockSourceLayer::Buildings),
            request.contains(LandblockSourceLayer::Generated),
        ),
    );
    let asset = runtime
        .load(ContentAssetRequest::LandblockOutdoor(source_request))
        .await
        .with_context(|| {
            format!(
                "Could not load outdoor source batch for 0x{:08X}",
                request.landblock_id
            )
        })?;
    let ContentAsset::LandblockOutdoor { outdoor, .. } = asset else {
        bail!("outdoor source batch request returned a different content asset");
    };
    project_landblock_source_batch(*outdoor, &request)
}

fn project_landblock_source_batch(
    outdoor: LandblockOutdoorAsset,
    request: &LandblockSourceBatchRequest,
) -> Result<LoadedLandblockSourceBatch> {
    if outdoor.landblock_id != request.landblock_id {
        bail!(
            "content runtime returned landblock 0x{:08X} for source batch 0x{:08X}",
            outdoor.landblock_id,
            request.landblock_id
        );
    }

    let mut batch = LoadedLandblockSourceBatch {
        landblock_id: outdoor.landblock_id,
        diagnostics: outdoor.diagnostics,
        terrain: if request.contains(LandblockSourceLayer::Terrain) {
            TerrainSourceProjection::Requested(outdoor.cell_landblock.map(|fact| fact.terrain))
        } else {
            TerrainSourceProjection::Unrequested
        },
        buildings: request
            .contains(LandblockSourceLayer::Buildings)
            .then(Vec::new),
        objects: request
            .contains(LandblockSourceLayer::Objects)
            .then(Vec::new),
        generated: request
            .contains(LandblockSourceLayer::Generated)
            .then(Vec::new),
    };
    for member in outdoor.statics {
        let target = match member.instance.kind {
            PreparedStaticInstanceKind::Building => batch.buildings.as_mut(),
            PreparedStaticInstanceKind::Scenery => batch.objects.as_mut(),
            PreparedStaticInstanceKind::GeneratedScenery => batch.generated.as_mut(),
            PreparedStaticInstanceKind::IndoorStatic => None,
        };
        if let Some(target) = target {
            target.push(member);
        }
    }

    Ok(batch)
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
            diagnostics: PreparedContentSourceDiagnostics::default(),
            terrain: TerrainSourceProjection::Unrequested,
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
            terrain: TerrainSourceProjection::Unrequested,
            buildings: None,
            objects: None,
            generated: None,
        };

        assert!(batch.generated().is_err());
    }

    #[test]
    fn outdoor_asset_projects_every_requested_transport_layer_once() {
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
        let asset = LandblockOutdoorAsset {
            landblock_id: 0x0c78_ffff,
            cell_landblock: None,
            statics: Vec::new(),
            building_transition_apertures: Vec::new(),
            diagnostics: PreparedContentSourceDiagnostics::default(),
        };

        let projected = project_landblock_source_batch(asset, &request)
            .expect("every requested transport projection should be present");

        assert!(projected.terrain().is_ok());
        assert!(projected.buildings().is_ok());
        assert!(projected.objects().is_ok());
        assert!(projected.generated().is_ok());
    }
}
