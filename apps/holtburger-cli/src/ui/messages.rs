use crate::ui::Interaction;
use crate::ui::state::ChatMessageKind;
use holtburger_common::Guid;
use holtburger_core::client::types::ClientCommand;

#[derive(Debug, Clone)]
pub enum UiMessage {
    BeginInteraction(Interaction),
    ConfirmInteractionTarget(Guid),
    ConfirmInteractionSplit(Guid, u32),
    ConfirmInteractionText(String),
    CancelInteraction,
    AddLog(ChatMessageKind, String),
    SendCommands(Vec<ClientCommand>),
    ChangeContextView(crate::ui::ContextView),
    RequestDebugContext(Option<Guid>),
    ClearVendor,
    DisplayClientInfo,
}
