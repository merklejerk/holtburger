use std::collections::BTreeSet;

use anyhow::{Context, Result, bail};
use holtburger_content::{
    LandblockSceneLodAsset, LandblockSceneLodLayer, LandblockSceneLodLevel,
    LandblockSceneLodOutdoorBuildingsLayer, LandblockSceneLodOutdoorStaticLayer,
    LandblockSceneLodRequest, LandblockSceneLodTerrainLayer, PreparedContentSourceDiagnostics,
    normalize_landblock_id,
};
use holtburger_core::{ContentAsset, ContentAssetRequest, ContentAssetRuntime};

/// A scene layer that the app-local landblock source boundary can request.
///
/// This deliberately excludes generated scenery and env cells: they are not runtime layers in this
/// plan and must not become incidental branches of the batch transport.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum LandblockSourceLayer {
    Terrain,
    Buildings,
    Objects,
}

impl LandblockSourceLayer {
    fn required_lod(self) -> LandblockSceneLodLevel {
        match self {
            Self::Terrain => LandblockSceneLodLevel::Level0,
            Self::Buildings => LandblockSceneLodLevel::Level1,
            Self::Objects => LandblockSceneLodLevel::Level2,
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
    pub(crate) fn single(landblock_id: u32, layer: LandblockSourceLayer) -> Self {
        Self {
            landblock_id: normalize_landblock_id(landblock_id),
            layers: BTreeSet::from([layer]),
        }
    }

    #[cfg(test)]
    fn new(
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

    #[cfg(test)]
    fn objects(&self) -> Result<&LandblockSceneLodOutdoorStaticLayer> {
        self.objects
            .as_ref()
            .context("landblock source batch did not project Objects")
    }
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
    Ok(batch)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn batch_request_selects_the_highest_requested_cumulative_lod() {
        let request = LandblockSourceBatchRequest::new(
            0x0c78_0001,
            [LandblockSourceLayer::Terrain, LandblockSourceLayer::Objects],
        )
        .expect("source batch should be valid");

        assert_eq!(request.landblock_id, 0x0c78_ffff);
        assert_eq!(request.maximum_lod(), LandblockSceneLodLevel::Level2);
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
        };

        assert!(batch.objects().is_err());
    }
}
