//! Bounded playback of accepted parent travel at the independent camera cadence.

use std::collections::VecDeque;
use std::sync::Arc;

use anyhow::{Result, ensure};
use holtburger_common::position::WorldPosition;
use holtburger_world::ChildSpatialBodyWaypoint;

use crate::kinematic_boom::interpolate_pose;
use crate::{DynamicEntityHostTime, DynamicEntityPlacedPath};

/// One source interval, retained without retaining a collision scene publication.
#[derive(Clone)]
pub(super) struct TargetTravel {
    /// Identifies a publication; this is not used as a simulation clock.
    pub instant: DynamicEntityHostTime,
    /// Actual simulation time represented by the complete path.
    pub seconds: f64,
    /// Immutable accepted geometry shared by publication and playback.
    pub path: Arc<DynamicEntityPlacedPath>,
}

/// A publication either extends accepted travel or explicitly retires it.
#[derive(Clone)]
pub(super) enum TargetUpdate {
    /// Integrated motion whose geometry and duration can be consumed incrementally.
    Travel(TargetTravel),
    /// Teleport, correction or reset, including corrections to an unchanged endpoint.
    Reset(DynamicEntityHostTime),
}

impl TargetUpdate {
    pub fn instant(&self) -> DynamicEntityHostTime {
        match self {
            Self::Travel(travel) => travel.instant,
            Self::Reset(instant) => *instant,
        }
    }
}

/// Bound unconsumed travel time, rather than record count: a partially consumed head and
/// short publication intervals can span several records without excessive follow latency.
const MAX_SECONDS: f64 = super::super::PHYSICS_TICK_MS as f64 * 4.0 / 1_000.0;

/// A single cursor owns both partial consumption and the remaining accepted intervals.
pub(super) struct TargetPlayback {
    /// Current source interval followed by any accepted successor.
    pending: VecDeque<TargetTravel>,
    /// Seconds already consumed from the first pending interval.
    elapsed: f64,
    /// Last published interval, including an interval retired by recovery.
    observed: Option<DynamicEntityHostTime>,
    /// Last accepted publication endpoint; detects missing paths and non-travel corrections.
    endpoint: WorldPosition,
    /// Parent point reached by the playback cursor, not necessarily the latest endpoint.
    pose: WorldPosition,
    /// Requests discontinuous target placement instead of traversing missing history.
    reseed: bool,
}

impl TargetPlayback {
    pub fn new(pose: WorldPosition, observed: Option<DynamicEntityHostTime>) -> Self {
        Self {
            pending: VecDeque::new(),
            elapsed: 0.0,
            observed,
            endpoint: pose,
            pose,
            reseed: false,
        }
    }

    /// Called at publication, so an idle worker cannot silently lose intermediate intervals.
    pub fn observe(&mut self, pose: WorldPosition, update: Option<&TargetUpdate>) {
        let Some(update) = update else {
            if pose != self.endpoint {
                self.recover(pose);
            }
            return;
        };
        if self.observed == Some(update.instant()) {
            return;
        }
        self.observed = Some(update.instant());
        let TargetUpdate::Travel(travel) = update else {
            self.recover(pose);
            return;
        };
        let remaining = self.pending.iter().map(|item| item.seconds).sum::<f64>() - self.elapsed;
        if travel.path.initial.pose != self.endpoint || remaining + travel.seconds > MAX_SECONDS {
            self.recover(pose);
            return;
        }
        self.endpoint = pose;
        self.pending.push_back(travel.clone());
    }

    /// Retires uncertain history and seeds the next solve at the current authority endpoint.
    pub fn recover(&mut self, pose: WorldPosition) {
        self.pending.clear();
        self.elapsed = 0.0;
        self.endpoint = pose;
        self.pose = pose;
        self.reseed = true;
    }

    pub fn take_reseed(&mut self) -> Option<WorldPosition> {
        std::mem::take(&mut self.reseed).then_some(self.pose)
    }

    /// Emits all crossed authored boundaries, plus the exact partial endpoint or final hold.
    pub fn advance(
        &mut self,
        seconds: f64,
    ) -> Result<(WorldPosition, Vec<ChildSpatialBodyWaypoint>)> {
        ensure!(
            seconds.is_finite() && seconds > 0.0,
            "camera playback duration must be positive and finite"
        );
        let initial = self.pose;
        let mut used = 0.0;
        let mut waypoints: Vec<ChildSpatialBodyWaypoint> = Vec::new();
        while used < seconds {
            let Some(travel) = self.pending.front() else {
                break;
            };
            ensure!(
                travel.seconds.is_finite() && travel.seconds > 0.0,
                "camera source travel duration must be positive and finite"
            );
            let available = travel.seconds - self.elapsed;
            let consumed = available.min(seconds - used);
            let end = self.elapsed + consumed;
            for leg in &travel.path.legs {
                let boundary = f64::from(leg.end_fraction) * travel.seconds;
                // A fraction-zero correction belongs to the start of this interval.
                if (boundary > self.elapsed || (boundary == 0.0 && self.elapsed == 0.0))
                    && boundary <= end
                {
                    let waypoint = ChildSpatialBodyWaypoint {
                        parent_pose: leg.end.pose,
                        end_fraction: ((used + boundary - self.elapsed) / seconds) as f32,
                    };
                    if let Some(last) = waypoints
                        .last_mut()
                        .filter(|last| last.end_fraction == waypoint.end_fraction)
                    {
                        *last = waypoint;
                    } else {
                        waypoints.push(waypoint);
                    }
                }
            }
            self.pose = pose_at(&travel.path, (end / travel.seconds) as f32)?;
            used += consumed;
            self.elapsed = end;
            if consumed == available {
                self.pending.pop_front();
                self.elapsed = 0.0;
            } else {
                break;
            }
        }
        if let Some(last) = waypoints.last_mut().filter(|last| last.end_fraction == 1.0) {
            last.parent_pose = self.pose;
        } else {
            waypoints.push(ChildSpatialBodyWaypoint {
                parent_pose: self.pose,
                end_fraction: 1.0,
            });
        }
        Ok((initial, waypoints))
    }
}

/// Coordinate-only partial parent point; topology is reconciled by the child-body solver.
fn pose_at(path: &DynamicEntityPlacedPath, fraction: f32) -> Result<WorldPosition> {
    let mut start = path.initial.pose;
    let mut start_fraction = 0.0;
    for leg in &path.legs {
        if fraction == leg.end_fraction {
            return Ok(leg.end.pose);
        }
        if fraction < leg.end_fraction {
            return Ok(interpolate_pose(
                start,
                leg.end.pose,
                (fraction - start_fraction) / (leg.end_fraction - start_fraction),
            )?);
        }
        start = leg.end.pose;
        start_fraction = leg.end_fraction;
    }
    anyhow::bail!("camera playback fraction exceeds accepted travel")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{DynamicEntityPathLeg, DynamicEntityPathPoint, DynamicEntitySpatialMembership};
    use holtburger_common::{Guid, Quaternion, Vector3};

    fn pose(z: f32) -> WorldPosition {
        WorldPosition {
            landblock_id: Guid(0x01020001),
            coords: Vector3::new(0.0, 0.0, z),
            rotation: Quaternion::identity(),
        }
    }

    fn point(z: f32) -> DynamicEntityPathPoint {
        DynamicEntityPathPoint {
            pose: pose(z),
            spatial_membership: DynamicEntitySpatialMembership {
                reaches_outdoors: true,
                reached_env_cell_ids: vec![],
            },
        }
    }

    fn travel(id: u32, start: f32, end: f32) -> TargetUpdate {
        TargetUpdate::Travel(TargetTravel {
            instant: DynamicEntityHostTime::new(f64::from(id)).unwrap(),
            seconds: MAX_SECONDS / 4.0,
            path: Arc::new(DynamicEntityPlacedPath {
                initial: point(start),
                legs: vec![DynamicEntityPathLeg {
                    end_fraction: 1.0,
                    end: point(end),
                }],
            }),
        })
    }

    #[test]
    fn partial_intervals_cross_publications_then_hold_without_replaying() {
        let mut playback = TargetPlayback::new(pose(0.0), None);
        let source = MAX_SECONDS / 4.0;
        let first = travel(1, 0.0, 1.0);
        playback.observe(pose(1.0), Some(&first));
        assert!(
            (playback
                .advance(source * 0.75)
                .unwrap()
                .1
                .last()
                .unwrap()
                .parent_pose
                .coords
                .z
                - 0.75)
                .abs()
                < 1e-6
        );
        playback.observe(pose(2.0), Some(&travel(2, 1.0, 2.0)));
        let (start, slice) = playback.advance(source * 0.5).unwrap();
        assert!((start.coords.z - 0.75).abs() < 1e-6);
        assert_eq!(slice.len(), 2);
        assert!((slice[0].end_fraction - 0.5).abs() < 1e-6);
        assert!((slice[1].parent_pose.coords.z - 1.25).abs() < 1e-6);
        playback.advance(source).unwrap();
        playback.observe(pose(2.0), Some(&travel(2, 1.0, 2.0)));
        assert_eq!(
            playback
                .advance(source)
                .unwrap()
                .1
                .last()
                .unwrap()
                .parent_pose,
            pose(2.0)
        );
        assert!(playback.take_reseed().is_none());
    }

    #[test]
    fn authored_corners_and_zero_time_corrections_survive_slicing() {
        let mut update = travel(1, 0.0, 1.0);
        let TargetUpdate::Travel(travel) = &mut update else {
            unreachable!()
        };
        Arc::make_mut(&mut travel.path).legs.insert(
            0,
            DynamicEntityPathLeg {
                end_fraction: 0.0,
                end: point(0.1),
            },
        );
        let mut corner = point(0.5);
        corner.pose.coords.x = 1.0;
        Arc::make_mut(&mut travel.path).legs.insert(
            1,
            DynamicEntityPathLeg {
                end_fraction: 0.5,
                end: corner.clone(),
            },
        );
        let mut playback = TargetPlayback::new(pose(0.0), None);
        playback.observe(pose(1.0), Some(&update));
        let (_, slice) = playback.advance(MAX_SECONDS / 4.0).unwrap();
        assert_eq!(slice.len(), 3);
        assert_eq!(slice[0].end_fraction, 0.0);
        assert_eq!(slice[1].parent_pose, corner.pose);
        assert_eq!(slice[2].parent_pose, pose(1.0));
    }

    #[test]
    fn continuous_publications_with_a_partial_head_do_not_reset_the_camera() {
        let mut playback = TargetPlayback::new(pose(0.0), None);
        let source = MAX_SECONDS / 4.0;
        playback.observe(pose(1.0), Some(&travel(1, 0.0, 1.0)));
        playback.advance(source * 0.9).unwrap();
        playback.observe(pose(2.0), Some(&travel(2, 1.0, 2.0)));
        playback.observe(pose(3.0), Some(&travel(3, 2.0, 3.0)));

        // Three records represent only 2.1 source intervals of unconsumed travel. The
        // partially consumed head must not turn ordinary publication jitter into a reset.
        assert!(playback.take_reseed().is_none());
        let (start, waypoints) = playback.advance(source * 3.0).unwrap();
        assert!((start.coords.z - 0.9).abs() < 1e-6);
        let crossed: Vec<_> = waypoints
            .iter()
            .map(|point| point.parent_pose.coords.z)
            .collect();
        assert_eq!(crossed, vec![1.0, 2.0, 3.0, 3.0]);
        assert!(playback.pending.is_empty());
    }

    #[test]
    fn gaps_and_explicit_corrections_retire_history() {
        let mut playback = TargetPlayback::new(pose(0.0), None);
        playback.observe(pose(1.0), Some(&travel(1, 0.0, 1.0)));
        playback.observe(pose(3.0), Some(&travel(3, 2.0, 3.0)));
        assert_eq!(playback.take_reseed(), Some(pose(3.0)));
        assert_eq!(
            playback.advance(MAX_SECONDS).unwrap().1[0].parent_pose,
            pose(3.0)
        );
        playback.observe(pose(7.0), Some(&travel(7, 3.0, 7.0)));
        let reset = TargetUpdate::Reset(DynamicEntityHostTime::new(8.0).unwrap());
        playback.observe(pose(7.0), Some(&reset));
        assert_eq!(playback.take_reseed(), Some(pose(7.0)));
        assert!(playback.pending.is_empty());
        playback.observe(pose(7.0), Some(&reset));
        assert!(playback.take_reseed().is_none());
    }

    #[test]
    fn accumulated_travel_over_the_time_limit_still_retires_history() {
        let mut playback = TargetPlayback::new(pose(0.0), None);
        // Five nominal intervals exceed the four-interval time budget even when every
        // individual publication is short and the geometric path remains continuous.
        for id in 1..=5 {
            playback.observe(
                pose(id as f32),
                Some(&travel(id, (id - 1) as f32, id as f32)),
            );
            if id < 5 {
                assert!(playback.take_reseed().is_none());
            }
        }
        assert_eq!(playback.take_reseed(), Some(pose(5.0)));
        assert!(playback.pending.is_empty());
    }

    #[test]
    fn long_source_interval_recovers_without_follow_backlog() {
        let mut update = travel(1, 0.0, 1.0);
        let TargetUpdate::Travel(travel) = &mut update else {
            unreachable!()
        };
        travel.seconds = MAX_SECONDS * 2.0;
        let mut playback = TargetPlayback::new(pose(0.0), None);
        playback.observe(pose(1.0), Some(&update));
        assert_eq!(playback.take_reseed(), Some(pose(1.0)));
        assert!(playback.pending.is_empty());
    }
}
