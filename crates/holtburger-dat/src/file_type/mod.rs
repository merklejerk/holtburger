pub mod animation;
pub mod char_gen;
pub mod chat_pose_table;
pub mod env_cell;
pub mod gfx_obj;
pub mod motion_kinematics;
pub mod motion_table;
pub mod setup_model;
pub mod skill_table;
pub mod spell_table;
pub mod xp_table;

pub use animation::Animation;
pub use char_gen::CharGen;
pub use chat_pose_table::{ChatEmoteData, ChatPoseTable};
pub use env_cell::EnvCell;
pub use gfx_obj::GfxObj;
pub use motion_kinematics::{MotionKinematics, MotionKinematicsTable};
pub use motion_table::{MotionCommandKinematics, MotionTable, MotionTableMovementProfile};
pub use setup_model::SetupModel;
pub use skill_table::SkillTable;
pub use spell_table::SpellTable;
pub use xp_table::XpTable;

use std::fmt;

pub const MOTION_KINEMATICS_TYPE_ID: u32 = 0xFFFF_FF01;

#[repr(u32)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum DatFileType {
    // Portal Range (Top Byte)
    Model = 0x01,
    SetupModel = 0x02,
    Animation = 0x03,
    Palette = 0x04,
    SurfaceTexture = 0x05,
    Texture = 0x06,
    Surface = 0x08,
    MotionTable = 0x09,
    Audio = 0x0A,
    EnvCell = 0x0D,
    Table = 0x0E,
    Clothing = 0x10,
    Scene = 0x12,
    Region = 0x13,
    CombatManeuverTable = 0x30,
    PhysicsScript = 0x33,
    PhysicsScriptTable = 0x34,
    LanguageString = 0x31,
    Font = 0x40,
    Custom = 0xFFFF_FF00,
    MotionKinematics = MOTION_KINEMATICS_TYPE_ID,

    // Cell Range (Suffix)
    Landblock = 0xFE, // XXYYFFFF (using FE as internal marker for simplicity or specific logic)
    LandblockInfo = 0xFF, // XXYYFFFE
    IndoorCell = 0xFD, // XXYY0001 - XXYYFFFD
    Iteration = 0xFE01, // 0xFFFF0001 - Special DAT metadata record

    Unknown = 0x00,
}

impl DatFileType {
    pub fn is_essential(&self) -> bool {
        matches!(
            self,
            DatFileType::Model
                | DatFileType::SetupModel
                | DatFileType::MotionTable
                | DatFileType::EnvCell
                | DatFileType::Table
                | DatFileType::Region
                | DatFileType::CombatManeuverTable
                | DatFileType::PhysicsScript
                | DatFileType::PhysicsScriptTable
                | DatFileType::Landblock
                | DatFileType::LandblockInfo
                | DatFileType::IndoorCell
        )
    }

    pub fn from_id(id: u32) -> Self {
        // Special internal files
        if id == 0xFFFF0001 {
            return DatFileType::Iteration;
        }

        // Check Cell DAT suffixes first (high priority)
        let suffix = id & 0xFFFF;
        if suffix == 0xFFFF {
            return DatFileType::Landblock;
        }
        if suffix == 0xFFFE {
            return DatFileType::LandblockInfo;
        }

        // Check Portal prefixes
        let prefix = (id >> 24) as u8;
        match prefix {
            0x01 => DatFileType::Model,
            0x02 => DatFileType::SetupModel,
            0x03 => DatFileType::Animation,
            0x04 => DatFileType::Palette,
            0x05 => DatFileType::SurfaceTexture,
            0x06 | 0x07 => DatFileType::Texture,
            0x08 => DatFileType::Surface,
            0x09 => DatFileType::MotionTable,
            0x0A => DatFileType::Audio,
            0x0D => DatFileType::EnvCell,
            0x0E => DatFileType::Table,
            0x10 => DatFileType::Clothing,
            0x12 => DatFileType::Scene,
            0x13 => DatFileType::Region,
            0x30 => DatFileType::CombatManeuverTable,
            0x33 => DatFileType::PhysicsScript,
            0x34 => DatFileType::PhysicsScriptTable,
            0x31 => DatFileType::LanguageString,
            0x40 => DatFileType::Font,
            _ => {
                if suffix > 0 && suffix < 0xFFFE {
                    DatFileType::IndoorCell
                } else {
                    DatFileType::Unknown
                }
            }
        }
    }

    pub fn from_type_id(type_id: u32) -> Self {
        match type_id {
            0x01 => DatFileType::Model,
            0x02 => DatFileType::SetupModel,
            0x03 => DatFileType::Animation,
            0x04 => DatFileType::Palette,
            0x05 => DatFileType::SurfaceTexture,
            0x06 => DatFileType::Texture,
            0x08 => DatFileType::Surface,
            0x09 => DatFileType::MotionTable,
            0x0A => DatFileType::Audio,
            0x0D => DatFileType::EnvCell,
            0x0E => DatFileType::Table,
            0x10 => DatFileType::Clothing,
            0x12 => DatFileType::Scene,
            0x13 => DatFileType::Region,
            0x30 => DatFileType::CombatManeuverTable,
            0x31 => DatFileType::LanguageString,
            0x33 => DatFileType::PhysicsScript,
            0x34 => DatFileType::PhysicsScriptTable,
            0x40 => DatFileType::Font,
            0xFD => DatFileType::IndoorCell,
            0xFE => DatFileType::Landblock,
            0xFE01 => DatFileType::Iteration,
            0xFF => DatFileType::LandblockInfo,
            0xFFFF_FF00 => DatFileType::Custom,
            MOTION_KINEMATICS_TYPE_ID => DatFileType::MotionKinematics,
            _ => DatFileType::Unknown,
        }
    }
}

impl fmt::Display for DatFileType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let name = match self {
            DatFileType::Model => "Model (OBJ)",
            DatFileType::SetupModel => "SetupModel (SET)",
            DatFileType::Animation => "Animation (ANM)",
            DatFileType::Palette => "Palette (PAL)",
            DatFileType::SurfaceTexture => "SurfaceTexture (TEX)",
            DatFileType::Texture => "Texture (DDS/JPG)",
            DatFileType::Surface => "Surface (SUR)",
            DatFileType::MotionTable => "MotionTable (DSC)",
            DatFileType::Audio => "Audio (WAV)",
            DatFileType::EnvCell => "EnvCell (ENV)",
            DatFileType::Table => "Table",
            DatFileType::Clothing => "Clothing (CLO)",
            DatFileType::Scene => "Scene (SCN)",
            DatFileType::Region => "Region (RGN)",
            DatFileType::CombatManeuverTable => "CombatManeuverTable",
            DatFileType::PhysicsScript => "PhysicsScript",
            DatFileType::PhysicsScriptTable => "PhysicsScriptTable",
            DatFileType::LanguageString => "LanguageString",
            DatFileType::Font => "Font",
            DatFileType::Custom => "Custom",
            DatFileType::MotionKinematics => "MotionKinematics",
            DatFileType::Landblock => "Landblock (Terrain)",
            DatFileType::LandblockInfo => "LandblockInfo (Static)",
            DatFileType::IndoorCell => "IndoorCell",
            DatFileType::Iteration => "Iteration (Metadata)",
            DatFileType::Unknown => "Unknown",
        };
        write!(f, "{}", name)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_file_type_classification() {
        // Special internal iterations file
        assert_eq!(DatFileType::from_id(0xFFFF0001), DatFileType::Iteration);

        // Terrain landblocks
        assert_eq!(DatFileType::from_id(0x1234FFFF), DatFileType::Landblock);

        // Static objects in landblocks (LBI)
        assert_eq!(DatFileType::from_id(0x1234FFFE), DatFileType::LandblockInfo);

        // Interior/Dungeon cells
        assert_eq!(DatFileType::from_id(0x76540001), DatFileType::IndoorCell);
        assert_eq!(DatFileType::from_id(0x7654FDAB), DatFileType::IndoorCell);

        // Portal types (by prefix)
        assert_eq!(DatFileType::from_id(0x01001234), DatFileType::Model);
        assert_eq!(DatFileType::from_id(0x02001234), DatFileType::SetupModel);
        assert_eq!(DatFileType::from_id(0x0E001234), DatFileType::Table);

        // Edge case: ensure 0xFFFF0001 is NOT an IndoorCell
        assert_ne!(DatFileType::from_id(0xFFFF0001), DatFileType::IndoorCell);

        assert_eq!(DatFileType::from_type_id(0x0E), DatFileType::Table);
        assert_eq!(DatFileType::from_type_id(0xFFFF_FF00), DatFileType::Custom);
        assert_eq!(
            DatFileType::from_type_id(MOTION_KINEMATICS_TYPE_ID),
            DatFileType::MotionKinematics
        );
        assert_eq!(DatFileType::from_type_id(0xDEADBEEF), DatFileType::Unknown);
    }

    #[test]
    fn test_essential_types() {
        let manifest = crate::manifest::StripperManifest::logic_only();

        // Iteration should NOT be essential
        assert!(!manifest.should_keep(DatFileType::Iteration));

        // Models and Landblocks should be essential
        assert!(manifest.should_keep(DatFileType::Model));
        assert!(manifest.should_keep(DatFileType::Landblock));
    }
}
