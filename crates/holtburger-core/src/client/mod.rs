use holtburger_protocol::errors::WeenieError;
use holtburger_session::Session;
use holtburger_world::{WorldEvent, WorldState};
use std::collections::HashMap;
use std::time::{Duration, Instant};
use tokio::sync::{broadcast, mpsc};

mod builder;
mod character_selection;
mod commands;
mod messages;
mod movement;
pub mod movement_types;
mod runtime;
pub mod runtime_body_view_cache;
mod simulation;
pub mod types;
pub use builder::ClientRuntimeBuilder;
use character_selection::CharacterSelectionState;
use movement::MovementSystem;
use simulation::ClientSimulationSystem;
use types::*;

/// Physics tick interval in milliseconds.
const PHYSICS_TICK_MS: u64 = 30;
const BUSY_OPERATION_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, PartialEq, Eq)]
struct PendingBusyOperation {
    operation: BusyOperationKind,
    deadline: Instant,
    pending_error: Option<(WeenieError, Option<String>)>,
}

pub struct ClientRuntime {
    pub session: Session,
    pub world: WorldState,
    active_confirmation: Option<ActiveCharacterConfirmation>,
    active_busy_operation: Option<PendingBusyOperation>,
    state: ClientState,
    client_view_event_tx: broadcast::Sender<ClientViewEvent>,
    command_rx: Option<mpsc::UnboundedReceiver<ClientCommand>>,
    message_dump_dir: Option<std::path::PathBuf>,
    message_counter: usize,
    movement: MovementSystem,
    simulation: ClientSimulationSystem,
    character_selection: CharacterSelectionState,
    turbine_chat: TurbineChatState,
}

impl ClientRuntime {
    fn player_character_options(&self) -> PlayerCharacterOptions {
        PlayerCharacterOptions {
            options1: self.world.player.options1,
            options2: self.world.player.options2,
        }
    }

    fn emit_player_options_updated(&self) {
        let _ = self
            .client_view_event_tx
            .send(ClientViewEvent::PlayerOptionsUpdated {
                options: self.player_character_options(),
            });
    }

    fn emit_active_character_confirmation_updated(&self) {
        let _ =
            self.client_view_event_tx
                .send(ClientViewEvent::ActiveCharacterConfirmationUpdated {
                    confirmation: self.active_confirmation.clone(),
                });
    }

    fn active_busy_operation(&self) -> Option<BusyOperationKind> {
        self.active_busy_operation
            .as_ref()
            .map(|pending| pending.operation)
    }

    fn emit_busy_state_updated(&self) {
        let _ = self
            .client_view_event_tx
            .send(ClientViewEvent::BusyStateUpdated {
                busy: self.active_busy_operation(),
            });
    }

    fn emit_busy_operation_finished(
        &self,
        operation: BusyOperationKind,
        result: BusyOperationResult,
    ) {
        let _ = self
            .client_view_event_tx
            .send(ClientViewEvent::BusyOperationFinished { operation, result });
    }

    pub(super) fn emit_action_result(
        &self,
        source: ActionResultSource,
        reason: ActionResultReason,
    ) {
        let _ = self
            .client_view_event_tx
            .send(ClientViewEvent::ActionResult { source, reason });
    }

    pub(super) fn emit_log_message(&self, message: String) {
        let _ = self
            .client_view_event_tx
            .send(ClientViewEvent::LogMessage(message));
    }

    fn emit_self_movement_kinematics_updated(&self) {
        let kinematics = match self.world.resolve_self_movement_kinematics() {
            Ok(kinematics) => Some(kinematics),
            Err(error) => {
                log::warn!("self movement kinematics unavailable: {error}");
                None
            }
        };
        let _ = self
            .client_view_event_tx
            .send(ClientViewEvent::SelfMovementKinematicsUpdated { kinematics });
    }

    fn updates_affect_self_movement_kinematics(
        updates: &[holtburger_common::properties::PropertyUpdate],
    ) -> bool {
        updates.iter().any(|update| {
            matches!(
                update,
                holtburger_common::properties::PropertyUpdate::DataId(
                    holtburger_common::properties::PropertyDataId::MotionTable
                        | holtburger_common::properties::PropertyDataId::Setup,
                    _,
                )
            )
        })
    }

    pub(super) fn arm_busy_operation(&mut self, operation: BusyOperationKind) -> bool {
        if let Some(active) = self.active_busy_operation.as_ref() {
            log::warn!(
                "Ignoring busy-tracked {:?} while {:?} is still pending.",
                operation,
                active.operation
            );
            return false;
        }

        self.active_busy_operation = Some(PendingBusyOperation {
            operation,
            deadline: Instant::now() + BUSY_OPERATION_TIMEOUT,
            pending_error: None,
        });
        self.emit_busy_state_updated();
        true
    }

    pub(super) fn note_busy_error(&mut self, error: WeenieError, parameter: Option<String>) {
        if let Some(pending) = &mut self.active_busy_operation {
            pending.pending_error = Some((error, parameter));
        }
    }

    pub(super) fn finish_busy_operation_from_use_done(&mut self, error: WeenieError) {
        let Some(pending) = self.active_busy_operation.take() else {
            return;
        };

        let (resolved_error, parameter) = if error == WeenieError::None {
            pending.pending_error.unwrap_or((error, None))
        } else {
            (error, None)
        };

        self.emit_busy_state_updated();
        self.emit_busy_operation_finished(
            pending.operation,
            BusyOperationResult::Completed {
                error: resolved_error,
                parameter,
            },
        );
    }

    fn emit_fellowship_state_updated(&self) {
        let _ = self
            .client_view_event_tx
            .send(ClientViewEvent::FellowshipStateUpdated {
                fellowship: self.world.fellowship.clone(),
            });
    }

    fn emit_vendor_state_updated(&self) {
        let _ = self
            .client_view_event_tx
            .send(ClientViewEvent::VendorStateUpdated {
                vendor: self.world.vendor.clone(),
            });
    }

    fn emit_trade_state_updated(&self) {
        let _ = self
            .client_view_event_tx
            .send(ClientViewEvent::TradeStateUpdated {
                trade: self.world.trade.clone(),
            });
    }

    pub(super) fn emit_initial_view_state_snapshot(&mut self) {
        self.emit_fellowship_state_updated();
        self.emit_vendor_state_updated();
        self.emit_trade_state_updated();
        self.emit_runtime_body_snapshot();
    }

    pub fn subscribe_client_view_events(&self) -> broadcast::Receiver<ClientViewEvent> {
        self.client_view_event_tx.subscribe()
    }

    pub fn set_command_rx(&mut self, rx: mpsc::UnboundedReceiver<ClientCommand>) {
        self.command_rx = Some(rx);
    }

    fn send_status_event(&self) {
        let _ = self
            .client_view_event_tx
            .send(ClientViewEvent::StatusUpdate {
                state: self.state.clone(),
            });
    }

    pub fn handle_world_event(&self, event: &WorldEvent) {
        self.emit_world_view_projection(event);
    }

    fn emit_world_view_projection(&self, event: &WorldEvent) {
        match event {
            WorldEvent::PlayerEnchantmentsUpdated { enchantments } => {
                let _ =
                    self.client_view_event_tx
                        .send(ClientViewEvent::PlayerEnchantmentsUpdated {
                            enchantments: enchantments.clone(),
                        });
            }
            WorldEvent::DerivedStatsUpdated(data) => {
                let attributes = data
                    .attributes
                    .iter()
                    .cloned()
                    .map(|attribute| (attribute.attr_type, attribute))
                    .collect();
                let skills = data
                    .skills
                    .iter()
                    .cloned()
                    .map(|skill| (skill.skill_type, skill))
                    .collect();
                let vitals = data
                    .vitals
                    .iter()
                    .cloned()
                    .map(|vital| (vital.vital_type, vital))
                    .collect();

                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::PlayerStatsSkillsUpdated {
                        attributes,
                        skills,
                        resistances: data.resistances.clone(),
                        armor: data.armor,
                        vitae: data.vitae,
                    });
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::PlayerVitalsUpdated { vitals });
            }
            WorldEvent::AttributeUpdated(_) | WorldEvent::SkillUpdated(_) => {}
            WorldEvent::LevelInfoUpdated(level_info) => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::PlayerLevelInfoUpdated {
                        level_info: level_info.clone(),
                    });
            }
            WorldEvent::VitalUpdated(vital) => {
                let mut vitals = HashMap::new();
                vitals.insert(vital.vital_type, vital.clone());
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::PlayerVitalsUpdated { vitals });
            }
            WorldEvent::SpellUpdated { spell_ids, .. }
            | WorldEvent::SpellRemoved { spell_ids, .. } => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::PlayerSpellsUpdated {
                        spell_ids: spell_ids.clone(),
                    });
            }
            WorldEvent::PlayerInfo(data) => {
                self.emit_player_options_updated();
                let _ =
                    self.client_view_event_tx
                        .send(ClientViewEvent::PlayerEnchantmentsUpdated {
                            enchantments: data.enchantments.clone(),
                        });

                let attributes = data
                    .attributes
                    .iter()
                    .cloned()
                    .map(|attribute| (attribute.attr_type, attribute))
                    .collect();
                let skills = data
                    .skills
                    .iter()
                    .cloned()
                    .map(|skill| (skill.skill_type, skill))
                    .collect();
                let vitals = data
                    .vitals
                    .iter()
                    .cloned()
                    .map(|vital| (vital.vital_type, vital))
                    .collect();
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::PlayerStatsSkillsUpdated {
                        attributes,
                        skills,
                        resistances: data.resistances.clone(),
                        armor: data.armor,
                        vitae: data.vitae,
                    });
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::PlayerLevelInfoUpdated {
                        level_info: data.level_info.clone(),
                    });
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::PlayerVitalsUpdated { vitals });

                let mut spell_ids = data.spells.clone();
                spell_ids.sort();
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::PlayerSpellsUpdated { spell_ids });

                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::EntitySpawned {
                        entity: data.entity.clone(),
                    });
                self.emit_self_movement_kinematics_updated();
            }
            WorldEvent::TeleportStarted { sequence } => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::TeleportStarted {
                        sequence: *sequence,
                    });
            }
            WorldEvent::EntitySpawned(entity) => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::EntitySpawned {
                        entity: entity.clone(),
                    });
                if entity.guid == self.world.player.guid {
                    self.emit_self_movement_kinematics_updated();
                }
            }
            WorldEvent::EntityReplaced(entity) => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::EntityReplaced {
                        entity: entity.clone(),
                    });
                if entity.guid == self.world.player.guid {
                    self.emit_self_movement_kinematics_updated();
                }
            }
            WorldEvent::EntityHealthUpdated {
                guid,
                health_fraction,
            } => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::EntityHealthUpdated {
                        guid: *guid,
                        health_fraction: *health_fraction,
                    });
            }
            WorldEvent::EntityBookUpdated { guid, book } => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::EntityBookUpdated {
                        guid: *guid,
                        book: book.clone(),
                    });
            }
            WorldEvent::EntityIdentified(entity) => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::EntityIdentified {
                        entity: entity.clone(),
                    });
            }
            WorldEvent::EntityDespawned(guid) => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::EntityDespawned { guid: *guid });
                if *guid == self.world.player.guid {
                    self.emit_self_movement_kinematics_updated();
                }
            }
            WorldEvent::PropertiesUpdated { guid, updates } => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::EntityPropertiesUpdated {
                        guid: *guid,
                        updates: updates.clone(),
                    });
                if *guid == self.world.player.guid
                    && Self::updates_affect_self_movement_kinematics(updates.as_slice())
                {
                    self.emit_self_movement_kinematics_updated();
                }
            }
            WorldEvent::EntityMoved { guid, pos } => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::EntityMoved {
                        guid: *guid,
                        pos: *pos,
                    });
            }
            WorldEvent::EntityVectorUpdated {
                guid,
                velocity,
                omega,
            } => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::EntityKinematicsUpdated {
                        guid: *guid,
                        velocity: *velocity,
                        omega: *omega,
                    });
            }
            WorldEvent::EntityMotionUpdated { guid, snapshot } => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::EntityMotionUpdated {
                        guid: *guid,
                        snapshot: *snapshot,
                    });
            }
            WorldEvent::PlayerGroundedUpdated { grounded } => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::PlayerGroundedUpdated {
                        grounded: *grounded,
                    });
            }
            WorldEvent::SelfServerControlledMotion(data) => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::SelfServerControlledMotion { data: data.clone() });
            }
            WorldEvent::ForcedReposition {
                guid,
                pos,
                sequence,
            } => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::ForcedReposition {
                        guid: *guid,
                        pos: *pos,
                        sequence: *sequence,
                    });
            }
            WorldEvent::RuntimeBodyChanged { body_id } => {
                if let Some(body) = self.world.runtime_body_view(*body_id) {
                    let _ = self
                        .client_view_event_tx
                        .send(ClientViewEvent::RuntimeBodyUpserted {
                            body: Box::new(body),
                        });
                }
            }
            WorldEvent::RuntimeBodyRemoved { body_id } => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::RuntimeBodyRemoved { body_id: *body_id });
            }
            WorldEvent::RuntimeBodiesReset { cause } => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::RuntimeBodiesReset { cause: *cause });
            }
            WorldEvent::EntityStateUpdated { .. } => {}
            WorldEvent::ServerTimeUpdate(time) => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::ServerTimeUpdated { time: *time });
            }
            WorldEvent::CombatModeUpdated(mode) => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::CombatModeUpdated { mode: *mode });
            }
            WorldEvent::VendorStateUpdated(vendor) => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::VendorStateUpdated {
                        vendor: vendor.clone(),
                    });
            }
            WorldEvent::VendorItemIdentified(item) => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::VendorItemIdentified(item.clone()));
            }
            WorldEvent::FellowshipStateUpdated(fellowship) => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::FellowshipStateUpdated {
                        fellowship: fellowship.clone(),
                    });
            }
            WorldEvent::FellowshipActivity(activity) if self.state == ClientState::InWorld => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::FellowshipActivity {
                        activity: activity.clone(),
                    });
            }
            WorldEvent::TradeStateUpdated(trade) => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::TradeStateUpdated {
                        trade: trade.clone(),
                    });
            }
            WorldEvent::ContainerOpened(guid) => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::ContainerOpened { guid: *guid });
            }
            WorldEvent::ContainerClosed(guid) => {
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::ContainerClosed { guid: *guid });
            }
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::position::WorldPosition;
    use holtburger_common::properties::{PropertyDataId, WorldObjectPropertyAccessorsMut};
    use holtburger_common::{Guid, Quaternion, Vector3};
    use holtburger_dat::file_type::{
        MotionCommandKinematics, MotionKinematics, MotionKinematicsTable, MotionTable,
    };
    use holtburger_protocol::messages::movement::{InterpretedMotionCommand, MotionStance};
    use holtburger_world::FellowshipActivity;
    use holtburger_world::entity::{Entity, EntityMotionSnapshot, OrderedMotionSpeed};
    use holtburger_world::{
        PlayerMotionTableSource, SelfMovementCapabilities, SelfMovementKinematics,
    };

    fn test_self_movement_capabilities(
        run_rate_scalar: f32,
        walk_speed: f32,
        run_speed: f32,
        turn_speed_rad_per_sec: f32,
    ) -> SelfMovementCapabilities {
        SelfMovementCapabilities {
            kinematics: SelfMovementKinematics {
                source: PlayerMotionTableSource::DirectProperty {
                    motion_table_id: 0x0900_0020,
                },
                motion_table_id: 0x0900_0020,
                stance: 0x8000_003D,
                base_walk_forward_velocity: Vector3::new(walk_speed, 0.0, 0.0),
                base_run_forward_velocity: Vector3::new(run_speed, 0.0, 0.0),
                base_turn_left_omega: Vector3::new(0.0, 0.0, -turn_speed_rad_per_sec),
                base_turn_right_omega: Vector3::new(0.0, 0.0, turn_speed_rad_per_sec),
            },
            run_rate_scalar,
        }
    }

    fn seed_test_self_movement_capabilities(
        client: &mut ClientRuntime,
    ) -> SelfMovementCapabilities {
        let capabilities = test_self_movement_capabilities(2.25, 1.0, 2.0, 1.5);
        client
            .world
            .set_self_movement_capabilities_override(capabilities.clone());
        capabilities
    }

    fn test_remote_motion_kinematics_asset(motion_table_id: u32) -> MotionKinematics {
        let mut asset = MotionKinematics::new();
        let mut table = MotionKinematicsTable::new(motion_table_id, MotionStance::NonCombat as u32);

        table.insert_cycle_kinematics(
            MotionStance::NonCombat as u32,
            MotionTable::RUN_FORWARD_COMMAND,
            MotionCommandKinematics {
                velocity: Some(Vector3::new(2.5, 0.0, 0.0)),
                omega: None,
            },
        );
        table.insert_cycle_kinematics(
            MotionStance::NonCombat as u32,
            MotionTable::TURN_RIGHT_COMMAND,
            MotionCommandKinematics {
                velocity: None,
                omega: Some(Vector3::new(0.0, 0.0, 1.25)),
            },
        );

        asset.motion_tables.insert(motion_table_id, table);
        asset
    }

    #[test]
    fn busy_operation_timeout_clears_state_and_emits_completion() {
        let mut client = builder::build_test_client(ClientState::Connected);
        let mut events = client.subscribe_client_view_events();

        assert!(client.arm_busy_operation(BusyOperationKind::Buy));
        client.poll_busy_timeout(Instant::now() + BUSY_OPERATION_TIMEOUT + Duration::from_secs(1));

        assert!(client.active_busy_operation.is_none());

        let mut saw_busy_clear = false;
        let mut saw_timeout = false;
        while let Ok(event) = events.try_recv() {
            match event {
                ClientViewEvent::BusyStateUpdated { busy: None } => saw_busy_clear = true,
                ClientViewEvent::BusyOperationFinished {
                    operation: BusyOperationKind::Buy,
                    result: BusyOperationResult::TimedOut,
                } => saw_timeout = true,
                _ => {}
            }
        }

        assert!(saw_busy_clear);
        assert!(saw_timeout);
    }

    #[test]
    fn arm_busy_operation_rejects_overlap_and_preserves_original_pending_state() {
        let mut client = builder::build_test_client(ClientState::Connected);

        assert!(client.arm_busy_operation(BusyOperationKind::Buy));
        assert!(!client.arm_busy_operation(BusyOperationKind::Sell));

        assert!(matches!(
            client.active_busy_operation,
            Some(PendingBusyOperation {
                operation: BusyOperationKind::Buy,
                ..
            })
        ));
    }

    #[test]
    fn fellowship_activity_is_only_projected_after_entering_world() {
        let client = builder::build_test_client(ClientState::EnteringWorld);
        let mut events = client.subscribe_client_view_events();

        client.handle_world_event(&WorldEvent::FellowshipActivity(
            FellowshipActivity::MemberJoined {
                member_name: "Bravo".to_string(),
            },
        ));

        assert!(events.try_recv().is_err());
    }

    #[test]
    fn fellowship_activity_projects_when_in_world() {
        let client = builder::build_test_client(ClientState::InWorld);
        let mut events = client.subscribe_client_view_events();

        client.handle_world_event(&WorldEvent::FellowshipActivity(
            FellowshipActivity::MemberLeft {
                member_name: "Bravo".to_string(),
            },
        ));

        let mut saw_activity = false;
        while let Ok(event) = events.try_recv() {
            if matches!(
                event,
                ClientViewEvent::FellowshipActivity {
                    activity: FellowshipActivity::MemberLeft { member_name }
                } if member_name == "Bravo"
            ) {
                saw_activity = true;
                break;
            }
        }

        assert!(saw_activity);
    }

    #[test]
    fn inventory_server_save_failed_projection_preserves_item_guid() {
        let client = builder::build_test_client(ClientState::InWorld);
        let mut events = client.subscribe_client_view_events();
        let item_guid = Guid(0x4000_0001);

        client.emit_action_result(
            ActionResultSource::Wire,
            ActionResultReason::InventoryServerSaveFailed {
                item_guid,
                error: holtburger_protocol::errors::WeenieError::YoureTooBusy,
            },
        );

        let mut saw_projected_event = false;
        while let Ok(event) = events.try_recv() {
            if let ClientViewEvent::ActionResult {
                source: ActionResultSource::Wire,
                reason:
                    ActionResultReason::InventoryServerSaveFailed {
                        item_guid: projected_item_guid,
                        error,
                    },
            } = event
            {
                assert_eq!(projected_item_guid, item_guid);
                assert_eq!(
                    error,
                    holtburger_protocol::errors::WeenieError::YoureTooBusy
                );
                saw_projected_event = true;
                break;
            }
        }

        assert!(saw_projected_event);
    }

    #[test]
    fn entity_vector_updates_project_to_client_view_kinematics() {
        let client = builder::build_test_client(ClientState::InWorld);
        let mut events = client.subscribe_client_view_events();
        let guid = Guid(0x5000_0001);
        let velocity = Vector3::new(1.0, 2.0, 3.0);
        let omega = Vector3::new(0.0, 0.0, 4.0);

        client.handle_world_event(&WorldEvent::EntityVectorUpdated {
            guid,
            velocity,
            omega,
        });

        let mut saw_kinematics = false;
        while let Ok(event) = events.try_recv() {
            if matches!(
                event,
                ClientViewEvent::EntityKinematicsUpdated {
                    guid: event_guid,
                    velocity: event_velocity,
                    omega: event_omega,
                } if event_guid == guid && event_velocity == velocity && event_omega == omega
            ) {
                saw_kinematics = true;
                break;
            }
        }

        assert!(saw_kinematics);
    }

    #[test]
    fn player_entity_projection_emits_self_movement_kinematics_update() {
        let mut client = builder::build_test_client(ClientState::InWorld);
        let mut events = client.subscribe_client_view_events();
        let player_guid = Guid(0x5000_0001);
        let capabilities = test_self_movement_capabilities(4.5, 1.0, 2.0, 1.5);
        let expected_kinematics = capabilities.kinematics().clone();

        client.world.player.guid = player_guid;
        client
            .world
            .set_self_movement_capabilities_override(capabilities.clone());

        client.handle_world_event(&WorldEvent::EntitySpawned(Box::new(Entity::new(
            player_guid,
            "Player".to_string(),
            WorldPosition::default(),
        ))));

        let mut saw_kinematics = false;
        while let Ok(event) = events.try_recv() {
            if matches!(
                event,
                ClientViewEvent::SelfMovementKinematicsUpdated {
                    kinematics: Some(event_kinematics)
                } if event_kinematics == expected_kinematics
            ) {
                saw_kinematics = true;
                break;
            }
        }

        assert!(saw_kinematics);
    }

    #[test]
    fn player_entity_projection_emits_empty_self_movement_kinematics_when_resolution_fails() {
        let mut client = builder::build_test_client(ClientState::InWorld);
        let mut events = client.subscribe_client_view_events();
        let player_guid = Guid(0x5000_0001);

        client.world.player.guid = player_guid;

        client.handle_world_event(&WorldEvent::EntitySpawned(Box::new(Entity::new(
            player_guid,
            "Player".to_string(),
            WorldPosition::default(),
        ))));

        let mut saw_kinematics_none = false;
        while let Ok(event) = events.try_recv() {
            if let ClientViewEvent::SelfMovementKinematicsUpdated { kinematics: None } = event {
                saw_kinematics_none = true;
            }
        }

        assert!(saw_kinematics_none);
    }

    #[test]
    fn repeated_self_movement_capability_failures_do_not_emit_client_errors() {
        let mut client = builder::build_test_client(ClientState::InWorld);
        let mut events = client.subscribe_client_view_events();
        let player_guid = Guid(0x5000_0001);

        client.world.player.guid = player_guid;

        let entity = Box::new(Entity::new(
            player_guid,
            "Player".to_string(),
            WorldPosition::default(),
        ));
        client.handle_world_event(&WorldEvent::EntitySpawned(entity.clone()));
        client.handle_world_event(&WorldEvent::EntityReplaced(entity));

        while let Ok(event) = events.try_recv() {
            assert!(!matches!(event, ClientViewEvent::ActionResult { .. }));
        }
    }

    #[test]
    fn sync_server_time_updates_world_state_and_emits_client_view_event() {
        let mut client = builder::build_test_client(ClientState::EnteringWorld);
        let mut events = client.subscribe_client_view_events();
        let synced_at = Instant::now();
        let server_time = 289_184_283.365_664_66;

        client.sync_server_time(server_time, synced_at);

        let sync = client
            .world
            .server_time
            .as_ref()
            .expect("server time should be recorded");
        assert_eq!(sync.server_time, server_time);
        assert_eq!(sync.local_time, synced_at);

        let mut saw_event = false;
        while let Ok(event) = events.try_recv() {
            if matches!(event, ClientViewEvent::ServerTimeUpdated { time } if time == server_time) {
                saw_event = true;
                break;
            }
        }

        assert!(saw_event);
    }

    #[test]
    fn simulation_build_request_returns_none_without_local_intent() {
        let client = builder::build_test_client(ClientState::InWorld);

        let request = client.simulation.build_solve_request(
            Instant::now(),
            Duration::from_millis(PHYSICS_TICK_MS),
            &client.world,
            &client.movement,
        );

        assert!(request.is_none());
    }

    #[test]
    fn simulation_build_request_includes_idle_local_player_runtime_body() {
        let mut client = builder::build_test_client(ClientState::InWorld);
        let guid = Guid(0x0102_0304);
        let player_pose = WorldPosition {
            landblock_id: Guid(0x1000_0001),
            coords: Vector3::zero(),
            rotation: Quaternion::identity(),
        };

        client
            .world
            .seed_local_player_entity(guid, "Player", player_pose);

        let request = client
            .simulation
            .build_solve_request(
                Instant::now(),
                Duration::from_millis(PHYSICS_TICK_MS),
                &client.world,
                &client.movement,
            )
            .expect("idle local player should still be submitted to physics");

        assert_eq!(request.bodies.len(), 1);
        let body = request.bodies[0];
        assert_eq!(
            body.body_id,
            holtburger_world::SpatialBodyId::LocalPlayer(guid)
        );
        assert_eq!(body.pose, player_pose);
        assert!(matches!(
            body.basis,
            Some(holtburger_world::SolveProjectionBasis::Velocity { velocity, omega })
                if velocity == Vector3::zero() && omega == Vector3::zero()
        ));
        assert_eq!(request.local_drive, None);
    }

    #[tokio::test]
    async fn simulation_build_request_carries_active_autonomous_drive() {
        let mut client = builder::build_test_client(ClientState::InWorld);
        let guid = Guid(0x0102_0304);
        let now = Instant::now();
        let player_pose = WorldPosition {
            landblock_id: Guid(0x1000_0001),
            coords: Vector3::zero(),
            rotation: Quaternion::identity(),
        };

        client
            .world
            .seed_local_player_entity(guid, "Player", player_pose);

        client.movement.enqueue_drive_intent(
            movement_types::PlayerDriveIntent::Autonomous(movement_types::AutonomousDriveIntent {
                desired_world_delta: Vector3::new(3.0, 4.0, 0.0),
                desired_heading: Some(1.5),
                target_hint: Some(WorldPosition {
                    landblock_id: Guid(0x1000_0100),
                    coords: Vector3::new(30.0, 40.0, 0.0),
                    rotation: Quaternion::identity(),
                }),
                gait: movement_types::Gait::Run,
                force_grounded: true,
            }),
            now,
        );

        client
            .movement
            .tick(now, &mut client.world, &mut client.session)
            .await
            .expect("movement tick should activate autonomous drive for the current frame");

        let request = client
            .simulation
            .build_solve_request(
                now,
                Duration::from_millis(PHYSICS_TICK_MS),
                &client.world,
                &client.movement,
            )
            .expect(
                "idle local player with active autonomous drive should produce a solve request",
            );

        let local_drive = request
            .local_drive
            .expect("active autonomous drive should be threaded into the solve request");
        assert_eq!(
            local_drive.body_id,
            holtburger_world::SpatialBodyId::LocalPlayer(guid)
        );
        assert_eq!(local_drive.desired_world_delta, Vector3::new(3.0, 4.0, 0.0));
        assert_eq!(local_drive.desired_heading, Some(1.5));
        assert_eq!(
            local_drive.gait,
            holtburger_world::spatial::LocalDriveGait::Run
        );
        assert!(local_drive.force_grounded);
    }

    #[tokio::test]
    async fn simulation_build_request_reads_player_state_after_movement_tick() {
        let mut client = builder::build_test_client(ClientState::InWorld);
        let guid = Guid(0x0102_0304);
        let now = Instant::now();
        let player_pose = WorldPosition {
            landblock_id: Guid(0x1000_0001),
            coords: Vector3::zero(),
            rotation: Quaternion::identity(),
        };

        seed_test_self_movement_capabilities(&mut client);

        client
            .world
            .seed_local_player_entity(guid, "Player", player_pose);

        client.movement.enqueue_drive_intent(
            movement_types::PlayerDriveIntent::ManualHeld(
                movement_types::MotionState::builder()
                    .run()
                    .forward()
                    .build(),
            ),
            now,
        );

        let _ = client
            .movement
            .tick(now, &mut client.world, &mut client.session)
            .await
            .expect("movement tick should succeed");

        let request = client
            .simulation
            .build_solve_request(
                now,
                Duration::from_millis(PHYSICS_TICK_MS),
                &client.world,
                &client.movement,
            )
            .expect("movement-backed local intent should produce a solve request");

        assert_eq!(request.bodies.len(), 1);
        let body = request.bodies[0];
        assert_eq!(
            body.body_id,
            holtburger_world::SpatialBodyId::LocalPlayer(guid)
        );
        assert_eq!(
            body.pose,
            client
                .world
                .local_player_runtime_pose()
                .expect("local player runtime pose should be readable")
        );
        assert!(matches!(
            body.basis,
            Some(holtburger_world::SolveProjectionBasis::Velocity { velocity, omega })
                if velocity.x.abs() < 1e-5
                    && (velocity.y - 4.5).abs() < 1e-5
                    && omega == Vector3::zero()
        ));
    }

    #[tokio::test]
    async fn simulation_build_request_includes_tracked_nearby_actor() {
        let mut client = builder::build_test_client(ClientState::InWorld);
        let player_guid = Guid(0x0102_0304);
        let remote_guid = Guid(0x0102_0305);
        let now = Instant::now();
        let player_pose = WorldPosition {
            landblock_id: Guid(0x1000_0001),
            coords: Vector3::zero(),
            rotation: Quaternion::identity(),
        };

        seed_test_self_movement_capabilities(&mut client);

        client
            .world
            .seed_local_player_entity(player_guid, "Player", player_pose);
        client.world.add_entity(Entity::new(
            remote_guid,
            "Remote".to_string(),
            holtburger_common::position::WorldPosition {
                landblock_id: Guid(0x1000_0001),
                coords: holtburger_common::Vector3::new(8.0, 0.0, 0.0),
                rotation: Quaternion::identity(),
            },
        ));
        let remote = client
            .world
            .entities
            .get_mut(remote_guid)
            .expect("tracked remote entity should exist");
        remote.velocity = holtburger_common::Vector3::new(1.0, 0.0, 0.0);

        client
            .simulation
            .track_body(holtburger_world::SpatialBodyId::Entity(remote_guid));
        client.movement.enqueue_drive_intent(
            movement_types::PlayerDriveIntent::ManualHeld(
                movement_types::MotionState::builder()
                    .run()
                    .forward()
                    .build(),
            ),
            now,
        );

        let _ = client
            .movement
            .tick(now, &mut client.world, &mut client.session)
            .await
            .expect("movement tick should succeed");

        let request = client
            .simulation
            .build_solve_request(
                now,
                Duration::from_millis(PHYSICS_TICK_MS),
                &client.world,
                &client.movement,
            )
            .expect("tracked nearby actor should join the solve set");

        assert_eq!(request.bodies.len(), 2);
        assert!(
            request
                .bodies
                .iter()
                .any(|body| body.body_id
                    == holtburger_world::SpatialBodyId::LocalPlayer(player_guid))
        );
        assert!(
            request
                .bodies
                .iter()
                .any(|body| body.body_id == holtburger_world::SpatialBodyId::Entity(remote_guid))
        );
    }

    #[test]
    fn simulation_build_request_includes_tracked_grounded_actor_without_vector_update() {
        let mut client = builder::build_test_client(ClientState::InWorld);
        let player_guid = Guid(0x0102_1304);
        let remote_guid = Guid(0x0102_1305);
        let motion_table_id = 0x0900_0040;

        client
            .world
            .set_motion_kinematics(test_remote_motion_kinematics_asset(motion_table_id));
        client.world.seed_local_player_entity(
            player_guid,
            "Player",
            WorldPosition {
                landblock_id: Guid(0x1000_0001),
                coords: Vector3::zero(),
                rotation: Quaternion::identity(),
            },
        );

        let mut remote = Entity::new(
            remote_guid,
            "Remote".to_string(),
            WorldPosition {
                landblock_id: Guid(0x1000_0001),
                coords: Vector3::new(8.0, 0.0, 0.0),
                rotation: Quaternion::identity(),
            },
        );
        remote
            .properties
            .set_did_prop(PropertyDataId::MotionTable, Guid(motion_table_id));
        remote.motion_snapshot = Some(EntityMotionSnapshot {
            current_style: Some(MotionStance::NonCombat),
            forward_command: Some(InterpretedMotionCommand::RUN_FORWARD),
            sidestep_command: None,
            turn_command: Some(InterpretedMotionCommand::TURN_RIGHT),
            forward_speed: OrderedMotionSpeed::from_f32(3.5),
            sidestep_speed: None,
            turn_speed: OrderedMotionSpeed::from_f32(0.75),
            directive: None,
        });
        client.world.add_entity(remote);

        client
            .simulation
            .track_body(holtburger_world::SpatialBodyId::Entity(remote_guid));

        let request = client
            .simulation
            .build_solve_request(
                Instant::now(),
                Duration::from_millis(PHYSICS_TICK_MS),
                &client.world,
                &client.movement,
            )
            .expect("tracked grounded remote should join the solve set");

        let remote_body = request
            .bodies
            .iter()
            .find(|body| body.body_id == holtburger_world::SpatialBodyId::Entity(remote_guid))
            .expect("tracked grounded remote should be present");

        assert!(matches!(
            remote_body.basis,
            Some(holtburger_world::SolveProjectionBasis::GroundedMotion {
                desired_local_velocity,
                desired_local_omega,
            }) if desired_local_velocity == Vector3::new(3.5, 0.0, 0.0)
                && desired_local_omega == Vector3::new(0.0, 0.0, 0.75)
        ));
    }

    #[tokio::test]
    async fn simulation_tick_advances_local_player_runtime_body_without_mutating_authoritative_pose()
     {
        let mut client = builder::build_test_client(ClientState::InWorld);
        let guid = Guid(0x0102_0304);
        let now = Instant::now();
        let player_pose = WorldPosition {
            landblock_id: Guid(0x1000_0001),
            coords: Vector3::zero(),
            rotation: Quaternion::identity(),
        };

        seed_test_self_movement_capabilities(&mut client);

        client
            .world
            .seed_local_player_entity(guid, "Player", player_pose);

        client.movement.enqueue_drive_intent(
            movement_types::PlayerDriveIntent::ManualHeld(
                movement_types::MotionState::builder()
                    .run()
                    .forward()
                    .build(),
            ),
            now,
        );

        let _ = client
            .movement
            .tick(now, &mut client.world, &mut client.session)
            .await
            .expect("movement tick should succeed");

        let events = client.simulation.tick(
            now,
            Duration::from_millis(PHYSICS_TICK_MS),
            &mut client.world,
            &mut client.movement,
        );

        let authoritative_pose = client
            .world
            .player_position()
            .expect("local player entity should exist");
        assert_eq!(authoritative_pose.landblock_id, Guid(0x1000_0001));
        assert!(authoritative_pose.coords.y.abs() <= f32::EPSILON);
        let body = client
            .world
            .scene
            .body(holtburger_world::SpatialBodyId::LocalPlayer(guid))
            .expect("local player runtime body should exist after solve");
        assert!(body.pose.coords.y > 0.0);
        assert!(events.iter().any(|event| matches!(
            event,
            WorldEvent::RuntimeBodyChanged {
                body_id: holtburger_world::SpatialBodyId::LocalPlayer(event_guid)
            } if *event_guid == guid
        )));
    }

    #[tokio::test]
    async fn simulation_tick_advances_tracked_actor_alongside_local_player() {
        let mut client = builder::build_test_client(ClientState::InWorld);
        let player_guid = Guid(0x0102_0304);
        let remote_guid = Guid(0x0102_0305);
        let now = Instant::now();
        let player_pose = WorldPosition {
            landblock_id: Guid(0x1000_0001),
            coords: Vector3::zero(),
            rotation: Quaternion::identity(),
        };

        seed_test_self_movement_capabilities(&mut client);

        client
            .world
            .seed_local_player_entity(player_guid, "Player", player_pose);
        client.world.add_entity(Entity::new(
            remote_guid,
            "Remote".to_string(),
            holtburger_common::position::WorldPosition {
                landblock_id: Guid(0x1000_0001),
                coords: holtburger_common::Vector3::new(8.0, 0.0, 0.0),
                rotation: Quaternion::identity(),
            },
        ));
        let remote_start = client
            .world
            .entities
            .get(remote_guid)
            .expect("tracked remote entity should exist before solve")
            .position
            .coords;
        let mut remote = Entity::new(
            remote_guid,
            "Remote".to_string(),
            holtburger_common::position::WorldPosition {
                landblock_id: Guid(0x1000_0001),
                coords: holtburger_common::Vector3::new(8.0, 0.0, 0.0),
                rotation: Quaternion::identity(),
            },
        );
        remote.velocity = holtburger_common::Vector3::new(2.0, 0.0, 0.0);
        client.world.remove_entity(remote_guid);
        client.world.add_entity(remote);

        client
            .simulation
            .track_body(holtburger_world::SpatialBodyId::Entity(remote_guid));
        client.movement.enqueue_drive_intent(
            movement_types::PlayerDriveIntent::ManualHeld(
                movement_types::MotionState::builder()
                    .run()
                    .forward()
                    .build(),
            ),
            now,
        );

        let _ = client
            .movement
            .tick(now, &mut client.world, &mut client.session)
            .await
            .expect("movement tick should succeed");

        let events = client.simulation.tick(
            now,
            Duration::from_millis(PHYSICS_TICK_MS),
            &mut client.world,
            &mut client.movement,
        );

        let remote_after = client
            .world
            .scene
            .body(holtburger_world::SpatialBodyId::Entity(remote_guid))
            .expect("tracked remote body should still exist after solve");
        let player_body = client
            .world
            .scene
            .body(holtburger_world::SpatialBodyId::LocalPlayer(player_guid))
            .expect("local player runtime body should exist after solve");
        assert!(player_body.pose.coords.y > 0.0);
        assert!(remote_after.pose.coords.x > remote_start.x);
        assert!(events.iter().any(|event| matches!(
            event,
            WorldEvent::RuntimeBodyChanged {
                body_id: holtburger_world::SpatialBodyId::LocalPlayer(event_guid)
            } if *event_guid == player_guid
        )));
        assert!(events.iter().any(|event| matches!(
            event,
            WorldEvent::RuntimeBodyChanged {
                body_id: holtburger_world::SpatialBodyId::Entity(event_guid)
            } if *event_guid == remote_guid
        )));
    }

    #[test]
    fn runtime_world_event_tracking_registers_remote_movers() {
        let mut client = builder::build_test_client(ClientState::InWorld);
        let player_guid = Guid(0x0102_0304);
        let remote_guid = Guid(0x0102_0305);

        client.world.seed_local_player_entity(
            player_guid,
            "Player",
            WorldPosition {
                landblock_id: Guid(0x1000_0001),
                coords: Vector3::zero(),
                rotation: Quaternion::identity(),
            },
        );
        client.world.add_entity(Entity::new(
            remote_guid,
            "Remote".to_string(),
            holtburger_common::position::WorldPosition {
                landblock_id: Guid(0x1000_0001),
                coords: holtburger_common::Vector3::new(12.0, 0.0, 0.0),
                rotation: Quaternion::identity(),
            },
        ));

        let runtime_events =
            client
                .world
                .apply_solved_body_kinematics(&holtburger_world::SolvedBodyKinematics {
                    body_id: holtburger_world::SpatialBodyId::Entity(remote_guid),
                    pose: holtburger_common::position::WorldPosition {
                        landblock_id: Guid(0x1000_0001),
                        coords: holtburger_common::Vector3::new(12.5, 0.0, 0.0),
                        rotation: Quaternion::identity(),
                    },
                    velocity: holtburger_common::Vector3::new(1.0, 0.0, 0.0),
                    omega: holtburger_common::Vector3::zero(),
                    contact: holtburger_world::ContactState::Grounded,
                    projection_state: None,
                });
        for event in runtime_events {
            client.observe_runtime_world_event(&event);
        }

        let request = client.simulation.build_solve_request(
            Instant::now(),
            Duration::from_millis(PHYSICS_TICK_MS),
            &client.world,
            &client.movement,
        );

        assert!(request.is_some());
        assert!(
            request
                .expect("tracked remote mover should produce a solve request")
                .bodies
                .iter()
                .any(|body| body.body_id == holtburger_world::SpatialBodyId::Entity(remote_guid))
        );
    }

    #[test]
    fn runtime_world_event_tracking_registers_grounded_projectable_remote() {
        let mut client = builder::build_test_client(ClientState::InWorld);
        let player_guid = Guid(0x0102_2304);
        let remote_guid = Guid(0x0102_2305);
        let motion_table_id = 0x0900_0050;

        client
            .world
            .set_motion_kinematics(test_remote_motion_kinematics_asset(motion_table_id));
        client.world.seed_local_player_entity(
            player_guid,
            "Player",
            WorldPosition {
                landblock_id: Guid(0x1000_0001),
                coords: Vector3::zero(),
                rotation: Quaternion::identity(),
            },
        );

        let mut remote = Entity::new(
            remote_guid,
            "Remote".to_string(),
            WorldPosition {
                landblock_id: Guid(0x1000_0001),
                coords: Vector3::new(12.0, 0.0, 0.0),
                rotation: Quaternion::identity(),
            },
        );
        remote
            .properties
            .set_did_prop(PropertyDataId::MotionTable, Guid(motion_table_id));
        remote.motion_snapshot = Some(EntityMotionSnapshot {
            current_style: Some(MotionStance::NonCombat),
            forward_command: Some(InterpretedMotionCommand::RUN_FORWARD),
            sidestep_command: None,
            turn_command: Some(InterpretedMotionCommand::TURN_RIGHT),
            forward_speed: OrderedMotionSpeed::from_f32(3.5),
            sidestep_speed: None,
            turn_speed: OrderedMotionSpeed::from_f32(0.75),
            directive: None,
        });
        client.world.add_entity(remote.clone());

        client.observe_runtime_world_event(&WorldEvent::EntityReplaced(Box::new(remote)));

        let request = client.simulation.build_solve_request(
            Instant::now(),
            Duration::from_millis(PHYSICS_TICK_MS),
            &client.world,
            &client.movement,
        );

        assert!(request.is_some());
        assert!(
            request
                .expect("tracked grounded remote should produce a solve request")
                .bodies
                .iter()
                .any(|body| body.body_id == holtburger_world::SpatialBodyId::Entity(remote_guid))
        );
    }
}
