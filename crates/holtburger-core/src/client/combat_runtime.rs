//! Shared combat request execution; world and existing operation owners retain state.
use super::types::{ActionResultReason, ActionResultSource, ClientCommand, SpellCastAim};
use super::{ClientRuntime, ClientState};
use anyhow::Result;
use holtburger_common::Guid;
use holtburger_protocol::messages::combat::CombatMode;
use holtburger_protocol::messages::*;
use holtburger_world::context::WorldContextExt;
use holtburger_world::spell::SpellCastingRoute;

/// Resolved cast request shared by wire publication and pending-operation correlation.
#[derive(Debug)]
struct PreparedSpellCast {
    /// Canonical spell identifier after stripping the frontend marker bit.
    spell_id: u32,
    /// Actual recipient after resolving self-target and untargeted spell routes.
    target: Option<Guid>,
}

impl PreparedSpellCast {
    fn into_action(self) -> GameAction {
        match self.target {
            Some(target) => GameAction::CastTargetedSpell(Box::new(CastTargetedSpellActionData {
                target,
                spell_id: self.spell_id,
            })),
            None => GameAction::CastUntargetedSpell(Box::new(CastUntargetedSpellActionData {
                spell_id: self.spell_id,
            })),
        }
    }
}

impl ClientRuntime {
    pub(super) async fn handle_combat_command(&mut self, command: ClientCommand) -> Result<()> {
        if !matches!(self.state, ClientState::InWorld) {
            return Ok(());
        }
        match command {
            ClientCommand::CastSpell { spell_id, aim } => self.cast_spell(spell_id, aim).await,
            ClientCommand::TargetedMeleeAttack {
                target,
                attack_height,
                power_level,
            } => {
                log::info!(
                    ">>> Targeted melee attack on 0x{:08X} ({:?}, power {:.2})",
                    target.0,
                    attack_height,
                    power_level
                );
                self.send_game_action(GameAction::TargetedMeleeAttack(Box::new(
                    TargetedMeleeAttackActionData {
                        target_guid: target,
                        attack_height,
                        power_level,
                    },
                )))
                .await
            }
            ClientCommand::TargetedMissileAttack {
                target,
                attack_height,
                accuracy_level,
            } => {
                log::info!(
                    ">>> Targeted missile attack on 0x{:08X} ({:?}, accuracy {:.2})",
                    target.0,
                    attack_height,
                    accuracy_level
                );
                self.send_game_action(GameAction::TargetedMissileAttack(Box::new(
                    TargetedMissileAttackActionData {
                        target_guid: target,
                        attack_height,
                        accuracy_level,
                    },
                )))
                .await
            }
            ClientCommand::ToggleCombatMode => {
                // An equipment transaction temporarily enters peace. Do not interpret that
                // intermediate stance as a new player request or interrupt its restoration.
                if self.equipment_operation.is_some() {
                    self.emit_action_result(
                        ActionResultSource::Client,
                        ActionResultReason::General(
                            "Wait for the equipment change to finish.".into(),
                        ),
                    );
                    return Ok(());
                }
                let current = self.world.player_combat_mode();
                if self.world.player.guid == Guid::NULL || current == CombatMode::Undef {
                    self.emit_action_result(
                        ActionResultSource::Client,
                        ActionResultReason::General(
                            "Character combat state has not arrived yet.".into(),
                        ),
                    );
                    return Ok(());
                }
                let mode = match current {
                    CombatMode::NonCombat => self.world.get_suggested_combat_mode(),
                    _ => CombatMode::NonCombat,
                };
                if mode == current {
                    self.emit_action_result(
                        ActionResultSource::Client,
                        ActionResultReason::General(
                            "You cannot enter combat with the currently held equipment.".into(),
                        ),
                    );
                    return Ok(());
                }
                // Stance completion is a mode/motion update, not UseDone. ACE owns its
                // NextUseTime animation queue (Player_Combat.cs:737), so do not arm use busy state.
                self.send_game_action(GameAction::ChangeCombatMode(Box::new(
                    ChangeCombatModeActionData { mode },
                )))
                .await
            }
            ClientCommand::SetCombatMode(mode) => {
                self.stop_equipment_change(
                    "Combat mode changed by another command; the last request may still complete",
                );
                log::info!(">>> Changing combat mode to: {:?}", mode);
                self.send_game_action(GameAction::ChangeCombatMode(Box::new(
                    ChangeCombatModeActionData { mode },
                )))
                .await
            }
            ClientCommand::CancelAttack => {
                log::info!(">>> Canceling attack");
                self.send_game_action(GameAction::CancelAttack(Box::new(
                    CancelAttackActionData {},
                )))
                .await
            }
            _ => unreachable!(),
        }
    }

    fn prepare_spell_cast(
        &self,
        spell_id: u32,
        aim: SpellCastAim,
    ) -> Result<PreparedSpellCast, &'static str> {
        let spell_id = spell_id & 0x7fff_ffff;
        let Some(spell) = self.world.spell_catalog.get(spell_id) else {
            return Err("Spell definition is unavailable.");
        };
        if self.known_spells_character == Some(self.world.player.guid)
            && !self.world.player.spells.contains_key(&spell_id)
        {
            return Err("You do not know this spell.");
        }
        let target = match aim {
            SpellCastAim::Untargeted => None,
            SpellCastAim::Normal { selection } => match spell.casting_route() {
                SpellCastingRoute::SelfTarget => Some(self.world.player.guid),
                SpellCastingRoute::Untargeted => None,
                SpellCastingRoute::SelectedTarget => {
                    let Some(target) = selection.filter(|id| *id != Guid::NULL) else {
                        return Err("Select a target before casting this spell.");
                    };
                    Some(target)
                }
            },
        };
        if self.world.player.guid == Guid::NULL {
            return Err("Character identity has not arrived yet.");
        }
        Ok(PreparedSpellCast { spell_id, target })
    }

    async fn cast_spell(&mut self, spell_id: u32, aim: SpellCastAim) -> Result<()> {
        let action = match self.prepare_spell_cast(spell_id, aim) {
            Ok(action) => action,
            Err(message) => {
                self.reject_combat_request(message);
                return Ok(());
            }
        };
        if !self.arm_busy_operation(super::PendingOperation::SpellCast {
            target: action.target,
        }) {
            self.reject_combat_request("Wait for the current action to finish.");
            return Ok(());
        }
        let result = self.send_game_action(action.into_action()).await;
        if result.is_err() {
            self.clear_busy_operation();
        }
        result
    }

    fn reject_combat_request(&self, message: &str) {
        self.emit_action_result(
            ActionResultSource::Client,
            ActionResultReason::General(message.into()),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::client::builder::build_test_client;
    use crate::client::movement_types::{CharacterDrive, PlayerDriveIntent};
    use crate::client::types::BusyOperationKind;
    use crate::client::types::{BusyOperationResult, ClientExitCause, ClientViewEvent};
    use byteorder::{LittleEndian, ReadBytesExt};
    use holtburger_common::position::WorldPosition;
    use holtburger_common::properties::{ItemType, PropertyInt, WorldObjectPropertyAccessorsMut};
    use holtburger_protocol::errors::WeenieError;
    use holtburger_protocol::messages::transport::{FragmentHeader, PacketHeader, packet_flags};
    use holtburger_protocol::traits::ProtocolUnpack;
    use holtburger_world::WorldState;
    use holtburger_world::entity::{
        EntityMotionAdmission, EntityMotionDirective, EntityTurnToParameters, OrderedMotionScalar,
    };
    use holtburger_world::motion::begin_server_directed_motion;
    use holtburger_world::spell::{MagicSchool, SpellCatalog, SpellExtrasInfo, SpellInfo};
    use std::collections::HashMap;
    use std::io::{Cursor, Read};
    use std::sync::Arc;
    use std::time::{Duration, Instant};
    fn spell_info(school: MagicSchool, bitfield: u32, non_component_target_type: u32) -> SpellInfo {
        SpellInfo {
            name: "Test Spell".to_string(),
            description: String::new(),
            school,
            icon_id: 0,
            category: 0,
            bitfield,
            base_mana: 0,
            base_range_constant: 0.0,
            base_range_mod: 0.0,
            power: 0,
            spell_economy_mod: 0.0,
            formula_version: 0,
            component_loss: 0.0,
            meta_spell_type: 0,
            meta_spell_id: 0,
            extras: SpellExtrasInfo::None,
            components: [0; 8],
            caster_effect: 0,
            target_effect: 0,
            fizzle_effect: 0,
            recovery_interval: 0.0,
            recovery_amount: 0.0,
            display_order: 0,
            non_component_target_type,
            mana_mod: 0,
        }
    }

    fn world_with_spell(player_guid: Guid, spell_id: u32, spell: SpellInfo) -> WorldState {
        let mut world = WorldState::synthetic();
        world.player.guid = player_guid;
        world.spell_catalog = Arc::new(SpellCatalog {
            spells: HashMap::from([(spell_id, spell)]),
            ..Default::default()
        });
        world
    }

    fn client(flags: u32) -> ClientRuntime {
        let mut client = build_test_client(ClientState::InWorld);
        let mut spell = spell_info(MagicSchool::WarMagic, flags, 0);
        spell.components = [1, 2, 3, 4, 0x31, 0, 0, 0];
        client.world = world_with_spell(Guid(1), 42, spell);
        client
    }

    #[test]
    fn recipient_intent_and_canonical_identity_survive_preparation() {
        for (flags, aim, expected) in [
            (
                8,
                SpellCastAim::Normal {
                    selection: Some(Guid(2)),
                },
                Some(Guid(1)),
            ),
            (
                0,
                SpellCastAim::Normal {
                    selection: Some(Guid(2)),
                },
                Some(Guid(2)),
            ),
            (8, SpellCastAim::Untargeted, None),
            (0, SpellCastAim::Untargeted, None),
        ] {
            let client = client(flags);
            let prepared = client.prepare_spell_cast(0x8000_002a, aim).unwrap();
            assert_eq!(prepared.target, expected);
            let action = prepared.into_action();
            match (action, expected) {
                (GameAction::CastTargetedSpell(data), Some(target)) => {
                    assert_eq!(data.target, target);
                    assert_eq!(data.spell_id, 42);
                }
                (GameAction::CastUntargetedSpell(data), None) => assert_eq!(data.spell_id, 42),
                actual => panic!("unexpected route: {actual:?}"),
            }
        }
        let mut client = client(0);
        assert!(
            client
                .prepare_spell_cast(42, SpellCastAim::Normal { selection: None })
                .is_err()
        );
        assert!(
            client
                .prepare_spell_cast(
                    42,
                    SpellCastAim::Normal {
                        selection: Some(Guid::NULL)
                    }
                )
                .is_err()
        );
        assert!(
            client
                .prepare_spell_cast(99, SpellCastAim::Untargeted)
                .is_err()
        );
        client.known_spells_character = Some(Guid(1));
        assert_eq!(
            client
                .prepare_spell_cast(42, SpellCastAim::Untargeted)
                .unwrap_err(),
            "You do not know this spell."
        );
    }

    #[tokio::test]
    async fn cast_does_not_wait_for_stance_and_preserves_busy_overlap() {
        let mut client = client(0);
        client
            .handle_command(ClientCommand::SetCombatMode(CombatMode::Magic))
            .await
            .unwrap();
        let command = || ClientCommand::CastSpell {
            spell_id: 42,
            aim: SpellCastAim::Normal {
                selection: Some(Guid(2)),
            },
        };
        client.handle_command(command()).await.unwrap();
        assert_eq!(client.session.game_action_sequence, 2);
        assert_eq!(
            client.active_busy_operation(),
            Some(BusyOperationKind::SpellCast)
        );
        assert_eq!(
            client.active_busy_operation.as_ref().unwrap().operation,
            crate::client::PendingOperation::SpellCast {
                target: Some(Guid(2))
            }
        );
        let mut events = client.subscribe_client_view_events();
        client.handle_command(command()).await.unwrap();
        assert_eq!(client.session.game_action_sequence, 2);
        assert!(matches!(
            events.try_recv().unwrap(),
            ClientViewEvent::ActionResult { .. }
        ));
        client.note_busy_error(WeenieError::YoureTooBusy, None);
        client.finish_busy_operation_from_use_done(WeenieError::None);
        assert!(client.active_busy_operation.is_none());
        let mut saw_error = false;
        while let Ok(event) = events.try_recv() {
            if let ClientViewEvent::BusyOperationFinished {
                operation: BusyOperationKind::SpellCast,
                result:
                    BusyOperationResult::Completed {
                        error: WeenieError::YoureTooBusy,
                        ..
                    },
            } = event
            {
                saw_error = true;
            }
        }
        assert!(saw_error);
        client.handle_command(command()).await.unwrap();
        client.poll_busy_timeout(
            Instant::now() + crate::client::BUSY_OPERATION_TIMEOUT + Duration::from_secs(1),
        );
        assert!(client.active_busy_operation.is_none());
        client.handle_command(command()).await.unwrap();
        client.set_exit_cause(ClientExitCause::ServerDisconnect);
        assert!(client.active_busy_operation.is_none());
    }
    #[tokio::test]
    async fn failed_send_releases_busy_and_publishes_idle() {
        let mut client = client(0);
        // Session binds IPv4; an IPv6 destination deterministically fails send_to.
        client.session = holtburger_session::Session::new("[::1]:9000".parse().unwrap())
            .await
            .unwrap();
        let mut events = client.subscribe_client_view_events();
        assert!(
            client
                .handle_command(ClientCommand::CastSpell {
                    spell_id: 42,
                    aim: SpellCastAim::Untargeted
                })
                .await
                .is_err()
        );
        assert!(client.active_busy_operation.is_none());
        let mut states = Vec::new();
        while let Ok(event) = events.try_recv() {
            if let ClientViewEvent::BusyStateUpdated { busy } = event {
                states.push(busy);
            }
        }
        assert_eq!(states, [Some(BusyOperationKind::SpellCast), None]);
    }

    #[tokio::test]
    async fn physical_contact_edges_do_not_complete_spell_busy_state() {
        let mut client = client(0);
        client.world.seed_local_player_entity(
            Guid(1),
            "Caster",
            WorldPosition {
                landblock_id: Guid(0x1234_0000),
                ..WorldPosition::default()
            },
        );
        let entity = client.world.player_entity_mut().unwrap();
        entity.set_int_prop(PropertyInt::ItemType, ItemType::CREATURE.bits() as i32);
        entity
            .physics
            .reconcile(holtburger_world::resolve_effective_entity_physics_state(
                holtburger_common::properties::PhysicsState::GRAVITY,
            ));
        client
            .handle_command(ClientCommand::CastSpell {
                spell_id: 42,
                aim: SpellCastAim::Untargeted,
            })
            .await
            .unwrap();
        for contact in [
            holtburger_world::ContactState::Grounded,
            holtburger_world::ContactState::Airborne,
            holtburger_world::ContactState::Grounded,
        ] {
            client.world.apply_spatial_body_event(
                &holtburger_world::SpatialBodyEvent::ContactChanged {
                    body_id: holtburger_world::SpatialBodyId::LocalPlayer(Guid(1)),
                    contact,
                },
            );
            assert_eq!(
                client.active_busy_operation(),
                Some(BusyOperationKind::SpellCast)
            );
        }
        client.finish_busy_operation_from_use_done(WeenieError::None);
        assert!(client.active_busy_operation.is_none());
    }

    #[tokio::test]
    async fn new_character_entry_releases_previous_operation() {
        let mut client = client(0);
        client.arm_busy_operation(BusyOperationKind::SpellCast);
        client.character_selection.character_id = Some(Guid(2));
        client.begin_world_entry_transition().await.unwrap();
        assert!(client.active_busy_operation.is_none());
    }

    #[test]
    fn naturally_untargeted_formula_ignores_selection() {
        let mut client = client(0);
        Arc::make_mut(&mut client.world.spell_catalog)
            .spells
            .get_mut(&42)
            .unwrap()
            .components[4] = 0x3a;
        assert!(matches!(
            client
                .prepare_spell_cast(
                    42,
                    SpellCastAim::Normal {
                        selection: Some(Guid(2))
                    }
                )
                .unwrap()
                .into_action(),
            GameAction::CastUntargetedSpell(_)
        ));
    }
    #[tokio::test]
    async fn manual_takeover_publishes_movement_without_cancelling_cast() {
        let mut client = client(0);
        let pose = WorldPosition {
            landblock_id: Guid(0x1000_0001),
            ..WorldPosition::default()
        };
        client
            .world
            .seed_local_player_entity(Guid(1), "Player", pose);
        client
            .world
            .player_entity_mut()
            .unwrap()
            .set_int_prop(PropertyInt::ItemType, ItemType::CREATURE.bits() as i32);
        let capture = tempfile::NamedTempFile::new().unwrap();
        client
            .session
            .set_capture(capture.path().to_str().unwrap())
            .unwrap();
        client
            .handle_command(ClientCommand::CastSpell {
                spell_id: 42,
                aim: SpellCastAim::Untargeted,
            })
            .await
            .unwrap();
        let now = Instant::now();
        let scalar = |value| OrderedMotionScalar::from_f32(value).unwrap();
        let motion = begin_server_directed_motion(
            EntityMotionDirective::TurnToHeading {
                admission: EntityMotionAdmission {
                    object_instance_sequence: 1,
                    movement_sequence: 1,
                    server_control_sequence: 1,
                    is_autonomous: false,
                },
                params: EntityTurnToParameters {
                    flags: 0,
                    speed: scalar(1.0),
                    desired_heading_degrees: scalar(180.0),
                },
            },
            pose,
            None,
        );
        client
            .movement
            .admit_server_controlled_motion(Some(motion), now, &mut client.world);
        client
            .handle_command(ClientCommand::DriveSelf(PlayerDriveIntent::ManualHeld(
                CharacterDrive::builder().walk().turn_left().build(),
            )))
            .await
            .unwrap();
        client
            .movement
            .tick(now, &mut client.world, &mut client.session)
            .await
            .unwrap();
        assert!(client.movement.has_active_manual_drive());
        assert!(!client.movement.has_server_controlled_motion());
        assert_eq!(
            client.active_busy_operation(),
            Some(BusyOperationKind::SpellCast)
        );
        let actions = captured_actions(&capture);
        assert!(matches!(
            actions.first(),
            Some(GameAction::CastUntargetedSpell(_))
        ));
        assert!(
            actions[1..]
                .iter()
                .any(|action| matches!(action, GameAction::MoveToState(_)))
        );
        assert!(actions[1..].iter().all(|action| matches!(
            action,
            GameAction::MoveToState(_) | GameAction::AutonomousPosition(_)
        )));
        client.finish_busy_operation_from_use_done(WeenieError::None);
        assert!(client.active_busy_operation.is_none());
    }

    fn captured_actions(file: &tempfile::NamedTempFile) -> Vec<GameAction> {
        let bytes = std::fs::read(file.path()).unwrap();
        let mut capture = Cursor::new(bytes.as_slice());
        let mut actions = Vec::new();
        while (capture.position() as usize) < bytes.len() {
            assert_eq!(
                capture.read_u8().unwrap(),
                holtburger_session::capture::Direction::Outbound as u8
            );
            capture.read_u64::<LittleEndian>().unwrap();
            let address_len = capture.read_u16::<LittleEndian>().unwrap();
            capture.set_position(capture.position() + u64::from(address_len));
            let packet_len = capture.read_u32::<LittleEndian>().unwrap();
            let mut packet = vec![0; packet_len as usize];
            capture.read_exact(&mut packet).unwrap();
            let mut offset = 0;
            let header = PacketHeader::unpack(&packet, &mut offset).unwrap();
            assert_eq!(header.flags, packet_flags::BLOB_FRAGMENTS);
            let fragment = FragmentHeader::unpack(&packet, &mut offset).unwrap();
            assert_eq!(fragment.count, 1);
            let GameMessage::GameAction(message) =
                GameMessage::unpack(&packet, &mut offset).unwrap()
            else {
                panic!("movement fixture emitted a non-action message");
            };
            assert_eq!(offset, packet.len());
            actions.push(message.action);
        }
        actions
    }
}
