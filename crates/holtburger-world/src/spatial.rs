mod physics;
mod scene;
mod types;

pub use physics::{advance_actor_kinematics, BasicSpatialPhysics, NoopSpatialPhysics, SpatialPhysics};
pub use scene::SpatialScene;
pub use types::*;

#[cfg(test)]
pub(crate) use physics::project_pose_by_velocity;

#[cfg(test)]
mod tests;
