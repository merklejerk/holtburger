use super::*;
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
    BootAccount(Box<BootAccountData>),
    GameAction(Box<GameAction>),
    GameEvent(Box<GameEvent>),

    UpdateAttribute(Box<UpdateAttributeData>),
    UpdateSkill(Box<UpdateSkillData>),
    UpdateVital(Box<UpdateVitalData>),
    UpdateVitalCurrent(Box<UpdateVitalCurrentData>),

    HearSpeech(Box<HearSpeechData>),
    HearRangedSpeech(Box<HearRangedSpeechData>),
    EmoteText(Box<EmoteTextData>),
    SoulEmote(Box<SoulEmoteData>),

    // Object Messages
    ObjectCreate(Box<ObjectDescriptionData>),
    PlayerCreate(Box<PlayerCreateData>),
    UpdateObject(Box<ObjectDescriptionData>),
    ObjectDelete(Box<ObjectDeleteData>),
    UpdatePosition(Box<UpdatePositionData>),
    PrivateUpdatePosition(Box<PrivateUpdatePositionData>),
    PublicUpdatePosition(Box<PublicUpdatePositionData>),
    VectorUpdate(Box<VectorUpdateData>),
    UpdateMotion(Box<MovementEventData>),
    PlayerTeleport(Box<PlayerTeleportData>),
    AutonomousPosition(Box<AutonomousPositionData>),
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
        let opcode = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;

        match opcode {
            opcodes::CHARACTER_LIST => Some(GameMessage::CharacterList(Box::new(
                CharacterListData::unpack(data, offset)?,
            ))),
            opcodes::CHARACTER_ENTER_WORLD_REQUEST => {
                Some(GameMessage::CharacterEnterWorldRequest(Box::new(
                    CharacterEnterWorldRequestData::unpack(data, offset)?,
                )))
            }
            opcodes::CHARACTER_ENTER_WORLD => Some(GameMessage::CharacterEnterWorld(Box::new(
                CharacterEnterWorldData::unpack(data, offset)?,
            ))),
            opcodes::SERVER_NAME => Some(GameMessage::ServerName(Box::new(
                ServerNameData::unpack(data, offset)?,
            ))),
            opcodes::CHARACTER_ENTER_WORLD_SERVER_READY => {
                Some(GameMessage::CharacterEnterWorldServerReady)
            }
            opcodes::DDD_INTERROGATION => Some(GameMessage::DddInterrogation),
            opcodes::DDD_INTERROGATION_RESPONSE => Some(GameMessage::DddInterrogationResponse(
                Box::new(DddInterrogationResponseData::unpack(data, offset)?),
            )),
            opcodes::CHARACTER_ERROR => Some(GameMessage::CharacterError(Box::new(
                CharacterErrorData::unpack(data, offset)?,
            ))),
            opcodes::BOOT_ACCOUNT => Some(GameMessage::BootAccount(Box::new(
                BootAccountData::unpack(data, offset)?,
            ))),
            opcodes::SERVER_MESSAGE => Some(GameMessage::ServerMessage(Box::new(
                ServerMessageData::unpack(data, offset)?,
            ))),
            opcodes::GAME_ACTION => Some(GameMessage::GameAction(Box::new(GameAction::unpack(
                data, offset,
            )?))),

            // GameEvent wrapper (0xF7B0)
            opcodes::GAME_EVENT => Some(GameMessage::GameEvent(Box::new(GameEvent::unpack(
                data, offset,
            )?))),

            opcodes::HEAR_SPEECH => Some(GameMessage::HearSpeech(Box::new(
                HearSpeechData::unpack(data, offset)?,
            ))),
            opcodes::HEAR_RANGED_SPEECH => Some(GameMessage::HearRangedSpeech(Box::new(
                HearRangedSpeechData::unpack(data, offset)?,
            ))),
            opcodes::EMOTE_TEXT => Some(GameMessage::EmoteText(Box::new(EmoteTextData::unpack(
                data, offset,
            )?))),
            opcodes::SOUL_EMOTE => Some(GameMessage::SoulEmote(Box::new(SoulEmoteData::unpack(
                data, offset,
            )?))),
            opcodes::PRIVATE_UPDATE_ATTRIBUTE => Some(GameMessage::UpdateAttribute(Box::new(
                UpdateAttributeData::unpack_private(data, offset)?,
            ))),
            opcodes::PUBLIC_UPDATE_ATTRIBUTE => Some(GameMessage::UpdateAttribute(Box::new(
                UpdateAttributeData::unpack_public(data, offset)?,
            ))),
            opcodes::PRIVATE_UPDATE_SKILL => Some(GameMessage::UpdateSkill(Box::new(
                UpdateSkillData::unpack_private(data, offset)?,
            ))),
            opcodes::PUBLIC_UPDATE_SKILL => Some(GameMessage::UpdateSkill(Box::new(
                UpdateSkillData::unpack_public(data, offset)?,
            ))),
            opcodes::PRIVATE_UPDATE_VITAL => Some(GameMessage::UpdateVital(Box::new(
                UpdateVitalData::unpack_private(data, offset)?,
            ))),
            opcodes::PUBLIC_UPDATE_VITAL => Some(GameMessage::UpdateVital(Box::new(
                UpdateVitalData::unpack_public(data, offset)?,
            ))),
            opcodes::PRIVATE_UPDATE_VITAL_CURRENT => Some(GameMessage::UpdateVitalCurrent(
                Box::new(UpdateVitalCurrentData::unpack_private(data, offset)?),
            )),
            opcodes::PUBLIC_UPDATE_VITAL_CURRENT => Some(GameMessage::UpdateVitalCurrent(
                Box::new(UpdateVitalCurrentData::unpack_public(data, offset)?),
            )),

            opcodes::OBJECT_CREATE => Some(GameMessage::ObjectCreate(Box::new(
                ObjectDescriptionData::unpack(data, offset)?,
            ))),
            opcodes::PLAYER_CREATE => Some(GameMessage::PlayerCreate(Box::new(
                PlayerCreateData::unpack(data, offset)?,
            ))),
            opcodes::UPDATE_OBJECT => Some(GameMessage::UpdateObject(Box::new(
                ObjectDescriptionData::unpack(data, offset)?,
            ))),
            opcodes::OBJECT_DELETE => Some(GameMessage::ObjectDelete(Box::new(
                ObjectDeleteData::unpack(data, offset)?,
            ))),
            opcodes::UPDATE_POSITION => Some(GameMessage::UpdatePosition(Box::new(
                UpdatePositionData::unpack(data, offset)?,
            ))),
            opcodes::PRIVATE_UPDATE_POSITION => Some(GameMessage::PrivateUpdatePosition(Box::new(
                PrivateUpdatePositionData::unpack(data, offset)?,
            ))),
            opcodes::PUBLIC_UPDATE_POSITION => Some(GameMessage::PublicUpdatePosition(Box::new(
                PublicUpdatePositionData::unpack(data, offset)?,
            ))),
            opcodes::VECTOR_UPDATE => Some(GameMessage::VectorUpdate(Box::new(
                VectorUpdateData::unpack(data, offset)?,
            ))),
            opcodes::UPDATE_MOTION => Some(GameMessage::UpdateMotion(Box::new(
                MovementEventData::unpack(data, offset)?,
            ))),
            opcodes::AUTONOMOUS_POSITION => Some(GameMessage::AutonomousPosition(Box::new(
                AutonomousPositionData::unpack(data, offset)?,
            ))),
            opcodes::AUTONOMY_LEVEL => Some(GameMessage::AutonomyLevel(Box::new(
                AutonomyLevelData::unpack(data, offset)?,
            ))),
            opcodes::PARENT_EVENT => Some(GameMessage::ParentEvent(Box::new(
                ParentEventData::unpack(data, offset)?,
            ))),
            opcodes::PICKUP_EVENT => Some(GameMessage::PickupEvent(Box::new(
                PickupEventData::unpack(data, offset)?,
            ))),
            opcodes::INVENTORY_REMOVE_OBJECT => Some(GameMessage::InventoryRemoveObject(Box::new(
                InventoryRemoveObjectData::unpack(data, offset)?,
            ))),
            opcodes::SET_STACK_SIZE => Some(GameMessage::SetStackSize(Box::new(
                SetStackSizeData::unpack(data, offset)?,
            ))),
            opcodes::SET_STATE => Some(GameMessage::SetState(Box::new(SetStateData::unpack(
                data, offset,
            )?))),
            opcodes::PLAYER_TELEPORT => Some(GameMessage::PlayerTeleport(Box::new(
                PlayerTeleportData::unpack(data, offset)?,
            ))),
            opcodes::SOUND => Some(GameMessage::PlaySound(Box::new(PlaySoundData::unpack(
                data, offset,
            )?))),
            opcodes::PLAY_EFFECT => Some(GameMessage::PlayEffect(Box::new(
                PlayEffectData::unpack(data, offset)?,
            ))),

            opcodes::PRIVATE_UPDATE_PROPERTY_INT => Some(GameMessage::UpdatePropertyInt(Box::new(
                UpdatePropertyIntData::unpack(data, offset, false)?,
            ))),
            opcodes::PUBLIC_UPDATE_PROPERTY_INT => Some(GameMessage::UpdatePropertyInt(Box::new(
                UpdatePropertyIntData::unpack(data, offset, true)?,
            ))),
            opcodes::PRIVATE_UPDATE_PROPERTY_INT64 => Some(GameMessage::UpdatePropertyInt64(
                Box::new(UpdatePropertyInt64Data::unpack(data, offset, false)?),
            )),
            opcodes::PUBLIC_UPDATE_PROPERTY_INT64 => Some(GameMessage::UpdatePropertyInt64(
                Box::new(UpdatePropertyInt64Data::unpack(data, offset, true)?),
            )),
            opcodes::PRIVATE_UPDATE_PROPERTY_BOOL => Some(GameMessage::UpdatePropertyBool(
                Box::new(UpdatePropertyBoolData::unpack(data, offset, false)?),
            )),
            opcodes::PUBLIC_UPDATE_PROPERTY_BOOL => Some(GameMessage::UpdatePropertyBool(
                Box::new(UpdatePropertyBoolData::unpack(data, offset, true)?),
            )),
            opcodes::PRIVATE_UPDATE_PROPERTY_FLOAT => Some(GameMessage::UpdatePropertyFloat(
                Box::new(UpdatePropertyFloatData::unpack(data, offset, false)?),
            )),
            opcodes::PUBLIC_UPDATE_PROPERTY_FLOAT => Some(GameMessage::UpdatePropertyFloat(
                Box::new(UpdatePropertyFloatData::unpack(data, offset, true)?),
            )),
            opcodes::PRIVATE_UPDATE_PROPERTY_STRING => Some(GameMessage::UpdatePropertyString(
                Box::new(UpdatePropertyStringData::unpack(data, offset, false)?),
            )),
            opcodes::PUBLIC_UPDATE_PROPERTY_STRING => Some(GameMessage::UpdatePropertyString(
                Box::new(UpdatePropertyStringData::unpack(data, offset, true)?),
            )),
            opcodes::PRIVATE_UPDATE_PROPERTY_DID => Some(GameMessage::UpdatePropertyDataId(
                Box::new(UpdatePropertyDataIdData::unpack(data, offset, false)?),
            )),
            opcodes::PUBLIC_UPDATE_PROPERTY_DID => Some(GameMessage::UpdatePropertyDataId(
                Box::new(UpdatePropertyDataIdData::unpack(data, offset, true)?),
            )),
            opcodes::PRIVATE_UPDATE_PROPERTY_IID => Some(GameMessage::UpdatePropertyInstanceId(
                Box::new(UpdatePropertyInstanceIdData::unpack(data, offset, false)?),
            )),
            opcodes::PUBLIC_UPDATE_PROPERTY_IID => Some(GameMessage::UpdatePropertyInstanceId(
                Box::new(UpdatePropertyInstanceIdData::unpack(data, offset, true)?),
            )),

            _ => {
                log::warn!(
                    "<<< Unknown Opcode: {:08X} Data Len: {}",
                    opcode,
                    data.len() - *offset
                );
                let remaining = data[*offset..].to_vec();
                *offset = data.len();
                Some(GameMessage::Unknown(opcode, remaining))
            }
        }
    }
}

impl MessagePack for GameMessage {
    fn pack(&self, buf: &mut Vec<u8>) {
        match self {
            GameMessage::CharacterList(data) => {
                buf.extend_from_slice(&0xF658u32.to_le_bytes());
                data.pack(buf);
            }
            GameMessage::CharacterEnterWorldRequest(data) => {
                buf.extend_from_slice(&0xF7C8u32.to_le_bytes());
                data.pack(buf);
            }
            GameMessage::CharacterEnterWorld(data) => {
                buf.extend_from_slice(&0xF657u32.to_le_bytes());
                data.pack(buf);
            }
            GameMessage::CharacterEnterWorldServerReady => {
                buf.extend_from_slice(&0xF7DFu32.to_le_bytes());
            }
            GameMessage::ServerName(data) => {
                buf.extend_from_slice(&0xF7E1u32.to_le_bytes());
                data.pack(buf);
            }
            GameMessage::DddInterrogationResponse(data) => {
                buf.extend_from_slice(&0xF7E6u32.to_le_bytes());
                data.pack(buf);
            }
            GameMessage::DddInterrogation => {
                buf.extend_from_slice(&0xF7E5u32.to_le_bytes());
            }
            GameMessage::CharacterError(data) => {
                buf.extend_from_slice(&0xF659u32.to_le_bytes());
                data.pack(buf);
            }
            GameMessage::BootAccount(data) => {
                buf.extend_from_slice(&opcodes::BOOT_ACCOUNT.to_le_bytes());
                data.pack(buf);
            }
            GameMessage::ServerMessage(data) => {
                buf.extend_from_slice(&0xF7E0u32.to_le_bytes());
                data.pack(buf);
            }
            GameMessage::GameAction(data) => {
                buf.extend_from_slice(&opcodes::GAME_ACTION.to_le_bytes());
                data.pack(buf);
            }
            GameMessage::GameEvent(data) => {
                buf.extend_from_slice(&opcodes::GAME_EVENT.to_le_bytes());
                data.pack(buf);
            }
            GameMessage::HearSpeech(data) => {
                buf.extend_from_slice(&opcodes::HEAR_SPEECH.to_le_bytes());
                data.pack(buf);
            }
            GameMessage::HearRangedSpeech(data) => {
                buf.extend_from_slice(&0x02BCu32.to_le_bytes());
                data.pack(buf);
            }
            GameMessage::EmoteText(data) => {
                buf.extend_from_slice(&opcodes::EMOTE_TEXT.to_le_bytes());
                data.pack(buf);
            }
            GameMessage::SoulEmote(data) => {
                buf.extend_from_slice(&opcodes::SOUL_EMOTE.to_le_bytes());
                data.pack(buf);
            }
            GameMessage::PlaySound(data) => {
                buf.extend_from_slice(&opcodes::SOUND.to_le_bytes());
                data.pack(buf);
            }
            GameMessage::PlayEffect(data) => {
                buf.extend_from_slice(&opcodes::PLAY_EFFECT.to_le_bytes());
                data.pack(buf);
            }
            GameMessage::SetState(data) => {
                buf.extend_from_slice(&opcodes::SET_STATE.to_le_bytes());
                data.pack(buf);
            }
            GameMessage::InventoryRemoveObject(data) => {
                buf.extend_from_slice(&opcodes::INVENTORY_REMOVE_OBJECT.to_le_bytes());
                data.pack(buf);
            }
            GameMessage::SetStackSize(data) => {
                buf.extend_from_slice(&opcodes::SET_STACK_SIZE.to_le_bytes());
                data.pack(buf);
            }
            GameMessage::PlayerTeleport(data) => {
                buf.extend_from_slice(&opcodes::PLAYER_TELEPORT.to_le_bytes());
                data.pack(buf);
            }
            GameMessage::AutonomousPosition(data) => {
                buf.extend_from_slice(&opcodes::AUTONOMOUS_POSITION.to_le_bytes());
                data.pack(buf);
            }
            GameMessage::AutonomyLevel(data) => {
                buf.extend_from_slice(&opcodes::AUTONOMY_LEVEL.to_le_bytes());
                data.pack(buf);
            }
            GameMessage::PrivateUpdatePosition(data) => {
                buf.extend_from_slice(&opcodes::PRIVATE_UPDATE_POSITION.to_le_bytes());
                data.pack(buf);
            }
            GameMessage::PublicUpdatePosition(data) => {
                buf.extend_from_slice(&opcodes::PUBLIC_UPDATE_POSITION.to_le_bytes());
                data.pack(buf);
            }
            GameMessage::VectorUpdate(data) => {
                buf.extend_from_slice(&opcodes::VECTOR_UPDATE.to_le_bytes());
                data.pack(buf);
            }
            GameMessage::UpdatePosition(data) => {
                buf.extend_from_slice(&opcodes::UPDATE_POSITION.to_le_bytes());
                data.pack(buf);
            }
            GameMessage::UpdateObject(data) => {
                buf.extend_from_slice(&opcodes::UPDATE_OBJECT.to_le_bytes());
                data.pack(buf);
            }
            GameMessage::ObjectCreate(data) => {
                buf.extend_from_slice(&opcodes::OBJECT_CREATE.to_le_bytes());
                data.pack(buf);
            }
            GameMessage::PlayerCreate(data) => {
                buf.extend_from_slice(&opcodes::PLAYER_CREATE.to_le_bytes());
                data.pack(buf);
            }
            GameMessage::ObjectDelete(data) => {
                buf.extend_from_slice(&opcodes::OBJECT_DELETE.to_le_bytes());
                data.pack(buf);
            }
            GameMessage::UpdateAttribute(data) => {
                let opcode = if data.object_guid.is_some() {
                    opcodes::PUBLIC_UPDATE_ATTRIBUTE
                } else {
                    opcodes::PRIVATE_UPDATE_ATTRIBUTE
                };
                buf.extend_from_slice(&opcode.to_le_bytes());
                data.pack(buf);
            }
            GameMessage::UpdateSkill(data) => {
                let opcode = if data.object_guid.is_some() {
                    opcodes::PUBLIC_UPDATE_SKILL
                } else {
                    opcodes::PRIVATE_UPDATE_SKILL
                };
                buf.extend_from_slice(&opcode.to_le_bytes());
                data.pack(buf);
            }
            GameMessage::UpdateVital(data) => {
                let opcode = if data.object_guid.is_some() {
                    opcodes::PUBLIC_UPDATE_VITAL
                } else {
                    opcodes::PRIVATE_UPDATE_VITAL
                };
                buf.extend_from_slice(&opcode.to_le_bytes());
                data.pack(buf);
            }
            GameMessage::UpdateVitalCurrent(data) => {
                let opcode = if data.object_guid.is_some() {
                    opcodes::PUBLIC_UPDATE_VITAL_CURRENT
                } else {
                    opcodes::PRIVATE_UPDATE_VITAL_CURRENT
                };
                buf.extend_from_slice(&opcode.to_le_bytes());
                data.pack(buf);
            }
            GameMessage::UpdateMotion(data) => {
                buf.extend_from_slice(&opcodes::UPDATE_MOTION.to_le_bytes());
                data.pack(buf);
            }
            GameMessage::UpdatePropertyInt(data) => {
                let opcode = if data.is_public {
                    opcodes::PUBLIC_UPDATE_PROPERTY_INT
                } else {
                    opcodes::PRIVATE_UPDATE_PROPERTY_INT
                };
                buf.extend_from_slice(&opcode.to_le_bytes());
                data.pack(buf);
            }
            GameMessage::UpdatePropertyInt64(data) => {
                let opcode = if data.is_public {
                    opcodes::PUBLIC_UPDATE_PROPERTY_INT64
                } else {
                    opcodes::PRIVATE_UPDATE_PROPERTY_INT64
                };
                buf.extend_from_slice(&opcode.to_le_bytes());
                data.pack(buf);
            }
            GameMessage::UpdatePropertyBool(data) => {
                let opcode = if data.is_public {
                    opcodes::PUBLIC_UPDATE_PROPERTY_BOOL
                } else {
                    opcodes::PRIVATE_UPDATE_PROPERTY_BOOL
                };
                buf.extend_from_slice(&opcode.to_le_bytes());
                data.pack(buf);
            }
            GameMessage::UpdatePropertyFloat(data) => {
                let opcode = if data.is_public {
                    opcodes::PUBLIC_UPDATE_PROPERTY_FLOAT
                } else {
                    opcodes::PRIVATE_UPDATE_PROPERTY_FLOAT
                };
                buf.extend_from_slice(&opcode.to_le_bytes());
                data.pack(buf);
            }
            GameMessage::UpdatePropertyString(data) => {
                let opcode = if data.is_public {
                    opcodes::PUBLIC_UPDATE_PROPERTY_STRING
                } else {
                    opcodes::PRIVATE_UPDATE_PROPERTY_STRING
                };
                buf.extend_from_slice(&opcode.to_le_bytes());
                data.pack(buf);
            }
            GameMessage::UpdatePropertyDataId(data) => {
                let opcode = if data.is_public {
                    opcodes::PUBLIC_UPDATE_PROPERTY_DID
                } else {
                    opcodes::PRIVATE_UPDATE_PROPERTY_DID
                };
                buf.extend_from_slice(&opcode.to_le_bytes());
                data.pack(buf);
            }
            GameMessage::UpdatePropertyInstanceId(data) => {
                let opcode = if data.is_public {
                    opcodes::PUBLIC_UPDATE_PROPERTY_IID
                } else {
                    opcodes::PRIVATE_UPDATE_PROPERTY_IID
                };
                buf.extend_from_slice(&opcode.to_le_bytes());
                data.pack(buf);
            }
            GameMessage::UpdateHealth(data) => {
                // GameEvent wrapper
                buf.extend_from_slice(&opcodes::GAME_EVENT.to_le_bytes());
                data.pack(buf);
            }
            GameMessage::ParentEvent(data) => {
                buf.extend_from_slice(&opcodes::PARENT_EVENT.to_le_bytes());
                data.pack(buf);
            }
            GameMessage::PickupEvent(data) => {
                buf.extend_from_slice(&opcodes::PICKUP_EVENT.to_le_bytes());
                data.pack(buf);
            }
            GameMessage::Unknown(opcode, data) => {
                buf.extend_from_slice(&opcode.to_le_bytes());
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
