//! Shared scripting runtime and boundary types.
//!
//! The boundary is intentionally split into three translation seams:
//! - read seam: a frontend-owned projection implements [`ScriptClientView`]
//! - event seam: frontend adapters translate core and workflow changes into [`ScriptEvent`]
//! - write seam: frontend adapters compile [`ScriptIntent`] back into app actions or commands

mod host;
mod types;

pub use holtburger_common::properties::WorldObjectProperties;
pub use holtburger_common::properties::{
    PropertyBool, PropertyDataId, PropertyFloat, PropertyInstanceId, PropertyInt, PropertyInt64,
    PropertyString,
};
pub use holtburger_protocol::messages::object::types::{
    ArmorProfile, CreatureProfile, WeaponProfile,
};
pub use host::ScriptHost;
pub use types::{
    ScriptBusyOperation, ScriptChatChannelKind, ScriptChatEvent, ScriptClientIntent,
    ScriptClientView, ScriptConfirmation, ScriptEntityKind, ScriptEntityProfile, ScriptEntityView,
    ScriptEquipmentSlotKind, ScriptEquipmentSlotView, ScriptEvent, ScriptIntent,
    ScriptInventoryItemView, ScriptLifecycleEvent, ScriptLocalConfirmation,
    ScriptLocalConfirmationKind, ScriptLogLevel, ScriptMotionCommand, ScriptPartyMemberView,
    ScriptPartyView, ScriptSelfView, ScriptSource, ScriptSpellEffectView, ScriptWorkflowEvent,
};
