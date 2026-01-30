use crate::crypto::Isaac;
use crate::protocol::*;
use crate::session::Session;
use anyhow::Result;
use byteorder::{ByteOrder, LittleEndian};
use std::net::SocketAddr;

enum ClientState {
    Connected,
    CharacterSelection(Vec<(u32, String)>),
    EnteringWorld,
    InWorld,
}

use tokio::sync::mpsc;

pub enum ClientEvent {
    Message(String),
    CharacterList(Vec<(u32, String)>),
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
                        self.select_character(char_id).await
                    }
                    _ => Ok(()),
                }
            }
            ClientCommand::Talk(text) => {
                if matches!(self.state, ClientState::InWorld) {
                    return self.send_talk(&text).await;
                }
                Ok(())
            }
            ClientCommand::Quit => {
                self.disconnect().await?;
                Err(anyhow::anyhow!("Graceful disconnect"))
            }
        }
    }

    pub async fn disconnect(&mut self) -> Result<()> {
        self.log("Sending disconnect signal to server...");
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

    fn log(&self, msg: &str) {
        log::info!("{}", msg);
        if let Some(tx) = &self.event_tx {
            let _ = tx.send(ClientEvent::Message(msg.to_string()));
        }
    }

    pub async fn run(&mut self, password: &str) -> Result<()> {
        self.log(&format!("Connecting to {}...", self.session.server_addr));
        self.send_login_request(password).await?;

        let mut buf = [0u8; MAX_PACKET_SIZE];

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
                    let ack_seq = LittleEndian::read_u32(&data[offset..offset + 4]);
                    log::debug!("<<< Received ACK for Seq:{}", ack_seq);
                    offset += 4;
                }

                if header.flags & flags::TIME_SYNC != 0 {
                    offset += 8;
                }

            if header.flags & flags::ECHO_REQUEST != 0 {
                offset += 4;
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
        self.log(&format!("Sent LoginRequest (Payload: {})", payload.len()));
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

        self.log(&format!(
            "Sending ConnectResponse to {} (Activation)...",
            activation_addr
        ));

        // Note: We use send_packet_to_addr to hit the activation port specifically.
        // We do NOT update self.session.server_addr, as game messages return to the login port.
        self.session
            .send_packet_to_addr(resp_header, &payload, activation_addr)
            .await?;

        // packet_sequence already set to 2 at start of this function
        self.log("Sent ConnectResponse. Connection established.");

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
            GameMessage::CharacterList { characters } => {
                self.log(&format!(
                    "Character List received ({} characters)",
                    characters.len()
                ));

                // If we have a preference, try searching for it
                if let Some(pref) = &self.character_preference {
                    match pref.parse::<usize>() {
                        Ok(idx) if (1..=characters.len()).contains(&idx) => {
                            let char_id = characters[idx - 1].0;
                            let _ = self.select_character(char_id).await;
                            return Ok(());
                        }
                        _ => {}
                    }
                    if let Some(c) = characters
                        .iter()
                        .find(|(_, name)| name.to_lowercase() == pref.to_lowercase())
                    {
                        let _ = self.select_character(c.0).await;
                        return Ok(());
                    }
                }
                
                self.state = ClientState::CharacterSelection(characters.clone());
                if let Some(tx) = &self.event_tx {
                    let _ = tx.send(ClientEvent::CharacterList(characters));
                }
            }
            GameMessage::CharacterEnterWorldServerReady => {
                self.log("Server ready for world entry. Sending CharacterEnterWorld...");
                if let Some(char_id) = self.character_id {
                    self.send_character_enter_world(char_id).await?;
                    self.state = ClientState::EnteringWorld;
                }
            }
            GameMessage::PlayerCreate { player_id } => {
                self.log(&format!("You have been created with GUID: {:08X}", player_id));
                self.send_login_complete().await?;
            }
            GameMessage::ObjectCreate { guid } => {
                self.log(&format!("Object Created: {:08X}", guid));
            }
            GameMessage::ObjectDelete { guid } => {
                self.log(&format!("Object Deleted: {:08X}", guid));
            }
            GameMessage::ObjectStatUpdate { guid, .. } => {
                self.log(&format!("Object Stat Update: {:08X}", guid));
            }
            GameMessage::PlayEffect { guid } => {
                self.log(&format!("Play Effect on: {:08X}", guid));
            }
            GameMessage::GameEvent {
                event_type,
                guid,
                sequence,
                ..
            } => {
                let type_name = match event_type {
                    game_event_opcodes::PLAYER_DESCRIPTION => "PlayerDescription",
                    game_event_opcodes::CHANNEL_BROADCAST => "ChannelBroadcast",
                    game_event_opcodes::VIEW_CONTENTS => "ViewContents",
                    game_event_opcodes::START_GAME => "StartGame",
                    game_event_opcodes::WEENIE_ERROR => "WeenieError",
                    game_event_opcodes::CHARACTER_TITLE => "CharacterTitle",
                    game_event_opcodes::FRIENDS_LIST_UPDATE => "FriendsListUpdate",
                    game_event_opcodes::FELLOWSHIP_UPDATE_FELLOW => "FellowshipUpdateFellow",
                    game_event_opcodes::TELL => "Tell",
                    _ => "UnknownEvent",
                };
                self.log(&format!(
                    "GameEvent: {} (Type: 0x{:04X}, GUID: {:016X}, Seq: {})",
                    type_name, event_type, guid, sequence
                ));
            }
            GameMessage::GameAction { action, .. } => {
                let action_name = match action {
                    action_opcodes::LOGIN_COMPLETE => "LoginComplete",
                    _ => "UnknownAction",
                };

                if action == action_opcodes::LOGIN_COMPLETE {
                    self.log("Login complete! You are now in the world.");
                    self.log("Type anything to chat, or /quit to exit.");
                    self.state = ClientState::InWorld;
                }
                self.log(&format!("GameAction: {} (Type: 0x{:04X})", action_name, action));
            }
            GameMessage::ServerMessage { message } => {
                self.log(&format!("[System] {}", message));
            }
            GameMessage::CharacterError { error_code } => {
                let msg = match error_code {
                    character_error_codes::ACCOUNT_ALREADY_LOGGED_ON => {
                        "Account already logged on (Logon Error)".to_string()
                    }
                    character_error_codes::CHARACTER_ALREADY_LOGGED_ON => {
                        "Character already logged on (Character in World)".to_string()
                    }
                    character_error_codes::CHARACTER_LIMIT_REACHED => {
                        "Character limit reached".to_string()
                    }
                    _ => format!("0x{:08X}", error_code),
                };
                self.log(&format!("Character Error: {}", msg));
            }
            GameMessage::DddInterrogation => {
                self.log("Received DDD Interrogation. Sending response (English).");
                let resp = GameMessage::DddInterrogationResponse { language: 1 };
                self.session.send_message(&resp).await?;
            }
            GameMessage::ServerName {
                name, online_count, ..
            } => {
                self.log(&format!(
                    "Connected to server: {} ({} players online)",
                    name, online_count
                ));
            }
            GameMessage::HearSpeech { message, sender } => {
                self.log(&format!("{}: {}", sender, message));
            }
            GameMessage::Unknown { opcode, data } => {
                self.log(&format!(
                    "Unknown message received: 0x{:08X} (Size: {}) Data: {:02X?}",
                    opcode,
                    data.len(),
                    data
                ));
            }
            _ => {}
        }
        Ok(())
    }

    async fn select_character(&mut self, char_id: u32) -> Result<()> {
        self.character_id = Some(char_id);
        self.log(&format!("Selected character ID: {:08X}", char_id));

        let msg = GameMessage::CharacterEnterWorldRequest { char_id };
        self.session.send_message(&msg).await?;
        Ok(())
    }

    async fn send_character_enter_world(&mut self, char_id: u32) -> Result<()> {
        self.log(&format!(
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
        self.log("Sending LoginComplete action...");
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
        self.log(&format!("Sent: {}", text));
        Ok(())
    }
}
