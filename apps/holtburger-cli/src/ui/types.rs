use crossterm::event::{KeyEvent, MouseEvent};
use holtburger_common::Guid;
use holtburger_core::client::types::TargetSlot;
use holtburger_core::world::entity::Entity;
use holtburger_core::world::stats::{AttributeType, SkillType, VitalType};
use holtburger_core::{ClientViewEvent, StateEvent, WireEvent};
use holtburger_protocol::messages::magic::Enchantment;
use ratatui::layout::Rect;
use std::time::Instant;

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
    VendorItem(&'a holtburger_core::world::vendor::CoreVendorItem),
    Enchantment(Enchantment),
    Stat(StatType, Option<u64>, Option<u32>),
    Spell(u32),
    None,
}

#[derive(Debug, Clone, PartialEq)]
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
    ReceivedEvent(WireEvent),
    ReceivedStateEvent(StateEvent),
    ReceivedViewEvent(ClientViewEvent),
}
