//! Shared host projection of collision-placed path points into frontend placement coordinates.

use anyhow::{Result, ensure};
use holtburger_common::position::{
    MAX_OUTDOOR_LANDBLOCK_AXIS, METERS_PER_LANDBLOCK, WorldPosition,
};
use holtburger_common::{Guid, Quaternion, Vector3};

/// Converts one canonical scene point into an outdoor-anchored world pose.
///
/// The inverse of the presentation projection above, and the boundary every frontend-supplied
/// position crosses: canonical scene axes are Y-up with +Z south, while AC authors Z-up with +Y
/// north. The returned position carries the derived outdoor terrain cell selector.
pub fn scene_point_to_pose(scene_point: [f32; 3]) -> Result<WorldPosition> {
    ensure!(
        scene_point.iter().all(|component| component.is_finite()),
        "scene point must be finite"
    );
    let ac_world_x = scene_point[0];
    let ac_world_y = -scene_point[2];
    let block_x = (ac_world_x / METERS_PER_LANDBLOCK).floor() as i32;
    let block_y = (ac_world_y / METERS_PER_LANDBLOCK).floor() as i32;
    ensure!(
        (0..=i32::from(MAX_OUTDOOR_LANDBLOCK_AXIS)).contains(&block_x)
            && (0..=i32::from(MAX_OUTDOOR_LANDBLOCK_AXIS)).contains(&block_y),
        "scene point is outside AC's authored landscape"
    );
    Ok(WorldPosition::from_outdoor_frame(
        Guid(((block_x as u32) << 24) | ((block_y as u32) << 16)),
        Vector3::new(
            ac_world_x - block_x as f32 * METERS_PER_LANDBLOCK,
            ac_world_y - block_y as f32 * METERS_PER_LANDBLOCK,
            scene_point[1],
        ),
        Quaternion::identity(),
    ))
}

/// Rotates one canonical scene direction into AC authored axes.
///
/// A direction has no origin, so it needs the axis swap without the landblock arithmetic.
pub fn scene_direction_to_ac(direction: [f32; 3]) -> Result<Vector3> {
    ensure!(
        direction.iter().all(|component| component.is_finite()),
        "scene direction must be finite"
    );
    Ok(Vector3::new(direction[0], -direction[2], direction[1]))
}

/// Converts an AC `WorldPosition` into canonical scene coordinates `[x, y, z]` and its
/// renderer portal scope key (`"outdoor"` for outdoor cells, `"0x{cell:08x}"` for interiors).
pub fn world_position_to_scene_point(position: &WorldPosition) -> Result<([f32; 3], String)> {
    let coords = position.coords;
    ensure!(
        coords.x.is_finite() && coords.y.is_finite() && coords.z.is_finite(),
        "world position coordinates must be finite"
    );
    let block_x = ((position.landblock_id.0 >> 24) & 0xFF) as f32;
    let block_y = ((position.landblock_id.0 >> 16) & 0xFF) as f32;
    let scene_x = block_x * METERS_PER_LANDBLOCK + coords.x;
    let scene_y = coords.z;
    let scene_z = -(block_y * METERS_PER_LANDBLOCK + coords.y);
    let cell_index = position.landblock_id.0 & 0xFFFF;
    let scope_key = if cell_index >= 0x0100 {
        format!("0x{:08x}", position.landblock_id.0)
    } else {
        "outdoor".to_string()
    };
    Ok(([scene_x, scene_y, scene_z], scope_key))
}
