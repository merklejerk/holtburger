pub mod dat;
pub mod math;
pub mod protocol;
pub mod session;
pub mod world;

use crate::protocol::crypto::Isaac;
use crate::protocol::messages::*;
use crate::session::Session;
use anyhow::{Result, anyhow};
use std::net::SocketAddr;
use std::time::{Duration, Instant};
use tokio::sync::mpsc;
use crate::protocol::messages::actions;

#[derive(Debug, Clone)]
pub enum MessageKind {
    Info,
    System,
    Chat,
    Tell,
    Emote,
    Error,
    Warning,
}

#[derive(Debug, Clone)]
pub struct ChatMessage {
    pub kind: MessageKind,
    pub text: String,
}

#[derive(Debug, PartialEq, Clone)]
pub enum ClientState {
    Connected,
    CharacterSelection(Vec<(u32, String)>),
    EnteringWorld,
    InWorld,
}

#[derive(Debug, Clone)]
pub enum ClientEvent {
    Message(ChatMessage),
    CharacterList(Vec<(u32, String)>),
    PlayerEntered {
        guid: u32,
        name: String,
    },
    StatusUpdate {
        state: ClientState,
        logon_retry: Option<(u32, u32, Option<Instant>)>,
        enter_retry: Option<(u32, u32, Option<Instant>)>,
    },
    World(Box<crate::world::WorldEvent>),
}

#[derive(Debug, Clone)]
pub enum ClientCommand {
    SelectCharacter(u32),
    SelectCharacterByIndex(usize),
    Talk(String),
    Identify(u32),
    Use(u32),
    Attack(u32),
    Drop(u32),
    Get(u32),
    MoveItem {
        item: u32,
        container: u32,
        placement: u32,
    },
    Quit,
}

#[derive(Debug, Clone)]
struct RetryState {
    active: bool,
    next_time: Option<Instant>,
    backoff_secs: u64,
    attempts: u32,
    max_attempts: u32,
}

impl RetryState {
    fn new(max_attempts: u32) -> Self {
        Self {
            active: false,
            next_time: None,
            backoff_secs: 5,
            attempts: 0,
            max_attempts,
        }
    }

    fn reset(&mut self) {
        self.active = false;
        self.next_time = None;
        self.attempts = 0;
        self.backoff_secs = 5;
    }

    fn schedule(&mut self) {
        if !self.active {
            self.active = true;
            self.attempts = 0;
            self.backoff_secs = 5;
            self.next_time = Some(Instant::now() + Duration::from_secs(self.backoff_secs));
        }
    }

    fn tick(&mut self, now: Instant) -> bool {
        if self.active && self.next_time.is_some_and(|t| now >= t) {
            if self.attempts >= self.max_attempts {
                self.active = false;
                self.next_time = None;
                false
            } else {
                self.attempts += 1;
                self.backoff_secs = std::cmp::min(self.backoff_secs * 2, 300);
                self.next_time = Some(now + Duration::from_secs(self.backoff_secs));
                true
            }
        } else {
            false
        }
    }
}

pub struct Client {
    pub session: Session,
    pub world: crate::world::WorldState,
    account_name: String,
    characters: Vec<(u32, String)>,
    character_id: Option<u32>,
    character_preference: Option<String>,
    state: ClientState,
    event_tx: Option<mpsc::UnboundedSender<ClientEvent>>,
    command_rx: Option<mpsc::UnboundedReceiver<ClientCommand>>,
    connection_cookie: u64,
    password: Option<String>,
    logon_retry: RetryState,
    enter_retry: RetryState,
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
            world: crate::world::WorldState::new(portal_dat),
            account_name: account_name.to_string(),
            characters: Vec::new(),
            character_id: None,
            character_preference,
            state: ClientState::Connected,
            event_tx: None,
            command_rx: None,
            connection_cookie: 0,
            password: None,
            logon_retry: RetryState::new(5),
            enter_retry: RetryState::new(5),
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

    fn send_message_event(&self, kind: MessageKind, text: &str) {
        if let Some(tx) = &self.event_tx {
            let _ = tx.send(ClientEvent::Message(ChatMessage {
                kind,
                text: text.to_string(),
            }));
        }
    }

    fn send_status_event(&self) {
        if let Some(tx) = &self.event_tx {
            let logon_retry = if self.logon_retry.active {
                Some((
                    self.logon_retry.attempts,
                    self.logon_retry.max_attempts,
                    self.logon_retry.next_time,
                ))
            } else {
                None
            };
            let enter_retry = if self.enter_retry.active {
                Some((
                    self.enter_retry.attempts,
                    self.enter_retry.max_attempts,
                    self.enter_retry.next_time,
                ))
            } else {
                None
            };
            let _ = tx.send(ClientEvent::StatusUpdate {
                state: self.state.clone(),
                logon_retry,
                enter_retry,
            });
        }
    }

    async fn handle_command(&mut self, cmd: ClientCommand) -> Result<()> {
        match cmd {
            ClientCommand::SelectCharacter(id) => self.select_character(id).await,
            ClientCommand::SelectCharacterByIndex(idx) => match &self.state {
                ClientState::CharacterSelection(chars) if (1..=chars.len()).contains(&idx) => {
                    let char_id = chars[idx - 1].0;
                    self.select_character(char_id).await
                }
                _ => Ok(()),
            },
            ClientCommand::Talk(text) => {
                if matches!(self.state, ClientState::InWorld) {
                    return self.send_talk(&text).await;
                }
                Ok(())
            }
            ClientCommand::Identify(guid) => {
                self.session
                    .send_message(&crate::protocol::messages::GameMessage::GameAction {
                        action: crate::protocol::messages::actions::IDENTIFY_OBJECT,
                        data: guid.to_le_bytes().to_vec(),
                    })
                    .await
            }
            ClientCommand::Use(guid) => {
                self.session
                    .send_message(&crate::protocol::messages::GameMessage::GameAction {
                        action: crate::protocol::messages::actions::USE,
                        data: guid.to_le_bytes().to_vec(),
                    })
                    .await
            }
            ClientCommand::Attack(guid) => {
                self.session
                    .send_message(&crate::protocol::messages::GameMessage::GameAction {
                        action: 0x0002,
                        data: guid.to_le_bytes().to_vec(),
                    })
                    .await
            }
            ClientCommand::Drop(guid) => {
                self.session
                    .send_message(&crate::protocol::messages::GameMessage::GameAction {
                        action: crate::protocol::messages::actions::DROP_ITEM,
                        data: guid.to_le_bytes().to_vec(),
                    })
                    .await
            }
            ClientCommand::Get(guid) => {
                let mut data = guid.to_le_bytes().to_vec();
                let pguid = self.world.player.guid;
                data.extend_from_slice(&pguid.to_le_bytes());
                data.extend_from_slice(&0u32.to_le_bytes()); // placement
                self.session
                    .send_message(&crate::protocol::messages::GameMessage::GameAction {
                        action: crate::protocol::messages::actions::PUT_ITEM_IN_CONTAINER,
                        data,
                    })
                    .await
            }
            ClientCommand::MoveItem {
                item,
                container,
                placement,
            } => {
                let mut data = item.to_le_bytes().to_vec();
                data.extend_from_slice(&container.to_le_bytes());
                data.extend_from_slice(&placement.to_le_bytes());
                self.session
                    .send_message(&crate::protocol::messages::GameMessage::GameAction {
                        action: crate::protocol::messages::actions::PUT_ITEM_IN_CONTAINER,
                        data,
                    })
                    .await
            }
            ClientCommand::Quit => {
                self.disconnect().await?;
                Err(anyhow!("Graceful disconnect"))
            }
        }
    }

    pub async fn disconnect(&mut self) -> Result<()> {
        let header = PacketHeader {
            flags: flags::DISCONNECT,
            sequence: self.session.packet_sequence,
            id: self.session.client_id,
            ..Default::default()
        };
        self.session.packet_sequence += 1;
        self.session
            .send_packet_to_addr(header, &[], self.session.server_addr)
            .await?;
        Ok(())
    }

    pub async fn run(&mut self, password: &str) -> Result<()> {
        self.password = Some(password.to_string());

        // Initial handshake: Start by sending Login Request
        self.send_login_request(password).await?;
        self.send_status_event();

        let mut retry_tick = tokio::time::interval(Duration::from_secs(1));
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
                                        self.world.server_time = Some(crate::world::state::ServerTimeSync {
                                            server_time,
                                            local_time: Instant::now(),
                                        });
                                        if let Some(tx) = &self.event_tx {
                                            let _ = tx.send(ClientEvent::World(Box::new(crate::world::WorldEvent::ServerTimeUpdate(server_time))));
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
                _ = retry_tick.tick() => {
                    let now = Instant::now();
                    if self.logon_retry.tick(now) {
                        self.send_status_event();
                        if let Some(pw) = self.password.clone() {
                            let _ = self.send_login_request(&pw).await;
                        }
                    }
                    if self.enter_retry.tick(now) {
                        self.send_status_event();
                        if let Some(char_id) = self.character_id {
                            let _ = self.send_character_enter_world(char_id).await;
                        }
                    }
                }
            }
        }
    }

    async fn handle_message(&mut self, data: &[u8]) -> Result<()> {
        if let Some(ref dump_dir) = self.message_dump_dir {
            let path = dump_dir.join(format!("{:05}.bin", self.message_counter));
            std::fs::write(path, data)?;
            self.message_counter += 1;
        }

        let message = GameMessage::unpack(data);

        // Pass to world state for tracking positioning and spawning
        let world_events = self.world.handle_message(message.clone());
        for event in world_events {
            if let Some(tx) = &self.event_tx {
                let _ = tx.send(ClientEvent::World(Box::new(event)));
            }
        }

        match message {
            GameMessage::CharacterList { characters } => {
                self.handle_character_list(characters).await
            }
            GameMessage::CharacterEnterWorldServerReady => {
                if let Some(char_id) = self.character_id {
                    self.send_character_enter_world(char_id).await
                } else {
                    Ok(())
                }
            }
            GameMessage::PlayerCreate { player_id } => {
                self.world.player.guid = player_id;

                let name = self
                    .characters
                    .iter()
                    .find(|(id, _)| *id == player_id)
                    .map(|(_, name)| name.clone())
                    .unwrap_or_else(|| {
                        // try search by character_id if we have it
                        if let Some(char_id) = self.character_id {
                            self.characters
                                .iter()
                                .find(|(id, _)| *id == char_id)
                                .map(|(_, name)| name.clone())
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

                self.send_message_event(
                    MessageKind::System,
                    &format!("Created as GUID: {:08X} ({})", player_id, name),
                );

                self.send_login_complete().await?;
                self.state = ClientState::InWorld;
                self.logon_retry.reset();
                self.enter_retry.reset();
                self.send_status_event();
                Ok(())
            }
            GameMessage::UpdatePropertyInt {
                guid: _,
                property: _,
                value: _,
            } => Ok(()),
            GameMessage::GameEvent {
                event_type,
                guid,
                sequence,
                data,
            } => {
                self.handle_game_event(event_type, guid, sequence, data)
                    .await
            }
            GameMessage::GameAction { action, data } => self.handle_game_action(action, data).await,
            GameMessage::ServerMessage { message } => {
                self.send_message_event(MessageKind::System, &message);
                Ok(())
            }
            GameMessage::CharacterError { error_code } => self.handle_character_error(error_code),
            GameMessage::DddInterrogation => {
                let resp = GameMessage::DddInterrogationResponse { language: 1 };
                self.session.send_message(&resp).await
            }
            GameMessage::ServerName {
                name, online_count, ..
            } => {
                self.send_message_event(
                    MessageKind::System,
                    &format!("Server: {} ({} online)", name, online_count),
                );
                Ok(())
            }
            GameMessage::HearSpeech { message, sender } => {
                self.send_message_event(MessageKind::Chat, &format!("{}: {}", sender, message));
                Ok(())
            }
            GameMessage::SoulEmote {
                sender_name, text, ..
            } => {
                self.send_message_event(MessageKind::Emote, &format!("{} {}", sender_name, text));
                Ok(())
            }
            _ => Ok(()),
        }
    }

    async fn handle_character_list(&mut self, characters: Vec<(u32, String)>) -> Result<()> {
        self.logon_retry.reset();
        self.enter_retry.reset();
        self.characters = characters.clone();
        if let Some(pref) = &self.character_preference {
            if let Ok(idx) = pref.parse::<usize>()
                && idx > 0
                && idx <= characters.len()
            {
                return self.select_character(characters[idx - 1].0).await;
            }
            if let Some(c) = characters
                .iter()
                .find(|(_, name)| name.to_lowercase() == pref.to_lowercase())
            {
                return self.select_character(c.0).await;
            }
        }
        self.state = ClientState::CharacterSelection(characters.clone());
        self.send_status_event();
        if let Some(tx) = &self.event_tx {
            let _ = tx.send(ClientEvent::CharacterList(characters));
        }
        Ok(())
    }

    async fn handle_game_event(
        &mut self,
        event_type: u32,
        _guid: u64,
        _sequence: u32,
        data: Vec<u8>,
    ) -> Result<()> {
        match event_type {
            game_event_opcodes::PLAYER_DESCRIPTION | game_event_opcodes::START_GAME => {
                if self.state == ClientState::EnteringWorld {
                    self.state = ClientState::InWorld;
                    self.enter_retry.reset();
                    self.send_status_event();
                }
            }
            game_event_opcodes::CHANNEL_BROADCAST => {
                let mut offset = 0;
                if data.len() >= 4 {
                    offset += 4;
                    let sender = read_string16(&data, &mut offset);
                    let message = read_string16(&data, &mut offset);
                    self.send_message_event(
                        MessageKind::Chat,
                        &format!(
                            "{}: {}",
                            if sender.is_empty() { "You" } else { &sender },
                            message
                        ),
                    );
                }
            }
            game_event_opcodes::TELL => {
                let mut offset = 0;
                let message = read_string16(&data, &mut offset);
                let sender = read_string16(&data, &mut offset);
                self.send_message_event(MessageKind::Tell, &format!("{}: {}", sender, message));
            }
            _ => {}
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
        if error_code == character_error_codes::ACCOUNT_ALREADY_LOGGED_ON {
            self.logon_retry.schedule();
            self.send_status_event();
        } else if error_code == character_error_codes::ENTER_GAME_CHARACTER_IN_WORLD {
            self.enter_retry.schedule();
            self.send_status_event();
        }
        self.send_message_event(
            MessageKind::Error,
            &format!("Character Error: 0x{:08X}", error_code),
        );
        Ok(())
    }

    async fn select_character(&mut self, char_id: u32) -> Result<()> {
        self.character_id = Some(char_id);
        self.state = ClientState::EnteringWorld;
        self.send_status_event();
        let msg = GameMessage::CharacterEnterWorldRequest { char_id };
        self.session.send_message(&msg).await?;
        Ok(())
    }

    async fn send_character_enter_world(&mut self, char_id: u32) -> Result<()> {
        let msg = GameMessage::CharacterEnterWorld {
            id: char_id,
            account: self.account_name.clone(),
        };
        self.session.send_message(&msg).await?;
        Ok(())
    }

    async fn send_login_complete(&mut self) -> Result<()> {
        let msg = GameMessage::GameAction {
            action: actions::LOGIN_COMPLETE,
            data: Vec::new(),
        };
        self.session.send_message(&msg).await?;
        Ok(())
    }

    async fn send_talk(&mut self, text: &str) -> Result<()> {
        let mut data = Vec::new();
        write_string16(&mut data, text);
        let msg = GameMessage::GameAction {
            action: actions::TALK,
            data,
        };
        self.session.send_message(&msg).await?;
        Ok(())
    }

    async fn send_login_request(&mut self, password: &str) -> Result<()> {
        log::debug!(
            ">>> Sending Login Request for account {}",
            self.account_name
        );
        let header = PacketHeader {
            flags: flags::LOGIN_REQUEST,
            sequence: self.session.packet_sequence,
            ..Default::default()
        };
        let payload =
            build_login_payload(&self.account_name, password, self.session.packet_sequence);
        self.session.packet_sequence += 1;
        self.session.send_packet(header, &payload).await?;
        Ok(())
    }

    async fn handle_handshake_request(
        &mut self,
        crd: crate::protocol::messages::ConnectRequestData,
    ) -> Result<()> {
        log::debug!("<<< Handshake Request (Incoming): {:?}", crd);
        self.connection_cookie = crd.cookie;
        self.session.client_id = crd.client_id;
        self.session.isaac_c2s = Some(Isaac::new(crd.client_seed));
        self.session.isaac_s2c = Some(Isaac::new(crd.server_seed));

        let resp_header = PacketHeader {
            flags: flags::CONNECT_RESPONSE,
            sequence: 1,
            id: self.session.client_id,
            size: 8,
            ..Default::default()
        };
        self.session.packet_sequence = 2;

        let mut payload = Vec::new();
        payload.extend_from_slice(&self.connection_cookie.to_le_bytes());

        // Respond on port + 1
        let mut activation_addr = self.session.server_addr;
        activation_addr.set_port(self.session.server_addr.port() + 1);

        tokio::time::sleep(Duration::from_millis(ACE_HANDSHAKE_RACE_DELAY_MS)).await;
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

        // After handshake, we can finally login
        if let Some(pw) = self.password.clone() {
            self.send_login_request(&pw).await?;
        }

        Ok(())
    }
}
