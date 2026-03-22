use anyhow::{Result, anyhow};
use holtburger_dat::ResourceProvider;
use holtburger_session::Session;
use holtburger_world::WorldState;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::broadcast;

use super::{Client, ClientState, auth::AuthState, movement::MovementSystem};

type Provider = Arc<dyn ResourceProvider>;

#[derive(Clone)]
struct ServerEndpoint {
    host: String,
    port: u16,
}

#[derive(Clone)]
pub struct ClientBuilder {
    account_name: String,
    dats_path: Option<PathBuf>,
    server_endpoint: Option<ServerEndpoint>,
    portal_dat: Option<Provider>,
    cell_dat: Option<Provider>,
}

impl ClientBuilder {
    pub fn new(account_name: impl Into<String>) -> Self {
        Self {
            account_name: account_name.into(),
            dats_path: None,
            server_endpoint: None,
            portal_dat: None,
            cell_dat: None,
        }
    }

    pub fn server(mut self, host: impl Into<String>, port: u16) -> Self {
        self.server_endpoint = Some(ServerEndpoint {
            host: host.into(),
            port,
        });
        self
    }

    pub fn dats_path(mut self, dats_path: PathBuf) -> Self {
        self.dats_path = Some(dats_path);
        self
    }

    pub fn portal_dat(mut self, portal_dat: Provider) -> Self {
        self.portal_dat = Some(portal_dat);
        self
    }

    pub fn cell_dat(mut self, cell_dat: Provider) -> Self {
        self.cell_dat = Some(cell_dat);
        self
    }

    pub async fn connect(self) -> Result<Client> {
        let endpoint = self
            .server_endpoint
            .clone()
            .ok_or_else(|| anyhow!("ClientBuilder requires a server endpoint before connect()"))?;

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

        let session_future = Session::new(target);
        let dat_builder = self.clone();
        let dat_future = tokio::task::spawn_blocking(move || dat_builder.load_configured_dats());

        let (session_res, dat_res) = tokio::join!(session_future, dat_future);
        let session = session_res?;
        let (portal_dat, cell_dat) = dat_res?;

        self.finish(session, portal_dat, cell_dat)
    }

    #[cfg(test)]
    pub(crate) fn build_with_session(self, session: Session) -> Result<Client> {
        let (portal_dat, cell_dat) = self.load_configured_dats();
        self.finish(session, portal_dat, cell_dat)
    }

    fn load_configured_dats(&self) -> (Option<Provider>, Option<Provider>) {
        let mut portal_dat = self.portal_dat.clone();
        let mut cell_dat = self.cell_dat.clone();

        let Some(dats_path) = self.dats_path.as_ref() else {
            return (portal_dat, cell_dat);
        };

        if portal_dat.is_none() {
            match holtburger_dat::open_provider(dats_path.join("portal")) {
                Ok(provider) => {
                    log::info!(
                        "Loaded portal data from {}",
                        dats_path.join("portal").display()
                    );
                    portal_dat = Some(provider);
                }
                Err(error) => {
                    log::warn!("Could not load portal data: {}", error);
                }
            }
        }

        if cell_dat.is_none() {
            match holtburger_dat::open_provider(dats_path.join("cell")) {
                Ok(provider) => {
                    log::info!("Loaded cell data from {}", dats_path.join("cell").display());
                    cell_dat = Some(provider);
                }
                Err(error) => {
                    log::warn!("Could not load cell data: {}", error);
                }
            }
        }

        (portal_dat, cell_dat)
    }

    fn finish(
        self,
        session: Session,
        portal_dat: Option<Provider>,
        cell_dat: Option<Provider>,
    ) -> Result<Client> {
        if self.requires_mounted_dats() && (portal_dat.is_none() || cell_dat.is_none()) {
            return Err(missing_dat_error(self.dats_path.as_deref()));
        }

        let (wire_event_tx, _) = broadcast::channel(1024);
        let (client_view_event_tx, _) = broadcast::channel(256);

        Ok(Client {
            session,
            world: WorldState::new(portal_dat, cell_dat),
            active_confirmation: None,
            active_busy_operation: None,
            state: ClientState::Connected,
            wire_event_tx,
            client_view_event_tx,
            command_rx: None,
            message_dump_dir: None,
            message_counter: 0,
            movement: MovementSystem::new(),
            auth: AuthState::new(self.account_name),
        })
    }

    fn requires_mounted_dats(&self) -> bool {
        self.dats_path.is_some() || self.portal_dat.is_some() || self.cell_dat.is_some()
    }
}

fn missing_dat_error(dats_path: Option<&Path>) -> anyhow::Error {
    match dats_path {
        Some(path) => anyhow!(
            "Failed to load required DAT files from {}. Ensure portal.dat/hba and cell.dat/hba exist.",
            path.display()
        ),
        None => anyhow!(
            "Failed to load required DAT providers. Ensure both portal and cell providers are configured."
        ),
    }
}

#[cfg(test)]
pub(crate) fn build_test_client(initial_state: ClientState) -> Client {
    let mut client = ClientBuilder::new("test")
        .build_with_session(Session::new_test())
        .expect("test client should build");
    client.state = initial_state;
    client
}
