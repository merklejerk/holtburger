use std::collections::{HashMap, HashSet};
use std::io::Cursor;

use holtburger_dat::file_type::{
    CSurface, CSurfaceSource, DatFileType, EnvCell, GfxObj, Palette, RenderSurface, SurfaceTexture,
};
use holtburger_dat::{EOR_CELL_NAMESPACE, EOR_PORTAL_NAMESPACE, ResourceKey};

use crate::ContentRepository;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RepositoryResourceIndexEntry {
    pub namespace: String,
    pub file_id: u32,
    pub type_id: u32,
    pub size: u32,
    pub is_pruned: bool,
    pub source_description: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct MaterialArchiveCapabilityReport {
    pub record_counts: MaterialRecordCounts,
    pub visual_source_records: VisualSourceRecordCoverage,
    pub material_references: MaterialReferenceCoverage,
    pub material_complete: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct MaterialRecordCounts {
    pub c_surface: MaterialRecordAvailability,
    pub surface_texture: MaterialRecordAvailability,
    pub render_surface: MaterialRecordAvailability,
    pub palette: MaterialRecordAvailability,
    pub palette_set: MaterialRecordAvailability,
    pub clothing_table: MaterialRecordAvailability,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct MaterialRecordAvailability {
    pub total: usize,
    pub available: usize,
    pub pruned: usize,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct VisualSourceRecordCoverage {
    pub total: usize,
    pub available: usize,
    pub pruned: usize,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct MaterialReferenceCoverage {
    pub referenced_csurfaces: usize,
    pub available_csurfaces: usize,
    pub missing_csurfaces: Vec<u32>,
    pub pruned_csurfaces: Vec<u32>,
    pub referenced_surface_textures: usize,
    pub available_surface_textures: usize,
    pub missing_surface_textures: Vec<u32>,
    pub pruned_surface_textures: Vec<u32>,
    pub referenced_render_surfaces: usize,
    pub available_render_surfaces: usize,
    pub missing_render_surfaces: Vec<u32>,
    pub pruned_render_surfaces: Vec<u32>,
    pub referenced_palettes: usize,
    pub available_palettes: usize,
    pub missing_palettes: Vec<u32>,
    pub pruned_palettes: Vec<u32>,
    pub skipped_pruned_visual_sources: usize,
    pub parse_failures: Vec<MaterialReferenceParseFailure>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MaterialReferenceParseFailure {
    pub namespace: String,
    pub file_id: u32,
    pub detail: String,
}

impl MaterialArchiveCapabilityReport {
    pub(crate) fn build(
        content: &ContentRepository,
        index_entries: &[RepositoryResourceIndexEntry],
    ) -> Self {
        let record_counts = count_material_records(index_entries);
        let visual_source_records = count_visual_source_records(index_entries);
        let material_references = inspect_material_references(content, index_entries);
        let has_legacy_material_stack = record_counts.c_surface.total > 0
            && record_counts.surface_texture.total > 0
            && record_counts.render_surface.total > 0
            && record_counts.palette.total > 0
            && record_counts.palette_set.total > 0
            && record_counts.clothing_table.total > 0;
        let material_complete = has_legacy_material_stack
            && record_counts.c_surface.pruned == 0
            && record_counts.surface_texture.pruned == 0
            && record_counts.render_surface.pruned == 0
            && record_counts.palette.pruned == 0
            && record_counts.palette_set.pruned == 0
            && record_counts.clothing_table.pruned == 0
            && visual_source_records.pruned == 0
            && material_references.missing_csurfaces.is_empty()
            && material_references.pruned_csurfaces.is_empty()
            && material_references.missing_surface_textures.is_empty()
            && material_references.pruned_surface_textures.is_empty()
            && material_references.missing_render_surfaces.is_empty()
            && material_references.pruned_render_surfaces.is_empty()
            && material_references.missing_palettes.is_empty()
            && material_references.pruned_palettes.is_empty()
            && material_references.parse_failures.is_empty();

        Self {
            record_counts,
            visual_source_records,
            material_references,
            material_complete,
        }
    }
}

fn count_material_records(index_entries: &[RepositoryResourceIndexEntry]) -> MaterialRecordCounts {
    let mut counts = MaterialRecordCounts::default();

    for entry in index_entries {
        let availability = match DatFileType::from_id(entry.file_id) {
            DatFileType::Surface => Some(&mut counts.c_surface),
            DatFileType::SurfaceTexture => Some(&mut counts.surface_texture),
            DatFileType::Texture => Some(&mut counts.render_surface),
            DatFileType::Palette => Some(&mut counts.palette),
            DatFileType::PaletteSet => Some(&mut counts.palette_set),
            DatFileType::Clothing => Some(&mut counts.clothing_table),
            _ => None,
        };

        if let Some(availability) = availability {
            availability.total += 1;
            if entry.is_pruned {
                availability.pruned += 1;
            } else {
                availability.available += 1;
            }
        }
    }

    counts
}

fn count_visual_source_records(
    index_entries: &[RepositoryResourceIndexEntry],
) -> VisualSourceRecordCoverage {
    let mut coverage = VisualSourceRecordCoverage::default();

    for entry in index_entries
        .iter()
        .filter(|entry| is_visual_source_record(entry))
    {
        coverage.total += 1;
        if entry.is_pruned {
            coverage.pruned += 1;
        } else {
            coverage.available += 1;
        }
    }

    coverage
}

fn inspect_material_references(
    content: &ContentRepository,
    index_entries: &[RepositoryResourceIndexEntry],
) -> MaterialReferenceCoverage {
    let mut referenced_csurfaces = HashSet::new();
    let mut skipped_pruned_visual_sources = 0;
    let mut parse_failures = Vec::new();

    for entry in index_entries
        .iter()
        .filter(|entry| is_visual_source_record(entry))
    {
        if entry.is_pruned {
            skipped_pruned_visual_sources += 1;
            continue;
        }

        let resource =
            match content.read_resource(ResourceKey::new(&entry.namespace, entry.file_id)) {
                Ok(resource) => resource,
                Err(error) => {
                    parse_failures.push(MaterialReferenceParseFailure {
                        namespace: entry.namespace.clone(),
                        file_id: entry.file_id,
                        detail: format!("could not read visual source record: {error}"),
                    });
                    continue;
                }
            };

        match DatFileType::from_id(entry.file_id) {
            DatFileType::Model => match GfxObj::unpack(&mut Cursor::new(resource.bytes)) {
                Ok(gfx_obj) => {
                    referenced_csurfaces.extend(gfx_obj.surfaces);
                }
                Err(error) => parse_failures.push(MaterialReferenceParseFailure {
                    namespace: entry.namespace.clone(),
                    file_id: entry.file_id,
                    detail: format!("could not parse GfxObj surface table: {error}"),
                }),
            },
            DatFileType::EnvCell => match EnvCell::unpack(&mut Cursor::new(resource.bytes)) {
                Ok(env_cell) => {
                    referenced_csurfaces.extend(
                        env_cell
                            .surfaces
                            .into_iter()
                            .map(|surface_id| 0x0800_0000 | u32::from(surface_id)),
                    );
                }
                Err(error) => parse_failures.push(MaterialReferenceParseFailure {
                    namespace: entry.namespace.clone(),
                    file_id: entry.file_id,
                    detail: format!("could not parse EnvCell surface table: {error}"),
                }),
            },
            _ => {}
        }
    }

    let mut material_status_by_id: HashMap<u32, Option<bool>> = HashMap::new();
    for surface_id in &referenced_csurfaces {
        let metadata =
            content.resource_metadata(ResourceKey::new(EOR_PORTAL_NAMESPACE, *surface_id));
        material_status_by_id.insert(*surface_id, metadata.map(|metadata| metadata.is_pruned));
    }

    let mut missing_csurfaces = Vec::new();
    let mut pruned_csurfaces = Vec::new();
    let mut available_csurfaces = 0;
    let mut available_surface_ids = Vec::new();
    for (surface_id, status) in material_status_by_id {
        match status {
            Some(false) => {
                available_csurfaces += 1;
                available_surface_ids.push(surface_id);
            }
            Some(true) => pruned_csurfaces.push(surface_id),
            None => missing_csurfaces.push(surface_id),
        }
    }

    missing_csurfaces.sort_unstable();
    pruned_csurfaces.sort_unstable();
    available_surface_ids.sort_unstable();

    let dependency_coverage = inspect_deep_material_dependencies(content, &available_surface_ids);

    MaterialReferenceCoverage {
        referenced_csurfaces: referenced_csurfaces.len(),
        available_csurfaces,
        missing_csurfaces,
        pruned_csurfaces,
        referenced_surface_textures: dependency_coverage.surface_textures.referenced(),
        available_surface_textures: dependency_coverage.surface_textures.available,
        missing_surface_textures: dependency_coverage.surface_textures.missing,
        pruned_surface_textures: dependency_coverage.surface_textures.pruned,
        referenced_render_surfaces: dependency_coverage.render_surfaces.referenced(),
        available_render_surfaces: dependency_coverage.render_surfaces.available,
        missing_render_surfaces: dependency_coverage.render_surfaces.missing,
        pruned_render_surfaces: dependency_coverage.render_surfaces.pruned,
        referenced_palettes: dependency_coverage.palettes.referenced(),
        available_palettes: dependency_coverage.palettes.available,
        missing_palettes: dependency_coverage.palettes.missing,
        pruned_palettes: dependency_coverage.palettes.pruned,
        skipped_pruned_visual_sources,
        parse_failures: parse_failures
            .into_iter()
            .chain(dependency_coverage.parse_failures)
            .collect(),
    }
}

#[derive(Debug, Default)]
struct DeepMaterialDependencyCoverage {
    surface_textures: DependencyRecordCoverage,
    render_surfaces: DependencyRecordCoverage,
    palettes: DependencyRecordCoverage,
    parse_failures: Vec<MaterialReferenceParseFailure>,
}

#[derive(Debug, Default)]
struct DependencyRecordCoverage {
    available: usize,
    available_ids: Vec<u32>,
    missing: Vec<u32>,
    pruned: Vec<u32>,
}

impl DependencyRecordCoverage {
    fn referenced(&self) -> usize {
        self.available + self.missing.len() + self.pruned.len()
    }
}

fn inspect_deep_material_dependencies(
    content: &ContentRepository,
    surface_ids: &[u32],
) -> DeepMaterialDependencyCoverage {
    let mut coverage = DeepMaterialDependencyCoverage::default();
    let mut surface_texture_ids = HashSet::new();
    let mut render_surface_ids = HashSet::new();
    let mut palette_ids = HashSet::new();

    for surface_id in surface_ids {
        let c_surface =
            match read_and_parse_dependency(content, *surface_id, "CSurface", CSurface::unpack) {
                Ok(c_surface) => c_surface,
                Err(detail) => {
                    coverage.parse_failures.push(MaterialReferenceParseFailure {
                        namespace: EOR_PORTAL_NAMESPACE.to_string(),
                        file_id: *surface_id,
                        detail,
                    });
                    continue;
                }
            };

        match c_surface.source {
            CSurfaceSource::SolidColor(_) => {}
            CSurfaceSource::Texture {
                orig_texture_id,
                orig_palette_id,
            } => {
                surface_texture_ids.insert(orig_texture_id);
                if orig_palette_id != 0 {
                    palette_ids.insert(orig_palette_id);
                }

                if !is_available_dependency(content, orig_texture_id) {
                    continue;
                }

                let surface_texture = match read_and_parse_dependency(
                    content,
                    orig_texture_id,
                    "SurfaceTexture",
                    SurfaceTexture::unpack,
                ) {
                    Ok(surface_texture) => surface_texture,
                    Err(detail) => {
                        coverage.parse_failures.push(MaterialReferenceParseFailure {
                            namespace: EOR_PORTAL_NAMESPACE.to_string(),
                            file_id: orig_texture_id,
                            detail,
                        });
                        continue;
                    }
                };

                for render_surface_id in surface_texture.render_surface_ids {
                    render_surface_ids.insert(render_surface_id);
                    if !is_available_dependency(content, render_surface_id) {
                        continue;
                    }

                    match read_and_parse_dependency(
                        content,
                        render_surface_id,
                        "RenderSurface",
                        RenderSurface::unpack,
                    ) {
                        Ok(render_surface) => {
                            if let Some(palette_id) = render_surface.default_palette_id {
                                palette_ids.insert(palette_id);
                            }
                        }
                        Err(detail) => {
                            coverage.parse_failures.push(MaterialReferenceParseFailure {
                                namespace: EOR_PORTAL_NAMESPACE.to_string(),
                                file_id: render_surface_id,
                                detail,
                            });
                        }
                    }
                }
            }
        }
    }

    coverage.surface_textures = classify_dependency_records(
        content,
        surface_texture_ids,
        DatFileType::SurfaceTexture,
        "SurfaceTexture",
    );
    coverage.render_surfaces = classify_dependency_records(
        content,
        render_surface_ids,
        DatFileType::Texture,
        "RenderSurface",
    );
    coverage.palettes =
        classify_dependency_records(content, palette_ids, DatFileType::Palette, "Palette");

    for palette_id in &coverage.palettes.available_ids {
        if let Err(detail) =
            read_and_parse_dependency(content, *palette_id, "Palette", Palette::unpack)
        {
            coverage.parse_failures.push(MaterialReferenceParseFailure {
                namespace: EOR_PORTAL_NAMESPACE.to_string(),
                file_id: *palette_id,
                detail,
            });
        }
    }

    coverage
}

fn read_and_parse_dependency<T>(
    content: &ContentRepository,
    file_id: u32,
    label: &str,
    unpack: impl FnOnce(&mut Cursor<Vec<u8>>) -> binrw::BinResult<T>,
) -> Result<T, String> {
    let resource = content
        .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, file_id))
        .map_err(|error| format!("could not read {label} 0x{file_id:08X}: {error:#}"))?;
    unpack(&mut Cursor::new(resource.bytes))
        .map_err(|error| format!("could not parse {label} 0x{file_id:08X}: {error}"))
}

fn is_available_dependency(content: &ContentRepository, file_id: u32) -> bool {
    content
        .resource_metadata(ResourceKey::new(EOR_PORTAL_NAMESPACE, file_id))
        .is_some_and(|metadata| !metadata.is_pruned)
}

fn classify_dependency_records(
    content: &ContentRepository,
    ids: HashSet<u32>,
    expected_type: DatFileType,
    label: &str,
) -> DependencyRecordCoverage {
    let mut coverage = DependencyRecordCoverage::default();

    let mut sorted_ids = ids.into_iter().collect::<Vec<_>>();
    sorted_ids.sort_unstable();
    for id in sorted_ids {
        match content.resource_metadata(ResourceKey::new(EOR_PORTAL_NAMESPACE, id)) {
            Some(metadata) if metadata.is_pruned => coverage.pruned.push(id),
            Some(_) if DatFileType::from_id(id) == expected_type => {
                coverage.available += 1;
                coverage.available_ids.push(id);
            }
            Some(_) => coverage.missing.push(id),
            None => coverage.missing.push(id),
        }
    }

    if !coverage.missing.is_empty() {
        log::debug!(
            "{} dependency coverage found {} missing IDs",
            label,
            coverage.missing.len()
        );
    }

    coverage
}

fn is_visual_source_record(entry: &RepositoryResourceIndexEntry) -> bool {
    matches!(
        (
            entry.namespace.as_str(),
            DatFileType::from_id(entry.file_id)
        ),
        (EOR_PORTAL_NAMESPACE, DatFileType::Model) | (EOR_CELL_NAMESPACE, DatFileType::EnvCell)
    )
}
