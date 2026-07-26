use std::collections::BTreeMap;

use anyhow::{Context, Result};
use holtburger_content::{
    LEGACY_SAMPLER_REPEAT_MATERIAL_VARIANT_SIGNATURE, PreparedPolygonRenderSideKind,
    ResolvedMaterialRecipe, ResolvedMaterialSource, build_gfx_obj_render_geometry,
};
use holtburger_core::{ContentAsset, ContentAssetRequest, ContentAssetRuntime};
use serde::Serialize;
use serde_json::{Value, json};

pub(crate) const OUTDOOR_STATIC_RECORD_BINARY_MAGIC: &[u8; 4] = b"HBSO";
pub(crate) const OUTDOOR_STATIC_RECORD_BINARY_VERSION: u32 = 1;
const OUTDOOR_STATIC_RECORD_BINARY_HEADER_LEN: usize = 16;

/// Closed source data for one outdoor static layer before it crosses the app boundary.
#[derive(Default)]
pub(crate) struct OutdoorStaticSourceClosure {
    pub(crate) buffers: OutdoorStaticGeometryBuffers,
    pub(crate) definitions: Vec<Value>,
    definition_ids: BTreeMap<u32, String>,
    pub(crate) geometries: Vec<Value>,
    geometry_ids: BTreeMap<u32, String>,
    pub(crate) materials: BTreeMap<String, Value>,
    pub(crate) texture_dependencies: BTreeMap<String, Value>,
}

impl OutdoorStaticSourceClosure {
    pub(crate) async fn add_resident(
        &mut self,
        runtime: &ContentAssetRuntime,
        member: &holtburger_content::LandblockOutdoorStaticMember,
    ) -> Result<String> {
        let source_did = member.instance.source_did;
        match source_did >> 24 {
            0x01 => self.add_gfx_object_definition(runtime, source_did).await,
            0x02 => self.add_setup_model_definition(runtime, source_did).await,
            family => anyhow::bail!(
                "outdoor static {} has unsupported render source family 0x{family:02X} ({})",
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
            self.buffers.material_wrap_modes.push(
                (triangle.material_variant_signature
                    == LEGACY_SAMPLER_REPEAT_MATERIAL_VARIANT_SIGNATURE) as u8,
            );
            self.buffers
                .material_side_kinds
                .push(material_side_kind(triangle.side_kind));
            self.buffers
                .material_side_types
                .push(material_side_type(triangle.sides_type)?);
            self.buffers.material_stippling.push(triangle.stippling);
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
            "materialWrapModeOffset": material_slot_offset,
            "materialWrapModeCount": self.buffers.material_wrap_modes.len() - material_slot_offset,
            "materialSideKindOffset": material_slot_offset,
            "materialSideKindCount": self.buffers.material_side_kinds.len() - material_slot_offset,
            "materialSideTypeOffset": material_slot_offset,
            "materialSideTypeCount": self.buffers.material_side_types.len() - material_slot_offset,
            "materialStipplingOffset": material_slot_offset,
            "materialStipplingCount": self.buffers.material_stippling.len() - material_slot_offset,
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
                    .insert(id.clone(), material_recipe_json(runtime, &recipe).await?);
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

    pub(crate) fn sections(&self) -> Vec<OutdoorStaticBinarySectionManifest> {
        self.buffers.sections()
    }

    pub(crate) fn validate(&self) -> Result<()> {
        if self.geometries.iter().any(|geometry| !geometry.is_object()) {
            anyhow::bail!("outdoor static geometry manifest contains a non-object record");
        }
        Ok(())
    }
}

#[derive(Default)]
pub(crate) struct OutdoorStaticGeometryBuffers {
    pub(crate) positions: Vec<f32>,
    pub(crate) normals: Vec<f32>,
    pub(crate) texture_coordinates: Vec<f32>,
    pub(crate) indices: Vec<u32>,
    pub(crate) material_slots: Vec<u16>,
    /// One clamp/repeat fact for each prepared triangle material slot.
    pub(crate) material_wrap_modes: Vec<u8>,
    /// Source polygon side identity for each prepared triangle material slot.
    pub(crate) material_side_kinds: Vec<u8>,
    /// Authored polygon culling mode for each prepared triangle material slot.
    pub(crate) material_side_types: Vec<u8>,
    /// Raw authored stippling flags for each prepared triangle material slot.
    pub(crate) material_stippling: Vec<u8>,
}

impl OutdoorStaticGeometryBuffers {
    pub(crate) fn sections(&self) -> Vec<OutdoorStaticBinarySectionManifest> {
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
            ("materialWrapModes", "u8", self.material_wrap_modes.len(), 1),
            ("materialSideKinds", "u8", self.material_side_kinds.len(), 1),
            ("materialSideTypes", "u8", self.material_side_types.len(), 1),
            ("materialStippling", "u8", self.material_stippling.len(), 1),
        ] {
            byte_offset = align_binary_section_offset(byte_offset, alignment);
            let byte_length = element_count * scalar_size(scalar_type);
            sections.push(OutdoorStaticBinarySectionManifest {
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
                "materialWrapModes" => target.copy_from_slice(&self.material_wrap_modes),
                "materialSideKinds" => target.copy_from_slice(&self.material_side_kinds),
                "materialSideTypes" => target.copy_from_slice(&self.material_side_types),
                "materialStippling" => target.copy_from_slice(&self.material_stippling),
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
        "u8" => 1,
        _ => unreachable!("building scalar types are fixed"),
    }
}

fn material_side_kind(side: PreparedPolygonRenderSideKind) -> u8 {
    match side {
        PreparedPolygonRenderSideKind::Positive => 0,
        PreparedPolygonRenderSideKind::PositiveReversed => 1,
        PreparedPolygonRenderSideKind::Negative => 2,
    }
}

fn material_side_type(sides_type: i32) -> Result<u8> {
    match sides_type {
        0..=3 => Ok(sides_type as u8),
        _ => anyhow::bail!("polygon has unsupported culling mode {sides_type}"),
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

async fn material_recipe_json(
    runtime: &ContentAssetRuntime,
    recipe: &ResolvedMaterialRecipe,
) -> Result<Value> {
    let source = match &recipe.source {
        ResolvedMaterialSource::SolidColor(color) => {
            json!({ "kind": "solid-color", "color": color })
        }
        ResolvedMaterialSource::Texture(texture) => {
            let mut selected = None;
            for render_surface_id in &texture.render_surface_ids {
                if let Ok(ContentAsset::RenderSurface(surface)) = runtime
                    .load(ContentAssetRequest::RenderSurface(*render_surface_id))
                    .await
                {
                    selected = Some(json!({
                        "id": dat_id(surface.id),
                        "format": render_surface_format_name(surface.format),
                    }));
                    break;
                }
            }
            let selected = selected.with_context(|| {
                format!(
                    "material 0x{:08X} texture 0x{:08X} has no available RenderSurface level",
                    recipe.surface_id, texture.surface_texture_id
                )
            })?;
            json!({
                "kind": "texture",
                "surfaceTextureId": dat_id(texture.surface_texture_id),
                "paletteId": texture.palette_id.map(dat_id),
                "renderSurfaceIds": texture.render_surface_ids.iter().copied().map(dat_id).collect::<Vec<_>>(),
                "defaultPaletteIds": texture.render_surface_default_palette_ids.iter().copied().map(dat_id).collect::<Vec<_>>(),
                "selectedRenderSurface": selected,
            })
        }
    };
    Ok(json!({
        "id": format!("surface/{:08x}", recipe.surface_id),
        "rawSurfaceFlags": recipe.surface_type.bits(),
        "translucency": recipe.translucency,
        "luminosity": recipe.luminosity,
        "diffuseScale": recipe.diffuse,
        "source": source,
    }))
}

fn render_surface_format_name(format: holtburger_dat::file_type::PixelFormatId) -> &'static str {
    match format {
        holtburger_dat::file_type::PixelFormatId::R8G8B8 => "r8g8b8",
        holtburger_dat::file_type::PixelFormatId::A8R8G8B8 => "a8r8g8b8",
        holtburger_dat::file_type::PixelFormatId::X8R8G8B8 => "x8r8g8b8",
        holtburger_dat::file_type::PixelFormatId::R5G6B5 => "r5g6b5",
        holtburger_dat::file_type::PixelFormatId::A4R4G4B4 => "a4r4g4b4",
        holtburger_dat::file_type::PixelFormatId::A8 => "a8",
        holtburger_dat::file_type::PixelFormatId::P8 => "index8",
        holtburger_dat::file_type::PixelFormatId::Index16 => "index16",
        holtburger_dat::file_type::PixelFormatId::Dxt1 => "dxt1",
        holtburger_dat::file_type::PixelFormatId::Dxt3 => "dxt3",
        holtburger_dat::file_type::PixelFormatId::Dxt5 => "dxt5",
        _ => "unsupported",
    }
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

pub(crate) fn frame_json(frame: &holtburger_dat::graphics::Frame) -> Value {
    json!({
        "origin": ac_vec3_json(&frame.origin),
        "orientation": [frame.orientation.w, frame.orientation.x, frame.orientation.y, frame.orientation.z],
    })
}

fn ac_vec3_json(vector: &holtburger_common::Vector3) -> Value {
    json!([vector.x, vector.y, vector.z])
}

pub(crate) fn prepared_vec3_json(vector: holtburger_content::PreparedVec3) -> Value {
    json!([vector.x, vector.y, vector.z])
}

fn unit_vec3_json() -> Value {
    json!([1.0, 1.0, 1.0])
}

pub(crate) fn prepared_aabb_json(bounds: &holtburger_content::PreparedAabb) -> Value {
    json!({
        "min": prepared_vec3_json(bounds.min),
        "max": prepared_vec3_json(bounds.max),
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OutdoorStaticSourceRecordManifest {
    pub(crate) transport: &'static str,
    pub(crate) version: u32,
    pub(crate) byte_order: &'static str,
    pub(crate) section_byte_offset_base: &'static str,
    pub(crate) landblock_id: String,
    /// Typed layer identity consumed by the record decoder and batch projection.
    pub(crate) layer: &'static str,
    pub(crate) residents: Vec<Value>,
    pub(crate) definitions: Vec<Value>,
    pub(crate) geometries: Vec<Value>,
    pub(crate) materials: Vec<Value>,
    pub(crate) texture_dependencies: Vec<Value>,
    pub(crate) sections: Vec<OutdoorStaticBinarySectionManifest>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OutdoorStaticBinarySectionManifest {
    name: String,
    scalar_type: &'static str,
    element_count: usize,
    byte_offset: usize,
    byte_length: usize,
}

pub(crate) fn serialize_outdoor_static_record_binary(
    manifest: &OutdoorStaticSourceRecordManifest,
    buffers: &OutdoorStaticGeometryBuffers,
) -> Result<Vec<u8>> {
    let mut manifest_bytes = serde_json::to_vec(manifest)?;
    while !(OUTDOOR_STATIC_RECORD_BINARY_HEADER_LEN + manifest_bytes.len()).is_multiple_of(4) {
        manifest_bytes.push(b' ');
    }
    let section_bytes = buffers.bytes();
    let total_length =
        OUTDOOR_STATIC_RECORD_BINARY_HEADER_LEN + manifest_bytes.len() + section_bytes.len();
    let mut bytes = Vec::with_capacity(total_length);
    bytes.extend(OUTDOOR_STATIC_RECORD_BINARY_MAGIC);
    bytes.extend(OUTDOOR_STATIC_RECORD_BINARY_VERSION.to_le_bytes());
    bytes.extend(u32::try_from(manifest_bytes.len())?.to_le_bytes());
    bytes.extend(u32::try_from(total_length)?.to_le_bytes());
    bytes.extend(manifest_bytes);
    bytes.extend(section_bytes);
    Ok(bytes)
}

fn dat_id(id: u32) -> String {
    format!("0x{id:08x}")
}

fn align_binary_section_offset(offset: usize, alignment: usize) -> usize {
    offset.next_multiple_of(alignment)
}
