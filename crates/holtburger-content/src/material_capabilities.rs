use std::collections::{HashMap, HashSet};
use std::io::Cursor;

use holtburger_dat::file_type::{DatFileType, EnvCell, GfxObj};
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
    pub limitations: Vec<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct MaterialRecordCounts {
    pub c_surface: MaterialRecordAvailability,
    pub render_texture: MaterialRecordAvailability,
    pub render_surface: MaterialRecordAvailability,
    pub palette: MaterialRecordAvailability,
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
            && record_counts.render_texture.total > 0
            && record_counts.render_surface.total > 0
            && record_counts.palette.total > 0
            && record_counts.clothing_table.total > 0;
        let material_complete = has_legacy_material_stack
            && record_counts.c_surface.pruned == 0
            && record_counts.render_texture.pruned == 0
            && record_counts.render_surface.pruned == 0
            && record_counts.palette.pruned == 0
            && record_counts.clothing_table.pruned == 0
            && visual_source_records.pruned == 0
            && material_references.missing_csurfaces.is_empty()
            && material_references.pruned_csurfaces.is_empty()
            && material_references.parse_failures.is_empty();

        Self {
            record_counts,
            visual_source_records,
            material_references,
            material_complete,
            limitations: vec![
                "Phase 0 only validates archive-level material records and mesh-to-CSurface references; CSurface texture, render-surface, and palette dependency validation waits for typed material parsers.".to_string(),
            ],
        }
    }
}

fn count_material_records(index_entries: &[RepositoryResourceIndexEntry]) -> MaterialRecordCounts {
    let mut counts = MaterialRecordCounts::default();

    for entry in index_entries {
        let availability = match DatFileType::from_id(entry.file_id) {
            DatFileType::Surface => Some(&mut counts.c_surface),
            DatFileType::SurfaceTexture => Some(&mut counts.render_texture),
            DatFileType::Texture => Some(&mut counts.render_surface),
            DatFileType::Palette => Some(&mut counts.palette),
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
    for (surface_id, status) in material_status_by_id {
        match status {
            Some(false) => available_csurfaces += 1,
            Some(true) => pruned_csurfaces.push(surface_id),
            None => missing_csurfaces.push(surface_id),
        }
    }

    missing_csurfaces.sort_unstable();
    pruned_csurfaces.sort_unstable();

    MaterialReferenceCoverage {
        referenced_csurfaces: referenced_csurfaces.len(),
        available_csurfaces,
        missing_csurfaces,
        pruned_csurfaces,
        skipped_pruned_visual_sources,
        parse_failures,
    }
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
