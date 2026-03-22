use anyhow::{Result, anyhow};
use holtburger_dat::ResourceProvider;
use holtburger_dat::file_type::{SkillTable, SpellTable, XpTable};
use holtburger_session::Session;
use holtburger_world::WorldState;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::broadcast;

use super::{Client, ClientState, auth::AuthState, movement::MovementSystem};

type Provider = Arc<dyn ResourceProvider>;

#[derive(Clone, Copy)]
struct RequiredPortalAsset {
    id: u32,
    name: &'static str,
}

const REQUIRED_PORTAL_ASSETS: [RequiredPortalAsset; 3] = [
    RequiredPortalAsset {
        id: SkillTable::FILE_ID,
        name: "skill table",
    },
    RequiredPortalAsset {
        id: SpellTable::FILE_ID,
        name: "spell table",
    },
    RequiredPortalAsset {
        id: XpTable::FILE_ID,
        name: "XP table",
    },
];

#[derive(Clone, Default)]
struct MountedDatasets {
    portal: Option<Provider>,
    cell: Option<Provider>,
}

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
        let dat_future =
            tokio::task::spawn_blocking(move || dat_builder.load_configured_datasets());

        let (session_res, dat_res) = tokio::join!(session_future, dat_future);
        let session = session_res?;
        let mounted = dat_res?;

        self.finish(session, mounted)
    }

    #[cfg(test)]
    pub(crate) fn build_with_session(self, session: Session) -> Result<Client> {
        let mounted = self.load_configured_datasets();
        self.finish(session, mounted)
    }

    fn load_configured_datasets(&self) -> MountedDatasets {
        let mut mounted = MountedDatasets {
            portal: self.portal_dat.clone(),
            cell: self.cell_dat.clone(),
        };

        let Some(dats_path) = self.dats_path.as_ref() else {
            return mounted;
        };

        if mounted.portal.is_none() {
            match holtburger_dat::open_provider(dats_path.join("portal")) {
                Ok(provider) => {
                    log::info!(
                        "Loaded portal data from {}",
                        dats_path.join("portal").display()
                    );
                    mounted.portal = Some(provider);
                }
                Err(error) => {
                    log::warn!("Could not load portal data: {}", error);
                }
            }
        }

        if mounted.cell.is_none() {
            match holtburger_dat::open_provider(dats_path.join("cell")) {
                Ok(provider) => {
                    log::info!("Loaded cell data from {}", dats_path.join("cell").display());
                    mounted.cell = Some(provider);
                }
                Err(error) => {
                    log::warn!("Could not load cell data: {}", error);
                }
            }
        }

        mounted
    }

    fn finish(self, session: Session, mounted: MountedDatasets) -> Result<Client> {
        if self.requires_mounted_dats() {
            self.validate_required_assets(&mounted)?;
        }

        let (wire_event_tx, _) = broadcast::channel(1024);
        let (client_view_event_tx, _) = broadcast::channel(256);

        Ok(Client {
            session,
            world: WorldState::new(mounted.portal, mounted.cell),
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

    fn validate_required_assets(&self, mounted: &MountedDatasets) -> Result<()> {
        let Some(portal) = mounted.portal.as_ref() else {
            return Err(missing_portal_asset_error(
                REQUIRED_PORTAL_ASSETS[0],
                self.dats_path.as_deref(),
            ));
        };

        for asset in REQUIRED_PORTAL_ASSETS {
            if !portal.exists(asset.id) {
                return Err(missing_portal_asset_error(asset, self.dats_path.as_deref()));
            }
        }

        Ok(())
    }
}

fn missing_portal_asset_error(
    asset: RequiredPortalAsset,
    dats_path: Option<&Path>,
) -> anyhow::Error {
    match dats_path {
        Some(path) => anyhow!(
            "Missing required portal asset {} (0x{:08X}) while loading client data from {}.",
            asset.name,
            asset.id,
            path.display()
        ),
        None => anyhow!(
            "Missing required portal asset {} (0x{:08X}) in the mounted portal dataset.",
            asset.name,
            asset.id
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

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_dat::HbaWriter;
    use tempfile::tempdir;

    fn write_hba(path: &Path, ids: &[u32]) {
        let mut writer = HbaWriter::new();
        writer.set_compression(false);

        for id in ids {
            writer
                .add(
                    *id,
                    holtburger_dat::DatFileType::from_id(*id) as u32,
                    vec![0],
                )
                .expect("test HBA entry should be added");
        }

        writer.write(path).expect("test HBA should be written");
    }

    #[test]
    fn portal_only_startup_succeeds_when_required_tables_are_present() {
        let dir = tempdir().expect("tempdir should be created");
        write_hba(
            &dir.path().join("portal.hba"),
            &[SkillTable::FILE_ID, SpellTable::FILE_ID, XpTable::FILE_ID],
        );

        let client = ClientBuilder::new("test")
            .dats_path(dir.path().to_path_buf())
            .build_with_session(Session::new_test())
            .expect("portal-only startup should succeed");

        assert!(client.world.portal_dat.is_some());
        assert!(client.world.cell_dat.is_none());
    }

    #[test]
    fn startup_fails_when_required_skill_table_is_missing() {
        let dir = tempdir().expect("tempdir should be created");
        write_hba(
            &dir.path().join("portal.hba"),
            &[SpellTable::FILE_ID, XpTable::FILE_ID],
        );

        let error = ClientBuilder::new("test")
            .dats_path(dir.path().to_path_buf())
            .build_with_session(Session::new_test())
            .err()
            .expect("startup should fail when the skill table is missing");

        assert!(error.to_string().contains("skill table"));
        assert!(error.to_string().contains("0x0E000004"));
    }

    #[test]
    fn startup_fails_when_no_portal_dataset_is_mounted() {
        let dir = tempdir().expect("tempdir should be created");

        let error = ClientBuilder::new("test")
            .dats_path(dir.path().to_path_buf())
            .build_with_session(Session::new_test())
            .err()
            .expect("startup should fail when the portal dataset is missing");

        assert!(error.to_string().contains("skill table"));
        assert!(error.to_string().contains("portal asset"));
    }
}
