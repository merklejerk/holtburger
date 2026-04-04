use super::types::CharacterManagementOperation;
use anyhow::Result;
use holtburger_common::Guid;
use holtburger_common::sequence::is_newer_u32;
use holtburger_protocol::crypto::Isaac;
use holtburger_protocol::errors::CharacterError;
use holtburger_protocol::messages::transport::packet_flags;
use holtburger_protocol::messages::*;
use holtburger_session::Session;
use std::time::Duration;

pub(super) struct AuthState {
    pub(super) account_name: String,
    pub(super) characters: Vec<CharacterEntry>,
    pub(super) character_id: Option<Guid>,
    pub(super) connection_cookie: u64,
    pub(super) pending_character_operation: Option<CharacterManagementOperation>,
}

impl AuthState {
    pub(super) fn new(account_name: String) -> Self {
        Self {
            account_name,
            characters: Vec::new(),
            character_id: None,
            connection_cookie: 0,
            pending_character_operation: None,
        }
    }

    pub(super) fn take_pending_character_operation(
        &mut self,
    ) -> Option<CharacterManagementOperation> {
        self.pending_character_operation.take()
    }

    pub(super) fn handle_character_error(&mut self, error_code: u32) -> CharacterError {
        let error = CharacterError::from_repr(error_code).unwrap_or(CharacterError::None);
        log::warn!("Character Error received: 0x{:08X}", error_code);
        error
    }

    pub(super) fn handle_boot_account(&mut self, data: BootAccountData) -> String {
        self.pending_character_operation = None;
        let reason = data.reason.unwrap_or_default();
        log::warn!("Boot Account received: {}", reason);
        reason
    }

    pub(super) async fn create_character(
        &mut self,
        request: CharacterCreateRequestData,
        session: &mut Session,
    ) -> Result<()> {
        self.pending_character_operation = Some(CharacterManagementOperation::Create);
        session
            .send_message(&GameMessage::CharacterCreate(Box::new(request)))
            .await
    }

    pub(super) async fn delete_character(
        &mut self,
        slot: u32,
        session: &mut Session,
    ) -> Result<()> {
        self.pending_character_operation = Some(CharacterManagementOperation::Delete);
        session
            .send_message(&GameMessage::CharacterDeleteRequest(Box::new(
                CharacterDeleteRequestData {
                    account_name: self.account_name.clone(),
                    character_slot: slot,
                },
            )))
            .await
    }

    pub(super) async fn restore_character(
        &mut self,
        guid: Guid,
        session: &mut Session,
    ) -> Result<()> {
        self.pending_character_operation = Some(CharacterManagementOperation::Restore);
        session
            .send_message(&GameMessage::CharacterRestoreRequest(Box::new(
                CharacterRestoreRequestData { guid },
            )))
            .await
    }

    pub(super) async fn select_character(
        &mut self,
        char_id: Guid,
        session: &mut Session,
    ) -> Result<()> {
        self.character_id = Some(char_id);

        // Wait up to 1s for the server seq to advance (helps ensure our ACK reflects the latest server packet)
        let prev_seq = session.last_server_seq;
        let mut waited = 0u64;
        while !is_newer_u32(session.last_server_seq, prev_seq) && waited < 1000 {
            tokio::time::sleep(Duration::from_millis(50)).await;
            waited += 50;
        }

        let msg =
            GameMessage::CharacterEnterWorldRequest(Box::new(CharacterEnterWorldRequestData {
                guid: char_id,
            }));
        session.send_message(&msg).await?;
        Ok(())
    }

    pub(super) async fn send_character_enter_world(
        &mut self,
        char_id: Guid,
        session: &mut Session,
    ) -> Result<()> {
        let msg = GameMessage::CharacterEnterWorld(Box::new(CharacterEnterWorldData {
            guid: char_id,
            account: self.account_name.clone(),
        }));
        session.send_message(&msg).await?;
        Ok(())
    }

    pub(super) async fn send_login_request(
        &mut self,
        password: &str,
        session: &mut Session,
    ) -> Result<()> {
        log::debug!(
            ">>> Sending Login Request for account {}",
            self.account_name
        );
        let header = PacketHeader {
            flags: packet_flags::LOGIN_REQUEST,
            sequence: session.packet_sequence,
            ..Default::default()
        };
        let payload = build_login_payload(
            &self.account_name,
            password,
            session.packet_sequence,
            "1802",
        );
        session.packet_sequence += 1;
        session.send_packet(header, &payload).await?;
        Ok(())
    }

    pub(super) async fn handle_handshake_request(
        &mut self,
        crd: ConnectRequestData,
        session: &mut Session,
    ) -> Result<()> {
        log::debug!("<<< Handshake Request (Incoming): {:?}", crd);
        self.connection_cookie = crd.cookie;
        session.client_id = crd.client_id;
        session.isaac_c2s = Some(Isaac::new(crd.client_seed));
        session.isaac_s2c = Some(Isaac::new(crd.server_seed));

        let resp_header = PacketHeader {
            flags: packet_flags::CONNECT_RESPONSE,
            sequence: 1,
            id: 0,
            size: 8,
            ..Default::default()
        };
        session.packet_sequence = 2;

        let mut payload = Vec::new();
        payload.extend_from_slice(&self.connection_cookie.to_le_bytes());

        // Respond on port + 1
        let mut activation_addr = session.server_addr;
        activation_addr.set_port(session.server_addr.port() + 1);

        tokio::time::sleep(Duration::from_millis(
            holtburger_protocol::messages::transport::ACE_HANDSHAKE_RACE_DELAY_MS,
        ))
        .await;
        log::debug!(">>> Sending Handshake Response to {}", activation_addr);
        session
            .send_packet_to_addr(resp_header, &payload, activation_addr)
            .await?;
        Ok(())
    }

    pub(super) async fn handle_handshake_response(
        &mut self,
        cookie: u64,
        client_id: u16,
        session: &mut Session,
    ) -> Result<()> {
        log::debug!(
            "<<< Handshake Response: Cookie={:016X} NetID={:04X}",
            cookie,
            client_id
        );
        self.connection_cookie = cookie;
        session.client_id = client_id;

        Ok(())
    }
}
