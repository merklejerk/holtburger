use crate::EOR_PORTAL_NAMESPACE;
use crate::file_type::{CharGen, ChatPoseTable, DatFileType, SkillTable, SpellTable, XpTable};

/// Portal file types that carry the motion representation every profile ships completely.
///
/// Motion tables and animations hold the authored program; setup models declare the motion table an
/// object installs by default. They are namespaced because file types are inferred from the id
/// prefix: `0x09......` is a motion table under `eor/portal` and a cell record under `eor/cell`.
const MOTION_CONTENT_TYPES: [DatFileType; 3] = [
    DatFileType::MotionTable,
    DatFileType::Animation,
    DatFileType::SetupModel,
];

/// A manifest that defines which file IDs and file types should be kept when stripping archives.
pub struct StripperManifest {
    pub keep_rules: Vec<ManifestRule>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ManifestRule {
    pub namespace: Option<String>,
    pub file_type: Option<DatFileType>,
    pub file_id: Option<u32>,
}

impl Default for StripperManifest {
    fn default() -> Self {
        Self::new()
    }
}

impl StripperManifest {
    /// Returns the default manifest for a "Logic/Physics Only" (Lite) archive.
    pub fn logic_only() -> Self {
        let mut manifest = Self::new();
        manifest.keep_motion_content();
        for file_type in [
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
        ] {
            manifest.keep_type(file_type);
        }

        manifest
    }

    /// Returns the manifest for the current TUI-oriented micro archive.
    pub fn micro() -> Self {
        let mut manifest = Self::new();
        manifest.keep_motion_content();
        for file_id in [
            CharGen::FILE_ID,
            ChatPoseTable::FILE_ID,
            SkillTable::FILE_ID,
            SpellTable::FILE_ID,
            XpTable::FILE_ID,
        ] {
            manifest.keep_namespaced_file(EOR_PORTAL_NAMESPACE, file_id);
        }

        manifest
    }

    pub fn new() -> Self {
        Self {
            keep_rules: Vec::new(),
        }
    }

    /// Keeps the complete motion representation.
    ///
    /// Every profile carries it, so a resolver never has to distinguish "this profile legitimately
    /// omits this motion fact" from "this archive is corrupt" — absence always means corrupt.
    /// Records are still pruned to simulation facts in small profiles; that reduction is declared
    /// per record in archive metadata rather than implied by the profile.
    fn keep_motion_content(&mut self) {
        for file_type in MOTION_CONTENT_TYPES {
            self.keep_namespaced_type(EOR_PORTAL_NAMESPACE, file_type);
        }
    }

    pub fn keep_type(&mut self, file_type: DatFileType) {
        self.keep_rules.push(ManifestRule {
            namespace: None,
            file_type: Some(file_type),
            file_id: None,
        });
    }

    pub fn keep_file(&mut self, file_id: u32) {
        self.keep_rules.push(ManifestRule {
            namespace: None,
            file_type: None,
            file_id: Some(file_id),
        });
    }

    pub fn keep_namespaced_type(&mut self, namespace: &str, file_type: DatFileType) {
        self.keep_rules.push(ManifestRule {
            namespace: Some(namespace.to_string()),
            file_type: Some(file_type),
            file_id: None,
        });
    }

    pub fn keep_namespaced_file(&mut self, namespace: &str, file_id: u32) {
        self.keep_rules.push(ManifestRule {
            namespace: Some(namespace.to_string()),
            file_type: None,
            file_id: Some(file_id),
        });
    }

    pub fn should_keep_entry(&self, namespace: &str, id: u32, file_type: DatFileType) -> bool {
        self.keep_rules.iter().any(|rule| {
            rule.namespace
                .as_deref()
                .is_none_or(|value| value == namespace)
                && rule.file_id.is_none_or(|value| value == id)
                && rule.file_type.is_none_or(|value| value == file_type)
        })
    }

    /// Returns true if the given file type should be kept according to this manifest.
    pub fn should_keep(&self, file_type: DatFileType) -> bool {
        self.keep_rules.iter().any(|rule| {
            rule.namespace.is_none() && rule.file_id.is_none() && rule.file_type == Some(file_type)
        })
    }

    /// Returns true if the given file should be kept according to this manifest.
    pub fn should_keep_file(&self, id: u32, file_type: DatFileType) -> bool {
        self.keep_rules.iter().any(|rule| {
            rule.namespace.is_none()
                && rule.file_id.is_none_or(|value| value == id)
                && rule.file_type.is_none_or(|value| value == file_type)
        })
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
        assert!(!manifest.should_keep_file(0x0A000001, DatFileType::Audio));
    }

    #[test]
    fn micro_manifest_keeps_the_required_table_ids() {
        let manifest = StripperManifest::micro();

        assert!(manifest.should_keep_entry(
            EOR_PORTAL_NAMESPACE,
            CharGen::FILE_ID,
            DatFileType::Table
        ));
        assert!(manifest.should_keep_entry(
            EOR_PORTAL_NAMESPACE,
            ChatPoseTable::FILE_ID,
            DatFileType::Table
        ));
        assert!(manifest.should_keep_entry(
            EOR_PORTAL_NAMESPACE,
            SkillTable::FILE_ID,
            DatFileType::Table
        ));
        assert!(manifest.should_keep_entry(
            EOR_PORTAL_NAMESPACE,
            SpellTable::FILE_ID,
            DatFileType::Table
        ));
        assert!(manifest.should_keep_entry(
            EOR_PORTAL_NAMESPACE,
            XpTable::FILE_ID,
            DatFileType::Table
        ));
        assert!(!manifest.should_keep_entry(EOR_PORTAL_NAMESPACE, 0x0E000099, DatFileType::Table));
        assert!(!manifest.should_keep_entry(EOR_PORTAL_NAMESPACE, 0x01000001, DatFileType::Model));
    }

    #[test]
    fn every_profile_keeps_the_complete_motion_representation() {
        for manifest in [StripperManifest::micro(), StripperManifest::logic_only()] {
            assert!(manifest.should_keep_entry(
                EOR_PORTAL_NAMESPACE,
                0x09000001,
                DatFileType::MotionTable
            ));
            assert!(manifest.should_keep_entry(
                EOR_PORTAL_NAMESPACE,
                0x03000003,
                DatFileType::Animation
            ));
            assert!(manifest.should_keep_entry(
                EOR_PORTAL_NAMESPACE,
                0x02000F30,
                DatFileType::SetupModel
            ));
            // Cell records share the motion-table id prefix and are not motion content.
            assert!(!manifest.should_keep_entry("eor/cell", 0x09050100, DatFileType::MotionTable));
        }
    }

    #[test]
    fn namespaced_manifest_rules_can_target_custom_assets() {
        let mut manifest = StripperManifest::new();
        manifest.keep_namespaced_type("derived/test", DatFileType::Custom);

        assert!(manifest.should_keep_entry("derived/test", 0xDEADBEEF, DatFileType::Custom));
        assert!(!manifest.should_keep_entry(EOR_PORTAL_NAMESPACE, 0xDEADBEEF, DatFileType::Custom));
    }
}
