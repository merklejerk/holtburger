use crate::components::text_input::SingleLineTextInput;
use crate::pages::game::GameState;
use crate::pages::game::{GameData, ViewState};
use crate::pages::selection::SelectionState;
use crate::state::{EventContext, RenderContext, TickContext};
use crossterm::event::{KeyCode, KeyEvent, MouseEvent};
use holtburger_common::Guid;
use holtburger_core::client::types::TargetSlot;
use holtburger_core::{ClientCommand, ClientViewEvent};
use holtburger_protocol::messages::magic::Enchantment;
use holtburger_world::stats::{AttributeType, SkillType, VitalType};
use ratatui::Frame;
use ratatui::layout::Rect;
use std::borrow::Cow;

pub const SCROLL_STEP: usize = 3;

pub type VerbSet = Vec<Verb>;

#[derive(Debug, Clone)]
pub enum AppUiAction {
    SetDashboardActiveTab(DashboardTab),
    ChangeContextView {
        view: ContextView,
    },
    SetFocusedPane {
        pane: FocusedPane,
        remember_previous: bool,
    },
    CycleFocusedPane {
        delta: i8,
    },
    EnterInputMode,
    ExitInputMode,
    FinishInputCommandSubmission {
        command: String,
    },
    InventoryBeginSplitInput {
        item_guid: Guid,
        max_amount: u32,
    },
    BeginTabFilterInput {
        tab: DashboardTab,
    },
    OpenCharacterCreationScreen,
    OpenCharacterDashboard,
    OpenDeleteCharacterConfirmation,
    CancelDeleteCharacterConfirmation,
    OpenUnswearConfirmation {
        target: Guid,
    },
    ConfirmLocalConfirmation,
    DismissLocalConfirmation,
    RaiseSelectedCharacterCreationSkill,
    LowerSelectedCharacterCreationSkill,
}

#[derive(Debug, Clone)]
pub struct Verb {
    pub action: AppAction,
    pub shortcut: char,
    pub label: Cow<'static, str>,
    pub footer_visibility: FooterVerbVisibility,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum FooterVerbVisibility {
    #[default]
    Visible,
    Hidden,
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
    pub input: SingleLineTextInput,
    pub min: Option<u32>,
    pub max: Option<u32>,
}

impl VerbInputState {
    pub fn quantity(prompt: impl Into<Cow<'static, str>>, min: u32, max: u32) -> Self {
        Self {
            kind: VerbInputKind::Quantity,
            prompt: prompt.into(),
            input: SingleLineTextInput::default(),
            min: Some(min),
            max: Some(max),
        }
    }

    pub fn text(prompt: impl Into<Cow<'static, str>>) -> Self {
        Self {
            kind: VerbInputKind::Text,
            prompt: prompt.into(),
            input: SingleLineTextInput::default(),
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
            .text()
            .parse::<u32>()
            .map_err(|_| VerbInputError::InvalidNumber)?;

        let min = self.min.unwrap_or(0);
        let max = self.max.unwrap_or(u32::MAX);

        if value < min || value > max {
            return Err(VerbInputError::OutOfRange { value, min, max });
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
                VerbInputKind::Text => VerbInputEvent::SubmittedText(self.input.text().to_string()),
            },
            _ => {
                let changed = match self.kind {
                    VerbInputKind::Quantity => self.input.apply_key_if(key, |c| c.is_ascii_digit()),
                    VerbInputKind::Text => self.input.apply_key(key),
                };

                if changed {
                    VerbInputEvent::Changed
                } else {
                    VerbInputEvent::Ignored
                }
            }
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
            footer_visibility: FooterVerbVisibility::Visible,
        }
    }

    pub fn with_footer_visibility(mut self, footer_visibility: FooterVerbVisibility) -> Self {
        self.footer_visibility = footer_visibility;
        self
    }

    pub fn is_visible_in_footer(&self) -> bool {
        self.footer_visibility == FooterVerbVisibility::Visible
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Interaction {
    Moving { item_guid: Guid },
    Targeting { target_guid: Guid },
    Approaching { target_guid: Guid },
    Following { target_guid: Guid },
    Combining { item_guid: Guid },
    Salvaging,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum TradeFocus {
    #[default]
    Local,
    Partner,
}

bitflags::bitflags! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
    pub struct ChatMessageTags: u32 {
        const CHAT = 1 << 0;
        const COMBAT = 1 << 1;
        const GUILD = 1 << 2;
        const PARTY = 1 << 3;
        const STATUS = 1 << 4;
        const SYSTEM = 1 << 5;
        const TELL = 1 << 6;
        const EMOTE = 1 << 7;
        const TRADE = 1 << 8;
        const HELP = 1 << 9;
        const DEBUG = 1 << 10;
        const INFO = 1 << 11;
        const WARNING = 1 << 12;
        const ERROR = 1 << 13;
        const SOCIETY = 1 << 14;
        const MAGIC = 1 << 15;
    }
}

impl ChatMessageTags {
    pub fn chat() -> Self {
        Self::CHAT
    }

    pub fn with(self, tags: Self) -> Self {
        self | tags
    }

    pub fn tell() -> Self {
        Self::CHAT | Self::TELL
    }

    pub fn emote() -> Self {
        Self::CHAT | Self::EMOTE
    }

    pub fn info() -> Self {
        Self::STATUS | Self::INFO
    }

    pub fn system() -> Self {
        Self::STATUS | Self::SYSTEM
    }

    pub fn error() -> Self {
        Self::STATUS | Self::SYSTEM | Self::ERROR
    }

    pub fn warning() -> Self {
        Self::STATUS | Self::SYSTEM | Self::WARNING
    }

    pub fn debug() -> Self {
        Self::STATUS | Self::SYSTEM | Self::DEBUG
    }

    pub fn combat(self) -> Self {
        self | Self::COMBAT
    }

    pub fn party(self) -> Self {
        self | Self::PARTY
    }

    pub fn guild(self) -> Self {
        self | Self::GUILD
    }

    pub fn trade(self) -> Self {
        self | Self::TRADE
    }

    pub fn help(self) -> Self {
        self | Self::HELP
    }

    pub fn society(self) -> Self {
        self | Self::SOCIETY
    }

    pub fn magic(self) -> Self {
        self | Self::MAGIC
    }
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
    Party,
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
    Book(Guid),
    Spell(u32),
    Enchantment(Enchantment),
    DebugSpell(u32),
    DebugEnchantment(Enchantment),
    Logopolis,
}

#[derive(Debug)]
pub enum AppEvent {
    Tick(f64),
    KeyPress(KeyEvent), // key
    Mouse(MouseEvent),  // mouse
    ReceivedViewEvent(ClientViewEvent),
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum RedrawPriority {
    #[default]
    None,
    Motion,
    Immediate,
}

impl RedrawPriority {
    pub fn requested(self) -> bool {
        !matches!(self, Self::None)
    }
}

#[derive(Debug, Default)]
pub struct UpdateResult {
    pub commands: Vec<ClientCommand>,
    pub actions: Vec<AppAction>,
    pub redraw_priority: RedrawPriority,
}

impl UpdateResult {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_redraw(mut self, requested: bool) -> Self {
        self.redraw_priority = if requested {
            RedrawPriority::Immediate
        } else {
            RedrawPriority::None
        };
        self
    }

    pub fn with_redraw_priority(mut self, priority: RedrawPriority) -> Self {
        self.redraw_priority = priority;
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
            redraw_priority: RedrawPriority::Immediate,
        }
    }

    pub fn motion_redraw() -> Self {
        Self {
            commands: Vec::new(),
            actions: Vec::new(),
            redraw_priority: RedrawPriority::Motion,
        }
    }

    pub fn commands(commands: Vec<ClientCommand>) -> Self {
        Self {
            commands,
            actions: Vec::new(),
            redraw_priority: RedrawPriority::None,
        }
    }

    pub fn request_redraw(&mut self, priority: RedrawPriority) {
        self.redraw_priority = std::cmp::max(self.redraw_priority, priority);
    }

    pub fn effective_redraw_priority(&self) -> RedrawPriority {
        self.redraw_priority
    }

    pub fn redraw_requested(&self) -> bool {
        self.redraw_priority.requested()
    }

    pub fn merge(&mut self, other: UpdateResult) {
        let other_redraw = other.effective_redraw_priority();
        self.commands.extend(other.commands);
        self.actions.extend(other.actions);
        self.request_redraw(other_redraw);
    }
}

pub enum Page {
    Selection(Box<SelectionState>),
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

    pub fn handle_input(&mut self, key: KeyEvent) -> UpdateResult {
        match self {
            Page::Selection(selection) => selection.handle_input(key),
            Page::Game(game) => game.handle_input(key),
        }
    }

    pub fn handle_mouse(&mut self, mouse: MouseEvent) -> UpdateResult {
        match self {
            Page::Selection(selection) => selection.handle_mouse(mouse),
            Page::Game(game) => game.handle_mouse(mouse),
        }
    }

    pub fn handle_view_event(
        &mut self,
        event: ClientViewEvent,
        ctx: &EventContext,
    ) -> UpdateResult {
        match self {
            Page::Selection(s) => s.handle_view_event_with_context(event, ctx),
            Page::Game(g) => g.handle_view_event_with_context(event, ctx),
        }
    }

    pub fn handle_action(&mut self, action: AppAction) -> Option<UpdateResult> {
        match self {
            Page::Selection(s) => s.handle_action(action),
            Page::Game(g) => g.handle_action(action),
        }
    }

    pub fn handle_tick(&mut self, elapsed: f64, ctx: &TickContext) -> UpdateResult {
        match self {
            Page::Selection(s) => s.handle_tick_with_context(elapsed, ctx),
            Page::Game(g) => g.handle_tick_with_context(elapsed, ctx),
        }
    }
}

#[derive(Debug, Clone)]
pub enum AppAction {
    Nothing,
    TransitionToGame {
        guid: Guid,
        name: String,
        account: String,
    },
    SendCharacterEnterWorld,
    EnterSelectedCharacter,
    RestoreSelectedCharacter,
    SubmitCharacterCreation,
    DeleteCharacterAtSlot {
        slot: u32,
    },
    Assess {
        target: InspectTarget,
    },
    Use {
        guid: Guid,
    },
    Emote {
        message: String,
    },
    SoulEmote {
        token: String,
    },
    Read {
        guid: Guid,
    },
    Approach {
        guid: Guid,
    },
    Follow {
        guid: Guid,
    },
    Attack {
        guid: Guid,
    },
    SnapHeading {
        heading: f32,
    },
    Scoot {
        distance_m: f32,
    },
    Drop {
        guid: Guid,
    },
    // TODO: Unused.
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
    // TODO: Replace with Use
    TalkTo {
        guid: Guid,
    },
    InviteToParty {
        target: Guid,
    },
    UninviteFromParty {
        target: Guid,
    },
    SwearAllegiance {
        target: Guid,
    },
    Unswear {
        target: Guid,
    },
    // TODO: Replace with Use
    Open {
        guid: Guid,
    },
    // TODO: Rename to CloseContainer
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
    // TOODO: Move to AppUiAction.
    QueueSalvageItem {
        guid: Guid,
    },
    // TOODO: Move to AppUiAction.
    UnqueueSalvageItem {
        guid: Guid,
    },
    SalvageItems {
        ust_guid: Guid,
        item_guids: Vec<Guid>,
    },
    // TODO: Move to AppUiAction.
    QueryDebugInfo {
        target: InspectTarget,
    },
    CastSpell {
        spell_id: u32,
        target: Option<Guid>,
    },
    CycleCombatProfileLevel,
    CycleCombatAttackHeight,
    SetCombatMode {
        on: bool,
    },
    LevelUpStat {
        stat: StatType,
        amount: u32,
    },
    TrainSkill {
        skill: SkillType,
        amount: u32,
    },
    // TODO: Move to AppUiAction if purely client-side.
    ViewDetails {
        view: ContextView,
    },
    Log {
        chat_tags: ChatMessageTags,
        message: String,
    },
    RunScript {
        basename: String,
        args: String,
    },
    ScriptCommand {
        msg: String,
    },
    UnrunScript,
    BeginInteraction {
        interaction: Interaction,
    },
    CancelInteraction,
    SendCommands {
        commands: Vec<ClientCommand>,
    },
    // TODO: Move to AppUiAction.
    ClearVendor,
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
    Notification {
        notification: AppNotification,
    },
    UiAction {
        action: AppUiAction,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AppNotification {
    ActiveInteractionChanged {
        interaction: Option<Interaction>,
    },
    InventoryChanged {
        removed: Vec<Guid>,
        added: Vec<Guid>,
    },
    PlayerEntityReady {
        guid: Guid,
    },
}

#[derive(Debug, Clone)]
pub struct LocalConfirmation {
    pub title: String,
    pub text: String,
    pub action: AppAction,
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

impl From<AppNotification> for AppAction {
    fn from(notification: AppNotification) -> Self {
        AppAction::Notification { notification }
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
