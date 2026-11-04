use super::material::ObjDesc;
use crate::graphics::Frame;
use crate::utils::{read_dotnet_string, read_smart_map, read_smart_vec};
use crate::{EOR_PORTAL_NAMESPACE, ResourceKey, StaticResourceKey};
use binrw::{
    BinRead, BinResult,
    io::{Read, Seek, SeekFrom},
};
use std::collections::HashMap;

#[derive(Debug, Clone)]
pub struct CharGen {
    pub id: u32,
    pub starter_areas: Vec<StarterArea>,
    pub heritage_groups: HashMap<u32, HeritageGroup>,
}

impl CharGen {
    pub const FILE_ID: u32 = 0x0E00_0002;

    pub fn read<R: Read + Seek>(reader: &mut R) -> BinResult<Self> {
        Self::read_internal(reader)
    }

    fn read_internal<R: Read + Seek>(reader: &mut R) -> BinResult<Self> {
        let id = u32::read_le(reader)?;
        reader.seek(SeekFrom::Current(4))?;

        let starter_areas = read_smart_vec(reader, StarterArea::read)?;
        reader.seek(SeekFrom::Current(1))?;
        let heritage_groups = read_smart_map(reader, u32::read_le, HeritageGroup::read)?;

        Ok(Self {
            id,
            starter_areas,
            heritage_groups,
        })
    }
}

impl StaticResourceKey for CharGen {
    const RESOURCE_KEY: ResourceKey<'static> =
        ResourceKey::new(EOR_PORTAL_NAMESPACE, Self::FILE_ID);
}

impl BinRead for CharGen {
    type Args<'a> = ();

    fn read_options<R: Read + Seek>(
        reader: &mut R,
        _endian: binrw::Endian,
        _args: Self::Args<'_>,
    ) -> BinResult<Self> {
        Self::read_internal(reader)
    }
}

#[derive(Debug, Clone)]
pub struct StarterArea {
    pub name: String,
    pub locations: Vec<StarterLocation>,
}

impl StarterArea {
    fn read<R: Read + Seek>(reader: &mut R) -> BinResult<Self> {
        Ok(Self {
            name: read_dotnet_string(reader)?,
            locations: read_smart_vec(reader, StarterLocation::read)?,
        })
    }
}

#[derive(Debug, Clone)]
pub struct StarterLocation {
    pub obj_cell_id: u32,
    pub frame: Frame,
}

impl StarterLocation {
    fn read<R: Read + Seek>(reader: &mut R) -> BinResult<Self> {
        Ok(Self {
            obj_cell_id: u32::read_le(reader)?,
            frame: Frame::read_le(reader)?,
        })
    }
}

#[derive(Debug, Clone)]
pub struct HeritageGroup {
    pub name: String,
    pub icon_image: u32,
    pub setup_id: u32,
    pub environment_setup_id: u32,
    pub attribute_credits: u32,
    pub skill_credits: u32,
    pub primary_start_areas: Vec<i32>,
    pub secondary_start_areas: Vec<i32>,
    pub skills: Vec<SkillOverride>,
    pub templates: Vec<CharacterTemplate>,
    pub genders: HashMap<i32, CharacterGenGender>,
}

impl HeritageGroup {
    fn read<R: Read + Seek>(reader: &mut R) -> BinResult<Self> {
        let name = read_dotnet_string(reader)?;
        let icon_image = u32::read_le(reader)?;
        let setup_id = u32::read_le(reader)?;
        let environment_setup_id = u32::read_le(reader)?;
        let attribute_credits = u32::read_le(reader)?;
        let skill_credits = u32::read_le(reader)?;
        let primary_start_areas = read_smart_vec(reader, i32::read_le)?;
        let secondary_start_areas = read_smart_vec(reader, i32::read_le)?;
        let skills = read_smart_vec(reader, SkillOverride::read)?;
        let templates = read_smart_vec(reader, CharacterTemplate::read)?;

        reader.seek(SeekFrom::Current(1))?;
        let genders = read_smart_map(reader, i32::read_le, CharacterGenGender::read)?;

        Ok(Self {
            name,
            icon_image,
            setup_id,
            environment_setup_id,
            attribute_credits,
            skill_credits,
            primary_start_areas,
            secondary_start_areas,
            skills,
            templates,
            genders,
        })
    }
}

#[derive(Debug, Clone)]
pub struct SkillOverride {
    pub skill_num: u32,
    pub normal_cost: i32,
    pub primary_cost: i32,
}

impl SkillOverride {
    fn read<R: Read + Seek>(reader: &mut R) -> BinResult<Self> {
        Ok(Self {
            skill_num: u32::read_le(reader)?,
            normal_cost: i32::read_le(reader)?,
            primary_cost: i32::read_le(reader)?,
        })
    }
}

#[derive(Debug, Clone)]
pub struct CharacterTemplate {
    pub name: String,
    pub icon_image: u32,
    pub title_id: u32,
    pub strength: u32,
    pub endurance: u32,
    pub coordination: u32,
    pub quickness: u32,
    pub focus: u32,
    pub self_stat: u32,
    pub normal_skills: Vec<u32>,
    pub primary_skills: Vec<u32>,
}

impl CharacterTemplate {
    fn read<R: Read + Seek>(reader: &mut R) -> BinResult<Self> {
        let name = read_dotnet_string(reader)?;
        let icon_image = u32::read_le(reader)?;

        Ok(Self {
            name,
            icon_image,
            title_id: u32::read_le(reader)?,
            strength: u32::read_le(reader)?,
            endurance: u32::read_le(reader)?,
            coordination: u32::read_le(reader)?,
            quickness: u32::read_le(reader)?,
            focus: u32::read_le(reader)?,
            self_stat: u32::read_le(reader)?,
            normal_skills: read_smart_vec(reader, u32::read_le)?,
            primary_skills: read_smart_vec(reader, u32::read_le)?,
        })
    }
}

#[derive(Debug, Clone)]
pub struct CharacterGenGender {
    pub name: String,
    pub scale: u32,
    pub setup_id: u32,
    pub sound_table: u32,
    pub icon_image: u32,
    pub base_palette: u32,
    pub skin_palette_set: u32,
    pub physics_table: u32,
    pub motion_table: u32,
    pub combat_table: u32,
    pub base_obj_desc: ObjDesc,
    pub hair_color_list: Vec<u32>,
    pub hair_style_list: Vec<HairStyle>,
    pub eye_color_list: Vec<u32>,
    pub eye_strip_list: Vec<EyeStrip>,
    pub nose_strip_list: Vec<FaceStrip>,
    pub mouth_strip_list: Vec<FaceStrip>,
    pub headgear_list: Vec<Gear>,
    pub shirt_list: Vec<Gear>,
    pub pants_list: Vec<Gear>,
    pub footwear_list: Vec<Gear>,
    pub clothing_colors_list: Vec<u32>,
}

impl CharacterGenGender {
    fn read<R: Read + Seek>(reader: &mut R) -> BinResult<Self> {
        let name = read_dotnet_string(reader)?;

        Ok(Self {
            name,
            scale: u32::read_le(reader)?,
            setup_id: u32::read_le(reader)?,
            sound_table: u32::read_le(reader)?,
            icon_image: u32::read_le(reader)?,
            base_palette: u32::read_le(reader)?,
            skin_palette_set: u32::read_le(reader)?,
            physics_table: u32::read_le(reader)?,
            motion_table: u32::read_le(reader)?,
            combat_table: u32::read_le(reader)?,
            base_obj_desc: ObjDesc::unpack(reader)?,
            hair_color_list: read_smart_vec(reader, u32::read_le)?,
            hair_style_list: read_smart_vec(reader, HairStyle::read)?,
            eye_color_list: read_smart_vec(reader, u32::read_le)?,
            eye_strip_list: read_smart_vec(reader, EyeStrip::read)?,
            nose_strip_list: read_smart_vec(reader, FaceStrip::read)?,
            mouth_strip_list: read_smart_vec(reader, FaceStrip::read)?,
            headgear_list: read_smart_vec(reader, Gear::read)?,
            shirt_list: read_smart_vec(reader, Gear::read)?,
            pants_list: read_smart_vec(reader, Gear::read)?,
            footwear_list: read_smart_vec(reader, Gear::read)?,
            clothing_colors_list: read_smart_vec(reader, u32::read_le)?,
        })
    }
}

#[derive(Debug, Clone)]
pub struct HairStyle {
    pub icon_image: u32,
    pub bald: bool,
    pub alternate_setup: u32,
    pub obj_desc: ObjDesc,
}

impl HairStyle {
    fn read<R: Read + Seek>(reader: &mut R) -> BinResult<Self> {
        Ok(Self {
            icon_image: u32::read_le(reader)?,
            bald: u8::read(reader)? == 1,
            alternate_setup: u32::read_le(reader)?,
            obj_desc: ObjDesc::unpack(reader)?,
        })
    }
}

#[derive(Debug, Clone)]
pub struct EyeStrip {
    pub icon_image: u32,
    pub icon_image_bald: u32,
    pub obj_desc: ObjDesc,
    pub obj_desc_bald: ObjDesc,
}

impl EyeStrip {
    fn read<R: Read + Seek>(reader: &mut R) -> BinResult<Self> {
        Ok(Self {
            icon_image: u32::read_le(reader)?,
            icon_image_bald: u32::read_le(reader)?,
            obj_desc: ObjDesc::unpack(reader)?,
            obj_desc_bald: ObjDesc::unpack(reader)?,
        })
    }
}

#[derive(Debug, Clone)]
pub struct FaceStrip {
    pub icon_image: u32,
    pub obj_desc: ObjDesc,
}

impl FaceStrip {
    fn read<R: Read + Seek>(reader: &mut R) -> BinResult<Self> {
        Ok(Self {
            icon_image: u32::read_le(reader)?,
            obj_desc: ObjDesc::unpack(reader)?,
        })
    }
}

#[derive(Debug, Clone)]
pub struct Gear {
    pub name: String,
    pub clothing_table: u32,
    pub weenie_default: u32,
}

impl Gear {
    fn read<R: Read + Seek>(reader: &mut R) -> BinResult<Self> {
        Ok(Self {
            name: read_dotnet_string(reader)?,
            clothing_table: u32::read_le(reader)?,
            weenie_default: u32::read_le(reader)?,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn char_gen_static_resource_key_uses_portal_namespace() {
        assert_eq!(CharGen::RESOURCE_KEY.namespace, EOR_PORTAL_NAMESPACE);
        assert_eq!(CharGen::RESOURCE_KEY.file_id, CharGen::FILE_ID);
    }

    #[test]
    fn starter_areas_decode_names_and_empty_location_lists() {
        let mut bytes = Vec::from(CharGen::FILE_ID.to_le_bytes());
        bytes.extend_from_slice(&0u32.to_le_bytes()); // Reserved header word.
        bytes.push(1); // One compressed-count starter area.
        bytes.push(4); // .NET string byte length.
        bytes.extend_from_slice(b"Test");
        bytes.push(0); // No locations.
        bytes.push(0); // Reserved byte between collections.
        bytes.push(0); // No heritage groups.
        let decoded = CharGen::read(&mut Cursor::new(bytes)).unwrap();
        assert_eq!(decoded.id, CharGen::FILE_ID);
        assert_eq!(decoded.starter_areas.len(), 1);
        assert_eq!(decoded.starter_areas[0].name, "Test");
        assert!(decoded.starter_areas[0].locations.is_empty());
        assert!(decoded.heritage_groups.is_empty());
    }
}
