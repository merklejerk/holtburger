use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use holtburger_common::Guid;
use holtburger_common::math::{Quaternion, Vector3};
use holtburger_common::position::WorldPosition;
use holtburger_content::{ContentRepository, SoulEmoteCatalog};
use holtburger_dat::file_type::EnvCell;
use holtburger_dat::file_type::{MotionKinematics, SkillTable, SpellTable, XpTable};
use holtburger_dat::landblock::CellLandblock;
use holtburger_dat::{EOR_CELL_NAMESPACE, EOR_PORTAL_NAMESPACE, ResourceKey};
use holtburger_world::entity::Entity;
use holtburger_world::{WorldBootstrap, WorldState};

use crate::contracts::{
    AssetLookupRequestDto, AssetLookupResponseDto, AssetPayloadKindDto, BusyStateDto,
    CameraHintAckDto, CameraHintDto, FrontendStateFeedDto, HostBoundaryOverviewDto,
    IndoorAssetFamilyIdDto, IndoorContractBacklogDto, IndoorRuntimeFieldIdDto, InteractionModeDto,
    LifecyclePhaseDto, LifecycleStateDto, ModeHintDto, RayPickHitDto, RayPickRequestDto,
    RayPickResponseDto, RuntimeBatchDto, RuntimeEntitySnapshotDto, RuntimeNotificationEnvelopeDto,
    RuntimeResidencyDto, SessionStateDto, Vec3Dto,
};

pub const RUNTIME_CHANNEL: &str = "runtime";
pub const ASSET_CHANNEL: &str = "asset";
pub const RUNTIME_LIFECYCLE_TOPIC: &str = "lifecycle.state";
pub const RUNTIME_BATCH_TOPIC: &str = "runtime.batch";
pub const RUNTIME_NOTIFICATION_EVENT: &str = "runtime:notification";

const LOCAL_PLAYER_GUID: Guid = Guid(0x5000_0001);
const REMOTE_SCOUT_GUID: Guid = Guid(0x5000_0002);
const REMOTE_SENTINEL_GUID: Guid = Guid(0x5000_0003);

pub struct HostBoundaryAdapter {
    content: Arc<ContentRepository>,
}

#[derive(Clone)]
pub struct HostRuntimeService {
    state: Arc<Mutex<HostRuntimeState>>,
    adapter: Arc<HostBoundaryAdapter>,
}

struct HostRuntimeState {
    tick: u64,
    world: WorldState,
    last_camera_hint: Option<CameraHintDto>,
    camera_hint_sequence: u64,
}

impl HostRuntimeService {
    pub fn new() -> Self {
        let adapter = Arc::new(HostBoundaryAdapter::new());
        Self {
            state: Arc::new(Mutex::new(HostRuntimeState::new())),
            adapter,
        }
    }

    pub fn lifecycle_state(&self) -> LifecycleStateDto {
        let state = self.state.lock().expect("host runtime state lock poisoned");
        self.adapter.lifecycle_state(&state)
    }

    pub fn runtime_batch(&self) -> RuntimeBatchDto {
        let state = self.state.lock().expect("host runtime state lock poisoned");
        self.adapter.runtime_batch(&state)
    }

    pub fn view_model_feed(&self) -> FrontendStateFeedDto {
        let state = self.state.lock().expect("host runtime state lock poisoned");
        self.adapter.view_model_feed(&state)
    }

    pub fn startup_notifications(&self) -> Vec<RuntimeNotificationEnvelopeDto> {
        let state = self.state.lock().expect("host runtime state lock poisoned");
        vec![
            self.adapter.lifecycle_notification(&state),
            self.adapter.runtime_notification(&state),
        ]
    }

    pub fn advance_runtime_notification(&self) -> RuntimeNotificationEnvelopeDto {
        let mut state = self.state.lock().expect("host runtime state lock poisoned");
        state.advance();
        self.adapter.runtime_notification(&state)
    }

    pub fn submit_camera_hint(&self, hint: CameraHintDto) -> CameraHintAckDto {
        let mut state = self.state.lock().expect("host runtime state lock poisoned");
        self.adapter.accept_camera_hint(&mut state, hint)
    }

    pub fn resolve_ray_pick(&self, request: RayPickRequestDto) -> RayPickResponseDto {
        let state = self.state.lock().expect("host runtime state lock poisoned");
        self.adapter.resolve_ray_pick(&state, request)
    }

    pub fn asset_lookup(&self, request: AssetLookupRequestDto) -> AssetLookupResponseDto {
        self.adapter.asset_lookup(request)
    }

    pub fn boundary_overview(&self) -> HostBoundaryOverviewDto {
        self.adapter.boundary_overview()
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
        world.entities.insert(Entity::new(
            LOCAL_PLAYER_GUID,
            "Browser Scout".to_string(),
            WorldPosition::default(),
        ));
        world.sync_player_position(make_world_position(Guid(0x0102_0003), 44.0, 84.0, 2.0, 0.0));

        Self {
            tick: 1,
            world,
            last_camera_hint: None,
            camera_hint_sequence: 0,
        }
    }

    fn advance(&mut self) {
        self.tick += 1;
    }
}

impl HostBoundaryAdapter {
    pub fn new() -> Self {
        let content = ContentRepository::from_hba_path(repo_assets_hba_path())
            .expect("failed to open repo-local 3D app content repository");
        Self {
            content: Arc::new(content),
        }
    }

    fn lifecycle_state(&self, _state: &HostRuntimeState) -> LifecycleStateDto {
        LifecycleStateDto {
            phase: LifecyclePhaseDto::Ready,
            active_mode_hint: Some(ModeHintDto::Client),
            session_state: SessionStateDto::Unavailable,
        }
    }

    fn runtime_batch(&self, state: &HostRuntimeState) -> RuntimeBatchDto {
        RuntimeBatchDto {
            tick: state.tick,
            entities: Self::runtime_entities(state),
            residency: self.runtime_residency(state),
        }
    }

    fn view_model_feed(&self, state: &HostRuntimeState) -> FrontendStateFeedDto {
        FrontendStateFeedDto {
            selected_entity_id: Some(if state.tick.is_multiple_of(2) {
                u32::from(REMOTE_SCOUT_GUID) as u64
            } else {
                u32::from(REMOTE_SENTINEL_GUID) as u64
            }),
            interaction_mode: InteractionModeDto::Inspect,
            busy_state: BusyStateDto::Idle,
        }
    }

    fn lifecycle_notification(&self, state: &HostRuntimeState) -> RuntimeNotificationEnvelopeDto {
        RuntimeNotificationEnvelopeDto {
            channel: RUNTIME_CHANNEL,
            topic: RUNTIME_LIFECYCLE_TOPIC,
            lifecycle_state: Some(self.lifecycle_state(state)),
            runtime_batch: None,
            view_model_feed: None,
        }
    }

    fn runtime_notification(&self, state: &HostRuntimeState) -> RuntimeNotificationEnvelopeDto {
        RuntimeNotificationEnvelopeDto {
            channel: RUNTIME_CHANNEL,
            topic: RUNTIME_BATCH_TOPIC,
            lifecycle_state: None,
            runtime_batch: Some(self.runtime_batch(state)),
            view_model_feed: Some(self.view_model_feed(state)),
        }
    }

    pub fn asset_lookup(&self, request: AssetLookupRequestDto) -> AssetLookupResponseDto {
        if let Some(landblock_id) = parse_terrain_asset_id(&request.asset_id) {
            return self.build_terrain_lookup_response(request, landblock_id);
        }

        if let Some(env_cell_id) = parse_indoor_env_cell_asset_id(&request.asset_id) {
            return self.build_indoor_env_cell_lookup_response(request, env_cell_id);
        }

        if let Some(environment_id) = parse_environment_asset_id(&request.asset_id) {
            return self.build_environment_lookup_response(request, environment_id);
        }

        if let Some(cell_structure_id) = parse_cell_structure_asset_id(&request.asset_id) {
            return build_cell_structure_lookup_response(request, cell_structure_id);
        }

        let (residency_kind, debug_primitive, palette_key, provenance) = match request
            .asset_id
            .as_str()
        {
            "gfx/02000001" => (
                "outdoor-landblock",
                "survey-billboard",
                "bronze-scout",
                serde_json::json!({
                    "source": "app-local-stub",
                    "sourceAssetKind": "appearance-manifest",
                    "errorCode": null,
                    "detail": "App-local debug manifest for the Browser Scout appearance."
                }),
            ),
            "gfx/02000002" => (
                "outdoor-landblock",
                "drudge-proxy-mesh",
                "rust-drudge",
                serde_json::json!({
                    "source": "app-local-stub",
                    "sourceAssetKind": "appearance-manifest",
                    "errorCode": null,
                    "detail": "App-local debug manifest for the Survey Drudge appearance."
                }),
            ),
            "gfx/02000003" => (
                "indoor-env-cell",
                "sentinel-proxy-volume",
                "dungeon-sentinel",
                serde_json::json!({
                    "source": "app-local-stub",
                    "sourceAssetKind": "appearance-manifest",
                    "errorCode": null,
                    "detail": "App-local debug manifest for the Dungeon Sentinel appearance."
                }),
            ),
            _ => (
                "unknown",
                "debug-placeholder",
                "unknown-asset",
                serde_json::json!({
                    "source": "app-local-stub",
                    "sourceAssetKind": "appearance-manifest",
                    "errorCode": "asset-id-unknown",
                    "detail": format!("No app-local debug manifest is registered for {}.", request.asset_id)
                }),
            ),
        };

        AssetLookupResponseDto {
            request_id: request.request_id,
            asset_id: request.asset_id.clone(),
            payload_kind: AssetPayloadKindDto::Json,
            payload: serde_json::json!({
                "kind": "appearance-manifest",
                "assetId": request.asset_id,
                "priority": request.priority,
                "residencyKind": residency_kind,
                "debugPrimitive": debug_primitive,
                "paletteKey": palette_key,
                "provenance": provenance
            }),
        }
    }

    pub fn boundary_overview(&self) -> HostBoundaryOverviewDto {
        HostBoundaryOverviewDto {
            asset_channel: ASSET_CHANNEL,
            runtime_channel: RUNTIME_CHANNEL,
            runtime_notification_event: RUNTIME_NOTIFICATION_EVENT,
            runtime_lifecycle_topic: RUNTIME_LIFECYCLE_TOPIC,
            runtime_batch_command: "get_runtime_batch",
            asset_lookup_command: "lookup_asset",
            indoor_contract_backlog: IndoorContractBacklogDto {
                runtime_field_ids: vec![
                    IndoorRuntimeFieldIdDto::FocusEnvCellId,
                    IndoorRuntimeFieldIdDto::VisibleCellIds,
                    IndoorRuntimeFieldIdDto::SeenOutside,
                    IndoorRuntimeFieldIdDto::EnvironmentId,
                    IndoorRuntimeFieldIdDto::CellStructureId,
                ],
                asset_family_ids: vec![
                    IndoorAssetFamilyIdDto::IndoorEnvCell,
                    IndoorAssetFamilyIdDto::Environment,
                    IndoorAssetFamilyIdDto::CellStructure,
                ],
            },
        }
    }

    fn accept_camera_hint(
        &self,
        state: &mut HostRuntimeState,
        hint: CameraHintDto,
    ) -> CameraHintAckDto {
        state.camera_hint_sequence += 1;
        let sequence = state.camera_hint_sequence;

        state.last_camera_hint = Some(hint);

        CameraHintAckDto {
            accepted: true,
            sequence,
        }
    }

    fn resolve_ray_pick(
        &self,
        state: &HostRuntimeState,
        request: RayPickRequestDto,
    ) -> RayPickResponseDto {
        let batch = self.runtime_batch(state);
        let direction = normalize_vec3(request.direction.clone());

        let best_hit = batch
            .entities
            .iter()
            .filter_map(|entity| {
                let offset = Vec3Dto {
                    x: entity.position.x - request.origin.x,
                    y: entity.position.y - request.origin.y,
                    z: entity.position.z - request.origin.z,
                };
                let distance = vec3_length(&offset);

                if distance <= f32::EPSILON {
                    return None;
                }

                let alignment = vec3_dot(&normalize_vec3(offset), &direction);

                (alignment > 0.2).then_some((entity, alignment, distance))
            })
            .max_by(
                |(_, left_alignment, left_distance), (_, right_alignment, right_distance)| {
                    let left_score = *left_alignment - (*left_distance * 0.001);
                    let right_score = *right_alignment - (*right_distance * 0.001);
                    left_score
                        .partial_cmp(&right_score)
                        .unwrap_or(std::cmp::Ordering::Equal)
                },
            );

        if let Some((entity, _alignment, distance)) = best_hit {
            return RayPickResponseDto {
                request_id: request.request_id,
                resolved: true,
                camera_hint_sequence: Some(state.camera_hint_sequence)
                    .filter(|_| state.last_camera_hint.is_some()),
                hit: Some(RayPickHitDto {
                    entity_id: entity.entity_id,
                    label: entity.label.clone(),
                    location_label: entity.location_label.clone(),
                    distance,
                }),
            };
        }

        RayPickResponseDto {
            request_id: request.request_id,
            resolved: false,
            camera_hint_sequence: Some(state.camera_hint_sequence)
                .filter(|_| state.last_camera_hint.is_some()),
            hit: None,
        }
    }

    fn runtime_residency(&self, state: &HostRuntimeState) -> RuntimeResidencyDto {
        let focus_position = state.world.player_position().unwrap_or_default();
        let indoor_metadata = focus_position
            .is_indoors()
            .then(|| {
                self.load_env_cell_metadata(u32::from(focus_position.landblock_id))
                    .ok()
            })
            .flatten();

        RuntimeResidencyDto {
            focus_entity_id: Some(u32::from(LOCAL_PLAYER_GUID) as u64),
            focus_landblock_id: u32::from(focus_position.landblock_id),
            focus_cell_id: focus_position.derived_outdoor_cell_id(),
            focus_env_cell_id: focus_position
                .is_indoors()
                .then_some(u32::from(focus_position.landblock_id)),
            visible_cell_ids: indoor_metadata
                .as_ref()
                .map(|metadata| metadata.visible_cell_ids.clone())
                .unwrap_or_default(),
            seen_outside: indoor_metadata
                .as_ref()
                .map(|metadata| metadata.seen_outside),
            environment_id: indoor_metadata
                .as_ref()
                .map(|metadata| metadata.environment_id),
            cell_structure_id: indoor_metadata
                .as_ref()
                .map(|metadata| metadata.cell_structure_id),
            focus_location_label: focus_position.to_world_coords().to_string_with_precision(2),
            indoors: focus_position.is_indoors(),
            tracked_body_count: 3,
        }
    }

    fn runtime_entities(state: &HostRuntimeState) -> Vec<RuntimeEntitySnapshotDto> {
        let focus_position = state.world.player_position().unwrap_or_default();
        let tick_offset = (state.tick.saturating_sub(1)) as f32;
        let heading = tick_offset * 0.1;
        let local_position = Vec3Dto {
            x: focus_position.coords.x + (tick_offset * 0.75),
            y: focus_position.coords.y + (tick_offset * 0.5),
            z: focus_position.coords.z,
        };

        vec![
            RuntimeEntitySnapshotDto {
                entity_id: u32::from(LOCAL_PLAYER_GUID) as u64,
                label: "Browser Scout".to_string(),
                position: local_position.clone(),
                heading_radians: heading,
                appearance_id: "gfx/02000001".to_string(),
                landblock_id: u32::from(focus_position.landblock_id),
                cell_id: focus_position.derived_outdoor_cell_id(),
                location_label: focus_position.to_world_coords().to_string_with_precision(2),
                is_local_player: true,
            },
            RuntimeEntitySnapshotDto {
                entity_id: u32::from(REMOTE_SCOUT_GUID) as u64,
                label: "Survey Drudge".to_string(),
                position: Vec3Dto {
                    x: local_position.x + 12.0,
                    y: local_position.y + 6.0,
                    z: local_position.z,
                },
                heading_radians: 1.2,
                appearance_id: "gfx/02000002".to_string(),
                landblock_id: u32::from(focus_position.landblock_id),
                cell_id: focus_position.derived_outdoor_cell_id(),
                location_label: focus_position.to_world_coords().to_string_with_precision(2),
                is_local_player: false,
            },
            RuntimeEntitySnapshotDto {
                entity_id: u32::from(REMOTE_SENTINEL_GUID) as u64,
                label: "Dungeon Sentinel".to_string(),
                position: Vec3Dto {
                    x: 18.0,
                    y: -7.5,
                    z: 0.0,
                },
                heading_radians: -0.35,
                appearance_id: "gfx/02000003".to_string(),
                landblock_id: 0x016C_0155,
                cell_id: None,
                location_label: "Indoors 0x016C0155".to_string(),
                is_local_player: false,
            },
        ]
    }
}

impl HostBoundaryAdapter {
    fn build_terrain_lookup_response(
        &self,
        request: AssetLookupRequestDto,
        landblock_id: u32,
    ) -> AssetLookupResponseDto {
        let payload = self
            .load_cell_landblock_payload(landblock_id)
            .unwrap_or_else(|error| generated_fallback_terrain_payload(landblock_id, error));

        AssetLookupResponseDto {
            request_id: request.request_id,
            asset_id: request.asset_id,
            payload_kind: AssetPayloadKindDto::Json,
            payload,
        }
    }

    fn build_indoor_env_cell_lookup_response(
        &self,
        request: AssetLookupRequestDto,
        env_cell_id: u32,
    ) -> AssetLookupResponseDto {
        let payload = self
            .load_indoor_env_cell_payload(env_cell_id)
            .unwrap_or_else(|(detail, error_code)| {
                serde_json::json!({
                    "kind": "indoor-env-cell",
                    "residencyKind": "indoor-env-cell",
                    "sourceAssetKind": "env-cell",
                    "envCellId": env_cell_id,
                    "environmentId": null,
                    "cellStructureId": null,
                    "visibleCellIds": [],
                    "seenOutside": null,
                    "surfaceIds": [],
                    "portalCount": 0,
                    "staticObjectCount": 0,
                    "provenance": {
                        "source": "app-local-stub",
                        "sourceAssetKind": "env-cell",
                        "errorCode": error_code,
                        "detail": detail
                    }
                })
            });

        AssetLookupResponseDto {
            request_id: request.request_id,
            asset_id: request.asset_id,
            payload_kind: AssetPayloadKindDto::Json,
            payload,
        }
    }
}

fn build_cell_structure_lookup_response(
    request: AssetLookupRequestDto,
    cell_structure_id: u32,
) -> AssetLookupResponseDto {
    AssetLookupResponseDto {
        request_id: request.request_id,
        asset_id: request.asset_id,
        payload_kind: AssetPayloadKindDto::Json,
        payload: serde_json::json!({
            "kind": "cell-structure",
            "residencyKind": "indoor-env-cell",
            "sourceAssetKind": "cell-structure",
            "environmentId": null,
            "cellStructureId": cell_structure_id,
            "polygonCount": null,
            "portalCount": null,
            "hasCellBsp": false,
            "hasPhysicsBsp": false,
            "hasDrawingBsp": false,
            "provenance": {
                "source": "app-local-stub",
                "sourceAssetKind": "cell-structure",
                "errorCode": null,
                "detail": "Cell-structure summaries stay reference-first in Phase 11 until a structural parser lands."
            }
        }),
    }
}

#[derive(Clone)]
struct IndoorEnvCellMetadata {
    environment_id: u32,
    cell_structure_id: u32,
    visible_cell_ids: Vec<u32>,
    seen_outside: bool,
}

impl HostBoundaryAdapter {
    fn build_environment_lookup_response(
        &self,
        request: AssetLookupRequestDto,
        environment_id: u32,
    ) -> AssetLookupResponseDto {
        let provenance = match self.content.read_resource(
            ResourceKey::new(EOR_PORTAL_NAMESPACE, environment_id),
            "environment reference asset",
        ) {
            Ok(resource) => serde_json::json!({
                "source": "repo-local-hba",
                "sourceAssetKind": "environment",
                "errorCode": null,
                "detail": resource.source_description
            }),
            Err(error) => serde_json::json!({
                "source": "app-local-stub",
                "sourceAssetKind": "environment",
                "errorCode": "asset-read-failed",
                "detail": format!("Environment decoding is not implemented in holtburger-dat yet, and the raw reference could not be resolved: {error}")
            }),
        };

        AssetLookupResponseDto {
            request_id: request.request_id,
            asset_id: request.asset_id,
            payload_kind: AssetPayloadKindDto::Json,
            payload: serde_json::json!({
                "kind": "environment",
                "residencyKind": "indoor-env-cell",
                "sourceAssetKind": "environment",
                "environmentId": environment_id,
                "cellStructureIds": [],
                "provenance": provenance
            }),
        }
    }

    fn load_env_cell_metadata(
        &self,
        env_cell_id: u32,
    ) -> Result<IndoorEnvCellMetadata, (String, &'static str)> {
        let resource = self
            .content
            .read_resource(
                ResourceKey::new(EOR_CELL_NAMESPACE, env_cell_id),
                "indoor env cell metadata",
            )
            .map_err(|error| {
                (
                    format!(
                        "Could not read {}:0x{env_cell_id:08X} from content repository: {error}",
                        EOR_CELL_NAMESPACE
                    ),
                    "asset-read-failed",
                )
            })?;
        let env_cell =
            EnvCell::unpack(&mut std::io::Cursor::new(resource.bytes)).map_err(|error| {
                (
                    format!("Could not decode EnvCell 0x{env_cell_id:08X}: {error}"),
                    "asset-decode-failed",
                )
            })?;

        Ok(IndoorEnvCellMetadata {
            environment_id: 0x0D00_0000 | u32::from(env_cell.environment_id),
            cell_structure_id: u32::from(env_cell.cell_structure),
            visible_cell_ids: env_cell
                .visible_cells
                .into_iter()
                .map(|cell_id| (env_cell_id & 0xFFFF_0000) | u32::from(cell_id))
                .collect(),
            seen_outside: (env_cell.flags & 0x01) != 0,
        })
    }

    fn load_cell_landblock_payload(
        &self,
        landblock_id: u32,
    ) -> Result<serde_json::Value, (String, &'static str)> {
        let resource = self
            .content
            .read_resource(
                ResourceKey::new(EOR_CELL_NAMESPACE, landblock_id),
                "cell landblock terrain",
            )
            .map_err(|error| {
                (
                    format!(
                        "Could not read {}:0x{landblock_id:08X} from content repository: {error}",
                        EOR_CELL_NAMESPACE
                    ),
                    "asset-read-failed",
                )
            })?;
        let source_detail = resource.source_description.clone();
        let landblock = CellLandblock::unpack(&resource.bytes).map_err(|error| {
            (
                format!("Could not decode CellLandblock 0x{landblock_id:08X}: {error}"),
                "asset-decode-failed",
            )
        })?;

        Ok(serde_json::json!({
            "kind": "terrain-landblock",
            "residencyKind": "outdoor-landblock",
            "sourceAssetKind": "cell-landblock",
            "landblockId": landblock_id,
            "gridSize": 9,
            "tileSize": 24,
            "heights": landblock.height.iter().map(|height| f32::from(*height) * 2.0).collect::<Vec<_>>(),
            "terrainTypes": landblock.terrain,
            "provenance": {
                "source": "repo-local-hba",
                "sourceAssetKind": "cell-landblock",
                "errorCode": null,
                "detail": source_detail
            }
        }))
    }
}

fn generated_fallback_terrain_payload(
    landblock_id: u32,
    (detail, error_code): (String, &'static str),
) -> serde_json::Value {
    serde_json::json!({
        "kind": "terrain-landblock",
        "residencyKind": "outdoor-landblock",
        "sourceAssetKind": "cell-landblock",
        "landblockId": landblock_id,
        "gridSize": 9,
        "tileSize": 24,
        "heights": vec![0.0_f32; 81],
        "terrainTypes": vec![0_u16; 81],
        "provenance": {
            "source": "generated-fallback",
            "sourceAssetKind": "cell-landblock",
            "errorCode": error_code,
            "detail": detail,
        }
    })
}

impl HostBoundaryAdapter {
    fn load_indoor_env_cell_payload(
        &self,
        env_cell_id: u32,
    ) -> Result<serde_json::Value, (String, &'static str)> {
        let resource = self
            .content
            .read_resource(
                ResourceKey::new(EOR_CELL_NAMESPACE, env_cell_id),
                "indoor env cell asset",
            )
            .map_err(|error| {
                (
                    format!(
                        "Could not read {}:0x{env_cell_id:08X} from content repository: {error}",
                        EOR_CELL_NAMESPACE
                    ),
                    "asset-read-failed",
                )
            })?;
        let source_detail = resource.source_description.clone();
        let env_cell =
            EnvCell::unpack(&mut std::io::Cursor::new(resource.bytes)).map_err(|error| {
                (
                    format!("Could not decode EnvCell 0x{env_cell_id:08X}: {error}"),
                    "asset-decode-failed",
                )
            })?;

        Ok(serde_json::json!({
            "kind": "indoor-env-cell",
            "residencyKind": "indoor-env-cell",
            "sourceAssetKind": "env-cell",
            "envCellId": env_cell_id,
            "environmentId": 0x0D00_0000 | u32::from(env_cell.environment_id),
            "cellStructureId": u32::from(env_cell.cell_structure),
            "visibleCellIds": env_cell.visible_cells.iter().map(|cell_id| (env_cell_id & 0xFFFF_0000) | u32::from(*cell_id)).collect::<Vec<_>>(),
            "seenOutside": (env_cell.flags & 0x01) != 0,
            "surfaceIds": env_cell.surfaces.iter().map(|surface_id| 0x0800_0000 | u32::from(*surface_id)).collect::<Vec<_>>(),
            "portalCount": env_cell.portals.len(),
            "staticObjectCount": env_cell.static_objects.len(),
            "provenance": {
                "source": "repo-local-hba",
                "sourceAssetKind": "env-cell",
                "errorCode": null,
                "detail": source_detail
            }
        }))
    }
}

fn parse_terrain_asset_id(asset_id: &str) -> Option<u32> {
    asset_id
        .strip_prefix("terrain/")
        .filter(|hex| hex.len() == 8 && hex.chars().all(|ch| ch.is_ascii_hexdigit()))
        .and_then(|hex| u32::from_str_radix(hex, 16).ok())
}

fn parse_indoor_env_cell_asset_id(asset_id: &str) -> Option<u32> {
    asset_id
        .strip_prefix("indoor-env-cell/")
        .filter(|hex| hex.len() == 8 && hex.chars().all(|ch| ch.is_ascii_hexdigit()))
        .and_then(|hex| u32::from_str_radix(hex, 16).ok())
}

fn parse_environment_asset_id(asset_id: &str) -> Option<u32> {
    asset_id
        .strip_prefix("environment/")
        .filter(|hex| hex.len() == 8 && hex.chars().all(|ch| ch.is_ascii_hexdigit()))
        .and_then(|hex| u32::from_str_radix(hex, 16).ok())
}

fn parse_cell_structure_asset_id(asset_id: &str) -> Option<u32> {
    asset_id
        .strip_prefix("cell-structure/")
        .filter(|hex| {
            !hex.is_empty() && hex.len() <= 8 && hex.chars().all(|ch| ch.is_ascii_hexdigit())
        })
        .and_then(|hex| u32::from_str_radix(hex, 16).ok())
}

fn repo_assets_hba_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../dats/assets.hba")
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

fn normalize_vec3(vector: Vec3Dto) -> Vec3Dto {
    let length = vec3_length(&vector);

    if length <= f32::EPSILON {
        return Vec3Dto {
            x: 0.0,
            y: 1.0,
            z: 0.0,
        };
    }

    Vec3Dto {
        x: vector.x / length,
        y: vector.y / length,
        z: vector.z / length,
    }
}

fn vec3_length(vector: &Vec3Dto) -> f32 {
    (vector.x.powi(2) + vector.y.powi(2) + vector.z.powi(2)).sqrt()
}

fn vec3_dot(left: &Vec3Dto, right: &Vec3Dto) -> f32 {
    (left.x * right.x) + (left.y * right.y) + (left.z * right.z)
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
        assert_eq!(
            batch.residency.focus_entity_id,
            Some(u32::from(LOCAL_PLAYER_GUID) as u64)
        );
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
        assert_eq!(
            first_view_model.selected_entity_id,
            Some(u32::from(REMOTE_SCOUT_GUID) as u64)
        );
        assert_eq!(
            second_view_model.selected_entity_id,
            Some(u32::from(REMOTE_SENTINEL_GUID) as u64)
        );

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

        assert_ne!(
            advanced_local_player.position.x,
            initial_local_player.position.x
        );
        assert_ne!(
            advanced_local_player.position.y,
            initial_local_player.position.y
        );
        assert_ne!(
            advanced_local_player.heading_radians,
            initial_local_player.heading_radians
        );
    }

    #[test]
    fn boundary_overview_and_asset_lookup_remain_runtime_asset_split() {
        let runtime = HostRuntimeService::new();
        let overview = runtime.boundary_overview();
        let asset = runtime.asset_lookup(AssetLookupRequestDto {
            request_id: "test-request".to_string(),
            asset_id: "terrain/0102ffff".to_string(),
            priority: crate::contracts::AssetPriorityDto::Bootstrap,
        });

        assert_eq!(overview.runtime_channel, RUNTIME_CHANNEL);
        assert_eq!(overview.asset_channel, ASSET_CHANNEL);
        assert_eq!(
            overview.runtime_notification_event,
            RUNTIME_NOTIFICATION_EVENT
        );
        assert_eq!(overview.runtime_lifecycle_topic, RUNTIME_LIFECYCLE_TOPIC);
        assert_eq!(overview.runtime_batch_command, "get_runtime_batch");
        assert_eq!(overview.asset_lookup_command, "lookup_asset");
        assert!(
            overview
                .indoor_contract_backlog
                .runtime_field_ids
                .contains(&IndoorRuntimeFieldIdDto::VisibleCellIds)
        );
        assert!(
            overview
                .indoor_contract_backlog
                .asset_family_ids
                .contains(&IndoorAssetFamilyIdDto::CellStructure)
        );
        assert_eq!(asset.request_id, "test-request");
        assert_eq!(asset.asset_id, "terrain/0102ffff");
        assert!(matches!(asset.payload_kind, AssetPayloadKindDto::Json));
        assert_eq!(asset.payload["kind"], "terrain-landblock");
        assert_eq!(asset.payload["residencyKind"], "outdoor-landblock");
        assert_eq!(asset.payload["landblockId"], 0x0102ffff);
    }

    #[test]
    fn camera_hints_are_accepted_and_picks_resolve_against_authoritative_debug_entities() {
        let runtime = HostRuntimeService::new();
        let batch = runtime.runtime_batch();
        let local_player = batch
            .entities
            .iter()
            .find(|entity| entity.is_local_player)
            .expect("local player should be present");
        let remote_scout = batch
            .entities
            .iter()
            .find(|entity| entity.entity_id == u32::from(REMOTE_SCOUT_GUID) as u64)
            .expect("remote scout should be present");
        let direction = normalize_vec3(Vec3Dto {
            x: remote_scout.position.x - local_player.position.x,
            y: remote_scout.position.y - local_player.position.y,
            z: remote_scout.position.z - local_player.position.z,
        });

        let ack = runtime.submit_camera_hint(CameraHintDto {
            mode: ModeHintDto::Client,
            source: "world-display".to_string(),
            position: local_player.position.clone(),
            forward: direction.clone(),
            viewport_normalized_x: 0.75,
            viewport_normalized_y: 0.5,
            destination_label: Some(batch.residency.focus_location_label.clone()),
        });
        let response = runtime.resolve_ray_pick(RayPickRequestDto {
            request_id: "pick-1".to_string(),
            origin: local_player.position.clone(),
            direction,
            screen_x_normalized: 0.75,
            screen_y_normalized: 0.5,
            destination_label: Some(batch.residency.focus_location_label),
        });

        assert!(ack.accepted);
        assert_eq!(ack.sequence, 1);
        assert!(response.resolved);
        assert_eq!(response.camera_hint_sequence, Some(1));
        assert_eq!(
            response.hit.as_ref().map(|hit| hit.entity_id),
            Some(remote_scout.entity_id)
        );
    }
}
