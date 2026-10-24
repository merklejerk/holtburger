use super::types::{CharacterManagementOperation, CharacterManagementState};
use anyhow::{Result, ensure};
use holtburger_common::Guid;
use holtburger_common::sequence::is_newer_u32;
use holtburger_protocol::errors::CharacterError;
use holtburger_protocol::messages::*;
use holtburger_session::Session;
use std::time::Duration;

pub(super) struct CharacterSelectionState {
    pub(super) account_name: String,
    pub(super) characters: Vec<CharacterEntry>,
    /// Zero before the first roster; no character operation is admitted before selection.
    pub(super) max_slots: u32,
    pub(super) character_id: Option<Guid>,
    /// Guards the server-ready follow-up so a repeated edge cannot send entry twice.
    pub(super) enter_world_sent: bool,
    pub(super) management: CharacterManagementState,
}

impl CharacterSelectionState {
    pub(super) fn new(account_name: String) -> Self {
        Self {
            account_name,
            characters: Vec::new(),
            max_slots: 0,
            character_id: None,
            enter_world_sent: false,
            management: CharacterManagementState::Idle,
        }
    }

    /// Preserve an unresolved operation across unsolicited roster refreshes.
    pub(super) fn replace_roster(&mut self, data: &CharacterListData) {
        self.characters = data.characters.clone();
        self.max_slots = data.max_slots;
    }

    pub(super) fn ensure_available(&self) -> Result<()> {
        ensure!(
            !self.management.blocks_submission(),
            "Wait for the pending character-management operation; reconnect if its result is uncertain."
        );
        Ok(())
    }

    /// ACKs lack request IDs. Ignore duplicate creation identities before consuming new work.
    pub(super) fn accept_character_response(
        &mut self,
        response: &CharacterCreateResponseData,
    ) -> Option<CharacterManagementOperation> {
        let operation = self.management.pending_operation()?;
        if let CharacterManagementState::Restoring { guid } = &self.management
            && response.guid.is_some_and(|received| received != *guid)
        {
            return None;
        }
        if let CharacterManagementState::Creating { name } = &self.management
            && response
                .guid
                .is_some_and(|guid| self.characters.iter().any(|c| c.guid == guid))
            && response.name.as_ref() != Some(name)
        {
            // A roster may already contain this pending create after an unsolicited refresh.
            // ACE echoes the submitted name unchanged (CharacterHandler.SendCharacterCreateResponse).
            // A different known identity is a repeated old result, not the pending operation.
            return None;
        }
        match operation {
            CharacterManagementOperation::Create => {
                if response.response != CharacterGenerationVerificationResponse::Ok {
                    self.reject(
                        operation,
                        format!("Character creation rejected: {:?}.", response.response),
                    );
                } else if let (Some(guid), Some(name), Some(delete_time)) = (
                    response.guid,
                    response.name.as_ref().filter(|name| !name.is_empty()),
                    response.seconds_disabled,
                ) && guid != Guid::NULL
                {
                    if !self
                        .characters
                        .iter()
                        .any(|character| character.guid == guid)
                    {
                        self.characters.push(CharacterEntry {
                            guid,
                            name: name.clone(),
                            delete_time,
                        });
                    }
                    self.management = CharacterManagementState::Created {
                        guid,
                        name: name.clone(),
                    };
                } else {
                    self.management = CharacterManagementState::Uncertain {
                        message: "Creation was accepted without a complete character identity. Reconnect before retrying.".into(),
                    };
                }
            }
            CharacterManagementOperation::Restore => {
                if response.response == CharacterGenerationVerificationResponse::Ok {
                    if let (Some(guid), Some(name), Some(delete_time)) = (
                        response.guid,
                        response.name.as_ref().filter(|name| !name.is_empty()),
                        response.seconds_disabled,
                    ) && let Some(character) =
                        self.characters.iter_mut().find(|c| c.guid == guid)
                    {
                        character.delete_time = delete_time;
                        character.name = name.clone();
                        self.management = CharacterManagementState::Idle;
                    } else {
                        self.management = CharacterManagementState::Uncertain {
                            message: "Restoration was accepted without an available roster identity. Reconnect before retrying.".into(),
                        };
                    }
                } else {
                    self.reject(
                        operation,
                        format!("Character restoration rejected: {:?}.", response.response),
                    );
                }
            }
            CharacterManagementOperation::Delete => return None,
        }
        Some(operation)
    }

    pub(super) fn reject(&mut self, operation: CharacterManagementOperation, message: String) {
        self.management = CharacterManagementState::Rejected { operation, message };
    }

    pub(super) fn handle_character_error(&mut self, error_code: u32) -> CharacterError {
        let error = CharacterError::from_repr(error_code).unwrap_or(CharacterError::None);
        log::warn!("Character Error received: 0x{:08X}", error_code);
        error
    }

    pub(super) fn handle_boot_account(&mut self, data: BootAccountData) -> String {
        let reason = data.reason.unwrap_or_default();
        log::warn!("Boot Account received: {}", reason);
        reason
    }

    pub(super) async fn create_character(
        &mut self,
        mut request: CharacterCreateRequestData,
        session: &mut Session,
    ) -> Result<()> {
        // ACE appends to Session.Characters. Deleted/pending entries are not holes, and
        // CharacterDelete addresses this ordinal, not a frontend-sorted list position.
        request.character_slot = self.characters.len() as u32;
        self.management = CharacterManagementState::Creating {
            name: request.name.clone(),
        };
        request.account_name = self.account_name.clone();
        let result = session
            .send_message(&GameMessage::CharacterCreate(Box::new(request)))
            .await;
        if let Err(error) = &result {
            self.reject(
                CharacterManagementOperation::Create,
                format!("Could not send character creation: {error}"),
            );
        }
        result
    }

    pub(super) async fn delete_character(
        &mut self,
        slot: u32,
        session: &mut Session,
    ) -> Result<()> {
        self.management = CharacterManagementState::Deleting;
        let result = session
            .send_message(&GameMessage::CharacterDeleteRequest(Box::new(
                CharacterDeleteRequestData {
                    account_name: self.account_name.clone(),
                    character_slot: slot,
                },
            )))
            .await;
        if let Err(error) = &result {
            self.reject(
                CharacterManagementOperation::Delete,
                format!("Could not send character deletion: {error}"),
            );
        }
        result
    }

    pub(super) async fn restore_character(
        &mut self,
        guid: Guid,
        session: &mut Session,
    ) -> Result<()> {
        self.management = CharacterManagementState::Restoring { guid };
        let result = session
            .send_message(&GameMessage::CharacterRestoreRequest(Box::new(
                CharacterRestoreRequestData { guid },
            )))
            .await;
        if let Err(error) = &result {
            self.reject(
                CharacterManagementOperation::Restore,
                format!("Could not send character restoration: {error}"),
            );
        }
        result
    }

    pub(super) async fn select_character(
        &mut self,
        char_id: Guid,
        session: &mut Session,
    ) -> Result<()> {
        self.character_id = Some(char_id);
        self.enter_world_sent = false;

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

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(guid: Guid, name: &str) -> CharacterEntry {
        CharacterEntry {
            guid,
            name: name.into(),
            delete_time: 0,
        }
    }

    fn roster(characters: Vec<CharacterEntry>) -> CharacterListData {
        CharacterListData {
            characters,
            max_slots: 11,
            account_name: "account".into(),
            use_turbine_chat: false,
            has_tod_expansion: true,
        }
    }

    fn success(guid: Guid, name: &str) -> CharacterCreateResponseData {
        CharacterCreateResponseData {
            response: CharacterGenerationVerificationResponse::Ok,
            guid: Some(guid),
            name: Some(name.into()),
            seconds_disabled: Some(0),
        }
    }

    #[test]
    fn creation_retains_capacity_and_appends_in_server_order_once() {
        let mut state = CharacterSelectionState::new("account".into());
        let first = Guid(0x5000_0001);
        let second = Guid(0x5000_0002);
        let data = roster(vec![entry(first, "Zed")]);
        state.replace_roster(&data);
        state.management = CharacterManagementState::Creating { name: "Amy".into() };
        let response = success(second, "Amy");
        assert_eq!(
            state.accept_character_response(&response),
            Some(CharacterManagementOperation::Create)
        );
        assert_eq!(state.max_slots, data.max_slots);
        assert_eq!(
            state.characters.iter().map(|c| c.guid).collect::<Vec<_>>(),
            vec![first, second]
        );
        assert_eq!(
            state.management,
            CharacterManagementState::Created {
                guid: second,
                name: "Amy".into()
            }
        );
        assert_eq!(state.accept_character_response(&response), None);
        assert_eq!(state.characters.len(), 2);
    }

    #[test]
    fn refresh_before_create_reply_preserves_pending_and_does_not_duplicate_character() {
        let mut state = CharacterSelectionState::new("account".into());
        let guid = Guid(0x5000_0001);
        state.management = CharacterManagementState::Creating { name: "Amy".into() };
        state.replace_roster(&roster(vec![entry(guid, "Amy")]));
        assert!(state.management.blocks_submission());
        assert_eq!(
            state.accept_character_response(&success(guid, "Amy")),
            Some(CharacterManagementOperation::Create)
        );
        assert_eq!(state.characters.len(), 1);
        assert!(!state.management.blocks_submission());
    }

    #[test]
    fn repeated_old_success_cannot_finish_a_different_pending_create() {
        let mut state = CharacterSelectionState::new("account".into());
        let guid = Guid(0x5000_0001);
        state.replace_roster(&roster(vec![entry(guid, "Amy")]));
        let pending = CharacterManagementState::Creating { name: "Zed".into() };
        state.management = pending.clone();
        assert_eq!(state.accept_character_response(&success(guid, "Amy")), None);
        assert_eq!(state.management, pending);
    }

    #[test]
    fn restoration_applies_confirmed_metadata_only_to_the_pending_identity() {
        let mut state = CharacterSelectionState::new("account".into());
        let guid = Guid(0x5000_0001);
        let mut character = entry(guid, "Old Name");
        character.delete_time = 123;
        state.replace_roster(&roster(vec![character]));
        let pending = CharacterManagementState::Restoring { guid };
        state.management = pending.clone();
        assert_eq!(
            state.accept_character_response(&success(Guid(0x5000_0002), "Other")),
            None
        );
        assert_eq!(state.management, pending);
        assert_eq!(
            state.accept_character_response(&success(guid, "New Name")),
            Some(CharacterManagementOperation::Restore)
        );
        assert_eq!(state.characters[0].name, "New Name");
        assert_eq!(state.characters[0].delete_time, 0);
        assert_eq!(state.management, CharacterManagementState::Idle);
    }

    #[test]
    fn rejection_preserves_roster_and_malformed_success_blocks_retry() {
        let mut state = CharacterSelectionState::new("account".into());
        state.management = CharacterManagementState::Creating { name: "Amy".into() };
        let mut response = success(Guid(0x5000_0001), "Amy");
        response.response = CharacterGenerationVerificationResponse::NameInUse;
        state.accept_character_response(&response);
        assert!(state.characters.is_empty());
        assert!(matches!(
            state.management,
            CharacterManagementState::Rejected { .. }
        ));
        assert!(state.ensure_available().is_ok());

        state.management = CharacterManagementState::Creating { name: "Amy".into() };
        response.response = CharacterGenerationVerificationResponse::Ok;
        response.guid = None;
        state.accept_character_response(&response);
        assert!(state.characters.is_empty());
        assert!(matches!(
            state.management,
            CharacterManagementState::Uncertain { .. }
        ));
        assert!(state.ensure_available().is_err());
    }
}
