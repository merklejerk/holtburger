mod physics;
mod scene;
mod types;

pub use physics::{
    BasicSpatialPhysics, NoopSpatialPhysics, SpatialPhysics, advance_body_kinematics,
    project_pose_forward_distance,
};
pub use scene::SpatialScene;
pub use types::*;

#[cfg(test)]
pub(crate) use physics::project_pose_by_velocity;

#[cfg(test)]
mod tests;
