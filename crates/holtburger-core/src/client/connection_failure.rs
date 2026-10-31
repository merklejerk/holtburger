//! Shared connection failure facts and explanations; retry policy belongs to each frontend.

use super::types::{ClientExitCause, ClientState};
use holtburger_protocol::errors::CharacterError;
use holtburger_protocol::messages::AccountBannedData;
use std::fmt;

/// One interpretation of a server character-error value, including unrecognized extensions.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CharacterErrorCode {
    /// A protocol value understood by this client.
    Known(CharacterError),
    /// An unsupported value retained for diagnostics instead of becoming `None`.
    Unknown(u32),
}

impl From<u32> for CharacterErrorCode {
    fn from(raw: u32) -> Self {
        match CharacterError::from_repr(raw) {
            Some(error) => Self::Known(error),
            None => Self::Unknown(raw),
        }
    }
}

impl fmt::Display for CharacterErrorCode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        use CharacterError::*;
        let message = match self {
            Self::Unknown(raw) => {
                return write!(
                    f,
                    "The server rejected the operation with unknown character error 0x{raw:08X}."
                );
            }
            Self::Known(error) => match error {
                None => "No character error was reported.",
                Logon => {
                    "This account is already logged in. Wait for the previous session to end before trying again."
                }
                ServerDown1 | ServerCrash1 | ServerCrash2 => {
                    "The server disconnected or is unavailable. Try again later."
                }
                AccountLogin => {
                    "The server could not access your account information. Try again later."
                }
                AccountInvalid => "The server rejected the account information.",
                AccountDoesntExist => "The account does not exist on this server.",
                LogonServerFull => "The server is full or closed to logins. Try again later.",
                EnterGameCharacterInWorld | EnterGameCharacterInWorldServer => {
                    "One of your characters is still in the world. Try again later."
                }
                EnterGameCharacterNotOwned => {
                    "The server says this character does not belong to your account or is unavailable."
                }
                EnterGameCouldntPlaceCharacter => {
                    "The server could not place this character in the world."
                }
                EnterGameCharacterLocked => {
                    "This character is locked while a save is in progress. Try again later."
                }
                EnterGameStartServerDown => {
                    "This character's starting server is unavailable. Try again later."
                }
                EnterGameCorruptCharacter => "The server reported corrupt character data.",
                EnterGameOldCharacter => "The server rejected this character.",
                EnterGamePlayerAccountMissing => "The server could not find the player account.",
                EnterGameStressAccount => "This account cannot enter the game with this character.",
                EnterGameGeneric => "The server could not enter this character into the world.",
                SubscriptionExpired => "The server reported an expired subscription.",
                Banned => "This account is banned from the server.",
                Logoff => "The server could not log off your character.",
                Delete => "The server could not delete your character.",
            },
        };
        f.write_str(message)
    }
}

/// The concrete network operation that failed, independent of lifecycle presentation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectionOperation {
    /// DNS lookup before a runtime exists.
    ResolveAddress,
    /// Local UDP socket initialization before a runtime exists.
    OpenSocket,
    /// Sending the authentication request.
    SendLogin,
    /// Receiving or handling server traffic, including entry follow-up sends.
    ServerTraffic,
}

/// Connection failure evidence retained by core, without frontend retry decisions.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConnectionFailureCause {
    /// Interpreted server rejection, retaining unknown numeric values.
    Character(CharacterErrorCode),
    /// Opaque server explanation; never parsed to guess password/account categories.
    AccountBoot(Option<String>),
    /// Server ban duration and optional explanation.
    AccountBanned(AccountBannedData),
    /// Observed silence duration, which does not prove a particular server fault.
    Inactivity {
        /// Seconds since the last observed server traffic.
        seconds: u64,
    },
    /// Local operation and its diagnostic, also used by malformed lifecycle reply handling.
    Local {
        /// Failed network boundary.
        operation: ConnectionOperation,
        /// Underlying diagnostic without credentials or outgoing packet contents.
        diagnostic: String,
    },
}

/// Shared failure retained before teardown; setup errors have no runtime state yet.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConnectionFailure {
    /// Existing authority state used for phase-appropriate headings.
    pub state: Option<ClientState>,
    /// Evidence used by the shared formatter and TUI retry policy.
    pub cause: ConnectionFailureCause,
}

impl fmt::Display for ConnectionFailure {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.state {
            Some(ClientState::Connected) => f.write_str("Login failed: ")?,
            Some(ClientState::EnteringWorld) => f.write_str("World entry failed: ")?,
            _ => {}
        }
        match &self.cause {
            ConnectionFailureCause::Character(error) => error.fmt(f),
            ConnectionFailureCause::AccountBoot(reason) => {
                f.write_str("The server ended this session")?;
                if let Some(reason) = reason
                    .as_deref()
                    .map(str::trim_end)
                    .filter(|reason| !reason.is_empty())
                {
                    // ACE writes whitespace-prefixed suffixes for retail's
                    // Handle_AccountBooted (acclient.c:383062) to append verbatim.
                    // Bare custom explanations need a separator, not a guessed error category.
                    if !reason.starts_with(char::is_whitespace) {
                        f.write_str(": ")?;
                    }
                    f.write_str(reason)?;
                    if reason.ends_with(['.', '!', '?']) {
                        return Ok(());
                    }
                }
                f.write_str(".")
            }
            ConnectionFailureCause::AccountBanned(data) => {
                f.write_str("This account is banned from the server.")?;
                // Retail Handle_AccountBanned (acclient.c:383120) interprets duration as signed;
                // nonpositive values supply no expiry. Keep raw bits in the retained payload.
                if (data.duration_seconds as i32) > 0 {
                    write!(
                        f,
                        " Remaining duration reported by server: {} seconds.",
                        data.duration_seconds
                    )?;
                }
                if let Some(reason) = data
                    .reason
                    .as_ref()
                    .filter(|reason| !reason.trim().is_empty())
                {
                    write!(f, " Server explanation: {reason}")?;
                }
                Ok(())
            }
            ConnectionFailureCause::Inactivity { seconds } => write!(
                f,
                "Connection timed out: no server traffic for {seconds} seconds."
            ),
            ConnectionFailureCause::Local {
                operation,
                diagnostic,
            } => {
                let label = match operation {
                    ConnectionOperation::ResolveAddress => "Could not resolve the server address",
                    ConnectionOperation::OpenSocket => "Could not open the UDP socket",
                    ConnectionOperation::SendLogin => "Could not send the login request",
                    ConnectionOperation::ServerTraffic => "Server communication failed",
                };
                write!(f, "{label}: {diagnostic}")
            }
        }
    }
}

impl std::error::Error for ConnectionFailure {}

/// Terminal authority result retained across events, snapshots, and task completion.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClientExitOutcome {
    /// Broad terminal ownership, also used by the native application lifecycle.
    pub cause: ClientExitCause,
    /// Specific failure, absent for ordinary user disconnect or host shutdown.
    pub failure: Option<ConnectionFailure>,
}

impl ClientExitOutcome {
    /// Prepare the explanation for either frontend and the native launcher return path.
    pub fn diagnostic(&self) -> String {
        match &self.failure {
            Some(failure) => failure.to_string(),
            None => match self.cause {
                ClientExitCause::ExplicitDisconnect | ClientExitCause::HostShutdown => {
                    "Disconnected from the server.".into()
                }
                _ => "The server connection ended.".into(),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn boot_explanations_join_server_suffixes_without_reclassifying_them() {
        for (reason, expected) in [
            (None, "The server ended this session."),
            (Some(""), "The server ended this session."),
            (Some(" \n\t"), "The server ended this session."),
            (
                Some(" because the password entered for this account was not correct"),
                "The server ended this session because the password entered for this account was not correct.",
            ),
            (
                Some(" - custom administrative reason"),
                "The server ended this session - custom administrative reason.",
            ),
            (
                Some("Custom server explanation."),
                "The server ended this session: Custom server explanation.",
            ),
            (
                Some("Try again later!  "),
                "The server ended this session: Try again later!",
            ),
            (
                Some("\nCustom server explanation"),
                "The server ended this session\nCustom server explanation.",
            ),
        ] {
            let failure = ConnectionFailure {
                state: Some(ClientState::Connected),
                cause: ConnectionFailureCause::AccountBoot(reason.map(str::to_owned)),
            };
            assert_eq!(failure.to_string(), format!("Login failed: {expected}"));
        }
    }

    #[test]
    fn ban_formatting_preserves_facts_without_inventing_an_expiry() {
        for duration_seconds in [0, 3600, u32::MAX] {
            let failure = ConnectionFailure {
                state: Some(ClientState::Connected),
                cause: ConnectionFailureCause::AccountBanned(AccountBannedData {
                    duration_seconds,
                    reason: Some(" - custom reason".into()),
                }),
            };
            let diagnostic = failure.to_string();
            assert!(diagnostic.contains("custom reason"));
            assert_eq!(
                diagnostic.contains("Remaining duration"),
                (duration_seconds as i32) > 0
            );
            assert!(diagnostic.starts_with("Login failed:"));
        }
    }
}
