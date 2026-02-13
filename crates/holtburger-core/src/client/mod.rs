use crate::session::Session;
use crate::world::{WorldEvent, WorldState, state::ServerTimeSync};
use anyhow::Result;
use holtburger_common::{Guid, ProtocolUnpack, Quaternion};
use holtburger_protocol::crypto::Isaac;
use holtburger_protocol::errors::CharacterError;
use holtburger_protocol::messages::transport::packet_flags;
use holtburger_protocol::messages::*;
use std::time::{Duration, Instant};
use tokio::sync::mpsc;

pub mod types;
mod builder;
use types::*;

/// Maximum distance (in meters) to allow an automated server-controlled teleport.
/// ACE (the server) typically hard-caps instant movement at 50m.
/// Maximum distance we allow the server to "auto-move" us before we suspect a desync/teleport bug
const AUTO_MOVE_DISTANCE_LIMIT: f32 = 500.0;

/// Physics tick interval in milliseconds.
const PHYSICS_TICK_MS: u64 = 30;

pub struct Client {
    pub session: Session,
    pub world: WorldState,
    account_name: String,
    characters: Vec<CharacterEntry>,
    character_id: Option<Guid>,
    character_preference: Option<String>,
    state: ClientState,
    event_tx: Option<mpsc::UnboundedSender<ClientEvent>>,
    command_rx: Option<mpsc::UnboundedReceiver<ClientCommand>>,
    connection_cookie: u64,
    pub message_dump_dir: Option<std::path::PathBuf>,
    message_counter: usize,
    move_target: Option<Guid>,
    last_move_sync: Instant,
    last_move_pos: holtburger_common::position::WorldPosition,
    last_move_pos_time: Instant,
    last_sent_pos_seq: Option<u16>,
}

impl Client {
    pub fn set_event_tx(&mut self, tx: mpsc::UnboundedSender<ClientEvent>) {
        self.event_tx = Some(tx);
    }

    pub fn set_command_rx(&mut self, rx: mpsc::UnboundedReceiver<ClientCommand>) {
        self.command_rx = Some(rx);
    }

    fn send_status_event(&self) {
        if let Some(tx) = &self.event_tx {
            let _ = tx.send(ClientEvent::StatusUpdate {
                state: self.state.clone(),
            });
        }
    }

    async fn handle_command(&mut self, cmd: ClientCommand) -> Result<()> {
        match cmd {
            ClientCommand::Login(password) => {
                log::info!("Attempting login...");
                self.send_login_request(&password).await
            }
            ClientCommand::SelectCharacter(id) => {
                log::info!("Selecting character: 0x{:08X}", id);
                self.select_character(id).await
            }
            ClientCommand::SelectCharacterByIndex(idx) => match &self.state {
                ClientState::CharacterSelection(chars) if (1..=chars.len()).contains(&idx) => {
                    let char_guid = chars[idx - 1].guid;
                    let char_name = &chars[idx - 1].name;
                    log::info!(
                        "Selecting character by index {}: {} (0x{:08X})",
                        idx,
                        char_name,
                        char_guid
                    );
                    self.select_character(char_guid).await
                }
                _ => Ok(()),
            },
            ClientCommand::EnterWorld => {
                if let Some(char_id) = self.character_id {
                    log::info!(
                        "Attempting to enter world with character: 0x{:08X}",
                        char_id
                    );
                    self.select_character(char_id).await
                } else {
                    Ok(())
                }
            }
            ClientCommand::Talk(text) => {
                if matches!(self.state, ClientState::InWorld) {
                    log::info!(">>> You say: \"{}\"", text);
                    return self.send_talk(&text).await;
                }
                Ok(())
            }
            ClientCommand::Tell { target, message } => {
                if matches!(self.state, ClientState::InWorld) {
                    log::info!(">>> You tell {}, \"{}\"", target, message);
                    return self
                        .session
                        .send_message(&GameMessage::GameAction(Box::new(GameActionMessage {
                            sequence: 0,
                            action: GameAction::Tell(Box::new(TellActionData { target, message })),
                        })))
                        .await;
                }
                Ok(())
            }
            ClientCommand::Ping => {
                log::info!(">>> Sending Ping");
                self.session
                    .send_message(&GameMessage::GameAction(Box::new(GameActionMessage {
                        sequence: 0,
                        action: GameAction::PingRequest(Box::new(PingRequestData)),
                    })))
                    .await
            }
            ClientCommand::Identify(guid) => {
                log::info!(">>> Identifying: 0x{:08X}", guid);
                self.session
                    .send_message(&GameMessage::GameAction(Box::new(GameActionMessage {
                        sequence: 0,
                        action: GameAction::IdentifyObject(Box::new(IdentifyObjectData { guid })),
                    })))
                    .await
            }
            ClientCommand::Jump {
                extent,
                velocity: _,
            } => {
                log::info!(">>> Jumping: extent={}", extent);
                let obj_inst = self.world.player.instance_sequence;
                let srv_seq = self.world.player.server_control_sequence;
                let tele_seq = self.world.player.teleport_sequence;
                let force_seq = self.world.player.force_position_sequence;

                self.session
                    .send_message(&GameMessage::GameAction(Box::new(GameActionMessage {
                        sequence: 0, // GameAction sequence is different?

                        action: GameAction::Jump(Box::new(JumpData {
                            extent,
                            velocity: Default::default(),
                            instance_sequence: obj_inst,
                            server_control_sequence: srv_seq,
                            teleport_sequence: tele_seq,
                            force_position_sequence: force_seq,
                            object_guid: self.world.player.guid,
                            spell_id: 0,
                        })),
                    })))
                    .await
            }
            ClientCommand::SetAutonomyLevel(level) => {
                log::info!(">>> Setting Autonomy Level: {}", level);
                self.session
                    .send_message(&GameMessage::AutonomyLevel(Box::new(AutonomyLevelData {
                        level,
                    })))
                    .await
            }
            ClientCommand::Use(guid) => {
                log::info!(">>> Using: 0x{:08X}", guid);
                self.session
                    .send_message(&GameMessage::GameAction(Box::new(GameActionMessage {
                        sequence: 0,
                        action: GameAction::Use(Box::new(UseData { guid })),
                    })))
                    .await
            }
            ClientCommand::UseWithTarget { item, target } => {
                log::info!(">>> Using: 0x{:08X} on 0x{:08X}", item, target);
                self.session
                    .send_message(&GameMessage::GameAction(Box::new(GameActionMessage {
                        sequence: 0,
                        action: GameAction::UseWithTarget(Box::new(UseWithTargetData {
                            item_guid: item,
                            target_guid: target,
                        })),
                    })))
                    .await
            }
            ClientCommand::Drop(guid) => {
                log::info!(">>> Dropping: 0x{:08X}", guid);
                self.session
                    .send_message(&GameMessage::GameAction(Box::new(GameActionMessage {
                        sequence: 0,
                        action: GameAction::DropItem(Box::new(DropItemData { item_guid: guid })),
                    })))
                    .await
            }
            ClientCommand::Get(guid) => {
                log::info!(">>> Getting: 0x{:08X}", guid);
                self.session
                    .send_message(&GameMessage::GameAction(Box::new(GameActionMessage {
                        sequence: 0,
                        action: GameAction::PutItemInContainer(Box::new(PutItemInContainerData {
                            item_guid: guid,
                            container_guid: self.world.player.guid,
                            placement: 0,
                        })),
                    })))
                    .await
            }
            ClientCommand::MoveItem {
                item,
                container,
                placement,
            } => {
                log::info!(
                    ">>> Moving item 0x{:08X} to container 0x{:08X} (slot {})",
                    item,
                    container,
                    placement
                );
                self.session
                    .send_message(&GameMessage::GameAction(Box::new(GameActionMessage {
                        sequence: 0,
                        action: GameAction::PutItemInContainer(Box::new(PutItemInContainerData {
                            item_guid: item,
                            container_guid: container,
                            placement,
                        })),
                    })))
                    .await
            }
            ClientCommand::GetAndWield { item, equip_mask } => {
                log::info!(
                    ">>> Getting and wielding item 0x{:08X} (mask 0x{:08X})",
                    item,
                    equip_mask
                );
                let sequence = 0; // TODO
                self.session
                    .send_message(&GameMessage::GameAction(Box::new(GameActionMessage {
                        sequence,

                        action: GameAction::GetAndWieldItem(Box::new(GetAndWieldItemData {
                            item_guid: item,
                            equip_mask: EquipMask::from_bits_truncate(equip_mask),
                        })),
                    })))
                    .await
            }
            ClientCommand::SplitToWield {
                item,
                equip_mask,
                amount,
            } => {
                log::info!(
                    ">>> Splitting 0x{:08X} ({}x) to wield in (mask 0x{:08X})",
                    item,
                    amount,
                    equip_mask
                );
                let sequence = 0; // TODO
                self.session
                    .send_message(&GameMessage::GameAction(Box::new(GameActionMessage {
                        sequence,

                        action: GameAction::StackableSplitToWield(Box::new(
                            StackableSplitToWieldData {
                                stack_guid: item,
                                amount: amount as i32,
                                equip_mask: EquipMask::from_bits_truncate(equip_mask),
                            },
                        )),
                    })))
                    .await
            }
            ClientCommand::SetState(state_opcode) => {
                log::info!(">>> Setting state: 0x{:08X}", state_opcode);
                let obj_inst = self.world.player.instance_sequence;
                let srv_seq = self.world.player.server_control_sequence;
                let tele_seq = self.world.player.teleport_sequence;
                let force_seq = self.world.player.force_position_sequence;

                self.session
                    .send_message(&GameMessage::GameAction(Box::new(GameActionMessage {
                        sequence: 0,

                        action: GameAction::MoveToState(Box::new(MoveToStateData {
                            raw_motion_state: RawMotionState {
                                flags: RawMotionFlags::CURRENT_STYLE,
                                current_style: Some(state_opcode),
                                ..Default::default()
                            },
                            position: self.world.player.position,
                            instance_sequence: obj_inst,
                            server_control_sequence: srv_seq,
                            teleport_sequence: tele_seq,
                            force_position_sequence: force_seq,
                            contact_long_jump: 0,
                        })),
                    })))
                    .await
            }
            ClientCommand::TurnTo { heading } => {
                log::info!(">>> Turning to heading: {}", heading);

                // Prediction: update local state immediately so UI feels snappy
                self.world.player.position.rotation = Quaternion::from_heading(heading);

                let obj_inst = self.world.player.instance_sequence;
                let srv_seq = self.world.player.server_control_sequence;
                let tele_seq = self.world.player.teleport_sequence;
                let force_seq = self.world.player.force_position_sequence;

                self.session
                    .send_message(&GameMessage::GameAction(Box::new(GameActionMessage {
                        sequence: 0,
                        action: GameAction::MoveToState(Box::new(MoveToStateData {
                            raw_motion_state: RawMotionState::default(),
                            position: self.world.player.position,
                            instance_sequence: obj_inst,
                            server_control_sequence: srv_seq,
                            teleport_sequence: tele_seq,
                            force_position_sequence: force_seq,
                            contact_long_jump: 1, // Assume contact
                        })),
                    })))
                    .await
            }
            ClientCommand::MoveTo { target } => {
                log::info!(">>> Starting approach to target: 0x{:08X}", target);
                self.move_target = Some(target);
                self.last_move_pos = self.world.player.position;
                self.last_move_pos_time = Instant::now();
                Ok(())
            }
            ClientCommand::SyncPosition => {
                log::debug!(">>> Syncing Position (Heartbeat)");
                let pulse = AutonomousPositionActionData {
                    position: self.world.player.position,
                    instance_sequence: self.world.player.instance_sequence,
                    server_control_sequence: self.world.player.server_control_sequence,
                    teleport_sequence: self.world.player.teleport_sequence,
                    force_position_sequence: self.world.player.force_position_sequence,
                    last_contact: 1,
                };

                self.session
                    .send_action(GameAction::AutonomousPosition(Box::new(pulse)))
                    .await
            }
            ClientCommand::RaiseAttribute {
                attribute,
                xp_spent,
            } => {
                log::info!(">>> Raising Attribute: {:?} (XP: {})", attribute, xp_spent);
                self.session
                    .send_action(GameAction::RaiseAttribute(Box::new(RaiseAttributeData {
                        attribute_type: attribute as u32,
                        xp_spent,
                    })))
                    .await
            }
            ClientCommand::RaiseVital { vital, xp_spent } => {
                log::info!(">>> Raising Vital: {:?} (XP: {})", vital, xp_spent);
                self.session
                    .send_action(GameAction::RaiseVital(Box::new(RaiseVitalData {
                        vital_type: vital as u32,
                        xp_spent,
                    })))
                    .await
            }
            ClientCommand::RaiseSkill { skill, xp_spent } => {
                log::info!(">>> Raising Skill: {:?} (XP: {})", skill, xp_spent);
                self.session
                    .send_action(GameAction::RaiseSkill(Box::new(RaiseSkillData {
                        skill_type: skill as u32,
                        xp_spent,
                    })))
                    .await
            }
            ClientCommand::TrainSkill { skill, credits } => {
                log::info!(">>> Training Skill: {:?} (Credits: {})", skill, credits);
                self.session
                    .send_action(GameAction::TrainSkill(Box::new(TrainSkillData {
                        skill_type: skill as u32,
                        credits_spent: credits as i32,
                    })))
                    .await
            }
            ClientCommand::GiveObjectRequest {
                target,
                item,
                amount,
            } => {
                log::info!(
                    ">>> Giving item 0x{:08X} to target 0x{:08X} (amount {})",
                    item,
                    target,
                    amount
                );
                self.session
                    .send_action(GameAction::GiveObjectRequest(Box::new(
                        GiveObjectRequestData {
                            target_guid: target,
                            item_guid: item,
                            amount,
                        },
                    )))
                    .await
            }
            ClientCommand::Quit => {
                log::info!("Disconnecting...");
                // First attempt a graceful logout from the world
                if matches!(self.state, ClientState::InWorld) {
                    let _ = self
                        .session
                        .send_message(&GameMessage::CharacterLogOff)
                        .await;
                    // Small delay to allow logout to process? Or just proceed to session disconnect.
                    // AC usually waits for the Server's response, but here we can just fire and move on.
                }
                self.disconnect().await?;
                Ok(())
            }
        }
    }

    pub async fn disconnect(&mut self) -> Result<()> {
        let header = PacketHeader {
            flags: packet_flags::DISCONNECT,
            sequence: self.session.packet_sequence,
            id: 0,
            ..Default::default()
        };
        self.session.packet_sequence += 1;
        self.session
            .send_packet_to_addr(header, &[], self.session.server_addr)
            .await?;

        self.state = ClientState::Disconnected;
        self.send_status_event();

        Ok(())
    }

    pub async fn run(&mut self) -> Result<()> {
        // Initial handshake: If this is an activation/logon session, the bin should send ClientCommand::Login
        self.send_status_event();

        let mut physics_tick = tokio::time::interval(Duration::from_millis(PHYSICS_TICK_MS));
        let mut last_physics_time = Instant::now();

        loop {
            if matches!(self.state, ClientState::Disconnected) {
                break;
            }

            tokio::select! {
                res = self.session.recv_message() => {
                    use crate::session::SessionEvent;
                    match res {
                        Ok(events) => {
                            for event in events {
                                match event {
                                    SessionEvent::Message(msg_data) => {
                                        let world_events = self.handle_message(&msg_data).await?;

                                        for event in world_events {
                                            if let WorldEvent::ForcedReposition { .. } = event
                                                && self.move_target.is_some() {
                                                    log::warn!("Approach aborted: Forced reposition by server");
                                                    self.move_target = None;
                                                    if let Some(player) = self.world.entities.get_mut(self.world.player.guid) {
                                                        player.velocity = holtburger_common::Vector3::zero();
                                                    }
                                                }
                                        }

                                        if matches!(self.state, ClientState::Disconnected) {
                                            return Ok(());
                                        }
                                    }
                                    SessionEvent::HandshakeRequest(crd) => {
                                        self.handle_handshake_request(crd).await?;
                                    }
                                    SessionEvent::HandshakeResponse { cookie, client_id } => {
                                        self.handle_handshake_response(cookie, client_id).await?;
                                    }
                                    SessionEvent::TimeSync(server_time) => {
                                        self.world.server_time = Some(ServerTimeSync {
                                            server_time,
                                            local_time: Instant::now(),
                                        });
                                        if let Some(tx) = &self.event_tx {
                                            let _ = tx.send(ClientEvent::World(Box::new(WorldEvent::ServerTimeUpdate(server_time))));
                                        }
                                    }
                                }
                            }
                        }
                        Err(e) => {
                            log::error!("Session error: {}", e);
                            self.state = ClientState::Disconnected;
                            self.send_status_event();
                            return Err(e);
                        }
                    }
                }
                Some(cmd) = async {
                    if let Some(rx) = &mut self.command_rx {
                        rx.recv().await
                    } else {
                        None
                    }
                } => {
                    self.handle_command(cmd).await?;
                }
                _ = physics_tick.tick() => {
                    let now = Instant::now();
                    let dt = now.duration_since(last_physics_time).as_secs_f32();
                    last_physics_time = now;

                    if let Some(target_guid) = self.move_target {
                        self.handle_approach_task(target_guid, dt).await?;
                    }

                    // TODO: Use actual player radius from DAT/Properties
                    let physics_events = self.world.tick(dt, 0.35);
                    for event in physics_events {
                        if let Some(tx) = &self.event_tx {
                            let _ = tx.send(ClientEvent::World(Box::new(event)));
                        }
                    }
                }
            }
        }

        Ok(())
    }

    async fn handle_message(&mut self, data: &[u8]) -> Result<Vec<WorldEvent>> {
        if let Some(tx) = &self.event_tx {
            let _ = tx.send(ClientEvent::RawMessage(data.to_vec()));
        }

        if let Some(ref dump_dir) = self.message_dump_dir {
            let path = dump_dir.join(format!("{:05}.bin", self.message_counter));
            std::fs::write(path, data)?;
            self.message_counter += 1;
        }

        let mut offset = 0;
        let message = <GameMessage as ProtocolUnpack>::unpack(data, &mut offset);
        if message.is_none() {
            let opcode_str = if data.len() >= 4 {
                let opcode = u32::from_le_bytes(data[0..4].try_into().unwrap_or([0; 4]));
                format!("0x{:08X}", opcode)
            } else {
                "Unknown".to_string()
            };
            log::warn!(
                "Failed to unpack GameMessage {} ({} bytes): {:02X?}",
                opcode_str,
                data.len(),
                data
            );
            return Ok(Vec::new());
        }
        let message = message.unwrap();

        log::debug!("GameMessage: {:?}", message);

        if let Some(tx) = &self.event_tx {
            let _ = tx.send(ClientEvent::GameMessage(Box::new(message.clone())));
        }

        // Pass to world state for tracking positioning and spawning
        let world_events = self.world.handle_message(&message);
        for event in world_events.iter() {
            if let Some(tx) = &self.event_tx {
                let _ = tx.send(ClientEvent::World(Box::new(event.clone())));
            }
        }

        match message {
            GameMessage::UpdatePosition(data) => {
                if data.guid == self.world.player.guid {
                    let force_pos_seq = data.pos.force_position_sequence;

                    if let Some(old_seq) = self.last_sent_pos_seq
                        && force_pos_seq > old_seq
                    {
                        log::warn!(
                            "Server forced reposition (rubber band): seq {} -> {}",
                            old_seq,
                            force_pos_seq
                        );
                        // We don't abort movement here, we just accept the new sequence
                        // WorldState already updated the position via delegation above
                    }
                    self.last_sent_pos_seq = Some(force_pos_seq);
                }
                Ok(())
            }
            GameMessage::UpdateMotion(data) => {
                if data.guid == self.world.player.guid && !data.is_autonomous {
                    self.handle_server_controlled_movement(*data).await?;
                }
                Ok(())
            }
            GameMessage::AutonomousPosition(data) => {
                if data.guid == self.world.player.guid {
                    log::info!(
                        ">>> Server-forced resync: {:?}. Force Seq: {}",
                        data.position,
                        data.force_position_sequence
                    );
                    self.world.player.position = data.position;
                    self.world.player.instance_sequence = data.instance_sequence;
                    self.world.player.server_control_sequence = data.server_control_sequence;
                    self.world.player.teleport_sequence = data.teleport_sequence;
                    self.world.player.force_position_sequence = data.force_position_sequence;
                    self.last_sent_pos_seq = Some(data.force_position_sequence);

                    if let Some(tx) = &self.event_tx {
                        let _ = tx.send(ClientEvent::World(Box::new(WorldEvent::EntityMoved {
                            guid: self.world.player.guid,
                            pos: data.position,
                        })));
                    }
                }
                Ok(())
            }
            GameMessage::CharacterList(data) => self.handle_character_list(*data).await,
            GameMessage::CharacterEnterWorldServerReady => {
                if let Some(char_id) = self.character_id {
                    self.send_character_enter_world(char_id).await
                } else {
                    Ok(())
                }
            }
            GameMessage::GameEvent(ev) => match &ev.event {
                GameEvent::PlayerDescription(_) | GameEvent::StartGame => {
                    if self.state == ClientState::EnteringWorld {
                        self.state = ClientState::InWorld;
                        self.send_status_event();
                    }
                    Ok(())
                }
                GameEvent::PingResponse(_) => {
                    if let Some(tx) = &self.event_tx {
                        let _ = tx.send(ClientEvent::PingResponse);
                    }
                    Ok(())
                }
                GameEvent::ViewContents(data) => {
                    if let Some(tx) = &self.event_tx {
                        let _ = tx.send(ClientEvent::ViewContents {
                            container: data.container,
                            items: data.items.clone(),
                        });
                    }
                    Ok(())
                }
                GameEvent::Tell(data) => {
                    if let Some(tx) = &self.event_tx {
                        let _ = tx.send(ClientEvent::Chat {
                            sender: data.sender_name.clone(),
                            message: data.message.clone(),
                        });
                    }
                    Ok(())
                }
                GameEvent::ChannelBroadcast(data) => {
                    if let Some(tx) = &self.event_tx {
                        let _ = tx.send(ClientEvent::Chat {
                            sender: data.sender_name.clone(),
                            message: data.message.clone(),
                        });
                    }
                    Ok(())
                }
                GameEvent::WeenieError(data) => {
                    if let Some(tx) = &self.event_tx {
                        let _ = tx.send(ClientEvent::WeenieError {
                            error_id: data.error_id,
                            message: None,
                        });
                    }
                    Ok(())
                }
                GameEvent::WeenieErrorWithString(data) => {
                    if let Some(tx) = &self.event_tx {
                        let _ = tx.send(ClientEvent::WeenieError {
                            error_id: data.error_id,
                            message: Some(data.message.clone()),
                        });
                    }
                    Ok(())
                }
                GameEvent::InventoryServerSaveFailed(data) => {
                    if let Some(tx) = &self.event_tx {
                        let _ = tx.send(ClientEvent::InventoryServerSaveFailed {
                            item_guid: data.item_guid,
                            error: data.error,
                        });
                    }
                    Ok(())
                }
                _ => Ok(()),
            },
            GameMessage::PlayerCreate(data) => {
                let player_id = data.guid;
                self.world.player.guid = player_id;

                let name = self
                    .characters
                    .iter()
                    .find(|c| c.guid == player_id)
                    .map(|c| c.name.clone())
                    .unwrap_or_else(|| {
                        // try search by character_id if we have it
                        if let Some(char_id) = self.character_id {
                            self.characters
                                .iter()
                                .find(|c| c.guid == char_id)
                                .map(|c| c.name.clone())
                                .unwrap_or_else(|| "Unknown".to_string())
                        } else {
                            "Unknown".to_string()
                        }
                    });

                if let Some(tx) = &self.event_tx {
                    let _ = tx.send(ClientEvent::PlayerEntered {
                        guid: player_id,
                        name: name.clone(),
                    });
                }

                self.send_login_complete().await?;
                self.state = ClientState::InWorld;
                self.send_status_event();
                Ok(())
            }
            GameMessage::PlayerTeleport(data) => {
                log::info!(
                    "Portal transition started (seq: {})",
                    data.teleport_sequence
                );
                self.send_login_complete().await?;
                Ok(())
            }
            GameMessage::PrivateUpdatePropertyInt(_) | GameMessage::PublicUpdatePropertyInt(_) => {
                Ok(())
            }
            GameMessage::GameAction(data) => self.handle_game_action(&data.action).await,
            GameMessage::ServerMessage(data) => {
                if let Some(tx) = &self.event_tx {
                    let _ = tx.send(ClientEvent::ServerMessage(data.message.clone()));
                }
                Ok(())
            }
            GameMessage::CharacterError(data) => self.handle_character_error(data.error_id),
            GameMessage::BootAccount(data) => self.handle_boot_account(*data),
            GameMessage::DddInterrogation => {
                let resp =
                    GameMessage::DddInterrogationResponse(Box::new(DddInterrogationResponseData {
                        language: 1,
                        lists: Vec::new(),
                    }));
                self.session.send_message(&resp).await
            }
            GameMessage::ServerName(_data) => Ok(()),
            GameMessage::HearSpeech(data) => {
                if let Some(tx) = &self.event_tx {
                    let sender = if data.sender_name.is_empty() {
                        "You".to_string()
                    } else {
                        data.sender_name.clone()
                    };
                    let _ = tx.send(ClientEvent::Chat {
                        sender,
                        message: data.message.clone(),
                    });
                }
                Ok(())
            }
            GameMessage::HearRangedSpeech(data) => {
                if let Some(tx) = &self.event_tx {
                    let _ = tx.send(ClientEvent::Chat {
                        sender: data.sender_name.clone(),
                        message: data.message.clone(),
                    });
                }
                Ok(())
            }
            GameMessage::EmoteText(data) => {
                if let Some(tx) = &self.event_tx {
                    let _ = tx.send(ClientEvent::Emote {
                        sender: data.sender_name.clone(),
                        text: data.text.clone(),
                    });
                }
                Ok(())
            }
            GameMessage::SoulEmote(data) => {
                if let Some(tx) = &self.event_tx {
                    let _ = tx.send(ClientEvent::Emote {
                        sender: data.sender_name.clone(),
                        text: data.text.clone(),
                    });
                }
                Ok(())
            }
            _ => Ok(()),
        }?;

        Ok(world_events)
    }

    async fn handle_character_list(&mut self, data: CharacterListData) -> Result<()> {
        self.characters = data.characters.clone();

        log::info!("Character List for account: {}", data.account_name);
        for (i, c) in self.characters.iter().enumerate() {
            log::info!("  [{}] {} (0x{:08X})", i + 1, c.name, c.guid);
        }

        if let Some(pref) = &self.character_preference {
            if let Ok(idx) = pref.parse::<usize>()
                && idx > 0
                && idx <= self.characters.len()
            {
                let id = self.characters[idx - 1].guid;
                return self.select_character(id).await;
            }
            if let Some(c) = self
                .characters
                .iter()
                .find(|c| c.name.to_lowercase() == pref.to_lowercase())
            {
                let id = c.guid;
                return self.select_character(id).await;
            }
        }
        self.state = ClientState::CharacterSelection(self.characters.clone());
        self.send_status_event();
        if let Some(tx) = &self.event_tx {
            let _ = tx.send(ClientEvent::CharacterList(self.characters.clone()));
        }
        Ok(())
    }

    async fn handle_game_action(&mut self, data: &GameAction) -> Result<()> {
        if let GameAction::LoginComplete(_) = data {
            self.state = ClientState::InWorld;
            self.send_status_event();
        }
        Ok(())
    }

    fn handle_character_error(&mut self, error_code: u32) -> Result<()> {
        if let Some(tx) = &self.event_tx {
            let error = CharacterError::from_repr(error_code).unwrap_or(CharacterError::None);
            let _ = tx.send(ClientEvent::CharacterError(error));
        }
        log::warn!("Character Error received: 0x{:08X}", error_code);
        Ok(())
    }

    fn handle_boot_account(&mut self, data: BootAccountData) -> Result<()> {
        let reason = data.reason.unwrap_or_default();
        self.state = ClientState::Disconnected;
        self.send_status_event();

        if let Some(tx) = &self.event_tx {
            let _ = tx.send(ClientEvent::BootAccount(reason.clone()));
        }
        log::warn!("Boot Account received: {}", reason);
        Ok(())
    }

    async fn select_character(&mut self, char_id: Guid) -> Result<()> {
        self.character_id = Some(char_id);
        self.state = ClientState::EnteringWorld;
        self.send_status_event();
        // Wait up to 1s for the server seq to advance (helps ensure our ACK reflects the latest server packet)
        let prev_seq = self.session.last_server_seq;
        let mut waited = 0u64;
        while self.session.last_server_seq <= prev_seq && waited < 1000 {
            tokio::time::sleep(Duration::from_millis(50)).await;
            waited += 50;
        }

        let msg =
            GameMessage::CharacterEnterWorldRequest(Box::new(CharacterEnterWorldRequestData {
                guid: char_id,
            }));
        self.session.send_message(&msg).await?;
        Ok(())
    }

    async fn send_character_enter_world(&mut self, char_id: Guid) -> Result<()> {
        let msg = GameMessage::CharacterEnterWorld(Box::new(CharacterEnterWorldData {
            guid: char_id,
            account: self.account_name.clone(),
        }));
        self.session.send_message(&msg).await?;
        Ok(())
    }

    async fn send_login_complete(&mut self) -> Result<()> {
        let msg = GameMessage::GameAction(Box::new(GameActionMessage {
            sequence: 0,
            action: GameAction::LoginComplete(Box::new(LoginCompleteData)),
        }));
        self.session.send_message(&msg).await?;
        Ok(())
    }

    async fn send_talk(&mut self, text: &str) -> Result<()> {
        let msg = GameMessage::GameAction(Box::new(GameActionMessage {
            sequence: 0,
            action: GameAction::Talk(Box::new(TalkData {
                message: text.to_string(),
            })),
        }));
        self.session.send_message(&msg).await?;
        Ok(())
    }

    async fn send_login_request(&mut self, password: &str) -> Result<()> {
        log::debug!(
            ">>> Sending Login Request for account {}",
            self.account_name
        );
        let header = PacketHeader {
            flags: packet_flags::LOGIN_REQUEST,
            sequence: self.session.packet_sequence,
            ..Default::default()
        };
        let payload = build_login_payload(
            &self.account_name,
            password,
            self.session.packet_sequence,
            "1802",
        );
        self.session.packet_sequence += 1;
        self.session.send_packet(header, &payload).await?;
        Ok(())
    }

    async fn handle_handshake_request(&mut self, crd: ConnectRequestData) -> Result<()> {
        log::debug!("<<< Handshake Request (Incoming): {:?}", crd);
        self.connection_cookie = crd.cookie;
        self.session.client_id = crd.client_id;
        self.session.isaac_c2s = Some(Isaac::new(crd.client_seed));
        self.session.isaac_s2c = Some(Isaac::new(crd.server_seed));

        let resp_header = PacketHeader {
            flags: packet_flags::CONNECT_RESPONSE,
            sequence: 1,
            id: 0,
            size: 8,
            ..Default::default()
        };
        self.session.packet_sequence = 2;

        let mut payload = Vec::new();
        payload.extend_from_slice(&self.connection_cookie.to_le_bytes());

        // Respond on port + 1
        let mut activation_addr = self.session.server_addr;
        activation_addr.set_port(self.session.server_addr.port() + 1);

        tokio::time::sleep(Duration::from_millis(
            holtburger_protocol::messages::transport::ACE_HANDSHAKE_RACE_DELAY_MS,
        ))
        .await;
        log::debug!(">>> Sending Handshake Response to {}", activation_addr);
        self.session
            .send_packet_to_addr(resp_header, &payload, activation_addr)
            .await?;
        Ok(())
    }

    async fn handle_handshake_response(&mut self, cookie: u64, client_id: u16) -> Result<()> {
        log::debug!(
            "<<< Handshake Response: Cookie={:016X} NetID={:04X}",
            cookie,
            client_id
        );
        self.connection_cookie = cookie;
        self.session.client_id = client_id;

        Ok(())
    }

    async fn handle_approach_task(&mut self, target_guid: Guid, _dt: f32) -> Result<()> {
        let player_pos = self.world.player.position.coords;
        let target_pos = if let Some(target) = self.world.entities.get(target_guid) {
            target.position.coords
        } else {
            log::warn!("Approach aborted: Target 0x{:08X} not found", target_guid);
            self.move_target = None;
            return Ok(());
        };

        let diff = target_pos - player_pos;
        let dist = diff.length();

        if dist < 1.0 {
            log::info!("Arrived at target 0x{:08X}", target_guid);
            self.move_target = None;
            if let Some(player) = self.world.entities.get_mut(self.world.player.guid) {
                player.velocity = holtburger_common::Vector3::zero();
            }
            return Ok(());
        }

        // Stuck detection
        let now = Instant::now();
        if now.duration_since(self.last_move_pos_time) > Duration::from_millis(500) {
            let dist_since_last =
                (self.world.player.position.coords - self.last_move_pos.coords).length();
            if dist_since_last < 0.1 {
                log::warn!("Approach aborted: Player seems stuck");
                self.move_target = None;
                if let Some(player) = self.world.entities.get_mut(self.world.player.guid) {
                    player.velocity = holtburger_common::Vector3::zero();
                }
                return Ok(());
            }
            self.last_move_pos = self.world.player.position;
            self.last_move_pos_time = now;
        }

        // Set velocity toward target (Running speed ~ 7.0m/s)
        let dir = diff / dist;
        let velocity = dir * 7.0;

        if let Some(player) = self.world.entities.get_mut(self.world.player.guid) {
            player.velocity = velocity;
        }

        // Send MoveToState to server periodically (~100ms)
        if now.duration_since(self.last_move_sync) > Duration::from_millis(100) {
            self.last_move_sync = now;

            let data = holtburger_protocol::messages::game_action::MoveToStateData {
                raw_motion_state: holtburger_protocol::messages::game_message::RawMotionState {
                    flags: RawMotionFlags::CURRENT_HOLD_KEY | RawMotionFlags::FORWARD_SPEED,
                    current_hold_key: Some(HoldKey::Run as u32),
                    forward_speed: Some(7.0),
                    ..Default::default()
                },
                position: self.world.player.position,
                instance_sequence: self.world.player.instance_sequence,
                server_control_sequence: self.world.player.server_control_sequence,
                teleport_sequence: self.world.player.teleport_sequence,
                force_position_sequence: self.world.player.force_position_sequence,
                contact_long_jump: 1, // On Ground
            };

            self.session
                .send_action(GameAction::MoveToState(Box::new(data)))
                .await?;
        }

        Ok(())
    }

    async fn handle_server_controlled_movement(&mut self, data: MovementEventData) -> Result<()> {
        log::info!(
            ">>> Processing server-initiated movement: {:?}. Control Sequence: {}",
            data.movement_type,
            data.server_control_sequence
        );

        let mut next_pos = self.world.player.position;

        match &data.data {
            MovementTypeData::MoveToObject(mto) => {
                // We use the origin provided in the packet as the source of truth for the target's position.
                // This is more reliable than our local entity tracking which might be uninitialized (e.g. landblock 0).
                next_pos.landblock_id = mto.origin.cell_id;
                next_pos.coords = mto.origin.position;

                let arrival_dist = mto.params.distance_to_object;

                // Calculate arrival on the line between the player and the target
                if self.world.player.position.landblock_id >> 16 == next_pos.landblock_id >> 16 {
                    let to_player = self.world.player.position.coords - next_pos.coords;
                    if to_player.length_squared() > 1e-6 {
                        next_pos.coords = next_pos.coords + (to_player.normalize() * arrival_dist);

                        // If desired_heading is 0.0, face the target
                        if mto.params.desired_heading.abs() <= 1e-6 {
                            // atan2(-dx, dy) returns math radians (0=North, pi/2=West, pi=South, 3pi/2=East)
                            let math_rad = f32::atan2(-to_player.x, to_player.y);
                            let mut heading_deg = 450.0 - math_rad.to_degrees();
                            heading_deg %= 360.0;
                            if heading_deg < 0.0 {
                                heading_deg += 360.0;
                            }
                            next_pos.rotation = Quaternion::from_heading(heading_deg.to_radians());
                        } else {
                            next_pos.rotation =
                                Quaternion::from_heading(mto.params.desired_heading);
                        }
                    } else {
                        // If we are exactly on top, just offset X
                        next_pos.coords.x += arrival_dist;
                    }
                } else {
                    // Different landblocks, fallback to simple offset
                    next_pos.coords.x += arrival_dist;
                }
            }
            MovementTypeData::MoveToPosition(mtp) => {
                next_pos.landblock_id = mtp.origin.cell_id;
                next_pos.coords = mtp.origin.position;

                // If desired_heading is not zero, use it.
                if mtp.params.desired_heading.abs() > 1e-6 {
                    next_pos.rotation = Quaternion::from_heading(mtp.params.desired_heading);
                } else {
                    // Face the target position from our current position
                    let diff = next_pos.coords - self.world.player.position.coords;
                    if diff.length_squared() > 1e-6 {
                        let math_rad = f32::atan2(-diff.x, diff.y);
                        let mut heading_deg = 450.0 - math_rad.to_degrees();
                        heading_deg %= 360.0;
                        if heading_deg < 0.0 {
                            heading_deg += 360.0;
                        }
                        next_pos.rotation = Quaternion::from_heading(heading_deg.to_radians());
                    }
                }
            }
            MovementTypeData::TurnToHeading(tth) => {
                next_pos.rotation = Quaternion::from_heading(tth.params.desired_heading);
            }
            MovementTypeData::TurnToObject(tto) => {
                // If the turn has a heading, use it. Some TurnToObjects have 0.0 which means "compute it".
                if tto.desired_heading.abs() > 1e-6 {
                    next_pos.rotation = Quaternion::from_heading(tto.desired_heading);
                } else if let Some(target) = self.world.entities.get(tto.target) {
                    // Try to compute heading to target (West = 0, North = 90, East = 180, South = 270)
                    // We only do this if they are in the same landblock for now.
                    if target.position.landblock_id == next_pos.landblock_id {
                        let diff = target.position.coords - next_pos.coords;
                        // atan2(-dx, dy) returns math radians (0=North, pi/2=West, pi=South, 3pi/2=East)
                        let math_rad = f32::atan2(-diff.x, diff.y);
                        let mut heading_deg = 450.0 - math_rad.to_degrees();
                        heading_deg %= 360.0;
                        if heading_deg < 0.0 {
                            heading_deg += 360.0;
                        }

                        next_pos.rotation = Quaternion::from_heading(heading_deg.to_radians());
                    }
                }
            }
            _ => {
                // For other movement types (like Stop), we just accept current position
            }
        }

        // Update local world state (Teleport)
        // Check distance safely - ignore check if we are uninitialized (landblock 0) or just logging in
        let distance = if self.world.player.position.landblock_id == Guid::NULL {
            0.0
        } else {
            self.world.player.position.distance_to(&next_pos)
        };

        if distance > AUTO_MOVE_DISTANCE_LIMIT {
            log::warn!(
                "Aborting auto-move: target is {:.2}m away (limit {}m)",
                distance,
                AUTO_MOVE_DISTANCE_LIMIT
            );
            if let Some(tx) = &self.event_tx {
                let _ = tx.send(ClientEvent::ClientError(format!(
                    "Item is too far away ({:.1}m). Move closer!",
                    distance
                )));
            }
            return Ok(());
        }

        self.world.player.position = next_pos;

        // Emit event so TUI knows we "arrived"
        if let Some(tx) = &self.event_tx {
            let _ = tx.send(ClientEvent::World(Box::new(WorldEvent::EntityMoved {
                guid: self.world.player.guid,
                pos: next_pos,
            })));
        }

        // Respond with AutonomousPosition heartbeat to confirm arrival
        // We use AutonomousPosition instead of MoveToState because MoveToState
        // cancels server-side movement chains (like pickups) on the ACE server.
        let pulse = AutonomousPositionActionData {
            position: next_pos,
            instance_sequence: self.world.player.instance_sequence,
            server_control_sequence: self.world.player.server_control_sequence,
            teleport_sequence: self.world.player.teleport_sequence,
            force_position_sequence: self.world.player.force_position_sequence,
            last_contact: 1, // Logged as 0x1 (Contact) in retail
        };

        log::debug!(
            ">>> Sending AutonomousPosition heartbeat. ServerSeq: {}, Pos: {:?}",
            self.world.player.server_control_sequence,
            next_pos
        );

        let action = GameActionMessage {
            sequence: 0, // Heartbeats usually use 0 or a separate counter
            action: GameAction::AutonomousPosition(Box::new(pulse)),
        };

        self.session
            .send_message(&GameMessage::GameAction(Box::new(action)))
            .await?;

        Ok(())
    }
}
