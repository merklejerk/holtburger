//! One admitted contact tick over borrowed input, followed by accepted-path reporting.

use anyhow::{Context, Result, ensure};
use holtburger_common::{Guid, Vector3};

use super::{ContactBodyUpdate, ContactMotionSegment, ContactStepActuation, HardTargetSource};
use crate::spatial::contact_profile::ContactPhaseProfile;
use crate::spatial::dynamic_index::{EntityCollisionSnapshot, dynamic_target_is_indexed};
use crate::spatial::physical_body::DynamicBodyRuntimeState;
use crate::spatial::{
    CollisionReportContact, CollisionReportSource, CollisionReportTouch, CollisionScene,
    ContactState, DynamicBodyActivity, GroundState, HardSphereSweepHit,
    MOBILE_CONTACT_TICK_SECONDS, PhysicalBodyResponseState, SpatialBody, SpatialBodyId,
};
use std::sync::Arc;

/// Non-snapshot or pre-step-modified body target supplied alongside `EntityCollisionSnapshot`.
pub(crate) struct SceneContactReportOverride<'a> {
    pub(crate) id: SpatialBodyId,
    pub(crate) dynamic: &'a DynamicBodyRuntimeState,
    pub(crate) shapes_anchor: Guid,
    pub(crate) shapes: Arc<[holtburger_content::PlacedCollisionShape]>,
}

/// Prebuilt scene collision structures shared across contact advance and report observation.
pub(crate) struct SceneContactPreparation<'a> {
    pub(crate) entity_snapshot: Option<&'a EntityCollisionSnapshot>,
    pub(crate) hard_targets: &'a super::HardTargets,
    pub(crate) overrides: &'a [SceneContactReportOverride<'a>],
}

/// Physical consequences and report observations, ready for one scene-owned publication.
#[derive(Debug)]
pub struct ContactCollectionUpdate {
    /// Final accepted body state and accumulated motion in stable body order.
    pub bodies: Vec<ContactBodyUpdate>,
    /// Deduplicated directional observations; the scene owns their lifetime transitions.
    pub report_touches: Vec<CollisionReportTouch>,
}

struct CollectionStepRequest<'a> {
    collision: &'a CollisionScene,
    bodies: &'a [SpatialBody],
    anchor: Guid,
    delta_seconds: f32,
    observe_reports: bool,
    prepared: Option<SceneContactPreparation<'a>>,
}

/// Advances borrowed collection input; the caller publishes final results together.
/// The callback evaluates already-sampled ordinary input for each interval and current support.
/// It must not advance animation cursors or fire hooks. Excess time is discarded, not queued.
/// Projectile retirement and launch consumption publish once with the accepted result.
pub fn advance_body_contact_collection(
    collision: &CollisionScene,
    bodies: &[SpatialBody],
    anchor: Guid,
    delta_seconds: f32,
    actuation_for: impl FnMut(&SpatialBody, GroundState, f32) -> Result<ContactStepActuation>,
) -> Result<ContactCollectionUpdate> {
    let mut scratch = super::ContactStepScratch::default();
    advance_collection(
        CollectionStepRequest {
            collision,
            bodies,
            anchor,
            delta_seconds,
            observe_reports: true,
            prepared: None,
        },
        &mut scratch,
        actuation_for,
    )
}

/// Advances active/cluster bodies while sharing scene-cached `HardTargets` and `EntityCollisionSnapshot`.
pub(crate) fn advance_body_contact_collection_prepared(
    collision: &CollisionScene,
    bodies: &[SpatialBody],
    anchor: Guid,
    delta_seconds: f32,
    prepared: SceneContactPreparation<'_>,
    scratch: &mut super::ContactStepScratch,
    actuation_for: impl FnMut(&SpatialBody, GroundState, f32) -> Result<ContactStepActuation>,
) -> Result<ContactCollectionUpdate> {
    advance_collection(
        CollectionStepRequest {
            collision,
            bodies,
            anchor,
            delta_seconds,
            observe_reports: true,
            prepared: Some(prepared),
        },
        scratch,
        actuation_for,
    )
}

/// Prediction and environment-only direct probes do not consume authored peer reports.
/// They share identical physical integration while avoiding report geometry and indexing.
pub(crate) fn advance_body_contact_collection_without_reports(
    collision: &CollisionScene,
    bodies: &[SpatialBody],
    anchor: Guid,
    delta_seconds: f32,
    actuation_for: impl FnMut(&SpatialBody, GroundState, f32) -> Result<ContactStepActuation>,
) -> Result<ContactCollectionUpdate> {
    let mut scratch = super::ContactStepScratch::default();
    advance_collection(
        CollectionStepRequest {
            collision,
            bodies,
            anchor,
            delta_seconds,
            observe_reports: false,
            prepared: None,
        },
        &mut scratch,
        actuation_for,
    )
}

fn advance_collection(
    request: CollectionStepRequest<'_>,
    scratch: &mut super::ContactStepScratch,
    mut actuation_for: impl FnMut(&SpatialBody, GroundState, f32) -> Result<ContactStepActuation>,
) -> Result<ContactCollectionUpdate> {
    let CollectionStepRequest {
        collision,
        bodies,
        anchor,
        delta_seconds,
        observe_reports,
        prepared,
    } = request;
    let mut profile = ContactPhaseProfile::begin("contact_collection");
    ensure!(
        delta_seconds.is_finite() && delta_seconds > 0.0,
        "contact collection duration must be finite and positive"
    );
    let admitted = delta_seconds.min(MOBILE_CONTACT_TICK_SECONDS);
    let target_source = match &prepared {
        Some(prep) => HardTargetSource::ScenePrepared {
            hard: prep.hard_targets,
            entity_snapshot: prep.entity_snapshot,
        },
        None => HardTargetSource::Compile,
    };
    let updates = super::advance_contacts(
        collision,
        bodies,
        anchor,
        admitted,
        |body, ground| actuation_for(body, ground, admitted),
        target_source,
        scratch,
    )?;
    profile.checkpoint("integration");
    scratch.report_touches.clear();
    if observe_reports && !updates.is_empty() {
        let mut any_mover_emits = false;
        let mut any_mover_accepts = false;
        let mut any_body_emits = false;
        let mut any_body_accepts = false;
        let mut has_hard_report_work = false;
        for body in bodies {
            let Some(dynamic) = body.physical.as_ref().and_then(|p| p.dynamic.as_ref()) else {
                continue;
            };
            let emits = dynamic.collision.reporting.enabled;
            let accepts = dynamic.collision.dynamic_collision.accepts_peer_reports;
            if dynamic_target_is_indexed(body.id, dynamic) {
                any_body_emits |= emits;
                any_body_accepts |= accepts;
            }
            if let Ok(position) = updates.binary_search_by_key(&body.id, |update| update.body_id) {
                any_mover_emits |= emits;
                any_mover_accepts |= accepts;
                let update = &updates[position];
                if (emits && update.ground.contact_plane().is_some())
                    || ((emits || accepts)
                        && update
                            .motion
                            .iter()
                            .any(|segment| matches!(segment, ContactMotionSegment::Impact { .. })))
                {
                    has_hard_report_work = true;
                }
            }
        }
        let (any_peer_emits, any_peer_accepts) = match &prepared {
            Some(prep) => {
                let (override_emits, override_accepts) =
                    super::report::override_report_capabilities(prep.overrides);
                let (snap_emits, snap_accepts) = prep.entity_snapshot.map_or((false, false), |s| {
                    (s.any_reporting_enabled(), s.any_accepts_peer_reports())
                });
                (
                    snap_emits || override_emits,
                    snap_accepts || override_accepts,
                )
            }
            None => (any_body_emits, any_body_accepts),
        };
        let has_traversal_report_work =
            (any_mover_emits && any_peer_accepts) || (any_mover_accepts && any_peer_emits);
        if has_traversal_report_work {
            match &prepared {
                Some(prep) => super::report::collect_traversal_report_touches_with_prepared(
                    bodies,
                    &updates,
                    anchor,
                    prep.entity_snapshot,
                    prep.overrides,
                    &mut scratch.report_touches,
                    &mut scratch.report,
                )?,
                None => super::report::collect_traversal_report_touches(
                    bodies,
                    &updates,
                    anchor,
                    &mut scratch.report_touches,
                    &mut scratch.report,
                )?,
            }
        }
        if has_hard_report_work {
            // Reports consume the source missile policy before final publication retires flight.
            scratch.report_sorted_bodies.clear();
            scratch.report_sorted_bodies.extend(
                bodies
                    .iter()
                    .enumerate()
                    .map(|(index, body)| (body.id, index)),
            );
            scratch
                .report_sorted_bodies
                .sort_unstable_by_key(|(id, _)| *id);
            let snapshot_ref = prepared.as_ref().and_then(|prep| prep.entity_snapshot);
            let overrides_ref = prepared.as_ref().map_or(&[][..], |prep| prep.overrides);
            for update in &updates {
                collect_hard_report_touches(
                    bodies,
                    &scratch.report_sorted_bodies,
                    snapshot_ref,
                    overrides_ref,
                    update,
                    &mut scratch.report_touches,
                )?;
            }
        }
    }
    scratch.report_touches.sort_unstable();
    scratch.report_touches.dedup();
    let report_touches = if scratch.report_touches.is_empty() {
        Vec::new()
    } else {
        scratch.report_touches.to_vec()
    };
    profile.checkpoint("collision_reporting");
    profile.finish(format_args!(
        "bodies={} updates={} report_touches={} reporting={}",
        bodies.len(),
        updates.len(),
        report_touches.len(),
        observe_reports,
    ));
    Ok(ContactCollectionUpdate {
        bodies: updates,
        report_touches,
    })
}

impl ContactBodyUpdate {
    /// Applies accepted physical state without changing authority, animation, or report lifetimes.
    /// Final publication uses checked membership to place the root.
    pub(crate) fn apply_physical_state(&self, body: &mut SpatialBody) -> Result<()> {
        ensure!(
            body.id == self.body_id,
            "contact update names a different body"
        );
        let mut pose = body.pose;
        pose.coords = pose.coords + self.displacement;
        pose.rotation = self.rotation;
        pose =
            crate::spatial::physical_body::place_body_pose(pose, self.membership.committed_cell())?;
        let physical = body
            .physical
            .as_mut()
            .context("contact result lost its physical definition")?;
        // Contact remains effective against sleeping mobiles. Changed state must run its
        // ordinary forces/motor on the next tick, independently of body iteration order.
        let ground_changed = match physical.response {
            PhysicalBodyResponseState::Grounded { ground, .. } => ground != self.ground,
            PhysicalBodyResponseState::Placement { .. } => false,
        };
        if let Some(dynamic) = &mut physical.dynamic {
            if self.displacement != Vector3::zero()
                || self.rotation != body.pose.rotation
                || self.velocity != body.retained.velocity
                || ground_changed
                || self.projectile_impact.is_some()
            {
                dynamic.activity = DynamicBodyActivity::Active;
            }
            dynamic.placement = self.membership.clone();
        }
        body.pose = pose;
        body.retained.velocity = self.velocity;
        body.retained.acceleration = self.acceleration;
        body.accepted_motion = self.accepted_motion;
        body.contact = match self.ground {
            GroundState::Supported(_) => ContactState::Grounded,
            GroundState::Sliding(_) => ContactState::Sliding,
            GroundState::Airborne => ContactState::Airborne,
        };
        match &mut physical.response {
            PhysicalBodyResponseState::Placement { cell } => {
                *cell = self.membership.committed_cell()
            }
            PhysicalBodyResponseState::Grounded {
                cell,
                ground,
                stationary_fall_frames,
            } => {
                *cell = self.membership.committed_cell();
                *ground = self.ground;
                *stationary_fall_frames = self.stationary_fall_frames;
            }
        }
        if self.projectile_impact.is_some() {
            let dynamic = physical
                .dynamic
                .as_mut()
                .context("projectile impact lost its entity state")?;
            physical.response_policy.align_path = false;
            dynamic.collision.dynamic_collision.missile = false;
            dynamic.collision.dynamic_collision.path_clipped = false;
        }
        Ok(())
    }
}

/// Converts existing hard hits and support into reports without another geometry query.
fn collect_hard_report_touches(
    bodies: &[SpatialBody],
    sorted_bodies: &[(SpatialBodyId, usize)],
    entity_snapshot: Option<&EntityCollisionSnapshot>,
    overrides: &[SceneContactReportOverride<'_>],
    update: &ContactBodyUpdate,
    touches: &mut Vec<CollisionReportTouch>,
) -> Result<()> {
    let Ok(mover_pos) = sorted_bodies.binary_search_by_key(&update.body_id, |(id, _)| *id) else {
        anyhow::bail!("reported mover is absent from the collection");
    };
    let mover_body = &bodies[sorted_bodies[mover_pos].1];
    let Some(mover) = mover_body
        .physical
        .as_ref()
        .context("reported mover lost physics")?
        .dynamic
        .as_ref()
    else {
        return Ok(());
    };
    let emits = mover.collision.reporting.enabled;
    let accepts = mover.collision.dynamic_collision.accepts_peer_reports;
    if !emits && !accepts {
        return Ok(());
    }
    let environment = CollisionReportTouch {
        contact: CollisionReportContact {
            recipient: update.body_id,
            source: CollisionReportSource::StaticEnvironment,
        },
        source_is_ethereal: false,
    };
    if mover.collision.reporting.enabled && update.ground.contact_plane().is_some() {
        touches.push(environment);
    }
    for segment in &update.motion {
        let ContactMotionSegment::Impact { hit, .. } = segment else {
            continue;
        };
        match *hit {
            HardSphereSweepHit::World(_) => {
                if mover.collision.reporting.enabled {
                    touches.push(environment);
                }
            }
            HardSphereSweepHit::Entity { body_id, .. } => {
                if let Some(peer) = sorted_bodies
                    .binary_search_by_key(&body_id, |(id, _)| *id)
                    .ok()
                    .and_then(|pos| bodies[sorted_bodies[pos].1].physical.as_ref())
                    .and_then(|physical| physical.dynamic.as_ref())
                    .or_else(|| {
                        overrides
                            .iter()
                            .find(|item| item.id == body_id)
                            .map(|item| item.dynamic)
                    })
                {
                    if mover.collision.reporting.enabled
                        && peer.collision.dynamic_collision.accepts_peer_reports
                    {
                        touches.push(crate::spatial::collision_report::dynamic_report_touch(
                            update.body_id,
                            body_id,
                            peer,
                        ));
                    }
                    if peer.collision.reporting.enabled
                        && mover.collision.dynamic_collision.accepts_peer_reports
                    {
                        touches.push(crate::spatial::collision_report::dynamic_report_touch(
                            body_id,
                            update.body_id,
                            mover,
                        ));
                    }
                } else if let Some(target) = entity_snapshot.and_then(|snap| snap.target(body_id)) {
                    if mover.collision.reporting.enabled
                        && target.contact.policy.accepts_peer_reports
                    {
                        touches.push(
                            crate::spatial::collision_report::dynamic_report_touch_from_flags(
                                update.body_id,
                                body_id,
                                target.report_as_environment,
                                target.contact.policy.target
                                    == crate::EntityCollisionParticipation::Ethereal,
                            ),
                        );
                    }
                    if target.reporting_enabled
                        && mover.collision.dynamic_collision.accepts_peer_reports
                    {
                        touches.push(crate::spatial::collision_report::dynamic_report_touch(
                            body_id,
                            update.body_id,
                            mover,
                        ));
                    }
                } else {
                    anyhow::bail!(
                        "reported contact body {body_id:?} is absent from both collection and snapshot"
                    );
                }
            }
        }
    }
    Ok(())
}
