use anyhow::{Result, anyhow};
use holtburger_session::Session;
use holtburger_world::{BasicSpatialPhysics, SpatialPhysics, WorldBootstrap, WorldState};
use std::sync::Arc;
use tokio::sync::broadcast;

use super::{
    ClientRuntime, ClientState, TurbineChatState, auth::AuthState, movement::MovementSystem,
    simulation::ClientSimulationSystem,
};

#[derive(Clone)]
struct ServerEndpoint {
    host: String,
    port: u16,
}

#[derive(Clone)]
pub struct ClientRuntimeBuilder {
    account_name: String,
    server_endpoint: Option<ServerEndpoint>,
    world_bootstrap: Option<Arc<WorldBootstrap>>,
    spatial_physics: Option<Arc<dyn SpatialPhysics>>,
}

impl ClientRuntimeBuilder {
    pub fn new(account_name: impl Into<String>) -> Self {
        Self {
            account_name: account_name.into(),
            server_endpoint: None,
            world_bootstrap: None,
            spatial_physics: None,
        }
    }

    pub fn server(mut self, host: impl Into<String>, port: u16) -> Self {
        self.server_endpoint = Some(ServerEndpoint {
            host: host.into(),
            port,
        });
        self
    }

    pub fn world_bootstrap(mut self, bootstrap: Arc<WorldBootstrap>) -> Self {
        self.world_bootstrap = Some(bootstrap);
        self
    }

    pub fn spatial_physics(mut self, physics: Arc<dyn SpatialPhysics>) -> Self {
        self.spatial_physics = Some(physics);
        self
    }

    pub async fn connect(self) -> Result<ClientRuntime> {
        let endpoint = self.server_endpoint.clone().ok_or_else(|| {
            anyhow!("ClientRuntimeBuilder requires a server endpoint before connect()")
        })?;

        let target = tokio::net::lookup_host(format!("{}:{}", endpoint.host, endpoint.port))
            .await?
            .next()
            .ok_or_else(|| {
                anyhow!(
                    "Could not resolve server address: {}:{}",
                    endpoint.host,
                    endpoint.port
                )
            })?;

        let session = Session::new(target).await?;

        self.finish(session)
    }

    #[cfg(test)]
    pub(crate) fn build_with_session(self, session: Session) -> Result<ClientRuntime> {
        self.finish(session)
    }

    fn finish(self, session: Session) -> Result<ClientRuntime> {
        let world_bootstrap = self.world_bootstrap.ok_or_else(|| {
            anyhow!("ClientRuntimeBuilder requires world bootstrap before connect()")
        })?;
        let spatial_physics = self
            .spatial_physics
            .unwrap_or_else(|| Arc::new(BasicSpatialPhysics));

        let (wire_event_tx, _) = broadcast::channel(1024);
        let (client_view_event_tx, _) = broadcast::channel(256);

        Ok(ClientRuntime {
            session,
            world: WorldState::new_with_spatial_physics(world_bootstrap, spatial_physics),
            active_confirmation: None,
            active_busy_operation: None,
            state: ClientState::Connected,
            wire_event_tx,
            client_view_event_tx,
            command_rx: None,
            message_dump_dir: None,
            message_counter: 0,
            movement: MovementSystem::new(),
            simulation: ClientSimulationSystem::new(),
            auth: AuthState::new(self.account_name),
            turbine_chat: TurbineChatState::default(),
        })
    }
}

#[cfg(test)]
pub(crate) fn build_test_client(initial_state: ClientState) -> ClientRuntime {
    let (wire_event_tx, _) = broadcast::channel(1024);
    let (client_view_event_tx, _) = broadcast::channel(256);

    let mut client = ClientRuntime {
        session: Session::new_test(),
        world: WorldState::synthetic_with_spatial_physics(Arc::new(BasicSpatialPhysics)),
        active_confirmation: None,
        active_busy_operation: None,
        state: ClientState::Connected,
        wire_event_tx,
        client_view_event_tx,
        command_rx: None,
        message_dump_dir: None,
        message_counter: 0,
        movement: MovementSystem::new(),
        simulation: ClientSimulationSystem::new(),
        auth: AuthState::new("test".to_string()),
        turbine_chat: TurbineChatState::default(),
    };
    client.state = initial_state;
    client
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::{Guid, Vector3};
    use holtburger_world::{
        ContactState, SolveActorInput, SolvedActorKinematics, SpatialScene, SpatialSolveBatch,
        SpatialSolveRequest,
    };
    use smallvec::smallvec;
    use std::time::Duration;

    #[derive(Debug, Default)]
    struct MarkerSpatialPhysics;

    impl SpatialPhysics for MarkerSpatialPhysics {
        fn solve(
            &self,
            request: &SpatialSolveRequest,
            _scene: &mut SpatialScene,
        ) -> SpatialSolveBatch {
            SpatialSolveBatch {
                solved: request
                    .actors
                    .iter()
                    .map(|actor| SolvedActorKinematics {
                        actor_id: actor.actor_id,
                        pose: actor.pose,
                        velocity: actor.velocity,
                        omega: actor.omega,
                        contact: ContactState::Grounded,
                        projection_state: None,
                    })
                    .collect(),
                events: Default::default(),
            }
        }
    }

    #[test]
    fn runtime_builder_constructs_client_from_explicit_bootstrap() {
        let client = ClientRuntimeBuilder::new("test")
            .server("127.0.0.1", 9000)
            .world_bootstrap(Arc::new(WorldBootstrap::synthetic()))
            .build_with_session(Session::new_test())
            .expect("runtime builder should construct a client from explicit bootstrap");

        assert!(client.world.skill_table.skill_base_hash.is_empty());
    }

    #[test]
    fn runtime_builder_requires_world_bootstrap() {
        let error = ClientRuntimeBuilder::new("test")
            .server("127.0.0.1", 9000)
            .build_with_session(Session::new_test())
            .err()
            .expect("runtime builder should fail when world bootstrap is missing");

        assert!(error.to_string().contains("world bootstrap"));
    }

    #[test]
    fn runtime_builder_injects_custom_spatial_physics() {
        let client = ClientRuntimeBuilder::new("test")
            .server("127.0.0.1", 9000)
            .world_bootstrap(Arc::new(WorldBootstrap::synthetic()))
            .spatial_physics(Arc::new(MarkerSpatialPhysics))
            .build_with_session(Session::new_test())
            .expect("runtime builder should accept custom spatial physics");

        let request = SpatialSolveRequest {
            dt: Duration::from_millis(30),
            actors: smallvec![SolveActorInput {
                actor_id: Guid(0x5000_0001),
                pose: Default::default(),
                velocity: Vector3::zero(),
                omega: Vector3::zero(),
            }],
            local_drive: None,
        };
        let mut scene = SpatialScene::new_with_physics(Arc::clone(client.world.scene.physics()));

        let batch = Arc::clone(client.world.scene.physics()).solve(&request, &mut scene);

        assert_eq!(batch.solved.len(), 1);
        assert_eq!(batch.solved[0].contact, ContactState::Grounded);
    }
}
