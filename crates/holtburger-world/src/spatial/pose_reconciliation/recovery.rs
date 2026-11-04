//! Simulation-time progress observation for collision-blocked remote correction.

use super::*;

/// Time allowed between meaningful improvements, also bounding failed placement retries. RETAIL
/// DIVERGENCE: Retail behavior is to evaluate interpolation progress during physical contact,
/// check five frames against 30% expected speed, and then fall back to placement. We retain
/// the contact requirement but use simulation time and minimum net distance, suspending for
/// direct player contact. Sticky pursuit can recover only when its moving reference still
/// agrees with authority; retail instead renews its watchdog while sticky. Copying retail's
/// timing would make patience frame-rate dependent and prevent this blocked return. The wall,
/// wrong-floor, nominal-flight, moving ledge jump with a prearmed timer, unavailable-cell,
/// stale-anchor sticky, player-contact and progress fixtures size the tested surface. A live
/// moving ledge jump corroborates the unsupported-travel exclusion; no census establishes
/// equivalent timing for all actors.
pub(crate) const RECOVERY_WINDOW_SECONDS: f32 = 2.0;

/// One observation, distinct from both latest authority and the predicted moving reference.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) struct RecoveryObservation {
    /// Destination at the window's start, so accumulated packet jitter eventually restarts it.
    destination: WorldPosition,
    /// Smallest error at the last meaningful improvement; lateral bouncing cannot renew time.
    distance: f32,
    /// Admitted simulation time since the observation began.
    elapsed: f32,
}

impl PoseReconciliationState {
    /// A newer observation cannot carry a watchdog armed by an obsolete correction sample.
    pub(crate) fn invalidate_recovery(&mut self) {
        if let ReconciliationMode::Physical(correction) = &mut self.mode {
            correction.recovery = None;
        }
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
        // Agreement after travel cannot corroborate height: a short stair step can fit inside
        // the XY band, or a longer journey can loop back to the anchor on another floor.
        // Horizontal return keeps its existing policy; a fresh pose restores height evidence.
        let height_stall = matches!(self.mode, ReconciliationMode::Physical(correction)
            if !correction.reference_has_traveled)
            && self.reference_matches_authority(destination)
            && (current.coords.z - destination.coords.z).abs() > PHYSICAL_RETURN_START_THRESHOLD_M;
        if !height_stall {
            self.finish_physical_tick(current, relative_velocity, motor_domain);
        }
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

    /// Returns a placement request only after accepted motion fails to approach a stable authority.
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
        let ReconciliationMode::Physical(correction) = &mut self.mode else {
            return false;
        };
        let distance = domain.distance(current, destination);
        if !permitted
            || (correction.activity == PhysicalReturnActivity::Watching
                && domain == PhysicalReferenceDomain::Horizontal)
            || distance <= PHYSICAL_RETURN_START_THRESHOLD_M
        {
            correction.recovery = None;
            return false;
        }
        let observation = correction.recovery.get_or_insert(RecoveryObservation {
            destination,
            distance,
            elapsed: 0.0,
        });
        if observation.destination.distance_to(&destination) > PHYSICAL_RETURN_START_THRESHOLD_M
            || observation.distance - distance >= RETAIL_INTERPOLATION_TARGET_THRESHOLD_M
        {
            *observation = RecoveryObservation {
                destination,
                distance,
                elapsed: 0.0,
            };
        }
        observation.elapsed += seconds;
        if observation.elapsed < RECOVERY_WINDOW_SECONDS {
            return false;
        }
        *observation = RecoveryObservation {
            destination,
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
    fn sticky_recovery_anchor_must_agree_with_nominal_travel_in_all_axes() {
        let anchor = pose(10.0, 0.0);
        let departure = PHYSICAL_RETURN_START_THRESHOLD_M * 2.0;
        for travel in [
            Vector3::new(departure, 0.0, 0.0),
            Vector3::new(0.0, departure, 0.0),
            Vector3::new(0.0, 0.0, departure),
        ] {
            let mut state = PoseReconciliationState::default();
            state.correct(anchor, false);
            assert!(state.reference_matches_authority(anchor));
            state.advance_return_reference(anchor, travel).unwrap();
            assert!(!state.reference_matches_authority(anchor));

            // A later admitted position can corroborate the new nominal destination.
            let mut updated = anchor;
            updated.coords = updated.coords + travel;
            state.correct(updated, false);
            assert!(state.reference_matches_authority(updated));
        }
    }

    #[test]
    fn height_recovery_needs_a_new_anchor_after_nominal_travel_returns_to_origin() {
        let anchor = pose(10.0, 0.0);
        let mut lower = anchor;
        lower.coords.z -= PHYSICAL_RETURN_START_THRESHOLD_M * 2.0;
        let travel = Vector3::new(PHYSICAL_RETURN_START_THRESHOLD_M * 2.0, 0.0, 0.0);
        let mut state = PoseReconciliationState::default();
        state.correct(anchor, false);
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
        state.correct(anchor, false);
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
    fn repeated_authority_and_lateral_bouncing_do_not_hide_stall() {
        let mut state = PoseReconciliationState::default();
        let target = pose(10.0, 0.0);
        let quantum = RECOVERY_WINDOW_SECONDS / 4.0;
        for index in 0..4 {
            state.correct(target, false);
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
    fn progress_destination_changes_and_suspension_restart_observation() {
        let target = pose(10.0, 0.0);
        for (current, destination, permitted) in [
            (
                pose(RETAIL_INTERPOLATION_TARGET_THRESHOLD_M * 2.0, 0.0),
                target,
                true,
            ),
            (pose(0.0, 0.0), pose(11.0, 0.0), true),
            (pose(0.0, 0.0), target, false),
        ] {
            let mut state = PoseReconciliationState::default();
            state.correct(target, false);
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
