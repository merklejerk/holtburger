use holtburger_common::Guid;
use crate::ui::Interaction;
use crate::ui::state::ChatMessageKind;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UiMessage {
    BeginInteraction(Interaction),
    ConfirmInteractionTarget(Guid),
    ConfirmInteractionSplit(Guid, u32),
    ConfirmInteractionText(String),
    CancelInteraction,
    AddLog(ChatMessageKind, String),
    // Other messages will be added as we phase out UIEffect...
}
