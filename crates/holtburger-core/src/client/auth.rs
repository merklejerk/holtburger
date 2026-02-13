use crate::client::types::*;
use crate::client::Client;
use anyhow::Result;
use holtburger_common::Guid;
use holtburger_protocol::crypto::Isaac;
use holtburger_protocol::errors::CharacterError;
use holtburger_protocol::messages::transport::packet_flags;
use holtburger_protocol::messages::*;
use std::time::Duration;

impl Client {
    pub(super) async fn handle_character_list(&mut self, data: CharacterListData) -> Result<()> {
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

    pub(super) fn handle_character_error(&mut self, error_code: u32) -> Result<()> {
        if let Some(tx) = &self.event_tx {
            let error = CharacterError::from_repr(error_code).unwrap_or(CharacterError::None);
            let _ = tx.send(ClientEvent::CharacterError(error));
        }
        log::warn!("Character Error received: 0x{:08X}", error_code);
        Ok(())
    }

    pub(super) fn handle_boot_account(&mut self, data: BootAccountData) -> Result<()> {
        let reason = data.reason.unwrap_or_default();
        self.state = ClientState::Disconnected;
        self.send_status_event();

        if let Some(tx) = &self.event_tx {
            let _ = tx.send(ClientEvent::BootAccount(reason.clone()));
        }
        log::warn!("Boot Account received: {}", reason);
        Ok(())
    }

    pub(super) async fn select_character(&mut self, char_id: Guid) -> Result<()> {
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

    pub(super) async fn send_character_enter_world(&mut self, char_id: Guid) -> Result<()> {
        let msg = GameMessage::CharacterEnterWorld(Box::new(CharacterEnterWorldData {
            guid: char_id,
            account: self.account_name.clone(),
        }));
        self.session.send_message(&msg).await?;
        Ok(())
    }

    pub(super) async fn send_login_complete(&mut self) -> Result<()> {
        let msg = GameMessage::GameAction(Box::new(GameActionMessage {
            sequence: 0,
            action: GameAction::LoginComplete(Box::new(LoginCompleteData)),
        }));
        self.session.send_message(&msg).await?;
        Ok(())
    }

    pub(super) async fn send_login_request(&mut self, password: &str) -> Result<()> {
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

    pub(super) async fn handle_handshake_request(&mut self, crd: ConnectRequestData) -> Result<()> {
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

    pub(super) async fn handle_handshake_response(&mut self, cookie: u64, client_id: u16) -> Result<()> {
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
