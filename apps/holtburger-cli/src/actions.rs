use crate::state::ChatMessageKind;
use crate::types::ContextView;
use crate::ui::{Interaction, UiMessage};
use holtburger_common::Guid;
use holtburger_core::client::types::ClientCommand;
use holtburger_protocol::messages::combat::CombatMode;
use holtburger_protocol::messages::trade::actions::ItemProfileActionData;

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
    BeginInteraction(Interaction),
    ApplyItem(Guid, Guid), // item, target (e.g. healing kit, tool)
    QueryDebugInfo(Guid),
    CancelInteraction,
    CastSpell(u32, Option<Guid>), // spell_id, target (None for untargeted)
    SetCombatMode(CombatMode),
    ViewDetails(ContextView),
    Log(ChatMessageKind, String),
    Custom(Vec<UiMessage>),
}

impl AppAction {
    pub fn evaluate(&self) -> Vec<UiMessage> {
        match self {
            AppAction::Identify(guid) => {
                vec![UiMessage::SendCommands(vec![
                    ClientCommand::Identify(*guid),
                ])]
            }
            AppAction::Assess(guid) => {
                vec![
                    UiMessage::SendCommands(vec![
                        ClientCommand::Identify(*guid),
                    ]),
                    UiMessage::ChangeContextView(ContextView::Assess(*guid)),
                ]
            }
            AppAction::Use(guid) => {
                vec![UiMessage::SendCommands(vec![
                    ClientCommand::Use(*guid),
                ])]
            }
            AppAction::UseOn(item, target) => {
                vec![UiMessage::SendCommands(vec![
                    ClientCommand::UseWithTarget {
                        item: *item,
                        target: *target,
                    },
                ])]
            }
            AppAction::Approach(guid) => {
                vec![UiMessage::SendCommands(vec![
                    ClientCommand::MoveTo {
                        target: *guid,
                    },
                ])]
            }
            AppAction::PickUp(guid) => {
                vec![UiMessage::SendCommands(vec![
                    ClientCommand::MoveItem {
                        item: *guid,
                        container: Guid::NULL,
                        placement: 0,
                    },
                ])]
            }
            AppAction::Drop(guid) => {
                vec![UiMessage::SendCommands(vec![
                    ClientCommand::Drop(*guid),
                ])]
            }
            AppAction::Equip(guid) => {
                vec![UiMessage::SendCommands(vec![
                    ClientCommand::GetAndWield {
                        item: *guid,
                        slot: None,
                    },
                ])]
            }
            AppAction::Unequip(guid) => {
                vec![UiMessage::SendCommands(vec![
                    ClientCommand::MoveItem {
                        item: *guid,
                        container: Guid::NULL,
                        placement: 0,
                    },
                ])]
            }
            AppAction::TalkTo(guid) => {
                vec![UiMessage::SendCommands(vec![
                    ClientCommand::Use(*guid),
                ])]
            }
            AppAction::Open(guid) => {
                vec![UiMessage::SendCommands(vec![
                    ClientCommand::Use(*guid),
                ])]
            }
            AppAction::Close(guid) => {
                vec![UiMessage::SendCommands(vec![
                    ClientCommand::CloseContainer(*guid),
                ])]
            }
            AppAction::OpenTrade(guid) => {
                vec![UiMessage::SendCommands(vec![
                    ClientCommand::OpenTrade(*guid),
                ])]
            }
            AppAction::AddToTrade(guid) => {
                vec![UiMessage::SendCommands(vec![
                    ClientCommand::AddToTrade {
                        item: *guid,
                    },
                ])]
            }
            AppAction::SellToVendor(item, vendor) => {
                vec![UiMessage::SendCommands(vec![
                    ClientCommand::Sell {
                        vendor: *vendor,
                        items: vec![
                            ItemProfileActionData {
                                object_guid: *item,
                                amount: 1,
                            },
                        ],
                    },
                ])]
            }
            AppAction::MoveItem(item, container) => {
                vec![UiMessage::SendCommands(vec![
                    ClientCommand::MoveItem {
                        item: *item,
                        container: *container,
                        placement: 0,
                    },
                ])]
            }
            AppAction::StackItems(source, destination, amount) => {
                vec![UiMessage::SendCommands(vec![
                    ClientCommand::Stack {
                        source: *source,
                        destination: *destination,
                        amount: *amount,
                    },
                ])]
            }
            AppAction::SplitItem(item, container, amount) => {
                vec![UiMessage::SendCommands(vec![
                    ClientCommand::Split {
                        item: *item,
                        container: *container,
                        amount: *amount as i32,
                    },
                ])]
            }
            AppAction::BeginInteraction(interaction) => {
                vec![UiMessage::BeginInteraction(interaction.clone())]
            }
            AppAction::ApplyItem(item, target) => {
                vec![
                    UiMessage::SendCommands(vec![
                        ClientCommand::UseWithTarget {
                            item: *item,
                            target: *target,
                        },
                    ]),
                    UiMessage::CancelInteraction,
                ]
            }
            AppAction::QueryDebugInfo(guid) => {
                vec![
                    UiMessage::SendCommands(vec![
                        ClientCommand::QueryEntityDebugInfo(*guid),
                    ]),
                    UiMessage::RequestDebugContext(Some(*guid)),
                ]
            }
            AppAction::CancelInteraction => {
                vec![UiMessage::CancelInteraction]
            }
            AppAction::CastSpell(spell_id, target) => {
                let mut cmds = Vec::new();
                if let Some(target) = target {
                    cmds.push(ClientCommand::CastTargetedSpell {
                        spell_id: *spell_id,
                        target: *target,
                    });
                } else {
                    cmds.push(ClientCommand::CastUntargetedSpell {
                        spell_id: *spell_id,
                    });
                }
                vec![UiMessage::SendCommands(cmds)]
            }
            AppAction::SetCombatMode(mode) => {
                vec![UiMessage::SendCommands(vec![
                    ClientCommand::SetCombatMode(*mode),
                ])]
            }
            AppAction::ViewDetails(view) => {
                vec![UiMessage::ChangeContextView(view.clone())]
            }
            AppAction::Log(kind, message) => {
                vec![UiMessage::AddLog(kind.clone(), message.clone())]
            }
            AppAction::Custom(messages) => messages.clone(),
        }
    }
}
