use crate::messages::utils::{read_string16, write_string16};
use crate::traits::{ProtocolPack, ProtocolUnpack};
use byteorder::{ByteOrder, LittleEndian, WriteBytesExt};
use holtburger_common::Guid;
use strum_macros::FromRepr;

#[derive(Debug, Clone, PartialEq)]
pub struct CharacterEntry {
    pub guid: Guid,
    pub name: String,
    pub delete_time: u32,
}

impl ProtocolUnpack for CharacterEntry {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let guid = Guid::unpack(data, offset)?;
        let name = read_string16(data, offset)?;

        if *offset + 4 > data.len() {
            return None;
        }
        let delete_time = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;

        Some(CharacterEntry {
            guid,
            name,
            delete_time,
        })
    }
}

impl ProtocolPack for CharacterEntry {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.guid.pack(buf);
        write_string16(buf, &self.name);
        buf.write_u32::<LittleEndian>(self.delete_time).unwrap();
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct CharacterListData {
    pub characters: Vec<CharacterEntry>,
    pub max_slots: u32,
    pub account_name: String,
    pub use_turbine_chat: bool,
    pub has_tod_expansion: bool,
}

impl ProtocolUnpack for CharacterListData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        // Skip leading padding (always 0)
        if *offset + 4 > data.len() {
            return None;
        }
        *offset += 4;

        if *offset + 4 > data.len() {
            return None;
        }
        let count = LittleEndian::read_u32(&data[*offset..*offset + 4]) as usize;
        *offset += 4;
        let mut characters = Vec::new();
        for _ in 0..count {
            if let Some(entry) = CharacterEntry::unpack(data, offset) {
                characters.push(entry);
            }
        }

        // Post-character list padding
        if *offset + 4 > data.len() {
            return None;
        }
        *offset += 4;

        if *offset + 4 > data.len() {
            return None;
        }
        let max_slots = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;

        let account_name = read_string16(data, offset)?;

        if *offset + 8 > data.len() {
            return None;
        }
        let use_turbine_chat = LittleEndian::read_u32(&data[*offset..*offset + 4]) != 0;
        let has_tod_expansion = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]) != 0;
        *offset += 8;

        Some(CharacterListData {
            characters,
            max_slots,
            account_name,
            use_turbine_chat,
            has_tod_expansion,
        })
    }
}

impl ProtocolPack for CharacterListData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.write_u32::<LittleEndian>(0).unwrap(); // Leading padding
        buf.extend_from_slice(&(self.characters.len() as u32).to_le_bytes());
        for entry in &self.characters {
            entry.pack(buf);
        }
        buf.write_u32::<LittleEndian>(0).unwrap(); // Middle padding
        buf.write_u32::<LittleEndian>(self.max_slots).unwrap();
        write_string16(buf, &self.account_name);
        buf.write_u32::<LittleEndian>(self.use_turbine_chat as u32)
            .unwrap();
        buf.write_u32::<LittleEndian>(self.has_tod_expansion as u32)
            .unwrap();
    }
}

#[repr(u32)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, FromRepr)]
pub enum SkillAdvancementClass {
    Inactive = 0,
    Untrained = 1,
    Trained = 2,
    Specialized = 3,
}

#[repr(u32)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, FromRepr)]
pub enum CharacterGenerationVerificationResponse {
    Undef = 0,
    Ok = 1,
    Pending = 2,
    NameInUse = 3,
    NameBanned = 4,
    Corrupt = 5,
    DatabaseDown = 6,
    AdminPrivilegeDenied = 7,
    Count = 8,
}

#[derive(Debug, Clone, PartialEq)]
pub struct CharacterCreateAppearanceData {
    pub eyes: u32,
    pub nose: u32,
    pub mouth: u32,
    pub hair_color: u32,
    pub eye_color: u32,
    pub hair_style: u32,
    pub headgear_style: u32,
    pub headgear_color: u32,
    pub shirt_style: u32,
    pub shirt_color: u32,
    pub pants_style: u32,
    pub pants_color: u32,
    pub footwear_style: u32,
    pub footwear_color: u32,
    pub skin_hue: f64,
    pub hair_hue: f64,
    pub headgear_hue: f64,
    pub shirt_hue: f64,
    pub pants_hue: f64,
    pub footwear_hue: f64,
}

impl ProtocolUnpack for CharacterCreateAppearanceData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        fn read_u32(data: &[u8], offset: &mut usize) -> Option<u32> {
            if *offset + 4 > data.len() {
                return None;
            }
            let value = LittleEndian::read_u32(&data[*offset..*offset + 4]);
            *offset += 4;
            Some(value)
        }

        fn read_f64(data: &[u8], offset: &mut usize) -> Option<f64> {
            if *offset + 8 > data.len() {
                return None;
            }
            let value = LittleEndian::read_f64(&data[*offset..*offset + 8]);
            *offset += 8;
            Some(value)
        }

        Some(Self {
            eyes: read_u32(data, offset)?,
            nose: read_u32(data, offset)?,
            mouth: read_u32(data, offset)?,
            hair_color: read_u32(data, offset)?,
            eye_color: read_u32(data, offset)?,
            hair_style: read_u32(data, offset)?,
            headgear_style: read_u32(data, offset)?,
            headgear_color: read_u32(data, offset)?,
            shirt_style: read_u32(data, offset)?,
            shirt_color: read_u32(data, offset)?,
            pants_style: read_u32(data, offset)?,
            pants_color: read_u32(data, offset)?,
            footwear_style: read_u32(data, offset)?,
            footwear_color: read_u32(data, offset)?,
            skin_hue: read_f64(data, offset)?,
            hair_hue: read_f64(data, offset)?,
            headgear_hue: read_f64(data, offset)?,
            shirt_hue: read_f64(data, offset)?,
            pants_hue: read_f64(data, offset)?,
            footwear_hue: read_f64(data, offset)?,
        })
    }
}

impl ProtocolPack for CharacterCreateAppearanceData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.write_u32::<LittleEndian>(self.eyes).unwrap();
        buf.write_u32::<LittleEndian>(self.nose).unwrap();
        buf.write_u32::<LittleEndian>(self.mouth).unwrap();
        buf.write_u32::<LittleEndian>(self.hair_color).unwrap();
        buf.write_u32::<LittleEndian>(self.eye_color).unwrap();
        buf.write_u32::<LittleEndian>(self.hair_style).unwrap();
        buf.write_u32::<LittleEndian>(self.headgear_style).unwrap();
        buf.write_u32::<LittleEndian>(self.headgear_color).unwrap();
        buf.write_u32::<LittleEndian>(self.shirt_style).unwrap();
        buf.write_u32::<LittleEndian>(self.shirt_color).unwrap();
        buf.write_u32::<LittleEndian>(self.pants_style).unwrap();
        buf.write_u32::<LittleEndian>(self.pants_color).unwrap();
        buf.write_u32::<LittleEndian>(self.footwear_style).unwrap();
        buf.write_u32::<LittleEndian>(self.footwear_color).unwrap();
        buf.write_f64::<LittleEndian>(self.skin_hue).unwrap();
        buf.write_f64::<LittleEndian>(self.hair_hue).unwrap();
        buf.write_f64::<LittleEndian>(self.headgear_hue).unwrap();
        buf.write_f64::<LittleEndian>(self.shirt_hue).unwrap();
        buf.write_f64::<LittleEndian>(self.pants_hue).unwrap();
        buf.write_f64::<LittleEndian>(self.footwear_hue).unwrap();
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct CharacterCreateRequestData {
    pub account_name: String,
    pub unknown_constant: u32,
    pub heritage: u32,
    pub gender: u32,
    pub appearance: CharacterCreateAppearanceData,
    pub template_option: i32,
    pub strength_ability: u32,
    pub endurance_ability: u32,
    pub coordination_ability: u32,
    pub quickness_ability: u32,
    pub focus_ability: u32,
    pub self_ability: u32,
    pub character_slot: u32,
    pub class_id: u32,
    pub skill_advancement_classes: Vec<SkillAdvancementClass>,
    pub name: String,
    pub start_area: u32,
    pub is_admin: bool,
    pub is_sentinel: bool,
}

impl ProtocolUnpack for CharacterCreateRequestData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let account_name = read_string16(data, offset)?;
        if *offset + 56 > data.len() {
            return None;
        }
        let unknown_constant = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let heritage = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let gender = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let appearance = CharacterCreateAppearanceData::unpack(data, offset)?;
        if *offset + 40 > data.len() {
            return None;
        }
        let template_option = LittleEndian::read_i32(&data[*offset..*offset + 4]);
        *offset += 4;
        let strength_ability = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let endurance_ability = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let coordination_ability = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let quickness_ability = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let focus_ability = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let self_ability = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let character_slot = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let class_id = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let skill_count = LittleEndian::read_u32(&data[*offset..*offset + 4]) as usize;
        *offset += 4;
        let mut skill_advancement_classes = Vec::with_capacity(skill_count);
        for _ in 0..skill_count {
            if *offset + 4 > data.len() {
                return None;
            }
            let raw = LittleEndian::read_u32(&data[*offset..*offset + 4]);
            *offset += 4;
            skill_advancement_classes.push(SkillAdvancementClass::from_repr(raw)?);
        }
        let name = read_string16(data, offset)?;
        if *offset + 12 > data.len() {
            return None;
        }
        let start_area = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        let is_admin = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]) != 0;
        let is_sentinel = LittleEndian::read_u32(&data[*offset + 8..*offset + 12]) != 0;
        *offset += 12;

        Some(Self {
            account_name,
            unknown_constant,
            heritage,
            gender,
            appearance,
            template_option,
            strength_ability,
            endurance_ability,
            coordination_ability,
            quickness_ability,
            focus_ability,
            self_ability,
            character_slot,
            class_id,
            skill_advancement_classes,
            name,
            start_area,
            is_admin,
            is_sentinel,
        })
    }
}

impl ProtocolPack for CharacterCreateRequestData {
    fn pack(&self, buf: &mut Vec<u8>) {
        write_string16(buf, &self.account_name);
        buf.write_u32::<LittleEndian>(self.unknown_constant)
            .unwrap();
        buf.write_u32::<LittleEndian>(self.heritage).unwrap();
        buf.write_u32::<LittleEndian>(self.gender).unwrap();
        self.appearance.pack(buf);
        buf.write_i32::<LittleEndian>(self.template_option).unwrap();
        buf.write_u32::<LittleEndian>(self.strength_ability)
            .unwrap();
        buf.write_u32::<LittleEndian>(self.endurance_ability)
            .unwrap();
        buf.write_u32::<LittleEndian>(self.coordination_ability)
            .unwrap();
        buf.write_u32::<LittleEndian>(self.quickness_ability)
            .unwrap();
        buf.write_u32::<LittleEndian>(self.focus_ability).unwrap();
        buf.write_u32::<LittleEndian>(self.self_ability).unwrap();
        buf.write_u32::<LittleEndian>(self.character_slot).unwrap();
        buf.write_u32::<LittleEndian>(self.class_id).unwrap();
        buf.write_u32::<LittleEndian>(self.skill_advancement_classes.len() as u32)
            .unwrap();
        for skill in &self.skill_advancement_classes {
            buf.write_u32::<LittleEndian>(*skill as u32).unwrap();
        }
        write_string16(buf, &self.name);
        buf.write_u32::<LittleEndian>(self.start_area).unwrap();
        buf.write_u32::<LittleEndian>(u32::from(self.is_admin))
            .unwrap();
        buf.write_u32::<LittleEndian>(u32::from(self.is_sentinel))
            .unwrap();
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct CharacterCreateResponseData {
    pub response: CharacterGenerationVerificationResponse,
    pub guid: Option<Guid>,
    pub name: Option<String>,
    pub seconds_disabled: Option<u32>,
}

impl ProtocolUnpack for CharacterCreateResponseData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }
        let response = CharacterGenerationVerificationResponse::from_repr(LittleEndian::read_u32(
            &data[*offset..*offset + 4],
        ))?;
        *offset += 4;

        let (guid, name, seconds_disabled) =
            if response == CharacterGenerationVerificationResponse::Ok {
                let guid = Guid::unpack(data, offset)?;
                let name = read_string16(data, offset)?;
                if *offset + 4 > data.len() {
                    return None;
                }
                let seconds_disabled = LittleEndian::read_u32(&data[*offset..*offset + 4]);
                *offset += 4;
                (Some(guid), Some(name), Some(seconds_disabled))
            } else {
                (None, None, None)
            };

        Some(Self {
            response,
            guid,
            name,
            seconds_disabled,
        })
    }
}

impl ProtocolPack for CharacterCreateResponseData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.write_u32::<LittleEndian>(self.response as u32).unwrap();
        if self.response == CharacterGenerationVerificationResponse::Ok {
            self.guid
                .as_ref()
                .expect("ok character create response requires guid")
                .pack(buf);
            write_string16(
                buf,
                self.name
                    .as_ref()
                    .expect("ok character create response requires name"),
            );
            buf.write_u32::<LittleEndian>(
                self.seconds_disabled
                    .expect("ok character create response requires trailing value"),
            )
            .unwrap();
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct CharacterDeleteRequestData {
    pub account_name: String,
    pub character_slot: u32,
}

impl ProtocolUnpack for CharacterDeleteRequestData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let account_name = read_string16(data, offset)?;
        if *offset + 4 > data.len() {
            return None;
        }
        let character_slot = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        Some(Self {
            account_name,
            character_slot,
        })
    }
}

impl ProtocolPack for CharacterDeleteRequestData {
    fn pack(&self, buf: &mut Vec<u8>) {
        write_string16(buf, &self.account_name);
        buf.write_u32::<LittleEndian>(self.character_slot).unwrap();
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct CharacterRestoreRequestData {
    pub guid: Guid,
}

impl ProtocolUnpack for CharacterRestoreRequestData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        Some(Self {
            guid: Guid::unpack(data, offset)?,
        })
    }
}

impl ProtocolPack for CharacterRestoreRequestData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.guid.pack(buf);
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct CharacterEnterWorldRequestData {
    pub guid: Guid,
}

impl ProtocolUnpack for CharacterEnterWorldRequestData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let guid = Guid::unpack(data, offset)?;
        Some(CharacterEnterWorldRequestData { guid })
    }
}

impl ProtocolPack for CharacterEnterWorldRequestData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.guid.pack(buf);
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct CharacterEnterWorldData {
    pub guid: Guid,
    pub account: String,
}

impl ProtocolUnpack for CharacterEnterWorldData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let guid = Guid::unpack(data, offset)?;
        let account = read_string16(data, offset)?;
        Some(CharacterEnterWorldData { guid, account })
    }
}

impl ProtocolPack for CharacterEnterWorldData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.guid.pack(buf);
        write_string16(buf, &self.account);
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct ServerNameData {
    pub current_connections: u32,
    pub max_connections: i32,
    pub name: String,
}

impl ProtocolUnpack for ServerNameData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 8 > data.len() {
            return None;
        }
        let current_connections = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        let max_connections = LittleEndian::read_i32(&data[*offset + 4..*offset + 8]);
        *offset += 8;
        let name = read_string16(data, offset)?;
        Some(ServerNameData {
            name,
            current_connections,
            max_connections,
        })
    }
}

impl ProtocolPack for ServerNameData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.write_u32::<LittleEndian>(self.current_connections)
            .unwrap();
        buf.write_i32::<LittleEndian>(self.max_connections).unwrap();
        write_string16(buf, &self.name);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::messages::game_message::GameMessage;
    use crate::test_fixtures;
    use crate::test_helpers::{assert_pack_unpack_parity, get_fixture};
    use crate::traits::{ProtocolPack, ProtocolUnpack};

    #[test]
    fn test_character_list_fixture() {
        let data = test_fixtures::CHARACTER_LIST;
        let mut offset = 0;
        let msg = GameMessage::unpack(data, &mut offset).expect("Failed to unpack character list");

        assert!(matches!(msg, GameMessage::CharacterList(_)));
        assert_pack_unpack_parity(data, &msg);
    }

    #[test]
    fn test_character_create_fixture() {
        let data = get_fixture("character_create.bin");
        let mut offset = 0;
        let msg =
            GameMessage::unpack(&data, &mut offset).expect("Failed to unpack character create");

        let payload = match &msg {
            GameMessage::CharacterCreate(payload) => payload,
            other => panic!("Expected CharacterCreate, got {other:?}"),
        };

        assert_eq!(payload.account_name, "fixture-account");
        assert_eq!(payload.unknown_constant, 1);
        assert_eq!(payload.heritage, 2);
        assert_eq!(payload.gender, 1);
        assert_eq!(payload.template_option, 0);
        assert_eq!(payload.name, "Delulu Dev");
        assert_eq!(payload.strength_ability, 100);
        assert_eq!(payload.endurance_ability, 10);
        assert_eq!(payload.coordination_ability, 100);
        assert_eq!(payload.quickness_ability, 100);
        assert_eq!(payload.focus_ability, 10);
        assert_eq!(payload.self_ability, 10);
        assert_eq!(payload.start_area, 2);
        assert_eq!(payload.skill_advancement_classes.len(), 55);
        assert_pack_unpack_parity(&data, &msg);
    }

    #[test]
    fn test_character_create_response_ok_fixture() {
        let expected =
            GameMessage::CharacterCreateResponse(Box::new(CharacterCreateResponseData {
                response: CharacterGenerationVerificationResponse::Ok,
                guid: Some(Guid(0x50001234)),
                name: Some("Delulu Dev".to_string()),
                seconds_disabled: Some(0),
            }));
        assert_pack_unpack_parity(test_fixtures::CHARACTER_CREATE_RESPONSE_OK, &expected);
    }

    #[test]
    fn test_character_create_response_name_in_use_fixture() {
        let expected =
            GameMessage::CharacterCreateResponse(Box::new(CharacterCreateResponseData {
                response: CharacterGenerationVerificationResponse::NameInUse,
                guid: None,
                name: None,
                seconds_disabled: None,
            }));
        assert_pack_unpack_parity(
            test_fixtures::CHARACTER_CREATE_RESPONSE_NAME_IN_USE,
            &expected,
        );
    }

    #[test]
    fn test_character_delete_request_fixture() {
        let expected = GameMessage::CharacterDeleteRequest(Box::new(CharacterDeleteRequestData {
            account_name: "fixture-account".to_string(),
            character_slot: 2,
        }));
        assert_pack_unpack_parity(test_fixtures::CHARACTER_DELETE_REQUEST, &expected);
    }

    #[test]
    fn test_character_delete_response_fixture() {
        let data = test_fixtures::CHARACTER_DELETE_RESPONSE;
        let mut offset = 0;
        let msg = GameMessage::unpack(data, &mut offset)
            .expect("Failed to unpack character delete response");

        assert_eq!(msg, GameMessage::CharacterDeleteResponse);
        assert_pack_unpack_parity(data, &msg);
    }

    #[test]
    fn test_character_restore_request_fixture() {
        let expected =
            GameMessage::CharacterRestoreRequest(Box::new(CharacterRestoreRequestData {
                guid: Guid(0x50001234),
            }));
        assert_pack_unpack_parity(test_fixtures::CHARACTER_RESTORE_REQUEST, &expected);
    }

    #[test]
    fn test_character_restore_response_fixture() {
        let expected =
            GameMessage::CharacterCreateResponse(Box::new(CharacterCreateResponseData {
                response: CharacterGenerationVerificationResponse::Ok,
                guid: Some(Guid(0x50001234)),
                name: Some("Delulu Dev".to_string()),
                seconds_disabled: Some(0),
            }));
        assert_pack_unpack_parity(test_fixtures::CHARACTER_RESTORE_RESPONSE, &expected);
    }

    #[test]
    fn test_character_enter_world_request_fixture() {
        let data = test_fixtures::CHARACTER_ENTER_WORLD_REQUEST;
        let mut offset = 0;
        let msg = GameMessage::unpack(data, &mut offset).expect("Failed to unpack enter world req");

        assert!(matches!(msg, GameMessage::CharacterEnterWorldRequest(_)));
        assert_pack_unpack_parity(data, &msg);
    }

    #[test]
    fn test_character_enter_world_fixture() {
        let data = test_fixtures::CHARACTER_ENTER_WORLD;
        let mut offset = 0;
        let msg = GameMessage::unpack(data, &mut offset).expect("Failed to unpack enter world");

        assert!(matches!(msg, GameMessage::CharacterEnterWorld(_)));
        assert_pack_unpack_parity(data, &msg);
    }

    #[test]
    fn test_server_name_parity() {
        let expected = ServerNameData {
            current_connections: 123,
            max_connections: 1000,
            name: "Frostfell".to_string(),
        };
        let mut buf = Vec::new();
        expected.pack(&mut buf);
        assert_pack_unpack_parity(&buf, &expected);
    }

    #[test]
    fn test_gamemessage_routing_character_request() {
        use crate::messages::game_message::GameMessage;
        let packed = vec![0xC8, 0xF7, 0x00, 0x00, 0x12, 0x34, 0x56, 0x78];
        let mut offset = 0;
        let unpacked = GameMessage::unpack(&packed, &mut offset).expect("Routing failed");
        assert!(matches!(
            unpacked,
            GameMessage::CharacterEnterWorldRequest(_)
        ));
    }
}
