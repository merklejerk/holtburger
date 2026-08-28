//! Client-owned third-person camera placement over the shared kinematic boom controller.
//!
//! The camera is deliberately a presentation product, but its placement still belongs beside the
//! client authority: only this module can see the installed collision snapshot and the accepted
//! local-player path.  The host forwards semantic camera commands and receives a serializable path;
//! it never owns a second body, collision scene, or fixed clock.

use std::time::Duration;

use anyhow::{Context, Result, ensure};
use holtburger_common::position::WorldPosition;
use holtburger_common::{Guid, Vector3};
use holtburger_world::{
    ChildSpatialBody, ChildSpatialBodyDefinition, ChildSpatialBodyWaypoint, PhysicalBodyDefinition,
    SpatialBodyId, WorldState,
};
use serde::{Deserialize, Serialize};

use super::ClientRuntime;
use crate::DynamicEntityPlacedPath;
use crate::SimulationSceneSnapshot;
use crate::client::types::ClientViewEvent;
use crate::kinematic_boom::{
    KinematicBoomAdvance, KinematicBoomClearance, KinematicBoomCollisionProof,
    KinematicBoomController, KinematicBoomDiagnostics, KinematicBoomHoldReason,
    KinematicBoomIntent, KinematicBoomOutcome, KinematicBoomPlacedPath, KinematicBoomPlacement,
    KinematicBoomProfile, KinematicBoomReseedReason, KinematicBoomTargetSample,
    KinematicBoomTargetSeed, KinematicBoomUpdateAcceptance, interpolate_pose,
    present_placed_motion_pose, resolve_camera_pivot_offset, serialize_kinematic_boom_path,
    standard_kinematic_boom_profile, stationary_kinematic_boom_path,
};
use crate::{DynamicEntityPlacementAdvanceKind, DynamicEntityTickBatch};

/// Renderer-authored camera registration request.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClientCameraStartRequest {
    /// Authority-published player identity to follow.
    pub player_guid: Guid,
    /// Player instance generation that guards reuse of the GUID.
    pub entity_generation: u64,
    /// Desired initial boom reach in metres.
    pub initial_reach: f32,
    /// Inclusive minimum user-controlled reach.
    pub minimum_reach: f32,
    /// Inclusive maximum user-controlled reach.
    pub maximum_reach: f32,
    /// First semantic input sequence for this registration.
    pub input_sequence: u64,
    /// Unit view direction in the player's spatial frame.
    pub view_direction: [f32; 3],
    /// Cumulative zoom displacement consumed exactly once by the controller.
    pub cumulative_zoom_displacement: f32,
    /// Frontend projection revision paired with its clearance radius.
    pub projection_revision: u64,
    /// Camera near-plane clearance sphere radius in metres.
    pub clearance_radius: f32,
}

/// Latest-wins camera intent targeted to one camera generation.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClientCameraIntentRequest {
    /// Camera generation receiving this latest-wins update.
    pub camera_generation: u64,
    /// Player identity retained as part of the generation guard.
    pub player_guid: Guid,
    /// Player instance generation retained as part of the generation guard.
    pub entity_generation: u64,
    /// Monotonic semantic input sequence.
    pub input_sequence: u64,
    /// Unit view direction in the player's spatial frame.
    pub view_direction: [f32; 3],
    /// Cumulative zoom displacement, not a per-message delta.
    pub cumulative_zoom_displacement: f32,
}

/// Latest-wins projection-clearance update targeted to one camera generation.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClientCameraClearanceRequest {
    /// Camera generation receiving this projection update.
    pub camera_generation: u64,
    /// Player identity retained as part of the generation guard.
    pub player_guid: Guid,
    /// Player instance generation retained as part of the generation guard.
    pub entity_generation: u64,
    /// Monotonic frontend projection revision.
    pub projection_revision: u64,
    /// Camera near-plane clearance sphere radius in metres.
    pub clearance_radius: f32,
}

/// Complete client camera identity carried by every command receipt and tick.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientCameraIdentity {
    /// Monotonic camera registration generation.
    pub camera_generation: u64,
    /// Authority-published player identity followed by the camera.
    pub player_guid: Guid,
    /// Player instance generation that prevents stale GUID reuse.
    pub entity_generation: u64,
}

/// Receipt returned after a camera generation is accepted.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientCameraStartReceipt {
    #[serde(flatten)]
    /// Complete accepted registration identity.
    pub identity: ClientCameraIdentity,
}

/// Result of one client camera semantic update.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ClientCameraUpdateReceipt {
    Accepted,
    IgnoredStale,
}

/// Projection clearance proven by a client camera placement.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientCameraClearance {
    /// Frontend projection revision proven by this placement.
    pub projection_revision: u64,
    /// Clearance sphere radius used by the solve.
    pub radius: f32,
}

/// Sphere selected from the local player's accepted physical body.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ClientCameraTargetSphereRole {
    Primary,
    UpperConstraint,
}

/// Whether the published camera path was proven against complete static coverage.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum ClientCameraCollisionProof {
    /// Every selected owner was resident in the sampled scene.
    Covered,
    /// Installed topology was used despite one unavailable selected owner.
    Uncovered {
        /// First unavailable normalized collision owner.
        owner: Guid,
    },
}

impl From<KinematicBoomCollisionProof> for ClientCameraCollisionProof {
    fn from(value: KinematicBoomCollisionProof) -> Self {
        match value {
            KinematicBoomCollisionProof::Covered => Self::Covered,
            KinematicBoomCollisionProof::Uncovered { owner } => Self::Uncovered { owner },
        }
    }
}

/// Finite-work diagnostics for one camera solve.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientCameraDiagnostics {
    /// Collision-authority proof for this camera result.
    pub collision_proof: ClientCameraCollisionProof,
    /// Semantic controller path legs evaluated.
    pub control_legs: usize,
    /// Radial clearance sweeps executed.
    pub clearance_sweeps: usize,
    /// Portal-transit subdivisions evaluated.
    pub transit_substeps: usize,
    /// Free-sphere contact passes executed.
    pub contact_passes: usize,
}

impl From<KinematicBoomDiagnostics> for ClientCameraDiagnostics {
    fn from(value: KinematicBoomDiagnostics) -> Self {
        Self {
            collision_proof: value.collision_proof.into(),
            control_legs: value.control_legs,
            clearance_sweeps: value.clearance_sweeps,
            transit_substeps: value.transit_substeps,
            contact_passes: value.contact_passes,
        }
    }
}

/// Machine-readable reason for a recoverable held camera tick.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ClientCameraHoldReason {
    ClearanceSweep,
    FreeSphereQuery,
    TargetContract,
    ControllerInput,
    PathProjection,
}

impl From<KinematicBoomHoldReason> for ClientCameraHoldReason {
    fn from(value: KinematicBoomHoldReason) -> Self {
        match value {
            KinematicBoomHoldReason::ClearanceSweep => Self::ClearanceSweep,
            KinematicBoomHoldReason::FreeSphereQuery => Self::FreeSphereQuery,
        }
    }
}

/// Reason a client camera was reseeded onto a safe target placement.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ClientCameraReseedReason {
    InitialPlacement,
    PlacedPath,
    PlacementRecovery,
}

impl From<KinematicBoomReseedReason> for ClientCameraReseedReason {
    fn from(value: KinematicBoomReseedReason) -> Self {
        match value {
            KinematicBoomReseedReason::InitialPlacement => Self::InitialPlacement,
            KinematicBoomReseedReason::PlacedPath => Self::PlacedPath,
            KinematicBoomReseedReason::PlacementRecovery => Self::PlacementRecovery,
        }
    }
}

/// One host-authored collision-safe client camera tick.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum ClientCameraTick {
    Advanced {
        #[serde(flatten)]
        identity: ClientCameraIdentity,
        sequence: u64,
        /// Exact authority-clocked duration used by the boom solve and path playback.
        duration_ms: f64,
        target_sphere_role: ClientCameraTargetSphereRole,
        clearance: Option<ClientCameraClearance>,
        desired_reach: f32,
        rendered_reach: f32,
        path: KinematicBoomPlacedPath,
        diagnostics: ClientCameraDiagnostics,
    },
    Reseeded {
        #[serde(flatten)]
        identity: ClientCameraIdentity,
        sequence: u64,
        /// Exact authority-clocked duration used by the boom solve and path playback.
        duration_ms: f64,
        target_sphere_role: ClientCameraTargetSphereRole,
        clearance: Option<ClientCameraClearance>,
        desired_reach: f32,
        rendered_reach: f32,
        path: KinematicBoomPlacedPath,
        reason: ClientCameraReseedReason,
        diagnostics: ClientCameraDiagnostics,
    },
    Held {
        #[serde(flatten)]
        identity: ClientCameraIdentity,
        sequence: u64,
        /// Exact authority-clocked duration used by the boom solve and path playback.
        duration_ms: f64,
        target_sphere_role: ClientCameraTargetSphereRole,
        clearance: Option<ClientCameraClearance>,
        desired_reach: f32,
        rendered_reach: f32,
        path: KinematicBoomPlacedPath,
        reason: ClientCameraHoldReason,
        diagnostics: ClientCameraDiagnostics,
    },
}

#[derive(Clone, Copy)]
struct SelectedSphere {
    role: ClientCameraTargetSphereRole,
    center: Vector3,
    radius: f32,
}

struct PendingCamera {
    identity: ClientCameraIdentity,
    request: ClientCameraStartRequest,
    /// Last output sequence retained while the camera waits for a replacement collision scene.
    sequence: u64,
}

struct ActiveCamera {
    identity: ClientCameraIdentity,
    /// Latest accepted registration/input/clearance values used to rehydrate after a scene swap.
    request: ClientCameraStartRequest,
    controller: KinematicBoomController,
    target_sphere_role: ClientCameraTargetSphereRole,
    pivot_offset: Vector3,
    /// Parent-driven target sphere whose topology is reconciled by the shared spatial solver.
    target_body: ChildSpatialBody,
    latest_target_samples: Vec<KinematicBoomTargetSample>,
    sequence: u64,
}

/// Client-side lifecycle owner for the generic kinematic boom controller.
#[derive(Default)]
pub(super) struct ClientCameraRuntime {
    profile: Option<KinematicBoomProfile>,
    next_generation: u64,
    pending: Option<PendingCamera>,
    active: Option<ActiveCamera>,
}

impl ClientCameraRuntime {
    pub(super) fn new() -> Result<Self> {
        Ok(Self {
            profile: Some(standard_kinematic_boom_profile()?),
            ..Self::default()
        })
    }

    pub(super) fn start(
        &mut self,
        request: ClientCameraStartRequest,
        world: &WorldState,
    ) -> Result<ClientCameraStartReceipt> {
        ensure!(
            request.player_guid != Guid::NULL && request.player_guid == world.player.guid,
            "client camera start targets a stale local player"
        );
        let entity_generation = world
            .player_entity()
            .context("client camera target entity is unavailable")?
            .instance_sequence();
        ensure!(
            request.entity_generation == u64::from(entity_generation),
            "client camera start targets a stale entity generation"
        );
        validate_camera_request(request)?;
        self.next_generation = self
            .next_generation
            .checked_add(1)
            .context("client camera generation exhausted")?;
        let identity = ClientCameraIdentity {
            camera_generation: self.next_generation,
            player_guid: request.player_guid,
            entity_generation: request.entity_generation,
        };
        self.active = None;
        self.pending = Some(PendingCamera {
            identity,
            request,
            sequence: 0,
        });
        Ok(ClientCameraStartReceipt { identity })
    }

    pub(super) fn set_intent(
        &mut self,
        request: ClientCameraIntentRequest,
    ) -> Result<ClientCameraUpdateReceipt> {
        let identity = ClientCameraIdentity {
            camera_generation: request.camera_generation,
            player_guid: request.player_guid,
            entity_generation: request.entity_generation,
        };
        if self
            .active
            .as_ref()
            .is_some_and(|camera| camera.identity == identity)
        {
            let active = self.active.as_mut().expect("active camera was checked");
            let acceptance = active.controller.accept_intent(KinematicBoomIntent {
                sequence: request.input_sequence,
                view_direction: Vector3::new(
                    request.view_direction[0],
                    request.view_direction[1],
                    request.view_direction[2],
                ),
                cumulative_zoom_displacement: request.cumulative_zoom_displacement,
            })?;
            if matches!(acceptance, KinematicBoomUpdateAcceptance::Accepted) {
                active.request.input_sequence = request.input_sequence;
                active.request.view_direction = request.view_direction;
                active.request.cumulative_zoom_displacement = request.cumulative_zoom_displacement;
            }
            return Ok(match acceptance {
                KinematicBoomUpdateAcceptance::Accepted => ClientCameraUpdateReceipt::Accepted,
                KinematicBoomUpdateAcceptance::Stale => ClientCameraUpdateReceipt::IgnoredStale,
            });
        }
        let Some(pending) = self.pending.as_mut() else {
            return Ok(ClientCameraUpdateReceipt::IgnoredStale);
        };
        if pending.identity != identity || request.input_sequence <= pending.request.input_sequence
        {
            return Ok(ClientCameraUpdateReceipt::IgnoredStale);
        }
        validate_view_direction(request.view_direction)?;
        ensure!(
            request.cumulative_zoom_displacement.is_finite(),
            "client camera cumulative zoom must be finite"
        );
        pending.request.input_sequence = request.input_sequence;
        pending.request.view_direction = request.view_direction;
        pending.request.cumulative_zoom_displacement = request.cumulative_zoom_displacement;
        Ok(ClientCameraUpdateReceipt::Accepted)
    }

    pub(super) fn set_clearance(
        &mut self,
        request: ClientCameraClearanceRequest,
    ) -> Result<ClientCameraUpdateReceipt> {
        let identity = ClientCameraIdentity {
            camera_generation: request.camera_generation,
            player_guid: request.player_guid,
            entity_generation: request.entity_generation,
        };
        validate_clearance(request.projection_revision, request.clearance_radius)?;
        if self
            .active
            .as_ref()
            .is_some_and(|camera| camera.identity == identity)
        {
            let active = self.active.as_mut().expect("active camera was checked");
            let acceptance = active
                .controller
                .request_clearance(KinematicBoomClearance {
                    revision: request.projection_revision,
                    radius: request.clearance_radius,
                })?;
            if matches!(acceptance, KinematicBoomUpdateAcceptance::Accepted) {
                active.request.projection_revision = request.projection_revision;
                active.request.clearance_radius = request.clearance_radius;
            }
            return Ok(match acceptance {
                KinematicBoomUpdateAcceptance::Accepted => ClientCameraUpdateReceipt::Accepted,
                KinematicBoomUpdateAcceptance::Stale => ClientCameraUpdateReceipt::IgnoredStale,
            });
        }
        let Some(pending) = self.pending.as_mut() else {
            return Ok(ClientCameraUpdateReceipt::IgnoredStale);
        };
        if pending.identity != identity
            || request.projection_revision <= pending.request.projection_revision
        {
            return Ok(ClientCameraUpdateReceipt::IgnoredStale);
        }
        pending.request.projection_revision = request.projection_revision;
        pending.request.clearance_radius = request.clearance_radius;
        Ok(ClientCameraUpdateReceipt::Accepted)
    }

    pub(super) fn stop(&mut self, identity: ClientCameraIdentity) -> bool {
        let matches = self
            .active
            .as_ref()
            .is_some_and(|camera| camera.identity == identity)
            || self
                .pending
                .as_ref()
                .is_some_and(|camera| camera.identity == identity);
        if matches {
            self.active = None;
            self.pending = None;
        }
        matches
    }

    /// Drops all placement and projection history on a client discontinuity or disconnect.
    pub(super) fn reset(&mut self) {
        self.active = None;
        self.pending = None;
    }

    /// Advances immediately after the client dynamic advance product is built.
    pub(super) fn advance(
        &mut self,
        world: &WorldState,
        collision: Option<&SimulationSceneSnapshot>,
        batch: Option<&DynamicEntityTickBatch>,
        duration: Duration,
    ) -> Result<Option<ClientCameraTick>> {
        let _ = self.initialize_if_ready(world, collision)?;
        let Some(_) = self.active.as_ref() else {
            return Ok(None);
        };
        let duration_seconds = duration.as_secs_f32();
        if !duration_seconds.is_finite() || duration_seconds <= 0.0 {
            return Ok(None);
        }
        let Some(collision) = collision else {
            return Ok(None);
        };
        let Some(active) = self.active.as_mut() else {
            return Ok(None);
        };
        let path_samples = batch
            .and_then(|batch| {
                batch.advances.iter().find(|advance| {
                    advance.entity.identity.guid == active.identity.player_guid
                        && advance.entity.generation == active.identity.entity_generation
                        && matches!(advance.kind, DynamicEntityPlacementAdvanceKind::Integrated)
                })
            })
            .map(|advance| {
                target_samples_from_dynamic_path(
                    collision.scene.as_ref(),
                    &advance.path,
                    &mut active.target_body,
                    active.pivot_offset,
                )
            })
            .transpose()?;
        if let Some(samples) = path_samples {
            active.latest_target_samples = samples;
        }
        if active.latest_target_samples.is_empty() {
            let pose = world
                .scene
                .body(SpatialBodyId::LocalPlayer(active.identity.player_guid))
                .context("client camera target body disappeared")?
                .pose;
            active.latest_target_samples = vec![target_sample_from_pose(
                collision.scene.as_ref(),
                pose,
                &mut active.target_body,
                active.pivot_offset,
            )?];
        }
        let initial_visual_pivot = active.controller.visual_pivot();
        let outcome = active.controller.advance(
            collision.scene.as_ref(),
            duration_seconds,
            &active.latest_target_samples,
        )?;
        let tick = project_camera_outcome(
            active,
            initial_visual_pivot,
            duration.as_secs_f64() * 1_000.0,
            outcome,
        )?;
        Ok(Some(tick))
    }

    /// Produce the one collision-backed, input-free seed needed before a desktop portal reveal.
    ///
    /// The seed uses the normal controller clearance transaction with a tiny presentation-only
    /// duration and no dynamic target batch. It never consumes a drive, advances the authority
    /// clock, or runs while an active camera already has a sequence.
    pub(super) fn seed(
        &mut self,
        world: &WorldState,
        collision: Option<&SimulationSceneSnapshot>,
    ) -> Result<Option<ClientCameraTick>> {
        if self
            .active
            .as_ref()
            .is_some_and(|camera| camera.sequence > 0)
        {
            return Ok(None);
        }
        let Some(collision) = collision else {
            return Ok(None);
        };
        self.advance(world, Some(collision), None, Duration::from_millis(1))
    }

    fn initialize_if_ready(
        &mut self,
        world: &WorldState,
        collision: Option<&SimulationSceneSnapshot>,
    ) -> Result<bool> {
        if self.active.is_some() {
            return Ok(true);
        }
        let Some(pending) = self.pending.as_ref() else {
            return Ok(false);
        };
        let Some(collision) = collision else {
            return Ok(false);
        };
        let body = world
            .scene
            .body(SpatialBodyId::LocalPlayer(pending.identity.player_guid))
            .context("client camera target body is unavailable")?;
        let Some(physical) = body.physical.as_ref() else {
            return Ok(false);
        };
        let sphere = selected_sphere(physical.definition);
        let mut target_body = ChildSpatialBody::new(
            ChildSpatialBodyDefinition::new(sphere.center, sphere.radius)?,
            body.pose,
        );
        let initial_sample = target_sample_from_pose(
            collision.scene.as_ref(),
            body.pose,
            &mut target_body,
            resolve_camera_pivot_offset(sphere.center, 0.0),
        )?;
        let seed = initial_sample.target_seed;
        let pivot_offset = resolve_camera_pivot_offset(sphere.center, 0.0);
        let profile = self
            .profile
            .expect("client camera profile is initialized with the runtime");
        let request = pending.request;
        let sequence = pending.sequence;
        let controller = KinematicBoomController::new(
            profile.with_reach_limits(request.minimum_reach, request.maximum_reach)?,
            visual_pivot(body.pose, pivot_offset),
            seed,
            KinematicBoomClearance {
                revision: request.projection_revision,
                radius: request.clearance_radius,
            },
            request.initial_reach,
            KinematicBoomIntent {
                sequence: request.input_sequence,
                view_direction: Vector3::new(
                    request.view_direction[0],
                    request.view_direction[1],
                    request.view_direction[2],
                ),
                cumulative_zoom_displacement: request.cumulative_zoom_displacement,
            },
        )?;
        self.active = Some(ActiveCamera {
            identity: pending.identity,
            request,
            controller,
            target_sphere_role: sphere.role,
            pivot_offset,
            target_body,
            latest_target_samples: vec![initial_sample],
            sequence,
        });
        self.pending = None;
        Ok(true)
    }
}

impl ClientRuntime {
    pub(super) fn start_camera(
        &mut self,
        request: ClientCameraStartRequest,
    ) -> Result<ClientCameraStartReceipt> {
        let receipt = self.camera.start(request, &self.world)?;
        let _ = self
            .client_view_event_tx
            .send(ClientViewEvent::CameraStarted(receipt));
        Ok(receipt)
    }

    pub(super) fn set_camera_intent(
        &mut self,
        request: ClientCameraIntentRequest,
    ) -> Result<ClientCameraUpdateReceipt> {
        self.camera.set_intent(request)
    }

    pub(super) fn set_camera_clearance(
        &mut self,
        request: ClientCameraClearanceRequest,
    ) -> Result<ClientCameraUpdateReceipt> {
        self.camera.set_clearance(request)
    }

    pub(super) fn stop_camera(&mut self, identity: ClientCameraIdentity) -> bool {
        self.camera.stop(identity)
    }

    pub(super) fn reset_camera(&mut self) {
        self.camera.reset();
    }

    pub(super) fn advance_camera(
        &mut self,
        collision: Option<&SimulationSceneSnapshot>,
        batch: Option<&DynamicEntityTickBatch>,
        duration: Duration,
    ) -> Result<Option<ClientCameraTick>> {
        self.camera.advance(&self.world, collision, batch, duration)
    }

    pub(super) fn seed_camera(
        &mut self,
        collision: Option<&SimulationSceneSnapshot>,
    ) -> Result<Option<ClientCameraTick>> {
        self.camera.seed(&self.world, collision)
    }

    pub(super) fn emit_camera_event(&self, tick: ClientCameraTick) {
        let _ = self
            .client_view_event_tx
            .send(ClientViewEvent::Camera(tick));
    }
}

fn selected_sphere(definition: PhysicalBodyDefinition) -> SelectedSphere {
    let spheres = definition.spheres();
    spheres
        .upper_constraint()
        .map(|sphere| SelectedSphere {
            role: ClientCameraTargetSphereRole::UpperConstraint,
            center: sphere.center,
            radius: sphere.radius,
        })
        .unwrap_or_else(|| {
            let sphere = spheres.primary();
            SelectedSphere {
                role: ClientCameraTargetSphereRole::Primary,
                center: sphere.center,
                radius: sphere.radius,
            }
        })
}

fn target_samples_from_dynamic_path(
    scene: &holtburger_world::CollisionScene,
    path: &DynamicEntityPlacedPath,
    target_body: &mut ChildSpatialBody,
    pivot_offset: Vector3,
) -> Result<Vec<KinematicBoomTargetSample>> {
    let parent_waypoints = path
        .legs
        .iter()
        .map(|leg| ChildSpatialBodyWaypoint {
            parent_pose: leg.end.pose,
            end_fraction: leg.end_fraction,
        })
        .collect::<Vec<_>>();
    let child_path =
        target_body.reconcile_parent_path(scene, path.initial.pose, &parent_waypoints)?;
    let samples = child_path
        .legs()
        .iter()
        .map(|leg| {
            let pose = present_placed_motion_pose(&child_path, leg.end())?;
            Ok(KinematicBoomTargetSample {
                end_fraction: leg.end_fraction(),
                visual_pivot: visual_pivot_at_fraction(path, leg.end_fraction(), pivot_offset)?,
                target_seed: KinematicBoomTargetSeed {
                    placement: KinematicBoomPlacement {
                        pose,
                        cell: leg.end().placement().committed_cell(),
                    },
                },
            })
        })
        .collect::<Result<Vec<_>>>()?;
    ensure!(
        samples
            .last()
            .is_some_and(|sample| sample.end_fraction == 1.0),
        "client camera target path must end at one"
    );
    Ok(samples)
}

fn target_sample_from_pose(
    scene: &holtburger_world::CollisionScene,
    pose: WorldPosition,
    target_body: &mut ChildSpatialBody,
    pivot_offset: Vector3,
) -> Result<KinematicBoomTargetSample> {
    let child_path = target_body.reconcile_parent_path(
        scene,
        pose,
        &[ChildSpatialBodyWaypoint {
            parent_pose: pose,
            end_fraction: 1.0,
        }],
    )?;
    let point = child_path.final_point();
    let child_pose = present_placed_motion_pose(&child_path, point)?;
    Ok(KinematicBoomTargetSample {
        end_fraction: 1.0,
        visual_pivot: visual_pivot(pose, pivot_offset),
        target_seed: KinematicBoomTargetSeed {
            placement: KinematicBoomPlacement {
                pose: child_pose,
                cell: point.placement().committed_cell(),
            },
        },
    })
}

fn visual_pivot_at_fraction(
    path: &DynamicEntityPlacedPath,
    fraction: f32,
    pivot_offset: Vector3,
) -> Result<WorldPosition> {
    let mut start_fraction = 0.0;
    let mut start = path.initial.pose;
    for leg in &path.legs {
        if fraction <= leg.end_fraction {
            let span = leg.end_fraction - start_fraction;
            let local_fraction = if span > 0.0 {
                (fraction - start_fraction) / span
            } else {
                1.0
            };
            return Ok(visual_pivot(
                interpolate_pose(start, leg.end.pose, local_fraction)?,
                pivot_offset,
            ));
        }
        start_fraction = leg.end_fraction;
        start = leg.end.pose;
    }
    anyhow::bail!("client camera target fraction is outside the accepted parent path")
}

fn visual_pivot(mut pose: WorldPosition, pivot_offset: Vector3) -> WorldPosition {
    pose.coords = pose.coords + pose.rotation.rotate_vector(pivot_offset);
    pose
}

fn project_camera_outcome(
    active: &mut ActiveCamera,
    initial_visual_pivot: WorldPosition,
    duration_ms: f64,
    outcome: KinematicBoomOutcome,
) -> Result<ClientCameraTick> {
    ensure!(duration_ms.is_finite() && duration_ms > 0.0);
    active.sequence = active
        .sequence
        .checked_add(1)
        .context("client camera output sequence exhausted")?;
    let identity = active.identity;
    Ok(match outcome {
        KinematicBoomOutcome::Advanced {
            advance,
            clearance,
            diagnostics,
        } => match advance {
            KinematicBoomAdvance::Continuous { path } => {
                match serialize_kinematic_boom_path(
                    &path,
                    initial_visual_pivot,
                    active.controller.visual_pivot(),
                ) {
                    Ok(path) => ClientCameraTick::Advanced {
                        identity,
                        sequence: active.sequence,
                        duration_ms,
                        target_sphere_role: active.target_sphere_role,
                        clearance: clearance.map(|value| ClientCameraClearance {
                            projection_revision: value.revision,
                            radius: value.radius,
                        }),
                        desired_reach: active.controller.desired_reach(),
                        rendered_reach: active.controller.rendered_reach(),
                        path,
                        diagnostics: diagnostics.into(),
                    },
                    Err(_) => held_tick(
                        active,
                        ClientCameraHoldReason::PathProjection,
                        diagnostics,
                        duration_ms,
                    ),
                }
            }
            KinematicBoomAdvance::Reseeded { placement, reason } => ClientCameraTick::Reseeded {
                identity,
                sequence: active.sequence,
                duration_ms,
                target_sphere_role: active.target_sphere_role,
                clearance: clearance.map(|value| ClientCameraClearance {
                    projection_revision: value.revision,
                    radius: value.radius,
                }),
                desired_reach: active.controller.desired_reach(),
                rendered_reach: active.controller.rendered_reach(),
                path: stationary_kinematic_boom_path(placement, active.controller.visual_pivot()),
                reason: reason.into(),
                diagnostics: diagnostics.into(),
            },
        },
        KinematicBoomOutcome::Held {
            reason,
            diagnostics,
            ..
        } => held_tick(active, reason.into(), diagnostics, duration_ms),
    })
}

fn held_tick(
    active: &ActiveCamera,
    reason: ClientCameraHoldReason,
    diagnostics: KinematicBoomDiagnostics,
    duration_ms: f64,
) -> ClientCameraTick {
    ClientCameraTick::Held {
        identity: active.identity,
        sequence: active.sequence,
        // Held outputs have no newly solved transit, but retain the fixed tick duration so the
        // frontend can keep one receipt-clocked playback contract for every output kind.
        duration_ms,
        target_sphere_role: active.target_sphere_role,
        clearance: active
            .controller
            .committed_clearance()
            .map(|value| ClientCameraClearance {
                projection_revision: value.revision,
                radius: value.radius,
            }),
        desired_reach: active.controller.desired_reach(),
        rendered_reach: active.controller.rendered_reach(),
        path: stationary_kinematic_boom_path(
            active.controller.camera(),
            active.controller.visual_pivot(),
        ),
        reason,
        diagnostics: diagnostics.into(),
    }
}

fn validate_camera_request(request: ClientCameraStartRequest) -> Result<()> {
    ensure!(
        request.player_guid != Guid::NULL,
        "client camera player GUID must be non-null"
    );
    ensure!(
        request.initial_reach.is_finite()
            && request.minimum_reach.is_finite()
            && request.maximum_reach.is_finite()
            && request.minimum_reach >= 0.0
            && request.maximum_reach >= request.minimum_reach
            && (request.minimum_reach..=request.maximum_reach).contains(&request.initial_reach),
        "client camera reach policy is invalid"
    );
    validate_view_direction(request.view_direction)?;
    ensure!(
        request.cumulative_zoom_displacement.is_finite(),
        "client camera cumulative zoom must be finite"
    );
    validate_clearance(request.projection_revision, request.clearance_radius)
}

fn validate_view_direction(direction: [f32; 3]) -> Result<()> {
    ensure!(
        direction.iter().all(|value| value.is_finite())
            && direction.iter().map(|value| value * value).sum::<f32>() > f32::EPSILON,
        "client camera view direction must be finite and non-zero"
    );
    Ok(())
}

fn validate_clearance(revision: u64, radius: f32) -> Result<()> {
    ensure!(
        revision > 0,
        "client camera projection revision must be positive"
    );
    ensure!(
        radius.is_finite() && radius > 0.0,
        "client camera clearance radius must be finite and positive"
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::sync::Arc;

    use super::*;
    use crate::client::ClientState;
    use crate::client::builder::build_test_client;
    use crate::{SimulationSceneInterest, SimulationSceneOwnerAvailability};
    use holtburger_common::Sphere;
    use holtburger_content::{
        CellVolume, LandblockColliders, LandblockCollisionAsset, LandblockPlacement,
        TerrainCollisionSurface,
    };
    use holtburger_world::{
        CollisionScene, FreeSphereConfig, PhysicalBodyResponsePolicy, PhysicalCollisionFilter,
        PhysicalFriction, PhysicalRestitution, PhysicalSphereSet, PhysicalSurfaceMotion,
    };

    fn start_request(player_guid: Guid, entity_generation: u64) -> ClientCameraStartRequest {
        ClientCameraStartRequest {
            player_guid,
            entity_generation,
            initial_reach: 4.5,
            minimum_reach: 1.2,
            maximum_reach: 8.0,
            input_sequence: 0,
            view_direction: [0.0, 0.0, -1.0],
            cumulative_zoom_displacement: 0.0,
            projection_revision: 1,
            clearance_radius: 0.5,
        }
    }

    fn collision_snapshot(
        interest: SimulationSceneInterest,
        scene: CollisionScene,
    ) -> SimulationSceneSnapshot {
        let availability = interest
            .owners()
            .iter()
            .map(|&owner| {
                (
                    owner,
                    SimulationSceneOwnerAvailability::Resident { owner_revision: 1 },
                )
            })
            .collect::<BTreeMap<_, _>>();
        SimulationSceneSnapshot {
            revision: 1,
            content_source_generation: 1,
            interest,
            availability,
            scene: Arc::new(scene),
        }
    }

    #[test]
    fn camera_generation_guard_requires_the_exact_hydrated_player_instance() {
        let mut client = build_test_client(ClientState::InWorld);
        let guid = Guid(0x0102_0304);
        client.world.player.guid = guid;
        let missing = client
            .start_camera(start_request(guid, 0))
            .expect_err("an unhydrated player cannot establish a camera generation");
        assert!(missing.to_string().contains("target entity is unavailable"));

        client.world.seed_local_player_entity(
            guid,
            "Player",
            WorldPosition {
                landblock_id: Guid(0x1000_0001),
                coords: Vector3::zero(),
                rotation: holtburger_common::Quaternion::identity(),
            },
        );
        let generation = u64::from(client.world.player_entity().unwrap().instance_sequence());
        let aliased = client
            .start_camera(start_request(guid, generation + (u64::from(u16::MAX) + 1)))
            .expect_err("a generation that only matches after narrowing must remain stale");
        assert!(aliased.to_string().contains("stale entity generation"));
    }

    #[test]
    fn unavailable_collision_snapshot_advances_with_an_uncovered_proof() {
        let mut client = build_test_client(ClientState::InWorld);
        let guid = Guid(0x0102_0304);
        let player_pose = WorldPosition {
            landblock_id: Guid(0x1000_0001),
            coords: Vector3::new(96.0, 96.0, 1.0),
            rotation: holtburger_common::Quaternion::identity(),
        };
        client
            .world
            .seed_local_player_entity(guid, "Player", player_pose);

        let body_id = SpatialBodyId::LocalPlayer(guid);
        let definition = PhysicalBodyDefinition::free_sphere(
            PhysicalSphereSet::new(
                Sphere {
                    center: Vector3::zero(),
                    radius: 0.5,
                },
                None,
            )
            .expect("test sphere should be valid"),
            FreeSphereConfig {
                maximum_substep_distance: 0.25,
                maximum_substeps: 32,
                maximum_contact_passes: 8,
                separation_epsilon: 0.0005,
            },
        )
        .expect("test physical definition should be valid");
        client
            .world
            .scene
            .install_physical_body(
                body_id,
                definition,
                PhysicalCollisionFilter::ALL,
                PhysicalBodyResponsePolicy {
                    restitution: PhysicalRestitution::Inelastic,
                    friction: PhysicalFriction::DEFAULT,
                    surface_motion: PhysicalSurfaceMotion::Stable,
                    align_path: false,
                },
                None,
            )
            .expect("seeded local player should have a canonical body");

        let instance_sequence = client
            .world
            .player_entity()
            .expect("seeded player should be hydrated")
            .instance_sequence();
        let interest = SimulationSceneInterest::prefetch_neighborhood(
            player_pose,
            crate::CLIENT_COLLISION_OWNER_RADIUS,
        )
        .expect("test position should demand collision");
        let unavailable_owner = Guid(0x1000_ffff);
        let availability = interest
            .owners()
            .iter()
            .map(|&owner| (owner, SimulationSceneOwnerAvailability::Absent))
            .collect();
        let collision = SimulationSceneSnapshot {
            revision: 1,
            content_source_generation: 1,
            interest,
            availability,
            scene: Arc::new(CollisionScene::new()),
        };

        client
            .start_camera(ClientCameraStartRequest {
                player_guid: guid,
                entity_generation: u64::from(instance_sequence),
                initial_reach: 4.5,
                minimum_reach: 1.2,
                maximum_reach: 8.0,
                input_sequence: 0,
                view_direction: [0.0, 0.0, -1.0],
                cumulative_zoom_displacement: 0.0,
                projection_revision: 1,
                clearance_radius: 0.5,
            })
            .expect("camera registration should be accepted");
        let tick_duration = Duration::from_millis(30);
        let tick = client
            .advance_camera(Some(&collision), None, tick_duration)
            .expect("initial camera solve should not fail")
            .expect("initial camera solve should publish a tick");
        let diagnostics = match &tick {
            ClientCameraTick::Advanced { diagnostics, .. }
            | ClientCameraTick::Reseeded { diagnostics, .. }
            | ClientCameraTick::Held { diagnostics, .. } => diagnostics,
        };
        assert_eq!(
            diagnostics.collision_proof,
            ClientCameraCollisionProof::Uncovered {
                owner: unavailable_owner,
            },
            "unexpected uncovered camera tick: {tick:?}"
        );
    }

    #[test]
    fn camera_initializes_from_authoritative_deep_env_cell() {
        let mut client = build_test_client(ClientState::InWorld);
        let guid = Guid(0x0102_0304);
        let cell = Guid(0x1000_0100);
        let player_pose = WorldPosition {
            landblock_id: cell,
            coords: Vector3::new(20.0, 30.0, 4.0),
            rotation: holtburger_common::Quaternion::identity(),
        };
        client
            .world
            .seed_local_player_entity(guid, "Player", player_pose);
        let body_id = SpatialBodyId::LocalPlayer(guid);
        let definition = PhysicalBodyDefinition::free_sphere(
            PhysicalSphereSet::new(
                Sphere {
                    center: Vector3::zero(),
                    radius: 0.5,
                },
                None,
            )
            .unwrap(),
            FreeSphereConfig {
                maximum_substep_distance: 0.25,
                maximum_substeps: 32,
                maximum_contact_passes: 8,
                separation_epsilon: 0.0005,
            },
        )
        .unwrap();
        client
            .world
            .scene
            .install_physical_body(
                body_id,
                definition,
                PhysicalCollisionFilter::ALL,
                PhysicalBodyResponsePolicy {
                    restitution: PhysicalRestitution::Inelastic,
                    friction: PhysicalFriction::DEFAULT,
                    surface_motion: PhysicalSurfaceMotion::Stable,
                    align_path: false,
                },
                Some(cell),
            )
            .unwrap();

        let mut scene = CollisionScene::new();
        scene
            .insert(LandblockCollisionAsset {
                landblock_id: 0x1000_ffff,
                terrain: TerrainCollisionSurface::empty(),
                static_geometry: LandblockColliders {
                    colliders: Vec::new(),
                    cell_volumes: vec![CellVolume {
                        cell_selector: 0x0100,
                        placement: LandblockPlacement {
                            origin: Vector3::zero(),
                            orientation: holtburger_common::Quaternion::identity(),
                        },
                        planes: Vec::new(),
                        portals: Vec::new(),
                    }],
                },
            })
            .unwrap();
        let instance_sequence = client.world.player_entity().unwrap().instance_sequence();
        let interest = SimulationSceneInterest::prefetch_neighborhood(
            player_pose,
            crate::CLIENT_COLLISION_OWNER_RADIUS,
        )
        .unwrap();
        let collision = collision_snapshot(interest, scene);
        client
            .start_camera(ClientCameraStartRequest {
                player_guid: guid,
                entity_generation: u64::from(instance_sequence),
                initial_reach: 4.5,
                minimum_reach: 1.2,
                maximum_reach: 8.0,
                input_sequence: 0,
                view_direction: [0.0, 0.0, -1.0],
                cumulative_zoom_displacement: 0.0,
                projection_revision: 1,
                clearance_radius: 0.5,
            })
            .unwrap();

        let tick = client
            .advance_camera(Some(&collision), None, Duration::from_millis(30))
            .expect("deep indoor camera initialization must not fail")
            .expect("initialized camera should publish a tick");
        let path = match &tick {
            ClientCameraTick::Advanced { path, .. }
            | ClientCameraTick::Reseeded { path, .. }
            | ClientCameraTick::Held { path, .. } => path,
        };
        assert_eq!(path.initial.position.landblock_id, cell);
    }
}
