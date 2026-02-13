use crate::client::types::*;
use crate::session::Session;
use anyhow::Result;
use holtburger_common::Guid;
use holtburger_common::sequence::is_newer_u32;
use holtburger_protocol::crypto::Isaac;
use holtburger_protocol::errors::CharacterError;
use holtburger_protocol::messages::transport::packet_flags;
use holtburger_protocol::messages::*;
use std::time::Duration;
use tokio::sync::mpsc;

/// Finds a character Guid based on a preference string (either 1-based index or case-insensitive name).
fn find_preferred_character(
    characters: &[CharacterEntry],
    preference: &Option<String>,
) -> Option<Guid> {
    let pref = preference.as_ref()?;

    // Try numeric index
    if let Ok(idx) = pref.parse::<usize>()
        && idx > 0
        && idx <= characters.len()
    {
        return Some(characters[idx - 1].guid);
    }

    // Try name match
    characters
        .iter()
        .find(|c| c.name.to_lowercase() == pref.to_lowercase())
        .map(|c| c.guid)
}

pub(super) struct AuthState {
    pub(super) account_name: String,
    pub(super) characters: Vec<CharacterEntry>,
    pub(super) character_id: Option<Guid>,
    pub(super) character_preference: Option<String>,
    pub(super) connection_cookie: u64,
}

impl AuthState {
    pub(super) fn new(account_name: String, character_preference: Option<String>) -> Self {
        Self {
            account_name,
            characters: Vec::new(),
            character_id: None,
            character_preference,
            connection_cookie: 0,
        }
    }

    pub(super) async fn handle_character_list(
        &mut self,
        data: CharacterListData,
        session: &mut Session,
        client_state: &mut ClientState,
        event_tx: &Option<mpsc::UnboundedSender<ClientEvent>>,
    ) -> Result<()> {
        self.characters = data.characters.clone();

        log::info!("Character List for account: {}", data.account_name);
        for (i, c) in self.characters.iter().enumerate() {
            log::info!("  [{}] {} (0x{:08X})", i + 1, c.name, c.guid);
        }

        if let Some(id) = find_preferred_character(&self.characters, &self.character_preference) {
            return self
                .select_character(id, session, client_state, event_tx)
                .await;
        }

        *client_state = ClientState::CharacterSelection(self.characters.clone());
        if let Some(tx) = event_tx {
            let _ = tx.send(ClientEvent::StatusUpdate {
                state: client_state.clone(),
            });
            let _ = tx.send(ClientEvent::CharacterList(self.characters.clone()));
        }
        Ok(())
    }

    pub(super) fn handle_character_error(
        &mut self,
        error_code: u32,
        event_tx: &Option<mpsc::UnboundedSender<ClientEvent>>,
    ) -> Result<()> {
        if let Some(tx) = event_tx {
            let error = CharacterError::from_repr(error_code).unwrap_or(CharacterError::None);
            let _ = tx.send(ClientEvent::CharacterError(error));
        }
        log::warn!("Character Error received: 0x{:08X}", error_code);
        Ok(())
    }

    pub(super) fn handle_boot_account(
        &mut self,
        data: BootAccountData,
        client_state: &mut ClientState,
        event_tx: &Option<mpsc::UnboundedSender<ClientEvent>>,
    ) -> Result<()> {
        let reason = data.reason.unwrap_or_default();
        *client_state = ClientState::Disconnected;

        if let Some(tx) = event_tx {
            let _ = tx.send(ClientEvent::StatusUpdate {
                state: client_state.clone(),
            });
            let _ = tx.send(ClientEvent::BootAccount(reason.clone()));
        }
        log::warn!("Boot Account received: {}", reason);
        Ok(())
    }

    pub(super) async fn select_character(
        &mut self,
        char_id: Guid,
        session: &mut Session,
        client_state: &mut ClientState,
        event_tx: &Option<mpsc::UnboundedSender<ClientEvent>>,
    ) -> Result<()> {
        self.character_id = Some(char_id);
        *client_state = ClientState::EnteringWorld;
        if let Some(tx) = event_tx {
            let _ = tx.send(ClientEvent::StatusUpdate {
                state: client_state.clone(),
            });
        }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_find_preferred_character() {
        let chars = vec![
            CharacterEntry {
                guid: Guid(1),
                name: "Alice".to_string(),
                delete_time: 0,
            },
            CharacterEntry {
                guid: Guid(2),
                name: "Bob".to_string(),
                delete_time: 0,
            },
        ];

        // By index
        assert_eq!(
            find_preferred_character(&chars, &Some("1".to_string())),
            Some(Guid(1))
        );
        assert_eq!(
            find_preferred_character(&chars, &Some("2".to_string())),
            Some(Guid(2))
        );
        assert_eq!(
            find_preferred_character(&chars, &Some("3".to_string())),
            None
        );

        // By name
        assert_eq!(
            find_preferred_character(&chars, &Some("alice".to_string())),
            Some(Guid(1))
        );
        assert_eq!(
            find_preferred_character(&chars, &Some("BOB".to_string())),
            Some(Guid(2))
        );
        assert_eq!(
            find_preferred_character(&chars, &Some("Charlie".to_string())),
            None
        );
    }
}
