//! Stateful host-side third-person boom behavior over world-owned static collision.

use holtburger_common::position::WorldPosition;
use holtburger_common::{Guid, Quaternion, Vector3};
use holtburger_world::{
    CollisionScene, FreeSphereConfig, FreeSphereOutcome, FreeSphereRequest, FreeSphereState,
    MotionWaypoint, MotionWaypointPlacement, PhysicalCollisionFilter, PlacedMotionPath,
    PlacedMotionPathRequest, StaticSphereSweepRequest, solve_free_sphere,
};
use thiserror::Error;

const DIRECTION_EPSILON: f32 = 1.0e-6;

/// Validated comfort and finite-work policy for one kinematic boom session.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct KinematicBoomProfile {
    minimum_reach: f32,
    maximum_reach: f32,
    vertical_pivot_half_life: f32,
    maximum_vertical_pivot_lag: f32,
    clearance_recovery_half_life: f32,
    clearance_hysteresis: f32,
    maximum_control_leg_displacement: f32,
    maximum_control_legs: usize,
    surface_clearance: f32,
    transit: FreeSphereConfig,
}

/// Unvalidated values used to construct one [`KinematicBoomProfile`].
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct KinematicBoomProfileDefinition {
    /// Closest operator-requested reach in meters.
    pub minimum_reach: f32,
    /// Farthest camera reach in meters.
    pub maximum_reach: f32,
    /// Exponential half-life for target-induced vertical pivot motion.
    pub vertical_pivot_half_life: f32,
    /// Maximum vertical distance the filtered pivot may trail its target.
    pub maximum_vertical_pivot_lag: f32,
    /// Exponential half-life used only while collision clearance grows.
    pub clearance_recovery_half_life: f32,
    /// Clearance growth required before outward recovery resumes.
    pub clearance_hysteresis: f32,
    /// Maximum target/orbit travel represented by one internal control leg.
    pub maximum_control_leg_displacement: f32,
    /// Maximum internal control legs admitted for one solve transaction.
    pub maximum_control_legs: usize,
    /// Distance retained before the first obstructing surface.
    pub surface_clearance: f32,
    /// Sliding camera-transit work and separation policy.
    pub transit: FreeSphereConfig,
}

impl KinematicBoomProfile {
    /// Validates all comfort and finite-work fields before a session can retain them.
    pub fn new(
        definition: KinematicBoomProfileDefinition,
    ) -> Result<Self, KinematicBoomProfileError> {
        let KinematicBoomProfileDefinition {
            minimum_reach,
            maximum_reach,
            vertical_pivot_half_life,
            maximum_vertical_pivot_lag,
            clearance_recovery_half_life,
            clearance_hysteresis,
            maximum_control_leg_displacement,
            maximum_control_legs,
            surface_clearance,
            transit,
        } = definition;
        if !minimum_reach.is_finite() || minimum_reach < 0.0 {
            return Err(KinematicBoomProfileError::InvalidMinimumReach);
        }
        if !maximum_reach.is_finite() || maximum_reach < minimum_reach {
            return Err(KinematicBoomProfileError::InvalidMaximumReach);
        }
        if !vertical_pivot_half_life.is_finite() || vertical_pivot_half_life <= 0.0 {
            return Err(KinematicBoomProfileError::InvalidVerticalPivotHalfLife);
        }
        if !maximum_vertical_pivot_lag.is_finite() || maximum_vertical_pivot_lag < 0.0 {
            return Err(KinematicBoomProfileError::InvalidMaximumVerticalPivotLag);
        }
        if !clearance_recovery_half_life.is_finite() || clearance_recovery_half_life <= 0.0 {
            return Err(KinematicBoomProfileError::InvalidClearanceRecoveryHalfLife);
        }
        if !clearance_hysteresis.is_finite() || clearance_hysteresis < 0.0 {
            return Err(KinematicBoomProfileError::InvalidClearanceHysteresis);
        }
        if !maximum_control_leg_displacement.is_finite() || maximum_control_leg_displacement <= 0.0
        {
            return Err(KinematicBoomProfileError::InvalidControlLegDisplacement);
        }
        if maximum_control_legs == 0 {
            return Err(KinematicBoomProfileError::EmptyControlLegBudget);
        }
        if !surface_clearance.is_finite() || surface_clearance <= 0.0 {
            return Err(KinematicBoomProfileError::InvalidSurfaceClearance);
        }
        validate_transit_config(transit)?;
        Ok(Self {
            minimum_reach,
            maximum_reach,
            vertical_pivot_half_life,
            maximum_vertical_pivot_lag,
            clearance_recovery_half_life,
            clearance_hysteresis,
            maximum_control_leg_displacement,
            maximum_control_legs,
            surface_clearance,
            transit,
        })
    }

    /// Revalidates operator reach bounds while preserving the profile's collision and work policy.
    pub fn with_reach_limits(
        self,
        minimum_reach: f32,
        maximum_reach: f32,
    ) -> Result<Self, KinematicBoomProfileError> {
        Self::new(KinematicBoomProfileDefinition {
            minimum_reach,
            maximum_reach,
            vertical_pivot_half_life: self.vertical_pivot_half_life,
            maximum_vertical_pivot_lag: self.maximum_vertical_pivot_lag,
            clearance_recovery_half_life: self.clearance_recovery_half_life,
            clearance_hysteresis: self.clearance_hysteresis,
            maximum_control_leg_displacement: self.maximum_control_leg_displacement,
            maximum_control_legs: self.maximum_control_legs,
            surface_clearance: self.surface_clearance,
            transit: self.transit,
        })
    }
}

/// Invalid controller tuning rejected before it can affect retained state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum KinematicBoomProfileError {
    #[error("kinematic boom minimum reach must be finite and non-negative")]
    InvalidMinimumReach,
    #[error("kinematic boom maximum reach must be finite and at least the minimum")]
    InvalidMaximumReach,
    #[error("kinematic boom vertical pivot half-life must be finite and positive")]
    InvalidVerticalPivotHalfLife,
    #[error("kinematic boom maximum vertical pivot lag must be finite and non-negative")]
    InvalidMaximumVerticalPivotLag,
    #[error("kinematic boom clearance recovery half-life must be finite and positive")]
    InvalidClearanceRecoveryHalfLife,
    #[error("kinematic boom clearance hysteresis must be finite and non-negative")]
    InvalidClearanceHysteresis,
    #[error("kinematic boom control-leg displacement must be finite and positive")]
    InvalidControlLegDisplacement,
    #[error("kinematic boom requires at least one control leg")]
    EmptyControlLegBudget,
    #[error("kinematic boom surface clearance must be finite and positive")]
    InvalidSurfaceClearance,
    #[error("kinematic boom free-sphere transit configuration is invalid")]
    InvalidTransitConfig,
}

/// One position paired with host-authoritative interior residency.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct KinematicBoomPlacement {
    /// Camera or seed position in an AC landblock frame.
    pub pose: WorldPosition,
    /// Host-authoritative EnvCell, or `None` outdoors.
    pub cell: Option<Guid>,
}

/// Collision-safe target sphere center and the effective camera radius it proves safe.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct KinematicBoomCollisionSeed {
    /// Accepted target-sphere center and residency.
    pub placement: KinematicBoomPlacement,
    /// Effective camera radius proven safe at the seed.
    pub camera_radius: f32,
}

/// One exact target boundary sampled from the accepted possessed-body path.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct KinematicBoomTargetSample {
    /// Strictly increasing normalized tick fraction in `(0, 1]`.
    pub end_fraction: f32,
    /// Presentation pivot before controller-owned vertical damping.
    pub visual_pivot: WorldPosition,
    /// Accepted target sphere center, distinct from the visual pivot.
    pub collision_seed: KinematicBoomCollisionSeed,
}

/// Latest semantic boom input; zoom is the session's signed cumulative displacement in meters.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct KinematicBoomIntent {
    /// Monotonic session-local latest-wins sequence.
    pub sequence: u64,
    /// Finite AC-world direction from the visual pivot toward the desired camera.
    pub view_direction: Vector3,
    /// Session-total signed zoom displacement, consumed by sequence delta.
    pub cumulative_zoom_displacement: f32,
}

/// Whether a semantic command changed the retained latest-wins intent.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KinematicBoomIntentAcceptance {
    Accepted,
    Stale,
}

/// Invalid session or tick input; these are caller contract failures, not collision outcomes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum KinematicBoomInputError {
    #[error("kinematic boom view direction must be non-zero and finite")]
    InvalidViewDirection,
    #[error("kinematic boom cumulative zoom displacement must be finite")]
    InvalidCumulativeZoom,
    #[error("kinematic boom initial reach must be finite")]
    InvalidInitialReach,
    #[error("kinematic boom target pose must be finite and non-null")]
    InvalidTargetPose,
    #[error("kinematic boom collision seed radius must be finite and positive")]
    InvalidCollisionSeedRadius,
    #[error("kinematic boom collision seed radius may only shrink within a session")]
    EnlargedCollisionSeedRadius,
    #[error("kinematic boom tick duration must be finite and positive")]
    InvalidTickDuration,
    #[error("kinematic boom tick requires a non-empty target path ending at one")]
    InvalidTargetPath,
}

/// Machine-readable reason a staged tick retained its prior collision-safe placement.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KinematicBoomFailureKind {
    ClearanceSweep,
    FreeSphereQuery,
    MaximumReach,
}

/// Topology failure that caused a successful discontinuous reset to the target seed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KinematicBoomReseedReason {
    PlacedPath,
    PlacementRecovery,
}

/// Camera motion committed by one successful controller tick.
#[derive(Debug, Clone, PartialEq)]
pub enum KinematicBoomAdvance {
    /// Collision-safe motion connected continuously from the prior camera placement.
    Continuous { path: PlacedMotionPath },
    /// Explicit discontinuity to the latest accepted collision-safe target seed.
    Reseeded {
        placement: KinematicBoomPlacement,
        reason: KinematicBoomReseedReason,
    },
}

/// Finite work consumed by a successfully staged tick.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct KinematicBoomDiagnostics {
    /// Internal target/orbit control legs evaluated.
    pub control_legs: usize,
    /// Continuous clearance sweeps evaluated; successful control legs currently use two.
    pub clearance_sweeps: usize,
    /// Free-sphere anti-tunneling substeps evaluated.
    pub transit_substeps: usize,
    /// Free-sphere contact-separation passes evaluated.
    pub contact_passes: usize,
}

/// Atomic result of one controller tick.
#[derive(Debug, Clone, PartialEq)]
pub enum KinematicBoomOutcome {
    Advanced {
        advance: KinematicBoomAdvance,
        diagnostics: KinematicBoomDiagnostics,
    },
    Failed {
        kind: KinematicBoomFailureKind,
        held: KinematicBoomPlacement,
        diagnostics: KinematicBoomDiagnostics,
    },
}

/// Stateful comfort policy; collision and placement remain delegated to the injected scene.
#[derive(Debug, Clone)]
pub struct KinematicBoomController {
    profile: KinematicBoomProfile,
    raw_visual_pivot: WorldPosition,
    filtered_visual_pivot: WorldPosition,
    collision_seed: KinematicBoomCollisionSeed,
    desired_reach: f32,
    rendered_reach: f32,
    sampled_view_direction: Vector3,
    intent: KinematicBoomIntent,
    camera: KinematicBoomPlacement,
}

impl KinematicBoomController {
    /// Starts at the proven-safe target seed; the first tick authors all camera travel away from it.
    pub fn new(
        profile: KinematicBoomProfile,
        visual_pivot: WorldPosition,
        collision_seed: KinematicBoomCollisionSeed,
        initial_reach: f32,
        intent: KinematicBoomIntent,
    ) -> Result<Self, KinematicBoomInputError> {
        validate_pose(visual_pivot)?;
        validate_seed(collision_seed)?;
        let view_direction = validate_direction(intent.view_direction)?;
        if !initial_reach.is_finite() {
            return Err(KinematicBoomInputError::InvalidInitialReach);
        }
        if !intent.cumulative_zoom_displacement.is_finite() {
            return Err(KinematicBoomInputError::InvalidCumulativeZoom);
        }
        let desired_reach = initial_reach.clamp(profile.minimum_reach, profile.maximum_reach);
        Ok(Self {
            profile,
            raw_visual_pivot: visual_pivot,
            filtered_visual_pivot: visual_pivot,
            collision_seed,
            desired_reach,
            rendered_reach: 0.0,
            sampled_view_direction: view_direction,
            intent: KinematicBoomIntent {
                view_direction,
                ..intent
            },
            camera: collision_seed.placement,
        })
    }

    /// Accepts only a newer sequence and consumes its cumulative zoom delta exactly once.
    pub fn accept_intent(
        &mut self,
        intent: KinematicBoomIntent,
    ) -> Result<KinematicBoomIntentAcceptance, KinematicBoomInputError> {
        if intent.sequence <= self.intent.sequence {
            return Ok(KinematicBoomIntentAcceptance::Stale);
        }
        let view_direction = validate_direction(intent.view_direction)?;
        if !intent.cumulative_zoom_displacement.is_finite() {
            return Err(KinematicBoomInputError::InvalidCumulativeZoom);
        }
        let zoom_delta =
            intent.cumulative_zoom_displacement - self.intent.cumulative_zoom_displacement;
        if !zoom_delta.is_finite() {
            return Err(KinematicBoomInputError::InvalidCumulativeZoom);
        }
        self.desired_reach = (self.desired_reach + zoom_delta)
            .clamp(self.profile.minimum_reach, self.profile.maximum_reach);
        self.intent = KinematicBoomIntent {
            view_direction,
            ..intent
        };
        Ok(KinematicBoomIntentAcceptance::Accepted)
    }

    /// Last collision-safe camera placement committed by the controller.
    pub fn camera(&self) -> KinematicBoomPlacement {
        self.camera
    }

    /// Filtered presentation pivot paired with the committed camera state.
    pub fn visual_pivot(&self) -> WorldPosition {
        self.filtered_visual_pivot
    }

    /// Latest operator-requested reach after cumulative zoom and profile clamping.
    pub fn desired_reach(&self) -> f32 {
        self.desired_reach
    }

    /// Collision-constrained reach committed with the current camera placement.
    pub fn rendered_reach(&self) -> f32 {
        self.rendered_reach
    }

    /// Advances a complete fixed tick transaction over exact target path boundaries.
    pub fn advance(
        &mut self,
        scene: &CollisionScene,
        duration_seconds: f32,
        target_samples: &[KinematicBoomTargetSample],
    ) -> Result<KinematicBoomOutcome, KinematicBoomInputError> {
        validate_tick(
            duration_seconds,
            target_samples,
            self.collision_seed.camera_radius,
        )?;
        let mut staged = self.clone();
        let tick_anchor = owner(self.camera.pose.landblock_id);
        let tick_start = reanchor(self.camera.pose, tick_anchor)?;
        let start_direction = self.sampled_view_direction;
        let mut waypoints = Vec::new();
        let mut diagnostics = KinematicBoomDiagnostics::default();
        let mut segment_start_fraction = 0.0;

        'samples: for sample in target_samples {
            let raw_start = staged.raw_visual_pivot;
            let seed_start = staged.collision_seed;
            let segment_fraction = sample.end_fraction - segment_start_fraction;
            let segment_seconds = duration_seconds * segment_fraction;
            let legs = required_control_legs(ControlLegSpan {
                maximum_displacement: staged.profile.maximum_control_leg_displacement,
                desired_reach: staged.desired_reach,
                pivot_start: raw_start,
                pivot_end: sample.visual_pivot,
                seed_start: seed_start.placement.pose,
                seed_end: sample.collision_seed.placement.pose,
                direction_start: start_direction,
                direction_end: self.intent.view_direction,
                tick_fraction: segment_fraction,
            })?;
            let remaining_legs = self.profile.maximum_control_legs - diagnostics.control_legs;
            let evaluated_legs = legs.min(remaining_legs);

            for leg in 1..=evaluated_legs {
                let local_fraction = leg as f32 / legs as f32;
                let end_fraction = segment_start_fraction + segment_fraction * local_fraction;
                let step_seconds = segment_seconds / legs as f32;
                let raw_pivot = interpolate_pose(raw_start, sample.visual_pivot, local_fraction)?;
                let seed_pose = interpolate_pose(
                    seed_start.placement.pose,
                    sample.collision_seed.placement.pose,
                    local_fraction,
                )?;
                let seed = KinematicBoomCollisionSeed {
                    placement: KinematicBoomPlacement {
                        pose: seed_pose,
                        cell: if leg == legs {
                            sample.collision_seed.placement.cell
                        } else {
                            seed_start.placement.cell
                        },
                    },
                    camera_radius: sample.collision_seed.camera_radius,
                };
                let direction = spherical_interpolate(
                    start_direction,
                    self.intent.view_direction,
                    end_fraction,
                );
                staged.filter_pivot(raw_pivot, step_seconds);
                staged.raw_visual_pivot = raw_pivot;
                staged.collision_seed = seed;
                staged.sampled_view_direction = direction;
                diagnostics.control_legs += 1;

                let result = staged.advance_control_leg(scene, direction, step_seconds);
                let motion = match result {
                    Ok(motion) => {
                        let leg_diagnostics = motion.diagnostics;
                        diagnostics.clearance_sweeps += leg_diagnostics.clearance_sweeps;
                        diagnostics.transit_substeps += leg_diagnostics.transit_substeps;
                        diagnostics.contact_passes += leg_diagnostics.contact_passes;
                        motion
                    }
                    Err(kind) => return Ok(failed(self.camera, kind, diagnostics)),
                };
                append_reanchored_motion(
                    &mut waypoints,
                    motion.waypoints,
                    motion.anchor,
                    tick_anchor,
                    segment_start_fraction + segment_fraction * (leg - 1) as f32 / legs as f32,
                    end_fraction,
                )?;
            }
            if evaluated_legs < legs {
                let held = reanchor(staged.camera.pose, tick_anchor)?;
                waypoints.push(MotionWaypoint {
                    center: held.coords,
                    end_fraction: 1.0,
                    placement: MotionWaypointPlacement::Committed(staged.camera.cell),
                });
                break 'samples;
            }
            segment_start_fraction = sample.end_fraction;
        }

        self.commit_staged_motion(
            scene,
            staged,
            tick_anchor,
            tick_start,
            waypoints,
            diagnostics,
        )
    }

    /// Authors placement for one staged camera transaction and commits it atomically.
    fn commit_staged_motion(
        &mut self,
        scene: &CollisionScene,
        staged: Self,
        anchor: Guid,
        start: WorldPosition,
        waypoints: Vec<MotionWaypoint>,
        diagnostics: KinematicBoomDiagnostics,
    ) -> Result<KinematicBoomOutcome, KinematicBoomInputError> {
        let advance = match scene.transit_motion_path(PlacedMotionPathRequest {
            previous_cell: self.camera.cell,
            anchor,
            start: start.coords,
            radius: self.collision_seed.camera_radius,
            waypoints: &waypoints,
        }) {
            Ok(path) if !path.has_recovery() => KinematicBoomAdvance::Continuous { path },
            Ok(_) => {
                return Ok(self.commit_reseed(
                    staged,
                    KinematicBoomReseedReason::PlacementRecovery,
                    diagnostics,
                ));
            }
            Err(_) => {
                return Ok(self.commit_reseed(
                    staged,
                    KinematicBoomReseedReason::PlacedPath,
                    diagnostics,
                ));
            }
        };
        *self = staged;
        Ok(KinematicBoomOutcome::Advanced {
            advance,
            diagnostics,
        })
    }

    /// Commit the current target seed as a zero-reach discontinuity after topology authoring fails.
    fn commit_reseed(
        &mut self,
        mut staged: Self,
        reason: KinematicBoomReseedReason,
        diagnostics: KinematicBoomDiagnostics,
    ) -> KinematicBoomOutcome {
        staged.camera = staged.collision_seed.placement;
        staged.rendered_reach = 0.0;
        let placement = staged.camera;
        *self = staged;
        KinematicBoomOutcome::Advanced {
            advance: KinematicBoomAdvance::Reseeded { placement, reason },
            diagnostics,
        }
    }

    fn filter_pivot(&mut self, raw: WorldPosition, delta_seconds: f32) {
        let alpha = decay_fraction(delta_seconds, self.profile.vertical_pivot_half_life);
        let mut filtered_z = self.filtered_visual_pivot.coords.z
            + (raw.coords.z - self.filtered_visual_pivot.coords.z) * alpha;
        filtered_z = filtered_z.clamp(
            raw.coords.z - self.profile.maximum_vertical_pivot_lag,
            raw.coords.z + self.profile.maximum_vertical_pivot_lag,
        );
        self.filtered_visual_pivot = raw;
        self.filtered_visual_pivot.coords.z = filtered_z;
    }

    fn advance_control_leg(
        &mut self,
        scene: &CollisionScene,
        direction: Vector3,
        delta_seconds: f32,
    ) -> Result<ControlLegMotion, KinematicBoomFailureKind> {
        let clearance = self.cast_to_reach(scene, direction, self.desired_reach)?;
        let clearance_reach = placement_distance(clearance.pose, self.filtered_visual_pivot)
            .map_err(|_| KinematicBoomFailureKind::ClearanceSweep)?;
        if clearance_reach < self.rendered_reach {
            self.rendered_reach = clearance_reach;
        } else if self.desired_reach - clearance_reach <= self.profile.surface_clearance
            || clearance_reach >= self.rendered_reach + self.profile.clearance_hysteresis
        {
            let target = self.desired_reach.min(clearance_reach);
            self.rendered_reach += (target - self.rendered_reach)
                * decay_fraction(delta_seconds, self.profile.clearance_recovery_half_life);
        }
        self.rendered_reach = self.rendered_reach.min(self.profile.maximum_reach);

        let radial = self.cast_to_reach(scene, direction, self.rendered_reach)?;
        self.rendered_reach = placement_distance(radial.pose, self.filtered_visual_pivot)
            .map_err(|_| KinematicBoomFailureKind::ClearanceSweep)?
            .min(self.profile.maximum_reach);
        let camera_start = self.camera;
        let displacement = placement_displacement(camera_start.pose, radial.pose)
            .map_err(|_| KinematicBoomFailureKind::FreeSphereQuery)?;
        let outcome = solve_free_sphere(
            scene,
            self.profile.transit,
            FreeSphereRequest {
                body: FreeSphereState {
                    pose: camera_start.pose,
                    cell: camera_start.cell,
                    radius: self.collision_seed.camera_radius,
                },
                displacement,
                filter: PhysicalCollisionFilter::ALL,
            },
        )
        .map_err(|_| KinematicBoomFailureKind::FreeSphereQuery)?;
        let (body, motion, substeps, contact_passes) = match outcome {
            FreeSphereOutcome::Solved {
                body,
                motion,
                substeps,
                contact_passes,
                ..
            }
            | FreeSphereOutcome::BudgetExceeded {
                body,
                motion,
                substeps,
                contact_passes,
                ..
            } => (body, motion, substeps, contact_passes),
        };
        {
            let solve_anchor = owner(camera_start.pose.landblock_id);
            if motion.iter().any(|waypoint| {
                let waypoint_pose = WorldPosition {
                    landblock_id: solve_anchor,
                    coords: waypoint.center,
                    rotation: Quaternion::identity(),
                };
                placement_distance(waypoint_pose, self.filtered_visual_pivot).map_or(
                    true,
                    |reach| {
                        reach > self.profile.maximum_reach + self.profile.transit.separation_epsilon
                    },
                )
            }) {
                return Err(KinematicBoomFailureKind::MaximumReach);
            }
            self.camera = KinematicBoomPlacement {
                pose: body.pose,
                cell: body.cell,
            };
            self.rendered_reach = placement_distance(body.pose, self.filtered_visual_pivot)
                .map_err(|_| KinematicBoomFailureKind::FreeSphereQuery)?
                .min(self.profile.maximum_reach);
            Ok(ControlLegMotion {
                anchor: solve_anchor,
                waypoints: motion,
                diagnostics: KinematicBoomDiagnostics {
                    control_legs: 0,
                    clearance_sweeps: 2,
                    transit_substeps: substeps,
                    contact_passes,
                },
            })
        }
    }

    fn cast_to_reach(
        &self,
        scene: &CollisionScene,
        direction: Vector3,
        reach: f32,
    ) -> Result<KinematicBoomPlacement, KinematicBoomFailureKind> {
        let seed = self.collision_seed.placement;
        let anchor = owner(seed.pose.landblock_id);
        let seed_pose =
            reanchor(seed.pose, anchor).map_err(|_| KinematicBoomFailureKind::ClearanceSweep)?;
        let pivot = reanchor(self.filtered_visual_pivot, anchor)
            .map_err(|_| KinematicBoomFailureKind::ClearanceSweep)?;
        let ray = pivot.coords + direction * reach - seed_pose.coords;
        let ray_length = ray.length();
        if ray_length <= DIRECTION_EPSILON {
            return Ok(seed);
        }
        let requested_end = seed_pose.coords + ray;
        let hit = scene
            .sweep_static_sphere(StaticSphereSweepRequest {
                anchor,
                start: seed_pose.coords,
                end: requested_end,
                previous_cell: seed.cell,
                radius: self.collision_seed.camera_radius,
                filter: PhysicalCollisionFilter::ALL,
            })
            .map_err(|_| KinematicBoomFailureKind::ClearanceSweep)?;
        let safe_distance = hit.map_or(ray_length, |hit| {
            (ray_length * hit.time_of_impact - self.profile.surface_clearance).max(0.0)
        });
        let safe = seed_pose.coords + ray * (safe_distance / ray_length);
        let path = scene
            .transit_motion_path(PlacedMotionPathRequest {
                previous_cell: seed.cell,
                anchor,
                start: seed_pose.coords,
                radius: self.collision_seed.camera_radius,
                waypoints: &[MotionWaypoint {
                    center: safe,
                    end_fraction: 1.0,
                    placement: holtburger_world::MotionWaypointPlacement::Traverse,
                }],
            })
            .map_err(|_| KinematicBoomFailureKind::ClearanceSweep)?;
        let final_point = path.final_point();
        let mut pose = seed_pose;
        pose.coords = final_point.center();
        pose = pose
            .normalize_outdoor_landblock_frame()
            .map_err(|_| KinematicBoomFailureKind::ClearanceSweep)?;
        Ok(KinematicBoomPlacement {
            pose,
            cell: final_point.placement().committed_cell(),
        })
    }
}

struct ControlLegMotion {
    anchor: Guid,
    waypoints: Vec<MotionWaypoint>,
    diagnostics: KinematicBoomDiagnostics,
}

struct ControlLegSpan {
    maximum_displacement: f32,
    desired_reach: f32,
    pivot_start: WorldPosition,
    pivot_end: WorldPosition,
    seed_start: WorldPosition,
    seed_end: WorldPosition,
    direction_start: Vector3,
    direction_end: Vector3,
    tick_fraction: f32,
}

fn required_control_legs(span: ControlLegSpan) -> Result<usize, KinematicBoomInputError> {
    let target_travel = placement_distance(span.pivot_start, span.pivot_end)?
        .max(placement_distance(span.seed_start, span.seed_end)?);
    let angle = span
        .direction_start
        .dot(&span.direction_end)
        .clamp(-1.0, 1.0)
        .acos()
        * span.tick_fraction;
    let orbit_travel = angle * span.desired_reach;
    Ok(
        (target_travel.max(orbit_travel) / span.maximum_displacement)
            .ceil()
            .max(1.0) as usize,
    )
}

fn append_reanchored_motion(
    output: &mut Vec<MotionWaypoint>,
    motion: Vec<MotionWaypoint>,
    solve_anchor: Guid,
    tick_anchor: Guid,
    start_fraction: f32,
    end_fraction: f32,
) -> Result<(), KinematicBoomInputError> {
    for waypoint in motion {
        let pose = WorldPosition {
            landblock_id: solve_anchor,
            coords: waypoint.center,
            rotation: Quaternion::identity(),
        };
        let reanchored = reanchor(pose, tick_anchor)?;
        output.push(MotionWaypoint {
            center: reanchored.coords,
            end_fraction: start_fraction + (end_fraction - start_fraction) * waypoint.end_fraction,
            placement: waypoint.placement,
        });
    }
    Ok(())
}

fn validate_tick(
    duration_seconds: f32,
    samples: &[KinematicBoomTargetSample],
    current_radius: f32,
) -> Result<(), KinematicBoomInputError> {
    if !duration_seconds.is_finite() || duration_seconds <= 0.0 {
        return Err(KinematicBoomInputError::InvalidTickDuration);
    }
    let mut previous = 0.0;
    let mut previous_radius = current_radius;
    for sample in samples {
        if !sample.end_fraction.is_finite()
            || sample.end_fraction <= previous
            || sample.end_fraction > 1.0
        {
            return Err(KinematicBoomInputError::InvalidTargetPath);
        }
        validate_pose(sample.visual_pivot)?;
        validate_seed(sample.collision_seed)?;
        if sample.collision_seed.camera_radius > previous_radius + f32::EPSILON {
            return Err(KinematicBoomInputError::EnlargedCollisionSeedRadius);
        }
        previous_radius = sample.collision_seed.camera_radius;
        previous = sample.end_fraction;
    }
    if samples.is_empty() || previous != 1.0 {
        return Err(KinematicBoomInputError::InvalidTargetPath);
    }
    Ok(())
}

fn validate_pose(pose: WorldPosition) -> Result<(), KinematicBoomInputError> {
    let coords = pose.coords;
    if pose.landblock_id == Guid::NULL
        || !coords.x.is_finite()
        || !coords.y.is_finite()
        || !coords.z.is_finite()
    {
        return Err(KinematicBoomInputError::InvalidTargetPose);
    }
    Ok(())
}

fn validate_seed(seed: KinematicBoomCollisionSeed) -> Result<(), KinematicBoomInputError> {
    validate_pose(seed.placement.pose)?;
    if !seed.camera_radius.is_finite() || seed.camera_radius <= 0.0 {
        return Err(KinematicBoomInputError::InvalidCollisionSeedRadius);
    }
    Ok(())
}

fn validate_direction(direction: Vector3) -> Result<Vector3, KinematicBoomInputError> {
    if !direction.x.is_finite()
        || !direction.y.is_finite()
        || !direction.z.is_finite()
        || direction.length() <= DIRECTION_EPSILON
    {
        return Err(KinematicBoomInputError::InvalidViewDirection);
    }
    Ok(direction.normalize())
}

fn validate_transit_config(config: FreeSphereConfig) -> Result<(), KinematicBoomProfileError> {
    if !config.maximum_substep_distance.is_finite()
        || config.maximum_substep_distance <= 0.0
        || config.maximum_substeps == 0
        || config.maximum_contact_passes == 0
        || !config.separation_epsilon.is_finite()
        || config.separation_epsilon <= 0.0
    {
        return Err(KinematicBoomProfileError::InvalidTransitConfig);
    }
    Ok(())
}

fn spherical_interpolate(start: Vector3, end: Vector3, fraction: f32) -> Vector3 {
    let dot = start.dot(&end).clamp(-1.0, 1.0);
    if dot > 0.999_5 {
        return (start + (end - start) * fraction).normalize();
    }
    if dot < -0.999_5 {
        let z_up = Vector3::new(0.0, 0.0, 1.0);
        let mut axis = z_up - start * start.dot(&z_up);
        if axis.length() <= DIRECTION_EPSILON {
            axis = Vector3::new(1.0, 0.0, 0.0) - start * start.x;
        }
        let axis = axis.normalize();
        let angle = std::f32::consts::PI * fraction;
        return start * angle.cos() + axis.cross(&start) * angle.sin();
    }
    let angle = dot.acos();
    let scale = angle.sin();
    (start * ((1.0 - fraction) * angle).sin() + end * (fraction * angle).sin()) / scale
}

fn interpolate_pose(
    start: WorldPosition,
    end: WorldPosition,
    fraction: f32,
) -> Result<WorldPosition, KinematicBoomInputError> {
    let anchor = owner(start.landblock_id);
    let end = reanchor(end, anchor)?;
    let mut pose = start;
    pose.landblock_id = anchor;
    pose.coords = start.coords + (end.coords - start.coords) * fraction;
    pose.rotation = end.rotation;
    pose.normalize_outdoor_landblock_frame()
        .map_err(|_| KinematicBoomInputError::InvalidTargetPose)
}

fn reanchor(pose: WorldPosition, anchor: Guid) -> Result<WorldPosition, KinematicBoomInputError> {
    pose.reanchor_to_landblock_owner(anchor)
        .map_err(|_| KinematicBoomInputError::InvalidTargetPose)
}

fn placement_displacement(
    start: WorldPosition,
    end: WorldPosition,
) -> Result<Vector3, KinematicBoomInputError> {
    let anchor = owner(start.landblock_id);
    let start = reanchor(start, anchor)?;
    let end = reanchor(end, anchor)?;
    Ok(end.coords - start.coords)
}

fn placement_distance(
    start: WorldPosition,
    end: WorldPosition,
) -> Result<f32, KinematicBoomInputError> {
    Ok(placement_displacement(start, end)?.length())
}

fn owner(id: Guid) -> Guid {
    Guid((id.0 & 0xffff_0000) | 0xffff)
}

fn decay_fraction(delta_seconds: f32, half_life: f32) -> f32 {
    1.0 - 2.0_f32.powf(-delta_seconds / half_life)
}

fn failed(
    held: KinematicBoomPlacement,
    kind: KinematicBoomFailureKind,
    diagnostics: KinematicBoomDiagnostics,
) -> KinematicBoomOutcome {
    KinematicBoomOutcome::Failed {
        kind,
        held,
        diagnostics,
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::Arc;

    use super::*;
    use holtburger_common::{Plane, Sphere};
    use holtburger_content::{
        BspSolid, ColliderScale, CollisionBox, CollisionPolygon, CollisionShape,
        LandblockColliders, LandblockCollisionAsset, LandblockPlacement, LandblockTerrain,
        PlacedCollider, StaticColliderPlacement, TerrainCellDiagonals, TerrainCollisionSurface,
    };
    use holtburger_dat::physics::{BspLeaf, BspNode, InternalNode};

    const LANDBLOCK: u32 = 0xda55_ffff;

    fn profile_definition(maximum_control_legs: usize) -> KinematicBoomProfileDefinition {
        KinematicBoomProfileDefinition {
            minimum_reach: 1.2,
            maximum_reach: 8.0,
            vertical_pivot_half_life: 0.08,
            maximum_vertical_pivot_lag: 0.3,
            clearance_recovery_half_life: 0.1,
            clearance_hysteresis: 0.05,
            maximum_control_leg_displacement: 0.5,
            maximum_control_legs,
            surface_clearance: 0.000_5,
            transit: FreeSphereConfig {
                maximum_substep_distance: 0.25,
                maximum_substeps: 64,
                maximum_contact_passes: 8,
                separation_epsilon: 0.000_5,
            },
        }
    }

    fn profile(maximum_control_legs: usize) -> KinematicBoomProfile {
        KinematicBoomProfile::new(profile_definition(maximum_control_legs)).unwrap()
    }

    fn pose(coords: Vector3) -> WorldPosition {
        WorldPosition {
            landblock_id: Guid(LANDBLOCK),
            coords,
            rotation: Quaternion::identity(),
        }
    }

    fn seed(coords: Vector3) -> KinematicBoomCollisionSeed {
        KinematicBoomCollisionSeed {
            placement: KinematicBoomPlacement {
                pose: pose(coords),
                cell: None,
            },
            camera_radius: 0.25,
        }
    }

    fn controller(maximum_control_legs: usize) -> KinematicBoomController {
        KinematicBoomController::new(
            profile(maximum_control_legs),
            pose(Vector3::new(20.0, 20.0, 2.0)),
            seed(Vector3::new(20.0, 20.0, 1.0)),
            4.5,
            KinematicBoomIntent {
                sequence: 0,
                view_direction: Vector3::new(1.0, 0.0, 0.0),
                cumulative_zoom_displacement: 0.0,
            },
        )
        .unwrap()
    }

    fn sample() -> KinematicBoomTargetSample {
        KinematicBoomTargetSample {
            end_fraction: 1.0,
            visual_pivot: pose(Vector3::new(20.0, 20.0, 2.0)),
            collision_seed: seed(Vector3::new(20.0, 20.0, 1.0)),
        }
    }

    fn wall_sample() -> KinematicBoomTargetSample {
        KinematicBoomTargetSample {
            end_fraction: 1.0,
            visual_pivot: pose(Vector3::new(7.0, 20.0, 2.0)),
            collision_seed: seed(Vector3::new(7.0, 20.0, 1.0)),
        }
    }

    fn wall_controller(direction: Vector3) -> KinematicBoomController {
        KinematicBoomController::new(
            profile(64),
            wall_sample().visual_pivot,
            wall_sample().collision_seed,
            4.5,
            KinematicBoomIntent {
                sequence: 0,
                view_direction: direction,
                cumulative_zoom_displacement: 0.0,
            },
        )
        .unwrap()
    }

    fn flat_terrain(landblock: u32) -> TerrainCollisionSurface {
        TerrainCollisionSurface::from_terrain(&LandblockTerrain {
            grid_size: 9,
            tile_size: 24.0,
            height_indices: vec![0; 81],
            heights: vec![0.0; 81],
            terrain_samples: vec![0; 81],
            cell_diagonals: TerrainCellDiagonals::for_landblock(landblock),
        })
        .unwrap()
    }

    fn collision_asset(landblock: u32, colliders: Vec<PlacedCollider>) -> LandblockCollisionAsset {
        LandblockCollisionAsset {
            landblock_id: landblock,
            terrain: flat_terrain(landblock),
            static_geometry: LandblockColliders {
                colliders,
                cell_volumes: Vec::new(),
            },
        }
    }

    fn wall_x(x: f32) -> PlacedCollider {
        let plane = Plane {
            normal: Vector3::new(1.0, 0.0, 0.0),
            d: -x,
        };
        let surface_point = plane.normal * (-plane.d / plane.normal.length_squared());
        let outward = plane.normal * -1.0;
        let tangent = outward.cross(&Vector3::new(0.0, 0.0, 1.0));
        let bitangent = outward.cross(&tangent);
        let extent = 200.0;
        let polygon = CollisionPolygon {
            vertices: vec![
                surface_point - tangent * extent - bitangent * extent,
                surface_point + tangent * extent - bitangent * extent,
                surface_point + tangent * extent + bitangent * extent,
                surface_point - tangent * extent + bitangent * extent,
            ],
            normal: outward,
            d: -outward.dot(&surface_point),
        };
        let box_bounds = CollisionBox::from_points(polygon.vertices.iter().copied()).unwrap();
        let solid = BspNode::Leaf(BspLeaf {
            index: 1,
            solid: 1,
            sphere: None,
            poly_ids: vec![1],
        });
        let empty = BspNode::Leaf(BspLeaf {
            index: 0,
            solid: 0,
            sphere: None,
            poly_ids: Vec::new(),
        });
        let bounds = Sphere {
            center: Vector3::new(96.0, 96.0, 20.0),
            radius: 200.0,
        };
        let shape = Arc::new(CollisionShape::Bsp(BspSolid {
            bsp: BspNode::Internal(InternalNode {
                tag: *b"BPnn",
                plane,
                pos: Some(Box::new(solid)),
                neg: Some(Box::new(empty)),
                sphere: Some(bounds),
                poly_ids: Vec::new(),
            }),
            bounds,
            box_bounds,
            polygons: HashMap::from([(1, polygon)]),
        }));
        PlacedCollider::new(
            shape,
            LandblockPlacement {
                origin: Vector3::zero(),
                orientation: Quaternion::identity(),
            },
            ColliderScale::uniform(1.0).unwrap(),
            StaticColliderPlacement::OutdoorExplicit { source_index: 0 },
        )
        .unwrap()
    }

    fn wall_scene() -> CollisionScene {
        let mut scene = CollisionScene::new();
        let owner_x = (LANDBLOCK >> 24) as i32;
        let owner_y = ((LANDBLOCK >> 16) & 0xff) as i32;
        for x in owner_x - 1..=owner_x + 1 {
            for y in owner_y - 1..=owner_y + 1 {
                let landblock = ((x as u32) << 24) | ((y as u32) << 16) | 0xffff;
                scene
                    .insert(collision_asset(
                        landblock,
                        if landblock == LANDBLOCK {
                            vec![wall_x(10.0)]
                        } else {
                            Vec::new()
                        },
                    ))
                    .unwrap();
            }
        }
        scene
    }

    fn settle_reach(
        controller: &mut KinematicBoomController,
        scene: &CollisionScene,
        target: KinematicBoomTargetSample,
    ) {
        for _ in 0..60 {
            let outcome = controller.advance(scene, 1.0 / 30.0, &[target]).unwrap();
            assert!(matches!(outcome, KinematicBoomOutcome::Advanced { .. }));
        }
    }

    #[test]
    fn stale_intent_cannot_replace_direction_or_reapply_cumulative_zoom() {
        let mut controller = controller(64);
        assert_eq!(
            controller
                .accept_intent(KinematicBoomIntent {
                    sequence: 2,
                    view_direction: Vector3::new(0.0, 1.0, 0.0),
                    cumulative_zoom_displacement: 2.0,
                })
                .unwrap(),
            KinematicBoomIntentAcceptance::Accepted
        );
        assert_eq!(controller.desired_reach(), 6.5);
        assert_eq!(
            controller
                .accept_intent(KinematicBoomIntent {
                    sequence: 1,
                    view_direction: Vector3::new(-1.0, 0.0, 0.0),
                    cumulative_zoom_displacement: 7.0,
                })
                .unwrap(),
            KinematicBoomIntentAcceptance::Stale
        );
        assert_eq!(controller.desired_reach(), 6.5);
    }

    #[test]
    fn profile_validation_reaches_each_distinct_failure_contract() {
        type InvalidProfileCase = (
            KinematicBoomProfileError,
            fn(&mut KinematicBoomProfileDefinition),
        );
        let cases: &[InvalidProfileCase] = &[
            (KinematicBoomProfileError::InvalidMinimumReach, |value| {
                value.minimum_reach = -1.0;
            }),
            (KinematicBoomProfileError::InvalidMaximumReach, |value| {
                value.maximum_reach = 1.0;
            }),
            (
                KinematicBoomProfileError::InvalidVerticalPivotHalfLife,
                |value| value.vertical_pivot_half_life = 0.0,
            ),
            (
                KinematicBoomProfileError::InvalidMaximumVerticalPivotLag,
                |value| value.maximum_vertical_pivot_lag = -1.0,
            ),
            (
                KinematicBoomProfileError::InvalidClearanceRecoveryHalfLife,
                |value| value.clearance_recovery_half_life = 0.0,
            ),
            (
                KinematicBoomProfileError::InvalidClearanceHysteresis,
                |value| value.clearance_hysteresis = -1.0,
            ),
            (
                KinematicBoomProfileError::InvalidControlLegDisplacement,
                |value| value.maximum_control_leg_displacement = 0.0,
            ),
            (KinematicBoomProfileError::EmptyControlLegBudget, |value| {
                value.maximum_control_legs = 0;
            }),
            (
                KinematicBoomProfileError::InvalidSurfaceClearance,
                |value| value.surface_clearance = 0.0,
            ),
            (KinematicBoomProfileError::InvalidTransitConfig, |value| {
                value.transit.maximum_contact_passes = 0
            }),
        ];
        for (expected, mutate) in cases {
            let mut definition = profile_definition(64);
            mutate(&mut definition);
            assert_eq!(KinematicBoomProfile::new(definition), Err(*expected));
        }
    }

    #[test]
    fn session_and_tick_validation_reach_each_input_failure_contract() {
        let initial = KinematicBoomIntent {
            sequence: 0,
            view_direction: Vector3::new(1.0, 0.0, 0.0),
            cumulative_zoom_displacement: 0.0,
        };
        assert_eq!(
            KinematicBoomController::new(
                profile(64),
                pose(Vector3::new(f32::NAN, 0.0, 0.0)),
                seed(Vector3::zero()),
                4.5,
                initial,
            )
            .unwrap_err(),
            KinematicBoomInputError::InvalidTargetPose
        );
        let mut invalid_seed = seed(Vector3::zero());
        invalid_seed.camera_radius = 0.0;
        assert_eq!(
            KinematicBoomController::new(
                profile(64),
                pose(Vector3::zero()),
                invalid_seed,
                4.5,
                initial,
            )
            .unwrap_err(),
            KinematicBoomInputError::InvalidCollisionSeedRadius
        );
        assert_eq!(
            KinematicBoomController::new(
                profile(64),
                pose(Vector3::zero()),
                seed(Vector3::zero()),
                f32::NAN,
                initial,
            )
            .unwrap_err(),
            KinematicBoomInputError::InvalidInitialReach
        );

        let mut controller = controller(64);
        assert_eq!(
            controller
                .accept_intent(KinematicBoomIntent {
                    sequence: 1,
                    view_direction: Vector3::zero(),
                    cumulative_zoom_displacement: 0.0,
                })
                .unwrap_err(),
            KinematicBoomInputError::InvalidViewDirection
        );
        assert_eq!(
            controller
                .accept_intent(KinematicBoomIntent {
                    sequence: 1,
                    view_direction: Vector3::new(1.0, 0.0, 0.0),
                    cumulative_zoom_displacement: f32::NAN,
                })
                .unwrap_err(),
            KinematicBoomInputError::InvalidCumulativeZoom
        );
        let mut enlarged = sample();
        enlarged.collision_seed.camera_radius = 0.3;
        assert_eq!(
            controller
                .advance(&CollisionScene::new(), 1.0 / 30.0, &[enlarged])
                .unwrap_err(),
            KinematicBoomInputError::EnlargedCollisionSeedRadius
        );
        assert_eq!(
            controller
                .advance(&CollisionScene::new(), 0.0, &[sample()])
                .unwrap_err(),
            KinematicBoomInputError::InvalidTickDuration
        );
        assert_eq!(
            controller
                .advance(&CollisionScene::new(), 1.0 / 30.0, &[])
                .unwrap_err(),
            KinematicBoomInputError::InvalidTargetPath
        );
    }

    #[test]
    fn empty_scene_emits_a_nonempty_normalized_path_and_advances_recovery_monotonically() {
        let mut controller = controller(64);
        let scene = CollisionScene::new();
        let first = controller.advance(&scene, 1.0 / 30.0, &[sample()]).unwrap();
        let KinematicBoomOutcome::Advanced {
            advance: KinematicBoomAdvance::Continuous { path },
            ..
        } = first
        else {
            panic!("empty scene must solve")
        };
        assert_eq!(path.legs().last().unwrap().end_fraction(), 1.0);
        let first_reach = controller.rendered_reach();
        controller.advance(&scene, 1.0 / 30.0, &[sample()]).unwrap();
        assert!(controller.rendered_reach() > first_reach);
        assert!(controller.rendered_reach() < controller.desired_reach());
    }

    #[test]
    fn clearance_sweep_accepts_reach_beyond_the_removed_sample_budget() {
        let mut definition = profile_definition(64);
        definition.maximum_reach = 32.0;
        let mut controller = KinematicBoomController::new(
            KinematicBoomProfile::new(definition).unwrap(),
            sample().visual_pivot,
            sample().collision_seed,
            32.0,
            KinematicBoomIntent {
                sequence: 0,
                view_direction: Vector3::new(1.0, 0.0, 0.0),
                cumulative_zoom_displacement: 0.0,
            },
        )
        .unwrap();

        assert!(matches!(
            controller
                .advance(&CollisionScene::new(), 1.0 / 30.0, &[sample()])
                .unwrap(),
            KinematicBoomOutcome::Advanced { .. }
        ));
        assert_eq!(controller.desired_reach(), 32.0);
    }

    #[test]
    fn transit_budget_commits_safe_prefix_and_continues_next_tick() {
        let mut definition = profile_definition(64);
        definition.maximum_reach = 32.0;
        definition.transit.maximum_substeps = 1;
        let mut controller = KinematicBoomController::new(
            KinematicBoomProfile::new(definition).unwrap(),
            sample().visual_pivot,
            sample().collision_seed,
            32.0,
            KinematicBoomIntent {
                sequence: 0,
                view_direction: Vector3::new(1.0, 0.0, 0.0),
                cumulative_zoom_displacement: 0.0,
            },
        )
        .unwrap();
        let initial = controller.camera().pose;

        assert!(matches!(
            controller
                .advance(&CollisionScene::new(), 1.0 / 30.0, &[sample()])
                .unwrap(),
            KinematicBoomOutcome::Advanced { .. }
        ));
        let first = controller.camera().pose;
        let first_displacement = placement_distance(initial, first).unwrap();
        assert!(first_displacement > 0.0);
        assert!(first_displacement <= definition.transit.maximum_substep_distance + 1.0e-5);

        assert!(matches!(
            controller
                .advance(&CollisionScene::new(), 1.0 / 30.0, &[sample()])
                .unwrap(),
            KinematicBoomOutcome::Advanced { .. }
        ));
        assert!(
            placement_distance(initial, controller.camera().pose).unwrap() > first_displacement
        );
    }

    #[test]
    fn control_budget_commits_one_prefix_and_continues_next_tick() {
        let mut controller = controller(1);
        let mut moved = sample();
        moved.visual_pivot.coords.x += 2.0;
        moved.collision_seed.placement.pose.coords.x += 2.0;

        let first = controller
            .advance(&CollisionScene::new(), 1.0 / 30.0, &[moved])
            .unwrap();
        assert!(matches!(
            first,
            KinematicBoomOutcome::Advanced {
                diagnostics: KinematicBoomDiagnostics {
                    control_legs: 1,
                    ..
                },
                ..
            }
        ));
        assert_eq!(controller.raw_visual_pivot.coords.x, 20.5);

        let second = controller
            .advance(&CollisionScene::new(), 1.0 / 30.0, &[moved])
            .unwrap();
        assert!(matches!(second, KinematicBoomOutcome::Advanced { .. }));
        assert_eq!(controller.raw_visual_pivot.coords.x, 21.0);
    }

    #[test]
    fn antipodal_direction_uses_one_deterministic_z_up_arc() {
        let halfway = spherical_interpolate(
            Vector3::new(1.0, 0.0, 0.0),
            Vector3::new(-1.0, 0.0, 0.0),
            0.5,
        );
        assert!((halfway - Vector3::new(0.0, 1.0, 0.0)).length() < 1.0e-5);
    }

    #[test]
    fn equivalent_recovery_duration_is_independent_of_tick_splits() {
        let scene = CollisionScene::new();
        let mut one = controller(64);
        let mut two = one.clone();
        one.advance(&scene, 1.0 / 15.0, &[sample()]).unwrap();
        two.advance(&scene, 1.0 / 30.0, &[sample()]).unwrap();
        two.advance(&scene, 1.0 / 30.0, &[sample()]).unwrap();
        assert!(
            (one.rendered_reach() - two.rendered_reach()).abs() < 1.0e-5,
            "one={} two={}",
            one.rendered_reach(),
            two.rendered_reach()
        );
    }

    #[test]
    fn equivalent_target_motion_is_independent_of_internal_sample_splits() {
        let scene = CollisionScene::new();
        let mut one = controller(64);
        let mut two = one.clone();
        let mut end = sample();
        end.visual_pivot.coords.x += 1.0;
        end.collision_seed.placement.pose.coords.x += 1.0;
        let mut midpoint = end;
        midpoint.end_fraction = 0.5;
        midpoint.visual_pivot.coords.x -= 0.5;
        midpoint.collision_seed.placement.pose.coords.x -= 0.5;

        one.advance(&scene, 1.0 / 30.0, &[end]).unwrap();
        two.advance(&scene, 1.0 / 30.0, &[midpoint, end]).unwrap();
        assert!(placement_distance(one.camera().pose, two.camera().pose).unwrap() < 1.0e-5);
        assert!((one.rendered_reach() - two.rendered_reach()).abs() < 1.0e-5);
    }

    #[test]
    fn rapid_orbit_retracts_immediately_then_recovers_monotonically_after_clearance() {
        let scene = wall_scene();
        let mut controller = wall_controller(Vector3::new(0.0, 1.0, 0.0));
        settle_reach(&mut controller, &scene, wall_sample());
        assert!(
            controller.rendered_reach() > 4.49,
            "settled reach={}",
            controller.rendered_reach()
        );
        controller
            .accept_intent(KinematicBoomIntent {
                sequence: 1,
                view_direction: Vector3::new(1.0, 0.0, 0.0),
                cumulative_zoom_displacement: 0.0,
            })
            .unwrap();

        let outcome = controller
            .advance(&scene, 1.0 / 30.0, &[wall_sample()])
            .unwrap();
        let KinematicBoomOutcome::Advanced {
            advance: KinematicBoomAdvance::Continuous { path },
            diagnostics,
        } = outcome
        else {
            panic!("rapid orbit must remain solvable")
        };
        assert!(diagnostics.control_legs > 1);
        assert!(controller.rendered_reach() < 3.0);
        assert!(
            path.legs().iter().all(|leg| leg.end().center().x <= 9.751),
            "every interpolated leg boundary must retain the radius before x=10"
        );

        let retracted_reach = controller.rendered_reach();
        controller
            .accept_intent(KinematicBoomIntent {
                sequence: 2,
                view_direction: Vector3::new(0.0, 1.0, 0.0),
                cumulative_zoom_displacement: 0.0,
            })
            .unwrap();
        let mut previous = retracted_reach;
        for _ in 0..10 {
            controller
                .advance(&scene, 1.0 / 30.0, &[wall_sample()])
                .unwrap();
            let recovered = controller.rendered_reach();
            assert!(recovered >= previous);
            assert!(recovered <= controller.desired_reach());
            previous = recovered;
        }
        assert!(previous > retracted_reach);
    }

    #[test]
    fn wall_graze_preserves_tangential_target_motion_without_reach_chatter() {
        let scene = wall_scene();
        let mut controller = wall_controller(Vector3::new(1.0, 0.0, 0.0));
        settle_reach(&mut controller, &scene, wall_sample());
        let initial_reach = controller.rendered_reach();
        let initial_y = controller.camera().pose.coords.y;

        let mut previous_y = initial_y;
        let mut reaches = vec![initial_reach];
        for step in 1..=6 {
            let mut target = wall_sample();
            target.visual_pivot.coords.y += step as f32 * 0.1;
            target.collision_seed.placement.pose.coords.y += step as f32 * 0.1;
            let outcome = controller.advance(&scene, 1.0 / 30.0, &[target]).unwrap();
            assert!(matches!(outcome, KinematicBoomOutcome::Advanced { .. }));
            let camera = controller.camera().pose.coords;
            assert!(camera.x <= 9.751);
            assert!(camera.y >= previous_y);
            previous_y = camera.y;
            reaches.push(controller.rendered_reach());
        }
        assert!(previous_y > initial_y + 0.5);
        assert!((controller.rendered_reach() - initial_reach).abs() < 0.02);
        let direction_reversals = reaches
            .windows(3)
            .filter(|window| {
                let before = window[1] - window[0];
                let after = window[2] - window[1];
                before.abs() > 1.0e-5 && after.abs() > 1.0e-5 && before.signum() != after.signum()
            })
            .count();
        assert_eq!(direction_reversals, 0);
    }

    #[test]
    fn vertical_step_is_lag_clamped_then_converges_monotonically() {
        let scene = CollisionScene::new();
        let mut controller = controller(64);
        settle_reach(&mut controller, &scene, sample());
        let before = controller.camera().pose.coords.z;
        let mut stepped = sample();
        stepped.visual_pivot.coords.z += 0.6;
        stepped.collision_seed.placement.pose.coords.z += 0.6;
        controller.advance(&scene, 1.0 / 30.0, &[stepped]).unwrap();
        let first = controller.camera().pose.coords.z;
        assert!(
            (first - before - 0.3).abs() < 0.01,
            "before={before} first={first}"
        );

        let mut previous = first;
        for _ in 0..12 {
            controller.advance(&scene, 1.0 / 30.0, &[stepped]).unwrap();
            let current = controller.camera().pose.coords.z;
            assert!(current >= previous);
            previous = current;
        }
        assert!(previous < before + 0.601);
        assert!(previous > before + 0.58);
    }
}
