pub mod client;
pub mod errors;

// Flatten the events for compatibility
pub use client::projection::{
    ClientProjectionCache, ClientViewSpatialBridge, EntitySpatialSample, ProjectedEntityState,
    ProjectionConfig, ProjectionMode,
};
pub use client::types::{
    ActiveCharacterConfirmation, BusyOperationKind, BusyOperationResult, ClientCommand,
    ClientState, ClientViewEvent, ErrorReason, PlayerCharacterOptions, RetryState, WireEvent,
};
pub use client::{Client, ClientBuilder};
