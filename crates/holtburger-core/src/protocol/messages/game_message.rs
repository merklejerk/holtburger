use super::*;
use byteorder::{ByteOrder, LittleEndian, WriteBytesExt};

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
    BootAccount(Box<BootAccountData>),
    GameAction(Box<GameActionMessage>),
    GameEvent(Box<GameEventMessage>),

    UpdateAttribute(Box<UpdateAttributeData>),
    UpdateSkill(Box<UpdateSkillData>),
    UpdateSkillLevel(Box<UpdateSkillLevelData>),
    UpdateVital(Box<UpdateVitalData>),
    UpdateAttribute2ndLevel(Box<UpdateVitalCurrentData>),

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
    InventoryRemoveObject(Box<InventoryRemoveObjectData>),
    SetStackSize(Box<SetStackSizeData>),
    SetState(Box<SetStateData>),
    PlaySound(Box<PlaySoundData>),
    PlayEffect(Box<PlayEffectData>),

    Unknown(u32, Vec<u8>),
}

impl MessageUnpack for GameMessage {
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
            GameOpcode::BootAccount => Some(GameMessage::BootAccount(Box::new(
                BootAccountData::unpack(data, offset)?,
            ))),
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
            GameOpcode::PrivateUpdateAttribute => Some(GameMessage::UpdateAttribute(Box::new(
                UpdateAttributeData::unpack_private(data, offset)?,
            ))),
            GameOpcode::PublicUpdateAttribute => Some(GameMessage::UpdateAttribute(Box::new(
                UpdateAttributeData::unpack_public(data, offset)?,
            ))),
            GameOpcode::PrivateUpdateSkill => Some(GameMessage::UpdateSkill(Box::new(
                UpdateSkillData::unpack_private(data, offset)?,
            ))),
            GameOpcode::PublicUpdateSkill => Some(GameMessage::UpdateSkill(Box::new(
                UpdateSkillData::unpack_public(data, offset)?,
            ))),
            GameOpcode::PrivateUpdateVital => Some(GameMessage::UpdateVital(Box::new(
                UpdateVitalData::unpack_private(data, offset)?,
            ))),
            GameOpcode::PublicUpdateVital => Some(GameMessage::UpdateVital(Box::new(
                UpdateVitalData::unpack_public(data, offset)?,
            ))),
            GameOpcode::PrivateUpdateVitalCurrent => Some(GameMessage::UpdateAttribute2ndLevel(
                Box::new(UpdateVitalCurrentData::unpack_private(data, offset)?),
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
            GameOpcode::PrivateUpdatePropertyInt => Some(GameMessage::UpdatePropertyInt(Box::new(
                UpdatePropertyIntData::unpack(data, offset, false)?,
            ))),
            GameOpcode::PublicUpdatePropertyInt => Some(GameMessage::UpdatePropertyInt(Box::new(
                UpdatePropertyIntData::unpack(data, offset, true)?,
            ))),
            GameOpcode::PrivateUpdatePropertyInt64 => Some(GameMessage::UpdatePropertyInt64(
                Box::new(UpdatePropertyInt64Data::unpack(data, offset, false)?),
            )),
            GameOpcode::PublicUpdatePropertyInt64 => Some(GameMessage::UpdatePropertyInt64(
                Box::new(UpdatePropertyInt64Data::unpack(data, offset, true)?),
            )),
            GameOpcode::PrivateUpdatePropertyBool => Some(GameMessage::UpdatePropertyBool(
                Box::new(UpdatePropertyBoolData::unpack(data, offset, false)?),
            )),
            GameOpcode::PublicUpdatePropertyBool => Some(GameMessage::UpdatePropertyBool(
                Box::new(UpdatePropertyBoolData::unpack(data, offset, true)?),
            )),
            GameOpcode::PrivateUpdatePropertyFloat => Some(GameMessage::UpdatePropertyFloat(
                Box::new(UpdatePropertyFloatData::unpack(data, offset, false)?),
            )),
            GameOpcode::PublicUpdatePropertyFloat => Some(GameMessage::UpdatePropertyFloat(
                Box::new(UpdatePropertyFloatData::unpack(data, offset, true)?),
            )),
            GameOpcode::PrivateUpdatePropertyString => Some(GameMessage::UpdatePropertyString(
                Box::new(UpdatePropertyStringData::unpack(data, offset, false)?),
            )),
            GameOpcode::PublicUpdatePropertyString => Some(GameMessage::UpdatePropertyString(
                Box::new(UpdatePropertyStringData::unpack(data, offset, true)?),
            )),
            GameOpcode::PrivateUpdatePropertyDid => Some(GameMessage::UpdatePropertyDataId(
                Box::new(UpdatePropertyDataIdData::unpack(data, offset, false)?),
            )),
            GameOpcode::PublicUpdatePropertyDid => Some(GameMessage::UpdatePropertyDataId(
                Box::new(UpdatePropertyDataIdData::unpack(data, offset, true)?),
            )),
            GameOpcode::PrivateUpdatePropertyIid => Some(GameMessage::UpdatePropertyInstanceId(
                Box::new(UpdatePropertyInstanceIdData::unpack(data, offset, false)?),
            )),
            GameOpcode::PublicUpdatePropertyIid => Some(GameMessage::UpdatePropertyInstanceId(
                Box::new(UpdatePropertyInstanceIdData::unpack(data, offset, true)?),
            )),

            GameOpcode::ObjDescEvent => Some(GameMessage::ObjDescEvent(Box::new(
                ObjDescEventData::unpack(data, offset)?,
            ))),
            GameOpcode::ForceObjectDescSend => Some(GameMessage::ForceObjectDescSend(Box::new(
                ForceObjectDescSendData::unpack(data, offset)?,
            ))),
            GameOpcode::PrivateUpdateSkillLevel => Some(GameMessage::UpdateSkillLevel(Box::new(
                UpdateSkillLevelData::unpack(data, offset, false)?,
            ))),
            GameOpcode::PublicUpdateSkillLevel => Some(GameMessage::UpdateSkillLevel(Box::new(
                UpdateSkillLevelData::unpack(data, offset, true)?,
            ))),
        }
    }
}

impl MessagePack for GameMessage {
    fn pack(&self, buf: &mut Vec<u8>) {
        match self {
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
            GameMessage::DddInterrogation => {
                buf.write_u32::<LittleEndian>(GameOpcode::DddInterrogation as u32)
                    .unwrap();
            }
            GameMessage::CharacterError(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::CharacterError as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameMessage::BootAccount(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::BootAccount as u32)
                    .unwrap();
                data.pack(buf);
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
            GameMessage::SetState(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::SetState as u32)
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
            GameMessage::PlayerTeleport(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::PlayerTeleport as u32)
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
            GameMessage::UpdatePosition(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::UpdatePosition as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameMessage::UpdateObject(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::UpdateObject as u32)
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
            GameMessage::ObjectDelete(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::ObjectDelete as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameMessage::UpdateAttribute(data) => {
                let opcode = if data.object_guid.is_some() {
                    GameOpcode::PublicUpdateAttribute
                } else {
                    GameOpcode::PrivateUpdateAttribute
                };
                buf.write_u32::<LittleEndian>(opcode as u32).unwrap();
                data.pack(buf);
            }
            GameMessage::UpdateSkill(data) => {
                let opcode = if data.object_guid.is_some() {
                    GameOpcode::PublicUpdateSkill
                } else {
                    GameOpcode::PrivateUpdateSkill
                };
                buf.write_u32::<LittleEndian>(opcode as u32).unwrap();
                data.pack(buf);
            }
            GameMessage::UpdateSkillLevel(data) => {
                let opcode = if data.guid.is_some() {
                    GameOpcode::PublicUpdateSkillLevel
                } else {
                    GameOpcode::PrivateUpdateSkillLevel
                };
                buf.write_u32::<LittleEndian>(opcode as u32).unwrap();
                data.pack(buf);
            }
            GameMessage::UpdateVital(data) => {
                let opcode = if data.object_guid.is_some() {
                    GameOpcode::PublicUpdateVital
                } else {
                    GameOpcode::PrivateUpdateVital
                };
                buf.write_u32::<LittleEndian>(opcode as u32).unwrap();
                data.pack(buf);
            }
            GameMessage::UpdateAttribute2ndLevel(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::PrivateUpdateVitalCurrent as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameMessage::UpdateMotion(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::UpdateMotion as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameMessage::UpdatePropertyInt(data) => {
                let opcode = if data.is_public {
                    GameOpcode::PublicUpdatePropertyInt
                } else {
                    GameOpcode::PrivateUpdatePropertyInt
                };
                buf.write_u32::<LittleEndian>(opcode as u32).unwrap();
                data.pack(buf);
            }
            GameMessage::UpdatePropertyInt64(data) => {
                let opcode = if data.is_public {
                    GameOpcode::PublicUpdatePropertyInt64
                } else {
                    GameOpcode::PrivateUpdatePropertyInt64
                };
                buf.write_u32::<LittleEndian>(opcode as u32).unwrap();
                data.pack(buf);
            }
            GameMessage::UpdatePropertyBool(data) => {
                let opcode = if data.is_public {
                    GameOpcode::PublicUpdatePropertyBool
                } else {
                    GameOpcode::PrivateUpdatePropertyBool
                };
                buf.write_u32::<LittleEndian>(opcode as u32).unwrap();
                data.pack(buf);
            }
            GameMessage::UpdatePropertyFloat(data) => {
                let opcode = if data.is_public {
                    GameOpcode::PublicUpdatePropertyFloat
                } else {
                    GameOpcode::PrivateUpdatePropertyFloat
                };
                buf.write_u32::<LittleEndian>(opcode as u32).unwrap();
                data.pack(buf);
            }
            GameMessage::UpdatePropertyString(data) => {
                let opcode = if data.is_public {
                    GameOpcode::PublicUpdatePropertyString
                } else {
                    GameOpcode::PrivateUpdatePropertyString
                };
                buf.write_u32::<LittleEndian>(opcode as u32).unwrap();
                data.pack(buf);
            }
            GameMessage::UpdatePropertyDataId(data) => {
                let opcode = if data.is_public {
                    GameOpcode::PublicUpdatePropertyDid
                } else {
                    GameOpcode::PrivateUpdatePropertyDid
                };
                buf.write_u32::<LittleEndian>(opcode as u32).unwrap();
                data.pack(buf);
            }
            GameMessage::UpdatePropertyInstanceId(data) => {
                let opcode = if data.is_public {
                    GameOpcode::PublicUpdatePropertyIid
                } else {
                    GameOpcode::PrivateUpdatePropertyIid
                };
                buf.write_u32::<LittleEndian>(opcode as u32).unwrap();
                data.pack(buf);
            }
            GameMessage::UpdateHealth(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::GameEvent as u32)
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
            GameMessage::Unknown(opcode, data) => {
                buf.write_u32::<LittleEndian>(*opcode).unwrap();
                buf.extend_from_slice(data);
            }
        }
    }
}

impl GameMessage {
    pub fn unpack(data: &[u8]) -> Option<Self> {
        let mut offset = 0;
        <Self as MessageUnpack>::unpack(data, &mut offset)
    }

    pub fn pack(&self) -> Vec<u8> {
        let mut buf = Vec::new();
        <Self as MessagePack>::pack(self, &mut buf);
        buf
    }
}
