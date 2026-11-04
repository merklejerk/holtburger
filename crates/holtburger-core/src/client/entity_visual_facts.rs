//! Accepted visual facts common to live presentation and owned inspection snapshots.

use holtburger_common::properties::WorldObjectExt as _;
use holtburger_world::{EntityAppearance, entity::Entity};

/// Borrowed facts from one retained entity; snapshot consumers clone appearance at capture.
pub(super) struct EntityVisualFacts<'a> {
    /// Accepted setup model identity.
    pub setup_did: u32,
    /// Ordered semantic appearance substitutions, without transport normalization.
    pub appearance: &'a EntityAppearance,
    /// World-owned effective scale, including authoritative script scale.
    pub scale: f32,
    /// Whole-object translucency validated before narrowing to renderer precision.
    pub translucency: f32,
}

/// Preserve distinct failure meaning for live errors and unavailable preview outcomes.
pub(super) enum EntityVisualFactsError {
    MissingSetup,
    InvalidTranslucency,
}

/// Read accepted appearance facts independently of placement, live motion or preview idle policy.
pub(super) fn entity_visual_facts(
    entity: &Entity,
) -> Result<EntityVisualFacts<'_>, EntityVisualFactsError> {
    let setup_did = entity
        .csetup_id()
        .ok_or(EntityVisualFactsError::MissingSetup)?
        .0;
    let translucency = entity.translucency().unwrap_or(0.0);
    if !translucency.is_finite() || !(0.0..=1.0).contains(&translucency) {
        return Err(EntityVisualFactsError::InvalidTranslucency);
    }
    Ok(EntityVisualFacts {
        setup_did,
        appearance: &entity.appearance,
        scale: entity.scale.effective(),
        translucency: translucency as f32,
    })
}
