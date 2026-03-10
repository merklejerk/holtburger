use crate::pages::game::GameState;
use crate::pages::game::{GameData, ViewState};
use crate::pages::selection::SelectionState;
use crate::state::RenderContext;
use crossterm::event::{KeyCode, KeyEvent, MouseEvent};
use holtburger_common::Guid;
use holtburger_core::client::types::TargetSlot;
use holtburger_core::{ClientCommand, ClientViewEvent};
use holtburger_protocol::messages::combat::CombatMode;
use holtburger_protocol::messages::magic::Enchantment;
use holtburger_world::stats::{AttributeType, SkillType, VitalType};
use ratatui::Frame;
use ratatui::layout::Rect;
use std::borrow::Cow;
use std::time::Instant;

pub const SCROLL_STEP: usize = 3;

pub type VerbSet = Vec<Verb>;

#[derive(Debug, Clone)]
pub enum AppUiAction {
    SetDashboardActiveTab(DashboardTab),
    InventoryBeginSplitInput { item_guid: Guid, max_amount: u32 },
    BeginTabFilterInput { tab: DashboardTab },
}

#[derive(Debug, Clone)]
pub struct Verb {
    pub action: AppAction,
    pub shortcut: char,
    pub label: Cow<'static, str>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VerbInputKind {
    Quantity,
    Text,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VerbInputError {
    Empty,
    InvalidNumber,
    OutOfRange { value: u32, min: u32, max: u32 },
}

impl VerbInputError {
    pub fn message(&self) -> String {
        match self {
            VerbInputError::Empty => "Enter a value before submitting.".to_string(),
            VerbInputError::InvalidNumber => "Value must be a positive whole number.".to_string(),
            VerbInputError::OutOfRange { value, min, max } => {
                format!("{} is out of range. Expected {}-{}.", value, min, max)
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VerbInputEvent {
    Changed,
    SubmittedQuantity(u32),
    SubmittedText(String),
    Cancelled,
    Invalid(VerbInputError),
    Ignored,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerbInputState {
    pub kind: VerbInputKind,
    pub prompt: Cow<'static, str>,
    pub input: String,
    pub min: Option<u32>,
    pub max: Option<u32>,
}

impl VerbInputState {
    pub fn quantity(prompt: impl Into<Cow<'static, str>>, min: u32, max: u32) -> Self {
        Self {
            kind: VerbInputKind::Quantity,
            prompt: prompt.into(),
            input: String::new(),
            min: Some(min),
            max: Some(max),
        }
    }

    pub fn text(prompt: impl Into<Cow<'static, str>>) -> Self {
        Self {
            kind: VerbInputKind::Text,
            prompt: prompt.into(),
            input: String::new(),
            min: None,
            max: None,
        }
    }

    pub fn parse_value(&self) -> Result<u32, VerbInputError> {
        if self.input.is_empty() {
            return Err(VerbInputError::Empty);
        }

        let value = self
            .input
            .parse::<u32>()
            .map_err(|_| VerbInputError::InvalidNumber)?;

        let min = self.min.unwrap_or(0);
        let max = self.max.unwrap_or(u32::MAX);

        if value < min || value > max {
            return Err(VerbInputError::OutOfRange {
                value,
                min,
                max,
            });
        }

        Ok(value)
    }

    pub fn handle_key(&mut self, key: KeyEvent) -> VerbInputEvent {
        match key.code {
            KeyCode::Esc => VerbInputEvent::Cancelled,
            KeyCode::Enter => match self.kind {
                VerbInputKind::Quantity => match self.parse_value() {
                    Ok(value) => VerbInputEvent::SubmittedQuantity(value),
                    Err(err) => VerbInputEvent::Invalid(err),
                },
                VerbInputKind::Text => VerbInputEvent::SubmittedText(self.input.clone()),
            },
            KeyCode::Backspace => {
                if self.input.pop().is_some() {
                    VerbInputEvent::Changed
                } else {
                    VerbInputEvent::Ignored
                }
            }
            KeyCode::Char(c) => match self.kind {
                VerbInputKind::Quantity if c.is_ascii_digit() => {
                    self.input.push(c);
                    VerbInputEvent::Changed
                }
                VerbInputKind::Text if !c.is_control() => {
                    self.input.push(c);
                    VerbInputEvent::Changed
                }
                _ => VerbInputEvent::Ignored,
            },
            _ => VerbInputEvent::Ignored,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TabFilterState {
    pub raw_pattern: String,
    pub tokens: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FilterInputSession {
    pub input: VerbInputState,
    pub clears_active_filter_on_cancel: bool,
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InspectTarget {
    Entity(Guid),
    VendorItem(Guid),
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
    Salvaging,
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
    Assess(InspectTarget),
    Debug(InspectTarget),
    Spell(u32),
    Enchantment(Enchantment),
    DebugSpell(u32),
    DebugEnchantment(Enchantment),
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
    pub fn render(&mut self, f: &mut Frame, area: Rect, ctx: &RenderContext) {
        match self {
            Page::Selection(selection) => selection.render(f, area, ctx),
            Page::Game(game) => game.render(f, area, ctx),
        }
    }

    pub fn update_layout(&mut self, area: Rect) {
        match self {
            Page::Selection(_) => {}
            Page::Game(game) => game.update_layout(area),
        }
    }

    pub fn handle_input(&mut self, key: KeyEvent, width: u16) -> UpdateResult {
        match self {
            Page::Selection(selection) => selection.handle_input(key, width),
            Page::Game(game) => game.handle_input(key, width),
        }
    }

    pub fn handle_mouse(&mut self, mouse: MouseEvent) -> UpdateResult {
        match self {
            Page::Selection(selection) => selection.handle_mouse(mouse),
            Page::Game(game) => game.handle_mouse(mouse),
        }
    }

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
    TransitionToGame {
        guid: Guid,
        name: String,
    },
    Assess {
        target: InspectTarget,
    },
    Use {
        guid: Guid,
    },
    Approach {
        guid: Guid,
    },
    Drop {
        guid: Guid,
    },
    Equip {
        guid: Guid,
    },
    EquipInSlot {
        guid: Guid,
        slot: TargetSlot,
    },
    Unequip {
        guid: Guid,
    },
    TalkTo {
        guid: Guid,
    },
    Open {
        guid: Guid,
    },
    Close {
        guid: Guid,
    },
    OpenTrade {
        guid: Guid,
    },
    AddToTrade {
        guid: Guid,
    },
    MoveItem {
        item: Guid,
        container: Guid,
    },
    StackItems {
        source: Guid,
        destination: Guid,
        amount: u32,
    },
    SplitItem {
        item: Guid,
        container: Guid,
        amount: u32,
    },
    UseWith {
        item: Guid,
        target: Guid,
    },
    QueueSalvageItem {
        guid: Guid,
    },
    UnqueueSalvageItem {
        guid: Guid,
    },
    SalvageItems {
        ust_guid: Guid,
        item_guids: Vec<Guid>,
    },
    QueryDebugInfo {
        target: InspectTarget,
    },
    CastSpell {
        spell_id: u32,
        target: Option<Guid>,
    },
    SetCombatMode {
        mode: CombatMode,
    },
    LevelUpStat {
        stat: StatType,
        amount: u32,
    },
    TrainSkill {
        skill: SkillType,
        amount: u32,
    },
    ViewDetails {
        view: ContextView,
    },
    Log {
        kind: ChatMessageKind,
        message: String,
    },
    BeginInteraction {
        interaction: Interaction,
    },
    CancelInteraction,
    SendCommands {
        commands: Vec<ClientCommand>,
    },
    ChangeContextView {
        view: ContextView,
    },
    ClearVendor,
    DisplayClientInfo,
    Sequence {
        actions: Vec<AppAction>,
    },
    PickUp {
        item: Guid,
        container: Option<Guid>,
    },
    Give {
        item: Guid,
        recipient: Guid,
        amount: u32,
    },
    OpenShop {
        vendor: Guid,
    },
    BuyFromVendor {
        vendor: Guid,
        item: Guid,
        amount: u32,
    },
    SellToVendor {
        vendor: Guid,
        item: Guid,
        amount: u32,
    },
    AcceptTrade,
    DeclineTrade,
    ResetTrade,
    ExitTrade,
    UiAction {
        action: AppUiAction,
    },
}

impl From<Vec<AppAction>> for AppAction {
    fn from(actions: Vec<AppAction>) -> Self {
        AppAction::Sequence { actions }
    }
}

impl From<AppUiAction> for AppAction {
    fn from(action: AppUiAction) -> Self {
        AppAction::UiAction { action }
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

    fn handle_ui_action(
        &mut self,
        _action: &AppUiAction,
        _data: &GameData,
        _view: &ViewState,
    ) -> Option<UpdateResult> {
        None
    }

    fn footer_input(&self) -> Option<&VerbInputState> {
        None
    }

    fn footer_header(&self) -> Option<String> {
        None
    }

    fn handle_footer_input(
        &mut self,
        _key: KeyEvent,
        _data: &GameData,
        _view: &ViewState,
    ) -> Option<UpdateResult> {
        None
    }
}
