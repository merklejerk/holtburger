//! Filesystem archive selection and mounting shared by runtime content consumers.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::{Context, Result, ensure};
use holtburger_dat::{DatDatabase, DatFileType, HbaReader, ResourceSource, RetailDatKind};
use thiserror::Error;

use super::{ContentRepository, MountedContentSource};
use crate::RepositoryResourceIndexEntry;

#[cfg(test)]
#[path = "mounting_tests.rs"]
mod tests;

/// Selection failures remain distinguishable from resource failures after mounting.
#[derive(Debug, Error)]
pub enum ContentSelectionError {
    /// Automatic candidates were absent or contained no archives.
    #[error("No content archives found in discovery locations: {paths:?}")]
    NotDiscovered {
        /// Locations inspected in priority order.
        paths: Vec<PathBuf>,
    },
    /// A selected location could not be inspected, including a missing path.
    #[error("Could not inspect content location {}", path.display())]
    Unavailable {
        /// User-selected or automatically discovered location.
        path: PathBuf,
        /// Filesystem failure; discovery can distinguish absence from denied access.
        #[source]
        source: std::io::Error,
    },
    /// A directory contains no archives of the selected family.
    #[error("No content archives found under {}", path.display())]
    Empty {
        /// Directory inspected for content.
        path: PathBuf,
    },
    /// The exact selected file must have a supported extension.
    #[error("Expected an HBA or DAT archive at {}", path.display())]
    UnsupportedPath {
        /// Unsupported explicit file path.
        path: PathBuf,
    },
    /// A selected archive cannot provide readable, identified resources.
    #[error("Could not mount content archive {}", path.display())]
    Archive {
        /// Archive that failed initialization.
        path: PathBuf,
        /// Header, directory, inventory, or provenance failure.
        #[source]
        source: anyhow::Error,
    },
    /// One directory cannot contain two installations of the same retail archive role.
    #[error("Multiple DAT archives have role {kind}: {} and {}", first.display(), second.display())]
    DuplicateDatKind {
        /// Validated dataset/subset role shared by both files.
        kind: RetailDatKind,
        /// First provider in sorted path order.
        first: PathBuf,
        /// Conflicting provider.
        second: PathBuf,
    },
}

/// A repository and its canonical selection identity, resolved together for host startup.
#[derive(Debug)]
pub struct ResolvedContent {
    /// Exact selected directory or archive, used for saved-location identity.
    pub location: PathBuf,
    /// Open resources, inventory, and source provenance for this selection.
    pub repository: ContentRepository,
}

impl ResolvedContent {
    /// Resolves a user-selected location without environment or sibling-file overrides.
    pub fn open(path: impl Into<PathBuf>) -> Result<Self> {
        let path = path.into();
        let repository = open_selection(path.clone(), None)?;
        let location = fs::canonicalize(&path)
            .map_err(|source| ContentSelectionError::Unavailable { path, source })?;
        Ok(Self {
            location,
            repository,
        })
    }

    /// Tries the host-supplied portable root, then the shared platform-data location.
    /// Only absence is skipped; an archive failure is never hidden by another installation.
    pub fn discover(portable_root: PathBuf) -> Result<Self> {
        let mut paths = vec![portable_root];
        if let Some(platform) = super::platform_content_path()
            && !paths.contains(&platform)
        {
            paths.push(platform);
        }
        Self::discover_candidates(paths)
    }

    fn discover_candidates(paths: Vec<PathBuf>) -> Result<Self> {
        for path in &paths {
            match Self::open(path) {
                Ok(selection) => return Ok(selection),
                Err(error) => match error.downcast_ref::<ContentSelectionError>() {
                    Some(ContentSelectionError::Empty { .. }) => continue,
                    Some(ContentSelectionError::Unavailable { source, .. })
                        if source.kind() == std::io::ErrorKind::NotFound =>
                    {
                        continue;
                    }
                    _ => return Err(error),
                },
            }
        }
        Err(ContentSelectionError::NotDiscovered { paths }.into())
    }
}

/// Archive format controls directory family selection, never resource semantics.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum ArchiveFamily {
    Hba,
    Dat,
}

impl ArchiveFamily {
    fn for_path(path: &Path) -> Option<Self> {
        let extension = path.extension()?.to_str()?;
        if extension.eq_ignore_ascii_case("hba") {
            Some(Self::Hba)
        } else if extension.eq_ignore_ascii_case("dat") {
            Some(Self::Dat)
        } else {
            None
        }
    }
}

/// Format-specific identity needed for mounting precedence and duplicate detection.
#[derive(Clone, Copy)]
enum ArchiveScope {
    /// HBA namespace breadth preserves the established bundle precedence.
    Hba { namespace_count: usize },
    /// Retail base portal and highres are distinct roles in the same resource namespace.
    Retail(RetailDatKind),
}

/// One opened archive, retaining its identity until directory ordering is resolved.
struct OpenedArchive {
    /// Immutable namespaced resource reads.
    source: Arc<dyn ResourceSource>,
    /// Revision captured from the opened handle, for cache invalidation.
    revision: MountedContentSource,
    /// Source identity controls precedence without relying on its filename.
    scope: ArchiveScope,
    /// Entry inventory consumed by content discovery and motion projection.
    entries: Vec<RepositoryResourceIndexEntry>,
}

fn open_archive(path: &Path, family: ArchiveFamily) -> Result<OpenedArchive> {
    let description = path.display().to_string();
    let (source, metadata, scope, entries): (
        Arc<dyn ResourceSource>,
        fs::Metadata,
        ArchiveScope,
        Vec<RepositoryResourceIndexEntry>,
    ) = match family {
        ArchiveFamily::Hba => {
            let archive = HbaReader::open(path)?;
            let namespaces = archive
                .namespaces()
                .map(|namespace| namespace.to_string())
                .collect::<Vec<_>>();
            ensure!(!namespaces.is_empty(), "archive exposes no namespaces");
            let mut entries = Vec::new();
            for entry in archive.entries() {
                let entry = entry.context("could not read HBA index entry")?;
                entries.push(RepositoryResourceIndexEntry {
                    namespace: entry.namespace_id()?.to_string(),
                    file_id: entry.file_id,
                    type_id: entry.type_id,
                    size: entry.size,
                    is_pruned: entry.is_pruned(),
                    source_description: description.clone(),
                });
            }
            let metadata = archive.source_metadata()?;
            (
                Arc::new(archive),
                metadata,
                ArchiveScope::Hba {
                    namespace_count: namespaces.len(),
                },
                entries,
            )
        }
        ArchiveFamily::Dat => {
            let retail = DatDatabase::open_retail(path)?;
            let namespace = retail.kind.namespace();
            let archive = retail.database;
            let entries = archive
                .files
                .values()
                .map(|entry| RepositoryResourceIndexEntry {
                    namespace: namespace.to_owned(),
                    file_id: entry.id,
                    type_id: DatFileType::from_namespaced_id(namespace, entry.id) as u32,
                    // DAT directory sizes describe stored bytes; reads handle decompression.
                    size: entry.size,
                    is_pruned: false,
                    source_description: description.clone(),
                })
                .collect();
            let metadata = archive.source_metadata()?;
            (
                Arc::new(archive),
                metadata,
                ArchiveScope::Retail(retail.kind),
                entries,
            )
        }
    };
    ensure!(!entries.is_empty(), "archive contains no resources");
    Ok(OpenedArchive {
        source,
        revision: MountedContentSource {
            path: fs::canonicalize(path)?,
            size: metadata.len(),
            modified: metadata.modified()?,
        },
        scope,
        entries,
    })
}

/// Opens one exact path or a directory, optionally constraining legacy HBA constructors.
pub(super) fn open_selection(
    path: PathBuf,
    family: Option<ArchiveFamily>,
) -> Result<ContentRepository> {
    let metadata = fs::metadata(&path).map_err(|source| ContentSelectionError::Unavailable {
        path: path.clone(),
        source,
    })?;
    let mut candidates = Vec::new();
    if metadata.is_dir() {
        let read_paths = || -> std::io::Result<Vec<PathBuf>> {
            fs::read_dir(&path)?
                .map(|entry| entry.map(|entry| entry.path()))
                .collect()
        };
        let paths = read_paths().map_err(|source| ContentSelectionError::Unavailable {
            path: path.clone(),
            source,
        })?;
        let selected_family = family.unwrap_or_else(|| {
            if paths
                .iter()
                .any(|path| ArchiveFamily::for_path(path) == Some(ArchiveFamily::Hba))
            {
                ArchiveFamily::Hba
            } else {
                ArchiveFamily::Dat
            }
        });
        candidates.extend(paths.into_iter().filter_map(|path| {
            (ArchiveFamily::for_path(&path) == Some(selected_family))
                .then_some((path, selected_family))
        }));
    } else {
        let selected_family = ArchiveFamily::for_path(&path)
            .filter(|selected| family.is_none_or(|family| family == *selected))
            .ok_or_else(|| ContentSelectionError::UnsupportedPath { path: path.clone() })?;
        candidates.push((path.clone(), selected_family));
    }
    if candidates.is_empty() {
        return Err(ContentSelectionError::Empty { path }.into());
    }
    candidates.sort_by(|left, right| left.0.cmp(&right.0));
    let mut archives = Vec::new();
    let mut dat_roles = BTreeMap::new();
    for (candidate, family) in candidates {
        let archive =
            open_archive(&candidate, family).map_err(|source| ContentSelectionError::Archive {
                path: candidate.clone(),
                source,
            })?;
        if let ArchiveScope::Retail(kind) = archive.scope
            && let Some(first) = dat_roles.insert(kind, candidate.clone())
        {
            return Err(ContentSelectionError::DuplicateDatKind {
                kind,
                first,
                second: candidate,
            }
            .into());
        }
        archives.push(archive);
    }
    // Families never mix. HBA breadth wins; retail highres wins over base portal
    // on membership, matching CLCache::GetDiskController (acclient.c:282498).
    // Stable sorting preserves lexical path order for otherwise equal sources.
    archives.sort_by_key(|archive| {
        std::cmp::Reverse(match archive.scope {
            ArchiveScope::Hba { namespace_count } => namespace_count,
            ArchiveScope::Retail(kind) => usize::from(kind == RetailDatKind::HighResolutionPortal),
        })
    });
    let mut repository = ContentRepository::from_mounts(Vec::new());
    repository.source_description = Some(path.display().to_string());
    for mut archive in archives {
        archive.entries.sort_by(|left, right| {
            (&left.namespace, left.file_id).cmp(&(&right.namespace, right.file_id))
        });
        repository.mounts.push(archive.source);
        repository.mounted_sources.push(archive.revision);
        repository.resource_index.extend(archive.entries);
    }
    for entry in &repository.resource_index {
        if entry.namespace == holtburger_dat::EOR_CELL_NAMESPACE
            && (0x0100..0xfffe).contains(&(entry.file_id & 0xffff))
        {
            repository
                .env_cells_by_landblock
                .entry(crate::normalize_landblock_id(entry.file_id))
                .or_default()
                .push(entry.file_id);
        }
    }
    for cells in repository.env_cells_by_landblock.values_mut() {
        cells.sort_unstable();
        cells.dedup();
    }
    Ok(repository)
}
