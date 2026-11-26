//! Scene-owned input capture, reference lifetime, and publication for bounded contact steps.

use super::*;
use crate::spatial::contact_profile::ContactPhaseProfile;
use crate::spatial::dynamic_index::{dynamic_target_is_indexed, indexed_dynamic_body};
use crate::spatial::mobile_contact::{
    ContactStepScratch, MOBILE_CONTACT_CORRECTION_TRAVEL_RADIUS_RATIO, SceneContactPreparation,
    SceneContactReportOverride, advance_body_contact_collection_prepared,
};
use crate::spatial::types::RecoveryAuthority;
use crate::spatial::volume_query::placed_shape_contacts;
use crate::spatial::{
    AcceptedBodyMotion, ContactBodyUpdate, PhysicalReferenceInput, SupportedBodyMotion,
};

/// Reusable scratch buffers for `SpatialScene::advance_contact_entity_collection`.
#[derive(Default)]
pub(super) struct SceneCollectionScratch {
    needs_refresh: Vec<SpatialBodyId>,
    active_fixed: Vec<SpatialBodyId>,
    active_mobile: Vec<SpatialBodyId>,
    settled_mobile: Vec<SpatialBodyId>,
    parked_bodies: Vec<(SpatialBodyId, bool)>,
    rejected_ids: Vec<SpatialBodyId>,
    solved_ids: Vec<SpatialBodyId>,
    refreshed_or_fixed: Vec<SpatialBodyId>,
    extra_report_ids: Vec<SpatialBodyId>,
    moved_fixed_boxes: Vec<(Guid, Vector3, Vector3)>,
    settled_inputs: Vec<(SpatialBodyId, Option<PhysicalBodyInput>)>,
    frontier: Vec<(Vector3, Vector3, SpatialMembership)>,
    settled_candidates: Vec<(SpatialBodyId, Vector3, Vector3, bool)>,
    prepared_pose_changed: Vec<SpatialBodyId>,
    snapshots: Vec<SpatialBody>,
    actuators: Vec<(SpatialBodyId, Option<CollectionActuator>)>,
    recovery_requests: Vec<(SpatialBodyId, WorldPosition)>,
    step: ContactStepScratch,
}

impl Clone for SceneCollectionScratch {
    fn clone(&self) -> Self {
        Self::default()
    }
}

impl SceneCollectionScratch {
    fn clear_collection(&mut self) {
        self.needs_refresh.clear();
        self.active_fixed.clear();
        self.active_mobile.clear();
        self.settled_mobile.clear();
        self.parked_bodies.clear();
        self.rejected_ids.clear();
        self.solved_ids.clear();
        self.refreshed_or_fixed.clear();
        self.extra_report_ids.clear();
        self.moved_fixed_boxes.clear();
        self.settled_inputs.clear();
        self.frontier.clear();
        self.settled_candidates.clear();
        self.prepared_pose_changed.clear();
        self.snapshots.clear();
        self.actuators.clear();
        self.recovery_requests.clear();
    }
}

/// One admitted producer sample and its private reference continuation for the collection.
struct CollectionActuator {
    /// Ordinary input is sampled once for the admitted collection tick.
    input: PhysicalBodyInput,
    /// Copied reconciliation is published only with the accepted body.
    reconciliation: Option<PoseReconciliationState>,
    /// Independent final nominal continuation used to decide return completion.
    nominal_velocity: Vector3,
    /// Supported positional return requested during this collection.
    external_translation: bool,
}

impl CollectionActuator {
    /// Finalizes accepted continuation, return progress and sleep state on a private body copy.
    /// The returned destination requests later recovery; this operation never relocates or publishes.
    fn finish(
        self,
        body: &mut SpatialBody,
        update: &ContactBodyUpdate,
        delta_seconds: f32,
        now: Instant,
    ) -> anyhow::Result<Option<WorldPosition>> {
        let mut recovery = None;
        body.nominal.velocity = self.nominal_velocity;
        let mut reconciliation = if update.projectile_impact.is_some() {
            None
        } else {
            self.reconciliation
        };
        let remote_grounded_eligible = matches!(body.id, SpatialBodyId::Entity(_))
            && body.physical.as_ref().is_some_and(|physical| {
                matches!(physical.definition, PhysicalBodyDefinition::Grounded { .. })
                    && physical
                        .dynamic
                        .as_ref()
                        .is_some_and(|dynamic| dynamic.collision.contact_response.yields())
            });
        if let (Some(state), Some(destination)) = (reconciliation.as_mut(), body.correction_pose())
        {
            // A grounded response describes the body's physics, not its current support.
            // Unsupported travel can leave the last admitted grounded pose behind normally;
            // observing it as a stall can place a correctly falling remote back on its ledge.
            let permitted = remote_grounded_eligible
                && body.contact.contact() == Some(true)
                && match self.input.recovery_authority {
                    RecoveryAuthority::Disabled => false,
                    RecoveryAuthority::LatestSample => true,
                    RecoveryAuthority::MatchingReference => {
                        state.reference_matches_authority(destination)
                    }
                };
            let requested = state.finish_recovery_tick(
                body.pose,
                body.retained.velocity - self.nominal_velocity,
                super::super::PhysicalReferenceDomain::for_definition(
                    body.physical
                        .as_ref()
                        .context("physical publication lost its definition")?
                        .definition,
                ),
                destination,
                delta_seconds,
                permitted,
            );
            if requested {
                recovery = Some(destination);
            }
        } else if let Some(state) = reconciliation.as_mut() {
            state.finish_physical_tick(
                body.pose,
                body.retained.velocity - self.nominal_velocity,
                super::super::PhysicalReferenceDomain::for_definition(
                    body.physical
                        .as_ref()
                        .context("physical publication lost its definition")?
                        .definition,
                ),
            );
            if let Some(BodyPoseAuthority::Observed(destination)) = body.pose_authority {
                let stationary = update.displacement == Vector3::zero()
                    && body.retained.velocity.length() <= super::super::bsp_query::CONTACT_EPSILON
                    && body.nominal.velocity.length() <= super::super::bsp_query::CONTACT_EPSILON;
                let permitted = remote_grounded_eligible
                    && body.contact.contact() == Some(true)
                    && stationary
                    && self.input.recovery_authority == RecoveryAuthority::LatestSample;
                if state.finish_observed_recovery_tick(
                    body.pose,
                    destination,
                    delta_seconds,
                    permitted,
                ) {
                    recovery = Some(destination);
                }
            }
        }
        body.reconciliation = reconciliation
            .filter(|state| !state.is_empty())
            .map(Box::new);
        body.sampling.mode = SpatialSampleMode::SimulatingVelocity;
        body.sampling.last_derived_at = now;
        let correction_active = body.has_pose_reconciliation_work();
        let physical = body
            .physical
            .as_mut()
            .context("published contact body lost physics")?;
        let dynamic = physical
            .dynamic
            .as_mut()
            .context("published contact body lost dynamic placement")?;
        let supported = physical.response.ground().walkable_support().is_some();
        let quiet = self.input.permits_dynamic_settling()
            && !correction_active
            && update.displacement == Vector3::zero()
            && body.retained.velocity == Vector3::zero()
            && body.retained.omega == Vector3::zero()
            && (supported
                || matches!(
                    physical.definition,
                    PhysicalBodyDefinition::FreeSphere { .. }
                ) && body.retained.acceleration == Vector3::zero());
        dynamic.activity = if quiet {
            DynamicBodyActivity::Settled
        } else {
            DynamicBodyActivity::Active
        };
        Ok(recovery)
    }
}

fn support_is_stale_for_settled(
    body: &SpatialBody,
    collision: &CollisionScene,
    body_store: &SpatialBodyStore,
) -> bool {
    let Some(physical) = body.physical.as_ref() else {
        return false;
    };
    match physical.response.ground() {
        GroundState::Supported(support) | GroundState::Sliding(support) => match support.source {
            crate::spatial::SupportSource::World(proof)
            | crate::spatial::SupportSource::StationaryFall(proof) => !collision.proves(proof),
            crate::spatial::SupportSource::Entity(peer_id, stamp) => {
                stamp == 0
                    || body_store.bodies.get(&peer_id).is_none_or(|peer| {
                        peer.geometry_stamp != stamp
                            || !is_hard_target_body(&peer.body)
                            || !super::super::mobile_contact::bodies_accept_hard_support(
                                body, &peer.body,
                            )
                    })
            }
        },
        GroundState::Airborne => matches!(
            physical.definition,
            PhysicalBodyDefinition::Grounded { config, .. } if config.gravity != 0.0
        ),
    }
}

fn take_settled_input(
    settled_inputs: &mut [(SpatialBodyId, Option<PhysicalBodyInput>)],
    id: SpatialBodyId,
) -> Option<PhysicalBodyInput> {
    settled_inputs
        .binary_search_by_key(&id, |(candidate_id, _)| *candidate_id)
        .ok()
        .and_then(|index| settled_inputs[index].1.take())
}

fn body_sphere_bounds_in(
    body: &SpatialBody,
    anchor: Guid,
    pad: f32,
) -> anyhow::Result<(Vector3, Vector3)> {
    let physical = body
        .physical
        .as_ref()
        .context("contact body lost its physical definition")?;
    let pose = body.pose.reanchor_to_landblock_owner(anchor)?;
    let mut minimum = Vector3::new(f32::INFINITY, f32::INFINITY, f32::INFINITY);
    let mut maximum = Vector3::new(f32::NEG_INFINITY, f32::NEG_INFINITY, f32::NEG_INFINITY);
    for sphere in physical.definition.spheres().iter() {
        let center = pose.coords + pose.rotation.rotate_vector(sphere.center);
        let reach = sphere.radius + pad;
        minimum.x = minimum.x.min(center.x - reach);
        minimum.y = minimum.y.min(center.y - reach);
        minimum.z = minimum.z.min(center.z - reach);
        maximum.x = maximum.x.max(center.x + reach);
        maximum.y = maximum.y.max(center.y + reach);
        maximum.z = maximum.z.max(center.z + reach);
    }
    Ok((minimum, maximum))
}

fn body_min_radius(body: &SpatialBody) -> f32 {
    body.physical
        .as_ref()
        .map(|physical| {
            physical
                .definition
                .spheres()
                .iter()
                .map(|sphere| sphere.radius)
                .fold(f32::INFINITY, f32::min)
        })
        .unwrap_or(0.0)
}

fn mover_interaction_bounds(
    body: &SpatialBody,
    input: Option<&PhysicalBodyInput>,
    delta_seconds: f32,
    anchor: Guid,
) -> anyhow::Result<(Vector3, Vector3, SpatialMembership)> {
    let physical = body
        .physical
        .as_ref()
        .context("cluster body lost its physical state")?;
    let dynamic = physical
        .dynamic
        .as_ref()
        .context("cluster body lost its dynamic state")?;
    let min_radius = body_min_radius(body);
    let correction_pad = min_radius * MOBILE_CONTACT_CORRECTION_TRAVEL_RADIUS_RATIO;
    let mut pad = correction_pad + 0.05;
    if body.retained.omega != Vector3::zero() || input.is_some() {
        let rotation_pad = physical
            .definition
            .spheres()
            .iter()
            .map(|sphere| {
                if body.retained.omega.x == 0.0 && body.retained.omega.y == 0.0 {
                    2.0 * Vector3::new(sphere.center.x, sphere.center.y, 0.0).length()
                } else {
                    2.0 * sphere.center.length()
                }
            })
            .fold(0.0_f32, f32::max);
        pad += rotation_pad;
    }
    if let Some(input) = input {
        let mut max_speed = body.retained.velocity.length() + body.nominal.velocity.length();
        if let Some(PhysicalReferenceInput::Sticky(target)) = input.reference {
            max_speed = max_speed.max(target.speed_mps);
        }
        let mut step_gravity_pad = 0.0_f32;
        match &input.actuation {
            PhysicalBodyActuation::FixedPosition { translation, .. } => {
                pad += translation.length();
            }
            PhysicalBodyActuation::FreeFlight {
                retained_velocity,
                kinematic_velocity,
            } => {
                max_speed = max_speed.max((*retained_velocity + *kinematic_velocity).length());
            }
            PhysicalBodyActuation::Grounded(grounded) => {
                max_speed = max_speed.max(grounded.supported_planar_velocity().length());
                if let Some(launch) = grounded.launch() {
                    max_speed = max_speed.max(launch.velocity().length());
                }
                if let PhysicalBodyDefinition::Grounded { config, .. } = physical.definition {
                    let step_reach = config
                        .step_up_height
                        .max(config.step_down_height)
                        .max(config.airborne_step_down_height);
                    step_gravity_pad += step_reach + config.gravity.abs() * delta_seconds;
                }
            }
        }
        let authored_distance = input
            .reference
            .and_then(PhysicalReferenceInput::authored_offset)
            .map_or(0.0, |offset| offset.translation.length());
        pad += max_speed * delta_seconds
            + body.retained.acceleration.length() * delta_seconds
            + step_gravity_pad
            + authored_distance;
        if let Some(state) = body.reconciliation.as_deref()
            && state.has_physical_correction()
        {
            let ref_pose = state
                .physical_reference()?
                .reanchor_to_landblock_owner(anchor)?;
            let body_pose = body.pose.reanchor_to_landblock_owner(anchor)?;
            let error_bound = (ref_pose.coords - body_pose.coords).length()
                + max_speed * delta_seconds
                + authored_distance;
            pad += crate::spatial::PHYSICAL_RETURN_GAIN * error_bound * delta_seconds;
        }
    } else if let PhysicalBodyDefinition::Grounded { config, .. } = physical.definition {
        pad += config.gravity.abs() * delta_seconds;
    }
    let (minimum, maximum) = body_sphere_bounds_in(body, anchor, pad)?;
    Ok((minimum, maximum, dynamic.placement.clone()))
}

fn bounds_overlap((a_min, a_max): (Vector3, Vector3), (b_min, b_max): (Vector3, Vector3)) -> bool {
    a_min.x <= b_max.x
        && b_min.x <= a_max.x
        && a_min.y <= b_max.y
        && b_min.y <= a_max.y
        && a_min.z <= b_max.z
        && b_min.z <= a_max.z
}

fn prepare_cluster_body(
    body: &mut SpatialBody,
    id: SpatialBodyId,
    collision: &CollisionScene,
    settled_inputs: &mut [(SpatialBodyId, Option<PhysicalBodyInput>)],
    prepared_pose_changed: &mut Vec<SpatialBodyId>,
    input_for: &mut impl FnMut(&SpatialBody) -> anyhow::Result<PhysicalBodyInput>,
) -> anyhow::Result<CollectionActuator> {
    let input = match take_settled_input(settled_inputs, id) {
        Some(input) => input,
        None => input_for(body)?,
    };
    let mut reconciliation = body.reconciliation.as_deref().copied();
    if input.prepare(body, &mut reconciliation)? {
        let cell = body.physical.as_ref().and_then(|p| p.response.cell());
        let placement = resolve_dynamic_body_placement(collision, body, cell)?;
        body.physical
            .as_mut()
            .and_then(|p| p.dynamic.as_mut())
            .context("prepared collision pose lost its dynamic state")?
            .placement = placement;
        prepared_pose_changed.push(id);
    }
    Ok(CollectionActuator {
        input,
        reconciliation,
        nominal_velocity: body.nominal.velocity,
        external_translation: false,
    })
}

fn push_override_from_stored<'a>(
    overrides: &mut Vec<SceneContactReportOverride<'a>>,
    id: SpatialBodyId,
    stored: &'a StoredSpatialBody,
) -> anyhow::Result<()> {
    let Some(physical) = stored.body.physical.as_ref() else {
        return Ok(());
    };
    let Some(dynamic) = physical.dynamic.as_ref() else {
        return Ok(());
    };
    if !dynamic.activity.participates_in_collision() {
        return Ok(());
    }
    if !matches!(id, SpatialBodyId::Entity(_)) {
        if let Some((natural_anchor, shapes)) = stored.ensure_natural_placed_shapes()? {
            overrides.push(SceneContactReportOverride {
                id,
                dynamic,
                shapes_anchor: natural_anchor,
                shapes,
            });
        }
    } else if is_hard_target_body(&stored.body) && !dynamic_target_is_indexed(id, dynamic) {
        overrides.push(SceneContactReportOverride {
            id,
            dynamic,
            shapes_anchor: crate::spatial::dynamic_index::landblock_owner(stored.body.pose),
            shapes: Arc::from([]),
        });
    }
    Ok(())
}

fn refresh_stationary_reports(
    scene: &mut SpatialScene,
    solved_ids: &[SpatialBodyId],
    now: Instant,
) -> anyhow::Result<()> {
    if scene.collision_reports.is_empty() {
        return Ok(());
    }
    let SpatialScene {
        body_store,
        collision_reports,
        ..
    } = scene;
    collision_reports.refresh_stationary(now, |contact| {
        if solved_ids.binary_search(&contact.recipient).is_ok() {
            return Ok(false);
        }
        let Some(recipient_body) = body_store.body(contact.recipient) else {
            return Ok(false);
        };
        let Some(recipient_physical) = recipient_body.physical.as_ref() else {
            return Ok(false);
        };
        let Some(recipient_dynamic) = recipient_physical.dynamic.as_ref() else {
            return Ok(false);
        };
        if !recipient_dynamic.activity.participates_in_collision()
            || !recipient_dynamic.collision.reporting.enabled
        {
            return Ok(false);
        }
        match contact.source {
            CollisionReportSource::StaticEnvironment => Ok(recipient_physical
                .response
                .ground()
                .contact_plane()
                .is_some()),
            CollisionReportSource::DynamicBody { peer, .. } => {
                let Some(peer_stored) = body_store.bodies.get(&peer) else {
                    return Ok(false);
                };
                let peer_body = &peer_stored.body;
                let Some(peer_physical) = peer_body.physical.as_ref() else {
                    return Ok(false);
                };
                let Some(peer_dynamic) = peer_physical.dynamic.as_ref() else {
                    return Ok(false);
                };
                if !dynamic_target_is_indexed(peer, peer_dynamic)
                    || !peer_dynamic
                        .collision
                        .dynamic_collision
                        .accepts_peer_reports
                    || recipient_dynamic.collision.dynamic_collision.contact_with(
                        peer_dynamic.collision.dynamic_collision,
                        recipient_dynamic.collision.player_collision,
                        peer_dynamic.collision.player_collision,
                    ) == crate::EntityContactInteraction::Ignored
                    || !recipient_dynamic
                        .placement
                        .intersects_reached(&peer_dynamic.placement)
                {
                    return Ok(false);
                }
                let anchor = crate::spatial::dynamic_index::landblock_owner(recipient_body.pose);
                let Some(shapes) = peer_stored.placed_shapes_in(anchor)? else {
                    return Ok(false);
                };
                let recipient_pose = recipient_body.pose.reanchor_to_landblock_owner(anchor)?;
                for sphere in recipient_physical.definition.spheres().iter() {
                    let center = recipient_pose.coords
                        + recipient_pose.rotation.rotate_vector(sphere.center);
                    if shapes.iter().any(|shape| {
                        shape.bounds.intersects_sphere(center, sphere.radius)
                            && !placed_shape_contacts(shape, center, sphere.radius).is_empty()
                    }) {
                        return Ok(true);
                    }
                }
                Ok(false)
            }
        }
    })
}

impl SpatialScene {
    pub(super) fn advance_contact_entity_collection(
        &mut self,
        collision: &CollisionScene,
        delta_seconds: f32,
        now: Instant,
        mut input_for: impl FnMut(&SpatialBody) -> anyhow::Result<PhysicalBodyInput>,
    ) -> anyhow::Result<DynamicEntityCollectionTick> {
        let mut scratch = std::mem::take(&mut self.collection_scratch);
        scratch.clear_collection();
        let result = self.advance_contact_entity_collection_with_scratch(
            collision,
            delta_seconds,
            now,
            &mut scratch,
            &mut input_for,
        );
        self.collection_scratch = scratch;
        result
    }

    fn advance_contact_entity_collection_with_scratch(
        &mut self,
        collision: &CollisionScene,
        delta_seconds: f32,
        now: Instant,
        scratch: &mut SceneCollectionScratch,
        input_for: &mut impl FnMut(&SpatialBody) -> anyhow::Result<PhysicalBodyInput>,
    ) -> anyhow::Result<DynamicEntityCollectionTick> {
        let mut profile = ContactPhaseProfile::begin("contact_scene");
        anyhow::ensure!(
            delta_seconds.is_finite() && delta_seconds > 0.0,
            "contact collection interval must be finite and positive"
        );
        let delta_seconds = delta_seconds.min(super::super::MOBILE_CONTACT_TICK_SECONDS);
        let collision_revision = collision.revision();
        let revision_changed = self.last_collection_collision_revision != Some(collision_revision);
        let recheck_support = self.peer_support_recheck_needed;

        let mut has_stationary_indexed_entity = false;
        let mut any_active_missile = false;
        for (&id, stored) in &self.body_store.bodies {
            if matches!(id, SpatialBodyId::Ephemeral(_)) {
                continue;
            }
            let body = &stored.body;
            let Some(physical) = body.physical.as_ref() else {
                continue;
            };
            let Some(dynamic) = physical.dynamic.as_ref() else {
                continue;
            };
            if dynamic.activity == DynamicBodyActivity::AuthoritativeParked {
                let pose_dirty = stored.verified_placement != Some((body.pose, collision_revision));
                scratch.parked_bodies.push((id, pose_dirty));
                if pose_dirty {
                    scratch.needs_refresh.push(id);
                }
                continue;
            }
            if dynamic.activity == DynamicBodyActivity::Suspended
                || stored.verified_placement != Some((body.pose, collision_revision))
            {
                scratch.needs_refresh.push(id);
                scratch.refreshed_or_fixed.push(id);
                continue;
            }
            let fixed = matches!(
                physical.definition,
                PhysicalBodyDefinition::FixedPosition { .. }
            );
            let eligible = dynamic.demand.integration == LocalIntegrationDemand::Eligible;
            if fixed && eligible && dynamic.activity == DynamicBodyActivity::Active {
                scratch.active_fixed.push(id);
                scratch.refreshed_or_fixed.push(id);
                continue;
            }
            if !fixed && eligible {
                if dynamic.activity == DynamicBodyActivity::Active {
                    scratch.active_mobile.push(id);
                    any_active_missile |= dynamic.collision.dynamic_collision.missile;
                } else {
                    scratch.settled_mobile.push(id);
                }
            } else if matches!(id, SpatialBodyId::Entity(_))
                && dynamic_target_is_indexed(id, dynamic)
            {
                has_stationary_indexed_entity = true;
            }
            if matches!(id, SpatialBodyId::Entity(_)) {
                if !dynamic_target_is_indexed(id, dynamic) && is_hard_target_body(body) {
                    scratch.extra_report_ids.push(id);
                }
            } else {
                scratch.extra_report_ids.push(id);
            }
        }

        let mut coverage_rejections = Vec::new();
        let mut outcomes = Vec::new();
        let mut snap_previous_placements = HashMap::new();
        let mut collision_reports = Vec::new();

        let parked_may_unpark = !scratch.parked_bodies.is_empty()
            && (revision_changed
                || recheck_support
                || scratch
                    .parked_bodies
                    .iter()
                    .any(|&(_, pose_dirty)| pose_dirty));

        if scratch.needs_refresh.is_empty()
            && scratch.active_fixed.is_empty()
            && scratch.active_mobile.is_empty()
            && scratch.settled_mobile.is_empty()
            && !parked_may_unpark
        {
            self.last_collection_collision_revision = Some(collision_revision);
            self.peer_support_recheck_needed = false;
            refresh_stationary_reports(self, &[], now)?;
            collision_reports.extend(self.collision_reports.expire(now)?);
            profile.checkpoint("idle_settled_skip");
            profile.finish(format_args!(
                "bodies=0 outcomes=0 report_touches=0 idle_settled=true"
            ));
            return Ok(DynamicEntityCollectionTick {
                outcomes,
                snap_previous_placements,
                collision_reports,
                coverage_rejections,
            });
        }

        if !scratch.needs_refresh.is_empty() {
            scratch.needs_refresh.sort_unstable();
            for index in 0..scratch.needs_refresh.len() {
                let id = scratch.needs_refresh[index];
                if let Err(error) = self.refresh_dynamic_body_placement(id, collision) {
                    let Some(CollisionQueryError::UnavailableOwner { owner }) =
                        error.downcast_ref()
                    else {
                        return Err(error);
                    };
                    coverage_rejections.push(DynamicEntityCollectionCoverageRejection {
                        body_id: id,
                        owner: Guid(*owner),
                    });
                    scratch.rejected_ids.push(id);
                    continue;
                }
                if let Some(body) = self.body_store.body(id)
                    && let Some(physical) = body.physical.as_ref()
                    && let Some(dynamic) = physical.dynamic.as_ref()
                    && dynamic.demand.integration == LocalIntegrationDemand::Eligible
                    && dynamic.activity.participates_in_collision()
                {
                    let fixed = matches!(
                        physical.definition,
                        PhysicalBodyDefinition::FixedPosition { .. }
                    );
                    if fixed {
                        if dynamic.activity == DynamicBodyActivity::Active {
                            scratch.active_fixed.push(id);
                        }
                    } else if dynamic.activity == DynamicBodyActivity::Active {
                        scratch.active_mobile.push(id);
                        any_active_missile |= dynamic.collision.dynamic_collision.missile;
                    } else {
                        scratch.settled_mobile.push(id);
                    }
                }
            }
            scratch.rejected_ids.sort_unstable();
        }
        if scratch.active_fixed.len() > 1 {
            scratch.active_fixed.sort_unstable();
            scratch.active_fixed.dedup();
        }
        if scratch.settled_mobile.len() > 1 {
            scratch.settled_mobile.sort_unstable();
            scratch.settled_mobile.dedup();
        }

        let mut fixed_moved = false;
        for index in 0..scratch.active_fixed.len() {
            let id = scratch.active_fixed[index];
            if scratch.rejected_ids.binary_search(&id).is_ok() {
                continue;
            }
            let Some(body) = self.body_store.body(id) else {
                continue;
            };
            let Some(physical) = body.physical.as_ref() else {
                continue;
            };
            let Some(dynamic) = physical.dynamic.as_ref() else {
                continue;
            };
            if dynamic.demand.integration != LocalIntegrationDemand::Eligible
                || dynamic.activity != DynamicBodyActivity::Active
            {
                continue;
            }
            scratch.solved_ids.push(id);
            let old_pose = body.pose;
            let mut reconciliation = body.reconciliation.as_deref().copied();
            if let Some(target) = reconciliation
                .as_mut()
                .and_then(PoseReconciliationState::take_pending_snap)
            {
                let previous = body.clone();
                snap_previous_placements.insert(id, (previous.pose, previous.spatial_membership()));
                let relocated = self
                    .relocate_dynamic_body(id, target, now)
                    .context("fixed collection body could not be relocated")?;
                collision_reports.extend(relocated.collision_reports);
                let body = self
                    .body_store
                    .body_kinematics_mut(id)
                    .context("relocated fixed body disappeared")?;
                body.retained = previous.retained;
                body.motion_state = previous.motion_state;
                body.reconciliation = reconciliation
                    .filter(|state| !state.is_empty())
                    .map(Box::new);
                self.body_store.record_observation(id, false);
                outcomes.push(DynamicEntityBodyOutcome::FixedPlacement(id));
                self.refresh_dynamic_body_placement(id, collision)?;
                fixed_moved = true;
                self.peer_support_recheck_needed = true;
                if let Some(updated) = self.body_store.body(id) {
                    let anchor = crate::spatial::dynamic_index::landblock_owner(updated.pose);
                    if let Ok((min, max)) = body_sphere_bounds_in(updated, anchor, 0.5) {
                        scratch.moved_fixed_boxes.push((anchor, min, max));
                    }
                }
            } else {
                let input = input_for(body)?;
                let previous_contact = body.contact;
                let tick = self.tick_physical_body(id, collision, input, delta_seconds, now)?;
                collision_reports.extend(tick.collision_reports);
                let displacement =
                    tick.motion.path.final_point().center() - tick.motion.path.initial().center();
                let new_body = self
                    .body_store
                    .body(id)
                    .context("fixed publication body disappeared")?;
                if displacement != Vector3::zero() || new_body.pose.rotation != old_pose.rotation {
                    fixed_moved = true;
                    self.peer_support_recheck_needed = true;
                    let anchor = crate::spatial::dynamic_index::landblock_owner(new_body.pose);
                    if let Ok((min, max)) = body_sphere_bounds_in(new_body, anchor, 0.5) {
                        scratch.moved_fixed_boxes.push((anchor, min, max));
                    }
                }
                outcomes.push(DynamicEntityBodyOutcome::Integrated(Box::new(
                    DynamicEntityBodyTick {
                        body_id: id,
                        previous_pose: old_pose,
                        dynamic_state_change: tick.dynamic_state_change,
                        previous_contact,
                        current_contact: new_body.contact,
                        is_character: false,
                        displacement,
                        launch_admitted: false,
                        supported_motion: SupportedBodyMotion::default(),
                        path: tick.motion.path,
                    },
                )));
            }
        }
        profile.checkpoint("placement_and_fixed_bodies");

        let mut has_sleeping_settled = false;
        scratch.settled_inputs.reserve(scratch.settled_mobile.len());
        for index in 0..scratch.settled_mobile.len() {
            let id = scratch.settled_mobile[index];
            if scratch.rejected_ids.binary_search(&id).is_ok() {
                continue;
            }
            let Some(body) = self.body_store.body(id) else {
                continue;
            };
            let Some(physical) = body.physical.as_ref() else {
                continue;
            };
            let Some(dynamic) = physical.dynamic.as_ref() else {
                continue;
            };
            let input = input_for(body)?;
            let pose_will_change = input.preview_collision_pose_change(dynamic)?;
            let support_stale = (revision_changed || recheck_support || fixed_moved)
                && support_is_stale_for_settled(body, collision, &self.body_store);
            let fixed_overlap = !scratch.moved_fixed_boxes.is_empty()
                && scratch
                    .moved_fixed_boxes
                    .iter()
                    .any(|&(anchor, bmin, bmax)| {
                        body_sphere_bounds_in(body, anchor, 0.5)
                            .is_ok_and(|bounds| bounds_overlap(bounds, (bmin, bmax)))
                    });
            let wakes_now = !input.permits_dynamic_settling()
                || pose_will_change
                || body.has_pose_reconciliation_work()
                || body.retained.velocity != Vector3::zero()
                || body.retained.omega != Vector3::zero()
                || (matches!(
                    physical.definition,
                    PhysicalBodyDefinition::FreeSphere { .. }
                ) && body.retained.acceleration != Vector3::zero())
                || support_stale
                || fixed_overlap;
            if wakes_now {
                scratch.active_mobile.push(id);
                any_active_missile |= dynamic.collision.dynamic_collision.missile;
            } else {
                has_sleeping_settled = true;
            }
            scratch.settled_inputs.push((id, Some(input)));
        }

        if !scratch.rejected_ids.is_empty() {
            scratch
                .active_mobile
                .retain(|id| scratch.rejected_ids.binary_search(id).is_err());
        }
        scratch.active_mobile.sort_unstable();
        scratch.active_mobile.dedup();

        self.last_collection_collision_revision = Some(collision_revision);
        self.peer_support_recheck_needed = false;

        if scratch.active_mobile.is_empty() {
            let parked_bodies = std::mem::take(&mut scratch.parked_bodies);
            let mut collection = DynamicEntityCollectionTick {
                outcomes,
                snap_previous_placements,
                collision_reports,
                coverage_rejections,
            };
            self.try_unpark_authoritative_bodies(
                collision,
                &parked_bodies,
                revision_changed || recheck_support || fixed_moved,
                now,
                &mut collection,
            )?;
            scratch.solved_ids.sort_unstable();
            refresh_stationary_reports(self, &scratch.solved_ids, now)?;
            collection
                .collision_reports
                .extend(self.collision_reports.expire(now)?);
            profile.checkpoint("quiet_after_fixed");
            profile.finish(format_args!(
                "bodies=0 outcomes={} report_touches=0",
                collection.outcomes.len()
            ));
            return Ok(collection);
        }

        let anchor_pose = self
            .body_store
            .iter_bodies()
            .find(|body| {
                matches!(body.id, SpatialBodyId::LocalPlayer(_))
                    && scratch.rejected_ids.binary_search(&body.id).is_err()
                    && body
                        .physical
                        .as_ref()
                        .and_then(|p| p.dynamic.as_ref())
                        .is_some_and(|d| d.activity.participates_in_collision())
            })
            .or_else(|| self.body_store.body(scratch.active_mobile[0]))
            .context("active collection lost its anchor body")?
            .pose;
        let anchor = crate::spatial::dynamic_index::landblock_owner(anchor_pose);

        if has_sleeping_settled {
            for &(id, _) in &scratch.settled_inputs {
                if scratch.active_mobile.binary_search(&id).is_ok() {
                    continue;
                }
                let Some(stored) = self.body_store.stored_body(id) else {
                    continue;
                };
                let body = &stored.body;
                if is_hard_target_body(body) {
                    continue;
                }
                let pad =
                    body_min_radius(body) * MOBILE_CONTACT_CORRECTION_TRAVEL_RADIUS_RATIO + 0.05;
                let Ok((mut bmin, mut bmax)) = body_sphere_bounds_in(body, anchor, pad) else {
                    continue;
                };
                if (matches!(id, SpatialBodyId::LocalPlayer(_)) || any_active_missile)
                    && let Ok(Some((shapes_anchor, shapes))) = stored.ensure_natural_placed_shapes()
                    && !shapes.is_empty()
                    && let Ok(origin) = (WorldPosition {
                        landblock_id: shapes_anchor,
                        coords: Vector3::zero(),
                        rotation: Quaternion::identity(),
                    })
                    .reanchor_to_landblock_owner(anchor)
                {
                    let shift = origin.coords;
                    for shape in shapes.iter() {
                        let smin = shape.bounds.minimum() + shift;
                        let smax = shape.bounds.maximum() + shift;
                        bmin.x = bmin.x.min(smin.x);
                        bmin.y = bmin.y.min(smin.y);
                        bmin.z = bmin.z.min(smin.z);
                        bmax.x = bmax.x.max(smax.x);
                        bmax.y = bmax.y.max(smax.y);
                        bmax.z = bmax.z.max(smax.z);
                    }
                }
                scratch.settled_candidates.push((id, bmin, bmax, false));
            }
        }

        let expand_neighbors = !scratch.settled_candidates.is_empty();
        scratch.snapshots.reserve(scratch.active_mobile.len());
        scratch.actuators.reserve(scratch.active_mobile.len());
        if expand_neighbors {
            scratch.frontier.reserve(scratch.active_mobile.len());
        }
        for index in 0..scratch.active_mobile.len() {
            let id = scratch.active_mobile[index];
            let mut body = self
                .body_store
                .body(id)
                .cloned()
                .context("active prepared body disappeared")?;
            let actuator = prepare_cluster_body(
                &mut body,
                id,
                collision,
                &mut scratch.settled_inputs,
                &mut scratch.prepared_pose_changed,
                input_for,
            )?;
            if expand_neighbors {
                scratch.frontier.push(mover_interaction_bounds(
                    &body,
                    Some(&actuator.input),
                    delta_seconds,
                    anchor,
                )?);
            }
            scratch.actuators.push((id, Some(actuator)));
            scratch.snapshots.push(body);
        }

        let mut added_settled = false;
        if expand_neighbors {
            let mut cursor = 0;
            while cursor < scratch.frontier.len() {
                let (fmin, fmax, fmembership) = scratch.frontier[cursor].clone();
                cursor += 1;
                for index in 0..scratch.settled_candidates.len() {
                    let (cand_id, cmin, cmax, visited) = scratch.settled_candidates[index];
                    if visited || !bounds_overlap((fmin, fmax), (cmin, cmax)) {
                        continue;
                    }
                    let Some(existing) = self.body_store.body(cand_id) else {
                        continue;
                    };
                    let Some(existing_dynamic) =
                        existing.physical.as_ref().and_then(|p| p.dynamic.as_ref())
                    else {
                        continue;
                    };
                    if !fmembership.intersects_reached(&existing_dynamic.placement) {
                        continue;
                    }
                    scratch.settled_candidates[index].3 = true;
                    added_settled = true;
                    let mut body = existing.clone();
                    let actuator = prepare_cluster_body(
                        &mut body,
                        cand_id,
                        collision,
                        &mut scratch.settled_inputs,
                        &mut scratch.prepared_pose_changed,
                        input_for,
                    )?;
                    scratch.frontier.push(mover_interaction_bounds(
                        &body,
                        Some(&actuator.input),
                        delta_seconds,
                        anchor,
                    )?);
                    scratch.actuators.push((cand_id, Some(actuator)));
                    scratch.snapshots.push(body);
                }
            }
        }
        if added_settled {
            scratch.snapshots.sort_unstable_by_key(|body| body.id);
            scratch.actuators.sort_unstable_by_key(|(id, _)| *id);
        }
        if !scratch.prepared_pose_changed.is_empty() {
            scratch.prepared_pose_changed.sort_unstable();
        }
        profile.checkpoint("input_capture");

        if !scratch.refreshed_or_fixed.is_empty() {
            scratch.refreshed_or_fixed.sort_unstable();
            scratch.refreshed_or_fixed.dedup();
        }
        let has_non_cluster_indexed_entity = has_stationary_indexed_entity
            || scratch.settled_mobile.iter().any(|&id| {
                matches!(id, SpatialBodyId::Entity(_))
                    && scratch
                        .snapshots
                        .binary_search_by_key(&id, |b| b.id)
                        .is_err()
                    && self
                        .body_store
                        .body(id)
                        .is_some_and(|b| indexed_dynamic_body(b).is_some())
            })
            || scratch.refreshed_or_fixed.iter().any(|&id| {
                matches!(id, SpatialBodyId::Entity(_))
                    && scratch
                        .snapshots
                        .binary_search_by_key(&id, |b| b.id)
                        .is_err()
                    && self
                        .body_store
                        .body(id)
                        .is_some_and(|b| indexed_dynamic_body(b).is_some())
            });
        let entity_snapshot = if has_non_cluster_indexed_entity {
            Some(self.entity_collision_snapshot()?)
        } else {
            None
        };
        let base_hard_targets = self.body_store.hard_targets_in_mut(anchor)?;
        let mut hard_targets = std::borrow::Cow::Borrowed(base_hard_targets.as_ref());
        if !scratch.prepared_pose_changed.is_empty() {
            for &id in &scratch.prepared_pose_changed {
                let Ok(pos) = scratch.snapshots.binary_search_by_key(&id, |b| b.id) else {
                    continue;
                };
                let body = &scratch.snapshots[pos];
                if !is_hard_target_body(body) {
                    continue;
                }
                let physical = body
                    .physical
                    .as_ref()
                    .context("prepared hard body lost physical state")?;
                let dynamic = physical
                    .dynamic
                    .as_ref()
                    .context("prepared hard body lost dynamic state")?;
                let shapes: Arc<[holtburger_content::PlacedCollisionShape]> =
                    placed_target_shapes(dynamic, body.pose, anchor)?.into();
                hard_targets.to_mut().replace(
                    crate::spatial::mobile_contact::step_sweep_target(
                        crate::spatial::mobile_contact::ContactParticipant::from_dynamic(
                            body,
                            dynamic,
                            physical.collision_filter,
                        ),
                        0,
                        shapes,
                    ),
                )?;
            }
        }

        let mut overrides = Vec::new();
        for body in &scratch.snapshots {
            let Some(physical) = body.physical.as_ref() else {
                continue;
            };
            let Some(dynamic) = physical.dynamic.as_ref() else {
                continue;
            };
            let pose_changed = !scratch.prepared_pose_changed.is_empty()
                && scratch
                    .prepared_pose_changed
                    .binary_search(&body.id)
                    .is_ok();
            if dynamic_target_is_indexed(body.id, dynamic) {
                if entity_snapshot.is_none()
                    || !matches!(body.id, SpatialBodyId::Entity(_))
                    || pose_changed
                {
                    let (shapes_anchor, shapes) = if !pose_changed
                        && let Some(cached) = self
                            .body_store
                            .stored_body(body.id)
                            .and_then(|stored| stored.ensure_natural_placed_shapes().transpose())
                    {
                        cached?
                    } else {
                        let natural_anchor =
                            crate::spatial::dynamic_index::landblock_owner(body.pose);
                        (
                            natural_anchor,
                            placed_target_shapes(dynamic, body.pose, natural_anchor)?.into(),
                        )
                    };
                    overrides.push(SceneContactReportOverride {
                        id: body.id,
                        dynamic,
                        shapes_anchor,
                        shapes,
                    });
                }
            } else if pose_changed
                && entity_snapshot.is_some()
                && matches!(body.id, SpatialBodyId::Entity(_))
            {
                overrides.push(SceneContactReportOverride {
                    id: body.id,
                    dynamic,
                    shapes_anchor: crate::spatial::dynamic_index::landblock_owner(body.pose),
                    shapes: Arc::from([]),
                });
            }
        }
        // LocalPlayer or unindexed Hard targets outside `snapshots` can still participate in reports.
        for &id in &scratch.extra_report_ids {
            if scratch
                .snapshots
                .binary_search_by_key(&id, |b| b.id)
                .is_ok()
            {
                continue;
            }
            if let Some(stored) = self.body_store.stored_body(id) {
                push_override_from_stored(&mut overrides, id, stored)?;
            }
        }
        for &id in &scratch.refreshed_or_fixed {
            if scratch
                .snapshots
                .binary_search_by_key(&id, |b| b.id)
                .is_ok()
            {
                continue;
            }
            if let Some(stored) = self.body_store.stored_body(id) {
                push_override_from_stored(&mut overrides, id, stored)?;
            }
        }

        let result = advance_body_contact_collection_prepared(
            collision,
            &scratch.snapshots,
            anchor,
            delta_seconds,
            SceneContactPreparation {
                entity_snapshot: entity_snapshot.as_deref(),
                hard_targets: &hard_targets,
                overrides: &overrides,
            },
            &mut scratch.step,
            |body, ground, interval| {
                let pos = scratch
                    .actuators
                    .binary_search_by_key(&body.id, |(id, _)| *id)
                    .map_err(|_| anyhow::anyhow!("contact body has no captured input"))?;
                let actuator = scratch.actuators[pos]
                    .1
                    .as_mut()
                    .context("contact body input was already consumed")?;
                let input = actuator
                    .input
                    .step(body, ground, interval, &mut actuator.reconciliation)
                    .with_context(|| format!("contact input rejected for {:?}", body.id))?;
                actuator.nominal_velocity = input.nominal_velocity;
                actuator.external_translation |= input.external_translation;
                Ok(input.actuation)
            },
        );
        drop(overrides);
        drop(entity_snapshot);
        drop(hard_targets);
        drop(base_hard_targets);
        let result = match result {
            Ok(result) => {
                if self.last_contact_failure.take().is_some() {
                    log::info!("mobile contact simulation resumed");
                }
                result
            }
            Err(error) => {
                // Input was captured once and the solver changed only private snapshots.
                // Discard this mobile proposal without replaying input or undoing fixed bodies
                // already committed above. The next scheduled tick samples fresh input.
                let diagnostic = format!("{error:#}");
                if self.last_contact_failure.as_ref() != Some(&diagnostic) {
                    log::warn!(
                        "mobile contact solve rejected; retaining committed poses: {diagnostic}"
                    );
                    self.last_contact_failure = Some(diagnostic);
                }
                scratch.solved_ids.sort_unstable();
                refresh_stationary_reports(self, &scratch.solved_ids, now)?;
                collision_reports.extend(self.collision_reports.expire(now)?);
                return Ok(DynamicEntityCollectionTick {
                    outcomes,
                    snap_previous_placements,
                    collision_reports,
                    coverage_rejections,
                });
            }
        };
        profile.checkpoint("integration_and_reports");
        collision_reports.extend(
            self.collision_reports
                .preview_touches(&result.report_touches, now)?,
        );
        profile.checkpoint("report_lifetimes");
        let mut publications = Vec::with_capacity(result.bodies.len());
        outcomes.reserve(result.bodies.len());
        let prepared_body_count = scratch.snapshots.len();
        let mut prepared_bodies = scratch.snapshots.drain(..);
        for update in result.bodies {
            scratch.solved_ids.push(update.body_id);
            let previous = self
                .body_store
                .body(update.body_id)
                .context("contact publication body disappeared")?;
            let mut body = prepared_bodies
                .by_ref()
                .find(|body| body.id == update.body_id)
                .context("contact publication lost its prepared body")?;
            let previous_contact = body.contact;
            update.apply_physical_state(&mut body)?;
            let actuator_pos = scratch
                .actuators
                .binary_search_by_key(&body.id, |(id, _)| *id)
                .map_err(|_| anyhow::anyhow!("contact publication lost its input"))?;
            let actuator = scratch.actuators[actuator_pos]
                .1
                .take()
                .context("contact publication lost its input")?;
            let is_character =
                matches!(actuator.input.actuation, PhysicalBodyActuation::Grounded(_));
            let external_translation = actuator.external_translation || update.supported_push;
            if let Some(destination) = actuator.finish(&mut body, &update, delta_seconds, now)? {
                scratch.recovery_requests.push((body.id, destination));
            }
            if body
                .physical
                .as_ref()
                .and_then(|physical| physical.dynamic.as_ref())
                .is_some_and(|dynamic| dynamic.collision.uses_physics_bsp)
            {
                let placement = resolve_dynamic_body_placement(
                    collision,
                    &body,
                    update.membership.committed_cell(),
                )?;
                body.physical
                    .as_mut()
                    .and_then(|physical| physical.dynamic.as_mut())
                    .context("BSP publication lost its dynamic state")?
                    .placement = placement;
            }
            if let Some(owner) = update.unavailable_owner {
                coverage_rejections.push(DynamicEntityCollectionCoverageRejection {
                    body_id: body.id,
                    owner,
                });
            }
            let saved_derived_at = body.sampling.last_derived_at;
            body.sampling.last_derived_at = previous.sampling.last_derived_at;
            let body_unchanged = *previous == body;
            body.sampling.last_derived_at = saved_derived_at;
            let unchanged_settled = body_unchanged
                && update.unavailable_owner.is_none()
                && body
                    .physical
                    .as_ref()
                    .and_then(|p| p.dynamic.as_ref())
                    .is_some_and(|d| d.activity == DynamicBodyActivity::Settled);
            if !unchanged_settled {
                outcomes.push(DynamicEntityBodyOutcome::Integrated(Box::new(
                    DynamicEntityBodyTick {
                        body_id: body.id,
                        previous_pose: previous.pose,
                        dynamic_state_change: update.projectile_impact.map(|_| {
                            super::super::DynamicBodyPhysicsStateChange::projectile_impact()
                        }),
                        previous_contact,
                        current_contact: body.contact,
                        is_character,
                        displacement: update.displacement,
                        launch_admitted: update.launch_admitted,
                        path: super::super::PlacedMotionPath::from_contact_motion(
                            previous,
                            &body,
                            &update.motion,
                        )?,
                        supported_motion: SupportedBodyMotion {
                            accepted: AcceptedBodyMotion {
                                velocity: update.supported_velocity,
                                omega: update.accepted_motion.omega,
                            },
                            external_translation,
                        },
                    },
                )));
            }
            let moved_from_previous = body.pose != previous.pose;
            publications.push((body, unchanged_settled, moved_from_previous));
        }
        drop(prepared_bodies);
        profile.checkpoint("accepted_path_preparation");
        for (body, unchanged_settled, moved_from_previous) in publications {
            if unchanged_settled {
                self.body_store.touch_sampling_timestamp(body.id, now);
            } else {
                let body_id = body.id;
                let new_pose = body.pose;
                let previous = self
                    .body_store
                    .update_body_with_revision(body, Some(collision_revision))
                    .context("contact publication replaced an absent body")?;
                self.replace_body_membership(body_id, Some(previous.pose), Some(new_pose));
                if moved_from_previous {
                    self.peer_support_recheck_needed = true;
                }
            }
        }
        self.collision_reports
            .commit_touches(&result.report_touches, now);
        profile.checkpoint("body_publication");
        let mut collection = DynamicEntityCollectionTick {
            outcomes,
            snap_previous_placements,
            collision_reports,
            coverage_rejections,
        };
        let recovery_requests = std::mem::take(&mut scratch.recovery_requests);
        let parked_bodies = std::mem::take(&mut scratch.parked_bodies);
        let any_peer_moved = self.peer_support_recheck_needed;
        self.recover_contact_placements(collision, recovery_requests, now, &mut collection)?;
        self.try_unpark_authoritative_bodies(
            collision,
            &parked_bodies,
            revision_changed || recheck_support || fixed_moved || any_peer_moved,
            now,
            &mut collection,
        )?;
        scratch.solved_ids.sort_unstable();
        refresh_stationary_reports(self, &scratch.solved_ids, now)?;
        collection
            .collision_reports
            .extend(self.collision_reports.expire(now)?);
        profile.checkpoint("recovery_and_report_expiry");
        profile.finish(format_args!(
            "bodies={} outcomes={} report_touches={}",
            prepared_body_count,
            collection.outcomes.len(),
            result.report_touches.len(),
        ));
        Ok(collection)
    }

    /// Checks recovery against accepted scene state and replaces the ordinary visible result.
    /// Relocation retires physical/report state; the recovered classification makes consumers
    /// reset source continuation and publish a discontinuity instead of the superseded path.
    fn recover_contact_placements(
        &mut self,
        collision: &CollisionScene,
        recovery_requests: Vec<(SpatialBodyId, WorldPosition)>,
        now: Instant,
        collection: &mut DynamicEntityCollectionTick,
    ) -> anyhow::Result<()> {
        // Validate against committed endpoints, including earlier recoveries in this batch.
        let mut recovery_peers = if recovery_requests.is_empty() {
            Vec::new()
        } else {
            let mut peers = self.body_store.iter_bodies().cloned().collect::<Vec<_>>();
            peers.sort_by_key(|body| body.id);
            peers
        };
        for (body_id, destination) in recovery_requests {
            let source = self
                .body_store
                .body(body_id)
                .context("recovery body disappeared")?;
            let mut candidate = relocated_dynamic_body(source, destination, now)
                .context("recovery requires a dynamic body")?;
            let Some((membership, verdict)) =
                evaluate_recovery_candidate(collision, &mut candidate, &recovery_peers)?
            else {
                continue;
            };
            let (pose, membership, park_authoritatively) = match verdict {
                super::super::mobile_contact::RecoveryDestinationCheck::Clear {
                    pose,
                    membership,
                } => (pose, membership, false),
                super::super::mobile_contact::RecoveryDestinationCheck::BlockedByMobilePeer => {
                    // Never park on top of a live blocking mobile peer (preserves body-blocking
                    // and prevents players from disabling mob collision by standing on their spot).
                    continue;
                }
                super::super::mobile_contact::RecoveryDestinationCheck::BlockedByStaticOrUnsupported => {
                    // RETAIL DIVERGENCE: Retail behavior is to reject placement recovery when the
                    // destination overlaps static/hard geometry (leaving stalled remote actors
                    // stranded outside obstacles) or to drop floating authoritative poses under
                    // gravity. For remote yielding characters whose destination is clear of
                    // blocking mobile peers and inside resident topology, park at the exact server
                    // pose with physics and collision paused until a later pose, collision
                    // revision, or peer departure clears placement; blocking mobile peer overlaps
                    // remain rejected so body-blocking and combat collision invariants stay intact.
                    // Sized by the 2026-11-26 Hebian-to West Wind Tower live census (Scenarios
                    // 1-6b) and the parked-wall, floating-hover, peer-blocking, and unpark tests.
                    if !matches!(body_id, SpatialBodyId::Entity(_)) {
                        continue;
                    }
                    (destination, membership, true)
                }
            };
            self.commit_recovered_body(
                candidate,
                pose,
                membership,
                park_authoritatively,
                &mut recovery_peers,
                collection,
            )?;
            // The old accepted path is no longer this tick's visible movement.
            let outcome = collection
                .outcomes
                .iter_mut()
                .find(|outcome| outcome.body_id() == body_id)
                .context("recovered body lost its collection outcome")?;
            if let DynamicEntityBodyOutcome::Integrated(integrated) = outcome {
                collection.snap_previous_placements.insert(
                    body_id,
                    (
                        integrated.previous_pose,
                        integrated.path.initial().placement().clone(),
                    ),
                );
            }
            *outcome = DynamicEntityBodyOutcome::RecoveredPlacement(body_id);
        }
        Ok(())
    }

    /// Promotes `AuthoritativeParked` remote bodies back to full `Active` physical simulation
    /// once their current authoritative pose clears static geometry, hard obstacles, peers, and
    /// walkable support.
    fn try_unpark_authoritative_bodies(
        &mut self,
        collision: &CollisionScene,
        parked_bodies: &[(SpatialBodyId, bool)],
        scene_changed: bool,
        now: Instant,
        collection: &mut DynamicEntityCollectionTick,
    ) -> anyhow::Result<()> {
        let candidates: Vec<SpatialBodyId> = parked_bodies
            .iter()
            .filter_map(|&(id, pose_dirty)| (pose_dirty || scene_changed).then_some(id))
            .collect();
        if candidates.is_empty() {
            return Ok(());
        }
        let mut peers = self.body_store.iter_bodies().cloned().collect::<Vec<_>>();
        peers.sort_by_key(|body| body.id);
        for body_id in candidates {
            let Some(source) = self.body_store.body(body_id) else {
                continue;
            };
            let is_still_parked = source
                .physical
                .as_ref()
                .and_then(|p| p.dynamic.as_ref())
                .is_some_and(|d| d.activity == DynamicBodyActivity::AuthoritativeParked);
            if !is_still_parked {
                continue;
            }
            let previous_pose = source.pose;
            let previous_membership = source.spatial_membership();
            let mut candidate = relocated_dynamic_body(source, source.pose, now)
                .context("unparked body requires dynamic physics")?;
            let Some((
                _,
                super::super::mobile_contact::RecoveryDestinationCheck::Clear { pose, membership },
            )) = evaluate_recovery_candidate(collision, &mut candidate, &peers)?
            else {
                continue;
            };
            self.commit_recovered_body(candidate, pose, membership, false, &mut peers, collection)?;
            collection
                .snap_previous_placements
                .insert(body_id, (previous_pose, previous_membership));
            collection
                .outcomes
                .push(DynamicEntityBodyOutcome::RecoveredPlacement(body_id));
        }
        Ok(())
    }

    fn commit_recovered_body(
        &mut self,
        mut candidate: SpatialBody,
        pose: WorldPosition,
        membership: SpatialMembership,
        park_authoritatively: bool,
        peers: &mut [SpatialBody],
        collection: &mut DynamicEntityCollectionTick,
    ) -> anyhow::Result<()> {
        let body_id = candidate.id;
        candidate.pose = pose;
        let physical = candidate
            .physical
            .as_mut()
            .context("validated recovery lost physics")?;
        physical.reset_placement(membership.committed_cell());
        let dynamic = physical
            .dynamic
            .as_mut()
            .context("validated recovery lost dynamic placement")?;
        dynamic.placement = membership;
        if park_authoritatively {
            dynamic.activity = DynamicBodyActivity::AuthoritativeParked;
            candidate.contact = ContactState::Unknown;
            candidate.sampling.mode = SpatialSampleMode::AuthoritativeOnly;
        } else {
            dynamic.activity = DynamicBodyActivity::Active;
            candidate.sampling.mode = SpatialSampleMode::SimulatingVelocity;
        }
        let relocated = self.publish_dynamic_relocation(candidate);
        let peer = peers
            .iter_mut()
            .find(|peer| peer.id == body_id)
            .context("recovered body lost its placement-validation snapshot")?;
        *peer = self
            .body_store
            .body(body_id)
            .context("recovered body disappeared before placement validation")?
            .clone();
        collection
            .collision_reports
            .extend(relocated.collision_reports);
        Ok(())
    }
}

/// Resolves resident placement and evaluates exact clearance for a recovery/unpark candidate.
/// Returns `Ok(None)` when the destination's collision topology is not currently resident.
fn evaluate_recovery_candidate(
    collision: &CollisionScene,
    candidate: &mut SpatialBody,
    peers: &[SpatialBody],
) -> anyhow::Result<
    Option<(
        SpatialMembership,
        super::super::mobile_contact::RecoveryDestinationCheck,
    )>,
> {
    let checked = (|| -> anyhow::Result<(
        SpatialMembership,
        super::super::mobile_contact::RecoveryDestinationCheck,
    )> {
        let membership = resolve_dynamic_body_placement(
            collision,
            candidate,
            candidate
                .pose
                .is_indoors()
                .then_some(candidate.pose.landblock_id),
        )?;
        candidate
            .physical
            .as_mut()
            .and_then(|p| p.dynamic.as_mut())
            .context("recovery candidate lost dynamic placement")?
            .placement = membership.clone();
        let verdict =
            super::super::mobile_contact::evaluate_recovery_destination(collision, candidate, peers)?;
        Ok((membership, verdict))
    })();
    match checked {
        Ok(result) => Ok(Some(result)),
        Err(error)
            if matches!(
                error.downcast_ref::<CollisionQueryError>(),
                Some(
                    CollisionQueryError::UnavailableOwner { .. }
                        | CollisionQueryError::UnknownMotionCell { .. }
                )
            ) =>
        {
            Ok(None)
        }
        Err(error) => Err(error),
    }
}
