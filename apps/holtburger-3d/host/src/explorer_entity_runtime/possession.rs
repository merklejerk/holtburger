//! Explorer entity possession lifecycle, proposal, actuation, and motion probes.

use holtburger_common::{Guid, Quaternion, RigidTransform, Vector3};
use holtburger_core::client::movement_types::CharacterDrive;
use holtburger_core::{
    AdjustedForwardAxis, CharacterJumpReadiness, CharacterJumpRejection,
    CharacterMotionEventResult, CharacterMotionReadiness, CharacterMotionRejection,
    CharacterMotionSequence, SequencedCharacterMotionEvent, resolve_character_jump,
};
use holtburger_world::motion::{BodyMotionRuntime, CharacterMotionPresentation, MotionOrder};
use holtburger_world::{
    ContactState, GroundedLaunch, PhysicalBodyActuation, PhysicalBodyDefinition, SpatialBody,
    SpatialBodyId, gate_authored_offset, grounded_character_actuation,
};

use super::ExplorerEntityRuntime;
use super::types::{
    ExplorerEntityRuntimeError, ExplorerPossessedBodyEpoch, ExplorerPossession,
    ExplorerPossessionActiveMotionProbe, ExplorerPossessionEventRequest,
    ExplorerPossessionIntentRequest, ExplorerPossessionMotionProbe, ExplorerPossessionRelease,
    PossessionEventOutcome, PossessionEventOutcomeKind, PossessionEventQueueReceipt,
    PossessionEventRejection,
};
use crate::explorer_possession_control::{
    ActivePossession, ExplorerPossessionControlProfile, PossessionEventQueueResult,
    PossessionIntentError, PossessionIntentReplaceResult, PossessionIntentSnapshot,
    PossessionJumpPresentation, PossessionLifetime, PossessionLocomotionSource,
    PossessionRunRateCapability,
};

/// Tentative possession/controller/playback state paired with one proposed body actuation.
pub(super) struct PossessionTickProposal {
    pub(super) active: ActivePossession,
    pub(super) playback: BodyMotionRuntime,
    pre_solve_contact: ContactState,
    pub(super) outcomes: Vec<PossessionEventOutcome>,
}

fn consume_nonphysical_possession_events(
    active: &mut ActivePossession,
) -> Result<Vec<PossessionEventOutcome>, PossessionIntentError> {
    let mut outcomes = Vec::new();
    while let Some(pending) = active.pending_events.remove(&active.next_event_sequence) {
        let sequence = active.next_event_sequence;
        active.next_event_sequence += 1;
        if pending.intent.revision >= active.applied_intent.revision {
            active.applied_intent = pending.intent;
        }
        let result = if matches!(pending.event, holtburger_core::CharacterMotionEvent::Reset) {
            active.controller.clear();
            active.clear_manual_yaw();
            active.applied_intent = active.resolve_effective_intent(CharacterDrive::default())?;
            PossessionEventOutcomeKind::Reset
        } else {
            PossessionEventOutcomeKind::Rejected {
                reason: PossessionEventRejection::NonphysicalResponse,
            }
        };
        outcomes.push(PossessionEventOutcome {
            possession_generation: active.generation,
            sequence,
            result,
        });
    }
    Ok(outcomes)
}

impl PossessionTickProposal {
    pub(super) fn reconcile_playback(
        &mut self,
        table: &holtburger_content::MotionSequenceTable,
        contact: ContactState,
    ) -> anyhow::Result<()> {
        if contact == self.pre_solve_contact {
            return Ok(());
        }
        let order = effective_possession_order(&self.active, contact, false)?;
        self.playback.drive(table, order, 0.0);
        self.pre_solve_contact = contact;
        Ok(())
    }
}

pub(super) fn propose_possession_tick(
    mut active: ActivePossession,
    previous_playback: Option<&BodyMotionRuntime>,
    table: &holtburger_content::MotionSequenceTable,
    body: &SpatialBody,
    object_scale: f32,
    profile: ExplorerPossessionControlProfile,
    delta_seconds: f32,
) -> anyhow::Result<(PossessionTickProposal, PhysicalBodyActuation)> {
    let grounded_response = body.physical.as_ref().is_some_and(|physical| {
        matches!(physical.definition, PhysicalBodyDefinition::Grounded { .. })
    });
    let mut outcomes = Vec::new();
    let mut launch = None;

    while let Some(pending) = active.pending_events.remove(&active.next_event_sequence) {
        let sequence = active.next_event_sequence;
        active.next_event_sequence += 1;
        if pending.intent.revision >= active.applied_intent.revision {
            active.applied_intent = pending.intent;
        }
        let result = if !grounded_response {
            if matches!(pending.event, holtburger_core::CharacterMotionEvent::Reset) {
                active.controller.clear();
                active.clear_manual_yaw();
            }
            PossessionEventOutcomeKind::Rejected {
                reason: PossessionEventRejection::NonphysicalResponse,
            }
        } else {
            let contact = if launch.is_some() {
                CharacterMotionReadiness::Unsupported
            } else if body.contact == ContactState::Grounded {
                CharacterMotionReadiness::Ready
            } else if body.contact == ContactState::Airborne {
                CharacterMotionReadiness::Airborne
            } else {
                CharacterMotionReadiness::Unsupported
            };
            let event_result = active.controller.apply_event(
                SequencedCharacterMotionEvent {
                    sequence: CharacterMotionSequence(sequence),
                    event: pending.event,
                },
                contact,
            );
            let presentation = active
                .capabilities
                .get(pending.intent.stance)
                .expect("queued possession stance lost its capability")
                .jump_presentation;
            possession_event_result(
                event_result,
                body,
                pending.intent.kinematics.jump(),
                presentation,
                &mut launch,
            )?
        };
        if result == PossessionEventOutcomeKind::Reset {
            active.clear_manual_yaw();
            active.applied_intent = active.resolve_effective_intent(CharacterDrive::default())?;
        }
        outcomes.push(PossessionEventOutcome {
            possession_generation: active.generation,
            sequence,
            result,
        });
    }

    if active.latest_intent.revision > active.applied_intent.revision {
        active.applied_intent = active.latest_intent;
    }
    active.controller.replace_drive(active.applied_intent.drive);
    let order = effective_possession_order(&active, body.contact, launch.is_some())?;
    let mut playback = previous_playback
        .cloned()
        .unwrap_or_else(|| BodyMotionRuntime::new(table));
    let offset = playback.drive(table, order, delta_seconds).offset;
    let manual_yaw_radians = active.take_manual_yaw();
    let actuation = if grounded_response {
        possession_grounded_actuation(
            &active,
            PossessionGroundedStep {
                authored_offset: offset,
                body,
                object_scale,
                profile,
                delta_seconds,
                launch,
                manual_yaw_radians,
            },
        )?
    } else if matches!(
        body.physical.as_ref().map(|physical| physical.definition),
        Some(PhysicalBodyDefinition::FixedPosition { .. })
    ) {
        let mut rotation = body.pose.rotation.multiply(&offset.rotation);
        if manual_yaw_radians != 0.0 {
            let yaw = Quaternion::from_axis_angle(Vector3::new(0.0, 0.0, 1.0), -manual_yaw_radians)
                .ok_or_else(|| {
                    anyhow::anyhow!("manual possession yaw must produce a finite rotation")
                })?;
            rotation = rotation.multiply(&yaw);
        }
        PhysicalBodyActuation::FixedPosition {
            translation: body
                .pose
                .rotation
                .rotate_vector(offset.translation * object_scale),
            rotation,
        }
    } else {
        crate::host_simulation_runtime::dynamic_entity_coasting_actuation(body)?
    };
    Ok((
        PossessionTickProposal {
            active,
            playback,
            pre_solve_contact: body.contact,
            outcomes,
        },
        actuation,
    ))
}

fn possession_event_result(
    result: CharacterMotionEventResult,
    body: &SpatialBody,
    jump: holtburger_core::CharacterJumpKinematics,
    presentation: PossessionJumpPresentation,
    launch: &mut Option<GroundedLaunch>,
) -> anyhow::Result<PossessionEventOutcomeKind> {
    Ok(match result {
        CharacterMotionEventResult::ChargeAccepted => {
            PossessionEventOutcomeKind::ChargeAccepted { presentation }
        }
        CharacterMotionEventResult::ChargeContinues => {
            PossessionEventOutcomeKind::ChargeContinues { presentation }
        }
        CharacterMotionEventResult::Reset => PossessionEventOutcomeKind::Reset,
        CharacterMotionEventResult::IgnoredStale { .. } => {
            unreachable!("contiguous possession queue passed a stale edge to a fresh controller")
        }
        CharacterMotionEventResult::Rejected(reason) => PossessionEventOutcomeKind::Rejected {
            reason: match reason {
                CharacterMotionRejection::ChargeNotActive => {
                    PossessionEventRejection::ChargeNotActive
                }
                CharacterMotionRejection::Airborne => PossessionEventRejection::Airborne,
                CharacterMotionRejection::Unsupported => {
                    PossessionEventRejection::UnsupportedContact
                }
                CharacterMotionRejection::Overburdened => PossessionEventRejection::Overburdened,
                CharacterMotionRejection::CapabilityUnavailable => {
                    PossessionEventRejection::CapabilityUnavailable
                }
            },
        },
        CharacterMotionEventResult::JumpReleased(attempt) => {
            let readiness = if launch.is_some() {
                CharacterJumpReadiness::Airborne
            } else {
                match body.contact {
                    ContactState::Grounded => CharacterJumpReadiness::Supported,
                    ContactState::Airborne => CharacterJumpReadiness::Airborne,
                    ContactState::Sliding | ContactState::Unknown => {
                        CharacterJumpReadiness::Unsupported
                    }
                }
            };
            match resolve_character_jump(jump, attempt, body.pose.rotation.to_heading(), readiness)
            {
                Ok(resolved) => {
                    *launch = Some(GroundedLaunch::new(resolved.world_velocity())?);
                    PossessionEventOutcomeKind::JumpReleased { presentation }
                }
                Err(CharacterJumpRejection::Airborne) => PossessionEventOutcomeKind::Rejected {
                    reason: PossessionEventRejection::Airborne,
                },
                Err(CharacterJumpRejection::Unsupported) => PossessionEventOutcomeKind::Rejected {
                    reason: PossessionEventRejection::UnsupportedContact,
                },
                Err(
                    error @ (CharacterJumpRejection::InvalidHeading
                    | CharacterJumpRejection::InvalidTurnRate
                    | CharacterJumpRejection::InvalidRunRate),
                ) => anyhow::bail!("host-owned possession jump invariant failed: {error}"),
            }
        }
    })
}

fn effective_possession_order(
    active: &ActivePossession,
    contact: ContactState,
    launching: bool,
) -> Result<MotionOrder, PossessionIntentError> {
    let effective = active.resolve_effective_intent(active.controller.effective_drive())?;
    let presentation =
        possession_character_presentation(active, effective.stance, contact, launching);
    Ok(effective
        .visible_order
        .with_character_presentation(presentation))
}

/// One possession-owned support/charge policy shared by authored and observed presentation.
pub(super) fn possession_character_presentation(
    active: &ActivePossession,
    stance: u32,
    contact: ContactState,
    launching: bool,
) -> CharacterMotionPresentation {
    let capability = active
        .capabilities
        .get(stance)
        .expect("effective possession stance lost its capability");
    let requested = CharacterMotionPresentation::resolve(
        contact,
        launching,
        active.controller.is_standing_long_jump(),
    );
    // RETAIL DIVERGENCE: retail synchronously selects target `Ready`/`Falling` while charging
    // and crossing support. Possession still performs the physical jump when either target row
    // is absent, retaining only the target stance/default presentation; requiring those clips
    // would disable jump for content that cannot observe a borrowed player animation. Census
    // 2026-08-21: 4,999 of 7,788 projected creature templates lack at least one effective
    // standard non-combat jump-presentation state; the full stance matrix is in the plan.
    match requested {
        CharacterMotionPresentation::Falling if !capability.has_falling_presentation() => {
            CharacterMotionPresentation::StanceDefault
        }
        CharacterMotionPresentation::Ready if !capability.has_ready_presentation() => {
            CharacterMotionPresentation::StanceDefault
        }
        presentation => presentation,
    }
}

/// Inputs for computing one grounded possession actuation step.
pub(super) struct PossessionGroundedStep<'a> {
    pub(super) authored_offset: RigidTransform,
    pub(super) body: &'a SpatialBody,
    pub(super) object_scale: f32,
    pub(super) profile: ExplorerPossessionControlProfile,
    pub(super) delta_seconds: f32,
    pub(super) launch: Option<GroundedLaunch>,
    pub(super) manual_yaw_radians: f32,
}

pub(super) fn possession_grounded_actuation(
    active: &ActivePossession,
    step: PossessionGroundedStep<'_>,
) -> anyhow::Result<PhysicalBodyActuation> {
    let PossessionGroundedStep {
        authored_offset,
        body,
        object_scale,
        profile,
        delta_seconds,
        launch,
        manual_yaw_radians,
    } = step;
    let effective = active.resolve_effective_intent(active.controller.effective_drive())?;
    let capability = active
        .capabilities
        .get(effective.stance)
        .expect("effective possession stance lost its capability");
    let gated = gate_authored_offset(authored_offset, body.contact, object_scale);
    let authored_velocity = if delta_seconds > 0.0 {
        gated.translation / delta_seconds
    } else {
        Vector3::zero()
    };
    let supported = body.contact == ContactState::Grounded;

    let local_forward = if !supported {
        0.0
    } else {
        match effective.axes.forward() {
            Some(axis)
                if capability.source_for_forward(axis)
                    == PossessionLocomotionSource::TargetAuthored =>
            {
                authored_velocity.y
            }
            Some(axis) => fallback_forward_velocity(axis, profile) * object_scale,
            None => 0.0,
        }
    };
    let local_sidestep = if !supported {
        0.0
    } else {
        match effective.axes.sidestep() {
            Some((_, _)) if capability.sidestep == PossessionLocomotionSource::TargetAuthored => {
                authored_velocity.x
            }
            Some((_, rate)) => profile.fallback.sidestep_speed() * rate * object_scale,
            None => 0.0,
        }
    };
    let local_planar = Vector3::new(local_sidestep, local_forward, 0.0);
    // Project local drive through the horizontal heading rather than full 3D pose rotation so
    // pitched or rolled entities (e.g. from gizmo edits) keep horizontal grounded drive.
    // Preserve level yaw quaternions directly to avoid trig round-trip drift against client math.
    let horizontal_rotation = if body.pose.rotation.x == 0.0 && body.pose.rotation.y == 0.0 {
        body.pose.rotation
    } else {
        Quaternion::from_heading(body.pose.rotation.to_heading())
    };
    let horizontal_drive = horizontal_rotation.rotate_vector(local_planar);
    let world_planar = Vector3::new(horizontal_drive.x, horizontal_drive.y, 0.0);
    let base_heading = match effective.axes.turn() {
        Some((_, _)) if capability.turn == PossessionLocomotionSource::TargetAuthored => {
            body.pose.rotation.multiply(&gated.rotation).to_heading()
        }
        Some((_, rate)) => {
            body.pose.rotation.to_heading() + profile.fallback.turn_rate() * rate * delta_seconds
        }
        None => body.pose.rotation.to_heading(),
    };
    let heading = base_heading + manual_yaw_radians;
    Ok(grounded_character_actuation(
        world_planar,
        Some(heading),
        launch,
    )?)
}

fn fallback_forward_velocity(
    axis: AdjustedForwardAxis,
    profile: ExplorerPossessionControlProfile,
) -> f32 {
    match axis {
        AdjustedForwardAxis::Walk { speed_mod } => profile.fallback.walk_speed() * speed_mod,
        AdjustedForwardAxis::Run { speed_mod } => profile.fallback.run_speed() * speed_mod,
    }
}

impl ExplorerEntityRuntime {
    /// Possesses one spawned entity, so commands and the follow camera target it.
    ///
    /// Possession is exclusive: taking a new entity releases the previous one and discards its
    /// playback, because a cursor means nothing once nothing is driving it.
    pub fn possess(&self, guid: Guid) -> Result<ExplorerPossession, ExplorerEntityRuntimeError> {
        let mut registry = self
            .registry
            .lock()
            .expect("Explorer entity registry lock poisoned");
        let instance = registry
            .entities
            .get(&guid)
            .cloned()
            .ok_or(ExplorerEntityRuntimeError::NotRegistered { guid })?;
        let motion_table_id = instance
            .definition
            .content
            .motion_table_did
            .ok_or(ExplorerEntityRuntimeError::MissingPossessionMotionTable { guid })?;
        let table = self.motion_catalog.table(motion_table_id).ok_or(
            ExplorerEntityRuntimeError::UnprojectedMotionTable {
                guid,
                motion_table_id,
            },
        )?;
        // Validate possession controller setup and reserve generation before touching physics or
        // selection suspension so invalid capabilities never disturb stashed physics or launches.
        let possession_generation = registry.reserve_generation()?;
        let active = ActivePossession::new(
            guid,
            instance.generation,
            possession_generation,
            motion_table_id,
            table,
            self.possession_profile,
        )?;
        // Possessed entities are exempt from selection suspension. Restore the physical body
        // before residency checks, retaining the prior queued launch so a residency rejection
        // rolls back cleanly without discarding it.
        let was_selection_suspended = registry.is_selection_suspended(guid, instance.generation);
        let saved_pending_launch = if was_selection_suspended {
            registry
                .selection
                .as_ref()
                .and_then(|s| s.suspended_physics.as_ref())
                .and_then(|p| p.pending_launch)
        } else {
            None
        };
        if was_selection_suspended {
            self.resume_selection_suspension(&mut registry, false, std::time::Instant::now())?;
        }
        let residency_error = self
            .simulation
            .physical_body_scene_snapshot(SpatialBodyId::Entity(guid))
            .and_then(|target| match target.scene_residency {
                holtburger_world::PhysicalBodySceneResidency::Resident => None,
                holtburger_world::PhysicalBodySceneResidency::MissingOwner { owner } => Some(
                    ExplorerEntityRuntimeError::PossessionTargetMissingCollisionOwner {
                        guid,
                        owner,
                    },
                ),
                holtburger_world::PhysicalBodySceneResidency::OutsideLandscape => {
                    Some(ExplorerEntityRuntimeError::PossessionTargetOutsideLandscape { guid })
                }
            });
        if let Some(error) = residency_error {
            if was_selection_suspended {
                self.suspend_selected_if_eligible(&mut registry)?;
                if let Some(suspended) = registry
                    .selection
                    .as_mut()
                    .and_then(|s| s.suspended_physics.as_mut())
                {
                    suspended.pending_launch = saved_pending_launch;
                }
            }
            return Err(error);
        }
        let accepted_stance = active.latest_intent.stance;
        let stances = active.capabilities.values().collect();

        registry.motion.release();
        registry.motion.active = Some(active);
        // Reconcile suspension in case a previously possessed entity is still selected.
        self.suspend_selected_if_eligible(&mut registry)?;
        self.simulation
            .wake_dynamic_body(SpatialBodyId::Entity(guid));

        Ok(ExplorerPossession {
            guid,
            entity_generation: instance.generation,
            possession_generation,
            motion_table_id,
            accepted_stance,
            run_rate_capability: PossessionRunRateCapability::STANDARD,
            stances,
        })
    }

    /// Releases whatever is possessed, leaving the entity in the world under its own physics.
    ///
    /// The released entity's planar velocity is cleared. Authored drive is per-tick and is not
    /// momentum, so once authorship ends there is nothing for the horizontal motion to have come
    /// from; leaving it would let a walk cycle coast on after the command that produced it. Vertical
    /// velocity survives, because falling is real physical momentum the authored path never wrote.
    pub fn release_possession(
        &self,
        now: std::time::Instant,
    ) -> Result<ExplorerPossessionRelease, ExplorerEntityRuntimeError> {
        let mut registry = self
            .registry
            .lock()
            .expect("Explorer entity registry lock poisoned");
        let possession_generation = registry.reserve_generation()?;
        let released_guid = registry.motion.release();

        if let Some(guid) = released_guid {
            self.clear_authored_momentum(SpatialBodyId::Entity(guid), now);
        }
        // Strict `selected && !possessed` invariant: if the released entity remains selected,
        // re-suspend its physical body at its release pose so the gizmo can reposition it.
        self.suspend_selected_if_eligible(&mut registry)?;
        Ok(ExplorerPossessionRelease {
            released_guid,
            possession_generation,
        })
    }

    fn clear_authored_momentum(&self, body_id: SpatialBodyId, now: std::time::Instant) {
        let Some(body) = self.simulation.physical_body_view(body_id) else {
            return;
        };
        // Align-path facing is a response policy, not a kinematic fact; the entity keeps whatever it
        // had, so this replacement carries the same answer the body already holds.
        let align_path = self
            .simulation
            .physical_body_align_path(body_id)
            .unwrap_or(false);
        let Some(kinematics) = holtburger_world::DynamicBodyKinematics::new(
            holtburger_common::Vector3::new(0.0, 0.0, body.velocity.z),
            body.acceleration,
            body.omega,
            align_path,
        ) else {
            return;
        };
        let _ = self
            .simulation
            .apply_dynamic_entity_kinematics(body_id, kinematics, now);
    }

    /// Replaces coalescible semantic intent after validating the exact possession generation.
    pub fn replace_possession_intent(
        &self,
        request: ExplorerPossessionIntentRequest,
    ) -> Result<PossessionIntentReplaceResult, ExplorerEntityRuntimeError> {
        let mut registry = self
            .registry
            .lock()
            .expect("Explorer entity registry lock poisoned");
        let Some(active) = registry.motion.active.as_mut() else {
            return Ok(PossessionIntentReplaceResult::IgnoredStalePossession);
        };
        if active.generation != request.possession_generation {
            return Ok(PossessionIntentReplaceResult::IgnoredStalePossession);
        }
        let result = active.replace_intent(
            PossessionIntentSnapshot {
                revision: request.revision,
                stance: request.stance,
                drive: request.drive,
                run_rate_scalar: request.run_rate_scalar,
            },
            self.possession_profile,
        )?;
        if result == PossessionIntentReplaceResult::Accepted {
            self.simulation
                .wake_dynamic_body(SpatialBodyId::Entity(active.guid));
        }
        Ok(result)
    }

    /// Accumulates one finite manual yaw displacement for the exact active possession epoch.
    pub fn apply_possession_yaw(
        &self,
        possession_generation: u64,
        delta_radians: f32,
    ) -> Result<PossessionIntentReplaceResult, ExplorerEntityRuntimeError> {
        if !delta_radians.is_finite() {
            return Err(ExplorerEntityRuntimeError::PossessionIntent(
                PossessionIntentError::InvalidManualYaw,
            ));
        }
        let mut registry = self
            .registry
            .lock()
            .expect("Explorer entity registry lock poisoned");
        let Some(active) = registry.motion.active.as_mut() else {
            return Ok(PossessionIntentReplaceResult::IgnoredStalePossession);
        };
        if active.generation != possession_generation {
            return Ok(PossessionIntentReplaceResult::IgnoredStalePossession);
        }
        active.queue_manual_yaw(delta_radians)?;
        if delta_radians != 0.0 {
            self.simulation
                .wake_dynamic_body(SpatialBodyId::Entity(active.guid));
        }
        Ok(PossessionIntentReplaceResult::Accepted)
    }

    /// Queues one non-coalescible lifecycle edge without allowing async reordering.
    pub fn queue_possession_event(
        &self,
        request: ExplorerPossessionEventRequest,
    ) -> Result<PossessionEventQueueReceipt, ExplorerEntityRuntimeError> {
        let mut registry = self
            .registry
            .lock()
            .expect("Explorer entity registry lock poisoned");
        let Some(active) = registry.motion.active.as_mut() else {
            return Ok(PossessionEventQueueReceipt {
                result: PossessionEventQueueResult::IgnoredStalePossession,
                outcomes: Vec::new(),
            });
        };
        if active.generation != request.possession_generation {
            return Ok(PossessionEventQueueReceipt {
                result: PossessionEventQueueResult::IgnoredStalePossession,
                outcomes: Vec::new(),
            });
        }
        let result = active.queue_event(
            request.sequence,
            PossessionIntentSnapshot {
                revision: request.revision,
                stance: request.stance,
                drive: request.drive,
                run_rate_scalar: request.run_rate_scalar,
            },
            request.event,
            self.possession_profile,
        )?;
        let grounded_response = self
            .simulation
            .physical_body_definition(SpatialBodyId::Entity(active.guid))
            .is_some_and(|definition| {
                matches!(definition, PhysicalBodyDefinition::Grounded { .. })
            });
        let outcomes = if result == PossessionEventQueueResult::Queued && !grounded_response {
            consume_nonphysical_possession_events(active)?
        } else {
            Vec::new()
        };
        if result == PossessionEventQueueResult::Queued && grounded_response {
            self.simulation
                .wake_dynamic_body(SpatialBodyId::Entity(active.guid));
        }
        Ok(PossessionEventQueueReceipt { result, outcomes })
    }

    /// Snapshots the exact active possession playback without exposing mutable registry ownership.
    pub fn possession_motion_probe(&self) -> Option<ExplorerPossessionMotionProbe> {
        let registry = self
            .registry
            .lock()
            .expect("Explorer entity registry lock poisoned");
        let active = registry.motion.active.as_ref()?;
        let state = registry.motion.playback.state(active.guid)?;
        let motion = registry
            .motion
            .playback
            .motion_playback(active.guid)
            .map(holtburger_core::DynamicEntityMotion::from);
        Some(ExplorerPossessionMotionProbe {
            guid: active.guid,
            entity_generation: active.entity_generation,
            possession_generation: active.generation,
            requested_run_rate: active.applied_intent.kinematics.run_rate().value(),
            physical_status: registry.motion.last_physical_status,
            effective_planar_speed: registry.motion.last_effective_planar_speed,
            style: state.style.0,
            substate: ExplorerPossessionActiveMotionProbe {
                command: state.substate.0,
                speed: state.substate_mod,
            },
            modifiers: state
                .modifiers()
                .iter()
                .map(|motion| ExplorerPossessionActiveMotionProbe {
                    command: motion.command.0,
                    speed: motion.speed_mod,
                })
                .collect(),
            motion,
        })
    }

    /// Captures revocable camera permission while all identity dimensions name the active possession.
    pub(crate) fn possession_lifetime(
        &self,
        expected: ExplorerPossessedBodyEpoch,
    ) -> Option<PossessionLifetime> {
        let registry = self
            .registry
            .lock()
            .expect("Explorer entity registry lock poisoned");
        let active = registry.motion.active.as_ref()?;
        (active.guid == expected.guid
            && active.entity_generation == expected.entity_generation
            && active.generation == expected.possession_generation
            && registry
                .entities
                .get(&active.guid)
                .is_some_and(|entity| entity.generation == active.entity_generation))
        .then(|| active.lifetime.clone())
    }

    /// Authored body height of one live entity, at its own scale.
    ///
    /// Read by the possession camera when it seeds a boom generation: the pivot needs a statement of
    /// the body's size, and this is the only one that survives content resolution.
    pub fn body_height(&self, guid: Guid) -> Option<f32> {
        self.registry
            .lock()
            .expect("Explorer entity registry lock poisoned")
            .entities
            .get(&guid)
            .map(|entity| entity.definition.body_height)
    }
}
