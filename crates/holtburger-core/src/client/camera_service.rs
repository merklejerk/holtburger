//! Physics-tick camera servicing with a direct, generation-checked input endpoint.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use anyhow::Result;
use holtburger_world::WorldState;
use tokio::sync::broadcast;

use super::camera::{ClientCameraRuntime, ClientCameraSceneInput, ClientCameraSettlement};
use super::{
    ClientCameraClearanceRequest, ClientCameraIdentity, ClientCameraIntentRequest,
    ClientCameraStartReceipt, ClientCameraStartRequest, ClientCameraUpdateReceipt, ClientViewEvent,
};

/// The single camera controller and its explicit world-owned servicing state.
struct CameraState {
    /// Owns placement, input sequencing, and lifecycle identity.
    controller: ClientCameraRuntime,
    /// World-owned permission, independent of whether query input has arrived. Activation
    /// settlement remains an explicit lifecycle operation while ordinary servicing is disabled.
    ordinary_input_allowed: bool,
}

impl CameraState {
    /// Retires placement, registration, and ordinary input permission together.
    fn reset(&mut self) {
        self.ordinary_input_allowed = false;
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

/// World-owned lifecycle facade for one physics-tick camera.
pub(super) struct ClientCameraService {
    /// The same state is shared with physics-tick solving and the direct input endpoint.
    state: Arc<Mutex<CameraState>>,
}

impl ClientCameraService {
    pub(super) fn new() -> Result<Self> {
        Ok(Self {
            state: Arc::new(Mutex::new(CameraState {
                controller: ClientCameraRuntime::new()?,
                ordinary_input_allowed: false,
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

    /// Solve exactly the accepted physics interval, including stationary camera input.
    pub(super) fn advance_world(
        &self,
        input: &ClientCameraSceneInput,
        duration: Duration,
    ) -> Result<Option<super::ClientCameraTick>> {
        let mut state = self.state.lock().expect("camera state poisoned");
        state.ordinary_input_allowed = true;
        state.controller.advance(input, duration)
    }

    /// Retire direct input handles when the client run ends, including cancellation.
    pub(super) fn run_scope(&self) -> CameraRunScope {
        CameraRunScope(Arc::clone(&self.state))
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
}

/// Cancellation-safe lifecycle guard; owns no thread or scheduling state.
pub(super) struct CameraRunScope(Arc<Mutex<CameraState>>);

impl Drop for CameraRunScope {
    fn drop(&mut self) {
        // Cleanup may run while unwinding a failed solve; retire handles even after poisoning.
        self.0
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .reset();
    }
}
