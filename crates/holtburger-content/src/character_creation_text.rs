//! Reference prose for character creation, independent of frontend layout and game rules.

use anyhow::{Context, Result, bail, ensure};
use binrw::BinRead;
use holtburger_common::legacy_hash::legacy_string_hash;
use holtburger_dat::{EOR_LANGUAGE_NAMESPACE, ResourceKey, file_type::StringTable};
use std::{collections::BTreeMap, io::Cursor};

/// Retail's character-generation localization table, distinct from the title table.
pub const CREATION_STRING_TABLE_ID: u32 = 0x2300_0002;

/// Retail attribute help in protocol tuple order (acclient.c:476563, InqAttributeDescription).
pub const CREATION_ATTRIBUTE_DESCRIPTIONS: [&str; 6] = [
    "Measures your character's muscular power.",
    "Measures how healthy your character is.",
    "Measures your character's reflexes.",
    "Measures how fast your character is.",
    "Measures your character's mind and senses.",
    "Measures your character's willpower.",
];

/// Authored lore paragraphs keyed by heritage identity, without layout or markup.
pub struct CharacterCreationText {
    lore: BTreeMap<u32, Vec<String>>,
}

impl CharacterCreationText {
    /// Join the retail heritage-token mapping to the localized text. All offered races need lore.
    pub fn from_table(table: &StringTable) -> Result<Self> {
        ensure!(
            table.id == CREATION_STRING_TABLE_ID,
            "Unexpected creation string table {:#010x}",
            table.id
        );
        let mut entries = BTreeMap::new();
        for entry in &table.entries {
            ensure!(
                entries.insert(entry.id, entry).is_none(),
                "Duplicate creation string hash {:#010x}",
                entry.id
            );
        }
        // gmCGHeritagePage::Update, acclient.c:182584–182835. Both shadow heritages share prose.
        let tokens = [
            "Aluvian",
            "Garu",
            "Sho",
            "Via",
            "Shad",
            "Gear",
            "AunT",
            "Lug",
            "Emp",
            "Shad",
            "Und",
            "Olthoi",
            "OlthoiAcid",
        ];
        let mut lore = BTreeMap::new();
        for (index, token) in tokens.iter().enumerate() {
            let token = format!("ID_CharGen_{token}Text");
            let text = entries
                .get(&legacy_string_hash(token.as_bytes()))
                .and_then(|entry| entry.strings.first())
                .with_context(|| format!("Missing creation lore {token}"))?;
            // Retail strings contain literal escape pairs. Preserve paragraphs as plain text.
            let paragraphs: Vec<String> = text
                .replace("\\n", "\n")
                .replace("\r\n", "\n")
                .split("\n\n")
                .map(str::trim)
                .filter(|text| !text.is_empty())
                .map(str::to_owned)
                .collect();
            ensure!(!paragraphs.is_empty(), "Empty creation lore {token}");
            lore.insert(index as u32 + 1, paragraphs);
        }
        Ok(Self { lore })
    }

    /// The host consumes these paragraphs for the selected heritage's Race page.
    pub fn lore(&self, heritage: u32) -> Result<&[String]> {
        match self.lore.get(&heritage) {
            Some(paragraphs) => Ok(paragraphs),
            None => bail!("No creation lore mapping for heritage {heritage}"),
        }
    }
}

impl crate::ContentRepository {
    /// Load creation reference text once when projecting the static creator catalog.
    pub fn read_character_creation_text(&self) -> Result<CharacterCreationText> {
        let table = self
            .read_resource(ResourceKey::new(
                EOR_LANGUAGE_NAMESPACE,
                CREATION_STRING_TABLE_ID,
            ))?
            .decode(|bytes| Ok(StringTable::read_le(&mut Cursor::new(bytes))?))?;
        CharacterCreationText::from_table(&table)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_dat::file_type::StringTableData;

    fn table() -> StringTable {
        let tokens = [
            "Aluvian",
            "Garu",
            "Sho",
            "Via",
            "Shad",
            "Gear",
            "AunT",
            "Lug",
            "Emp",
            "Und",
            "Olthoi",
            "OlthoiAcid",
        ];
        StringTable {
            id: CREATION_STRING_TABLE_ID,
            language: 1,
            unknown: 0,
            entries: tokens
                .iter()
                .map(|token| StringTableData {
                    id: legacy_string_hash(format!("ID_CharGen_{token}Text").as_bytes()),
                    variable_names: vec![],
                    variables: vec![],
                    strings: vec![format!("{token} lore\\n\\nSecond paragraph.\\n\\n")],
                    comments: vec![],
                    unknown: 0,
                })
                .collect(),
        }
    }

    #[test]
    fn joins_all_heritages_and_preserves_authored_paragraphs() {
        let catalog = CharacterCreationText::from_table(&table()).unwrap();
        for heritage in 1..=13 {
            assert_eq!(catalog.lore(heritage).unwrap().len(), 2);
        }
        assert_eq!(catalog.lore(5).unwrap(), catalog.lore(10).unwrap());
        assert_eq!(
            catalog.lore(1).unwrap(),
            ["Aluvian lore", "Second paragraph."]
        );
        assert!(catalog.lore(14).is_err());
    }

    #[test]
    fn rejects_wrong_table_missing_empty_and_duplicate_entries() {
        let mut wrong = table();
        wrong.id = StringTable::FILE_ID;
        assert!(CharacterCreationText::from_table(&wrong).is_err());
        let mut missing = table();
        missing.entries.remove(0);
        assert!(CharacterCreationText::from_table(&missing).is_err());
        let mut empty = table();
        empty.entries[0].strings = vec!["\\n\\n".into()];
        assert!(CharacterCreationText::from_table(&empty).is_err());
        let mut duplicate = table();
        duplicate.entries.push(duplicate.entries[0].clone());
        assert!(CharacterCreationText::from_table(&duplicate).is_err());
    }
}
