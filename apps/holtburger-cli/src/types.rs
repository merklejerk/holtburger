use crossterm::event::{KeyEvent, MouseEvent};
use holtburger_common::Guid;
use holtburger_core::client::types::TargetSlot;
use holtburger_core::{ClientCommand, WorldViewEvent};
use holtburger_protocol::messages::magic::Enchantment;
use holtburger_world::entity::Entity;
use holtburger_world::stats::{AttributeType, SkillType, VitalType};
use ratatui::layout::Rect;
use std::borrow::Cow;
use std::time::Instant;

use crate::actions::{AppAction};

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
    ReceivedViewEvent(WorldViewEvent),
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
