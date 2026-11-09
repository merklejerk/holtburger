//! Read-only camera collision over one coherent environment/entity publication.

use super::{
    CollisionQueryPolicy, CollisionScene, EntityCollisionSnapshot, SpatialBodyId,
    SpatialMembership, StaticContact, StaticSphereSweepHit, StaticSphereSweepRequest,
    UncoveredCollisionQuery,
};
use anyhow::Result;
use holtburger_common::position::WorldPosition;
use holtburger_common::{Guid, Vector3};
use holtburger_content::TerrainCollisionSurfaceKind;
use std::collections::BTreeSet;

/// Collision operations required by unregistered sphere motion and camera clearance.
/// Environment-only callers and cameras share the solver while supplying explicit obstacles.
pub trait SphereCollisionQuery {
    /// Immutable topology and authored world surfaces for this query.
    fn environment(&self) -> &CollisionScene;
    /// Terrain geometry shared by this query's sweeps, settlement, and recovery paths.
    fn terrain_surface(&self) -> TerrainCollisionSurfaceKind;
    /// Entity penetration contacts admitted for the supplied placement.
    fn entity_contacts(
        &self,
        anchor: Guid,
        center: Vector3,
        radius: f32,
        placement: &SpatialMembership,
    ) -> Result<Vec<StaticContact>>;
    /// Continuous entity-only obstruction; recovery separately admits its starting static solids.
    fn entity_sweep_sphere(
        &self,
        request: StaticSphereSweepRequest,
    ) -> Result<Option<StaticSphereSweepHit>>;
    /// Earliest obstruction under the caller's explicit coverage policy.
    fn sweep_sphere(
        &self,
        request: StaticSphereSweepRequest,
        policy: CollisionQueryPolicy,
    ) -> Result<UncoveredCollisionQuery<Option<StaticSphereSweepHit>>>;
}

impl SphereCollisionQuery for CollisionScene {
    fn environment(&self) -> &CollisionScene {
        self
    }
    fn terrain_surface(&self) -> TerrainCollisionSurfaceKind {
        TerrainCollisionSurfaceKind::Immersed
    }
    fn entity_sweep_sphere(
        &self,
        _: StaticSphereSweepRequest,
    ) -> Result<Option<StaticSphereSweepHit>> {
        Ok(None)
    }
    fn entity_contacts(
        &self,
        _: Guid,
        _: Vector3,
        _: f32,
        _: &SpatialMembership,
    ) -> Result<Vec<StaticContact>> {
        Ok(Vec::new())
    }
    fn sweep_sphere(
        &self,
        request: StaticSphereSweepRequest,
        policy: CollisionQueryPolicy,
    ) -> Result<UncoveredCollisionQuery<Option<StaticSphereSweepHit>>> {
        Ok(self.sweep_static_sphere_with_policy(request, policy)?)
    }
}

/// Borrowed camera query: geometry is shared; exclusions belong to this camera instance.
pub struct CameraCollisionQuery<'a> {
    /// Immutable world collision paired with the entity capture.
    pub environment: &'a CollisionScene,
    /// Optional entity obstacles; environment-only camera queries retain authored terrain.
    pub entities: Option<&'a EntityCollisionSnapshot>,
    /// Bodies excluded by the camera owner, including the followed body.
    pub excluded: &'a BTreeSet<SpatialBodyId>,
}

impl SphereCollisionQuery for CameraCollisionQuery<'_> {
    fn environment(&self) -> &CollisionScene {
        self.environment
    }
    fn terrain_surface(&self) -> TerrainCollisionSurfaceKind {
        // Retail behavior is to collide the viewer against terrain without water immersion.
        TerrainCollisionSurfaceKind::Authored
    }
    fn entity_sweep_sphere(
        &self,
        request: StaticSphereSweepRequest,
    ) -> Result<Option<StaticSphereSweepHit>> {
        let Some(entities) = self.entities else {
            return Ok(None);
        };
        self.environment
            .sweep_camera_entity_sphere(entities, self.excluded, request)
    }
    fn entity_contacts(
        &self,
        anchor: Guid,
        center: Vector3,
        radius: f32,
        placement: &SpatialMembership,
    ) -> Result<Vec<StaticContact>> {
        let Some(entities) = self.entities else {
            return Ok(Vec::new());
        };
        let extent = Vector3::new(radius, radius, radius);
        let mut contacts = Vec::new();
        for id in
            entities
                .index
                .candidates(None, anchor, center - extent, center + extent, placement)
        {
            let target = &entities.targets[&id];
            if self.excluded.contains(&id) || !target.camera_solid {
                continue;
            }
            let local = WorldPosition {
                landblock_id: anchor,
                coords: center,
                rotation: holtburger_common::Quaternion::identity(),
            }
            .reanchor_to_landblock_owner(target.anchor)?
            .coords;
            for shape in target
                .shapes
                .iter()
                .filter(|shape| shape.bounds.intersects_sphere(local, radius))
            {
                contacts.extend(
                    super::volume_query::placed_shape_contacts(shape, local, radius)
                        .into_iter()
                        .map(|contact| StaticContact {
                            normal: contact.normal,
                            depth: contact.depth,
                        }),
                );
            }
        }
        Ok(contacts)
    }
    fn sweep_sphere(
        &self,
        request: StaticSphereSweepRequest,
        policy: CollisionQueryPolicy,
    ) -> Result<UncoveredCollisionQuery<Option<StaticSphereSweepHit>>> {
        self.environment.sweep_camera_sphere(
            self.entities,
            self.excluded,
            request,
            policy,
            self.terrain_surface(),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::spatial::{
        FreeSphereSettleConfig, FreeSphereSettleOutcome, FreeSphereState,
        PhysicalCollisionExclusions, PhysicalCollisionFilter, settle_free_sphere_with_policy,
    };
    use holtburger_common::Quaternion;
    use holtburger_content::{
        LandblockCollisionAsset, LandblockTerrain, TERRAIN_GRID_CELLS,
        TERRAIN_WATER_COLLISION_DEPTH, TerrainCellDiagonals, TerrainCollisionSurface,
    };

    const OWNER: Guid = Guid(0xda55_ffff);
    const WATER: u16 = 0x10 << 2;
    const RADIUS: f32 = 0.15;
    const TOLERANCE: f32 = 0.001;

    fn terrain(samples: Vec<u16>) -> TerrainCollisionSurface {
        let side = TERRAIN_GRID_CELLS + 1;
        TerrainCollisionSurface::from_terrain(&LandblockTerrain {
            grid_size: side,
            tile_size: 24.0,
            height_indices: vec![0; side * side],
            heights: vec![0.0; side * side],
            terrain_samples: samples,
            cell_diagonals: TerrainCellDiagonals::for_landblock(OWNER.0),
        })
        .unwrap()
    }

    fn scene(terrain: TerrainCollisionSurface) -> CollisionScene {
        let mut scene = CollisionScene::new();
        scene
            .insert(LandblockCollisionAsset {
                landblock_id: OWNER.0,
                terrain,
                static_geometry: Default::default(),
            })
            .unwrap();
        scene
    }

    fn viewer_filter() -> PhysicalCollisionFilter {
        PhysicalCollisionFilter::excluding(PhysicalCollisionExclusions::ENTIRELY_WATER_BARRIER)
    }

    #[test]
    fn camera_and_movement_sweeps_use_their_own_water_surface_and_normals() {
        let count = (TERRAIN_GRID_CELLS + 1).pow(2);
        let mut shoreline = vec![0; count];
        shoreline[0] = WATER;
        for samples in [vec![0; count], vec![WATER; count], shoreline] {
            let terrain = terrain(samples);
            let cell = &terrain.cells[0];
            let centroid = cell.authored_triangles[0]
                .vertices
                .iter()
                .copied()
                .fold(Vector3::zero(), |sum, vertex| sum + vertex)
                / 3.0;
            let request = StaticSphereSweepRequest {
                anchor: OWNER,
                start: centroid + Vector3::new(0.0, 0.0, 3.0),
                displacement: Vector3::new(0.0, 0.0, -6.0),
                radius: RADIUS,
                previous_cell: None,
                filter: viewer_filter(),
            };
            let expected_hits =
                [&cell.authored_triangles[0], &cell.immersed_triangles[0]].map(|triangle| {
                    (
                        (triangle.normal.dot(&(request.start - triangle.vertices[0])) - RADIUS)
                            / -triangle.normal.dot(&request.displacement),
                        triangle.normal,
                    )
                });
            let scene = scene(terrain);
            let entities = EntityCollisionSnapshot::compile([]).unwrap();
            let excluded = BTreeSet::new();
            let camera = CameraCollisionQuery {
                environment: &scene,
                entities: Some(&entities),
                excluded: &excluded,
            };
            for (query, expected) in [
                (&camera as &dyn SphereCollisionQuery, expected_hits[0]),
                (&scene, expected_hits[1]),
            ] {
                let hit = query
                    .sweep_sphere(request, CollisionQueryPolicy::RequireCollisionCoverage)
                    .unwrap()
                    .value
                    .unwrap();
                assert!(
                    (hit.time_of_impact - expected.0).abs() < TOLERANCE,
                    "{hit:?} vs {expected:?}"
                );
                assert!((hit.normal - expected.1).length() < TOLERANCE);
            }
        }
    }

    #[test]
    fn camera_recovers_a_seed_completely_below_water_while_movement_remains_immersed() {
        let scene = scene(terrain(vec![WATER; (TERRAIN_GRID_CELLS + 1).pow(2)]));
        let entities = EntityCollisionSnapshot::compile([]).unwrap();
        let excluded = BTreeSet::new();
        let camera = CameraCollisionQuery {
            environment: &scene,
            entities: Some(&entities),
            excluded: &excluded,
        };
        let center = Vector3::new(12.0, 10.0, RADIUS - TERRAIN_WATER_COLLISION_DEPTH);
        let body = FreeSphereState {
            pose: WorldPosition {
                landblock_id: OWNER,
                coords: center,
                rotation: Quaternion::identity(),
            },
            cell: None,
            radius: RADIUS,
        };
        let config = FreeSphereSettleConfig {
            maximum_contact_passes: 16,
            separation_epsilon: TOLERANCE,
        };
        for (query, expected_z) in [
            (&camera as &dyn SphereCollisionQuery, RADIUS),
            (&scene, center.z),
        ] {
            let outcome = settle_free_sphere_with_policy(
                query,
                config,
                body,
                viewer_filter(),
                CollisionQueryPolicy::RequireCollisionCoverage,
            )
            .unwrap();
            let FreeSphereSettleOutcome::Settled { body, .. } = outcome else {
                panic!("{outcome:?}")
            };
            assert!(
                (body.pose.coords.z - expected_z).abs() <= TOLERANCE * 2.0,
                "{body:?}"
            );
        }
    }
}
