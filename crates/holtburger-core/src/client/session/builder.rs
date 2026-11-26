use crate::client::collision::{ClientBodyPolicy, ClientSpatialSources};
use crate::client::movement_types::ClientMovementPolicy;
use crate::client::navigation_body::NavigationBodySource;
use anyhow::{Context, Result, anyhow};
use holtburger_content::{ContentRepository, SceneContentSource, SetupContentSource};
use holtburger_dat::file_type::{SecondaryAttributeTable, SkillTable, SpellTable, XpTable};
use holtburger_session::Session;
use holtburger_world::{WorldBootstrap, WorldState};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;
use tokio::sync::broadcast;

use crate::client::{
    ClientRuntime, ClientState, ConnectionSessionState, TurbineChatState,
    appraisal::ClientAppraisalTuning, character_selection::CharacterSelectionState,
    combat_tuning::ClientCombatTuning, movement::MovementSystem,
};

#[derive(Clone)]
struct ServerEndpoint {
    host: String,
    port: u16,
}

#[derive(Clone)]
pub struct ClientRuntimeBuilder {
    /// Optional external diagnostic collector, independent of world/view events.
    runtime_profile: Option<crate::client::runtime_profile::RuntimeProfileHandle>,
    barber_source: Option<Arc<dyn crate::client::barber::ClientBarberSource>>,
    account_name: String,
    server_endpoint: Option<ServerEndpoint>,
    world_bootstrap: Option<Arc<WorldBootstrap>>,
    spatial_sources: Option<ClientSpatialSources>,
    dynamic_script_source:
        Option<Arc<dyn crate::client::dynamic_script::ClientDynamicScriptSource>>,
    selection_envelope_source:
        Option<Arc<dyn crate::client::selection_envelope::ClientSelectionEnvelopeSource>>,
    combat_tuning: ClientCombatTuning,
    appraisal_tuning: ClientAppraisalTuning,
    /// Placement selected by this frontend; default clients retain append behavior.
    inventory_placement: crate::client::inventory_storage::InventoryPlacementPolicy,
    /// Whether an external 3D presentation must acknowledge the first pure-destination frame.
    /// Non-rendering clients retain the immediate adapter default.
    requires_external_world_reveal: bool,
    message_dump_dir: Option<PathBuf>,
}

impl ClientRuntimeBuilder {
    /// Attach a cold, optional authority diagnostic consumer.
    pub fn runtime_profile(
        mut self,
        handle: crate::client::runtime_profile::RuntimeProfileHandle,
    ) -> Self {
        self.runtime_profile = Some(handle);
        self
    }

    pub fn new(account_name: impl Into<String>) -> Self {
        Self {
            barber_source: None,
            runtime_profile: None,
            account_name: account_name.into(),
            server_endpoint: None,
            world_bootstrap: None,
            spatial_sources: None,
            dynamic_script_source: None,
            selection_envelope_source: None,
            combat_tuning: ClientCombatTuning::default(),
            appraisal_tuning: ClientAppraisalTuning::default(),
            inventory_placement: Default::default(),
            requires_external_world_reveal: false,
            message_dump_dir: None,
        }
    }

    /// Choose automatic inventory insertion and split placement for this frontend.
    pub fn inventory_placement(
        mut self,
        policy: crate::client::inventory_storage::InventoryPlacementPolicy,
    ) -> Self {
        self.inventory_placement = policy;
        self
    }

    /// Inject barber-only content preparation without eagerly loading its assets at startup.
    pub fn barber_source(
        mut self,
        source: Arc<dyn crate::client::barber::ClientBarberSource>,
    ) -> Self {
        self.barber_source = Some(source);
        self
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
        let secondary_attribute_table = content
            .read_asset::<SecondaryAttributeTable>("secondary attribute table")
            .context("failed to load secondary attribute table for client runtime")?;
        let spell_table = content
            .read_asset::<SpellTable>("spell table")
            .context("failed to load spell table for client runtime")?;
        let xp_table = content
            .read_asset::<XpTable>("XP table")
            .context("failed to load XP table for client runtime")?;
        let character_titles = content
            .read_character_title_catalog()
            .context("failed to load character-title catalog for client runtime")?;
        let contracts = content
            .read_contract_catalog()
            .context("failed to load contract catalog for client runtime")?;
        let motion_reference = content
            .read_motion_reference_data()
            .context("failed to build the motion contract for client runtime")?;
        let soul_emote_catalog = content
            .read_soul_emote_catalog()
            .context("failed to load soul emote catalog for client runtime")?;

        self.world_bootstrap = Some(Arc::new(WorldBootstrap {
            skill_table: Arc::new(skill_table),
            secondary_attribute_table: Arc::new(secondary_attribute_table),
            spell_table: Arc::new(spell_table),
            xp_table: Arc::new(xp_table),
            character_titles: Arc::new(character_titles),
            contracts: Arc::new(contracts),
            motion_sequences: Arc::new(motion_reference.motion_sequences),
            setup_dimensions: Arc::new(motion_reference.setup_dimensions),
            soul_emote_catalog: Arc::new(soul_emote_catalog),
        }));

        Ok(())
    }

    /// Selects physical body behavior with independently supplied environment geometry.
    pub fn physical_movement_source(
        mut self,
        scenes: Arc<dyn SceneContentSource>,
        source: Arc<dyn crate::client::collision::ClientBodySource>,
    ) -> Self {
        self.spatial_sources = Some(ClientSpatialSources {
            scenes,
            bodies: ClientBodyPolicy::Physical(source),
        });
        self
    }

    /// Selects point-validated local motion and reduced remote bodies.
    /// Environment geometry is supplied independently of this behavior.
    /// The frontend independently supplies bootstrap facts and chooses its static-data provider.
    pub fn navigation_movement_source(
        mut self,
        scenes: Arc<dyn SceneContentSource>,
        content: Arc<dyn SetupContentSource>,
    ) -> Self {
        self.spatial_sources = Some(ClientSpatialSources {
            scenes,
            bodies: ClientBodyPolicy::Navigation(Arc::new(NavigationBodySource::new(content))),
        });
        self
    }

    /// Injects immutable content preparation for core-owned object-state script timelines.
    pub fn dynamic_script_source(
        mut self,
        source: Arc<dyn crate::client::dynamic_script::ClientDynamicScriptSource>,
    ) -> Self {
        self.dynamic_script_source = Some(source);
        self
    }

    /// Injects immutable geometry preparation for host-owned selection broad phase.
    pub fn selection_envelope_source(
        mut self,
        source: Arc<dyn crate::client::selection_envelope::ClientSelectionEnvelopeSource>,
    ) -> Self {
        self.selection_envelope_source = Some(source);
        self
    }

    /// Replaces the shared targeted-combat policy for this client composition.
    pub fn combat_tuning(mut self, tuning: ClientCombatTuning) -> Self {
        self.combat_tuning = tuning;
        self
    }

    /// Replaces the shared appraisal pacing and recency policy for this client composition.
    pub fn appraisal_tuning(mut self, tuning: ClientAppraisalTuning) -> Self {
        self.appraisal_tuning = tuning;
        self
    }

    /// Requires a presentation adapter to acknowledge the first pure-destination frame before
    /// core sends ACE's `LoginComplete` action. Desktop 3D mode enables this; the TUI keeps the
    /// immediate non-rendering adapter.
    pub fn require_external_world_reveal(mut self) -> Self {
        self.requires_external_world_reveal = true;
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

        let resolved = tokio::net::lookup_host(format!("{}:{}", endpoint.host, endpoint.port))
            .await
            .map_err(|error| crate::client::ConnectionFailure {
                state: None,
                cause: crate::client::ConnectionFailureCause::Local {
                    operation: crate::client::ConnectionOperation::ResolveAddress,
                    diagnostic: error.to_string(),
                },
            })?;
        let target = select_ipv4_endpoint(resolved, &endpoint.host, endpoint.port)?;

        let session =
            Session::new(target)
                .await
                .map_err(|error| crate::client::ConnectionFailure {
                    state: None,
                    cause: crate::client::ConnectionFailureCause::Local {
                        operation: crate::client::ConnectionOperation::OpenSocket,
                        diagnostic: format!("{error:#}"),
                    },
                })?;

        self.finish(session)
    }

    #[cfg(test)]
    pub(crate) fn build_with_session(self, session: Session) -> Result<ClientRuntime> {
        self.ensure_message_dump_dir()?;
        self.finish(session)
    }

    /// Builds an isolated diagnostic client whose outgoing packets use an in-memory transport.
    #[cfg(feature = "runtime-fixture")]
    pub(in crate::client) fn build_fixture_client(self) -> Result<ClientRuntime> {
        self.finish(Session::new_test())
    }

    fn finish(self, session: Session) -> Result<ClientRuntime> {
        let world_bootstrap = self.world_bootstrap.ok_or_else(|| {
            anyhow!("ClientRuntimeBuilder requires world bootstrap before connect()")
        })?;
        let (client_view_event_tx, _) = broadcast::channel(4096);
        let client_view_event_tx = std::sync::Arc::new(client_view_event_tx);

        let movement_policy = self
            .spatial_sources
            .as_ref()
            .map_or(ClientMovementPolicy::Physical, |sources| {
                sources.bodies.movement_policy()
            });
        Ok(ClientRuntime {
            runtime_profile: self.runtime_profile,
            barber: crate::client::barber::BarberRuntime::new(self.barber_source),
            inventory_placement: self.inventory_placement,
            #[cfg(feature = "runtime-fixture")]
            runtime_fixture: None,
            session,
            world: WorldState::new(world_bootstrap),
            connection: Default::default(),
            appraisal: crate::client::appraisal::AppraisalSystem::new(self.appraisal_tuning),
            client_view_event_tx,
            dynamic_entity_time_origin: Instant::now(),
            command_rx: None,
            read_rx: None,
            automation_paused: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
            next_correlation_id: 0,
            message_dump_dir: self.message_dump_dir,
            movement: MovementSystem::with_policy(movement_policy),
            combat_engagement: Default::default(),
            combat_attribution: Default::default(),
            combat_tuning: self.combat_tuning,
            collision_coordinator: self.spatial_sources.map(|sources| {
                crate::client::collision::ClientCollisionCoordinator::with_policy(
                    sources.scenes,
                    sources.bodies,
                )
            }),
            dynamic_script_coordinator: self
                .dynamic_script_source
                .map(crate::client::dynamic_script::ClientDynamicScriptCoordinator::new),
            selection_envelope_coordinator: self
                .selection_envelope_source
                .map(crate::client::selection_envelope::ClientSelectionEnvelopeCoordinator::new),
            requires_external_world_reveal: self.requires_external_world_reveal,
            camera: crate::client::camera_service::ClientCameraService::new()?,
            precise_jump: crate::client::precise_jump_runtime::PreciseJumpRuntime::new(),
            targeted_jump: Default::default(),
            character_selection: CharacterSelectionState::new(self.account_name),
            turbine_chat: TurbineChatState::default(),
            conn: ConnectionSessionState::with_state(ClientState::Connected),
            character: Default::default(),
            portal: Default::default(),
        })
    }
}

/// Asheron's Call servers use IPv4 UDP; prefer the first IPv4 address when DNS or `/etc/hosts`
/// returns IPv6 first (such as `localhost` resolving to `::1` before `127.0.0.1`).
fn select_ipv4_endpoint(
    addresses: impl IntoIterator<Item = std::net::SocketAddr>,
    host: &str,
    port: u16,
) -> std::result::Result<std::net::SocketAddr, crate::client::ConnectionFailure> {
    let mut saw_any = false;
    for addr in addresses {
        saw_any = true;
        if addr.is_ipv4() {
            return Ok(addr);
        }
    }
    let diagnostic = if saw_any {
        format!("No IPv4 addresses for {host}:{port} (resolved only IPv6 addresses)")
    } else {
        format!("No addresses for {host}:{port}")
    };
    Err(crate::client::ConnectionFailure {
        state: None,
        cause: crate::client::ConnectionFailureCause::Local {
            operation: crate::client::ConnectionOperation::ResolveAddress,
            diagnostic,
        },
    })
}

#[cfg(any(test, feature = "test-support"))]
pub(crate) fn build_test_client(initial_state: ClientState) -> ClientRuntime {
    let (client_view_event_tx, _) = broadcast::channel(4096);
    let client_view_event_tx = std::sync::Arc::new(client_view_event_tx);

    ClientRuntime {
        runtime_profile: None,
        barber: crate::client::barber::BarberRuntime::new(None),
        inventory_placement: Default::default(),
        #[cfg(feature = "runtime-fixture")]
        runtime_fixture: None,
        session: Session::new_test(),
        world: WorldState::synthetic(),
        connection: Default::default(),
        appraisal: crate::client::appraisal::AppraisalSystem::new(ClientAppraisalTuning::default()),
        client_view_event_tx,
        dynamic_entity_time_origin: Instant::now(),
        command_rx: None,
        read_rx: None,
        automation_paused: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
        next_correlation_id: 0,
        message_dump_dir: None,
        movement: MovementSystem::with_policy(ClientMovementPolicy::Physical),
        combat_engagement: Default::default(),
        combat_attribution: Default::default(),
        combat_tuning: ClientCombatTuning::default(),
        collision_coordinator: None,
        dynamic_script_coordinator: None,
        selection_envelope_coordinator: None,
        requires_external_world_reveal: false,
        camera: crate::client::camera_service::ClientCameraService::new()
            .expect("test camera profile"),
        precise_jump: crate::client::precise_jump_runtime::PreciseJumpRuntime::new(),
        targeted_jump: Default::default(),
        character_selection: CharacterSelectionState::new("test".to_string()),
        turbine_chat: TurbineChatState::default(),
        conn: ConnectionSessionState::with_state(initial_state),
        character: Default::default(),
        portal: Default::default(),
    }
}

#[cfg(feature = "test-support")]
impl ClientRuntime {
    /// Constructs an in-memory `InWorld` runtime for downstream crate integration tests
    /// without requiring retail archives or a live game server.
    pub fn synthetic_in_world(account_name: impl Into<String>, world_name: Option<String>) -> Self {
        let mut runtime = build_test_client(ClientState::InWorld);
        runtime.character_selection = CharacterSelectionState::new(account_name.into());
        runtime.conn.world_name = world_name;
        runtime.movement = MovementSystem::with_policy(ClientMovementPolicy::Navigation);
        runtime
    }

    pub fn world_mut(&mut self) -> &mut WorldState {
        &mut self.world
    }

    pub fn emit_synthetic_view_event(&self, event: crate::ClientViewEvent) {
        let _ = self.client_view_event_tx.send(event);
    }

    pub fn view_event_sender(&self) -> broadcast::Sender<crate::ClientViewEvent> {
        (*self.client_view_event_tx).clone()
    }

    /// Runs the command, read-closure, and 30 Hz physics tick loops until `shutdown` resolves.
    pub async fn run_synthetic(mut self, mut shutdown: tokio::sync::oneshot::Receiver<()>) {
        let mut command_rx = self
            .command_rx
            .take()
            .expect("call create_handle() before run_synthetic()");
        let mut read_rx = self
            .read_rx
            .take()
            .expect("call create_handle() before run_synthetic()");
        let mut physics_tick = tokio::time::interval(std::time::Duration::from_millis(33));
        physics_tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let mut last_tick = Instant::now();

        loop {
            tokio::select! {
                _ = &mut shutdown => break,
                _ = physics_tick.tick() => {
                    let now = Instant::now();
                    let dt = now.duration_since(last_tick);
                    last_tick = now;
                    let profile = crate::client::runtime_profile::RuntimeScopeProfile::begin(
                        crate::client::runtime_profile::RuntimeProfileScope::PhysicsTick,
                        self.runtime_profile.as_ref(),
                    );
                    let _ = self.advance_physics_tick(
                        now,
                        dt,
                        profile,
                        #[cfg(feature = "runtime-fixture")]
                        None,
                    ).await;
                }
                Some(envelope) = command_rx.recv() => {
                    let _ = self.handle_command_envelope(envelope).await;
                }
                Some(read_fn) = read_rx.recv() => {
                    let ctx = crate::client::control::ClientReadContext::new(&self);
                    read_fn(&ctx);
                    for _ in 0..31 {
                        match read_rx.try_recv() {
                            Ok(next_fn) => next_fn(&ctx),
                            Err(_) => break,
                        }
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_content::ContentRepository;
    use holtburger_dat::file_type::{
        ChatPoseTable, EnumMapper, MotionTable, SecondaryAttributeTable, SkillTable, SpellTable,
        StringTable, XpTable,
    };
    use holtburger_dat::{
        DatFileType, EOR_LANGUAGE_NAMESPACE, EOR_PORTAL_NAMESPACE, HbaReader, HbaWriter,
        ResourceSource,
    };
    use std::path::Path;
    use tempfile::tempdir;

    const TEST_MOTION_TABLE_ID: u32 = 0x0900_0001;
    const TEST_ANIMATION_ID: u32 = 0x0300_0003;
    const TEST_STYLE: u32 = 0x8000_003D;

    /// One motion table holding a single walk cycle that plays the whole test animation.
    fn test_motion_table_bytes() -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&TEST_MOTION_TABLE_ID.to_le_bytes());
        bytes.extend_from_slice(&TEST_STYLE.to_le_bytes());
        bytes.extend_from_slice(&0u32.to_le_bytes()); // style defaults
        bytes.extend_from_slice(&1u32.to_le_bytes()); // cycles
        bytes.extend_from_slice(
            &MotionTable::cycle_key(TEST_STYLE, MotionTable::WALK_FORWARD_COMMAND).to_le_bytes(),
        );
        bytes.push(1); // one clip
        bytes.push(0); // bitfield
        bytes.push(0); // flags: no explicit velocity or omega
        bytes.push(0); // pad to the four-byte boundary the decoder aligns to
        bytes.extend_from_slice(&TEST_ANIMATION_ID.to_le_bytes());
        bytes.extend_from_slice(&0i32.to_le_bytes()); // low frame
        bytes.extend_from_slice(&(-1i32).to_le_bytes()); // open-ended high frame
        bytes.extend_from_slice(&30.0f32.to_le_bytes());
        bytes.extend_from_slice(&0u32.to_le_bytes()); // modifiers
        bytes.extend_from_slice(&0u32.to_le_bytes()); // links
        bytes
    }

    /// Two frames of authored root translation and no part frames, matching a pruned record.
    fn test_animation_bytes() -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&TEST_ANIMATION_ID.to_le_bytes());
        bytes.extend_from_slice(&1u32.to_le_bytes()); // POS_FRAMES
        bytes.extend_from_slice(&0u32.to_le_bytes()); // no parts
        bytes.extend_from_slice(&2u32.to_le_bytes());
        for _ in 0..2 {
            for value in [0.0f32, 0.5, 0.0, 1.0, 0.0, 0.0, 0.0] {
                bytes.extend_from_slice(&value.to_le_bytes());
            }
        }
        for _ in 0..2 {
            bytes.extend_from_slice(&0u32.to_le_bytes()); // no hooks
        }
        bytes
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

    fn test_secondary_attribute_table_bytes() -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&SecondaryAttributeTable::FILE_ID.to_le_bytes());
        for (attribute, divisor) in [(2_u32, 2_u32), (2, 1), (6, 1)] {
            for field in [0, 1, 0, divisor, attribute, 0] {
                bytes.extend_from_slice(&field.to_le_bytes());
            }
        }
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

    fn write_hba(path: &Path, ids: &[u32]) {
        let mut writer = HbaWriter::new();
        writer.set_compression(false);

        for id in ids {
            let mut data = id.to_le_bytes().to_vec();
            match *id {
                SkillTable::FILE_ID => data.extend_from_slice(&[0; 4]),
                SpellTable::FILE_ID => data.extend_from_slice(&[0; 8]),
                XpTable::FILE_ID => {
                    data.extend_from_slice(&[0; 20]);
                    for value in [10u32, 20, 30, 40] {
                        data.extend_from_slice(&value.to_le_bytes());
                    }
                    data.extend_from_slice(&50u64.to_le_bytes());
                    data.extend_from_slice(&60u32.to_le_bytes());
                }
                _ => panic!("unsupported synthetic bootstrap asset {id:#010x}"),
            }
            writer
                .add(
                    EOR_PORTAL_NAMESPACE,
                    *id,
                    DatFileType::from_id(*id) as u32,
                    data,
                )
                .expect("test HBA entry should be added");
        }

        for (namespace, id) in [
            (EOR_PORTAL_NAMESPACE, EnumMapper::FILE_ID),
            (EOR_LANGUAGE_NAMESPACE, StringTable::FILE_ID),
        ] {
            let mut data = id.to_le_bytes().to_vec();
            data.extend_from_slice(&0u32.to_le_bytes());
            data.extend_from_slice(&[0, 0]); // metadata byte and compressed empty count
            writer
                .add(namespace, id, DatFileType::from_id(id) as u32, data)
                .expect("character-title content test HBA entry should be added");
        }

        for (file_id, data) in [
            (TEST_MOTION_TABLE_ID, test_motion_table_bytes()),
            (TEST_ANIMATION_ID, test_animation_bytes()),
        ] {
            writer
                .add(
                    EOR_PORTAL_NAMESPACE,
                    file_id,
                    DatFileType::from_id(file_id) as u32,
                    data,
                )
                .expect("motion content test HBA entry should be added");
        }

        writer
            .add(
                EOR_PORTAL_NAMESPACE,
                ChatPoseTable::FILE_ID,
                DatFileType::from_id(ChatPoseTable::FILE_ID) as u32,
                test_chat_pose_table_bytes(),
            )
            .expect("chat pose table test HBA entry should be added");

        writer
            .add(
                EOR_PORTAL_NAMESPACE,
                SecondaryAttributeTable::FILE_ID,
                DatFileType::from_id(SecondaryAttributeTable::FILE_ID) as u32,
                test_secondary_attribute_table_bytes(),
            )
            .expect("secondary attribute table test HBA entry should be added");

        let mut contracts = holtburger_dat::file_type::ContractTable::FILE_ID
            .to_le_bytes()
            .to_vec();
        contracts.extend_from_slice(&[0, 0, 32, 0]);
        writer
            .add(
                EOR_PORTAL_NAMESPACE,
                holtburger_dat::file_type::ContractTable::FILE_ID,
                DatFileType::Table as u32,
                contracts,
            )
            .expect("contract fixture should be added");

        writer.write(path).expect("test HBA should be written");
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
        write_hba(
            &bundle_path,
            &[SkillTable::FILE_ID, SpellTable::FILE_ID, XpTable::FILE_ID],
        );

        // The motion contract is built from the repository's resource index, which only an
        // archive-backed repository populates.
        let repository =
            ContentRepository::from_hba_dir(dir.path()).expect("test repository should mount");
        let mut builder = ClientRuntimeBuilder::new("test").server("127.0.0.1", 9000);

        builder
            .load_assets(&repository)
            .expect("runtime builder should load assets from repository");

        let client = builder
            .build_with_session(Session::new_test())
            .expect("runtime builder should build after loading assets");

        assert_eq!(client.world.skill_table.id, SkillTable::FILE_ID);
        assert_eq!(client.world.xp_table.attribute_xp_list, vec![10]);
        assert_eq!(client.world.xp_table.character_level_xp_list, vec![50]);
        assert!(client.world.soul_emote_catalog.is_known_token("wave"));
        let walk = client
            .world
            .motion_sequences()
            .table(TEST_MOTION_TABLE_ID)
            .expect("motion contract should carry the bundled table")
            .cycle(TEST_STYLE, MotionTable::WALK_FORWARD_COMMAND)
            .expect("motion contract should carry the bundled walk cycle");
        assert_eq!(walk.clips.len(), 1);
        assert_eq!(walk.clips[0].animation.id, TEST_ANIMATION_ID);
        assert_eq!(
            walk.clips[0].high_frame, 1,
            "the open-ended window resolves"
        );
    }

    #[test]
    fn runtime_builder_load_assets_fails_when_repository_is_missing_required_asset() {
        let dir = tempdir().expect("tempdir should be created");
        let bundle_path = dir.path().join("bundle.hba");
        write_hba(&bundle_path, &[SpellTable::FILE_ID, XpTable::FILE_ID]);

        let archive = Arc::new(HbaReader::open(&bundle_path).expect("test HBA should open"));
        let repository = ContentRepository::from_mounts(vec![mounted_archive(archive)]);
        let mut builder = ClientRuntimeBuilder::new("test");
        let error = builder
            .load_assets(&repository)
            .expect_err("runtime builder should fail when a required asset is missing");

        assert!(error.to_string().contains("skill table"));
    }

    #[test]
    fn select_ipv4_endpoint_skips_leading_ipv6_addresses() {
        let ipv6: std::net::SocketAddr = "[::1]:9000".parse().unwrap();
        let ipv4: std::net::SocketAddr = "127.0.0.1:9000".parse().unwrap();
        let selected = select_ipv4_endpoint([ipv6, ipv4], "localhost", 9000)
            .expect("should select the IPv4 address");
        assert_eq!(selected, ipv4);
    }

    #[test]
    fn select_ipv4_endpoint_rejects_ipv6_only_and_empty_results() {
        let ipv6: std::net::SocketAddr = "[::1]:9000".parse().unwrap();
        let ipv6_only = select_ipv4_endpoint([ipv6], "ipv6.example", 9000)
            .expect_err("IPv6-only result should fail loudly");
        assert!(matches!(
            ipv6_only.cause,
            crate::client::ConnectionFailureCause::Local {
                operation: crate::client::ConnectionOperation::ResolveAddress,
                ..
            }
        ));
        assert!(ipv6_only.to_string().contains("No IPv4 addresses"));

        let empty = select_ipv4_endpoint([], "empty.example", 9000)
            .expect_err("empty result should fail loudly");
        assert!(empty.to_string().contains("No addresses"));
    }
}
