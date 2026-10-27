use crate::entity::{
    EntityManager, EntityMotionAdmission, EntityMotionSnapshot, OrderedMotionScalar,
};
use crate::motion::{
    CharacterMotionPresentation, LocomotionPresentationSource, MotionCommand, MotionOrder,
    MotionRuntimeRegistry, ObservedCharacterMotion, RemoteFramePolicy, RemoteMotionInput,
    RemoteMotionSample, SequenceTick, ServerDirectedTarget, observed_locomotion_order,
};
use crate::spatial::{
    ContactState, DynamicBodyActivity, PhysicalBodyDefinition, RetainedBodyKinematics,
    SolveBodyInput, SpatialBody, SpatialBodyId, SpatialSampleMode,
};
use crate::state::WorldState;
use crate::{LocalIntegrationDemand, PhysicalBodyReconfiguration, WorldEvent};
use holtburger_common::properties::WorldObjectExt as _;
use holtburger_common::{Guid, RigidTransform, Vector3};
use holtburger_content::{MotionHookEffect, MotionSequenceTable};
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

    /// Remote source sample, including command orientation even on a motionless interval.
    pub fn remote_motion_sample(&self, guid: Guid) -> Option<RemoteMotionSample> {
        let snapshot = self.entities.get(guid)?.network_motion.snapshot()?;
        if snapshot
            .motion_command()
            .is_some_and(InterpretedMotionCommand::is_dead)
        {
            return None;
        }
        self.motion_runtimes.get(guid)?.remote_motion_sample()
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
}

/// Complete authored-motion result for one body advanced by the world clock.
#[derive(Debug, Clone, PartialEq)]
pub struct AuthoredBodyMotionTick {
    /// Body whose motion runtime composed this physical interval.
    pub guid: Guid,
    /// Selected root contribution, body-semantic hooks, and ordinary action completion.
    pub tick: SequenceTick,
}

/// Why a client-authored command could not enter the local body's shared runtime.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum LocalAuthoredMotionCommandError {
    /// The interpreted command has no supported authored playback class.
    #[error("local authored motion command is unsupported: 0x{command:04X}")]
    UnsupportedCommand {
        /// Interpreted index absent from retail's table or outside action/substate command classes.
        command: u16,
    },
    /// Authored speed must be finite before it enters the body runtime.
    #[error("local authored motion command has non-finite speed")]
    NonFiniteSpeed,
    /// The local player has no direct or setup-default motion table.
    #[error("local player 0x{guid:08X} has no effective motion table for authored command")]
    MotionTableSourceUnavailable { guid: u32 },
    /// The effective table identity is not present in the runtime catalog.
    #[error(
        "local player 0x{guid:08X} resolved unavailable motion table 0x{motion_table_id:08X} for authored command"
    )]
    MotionTableUnavailable { guid: u32, motion_table_id: u32 },
    /// Active plus pending actions already occupy retail's six slots.
    #[error("local player 0x{guid:08X} authored action queue is full")]
    QueueOverflow { guid: u32 },
}

/// Retail cylinder-to-cylinder sticky gap (acclient.c:371427-371508).
pub(crate) const STICKY_TARGET_CLEARANCE_M: f32 = 0.3;

impl WorldState {
    /// Effective local motion style, without requiring any particular movement rows.
    pub fn resolve_player_motion_style(&self) -> Result<u32, PlayerMotionTableLookupError> {
        if let Some(style) = self.reported_player_motion_style() {
            return Ok(style);
        }
        Ok(self.player_motion_table()?.1.default_style)
    }

    fn reported_player_motion_style(&self) -> Option<u32> {
        self.player_entity()
            .and_then(|entity| entity.network_motion.snapshot())
            .and_then(|snapshot| snapshot.current_style)
            .or(self.player.last_server_motion_style)
            .map(|style| style as u32)
    }

    /// Acknowledges a controller-declined local object turn without installing its playback.
    /// The controller owns the reason for declining; normal self authority rejects stale packets.
    pub fn acknowledge_local_object_turn(
        &mut self,
        data: &holtburger_protocol::messages::MovementEventData,
    ) -> bool {
        if data.guid.is_null()
            || data.guid != self.player.guid
            || data.is_autonomous
            || !matches!(
                data.data,
                holtburger_protocol::messages::MovementTypeData::TurnToObject(_)
            )
            || !self.player.apply_self_update_motion(data)
        {
            return false;
        }
        if let Some(entity) = self.entities.get_mut(data.guid) {
            entity.acknowledge_local_movement(data);
        }
        true
    }

    /// Sample explicit sticky commands before the collection mutates any target pose.
    /// This transient map is consumed once by physical input preparation, never by contact passes.
    pub fn prepare_sticky_body_targets(
        &mut self,
    ) -> std::collections::HashMap<Guid, crate::spatial::StickyBodyTarget> {
        let mut targets = std::collections::HashMap::new();
        for entity in self.entities.iter() {
            let guid = entity.guid;
            let Some(runtime) = self.motion_runtimes.get(guid) else {
                continue;
            };
            let Some(target_guid) = runtime.sticky_target() else {
                continue;
            };
            let speed_mps = runtime.sticky_speed_mps();
            let Some(target_body) = self.scene.body_for_guid(target_guid) else {
                self.motion_runtimes.cancel_sticky_target(guid);
                continue;
            };
            let Some(actor) = self.scene.body_for_guid(guid) else {
                continue;
            };
            // Fixed/passive bodies and airborne motion retain their existing physical policy.
            // Re-evaluate after authored hooks, which can change the actor's role this interval.
            if actor.remote_frame_policy() != RemoteFramePolicy::Command
                || actor.contact != ContactState::Grounded
            {
                continue;
            }
            let Some(actor_dynamic) = actor
                .physical
                .as_ref()
                .and_then(|physical| physical.dynamic.as_ref())
            else {
                continue;
            };
            let Some(target_dynamic) = target_body
                .physical
                .as_ref()
                .and_then(|physical| physical.dynamic.as_ref())
            else {
                continue;
            };
            if actor_dynamic.demand.integration != LocalIntegrationDemand::Eligible
                || actor_dynamic.activity == DynamicBodyActivity::Suspended
            {
                continue;
            }
            let bearing = target_body.pose.global_coords() - actor.pose.global_coords();
            let heading = if bearing.x != 0.0 || bearing.y != 0.0 {
                actor.pose.heading_to(&target_body.pose)
            } else {
                actor.pose.rotation.to_heading()
            };
            let target = crate::spatial::StickyBodyTarget {
                position: target_body.pose,
                clearance: actor_dynamic.collision.target_geometry.setup_radius
                    * actor_dynamic.object_scale
                    + target_dynamic.collision.target_geometry.setup_radius
                        * target_dynamic.object_scale
                    + STICKY_TARGET_CLEARANCE_M,
                speed_mps,
                heading,
            };
            let body_id = actor.id;
            self.motion_runtimes.retain_sticky_heading(guid, heading);
            self.scene.wake_dynamic_body(body_id);
            targets.insert(guid, target);
        }
        targets
    }

    /// Retains locomotion only while this authority can simulate local character motion.
    /// Run before authored advancement so leaving physics reveals the uninterrupted authored cursor.
    pub fn retain_locomotion(&mut self, collision_enabled: bool) {
        let scene = &self.scene;
        let entities = &self.entities;
        self.motion_runtimes.retain_locomotion(|guid| {
            if !collision_enabled {
                return false;
            }
            let Some(entity) = entities.get(guid) else {
                return false;
            };
            if entity.physics.is_authoritative_projectile() {
                return false;
            }
            if entity
                .network_motion
                .snapshot()
                .and_then(|snapshot| snapshot.motion_command())
                .is_some_and(InterpretedMotionCommand::is_dead)
            {
                return false;
            }
            scene
                .body_for_guid(guid)
                .and_then(|body| body.physical.as_ref())
                .is_some_and(|physical| {
                    matches!(physical.definition, PhysicalBodyDefinition::Grounded { .. })
                        && physical.dynamic.as_ref().is_some_and(|dynamic| {
                            dynamic.demand.integration == LocalIntegrationDemand::Eligible
                                && dynamic.activity != DynamicBodyActivity::Suspended
                                && !dynamic.collision.dynamic_collision.missile
                        })
                })
        });
    }

    /// Presents accepted travel or explicit controller intent after canonical body publication.
    /// Neither source changes authored playback, hook delivery, or physical motion.
    /// The controller supplies support/charge priority; the existing runtime owns action priority.
    /// Missing motion content or authored playback leaves presentation with its existing owner.
    /// Unsupported channels are best-effort; success does not promise every channel was modelled.
    pub fn present_character_locomotion(
        &mut self,
        body_id: SpatialBodyId,
        source: LocomotionPresentationSource,
        presentation: CharacterMotionPresentation,
        elapsed: Duration,
    ) -> anyhow::Result<()> {
        let guid = body_id.authoritative_guid().ok_or_else(|| {
            anyhow::anyhow!("observed character body {body_id:?} has no authoritative entity")
        })?;
        let body = self.scene.body(body_id).ok_or_else(|| {
            anyhow::anyhow!("observed character body {body_id:?} has not been published")
        })?;
        let entity = self.entities.get(guid).ok_or_else(|| {
            anyhow::anyhow!("observed character body {body_id:?} outlived its entity")
        })?;
        if entity.physics.is_authoritative_projectile() {
            return Ok(());
        }
        let Some(table_id) = self.effective_motion_table_id_for_guid(guid) else {
            return Ok(());
        };
        let Some(table) = self.motion_sequences.table(table_id) else {
            return Ok(());
        };
        let Some(authored) = self.motion_runtimes.state(guid) else {
            return Ok(());
        };
        let order = match source {
            LocomotionPresentationSource::Observed(motion) => {
                return self.motion_runtimes.observe_locomotion(
                    table,
                    guid,
                    ObservedCharacterMotion {
                        motion,
                        orientation: body.pose.rotation,
                        presentation,
                        object_scale: entity.scale.effective(),
                    },
                    elapsed.as_secs_f32(),
                );
            }
            LocomotionPresentationSource::Command(order)
                if presentation == CharacterMotionPresentation::Grounded =>
            {
                order
            }
            LocomotionPresentationSource::Command(_) => observed_locomotion_order(
                table,
                authored.style,
                crate::spatial::AcceptedBodyMotion::default(),
                body.pose.rotation,
                presentation,
                entity.scale.effective(),
            )?,
        };
        // Visual playback is best-effort: supported channels survive an unmodelled channel.
        self.motion_runtimes
            .present_locomotion(table, guid, order, elapsed.as_secs_f32());
        Ok(())
    }

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
        self.motion_runtimes.replace_body(
            guid,
            crate::motion::BodyMotionRuntime::establish(
                table,
                MotionOrder::from_snapshot(snapshot),
            ),
        );
    }

    pub fn resolve_player_motion_table_profile(
        &self,
    ) -> Result<PlayerMotionTableResolution, PlayerMotionTableLookupError> {
        let (source, table) = self.player_motion_table()?;
        let stance = self
            .reported_player_motion_style()
            .unwrap_or(table.default_style);
        Ok(PlayerMotionTableResolution {
            source,
            movement_profile: MotionTableMovementProfile::reduce(
                table,
                self.motion_sequences
                    .table(crate::motion::PLAYER_LOCOMOTION_BASELINE_TABLE),
                stance,
            ),
        })
    }

    /// Resolve native table identity without evaluating any animation rates.
    fn player_motion_table(
        &self,
    ) -> Result<(PlayerMotionTableSource, &MotionSequenceTable), PlayerMotionTableLookupError> {
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

        let table = self.motion_sequences.table(motion_table_id).ok_or(
            PlayerMotionTableLookupError::MotionTableAbsentFromContract { motion_table_id },
        )?;
        Ok((source, table))
    }

    /// Drives one named body's ordinary authored playback and returns its complete tick.
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

    /// Advances manual locomotion and accepted gestures, returning their selected physical contribution.
    pub fn drive_manual_motion_for_body(
        &mut self,
        guid: Guid,
        order: MotionOrder,
        presentation: CharacterMotionPresentation,
        dt: Duration,
    ) -> Result<SequenceTick, AuthoredMotionDriveError> {
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
        let baseline = (guid == self.player.guid)
            .then(|| {
                self.motion_sequences
                    .table(crate::motion::PLAYER_LOCOMOTION_BASELINE_TABLE)
            })
            .flatten();
        Ok(self
            .motion_runtimes
            .drive_manual_with_fallback(
                table,
                baseline,
                guid,
                order,
                presentation,
                dt.as_secs_f32(),
            )
            .clone())
    }

    /// Whether accepted gesture/idle playback permits independent locomotion.
    /// Approach directives are resolved separately by the core movement adapter.
    pub fn permits_gesture_locomotion(&self, guid: Guid) -> bool {
        let Some(runtime) = self.motion_runtimes.get(guid) else {
            return false;
        };
        self.motion_sequences
            .table(runtime.motion_table_id())
            .is_some_and(|table| runtime.permits_gesture_locomotion(table))
    }

    /// A retained manual sequence needs one physical advancement even after input stops.
    pub fn has_manual_locomotion(&self, guid: Guid) -> bool {
        self.motion_runtimes
            .get(guid)
            .is_some_and(|runtime| runtime.has_manual_locomotion())
    }

    /// Keeps the local physical adapter advancing an accepted gesture without manual input.
    pub fn has_pending_motion_gesture(&self, guid: Guid) -> bool {
        self.motion_runtimes
            .get(guid)
            .is_some_and(|runtime| runtime.has_pending_gesture())
    }

    /// Predicts one client-authored command-list edge; the body solver owns its playback class.
    ///
    /// The later autonomous server echo is intentionally filtered at packet admission; predicting
    /// here is therefore the only local presentation edge and cannot double-enqueue the action.
    pub fn submit_local_authored_motion_command(
        &mut self,
        command: InterpretedMotionCommand,
        speed: f32,
        action_sequence: u16,
    ) -> Result<(), LocalAuthoredMotionCommandError> {
        let action_sequence = action_sequence & 0x7FFF;
        let guid = self.player.guid;
        let admission = EntityMotionAdmission {
            object_instance_sequence: self.player.instance_sequence,
            movement_sequence: action_sequence,
            server_control_sequence: self.player.server_control_sequence,
            is_autonomous: true,
        };
        let command = MotionCommand::from_interpreted(command).ok_or(
            LocalAuthoredMotionCommandError::UnsupportedCommand {
                command: command.raw(),
            },
        )?;
        let speed = OrderedMotionScalar::from_f32(speed)
            .ok_or(LocalAuthoredMotionCommandError::NonFiniteSpeed)?;
        let source = self.motion_table_source_for_guid(guid).ok_or(
            LocalAuthoredMotionCommandError::MotionTableSourceUnavailable {
                guid: u32::from(guid),
            },
        )?;
        let motion_table_id = motion_table_id_for_source(source);
        let table = self.motion_sequences.table(motion_table_id).ok_or(
            LocalAuthoredMotionCommandError::MotionTableUnavailable {
                guid: u32::from(guid),
                motion_table_id,
            },
        )?;
        match self
            .motion_runtimes
            .submit_local_command(table, guid, command, speed, admission)
        {
            crate::motion::MotionCommandAdmissionOutcome::Accepted => {}
            crate::motion::MotionCommandAdmissionOutcome::QueueFull => {
                return Err(LocalAuthoredMotionCommandError::QueueOverflow {
                    guid: u32::from(guid),
                });
            }
            crate::motion::MotionCommandAdmissionOutcome::Unsupported => {
                return Err(LocalAuthoredMotionCommandError::UnsupportedCommand {
                    command: command.raw() as u16,
                });
            }
        }
        Ok(())
    }

    /// Whether a client-authored command still owns the local retained playback order.
    pub fn has_local_authored_motion(&self, guid: Guid) -> bool {
        self.motion_runtimes
            .get(guid)
            .is_some_and(crate::motion::BodyMotionRuntime::has_local_command)
    }

    /// Advance local playback independently of potentially stale autonomous server echoes.
    pub fn advance_local_authored_motion_command(
        &mut self,
        dt: Duration,
    ) -> Result<Option<SequenceTick>, AuthoredMotionDriveError> {
        let guid = self.player.guid;
        if !self.has_local_authored_motion(guid) {
            return Ok(None);
        }
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
            .advance_local_command(table, guid, dt.as_secs_f32())
            .cloned())
    }

    /// Fresh accepted movement renews/cancels sticky intent even when presentation is unchanged.
    /// Missing executable content follows the existing action-admission policy: never replay later.
    pub fn admit_entity_sticky_target(&mut self, guid: Guid, target: Option<Guid>) {
        if target.is_none() {
            self.motion_runtimes.cancel_sticky_target(guid);
            return;
        }
        let table = self.motion_table_source_for_guid(guid).and_then(|source| {
            self.motion_sequences
                .table(motion_table_id_for_source(source))
        });
        let Some(table) = table else {
            self.motion_runtimes.cancel_sticky_target(guid);
            log::warn!(
                "body 0x{guid:08X} cannot admit sticky target without executable motion content"
            );
            return;
        };
        self.motion_runtimes
            .admit_sticky_target(table, guid, target, std::time::Instant::now());
    }

    /// Applies one accepted remote state and its action batch to the sole playback owner.
    /// Returns whether the published playback description changed during admission. A transient
    /// action can start without changing the persistent network motion snapshot.
    pub(crate) fn accept_entity_motion(
        &mut self,
        guid: Guid,
        snapshot: EntityMotionSnapshot,
        actions: impl IntoIterator<Item = crate::entity::EntityMotionAction>,
        sticky_target: Option<Guid>,
    ) -> bool {
        let Some(source) = self.motion_table_source_for_guid(guid) else {
            log::warn!("body 0x{guid:08X} cannot apply admitted motion: no motion table source");
            return false;
        };
        let motion_table_id = motion_table_id_for_source(source);
        let Some(table) = self.motion_sequences.table(motion_table_id) else {
            log::warn!(
                "body 0x{guid:08X} cannot apply admitted motion: table 0x{motion_table_id:08X} is absent from content"
            );
            return false;
        };
        let Some(input) = self.remote_motion_input(guid, snapshot) else {
            return false;
        };
        let before = self.motion_runtimes.motion_playback(guid);
        self.motion_runtimes
            .accept_remote(table, guid, input, actions, sticky_target);
        before != self.motion_runtimes.motion_playback(guid)
    }

    /// Captures source facts consistently for packet admission and continuous resolution.
    fn remote_motion_input(
        &self,
        guid: Guid,
        snapshot: EntityMotionSnapshot,
    ) -> Option<RemoteMotionInput> {
        let entity = self.entities.get(guid)?;
        let body = self
            .runtime_body_id_for_guid(guid)
            .and_then(|id| self.scene.body(id));
        Some(RemoteMotionInput {
            snapshot,
            pose: body.map_or(entity.position, SpatialBody::authored_source_pose),
            contact: entity.motion_contact(body.map_or(ContactState::Unknown, |body| body.contact)),
            target: snapshot
                .directive
                .and_then(|directive| directive.target_guid())
                .and_then(|target| self.server_directed_target(guid, target)),
            frame_policy: body.map_or(RemoteFramePolicy::Body, SpatialBody::remote_frame_policy),
            omega: body.map_or(entity.omega, |body| body.nominal.omega),
        })
    }

    /// Whether the local adapter must advance this body's ordinary playback for an action.
    pub fn has_authored_motion_actions(&self, guid: Guid) -> bool {
        self.motion_runtimes.has_actions(guid)
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
        let driving: Vec<(Guid, u32, RemoteMotionInput)> = self
            .entities
            .iter()
            .filter_map(|entity| {
                if excluded == Some(entity.guid) || !self.is_entity_world_participant(entity.guid) {
                    return None;
                }
                let snapshot = entity.network_motion.snapshot()?;
                let source = self.motion_table_source_for_guid(entity.guid)?;
                Some((
                    entity.guid,
                    motion_table_id_for_source(source),
                    self.remote_motion_input(entity.guid, snapshot)?,
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

        let mut ticks = Vec::with_capacity(driving.len());
        for (guid, motion_table_id, input) in driving {
            let Some(table) = self.motion_sequences.table(motion_table_id) else {
                continue;
            };
            ticks.push(AuthoredBodyMotionTick {
                guid,
                tick: self
                    .motion_runtimes
                    .drive_remote(table, guid, input, quantum)
                    .clone(),
            });
        }
        ticks
    }

    /// Selects initial authored playback without advancing time, then samples physical parts.
    pub fn initial_authored_collision_pose(
        &mut self,
        guid: Guid,
    ) -> crate::motion::AuthoredCollisionPose {
        let Some(source) = self.motion_table_source_for_guid(guid) else {
            return crate::motion::AuthoredCollisionPose::Placement;
        };
        let table_id = motion_table_id_for_source(source);
        if self
            .motion_runtimes
            .get(guid)
            .is_none_or(|runtime| runtime.motion_table_id() != table_id)
        {
            let contact = self
                .runtime_body_id_for_guid(guid)
                .and_then(|id| self.scene.body(id))
                .map_or(ContactState::Unknown, |body| body.contact);
            self.reconcile_authored_motion_support(guid, contact);
        }
        self.motion_runtimes
            .get(guid)
            .map_or(crate::motion::AuthoredCollisionPose::Placement, |runtime| {
                runtime.collision_pose()
            })
    }

    /// Publishes each physical target's current authored pose after hook processing.
    pub fn publish_authored_collision_poses(
        &mut self,
        collision: &crate::CollisionScene,
    ) -> anyhow::Result<()> {
        let samples = self
            .entities
            .iter()
            .filter_map(|entity| {
                let body_id = self.runtime_body_id_for_guid(entity.guid)?;
                let sample = self
                    .motion_runtimes
                    .get(entity.guid)
                    .map_or(crate::motion::AuthoredCollisionPose::Placement, |runtime| {
                        runtime.collision_pose()
                    });
                Some((body_id, sample))
            })
            .collect::<Vec<_>>();
        for (body_id, sample) in samples {
            self.scene
                .publish_collision_pose(body_id, sample, collision)?;
        }
        Ok(())
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

    /// Apply walkable-bit interruption for gravity-enabled creatures, preserving eligible gestures.
    /// acclient.c:306805,330655,330680 route takeoff/landing through RemoveLinkAnimations.
    /// Unknown contact is hydration, not an observed physical edge. Sliding is non-walkable.
    pub(crate) fn interrupt_motion_on_support_change(
        &mut self,
        guid: Guid,
        previous: ContactState,
        current: ContactState,
    ) {
        let (Some(previous), Some(current_walkable)) = (previous.walkable(), current.walkable())
        else {
            return;
        };
        if previous == current_walkable {
            return;
        }
        // RETAIL DIVERGENCE: takeoff/landing removes pending animations in retail
        // (acclient.c:306805,330655,330680). Independent gesture playback keeps accepted
        // gestures alive on these edges for both manual and remote locomotion. Restoring
        // unconditional removal cancels the cast before the frontend can compose it. This
        // uses the existing gesture allowlist; visual scope is the 22 humanoid CharGen entries
        // in docs/animation_composition.md. Other actions retain retail interruption.
        if self.motion_runtimes.get(guid).is_some_and(|runtime| {
            self.motion_sequences
                .table(runtime.motion_table_id())
                .is_some_and(|table| runtime.has_layerable_gesture(table))
        }) && self.entities.get(guid).is_some_and(|entity| {
            entity
                .network_motion
                .snapshot()
                .is_none_or(|snapshot| snapshot.directive.is_none())
        }) {
            return;
        }
        if self.entities.get(guid).is_some_and(|entity| {
            matches!(
                entity.motion_contact(current),
                crate::motion::MotionContact::RequiresSupport(_)
            )
        }) {
            self.motion_runtimes.interrupt_transitions(guid);
        }
    }

    /// Re-selects one server-authored body's presentation after a committed support transition.
    ///
    /// The zero quantum changes the selected sequence without double-advancing the tick. Remote
    /// root actuation already consumed the offset selected from the pre-solve support state.
    pub fn reconcile_authored_motion_support(&mut self, guid: Guid, contact: ContactState) {
        let Some(entity) = self.entities.get(guid) else {
            return;
        };
        let Some(snapshot) = entity.network_motion.snapshot() else {
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
        let body = self
            .runtime_body_id_for_guid(guid)
            .and_then(|body_id| self.scene.body(body_id));
        let frame_policy = body.map_or(RemoteFramePolicy::Body, SpatialBody::remote_frame_policy);
        let pose = body.map_or(entity.position, |body| body.pose);
        let target = snapshot
            .directive
            .and_then(|directive| directive.target_guid())
            .and_then(|target| self.server_directed_target(guid, target));
        let Some(table) = self
            .motion_sequences
            .table(motion_table_id_for_source(source))
        else {
            return;
        };
        self.motion_runtimes.drive_remote(
            table,
            guid,
            RemoteMotionInput {
                snapshot,
                pose,
                contact: entity.motion_contact(contact),
                target,
                omega: Vector3::zero(),
                frame_policy,
            },
            0.0,
        );
    }

    /// Samples the current target facts used by retail object-directed movement.
    ///
    /// Object identity remains available while physical preparation is pending. The movement
    /// reducer can therefore wait for cylinder distance without converting a resolved object into
    /// retail's admission-time fixed-position fallback.
    pub fn server_directed_target(
        &self,
        actor: Guid,
        target: Guid,
    ) -> Option<ServerDirectedTarget> {
        let entity = self.entities.get(target)?;
        let pose = self
            .runtime_body_id_for_guid(target)
            .and_then(|body_id| self.scene.body(body_id))
            .map_or(entity.position, |body| body.pose);
        ServerDirectedTarget::new(pose, self.physical_cylinder_distance(actor, target))
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
    fn reduce(
        table: &MotionSequenceTable,
        baseline: Option<&MotionSequenceTable>,
        stance: u32,
    ) -> Self {
        let reduce = |command: u32| {
            crate::motion::locomotion_row(table, stance, MotionCommand(command))
                .or_else(|| {
                    baseline.and_then(|table| {
                        crate::motion::baseline_row(table, MotionCommand(command))
                    })
                })
                .map(|row| MotionCommandKinematics::reduce(row, command))
        };

        Self {
            motion_table_id: table.id,
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
    fn reduce(row: crate::motion::MotionRow<'_>, command: u32) -> Self {
        let sequence = row.sequence();
        let rates = row.rates();
        let velocity = if sequence.velocity.is_some() {
            Some(rates.velocity)
        } else if derives_forward_velocity(command)
            && matches!(row, crate::motion::MotionRow::Cycle(_))
            && !sequence.clips.is_empty()
        {
            // Controllers consume a nominal forward scalar; physical rates retain the full vector.
            Some(Vector3::new(rates.velocity.length(), 0.0, 0.0))
        } else {
            None
        };
        let omega =
            (sequence.omega.is_some() || rates.omega.length_squared() > 0.0).then_some(rates.omega);
        Self { velocity, omega }
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
