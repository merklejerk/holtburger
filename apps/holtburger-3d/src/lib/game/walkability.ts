/**
 * Retail's walkable-surface threshold, in the frontend's scene frame.
 *
 * A surface is walkable when its up-facing normal component is at least this much:
 * `CPhysicsObj::is_valid_walkable` is `normal.z >= PhysicsGlobals::floor_z` (acclient.c:304992),
 * initialised once at acclient.c:765985 and matching ACE's `PhysicsGlobals.FloorZ`. Scene
 * coordinates are Y-up where AC's authored frame is Z-up, so the same number tests `normal.y` here.
 *
 * This is a retail constant, not a tunable: it decides what the host filters interior map floors by
 * and what the map tints as too steep to stand on, and those two must agree. Its Rust twin is
 * `RETAIL_WALKABLE_NORMAL_Z` in `crates/holtburger-world/src/spatial/grounded.rs`; the value is
 * duplicated only because it has to cross a language boundary, so change both or neither.
 */
export const RETAIL_WALKABLE_NORMAL_UP = 0.664_174_14;
