use crossterm::event::{KeyEvent, MouseEvent};
use holtburger_common::Guid;
use holtburger_core::ClientViewEvent;
use holtburger_core::client::types::TargetSlot;
use holtburger_protocol::messages::magic::Enchantment;
use holtburger_world::entity::Entity;
use holtburger_world::stats::{AttributeType, SkillType, VitalType};
use ratatui::layout::Rect;
use std::borrow::Cow;
use std::time::Instant;

pub const SCROLL_STEP: usize = 3;

pub type VerbSet = Vec<Verb>;


#[derive(Debug, Clone)]
pub struct Verb {
    pub messages: Vec<crate::ui::UiMessage>,
    pub shortcut: char,
    pub label: Cow<'static, str>,
}

impl Verb {
    pub fn new(messages: Vec<crate::ui::UiMessage>, shortcut: char, label: impl Into<Cow<'static, str>>) -> Self {
        Self {
            messages,
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
pub enum AppAction {
    Tick(f64),
    KeyPress(KeyEvent, u16, u16, Vec<Rect>, Rect), // key, width, height, main_chunks, dynamic_chunk
    Mouse(MouseEvent, Vec<Rect>, Vec<Rect>, Rect), // mouse, chunks, main_chunks, dynamic_chunk
    ReceivedViewEvent(ClientViewEvent),
}
