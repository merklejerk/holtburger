use super::GameMessage;
pub use crate::messages::character::types::*;
pub use crate::messages::chat::turbine::*;
pub use crate::messages::chat::types::*;
pub use crate::messages::combat::types::*;
pub use crate::messages::effects::types::*;
pub use crate::messages::inventory::types::*;
pub use crate::messages::misc::types::*;
pub use crate::messages::movement::messages::*;
pub use crate::messages::object::messages::*;
pub use crate::messages::player::types::*;

pub use crate::messages::game_action::GameActionMessage;
pub use crate::messages::game_event::GameEventMessage;
use crate::opcodes::*;
use crate::traits::ProtocolUnpack;
use byteorder::{ByteOrder, LittleEndian};

impl ProtocolUnpack for GameMessage {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }
        let opcode_raw = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;

        let op = GameOpcode::from_repr(opcode_raw);
        if op.is_none() {
            log::warn!(
                "<<< Unknown Opcode: {:08X} Data Len: {}",
                opcode_raw,
                data.len() - *offset
            );
            let remaining = data[*offset..].to_vec();
            *offset = data.len();
            return Some(GameMessage::Unknown(opcode_raw, remaining));
        }

        match op.unwrap() {
            GameOpcode::None => Some(GameMessage::None),
            GameOpcode::CharacterList => Some(GameMessage::CharacterList(Box::new(
                CharacterListData::unpack(data, offset)?,
            ))),
            GameOpcode::CharacterCreate => Some(GameMessage::CharacterCreate(Box::new(
                CharacterCreateRequestData::unpack(data, offset)?,
            ))),
            GameOpcode::CharacterCreateResponse => Some(GameMessage::CharacterCreateResponse(
                Box::new(CharacterCreateResponseData::unpack(data, offset)?),
            )),
            GameOpcode::CharacterDelete => {
                if *offset == data.len() {
                    Some(GameMessage::CharacterDeleteResponse)
                } else {
                    Some(GameMessage::CharacterDeleteRequest(Box::new(
                        CharacterDeleteRequestData::unpack(data, offset)?,
                    )))
                }
            }
            GameOpcode::CharacterRestore => Some(GameMessage::CharacterRestoreRequest(Box::new(
                CharacterRestoreRequestData::unpack(data, offset)?,
            ))),
            GameOpcode::CharacterEnterWorldRequest => {
                Some(GameMessage::CharacterEnterWorldRequest(Box::new(
                    CharacterEnterWorldRequestData::unpack(data, offset)?,
                )))
            }
            GameOpcode::CharacterEnterWorld => Some(GameMessage::CharacterEnterWorld(Box::new(
                CharacterEnterWorldData::unpack(data, offset)?,
            ))),
            GameOpcode::ServerName => Some(GameMessage::ServerName(Box::new(
                ServerNameData::unpack(data, offset)?,
            ))),
            GameOpcode::PlayerKilled => Some(GameMessage::PlayerKilled(Box::new(
                PlayerKilledData::unpack(data, offset)?,
            ))),
            GameOpcode::CharacterEnterWorldServerReady => {
                Some(GameMessage::CharacterEnterWorldServerReady)
            }
            GameOpcode::DddInterrogation => Some(GameMessage::DddInterrogation),
            GameOpcode::DddInterrogationResponse => Some(GameMessage::DddInterrogationResponse(
                Box::new(DddInterrogationResponseData::unpack(data, offset)?),
            )),
            GameOpcode::CharacterError => Some(GameMessage::CharacterError(Box::new(
                CharacterErrorData::unpack(data, offset)?,
            ))),
            GameOpcode::AccountBoot => Some(GameMessage::AccountBoot(Box::new(
                BootAccountData::unpack(data, offset)?,
            ))),
            GameOpcode::CharacterLogOff => Some(GameMessage::CharacterLogOff),
            GameOpcode::ServerMessage => Some(GameMessage::ServerMessage(Box::new(
                ServerMessageData::unpack(data, offset)?,
            ))),
            GameOpcode::TurbineChat => Some(GameMessage::TurbineChat(Box::new(
                TurbineChatMessageData::unpack(data, offset)?,
            ))),
            GameOpcode::GameAction => Some(GameMessage::GameAction(Box::new(
                GameActionMessage::unpack(data, offset)?,
            ))),
            GameOpcode::GameEvent => Some(GameMessage::GameEvent(Box::new(
                GameEventMessage::unpack(data, offset)?,
            ))),
            GameOpcode::HearSpeech => Some(GameMessage::HearSpeech(Box::new(
                HearSpeechData::unpack(data, offset)?,
            ))),
            GameOpcode::HearRangedSpeech => Some(GameMessage::HearRangedSpeech(Box::new(
                HearRangedSpeechData::unpack(data, offset)?,
            ))),
            GameOpcode::EmoteText => Some(GameMessage::EmoteText(Box::new(EmoteTextData::unpack(
                data, offset,
            )?))),
            GameOpcode::SoulEmote => Some(GameMessage::SoulEmote(Box::new(SoulEmoteData::unpack(
                data, offset,
            )?))),
            GameOpcode::PrivateUpdateAttribute => Some(GameMessage::PrivateUpdateAttribute(
                Box::new(PrivateUpdateAttributeData::unpack(data, offset)?),
            )),
            GameOpcode::PublicUpdateAttribute => Some(GameMessage::PublicUpdateAttribute(
                Box::new(PublicUpdateAttributeData::unpack(data, offset)?),
            )),
            GameOpcode::PrivateUpdateSkill => Some(GameMessage::PrivateUpdateSkill(Box::new(
                PrivateUpdateSkillData::unpack(data, offset)?,
            ))),
            GameOpcode::PublicUpdateSkill => Some(GameMessage::PublicUpdateSkill(Box::new(
                PublicUpdateSkillData::unpack(data, offset)?,
            ))),
            GameOpcode::PrivateUpdateVital => Some(GameMessage::PrivateUpdateVital(Box::new(
                PrivateUpdateVitalData::unpack(data, offset)?,
            ))),
            GameOpcode::PublicUpdateVital => Some(GameMessage::PublicUpdateVital(Box::new(
                PublicUpdateVitalData::unpack(data, offset)?,
            ))),
            GameOpcode::PrivateUpdateVitalCurrent => Some(GameMessage::PrivateUpdateVitalCurrent(
                Box::new(PrivateUpdateVitalCurrentData::unpack(data, offset)?),
            )),
            GameOpcode::ObjectCreate => Some(GameMessage::ObjectCreate(Box::new(
                ObjectDescriptionData::unpack(data, offset)?,
            ))),
            GameOpcode::PlayerCreate => Some(GameMessage::PlayerCreate(Box::new(
                PlayerCreateData::unpack(data, offset)?,
            ))),
            GameOpcode::UpdateObject => Some(GameMessage::UpdateObject(Box::new(
                ObjectDescriptionData::unpack(data, offset)?,
            ))),
            GameOpcode::ObjectDelete => Some(GameMessage::ObjectDelete(Box::new(
                ObjectDeleteData::unpack(data, offset)?,
            ))),
            GameOpcode::UpdatePosition => Some(GameMessage::UpdatePosition(Box::new(
                UpdatePositionData::unpack(data, offset)?,
            ))),
            GameOpcode::PrivateUpdatePosition => Some(GameMessage::PrivateUpdatePosition(
                Box::new(PrivateUpdatePositionData::unpack(data, offset)?),
            )),
            GameOpcode::PublicUpdatePosition => Some(GameMessage::PublicUpdatePosition(Box::new(
                PublicUpdatePositionData::unpack(data, offset)?,
            ))),
            GameOpcode::VectorUpdate => Some(GameMessage::VectorUpdate(Box::new(
                VectorUpdateData::unpack(data, offset)?,
            ))),
            GameOpcode::UpdateMotion => Some(GameMessage::UpdateMotion(Box::new(
                MovementEventData::unpack(data, offset)?,
            ))),
            GameOpcode::AutonomousPosition => Some(GameMessage::AutonomousPosition(Box::new(
                ServerAutonomousPositionData::unpack(data, offset)?,
            ))),
            GameOpcode::AutonomyLevel => Some(GameMessage::AutonomyLevel(Box::new(
                AutonomyLevelData::unpack(data, offset)?,
            ))),
            GameOpcode::ParentEvent => Some(GameMessage::ParentEvent(Box::new(
                ParentEventData::unpack(data, offset)?,
            ))),
            GameOpcode::PickupEvent => Some(GameMessage::PickupEvent(Box::new(
                PickupEventData::unpack(data, offset)?,
            ))),
            GameOpcode::InventoryRemoveObject => Some(GameMessage::InventoryRemoveObject(
                Box::new(InventoryRemoveObjectData::unpack(data, offset)?),
            )),
            GameOpcode::SetStackSize => Some(GameMessage::SetStackSize(Box::new(
                SetStackSizeData::unpack(data, offset)?,
            ))),
            GameOpcode::SetState => Some(GameMessage::SetState(Box::new(SetStateData::unpack(
                data, offset,
            )?))),
            GameOpcode::PlayerTeleport => Some(GameMessage::PlayerTeleport(Box::new(
                PlayerTeleportData::unpack(data, offset)?,
            ))),
            GameOpcode::Sound => Some(GameMessage::PlaySound(Box::new(PlaySoundData::unpack(
                data, offset,
            )?))),
            GameOpcode::PlayEffect => Some(GameMessage::PlayEffect(Box::new(
                PlayEffectData::unpack(data, offset)?,
            ))),
            GameOpcode::PrivateUpdatePropertyInt => Some(GameMessage::PrivateUpdatePropertyInt(
                Box::new(PrivateUpdatePropertyIntData::unpack(data, offset)?),
            )),
            GameOpcode::PublicUpdatePropertyInt => Some(GameMessage::PublicUpdatePropertyInt(
                Box::new(PublicUpdatePropertyIntData::unpack(data, offset)?),
            )),
            GameOpcode::PrivateUpdatePropertyInt64 => {
                Some(GameMessage::PrivateUpdatePropertyInt64(Box::new(
                    PrivateUpdatePropertyInt64Data::unpack(data, offset)?,
                )))
            }
            GameOpcode::PublicUpdatePropertyInt64 => Some(GameMessage::PublicUpdatePropertyInt64(
                Box::new(PublicUpdatePropertyInt64Data::unpack(data, offset)?),
            )),
            GameOpcode::PrivateUpdatePropertyBool => Some(GameMessage::PrivateUpdatePropertyBool(
                Box::new(PrivateUpdatePropertyBoolData::unpack(data, offset)?),
            )),
            GameOpcode::PublicUpdatePropertyBool => Some(GameMessage::PublicUpdatePropertyBool(
                Box::new(PublicUpdatePropertyBoolData::unpack(data, offset)?),
            )),
            GameOpcode::PrivateUpdatePropertyFloat => {
                Some(GameMessage::PrivateUpdatePropertyFloat(Box::new(
                    PrivateUpdatePropertyFloatData::unpack(data, offset)?,
                )))
            }
            GameOpcode::PublicUpdatePropertyFloat => Some(GameMessage::PublicUpdatePropertyFloat(
                Box::new(PublicUpdatePropertyFloatData::unpack(data, offset)?),
            )),
            GameOpcode::PrivateUpdatePropertyString => {
                Some(GameMessage::PrivateUpdatePropertyString(Box::new(
                    PrivateUpdatePropertyStringData::unpack(data, offset)?,
                )))
            }
            GameOpcode::PublicUpdatePropertyString => {
                Some(GameMessage::PublicUpdatePropertyString(Box::new(
                    PublicUpdatePropertyStringData::unpack(data, offset)?,
                )))
            }
            GameOpcode::PrivateUpdatePropertyDid => Some(GameMessage::PrivateUpdatePropertyDataId(
                Box::new(PrivateUpdatePropertyDataIdData::unpack(data, offset)?),
            )),
            GameOpcode::PublicUpdatePropertyDid => Some(GameMessage::PublicUpdatePropertyDataId(
                Box::new(PublicUpdatePropertyDataIdData::unpack(data, offset)?),
            )),
            GameOpcode::PrivateUpdatePropertyIid => {
                Some(GameMessage::PrivateUpdatePropertyInstanceId(Box::new(
                    PrivateUpdatePropertyInstanceIdData::unpack(data, offset)?,
                )))
            }
            GameOpcode::PublicUpdatePropertyIid => {
                Some(GameMessage::PublicUpdatePropertyInstanceId(Box::new(
                    PublicUpdatePropertyInstanceIdData::unpack(data, offset)?,
                )))
            }

            GameOpcode::ObjDescEvent => Some(GameMessage::ObjDescEvent(Box::new(
                ObjDescEventData::unpack(data, offset)?,
            ))),
            GameOpcode::ForceObjectDescSend => Some(GameMessage::ForceObjectDescSend(Box::new(
                ForceObjectDescSendData::unpack(data, offset)?,
            ))),
            GameOpcode::PrivateUpdateSkillLevel => Some(GameMessage::PrivateUpdateSkillLevel(
                Box::new(PrivateUpdateSkillLevelData::unpack(data, offset)?),
            )),
            GameOpcode::PublicUpdateSkillLevel => Some(GameMessage::PublicUpdateSkillLevel(
                Box::new(PublicUpdateSkillLevelData::unpack(data, offset)?),
            )),
        }
    }
}
