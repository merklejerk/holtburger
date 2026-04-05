use super::GameMessage;
use crate::opcodes::*;
use crate::traits::ProtocolPack;
use byteorder::{LittleEndian, WriteBytesExt};

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
            GameMessage::CharacterCreate(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::CharacterCreate as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameMessage::CharacterCreateResponse(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::CharacterCreateResponse as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameMessage::CharacterDeleteRequest(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::CharacterDelete as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameMessage::CharacterDeleteResponse => {
                buf.write_u32::<LittleEndian>(GameOpcode::CharacterDelete as u32)
                    .unwrap();
            }
            GameMessage::CharacterRestoreRequest(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::CharacterRestore as u32)
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
            GameMessage::PlayerKilled(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::PlayerKilled as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameMessage::TurbineChat(data) => {
                buf.write_u32::<LittleEndian>(GameOpcode::TurbineChat as u32)
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
