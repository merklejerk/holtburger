use crate::state::ChatMessageKind;
use crate::ui::{Interaction, UiMessage};
use crossterm::event::{KeyEvent, MouseEvent};
use holtburger_common::Guid;
use holtburger_core::client::types::{ClientCommand, TargetSlot};
use holtburger_core::ClientViewEvent;
use holtburger_protocol::messages::combat::CombatMode;
use holtburger_protocol::messages::magic::Enchantment;
use holtburger_protocol::messages::trade::actions::ItemProfileActionData;
use holtburger_world::entity::Entity;
use holtburger_world::stats::{AttributeType, SkillType, VitalType};
use ratatui::layout::Rect;
use std::borrow::Cow;
use std::time::Instant;

pub const SCROLL_STEP: usize = 3;

pub type VerbSet = Vec<Verb>;

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

#[derive(Debug, Clone)]
pub struct Verb {
    pub action: AppAction,
    pub shortcut: char,
    pub label: Cow<'static, str>,
}

impl Verb {
    pub fn new(
        action: AppAction,
        shortcut: char,
        label: impl Into<Cow<'static, str>>,
    ) -> Self {
        Self {
            action,
            shortcut,
            label: label.into(),
        }
    }

    pub fn execute(&self) -> Vec<UiMessage> {
        match &self.action {
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
                        container: Guid::NULL, // This might need more context if picking up to a specific container, but standard is NULL for inventory
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
                // To unequip in AC protocol, you move the item back to the main pack (player guid)
                vec![UiMessage::SendCommands(vec![
                    ClientCommand::MoveItem {
                        item: *guid,
                        container: Guid::NULL, // This will be resolved to player pack usually, or we'd need player_guid
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

    pub fn display_label(&self) -> String {
        let label = &self.label;
        let shortcut = self.shortcut;

        if shortcut == '\x1b' {
            return format!("[ESC] {}", label);
        }

        if shortcut == '\r' {
            return format!("[ENTER] {}", label);
        }

        let shortcut_lower = shortcut.to_ascii_lowercase();
        let shortcut_upper = shortcut.to_ascii_uppercase();

        if let Some(pos) = label.find([shortcut_lower, shortcut_upper]) {
            let (before, rest) = label.split_at(pos);
            let mut iter = rest.chars();
            let actual_char = iter.next().unwrap();
            let after = iter.as_str();
            format!("{}[{}]{}", before, actual_char, after)
        } else {
            format!("[{}] {}", shortcut_upper, label)
        }
    }
}

#[derive(Debug, Clone)]
pub enum StatType {
    Attribute(AttributeType),
    Vital(VitalType),
    Skill(SkillType),
}

#[derive(Debug, Clone)]
pub enum CommandTarget<'a> {
    Entity(&'a Entity, Option<TargetSlot>),
    VendorItem(&'a holtburger_world::vendor::CoreVendorItem),
    Enchantment(Enchantment),
    Stat(StatType, Option<u64>, Option<u32>),
    Spell(u32),
    None,
}

#[derive(Debug, Clone)]
pub enum Modal {
    Retry { message: String, end_time: Instant },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum TradeFocus {
    #[default]
    Local,
    Partner,
}

#[derive(PartialEq, Eq, Hash, Debug, Clone, Copy)]
pub enum DashboardTab {
    Nearby,
    Inventory,
    Character,
    Spells,
    Equip,
    Trade,
}

#[derive(PartialEq, Debug, Clone, Copy)]
pub enum FocusedPane {
    Chat,
    Context,
    Input,
    Dashboard,
    Dynamic,
}

#[derive(PartialEq, Debug, Clone, Copy)]
pub enum ContextView {
    Default,
    Custom,
    Assess(Guid),
    Spell(u32),
    Enchantment(Enchantment),
}

#[derive(Debug)]
pub enum AppEvent {
    Tick(f64),
    KeyPress(KeyEvent, u16, u16, Vec<Rect>, Rect), // key, width, height, main_chunks, dynamic_chunk
    Mouse(MouseEvent, Vec<Rect>, Vec<Rect>, Rect), // mouse, chunks, main_chunks, dynamic_chunk
    ReceivedViewEvent(ClientViewEvent),
}
