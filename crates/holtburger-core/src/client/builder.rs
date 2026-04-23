use anyhow::{Context, Result, anyhow};
use holtburger_content::ContentRepository;
use holtburger_dat::file_type::{MotionKinematics, SkillTable, SpellTable, XpTable};
use holtburger_session::Session;
use holtburger_world::{BasicSpatialPhysics, SpatialPhysics, WorldBootstrap, WorldState};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::broadcast;

use super::{
    ClientRuntime, ClientState, TurbineChatState, character_selection::CharacterSelectionState,
    movement::MovementSystem, simulation::ClientSimulationSystem,
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
    message_dump_dir: Option<PathBuf>,
}

impl ClientRuntimeBuilder {
    pub fn new(account_name: impl Into<String>) -> Self {
        Self {
            account_name: account_name.into(),
            server_endpoint: None,
            world_bootstrap: None,
            spatial_physics: None,
            message_dump_dir: None,
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

    pub fn load_assets(&mut self, content: &ContentRepository) -> Result<()> {
        let skill_table = content
            .read_asset::<SkillTable>("skill table")
            .context("failed to load skill table for client runtime")?;
        let spell_table = content
            .read_asset::<SpellTable>("spell table")
            .context("failed to load spell table for client runtime")?;
        let xp_table = content
            .read_asset::<XpTable>("XP table")
            .context("failed to load XP table for client runtime")?;
        let motion_kinematics = content
            .read_asset::<MotionKinematics>("motion kinematics table")
            .context("failed to load motion kinematics table for client runtime")?;
        let soul_emote_catalog = content
            .read_soul_emote_catalog()
            .context("failed to load soul emote catalog for client runtime")?;

        self.world_bootstrap = Some(Arc::new(WorldBootstrap::new(
            skill_table,
            spell_table,
            xp_table,
            motion_kinematics,
            soul_emote_catalog,
        )));

        Ok(())
    }

    pub fn spatial_physics(mut self, physics: Arc<dyn SpatialPhysics>) -> Self {
        self.spatial_physics = Some(physics);
        self
    }

    pub fn message_dump_dir(mut self, path: impl Into<PathBuf>) -> Self {
        self.message_dump_dir = Some(path.into());
        self
    }

    fn ensure_message_dump_dir(&self) -> Result<()> {
        if let Some(path) = &self.message_dump_dir {
            std::fs::create_dir_all(path).with_context(|| {
                format!(
                    "failed to create message dump directory: {}",
                    path.display()
                )
            })?;
        }

        Ok(())
    }

    pub async fn connect(self) -> Result<ClientRuntime> {
        self.ensure_message_dump_dir()?;

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
        self.ensure_message_dump_dir()?;
        self.finish(session)
    }

    fn finish(self, session: Session) -> Result<ClientRuntime> {
        let world_bootstrap = self.world_bootstrap.ok_or_else(|| {
            anyhow!("ClientRuntimeBuilder requires world bootstrap before connect()")
        })?;
        let spatial_physics = self
            .spatial_physics
            .unwrap_or_else(|| Arc::new(BasicSpatialPhysics));

        let (client_view_event_tx, _) = broadcast::channel(4096);

        Ok(ClientRuntime {
            session,
            world: WorldState::new_with_spatial_physics(world_bootstrap, spatial_physics),
            active_confirmation: None,
            active_busy_operation: None,
            state: ClientState::Connected,
            client_view_event_tx,
            command_rx: None,
            message_dump_dir: self.message_dump_dir,
            message_counter: 0,
            movement: MovementSystem::new(),
            simulation: ClientSimulationSystem::new(),
            character_selection: CharacterSelectionState::new(self.account_name),
            turbine_chat: TurbineChatState::default(),
        })
    }
}

#[cfg(test)]
pub(crate) fn build_test_client(initial_state: ClientState) -> ClientRuntime {
    let (client_view_event_tx, _) = broadcast::channel(4096);

    let mut client = ClientRuntime {
        session: Session::new_test(),
        world: WorldState::synthetic_with_spatial_physics(Arc::new(BasicSpatialPhysics)),
        active_confirmation: None,
        active_busy_operation: None,
        state: ClientState::Connected,
        client_view_event_tx,
        command_rx: None,
        message_dump_dir: None,
        message_counter: 0,
        movement: MovementSystem::new(),
        simulation: ClientSimulationSystem::new(),
        character_selection: CharacterSelectionState::new("test".to_string()),
        turbine_chat: TurbineChatState::default(),
    };
    client.state = initial_state;
    client
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::{Guid, Vector3};
    use holtburger_content::ContentRepository;
    use holtburger_dat::file_type::{
        ChatPoseTable, MotionKinematics, SkillTable, SpellTable, XpTable,
    };
    use holtburger_dat::{
        DatFileType, EOR_PORTAL_NAMESPACE, HOLTBURGER_CORE_NAMESPACE, HbaReader, HbaWriter,
        ResourceSource,
    };
    use holtburger_world::{
        ContactState, SolveBodyInput, SolvedBodyKinematics, SpatialScene, SpatialSolveBatch,
        SpatialSolveRequest,
    };
    use std::path::{Path, PathBuf};
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
                    .bodies
                    .iter()
                    .map(|body| {
                        let (velocity, omega) = match body.basis {
                            Some(holtburger_world::SolveProjectionBasis::Velocity {
                                velocity,
                                omega,
                            }) => (velocity, omega),
                            Some(holtburger_world::SolveProjectionBasis::GroundedMotion {
                                ..
                            })
                            | None => (Vector3::zero(), Vector3::zero()),
                        };

                        SolvedBodyKinematics {
                            body_id: body.body_id,
                            pose: body.pose,
                            velocity,
                            omega,
                            contact: ContactState::Grounded,
                            projection_state: None,
                        }
                    })
                    .collect(),
                events: Default::default(),
            }
        }
    }

    fn repo_assets_hba_path() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../dats/assets.hba")
    }

    fn test_motion_kinematics_bytes() -> Vec<u8> {
        let mut bytes = std::io::Cursor::new(Vec::new());
        MotionKinematics::new()
            .write(&mut bytes)
            .expect("test motion kinematics asset should write");
        bytes.into_inner()
    }

    fn test_chat_pose_table_bytes() -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&ChatPoseTable::FILE_ID.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        push_pstring_aligned(&mut bytes, "wave");
        push_pstring_aligned(&mut bytes, "Wave");
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        push_pstring_aligned(&mut bytes, "Wave");
        push_pstring_aligned(&mut bytes, "wave.");
        push_pstring_aligned(&mut bytes, "waves.");
        bytes
    }

    fn push_pstring_aligned(buf: &mut Vec<u8>, value: &str) {
        let bytes = value.as_bytes();
        buf.extend_from_slice(&(bytes.len() as u16).to_le_bytes());
        buf.extend_from_slice(bytes);
        while !buf.len().is_multiple_of(4) {
            buf.push(0);
        }
    }

    fn write_hba(path: &Path, ids: &[u32]) -> bool {
        let source_path = repo_assets_hba_path();
        if !source_path.is_file() {
            eprintln!(
                "skipping core builder fixture test; missing repo-local {}",
                source_path.display()
            );
            return false;
        }

        let source = match HbaReader::open(&source_path) {
            Ok(source) => source,
            Err(error) => panic!(
                "core builder fixture test requires repo-local {} to be a valid HBA v2 fixture: {}",
                source_path.display(),
                error
            ),
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

        writer
            .add(
                HOLTBURGER_CORE_NAMESPACE,
                MotionKinematics::FILE_ID,
                DatFileType::MotionKinematics as u32,
                test_motion_kinematics_bytes(),
            )
            .expect("motion kinematics test HBA entry should be added");

        writer
            .add(
                EOR_PORTAL_NAMESPACE,
                ChatPoseTable::FILE_ID,
                DatFileType::from_id(ChatPoseTable::FILE_ID) as u32,
                test_chat_pose_table_bytes(),
            )
            .expect("chat pose table test HBA entry should be added");

        writer.write(path).expect("test HBA should be written");

        true
    }

    fn mounted_archive(archive: Arc<HbaReader>) -> Arc<dyn ResourceSource> {
        archive
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
    fn runtime_builder_load_assets_reads_bootstrap_from_repository() {
        let dir = tempdir().expect("tempdir should be created");
        let bundle_path = dir.path().join("bundle.hba");
        if !write_hba(
            &bundle_path,
            &[SkillTable::FILE_ID, SpellTable::FILE_ID, XpTable::FILE_ID],
        ) {
            return;
        }

        let archive = Arc::new(HbaReader::open(&bundle_path).expect("test HBA should open"));
        let repository = ContentRepository::from_mounts(vec![mounted_archive(archive)]);
        let mut builder = ClientRuntimeBuilder::new("test").server("127.0.0.1", 9000);

        builder
            .load_assets(&repository)
            .expect("runtime builder should load assets from repository");

        let client = builder
            .build_with_session(Session::new_test())
            .expect("runtime builder should build after loading assets");

        assert!(!client.world.skill_table.skill_base_hash.is_empty());
        assert!(!client.world.spell_catalog.spells.is_empty());
        assert!(client.world.soul_emote_catalog.is_known_token("wave"));
        assert_eq!(client.world.motion_kinematics.id, MotionKinematics::FILE_ID);
    }

    #[test]
    fn runtime_builder_load_assets_fails_when_repository_is_missing_required_asset() {
        let dir = tempdir().expect("tempdir should be created");
        let bundle_path = dir.path().join("bundle.hba");
        if !write_hba(&bundle_path, &[SpellTable::FILE_ID, XpTable::FILE_ID]) {
            return;
        }

        let archive = Arc::new(HbaReader::open(&bundle_path).expect("test HBA should open"));
        let repository = ContentRepository::from_mounts(vec![mounted_archive(archive)]);
        let mut builder = ClientRuntimeBuilder::new("test");
        let error = builder
            .load_assets(&repository)
            .expect_err("runtime builder should fail when a required asset is missing");

        assert!(error.to_string().contains("skill table"));
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
            bodies: vec![SolveBodyInput::velocity(
                holtburger_world::SpatialBodyId::Entity(Guid(0x5000_0001)),
                Default::default(),
                holtburger_world::ContactState::Unknown,
                Vector3::zero(),
                Vector3::zero(),
            )],
            local_drive: None,
        };
        let mut scene = SpatialScene::new_with_physics(Arc::clone(client.world.scene.physics()));

        let batch = Arc::clone(client.world.scene.physics()).solve(&request, &mut scene);

        assert_eq!(batch.solved.len(), 1);
        assert_eq!(batch.solved[0].contact, ContactState::Grounded);
    }
}
