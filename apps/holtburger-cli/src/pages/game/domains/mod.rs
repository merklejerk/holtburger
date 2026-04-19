use super::*;

mod chat;
pub(super) mod combat;
mod entity;
pub(super) mod interaction;
mod inventory;
mod lifecycle;
pub(super) mod logopolis;
pub(super) mod navigation;
pub(super) mod object_interaction;
mod party;
mod player;
mod progression;
mod reduce;
mod script;
mod trade_vendor;
pub(super) mod ui;

pub(crate) use combat::is_in_combat_mode;
pub(crate) use logopolis::{logopolis_state, logopolis_state_mut};
#[allow(unused_imports)]
pub(crate) use object_interaction::{
    context_buffer, context_buffer_len, live_context_buffer, refresh_context_buffer,
};
pub(crate) use reduce::{reduce_action, reduce_tick, reduce_view_event};

#[cfg(test)]
mod tests;
