//! `holtburger-3d` Live API frontend hooks (`h3d.selection`, `h3d.hud`) and wire projections.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use async_trait::async_trait;
use base64::Engine as _;
use holtburger_common::Guid;
use holtburger_common::position::{MAP_DEGREE_ORIGIN, METERS_PER_MAP_DEGREE, WorldPosition};
use holtburger_live_api::hooks::{
    ApiError, ApiErrorCode, ApiResult, ClientHudHook, ClientUiHook, HudAudioCue, HudMarkerGeometry,
    HudMarkerSpec, HudMarkersUpsertRequest, HudPlayCueRequest, HudScreenshotRequest,
    HudScreenshotResponse, HudToastLevel, HudToastRequest, HudWaypointInput, HudWaypointView,
    MAX_MARKER_LABEL_CHARS, MAX_WAYPOINT_LABEL_CHARS, UiPrintRequest, UiPrintStyle,
    resolve_waypoint_input, sanitize_single_line_label, validate_marker_spec,
};
use serde::Serialize;
use tokio::sync::oneshot;

use crate::client_projection::ClientHostEvent;
use crate::host_event_sink::ClientEventSink;
use crate::placed_motion_presentation::world_position_to_scene_point;

/// Live API status summary forwarded to the h3d HUD pill.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientApiStateWire {
    pub active: bool,
    pub paused: bool,
    pub endpoint: Option<String>,
}

/// Projected outdoor navigation waypoint forwarded to the renderer's waypoint owner.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientApiWaypointWire {
    pub scene_x: f32,
    pub scene_z: f32,
    pub coords: String,
    pub label: String,
}

/// Projected 3D world marker ready for `WebGL2WorldMarkerPass`, `WebGL2WorldTrajectoryPass`,
/// or entity overlay callouts.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum ClientApiWorldMarkerWire {
    Ring {
        id: String,
        namespace: Option<String>,
        position: [f32; 3],
        render_scope_key: String,
        radius: f32,
        spin: bool,
        color: [f32; 4],
        ttl_ms: u32,
    },
    Polyline {
        id: String,
        namespace: Option<String>,
        points: Vec<[f32; 3]>,
        render_scope_keys: Vec<String>,
        color: [f32; 4],
        ttl_ms: u32,
    },
    Entity {
        id: String,
        namespace: Option<String>,
        guid: Guid,
        label: Option<String>,
        beacon: bool,
        through_wall: bool,
        color: [f32; 4],
        ttl_ms: u32,
    },
}

/// Frontend HUD and selection commands emitted by the Live API hooks toward the renderer.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum ClientApiHudEventWire {
    SelectEntity {
        guid: Option<Guid>,
    },
    Print {
        message: String,
        style: UiPrintStyle,
    },
    Toast {
        message: String,
        level: HudToastLevel,
    },
    UpsertMarkers {
        markers: Vec<ClientApiWorldMarkerWire>,
    },
    ClearMarkers {
        namespace: Option<String>,
    },
    SetWaypoint {
        waypoint: Option<ClientApiWaypointWire>,
    },
    PlayCue {
        cue: HudAudioCue,
    },
    CaptureScreenshot {
        request_id: String,
        max_width: u32,
        quality: f32,
    },
}

/// Correlates one-shot `GET /v1/screenshot` requests with renderer canvas capture replies.
#[derive(Clone, Default)]
pub struct H3dScreenshotBroker {
    next_id: Arc<AtomicU64>,
    pending: Arc<Mutex<HashMap<u64, oneshot::Sender<ApiResult<HudScreenshotResponse>>>>>,
}

impl H3dScreenshotBroker {
    fn register(&self) -> (u64, oneshot::Receiver<ApiResult<HudScreenshotResponse>>) {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        let (tx, rx) = oneshot::channel();
        self.pending
            .lock()
            .expect("screenshot broker mutex poisoned")
            .insert(id, tx);
        (id, rx)
    }

    fn cancel(&self, id: u64) {
        self.pending
            .lock()
            .expect("screenshot broker mutex poisoned")
            .remove(&id);
    }

    /// Immediately fails every in-flight screenshot request (called on disconnect/shutdown).
    pub fn cancel_all(&self) {
        self.pending
            .lock()
            .expect("screenshot broker mutex poisoned")
            .clear();
    }

    /// Completes a pending screenshot request from renderer IPC (base64 payload or error string).
    pub fn resolve(
        &self,
        request_id: &str,
        content_type: Option<String>,
        base64_data: Option<String>,
        error: Option<String>,
    ) {
        let Ok(id) = request_id.parse::<u64>() else {
            return;
        };
        let tx = self
            .pending
            .lock()
            .expect("screenshot broker mutex poisoned")
            .remove(&id);
        let Some(tx) = tx else {
            return;
        };
        let outcome = if let Some(message) = error {
            Err(ApiError::runtime(message))
        } else {
            match (content_type, base64_data) {
                (Some(ct), Some(b64)) => base64::engine::general_purpose::STANDARD
                    .decode(b64)
                    .map(|bytes| HudScreenshotResponse {
                        content_type: ct,
                        bytes,
                    })
                    .map_err(|e| ApiError::runtime(format!("invalid screenshot base64: {e}"))),
                _ => Err(ApiError::runtime("screenshot reply missing image data")),
            }
        };
        let _ = tx.send(outcome);
    }
}

#[derive(Default)]
struct FrontendMirrorInner {
    selection: Option<Guid>,
    waypoint: Option<HudWaypointView>,
}

/// Session-scoped mirror of renderer-owned UI state (`selection` and outdoor `waypoint`)
/// synchronized between the h3d renderer and `LiveApiEngine`.
#[derive(Clone, Default)]
pub struct H3dFrontendMirror {
    inner: Arc<Mutex<FrontendMirrorInner>>,
}

impl H3dFrontendMirror {
    pub fn get_selection(&self) -> Option<Guid> {
        self.inner
            .lock()
            .expect("frontend mirror mutex poisoned")
            .selection
    }

    pub fn set_selection(&self, guid: Option<Guid>) -> bool {
        let mut guard = self.inner.lock().expect("frontend mirror mutex poisoned");
        if guard.selection == guid {
            return false;
        }
        guard.selection = guid;
        true
    }

    pub fn get_waypoint(&self) -> Option<HudWaypointView> {
        self.inner
            .lock()
            .expect("frontend mirror mutex poisoned")
            .waypoint
            .clone()
    }

    pub fn set_waypoint(&self, waypoint: Option<HudWaypointView>) -> bool {
        let mut guard = self.inner.lock().expect("frontend mirror mutex poisoned");
        if guard.waypoint == waypoint {
            return false;
        }
        guard.waypoint = waypoint;
        true
    }

    /// Clears all mirrored session state symmetrically on disconnect or shutdown.
    pub fn clear(&self) {
        let mut guard = self.inner.lock().expect("frontend mirror mutex poisoned");
        guard.selection = None;
        guard.waypoint = None;
    }
}

/// Converts a renderer-reported outdoor `SceneMapPoint` (`scene_x`, `scene_z`) and display label
/// into a canonical `HudWaypointView`.
pub fn waypoint_from_scene_point(
    scene_x: f32,
    scene_z: f32,
    label: &str,
) -> Option<HudWaypointView> {
    if !scene_x.is_finite() || !scene_z.is_finite() {
        return None;
    }
    let lon = (scene_x / METERS_PER_MAP_DEGREE) - MAP_DEGREE_ORIGIN;
    let lat = (-scene_z / METERS_PER_MAP_DEGREE) - MAP_DEGREE_ORIGIN;
    let pos = WorldPosition::from_outdoor_degrees(lat, lon, 0.0)?;
    let custom_label = sanitize_single_line_label(Some(label), MAX_WAYPOINT_LABEL_CHARS, "label")
        .ok()
        .flatten();
    HudWaypointView::from_outdoor_position(pos, custom_label)
}

/// `ClientUiHook` implementation bridging `ui.selection` and `ui.print` to h3d's renderer.
pub struct H3dUiHook {
    mirror: H3dFrontendMirror,
    event_sink: Arc<dyn ClientEventSink>,
}

impl H3dUiHook {
    pub fn new(mirror: H3dFrontendMirror, event_sink: Arc<dyn ClientEventSink>) -> Self {
        Self { mirror, event_sink }
    }
}

#[async_trait]
impl ClientUiHook for H3dUiHook {
    async fn get_selection(&self) -> ApiResult<Option<Guid>> {
        Ok(self.mirror.get_selection())
    }

    async fn set_selection(&self, guid: Option<Guid>) -> ApiResult<()> {
        self.event_sink
            .publish_client_event(ClientHostEvent::ApiHud(
                ClientApiHudEventWire::SelectEntity { guid },
            ))
            .map_err(|e| ApiError::runtime(e.to_string()))?;
        self.mirror.set_selection(guid);
        Ok(())
    }

    async fn print(&self, req: UiPrintRequest) -> ApiResult<()> {
        self.event_sink
            .publish_client_event(ClientHostEvent::ApiHud(ClientApiHudEventWire::Print {
                message: req.message,
                style: req.style,
            }))
            .map_err(|e| ApiError::runtime(e.to_string()))
    }
}

/// `ClientHudHook` implementation bridging `h3d.hud` (toasts, 3D markers, waypoints, audio cues,
/// and screenshots) to h3d.
pub struct H3dHudHook {
    mirror: H3dFrontendMirror,
    event_sink: Arc<dyn ClientEventSink>,
    screenshots: H3dScreenshotBroker,
}

impl H3dHudHook {
    pub fn new(
        mirror: H3dFrontendMirror,
        event_sink: Arc<dyn ClientEventSink>,
        screenshots: H3dScreenshotBroker,
    ) -> Self {
        Self {
            mirror,
            event_sink,
            screenshots,
        }
    }
}

#[async_trait]
impl ClientHudHook for H3dHudHook {
    async fn toast(&self, req: HudToastRequest) -> ApiResult<()> {
        self.event_sink
            .publish_client_event(ClientHostEvent::ApiHud(ClientApiHudEventWire::Toast {
                message: req.message,
                level: req.level,
            }))
            .map_err(|e| ApiError::runtime(e.to_string()))
    }

    async fn upsert_markers(&self, req: HudMarkersUpsertRequest) -> ApiResult<()> {
        let mut projected = Vec::with_capacity(req.markers.len());
        for marker in req.markers {
            projected.push(project_world_marker(marker)?);
        }
        self.event_sink
            .publish_client_event(ClientHostEvent::ApiHud(
                ClientApiHudEventWire::UpsertMarkers { markers: projected },
            ))
            .map_err(|e| ApiError::runtime(e.to_string()))
    }

    async fn clear_markers(&self, namespace: Option<String>) -> ApiResult<()> {
        self.event_sink
            .publish_client_event(ClientHostEvent::ApiHud(
                ClientApiHudEventWire::ClearMarkers { namespace },
            ))
            .map_err(|e| ApiError::runtime(e.to_string()))
    }

    async fn get_waypoint(&self) -> ApiResult<Option<HudWaypointView>> {
        Ok(self.mirror.get_waypoint())
    }

    async fn set_waypoint(
        &self,
        waypoint: Option<HudWaypointInput>,
    ) -> ApiResult<Option<HudWaypointView>> {
        let (view, wire) = match waypoint {
            Some(input) => {
                let view = resolve_waypoint_input(&input)?;
                let (scene_pos, _) = world_position_to_scene_point(&view.position)
                    .map_err(|e| ApiError::invalid(e.to_string()))?;
                let wire = ClientApiWaypointWire {
                    scene_x: scene_pos[0],
                    scene_z: scene_pos[2],
                    coords: view.coords.clone(),
                    label: view.label.clone(),
                };
                (Some(view), Some(wire))
            }
            None => (None, None),
        };
        self.event_sink
            .publish_client_event(ClientHostEvent::ApiHud(
                ClientApiHudEventWire::SetWaypoint { waypoint: wire },
            ))
            .map_err(|e| ApiError::runtime(e.to_string()))?;
        self.mirror.set_waypoint(view.clone());
        Ok(view)
    }

    async fn play_cue(&self, req: HudPlayCueRequest) -> ApiResult<()> {
        self.event_sink
            .publish_client_event(ClientHostEvent::ApiHud(ClientApiHudEventWire::PlayCue {
                cue: req.cue,
            }))
            .map_err(|e| ApiError::runtime(e.to_string()))
    }

    async fn capture_screenshot(
        &self,
        req: HudScreenshotRequest,
    ) -> ApiResult<HudScreenshotResponse> {
        struct CancelGuard {
            broker: H3dScreenshotBroker,
            id: u64,
        }
        impl Drop for CancelGuard {
            fn drop(&mut self) {
                self.broker.cancel(self.id);
            }
        }

        let (id, rx) = self.screenshots.register();
        let _guard = CancelGuard {
            broker: self.screenshots.clone(),
            id,
        };
        self.event_sink
            .publish_client_event(ClientHostEvent::ApiHud(
                ClientApiHudEventWire::CaptureScreenshot {
                    request_id: id.to_string(),
                    max_width: req.max_width,
                    quality: req.quality,
                },
            ))
            .map_err(|err| ApiError::runtime(err.to_string()))?;
        match tokio::time::timeout(Duration::from_secs(5), rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err(ApiError::runtime("screenshot request cancelled")),
            Err(_) => Err(ApiError::new(
                ApiErrorCode::Timeout,
                "renderer did not deliver screenshot within 5s",
            )),
        }
    }
}

pub fn project_world_marker(marker: HudMarkerSpec) -> ApiResult<ClientApiWorldMarkerWire> {
    validate_marker_spec(&marker)?;
    let color = marker.color;
    let ttl_ms = marker.ttl_ms.clamp(1_000, 300_000);
    match marker.geometry {
        HudMarkerGeometry::Ring {
            position,
            radius,
            spin,
        } => {
            let (scene_pos, render_scope_key) = world_position_to_scene_point(&position)
                .map_err(|e| ApiError::invalid(e.to_string()))?;
            Ok(ClientApiWorldMarkerWire::Ring {
                id: marker.id,
                namespace: marker.namespace,
                position: scene_pos,
                render_scope_key,
                radius: radius.min(25.0),
                spin,
                color,
                ttl_ms,
            })
        }
        HudMarkerGeometry::Polyline { points } => {
            let mut scene_points = Vec::with_capacity(points.len());
            let mut scopes = Vec::with_capacity(points.len());
            for point in &points {
                let (scene_pos, scope) = world_position_to_scene_point(point)
                    .map_err(|e| ApiError::invalid(e.to_string()))?;
                scene_points.push(scene_pos);
                scopes.push(scope);
            }
            Ok(ClientApiWorldMarkerWire::Polyline {
                id: marker.id,
                namespace: marker.namespace,
                points: scene_points,
                render_scope_keys: scopes,
                color,
                ttl_ms,
            })
        }
        HudMarkerGeometry::Entity {
            guid,
            label,
            beacon,
            through_wall,
        } => {
            let label =
                sanitize_single_line_label(label.as_deref(), MAX_MARKER_LABEL_CHARS, "label")?;
            Ok(ClientApiWorldMarkerWire::Entity {
                id: marker.id,
                namespace: marker.namespace,
                guid,
                label,
                beacon,
                through_wall,
                color,
                ttl_ms,
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::position::WorldPosition;
    use holtburger_common::{Quaternion, Vector3};

    #[derive(Default)]
    struct CaptureSink {
        events: Mutex<Vec<ClientHostEvent>>,
    }

    impl ClientEventSink for CaptureSink {
        fn publish_client_event(&self, event: ClientHostEvent) -> anyhow::Result<()> {
            self.events.lock().unwrap().push(event);
            Ok(())
        }
    }

    #[tokio::test]
    async fn frontend_mirror_markers_waypoints_and_cues_round_trip() {
        let sink = Arc::new(CaptureSink::default());
        let mirror = H3dFrontendMirror::default();
        let ui = H3dUiHook::new(mirror.clone(), sink.clone());
        let hud = H3dHudHook::new(mirror.clone(), sink.clone(), H3dScreenshotBroker::default());

        assert_eq!(ui.get_selection().await.unwrap(), None);
        assert!(mirror.set_selection(Some(Guid(0x8000_0010))));
        assert_eq!(ui.get_selection().await.unwrap(), Some(Guid(0x8000_0010)));

        ui.set_selection(Some(Guid(0x8000_0020))).await.unwrap();
        assert_eq!(mirror.get_selection(), Some(Guid(0x8000_0020)));

        // Outdoor WorldPosition -> canonical scene coordinates + "outdoor" scope.
        let outdoor = WorldPosition::from_outdoor_frame(
            Guid(0x0102_0001),
            Vector3::new(10.0, 20.0, 5.0),
            Quaternion::identity(),
        );
        // Interior cell (>= 0x0100) -> hex renderScopeKey.
        let interior = WorldPosition {
            landblock_id: Guid(0x0102_0105),
            coords: Vector3::new(1.0, 2.0, 3.0),
            rotation: Quaternion::identity(),
        };

        hud.upsert_markers(HudMarkersUpsertRequest {
            markers: vec![
                HudMarkerSpec {
                    id: "r1".into(),
                    namespace: Some("bot".into()),
                    color: [0.2, 0.9, 0.3, 1.0],
                    ttl_ms: 5_000,
                    geometry: HudMarkerGeometry::Ring {
                        position: outdoor,
                        radius: 1.5,
                        spin: false,
                    },
                },
                HudMarkerSpec {
                    id: "p1".into(),
                    namespace: Some("bot".into()),
                    color: [0.1, 0.5, 1.0, 0.8],
                    ttl_ms: 5_000,
                    geometry: HudMarkerGeometry::Polyline {
                        points: vec![outdoor, interior],
                    },
                },
                HudMarkerSpec {
                    id: "e1".into(),
                    namespace: Some("combat".into()),
                    color: [1.0, 0.25, 0.2, 0.95],
                    ttl_ms: 10_000,
                    geometry: HudMarkerGeometry::Entity {
                        guid: Guid(0x8000_0099),
                        label: Some("  Kill 1st  ".into()),
                        beacon: true,
                        through_wall: false,
                    },
                },
            ],
        })
        .await
        .unwrap();

        // Reject out-of-range RGBA and null entity GUID before reaching renderer.
        assert!(
            project_world_marker(HudMarkerSpec {
                id: "bad-color".into(),
                namespace: None,
                color: [1.2, 0.0, 0.0, 1.0],
                ttl_ms: 5_000,
                geometry: HudMarkerGeometry::Entity {
                    guid: Guid(0x8000_0099),
                    label: None,
                    beacon: true,
                    through_wall: true,
                },
            })
            .is_err()
        );
        assert!(
            project_world_marker(HudMarkerSpec {
                id: "null-guid".into(),
                namespace: None,
                color: [1.0, 0.0, 0.0, 1.0],
                ttl_ms: 5_000,
                geometry: HudMarkerGeometry::Entity {
                    guid: Guid(0),
                    label: None,
                    beacon: true,
                    through_wall: true,
                },
            })
            .is_err()
        );

        // Waypoint set, readback, round-trip scene conversion, clear, and mirror.clear().
        let wp = hud
            .set_waypoint(Some(HudWaypointInput {
                coords: Some("42.3N, 15.8E".into()),
                position: None,
                label: Some("Holtburg".into()),
            }))
            .await
            .unwrap()
            .expect("waypoint set");
        assert_eq!(wp.coords, "42.3N, 15.8E");
        assert_eq!(wp.label, "Holtburg");
        assert_eq!(hud.get_waypoint().await.unwrap(), Some(wp.clone()));

        // Indoor waypoint is rejected.
        assert!(
            hud.set_waypoint(Some(HudWaypointInput {
                coords: None,
                position: Some(interior),
                label: None,
            }))
            .await
            .is_err()
        );

        hud.play_cue(HudPlayCueRequest {
            cue: HudAudioCue::Alert,
        })
        .await
        .unwrap();

        let events = sink.events.lock().unwrap();
        assert_eq!(events.len(), 4);
        match &events[1] {
            ClientHostEvent::ApiHud(ClientApiHudEventWire::UpsertMarkers { markers }) => {
                assert_eq!(markers.len(), 3);
                match &markers[0] {
                    ClientApiWorldMarkerWire::Ring {
                        position,
                        render_scope_key,
                        ..
                    } => {
                        assert_eq!(render_scope_key, "outdoor");
                        assert_eq!(*position, [192.0 + 10.0, 5.0, -(2.0 * 192.0 + 20.0)]);
                    }
                    other => panic!("expected ring, got {other:?}"),
                }
                match &markers[1] {
                    ClientApiWorldMarkerWire::Polyline {
                        render_scope_keys, ..
                    } => {
                        assert_eq!(render_scope_keys, &["outdoor", "0x01020105"]);
                    }
                    other => panic!("expected polyline, got {other:?}"),
                }
                match &markers[2] {
                    ClientApiWorldMarkerWire::Entity {
                        guid,
                        label,
                        beacon,
                        through_wall,
                        ..
                    } => {
                        assert_eq!(*guid, Guid(0x8000_0099));
                        assert_eq!(label.as_deref(), Some("Kill 1st"));
                        assert!(*beacon);
                        assert!(!*through_wall);
                    }
                    other => panic!("expected entity, got {other:?}"),
                }
            }
            other => panic!("expected UpsertMarkers, got {other:?}"),
        }
        match &events[2] {
            ClientHostEvent::ApiHud(ClientApiHudEventWire::SetWaypoint {
                waypoint: Some(wire),
            }) => {
                let round_tripped =
                    waypoint_from_scene_point(wire.scene_x, wire.scene_z, &wire.label)
                        .expect("round trip scene point");
                assert_eq!(round_tripped.coords, "42.3N, 15.8E");
                assert_eq!(round_tripped.label, "Holtburg");
            }
            other => panic!("expected SetWaypoint, got {other:?}"),
        }
        assert!(matches!(
            &events[3],
            ClientHostEvent::ApiHud(ClientApiHudEventWire::PlayCue {
                cue: HudAudioCue::Alert
            })
        ));
        drop(events);

        mirror.clear();
        assert_eq!(mirror.get_selection(), None);
        assert_eq!(mirror.get_waypoint(), None);
    }
}
