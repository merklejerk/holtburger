//! Portal-scoped entity-selection broad phase over ordinary authoritative residency.

use std::collections::BTreeSet;

use holtburger_common::position::METERS_PER_LANDBLOCK;
use holtburger_common::properties::{
    PropertyBool, PropertyDataId, WorldObjectPropertyAccessors as _,
};
use holtburger_common::{Guid, Vector3};
use thiserror::Error;

use super::{
    CollisionQueryError, CollisionScene, PhysicalCollisionFilter, StaticSurfaceRayRequest,
    point_between_landblocks,
};
use crate::WorldState;

/// Camera ray normalized into one outdoor anchor frame.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct EntitySelectionRayRequest {
    pub anchor: Guid,
    pub start: Vector3,
    pub direction: Vector3,
    pub previous_cell: Option<Guid>,
}

/// Why an otherwise valid selection query could not prove its complete static path.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntitySelectionUnavailable {
    MissingCollisionOwner { owner: Guid },
}

/// One complete host broad-phase answer. Browser pose geometry remains the exact picker.
#[derive(Debug, Clone, PartialEq)]
pub struct AvailableEntitySelectionCandidates {
    pub static_limit_distance: f32,
    pub candidate_guids: Vec<Guid>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum EntitySelectionCandidateResult {
    Available(AvailableEntitySelectionCandidates),
    Unavailable(EntitySelectionUnavailable),
}

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum EntitySelectionQueryError {
    #[error(transparent)]
    Collision(#[from] CollisionQueryError),
    #[error("attached entity 0x{child:08X} references missing ancestor 0x{ancestor:08X}")]
    MissingAttachmentAncestor { child: Guid, ancestor: Guid },
    #[error("attachment ancestry for entity 0x{child:08X} contains a cycle at 0x{ancestor:08X}")]
    CyclicAttachmentAncestry { child: Guid, ancestor: Guid },
}

impl WorldState {
    /// Returns every ordinary-residency candidate before browser animated-mesh refinement.
    pub fn query_entity_selection_candidates(
        &self,
        collision: &CollisionScene,
        request: EntitySelectionRayRequest,
    ) -> Result<EntitySelectionCandidateResult, EntitySelectionQueryError> {
        let static_request = StaticSurfaceRayRequest {
            anchor: request.anchor,
            start: request.start,
            direction: request.direction,
            maximum_distance: METERS_PER_LANDBLOCK,
            previous_cell: request.previous_cell,
            filter: PhysicalCollisionFilter::ALL,
        };
        let trace = match collision.trace_selection_ray(static_request) {
            Ok(trace) => trace,
            Err(CollisionQueryError::UnavailableOwner { owner }) => {
                return Ok(EntitySelectionCandidateResult::Unavailable(
                    EntitySelectionUnavailable::MissingCollisionOwner { owner: Guid(owner) },
                ));
            }
            Err(error) => return Err(error.into()),
        };
        // RETAIL DIVERGENCE: retail refines drawable polygons after portal-view acceptance and does
        // not compare against static collision (`acclient.c:363547-363620`, `437720-437776`). This
        // one Client-mode acquisition query clips at collision to prevent through-wall selection;
        // no server-authoritative or authored-content consumer observes the difference.
        let static_limit_distance = trace
            .static_hit
            .as_ref()
            .map_or(METERS_PER_LANDBLOCK, |hit| hit.distance);
        let mut candidate_guids = Vec::new();

        for entity in self.entities.iter() {
            if entity.get_bool_prop(PropertyBool::UiHidden) {
                continue;
            }
            if entity.attachment.is_some() {
                // World-placed entities prove setup-backed eligibility by having a prepared
                // envelope. Attachments deliberately bypass that envelope, so retain the same
                // prerequisite explicitly before admitting their inherited scope.
                if entity.get_data_prop(PropertyDataId::Setup).is_none() {
                    continue;
                }
                let ancestor = self.world_placed_attachment_ancestor(entity.guid)?;
                let Some(body_id) = self.runtime_body_id_for_guid(ancestor) else {
                    return Err(EntitySelectionQueryError::MissingAttachmentAncestor {
                        child: entity.guid,
                        ancestor,
                    });
                };
                let body = self.scene.body(body_id).ok_or(
                    EntitySelectionQueryError::MissingAttachmentAncestor {
                        child: entity.guid,
                        ancestor,
                    },
                )?;
                if body.spatial_membership().intersects_reached(&trace.reached) {
                    candidate_guids.push(entity.guid);
                }
                continue;
            }

            let Some(body_id) = self.runtime_body_id_for_guid(entity.guid) else {
                continue;
            };
            let Some(body) = self.scene.body(body_id) else {
                continue;
            };
            // RETAIL DIVERGENCE: retail tests animated parts admitted by render portal traversal
            // (`acclient.c:363547-363620`, `437720-437776`). Reusing ordinary body residency can
            // omit a visual envelope protruding into the ray's adjacent scope; the focused boundary
            // fixture records one such miss. The 2026-09-03 outdoor and dungeon live grids observed
            // no such miss across 154 rays. Correcting it requires separate visual membership.
            if !body.spatial_membership().intersects_reached(&trace.reached) {
                continue;
            }
            let Some(envelope) = entity.selection_envelope else {
                continue;
            };
            let center = point_between_landblocks(
                body.pose.coords,
                body.pose.landblock_id.0,
                request.anchor.0,
            );
            let radius = envelope.radius() * entity.scale.effective();
            if finite_ray_hits_sphere(
                request.start,
                request.direction,
                static_limit_distance,
                center,
                radius,
            ) {
                candidate_guids.push(entity.guid);
            }
        }

        candidate_guids.sort_unstable();
        Ok(EntitySelectionCandidateResult::Available(
            AvailableEntitySelectionCandidates {
                static_limit_distance,
                candidate_guids,
            },
        ))
    }

    fn world_placed_attachment_ancestor(
        &self,
        child: Guid,
    ) -> Result<Guid, EntitySelectionQueryError> {
        let mut visited = BTreeSet::from([child]);
        let mut current = child;
        loop {
            let entity = self.entities.get(current).ok_or(
                EntitySelectionQueryError::MissingAttachmentAncestor {
                    child,
                    ancestor: current,
                },
            )?;
            let Some(attachment) = entity.attachment else {
                return Ok(current);
            };
            if !visited.insert(attachment.parent) {
                return Err(EntitySelectionQueryError::CyclicAttachmentAncestry {
                    child,
                    ancestor: attachment.parent,
                });
            }
            current = attachment.parent;
        }
    }
}

fn finite_ray_hits_sphere(
    start: Vector3,
    direction: Vector3,
    maximum_distance: f32,
    center: Vector3,
    radius: f32,
) -> bool {
    let offset = center - start;
    let projected = offset.dot(&direction).clamp(0.0, maximum_distance);
    let closest = start + direction * projected;
    (center - closest).length_squared() <= radius * radius
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use holtburger_common::properties::{
        PropertyBool, PropertyDataId, WorldObjectPropertyAccessorsMut as _,
    };
    use holtburger_common::{ParentLocation, Placement, Plane, Quaternion};
    use holtburger_content::{
        CellCollisionPortal, CellCollisionPortalTarget, CellVolume, ColliderScale, CollisionBall,
        CollisionShape, LandblockColliders, LandblockCollisionAsset, LandblockPlacement,
        PlacedCollider, StaticColliderPlacement, TerrainCollisionSurface,
    };

    use super::*;
    use crate::{PhysicsAttachment, SelectionEnvelope, entity::Entity};

    const OWNER: Guid = Guid(0xda55_ffff);

    fn position(x: f32, y: f32) -> holtburger_common::position::WorldPosition {
        holtburger_common::position::WorldPosition {
            landblock_id: Guid(OWNER.0 & 0xffff_0000),
            coords: Vector3::new(x, y, 1.0),
            rotation: Quaternion::identity(),
        }
    }

    fn scene_with_wall(x: f32) -> CollisionScene {
        let wall = PlacedCollider::new(
            Arc::new(CollisionShape::Ball(CollisionBall {
                center: Vector3::zero(),
                radius: 1.0,
            })),
            LandblockPlacement {
                origin: Vector3::new(x, 10.0, 1.0),
                orientation: Quaternion::identity(),
            },
            ColliderScale::uniform(1.0).unwrap(),
            StaticColliderPlacement::OutdoorExplicit { source_index: 0 },
        )
        .unwrap();
        let mut scene = CollisionScene::new();
        scene
            .insert(LandblockCollisionAsset {
                landblock_id: OWNER.0,
                terrain: TerrainCollisionSurface::empty(),
                static_geometry: LandblockColliders::new(vec![wall], Vec::new()),
            })
            .unwrap();
        scene
    }

    fn portal_scene() -> (CollisionScene, Guid, Guid, Guid) {
        let source = Guid(0xda55_010a);
        let target = Guid(0xda55_010b);
        let disconnected = Guid(0xda55_010c);
        let volume = |selector, portals| CellVolume {
            cell_selector: selector,
            placement: LandblockPlacement {
                origin: Vector3::zero(),
                orientation: Quaternion::identity(),
            },
            planes: Vec::new(),
            portals,
        };
        let mut scene = CollisionScene::new();
        scene
            .insert(LandblockCollisionAsset {
                landblock_id: OWNER.0,
                terrain: TerrainCollisionSurface::empty(),
                static_geometry: LandblockColliders::new(
                    Vec::new(),
                    vec![
                        volume(
                            0x010a,
                            vec![CellCollisionPortal {
                                plane: Plane {
                                    normal: Vector3::new(1.0, 0.0, 0.0),
                                    d: -10.0,
                                },
                                positive_side: true,
                                target: CellCollisionPortalTarget::EnvCell(0x010b),
                                outdoor_building: None,
                            }],
                        ),
                        volume(0x010b, Vec::new()),
                        volume(0x010c, Vec::new()),
                    ],
                ),
            })
            .unwrap();
        (scene, source, target, disconnected)
    }

    fn request() -> EntitySelectionRayRequest {
        EntitySelectionRayRequest {
            anchor: OWNER,
            start: Vector3::new(0.0, 10.0, 1.0),
            direction: Vector3::new(1.0, 0.0, 0.0),
            previous_cell: None,
        }
    }

    fn ready_entity(world: &mut WorldState, guid: Guid, x: f32, radius: f32) {
        let entity = Entity::new(guid, "candidate".to_owned(), position(x, 10.0));
        world.add_entity(entity);
        assert!(world.install_entity_selection_envelope(
            guid,
            0,
            SelectionEnvelope::new(radius).unwrap(),
        ));
    }

    #[test]
    fn direct_spheres_are_clipped_by_static_geometry_and_sorted_by_guid() {
        let collision = scene_with_wall(50.0);
        let mut world = WorldState::synthetic();
        ready_entity(&mut world, Guid(30), 70.0, 2.0);
        ready_entity(&mut world, Guid(20), 20.0, 2.0);
        ready_entity(&mut world, Guid(10), 30.0, 2.0);

        let EntitySelectionCandidateResult::Available(result) = world
            .query_entity_selection_candidates(&collision, request())
            .unwrap()
        else {
            panic!("installed collision owner should cover the ray");
        };
        assert_eq!(result.candidate_guids, vec![Guid(10), Guid(20)]);
        assert!((result.static_limit_distance - 49.0).abs() < 0.000_1);
    }

    #[test]
    fn pending_envelope_omits_only_that_entity() {
        let collision = scene_with_wall(50.0);
        let mut world = WorldState::synthetic();
        ready_entity(&mut world, Guid(10), 20.0, 2.0);
        let pending = Guid(20);
        world.add_entity(Entity::new(
            pending,
            "pending".to_owned(),
            position(30.0, 10.0),
        ));

        let EntitySelectionCandidateResult::Available(result) = world
            .query_entity_selection_candidates(&collision, request())
            .unwrap()
        else {
            panic!("installed collision owner should cover the ray");
        };
        assert_eq!(result.candidate_guids, vec![Guid(10)]);
    }

    #[test]
    fn attached_entity_inherits_parent_scope_without_a_host_envelope() {
        let collision = scene_with_wall(50.0);
        let mut world = WorldState::synthetic();
        let parent = Guid(10);
        ready_entity(&mut world, parent, 20.0, 2.0);
        let child = Guid(20);
        let mut attached = Entity::new(child, "attached".to_owned(), position(0.0, 0.0));
        attached.set_did_prop(PropertyDataId::Setup, Guid(0x0200_0001));
        attached.attachment = Some(PhysicsAttachment {
            parent,
            location: ParentLocation::RightHand,
            placement: Placement::RightHandCombat,
        });
        world.entities.insert(attached);

        let EntitySelectionCandidateResult::Available(result) = world
            .query_entity_selection_candidates(&collision, request())
            .unwrap()
        else {
            panic!("installed collision owner should cover the ray");
        };
        assert_eq!(result.candidate_guids, vec![parent, child]);
    }

    #[test]
    fn ui_hidden_roots_and_attachments_are_not_selection_candidates() {
        let collision = scene_with_wall(50.0);
        let mut world = WorldState::synthetic();
        let parent = Guid(10);
        ready_entity(&mut world, parent, 20.0, 2.0);
        world
            .entities
            .get_mut(parent)
            .unwrap()
            .set_bool_prop(PropertyBool::UiHidden, true);

        let child = Guid(20);
        let mut attached = Entity::new(child, "hidden attached".to_owned(), position(0.0, 0.0));
        attached.set_did_prop(PropertyDataId::Setup, Guid(0x0200_0001));
        attached.set_bool_prop(PropertyBool::UiHidden, true);
        attached.attachment = Some(PhysicsAttachment {
            parent,
            location: ParentLocation::RightHand,
            placement: Placement::RightHandCombat,
        });
        world.entities.insert(attached);

        let EntitySelectionCandidateResult::Available(result) = world
            .query_entity_selection_candidates(&collision, request())
            .unwrap()
        else {
            panic!("installed collision owner should cover the ray");
        };
        assert!(result.candidate_guids.is_empty());
    }

    #[test]
    fn attachment_without_a_setup_is_not_a_selection_candidate() {
        let collision = scene_with_wall(50.0);
        let mut world = WorldState::synthetic();
        let parent = Guid(10);
        ready_entity(&mut world, parent, 20.0, 2.0);
        let child = Guid(20);
        let mut attached = Entity::new(child, "bare attached".to_owned(), position(0.0, 0.0));
        attached.attachment = Some(PhysicsAttachment {
            parent,
            location: ParentLocation::RightHand,
            placement: Placement::RightHandCombat,
        });
        world.entities.insert(attached);

        let EntitySelectionCandidateResult::Available(result) = world
            .query_entity_selection_candidates(&collision, request())
            .unwrap()
        else {
            panic!("installed collision owner should cover the ray");
        };
        assert_eq!(result.candidate_guids, vec![parent]);
    }

    #[test]
    fn query_reports_missing_collision_coverage_without_an_empty_candidate_lie() {
        let world = WorldState::synthetic();
        let result = world
            .query_entity_selection_candidates(&CollisionScene::new(), request())
            .unwrap();
        assert_eq!(
            result,
            EntitySelectionCandidateResult::Unavailable(
                EntitySelectionUnavailable::MissingCollisionOwner { owner: OWNER }
            )
        );
    }

    #[test]
    fn current_whole_object_scale_is_applied_once_at_query_time() {
        let collision = scene_with_wall(50.0);
        let mut world = WorldState::synthetic();
        let guid = Guid(10);
        world.add_entity(Entity::new(guid, "scaled".to_owned(), position(20.0, 13.5)));
        world.install_entity_selection_envelope(guid, 0, SelectionEnvelope::new(2.0).unwrap());
        assert!(matches!(
            world
                .query_entity_selection_candidates(&collision, request())
                .unwrap(),
            EntitySelectionCandidateResult::Available(result) if result.candidate_guids.is_empty()
        ));

        world
            .entities
            .get_mut(guid)
            .unwrap()
            .scale
            .reconcile(2.0)
            .unwrap();
        let EntitySelectionCandidateResult::Available(result) = world
            .query_entity_selection_candidates(&collision, request())
            .unwrap()
        else {
            panic!("installed collision owner should cover the ray");
        };
        assert_eq!(result.candidate_guids, vec![guid]);
    }

    #[test]
    fn collision_participation_flags_do_not_remove_visual_candidates() {
        use holtburger_common::properties::PhysicsState;

        let collision = scene_with_wall(50.0);
        let mut world = WorldState::synthetic();
        let guid = Guid(10);
        let mut entity = Entity::new(guid, "ethereal mover".to_owned(), position(20.0, 10.0));
        entity.velocity = Vector3::new(3.0, 0.0, 0.0);
        entity
            .physics
            .reconcile(crate::resolve_effective_entity_physics_state(
                PhysicsState::ETHEREAL,
            ));
        world.add_entity(entity);
        world.install_entity_selection_envelope(guid, 0, SelectionEnvelope::new(2.0).unwrap());

        let EntitySelectionCandidateResult::Available(result) = world
            .query_entity_selection_candidates(&collision, request())
            .unwrap()
        else {
            panic!("installed collision owner should cover the ray");
        };
        assert_eq!(result.candidate_guids, vec![guid]);
    }

    #[test]
    fn portal_trace_reaches_connected_exact_cell_and_excludes_overlapping_disconnected_cell() {
        let (collision, source, target, disconnected) = portal_scene();
        let mut world = WorldState::synthetic();
        let connected_guid = Guid(10);
        let disconnected_guid = Guid(20);
        let mut connected_position = position(15.0, 10.0);
        connected_position.landblock_id = target;
        world.add_entity(Entity::new(
            connected_guid,
            "connected".to_owned(),
            connected_position,
        ));
        world.install_entity_selection_envelope(
            connected_guid,
            0,
            SelectionEnvelope::new(2.0).unwrap(),
        );
        let mut disconnected_position = connected_position;
        disconnected_position.landblock_id = disconnected;
        world.add_entity(Entity::new(
            disconnected_guid,
            "disconnected".to_owned(),
            disconnected_position,
        ));
        world.install_entity_selection_envelope(
            disconnected_guid,
            0,
            SelectionEnvelope::new(2.0).unwrap(),
        );

        let EntitySelectionCandidateResult::Available(result) = world
            .query_entity_selection_candidates(
                &collision,
                EntitySelectionRayRequest {
                    previous_cell: Some(source),
                    start: Vector3::new(5.0, 10.0, 1.0),
                    ..request()
                },
            )
            .unwrap()
        else {
            panic!("installed interior owner should cover the ray");
        };
        assert_eq!(result.candidate_guids, vec![connected_guid]);
    }

    #[test]
    fn regular_residency_can_omit_an_envelope_protruding_across_a_portal() {
        let (collision, source, _target, _disconnected) = portal_scene();
        let mut world = WorldState::synthetic();
        let guid = Guid(10);
        let mut source_position = position(9.0, 10.0);
        source_position.landblock_id = source;
        world.add_entity(Entity::new(guid, "boundary".to_owned(), source_position));
        world.install_entity_selection_envelope(guid, 0, SelectionEnvelope::new(4.0).unwrap());

        let EntitySelectionCandidateResult::Available(result) = world
            .query_entity_selection_candidates(
                &collision,
                EntitySelectionRayRequest {
                    previous_cell: Some(Guid(0xda55_010b)),
                    start: Vector3::new(11.0, 10.0, 1.0),
                    ..request()
                },
            )
            .unwrap()
        else {
            panic!("installed interior owner should cover the ray");
        };
        assert!(result.candidate_guids.is_empty());
    }
}
