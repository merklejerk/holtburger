use crate::state::ChatMessageKind;
use crate::types::ContextView;
use crate::ui::Interaction;
use holtburger_common::Guid;
use holtburger_core::client::types::ClientCommand;
use holtburger_protocol::messages::combat::CombatMode;

#[derive(Debug, Clone)]
pub enum AppAction {
    Identify(Guid),
    Assess(Guid),
    Use(Guid),
    UseOn(Guid, Guid),
    Approach(Guid),
    PickUp(Guid),
    Drop(Guid),
    Equip(Guid),
    Unequip(Guid),
    TalkTo(Guid),
    Open(Guid),
    Close(Guid),
    OpenTrade(Guid),
    AddToTrade(Guid),
    SellToVendor(Guid, Guid), // item, vendor
    MoveItem(Guid, Guid),
    StackItems(Guid, Guid, i32), // source, destination, amount
    SplitItem(Guid, Guid, u32),
    ApplyItem(Guid, Guid), // item, target (e.g. healing kit, tool)
    QueryDebugInfo(Guid),
    CastSpell(u32, Option<Guid>), // spell_id, target (None for untargeted)
    SetCombatMode(CombatMode),
    ViewDetails(ContextView),
    Log(ChatMessageKind, String),
    // UI Actions absorbed from UiMessage
    BeginInteraction(Interaction),
    ConfirmInteractionTarget(Guid),
    ConfirmInteractionSplit(Guid, u32),
    ConfirmInteractionText(String),
    CancelInteraction,
    SendCommands(Vec<ClientCommand>),
    ChangeContextView(ContextView),
    RequestDebugContext(Option<Guid>),
    ClearVendor,
    DisplayClientInfo,
    Sequence(Vec<AppAction>),
}

impl From<Vec<AppAction>> for AppAction {
    fn from(actions: Vec<AppAction>) -> Self {
        AppAction::Sequence(actions)
    }
}
