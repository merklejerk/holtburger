pub mod gfx_obj;

use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DatFileType {
    // Portal Range (Top Byte)
    Model = 0x01,
    SetupModel = 0x02,
    Animation = 0x03,
    Palette = 0x04,
    SurfaceTexture = 0x05,
    Texture = 0x06,
    Surface = 0x08,
    AnimationDone = 0x09,
    Audio = 0x0A,
    EnvCell = 0x0D,
    Table = 0x0E,
    Clothing = 0x10,
    Scene = 0x12,
    Region = 0x13,
    LanguageString = 0x31,
    Font = 0x40,

    // Cell Range (Suffix)
    Landblock = 0xFE, // XXYYFFFF (using FE as internal marker for simplicity or specific logic)
    LandblockInfo = 0xFF, // XXYYFFFE
    IndoorCell = 0xFD, // XXYY0001 - XXYYFFFD

    Unknown = 0x00,
}

impl DatFileType {
    pub fn from_id(id: u32) -> Self {
        // Check Cell DAT suffixes first (high priority)
        let suffix = id & 0xFFFF;
        if suffix == 0xFFFF {
            return DatFileType::Landblock;
        }
        if suffix == 0xFFFE {
            return DatFileType::LandblockInfo;
        }
        if suffix > 0 && suffix < 0xFFFE {
            // Likely an indoor cell in cell.dat
            // We can confirm this if the ID is within a reasonable range
            // But usually only cell.dat has these large suffixes
            // However, we can use the top byte as a backup
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
            0x09 => DatFileType::AnimationDone,
            0x0A => DatFileType::Audio,
            0x0D => DatFileType::EnvCell,
            0x0E => DatFileType::Table,
            0x10 => DatFileType::Clothing,
            0x12 => DatFileType::Scene,
            0x13 => DatFileType::Region,
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
            DatFileType::AnimationDone => "AnimationDone (DSC)",
            DatFileType::Audio => "Audio (WAV)",
            DatFileType::EnvCell => "EnvCell (ENV)",
            DatFileType::Table => "Table",
            DatFileType::Clothing => "Clothing (CLO)",
            DatFileType::Scene => "Scene (SCN)",
            DatFileType::Region => "Region (RGN)",
            DatFileType::LanguageString => "LanguageString",
            DatFileType::Font => "Font",
            DatFileType::Landblock => "Landblock (Terrain)",
            DatFileType::LandblockInfo => "LandblockInfo (Static)",
            DatFileType::IndoorCell => "IndoorCell",
            DatFileType::Unknown => "Unknown",
        };
        write!(f, "{}", name)
    }
}
