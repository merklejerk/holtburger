//! Deterministic directional contact against one immutable dynamic-body tick snapshot.

use std::collections::BTreeMap;

use anyhow::{Context, Result};
use holtburger_common::position::WorldPosition;
use holtburger_common::properties::PhysicsState;
use holtburger_common::{Guid, Quaternion, Vector3};
use holtburger_content::{CollisionShape, PlacedCollisionShape};

use super::bsp_query::{ShapeContact, placed_polygon_contacts, placed_solid_contacts};
use super::collision_report::{
    CollisionReportClassification, CollisionReportContact, CollisionReportSource,
    CollisionReportTouch,
};
use super::dynamic_index::{DynamicShadowIndex, EntityCollisionSnapshot, placed_target_shapes};
use super::physical_body::{
    DynamicBodyRuntimeState, MotionConstraint, PhysicalBodyTickCommit,
    solve_constrained_physical_body_tick, solve_physical_body_tick, trace_body_reference_path,
};
use super::volume_query::{placed_ball_contact, placed_cylinder_contact};
use super::{
    CollisionScene, DynamicBodyPhysicsStateChange, MotionWaypoint, MotionWaypointPlacement,
    PhysicalBodyActuation, PhysicalRestitution, PoseReconciliationState, SpatialBody,
    SpatialBodyId, SpatialMembership,
};
use crate::EntityCollisionParticipation;

/// Maximum root/rotation-relative travel represented by one dynamic narrow-phase slice.
pub const MAXIMUM_DYNAMIC_SLICE_DISTANCE: f32 = 0.05;
/// Finite per-pair narrow-phase budget selected by the R0 catalog and speed census.
pub const MAXIMUM_DYNAMIC_SLICES: usize = 128;
/// Additional tolerated entity contact depth beyond the geometry query's own contact epsilon.
/// RETAIL DIVERGENCE: user-requested tolerant escape replaces unconditional object obstruction;
/// retail selects cylinder slide/step response in acclient.c:347150-347260 and slides attempted
/// displacement in :344024-344137. Restoring directionless overlap blocking recreates the verified
/// escape lock. This policy covers solid ball, cylinder, and BSP entity targets; static geometry
/// and report-touch eligibility keep their existing tolerances.
pub const DYNAMIC_PENETRATION_TOLERANCE: f32 = 0.001;
/// Bounds full environment re-solves when several entity surfaces constrain the same mover.
const MAXIMUM_DYNAMIC_CONTACT_PASSES: usize = 8;
/// Refines a sampled contact to sub-millimeter travel at the ordinary slice distance.
const DYNAMIC_CONTACT_REFINEMENT_STEPS: usize = 10;

/// One immutable dynamic body captured at the collection's tick start.
#[derive(Debug, Clone)]
pub(crate) struct DynamicEpochParticipant {
    /// Unmodified source snapshot used to validate the eventual commit.
    pub(crate) body: SpatialBody,
    /// Query/commit input only when reconciliation changes pose; the common path needs no copy.
    pub(crate) reconciled_body: Option<Box<SpatialBody>>,
    /// Tentative reconciliation cursor, kept inline so cloning the captured body does not allocate.
    pub(crate) reconciliation: Option<PoseReconciliationState>,
    /// Tick-start cursor used to reject a stale prepared commit.
    pub(crate) initial_reconciliation: Option<PoseReconciliationState>,
}

impl DynamicEpochParticipant {
    /// The coherent pose and membership against which this epoch plans motion.
    pub(crate) fn query_body(&self) -> &SpatialBody {
        self.reconciled_body.as_deref().unwrap_or(&self.body)
    }
}

/// One scheduled mover's trajectory inputs while every directional peer query is resolved.
#[derive(Debug, Clone)]
pub(crate) struct PreparedDynamicTrajectory {
    pub(crate) actuation: PhysicalBodyActuation,
    /// Environment-validated motion with current inward overlaps constrained before peer queries.
    pub(crate) plan: PhysicalBodyTickCommit,
    /// Inward constraints established against current overlaps before peers observe this path.
    initial_contacts: Vec<SelectedBlockingContact>,
}

/// Prepares one full-duration environment trajectory. Overlap alone cannot classify movement:
/// separating and tangent motion must remain available before any blocking response is selected.
pub(crate) fn prepare_dynamic_trajectory(
    collision: &CollisionScene,
    index: &DynamicShadowIndex,
    targets: &dyn DynamicContactTargetLookup,
    mover: &SpatialBody,
    actuation: PhysicalBodyActuation,
    delta_seconds: f32,
) -> Result<PreparedDynamicTrajectory> {
    let mut plan = solve_physical_body_tick(collision, mover, &actuation, delta_seconds)?;
    let initial_contacts = initial_movement_contacts(collision, index, targets, mover, &plan)?;
    if !initial_contacts.is_empty() {
        let constraints = initial_contacts
            .iter()
            .map(|contact| MotionConstraint {
                normal: contact.normal,
                minimum: 0.0,
            })
            .collect::<Vec<_>>();
        plan = solve_constrained_physical_body_tick(
            collision,
            mover,
            &actuation,
            delta_seconds,
            &constraints,
        )?;
        apply_contact_velocity(mover, &mut plan, &constraints)?;
    }
    Ok(PreparedDynamicTrajectory {
        actuation,
        plan,
        initial_contacts,
    })
}

/// Read-only body lookup shared by ordinary epochs and sealed speculative target snapshots.
pub(crate) trait DynamicContactTargetLookup {
    fn target_body(&self, body_id: SpatialBodyId) -> Option<&SpatialBody>;
}

impl DynamicContactTargetLookup for BTreeMap<SpatialBodyId, DynamicEpochParticipant> {
    fn target_body(&self, body_id: SpatialBodyId) -> Option<&SpatialBody> {
        self.get(&body_id).map(DynamicEpochParticipant::query_body)
    }
}

impl DynamicContactTargetLookup for EntityCollisionSnapshot {
    fn target_body(&self, body_id: SpatialBodyId) -> Option<&SpatialBody> {
        self.body(body_id)
    }
}

/// Immutable inputs shared by every directional query in one prepared collection.
#[derive(Clone, Copy)]
pub(crate) struct DynamicContactEpoch<'a> {
    pub(crate) collision: &'a CollisionScene,
    pub(crate) index: &'a DynamicShadowIndex,
    pub(crate) targets: &'a dyn DynamicContactTargetLookup,
    pub(crate) trajectories: &'a BTreeMap<SpatialBodyId, PreparedDynamicTrajectory>,
    pub(crate) delta_seconds: f32,
}

/// Blocking peer accepted by one directional solve.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct DynamicResponseContact {
    pub(crate) peer: SpatialBodyId,
    /// Accepted outward normal from the blocking peer toward the mover.
    pub(crate) normal: Vector3,
    pub(crate) state_change: Option<DynamicBodyPhysicsStateChange>,
}

/// Confirmed report touches plus the optional blocking peer selected for mover response.
#[derive(Debug, Clone)]
pub(crate) struct DynamicContactResolution {
    /// Complete environment-validated path after directional entity response.
    pub(crate) plan: PhysicalBodyTickCommit,
    pub(crate) response: Option<DynamicResponseContact>,
    pub(crate) report_touches: Vec<CollisionReportTouch>,
}

/// Applies the earliest stable blocking contact to an environment-only body plan.
pub(crate) fn resolve_dynamic_contacts(
    epoch: DynamicContactEpoch<'_>,
    mover_id: SpatialBodyId,
) -> Result<DynamicContactResolution> {
    let mover = epoch
        .targets
        .target_body(mover_id)
        .context("dynamic mover has no tick-start participant")?;
    resolve_dynamic_contacts_for_mover(epoch, mover)
}

/// Resolves one mover that is not itself retained by the read-only target lookup.
pub(crate) fn resolve_dynamic_contacts_for_mover(
    epoch: DynamicContactEpoch<'_>,
    mover: &SpatialBody,
) -> Result<DynamicContactResolution> {
    let mover_id = mover.id;
    let trajectory = epoch
        .trajectories
        .get(&mover_id)
        .context("dynamic mover has no prepared trajectory")?;
    let mut plan = trajectory.plan.clone();
    let mut constraints = trajectory
        .initial_contacts
        .iter()
        .map(|contact| MotionConstraint {
            normal: contact.normal,
            minimum: 0.0,
        })
        .collect::<Vec<_>>();
    let mut response = trajectory
        .initial_contacts
        .first()
        .map(|contact| contact.response());
    let mut report_touches = Vec::new();
    for pass in 0..=MAXIMUM_DYNAMIC_CONTACT_PASSES {
        let query = query_dynamic_contacts(epoch, mover, &plan)?;
        // A rejected trial path cannot publish report-only triggers that the final slide avoids.
        report_touches.clear();
        report_touches.extend(accepted_report_touches(
            query.report_touches,
            query
                .selected
                .map_or(query.accepted_fraction, |contact| contact.fraction),
        ));
        let Some(contact) = query.selected else {
            if query.accepted_fraction < 1.0 {
                // Budget truncation is revalidated too: solving a shorter interval can change
                // gravity/support paths, so an unchecked second solve is not an accepted prefix.
                plan = truncated_motion_plan(
                    epoch.collision,
                    mover,
                    &trajectory.actuation,
                    epoch.delta_seconds,
                    query.accepted_fraction,
                    &constraints,
                )?;
                apply_contact_velocity(mover, &mut plan, &constraints)?;
                let mut validation = query_dynamic_contacts(epoch, mover, &plan)?;
                if validation.selected.is_some() || validation.accepted_fraction < 1.0 {
                    plan = held_motion_plan(epoch.collision, mover, epoch.delta_seconds)?;
                    validation = query_dynamic_contacts(epoch, mover, &plan)?;
                }
                report_touches = accepted_report_touches(
                    validation.report_touches,
                    validation.accepted_fraction,
                );
                plan.motion.status = super::PhysicalBodyTickStatus::SubstepBudgetExceeded;
            }
            return Ok(DynamicContactResolution {
                plan,
                response,
                report_touches,
            });
        };
        response.get_or_insert(contact.response());
        let start = mover
            .pose
            .reanchor_to_landblock_owner(plan.motion.path.anchor())
            .context("could not reanchor constrained mover")?;
        let end = plan
            .pose
            .reanchor_to_landblock_owner(plan.motion.path.anchor())
            .context("could not reanchor constrained endpoint")?;
        let displacement = end.coords - start.coords;
        let normal_travel = displacement.dot(&contact.normal);
        if pass == MAXIMUM_DYNAMIC_CONTACT_PASSES || normal_travel >= 0.0 {
            // Rotation or an environment-detoured path may not be expressible as a root
            // translation constraint. Retain the previously valid pose instead of pushing it.
            let retained_velocity = plan.retained_velocity;
            plan = held_motion_plan(epoch.collision, mover, epoch.delta_seconds)?;
            plan.retained_velocity = retained_velocity;
            plan.motion.status = super::PhysicalBodyTickStatus::ContactBudgetExceeded;
            let held = query_dynamic_contacts(epoch, mover, &plan)?;
            report_touches = accepted_report_touches(held.report_touches, held.accepted_fraction);
            break;
        }
        constraints.push(MotionConstraint {
            normal: contact.normal,
            minimum: normal_travel * contact.safe_fraction,
        });
        plan = solve_constrained_physical_body_tick(
            epoch.collision,
            mover,
            &trajectory.actuation,
            epoch.delta_seconds,
            &constraints,
        )?;
        apply_contact_velocity(mover, &mut plan, &constraints)?;
    }
    Ok(DynamicContactResolution {
        plan,
        response,
        report_touches,
    })
}

/// Velocity response stays separate from movement clipping; authored drive is never momentum.
fn apply_contact_velocity(
    mover: &SpatialBody,
    plan: &mut PhysicalBodyTickCommit,
    constraints: &[MotionConstraint],
) -> Result<()> {
    let restitution = mover
        .physical
        .as_ref()
        .context("dynamic mover lost physical state")?
        .response_policy
        .restitution;
    for constraint in constraints {
        plan.retained_velocity =
            dynamic_collision_velocity(plan.retained_velocity, restitution, constraint.normal);
    }
    Ok(())
}

/// Only existing overlaps constrain this preliminary path. A following body may use a leader's
/// separating motion, but must not follow a leader's rejected inward motion through a crowd.
fn initial_movement_contacts(
    collision: &CollisionScene,
    index: &DynamicShadowIndex,
    targets: &dyn DynamicContactTargetLookup,
    mover: &SpatialBody,
    plan: &PhysicalBodyTickCommit,
) -> Result<Vec<SelectedBlockingContact>> {
    let physical = mover
        .physical
        .as_ref()
        .context("dynamic mover lost physical state")?;
    let Some(dynamic) = &physical.dynamic else {
        return Ok(Vec::new());
    };
    let anchor = plan.motion.path.anchor();
    let start = mover
        .pose
        .reanchor_to_landblock_owner(anchor)
        .context("could not reanchor mover")?;
    let end = plan
        .pose
        .reanchor_to_landblock_owner(anchor)
        .context("could not reanchor planned mover")?;
    let (minimum, maximum) = swept_root_bounds(&plan.motion.path, moving_sphere_extent(mover));
    let placement = swept_mover_placement(collision, mover, plan)?;
    let mut contacts = Vec::new();
    for peer_id in index.candidates(Some(mover.id), anchor, minimum, maximum, &placement) {
        let Some(peer) = targets.target_body(peer_id) else {
            continue;
        };
        let peer_dynamic = peer
            .physical
            .as_ref()
            .and_then(|physical| physical.dynamic.as_ref())
            .context("indexed peer lost physical state")?;
        if pair_is_filtered(dynamic, peer_dynamic)
            || !PairContactPolicy::new(dynamic, peer_dynamic).response_eligible
        {
            continue;
        }
        let shapes = placed_target_shapes(peer, peer.pose, anchor)?;
        for sphere in physical.definition.spheres().iter() {
            let center = start.coords + start.rotation.rotate_vector(sphere.center);
            let movement = end.coords + end.rotation.rotate_vector(sphere.center) - center;
            for shape in &shapes {
                if !shape.bounds.intersects_sphere(center, sphere.radius) {
                    continue;
                }
                for contact in shape_contacts(shape, center, sphere.radius) {
                    if contact.depth > DYNAMIC_PENETRATION_TOLERANCE
                        && movement.dot(&contact.normal) < -f32::EPSILON
                    {
                        contacts.push(SelectedBlockingContact {
                            peer: peer_id,
                            fraction: 0.0,
                            safe_fraction: 0.0,
                            normal: contact.normal,
                            clears_projectile_state: dynamic.collision.dynamic_collision.missile
                                && peer_dynamic
                                    .collision
                                    .dynamic_collision
                                    .accepts_peer_reports,
                        });
                    }
                }
            }
        }
    }
    Ok(contacts)
}

/// Contacts sampled from a single proposed path; reports and response remain independent.
struct DynamicContactQuery {
    /// Earliest movement-blocking touch, including the safe prefix before it.
    selected: Option<SelectedBlockingContact>,
    /// Report recipients at their first sampled touch.
    report_touches: Vec<SampledReportTouch>,
    /// Portion for which the narrow-phase budget established coverage.
    accepted_fraction: f32,
}

fn query_dynamic_contacts(
    epoch: DynamicContactEpoch<'_>,
    mover: &SpatialBody,
    environment_plan: &PhysicalBodyTickCommit,
) -> Result<DynamicContactQuery> {
    let Some(mover_dynamic) = mover
        .physical
        .as_ref()
        .and_then(|physical| physical.dynamic.as_ref())
    else {
        return Ok(DynamicContactQuery {
            selected: None,
            report_touches: Vec::new(),
            accepted_fraction: 1.0,
        });
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
        return Ok(DynamicContactQuery {
            selected: None,
            report_touches: Vec::new(),
            accepted_fraction: 1.0,
        });
    }

    let anchor = environment_plan.motion.path.anchor();
    let extent = moving_sphere_extent(mover);
    let (minimum, maximum) = swept_root_bounds(&environment_plan.motion.path, extent);
    let placement = swept_mover_placement(epoch.collision, mover, environment_plan)?;
    let candidates = epoch
        .index
        .candidates(Some(mover.id), anchor, minimum, maximum, &placement);

    let mut selected = None::<SelectedBlockingContact>;
    let mut sampled_report_touches = Vec::new();
    let mut accepted_fraction = 1.0_f32;
    for peer_id in candidates {
        let Some(peer) = epoch.targets.target_body(peer_id) else {
            continue;
        };
        let peer_dynamic = peer
            .physical
            .as_ref()
            .and_then(|physical| physical.dynamic.as_ref())
            .expect("dynamic index returned a target without dynamic physical state");
        if pair_is_filtered(mover_dynamic, peer_dynamic) {
            continue;
        }
        let PairContactPolicy {
            mover_report_eligible,
            peer_report_eligible,
            response_eligible,
        } = PairContactPolicy::new(mover_dynamic, peer_dynamic);
        if !mover_report_eligible && !peer_report_eligible && !response_eligible {
            continue;
        }

        let pair = PairTrajectories::new(
            mover,
            environment_plan,
            peer,
            epoch.trajectories.get(&peer_id).map(|mover| &mover.plan),
            epoch.delta_seconds,
            anchor,
        )?;
        if !pair.swept_bounds_overlap()? {
            continue;
        }
        let samples = pair.sample_fractions()?;
        let evaluated_fraction = *samples
            .last()
            .expect("pair sampling includes its initial pose");
        accepted_fraction = accepted_fraction.min(evaluated_fraction);
        let contacts = pair.contacts(&samples)?;
        if let Some(fraction) = contacts.touch {
            if mover_report_eligible {
                sampled_report_touches.push(SampledReportTouch {
                    fraction,
                    touch: dynamic_report_touch(mover.id, peer_id, peer_dynamic),
                });
            }
            if peer_report_eligible {
                sampled_report_touches.push(SampledReportTouch {
                    fraction,
                    touch: dynamic_report_touch(peer_id, mover.id, mover_dynamic),
                });
            }
        }
        if !response_eligible {
            continue;
        }
        let Some(contact) = contacts.blocking else {
            continue;
        };
        let candidate = SelectedBlockingContact {
            peer: peer_id,
            fraction: contact.fraction,
            safe_fraction: contact.safe_fraction,
            normal: contact.normal,
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

    Ok(DynamicContactQuery {
        selected: selected.filter(|contact| contact.fraction <= accepted_fraction),
        report_touches: sampled_report_touches,
        accepted_fraction,
    })
}

/// Tests retail's directionless ethereal-to-solid transaction against current dynamic peers.
///
/// Retail calls `check_collision(peer, object)` for each other unparented object in the object's
/// shadow cells (`acclient.c:307351-307389,333172-333187`). The peer therefore supplies movement
/// spheres and `object` supplies target geometry; no static scene query or sweep participates.
pub(crate) fn current_dynamic_peer_overlap<'a>(
    object: &SpatialBody,
    peers: impl IntoIterator<Item = &'a SpatialBody>,
) -> Result<bool> {
    let object_dynamic = object
        .physical
        .as_ref()
        .and_then(|physical| physical.dynamic.as_ref())
        .context("solidifying object has no dynamic physical state")?;
    let anchor = Guid((object.pose.landblock_id.0 & 0xffff_0000) | 0xffff);
    let object_shapes = placed_target_shapes(object, object.pose, anchor)?;
    if object_shapes.is_empty() {
        return Ok(false);
    }

    for peer in peers {
        if peer.id == object.id {
            continue;
        }
        let Some(peer_physical) = peer.physical.as_ref() else {
            continue;
        };
        let Some(peer_dynamic) = peer_physical.dynamic.as_ref() else {
            continue;
        };
        if peer_dynamic.activity == super::DynamicBodyActivity::Suspended
            || !dynamic_memberships_intersect(&object_dynamic.placement, &peer_dynamic.placement)
            || !peer_dynamic
                .collision
                .dynamic_collision
                .mover_accepts_response
            || pair_is_filtered(peer_dynamic, object_dynamic)
        {
            continue;
        }
        let peer_pose = peer
            .pose
            .reanchor_to_landblock_owner(anchor)
            .context("could not reanchor solidification peer")?;
        for sphere in peer_physical.definition.spheres().iter() {
            let center = peer_pose.coords + peer_pose.rotation.rotate_vector(sphere.center);
            if object_shapes.iter().any(|shape| {
                shape.bounds.intersects_sphere(center, sphere.radius)
                    && !shape_contacts(shape, center, sphere.radius).is_empty()
            }) {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

fn dynamic_memberships_intersect(left: &SpatialMembership, right: &SpatialMembership) -> bool {
    (left.reaches_outdoors() && right.reaches_outdoors())
        || left
            .reached_env_cells()
            .iter()
            .any(|cell| right.reached_env_cells().iter().any(|peer| peer == cell))
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

/// Directional response and two independent report recipients for a dynamic pair.
struct PairContactPolicy {
    /// The mover requests reports and the peer permits being reported.
    mover_report_eligible: bool,
    /// The peer requests reports and the mover permits being reported.
    peer_report_eligible: bool,
    /// The mover accepts physical response from this solid target.
    response_eligible: bool,
}

impl PairContactPolicy {
    fn new(mover: &DynamicBodyRuntimeState, peer: &DynamicBodyRuntimeState) -> Self {
        Self {
            mover_report_eligible: mover.collision.reporting.enabled
                && peer.collision.dynamic_collision.accepts_peer_reports,
            peer_report_eligible: peer.collision.reporting.enabled
                && mover.collision.dynamic_collision.accepts_peer_reports,
            response_eligible: mover.collision.dynamic_collision.mover_accepts_response
                && peer.collision.dynamic_collision.target == EntityCollisionParticipation::Solid,
        }
    }
}

/// Report eligibility needs any overlap, independently of direction or response depth.
fn pair_overlaps(
    mover: &SpatialBody,
    mover_pose: WorldPosition,
    peer: &SpatialBody,
    peer_pose: WorldPosition,
    anchor: Guid,
) -> Result<bool> {
    let shapes = placed_target_shapes(peer, peer_pose, anchor)?;
    for sphere in mover
        .physical
        .as_ref()
        .context("dynamic mover lost its physical definition")?
        .definition
        .spheres()
        .iter()
    {
        let center = mover_pose.coords + mover_pose.rotation.rotate_vector(sphere.center);
        for shape in &shapes {
            if shape.bounds.intersects_sphere(center, sphere.radius)
                && !shape_contacts(shape, center, sphere.radius).is_empty()
            {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

/// Independent first report touch and first movement obstruction for a directional pair.
#[derive(Default)]
struct PairContacts {
    /// Overlap still reports when the mover is stationary or escaping.
    touch: Option<f32>,
    /// Only movement into a surface consumes motion.
    blocking: Option<SampledBlockingContact>,
}

/// Tests each movement sphere and target shape independently. The start normal prevents an
/// already embedded sphere from crossing a target and claiming its far side as an escape.
/// Peer motion is held at this sample: it may obstruct movement, never push the mover.
fn blocking_pair_contact(
    mover: &SpatialBody,
    previous: WorldPosition,
    candidate: WorldPosition,
    peer: &SpatialBody,
    peer_pose: WorldPosition,
    anchor: Guid,
) -> Result<Option<ShapeContact>> {
    let shapes = placed_target_shapes(peer, peer_pose, anchor)?;
    for sphere in mover
        .physical
        .as_ref()
        .context("dynamic mover lost physical state")?
        .definition
        .spheres()
        .iter()
    {
        let start = previous.coords + previous.rotation.rotate_vector(sphere.center);
        let end = candidate.coords + candidate.rotation.rotate_vector(sphere.center);
        let movement = end - start;
        for shape in &shapes {
            for center in [start, end] {
                if !shape.bounds.intersects_sphere(center, sphere.radius) {
                    continue;
                }
                for contact in shape_contacts(shape, center, sphere.radius) {
                    if contact.depth > DYNAMIC_PENETRATION_TOLERANCE
                        && movement.dot(&contact.normal) < -f32::EPSILON
                    {
                        return Ok(Some(contact));
                    }
                }
            }
        }
    }
    Ok(None)
}

#[derive(Debug, Clone, Copy)]
struct SampledBlockingContact {
    /// First sampled touch along the proposed path.
    fraction: f32,
    /// Last safe fraction before an inward movement exceeds tolerated penetration.
    safe_fraction: f32,
    /// Outward normal of the inward overlap that blocked this sample.
    normal: Vector3,
}

#[derive(Debug, Clone, Copy)]
struct SelectedBlockingContact {
    peer: SpatialBodyId,
    fraction: f32,
    /// Portion of the proposed displacement permitted before this contact.
    safe_fraction: f32,
    /// Peer surface normal used for velocity response, not positional separation.
    normal: Vector3,
    clears_projectile_state: bool,
}

impl SelectedBlockingContact {
    fn response(self) -> DynamicResponseContact {
        DynamicResponseContact {
            peer: self.peer,
            normal: self.normal,
            state_change: self
                .clears_projectile_state
                .then_some(DynamicBodyPhysicsStateChange {
                    cleared: PhysicsState::MISSILE
                        | PhysicsState::ALIGN_PATH
                        | PhysicsState::PATH_CLIPPED,
                }),
        }
    }
}

struct PairTrajectories<'a> {
    mover: &'a SpatialBody,
    mover_commit: &'a PhysicalBodyTickCommit,
    peer: &'a SpatialBody,
    peer_plan: Option<&'a PhysicalBodyTickCommit>,
    anchor: Guid,
}

impl<'a> PairTrajectories<'a> {
    fn new(
        mover: &'a SpatialBody,
        mover_commit: &'a PhysicalBodyTickCommit,
        peer: &'a SpatialBody,
        peer_plan: Option<&'a PhysicalBodyTickCommit>,
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
            peer_plan,
            anchor,
        })
    }

    /// Subdivide every leg, including a shortened prefix followed by a hold. Endpoint distance
    /// alone misses detours and can spend the entire sampling budget on the stationary tail.
    fn sample_fractions(&self) -> Result<Vec<f32>> {
        let mut boundaries = self
            .mover_commit
            .motion
            .path
            .legs()
            .iter()
            .map(|leg| leg.end_fraction())
            .chain(
                self.peer_plan
                    .into_iter()
                    .flat_map(|plan| plan.motion.path.legs().iter().map(|leg| leg.end_fraction())),
            )
            .collect::<Vec<_>>();
        boundaries.sort_by(f32::total_cmp);
        boundaries.dedup();
        let scale = self
            .minimum_collision_scale()?
            .min(MAXIMUM_DYNAMIC_SLICE_DISTANCE);
        let mover_extent = moving_sphere_extent(self.mover);
        let peer_extent = target_furthest_extent(self.peer)?;
        let mut samples = vec![0.0];
        let mut remaining_slices = MAXIMUM_DYNAMIC_SLICES;
        let mut start = 0.0;
        let mut mover_start = self.mover_pose(start)?;
        let mut peer_start = self.peer_pose(start)?;
        for end in boundaries {
            let mover_end = self.mover_pose(end)?;
            let peer_end = self.peer_pose(end)?;
            let relative =
                (mover_end.coords - mover_start.coords) - (peer_end.coords - peer_start.coords);
            let travel = relative.length()
                + quaternion_angle(mover_start.rotation, mover_end.rotation) * mover_extent
                + quaternion_angle(peer_start.rotation, peer_end.rotation) * peer_extent;
            // A stationary tail has no new geometry to subdivide. It must not invalidate
            // an exactly-budgeted safe prefix merely because the path also records its hold.
            if travel == 0.0 {
                samples.push(end);
            } else {
                let required = required_dynamic_slices(travel, scale);
                let available = remaining_slices.min(required);
                for index in 1..=available {
                    samples.push(start + (end - start) * (index as f32 / required as f32));
                }
                remaining_slices -= available;
                if available < required {
                    break;
                }
            }
            start = end;
            mover_start = mover_end;
            peer_start = peer_end;
        }
        Ok(samples)
    }

    fn swept_bounds_overlap(&self) -> Result<bool> {
        let mover_bounds = swept_root_bounds_in_anchor(
            &self.mover_commit.motion.path,
            moving_sphere_extent(self.mover),
            self.anchor,
        )?;
        let peer_extent = target_furthest_extent(self.peer)?;
        let peer_bounds = if let Some(planned) = self.peer_plan {
            swept_root_bounds_in_anchor(&planned.motion.path, peer_extent, self.anchor)?
        } else {
            let pose = self
                .peer
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
        let peer = placed_target_shapes(self.peer, self.peer.pose, self.anchor)?
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

    fn contacts(&self, samples: &[f32]) -> Result<PairContacts> {
        let mut result = PairContacts::default();
        let mut previous_fraction = 0.0;
        let mut previous_pose = self.mover_pose(0.0)?;
        for (index, &fraction) in samples.iter().enumerate() {
            let mover_pose = self.mover_pose(fraction)?;
            let peer_pose = self.peer_pose(fraction)?;
            if result.touch.is_none()
                && pair_overlaps(self.mover, mover_pose, self.peer, peer_pose, self.anchor)?
            {
                result.touch = Some(fraction);
            }
            if index > 0
                && let Some(contact) = blocking_pair_contact(
                    self.mover,
                    previous_pose,
                    mover_pose,
                    self.peer,
                    peer_pose,
                    self.anchor,
                )?
            {
                let mut safe = previous_fraction;
                let mut blocked = fraction;
                for _ in 0..DYNAMIC_CONTACT_REFINEMENT_STEPS {
                    let middle = (safe + blocked) * 0.5;
                    if blocking_pair_contact(
                        self.mover,
                        previous_pose,
                        self.mover_pose(middle)?,
                        self.peer,
                        self.peer_pose(middle)?,
                        self.anchor,
                    )?
                    .is_some()
                    {
                        blocked = middle;
                    } else {
                        safe = middle;
                    }
                }
                result.blocking = Some(SampledBlockingContact {
                    fraction,
                    safe_fraction: safe,
                    normal: contact.normal,
                });
                break;
            }
            previous_fraction = fraction;
            previous_pose = mover_pose;
        }
        Ok(result)
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
        let Some(planned) = self.peer_plan else {
            return self
                .peer
                .pose
                .reanchor_to_landblock_owner(self.anchor)
                .context("could not reanchor stationary dynamic peer");
        };
        sampled_planned_pose(
            &planned.motion.path,
            self.peer.pose,
            planned.pose.rotation,
            fraction,
            self.anchor,
        )
    }
}

/// Solves a positive tick prefix and holds its committed endpoint for the remaining frame time.
fn truncated_motion_plan(
    collision: &CollisionScene,
    mover: &SpatialBody,
    actuation: &PhysicalBodyActuation,
    delta_seconds: f32,
    accepted_fraction: f32,
    constraints: &[MotionConstraint],
) -> Result<PhysicalBodyTickCommit> {
    let mut partial = solve_constrained_physical_body_tick(
        collision,
        mover,
        actuation,
        delta_seconds * accepted_fraction,
        constraints,
    )?;
    let final_point = partial.motion.path.final_point();
    let endpoint = final_point.center();
    let endpoint_placement =
        MotionWaypointPlacement::Committed(final_point.placement().committed_cell());
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
        placement: endpoint_placement,
    });
    if accepted_fraction < 1.0 {
        waypoints.push(MotionWaypoint {
            center: endpoint,
            end_fraction: 1.0,
            placement: endpoint_placement,
        });
    }
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
    partial.motion.path = path;
    partial.accepted_motion = super::physical_body::accepted_motion(
        mover.pose,
        partial.pose,
        (partial.pose.global_coords() - mover.pose.global_coords()) / delta_seconds,
        delta_seconds,
    );
    Ok(partial)
}

/// A blocked path may hold its already committed pose, but may never apply an unvalidated push.
fn held_motion_plan(
    collision: &CollisionScene,
    mover: &SpatialBody,
    delta_seconds: f32,
) -> Result<PhysicalBodyTickCommit> {
    let physical = mover
        .physical
        .as_ref()
        .context("dynamic mover lost physical state")?;
    let path = trace_body_reference_path(
        collision,
        mover.pose,
        physical.response.cell(),
        physical.definition.spheres().primary(),
        &[MotionWaypoint {
            center: mover.pose.coords,
            end_fraction: 1.0,
            placement: MotionWaypointPlacement::Committed(physical.response.cell()),
        }],
        false,
    )?;
    Ok(PhysicalBodyTickCommit {
        pose: mover.pose,
        retained_velocity: Vector3::zero(),
        retained_acceleration: mover.retained.acceleration,
        accepted_motion: super::physical_body::accepted_motion(
            mover.pose,
            mover.pose,
            Vector3::zero(),
            delta_seconds,
        ),
        contact: mover.contact,
        response: physical.response,
        motion: super::PhysicalBodyMotion {
            path,
            status: super::PhysicalBodyTickStatus::Solved,
            constraint_count: 0,
            substeps: 0,
            contact_passes: 0,
        },
        static_contact_normal: None,
        residual_contacts: false,
    })
}

fn swept_mover_placement(
    collision: &CollisionScene,
    mover: &SpatialBody,
    commit: &PhysicalBodyTickCommit,
) -> Result<SpatialMembership> {
    // The selected plan retains every waypoint placement for later result publication while this
    // fold independently owns the union used for broad-phase membership.
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

fn dynamic_collision_velocity(
    mover: Vector3,
    restitution: PhysicalRestitution,
    normal: Vector3,
) -> Vector3 {
    match restitution {
        PhysicalRestitution::Inelastic => Vector3::zero(),
        PhysicalRestitution::Elastic(elasticity) => {
            let impact_speed = mover.dot(&normal);
            if impact_speed >= 0.0 {
                mover
            } else {
                mover + normal * -(impact_speed * (elasticity.get() + 1.0))
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
