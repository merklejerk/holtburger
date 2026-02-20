use crossterm::event::{KeyEvent, MouseEvent};
use holtburger_core::{ClientViewEvent, StateEvent, WireEvent};
use ratatui::layout::Rect;

#[derive(Debug)]
pub enum AppAction {
    Tick(f64),
    KeyPress(KeyEvent, u16, u16, Vec<Rect>, Rect), // key, width, height, main_chunks, dynamic_chunk
    Mouse(MouseEvent, Vec<Rect>, Vec<Rect>, Rect), // mouse, chunks, main_chunks, dynamic_chunk
    ReceivedEvent(WireEvent),
    ReceivedStateEvent(StateEvent),
    ReceivedViewEvent(ClientViewEvent),
}

use holtburger_core::client::types::TargetSlot;
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
