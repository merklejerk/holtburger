//! In-process V8 scripting runtime bound directly to `holtburger-live-api`'s `LiveApiEngine`.
//!
//! `ScriptHost` runs `deno_core::JsRuntime` (`!Send`) on a dedicated non-Tokio OS thread so
//! synchronous JS calls to `HB.query(...)` and `HB.command(...)` can `Handle::block_on` against
//! `LiveApiEngine` without ever starving Tokio worker threads or blocking the TUI render loop.

pub type ScriptJsonValue = serde_json::Value;

mod host;
mod types;

pub use host::ScriptHost;
pub use types::{
    ScriptFetchAllowedHost, ScriptFetchPolicy, ScriptHostConfig, ScriptPostError,
    ScriptPostErrorCode, ScriptPostRequest, ScriptPostResponse, ScriptSource, ScriptStorage,
};
