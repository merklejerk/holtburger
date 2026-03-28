use holtburger_common::Guid;
use holtburger_common::Vector3;
use holtburger_common::Quaternion;
use holtburger_common::position::WorldPosition;
use smallvec::SmallVec;
use std::sync::Arc;
use std::collections::{HashMap, HashSet};
use std::f32::consts::TAU;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ContactState {
    #[default]
    Unknown,
    Airborne,
    Grounded,
}

impl ContactState {
    pub const fn grounded(self) -> Option<bool> {
        match self {
            Self::Unknown => None,
            Self::Airborne => Some(false),
            Self::Grounded => Some(true),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SolveActorInput {
    pub actor_id: Guid,
    pub pose: WorldPosition,
    pub velocity: Vector3,
    pub omega: Vector3,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SpatialSolveRequest {
    pub dt: std::time::Duration,
    pub actors: SmallVec<[SolveActorInput; 1]>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SolvedActorKinematics {
    pub actor_id: Guid,
    pub pose: WorldPosition,
    pub velocity: Vector3,
    pub omega: Vector3,
    pub contact: ContactState,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum SpatialEvent {
    ContactChanged {
        actor_id: Guid,
        contact: ContactState,
    },
    ForcedReposition {
        actor_id: Guid,
        pose: WorldPosition,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub struct SpatialSolveBatch {
    pub solved: SmallVec<[SolvedActorKinematics; 1]>,
    pub events: SmallVec<[SpatialEvent; 4]>,
}

pub trait SpatialPhysics: Send + Sync + 'static {
    fn solve(
        &self,
        request: &SpatialSolveRequest,
        scene: &mut SpatialScene,
    ) -> SpatialSolveBatch;
}

fn normalize_heading(heading: f32) -> f32 {
    heading.rem_euclid(TAU)
}

fn rotate_planar_velocity(velocity: Vector3, turn_step: f32) -> Vector3 {
    if turn_step.abs() <= f32::EPSILON {
        return velocity;
    }

    let sin = turn_step.sin();
    let cos = turn_step.cos();

    Vector3::new(
        (velocity.x * cos) + (velocity.y * sin),
        (-velocity.x * sin) + (velocity.y * cos),
        velocity.z,
    )
}

pub fn advance_actor_kinematics(
    input: &SolveActorInput,
    dt: std::time::Duration,
) -> SolvedActorKinematics {
    let dt_secs = dt.as_secs_f32().max(0.0);
    if dt_secs <= f32::EPSILON {
        return SolvedActorKinematics {
            actor_id: input.actor_id,
            pose: input.pose,
            velocity: input.velocity,
            omega: input.omega,
            contact: ContactState::Unknown,
        };
    }

    let turn_step = input.omega.z * dt_secs;
    let next_heading = normalize_heading(input.pose.rotation.to_heading() + turn_step);
    let next_velocity = rotate_planar_velocity(input.velocity, turn_step);

    let mut next_pose = input.pose;
    next_pose.rotation = Quaternion::from_heading(next_heading);
    next_pose.coords = next_pose.coords + (next_velocity * dt_secs);

    SolvedActorKinematics {
        actor_id: input.actor_id,
        pose: next_pose,
        velocity: next_velocity,
        omega: input.omega,
        contact: ContactState::Unknown,
    }
}

#[derive(Debug, Default)]
pub struct BasicSpatialPhysics;

impl SpatialPhysics for BasicSpatialPhysics {
    fn solve(
        &self,
        request: &SpatialSolveRequest,
        _scene: &mut SpatialScene,
    ) -> SpatialSolveBatch {
        let solved = request
            .actors
            .iter()
            .map(|actor| advance_actor_kinematics(actor, request.dt))
            .collect();

        SpatialSolveBatch {
            solved,
            events: SmallVec::new(),
        }
    }
}

#[derive(Debug, Default)]
pub struct NoopSpatialPhysics;

impl SpatialPhysics for NoopSpatialPhysics {
    fn solve(
        &self,
        _request: &SpatialSolveRequest,
        _scene: &mut SpatialScene,
    ) -> SpatialSolveBatch {
        SpatialSolveBatch {
            solved: SmallVec::new(),
            events: SmallVec::new(),
        }
    }
}

/// The SpatialScene is responsible for managing the "where" of everything.
/// It tracks entity positions by landblock and handles spatial queries.
pub struct SpatialScene {
    /// Entities indexed by LandblockID for fast local queries.
    pub landblock_map: HashMap<Guid, HashSet<Guid>>,
    /// Latest authoritative pose snapshots for narrow spatial queries.
    pub entity_poses: HashMap<Guid, WorldPosition>,
    pub physics: Arc<dyn SpatialPhysics>,
}

impl Default for SpatialScene {
    fn default() -> Self {
        Self::new()
    }
}

impl SpatialScene {
    pub fn new() -> Self {
        Self::new_with_physics(Arc::new(BasicSpatialPhysics))
    }

    pub fn new_with_physics(physics: Arc<dyn SpatialPhysics>) -> Self {
        Self {
            landblock_map: HashMap::new(),
            entity_poses: HashMap::new(),
            physics,
        }
    }

    pub fn update_entity(&mut self, guid: Guid, old_lb: Guid, pose: WorldPosition) {
        let new_lb = pose.landblock_id;
        if old_lb != new_lb
            && let Some(set) = self.landblock_map.get_mut(&old_lb)
        {
            set.remove(&guid);
        }
        self.landblock_map.entry(new_lb).or_default().insert(guid);
        self.entity_poses.insert(guid, pose);
    }

    pub fn remove_entity(&mut self, guid: Guid, lb: Guid) {
        if let Some(set) = self.landblock_map.get_mut(&lb) {
            set.remove(&guid);
        }
        self.entity_poses.remove(&guid);
    }

    /// Find all entities in a given landblock.
    pub fn get_in_landblock(&self, lb: Guid) -> Option<&HashSet<Guid>> {
        self.landblock_map.get(&lb)
    }

    /// Get all entities in the landblock and its 8 immediate neighbors.
    /// Useful for coarse filtering before doing fine-grained distance checks.
    pub fn get_nearby_entities(&self, lb: Guid) -> HashSet<Guid> {
        let mut nearby = HashSet::new();

        let x = (lb >> 24) & 0xFF;
        let y = (lb >> 16) & 0xFF;

        for dx in -1..=1 {
            for dy in -1..=1 {
                let nx = x as i32 + dx;
                let ny = y as i32 + dy;
                // Outdoor bounds 0x01..0xFE
                if nx > 0 && nx < 255 && ny > 0 && ny < 255 {
                    // Try to add outdoor landblock (identifed by 0xFFFF)
                    let neighbor_lb = ((nx as u32) << 24) | ((ny as u32) << 16) | 0xFFFF;
                    if let Some(set) = self.landblock_map.get(&Guid(neighbor_lb)) {
                        for &guid in set {
                            nearby.insert(guid);
                        }
                    }
                }
            }
        }

        // Also check the specific lb passed (might be an indoor cell)
        if let Some(set) = self.landblock_map.get(&lb) {
            for &guid in set {
                nearby.insert(guid);
            }
        }

        nearby
    }

    /// Query entities within a certain radius.
    pub fn get_entities_in_range(&self, pos: &WorldPosition, radius: f32) -> Vec<Guid> {
        if pos.landblock_id == Guid::NULL || radius < 0.0 {
            return Vec::new();
        }

        self.get_nearby_entities(pos.landblock_id)
            .into_iter()
            .filter(|guid| {
                self.entity_poses
                    .get(guid)
                    .is_some_and(|candidate| pos.distance_to(candidate) <= radius)
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn test_spatial_neighbors() {
        let mut scene = SpatialScene::new();
        let guid_a = Guid(0x11223344);
        let guid_b = Guid(0x55667788);

        // Landblock (10, 10)
        let lb_a = (10 << 24) | (10 << 16) | 0xFFFF;
        // Landblock (11, 10) - direct neighbor to the east
        let lb_b = (11 << 24) | (10 << 16) | 0xFFFF;

        scene.update_entity(
            guid_a,
            Guid(lb_a),
            WorldPosition {
                landblock_id: Guid(lb_a),
                ..Default::default()
            },
        );
        scene.update_entity(
            guid_b,
            Guid(lb_b),
            WorldPosition {
                landblock_id: Guid(lb_b),
                ..Default::default()
            },
        );

        let nearby_a = scene.get_nearby_entities(Guid(lb_a));
        assert!(nearby_a.contains(&guid_a));
        assert!(
            nearby_a.contains(&guid_b),
            "Should find neighbor in adjacent landblock"
        );

        // Random landblock (50, 50) - far away
        let lb_far = (50 << 24) | (50 << 16) | 0xFFFF;
        let nearby_far = scene.get_nearby_entities(Guid(lb_far));
        assert!(nearby_far.is_empty());
    }

    #[test]
    fn get_entities_in_range_uses_pose_index() {
        let mut scene = SpatialScene::new();
        let center_guid = Guid(0x1000_0001);
        let near_guid = Guid(0x1000_0002);
        let far_guid = Guid(0x1000_0003);
        let landblock = Guid(0x0A0A_FFFF);
        let center = WorldPosition {
            landblock_id: landblock,
            coords: Vector3::new(10.0, 10.0, 0.0),
            ..Default::default()
        };

        scene.update_entity(center_guid, landblock, center);
        scene.update_entity(
            near_guid,
            landblock,
            WorldPosition {
                landblock_id: landblock,
                coords: Vector3::new(13.0, 14.0, 0.0),
                ..Default::default()
            },
        );
        scene.update_entity(
            far_guid,
            landblock,
            WorldPosition {
                landblock_id: landblock,
                coords: Vector3::new(40.0, 40.0, 0.0),
                ..Default::default()
            },
        );

        let in_range = scene.get_entities_in_range(&center, 6.0);

        assert!(in_range.contains(&center_guid));
        assert!(in_range.contains(&near_guid));
        assert!(!in_range.contains(&far_guid));
    }

    #[test]
    fn noop_spatial_physics_returns_empty_batch() {
        let mut scene = SpatialScene::new_with_physics(Arc::new(NoopSpatialPhysics));
        let request = SpatialSolveRequest {
            dt: Duration::from_millis(30),
            actors: SmallVec::new(),
        };

        let batch = Arc::clone(&scene.physics).solve(&request, &mut scene);

        assert!(batch.solved.is_empty());
        assert!(batch.events.is_empty());
    }

    #[test]
    fn advance_actor_kinematics_rotates_velocity_with_turn_rate() {
        let input = SolveActorInput {
            actor_id: Guid(0x5000_0001),
            pose: WorldPosition {
                landblock_id: Guid(0x1234_0000),
                coords: Vector3::zero(),
                rotation: Quaternion::from_heading(90.0f32.to_radians()),
            },
            velocity: Vector3::new(0.0, 18.0, 0.0),
            omega: Vector3::new(0.0, 0.0, 90.0f32.to_radians()),
        };

        let solved = advance_actor_kinematics(&input, Duration::from_secs(1));

        assert!((solved.pose.rotation.to_heading().to_degrees() - 180.0).abs() < 1e-4);
        assert!((solved.velocity.x - 18.0).abs() < 1e-4);
        assert!(solved.velocity.y.abs() < 1e-4);
        assert!((solved.pose.coords.x - 18.0).abs() < 1e-4);
        assert!(solved.pose.coords.y.abs() < 1e-4);
        assert_eq!(solved.contact, ContactState::Unknown);
    }

    #[test]
    fn basic_spatial_physics_solves_full_batch() {
        let mut scene = SpatialScene::new();
        let request = SpatialSolveRequest {
            dt: Duration::from_millis(500),
            actors: SmallVec::from_buf([SolveActorInput {
                actor_id: Guid(0x5000_0001),
                pose: WorldPosition {
                    landblock_id: Guid(0x1234_0000),
                    coords: Vector3::new(10.0, 20.0, 30.0),
                    rotation: Quaternion::from_heading(0.0),
                },
                velocity: Vector3::new(-18.0, 0.0, 0.0),
                omega: Vector3::zero(),
            }]),
        };

        let batch = BasicSpatialPhysics.solve(&request, &mut scene);

        assert_eq!(batch.events.len(), 0);
        assert_eq!(batch.solved.len(), 1);
        let solved = batch.solved[0];
        assert_eq!(solved.actor_id, Guid(0x5000_0001));
        assert_eq!(solved.pose.landblock_id, Guid(0x1234_0000));
        assert_eq!(solved.pose.coords, Vector3::new(1.0, 20.0, 30.0));
        assert_eq!(solved.velocity, Vector3::new(-18.0, 0.0, 0.0));
        assert_eq!(solved.omega, Vector3::zero());
        assert_eq!(solved.contact, ContactState::Unknown);
    }
}
