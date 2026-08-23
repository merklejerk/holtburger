//! App-local discovery and point lookup for the optional offline Explorer weenie catalog.

use std::error::Error;
use std::fmt::{Display, Formatter};
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use holtburger_weenie_catalog::{
    CatalogLookupError, CatalogOpenError, WeenieCatalog, WeenieTemplate,
};
use serde::Serialize;

const CATALOG_FILE_NAME: &str = "weenies.hwc";
const CATALOG_OVERRIDE_ENV: &str = "HOLTBURGER_WEENIE_CATALOG";

/// Why WCID spawning is unavailable without conflating absence and invalid content.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ExplorerCatalogUnavailableKind {
    /// No selected content location exists from which to derive the conventional sibling path.
    MissingContentLocation,
    /// The exact selected catalog path does not exist.
    Missing,
    /// The selected file exists but cannot satisfy the catalog format contract.
    Invalid,
}

/// Complete user-facing capability state for Explorer WCID creation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "status",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum ExplorerCatalogCapability {
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
        kind: ExplorerCatalogUnavailableKind,
        /// Exact opening/discovery failure suitable for Explorer feedback.
        reason: String,
    },
}

/// Point-lookup failure from the app-local optional catalog capability.
#[derive(Debug)]
pub enum ExplorerCatalogLookupError {
    /// Lookup was requested while catalog capability was unavailable.
    Unavailable { reason: String },
    /// The validated index selected a payload that could not be read or decoded.
    Lookup(CatalogLookupError),
}

impl Display for ExplorerCatalogLookupError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Unavailable { reason } => formatter.write_str(reason),
            Self::Lookup(source) => Display::fmt(source, formatter),
        }
    }
}

impl Error for ExplorerCatalogLookupError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Lookup(source) => Some(source),
            Self::Unavailable { .. } => None,
        }
    }
}

/// Injected catalog boundary used by the Explorer entity driver and focused host tests.
pub trait ExplorerWeenieCatalogSource: Send + Sync {
    /// Returns the complete immutable capability state.
    fn capability(&self) -> ExplorerCatalogCapability;

    /// Resolves one exact WCID without scanning or caching template payloads.
    fn lookup(&self, wcid: u32) -> Result<Option<WeenieTemplate>, ExplorerCatalogLookupError>;
}

/// Concrete optional catalog selected once during Explorer host composition.
#[derive(Debug)]
pub struct ExplorerWeenieCatalog {
    capability: ExplorerCatalogCapability,
    catalog: Option<WeenieCatalog>,
}

impl ExplorerWeenieCatalog {
    /// Applies one already-resolved app-local override and opens the resulting exact catalog path.
    ///
    /// Environment policy stays outside this deterministic constructor so injected host tests cannot
    /// be changed by an operator's process environment.
    pub fn discover(selected_content: Option<&Path>, explicit_override: Option<PathBuf>) -> Self {
        match explicit_override.or_else(|| selected_content.and_then(default_catalog_path)) {
            Some(path) => Self::open(path),
            None => Self {
                capability: ExplorerCatalogCapability::Unavailable {
                    path: None,
                    kind: ExplorerCatalogUnavailableKind::MissingContentLocation,
                    reason: "Explorer WCID spawning is unavailable because no selected HBA content location can supply weenies.hwc".to_owned(),
                },
                catalog: None,
            },
        }
    }

    /// Resolves the production process override before applying deterministic discovery policy.
    pub fn discover_from_environment(selected_content: Option<&Path>) -> Self {
        Self::discover(
            selected_content,
            std::env::var_os(CATALOG_OVERRIDE_ENV).map(PathBuf::from),
        )
    }

    fn open(path: PathBuf) -> Self {
        match WeenieCatalog::open(&path) {
            Ok(catalog) => Self {
                capability: ExplorerCatalogCapability::Available {
                    path,
                    record_count: catalog.len(),
                },
                catalog: Some(catalog),
            },
            Err(error) => {
                let kind = match &error {
                    CatalogOpenError::Unavailable { source, .. }
                        if source.kind() == ErrorKind::NotFound =>
                    {
                        ExplorerCatalogUnavailableKind::Missing
                    }
                    _ => ExplorerCatalogUnavailableKind::Invalid,
                };
                Self {
                    capability: ExplorerCatalogCapability::Unavailable {
                        path: Some(path),
                        kind,
                        reason: error.to_string(),
                    },
                    catalog: None,
                }
            }
        }
    }
}

impl ExplorerWeenieCatalogSource for ExplorerWeenieCatalog {
    fn capability(&self) -> ExplorerCatalogCapability {
        self.capability.clone()
    }

    fn lookup(&self, wcid: u32) -> Result<Option<WeenieTemplate>, ExplorerCatalogLookupError> {
        let Some(catalog) = &self.catalog else {
            let reason = match &self.capability {
                ExplorerCatalogCapability::Unavailable { reason, .. } => reason.clone(),
                ExplorerCatalogCapability::Available { .. } => {
                    unreachable!("available catalog capability lost its reader")
                }
            };
            return Err(ExplorerCatalogLookupError::Unavailable { reason });
        };
        catalog
            .lookup(wcid)
            .map_err(ExplorerCatalogLookupError::Lookup)
    }
}

fn default_catalog_path(selected_content: &Path) -> Option<PathBuf> {
    if selected_content.is_dir() {
        return Some(selected_content.join(CATALOG_FILE_NAME));
    }
    selected_content
        .parent()
        .map(|parent| parent.join(CATALOG_FILE_NAME))
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_weenie_catalog::{TemplatePhysics, WeenieTemplate, write_catalog_atomic};
    use tempfile::tempdir;

    fn template(wcid: u32) -> WeenieTemplate {
        WeenieTemplate {
            wcid,
            class_name: format!("class_{wcid}"),
            weenie_type: 10,
            name: Some(format!("Template {wcid}")),
            setup_did: Some(0x0200_0001),
            motion_table_did: None,
            sound_table_did: None,
            physics_effect_table_did: None,
            palette_base_did: None,
            default_scale: None,
            friction: None,
            elasticity: None,
            maximum_velocity: None,
            rotation_speed: None,
            appearance: Default::default(),
            wielded: Vec::new(),
            physics: TemplatePhysics::default(),
            sub_palettes: Vec::new(),
            texture_changes: Vec::new(),
            anim_part_changes: Vec::new(),
        }
    }

    #[test]
    fn directory_and_hba_selections_choose_only_the_canonical_sibling_name() {
        let directory = tempdir().unwrap();
        let path = directory.path().join(CATALOG_FILE_NAME);
        write_catalog_atomic(&path, &[template(42)]).unwrap();

        for selected in [directory.path(), &directory.path().join("client.hba")] {
            let catalog = ExplorerWeenieCatalog::discover(Some(selected), None);
            assert!(matches!(
                catalog.capability(),
                ExplorerCatalogCapability::Available { path: selected, .. } if selected == path
            ));
            assert_eq!(catalog.lookup(42).unwrap(), Some(template(42)));
        }
    }

    #[test]
    fn explicit_override_wins_without_scanning_selected_content() {
        let directory = tempdir().unwrap();
        let selected = directory.path().join("selected");
        let override_path = directory.path().join("operator-choice.hwc");
        std::fs::create_dir(&selected).unwrap();
        write_catalog_atomic(selected.join(CATALOG_FILE_NAME), &[template(1)]).unwrap();
        write_catalog_atomic(&override_path, &[template(2)]).unwrap();

        let catalog = ExplorerWeenieCatalog::discover(Some(&selected), Some(override_path.clone()));
        assert!(matches!(
            catalog.capability(),
            ExplorerCatalogCapability::Available { path, .. } if path == override_path
        ));
        assert!(catalog.lookup(1).unwrap().is_none());
        assert_eq!(catalog.lookup(2).unwrap(), Some(template(2)));
    }

    #[test]
    fn absence_and_invalid_selected_files_have_distinct_exact_capabilities() {
        let directory = tempdir().unwrap();
        let missing = ExplorerWeenieCatalog::discover(Some(directory.path()), None);
        assert!(matches!(
            missing.capability(),
            ExplorerCatalogCapability::Unavailable {
                kind: ExplorerCatalogUnavailableKind::Missing,
                ..
            }
        ));

        let path = directory.path().join(CATALOG_FILE_NAME);
        std::fs::write(&path, b"not a catalog").unwrap();
        let invalid = ExplorerWeenieCatalog::discover(Some(directory.path()), None);
        assert!(matches!(
            invalid.capability(),
            ExplorerCatalogCapability::Unavailable {
                path: Some(selected),
                kind: ExplorerCatalogUnavailableKind::Invalid,
                reason,
            } if selected == path && reason.contains("corrupt")
        ));
    }
}
