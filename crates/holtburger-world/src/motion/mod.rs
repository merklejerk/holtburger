//! Authored motion semantics: what a motion command selects, how the resulting sequence advances,
//! and what one tick of it contributes.
//!
//! This is the runtime half of the motion contract. `holtburger-content` projects raw motion tables
//! and animations into `MotionSequenceCatalog`; this module turns a command plus elapsed time into
//! a selection, a cursor, and one exactly-composed rigid offset. It is a port of retail's
//! `CMotionTable` and `CSequence`, so anyone cross-reading the decompile lands in the same concepts.
//!
//! Nothing here is a service. State is owned by the caller — a client `WorldState` entity or an
//! Explorer registry entry — and every operation is a method on that state or a free function over
//! contract values.

#[cfg(test)]
mod tests;

mod actuation;
mod registry;
mod selection;
mod sequence;
mod state;

use holtburger_content::MotionAnimation;
use std::sync::Arc;

/// One projected animation, shared by every clip that references it.
///
/// The projection resolves references once, so a runtime clip can never hold an animation the
/// archive does not contain.
pub type MotionAnimationRef = Arc<MotionAnimation>;

pub use actuation::authored_grounded_actuation;
pub use registry::{BodyMotionRuntime, MotionRuntimeRegistry, PlayingMotionClip};
pub use selection::{
    MotionSelectionOutcome, select_motion, set_default_state, stop_completely, stop_motion,
};
pub use sequence::{FiredMotionHook, MotionSequenceRuntime, SequenceNode, SequenceTick};
pub use state::{ActiveMotion, MotionCommand, MotionOrder, MotionState};
