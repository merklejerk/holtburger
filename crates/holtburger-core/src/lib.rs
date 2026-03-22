pub mod client;
pub mod errors;

// Flatten the events for compatibility
pub use client::types::{
    ActiveCharacterConfirmation, BusyOperationKind, BusyOperationResult, ClientCommand,
    ClientState, ClientViewEvent, ErrorReason, PlayerCharacterOptions, RetryState, WireEvent,
};
pub use client::{Client, ClientBuilder};
