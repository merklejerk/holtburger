use std::io::Cursor;

use anyhow::{Context, Result, anyhow};
use holtburger_dat::file_type::{
    CSurface, CSurfaceSource, EnvCell, GfxObj, Palette, RenderSurface, RenderTexture, SurfaceType,
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
        Ok(material_recipe_from_dependency(dependency))
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

fn material_recipe_from_dependency(dependency: ParsedMaterialDependency) -> ResolvedMaterialRecipe {
    let source = match dependency.c_surface.source {
        CSurfaceSource::SolidColor(color) => ResolvedMaterialSource::SolidColor(color),
        CSurfaceSource::Texture {
            orig_texture_id,
            orig_palette_id,
        } => {
            let render_texture = dependency
                .render_texture
                .expect("textured material dependency should contain a render texture");
            let render_surface_default_palette_ids = render_texture
                .render_surfaces
                .iter()
                .filter_map(|dependency| dependency.render_surface.default_palette_id)
                .collect();

            ResolvedMaterialSource::Texture(ResolvedTextureMaterial {
                render_texture_id: orig_texture_id,
                render_surface_ids: render_texture.render_texture.render_surface_ids,
                palette_id: (orig_palette_id != 0).then_some(orig_palette_id),
                render_surface_default_palette_ids,
            })
        }
    };

    ResolvedMaterialRecipe {
        surface_id: dependency.surface_id,
        surface_type: dependency.c_surface.surface_type,
        source,
        translucency: dependency.c_surface.translucency,
        luminosity: dependency.c_surface.luminosity,
        diffuse: dependency.c_surface.diffuse,
    }
}
