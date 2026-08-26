//! Deterministic directional contact against one immutable dynamic-body tick snapshot.

use std::collections::BTreeMap;

use anyhow::{Context, Result};
use holtburger_common::position::WorldPosition;
use holtburger_common::properties::PhysicsState;
use holtburger_common::{Guid, Quaternion, Vector3};
use holtburger_content::{CollisionShape, PlacedCollisionShape};

use super::bsp_query::{ShapeContact, placed_polygon_contacts, placed_solid_contacts};
use super::collision::anchor_point_to_cell_position;
use super::collision_report::{
    CollisionReportClassification, CollisionReportContact, CollisionReportSource,
    CollisionReportTouch,
};
use super::dynamic_index::{DynamicShadowIndex, placed_target_shapes};
use super::physical_body::{
    DynamicBodyRuntimeState, PhysicalBodyTickCommit, solve_physical_body_tick,
    trace_body_reference_path,
};
use super::volume_query::{placed_ball_contact, placed_cylinder_contact};
use super::{
    CollisionScene, DynamicBodyPhysicsStateChange, MotionWaypoint, MotionWaypointPlacement,
    PhysicalBodyActuation, PhysicalBodyResponseState, PhysicalRestitution, SpatialBody,
    SpatialBodyId, SpatialMembership,
};
use crate::EntityCollisionParticipation;

/// Maximum root/rotation-relative travel represented by one dynamic narrow-phase slice.
pub const MAXIMUM_DYNAMIC_SLICE_DISTANCE: f32 = 0.05;
/// Finite per-pair narrow-phase budget selected by the R0 catalog and speed census.
pub const MAXIMUM_DYNAMIC_SLICES: usize = 128;

/// One immutable body and its environment-only plan from the collection's tick start.
#[derive(Debug, Clone)]
pub(crate) struct DynamicTickStartBody {
    pub(crate) body: SpatialBody,
    pub(crate) planned: Option<PhysicalBodyTickCommit>,
}

/// Blocking peer accepted by one directional solve.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct DynamicResponseContact {
    pub(crate) peer: SpatialBodyId,
    pub(crate) state_change: Option<DynamicBodyPhysicsStateChange>,
}

/// Confirmed report touches plus the optional blocking peer selected for mover response.
#[derive(Debug, Clone, Default)]
pub(crate) struct DynamicContactResolution {
    pub(crate) response: Option<DynamicResponseContact>,
    pub(crate) report_touches: Vec<CollisionReportTouch>,
}

/// Applies the earliest stable blocking contact to an environment-only body plan.
pub(crate) fn resolve_dynamic_contacts(
    collision: &CollisionScene,
    index: &DynamicShadowIndex,
    tick_start: &BTreeMap<SpatialBodyId, DynamicTickStartBody>,
    mover: &SpatialBody,
    commit: &mut PhysicalBodyTickCommit,
    actuation: &PhysicalBodyActuation,
    delta_seconds: f32,
) -> Result<DynamicContactResolution> {
    let Some(mover_dynamic) = mover
        .physical
        .as_ref()
        .and_then(|physical| physical.dynamic.as_ref())
    else {
        return Ok(DynamicContactResolution::default());
    };
    let mover_reports = mover_dynamic.collision.reporting.enabled;
    let mover_responds = mover_dynamic
        .collision
        .dynamic_collision
        .mover_accepts_response;
    let mover_accepts_peer_reports = mover_dynamic
        .collision
        .dynamic_collision
        .accepts_peer_reports;
    if !mover_reports && !mover_responds && !mover_accepts_peer_reports {
        return Ok(DynamicContactResolution::default());
    }

    let anchor = commit.motion.path.anchor();
    let extent = moving_sphere_extent(mover);
    let (minimum, maximum) = swept_root_bounds(&commit.motion.path, extent);
    let placement = swept_mover_placement(collision, mover, commit)?;
    let candidates = index.candidates(mover.id, anchor, minimum, maximum, &placement);

    let mut selected = None::<SelectedBlockingContact>;
    let mut sampled_report_touches = Vec::new();
    let mut accepted_fraction = 1.0_f32;
    for peer_id in candidates {
        let Some(peer) = tick_start.get(&peer_id) else {
            continue;
        };
        let peer_dynamic = peer
            .body
            .physical
            .as_ref()
            .and_then(|physical| physical.dynamic.as_ref())
            .expect("dynamic index returned a target without dynamic physical state");
        if pair_is_filtered(mover_dynamic, peer_dynamic) {
            continue;
        }
        let mover_report_eligible = mover_reports
            && peer_dynamic
                .collision
                .dynamic_collision
                .accepts_peer_reports;
        let peer_report_eligible = peer_dynamic.collision.reporting.enabled
            && mover_dynamic
                .collision
                .dynamic_collision
                .accepts_peer_reports;
        let response_eligible = mover_responds
            && peer_dynamic.collision.dynamic_collision.target
                == EntityCollisionParticipation::Solid;
        if !mover_report_eligible && !peer_report_eligible && !response_eligible {
            continue;
        }

        let pair = PairTrajectories::new(mover, commit, peer, delta_seconds, anchor)?;
        if !pair.swept_bounds_overlap()? {
            continue;
        }
        let relative_path_length = pair.conservative_relative_path_length()?;
        let slice_distance = pair
            .minimum_collision_scale()?
            .min(MAXIMUM_DYNAMIC_SLICE_DISTANCE);
        let required_slices = required_dynamic_slices(relative_path_length, slice_distance);
        let evaluated_slices = required_slices.min(MAXIMUM_DYNAMIC_SLICES);
        let evaluated_fraction = evaluated_slices as f32 / required_slices as f32;
        accepted_fraction = accepted_fraction.min(evaluated_fraction);

        let Some(contact) = pair.first_contact(evaluated_slices, evaluated_fraction)? else {
            continue;
        };
        if mover_report_eligible {
            sampled_report_touches.push(SampledReportTouch {
                fraction: contact.fraction,
                touch: dynamic_report_touch(mover.id, peer_id, peer_dynamic),
            });
        }
        if peer_report_eligible {
            sampled_report_touches.push(SampledReportTouch {
                fraction: contact.fraction,
                touch: dynamic_report_touch(peer_id, mover.id, mover_dynamic),
            });
        }
        if !response_eligible {
            continue;
        }
        let candidate = SelectedBlockingContact {
            peer: peer_id,
            fraction: contact.fraction,
            contact: contact.contact,
            peer_velocity: pair.peer_velocity(),
            clears_projectile_state: mover_dynamic.collision.dynamic_collision.missile
                && peer_dynamic
                    .collision
                    .dynamic_collision
                    .accepts_peer_reports,
        };
        if selected.as_ref().is_none_or(|current| {
            candidate.fraction < current.fraction
                || (candidate.fraction == current.fraction && candidate.peer < current.peer)
        }) {
            selected = Some(candidate);
        }
    }

    let selected = selected.filter(|contact| contact.fraction <= accepted_fraction);
    let Some(selected) = selected else {
        if accepted_fraction < 1.0 {
            apply_budgeted_prefix(
                collision,
                mover,
                commit,
                actuation,
                delta_seconds,
                accepted_fraction,
            )?;
        }
        return Ok(DynamicContactResolution {
            response: None,
            report_touches: accepted_report_touches(sampled_report_touches, accepted_fraction),
        });
    };
    let report_touches = accepted_report_touches(sampled_report_touches, selected.fraction);
    apply_blocking_contact(collision, mover, commit, actuation, delta_seconds, selected)?;
    Ok(DynamicContactResolution {
        response: Some(DynamicResponseContact {
            peer: selected.peer,
            state_change: selected.clears_projectile_state.then_some(
                DynamicBodyPhysicsStateChange {
                    cleared: PhysicsState::MISSILE
                        | PhysicsState::ALIGN_PATH
                        | PhysicsState::PATH_CLIPPED,
                },
            ),
        }),
        report_touches,
    })
}

#[derive(Debug, Clone, Copy)]
struct SampledReportTouch {
    fraction: f32,
    touch: CollisionReportTouch,
}

fn accepted_report_touches(
    touches: Vec<SampledReportTouch>,
    accepted_fraction: f32,
) -> Vec<CollisionReportTouch> {
    touches
        .into_iter()
        .filter_map(|sampled| (sampled.fraction <= accepted_fraction).then_some(sampled.touch))
        .collect()
}

fn dynamic_report_touch(
    recipient: SpatialBodyId,
    peer: SpatialBodyId,
    source: &DynamicBodyRuntimeState,
) -> CollisionReportTouch {
    CollisionReportTouch {
        contact: CollisionReportContact {
            recipient,
            source: CollisionReportSource::DynamicBody {
                peer,
                classification: if source.collision.reporting.as_environment {
                    CollisionReportClassification::Environment
                } else {
                    CollisionReportClassification::Object
                },
            },
        },
        source_is_ethereal: source.collision.dynamic_collision.target
            == EntityCollisionParticipation::Ethereal,
    }
}

fn pair_is_filtered(mover: &DynamicBodyRuntimeState, peer: &DynamicBodyRuntimeState) -> bool {
    peer.collision.dynamic_collision.missile
        || (mover.collision.dynamic_collision.missile
            && peer.collision.dynamic_collision.target == EntityCollisionParticipation::Ethereal)
}

#[derive(Debug, Clone, Copy)]
struct SampledContact {
    fraction: f32,
    contact: ShapeContact,
}

#[derive(Debug, Clone, Copy)]
struct SelectedBlockingContact {
    peer: SpatialBodyId,
    fraction: f32,
    contact: ShapeContact,
    peer_velocity: Vector3,
    clears_projectile_state: bool,
}

struct PairTrajectories<'a> {
    mover: &'a SpatialBody,
    mover_commit: &'a PhysicalBodyTickCommit,
    peer: &'a DynamicTickStartBody,
    anchor: Guid,
}

impl<'a> PairTrajectories<'a> {
    fn new(
        mover: &'a SpatialBody,
        mover_commit: &'a PhysicalBodyTickCommit,
        peer: &'a DynamicTickStartBody,
        delta_seconds: f32,
        anchor: Guid,
    ) -> Result<Self> {
        anyhow::ensure!(
            delta_seconds.is_finite() && delta_seconds > 0.0,
            "dynamic contact interval must be finite and positive"
        );
        Ok(Self {
            mover,
            mover_commit,
            peer,
            anchor,
        })
    }

    fn conservative_relative_path_length(&self) -> Result<f32> {
        let mover_start = self.mover_pose(0.0)?;
        let mover_end = self.mover_pose(1.0)?;
        let peer_start = self.peer_pose(0.0)?;
        let peer_end = self.peer_pose(1.0)?;
        let relative_translation =
            (mover_end.coords - mover_start.coords) - (peer_end.coords - peer_start.coords);
        Ok(relative_translation.length()
            + quaternion_angle(mover_start.rotation, mover_end.rotation)
                * moving_sphere_extent(self.mover)
            + quaternion_angle(peer_start.rotation, peer_end.rotation)
                * target_furthest_extent(&self.peer.body)?)
    }

    fn swept_bounds_overlap(&self) -> Result<bool> {
        let mover_bounds = swept_root_bounds_in_anchor(
            &self.mover_commit.motion.path,
            moving_sphere_extent(self.mover),
            self.anchor,
        )?;
        let peer_extent = target_furthest_extent(&self.peer.body)?;
        let peer_bounds = if let Some(planned) = &self.peer.planned {
            swept_root_bounds_in_anchor(&planned.motion.path, peer_extent, self.anchor)?
        } else {
            let pose = self
                .peer
                .body
                .pose
                .reanchor_to_landblock_owner(self.anchor)
                .context("could not reanchor stationary peer bounds")?;
            let expansion = Vector3::new(peer_extent, peer_extent, peer_extent);
            (pose.coords - expansion, pose.coords + expansion)
        };
        Ok(bounds_overlap(mover_bounds, peer_bounds))
    }

    fn minimum_collision_scale(&self) -> Result<f32> {
        let mover = self
            .mover
            .physical
            .as_ref()
            .context("dynamic mover lost its physical definition")?
            .definition
            .spheres()
            .iter()
            .map(|sphere| sphere.radius)
            .fold(f32::INFINITY, f32::min);
        let peer = placed_target_shapes(&self.peer.body, self.peer.body.pose, self.anchor)?
            .iter()
            .map(shape_collision_scale)
            .fold(f32::INFINITY, f32::min);
        let selected = mover.min(peer);
        anyhow::ensure!(
            selected.is_finite() && selected > 0.0,
            "dynamic pair has no positive collision scale"
        );
        Ok(selected)
    }

    fn first_contact(&self, slices: usize, end_fraction: f32) -> Result<Option<SampledContact>> {
        for index in 0..=slices {
            let fraction = index as f32 / slices as f32 * end_fraction;
            let mover_pose = self.mover_pose(fraction)?;
            let peer_pose = self.peer_pose(fraction)?;
            let shapes = placed_target_shapes(&self.peer.body, peer_pose, self.anchor)?;
            let mut deepest = None;
            for sphere in self
                .mover
                .physical
                .as_ref()
                .context("dynamic mover lost its physical definition")?
                .definition
                .spheres()
                .iter()
            {
                let center = mover_pose.coords + mover_pose.rotation.rotate_vector(sphere.center);
                for shape in &shapes {
                    if !shape.bounds.intersects_sphere(center, sphere.radius) {
                        continue;
                    }
                    for contact in shape_contacts(shape, center, sphere.radius) {
                        if deepest
                            .as_ref()
                            .is_none_or(|current: &ShapeContact| contact.depth > current.depth)
                        {
                            deepest = Some(contact);
                        }
                    }
                }
            }
            if let Some(contact) = deepest {
                return Ok(Some(SampledContact { fraction, contact }));
            }
        }
        Ok(None)
    }

    fn mover_pose(&self, fraction: f32) -> Result<WorldPosition> {
        sampled_planned_pose(
            &self.mover_commit.motion.path,
            self.mover.pose,
            self.mover_commit.pose.rotation,
            fraction,
            self.anchor,
        )
    }

    fn peer_pose(&self, fraction: f32) -> Result<WorldPosition> {
        let Some(planned) = &self.peer.planned else {
            return self
                .peer
                .body
                .pose
                .reanchor_to_landblock_owner(self.anchor)
                .context("could not reanchor stationary dynamic peer");
        };
        sampled_planned_pose(
            &planned.motion.path,
            self.peer.body.pose,
            planned.pose.rotation,
            fraction,
            self.anchor,
        )
    }

    fn peer_velocity(&self) -> Vector3 {
        self.peer
            .planned
            .as_ref()
            .map_or(self.peer.body.velocity, |planned| planned.velocity)
    }
}

fn apply_budgeted_prefix(
    collision: &CollisionScene,
    mover: &SpatialBody,
    commit: &mut PhysicalBodyTickCommit,
    actuation: &PhysicalBodyActuation,
    delta_seconds: f32,
    accepted_fraction: f32,
) -> Result<()> {
    let partial = solve_physical_body_tick(
        collision,
        mover,
        actuation.clone(),
        delta_seconds * accepted_fraction,
    )?;
    let endpoint = partial.motion.path.final_point().center();
    let mut waypoints = partial
        .motion
        .path
        .legs()
        .iter()
        .filter(|leg| leg.end_fraction() < 1.0)
        .map(|leg| MotionWaypoint {
            center: leg.end().center(),
            end_fraction: leg.end_fraction() * accepted_fraction,
            placement: MotionWaypointPlacement::Committed(leg.end().placement().committed_cell()),
        })
        .collect::<Vec<_>>();
    waypoints.push(MotionWaypoint {
        center: endpoint,
        end_fraction: accepted_fraction,
        placement: MotionWaypointPlacement::Committed(
            partial
                .motion
                .path
                .final_point()
                .placement()
                .committed_cell(),
        ),
    });
    waypoints.push(MotionWaypoint {
        center: endpoint,
        end_fraction: 1.0,
        placement: MotionWaypointPlacement::Traverse,
    });
    let physical = mover
        .physical
        .as_ref()
        .context("dynamic mover lost its physical definition")?;
    let path = trace_body_reference_path(
        collision,
        mover.pose,
        physical.response.cell(),
        physical.definition.spheres().primary(),
        &waypoints,
        false,
    )?;
    *commit = partial;
    commit.motion.path = path;
    commit.motion.status = super::PhysicalBodyTickStatus::SubstepBudgetExceeded;
    Ok(())
}

fn swept_mover_placement(
    collision: &CollisionScene,
    mover: &SpatialBody,
    commit: &PhysicalBodyTickCommit,
) -> Result<SpatialMembership> {
    let mut placement = commit.motion.path.initial().placement().clone();
    for leg in commit.motion.path.legs() {
        placement = placement.merge_reached(leg.end().placement().clone());
    }
    let spheres = mover
        .physical
        .as_ref()
        .context("dynamic mover lost its physical definition")?
        .definition
        .spheres();
    let Some(upper) = spheres.upper_constraint() else {
        return Ok(placement);
    };
    let anchor = commit.motion.path.anchor();
    for (fraction, point) in std::iter::once((0.0, commit.motion.path.initial())).chain(
        commit
            .motion
            .path
            .legs()
            .iter()
            .map(|leg| (leg.end_fraction(), leg.end())),
    ) {
        let pose = sampled_planned_pose(
            &commit.motion.path,
            mover.pose,
            commit.pose.rotation,
            fraction,
            anchor,
        )?;
        let previous_cell = point.placement().committed_cell();
        placement = placement.merge_reached(collision.transit_cell(super::CellTransitRequest {
            previous_cell,
            anchor,
            center: pose.coords + pose.rotation.rotate_vector(upper.center),
            radius: upper.radius,
        })?);
    }
    Ok(placement)
}

fn apply_blocking_contact(
    collision: &CollisionScene,
    mover: &SpatialBody,
    commit: &mut PhysicalBodyTickCommit,
    actuation: &PhysicalBodyActuation,
    delta_seconds: f32,
    selected: SelectedBlockingContact,
) -> Result<()> {
    let contact_fraction = selected
        .fraction
        .max((1.0 / MAXIMUM_DYNAMIC_SLICES as f32).min(1.0));
    let partial_seconds = delta_seconds * contact_fraction;
    let partial = solve_physical_body_tick(collision, mover, actuation.clone(), partial_seconds)?;
    let corrected = partial.motion.path.final_point().center()
        + selected.contact.normal * selected.contact.depth;
    let mut waypoints = partial
        .motion
        .path
        .legs()
        .iter()
        .filter(|leg| leg.end_fraction() < 1.0)
        .map(|leg| MotionWaypoint {
            center: leg.end().center(),
            end_fraction: leg.end_fraction() * contact_fraction,
            placement: MotionWaypointPlacement::Committed(leg.end().placement().committed_cell()),
        })
        .collect::<Vec<_>>();
    waypoints.push(MotionWaypoint {
        center: corrected,
        end_fraction: contact_fraction,
        placement: MotionWaypointPlacement::Traverse,
    });
    if contact_fraction < 1.0 {
        waypoints.push(MotionWaypoint {
            center: corrected,
            end_fraction: 1.0,
            placement: MotionWaypointPlacement::Traverse,
        });
    }
    let physical = mover
        .physical
        .as_ref()
        .context("dynamic mover lost its physical definition")?;
    let primary = physical.definition.spheres().primary();
    let corrected_path = trace_body_reference_path(
        collision,
        mover.pose,
        physical.response.cell(),
        primary,
        &waypoints,
        false,
    )?;
    let cell = corrected_path.final_point().placement().committed_cell();
    commit.pose = partial.pose;
    if let Some(cell) = cell {
        commit.pose = anchor_point_to_cell_position(
            corrected_path.anchor(),
            corrected,
            cell,
            partial.pose.rotation,
        );
    } else {
        commit.pose.landblock_id = partial.motion.path.anchor();
        commit.pose.coords = corrected;
        commit.pose = commit
            .pose
            .normalize_outdoor_landblock_frame()
            .context("could not normalize dynamic contact endpoint")?;
    }
    commit.velocity = dynamic_collision_velocity(
        partial.velocity,
        selected.peer_velocity,
        physical.response_policy.restitution,
        selected.contact.normal,
    );
    commit.response = response_with_cell(partial.response, cell);
    commit.contact = partial.contact;
    commit.motion.path = corrected_path;
    commit.motion.status = partial.motion.status;
    commit.motion.constraint_count = partial.motion.constraint_count;
    commit.motion.substeps = partial.motion.substeps;
    commit.motion.contact_passes = partial.motion.contact_passes;
    commit.environment_contact = partial.environment_contact;
    commit.residual_contacts = partial.residual_contacts;
    Ok(())
}

fn response_with_cell(
    response: PhysicalBodyResponseState,
    cell: Option<Guid>,
) -> PhysicalBodyResponseState {
    match response {
        PhysicalBodyResponseState::FreeSphere { .. } => {
            PhysicalBodyResponseState::FreeSphere { cell }
        }
        PhysicalBodyResponseState::Grounded {
            ground,
            stationary_fall_frames,
            ..
        } => PhysicalBodyResponseState::Grounded {
            cell,
            ground,
            stationary_fall_frames,
        },
    }
}

fn dynamic_collision_velocity(
    mover: Vector3,
    peer: Vector3,
    restitution: PhysicalRestitution,
    normal: Vector3,
) -> Vector3 {
    match restitution {
        PhysicalRestitution::Inelastic => Vector3::zero(),
        PhysicalRestitution::Elastic(elasticity) => {
            let relative = mover - peer;
            let impact_speed = relative.dot(&normal);
            if impact_speed >= 0.0 {
                mover
            } else {
                peer + relative + normal * -(impact_speed * (elasticity.get() + 1.0))
            }
        }
    }
}

fn required_dynamic_slices(relative_path_length: f32, collision_scale: f32) -> usize {
    ((relative_path_length / collision_scale).ceil() as usize).max(1)
}

fn shape_contacts(shape: &PlacedCollisionShape, center: Vector3, radius: f32) -> Vec<ShapeContact> {
    match &*shape.shape {
        CollisionShape::Bsp(solid) => placed_solid_contacts(shape, solid, center, radius, true)
            .into_iter()
            .chain(placed_polygon_contacts(shape, solid, center, radius))
            .collect(),
        CollisionShape::Cylinder(cylinder) => {
            placed_cylinder_contact(shape, cylinder, center, radius)
                .into_iter()
                .collect()
        }
        CollisionShape::Ball(ball) => placed_ball_contact(shape, ball, center, radius)
            .into_iter()
            .collect(),
    }
}

fn shape_collision_scale(shape: &PlacedCollisionShape) -> f32 {
    match &*shape.shape {
        CollisionShape::Bsp(solid) => {
            let scale = shape.scale.components();
            solid.bounds.radius * scale.x.min(scale.y).min(scale.z)
        }
        CollisionShape::Cylinder(cylinder) => {
            cylinder.radius
                * shape
                    .scale
                    .as_uniform()
                    .expect("placed volume scale is uniform")
        }
        CollisionShape::Ball(ball) => {
            ball.radius
                * shape
                    .scale
                    .as_uniform()
                    .expect("placed volume scale is uniform")
        }
    }
}

fn moving_sphere_extent(body: &SpatialBody) -> f32 {
    body.physical
        .as_ref()
        .expect("dynamic body has physical state")
        .definition
        .spheres()
        .iter()
        .map(|sphere| sphere.center.length() + sphere.radius)
        .fold(0.0, f32::max)
}

fn target_furthest_extent(body: &SpatialBody) -> Result<f32> {
    let owner = Guid((body.pose.landblock_id.0 & 0xffff_0000) | 0xffff);
    let local_pose = WorldPosition {
        landblock_id: owner,
        coords: Vector3::zero(),
        rotation: Quaternion::identity(),
    };
    Ok(placed_target_shapes(body, local_pose, owner)?
        .iter()
        .map(|shape| shape.bounds.center().length() + shape.bounds.circumradius())
        .fold(0.0, f32::max))
}

fn swept_root_bounds(path: &super::PlacedMotionPath, extent: f32) -> (Vector3, Vector3) {
    let mut minimum = path.initial().center();
    let mut maximum = minimum;
    for point in path.legs().iter().map(|leg| leg.end()) {
        let center = point.center();
        minimum.x = minimum.x.min(center.x);
        minimum.y = minimum.y.min(center.y);
        minimum.z = minimum.z.min(center.z);
        maximum.x = maximum.x.max(center.x);
        maximum.y = maximum.y.max(center.y);
        maximum.z = maximum.z.max(center.z);
    }
    let expansion = Vector3::new(extent, extent, extent);
    (minimum - expansion, maximum + expansion)
}

fn swept_root_bounds_in_anchor(
    path: &super::PlacedMotionPath,
    extent: f32,
    anchor: Guid,
) -> Result<(Vector3, Vector3)> {
    let mut points = std::iter::once(path.initial())
        .chain(path.legs().iter().map(|leg| leg.end()))
        .map(|point| {
            WorldPosition {
                landblock_id: path.anchor(),
                coords: point.center(),
                rotation: Quaternion::identity(),
            }
            .reanchor_to_landblock_owner(anchor)
            .map(|pose| pose.coords)
            .context("could not reanchor dynamic swept bounds")
        });
    let first = points
        .next()
        .expect("placed motion path always has an initial point")?;
    let mut minimum = first;
    let mut maximum = first;
    for point in points {
        let point = point?;
        minimum.x = minimum.x.min(point.x);
        minimum.y = minimum.y.min(point.y);
        minimum.z = minimum.z.min(point.z);
        maximum.x = maximum.x.max(point.x);
        maximum.y = maximum.y.max(point.y);
        maximum.z = maximum.z.max(point.z);
    }
    let expansion = Vector3::new(extent, extent, extent);
    Ok((minimum - expansion, maximum + expansion))
}

fn bounds_overlap(left: (Vector3, Vector3), right: (Vector3, Vector3)) -> bool {
    left.0.x <= right.1.x
        && left.1.x >= right.0.x
        && left.0.y <= right.1.y
        && left.1.y >= right.0.y
        && left.0.z <= right.1.z
        && left.1.z >= right.0.z
}

fn sampled_planned_pose(
    path: &super::PlacedMotionPath,
    initial: WorldPosition,
    final_rotation: Quaternion,
    fraction: f32,
    anchor: Guid,
) -> Result<WorldPosition> {
    let initial = initial
        .reanchor_to_landblock_owner(path.anchor())
        .context("could not reanchor dynamic trajectory start")?;
    WorldPosition {
        landblock_id: path.anchor(),
        coords: path
            .center_at_fraction(fraction)
            .expect("dynamic trajectory fraction must be normalized"),
        rotation: spherical_lerp(initial.rotation, final_rotation, fraction),
    }
    .reanchor_to_landblock_owner(anchor)
    .context("could not reanchor dynamic trajectory sample")
}

fn spherical_lerp(start: Quaternion, mut end: Quaternion, fraction: f32) -> Quaternion {
    let mut dot = quaternion_dot(start, end);
    if dot < 0.0 {
        end = Quaternion {
            w: -end.w,
            x: -end.x,
            y: -end.y,
            z: -end.z,
        };
        dot = -dot;
    }
    if dot > 0.999_5 {
        return normalized_quaternion_mix(start, end, fraction);
    }
    let theta = dot.clamp(-1.0, 1.0).acos();
    let sin_theta = theta.sin();
    let start_weight = ((1.0 - fraction) * theta).sin() / sin_theta;
    let end_weight = (fraction * theta).sin() / sin_theta;
    Quaternion {
        w: start.w * start_weight + end.w * end_weight,
        x: start.x * start_weight + end.x * end_weight,
        y: start.y * start_weight + end.y * end_weight,
        z: start.z * start_weight + end.z * end_weight,
    }
}

fn normalized_quaternion_mix(start: Quaternion, end: Quaternion, fraction: f32) -> Quaternion {
    let inverse = 1.0 - fraction;
    let mixed = Quaternion {
        w: start.w * inverse + end.w * fraction,
        x: start.x * inverse + end.x * fraction,
        y: start.y * inverse + end.y * fraction,
        z: start.z * inverse + end.z * fraction,
    };
    let length =
        (mixed.w * mixed.w + mixed.x * mixed.x + mixed.y * mixed.y + mixed.z * mixed.z).sqrt();
    if length <= f32::EPSILON {
        start
    } else {
        Quaternion {
            w: mixed.w / length,
            x: mixed.x / length,
            y: mixed.y / length,
            z: mixed.z / length,
        }
    }
}

fn quaternion_angle(start: Quaternion, end: Quaternion) -> f32 {
    (2.0 * quaternion_dot(start, end).abs().clamp(-1.0, 1.0).acos()).min(std::f32::consts::PI)
}

fn quaternion_dot(left: Quaternion, right: Quaternion) -> f32 {
    left.w * right.w + left.x * right.x + left.y * right.y + left.z * right.z
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slice_budget_uses_runtime_constants_at_the_exact_boundary() {
        let boundary = MAXIMUM_DYNAMIC_SLICE_DISTANCE * MAXIMUM_DYNAMIC_SLICES as f32;
        assert_eq!(
            required_dynamic_slices(boundary, MAXIMUM_DYNAMIC_SLICE_DISTANCE),
            MAXIMUM_DYNAMIC_SLICES
        );
        assert_eq!(
            required_dynamic_slices(
                boundary + MAXIMUM_DYNAMIC_SLICE_DISTANCE,
                MAXIMUM_DYNAMIC_SLICE_DISTANCE,
            ),
            MAXIMUM_DYNAMIC_SLICES + 1
        );
    }
}
