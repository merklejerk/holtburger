pub use crate::messages::character::types::*;
pub use crate::messages::chat::turbine::*;
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

#[derive(Debug, Clone, PartialEq)]
pub enum GameMessage {
    None, // 0x0000
    CharacterList(Box<CharacterListData>),
    CharacterCreate(Box<CharacterCreateRequestData>),
    CharacterCreateResponse(Box<CharacterCreateResponseData>),
    CharacterDeleteRequest(Box<CharacterDeleteRequestData>),
    CharacterDeleteResponse,
    CharacterRestoreRequest(Box<CharacterRestoreRequestData>),
    CharacterEnterWorldRequest(Box<CharacterEnterWorldRequestData>),
    CharacterEnterWorld(Box<CharacterEnterWorldData>),
    CharacterEnterWorldServerReady, // 0xF7DF
    ServerName(Box<ServerNameData>),
    ServerMessage(Box<ServerMessageData>),
    PlayerKilled(Box<PlayerKilledData>),
    TurbineChat(Box<TurbineChatMessageData>),
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

mod pack;
mod unpack;

#[cfg(test)]
mod tests;
