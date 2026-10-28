//! Static navigation queries; application composition selects reference and scene inputs.

use std::sync::Arc;

use anyhow::Result;
use holtburger_dat::file_type::SetupModel;

use crate::{
    ContentDecodeCache, ContentRepository, LandblockCollisionAsset, LandblockSceneClass,
    NavigationSceneSource, SceneContentSource,
};

/// Authored setup facts used to prepare bodies without following visual model dependencies.
pub trait SetupContentSource: Send + Sync + 'static {
    /// Read authored setup facts without following appearance/model/script links.
    fn load_setup(&self, setup_id: u32) -> Result<Arc<SetupModel>>;
}

/// Prepared geometry and independently selected reference data; no discovery or profile policy.
pub struct PreparedNavigationSource {
    bootstrap: Arc<ContentRepository>,
    scenes: NavigationSceneSource,
    setups: ContentDecodeCache,
}

impl PreparedNavigationSource {
    /// Compose already opened inputs. A full or reduced reference archive has the same contract.
    pub fn new(bootstrap: Arc<ContentRepository>, scenes: NavigationSceneSource) -> Self {
        Self {
            bootstrap,
            scenes,
            setups: ContentDecodeCache::new(),
        }
    }
}

impl SceneContentSource for PreparedNavigationSource {
    fn load_scene_class(&self, owner: u32) -> Result<Option<LandblockSceneClass>> {
        self.scenes.load_scene_class(owner)
    }

    fn load_collision(&self, owner: u32) -> Result<Option<LandblockCollisionAsset>> {
        self.scenes.load_collision(owner)
    }
}

impl SetupContentSource for PreparedNavigationSource {
    fn load_setup(&self, setup_id: u32) -> Result<Arc<SetupModel>> {
        self.setups.setup_model(&self.bootstrap, setup_id)
    }
}
