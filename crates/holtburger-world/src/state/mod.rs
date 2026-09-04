mod entity_scale;
pub mod fellowship;
pub mod liveness;
pub mod motion_resolution;
pub mod mutations;
mod selection;
pub mod self_movement;
#[cfg(test)]
pub mod tests;
pub mod trade;
pub mod types;

pub use fellowship::{
    FellowshipDepartedMemberState, FellowshipLockEntryState, FellowshipLockState,
    FellowshipMemberState, FellowshipState,
};
pub use motion_resolution::{
    AuthoredBodyMotionTick, AuthoredMotionDriveError, BodyProjectionResolver,
    LocalAuthoredMotionActionError, MotionCommandKinematics, MotionTableMovementProfile,
    PlayerMotionTableLookupError, PlayerMotionTableResolution, PlayerMotionTableSource,
};
pub use self_movement::{
    RequiredSelfMovementKinematics, SelfJumpCapabilities, SelfJumpCapabilitiesError,
    SelfMovementCapabilities, SelfMovementCapabilitiesError, SelfMovementKinematics,
    SelfMovementKinematicsError,
};
pub use trade::{TradeSide, TradeState};
pub use types::{ServerTimeSync, WorldState};

use super::WorldEvent;
use super::vendor::{CoreVendorItem, VendorState};
pub(crate) use crate::hydration::WorldObjectPropertiesHydrationExt;
use holtburger_common::Guid;
use holtburger_common::Vector3;
use holtburger_common::properties::{
    EquipMask, PropertyInstanceId, PropertyInt, PropertyString, PropertyUpdate,
    WorldObjectPropertyAccessorsMut,
};
pub(crate) use holtburger_protocol::messages::*;
