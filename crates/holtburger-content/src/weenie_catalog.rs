//! Optional ACE server-template snapshot for Explorer and offline diagnostics.

use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use holtburger_weenie_catalog::{CatalogOpenError, WeenieCatalog};
use serde::Serialize;

/// Conventional filename for the compiled ACE weenie catalog.
pub const WEENIE_CATALOG_FILE_NAME: &str = "weenies.hwc";

/// Why static entity metadata is unavailable without conflating absence and invalid content.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum WeenieCatalogUnavailableKind {
    /// Neither a selected content location nor a bundled fallback supplied a candidate path.
    MissingContentLocation,
    /// The resolved catalog path does not exist.
    Missing,
    /// The resolved file exists but cannot satisfy the catalog format contract.
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

/// Catalog capability and its reader share one lifetime and cannot disagree.
#[derive(Debug)]
pub struct WeenieCatalogContent {
    state: CatalogState,
}

/// Private construction keeps capability status paired with its reader.
#[derive(Debug)]
enum CatalogState {
    /// Validated catalog structure permits indexed template lookup.
    Available {
        /// Selected catalog path for diagnostics.
        path: PathBuf,
        /// Reader used by content preparation and Explorer search.
        catalog: WeenieCatalog,
    },
    /// Missing and invalid snapshots leave DAT-only Explorer workflows available.
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
    /// Resolve an explicit override, a conventional sibling of selected DAT content,
    /// or a bundled application fallback in that precedence order.
    pub fn discover(
        selected_content: Option<&Path>,
        explicit_override: Option<PathBuf>,
        bundled_fallback: Option<PathBuf>,
    ) -> Self {
        Self {
            state: CatalogState::discover(selected_content, explicit_override, bundled_fallback),
        }
    }

    /// Expose availability to Explorer and offline diagnostic consumers.
    pub fn capability(&self) -> WeenieCatalogCapability {
        match &self.state {
            CatalogState::Available { path, catalog } => WeenieCatalogCapability::Available {
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
}

impl CatalogState {
    fn open_candidate(path: PathBuf) -> Self {
        match WeenieCatalog::open(&path) {
            Ok(catalog) => Self::Available { path, catalog },
            Err(error) => {
                let kind = match &error {
                    CatalogOpenError::Unavailable { source, .. }
                        if source.kind() == ErrorKind::NotFound =>
                    {
                        WeenieCatalogUnavailableKind::Missing
                    }
                    _ => WeenieCatalogUnavailableKind::Invalid,
                };
                Self::Unavailable {
                    path: Some(path),
                    kind,
                    reason: error.to_string(),
                }
            }
        }
    }

    fn discover(
        selected_content: Option<&Path>,
        explicit_override: Option<PathBuf>,
        bundled_fallback: Option<PathBuf>,
    ) -> Self {
        // Explicit caller overrides never fall back silently to sibling or bundled copies.
        if let Some(path) = explicit_override {
            return Self::open_candidate(path);
        }

        let sibling_path = selected_content.and_then(|content| {
            if content.is_dir() {
                Some(content.join(WEENIE_CATALOG_FILE_NAME))
            } else {
                content
                    .parent()
                    .map(|parent| parent.join(WEENIE_CATALOG_FILE_NAME))
            }
        });

        let sibling_missing = if let Some(sibling) = sibling_path {
            match Self::open_candidate(sibling) {
                state @ Self::Available { .. } => return state,
                state @ Self::Unavailable {
                    kind: WeenieCatalogUnavailableKind::Invalid,
                    ..
                } => return state,
                missing @ Self::Unavailable { .. } => Some(missing),
            }
        } else {
            None
        };

        if let Some(bundled) = bundled_fallback {
            let duplicate_sibling = matches!(
                &sibling_missing,
                Some(Self::Unavailable { path: Some(sibling), .. }) if sibling == &bundled
            );
            if !duplicate_sibling {
                match Self::open_candidate(bundled) {
                    state @ Self::Available { .. } => return state,
                    state @ Self::Unavailable {
                        kind: WeenieCatalogUnavailableKind::Invalid,
                        ..
                    } => return state,
                    bundled_missing @ Self::Unavailable { .. } => {
                        return sibling_missing.unwrap_or(bundled_missing);
                    }
                }
            }
        }

        sibling_missing.unwrap_or_else(|| Self::Unavailable {
            path: None,
            kind: WeenieCatalogUnavailableKind::MissingContentLocation,
            reason: "No selected content location or bundled fallback can supply weenies.hwc"
                .into(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_weenie_catalog::{TemplatePhysics, WeenieTemplate, write_catalog_atomic};
    use tempfile::tempdir;

    fn sample_template(wcid: u32) -> WeenieTemplate {
        WeenieTemplate {
            wcid,
            class_name: format!("class_{wcid}"),
            weenie_type: 10,
            name: Some(format!("Template {wcid}")),
            level: None,
            setup_did: Some(0x0200_0001),
            motion_table_did: None,
            sound_table_did: None,
            physics_effect_table_did: None,
            palette_base_did: None,
            default_scale: None,
            friction: None,
            elasticity: None,
            translucency: None,
            maximum_velocity: None,
            rotation_speed: None,
            radar_blip_color: None,
            radar_behavior: None,
            item_useable: None,
            obvious_radar_range: None,
            attackable: None,
            appearance: Default::default(),
            wielded: Vec::new(),
            physics: TemplatePhysics::default(),
            sub_palettes: Vec::new(),
            texture_changes: Vec::new(),
            anim_part_changes: Vec::new(),
        }
    }

    #[test]
    fn explicit_override_wins_and_does_not_fall_back_when_missing() {
        let dir = tempdir().unwrap();
        let selected = dir.path().join("content");
        let bundled_dir = dir.path().join("resources");
        std::fs::create_dir_all(&selected).unwrap();
        std::fs::create_dir_all(&bundled_dir).unwrap();
        let sibling = selected.join(WEENIE_CATALOG_FILE_NAME);
        let bundled = bundled_dir.join(WEENIE_CATALOG_FILE_NAME);
        let explicit = dir.path().join("custom.hwc");
        write_catalog_atomic(&sibling, &[sample_template(1)]).unwrap();
        write_catalog_atomic(&bundled, &[sample_template(2)]).unwrap();
        write_catalog_atomic(&explicit, &[sample_template(3)]).unwrap();

        let catalog = WeenieCatalogContent::discover(
            Some(&selected),
            Some(explicit.clone()),
            Some(bundled.clone()),
        );
        assert!(matches!(
            catalog.capability(),
            WeenieCatalogCapability::Available { path, record_count: 1 } if path == explicit
        ));
        assert!(catalog.reader().unwrap().lookup(3).unwrap().is_some());

        let missing_override = dir.path().join("absent.hwc");
        let missing = WeenieCatalogContent::discover(
            Some(&selected),
            Some(missing_override.clone()),
            Some(bundled),
        );
        assert!(matches!(
            missing.capability(),
            WeenieCatalogCapability::Unavailable {
                path: Some(path),
                kind: WeenieCatalogUnavailableKind::Missing,
                ..
            } if path == missing_override
        ));
    }

    #[test]
    fn sibling_wins_over_bundled_and_corrupt_sibling_is_not_masked() {
        let dir = tempdir().unwrap();
        let selected = dir.path().join("content");
        let bundled_dir = dir.path().join("resources");
        std::fs::create_dir_all(&selected).unwrap();
        std::fs::create_dir_all(&bundled_dir).unwrap();
        let sibling = selected.join(WEENIE_CATALOG_FILE_NAME);
        let bundled = bundled_dir.join(WEENIE_CATALOG_FILE_NAME);
        write_catalog_atomic(&sibling, &[sample_template(10)]).unwrap();
        write_catalog_atomic(&bundled, &[sample_template(20)]).unwrap();

        let catalog = WeenieCatalogContent::discover(Some(&selected), None, Some(bundled.clone()));
        assert!(matches!(
            catalog.capability(),
            WeenieCatalogCapability::Available { path, record_count: 1 } if path == sibling
        ));
        assert!(catalog.reader().unwrap().lookup(10).unwrap().is_some());

        std::fs::write(&sibling, b"corrupt catalog bytes").unwrap();
        let invalid = WeenieCatalogContent::discover(Some(&selected), None, Some(bundled));
        assert!(matches!(
            invalid.capability(),
            WeenieCatalogCapability::Unavailable {
                path: Some(path),
                kind: WeenieCatalogUnavailableKind::Invalid,
                ..
            } if path == sibling
        ));
    }

    #[test]
    fn falls_back_to_bundled_catalog_when_sibling_is_absent_and_reports_corrupt_bundled() {
        let dir = tempdir().unwrap();
        let selected = dir.path().join("content");
        let bundled_dir = dir.path().join("resources");
        std::fs::create_dir_all(&selected).unwrap();
        std::fs::create_dir_all(&bundled_dir).unwrap();
        let bundled = bundled_dir.join(WEENIE_CATALOG_FILE_NAME);
        write_catalog_atomic(&bundled, &[sample_template(99)]).unwrap();

        let catalog = WeenieCatalogContent::discover(Some(&selected), None, Some(bundled.clone()));
        assert!(matches!(
            catalog.capability(),
            WeenieCatalogCapability::Available { path, record_count: 1 } if path == bundled
        ));
        assert!(catalog.reader().unwrap().lookup(99).unwrap().is_some());

        let without_selected = WeenieCatalogContent::discover(None, None, Some(bundled.clone()));
        assert!(matches!(
            without_selected.capability(),
            WeenieCatalogCapability::Available { path, record_count: 1 } if path == bundled
        ));

        std::fs::write(&bundled, b"corrupt bundled catalog").unwrap();
        let invalid_bundled =
            WeenieCatalogContent::discover(Some(&selected), None, Some(bundled.clone()));
        assert!(matches!(
            invalid_bundled.capability(),
            WeenieCatalogCapability::Unavailable {
                path: Some(path),
                kind: WeenieCatalogUnavailableKind::Invalid,
                ..
            } if path == bundled
        ));
    }

    #[test]
    fn missing_both_sibling_and_bundled_reports_sibling_or_missing_location() {
        let dir = tempdir().unwrap();
        let selected = dir.path().join("content");
        let bundled = dir.path().join("resources").join(WEENIE_CATALOG_FILE_NAME);
        std::fs::create_dir_all(&selected).unwrap();

        let missing_with_selected =
            WeenieCatalogContent::discover(Some(&selected), None, Some(bundled.clone()));
        assert!(matches!(
            missing_with_selected.capability(),
            WeenieCatalogCapability::Unavailable {
                path: Some(path),
                kind: WeenieCatalogUnavailableKind::Missing,
                ..
            } if path == selected.join(WEENIE_CATALOG_FILE_NAME)
        ));

        let missing_bundled_only =
            WeenieCatalogContent::discover(None, None, Some(bundled.clone()));
        assert!(matches!(
            missing_bundled_only.capability(),
            WeenieCatalogCapability::Unavailable {
                path: Some(path),
                kind: WeenieCatalogUnavailableKind::Missing,
                ..
            } if path == bundled
        ));

        let missing_all = WeenieCatalogContent::discover(None, None, None);
        assert!(matches!(
            missing_all.capability(),
            WeenieCatalogCapability::Unavailable {
                path: None,
                kind: WeenieCatalogUnavailableKind::MissingContentLocation,
                ..
            }
        ));
    }
}
