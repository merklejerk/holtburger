pub mod client;
pub mod errors;

// Flatten the events for compatibility
pub use client::Client;
pub use client::types::{
    ClientCommand, ClientState, ClientViewEvent, ErrorReason, RetryState, WireEvent,
};
