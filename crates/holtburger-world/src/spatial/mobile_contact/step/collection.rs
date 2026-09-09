//! One admitted contact tick over borrowed input, followed by accepted-path reporting.

use std::collections::{BTreeMap, BTreeSet};

use anyhow::{Context, Result, ensure};
use holtburger_common::{Guid, Vector3};

use super::{ContactBodyUpdate, ContactMotionSegment, ContactStepActuation};
use crate::spatial::{
    CollisionReportContact, CollisionReportSource, CollisionReportTouch, CollisionScene,
    ContactState, DynamicBodyActivity, GroundState, HardSphereSweepHit,
    MOBILE_CONTACT_TICK_SECONDS, PhysicalBodyResponseState, SpatialBody, SpatialBodyId,
    advance_body_contacts,
};

/// Physical consequences and report observations, ready for one scene-owned publication.
#[derive(Debug)]
pub struct ContactCollectionUpdate {
    /// Final accepted body state and accumulated motion in stable body order.
    pub bodies: Vec<ContactBodyUpdate>,
    /// Deduplicated directional observations; the scene owns their lifetime transitions.
    pub report_touches: Vec<CollisionReportTouch>,
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
    advance_collection(
        collision,
        bodies,
        anchor,
        delta_seconds,
        actuation_for,
        true,
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
    advance_collection(
        collision,
        bodies,
        anchor,
        delta_seconds,
        actuation_for,
        false,
    )
}

fn advance_collection(
    collision: &CollisionScene,
    bodies: &[SpatialBody],
    anchor: Guid,
    delta_seconds: f32,
    mut actuation_for: impl FnMut(&SpatialBody, GroundState, f32) -> Result<ContactStepActuation>,
    observe_reports: bool,
) -> Result<ContactCollectionUpdate> {
    ensure!(
        delta_seconds.is_finite() && delta_seconds > 0.0,
        "contact collection duration must be finite and positive"
    );
    let admitted = delta_seconds.min(MOBILE_CONTACT_TICK_SECONDS);
    let updates = advance_body_contacts(collision, bodies, anchor, admitted, |body, ground| {
        actuation_for(body, ground, admitted)
    })?;
    let mut report_touches = BTreeSet::new();
    if observe_reports && !updates.is_empty() {
        let report_bodies = bodies
            .iter()
            .filter_map(|body| {
                let physical = body.physical.as_ref()?;
                let dynamic = physical.dynamic.as_ref()?;
                Some(super::report::ReportBody {
                    id: body.id,
                    pose: body.pose,
                    spheres: physical.definition.spheres(),
                    dynamic,
                })
            })
            .collect::<Vec<_>>();
        super::report::collect_traversal_report_touches(
            &report_bodies,
            &updates,
            anchor,
            &mut report_touches,
        )?;
        // Reports consume the source missile policy before final publication retires flight.
        let bodies_by_id = bodies.iter().map(|body| (body.id, body)).collect();
        for update in &updates {
            collect_hard_report_touches(&bodies_by_id, update, &mut report_touches)?;
        }
    }
    Ok(ContactCollectionUpdate {
        bodies: updates,
        report_touches: report_touches.into_iter().collect(),
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
            PhysicalBodyResponseState::Grounded { cell, ground, .. } => {
                *cell = self.membership.committed_cell();
                *ground = self.ground;
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
    bodies: &BTreeMap<SpatialBodyId, &SpatialBody>,
    update: &ContactBodyUpdate,
    touches: &mut BTreeSet<CollisionReportTouch>,
) -> Result<()> {
    let dynamic_for = |id| {
        bodies
            .get(&id)
            .with_context(|| format!("reported contact body {id:?} is absent from the collection"))?
            .physical
            .as_ref()
            .and_then(|physical| physical.dynamic.as_ref())
            .context("reported contact body lost its dynamic policy")
    };
    let mover_body = bodies
        .get(&update.body_id)
        .context("reported mover is absent from the collection")?;
    let Some(mover) = mover_body
        .physical
        .as_ref()
        .context("reported mover lost physics")?
        .dynamic
        .as_ref()
    else {
        return Ok(());
    };
    let environment = CollisionReportTouch {
        contact: CollisionReportContact {
            recipient: update.body_id,
            source: CollisionReportSource::StaticEnvironment,
        },
        source_is_ethereal: false,
    };
    if mover.collision.reporting.enabled && update.ground.contact_plane().is_some() {
        touches.insert(environment);
    }
    for segment in &update.motion {
        let ContactMotionSegment::Impact { hit, .. } = segment else {
            continue;
        };
        match *hit {
            HardSphereSweepHit::World(_) => {
                if mover.collision.reporting.enabled {
                    touches.insert(environment);
                }
            }
            HardSphereSweepHit::Entity { body_id, .. } => {
                let peer = dynamic_for(body_id)?;
                if mover.collision.reporting.enabled
                    && peer.collision.dynamic_collision.accepts_peer_reports
                {
                    touches.insert(crate::spatial::collision_report::dynamic_report_touch(
                        update.body_id,
                        body_id,
                        peer,
                    ));
                }
                if peer.collision.reporting.enabled
                    && mover.collision.dynamic_collision.accepts_peer_reports
                {
                    touches.insert(crate::spatial::collision_report::dynamic_report_touch(
                        body_id,
                        update.body_id,
                        mover,
                    ));
                }
            }
        }
    }
    Ok(())
}
