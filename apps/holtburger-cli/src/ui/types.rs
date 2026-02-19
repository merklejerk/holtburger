use holtburger_common::Guid;
use holtburger_core::client::types::{ClientCommand, TargetSlot};
use holtburger_core::world::entity::Entity;
use holtburger_core::world::stats::{AttributeType, SkillType, VitalType};
use holtburger_protocol::messages::magic::Enchantment;

// Layout constants
pub const STATUS_BAR_HEIGHT: u16 = 3;
pub const DYNAMIC_PANEL_HEIGHT: u16 = 3;
pub const INPUT_AREA_HEIGHT: u16 = 3;
pub const PULSE_PANEL_WIDTH: u16 = 16;
pub const MIN_MAIN_AREA_HEIGHT: u16 = 10;
pub const WIDTH_BREAKPOINT: u16 = 150;

pub const LAYOUT_WIDE_NEARBY_PCT: u16 = 25;
pub const LAYOUT_WIDE_CHAT_PCT: u16 = 50;
pub const LAYOUT_WIDE_CONTEXT_PCT: u16 = 25;

pub const LAYOUT_NARROW_DASHBOARD_PCT: u16 = 50;
pub const LAYOUT_NARROW_CONTEXT_PCT: u16 = 50;

// Chat constants
pub const CHAT_HISTORY_WINDOW_SIZE: usize = 2000;

// Interaction constants
pub const SCROLL_STEP: usize = 3;

#[derive(Debug, Clone)]
pub enum StatType {
    Attribute(AttributeType),
    Vital(VitalType),
    Skill(SkillType),
}

#[derive(Debug, Clone)]
pub enum CommandTarget<'a> {
    Entity(&'a Entity, Option<TargetSlot>),
    Enchantment(Enchantment),
    Stat(StatType, Option<u64>, Option<u32>),
    Spell(u32),
    None,
}

#[derive(Debug)]
pub enum UIEffect {
    Command(ClientCommand),
    Commands(Vec<ClientCommand>),
    Assess(Guid),
    ActivateDebugSpell(u32),
    ActivateDebugEntity(Guid),
    Move(Guid),
    Give(Guid),
    Heal(Guid),
    ApplyHealing(Guid),
    ApplyMoving(Guid),
    Target(Guid),
    CancelInteraction,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InteractionMode {
    Moving,
    Healing,
    Target,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ActiveInteraction {
    pub guid: Guid,
    pub mode: InteractionMode,
}

#[derive(Debug, Clone)]
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

#[derive(Debug, Clone)]
pub struct ChatMessage {
    pub kind: ChatMessageKind,
    pub text: String,
}

#[derive(PartialEq, Debug)]
pub enum UIState {
    Chat,
    CharacterSelection,
}

#[derive(PartialEq, Debug, Clone, Copy)]
pub enum DashboardTab {
    Nearby,
    Inventory,
    Character,
    Spells,
    Equip,
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
}

#[derive(Debug, Default)]
pub struct UpdateResult {
    pub commands: Vec<ClientCommand>,
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

    pub fn redraw() -> Self {
        Self {
            commands: Vec::new(),
            needs_redraw: true,
        }
    }

    pub fn commands(commands: Vec<ClientCommand>) -> Self {
        Self {
            commands,
            needs_redraw: false,
        }
    }

    pub fn merge(&mut self, other: UpdateResult) {
        self.commands.extend(other.commands);
        self.needs_redraw |= other.needs_redraw;
    }
}
