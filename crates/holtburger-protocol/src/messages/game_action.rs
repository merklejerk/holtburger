pub use crate::messages::book::actions::*;
pub use crate::messages::chat::actions::*;
pub use crate::messages::combat::actions::*;
pub use crate::messages::fellowship::actions::*;
pub use crate::messages::inventory::actions::*;
pub use crate::messages::magic::actions::*;
pub use crate::messages::misc::actions::*;
pub use crate::messages::movement::actions::*;
pub use crate::messages::object::actions::*;
pub use crate::messages::player::actions::*;
pub use crate::messages::trade::actions::*;

use crate::opcodes::GameActionOpcode;
use crate::traits::{ProtocolPack, ProtocolUnpack};
use byteorder::{ByteOrder, LittleEndian, WriteBytesExt};

#[derive(Debug, Clone, PartialEq)]
pub struct GameActionMessage {
    pub sequence: u32,
    pub action: GameAction,
}

#[derive(Debug, Clone, PartialEq)]
pub enum GameAction {
    Jump(Box<JumpActionData>),
    AutonomousPosition(Box<AutonomousPositionActionData>),
    MoveToState(Box<MoveToStateActionData>),
    TargetedMeleeAttack(Box<TargetedMeleeAttackActionData>),
    TargetedMissileAttack(Box<TargetedMissileAttackActionData>),
    GetAndWieldItem(Box<GetAndWieldItemActionData>),
    StackableMerge(Box<StackableMergeActionData>),
    StackableSplitToContainer(Box<StackableSplitToContainerActionData>),
    StackableSplitTo3D(Box<StackableSplitTo3DActionData>),
    StackableSplitToWield(Box<StackableSplitToWieldActionData>),
    Talk(Box<TalkActionData>),
    Tell(Box<TellActionData>),
    SwearAllegiance(Box<SwearAllegianceActionData>),
    BreakAllegiance(Box<BreakAllegianceActionData>),
    AddPlayerPermission(Box<AddPlayerPermissionActionData>),
    RemovePlayerPermission(Box<RemovePlayerPermissionActionData>),
    Emote(Box<EmoteActionData>),
    SoulEmote(Box<SoulEmoteActionData>),
    ChatChannel(Box<ChatChannelActionData>),
    FellowshipCreate(Box<FellowshipCreateActionData>),
    FellowshipQuit(Box<FellowshipQuitActionData>),
    FellowshipDismiss(Box<FellowshipDismissActionData>),
    FellowshipRecruit(Box<FellowshipRecruitActionData>),
    FellowshipAssignNewLeader(Box<FellowshipAssignNewLeaderActionData>),
    FellowshipUpdateRequest(Box<FellowshipUpdateRequestActionData>),
    PingRequest(Box<PingRequestActionData>),
    DropItem(Box<DropItemActionData>),
    PutItemInContainer(Box<PutItemInContainerActionData>),
    SalvageItemsWith(Box<SalvageItemsWithActionData>),
    Use(Box<UseActionData>),
    NoLongerViewingContents(Box<NoLongerViewingContentsActionData>),
    UseWithTarget(Box<UseWithTargetActionData>),
    IdentifyObject(Box<IdentifyObjectActionData>),
    QueryHealth(Box<QueryHealthActionData>),
    QueryItemMana(Box<QueryItemManaActionData>),
    LoginComplete(Box<LoginCompleteActionData>),
    TeleToLifestone(Box<TeleToLifestoneActionData>),
    TeleToPklArena(Box<TeleToPklArenaActionData>),
    TeleToMarketPlace(Box<TeleToMarketPlaceActionData>),
    TeleToMansion(Box<TeleToMansionActionData>),
    Suicide(Box<SuicideActionData>),
    EnterPkLite(Box<EnterPkLiteActionData>),
    RaiseAttribute(Box<RaiseAttributeActionData>),
    RaiseVital(Box<RaiseVitalActionData>),
    RaiseSkill(Box<RaiseSkillActionData>),
    TrainSkill(Box<TrainSkillActionData>),
    SetSingleCharacterOption(Box<SetSingleCharacterOptionActionData>),
    GiveObjectRequest(Box<GiveObjectRequestActionData>),
    CastTargetedSpell(Box<CastTargetedSpellActionData>),
    CastUntargetedSpell(Box<CastUntargetedSpellActionData>),
    ChangeCombatMode(Box<ChangeCombatModeActionData>),
    CancelAttack(Box<CancelAttackActionData>),
    Buy(Box<BuyActionData>),
    Sell(Box<SellActionData>),
    BookPageData(Box<BookPageDataActionData>),
    ConfirmationResponse(Box<ConfirmationResponseActionData>),
    OpenTradeNegotiations(Box<OpenTradeNegotiationsActionData>),
    CloseTradeNegotiations(Box<CloseTradeNegotiationsActionData>),
    AddToTrade(Box<AddToTradeActionData>),
    AcceptTrade(Box<AcceptTradeActionData>),
    DeclineTrade(Box<DeclineTradeActionData>),
    ResetTrade(Box<ResetTradeActionData>),
    Unknown(u32, Vec<u8>),
}

impl ProtocolUnpack for GameActionMessage {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 8 > data.len() {
            return None;
        }
        let sequence = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        let action_type_raw = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]);
        *offset += 8;

        let action_op = GameActionOpcode::from_repr(action_type_raw);

        let action_data = match action_op {
            Some(op) => match op {
                GameActionOpcode::Jump => {
                    GameAction::Jump(Box::new(JumpActionData::unpack(data, offset)?))
                }
                GameActionOpcode::TargetedMeleeAttack => GameAction::TargetedMeleeAttack(Box::new(
                    TargetedMeleeAttackActionData::unpack(data, offset)?,
                )),
                GameActionOpcode::TargetedMissileAttack => GameAction::TargetedMissileAttack(
                    Box::new(TargetedMissileAttackActionData::unpack(data, offset)?),
                ),
                GameActionOpcode::AutonomousPosition => GameAction::AutonomousPosition(Box::new(
                    AutonomousPositionActionData::unpack(data, offset)?,
                )),
                GameActionOpcode::MoveToState => {
                    GameAction::MoveToState(Box::new(MoveToStateActionData::unpack(data, offset)?))
                }
                GameActionOpcode::GetAndWieldItem => GameAction::GetAndWieldItem(Box::new(
                    GetAndWieldItemActionData::unpack(data, offset)?,
                )),
                GameActionOpcode::StackableMerge => GameAction::StackableMerge(Box::new(
                    StackableMergeActionData::unpack(data, offset)?,
                )),
                GameActionOpcode::StackableSplitToContainer => {
                    GameAction::StackableSplitToContainer(Box::new(
                        StackableSplitToContainerActionData::unpack(data, offset)?,
                    ))
                }
                GameActionOpcode::StackableSplitTo3D => GameAction::StackableSplitTo3D(Box::new(
                    StackableSplitTo3DActionData::unpack(data, offset)?,
                )),
                GameActionOpcode::StackableSplitToWield => GameAction::StackableSplitToWield(
                    Box::new(StackableSplitToWieldActionData::unpack(data, offset)?),
                ),
                GameActionOpcode::Talk => {
                    GameAction::Talk(Box::new(TalkActionData::unpack(data, offset)?))
                }
                GameActionOpcode::Tell => {
                    GameAction::Tell(Box::new(TellActionData::unpack(data, offset)?))
                }
                GameActionOpcode::SwearAllegiance => GameAction::SwearAllegiance(Box::new(
                    SwearAllegianceActionData::unpack(data, offset)?,
                )),
                GameActionOpcode::BreakAllegiance => GameAction::BreakAllegiance(Box::new(
                    BreakAllegianceActionData::unpack(data, offset)?,
                )),
                GameActionOpcode::AddPlayerPermission => GameAction::AddPlayerPermission(Box::new(
                    AddPlayerPermissionActionData::unpack(data, offset)?,
                )),
                GameActionOpcode::RemovePlayerPermission => GameAction::RemovePlayerPermission(
                    Box::new(RemovePlayerPermissionActionData::unpack(data, offset)?),
                ),
                GameActionOpcode::Emote => {
                    GameAction::Emote(Box::new(EmoteActionData::unpack(data, offset)?))
                }
                GameActionOpcode::SoulEmote => {
                    GameAction::SoulEmote(Box::new(SoulEmoteActionData::unpack(data, offset)?))
                }
                GameActionOpcode::ChatChannel => {
                    GameAction::ChatChannel(Box::new(ChatChannelActionData::unpack(data, offset)?))
                }
                GameActionOpcode::FellowshipCreate => GameAction::FellowshipCreate(Box::new(
                    FellowshipCreateActionData::unpack(data, offset)?,
                )),
                GameActionOpcode::FellowshipQuit => GameAction::FellowshipQuit(Box::new(
                    FellowshipQuitActionData::unpack(data, offset)?,
                )),
                GameActionOpcode::FellowshipDismiss => GameAction::FellowshipDismiss(Box::new(
                    FellowshipDismissActionData::unpack(data, offset)?,
                )),
                GameActionOpcode::FellowshipRecruit => GameAction::FellowshipRecruit(Box::new(
                    FellowshipRecruitActionData::unpack(data, offset)?,
                )),
                GameActionOpcode::FellowshipAssignNewLeader => {
                    GameAction::FellowshipAssignNewLeader(Box::new(
                        FellowshipAssignNewLeaderActionData::unpack(data, offset)?,
                    ))
                }
                GameActionOpcode::FellowshipUpdateRequest => GameAction::FellowshipUpdateRequest(
                    Box::new(FellowshipUpdateRequestActionData::unpack(data, offset)?),
                ),
                GameActionOpcode::PingRequest => {
                    GameAction::PingRequest(Box::new(PingRequestActionData::unpack(data, offset)?))
                }
                GameActionOpcode::DropItem => {
                    GameAction::DropItem(Box::new(DropItemActionData::unpack(data, offset)?))
                }
                GameActionOpcode::PutItemInContainer => GameAction::PutItemInContainer(Box::new(
                    PutItemInContainerActionData::unpack(data, offset)?,
                )),
                GameActionOpcode::SalvageItemsWith => GameAction::SalvageItemsWith(Box::new(
                    SalvageItemsWithActionData::unpack(data, offset)?,
                )),
                GameActionOpcode::Use => {
                    GameAction::Use(Box::new(UseActionData::unpack(data, offset)?))
                }
                GameActionOpcode::NoLongerViewingContents => GameAction::NoLongerViewingContents(
                    Box::new(NoLongerViewingContentsActionData::unpack(data, offset)?),
                ),
                GameActionOpcode::UseWithTarget => GameAction::UseWithTarget(Box::new(
                    UseWithTargetActionData::unpack(data, offset)?,
                )),
                GameActionOpcode::IdentifyObject => GameAction::IdentifyObject(Box::new(
                    IdentifyObjectActionData::unpack(data, offset)?,
                )),
                GameActionOpcode::QueryHealth => {
                    GameAction::QueryHealth(Box::new(QueryHealthActionData::unpack(data, offset)?))
                }
                GameActionOpcode::QueryItemMana => GameAction::QueryItemMana(Box::new(
                    QueryItemManaActionData::unpack(data, offset)?,
                )),
                GameActionOpcode::LoginComplete => GameAction::LoginComplete(Box::new(
                    LoginCompleteActionData::unpack(data, offset)?,
                )),
                GameActionOpcode::TeleToLifestone => GameAction::TeleToLifestone(Box::new(
                    TeleToLifestoneActionData::unpack(data, offset)?,
                )),
                GameActionOpcode::TeleToPklArena => GameAction::TeleToPklArena(Box::new(
                    TeleToPklArenaActionData::unpack(data, offset)?,
                )),
                GameActionOpcode::TeleToMarketPlace => GameAction::TeleToMarketPlace(Box::new(
                    TeleToMarketPlaceActionData::unpack(data, offset)?,
                )),
                GameActionOpcode::TeleToMansion => GameAction::TeleToMansion(Box::new(
                    TeleToMansionActionData::unpack(data, offset)?,
                )),
                GameActionOpcode::Suicide => {
                    GameAction::Suicide(Box::new(SuicideActionData::unpack(data, offset)?))
                }
                GameActionOpcode::EnterPkLite => {
                    GameAction::EnterPkLite(Box::new(EnterPkLiteActionData::unpack(data, offset)?))
                }
                GameActionOpcode::RaiseAttribute => GameAction::RaiseAttribute(Box::new(
                    RaiseAttributeActionData::unpack(data, offset)?,
                )),
                GameActionOpcode::RaiseVital => {
                    GameAction::RaiseVital(Box::new(RaiseVitalActionData::unpack(data, offset)?))
                }
                GameActionOpcode::RaiseSkill => {
                    GameAction::RaiseSkill(Box::new(RaiseSkillActionData::unpack(data, offset)?))
                }
                GameActionOpcode::TrainSkill => {
                    GameAction::TrainSkill(Box::new(TrainSkillActionData::unpack(data, offset)?))
                }
                GameActionOpcode::SetSingleCharacterOption => GameAction::SetSingleCharacterOption(
                    Box::new(SetSingleCharacterOptionActionData::unpack(data, offset)?),
                ),
                GameActionOpcode::GiveObjectRequest => GameAction::GiveObjectRequest(Box::new(
                    GiveObjectRequestActionData::unpack(data, offset)?,
                )),
                GameActionOpcode::CastTargetedSpell => GameAction::CastTargetedSpell(Box::new(
                    CastTargetedSpellActionData::unpack(data, offset)?,
                )),
                GameActionOpcode::CastUntargetedSpell => GameAction::CastUntargetedSpell(Box::new(
                    CastUntargetedSpellActionData::unpack(data, offset)?,
                )),
                GameActionOpcode::ChangeCombatMode => GameAction::ChangeCombatMode(Box::new(
                    ChangeCombatModeActionData::unpack(data, offset)?,
                )),
                GameActionOpcode::CancelAttack => GameAction::CancelAttack(Box::new(
                    CancelAttackActionData::unpack(data, offset)?,
                )),
                GameActionOpcode::Buy => {
                    GameAction::Buy(Box::new(BuyActionData::unpack(data, offset)?))
                }
                GameActionOpcode::Sell => {
                    GameAction::Sell(Box::new(SellActionData::unpack(data, offset)?))
                }
                GameActionOpcode::BookPageData => GameAction::BookPageData(Box::new(
                    BookPageDataActionData::unpack(data, offset)?,
                )),
                GameActionOpcode::ConfirmationResponse => GameAction::ConfirmationResponse(
                    Box::new(ConfirmationResponseActionData::unpack(data, offset)?),
                ),
                GameActionOpcode::OpenTradeNegotiations => GameAction::OpenTradeNegotiations(
                    Box::new(OpenTradeNegotiationsActionData::unpack(data, offset)?),
                ),
                GameActionOpcode::CloseTradeNegotiations => GameAction::CloseTradeNegotiations(
                    Box::new(CloseTradeNegotiationsActionData::unpack(data, offset)?),
                ),
                GameActionOpcode::AddToTrade => {
                    GameAction::AddToTrade(Box::new(AddToTradeActionData::unpack(data, offset)?))
                }
                GameActionOpcode::AcceptTrade => {
                    GameAction::AcceptTrade(Box::new(AcceptTradeActionData::unpack(data, offset)?))
                }
                GameActionOpcode::DeclineTrade => GameAction::DeclineTrade(Box::new(
                    DeclineTradeActionData::unpack(data, offset)?,
                )),
                GameActionOpcode::ResetTrade => {
                    GameAction::ResetTrade(Box::new(ResetTradeActionData::unpack(data, offset)?))
                }
            },
            None => {
                let remaining = data[*offset..].to_vec();
                *offset = data.len();
                GameAction::Unknown(action_type_raw, remaining)
            }
        };

        Some(GameActionMessage {
            sequence,
            action: action_data,
        })
    }
}

impl ProtocolPack for GameActionMessage {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.write_u32::<LittleEndian>(self.sequence).unwrap();

        match &self.action {
            GameAction::Jump(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::Jump as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameAction::TargetedMeleeAttack(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::TargetedMeleeAttack as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameAction::TargetedMissileAttack(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::TargetedMissileAttack as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameAction::AutonomousPosition(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::AutonomousPosition as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameAction::MoveToState(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::MoveToState as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameAction::GetAndWieldItem(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::GetAndWieldItem as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameAction::StackableMerge(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::StackableMerge as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameAction::StackableSplitToContainer(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::StackableSplitToContainer as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameAction::StackableSplitTo3D(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::StackableSplitTo3D as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameAction::StackableSplitToWield(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::StackableSplitToWield as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameAction::Talk(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::Talk as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameAction::Tell(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::Tell as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameAction::SwearAllegiance(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::SwearAllegiance as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameAction::BreakAllegiance(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::BreakAllegiance as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameAction::AddPlayerPermission(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::AddPlayerPermission as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameAction::RemovePlayerPermission(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::RemovePlayerPermission as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameAction::Emote(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::Emote as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameAction::SoulEmote(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::SoulEmote as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameAction::ChatChannel(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::ChatChannel as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameAction::FellowshipCreate(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::FellowshipCreate as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameAction::FellowshipQuit(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::FellowshipQuit as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameAction::FellowshipDismiss(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::FellowshipDismiss as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameAction::FellowshipRecruit(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::FellowshipRecruit as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameAction::FellowshipAssignNewLeader(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::FellowshipAssignNewLeader as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameAction::FellowshipUpdateRequest(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::FellowshipUpdateRequest as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameAction::PingRequest(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::PingRequest as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameAction::DropItem(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::DropItem as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameAction::PutItemInContainer(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::PutItemInContainer as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameAction::SalvageItemsWith(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::SalvageItemsWith as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameAction::Use(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::Use as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameAction::NoLongerViewingContents(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::NoLongerViewingContents as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameAction::UseWithTarget(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::UseWithTarget as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameAction::IdentifyObject(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::IdentifyObject as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameAction::QueryHealth(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::QueryHealth as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameAction::QueryItemMana(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::QueryItemMana as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameAction::LoginComplete(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::LoginComplete as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameAction::TeleToLifestone(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::TeleToLifestone as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameAction::TeleToPklArena(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::TeleToPklArena as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameAction::TeleToMarketPlace(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::TeleToMarketPlace as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameAction::TeleToMansion(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::TeleToMansion as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameAction::Suicide(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::Suicide as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameAction::EnterPkLite(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::EnterPkLite as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameAction::RaiseAttribute(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::RaiseAttribute as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameAction::RaiseVital(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::RaiseVital as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameAction::RaiseSkill(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::RaiseSkill as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameAction::TrainSkill(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::TrainSkill as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameAction::SetSingleCharacterOption(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::SetSingleCharacterOption as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameAction::GiveObjectRequest(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::GiveObjectRequest as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameAction::CastTargetedSpell(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::CastTargetedSpell as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameAction::CastUntargetedSpell(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::CastUntargetedSpell as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameAction::ChangeCombatMode(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::ChangeCombatMode as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameAction::CancelAttack(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::CancelAttack as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameAction::Buy(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::Buy as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameAction::Sell(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::Sell as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameAction::BookPageData(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::BookPageData as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameAction::ConfirmationResponse(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::ConfirmationResponse as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameAction::OpenTradeNegotiations(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::OpenTradeNegotiations as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameAction::CloseTradeNegotiations(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::CloseTradeNegotiations as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameAction::AddToTrade(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::AddToTrade as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameAction::AcceptTrade(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::AcceptTrade as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameAction::DeclineTrade(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::DeclineTrade as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameAction::ResetTrade(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::ResetTrade as u32)
                    .unwrap();
                data.pack(buf);
            }
            GameAction::Unknown(opcode, data) => {
                buf.write_u32::<LittleEndian>(*opcode).unwrap();
                buf.extend_from_slice(data);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::messages::game_message::GameMessage;
    use crate::test_fixtures;

    fn assert_action_parity(fixture: &[u8], expected_sequence: u32) {
        let mut offset = 0;

        // Some fixtures have the GameMessage header (0xF7B1), some don't.
        let msg = if fixture.len() >= 4 && fixture[0..2] == [0xB1, 0xF7] {
            GameMessage::unpack(fixture, &mut offset).expect("failed to unpack GameMessage")
        } else {
            // Raw GameActionMessage
            GameMessage::GameAction(Box::new(
                GameActionMessage::unpack(fixture, &mut offset)
                    .expect("failed to unpack GameActionMessage"),
            ))
        };

        if let GameMessage::GameAction(action_msg) = &msg {
            assert_eq!(action_msg.sequence, expected_sequence);
        } else {
            panic!("expected GameMessage::GameAction, got {:?}", msg);
        }

        let mut packed = Vec::new();
        msg.pack(&mut packed);

        // If the fixture didn't have the GameMessage header, we only expect the GameActionMessage part to match
        if fixture.len() >= 4 && fixture[0..2] == [0xB1, 0xF7] {
            assert_eq!(packed, fixture);
        } else {
            // packed will have 0xF7B1 prefix, fixture doesn't
            assert_eq!(&packed[4..], fixture);
        }
    }

    #[test]
    fn test_action_talk_parity() {
        assert_action_parity(test_fixtures::ACTION_TALK, 1);
    }

    #[test]
    fn test_action_tell_parity() {
        assert_action_parity(test_fixtures::ACTION_TELL, 2);
    }

    #[test]
    fn test_action_ping_request_parity() {
        assert_action_parity(test_fixtures::ACTION_PING_REQUEST, 3);
    }

    #[test]
    fn test_action_login_complete_parity() {
        assert_action_parity(test_fixtures::ACTION_LOGIN_COMPLETE, 8);
    }

    #[test]
    fn test_action_identify_parity() {
        assert_action_parity(test_fixtures::ACTION_IDENTIFY, 7);
    }

    #[test]
    fn test_action_query_health_parity() {
        let fixture = hex::decode("B1F7000009000000BF01000003000080").unwrap();
        assert_action_parity(&fixture, 9);
    }

    #[test]
    fn test_action_book_page_data_parity() {
        let fixture = hex::decode("B1F7000011000000AE0000004433221101000000").unwrap();
        assert_action_parity(&fixture, 0x11);
    }

    #[test]
    fn test_action_use_parity() {
        assert_action_parity(test_fixtures::ACTION_USE, 6);
    }

    #[test]
    fn test_action_drop_item_parity() {
        assert_action_parity(test_fixtures::ACTION_DROP_ITEM, 4);
    }

    #[test]
    fn test_action_put_item_parity() {
        assert_action_parity(test_fixtures::ACTION_PUT_ITEM, 5);
    }

    #[test]
    fn test_action_raise_attribute_parity() {
        assert_action_parity(test_fixtures::ACTION_RAISE_ATTRIBUTE, 85);
    }

    #[test]
    fn test_action_raise_skill_parity() {
        assert_action_parity(test_fixtures::ACTION_RAISE_SKILL, 119);
    }

    #[test]
    fn test_action_raise_vital_parity() {
        assert_action_parity(test_fixtures::ACTION_RAISE_VITAL, 102);
    }
}
