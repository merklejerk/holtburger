use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use holtburger_common::math::{Quaternion, Vector3};
use holtburger_content::{
    ContentDecodeCache, ContentRepository, LandblockClassification, LandblockPack,
    LandblockPackSourceDiagnostics, LandblockSummary, LandblockSummaryBuilding,
    LandblockSummaryBuildingPortal, PreparedAabb, PreparedBvh, PreparedBvhNode,
    PreparedInteriorCell, PreparedPolygonSetInvalidPolygon, PreparedPolygonSetRenderGeometry,
    PreparedPolygonSetRenderTriangle, PreparedPortalAperture, PreparedPortalAperturePlane,
    PreparedPortalAperturePlaneSource, PreparedSpatialItem, PreparedSpatialItemKind,
    PreparedSpatialItemMetadata, PreparedStaticInstance, PreparedStaticInstanceKind,
    PreparedStaticMesh, PreparedTerrainMesh, PreparedTerrainTriangle, PreparedVec3,
    SoulEmoteCatalog, SourceLoadError, SourceOmissionDiagnostic, SourceRecordDiagnostic,
    SourceRecordStatus, StaticOutdoorFrame, StaticOutdoorInstance, StaticOutdoorScene,
    StaticRenderableSourceFamily, build_gfx_obj_render_geometry, normalize_landblock_id,
};
use holtburger_core::{
    ContentAsset, ContentAssetRequest, ContentAssetRuntime, ContentAssetService,
};
use holtburger_dat::EOR_CELL_NAMESPACE;
use holtburger_dat::file_type::{GfxObj, SetupModel};
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
            ContentAssetRequest::GfxObj(gfx_obj_id) => {
                self.build_gfx_obj_lookup_response(request, gfx_obj_id, asset)
            }
            ContentAssetRequest::SetupModel(setup_model_id) => {
                self.build_setup_model_lookup_response(request, setup_model_id, asset)
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

fn content_asset_request_from_asset_id(asset_id: &str) -> Option<ContentAssetRequest> {
    parse_landblock_pack_asset_id(asset_id)
        .map(ContentAssetRequest::LandblockPack)
        .or_else(|| {
            parse_landblock_summary_asset_id(asset_id).map(ContentAssetRequest::LandblockSummary)
        })
        .or_else(|| parse_gfx_obj_asset_id(asset_id).map(ContentAssetRequest::GfxObj))
        .or_else(|| parse_setup_model_asset_id(asset_id).map(ContentAssetRequest::SetupModel))
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
        "provenance": {
            "source": "repo-local-hba",
            "sourceAssetKind": "setup-model",
            "errorCode": null,
            "detail": null
        }
    })
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
