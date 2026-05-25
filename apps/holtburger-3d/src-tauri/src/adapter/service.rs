use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use crate::adapter::binary::*;
use crate::adapter::ids::*;
use crate::adapter::json::*;
use holtburger_content::{
    ContentDecodeCache, ContentRepository, EnvCellAsset, LandblockOutdoorAsset,
    LandblockTopologyAsset, SoulEmoteCatalog, normalize_landblock_id,
};
use holtburger_core::{
    ContentAsset, ContentAssetRequest, ContentAssetRuntime, ContentAssetService,
};
#[cfg(test)]
use holtburger_dat::file_type::REGION_DESC_FILE_ID;
use holtburger_dat::file_type::{MotionKinematics, SkillTable, SpellTable, XpTable};
use holtburger_world::WorldBootstrap;

#[cfg(test)]
use crate::contracts::Vec3Dto;
use crate::contracts::{
    AssetLookupRequestDto, AssetLookupResponseDto, AssetPayloadKindDto, CameraHintAckDto,
    CameraHintDto, DebugConfigDto,
};

pub const ASSET_BINARY_MAGIC: &[u8; 4] = b"HBAB";
pub const ASSET_BINARY_VERSION: u32 = 1;
pub const ASSET_BINARY_HEADER_LEN: usize = 16;

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

    pub async fn asset_lookup(
        &self,
        request: AssetLookupRequestDto,
    ) -> anyhow::Result<AssetLookupResponseDto> {
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
        self.adapter
            .asset_lookup_blocking(request)
            .expect("test asset lookup should succeed")
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

    pub async fn asset_lookup(
        &self,
        request: AssetLookupRequestDto,
    ) -> anyhow::Result<AssetLookupResponseDto> {
        if let Some(content_request) = content_asset_request_from_asset_id(&request.asset_id) {
            let asset = self
                .content_asset_runtime
                .load(content_request.clone())
                .await;
            return self.build_content_asset_lookup_response(request, content_request, asset);
        }

        Ok(self.build_app_local_asset_lookup_response(request))
    }

    pub async fn asset_lookup_binary_batch(
        &self,
        requests: Vec<AssetLookupRequestDto>,
    ) -> anyhow::Result<Vec<u8>> {
        let loaded_assets = futures::future::join_all(requests.into_iter().map(|request| {
            let content_asset_runtime = self.content_asset_runtime.clone();
            async move {
                let Some(content_request) = content_asset_request_from_asset_id(&request.asset_id)
                else {
                    anyhow::bail!(
                        "binary asset lookup only supports content assets, got {}",
                        request.asset_id
                    );
                };

                let asset = content_asset_runtime.load(content_request.clone()).await;
                anyhow::Ok((request, content_request, asset))
            }
        }))
        .await;

        let mut writer = BinaryAssetSectionWriter::default();
        let mut responses = Vec::with_capacity(loaded_assets.len());
        for loaded_asset in loaded_assets {
            let (request, content_request, asset) = loaded_asset?;
            let response_index = responses.len();
            let path_prefix = format!("responses.{response_index}.payload");
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
    fn asset_lookup_blocking(
        &self,
        request: AssetLookupRequestDto,
    ) -> anyhow::Result<AssetLookupResponseDto> {
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

        Ok(self.build_app_local_asset_lookup_response(request))
    }

    fn build_content_asset_lookup_response(
        &self,
        request: AssetLookupRequestDto,
        content_request: ContentAssetRequest,
        asset: anyhow::Result<ContentAsset>,
    ) -> anyhow::Result<AssetLookupResponseDto> {
        Ok(match content_request {
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
                Err(error) => anyhow::bail!(
                    "failed to load landblock outdoor 0x{:08X} for {}: {error:#}",
                    normalize_landblock_id(landblock_id),
                    request.asset_id
                ),
            },
            ContentAssetRequest::LandblockTopology(landblock_id) => match asset {
                Ok(ContentAsset::LandblockTopology(topology)) => {
                    self.build_landblock_topology_lookup_response(request, *topology)
                }
                Ok(_) => {
                    unreachable!("content asset runtime returned mismatched landblock topology")
                }
                Err(error) => anyhow::bail!(
                    "failed to load landblock topology 0x{:08X} for {}: {error:#}",
                    normalize_landblock_id(landblock_id),
                    request.asset_id
                ),
            },
            ContentAssetRequest::EnvCell(env_cell_id) => match asset {
                Ok(ContentAsset::EnvCell(env_cell)) => {
                    self.build_env_cell_lookup_response(request, env_cell_id, *env_cell)?
                }
                Ok(_) => unreachable!("content asset runtime returned mismatched env-cell"),
                Err(error) => anyhow::bail!(
                    "failed to load env-cell 0x{env_cell_id:08X} for {}: {error:#}",
                    request.asset_id
                ),
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
                self.build_material_recipe_lookup_response(request, surface_id, asset)?
            }
            ContentAssetRequest::SetupAppearance(setup_model_id) => {
                self.build_setup_appearance_lookup_response(request, setup_model_id, asset)
            }
            ContentAssetRequest::RenderTexture(render_texture_id) => {
                self.build_render_texture_lookup_response(request, render_texture_id, asset)?
            }
            ContentAssetRequest::RenderSurface(render_surface_id) => {
                self.build_render_surface_lookup_response(request, render_surface_id, asset)?
            }
            ContentAssetRequest::Palette(palette_id) => {
                self.build_palette_lookup_response(request, palette_id, asset)
            }
        })
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

    fn build_env_cell_lookup_response(
        &self,
        request: AssetLookupRequestDto,
        env_cell_id: u32,
        env_cell: EnvCellAsset,
    ) -> anyhow::Result<AssetLookupResponseDto> {
        if env_cell.prepared_cell.env_cell_id != env_cell_id {
            anyhow::bail!(
                "EnvCell assembler returned 0x{:08X} for request 0x{env_cell_id:08X}",
                env_cell.prepared_cell.env_cell_id
            );
        }
        Ok(AssetLookupResponseDto {
            request_id: request.request_id,
            asset_id: request.asset_id,
            payload_kind: AssetPayloadKindDto::Json,
            payload: serialize_env_cell_payload(&env_cell),
        })
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

    pub fn build_gfx_obj_lookup_response(
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
                    "gfxObjAssetIds": []
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
    ) -> anyhow::Result<AssetLookupResponseDto> {
        let payload = match asset {
            Ok(ContentAsset::MaterialRecipe(recipe)) => serialize_material_recipe_payload(&recipe),
            Ok(_) => unreachable!("content asset runtime returned mismatched material recipe"),
            Err(error) => {
                log_material_graph_failure("material-recipe", surface_id, &error);
                anyhow::bail!(
                    "failed to load material recipe 0x{surface_id:08X} for {}: {error:#}",
                    request.asset_id
                );
            }
        };

        Ok(AssetLookupResponseDto {
            request_id: request.request_id,
            asset_id: request.asset_id,
            payload_kind: AssetPayloadKindDto::Json,
            payload,
        })
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
    ) -> anyhow::Result<AssetLookupResponseDto> {
        let payload = match asset {
            Ok(ContentAsset::RenderTexture(render_texture)) => {
                serialize_render_texture_payload(&render_texture)
            }
            Ok(_) => unreachable!("content asset runtime returned mismatched render texture"),
            Err(error) => {
                log_material_graph_failure("render-texture", render_texture_id, &error);
                anyhow::bail!(
                    "failed to load render texture 0x{render_texture_id:08X} for {}: {error:#}",
                    request.asset_id
                );
            }
        };

        Ok(AssetLookupResponseDto {
            request_id: request.request_id,
            asset_id: request.asset_id,
            payload_kind: AssetPayloadKindDto::Json,
            payload,
        })
    }

    pub fn build_render_surface_lookup_response(
        &self,
        request: AssetLookupRequestDto,
        render_surface_id: u32,
        asset: anyhow::Result<ContentAsset>,
    ) -> anyhow::Result<AssetLookupResponseDto> {
        let payload = match asset {
            Ok(ContentAsset::RenderSurface(render_surface)) => {
                serialize_render_surface_payload(&render_surface)
            }
            Ok(_) => unreachable!("content asset runtime returned mismatched render surface"),
            Err(error) => {
                log_material_graph_failure("render-surface", render_surface_id, &error);
                anyhow::bail!(
                    "failed to load render surface 0x{render_surface_id:08X} for {}: {error:#}",
                    request.asset_id
                );
            }
        };

        Ok(AssetLookupResponseDto {
            request_id: request.request_id,
            asset_id: request.asset_id,
            payload_kind: AssetPayloadKindDto::Json,
            payload,
        })
    }

    pub fn build_palette_lookup_response(
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

pub fn asset_cache_error_code(error: &anyhow::Error) -> &'static str {
    if error.to_string().starts_with("Could not read ") {
        "asset-read-failed"
    } else {
        "asset-decode-failed"
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
    use holtburger_dat::file_type::{Palette, PixelFormatId, RenderSurface};

    #[test]
    fn asset_lookup_remains_available_without_browser_runtime_residency() {
        let runtime = HostRuntimeService::new(false);
        let asset = runtime.asset_lookup_blocking(AssetLookupRequestDto {
            request_id: "test-request".to_string(),
            asset_id: "landblock/0102ffff/outdoor".to_string(),
            priority: crate::contracts::AssetPriorityDto::Bootstrap,
        });

        assert_eq!(asset.request_id, "test-request");
        assert_eq!(asset.asset_id, "landblock/0102ffff/outdoor");
        assert!(matches!(asset.payload_kind, AssetPayloadKindDto::Json));
        assert_eq!(asset.payload["kind"], "landblock-outdoor");
        assert_eq!(asset.payload["residencyKind"], "outdoor-landblock");
        assert_eq!(asset.payload["landblockId"], 0x0102ffff);
    }

    #[test]
    fn landblock_outdoor_lookup_returns_prepared_render_payload() {
        let runtime = HostRuntimeService::new(false);
        let asset = runtime.asset_lookup_blocking(AssetLookupRequestDto {
            request_id: "test-landblock-outdoor".to_string(),
            asset_id: "landblock/da55012e/outdoor".to_string(),
            priority: crate::contracts::AssetPriorityDto::Bootstrap,
        });

        assert_eq!(asset.request_id, "test-landblock-outdoor");
        assert_eq!(asset.asset_id, "landblock/da55012e/outdoor");
        assert_eq!(asset.payload["kind"], "landblock-outdoor");
        assert_eq!(asset.payload["residencyKind"], "outdoor-landblock");
        assert_eq!(asset.payload["landblockId"], 0xda55ffffu32);
        assert_eq!(asset.payload["classification"], "outdoor");
        assert!(
            !asset.payload["terrain"]["triangles"]
                .as_array()
                .expect("outdoor route should expose Rust-prepared terrain triangles")
                .is_empty()
        );
        assert!(
            asset.payload["statics"]
                .as_array()
                .expect("outdoor route should expose static members")
                .iter()
                .all(|member| member["sourceAssetId"]
                    .as_str()
                    .is_some_and(|asset_id| asset_id.starts_with("setup-model/")
                        || asset_id.starts_with("gfx-obj/")))
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
                request_id: "test-landblock-outdoor-binary".to_string(),
                asset_id: "landblock/da55ffff/outdoor".to_string(),
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
                .any(|section| section["path"] == "responses.0.payload.terrain.triangles")
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
            manifest["responses"][0]["payload"]["terrain"]["triangles"]
                .as_array()
                .expect("terrain binary payload should leave JSON triangle placeholder")
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
            asset_id: "landblock/da55ffff/outdoor".to_string(),
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
    fn render_texture_lookup_exposes_only_available_surface_candidates() {
        let runtime = HostRuntimeService::new(false);
        let asset = runtime.asset_lookup_blocking(AssetLookupRequestDto {
            request_id: "test-render-texture-candidates".to_string(),
            asset_id: "render-texture/05002862".to_string(),
            priority: crate::contracts::AssetPriorityDto::Streaming,
        });

        assert_eq!(asset.payload["kind"], "render-texture");
        assert_eq!(asset.payload["renderTextureId"], 0x05002862u32);
        assert_eq!(
            asset.payload["renderSurfaceIds"]
                .as_array()
                .expect("render texture route should expose render surface candidates"),
            &[serde_json::json!(0x060041c0u32)]
        );
        assert_eq!(
            asset.payload["dependencies"]["renderSurfaceAssetIds"]
                .as_array()
                .expect("render texture route should expose dependency ids"),
            &[serde_json::json!("render-surface/060041c0")]
        );
    }

    #[test]
    fn env_cell_lookup_allows_real_renderless_cell_structures() {
        let runtime = HostRuntimeService::new(false);
        let asset = runtime.asset_lookup_blocking(AssetLookupRequestDto {
            request_id: "test-renderless-env-cell".to_string(),
            asset_id: "env-cell/da560109".to_string(),
            priority: crate::contracts::AssetPriorityDto::Streaming,
        });

        assert_eq!(asset.payload["kind"], "env-cell");
        assert_eq!(asset.payload["envCellId"], 0xda560109u32);
        assert_eq!(asset.payload["renderGeometry"]["vertexCount"], 0);
        assert_eq!(asset.payload["renderGeometry"]["triangleCount"], 0);
    }

    #[test]
    fn landblock_outdoor_lookup_reports_cd57_contract_shape() {
        let runtime = HostRuntimeService::new(false);
        let asset = runtime.asset_lookup_blocking(AssetLookupRequestDto {
            request_id: "test-cd57-outdoor".to_string(),
            asset_id: "landblock/cd57ffff/outdoor".to_string(),
            priority: crate::contracts::AssetPriorityDto::Streaming,
        });

        assert_eq!(asset.payload["kind"], "landblock-outdoor");
        assert_eq!(asset.payload["landblockId"], 0xcd57ffffu32);
        assert!(asset.payload["terrain"].is_object());
    }

    #[test]
    fn landblock_outdoor_binary_lookup_reports_cd57_contract_shape() {
        let adapter = HostBoundaryAdapter::new(false);
        let bytes = tauri::async_runtime::block_on(adapter.asset_lookup_binary_batch(vec![
            AssetLookupRequestDto {
                request_id: "test-cd57-outdoor-binary".to_string(),
                asset_id: "landblock/cd57ffff/outdoor".to_string(),
                priority: crate::contracts::AssetPriorityDto::Streaming,
            },
        ]))
        .expect("binary cd57 outdoor lookup should succeed");

        let (manifest, _) = decode_binary_manifest(&bytes);
        assert_eq!(
            manifest["responses"][0]["payload"]["kind"],
            "landblock-outdoor"
        );
        assert_eq!(
            manifest["responses"][0]["payload"]["landblockId"],
            0xcd57ffffu32
        );
        assert!(manifest["responses"][0]["payload"]["terrain"].is_object());
    }

    #[test]
    fn landblock_outdoor_binary_lookup_moves_bulk_arrays_into_sections() {
        let adapter = HostBoundaryAdapter::new(false);
        let bytes = tauri::async_runtime::block_on(adapter.asset_lookup_binary_batch(vec![
            AssetLookupRequestDto {
                request_id: "test-landblock-outdoor-binary".to_string(),
                asset_id: "landblock/da55012e/outdoor".to_string(),
                priority: crate::contracts::AssetPriorityDto::Bootstrap,
            },
        ]))
        .expect("binary landblock outdoor lookup should succeed");

        let (manifest, manifest_len) = decode_binary_manifest(&bytes);

        assert_eq!(manifest["transport"], "holtburger-asset-binary");
        assert_eq!(
            manifest["responses"][0]["payload"]["terrain"]["vertices"]
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
                .any(|section| section["path"] == "responses.0.payload.terrain.vertices")
        );
        assert!(
            bytes.len() > ASSET_BINARY_HEADER_LEN + manifest_len,
            "binary envelope should contain section data"
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

    #[test]
    fn palette_binary_payload_moves_colors_into_u32_section() {
        let palette = Palette {
            id: 0x0400_0001,
            colors_argb: vec![0xff11_2233, 0x8044_5566],
        };
        let mut writer = BinaryAssetSectionWriter::default();
        let payload =
            serialize_palette_binary_payload(&palette, "responses.0.payload", &mut writer);
        let bytes = serialize_asset_binary_batch_response(
            vec![AssetLookupResponseDto {
                request_id: "test-palette-binary".to_string(),
                asset_id: "palette/04000001".to_string(),
                payload_kind: AssetPayloadKindDto::Json,
                payload,
            }],
            writer,
        )
        .expect("binary palette payload should serialize");

        let (manifest, manifest_len) = decode_binary_manifest(&bytes);
        assert_eq!(
            manifest["responses"][0]["payload"]["colorsArgb"]
                .as_array()
                .expect("palette colors should be a manifest placeholder")
                .len(),
            0
        );
        let sections = manifest["sections"]
            .as_array()
            .expect("binary manifest should expose sections");
        assert!(sections.iter().any(|section| {
            section["path"] == "responses.0.payload.colorsArgb"
                && section["scalarType"] == "u32"
                && section["byteLength"] == 8
        }));
        assert!(
            bytes.len() > ASSET_BINARY_HEADER_LEN + manifest_len,
            "binary envelope should contain palette color data"
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
