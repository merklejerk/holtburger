// Layout constants
pub const STATUS_BAR_HEIGHT: u16 = 3;
pub const DYNAMIC_PANEL_HEIGHT: u16 = 3;
use holtburger_common::Guid;
pub const INPUT_AREA_HEIGHT: u16 = 3;
pub const MIN_MAIN_AREA_HEIGHT: u16 = 10;
pub const WIDTH_BREAKPOINT: u16 = 150;

pub const LAYOUT_WIDE_NEARBY_PCT: u16 = 25;
pub const LAYOUT_WIDE_CHAT_PCT: u16 = 50;
pub const LAYOUT_WIDE_CONTEXT_PCT: u16 = 25;

pub const LAYOUT_NARROW_DASHBOARD_PCT: u16 = 50;
pub const LAYOUT_NARROW_CONTEXT_PCT: u16 = 50;

// Chat constants
pub const CHAT_HISTORY_WINDOW_SIZE: usize = 10000;

// Interaction constants
pub const SCROLL_STEP: usize = 3;

use holtburger_core::client::types::{ClientCommand, TargetSlot};
use holtburger_core::world::entity::Entity;
use holtburger_core::world::stats::{AttributeType, SkillType, VitalType};
use holtburger_protocol::messages::magic::Enchantment;

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
pub enum CommandHandler {
    Command(ClientCommand),
    ToggleDebug,
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
