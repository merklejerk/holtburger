pub use crate::messages::character::types::*;
pub use crate::messages::chat::types::*;
pub use crate::messages::combat::types::*;
pub use crate::messages::effects::types::*;
pub use crate::messages::inventory::types::*;
pub use crate::messages::misc::types::*;
pub use crate::messages::movement::actions::*;
pub use crate::messages::movement::messages::*;
pub use crate::messages::movement::types::*;
pub use crate::messages::object::messages::*;
pub use crate::messages::object::types::*;
pub use crate::messages::player::types::*;

pub use crate::messages::game_action::GameActionMessage;
pub use crate::messages::game_event::GameEventMessage;
use crate::opcodes::*;
use byteorder::{ByteOrder, LittleEndian, WriteBytesExt};
use holtburger_common::traits::{ProtocolPack, ProtocolUnpack};

#[derive(Debug, Clone, PartialEq)]
pub enum GameMessage {
    None, // 0x0000
    CharacterList(Box<CharacterListData>),
    CharacterEnterWorldRequest(Box<CharacterEnterWorldRequestData>),
    CharacterEnterWorld(Box<CharacterEnterWorldData>),
    CharacterEnterWorldServerReady, // 0xF7DF
    ServerName(Box<ServerNameData>),
    ServerMessage(Box<ServerMessageData>),
    DddInterrogation,
    DddInterrogationResponse(Box<DddInterrogationResponseData>),
    CharacterError(Box<CharacterErrorData>),
    AccountBoot(Box<BootAccountData>),
    CharacterLogOff, // 0xF653
    GameAction(Box<GameActionMessage>),
    GameEvent(Box<GameEventMessage>),

    PrivateUpdateAttribute(Box<PrivateUpdateAttributeData>),
    PublicUpdateAttribute(Box<PublicUpdateAttributeData>),
    PrivateUpdateSkill(Box<PrivateUpdateSkillData>),
    PublicUpdateSkill(Box<PublicUpdateSkillData>),
    PrivateUpdateSkillLevel(Box<PrivateUpdateSkillLevelData>),
    PublicUpdateSkillLevel(Box<PublicUpdateSkillLevelData>),
    PrivateUpdateVital(Box<PrivateUpdateVitalData>),
    PublicUpdateVital(Box<PublicUpdateVitalData>),
    PrivateUpdateVitalCurrent(Box<PrivateUpdateVitalCurrentData>),

    HearSpeech(Box<HearSpeechData>),
    HearRangedSpeech(Box<HearRangedSpeechData>),
    EmoteText(Box<EmoteTextData>),
    SoulEmote(Box<SoulEmoteData>),

    // Object Messages
    ObjectCreate(Box<ObjectDescriptionData>),
    PlayerCreate(Box<PlayerCreateData>),
    UpdateObject(Box<ObjectDescriptionData>),
    ObjectDelete(Box<ObjectDeleteData>),
    ObjDescEvent(Box<ObjDescEventData>),
    ForceObjectDescSend(Box<ForceObjectDescSendData>),
    UpdatePosition(Box<UpdatePositionData>),
    PrivateUpdatePosition(Box<PrivateUpdatePositionData>),
    PublicUpdatePosition(Box<PublicUpdatePositionData>),
    VectorUpdate(Box<VectorUpdateData>),
    UpdateMotion(Box<MovementEventData>),
    PlayerTeleport(Box<PlayerTeleportData>),
    AutonomousPosition(Box<ServerAutonomousPositionData>),
    AutonomyLevel(Box<AutonomyLevelData>),

    PrivateUpdatePropertyInt(Box<PrivateUpdatePropertyIntData>),
    PublicUpdatePropertyInt(Box<PublicUpdatePropertyIntData>),
    PrivateUpdatePropertyInt64(Box<PrivateUpdatePropertyInt64Data>),
    PublicUpdatePropertyInt64(Box<PublicUpdatePropertyInt64Data>),
    PrivateUpdatePropertyBool(Box<PrivateUpdatePropertyBoolData>),
    PublicUpdatePropertyBool(Box<PublicUpdatePropertyBoolData>),
    PrivateUpdatePropertyFloat(Box<PrivateUpdatePropertyFloatData>),
    PublicUpdatePropertyFloat(Box<PublicUpdatePropertyFloatData>),
    PrivateUpdatePropertyString(Box<PrivateUpdatePropertyStringData>),
    PublicUpdatePropertyString(Box<PublicUpdatePropertyStringData>),
    PrivateUpdatePropertyDataId(Box<PrivateUpdatePropertyDataIdData>),
    PublicUpdatePropertyDataId(Box<PublicUpdatePropertyDataIdData>),
    PrivateUpdatePropertyInstanceId(Box<PrivateUpdatePropertyInstanceIdData>),
    PublicUpdatePropertyInstanceId(Box<PublicUpdatePropertyInstanceIdData>),

    ParentEvent(Box<ParentEventData>),
    PickupEvent(Box<PickupEventData>),
    InventoryRemoveObject(Box<InventoryRemoveObjectData>),
    SetStackSize(Box<SetStackSizeData>),
    SetState(Box<SetStateData>),
    PlaySound(Box<PlaySoundData>),
    PlayEffect(Box<PlayEffectData>),

    Unknown(u32, Vec<u8>),
}

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

impl ProtocolPack for GameMessage {
    fn pack(&self, buf: &mut Vec<u8>) {
        match self {
            GameMessage::None => {
                buf.write_u32::<LittleEndian>(GameOpcode::None as u32)
                    .unwrap();
            }
            GameMessage::CharacterList(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::CharacterList as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameMessage::CharacterEnterWorldRequest(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::CharacterEnterWorldRequest as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameMessage::CharacterEnterWorld(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::CharacterEnterWorld as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameMessage::CharacterEnterWorldServerReady => {
                buf.write_u32::<LittleEndian>(GameOpcode::CharacterEnterWorldServerReady as u32)
                    .unwrap();
            }
            GameMessage::ServerName(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::ServerName as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameMessage::DddInterrogationResponse(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::DddInterrogationResponse as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameMessage::CharacterError(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::CharacterError as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameMessage::AccountBoot(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::AccountBoot as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameMessage::CharacterLogOff => {
                buf.write_u32::<LittleEndian>(GameOpcode::CharacterLogOff as u32)
                    .unwrap();
            }
            GameMessage::ServerMessage(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::ServerMessage as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameMessage::GameAction(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::GameAction as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameMessage::GameEvent(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::GameEvent as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameMessage::HearSpeech(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::HearSpeech as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameMessage::HearRangedSpeech(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::HearRangedSpeech as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameMessage::EmoteText(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::EmoteText as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameMessage::SoulEmote(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::SoulEmote as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameMessage::PrivateUpdateAttribute(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::PrivateUpdateAttribute as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameMessage::PublicUpdateAttribute(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::PublicUpdateAttribute as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameMessage::PrivateUpdateSkill(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::PrivateUpdateSkill as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameMessage::PublicUpdateSkill(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::PublicUpdateSkill as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameMessage::PrivateUpdateVital(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::PrivateUpdateVital as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameMessage::PublicUpdateVital(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::PublicUpdateVital as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameMessage::PrivateUpdateVitalCurrent(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::PrivateUpdateVitalCurrent as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameMessage::ObjectCreate(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::ObjectCreate as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameMessage::PlayerCreate(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::PlayerCreate as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameMessage::UpdateObject(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::UpdateObject as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameMessage::ObjectDelete(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::ObjectDelete as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameMessage::UpdatePosition(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::UpdatePosition as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameMessage::PrivateUpdatePosition(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::PrivateUpdatePosition as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameMessage::PublicUpdatePosition(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::PublicUpdatePosition as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameMessage::VectorUpdate(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::VectorUpdate as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameMessage::UpdateMotion(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::UpdateMotion as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameMessage::AutonomousPosition(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::AutonomousPosition as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameMessage::AutonomyLevel(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::AutonomyLevel as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameMessage::ParentEvent(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::ParentEvent as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameMessage::PickupEvent(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::PickupEvent as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameMessage::InventoryRemoveObject(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::InventoryRemoveObject as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameMessage::SetStackSize(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::SetStackSize as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameMessage::SetState(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::SetState as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameMessage::PlayerTeleport(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::PlayerTeleport as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameMessage::PlaySound(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::Sound as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameMessage::PlayEffect(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::PlayEffect as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameMessage::PrivateUpdatePropertyInt(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::PrivateUpdatePropertyInt as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameMessage::PublicUpdatePropertyInt(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::PublicUpdatePropertyInt as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameMessage::PrivateUpdatePropertyInt64(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::PrivateUpdatePropertyInt64 as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameMessage::PublicUpdatePropertyInt64(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::PublicUpdatePropertyInt64 as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameMessage::PrivateUpdatePropertyBool(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::PrivateUpdatePropertyBool as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameMessage::PublicUpdatePropertyBool(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::PublicUpdatePropertyBool as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameMessage::PrivateUpdatePropertyFloat(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::PrivateUpdatePropertyFloat as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameMessage::PublicUpdatePropertyFloat(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::PublicUpdatePropertyFloat as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameMessage::PrivateUpdatePropertyString(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::PrivateUpdatePropertyString as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameMessage::PublicUpdatePropertyString(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::PublicUpdatePropertyString as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameMessage::PrivateUpdatePropertyDataId(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::PrivateUpdatePropertyDid as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameMessage::PublicUpdatePropertyDataId(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::PublicUpdatePropertyDid as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameMessage::PrivateUpdatePropertyInstanceId(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::PrivateUpdatePropertyIid as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameMessage::PublicUpdatePropertyInstanceId(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::PublicUpdatePropertyIid as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameMessage::ObjDescEvent(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::ObjDescEvent as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameMessage::ForceObjectDescSend(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::ForceObjectDescSend as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameMessage::PrivateUpdateSkillLevel(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::PrivateUpdateSkillLevel as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameMessage::PublicUpdateSkillLevel(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::PublicUpdateSkillLevel as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameMessage::DddInterrogation => {
                buf.write_u32::<LittleEndian>(GameOpcode::DddInterrogation as u32)
                    .unwrap();
            }
            GameMessage::Unknown(opcode, data) => {
                buf.write_u32::<LittleEndian>(*opcode).unwrap();
                buf.extend_from_slice(data);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_fixtures;
    use holtburger_common::traits::{ProtocolPack, ProtocolUnpack};

    fn assert_dispatch_match(data: &[u8], check: impl Fn(&GameMessage) -> bool) {
        let mut offset = 0;
        let msg = GameMessage::unpack(data, &mut offset).expect("Failed to unpack GameMessage");
        if !check(&msg) {
            panic!("Dispatch failed. Got: {:?}", msg);
        }

        // Also verify pack parity for these
        let mut packed = Vec::new();
        msg.pack(&mut packed);
        assert_eq!(packed, data, "Pack parity failed");
    }

    fn assert_dispatch_match_no_parity(data: &[u8], check: impl Fn(&GameMessage) -> bool) {
        let mut offset = 0;
        let msg = GameMessage::unpack(data, &mut offset).expect("Failed to unpack GameMessage");
        if !check(&msg) {
            panic!("Dispatch failed. Got: {:?}", msg);
        }
    }

    #[test]
    fn test_dispatch_character_list() {
        assert_dispatch_match(test_fixtures::CHARACTER_LIST, |msg| {
            matches!(msg, GameMessage::CharacterList(_))
        });
    }

    #[test]
    fn test_dispatch_character_enter_world() {
        assert_dispatch_match(test_fixtures::CHARACTER_ENTER_WORLD, |msg| {
            matches!(msg, GameMessage::CharacterEnterWorld(_))
        });
    }

    #[test]
    fn test_dispatch_character_enter_world_request() {
        assert_dispatch_match(test_fixtures::CHARACTER_ENTER_WORLD_REQUEST, |msg| {
            matches!(msg, GameMessage::CharacterEnterWorldRequest(_))
        });
    }

    #[test]
    fn test_dispatch_play_sound() {
        assert_dispatch_match(test_fixtures::SOUND, |msg| {
            matches!(msg, GameMessage::PlaySound(_))
        });
    }

    #[test]
    fn test_dispatch_play_effect() {
        assert_dispatch_match(test_fixtures::PLAY_EFFECT, |msg| {
            matches!(msg, GameMessage::PlayEffect(_))
        });
    }

    #[test]
    fn test_dispatch_hear_speech() {
        assert_dispatch_match(test_fixtures::HEAR_SPEECH, |msg| {
            matches!(msg, GameMessage::HearSpeech(_))
        });
    }

    #[test]
    fn test_dispatch_character_error() {
        // WeenieError is wrapped in GameEvent, not top-level CharacterError
        assert_dispatch_match(test_fixtures::WEENIE_ERROR, |msg| {
            matches!(msg, GameMessage::GameEvent(_))
        });
    }

    #[test]
    fn test_dispatch_ddd_interrogation_response() {
        assert_dispatch_match(test_fixtures::DDD_INTERROGATION_RESPONSE, |msg| {
            matches!(msg, GameMessage::DddInterrogationResponse(_))
        });
    }

    #[test]
    fn test_dispatch_game_action_move_to_state() {
        assert_dispatch_match(test_fixtures::MOVE_TO_STATE, |msg| {
            matches!(msg, GameMessage::GameAction(_))
        });
    }

    #[test]
    fn test_dispatch_player_teleport() {
        assert_dispatch_match(test_fixtures::PLAYER_TELEPORT, |msg| {
            matches!(msg, GameMessage::PlayerTeleport(_))
        });
    }

    #[test]
    fn test_dispatch_action_talk() {
        assert_dispatch_match(test_fixtures::ACTION_TALK, |msg| {
            matches!(msg, GameMessage::GameAction(_))
        });
    }

    #[test]
    fn test_dispatch_action_tell() {
        assert_dispatch_match(test_fixtures::ACTION_TELL, |msg| {
            matches!(msg, GameMessage::GameAction(_))
        });
    }

    #[test]
    fn test_dispatch_action_use() {
        assert_dispatch_match(test_fixtures::ACTION_USE, |msg| {
            matches!(msg, GameMessage::GameAction(_))
        });
    }

    #[test]
    fn test_dispatch_action_drop_item() {
        assert_dispatch_match(test_fixtures::ACTION_DROP_ITEM, |msg| {
            matches!(msg, GameMessage::GameAction(_))
        });
    }

    #[test]
    fn test_dispatch_action_put_item() {
        assert_dispatch_match(test_fixtures::ACTION_PUT_ITEM, |msg| {
            matches!(msg, GameMessage::GameAction(_))
        });
    }

    #[test]
    fn test_dispatch_action_identify() {
        assert_dispatch_match(test_fixtures::ACTION_IDENTIFY, |msg| {
            matches!(msg, GameMessage::GameAction(_))
        });
    }

    #[test]
    fn test_dispatch_action_login_complete() {
        assert_dispatch_match(test_fixtures::ACTION_LOGIN_COMPLETE, |msg| {
            matches!(msg, GameMessage::GameAction(_))
        });
    }

    #[test]
    fn test_dispatch_action_ping_request() {
        assert_dispatch_match(test_fixtures::ACTION_PING_REQUEST, |msg| {
            matches!(msg, GameMessage::GameAction(_))
        });
    }

    #[test]
    fn test_dispatch_private_update_position() {
        assert_dispatch_match(test_fixtures::PRIVATE_UPDATE_POSITION, |msg| {
            matches!(msg, GameMessage::PrivateUpdatePosition(_))
        });
    }

    #[test]
    fn test_dispatch_public_update_position() {
        assert_dispatch_match(test_fixtures::PUBLIC_UPDATE_POSITION, |msg| {
            matches!(msg, GameMessage::PublicUpdatePosition(_))
        });
    }

    #[test]
    fn test_dispatch_hear_ranged_speech() {
        assert_dispatch_match(test_fixtures::HEAR_RANGED_SPEECH, |msg| {
            matches!(msg, GameMessage::HearRangedSpeech(_))
        });
    }

    #[test]
    fn test_dispatch_emote_text() {
        assert_dispatch_match(test_fixtures::EMOTE_TEXT, |msg| {
            matches!(msg, GameMessage::EmoteText(_))
        });
    }

    #[test]
    fn test_dispatch_soul_emote() {
        assert_dispatch_match(test_fixtures::SOUL_EMOTE, |msg| {
            matches!(msg, GameMessage::SoulEmote(_))
        });
    }

    #[test]
    fn test_dispatch_force_obj_desc_send() {
        assert_dispatch_match(test_fixtures::FORCE_OBJ_DESC_SEND, |msg| {
            matches!(msg, GameMessage::ForceObjectDescSend(_))
        });
    }

    #[test]
    fn test_dispatch_obj_desc_event() {
        assert_dispatch_match(test_fixtures::OBJ_DESC_EVENT, |msg| {
            matches!(msg, GameMessage::ObjDescEvent(_))
        });
    }

    #[test]
    fn test_dispatch_update_skill_level_private() {
        assert_dispatch_match(test_fixtures::UPDATE_SKILL_LEVEL_PRIVATE, |msg| {
            matches!(msg, GameMessage::PrivateUpdateSkillLevel(_))
        });
    }

    #[test]
    fn test_dispatch_update_skill_level_public() {
        assert_dispatch_match(test_fixtures::UPDATE_SKILL_LEVEL_PUBLIC, |msg| {
            matches!(msg, GameMessage::PublicUpdateSkillLevel(_))
        });
    }

    #[test]
    fn test_dispatch_view_contents() {
        assert_dispatch_match(test_fixtures::VIEW_CONTENTS, |msg| {
            matches!(msg, GameMessage::GameEvent(_))
        });
    }

    #[test]
    fn test_dispatch_weenie_error_with_string() {
        assert_dispatch_match(test_fixtures::WEENIE_ERROR_WITH_STRING, |msg| {
            matches!(msg, GameMessage::GameEvent(_))
        });
    }

    #[test]
    fn test_dispatch_update_property_int_event() {
        assert_dispatch_match(test_fixtures::UPDATE_PROPERTY_INT, |msg| {
            matches!(msg, GameMessage::GameEvent(_))
        });
    }

    #[test]
    fn test_private_update_combat_mode_parity() {
        let fixture = hex::decode("CD0200000C2800000002000000").unwrap();
        let mut offset = 0;
        let msg = GameMessage::unpack(&fixture, &mut offset).expect("failed to unpack GameMessage");

        if let GameMessage::PrivateUpdatePropertyInt(ref data) = msg {
            assert_eq!(data.sequence, 0x0C);
            assert_eq!(data.property, 40); // CombatMode
            assert_eq!(data.value, 2); // Melee
        } else {
            panic!("expected PrivateUpdatePropertyInt, got {:?}", msg);
        }

        let mut packed = Vec::new();
        msg.pack(&mut packed);
        assert_eq!(packed, fixture);
    }
}
