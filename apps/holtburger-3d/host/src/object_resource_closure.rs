use std::collections::{BTreeMap, HashMap};

use anyhow::{Context, Result};
use holtburger_content::{
    ResolvedMaterialRecipe, ResolvedMaterialSlot, ResolvedMaterialSource, ResolvedPaletteComposite,
};
use holtburger_core::{
    ContentAsset, ContentAssetRequest, ContentAssetRuntime, SetupAppearanceRequest,
};
use holtburger_dat::file_type::{GfxObj, GfxObjDegradeInfo};
use serde_json::{Value, json};

use crate::{
    binary_source_record::BinarySectionWriter,
    gfx_obj_geometry::build_gfx_obj_geometry,
    polygon_geometry::{PolygonSideKind, SamplerWrapMode},
    source_projection::{dat_id, render_aabb_json},
};

/// Deduplicated geometry, material, and texture closure over a set of authored DAT sources.
///
/// Dispatches on DAT family — `0x01` GfxObj, `0x02` Setup — the way retail's
/// `CPhysicsObj::InitPartArrayObject` dispatches on `MasterDBMap::DivineType` (acclient.c:307951),
/// and shares one geometry buffer set across every source it is given. Outdoor statics, interior
/// EnvCells, and the celestial sky all project through it; nothing here is layer-scoped.
#[derive(Default)]
pub(crate) struct ObjectResourceClosure {
    pub(crate) buffers: StaticGeometryBuffers,
    pub(crate) definitions: Vec<Value>,
    gfx_definition_ids: BTreeMap<u32, String>,
    setup_definition_ids: HashMap<SetupAppearanceRequest, String>,
    pub(crate) geometries: Vec<Value>,
    geometry_ids: BTreeMap<u32, String>,
    retail_visibility: BTreeMap<u32, RetailGeometryVisibility>,
    pub(crate) materials: BTreeMap<String, Value>,
    pub(crate) texture_dependencies: BTreeMap<String, Value>,
}

/// Retail draw eligibility derived once from one GfxObj's authored degradation chain.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RetailGeometryVisibility {
    NormallyVisible,
    DegradeHidden,
}

impl RetailGeometryVisibility {
    fn manifest_name(self) -> &'static str {
        match self {
            Self::NormallyVisible => "normally-visible",
            Self::DegradeHidden => "degrade-hidden",
        }
    }
}

impl ObjectResourceClosure {
    pub(crate) async fn add_resident(
        &mut self,
        runtime: &ContentAssetRuntime,
        source_did: u32,
    ) -> Result<String> {
        match source_did >> 24 {
            0x01 => self.add_gfx_object_definition(runtime, source_did).await,
            0x02 => self.add_setup_model_definition(runtime, source_did).await,
            family => anyhow::bail!(
                "object source 0x{source_did:08X} has unsupported render source family 0x{family:02X}"
            ),
        }
    }

    async fn add_gfx_object_definition(
        &mut self,
        runtime: &ContentAssetRuntime,
        gfx_obj_id: u32,
    ) -> Result<String> {
        if let Some(existing) = self.gfx_definition_ids.get(&gfx_obj_id) {
            return Ok(existing.clone());
        }
        let asset = runtime
            .load(ContentAssetRequest::GfxObj(gfx_obj_id))
            .await?;
        let ContentAsset::GfxObj(gfx_obj) = asset else {
            unreachable!("GfxObj request must return a GfxObj")
        };
        let retail_visibility = self.retail_geometry_visibility(runtime, &gfx_obj).await?;
        let geometry_id = self.add_geometry(&gfx_obj)?;
        let material_ids = self.add_materials(runtime, &gfx_obj.surfaces).await?;
        let id = format!("gfx-obj/{gfx_obj_id:08x}");
        self.definitions.push(json!({
            "id": id,
            "kind": "gfx-obj",
            "appearanceKey": id,
            "sourceAssetId": id,
            "geometryId": geometry_id,
            "materialIds": material_ids,
            "retailVisibility": retail_visibility.manifest_name(),
        }));
        self.gfx_definition_ids.insert(gfx_obj_id, id.clone());
        Ok(id)
    }

    async fn add_setup_model_definition(
        &mut self,
        runtime: &ContentAssetRuntime,
        setup_model_id: u32,
    ) -> Result<String> {
        self.add_setup_model_appearance(runtime, SetupAppearanceRequest::base(setup_model_id))
            .await
    }

    /// Add one exact SetupModel appearance, sharing its resource closure with sibling definitions.
    pub(crate) async fn add_setup_model_appearance(
        &mut self,
        runtime: &ContentAssetRuntime,
        request: SetupAppearanceRequest,
    ) -> Result<String> {
        if let Some(existing) = self.setup_definition_ids.get(&request) {
            return Ok(existing.clone());
        }
        let setup_model_id = request.setup_model_id;
        let setup_asset = runtime
            .load(ContentAssetRequest::SetupModel(setup_model_id))
            .await?;
        let ContentAsset::SetupModel(setup_model) = setup_asset else {
            unreachable!("SetupModel request must return a SetupModel")
        };
        let appearance_asset = runtime
            .load(ContentAssetRequest::SetupAppearance(request.clone()))
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
        let mut parts = Vec::with_capacity(appearance.parts.len());
        for part in &appearance.parts {
            let gfx_asset = runtime
                .load(ContentAssetRequest::GfxObj(part.gfx_obj_id))
                .await?;
            let ContentAsset::GfxObj(gfx_obj) = gfx_asset else {
                unreachable!("GfxObj request must return a GfxObj")
            };
            let retail_visibility = self.retail_geometry_visibility(runtime, &gfx_obj).await?;
            let geometry_id = self.add_geometry(&gfx_obj)?;
            let material_ids = self
                .add_resolved_materials(runtime, &part.material_slots)
                .await?;
            parts.push(json!({
                "partIndex": part.part_index,
                "geometryId": geometry_id,
                "defaultScale": setup_model.default_scale.get(part.part_index).map(ac_vec3_json).unwrap_or_else(unit_vec3_json),
                "materialIds": material_ids,
                "retailVisibility": retail_visibility.manifest_name(),
            }));
        }
        let id = if request.appearance.obj_desc.is_none() {
            format!("setup-model/{setup_model_id:08x}")
        } else {
            format!(
                "setup-model/{setup_model_id:08x}/{}",
                appearance.appearance_key
            )
        };
        self.definitions.push(json!({
            "id": id,
            "kind": "setup-model",
            "appearanceKey": appearance.appearance_key,
            "setupId": dat_id(setup_model_id),
            "sourceAssetId": id,
            "parts": parts,
            "lights": setup_lights(&setup_model),
            "holdingLocations": setup_holding_locations(&setup_model)?,
            "placementFrames": setup_placement_frames(&setup_model),
            "defaultAnimationId": setup_model.default_animation.map(dat_id),
            "defaultMotionTableId": setup_model.default_motion_table.map(dat_id),
            "defaultScriptId": setup_model.default_script.map(dat_id),
            "defaultScriptTableId": setup_model.default_script_table.map(dat_id),
            "defaultSoundTableId": setup_model.default_sound_table.map(dat_id),
        }));
        self.setup_definition_ids.insert(request, id.clone());
        Ok(id)
    }

    async fn retail_geometry_visibility(
        &mut self,
        runtime: &ContentAssetRuntime,
        gfx_obj: &GfxObj,
    ) -> Result<RetailGeometryVisibility> {
        if let Some(visibility) = self.retail_visibility.get(&gfx_obj.id) {
            return Ok(*visibility);
        }
        let visibility = match gfx_obj.did_degrade {
            None => RetailGeometryVisibility::NormallyVisible,
            Some(degrade_id) => {
                let asset = runtime
                    .load(ContentAssetRequest::DegradeInfo(degrade_id))
                    .await?;
                let ContentAsset::DegradeInfo(info) = asset else {
                    unreachable!("DegradeInfo request must return degrade info")
                };
                classify_retail_geometry_visibility(gfx_obj.id, &info)
            }
        };
        self.retail_visibility.insert(gfx_obj.id, visibility);
        Ok(visibility)
    }

    fn add_geometry(&mut self, gfx_obj: &holtburger_dat::file_type::GfxObj) -> Result<String> {
        if let Some(existing) = self.geometry_ids.get(&gfx_obj.id) {
            return Ok(existing.clone());
        }
        let geometry = build_gfx_obj_geometry(gfx_obj)
            .with_context(|| format!("Could not prepare GfxObj 0x{:08X}", gfx_obj.id))?;
        let id = format!("geometry:gfx-obj/{:08x}", gfx_obj.id);
        self.geometries.push(append_static_geometry(
            &mut self.buffers,
            &geometry,
            &id,
            &format!("gfx-obj/{:08x}", gfx_obj.id),
        )?);
        self.geometry_ids.insert(gfx_obj.id, id.clone());
        Ok(id)
    }

    /// Serialize materials that appearance resolution already produced.
    ///
    /// The resolved recipe carries any ObjDesc texture substitution and palette composition, so
    /// re-loading it by surface id would silently discard the garment texture and render the base
    /// body instead. The cache key therefore includes both: one surface can appear substituted and
    /// unsubstituted, or recoloured and not, within a single closure.
    async fn add_resolved_materials(
        &mut self,
        runtime: &ContentAssetRuntime,
        slots: &[ResolvedMaterialSlot],
    ) -> Result<Vec<String>> {
        let mut ids = Vec::with_capacity(slots.len());
        for slot in slots {
            let recipe = &slot.material;
            let id = match &recipe.source {
                ResolvedMaterialSource::Texture(texture) => {
                    let palette = texture
                        .palette_composite
                        .as_ref()
                        .map(|composite| format!("/{}", composite.identity))
                        .unwrap_or_default();
                    format!(
                        "surface/{:08x}/texture/{:08x}{palette}",
                        recipe.surface_id, texture.surface_texture_id
                    )
                }
                ResolvedMaterialSource::SolidColor(_) => {
                    format!("surface/{:08x}", recipe.surface_id)
                }
            };
            if !self.materials.contains_key(&id) {
                self.materials.insert(
                    id.clone(),
                    material_recipe_json(runtime, &id, recipe).await?,
                );
                self.add_texture_dependencies(recipe);
            }
            ids.push(id);
        }
        Ok(ids)
    }

    pub(crate) async fn add_materials(
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
                self.materials.insert(
                    id.clone(),
                    material_recipe_json(runtime, &id, &recipe).await?,
                );
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
        for palette_id in texture.palette_id.into_iter().chain(
            texture
                .palette_composite
                .iter()
                .flat_map(|composite| composite.ranges.iter())
                .map(|range| range.replacement_palette_id),
        ) {
            self.texture_dependencies.insert(
                format!("palette/{palette_id:08x}"),
                json!({ "id": format!("palette/{palette_id:08x}"), "kind": "palette" }),
            );
        }
    }

    pub(crate) fn validate(&self) -> Result<()> {
        if self.geometries.iter().any(|geometry| !geometry.is_object()) {
            anyhow::bail!("object resource closure contains a non-object geometry record");
        }
        Ok(())
    }
}

/// Recognize the shipped-content sentinel chain that advances immediately from its real mesh to
/// a null draw. Retail uses `distance >= threshold` while selecting a band (acclient.c:319299), so
/// the all-zero first threshold advances even at distance zero; `CPhysicsPart::Draw` then skips the
/// null GfxObj (acclient.c:303122). The narrow shape covers 11 GfxObjs referenced by 920 setups and
/// 19,016 indoor part placements without pretending to implement general distance LOD.
fn classify_retail_geometry_visibility(
    gfx_obj_id: u32,
    info: &GfxObjDegradeInfo,
) -> RetailGeometryVisibility {
    let [near, hidden] = info.bands.as_slice() else {
        return RetailGeometryVisibility::NormallyVisible;
    };
    if near.gfx_obj_id == gfx_obj_id
        && near.min_distance == 0.0
        && near.ideal_distance == 0.0
        && near.max_distance == 0.0
        && hidden.gfx_obj_id == 0
    {
        RetailGeometryVisibility::DegradeHidden
    } else {
        RetailGeometryVisibility::NormallyVisible
    }
}

/// Append one already selected polygon set to shared static buffers and describe its ranges.
pub(crate) fn append_static_geometry(
    buffers: &mut StaticGeometryBuffers,
    geometry: &crate::polygon_geometry::PolygonSetGeometry,
    id: &str,
    source_asset_id: &str,
) -> Result<Value> {
    if geometry.positions.len() != geometry.vertex_count * 3
        || geometry.normals.len() != geometry.vertex_count * 3
        || geometry.texture_coordinates.len() != geometry.vertex_count * 2
    {
        anyhow::bail!("{source_asset_id} has inconsistent prepared geometry lengths");
    }
    let position_offset = buffers.positions.len();
    buffers.positions.extend_from_slice(&geometry.positions);
    let normal_offset = buffers.normals.len();
    buffers.normals.extend_from_slice(&geometry.normals);
    let texture_coordinate_offset = buffers.texture_coordinates.len();
    buffers
        .texture_coordinates
        .extend_from_slice(&geometry.texture_coordinates);
    let index_offset = buffers.indices.len();
    let material_slot_offset = buffers.material_slots.len();
    for triangle in &geometry.triangles {
        let slot = usize::try_from(triangle.authored_surface_index)
            .context("validated static geometry emitted a negative material slot")?;
        let first = u32::try_from(triangle.first_vertex)?;
        let end = first
            .checked_add(3)
            .context("triangle vertex range overflow")?;
        if usize::try_from(end)? > geometry.vertex_count {
            anyhow::bail!("{source_asset_id} triangle begins outside prepared vertex data");
        }
        buffers.indices.extend([first, first + 1, first + 2]);
        buffers.material_slots.push(u16::try_from(slot)?);
        buffers
            .material_wrap_modes
            .push((triangle.sampler_wrap == SamplerWrapMode::Repeat) as u8);
        buffers
            .material_side_kinds
            .push(material_side_kind(triangle.side_kind));
        buffers
            .material_side_types
            .push(material_side_type(triangle.sides_type)?);
        buffers.material_stippling.push(triangle.stippling);
    }
    Ok(json!({
        "id": id,
        "sourceAssetId": source_asset_id,
        "vertexCount": geometry.vertex_count,
        "positionOffset": position_offset,
        "normalOffset": normal_offset,
        "textureCoordinateOffset": texture_coordinate_offset,
        "indexOffset": index_offset,
        "indexCount": buffers.indices.len() - index_offset,
        "materialSlotOffset": material_slot_offset,
        "materialSlotCount": buffers.material_slots.len() - material_slot_offset,
        "materialWrapModeOffset": material_slot_offset,
        "materialWrapModeCount": buffers.material_wrap_modes.len() - material_slot_offset,
        "materialSideKindOffset": material_slot_offset,
        "materialSideKindCount": buffers.material_side_kinds.len() - material_slot_offset,
        "materialSideTypeOffset": material_slot_offset,
        "materialSideTypeCount": buffers.material_side_types.len() - material_slot_offset,
        "materialStipplingOffset": material_slot_offset,
        "materialStipplingCount": buffers.material_stippling.len() - material_slot_offset,
        "rejectedDegenerateTriangles": geometry.rejected_degenerate_triangles.iter().map(|triangle| json!({
            "polygonId": triangle.polygon_id,
            "sideKind": polygon_side_kind_name(triangle.side_kind),
            "fanTriangleIndex": triangle.fan_triangle_index,
        })).collect::<Vec<_>>(),
        "bounds": geometry.bounds.as_ref().map(render_aabb_json),
    }))
}

#[derive(Default)]
pub(crate) struct StaticGeometryBuffers {
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

impl StaticGeometryBuffers {
    /// Append this geometry family to a record-owned binary section writer.
    pub(crate) fn append_sections(
        &self,
        writer: &mut BinarySectionWriter,
        prefix: &str,
    ) -> Result<()> {
        writer.append_f32(
            geometry_section_name(prefix, "positions"),
            self.positions.iter().copied(),
        )?;
        writer.append_f32(
            geometry_section_name(prefix, "normals"),
            self.normals.iter().copied(),
        )?;
        writer.append_f32(
            geometry_section_name(prefix, "textureCoordinates"),
            self.texture_coordinates.iter().copied(),
        )?;
        writer.append_u32(
            geometry_section_name(prefix, "indices"),
            self.indices.iter().copied(),
        );
        writer.append_u16(
            geometry_section_name(prefix, "materialSlots"),
            self.material_slots.iter().copied(),
        );
        writer.append_u8(
            geometry_section_name(prefix, "materialWrapModes"),
            &self.material_wrap_modes,
        );
        writer.append_u8(
            geometry_section_name(prefix, "materialSideKinds"),
            &self.material_side_kinds,
        );
        writer.append_u8(
            geometry_section_name(prefix, "materialSideTypes"),
            &self.material_side_types,
        );
        writer.append_u8(
            geometry_section_name(prefix, "materialStippling"),
            &self.material_stippling,
        );
        Ok(())
    }
}

fn geometry_section_name(prefix: &str, name: &str) -> String {
    if prefix.is_empty() {
        return name.to_owned();
    }
    format!(
        "{prefix}{}{suffix}",
        name[..1].to_uppercase(),
        suffix = &name[1..]
    )
}

fn material_side_kind(side: PolygonSideKind) -> u8 {
    match side {
        PolygonSideKind::Positive => 0,
        PolygonSideKind::PositiveReversed => 1,
        PolygonSideKind::Negative => 2,
    }
}

fn polygon_side_kind_name(side: PolygonSideKind) -> &'static str {
    match side {
        PolygonSideKind::Positive => "positive",
        PolygonSideKind::PositiveReversed => "positive-reversed",
        PolygonSideKind::Negative => "negative",
    }
}

fn material_side_type(sides_type: i32) -> Result<u8> {
    match sides_type {
        0..=3 => Ok(sides_type as u8),
        _ => anyhow::bail!("polygon has unsupported culling mode {sides_type}"),
    }
}

async fn material_recipe_json(
    runtime: &ContentAssetRuntime,
    material_id: &str,
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
                "paletteComposite": texture.palette_composite.as_ref().map(palette_composite_json),
                "renderSurfaceIds": texture.render_surface_ids.iter().copied().map(dat_id).collect::<Vec<_>>(),
                "selectedRenderSurface": selected,
            })
        }
    };
    Ok(json!({
        "id": material_id,
        "rawSurfaceFlags": recipe.surface_type.bits(),
        "translucency": recipe.translucency,
        "luminosity": recipe.luminosity,
        "diffuseScale": recipe.diffuse,
        "source": source,
    }))
}

/// Serialize one palette composition: the identity its consumers key on, plus the recipe the
/// pixel request needs to materialize it. The identity is derived upstream and rides through here
/// unchanged, so nothing downstream re-derives it.
fn palette_composite_json(composite: &ResolvedPaletteComposite) -> Value {
    json!({
        "identity": composite.identity,
        "basePaletteId": dat_id(composite.base_palette_id),
        "ranges": composite.ranges.iter().map(|range| json!({
            "replacementPaletteId": dat_id(range.replacement_palette_id),
            "offset": range.offset,
            "colorCount": range.color_count,
        })).collect::<Vec<_>>(),
    })
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

/// Serialize the attach points a setup offers to child objects, ordered for stable output.
///
/// Retail treats an out-of-range attach part index as "use the object frame"
/// (`CPhysicsObj::UpdateChild`, `acclient.c:308302`). No setup in the retail archive relies on that
/// path, so an out-of-range index here means the source or the decode is wrong, not that a fallback
/// is wanted.
fn setup_holding_locations(setup_model: &holtburger_dat::file_type::SetupModel) -> Result<Value> {
    let mut locations: Vec<_> = setup_model.holding_locations.iter().collect();
    locations.sort_by_key(|(location, _)| **location);
    locations
        .into_iter()
        .map(|(location, attach)| {
            let part_index = usize::try_from(attach.part_index)
                .ok()
                .filter(|index| *index < setup_model.parts.len())
                .with_context(|| {
                    format!(
                        "SetupModel 0x{:08X} attach point {location} names part {} of {}",
                        setup_model.id,
                        attach.part_index,
                        setup_model.parts.len()
                    )
                })?;
            Ok(json!({
                "location": location,
                "partIndex": part_index,
                "frame": frame_json(&attach.frame),
            }))
        })
        .collect::<Result<Vec<_>>>()
        .map(Value::from)
}

/// Serialize every authored setup pose in stable enum order.
fn setup_placement_frames(setup_model: &holtburger_dat::file_type::SetupModel) -> Value {
    let mut placements = setup_model.placement_frames.iter().collect::<Vec<_>>();
    placements.sort_by_key(|(placement, _)| **placement);
    placements
        .into_iter()
        .map(|(placement, frame)| {
            json!({
                "placementId": *placement as u32,
                "frames": frame.anim_frame.frames.iter().map(frame_json).collect::<Vec<_>>(),
            })
        })
        .collect::<Vec<_>>()
        .into()
}

/// Authored setup lights in setup-local space; consumers compose them with a placement frame.
///
/// `lightType` and `coneAngle` ride through unread: every EoR asset authors type 0 (point) and
/// leaves `coneAngle` uninitialized, but the contract stays lossless for a future consumer.
fn setup_lights(setup_model: &holtburger_dat::file_type::SetupModel) -> Value {
    setup_model
        .lights
        .iter()
        .map(|light| {
            json!({
                "lightType": light.light_type,
                "offset": frame_json(&light.viewer_space_location),
                "color": light.color,
                "intensity": light.intensity,
                "falloff": light.falloff,
                "coneAngle": light.cone_angle,
            })
        })
        .collect::<Vec<_>>()
        .into()
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

fn unit_vec3_json() -> Value {
    json!([1.0, 1.0, 1.0])
}

#[cfg(test)]
mod tests {
    use holtburger_dat::file_type::{DegradeBand, DegradeOrientation, GfxObjDegradeInfo};

    use super::{RetailGeometryVisibility, classify_retail_geometry_visibility};

    const GFX_OBJ_ID: u32 = 0x0100_28CA;

    fn band(gfx_obj_id: u32, min: f32, ideal: f32, max: f32) -> DegradeBand {
        DegradeBand {
            gfx_obj_id,
            orientation: DegradeOrientation::Authored,
            min_distance: min,
            ideal_distance: ideal,
            max_distance: max,
        }
    }

    #[test]
    fn classifies_zero_distance_mesh_followed_by_null_as_degrade_hidden() {
        let info = GfxObjDegradeInfo {
            id: 0x1100_0118,
            bands: vec![band(GFX_OBJ_ID, 0.0, 0.0, 0.0), band(0, 0.0, 0.0, 0.0)],
        };

        assert_eq!(
            classify_retail_geometry_visibility(GFX_OBJ_ID, &info),
            RetailGeometryVisibility::DegradeHidden,
        );
    }

    #[test]
    fn leaves_general_distance_lod_normally_visible() {
        let info = GfxObjDegradeInfo {
            id: 0x1100_0118,
            bands: vec![
                band(GFX_OBJ_ID, 0.0, 32.0, 64.0),
                band(0x0100_28CB, 32.0, 64.0, 128.0),
            ],
        };

        assert_eq!(
            classify_retail_geometry_visibility(GFX_OBJ_ID, &info),
            RetailGeometryVisibility::NormallyVisible,
        );
    }

    #[test]
    fn leaves_unrecognized_zero_distance_chains_normally_visible() {
        let wrong_source = GfxObjDegradeInfo {
            id: 0x1100_0118,
            bands: vec![band(0x0100_28CB, 0.0, 0.0, 0.0), band(0, 0.0, 0.0, 0.0)],
        };
        let extra_band = GfxObjDegradeInfo {
            id: 0x1100_0119,
            bands: vec![
                band(GFX_OBJ_ID, 0.0, 0.0, 0.0),
                band(0, 0.0, 0.0, 0.0),
                band(0, 0.0, 0.0, 0.0),
            ],
        };

        assert_eq!(
            classify_retail_geometry_visibility(GFX_OBJ_ID, &wrong_source),
            RetailGeometryVisibility::NormallyVisible,
        );
        assert_eq!(
            classify_retail_geometry_visibility(GFX_OBJ_ID, &extra_band),
            RetailGeometryVisibility::NormallyVisible,
        );
    }
}
