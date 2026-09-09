//! Source-neutral interpretation of complete entity physics-state replacements.

use holtburger_common::properties::{ObjectDescriptionFlag, PhysicsState};

/// ACE's physics state when a template has no explicit `PropertyInt::PhysicsState`.
///
/// `ACE.Server.Physics.PhysicsGlobals.DefaultState` is the authority. Keeping the complete value
/// here prevents catalog and live-message adapters from growing separate fallback masks.
pub const DEFAULT_ENTITY_PHYSICS_STATE: PhysicsState = PhysicsState::from_bits_retain(
    PhysicsState::EDGE_SLIDE.bits()
        | PhysicsState::LIGHTING_ON.bits()
        | PhysicsState::GRAVITY.bits()
        | PhysicsState::REPORT_COLLISIONS.bits(),
);

/// Nullable ACE property-bool overrides consumed while constructing an initial effective state.
///
/// Absence preserves the base-mask bit. Explicit `false` clears it and explicit `true` sets it.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct EntityPhysicsStateOverrides {
    /// Nullable replacement for `Ethereal`.
    pub ethereal: Option<bool>,
    /// Nullable replacement for `ReportCollisions`.
    pub report_collisions: Option<bool>,
    /// Nullable replacement for `IgnoreCollisions`.
    pub ignore_collisions: Option<bool>,
    /// Nullable replacement for `NoDraw`.
    pub no_draw: Option<bool>,
    /// Nullable replacement for `Gravity`.
    pub gravity: Option<bool>,
    /// Nullable replacement for `LightingOn`.
    pub lighting: Option<bool>,
    /// Nullable replacement for `ScriptedCollision`.
    pub scripted_collision: Option<bool>,
    /// Nullable replacement for `Inelastic`.
    pub inelastic: Option<bool>,
    /// Nullable replacement for `ReportCollisionsAsEnvironment`.
    pub report_collisions_as_environment: Option<bool>,
    /// Nullable replacement for `EdgeSlide`.
    pub edge_slide: Option<bool>,
    /// Nullable replacement for `Frozen`.
    pub frozen: Option<bool>,
}

/// Setup-owned facts that replace derived bits during initial entity construction.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct EntityPhysicsSetupFacts {
    /// Whether any base setup part carries a physics BSP.
    pub has_physics_bsp: bool,
    /// Whether the setup names a default animation.
    pub has_default_animation: bool,
    /// Whether the setup names a default physics script.
    pub has_default_script: bool,
}

/// Initial template inputs before setup-derived bits have been resolved.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct EntityPhysicsStateInput {
    /// Optional complete base mask. Absence selects [`DEFAULT_ENTITY_PHYSICS_STATE`].
    pub base: Option<PhysicsState>,
    /// Nullable ACE property-bool replacements.
    pub overrides: EntityPhysicsStateOverrides,
}

/// State-derived eligibility for fixed-tick integration.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntityIntegrationEligibility {
    /// The state itself permits integration. Solver-owned settled state remains a separate gate.
    Eligible,
    /// `Frozen` reversibly pauses integration and default behavior.
    Frozen,
    /// `Static` is preserved but unsupported for locally simulated dynamic entities.
    Static,
}

/// Collision character of an entity in one collision domain.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntityCollisionParticipation {
    /// Hidden objects or the retail `Ethereal|IgnoreCollisions` pair do not enter peer queries.
    Suppressed,
    /// Contacts may be observed but do not obstruct the other participant.
    Ethereal,
    /// Ordinary contact and response are eligible.
    Solid,
}

/// Public player collision status, independent from physics-state hooks and geometry.
/// The private mask preserves simultaneous wire flags without exposing unrelated description bits.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PlayerCollisionStatus(ObjectDescriptionFlag);

impl PlayerCollisionStatus {
    /// Non-player descriptions have no player-pair exemption.
    pub fn from_description(flags: ObjectDescriptionFlag) -> Option<Self> {
        flags
            .contains(ObjectDescriptionFlag::PLAYER)
            .then_some(Self(
                flags
                    & (ObjectDescriptionFlag::PLAYER_KILLER
                        | ObjectDescriptionFlag::PK_LITE_STATUS
                        | ObjectDescriptionFlag::FREE_PK_STATUS),
            ))
    }

    /// Retail FindObjCollisions (acclient.c:304666): matching PK classes or either
    /// impenetrable player disable the ordinary player/player exemption.
    fn blocks(self, peer: Self) -> bool {
        (self.0 | peer.0).contains(ObjectDescriptionFlag::FREE_PK_STATUS)
            || (self.0 & peer.0).intersects(
                ObjectDescriptionFlag::PLAYER_KILLER | ObjectDescriptionFlag::PK_LITE_STATUS,
            )
    }
}

/// Whether player identity exempts this pair from collision queries and reports.
fn players_ignore_contact(
    first: Option<PlayerCollisionStatus>,
    second: Option<PlayerCollisionStatus>,
) -> bool {
    matches!((first, second), (Some(first), Some(second)) if !first.blocks(second))
}

/// State-derived dynamic collision decisions, independent from target geometry availability.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EntityDynamicCollisionPolicy {
    /// Authored Static bit; sleeping and integration exclusion do not imply staticness.
    pub is_static: bool,
    /// Whether this entity can be selected as a peer target.
    pub target: EntityCollisionParticipation,
    /// Whether this entity accepts response when acting as the directional mover.
    pub mover_accepts_response: bool,
    /// Whether a peer may retain a collision report naming this entity.
    pub accepts_peer_reports: bool,
    /// Missile classification used by the shared directional contact filter.
    pub missile: bool,
    /// Retained projectile path marker cleared by an accepted missile collision.
    pub path_clipped: bool,
}

/// Directional outcome of the complete semantic pair filter, before geometry or report permissions.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntityContactInteraction {
    /// Skip pair geometry, including contact observations.
    Ignored,
    /// Contact can be observed but cannot obstruct this mover.
    Observable,
    /// The target may obstruct this mover and contact can be observed.
    Blocking,
}

impl EntityDynamicCollisionPolicy {
    /// Resolves pair semantics once for physical response, reporting, and prospective solidification.
    /// Residency and geometry availability remain preparation-owned. Client projectile targets have
    /// no proven nonzero producer, so only the demonstrated untargeted missile exclusions apply.
    pub fn contact_with(
        self,
        target: Self,
        player: Option<PlayerCollisionStatus>,
        target_player: Option<PlayerCollisionStatus>,
    ) -> EntityContactInteraction {
        if players_ignore_contact(player, target_player)
            || target.target == EntityCollisionParticipation::Suppressed
            || target.missile
            || (self.missile && target.target == EntityCollisionParticipation::Ethereal)
        {
            EntityContactInteraction::Ignored
        } else if self.mover_accepts_response
            && target.target == EntityCollisionParticipation::Solid
            && (self.target != EntityCollisionParticipation::Ethereal || target.is_static)
        {
            EntityContactInteraction::Blocking
        } else {
            EntityContactInteraction::Observable
        }
    }
}

/// Complete state-derived response policy before authored coefficients and geometry are joined.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EntityPhysicsResponse {
    /// Gravity is eligible while the solver does not retain walkable support.
    pub gravity: bool,
    /// Accepted impacts stop all linear motion rather than applying elasticity.
    pub inelastic: bool,
    /// Orientation follows velocity after response.
    pub align_path: bool,
    /// Retail creature edge-slide behavior is enabled.
    pub edge_slide: bool,
}

/// Directional collision-report policy derived without consulting peer state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EntityCollisionReportPolicy {
    /// Whether confirmed eligible contact owns a retained report lifetime.
    pub enabled: bool,
    /// Whether peer reports are classified through the environment channel.
    pub as_environment: bool,
}

/// Presentation-owned consequences of a complete physics-state replacement.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EntityPhysicsPresentation {
    /// `NoDraw` suppresses ordinary rendering without changing physics.
    pub no_draw: bool,
    /// `Hidden` suppresses presentation and locally observable collision/reporting.
    pub hidden: bool,
    /// `Cloaked` selects presentation-owned translucency behavior.
    pub cloaked: bool,
    /// Whether authored lighting participates in presentation.
    pub lighting: bool,
    /// Whether the state requests the setup default animation.
    pub default_animation: bool,
    /// Whether the state requests the setup default physics script.
    pub default_script: bool,
}

/// One complete semantic state plus every state-only decision consumed by later layers.
///
/// Geometry, authored response coefficients, category filters, and producer body intent are joined
/// during physical preparation. Consumers use these named decisions and never reinterpret bits.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EffectiveEntityPhysicsState {
    /// Complete state exactly as produced after initial precedence or received from a live update.
    pub semantic: PhysicsState,
    /// Bits unknown to this build. They remain losslessly visible and block local simulation.
    pub unknown_bits: u32,
    /// Known state bits whose local physical behavior is deliberately unsupported.
    pub unsupported_local_simulation: PhysicsState,
    /// Known gameplay marker preserved without changing the proven physical contact path.
    pub unsupported_gameplay: PhysicsState,
    /// Integration eligibility derived from the semantic mask.
    pub integration_eligibility: EntityIntegrationEligibility,
    /// Directional peer collision decisions derived from the semantic mask.
    pub dynamic_collision: EntityDynamicCollisionPolicy,
    /// Environment and peer response decisions derived from the semantic mask.
    pub response: EntityPhysicsResponse,
    /// Directional contact reporting decision derived from the semantic mask.
    pub reporting: EntityCollisionReportPolicy,
    /// Presentation consequences derived from the semantic mask.
    pub presentation: EntityPhysicsPresentation,
    /// Selects the prepared physics-BSP target branch rather than setup fallback volumes.
    pub uses_physics_bsp: bool,
}

impl EffectiveEntityPhysicsState {
    /// Whether this state can participate in local simulation once preparation supplies geometry.
    pub const fn supports_local_simulation(self) -> bool {
        self.unknown_bits == 0 && self.unsupported_local_simulation.is_empty()
    }
}

/// Host-authored collision transition layered over the latest admitted server state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AuthoredEtherealTransition {
    /// Effective physics is exactly the latest admitted server state.
    Reconciled,
    /// An authored hook temporarily overrides the server's `Ethereal` bit.
    Predicted { ethereal: bool },
    /// Solidification was requested but a dynamic peer still occupies the object.
    PendingSolidification,
}

/// One invariant-bearing entity physics state with explicit server and prediction ownership.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EntityPhysicsRuntimeState {
    authoritative: EffectiveEntityPhysicsState,
    effective: EffectiveEntityPhysicsState,
    authored_transition: AuthoredEtherealTransition,
}

impl EntityPhysicsRuntimeState {
    /// Starts reconciled from one complete create or `SetState` value.
    pub const fn reconciled(authoritative: EffectiveEntityPhysicsState) -> Self {
        Self {
            authoritative,
            effective: authoritative,
            authored_transition: AuthoredEtherealTransition::Reconciled,
        }
    }

    /// Latest admitted server state, independent from local hook timing.
    #[cfg(test)]
    pub(crate) const fn authoritative(self) -> EffectiveEntityPhysicsState {
        self.authoritative
    }

    /// Latest server classification survives local impact retirement until a complete state update.
    pub const fn is_authoritative_projectile(self) -> bool {
        self.authoritative.dynamic_collision.missile
    }

    /// Publishes a local collision consequence without rewriting the last server state.
    pub(crate) fn clear_after_collision(&mut self, cleared: PhysicsState) {
        let mut semantic = self.effective.semantic;
        semantic.remove(cleared);
        self.effective = resolve_effective_entity_physics_state(semantic);
    }

    /// Single collision and presentation state consumed by downstream systems.
    pub const fn effective(self) -> EffectiveEntityPhysicsState {
        self.effective
    }

    /// Current relationship between authored prediction and server authority.
    #[cfg(test)]
    pub(crate) const fn authored_transition(self) -> AuthoredEtherealTransition {
        self.authored_transition
    }

    /// Replaces server authority and retires any obsolete authored transition.
    pub fn reconcile(&mut self, authoritative: EffectiveEntityPhysicsState) {
        *self = Self::reconciled(authoritative);
    }

    /// Applies an unobstructed authored replacement for the `Ethereal` bit.
    pub fn apply_authored_ethereal(&mut self, ethereal: bool) {
        let mut semantic = self.effective.semantic;
        semantic.set(PhysicsState::ETHEREAL, ethereal);
        self.effective = resolve_effective_entity_physics_state(semantic);
        self.authored_transition = if self.effective.semantic.contains(PhysicsState::ETHEREAL)
            == self.authoritative.semantic.contains(PhysicsState::ETHEREAL)
        {
            AuthoredEtherealTransition::Reconciled
        } else {
            AuthoredEtherealTransition::Predicted { ethereal }
        };
    }

    /// Keeps the entity ethereal until a later collision-free retry can make it solid.
    pub fn defer_authored_solidification(&mut self) {
        let mut semantic = self.effective.semantic;
        semantic.insert(PhysicsState::ETHEREAL);
        self.effective = resolve_effective_entity_physics_state(semantic);
        self.authored_transition = AuthoredEtherealTransition::PendingSolidification;
    }

    /// Whether retail's blocked solidification retry is still outstanding.
    pub const fn has_pending_solidification(self) -> bool {
        matches!(
            self.authored_transition,
            AuthoredEtherealTransition::PendingSolidification
        )
    }
}

/// Whether prepared target geometry is retained for directional peer queries.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LocalTargetDemand {
    /// Do not retain or index peer-target geometry.
    Absent,
    /// Retain prepared geometry and index it while topology is resident.
    Retained,
}

/// Whether a producer permits fixed-tick environment and peer solving.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LocalIntegrationDemand {
    /// Keep the body out of the mover schedule.
    Excluded,
    /// Permit scheduling while solver-owned activity is active.
    Eligible,
}

/// Producer-owned demand for the two independent uses of prepared local physics.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LocalPhysicalDemand {
    /// Whether other movers may discover this body as a peer target.
    pub target: LocalTargetDemand,
    /// Whether this body may enter fixed-tick integration.
    pub integration: LocalIntegrationDemand,
}

impl LocalPhysicalDemand {
    /// Demand that requires no prepared local physical state.
    pub const NONE: Self = Self {
        target: LocalTargetDemand::Absent,
        integration: LocalIntegrationDemand::Excluded,
    };

    /// Whether at least one local physical role requires a prepared body.
    pub const fn requires_physical_body(self) -> bool {
        !matches!(
            (self.target, self.integration),
            (LocalTargetDemand::Absent, LocalIntegrationDemand::Excluded)
        )
    }
}

/// Applies ACE template precedence and immediately resolves the resulting complete state.
pub fn calculate_effective_entity_physics_state(
    input: EntityPhysicsStateInput,
    setup: EntityPhysicsSetupFacts,
) -> EffectiveEntityPhysicsState {
    let mut state = input.base.unwrap_or(DEFAULT_ENTITY_PHYSICS_STATE);
    for (bit, replacement) in [
        (PhysicsState::ETHEREAL, input.overrides.ethereal),
        (
            PhysicsState::REPORT_COLLISIONS,
            input.overrides.report_collisions,
        ),
        (
            PhysicsState::IGNORE_COLLISIONS,
            input.overrides.ignore_collisions,
        ),
        (PhysicsState::NO_DRAW, input.overrides.no_draw),
        (PhysicsState::GRAVITY, input.overrides.gravity),
        (PhysicsState::LIGHTING_ON, input.overrides.lighting),
        (
            PhysicsState::SCRIPTED_COLLISION,
            input.overrides.scripted_collision,
        ),
        (PhysicsState::INELASTIC, input.overrides.inelastic),
        (
            PhysicsState::REPORT_COLLISIONS_AS_ENVIRONMENT,
            input.overrides.report_collisions_as_environment,
        ),
        (PhysicsState::EDGE_SLIDE, input.overrides.edge_slide),
        (PhysicsState::FROZEN, input.overrides.frozen),
    ] {
        if let Some(enabled) = replacement {
            state.set(bit, enabled);
        }
    }

    state.set(PhysicsState::HAS_PHYSICS_BSP, setup.has_physics_bsp);
    let is_static = state.contains(PhysicsState::STATIC);
    state.set(
        PhysicsState::HAS_DEFAULT_ANIM,
        is_static && setup.has_default_animation,
    );
    state.set(
        PhysicsState::HAS_DEFAULT_SCRIPT,
        is_static && setup.has_default_script,
    );

    resolve_effective_entity_physics_state(state)
}

/// Resolves named decisions from an already complete create or `SetState` mask.
pub fn resolve_effective_entity_physics_state(
    semantic: PhysicsState,
) -> EffectiveEntityPhysicsState {
    let unknown_bits = semantic.bits() & !PhysicsState::all().bits();
    let unsupported_local_simulation = semantic
        & (PhysicsState::STATIC
            | PhysicsState::UNUSED1
            | PhysicsState::PUSHABLE
            | PhysicsState::PARTICLE_EMITTER
            | PhysicsState::UNUSED2
            | PhysicsState::SLEDDING);
    let hidden = semantic.contains(PhysicsState::HIDDEN);
    let ethereal = semantic.contains(PhysicsState::ETHEREAL);
    let ignore_collisions = semantic.contains(PhysicsState::IGNORE_COLLISIONS);
    let target = if hidden || (ethereal && ignore_collisions) {
        EntityCollisionParticipation::Suppressed
    } else if ethereal {
        EntityCollisionParticipation::Ethereal
    } else {
        EntityCollisionParticipation::Solid
    };
    let integration_eligibility = if semantic.contains(PhysicsState::STATIC) {
        EntityIntegrationEligibility::Static
    } else if semantic.contains(PhysicsState::FROZEN) {
        EntityIntegrationEligibility::Frozen
    } else {
        EntityIntegrationEligibility::Eligible
    };

    EffectiveEntityPhysicsState {
        semantic,
        unknown_bits,
        unsupported_local_simulation,
        unsupported_gameplay: semantic & PhysicsState::SCRIPTED_COLLISION,
        integration_eligibility,
        dynamic_collision: EntityDynamicCollisionPolicy {
            is_static: semantic.contains(PhysicsState::STATIC),
            target,
            mover_accepts_response: !hidden && !ignore_collisions,
            accepts_peer_reports: !hidden && !ignore_collisions,
            missile: semantic.contains(PhysicsState::MISSILE),
            path_clipped: semantic.contains(PhysicsState::PATH_CLIPPED),
        },
        response: EntityPhysicsResponse {
            gravity: semantic.contains(PhysicsState::GRAVITY),
            inelastic: semantic.contains(PhysicsState::INELASTIC),
            align_path: semantic.contains(PhysicsState::ALIGN_PATH),
            edge_slide: semantic.contains(PhysicsState::EDGE_SLIDE),
        },
        reporting: EntityCollisionReportPolicy {
            enabled: !hidden && semantic.contains(PhysicsState::REPORT_COLLISIONS),
            as_environment: semantic.contains(PhysicsState::REPORT_COLLISIONS_AS_ENVIRONMENT),
        },
        presentation: EntityPhysicsPresentation {
            no_draw: semantic.contains(PhysicsState::NO_DRAW),
            hidden,
            cloaked: semantic.contains(PhysicsState::CLOAKED),
            lighting: semantic.contains(PhysicsState::LIGHTING_ON),
            default_animation: semantic.contains(PhysicsState::HAS_DEFAULT_ANIM),
            default_script: semantic.contains(PhysicsState::HAS_DEFAULT_SCRIPT),
        },
        uses_physics_bsp: semantic.contains(PhysicsState::HAS_PHYSICS_BSP),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn impact_retirement_survives_authored_ethereal_changes_until_server_reconciliation() {
        let flags = PhysicsState::MISSILE | PhysicsState::ALIGN_PATH | PhysicsState::PATH_CLIPPED;
        let authoritative = resolve_effective_entity_physics_state(flags);
        let mut state = EntityPhysicsRuntimeState::reconciled(authoritative);
        state.clear_after_collision(flags);
        assert_eq!(state.authoritative(), authoritative);
        for ethereal in [true, false] {
            state.apply_authored_ethereal(ethereal);
            assert!(!state.effective().dynamic_collision.missile);
            assert_eq!(
                state.effective().semantic.contains(PhysicsState::ETHEREAL),
                ethereal
            );
        }
        assert_eq!(
            state.authored_transition(),
            AuthoredEtherealTransition::Reconciled
        );
        state.defer_authored_solidification();
        assert!(!state.effective().dynamic_collision.missile);
        assert!(state.has_pending_solidification());
        state.reconcile(authoritative);
        assert_eq!(state.effective(), authoritative);
        assert!(!state.has_pending_solidification());
    }

    #[test]
    fn authored_ethereal_prediction_is_separate_and_reconciled_by_server_state() {
        let solid = resolve_effective_entity_physics_state(PhysicsState::REPORT_COLLISIONS);
        let mut runtime = EntityPhysicsRuntimeState::reconciled(solid);

        runtime.apply_authored_ethereal(true);
        assert_eq!(runtime.authoritative(), solid);
        assert!(
            runtime
                .effective()
                .semantic
                .contains(PhysicsState::ETHEREAL)
        );
        assert_eq!(
            runtime.authored_transition(),
            AuthoredEtherealTransition::Predicted { ethereal: true }
        );

        runtime.reconcile(solid);
        assert_eq!(runtime.effective(), solid);
        assert_eq!(
            runtime.authored_transition(),
            AuthoredEtherealTransition::Reconciled
        );
    }

    #[test]
    fn obstructed_solidification_remains_ethereal_until_a_retry_clears() {
        let ethereal = resolve_effective_entity_physics_state(PhysicsState::ETHEREAL);
        let mut runtime = EntityPhysicsRuntimeState::reconciled(ethereal);

        runtime.defer_authored_solidification();
        assert!(runtime.has_pending_solidification());
        assert!(
            runtime
                .effective()
                .semantic
                .contains(PhysicsState::ETHEREAL)
        );

        runtime.apply_authored_ethereal(false);
        assert!(!runtime.has_pending_solidification());
        assert!(
            !runtime
                .effective()
                .semantic
                .contains(PhysicsState::ETHEREAL)
        );
        assert_eq!(runtime.authoritative(), ethereal);
    }

    #[test]
    fn initial_state_applies_absent_false_true_and_setup_precedence() {
        let resolved = calculate_effective_entity_physics_state(
            EntityPhysicsStateInput {
                base: Some(
                    PhysicsState::ETHEREAL
                        | PhysicsState::REPORT_COLLISIONS
                        | PhysicsState::HAS_DEFAULT_ANIM,
                ),
                overrides: EntityPhysicsStateOverrides {
                    ethereal: None,
                    report_collisions: Some(false),
                    gravity: Some(true),
                    ..EntityPhysicsStateOverrides::default()
                },
            },
            EntityPhysicsSetupFacts {
                has_physics_bsp: true,
                has_default_animation: true,
                has_default_script: true,
            },
        );

        assert!(resolved.semantic.contains(PhysicsState::ETHEREAL));
        assert!(!resolved.semantic.contains(PhysicsState::REPORT_COLLISIONS));
        assert!(resolved.semantic.contains(PhysicsState::GRAVITY));
        assert!(resolved.semantic.contains(PhysicsState::HAS_PHYSICS_BSP));
        assert!(!resolved.semantic.contains(PhysicsState::HAS_DEFAULT_ANIM));
        assert!(!resolved.semantic.contains(PhysicsState::HAS_DEFAULT_SCRIPT));
    }

    #[test]
    fn default_behavior_bits_are_replaced_only_for_static_setup_behavior() {
        let resolved = calculate_effective_entity_physics_state(
            EntityPhysicsStateInput {
                base: Some(PhysicsState::STATIC),
                overrides: EntityPhysicsStateOverrides::default(),
            },
            EntityPhysicsSetupFacts {
                has_physics_bsp: false,
                has_default_animation: true,
                has_default_script: false,
            },
        );

        assert!(resolved.semantic.contains(PhysicsState::HAS_DEFAULT_ANIM));
        assert!(!resolved.semantic.contains(PhysicsState::HAS_DEFAULT_SCRIPT));
        assert_eq!(
            resolved.integration_eligibility,
            EntityIntegrationEligibility::Static
        );
        assert!(!resolved.supports_local_simulation());
    }

    #[test]
    fn state_decisions_do_not_flatten_collision_response_reporting_or_visibility() {
        let resolved = resolve_effective_entity_physics_state(
            PhysicsState::ETHEREAL
                | PhysicsState::IGNORE_COLLISIONS
                | PhysicsState::REPORT_COLLISIONS
                | PhysicsState::REPORT_COLLISIONS_AS_ENVIRONMENT
                | PhysicsState::INELASTIC
                | PhysicsState::NO_DRAW,
        );

        assert_eq!(
            resolved.dynamic_collision.target,
            EntityCollisionParticipation::Suppressed
        );
        assert!(!resolved.dynamic_collision.mover_accepts_response);
        assert!(!resolved.dynamic_collision.accepts_peer_reports);
        assert!(resolved.reporting.enabled);
        assert!(resolved.reporting.as_environment);
        assert!(resolved.response.inelastic);
        assert!(resolved.presentation.no_draw);
        assert!(resolved.supports_local_simulation());
    }

    #[test]
    fn hidden_derives_runtime_consequences_without_rewriting_semantic_truth() {
        let semantic = PhysicsState::HIDDEN | PhysicsState::REPORT_COLLISIONS;
        let resolved = resolve_effective_entity_physics_state(semantic);

        assert_eq!(resolved.semantic, semantic);
        assert_eq!(
            resolved.dynamic_collision.target,
            EntityCollisionParticipation::Suppressed
        );
        assert!(!resolved.dynamic_collision.mover_accepts_response);
        assert!(!resolved.dynamic_collision.accepts_peer_reports);
        assert!(!resolved.reporting.enabled);
        assert!(resolved.presentation.hidden);
    }

    #[test]
    fn unknown_and_known_unsupported_bits_remain_visible() {
        let unknown = 0x8000_0000;
        let unsupported = PhysicsState::STATIC
            | PhysicsState::UNUSED1
            | PhysicsState::PUSHABLE
            | PhysicsState::PARTICLE_EMITTER
            | PhysicsState::UNUSED2
            | PhysicsState::SLEDDING;
        let semantic = PhysicsState::from_bits_retain(
            unsupported.bits() | PhysicsState::SCRIPTED_COLLISION.bits() | unknown,
        );
        let resolved = resolve_effective_entity_physics_state(semantic);

        assert_eq!(resolved.semantic.bits(), semantic.bits());
        assert_eq!(resolved.unknown_bits, unknown);
        assert_eq!(resolved.unsupported_local_simulation, unsupported);
        assert_eq!(
            resolved.unsupported_gameplay,
            PhysicsState::SCRIPTED_COLLISION
        );
        assert!(!resolved.supports_local_simulation());
    }

    #[test]
    fn remaining_supported_bits_keep_their_distinct_named_decisions() {
        let semantic = PhysicsState::MISSILE
            | PhysicsState::PATH_CLIPPED
            | PhysicsState::ALIGN_PATH
            | PhysicsState::GRAVITY
            | PhysicsState::LIGHTING_ON
            | PhysicsState::HAS_PHYSICS_BSP
            | PhysicsState::INELASTIC
            | PhysicsState::HAS_DEFAULT_ANIM
            | PhysicsState::HAS_DEFAULT_SCRIPT
            | PhysicsState::CLOAKED
            | PhysicsState::EDGE_SLIDE
            | PhysicsState::FROZEN;
        let resolved = resolve_effective_entity_physics_state(semantic);

        assert_eq!(resolved.semantic, semantic);
        assert_eq!(
            resolved.integration_eligibility,
            EntityIntegrationEligibility::Frozen
        );
        assert!(resolved.dynamic_collision.missile);
        assert!(resolved.dynamic_collision.path_clipped);
        assert!(resolved.response.align_path);
        assert!(resolved.response.gravity);
        assert!(resolved.response.inelastic);
        assert!(resolved.response.edge_slide);
        assert!(resolved.presentation.lighting);
        assert!(resolved.presentation.default_animation);
        assert!(resolved.presentation.default_script);
        assert!(resolved.presentation.cloaked);
        assert!(resolved.uses_physics_bsp);
        assert!(resolved.supports_local_simulation());
    }

    #[test]
    fn local_physical_demand_distinguishes_all_four_role_combinations() {
        for (target, integration, requires_body) in [
            (
                LocalTargetDemand::Absent,
                LocalIntegrationDemand::Excluded,
                false,
            ),
            (
                LocalTargetDemand::Retained,
                LocalIntegrationDemand::Excluded,
                true,
            ),
            (
                LocalTargetDemand::Absent,
                LocalIntegrationDemand::Eligible,
                true,
            ),
            (
                LocalTargetDemand::Retained,
                LocalIntegrationDemand::Eligible,
                true,
            ),
        ] {
            assert_eq!(
                LocalPhysicalDemand {
                    target,
                    integration
                }
                .requires_physical_body(),
                requires_body
            );
        }
    }
}

#[cfg(test)]
mod contact_eligibility_tests {
    use super::*;

    #[test]
    fn player_matrix_is_symmetric_and_excludes_only_player_pairs() {
        let statuses = [
            ObjectDescriptionFlag::empty(),
            ObjectDescriptionFlag::PLAYER_KILLER,
            ObjectDescriptionFlag::PK_LITE_STATUS,
            ObjectDescriptionFlag::FREE_PK_STATUS,
        ]
        .map(|flags| {
            PlayerCollisionStatus::from_description(flags | ObjectDescriptionFlag::PLAYER)
        });
        let blocks = [
            [false, false, false, true],
            [false, true, false, true],
            [false, false, true, true],
            [true, true, true, true],
        ];
        let solid = resolve_effective_entity_physics_state(PhysicsState::empty()).dynamic_collision;
        for (i, first) in statuses.into_iter().enumerate() {
            for (j, second) in statuses.into_iter().enumerate() {
                assert_eq!(
                    solid.contact_with(solid, first, second) == EntityContactInteraction::Blocking,
                    blocks[i][j]
                );
            }
            assert_eq!(
                solid.contact_with(solid, first, None),
                EntityContactInteraction::Blocking
            );
            assert_eq!(
                solid.contact_with(solid, None, first),
                EntityContactInteraction::Blocking
            );
        }
    }

    #[test]
    fn ethereal_response_distinguishes_authored_static_from_frozen() {
        let ethereal =
            resolve_effective_entity_physics_state(PhysicsState::ETHEREAL).dynamic_collision;
        for (flags, responds) in [
            (PhysicsState::empty(), false),
            (PhysicsState::FROZEN, false),
            (PhysicsState::STATIC, true),
        ] {
            let solid = resolve_effective_entity_physics_state(flags).dynamic_collision;
            assert_eq!(
                ethereal.contact_with(solid, None, None) == EntityContactInteraction::Blocking,
                responds
            );
            assert_eq!(
                solid.contact_with(ethereal, None, None),
                EntityContactInteraction::Observable
            );
            // Ordinary ethereal contacts remain observable despite not blocking.
        }
    }

    #[test]
    fn missile_query_exclusions_are_directional() {
        let policy = |flags| resolve_effective_entity_physics_state(flags).dynamic_collision;
        let missile = policy(PhysicsState::MISSILE);
        let solid = policy(PhysicsState::empty());
        let ethereal = policy(PhysicsState::ETHEREAL);
        assert_eq!(
            solid.contact_with(missile, None, None),
            EntityContactInteraction::Ignored
        );
        assert_eq!(
            missile.contact_with(missile, None, None),
            EntityContactInteraction::Ignored
        );
        assert_eq!(
            missile.contact_with(ethereal, None, None),
            EntityContactInteraction::Ignored
        );
        assert_eq!(
            missile.contact_with(solid, None, None),
            EntityContactInteraction::Blocking
        );
    }
}
