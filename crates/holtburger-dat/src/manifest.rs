use crate::file_type::{DatFileType, SkillTable, SpellTable, XpTable};
use std::collections::HashSet;

/// A manifest that defines which file IDs and file types should be kept when stripping archives.
pub struct StripperManifest {
    pub keep_types: HashSet<DatFileType>,
    pub keep_ids: HashSet<u32>,
}

impl StripperManifest {
    /// Returns the default manifest for a "Logic/Physics Only" (Lite) archive.
    pub fn logic_only() -> Self {
        Self {
            keep_types: HashSet::from([
                DatFileType::Model,
                DatFileType::SetupModel,
                DatFileType::EnvCell,
                DatFileType::Table,
                DatFileType::Region,
                DatFileType::PhysicsScript,
                DatFileType::PhysicsScriptTable,
                DatFileType::Landblock,
                DatFileType::LandblockInfo,
                DatFileType::IndoorCell,
            ]),
            keep_ids: HashSet::new(),
        }
    }

    /// Returns the exact-ID manifest for the current TUI-oriented micro archive.
    pub fn micro() -> Self {
        Self {
            keep_types: HashSet::new(),
            keep_ids: HashSet::from([SkillTable::FILE_ID, SpellTable::FILE_ID, XpTable::FILE_ID]),
        }
    }

    /// Returns true if the given file type should be kept according to this manifest.
    pub fn should_keep(&self, file_type: DatFileType) -> bool {
        self.keep_types.contains(&file_type)
    }

    /// Returns true if the given file should be kept according to this manifest.
    pub fn should_keep_file(&self, id: u32, file_type: DatFileType) -> bool {
        self.keep_ids.contains(&id) || self.keep_types.contains(&file_type)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn logic_manifest_keeps_table_type_without_exact_id() {
        let manifest = StripperManifest::logic_only();

        assert!(manifest.should_keep(DatFileType::Table));
        assert!(manifest.should_keep_file(0x0E00ABCD, DatFileType::Table));
        assert!(!manifest.keep_ids.contains(&0x0E00ABCD));
    }

    #[test]
    fn micro_manifest_keeps_only_expected_exact_ids() {
        let manifest = StripperManifest::micro();

        assert!(manifest.should_keep_file(SkillTable::FILE_ID, DatFileType::Table));
        assert!(manifest.should_keep_file(SpellTable::FILE_ID, DatFileType::Table));
        assert!(manifest.should_keep_file(XpTable::FILE_ID, DatFileType::Table));
        assert!(!manifest.should_keep_file(0x0E000099, DatFileType::Table));
        assert!(!manifest.should_keep_file(0x01000001, DatFileType::Model));
    }
}
