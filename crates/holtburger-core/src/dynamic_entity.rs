//! Shared dynamic-entity definitions, content preparation, and state reconciliation decisions.

use std::collections::BTreeSet;
use std::f32::consts::TAU;
use std::io::Cursor;
use std::sync::Arc;
use std::time::Instant;

use anyhow::Context;
use holtburger_common::position::WorldPosition;
use holtburger_common::properties::{
    ItemType, ObjectDescriptionFlag, PhysicsState, RadarBehavior, RadarColor, WeenieType,
};
use holtburger_common::{Guid, Placement, Quaternion, Vector3};
use holtburger_content::{
    ColliderScale, CollisionShape, ContentRepository, MaterialAppearanceInput,
    resolve_gfx_obj_collision_shape, resolve_setup_volume_collision_shapes,
};
use holtburger_dat::file_type::setup_model::{AnimationFrame, AnimationHookPayload};
use holtburger_dat::file_type::{
    Animation, AnimationPartChange, GfxObj, ObjDesc, PhysicsScript, SetupModel, SubPalette,
    TextureMapChange,
};
use holtburger_dat::{EOR_PORTAL_NAMESPACE, ResourceKey};
use holtburger_world::{
    CollisionReportOutcome, DynamicBodyCollisionDefinition, DynamicBodyKinematics,
    DynamicPhysicalBodyDefinition, EdgeProtection, EffectiveEntityPhysicsState, EntityAppearance,
    EntityPhysicalTransitionAction, EntityPhysicsSetupFacts, EntityPhysicsTransitionDecision,
    EntityPlacement, PhysicalBodyParticipation, PhysicalBodyReconfiguration,
    PhysicalBodyReconfigurationOutcome, PhysicalBodyResponsePolicy, PhysicalBodyState,
    PhysicalCollisionFilter, PhysicalElasticity, PhysicalFriction, PhysicalRestitution,
    PhysicalSphereSet, PhysicalSurfaceMotion, PreparedEntityBspPart, PreparedEntityTargetGeometry,
    RuntimeSpatialBodyView, SpatialBody, SpatialBodyId, SpatialMembership, SpatialScene,
    resolve_effective_entity_physics_state,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::physical_body_definition::{
    SetupPhysicalShapeError, resolve_setup_physical_spheres, retail_grounded_body_with_policy,
};

/// Stable game identity owned by either a client or Explorer registry.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DynamicEntityIdentity {
    /// Live instance identity allocated by the producer composition.
    pub guid: Guid,
    /// Static ACE template identity used to prepare the instance.
    pub wcid: u32,
    /// Producer-resolved display name.
    pub name: String,
    /// Gameplay category consumed by presentation and collision filtering.
    pub weenie_type: WeenieType,
}

/// Immutable content identities required by presentation and behavior resolution.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DynamicEntityContent {
    /// SetupModel identity that owns parts, volumes, and default behavior.
    pub setup_did: u32,
    /// Optional MotionTable identity that owns this entity's authored motion.
    ///
    /// Absent means the entity declares none of its own and falls back to the default its setup
    /// model installs, which is what retail's `CPhysicsObj::InitDefaults` does
    /// (`acclient.c:309099-309103`). Only 57 setups declare one, so the fallback is narrow but real.
    pub motion_table_did: Option<u32>,
    /// Optional SoundTable identity used by presentation effects.
    pub sound_table_did: Option<u32>,
    /// Optional PhysicsEffectTable identity used by presentation effects.
    pub physics_effect_table_did: Option<u32>,
}

/// Explicit producer-supplied live facts at entity creation.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DynamicEntityInitialState {
    /// Initial canonical world pose chosen by the producer.
    pub pose: WorldPosition,
    /// Initial world-space linear velocity.
    pub velocity: Vector3,
    /// Initial world-space linear acceleration.
    pub acceleration: Vector3,
    /// Initial world-space angular velocity.
    pub omega: Vector3,
    /// Producer clock instant used to initialize sampling state.
    pub created_at: Instant,
}

/// Retail radar presentation facts resolved at the producer boundary.
#[derive(Debug, Clone, Copy, PartialEq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DynamicEntityRadarFacts {
    /// Effective blip color after explicit property and semantic fallback resolution.
    pub blip_color: holtburger_common::properties::RadarColor,
    /// Authored `PropertyInt::ShowableOnRadar` (133).
    pub behavior: Option<holtburger_common::properties::RadarBehavior>,
    /// Authored `PropertyFloat::ObviousRadarRange` (104) in metres.
    pub obvious_range: Option<f32>,
}

impl DynamicEntityRadarFacts {
    /// Types raw authored radar properties and resolves the effective base blip color.
    ///
    /// Radar facts are cosmetic map presentation, so each field degrades independently rather than
    /// failing the entity: an unmappable value selects the producer's category fallback. Drops are
    /// logged rather than swallowed, because they mean the source authored
    /// something neither ACE's enums nor retail's blip table describe. The census over the shipped
    /// ACE World catalog found no such value, so a warning here indicates genuinely novel content.
    pub fn from_authored(
        context: impl std::fmt::Display,
        blip_color: Option<i32>,
        fallback_blip_color: RadarColor,
        behavior: Option<i32>,
        obvious_range: Option<f64>,
    ) -> Self {
        Self {
            blip_color: blip_color.map_or(fallback_blip_color, |value| {
                let typed = u8::try_from(value).ok().and_then(RadarColor::from_repr);
                if typed.is_none() {
                    log::warn!(
                        "{context} radar blip color {value} is outside RadarColor; using category fallback"
                    );
                }
                // Retail treats the authored Default value exactly like an absent property and
                // continues into its object-category checks (`acclient.c:252944-253021`).
                typed.filter(|color| *color != RadarColor::Default)
                    .unwrap_or(fallback_blip_color)
            }),
            behavior: behavior.and_then(|value| {
                let typed = u8::try_from(value).ok().and_then(RadarBehavior::from_repr);
                if typed.is_none() {
                    log::warn!(
                        "{context} showable-on-radar {value} is outside RadarBehavior; ignoring"
                    );
                }
                typed
            }),
            obvious_range: obvious_range.and_then(|value| {
                let typed = value as f32;
                if !typed.is_finite() || typed < 0.0 {
                    log::warn!(
                        "{context} obvious radar range {value} is not a usable distance; ignoring"
                    );
                    return None;
                }
                Some(typed)
            }),
        }
    }
}

/// Selects our semantic fallback color from live entity classification facts.
///
/// RETAIL DIVERGENCE: retail's absent-color fallback makes portals purple, vendors yellow,
/// attackable non-player creatures gold, and most remaining entities neutral
/// (`acclient.c:253001-253079`). We instead follow the CLI's more informative presentation policy:
/// players yellow, friendly creatures/vendors bright green, hostile creatures red, portals purple,
/// lifestones blue, mana stones cyan, and recognized objects white. Restoring retail would erase the
/// hostile/friendly distinction. This is client-only presentation that authored content cannot
/// observe; the shipped-catalog census found 8,739 of 10,883 radar-visible templates rely on a
/// fallback rather than an explicit `RadarBlipColor`.
pub fn semantic_radar_blip_color(
    flags: ObjectDescriptionFlag,
    item_type: Option<ItemType>,
) -> RadarColor {
    if flags.contains(ObjectDescriptionFlag::PLAYER) {
        return RadarColor::Yellow;
    }

    if item_type.is_some_and(|value| value.contains(ItemType::CREATURE)) {
        return if flags.contains(ObjectDescriptionFlag::ATTACKABLE) {
            RadarColor::Red
        } else {
            RadarColor::BrightGreen
        };
    }

    if flags.contains(ObjectDescriptionFlag::PORTAL)
        || item_type.is_some_and(|value| value.contains(ItemType::PORTAL))
    {
        RadarColor::Purple
    } else if flags.contains(ObjectDescriptionFlag::VENDOR) {
        RadarColor::BrightGreen
    } else if flags
        .intersects(ObjectDescriptionFlag::LIFE_STONE | ObjectDescriptionFlag::BIND_STONE)
        || item_type.is_some_and(|value| value.contains(ItemType::LIFE_STONE))
    {
        RadarColor::Blue
    } else if item_type.is_some_and(|value| value.contains(ItemType::MANA_STONE)) {
        RadarColor::Cyan
    } else if flags.contains(ObjectDescriptionFlag::HEALER) {
        RadarColor::Pink
    } else if flags.intersects(ObjectDescriptionFlag::DOOR | ObjectDescriptionFlag::STUCK)
        || item_type.is_some_and(|value| !value.is_empty())
    {
        RadarColor::White
    } else {
        RadarColor::Default
    }
}

/// Selects the same semantic fallback from the static facts available to Explorer.
pub fn explorer_radar_blip_color(
    weenie_type: WeenieType,
    item_type: Option<ItemType>,
    attackable: Option<bool>,
) -> RadarColor {
    match weenie_type {
        WeenieType::Portal | WeenieType::HousePortal => RadarColor::Purple,
        WeenieType::Vendor => RadarColor::BrightGreen,
        WeenieType::Creature
        | WeenieType::Cow
        | WeenieType::AI
        | WeenieType::Pet
        | WeenieType::CombatPet => {
            if attackable.unwrap_or(true) {
                RadarColor::Red
            } else {
                RadarColor::BrightGreen
            }
        }
        WeenieType::Admin | WeenieType::Sentinel => RadarColor::BrightGreen,
        WeenieType::LifeStone | WeenieType::AllegianceBindstone => RadarColor::Blue,
        WeenieType::ManaStone => RadarColor::Cyan,
        WeenieType::Door => RadarColor::White,
        WeenieType::Undef | WeenieType::Unknown31 => RadarColor::Default,
        _ => {
            let inferred = semantic_radar_blip_color(ObjectDescriptionFlag::empty(), item_type);
            if inferred == RadarColor::Default {
                RadarColor::White
            } else {
                inferred
            }
        }
    }
}

/// Constructor input whose scalar domains have not yet been validated.
#[derive(Debug, Clone, PartialEq)]
pub struct DynamicEntityDefinitionInput {
    /// Producer-owned instance and template identity.
    pub identity: DynamicEntityIdentity,
    /// Immutable DAT content identities.
    pub content: DynamicEntityContent,
    /// Lossless ordered material and part substitutions.
    pub appearance: EntityAppearance,
    /// Mutually exclusive initial world motion or parent-owned attachment.
    pub placement: EntityPlacement<DynamicEntityInitialState>,
    /// Uniform root scale before scalar validation.
    pub object_scale: f32,
    /// Optional authored friction; absence selects the ACE default.
    pub friction: Option<f32>,
    /// Optional authored elasticity; absence selects the ACE default.
    pub elasticity: Option<f32>,
    /// Optional authored linear speed cap retained for behavior integration.
    pub maximum_velocity: Option<f32>,
    /// Optional authored rotation speed retained for behavior integration.
    pub rotation_speed: Option<f32>,
    /// Producer-resolved radar presentation facts consumed by overhead-map blips.
    pub radar: DynamicEntityRadarFacts,
    /// Setup-resolved body height at this entity's scale before scalar validation.
    pub body_height: f32,
    /// Fully resolved semantic state and state-derived decisions.
    pub physics: EffectiveEntityPhysicsState,
}

/// Immutable definition facts sufficient to prepare physical geometry and response policy.
#[derive(Debug, Clone, PartialEq)]
pub struct DynamicEntityPhysicalPreparationInput {
    /// Weenie class identity retained in preparation errors.
    pub wcid: u32,
    /// Setup resource owning movement and target geometry.
    pub setup_did: u32,
    /// Lossless part substitutions that may replace target BSP geometry.
    pub appearance: EntityAppearance,
    /// Uniform root scale applied to movement and target geometry.
    pub object_scale: f32,
    /// Optional authored friction; absence selects the ACE default.
    pub friction: Option<f32>,
    /// Optional authored elasticity; absence selects the ACE default.
    pub elasticity: Option<f32>,
    /// Effective semantic physics decisions controlling solver participation.
    pub physics: EffectiveEntityPhysicsState,
    /// Semantic entity class retained by dynamic collision policy.
    pub weenie_type: WeenieType,
}

/// Validated source-neutral entity definition shared by both producer compositions.
#[derive(Debug, Clone, PartialEq)]
pub struct DynamicEntityDefinition {
    /// Producer-owned instance and template identity.
    pub identity: DynamicEntityIdentity,
    /// Immutable DAT content identities.
    pub content: DynamicEntityContent,
    /// Lossless ordered material and part substitutions.
    pub appearance: EntityAppearance,
    /// Validated initial world motion or parent-owned attachment.
    pub placement: EntityPlacement<DynamicEntityInitialState>,
    /// Validated uniform root scale.
    pub object_scale: f32,
    /// Validated effective friction coefficient.
    pub friction: PhysicalFriction,
    /// Validated authored elasticity retained across `Inelastic` changes.
    pub elasticity: PhysicalElasticity,
    /// Validated optional linear speed cap for later behavior integration.
    pub maximum_velocity: Option<f32>,
    /// Validated optional rotation speed for later behavior integration.
    pub rotation_speed: Option<f32>,
    /// Producer-resolved radar presentation facts consumed by overhead-map blips.
    pub radar: DynamicEntityRadarFacts,
    /// Authored body height at this entity's scale; zero for the 3.4% of templates declaring none.
    ///
    /// The same fact retail keeps on the part array (`CPartArray::GetHeight`, acclient.c:313220).
    /// Retained here rather than re-read from the setup because the possession camera pivot needs it
    /// long after content resolution has finished.
    pub body_height: f32,
    /// Fully resolved semantic state and state-derived decisions.
    pub physics: EffectiveEntityPhysicsState,
}

/// Invalid producer facts rejected before either registry or scene is mutated.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum DynamicEntityDefinitionError {
    #[error("dynamic-entity object scale must be finite and positive")]
    InvalidObjectScale,
    #[error("dynamic-entity initial pose and vectors must be finite")]
    InvalidInitialState,
    #[error("dynamic-entity friction must be finite and between zero and one")]
    InvalidFriction,
    #[error("dynamic-entity elasticity must be finite")]
    InvalidElasticity,
    #[error("dynamic-entity maximum velocity must be finite and non-negative")]
    InvalidMaximumVelocity,
    #[error("dynamic-entity rotation speed must be finite and non-negative")]
    InvalidRotationSpeed,
    #[error("dynamic-entity body height must be finite and non-negative")]
    InvalidBodyHeight,
}

/// Fully resolved one-shot launch consequences shared by producer compositions.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DynamicEntityLaunchPlan {
    /// Finite live vectors plus the resulting align-path response policy.
    pub kinematics: DynamicBodyKinematics,
    /// Complete semantic state after ACE's rotation-speed align-path override.
    pub physics: EffectiveEntityPhysicsState,
}

/// A launch request that cannot be resolved from immutable definition facts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum DynamicEntityLaunchError {
    #[error("dynamic-entity launch direction must be finite and nonzero")]
    InvalidDirection,
    #[error("dynamic-entity launch requires catalog maximum velocity")]
    MissingMaximumVelocity,
    #[error("dynamic-entity launch requires positive catalog maximum velocity")]
    ZeroMaximumVelocity,
}

impl DynamicEntityDefinition {
    /// Validates all source scalar domains and resolves ACE coefficient defaults once.
    pub fn prepare(
        input: DynamicEntityDefinitionInput,
    ) -> Result<Self, DynamicEntityDefinitionError> {
        if !input.object_scale.is_finite() || input.object_scale <= 0.0 {
            return Err(DynamicEntityDefinitionError::InvalidObjectScale);
        }
        if let EntityPlacement::World(initial) = input.placement
            && (!world_position_is_finite(initial.pose)
                || !vector_is_finite(initial.velocity)
                || !vector_is_finite(initial.acceleration)
                || !vector_is_finite(initial.omega))
        {
            return Err(DynamicEntityDefinitionError::InvalidInitialState);
        }
        let friction = input
            .friction
            .map(PhysicalFriction::new)
            .transpose()
            .map_err(|_| DynamicEntityDefinitionError::InvalidFriction)?
            .unwrap_or(PhysicalFriction::DEFAULT);
        let elasticity = input
            .elasticity
            .map(PhysicalElasticity::new)
            .transpose()
            .map_err(|_| DynamicEntityDefinitionError::InvalidElasticity)?
            .unwrap_or(PhysicalElasticity::DEFAULT);
        validate_non_negative_optional(
            input.maximum_velocity,
            DynamicEntityDefinitionError::InvalidMaximumVelocity,
        )?;
        validate_non_negative_optional(
            input.rotation_speed,
            DynamicEntityDefinitionError::InvalidRotationSpeed,
        )?;
        // Zero is authored content meaning "declares no height"; negative or non-finite is a
        // resolution bug on our side, so it fails rather than reaching a consumer.
        if !input.body_height.is_finite() || input.body_height < 0.0 {
            return Err(DynamicEntityDefinitionError::InvalidBodyHeight);
        }

        Ok(Self {
            identity: input.identity,
            content: input.content,
            appearance: input.appearance,
            placement: input.placement,
            object_scale: input.object_scale,
            friction,
            elasticity,
            maximum_velocity: input.maximum_velocity,
            rotation_speed: input.rotation_speed,
            radar: input.radar,
            body_height: input.body_height,
            physics: input.physics,
        })
    }
}

/// Resolves explicit direction against catalog speed and ACE's authored spin convention.
///
/// ACE assigns projectile omega on world X as `2π * RotationSpeed` and clears `AlignPath` when
/// that value is nonzero (`SpellProjectile.Setup` and `Creature.SetProjectilePhysicsState`).
pub fn resolve_dynamic_entity_launch(
    definition: &DynamicEntityDefinition,
    direction: Vector3,
) -> Result<DynamicEntityLaunchPlan, DynamicEntityLaunchError> {
    if !direction.x.is_finite() || !direction.y.is_finite() || !direction.z.is_finite() {
        return Err(DynamicEntityLaunchError::InvalidDirection);
    }
    let direction_length = direction.length();
    if !direction_length.is_finite() || direction_length <= f32::EPSILON {
        return Err(DynamicEntityLaunchError::InvalidDirection);
    }
    let maximum_velocity = definition
        .maximum_velocity
        .ok_or(DynamicEntityLaunchError::MissingMaximumVelocity)?;
    if maximum_velocity <= f32::EPSILON {
        return Err(DynamicEntityLaunchError::ZeroMaximumVelocity);
    }
    let rotation_speed = definition.rotation_speed.unwrap_or(0.0);
    let omega = if rotation_speed > f32::EPSILON {
        Vector3::new(TAU * rotation_speed, 0.0, 0.0)
    } else {
        Vector3::zero()
    };
    let semantic = if rotation_speed > f32::EPSILON {
        definition.physics.semantic & !PhysicsState::ALIGN_PATH
    } else {
        definition.physics.semantic
    };
    let physics = resolve_effective_entity_physics_state(semantic);
    let kinematics = DynamicBodyKinematics::new(
        direction / direction_length * maximum_velocity,
        Vector3::zero(),
        omega,
        physics.response.align_path,
    )
    .expect("validated launch facts must produce finite kinematics");
    Ok(DynamicEntityLaunchPlan {
        kinematics,
        physics,
    })
}

/// Physical preparation rejection with enough identity to explain the exact source failure.
#[derive(Debug, Error)]
pub enum DynamicEntityPhysicalPreparationError {
    #[error("invalid position-free physical definition: {0}")]
    Definition(#[from] DynamicEntityDefinitionError),
    #[error(
        "WCID {wcid} cannot be locally simulated with physics state 0x{state:08X}: unsupported bits 0x{unsupported_bits:08X}, unknown bits 0x{unknown_bits:08X}"
    )]
    UnsupportedPhysicsState {
        wcid: u32,
        state: u32,
        unsupported_bits: u32,
        unknown_bits: u32,
    },
    #[error("WCID {wcid} setup 0x{setup_did:08X} has invalid movement geometry: {source}")]
    MovementGeometry {
        wcid: u32,
        setup_did: u32,
        #[source]
        source: SetupPhysicalShapeError,
    },
    #[error(
        "WCID {wcid} setup 0x{setup_did:08X} default animation 0x{animation_did:08X} moves physics-BSP parts {moving_part_indices:?}"
    )]
    AnimatedPhysicsBsp {
        wcid: u32,
        setup_did: u32,
        animation_did: u32,
        moving_part_indices: Vec<usize>,
    },
    #[error(
        "WCID {wcid} setup 0x{setup_did:08X} physics script 0x{script_did:08X} contains collision-mutating hook {hook_type}"
    )]
    CollisionMutatingScript {
        wcid: u32,
        setup_did: u32,
        script_did: u32,
        hook_type: u32,
    },
    #[error(
        "WCID {wcid} setup 0x{setup_did:08X} appearance references missing part index {part_index}"
    )]
    InvalidAppearancePart {
        wcid: u32,
        setup_did: u32,
        part_index: usize,
    },
    #[error("could not prepare WCID {wcid} content resource 0x{resource_did:08X}: {source}")]
    Content {
        wcid: u32,
        resource_did: u32,
        #[source]
        source: anyhow::Error,
    },
}

/// Setup-derived facts needed before the complete effective state and body policy can be frozen.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DynamicEntitySetupPreparation {
    /// Setup/Gfx-derived replacements for state-owned behavior and target-branch bits.
    pub physics: EntityPhysicsSetupFacts,
    /// Validated movement spheres used for placement even when the entity remains pose-only.
    pub movement_spheres: PhysicalSphereSet,
    /// Authored setup height scaled by the entity's own scale; zero where the setup declares none.
    pub body_height: f32,
}

/// Failure to apply a shared body operation to the supplied canonical scene.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum DynamicEntityBodyOperationError {
    #[error("dynamic entity body {body_id:?} is already registered")]
    AlreadyRegistered { body_id: SpatialBodyId },
    #[error("dynamic entity body {body_id:?} is not registered")]
    NotRegistered { body_id: SpatialBodyId },
    #[error("dynamic entity body {body_id:?} has no physical participation")]
    NotPhysical { body_id: SpatialBodyId },
    #[error("physics transition {action:?} requires a prepared physical definition")]
    MissingReplacement {
        action: EntityPhysicalTransitionAction,
    },
}

/// Complete body facts returned after an install or physical-state replacement commits.
#[derive(Debug, Clone, PartialEq)]
pub struct DynamicEntityBodyCommitOutcome {
    /// Canonical body view read after the scene mutation committed.
    pub body: RuntimeSpatialBodyView,
    /// Physical participation after the commit.
    pub participation: PhysicalBodyParticipation,
    /// Exact participation/reconfiguration change applied by the scene.
    pub physical_change: PhysicalBodyReconfigurationOutcome,
}

/// Complete body facts returned after removal commits.
#[derive(Debug, Clone, PartialEq)]
pub struct DynamicEntityBodyRemovalOutcome {
    /// Final canonical body view that was removed.
    pub body: RuntimeSpatialBodyView,
    /// Physical participation immediately before removal.
    pub participation: PhysicalBodyParticipation,
    /// Balanced forced ends for every report lifetime involving the retired body.
    pub collision_reports: Vec<CollisionReportOutcome>,
}

/// Exact old/new body facts returned after a complete same-identity replacement commits.
#[derive(Debug, Clone, PartialEq)]
pub struct DynamicEntityBodyReplacementOutcome {
    /// Final body facts retired from the previous instance generation.
    pub removed: DynamicEntityBodyRemovalOutcome,
    /// Canonical body facts installed for the successor generation.
    pub installed: DynamicEntityBodyCommitOutcome,
}

/// Source-neutral semantic/body join consumed by focused frontend projection.
#[derive(Debug, Clone, PartialEq)]
pub struct DynamicEntityProjectionInput {
    /// Current semantic identity copied from the producer definition.
    pub identity: DynamicEntityIdentity,
    /// Immutable presentation content identities.
    pub content: DynamicEntityContent,
    /// Ordered presentation appearance substitutions.
    pub appearance: EntityAppearance,
    /// Uniform root presentation scale.
    pub object_scale: f32,
    /// Current complete semantic physics state.
    pub physics: EffectiveEntityPhysicsState,
    /// Producer-resolved radar presentation facts consumed by overhead-map blips.
    pub radar: DynamicEntityRadarFacts,
    /// Mutually exclusive current solver state or parent-owned attachment.
    pub placement: EntityPlacement<DynamicEntityWorldProjection>,
}

/// Frontend-reconstructible source-domain membership accepted with one world placement.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DynamicEntitySpatialMembership {
    /// Whether the accepted body geometry reaches any outdoor land cell.
    pub reaches_outdoors: bool,
    /// Deduplicated EnvCells reached by the accepted body geometry.
    pub reached_env_cell_ids: Vec<Guid>,
}

impl From<&SpatialMembership> for DynamicEntitySpatialMembership {
    fn from(membership: &SpatialMembership) -> Self {
        Self {
            reaches_outdoors: membership.reaches_outdoors(),
            reached_env_cell_ids: membership.reached_env_cells().to_vec(),
        }
    }
}

/// Complete solver-owned world arm used by dynamic-entity projection.
#[derive(Debug, Clone, PartialEq)]
pub struct DynamicEntityWorldProjection {
    /// Current canonical body view.
    pub body: RuntimeSpatialBodyView,
    /// Complete source-domain membership accepted atomically with `body.runtime_pose`.
    pub spatial_membership: DynamicEntitySpatialMembership,
    /// Current local physical participation derived from the body.
    pub participation: PhysicalBodyParticipation,
}

/// Registers one canonical pose body, then optionally installs its prepared physical definition.
///
/// The operation rejects duplicate identity before mutation. The returned view is read from the
/// committed scene rather than reconstructed from the request.
pub fn install_dynamic_entity_body(
    scene: &mut SpatialScene,
    definition: &DynamicEntityDefinition,
    initial: DynamicEntityInitialState,
    physical: Option<DynamicPhysicalBodyDefinition>,
) -> Result<DynamicEntityBodyCommitOutcome, DynamicEntityBodyOperationError> {
    let body_id = SpatialBodyId::Entity(definition.identity.guid);
    if scene.body(body_id).is_some() {
        return Err(DynamicEntityBodyOperationError::AlreadyRegistered { body_id });
    }
    let (body, physical_change) = build_dynamic_entity_body(definition, initial, physical);
    scene.register_body(body);
    committed_body_outcome(scene, body_id, physical_change)
}

/// Applies one pure complete-state decision and returns only committed scene facts.
pub fn apply_dynamic_entity_physics_transition(
    scene: &mut SpatialScene,
    body_id: SpatialBodyId,
    decision: EntityPhysicsTransitionDecision,
    replacement: Option<DynamicPhysicalBodyDefinition>,
) -> Result<DynamicEntityBodyCommitOutcome, DynamicEntityBodyOperationError> {
    let pose = scene
        .body(body_id)
        .ok_or(DynamicEntityBodyOperationError::NotRegistered { body_id })?
        .pose;
    let initial_cell = pose.is_indoors().then_some(pose.landblock_id);
    let requested = match decision.action {
        EntityPhysicalTransitionAction::None => None,
        EntityPhysicalTransitionAction::EnableSolverParticipation
        | EntityPhysicalTransitionAction::Reconfigure => Some(replacement.ok_or(
            DynamicEntityBodyOperationError::MissingReplacement {
                action: decision.action,
            },
        )?),
        EntityPhysicalTransitionAction::DisableSolverParticipation => None,
    };
    let mut forced_report_ends = if decision.force_end_reports {
        scene.force_end_collision_reports_for_recipient(body_id)
    } else {
        Vec::new()
    };
    let mut physical_change = if decision.action == EntityPhysicalTransitionAction::None {
        let body = scene
            .body(body_id)
            .ok_or(DynamicEntityBodyOperationError::NotRegistered { body_id })?;
        let participation = participation(body.physical.is_some());
        PhysicalBodyReconfigurationOutcome {
            before: participation,
            after: participation,
            change: PhysicalBodyReconfiguration::Unchanged,
            response_memory_preserved: body.physical.is_some(),
            collision_reports: Vec::new(),
        }
    } else {
        scene
            .set_dynamic_physical_body(
                body_id,
                requested,
                PhysicalCollisionFilter::ALL,
                initial_cell,
            )
            .ok_or(DynamicEntityBodyOperationError::NotRegistered { body_id })?
    };
    forced_report_ends.append(&mut physical_change.collision_reports);
    physical_change.collision_reports = forced_report_ends;
    committed_body_outcome(scene, body_id, physical_change)
}

/// Removes one canonical body and returns the exact final facts that were retired.
pub fn remove_dynamic_entity_body(
    scene: &mut SpatialScene,
    body_id: SpatialBodyId,
) -> Result<DynamicEntityBodyRemovalOutcome, DynamicEntityBodyOperationError> {
    let (removed, collision_reports) = scene
        .remove_body_with_collision_reports(body_id)
        .ok_or(DynamicEntityBodyOperationError::NotRegistered { body_id })?;
    Ok(DynamicEntityBodyRemovalOutcome {
        body: removed.runtime_view(),
        participation: participation(removed.physical.is_some()),
        collision_reports,
    })
}

/// Replaces one same-identity body atomically from the caller's point of view.
///
/// The complete successor is constructed before the one scene replacement. Semantic publication
/// remains producer-owned and occurs only after this operation returns success.
pub fn replace_dynamic_entity_body(
    scene: &mut SpatialScene,
    definition: &DynamicEntityDefinition,
    initial: DynamicEntityInitialState,
    physical: Option<DynamicPhysicalBodyDefinition>,
) -> Result<DynamicEntityBodyReplacementOutcome, DynamicEntityBodyOperationError> {
    let body_id = SpatialBodyId::Entity(definition.identity.guid);
    if scene.body(body_id).is_none() {
        return Err(DynamicEntityBodyOperationError::NotRegistered { body_id });
    }
    let (successor, physical_change) = build_dynamic_entity_body(definition, initial, physical);
    let collision_reports = scene.force_end_collision_reports_for_body(body_id);
    let removed_body = scene
        .register_body(successor)
        .expect("prevalidated same-identity replacement lost its previous body");
    let removed = DynamicEntityBodyRemovalOutcome {
        body: removed_body.runtime_view(),
        participation: participation(removed_body.physical.is_some()),
        collision_reports,
    };
    let installed = committed_body_outcome(scene, body_id, physical_change)?;
    Ok(DynamicEntityBodyReplacementOutcome { removed, installed })
}

fn build_dynamic_entity_body(
    definition: &DynamicEntityDefinition,
    initial: DynamicEntityInitialState,
    physical: Option<DynamicPhysicalBodyDefinition>,
) -> (SpatialBody, PhysicalBodyReconfigurationOutcome) {
    let body_id = SpatialBodyId::Entity(definition.identity.guid);
    let mut body = SpatialBody::new(body_id, initial.pose, initial.created_at);
    body.velocity = initial.velocity;
    body.acceleration = initial.acceleration;
    body.omega = initial.omega;
    let physical_change = if let Some(physical) = physical {
        let initial_cell = initial
            .pose
            .is_indoors()
            .then_some(initial.pose.landblock_id);
        body.physical = Some(PhysicalBodyState::new_dynamic(
            physical,
            PhysicalCollisionFilter::ALL,
            initial_cell,
        ));
        PhysicalBodyReconfigurationOutcome {
            before: PhysicalBodyParticipation::PoseOnly,
            after: PhysicalBodyParticipation::Physical,
            change: PhysicalBodyReconfiguration::SolverParticipationEnabled,
            response_memory_preserved: false,
            collision_reports: Vec::new(),
        }
    } else {
        PhysicalBodyReconfigurationOutcome {
            before: PhysicalBodyParticipation::PoseOnly,
            after: PhysicalBodyParticipation::PoseOnly,
            change: PhysicalBodyReconfiguration::Unchanged,
            response_memory_preserved: false,
            collision_reports: Vec::new(),
        }
    };
    (body, physical_change)
}

/// Joins immutable semantic facts with the scene's current committed body view.
pub fn dynamic_entity_projection_input(
    definition: &DynamicEntityDefinition,
    scene: &SpatialScene,
) -> Result<DynamicEntityProjectionInput, DynamicEntityBodyOperationError> {
    if let EntityPlacement::Attached(attachment) = definition.placement {
        return Ok(projection_input(
            definition,
            EntityPlacement::Attached(attachment),
        ));
    }
    let body_id = SpatialBodyId::Entity(definition.identity.guid);
    let body = scene
        .body(body_id)
        .ok_or(DynamicEntityBodyOperationError::NotRegistered { body_id })?;
    dynamic_entity_projection_input_from_body(definition, body)
}

/// Joins immutable semantic facts with one already-captured canonical body.
///
/// Collection adapters use this form while holding their producer generation stable, avoiding a
/// second simulation lock acquisition merely to restate the body that just committed.
pub fn dynamic_entity_projection_input_from_body(
    definition: &DynamicEntityDefinition,
    body: &SpatialBody,
) -> Result<DynamicEntityProjectionInput, DynamicEntityBodyOperationError> {
    let body_id = SpatialBodyId::Entity(definition.identity.guid);
    if body.id != body_id {
        return Err(DynamicEntityBodyOperationError::NotRegistered { body_id });
    }
    Ok(projection_input(
        definition,
        EntityPlacement::World(DynamicEntityWorldProjection {
            body: body.runtime_view(),
            spatial_membership: DynamicEntitySpatialMembership::from(&body.spatial_membership()),
            participation: participation(body.physical.is_some()),
        }),
    ))
}

fn projection_input(
    definition: &DynamicEntityDefinition,
    placement: EntityPlacement<DynamicEntityWorldProjection>,
) -> DynamicEntityProjectionInput {
    DynamicEntityProjectionInput {
        identity: definition.identity.clone(),
        content: definition.content,
        appearance: definition.appearance.clone(),
        object_scale: definition.object_scale,
        physics: definition.physics,
        radar: definition.radar,
        placement,
    }
}

fn committed_body_outcome(
    scene: &SpatialScene,
    body_id: SpatialBodyId,
    physical_change: PhysicalBodyReconfigurationOutcome,
) -> Result<DynamicEntityBodyCommitOutcome, DynamicEntityBodyOperationError> {
    let body = scene
        .body(body_id)
        .ok_or(DynamicEntityBodyOperationError::NotRegistered { body_id })?;
    Ok(DynamicEntityBodyCommitOutcome {
        body: body.runtime_view(),
        participation: participation(body.physical.is_some()),
        physical_change,
    })
}

const fn participation(physical: bool) -> PhysicalBodyParticipation {
    if physical {
        PhysicalBodyParticipation::Physical
    } else {
        PhysicalBodyParticipation::PoseOnly
    }
}

/// Resolves complete solver facts without mutating a registry or [`holtburger_world::SpatialScene`].
pub fn prepare_dynamic_entity_physics(
    definition: &DynamicEntityDefinition,
    content: &ContentRepository,
) -> Result<DynamicPhysicalBodyDefinition, DynamicEntityPhysicalPreparationError> {
    prepare_dynamic_entity_physical_facts(
        DynamicEntityPhysicalFacts {
            wcid: definition.identity.wcid,
            setup_did: definition.content.setup_did,
            appearance: &definition.appearance,
            object_scale: definition.object_scale,
            friction: definition.friction,
            elasticity: definition.elasticity,
            physics: definition.physics,
            weenie_type: definition.identity.weenie_type,
        },
        content,
    )
}

/// Resolves complete solver facts from a position-free immutable definition contract.
pub fn prepare_dynamic_entity_physical_definition(
    input: DynamicEntityPhysicalPreparationInput,
    content: &ContentRepository,
) -> Result<DynamicPhysicalBodyDefinition, DynamicEntityPhysicalPreparationError> {
    if !input.object_scale.is_finite() || input.object_scale <= 0.0 {
        return Err(DynamicEntityDefinitionError::InvalidObjectScale.into());
    }
    let friction = input
        .friction
        .map(PhysicalFriction::new)
        .transpose()
        .map_err(|_| DynamicEntityDefinitionError::InvalidFriction)?
        .unwrap_or(PhysicalFriction::DEFAULT);
    let elasticity = input
        .elasticity
        .map(PhysicalElasticity::new)
        .transpose()
        .map_err(|_| DynamicEntityDefinitionError::InvalidElasticity)?
        .unwrap_or(PhysicalElasticity::DEFAULT);
    prepare_dynamic_entity_physical_facts(
        DynamicEntityPhysicalFacts {
            wcid: input.wcid,
            setup_did: input.setup_did,
            appearance: &input.appearance,
            object_scale: input.object_scale,
            friction,
            elasticity,
            physics: input.physics,
            weenie_type: input.weenie_type,
        },
        content,
    )
}

struct DynamicEntityPhysicalFacts<'a> {
    wcid: u32,
    setup_did: u32,
    appearance: &'a EntityAppearance,
    object_scale: f32,
    friction: PhysicalFriction,
    elasticity: PhysicalElasticity,
    physics: EffectiveEntityPhysicsState,
    weenie_type: WeenieType,
}

fn prepare_dynamic_entity_physical_facts(
    facts: DynamicEntityPhysicalFacts<'_>,
    content: &ContentRepository,
) -> Result<DynamicPhysicalBodyDefinition, DynamicEntityPhysicalPreparationError> {
    let DynamicEntityPhysicalFacts {
        wcid,
        setup_did,
        appearance,
        object_scale,
        friction,
        elasticity,
        physics,
        weenie_type,
    } = facts;
    if !physics.supports_local_simulation() {
        return Err(
            DynamicEntityPhysicalPreparationError::UnsupportedPhysicsState {
                wcid,
                state: physics.semantic.bits(),
                unsupported_bits: physics.unsupported_local_simulation.bits(),
                unknown_bits: physics.unknown_bits,
            },
        );
    }

    let setup = read_setup(content, wcid, setup_did)?;
    let setup_preparation = prepare_setup(wcid, setup_did, object_scale, &setup, content)?;
    let movement_spheres = setup_preparation.movement_spheres;
    let response_policy = PhysicalBodyResponsePolicy {
        restitution: if physics.response.inelastic {
            PhysicalRestitution::Inelastic
        } else {
            PhysicalRestitution::Elastic(elasticity)
        },
        friction,
        surface_motion: PhysicalSurfaceMotion::Stable,
        align_path: physics.response.align_path,
    };
    let edge_protection = if physics.response.edge_slide {
        EdgeProtection::Creature
    } else {
        EdgeProtection::None
    };
    let gravity = if physics.response.gravity { -9.8 } else { 0.0 };
    let movement = retail_grounded_body_with_policy(
        movement_spheres,
        edge_protection,
        gravity,
        response_policy,
    )
    .map_err(SetupPhysicalShapeError::from)
    .map_err(
        |source| DynamicEntityPhysicalPreparationError::MovementGeometry {
            wcid,
            setup_did,
            source,
        },
    )?
    .definition;
    let target_geometry = prepare_target_geometry(
        wcid,
        setup_did,
        appearance,
        object_scale,
        &setup,
        setup_preparation.physics.has_physics_bsp,
        content,
    )?;

    Ok(DynamicPhysicalBodyDefinition {
        movement,
        response_policy,
        entity_collision: DynamicBodyCollisionDefinition {
            target_geometry,
            scheduling: physics.scheduling,
            dynamic_collision: physics.dynamic_collision,
            reporting: physics.reporting,
            uses_physics_bsp: physics.uses_physics_bsp,
            weenie_type,
            elasticity,
            default_animation_available: setup.default_animation.is_some(),
            default_script_available: setup.default_script.is_some(),
        },
    })
}

/// Resolves setup-owned state bits and movement geometry without requiring simulated intent.
///
/// Pose-only realization still needs the movement sphere to resolve its authoritative EnvCell, but
/// it does not prepare target collision geometry or validate default physics-script stability.
pub fn prepare_dynamic_entity_setup(
    wcid: u32,
    setup_did: u32,
    object_scale: f32,
    content: &ContentRepository,
) -> Result<DynamicEntitySetupPreparation, DynamicEntityPhysicalPreparationError> {
    let setup = read_setup(content, wcid, setup_did)?;
    prepare_setup(wcid, setup_did, object_scale, &setup, content)
}

fn prepare_setup(
    wcid: u32,
    setup_did: u32,
    object_scale: f32,
    setup: &SetupModel,
    content: &ContentRepository,
) -> Result<DynamicEntitySetupPreparation, DynamicEntityPhysicalPreparationError> {
    let movement_spheres =
        resolve_setup_physical_spheres(setup, object_scale).map_err(|source| {
            DynamicEntityPhysicalPreparationError::MovementGeometry {
                wcid,
                setup_did,
                source,
            }
        })?;
    let mut has_physics_bsp = false;
    for gfx_obj_did in &setup.parts {
        has_physics_bsp |= read_gfx_shape(content, wcid, *gfx_obj_did)?.is_some();
    }
    Ok(DynamicEntitySetupPreparation {
        physics: EntityPhysicsSetupFacts {
            has_physics_bsp,
            has_default_animation: setup.default_animation.is_some(),
            has_default_script: setup.default_script.is_some(),
        },
        movement_spheres,
        body_height: setup.height * object_scale,
    })
}

/// Converts the shared semantic appearance into the existing content resolver's DAT-shaped input.
pub fn material_appearance_input(appearance: &EntityAppearance) -> MaterialAppearanceInput {
    let is_empty = appearance.palette_did.is_none()
        && appearance.sub_palettes.is_empty()
        && appearance.texture_changes.is_empty()
        && appearance.part_changes.is_empty();
    MaterialAppearanceInput {
        obj_desc: (!is_empty).then(|| ObjDesc {
            palette_id: appearance.palette_did,
            sub_palettes: appearance
                .sub_palettes
                .iter()
                .map(|range| SubPalette {
                    sub_id: range.palette_did,
                    offset: range.offset,
                    num_colors: range.color_count,
                })
                .collect(),
            texture_changes: appearance
                .texture_changes
                .iter()
                .map(|change| TextureMapChange {
                    part_index: change.part_index,
                    old_texture: change.old_texture_did,
                    new_texture: change.new_texture_did,
                })
                .collect(),
            anim_part_changes: appearance
                .part_changes
                .iter()
                .map(|change| AnimationPartChange {
                    part_index: change.part_index,
                    part_id: change.gfx_obj_did,
                })
                .collect(),
        }),
    }
}

fn prepare_target_geometry(
    wcid: u32,
    setup_did: u32,
    appearance: &EntityAppearance,
    object_scale: f32,
    setup: &SetupModel,
    cached_bsp_branch: bool,
    content: &ContentRepository,
) -> Result<PreparedEntityTargetGeometry, DynamicEntityPhysicalPreparationError> {
    validate_default_script_stability(wcid, setup_did, setup.default_script, content)?;

    let mut effective_part_dids = setup.parts.clone();
    for change in &appearance.part_changes {
        let part_index = usize::from(change.part_index);
        let Some(part_did) = effective_part_dids.get_mut(part_index) else {
            return Err(
                DynamicEntityPhysicalPreparationError::InvalidAppearancePart {
                    wcid,
                    setup_did,
                    part_index,
                },
            );
        };
        *part_did = change.gfx_obj_did;
    }

    let default_animation = setup
        .default_animation
        .map(|animation_did| read_animation(content, wcid, animation_did))
        .transpose()?;
    let mut effective_bsp_shapes = Vec::new();
    if cached_bsp_branch {
        for (part_index, gfx_obj_did) in effective_part_dids.iter().copied().enumerate() {
            if let Some(shape) = read_gfx_shape(content, wcid, gfx_obj_did)? {
                effective_bsp_shapes.push((part_index, gfx_obj_did, shape));
            }
        }
        if let (Some(animation_did), Some(animation)) =
            (setup.default_animation, &default_animation)
        {
            let indices = effective_bsp_shapes
                .iter()
                .map(|(part_index, _, _)| *part_index)
                .collect::<Vec<_>>();
            let moving_part_indices =
                moving_part_indices(animation, &indices).map_err(|source| {
                    DynamicEntityPhysicalPreparationError::Content {
                        wcid,
                        resource_did: animation_did,
                        source,
                    }
                })?;
            if !moving_part_indices.is_empty() {
                return Err(DynamicEntityPhysicalPreparationError::AnimatedPhysicsBsp {
                    wcid,
                    setup_did,
                    animation_did,
                    moving_part_indices,
                });
            }
        }
    }

    validate_setup_part_arrays(wcid, setup_did, setup)?;
    let frames = stable_part_frames(setup, default_animation.as_ref());
    if let Some(frames) = frames
        && frames.frames.len() != setup.parts.len()
    {
        return Err(DynamicEntityPhysicalPreparationError::Content {
            wcid,
            resource_did: setup_did,
            source: anyhow::anyhow!(
                "selected part frame has {} frames for {} setup parts",
                frames.frames.len(),
                setup.parts.len()
            ),
        });
    }
    let whole_scale = ColliderScale::uniform(object_scale).map_err(|source| {
        DynamicEntityPhysicalPreparationError::Content {
            wcid,
            resource_did: setup_did,
            source,
        }
    })?;
    let physics_bsp_parts = effective_bsp_shapes
        .into_iter()
        .map(|(part_index, gfx_obj_did, shape)| {
            let (local_origin, local_orientation) =
                frames.map_or((Vector3::zero(), Quaternion::identity()), |frames| {
                    let frame = &frames.frames[part_index];
                    (frame.origin, frame.orientation)
                });
            let part_scale = setup
                .default_scale
                .get(part_index)
                .copied()
                .unwrap_or(Vector3::new(1.0, 1.0, 1.0));
            let scale =
                ColliderScale::from_components(part_scale * object_scale).map_err(|source| {
                    DynamicEntityPhysicalPreparationError::Content {
                        wcid,
                        resource_did: setup_did,
                        source,
                    }
                })?;
            Ok(PreparedEntityBspPart {
                part_index,
                gfx_obj_did,
                local_origin: local_origin * object_scale,
                local_orientation,
                scale,
                shape,
            })
        })
        .collect::<Result<Vec<_>, DynamicEntityPhysicalPreparationError>>()?;
    let fallback_shapes =
        resolve_setup_volume_collision_shapes(setup_did, setup).map_err(|source| {
            DynamicEntityPhysicalPreparationError::Content {
                wcid,
                resource_did: setup_did,
                source,
            }
        })?;

    Ok(PreparedEntityTargetGeometry {
        physics_bsp_parts,
        fallback_setup_did: setup_did,
        fallback_shapes,
        fallback_scale: whole_scale,
    })
}

fn validate_setup_part_arrays(
    wcid: u32,
    setup_did: u32,
    setup: &SetupModel,
) -> Result<(), DynamicEntityPhysicalPreparationError> {
    if !setup.default_scale.is_empty() && setup.default_scale.len() != setup.parts.len() {
        return Err(DynamicEntityPhysicalPreparationError::Content {
            wcid,
            resource_did: setup_did,
            source: anyhow::anyhow!(
                "SetupModel has {} default scales for {} parts",
                setup.default_scale.len(),
                setup.parts.len()
            ),
        });
    }
    Ok(())
}

fn stable_part_frames<'a>(
    setup: &'a SetupModel,
    default_animation: Option<&'a Animation>,
) -> Option<&'a AnimationFrame> {
    default_animation
        .and_then(|animation| animation.part_frames.first())
        .or_else(|| {
            setup
                .placement_frames
                .get(&Placement::Resting)
                .or_else(|| setup.placement_frames.get(&Placement::Default))
                .map(|placement| &placement.anim_frame)
        })
}

fn moving_part_indices(
    animation: &Animation,
    part_indices: &[usize],
) -> anyhow::Result<Vec<usize>> {
    let mut moving = Vec::new();
    for &part_index in part_indices {
        let frames = animation
            .part_frames
            .iter()
            .map(|frame| frame.frames.get(part_index))
            .collect::<Option<Vec<_>>>()
            .with_context(|| format!("missing physics-BSP part index {part_index}"))?;
        if frames
            .first()
            .is_some_and(|first| frames.iter().skip(1).any(|frame| *frame != *first))
        {
            moving.push(part_index);
        }
    }
    Ok(moving)
}

fn validate_default_script_stability(
    wcid: u32,
    setup_did: u32,
    root_script_did: Option<u32>,
    content: &ContentRepository,
) -> Result<(), DynamicEntityPhysicalPreparationError> {
    let Some(root_script_did) = root_script_did else {
        return Ok(());
    };
    let mut pending = BTreeSet::from([root_script_did]);
    let mut visited = BTreeSet::new();
    while let Some(script_did) = pending.pop_first() {
        if !visited.insert(script_did) {
            continue;
        }
        let script = read_physics_script(content, wcid, script_did)?;
        for record in &script.records {
            if collision_mutating_hook(record.hook.hook_type) {
                return Err(
                    DynamicEntityPhysicalPreparationError::CollisionMutatingScript {
                        wcid,
                        setup_did,
                        script_did,
                        hook_type: record.hook.hook_type,
                    },
                );
            }
            if let AnimationHookPayload::CallPes(call) = &record.hook.payload {
                pending.insert(call.script_id);
            }
        }
    }
    Ok(())
}

fn collision_mutating_hook(hook_type: u32) -> bool {
    // ReplaceObject, Ethereal, Scale, SetOmega, and CreateBlockingParticle can change collision
    // identity, filtering, shape, root transform, or introduce another blocker. Unknown hooks fail
    // closed because their collision effect is not classified.
    matches!(hook_type, 5 | 6 | 12 | 22 | 26) || hook_type > 26
}

fn read_setup(
    content: &ContentRepository,
    wcid: u32,
    setup_did: u32,
) -> Result<SetupModel, DynamicEntityPhysicalPreparationError> {
    let resource = read_resource(content, wcid, setup_did)?;
    SetupModel::unpack(&mut Cursor::new(resource.bytes)).map_err(|source| {
        DynamicEntityPhysicalPreparationError::Content {
            wcid,
            resource_did: setup_did,
            source: source.into(),
        }
    })
}

fn read_gfx_shape(
    content: &ContentRepository,
    wcid: u32,
    gfx_obj_did: u32,
) -> Result<Option<Arc<CollisionShape>>, DynamicEntityPhysicalPreparationError> {
    let resource = read_resource(content, wcid, gfx_obj_did)?;
    let gfx_obj = GfxObj::unpack(&mut Cursor::new(resource.bytes)).map_err(|source| {
        DynamicEntityPhysicalPreparationError::Content {
            wcid,
            resource_did: gfx_obj_did,
            source: source.into(),
        }
    })?;
    resolve_gfx_obj_collision_shape(gfx_obj_did, &gfx_obj).map_err(|source| {
        DynamicEntityPhysicalPreparationError::Content {
            wcid,
            resource_did: gfx_obj_did,
            source,
        }
    })
}

fn read_animation(
    content: &ContentRepository,
    wcid: u32,
    animation_did: u32,
) -> Result<Animation, DynamicEntityPhysicalPreparationError> {
    let resource = read_resource(content, wcid, animation_did)?;
    Animation::read(&mut Cursor::new(resource.bytes)).map_err(|source| {
        DynamicEntityPhysicalPreparationError::Content {
            wcid,
            resource_did: animation_did,
            source: source.into(),
        }
    })
}

fn read_physics_script(
    content: &ContentRepository,
    wcid: u32,
    script_did: u32,
) -> Result<PhysicsScript, DynamicEntityPhysicalPreparationError> {
    let resource = read_resource(content, wcid, script_did)?;
    PhysicsScript::read(&mut Cursor::new(resource.bytes)).map_err(|source| {
        DynamicEntityPhysicalPreparationError::Content {
            wcid,
            resource_did: script_did,
            source: source.into(),
        }
    })
}

fn read_resource(
    content: &ContentRepository,
    wcid: u32,
    resource_did: u32,
) -> Result<holtburger_content::repository::RepositoryResource, DynamicEntityPhysicalPreparationError>
{
    content
        .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, resource_did))
        .map_err(|source| DynamicEntityPhysicalPreparationError::Content {
            wcid,
            resource_did,
            source,
        })
}

fn validate_non_negative_optional(
    value: Option<f32>,
    error: DynamicEntityDefinitionError,
) -> Result<(), DynamicEntityDefinitionError> {
    if value.is_some_and(|value| !value.is_finite() || value < 0.0) {
        return Err(error);
    }
    Ok(())
}

fn vector_is_finite(vector: Vector3) -> bool {
    vector.x.is_finite() && vector.y.is_finite() && vector.z.is_finite()
}

fn quaternion_is_finite(rotation: Quaternion) -> bool {
    rotation.w.is_finite()
        && rotation.x.is_finite()
        && rotation.y.is_finite()
        && rotation.z.is_finite()
}

fn world_position_is_finite(position: WorldPosition) -> bool {
    vector_is_finite(position.coords) && quaternion_is_finite(position.rotation)
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::properties::PhysicsState;
    use holtburger_content::{
        CollisionBall, LandblockColliders, LandblockCollisionAsset, TerrainCollisionSurface,
    };
    use holtburger_world::{
        DynamicBodyCollisionDefinition, EntityCollisionParticipation, EntityPartChange,
        EntityPhysicalIntent, EntityPhysicsTransitionContext, EntitySubPalette,
        EntityTextureChange, GroundedBodyActuation, PhysicalBodyActuation, PhysicalSphereSet,
        decide_entity_physics_state_transition, resolve_effective_entity_physics_state,
    };

    #[test]
    fn authored_radar_facts_type_in_domain_values() {
        let facts = DynamicEntityRadarFacts::from_authored(
            "test",
            Some(5),
            RadarColor::Purple,
            Some(2),
            Some(10.0),
        );

        assert_eq!(facts.blip_color, RadarColor::Red);
        assert_eq!(facts.behavior, Some(RadarBehavior::ShowMovement));
        assert_eq!(facts.obvious_range, Some(10.0));
    }

    /// Radar facts are cosmetic, so each unusable field drops independently instead of failing the
    /// entity. `0x0A` sits in the authored gap between `RadarColor::Cyan` and `BrightGreen`.
    #[test]
    fn unusable_radar_values_drop_independently_without_failing_the_entity() {
        let facts = DynamicEntityRadarFacts::from_authored(
            "test",
            Some(0x0A),
            RadarColor::Default,
            Some(99),
            Some(f64::NAN),
        );

        assert_eq!(facts, DynamicEntityRadarFacts::default());

        let partial = DynamicEntityRadarFacts::from_authored(
            "test",
            Some(-1),
            RadarColor::Purple,
            Some(4),
            Some(-5.0),
        );
        assert_eq!(partial.blip_color, RadarColor::Purple);
        assert_eq!(partial.behavior, Some(RadarBehavior::ShowAlways));
        assert_eq!(partial.obvious_range, None);

        let mut input = definition_input();
        input.radar = DynamicEntityRadarFacts::from_authored(
            "test",
            Some(0x0A),
            RadarColor::Default,
            None,
            None,
        );
        assert!(DynamicEntityDefinition::prepare(input).is_ok());
    }

    #[test]
    fn absent_and_default_authored_colors_use_the_producer_category_fallback() {
        for authored in [None, Some(RadarColor::Default as i32)] {
            let facts = DynamicEntityRadarFacts::from_authored(
                "portal",
                authored,
                RadarColor::Purple,
                Some(RadarBehavior::ShowAlways as i32),
                None,
            );

            assert_eq!(facts.blip_color, RadarColor::Purple);
        }
    }

    #[test]
    fn semantic_radar_colors_distinguish_cli_inspired_entity_classes() {
        assert_eq!(
            semantic_radar_blip_color(ObjectDescriptionFlag::PLAYER, Some(ItemType::CREATURE)),
            RadarColor::Yellow
        );
        assert_eq!(
            semantic_radar_blip_color(ObjectDescriptionFlag::ATTACKABLE, Some(ItemType::CREATURE)),
            RadarColor::Red
        );
        assert_eq!(
            semantic_radar_blip_color(ObjectDescriptionFlag::empty(), Some(ItemType::CREATURE)),
            RadarColor::BrightGreen
        );
        assert_eq!(
            semantic_radar_blip_color(ObjectDescriptionFlag::VENDOR, Some(ItemType::CREATURE)),
            RadarColor::BrightGreen
        );
        assert_eq!(
            semantic_radar_blip_color(ObjectDescriptionFlag::PORTAL, None),
            RadarColor::Purple
        );
        assert_eq!(
            semantic_radar_blip_color(ObjectDescriptionFlag::LIFE_STONE, None),
            RadarColor::Blue
        );
        assert_eq!(
            semantic_radar_blip_color(ObjectDescriptionFlag::empty(), Some(ItemType::MANA_STONE)),
            RadarColor::Cyan
        );
        assert_eq!(
            semantic_radar_blip_color(ObjectDescriptionFlag::DOOR, None),
            RadarColor::White
        );
    }

    #[test]
    fn explorer_categories_use_the_semantic_color_policy() {
        assert_eq!(
            explorer_radar_blip_color(WeenieType::Portal, None, None),
            RadarColor::Purple
        );
        assert_eq!(
            explorer_radar_blip_color(WeenieType::Creature, Some(ItemType::CREATURE), Some(true)),
            RadarColor::Red
        );
        assert_eq!(
            explorer_radar_blip_color(WeenieType::Creature, Some(ItemType::CREATURE), Some(false)),
            RadarColor::BrightGreen
        );
        assert_eq!(
            explorer_radar_blip_color(WeenieType::Vendor, Some(ItemType::CREATURE), None),
            RadarColor::BrightGreen
        );
        assert_eq!(
            explorer_radar_blip_color(WeenieType::LifeStone, Some(ItemType::LIFE_STONE), None),
            RadarColor::Blue
        );
        assert_eq!(
            explorer_radar_blip_color(WeenieType::ManaStone, Some(ItemType::MANA_STONE), None),
            RadarColor::Cyan
        );
    }

    fn definition_input() -> DynamicEntityDefinitionInput {
        DynamicEntityDefinitionInput {
            identity: DynamicEntityIdentity {
                guid: Guid(0x7000_0001),
                wcid: 1,
                name: "Clay".to_owned(),
                weenie_type: WeenieType::Creature,
            },
            content: DynamicEntityContent {
                motion_table_did: None,
                setup_did: 0x0200_0001,
                sound_table_did: None,
                physics_effect_table_did: None,
            },
            appearance: EntityAppearance::default(),
            placement: EntityPlacement::World(DynamicEntityInitialState {
                pose: WorldPosition::default(),
                velocity: Vector3::zero(),
                acceleration: Vector3::zero(),
                omega: Vector3::zero(),
                created_at: Instant::now(),
            }),
            object_scale: 1.0,
            friction: None,
            elasticity: None,
            maximum_velocity: None,
            rotation_speed: None,
            radar: DynamicEntityRadarFacts::default(),
            body_height: 2.05,
            physics: resolve_effective_entity_physics_state(PhysicsState::GRAVITY),
        }
    }

    fn world_initial(definition: &DynamicEntityDefinition) -> DynamicEntityInitialState {
        *definition
            .placement
            .world()
            .expect("test definition must own world placement")
    }

    #[test]
    fn definition_resolves_defaults_and_rejects_each_invalid_scalar_domain() {
        let definition = DynamicEntityDefinition::prepare(definition_input()).unwrap();
        assert_eq!(definition.friction, PhysicalFriction::DEFAULT);
        assert_eq!(definition.elasticity, PhysicalElasticity::DEFAULT);

        let mut input = definition_input();
        input.object_scale = 0.0;
        assert_eq!(
            DynamicEntityDefinition::prepare(input),
            Err(DynamicEntityDefinitionError::InvalidObjectScale)
        );

        let mut input = definition_input();
        input.maximum_velocity = Some(f32::NAN);
        assert_eq!(
            DynamicEntityDefinition::prepare(input),
            Err(DynamicEntityDefinitionError::InvalidMaximumVelocity)
        );
    }

    #[test]
    fn launch_uses_catalog_speed_and_ace_world_x_spin_policy() {
        let mut input = definition_input();
        input.maximum_velocity = Some(15.0);
        input.rotation_speed = Some(2.0);
        input.physics = resolve_effective_entity_physics_state(
            PhysicsState::GRAVITY | PhysicsState::ALIGN_PATH,
        );
        let definition = DynamicEntityDefinition::prepare(input).unwrap();

        let launch =
            resolve_dynamic_entity_launch(&definition, Vector3::new(3.0, 4.0, 0.0)).unwrap();

        assert_eq!(launch.kinematics.velocity(), Vector3::new(9.0, 12.0, 0.0));
        assert_eq!(launch.kinematics.acceleration(), Vector3::zero());
        assert_eq!(launch.kinematics.omega(), Vector3::new(2.0 * TAU, 0.0, 0.0));
        assert!(!launch.kinematics.align_path());
        assert!(!launch.physics.semantic.contains(PhysicsState::ALIGN_PATH));
    }

    #[test]
    fn launch_rejects_only_invalid_direction_or_unusable_catalog_speed() {
        let definition = DynamicEntityDefinition::prepare(definition_input()).unwrap();
        assert_eq!(
            resolve_dynamic_entity_launch(&definition, Vector3::new(1.0, 0.0, 0.0)),
            Err(DynamicEntityLaunchError::MissingMaximumVelocity)
        );

        let mut input = definition_input();
        input.maximum_velocity = Some(0.0);
        let zero_speed = DynamicEntityDefinition::prepare(input).unwrap();
        assert_eq!(
            resolve_dynamic_entity_launch(&zero_speed, Vector3::new(1.0, 0.0, 0.0)),
            Err(DynamicEntityLaunchError::ZeroMaximumVelocity)
        );

        let mut input = definition_input();
        input.maximum_velocity = Some(15.0);
        let launchable = DynamicEntityDefinition::prepare(input).unwrap();
        for direction in [
            Vector3::zero(),
            Vector3::new(f32::NAN, 0.0, 0.0),
            Vector3::new(f32::INFINITY, 0.0, 0.0),
        ] {
            assert_eq!(
                resolve_dynamic_entity_launch(&launchable, direction),
                Err(DynamicEntityLaunchError::InvalidDirection)
            );
        }
    }

    #[test]
    fn appearance_adapter_preserves_order_identities_and_zero_noop_ranges() {
        let appearance = EntityAppearance {
            palette_did: Some(0x0400_0001),
            sub_palettes: vec![EntitySubPalette {
                palette_did: 0x0400_0002,
                offset: 24,
                color_count: 0,
            }],
            texture_changes: vec![EntityTextureChange {
                part_index: 3,
                old_texture_did: 0x0500_0001,
                new_texture_did: 0x0500_0002,
            }],
            part_changes: vec![EntityPartChange {
                part_index: 4,
                gfx_obj_did: 0x0100_0001,
            }],
        };

        let input = material_appearance_input(&appearance);
        let obj_desc = input.obj_desc.unwrap();
        assert_eq!(obj_desc.palette_id, appearance.palette_did);
        assert_eq!(obj_desc.sub_palettes[0].num_colors, 0);
        assert_eq!(obj_desc.texture_changes[0].part_index, 3);
        assert_eq!(obj_desc.anim_part_changes[0].part_index, 4);
    }

    #[test]
    fn collision_script_classifier_is_explicit_and_fails_closed_for_unknown_hooks() {
        assert!(collision_mutating_hook(5));
        assert!(collision_mutating_hook(12));
        assert!(!collision_mutating_hook(13));
        assert!(!collision_mutating_hook(19));
        assert!(collision_mutating_hook(99));
    }

    fn prepared_physics() -> DynamicPhysicalBodyDefinition {
        let spheres = PhysicalSphereSet::new(
            holtburger_common::Sphere {
                center: Vector3::new(0.0, 0.0, 0.5),
                radius: 0.5,
            },
            None,
        )
        .unwrap();
        let profile = retail_grounded_body_with_policy(
            spheres,
            EdgeProtection::Creature,
            -9.8,
            PhysicalBodyResponsePolicy {
                restitution: PhysicalRestitution::Elastic(PhysicalElasticity::DEFAULT),
                friction: PhysicalFriction::DEFAULT,
                surface_motion: PhysicalSurfaceMotion::Stable,
                align_path: false,
            },
        )
        .unwrap();
        DynamicPhysicalBodyDefinition {
            movement: profile.definition,
            response_policy: profile.response_policy,
            entity_collision: DynamicBodyCollisionDefinition {
                target_geometry: PreparedEntityTargetGeometry {
                    physics_bsp_parts: Vec::new(),
                    fallback_setup_did: 0x0200_0001,
                    fallback_shapes: vec![Arc::new(CollisionShape::Ball(CollisionBall {
                        center: Vector3::new(0.0, 0.0, 0.5),
                        radius: 0.5,
                    }))],
                    fallback_scale: ColliderScale::uniform(1.0).unwrap(),
                },
                scheduling: holtburger_world::EntityPhysicsScheduling::Eligible,
                dynamic_collision: holtburger_world::EntityDynamicCollisionPolicy {
                    target: EntityCollisionParticipation::Solid,
                    mover_accepts_response: true,
                    accepts_peer_reports: true,
                    missile: false,
                    path_clipped: false,
                },
                reporting: holtburger_world::EntityCollisionReportPolicy {
                    enabled: true,
                    as_environment: false,
                },
                uses_physics_bsp: false,
                weenie_type: WeenieType::Creature,
                elasticity: PhysicalElasticity::DEFAULT,
                default_animation_available: false,
                default_script_available: false,
            },
        }
    }

    #[test]
    fn body_operations_return_committed_facts_and_leave_duplicate_install_untouched() {
        let mut input = definition_input();
        input.placement.world_mut().unwrap().acceleration = Vector3::new(0.0, 0.0, -9.8);
        let definition = DynamicEntityDefinition::prepare(input).unwrap();
        let body_id = SpatialBodyId::Entity(definition.identity.guid);
        let mut scene = SpatialScene::new();

        let initial = world_initial(&definition);
        let installed =
            install_dynamic_entity_body(&mut scene, &definition, initial, None).unwrap();
        assert_eq!(installed.body.acceleration, initial.acceleration);
        assert_eq!(installed.participation, PhysicalBodyParticipation::PoseOnly);
        assert_eq!(
            install_dynamic_entity_body(&mut scene, &definition, initial, None),
            Err(DynamicEntityBodyOperationError::AlreadyRegistered { body_id })
        );
        assert_eq!(
            scene.body(body_id).unwrap().acceleration,
            initial.acceleration
        );
        let projection = dynamic_entity_projection_input(&definition, &scene).unwrap();
        assert_eq!(projection.identity, definition.identity);
        let projected_world = projection.placement.world().unwrap();
        assert_eq!(projected_world.body, installed.body);
        assert_eq!(
            projected_world.participation,
            PhysicalBodyParticipation::PoseOnly
        );

        let previous = definition.physics;
        let enable = decide_entity_physics_state_transition(
            Some(previous),
            previous,
            EntityPhysicsTransitionContext {
                intent: EntityPhysicalIntent::Simulated,
                prepared_physics_available: true,
                solver_participation_enabled: false,
                prepared_definition_changed: false,
            },
        );
        let enabled = apply_dynamic_entity_physics_transition(
            &mut scene,
            body_id,
            enable,
            Some(prepared_physics()),
        )
        .unwrap();
        assert_eq!(enabled.participation, PhysicalBodyParticipation::Physical);
        assert_eq!(
            enabled.physical_change.change,
            PhysicalBodyReconfiguration::SolverParticipationEnabled
        );

        let removed = remove_dynamic_entity_body(&mut scene, body_id).unwrap();
        assert_eq!(removed.participation, PhysicalBodyParticipation::Physical);
        assert!(scene.body(body_id).is_none());
    }

    #[test]
    fn complete_body_replacement_retires_and_installs_the_same_identity_once() {
        let first = DynamicEntityDefinition::prepare(definition_input()).unwrap();
        let mut replacement_input = definition_input();
        replacement_input.placement.world_mut().unwrap().pose.coords = Vector3::new(4.0, 5.0, 6.0);
        replacement_input.placement.world_mut().unwrap().velocity = Vector3::new(1.0, 2.0, 3.0);
        let replacement = DynamicEntityDefinition::prepare(replacement_input).unwrap();
        let body_id = SpatialBodyId::Entity(first.identity.guid);
        let mut scene = SpatialScene::new();
        install_dynamic_entity_body(
            &mut scene,
            &first,
            world_initial(&first),
            Some(prepared_physics()),
        )
        .unwrap();

        let replacement_initial = world_initial(&replacement);
        let outcome =
            replace_dynamic_entity_body(&mut scene, &replacement, replacement_initial, None)
                .unwrap();

        assert_eq!(
            outcome.removed.participation,
            PhysicalBodyParticipation::Physical
        );
        assert_eq!(
            outcome.installed.participation,
            PhysicalBodyParticipation::PoseOnly
        );
        assert_eq!(
            outcome.installed.body.runtime_pose,
            replacement_initial.pose
        );
        assert_eq!(
            scene.body(body_id).unwrap().velocity,
            replacement_initial.velocity
        );
    }

    #[test]
    fn same_identity_replacement_returns_balanced_ends_for_both_report_directions() {
        let created_at = Instant::now();
        let mut first_input = definition_input();
        first_input.placement.world_mut().unwrap().created_at = created_at;
        first_input.placement.world_mut().unwrap().pose = WorldPosition {
            landblock_id: Guid(0xda55_0020),
            coords: Vector3::zero(),
            rotation: Quaternion::identity(),
        };
        let first = DynamicEntityDefinition::prepare(first_input).unwrap();
        let mut peer_input = definition_input();
        peer_input.identity.guid = Guid(0x7000_0002);
        peer_input.placement = first.placement;
        let peer = DynamicEntityDefinition::prepare(peer_input).unwrap();
        let first_id = SpatialBodyId::Entity(first.identity.guid);
        let peer_id = SpatialBodyId::Entity(peer.identity.guid);
        let mut scene = SpatialScene::new();
        install_dynamic_entity_body(
            &mut scene,
            &first,
            world_initial(&first),
            Some(prepared_physics()),
        )
        .unwrap();
        install_dynamic_entity_body(
            &mut scene,
            &peer,
            world_initial(&peer),
            Some(prepared_physics()),
        )
        .unwrap();

        let mut collision = holtburger_world::CollisionScene::new();
        for x in 0xd9_u32..=0xdb {
            for y in 0x54_u32..=0x56 {
                collision
                    .insert(LandblockCollisionAsset {
                        landblock_id: (x << 24) | (y << 16) | 0xffff,
                        terrain: TerrainCollisionSurface::empty(),
                        static_geometry: LandblockColliders::default(),
                    })
                    .unwrap();
            }
        }
        let prepared = scene
            .prepare_dynamic_entity_collection(&collision, 0.1, |_| {
                Ok(PhysicalBodyActuation::Grounded(
                    GroundedBodyActuation::coast(),
                ))
            })
            .unwrap();
        assert!(prepared.coverage_rejections.is_empty());
        let touched_at = created_at + std::time::Duration::from_millis(100);
        let mut started = Vec::new();
        for (body_id, actuation) in prepared.movers {
            let result = scene
                .tick_dynamic_physical_body_transaction(
                    body_id,
                    &collision,
                    actuation,
                    0.1,
                    touched_at,
                    |_, _| Ok(()),
                )
                .unwrap()
                .0;
            started.extend(result.collision_reports);
        }
        started.extend(scene.finish_dynamic_entity_collection(touched_at).unwrap());
        assert_eq!(started.len(), 2);

        let mut despawn_scene = scene.clone();
        let despawned = remove_dynamic_entity_body(&mut despawn_scene, first_id).unwrap();
        assert_eq!(despawned.collision_reports.len(), 2);
        assert!(despawn_scene.body(first_id).is_none());

        let mut replacement_input = definition_input();
        replacement_input.placement.world_mut().unwrap().created_at = touched_at;
        replacement_input.placement.world_mut().unwrap().pose = WorldPosition {
            landblock_id: Guid(0xda55_0020),
            coords: Vector3::new(10.0, 0.0, 0.0),
            rotation: Quaternion::identity(),
        };
        let replacement = DynamicEntityDefinition::prepare(replacement_input).unwrap();
        let replaced = replace_dynamic_entity_body(
            &mut scene,
            &replacement,
            world_initial(&replacement),
            None,
        )
        .unwrap();

        assert_eq!(replaced.removed.collision_reports.len(), 2);
        assert!(replaced.removed.collision_reports.iter().any(|report| {
            report.contact.recipient == first_id
                && matches!(
                    report.contact.source,
                    holtburger_world::CollisionReportSource::DynamicBody { peer, .. }
                        if peer == peer_id
                )
        }));
        assert!(replaced.removed.collision_reports.iter().any(|report| {
            report.contact.recipient == peer_id
                && matches!(
                    report.contact.source,
                    holtburger_world::CollisionReportSource::DynamicBody { peer, .. }
                        if peer == first_id
                )
        }));
    }
}
