//! Shared scripting runtime and boundary types.
//!
//! The boundary is intentionally split into three translation seams:
//! - read seam: a frontend-owned projection implements [`ScriptClientView`]
//! - event seam: frontend adapters translate core and workflow changes into [`ScriptEvent`]
//! - write seam: frontend adapters compile [`ScriptIntent`] back into app actions or commands

mod host;
mod types;

pub use host::ScriptHost;
pub use types::{
    ScriptBusyOperation, ScriptChatChannelKind, ScriptChatEvent, ScriptClientIntent,
    ScriptClientView, ScriptConfirmation, ScriptEntityView, ScriptEvent, ScriptIntent,
    ScriptInventoryItemView, ScriptLifecycleEvent, ScriptLocalConfirmation,
    ScriptLocalConfirmationKind, ScriptLogLevel, ScriptPartyMemberView, ScriptPartyView,
    ScriptSelfView, ScriptSource, ScriptSpellEffectView, ScriptWorkflowEvent,
};
