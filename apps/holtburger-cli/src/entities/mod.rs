pub mod classification;
pub mod commands;
pub mod debug;
pub mod filter;

use holtburger_core::protocol::messages::Enchantment;
use holtburger_core::world::entity::Entity;

pub enum CommandTarget<'a> {
    Entity(&'a Entity),
    Enchantment(&'a Enchantment),
    None,
}
