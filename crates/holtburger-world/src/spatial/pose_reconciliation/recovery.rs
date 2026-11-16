//! Shared simulation-time progress observation for remote correction.

use super::*;

/// Time allowed between meaningful improvements, also bounding failed placement retries. RETAIL
/// DIVERGENCE: Retail behavior is to evaluate interpolation progress during physical contact,
/// check five frames against 30% expected speed, and then fall back to placement. We retain
/// the contact requirement but use one simulation-time/minimum-progress policy for physical and
/// pose-only correction. Pose-only placement happens in the expiring tick, preventing a later
/// packet from cancelling it. Physical recovery endpoints must clear blocking static and mobile
/// geometry. Sticky pursuit can recover only when its moving reference still agrees with authority;
/// retail instead renews its watchdog while sticky. Copying retail's timing would make patience
/// frame-rate dependent and prevent this blocked return. The wall,
/// wrong-floor, nominal-flight, moving ledge jump with a prearmed timer, unavailable-cell,
/// stale-anchor sticky, player-contact, moving ranged return, parallel-floor walking and frequent
/// pose-only retargeting fixtures size the tested surface. A live moving ledge jump corroborates
/// the unsupported-travel exclusion; no census establishes
/// equivalent timing for all actors.
pub(crate) const RECOVERY_WINDOW_SECONDS: f32 = 2.0;

/// One observation, distinct from both latest authority and the predicted moving reference.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) struct RecoveryObservation {
    /// Coordinates measured by this observation; switching metrics begins a new window.
    domain: PhysicalReferenceDomain,
    /// Smallest error at the last meaningful improvement; lateral bouncing cannot renew time.
    distance: f32,
    /// Admitted simulation time since the observation began.
    elapsed: f32,
}

impl PoseReconciliationState {
    /// Observation-only authority revokes recovery evidence until a new eligible sample arrives.
    pub(crate) fn invalidate_recovery(&mut self) {
        self.recovery = None;
        match &mut self.mode {
            ReconciliationMode::Physical(correction) => {
                correction.height_disagreement_origin = None
            }
            ReconciliationMode::RemotePose(state) => state.received_contact = false,
            ReconciliationMode::Empty | ReconciliationMode::LocalConfirmation(_) => {}
        }
    }

    /// Observe the fully composed pose, including damping and retained physical travel. Recovery
    /// is returned to the scene for placement in this transaction, never queued behind a packet.
    pub(crate) fn finish_pose_only_tick(
        &mut self,
        accepted: WorldPosition,
        seconds: f32,
    ) -> Option<WorldPosition> {
        let target = match self.mode {
            ReconciliationMode::RemotePose(state) if state.received_contact => state.interpolation,
            _ => None,
        };
        let Some(target) = target else {
            self.recovery = None;
            return None;
        };
        if !self.observe_recovery(
            accepted,
            target.pose,
            seconds,
            true,
            PhysicalReferenceDomain::Spatial,
        ) {
            return None;
        }
        self.reset();
        Some(target.pose)
    }

    /// A clear historical anchor cannot authorize a sticky snap after nominal intent leaves it.
    /// Compare XYZ here: horizontal return steering does not establish vertical agreement.
    pub(crate) fn reference_matches_authority(&self, authority: WorldPosition) -> bool {
        matches!(self.mode, ReconciliationMode::Physical(correction)
            if correction.reference.distance_to(&authority) <= PHYSICAL_RETURN_START_THRESHOLD_M)
    }

    /// Completes the motor and watchdog without allowing XY settlement to discard a height stall.
    /// Ordinary horizontal ticks retain their existing completion-before-observation ordering.
    pub(crate) fn finish_recovery_tick(
        &mut self,
        current: WorldPosition,
        relative_velocity: Vector3,
        motor_domain: PhysicalReferenceDomain,
        destination: WorldPosition,
        seconds: f32,
        permitted: bool,
    ) -> bool {
        // Fresh authority corroborates a height discrepancy at the local elevation sampled on
        // admission. Walking along that elevation preserves evidence; stairs, flight and support
        // loss retire it, even if the actor later returns to the same XY or height.
        if let ReconciliationMode::Physical(correction) = &mut self.mode
            && (!permitted
                || correction.height_disagreement_origin.is_some_and(|origin| {
                    (current.coords.z - origin).abs() > PHYSICAL_RETURN_START_THRESHOLD_M
                }))
        {
            correction.height_disagreement_origin = None;
        }
        let height_stall = matches!(self.mode, ReconciliationMode::Physical(correction)
            if correction.height_disagreement_origin.is_some())
            && (current.coords.z - destination.coords.z).abs() > PHYSICAL_RETURN_START_THRESHOLD_M;
        if !height_stall {
            self.finish_physical_tick(current, relative_velocity, motor_domain);
        }
        let permitted = permitted
            && matches!(self.mode, ReconciliationMode::Physical(correction)
            if height_stall || correction.activity != PhysicalReturnActivity::Watching);
        let requested = self.observe_recovery(
            current,
            destination,
            seconds,
            permitted,
            if height_stall {
                PhysicalReferenceDomain::Spatial
            } else {
                PhysicalReferenceDomain::Horizontal
            },
        );
        if height_stall {
            self.finish_return_motor(current, relative_velocity, motor_domain, true);
        }
        requested
    }

    /// Returns a placement request only after accepted motion fails to approach the latest authority.
    /// Callers own actor eligibility, contact and destination restrictions. Ineligibility clears
    /// elapsed time rather than preserving an expired timer through an intentional displacement.
    pub(crate) fn observe_recovery(
        &mut self,
        current: WorldPosition,
        destination: WorldPosition,
        seconds: f32,
        permitted: bool,
        domain: PhysicalReferenceDomain,
    ) -> bool {
        let distance = domain.distance(current, destination);
        if !permitted || distance <= PHYSICAL_RETURN_START_THRESHOLD_M {
            self.recovery = None;
            return false;
        }
        let observation = self.recovery.get_or_insert(RecoveryObservation {
            domain,
            distance,
            elapsed: 0.0,
        });
        if observation.domain != domain
            || observation.distance - distance >= RETAIL_INTERPOLATION_TARGET_THRESHOLD_M
        {
            *observation = RecoveryObservation {
                domain,
                distance,
                elapsed: 0.0,
            };
        }
        observation.elapsed += seconds;
        if observation.elapsed < RECOVERY_WINDOW_SECONDS {
            return false;
        }
        *observation = RecoveryObservation {
            domain,
            distance,
            elapsed: 0.0,
        };
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::Quaternion;

    fn pose(x: f32, y: f32) -> WorldPosition {
        WorldPosition {
            landblock_id: Guid(0x1234_ffff),
            coords: Vector3::new(x, y, 0.0),
            rotation: Quaternion::identity(),
        }
    }

    #[test]
    fn changing_movement_modes_starts_a_new_recovery_window() {
        let current = pose(0.0, 0.0);
        let target = pose(10.0, 0.0);
        let partial = RECOVERY_WINDOW_SECONDS * 0.75;
        let remaining = RECOVERY_WINDOW_SECONDS * 0.25;
        let mut state = PoseReconciliationState::default();
        state.correct(target, current, false);
        assert!(!state.observe_recovery(
            current,
            target,
            partial,
            true,
            PhysicalReferenceDomain::Spatial
        ));
        state.set_mobile_physical(false, current);
        assert_eq!(state.finish_pose_only_tick(current, remaining), None);
        assert_eq!(state.finish_pose_only_tick(current, partial), Some(target));

        state.interpolate(target, current, false, None);
        assert_eq!(state.finish_pose_only_tick(current, partial), None);
        state.set_mobile_physical(true, current);
        assert!(!state.observe_recovery(
            current,
            target,
            remaining,
            true,
            PhysicalReferenceDomain::Spatial
        ));
        assert!(state.observe_recovery(
            current,
            target,
            partial,
            true,
            PhysicalReferenceDomain::Spatial
        ));
    }

    #[test]
    fn confirmation_and_epoch_reset_discard_remote_stall_history() {
        let current = pose(0.0, 0.0);
        let target = pose(10.0, 0.0);
        for confirmation in [false, true] {
            let mut state = PoseReconciliationState::default();
            state.interpolate(target, current, false, None);
            assert_eq!(
                state.finish_pose_only_tick(current, RECOVERY_WINDOW_SECONDS * 0.75),
                None
            );
            if confirmation {
                state.confirm(current, current);
            } else {
                state.reset();
            }
            state.interpolate(target, current, false, None);
            assert_eq!(
                state.finish_pose_only_tick(current, RECOVERY_WINDOW_SECONDS * 0.25),
                None
            );
            assert_eq!(
                state.finish_pose_only_tick(current, RECOVERY_WINDOW_SECONDS * 0.75),
                Some(target)
            );
        }
    }

    #[test]
    fn changing_distance_domain_requires_a_full_new_window() {
        let current = pose(0.0, 0.0);
        let mut target = pose(PHYSICAL_RETURN_START_THRESHOLD_M * 2.0, 0.0);
        target.coords.z = PHYSICAL_RETURN_START_THRESHOLD_M * 4.0;
        for (before, after) in [
            (
                PhysicalReferenceDomain::Horizontal,
                PhysicalReferenceDomain::Spatial,
            ),
            (
                PhysicalReferenceDomain::Spatial,
                PhysicalReferenceDomain::Horizontal,
            ),
        ] {
            let mut state = PoseReconciliationState::default();
            state.correct(target, current, false);
            let partial = RECOVERY_WINDOW_SECONDS * 0.75;
            let remaining = RECOVERY_WINDOW_SECONDS * 0.25;
            assert!(!state.observe_recovery(current, target, partial, true, before));
            assert!(!state.observe_recovery(current, target, remaining, true, after));
            assert!(state.observe_recovery(current, target, partial, true, after));
        }
    }

    #[test]
    fn sticky_recovery_anchor_must_agree_with_nominal_travel_in_all_axes() {
        let anchor = pose(10.0, 0.0);
        let departure = PHYSICAL_RETURN_START_THRESHOLD_M * 2.0;
        for travel in [
            Vector3::new(departure, 0.0, 0.0),
            Vector3::new(0.0, departure, 0.0),
            Vector3::new(0.0, 0.0, departure),
        ] {
            let mut state = PoseReconciliationState::default();
            state.correct(anchor, anchor, false);
            assert!(state.reference_matches_authority(anchor));
            state.advance_return_reference(anchor, travel).unwrap();
            assert!(!state.reference_matches_authority(anchor));

            // A later admitted position can corroborate the new nominal destination.
            let mut updated = anchor;
            updated.coords = updated.coords + travel;
            state.correct(updated, updated, false);
            assert!(state.reference_matches_authority(updated));
        }
    }

    #[test]
    fn height_recovery_needs_new_authority_after_leaving_the_sampled_elevation() {
        let anchor = pose(10.0, 0.0);
        let mut lower = anchor;
        lower.coords.z -= PHYSICAL_RETURN_START_THRESHOLD_M * 2.0;
        let travel = Vector3::new(0.0, 0.0, PHYSICAL_RETURN_START_THRESHOLD_M * 2.0);
        let mut state = PoseReconciliationState::default();
        state.correct(anchor, lower, false);
        state.advance_return_reference(lower, travel).unwrap();
        state
            .advance_return_reference(lower, travel * -1.0)
            .unwrap();
        assert!(state.reference_matches_authority(anchor));
        assert!(!state.finish_recovery_tick(
            lower,
            Vector3::zero(),
            PhysicalReferenceDomain::Horizontal,
            anchor,
            RECOVERY_WINDOW_SECONDS,
            true,
        ));

        // A newly admitted pose can confirm that the server is still on the upper floor.
        state.correct(anchor, lower, false);
        assert!(state.finish_recovery_tick(
            lower,
            Vector3::zero(),
            PhysicalReferenceDomain::Horizontal,
            anchor,
            RECOVERY_WINDOW_SECONDS,
            true,
        ));
    }

    #[test]
    fn changed_local_elevation_or_support_retires_height_evidence_until_new_authority() {
        let lower = pose(0.0, 0.0);
        let mut upper = lower;
        upper.coords.z += PHYSICAL_RETURN_START_THRESHOLD_M * 20.0;
        for lost_support in [false, true] {
            let mut state = PoseReconciliationState::default();
            state.correct(upper, lower, false);
            let mut departed = lower;
            if !lost_support {
                departed.coords.z += PHYSICAL_RETURN_START_THRESHOLD_M * 2.0;
            }
            assert!(!state.finish_recovery_tick(
                departed,
                Vector3::zero(),
                PhysicalReferenceDomain::Horizontal,
                upper,
                RECOVERY_WINDOW_SECONDS,
                !lost_support,
            ));
            // Returning to the same supported height must not resurrect the old observation.
            assert!(!state.finish_recovery_tick(
                lower,
                Vector3::zero(),
                PhysicalReferenceDomain::Horizontal,
                upper,
                RECOVERY_WINDOW_SECONDS,
                true,
            ));
            state.correct(upper, lower, false);
            assert!(state.finish_recovery_tick(
                lower,
                Vector3::zero(),
                PhysicalReferenceDomain::Horizontal,
                upper,
                RECOVERY_WINDOW_SECONDS,
                true,
            ));
        }
    }

    #[test]
    fn repeated_authority_and_lateral_bouncing_do_not_hide_stall() {
        let mut state = PoseReconciliationState::default();
        let target = pose(10.0, 0.0);
        let quantum = RECOVERY_WINDOW_SECONDS / 4.0;
        for index in 0..4 {
            state.correct(target, target, false);
            assert_eq!(
                state.observe_recovery(
                    pose(0.0, if index % 2 == 0 { 0.1 } else { -0.1 }),
                    target,
                    quantum,
                    true,
                    PhysicalReferenceDomain::Horizontal
                ),
                index == 3
            );
        }
        // A rejected placement gets a full new observation window, not a per-tick retry.
        assert!(!state.observe_recovery(
            pose(0.0, 0.0),
            target,
            quantum,
            true,
            PhysicalReferenceDomain::Horizontal
        ));
    }

    #[test]
    fn progress_and_suspension_restart_observation() {
        let target = pose(10.0, 0.0);
        for (current, destination, permitted) in [
            (
                pose(RETAIL_INTERPOLATION_TARGET_THRESHOLD_M * 2.0, 0.0),
                target,
                true,
            ),
            (pose(0.0, 0.0), target, false),
        ] {
            let mut state = PoseReconciliationState::default();
            state.correct(target, target, false);
            assert!(!state.observe_recovery(
                pose(0.0, 0.0),
                target,
                RECOVERY_WINDOW_SECONDS * 0.75,
                true,
                PhysicalReferenceDomain::Horizontal
            ));
            assert!(!state.observe_recovery(
                current,
                destination,
                RECOVERY_WINDOW_SECONDS * 0.25,
                permitted,
                PhysicalReferenceDomain::Horizontal
            ));
            assert!(!state.observe_recovery(
                current,
                destination,
                RECOVERY_WINDOW_SECONDS * 0.25,
                true,
                PhysicalReferenceDomain::Horizontal
            ));
        }
    }
}
