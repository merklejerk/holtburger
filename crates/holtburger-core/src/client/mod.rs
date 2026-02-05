use crate::protocol::crypto::Isaac;
use crate::protocol::messages::actions;
use crate::protocol::messages::*;
use crate::session::Session;
use crate::world::{WorldEvent, WorldState, state::ServerTimeSync};
use anyhow::{Result, anyhow};
use std::net::SocketAddr;
use std::time::{Duration, Instant};
use tokio::sync::mpsc;

pub mod types;
use types::*;

pub struct Client {
    pub session: Session,
    pub world: WorldState,
    account_name: String,
    characters: Vec<CharacterEntry>,
    character_id: Option<u32>,
    character_preference: Option<String>,
    state: ClientState,
    event_tx: Option<mpsc::UnboundedSender<ClientEvent>>,
    command_rx: Option<mpsc::UnboundedReceiver<ClientCommand>>,
    connection_cookie: u64,
    pub message_dump_dir: Option<std::path::PathBuf>,
    message_counter: usize,
}

impl Client {
    pub async fn new(
        server_ip: &str,
        server_port: u16,
        account_name: &str,
        character_preference: Option<String>,
    ) -> Result<Self> {
        let target = format!("{}:{}", server_ip, server_port).parse::<SocketAddr>()?;
        let session = Session::new(target).await?;
        Self::create_with_session(session, account_name, character_preference)
    }

    pub fn new_replay(
        replay_path: &str,
        account_name: &str,
        character_preference: Option<String>,
    ) -> Result<Self> {
        // Replay doesn't strictly need a target addr, but we can use a dummy one
        // Use 9001 for World server traffic (player spawns!)
        let target = "127.0.0.1:9001".parse::<SocketAddr>().unwrap();
        let session = Session::new_replay(replay_path, target)?;
        Self::create_with_session(session, account_name, character_preference)
    }

    fn create_with_session(
        session: Session,
        account_name: &str,
        character_preference: Option<String>,
    ) -> Result<Self> {
        // Try to find DATs in common locations
        let mut portal_dat = None;
        for path in [
            "portal.dat",
            "dats/portal.dat",
            "ace-root/dats/portal.dat",
            "../dats/portal.dat",
        ] {
            if let Ok(db) = crate::dat::DatDatabase::new(path) {
                portal_dat = Some(std::sync::Arc::new(db));
                break;
            }
        }

        Ok(Client {
            session,
            world: WorldState::new(portal_dat),
            account_name: account_name.to_string(),
            characters: Vec::new(),
            character_id: None,
            character_preference,
            state: ClientState::Connected,
            event_tx: None,
            command_rx: None,
            connection_cookie: 0,
            message_dump_dir: None,
            message_counter: 0,
        })
    }

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
            ClientCommand::Ping => {
                log::info!(">>> Sending Ping");
                self.session
                    .send_message(&GameMessage::GameAction(Box::new(GameActionData {
                        sequence: 0,
                        action: actions::PING_REQUEST,
                        data: Vec::new(),
                    })))
                    .await
            }
            ClientCommand::Identify(guid) => {
                log::info!(">>> Identifying: 0x{:08X}", guid);
                self.session
                    .send_message(&GameMessage::GameAction(Box::new(GameActionData {
                        sequence: 0,
                        action: actions::IDENTIFY_OBJECT,
                        data: guid.to_le_bytes().to_vec(),
                    })))
                    .await
            }
            ClientCommand::Use(guid) => {
                log::info!(">>> Using: 0x{:08X}", guid);
                self.session
                    .send_message(&GameMessage::GameAction(Box::new(GameActionData {
                        sequence: 0,
                        action: actions::USE,
                        data: guid.to_le_bytes().to_vec(),
                    })))
                    .await
            }
            ClientCommand::Drop(guid) => {
                log::info!(">>> Dropping: 0x{:08X}", guid);
                self.session
                    .send_message(&GameMessage::GameAction(Box::new(GameActionData {
                        sequence: 0,
                        action: actions::DROP_ITEM,
                        data: guid.to_le_bytes().to_vec(),
                    })))
                    .await
            }
            ClientCommand::Get(guid) => {
                log::info!(">>> Getting: 0x{:08X}", guid);
                let mut data = guid.to_le_bytes().to_vec();
                let pguid = self.world.player.guid;
                data.extend_from_slice(&pguid.to_le_bytes());
                data.extend_from_slice(&0u32.to_le_bytes()); // placement
                self.session
                    .send_message(&GameMessage::GameAction(Box::new(GameActionData {
                        sequence: 0,
                        action: actions::PUT_ITEM_IN_CONTAINER,
                        data,
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
                let mut data = item.to_le_bytes().to_vec();
                data.extend_from_slice(&container.to_le_bytes());
                data.extend_from_slice(&placement.to_le_bytes());
                self.session
                    .send_message(&GameMessage::GameAction(Box::new(GameActionData {
                        sequence: 0,
                        action: actions::PUT_ITEM_IN_CONTAINER,
                        data,
                    })))
                    .await
            }
            ClientCommand::Quit => {
                log::info!("Disconnecting...");
                self.disconnect().await?;
                Err(anyhow!("Graceful disconnect"))
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
        Ok(())
    }

    pub async fn run(&mut self) -> Result<()> {
        // Initial handshake: If this is an activation/logon session, the bin should send ClientCommand::Login
        self.send_status_event();

        let mut physics_tick = tokio::time::interval(Duration::from_millis(30));
        let mut last_physics_time = Instant::now();

        loop {
            tokio::select! {
                res = self.session.recv_message() => {
                    use crate::session::SessionEvent;
                    match res {
                        Ok(events) => {
                            for event in events {
                                match event {
                                    SessionEvent::Message(msg_data) => {
                                        self.handle_message(&msg_data).await?;
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

                    // TODO: Use actual player radius from DAT/Properties
                    self.world.tick(dt, 0.35);
                }
            }
        }
    }

    async fn handle_message(&mut self, data: &[u8]) -> Result<()> {
        if let Some(tx) = &self.event_tx {
            let _ = tx.send(ClientEvent::RawMessage(data.to_vec()));
        }

        if let Some(ref dump_dir) = self.message_dump_dir {
            let path = dump_dir.join(format!("{:05}.bin", self.message_counter));
            std::fs::write(path, data)?;
            self.message_counter += 1;
        }

        let message = GameMessage::unpack(data);
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
            return Ok(());
        }
        let message = message.unwrap();

        if let Some(tx) = &self.event_tx {
            let _ = tx.send(ClientEvent::GameMessage(Box::new(message.clone())));
        }

        // Pass to world state for tracking positioning and spawning
        let world_events = self.world.handle_message(&message);
        for event in world_events {
            if let Some(tx) = &self.event_tx {
                let _ = tx.send(ClientEvent::World(Box::new(event)));
            }
        }

        match message {
            GameMessage::CharacterList(data) => self.handle_character_list(*data).await,
            GameMessage::CharacterEnterWorldServerReady => {
                if let Some(char_id) = self.character_id {
                    self.send_character_enter_world(char_id).await
                } else {
                    Ok(())
                }
            }
            GameMessage::GameEvent(ev) => match &ev.event {
                GameEventData::PlayerDescription(_) | GameEventData::StartGame => {
                    if self.state == ClientState::EnteringWorld {
                        self.state = ClientState::InWorld;
                        self.send_status_event();
                    }
                    Ok(())
                }
                GameEventData::PingResponse(_) => {
                    if let Some(tx) = &self.event_tx {
                        let _ = tx.send(ClientEvent::PingResponse);
                    }
                    Ok(())
                }
                GameEventData::ViewContents(data) => {
                    if let Some(tx) = &self.event_tx {
                        let _ = tx.send(ClientEvent::ViewContents {
                            container: data.container,
                            items: data.items.clone(),
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
            GameMessage::UpdatePropertyInt(_) => Ok(()),
            GameMessage::GameAction(data) => {
                self.handle_game_action(data.action, data.data.clone())
                    .await
            }
            GameMessage::ServerMessage(data) => {
                if let Some(tx) = &self.event_tx {
                    let _ = tx.send(ClientEvent::ServerMessage(data.message.clone()));
                }
                Ok(())
            }
            GameMessage::CharacterError(data) => self.handle_character_error(data.error_code),
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
        }
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

    async fn handle_game_action(&mut self, action: u32, _data: Vec<u8>) -> Result<()> {
        if action == actions::LOGIN_COMPLETE {
            self.state = ClientState::InWorld;
            self.send_status_event();
        }
        Ok(())
    }

    fn handle_character_error(&mut self, error_code: u32) -> Result<()> {
        if let Some(tx) = &self.event_tx {
            let _ = tx.send(ClientEvent::CharacterError(error_code));
        }
        log::warn!("Character Error received: 0x{:08X}", error_code);
        Ok(())
    }

    async fn select_character(&mut self, char_id: u32) -> Result<()> {
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

    async fn send_character_enter_world(&mut self, char_id: u32) -> Result<()> {
        let msg = GameMessage::CharacterEnterWorld(Box::new(CharacterEnterWorldData {
            guid: char_id,
            account: self.account_name.clone(),
        }));
        self.session.send_message(&msg).await?;
        Ok(())
    }

    async fn send_login_complete(&mut self) -> Result<()> {
        let msg = GameMessage::GameAction(Box::new(GameActionData {
            sequence: 0,
            action: actions::LOGIN_COMPLETE,
            data: Vec::new(),
        }));
        self.session.send_message(&msg).await?;
        Ok(())
    }

    async fn send_talk(&mut self, text: &str) -> Result<()> {
        let mut data = Vec::new();
        write_string16(&mut data, text);
        let msg = GameMessage::GameAction(Box::new(GameActionData {
            sequence: 0,
            action: actions::TALK,
            data,
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
            crate::protocol::messages::transport::ACE_HANDSHAKE_RACE_DELAY_MS,
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
}
