//! Exact bootstrap/scene selection for consumers of prepared navigation products.
//!
//! Directory precedence and executable layout are frontend policy. Once a location is selected,
//! this module opens that source once and projects either stored or HBA-backed empty-room scenes.

use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

use anyhow::{Context, Result};
use thiserror::Error;

use crate::{
    ContentDecodeCache, ContentRepository, LandblockAsset, LandblockAssetAssembler,
    LandblockCollisionAsset, LandblockInteriorSystemAssembler, LandblockRoomShellAssembler,
    LandblockSceneClass, NavigationSceneSource, TerrainCollisionSurface,
    navigation_bundle::{BOOTSTRAP_FILE, NAVIGATION_FILE, NavigationArchive},
};

/// Invalid shape of an explicitly selected navigation content location.
#[derive(Debug, Error)]
pub enum NavigationContentSelectionError {
    /// All automatic locations were absent; existing but malformed locations are errors instead.
    #[error("no navigation content found in discovery locations: {paths:?}")]
    NotDiscovered {
        /// Automatic candidates in the application's declared precedence order.
        paths: Vec<PathBuf>,
    },
    /// A selected directory must contain both companions; other archives are not fallbacks.
    #[error("navigation content directory is missing {}", missing.display())]
    MissingCompanion { missing: PathBuf },
    /// Direct file input supports HBA projection, not retail DAT decoding.
    #[error("expected a prepared content directory or an HBA file at {}", path.display())]
    UnsupportedLocation { path: PathBuf },
}

enum NavigationStorage {
    /// Positioned reads and shared immutable room templates.
    Prepared(NavigationSceneSource),
    /// Existing parsed-record cache for on-demand HBA projection.
    Hba(Box<ContentDecodeCache>),
}

/// One selected bootstrap repository and its matching navigation scene source.
pub struct NavigationContent {
    bootstrap: Arc<ContentRepository>,
    scenes: NavigationStorage,
}

impl NavigationContent {
    /// Tries app-ordered automatic locations, skipping only absent paths. Existing malformed
    /// content must be repaired, rather than silently replaced by a lower-priority installation.
    pub fn discover_candidates(paths: impl IntoIterator<Item = PathBuf>) -> Result<Self> {
        let paths = paths.into_iter().collect::<Vec<_>>();
        for path in &paths {
            match path.symlink_metadata() {
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Ok(_) => return Self::open(path),
                Err(error) => {
                    return Err(error).with_context(|| {
                        format!("could not inspect navigation content {}", path.display())
                    });
                }
            }
        }
        Err(NavigationContentSelectionError::NotDiscovered { paths }.into())
    }

    /// Opens exactly a generated directory or HBA file, without global discovery or layering.
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref();
        let metadata = path
            .metadata()
            .with_context(|| format!("could not inspect navigation content {}", path.display()))?;
        if metadata.is_dir() {
            let bootstrap = path.join(BOOTSTRAP_FILE);
            let navigation = path.join(NAVIGATION_FILE);
            for companion in [&bootstrap, &navigation] {
                if !companion.try_exists()? {
                    return Err(NavigationContentSelectionError::MissingCompanion {
                        missing: companion.clone(),
                    }
                    .into());
                }
            }
            let archive = NavigationArchive::open_for_bootstrap(&navigation, &bootstrap)
                .with_context(|| {
                    format!(
                        "could not open prepared navigation {}",
                        navigation.display()
                    )
                })?;
            // Keep the index: motion/creation bootstrap readers enumerate records from this exact
            // repository. from_mounts or a second discovery would lose that contract.
            let bootstrap = Arc::new(ContentRepository::from_hba_path(&bootstrap)?);
            return Ok(Self {
                bootstrap,
                scenes: NavigationStorage::Prepared(NavigationSceneSource::new(archive)),
            });
        }
        if metadata.is_file()
            && path
                .extension()
                .and_then(|s| s.to_str())
                .is_some_and(|ext| ext.eq_ignore_ascii_case("hba"))
        {
            return Ok(Self {
                bootstrap: Arc::new(ContentRepository::from_hba_path(path)?),
                scenes: NavigationStorage::Hba(Box::default()),
            });
        }
        Err(NavigationContentSelectionError::UnsupportedLocation { path: path.into() }.into())
    }

    /// Exact indexed repository used for shared bootstrap, catalogs, and model-free setup facts.
    pub fn bootstrap(&self) -> &Arc<ContentRepository> {
        &self.bootstrap
    }

    /// Resolves scene demand using the selected source's canonical owner classification.
    pub fn load_scene_class(&self, owner: u32) -> Result<Option<LandblockSceneClass>> {
        match &self.scenes {
            NavigationStorage::Prepared(source) => source.load_scene_class(owner),
            NavigationStorage::Hba(cache) => Ok(self
                .load_foundation(cache, owner)?
                .map(|asset| asset.scene_class)),
        }
    }

    /// Loads identical room/terrain product types from prepared data or existing HBA projections.
    /// Neither path resolves object models, generated scenery, or animation collision geometry.
    pub fn load_collision(&self, owner: u32) -> Result<Option<LandblockCollisionAsset>> {
        match &self.scenes {
            NavigationStorage::Prepared(source) => source.load_collision(owner),
            NavigationStorage::Hba(cache) => {
                let Some(landblock) = self.load_foundation(cache, owner)? else {
                    return Ok(None);
                };
                let interior = LandblockInteriorSystemAssembler.assemble(
                    &self.bootstrap,
                    cache,
                    &landblock,
                )?;
                let terrain = match landblock.scene_class {
                    LandblockSceneClass::DungeonOnly => TerrainCollisionSurface::empty(),
                    LandblockSceneClass::OutdoorOnly | LandblockSceneClass::OutdoorWithEnvCells => {
                        TerrainCollisionSurface::from_terrain(&landblock.terrain)?
                    }
                };
                Ok(Some(LandblockCollisionAsset {
                    landblock_id: landblock.landblock_id,
                    terrain,
                    static_geometry: LandblockRoomShellAssembler.assemble(&landblock, &interior)?,
                }))
            }
        }
    }

    fn load_foundation(
        &self,
        cache: &ContentDecodeCache,
        owner: u32,
    ) -> Result<Option<LandblockAsset>> {
        let region = cache.active_region_data(&self.bootstrap)?;
        LandblockAssetAssembler.assemble(&self.bootstrap, cache, &region, owner)
    }
}

#[cfg(test)]
mod tests;
