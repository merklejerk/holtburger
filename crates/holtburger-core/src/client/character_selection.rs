use super::types::CharacterManagementOperation;
use anyhow::Result;
use holtburger_common::Guid;
use holtburger_common::sequence::is_newer_u32;
use holtburger_protocol::errors::CharacterError;
use holtburger_protocol::messages::*;
use holtburger_session::Session;
use std::time::Duration;

pub(super) struct CharacterSelectionState {
    pub(super) account_name: String,
    pub(super) characters: Vec<CharacterEntry>,
    pub(super) character_id: Option<Guid>,
    pub(super) pending_character_operation: Option<CharacterManagementOperation>,
}

impl CharacterSelectionState {
    pub(super) fn new(account_name: String) -> Self {
        Self {
            account_name,
            characters: Vec::new(),
            character_id: None,
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
        mut request: CharacterCreateRequestData,
        session: &mut Session,
    ) -> Result<()> {
        self.pending_character_operation = Some(CharacterManagementOperation::Create);
        request.account_name = self.account_name.clone();
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
        account: String,
        session: &mut Session,
    ) -> Result<()> {
        let msg = GameMessage::CharacterEnterWorld(Box::new(CharacterEnterWorldData {
            guid: char_id,
            account,
        }));
        session.send_message(&msg).await?;
        Ok(())
    }
}
