pub mod character;
pub mod chat;
pub mod common;
pub mod constants;
pub mod magic;
pub mod misc;
pub mod movement;
pub mod object;
pub mod player;
pub mod traits;
pub mod transport;
pub mod utils;

pub use character::*;
pub use chat::*;
pub use common::*;
pub use constants::*;
pub use magic::*;
pub use misc::*;
pub use movement::*;
pub use object::*;
pub use player::*;
pub use traits::*;
pub use transport::*;
pub use utils::*;

use byteorder::{ByteOrder, LittleEndian};

#[derive(Debug, Clone, PartialEq)]
pub enum GameMessage {
    CharacterList(Box<CharacterListData>),
    CharacterEnterWorldRequest(Box<CharacterEnterWorldRequestData>),
    CharacterEnterWorld(Box<CharacterEnterWorldData>),
    CharacterEnterWorldServerReady, // 0xF7DF
    ServerName(Box<ServerNameData>),
    ServerMessage(Box<ServerMessageData>),
    DddInterrogation,
    DddInterrogationResponse(Box<DddInterrogationResponseData>),
    CharacterError(Box<CharacterErrorData>),
    GameAction(Box<GameActionData>),

    // GameEvents (0xF7B0)
    PlayerDescription(Box<PlayerDescriptionData>),
    StartGame, // 0xF7B0 + 0x0001
    UpdateAttribute(Box<UpdateAttributeData>),
    UpdateSkill(Box<UpdateSkillData>),
    UpdateVital(Box<UpdateVitalData>),
    UpdateVitalCurrent(Box<UpdateVitalCurrentData>),
    MagicUpdateEnchantment(Box<MagicUpdateEnchantmentData>),
    MagicUpdateMultipleEnchantments(Box<MagicUpdateMultipleEnchantmentsData>),
    MagicRemoveEnchantment(Box<MagicRemoveEnchantmentData>),
    MagicRemoveMultipleEnchantments(Box<MagicRemoveMultipleEnchantmentsData>),
    MagicPurgeEnchantments(Box<MagicPurgeEnchantmentsData>),
    MagicPurgeBadEnchantments(Box<MagicPurgeBadEnchantmentsData>),
    HearSpeech(Box<HearSpeechData>),
    SoulEmote(Box<SoulEmoteData>),

    // Object Messages
    ObjectCreate(Box<ObjectCreateData>),
    PlayerCreate(Box<PlayerCreateData>),
    ObjectDelete(Box<ObjectDeleteData>),
    UpdatePosition(Box<UpdatePositionData>),
    UpdateMotion(Box<MovementEventData>),
    UpdatePropertyInt(Box<UpdatePropertyIntData>),
    UpdatePropertyInt64(Box<UpdatePropertyInt64Data>),
    UpdatePropertyBool(Box<UpdatePropertyBoolData>),
    UpdatePropertyFloat(Box<UpdatePropertyFloatData>),
    UpdatePropertyString(Box<UpdatePropertyStringData>),
    UpdatePropertyDataId(Box<UpdatePropertyDataIdData>),
    UpdatePropertyInstanceId(Box<UpdatePropertyInstanceIdData>),

    UpdateHealth(Box<UpdateHealthData>),
    ParentEvent(Box<ParentEventData>),
    PickupEvent(Box<PickupEventData>),
    SetState(Box<SetStateData>),

    Unknown(u32, Vec<u8>),
}

impl GameMessage {
    pub fn unpack(data: &[u8]) -> Option<Self> {
        let mut offset = 0;
        if data.len() < 4 {
            return None;
        }
        let opcode = LittleEndian::read_u32(&data[offset..offset + 4]);
        offset += 4;

        match opcode {
            opcodes::CHARACTER_LIST => Some(GameMessage::CharacterList(Box::new(
                CharacterListData::unpack(data, &mut offset)?,
            ))),
            opcodes::CHARACTER_ENTER_WORLD_REQUEST => {
                Some(GameMessage::CharacterEnterWorldRequest(Box::new(
                    CharacterEnterWorldRequestData::unpack(data, &mut offset)?,
                )))
            }
            opcodes::CHARACTER_ENTER_WORLD => Some(GameMessage::CharacterEnterWorld(Box::new(
                CharacterEnterWorldData::unpack(data, &mut offset)?,
            ))),
            opcodes::SERVER_NAME => Some(GameMessage::ServerName(Box::new(
                ServerNameData::unpack(data, &mut offset)?,
            ))),
            opcodes::CHARACTER_ENTER_WORLD_SERVER_READY => {
                Some(GameMessage::CharacterEnterWorldServerReady)
            }
            opcodes::DDD_INTERROGATION => Some(GameMessage::DddInterrogation),
            opcodes::DDD_INTERROGATION_RESPONSE => Some(GameMessage::DddInterrogationResponse(
                Box::new(DddInterrogationResponseData::unpack(data, &mut offset)?),
            )),
            opcodes::CHARACTER_ERROR => Some(GameMessage::CharacterError(Box::new(
                CharacterErrorData::unpack(data, &mut offset)?,
            ))),
            opcodes::SERVER_MESSAGE => Some(GameMessage::ServerMessage(Box::new(
                ServerMessageData::unpack(data, &mut offset)?,
            ))),
            opcodes::GAME_ACTION => Some(GameMessage::GameAction(Box::new(
                GameActionData::unpack(data, &mut offset)?,
            ))),

            // GameEvent wrapper (0xF7B0)
            opcodes::GAME_EVENT => {
                if data.len() < offset + 12 {
                    return None;
                }
                let target_guid = LittleEndian::read_u32(&data[offset..offset + 4]);
                let sequence = LittleEndian::read_u32(&data[offset + 4..offset + 8]);
                let event_type = LittleEndian::read_u32(&data[offset + 8..offset + 12]);
                offset += 12;

                match event_type {
                    game_event_opcodes::PLAYER_DESCRIPTION => Some(GameMessage::PlayerDescription(
                        Box::new(PlayerDescriptionData::unpack(
                            target_guid,
                            sequence,
                            data,
                            &mut offset,
                        )?),
                    )),
                    game_event_opcodes::START_GAME => Some(GameMessage::StartGame),
                    game_event_opcodes::MAGIC_UPDATE_ENCHANTMENT => {
                        let mut data = MagicUpdateEnchantmentData::unpack(data, &mut offset)?;
                        data.target = target_guid;
                        data.sequence = sequence;
                        Some(GameMessage::MagicUpdateEnchantment(Box::new(data)))
                    }
                    game_event_opcodes::MAGIC_UPDATE_MULTIPLE_ENCHANTMENTS => {
                        let mut data =
                            MagicUpdateMultipleEnchantmentsData::unpack(data, &mut offset)?;
                        data.target = target_guid;
                        data.sequence = sequence;
                        Some(GameMessage::MagicUpdateMultipleEnchantments(Box::new(data)))
                    }
                    game_event_opcodes::MAGIC_REMOVE_ENCHANTMENT => {
                        let mut data = MagicRemoveEnchantmentData::unpack(data, &mut offset)?;
                        data.target = target_guid;
                        data.sequence = sequence;
                        Some(GameMessage::MagicRemoveEnchantment(Box::new(data)))
                    }
                    game_event_opcodes::MAGIC_REMOVE_MULTIPLE_ENCHANTMENTS => {
                        let mut data =
                            MagicRemoveMultipleEnchantmentsData::unpack(data, &mut offset)?;
                        data.target = target_guid;
                        data.sequence = sequence;
                        Some(GameMessage::MagicRemoveMultipleEnchantments(Box::new(data)))
                    }
                    game_event_opcodes::MAGIC_PURGE_ENCHANTMENTS => {
                        let mut data = MagicPurgeEnchantmentsData::unpack(data, &mut offset)?;
                        data.target = target_guid;
                        data.sequence = sequence;
                        Some(GameMessage::MagicPurgeEnchantments(Box::new(data)))
                    }
                    game_event_opcodes::MAGIC_PURGE_BAD_ENCHANTMENTS => {
                        let mut data = MagicPurgeBadEnchantmentsData::unpack(data, &mut offset)?;
                        data.target = target_guid;
                        data.sequence = sequence;
                        Some(GameMessage::MagicPurgeBadEnchantments(Box::new(data)))
                    }
                    _ => Some(GameMessage::Unknown(event_type, data[offset..].to_vec())),
                }
            }

            opcodes::HEAR_SPEECH => Some(GameMessage::HearSpeech(Box::new(
                HearSpeechData::unpack(data, &mut offset)?,
            ))),
            opcodes::SOUL_EMOTE => Some(GameMessage::SoulEmote(Box::new(SoulEmoteData::unpack(
                data,
                &mut offset,
            )?))),
            opcodes::PRIVATE_UPDATE_ATTRIBUTE => Some(GameMessage::UpdateAttribute(Box::new(
                UpdateAttributeData::unpack(data, &mut offset)?,
            ))),
            opcodes::PRIVATE_UPDATE_SKILL => Some(GameMessage::UpdateSkill(Box::new(
                UpdateSkillData::unpack(data, &mut offset)?,
            ))),
            opcodes::PRIVATE_UPDATE_VITAL => Some(GameMessage::UpdateVital(Box::new(
                UpdateVitalData::unpack(data, &mut offset)?,
            ))),
            opcodes::PRIVATE_UPDATE_VITAL_CURRENT => Some(GameMessage::UpdateVitalCurrent(
                Box::new(UpdateVitalCurrentData::unpack(data, &mut offset)?),
            )),

            opcodes::OBJECT_CREATE => Some(GameMessage::ObjectCreate(Box::new(
                ObjectCreateData::unpack(data, &mut offset)?,
            ))),
            opcodes::PLAYER_CREATE => Some(GameMessage::PlayerCreate(Box::new(
                PlayerCreateData::unpack(data, &mut offset)?,
            ))),
            opcodes::OBJECT_DELETE => Some(GameMessage::ObjectDelete(Box::new(
                ObjectDeleteData::unpack(data, &mut offset)?,
            ))),
            opcodes::UPDATE_POSITION | opcodes::UPDATE_OBJECT | 0x02DC => {
                Some(GameMessage::UpdatePosition(Box::new(
                    UpdatePositionData::unpack(data, &mut offset)?,
                )))
            }
            opcodes::UPDATE_MOTION => Some(GameMessage::UpdateMotion(Box::new(
                MovementEventData::unpack(data, &mut offset)?,
            ))),
            opcodes::PARENT_EVENT => Some(GameMessage::ParentEvent(Box::new(
                ParentEventData::unpack(data, &mut offset)?,
            ))),
            opcodes::PICKUP_EVENT => Some(GameMessage::PickupEvent(Box::new(
                PickupEventData::unpack(data, &mut offset)?,
            ))),

            opcodes::PRIVATE_UPDATE_PROPERTY_INT => Some(GameMessage::UpdatePropertyInt(Box::new(
                UpdatePropertyIntData::unpack(data, &mut offset, false)?,
            ))),
            opcodes::PUBLIC_UPDATE_PROPERTY_INT => Some(GameMessage::UpdatePropertyInt(Box::new(
                UpdatePropertyIntData::unpack(data, &mut offset, true)?,
            ))),
            opcodes::PRIVATE_UPDATE_PROPERTY_INT64 => Some(GameMessage::UpdatePropertyInt64(
                Box::new(UpdatePropertyInt64Data::unpack(data, &mut offset, false)?),
            )),
            opcodes::PUBLIC_UPDATE_PROPERTY_INT64 => Some(GameMessage::UpdatePropertyInt64(
                Box::new(UpdatePropertyInt64Data::unpack(data, &mut offset, true)?),
            )),
            opcodes::PRIVATE_UPDATE_PROPERTY_BOOL => Some(GameMessage::UpdatePropertyBool(
                Box::new(UpdatePropertyBoolData::unpack(data, &mut offset, false)?),
            )),
            opcodes::PUBLIC_UPDATE_PROPERTY_BOOL => Some(GameMessage::UpdatePropertyBool(
                Box::new(UpdatePropertyBoolData::unpack(data, &mut offset, true)?),
            )),
            opcodes::PRIVATE_UPDATE_PROPERTY_FLOAT => Some(GameMessage::UpdatePropertyFloat(
                Box::new(UpdatePropertyFloatData::unpack(data, &mut offset, false)?),
            )),
            opcodes::PUBLIC_UPDATE_PROPERTY_FLOAT => Some(GameMessage::UpdatePropertyFloat(
                Box::new(UpdatePropertyFloatData::unpack(data, &mut offset, true)?),
            )),
            opcodes::PRIVATE_UPDATE_PROPERTY_STRING => Some(GameMessage::UpdatePropertyString(
                Box::new(UpdatePropertyStringData::unpack(data, &mut offset, false)?),
            )),
            opcodes::PUBLIC_UPDATE_PROPERTY_STRING => Some(GameMessage::UpdatePropertyString(
                Box::new(UpdatePropertyStringData::unpack(data, &mut offset, true)?),
            )),
            opcodes::PRIVATE_UPDATE_PROPERTY_DID => Some(GameMessage::UpdatePropertyDataId(
                Box::new(UpdatePropertyDataIdData::unpack(data, &mut offset, false)?),
            )),
            opcodes::PUBLIC_UPDATE_PROPERTY_DID => Some(GameMessage::UpdatePropertyDataId(
                Box::new(UpdatePropertyDataIdData::unpack(data, &mut offset, true)?),
            )),
            opcodes::PRIVATE_UPDATE_PROPERTY_IID => {
                Some(GameMessage::UpdatePropertyInstanceId(Box::new(
                    UpdatePropertyInstanceIdData::unpack(data, &mut offset, false)?,
                )))
            }
            opcodes::PUBLIC_UPDATE_PROPERTY_IID => {
                Some(GameMessage::UpdatePropertyInstanceId(Box::new(
                    UpdatePropertyInstanceIdData::unpack(data, &mut offset, true)?,
                )))
            }

            _ => {
                log::debug!(
                    "<<< Unknown Opcode: {:08X} Data Len: {}",
                    opcode,
                    data.len() - 4
                );
                Some(GameMessage::Unknown(opcode, data[offset..].to_vec()))
            }
        }
    }

    pub fn pack(&self) -> Vec<u8> {
        let mut buf = Vec::new();
        match self {
            GameMessage::CharacterList(data) => {
                buf.extend_from_slice(&0xF658u32.to_le_bytes());
                data.pack(&mut buf);
            }
            GameMessage::CharacterEnterWorldRequest(data) => {
                buf.extend_from_slice(&0xF7C8u32.to_le_bytes());
                data.pack(&mut buf);
            }
            GameMessage::CharacterEnterWorld(data) => {
                buf.extend_from_slice(&0xF657u32.to_le_bytes());
                data.pack(&mut buf);
            }
            GameMessage::CharacterEnterWorldServerReady => {
                buf.extend_from_slice(&0xF7DFu32.to_le_bytes());
            }
            GameMessage::ServerName(data) => {
                buf.extend_from_slice(&0xF7E1u32.to_le_bytes());
                data.pack(&mut buf);
            }
            GameMessage::DddInterrogationResponse(data) => {
                buf.extend_from_slice(&0xF7E6u32.to_le_bytes());
                data.pack(&mut buf);
            }
            GameMessage::DddInterrogation => {
                buf.extend_from_slice(&0xF7E5u32.to_le_bytes());
            }
            GameMessage::CharacterError(data) => {
                buf.extend_from_slice(&0xF659u32.to_le_bytes());
                data.pack(&mut buf);
            }
            GameMessage::ServerMessage(data) => {
                buf.extend_from_slice(&0xF7E0u32.to_le_bytes());
                data.pack(&mut buf);
            }
            GameMessage::GameAction(data) => {
                buf.extend_from_slice(&0xF7B1u32.to_le_bytes());
                data.pack(&mut buf);
            }
            GameMessage::MagicUpdateEnchantment(data) => {
                buf.extend_from_slice(&0xF7B0u32.to_le_bytes());
                buf.extend_from_slice(&data.target.to_le_bytes());
                buf.extend_from_slice(&data.sequence.to_le_bytes());
                buf.extend_from_slice(&game_event_opcodes::MAGIC_UPDATE_ENCHANTMENT.to_le_bytes());
                data.pack(&mut buf);
            }
            GameMessage::MagicUpdateMultipleEnchantments(data) => {
                buf.extend_from_slice(&0xF7B0u32.to_le_bytes());
                buf.extend_from_slice(&data.target.to_le_bytes());
                buf.extend_from_slice(&data.sequence.to_le_bytes());
                buf.extend_from_slice(
                    &game_event_opcodes::MAGIC_UPDATE_MULTIPLE_ENCHANTMENTS.to_le_bytes(),
                );
                data.pack(&mut buf);
            }
            GameMessage::MagicRemoveEnchantment(data) => {
                buf.extend_from_slice(&0xF7B0u32.to_le_bytes());
                buf.extend_from_slice(&data.target.to_le_bytes());
                buf.extend_from_slice(&data.sequence.to_le_bytes());
                buf.extend_from_slice(&game_event_opcodes::MAGIC_REMOVE_ENCHANTMENT.to_le_bytes());
                data.pack(&mut buf);
            }
            GameMessage::MagicRemoveMultipleEnchantments(data) => {
                buf.extend_from_slice(&0xF7B0u32.to_le_bytes());
                buf.extend_from_slice(&data.target.to_le_bytes());
                buf.extend_from_slice(&data.sequence.to_le_bytes());
                buf.extend_from_slice(
                    &game_event_opcodes::MAGIC_REMOVE_MULTIPLE_ENCHANTMENTS.to_le_bytes(),
                );
                data.pack(&mut buf);
            }
            GameMessage::MagicPurgeEnchantments(data) => {
                buf.extend_from_slice(&0xF7B0u32.to_le_bytes());
                buf.extend_from_slice(&data.target.to_le_bytes());
                buf.extend_from_slice(&data.sequence.to_le_bytes());
                buf.extend_from_slice(&game_event_opcodes::MAGIC_PURGE_ENCHANTMENTS.to_le_bytes());
                data.pack(&mut buf);
            }
            GameMessage::MagicPurgeBadEnchantments(data) => {
                buf.extend_from_slice(&0xF7B0u32.to_le_bytes());
                buf.extend_from_slice(&data.target.to_le_bytes());
                buf.extend_from_slice(&data.sequence.to_le_bytes());
                buf.extend_from_slice(
                    &game_event_opcodes::MAGIC_PURGE_BAD_ENCHANTMENTS.to_le_bytes(),
                );
                data.pack(&mut buf);
            }

            GameMessage::HearSpeech(data) => {
                buf.extend_from_slice(&opcodes::HEAR_SPEECH.to_le_bytes());
                data.pack(&mut buf);
            }
            GameMessage::SoulEmote(data) => {
                buf.extend_from_slice(&opcodes::SOUL_EMOTE.to_le_bytes());
                data.pack(&mut buf);
            }

            // Add more as needed...
            _ => {}
        }
        buf
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use hex;

    #[test]
    fn test_gamemessage_routing_property_int_private() {
        let mut data = Vec::new();
        data.extend_from_slice(&opcodes::PRIVATE_UPDATE_PROPERTY_INT.to_le_bytes());
        data.push(0x42); // Sequence
        data.extend_from_slice(&0x00000001u32.to_le_bytes()); // Property
        data.extend_from_slice(&100i32.to_le_bytes()); // Value

        let msg = GameMessage::unpack(&data).unwrap();
        if let GameMessage::UpdatePropertyInt(data) = msg {
            assert_eq!(data.sequence, 0x42);
            assert_eq!(data.guid, 0); // Private
            assert_eq!(data.property, 1);
            assert_eq!(data.is_public, false);
        } else {
            panic!("Expected UpdatePropertyInt variant");
        }
    }

    #[test]
    fn test_gamemessage_routing_game_event_start() {
        // Opcode (0xF7B0), Target (0x50000001), Seq (0x0E), Event (0x0282)
        let hex = "B0F70000010000500E00000082020000";
        let data = hex::decode(hex).unwrap();
        let msg = GameMessage::unpack(&data).unwrap();
        assert!(matches!(msg, GameMessage::StartGame));
    }

    #[test]
    fn test_gamemessage_routing_character_request() {
        let packed = vec![0xC8, 0xF7, 0x00, 0x00, 0x78, 0x56, 0x34, 0x12];
        let unpacked = GameMessage::unpack(&packed).unwrap();
        assert!(matches!(
            unpacked,
            GameMessage::CharacterEnterWorldRequest(_)
        ));
    }
}
