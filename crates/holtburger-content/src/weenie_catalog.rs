//! Optional ACE template catalog shared by client and Explorer content consumers.

use std::collections::BTreeMap;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::{Context, Result};
use holtburger_common::properties::WeenieType;
use holtburger_weenie_catalog::{CatalogOpenError, WeenieCatalog};
use serde::Serialize;

/// Conventional sibling of the selected DAT archive.
pub const WEENIE_CATALOG_FILE_NAME: &str = "weenies.hwc";

/// Why static entity metadata is unavailable without conflating absence and invalid content.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum WeenieCatalogUnavailableKind {
    /// No selected content location exists from which to derive the conventional sibling path.
    MissingContentLocation,
    /// The exact selected catalog path does not exist.
    Missing,
    /// The selected file exists but cannot satisfy the catalog format contract.
    Invalid,
}

/// Complete user-facing capability state for static entity metadata.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "status",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum WeenieCatalogCapability {
    /// A validated catalog is ready for indexed point lookup.
    Available {
        /// Exact selected catalog path.
        path: PathBuf,
        /// Number of indexed WCID templates.
        record_count: usize,
    },
    /// Catalog lookup is disabled with one exact, stable reason.
    Unavailable {
        /// Selected path, absent only when no content location could be derived.
        path: Option<PathBuf>,
        /// Whether the path was missing or the selected file was invalid.
        kind: WeenieCatalogUnavailableKind,
        /// Exact opening/discovery failure suitable for content feedback.
        reason: String,
    },
}

/// Immutable parsed types; no file access occurs during a runtime lookup.
#[derive(Debug)]
pub struct WeenieTypeIndex(BTreeMap<u32, WeenieType>);

impl WeenieTypeIndex {
    /// Unknown/custom-server WCIDs remain absent rather than becoming Generic.
    pub fn get(&self, wcid: u32) -> Option<WeenieType> {
        self.0.get(&wcid).copied()
    }

    fn read(catalog: &WeenieCatalog) -> Result<Self> {
        let mut types = BTreeMap::new();
        for record in catalog.records() {
            let template = catalog
                .lookup(record.wcid)?
                .context("indexed template disappeared")?;
            let kind = WeenieType::from_repr(template.weenie_type).with_context(|| {
                format!(
                    "WCID {} has invalid weenie type {}",
                    record.wcid, template.weenie_type
                )
            })?;
            types.insert(record.wcid, kind);
        }
        Ok(Self(types))
    }
}

/// Catalog capability and its reader/index share one lifetime and cannot disagree.
#[derive(Debug)]
pub struct WeenieCatalogContent {
    state: CatalogState,
}

/// Private construction keeps the parsed index paired with the reader that produced it.
#[derive(Debug)]
enum CatalogState {
    /// Completely decoded metadata accompanies the validated portable reader.
    Available {
        /// Selected catalog path for diagnostics.
        path: PathBuf,
        /// Reader used by content preparation and Explorer search.
        catalog: WeenieCatalog,
        /// Startup-parsed type facts consumed by live world bootstrap.
        types: Arc<WeenieTypeIndex>,
    },
    /// Missing and invalid catalogs are reported explicitly without breaking DAT-only clients.
    Unavailable {
        /// Selected catalog path, if a content location was supplied.
        path: Option<PathBuf>,
        /// Distinguishes missing optional content from a rejected artifact.
        kind: WeenieCatalogUnavailableKind,
        /// Specific diagnostic failure.
        reason: String,
    },
}

impl WeenieCatalogContent {
    /// Resolve one caller-supplied override or the conventional sibling of selected DAT content.
    pub fn discover(selected_content: Option<&Path>, explicit_override: Option<PathBuf>) -> Self {
        Self {
            state: CatalogState::discover(selected_content, explicit_override),
        }
    }

    /// Expose availability to both mode-specific host surfaces.
    pub fn capability(&self) -> WeenieCatalogCapability {
        match &self.state {
            CatalogState::Available { path, catalog, .. } => WeenieCatalogCapability::Available {
                path: path.clone(),
                record_count: catalog.len(),
            },
            CatalogState::Unavailable { path, kind, reason } => {
                WeenieCatalogCapability::Unavailable {
                    path: path.clone(),
                    kind: *kind,
                    reason: reason.clone(),
                }
            }
        }
    }

    /// Borrow the decoder or the exact reason lookup is unavailable.
    pub fn reader(&self) -> Result<&WeenieCatalog, &str> {
        match &self.state {
            CatalogState::Available { catalog, .. } => Ok(catalog),
            CatalogState::Unavailable { reason, .. } => Err(reason),
        }
    }

    /// Share parsed metadata without introducing archive policy into world/core.
    pub fn types(&self) -> Option<Arc<WeenieTypeIndex>> {
        match &self.state {
            CatalogState::Available { types, .. } => Some(Arc::clone(types)),
            CatalogState::Unavailable { .. } => None,
        }
    }
}

impl CatalogState {
    fn discover(selected_content: Option<&Path>, explicit_override: Option<PathBuf>) -> Self {
        let path = explicit_override.or_else(|| {
            selected_content.and_then(|content| {
                if content.is_dir() {
                    Some(content.join(WEENIE_CATALOG_FILE_NAME))
                } else {
                    content
                        .parent()
                        .map(|parent| parent.join(WEENIE_CATALOG_FILE_NAME))
                }
            })
        });
        let Some(path) = path else {
            return Self::Unavailable {
                path: None,
                kind: WeenieCatalogUnavailableKind::MissingContentLocation,
                reason: "No selected content location can supply weenies.hwc".into(),
            };
        };
        let catalog = match WeenieCatalog::open(&path) {
            Ok(catalog) => catalog,
            Err(error) => {
                let kind = match &error {
                    CatalogOpenError::Unavailable { source, .. }
                        if source.kind() == ErrorKind::NotFound =>
                    {
                        WeenieCatalogUnavailableKind::Missing
                    }
                    _ => WeenieCatalogUnavailableKind::Invalid,
                };
                return Self::Unavailable {
                    path: Some(path),
                    kind,
                    reason: error.to_string(),
                };
            }
        };
        match WeenieTypeIndex::read(&catalog) {
            Ok(types) => Self::Available {
                path,
                catalog,
                types: Arc::new(types),
            },
            Err(error) => Self::Unavailable {
                path: Some(path),
                kind: WeenieCatalogUnavailableKind::Invalid,
                reason: format!("{error:#}"),
            },
        }
    }
}
