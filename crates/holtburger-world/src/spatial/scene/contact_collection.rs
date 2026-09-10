//! Scene-owned input capture, reference lifetime, and publication for bounded contact steps.

use super::*;
use crate::spatial::{AcceptedBodyMotion, ContactBodyUpdate, advance_body_contact_collection};

/// One admitted producer sample and its private reference continuation for the collection.
struct CollectionActuator {
    /// Ordinary input is sampled once for the admitted collection tick.
    input: PhysicalBodyInput,
    /// Copied reconciliation is published only with the accepted body.
    reconciliation: Option<PoseReconciliationState>,
    /// Independent final nominal continuation used to decide return completion.
    nominal_velocity: Vector3,
    /// Collision pose already sampled on the speculative body, preserved on publication.
    collision_poses: super::super::dynamic_body::CollisionPartPoses,
}

impl CollectionActuator {
    /// Finalizes accepted continuation, return progress and sleep state on a private body copy.
    /// The returned destination requests later recovery; this operation never relocates or publishes.
    fn finish(
        self,
        body: &mut SpatialBody,
        update: &ContactBodyUpdate,
        player_poses: [Option<&SpatialBody>; 2],
        delta_seconds: f32,
        now: Instant,
    ) -> anyhow::Result<Option<WorldPosition>> {
        let [player_before, player_after] = player_poses;
        let mut recovery = None;
        body.nominal.velocity = self.nominal_velocity;
        let mut reconciliation = if update.projectile_impact.is_some() {
            None
        } else {
            self.reconciliation
        };
        if let Some(state) = reconciliation.as_mut() {
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
        }
        if let (Some(state), Some(destination)) = (reconciliation.as_mut(), body.authoritative_pose)
        {
            let permitted = matches!(body.id, SpatialBodyId::Entity(_))
                && body.physical.as_ref().is_some_and(|physical| {
                    matches!(physical.definition, PhysicalBodyDefinition::Grounded { .. })
                        && physical
                            .dynamic
                            .as_ref()
                            .is_some_and(|dynamic| dynamic.collision.contact_response.yields())
                })
                && !self.input.recovery_suspended
                && !super::super::mobile_contact::has_player_contact(body, player_before)?
                && !super::super::mobile_contact::has_player_contact(body, player_after)?;
            if state.observe_recovery(body.pose, destination, delta_seconds, permitted) {
                recovery = Some(destination);
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
        dynamic.collision_poses = self.collision_poses;
        dynamic.activity = if quiet {
            DynamicBodyActivity::Settled
        } else {
            DynamicBodyActivity::Active
        };
        Ok(recovery)
    }
}

impl SpatialScene {
    pub(super) fn advance_contact_entity_collection(
        &mut self,
        collision: &CollisionScene,
        delta_seconds: f32,
        now: Instant,
        mut input_for: impl FnMut(&SpatialBody) -> anyhow::Result<PhysicalBodyInput>,
    ) -> anyhow::Result<DynamicEntityCollectionTick> {
        anyhow::ensure!(
            delta_seconds.is_finite() && delta_seconds > 0.0,
            "contact collection interval must be finite and positive"
        );
        let delta_seconds = delta_seconds.min(super::super::MOBILE_CONTACT_TICK_SECONDS);
        let mut ids = self
            .body_store
            .bodies
            .values()
            .filter(|body| !matches!(body.id, SpatialBodyId::Ephemeral(_)))
            .filter(|body| {
                body.physical
                    .as_ref()
                    .and_then(|physical| physical.dynamic.as_ref())
                    .is_some()
            })
            .map(|body| body.id)
            .collect::<Vec<_>>();
        ids.sort_unstable();
        // Residency refresh owns activity changes. Carry its resulting admission decision into
        // input capture instead of recovering physical/dynamic fields a second time.
        let mut prepared = Vec::with_capacity(ids.len());
        let mut coverage_rejections = Vec::new();
        let mut outcomes = Vec::new();
        let mut collision_reports = Vec::new();
        for &id in &ids {
            if let Err(error) = self.refresh_dynamic_body_placement(id, collision) {
                let Some(CollisionQueryError::UnavailableOwner { owner }) = error.downcast_ref()
                else {
                    return Err(error);
                };
                coverage_rejections.push(DynamicEntityCollectionCoverageRejection {
                    body_id: id,
                    owner: Guid(*owner),
                });
                continue;
            }
            let body = self
                .body_store
                .body(id)
                .context("captured body disappeared")?;
            let physical = body
                .physical
                .as_ref()
                .context("captured body lost physics")?;
            let dynamic = physical
                .dynamic
                .as_ref()
                .context("captured body lost dynamic placement")?;
            let fixed = matches!(
                physical.definition,
                PhysicalBodyDefinition::FixedPosition { .. }
            );
            let eligible = dynamic.demand.integration == LocalIntegrationDemand::Eligible;
            prepared.push((
                id,
                !fixed && eligible && dynamic.activity != DynamicBodyActivity::Suspended,
            ));
            if !fixed || !eligible || dynamic.activity != DynamicBodyActivity::Active {
                continue;
            }
            // Fixed placements precede mobile sweeps, so their authored shapes are hard targets
            // at the accepted pose throughout this collection.
            let mut reconciliation = body.reconciliation.as_deref().copied();
            if let Some(target) = reconciliation
                .as_mut()
                .and_then(PoseReconciliationState::take_pending_snap)
            {
                let previous = body.clone();
                let relocated = self
                    .relocate_dynamic_body(id, target, now)
                    .context("fixed collection body could not be relocated")?;
                collision_reports.extend(relocated.collision_reports);
                let body = self
                    .body_store
                    .body_mut(id)
                    .context("relocated fixed body disappeared")?;
                body.retained = previous.retained;
                body.motion_state = previous.motion_state;
                body.reconciliation = reconciliation
                    .filter(|state| !state.is_empty())
                    .map(Box::new);
                outcomes.push(DynamicEntityBodyOutcome::FixedPlacement(id));
                self.refresh_dynamic_body_placement(id, collision)?;
            } else {
                let input = input_for(body)?;
                let previous_contact = body.contact;
                let tick = self.tick_physical_body(id, collision, input, delta_seconds, now)?;
                collision_reports.extend(tick.collision_reports);
                outcomes.push(DynamicEntityBodyOutcome::Integrated(
                    DynamicEntityBodyTick {
                        body_id: id,
                        dynamic_state_change: tick.dynamic_state_change,
                        previous_contact,
                        current_contact: self
                            .body_store
                            .body(id)
                            .context("fixed publication body disappeared")?
                            .contact,
                        is_character: false,
                        displacement: tick.motion.path.final_point().center()
                            - tick.motion.path.initial().center(),
                        launch_admitted: false,
                        supported_motion: AcceptedBodyMotion::default(),
                        path: tick.motion.path,
                    },
                ));
            }
        }
        let mut snapshots = Vec::with_capacity(prepared.len());
        let mut actuators = BTreeMap::new();
        for (id, integrates_mobile) in prepared {
            let mut body = self
                .body_store
                .body(id)
                .cloned()
                .context("prepared body disappeared")?;
            if integrates_mobile {
                let input = input_for(&body)?;
                let mut reconciliation = body.reconciliation.as_deref().copied();
                if input.prepare(&mut body, &mut reconciliation)? {
                    let cell = body.physical.as_ref().and_then(|p| p.response.cell());
                    let placement = resolve_dynamic_body_placement(collision, &body, cell)?;
                    body.physical
                        .as_mut()
                        .and_then(|p| p.dynamic.as_mut())
                        .context("prepared collision pose lost its dynamic state")?
                        .placement = placement;
                }
                let collision_poses = body
                    .physical
                    .as_ref()
                    .and_then(|p| p.dynamic.as_ref())
                    .context("collection input lost its dynamic state")?
                    .collision_poses
                    .clone();
                actuators.insert(
                    body.id,
                    CollectionActuator {
                        input,
                        reconciliation,
                        nominal_velocity: body.nominal.velocity,
                        collision_poses,
                    },
                );
            }
            snapshots.push(body);
        }
        let Some(anchor_body) = snapshots
            .iter()
            .find(|body| matches!(body.id, SpatialBodyId::LocalPlayer(_)))
            .or_else(|| snapshots.first())
        else {
            collision_reports.extend(self.collision_reports.expire(now)?);
            return Ok(DynamicEntityCollectionTick {
                outcomes,
                collision_reports,
                coverage_rejections,
            });
        };
        let result = advance_body_contact_collection(
            collision,
            &snapshots,
            Guid(anchor_body.pose.landblock_id.0 | 0xffff),
            delta_seconds,
            |body, ground, interval| {
                let actuator = actuators
                    .get_mut(&body.id)
                    .context("contact body has no captured input")?;
                let input =
                    actuator
                        .input
                        .step(body, ground, interval, &mut actuator.reconciliation)?;
                actuator.nominal_velocity = input.nominal_velocity;
                Ok(input.actuation)
            },
        )?;
        collision_reports.extend(
            self.collision_reports
                .preview_touches(&result.report_touches, now)?,
        );
        let player_before = snapshots
            .iter()
            .find(|body| matches!(body.id, SpatialBodyId::LocalPlayer(_)));
        let mut player_after = player_before.cloned();
        if let Some(player) = player_after.as_mut()
            && let Some(update) = result
                .bodies
                .iter()
                .find(|update| update.body_id == player.id)
        {
            update.apply_physical_state(player)?;
        }
        let mut recovery_requests = Vec::new();
        let mut publications = Vec::with_capacity(result.bodies.len());
        outcomes.reserve(result.bodies.len());
        for update in result.bodies {
            let previous = self
                .body_store
                .body(update.body_id)
                .context("contact publication body disappeared")?;
            let mut body = previous.clone();
            let previous_contact = body.contact;
            update.apply_physical_state(&mut body)?;
            let actuator = actuators
                .remove(&body.id)
                .context("contact publication lost its input")?;
            // Contact preparation has already matched actuation to the installed definition.
            let is_character =
                matches!(actuator.input.actuation, PhysicalBodyActuation::Grounded(_));
            if let Some(destination) = actuator.finish(
                &mut body,
                &update,
                [player_before, player_after.as_ref()],
                delta_seconds,
                now,
            )? {
                recovery_requests.push((body.id, destination));
            }
            if body
                .physical
                .as_ref()
                .and_then(|physical| physical.dynamic.as_ref())
                .is_some_and(|dynamic| dynamic.collision.uses_physics_bsp)
            {
                // The contact result owns movement-sphere coverage. BSP targets publish their
                // part-box coverage at the accepted root and authored pose instead.
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
            outcomes.push(DynamicEntityBodyOutcome::Integrated(
                DynamicEntityBodyTick {
                    body_id: body.id,
                    dynamic_state_change: update
                        .projectile_impact
                        .map(|_| super::super::DynamicBodyPhysicsStateChange::projectile_impact()),
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
                    supported_motion: AcceptedBodyMotion {
                        velocity: update.supported_velocity,
                        omega: update.accepted_motion.omega,
                    },
                },
            ));
            publications.push(body);
        }
        for body in publications {
            self.update_body(body)
                .context("contact publication replaced an absent body")?;
        }
        self.collision_reports
            .commit_touches(&result.report_touches, now);
        let mut collection = DynamicEntityCollectionTick {
            outcomes,
            collision_reports,
            coverage_rejections,
        };
        self.recover_contact_placements(collision, recovery_requests, now, &mut collection)?;
        collection
            .collision_reports
            .extend(self.collision_reports.expire(now)?);
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
        // Only mobile characters recover; hard targets remain fixed throughout this batch.
        let recovery_peers = if recovery_requests.is_empty() {
            Vec::new()
        } else {
            let mut peers = self.body_store.bodies.values().cloned().collect::<Vec<_>>();
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
            let checked = (|| -> anyhow::Result<Option<(WorldPosition, SpatialMembership)>> {
                let membership = resolve_dynamic_body_placement(
                    collision,
                    &candidate,
                    destination.is_indoors().then_some(destination.landblock_id),
                )?;
                candidate
                    .physical
                    .as_mut()
                    .and_then(|p| p.dynamic.as_mut())
                    .context("recovery candidate lost dynamic placement")?
                    .placement = membership;
                super::super::mobile_contact::checked_recovery_destination(
                    collision,
                    &candidate,
                    &recovery_peers,
                )
            })();
            let (pose, membership) = match checked {
                Ok(Some(pose)) => pose,
                Ok(None) => continue,
                Err(error)
                    if matches!(
                        error.downcast_ref::<CollisionQueryError>(),
                        Some(
                            CollisionQueryError::UnavailableOwner { .. }
                                | CollisionQueryError::UnknownMotionCell { .. }
                        )
                    ) =>
                {
                    continue;
                }
                Err(error) => return Err(error),
            };
            candidate.pose = pose;
            let physical = candidate
                .physical
                .as_mut()
                .context("validated recovery lost physics")?;
            physical.reset_placement(membership.committed_cell());
            physical
                .dynamic
                .as_mut()
                .context("validated recovery lost dynamic placement")?
                .placement = membership;
            let relocated = self.publish_dynamic_relocation(candidate);
            collection
                .collision_reports
                .extend(relocated.collision_reports);
            // The old accepted path is no longer this tick's visible movement.
            let outcome = collection
                .outcomes
                .iter_mut()
                .find(|outcome| outcome.body_id() == body_id)
                .context("recovered body lost its collection outcome")?;
            *outcome = DynamicEntityBodyOutcome::RecoveredPlacement(body_id);
        }
        Ok(())
    }
}
