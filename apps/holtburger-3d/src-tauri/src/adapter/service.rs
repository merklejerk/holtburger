use std::path::PathBuf;
use std::sync::Arc;

use crate::adapter::binary::*;
use crate::adapter::ids::*;
use crate::adapter::json::*;
use crate::adapter::prepared_texture::{
    PreparedTexturePayload, PreparedTextureRequest, parse_prepared_texture_asset_id,
    prepare_texture,
};
use holtburger_content::{ContentDecodeCache, ContentRepository, MaterialAppearanceInput};
use holtburger_core::{
    ContentAsset, ContentAssetRequest, ContentAssetRuntime, ContentAssetService,
    SetupAppearanceRequest,
};
use holtburger_dat::file_type::{AnimationPartChange, ObjDesc, SubPalette, TextureMapChange};
use holtburger_dat::{EOR_PORTAL_NAMESPACE, ResourceKey};

use crate::contracts::{
    AssetLookupRequestDto, AssetLookupResponseDto, AssetPayloadKindDto, DebugConfigDto,
    RuntimeAppearanceObjDescDto, RuntimeAppearanceRequestDto,
};
use tokio::sync::Semaphore;

pub const ASSET_BINARY_MAGIC: &[u8; 4] = b"HBAB";
pub const ASSET_BINARY_VERSION: u32 = 1;
pub const ASSET_BINARY_HEADER_LEN: usize = 16;
const DEFAULT_PREPARED_TEXTURE_WORKERS: usize = 3;

pub struct HostBoundaryAdapter {
    content: Arc<ContentRepository>,
    content_asset_runtime: ContentAssetRuntime,
    prepared_texture_worker_slots: Arc<Semaphore>,
    verbose: bool,
}

#[derive(Clone)]
pub struct HostRuntimeService {
    adapter: Arc<HostBoundaryAdapter>,
}

impl HostRuntimeService {
    pub fn new(verbose: bool) -> Self {
        let adapter = Arc::new(HostBoundaryAdapter::new(verbose));
        Self { adapter }
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

    pub async fn resolve_runtime_appearance(
        &self,
        request: RuntimeAppearanceRequestDto,
    ) -> anyhow::Result<serde_json::Value> {
        self.adapter.resolve_runtime_appearance(request).await
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

fn convert_runtime_appearance_obj_desc(dto: RuntimeAppearanceObjDescDto) -> ObjDesc {
    ObjDesc {
        palette_id: dto.palette_id,
        sub_palettes: dto
            .sub_palettes
            .into_iter()
            .map(|sub_palette| SubPalette {
                sub_id: sub_palette.sub_id,
                offset: sub_palette.offset,
                num_colors: sub_palette.num_colors,
            })
            .collect(),
        texture_changes: dto
            .texture_changes
            .into_iter()
            .map(|change| TextureMapChange {
                part_index: change.part_index,
                old_texture: change.old_texture,
                new_texture: change.new_texture,
            })
            .collect(),
        anim_part_changes: dto
            .anim_part_changes
            .into_iter()
            .map(|change| AnimationPartChange {
                part_index: change.part_index,
                part_id: change.part_id,
            })
            .collect(),
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
            content,
            content_asset_runtime,
            prepared_texture_worker_slots: Arc::new(Semaphore::new(
                DEFAULT_PREPARED_TEXTURE_WORKERS,
            )),
            verbose,
        }
    }

    pub async fn asset_lookup(
        &self,
        request: AssetLookupRequestDto,
    ) -> anyhow::Result<AssetLookupResponseDto> {
        if let Some(content_request) = content_asset_request_from_asset_id(&request.asset_id) {
            if let Some(message) =
                binary_asset_lookup_required_message(&request.asset_id, &content_request)
            {
                anyhow::bail!(message);
            }
            let asset = self
                .content_asset_runtime
                .load(content_request.clone())
                .await;
            return self.build_content_asset_lookup_response(request, content_request, asset);
        }

        anyhow::bail!(
            "unsupported app-local asset id {}; no debug manifest fallback is registered",
            request.asset_id
        )
    }

    pub async fn asset_lookup_binary_batch(
        &self,
        requests: Vec<AssetLookupRequestDto>,
    ) -> anyhow::Result<Vec<u8>> {
        let loaded_assets = futures::future::join_all(requests.into_iter().map(|request| {
            let content_asset_runtime = self.content_asset_runtime.clone();
            let prepared_texture_worker_slots = Arc::clone(&self.prepared_texture_worker_slots);
            async move {
                if let Some(prepared_texture_request) =
                    parse_prepared_texture_asset_id(&request.asset_id)
                {
                    let render_surface_id = prepared_texture_request.render_surface_id;
                    let asset_id = request.asset_id.clone();
                    let asset = content_asset_runtime
                        .load(ContentAssetRequest::RenderSurface(render_surface_id))
                        .await;
                    let prepared_texture = match asset {
                        Ok(ContentAsset::RenderSurface(render_surface)) => {
                            prepare_texture_blocking(
                                prepared_texture_worker_slots,
                                prepared_texture_request,
                                *render_surface,
                            )
                            .await
                        }
                        Ok(_) => unreachable!("content asset runtime returned mismatched render surface"),
                        Err(error) => anyhow::bail!(
                            "failed to load render surface 0x{render_surface_id:08X} for {asset_id}: {error:#}"
                        ),
                    };
                    return anyhow::Ok((
                        request,
                        LoadedBinaryAsset::PreparedTexture(prepared_texture),
                    ));
                }

                let Some(content_request) = content_asset_request_from_asset_id(&request.asset_id)
                else {
                    anyhow::bail!(
                        "binary asset lookup only supports content assets, got {}",
                        request.asset_id
                    );
                };

                let asset = content_asset_runtime.load(content_request.clone()).await;
                anyhow::Ok((request, LoadedBinaryAsset::Content(content_request, asset)))
            }
        }))
        .await;

        let mut writer = BinaryAssetSectionWriter::default();
        let mut responses = Vec::with_capacity(loaded_assets.len());
        for loaded_asset in loaded_assets {
            let (request, asset) = loaded_asset?;
            let response_index = responses.len();
            let path_prefix = format!("responses.{response_index}.payload");
            responses.push(match asset {
                LoadedBinaryAsset::Content(content_request, asset) => {
                    serialize_content_asset_binary_response(
                        request,
                        content_request,
                        asset,
                        &path_prefix,
                        &mut writer,
                    )?
                }
                LoadedBinaryAsset::PreparedTexture(prepared_texture) => {
                    serialize_prepared_texture_binary_response(
                        request,
                        prepared_texture?,
                        &path_prefix,
                        &mut writer,
                    )?
                }
            });
        }
        serialize_asset_binary_batch_response(responses, writer)
    }

    pub async fn resolve_runtime_appearance(
        &self,
        request: RuntimeAppearanceRequestDto,
    ) -> anyhow::Result<serde_json::Value> {
        let setup_request = SetupAppearanceRequest {
            setup_model_id: request.setup_model_id,
            appearance: MaterialAppearanceInput {
                obj_desc: request.obj_desc.map(convert_runtime_appearance_obj_desc),
            },
        };
        let asset = self
            .content_asset_runtime
            .load(ContentAssetRequest::SetupAppearance(setup_request))
            .await?;
        let ContentAsset::SetupAppearance(appearance) = asset else {
            unreachable!("content asset runtime returned mismatched setup appearance");
        };
        Ok(serialize_setup_appearance_payload(&appearance))
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
            if let Some(message) =
                binary_asset_lookup_required_message(&request.asset_id, &content_request)
            {
                anyhow::bail!(message);
            }
            let asset = self
                .content_asset_runtime
                .load_blocking(content_request.clone());
            return self.build_content_asset_lookup_response(request, content_request, asset);
        }

        anyhow::bail!(
            "unsupported app-local asset id {}; no debug manifest fallback is registered",
            request.asset_id
        )
    }

    fn build_content_asset_lookup_response(
        &self,
        request: AssetLookupRequestDto,
        content_request: ContentAssetRequest,
        asset: anyhow::Result<ContentAsset>,
    ) -> anyhow::Result<AssetLookupResponseDto> {
        if let Some(message) =
            binary_asset_lookup_required_message(&request.asset_id, &content_request)
        {
            anyhow::bail!(message);
        }

        Ok(match content_request {
            ContentAssetRequest::TerrainMaterial(region_number) => {
                self.build_terrain_material_lookup_response(request, region_number, asset)
            }
            ContentAssetRequest::RegionRenderProfile(region_number) => {
                self.build_region_render_profile_lookup_response(request, region_number, asset)
            }
            ContentAssetRequest::SetupModel(setup_model_id) => {
                self.build_setup_model_lookup_response(request, setup_model_id, asset)
            }
            ContentAssetRequest::MaterialRecipe(surface_id) => {
                self.build_material_recipe_lookup_response(request, surface_id, asset)?
            }
            ContentAssetRequest::SetupAppearance(setup_appearance_request) => self
                .build_setup_appearance_lookup_response(
                    request,
                    setup_appearance_request.setup_model_id,
                    asset,
                ),
            ContentAssetRequest::SurfaceTexture(surface_texture_id) => {
                self.build_surface_texture_lookup_response(request, surface_texture_id, asset)?
            }
            ContentAssetRequest::LandblockOutdoor(_)
            | ContentAssetRequest::LandblockTopology(_)
            | ContentAssetRequest::EnvCell(_)
            | ContentAssetRequest::GfxObj(_)
            | ContentAssetRequest::RenderSurface(_)
            | ContentAssetRequest::Palette(_) => {
                unreachable!("binary-routed content request passed direct JSON rejection")
            }
        })
    }
}

enum LoadedBinaryAsset {
    Content(ContentAssetRequest, anyhow::Result<ContentAsset>),
    PreparedTexture(anyhow::Result<PreparedTexturePayload>),
}

async fn prepare_texture_blocking(
    worker_slots: Arc<Semaphore>,
    request: PreparedTextureRequest,
    render_surface: holtburger_dat::file_type::RenderSurface,
) -> anyhow::Result<PreparedTexturePayload> {
    let _permit = worker_slots
        .acquire_owned()
        .await
        .map_err(|error| anyhow::anyhow!("prepared texture worker semaphore closed: {error}"))?;
    tokio::task::spawn_blocking(move || prepare_texture(request, &render_surface))
        .await
        .map_err(|error| anyhow::anyhow!("prepared texture worker failed to join: {error}"))?
}

impl HostBoundaryAdapter {
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

    fn build_region_render_profile_lookup_response(
        &self,
        request: AssetLookupRequestDto,
        region_number: u32,
        asset: anyhow::Result<ContentAsset>,
    ) -> AssetLookupResponseDto {
        let payload = match asset {
            Ok(ContentAsset::RegionRenderProfile(profile)) => {
                serialize_region_render_profile_payload(&profile)
            }
            Ok(_) => {
                unreachable!("content asset runtime returned mismatched region render profile")
            }
            Err(error) => failed_region_render_profile_payload(region_number, error),
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
            Ok(ContentAsset::MaterialRecipe(recipe)) => {
                serialize_material_recipe_payload(&recipe, |render_surface_id| {
                    self.render_surface_available(render_surface_id)
                })
            }
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

    fn build_surface_texture_lookup_response(
        &self,
        request: AssetLookupRequestDto,
        surface_texture_id: u32,
        asset: anyhow::Result<ContentAsset>,
    ) -> anyhow::Result<AssetLookupResponseDto> {
        let payload = match asset {
            Ok(ContentAsset::SurfaceTexture(surface_texture)) => {
                serialize_surface_texture_payload(&surface_texture, |render_surface_id| {
                    self.render_surface_available(render_surface_id)
                })
            }
            Ok(_) => unreachable!("content asset runtime returned mismatched surface texture"),
            Err(error) => {
                log_material_graph_failure("surface-texture", surface_texture_id, &error);
                anyhow::bail!(
                    "failed to load surface texture 0x{surface_texture_id:08X} for {}: {error:#}",
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

    fn render_surface_available(&self, render_surface_id: u32) -> bool {
        self.content
            .resource_metadata(ResourceKey::new(EOR_PORTAL_NAMESPACE, render_surface_id))
            .is_some()
    }
}

fn binary_asset_lookup_required_message(
    asset_id: &str,
    content_request: &ContentAssetRequest,
) -> Option<String> {
    match content_request {
        ContentAssetRequest::LandblockOutdoor(landblock_id) => Some(format!(
            "landblock outdoor 0x{:08X} for {asset_id} requires binary asset lookup",
            holtburger_content::normalize_landblock_id(*landblock_id)
        )),
        ContentAssetRequest::LandblockTopology(landblock_id) => Some(format!(
            "landblock topology 0x{:08X} for {asset_id} requires binary asset lookup",
            holtburger_content::normalize_landblock_id(*landblock_id)
        )),
        ContentAssetRequest::EnvCell(env_cell_id) => Some(format!(
            "env-cell 0x{env_cell_id:08X} for {asset_id} requires binary asset lookup"
        )),
        ContentAssetRequest::GfxObj(gfx_obj_id) => Some(format!(
            "gfx-obj 0x{gfx_obj_id:08X} for {asset_id} requires binary asset lookup"
        )),
        ContentAssetRequest::RenderSurface(render_surface_id) => Some(format!(
            "render-surface 0x{render_surface_id:08X} for {asset_id} requires binary asset lookup"
        )),
        ContentAssetRequest::Palette(palette_id) => Some(format!(
            "palette 0x{palette_id:08X} for {asset_id} requires binary asset lookup"
        )),
        ContentAssetRequest::TerrainMaterial(_)
        | ContentAssetRequest::RegionRenderProfile(_)
        | ContentAssetRequest::SetupModel(_)
        | ContentAssetRequest::MaterialRecipe(_)
        | ContentAssetRequest::SetupAppearance(_)
        | ContentAssetRequest::SurfaceTexture(_) => None,
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
mod tests {
    use super::*;
    use holtburger_dat::file_type::{Palette, PixelFormatId, RenderSurface};

    #[test]
    fn direct_json_lookup_rejects_binary_routed_assets() {
        let runtime = HostRuntimeService::new(false);
        let cases = [
            ("landblock/da55ffff/outdoor", "landblock outdoor"),
            ("landblock/da55ffff/topology", "landblock topology"),
            ("env-cell/da550100", "env-cell"),
            ("gfx-obj/01000001", "gfx-obj"),
            ("render-surface/060041c0", "render-surface"),
            ("palette/04000001", "palette"),
        ];

        for (asset_id, expected_label) in cases {
            let error = runtime
                .adapter
                .asset_lookup_blocking(AssetLookupRequestDto {
                    request_id: format!("test-direct-json-{asset_id}"),
                    asset_id: asset_id.to_string(),
                    priority: crate::contracts::AssetPriorityDto::Bootstrap,
                })
                .expect_err("binary-routed assets should reject direct JSON lookup");

            let message = error.to_string();
            assert!(
                message.contains(expected_label),
                "{asset_id} should mention {expected_label}: {message}"
            );
            assert!(
                message.contains("requires binary asset lookup"),
                "{asset_id} should explain the required transport: {message}"
            );
        }
    }

    #[test]
    fn unknown_app_local_asset_lookup_rejects_debug_manifest_fallback() {
        let runtime = HostRuntimeService::new(false);
        let error = runtime
            .adapter
            .asset_lookup_blocking(AssetLookupRequestDto {
                request_id: "test-unknown-app-local".to_string(),
                asset_id: "gfx/02000001".to_string(),
                priority: crate::contracts::AssetPriorityDto::Bootstrap,
            })
            .expect_err("app-local debug manifest fallback should be removed");

        assert!(error.to_string().contains("no debug manifest fallback"));
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
        assert_eq!(
            manifest["responses"][1]["payload"]["surfaces"][0]["slotId"],
            serde_json::json!(0),
            "env-cell surface slots must stay zero-based because CellStruct polygon PosSurface indexes the texture list"
        );
    }

    #[test]
    fn terrain_material_lookup_returns_region_table_payload() {
        let runtime = HostRuntimeService::new(false);
        let outdoor_bytes =
            tauri::async_runtime::block_on(runtime.asset_lookup_binary_batch(vec![
                AssetLookupRequestDto {
                    request_id: "test-landblock-terrain-region".to_string(),
                    asset_id: "landblock/da55ffff/outdoor".to_string(),
                    priority: crate::contracts::AssetPriorityDto::Bootstrap,
                },
            ]))
            .expect("binary outdoor lookup should expose region number");
        let (outdoor_manifest, _) = decode_binary_manifest(&outdoor_bytes);
        let region_number = outdoor_manifest["responses"][0]["payload"]["regionNumber"]
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
            !asset.payload["dependencies"]["surfaceTextureAssetIds"]
                .as_array()
                .expect("terrain material route should expose texture dependencies")
                .is_empty()
        );
    }

    #[test]
    fn region_render_profile_lookup_returns_region_detail_roles() {
        let runtime = HostRuntimeService::new(false);
        let asset = runtime.asset_lookup_blocking(AssetLookupRequestDto {
            request_id: "test-region-render-profile".to_string(),
            asset_id: "region-render-profile/1".to_string(),
            priority: crate::contracts::AssetPriorityDto::Bootstrap,
        });

        assert_eq!(asset.payload["kind"], "region-render-profile");
        assert_eq!(asset.payload["regionNumber"], 1);
        assert_eq!(
            asset.payload["detailRoles"]["landscape"]["role"],
            "landscape"
        );
        assert_eq!(
            asset.payload["detailRoles"]["landscape"]["sourceTerrainDescIndex"],
            0
        );
        assert!(
            asset.payload["dependencies"]["surfaceTextureAssetIds"]
                .as_array()
                .expect("region render profile should expose detail texture dependencies")
                .iter()
                .any(|asset_id| asset_id == "surface-texture/05001786")
        );
    }

    #[test]
    fn surface_texture_lookup_exposes_available_highest_detail_source_level() {
        let runtime = HostRuntimeService::new(false);
        let asset = runtime.asset_lookup_blocking(AssetLookupRequestDto {
            request_id: "test-surface-texture-candidates".to_string(),
            asset_id: "surface-texture/05002862".to_string(),
            priority: crate::contracts::AssetPriorityDto::Streaming,
        });

        assert_eq!(asset.payload["kind"], "surface-texture");
        assert_eq!(asset.payload["surfaceTextureId"], 0x05002862u32);
        assert_eq!(
            asset.payload["selectedRenderSurfaceId"]
                .as_u64()
                .expect("surface texture route should expose available render surface"),
            u64::from(0x060041c0u32)
        );
        assert_eq!(
            asset.payload["renderSurfaceIds"]
                .as_array()
                .expect("surface texture route should expose source-level ids"),
            &[
                serde_json::json!(0x060041bfu32),
                serde_json::json!(0x060041c0u32)
            ]
        );
        assert_eq!(
            asset.payload["dependencies"]["renderSurfaceAssetIds"]
                .as_array()
                .expect("surface texture route should expose dependency ids"),
            &[serde_json::json!("render-surface/060041c0")]
        );
    }

    #[test]
    fn material_recipe_lookup_does_not_emit_missing_high_detail_render_surface() {
        let runtime = HostRuntimeService::new(false);
        let asset = runtime.asset_lookup_blocking(AssetLookupRequestDto {
            request_id: "test-material-available-source-level".to_string(),
            asset_id: "material/0800128c".to_string(),
            priority: crate::contracts::AssetPriorityDto::Streaming,
        });

        assert_eq!(asset.payload["kind"], "material-recipe");
        assert_eq!(asset.payload["surfaceId"], 0x0800128cu32);
        assert_ne!(
            asset.payload["source"]["selectedRenderSurfaceId"]
                .as_u64()
                .expect("material route should expose selected render surface"),
            u64::from(0x0600379cu32)
        );
        assert!(
            !asset.payload["dependencies"]["renderSurfaceAssetIds"]
                .as_array()
                .expect("material route should expose render surface dependency")
                .is_empty()
        );
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
    fn env_cell_binary_lookup_allows_real_renderless_cell_structures() {
        let adapter = HostBoundaryAdapter::new(false);
        let bytes = tauri::async_runtime::block_on(adapter.asset_lookup_binary_batch(vec![
            AssetLookupRequestDto {
                request_id: "test-renderless-env-cell-binary".to_string(),
                asset_id: "env-cell/da560109".to_string(),
                priority: crate::contracts::AssetPriorityDto::Streaming,
            },
        ]))
        .expect("binary renderless env-cell lookup should succeed");

        let (manifest, _) = decode_binary_manifest(&bytes);
        let payload = &manifest["responses"][0]["payload"];
        assert_eq!(payload["kind"], "env-cell");
        assert_eq!(payload["envCellId"], 0xda560109u32);
        assert_eq!(payload["renderGeometry"]["vertexCount"], 0);
        assert_eq!(payload["renderGeometry"]["triangleCount"], 0);
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
                asset_id: "gfx-obj/01000d67".to_string(),
                priority: crate::contracts::AssetPriorityDto::Streaming,
            },
        ]))
        .expect("binary gfx-obj lookup should succeed");

        let (manifest, manifest_len) = decode_binary_manifest(&bytes);
        assert_eq!(manifest["responses"][0]["payload"]["kind"], "gfx-obj");
        assert_eq!(
            manifest["responses"][0]["payload"]["gfxObjId"],
            0x01000d67u32
        );
        assert_eq!(
            manifest["responses"][0]["payload"]["surfaceIds"]
                .as_array()
                .expect("binary gfx-obj should carry source material ids"),
            &[
                serde_json::json!(0x08000bb6u32),
                serde_json::json!(0x080001c7u32),
                serde_json::json!(0x080001c5u32),
                serde_json::json!(0x08000762u32),
                serde_json::json!(0x08000941u32),
                serde_json::json!(0x08000944u32),
            ]
        );
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

    #[tokio::test]
    async fn runtime_appearance_resolves_obj_desc_without_asset_route() {
        let runtime = HostRuntimeService::new(false);
        let payload = runtime
            .resolve_runtime_appearance(RuntimeAppearanceRequestDto {
                setup_model_id: 0x0200_0001,
                obj_desc: Some(RuntimeAppearanceObjDescDto {
                    palette_id: Some(0x0400_0001),
                    sub_palettes: vec![],
                    texture_changes: vec![],
                    anim_part_changes: vec![],
                }),
            })
            .await
            .expect("runtime appearance should resolve through content runtime");

        assert_eq!(payload["kind"], "setup-appearance");
        assert_eq!(payload["sourceAssetKind"], "setup-appearance");
        assert_eq!(payload["setupModelId"], 0x0200_0001);
        assert_eq!(payload["paletteId"], 0x0400_0001);
        assert!(
            payload["appearanceKey"]
                .as_str()
                .expect("appearance key should be present")
                .contains("setup:")
        );
    }
}
