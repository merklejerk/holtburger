use anyhow::{Result, anyhow};
use holtburger_dat::file_type::{SkillTable, SpellTable, XpTable};
use holtburger_dat::{
    DatDatabase, EOR_PORTAL_NAMESPACE, HbaReader, MountedResourceProvider, ResourceProvider,
    ResourceScope, ScopedResourceResolver,
};
use holtburger_session::Session;
use holtburger_world::{BasicSpatialPhysics, SpatialPhysics, WorldState};
use std::ffi::OsStr;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::broadcast;

use super::{
    Client, ClientState, TurbineChatState, auth::AuthState, movement::MovementSystem,
    simulation::ClientSimulationSystem,
};

type Provider = Arc<dyn ResourceProvider>;

struct NamespacedHbaProvider {
    namespace: String,
    archive: Arc<HbaReader>,
}

impl ResourceProvider for NamespacedHbaProvider {
    fn get_file(&self, id: u32) -> holtburger_dat::Result<Vec<u8>> {
        self.archive.get_file_in_namespace(&self.namespace, id)
    }

    fn get_metadata(&self, id: u32) -> Option<holtburger_dat::FileMetadata> {
        self.archive.get_metadata_in_namespace(&self.namespace, id)
    }
}

#[derive(Clone, Copy)]
struct RequiredResourceAsset {
    namespace: &'static str,
    id: u32,
    name: &'static str,
}

const REQUIRED_SKILL_TABLE: RequiredResourceAsset = RequiredResourceAsset {
    namespace: EOR_PORTAL_NAMESPACE,
    id: SkillTable::FILE_ID,
    name: "skill table",
};

const REQUIRED_SPELL_TABLE: RequiredResourceAsset = RequiredResourceAsset {
    namespace: EOR_PORTAL_NAMESPACE,
    id: SpellTable::FILE_ID,
    name: "spell table",
};

const REQUIRED_XP_TABLE: RequiredResourceAsset = RequiredResourceAsset {
    namespace: EOR_PORTAL_NAMESPACE,
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
    spatial_physics: Option<Arc<dyn SpatialPhysics>>,
}

impl ClientBuilder {
    pub fn new(account_name: impl Into<String>) -> Self {
        Self {
            account_name: account_name.into(),
            dats_path: None,
            server_endpoint: None,
            mounted_providers: Vec::new(),
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

    pub fn dats_path(mut self, dats_path: PathBuf) -> Self {
        self.dats_path = Some(dats_path);
        self
    }

    pub fn mount_provider(mut self, scope: ResourceScope, provider: Provider) -> Self {
        self.mounted_providers
            .push(MountedResourceProvider::new(scope, provider));
        self
    }

    pub fn mount_provider_for_namespace(
        mut self,
        namespace: &str,
        provider: Provider,
    ) -> Result<Self> {
        self.mounted_providers
            .push(MountedResourceProvider::with_namespace(
                namespace, provider,
            )?);
        Ok(self)
    }

    pub fn spatial_physics(mut self, physics: Arc<dyn SpatialPhysics>) -> Self {
        self.spatial_physics = Some(physics);
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

        if dats_path.is_file() {
            self.discover_provider_mounts_from_path(dats_path, &mut mounted);
            return Arc::new(ScopedResourceResolver::from_mounted(mounted));
        }

        if dats_path.is_dir() {
            self.discover_hba_mounts_in_dir(dats_path, &mut mounted);
            self.discover_dat_mounts_in_dir(dats_path, &mut mounted);
        } else {
            log::warn!(
                "Configured dats path {} is neither a file nor a directory",
                dats_path.display()
            );
        }

        Arc::new(ScopedResourceResolver::from_mounted(mounted))
    }

    fn discover_provider_mounts_from_path(
        &self,
        path: &Path,
        mounted: &mut Vec<MountedResourceProvider>,
    ) {
        if path.extension() == Some(OsStr::new("hba")) {
            self.mount_hba_namespaces(path, mounted);
            return;
        }

        if path.extension() == Some(OsStr::new("dat")) {
            self.mount_dat_namespace(path, mounted);
            return;
        }

        let hba_path = path.with_extension("hba");
        if hba_path.exists() {
            self.mount_hba_namespaces(&hba_path, mounted);
        }

        let dat_path = path.with_extension("dat");
        if dat_path.exists() {
            self.mount_dat_namespace(&dat_path, mounted);
        }
    }

    fn discover_hba_mounts_in_dir(
        &self,
        dats_path: &Path,
        mounted: &mut Vec<MountedResourceProvider>,
    ) {
        let mut candidates = Vec::new();

        let entries = match fs::read_dir(dats_path) {
            Ok(entries) => entries,
            Err(error) => {
                log::warn!(
                    "Could not enumerate HBA archives under {}: {}",
                    dats_path.display(),
                    error
                );
                return;
            }
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension() != Some(OsStr::new("hba")) {
                continue;
            }

            let archive = match HbaReader::open(&path) {
                Ok(archive) => archive,
                Err(error) => {
                    log::warn!("Could not open HBA archive {}: {}", path.display(), error);
                    continue;
                }
            };

            let namespaces = archive
                .namespaces()
                .map(|namespace| namespace.to_string())
                .collect::<Vec<_>>();
            if namespaces.is_empty() {
                log::warn!(
                    "Skipping HBA archive {} because it exposes no namespaces",
                    path.display()
                );
                continue;
            }

            candidates.push((path, namespaces, Arc::new(archive)));
        }

        candidates.sort_by(|left, right| {
            right
                .1
                .len()
                .cmp(&left.1.len())
                .then_with(|| left.0.cmp(&right.0))
        });

        for (path, namespaces, archive) in candidates {
            for namespace in namespaces {
                if has_namespace_mount(mounted, &namespace) {
                    log::debug!(
                        "Skipping namespace '{}' from {} because it is already mounted",
                        namespace,
                        path.display()
                    );
                    continue;
                }

                let provider = Arc::new(NamespacedHbaProvider {
                    namespace: namespace.clone(),
                    archive: Arc::clone(&archive),
                }) as Provider;

                match MountedResourceProvider::with_namespace(&namespace, provider) {
                    Ok(mount) => {
                        log::info!("Mounted namespace '{}' from {}", namespace, path.display());
                        mounted.push(mount);
                    }
                    Err(error) => {
                        log::warn!(
                            "Could not mount namespace '{}' from {}: {}",
                            namespace,
                            path.display(),
                            error
                        );
                    }
                }
            }
        }
    }

    fn discover_dat_mounts_in_dir(
        &self,
        dats_path: &Path,
        mounted: &mut Vec<MountedResourceProvider>,
    ) {
        let entries = match fs::read_dir(dats_path) {
            Ok(entries) => entries,
            Err(error) => {
                log::warn!(
                    "Could not enumerate DAT archives under {}: {}",
                    dats_path.display(),
                    error
                );
                return;
            }
        };

        let mut paths = entries
            .flatten()
            .map(|entry| entry.path())
            .filter(|path| path.extension() == Some(OsStr::new("dat")))
            .collect::<Vec<_>>();
        paths.sort();

        for path in paths {
            self.mount_dat_namespace(&path, mounted);
        }
    }

    fn mount_hba_namespaces(&self, path: &Path, mounted: &mut Vec<MountedResourceProvider>) {
        let archive = match HbaReader::open(path) {
            Ok(archive) => archive,
            Err(error) => {
                log::warn!("Could not open HBA archive {}: {}", path.display(), error);
                return;
            }
        };

        let namespaces = archive
            .namespaces()
            .map(|namespace| namespace.to_string())
            .collect::<Vec<_>>();
        let archive = Arc::new(archive);

        for namespace in namespaces {
            if has_namespace_mount(mounted, &namespace) {
                continue;
            }

            let provider = Arc::new(NamespacedHbaProvider {
                namespace: namespace.clone(),
                archive: Arc::clone(&archive),
            }) as Provider;

            match MountedResourceProvider::with_namespace(&namespace, provider) {
                Ok(mount) => {
                    log::info!("Mounted namespace '{}' from {}", namespace, path.display());
                    mounted.push(mount);
                }
                Err(error) => {
                    log::warn!(
                        "Could not mount namespace '{}' from {}: {}",
                        namespace,
                        path.display(),
                        error
                    );
                }
            }
        }
    }

    fn mount_dat_namespace(&self, path: &Path, mounted: &mut Vec<MountedResourceProvider>) {
        let database = match DatDatabase::new(path) {
            Ok(database) => database,
            Err(error) => {
                log::warn!("Could not open DAT archive {}: {}", path.display(), error);
                return;
            }
        };

        let Some(namespace) = database.retail_namespace_hint() else {
            log::warn!(
                "Skipping DAT archive {} because its retail namespace could not be inferred",
                path.display()
            );
            return;
        };

        if has_namespace_mount(mounted, namespace) {
            return;
        }

        match MountedResourceProvider::with_namespace(namespace, Arc::new(database) as Provider) {
            Ok(mount) => {
                log::info!("Mounted namespace '{}' from {}", namespace, path.display());
                mounted.push(mount);
            }
            Err(error) => {
                log::warn!(
                    "Could not mount namespace '{}' from {}: {}",
                    namespace,
                    path.display(),
                    error
                );
            }
        }
    }

    fn finish(self, session: Session, mounted: Arc<ScopedResourceResolver>) -> Result<Client> {
        self.validate_required_assets(&mounted)?;
        let spatial_physics = self
            .spatial_physics
            .unwrap_or_else(|| Arc::new(BasicSpatialPhysics));

        let (wire_event_tx, _) = broadcast::channel(1024);
        let (client_view_event_tx, _) = broadcast::channel(256);

        Ok(Client {
            session,
            world: WorldState::new_with_spatial_physics(mounted, spatial_physics)?,
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

    fn validate_required_assets(&self, mounted: &ScopedResourceResolver) -> Result<()> {
        if !mounted.exists_in_namespace(REQUIRED_SKILL_TABLE.namespace, REQUIRED_SKILL_TABLE.id) {
            return Err(missing_resource_asset_error(
                REQUIRED_SKILL_TABLE,
                self.dats_path.as_deref(),
            ));
        }

        if !mounted.exists_in_namespace(REQUIRED_SPELL_TABLE.namespace, REQUIRED_SPELL_TABLE.id) {
            return Err(missing_resource_asset_error(
                REQUIRED_SPELL_TABLE,
                self.dats_path.as_deref(),
            ));
        }

        if !mounted.exists_in_namespace(REQUIRED_XP_TABLE.namespace, REQUIRED_XP_TABLE.id) {
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
            "Missing required asset {}:0x{:08X} ({}) while loading client data from {}.",
            asset.namespace,
            asset.id,
            asset.name,
            path.display()
        ),
        None => anyhow!(
            "Missing required asset {}:0x{:08X} ({}) in the mounted resource namespaces.",
            asset.namespace,
            asset.id,
            asset.name,
        ),
    }
}

fn has_namespace_mount(mounted: &[MountedResourceProvider], namespace: &str) -> bool {
    mounted
        .iter()
        .any(|provider| provider.namespace.as_str() == namespace)
}

#[cfg(test)]
pub(crate) fn build_test_client(initial_state: ClientState) -> Client {
    let (wire_event_tx, _) = broadcast::channel(1024);
    let (client_view_event_tx, _) = broadcast::channel(256);

    let mut client = Client {
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
    use holtburger_dat::{
        DatFileType, EOR_CELL_NAMESPACE, EOR_PORTAL_NAMESPACE, HbaReader, HbaWriter,
    };
    use holtburger_world::{
        ContactState, SolveActorInput, SolvedActorKinematics, SpatialScene, SpatialSolveBatch,
        SpatialSolveRequest,
    };
    use smallvec::smallvec;
    use std::time::Duration;
    use tempfile::tempdir;

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

    fn repo_assets_hba_path() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../dats/assets.hba")
    }

    fn write_hba(path: &Path, ids: &[u32], include_cell_namespace: bool) -> bool {
        let source_path = repo_assets_hba_path();
        if !source_path.is_file() {
            eprintln!(
                "skipping builder assets fixture test; missing repo-local {}",
                source_path.display()
            );
            return false;
        }

        let source = match HbaReader::open(&source_path) {
            Ok(source) => source,
            Err(error) => {
                eprintln!(
                    "skipping builder assets fixture test; repo-local {} is not an HBA v2 fixture yet: {}",
                    source_path.display(),
                    error
                );
                return false;
            }
        };
        let mut writer = HbaWriter::new();
        writer.set_compression(false);

        for id in ids {
            let data = source
                .get_file_in_namespace(EOR_PORTAL_NAMESPACE, *id)
                .unwrap_or_else(|_| panic!("repo assets.hba should contain eor/portal:0x{id:08X}"));
            writer
                .add(
                    EOR_PORTAL_NAMESPACE,
                    *id,
                    DatFileType::from_id(*id) as u32,
                    data,
                )
                .expect("test HBA entry should be added");
        }

        if include_cell_namespace {
            writer
                .add(
                    EOR_CELL_NAMESPACE,
                    0x0000_0001,
                    DatFileType::Landblock as u32,
                    vec![0xCC],
                )
                .expect("test cell namespace entry should be added");
        }

        writer.write(path).expect("test HBA should be written");

        true
    }

    #[test]
    fn portal_only_startup_succeeds_when_required_tables_are_present() {
        let dir = tempdir().expect("tempdir should be created");
        if !write_hba(
            &dir.path().join("bundle.hba"),
            &[SkillTable::FILE_ID, SpellTable::FILE_ID, XpTable::FILE_ID],
            false,
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
            .expect("portal-only startup should mount namespaced resources");

        assert!(resources.has_namespace(EOR_PORTAL_NAMESPACE));
        assert!(!resources.has_namespace(EOR_CELL_NAMESPACE));
    }

    #[test]
    fn startup_discovers_namespaces_from_hba_contents_not_filename() {
        let dir = tempdir().expect("tempdir should be created");
        if !write_hba(
            &dir.path().join("anything.hba"),
            &[SkillTable::FILE_ID, SpellTable::FILE_ID, XpTable::FILE_ID],
            true,
        ) {
            return;
        }

        let client = ClientBuilder::new("test")
            .dats_path(dir.path().to_path_buf())
            .build_with_session(Session::new_test())
            .expect("startup should discover HBA namespaces from archive contents");

        let resources = client
            .world
            .resources
            .as_ref()
            .expect("startup should mount namespaced resources");

        assert!(resources.has_namespace(EOR_PORTAL_NAMESPACE));
        assert!(resources.has_namespace(EOR_CELL_NAMESPACE));
    }

    #[test]
    fn startup_fails_when_required_skill_table_is_missing() {
        let dir = tempdir().expect("tempdir should be created");
        if !write_hba(
            &dir.path().join("bundle.hba"),
            &[SpellTable::FILE_ID, XpTable::FILE_ID],
            false,
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
        assert!(error.to_string().contains(EOR_PORTAL_NAMESPACE));
    }

    #[test]
    fn builder_injects_custom_spatial_physics() {
        let dir = tempdir().expect("tempdir should be created");
        if !write_hba(
            &dir.path().join("bundle.hba"),
            &[SkillTable::FILE_ID, SpellTable::FILE_ID, XpTable::FILE_ID],
            false,
        ) {
            return;
        }

        let client = ClientBuilder::new("test")
            .dats_path(dir.path().to_path_buf())
            .spatial_physics(Arc::new(MarkerSpatialPhysics))
            .build_with_session(Session::new_test())
            .expect("builder should accept custom spatial physics");

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
