use std::io::Cursor;

use anyhow::{Context, Result, anyhow};
use holtburger_dat::file_type::{
    AnimationPartChange, CSurface, CSurfaceSource, ClothingBuildObjDescError, ClothingTable,
    EnvCell, GfxObj, ObjDesc, Palette, PaletteSet, REGION_DESC_FILE_ID, RegionDesc, RenderSurface,
    SetupModel, SubPalette, SurfaceTexture, SurfaceType, TextureMapChange,
};
use holtburger_dat::{EOR_CELL_NAMESPACE, EOR_PORTAL_NAMESPACE, ResourceKey};

use crate::{
    ContentRepository, ResolvedSurfaceTexturePixels, TexturePixelFormat,
    texture_pixels::decode_render_surface_pixels,
};

const REGION_DETAIL_ROLE_ORDER: [ResolvedRegionDetailRoleKind; 4] = [
    ResolvedRegionDetailRoleKind::Landscape,
    ResolvedRegionDetailRoleKind::Building,
    ResolvedRegionDetailRoleKind::Environment,
    ResolvedRegionDetailRoleKind::Object,
];

#[derive(Clone, Debug, PartialEq)]
pub struct ResolvedMaterialSlot {
    pub slot_index: usize,
    pub material: ResolvedMaterialRecipe,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ResolvedMaterialRecipe {
    pub surface_id: u32,
    pub surface_type: SurfaceType,
    pub source: ResolvedMaterialSource,
    pub translucency: f32,
    pub luminosity: f32,
    pub diffuse: f32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ResolvedMaterialSource {
    SolidColor(u32),
    Texture(ResolvedTextureMaterial),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ResolvedTextureMaterial {
    pub surface_texture_id: u32,
    pub render_surface_ids: Vec<u32>,
    pub palette_id: Option<u32>,
    pub render_surface_default_palette_ids: Vec<u32>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ResolvedSurfaceTexture {
    pub surface_texture_id: u32,
    pub texture_type: u8,
    pub unknown: i32,
    pub render_surface_ids: Vec<u32>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Hash)]
pub struct MaterialAppearanceInput {
    pub obj_desc: Option<ObjDesc>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ResolvedSetupAppearance {
    pub setup_model_id: u32,
    pub appearance_key: String,
    pub parts: Vec<ResolvedSetupAppearancePart>,
    pub material_asset_ids: Vec<u32>,
    pub palette_dependencies: Vec<u32>,
    pub texture_changes: Vec<ResolvedTextureChange>,
    pub anim_part_changes: Vec<ResolvedAnimationPartChange>,
    pub sub_palettes: Vec<SubPalette>,
    pub palette_id: Option<u32>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ResolvedSetupAppearancePart {
    pub part_index: usize,
    pub gfx_obj_id: u32,
    pub material_slots: Vec<ResolvedMaterialSlot>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ResolvedTextureChange {
    pub part_index: u8,
    pub old_texture: u32,
    pub new_texture: u32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ResolvedAnimationPartChange {
    pub part_index: u8,
    pub part_id: u32,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ResolvedTerrainMaterialTable {
    pub region_id: u32,
    pub region_number: u32,
    pub terrain_types: Vec<ResolvedTerrainMaterialType>,
    /// Ordered alpha maps selected for corner terrain-code combinations.
    pub corner_terrain_alpha_maps: Vec<ResolvedTerrainAlphaMap>,
    /// Ordered alpha maps selected for side terrain-code combinations.
    pub side_terrain_alpha_maps: Vec<ResolvedTerrainAlphaMap>,
    pub road_alpha_maps: Vec<ResolvedTerrainRoadAlphaMap>,
    pub surface_texture_ids: Vec<u32>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ResolvedRegionDetailRoleKind {
    Landscape,
    Building,
    Environment,
    Object,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ResolvedRegionDetailRole {
    pub role: ResolvedRegionDetailRoleKind,
    pub source_terrain_desc_index: usize,
    pub detail_texture_id: u32,
    pub detail_tiling: u32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ResolvedRegionRenderProfile {
    pub region_id: u32,
    pub region_number: u32,
    pub detail_roles: Vec<ResolvedRegionDetailRole>,
    pub surface_texture_ids: Vec<u32>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ResolvedTerrainMaterialType {
    pub terrain_type: u32,
    pub texture_id: u32,
    pub tiling: u32,
    pub min_vert_bright: u32,
    pub max_vert_bright: u32,
    pub min_vert_saturate: u32,
    pub max_vert_saturate: u32,
    pub min_vert_hue: u32,
    pub max_vert_hue: u32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ResolvedTerrainAlphaMap {
    pub selector: u32,
    pub texture_id: u32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ResolvedTerrainRoadAlphaMap {
    pub road_index: usize,
    pub selector: u32,
    pub road_texture_id: u32,
    pub alpha_texture_id: u32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ParsedRenderSurfaceDependency {
    pub render_surface: RenderSurface,
    pub default_palette: Option<Palette>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ParsedSurfaceTextureDependency {
    pub surface_texture: SurfaceTexture,
    pub render_surfaces: Vec<ParsedRenderSurfaceDependency>,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ParsedMaterialDependency {
    pub surface_id: u32,
    pub c_surface: CSurface,
    pub surface_texture: Option<ParsedSurfaceTextureDependency>,
    pub palette: Option<Palette>,
}

impl ContentRepository {
    pub fn build_clothing_obj_desc(
        &self,
        clothing_table_id: u32,
        setup_model_id: u32,
        palette_template_key: u32,
        shade: f64,
    ) -> Result<ObjDesc> {
        let clothing_table = read_clothing_table(self, clothing_table_id)?;
        clothing_table
            .build_obj_desc(
                setup_model_id,
                palette_template_key,
                shade,
                |palette_set_id, shade| {
                    let palette_set = read_palette_set_for_clothing(self, palette_set_id)?;
                    palette_set.palette_id_for_shade(shade).ok_or(
                        ClothingBuildObjDescError::InvalidPaletteShade {
                            palette_set_id,
                            shade,
                        },
                    )
                },
            )
            .with_context(|| {
                format!(
                    "failed to build ObjDesc from ClothingTable 0x{clothing_table_id:08X}, setup 0x{setup_model_id:08X}, palette template {palette_template_key}"
                )
            })
    }

    pub fn resolve_surface_texture(
        &self,
        surface_texture_id: u32,
    ) -> Result<ResolvedSurfaceTexture> {
        let dependency = read_surface_texture_dependency(self, surface_texture_id)?;
        Ok(ResolvedSurfaceTexture {
            surface_texture_id: dependency.surface_texture.id,
            texture_type: dependency.surface_texture.texture_type,
            unknown: dependency.surface_texture.unknown,
            render_surface_ids: dependency.surface_texture.render_surface_ids,
        })
    }

    /// Resolves a source texture's first available render-surface level into a declared encoding.
    ///
    /// `SurfaceTexture` IDs are ordered source-level alternatives. Missing or pruned levels are
    /// omitted while resolving the dependency graph, so this selects the first usable level rather
    /// than treating an absent preferred record as an unusable texture.
    pub fn resolve_surface_texture_pixels(
        &self,
        surface_texture_id: u32,
        output_format: TexturePixelFormat,
    ) -> Result<ResolvedSurfaceTexturePixels> {
        let dependency = read_surface_texture_dependency(self, surface_texture_id)?;
        let render_surface = dependency.render_surfaces.first().with_context(|| {
            format!(
                "SurfaceTexture 0x{surface_texture_id:08X} has no available RenderSurface levels"
            )
        })?;
        let pixels = decode_render_surface_pixels(&render_surface.render_surface, output_format)?;
        Ok(ResolvedSurfaceTexturePixels {
            surface_texture_id: dependency.surface_texture.id,
            render_surface_id: render_surface.render_surface.id,
            format: output_format,
            width: render_surface.render_surface.width,
            height: render_surface.render_surface.height,
            pixels,
        })
    }

    pub fn resolve_gfx_obj_material_slots(
        &self,
        gfx_obj_id: u32,
    ) -> Result<Vec<ResolvedMaterialSlot>> {
        let resource = self
            .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, gfx_obj_id))
            .with_context(|| format!("failed to read GfxObj 0x{gfx_obj_id:08X}"))?;
        let gfx_obj = GfxObj::unpack(&mut Cursor::new(resource.bytes))
            .with_context(|| format!("failed to parse GfxObj 0x{gfx_obj_id:08X}"))?;

        self.resolve_material_slots(gfx_obj.surfaces)
            .with_context(|| format!("failed to resolve GfxObj 0x{gfx_obj_id:08X} materials"))
    }

    pub fn resolve_env_cell_material_slots(
        &self,
        env_cell_id: u32,
    ) -> Result<Vec<ResolvedMaterialSlot>> {
        let resource = self
            .read_resource(ResourceKey::new(EOR_CELL_NAMESPACE, env_cell_id))
            .with_context(|| format!("failed to read EnvCell 0x{env_cell_id:08X}"))?;
        let env_cell = EnvCell::unpack(&mut Cursor::new(resource.bytes))
            .with_context(|| format!("failed to parse EnvCell 0x{env_cell_id:08X}"))?;

        self.resolve_material_slots(
            env_cell
                .surfaces
                .into_iter()
                .map(|surface_id| 0x0800_0000 | u32::from(surface_id)),
        )
        .with_context(|| format!("failed to resolve EnvCell 0x{env_cell_id:08X} materials"))
    }

    pub fn resolve_material_recipe(&self, surface_id: u32) -> Result<ResolvedMaterialRecipe> {
        let dependency = parse_material_dependency(self, surface_id)
            .with_context(|| format!("failed to resolve material 0x{surface_id:08X}"))?;
        material_recipe_from_dependency(self, dependency, None)
    }

    pub fn resolve_terrain_material_table(
        &self,
        region_number: u32,
    ) -> Result<ResolvedTerrainMaterialTable> {
        let region = self.read_region_desc_for_region(region_number)?;

        let terrain = region
            .terrain_info
            .as_ref()
            .context("active RegionDesc has no terrain payload")?;
        let tex_merge = terrain
            .land_surfaces
            .texture_merge()
            .context("active RegionDesc uses palette-shift terrain, which has no TexMerge table")?;
        let terrain_types = tex_merge
            .terrain_desc
            .iter()
            .map(|desc| ResolvedTerrainMaterialType {
                terrain_type: desc.terrain_type,
                texture_id: desc.terrain_tex.tex_gid,
                tiling: desc.terrain_tex.tex_tiling,
                min_vert_bright: desc.terrain_tex.min_vert_bright,
                max_vert_bright: desc.terrain_tex.max_vert_bright,
                min_vert_saturate: desc.terrain_tex.min_vert_saturate,
                max_vert_saturate: desc.terrain_tex.max_vert_saturate,
                min_vert_hue: desc.terrain_tex.min_vert_hue,
                max_vert_hue: desc.terrain_tex.max_vert_hue,
            })
            .collect::<Vec<_>>();
        let corner_terrain_alpha_maps = tex_merge
            .corner_terrain_maps
            .iter()
            .map(|map| ResolvedTerrainAlphaMap {
                selector: map.terrain_code,
                texture_id: map.tex_gid,
            })
            .collect::<Vec<_>>();
        let side_terrain_alpha_maps = tex_merge
            .side_terrain_maps
            .iter()
            .map(|map| ResolvedTerrainAlphaMap {
                selector: map.terrain_code,
                texture_id: map.tex_gid,
            })
            .collect::<Vec<_>>();
        let road_alpha_maps = tex_merge
            .road_maps
            .iter()
            .enumerate()
            .map(|(road_index, map)| ResolvedTerrainRoadAlphaMap {
                road_index,
                selector: map.road_code,
                road_texture_id: road_terrain_texture_id(&terrain_types),
                alpha_texture_id: map.road_tex_gid,
            })
            .collect::<Vec<_>>();
        let mut surface_texture_ids = terrain_types
            .iter()
            .map(|terrain| terrain.texture_id)
            .chain(
                corner_terrain_alpha_maps
                    .iter()
                    .chain(side_terrain_alpha_maps.iter())
                    .map(|map| map.texture_id),
            )
            .chain(
                road_alpha_maps
                    .iter()
                    .flat_map(|map| [map.road_texture_id, map.alpha_texture_id]),
            )
            .filter(|texture_id| *texture_id != 0)
            .collect::<Vec<_>>();
        surface_texture_ids.sort_unstable();
        surface_texture_ids.dedup();

        Ok(ResolvedTerrainMaterialTable {
            region_id: region.id,
            region_number: region.region_number,
            terrain_types,
            corner_terrain_alpha_maps,
            side_terrain_alpha_maps,
            road_alpha_maps,
            surface_texture_ids,
        })
    }

    pub fn resolve_region_render_profile(
        &self,
        region_number: u32,
    ) -> Result<ResolvedRegionRenderProfile> {
        let region = self.read_region_desc_for_region(region_number)?;
        let terrain = region
            .terrain_info
            .as_ref()
            .context("active RegionDesc has no terrain payload")?;
        let detail_roles = terrain
            .land_surfaces
            .texture_merge()
            .context("active RegionDesc uses palette-shift terrain, which has no TexMerge table")?
            .terrain_desc
            .iter()
            .take(REGION_DETAIL_ROLE_ORDER.len())
            .enumerate()
            .map(|(index, desc)| ResolvedRegionDetailRole {
                role: REGION_DETAIL_ROLE_ORDER[index],
                source_terrain_desc_index: index,
                detail_texture_id: desc.terrain_tex.detail_tex_gid,
                detail_tiling: desc.terrain_tex.detail_tex_tiling,
            })
            .collect::<Vec<_>>();
        let mut surface_texture_ids = detail_roles
            .iter()
            .map(|role| role.detail_texture_id)
            .filter(|texture_id| *texture_id != 0)
            .collect::<Vec<_>>();
        surface_texture_ids.sort_unstable();
        surface_texture_ids.dedup();

        Ok(ResolvedRegionRenderProfile {
            region_id: region.id,
            region_number: region.region_number,
            detail_roles,
            surface_texture_ids,
        })
    }

    fn read_region_desc_for_region(&self, region_number: u32) -> Result<RegionDesc> {
        let resource = self
            .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, REGION_DESC_FILE_ID))
            .with_context(|| format!("failed to read RegionDesc 0x{REGION_DESC_FILE_ID:08X}"))?;
        let region = RegionDesc::unpack(&resource.bytes)
            .with_context(|| format!("failed to parse RegionDesc 0x{REGION_DESC_FILE_ID:08X}"))?;
        if region.region_number != region_number {
            anyhow::bail!(
                "active RegionDesc 0x{REGION_DESC_FILE_ID:08X} has region number {}, not requested region {region_number}",
                region.region_number
            );
        }

        Ok(region)
    }

    pub fn resolve_setup_appearance(
        &self,
        setup_model_id: u32,
        input: MaterialAppearanceInput,
    ) -> Result<ResolvedSetupAppearance> {
        let resource = self
            .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, setup_model_id))
            .with_context(|| format!("failed to read SetupModel 0x{setup_model_id:08X}"))?;
        let setup_model = SetupModel::unpack(&mut Cursor::new(resource.bytes))
            .with_context(|| format!("failed to parse SetupModel 0x{setup_model_id:08X}"))?;

        let appearance = input.obj_desc.as_ref();
        let mut selected_parts = setup_model.parts.clone();
        if let Some(obj_desc) = appearance {
            for change in &obj_desc.anim_part_changes {
                if let Some(part) = selected_parts.get_mut(usize::from(change.part_index)) {
                    *part = change.part_id;
                }
            }
        }

        let mut parts = Vec::with_capacity(selected_parts.len());
        for (part_index, gfx_obj_id) in selected_parts.into_iter().enumerate() {
            let texture_changes = appearance
                .map(|obj_desc| texture_changes_for_part(&obj_desc.texture_changes, part_index))
                .unwrap_or_default();
            let material_slots = self
                .resolve_gfx_obj_material_slots_with_texture_changes(gfx_obj_id, &texture_changes)
                .with_context(|| {
                    format!(
                        "failed to resolve setup 0x{setup_model_id:08X} part {part_index} materials"
                    )
                })?;

            parts.push(ResolvedSetupAppearancePart {
                part_index,
                gfx_obj_id,
                material_slots,
            });
        }

        let mut material_asset_ids = collect_setup_material_asset_ids(&parts);
        let mut palette_dependencies = collect_setup_palette_dependencies(&parts);
        if let Some(obj_desc) = appearance {
            if let Some(palette_id) = obj_desc.palette_id {
                palette_dependencies.push(palette_id);
            }
            palette_dependencies.extend(obj_desc.sub_palettes.iter().map(|sub| sub.sub_id));
        }
        material_asset_ids.sort_unstable();
        material_asset_ids.dedup();
        palette_dependencies.sort_unstable();
        palette_dependencies.dedup();

        Ok(ResolvedSetupAppearance {
            setup_model_id,
            appearance_key: build_setup_appearance_key(setup_model_id, appearance),
            parts,
            material_asset_ids,
            palette_dependencies,
            texture_changes: appearance
                .map(|obj_desc| {
                    obj_desc
                        .texture_changes
                        .iter()
                        .map(resolved_texture_change)
                        .collect()
                })
                .unwrap_or_default(),
            anim_part_changes: appearance
                .map(|obj_desc| {
                    obj_desc
                        .anim_part_changes
                        .iter()
                        .map(resolved_anim_part_change)
                        .collect()
                })
                .unwrap_or_default(),
            sub_palettes: appearance
                .map(|obj_desc| obj_desc.sub_palettes.clone())
                .unwrap_or_default(),
            palette_id: appearance.and_then(|obj_desc| obj_desc.palette_id),
        })
    }

    fn resolve_material_slots(
        &self,
        surface_ids: impl IntoIterator<Item = u32>,
    ) -> Result<Vec<ResolvedMaterialSlot>> {
        surface_ids
            .into_iter()
            .enumerate()
            .map(|(slot_index, surface_id)| {
                Ok(ResolvedMaterialSlot {
                    slot_index,
                    material: self.resolve_material_recipe(surface_id)?,
                })
            })
            .collect()
    }

    fn resolve_gfx_obj_material_slots_with_texture_changes(
        &self,
        gfx_obj_id: u32,
        texture_changes: &[TextureMapChange],
    ) -> Result<Vec<ResolvedMaterialSlot>> {
        let resource = self
            .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, gfx_obj_id))
            .with_context(|| format!("failed to read GfxObj 0x{gfx_obj_id:08X}"))?;
        let gfx_obj = GfxObj::unpack(&mut Cursor::new(resource.bytes))
            .with_context(|| format!("failed to parse GfxObj 0x{gfx_obj_id:08X}"))?;

        gfx_obj
            .surfaces
            .into_iter()
            .enumerate()
            .map(|(slot_index, surface_id)| {
                let dependency = parse_material_dependency(self, surface_id)
                    .with_context(|| format!("failed to resolve material 0x{surface_id:08X}"))?;
                let texture_override = texture_override_for_material(&dependency, texture_changes);
                Ok(ResolvedMaterialSlot {
                    slot_index,
                    material: material_recipe_from_dependency(self, dependency, texture_override)?,
                })
            })
            .collect()
    }
}

fn read_clothing_table(
    content: &ContentRepository,
    clothing_table_id: u32,
) -> Result<ClothingTable> {
    let resource = read_available_resource(content, EOR_PORTAL_NAMESPACE, clothing_table_id)?;
    ClothingTable::unpack(&mut Cursor::new(resource.bytes))
        .with_context(|| format!("failed to parse ClothingTable 0x{clothing_table_id:08X}"))
}

fn read_palette_set_for_clothing(
    content: &ContentRepository,
    palette_set_id: u32,
) -> Result<PaletteSet, ClothingBuildObjDescError> {
    let resource = read_available_resource(content, EOR_PORTAL_NAMESPACE, palette_set_id)
        .map_err(|_| ClothingBuildObjDescError::MissingPaletteSet { palette_set_id })?;
    PaletteSet::unpack(&mut Cursor::new(resource.bytes)).map_err(|error| {
        ClothingBuildObjDescError::InvalidPaletteSet {
            palette_set_id,
            message: error.to_string(),
        }
    })
}

fn road_terrain_texture_id(terrain_types: &[ResolvedTerrainMaterialType]) -> u32 {
    terrain_types
        .iter()
        .find(|terrain| terrain.terrain_type == 0x20)
        .or_else(|| terrain_types.first())
        .map(|terrain| terrain.texture_id)
        .unwrap_or(0)
}

pub(crate) fn parse_material_dependency(
    content: &ContentRepository,
    surface_id: u32,
) -> Result<ParsedMaterialDependency> {
    let c_surface = read_c_surface(content, surface_id)?;
    let (surface_texture, palette) = match &c_surface.source {
        CSurfaceSource::SolidColor(_) => (None, None),
        CSurfaceSource::Texture {
            orig_texture_id,
            orig_palette_id,
        } => {
            let surface_texture = read_surface_texture_dependency(content, *orig_texture_id)?;
            let palette = if *orig_palette_id == 0 {
                None
            } else {
                Some(read_palette(content, *orig_palette_id)?)
            };
            (Some(surface_texture), palette)
        }
    };

    Ok(ParsedMaterialDependency {
        surface_id,
        c_surface,
        surface_texture,
        palette,
    })
}

fn read_c_surface(content: &ContentRepository, surface_id: u32) -> Result<CSurface> {
    let resource = read_available_resource(content, EOR_PORTAL_NAMESPACE, surface_id)?;
    CSurface::unpack(&mut Cursor::new(resource.bytes))
        .with_context(|| format!("failed to parse CSurface 0x{surface_id:08X}"))
}

fn read_surface_texture_dependency(
    content: &ContentRepository,
    surface_texture_id: u32,
) -> Result<ParsedSurfaceTextureDependency> {
    let resource = read_available_resource(content, EOR_PORTAL_NAMESPACE, surface_texture_id)?;
    let surface_texture = SurfaceTexture::unpack(&mut Cursor::new(resource.bytes))
        .with_context(|| format!("failed to parse SurfaceTexture 0x{surface_texture_id:08X}"))?;

    let mut render_surfaces = Vec::with_capacity(surface_texture.render_surface_ids.len());
    for render_surface_id in &surface_texture.render_surface_ids {
        match read_render_surface_dependency(content, *render_surface_id) {
            Ok(render_surface) => render_surfaces.push(render_surface),
            Err(error) if is_missing_or_pruned_resource_error(&error) => {}
            Err(error) => return Err(error),
        }
    }

    Ok(ParsedSurfaceTextureDependency {
        surface_texture,
        render_surfaces,
    })
}

fn read_render_surface_dependency(
    content: &ContentRepository,
    render_surface_id: u32,
) -> Result<ParsedRenderSurfaceDependency> {
    let resource = read_available_resource(content, EOR_PORTAL_NAMESPACE, render_surface_id)?;
    let render_surface = RenderSurface::unpack(&mut Cursor::new(resource.bytes))
        .with_context(|| format!("failed to parse RenderSurface 0x{render_surface_id:08X}"))?;
    let default_palette = match render_surface.default_palette_id {
        Some(palette_id) => Some(read_palette(content, palette_id)?),
        None => None,
    };

    Ok(ParsedRenderSurfaceDependency {
        render_surface,
        default_palette,
    })
}

fn read_palette(content: &ContentRepository, palette_id: u32) -> Result<Palette> {
    let resource = read_available_resource(content, EOR_PORTAL_NAMESPACE, palette_id)?;
    Palette::unpack(&mut Cursor::new(resource.bytes))
        .with_context(|| format!("failed to parse Palette 0x{palette_id:08X}"))
}

fn read_available_resource(
    content: &ContentRepository,
    namespace: &'static str,
    file_id: u32,
) -> Result<crate::repository::RepositoryResource> {
    let key = ResourceKey::new(namespace, file_id);
    let metadata = content
        .resource_metadata(key)
        .ok_or_else(|| anyhow!("missing resource {namespace}:0x{file_id:08X}"))?;
    if metadata.is_pruned {
        return Err(anyhow!("resource {namespace}:0x{file_id:08X} is pruned"));
    }

    content
        .read_resource(key)
        .with_context(|| format!("failed to read {namespace}:0x{file_id:08X}"))
}

fn is_missing_or_pruned_resource_error(error: &anyhow::Error) -> bool {
    let detail = format!("{error:#}");
    detail.contains("missing resource ") || detail.contains(" is pruned")
}

fn material_recipe_from_dependency(
    content: &ContentRepository,
    dependency: ParsedMaterialDependency,
    texture_override: Option<u32>,
) -> Result<ResolvedMaterialRecipe> {
    let source = match dependency.c_surface.source {
        CSurfaceSource::SolidColor(color) => ResolvedMaterialSource::SolidColor(color),
        CSurfaceSource::Texture {
            orig_texture_id,
            orig_palette_id,
        } => {
            let surface_texture_id = texture_override.unwrap_or(orig_texture_id);
            let surface_texture = if surface_texture_id == orig_texture_id {
                dependency
                    .surface_texture
                    .expect("textured material dependency should contain a surface texture")
            } else {
                read_surface_texture_dependency(content, surface_texture_id)?
            };
            let render_surface_default_palette_ids = surface_texture
                .render_surfaces
                .iter()
                .filter_map(|dependency| dependency.render_surface.default_palette_id)
                .collect();

            ResolvedMaterialSource::Texture(ResolvedTextureMaterial {
                surface_texture_id,
                render_surface_ids: surface_texture.surface_texture.render_surface_ids,
                palette_id: (orig_palette_id != 0).then_some(orig_palette_id),
                render_surface_default_palette_ids,
            })
        }
    };

    Ok(ResolvedMaterialRecipe {
        surface_id: dependency.surface_id,
        surface_type: dependency.c_surface.surface_type,
        source,
        translucency: dependency.c_surface.translucency,
        luminosity: dependency.c_surface.luminosity,
        diffuse: dependency.c_surface.diffuse,
    })
}

fn texture_override_for_material(
    dependency: &ParsedMaterialDependency,
    texture_changes: &[TextureMapChange],
) -> Option<u32> {
    let CSurfaceSource::Texture {
        orig_texture_id, ..
    } = dependency.c_surface.source
    else {
        return None;
    };

    // Last match wins. Layered clothing appends one change list per garment in paint order, and a
    // lower layer commonly restores the body texture with an identity change that a higher layer
    // then covers; taking the first match would let that identity shadow the garment above it and
    // render bare skin under clothing. Retail applies the changes sequentially, so the final write
    // is what shows.
    texture_changes
        .iter()
        .rev()
        .find(|change| change.old_texture == orig_texture_id)
        .map(|change| change.new_texture)
}

fn texture_changes_for_part(
    texture_changes: &[TextureMapChange],
    part_index: usize,
) -> Vec<TextureMapChange> {
    texture_changes
        .iter()
        .filter(|change| usize::from(change.part_index) == part_index)
        .cloned()
        .collect()
}

fn collect_setup_material_asset_ids(parts: &[ResolvedSetupAppearancePart]) -> Vec<u32> {
    parts
        .iter()
        .flat_map(|part| part.material_slots.iter())
        .map(|slot| slot.material.surface_id)
        .collect()
}

fn collect_setup_palette_dependencies(parts: &[ResolvedSetupAppearancePart]) -> Vec<u32> {
    parts
        .iter()
        .flat_map(|part| part.material_slots.iter())
        .flat_map(|slot| match &slot.material.source {
            ResolvedMaterialSource::SolidColor(_) => Vec::new(),
            ResolvedMaterialSource::Texture(texture) => texture
                .palette_id
                .into_iter()
                .chain(texture.render_surface_default_palette_ids.iter().copied())
                .collect(),
        })
        .collect()
}

fn resolved_texture_change(change: &TextureMapChange) -> ResolvedTextureChange {
    ResolvedTextureChange {
        part_index: change.part_index,
        old_texture: change.old_texture,
        new_texture: change.new_texture,
    }
}

fn resolved_anim_part_change(change: &AnimationPartChange) -> ResolvedAnimationPartChange {
    ResolvedAnimationPartChange {
        part_index: change.part_index,
        part_id: change.part_id,
    }
}

fn build_setup_appearance_key(setup_model_id: u32, obj_desc: Option<&ObjDesc>) -> String {
    let Some(obj_desc) = obj_desc else {
        return format!("setup:0x{setup_model_id:08X}|base");
    };

    let palette = obj_desc
        .palette_id
        .map(|palette_id| format!("pal=0x{palette_id:08X}"))
        .unwrap_or_else(|| "pal=none".to_string());
    let sub_palettes = obj_desc
        .sub_palettes
        .iter()
        .map(|sub| format!("{}:{:08X}:{:08X}", sub.sub_id, sub.offset, sub.num_colors))
        .collect::<Vec<_>>()
        .join(",");
    let texture_changes = obj_desc
        .texture_changes
        .iter()
        .map(|change| {
            format!(
                "{}:{:08X}->{:08X}",
                change.part_index, change.old_texture, change.new_texture
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    let anim_changes = obj_desc
        .anim_part_changes
        .iter()
        .map(|change| format!("{}:{:08X}", change.part_index, change.part_id))
        .collect::<Vec<_>>()
        .join(",");

    format!(
        "setup:0x{setup_model_id:08X}|{palette}|sub=[{sub_palettes}]|tex=[{texture_changes}]|anim=[{anim_changes}]"
    )
}

#[cfg(test)]
mod texture_override_tests {
    use super::*;

    fn change(old_texture: u32, new_texture: u32) -> TextureMapChange {
        TextureMapChange {
            part_index: 0,
            old_texture,
            new_texture,
        }
    }

    fn textured(orig_texture_id: u32) -> ParsedMaterialDependency {
        ParsedMaterialDependency {
            surface_id: 0x0800_0001,
            c_surface: CSurface {
                surface_type: SurfaceType::BASE1_IMAGE,
                source: CSurfaceSource::Texture {
                    orig_texture_id,
                    orig_palette_id: 0,
                },
                translucency: 0.0,
                luminosity: 0.0,
                diffuse: 0.0,
            },
            surface_texture: None,
            palette: None,
        }
    }

    /// Layered clothing appends one change list per garment in paint order. A lower layer often
    /// restores the body texture with an identity change that a higher layer then covers, so the
    /// final write must win; taking the first match rendered bare skin under clothing.
    #[test]
    fn the_last_matching_texture_change_wins() {
        let changes = [
            change(0x0500_0BB0, 0x0500_0BB0),
            change(0x0500_0BB0, 0x0500_025D),
        ];

        let selected = texture_override_for_material(&textured(0x0500_0BB0), &changes);

        assert_eq!(selected, Some(0x0500_025D));
    }

    #[test]
    fn an_unmatched_texture_change_leaves_the_material_alone() {
        let changes = [change(0x0500_0001, 0x0500_0002)];

        assert_eq!(
            texture_override_for_material(&textured(0x0500_0BB0), &changes),
            None
        );
    }
}
