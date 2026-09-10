//! Independent camera servicing over immutable simulation publications.

use std::sync::{Arc, Mutex, mpsc};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use holtburger_world::WorldState;
use tokio::sync::{broadcast, mpsc as async_mpsc};

use super::camera::{ClientCameraRuntime, ClientCameraSceneInput, ClientCameraSettlement};
use super::{
    ClientCameraClearanceRequest, ClientCameraIdentity, ClientCameraIntentRequest,
    ClientCameraStartReceipt, ClientCameraStartRequest, ClientCameraUpdateReceipt, ClientViewEvent,
};

/// Camera cadence is independent of the simulation's admitted time and crowd work.
const CAMERA_INTERVAL: Duration = Duration::from_millis(16);

/// The single camera controller and its explicit world-owned servicing state.
struct CameraState {
    /// Owns placement, input sequencing, and lifecycle identity.
    controller: ClientCameraRuntime,
    /// World-owned permission, independent of whether query input has arrived. Activation
    /// settlement remains an explicit lifecycle operation while ordinary servicing is disabled.
    ordinary_input_allowed: bool,
    /// Latest coherent query input; absence delays solving but does not deny commands.
    input: Option<ClientCameraSceneInput>,
}

impl CameraState {
    /// Retires placement, registration, query input, and ordinary input permission together.
    fn reset(&mut self) {
        self.ordinary_input_allowed = false;
        self.input = None;
        self.controller.reset();
    }
}

/// Direct semantic input endpoint; registration and resets remain with the world owner.
#[derive(Clone)]
pub struct ClientCameraInputHandle {
    /// Shared only with camera servicing, never held during entity simulation.
    state: Arc<Mutex<CameraState>>,
}

impl ClientCameraInputHandle {
    /// Applies generation-checked orbit/zoom without entering the world command queue.
    pub fn set_intent(
        &self,
        request: ClientCameraIntentRequest,
    ) -> Result<ClientCameraUpdateReceipt> {
        let mut state = self.state.lock().expect("camera state poisoned");
        if !state.ordinary_input_allowed {
            return Ok(ClientCameraUpdateReceipt::IgnoredStale);
        }
        state.controller.set_intent(request)
    }

    /// Applies generation-checked projection clearance independently of entity simulation.
    pub fn set_clearance(
        &self,
        request: ClientCameraClearanceRequest,
    ) -> Result<ClientCameraUpdateReceipt> {
        let mut state = self.state.lock().expect("camera state poisoned");
        if !state.ordinary_input_allowed {
            return Ok(ClientCameraUpdateReceipt::IgnoredStale);
        }
        state.controller.set_clearance(request)
    }
}

/// World-owned lifecycle facade for one independently serviced camera.
pub(super) struct ClientCameraService {
    /// The same state is shared with the worker and direct input endpoint.
    state: Arc<Mutex<CameraState>>,
}

impl ClientCameraService {
    pub(super) fn new() -> Result<Self> {
        Ok(Self {
            state: Arc::new(Mutex::new(CameraState {
                controller: ClientCameraRuntime::new()?,
                ordinary_input_allowed: false,
                input: None,
            })),
        })
    }

    pub(super) fn input_handle(&self) -> ClientCameraInputHandle {
        ClientCameraInputHandle {
            state: Arc::clone(&self.state),
        }
    }

    pub(super) fn identity(&self) -> Option<ClientCameraIdentity> {
        self.state
            .lock()
            .expect("camera state poisoned")
            .controller
            .identity()
    }

    pub(super) fn start(
        &self,
        request: ClientCameraStartRequest,
        world: &WorldState,
        active_world: bool,
        events: &broadcast::Sender<ClientViewEvent>,
    ) -> Result<ClientCameraStartReceipt> {
        let mut state = self.state.lock().expect("camera state poisoned");
        let receipt = state.controller.start(request, world)?;
        state.ordinary_input_allowed = active_world;
        state.input = None;
        let _ = events.send(ClientViewEvent::CameraStarted(receipt));
        Ok(receipt)
    }

    pub(super) fn stop(&self, identity: ClientCameraIdentity) -> bool {
        self.state
            .lock()
            .expect("camera state poisoned")
            .controller
            .stop(identity)
    }

    pub(super) fn reset(&self) {
        self.state.lock().expect("camera state poisoned").reset();
    }

    /// Publishes an active-world tick and explicitly resumes ordinary camera servicing.
    pub(super) fn publish_active_world(&self, input: ClientCameraSceneInput) {
        let mut state = self.state.lock().expect("camera state poisoned");
        state.ordinary_input_allowed = true;
        state.controller.observe_target(&input);
        state.input = Some(input);
    }

    pub(super) fn settle_for_activation(
        &self,
        input: &ClientCameraSceneInput,
    ) -> Result<ClientCameraSettlement> {
        self.state
            .lock()
            .expect("camera state poisoned")
            .controller
            .settle_for_activation(input)
    }

    /// A dedicated worker cannot be starved by synchronous physics on an executor thread.
    pub(super) fn spawn(
        &self,
        events: broadcast::Sender<ClientViewEvent>,
    ) -> Result<ClientCameraWorker> {
        let state = Arc::clone(&self.state);
        let (stop, stopped) = mpsc::channel();
        let (failed, failures) = async_mpsc::unbounded_channel();
        let thread = thread::Builder::new()
            .name("client-camera".into())
            .spawn(move || {
                let mut previous = Instant::now();
                loop {
                    let wait = CAMERA_INTERVAL.saturating_sub(previous.elapsed());
                    match stopped.recv_timeout(wait) {
                        Ok(()) | Err(mpsc::RecvTimeoutError::Disconnected) => break,
                        Err(mpsc::RecvTimeoutError::Timeout) => {}
                    }
                    let now = Instant::now();
                    let duration = now.duration_since(previous);
                    previous = now;
                    let mut state = state.lock().expect("camera state poisoned");
                    let CameraState {
                        controller,
                        ordinary_input_allowed,
                        input,
                    } = &mut *state;
                    if !*ordinary_input_allowed {
                        continue;
                    }
                    let Some(input) = input.as_ref() else {
                        continue;
                    };
                    match controller.advance(input, duration) {
                        // Publish under the lifecycle lock: once reset returns, no old tick can follow.
                        Ok(Some(tick)) => {
                            let _ = events.send(ClientViewEvent::Camera(tick));
                        }
                        Ok(None) => {}
                        Err(error) => {
                            let _ = failed.send(error);
                            break;
                        }
                    }
                }
            })
            .context("starting client camera worker")?;
        Ok(ClientCameraWorker {
            stop,
            thread: Some(thread),
            failures,
            state: Arc::clone(&self.state),
        })
    }
}

/// Scoped worker lifetime, including failure delivery and cancellation-safe shutdown.
pub(super) struct ClientCameraWorker {
    /// Wakes the worker immediately on runtime cancellation or normal exit.
    stop: mpsc::Sender<()>,
    /// Joined before the client runtime leaves its run scope.
    thread: Option<JoinHandle<()>>,
    /// A solver failure or unexpected worker exit is a client runtime failure.
    failures: async_mpsc::UnboundedReceiver<anyhow::Error>,
    /// Retires direct handles when the owning runtime stops, including cancellation.
    state: Arc<Mutex<CameraState>>,
}

impl ClientCameraWorker {
    pub(super) async fn failure(&mut self) -> anyhow::Error {
        self.failures
            .recv()
            .await
            .unwrap_or_else(|| anyhow::anyhow!("client camera worker exited unexpectedly"))
    }
}

impl Drop for ClientCameraWorker {
    fn drop(&mut self) {
        let _ = self.stop.send(());
        if let Some(thread) = self.thread.take()
            && thread.join().is_err()
        {
            log::error!("client camera worker panicked");
        }
        // Teardown must also invalidate handles after a worker panic; no solving resumes here.
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        state.reset();
    }
}
