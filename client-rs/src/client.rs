use crate::crypto::Isaac;
use crate::protocol::*;
use crate::properties;
use crate::session::Session;
use anyhow::Result;
use byteorder::{ByteOrder, LittleEndian};
use std::net::SocketAddr;

#[derive(Debug, PartialEq, Clone)]
enum ClientState {
    Connected,
    CharacterSelection(Vec<(u32, String)>),
    EnteringWorld,
    InWorld,
}

use tokio::sync::mpsc;
use crate::ui::{ChatMessage, MessageKind};

#[derive(Debug, Clone)]
struct RetryState {
    active: bool,
    next_time: Option<std::time::Instant>,
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
            self.next_time = Some(std::time::Instant::now() + std::time::Duration::from_secs(self.backoff_secs));
        }
    }

    fn tick(&mut self, now: std::time::Instant) -> bool {
        if self.active && self.next_time.is_some_and(|t| now >= t) {
            if self.attempts >= self.max_attempts {
                self.active = false;
                self.next_time = None;
                false
            } else {
                self.attempts += 1;
                // Prepare next backoff
                self.backoff_secs = std::cmp::min(self.backoff_secs * 2, 300);
                self.next_time = Some(now + std::time::Duration::from_secs(self.backoff_secs));
                true
            }
        } else {
            false
        }
    }
}

pub enum ClientEvent {
    Message(ChatMessage),
    CharacterList(Vec<(u32, String)>),
    StatusUpdate {
        state: String,
        logon_retry: Option<(u32, u32)>,
        enter_retry: Option<(u32, u32)>,
    },
}

impl Client {
    fn send_message(&self, kind: MessageKind, text: &str) {
        log::info!("{}", text);
        if let Some(tx) = &self.event_tx {
            let _ = tx.send(ClientEvent::Message(ChatMessage { kind, text: text.to_string() }));
        }
    }

    fn log(&self, msg: &str) {
        self.send_message(MessageKind::Info, msg);
    }

    fn send_status(&self) {
        if let Some(tx) = &self.event_tx {
            let logon_retry = if self.logon_retry.active {
                Some((self.logon_retry.attempts, self.logon_retry.max_attempts))
            } else {
                None
            };
            let enter_retry = if self.enter_retry.active {
                Some((self.enter_retry.attempts, self.enter_retry.max_attempts))
            } else {
                None
            };
            let _ = tx.send(ClientEvent::StatusUpdate {
                state: format!("{:?}", self.state),
                logon_retry,
                enter_retry,
            });
        }
    }

    fn cancel_retries(&mut self) {
        let was_retrying = self.logon_retry.active || self.enter_retry.active;
        self.logon_retry.reset();
        self.enter_retry.reset();

        if was_retrying {
            self.send_message(MessageKind::Info, "Login succeeded; cancelled automatic retries.");
        }
    }
}
pub enum ClientCommand {
    SelectCharacter(u32),
    SelectCharacterByIndex(usize),
    Talk(String),
    Quit,
}

pub struct Client {
    session: Session,
    account_name: String,
    character_id: Option<u32>,
    character_preference: Option<String>,
    state: ClientState,
    event_tx: Option<mpsc::UnboundedSender<ClientEvent>>,
    command_rx: Option<mpsc::UnboundedReceiver<ClientCommand>>,
    // Handshake state
    connection_cookie: u64,

    // Auto-reconnect on logon or character-in-world errors
    password: Option<String>,
    logon_retry: RetryState,
    enter_retry: RetryState,
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

        Ok(Client {
            session,
            account_name: account_name.to_string(),
            character_id: None,
            character_preference,
            state: ClientState::Connected,
            event_tx: None,
            command_rx: None,
            connection_cookie: 0,
            password: None,
            logon_retry: RetryState::new(6),
            enter_retry: RetryState::new(6),
        })
    }

    pub fn set_event_tx(&mut self, tx: mpsc::UnboundedSender<ClientEvent>) {
        self.event_tx = Some(tx);
    }

    pub fn set_command_rx(&mut self, rx: mpsc::UnboundedReceiver<ClientCommand>) {
        self.command_rx = Some(rx);
    }

    async fn handle_command(&mut self, cmd: ClientCommand) -> Result<()> {
        match cmd {
            ClientCommand::SelectCharacter(id) => self.select_character(id).await,
            ClientCommand::SelectCharacterByIndex(idx) => {
                match &self.state {
                    ClientState::CharacterSelection(chars) if (1..=chars.len()).contains(&idx) => {
                        let char_id = chars[idx - 1].0;
                        self.state = ClientState::EnteringWorld;
                        self.send_status();
                        self.select_character(char_id).await
                    }
                    _ => Ok(()),
                }
            }
            ClientCommand::Talk(text) => {
                if matches!(self.state, ClientState::InWorld) {
                    log::debug!("Handling Talk command: '{}'", text);
                    return self.send_talk(&text).await;
                } else {
                    self.send_message(MessageKind::Warning, &format!(
                        "Discarding chat message (Not in world yet. State: {:?})",
                        self.state
                    ));
                    Ok(())
                }
            }
            ClientCommand::Quit => {
                self.disconnect().await?;
                Err(anyhow::anyhow!("Graceful disconnect"))
            }
        }
    }

    pub async fn disconnect(&mut self) -> Result<()> {
        self.send_message(MessageKind::Info, "Sending disconnect signal to server...");
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
        // Store password for potential retries
        self.password = Some(password.to_string());
        self.logon_retry.reset();
        self.enter_retry.reset();

        self.send_message(MessageKind::Info, &format!("Connecting to {}...", self.session.server_addr));
        self.send_login_request(password).await?;
        self.send_status();

        let mut buf = [0u8; MAX_PACKET_SIZE];
        let mut retry_tick = tokio::time::interval(std::time::Duration::from_secs(1));

        loop {
            tokio::select! {
                // Incoming packets
                res = self.session.recv_packet(&mut buf) => {
                    let (header, payload, addr) = res?;
                    self.process_packet(&header, &payload, addr).await?;
                }

                // Commands from UI/Caller
                Some(cmd) = async {
                    if let Some(rx) = &mut self.command_rx {
                        rx.recv().await
                    } else {
                        None
                    }
                } => {
                    self.handle_command(cmd).await?;
                }

                // Retry tick: perform scheduled reconnect/login retries when appropriate
                _ = retry_tick.tick() => {
                    let now = std::time::Instant::now();

                    // Handle scheduled reconnect/login retries
                    if self.logon_retry.tick(now) {
                        self.send_message(MessageKind::Info, &format!("Retrying login attempt {}/{}...", self.logon_retry.attempts, self.logon_retry.max_attempts));
                        self.send_status();
                        if let Some(pw) = self.password.clone() {
                            if let Err(e) = self.send_login_request(&pw).await {
                                log::debug!("Retry login attempt failed to send: {}", e);
                            }
                        }
                    } else if self.logon_retry.attempts >= self.logon_retry.max_attempts && self.logon_retry.active {
                        self.send_message(MessageKind::Error, &format!("Giving up after {} reconnect attempts.", self.logon_retry.attempts));
                        self.logon_retry.active = false;
                        self.send_status();
                    }

                    // Handle scheduled retries for entering a character that's still in the world
                    if self.enter_retry.tick(now) {
                        self.send_message(MessageKind::Info, &format!("Retrying enter attempt {}/{}...", self.enter_retry.attempts, self.enter_retry.max_attempts));
                        self.send_status();
                        if let Some(char_id) = self.character_id {
                            if let Err(e) = self.send_character_enter_world(char_id).await {
                                log::debug!("Retry enter attempt failed to send: {}", e);
                            }
                        } else {
                            self.send_message(MessageKind::Warning, "No character selected; cannot retry enter automatically.");
                            self.enter_retry.reset();
                            self.send_status();
                        }
                    } else if self.enter_retry.attempts >= self.enter_retry.max_attempts && self.enter_retry.active {
                        self.send_message(MessageKind::Error, &format!("Giving up after {} enter attempts.", self.enter_retry.attempts));
                        self.enter_retry.active = false;
                        self.send_status();
                    }
                }
            }
        }
    }

    async fn process_packet(
        &mut self,
        header: &PacketHeader,
        data: &[u8],
        addr: SocketAddr,
    ) -> Result<()> {
        log::debug!(
            "<<< Received packet from {}: Flags:{:08X} Seq:{} ID:{} Size:{}",
            addr,
            header.flags,
            header.sequence,
            header.id,
            header.size
        );

        if header.sequence > 0 && (header.flags & flags::ACK_SEQUENCE == 0) {
            let _ = self.session.send_ack(header.sequence).await;
        }

            if header.flags & flags::CONNECT_REQUEST != 0 {
                self.handle_connect_request(header, data, addr).await?;
            } else {
                let mut offset = 0;

                if header.flags & flags::SERVER_SWITCH != 0 {
                    offset += 8;
                }
                if header.flags & flags::REQUEST_RETRANSMIT != 0 && offset + 4 <= data.len() {
                    let count = LittleEndian::read_u32(&data[offset..offset + 4]);
                    offset += 4 + (count as usize * 4);
                }
                if header.flags & flags::REJECT_RETRANSMIT != 0 && offset + 4 <= data.len() {
                    let count = LittleEndian::read_u32(&data[offset..offset + 4]);
                    offset += 4 + (count as usize * 4);
                }
                if header.flags & flags::ACK_SEQUENCE != 0 && offset + 4 <= data.len() {
                    offset += 4;
                }
                if header.flags & (flags::LOGIN_REQUEST | flags::WORLD_LOGIN_REQUEST) != 0 {
                    // These flags mean the WHOLE payload is the login request, 
                    // no optional header fields to skip.
                }
                if header.flags & flags::CONNECT_RESPONSE != 0 {
                    offset += 8;
                }
                if header.flags & flags::CICMD != 0 {
                    offset += 8;
                }
                if header.flags & flags::TIME_SYNC != 0 {
                    offset += 8;
                }
                if header.flags & flags::ECHO_REQUEST != 0 {
                    offset += 4;
                }
                if header.flags & flags::ECHO_RESPONSE != 0 {
                    offset += 8;
                }
                if header.flags & flags::FLOW != 0 {
                    offset += 6;
                }

                // Echo Response logic
                if header.flags & flags::ECHO_REQUEST != 0 {
                    let mut resp = header.clone();
                    resp.flags = flags::ECHO_RESPONSE;
                    let _ = self.session.send_packet(resp, &[]).await;
                }

                if header.flags & flags::BLOB_FRAGMENTS != 0 && offset < data.len() {
                    self.handle_fragments(header, &data[offset..]).await?;
                }
            }

        Ok(())
    }

    async fn send_login_request(&mut self, password: &str) -> Result<()> {
        let header = PacketHeader {
            flags: flags::LOGIN_REQUEST,
            sequence: self.session.packet_sequence,
            ..Default::default()
        };

        let payload = build_login_payload(&self.account_name, password, self.session.packet_sequence);
        self.session.packet_sequence += 1;

        self.session.send_packet(header, &payload).await?;
        log::debug!("Sent LoginRequest (Payload: {})", payload.len());
        Ok(())
    }

    async fn handle_connect_request(
        &mut self,
        header: &PacketHeader,
        data: &[u8],
        addr: SocketAddr,
    ) -> Result<()> {
        log::debug!("Received ConnectRequest from {}", addr);

        let crd = ConnectRequestData::unpack(data);
        self.connection_cookie = crd.cookie;
        // The ID in the header is the ServerID (0x0B/11), but we must use 
        // the ClientID from the payload (0) for our outgoing packet headers.
        self.session.client_id = crd.client_id;

        log::debug!(
            "Handshake Data: Cookie:{:016X}, CID:{:04X} (Header ID:{:04X}), ServerSeed:{:08X}, ClientSeed:{:08X}",
            self.connection_cookie,
            crd.client_id,
            header.id,
            crd.server_seed,
            crd.client_seed
        );

        // Initialize ISAAC
        let c2s = Isaac::new(crd.client_seed);
        self.session.isaac_c2s = Some(c2s);

        let s2c = Isaac::new(crd.server_seed);
        self.session.isaac_s2c = Some(s2c);

        // ConnectResponse confirmation
        let resp_header = PacketHeader {
            flags: flags::CONNECT_RESPONSE,
            sequence: 1,
            id: self.session.client_id,
            size: std::mem::size_of::<u64>() as u16,
            ..Default::default()
        };
        self.session.packet_sequence = 2; // Seq 1 used for ConnectResponse

        let mut payload = Vec::new();
        payload.extend_from_slice(&self.connection_cookie.to_le_bytes());

        // ACE Handshake Quirk: The ConnectResponse MUST be sent to the "Activation Port" 
        // (usually login_port + 1) to "activate" the session, even though subsequent 
        // game traffic stays on the primary login port.
        let mut activation_addr = self.session.server_addr;
        activation_addr.set_port(self.session.server_addr.port() + 1);

        tokio::time::sleep(tokio::time::Duration::from_millis(
            ACE_HANDSHAKE_RACE_DELAY_MS,
        ))
        .await;

        self.send_message(MessageKind::Info, &format!(
            "Sending ConnectResponse to {} (Activation)...",
            activation_addr
        ));

        // Note: We use send_packet_to_addr to hit the activation port specifically.
        // We do NOT update self.session.server_addr, as game messages return to the login port.
        self.session
            .send_packet_to_addr(resp_header, &payload, activation_addr)
            .await?;

        // packet_sequence already set to 2 at start of this function
        self.send_message(MessageKind::Info, "Sent ConnectResponse. Connection established.");

        Ok(())
    }

    async fn handle_fragments(&mut self, _header: &PacketHeader, data: &[u8]) -> Result<()> {
        let mut offset = 0;

        while offset + FRAGMENT_HEADER_SIZE <= data.len() {
            let frag_header = FragmentHeader::unpack(&data[offset..offset + FRAGMENT_HEADER_SIZE]);
            let frag_data_size = (frag_header.size as usize).saturating_sub(FRAGMENT_HEADER_SIZE);
            offset += FRAGMENT_HEADER_SIZE;

            if offset + frag_data_size > data.len() {
                break;
            }

            let frag_data = &data[offset..offset + frag_data_size];
            if let Some(full_message) = self.session.process_fragment(&frag_header, frag_data) {
                self.handle_message(&full_message).await?;
            }

            offset += frag_data_size;
        }

        Ok(())
    }

    async fn handle_message(&mut self, data: &[u8]) -> Result<()> {
        let message = GameMessage::unpack(data);
        log::debug!("<<< GameMessage: {:?}", message);

        match message {
            GameMessage::CharacterList { characters } => self.handle_character_list(characters).await,
            GameMessage::CharacterEnterWorldServerReady => {
                self.send_message(MessageKind::System, "Server ready for world entry. Sending CharacterEnterWorld...");
                if let Some(char_id) = self.character_id {
                    self.send_character_enter_world(char_id).await
                } else {
                    Ok(())
                }
            }
            GameMessage::PlayerCreate { player_id } => self.handle_player_create(player_id).await,
            GameMessage::ObjectCreate { guid } => {
                log::debug!("Object Created: {:08X}", guid);
                Ok(())
            }
            GameMessage::ObjectDelete { guid } => {
                log::debug!("Object Deleted: {:08X}", guid);
                Ok(())
            }
            GameMessage::ObjectStatUpdate { guid, .. } => {
                log::debug!("Object Stat Update: {:08X}", guid);
                Ok(())
            }
            GameMessage::PlayEffect { guid } => {
                log::debug!("Play Effect on: {:08X}", guid);
                Ok(())
            }
            GameMessage::UpdatePropertyInt { property, value } => {
                let name = properties::property_name(property);
                self.send_message(MessageKind::Info, &format!("[Stats] {} ({}) updated to {}", name, property, value));
                Ok(())
            }
            GameMessage::UpdateMotion { .. } | GameMessage::UpdatePosition { .. } | GameMessage::VectorUpdate { .. } => Ok(()),
            GameMessage::GameEvent { event_type, guid, sequence, data } => self.handle_game_event(event_type, guid, sequence, data).await,
            GameMessage::GameAction { action, data } => self.handle_game_action(action, data).await,
            GameMessage::ServerMessage { message } => {
                self.send_message(MessageKind::System, &message);
                Ok(())
            }
            GameMessage::CharacterError { error_code } => self.handle_character_error(error_code),
            GameMessage::DddInterrogation => {
                log::debug!("Received DDD Interrogation. Sending response (English).");
                let resp = GameMessage::DddInterrogationResponse { language: 1 };
                self.session.send_message(&resp).await
            }
            GameMessage::ServerName { name, online_count, .. } => {
                self.send_message(MessageKind::System, &format!("Connected to server: {} ({} players online)", name, online_count));
                Ok(())
            }
            GameMessage::HearSpeech { message, sender } => {
                self.send_message(MessageKind::Chat, &format!("{}: {}", sender, message));
                Ok(())
            }
            GameMessage::SoulEmote { sender_name, text, .. } => self.handle_soul_emote(sender_name, text),
            GameMessage::Unknown { opcode, data } => {
                log::debug!("Unknown message received: 0x{:08X} (Size: {}) Data: {:02X?}", opcode, data.len(), data);
                Ok(())
            }
            _ => Ok(()),
        }
    }

    async fn handle_character_list(&mut self, characters: Vec<(u32, String)>) -> Result<()> {
        self.send_message(MessageKind::Info, &format!("Character List received ({} characters)", characters.len()));
        self.cancel_retries();

        if let Some(pref) = &self.character_preference {
            if let Ok(idx) = pref.parse::<usize>() {
                if (1..=characters.len()).contains(&idx) {
                    return self.select_character(characters[idx - 1].0).await;
                }
            }
            if let Some(c) = characters.iter().find(|(_, name)| name.to_lowercase() == pref.to_lowercase()) {
                return self.select_character(c.0).await;
            }
        }
        
        self.state = ClientState::CharacterSelection(characters.clone());
        if let Some(tx) = &self.event_tx {
            let _ = tx.send(ClientEvent::CharacterList(characters));
        }
        Ok(())
    }

    async fn handle_player_create(&mut self, player_id: u32) -> Result<()> {
        self.send_message(MessageKind::System, &format!("You have been created with GUID: {:08X}", player_id));
        self.send_login_complete().await?;
        self.send_message(MessageKind::System, "Login complete! (Transitioning to InWorld)");
        self.state = ClientState::InWorld;
        self.cancel_retries();
        self.send_status();
        Ok(())
    }

    async fn handle_game_event(&mut self, event_type: u32, guid: u64, sequence: u32, data: Vec<u8>) -> Result<()> {
        let type_name = match event_type {
            game_event_opcodes::PLAYER_DESCRIPTION => {
                if self.state == ClientState::EnteringWorld {
                    self.state = ClientState::InWorld;
                    self.log("Received PlayerDescription. Transitioning to InWorld.");
                    self.cancel_retries();
                    self.send_status();
                }
                "PlayerDescription"
            }
            game_event_opcodes::CHANNEL_BROADCAST => "ChannelBroadcast",
            game_event_opcodes::VIEW_CONTENTS => "ViewContents",
            game_event_opcodes::START_GAME => {
                if self.state == ClientState::EnteringWorld {
                    self.state = ClientState::InWorld;
                    self.log("Received StartGame. Transitioning to InWorld.");
                    self.cancel_retries();
                    self.send_status();
                }
                "StartGame"
            }
            game_event_opcodes::WEENIE_ERROR => "WeenieError",
            game_event_opcodes::CHARACTER_TITLE => "CharacterTitle",
            game_event_opcodes::FRIENDS_LIST_UPDATE => "FriendsListUpdate",
            game_event_opcodes::FELLOWSHIP_UPDATE_FELLOW => "FellowshipUpdateFellow",
            game_event_opcodes::TELL => "Tell",
            _ => "UnknownEvent",
        };

        if event_type == game_event_opcodes::CHANNEL_BROADCAST {
            let mut offset = 0;
            if data.len() >= 4 {
                let _channel = LittleEndian::read_u32(&data[0..4]);
                offset += 4;
                let sender = read_string16(&data, &mut offset);
                let message = read_string16(&data, &mut offset);
                let display_sender = if sender.is_empty() { "You" } else { &sender };
                self.send_message(MessageKind::Chat, &format!("{}: {}", display_sender, message));
            }
        } else if event_type == game_event_opcodes::TELL {
            let mut offset = 0;
            let message = read_string16(&data, &mut offset);
            let sender = read_string16(&data, &mut offset);
            self.send_message(MessageKind::Tell, &format!("{}: {}", sender, message));
        } else {
            log::debug!("GameEvent: {} (Type: 0x{:04X}, GUID: {:016X}, Seq: {})", type_name, event_type, guid, sequence);
        }
        Ok(())
    }

    async fn handle_game_action(&mut self, action: u32, _data: Vec<u8>) -> Result<()> {
        let action_name = match action {
            action_opcodes::LOGIN_COMPLETE => "LoginComplete",
            action_opcodes::TALK => "Talk",
            _ => "UnknownAction",
        };

        if action == action_opcodes::LOGIN_COMPLETE {
            self.send_message(MessageKind::System, "Received LoginComplete confirmation from server.");
            self.state = ClientState::InWorld;
            self.cancel_retries();
            self.send_status();
        }
        log::debug!("<<< GameAction: {} (Type: 0x{:04X})", action_name, action);
        Ok(())
    }

    fn handle_character_error(&mut self, error_code: u32) -> Result<()> {
        let msg = match error_code {
            character_error_codes::ACCOUNT_ALREADY_LOGGED_ON => "Account already logged on (Logon Error)".to_string(),
            character_error_codes::CHARACTER_ALREADY_LOGGED_ON => "Character already logged on (Character in World)".to_string(),
            character_error_codes::CHARACTER_LIMIT_REACHED => "Character limit reached".to_string(),
            _ => format!("0x{:08X}", error_code),
        };

        if error_code == character_error_codes::ACCOUNT_ALREADY_LOGGED_ON {
            if !self.logon_retry.active {
                self.logon_retry.schedule();
                self.send_message(MessageKind::Warning, "Account already logged on. Will retry login automatically.");
                self.send_status();
            } else {
                self.send_message(MessageKind::Info, &format!("Account still logged on. Next retry in {}s.", self.logon_retry.backoff_secs));
            }
        }

        if error_code == character_error_codes::ENTER_GAME_CHARACTER_IN_WORLD {
            if !self.enter_retry.active {
                self.enter_retry.schedule();
                self.send_message(MessageKind::Warning, "Character still in world. Will retry entering automatically.");                self.send_status();            } else {
                self.send_message(MessageKind::Info, &format!("Character still in world. Next enter attempt in {}s.", self.enter_retry.backoff_secs));
            }
        }

        self.send_message(MessageKind::Error, &format!("Character Error: {}", msg));
        Ok(())
    }

    fn handle_soul_emote(&mut self, sender_name: String, text: String) -> Result<()> {
        let pretty_name = if let Some(stripped) = sender_name.strip_prefix('+') { stripped.to_string() } else { sender_name };
        self.send_message(MessageKind::Emote, &format!("{} {}", pretty_name, text));
        Ok(())
    }

    async fn select_character(&mut self, char_id: u32) -> Result<()> {
        self.character_id = Some(char_id);
        self.send_message(MessageKind::Info, &format!("Selected character ID: {:08X}", char_id));
        self.state = ClientState::EnteringWorld;

        let msg = GameMessage::CharacterEnterWorldRequest { char_id };
        self.session.send_message(&msg).await?;
        Ok(())
    }

    async fn send_character_enter_world(&mut self, char_id: u32) -> Result<()> {
        self.send_message(MessageKind::Info, &format!(
            "Sending EnterWorld for character {:08X}...",
            char_id
        ));
        let msg = GameMessage::CharacterEnterWorld {
            id: char_id,
            account: self.account_name.clone(),
        };

        self.session.send_message(&msg).await?;
        Ok(())
    }

    async fn send_login_complete(&mut self) -> Result<()> {
        log::debug!("Sending LoginComplete action...");
        let msg = GameMessage::GameAction {
            action: action_opcodes::LOGIN_COMPLETE,
            data: Vec::new(),
        };

        self.session.send_message(&msg).await?;
        Ok(())
    }

    async fn send_talk(&mut self, text: &str) -> Result<()> {
        let mut data = Vec::new();
        write_string16(&mut data, text);

        let msg = GameMessage::GameAction {
            action: action_opcodes::TALK,
            data,
        };

        self.session.send_message(&msg).await?;
        log::debug!("Sent: {}", text);
        Ok(())
    }
}
