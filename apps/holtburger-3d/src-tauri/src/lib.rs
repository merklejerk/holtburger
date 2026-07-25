use std::collections::BTreeMap;
use std::sync::Arc;

use anyhow::{Context, Result};
use holtburger_content::{
    ActiveRegionData, ContentDecodeCache, ContentRepository, LandblockSceneLodLayer,
    LandblockSceneLodLevel, LandblockSceneLodRequest, ResolvedMaterialRecipe,
    ResolvedMaterialSource, SourceRecordStatus, TerrainGridSource, TexturePixelFormat,
    build_gfx_obj_render_geometry,
};
use holtburger_core::{
    ContentAsset, ContentAssetRequest, ContentAssetRuntime, ContentAssetService,
    SurfaceTexturePixelsRequest,
};
use holtburger_dat::file_type::region::{LandSurfType, TerrainDesc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

const TERRAIN_SOURCE_BINARY_MAGIC: &[u8; 4] = b"HBTR";
const TERRAIN_SOURCE_BINARY_VERSION: u32 = 1;
const TERRAIN_SOURCE_BINARY_HEADER_LEN: usize = 16;
const TEXTURE_PIXELS_BINARY_MAGIC: &[u8; 4] = b"HBTP";
const TEXTURE_PIXELS_BINARY_VERSION: u32 = 1;
const ACTIVE_REGION_BINARY_MAGIC: &[u8; 4] = b"HBAR";
const ACTIVE_REGION_BINARY_VERSION: u32 = 1;
const BUILDING_SOURCE_BINARY_MAGIC: &[u8; 4] = b"HBBL";
const BUILDING_SOURCE_BINARY_VERSION: u32 = 1;

/// Managed static-content runtime shared by narrow Tauri commands.
#[derive(Clone)]
struct HostContentState {
    runtime: ContentAssetRuntime,
}

impl HostContentState {
    fn discover() -> Result<Self> {
        let repository = Arc::new(ContentRepository::discover(None)?);
        Ok(Self::from_repository(repository))
    }

    /// Builds the app-local host state from an already discovered or injected repository.
    fn from_repository(repository: Arc<ContentRepository>) -> Self {
        let service = ContentAssetService::new(repository, Arc::new(ContentDecodeCache::new()));
        Self {
            runtime: ContentAssetRuntime::new(service),
        }
    }
}

/// Discover the app's configured static-content runtime for a non-Tauri diagnostic host.
pub fn discover_content_runtime() -> Result<ContentAssetRuntime> {
    let repository = Arc::new(ContentRepository::discover(None)?);
    let service = ContentAssetService::new(repository, Arc::new(ContentDecodeCache::new()));
    Ok(ContentAssetRuntime::new(service))
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoadTerrainSourceRequest {
    landblock_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoadBuildingSourceRequest {
    landblock_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoadTexturePixelsRequest {
    kind: String,
    purpose: String,
    source_asset_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct HostStatus {
    /// Stable label used by the frontend to identify the active host shell.
    app_name: &'static str,
    /// Human-readable lifecycle state for diagnostics.
    status: &'static str,
}

#[tauri::command]
fn host_status() -> HostStatus {
    HostStatus {
        app_name: "holtburger-3d",
        status: "terrain-source-host-ready",
    }
}

/// Loads the active content scope's immutable regional static data once per frontend runtime.
#[tauri::command]
async fn load_active_region_data(
    state: tauri::State<'_, HostContentState>,
) -> Result<tauri::ipc::Response, String> {
    let bytes = load_active_region_data_bytes(&state.runtime)
        .await
        .map_err(format_error)?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Loads one normalized outdoor landblock's authored terrain source as a versioned binary response.
#[tauri::command]
async fn load_terrain_source(
    state: tauri::State<'_, HostContentState>,
    request: LoadTerrainSourceRequest,
) -> Result<tauri::ipc::Response, String> {
    let bytes = load_terrain_source_bytes(&state.runtime, &request.landblock_id)
        .await
        .map_err(format_error)?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Loads one outdoor building layer as a closed, non-pixel source bundle.
#[tauri::command]
async fn load_building_source(
    state: tauri::State<'_, HostContentState>,
    request: LoadBuildingSourceRequest,
) -> Result<tauri::ipc::Response, String> {
    let bytes = load_building_source_bytes(&state.runtime, &request.landblock_id)
        .await
        .map_err(format_error)?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Loads one terrain source texture as semantic, normalized level-zero pixels.
#[tauri::command]
async fn load_texture_pixels(
    state: tauri::State<'_, HostContentState>,
    request: LoadTexturePixelsRequest,
) -> Result<tauri::ipc::Response, String> {
    let bytes = load_texture_pixels_bytes(
        &state.runtime,
        &request.kind,
        &request.purpose,
        &request.source_asset_id,
    )
    .await
    .map_err(format_error)?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Build the canonical terrain-source response used by Tauri and the headless browser harness.
pub async fn load_terrain_source_bytes(
    runtime: &ContentAssetRuntime,
    raw_landblock_id: &str,
) -> Result<Vec<u8>> {
    let landblock_id = parse_landblock_id(raw_landblock_id)?;
    build_terrain_source_response(runtime, landblock_id).await
}

/// Build the canonical Level 1 building response used by Tauri and browser hosts.
pub async fn load_building_source_bytes(
    runtime: &ContentAssetRuntime,
    raw_landblock_id: &str,
) -> Result<Vec<u8>> {
    let landblock_id = parse_landblock_id(raw_landblock_id)?;
    build_building_source_response(runtime, landblock_id).await
}

/// Build the canonical active-region response used by Tauri and the headless browser harness.
pub async fn load_active_region_data_bytes(runtime: &ContentAssetRuntime) -> Result<Vec<u8>> {
    let asset = runtime
        .load(ContentAssetRequest::ActiveRegionData)
        .await
        .context("Could not load active-region static data")?;
    let ContentAsset::ActiveRegionData(active_region) = asset else {
        unreachable!("active-region request must return active-region data")
    };
    serialize_active_region_binary(&active_region)
}

/// Build the canonical terrain-pixel response used by Tauri and the headless browser harness.
pub async fn load_texture_pixels_bytes(
    runtime: &ContentAssetRuntime,
    kind: &str,
    purpose: &str,
    source_asset_id: &str,
) -> Result<Vec<u8>> {
    build_texture_pixels_response(
        runtime,
        LoadTexturePixelsRequest {
            kind: kind.to_owned(),
            purpose: purpose.to_owned(),
            source_asset_id: source_asset_id.to_owned(),
        },
    )
    .await
}

async fn build_terrain_source_response(
    runtime: &ContentAssetRuntime,
    landblock_id: u32,
) -> Result<Vec<u8>> {
    let scene_asset = runtime
        .load(ContentAssetRequest::LandblockSceneLod(
            LandblockSceneLodRequest::outdoor(landblock_id, LandblockSceneLodLevel::Level0),
        ))
        .await
        .with_context(|| format!("Could not load terrain scene source for 0x{landblock_id:08X}"))?;
    let ContentAsset::LandblockSceneLod { scene_lod, .. } = scene_asset else {
        unreachable!("terrain source request must return a landblock scene asset")
    };
    if scene_lod.landblock_id != landblock_id {
        anyhow::bail!(
            "content runtime returned landblock 0x{:08X} for terrain request 0x{landblock_id:08X}",
            scene_lod.landblock_id
        );
    }

    let terrain = scene_lod.layers.iter().find_map(|layer| match layer {
        LandblockSceneLodLayer::Terrain(layer) => layer.terrain.as_ref(),
        _ => None,
    });
    let terrain_availability = terrain_availability(terrain, &scene_lod.diagnostics);
    let manifest = TerrainSourceManifest {
        transport: "holtburger-terrain-source",
        version: TERRAIN_SOURCE_BINARY_VERSION,
        byte_order: "little-endian",
        section_byte_offset_base: "section-data",
        landblock_id: format!("0x{landblock_id:08x}"),
        terrain_availability,
        sections: terrain.map(terrain_sections).unwrap_or_default(),
    };
    serialize_terrain_source_binary(&manifest, terrain)
}

async fn build_building_source_response(
    runtime: &ContentAssetRuntime,
    landblock_id: u32,
) -> Result<Vec<u8>> {
    let scene_asset = runtime
        .load(ContentAssetRequest::LandblockSceneLod(
            LandblockSceneLodRequest::outdoor(landblock_id, LandblockSceneLodLevel::Level1),
        ))
        .await
        .with_context(|| {
            format!("Could not load building scene source for 0x{landblock_id:08X}")
        })?;
    let ContentAsset::LandblockSceneLod { scene_lod, .. } = scene_asset else {
        unreachable!("building source request must return a landblock scene asset")
    };
    if scene_lod.landblock_id != landblock_id {
        anyhow::bail!(
            "content runtime returned landblock 0x{:08X} for building request 0x{landblock_id:08X}",
            scene_lod.landblock_id
        );
    }
    let buildings = scene_lod.layers.iter().find_map(|layer| match layer {
        LandblockSceneLodLayer::OutdoorBuildings(layer) => Some(layer),
        _ => None,
    });
    let Some(buildings) = buildings else {
        anyhow::bail!("Level 1 response for 0x{landblock_id:08X} has no OutdoorBuildings layer");
    };

    let mut closure = BuildingSourceClosure::default();
    let mut residents = Vec::with_capacity(buildings.statics.len());
    for member in &buildings.statics {
        let source = closure.add_resident(runtime, member).await?;
        residents.push(json!({
            "id": member.instance.instance_id,
            "source": source,
            "placement": frame_json(&member.instance.local_placement),
            "scale": prepared_vec3_json(member.instance.source_scale),
            "localBounds": member.source_bounds.as_ref().map(prepared_aabb_json),
        }));
    }
    closure.validate()?;
    let sections = closure.sections();
    let manifest = BuildingSourceManifest {
        transport: "holtburger-building-source",
        version: BUILDING_SOURCE_BINARY_VERSION,
        byte_order: "little-endian",
        section_byte_offset_base: "section-data",
        landblock_id: dat_id(landblock_id),
        residents,
        definitions: closure.definitions,
        geometries: closure.geometries,
        materials: closure.materials.into_values().collect(),
        texture_dependencies: closure.texture_dependencies.into_values().collect(),
        sections,
    };
    serialize_building_source_binary(&manifest, &closure.buffers)
}

/// Closed Level 1 source data accumulated before it crosses the app boundary.
#[derive(Default)]
struct BuildingSourceClosure {
    buffers: BuildingGeometryBuffers,
    definitions: Vec<Value>,
    definition_ids: BTreeMap<u32, String>,
    geometries: Vec<Value>,
    geometry_ids: BTreeMap<u32, String>,
    materials: BTreeMap<String, Value>,
    texture_dependencies: BTreeMap<String, Value>,
}

impl BuildingSourceClosure {
    async fn add_resident(
        &mut self,
        runtime: &ContentAssetRuntime,
        member: &holtburger_content::LandblockOutdoorStaticMember,
    ) -> Result<String> {
        let source_did = member.instance.source_did;
        match source_did >> 24 {
            0x01 => self.add_gfx_object_definition(runtime, source_did).await,
            0x02 => self.add_setup_model_definition(runtime, source_did).await,
            family => anyhow::bail!(
                "building {} has unsupported render source family 0x{family:02X} ({})",
                member.instance.instance_id,
                member.instance.source_asset_id
            ),
        }
    }

    async fn add_gfx_object_definition(
        &mut self,
        runtime: &ContentAssetRuntime,
        gfx_obj_id: u32,
    ) -> Result<String> {
        if let Some(existing) = self.definition_ids.get(&gfx_obj_id) {
            return Ok(existing.clone());
        }
        let asset = runtime
            .load(ContentAssetRequest::GfxObj(gfx_obj_id))
            .await?;
        let ContentAsset::GfxObj(gfx_obj) = asset else {
            unreachable!("GfxObj request must return a GfxObj")
        };
        let geometry_id = self.add_geometry(&gfx_obj)?;
        let material_ids = self.add_materials(runtime, &gfx_obj.surfaces).await?;
        let id = format!("gfx-obj/{gfx_obj_id:08x}");
        self.definitions.push(json!({
            "id": id,
            "kind": "gfx-obj",
            "sourceAssetId": id,
            "geometryId": geometry_id,
            "materialIds": material_ids,
        }));
        self.definition_ids.insert(gfx_obj_id, id.clone());
        Ok(id)
    }

    async fn add_setup_model_definition(
        &mut self,
        runtime: &ContentAssetRuntime,
        setup_model_id: u32,
    ) -> Result<String> {
        if let Some(existing) = self.definition_ids.get(&setup_model_id) {
            return Ok(existing.clone());
        }
        let setup_asset = runtime
            .load(ContentAssetRequest::SetupModel(setup_model_id))
            .await?;
        let ContentAsset::SetupModel(setup_model) = setup_asset else {
            unreachable!("SetupModel request must return a SetupModel")
        };
        let appearance_asset = runtime
            .load(ContentAssetRequest::SetupAppearance(
                holtburger_core::SetupAppearanceRequest::base(setup_model_id),
            ))
            .await?;
        let ContentAsset::SetupAppearance(appearance) = appearance_asset else {
            unreachable!("SetupAppearance request must return a SetupAppearance")
        };
        if appearance.parts.len() != setup_model.parts.len() {
            anyhow::bail!(
                "SetupModel 0x{setup_model_id:08X} has {} parts but its base appearance has {}",
                setup_model.parts.len(),
                appearance.parts.len()
            );
        }
        let default_frames = select_setup_default_frames(&setup_model);
        let mut parts = Vec::with_capacity(appearance.parts.len());
        for part in &appearance.parts {
            let gfx_asset = runtime
                .load(ContentAssetRequest::GfxObj(part.gfx_obj_id))
                .await?;
            let ContentAsset::GfxObj(gfx_obj) = gfx_asset else {
                unreachable!("GfxObj request must return a GfxObj")
            };
            let geometry_id = self.add_geometry(&gfx_obj)?;
            let surface_ids = part
                .material_slots
                .iter()
                .map(|slot| slot.material.surface_id)
                .collect::<Vec<_>>();
            let material_ids = self.add_materials(runtime, &surface_ids).await?;
            parts.push(json!({
                "partIndex": part.part_index,
                "parentPartIndex": setup_model.parent_index.get(part.part_index).copied(),
                "geometryId": geometry_id,
                "defaultScale": setup_model.default_scale.get(part.part_index).map(ac_vec3_json).unwrap_or_else(unit_vec3_json),
                "defaultPlacement": default_frames.and_then(|frames| frames.get(part.part_index)).map(frame_json),
                "materialIds": material_ids,
            }));
        }
        let id = format!("setup-model/{setup_model_id:08x}");
        self.definitions.push(json!({
            "id": id,
            "kind": "setup-model",
            "sourceAssetId": id,
            "parts": parts,
            "defaultAnimationId": setup_model.default_animation.map(dat_id),
            "defaultMotionTableId": setup_model.default_motion_table.map(dat_id),
            "defaultScriptId": setup_model.default_script.map(dat_id),
            "defaultScriptTableId": setup_model.default_script_table.map(dat_id),
            "defaultSoundTableId": setup_model.default_sound_table.map(dat_id),
        }));
        self.definition_ids.insert(setup_model_id, id.clone());
        Ok(id)
    }

    fn add_geometry(&mut self, gfx_obj: &holtburger_dat::file_type::GfxObj) -> Result<String> {
        if let Some(existing) = self.geometry_ids.get(&gfx_obj.id) {
            return Ok(existing.clone());
        }
        let geometry = build_gfx_obj_render_geometry(gfx_obj);
        if geometry.positions.len() != geometry.vertex_count * 3
            || geometry.normals.len() != geometry.vertex_count * 3
            || geometry.uvs.len() != geometry.vertex_count * 2
        {
            anyhow::bail!(
                "GfxObj 0x{:08X} has inconsistent prepared geometry lengths",
                gfx_obj.id
            );
        }
        let position_offset = self.buffers.positions.len();
        self.buffers
            .positions
            .extend_from_slice(&geometry.positions);
        let normal_offset = self.buffers.normals.len();
        self.buffers.normals.extend_from_slice(&geometry.normals);
        let texture_coordinate_offset = self.buffers.texture_coordinates.len();
        self.buffers
            .texture_coordinates
            .extend_from_slice(&geometry.uvs);
        let index_offset = self.buffers.indices.len();
        let material_slot_offset = self.buffers.material_slots.len();
        for triangle in &geometry.triangles {
            let slot = triangle.surface_id.with_context(|| {
                format!(
                    "GfxObj 0x{:08X} polygon {} has no render surface",
                    gfx_obj.id, triangle.polygon_id
                )
            })?;
            let slot = usize::try_from(slot).context("render surface index is negative")?;
            if slot >= gfx_obj.surfaces.len() {
                anyhow::bail!(
                    "GfxObj 0x{:08X} polygon {} references material slot {slot}, but only {} slots exist",
                    gfx_obj.id,
                    triangle.polygon_id,
                    gfx_obj.surfaces.len()
                );
            }
            let first = u32::try_from(triangle.first_vertex)?;
            let end = first
                .checked_add(3)
                .context("triangle vertex range overflow")?;
            if usize::try_from(end)? > geometry.vertex_count {
                anyhow::bail!(
                    "GfxObj 0x{:08X} triangle begins outside prepared vertex data",
                    gfx_obj.id
                );
            }
            self.buffers.indices.extend([first, first + 1, first + 2]);
            self.buffers.material_slots.push(u16::try_from(slot)?);
        }
        let id = format!("geometry:gfx-obj/{:08x}", gfx_obj.id);
        self.geometries.push(json!({
            "id": id,
            "sourceAssetId": format!("gfx-obj/{:08x}", gfx_obj.id),
            "vertexCount": geometry.vertex_count,
            "positionOffset": position_offset,
            "normalOffset": normal_offset,
            "textureCoordinateOffset": texture_coordinate_offset,
            "indexOffset": index_offset,
            "indexCount": self.buffers.indices.len() - index_offset,
            "materialSlotOffset": material_slot_offset,
            "materialSlotCount": self.buffers.material_slots.len() - material_slot_offset,
            "bounds": geometry.bounds.as_ref().map(prepared_aabb_json),
        }));
        self.geometry_ids.insert(gfx_obj.id, id.clone());
        Ok(id)
    }

    async fn add_materials(
        &mut self,
        runtime: &ContentAssetRuntime,
        surface_ids: &[u32],
    ) -> Result<Vec<String>> {
        let mut ids = Vec::with_capacity(surface_ids.len());
        for surface_id in surface_ids {
            let id = format!("surface/{surface_id:08x}");
            if !self.materials.contains_key(&id) {
                let asset = runtime
                    .load(ContentAssetRequest::MaterialRecipe(*surface_id))
                    .await?;
                let ContentAsset::MaterialRecipe(recipe) = asset else {
                    unreachable!("MaterialRecipe request must return a material recipe")
                };
                self.materials
                    .insert(id.clone(), material_recipe_json(&recipe));
                self.add_texture_dependencies(&recipe);
            }
            ids.push(id);
        }
        Ok(ids)
    }

    fn add_texture_dependencies(&mut self, recipe: &ResolvedMaterialRecipe) {
        let ResolvedMaterialSource::Texture(texture) = &recipe.source else {
            return;
        };
        self.texture_dependencies.insert(
            format!("surface-texture/{:08x}", texture.surface_texture_id),
            json!({
                "id": format!("surface-texture/{:08x}", texture.surface_texture_id),
                "kind": "surface-texture",
            }),
        );
        for palette_id in texture
            .palette_id
            .into_iter()
            .chain(texture.render_surface_default_palette_ids.iter().copied())
        {
            self.texture_dependencies.insert(
                format!("palette/{palette_id:08x}"),
                json!({ "id": format!("palette/{palette_id:08x}"), "kind": "palette" }),
            );
        }
    }

    fn sections(&self) -> Vec<BuildingBinarySectionManifest> {
        self.buffers.sections()
    }

    fn validate(&self) -> Result<()> {
        if self.geometries.iter().any(|geometry| !geometry.is_object()) {
            anyhow::bail!("building geometry manifest contains a non-object record");
        }
        Ok(())
    }
}

#[derive(Default)]
struct BuildingGeometryBuffers {
    positions: Vec<f32>,
    normals: Vec<f32>,
    texture_coordinates: Vec<f32>,
    indices: Vec<u32>,
    material_slots: Vec<u16>,
}

impl BuildingGeometryBuffers {
    fn sections(&self) -> Vec<BuildingBinarySectionManifest> {
        let mut byte_offset = 0;
        let mut sections = Vec::new();
        for (name, scalar_type, element_count, alignment) in [
            ("positions", "f32", self.positions.len(), 4),
            ("normals", "f32", self.normals.len(), 4),
            (
                "textureCoordinates",
                "f32",
                self.texture_coordinates.len(),
                4,
            ),
            ("indices", "u32", self.indices.len(), 4),
            ("materialSlots", "u16", self.material_slots.len(), 2),
        ] {
            byte_offset = align_binary_section_offset(byte_offset, alignment);
            let byte_length = element_count * scalar_size(scalar_type);
            sections.push(BuildingBinarySectionManifest {
                name: name.to_owned(),
                scalar_type,
                element_count,
                byte_offset,
                byte_length,
            });
            byte_offset += byte_length;
        }
        sections
    }

    fn bytes(&self) -> Vec<u8> {
        let sections = self.sections();
        let total_length = sections
            .iter()
            .map(|section| section.byte_offset + section.byte_length)
            .max()
            .unwrap_or_default();
        let mut bytes = vec![0; total_length];
        for section in &sections {
            let target = &mut bytes[section.byte_offset..section.byte_offset + section.byte_length];
            match section.name.as_str() {
                "positions" => write_f32_slice(target, &self.positions),
                "normals" => write_f32_slice(target, &self.normals),
                "textureCoordinates" => write_f32_slice(target, &self.texture_coordinates),
                "indices" => write_u32_slice(target, &self.indices),
                "materialSlots" => write_u16_slice(target, &self.material_slots),
                _ => unreachable!("building sections are fixed"),
            }
        }
        bytes
    }
}

fn scalar_size(scalar_type: &str) -> usize {
    match scalar_type {
        "f32" | "u32" => 4,
        "u16" => 2,
        _ => unreachable!("building scalar types are fixed"),
    }
}

fn write_f32_slice(target: &mut [u8], values: &[f32]) {
    for (chunk, value) in target.chunks_exact_mut(4).zip(values) {
        chunk.copy_from_slice(&value.to_le_bytes());
    }
}

fn write_u32_slice(target: &mut [u8], values: &[u32]) {
    for (chunk, value) in target.chunks_exact_mut(4).zip(values) {
        chunk.copy_from_slice(&value.to_le_bytes());
    }
}

fn write_u16_slice(target: &mut [u8], values: &[u16]) {
    for (chunk, value) in target.chunks_exact_mut(2).zip(values) {
        chunk.copy_from_slice(&value.to_le_bytes());
    }
}

fn material_recipe_json(recipe: &ResolvedMaterialRecipe) -> Value {
    let source = match &recipe.source {
        ResolvedMaterialSource::SolidColor(color) => {
            json!({ "kind": "solid-color", "color": color })
        }
        ResolvedMaterialSource::Texture(texture) => json!({
            "kind": "texture",
            "surfaceTextureId": dat_id(texture.surface_texture_id),
            "paletteId": texture.palette_id.map(dat_id),
            "renderSurfaceIds": texture.render_surface_ids.iter().copied().map(dat_id).collect::<Vec<_>>(),
            "defaultPaletteIds": texture.render_surface_default_palette_ids.iter().copied().map(dat_id).collect::<Vec<_>>(),
        }),
    };
    json!({
        "id": format!("surface/{:08x}", recipe.surface_id),
        "rawSurfaceFlags": recipe.surface_type.bits(),
        "translucency": recipe.translucency,
        "luminosity": recipe.luminosity,
        "diffuseScale": recipe.diffuse,
        "source": source,
    })
}

fn select_setup_default_frames(
    setup_model: &holtburger_dat::file_type::SetupModel,
) -> Option<&[holtburger_dat::graphics::Frame]> {
    setup_model
        .placement_frames
        .get(&0x65)
        .or_else(|| setup_model.placement_frames.get(&0))
        .or_else(|| {
            setup_model
                .placement_frames
                .iter()
                .min_by_key(|(key, _)| **key)
                .map(|(_, placement)| placement)
        })
        .map(|placement| placement.anim_frame.frames.as_slice())
}

fn frame_json(frame: &holtburger_dat::graphics::Frame) -> Value {
    json!({
        "origin": ac_vec3_json(&frame.origin),
        "orientation": [frame.orientation.w, frame.orientation.x, frame.orientation.y, frame.orientation.z],
    })
}

fn ac_vec3_json(vector: &holtburger_common::Vector3) -> Value {
    json!([vector.x, vector.y, vector.z])
}

fn prepared_vec3_json(vector: holtburger_content::PreparedVec3) -> Value {
    json!([vector.x, vector.y, vector.z])
}

fn unit_vec3_json() -> Value {
    json!([1.0, 1.0, 1.0])
}

fn prepared_aabb_json(bounds: &holtburger_content::PreparedAabb) -> Value {
    json!({
        "min": prepared_vec3_json(bounds.min),
        "max": prepared_vec3_json(bounds.max),
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BuildingSourceManifest {
    transport: &'static str,
    version: u32,
    byte_order: &'static str,
    section_byte_offset_base: &'static str,
    landblock_id: String,
    residents: Vec<Value>,
    definitions: Vec<Value>,
    geometries: Vec<Value>,
    materials: Vec<Value>,
    texture_dependencies: Vec<Value>,
    sections: Vec<BuildingBinarySectionManifest>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BuildingBinarySectionManifest {
    name: String,
    scalar_type: &'static str,
    element_count: usize,
    byte_offset: usize,
    byte_length: usize,
}

fn serialize_building_source_binary(
    manifest: &BuildingSourceManifest,
    buffers: &BuildingGeometryBuffers,
) -> Result<Vec<u8>> {
    let mut manifest_bytes = serde_json::to_vec(manifest)?;
    while !(TERRAIN_SOURCE_BINARY_HEADER_LEN + manifest_bytes.len()).is_multiple_of(4) {
        manifest_bytes.push(b' ');
    }
    let section_bytes = buffers.bytes();
    let total_length =
        TERRAIN_SOURCE_BINARY_HEADER_LEN + manifest_bytes.len() + section_bytes.len();
    let mut bytes = Vec::with_capacity(total_length);
    bytes.extend(BUILDING_SOURCE_BINARY_MAGIC);
    bytes.extend(BUILDING_SOURCE_BINARY_VERSION.to_le_bytes());
    bytes.extend(u32::try_from(manifest_bytes.len())?.to_le_bytes());
    bytes.extend(u32::try_from(total_length)?.to_le_bytes());
    bytes.extend(manifest_bytes);
    bytes.extend(section_bytes);
    Ok(bytes)
}

async fn build_texture_pixels_response(
    runtime: &ContentAssetRuntime,
    request: LoadTexturePixelsRequest,
) -> Result<Vec<u8>> {
    if request.kind != "prepared-texture-surface" {
        anyhow::bail!("texture request kind must be prepared-texture-surface");
    }
    let output_format = texture_output_format(&request.purpose)?;
    let surface_texture_id = parse_surface_texture_asset_id(&request.source_asset_id)?;
    let asset = runtime
        .load(ContentAssetRequest::SurfaceTexturePixels(
            SurfaceTexturePixelsRequest {
                surface_texture_id,
                output_format,
            },
        ))
        .await
        .with_context(|| {
            format!(
                "Could not load {} pixels from {}",
                request.purpose, request.source_asset_id
            )
        })?;
    let ContentAsset::SurfaceTexturePixels(pixels) = asset else {
        unreachable!("texture pixel request must return normalized surface pixels")
    };
    let source_asset_id = surface_texture_asset_id(surface_texture_id);
    let manifest = TexturePixelsManifest {
        transport: "holtburger-texture-pixels",
        version: TEXTURE_PIXELS_BINARY_VERSION,
        byte_order: "little-endian",
        section_byte_offset_base: "section-data",
        source_asset_id,
        purpose: request.purpose,
        surface: TexturePixelsSurfaceManifest {
            render_surface_id: format!("0x{:08x}", pixels.render_surface_id),
            format: texture_pixel_format_name(pixels.format),
            width: pixels.width,
            height: pixels.height,
        },
        sections: vec![BinarySectionManifest {
            name: "pixels",
            scalar_type: "u8",
            element_count: pixels.pixels.len(),
            byte_offset: 0,
            byte_length: pixels.pixels.len(),
        }],
    };
    serialize_texture_pixels_binary(&manifest, &pixels.pixels)
}

fn parse_landblock_id(raw_landblock_id: &str) -> Result<u32> {
    let raw_hex = raw_landblock_id
        .strip_prefix("0x")
        .or_else(|| raw_landblock_id.strip_prefix("0X"))
        .unwrap_or(raw_landblock_id);
    if raw_hex.len() != 8
        || !raw_hex
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        anyhow::bail!("landblock id must be exactly eight hexadecimal digits")
    }
    let raw_id = u32::from_str_radix(raw_hex, 16).context("landblock id is not hexadecimal")?;
    Ok(raw_id & 0xFFFF_0000 | 0xFFFF)
}

fn parse_surface_texture_asset_id(raw_asset_id: &str) -> Result<u32> {
    let raw_id = raw_asset_id
        .strip_prefix("surface-texture/")
        .context("texture source asset id must start with surface-texture/")?;
    let raw_hex = raw_id
        .strip_prefix("0x")
        .or_else(|| raw_id.strip_prefix("0X"))
        .unwrap_or(raw_id);
    if raw_hex.len() != 8
        || !raw_hex
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        anyhow::bail!("texture source asset id must contain exactly eight hexadecimal digits");
    }
    let id =
        u32::from_str_radix(raw_hex, 16).context("texture source asset id is not hexadecimal")?;
    if id >> 24 != 0x05 {
        anyhow::bail!("texture source asset id must identify a SurfaceTexture record");
    }
    Ok(id)
}

fn texture_output_format(purpose: &str) -> Result<TexturePixelFormat> {
    match purpose {
        "terrain-color" | "terrain-detail" => Ok(TexturePixelFormat::Rgba8),
        "terrain-blend-mask" | "terrain-road-mask" => Ok(TexturePixelFormat::R8),
        _ => anyhow::bail!("unsupported texture purpose {purpose:?} for terrain pixel loading"),
    }
}

fn texture_pixel_format_name(format: TexturePixelFormat) -> &'static str {
    match format {
        TexturePixelFormat::Rgba8 => "rgba8",
        TexturePixelFormat::R8 => "r8",
    }
}

fn format_error(error: anyhow::Error) -> String {
    format!("{error:#}")
}

fn surface_texture_asset_id(texture_id: u32) -> String {
    format!("surface-texture/0x{texture_id:08x}")
}

/// App-local, versioned transport envelope for the active RegionDesc projection.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ActiveRegionManifest {
    transport: &'static str,
    version: u32,
    byte_order: &'static str,
    section_byte_offset_base: &'static str,
    provenance: ActiveRegionProvenanceManifest,
    /// Complete semantic RegionDesc projection. The enclosing transport version owns this schema.
    data: Value,
    sections: Vec<BinarySectionManifest>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ActiveRegionProvenanceManifest {
    source_record_id: String,
    number: u32,
    version: u32,
    name: String,
    parts_mask: u32,
}

fn active_region_manifest(active_region: &ActiveRegionData) -> ActiveRegionManifest {
    let region = &active_region.descriptor;
    ActiveRegionManifest {
        transport: "holtburger-active-region-data",
        version: ACTIVE_REGION_BINARY_VERSION,
        byte_order: "little-endian",
        section_byte_offset_base: "section-data",
        provenance: ActiveRegionProvenanceManifest {
            source_record_id: dat_id(region.id),
            number: region.region_number,
            version: region.version,
            name: region.region_name.clone(),
            parts_mask: region.parts_mask,
        },
        data: json!({
            "land": {
                "numBlockLength": region.land_defs.num_block_length,
                "numBlockWidth": region.land_defs.num_block_width,
                "squareLength": region.land_defs.square_length,
                "landblockLength": region.land_defs.lblock_length,
                "verticesPerCell": region.land_defs.vertex_per_cell,
                "maxObjectHeight": region.land_defs.max_obj_height,
                "skyHeight": region.land_defs.sky_height,
                "roadWidth": region.land_defs.road_width,
            },
            "calendar": {
                "zeroTimeOfYear": region.game_time.zero_time_of_year,
                "zeroYear": region.game_time.zero_year,
                "dayLength": region.game_time.day_length,
                "daysPerYear": region.game_time.days_per_year,
                "yearSpec": region.game_time.year_spec,
                "timesOfDay": region.game_time.times_of_day.iter().map(|time| json!({
                    "start": time.start,
                    "isNight": time.is_night,
                    "name": time.name,
                })).collect::<Vec<_>>(),
                "daysOfTheWeek": region.game_time.days_of_the_week,
                "seasons": region.game_time.seasons.iter().map(|season| json!({
                    "startDate": season.start_date,
                    "name": season.name,
                })).collect::<Vec<_>>(),
            },
            "sky": region.sky_info.as_ref().map(|sky| json!({
                "tickSize": sky.tick_size,
                "lightTickSize": sky.light_tick_size,
                "dayGroups": sky.day_groups.iter().map(|group| json!({
                    "chanceOfOccur": group.chance_of_occur,
                    "dayName": group.day_name,
                    "skyObjects": group.sky_objects.iter().map(|object| json!({
                        "beginTime": object.begin_time,
                        "endTime": object.end_time,
                        "beginAngle": object.begin_angle,
                        "endAngle": object.end_angle,
                        "textureVelocityX": object.tex_velocity_x,
                        "textureVelocityY": object.tex_velocity_y,
                        "defaultGfxObjectId": dat_id(object.default_gfx_object_id),
                        "defaultParticleEffectId": dat_id(object.default_pes_object_id),
                        "properties": object.properties,
                    })).collect::<Vec<_>>(),
                    "skyTimes": group.sky_times.iter().map(|time| json!({
                        "begin": time.begin,
                        "directionalBrightness": time.dir_bright,
                        "directionalHeading": time.dir_heading,
                        "directionalPitch": time.dir_pitch,
                        "directionalColor": time.dir_color,
                        "ambientBrightness": time.amb_bright,
                        "ambientColor": time.amb_color,
                        "minWorldFog": time.min_world_fog,
                        "maxWorldFog": time.max_world_fog,
                        "worldFogColor": time.world_fog_color,
                        "worldFog": time.world_fog,
                        "skyObjectReplacements": time.sky_object_replacements.iter().map(|replacement| json!({
                            "objectIndex": replacement.object_index,
                            "gfxObjectId": dat_id(replacement.gfx_object_id),
                            "rotate": replacement.rotate,
                            "transparent": replacement.transparent,
                            "luminosity": replacement.luminosity,
                            "maxBrightness": replacement.max_bright,
                        })).collect::<Vec<_>>(),
                    })).collect::<Vec<_>>(),
                })).collect::<Vec<_>>(),
            })),
            "sound": region.sound_info.as_ref().map(|sound| json!({
                "tables": sound.tables.iter().map(|table| json!({
                    "soundTableId": dat_id(table.stb_id),
                    "sounds": table.sounds.iter().map(|sound| json!({
                        "soundType": sound.sound_type,
                        "volume": sound.volume,
                        "baseChance": sound.base_chance,
                        "minRate": sound.min_rate,
                        "maxRate": sound.max_rate,
                    })).collect::<Vec<_>>(),
                })).collect::<Vec<_>>(),
            })),
            "scenes": region.scene_info.as_ref().map(|scene| json!({
                "types": scene.scene_types.iter().map(|scene_type| json!({
                    "soundTableIndex": scene_type.stb_index,
                    "sceneIds": scene_type.scenes.iter().copied().map(dat_id).collect::<Vec<_>>(),
                })).collect::<Vec<_>>(),
            })),
            "terrain": region.terrain_info.as_ref().map(active_region_terrain_value),
            "misc": region.region_misc.as_ref().map(|misc| json!({
                "version": misc.version,
                "gameMapId": dat_id(misc.game_map_id),
                "autotestMapId": dat_id(misc.autotest_map_id),
                "autotestMapSize": misc.autotest_map_size,
                "clearCellId": dat_id(misc.clear_cell_id),
                "clearMonsterId": dat_id(misc.clear_monster_id),
            })),
        }),
        sections: vec![BinarySectionManifest {
            name: "landHeightTable",
            scalar_type: "f32",
            element_count: region.land_defs.land_height_table.len(),
            byte_offset: 0,
            byte_length: std::mem::size_of_val(&region.land_defs.land_height_table),
        }],
    }
}

fn active_region_terrain_value(terrain: &TerrainDesc) -> Value {
    let land_surface = match &terrain.land_surfaces.surface_type {
        LandSurfType::TextureMerge(merge) => json!({
            "kind": "texture-merge",
            "baseTextureSize": merge.base_tex_size,
            "cornerTerrainMaps": merge.corner_terrain_maps.iter().map(|map| json!({
                "terrainCode": map.terrain_code,
                "surfaceTextureId": dat_id(map.tex_gid),
            })).collect::<Vec<_>>(),
            "sideTerrainMaps": merge.side_terrain_maps.iter().map(|map| json!({
                "terrainCode": map.terrain_code,
                "surfaceTextureId": dat_id(map.tex_gid),
            })).collect::<Vec<_>>(),
            "roadMaps": merge.road_maps.iter().map(|map| json!({
                "roadCode": map.road_code,
                "surfaceTextureId": dat_id(map.road_tex_gid),
            })).collect::<Vec<_>>(),
            "terrainTextures": merge.terrain_desc.iter().map(|description| {
                let texture = &description.terrain_tex;
                json!({
                    "terrainType": description.terrain_type,
                    "colorTextureId": dat_id(texture.tex_gid),
                    "tiling": texture.tex_tiling,
                    "maxVertexBrightness": texture.max_vert_bright,
                    "minVertexBrightness": texture.min_vert_bright,
                    "maxVertexSaturation": texture.max_vert_saturate,
                    "minVertexSaturation": texture.min_vert_saturate,
                    "maxVertexHue": texture.max_vert_hue,
                    "minVertexHue": texture.min_vert_hue,
                    "detailTiling": texture.detail_tex_tiling,
                    "detailTextureId": dat_id(texture.detail_tex_gid),
                })
            }).collect::<Vec<_>>(),
        }),
        LandSurfType::PaletteShift(shift) => json!({
            "kind": "palette-shift",
            "landTextures": shift.land_textures.iter().map(|texture| json!({
                "surfaceTextureId": dat_id(texture.texture_id),
                "subPalettes": texture.sub_palettes.iter().map(|palette| json!({
                    "index": palette.index,
                    "length": palette.length,
                })).collect::<Vec<_>>(),
                "roadCodes": texture.road_codes.iter().map(|road| json!({
                    "roadCode": road.road_code,
                    "subPaletteTypes": road.sub_palette_types,
                })).collect::<Vec<_>>(),
                "terrainPalettes": texture.terrain_palettes.iter().map(|palette| json!({
                    "terrainIndex": palette.terrain_index,
                    "paletteId": dat_id(palette.palette_id),
                })).collect::<Vec<_>>(),
            })).collect::<Vec<_>>(),
        }),
    };
    json!({
        "types": terrain.terrain_types.iter().map(|terrain_type| json!({
            "name": terrain_type.name,
            "color": terrain_type.color,
            "sceneTypes": terrain_type.scene_types,
        })).collect::<Vec<_>>(),
        "landSurface": land_surface,
    })
}

fn dat_id(id: u32) -> String {
    format!("0x{id:08x}")
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerrainSourceManifest {
    transport: &'static str,
    version: u32,
    byte_order: &'static str,
    section_byte_offset_base: &'static str,
    landblock_id: String,
    /// Distinguishes an absent outdoor record from a source or assembly failure.
    terrain_availability: TerrainAvailabilityManifest,
    sections: Vec<BinarySectionManifest>,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "kebab-case")]
enum TerrainAvailabilityManifest {
    Available,
    MissingCellLandblock,
    CellLandblockDecodeFailed,
    TerrainAssemblyFailed,
}

fn terrain_availability(
    terrain: Option<&TerrainGridSource>,
    diagnostics: &holtburger_content::PreparedContentSourceDiagnostics,
) -> TerrainAvailabilityManifest {
    if terrain.is_some() {
        return TerrainAvailabilityManifest::Available;
    }

    match diagnostics
        .source_records
        .iter()
        .find(|record| record.role == "cell-landblock")
        .map(|record| record.status)
    {
        Some(SourceRecordStatus::Missing) => TerrainAvailabilityManifest::MissingCellLandblock,
        Some(SourceRecordStatus::DecodeFailed) => {
            TerrainAvailabilityManifest::CellLandblockDecodeFailed
        }
        Some(SourceRecordStatus::Loaded) | None => {
            TerrainAvailabilityManifest::TerrainAssemblyFailed
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BinarySectionManifest {
    name: &'static str,
    scalar_type: &'static str,
    element_count: usize,
    byte_offset: usize,
    byte_length: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TexturePixelsManifest {
    transport: &'static str,
    version: u32,
    byte_order: &'static str,
    section_byte_offset_base: &'static str,
    source_asset_id: String,
    purpose: String,
    surface: TexturePixelsSurfaceManifest,
    sections: Vec<BinarySectionManifest>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TexturePixelsSurfaceManifest {
    render_surface_id: String,
    format: &'static str,
    width: u32,
    height: u32,
}

fn terrain_sections(terrain: &TerrainGridSource) -> Vec<BinarySectionManifest> {
    let height_indices_length = terrain.height_indices.len();
    let terrain_samples_offset =
        align_binary_section_offset(height_indices_length, std::mem::align_of::<u16>());
    let terrain_samples_length = terrain.terrain_samples.len() * std::mem::size_of::<u16>();
    vec![
        BinarySectionManifest {
            name: "heightIndices",
            scalar_type: "u8",
            element_count: terrain.height_indices.len(),
            byte_offset: 0,
            byte_length: height_indices_length,
        },
        BinarySectionManifest {
            name: "terrainSamples",
            scalar_type: "u16",
            element_count: terrain.terrain_samples.len(),
            byte_offset: terrain_samples_offset,
            byte_length: terrain_samples_length,
        },
    ]
}

fn align_binary_section_offset(offset: usize, alignment: usize) -> usize {
    offset.next_multiple_of(alignment)
}

fn serialize_terrain_source_binary(
    manifest: &TerrainSourceManifest,
    terrain: Option<&TerrainGridSource>,
) -> Result<Vec<u8>> {
    let mut manifest_bytes = serde_json::to_vec(&manifest)?;
    while !(TERRAIN_SOURCE_BINARY_HEADER_LEN + manifest_bytes.len()).is_multiple_of(4) {
        manifest_bytes.push(b' ');
    }
    let manifest_length = manifest_bytes.len();
    let section_data_length = manifest
        .sections
        .iter()
        .map(|section| section.byte_offset + section.byte_length)
        .max()
        .unwrap_or_default();
    let total_length =
        TERRAIN_SOURCE_BINARY_HEADER_LEN + manifest_bytes.len() + section_data_length;
    let mut bytes = Vec::with_capacity(total_length);
    bytes.extend(TERRAIN_SOURCE_BINARY_MAGIC);
    bytes.extend(TERRAIN_SOURCE_BINARY_VERSION.to_le_bytes());
    bytes.extend(u32::try_from(manifest_length)?.to_le_bytes());
    bytes.extend(u32::try_from(total_length)?.to_le_bytes());
    bytes.extend(manifest_bytes);
    if let Some(terrain) = terrain {
        bytes.extend(&terrain.height_indices);
        bytes.resize(
            TERRAIN_SOURCE_BINARY_HEADER_LEN
                + manifest_length
                + align_binary_section_offset(
                    terrain.height_indices.len(),
                    std::mem::align_of::<u16>(),
                ),
            0,
        );
        for terrain_sample in &terrain.terrain_samples {
            bytes.extend(terrain_sample.to_le_bytes());
        }
    }
    Ok(bytes)
}

fn serialize_active_region_binary(active_region: &ActiveRegionData) -> Result<Vec<u8>> {
    let manifest = active_region_manifest(active_region);
    let mut manifest_bytes = serde_json::to_vec(&manifest)?;
    while !(TERRAIN_SOURCE_BINARY_HEADER_LEN + manifest_bytes.len()).is_multiple_of(4) {
        manifest_bytes.push(b' ');
    }
    let total_length = TERRAIN_SOURCE_BINARY_HEADER_LEN
        + manifest_bytes.len()
        + std::mem::size_of_val(&active_region.descriptor.land_defs.land_height_table);
    let mut bytes = Vec::with_capacity(total_length);
    bytes.extend(ACTIVE_REGION_BINARY_MAGIC);
    bytes.extend(ACTIVE_REGION_BINARY_VERSION.to_le_bytes());
    bytes.extend(u32::try_from(manifest_bytes.len())?.to_le_bytes());
    bytes.extend(u32::try_from(total_length)?.to_le_bytes());
    bytes.extend(manifest_bytes);
    for height in &active_region.descriptor.land_defs.land_height_table {
        bytes.extend(height.to_le_bytes());
    }
    Ok(bytes)
}

fn serialize_texture_pixels_binary(
    manifest: &TexturePixelsManifest,
    pixels: &[u8],
) -> Result<Vec<u8>> {
    let mut manifest_bytes = serde_json::to_vec(manifest)?;
    while !(TERRAIN_SOURCE_BINARY_HEADER_LEN + manifest_bytes.len()).is_multiple_of(4) {
        manifest_bytes.push(b' ');
    }
    let total_length = TERRAIN_SOURCE_BINARY_HEADER_LEN + manifest_bytes.len() + pixels.len();
    let mut bytes = Vec::with_capacity(total_length);
    bytes.extend(TEXTURE_PIXELS_BINARY_MAGIC);
    bytes.extend(TEXTURE_PIXELS_BINARY_VERSION.to_le_bytes());
    bytes.extend(u32::try_from(manifest_bytes.len())?.to_le_bytes());
    bytes.extend(u32::try_from(total_length)?.to_le_bytes());
    bytes.extend(manifest_bytes);
    bytes.extend(pixels);
    Ok(bytes)
}

pub fn run() {
    let content_state = HostContentState::discover()
        .expect("failed to initialize Holtburger 3D content repository from configured content");
    tauri::Builder::default()
        .manage(content_state)
        .invoke_handler(tauri::generate_handler![
            host_status,
            load_active_region_data,
            load_terrain_source,
            load_building_source,
            load_texture_pixels
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Holtburger 3D host");
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_dat::file_type::PixelFormatId;
    use holtburger_dat::file_type::region::{GameTime, LandDefs, RegionDesc};
    use holtburger_dat::{DatFileType, EOR_CELL_NAMESPACE, EOR_PORTAL_NAMESPACE, HbaWriter};
    use tempfile::tempdir;

    #[test]
    fn terrain_source_binary_aligns_and_describes_each_grid_section() {
        let terrain = TerrainGridSource {
            grid_size: 3,
            tile_size: 24.0,
            height_indices: (0..9).collect(),
            heights: (0..9).map(|value| value as f32 + 0.5).collect(),
            terrain_samples: (10..19).collect(),
        };
        let manifest = TerrainSourceManifest {
            transport: "holtburger-terrain-source",
            version: TERRAIN_SOURCE_BINARY_VERSION,
            byte_order: "little-endian",
            section_byte_offset_base: "section-data",
            landblock_id: "0x0102ffff".to_string(),
            terrain_availability: TerrainAvailabilityManifest::Available,
            sections: terrain_sections(&terrain),
        };

        let bytes = serialize_terrain_source_binary(&manifest, Some(&terrain))
            .expect("terrain source binary should serialize");

        assert_eq!(&bytes[..4], TERRAIN_SOURCE_BINARY_MAGIC);
        assert_eq!(u32::from_le_bytes(bytes[4..8].try_into().unwrap()), 1);
        let manifest_length = u32::from_le_bytes(bytes[8..12].try_into().unwrap()) as usize;
        assert_eq!(
            u32::from_le_bytes(bytes[12..16].try_into().unwrap()) as usize,
            bytes.len()
        );
        let section_data_offset = TERRAIN_SOURCE_BINARY_HEADER_LEN + manifest_length;
        let decoded_manifest: serde_json::Value =
            serde_json::from_slice(&bytes[TERRAIN_SOURCE_BINARY_HEADER_LEN..section_data_offset])
                .expect("padded manifest should remain JSON");
        let sections = decoded_manifest["sections"]
            .as_array()
            .expect("manifest should describe binary sections");
        assert_eq!(sections.len(), 2);
        assert_eq!(sections[1]["name"], "terrainSamples");
        assert_eq!(sections[1]["byteOffset"], 10);
        assert_eq!(bytes[section_data_offset], 0);
        assert_eq!(bytes[section_data_offset + 9], 0);
        assert_eq!(bytes[section_data_offset + 10], 10);
    }

    #[test]
    fn active_region_binary_projects_semantic_records_and_height_table() {
        let mut land_height_table = [0.0; 256];
        let sample_height_index = land_height_table.len() / 2;
        let expected_height = 42.5;
        land_height_table[sample_height_index] = expected_height;
        let active_region = ActiveRegionData::new(RegionDesc {
            id: 0x1300_0000,
            region_number: 1,
            version: 3,
            region_name: "Dereth".to_owned(),
            land_defs: LandDefs {
                num_block_length: 255,
                num_block_width: 255,
                square_length: 24.0,
                lblock_length: 192,
                vertex_per_cell: 8,
                max_obj_height: 64.0,
                sky_height: 500.0,
                road_width: 1.0,
                land_height_table,
            },
            game_time: GameTime {
                zero_time_of_year: 0.0,
                zero_year: 0,
                day_length: 1.0,
                days_per_year: 365,
                year_spec: "year".to_owned(),
                times_of_day: Vec::new(),
                days_of_the_week: Vec::new(),
                seasons: Vec::new(),
            },
            parts_mask: 0x04,
            sky_info: None,
            sound_info: None,
            scene_info: None,
            terrain_info: Some(TerrainDesc::default()),
            region_misc: None,
        });

        let bytes = serialize_active_region_binary(&active_region)
            .expect("active-region response should serialize");

        assert_eq!(&bytes[..4], ACTIVE_REGION_BINARY_MAGIC);
        assert_eq!(
            u32::from_le_bytes(bytes[4..8].try_into().unwrap()),
            ACTIVE_REGION_BINARY_VERSION
        );
        let manifest_length = u32::from_le_bytes(bytes[8..12].try_into().unwrap()) as usize;
        let section_offset = TERRAIN_SOURCE_BINARY_HEADER_LEN + manifest_length;
        let manifest: serde_json::Value =
            serde_json::from_slice(&bytes[TERRAIN_SOURCE_BINARY_HEADER_LEN..section_offset])
                .expect("active-region manifest should remain JSON");
        assert_eq!(manifest["provenance"]["sourceRecordId"], "0x13000000");
        assert_eq!(manifest["data"]["land"]["squareLength"], 24.0);
        assert_eq!(
            manifest["data"]["terrain"]["landSurface"]["kind"],
            "texture-merge"
        );
        assert_eq!(manifest["sections"][0]["name"], "landHeightTable");
        let scalar_size = std::mem::size_of::<f32>();
        let sample_offset = section_offset + sample_height_index * scalar_size;
        assert_eq!(
            f32::from_le_bytes(
                bytes[sample_offset..sample_offset + scalar_size]
                    .try_into()
                    .unwrap()
            ),
            expected_height
        );
    }

    #[test]
    fn landblock_parser_normalizes_cell_suffix() {
        assert_eq!(parse_landblock_id("0x0102abcd").unwrap(), 0x0102ffff);
        assert!(parse_landblock_id("not-a-landblock").is_err());
    }

    #[test]
    fn terrain_availability_keeps_missing_and_decode_failed_records_distinct() {
        let mut missing = holtburger_content::PreparedContentSourceDiagnostics::default();
        missing
            .source_records
            .push(holtburger_content::SourceRecordDiagnostic {
                namespace: EOR_CELL_NAMESPACE,
                file_id: 0x0102_ffff,
                role: "cell-landblock",
                status: SourceRecordStatus::Missing,
            });
        assert!(matches!(
            terrain_availability(None, &missing),
            TerrainAvailabilityManifest::MissingCellLandblock
        ));

        missing.source_records[0].status = SourceRecordStatus::DecodeFailed;
        assert!(matches!(
            terrain_availability(None, &missing),
            TerrainAvailabilityManifest::CellLandblockDecodeFailed
        ));
    }

    #[test]
    fn texture_pixel_binary_preserves_declared_pixel_section() {
        let manifest = TexturePixelsManifest {
            transport: "holtburger-texture-pixels",
            version: TEXTURE_PIXELS_BINARY_VERSION,
            byte_order: "little-endian",
            section_byte_offset_base: "section-data",
            source_asset_id: "surface-texture/0x05000001".to_string(),
            purpose: "terrain-blend-mask".to_string(),
            surface: TexturePixelsSurfaceManifest {
                render_surface_id: "0x06000001".to_string(),
                format: "r8",
                width: 2,
                height: 2,
            },
            sections: vec![BinarySectionManifest {
                name: "pixels",
                scalar_type: "u8",
                element_count: 4,
                byte_offset: 0,
                byte_length: 4,
            }],
        };
        let bytes = serialize_texture_pixels_binary(&manifest, &[1, 2, 3, 4])
            .expect("texture pixels should serialize");

        assert_eq!(&bytes[..4], TEXTURE_PIXELS_BINARY_MAGIC);
        assert_eq!(
            u32::from_le_bytes(bytes[4..8].try_into().unwrap()),
            TEXTURE_PIXELS_BINARY_VERSION
        );
        let manifest_length = u32::from_le_bytes(bytes[8..12].try_into().unwrap()) as usize;
        assert_eq!(
            u32::from_le_bytes(bytes[12..16].try_into().unwrap()) as usize,
            bytes.len()
        );
        assert_eq!(
            &bytes[TERRAIN_SOURCE_BINARY_HEADER_LEN + manifest_length..],
            &[1, 2, 3, 4]
        );
    }

    #[test]
    fn texture_request_rejects_untyped_or_non_surface_texture_ids() {
        assert_eq!(
            parse_surface_texture_asset_id("surface-texture/0x05001234").unwrap(),
            0x0500_1234
        );
        assert!(parse_surface_texture_asset_id("render-surface/0x06001234").is_err());
        assert!(parse_surface_texture_asset_id("surface-texture/0x06001234").is_err());
        assert_eq!(
            texture_output_format("terrain-road-mask").unwrap(),
            TexturePixelFormat::R8
        );
        assert!(texture_output_format("object-detail").is_err());
    }

    #[tokio::test]
    async fn texture_pixel_response_loads_normalized_content_through_the_runtime() {
        let directory = tempdir().expect("temporary directory should be created");
        let path = directory.path().join("texture-response.hba");
        let mut writer = HbaWriter::new();
        writer.set_compression(false);
        writer
            .add(
                EOR_PORTAL_NAMESPACE,
                0x0500_0001,
                DatFileType::SurfaceTexture as u32,
                test_surface_texture_bytes(0x0500_0001, &[0x0600_0001]),
            )
            .expect("surface texture should be added");
        writer
            .add(
                EOR_PORTAL_NAMESPACE,
                0x0600_0001,
                DatFileType::Texture as u32,
                test_render_surface_bytes(
                    0x0600_0001,
                    PixelFormatId::A8R8G8B8,
                    &[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
                ),
            )
            .expect("render surface should be added");
        writer.write(&path).expect("test HBA should be written");

        let repository = Arc::new(
            ContentRepository::from_hba_path(&path).expect("test repository should be opened"),
        );
        let state = HostContentState::from_repository(repository);
        let bytes = build_texture_pixels_response(
            &state.runtime,
            LoadTexturePixelsRequest {
                kind: "prepared-texture-surface".to_string(),
                purpose: "terrain-color".to_string(),
                source_asset_id: "surface-texture/0x05000001".to_string(),
            },
        )
        .await
        .expect("texture pixels should load through the content runtime");

        assert_eq!(&bytes[..4], TEXTURE_PIXELS_BINARY_MAGIC);
        let manifest_length = u32::from_le_bytes(bytes[8..12].try_into().unwrap()) as usize;
        let section_data_offset = TERRAIN_SOURCE_BINARY_HEADER_LEN + manifest_length;
        let manifest: serde_json::Value =
            serde_json::from_slice(&bytes[TERRAIN_SOURCE_BINARY_HEADER_LEN..section_data_offset])
                .expect("response manifest should decode");
        assert_eq!(manifest["surface"]["format"], "rgba8");
        assert_eq!(
            &bytes[section_data_offset..section_data_offset + 4],
            &[3, 2, 1, 4]
        );
    }

    fn test_surface_texture_bytes(id: u32, render_surface_ids: &[u32]) -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend(id.to_le_bytes());
        bytes.extend(0i32.to_le_bytes());
        bytes.push(1);
        bytes.extend(
            u32::try_from(render_surface_ids.len())
                .unwrap()
                .to_le_bytes(),
        );
        for render_surface_id in render_surface_ids {
            bytes.extend(render_surface_id.to_le_bytes());
        }
        bytes
    }

    fn test_render_surface_bytes(id: u32, format: PixelFormatId, source_data: &[u8]) -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend(id.to_le_bytes());
        bytes.extend(0i32.to_le_bytes());
        bytes.extend(2u32.to_le_bytes());
        bytes.extend(2u32.to_le_bytes());
        bytes.extend(format.raw().to_le_bytes());
        bytes.extend(u32::try_from(source_data.len()).unwrap().to_le_bytes());
        bytes.extend(source_data);
        bytes
    }
}
