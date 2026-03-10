//! Authoritative world-state crate for the client.
//!
//! Ownership is split three ways:
//! - [`player`] owns the session-local player model and player-specific mutation helpers.
//! - [`state`] owns [`WorldState`](crate::state::WorldState), entity/spatial invariants, and
//!   world-facing mutation helpers.
//! - [`handlers`] owns feature-based protocol orchestration that translates decoded messages into
//!   narrow state mutations plus [`StateEvent`] emission.

pub mod assessment;
pub mod context;
pub mod crafting;
pub mod damage;
pub mod entity;
pub mod events;
pub mod handlers;
pub mod hydration;
pub mod inspect;
pub mod magic;
pub mod player;
pub mod spatial;
pub mod spell;
pub mod state;
pub mod stats;
pub mod vendor;

pub use self::state::WorldState;
pub use events::{
    DerivedStatsData, EventDedupeKey, PlayerInfoData, StateEvent, dedupe_state_events,
};
