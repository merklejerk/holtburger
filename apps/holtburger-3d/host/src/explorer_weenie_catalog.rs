//! Explorer fuzzy search and point lookup over shared optional catalog content.
use holtburger_content::{WeenieCatalogCapability, WeenieCatalogContent};

use std::error::Error;
use std::fmt::{Display, Formatter};
use std::sync::{Arc, OnceLock};

use holtburger_weenie_catalog::{
    CatalogIdentityReadError, CatalogLookupError, WeenieCatalog, WeenieTemplate,
    WeenieTemplateIdentity,
};
use nucleo_matcher::pattern::{Atom, AtomKind, CaseMatching, Normalization};
use nucleo_matcher::{Config, Matcher, Utf32String};
use serde::{Deserialize, Serialize};

/// Maximum user-authored query size accepted by the app-local host boundary.
pub const EXPLORER_WEENIE_SEARCH_MAX_QUERY_BYTES: usize = 128;
/// Maximum result population returned through one Explorer host command.
pub const EXPLORER_WEENIE_SEARCH_MAX_RESULTS: usize = 32;

/// One bounded fuzzy-search request over the optional Explorer weenie catalog.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplorerWeenieSearchRequest {
    /// User-authored display-name or ACE class-name query.
    pub query: String,
    /// Positive caller-requested result ceiling, bounded again by the host.
    pub limit: usize,
}

/// One exact catalog identity selected by an ordered fuzzy-search result.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplorerWeenieSearchResult {
    /// Exact template identity consumed by the existing spawn contract.
    pub wcid: u32,
    /// Authored display name shown as the result's primary label.
    pub name: String,
    /// Exact ACE class name used to disambiguate duplicate display names.
    pub class_name: String,
}

/// Search rejection before any entity or solver state is touched.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExplorerCatalogSearchError {
    /// Search was requested while catalog capability was unavailable.
    Unavailable { reason: String },
    /// The caller requested no results or exceeded the host's bounded ceiling.
    InvalidLimit { limit: usize },
    /// The UTF-8 query exceeds the explicit host boundary.
    QueryTooLong { encoded_length: usize },
    /// The catalog identity projection could not initialize completely.
    Index { reason: Arc<str> },
}

impl Display for ExplorerCatalogSearchError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Unavailable { reason } => formatter.write_str(reason),
            Self::InvalidLimit { limit } => write!(
                formatter,
                "Explorer weenie search limit {limit} is outside 1..={EXPLORER_WEENIE_SEARCH_MAX_RESULTS}"
            ),
            Self::QueryTooLong { encoded_length } => write!(
                formatter,
                "Explorer weenie search query is {encoded_length} bytes; maximum is {EXPLORER_WEENIE_SEARCH_MAX_QUERY_BYTES}"
            ),
            Self::Index { reason } => {
                write!(formatter, "Explorer weenie search index failed: {reason}")
            }
        }
    }
}

impl Error for ExplorerCatalogSearchError {}

#[derive(Debug)]
struct SearchCandidate {
    result: ExplorerWeenieSearchResult,
    folded_name: String,
    folded_class_name: String,
    match_name: Utf32String,
    match_class_name: Utf32String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum MatchKind {
    Fuzzy,
    Prefix,
    Exact,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum MatchField {
    ClassName,
    DisplayName,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
struct SearchRank {
    kind: MatchKind,
    field: MatchField,
    fuzzy_score: u16,
}

#[derive(Debug)]
struct RankedCandidate<'a> {
    candidate: &'a SearchCandidate,
    rank: SearchRank,
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
    fn capability(&self) -> WeenieCatalogCapability;

    /// Resolves one exact WCID without scanning or caching template payloads.
    fn lookup(&self, wcid: u32) -> Result<Option<WeenieTemplate>, ExplorerCatalogLookupError>;

    /// Returns one complete bounded host ordering without touching entity state.
    fn search(
        &self,
        request: &ExplorerWeenieSearchRequest,
    ) -> Result<Vec<ExplorerWeenieSearchResult>, ExplorerCatalogSearchError>;
}

/// Explorer-only fuzzy search over shared optional static content.
#[derive(Debug)]
pub struct ExplorerWeenieCatalog {
    content: Arc<WeenieCatalogContent>,
    search_index: OnceLock<Result<Arc<[SearchCandidate]>, Arc<str>>>,
}

impl ExplorerWeenieCatalog {
    /// Search state belongs to Explorer; content ownership is shared with client composition.
    pub fn new(content: Arc<WeenieCatalogContent>) -> Self {
        Self {
            content,
            search_index: OnceLock::new(),
        }
    }
}

impl ExplorerWeenieCatalogSource for ExplorerWeenieCatalog {
    fn capability(&self) -> WeenieCatalogCapability {
        self.content.capability()
    }

    fn lookup(&self, wcid: u32) -> Result<Option<WeenieTemplate>, ExplorerCatalogLookupError> {
        let catalog =
            self.content
                .reader()
                .map_err(|reason| ExplorerCatalogLookupError::Unavailable {
                    reason: reason.to_owned(),
                })?;
        catalog
            .lookup(wcid)
            .map_err(ExplorerCatalogLookupError::Lookup)
    }

    fn search(
        &self,
        request: &ExplorerWeenieSearchRequest,
    ) -> Result<Vec<ExplorerWeenieSearchResult>, ExplorerCatalogSearchError> {
        let query = request.query.trim();
        validate_search_request(request.limit, query)?;
        if query.is_empty() {
            return Ok(Vec::new());
        }
        let catalog =
            self.content
                .reader()
                .map_err(|reason| ExplorerCatalogSearchError::Unavailable {
                    reason: reason.to_owned(),
                })?;
        let index = self.search_index.get_or_init(|| {
            build_search_index(catalog)
                .map(Arc::from)
                .map_err(|error| Arc::from(error.to_string()))
        });
        let index = index
            .as_ref()
            .map_err(|reason| ExplorerCatalogSearchError::Index {
                reason: Arc::clone(reason),
            })?;
        Ok(search_index(index, query, request.limit))
    }
}

fn validate_search_request(limit: usize, query: &str) -> Result<(), ExplorerCatalogSearchError> {
    if limit == 0 || limit > EXPLORER_WEENIE_SEARCH_MAX_RESULTS {
        return Err(ExplorerCatalogSearchError::InvalidLimit { limit });
    }
    if query.len() > EXPLORER_WEENIE_SEARCH_MAX_QUERY_BYTES {
        return Err(ExplorerCatalogSearchError::QueryTooLong {
            encoded_length: query.len(),
        });
    }
    Ok(())
}

fn build_search_index(
    catalog: &WeenieCatalog,
) -> Result<Vec<SearchCandidate>, CatalogIdentityReadError> {
    catalog.template_identities().map(|identities| {
        identities
            .into_iter()
            .filter_map(search_candidate)
            .collect()
    })
}

fn search_candidate(identity: WeenieTemplateIdentity) -> Option<SearchCandidate> {
    let name = identity.name?;
    let class_name = identity.class_name;
    Some(SearchCandidate {
        folded_name: name.to_lowercase(),
        folded_class_name: class_name.to_lowercase(),
        match_name: Utf32String::from(name.as_str()),
        match_class_name: Utf32String::from(class_name.as_str()),
        result: ExplorerWeenieSearchResult {
            wcid: identity.wcid,
            name,
            class_name,
        },
    })
}

fn search_index(
    index: &[SearchCandidate],
    query: &str,
    limit: usize,
) -> Vec<ExplorerWeenieSearchResult> {
    let folded_query = query.to_lowercase();
    let pattern = Atom::new(
        query,
        CaseMatching::Ignore,
        Normalization::Smart,
        AtomKind::Fuzzy,
        false,
    );
    let mut matcher = Matcher::new(Config::DEFAULT);
    let mut ranked = index
        .iter()
        .filter_map(|candidate| {
            let name_rank = rank_match(
                &folded_query,
                &candidate.folded_name,
                pattern.score(candidate.match_name.slice(..), &mut matcher),
                MatchField::DisplayName,
            );
            let class_rank = rank_match(
                &folded_query,
                &candidate.folded_class_name,
                pattern.score(candidate.match_class_name.slice(..), &mut matcher),
                MatchField::ClassName,
            );
            name_rank
                .max(class_rank)
                .map(|rank| RankedCandidate { candidate, rank })
        })
        .collect::<Vec<_>>();
    ranked.sort_unstable_by(|left, right| {
        right
            .rank
            .cmp(&left.rank)
            .then_with(|| left.candidate.result.wcid.cmp(&right.candidate.result.wcid))
    });
    ranked
        .into_iter()
        .take(limit)
        .map(|ranked| ranked.candidate.result.clone())
        .collect()
}

fn rank_match(
    folded_query: &str,
    folded_candidate: &str,
    fuzzy_score: Option<u16>,
    field: MatchField,
) -> Option<SearchRank> {
    if folded_candidate == folded_query {
        return Some(SearchRank {
            kind: MatchKind::Exact,
            field,
            fuzzy_score: u16::MAX,
        });
    }
    if folded_candidate.starts_with(folded_query) {
        return Some(SearchRank {
            kind: MatchKind::Prefix,
            field,
            fuzzy_score: u16::MAX,
        });
    }
    fuzzy_score.map(|fuzzy_score| SearchRank {
        kind: MatchKind::Fuzzy,
        field,
        fuzzy_score,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_content::WeenieCatalogUnavailableKind;
    use holtburger_content::weenie_catalog::WEENIE_CATALOG_FILE_NAME as CATALOG_FILE_NAME;
    use holtburger_weenie_catalog::{TemplatePhysics, WeenieTemplate, write_catalog_atomic};
    use std::path::{Path, PathBuf};
    use tempfile::tempdir;

    fn discover_catalog(
        content: Option<&Path>,
        override_path: Option<PathBuf>,
    ) -> ExplorerWeenieCatalog {
        ExplorerWeenieCatalog::new(Arc::new(WeenieCatalogContent::discover(
            content,
            override_path,
        )))
    }

    fn template(wcid: u32) -> WeenieTemplate {
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
    fn shared_catalog_parses_native_switch_index_and_rejects_invalid_types() {
        use holtburger_common::properties::WeenieType;
        let directory = tempdir().unwrap();
        let path = directory.path().join(CATALOG_FILE_NAME);
        let mut switch = template(286);
        switch.weenie_type = WeenieType::Switch as i32;
        write_catalog_atomic(&path, &[switch.clone()]).unwrap();
        let content = WeenieCatalogContent::discover(None, Some(path.clone()));
        let types = content.types().expect("parsed metadata");
        assert_eq!(types.get(286), Some(WeenieType::Switch));
        assert_eq!(types.get(999), None);
        switch.weenie_type = i32::MAX;
        write_catalog_atomic(&path, &[switch]).unwrap();
        let invalid = WeenieCatalogContent::discover(None, Some(path));
        assert!(matches!(
            invalid.capability(),
            WeenieCatalogCapability::Unavailable {
                kind: WeenieCatalogUnavailableKind::Invalid,
                ..
            }
        ));
        assert!(invalid.types().is_none());
    }

    #[test]
    fn directory_and_hba_selections_choose_only_the_canonical_sibling_name() {
        let directory = tempdir().unwrap();
        let path = directory.path().join(CATALOG_FILE_NAME);
        write_catalog_atomic(&path, &[template(42)]).unwrap();

        for selected in [directory.path(), &directory.path().join("client.hba")] {
            let catalog = discover_catalog(Some(selected), None);
            assert!(matches!(
                catalog.capability(),
                WeenieCatalogCapability::Available { path: selected, .. } if selected == path
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

        let catalog = discover_catalog(Some(&selected), Some(override_path.clone()));
        assert!(matches!(
            catalog.capability(),
            WeenieCatalogCapability::Available { path, .. } if path == override_path
        ));
        assert!(catalog.lookup(1).unwrap().is_none());
        assert_eq!(catalog.lookup(2).unwrap(), Some(template(2)));
    }

    #[test]
    fn absence_and_invalid_selected_files_have_distinct_exact_capabilities() {
        let directory = tempdir().unwrap();
        let missing = discover_catalog(Some(directory.path()), None);
        assert!(matches!(
            missing.capability(),
            WeenieCatalogCapability::Unavailable {
                kind: WeenieCatalogUnavailableKind::Missing,
                ..
            }
        ));

        let path = directory.path().join(CATALOG_FILE_NAME);
        std::fs::write(&path, b"not a catalog").unwrap();
        let invalid = discover_catalog(Some(directory.path()), None);
        assert!(matches!(
            invalid.capability(),
            WeenieCatalogCapability::Unavailable {
                path: Some(selected),
                kind: WeenieCatalogUnavailableKind::Invalid,
                reason,
            } if selected == path && reason.contains("corrupt")
        ));
    }

    #[test]
    fn search_prioritizes_exact_prefix_and_fuzzy_display_names_deterministically() {
        let directory = tempdir().unwrap();
        let path = directory.path().join(CATALOG_FILE_NAME);
        let mut first = template(20);
        first.name = Some("Rynthid Assessment Crystal".to_owned());
        first.class_name = "rynthid_assessment_crystal_b".to_owned();
        let mut second = template(10);
        second.name = Some("Rynthid Assessment Crystal".to_owned());
        second.class_name = "rynthid_assessment_crystal_a".to_owned();
        let mut prefix = template(30);
        prefix.name = Some("Rynthid Assessment Device".to_owned());
        prefix.class_name = "assessment_device".to_owned();
        write_catalog_atomic(&path, &[first, prefix, second]).unwrap();
        let catalog = discover_catalog(Some(directory.path()), None);

        let exact = catalog
            .search(&ExplorerWeenieSearchRequest {
                query: "rYnThId AsSeSsMeNt CrYsTaL".to_owned(),
                limit: 3,
            })
            .unwrap();
        assert_eq!(
            exact.iter().map(|result| result.wcid).collect::<Vec<_>>(),
            [10, 20]
        );

        let prefix = catalog
            .search(&ExplorerWeenieSearchRequest {
                query: "Rynthid Assessment".to_owned(),
                limit: 2,
            })
            .unwrap();
        assert_eq!(
            prefix.iter().map(|result| result.wcid).collect::<Vec<_>>(),
            [10, 20]
        );

        let fuzzy = catalog
            .search(&ExplorerWeenieSearchRequest {
                query: "Rynthd Crystal".to_owned(),
                limit: 3,
            })
            .unwrap();
        assert_eq!(
            fuzzy.iter().map(|result| result.wcid).collect::<Vec<_>>(),
            [10, 20]
        );
    }

    #[test]
    fn exact_class_name_beats_fuzzy_display_name_without_exposing_scores() {
        let directory = tempdir().unwrap();
        let path = directory.path().join(CATALOG_FILE_NAME);
        let mut by_name = template(1);
        by_name.name = Some("Rynthid Device".to_owned());
        by_name.class_name = "ordinary_device".to_owned();
        let mut by_class = template(2);
        by_class.name = Some("Unrelated Object".to_owned());
        by_class.class_name = "rynthid_device".to_owned();
        write_catalog_atomic(&path, &[by_name, by_class]).unwrap();
        let catalog = discover_catalog(Some(directory.path()), None);

        let results = catalog
            .search(&ExplorerWeenieSearchRequest {
                query: "rynthid_device".to_owned(),
                limit: 2,
            })
            .unwrap();

        assert_eq!(results[0].wcid, 2);
        assert_eq!(results[0].class_name, "rynthid_device");
    }

    #[test]
    fn exact_names_precede_low_wcid_prefixes_then_prefixes_use_wcid_order() {
        let directory = tempdir().unwrap();
        let path = directory.path().join(CATALOG_FILE_NAME);
        let mut worker = template(3);
        worker.name = Some("Olthoi Worker".to_owned());
        worker.class_name = "olthoiworker".to_owned();
        let mut exact = template(42_906);
        exact.name = Some("Olthoi".to_owned());
        exact.class_name = "ace42906-olthoi".to_owned();
        let mut abdomen = template(25_551);
        abdomen.name = Some("Olthoi Abdomen Fragment".to_owned());
        abdomen.class_name = "olthoiabdomenfragmentrot2".to_owned();
        write_catalog_atomic(&path, &[abdomen, exact, worker]).unwrap();
        let catalog = discover_catalog(Some(directory.path()), None);

        let results = catalog
            .search(&ExplorerWeenieSearchRequest {
                query: "Olthoi".to_owned(),
                limit: 32,
            })
            .unwrap();

        assert_eq!(
            results.iter().map(|result| result.wcid).collect::<Vec<_>>(),
            [42_906, 3, 25_551]
        );
    }

    #[test]
    fn search_validates_bounds_and_keeps_empty_queries_empty() {
        let directory = tempdir().unwrap();
        let path = directory.path().join(CATALOG_FILE_NAME);
        write_catalog_atomic(&path, &[template(1)]).unwrap();
        let catalog = discover_catalog(Some(directory.path()), None);

        assert!(
            catalog
                .search(&ExplorerWeenieSearchRequest {
                    query: "  ".to_owned(),
                    limit: 1,
                })
                .unwrap()
                .is_empty()
        );
        assert!(
            catalog
                .search(&ExplorerWeenieSearchRequest {
                    query: format!("  {}  ", "x".repeat(EXPLORER_WEENIE_SEARCH_MAX_QUERY_BYTES)),
                    limit: 1,
                })
                .is_ok()
        );
        assert!(matches!(
            catalog.search(&ExplorerWeenieSearchRequest {
                query: "Template".to_owned(),
                limit: 0,
            }),
            Err(ExplorerCatalogSearchError::InvalidLimit { limit: 0 })
        ));
        assert!(matches!(
            catalog.search(&ExplorerWeenieSearchRequest {
                query: "x".repeat(EXPLORER_WEENIE_SEARCH_MAX_QUERY_BYTES + 1),
                limit: 1,
            }),
            Err(ExplorerCatalogSearchError::QueryTooLong { .. })
        ));
    }

    #[test]
    fn unavailable_catalog_and_cached_index_failure_remain_loud() {
        let directory = tempdir().unwrap();
        let missing = discover_catalog(Some(directory.path()), None);
        assert!(matches!(
            missing.search(&ExplorerWeenieSearchRequest {
                query: "anything".to_owned(),
                limit: 1,
            }),
            Err(ExplorerCatalogSearchError::Unavailable { .. })
        ));

        let path = directory.path().join(CATALOG_FILE_NAME);
        let value = template(7);
        write_catalog_atomic(&path, std::slice::from_ref(&value)).unwrap();
        let catalog = discover_catalog(Some(directory.path()), None);
        let mut bytes = std::fs::read(&path).unwrap();
        let payload_offset = u64::from_le_bytes(bytes[24..32].try_into().unwrap()) as usize;
        let name_tag_offset = payload_offset + 4 + 4 + 4 + value.class_name.len();
        bytes[name_tag_offset] = 3;
        std::fs::write(path, bytes).unwrap();

        let request = ExplorerWeenieSearchRequest {
            query: "Template".to_owned(),
            limit: 1,
        };
        let first = catalog.search(&request).unwrap_err();
        let second = catalog.search(&request).unwrap_err();
        assert!(matches!(first, ExplorerCatalogSearchError::Index { .. }));
        assert_eq!(first, second);
        assert!(first.to_string().contains("invalid option tag 3"));
    }
}
