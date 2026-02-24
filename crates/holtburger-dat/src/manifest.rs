use crate::file_type::DatFileType;
use std::collections::HashSet;

/// A manifest that defines which file types should be kept when stripping archives.
pub struct StripperManifest {
    pub keep_types: HashSet<DatFileType>,
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
        }
    }

    /// Returns true if the given file type should be kept according to this manifest.
    pub fn should_keep(&self, file_type: DatFileType) -> bool {
        self.keep_types.contains(&file_type)
    }
}
