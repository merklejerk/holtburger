//! Source-neutral interpretation of complete entity physics-state replacements.

use holtburger_common::properties::PhysicsState;
use serde::{Deserialize, Serialize};

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

/// Whether fixed-tick integration may schedule this entity.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntityPhysicsScheduling {
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

/// State-derived dynamic collision decisions, independent from target geometry availability.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EntityDynamicCollisionPolicy {
    /// Whether this entity can be selected as a peer target.
    pub target: EntityCollisionParticipation,
    /// Whether this entity accepts response when acting as the directional mover.
    pub mover_accepts_response: bool,
    /// Whether a peer may retain a collision report naming this entity.
    pub accepts_peer_reports: bool,
    /// Missile filtering is a distinct pair predicate with live target/category inputs.
    pub missile: bool,
    /// Retained projectile path marker cleared by an accepted missile collision.
    pub path_clipped: bool,
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
    /// Fixed-tick scheduling decision derived from the semantic mask.
    pub scheduling: EntityPhysicsScheduling,
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

    fn physical_decisions_equal(self, other: Self) -> bool {
        self.scheduling == other.scheduling
            && self.dynamic_collision == other.dynamic_collision
            && self.response == other.response
            && self.reporting == other.reporting
            && self.uses_physics_bsp == other.uses_physics_bsp
    }
}

/// Whether a producer requests local physical realization for this semantic entity.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum EntityPhysicalIntent {
    /// Keep only the canonical pose body; presentation remains valid.
    PoseOnly,
    /// Install local collision and solver state when preparation succeeds.
    Simulated,
}

/// Facts outside the state mask required to choose a scene operation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EntityPhysicsTransitionContext {
    /// Producer policy for whether this entity should be locally simulated.
    pub intent: EntityPhysicalIntent,
    /// Whether immutable content preparation produced a usable physical definition.
    pub prepared_physics_available: bool,
    /// Whether the canonical pose body currently carries physical state.
    pub physical_body_attached: bool,
    /// Scale, geometry, category, or another prepared non-state fact changed.
    pub prepared_definition_changed: bool,
}

/// Desired local realization after a complete semantic replacement.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntityPhysicalDisposition {
    PoseOnly,
    Physical,
    /// The complete semantic state is retained, but local simulation must stop.
    UnsupportedState {
        unsupported_bits: PhysicsState,
        unknown_bits: u32,
    },
    /// A simulated producer requested a body before content preparation supplied one.
    MissingPreparedPhysics,
}

/// Exact scene mutation required by one complete state replacement.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntityPhysicalTransitionAction {
    None,
    Attach,
    Detach,
    Reconfigure,
}

/// Pure state-replacement decision consumed by both producer compositions.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EntityPhysicsTransitionDecision {
    /// Exact mutation to apply to the canonical scene body.
    pub action: EntityPhysicalTransitionAction,
    /// Resulting local physical disposition, including typed unsupported cases.
    pub disposition: EntityPhysicalDisposition,
    /// Existing directional report lifetimes must end before the replacement is committed.
    pub force_end_reports: bool,
    /// Solver-owned settled state must be cleared before the next eligible tick.
    pub wake_solver: bool,
}

/// Selects the body operation for a complete effective-state replacement.
///
/// This function deliberately does not choose Explorer rejection versus authoritative-client
/// retention. Both receive the same unsupported disposition: Explorer rejects before publication;
/// the client preserves semantic truth and applies the returned detach when necessary.
pub fn decide_entity_physics_state_transition(
    previous: Option<EffectiveEntityPhysicsState>,
    next: EffectiveEntityPhysicsState,
    context: EntityPhysicsTransitionContext,
) -> EntityPhysicsTransitionDecision {
    let disposition = match context.intent {
        EntityPhysicalIntent::PoseOnly => EntityPhysicalDisposition::PoseOnly,
        EntityPhysicalIntent::Simulated if !next.supports_local_simulation() => {
            EntityPhysicalDisposition::UnsupportedState {
                unsupported_bits: next.unsupported_local_simulation,
                unknown_bits: next.unknown_bits,
            }
        }
        EntityPhysicalIntent::Simulated if !context.prepared_physics_available => {
            EntityPhysicalDisposition::MissingPreparedPhysics
        }
        EntityPhysicalIntent::Simulated => EntityPhysicalDisposition::Physical,
    };
    let action = match (context.physical_body_attached, disposition) {
        (true, EntityPhysicalDisposition::Physical)
            if context.prepared_definition_changed
                || previous.is_none_or(|previous| !previous.physical_decisions_equal(next)) =>
        {
            EntityPhysicalTransitionAction::Reconfigure
        }
        (true, EntityPhysicalDisposition::Physical) => EntityPhysicalTransitionAction::None,
        (false, EntityPhysicalDisposition::Physical) => EntityPhysicalTransitionAction::Attach,
        (true, _) => EntityPhysicalTransitionAction::Detach,
        (false, _) => EntityPhysicalTransitionAction::None,
    };
    let force_end_reports = previous.is_some_and(|previous| previous.reporting.enabled)
        && (!next.reporting.enabled || !matches!(disposition, EntityPhysicalDisposition::Physical));
    let scheduling_woke = previous.is_some_and(|previous| {
        previous.scheduling != EntityPhysicsScheduling::Eligible
            && next.scheduling == EntityPhysicsScheduling::Eligible
    });

    EntityPhysicsTransitionDecision {
        action,
        disposition,
        force_end_reports,
        wake_solver: scheduling_woke
            || matches!(
                action,
                EntityPhysicalTransitionAction::Attach
                    | EntityPhysicalTransitionAction::Reconfigure
            ),
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
    let scheduling = if semantic.contains(PhysicsState::STATIC) {
        EntityPhysicsScheduling::Static
    } else if semantic.contains(PhysicsState::FROZEN) {
        EntityPhysicsScheduling::Frozen
    } else {
        EntityPhysicsScheduling::Eligible
    };

    EffectiveEntityPhysicsState {
        semantic,
        unknown_bits,
        unsupported_local_simulation,
        unsupported_gameplay: semantic & PhysicsState::SCRIPTED_COLLISION,
        scheduling,
        dynamic_collision: EntityDynamicCollisionPolicy {
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
        assert_eq!(resolved.scheduling, EntityPhysicsScheduling::Static);
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
        assert_eq!(resolved.scheduling, EntityPhysicsScheduling::Frozen);
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
    fn transition_ignores_presentation_only_changes_but_reconfigures_physical_changes() {
        let previous = resolve_effective_entity_physics_state(PhysicsState::GRAVITY);
        let presentation =
            resolve_effective_entity_physics_state(PhysicsState::GRAVITY | PhysicsState::NO_DRAW);
        let physical =
            resolve_effective_entity_physics_state(PhysicsState::GRAVITY | PhysicsState::FROZEN);
        let context = EntityPhysicsTransitionContext {
            intent: EntityPhysicalIntent::Simulated,
            prepared_physics_available: true,
            physical_body_attached: true,
            prepared_definition_changed: false,
        };

        assert_eq!(
            decide_entity_physics_state_transition(Some(previous), presentation, context).action,
            EntityPhysicalTransitionAction::None
        );
        assert_eq!(
            decide_entity_physics_state_transition(Some(previous), physical, context).action,
            EntityPhysicalTransitionAction::Reconfigure
        );
    }

    #[test]
    fn transition_detaches_unsupported_state_without_losing_its_mask() {
        let previous = resolve_effective_entity_physics_state(PhysicsState::REPORT_COLLISIONS);
        let next = resolve_effective_entity_physics_state(
            PhysicsState::REPORT_COLLISIONS | PhysicsState::PUSHABLE,
        );
        let decision = decide_entity_physics_state_transition(
            Some(previous),
            next,
            EntityPhysicsTransitionContext {
                intent: EntityPhysicalIntent::Simulated,
                prepared_physics_available: true,
                physical_body_attached: true,
                prepared_definition_changed: false,
            },
        );

        assert_eq!(decision.action, EntityPhysicalTransitionAction::Detach);
        assert_eq!(
            decision.disposition,
            EntityPhysicalDisposition::UnsupportedState {
                unsupported_bits: PhysicsState::PUSHABLE,
                unknown_bits: 0,
            }
        );
        assert!(decision.force_end_reports);
        assert_eq!(
            next.semantic,
            PhysicsState::REPORT_COLLISIONS | PhysicsState::PUSHABLE
        );
    }

    #[test]
    fn bodyless_intent_never_invents_physical_participation() {
        let next = resolve_effective_entity_physics_state(PhysicsState::GRAVITY);
        let decision = decide_entity_physics_state_transition(
            None,
            next,
            EntityPhysicsTransitionContext {
                intent: EntityPhysicalIntent::PoseOnly,
                prepared_physics_available: true,
                physical_body_attached: false,
                prepared_definition_changed: false,
            },
        );

        assert_eq!(decision.action, EntityPhysicalTransitionAction::None);
        assert_eq!(decision.disposition, EntityPhysicalDisposition::PoseOnly);
    }

    #[test]
    fn simulated_intent_reports_missing_preparation_without_mutating_a_body() {
        let next = resolve_effective_entity_physics_state(PhysicsState::GRAVITY);
        let decision = decide_entity_physics_state_transition(
            None,
            next,
            EntityPhysicsTransitionContext {
                intent: EntityPhysicalIntent::Simulated,
                prepared_physics_available: false,
                physical_body_attached: false,
                prepared_definition_changed: false,
            },
        );

        assert_eq!(decision.action, EntityPhysicalTransitionAction::None);
        assert_eq!(
            decision.disposition,
            EntityPhysicalDisposition::MissingPreparedPhysics
        );
        assert!(!decision.wake_solver);
    }
}
