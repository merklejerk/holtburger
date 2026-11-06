//! Shared, silent posture requests. Frontends own bindings; core owns the peace prerequisite.
//!
//! RETAIL DIVERGENCE: retail refuses the three resting commands in combat. Both clients instead
//! request ordinary peace before resting. Restoring the refusal removes this convenience; the
//! census is Crouch, Sitting, Sleeping.

use super::ClientRuntime;
use super::movement_types::{MotionStyle, PlayerDriveIntent};
use super::types::{ActionResultReason, ActionResultSource, ClientCommand, ClientState};
use anyhow::Result;
use holtburger_common::Guid;
use holtburger_protocol::messages::combat::CombatMode;
use holtburger_protocol::messages::game_action::{ChangeCombatModeActionData, GameAction};
use holtburger_protocol::messages::movement::MotionStance;
use holtburger_world::motion::RestPosture;
use std::time::{Duration, Instant};

/// Bound only the peace prerequisite; held resting poses have no duration limit.
const PEACE_TIMEOUT: Duration = Duration::from_secs(10);

/// The latest explicit request, scoped to one character placement epoch.
pub(super) struct PendingRestPosture {
    /// Gameplay target; never a chat pose alias.
    posture: RestPosture,
    /// Character whose request may be completed.
    character: Guid,
    /// Teleport/reconnect boundary at submission.
    generation: u64,
    /// Deadline for observing the requested peace mode.
    deadline: Instant,
}

impl ClientRuntime {
    /// User actions supersede the pending prerequisite even when they repeat the same stance.
    pub(super) fn cancel_rest_for_command(&mut self, cmd: &ClientCommand) {
        // Explicit competing actions invalidate the pending prerequisite even if they request
        // the same combat mode. Passive held-input synchronization does not claim new intent.
        let cancels_posture = match cmd {
            ClientCommand::DriveSelf(intent) => intent.supersedes_local_motion(),
            ClientCommand::ControlCharacter(event) => !matches!(
                event.event,
                crate::client::character_motion::CharacterMotionEvent::Reset
            ),
            ClientCommand::ToggleCombatMode
            | ClientCommand::SetCombatMode(_)
            | ClientCommand::BeginCombatEngagement { .. }
            | ClientCommand::UpdateCombatProfile(_)
            | ClientCommand::CastSpell { .. }
            | ClientCommand::TargetedMeleeAttack { .. }
            | ClientCommand::TargetedMissileAttack { .. }
            | ClientCommand::SoulEmote { .. }
            | ClientCommand::ApplyEquipmentSet(_)
            | ClientCommand::Recall(_)
            | ClientCommand::Use { .. }
            | ClientCommand::UseWithTarget { .. }
            | ClientCommand::AutoMergeContainer { .. }
            | ClientCommand::SubmitInventory(_)
            | ClientCommand::GetAndWield { .. }
            | ClientCommand::SplitToWield { .. }
            | ClientCommand::Quit
            | ClientCommand::Logout => true,
            _ => false,
        };
        if cancels_posture {
            self.cancel_rest_posture();
        }
    }

    pub(super) fn cancel_rest_posture(&mut self) {
        self.pending_rest_posture = None;
        self.movement.cancel_queued_rest_posture();
    }

    pub(super) async fn request_rest_posture(&mut self, posture: RestPosture) -> Result<()> {
        self.cancel_rest_posture();
        let mode = self.world.player_combat_mode();
        if !matches!(self.state, ClientState::InWorld)
            || self.activation.is_some()
            || self.world.player.guid == Guid::NULL
            || mode == CombatMode::Undef
        {
            self.emit_action_result(
                ActionResultSource::Client,
                ActionResultReason::General(
                    "Resting requires an active character with a known combat stance.".into(),
                ),
            );
            return Ok(());
        }
        if self.inventory_change_pending() || self.active_busy_operation.is_some() {
            self.emit_action_result(
                ActionResultSource::Client,
                ActionResultReason::General(
                    "Wait for the current operation to finish before changing posture.".into(),
                ),
            );
            return Ok(());
        }
        if self
            .pending_combat_mode
            .is_some_and(|pending| pending != CombatMode::NonCombat)
        {
            self.emit_action_result(
                ActionResultSource::Client,
                ActionResultReason::General(
                    "Wait for the pending combat-mode request before changing posture.".into(),
                ),
            );
            return Ok(());
        }
        let now = Instant::now();
        self.interrupt_combat_for_movement();
        self.movement
            .enqueue_drive_intent(PlayerDriveIntent::Stop, now);
        // Standing does not require leaving combat. Resting deliberately remains peaceful:
        // these are explicit posture choices, not a temporary social-animation excursion.
        if posture != RestPosture::Standing && mode != CombatMode::NonCombat {
            self.send_game_action(GameAction::ChangeCombatMode(Box::new(
                ChangeCombatModeActionData {
                    mode: CombatMode::NonCombat,
                },
            )))
            .await?;
        }
        self.pending_rest_posture = Some(PendingRestPosture {
            posture,
            character: self.world.player.guid,
            generation: self.world_generation,
            deadline: now + PEACE_TIMEOUT,
        });
        Ok(())
    }

    pub(super) fn advance_rest_posture(&mut self, now: Instant) {
        let Some(pending) = self.pending_rest_posture.take() else {
            return;
        };
        if !matches!(self.state, ClientState::InWorld)
            || self.activation.is_some()
            || pending.character != self.world.player.guid
            || pending.generation != self.world_generation
        {
            return;
        }
        let style = match self.world.resolve_player_motion_style() {
            Ok(style) => style,
            Err(error) => {
                self.emit_action_result(
                    ActionResultSource::Client,
                    ActionResultReason::General(format!(
                        "Resting motion data is unavailable: {error}"
                    )),
                );
                return;
            }
        };
        if pending.posture != RestPosture::Standing
            && (self.world.player_combat_mode() != CombatMode::NonCombat
                || style != MotionStance::NonCombat as u32)
        {
            if now < pending.deadline {
                self.pending_rest_posture = Some(pending);
            } else {
                self.emit_action_result(
                    ActionResultSource::Client,
                    ActionResultReason::General(
                        "Timed out waiting for peace; resting was cancelled.".into(),
                    ),
                );
            }
            return;
        }
        self.movement.enqueue_authored_motion(
            holtburger_protocol::messages::movement::InterpretedMotionCommand(
                pending.posture.command().raw() as u16,
            ),
            MotionStyle::PreserveServer,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::client::{builder, types::ClientCommand};
    use holtburger_common::position::WorldPosition;
    use holtburger_common::properties::{
        PropertyDataId, PropertyInt, WorldObjectPropertyAccessorsMut,
    };
    use holtburger_world::state::motion_resolution::test_support::{
        FixtureCycle, explicit_motion_catalog,
    };

    const PLAYER: Guid = Guid(1);
    const TABLE: u32 = 0x0900_2001;
    const POSTURES: [RestPosture; 4] = [
        RestPosture::Standing,
        RestPosture::Crouching,
        RestPosture::Sitting,
        RestPosture::Lying,
    ];

    fn fixture(mode: CombatMode) -> ClientRuntime {
        let mut client = builder::build_test_client(ClientState::InWorld);
        client.world.set_motion_sequences(explicit_motion_catalog(
            TABLE,
            MotionStance::NonCombat as u32,
            POSTURES.map(|posture| FixtureCycle {
                command: posture.command().raw(),
                velocity: None,
                omega: None,
            }),
            [],
        ));
        client
            .world
            .seed_local_player_entity(PLAYER, "Player", WorldPosition::default());
        client
            .world
            .entities
            .get_mut(PLAYER)
            .unwrap()
            .set_did_prop(PropertyDataId::MotionTable, Guid(TABLE));
        confirm(&mut client, mode);
        client
    }

    fn confirm(client: &mut ClientRuntime, mode: CombatMode) {
        client
            .world
            .entities
            .get_mut(PLAYER)
            .unwrap()
            .set_int_prop(PropertyInt::CombatMode, mode as i32);
        client.world.player.last_server_motion_style = Some(if mode == CombatMode::NonCombat {
            MotionStance::NonCombat
        } else {
            MotionStance::Magic
        });
        client.pending_combat_mode = None;
    }

    async fn publish(client: &mut ClientRuntime, now: Instant) {
        let prepared = client.movement.prepare_tick(now, &mut client.world);
        client.advance_rest_posture(now);
        client
            .movement
            .advance_tick(prepared, now, &mut client.world, &mut client.session)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn combat_requests_wait_for_peace_and_latest_posture_wins() {
        for mode in [CombatMode::Melee, CombatMode::Missile, CombatMode::Magic] {
            let mut client = fixture(mode);
            client
                .request_rest_posture(RestPosture::Crouching)
                .await
                .unwrap();
            client
                .request_rest_posture(RestPosture::Lying)
                .await
                .unwrap();
            assert_eq!(
                client.session.game_action_sequence, 1,
                "one shared peace request"
            );
            let now = Instant::now();
            publish(&mut client, now).await;
            assert!(!client.world.has_local_authored_motion(PLAYER));
            assert!(client.pending_rest_posture.is_some());
            // A property update alone cannot race ahead of the confirmed motion style.
            client
                .world
                .entities
                .get_mut(PLAYER)
                .unwrap()
                .set_int_prop(PropertyInt::CombatMode, CombatMode::NonCombat as i32);
            publish(&mut client, now).await;
            assert!(client.pending_rest_posture.is_some());
            confirm(&mut client, CombatMode::NonCombat);
            publish(&mut client, now).await;
            assert_eq!(
                client.world.motion_runtimes.state(PLAYER).unwrap().substate,
                RestPosture::Lying.command()
            );
            assert!(client.pending_rest_posture.is_none());
            assert_eq!(client.session.game_action_sequence, 2);
            // Ticking idle never submits a combat restoration or a chat action.
            publish(&mut client, now + PEACE_TIMEOUT).await;
            assert_eq!(client.session.game_action_sequence, 2);
        }
    }

    #[tokio::test]
    async fn explicit_competing_commands_cancel_pending_rest_even_for_repeated_peace() {
        let drive = super::super::movement_types::CharacterDrive::builder()
            .forward()
            .build();
        for command in [
            ClientCommand::CancelRestPosture,
            ClientCommand::SetCombatMode(CombatMode::NonCombat),
            ClientCommand::DriveSelf(PlayerDriveIntent::ManualHeld(drive)),
            // Gait-only acquisition still owns motion even though it does not interrupt combat.
            ClientCommand::DriveSelf(PlayerDriveIntent::ManualHeld(Default::default())),
        ] {
            let mut client = fixture(CombatMode::Magic);
            client
                .request_rest_posture(RestPosture::Sitting)
                .await
                .unwrap();
            client.handle_command(command).await.unwrap();
            confirm(&mut client, CombatMode::NonCombat);
            publish(&mut client, Instant::now()).await;
            assert!(client.pending_rest_posture.is_none());
            assert!(!client.world.has_local_authored_motion(PLAYER));
        }
    }

    #[tokio::test]
    async fn timeout_and_world_replacement_cannot_replay_a_rest_request() {
        for change_world in [false, true] {
            let mut client = fixture(CombatMode::Magic);
            client
                .request_rest_posture(RestPosture::Lying)
                .await
                .unwrap();
            if change_world {
                client.bump_world_generation();
            } else {
                let now = client.pending_rest_posture.as_ref().unwrap().deadline;
                publish(&mut client, now).await;
            }
            confirm(&mut client, CombatMode::NonCombat);
            publish(&mut client, Instant::now()).await;
            assert!(client.pending_rest_posture.is_none());
            assert!(!client.world.has_local_authored_motion(PLAYER));
        }
    }

    #[tokio::test]
    async fn every_posture_is_silent_and_standing_preserves_combat() {
        for posture in POSTURES {
            let mut client = fixture(if posture == RestPosture::Standing {
                CombatMode::Magic
            } else {
                CombatMode::NonCombat
            });
            client.request_rest_posture(posture).await.unwrap();
            publish(&mut client, Instant::now()).await;
            assert_eq!(
                client.session.game_action_sequence, 1,
                "only the motion packet"
            );
            assert_eq!(
                client.world.motion_runtimes.state(PLAYER).unwrap().substate,
                posture.command()
            );
        }
    }

    #[tokio::test]
    async fn death_during_the_peace_wait_cannot_be_overwritten_by_resting() {
        use holtburger_protocol::{
            errors::WeenieError, messages::movement::InterpretedMotionCommand,
        };
        use holtburger_world::entity::{EntityMotionSnapshot, EntityNetworkMotion};
        let mut client = fixture(CombatMode::Magic);
        client
            .request_rest_posture(RestPosture::Lying)
            .await
            .unwrap();
        confirm(&mut client, CombatMode::NonCombat);
        client
            .world
            .entities
            .get_mut(PLAYER)
            .unwrap()
            .network_motion = EntityNetworkMotion::Initialized(EntityMotionSnapshot {
            current_style: Some(MotionStance::NonCombat),
            forward_command: Some(InterpretedMotionCommand::DEAD),
            ..Default::default()
        });
        let before = client.session.game_action_sequence;
        publish(&mut client, Instant::now()).await;
        assert_eq!(client.session.game_action_sequence, before);
        assert!(!client.world.has_local_authored_motion(PLAYER));
        assert_eq!(
            client.movement.take_authored_motion_rejections(),
            [WeenieError::Dead]
        );
    }

    #[test]
    fn direct_motion_admission_refuses_each_resting_posture_in_combat() {
        use holtburger_protocol::{
            errors::WeenieError, messages::movement::InterpretedMotionCommand,
        };
        for (posture, expected) in [
            (RestPosture::Crouching, WeenieError::CantCrouchInCombat),
            (RestPosture::Sitting, WeenieError::CantSitInCombat),
            (RestPosture::Lying, WeenieError::CantLieDownInCombat),
        ] {
            let mut client = fixture(CombatMode::Magic);
            let result = client.world.submit_local_authored_motion_command(
                InterpretedMotionCommand(posture.command().raw() as u16),
                1.0,
                1,
                None,
            );
            assert!(
                matches!(result, Err(holtburger_world::state::LocalAuthoredMotionCommandError::Refused { reason }) if reason == expected)
            );
        }
    }
}
