use std::sync::{Arc, Mutex};

use holtburger_common::math::{Quaternion, Vector3};
use holtburger_common::position::WorldPosition;
use holtburger_common::{Guid, properties::PropertyString, properties::WorldObjectPropertyAccessors};
use holtburger_content::SoulEmoteCatalog;
use holtburger_dat::file_type::{MotionKinematics, SkillTable, SpellTable, XpTable};
use holtburger_world::{WorldBootstrap, WorldState, entity::Entity};

use crate::contracts::{
    AssetLookupRequestDto, AssetLookupResponseDto, AssetPayloadKindDto, BusyStateDto,
    FrontendStateFeedDto, HostBoundaryOverviewDto, InteractionModeDto, LifecyclePhaseDto,
    LifecycleStateDto, ModeHintDto, RuntimeBatchDto, RuntimeEntitySnapshotDto,
    RuntimeNotificationEnvelopeDto, RuntimeResidencyDto, SessionStateDto, Vec3Dto,
};

pub const RUNTIME_CHANNEL: &str = "runtime";
pub const RUNTIME_LIFECYCLE_TOPIC: &str = "lifecycle.state";
pub const RUNTIME_BATCH_TOPIC: &str = "runtime.batch";
pub const RUNTIME_NOTIFICATION_EVENT: &str = "runtime:notification";

const LOCAL_PLAYER_GUID: Guid = Guid(0x5000_0001);
const REMOTE_SCOUT_GUID: Guid = Guid(0x5000_0100);
const REMOTE_SENTINEL_GUID: Guid = Guid(0x5000_0200);
const PLAYER_GFX_ID: u32 = 0x0200_0001;
const SCOUT_GFX_ID: u32 = 0x0200_0002;
const SENTINEL_GFX_ID: u32 = 0x0200_0003;

#[derive(Default)]
pub struct HostBoundaryAdapter;

#[derive(Clone)]
pub struct HostRuntimeService {
    state: Arc<Mutex<HostRuntimeState>>,
}

struct HostRuntimeState {
    tick: u64,
    world: WorldState,
    selected_entity_id: Option<u64>,
}

impl HostRuntimeService {
    pub fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(HostRuntimeState::new())),
        }
    }

    pub fn lifecycle_state(&self) -> LifecycleStateDto {
        let state = self.state.lock().expect("host runtime state lock poisoned");
        HostBoundaryAdapter::lifecycle_state(&state)
    }

    pub fn runtime_batch(&self) -> RuntimeBatchDto {
        let state = self.state.lock().expect("host runtime state lock poisoned");
        HostBoundaryAdapter::runtime_batch(&state)
    }

    pub fn view_model_feed(&self) -> FrontendStateFeedDto {
        let state = self.state.lock().expect("host runtime state lock poisoned");
        HostBoundaryAdapter::view_model_feed(&state)
    }

    pub fn startup_notifications(&self) -> Vec<RuntimeNotificationEnvelopeDto> {
        let state = self.state.lock().expect("host runtime state lock poisoned");
        vec![
            HostBoundaryAdapter::lifecycle_notification(&state),
            HostBoundaryAdapter::runtime_notification(&state),
        ]
    }

    pub fn advance_runtime_notification(&self) -> RuntimeNotificationEnvelopeDto {
        let mut state = self.state.lock().expect("host runtime state lock poisoned");
        state.advance();
        HostBoundaryAdapter::runtime_notification(&state)
    }
}

impl HostRuntimeState {
    fn new() -> Self {
        let mut world = WorldState::new(Arc::new(WorldBootstrap::new(
            SkillTable::default(),
            SpellTable {
                id: SpellTable::FILE_ID,
                spells: Default::default(),
                spell_sets: Default::default(),
            },
            XpTable::default(),
            MotionKinematics::default(),
            SoulEmoteCatalog::default(),
        )));

        world.player.guid = LOCAL_PLAYER_GUID;
        world.add_entity(make_entity(
            LOCAL_PLAYER_GUID,
            "Browser Scout",
            make_world_position(Guid(0x0102_0003), 44.0, 84.0, 2.0, 0.0),
            PLAYER_GFX_ID,
        ));
        world.sync_player_position(make_world_position(Guid(0x0102_0003), 44.0, 84.0, 2.0, 0.0));
        let _ = world.set_player_vector(Vector3::new(0.8, 0.3, 0.0), Vector3::zero());

        world.add_entity(make_entity(
            REMOTE_SCOUT_GUID,
            "Survey Drudge",
            make_world_position(Guid(0x0102_001B), 132.0, 60.0, 0.0, 1.2),
            SCOUT_GFX_ID,
        ));
        world.add_entity(make_entity(
            REMOTE_SENTINEL_GUID,
            "Dungeon Sentinel",
            make_world_position(Guid(0x016C_0155), 12.0, 28.0, -6.0, 2.4),
            SENTINEL_GFX_ID,
        ));

        Self {
            tick: 1,
            world,
            selected_entity_id: Some(u32::from(REMOTE_SCOUT_GUID) as u64),
        }
    }

    fn advance(&mut self) {
        self.tick += 1;

        let orbit = self.tick as f32 * 0.18;
        let next_position = make_world_position(
            Guid(0x0102_0003),
            96.0 + orbit.cos() * 18.0,
            96.0 + orbit.sin() * 22.0,
            2.0 + (orbit * 0.5).sin() * 0.5,
            orbit + 0.6,
        );
        let tangent = Vector3::new(-orbit.sin() * 3.2, orbit.cos() * 3.8, 0.0);

        let _ = self.world.set_player_position(next_position);
        let _ = self.world.set_player_vector(tangent, Vector3::new(0.0, 0.0, 0.18));

        self.selected_entity_id = if self.tick.is_multiple_of(2) {
            Some(u32::from(REMOTE_SCOUT_GUID) as u64)
        } else {
            Some(u32::from(REMOTE_SENTINEL_GUID) as u64)
        };
    }
}

impl HostBoundaryAdapter {
    fn lifecycle_state(state: &HostRuntimeState) -> LifecycleStateDto {
        let residency = Self::runtime_residency(state);
        LifecycleStateDto {
            phase: LifecyclePhaseDto::Ready,
            active_mode_hint: Some(ModeHintDto::Browser),
            session_state: SessionStateDto::Unavailable,
            summary: format!(
                "Host boundary is online with a real app-local authoritative runtime feed. Focus landblock {:08X} is tracking {} runtime bodies.",
                residency.focus_landblock_id,
                residency.tracked_body_count,
            ),
        }
    }

    fn runtime_batch(state: &HostRuntimeState) -> RuntimeBatchDto {
        let mut entities = state.world.runtime_body_views();
        entities.sort_by_key(|view| match view.body_id {
            holtburger_world::SpatialBodyId::LocalPlayer(guid) => (0_u8, u32::from(guid) as u64),
            holtburger_world::SpatialBodyId::Entity(guid) => (1_u8, u32::from(guid) as u64),
            holtburger_world::SpatialBodyId::Ephemeral(id) => (2_u8, id),
        });

        RuntimeBatchDto {
            tick: state.tick,
            entities: entities
                .into_iter()
                .filter_map(|view| Self::runtime_entity_snapshot(state, view))
                .collect(),
            residency: Self::runtime_residency(state),
        }
    }

    fn view_model_feed(state: &HostRuntimeState) -> FrontendStateFeedDto {
        FrontendStateFeedDto {
            selected_entity_id: state.selected_entity_id,
            interaction_mode: InteractionModeDto::Inspect,
            busy_state: BusyStateDto::Idle,
        }
    }

    fn lifecycle_notification(state: &HostRuntimeState) -> RuntimeNotificationEnvelopeDto {
        RuntimeNotificationEnvelopeDto {
            channel: RUNTIME_CHANNEL,
            topic: RUNTIME_LIFECYCLE_TOPIC,
            lifecycle_state: Some(Self::lifecycle_state(state)),
            runtime_batch: None,
            view_model_feed: None,
        }
    }

    fn runtime_notification(state: &HostRuntimeState) -> RuntimeNotificationEnvelopeDto {
        RuntimeNotificationEnvelopeDto {
            channel: RUNTIME_CHANNEL,
            topic: RUNTIME_BATCH_TOPIC,
            lifecycle_state: None,
            runtime_batch: Some(Self::runtime_batch(state)),
            view_model_feed: Some(Self::view_model_feed(state)),
        }
    }

    pub fn asset_lookup(request: AssetLookupRequestDto) -> AssetLookupResponseDto {
        AssetLookupResponseDto {
            request_id: request.request_id,
            asset_id: request.asset_id.clone(),
            payload_kind: AssetPayloadKindDto::Json,
            payload: serde_json::json!({
                "assetId": request.asset_id,
                "priority": request.priority,
                "kind": "diagnostic-asset-metadata",
                "notes": [
                    "Asset lookup remains demand-driven while the runtime channel moves to authoritative world-backed snapshots.",
                    "Shared crate seams are not widened until real runtime or content pressure proves they belong below the app boundary."
                ]
            }),
        }
    }

    pub fn boundary_overview() -> HostBoundaryOverviewDto {
        HostBoundaryOverviewDto {
            runtime_channel: RUNTIME_CHANNEL,
            runtime_notification_event: RUNTIME_NOTIFICATION_EVENT,
            runtime_lifecycle_topic: RUNTIME_LIFECYCLE_TOPIC,
            runtime_batch_command: "get_runtime_batch",
            asset_lookup_command: "lookup_asset",
            notes: vec![
                "DTOs live in the app-local host crate, not shared crates.".to_string(),
                "Lifecycle state and runtime batches are emitted over one runtime notification event with typed topics."
                    .to_string(),
                "Phase 2 runtime batches are built from an authoritative WorldState plus runtime-body views instead of hardcoded DTO stubs."
                    .to_string(),
                "Asset lookup still returns typed diagnostic metadata so the asset channel remains demand-driven while content plumbing catches up."
                    .to_string(),
            ],
        }
    }

    fn runtime_entity_snapshot(
        state: &HostRuntimeState,
        view: holtburger_world::RuntimeSpatialBodyView,
    ) -> Option<RuntimeEntitySnapshotDto> {
        let guid = view.body_id.authoritative_guid()?;
        let entity = state.world.entities.get(guid)?;
        let position = view.authoritative_pose.unwrap_or(view.runtime_pose);

        Some(RuntimeEntitySnapshotDto {
            entity_id: u32::from(guid) as u64,
            label: entity
                .properties
                .get_string_prop(PropertyString::Name)
                .unwrap_or("Unknown")
                .to_string(),
            position: Vec3Dto {
                x: position.coords.x,
                y: position.coords.y,
                z: position.coords.z,
            },
            heading_radians: position.rotation.to_heading(),
            appearance_id: entity
                .gfx_id
                .map(|gfx_id| format!("gfx/{gfx_id:08X}"))
                .unwrap_or_else(|| format!("entity/{:08X}", u32::from(guid))),
            landblock_id: u32::from(position.landblock_id),
            cell_id: position.derived_outdoor_cell_id(),
            location_label: position.to_world_coords().to_string_with_precision(2),
            is_local_player: matches!(view.body_id, holtburger_world::SpatialBodyId::LocalPlayer(_)),
        })
    }

    fn runtime_residency(state: &HostRuntimeState) -> RuntimeResidencyDto {
        let focus_position = state
            .world
            .player_position()
            .or_else(|| {
                state
                    .selected_entity_id
                    .and_then(|entity_id| state.world.entities.get(Guid(entity_id as u32)).map(|entity| entity.position))
            })
            .unwrap_or_default();

        RuntimeResidencyDto {
            focus_entity_id: Some(u32::from(LOCAL_PLAYER_GUID) as u64),
            focus_landblock_id: u32::from(focus_position.landblock_id),
            focus_cell_id: focus_position.derived_outdoor_cell_id(),
            focus_location_label: focus_position.to_world_coords().to_string_with_precision(2),
            indoors: focus_position.is_indoors(),
            tracked_body_count: state.world.runtime_body_views().len(),
        }
    }
}

fn make_world_position(
    landblock_id: Guid,
    x: f32,
    y: f32,
    z: f32,
    heading_radians: f32,
) -> WorldPosition {
    WorldPosition {
        landblock_id,
        coords: Vector3::new(x, y, z),
        rotation: Quaternion::from_heading(heading_radians),
    }
    .normalize_outdoor_cell()
}

fn make_entity(guid: Guid, name: &str, position: WorldPosition, gfx_id: u32) -> Entity {
    let mut entity = Entity::new(guid, name.to_string(), position);
    entity.gfx_id = Some(gfx_id);
    entity
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn startup_notifications_include_lifecycle_and_runtime_batch_topics() {
        let runtime = HostRuntimeService::new();

        let notifications = runtime.startup_notifications();

        assert_eq!(notifications.len(), 2);
        assert_eq!(notifications[0].channel, RUNTIME_CHANNEL);
        assert_eq!(notifications[0].topic, RUNTIME_LIFECYCLE_TOPIC);
        assert!(notifications[0].lifecycle_state.is_some());
        assert!(notifications[0].runtime_batch.is_none());
        assert!(notifications[0].view_model_feed.is_none());

        assert_eq!(notifications[1].channel, RUNTIME_CHANNEL);
        assert_eq!(notifications[1].topic, RUNTIME_BATCH_TOPIC);
        assert!(notifications[1].lifecycle_state.is_none());
        assert!(notifications[1].runtime_batch.is_some());
        assert!(notifications[1].view_model_feed.is_some());
    }

    #[test]
    fn runtime_batch_exposes_authoritative_entities_and_residency_facts() {
        let runtime = HostRuntimeService::new();

        let batch = runtime.runtime_batch();

        assert_eq!(batch.tick, 1);
        assert_eq!(batch.entities.len(), 3);
        assert_eq!(batch.residency.focus_entity_id, Some(u32::from(LOCAL_PLAYER_GUID) as u64));
        assert_eq!(batch.residency.focus_landblock_id, 0x0102_000C);
        assert_eq!(batch.residency.focus_cell_id, Some(12));
        assert!(!batch.residency.indoors);
        assert_eq!(batch.residency.tracked_body_count, 3);

        let local_player = batch
            .entities
            .iter()
            .find(|entity| entity.is_local_player)
            .expect("local player entity should be present");
        assert_eq!(local_player.entity_id, u32::from(LOCAL_PLAYER_GUID) as u64);
        assert_eq!(local_player.label, "Browser Scout");
        assert_eq!(local_player.appearance_id, "gfx/02000001");
        assert_eq!(local_player.landblock_id, 0x0102_000C);
        assert_eq!(local_player.cell_id, Some(12));

        let indoor_entity = batch
            .entities
            .iter()
            .find(|entity| entity.entity_id == u32::from(REMOTE_SENTINEL_GUID) as u64)
            .expect("indoor sentinel entity should be present");
        assert_eq!(indoor_entity.label, "Dungeon Sentinel");
        assert_eq!(indoor_entity.landblock_id, 0x016C_0155);
        assert_eq!(indoor_entity.cell_id, None);
        assert!(indoor_entity.location_label.starts_with("Indoors"));
    }

    #[test]
    fn advancing_runtime_notification_increments_tick_and_updates_view_model_selection() {
        let runtime = HostRuntimeService::new();

        let initial_batch = runtime.runtime_batch();
        let first = runtime.advance_runtime_notification();
        let second = runtime.advance_runtime_notification();

        let first_batch = first
            .runtime_batch
            .expect("first runtime notification should carry a batch");
        let second_batch = second
            .runtime_batch
            .expect("second runtime notification should carry a batch");
        let first_view_model = first
            .view_model_feed
            .expect("first runtime notification should carry a view model feed");
        let second_view_model = second
            .view_model_feed
            .expect("second runtime notification should carry a view model feed");

        assert_eq!(first.topic, RUNTIME_BATCH_TOPIC);
        assert_eq!(first_batch.tick, initial_batch.tick + 1);
        assert_eq!(second_batch.tick, first_batch.tick + 1);
        assert_eq!(first_view_model.selected_entity_id, Some(u32::from(REMOTE_SCOUT_GUID) as u64));
        assert_eq!(second_view_model.selected_entity_id, Some(u32::from(REMOTE_SENTINEL_GUID) as u64));

        let initial_local_player = initial_batch
            .entities
            .iter()
            .find(|entity| entity.is_local_player)
            .expect("initial local player should be present");
        let advanced_local_player = first_batch
            .entities
            .iter()
            .find(|entity| entity.is_local_player)
            .expect("advanced local player should be present");

        assert_ne!(advanced_local_player.position.x, initial_local_player.position.x);
        assert_ne!(advanced_local_player.position.y, initial_local_player.position.y);
        assert_ne!(advanced_local_player.heading_radians, initial_local_player.heading_radians);
    }

    #[test]
    fn boundary_overview_and_asset_lookup_remain_runtime_asset_split() {
        let overview = HostBoundaryAdapter::boundary_overview();
        let asset = HostBoundaryAdapter::asset_lookup(AssetLookupRequestDto {
            request_id: "test-request".to_string(),
            asset_id: "gfx/02000001".to_string(),
            priority: crate::contracts::AssetPriorityDto::Bootstrap,
        });

        assert_eq!(overview.runtime_channel, RUNTIME_CHANNEL);
        assert_eq!(overview.runtime_notification_event, RUNTIME_NOTIFICATION_EVENT);
        assert_eq!(overview.runtime_lifecycle_topic, RUNTIME_LIFECYCLE_TOPIC);
        assert_eq!(overview.runtime_batch_command, "get_runtime_batch");
        assert_eq!(overview.asset_lookup_command, "lookup_asset");
        assert!(overview.notes.iter().any(|note| note.contains("authoritative WorldState")));

        assert_eq!(asset.request_id, "test-request");
        assert_eq!(asset.asset_id, "gfx/02000001");
        assert!(matches!(asset.payload_kind, AssetPayloadKindDto::Json));
        assert_eq!(asset.payload["kind"], "diagnostic-asset-metadata");
    }
}