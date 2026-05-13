use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use holtburger_common::Guid;
use holtburger_common::math::{Quaternion, Vector3};
use holtburger_common::position::WorldPosition;
use holtburger_content::{ContentRepository, SoulEmoteCatalog};
use holtburger_dat::file_type::{
    EnvCell, GfxObj, REGION_DESC_FILE_ID, RegionDesc, Scene, SceneObjectTemplate, SetupModel,
};
use holtburger_dat::file_type::{MotionKinematics, SkillTable, SpellTable, XpTable};
use holtburger_dat::graphics::{CVertexArray, Polygon};
use holtburger_dat::landblock::{CellLandblock, LandblockInfo};
use holtburger_dat::physics::BspNode;
use holtburger_dat::{EOR_CELL_NAMESPACE, EOR_PORTAL_NAMESPACE, ResourceKey};
use holtburger_world::entity::Entity;
use holtburger_world::{WorldBootstrap, WorldState};

use crate::contracts::{
    AssetLookupRequestDto, AssetLookupResponseDto, AssetPayloadKindDto, BusyStateDto,
    CameraHintAckDto, CameraHintDto, DebugConfigDto, FrameDto, FrontendStateFeedDto,
    HostBoundaryOverviewDto, IndoorAssetFamilyIdDto, IndoorContractBacklogDto,
    IndoorRuntimeFieldIdDto, InteractionModeDto, LifecyclePhaseDto, LifecycleStateDto, ModeHintDto,
    QuaternionDto, RayPickHitDto, RayPickRequestDto, RayPickResponseDto, RuntimeBatchDto,
    RuntimeEntitySnapshotDto, RuntimeNotificationEnvelopeDto, RuntimeResidencyDto, SessionStateDto,
    Vec3Dto,
};

pub const RUNTIME_CHANNEL: &str = "runtime";
pub const ASSET_CHANNEL: &str = "asset";
pub const RUNTIME_LIFECYCLE_TOPIC: &str = "lifecycle.state";
pub const RUNTIME_BATCH_TOPIC: &str = "runtime.batch";
pub const RUNTIME_NOTIFICATION_EVENT: &str = "runtime:notification";

const LOCAL_PLAYER_GUID: Guid = Guid(0x5000_0001);
const REMOTE_SCOUT_GUID: Guid = Guid(0x5000_0002);
const REMOTE_SENTINEL_GUID: Guid = Guid(0x5000_0003);
const GENERATED_SCENERY_CELL_SIZE: f32 = 24.0;
const GENERATED_SCENERY_BLOCK_SIZE: f32 = 192.0;
const GENERATED_SCENERY_MIN_POINT_SPACING_SQUARED: f32 = 4.0;
const GENERATED_SCENERY_RANDOM_UNIT: f64 = 2.328_306_4e-10;

pub struct HostBoundaryAdapter {
    content: Arc<ContentRepository>,
    verbose: bool,
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
    pub fn new(verbose: bool) -> Self {
        let adapter = Arc::new(HostBoundaryAdapter::new(verbose));
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

    pub fn debug_config(&self) -> DebugConfigDto {
        DebugConfigDto {
            verbose: self.adapter.verbose,
        }
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
    pub fn new(verbose: bool) -> Self {
        let content = ContentRepository::from_hba_path(repo_assets_hba_path())
            .expect("failed to open repo-local 3D app content repository");
        Self {
            content: Arc::new(content),
            verbose,
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
        if self.verbose {
            eprintln!(
                "[holtburger-3d][asset.lookup] request_id={} asset_id={} priority={:?}",
                request.request_id, request.asset_id, request.priority
            );
        }

        if let Some(landblock_id) = parse_terrain_asset_id(&request.asset_id) {
            return self.build_terrain_lookup_response(request, landblock_id);
        }

        if let Some(landblock_id) = parse_landblock_statics_asset_id(&request.asset_id) {
            return self.build_landblock_statics_lookup_response(request, landblock_id);
        }

        if let Some(landblock_id) = parse_landblock_generated_scenery_asset_id(&request.asset_id) {
            return self.build_landblock_generated_scenery_lookup_response(request, landblock_id);
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

        if let Some(gfx_obj_id) = parse_gfx_obj_asset_id(&request.asset_id) {
            return self.build_gfx_obj_lookup_response(request, gfx_obj_id);
        }

        if let Some(setup_model_id) = parse_setup_model_asset_id(&request.asset_id) {
            return self.build_setup_model_lookup_response(request, setup_model_id);
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

    fn load_landblock_statics_payload(
        &self,
        raw_landblock_id: u32,
    ) -> Result<serde_json::Value, (String, &'static str)> {
        let landblock_id = normalize_landblock_id(raw_landblock_id);
        let landblock_info = self.load_landblock_info(landblock_id)?;

        Ok(serde_json::json!({
            "kind": "landblock-statics",
            "residencyKind": "outdoor-landblock",
            "sourceAssetKind": "landblock-info",
            "landblockId": landblock_id,
            "sceneryInstances": landblock_info.objects.iter().enumerate().filter_map(
                |(index, object)| {
                    format_renderable_asset_id(object.id).map(|source_asset_id| {
                        serde_json::json!({
                            "instanceId": format!(
                                "landblock-statics/{landblock_id:08x}/object/{index:04x}/{:08x}",
                                object.id
                            ),
                            "owningLandblockId": landblock_id,
                            "sourceDid": object.id,
                            "sourceAssetId": source_asset_id,
                            "sourceIndex": index,
                            "frame": serialize_landblock_frame_dto(&object.frame),
                        })
                    })
                },
            ).collect::<Vec<_>>(),
            "buildingInstances": landblock_info.buildings.iter().enumerate().filter_map(
                |(index, building)| {
                    format_renderable_asset_id(building.model_id).map(|source_asset_id| {
                        serde_json::json!({
                            "instanceId": format!(
                                "landblock-statics/{landblock_id:08x}/building/{index:04x}/{:08x}",
                                building.model_id
                            ),
                            "owningLandblockId": landblock_id,
                            "sourceDid": building.model_id,
                            "sourceAssetId": source_asset_id,
                            "sourceIndex": index,
                            "frame": serialize_landblock_frame_dto(&building.frame),
                            "numLeaves": building.num_leaves,
                        })
                    })
                },
            ).collect::<Vec<_>>(),
            "provenance": {
                "source": "repo-local-hba",
                "sourceAssetKind": "landblock-info",
                "errorCode": null,
                "detail": format!("{}:0x{:08X}", EOR_CELL_NAMESPACE, landblock_id & 0xffff_fffe)
            }
        }))
    }

    fn load_landblock_generated_scenery_payload(
        &self,
        raw_landblock_id: u32,
    ) -> Result<serde_json::Value, (String, &'static str)> {
        let landblock_id = normalize_landblock_id(raw_landblock_id);
        let landblock = self.load_cell_landblock(landblock_id)?;
        let landblock_info = self.load_landblock_info(landblock_id).ok();
        let region = self.load_region_desc()?;
        let instances = self.derive_generated_scenery_instances(
            landblock_id,
            &landblock,
            landblock_info.as_ref(),
            &region,
        )?;

        Ok(serde_json::json!({
            "kind": "landblock-generated-scenery",
            "residencyKind": "outdoor-landblock",
            "sourceAssetKind": "region-scene-table",
            "landblockId": landblock_id,
            "sceneryInstances": instances,
            "provenance": {
                "source": "repo-local-hba",
                "sourceAssetKind": "region-scene-table",
                "errorCode": null,
                "detail": format!(
                    "{}:0x{:08X} + {}:0x{:08X}",
                    EOR_CELL_NAMESPACE,
                    landblock_id,
                    EOR_PORTAL_NAMESPACE,
                    REGION_DESC_FILE_ID
                )
            }
        }))
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
    fn derive_generated_scenery_instances(
        &self,
        landblock_id: u32,
        landblock: &CellLandblock,
        landblock_info: Option<&LandblockInfo>,
        region: &RegionDesc,
    ) -> Result<Vec<serde_json::Value>, (String, &'static str)> {
        let mut instances = Vec::new();
        let mut occupied_points = landblock_info
            .into_iter()
            .flat_map(|info| {
                info.objects
                    .iter()
                    .map(|object| object.frame.origin)
                    .chain(info.buildings.iter().map(|building| building.frame.origin))
            })
            .map(|origin| (origin.x, origin.y))
            .collect::<Vec<_>>();
        let block_x = (landblock_id >> 24) * 8;
        let block_y = ((landblock_id >> 16) & 0xff) * 8;

        for (terrain_index, terrain) in landblock.terrain.iter().copied().enumerate() {
            let terrain_type = usize::from((terrain >> 2) & 0x1f);
            let scenery_type = usize::from(terrain >> 11);
            let Some(scene_info_index) = region
                .terrain_info
                .terrain_types
                .get(terrain_type)
                .and_then(|terrain_type| terrain_type.scene_types.get(scenery_type))
                .copied()
            else {
                continue;
            };
            let Some(scene_type) = region.scene_info.scene_types.get(scene_info_index as usize)
            else {
                continue;
            };
            if scene_type.scenes.is_empty() {
                continue;
            }

            let cell_x = (terrain_index / 9) as u32;
            let cell_y = (terrain_index % 9) as u32;
            let global_cell_x = block_x + cell_x;
            let global_cell_y = block_y + cell_y;
            let scene_id =
                select_generated_scene_id(&scene_type.scenes, global_cell_x, global_cell_y);
            let scene = self.load_scene(scene_id)?;

            for (template_index, template) in scene.object_templates.iter().enumerate() {
                if template.weenie_object_id != 0
                    || generated_template_noise(global_cell_x, global_cell_y, template_index as u32)
                        >= template.frequency
                {
                    continue;
                }

                let local_position = displace_generated_template(
                    template,
                    global_cell_x,
                    global_cell_y,
                    template_index as u32,
                );
                let local_x = cell_x as f32 * GENERATED_SCENERY_CELL_SIZE + local_position.x;
                let local_y = cell_y as f32 * GENERATED_SCENERY_CELL_SIZE + local_position.y;
                if !(0.0..GENERATED_SCENERY_BLOCK_SIZE).contains(&local_x)
                    || !(0.0..GENERATED_SCENERY_BLOCK_SIZE).contains(&local_y)
                    || generated_scenery_on_road(landblock, local_x, local_y)
                {
                    continue;
                }

                let Some(source_asset_id) = format_renderable_asset_id(template.object_id) else {
                    continue;
                };

                let terrain_sample = sample_landblock_terrain(landblock, local_x, local_y);
                if !generated_template_matches_slope(template, terrain_sample.normal_z) {
                    continue;
                }
                if occupied_points.iter().any(|(x, y)| {
                    let dx = local_x - *x;
                    let dy = local_y - *y;
                    dx * dx + dy * dy < GENERATED_SCENERY_MIN_POINT_SPACING_SQUARED
                }) {
                    continue;
                }

                occupied_points.push((local_x, local_y));
                let scale = scale_generated_template(
                    template,
                    global_cell_x,
                    global_cell_y,
                    template_index as u32,
                );
                let frame = build_generated_template_frame(
                    template,
                    global_cell_x,
                    global_cell_y,
                    template_index as u32,
                    local_x,
                    local_y,
                    terrain_sample.height + local_position.z,
                );
                let source_index = instances.len();
                instances.push(serde_json::json!({
                    "instanceId": format!(
                        "landblock-generated-scenery/{landblock_id:08x}/scene/{scene_id:08x}/cell/{terrain_index:02x}/template/{template_index:04x}/{:08x}",
                        template.object_id
                    ),
                    "owningLandblockId": landblock_id,
                    "sourceDid": template.object_id,
                    "sourceAssetId": source_asset_id,
                    "sourceIndex": source_index,
                    "terrainIndex": terrain_index,
                    "sceneId": scene_id,
                    "sceneTemplateIndex": template_index,
                    "frame": frame,
                    "scale": scale,
                }));
            }
        }

        Ok(instances)
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
        if self.verbose {
            eprintln!(
                "[holtburger-3d][asset.lookup] response asset_id={} kind={} provenance={}",
                request.asset_id,
                payload
                    .get("kind")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("unknown"),
                payload
                    .get("provenance")
                    .and_then(|provenance| provenance.get("source"))
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("unknown")
            );
        }

        AssetLookupResponseDto {
            request_id: request.request_id,
            asset_id: request.asset_id,
            payload_kind: AssetPayloadKindDto::Json,
            payload,
        }
    }

    fn build_landblock_statics_lookup_response(
        &self,
        request: AssetLookupRequestDto,
        landblock_id: u32,
    ) -> AssetLookupResponseDto {
        let payload = self
            .load_landblock_statics_payload(landblock_id)
            .unwrap_or_else(|(detail, error_code)| {
                serde_json::json!({
                    "kind": "landblock-statics",
                    "residencyKind": "outdoor-landblock",
                    "sourceAssetKind": "landblock-info",
                    "landblockId": normalize_landblock_id(landblock_id),
                    "sceneryInstances": [],
                    "buildingInstances": [],
                    "provenance": {
                        "source": "app-local-stub",
                        "sourceAssetKind": "landblock-info",
                        "errorCode": error_code,
                        "detail": detail
                    }
                })
            });
        if self.verbose {
            let provenance = payload.get("provenance");
            eprintln!(
                "[holtburger-3d][asset.lookup] response asset_id={} kind={} scenery={} buildings={} provenance={} error_code={} detail={}",
                request.asset_id,
                payload
                    .get("kind")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("unknown"),
                payload
                    .get("sceneryInstances")
                    .and_then(serde_json::Value::as_array)
                    .map_or(0, Vec::len),
                payload
                    .get("buildingInstances")
                    .and_then(serde_json::Value::as_array)
                    .map_or(0, Vec::len),
                provenance
                    .and_then(|provenance| provenance.get("source"))
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("unknown"),
                provenance
                    .and_then(|provenance| provenance.get("errorCode"))
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("null"),
                provenance
                    .and_then(|provenance| provenance.get("detail"))
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("unknown")
            );
        }

        AssetLookupResponseDto {
            request_id: request.request_id,
            asset_id: request.asset_id,
            payload_kind: AssetPayloadKindDto::Json,
            payload,
        }
    }

    fn build_landblock_generated_scenery_lookup_response(
        &self,
        request: AssetLookupRequestDto,
        landblock_id: u32,
    ) -> AssetLookupResponseDto {
        let payload = self
            .load_landblock_generated_scenery_payload(landblock_id)
            .unwrap_or_else(|(detail, error_code)| {
                serde_json::json!({
                    "kind": "landblock-generated-scenery",
                    "residencyKind": "outdoor-landblock",
                    "sourceAssetKind": "region-scene-table",
                    "landblockId": normalize_landblock_id(landblock_id),
                    "sceneryInstances": [],
                    "provenance": {
                        "source": "app-local-stub",
                        "sourceAssetKind": "region-scene-table",
                        "errorCode": error_code,
                        "detail": detail
                    }
                })
            });
        if self.verbose {
            let provenance = payload.get("provenance");
            eprintln!(
                "[holtburger-3d][asset.lookup] response asset_id={} kind={} generated={} provenance={} error_code={} detail={}",
                request.asset_id,
                payload
                    .get("kind")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("unknown"),
                payload
                    .get("sceneryInstances")
                    .and_then(serde_json::Value::as_array)
                    .map_or(0, Vec::len),
                provenance
                    .and_then(|provenance| provenance.get("source"))
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("unknown"),
                provenance
                    .and_then(|provenance| provenance.get("errorCode"))
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("null"),
                provenance
                    .and_then(|provenance| provenance.get("detail"))
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("unknown")
            );
        }

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

    fn build_gfx_obj_lookup_response(
        &self,
        request: AssetLookupRequestDto,
        gfx_obj_id: u32,
    ) -> AssetLookupResponseDto {
        let payload =
            self.load_gfx_obj_payload(gfx_obj_id)
                .unwrap_or_else(|(detail, error_code)| {
                    serde_json::json!({
                        "kind": "gfx-obj",
                        "residencyKind": "unknown",
                        "sourceAssetKind": "gfx-obj",
                        "gfxObjId": gfx_obj_id,
                        "flags": null,
                        "surfaceIds": [],
                        "vertexArray": {
                            "vertexType": null,
                            "vertexCount": 0,
                            "vertices": []
                        },
                        "drawingPolygons": [],
                        "drawingBsp": null,
                        "physicsWitness": {
                            "polygonCount": 0,
                            "hasBsp": false
                        },
                        "sortCenter": null,
                        "didDegrade": null,
                        "provenance": {
                            "source": "app-local-stub",
                            "sourceAssetKind": "gfx-obj",
                            "errorCode": error_code,
                            "detail": detail
                        }
                    })
                });
        if self.verbose {
            eprintln!(
                "[holtburger-3d][asset.lookup] response asset_id={} kind={} vertices={} polygons={} render_source={}",
                request.asset_id,
                payload
                    .get("kind")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("unknown"),
                payload
                    .get("vertexArray")
                    .and_then(|vertex_array| vertex_array.get("vertexCount"))
                    .and_then(serde_json::Value::as_u64)
                    .unwrap_or(0),
                payload
                    .get("drawingPolygons")
                    .and_then(serde_json::Value::as_array)
                    .map_or(0, Vec::len),
                payload
                    .get("provenance")
                    .and_then(|provenance| provenance.get("source"))
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("unknown")
            );
        }

        AssetLookupResponseDto {
            request_id: request.request_id,
            asset_id: request.asset_id,
            payload_kind: AssetPayloadKindDto::Json,
            payload,
        }
    }

    fn build_setup_model_lookup_response(
        &self,
        request: AssetLookupRequestDto,
        setup_model_id: u32,
    ) -> AssetLookupResponseDto {
        let payload = self
            .load_setup_model_payload(setup_model_id)
            .unwrap_or_else(|(detail, error_code)| {
                serde_json::json!({
                "kind": "setup-model",
                "residencyKind": "unknown",
                "sourceAssetKind": "setup-model",
                "setupModelId": setup_model_id,
                "flags": null,
                "parts": [],
                "holdingLocations": [],
                "connectionPoints": [],
                "placementFrames": [],
                "collisionWitness": {
                    "cylSphereCount": 0,
                    "sphereCount": 0
                },
                "height": null,
                "radius": null,
                "stepUp": null,
                "stepDown": null,
                "sortingSphere": null,
                "selectionSphere": null,
                "lights": [],
                "defaultAnimation": null,
                "defaultScript": null,
                "defaultMotionTable": null,
                "defaultSoundTable": null,
                "defaultScriptTable": null,
                "provenance": {
                    "source": "app-local-stub",
                    "sourceAssetKind": "setup-model",
                    "errorCode": error_code,
                    "detail": detail
                    }
                })
            });
        if self.verbose {
            eprintln!(
                "[holtburger-3d][asset.lookup] response asset_id={} kind={} parts={} provenance={}",
                request.asset_id,
                payload
                    .get("kind")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("unknown"),
                payload
                    .get("parts")
                    .and_then(serde_json::Value::as_array)
                    .map_or(0, Vec::len),
                payload
                    .get("provenance")
                    .and_then(|provenance| provenance.get("source"))
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("unknown")
            );
        }

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
        let provenance = match self
            .content
            .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, environment_id))
        {
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
            .read_resource(ResourceKey::new(EOR_CELL_NAMESPACE, env_cell_id))
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

    fn load_landblock_info(
        &self,
        landblock_id: u32,
    ) -> Result<LandblockInfo, (String, &'static str)> {
        let landblock_info_id = normalize_landblock_id(landblock_id) & 0xffff_fffe;
        let resource = self
            .content
            .read_resource(ResourceKey::new(EOR_CELL_NAMESPACE, landblock_info_id))
            .map_err(|error| {
                (
                    format!(
                        "Could not read {}:0x{landblock_info_id:08X} from content repository: {error}",
                        EOR_CELL_NAMESPACE
                    ),
                    "asset-read-failed",
                )
            })?;

        LandblockInfo::unpack(&resource.bytes).map_err(|error| {
            (
                format!("Could not decode LandblockInfo 0x{landblock_info_id:08X}: {error}"),
                "asset-decode-failed",
            )
        })
    }

    fn load_cell_landblock(
        &self,
        landblock_id: u32,
    ) -> Result<CellLandblock, (String, &'static str)> {
        let resource = self
            .content
            .read_resource(ResourceKey::new(EOR_CELL_NAMESPACE, landblock_id))
            .map_err(|error| {
                (
                    format!(
                        "Could not read {}:0x{landblock_id:08X} from content repository: {error}",
                        EOR_CELL_NAMESPACE
                    ),
                    "asset-read-failed",
                )
            })?;

        CellLandblock::unpack(&resource.bytes).map_err(|error| {
            (
                format!("Could not decode CellLandblock 0x{landblock_id:08X}: {error}"),
                "asset-decode-failed",
            )
        })
    }

    fn load_region_desc(&self) -> Result<RegionDesc, (String, &'static str)> {
        let resource = self
            .content
            .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, REGION_DESC_FILE_ID))
            .map_err(|error| {
                (
                    format!(
                        "Could not read {}:0x{REGION_DESC_FILE_ID:08X} from content repository: {error}",
                        EOR_PORTAL_NAMESPACE
                    ),
                    "asset-read-failed",
                )
            })?;

        RegionDesc::unpack(&resource.bytes).map_err(|error| {
            (
                format!("Could not decode RegionDesc 0x{REGION_DESC_FILE_ID:08X}: {error}"),
                "asset-decode-failed",
            )
        })
    }

    fn load_scene(&self, scene_id: u32) -> Result<Scene, (String, &'static str)> {
        let resource = self
            .content
            .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, scene_id))
            .map_err(|error| {
                (
                    format!(
                        "Could not read {}:0x{scene_id:08X} from content repository: {error}",
                        EOR_PORTAL_NAMESPACE
                    ),
                    "asset-read-failed",
                )
            })?;

        Scene::unpack(&resource.bytes).map_err(|error| {
            (
                format!("Could not decode Scene 0x{scene_id:08X}: {error}"),
                "asset-decode-failed",
            )
        })
    }

    fn load_cell_landblock_payload(
        &self,
        landblock_id: u32,
    ) -> Result<serde_json::Value, (String, &'static str)> {
        let resource = self
            .content
            .read_resource(ResourceKey::new(EOR_CELL_NAMESPACE, landblock_id))
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

    fn load_gfx_obj_payload(
        &self,
        gfx_obj_id: u32,
    ) -> Result<serde_json::Value, (String, &'static str)> {
        let resource = self
            .content
            .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, gfx_obj_id))
            .map_err(|error| {
                (
                    format!(
                        "Could not read {}:0x{gfx_obj_id:08X} from content repository: {error}",
                        EOR_PORTAL_NAMESPACE
                    ),
                    "asset-read-failed",
                )
            })?;
        let source_detail = resource.source_description.clone();
        let gfx_obj =
            GfxObj::unpack(&mut std::io::Cursor::new(resource.bytes)).map_err(|error| {
                (
                    format!("Could not decode GfxObj 0x{gfx_obj_id:08X}: {error}"),
                    "asset-decode-failed",
                )
            })?;

        Ok(serde_json::json!({
            "kind": "gfx-obj",
            "residencyKind": "unknown",
            "sourceAssetKind": "gfx-obj",
            "gfxObjId": gfx_obj.id,
            "flags": gfx_obj.flags.bits(),
            "surfaceIds": gfx_obj.surfaces,
            "vertexArray": serialize_vertex_array(&gfx_obj.vertex_array),
            "drawingPolygons": serialize_polygons(&gfx_obj.polygons),
            "drawingBsp": gfx_obj.drawing_bsp.as_ref().map(serialize_bsp_node),
            "physicsWitness": {
                "polygonCount": gfx_obj.physics_polygons.len(),
                "hasBsp": gfx_obj.physics_bsp.is_some()
            },
            "sortCenter": serialize_vector3(&gfx_obj.sort_center),
            "didDegrade": gfx_obj.did_degrade,
            "provenance": {
                "source": "repo-local-hba",
                "sourceAssetKind": "gfx-obj",
                "errorCode": null,
                "detail": source_detail
            }
        }))
    }

    fn load_setup_model_payload(
        &self,
        setup_model_id: u32,
    ) -> Result<serde_json::Value, (String, &'static str)> {
        let resource = self
            .content
            .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, setup_model_id))
            .map_err(|error| {
                (
                    format!(
                        "Could not read {}:0x{setup_model_id:08X} from content repository: {error}",
                        EOR_PORTAL_NAMESPACE
                    ),
                    "asset-read-failed",
                )
            })?;
        let source_detail = resource.source_description.clone();
        let setup_model =
            SetupModel::unpack(&mut std::io::Cursor::new(resource.bytes)).map_err(|error| {
                (
                    format!("Could not decode SetupModel 0x{setup_model_id:08X}: {error}"),
                    "asset-decode-failed",
                )
            })?;

        Ok(serde_json::json!({
            "kind": "setup-model",
            "residencyKind": "unknown",
            "sourceAssetKind": "setup-model",
            "setupModelId": setup_model.id,
            "flags": setup_model.flags,
            "parts": serialize_setup_model_parts(&setup_model),
            "holdingLocations": serialize_location_map(&setup_model.holding_locations),
            "connectionPoints": serialize_location_map(&setup_model.connection_points),
            "placementFrames": serialize_placement_frames(&setup_model),
            "collisionWitness": {
                "cylSphereCount": setup_model.cyl_spheres.len(),
                "sphereCount": setup_model.spheres.len(),
            },
            "height": setup_model.height,
            "radius": setup_model.radius,
            "stepUp": setup_model.step_up,
            "stepDown": setup_model.step_down,
            "sortingSphere": serialize_sphere(&setup_model.sorting_sphere),
            "selectionSphere": serialize_sphere(&setup_model.selection_sphere),
            "lights": serialize_lights(&setup_model.lights),
            "defaultAnimation": setup_model.default_animation,
            "defaultScript": setup_model.default_script,
            "defaultMotionTable": setup_model.default_motion_table,
            "defaultSoundTable": setup_model.default_sound_table,
            "defaultScriptTable": setup_model.default_script_table,
            "provenance": {
                "source": "repo-local-hba",
                "sourceAssetKind": "setup-model",
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
            .read_resource(ResourceKey::new(EOR_CELL_NAMESPACE, env_cell_id))
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

fn parse_landblock_statics_asset_id(asset_id: &str) -> Option<u32> {
    asset_id
        .strip_prefix("landblock-statics/")
        .filter(|hex| hex.len() == 8 && hex.chars().all(|ch| ch.is_ascii_hexdigit()))
        .and_then(|hex| u32::from_str_radix(hex, 16).ok())
        .map(normalize_landblock_id)
}

fn parse_landblock_generated_scenery_asset_id(asset_id: &str) -> Option<u32> {
    asset_id
        .strip_prefix("landblock-generated-scenery/")
        .filter(|hex| hex.len() == 8 && hex.chars().all(|ch| ch.is_ascii_hexdigit()))
        .and_then(|hex| u32::from_str_radix(hex, 16).ok())
        .map(normalize_landblock_id)
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

fn parse_gfx_obj_asset_id(asset_id: &str) -> Option<u32> {
    let raw_hex = asset_id.strip_prefix("gfx-obj/")?;
    let hex = raw_hex
        .strip_prefix("0x")
        .or_else(|| raw_hex.strip_prefix("0X"))
        .unwrap_or(raw_hex);

    (hex.len() == 8 && hex.chars().all(|ch| ch.is_ascii_hexdigit()))
        .then(|| u32::from_str_radix(hex, 16).ok())
        .flatten()
        .filter(|id| (id >> 24) == 0x01)
}

fn parse_setup_model_asset_id(asset_id: &str) -> Option<u32> {
    let raw_hex = asset_id.strip_prefix("setup-model/")?;
    let hex = raw_hex
        .strip_prefix("0x")
        .or_else(|| raw_hex.strip_prefix("0X"))
        .unwrap_or(raw_hex);

    (hex.len() == 8 && hex.chars().all(|ch| ch.is_ascii_hexdigit()))
        .then(|| u32::from_str_radix(hex, 16).ok())
        .flatten()
        .filter(|id| (id >> 24) == 0x02)
}

fn normalize_landblock_id(raw_landblock_id: u32) -> u32 {
    (raw_landblock_id & 0xffff_0000) | 0xffff
}

fn format_renderable_asset_id(did: u32) -> Option<String> {
    match did >> 24 {
        0x01 => Some(format!("gfx-obj/{did:08x}")),
        0x02 => Some(format!("setup-model/{did:08x}")),
        _ => None,
    }
}

struct TerrainSample {
    height: f32,
    normal_z: f32,
}

fn select_generated_scene_id(scenes: &[u32], global_cell_x: u32, global_cell_y: u32) -> u32 {
    let cell_mat = global_cell_y
        .wrapping_mul(
            712_977_289u32
                .wrapping_mul(global_cell_x)
                .wrapping_add(1_813_693_831),
        )
        .wrapping_sub(1_109_124_029u32.wrapping_mul(global_cell_x))
        .wrapping_add(2_139_937_281);
    let offset = f64::from(cell_mat) * GENERATED_SCENERY_RANDOM_UNIT;
    let scene_index = (scenes.len() as f64 * offset) as usize;
    scenes.get(scene_index).copied().unwrap_or(scenes[0])
}

fn generated_template_noise(global_cell_x: u32, global_cell_y: u32, template_index: u32) -> f32 {
    let cell_x_mat = 0u32.wrapping_sub(1_109_124_029u32.wrapping_mul(global_cell_x));
    let cell_y_mat = 1_813_693_831u32.wrapping_mul(global_cell_y);
    let cell_mat = 1_360_117_743u32
        .wrapping_mul(global_cell_x)
        .wrapping_mul(global_cell_y)
        .wrapping_add(1_888_038_839);
    f64::from(
        cell_x_mat
            .wrapping_add(cell_y_mat)
            .wrapping_sub(cell_mat.wrapping_mul(23_399u32.wrapping_add(template_index))),
    )
    .mul_add(GENERATED_SCENERY_RANDOM_UNIT, 0.0) as f32
}

fn displace_generated_template(
    template: &SceneObjectTemplate,
    global_cell_x: u32,
    global_cell_y: u32,
    template_index: u32,
) -> Vector3 {
    let base = template.base_frame.origin;
    let x = if template.displace_x <= 0.0 {
        base.x
    } else {
        (generated_template_random(global_cell_x, global_cell_y, template_index, 45_773)
            * f64::from(template.displace_x)) as f32
            + base.x
    };
    let y = if template.displace_y <= 0.0 {
        base.y
    } else {
        (generated_template_random(global_cell_x, global_cell_y, template_index, 72_719)
            * f64::from(template.displace_y)) as f32
            + base.y
    };
    let quadrant = f64::from(
        1_813_693_831u32
            .wrapping_mul(global_cell_y)
            .wrapping_sub(
                global_cell_x.wrapping_mul(
                    1_870_387_557u32
                        .wrapping_mul(global_cell_y)
                        .wrapping_add(1_109_124_029),
                ),
            )
            .wrapping_sub(402_451_965),
    ) * GENERATED_SCENERY_RANDOM_UNIT;

    if quadrant >= 0.75 {
        Vector3::new(y, -x, base.z)
    } else if quadrant >= 0.5 {
        Vector3::new(-x, -y, base.z)
    } else if quadrant >= 0.25 {
        Vector3::new(-y, x, base.z)
    } else {
        Vector3::new(x, y, base.z)
    }
}

fn scale_generated_template(
    template: &SceneObjectTemplate,
    global_cell_x: u32,
    global_cell_y: u32,
    template_index: u32,
) -> f32 {
    if (template.min_scale - template.max_scale).abs() <= f32::EPSILON {
        return template.max_scale;
    }

    (f64::from(template.max_scale / template.min_scale).powf(generated_template_random(
        global_cell_x,
        global_cell_y,
        template_index,
        32_593,
    )) as f32)
        * template.min_scale
}

fn build_generated_template_frame(
    template: &SceneObjectTemplate,
    global_cell_x: u32,
    global_cell_y: u32,
    template_index: u32,
    local_x: f32,
    local_y: f32,
    local_z: f32,
) -> serde_json::Value {
    let orientation = if template.max_rotation_degrees > 0.0 {
        let heading_degrees =
            (generated_template_random(global_cell_x, global_cell_y, template_index, 63_127)
                * f64::from(template.max_rotation_degrees)) as f32;
        Quaternion::from_heading(heading_degrees.to_radians())
    } else {
        template.base_frame.orientation
    };

    serde_json::json!({
        "origin": { "x": local_x, "y": local_y, "z": local_z },
        "orientation": serialize_quaternion_dto(&orientation),
    })
}

fn generated_template_random(
    global_cell_x: u32,
    global_cell_y: u32,
    template_index: u32,
    salt: u32,
) -> f64 {
    f64::from(
        1_813_693_831u32
            .wrapping_mul(global_cell_y)
            .wrapping_sub(
                template_index.wrapping_add(salt).wrapping_mul(
                    1_360_117_743u32
                        .wrapping_mul(global_cell_y)
                        .wrapping_mul(global_cell_x)
                        .wrapping_add(1_888_038_839),
                ),
            )
            .wrapping_sub(1_109_124_029u32.wrapping_mul(global_cell_x)),
    ) * GENERATED_SCENERY_RANDOM_UNIT
}

fn generated_scenery_on_road(landblock: &CellLandblock, x: f32, y: f32) -> bool {
    let cell_x = (x / GENERATED_SCENERY_CELL_SIZE).floor() as i32;
    let cell_y = (y / GENERATED_SCENERY_CELL_SIZE).floor() as i32;
    let road_width = 5.0;
    let road_min = road_width;
    let road_max = GENERATED_SCENERY_CELL_SIZE - road_width;
    let roads = [
        get_road(landblock, cell_x, cell_y),
        get_road(landblock, cell_x, cell_y + 1),
        get_road(landblock, cell_x + 1, cell_y),
        get_road(landblock, cell_x + 1, cell_y + 1),
    ];
    if roads.iter().all(|road| *road == 0) {
        return false;
    }

    let dx = x - cell_x as f32 * GENERATED_SCENERY_CELL_SIZE;
    let dy = y - cell_y as f32 * GENERATED_SCENERY_CELL_SIZE;
    match (roads[0] > 0, roads[1] > 0, roads[2] > 0, roads[3] > 0) {
        (true, true, true, true) => true,
        (true, true, true, false) => dx < road_min || dy < road_min,
        (true, true, false, true) => dx < road_min || dy > road_max,
        (true, true, false, false) => dx < road_min,
        (true, false, true, true) => dx > road_max || dy < road_min,
        (true, false, true, false) => dy < road_min,
        (true, false, false, true) => (dx - dy).abs() < road_min,
        (true, false, false, false) => dx + dy < road_min,
        (false, true, true, true) => dx > road_max || dy > road_max,
        (false, true, true, false) => (dx + dy - GENERATED_SCENERY_CELL_SIZE).abs() < road_min,
        (false, true, false, true) => dy > road_max,
        (false, true, false, false) => GENERATED_SCENERY_CELL_SIZE + dx - dy < road_min,
        (false, false, true, true) => dx > road_max,
        (false, false, true, false) => GENERATED_SCENERY_CELL_SIZE - dx + dy < road_min,
        (false, false, false, true) => GENERATED_SCENERY_CELL_SIZE * 2.0 - dx - dy < road_min,
        (false, false, false, false) => false,
    }
}

fn get_road(landblock: &CellLandblock, x: i32, y: i32) -> u16 {
    if !(0..9).contains(&x) || !(0..9).contains(&y) {
        return 0;
    }
    landblock.terrain[x as usize * 9 + y as usize] & 0x03
}

fn sample_landblock_terrain(landblock: &CellLandblock, x: f32, y: f32) -> TerrainSample {
    let cell_x = (x / GENERATED_SCENERY_CELL_SIZE).floor().clamp(0.0, 7.0) as usize;
    let cell_y = (y / GENERATED_SCENERY_CELL_SIZE).floor().clamp(0.0, 7.0) as usize;
    let local_x = (x - cell_x as f32 * GENERATED_SCENERY_CELL_SIZE) / GENERATED_SCENERY_CELL_SIZE;
    let local_y = (y - cell_y as f32 * GENERATED_SCENERY_CELL_SIZE) / GENERATED_SCENERY_CELL_SIZE;
    let h00 = landblock.get_height(cell_x, cell_y);
    let h10 = landblock.get_height(cell_x + 1, cell_y);
    let h01 = landblock.get_height(cell_x, cell_y + 1);
    let h11 = landblock.get_height(cell_x + 1, cell_y + 1);
    let west = h00 + (h01 - h00) * local_y;
    let east = h10 + (h11 - h10) * local_y;
    let height = west + (east - west) * local_x;
    let dz_dx = (east - west) / GENERATED_SCENERY_CELL_SIZE;
    let south = h00 + (h10 - h00) * local_x;
    let north = h01 + (h11 - h01) * local_x;
    let dz_dy = (north - south) / GENERATED_SCENERY_CELL_SIZE;
    let normal_z = 1.0 / (1.0 + dz_dx * dz_dx + dz_dy * dz_dy).sqrt();
    TerrainSample { height, normal_z }
}

fn generated_template_matches_slope(template: &SceneObjectTemplate, normal_z: f32) -> bool {
    normal_z >= template.min_slope && normal_z <= template.max_slope
}

fn serialize_vector3(vector: &Vector3) -> serde_json::Value {
    serde_json::json!({
        "x": vector.x,
        "y": vector.y,
        "z": vector.z,
    })
}

fn serialize_vec3_dto(vector: &Vector3) -> Vec3Dto {
    Vec3Dto {
        x: vector.x,
        y: vector.y,
        z: vector.z,
    }
}

fn serialize_quaternion_dto(quaternion: &Quaternion) -> QuaternionDto {
    QuaternionDto {
        w: quaternion.w,
        x: quaternion.x,
        y: quaternion.y,
        z: quaternion.z,
    }
}

fn serialize_landblock_frame_dto(frame: &holtburger_dat::landblock::Frame) -> FrameDto {
    FrameDto {
        origin: serialize_vec3_dto(&frame.origin),
        orientation: serialize_quaternion_dto(&frame.orientation),
    }
}

fn serialize_quaternion(quaternion: &Quaternion) -> serde_json::Value {
    serde_json::json!({
        "w": quaternion.w,
        "x": quaternion.x,
        "y": quaternion.y,
        "z": quaternion.z,
    })
}

fn serialize_frame(frame: &holtburger_dat::graphics::Frame) -> serde_json::Value {
    serde_json::json!({
        "origin": serialize_vector3(&frame.origin),
        "orientation": serialize_quaternion(&frame.orientation),
    })
}

fn serialize_sphere(sphere: &holtburger_common::Sphere) -> serde_json::Value {
    serde_json::json!({
        "center": serialize_vector3(&sphere.center),
        "radius": sphere.radius,
    })
}

fn serialize_setup_model_parts(setup_model: &SetupModel) -> Vec<serde_json::Value> {
    setup_model
        .parts
        .iter()
        .enumerate()
        .map(|(index, gfx_obj_id)| {
            serde_json::json!({
                "partIndex": index,
                "gfxObjId": gfx_obj_id,
                "gfxObjAssetId": format!("gfx-obj/{gfx_obj_id:08x}"),
                "parentIndex": setup_model.parent_index.get(index).copied(),
                "scale": setup_model.default_scale.get(index).map(serialize_vector3),
            })
        })
        .collect()
}

fn serialize_location_map(
    locations: &std::collections::HashMap<
        i32,
        holtburger_dat::file_type::setup_model::LocationType,
    >,
) -> Vec<serde_json::Value> {
    let mut entries = locations.iter().collect::<Vec<_>>();
    entries.sort_by_key(|(key, _)| **key);
    entries
        .into_iter()
        .map(|(key, location)| {
            serde_json::json!({
                "key": key,
                "partId": location.part_id,
                "frame": serialize_frame(&location.frame),
            })
        })
        .collect()
}

fn serialize_placement_frames(setup_model: &SetupModel) -> Vec<serde_json::Value> {
    let mut entries = setup_model.placement_frames.iter().collect::<Vec<_>>();
    entries.sort_by_key(|(key, _)| **key);
    entries
        .into_iter()
        .map(|(key, placement)| {
            serde_json::json!({
                "key": key,
                "frames": placement
                    .anim_frame
                    .frames
                    .iter()
                    .map(serialize_frame)
                    .collect::<Vec<_>>(),
                "hookCount": placement.anim_frame.hooks.len(),
            })
        })
        .collect()
}

fn serialize_lights(
    lights: &std::collections::HashMap<i32, holtburger_dat::file_type::setup_model::LightInfo>,
) -> Vec<serde_json::Value> {
    let mut entries = lights.iter().collect::<Vec<_>>();
    entries.sort_by_key(|(key, _)| **key);
    entries
        .into_iter()
        .map(|(key, light)| {
            serde_json::json!({
                "key": key,
                "viewerSpaceLocation": serialize_frame(&light.viewer_space_location),
                "color": light.color,
                "intensity": light.intensity,
                "falloff": light.falloff,
                "coneAngle": light.cone_angle,
            })
        })
        .collect()
}

fn serialize_vertex_array(vertex_array: &CVertexArray) -> serde_json::Value {
    let mut vertices = vertex_array.vertices.iter().collect::<Vec<_>>();
    vertices.sort_by_key(|(id, _)| **id);

    serde_json::json!({
        "vertexType": vertex_array.vertex_type,
        "vertexCount": vertex_array.vertices.len(),
        "vertices": vertices
            .into_iter()
            .map(|(id, vertex)| {
                serde_json::json!({
                    "id": id,
                    "origin": serialize_vector3(&vertex.origin),
                    "normal": serialize_vector3(&vertex.normal),
                    "uvs": vertex.uvs.iter().map(|uv| {
                        serde_json::json!({
                            "u": uv.u,
                            "v": uv.v,
                        })
                    }).collect::<Vec<_>>(),
                })
            })
            .collect::<Vec<_>>(),
    })
}

fn serialize_polygons(
    polygons: &std::collections::HashMap<u16, Polygon>,
) -> Vec<serde_json::Value> {
    let mut entries = polygons.iter().collect::<Vec<_>>();
    entries.sort_by_key(|(id, _)| **id);

    entries
        .into_iter()
        .map(|(id, polygon)| {
            serde_json::json!({
                "id": id,
                "numPts": polygon.num_pts,
                "stippling": polygon.stippling,
                "sidesType": polygon.sides_type,
                "posSurface": polygon.pos_surface,
                "negSurface": polygon.neg_surface,
                "vertexIds": polygon.vertex_ids,
                "posUvIndices": polygon.pos_uv_indices,
                "negUvIndices": polygon.neg_uv_indices,
            })
        })
        .collect()
}

fn serialize_bsp_node(node: &BspNode) -> serde_json::Value {
    match node {
        BspNode::Port(portal) => serde_json::json!({
            "kind": "port",
            "plane": {
                "normal": serialize_vector3(&portal.plane.normal),
                "d": portal.plane.d,
            },
            "pos": serialize_bsp_node(&portal.pos),
            "neg": serialize_bsp_node(&portal.neg),
            "sphere": portal.sphere.as_ref().map(|sphere| {
                serde_json::json!({
                    "center": serialize_vector3(&sphere.center),
                    "radius": sphere.radius,
                })
            }),
            "polyIds": portal.poly_ids,
            "portalPolys": portal.portal_polys.iter().map(|portal_poly| {
                serde_json::json!({
                    "portalIndex": portal_poly.portal_index,
                    "polyId": portal_poly.poly_id,
                })
            }).collect::<Vec<_>>(),
        }),
        BspNode::Leaf(leaf) => serde_json::json!({
            "kind": "leaf",
            "index": leaf.index,
            "solid": leaf.solid,
            "sphere": leaf.sphere.as_ref().map(|sphere| {
                serde_json::json!({
                    "center": serialize_vector3(&sphere.center),
                    "radius": sphere.radius,
                })
            }),
            "polyIds": leaf.poly_ids,
        }),
        BspNode::Internal(internal) => serde_json::json!({
            "kind": "internal",
            "tag": std::str::from_utf8(&internal.tag).unwrap_or("????"),
            "plane": {
                "normal": serialize_vector3(&internal.plane.normal),
                "d": internal.plane.d,
            },
            "pos": internal.pos.as_ref().map(|pos| serialize_bsp_node(pos)),
            "neg": internal.neg.as_ref().map(|neg| serialize_bsp_node(neg)),
            "sphere": internal.sphere.as_ref().map(|sphere| {
                serde_json::json!({
                    "center": serialize_vector3(&sphere.center),
                    "radius": sphere.radius,
                })
            }),
            "polyIds": internal.poly_ids,
        }),
    }
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
        let runtime = HostRuntimeService::new(false);

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
        let runtime = HostRuntimeService::new(false);

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
    fn runtime_batch_does_not_push_outdoor_static_content_facts() {
        let runtime = HostRuntimeService::new(false);

        let batch = runtime.runtime_batch();

        assert_eq!(batch.residency.focus_landblock_id, 0x0102_000C);
    }

    #[test]
    fn landblock_static_asset_derivation_covers_objects_and_buildings() {
        let adapter = HostBoundaryAdapter::new(false);
        let object_landblock_id = find_landblock_with_renderable_object(&adapter)
            .expect("fixture should contain at least one renderable static object");
        let building_landblock_id = find_landblock_with_renderable_building(&adapter)
            .expect("fixture should contain at least one renderable building");

        let object_payload = adapter
            .load_landblock_statics_payload(object_landblock_id)
            .expect("object landblock static facts should decode");
        assert_eq!(object_payload["kind"], "landblock-statics");
        assert!(
            object_payload["sceneryInstances"]
                .as_array()
                .expect("scenery instances should be an array")
                .iter()
                .any(|instance| {
                    instance["owningLandblockId"] == object_landblock_id
                        && instance["instanceId"]
                            .as_str()
                            .is_some_and(|id| id.contains("/object/"))
                        && instance["sourceAssetId"].as_str().is_some_and(|id| {
                            id.starts_with("setup-model/") || id.starts_with("gfx-obj/")
                        })
                })
        );

        let building_payload = adapter
            .load_landblock_statics_payload(building_landblock_id)
            .expect("building landblock static facts should decode");
        assert!(
            building_payload["buildingInstances"]
                .as_array()
                .expect("building instances should be an array")
                .iter()
                .any(|instance| {
                    instance["owningLandblockId"] == building_landblock_id
                        && instance["instanceId"]
                            .as_str()
                            .is_some_and(|id| id.contains("/building/"))
                        && instance["numLeaves"]
                            .as_u64()
                            .is_some_and(|count| count > 0)
                        && instance["sourceAssetId"].as_str().is_some_and(|id| {
                            id.starts_with("setup-model/") || id.starts_with("gfx-obj/")
                        })
                })
        );
    }

    #[test]
    fn populated_landblock_info_with_building_portals_does_not_fall_back_to_stub() {
        let adapter = HostBoundaryAdapter::new(false);

        let payload = adapter
            .load_landblock_statics_payload(0xda55ffff)
            .expect("portal-bearing landblock static facts should decode");

        assert_eq!(payload["kind"], "landblock-statics");
        assert_eq!(payload["provenance"]["source"], "repo-local-hba");
        assert_eq!(
            payload["sceneryInstances"]
                .as_array()
                .expect("scenery instances should be an array")
                .len(),
            115
        );
        assert_eq!(
            payload["buildingInstances"]
                .as_array()
                .expect("building instances should be an array")
                .len(),
            42
        );
    }

    #[test]
    fn generated_outdoor_scenery_asset_derives_scene_table_instances() {
        let adapter = HostBoundaryAdapter::new(false);

        let payload = adapter
            .load_landblock_generated_scenery_payload(0xda55ffff)
            .expect("generated outdoor scenery facts should decode");

        assert_eq!(payload["kind"], "landblock-generated-scenery");
        assert_eq!(payload["provenance"]["source"], "repo-local-hba");
        let instances = payload["sceneryInstances"]
            .as_array()
            .expect("generated scenery instances should be an array");
        assert!(
            instances.iter().any(|instance| {
                instance["owningLandblockId"] == serde_json::json!(0xda55ffffu32)
                    && instance["instanceId"]
                        .as_str()
                        .is_some_and(|id| id.contains("/scene/"))
                    && instance["sourceAssetId"].as_str().is_some_and(|id| {
                        id.starts_with("setup-model/") || id.starts_with("gfx-obj/")
                    })
                    && instance["scale"]
                        .as_f64()
                        .is_some_and(|scale| scale.is_finite() && scale > 0.0)
            }),
            "fixture should generate at least one renderable scene-table object"
        );
    }

    fn find_landblock_with_renderable_object(adapter: &HostBoundaryAdapter) -> Option<u32> {
        find_landblock_matching(adapter, |info| {
            info.objects
                .iter()
                .any(|object| format_renderable_asset_id(object.id).is_some())
        })
    }

    fn find_landblock_with_renderable_building(adapter: &HostBoundaryAdapter) -> Option<u32> {
        find_landblock_matching(adapter, |info| {
            info.buildings.iter().any(|building| {
                building.num_leaves > 0 && format_renderable_asset_id(building.model_id).is_some()
            })
        })
    }

    fn find_landblock_matching(
        adapter: &HostBoundaryAdapter,
        predicate: impl Fn(&LandblockInfo) -> bool,
    ) -> Option<u32> {
        for x in 0..=0xfe {
            for y in 0..=0xfe {
                let landblock_id = ((x as u32) << 24) | ((y as u32) << 16) | 0xffff;
                let Ok(info) = adapter.load_landblock_info(landblock_id) else {
                    continue;
                };
                if predicate(&info) {
                    return Some(landblock_id);
                }
            }
        }

        None
    }

    #[test]
    fn advancing_runtime_notification_increments_tick_and_updates_view_model_selection() {
        let runtime = HostRuntimeService::new(false);

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
        let runtime = HostRuntimeService::new(false);
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
    fn gfx_obj_lookup_returns_first_class_payload() {
        let runtime = HostRuntimeService::new(false);
        let asset = runtime.asset_lookup(AssetLookupRequestDto {
            request_id: "test-gfx-obj".to_string(),
            asset_id: "gfx-obj/01000001".to_string(),
            priority: crate::contracts::AssetPriorityDto::Streaming,
        });

        assert_eq!(asset.request_id, "test-gfx-obj");
        assert_eq!(asset.asset_id, "gfx-obj/01000001");
        assert!(matches!(asset.payload_kind, AssetPayloadKindDto::Json));
        assert_eq!(asset.payload["kind"], "gfx-obj");
        assert_eq!(asset.payload["sourceAssetKind"], "gfx-obj");
        assert_eq!(asset.payload["gfxObjId"], 0x01000001);
        assert_eq!(asset.payload["residencyKind"], "unknown");
        assert_eq!(asset.payload["provenance"]["source"], "repo-local-hba");
        assert!(
            asset.payload["vertexArray"]["vertexCount"]
                .as_u64()
                .is_some()
        );
        assert!(asset.payload["drawingPolygons"].is_array());
        assert!(
            asset.payload["physicsWitness"]["polygonCount"]
                .as_u64()
                .is_some()
        );
        assert!(asset.payload["physicsWitness"]["hasBsp"].is_boolean());
    }

    #[test]
    fn gfx_obj_lookup_decodes_retail_polygon_stippling_without_vertex_sentinel() {
        let runtime = HostRuntimeService::new(false);
        let asset = runtime.asset_lookup(AssetLookupRequestDto {
            request_id: "test-gfx-obj-stippling".to_string(),
            asset_id: "gfx-obj/01000f69".to_string(),
            priority: crate::contracts::AssetPriorityDto::Streaming,
        });

        assert_eq!(asset.request_id, "test-gfx-obj-stippling");
        assert_eq!(asset.asset_id, "gfx-obj/01000f69");
        assert_eq!(asset.payload["kind"], "gfx-obj");

        let drawing_polygons = asset.payload["drawingPolygons"]
            .as_array()
            .expect("drawing polygons should be an array");
        let has_vertex_sentinel = drawing_polygons.iter().any(|polygon| {
            polygon["vertexIds"]
                .as_array()
                .is_some_and(|vertex_ids| vertex_ids.iter().any(|vertex_id| vertex_id == 0xffff))
        });

        assert!(
            !has_vertex_sentinel,
            "decoded gfx-obj/01000f69 should not contain 0xffff vertex ids"
        );
    }

    #[test]
    fn setup_model_lookup_returns_composite_payload() {
        let runtime = HostRuntimeService::new(false);
        let asset = runtime.asset_lookup(AssetLookupRequestDto {
            request_id: "test-setup-model".to_string(),
            asset_id: "setup-model/02000001".to_string(),
            priority: crate::contracts::AssetPriorityDto::Streaming,
        });

        assert_eq!(asset.request_id, "test-setup-model");
        assert_eq!(asset.asset_id, "setup-model/02000001");
        assert!(matches!(asset.payload_kind, AssetPayloadKindDto::Json));
        assert_eq!(asset.payload["kind"], "setup-model");
        assert_eq!(asset.payload["sourceAssetKind"], "setup-model");
        assert_eq!(asset.payload["setupModelId"], 0x02000001);
        assert_eq!(asset.payload["residencyKind"], "unknown");
        assert_eq!(asset.payload["provenance"]["source"], "repo-local-hba");
        assert!(asset.payload["parts"].as_array().is_some());
        assert!(
            asset.payload["collisionWitness"]["cylSphereCount"]
                .as_u64()
                .is_some()
        );
        assert!(
            asset.payload["collisionWitness"]["sphereCount"]
                .as_u64()
                .is_some()
        );
        assert!(asset.payload["placementFrames"].as_array().is_some());
    }

    #[test]
    fn camera_hints_are_accepted_and_picks_resolve_against_authoritative_debug_entities() {
        let runtime = HostRuntimeService::new(false);
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
