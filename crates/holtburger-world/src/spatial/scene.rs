use super::{
    AuthoritativeBodySync, BasicSpatialPhysics, CollisionQueryError, CollisionScene, ContactState,
    PhysicalBodyActuation, PhysicalBodyDefinition, PhysicalBodyState, PhysicalBodyTickResult,
    RuntimeSpatialBodyView, SolvedBodyKinematics, SpatialBody, SpatialBodyEvent, SpatialBodyId,
    SpatialPhysics, SpatialSampleMode, SpatialSamplingConfig, evaluate_physical_body_activity,
    initial_physical_body_activity, physical_body::solve_physical_body_tick,
    physics::sample_mode_for_projection_state,
};
use crate::entity::EntityMotionSnapshot;
use holtburger_common::position::WorldPosition;
use holtburger_common::{Guid, Vector3};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Instant;

#[derive(Debug, Clone)]
pub(crate) struct SpatialBodyStore {
    bodies: HashMap<SpatialBodyId, SpatialBody>,
    config: SpatialSamplingConfig,
    next_ephemeral_body_id: u64,
}

impl Default for SpatialBodyStore {
    fn default() -> Self {
        Self {
            bodies: HashMap::new(),
            config: SpatialSamplingConfig::default(),
            next_ephemeral_body_id: 1,
        }
    }
}

impl SpatialBodyStore {
    fn config(&self) -> SpatialSamplingConfig {
        self.config
    }

    fn set_config(&mut self, config: SpatialSamplingConfig) {
        self.config = config;
    }

    fn runtime_body_view(&self, body_id: SpatialBodyId) -> Option<RuntimeSpatialBodyView> {
        self.body(body_id).map(SpatialBody::runtime_view)
    }

    fn iter_runtime_body_views(&self) -> impl Iterator<Item = RuntimeSpatialBodyView> + '_ {
        self.bodies.values().map(SpatialBody::runtime_view)
    }

    fn body(&self, body_id: SpatialBodyId) -> Option<&SpatialBody> {
        self.bodies.get(&body_id)
    }

    fn body_for_guid(&self, guid: Guid) -> Option<&SpatialBody> {
        self.body(SpatialBodyId::LocalPlayer(guid))
            .or_else(|| self.body(SpatialBodyId::Entity(guid)))
    }

    fn body_mut(&mut self, body_id: SpatialBodyId) -> Option<&mut SpatialBody> {
        self.bodies.get_mut(&body_id)
    }

    fn register_body(&mut self, body: SpatialBody) -> Option<SpatialBody> {
        self.bodies.insert(body.id, body)
    }

    fn update_body(&mut self, body: SpatialBody) -> Option<SpatialBody> {
        let existing = self.bodies.get_mut(&body.id)?;
        Some(std::mem::replace(existing, body))
    }

    fn remove_body(&mut self, body_id: SpatialBodyId) -> Option<SpatialBody> {
        self.bodies.remove(&body_id)
    }

    fn allocate_ephemeral_body_id(&mut self) -> SpatialBodyId {
        let body_id = SpatialBodyId::Ephemeral(self.next_ephemeral_body_id);
        self.next_ephemeral_body_id += 1;
        body_id
    }

    fn register_ephemeral_body(&mut self, pose: WorldPosition, now: Instant) -> SpatialBodyId {
        let body_id = self.allocate_ephemeral_body_id();
        self.register_body(SpatialBody::new_ephemeral(body_id, pose, now));
        body_id
    }
}

#[derive(Clone)]
pub struct SpatialScene {
    landblock_map: HashMap<Guid, HashSet<Guid>>,
    entity_poses: HashMap<Guid, WorldPosition>,
    body_store: SpatialBodyStore,
    physics: Arc<dyn SpatialPhysics>,
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
            body_store: SpatialBodyStore::default(),
            physics,
        }
    }

    pub fn physics(&self) -> &Arc<dyn SpatialPhysics> {
        &self.physics
    }

    pub fn runtime_sampling_config(&self) -> SpatialSamplingConfig {
        self.body_store.config()
    }

    pub fn set_runtime_sampling_config(&mut self, config: SpatialSamplingConfig) {
        self.body_store.set_config(config);
    }

    pub fn runtime_body_view(&self, body_id: SpatialBodyId) -> Option<RuntimeSpatialBodyView> {
        self.body_store.runtime_body_view(body_id)
    }

    pub fn iter_runtime_body_views(&self) -> impl Iterator<Item = RuntimeSpatialBodyView> + '_ {
        self.body_store.iter_runtime_body_views()
    }

    pub fn body(&self, body_id: SpatialBodyId) -> Option<&SpatialBody> {
        self.body_store.body(body_id)
    }

    pub fn body_for_guid(&self, guid: Guid) -> Option<&SpatialBody> {
        self.body_store.body_for_guid(guid)
    }

    pub fn body_mut(&mut self, body_id: SpatialBodyId) -> Option<&mut SpatialBody> {
        self.body_store.body_mut(body_id)
    }

    pub fn register_body(&mut self, body: SpatialBody) -> Option<SpatialBody> {
        self.body_store.register_body(body)
    }

    pub fn update_body(&mut self, body: SpatialBody) -> Option<SpatialBody> {
        self.body_store.update_body(body)
    }

    pub fn remove_body(&mut self, body_id: SpatialBodyId) -> Option<SpatialBody> {
        self.body_store.remove_body(body_id)
    }

    pub fn allocate_ephemeral_body_id(&mut self) -> SpatialBodyId {
        self.body_store.allocate_ephemeral_body_id()
    }

    pub fn register_ephemeral_body(&mut self, pose: WorldPosition, now: Instant) -> SpatialBodyId {
        self.body_store.register_ephemeral_body(pose, now)
    }

    /// Attaches one source-neutral physical definition to an already registered body.
    pub fn attach_physical_body(
        &mut self,
        body_id: SpatialBodyId,
        definition: PhysicalBodyDefinition,
        response_policy: super::PhysicalBodyResponsePolicy,
        retained_cell: Option<Guid>,
        collision: &CollisionScene,
    ) -> Result<Option<SpatialBodyEvent>, CollisionQueryError> {
        let Some(body) = self.body_store.body_mut(body_id) else {
            return Ok(None);
        };
        let mut physical = PhysicalBodyState::new(definition, response_policy, retained_cell);
        physical.activity = initial_physical_body_activity(collision, body.pose, definition)?;
        let activity = physical.activity.clone();
        body.physical = Some(physical);
        Ok(Some(SpatialBodyEvent::PhysicalActivityChanged {
            body_id,
            activity,
        }))
    }

    /// Revalidates every retained physical body after one complete collision-scene replacement.
    pub fn reevaluate_physical_bodies(
        &mut self,
        collision: &CollisionScene,
    ) -> Result<Vec<SpatialBodyEvent>, CollisionQueryError> {
        let mut events = Vec::new();
        for body in self.body_store.bodies.values_mut() {
            let Some(physical) = body.physical.as_mut() else {
                continue;
            };
            let activity = evaluate_physical_body_activity(collision, body.pose, physical)?;
            if activity == physical.activity {
                continue;
            }
            physical.activity = activity.clone();
            events.push(SpatialBodyEvent::PhysicalActivityChanged {
                body_id: body.id,
                activity,
            });
        }
        Ok(events)
    }

    /// Applies one typed physical-activity transition to an existing matching body.
    pub fn apply_physical_body_activity(
        &mut self,
        body_id: SpatialBodyId,
        activity: super::PhysicalBodyActivity,
    ) -> bool {
        let Some(physical) = self
            .body_store
            .body_mut(body_id)
            .and_then(|body| body.physical.as_mut())
        else {
            return false;
        };
        physical.activity = activity;
        true
    }

    /// Advances one active registered physical body without consulting content or interest policy.
    pub fn tick_physical_body(
        &mut self,
        body_id: SpatialBodyId,
        collision: &CollisionScene,
        actuation: PhysicalBodyActuation,
        delta_seconds: f32,
        now: Instant,
    ) -> anyhow::Result<PhysicalBodyTickResult> {
        self.tick_physical_body_transaction(
            body_id,
            collision,
            actuation,
            delta_seconds,
            now,
            |_, _| Ok(()),
        )
        .map(|(result, ())| result)
    }

    /// Solves one body provisionally and commits it only after its consumer accepts the result.
    ///
    /// The callback sees the complete tentative body and observable result while the scene still
    /// contains the prior state. An error vetoes every body mutation and activity event.
    pub fn tick_physical_body_transaction<T>(
        &mut self,
        body_id: SpatialBodyId,
        collision: &CollisionScene,
        actuation: PhysicalBodyActuation,
        delta_seconds: f32,
        now: Instant,
        accept: impl FnOnce(&SpatialBody, &PhysicalBodyTickResult) -> anyhow::Result<T>,
    ) -> anyhow::Result<(PhysicalBodyTickResult, T)> {
        let body = self
            .body_store
            .body(body_id)
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("physical body {body_id:?} is not registered"))?;
        let prior_activity = body
            .physical
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("spatial body {body_id:?} has no physical definition"))?
            .activity
            .clone();
        let commit = solve_physical_body_tick(collision, &body, actuation, delta_seconds)?;
        let activity_event = (commit.activity != prior_activity).then(|| {
            SpatialBodyEvent::PhysicalActivityChanged {
                body_id,
                activity: commit.activity.clone(),
            }
        });
        let result = PhysicalBodyTickResult {
            outcome: commit.outcome.clone(),
            activity_event,
        };
        let mut tentative = body;
        tentative.pose = commit.pose;
        tentative.velocity = commit.velocity;
        tentative.contact = commit.contact;
        let physical = tentative
            .physical
            .as_mut()
            .expect("physical definition vanished during single-threaded solve");
        physical.response = commit.response;
        physical.activity = commit.activity;
        if matches!(commit.outcome, super::PhysicalBodyTickOutcome::Motion(_)) {
            tentative.sampling.mode = SpatialSampleMode::SimulatingVelocity;
            tentative.sampling.last_derived_at = now;
        }
        let accepted = accept(&tentative, &result)?;
        self.body_store
            .update_body(tentative)
            .expect("physical body vanished during single-threaded solve");
        Ok((result, accepted))
    }

    pub fn reconcile_authoritative_body(
        &mut self,
        body_id: SpatialBodyId,
        pose: WorldPosition,
        velocity: Vector3,
        omega: Vector3,
        sync: AuthoritativeBodySync,
        now: Instant,
    ) {
        let mode = match sync {
            AuthoritativeBodySync::Snapshot => SpatialSampleMode::AuthoritativeOnly,
            AuthoritativeBodySync::Reset => SpatialSampleMode::Suspended,
        };

        let mut body = self
            .body_store
            .remove_body(body_id)
            .unwrap_or_else(|| SpatialBody::new(body_id, pose, now));

        let preserve_local_runtime_pose = matches!(body_id, SpatialBodyId::LocalPlayer(_))
            && matches!(sync, AuthoritativeBodySync::Snapshot)
            && matches!(
                body.sampling.mode,
                SpatialSampleMode::SimulatingMotionState | SpatialSampleMode::SimulatingVelocity
            );

        body.authoritative_pose = Some(pose);
        body.velocity = velocity;
        body.omega = omega;
        body.motion_state = None;
        body.sampling.last_authoritative_update = now;
        body.sampling.last_derived_at = now;
        if !preserve_local_runtime_pose {
            body.pose = pose;
            body.sampling.mode = mode;
        }

        self.body_store.register_body(body);
    }

    pub fn retire_authoritative_body(&mut self, body_id: SpatialBodyId) -> Option<SpatialBody> {
        self.body_store.remove_body(body_id)
    }

    #[cfg(test)]
    pub(super) fn upsert_runtime_body_snapshot(
        &mut self,
        body_id: SpatialBodyId,
        pose: WorldPosition,
        velocity: Vector3,
        omega: Vector3,
        motion_state: Option<EntityMotionSnapshot>,
        now: Instant,
    ) {
        let mut body = self
            .body_store
            .remove_body(body_id)
            .unwrap_or_else(|| SpatialBody::new(body_id, pose, now));

        body.authoritative_pose = Some(pose);
        body.pose = pose;
        body.velocity = velocity;
        body.omega = omega;
        body.motion_state = motion_state;
        body.sampling.mode = SpatialSampleMode::AuthoritativeOnly;
        body.sampling.last_authoritative_update = now;
        body.sampling.last_derived_at = now;

        self.body_store.register_body(body);
    }

    #[cfg(test)]
    pub(super) fn seed_authoritative_body_snapshot(
        &mut self,
        body_id: SpatialBodyId,
        pose: WorldPosition,
        velocity: Vector3,
        omega: Vector3,
        motion_state: Option<EntityMotionSnapshot>,
        now: Instant,
    ) {
        self.upsert_runtime_body_snapshot(body_id, pose, velocity, omega, motion_state, now);
    }

    fn set_body_motion_state(
        &mut self,
        body_id: SpatialBodyId,
        motion_state: Option<EntityMotionSnapshot>,
    ) {
        let Some(body) = self.body_store.body_mut(body_id) else {
            return;
        };

        body.motion_state = motion_state;
    }

    pub fn update_runtime_body_motion_state(
        &mut self,
        body_id: SpatialBodyId,
        motion_state: Option<EntityMotionSnapshot>,
    ) {
        self.set_body_motion_state(body_id, motion_state);
    }

    fn reset_body_from_authority(
        &mut self,
        body_id: SpatialBodyId,
        pose: WorldPosition,
        now: Instant,
        clear_kinematics: bool,
    ) {
        let body = self
            .body_store
            .bodies
            .entry(body_id)
            .or_insert_with(|| SpatialBody::new(body_id, pose, now));

        body.authoritative_pose = Some(pose);
        body.pose = pose;
        if clear_kinematics {
            body.velocity = Vector3::zero();
            body.omega = Vector3::zero();
            body.motion_state = None;
        }
        body.sampling.last_authoritative_update = now;
        body.sampling.last_derived_at = now;
        body.sampling.mode = SpatialSampleMode::AuthoritativeOnly;
    }

    pub fn apply_runtime_body_pose(
        &mut self,
        body_id: SpatialBodyId,
        pose: WorldPosition,
        sample_mode: SpatialSampleMode,
    ) -> bool {
        let Some(body) = self.body_store.body_mut(body_id) else {
            return false;
        };

        body.pose = pose;
        body.sampling.mode = sample_mode;
        true
    }

    pub fn apply_runtime_body_contact(
        &mut self,
        body_id: SpatialBodyId,
        contact: ContactState,
    ) -> bool {
        let Some(body) = self.body_store.body_mut(body_id) else {
            return false;
        };

        body.contact = contact;
        true
    }

    pub fn apply_solved_runtime_body_kinematics(&mut self, solved: &SolvedBodyKinematics) -> bool {
        let Some(body) = self.body_store.body_mut(solved.body_id) else {
            return false;
        };

        body.pose = solved.pose;
        body.velocity = solved.velocity;
        body.omega = solved.omega;
        body.contact = solved.contact;
        body.sampling.mode = sample_mode_for_projection_state(
            solved.projection_state,
            solved.velocity,
            solved.omega,
        );
        true
    }

    pub fn apply_forced_reposition_reset(
        &mut self,
        body_id: SpatialBodyId,
        pose: WorldPosition,
        now: Instant,
    ) {
        self.reset_body_from_authority(body_id, pose, now, true);
        if let Some(body) = self.body_store.body_mut(body_id) {
            body.sampling.mode = SpatialSampleMode::Suspended;
        }
    }

    pub fn suspend_runtime_bodies(&mut self, now: Instant) {
        for body in self.body_store.bodies.values_mut() {
            if let Some(authoritative_pose) = body.authoritative_pose {
                body.pose = authoritative_pose;
            }
            body.sampling.mode = SpatialSampleMode::Suspended;
            body.sampling.last_derived_at = now;
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

    pub fn get_in_landblock(&self, lb: Guid) -> Option<&HashSet<Guid>> {
        self.landblock_map.get(&lb)
    }

    pub fn get_nearby_entities(&self, lb: Guid) -> HashSet<Guid> {
        let mut nearby = HashSet::new();

        let x = (lb >> 24) & 0xFF;
        let y = (lb >> 16) & 0xFF;

        for dx in -1..=1 {
            for dy in -1..=1 {
                let nx = x as i32 + dx;
                let ny = y as i32 + dy;
                if nx > 0 && nx < 255 && ny > 0 && ny < 255 {
                    let neighbor_lb = ((nx as u32) << 24) | ((ny as u32) << 16) | 0xFFFF;
                    if let Some(set) = self.landblock_map.get(&Guid(neighbor_lb)) {
                        for &guid in set {
                            nearby.insert(guid);
                        }
                    }
                }
            }
        }

        if let Some(set) = self.landblock_map.get(&lb) {
            for &guid in set {
                nearby.insert(guid);
            }
        }

        nearby
    }

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
mod physical_body_tests {
    use super::*;
    use crate::{
        EdgeProtection, GroundSupport, GroundedBodyActuation, GroundedConfig, GroundedLaunch,
        InvalidPhysicalBodyPlacement, PhysicalBodyActivity, PhysicalBodyDefinition,
        PhysicalBodyResponsePolicy, PhysicalBodyResponseState, PhysicalBodyTickOutcome,
        PhysicalBodyTickStatus, PhysicalElasticity, PhysicalFlyConfig, PhysicalFriction,
        PhysicalRestitution, PhysicalSphereSet, PhysicalSurfaceMotion, RETAIL_WALKABLE_NORMAL_Z,
    };
    use holtburger_common::{Plane, Quaternion, Sphere};
    use holtburger_content::{
        CellCollisionPortal, CellCollisionPortalTarget, CellVolume, LandblockColliders,
        LandblockCollisionAsset, LandblockPlacement, LandblockTerrain,
        TERRAIN_WATER_COLLISION_DEPTH, TerrainCellDiagonals, TerrainCollisionSurface,
    };
    use std::time::Duration;

    const FLY_CONFIG: PhysicalFlyConfig = PhysicalFlyConfig {
        maximum_substep_distance: 0.25,
        maximum_substeps: 32,
        maximum_contact_passes: 8,
        separation_epsilon: 0.000_5,
    };
    const GROUNDED_CONFIG: GroundedConfig = GroundedConfig {
        gravity: -9.8,
        walkable_normal_z: RETAIL_WALKABLE_NORMAL_Z,
        step_up_height: 0.6,
        step_down_height: 1.5,
        edge_protection: EdgeProtection::Creature,
        maximum_substep_distance: 0.25,
        maximum_substeps: 32,
        maximum_contact_passes: 8,
        separation_epsilon: 0.000_5,
    };
    const WATER_TERRAIN_SAMPLE: u16 = 0x10 << 2;

    fn pose(coords: Vector3) -> WorldPosition {
        WorldPosition {
            landblock_id: Guid(0xda55_0020),
            coords,
            rotation: Quaternion::identity(),
        }
    }

    fn free_definition(center: Vector3, radius: f32) -> PhysicalBodyDefinition {
        PhysicalBodyDefinition::free_sphere(
            PhysicalSphereSet::new(Sphere { center, radius }, None).unwrap(),
            FLY_CONFIG,
        )
        .unwrap()
    }

    fn grounded_definition() -> PhysicalBodyDefinition {
        PhysicalBodyDefinition::grounded(
            PhysicalSphereSet::new(
                Sphere {
                    center: Vector3::new(0.0, 0.0, 0.475),
                    radius: 0.48,
                },
                Some(Sphere {
                    center: Vector3::new(0.0, 0.0, 1.35),
                    radius: 0.48,
                }),
            )
            .unwrap(),
            GROUNDED_CONFIG,
        )
        .unwrap()
    }

    fn grounded_definition_with_spheres(spheres: PhysicalSphereSet) -> PhysicalBodyDefinition {
        PhysicalBodyDefinition::grounded(spheres, GROUNDED_CONFIG).unwrap()
    }

    fn stable_policy() -> PhysicalBodyResponsePolicy {
        PhysicalBodyResponsePolicy {
            restitution: PhysicalRestitution::Elastic(PhysicalElasticity::DEFAULT),
            friction: PhysicalFriction::DEFAULT,
            surface_motion: PhysicalSurfaceMotion::Stable,
            align_path: false,
        }
    }

    fn collision_scene(center_cell: Option<u16>) -> CollisionScene {
        let mut collision = CollisionScene::new();
        for y in 0x53u32..=0x57 {
            for x in 0xd8u32..=0xdc {
                collision
                    .insert(LandblockCollisionAsset {
                        landblock_id: (x << 24) | (y << 16) | 0xffff,
                        terrain: TerrainCollisionSurface { cells: Vec::new() },
                        static_geometry: LandblockColliders {
                            colliders: Vec::new(),
                            cell_volumes: if x == 0xda && y == 0x55 {
                                center_cell
                                    .map(|cell_selector| {
                                        vec![CellVolume {
                                            cell_selector,
                                            placement: LandblockPlacement {
                                                origin: Vector3::zero(),
                                                orientation: Quaternion::identity(),
                                            },
                                            planes: Vec::new(),
                                            portals: Vec::new(),
                                        }]
                                    })
                                    .unwrap_or_default()
                            } else {
                                Vec::new()
                            },
                        },
                    })
                    .unwrap();
            }
        }
        collision
    }

    fn flat_collision_scene() -> CollisionScene {
        flat_collision_scene_with_sample(0)
    }

    fn flat_collision_scene_with_sample(terrain_sample: u16) -> CollisionScene {
        let mut collision = collision_scene(None);
        collision
            .insert(LandblockCollisionAsset {
                landblock_id: 0xda55_ffff,
                terrain: TerrainCollisionSurface::from_terrain(&LandblockTerrain {
                    grid_size: 9,
                    tile_size: 24.0,
                    height_indices: vec![0; 81],
                    heights: vec![0.0; 81],
                    terrain_samples: vec![terrain_sample; 81],
                    cell_diagonals: TerrainCellDiagonals::for_landblock(0xda55_ffff),
                })
                .unwrap(),
                static_geometry: LandblockColliders::default(),
            })
            .unwrap();
        collision
    }

    fn thin_cell_collision_scene() -> CollisionScene {
        let mut collision = collision_scene(None);
        collision
            .insert(LandblockCollisionAsset {
                landblock_id: 0xda55_ffff,
                terrain: TerrainCollisionSurface { cells: Vec::new() },
                static_geometry: LandblockColliders {
                    colliders: Vec::new(),
                    cell_volumes: vec![CellVolume {
                        cell_selector: 0x0100,
                        placement: LandblockPlacement {
                            origin: Vector3::zero(),
                            orientation: Quaternion::identity(),
                        },
                        planes: vec![
                            Plane {
                                normal: Vector3::new(1.0, 0.0, 0.0),
                                d: -100.0,
                            },
                            Plane {
                                normal: Vector3::new(-1.0, 0.0, 0.0),
                                d: 100.2,
                            },
                        ],
                        portals: vec![
                            CellCollisionPortal {
                                plane: Plane {
                                    normal: Vector3::new(-1.0, 0.0, 0.0),
                                    d: 100.0,
                                },
                                positive_side: true,
                                target: CellCollisionPortalTarget::Outdoor,
                                outdoor_building: None,
                            },
                            CellCollisionPortal {
                                plane: Plane {
                                    normal: Vector3::new(1.0, 0.0, 0.0),
                                    d: -100.2,
                                },
                                positive_side: true,
                                target: CellCollisionPortalTarget::Outdoor,
                                outdoor_building: None,
                            },
                        ],
                    }],
                },
            })
            .unwrap();
        collision
    }

    #[test]
    fn entity_and_ephemeral_bodies_share_one_parameterized_store_contract() {
        let collision = collision_scene(None);
        let now = Instant::now();
        let mut scene = SpatialScene::new();
        let entity_id = SpatialBodyId::Entity(Guid(0x5000_0001));
        scene.register_body(SpatialBody::new(
            entity_id,
            pose(Vector3::new(96.0, 96.0, 20.0)),
            now,
        ));
        let ephemeral_id = scene.register_ephemeral_body(pose(Vector3::new(97.0, 96.0, 20.0)), now);
        scene
            .attach_physical_body(
                entity_id,
                grounded_definition(),
                stable_policy(),
                None,
                &collision,
            )
            .unwrap();
        scene
            .attach_physical_body(
                ephemeral_id,
                free_definition(Vector3::new(0.2, -0.1, 0.3), 0.27),
                stable_policy(),
                None,
                &collision,
            )
            .unwrap();

        assert!(matches!(
            scene
                .body(entity_id)
                .unwrap()
                .physical
                .as_ref()
                .unwrap()
                .definition,
            PhysicalBodyDefinition::Grounded { .. }
        ));
        assert!(matches!(
            scene
                .body(ephemeral_id)
                .unwrap()
                .physical
                .as_ref()
                .unwrap()
                .definition,
            PhysicalBodyDefinition::FreeSphere { .. }
        ));
    }

    #[test]
    fn body_identity_authority_does_not_change_the_resolved_definition() {
        let collision = collision_scene(None);
        let now = Instant::now();
        let mut scene = SpatialScene::new();
        let entity = SpatialBodyId::Entity(Guid(0x5000_0001));
        let local_player = SpatialBodyId::LocalPlayer(Guid(0x5000_0002));
        let ephemeral = SpatialBodyId::Ephemeral(99);
        let definition = free_definition(Vector3::new(0.2, -0.1, 0.3), 0.27);
        for body_id in [entity, local_player] {
            scene.register_body(SpatialBody::new(
                body_id,
                pose(Vector3::new(96.0, 96.0, 20.0)),
                now,
            ));
        }
        scene.register_body(SpatialBody::new_ephemeral(
            ephemeral,
            pose(Vector3::new(96.0, 96.0, 20.0)),
            now,
        ));
        for body_id in [entity, local_player, ephemeral] {
            scene
                .attach_physical_body(body_id, definition, stable_policy(), None, &collision)
                .unwrap();
        }

        let definitions = [entity, local_player, ephemeral].map(|body_id| {
            scene
                .body(body_id)
                .unwrap()
                .physical
                .as_ref()
                .unwrap()
                .definition
        });
        assert_eq!(definitions, [definition; 3]);
    }

    #[test]
    fn rejected_tick_transaction_preserves_the_complete_body() {
        let collision = collision_scene(None);
        let now = Instant::now();
        let mut scene = SpatialScene::new();
        let id = scene.register_ephemeral_body(pose(Vector3::new(96.0, 96.0, 20.0)), now);
        scene
            .attach_physical_body(
                id,
                free_definition(Vector3::zero(), 0.25),
                stable_policy(),
                None,
                &collision,
            )
            .unwrap();
        let before = scene.body(id).unwrap().clone();

        let error = scene
            .tick_physical_body_transaction(
                id,
                &collision,
                PhysicalBodyActuation::free_flight(Vector3::new(3.0, 0.0, 0.0)).unwrap(),
                0.1,
                now + Duration::from_millis(100),
                |_, _| -> anyhow::Result<()> { anyhow::bail!("adapter rejected presentation") },
            )
            .unwrap_err();

        assert_eq!(error.to_string(), "adapter rejected presentation");
        assert_eq!(scene.body(id).unwrap(), &before);
    }

    #[test]
    fn sledding_support_retains_gravity_and_friction_for_one_or_two_spheres() {
        let collision = flat_collision_scene();
        let now = Instant::now();
        let definitions = [
            grounded_definition_with_spheres(
                PhysicalSphereSet::new(
                    Sphere {
                        center: Vector3::new(0.0, 0.0, 0.475),
                        radius: 0.48,
                    },
                    None,
                )
                .unwrap(),
            ),
            grounded_definition(),
        ];

        for (index, definition) in definitions.into_iter().enumerate() {
            let mut scene = SpatialScene::new();
            let start = Vector3::new(90.0 + index as f32, 96.0, 0.005);
            let id = scene.register_ephemeral_body(pose(start), now);
            let sledding = PhysicalBodyResponsePolicy {
                surface_motion: PhysicalSurfaceMotion::Sledding,
                ..stable_policy()
            };
            scene
                .attach_physical_body(id, definition, sledding, None, &collision)
                .unwrap();
            scene
                .tick_physical_body(
                    id,
                    &collision,
                    PhysicalBodyActuation::Grounded(GroundedBodyActuation::coast()),
                    0.1,
                    now + Duration::from_millis(100),
                )
                .unwrap();
            assert_eq!(scene.body(id).unwrap().contact, ContactState::Grounded);

            scene.body_mut(id).unwrap().velocity = Vector3::new(3.0, 0.0, 0.0);
            scene
                .tick_physical_body(
                    id,
                    &collision,
                    PhysicalBodyActuation::Grounded(GroundedBodyActuation::coast()),
                    0.1,
                    now + Duration::from_millis(200),
                )
                .unwrap();
            let solved = scene.body(id).unwrap();
            let expected_horizontal_velocity = 3.0 * (1.0_f32 - 0.95).powf(0.1);
            assert!((solved.velocity.x - expected_horizontal_velocity).abs() < 0.000_1);
            assert!((solved.velocity.z + 0.98).abs() < 0.000_1);
            assert_eq!(solved.contact, ContactState::Grounded);
            assert!(solved.pose.coords.x > start.x);
        }
    }

    #[test]
    fn unclassified_grounded_body_drives_while_first_tick_acquires_support() {
        let collision = flat_collision_scene();
        let now = Instant::now();
        let mut scene = SpatialScene::new();
        let start = Vector3::new(90.0, 96.0, 0.005);
        let id = scene.register_ephemeral_body(pose(start), now);
        scene
            .attach_physical_body(id, grounded_definition(), stable_policy(), None, &collision)
            .unwrap();

        scene
            .tick_physical_body(
                id,
                &collision,
                PhysicalBodyActuation::grounded_drive(Vector3::new(3.0, 0.0, 0.0)).unwrap(),
                0.1,
                now + Duration::from_millis(100),
            )
            .unwrap();

        let solved = scene.body(id).unwrap();
        assert_eq!(solved.contact, ContactState::Grounded);
        assert!((solved.pose.coords.x - (start.x + 0.3)).abs() < 0.000_1);
        assert!((solved.velocity.x - 3.0).abs() < 0.000_1);
    }

    #[test]
    fn free_body_impacts_apply_default_maximum_zero_and_inelastic_response() {
        let collision = flat_collision_scene();
        let now = Instant::now();
        let cases = [
            (
                PhysicalRestitution::Elastic(PhysicalElasticity::DEFAULT),
                Vector3::new(3.0, 0.0, 1.0),
            ),
            (
                PhysicalRestitution::Elastic(PhysicalElasticity::MAXIMUM),
                Vector3::new(3.0, 0.0, 2.0),
            ),
            (
                PhysicalRestitution::Elastic(PhysicalElasticity::ZERO),
                Vector3::new(3.0, 0.0, 0.0),
            ),
            (PhysicalRestitution::Inelastic, Vector3::zero()),
        ];

        for (index, (restitution, expected_velocity)) in cases.into_iter().enumerate() {
            let mut scene = SpatialScene::new();
            let id = scene
                .register_ephemeral_body(pose(Vector3::new(80.0 + index as f32, 96.0, 2.0)), now);
            let policy = PhysicalBodyResponsePolicy {
                restitution,
                ..stable_policy()
            };
            scene
                .attach_physical_body(
                    id,
                    free_definition(Vector3::zero(), 0.25),
                    policy,
                    None,
                    &collision,
                )
                .unwrap();
            scene
                .tick_physical_body(
                    id,
                    &collision,
                    PhysicalBodyActuation::free_flight(Vector3::new(3.0, 0.0, -20.0)).unwrap(),
                    0.1,
                    now + Duration::from_millis(100),
                )
                .unwrap();
            let actual = scene.body(id).unwrap().velocity;
            assert!(
                (actual - expected_velocity).length() < 0.000_1,
                "unexpected response for {restitution:?}: {actual:?}"
            );
        }
    }

    #[test]
    fn missing_coverage_freezes_all_body_state_until_an_ordinary_resumed_tick() {
        let now = Instant::now();
        let mut scene = SpatialScene::new();
        let id = scene.register_ephemeral_body(pose(Vector3::new(96.0, 96.0, 20.0)), now);
        scene
            .attach_physical_body(
                id,
                free_definition(Vector3::new(0.1, 0.0, 0.2), 0.25),
                stable_policy(),
                None,
                &CollisionScene::new(),
            )
            .unwrap();
        let retained = scene.body(id).unwrap().clone();

        let dormant = scene
            .tick_physical_body(
                id,
                &CollisionScene::new(),
                PhysicalBodyActuation::free_flight(Vector3::new(10.0, 0.0, 0.0)).unwrap(),
                1.0,
                now + Duration::from_secs(10),
            )
            .unwrap();

        assert!(matches!(
            dormant.outcome,
            PhysicalBodyTickOutcome::Inactive {
                activity: PhysicalBodyActivity::AwaitingCoverage(_),
                ..
            }
        ));
        assert_eq!(scene.body(id).unwrap(), &retained);

        let collision = collision_scene(None);
        let resumed = scene.reevaluate_physical_bodies(&collision).unwrap();
        assert_eq!(resumed.len(), 1);
        assert!(matches!(
            resumed[0],
            SpatialBodyEvent::PhysicalActivityChanged {
                activity: PhysicalBodyActivity::Active,
                ..
            }
        ));
        let moved = scene
            .tick_physical_body(
                id,
                &collision,
                PhysicalBodyActuation::free_flight(Vector3::new(1.0, 0.0, 0.0)).unwrap(),
                0.1,
                now + Duration::from_secs(11),
            )
            .unwrap();
        assert!(matches!(
            moved.outcome,
            PhysicalBodyTickOutcome::Motion(ref motion)
                if motion.status == PhysicalBodyTickStatus::Solved
        ));
        assert!((scene.body(id).unwrap().pose.coords.x - 96.1).abs() < 0.000_1);
    }

    #[test]
    fn grounded_launch_is_atomic_and_later_airborne_drive_cannot_replace_it() {
        let collision = collision_scene(None);
        let now = Instant::now();
        let mut scene = SpatialScene::new();
        let id = scene.register_ephemeral_body(pose(Vector3::new(96.0, 96.0, 20.0)), now);
        scene
            .attach_physical_body(id, grounded_definition(), stable_policy(), None, &collision)
            .unwrap();
        let stored = scene.body_mut(id).unwrap();
        stored.contact = ContactState::Grounded;
        let PhysicalBodyResponseState::Grounded { support, .. } =
            &mut stored.physical.as_mut().unwrap().response
        else {
            panic!("grounded definition produced non-grounded response state")
        };
        *support = Some(GroundSupport {
            normal: Vector3::new(0.0, 0.0, 1.0),
        });

        let launch = GroundedLaunch::new(Vector3::new(2.0, 3.0, 5.0)).unwrap();
        let actuation = GroundedBodyActuation::drive(Vector3::zero())
            .unwrap()
            .with_launch(launch);
        scene
            .tick_physical_body(
                id,
                &collision,
                PhysicalBodyActuation::Grounded(actuation),
                0.1,
                now + Duration::from_millis(100),
            )
            .unwrap();
        let launched = scene.body(id).unwrap();
        assert_eq!(launched.contact, ContactState::Airborne);
        assert!((launched.velocity - Vector3::new(2.0, 3.0, 4.02)).length() < 0.000_1);

        let airborne_heading = 1.25;
        scene
            .tick_physical_body(
                id,
                &collision,
                PhysicalBodyActuation::Grounded(
                    GroundedBodyActuation::drive(Vector3::new(100.0, 0.0, 0.0))
                        .unwrap()
                        .with_control_heading(airborne_heading)
                        .unwrap(),
                ),
                0.1,
                now + Duration::from_millis(200),
            )
            .unwrap();
        let airborne = scene.body(id).unwrap();
        assert!((airborne.velocity - Vector3::new(2.0, 3.0, 3.04)).length() < 0.000_1);
        assert!((airborne.pose.rotation.to_heading() - airborne_heading).abs() < 0.000_1);
    }

    #[test]
    fn stable_support_remains_motionless_for_one_or_two_spheres() {
        let collision = flat_collision_scene();
        let now = Instant::now();
        let definitions = [
            grounded_definition_with_spheres(
                PhysicalSphereSet::new(
                    Sphere {
                        center: Vector3::new(0.0, 0.0, 0.475),
                        radius: 0.48,
                    },
                    None,
                )
                .unwrap(),
            ),
            grounded_definition(),
        ];

        for (index, definition) in definitions.into_iter().enumerate() {
            let mut scene = SpatialScene::new();
            let start = Vector3::new(90.0 + index as f32, 96.0, 0.005);
            let id = scene.register_ephemeral_body(pose(start), now);
            scene
                .attach_physical_body(id, definition, stable_policy(), None, &collision)
                .unwrap();
            for tick in 1..=100 {
                scene
                    .tick_physical_body(
                        id,
                        &collision,
                        PhysicalBodyActuation::Grounded(GroundedBodyActuation::coast()),
                        0.1,
                        now + Duration::from_millis(tick * 100),
                    )
                    .unwrap();
            }
            let body = scene.body(id).unwrap();
            assert_eq!(body.contact, ContactState::Grounded);
            assert_eq!(body.pose.coords, start);
            assert_eq!(body.velocity, Vector3::zero());
        }
    }

    #[test]
    fn grounded_body_uses_the_generic_water_adjusted_collision_mesh() {
        let collision = flat_collision_scene_with_sample(WATER_TERRAIN_SAMPLE);
        let now = Instant::now();
        let mut scene = SpatialScene::new();
        let start = Vector3::new(96.0, 96.0, 0.005);
        let id = scene.register_ephemeral_body(pose(start), now);
        scene
            .attach_physical_body(id, grounded_definition(), stable_policy(), None, &collision)
            .unwrap();

        let result = scene
            .tick_physical_body(
                id,
                &collision,
                PhysicalBodyActuation::Grounded(GroundedBodyActuation::coast()),
                0.1,
                now + Duration::from_millis(100),
            )
            .unwrap();
        let PhysicalBodyTickOutcome::Motion(motion) = result.outcome else {
            panic!("covered water contact unexpectedly became inactive")
        };
        let body = scene.body(id).unwrap();
        assert!(motion.grounded);
        assert_eq!(body.contact, ContactState::Grounded);
        assert!((body.pose.coords.z - (start.z - TERRAIN_WATER_COLLISION_DEPTH)).abs() < 0.002);
    }

    #[test]
    fn missing_coverage_holds_canonical_velocity_without_deferring_launch() {
        let now = Instant::now();
        let mut scene = SpatialScene::new();
        let id = scene.register_ephemeral_body(pose(Vector3::new(96.0, 96.0, 20.0)), now);
        scene
            .attach_physical_body(
                id,
                grounded_definition(),
                stable_policy(),
                None,
                &CollisionScene::new(),
            )
            .unwrap();
        let stored = scene.body_mut(id).unwrap();
        stored.velocity = Vector3::new(1.0, 2.0, -3.0);
        stored.contact = ContactState::Grounded;
        let PhysicalBodyResponseState::Grounded { support, .. } =
            &mut stored.physical.as_mut().unwrap().response
        else {
            panic!("grounded definition produced non-grounded response state")
        };
        *support = Some(GroundSupport {
            normal: Vector3::new(0.0, 0.0, 1.0),
        });
        let retained = scene.body(id).unwrap().clone();

        let launch = GroundedLaunch::new(Vector3::new(8.0, 0.0, 6.0)).unwrap();
        let actuation = GroundedBodyActuation::drive(Vector3::zero())
            .unwrap()
            .with_launch(launch);
        let held = scene
            .tick_physical_body(
                id,
                &CollisionScene::new(),
                PhysicalBodyActuation::Grounded(actuation),
                0.1,
                now + Duration::from_millis(100),
            )
            .unwrap();
        assert!(matches!(
            held.outcome,
            PhysicalBodyTickOutcome::Inactive { .. }
        ));
        assert_eq!(scene.body(id).unwrap(), &retained);

        let collision = collision_scene(None);
        scene.reevaluate_physical_bodies(&collision).unwrap();
        scene
            .tick_physical_body(
                id,
                &collision,
                PhysicalBodyActuation::grounded_drive(Vector3::zero()).unwrap(),
                0.1,
                now + Duration::from_millis(200),
            )
            .unwrap();
        let resumed = scene.body(id).unwrap();
        assert_eq!(resumed.pose.coords, retained.pose.coords);
        assert_eq!(resumed.velocity, Vector3::zero());
        assert_eq!(resumed.contact, ContactState::Grounded);
    }

    #[test]
    fn retained_env_cell_resumes_only_against_compatible_restored_topology() {
        let now = Instant::now();
        let cell = Guid(0xda55_0100);
        let with_cell = collision_scene(Some(0x0100));
        let mut scene = SpatialScene::new();
        let id = scene.register_ephemeral_body(
            WorldPosition {
                landblock_id: cell,
                ..pose(Vector3::new(96.0, 96.0, 20.0))
            },
            now,
        );
        scene
            .attach_physical_body(
                id,
                free_definition(Vector3::zero(), 0.25),
                stable_policy(),
                Some(cell),
                &with_cell,
            )
            .unwrap();
        assert_eq!(
            scene.body(id).unwrap().physical.as_ref().unwrap().activity,
            PhysicalBodyActivity::Active
        );

        scene
            .reevaluate_physical_bodies(&CollisionScene::new())
            .unwrap();
        assert!(matches!(
            scene.body(id).unwrap().physical.as_ref().unwrap().activity,
            PhysicalBodyActivity::AwaitingCoverage(_)
        ));
        assert_eq!(
            scene.reevaluate_physical_bodies(&with_cell).unwrap().len(),
            1
        );
        assert_eq!(
            scene
                .body(id)
                .unwrap()
                .physical
                .as_ref()
                .unwrap()
                .response
                .cell(),
            Some(cell)
        );

        let incompatible = collision_scene(None);
        let invalid = scene.reevaluate_physical_bodies(&incompatible).unwrap();
        assert_eq!(invalid.len(), 1);
        assert!(matches!(
            invalid[0],
            SpatialBodyEvent::PhysicalActivityChanged {
                activity: PhysicalBodyActivity::InvalidPlacement(
                    InvalidPhysicalBodyPlacement::RetainedCellUnavailable(current)
                ),
                ..
            } if current == cell
        ));
        assert!(
            scene
                .reevaluate_physical_bodies(&incompatible)
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn offset_free_sphere_publishes_body_reference_motion_across_a_landblock_seam() {
        let collision = collision_scene(None);
        let now = Instant::now();
        let mut scene = SpatialScene::new();
        let id = scene.register_ephemeral_body(pose(Vector3::new(191.9, 96.0, 20.0)), now);
        scene
            .attach_physical_body(
                id,
                free_definition(Vector3::new(0.2, 0.0, 0.0), 0.25),
                stable_policy(),
                None,
                &collision,
            )
            .unwrap();

        let result = scene
            .tick_physical_body(
                id,
                &collision,
                PhysicalBodyActuation::free_flight(Vector3::new(2.0, 0.0, 0.0)).unwrap(),
                0.1,
                now + Duration::from_millis(100),
            )
            .unwrap();
        let PhysicalBodyTickOutcome::Motion(motion) = result.outcome else {
            panic!("covered seam tick unexpectedly became inactive")
        };

        assert!((motion.path.final_point().center().x - 192.1).abs() < 0.000_1);
        assert_eq!(
            scene.body(id).unwrap().pose.landblock_coords(),
            (0xdb, 0x55)
        );
        assert!((scene.body(id).unwrap().pose.coords.x - 0.1).abs() < 0.000_1);
        assert_eq!(
            scene
                .body(id)
                .unwrap()
                .physical
                .as_ref()
                .unwrap()
                .response_policy,
            stable_policy()
        );
    }

    #[test]
    fn generic_body_motion_preserves_thin_cell_entry_and_exit_with_same_end_placement() {
        let collision = thin_cell_collision_scene();
        let now = Instant::now();
        let mut scene = SpatialScene::new();
        let id = scene.register_ephemeral_body(pose(Vector3::new(99.8, 10.0, 20.0)), now);
        scene
            .attach_physical_body(
                id,
                free_definition(Vector3::zero(), 0.1),
                stable_policy(),
                None,
                &collision,
            )
            .unwrap();

        let result = scene
            .tick_physical_body(
                id,
                &collision,
                PhysicalBodyActuation::free_flight(Vector3::new(0.6, 0.0, 0.0)).unwrap(),
                1.0,
                now + Duration::from_secs(1),
            )
            .unwrap();
        let PhysicalBodyTickOutcome::Motion(motion) = result.outcome else {
            panic!("covered thin-cell route unexpectedly became inactive")
        };

        assert_eq!(motion.path.initial().placement().committed_cell(), None);
        assert!(
            motion
                .path
                .legs()
                .iter()
                .any(|leg| { leg.end().placement().committed_cell() == Some(Guid(0xda55_0100)) })
        );
        assert_eq!(motion.path.final_point().placement().committed_cell(), None);
        assert!((motion.path.final_point().center().x - 100.4).abs() < 0.000_1);
        assert_eq!(
            scene
                .body(id)
                .unwrap()
                .physical
                .as_ref()
                .unwrap()
                .response_policy,
            stable_policy()
        );
    }

    #[test]
    fn generic_body_commits_the_placement_repaired_by_its_motion_path() {
        let cell = Guid(0xda55_0100);
        let mut collision = collision_scene(None);
        collision
            .insert(LandblockCollisionAsset {
                landblock_id: 0xda55_ffff,
                terrain: TerrainCollisionSurface { cells: Vec::new() },
                static_geometry: LandblockColliders {
                    colliders: Vec::new(),
                    cell_volumes: vec![CellVolume {
                        cell_selector: 0x0100,
                        placement: LandblockPlacement {
                            origin: Vector3::zero(),
                            orientation: Quaternion::identity(),
                        },
                        planes: vec![Plane {
                            normal: Vector3::new(-1.0, 0.0, 0.0),
                            d: 100.0,
                        }],
                        portals: Vec::new(),
                    }],
                },
            })
            .unwrap();
        let now = Instant::now();
        let mut scene = SpatialScene::new();
        let id = scene.register_ephemeral_body(
            WorldPosition {
                landblock_id: cell,
                ..pose(Vector3::new(99.8, 10.0, 20.0))
            },
            now,
        );
        scene
            .attach_physical_body(
                id,
                free_definition(Vector3::zero(), 0.1),
                stable_policy(),
                Some(cell),
                &collision,
            )
            .unwrap();

        let result = scene
            .tick_physical_body(
                id,
                &collision,
                PhysicalBodyActuation::free_flight(Vector3::new(0.4, 0.0, 0.0)).unwrap(),
                1.0,
                now + Duration::from_secs(1),
            )
            .unwrap();
        let PhysicalBodyTickOutcome::Motion(motion) = result.outcome else {
            panic!("covered recovery tick unexpectedly became inactive")
        };
        let committed = scene.body(id).unwrap();

        assert_eq!(motion.path.final_point().placement().committed_cell(), None);
        assert!(motion.path.final_point().recovery().is_some());
        assert!(!committed.pose.is_indoors());
        assert_eq!(committed.physical.as_ref().unwrap().response.cell(), None);
    }

    #[test]
    fn held_body_commits_placement_only_recovery_without_geometric_motion() {
        let cell = Guid(0xda55_0100);
        let mut collision = collision_scene(None);
        collision
            .insert(LandblockCollisionAsset {
                landblock_id: 0xda55_ffff,
                terrain: TerrainCollisionSurface { cells: Vec::new() },
                static_geometry: LandblockColliders {
                    colliders: Vec::new(),
                    cell_volumes: vec![CellVolume {
                        cell_selector: 0x0100,
                        placement: LandblockPlacement {
                            origin: Vector3::zero(),
                            orientation: Quaternion::identity(),
                        },
                        planes: vec![Plane {
                            normal: Vector3::new(-1.0, 0.0, 0.0),
                            d: 100.0,
                        }],
                        portals: Vec::new(),
                    }],
                },
            })
            .unwrap();
        let now = Instant::now();
        let start = Vector3::new(100.2, 10.0, 20.0);
        let mut scene = SpatialScene::new();
        let id = scene.register_ephemeral_body(
            WorldPosition {
                landblock_id: cell,
                ..pose(start)
            },
            now,
        );
        scene
            .attach_physical_body(
                id,
                free_definition(Vector3::zero(), 0.1),
                stable_policy(),
                Some(cell),
                &collision,
            )
            .unwrap();

        let result = scene
            .tick_physical_body(
                id,
                &collision,
                PhysicalBodyActuation::free_flight(Vector3::new(100.0, 0.0, 0.0)).unwrap(),
                1.0,
                now + Duration::from_secs(1),
            )
            .unwrap();
        let PhysicalBodyTickOutcome::Motion(motion) = result.outcome else {
            panic!("covered held tick unexpectedly became inactive")
        };
        let committed = scene.body(id).unwrap();

        assert_eq!(motion.status, PhysicalBodyTickStatus::SubstepBudgetExceeded);
        assert!(motion.path.has_recovery());
        assert_eq!(committed.pose.coords, start);
        assert!(!committed.pose.is_indoors());
        assert_eq!(committed.physical.as_ref().unwrap().response.cell(), None);
    }
}
