//! Authored interaction cylinders, independent of collision/model preparation.

use std::collections::HashMap;

/// Unscaled setup dimensions used by ACE-compatible use and approach distance queries.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SetupDimensions {
    /// Horizontal setup radius; zero is valid for point-like objects.
    pub radius: f32,
    /// Vertical extent above the object's root; zero is valid for flat objects.
    pub height: f32,
}

/// Immutable reference facts for setup resources present in the selected content source.
#[derive(Debug, Clone, Default)]
pub struct SetupDimensionCatalog {
    /// Resolved setup DID to its unscaled interaction geometry.
    dimensions: HashMap<u32, SetupDimensions>,
}

impl SetupDimensionCatalog {
    /// Assembles parsed dimensions without loading linked models, animations, or scripts.
    pub fn new(entries: impl IntoIterator<Item = (u32, SetupDimensions)>) -> Self {
        Self {
            dimensions: entries.into_iter().collect(),
        }
    }

    /// Missing setup geometry remains unknown; callers must not invent a radius or height.
    pub fn get(&self, setup_did: u32) -> Option<SetupDimensions> {
        self.dimensions.get(&setup_did).copied()
    }
}
