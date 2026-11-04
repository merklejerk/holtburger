//! Geometry identities and conservative bounds used by world selection queries.

use holtburger_common::{Guid, properties::WorldObjectExt as _};

use crate::{EntityPartChange, WorldState};

/// Content inputs that determine a unit-scale animated selection envelope.
/// Entity identity, placement, palette, and whole-object scale do not change these bounds.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct SelectionGeometry {
    /// Setup supplying the base parts and placement frames.
    pub setup_did: u32,
    /// Ordered geometry substitutions; later changes can replace earlier ones.
    pub part_changes: Vec<EntityPartChange>,
    /// Effective motion table, including the setup-authored default when applicable.
    pub motion_table_did: Option<u32>,
}

impl WorldState {
    /// Current geometry for independently placed selection candidates. Attachments use browser
    /// transforms and bypass host envelopes; entities without a setup cannot prepare bounds.
    pub fn selection_geometry(&self, guid: Guid) -> Option<SelectionGeometry> {
        let entity = self.entities.get(guid)?;
        if entity.attachment().is_some() {
            return None;
        }
        Some(SelectionGeometry {
            setup_did: entity.csetup_id()?.into(),
            part_changes: entity.appearance.part_changes.clone(),
            motion_table_did: self.effective_motion_table_id_for_guid(guid),
        })
    }
}

/// Unit-scale origin-centered sphere enclosing one effective animated visual profile.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SelectionEnvelope {
    radius: f32,
}

impl SelectionEnvelope {
    pub fn new(radius: f32) -> Result<Self, SelectionEnvelopeError> {
        if !radius.is_finite() || radius < 0.0 {
            return Err(SelectionEnvelopeError::InvalidRadius);
        }
        Ok(Self { radius })
    }

    /// Unit-scale radius; query placement applies current whole-object scale exactly once.
    pub const fn radius(self) -> f32 {
        self.radius
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum SelectionEnvelopeError {
    #[error("selection-envelope radius must be finite and nonnegative")]
    InvalidRadius,
}
