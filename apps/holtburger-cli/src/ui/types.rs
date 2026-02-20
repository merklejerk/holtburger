use holtburger_common::Guid;
use holtburger_core::client::types::TargetSlot;
use holtburger_core::world::entity::Entity;
use holtburger_core::world::stats::{AttributeType, SkillType, VitalType};
use holtburger_protocol::messages::magic::Enchantment;
use std::time::Instant;

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

#[derive(Debug, Clone, PartialEq)]
pub enum Modal {
    Retry { message: String, end_time: Instant },
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

pub const SCROLL_STEP: usize = 3;
