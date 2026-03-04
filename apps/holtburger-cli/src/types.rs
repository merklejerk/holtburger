use crate::pages::game::GameState;
use crate::pages::game::panels::dashboard::{assess, debug};
use crate::pages::game::{GameData, ViewState};
use crate::pages::selection::SelectionState;
use crossterm::event::{KeyEvent, MouseEvent};
use holtburger_common::Guid;
use holtburger_core::client::types::TargetSlot;
use holtburger_core::{ClientCommand, ClientViewEvent};
use holtburger_protocol::messages::combat::CombatMode;
use holtburger_protocol::messages::magic::Enchantment;
use holtburger_world::entity::Entity;
use holtburger_world::stats::{AttributeType, SkillType, VitalType};
use ratatui::Frame;
use ratatui::layout::Rect;
use ratatui::text::Line;
use std::borrow::Cow;
use std::time::Instant;

pub const SCROLL_STEP: usize = 3;

pub type VerbSet = Vec<Verb>;

#[derive(Debug, Clone)]
pub struct Verb {
    pub action: AppAction,
    pub shortcut: char,
    pub label: Cow<'static, str>,
}

impl Verb {
    pub fn new(
        action: impl Into<AppAction>,
        shortcut: char,
        label: impl Into<Cow<'static, str>>,
    ) -> Self {
        Self {
            action: action.into(),
            shortcut,
            label: label.into(),
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

#[derive(Debug, Clone, PartialEq)]
pub enum Modal {
    Retry { message: String, end_time: Instant },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Interaction {
    Moving { item_guid: Guid },
    Healing { item_guid: Guid },
    Targeting { target_guid: Guid },
    Combining { item_guid: Guid },
    Splitting { item_guid: Guid, max_amount: i32 },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum TradeFocus {
    #[default]
    Local,
    Partner,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ChatMessageKind {
    Info,
    System,
    Chat,
    Tell,
    Emote,
    Error,
    Warning,
    Debug,
}

#[derive(PartialEq, Eq, Hash, Debug, Clone, Copy, Default)]
pub enum DashboardTab {
    #[default]
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
    KeyPress(KeyEvent, u16), // key, width
    Mouse(MouseEvent),       // mouse
    ReceivedViewEvent(ClientViewEvent),
}

#[derive(Debug, Default)]
pub struct UpdateResult {
    pub commands: Vec<ClientCommand>,
    pub actions: Vec<AppAction>,
    pub needs_redraw: bool,
}

impl UpdateResult {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_redraw(mut self, needs_redraw: bool) -> Self {
        self.needs_redraw = needs_redraw;
        self
    }

    pub fn with_action(mut self, action: AppAction) -> Self {
        self.actions.push(action);
        self
    }

    pub fn redraw() -> Self {
        Self {
            commands: Vec::new(),
            actions: Vec::new(),
            needs_redraw: true,
        }
    }

    pub fn commands(commands: Vec<ClientCommand>) -> Self {
        Self {
            commands,
            actions: Vec::new(),
            needs_redraw: false,
        }
    }

    pub fn merge(&mut self, other: UpdateResult) {
        self.commands.extend(other.commands);
        self.actions.extend(other.actions);
        self.needs_redraw |= other.needs_redraw;
    }
}

pub enum Page {
    Selection(SelectionState),
    Game(Box<GameState>),
}

impl Page {
    pub fn handle_view_event(&mut self, event: ClientViewEvent) -> UpdateResult {
        match self {
            Page::Selection(s) => s.handle_view_event(event),
            Page::Game(g) => g.handle_view_event(event),
        }
    }

    pub fn handle_action(&mut self, action: AppAction) -> Option<UpdateResult> {
        match self {
            Page::Selection(s) => s.handle_action(action),
            Page::Game(g) => g.handle_action(action),
        }
    }

    pub fn handle_tick(&mut self, elapsed: f64) -> UpdateResult {
        match self {
            Page::Selection(s) => s.handle_tick(elapsed),
            Page::Game(g) => g.handle_tick(elapsed),
        }
    }
}

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
    MoveItem(Guid, Guid),
    StackItems(Guid, Guid, u32), // source, destination, amount
    SplitItem(Guid, Guid),
    UseWith(Guid, Guid), // item, target (e.g. healing kit, tool)
    QueryDebugInfo(Guid),
    CastSpell(u32, Option<Guid>), // spell_id, target (None for untargeted)
    SetCombatMode(CombatMode),
    ViewDetails(ContextView),
    Log(ChatMessageKind, String),
    BeginInteraction(Interaction),
    CancelInteraction,
    SendCommands(Vec<ClientCommand>),
    ChangeContextView(ContextView),
    RequestDebugContext(Option<Guid>),
    ClearVendor,
    DisplayClientInfo,
    Sequence(Vec<AppAction>),
    Pickup(Guid),
    Give(Guid, Guid, u32),          // item, recipient, amount
    BuyFromVendor(Guid, Guid, u32), // Vendor, item, amount
    SellToVendor(Guid, Guid, u32),  // Vendor, item, amount
    AcceptTrade,
    DeclineTrade,
    ResetTrade,
    ExitTrade,
}

impl From<Vec<AppAction>> for AppAction {
    fn from(actions: Vec<AppAction>) -> Self {
        AppAction::Sequence(actions)
    }
}

pub trait TabController {
    /// Renders the tab's content into the given area.
    fn render(&mut self, f: &mut Frame, data: &GameData, view: &ViewState, area: Rect);

    /// Returns the list of available verbs based on the tab's current internal selection.
    fn get_verbs(
        &self,
        _data: &GameData,
        _view: &ViewState,
        _interaction: &Option<Interaction>,
    ) -> Vec<Verb> {
        vec![]
    }

    /// Handles tab-specific input. Returns a list of commands to execute.
    fn handle_input(
        &mut self,
        key: KeyEvent,
        data: &GameData,
        view: &ViewState,
    ) -> Option<UpdateResult>;

    /// Returns the content to be displayed in the context panel for the current selection.
    fn get_context_panel_content(&self, data: &GameData, view: &ViewState) -> Vec<Line<'static>> {
        match view.context_view {
            ContextView::Assess(guid) => {
                if let Some(e) = data.entities.get(&guid) {
                    return assess::get_assess_info(e);
                }
                vec![]
            }
            ContextView::Custom => {
                let player_guid = data.player_guid;
                let target_guid = view.current_debug_guid.or(player_guid);

                if let Some(e) = target_guid.and_then(|guid| data.entities.get(&guid)) {
                    let guid = e.guid;
                    let target = CommandTarget::Entity(e, None);
                    let player_info = if Some(guid) == player_guid {
                        Some(debug::PlayerDebugInfo {
                            attributes: &data.attributes,
                            vitals: &data.vitals,
                            skills: &data.skills,
                            enchantments: &data.player_enchantments,
                        })
                    } else {
                        None
                    };

                    return debug::get_debug_info(
                        &target,
                        |id| {
                            data.entities
                                .get(&id)
                                .map(|e| e.name().to_string())
                                .or_else(|| {
                                    if Some(id) == player_guid {
                                        Some("You".to_string())
                                    } else {
                                        None
                                    }
                                })
                        },
                        Some(&data.spell_info),
                        player_info,
                    );
                }
                vec![]
            }
            ContextView::Spell(spell_id) => {
                let target = CommandTarget::Spell(spell_id);
                debug::get_debug_info(&target, |_| None, Some(&data.spell_info), None)
            }
            ContextView::Enchantment(enchant) => {
                let target = CommandTarget::Enchantment(enchant);
                debug::get_debug_info(&target, |_| None, Some(&data.spell_info), None)
            }
            _ => vec![],
        }
    }
}
