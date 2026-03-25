use anyhow::{Result, anyhow};
use holtburger_dat::file_type::{SkillTable, SpellTable, XpTable};
use holtburger_dat::{
    MountedResourceProvider, ResourceProvider, ResourceScope, ScopedResourceResolver,
};
use holtburger_session::Session;
use holtburger_world::WorldState;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::broadcast;

use super::{Client, ClientState, TurbineChatState, auth::AuthState, movement::MovementSystem};

type Provider = Arc<dyn ResourceProvider>;

#[derive(Clone, Copy)]
struct RequiredResourceAsset {
    id: u32,
    name: &'static str,
}

const REQUIRED_SKILL_TABLE: RequiredResourceAsset = RequiredResourceAsset {
    id: SkillTable::FILE_ID,
    name: "skill table",
};

const REQUIRED_SPELL_TABLE: RequiredResourceAsset = RequiredResourceAsset {
    id: SpellTable::FILE_ID,
    name: "spell table",
};

const REQUIRED_XP_TABLE: RequiredResourceAsset = RequiredResourceAsset {
    id: XpTable::FILE_ID,
    name: "XP table",
};

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
    mounted_providers: Vec<MountedResourceProvider>,
}

impl ClientBuilder {
    pub fn new(account_name: impl Into<String>) -> Self {
        Self {
            account_name: account_name.into(),
            dats_path: None,
            server_endpoint: None,
            mounted_providers: Vec::new(),
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

    pub fn mount_provider(mut self, scope: ResourceScope, provider: Provider) -> Self {
        self.mounted_providers
            .push(MountedResourceProvider::new(scope, provider));
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
            tokio::task::spawn_blocking(move || dat_builder.load_configured_resources());

        let (session_res, dat_res) = tokio::join!(session_future, dat_future);
        let session = session_res?;
        let mounted = dat_res?;

        self.finish(session, mounted)
    }

    #[cfg(test)]
    pub(crate) fn build_with_session(self, session: Session) -> Result<Client> {
        let mounted = self.load_configured_resources();
        self.finish(session, mounted)
    }

    fn load_configured_resources(&self) -> Arc<ScopedResourceResolver> {
        let mut mounted = self.mounted_providers.clone();

        let Some(dats_path) = self.dats_path.as_ref() else {
            return Arc::new(ScopedResourceResolver::from_mounted(mounted));
        };

        if !mounted
            .iter()
            .any(|provider| provider.scope == ResourceScope::Portal)
        {
            match holtburger_dat::open_provider(dats_path.join("portal")) {
                Ok(provider) => {
                    log::info!(
                        "Loaded portal data from {}",
                        dats_path.join("portal").display()
                    );
                    mounted.push(MountedResourceProvider::new(
                        ResourceScope::Portal,
                        provider,
                    ));
                }
                Err(error) => {
                    log::warn!("Could not load portal data: {}", error);
                }
            }
        }

        if !mounted
            .iter()
            .any(|provider| provider.scope == ResourceScope::Cell)
        {
            match holtburger_dat::open_provider(dats_path.join("cell")) {
                Ok(provider) => {
                    log::info!("Loaded cell data from {}", dats_path.join("cell").display());
                    mounted.push(MountedResourceProvider::new(ResourceScope::Cell, provider));
                }
                Err(error) => {
                    log::warn!("Could not load cell data: {}", error);
                }
            }
        }

        Arc::new(ScopedResourceResolver::from_mounted(mounted))
    }

    fn finish(self, session: Session, mounted: Arc<ScopedResourceResolver>) -> Result<Client> {
        self.validate_required_assets(&mounted)?;

        let (wire_event_tx, _) = broadcast::channel(1024);
        let (client_view_event_tx, _) = broadcast::channel(256);

        Ok(Client {
            session,
            world: WorldState::new(mounted)?,
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
            turbine_chat: TurbineChatState::default(),
        })
    }

    fn validate_required_assets(&self, mounted: &ScopedResourceResolver) -> Result<()> {
        if !mounted.exists_for::<SkillTable>() {
            return Err(missing_resource_asset_error(
                REQUIRED_SKILL_TABLE,
                self.dats_path.as_deref(),
            ));
        }

        if !mounted.exists_for::<SpellTable>() {
            return Err(missing_resource_asset_error(
                REQUIRED_SPELL_TABLE,
                self.dats_path.as_deref(),
            ));
        }

        if !mounted.exists_for::<XpTable>() {
            return Err(missing_resource_asset_error(
                REQUIRED_XP_TABLE,
                self.dats_path.as_deref(),
            ));
        }

        Ok(())
    }
}

fn missing_resource_asset_error(
    asset: RequiredResourceAsset,
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
    let (wire_event_tx, _) = broadcast::channel(1024);
    let (client_view_event_tx, _) = broadcast::channel(256);

    let mut client = Client {
        session: Session::new_test(),
        world: WorldState::synthetic(),
        active_confirmation: None,
        active_busy_operation: None,
        state: ClientState::Connected,
        wire_event_tx,
        client_view_event_tx,
        command_rx: None,
        message_dump_dir: None,
        message_counter: 0,
        movement: MovementSystem::new(),
        auth: AuthState::new("test".to_string()),
        turbine_chat: TurbineChatState::default(),
    };
    client.state = initial_state;
    client
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_dat::{DatFileType, HbaReader, HbaWriter};
    use tempfile::tempdir;

    fn repo_portal_hba_path() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../dats/portal.hba")
    }

    fn write_hba(path: &Path, ids: &[u32]) -> bool {
        let source_path = repo_portal_hba_path();
        if !source_path.is_file() {
            eprintln!(
                "skipping builder portal fixture test; missing repo-local {}",
                source_path.display()
            );
            return false;
        }

        let source =
            HbaReader::open(source_path).expect("repo portal.hba should open for builder tests");
        let mut writer = HbaWriter::new();
        writer.set_compression(false);

        for id in ids {
            let data = source
                .get_file(*id)
                .unwrap_or_else(|_| panic!("repo portal.hba should contain 0x{id:08X}"));
            writer
                .add(*id, DatFileType::from_id(*id) as u32, data)
                .expect("test HBA entry should be added");
        }

        writer.write(path).expect("test HBA should be written");

        true
    }

    #[test]
    fn portal_only_startup_succeeds_when_required_tables_are_present() {
        let dir = tempdir().expect("tempdir should be created");
        if !write_hba(
            &dir.path().join("portal.hba"),
            &[SkillTable::FILE_ID, SpellTable::FILE_ID, XpTable::FILE_ID],
        ) {
            return;
        }

        let client = ClientBuilder::new("test")
            .dats_path(dir.path().to_path_buf())
            .build_with_session(Session::new_test())
            .expect("portal-only startup should succeed");

        let resources = client
            .world
            .resources
            .as_ref()
            .expect("portal-only startup should mount scoped resources");

        assert!(resources.has_scope(ResourceScope::Portal));
        assert!(!resources.has_scope(ResourceScope::Cell));
    }

    #[test]
    fn startup_fails_when_required_skill_table_is_missing() {
        let dir = tempdir().expect("tempdir should be created");
        if !write_hba(
            &dir.path().join("portal.hba"),
            &[SpellTable::FILE_ID, XpTable::FILE_ID],
        ) {
            return;
        }

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
