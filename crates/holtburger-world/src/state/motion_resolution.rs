use crate::entity::EntityMotionSnapshot;
use crate::motion::MotionOrder;
use crate::spatial::{
    ContactState, SolveBodyInput, SolveProjectionBasis, SpatialBodyId, SpatialSampleMode,
};
use crate::state::WorldState;
use holtburger_common::properties::WorldObjectExt as _;
use holtburger_common::{Guid, RigidTransform, Vector3};
use holtburger_content::{MotionSequence, MotionSequenceTable};
use holtburger_dat::file_type::MotionTable;
use holtburger_protocol::messages::movement::InterpretedMotionCommand;
use std::time::Duration;
use thiserror::Error;

const MOTION_EPSILON: f32 = 1e-4;
const MOTION_EPSILON_SQUARED: f32 = MOTION_EPSILON * MOTION_EPSILON;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlayerMotionTableSource {
    DirectProperty {
        motion_table_id: u32,
    },
    SetupModelDefault {
        setup_model_id: u32,
        motion_table_id: u32,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub struct PlayerMotionTableResolution {
    pub source: PlayerMotionTableSource,
    pub movement_profile: MotionTableMovementProfile,
}

#[derive(Debug, Error)]
pub enum PlayerMotionTableLookupError {
    #[error("player guid is unavailable")]
    PlayerUnavailable,
    #[error("player entity 0x{player_guid:08X} is unavailable")]
    PlayerEntityUnavailable { player_guid: u32 },
    #[error("player has no motion-table or setup-model source")]
    MotionTableSourceUnavailable,
    #[error("setup model 0x{setup_model_id:08X} did not define a default motion table")]
    SetupModelMissingDefaultMotionTable { setup_model_id: u32 },
    #[error("motion table 0x{motion_table_id:08X} is missing from the motion contract")]
    MotionTableAbsentFromContract { motion_table_id: u32 },
}

impl WorldState {
    pub fn resolve_player_motion_table_profile(
        &self,
    ) -> Result<PlayerMotionTableResolution, PlayerMotionTableLookupError> {
        let player_guid = self.player_guid_u32()?;
        let player = self
            .entities
            .get(Guid(player_guid))
            .ok_or(PlayerMotionTableLookupError::PlayerEntityUnavailable { player_guid })?;

        let source = if let Some(motion_table_id) = player.mtable_id().map(u32::from) {
            PlayerMotionTableSource::DirectProperty { motion_table_id }
        } else {
            let setup_model_id = player
                .csetup_id()
                .map(u32::from)
                .ok_or(PlayerMotionTableLookupError::MotionTableSourceUnavailable)?;
            let motion_table_id = self
                .motion_sequences
                .default_motion_table_for_setup(setup_model_id)
                .ok_or(
                    PlayerMotionTableLookupError::SetupModelMissingDefaultMotionTable {
                        setup_model_id,
                    },
                )?;

            PlayerMotionTableSource::SetupModelDefault {
                setup_model_id,
                motion_table_id,
            }
        };

        let motion_table_id = motion_table_id_for_source(source);

        self.motion_table_profile_from_source(source, None)
            .ok_or(PlayerMotionTableLookupError::MotionTableAbsentFromContract { motion_table_id })
    }

    pub fn resolve_body_projection_input(&self, body_id: SpatialBodyId) -> Option<SolveBodyInput> {
        let guid = body_id.authoritative_guid()?;
        let pose = self.runtime_pose_for_guid(guid)?;
        let contact = self
            .scene
            .body(body_id)
            .map(|body| body.contact)
            .unwrap_or(ContactState::Unknown);
        let (velocity, omega, motion_snapshot) =
            self.authoritative_projection_state_for_body(body_id)?;

        let basis = match body_id {
            SpatialBodyId::LocalPlayer(_) => Some(SolveProjectionBasis::velocity(velocity, omega)),
            SpatialBodyId::Entity(guid) => {
                self.resolve_guid_projection_basis(guid, contact, velocity, omega, motion_snapshot)
            }
            SpatialBodyId::Ephemeral(_) => None,
        };

        Some(SolveBodyInput {
            body_id,
            pose,
            contact,
            basis,
        })
    }

    pub fn body_has_simulatable_projection_basis(&self, body_id: SpatialBodyId) -> bool {
        if self
            .resolve_body_projection_input(body_id)
            .and_then(|input| input.basis)
            .is_some()
        {
            return true;
        }

        // Authored playback is stateful, so a body that has only just arrived has no offset yet.
        // Tracking happens at arrival, before any tick, and a body worth simulating must not have
        // to be simulated once to find that out — so the fallback asks whether it has been ordered
        // to perform a motion its table models, which is answerable without advancing anything.
        body_id
            .authoritative_guid()
            .is_some_and(|guid| self.has_orderable_motion(guid))
    }

    /// Whether a body has been ordered to perform a motion and has a table that could model it.
    fn has_orderable_motion(&self, guid: Guid) -> bool {
        let Some(entity) = self.entities.get(guid) else {
            return false;
        };
        let Some(snapshot) = entity.motion_snapshot else {
            return false;
        };
        if snapshot
            .motion_command()
            .is_some_and(InterpretedMotionCommand::is_dead)
            || snapshot.directive.is_some()
        {
            return false;
        }

        let order = MotionOrder::from_snapshot(snapshot);
        if order.forward.is_none() && order.sidestep.is_none() && order.turn.is_none() {
            return false;
        }

        self.motion_table_source_for_guid(guid)
            .is_some_and(|source| {
                self.motion_sequences
                    .table(motion_table_id_for_source(source))
                    .is_some()
            })
    }

    fn player_guid_u32(&self) -> Result<u32, PlayerMotionTableLookupError> {
        (!self.player.guid.is_null())
            .then_some(u32::from(self.player.guid))
            .ok_or(PlayerMotionTableLookupError::PlayerUnavailable)
    }

    fn authoritative_projection_state_for_body(
        &self,
        body_id: SpatialBodyId,
    ) -> Option<(Vector3, Vector3, Option<EntityMotionSnapshot>)> {
        let guid = body_id.authoritative_guid()?;
        let body_state = self.scene.body(body_id).map(|body| {
            (
                body.sampling.mode,
                body.velocity,
                body.omega,
                body.motion_state,
            )
        });
        let entity_state = self
            .entities
            .get(guid)
            .map(|entity| (entity.velocity, entity.omega, entity.motion_snapshot));

        match (body_state, entity_state) {
            (
                Some((mode, body_velocity, body_omega, body_motion_state)),
                Some((entity_velocity, entity_omega, entity_motion_state)),
            ) => {
                let (velocity, omega) = if mode == SpatialSampleMode::AuthoritativeOnly {
                    (entity_velocity, entity_omega)
                } else {
                    (body_velocity, body_omega)
                };

                Some((velocity, omega, entity_motion_state.or(body_motion_state)))
            }
            (Some((_, velocity, omega, motion_state)), None) => {
                Some((velocity, omega, motion_state))
            }
            (None, Some(state)) => Some(state),
            (None, None) => None,
        }
    }

    fn resolve_guid_projection_basis(
        &self,
        guid: Guid,
        contact: ContactState,
        velocity: Vector3,
        omega: Vector3,
        motion_snapshot: Option<EntityMotionSnapshot>,
    ) -> Option<SolveProjectionBasis> {
        // Sliding motion is physics-driven like airborne motion; only walkable support selects
        // the grounded animation basis.
        if matches!(contact, ContactState::Airborne | ContactState::Sliding)
            || velocity.z.abs() > MOTION_EPSILON
        {
            return vector_projection_basis(velocity, omega);
        }

        if let Some(snapshot) = motion_snapshot
            && let Some(grounded) = self.resolve_grounded_motion_basis(guid, snapshot)
        {
            return Some(grounded);
        }

        vector_projection_basis(velocity, omega)
    }

    fn resolve_grounded_motion_basis(
        &self,
        guid: Guid,
        snapshot: EntityMotionSnapshot,
    ) -> Option<SolveProjectionBasis> {
        if snapshot
            .motion_command()
            .is_some_and(InterpretedMotionCommand::is_dead)
        {
            return None;
        }

        // TODO: Extend grounded basis resolution here for TurnToHeading and TurnToObject
        // directives once continuous command-driven observer projection is validated.
        if snapshot.directive.is_some() {
            return None;
        }

        // Whether the body participates is decided by what its playback installed, not by how
        // large this particular tick's offset came out: a slow turn produces a rotation smaller
        // than any sane identity threshold at 30 Hz.
        let runtime = self.motion_runtimes.get(guid)?;
        runtime
            .sequence()
            .contributes_motion()
            .then_some(SolveProjectionBasis::AuthoredDrive {
                offset: runtime.tick().offset,
            })
    }

    /// Advances every body's authored motion by one tick, before any solver reads a basis.
    ///
    /// Playback is stateful and the basis is derived from it, so the advance happens once per tick
    /// at the layer that owns the world clock. `resolve_body_projection_input` then reads the
    /// contribution rather than producing it, which is what keeps the tick's authored offset a
    /// single computed fact.
    pub fn advance_authored_motion(&mut self, dt: Duration) {
        let quantum = dt.as_secs_f32();
        if !quantum.is_finite() || quantum < 0.0 {
            return;
        }

        // Collected first because driving playback needs the contract, the registry, and the entity
        // set at once, and only the registry is mutated.
        let driving: Vec<(Guid, u32, MotionOrder)> = self
            .entities
            .iter()
            .filter_map(|entity| {
                let snapshot = entity.motion_snapshot?;
                if snapshot
                    .motion_command()
                    .is_some_and(InterpretedMotionCommand::is_dead)
                    || snapshot.directive.is_some()
                {
                    return None;
                }
                let source = self.motion_table_source_for_guid(entity.guid)?;
                Some((
                    entity.guid,
                    motion_table_id_for_source(source),
                    MotionOrder::from_snapshot(snapshot),
                ))
            })
            .collect();

        let live: std::collections::HashSet<Guid> =
            driving.iter().map(|(guid, _, _)| *guid).collect();
        self.motion_runtimes
            .retain_bodies(|guid| live.contains(&guid));

        for (guid, motion_table_id, order) in driving {
            let Some(table) = self.motion_sequences.table(motion_table_id) else {
                continue;
            };
            self.motion_runtimes.drive(table, guid, order, quantum);
        }
    }

    fn motion_table_source_for_guid(&self, guid: Guid) -> Option<PlayerMotionTableSource> {
        let entity = self.entities.get(guid)?;

        if let Some(motion_table_id) = entity.mtable_id().map(u32::from) {
            return Some(PlayerMotionTableSource::DirectProperty { motion_table_id });
        }

        let setup_model_id = entity.csetup_id().map(u32::from)?;
        let motion_table_id = self
            .motion_sequences
            .default_motion_table_for_setup(setup_model_id)?;

        Some(PlayerMotionTableSource::SetupModelDefault {
            setup_model_id,
            motion_table_id,
        })
    }

    fn motion_table_profile_from_source(
        &self,
        source: PlayerMotionTableSource,
        stance_override: Option<u32>,
    ) -> Option<PlayerMotionTableResolution> {
        let motion_table_id = motion_table_id_for_source(source);
        let table = self.motion_sequences.table(motion_table_id)?;
        let stance = stance_override.unwrap_or(table.default_style);

        Some(PlayerMotionTableResolution {
            source,
            movement_profile: MotionTableMovementProfile::reduce(table, motion_table_id, stance),
        })
    }
}

/// Velocity-grade summary of the four movement commands for one table and stance.
///
/// This is a deliberate reduction of the motion contract, not a second source of motion facts. The
/// client's own movement system, dead reckoning, and command-capability checks are velocity-shaped
/// and read this; authored root motion reaches a solver through the contract itself.
#[derive(Debug, Clone, PartialEq)]
pub struct MotionTableMovementProfile {
    pub motion_table_id: u32,
    pub stance: u32,
    pub walk_forward: Option<MotionCommandKinematics>,
    pub run_forward: Option<MotionCommandKinematics>,
    pub turn_left: Option<MotionCommandKinematics>,
    pub turn_right: Option<MotionCommandKinematics>,
}

impl MotionTableMovementProfile {
    fn reduce(table: &MotionSequenceTable, motion_table_id: u32, stance: u32) -> Self {
        let reduce = |command: u32| {
            table
                .cycle(stance, command)
                .map(|sequence| MotionCommandKinematics::reduce(sequence, command))
        };

        Self {
            motion_table_id,
            stance,
            walk_forward: reduce(MotionTable::WALK_FORWARD_COMMAND),
            run_forward: reduce(MotionTable::RUN_FORWARD_COMMAND),
            turn_left: reduce(MotionTable::TURN_LEFT_COMMAND),
            turn_right: reduce(MotionTable::TURN_RIGHT_COMMAND),
        }
    }
}

/// One command's reduced rates.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MotionCommandKinematics {
    pub velocity: Option<Vector3>,
    pub omega: Option<Vector3>,
}

impl MotionCommandKinematics {
    fn reduce(sequence: &MotionSequence, command: u32) -> Self {
        let velocity = sequence.velocity.or_else(|| {
            derives_forward_velocity(command)
                .then(|| reduced_forward_speed(sequence).map(|speed| Vector3::new(speed, 0.0, 0.0)))
                .flatten()
        });

        Self {
            velocity,
            omega: sequence.omega,
        }
    }
}

/// Whether a command's forward speed may be derived from authored root motion when the table
/// authors no explicit velocity.
///
/// Only the two forward locomotion commands qualify: everything else either authors omega or is not
/// a translation at all, and inferring a forward vector for it would invent motion.
fn derives_forward_velocity(command: u32) -> bool {
    command == MotionTable::WALK_FORWARD_COMMAND || command == MotionTable::RUN_FORWARD_COMMAND
}

/// Mean forward speed a grounded cycle implies, composed from its authored root motion.
///
/// Composes each clip's traversal window in order into one rigid transform, then divides the
/// distance travelled by the frames traversed and scales by the rate they are traversed at. Rate
/// sign selects traversal direction rather than changing the speed, so its magnitude is used.
fn reduced_forward_speed(sequence: &MotionSequence) -> Option<f32> {
    let framerate = sequence.clips.first()?.framerate.abs();
    let mut composed = RigidTransform::identity();
    let mut frames = 0u32;
    for clip in &sequence.clips {
        composed = composed.combine(
            &clip
                .animation
                .root
                .composed_over(clip.low_frame, clip.high_frame),
        );
        frames += clip.frame_span();
    }

    (frames > 0).then(|| composed.translation.length() / frames as f32 * framerate)
}

fn motion_table_id_for_source(source: PlayerMotionTableSource) -> u32 {
    match source {
        PlayerMotionTableSource::DirectProperty { motion_table_id }
        | PlayerMotionTableSource::SetupModelDefault {
            motion_table_id, ..
        } => motion_table_id,
    }
}

fn vector_projection_basis(velocity: Vector3, omega: Vector3) -> Option<SolveProjectionBasis> {
    ((velocity.length_squared() > MOTION_EPSILON_SQUARED)
        || (omega.length_squared() > MOTION_EPSILON_SQUARED))
        .then_some(SolveProjectionBasis::Velocity { velocity, omega })
}

/// Motion fixtures for tests that care about resolved rates rather than authored tracks.
#[cfg(any(test, feature = "test-support"))]
pub mod test_support {
    use super::*;
    use holtburger_content::MotionSequenceCatalog;
    use holtburger_dat::file_type::motion_table::{MotionData, MotionDataFlags};
    use std::collections::HashMap;

    /// One command's explicit kinematics inside a fixture table.
    ///
    /// Fixtures author velocity and omega directly. A test that asserts a resolved walk speed
    /// should not have to author a 36-frame root track to express it, and authored root motion has
    /// its own coverage against real content.
    #[derive(Debug, Clone, Copy)]
    pub struct FixtureCycle {
        pub command: u32,
        pub velocity: Option<Vector3>,
        pub omega: Option<Vector3>,
    }

    impl FixtureCycle {
        pub fn moving(command: u32, velocity: Vector3) -> Self {
            Self {
                command,
                velocity: Some(velocity),
                omega: None,
            }
        }

        pub fn turning(command: u32, omega: Vector3) -> Self {
            Self {
                command,
                velocity: None,
                omega: Some(omega),
            }
        }
    }

    /// Substate a fixture table rests in, so selection has a style default to fall back to.
    pub const FIXTURE_STAND_COMMAND: u32 = 0x4500_0003;

    /// Builds a catalog holding one motion table whose cycles carry explicit kinematics.
    ///
    /// A resting substate is always present: selection refuses to run without a style default, and
    /// a fixture without one would silently model nothing.
    pub fn explicit_motion_catalog(
        motion_table_id: u32,
        default_style: u32,
        cycles: impl IntoIterator<Item = FixtureCycle>,
        setup_defaults: impl IntoIterator<Item = (u32, u32)>,
    ) -> MotionSequenceCatalog {
        let cycles = cycles
            .into_iter()
            .chain([FixtureCycle {
                command: FIXTURE_STAND_COMMAND,
                velocity: None,
                omega: None,
            }])
            .map(|cycle| {
                let mut flags = MotionDataFlags::empty();
                flags.set(MotionDataFlags::HAS_VELOCITY, cycle.velocity.is_some());
                flags.set(MotionDataFlags::HAS_OMEGA, cycle.omega.is_some());

                (
                    MotionTable::cycle_key(default_style, cycle.command),
                    MotionData {
                        bitfield: 0,
                        flags,
                        anims: Vec::new(),
                        velocity: cycle.velocity,
                        omega: cycle.omega,
                    },
                )
            })
            .collect::<HashMap<_, _>>();

        let table = MotionTable {
            id: motion_table_id,
            default_style,
            style_defaults: HashMap::from([(default_style, FIXTURE_STAND_COMMAND)]),
            cycles,
            modifiers: HashMap::new(),
            links: HashMap::new(),
        };

        MotionSequenceCatalog::assemble([table], [], setup_defaults)
            .expect("a fixture table referencing no animation always projects")
    }
}
