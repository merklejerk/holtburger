//! `holtburger-3d` Live API frontend hooks (`h3d.selection`, `h3d.hud`) and wire projections.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use async_trait::async_trait;
use base64::Engine as _;
use holtburger_common::Guid;
use holtburger_live_api::hooks::{
    ApiError, ApiErrorCode, ApiResult, ClientHudHook, ClientUiHook, HudMarkerGeometry,
    HudMarkerSpec, HudMarkersUpsertRequest, HudScreenshotRequest, HudScreenshotResponse,
    HudToastLevel, HudToastRequest, UiPrintRequest, UiPrintStyle,
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

/// Projected 3D world marker ready for `WebGL2WorldMarkerPass` or `WebGL2WorldTrajectoryPass`.
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

/// Shared selection mirror synchronized between the h3d renderer and `LiveApiEngine`.
#[derive(Clone, Default)]
pub struct H3dSelectionState {
    selected: Arc<Mutex<Option<Guid>>>,
}

impl H3dSelectionState {
    pub fn get(&self) -> Option<Guid> {
        *self
            .selected
            .lock()
            .expect("selection state mutex poisoned")
    }

    pub fn set(&self, guid: Option<Guid>) -> bool {
        let mut guard = self
            .selected
            .lock()
            .expect("selection state mutex poisoned");
        if *guard == guid {
            return false;
        }
        *guard = guid;
        true
    }
}

/// `ClientUiHook` implementation bridging `ui.selection` and `ui.print` to h3d's renderer.
pub struct H3dUiHook {
    selection: H3dSelectionState,
    event_sink: Arc<dyn ClientEventSink>,
}

impl H3dUiHook {
    pub fn new(selection: H3dSelectionState, event_sink: Arc<dyn ClientEventSink>) -> Self {
        Self {
            selection,
            event_sink,
        }
    }
}

#[async_trait]
impl ClientUiHook for H3dUiHook {
    async fn get_selection(&self) -> ApiResult<Option<Guid>> {
        Ok(self.selection.get())
    }

    async fn set_selection(&self, guid: Option<Guid>) -> ApiResult<()> {
        self.event_sink
            .publish_client_event(ClientHostEvent::ApiHud(
                ClientApiHudEventWire::SelectEntity { guid },
            ))
            .map_err(|e| ApiError::runtime(e.to_string()))?;
        self.selection.set(guid);
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

/// `ClientHudHook` implementation bridging `h3d.hud` (toasts, 3D markers, screenshots) to h3d.
pub struct H3dHudHook {
    event_sink: Arc<dyn ClientEventSink>,
    screenshots: H3dScreenshotBroker,
}

impl H3dHudHook {
    pub fn new(event_sink: Arc<dyn ClientEventSink>, screenshots: H3dScreenshotBroker) -> Self {
        Self {
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
    let ttl_ms = marker.ttl_ms.clamp(1_000, 300_000);
    match marker.geometry {
        HudMarkerGeometry::Ring {
            position,
            radius,
            spin,
        } => {
            if !radius.is_finite() || radius <= 0.0 {
                return Err(ApiError::invalid(
                    "marker radius must be finite and positive",
                ));
            }
            let (scene_pos, render_scope_key) = world_position_to_scene_point(&position)
                .map_err(|e| ApiError::invalid(e.to_string()))?;
            Ok(ClientApiWorldMarkerWire::Ring {
                id: marker.id,
                namespace: marker.namespace,
                position: scene_pos,
                render_scope_key,
                radius: radius.min(25.0),
                spin,
                color: marker.color,
                ttl_ms,
            })
        }
        HudMarkerGeometry::Polyline { points } => {
            if points.len() < 2 {
                return Err(ApiError::invalid(
                    "polyline marker requires at least 2 points",
                ));
            }
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
                color: marker.color,
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
    async fn selection_hook_and_world_marker_projection_round_trip() {
        let sink = Arc::new(CaptureSink::default());
        let selection = H3dSelectionState::default();
        let ui = H3dUiHook::new(selection.clone(), sink.clone());
        let hud = H3dHudHook::new(sink.clone(), H3dScreenshotBroker::default());

        assert_eq!(ui.get_selection().await.unwrap(), None);
        assert!(selection.set(Some(Guid(0x8000_0010))));
        assert_eq!(ui.get_selection().await.unwrap(), Some(Guid(0x8000_0010)));

        ui.set_selection(Some(Guid(0x8000_0020))).await.unwrap();
        assert_eq!(selection.get(), Some(Guid(0x8000_0020)));

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
            ],
        })
        .await
        .unwrap();

        let events = sink.events.lock().unwrap();
        assert_eq!(events.len(), 2);
        match &events[1] {
            ClientHostEvent::ApiHud(ClientApiHudEventWire::UpsertMarkers { markers }) => {
                assert_eq!(markers.len(), 2);
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
            }
            other => panic!("expected UpsertMarkers, got {other:?}"),
        }
    }
}
