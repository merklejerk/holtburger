//! Multi-producer control attribution, pause gate, and unicast read-only runtime access.

use std::collections::BTreeSet;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use anyhow::{Result, anyhow};
use holtburger_common::Guid;
use holtburger_world::WorldState;
use holtburger_world::enchantments::ResolvedEnchantments;
use holtburger_world::state::contracts::ContractsSnapshot;
use serde::{Deserialize, Serialize};
use tokio::sync::{broadcast, mpsc, oneshot};

use crate::ClientCharacterSheet;
use crate::client::ClientRuntime;
use crate::client::allegiance::AllegianceSnapshot;
use crate::client::corpse::{DeathLocationQuery, DeathLocationResult};
use crate::client::housing::HousingSnapshot;
use crate::client::recall::RecallDestination;
use crate::client::steering::LocalSteeringStatus;
use crate::client::trade::TradeSnapshot;
use crate::client::types::{
    ActiveCharacterConfirmation, BusyOperationKind, ClientApplicationSnapshot, ClientCombatStatus,
    ClientCommand, ClientLifecycleState, ClientViewEvent,
};

/// Identifies whether a command originated from direct human interaction or automation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "kebab-case")]
pub enum ControlSource {
    #[default]
    User,
    Automation,
}

/// Immediate synchronous admission result returned by `ClientRuntime` for an enveloped command.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum CommandAdmission {
    #[serde(rename_all = "camelCase")]
    Accepted {
        /// Core-minted correlation ID for commands that emit correlated follow-up events.
        correlation_id: Option<u64>,
    },
    Rejected(CommandRejection),
}

/// Structured reason why `ClientRuntime` refused to admit a command.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "code", rename_all = "kebab-case")]
pub enum CommandRejection {
    AutomationPaused,
    NotInWorld,
    #[serde(rename_all = "camelCase")]
    InvalidLifecycleState {
        expected: String,
    },
    #[serde(rename_all = "camelCase")]
    Busy {
        active: BusyOperationKind,
    },
    #[serde(rename_all = "camelCase")]
    Validation {
        message: String,
    },
    #[serde(rename_all = "camelCase")]
    Failed {
        message: String,
    },
}

/// Enveloped command submitted to `ClientRuntime` with explicit source attribution and optional ack.
pub struct ClientCommandEnvelope {
    pub origin: ControlSource,
    pub command: ClientCommand,
    pub ack: Option<oneshot::Sender<CommandAdmission>>,
}

impl ClientCommandEnvelope {
    pub fn user(command: ClientCommand) -> Self {
        Self {
            origin: ControlSource::User,
            command,
            ack: None,
        }
    }

    pub fn automation(
        command: ClientCommand,
        ack: Option<oneshot::Sender<CommandAdmission>>,
    ) -> Self {
        Self {
            origin: ControlSource::Automation,
            command,
            ack,
        }
    }
}

/// Strictly read-only borrow of `ClientRuntime` exposed inside `ClientRuntimeHandle::read(...)`.
///
/// Lazy accessors avoid cloning unrelated snapshot sections when a caller only needs one slice.
pub struct ClientReadContext<'a> {
    runtime: &'a ClientRuntime,
}

impl<'a> ClientReadContext<'a> {
    pub(in crate::client) fn new(runtime: &'a ClientRuntime) -> Self {
        Self { runtime }
    }

    pub fn world(&self) -> &'a WorldState {
        &self.runtime.world
    }

    /// Snapshot of the resident static collision scene (full physical in h3d, room-shell/terrain in TUI).
    pub fn collision_scene(&self) -> Option<std::sync::Arc<holtburger_world::CollisionScene>> {
        self.runtime
            .collision_coordinator
            .as_ref()
            .map(|coordinator| std::sync::Arc::clone(&coordinator.snapshot().scene))
    }

    /// Whether physical dynamic-entity obstruction (doors/creatures) is currently active for local movement.
    pub fn entity_collision_enabled(&self) -> bool {
        self.runtime
            .collision_coordinator
            .as_ref()
            .is_some_and(|coordinator| coordinator.entity_collision_enabled())
    }

    pub fn lifecycle(&self) -> ClientLifecycleState {
        self.runtime.lifecycle()
    }

    pub fn application_snapshot(&self) -> ClientApplicationSnapshot {
        self.runtime.application_snapshot()
    }

    pub fn world_generation(&self) -> u64 {
        self.runtime.conn.world_generation
    }

    pub fn world_name(&self) -> Option<&'a str> {
        self.runtime.conn.world_name.as_deref()
    }

    pub fn account_name(&self) -> &'a str {
        &self.runtime.character_selection.account_name
    }

    pub fn server_time(&self) -> Option<f64> {
        self.runtime
            .world
            .server_time
            .as_ref()
            .map(|_| self.runtime.world.current_server_time())
    }

    pub fn combat(&self) -> ClientCombatStatus {
        self.runtime.combat_engagement.status()
    }

    pub fn busy(&self) -> Option<BusyOperationKind> {
        self.runtime
            .character
            .active_busy_operation
            .as_ref()
            .map(|op| op.operation.kind())
    }

    pub fn confirmation(&self) -> Option<&'a ActiveCharacterConfirmation> {
        self.runtime.character.active_confirmation.as_ref()
    }

    pub fn trade(&self) -> TradeSnapshot {
        self.runtime.trade_snapshot()
    }

    pub fn allegiance(&self) -> AllegianceSnapshot {
        self.runtime.allegiance_snapshot()
    }

    pub fn housing(&self) -> HousingSnapshot {
        self.runtime.housing_snapshot()
    }

    pub fn contracts(&self) -> Option<ContractsSnapshot> {
        self.runtime.contracts_snapshot()
    }

    pub fn character_sheet(&self) -> Option<ClientCharacterSheet> {
        self.runtime.character_sheet().map(|sheet| *sheet)
    }

    pub fn known_spells(&self) -> Option<Vec<u32>> {
        self.runtime.known_spell_ids()
    }

    pub fn enchantments(&self) -> Option<ResolvedEnchantments> {
        self.runtime
            .character
            .described_character
            .filter(|&guid| guid == self.runtime.world.player.guid)
            .map(|_| {
                self.runtime
                    .world
                    .player
                    .enchantments
                    .resolved(std::time::Instant::now())
            })
    }

    pub fn recall_destinations(&self) -> Vec<RecallDestination> {
        self.runtime.recall_destinations()
    }

    pub fn navigation(&self) -> Option<LocalSteeringStatus> {
        self.runtime.movement.local_steering_status()
    }

    pub fn automation_paused(&self) -> bool {
        self.runtime.is_automation_paused()
    }

    pub fn opened_corpses(&self) -> &'a BTreeSet<Guid> {
        self.runtime.character.opened_corpses.ids()
    }

    pub fn spell_cast_target(&self) -> Option<Guid> {
        self.runtime.active_spell_cast_target()
    }

    /// Evaluates targeted item-use eligibility and estimated lockpick % without mutating state.
    pub fn evaluate_item_use_target(&self, source: Guid, target: Guid) -> (bool, Option<f64>) {
        self.runtime
            .evaluate_item_use_target_readonly(source, target)
    }

    /// Evaluates historical death locations synchronously without sending a command round-trip.
    pub fn query_death_locations(&self, query: DeathLocationQuery) -> DeathLocationResult {
        self.runtime.evaluate_death_locations_readonly(query)
    }

    /// Evaluates a salvage preview synchronously against authoritative world state.
    pub fn preview_salvage(
        &self,
        tool: crate::client::salvage::SalvageToolSelection,
        items: &[Guid],
    ) -> holtburger_world::crafting::salvage::SalvageEvaluation {
        self.runtime.evaluate_salvage_readonly(tool, items)
    }

    /// Evaluates a vendor draft synchronously against authoritative world state.
    pub fn preview_vendor_trade(
        &self,
        request: crate::client::vendor_transaction::VendorTradeRequest,
    ) -> crate::client::vendor_transaction::VendorPreviewResult {
        self.runtime.evaluate_vendor_preview_readonly(request)
    }

    /// Evaluates a spell inspection synchronously against authoritative character facts.
    pub fn inspect_spell(
        &self,
        spell_id: u32,
    ) -> crate::client::spell_inspection::SpellInspectionOutcome {
        self.runtime.evaluate_spell_inspection_readonly(spell_id)
    }
}

pub(in crate::client) type ClientReadTask = Box<dyn FnOnce(&ClientReadContext<'_>) + Send>;

/// Cloneable, thread-safe handle to a running `ClientRuntime`.
///
/// Frontends, live API servers, and scripting engines all share this single ingress/query surface.
#[derive(Clone)]
pub struct ClientRuntimeHandle {
    command_tx: mpsc::UnboundedSender<ClientCommandEnvelope>,
    read_tx: mpsc::UnboundedSender<ClientReadTask>,
    view_tx: broadcast::Sender<ClientViewEvent>,
    automation_paused: Arc<AtomicBool>,
}

impl ClientRuntimeHandle {
    pub(in crate::client) fn new(
        command_tx: mpsc::UnboundedSender<ClientCommandEnvelope>,
        read_tx: mpsc::UnboundedSender<ClientReadTask>,
        view_tx: broadcast::Sender<ClientViewEvent>,
        automation_paused: Arc<AtomicBool>,
    ) -> Self {
        Self {
            command_tx,
            read_tx,
            view_tx,
            automation_paused,
        }
    }

    /// Subscribes to the live `ClientViewEvent` broadcast stream.
    pub fn subscribe(&self) -> broadcast::Receiver<ClientViewEvent> {
        self.view_tx.subscribe()
    }

    /// Submits a human-originated command without waiting for an admission receipt.
    pub fn send_user(&self, command: ClientCommand) -> Result<()> {
        self.command_tx
            .send(ClientCommandEnvelope::user(command))
            .map_err(|_| anyhow!("client runtime is no longer accepting commands"))
    }

    /// Submits an automation-originated command and awaits its synchronous admission result.
    pub fn send_automation(
        &self,
        command: ClientCommand,
    ) -> impl std::future::Future<Output = Result<CommandAdmission>> + Send + 'static {
        let (ack_tx, ack_rx) = oneshot::channel();
        let send_result = self
            .command_tx
            .send(ClientCommandEnvelope::automation(command, Some(ack_tx)))
            .map_err(|_| anyhow!("client runtime is no longer accepting commands"));
        async move {
            send_result?;
            ack_rx
                .await
                .map_err(|_| anyhow!("client runtime dropped command before admission"))
        }
    }

    /// Executes a non-blocking read-only closure directly against authoritative runtime state.
    /// Never broadcasts a global `ApplicationSnapshot` to other subscribers.
    pub fn read<T: Send + 'static>(
        &self,
        f: impl FnOnce(&ClientReadContext<'_>) -> T + Send + 'static,
    ) -> impl std::future::Future<Output = Result<T>> + Send + 'static {
        let (reply_tx, reply_rx) = oneshot::channel();
        let task: ClientReadTask = Box::new(move |ctx| {
            let _ = reply_tx.send(f(ctx));
        });
        let send_result = self
            .read_tx
            .send(task)
            .map_err(|_| anyhow!("client runtime is no longer accepting read queries"));
        async move {
            send_result?;
            reply_rx
                .await
                .map_err(|_| anyhow!("client runtime dropped read query before replying"))
        }
    }

    /// Returns whether automation control commands are currently paused by the user.
    pub fn is_automation_paused(&self) -> bool {
        self.automation_paused.load(Ordering::Acquire)
    }

    /// Pauses or resumes automation control. Pausing immediately cancels active automation
    /// movement and automation-started combat engagements without disturbing user controls.
    pub fn set_automation_paused(&self, paused: bool) -> Result<()> {
        self.send_user(ClientCommand::SetAutomationPaused(paused))?;
        if paused {
            // Immediately block concurrent automation submissions before the runtime drains the queue.
            self.automation_paused.store(true, Ordering::Release);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::client::builder::build_test_client;
    use crate::client::movement_types::{CharacterDrive, Gait, PlayerDriveIntent};
    use crate::client::steering::{
        LocalNavigationOutcome, LocalSteeringGoal, LocalSteeringRequest,
    };
    use crate::client::types::{ClientAttackProfile, ClientState};
    use holtburger_common::position::WorldPosition;
    use holtburger_common::properties::{
        ItemType, PropertyInt, WorldObjectPropertyAccessors, WorldObjectPropertyAccessorsMut,
    };
    use holtburger_common::{Quaternion, Vector3};
    use holtburger_protocol::messages::combat::{AttackHeight, CombatMode};
    use holtburger_world::entity::Entity;

    fn seed_player_and_mob(client: &mut ClientRuntime) -> (Guid, Guid) {
        let player_guid = Guid(0x5000_0001);
        let mob_guid = Guid(0x7000_0002);
        let mut player = Entity::new(
            player_guid,
            "Player".into(),
            WorldPosition {
                landblock_id: Guid(0x0101_0001),
                coords: Vector3::new(10.0, 10.0, 0.0),
                rotation: Quaternion::identity(),
            },
        );
        player.set_int_prop(PropertyInt::ItemType, ItemType::CREATURE.bits() as i32);
        player.set_int_prop(PropertyInt::CombatMode, CombatMode::Melee as i32);
        client.world.player.guid = player_guid;
        client.world.add_entity(player);

        let mut mob = Entity::new(
            mob_guid,
            "Drudge".into(),
            WorldPosition {
                landblock_id: Guid(0x0101_0001),
                coords: Vector3::new(20.0, 10.0, 0.0),
                rotation: Quaternion::identity(),
            },
        );
        mob.set_int_prop(PropertyInt::ItemType, ItemType::CREATURE.bits() as i32);
        mob.set_int_prop(PropertyInt::Level, 42);
        client.world.add_entity(mob);
        (player_guid, mob_guid)
    }

    #[tokio::test]
    async fn automation_pause_blocks_automation_allows_user_and_cancels_active_automation() {
        let mut client = build_test_client(ClientState::InWorld);
        let (_player, mob) = seed_player_and_mob(&mut client);
        let handle = client.create_handle();
        let mut events = handle.subscribe();

        // Start automation combat + steering.
        let (ack_tx, ack_rx) = oneshot::channel();
        client
            .handle_command_envelope(ClientCommandEnvelope::automation(
                ClientCommand::BeginCombatEngagement {
                    intent_sequence: 0,
                    target: mob,
                    profile: ClientAttackProfile::Melee {
                        height: AttackHeight::Medium,
                        power: 0.5,
                    },
                },
                Some(ack_tx),
            ))
            .await
            .unwrap();
        assert!(matches!(
            ack_rx.await.unwrap(),
            CommandAdmission::Accepted { .. }
        ));
        assert!(client.combat_engagement.status().desired.is_some());

        let (nav_tx, nav_rx) = oneshot::channel();
        client
            .handle_command_envelope(ClientCommandEnvelope::automation(
                ClientCommand::StartLocalSteering(LocalSteeringRequest {
                    goal: LocalSteeringGoal::MoveTo {
                        destination: WorldPosition {
                            landblock_id: Guid(0x0101_0001),
                            coords: Vector3::new(30.0, 10.0, 0.0),
                            rotation: Quaternion::identity(),
                        },
                        arrival_distance: 1.0,
                        gait: Gait::Run,
                        final_heading: None,
                    },
                    stuck_timeout_ms: 2_000,
                    max_duration_ms: None,
                }),
                Some(nav_tx),
            ))
            .await
            .unwrap();
        let CommandAdmission::Accepted {
            correlation_id: Some(nav_id),
        } = nav_rx.await.unwrap()
        else {
            panic!("expected correlation id for steering");
        };
        let _ = client
            .movement
            .prepare_tick(std::time::Instant::now(), &mut client.world);
        assert!(client.movement.has_local_steering());

        // Pause automation: cancels active automation combat & steering.
        client
            .handle_command_envelope(ClientCommandEnvelope::user(
                ClientCommand::SetAutomationPaused(true),
            ))
            .await
            .unwrap();
        let _ = client
            .movement
            .prepare_tick(std::time::Instant::now(), &mut client.world);
        assert!(client.is_automation_paused());
        assert!(client.combat_engagement.status().desired.is_none());
        assert!(!client.movement.has_local_steering());
        let completions = client.movement.take_navigation_completions();
        assert_eq!(completions.len(), 1);
        assert_eq!(completions[0].correlation_id, nav_id);
        assert_eq!(completions[0].outcome, LocalNavigationOutcome::Cancelled);

        // Subsequent automation command is rejected cleanly.
        let (rej_tx, rej_rx) = oneshot::channel();
        client
            .handle_command_envelope(ClientCommandEnvelope::automation(
                ClientCommand::Ping,
                Some(rej_tx),
            ))
            .await
            .unwrap();
        assert_eq!(
            rej_rx.await.unwrap(),
            CommandAdmission::Rejected(CommandRejection::AutomationPaused)
        );

        // User command still executes while automation is paused.
        let (user_tx, user_rx) = oneshot::channel();
        client
            .handle_command_envelope(ClientCommandEnvelope {
                origin: ControlSource::User,
                command: ClientCommand::BeginCombatEngagement {
                    intent_sequence: 1,
                    target: mob,
                    profile: ClientAttackProfile::Melee {
                        height: AttackHeight::High,
                        power: 0.75,
                    },
                },
                ack: Some(user_tx),
            })
            .await
            .unwrap();
        assert!(matches!(
            user_rx.await.unwrap(),
            CommandAdmission::Accepted { .. }
        ));
        assert_eq!(
            client.combat_engagement.status().processed_intent_sequence,
            1
        );

        let mut saw_paused_event = false;
        while let Ok(event) = events.try_recv() {
            if matches!(event, ClientViewEvent::AutomationPausedChanged(true)) {
                saw_paused_event = true;
            }
        }
        assert!(saw_paused_event);
    }

    #[tokio::test]
    async fn automation_combat_does_not_collide_with_user_intent_watermark() {
        let mut client = build_test_client(ClientState::InWorld);
        let (_player, mob) = seed_player_and_mob(&mut client);

        // User begins combat with sequence 5.
        client
            .handle_command_envelope(ClientCommandEnvelope::user(
                ClientCommand::BeginCombatEngagement {
                    intent_sequence: 5,
                    target: mob,
                    profile: ClientAttackProfile::Melee {
                        height: AttackHeight::Medium,
                        power: 0.5,
                    },
                },
            ))
            .await
            .unwrap();
        assert_eq!(
            client.combat_engagement.status().processed_intent_sequence,
            5
        );

        // Automation stops with sequence 0 (would be dropped if sharing user's watermark!).
        client
            .handle_command_envelope(ClientCommandEnvelope::automation(
                ClientCommand::StopCombatEngagement { intent_sequence: 0 },
                None,
            ))
            .await
            .unwrap();
        assert!(client.combat_engagement.status().desired.is_none());
        // User's processed_intent_sequence watermark stays intact at 5.
        assert_eq!(
            client.combat_engagement.status().processed_intent_sequence,
            5
        );

        // User's next sequence 6 is still cleanly admitted.
        client
            .handle_command_envelope(ClientCommandEnvelope::user(
                ClientCommand::BeginCombatEngagement {
                    intent_sequence: 6,
                    target: mob,
                    profile: ClientAttackProfile::Melee {
                        height: AttackHeight::Low,
                        power: 1.0,
                    },
                },
            ))
            .await
            .unwrap();
        assert_eq!(
            client.combat_engagement.status().processed_intent_sequence,
            6
        );
        assert!(client.combat_engagement.status().desired.is_some());
    }

    #[tokio::test]
    async fn user_drive_interrupts_automation_local_steering() {
        let mut client = build_test_client(ClientState::InWorld);
        let (_player, _mob) = seed_player_and_mob(&mut client);
        let now = std::time::Instant::now();

        let (ack_tx, ack_rx) = oneshot::channel();
        client
            .handle_command_envelope(ClientCommandEnvelope::automation(
                ClientCommand::StartLocalSteering(LocalSteeringRequest {
                    goal: LocalSteeringGoal::MoveTo {
                        destination: WorldPosition {
                            landblock_id: Guid(0x0101_0001),
                            coords: Vector3::new(40.0, 10.0, 0.0),
                            rotation: Quaternion::identity(),
                        },
                        arrival_distance: 1.0,
                        gait: Gait::Run,
                        final_heading: None,
                    },
                    stuck_timeout_ms: 2_000,
                    max_duration_ms: None,
                }),
                Some(ack_tx),
            ))
            .await
            .unwrap();
        let CommandAdmission::Accepted {
            correlation_id: Some(correlation_id),
        } = ack_rx.await.unwrap()
        else {
            panic!("expected correlation id");
        };
        let _ = client.movement.prepare_tick(now, &mut client.world);
        assert!(client.movement.has_local_steering());

        // User presses forward: must interrupt automation steering immediately.
        client
            .handle_command_envelope(ClientCommandEnvelope::user(ClientCommand::DriveSelf(
                PlayerDriveIntent::ManualHeld(CharacterDrive::builder().run().forward().build()),
            )))
            .await
            .unwrap();
        let _ = client.movement.prepare_tick(now, &mut client.world);
        assert!(!client.movement.has_local_steering());
        assert!(client.movement.has_active_manual_drive());
        let completions = client.movement.take_navigation_completions();
        assert_eq!(completions.len(), 1);
        assert_eq!(completions[0].correlation_id, correlation_id);
        assert_eq!(
            completions[0].outcome,
            LocalNavigationOutcome::InterruptedByUser
        );
    }

    #[tokio::test]
    async fn unicast_read_returns_raw_properties_without_broadcasting_snapshot() {
        let mut client = build_test_client(ClientState::InWorld);
        let (_player, mob) = seed_player_and_mob(&mut client);
        let handle = client.create_handle();
        let mut events = handle.subscribe();

        let read_fut = handle.read(move |ctx| {
            let level = ctx
                .world()
                .entities
                .get(mob)
                .and_then(|entity| entity.get_int_prop(PropertyInt::Level));
            (ctx.lifecycle(), level, ctx.automation_paused())
        });
        client.drain_reads_for_test();
        let (lifecycle, level, paused) = read_fut.await.unwrap();

        assert_eq!(lifecycle, ClientLifecycleState::InWorld);
        assert_eq!(level, Some(42));
        assert!(!paused);
        assert!(
            events.try_recv().is_err(),
            "unicast read must never broadcast ApplicationSnapshot"
        );
    }
}
