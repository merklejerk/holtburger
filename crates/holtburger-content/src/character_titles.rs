//! Localized character-title reference data assembled from portal and language resources.

use holtburger_common::legacy_hash::legacy_string_hash;
use holtburger_dat::file_type::{EnumMapper, StringTable};
use std::collections::{BTreeMap, HashMap};

/// Immutable character-title lookup assembled once while building client content.
#[derive(Debug, Clone, Default)]
pub struct CharacterTitleCatalog {
    titles: BTreeMap<u32, String>,
}

impl CharacterTitleCatalog {
    /// Joins retail's numeric title mapper to its hash-addressed localized string table.
    pub fn from_assets(
        mapper: &EnumMapper,
        strings: &StringTable,
    ) -> Result<Self, CharacterTitleCatalogError> {
        if mapper.id != EnumMapper::FILE_ID {
            return Err(CharacterTitleCatalogError::UnexpectedMapperId(mapper.id));
        }
        if strings.id != StringTable::FILE_ID {
            return Err(CharacterTitleCatalogError::UnexpectedStringTableId(
                strings.id,
            ));
        }

        let mut strings_by_hash = HashMap::with_capacity(strings.entries.len());
        for entry in &strings.entries {
            if strings_by_hash.insert(entry.id, entry).is_some() {
                return Err(CharacterTitleCatalogError::DuplicateStringHash(entry.id));
            }
        }

        let mut titles = BTreeMap::new();
        for (&title_id, token) in &mapper.entries {
            // Retail rejects title zero before consulting either content table.
            if title_id == 0 {
                continue;
            }
            if !token.is_ascii() {
                return Err(CharacterTitleCatalogError::NonAsciiToken {
                    title_id,
                    token: token.clone(),
                });
            }

            let hash = legacy_string_hash(token.as_bytes());
            let Some(title) = strings_by_hash
                .get(&hash)
                .and_then(|entry| entry.strings.first())
                .filter(|title| !title.is_empty())
            else {
                // Retail treats an absent table row or absent first string as a lookup miss.
                continue;
            };
            titles.insert(title_id, title.clone());
        }

        Ok(Self { titles })
    }

    /// Returns the localized display title for a nonzero retail title identifier.
    pub fn title(&self, title_id: u32) -> Option<&str> {
        if title_id == 0 {
            return None;
        }
        self.titles.get(&title_id).map(String::as_str)
    }
}

/// Static-content inconsistencies that make title resolution nondeterministic or inexact.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum CharacterTitleCatalogError {
    #[error(
        "character-title catalog expected enum mapper {expected:#010x}, found {0:#010x}",
        expected = EnumMapper::FILE_ID
    )]
    UnexpectedMapperId(u32),
    #[error(
        "character-title catalog expected string table {expected:#010x}, found {0:#010x}",
        expected = StringTable::FILE_ID
    )]
    UnexpectedStringTableId(u32),
    #[error("character-title string table contains duplicate hash {0:#010x}")]
    DuplicateStringHash(u32),
    #[error("character-title ID {title_id} has non-ASCII mapper token {token:?}")]
    NonAsciiToken { title_id: u32, token: String },
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_dat::file_type::StringTableData;

    fn mapper(entries: &[(u32, &str)]) -> EnumMapper {
        EnumMapper {
            id: EnumMapper::FILE_ID,
            base_enum_map: 0,
            numbering: 0,
            entries: entries
                .iter()
                .map(|(id, token)| (*id, (*token).to_owned()))
                .collect(),
        }
    }

    fn string_entry(token: &str, strings: &[&str]) -> StringTableData {
        StringTableData {
            id: legacy_string_hash(token.as_bytes()),
            variable_names: Vec::new(),
            variables: Vec::new(),
            strings: strings.iter().map(|value| (*value).to_owned()).collect(),
            comments: Vec::new(),
            unknown: 0,
        }
    }

    fn table(entries: Vec<StringTableData>) -> StringTable {
        StringTable {
            id: StringTable::FILE_ID,
            language: 1,
            unknown: 0,
            entries,
        }
    }

    #[test]
    fn joins_title_id_to_first_localized_string() {
        let catalog = CharacterTitleCatalog::from_assets(
            &mapper(&[(42, "GemSeller")]),
            &table(vec![string_entry(
                "GemSeller",
                &["Gem Seller", "Unused variant"],
            )]),
        )
        .unwrap();

        assert_eq!(catalog.title(42), Some("Gem Seller"));
    }

    #[test]
    fn zero_unknown_missing_and_empty_titles_are_lookup_misses() {
        let catalog = CharacterTitleCatalog::from_assets(
            &mapper(&[(0, "Invalid"), (1, "Missing"), (2, "Empty")]),
            &table(vec![string_entry("Empty", &[""])]),
        )
        .unwrap();

        assert_eq!(catalog.title(0), None);
        assert_eq!(catalog.title(1), None);
        assert_eq!(catalog.title(2), None);
        assert_eq!(catalog.title(99), None);
    }

    #[test]
    fn rejects_duplicate_string_hashes_and_inexact_tokens() {
        let duplicate = string_entry("Duplicate", &["First"]);
        let error = CharacterTitleCatalog::from_assets(
            &mapper(&[(1, "Duplicate")]),
            &table(vec![duplicate.clone(), duplicate]),
        )
        .unwrap_err();
        assert!(matches!(
            error,
            CharacterTitleCatalogError::DuplicateStringHash(_)
        ));

        let error =
            CharacterTitleCatalog::from_assets(&mapper(&[(1, "Caf\u{e9}")]), &table(Vec::new()))
                .unwrap_err();
        assert!(matches!(
            error,
            CharacterTitleCatalogError::NonAsciiToken { title_id: 1, .. }
        ));
    }

    #[test]
    fn rejects_records_from_the_wrong_static_keys() {
        let mut wrong_mapper = mapper(&[]);
        wrong_mapper.id -= 1;
        assert_eq!(
            CharacterTitleCatalog::from_assets(&wrong_mapper, &table(Vec::new())).unwrap_err(),
            CharacterTitleCatalogError::UnexpectedMapperId(EnumMapper::FILE_ID - 1)
        );

        let mut wrong_strings = table(Vec::new());
        wrong_strings.id -= 1;
        assert_eq!(
            CharacterTitleCatalog::from_assets(&mapper(&[]), &wrong_strings).unwrap_err(),
            CharacterTitleCatalogError::UnexpectedStringTableId(StringTable::FILE_ID - 1)
        );
    }
}
