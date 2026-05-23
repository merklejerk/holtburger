use std::io::Cursor;

use anyhow::{Context, Result, anyhow};
use holtburger_dat::file_type::{
    AnimationPartChange, CSurface, CSurfaceSource, EnvCell, GfxObj, ObjDesc, Palette,
    RenderSurface, RenderTexture, SetupModel, SubPalette, SurfaceType, TextureMapChange,
};
use holtburger_dat::{EOR_CELL_NAMESPACE, EOR_PORTAL_NAMESPACE, ResourceKey};

use crate::ContentRepository;

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
    pub render_texture_id: u32,
    pub render_surface_ids: Vec<u32>,
    pub palette_id: Option<u32>,
    pub render_surface_default_palette_ids: Vec<u32>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
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

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ParsedRenderSurfaceDependency {
    pub render_surface: RenderSurface,
    pub default_palette: Option<Palette>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ParsedRenderTextureDependency {
    pub render_texture: RenderTexture,
    pub render_surfaces: Vec<ParsedRenderSurfaceDependency>,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ParsedMaterialDependency {
    pub surface_id: u32,
    pub c_surface: CSurface,
    pub render_texture: Option<ParsedRenderTextureDependency>,
    pub palette: Option<Palette>,
}

impl ContentRepository {
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

pub(crate) fn parse_material_dependency(
    content: &ContentRepository,
    surface_id: u32,
) -> Result<ParsedMaterialDependency> {
    let c_surface = read_c_surface(content, surface_id)?;
    let (render_texture, palette) = match &c_surface.source {
        CSurfaceSource::SolidColor(_) => (None, None),
        CSurfaceSource::Texture {
            orig_texture_id,
            orig_palette_id,
        } => {
            let render_texture = read_render_texture_dependency(content, *orig_texture_id)?;
            let palette = if *orig_palette_id == 0 {
                None
            } else {
                Some(read_palette(content, *orig_palette_id)?)
            };
            (Some(render_texture), palette)
        }
    };

    Ok(ParsedMaterialDependency {
        surface_id,
        c_surface,
        render_texture,
        palette,
    })
}

fn read_c_surface(content: &ContentRepository, surface_id: u32) -> Result<CSurface> {
    let resource = read_available_resource(content, EOR_PORTAL_NAMESPACE, surface_id)?;
    CSurface::unpack(&mut Cursor::new(resource.bytes))
        .with_context(|| format!("failed to parse CSurface 0x{surface_id:08X}"))
}

fn read_render_texture_dependency(
    content: &ContentRepository,
    render_texture_id: u32,
) -> Result<ParsedRenderTextureDependency> {
    let resource = read_available_resource(content, EOR_PORTAL_NAMESPACE, render_texture_id)?;
    let render_texture = RenderTexture::unpack(&mut Cursor::new(resource.bytes))
        .with_context(|| format!("failed to parse RenderTexture 0x{render_texture_id:08X}"))?;

    let mut render_surfaces = Vec::with_capacity(render_texture.render_surface_ids.len());
    for render_surface_id in &render_texture.render_surface_ids {
        render_surfaces.push(read_render_surface_dependency(content, *render_surface_id)?);
    }

    Ok(ParsedRenderTextureDependency {
        render_texture,
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
            let render_texture_id = texture_override.unwrap_or(orig_texture_id);
            let render_texture = if render_texture_id == orig_texture_id {
                dependency
                    .render_texture
                    .expect("textured material dependency should contain a render texture")
            } else {
                read_render_texture_dependency(content, render_texture_id)?
            };
            let render_surface_default_palette_ids = render_texture
                .render_surfaces
                .iter()
                .filter_map(|dependency| dependency.render_surface.default_palette_id)
                .collect();

            ResolvedMaterialSource::Texture(ResolvedTextureMaterial {
                render_texture_id,
                render_surface_ids: render_texture.render_texture.render_surface_ids,
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

    texture_changes
        .iter()
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
