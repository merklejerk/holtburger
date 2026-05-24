use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use holtburger_common::math::{Quaternion, Vector3};
use holtburger_content::{
    ContentDecodeCache, ContentRepository, EnvCellAsset, LandblockBuildingShell,
    LandblockBuildingShellsAsset, LandblockClassification, LandblockOutdoorAsset,
    LandblockOutdoorStaticMember, LandblockPack, LandblockPackSourceDiagnostics,
    LandblockSceneAsset, LandblockSceneBuildingMember, LandblockSceneStaticMember,
    LandblockSummary, LandblockSummaryBuilding, LandblockSummaryBuildingPortal,
    LandblockTerrainAsset, LandblockTopologyAsset, PreparedAabb, PreparedBvh, PreparedBvhNode,
    PreparedInteriorCell, PreparedPolygonSetInvalidPolygon, PreparedPolygonSetRenderGeometry,
    PreparedPolygonSetRenderTriangle, PreparedPortalAperture, PreparedPortalAperturePlane,
    PreparedPortalAperturePlaneSource, PreparedSpatialItem, PreparedSpatialItemKind,
    PreparedSpatialItemMetadata, PreparedStaticInstance, PreparedStaticInstanceKind,
    PreparedStaticMesh, PreparedTerrainMesh, PreparedTerrainTriangle, PreparedVec3,
    ResolvedMaterialRecipe, ResolvedMaterialSlot, ResolvedMaterialSource, ResolvedSetupAppearance,
    ResolvedTerrainMaterialTable, SoulEmoteCatalog, SourceLoadError, SourceOmissionDiagnostic,
    SourceRecordDiagnostic, SourceRecordStatus, StaticOutdoorFrame, StaticOutdoorInstance,
    StaticOutdoorScene, StaticRenderableSourceFamily, build_gfx_obj_render_geometry,
    normalize_landblock_id,
};
use holtburger_core::{
    ContentAsset, ContentAssetRequest, ContentAssetRuntime, ContentAssetService,
};
use holtburger_dat::EOR_CELL_NAMESPACE;
use holtburger_dat::file_type::REGION_DESC_FILE_ID;
use holtburger_dat::file_type::{GfxObj, Palette, RenderSurface, RenderTexture, SetupModel};
use holtburger_dat::file_type::{MotionKinematics, SkillTable, SpellTable, XpTable};
use holtburger_dat::graphics::{CVertexArray, Polygon};
use holtburger_dat::physics::BspNode;
use holtburger_world::WorldBootstrap;

use crate::contracts::{
    AssetLookupRequestDto, AssetLookupResponseDto, AssetPayloadKindDto, CameraHintAckDto,
    CameraHintDto, DebugConfigDto, PlacementTransformDto, QuaternionDto, Vec3Dto,
};

const ASSET_BINARY_MAGIC: &[u8; 4] = b"HBAB";
const ASSET_BINARY_VERSION: u32 = 1;
const ASSET_BINARY_HEADER_LEN: usize = 16;

pub struct HostBoundaryAdapter {
    content_asset_runtime: ContentAssetRuntime,
    verbose: bool,
}

#[derive(Clone)]
pub struct HostRuntimeService {
    state: Arc<Mutex<HostRuntimeState>>,
    adapter: Arc<HostBoundaryAdapter>,
}

struct HostRuntimeState {
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

    pub fn submit_camera_hint(&self, hint: CameraHintDto) -> CameraHintAckDto {
        let mut state = self.state.lock().expect("host runtime state lock poisoned");
        self.adapter.accept_camera_hint(&mut state, hint)
    }

    pub async fn asset_lookup(&self, request: AssetLookupRequestDto) -> AssetLookupResponseDto {
        self.adapter.asset_lookup(request).await
    }

    pub async fn asset_lookup_binary_batch(
        &self,
        requests: Vec<AssetLookupRequestDto>,
    ) -> anyhow::Result<Vec<u8>> {
        self.adapter.asset_lookup_binary_batch(requests).await
    }

    #[cfg(test)]
    fn asset_lookup_blocking(&self, request: AssetLookupRequestDto) -> AssetLookupResponseDto {
        self.adapter.asset_lookup_blocking(request)
    }

    pub fn debug_config(&self) -> DebugConfigDto {
        DebugConfigDto {
            verbose: self.adapter.verbose,
        }
    }
}

impl HostRuntimeState {
    fn new() -> Self {
        let _bootstrap = Arc::new(WorldBootstrap::new(
            SkillTable::default(),
            SpellTable {
                id: SpellTable::FILE_ID,
                spells: Default::default(),
                spell_sets: Default::default(),
            },
            XpTable::default(),
            MotionKinematics::default(),
            SoulEmoteCatalog::default(),
        ));

        Self {
            camera_hint_sequence: 0,
        }
    }
}

impl HostBoundaryAdapter {
    pub fn new(verbose: bool) -> Self {
        let content = ContentRepository::from_hba_path(repo_assets_hba_path())
            .expect("failed to open repo-local 3D app content repository");
        let content = Arc::new(content);
        let decode_cache = Arc::new(ContentDecodeCache::new());
        let content_asset_runtime = ContentAssetRuntime::new(ContentAssetService::new(
            Arc::clone(&content),
            Arc::clone(&decode_cache),
        ));
        Self {
            content_asset_runtime,
            verbose,
        }
    }

    pub async fn asset_lookup(&self, request: AssetLookupRequestDto) -> AssetLookupResponseDto {
        if let Some(content_request) = content_asset_request_from_asset_id(&request.asset_id) {
            let asset = self
                .content_asset_runtime
                .load(content_request.clone())
                .await;
            return self.build_content_asset_lookup_response(request, content_request, asset);
        }

        self.build_app_local_asset_lookup_response(request)
    }

    pub async fn asset_lookup_binary_batch(
        &self,
        requests: Vec<AssetLookupRequestDto>,
    ) -> anyhow::Result<Vec<u8>> {
        let mut writer = BinaryAssetSectionWriter::default();
        let mut responses = Vec::with_capacity(requests.len());
        for request in requests {
            let Some(content_request) = content_asset_request_from_asset_id(&request.asset_id)
            else {
                anyhow::bail!(
                    "binary asset lookup only supports content assets, got {}",
                    request.asset_id
                );
            };

            let response_index = responses.len();
            let path_prefix = format!("responses.{response_index}.payload");
            let asset = self
                .content_asset_runtime
                .load(content_request.clone())
                .await;
            responses.push(serialize_content_asset_binary_response(
                self,
                request,
                content_request,
                asset,
                &path_prefix,
                &mut writer,
            )?);
        }
        serialize_asset_binary_batch_response(responses, writer)
    }

    #[cfg(test)]
    fn asset_lookup_blocking(&self, request: AssetLookupRequestDto) -> AssetLookupResponseDto {
        if self.verbose {
            eprintln!(
                "[holtburger-3d][asset.lookup] request_id={} asset_id={} priority={:?}",
                request.request_id, request.asset_id, request.priority
            );
        }

        if let Some(content_request) = content_asset_request_from_asset_id(&request.asset_id) {
            let asset = self
                .content_asset_runtime
                .load_blocking(content_request.clone());
            return self.build_content_asset_lookup_response(request, content_request, asset);
        }

        self.build_app_local_asset_lookup_response(request)
    }

    fn build_content_asset_lookup_response(
        &self,
        request: AssetLookupRequestDto,
        content_request: ContentAssetRequest,
        asset: anyhow::Result<ContentAsset>,
    ) -> AssetLookupResponseDto {
        match content_request {
            ContentAssetRequest::LandblockPack(landblock_id) => match asset {
                Ok(ContentAsset::LandblockPack(pack)) => {
                    self.build_landblock_pack_lookup_response(request, *pack)
                }
                Ok(_) => unreachable!("content asset runtime returned mismatched landblock pack"),
                Err(error) => self.build_failed_landblock_pack_lookup_response(
                    request,
                    normalize_landblock_id(landblock_id),
                    error,
                ),
            },
            ContentAssetRequest::LandblockSummary(landblock_id) => match asset {
                Ok(ContentAsset::LandblockSummary(summary)) => {
                    self.build_landblock_summary_lookup_response(request, *summary)
                }
                Ok(_) => {
                    unreachable!("content asset runtime returned mismatched landblock summary")
                }
                Err(error) => self.build_failed_landblock_summary_lookup_response(
                    request,
                    normalize_landblock_id(landblock_id),
                    error,
                ),
            },
            ContentAssetRequest::LandblockTerrain(landblock_id) => match asset {
                Ok(ContentAsset::LandblockTerrain {
                    terrain,
                    region_id,
                    region_number,
                }) => self.build_landblock_terrain_lookup_response(
                    request,
                    *terrain,
                    region_id,
                    region_number,
                ),
                Ok(_) => {
                    unreachable!("content asset runtime returned mismatched landblock terrain")
                }
                Err(error) => self.build_failed_landblock_terrain_lookup_response(
                    request,
                    normalize_landblock_id(landblock_id),
                    error,
                ),
            },
            ContentAssetRequest::LandblockBuildingShells(landblock_id) => match asset {
                Ok(ContentAsset::LandblockBuildingShells(building_shells)) => {
                    self.build_landblock_building_shells_lookup_response(request, *building_shells)
                }
                Ok(_) => unreachable!(
                    "content asset runtime returned mismatched landblock building shells"
                ),
                Err(error) => self.build_failed_landblock_building_shells_lookup_response(
                    request,
                    normalize_landblock_id(landblock_id),
                    error,
                ),
            },
            ContentAssetRequest::LandblockScene(landblock_id) => match asset {
                Ok(ContentAsset::LandblockScene(pack)) => {
                    self.build_landblock_scene_lookup_response(request, *pack)
                }
                Ok(_) => unreachable!("content asset runtime returned mismatched landblock scene"),
                Err(error) => self.build_failed_landblock_scene_lookup_response(
                    request,
                    normalize_landblock_id(landblock_id),
                    error,
                ),
            },
            ContentAssetRequest::LandblockOutdoor(landblock_id) => match asset {
                Ok(ContentAsset::LandblockOutdoor {
                    outdoor,
                    region_id,
                    region_number,
                }) => self.build_landblock_outdoor_lookup_response(
                    request,
                    *outdoor,
                    region_id,
                    region_number,
                ),
                Ok(_) => {
                    unreachable!("content asset runtime returned mismatched landblock outdoor")
                }
                Err(error) => self.build_failed_landblock_outdoor_lookup_response(
                    request,
                    normalize_landblock_id(landblock_id),
                    error,
                ),
            },
            ContentAssetRequest::LandblockTopology(landblock_id) => match asset {
                Ok(ContentAsset::LandblockTopology(topology)) => {
                    self.build_landblock_topology_lookup_response(request, *topology)
                }
                Ok(_) => {
                    unreachable!("content asset runtime returned mismatched landblock topology")
                }
                Err(error) => self.build_failed_landblock_topology_lookup_response(
                    request,
                    normalize_landblock_id(landblock_id),
                    error,
                ),
            },
            ContentAssetRequest::EnvCell(env_cell_id) => match asset {
                Ok(ContentAsset::EnvCell(env_cell)) => {
                    self.build_env_cell_lookup_response(request, env_cell_id, *env_cell)
                }
                Ok(_) => unreachable!("content asset runtime returned mismatched env-cell"),
                Err(error) => {
                    self.build_failed_env_cell_lookup_response(request, env_cell_id, error)
                }
            },
            ContentAssetRequest::TerrainMaterial(region_number) => {
                self.build_terrain_material_lookup_response(request, region_number, asset)
            }
            ContentAssetRequest::GfxObj(gfx_obj_id) => {
                self.build_gfx_obj_lookup_response(request, gfx_obj_id, asset)
            }
            ContentAssetRequest::SetupModel(setup_model_id) => {
                self.build_setup_model_lookup_response(request, setup_model_id, asset)
            }
            ContentAssetRequest::MaterialRecipe(surface_id) => {
                self.build_material_recipe_lookup_response(request, surface_id, asset)
            }
            ContentAssetRequest::SetupAppearance(setup_model_id) => {
                self.build_setup_appearance_lookup_response(request, setup_model_id, asset)
            }
            ContentAssetRequest::RenderTexture(render_texture_id) => {
                self.build_render_texture_lookup_response(request, render_texture_id, asset)
            }
            ContentAssetRequest::RenderSurface(render_surface_id) => {
                self.build_render_surface_lookup_response(request, render_surface_id, asset)
            }
            ContentAssetRequest::Palette(palette_id) => {
                self.build_palette_lookup_response(request, palette_id, asset)
            }
        }
    }

    fn build_app_local_asset_lookup_response(
        &self,
        request: AssetLookupRequestDto,
    ) -> AssetLookupResponseDto {
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
                "interior-cell",
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

    fn accept_camera_hint(
        &self,
        state: &mut HostRuntimeState,
        _hint: CameraHintDto,
    ) -> CameraHintAckDto {
        state.camera_hint_sequence += 1;
        let sequence = state.camera_hint_sequence;

        CameraHintAckDto {
            accepted: true,
            sequence,
        }
    }
}

impl HostBoundaryAdapter {
    fn build_landblock_pack_lookup_response(
        &self,
        request: AssetLookupRequestDto,
        pack: LandblockPack,
    ) -> AssetLookupResponseDto {
        let payload = serialize_landblock_pack(&pack);

        AssetLookupResponseDto {
            request_id: request.request_id,
            asset_id: request.asset_id,
            payload_kind: AssetPayloadKindDto::Json,
            payload,
        }
    }

    fn build_failed_landblock_pack_lookup_response(
        &self,
        request: AssetLookupRequestDto,
        landblock_id: u32,
        error: anyhow::Error,
    ) -> AssetLookupResponseDto {
        AssetLookupResponseDto {
            request_id: request.request_id,
            asset_id: request.asset_id,
            payload_kind: AssetPayloadKindDto::Json,
            payload: serde_json::json!({
                "kind": "landblock-pack",
                "residencyKind": "landblock",
                "sourceAssetKind": "landblock-pack",
                "landblockId": landblock_id,
                "landblockInfoId": landblock_id & 0xffff_fffe,
                "classification": "outdoor",
                "sourceFacts": {
                    "buildings": []
                },
                "prepared": {
                    "terrainMesh": null,
                    "outdoorStaticInstances": [],
                    "interiorCells": [],
                    "staticMeshes": [],
                    "spatialItems": [],
                    "staticLandblockBvh": null
                },
                "dependencies": {
                    "cellDatIds": [landblock_id, landblock_id & 0xffff_fffe],
                    "portalDatIds": [],
                    "renderableAssetIds": [],
                    "missing": [],
                    "unsupported": []
                },
                "diagnostics": {
                    "sourceRecords": [],
                    "errors": [{
                        "namespace": EOR_CELL_NAMESPACE,
                        "fileId": landblock_id,
                        "role": "landblock-pack",
                        "errorCode": asset_cache_error_code(&error),
                        "detail": format!("{error:#}")
                    }]
                },
                "provenance": {
                    "source": "app-local-stub",
                    "sourceAssetKind": "landblock-pack",
                    "errorCode": asset_cache_error_code(&error),
                    "detail": format!("{error:#}")
                }
            }),
        }
    }

    fn build_landblock_summary_lookup_response(
        &self,
        request: AssetLookupRequestDto,
        summary: LandblockSummary,
    ) -> AssetLookupResponseDto {
        AssetLookupResponseDto {
            request_id: request.request_id,
            asset_id: request.asset_id,
            payload_kind: AssetPayloadKindDto::Json,
            payload: serialize_landblock_summary(&summary),
        }
    }

    fn build_failed_landblock_summary_lookup_response(
        &self,
        request: AssetLookupRequestDto,
        landblock_id: u32,
        error: anyhow::Error,
    ) -> AssetLookupResponseDto {
        AssetLookupResponseDto {
            request_id: request.request_id,
            asset_id: request.asset_id,
            payload_kind: AssetPayloadKindDto::Json,
            payload: serde_json::json!({
                "kind": "landblock-summary",
                "residencyKind": "landblock",
                "sourceAssetKind": "landblock-summary",
                "landblockId": landblock_id,
                "landblockInfoId": landblock_id & 0xffff_fffe,
                "classification": "outdoor",
                "sourceFacts": {
                    "buildings": []
                },
                "prepared": {
                    "terrainMesh": null
                },
                "dependencies": {
                    "cellDatIds": [landblock_id, landblock_id & 0xffff_fffe],
                    "renderableAssetIds": []
                },
                "diagnostics": {
                    "sourceRecords": [],
                    "errors": [{
                        "namespace": EOR_CELL_NAMESPACE,
                        "fileId": landblock_id,
                        "role": "landblock-summary",
                        "errorCode": asset_cache_error_code(&error),
                        "detail": format!("{error:#}")
                    }]
                },
                "provenance": {
                    "source": "app-local-stub",
                    "sourceAssetKind": "landblock-summary",
                    "errorCode": asset_cache_error_code(&error),
                    "detail": format!("{error:#}")
                }
            }),
        }
    }

    fn build_landblock_terrain_lookup_response(
        &self,
        request: AssetLookupRequestDto,
        terrain: LandblockTerrainAsset,
        region_id: u32,
        region_number: u32,
    ) -> AssetLookupResponseDto {
        AssetLookupResponseDto {
            request_id: request.request_id,
            asset_id: request.asset_id,
            payload_kind: AssetPayloadKindDto::Json,
            payload: serialize_landblock_terrain_payload(&terrain, region_id, region_number),
        }
    }

    fn build_failed_landblock_terrain_lookup_response(
        &self,
        request: AssetLookupRequestDto,
        landblock_id: u32,
        error: anyhow::Error,
    ) -> AssetLookupResponseDto {
        AssetLookupResponseDto {
            request_id: request.request_id,
            asset_id: request.asset_id,
            payload_kind: AssetPayloadKindDto::Json,
            payload: failed_landblock_terrain_payload(landblock_id, error),
        }
    }

    fn build_landblock_building_shells_lookup_response(
        &self,
        request: AssetLookupRequestDto,
        building_shells: LandblockBuildingShellsAsset,
    ) -> AssetLookupResponseDto {
        AssetLookupResponseDto {
            request_id: request.request_id,
            asset_id: request.asset_id,
            payload_kind: AssetPayloadKindDto::Json,
            payload: serialize_landblock_building_shells_payload(&building_shells),
        }
    }

    fn build_failed_landblock_building_shells_lookup_response(
        &self,
        request: AssetLookupRequestDto,
        landblock_id: u32,
        error: anyhow::Error,
    ) -> AssetLookupResponseDto {
        AssetLookupResponseDto {
            request_id: request.request_id,
            asset_id: request.asset_id,
            payload_kind: AssetPayloadKindDto::Json,
            payload: failed_landblock_building_shells_payload(landblock_id, error),
        }
    }

    fn build_landblock_scene_lookup_response(
        &self,
        request: AssetLookupRequestDto,
        scene: LandblockSceneAsset,
    ) -> AssetLookupResponseDto {
        AssetLookupResponseDto {
            request_id: request.request_id,
            asset_id: request.asset_id,
            payload_kind: AssetPayloadKindDto::Json,
            payload: serialize_landblock_scene_payload(&scene),
        }
    }

    fn build_failed_landblock_scene_lookup_response(
        &self,
        request: AssetLookupRequestDto,
        landblock_id: u32,
        error: anyhow::Error,
    ) -> AssetLookupResponseDto {
        AssetLookupResponseDto {
            request_id: request.request_id,
            asset_id: request.asset_id,
            payload_kind: AssetPayloadKindDto::Json,
            payload: failed_landblock_scene_payload(landblock_id, error),
        }
    }

    fn build_landblock_outdoor_lookup_response(
        &self,
        request: AssetLookupRequestDto,
        outdoor: LandblockOutdoorAsset,
        region_id: u32,
        region_number: u32,
    ) -> AssetLookupResponseDto {
        AssetLookupResponseDto {
            request_id: request.request_id,
            asset_id: request.asset_id,
            payload_kind: AssetPayloadKindDto::Json,
            payload: serialize_landblock_outdoor_payload(&outdoor, region_id, region_number),
        }
    }

    fn build_failed_landblock_outdoor_lookup_response(
        &self,
        request: AssetLookupRequestDto,
        landblock_id: u32,
        error: anyhow::Error,
    ) -> AssetLookupResponseDto {
        AssetLookupResponseDto {
            request_id: request.request_id,
            asset_id: request.asset_id,
            payload_kind: AssetPayloadKindDto::Json,
            payload: failed_landblock_outdoor_payload(landblock_id, error),
        }
    }

    fn build_landblock_topology_lookup_response(
        &self,
        request: AssetLookupRequestDto,
        topology: LandblockTopologyAsset,
    ) -> AssetLookupResponseDto {
        AssetLookupResponseDto {
            request_id: request.request_id,
            asset_id: request.asset_id,
            payload_kind: AssetPayloadKindDto::Json,
            payload: serialize_landblock_topology_payload(&topology),
        }
    }

    fn build_failed_landblock_topology_lookup_response(
        &self,
        request: AssetLookupRequestDto,
        landblock_id: u32,
        error: anyhow::Error,
    ) -> AssetLookupResponseDto {
        AssetLookupResponseDto {
            request_id: request.request_id,
            asset_id: request.asset_id,
            payload_kind: AssetPayloadKindDto::Json,
            payload: failed_landblock_topology_payload(landblock_id, error),
        }
    }

    fn build_env_cell_lookup_response(
        &self,
        request: AssetLookupRequestDto,
        env_cell_id: u32,
        env_cell: EnvCellAsset,
    ) -> AssetLookupResponseDto {
        let payload = if env_cell.prepared_cell.env_cell_id == env_cell_id {
            serialize_env_cell_payload(&env_cell)
        } else {
            failed_env_cell_payload(
                env_cell_id,
                anyhow::anyhow!(
                    "EnvCell assembler returned 0x{:08X} for request 0x{env_cell_id:08X}",
                    env_cell.prepared_cell.env_cell_id
                ),
            )
        };
        AssetLookupResponseDto {
            request_id: request.request_id,
            asset_id: request.asset_id,
            payload_kind: AssetPayloadKindDto::Json,
            payload,
        }
    }

    fn build_failed_env_cell_lookup_response(
        &self,
        request: AssetLookupRequestDto,
        env_cell_id: u32,
        error: anyhow::Error,
    ) -> AssetLookupResponseDto {
        AssetLookupResponseDto {
            request_id: request.request_id,
            asset_id: request.asset_id,
            payload_kind: AssetPayloadKindDto::Json,
            payload: failed_env_cell_payload(env_cell_id, error),
        }
    }

    fn build_terrain_material_lookup_response(
        &self,
        request: AssetLookupRequestDto,
        region_number: u32,
        asset: anyhow::Result<ContentAsset>,
    ) -> AssetLookupResponseDto {
        let payload = match asset {
            Ok(ContentAsset::TerrainMaterial(table)) => serialize_terrain_material_payload(&table),
            Ok(_) => unreachable!("content asset runtime returned mismatched terrain material"),
            Err(error) => failed_terrain_material_payload(region_number, error),
        };
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
        asset: anyhow::Result<ContentAsset>,
    ) -> AssetLookupResponseDto {
        let payload = match asset {
            Ok(ContentAsset::GfxObj(gfx_obj)) => serialize_gfx_obj_payload(&gfx_obj),
            Ok(_) => unreachable!("content asset runtime returned mismatched gfx obj"),
            Err(error) => {
                let detail = format!("{error:#}");
                let error_code = asset_cache_error_code(&error);
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
                    "dependencies": {
                        "materialAssetIds": []
                    },
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
            }
        };

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
        asset: anyhow::Result<ContentAsset>,
    ) -> AssetLookupResponseDto {
        let payload = match asset {
            Ok(ContentAsset::SetupModel(setup_model)) => {
                serialize_setup_model_payload(&setup_model)
            }
            Ok(_) => unreachable!("content asset runtime returned mismatched setup model"),
            Err(error) => {
                let detail = format!("{error:#}");
                let error_code = asset_cache_error_code(&error);
                serde_json::json!({
                "kind": "setup-model",
                "residencyKind": "unknown",
                "sourceAssetKind": "setup-model",
                "setupModelId": setup_model_id,
                "flags": null,
                "parts": [],
                "holdingLocations": [],
                "connectionPoints": [],
                "placementSets": [],
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
                "dependencies": {
                    "gfxObjAssetIds": [],
                    "setupAppearanceAssetId": format_setup_appearance_asset_id(setup_model_id)
                },
                "provenance": {
                    "source": "app-local-stub",
                    "sourceAssetKind": "setup-model",
                    "errorCode": error_code,
                    "detail": detail
                    }
                })
            }
        };

        AssetLookupResponseDto {
            request_id: request.request_id,
            asset_id: request.asset_id,
            payload_kind: AssetPayloadKindDto::Json,
            payload,
        }
    }

    fn build_material_recipe_lookup_response(
        &self,
        request: AssetLookupRequestDto,
        surface_id: u32,
        asset: anyhow::Result<ContentAsset>,
    ) -> AssetLookupResponseDto {
        let payload = match asset {
            Ok(ContentAsset::MaterialRecipe(recipe)) => serialize_material_recipe_payload(&recipe),
            Ok(_) => unreachable!("content asset runtime returned mismatched material recipe"),
            Err(error) => {
                log_material_graph_failure("material-recipe", surface_id, &error);
                failed_dependency_payload("material-recipe", surface_id, error)
            }
        };

        AssetLookupResponseDto {
            request_id: request.request_id,
            asset_id: request.asset_id,
            payload_kind: AssetPayloadKindDto::Json,
            payload,
        }
    }

    fn build_setup_appearance_lookup_response(
        &self,
        request: AssetLookupRequestDto,
        setup_model_id: u32,
        asset: anyhow::Result<ContentAsset>,
    ) -> AssetLookupResponseDto {
        let payload = match asset {
            Ok(ContentAsset::SetupAppearance(appearance)) => {
                serialize_setup_appearance_payload(&appearance)
            }
            Ok(_) => unreachable!("content asset runtime returned mismatched setup appearance"),
            Err(error) => failed_dependency_payload("setup-appearance", setup_model_id, error),
        };

        AssetLookupResponseDto {
            request_id: request.request_id,
            asset_id: request.asset_id,
            payload_kind: AssetPayloadKindDto::Json,
            payload,
        }
    }

    fn build_render_texture_lookup_response(
        &self,
        request: AssetLookupRequestDto,
        render_texture_id: u32,
        asset: anyhow::Result<ContentAsset>,
    ) -> AssetLookupResponseDto {
        let payload = match asset {
            Ok(ContentAsset::RenderTexture(render_texture)) => {
                serialize_render_texture_payload(&render_texture)
            }
            Ok(_) => unreachable!("content asset runtime returned mismatched render texture"),
            Err(error) => {
                log_material_graph_failure("render-texture", render_texture_id, &error);
                failed_dependency_payload("render-texture", render_texture_id, error)
            }
        };

        AssetLookupResponseDto {
            request_id: request.request_id,
            asset_id: request.asset_id,
            payload_kind: AssetPayloadKindDto::Json,
            payload,
        }
    }

    fn build_render_surface_lookup_response(
        &self,
        request: AssetLookupRequestDto,
        render_surface_id: u32,
        asset: anyhow::Result<ContentAsset>,
    ) -> AssetLookupResponseDto {
        let payload = match asset {
            Ok(ContentAsset::RenderSurface(render_surface)) => {
                serialize_render_surface_payload(&render_surface)
            }
            Ok(_) => unreachable!("content asset runtime returned mismatched render surface"),
            Err(error) => {
                log_material_graph_failure("render-surface", render_surface_id, &error);
                failed_dependency_payload("render-surface", render_surface_id, error)
            }
        };

        AssetLookupResponseDto {
            request_id: request.request_id,
            asset_id: request.asset_id,
            payload_kind: AssetPayloadKindDto::Json,
            payload,
        }
    }

    fn build_palette_lookup_response(
        &self,
        request: AssetLookupRequestDto,
        palette_id: u32,
        asset: anyhow::Result<ContentAsset>,
    ) -> AssetLookupResponseDto {
        let payload = match asset {
            Ok(ContentAsset::Palette(palette)) => serialize_palette_payload(&palette),
            Ok(_) => unreachable!("content asset runtime returned mismatched palette"),
            Err(error) => {
                log_material_graph_failure("palette", palette_id, &error);
                failed_dependency_payload("palette", palette_id, error)
            }
        };

        AssetLookupResponseDto {
            request_id: request.request_id,
            asset_id: request.asset_id,
            payload_kind: AssetPayloadKindDto::Json,
            payload,
        }
    }
}

fn asset_cache_error_code(error: &anyhow::Error) -> &'static str {
    if error.to_string().starts_with("Could not read ") {
        "asset-read-failed"
    } else {
        "asset-decode-failed"
    }
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

fn parse_setup_appearance_asset_id(asset_id: &str) -> Option<u32> {
    parse_prefixed_data_id(asset_id, "setup-appearance/", 0x02)
}

fn parse_material_recipe_asset_id(asset_id: &str) -> Option<u32> {
    parse_prefixed_data_id(asset_id, "material/", 0x08)
}

fn parse_render_texture_asset_id(asset_id: &str) -> Option<u32> {
    parse_prefixed_data_id(asset_id, "render-texture/", 0x05)
}

fn parse_render_surface_asset_id(asset_id: &str) -> Option<u32> {
    parse_prefixed_data_id(asset_id, "render-surface/", 0x06)
        .or_else(|| parse_prefixed_data_id(asset_id, "render-surface/", 0x07))
}

fn parse_palette_asset_id(asset_id: &str) -> Option<u32> {
    parse_prefixed_data_id(asset_id, "palette/", 0x04)
}

fn parse_prefixed_data_id(asset_id: &str, prefix: &str, expected_type: u32) -> Option<u32> {
    let raw_hex = asset_id.strip_prefix(prefix)?;
    let hex = raw_hex
        .strip_prefix("0x")
        .or_else(|| raw_hex.strip_prefix("0X"))
        .unwrap_or(raw_hex);

    (hex.len() == 8 && hex.chars().all(|ch| ch.is_ascii_hexdigit()))
        .then(|| u32::from_str_radix(hex, 16).ok())
        .flatten()
        .filter(|id| (id >> 24) == expected_type)
}

fn parse_landblock_pack_asset_id(asset_id: &str) -> Option<u32> {
    asset_id
        .strip_prefix("landblock-pack/")
        .filter(|hex| hex.len() == 8 && hex.chars().all(|ch| ch.is_ascii_hexdigit()))
        .and_then(|hex| u32::from_str_radix(hex, 16).ok())
        .map(normalize_landblock_id)
}

fn parse_landblock_summary_asset_id(asset_id: &str) -> Option<u32> {
    asset_id
        .strip_prefix("landblock-summary/")
        .filter(|hex| hex.len() == 8 && hex.chars().all(|ch| ch.is_ascii_hexdigit()))
        .and_then(|hex| u32::from_str_radix(hex, 16).ok())
        .map(normalize_landblock_id)
}

fn parse_landblock_child_asset_id(asset_id: &str, suffix: &str) -> Option<u32> {
    let rest = asset_id.strip_prefix("landblock/")?;
    let raw_hex = rest.strip_suffix(suffix)?;
    (raw_hex.len() == 8 && raw_hex.chars().all(|ch| ch.is_ascii_hexdigit()))
        .then(|| u32::from_str_radix(raw_hex, 16).ok())
        .flatten()
        .map(normalize_landblock_id)
}

fn parse_landblock_terrain_asset_id(asset_id: &str) -> Option<u32> {
    parse_landblock_child_asset_id(asset_id, "/terrain")
}

fn parse_landblock_building_shells_asset_id(asset_id: &str) -> Option<u32> {
    parse_landblock_child_asset_id(asset_id, "/building-shells")
}

fn parse_landblock_scene_asset_id(asset_id: &str) -> Option<u32> {
    parse_landblock_child_asset_id(asset_id, "/scene")
}

fn parse_landblock_outdoor_asset_id(asset_id: &str) -> Option<u32> {
    parse_landblock_child_asset_id(asset_id, "/outdoor")
}

fn parse_landblock_topology_asset_id(asset_id: &str) -> Option<u32> {
    parse_landblock_child_asset_id(asset_id, "/topology")
}

fn parse_env_cell_asset_id(asset_id: &str) -> Option<u32> {
    asset_id
        .strip_prefix("env-cell/")
        .filter(|hex| hex.len() == 8 && hex.chars().all(|ch| ch.is_ascii_hexdigit()))
        .and_then(|hex| u32::from_str_radix(hex, 16).ok())
        .filter(|id| (*id & 0xffff) >= 0x0100 && (*id & 0xffff) <= 0xfffd)
}

fn parse_terrain_material_asset_id(asset_id: &str) -> Option<u32> {
    asset_id
        .strip_prefix("terrain-material/")
        .filter(|raw| !raw.is_empty() && raw.chars().all(|ch| ch.is_ascii_digit()))
        .and_then(|raw| raw.parse::<u32>().ok())
}

fn content_asset_request_from_asset_id(asset_id: &str) -> Option<ContentAssetRequest> {
    parse_landblock_pack_asset_id(asset_id)
        .map(ContentAssetRequest::LandblockPack)
        .or_else(|| {
            parse_landblock_summary_asset_id(asset_id).map(ContentAssetRequest::LandblockSummary)
        })
        .or_else(|| {
            parse_landblock_terrain_asset_id(asset_id).map(ContentAssetRequest::LandblockTerrain)
        })
        .or_else(|| {
            parse_landblock_building_shells_asset_id(asset_id)
                .map(ContentAssetRequest::LandblockBuildingShells)
        })
        .or_else(|| {
            parse_landblock_scene_asset_id(asset_id).map(ContentAssetRequest::LandblockScene)
        })
        .or_else(|| {
            parse_landblock_outdoor_asset_id(asset_id).map(ContentAssetRequest::LandblockOutdoor)
        })
        .or_else(|| {
            parse_landblock_topology_asset_id(asset_id).map(ContentAssetRequest::LandblockTopology)
        })
        .or_else(|| parse_env_cell_asset_id(asset_id).map(ContentAssetRequest::EnvCell))
        .or_else(|| {
            parse_terrain_material_asset_id(asset_id).map(ContentAssetRequest::TerrainMaterial)
        })
        .or_else(|| parse_gfx_obj_asset_id(asset_id).map(ContentAssetRequest::GfxObj))
        .or_else(|| parse_setup_model_asset_id(asset_id).map(ContentAssetRequest::SetupModel))
        .or_else(|| {
            parse_material_recipe_asset_id(asset_id).map(ContentAssetRequest::MaterialRecipe)
        })
        .or_else(|| {
            parse_setup_appearance_asset_id(asset_id).map(ContentAssetRequest::SetupAppearance)
        })
        .or_else(|| parse_render_texture_asset_id(asset_id).map(ContentAssetRequest::RenderTexture))
        .or_else(|| parse_render_surface_asset_id(asset_id).map(ContentAssetRequest::RenderSurface))
        .or_else(|| parse_palette_asset_id(asset_id).map(ContentAssetRequest::Palette))
}

fn serialize_gfx_obj_payload(gfx_obj: &holtburger_dat::file_type::GfxObj) -> serde_json::Value {
    serde_json::json!({
        "kind": "gfx-obj",
        "residencyKind": "unknown",
        "sourceAssetKind": "gfx-obj",
        "gfxObjId": gfx_obj.id,
        "flags": gfx_obj.flags.bits(),
        "surfaceIds": gfx_obj.surfaces,
        "vertexArray": serialize_vertex_array(&gfx_obj.vertex_array),
        "drawingPolygons": serialize_polygons(&gfx_obj.polygons),
        "drawingBsp": gfx_obj.drawing_bsp.as_ref().map(serialize_bsp_node),
        "dependencies": {
            "materialAssetIds": gfx_obj.surfaces.iter().map(|surface_id| format_material_asset_id(*surface_id)).collect::<Vec<_>>(),
        },
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
            "detail": null
        }
    })
}

fn serialize_setup_model_payload(setup_model: &SetupModel) -> serde_json::Value {
    serde_json::json!({
        "kind": "setup-model",
        "residencyKind": "unknown",
        "sourceAssetKind": "setup-model",
        "setupModelId": setup_model.id,
        "flags": setup_model.flags,
        "parts": serialize_setup_model_parts(setup_model),
        "holdingLocations": serialize_location_map(&setup_model.holding_locations),
        "connectionPoints": serialize_location_map(&setup_model.connection_points),
        "placementSets": serialize_placement_sets(setup_model),
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
        "dependencies": {
            "gfxObjAssetIds": setup_model.parts.iter().map(|gfx_obj_id| format_gfx_obj_asset_id(*gfx_obj_id)).collect::<Vec<_>>(),
            "setupAppearanceAssetId": format_setup_appearance_asset_id(setup_model.id),
        },
        "provenance": {
            "source": "repo-local-hba",
            "sourceAssetKind": "setup-model",
            "errorCode": null,
            "detail": null
        }
    })
}

fn serialize_material_recipe_payload(recipe: &ResolvedMaterialRecipe) -> serde_json::Value {
    let (source, dependencies) = match &recipe.source {
        ResolvedMaterialSource::SolidColor(color) => (
            serde_json::json!({
                "kind": "solid-color",
                "argb": color,
            }),
            serde_json::json!({
                "renderTextureAssetIds": [],
                "renderSurfaceAssetIds": [],
                "paletteAssetIds": [],
            }),
        ),
        ResolvedMaterialSource::Texture(texture) => (
            serde_json::json!({
                "kind": "texture",
                "renderTextureId": texture.render_texture_id,
                "renderSurfaceIds": texture.render_surface_ids,
                "paletteId": texture.palette_id,
                "renderSurfaceDefaultPaletteIds": texture.render_surface_default_palette_ids,
            }),
            serde_json::json!({
                "renderTextureAssetIds": [format_render_texture_asset_id(texture.render_texture_id)],
                "renderSurfaceAssetIds": texture.render_surface_ids.iter().map(|id| format_render_surface_asset_id(*id)).collect::<Vec<_>>(),
                "paletteAssetIds": recipe_palette_asset_ids(texture),
            }),
        ),
    };

    serde_json::json!({
        "kind": "material-recipe",
        "residencyKind": "unknown",
        "sourceAssetKind": "material-recipe",
        "surfaceId": recipe.surface_id,
        "surfaceType": recipe.surface_type.bits(),
        "source": source,
        "translucency": recipe.translucency,
        "luminosity": recipe.luminosity,
        "diffuse": recipe.diffuse,
        "dependencies": dependencies,
        "provenance": {
            "source": "repo-local-hba",
            "sourceAssetKind": "material-recipe",
            "errorCode": null,
            "detail": null
        }
    })
}

fn serialize_setup_appearance_payload(appearance: &ResolvedSetupAppearance) -> serde_json::Value {
    serde_json::json!({
        "kind": "setup-appearance",
        "residencyKind": "unknown",
        "sourceAssetKind": "setup-appearance",
        "setupModelId": appearance.setup_model_id,
        "appearanceKey": appearance.appearance_key,
        "parts": appearance.parts.iter().map(serialize_setup_appearance_part).collect::<Vec<_>>(),
        "textureChanges": appearance.texture_changes.iter().map(|change| {
            serde_json::json!({
                "partIndex": change.part_index,
                "oldTexture": change.old_texture,
                "newTexture": change.new_texture,
            })
        }).collect::<Vec<_>>(),
        "animPartChanges": appearance.anim_part_changes.iter().map(|change| {
            serde_json::json!({
                "partIndex": change.part_index,
                "partId": change.part_id,
            })
        }).collect::<Vec<_>>(),
        "paletteId": appearance.palette_id,
        "subPalettes": appearance.sub_palettes.iter().map(|sub| {
            serde_json::json!({
                "subId": sub.sub_id,
                "offset": sub.offset,
                "numColors": sub.num_colors,
            })
        }).collect::<Vec<_>>(),
        "dependencies": {
            "materialAssetIds": appearance.material_asset_ids.iter().map(|surface_id| format_material_asset_id(*surface_id)).collect::<Vec<_>>(),
            "paletteAssetIds": appearance.palette_dependencies.iter().map(|palette_id| format_palette_asset_id(*palette_id)).collect::<Vec<_>>(),
        },
        "provenance": {
            "source": "repo-local-hba",
            "sourceAssetKind": "setup-appearance",
            "errorCode": null,
            "detail": null
        }
    })
}

fn serialize_setup_appearance_part(
    part: &holtburger_content::ResolvedSetupAppearancePart,
) -> serde_json::Value {
    serde_json::json!({
        "partIndex": part.part_index,
        "gfxObjId": part.gfx_obj_id,
        "gfxObjAssetId": format_gfx_obj_asset_id(part.gfx_obj_id),
        "materialSlots": part.material_slots.iter().map(serialize_material_slot).collect::<Vec<_>>(),
    })
}

fn serialize_material_slot(slot: &ResolvedMaterialSlot) -> serde_json::Value {
    serde_json::json!({
        "slotIndex": slot.slot_index,
        "surfaceId": slot.material.surface_id,
        "materialAssetId": format_material_asset_id(slot.material.surface_id),
    })
}

fn serialize_render_texture_payload(render_texture: &RenderTexture) -> serde_json::Value {
    serde_json::json!({
        "kind": "render-texture",
        "residencyKind": "unknown",
        "sourceAssetKind": "render-texture",
        "renderTextureId": render_texture.id,
        "textureType": render_texture.texture_type,
        "unknown": render_texture.unknown,
        "renderSurfaceIds": render_texture.render_surface_ids,
        "dependencies": {
            "renderSurfaceAssetIds": render_texture.render_surface_ids.iter().map(|id| format_render_surface_asset_id(*id)).collect::<Vec<_>>(),
        },
        "provenance": {
            "source": "repo-local-hba",
            "sourceAssetKind": "render-texture",
            "errorCode": null,
            "detail": null
        }
    })
}

fn serialize_render_surface_payload(render_surface: &RenderSurface) -> serde_json::Value {
    serde_json::json!({
        "kind": "render-surface",
        "residencyKind": "unknown",
        "sourceAssetKind": "render-surface",
        "renderSurfaceId": render_surface.id,
        "unknown": render_surface.unknown,
        "width": render_surface.width,
        "height": render_surface.height,
        "formatRaw": render_surface.format_raw,
        "format": format!("{:?}", render_surface.format),
        "sourceByteLength": render_surface.source_data.len(),
        "defaultPaletteId": render_surface.default_palette_id,
        "dependencies": {
            "paletteAssetIds": render_surface.default_palette_id.into_iter().map(format_palette_asset_id).collect::<Vec<_>>(),
        },
        "provenance": {
            "source": "repo-local-hba",
            "sourceAssetKind": "render-surface",
            "errorCode": null,
            "detail": null
        }
    })
}

fn serialize_render_surface_binary_payload(
    render_surface: &RenderSurface,
    path_prefix: &str,
    writer: &mut BinaryAssetSectionWriter,
) -> serde_json::Value {
    let mut payload = serialize_render_surface_payload(render_surface);
    payload["sourceBytes"] = serde_json::json!([]);
    writer.push_u8_section(
        "renderSurface.sourceBytes",
        format!("{path_prefix}.sourceBytes"),
        1,
        &render_surface.source_data,
    );
    payload
}

fn serialize_palette_payload(palette: &Palette) -> serde_json::Value {
    serde_json::json!({
        "kind": "palette",
        "residencyKind": "unknown",
        "sourceAssetKind": "palette",
        "paletteId": palette.id,
        "colorCount": palette.colors_argb.len(),
        "provenance": {
            "source": "repo-local-hba",
            "sourceAssetKind": "palette",
            "errorCode": null,
            "detail": null
        }
    })
}

fn failed_dependency_payload(kind: &str, file_id: u32, error: anyhow::Error) -> serde_json::Value {
    let detail = format!("{error:#}");
    let error_code = asset_cache_error_code(&error);
    serde_json::json!({
        "kind": kind,
        "residencyKind": "unknown",
        "sourceAssetKind": kind,
        "fileId": file_id,
        "dependencies": {},
        "provenance": {
            "source": "app-local-stub",
            "sourceAssetKind": kind,
            "errorCode": error_code,
            "detail": detail
        }
    })
}

fn failed_landblock_terrain_payload(landblock_id: u32, error: anyhow::Error) -> serde_json::Value {
    let detail = format!("{error:#}");
    let error_code = asset_cache_error_code(&error);
    serde_json::json!({
        "kind": "landblock-terrain",
        "residencyKind": "outdoor-landblock",
        "sourceAssetKind": "landblock-terrain",
        "landblockId": landblock_id,
        "regionId": REGION_DESC_FILE_ID,
        "regionNumber": 0,
        "terrain": empty_landblock_terrain(),
        "diagnostics": failed_landblock_diagnostics(EOR_CELL_NAMESPACE, landblock_id, "landblock-terrain", error_code, &detail),
        "provenance": failed_provenance("landblock-terrain", error_code, &detail),
    })
}

fn failed_landblock_building_shells_payload(
    landblock_id: u32,
    error: anyhow::Error,
) -> serde_json::Value {
    let detail = format!("{error:#}");
    let error_code = asset_cache_error_code(&error);
    serde_json::json!({
        "kind": "landblock-building-shells",
        "residencyKind": "outdoor-landblock",
        "sourceAssetKind": "landblock-building-shells",
        "landblockId": landblock_id,
        "shells": [],
        "shellBvh": {
            "coordinateSpace": "landblock-local",
            "nodes": [],
            "items": [],
        },
        "diagnostics": failed_landblock_diagnostics(EOR_CELL_NAMESPACE, landblock_id, "landblock-building-shells", error_code, &detail),
        "provenance": failed_provenance("landblock-building-shells", error_code, &detail),
    })
}

fn failed_landblock_scene_payload(landblock_id: u32, error: anyhow::Error) -> serde_json::Value {
    let detail = format!("{error:#}");
    let error_code = asset_cache_error_code(&error);
    serde_json::json!({
        "kind": "landblock-scene",
        "residencyKind": "landblock",
        "sourceAssetKind": "landblock-scene",
        "landblockId": landblock_id,
        "landblockInfoId": landblock_id & 0xffff_fffe,
        "classification": "outdoor",
        "statics": [],
        "buildings": [],
        "envCells": [],
        "portalLinks": [],
        "envCellResidencyBvh": {
            "coordinateSpace": "landblock-scene-residency",
            "nodes": [],
            "items": [],
        },
        "outdoorBvh": null,
        "diagnostics": failed_landblock_diagnostics(EOR_CELL_NAMESPACE, landblock_id, "landblock-scene", error_code, &detail),
        "provenance": failed_provenance("landblock-scene", error_code, &detail),
    })
}

fn failed_landblock_outdoor_payload(landblock_id: u32, error: anyhow::Error) -> serde_json::Value {
    let detail = format!("{error:#}");
    let error_code = asset_cache_error_code(&error);
    serde_json::json!({
        "kind": "landblock-outdoor",
        "residencyKind": "outdoor-landblock",
        "sourceAssetKind": "landblock-outdoor",
        "landblockId": landblock_id,
        "regionId": REGION_DESC_FILE_ID,
        "regionNumber": 0,
        "classification": "outdoor",
        "terrain": empty_landblock_terrain(),
        "statics": [],
        "outdoorBvh": null,
        "diagnostics": failed_landblock_diagnostics(EOR_CELL_NAMESPACE, landblock_id, "landblock-outdoor", error_code, &detail),
        "provenance": failed_provenance("landblock-outdoor", error_code, &detail),
    })
}

fn failed_landblock_topology_payload(landblock_id: u32, error: anyhow::Error) -> serde_json::Value {
    let detail = format!("{error:#}");
    let error_code = asset_cache_error_code(&error);
    serde_json::json!({
        "kind": "landblock-topology",
        "residencyKind": "landblock",
        "sourceAssetKind": "landblock-topology",
        "landblockId": landblock_id,
        "landblockInfoId": landblock_id & 0xffff_fffe,
        "classification": "outdoor",
        "envCells": [],
        "portalLinks": [],
        "envCellResidencyBvh": {
            "coordinateSpace": "landblock-scene-residency",
            "nodes": [],
            "items": [],
        },
        "diagnostics": failed_landblock_diagnostics(EOR_CELL_NAMESPACE, landblock_id, "landblock-topology", error_code, &detail),
        "provenance": failed_provenance("landblock-topology", error_code, &detail),
    })
}

fn failed_env_cell_payload(env_cell_id: u32, error: anyhow::Error) -> serde_json::Value {
    let detail = format!("{error:#}");
    let error_code = asset_cache_error_code(&error);
    serde_json::json!({
        "kind": "env-cell",
        "residencyKind": "interior-cell",
        "sourceAssetKind": "env-cell",
        "envCellId": env_cell_id,
        "environmentId": 0,
        "cellStructureId": 0,
        "surfaces": [],
        "portals": [],
        "visibleEnvCellIds": [],
        "portalApertures": [],
        "statics": [],
        "renderGeometry": empty_polygon_set_render_geometry(env_cell_id),
        "cellBsp": empty_bsp_leaf(),
        "localBvh": {
            "coordinateSpace": "env-cell-local",
            "nodes": [],
            "items": [],
        },
        "provenance": failed_provenance("env-cell", error_code, &detail),
    })
}

fn failed_terrain_material_payload(region_number: u32, error: anyhow::Error) -> serde_json::Value {
    let detail = format!("{error:#}");
    let error_code = asset_cache_error_code(&error);
    serde_json::json!({
        "kind": "terrain-material",
        "residencyKind": "unknown",
        "sourceAssetKind": "terrain-material",
        "regionNumber": region_number,
        "materialKind": "tex-merge-table",
        "terrainTypes": [],
        "terrainAlphaMaps": [],
        "roadAlphaMaps": [],
        "pcodeEncoding": {
            "terrainCodeBits": 5,
            "roadCodeBits": 2,
            "sizeBitMask": 1 << 28,
        },
        "dependencies": {
            "renderTextureAssetIds": [],
            "renderSurfaceAssetIds": [],
            "paletteAssetIds": [],
        },
        "provenance": failed_provenance("terrain-material", error_code, &detail),
    })
}

fn failed_landblock_diagnostics(
    namespace: &str,
    file_id: u32,
    role: &str,
    error_code: &str,
    detail: &str,
) -> serde_json::Value {
    serde_json::json!({
        "sourceRecords": [],
        "omissions": [],
        "errors": [{
            "namespace": namespace,
            "fileId": file_id,
            "role": role,
            "errorCode": error_code,
            "detail": detail,
        }],
    })
}

fn failed_provenance(kind: &str, error_code: &str, detail: &str) -> serde_json::Value {
    serde_json::json!({
        "source": "app-local-stub",
        "sourceAssetKind": kind,
        "errorCode": error_code,
        "detail": detail,
    })
}

fn empty_polygon_set_render_geometry(source_id: u32) -> serde_json::Value {
    serde_json::json!({
        "sourceId": source_id,
        "vertexCount": 0,
        "triangleCount": 0,
        "positions": [],
        "normals": [],
        "uvs": [],
        "triangles": [],
        "surfaceIds": [],
        "invalidPolygons": [],
        "skippedPolygonCount": 0,
        "bounds": null,
    })
}

fn empty_bsp_leaf() -> serde_json::Value {
    serde_json::json!({
        "kind": "leaf",
        "index": 0,
        "solid": 0,
        "sphere": null,
        "polyIds": [],
    })
}

fn log_material_graph_failure(kind: &str, file_id: u32, error: &anyhow::Error) {
    eprintln!(
        "[holtburger-3d][material-graph] failed to resolve {kind}/0x{file_id:08X}: {error:#}"
    );
}

struct BinaryAssetSection {
    role: String,
    path: String,
    scalar_type: &'static str,
    component_count: u32,
    element_count: u32,
    byte_offset: usize,
    byte_length: usize,
}

#[derive(Default)]
struct BinaryAssetSectionWriter {
    data: Vec<u8>,
    sections: Vec<BinaryAssetSection>,
}

impl BinaryAssetSectionWriter {
    fn push_f32_section(
        &mut self,
        role: impl Into<String>,
        path: impl Into<String>,
        component_count: u32,
        values: impl IntoIterator<Item = f32>,
    ) {
        let offset = self.data.len();
        let mut scalar_count = 0usize;
        for value in values {
            self.data.extend(value.to_le_bytes());
            scalar_count += 1;
        }
        self.push_section(role, path, "f32", component_count, offset, scalar_count);
    }

    fn push_i32_section(
        &mut self,
        role: impl Into<String>,
        path: impl Into<String>,
        component_count: u32,
        values: impl IntoIterator<Item = i32>,
    ) {
        let offset = self.data.len();
        let mut scalar_count = 0usize;
        for value in values {
            self.data.extend(value.to_le_bytes());
            scalar_count += 1;
        }
        self.push_section(role, path, "i32", component_count, offset, scalar_count);
    }

    fn push_u8_section(
        &mut self,
        role: impl Into<String>,
        path: impl Into<String>,
        component_count: u32,
        values: &[u8],
    ) {
        let offset = self.data.len();
        self.data.extend(values);
        self.push_section(role, path, "u8", component_count, offset, values.len());
    }

    fn push_section(
        &mut self,
        role: impl Into<String>,
        path: impl Into<String>,
        scalar_type: &'static str,
        component_count: u32,
        offset: usize,
        scalar_count: usize,
    ) {
        if scalar_count == 0 {
            return;
        }
        let component_count_usize =
            usize::try_from(component_count).expect("binary component count fits usize");
        assert!(
            scalar_count.is_multiple_of(component_count_usize),
            "binary section scalar count must divide evenly by component count"
        );
        self.sections.push(BinaryAssetSection {
            role: role.into(),
            path: path.into(),
            scalar_type,
            component_count,
            element_count: u32::try_from(scalar_count / component_count_usize)
                .expect("binary section element count fits u32"),
            byte_offset: offset,
            byte_length: self.data.len() - offset,
        });
    }

    fn serialize_sections(&self) -> Vec<serde_json::Value> {
        self.sections
            .iter()
            .map(|section| {
                serde_json::json!({
                    "role": section.role,
                    "path": section.path,
                    "scalarType": section.scalar_type,
                    "componentCount": section.component_count,
                    "elementCount": section.element_count,
                    "byteOffset": section.byte_offset,
                    "byteLength": section.byte_length,
                })
            })
            .collect()
    }
}

fn serialize_content_asset_binary_response(
    adapter: &HostBoundaryAdapter,
    request: AssetLookupRequestDto,
    content_request: ContentAssetRequest,
    asset: anyhow::Result<ContentAsset>,
    path_prefix: &str,
    writer: &mut BinaryAssetSectionWriter,
) -> anyhow::Result<AssetLookupResponseDto> {
    Ok(match content_request {
        ContentAssetRequest::LandblockPack(landblock_id) => match asset {
            Ok(ContentAsset::LandblockPack(pack)) => AssetLookupResponseDto {
                request_id: request.request_id,
                asset_id: request.asset_id,
                payload_kind: AssetPayloadKindDto::Json,
                payload: serialize_landblock_pack_binary_payload(&pack, path_prefix, writer),
            },
            Ok(_) => unreachable!("content asset runtime returned mismatched landblock pack"),
            Err(error) => adapter.build_failed_landblock_pack_lookup_response(
                request,
                normalize_landblock_id(landblock_id),
                error,
            ),
        },
        ContentAssetRequest::LandblockSummary(landblock_id) => match asset {
            Ok(ContentAsset::LandblockSummary(summary)) => AssetLookupResponseDto {
                request_id: request.request_id,
                asset_id: request.asset_id,
                payload_kind: AssetPayloadKindDto::Json,
                payload: serialize_landblock_summary_binary_payload(&summary, path_prefix, writer),
            },
            Ok(_) => unreachable!("content asset runtime returned mismatched landblock summary"),
            Err(error) => adapter.build_failed_landblock_summary_lookup_response(
                request,
                normalize_landblock_id(landblock_id),
                error,
            ),
        },
        ContentAssetRequest::LandblockTerrain(landblock_id) => match asset {
            Ok(ContentAsset::LandblockTerrain {
                terrain,
                region_id,
                region_number,
            }) => AssetLookupResponseDto {
                request_id: request.request_id,
                asset_id: request.asset_id,
                payload_kind: AssetPayloadKindDto::Json,
                payload: serialize_landblock_terrain_binary_payload(
                    &terrain,
                    region_id,
                    region_number,
                    path_prefix,
                    writer,
                ),
            },
            Ok(_) => unreachable!("content asset runtime returned mismatched landblock terrain"),
            Err(error) => adapter.build_failed_landblock_terrain_lookup_response(
                request,
                normalize_landblock_id(landblock_id),
                error,
            ),
        },
        ContentAssetRequest::LandblockBuildingShells(landblock_id) => match asset {
            Ok(ContentAsset::LandblockBuildingShells(building_shells)) => AssetLookupResponseDto {
                request_id: request.request_id,
                asset_id: request.asset_id,
                payload_kind: AssetPayloadKindDto::Json,
                payload: serialize_landblock_building_shells_payload(&building_shells),
            },
            Ok(_) => {
                unreachable!("content asset runtime returned mismatched landblock building shells")
            }
            Err(error) => adapter.build_failed_landblock_building_shells_lookup_response(
                request,
                normalize_landblock_id(landblock_id),
                error,
            ),
        },
        ContentAssetRequest::LandblockScene(landblock_id) => match asset {
            Ok(ContentAsset::LandblockScene(pack)) => AssetLookupResponseDto {
                request_id: request.request_id,
                asset_id: request.asset_id,
                payload_kind: AssetPayloadKindDto::Json,
                payload: serialize_landblock_scene_payload(&pack),
            },
            Ok(_) => unreachable!("content asset runtime returned mismatched landblock scene"),
            Err(error) => adapter.build_failed_landblock_scene_lookup_response(
                request,
                normalize_landblock_id(landblock_id),
                error,
            ),
        },
        ContentAssetRequest::LandblockOutdoor(landblock_id) => match asset {
            Ok(ContentAsset::LandblockOutdoor {
                outdoor,
                region_id,
                region_number,
            }) => AssetLookupResponseDto {
                request_id: request.request_id,
                asset_id: request.asset_id,
                payload_kind: AssetPayloadKindDto::Json,
                payload: serialize_landblock_outdoor_payload(&outdoor, region_id, region_number),
            },
            Ok(_) => unreachable!("content asset runtime returned mismatched landblock outdoor"),
            Err(error) => adapter.build_failed_landblock_outdoor_lookup_response(
                request,
                normalize_landblock_id(landblock_id),
                error,
            ),
        },
        ContentAssetRequest::LandblockTopology(landblock_id) => match asset {
            Ok(ContentAsset::LandblockTopology(topology)) => AssetLookupResponseDto {
                request_id: request.request_id,
                asset_id: request.asset_id,
                payload_kind: AssetPayloadKindDto::Json,
                payload: serialize_landblock_topology_payload(&topology),
            },
            Ok(_) => unreachable!("content asset runtime returned mismatched landblock topology"),
            Err(error) => adapter.build_failed_landblock_topology_lookup_response(
                request,
                normalize_landblock_id(landblock_id),
                error,
            ),
        },
        ContentAssetRequest::EnvCell(env_cell_id) => match asset {
            Ok(ContentAsset::EnvCell(env_cell)) => AssetLookupResponseDto {
                request_id: request.request_id,
                asset_id: request.asset_id,
                payload_kind: AssetPayloadKindDto::Json,
                payload: if env_cell.prepared_cell.env_cell_id == env_cell_id {
                    serialize_env_cell_binary_payload(&env_cell, path_prefix, writer)
                } else {
                    failed_env_cell_payload(
                        env_cell_id,
                        anyhow::anyhow!(
                            "EnvCell assembler returned 0x{:08X} for request 0x{env_cell_id:08X}",
                            env_cell.prepared_cell.env_cell_id
                        ),
                    )
                },
            },
            Ok(_) => unreachable!("content asset runtime returned mismatched env-cell"),
            Err(error) => {
                adapter.build_failed_env_cell_lookup_response(request, env_cell_id, error)
            }
        },
        ContentAssetRequest::GfxObj(gfx_obj_id) => match asset {
            Ok(ContentAsset::GfxObj(gfx_obj)) => AssetLookupResponseDto {
                request_id: request.request_id,
                asset_id: request.asset_id,
                payload_kind: AssetPayloadKindDto::Json,
                payload: serialize_gfx_obj_binary_payload(&gfx_obj, path_prefix, writer),
            },
            Ok(_) => unreachable!("content asset runtime returned mismatched gfx obj"),
            Err(error) => adapter.build_gfx_obj_lookup_response(request, gfx_obj_id, Err(error)),
        },
        ContentAssetRequest::RenderSurface(render_surface_id) => match asset {
            Ok(ContentAsset::RenderSurface(render_surface)) => AssetLookupResponseDto {
                request_id: request.request_id,
                asset_id: request.asset_id,
                payload_kind: AssetPayloadKindDto::Json,
                payload: serialize_render_surface_binary_payload(
                    &render_surface,
                    path_prefix,
                    writer,
                ),
            },
            Ok(_) => unreachable!("content asset runtime returned mismatched render surface"),
            Err(error) => {
                adapter.build_render_surface_lookup_response(request, render_surface_id, Err(error))
            }
        },
        unsupported => anyhow::bail!(
            "binary asset lookup does not support {unsupported:?} for {}",
            request.asset_id
        ),
    })
}

fn serialize_asset_binary_batch_response(
    responses: Vec<AssetLookupResponseDto>,
    writer: BinaryAssetSectionWriter,
) -> anyhow::Result<Vec<u8>> {
    let manifest = serde_json::json!({
        "transport": "holtburger-asset-binary",
        "version": ASSET_BINARY_VERSION,
        "byteOrder": "little-endian",
        "sectionByteOffsetBase": "section-data",
        "responses": responses,
        "sections": writer.serialize_sections(),
    });
    let mut manifest_bytes = serde_json::to_vec(&manifest)?;
    while !(ASSET_BINARY_HEADER_LEN + manifest_bytes.len()).is_multiple_of(4) {
        manifest_bytes.push(b' ');
    }
    let total_len = ASSET_BINARY_HEADER_LEN + manifest_bytes.len() + writer.data.len();
    let mut bytes = Vec::with_capacity(total_len);
    bytes.extend(ASSET_BINARY_MAGIC);
    bytes.extend(ASSET_BINARY_VERSION.to_le_bytes());
    bytes.extend(
        u32::try_from(manifest_bytes.len())
            .expect("binary asset manifest length fits u32")
            .to_le_bytes(),
    );
    bytes.extend(
        u32::try_from(total_len)
            .expect("binary asset total length fits u32")
            .to_le_bytes(),
    );
    bytes.extend(manifest_bytes);
    bytes.extend(writer.data);
    Ok(bytes)
}

fn serialize_landblock_summary_binary_payload(
    summary: &LandblockSummary,
    path_prefix: &str,
    writer: &mut BinaryAssetSectionWriter,
) -> serde_json::Value {
    serde_json::json!({
        "kind": "landblock-summary",
        "residencyKind": "landblock",
        "sourceAssetKind": "landblock-summary",
        "landblockId": summary.landblock_id,
        "landblockInfoId": summary.landblock_info_id,
        "classification": serialize_landblock_classification(summary.classification),
        "sourceFacts": {
            "buildings": summary.buildings.iter().map(serialize_landblock_summary_building).collect::<Vec<_>>(),
        },
        "prepared": {
            "terrainMesh": summary.terrain_mesh.as_ref().map(|mesh| {
                serialize_prepared_terrain_mesh_binary(mesh, path_prefix, writer)
            }),
        },
        "dependencies": {
            "cellDatIds": derive_landblock_summary_cell_dat_ids(summary),
            "renderableAssetIds": derive_landblock_summary_renderable_asset_ids(summary),
        },
        "diagnostics": serialize_landblock_pack_diagnostics(&summary.diagnostics),
        "provenance": {
            "source": "repo-local-hba",
            "sourceAssetKind": "landblock-summary",
            "errorCode": summary.diagnostics.errors.first().map(|error| error.error_code),
            "detail": summary.diagnostics.errors.first().map(|error| error.detail.clone())
        }
    })
}

fn serialize_gfx_obj_binary_payload(
    gfx_obj: &GfxObj,
    path_prefix: &str,
    writer: &mut BinaryAssetSectionWriter,
) -> serde_json::Value {
    let render_geometry = build_gfx_obj_render_geometry(gfx_obj);
    serde_json::json!({
        "kind": "gfx-obj",
        "residencyKind": "unknown",
        "sourceAssetKind": "gfx-obj",
        "gfxObjId": gfx_obj.id,
        "flags": gfx_obj.flags.bits(),
        "surfaceIds": render_geometry.surface_ids,
        "vertexArray": {
            "vertexType": gfx_obj.vertex_array.vertex_type,
            "vertexCount": gfx_obj.vertex_array.vertices.len(),
            "vertices": []
        },
        "drawingPolygons": [],
        "drawingBsp": null,
        "dependencies": {
            "materialAssetIds": gfx_obj.surfaces.iter().map(|surface_id| format_material_asset_id(*surface_id)).collect::<Vec<_>>(),
        },
        "physicsWitness": {
            "polygonCount": gfx_obj.physics_polygons.len(),
            "hasBsp": gfx_obj.physics_bsp.is_some()
        },
        "renderGeometry": serialize_prepared_polygon_set_render_geometry_binary(
            &render_geometry,
            format!("{path_prefix}.renderGeometry"),
            writer,
        ),
        "sortCenter": serialize_vector3(&gfx_obj.sort_center),
        "didDegrade": gfx_obj.did_degrade,
        "provenance": {
            "source": "repo-local-hba",
            "sourceAssetKind": "gfx-obj",
            "errorCode": null,
            "detail": null
        }
    })
}

fn serialize_landblock_pack_binary_payload(
    pack: &LandblockPack,
    path_prefix: &str,
    writer: &mut BinaryAssetSectionWriter,
) -> serde_json::Value {
    serde_json::json!({
        "kind": "landblock-pack",
        "residencyKind": "landblock",
        "sourceAssetKind": "landblock-pack",
        "landblockId": pack.landblock_id,
        "landblockInfoId": pack.landblock_info_id,
        "classification": serialize_landblock_classification(pack.classification),
        "sourceFacts": {
            "buildings": serialize_landblock_pack_building_facts(pack.outdoor_scene.as_ref())
        },
        "prepared": {
            "terrainMesh": pack.prepared.terrain_mesh.as_ref().map(|mesh| {
                serialize_prepared_terrain_mesh_binary(mesh, path_prefix, writer)
            }),
            "outdoorStaticInstances": pack.prepared.outdoor_static_instances.iter().map(serialize_prepared_static_instance).collect::<Vec<_>>(),
            "interiorCells": pack.prepared.interior_cells.iter().enumerate().map(|(index, cell)| {
                serialize_prepared_interior_cell_binary(cell, index, path_prefix, writer)
            }).collect::<Vec<_>>(),
            "staticMeshes": pack.prepared.static_meshes.iter().map(serialize_prepared_static_mesh).collect::<Vec<_>>(),
            "spatialItems": pack.prepared.spatial_items.iter().enumerate().map(|(index, item)| {
                serialize_prepared_spatial_item_binary(item, index, path_prefix, writer)
            }).collect::<Vec<_>>(),
            "staticLandblockBvh": pack.prepared.static_landblock_bvh.as_ref().map(|bvh| {
                serialize_prepared_bvh_binary(bvh, path_prefix, writer)
            })
        },
        "dependencies": {
            "cellDatIds": derive_landblock_pack_cell_dat_ids(pack),
            "portalDatIds": derive_landblock_pack_portal_dat_ids(pack),
            "renderableAssetIds": derive_landblock_pack_renderable_asset_ids(pack),
            "missing": [],
            "unsupported": []
        },
        "diagnostics": serialize_landblock_pack_diagnostics(&pack.diagnostics),
        "provenance": {
            "source": "repo-local-hba",
            "sourceAssetKind": "landblock-pack",
            "errorCode": pack.diagnostics.errors.first().map(|error| error.error_code),
            "detail": pack.diagnostics.errors.first().map(|error| error.detail.clone())
        }
    })
}

fn serialize_prepared_terrain_mesh_binary(
    mesh: &PreparedTerrainMesh,
    path_prefix: &str,
    writer: &mut BinaryAssetSectionWriter,
) -> serde_json::Value {
    writer.push_f32_section(
        "prepared.terrainMesh.vertices",
        format!("{path_prefix}.prepared.terrainMesh.vertices"),
        3,
        mesh.vertices
            .iter()
            .flat_map(|vertex| [vertex.x, vertex.y, vertex.z]),
    );
    writer.push_f32_section(
        "prepared.terrainMesh.triangles",
        format!("{path_prefix}.prepared.terrainMesh.triangles"),
        5,
        mesh.triangles.iter().flat_map(|triangle| {
            [
                triangle.a as f32,
                triangle.b as f32,
                triangle.c as f32,
                triangle.terrain_type as f32,
                triangle.average_height,
            ]
        }),
    );
    serde_json::json!({
        "landblockId": mesh.landblock_id,
        "gridSize": mesh.grid_size,
        "tileSize": mesh.tile_size,
        "vertices": [],
        "triangles": [],
        "minHeight": mesh.min_height,
        "maxHeight": mesh.max_height,
    })
}

fn serialize_prepared_interior_cell_binary(
    cell: &PreparedInteriorCell,
    cell_index: usize,
    path_prefix: &str,
    writer: &mut BinaryAssetSectionWriter,
) -> serde_json::Value {
    serde_json::json!({
        "envCellId": cell.env_cell_id,
        "environmentId": cell.environment_id,
        "cellStructureId": cell.cell_structure_id,
        "localPlacement": serialize_frame(&cell.local_placement),
        "surfaceIds": cell.surface_ids,
        "portals": cell.portals.iter().map(|portal| {
            serde_json::json!({
                "portalId": portal.portal_id,
                "sourceIndex": portal.source_index,
                "flags": portal.flags,
                "polygonId": portal.polygon_id,
                "otherCellId": portal.other_cell_id,
                "otherPortalId": portal.other_portal_id,
                "targetEnvCellId": portal.target_env_cell_id,
                "isOutsideTransition": portal.is_outside_transition,
            })
        }).collect::<Vec<_>>(),
        "portalApertures": cell.portal_apertures.iter().enumerate().map(|(aperture_index, aperture)| {
            serialize_prepared_portal_aperture_binary(aperture, cell_index, aperture_index, path_prefix, writer)
        }).collect::<Vec<_>>(),
        "staticObjectCount": cell.static_object_count,
        "cellBsp": serialize_bsp_node(&cell.cell_bsp),
        "renderGeometry": serialize_prepared_polygon_set_render_geometry_binary(
            &cell.render_geometry,
            format!("{path_prefix}.prepared.interiorCells.{cell_index}.renderGeometry"),
            writer,
        ),
    })
}

fn serialize_prepared_portal_aperture_binary(
    aperture: &PreparedPortalAperture,
    cell_index: usize,
    aperture_index: usize,
    path_prefix: &str,
    writer: &mut BinaryAssetSectionWriter,
) -> serde_json::Value {
    writer.push_f32_section(
        "prepared.interiorCells.portalApertures.points",
        format!(
            "{path_prefix}.prepared.interiorCells.{cell_index}.portalApertures.{aperture_index}.points"
        ),
        3,
        aperture
            .points
            .iter()
            .flat_map(|point| [point.x, point.y, point.z]),
    );
    serde_json::json!({
        "portalId": aperture.portal_id,
        "sourceIndex": aperture.source_index,
        "polygonId": aperture.polygon_id,
        "points": [],
        "plane": aperture.plane.as_ref().map(serialize_prepared_portal_aperture_plane),
    })
}

fn serialize_prepared_polygon_set_render_geometry_binary(
    geometry: &PreparedPolygonSetRenderGeometry,
    path: String,
    writer: &mut BinaryAssetSectionWriter,
) -> serde_json::Value {
    writer.push_f32_section(
        format!("{path}.positions"),
        format!("{path}.positions"),
        3,
        geometry.positions.iter().copied(),
    );
    writer.push_f32_section(
        format!("{path}.normals"),
        format!("{path}.normals"),
        3,
        geometry.normals.iter().copied(),
    );
    writer.push_f32_section(
        format!("{path}.uvs"),
        format!("{path}.uvs"),
        2,
        geometry.uvs.iter().copied(),
    );
    writer.push_i32_section(
        format!("{path}.triangles"),
        format!("{path}.triangles"),
        3,
        geometry.triangles.iter().flat_map(|triangle| {
            [
                i32::from(triangle.polygon_id),
                triangle.surface_id.map(i32::from).unwrap_or(-1),
                i32::try_from(triangle.first_vertex).expect("first vertex fits i32"),
            ]
        }),
    );
    serde_json::json!({
        "sourceId": geometry.source_id,
        "vertexCount": geometry.vertex_count,
        "triangleCount": geometry.triangle_count,
        "positions": [],
        "normals": [],
        "uvs": [],
        "triangles": [],
        "surfaceIds": geometry.surface_ids,
        "invalidPolygons": geometry.invalid_polygons.iter().map(serialize_prepared_polygon_set_invalid_polygon).collect::<Vec<_>>(),
        "skippedPolygonCount": geometry.skipped_polygon_count,
        "bounds": geometry.bounds.as_ref().map(serialize_prepared_aabb),
    })
}

fn serialize_prepared_spatial_item_binary(
    item: &PreparedSpatialItem,
    item_index: usize,
    path_prefix: &str,
    writer: &mut BinaryAssetSectionWriter,
) -> serde_json::Value {
    writer.push_f32_section(
        "prepared.spatialItems.bounds",
        format!("{path_prefix}.prepared.spatialItems.{item_index}.bounds"),
        6,
        [
            item.bounds.min.x,
            item.bounds.min.y,
            item.bounds.min.z,
            item.bounds.max.x,
            item.bounds.max.y,
            item.bounds.max.z,
        ],
    );
    serde_json::json!({
        "id": item.id,
        "kind": serialize_prepared_spatial_item_kind(item.kind),
        "ownerId": item.owner_id,
        "sourceAssetId": item.source_asset_id,
        "bounds": { "min": { "x": 0, "y": 0, "z": 0 }, "max": { "x": 0, "y": 0, "z": 0 } },
        "metadata": serialize_prepared_spatial_item_metadata(&item.metadata),
    })
}

fn serialize_prepared_bvh_binary(
    bvh: &PreparedBvh,
    path_prefix: &str,
    writer: &mut BinaryAssetSectionWriter,
) -> serde_json::Value {
    serde_json::json!({
        "coordinateSpace": bvh.coordinate_space,
        "landblockId": bvh.landblock_id,
        "scope": bvh.scope,
        "nodes": bvh.nodes.iter().enumerate().map(|(index, node)| {
            serialize_prepared_bvh_node_binary(node, index, path_prefix, writer)
        }).collect::<Vec<_>>(),
    })
}

fn serialize_prepared_bvh_node_binary(
    node: &PreparedBvhNode,
    node_index: usize,
    path_prefix: &str,
    writer: &mut BinaryAssetSectionWriter,
) -> serde_json::Value {
    writer.push_f32_section(
        "prepared.staticLandblockBvh.nodes.bounds",
        format!("{path_prefix}.prepared.staticLandblockBvh.nodes.{node_index}.bounds"),
        6,
        [
            node.bounds.min.x,
            node.bounds.min.y,
            node.bounds.min.z,
            node.bounds.max.x,
            node.bounds.max.y,
            node.bounds.max.z,
        ],
    );
    serde_json::json!({
        "bounds": { "min": { "x": 0, "y": 0, "z": 0 }, "max": { "x": 0, "y": 0, "z": 0 } },
        "left": node.left,
        "right": node.right,
        "itemIndices": node.item_indices,
        "kindMask": node.kind_mask,
    })
}

fn serialize_landblock_pack(pack: &LandblockPack) -> serde_json::Value {
    serde_json::json!({
        "kind": "landblock-pack",
        "residencyKind": "landblock",
        "sourceAssetKind": "landblock-pack",
        "landblockId": pack.landblock_id,
        "landblockInfoId": pack.landblock_info_id,
        "classification": serialize_landblock_classification(pack.classification),
        "sourceFacts": {
            "buildings": serialize_landblock_pack_building_facts(pack.outdoor_scene.as_ref())
        },
        "prepared": {
            "terrainMesh": pack.prepared.terrain_mesh.as_ref().map(serialize_prepared_terrain_mesh),
            "outdoorStaticInstances": pack.prepared.outdoor_static_instances.iter().map(serialize_prepared_static_instance).collect::<Vec<_>>(),
            "interiorCells": pack.prepared.interior_cells.iter().map(serialize_prepared_interior_cell).collect::<Vec<_>>(),
            "staticMeshes": pack.prepared.static_meshes.iter().map(serialize_prepared_static_mesh).collect::<Vec<_>>(),
            "spatialItems": pack.prepared.spatial_items.iter().map(serialize_prepared_spatial_item).collect::<Vec<_>>(),
            "staticLandblockBvh": pack.prepared.static_landblock_bvh.as_ref().map(serialize_prepared_bvh)
        },
        "dependencies": {
            "cellDatIds": derive_landblock_pack_cell_dat_ids(pack),
            "portalDatIds": derive_landblock_pack_portal_dat_ids(pack),
            "renderableAssetIds": derive_landblock_pack_renderable_asset_ids(pack),
            "missing": [],
            "unsupported": []
        },
        "diagnostics": serialize_landblock_pack_diagnostics(&pack.diagnostics),
        "provenance": {
            "source": "repo-local-hba",
            "sourceAssetKind": "landblock-pack",
            "errorCode": pack.diagnostics.errors.first().map(|error| error.error_code),
            "detail": pack.diagnostics.errors.first().map(|error| error.detail.clone())
        }
    })
}

fn serialize_landblock_summary(summary: &LandblockSummary) -> serde_json::Value {
    serde_json::json!({
        "kind": "landblock-summary",
        "residencyKind": "landblock",
        "sourceAssetKind": "landblock-summary",
        "landblockId": summary.landblock_id,
        "landblockInfoId": summary.landblock_info_id,
        "classification": serialize_landblock_classification(summary.classification),
        "sourceFacts": {
            "buildings": summary.buildings.iter().map(serialize_landblock_summary_building).collect::<Vec<_>>(),
        },
        "prepared": {
            "terrainMesh": summary.terrain_mesh.as_ref().map(serialize_prepared_terrain_mesh),
        },
        "dependencies": {
            "cellDatIds": derive_landblock_summary_cell_dat_ids(summary),
            "renderableAssetIds": derive_landblock_summary_renderable_asset_ids(summary),
        },
        "diagnostics": serialize_landblock_pack_diagnostics(&summary.diagnostics),
        "provenance": {
            "source": "repo-local-hba",
            "sourceAssetKind": "landblock-summary",
            "errorCode": summary.diagnostics.errors.first().map(|error| error.error_code),
            "detail": summary.diagnostics.errors.first().map(|error| error.detail.clone())
        }
    })
}

fn serialize_landblock_terrain_payload(
    terrain_asset: &LandblockTerrainAsset,
    region_id: u32,
    region_number: u32,
) -> serde_json::Value {
    serialize_landblock_terrain_payload_with_terrain(
        terrain_asset,
        region_id,
        region_number,
        serialize_landblock_terrain(terrain_asset),
    )
}

fn serialize_landblock_terrain_binary_payload(
    terrain_asset: &LandblockTerrainAsset,
    region_id: u32,
    region_number: u32,
    path_prefix: &str,
    writer: &mut BinaryAssetSectionWriter,
) -> serde_json::Value {
    serialize_landblock_terrain_payload_with_terrain(
        terrain_asset,
        region_id,
        region_number,
        serialize_landblock_terrain_binary(terrain_asset, path_prefix, writer),
    )
}

fn serialize_landblock_terrain_payload_with_terrain(
    terrain_asset: &LandblockTerrainAsset,
    region_id: u32,
    region_number: u32,
    terrain: serde_json::Value,
) -> serde_json::Value {
    serde_json::json!({
        "kind": "landblock-terrain",
        "residencyKind": "outdoor-landblock",
        "sourceAssetKind": "landblock-terrain",
        "landblockId": terrain_asset.landblock_id,
        "regionId": region_id,
        "regionNumber": region_number,
        "terrain": terrain,
        "diagnostics": serialize_landblock_pack_diagnostics(&terrain_asset.diagnostics),
        "provenance": {
            "source": "repo-local-hba",
            "sourceAssetKind": "landblock-terrain",
            "errorCode": terrain_asset.diagnostics.errors.first().map(|error| error.error_code),
            "detail": terrain_asset.diagnostics.errors.first().map(|error| error.detail.clone())
        }
    })
}

fn serialize_landblock_terrain_binary(
    terrain_asset: &LandblockTerrainAsset,
    path_prefix: &str,
    writer: &mut BinaryAssetSectionWriter,
) -> serde_json::Value {
    let Some(mesh) = terrain_asset.terrain_mesh.as_ref() else {
        return empty_landblock_terrain();
    };
    let mut terrain = serialize_landblock_terrain(terrain_asset);
    writer.push_f32_section(
        "landblockTerrain.vertices",
        format!("{path_prefix}.terrain.vertices"),
        3,
        mesh.vertices
            .iter()
            .flat_map(|vertex| [vertex.x, vertex.y, vertex.z]),
    );
    writer.push_f32_section(
        "landblockTerrain.triangles",
        format!("{path_prefix}.terrain.triangles"),
        6,
        build_landblock_terrain_triangles(mesh)
            .iter()
            .flat_map(|triangle| {
                [
                    triangle.quad_index as f32,
                    triangle.triangle_in_quad as f32,
                    triangle.vertex_indices[0] as f32,
                    triangle.vertex_indices[1] as f32,
                    triangle.vertex_indices[2] as f32,
                    triangle.average_height,
                ]
            }),
    );
    terrain["vertices"] = serde_json::json!([]);
    terrain["triangles"] = serde_json::json!([]);
    terrain
}

fn serialize_landblock_terrain(terrain_asset: &LandblockTerrainAsset) -> serde_json::Value {
    let Some(mesh) = terrain_asset.terrain_mesh.as_ref() else {
        return empty_landblock_terrain();
    };
    let quads = terrain_asset
        .cell_landblock
        .as_ref()
        .map(|cell| build_landblock_terrain_quads(mesh, cell))
        .unwrap_or_default();
    let terrain_bvh_items = quads
        .iter()
        .map(|quad| {
            serde_json::json!({
                "row": quad.row,
                "col": quad.col,
                "quadIndex": quad.quad_index,
                "triangleIndices": quad.triangle_indices,
            })
        })
        .collect::<Vec<_>>();
    let terrain_bvh_nodes =
        build_flat_bvh_nodes_from_bounds(quads.iter().map(|quad| (quad.bounds, 1_u32)).collect());
    serde_json::json!({
        "gridSize": mesh.grid_size,
        "tileSize": mesh.tile_size,
        "vertices": mesh.vertices.iter().map(serialize_prepared_vec3).collect::<Vec<_>>(),
        "triangles": build_landblock_terrain_triangles(mesh).iter().map(serialize_landblock_terrain_triangle).collect::<Vec<_>>(),
        "quads": quads.iter().map(serialize_landblock_terrain_quad).collect::<Vec<_>>(),
        "terrainBvh": {
            "coordinateSpace": "landblock-terrain-local",
            "nodes": terrain_bvh_nodes,
            "items": terrain_bvh_items,
        },
        "minHeight": mesh.min_height,
        "maxHeight": mesh.max_height,
        "bounds": terrain_mesh_bounds(mesh).as_ref().map(serialize_prepared_aabb),
    })
}

fn empty_landblock_terrain() -> serde_json::Value {
    serde_json::json!({
        "gridSize": 9,
        "tileSize": 24.0,
        "vertices": [],
        "triangles": [],
        "quads": [],
        "terrainBvh": {
            "coordinateSpace": "landblock-terrain-local",
            "nodes": [],
            "items": [],
        },
        "minHeight": 0.0,
        "maxHeight": 0.0,
        "bounds": null,
    })
}

fn serialize_landblock_building_shells_payload(
    building_shells: &LandblockBuildingShellsAsset,
) -> serde_json::Value {
    serde_json::json!({
        "kind": "landblock-building-shells",
        "residencyKind": "outdoor-landblock",
        "sourceAssetKind": "landblock-building-shells",
        "landblockId": building_shells.landblock_id,
        "landblockInfoId": building_shells.landblock_info_id,
        "shells": building_shells.shells.iter().map(serialize_landblock_building_shell_member).collect::<Vec<_>>(),
        "shellBvh": serialize_landblock_building_shell_bvh(building_shells),
        "diagnostics": serialize_landblock_pack_diagnostics(&building_shells.diagnostics),
        "provenance": {
            "source": "repo-local-hba",
            "sourceAssetKind": "landblock-building-shells",
            "errorCode": building_shells.diagnostics.errors.first().map(|error| error.error_code),
            "detail": building_shells.diagnostics.errors.first().map(|error| error.detail.clone())
        }
    })
}

fn serialize_landblock_building_shell_member(shell: &LandblockBuildingShell) -> serde_json::Value {
    serde_json::json!({
        "shellId": shell.shell_id,
        "buildingIndex": shell.building_index,
        "sourceDid": shell.source_did,
        "sourceAssetId": shell.source_asset_id,
        "localPlacement": serialize_frame(&shell.local_placement),
        "sourceScale": serialize_prepared_vec3(&shell.source_scale),
        "sourceBounds": shell.source_bounds.as_ref().map(serialize_prepared_aabb),
        "instanceBounds": shell.instance_bounds.as_ref().map(serialize_prepared_aabb),
    })
}

fn serialize_landblock_building_shell_bvh(
    building_shells: &LandblockBuildingShellsAsset,
) -> serde_json::Value {
    let mut items = Vec::new();
    let mut node_inputs = Vec::new();

    for shell in &building_shells.shells {
        let Some(bounds) = shell.instance_bounds else {
            continue;
        };
        items.push(serde_json::json!({
            "kind": "building-shell",
            "shellId": shell.shell_id,
        }));
        node_inputs.push((bounds, 1_u32));
    }

    serde_json::json!({
        "coordinateSpace": "landblock-local",
        "nodes": build_flat_bvh_nodes_from_bounds(node_inputs),
        "items": items,
    })
}

#[derive(Clone, Debug)]
struct SerializedTerrainQuad {
    terrain_quad_id: String,
    row: usize,
    col: usize,
    quad_index: usize,
    source_terrain_indices: [usize; 4],
    vertex_indices: [usize; 4],
    triangle_indices: [usize; 2],
    diagonal: &'static str,
    corner_terrain_codes: [u32; 4],
    pcode: u32,
    average_height: f32,
    bounds: PreparedAabb,
}

#[derive(Clone, Debug)]
struct SerializedTerrainTriangle {
    terrain_triangle_id: String,
    quad_index: usize,
    triangle_in_quad: usize,
    vertex_indices: [usize; 3],
    average_height: f32,
    bounds: PreparedAabb,
}

fn build_landblock_terrain_quads(
    mesh: &PreparedTerrainMesh,
    cell: &holtburger_content::CellLandblockFact,
) -> Vec<SerializedTerrainQuad> {
    if mesh.grid_size < 2 {
        return Vec::new();
    }
    let quad_width = mesh.grid_size - 1;
    let mut normalized_terrain = Vec::with_capacity(cell.terrain_types.len());
    for row in 0..mesh.grid_size {
        for col in 0..mesh.grid_size {
            let source_index = col * mesh.grid_size + row;
            normalized_terrain.push(*cell.terrain_types.get(source_index).unwrap_or(&0));
        }
    }
    let mut quads = Vec::with_capacity(quad_width * quad_width);
    for row in 0..quad_width {
        for col in 0..quad_width {
            let southwest = row * mesh.grid_size + col;
            let southeast = southwest + 1;
            let northwest = southwest + mesh.grid_size;
            let northeast = northwest + 1;
            let Some(bounds) =
                terrain_vertex_bounds_json(mesh, [southwest, southeast, northwest, northeast])
            else {
                continue;
            };
            let quad_index = row * quad_width + col;
            let triangle_indices = [quad_index * 2, quad_index * 2 + 1];
            let raw_corners = [
                normalized_terrain[southwest],
                normalized_terrain[southeast],
                normalized_terrain[northeast],
                normalized_terrain[northwest],
            ];
            let corner_terrain_codes = raw_corners.map(terrain_code_from_cell_terrain);
            let corner_road_codes = raw_corners.map(road_code_from_cell_terrain);
            let diagonal = if terrain_triangle_cut_is_southwest_to_northeast(mesh, triangle_indices)
            {
                "southwest-northeast"
            } else {
                "southeast-northwest"
            };
            quads.push(SerializedTerrainQuad {
                terrain_quad_id: format!(
                    "landblock/{:08x}/terrain/quad/{row:02x}/{col:02x}",
                    mesh.landblock_id
                ),
                row,
                col,
                quad_index,
                source_terrain_indices: [southwest, southeast, northeast, northwest],
                vertex_indices: [southwest, southeast, northeast, northwest],
                triangle_indices,
                diagonal,
                corner_terrain_codes,
                pcode: terrain_pcode(corner_road_codes, corner_terrain_codes),
                average_height: (mesh.vertices[southwest].z
                    + mesh.vertices[southeast].z
                    + mesh.vertices[northeast].z
                    + mesh.vertices[northwest].z)
                    / 4.0,
                bounds,
            });
        }
    }
    quads
}

fn build_landblock_terrain_triangles(mesh: &PreparedTerrainMesh) -> Vec<SerializedTerrainTriangle> {
    mesh.triangles
        .iter()
        .enumerate()
        .filter_map(|(triangle_index, triangle)| {
            let bounds = terrain_vertex_bounds_json(mesh, [triangle.a, triangle.b, triangle.c])?;
            Some(SerializedTerrainTriangle {
                terrain_triangle_id: format!(
                    "landblock/{:08x}/terrain/triangle/{triangle_index:04x}",
                    mesh.landblock_id
                ),
                quad_index: triangle_index / 2,
                triangle_in_quad: triangle_index % 2,
                vertex_indices: [triangle.a, triangle.b, triangle.c],
                average_height: triangle.average_height,
                bounds,
            })
        })
        .collect()
}

fn serialize_landblock_terrain_triangle(triangle: &SerializedTerrainTriangle) -> serde_json::Value {
    serde_json::json!({
        "terrainTriangleId": triangle.terrain_triangle_id,
        "quadIndex": triangle.quad_index,
        "triangleInQuad": triangle.triangle_in_quad,
        "vertexIndices": triangle.vertex_indices,
        "averageHeight": triangle.average_height,
        "bounds": serialize_prepared_aabb(&triangle.bounds),
    })
}

fn serialize_landblock_terrain_quad(quad: &SerializedTerrainQuad) -> serde_json::Value {
    serde_json::json!({
        "terrainQuadId": quad.terrain_quad_id,
        "row": quad.row,
        "col": quad.col,
        "quadIndex": quad.quad_index,
        "sourceTerrainIndices": quad.source_terrain_indices,
        "vertexIndices": quad.vertex_indices,
        "triangleIndices": quad.triangle_indices,
        "diagonal": quad.diagonal,
        "cornerTerrainCodes": quad.corner_terrain_codes,
        "pcode": quad.pcode,
        "averageHeight": quad.average_height,
        "bounds": serialize_prepared_aabb(&quad.bounds),
    })
}

fn terrain_code_from_cell_terrain(value: u16) -> u32 {
    u32::from((value >> 2) & 0x1f)
}

fn road_code_from_cell_terrain(value: u16) -> u32 {
    u32::from(value & 0x03)
}

fn terrain_pcode(road_codes: [u32; 4], terrain_codes: [u32; 4]) -> u32 {
    (1 << 28)
        | (road_codes[0] << 26)
        | (road_codes[1] << 24)
        | (road_codes[2] << 22)
        | (road_codes[3] << 20)
        | (terrain_codes[0] << 15)
        | (terrain_codes[1] << 10)
        | (terrain_codes[2] << 5)
        | terrain_codes[3]
}

fn terrain_triangle_cut_is_southwest_to_northeast(
    mesh: &PreparedTerrainMesh,
    triangle_indices: [usize; 2],
) -> bool {
    let Some(first) = mesh.triangles.get(triangle_indices[0]) else {
        return true;
    };
    let Some(second) = mesh.triangles.get(triangle_indices[1]) else {
        return true;
    };
    first.c == second.b
}

fn terrain_mesh_bounds(mesh: &PreparedTerrainMesh) -> Option<PreparedAabb> {
    let indices = (0..mesh.vertices.len()).collect::<Vec<_>>();
    terrain_vertex_bounds_slice(mesh, &indices)
}

fn terrain_vertex_bounds_json<const N: usize>(
    mesh: &PreparedTerrainMesh,
    vertex_indices: [usize; N],
) -> Option<PreparedAabb> {
    terrain_vertex_bounds_slice(mesh, &vertex_indices)
}

fn terrain_vertex_bounds_slice(
    mesh: &PreparedTerrainMesh,
    vertex_indices: &[usize],
) -> Option<PreparedAabb> {
    vertex_indices
        .iter()
        .filter_map(|index| mesh.vertices.get(*index))
        .copied()
        .fold(None, |bounds, point| Some(expand_bounds(bounds, point)))
}

fn expand_bounds(bounds: Option<PreparedAabb>, point: PreparedVec3) -> PreparedAabb {
    match bounds {
        Some(bounds) => PreparedAabb {
            min: PreparedVec3 {
                x: bounds.min.x.min(point.x),
                y: bounds.min.y.min(point.y),
                z: bounds.min.z.min(point.z),
            },
            max: PreparedVec3 {
                x: bounds.max.x.max(point.x),
                y: bounds.max.y.max(point.y),
                z: bounds.max.z.max(point.z),
            },
        },
        None => PreparedAabb {
            min: point,
            max: point,
        },
    }
}

fn union_prepared_bounds(left: PreparedAabb, right: PreparedAabb) -> PreparedAabb {
    PreparedAabb {
        min: PreparedVec3 {
            x: left.min.x.min(right.min.x),
            y: left.min.y.min(right.min.y),
            z: left.min.z.min(right.min.z),
        },
        max: PreparedVec3 {
            x: left.max.x.max(right.max.x),
            y: left.max.y.max(right.max.y),
            z: left.max.z.max(right.max.z),
        },
    }
}

fn build_flat_bvh_nodes_from_bounds(items: Vec<(PreparedAabb, u32)>) -> Vec<serde_json::Value> {
    if items.is_empty() {
        return Vec::new();
    }
    let bounds = items
        .iter()
        .map(|(bounds, _)| *bounds)
        .reduce(union_prepared_bounds)
        .expect("non-empty BVH item list should produce bounds");
    let kind_mask = items.iter().fold(0_u32, |mask, (_, kind)| mask | *kind);
    vec![serde_json::json!({
        "bounds": serialize_prepared_aabb(&bounds),
        "left": null,
        "right": null,
        "itemIndices": (0..items.len()).collect::<Vec<_>>(),
        "kindMask": kind_mask,
    })]
}

fn serialize_landblock_scene_payload(scene: &LandblockSceneAsset) -> serde_json::Value {
    serde_json::json!({
        "kind": "landblock-scene",
        "residencyKind": "landblock",
        "sourceAssetKind": "landblock-scene",
        "landblockId": scene.landblock_id,
        "landblockInfoId": scene.landblock_info_id,
        "classification": serialize_landblock_classification(scene.classification),
        "statics": scene.statics.iter().map(serialize_landblock_scene_static_member).collect::<Vec<_>>(),
        "buildings": scene.buildings.iter().map(serialize_landblock_scene_building_member).collect::<Vec<_>>(),
        "envCells": scene.env_cells.iter().map(serialize_landblock_scene_env_cell_member).collect::<Vec<_>>(),
        "portalLinks": serialize_landblock_scene_portal_links(scene),
        "envCellResidencyBvh": serialize_landblock_scene_env_cell_residency_bvh(scene),
        "outdoorBvh": serialize_landblock_scene_outdoor_bvh(scene),
        "diagnostics": serialize_landblock_pack_diagnostics(&scene.diagnostics),
        "provenance": {
            "source": "repo-local-hba",
            "sourceAssetKind": "landblock-scene",
            "errorCode": scene.diagnostics.errors.first().map(|error| error.error_code),
            "detail": scene.diagnostics.errors.first().map(|error| error.detail.clone())
        }
    })
}

fn serialize_landblock_outdoor_payload(
    outdoor: &LandblockOutdoorAsset,
    region_id: u32,
    region_number: u32,
) -> serde_json::Value {
    serde_json::json!({
        "kind": "landblock-outdoor",
        "residencyKind": "outdoor-landblock",
        "sourceAssetKind": "landblock-outdoor",
        "landblockId": outdoor.landblock_id,
        "regionId": region_id,
        "regionNumber": region_number,
        "classification": "outdoor",
        "terrain": serialize_landblock_outdoor_terrain(outdoor),
        "statics": outdoor.statics.iter().map(serialize_landblock_outdoor_static_member).collect::<Vec<_>>(),
        "outdoorBvh": serialize_landblock_outdoor_bvh(outdoor),
        "diagnostics": serialize_landblock_pack_diagnostics(&outdoor.diagnostics),
        "provenance": {
            "source": "repo-local-hba",
            "sourceAssetKind": "landblock-outdoor",
            "errorCode": outdoor.diagnostics.errors.first().map(|error| error.error_code),
            "detail": outdoor.diagnostics.errors.first().map(|error| error.detail.clone())
        }
    })
}

fn serialize_landblock_topology_payload(topology: &LandblockTopologyAsset) -> serde_json::Value {
    serde_json::json!({
        "kind": "landblock-topology",
        "residencyKind": "landblock",
        "sourceAssetKind": "landblock-topology",
        "landblockId": topology.landblock_id,
        "landblockInfoId": topology.landblock_info_id,
        "classification": serialize_landblock_classification(topology.classification),
        "envCells": topology.env_cells.iter().map(serialize_landblock_scene_env_cell_member).collect::<Vec<_>>(),
        "portalLinks": serialize_landblock_topology_portal_links(topology),
        "envCellResidencyBvh": serialize_landblock_topology_env_cell_residency_bvh(topology),
        "diagnostics": serialize_landblock_pack_diagnostics(&topology.diagnostics),
        "provenance": {
            "source": "repo-local-hba",
            "sourceAssetKind": "landblock-topology",
            "errorCode": topology.diagnostics.errors.first().map(|error| error.error_code),
            "detail": topology.diagnostics.errors.first().map(|error| error.detail.clone())
        }
    })
}

fn serialize_landblock_outdoor_terrain(outdoor: &LandblockOutdoorAsset) -> serde_json::Value {
    let terrain_asset = LandblockTerrainAsset {
        landblock_id: outdoor.landblock_id,
        cell_landblock: outdoor.cell_landblock.clone(),
        terrain_mesh: outdoor.terrain_mesh.clone(),
        diagnostics: outdoor.diagnostics.clone(),
    };
    serialize_landblock_terrain(&terrain_asset)
}

fn serialize_landblock_outdoor_static_member(
    member: &LandblockOutdoorStaticMember,
) -> serde_json::Value {
    let instance = &member.instance;
    serde_json::json!({
        "kind": serialize_landblock_outdoor_static_kind(instance.kind),
        "instanceId": instance.instance_id,
        "sourceDid": instance.source_did,
        "sourceAssetId": instance.source_asset_id,
        "sourceIndex": instance.source_index,
        "localPlacement": serialize_frame(&instance.local_placement),
        "sourceScale": serialize_prepared_vec3(&instance.source_scale),
        "sourceBounds": member.source_bounds.map(serialize_bounds),
        "instanceBounds": member.instance_bounds.map(serialize_bounds),
        "building": member.building.as_ref().map(|building| serde_json::json!({
            "numLeaves": building.num_leaves,
            "portals": building.portals.iter().map(|portal| serde_json::json!({
                "portalId": portal.portal_id,
                "sourceIndex": portal.source_index,
                "flags": portal.flags,
                "otherCellId": portal.other_cell_id,
                "otherPortalId": portal.other_portal_id,
                "stabLocalCellIds": portal.stab_list,
                "linkedEnvCellIds": portal.linked_env_cell_ids,
            })).collect::<Vec<_>>(),
        })),
        "generated": member.generated.as_ref().map(|generated| serde_json::json!({
            "terrainIndex": generated.terrain_index,
            "sceneId": generated.scene_id,
            "sceneTemplateIndex": generated.scene_template_index,
        })),
    })
}

fn serialize_landblock_outdoor_static_kind(kind: PreparedStaticInstanceKind) -> &'static str {
    match kind {
        PreparedStaticInstanceKind::Building => "building",
        PreparedStaticInstanceKind::GeneratedScenery => "generated-scenery",
        _ => "explicit-object",
    }
}

fn serialize_landblock_outdoor_bvh(outdoor: &LandblockOutdoorAsset) -> serde_json::Value {
    let Some(bvh) = outdoor.outdoor_bvh.as_ref() else {
        return serde_json::Value::Null;
    };
    serde_json::json!({
        "coordinateSpace": "landblock-render-local",
        "nodes": bvh.nodes.iter().map(serialize_prepared_bvh_node).collect::<Vec<_>>(),
        "items": outdoor.statics.iter().map(|member| serde_json::json!({
            "kind": serialize_landblock_outdoor_bvh_item_kind(member.instance.kind),
            "instanceId": member.instance.instance_id,
        })).collect::<Vec<_>>(),
    })
}

fn serialize_landblock_outdoor_bvh_item_kind(kind: PreparedStaticInstanceKind) -> &'static str {
    match kind {
        PreparedStaticInstanceKind::Building => "building",
        _ => "static",
    }
}

fn serialize_landblock_topology_env_cell_residency_bvh(
    topology: &LandblockTopologyAsset,
) -> serde_json::Value {
    let scene = LandblockSceneAsset {
        landblock_id: topology.landblock_id,
        landblock_info_id: topology.landblock_info_id,
        classification: topology.classification,
        statics: Vec::new(),
        buildings: Vec::new(),
        env_cells: topology.env_cells.clone(),
        diagnostics: topology.diagnostics.clone(),
    };
    serialize_landblock_scene_env_cell_residency_bvh(&scene)
}

fn serialize_landblock_topology_portal_links(
    topology: &LandblockTopologyAsset,
) -> Vec<serde_json::Value> {
    let scene = LandblockSceneAsset {
        landblock_id: topology.landblock_id,
        landblock_info_id: topology.landblock_info_id,
        classification: topology.classification,
        statics: Vec::new(),
        buildings: Vec::new(),
        env_cells: topology.env_cells.clone(),
        diagnostics: topology.diagnostics.clone(),
    };
    serialize_landblock_scene_portal_links(&scene)
}

fn serialize_landblock_scene_env_cell_residency_bvh(
    scene: &LandblockSceneAsset,
) -> serde_json::Value {
    let items = scene
        .env_cells
        .iter()
        .map(|cell| {
            serde_json::json!({
                "envCellId": cell.env_cell_id,
                "memberId": format!("env-cell/{:08x}", cell.env_cell_id),
                "assetId": format_env_cell_asset_id(cell.env_cell_id),
                "source": "env-cell-placement",
            })
        })
        .collect::<Vec<_>>();
    let node_inputs = scene
        .env_cells
        .iter()
        .map(|cell| {
            let point = PreparedVec3 {
                x: cell.local_placement.origin.x,
                y: cell.local_placement.origin.z,
                z: if cell.local_placement.origin.y == 0.0 {
                    0.0
                } else {
                    -cell.local_placement.origin.y
                },
            };
            (
                PreparedAabb {
                    min: point,
                    max: point,
                },
                1_u32,
            )
        })
        .collect::<Vec<_>>();
    serde_json::json!({
        "coordinateSpace": "landblock-scene-residency",
        "nodes": build_flat_bvh_nodes_from_bounds(node_inputs),
        "items": items,
    })
}

fn serialize_landblock_scene_static_member(
    member: &LandblockSceneStaticMember,
) -> serde_json::Value {
    let instance = &member.instance;
    serde_json::json!({
        "kind": serialize_landblock_scene_static_kind(instance.kind),
        "instanceId": instance.instance_id,
        "memberId": format!("landblock-scene/static/{}", instance.instance_id),
        "sourceDid": instance.source_did,
        "sourceAssetId": instance.source_asset_id,
        "sourceIndex": instance.source_index,
        "localPlacement": serialize_frame(&instance.local_placement),
        "sourceScale": serialize_prepared_vec3(&instance.source_scale),
        "sourceBounds": member.source_bounds.map(serialize_bounds),
        "instanceBounds": member.instance_bounds.map(serialize_bounds),
    })
}

fn serialize_landblock_scene_static_kind(kind: PreparedStaticInstanceKind) -> &'static str {
    match kind {
        PreparedStaticInstanceKind::GeneratedScenery => "generated-scenery",
        _ => "scenery",
    }
}

fn serialize_landblock_scene_building_member(
    member: &LandblockSceneBuildingMember,
) -> serde_json::Value {
    let instance = &member.instance;
    let portals = member
        .portals
        .iter()
        .map(|portal| {
            serde_json::json!({
                "portalId": portal.portal_id,
                "sourceIndex": portal.source_index,
                "flags": portal.flags,
                "otherCellId": portal.other_cell_id,
                "otherPortalId": portal.other_portal_id,
                "stabLocalCellIds": portal.stab_list,
                "linkedEnvCellIds": portal.linked_env_cell_ids,
            })
        })
        .collect::<Vec<_>>();
    serde_json::json!({
        "kind": "building",
        "instanceId": instance.instance_id,
        "memberId": format!("landblock-scene/building/{}", instance.instance_id),
        "sourceDid": instance.source_did,
        "sourceAssetId": instance.source_asset_id,
        "sourceIndex": instance.source_index,
        "localPlacement": serialize_frame(&instance.local_placement),
        "sourceScale": serialize_prepared_vec3(&instance.source_scale),
        "sourceBounds": member.source_bounds.map(serialize_bounds),
        "instanceBounds": member.instance_bounds.map(serialize_bounds),
        "numLeaves": member.num_leaves,
        "portals": portals,
    })
}

fn serialize_landblock_scene_env_cell_member(
    cell: &holtburger_content::EnvCellFact,
) -> serde_json::Value {
    serde_json::json!({
        "memberId": format!("env-cell/{:08x}", cell.env_cell_id),
        "envCellId": cell.env_cell_id,
        "assetId": format_env_cell_asset_id(cell.env_cell_id),
        "localPlacement": serialize_frame(&cell.local_placement),
        "visibleEnvCellIds": cell.visible_cell_ids,
        "restrictionObjectId": cell.restriction_object_id,
        "seenOutside": cell.seen_outside,
    })
}

fn serialize_landblock_scene_portal_links(scene: &LandblockSceneAsset) -> Vec<serde_json::Value> {
    scene
        .env_cells
        .iter()
        .flat_map(|cell| {
            cell.portals.iter().map(|portal| {
                serde_json::json!({
                    "linkId": portal.portal_id,
                    "source": {
                        "kind": "env-cell",
                        "envCellId": cell.env_cell_id,
                        "portalId": portal.portal_id,
                    },
                    "target": portal.target_env_cell_id.map(|target| {
                        serde_json::json!({
                            "kind": "env-cell",
                            "envCellId": target,
                            "portalId": format!("env-cell/{target:08x}/portal/{:04x}", portal.other_portal_id),
                        })
                    }).unwrap_or_else(|| {
                        serde_json::json!({
                            "kind": "outside",
                            "landblockId": scene.landblock_id,
                        })
                    }),
                    "flags": portal.flags,
                    "otherCellId": portal.other_cell_id,
                    "otherPortalId": portal.other_portal_id,
                    "polygonId": portal.polygon_id,
                    "sourceIndex": portal.source_index,
                })
            })
        })
        .collect()
}

fn serialize_landblock_scene_outdoor_bvh(scene: &LandblockSceneAsset) -> serde_json::Value {
    let items = scene
        .statics
        .iter()
        .map(|member| serde_json::json!({ "kind": "static", "instanceId": member.instance.instance_id }))
        .chain(scene.buildings.iter().map(|member| {
            serde_json::json!({ "kind": "building", "instanceId": member.instance.instance_id })
        }))
        .collect::<Vec<_>>();
    if items.is_empty() {
        serde_json::Value::Null
    } else {
        let node_inputs = scene
            .statics
            .iter()
            .filter_map(|member| Some((member.instance_bounds?, 2_u32)))
            .chain(
                scene
                    .buildings
                    .iter()
                    .filter_map(|member| Some((member.instance_bounds?, 4_u32))),
            )
            .collect::<Vec<_>>();
        serde_json::json!({
            "coordinateSpace": "landblock-render-local",
            "nodes": build_flat_bvh_nodes_from_bounds(node_inputs),
            "items": items,
        })
    }
}

fn serialize_env_cell_payload(asset: &EnvCellAsset) -> serde_json::Value {
    serialize_env_cell_payload_with_geometry(
        asset,
        serialize_prepared_polygon_set_render_geometry(&asset.prepared_cell.render_geometry),
        |aperture| serialize_prepared_portal_aperture(aperture),
    )
}

fn serialize_env_cell_binary_payload(
    asset: &EnvCellAsset,
    path_prefix: &str,
    writer: &mut BinaryAssetSectionWriter,
) -> serde_json::Value {
    serialize_env_cell_payload_with_geometry(
        asset,
        serialize_prepared_polygon_set_render_geometry_binary(
            &asset.prepared_cell.render_geometry,
            format!("{path_prefix}.renderGeometry"),
            writer,
        ),
        |aperture| {
            serialize_prepared_portal_aperture_standalone_binary(aperture, path_prefix, writer)
        },
    )
}

fn serialize_env_cell_payload_with_geometry<F>(
    asset: &EnvCellAsset,
    render_geometry: serde_json::Value,
    mut serialize_aperture: F,
) -> serde_json::Value
where
    F: FnMut(&PreparedPortalAperture) -> serde_json::Value,
{
    let cell = &asset.prepared_cell;
    let static_meshes = asset.static_meshes.iter().collect::<Vec<_>>();
    serde_json::json!({
        "kind": "env-cell",
        "residencyKind": "interior-cell",
        "sourceAssetKind": "env-cell",
        "envCellId": cell.env_cell_id,
        "environmentId": cell.environment_id,
        "cellStructureId": cell.cell_structure_id,
        "surfaces": cell.surface_ids.iter().enumerate().map(|(index, surface_id)| {
            serde_json::json!({
                "slotId": index + 1,
                "surfaceId": surface_id,
                "materialAssetId": format_material_asset_id(*surface_id),
            })
        }).collect::<Vec<_>>(),
        "portals": cell.portals.iter().map(|portal| {
            serde_json::json!({
                "portalId": portal.portal_id,
                "sourceIndex": portal.source_index,
                "flags": portal.flags,
                "polygonId": portal.polygon_id,
                "otherCellId": portal.other_cell_id,
                "otherPortalId": portal.other_portal_id,
                "targetEnvCellId": portal.target_env_cell_id,
                "isOutsideTransition": portal.is_outside_transition,
            })
        }).collect::<Vec<_>>(),
        "visibleEnvCellIds": asset.env_cell.visible_cell_ids,
        "portalApertures": cell.portal_apertures.iter().map(&mut serialize_aperture).collect::<Vec<_>>(),
        "statics": static_meshes.iter().map(|mesh| {
            serde_json::json!({
                "instanceId": mesh.instance_id,
                "sourceDid": mesh.source_did,
                "sourceAssetId": mesh.source_asset_id,
                "sourceIndex": mesh.source_index,
                "localPlacement": serialize_frame(&mesh.local_placement),
                "sourceScale": serialize_prepared_vec3(&mesh.source_scale),
                "sourceBounds": mesh.source_bounds.as_ref().map(serialize_prepared_aabb),
                "instanceBounds": mesh.instance_bounds.as_ref().map(serialize_prepared_aabb),
            })
        }).collect::<Vec<_>>(),
        "renderGeometry": render_geometry,
        "cellBsp": serialize_bsp_node(&cell.cell_bsp),
        "localBvh": serialize_env_cell_local_bvh(cell, &static_meshes),
        "provenance": {
            "source": "repo-local-hba",
            "sourceAssetKind": "env-cell",
            "errorCode": asset.diagnostics.errors.first().map(|error| error.error_code),
            "detail": asset.diagnostics.errors.first().map(|error| error.detail.clone())
        }
    })
}

fn serialize_prepared_portal_aperture_standalone_binary(
    aperture: &PreparedPortalAperture,
    path_prefix: &str,
    writer: &mut BinaryAssetSectionWriter,
) -> serde_json::Value {
    writer.push_f32_section(
        "envCell.portalApertures.points",
        format!(
            "{path_prefix}.portalApertures.{}.points",
            aperture.source_index
        ),
        3,
        aperture
            .points
            .iter()
            .flat_map(|point| [point.x, point.y, point.z]),
    );
    serde_json::json!({
        "portalId": aperture.portal_id,
        "sourceIndex": aperture.source_index,
        "polygonId": aperture.polygon_id,
        "points": [],
        "plane": aperture.plane.as_ref().map(serialize_prepared_portal_aperture_plane),
    })
}

fn serialize_env_cell_local_bvh(
    cell: &PreparedInteriorCell,
    static_meshes: &[&PreparedStaticMesh],
) -> serde_json::Value {
    let mut items = Vec::new();
    if cell.render_geometry.bounds.is_some() {
        items.push(serde_json::json!({
            "kind": "render-geometry",
            "polygonId": null,
            "triangleRange": [0, cell.render_geometry.triangle_count],
        }));
    }
    items.extend(
        static_meshes
            .iter()
            .map(|mesh| serde_json::json!({ "kind": "static", "instanceId": mesh.instance_id })),
    );
    items.extend(
        cell.portals
            .iter()
            .map(|portal| serde_json::json!({ "kind": "portal", "portalId": portal.portal_id })),
    );
    let mut node_inputs = Vec::new();
    if let Some(bounds) = cell.render_geometry.bounds {
        node_inputs.push((bounds, 1_u32));
    }
    node_inputs.extend(
        static_meshes
            .iter()
            .filter_map(|mesh| mesh.instance_bounds.map(|bounds| (bounds, 2_u32))),
    );
    node_inputs.extend(
        cell.portal_apertures
            .iter()
            .filter_map(|aperture| portal_aperture_bounds(aperture).map(|bounds| (bounds, 4_u32))),
    );
    serde_json::json!({
        "coordinateSpace": "env-cell-local",
        "nodes": build_flat_bvh_nodes_from_bounds(node_inputs),
        "items": items,
    })
}

fn portal_aperture_bounds(aperture: &PreparedPortalAperture) -> Option<PreparedAabb> {
    aperture
        .points
        .iter()
        .copied()
        .fold(None, |bounds, point| Some(expand_bounds(bounds, point)))
}

fn serialize_terrain_material_payload(table: &ResolvedTerrainMaterialTable) -> serde_json::Value {
    serde_json::json!({
        "kind": "terrain-material",
        "residencyKind": "unknown",
        "sourceAssetKind": "terrain-material",
        "regionNumber": table.region_number,
        "materialKind": "tex-merge-table",
        "terrainTypes": table.terrain_types.iter().map(|terrain| {
            serde_json::json!({
                "terrainType": terrain.terrain_type,
                "textureAssetId": format_render_texture_asset_id(terrain.texture_id),
                "textureDid": terrain.texture_id,
                "tiling": terrain.tiling,
                "detail": (terrain.detail_texture_id != 0).then(|| serde_json::json!({
                    "textureAssetId": format_render_texture_asset_id(terrain.detail_texture_id),
                    "textureDid": terrain.detail_texture_id,
                    "tiling": terrain.detail_tiling,
                    "fadeNear": 0.0,
                    "fadeFar": 0.0,
                })),
                "colorVariation": serde_json::json!({
                    "minVertBright": terrain.min_vert_bright,
                    "maxVertBright": terrain.max_vert_bright,
                    "minVertSaturate": terrain.min_vert_saturate,
                    "maxVertSaturate": terrain.max_vert_saturate,
                    "minVertHue": terrain.min_vert_hue,
                    "maxVertHue": terrain.max_vert_hue,
                    "activeRenderPath": false,
                }),
            })
        }).collect::<Vec<_>>(),
        "terrainAlphaMaps": table.terrain_alpha_maps.iter().map(|map| {
            serde_json::json!({
                "alphaIndex": map.alpha_index,
                "alphaTextureAssetId": format_render_texture_asset_id(map.texture_id),
                "alphaTextureDid": map.texture_id,
                "selector": map.selector,
            })
        }).collect::<Vec<_>>(),
        "roadAlphaMaps": table.road_alpha_maps.iter().map(|map| {
            serde_json::json!({
                "roadIndex": map.road_index,
                "roadTextureAssetId": format_render_texture_asset_id(map.road_texture_id),
                "roadTextureDid": map.road_texture_id,
                "alphaTextureAssetId": format_render_texture_asset_id(map.alpha_texture_id),
                "alphaTextureDid": map.alpha_texture_id,
                "selector": map.selector,
            })
        }).collect::<Vec<_>>(),
        "pcodeEncoding": {
            "terrainCodeBits": 5,
            "roadCodeBits": 2,
            "sizeBitMask": 1 << 28,
        },
        "dependencies": {
            "renderTextureAssetIds": table.render_texture_ids.iter().map(|id| format_render_texture_asset_id(*id)).collect::<Vec<_>>(),
            "renderSurfaceAssetIds": [],
            "paletteAssetIds": [],
        },
        "provenance": {
            "source": "repo-local-hba",
            "sourceAssetKind": "terrain-material",
            "errorCode": null,
            "detail": null
        }
    })
}

fn serialize_landblock_summary_building(building: &LandblockSummaryBuilding) -> serde_json::Value {
    serde_json::json!({
        "instanceId": building.instance_id,
        "owningLandblockId": building.owning_landblock_id,
        "sourceDid": building.source_did,
        "sourceAssetId": building.source_asset_id,
        "sourceIndex": building.source_index,
        "localPlacement": serialize_frame(&building.local_placement),
        "numLeaves": building.num_leaves,
        "portals": building.portals.iter().map(serialize_landblock_summary_building_portal).collect::<Vec<_>>(),
    })
}

fn serialize_landblock_summary_building_portal(
    portal: &LandblockSummaryBuildingPortal,
) -> serde_json::Value {
    serde_json::json!({
        "portalId": portal.portal_id,
        "sourceIndex": portal.source_index,
        "flags": portal.flags,
        "otherCellId": portal.other_cell_id,
        "otherPortalId": portal.other_portal_id,
        "stabList": portal.stab_list,
        "linkedEnvCellIds": portal.linked_env_cell_ids,
    })
}

fn serialize_prepared_terrain_mesh(mesh: &PreparedTerrainMesh) -> serde_json::Value {
    serde_json::json!({
        "landblockId": mesh.landblock_id,
        "gridSize": mesh.grid_size,
        "tileSize": mesh.tile_size,
        "vertices": mesh.vertices.iter().map(serialize_prepared_vec3).collect::<Vec<_>>(),
        "triangles": mesh.triangles.iter().map(serialize_prepared_terrain_triangle).collect::<Vec<_>>(),
        "minHeight": mesh.min_height,
        "maxHeight": mesh.max_height,
    })
}

fn serialize_prepared_terrain_triangle(triangle: &PreparedTerrainTriangle) -> serde_json::Value {
    serde_json::json!({
        "a": triangle.a,
        "b": triangle.b,
        "c": triangle.c,
        "terrainType": triangle.terrain_type,
        "averageHeight": triangle.average_height,
    })
}

fn serialize_prepared_interior_cell(cell: &PreparedInteriorCell) -> serde_json::Value {
    serde_json::json!({
        "envCellId": cell.env_cell_id,
        "environmentId": cell.environment_id,
        "cellStructureId": cell.cell_structure_id,
        "localPlacement": serialize_frame(&cell.local_placement),
        "surfaceIds": cell.surface_ids,
        "portals": cell.portals.iter().map(|portal| {
            serde_json::json!({
                "portalId": portal.portal_id,
                "sourceIndex": portal.source_index,
                "flags": portal.flags,
                "polygonId": portal.polygon_id,
                "otherCellId": portal.other_cell_id,
                "otherPortalId": portal.other_portal_id,
                "targetEnvCellId": portal.target_env_cell_id,
                "isOutsideTransition": portal.is_outside_transition,
            })
        }).collect::<Vec<_>>(),
        "portalApertures": cell.portal_apertures.iter().map(serialize_prepared_portal_aperture).collect::<Vec<_>>(),
        "staticObjectCount": cell.static_object_count,
        "cellBsp": serialize_bsp_node(&cell.cell_bsp),
        "renderGeometry": serialize_prepared_polygon_set_render_geometry(&cell.render_geometry),
    })
}

fn serialize_prepared_portal_aperture(aperture: &PreparedPortalAperture) -> serde_json::Value {
    serde_json::json!({
        "portalId": aperture.portal_id,
        "sourceIndex": aperture.source_index,
        "polygonId": aperture.polygon_id,
        "points": aperture.points.iter().map(serialize_prepared_vec3).collect::<Vec<_>>(),
        "plane": aperture.plane.as_ref().map(serialize_prepared_portal_aperture_plane),
    })
}

fn serialize_prepared_portal_aperture_plane(
    plane: &PreparedPortalAperturePlane,
) -> serde_json::Value {
    serde_json::json!({
        "normal": serialize_prepared_vec3(&plane.normal),
        "constant": plane.constant,
        "source": serialize_prepared_portal_aperture_plane_source(plane.source),
    })
}

fn serialize_prepared_portal_aperture_plane_source(
    source: PreparedPortalAperturePlaneSource,
) -> &'static str {
    match source {
        PreparedPortalAperturePlaneSource::DrawingBspPortal => "drawing-bsp-portal",
        PreparedPortalAperturePlaneSource::DerivedFromRenderPoints => "derived-from-render-points",
    }
}

fn serialize_prepared_static_instance(instance: &PreparedStaticInstance) -> serde_json::Value {
    serde_json::json!({
        "instanceId": instance.instance_id,
        "kind": serialize_prepared_static_instance_kind(instance.kind),
        "owningLandblockId": instance.owning_landblock_id,
        "owningEnvCellId": instance.owning_env_cell_id,
        "sourceDid": instance.source_did,
        "sourceAssetId": instance.source_asset_id,
        "sourceIndex": instance.source_index,
        "localPlacement": serialize_frame(&instance.local_placement),
        "sourceScale": serialize_prepared_vec3(&instance.source_scale),
    })
}

fn serialize_prepared_static_mesh(mesh: &PreparedStaticMesh) -> serde_json::Value {
    serde_json::json!({
        "instanceId": mesh.instance_id,
        "kind": serialize_prepared_static_instance_kind(mesh.kind),
        "owningLandblockId": mesh.owning_landblock_id,
        "owningEnvCellId": mesh.owning_env_cell_id,
        "sourceDid": mesh.source_did,
        "sourceAssetId": mesh.source_asset_id,
        "sourceIndex": mesh.source_index,
        "localPlacement": serialize_frame(&mesh.local_placement),
        "sourceScale": serialize_prepared_vec3(&mesh.source_scale),
        "partIndex": mesh.part_index,
        "gfxObjId": mesh.gfx_obj_id,
        "gfxObjAssetId": mesh.gfx_obj_asset_id,
        "partPlacements": mesh.part_placements.iter().map(serialize_frame).collect::<Vec<_>>(),
        "partScale": serialize_prepared_vec3(&mesh.part_scale),
        "sourceBounds": mesh.source_bounds.as_ref().map(serialize_prepared_aabb),
        "instanceBounds": mesh.instance_bounds.as_ref().map(serialize_prepared_aabb),
    })
}

fn serialize_prepared_static_instance_kind(kind: PreparedStaticInstanceKind) -> &'static str {
    match kind {
        PreparedStaticInstanceKind::Scenery => "scenery",
        PreparedStaticInstanceKind::Building => "building",
        PreparedStaticInstanceKind::GeneratedScenery => "generated-scenery",
        PreparedStaticInstanceKind::IndoorStatic => "indoor-static",
    }
}

fn serialize_prepared_spatial_item(item: &PreparedSpatialItem) -> serde_json::Value {
    serde_json::json!({
        "id": item.id,
        "kind": serialize_prepared_spatial_item_kind(item.kind),
        "ownerId": item.owner_id,
        "sourceAssetId": item.source_asset_id,
        "bounds": serialize_prepared_aabb(&item.bounds),
        "metadata": serialize_prepared_spatial_item_metadata(&item.metadata),
    })
}

fn serialize_prepared_spatial_item_metadata(
    metadata: &PreparedSpatialItemMetadata,
) -> serde_json::Value {
    match metadata {
        PreparedSpatialItemMetadata::None => serde_json::json!({ "kind": "none" }),
        PreparedSpatialItemMetadata::TerrainQuad(terrain) => serde_json::json!({
            "kind": "terrain-quad",
            "row": terrain.row,
            "col": terrain.col,
            "quadIndex": terrain.quad_index,
            "triangleIndices": terrain.triangle_indices,
        }),
    }
}

fn serialize_prepared_spatial_item_kind(kind: PreparedSpatialItemKind) -> &'static str {
    match kind {
        PreparedSpatialItemKind::Terrain => "terrain",
        PreparedSpatialItemKind::OutdoorStatic => "outdoor-static",
        PreparedSpatialItemKind::Building => "building",
        PreparedSpatialItemKind::EnvCell => "env-cell",
        PreparedSpatialItemKind::IndoorStatic => "indoor-static",
        PreparedSpatialItemKind::Portal => "portal",
    }
}

fn serialize_prepared_bvh(bvh: &PreparedBvh) -> serde_json::Value {
    serde_json::json!({
        "coordinateSpace": bvh.coordinate_space,
        "landblockId": bvh.landblock_id,
        "scope": bvh.scope,
        "nodes": bvh.nodes.iter().map(serialize_prepared_bvh_node).collect::<Vec<_>>(),
    })
}

fn serialize_prepared_bvh_node(node: &PreparedBvhNode) -> serde_json::Value {
    serde_json::json!({
        "bounds": serialize_prepared_aabb(&node.bounds),
        "left": node.left,
        "right": node.right,
        "itemIndices": node.item_indices,
        "kindMask": node.kind_mask,
    })
}

fn serialize_prepared_polygon_set_render_geometry(
    geometry: &PreparedPolygonSetRenderGeometry,
) -> serde_json::Value {
    serde_json::json!({
        "sourceId": geometry.source_id,
        "vertexCount": geometry.vertex_count,
        "triangleCount": geometry.triangle_count,
        "positions": geometry.positions,
        "normals": geometry.normals,
        "uvs": geometry.uvs,
        "triangles": geometry.triangles.iter().map(serialize_prepared_polygon_set_render_triangle).collect::<Vec<_>>(),
        "surfaceIds": geometry.surface_ids,
        "invalidPolygons": geometry.invalid_polygons.iter().map(serialize_prepared_polygon_set_invalid_polygon).collect::<Vec<_>>(),
        "skippedPolygonCount": geometry.skipped_polygon_count,
        "bounds": geometry.bounds.as_ref().map(serialize_prepared_aabb),
    })
}

fn serialize_prepared_polygon_set_render_triangle(
    triangle: &PreparedPolygonSetRenderTriangle,
) -> serde_json::Value {
    serde_json::json!({
        "polygonId": triangle.polygon_id,
        "surfaceId": triangle.surface_id,
        "firstVertex": triangle.first_vertex,
    })
}

fn serialize_prepared_polygon_set_invalid_polygon(
    polygon: &PreparedPolygonSetInvalidPolygon,
) -> serde_json::Value {
    serde_json::json!({
        "polygonId": polygon.polygon_id,
        "vertexIds": polygon.vertex_ids,
        "missingVertexIds": polygon.missing_vertex_ids,
    })
}

fn serialize_prepared_aabb(bounds: &PreparedAabb) -> serde_json::Value {
    serde_json::json!({
        "min": serialize_prepared_vec3(&bounds.min),
        "max": serialize_prepared_vec3(&bounds.max),
    })
}

fn serialize_bounds(bounds: PreparedAabb) -> serde_json::Value {
    serialize_prepared_aabb(&bounds)
}

fn serialize_prepared_vec3(vector: &PreparedVec3) -> serde_json::Value {
    serde_json::json!({
        "x": vector.x,
        "y": vector.y,
        "z": vector.z,
    })
}

fn derive_landblock_pack_cell_dat_ids(pack: &LandblockPack) -> Vec<u32> {
    let mut ids = vec![pack.landblock_id, pack.landblock_info_id];
    ids.extend(
        pack.interiors
            .env_cells
            .iter()
            .map(|env_cell| env_cell.env_cell_id),
    );
    ids.sort_unstable();
    ids.dedup();
    ids
}

fn derive_landblock_pack_portal_dat_ids(pack: &LandblockPack) -> Vec<u32> {
    let mut ids = pack
        .interiors
        .environments
        .iter()
        .map(|environment| environment.id)
        .collect::<Vec<_>>();
    ids.sort_unstable();
    ids.dedup();
    ids
}

fn derive_landblock_summary_cell_dat_ids(summary: &LandblockSummary) -> Vec<u32> {
    let mut ids = vec![summary.landblock_id, summary.landblock_info_id];
    ids.sort_unstable();
    ids.dedup();
    ids
}

fn derive_landblock_summary_renderable_asset_ids(summary: &LandblockSummary) -> Vec<String> {
    let mut ids = summary
        .objects
        .iter()
        .filter_map(|object| object.source_asset_id.clone())
        .chain(
            summary
                .buildings
                .iter()
                .filter_map(|building| building.source_asset_id.clone()),
        )
        .collect::<Vec<_>>();
    ids.sort();
    ids.dedup();
    ids
}

fn serialize_landblock_classification(classification: LandblockClassification) -> &'static str {
    match classification {
        LandblockClassification::Outdoor => "outdoor",
        LandblockClassification::Dungeon => "dungeon",
    }
}

fn serialize_landblock_pack_building_facts(
    scene: Option<&StaticOutdoorScene>,
) -> Vec<serde_json::Value> {
    scene
        .map(|scene| {
            scene.buildings
                .iter()
                .filter_map(|building| {
                    serialize_static_outdoor_instance(&building.instance).map(|mut value| {
                        value["numLeaves"] = serde_json::json!(building.num_leaves);
                        value["portals"] = serde_json::json!(
                            building
                                .portals
                                .iter()
                                .map(|portal| {
                                    serde_json::json!({
                                        "portalId": format!("{}/portal/{:04x}", building.instance.identity.stable_id(), portal.source_index),
                                        "sourceIndex": portal.source_index,
                                        "flags": portal.flags,
                                        "otherCellId": portal.other_cell_id,
                                        "otherPortalId": portal.other_portal_id,
                                        "stabList": portal.stab_list,
                                        "linkedEnvCellIds": portal.linked_env_cell_ids,
                                    })
                                })
                                .collect::<Vec<_>>()
                        );
                        value
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn derive_landblock_pack_renderable_asset_ids(pack: &LandblockPack) -> Vec<String> {
    let mut asset_ids = pack
        .outdoor_scene
        .as_ref()
        .into_iter()
        .flat_map(|scene| {
            scene
                .explicit_objects
                .iter()
                .chain(scene.buildings.iter().map(|building| &building.instance))
                .chain(
                    scene
                        .generated_scenery
                        .iter()
                        .map(|generated| &generated.instance),
                )
        })
        .filter_map(|instance| {
            format_renderable_source_asset_id(instance.source.family, instance.source.did)
        })
        .chain(pack.interiors.env_cells.iter().flat_map(|env_cell| {
            env_cell
                .static_objects
                .iter()
                .map(|static_object| static_object.source_asset_id.clone())
        }))
        .filter(|asset_id| is_static_renderable_asset_id(asset_id))
        .collect::<Vec<_>>();
    asset_ids.sort();
    asset_ids.dedup();
    asset_ids
}

fn is_static_renderable_asset_id(asset_id: &str) -> bool {
    asset_id.starts_with("gfx-obj/") || asset_id.starts_with("setup-model/")
}

fn format_gfx_obj_asset_id(gfx_obj_id: u32) -> String {
    format!("gfx-obj/{gfx_obj_id:08x}")
}

fn format_setup_appearance_asset_id(setup_model_id: u32) -> String {
    format!("setup-appearance/{setup_model_id:08x}")
}

fn format_env_cell_asset_id(env_cell_id: u32) -> String {
    format!("env-cell/{env_cell_id:08x}")
}

fn format_material_asset_id(surface_id: u32) -> String {
    format!("material/{surface_id:08x}")
}

fn format_render_texture_asset_id(render_texture_id: u32) -> String {
    format!("render-texture/{render_texture_id:08x}")
}

fn format_render_surface_asset_id(render_surface_id: u32) -> String {
    format!("render-surface/{render_surface_id:08x}")
}

fn format_palette_asset_id(palette_id: u32) -> String {
    format!("palette/{palette_id:08x}")
}

fn recipe_palette_asset_ids(texture: &holtburger_content::ResolvedTextureMaterial) -> Vec<String> {
    let mut palette_ids = texture
        .palette_id
        .into_iter()
        .chain(texture.render_surface_default_palette_ids.iter().copied())
        .map(format_palette_asset_id)
        .collect::<Vec<_>>();
    palette_ids.sort();
    palette_ids.dedup();
    palette_ids
}

fn serialize_landblock_pack_diagnostics(
    diagnostics: &LandblockPackSourceDiagnostics,
) -> serde_json::Value {
    serde_json::json!({
        "sourceRecords": diagnostics.source_records.iter().map(serialize_source_record_diagnostic).collect::<Vec<_>>(),
        "omissions": diagnostics.omissions.iter().map(serialize_source_omission_diagnostic).collect::<Vec<_>>(),
        "errors": diagnostics.errors.iter().map(serialize_source_load_error).collect::<Vec<_>>(),
    })
}

fn serialize_source_record_diagnostic(diagnostic: &SourceRecordDiagnostic) -> serde_json::Value {
    serde_json::json!({
        "namespace": diagnostic.namespace,
        "fileId": diagnostic.file_id,
        "role": diagnostic.role,
        "status": serialize_source_record_status(diagnostic.status),
    })
}

fn serialize_source_omission_diagnostic(
    diagnostic: &SourceOmissionDiagnostic,
) -> serde_json::Value {
    serde_json::json!({
        "namespace": diagnostic.namespace,
        "fileId": diagnostic.file_id,
        "role": diagnostic.role,
        "reason": diagnostic.reason,
        "detail": diagnostic.detail,
    })
}

fn serialize_source_record_status(status: SourceRecordStatus) -> &'static str {
    match status {
        SourceRecordStatus::Loaded => "loaded",
        SourceRecordStatus::Missing => "missing",
        SourceRecordStatus::DecodeFailed => "decode-failed",
    }
}

fn serialize_source_load_error(error: &SourceLoadError) -> serde_json::Value {
    serde_json::json!({
        "namespace": error.namespace,
        "fileId": error.file_id,
        "role": error.role,
        "errorCode": error.error_code,
        "detail": error.detail,
    })
}

fn serialize_static_outdoor_instance(
    instance: &StaticOutdoorInstance,
) -> Option<serde_json::Value> {
    let source_asset_id =
        format_renderable_source_asset_id(instance.source.family, instance.source.did)?;
    Some(serde_json::json!({
        "instanceId": instance.identity.stable_id(),
        "owningLandblockId": instance.owning_landblock_id,
        "sourceDid": instance.source.did,
        "sourceAssetId": source_asset_id,
        "sourceIndex": instance.source_index,
        "localPlacement": serialize_static_outdoor_placement_dto(&instance.frame),
    }))
}

fn format_renderable_source_asset_id(
    family: StaticRenderableSourceFamily,
    did: u32,
) -> Option<String> {
    match family {
        StaticRenderableSourceFamily::GfxObj => Some(format!("gfx-obj/{did:08x}")),
        StaticRenderableSourceFamily::SetupModel => Some(format!("setup-model/{did:08x}")),
        StaticRenderableSourceFamily::Unsupported => None,
    }
}

fn serialize_static_outdoor_placement_dto(frame: &StaticOutdoorFrame) -> PlacementTransformDto {
    PlacementTransformDto {
        origin: serialize_vec3_dto(&frame.origin),
        orientation: serialize_quaternion_dto(&frame.orientation),
    }
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

fn serialize_vector3(vector: &Vector3) -> serde_json::Value {
    serde_json::json!({
        "x": vector.x,
        "y": vector.y,
        "z": vector.z,
    })
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
                "gfxObjAssetId": format_gfx_obj_asset_id(*gfx_obj_id),
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
                "localPlacement": serialize_frame(&location.frame),
            })
        })
        .collect()
}

fn serialize_placement_sets(setup_model: &SetupModel) -> Vec<serde_json::Value> {
    let mut entries = setup_model.placement_frames.iter().collect::<Vec<_>>();
    entries.sort_by_key(|(key, _)| **key);
    entries
        .into_iter()
        .map(|(key, placement)| {
            serde_json::json!({
                "key": key,
                "localPlacements": placement
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

#[cfg(test)]
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

#[cfg(test)]
fn vec3_length(vector: &Vec3Dto) -> f32 {
    (vector.x.powi(2) + vector.y.powi(2) + vector.z.powi(2)).sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_dat::file_type::PixelFormatId;

    #[test]
    fn asset_lookup_remains_available_without_browser_runtime_residency() {
        let runtime = HostRuntimeService::new(false);
        let asset = runtime.asset_lookup_blocking(AssetLookupRequestDto {
            request_id: "test-request".to_string(),
            asset_id: "landblock-pack/0102ffff".to_string(),
            priority: crate::contracts::AssetPriorityDto::Bootstrap,
        });

        assert_eq!(asset.request_id, "test-request");
        assert_eq!(asset.asset_id, "landblock-pack/0102ffff");
        assert!(matches!(asset.payload_kind, AssetPayloadKindDto::Json));
        assert_eq!(asset.payload["kind"], "landblock-pack");
        assert_eq!(asset.payload["residencyKind"], "landblock");
        assert_eq!(asset.payload["landblockId"], 0x0102ffff);
    }

    #[test]
    fn landblock_pack_lookup_returns_prepared_landblock_payload() {
        let runtime = HostRuntimeService::new(false);
        let asset = runtime.asset_lookup_blocking(AssetLookupRequestDto {
            request_id: "test-landblock-pack".to_string(),
            asset_id: "landblock-pack/da55012e".to_string(),
            priority: crate::contracts::AssetPriorityDto::Bootstrap,
        });

        assert_eq!(asset.request_id, "test-landblock-pack");
        assert_eq!(asset.asset_id, "landblock-pack/da55012e");
        assert_eq!(asset.payload["kind"], "landblock-pack");
        assert_eq!(asset.payload["residencyKind"], "landblock");
        assert_eq!(asset.payload["landblockId"], 0xda55ffffu32);
        assert_eq!(asset.payload["landblockInfoId"], 0xda55fffeu32);
        assert!(matches!(
            asset.payload["classification"].as_str(),
            Some("outdoor" | "dungeon")
        ));
        assert!(
            asset.payload["sourceFacts"]["buildings"]
                .as_array()
                .is_some()
        );
        assert!(
            !asset.payload["prepared"]["terrainMesh"]["triangles"]
                .as_array()
                .expect("pack should expose Rust-prepared terrain triangles")
                .is_empty()
        );
        assert!(
            asset.payload["prepared"]["interiorCells"]
                .as_array()
                .expect("pack should expose Rust-prepared interior cells")
                .iter()
                .all(|cell| cell["renderGeometry"]["vertexCount"]
                    .as_u64()
                    .is_some_and(|vertex_count| vertex_count > 0))
        );
        assert!(
            asset.payload["prepared"]["spatialItems"]
                .as_array()
                .expect("pack should expose Rust-prepared spatial items")
                .iter()
                .any(|item| item["kind"] == "terrain")
        );
        assert_eq!(
            asset.payload["prepared"]["staticLandblockBvh"]["scope"],
            "static-landblock"
        );
        assert!(
            asset.payload["prepared"]["staticLandblockBvh"]["nodes"]
                .as_array()
                .expect("pack should expose Rust-built BVH nodes")
                .iter()
                .any(|node| node["kindMask"].as_u64().is_some_and(|mask| mask != 0))
        );
        assert!(
            asset.payload["dependencies"]["cellDatIds"]
                .as_array()
                .expect("pack should expose cell DAT dependencies")
                .iter()
                .any(|id| id == 0xda550100u32)
        );
        assert!(
            asset.payload["dependencies"]["portalDatIds"]
                .as_array()
                .expect("pack should expose portal DAT dependencies")
                .iter()
                .any(|id| id.as_u64().is_some_and(|id| (id >> 24) == 0x0d))
        );
        assert!(
            asset.payload["dependencies"]["renderableAssetIds"]
                .as_array()
                .is_some()
        );
        assert!(
            asset.payload["diagnostics"]["sourceRecords"]
                .as_array()
                .expect("source records should be exposed")
                .iter()
                .any(|record| record["status"] == "loaded")
        );
    }

    #[test]
    fn granular_landblock_terrain_lookup_returns_route_payload() {
        let runtime = HostRuntimeService::new(false);
        let asset = runtime.asset_lookup_blocking(AssetLookupRequestDto {
            request_id: "test-landblock-terrain".to_string(),
            asset_id: "landblock/da55ffff/terrain".to_string(),
            priority: crate::contracts::AssetPriorityDto::Bootstrap,
        });

        assert_eq!(asset.asset_id, "landblock/da55ffff/terrain");
        assert_eq!(asset.payload["kind"], "landblock-terrain");
        assert_eq!(asset.payload["landblockId"], 0xda55ffffu32);
        assert_eq!(asset.payload["regionId"], REGION_DESC_FILE_ID);
        assert!(
            asset.payload["regionNumber"]
                .as_u64()
                .expect("terrain route should expose a region number")
                > 0
        );
        let quads = asset.payload["terrain"]["quads"]
            .as_array()
            .expect("terrain route should expose quads");
        assert!(!quads.is_empty());
        assert!(quads[0]["pcode"].as_u64().is_some_and(|pcode| pcode != 0));
        assert_eq!(
            quads[0]["cornerTerrainCodes"]
                .as_array()
                .expect("terrain quads should expose pcode terrain inputs")
                .len(),
            4
        );
        assert_eq!(
            asset.payload["terrain"]["terrainBvh"]["coordinateSpace"],
            "landblock-terrain-local"
        );
        assert!(asset.payload.get("buildingShells").is_none());
    }

    #[test]
    fn granular_landblock_building_shells_lookup_returns_coverage_payload() {
        let runtime = HostRuntimeService::new(false);
        let asset = runtime.asset_lookup_blocking(AssetLookupRequestDto {
            request_id: "test-landblock-building-shells".to_string(),
            asset_id: "landblock/da55ffff/building-shells".to_string(),
            priority: crate::contracts::AssetPriorityDto::Bootstrap,
        });

        assert_eq!(asset.asset_id, "landblock/da55ffff/building-shells");
        assert_eq!(asset.payload["kind"], "landblock-building-shells");
        assert_eq!(asset.payload["landblockId"], 0xda55ffffu32);
        assert!(asset.payload.get("terrain").is_none());
        assert!(asset.payload.get("envCells").is_none());
        assert!(
            asset.payload["shells"]
                .as_array()
                .expect("building-shell route should expose shell members")
                .iter()
                .all(|shell| shell["sourceAssetId"]
                    .as_str()
                    .is_some_and(|asset_id| asset_id.starts_with("setup-model/")
                        || asset_id.starts_with("gfx-obj/")))
        );
        assert_eq!(
            asset.payload["shellBvh"]["coordinateSpace"],
            "landblock-local"
        );
    }

    #[test]
    fn granular_landblock_scene_lookup_returns_membership_payload() {
        let runtime = HostRuntimeService::new(false);
        let asset = runtime.asset_lookup_blocking(AssetLookupRequestDto {
            request_id: "test-landblock-scene".to_string(),
            asset_id: "landblock/da55ffff/scene".to_string(),
            priority: crate::contracts::AssetPriorityDto::Bootstrap,
        });

        assert_eq!(asset.payload["kind"], "landblock-scene");
        assert_eq!(asset.payload["landblockId"], 0xda55ffffu32);
        assert!(
            asset.payload["envCells"]
                .as_array()
                .expect("scene route should expose env cell members")
                .iter()
                .any(|cell| cell["assetId"] == "env-cell/da550100")
        );
        assert_eq!(
            asset.payload["envCellResidencyBvh"]["coordinateSpace"],
            "landblock-scene-residency"
        );
    }

    #[test]
    fn landblock_outdoor_lookup_returns_render_payload() {
        let runtime = HostRuntimeService::new(false);
        let asset = runtime.asset_lookup_blocking(AssetLookupRequestDto {
            request_id: "test-landblock-outdoor".to_string(),
            asset_id: "landblock/da55ffff/outdoor".to_string(),
            priority: crate::contracts::AssetPriorityDto::Bootstrap,
        });

        assert_eq!(asset.asset_id, "landblock/da55ffff/outdoor");
        assert_eq!(asset.payload["kind"], "landblock-outdoor");
        assert_eq!(asset.payload["sourceAssetKind"], "landblock-outdoor");
        assert_eq!(asset.payload["landblockId"], 0xda55ffffu32);
        assert_eq!(asset.payload["regionId"], REGION_DESC_FILE_ID);
        assert!(
            asset.payload["terrain"]["quads"]
                .as_array()
                .expect("outdoor route should expose terrain quads")
                .iter()
                .any(|quad| quad["pcode"].as_u64().is_some_and(|pcode| pcode != 0))
        );
        assert!(
            asset.payload["statics"]
                .as_array()
                .expect("outdoor route should expose render statics")
                .iter()
                .all(|member| member["sourceAssetId"]
                    .as_str()
                    .is_some_and(|asset_id| asset_id.starts_with("setup-model/")
                        || asset_id.starts_with("gfx-obj/")))
        );
        assert!(asset.payload.get("envCells").is_none());
    }

    #[test]
    fn landblock_topology_lookup_returns_env_cell_membership_only() {
        let runtime = HostRuntimeService::new(false);
        let asset = runtime.asset_lookup_blocking(AssetLookupRequestDto {
            request_id: "test-landblock-topology".to_string(),
            asset_id: "landblock/da55ffff/topology".to_string(),
            priority: crate::contracts::AssetPriorityDto::Bootstrap,
        });

        assert_eq!(asset.asset_id, "landblock/da55ffff/topology");
        assert_eq!(asset.payload["kind"], "landblock-topology");
        assert_eq!(asset.payload["sourceAssetKind"], "landblock-topology");
        assert_eq!(asset.payload["landblockId"], 0xda55ffffu32);
        assert!(
            asset.payload["envCells"]
                .as_array()
                .expect("topology route should expose env cell members")
                .iter()
                .any(|cell| cell["assetId"] == "env-cell/da550100")
        );
        assert!(asset.payload.get("terrain").is_none());
        assert!(asset.payload.get("statics").is_none());
    }

    #[test]
    fn granular_env_cell_lookup_returns_material_slot_payload() {
        let runtime = HostRuntimeService::new(false);
        let asset = runtime.asset_lookup_blocking(AssetLookupRequestDto {
            request_id: "test-env-cell".to_string(),
            asset_id: "env-cell/da550100".to_string(),
            priority: crate::contracts::AssetPriorityDto::Bootstrap,
        });

        assert_eq!(asset.payload["kind"], "env-cell");
        assert_eq!(asset.payload["envCellId"], 0xda550100u32);
        assert!(
            asset.payload["surfaces"]
                .as_array()
                .expect("env-cell route should expose surface slots")
                .iter()
                .all(|surface| surface["materialAssetId"]
                    .as_str()
                    .is_some_and(|asset_id| asset_id.starts_with("material/08")))
        );
        assert_eq!(
            asset.payload["localBvh"]["coordinateSpace"],
            "env-cell-local"
        );
        assert!(
            !asset.payload["localBvh"]["nodes"]
                .as_array()
                .expect("env-cell local BVH should expose scoped nodes")
                .is_empty()
        );
    }

    #[test]
    fn granular_terrain_and_env_cell_binary_lookup_moves_bulk_arrays_into_sections() {
        let adapter = HostBoundaryAdapter::new(false);
        let bytes = tauri::async_runtime::block_on(adapter.asset_lookup_binary_batch(vec![
            AssetLookupRequestDto {
                request_id: "test-landblock-terrain-binary".to_string(),
                asset_id: "landblock/da55ffff/terrain".to_string(),
                priority: crate::contracts::AssetPriorityDto::Bootstrap,
            },
            AssetLookupRequestDto {
                request_id: "test-env-cell-binary".to_string(),
                asset_id: "env-cell/da550100".to_string(),
                priority: crate::contracts::AssetPriorityDto::Bootstrap,
            },
        ]))
        .expect("binary granular route lookup should succeed");
        let (manifest, _) = decode_binary_manifest(&bytes);
        let sections = manifest["sections"]
            .as_array()
            .expect("binary manifest should expose sections");

        assert!(
            sections
                .iter()
                .any(|section| section["path"] == "responses.0.payload.terrain.vertices")
        );
        assert!(
            sections
                .iter()
                .any(|section| section["path"] == "responses.1.payload.renderGeometry.positions")
        );
        assert_eq!(
            manifest["responses"][0]["payload"]["terrain"]["vertices"]
                .as_array()
                .expect("terrain binary payload should leave JSON vertex placeholder")
                .len(),
            0
        );
        assert_eq!(
            manifest["responses"][1]["payload"]["renderGeometry"]["positions"]
                .as_array()
                .expect("env-cell binary payload should leave JSON render positions placeholder")
                .len(),
            0
        );
    }

    #[test]
    fn terrain_material_lookup_returns_region_table_payload() {
        let runtime = HostRuntimeService::new(false);
        let terrain = runtime.asset_lookup_blocking(AssetLookupRequestDto {
            request_id: "test-landblock-terrain-region".to_string(),
            asset_id: "landblock/da55ffff/terrain".to_string(),
            priority: crate::contracts::AssetPriorityDto::Bootstrap,
        });
        let region_number = terrain.payload["regionNumber"]
            .as_u64()
            .expect("terrain route should expose region number");
        let asset = runtime.asset_lookup_blocking(AssetLookupRequestDto {
            request_id: "test-terrain-material".to_string(),
            asset_id: format!("terrain-material/{region_number}"),
            priority: crate::contracts::AssetPriorityDto::Bootstrap,
        });

        assert_eq!(asset.payload["kind"], "terrain-material");
        assert_eq!(asset.payload["materialKind"], "tex-merge-table");
        assert_eq!(asset.payload["regionNumber"], region_number);
        assert!(
            !asset.payload["terrainTypes"]
                .as_array()
                .expect("terrain material route should expose terrain texture table")
                .is_empty()
        );
        assert!(
            !asset.payload["dependencies"]["renderTextureAssetIds"]
                .as_array()
                .expect("terrain material route should expose texture dependencies")
                .is_empty()
        );
    }

    #[test]
    fn landblock_pack_binary_lookup_moves_bulk_arrays_into_sections() {
        let adapter = HostBoundaryAdapter::new(false);
        let bytes = tauri::async_runtime::block_on(adapter.asset_lookup_binary_batch(vec![
            AssetLookupRequestDto {
                request_id: "test-landblock-pack-binary".to_string(),
                asset_id: "landblock-pack/da55012e".to_string(),
                priority: crate::contracts::AssetPriorityDto::Bootstrap,
            },
        ]))
        .expect("binary landblock-pack lookup should succeed");

        let (manifest, manifest_len) = decode_binary_manifest(&bytes);

        assert_eq!(manifest["transport"], "holtburger-asset-binary");
        assert_eq!(
            manifest["responses"][0]["payload"]["prepared"]["terrainMesh"]["vertices"]
                .as_array()
                .expect("bulk terrain vertices should be manifest placeholders")
                .len(),
            0
        );
        let sections = manifest["sections"]
            .as_array()
            .expect("binary manifest should expose sections");
        assert!(
            sections
                .iter()
                .any(|section| section["path"]
                    == "responses.0.payload.prepared.terrainMesh.vertices")
        );
        assert!(sections.iter().any(|section| {
            section["path"]
                .as_str()
                .is_some_and(|path| path.ends_with(".renderGeometry.positions"))
        }));
        assert!(
            bytes.len() > ASSET_BINARY_HEADER_LEN + manifest_len,
            "binary envelope should contain section data"
        );
    }

    #[test]
    fn landblock_summary_binary_lookup_moves_terrain_arrays_into_sections() {
        let adapter = HostBoundaryAdapter::new(false);
        let bytes = tauri::async_runtime::block_on(adapter.asset_lookup_binary_batch(vec![
            AssetLookupRequestDto {
                request_id: "test-landblock-summary-binary".to_string(),
                asset_id: "landblock-summary/da55ffff".to_string(),
                priority: crate::contracts::AssetPriorityDto::Streaming,
            },
        ]))
        .expect("binary landblock-summary lookup should succeed");

        let (manifest, manifest_len) = decode_binary_manifest(&bytes);
        assert_eq!(
            manifest["responses"][0]["payload"]["kind"],
            "landblock-summary"
        );
        assert_eq!(
            manifest["responses"][0]["payload"]["prepared"]["terrainMesh"]["triangles"]
                .as_array()
                .expect("summary terrain triangles should be manifest placeholders")
                .len(),
            0
        );
        let sections = manifest["sections"]
            .as_array()
            .expect("binary manifest should expose sections");
        assert!(
            sections
                .iter()
                .any(|section| section["path"]
                    == "responses.0.payload.prepared.terrainMesh.vertices")
        );
        assert!(
            bytes.len() > ASSET_BINARY_HEADER_LEN + manifest_len,
            "binary envelope should contain summary section data"
        );
    }

    #[test]
    fn gfx_obj_binary_lookup_moves_render_geometry_into_sections() {
        let adapter = HostBoundaryAdapter::new(false);
        let bytes = tauri::async_runtime::block_on(adapter.asset_lookup_binary_batch(vec![
            AssetLookupRequestDto {
                request_id: "test-gfx-obj-binary".to_string(),
                asset_id: "gfx-obj/01000001".to_string(),
                priority: crate::contracts::AssetPriorityDto::Streaming,
            },
        ]))
        .expect("binary gfx-obj lookup should succeed");

        let (manifest, manifest_len) = decode_binary_manifest(&bytes);
        assert_eq!(manifest["responses"][0]["payload"]["kind"], "gfx-obj");
        assert_eq!(
            manifest["responses"][0]["payload"]["vertexArray"]["vertices"]
                .as_array()
                .expect("binary gfx-obj should not carry source vertices")
                .len(),
            0
        );
        assert_eq!(
            manifest["responses"][0]["payload"]["renderGeometry"]["positions"]
                .as_array()
                .expect("render positions should be manifest placeholders")
                .len(),
            0
        );
        let sections = manifest["sections"]
            .as_array()
            .expect("binary manifest should expose sections");
        assert!(
            sections
                .iter()
                .any(|section| section["path"] == "responses.0.payload.renderGeometry.positions")
        );
        assert!(
            bytes.len() > ASSET_BINARY_HEADER_LEN + manifest_len,
            "binary envelope should contain gfx section data"
        );
    }

    #[test]
    fn render_surface_binary_payload_moves_source_bytes_into_u8_section() {
        let render_surface = RenderSurface {
            id: 0x0600_0001,
            unknown: 0,
            width: 1,
            height: 1,
            format: PixelFormatId::A8R8G8B8,
            format_raw: PixelFormatId::A8R8G8B8.raw(),
            source_data: vec![0x33, 0x22, 0x11, 0xff],
            default_palette_id: None,
        };
        let mut writer = BinaryAssetSectionWriter::default();
        let payload = serialize_render_surface_binary_payload(
            &render_surface,
            "responses.0.payload",
            &mut writer,
        );
        let bytes = serialize_asset_binary_batch_response(
            vec![AssetLookupResponseDto {
                request_id: "test-render-surface-binary".to_string(),
                asset_id: "render-surface/06000001".to_string(),
                payload_kind: AssetPayloadKindDto::Json,
                payload,
            }],
            writer,
        )
        .expect("binary render-surface payload should serialize");

        let (manifest, manifest_len) = decode_binary_manifest(&bytes);
        assert_eq!(
            manifest["responses"][0]["payload"]["sourceBytes"]
                .as_array()
                .expect("source bytes should be a manifest placeholder")
                .len(),
            0
        );
        let sections = manifest["sections"]
            .as_array()
            .expect("binary manifest should expose sections");
        assert!(sections.iter().any(|section| {
            section["path"] == "responses.0.payload.sourceBytes"
                && section["scalarType"] == "u8"
                && section["byteLength"] == 4
        }));
        assert!(
            bytes.len() > ASSET_BINARY_HEADER_LEN + manifest_len,
            "binary envelope should contain render-surface source bytes"
        );
    }

    fn decode_binary_manifest(bytes: &[u8]) -> (serde_json::Value, usize) {
        assert_eq!(&bytes[0..4], ASSET_BINARY_MAGIC);
        assert_eq!(u32::from_le_bytes(bytes[4..8].try_into().unwrap()), 1);
        let manifest_len = u32::from_le_bytes(bytes[8..12].try_into().unwrap()) as usize;
        assert_eq!(
            u32::from_le_bytes(bytes[12..16].try_into().unwrap()) as usize,
            bytes.len()
        );
        assert!((ASSET_BINARY_HEADER_LEN + manifest_len).is_multiple_of(4));
        let manifest: serde_json::Value = serde_json::from_slice(
            &bytes[ASSET_BINARY_HEADER_LEN..ASSET_BINARY_HEADER_LEN + manifest_len],
        )
        .expect("binary manifest should be JSON");
        (manifest, manifest_len)
    }

    #[test]
    fn landblock_summary_lookup_returns_light_payload_without_full_pack_work() {
        let runtime = HostRuntimeService::new(false);
        let asset = runtime.asset_lookup_blocking(AssetLookupRequestDto {
            request_id: "test-landblock-summary".to_string(),
            asset_id: "landblock-summary/da55ffff".to_string(),
            priority: crate::contracts::AssetPriorityDto::Streaming,
        });

        assert_eq!(asset.request_id, "test-landblock-summary");
        assert_eq!(asset.asset_id, "landblock-summary/da55ffff");
        assert_eq!(asset.payload["kind"], "landblock-summary");
        assert_eq!(asset.payload["residencyKind"], "landblock");
        assert_eq!(asset.payload["landblockId"], 0xda55ffffu32);
        assert_eq!(asset.payload["landblockInfoId"], 0xda55fffeu32);
        assert!(
            !asset.payload["prepared"]["terrainMesh"]["triangles"]
                .as_array()
                .expect("summary should expose Rust-prepared terrain triangles")
                .is_empty()
        );
        assert!(asset.payload["prepared"]["staticMeshes"].is_null());
        assert!(
            asset.payload["sourceFacts"]["buildings"]
                .as_array()
                .expect("summary should expose authored building references")
                .iter()
                .any(|building| building["portals"].as_array().is_some())
        );
        assert!(
            asset.payload["dependencies"]["portalDatIds"].is_null(),
            "summary should not enumerate interior dependencies"
        );
    }

    #[test]
    fn gfx_obj_lookup_returns_first_class_payload() {
        let runtime = HostRuntimeService::new(false);
        let asset = runtime.asset_lookup_blocking(AssetLookupRequestDto {
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
        let asset = runtime.asset_lookup_blocking(AssetLookupRequestDto {
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
        let asset = runtime.asset_lookup_blocking(AssetLookupRequestDto {
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
        assert!(asset.payload["placementSets"].as_array().is_some());
    }

    #[test]
    fn camera_hints_are_accepted_without_runtime_residency() {
        let runtime = HostRuntimeService::new(false);
        let position = Vec3Dto {
            x: 96.0,
            y: 96.0,
            z: 24.0,
        };
        let direction = normalize_vec3(Vec3Dto {
            x: 1.0,
            y: 0.0,
            z: 0.0,
        });

        let ack = runtime.submit_camera_hint(CameraHintDto {
            source: "world-display".to_string(),
            position: position.clone(),
            forward: direction.clone(),
            viewport_normalized_x: 0.75,
            viewport_normalized_y: 0.5,
            destination_label: Some("33.50S, 72.80E, 0.0Z".to_string()),
        });
        assert!(ack.accepted);
        assert_eq!(ack.sequence, 1);
    }
}
