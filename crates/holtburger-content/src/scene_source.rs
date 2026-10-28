//! Storage-independent environment geometry consumed by scene residency and solving.

use crate::{LandblockCollisionAsset, LandblockSceneClass};
use anyhow::Result;

/// Complete scene products at the fidelity selected by the frontend. Missing coverage is
/// unavailable, while a loaded scene may deliberately omit furniture/object colliders.
pub trait SceneContentSource: Send + Sync + 'static {
    /// Classify an authored owner before geographic demand expands.
    fn load_scene_class(&self, owner: u32) -> Result<Option<LandblockSceneClass>>;
    /// Load one normalized owner, including its terrain, containment, and colliders.
    fn load_collision(&self, owner: u32) -> Result<Option<LandblockCollisionAsset>>;
}
