//! Model-free remote body preparation for the explicitly selected navigation policy.

use std::sync::Arc;

use anyhow::{Context, Result};
use holtburger_common::properties::WorldObjectPropertyAccessors as _;
use holtburger_common::{
    Guid,
    properties::{PropertyDataId, PropertyFloat},
};
use holtburger_content::{ColliderScale, ContentDecodeCache, NavigationContent};
use holtburger_world::{
    DynamicBodyCollisionDefinition, DynamicPhysicalBodyDefinition, EffectiveEntityPhysicsState,
    EntityCollisionParticipation, EntityCollisionReportPolicy, EntityContactResponse,
    LocalIntegrationDemand, LocalPhysicalDemand, LocalTargetDemand, PhysicalBodyResponsePolicy,
    PhysicalElasticity, PhysicalFriction, PhysicalRestitution, PhysicalSurfaceMotion,
    PreparedEntityTargetGeometry, SpatialBodyId, WorldState,
};

/// Captured authoritative facts needed by an envelope; appearance/WCID are deliberately irrelevant.
#[derive(Debug, Clone, PartialEq)]
pub(super) struct NavigationBodyFacts {
    pub guid: Guid,
    pub instance_sequence: u16,
    /// Absence is retained as a preparation failure until authoritative hydration supplies it.
    pub setup_did: Option<u32>,
    pub physics: EffectiveEntityPhysicsState,
    pub object_scale: f32,
    pub is_contact_character: bool,
    /// Authoritative response coefficients; absent values use the shared retail defaults.
    pub friction: Option<f32>,
    pub elasticity: Option<f32>,
}

impl NavigationBodyFacts {
    /// Captures positive integration demand without requiring model/template hydration.
    pub fn capture(world: &WorldState, guid: Guid) -> Option<Self> {
        let entity = world.entities.get(guid)?;
        let physics = entity.physics.effective();
        if guid == world.player.guid
            || entity.attachment().is_some()
            || !physics.supports_local_simulation()
            || physics.integration_eligibility
                != holtburger_world::EntityIntegrationEligibility::Eligible
        {
            return None;
        }
        let body_id = SpatialBodyId::Entity(guid);
        let body = world.scene.body(body_id)?;
        body.authoritative_pose?;
        let is_contact_character =
            super::collision::is_contact_character(world.player.guid, entity);
        if !(is_contact_character
            || physics.response.gravity
            || physics.dynamic_collision.missile
            || world.body_has_simulatable_projection_basis(body_id)
            || body.has_pose_reconciliation_work())
        {
            return None;
        }
        Some(Self {
            guid,
            instance_sequence: entity.instance_sequence(),
            physics,
            setup_did: entity
                .properties
                .get_data_prop(PropertyDataId::Setup)
                .map(|did| did.0),
            object_scale: entity.scale.effective(),
            is_contact_character,
            friction: super::collision::property_f32(&entity.properties, PropertyFloat::Friction),
            elasticity: super::collision::property_f32(
                &entity.properties,
                PropertyFloat::Elasticity,
            ),
        })
    }

    /// Scale is joined from the live world at installation, as in full physical preparation.
    pub fn definition_eq(&self, other: &Self) -> bool {
        self.guid == other.guid
            && self.instance_sequence == other.instance_sequence
            && self.setup_did == other.setup_did
            && self.physics == other.physics
            && self.is_contact_character == other.is_contact_character
            && super::collision::option_f32_eq(self.friction, other.friction)
            && super::collision::option_f32_eq(self.elasticity, other.elasticity)
    }

    pub const fn demand(&self) -> LocalPhysicalDemand {
        LocalPhysicalDemand {
            target: LocalTargetDemand::Absent,
            integration: LocalIntegrationDemand::Eligible,
        }
    }
}

/// One selected scene/bootstrap source and a shared cache of decoded setup facts only.
pub(super) struct NavigationClientSource {
    pub content: Arc<NavigationContent>,
    setups: ContentDecodeCache,
}

impl NavigationClientSource {
    pub fn new(content: Arc<NavigationContent>) -> Self {
        Self {
            content,
            setups: ContentDecodeCache::new(),
        }
    }

    /// Reuses retail's authored sphere/dummy resolution without following model or script links.
    pub fn prepare_body(
        &self,
        facts: NavigationBodyFacts,
    ) -> Result<DynamicPhysicalBodyDefinition> {
        let setup_id = facts
            .setup_did
            .context("remote navigation body has no setup DID")?;
        let setup = self
            .setups
            .setup_model(self.content.bootstrap(), setup_id)?;
        let spheres = crate::resolve_setup_physical_spheres(&setup, 1.0)?;
        let friction = facts
            .friction
            .map(PhysicalFriction::new)
            .transpose()?
            .unwrap_or(PhysicalFriction::DEFAULT);
        let elasticity = facts
            .elasticity
            .map(PhysicalElasticity::new)
            .transpose()?
            .unwrap_or(PhysicalElasticity::DEFAULT);
        let response_policy = PhysicalBodyResponsePolicy {
            restitution: if facts.physics.response.inelastic {
                PhysicalRestitution::Inelastic
            } else {
                PhysicalRestitution::Elastic(elasticity)
            },
            friction,
            surface_motion: PhysicalSurfaceMotion::Stable,
            align_path: facts.physics.response.align_path,
        };
        Ok(DynamicPhysicalBodyDefinition {
            movement: crate::physical_body_definition::setup_movement_definition(
                &setup,
                spheres,
                facts.physics,
                response_policy,
            )?,
            response_policy,
            entity_collision: DynamicBodyCollisionDefinition {
                player_collision: None,
                contact_response: if facts.is_contact_character {
                    EntityContactResponse::Character(facts.physics.integration_eligibility)
                } else {
                    EntityContactResponse::Obstacle
                },
                target_geometry: Arc::new(PreparedEntityTargetGeometry {
                    setup_radius: setup.radius,
                    setup_height: setup.height,
                    collision_animations: Default::default(),
                    physics_bsp_parts: Vec::new(),
                    fallback_setup_did: setup_id,
                    fallback_shapes: Vec::new(),
                    fallback_scale: ColliderScale::uniform(1.0)?,
                }),
                dynamic_collision: holtburger_world::EntityDynamicCollisionPolicy {
                    target: EntityCollisionParticipation::Suppressed,
                    accepts_peer_reports: false,
                    ..facts.physics.dynamic_collision
                },
                reporting: EntityCollisionReportPolicy {
                    enabled: false,
                    as_environment: false,
                },
                uses_physics_bsp: false,
                elasticity,
                default_animation_available: false,
                default_script_available: false,
            },
        })
    }
}

#[cfg(test)]
mod tests;
