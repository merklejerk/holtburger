use crate::entity::{
    EntityManager, EntityMotionAction, EntityMotionActionRejection, EntityMotionAdmission,
    EntityMotionSnapshot,
};
use crate::motion::{
    CharacterMotionPresentation, MotionCommand, MotionOrder, MotionRuntimeRegistry, SequenceTick,
    ServerDirectedMotionResolution, ServerDirectedTarget, begin_server_directed_motion,
    resolve_server_directed_motion,
};
use crate::spatial::{
    ContactState, RetainedBodyKinematics, SolveBodyInput, SpatialBody, SpatialBodyId,
    SpatialSampleMode,
};
use crate::state::WorldState;
use crate::state::types::RetainedServerDirectedMotion;
use crate::{PhysicalBodyReconfiguration, WorldEvent};
use holtburger_common::position::WorldPosition;
use holtburger_common::properties::WorldObjectExt as _;
use holtburger_common::{Guid, RigidTransform, Vector3};
use holtburger_content::{MotionHookEffect, MotionSequence, MotionSequenceTable};
use holtburger_dat::file_type::MotionTable;
use holtburger_protocol::messages::movement::InterpretedMotionCommand;
use std::time::Duration;
use thiserror::Error;

/// Immutable non-scene authority required to derive projection for a captured spatial body.
pub struct BodyProjectionResolver<'a> {
    entities: &'a EntityManager,
    motion_runtimes: &'a MotionRuntimeRegistry,
}

impl<'a> BodyProjectionResolver<'a> {
    pub fn new(entities: &'a EntityManager, motion_runtimes: &'a MotionRuntimeRegistry) -> Self {
        Self {
            entities,
            motion_runtimes,
        }
    }

    /// Resolves one captured body's current authority and authored-playback contribution.
    pub fn resolve(&self, body: &SpatialBody) -> Option<SolveBodyInput> {
        let guid = body.id.authoritative_guid()?;
        let entity_state = self.entities.get(guid).map(|entity| {
            (
                RetainedBodyKinematics {
                    velocity: entity.velocity,
                    acceleration: entity.acceleration,
                    omega: entity.omega,
                },
                entity.network_motion.snapshot(),
            )
        });
        let (retained, motion_snapshot) = match entity_state {
            Some((entity_retained, entity_motion_state)) => {
                let retained = if body.sampling.mode == SpatialSampleMode::AuthoritativeOnly {
                    entity_retained
                } else {
                    body.retained
                };
                (retained, entity_motion_state.or(body.motion_state))
            }
            None => (body.retained, body.motion_state),
        };
        let authored_offset = match body.id {
            SpatialBodyId::LocalPlayer(_) => None,
            SpatialBodyId::Entity(guid) => self.resolve_authored_offset(guid, motion_snapshot),
            SpatialBodyId::Ephemeral(_) => None,
        };
        Some(SolveBodyInput {
            body_id: body.id,
            pose: body.pose,
            contact: body.contact,
            authored_offset,
            retained,
        })
    }

    fn resolve_authored_offset(
        &self,
        guid: Guid,
        snapshot: Option<EntityMotionSnapshot>,
    ) -> Option<RigidTransform> {
        let snapshot = snapshot?;
        if snapshot
            .motion_command()
            .is_some_and(InterpretedMotionCommand::is_dead)
        {
            return None;
        }
        // Participation follows the installed sequence, not this tick's offset magnitude: a slow
        // turn can produce a rotation smaller than a useful identity threshold at 30 Hz.
        let runtime = self.motion_runtimes.get(guid)?;
        runtime
            .sequence()
            .contributes_motion()
            .then_some(runtime.tick().offset)
    }
}

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

/// Failure to advance one named body's world-owned authored playback cursor.
#[derive(Debug, Error)]
pub enum AuthoredMotionDriveError {
    #[error("body 0x{guid:08X} has no motion-table or setup-model source")]
    MotionTableSourceUnavailable { guid: u32 },
    #[error("body 0x{guid:08X} resolved missing motion table 0x{motion_table_id:08X}")]
    MotionTableUnavailable { guid: u32, motion_table_id: u32 },
    #[error(
        "body 0x{guid:08X} motion table 0x{motion_table_id:08X} does not model command 0x{command:08X} in style 0x{style:08X}"
    )]
    RequiredCycleUnavailable {
        guid: u32,
        motion_table_id: u32,
        style: u32,
        command: u32,
    },
}

/// Complete authored-motion result for one body advanced by the world clock.
#[derive(Debug, Clone, PartialEq)]
pub struct AuthoredBodyMotionTick {
    /// Body whose sole authored cursor produced this tick.
    pub guid: Guid,
    /// Root contribution, ordered hooks, and action completion from that cursor advance.
    pub tick: SequenceTick,
}

/// Why a client-authored transient edge could not enter the local body's shared runtime.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum LocalAuthoredMotionActionError {
    /// The interpreted command or speed is not a valid action edge.
    #[error("local authored motion action is invalid: {rejection:?}")]
    InvalidAction {
        /// Exact action reduction failure.
        rejection: EntityMotionActionRejection,
    },
    /// The local player has no direct or setup-default motion table.
    #[error("local player 0x{guid:08X} has no effective motion table for authored action")]
    MotionTableSourceUnavailable { guid: u32 },
    /// The effective table identity is not present in the runtime catalog.
    #[error(
        "local player 0x{guid:08X} resolved unavailable motion table 0x{motion_table_id:08X} for authored action"
    )]
    MotionTableUnavailable { guid: u32, motion_table_id: u32 },
    /// Active plus pending actions already occupy retail's six slots.
    #[error("local player 0x{guid:08X} authored action queue is full")]
    QueueOverflow { guid: u32 },
}

impl WorldState {
    /// Rebuilds one body's authored playback from a discontinuity-safe motion snapshot.
    pub(crate) fn reset_authored_motion(
        &mut self,
        guid: Guid,
        snapshot: Option<EntityMotionSnapshot>,
    ) {
        self.motion_runtimes.forget(guid);
        let Some(snapshot) = snapshot else {
            return;
        };
        let Some(source) = self.motion_table_source_for_guid(guid) else {
            return;
        };
        let Some(table) = self
            .motion_sequences
            .table(motion_table_id_for_source(source))
        else {
            return;
        };
        self.motion_runtimes
            .drive(table, guid, MotionOrder::from_snapshot(snapshot), 0.0);
    }

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

    /// Drives one named body's sole authored playback cursor and returns its complete tick.
    ///
    /// The world owns table selection and cursor state. Callers own only the semantic order, so
    /// presentation and root motion cannot accidentally advance different playback instances.
    pub fn drive_authored_motion_for_body(
        &mut self,
        guid: Guid,
        order: MotionOrder,
        dt: Duration,
    ) -> Result<SequenceTick, AuthoredMotionDriveError> {
        let quantum = dt.as_secs_f32();
        let source = self.motion_table_source_for_guid(guid).ok_or(
            AuthoredMotionDriveError::MotionTableSourceUnavailable {
                guid: u32::from(guid),
            },
        )?;
        let motion_table_id = motion_table_id_for_source(source);
        let table = self.motion_sequences.table(motion_table_id).ok_or(
            AuthoredMotionDriveError::MotionTableUnavailable {
                guid: u32::from(guid),
                motion_table_id,
            },
        )?;

        Ok(self
            .motion_runtimes
            .drive(table, guid, order, quantum)
            .clone())
    }

    /// Predicts one client-authored command-list edge into the local body's sole runtime.
    ///
    /// The later autonomous server echo is intentionally filtered at packet admission; predicting
    /// here is therefore the only local presentation edge and cannot double-enqueue the action.
    pub fn enqueue_local_authored_motion_action(
        &mut self,
        command: InterpretedMotionCommand,
        speed: f32,
        action_sequence: u16,
    ) -> Result<(), LocalAuthoredMotionActionError> {
        let action_sequence = action_sequence & 0x7FFF;
        let guid = self.player.guid;
        let admission = EntityMotionAdmission {
            object_instance_sequence: self.player.instance_sequence,
            movement_sequence: action_sequence,
            server_control_sequence: self.player.server_control_sequence,
            is_autonomous: true,
        };
        let action =
            EntityMotionAction::from_local_command_list(command, speed, action_sequence, admission)
                .map_err(|rejection| LocalAuthoredMotionActionError::InvalidAction { rejection })?;
        let source = self.motion_table_source_for_guid(guid).ok_or(
            LocalAuthoredMotionActionError::MotionTableSourceUnavailable {
                guid: u32::from(guid),
            },
        )?;
        let motion_table_id = motion_table_id_for_source(source);
        let table = self.motion_sequences.table(motion_table_id).ok_or(
            LocalAuthoredMotionActionError::MotionTableUnavailable {
                guid: u32::from(guid),
                motion_table_id,
            },
        )?;
        if self.motion_runtimes.enqueue_action(table, guid, action)
            == crate::motion::MotionActionEnqueueOutcome::Overflow
        {
            return Err(LocalAuthoredMotionActionError::QueueOverflow {
                guid: u32::from(guid),
            });
        }
        Ok(())
    }

    /// Offers freshly admitted transient edges to the body's sole authored runtime queue.
    pub(crate) fn enqueue_entity_motion_actions(
        &mut self,
        guid: Guid,
        actions: impl IntoIterator<Item = crate::entity::EntityMotionAction>,
    ) {
        let Some(source) = self.motion_table_source_for_guid(guid) else {
            for action in actions {
                log::warn!(
                    "body 0x{guid:08X} has no motion table for admitted action 0x{:08X} (source {:?}, action sequence {})",
                    action.command.raw(),
                    action.source,
                    action.action_sequence,
                );
            }
            return;
        };
        let motion_table_id = motion_table_id_for_source(source);
        let Some(table) = self.motion_sequences.table(motion_table_id) else {
            for action in actions {
                log::warn!(
                    "body 0x{guid:08X} resolved missing motion table 0x{motion_table_id:08X} for admitted action 0x{:08X} (source {:?}, action sequence {})",
                    action.command.raw(),
                    action.source,
                    action.action_sequence,
                );
            }
            return;
        };
        for action in actions {
            if self.motion_runtimes.enqueue_action(table, guid, action)
                == crate::motion::MotionActionEnqueueOutcome::Overflow
            {
                log::warn!(
                    "body 0x{guid:08X} motion table 0x{motion_table_id:08X} rejected action 0x{:08X}: retail six-action queue is full (source {:?}, action sequence {})",
                    action.command.raw(),
                    action.source,
                    action.action_sequence,
                );
            }
        }
    }

    /// Whether the local adapter must advance this body's sole authored cursor for an action.
    pub fn has_authored_motion_actions(&self, guid: Guid) -> bool {
        self.motion_runtimes.has_actions(guid)
    }

    /// Requires one style/command cycle before a playable-character adapter selects it.
    ///
    /// Generic remote content may legitimately leave a command unmodelled and retain its existing
    /// presentation. A playable player table is a stronger contract: silently remaining in idle
    /// would hide a broken required-content dependency.
    pub fn require_authored_motion_cycle_for_body(
        &self,
        guid: Guid,
        style: MotionCommand,
        command: MotionCommand,
    ) -> Result<(), AuthoredMotionDriveError> {
        let source = self.motion_table_source_for_guid(guid).ok_or(
            AuthoredMotionDriveError::MotionTableSourceUnavailable {
                guid: u32::from(guid),
            },
        )?;
        let motion_table_id = motion_table_id_for_source(source);
        let table = self.motion_sequences.table(motion_table_id).ok_or(
            AuthoredMotionDriveError::MotionTableUnavailable {
                guid: u32::from(guid),
                motion_table_id,
            },
        )?;
        if table.cycle(style.raw(), command.raw()).is_none() {
            return Err(AuthoredMotionDriveError::RequiredCycleUnavailable {
                guid: u32::from(guid),
                motion_table_id,
                style: style.raw(),
                command: command.raw(),
            });
        }
        Ok(())
    }

    pub fn resolve_body_projection_input(&self, body_id: SpatialBodyId) -> Option<SolveBodyInput> {
        let body = self.scene.body(body_id)?;
        BodyProjectionResolver::new(&self.entities, &self.motion_runtimes).resolve(body)
    }

    pub fn body_has_simulatable_projection_basis(&self, body_id: SpatialBodyId) -> bool {
        if self
            .resolve_body_projection_input(body_id)
            .is_some_and(SolveBodyInput::has_motion)
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
        let Some(snapshot) = entity.network_motion.snapshot() else {
            return false;
        };
        if snapshot
            .motion_command()
            .is_some_and(InterpretedMotionCommand::is_dead)
        {
            return false;
        }

        let order = MotionOrder::from_snapshot(snapshot);
        if snapshot.directive.is_none()
            && order.forward.is_none()
            && order.sidestep.is_none()
            && order.turn.is_none()
        {
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

    /// Advances every body's authored motion by one tick, before any solver reads a basis.
    ///
    /// Playback is stateful and the basis is derived from it, so the advance happens once per tick
    /// at the layer that owns the world clock. `resolve_body_projection_input` then reads the
    /// contribution rather than producing it, which is what keeps the tick's authored offset a
    /// single computed fact.
    pub fn advance_authored_motion(&mut self, dt: Duration) -> Vec<AuthoredBodyMotionTick> {
        self.advance_authored_motion_except(dt, None)
    }

    /// Advances authored playback while excluding a body explicitly driven by its local adapter.
    ///
    /// The authoritative snapshot for that entity can still be present, so bulk advancement must
    /// not advance its world-owned cursor before the adapter drives that same cursor for the tick.
    pub fn advance_authored_motion_except(
        &mut self,
        dt: Duration,
        excluded: Option<Guid>,
    ) -> Vec<AuthoredBodyMotionTick> {
        let quantum = dt.as_secs_f32();
        if !quantum.is_finite() || quantum < 0.0 {
            return Vec::new();
        }

        // Collected first because driving playback needs the contract, the registry, and the entity
        // set at once, and only the registry is mutated.
        let driving: Vec<(Guid, u32, EntityMotionSnapshot, WorldPosition, ContactState)> = self
            .entities
            .iter()
            .filter_map(|entity| {
                if excluded == Some(entity.guid) {
                    return None;
                }
                let snapshot = entity.network_motion.snapshot()?;
                if snapshot
                    .motion_command()
                    .is_some_and(InterpretedMotionCommand::is_dead)
                {
                    return None;
                }
                let source = self.motion_table_source_for_guid(entity.guid)?;
                let body = self
                    .runtime_body_id_for_guid(entity.guid)
                    .and_then(|body_id| self.scene.body(body_id));
                Some((
                    entity.guid,
                    motion_table_id_for_source(source),
                    snapshot,
                    body.map_or(entity.position, |body| body.pose),
                    body.map_or(ContactState::Unknown, |body| body.contact),
                ))
            })
            .collect();

        // Cursor lifetime follows entity lifetime, not the presence of a snapshot in this tick.
        // Local prediction can legitimately install a cursor before an echoed motion snapshot
        // exists, and excluding that body from bulk advancement must not delete its cursor.
        let live: std::collections::HashSet<Guid> =
            self.entities.iter().map(|entity| entity.guid).collect();
        self.motion_runtimes
            .retain_bodies(|guid| live.contains(&guid));
        self.server_directed_motion
            .retain(|guid, _| live.contains(guid));

        let mut ticks = Vec::with_capacity(driving.len());
        for (guid, motion_table_id, snapshot, pose, contact) in driving {
            let order = self.resolve_remote_motion_order(guid, snapshot, pose, contact);
            let Some(table) = self.motion_sequences.table(motion_table_id) else {
                continue;
            };
            ticks.push(AuthoredBodyMotionTick {
                guid,
                tick: self
                    .motion_runtimes
                    .drive(table, guid, order, quantum)
                    .clone(),
            });
        }
        ticks
    }

    /// Executes host-owned physics hooks and blocked-solidification retries for one world tick.
    pub fn apply_authored_motion_physics(
        &mut self,
        ticks: &[AuthoredBodyMotionTick],
    ) -> anyhow::Result<Vec<WorldEvent>> {
        let pending = self
            .entities
            .iter()
            .filter(|entity| entity.physics.has_pending_solidification())
            .map(|entity| entity.guid)
            .collect::<Vec<_>>();
        let mut events = Vec::new();
        for guid in pending {
            self.apply_authored_ethereal(guid, false, &mut events)?;
        }
        for produced in ticks {
            for fired in &produced.tick.hooks {
                if let MotionHookEffect::Ethereal { ethereal } = fired.hook.effect {
                    self.apply_authored_ethereal(produced.guid, ethereal, &mut events)?;
                }
            }
        }
        Ok(events)
    }

    fn apply_authored_ethereal(
        &mut self,
        guid: Guid,
        ethereal: bool,
        events: &mut Vec<WorldEvent>,
    ) -> anyhow::Result<()> {
        let body_id = self.runtime_body_id_for_guid(guid);
        let obstructed = if ethereal {
            false
        } else if let Some(body_id) = body_id {
            if self
                .scene
                .body(body_id)
                .and_then(|body| body.physical.as_ref())
                .is_some()
            {
                self.scene.dynamic_body_overlaps_peer(body_id)?
            } else {
                false
            }
        } else {
            false
        };
        let effective = {
            let entity = self
                .entities
                .get_mut(guid)
                .expect("authored motion tick outlived its entity");
            if obstructed {
                entity.physics.defer_authored_solidification();
            } else {
                entity.physics.apply_authored_ethereal(ethereal);
            }
            entity.physics.effective()
        };
        let Some(body_id) = body_id else {
            return Ok(());
        };
        let has_physics = self
            .scene
            .body(body_id)
            .and_then(|body| body.physical.as_ref())
            .is_some();
        if !has_physics {
            return Ok(());
        }
        let outcome = self
            .scene
            .reconfigure_dynamic_body_for_state(body_id, effective)
            .expect("authored ethereal transition lost compatible prepared geometry");
        if outcome.change != PhysicalBodyReconfiguration::Unchanged {
            events.push(WorldEvent::RuntimeBodyChanged { body_id });
        }
        Ok(())
    }

    /// Re-selects one server-authored body's presentation after a committed support transition.
    ///
    /// The zero quantum changes the selected sequence without double-advancing the tick. Remote
    /// root actuation already consumed the offset selected from the pre-solve support state.
    pub fn reconcile_authored_motion_support(&mut self, guid: Guid, contact: ContactState) {
        let Some(snapshot) = self
            .entities
            .get(guid)
            .and_then(|entity| entity.network_motion.snapshot())
        else {
            return;
        };
        if snapshot
            .motion_command()
            .is_some_and(InterpretedMotionCommand::is_dead)
        {
            return;
        }
        let Some(source) = self.motion_table_source_for_guid(guid) else {
            return;
        };
        let pose = self
            .runtime_body_id_for_guid(guid)
            .and_then(|body_id| self.scene.body(body_id))
            .map_or_else(
                || self.entities.get(guid).map(|entity| entity.position),
                |body| Some(body.pose),
            );
        let Some(pose) = pose else {
            return;
        };
        let order = self.resolve_remote_motion_order(guid, snapshot, pose, contact);
        let Some(table) = self
            .motion_sequences
            .table(motion_table_id_for_source(source))
        else {
            return;
        };
        self.motion_runtimes.drive(table, guid, order, 0.0);
    }

    /// Samples the current target facts used by retail object-directed movement.
    pub fn server_directed_target(&self, guid: Guid) -> Option<ServerDirectedTarget> {
        let entity = self.entities.get(guid)?;
        let pose = self
            .runtime_body_id_for_guid(guid)
            .and_then(|body_id| self.scene.body(body_id))
            .map_or(entity.position, |body| body.pose);
        let use_radius = entity.use_radius().unwrap_or(0.0) as f32;
        ServerDirectedTarget::new(pose, use_radius)
    }

    fn resolve_remote_motion_order(
        &mut self,
        guid: Guid,
        snapshot: EntityMotionSnapshot,
        current_pose: WorldPosition,
        contact: ContactState,
    ) -> MotionOrder {
        let steady_order = MotionOrder::from_snapshot(snapshot);
        let Some(directive) = snapshot.directive else {
            self.server_directed_motion.remove(&guid);
            return support_presented_snapshot_order(snapshot, contact);
        };

        let retained = self.server_directed_motion.remove(&guid);
        let state = match retained {
            Some(retained) if retained.directive == directive => retained.state,
            _ => {
                let target = directive
                    .target_guid()
                    .and_then(|target| self.server_directed_target(target));
                Some(begin_server_directed_motion(
                    directive,
                    current_pose,
                    target,
                ))
            }
        };
        let Some(state) = state else {
            self.server_directed_motion.insert(
                guid,
                RetainedServerDirectedMotion {
                    directive,
                    state: None,
                },
            );
            return support_presented_snapshot_order(snapshot, contact);
        };
        let target = state
            .target_guid()
            .and_then(|target| self.server_directed_target(target));
        match resolve_server_directed_motion(state, steady_order, current_pose, contact, target) {
            ServerDirectedMotionResolution::Active(step) => {
                self.server_directed_motion.insert(
                    guid,
                    RetainedServerDirectedMotion {
                        directive,
                        state: Some(step.state),
                    },
                );
                step.order
            }
            ServerDirectedMotionResolution::Complete => {
                self.server_directed_motion.insert(
                    guid,
                    RetainedServerDirectedMotion {
                        directive,
                        state: None,
                    },
                );
                support_presented_snapshot_order(snapshot, contact)
            }
            ServerDirectedMotionResolution::Failed(failure) => {
                log::warn!("entity 0x{guid:08X} server-directed motion failed: {failure:?}");
                self.server_directed_motion.insert(
                    guid,
                    RetainedServerDirectedMotion {
                        directive,
                        state: None,
                    },
                );
                support_presented_snapshot_order(snapshot, contact)
            }
        }
    }

    /// Resolves the motion table every playback and presentation consumer must use for an entity.
    ///
    /// A direct DID wins; otherwise the setup model's authored default supplies the table. Keeping
    /// fallback ownership here prevents solver and frontend projection from disagreeing.
    pub fn effective_motion_table_id_for_guid(&self, guid: Guid) -> Option<u32> {
        self.motion_table_source_for_guid(guid)
            .map(motion_table_id_for_source)
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

fn support_presented_snapshot_order(
    snapshot: EntityMotionSnapshot,
    contact: ContactState,
) -> MotionOrder {
    MotionOrder::from_snapshot(snapshot)
        .with_character_presentation(CharacterMotionPresentation::resolve(contact, false, false))
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
