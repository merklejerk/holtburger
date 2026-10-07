//! Ignore read model and intents; shared world/core own scope semantics and mutation.

use holtburger_common::Guid;
use holtburger_core::ClientCommand;
use holtburger_world::state::squelch::{SquelchCoverage, SquelchScope, SquelchState};
use serde::{Deserialize, Serialize};

/// One merged server record, with basic removal eligibility computed by world.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientSquelchEntry {
    /// Representative character identity.
    pub guid: Guid,
    /// Server name, independent of scene visibility.
    pub name: String,
    /// Whether the target account is restricted.
    pub account: bool,
    /// Character category coverage; may coexist with the account flag.
    pub coverage: SquelchCoverage,
    /// Scope supported by this initial management slice, or read-only.
    pub removal_scope: Option<SquelchScope>,
}
/// Replacement and incremental events share this exact projection.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientSquelchSnapshot {
    /// Display ordering belongs to the frontend.
    pub entries: Vec<ClientSquelchEntry>,
    /// Legacy keys whose identity the protocol does not establish; read-only.
    pub legacy_accounts: Vec<String>,
    /// Sender-independent restrictions, read-only in the initial slice.
    pub global_coverage: SquelchCoverage,
}
impl From<&SquelchState> for ClientSquelchSnapshot {
    fn from(state: &SquelchState) -> Self {
        Self {
            entries: state
                .characters
                .iter()
                .map(|(guid, record)| {
                    let management = record.management();
                    ClientSquelchEntry {
                        guid: *guid,
                        name: record.name.clone(),
                        account: record.account,
                        coverage: management.coverage,
                        removal_scope: management.removal_scope,
                    }
                })
                .collect(),
            legacy_accounts: state.accounts.keys().cloned().collect(),
            global_coverage: state.globals.filter.coverage(),
        }
    }
}
/// Explicit desired scope; removal resolves identity metadata from retained shared state.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum ClientSquelchAction {
    /// Add an all-channel restriction.
    Add { name: String, scope: SquelchScope },
    /// Remove only the chosen basic scope.
    Remove { guid: Guid, scope: SquelchScope },
}
impl From<ClientSquelchAction> for ClientCommand {
    fn from(action: ClientSquelchAction) -> Self {
        match action {
            ClientSquelchAction::Add { name, scope } => Self::AddIgnore { name, scope },
            ClientSquelchAction::Remove { guid, scope } => Self::RemoveIgnore { guid, scope },
        }
    }
}
