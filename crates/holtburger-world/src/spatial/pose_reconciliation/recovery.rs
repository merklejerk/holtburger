//! Simulation-time progress observation for collision-blocked remote correction.

use super::*;

/// Time allowed between meaningful improvements, also bounding failed placement retries.
/// RETAIL DIVERGENCE: retail checks five frames against 30% expected speed and then falls back
/// to placement (`acclient.c:372019-372201`). We use simulation time and minimum net distance,
/// suspending for direct player contact as well as sticky pursuit. Copying retail would make
/// patience frame-rate dependent and could undo intentional pushing. The self-contained wall,
/// unavailable-cell, sticky, player-contact and progress fixtures size the tested surface;
/// no live-content census establishes equivalent timing for all actors.
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
    /// Returns a placement request only after accepted motion fails to approach a stable authority.
    /// Callers own actor eligibility and contact/sticky suspension. Ineligibility clears elapsed
    /// time rather than preserving an expired timer through an intentional displacement.
    pub(crate) fn observe_recovery(
        &mut self,
        current: WorldPosition,
        destination: WorldPosition,
        seconds: f32,
        permitted: bool,
    ) -> bool {
        let ReconciliationMode::Physical(correction) = &mut self.mode else {
            return false;
        };
        let distance = PhysicalReferenceDomain::Horizontal.distance(current, destination);
        if !permitted
            || correction.activity == PhysicalReturnActivity::Watching
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
                    true
                ),
                index == 3
            );
        }
        // A rejected placement gets a full new observation window, not a per-tick retry.
        assert!(!state.observe_recovery(pose(0.0, 0.0), target, quantum, true));
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
                true
            ));
            assert!(!state.observe_recovery(
                current,
                destination,
                RECOVERY_WINDOW_SECONDS * 0.25,
                permitted
            ));
            assert!(!state.observe_recovery(
                current,
                destination,
                RECOVERY_WINDOW_SECONDS * 0.25,
                true
            ));
        }
    }
}
