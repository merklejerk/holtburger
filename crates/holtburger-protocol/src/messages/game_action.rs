pub use crate::messages::chat::actions::*;
pub use crate::messages::combat::actions::*;
pub use crate::messages::inventory::actions::*;
pub use crate::messages::magic::actions::*;
pub use crate::messages::misc::actions::*;
pub use crate::messages::movement::actions::*;
pub use crate::messages::object::actions::*;
pub use crate::messages::player::actions::*;
pub use crate::messages::trade::actions::*;

use crate::opcodes::GameActionOpcode;
use byteorder::{ByteOrder, LittleEndian, WriteBytesExt};
use holtburger_common::traits::{ProtocolPack, ProtocolUnpack};

#[derive(Debug, Clone, PartialEq)]
pub struct GameActionMessage {
    pub sequence: u32,
    pub action: GameAction,
}

#[derive(Debug, Clone, PartialEq)]
pub enum GameAction {
    Jump(Box<JumpData>),
    AutonomousPosition(Box<AutonomousPositionActionData>),
    MoveToState(Box<MoveToStateData>),
    GetAndWieldItem(Box<GetAndWieldItemData>),
    StackableSplitToWield(Box<StackableSplitToWieldData>),
    Talk(Box<TalkData>),
    Tell(Box<TellActionData>),
    PingRequest(Box<PingRequestData>),
    DropItem(Box<DropItemData>),
    PutItemInContainer(Box<PutItemInContainerData>),
    Use(Box<UseData>),
    UseWithTarget(Box<UseWithTargetData>),
    IdentifyObject(Box<IdentifyObjectData>),
    LoginComplete(Box<LoginCompleteData>),
    RaiseAttribute(Box<RaiseAttributeData>),
    RaiseVital(Box<RaiseVitalData>),
    RaiseSkill(Box<RaiseSkillData>),
    TrainSkill(Box<TrainSkillData>),
    GiveObjectRequest(Box<GiveObjectRequestData>),
    CastTargetedSpell(Box<CastTargetedSpellData>),
    CastUntargetedSpell(Box<CastUntargetedSpellData>),
    ChangeCombatMode(Box<ChangeCombatModeData>),
    CancelAttack(Box<CancelAttackData>),
    Buy(Box<BuyData>),
    Sell(Box<SellData>),
    OpenTradeNegotiations(Box<OpenTradeNegotiationsData>),
    CloseTradeNegotiations(Box<CloseTradeNegotiationsData>),
    AddToTrade(Box<AddToTradeData>),
    AcceptTrade(Box<AcceptTradeData>),
    DeclineTrade(Box<DeclineTradeData>),
    ResetTrade(Box<ResetTradeData>),
    ApproachVendor(Box<ApproachVendorActionData>),
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
                    GameAction::Jump(Box::new(JumpData::unpack(data, offset)?))
                }
                GameActionOpcode::AutonomousPosition => GameAction::AutonomousPosition(Box::new(
                    AutonomousPositionActionData::unpack(data, offset)?,
                )),
                GameActionOpcode::MoveToState => {
                    GameAction::MoveToState(Box::new(MoveToStateData::unpack(data, offset)?))
                }
                GameActionOpcode::GetAndWieldItem => GameAction::GetAndWieldItem(Box::new(
                    GetAndWieldItemData::unpack(data, offset)?,
                )),
                GameActionOpcode::StackableSplitToWield => GameAction::StackableSplitToWield(
                    Box::new(StackableSplitToWieldData::unpack(data, offset)?),
                ),
                GameActionOpcode::Talk => {
                    GameAction::Talk(Box::new(TalkData::unpack(data, offset)?))
                }
                GameActionOpcode::Tell => {
                    GameAction::Tell(Box::new(TellActionData::unpack(data, offset)?))
                }
                GameActionOpcode::PingRequest => {
                    GameAction::PingRequest(Box::new(PingRequestData::unpack(data, offset)?))
                }
                GameActionOpcode::DropItem => {
                    GameAction::DropItem(Box::new(DropItemData::unpack(data, offset)?))
                }
                GameActionOpcode::PutItemInContainer => GameAction::PutItemInContainer(Box::new(
                    PutItemInContainerData::unpack(data, offset)?,
                )),
                GameActionOpcode::Use => GameAction::Use(Box::new(UseData::unpack(data, offset)?)),
                GameActionOpcode::UseWithTarget => {
                    GameAction::UseWithTarget(Box::new(UseWithTargetData::unpack(data, offset)?))
                }
                GameActionOpcode::IdentifyObject => {
                    GameAction::IdentifyObject(Box::new(IdentifyObjectData::unpack(data, offset)?))
                }
                GameActionOpcode::LoginComplete => {
                    GameAction::LoginComplete(Box::new(LoginCompleteData::unpack(data, offset)?))
                }
                GameActionOpcode::RaiseAttribute => {
                    GameAction::RaiseAttribute(Box::new(RaiseAttributeData::unpack(data, offset)?))
                }
                GameActionOpcode::RaiseVital => {
                    GameAction::RaiseVital(Box::new(RaiseVitalData::unpack(data, offset)?))
                }
                GameActionOpcode::RaiseSkill => {
                    GameAction::RaiseSkill(Box::new(RaiseSkillData::unpack(data, offset)?))
                }
                GameActionOpcode::TrainSkill => {
                    GameAction::TrainSkill(Box::new(TrainSkillData::unpack(data, offset)?))
                }
                GameActionOpcode::GiveObjectRequest => GameAction::GiveObjectRequest(Box::new(
                    GiveObjectRequestData::unpack(data, offset)?,
                )),
                GameActionOpcode::CastTargetedSpell => GameAction::CastTargetedSpell(Box::new(
                    CastTargetedSpellData::unpack(data, offset)?,
                )),
                GameActionOpcode::CastUntargetedSpell => GameAction::CastUntargetedSpell(Box::new(
                    CastUntargetedSpellData::unpack(data, offset)?,
                )),
                GameActionOpcode::ChangeCombatMode => GameAction::ChangeCombatMode(Box::new(
                    ChangeCombatModeData::unpack(data, offset)?,
                )),
                GameActionOpcode::CancelAttack => {
                    GameAction::CancelAttack(Box::new(CancelAttackData::unpack(data, offset)?))
                }
                GameActionOpcode::Buy => GameAction::Buy(Box::new(BuyData::unpack(data, offset)?)),
                GameActionOpcode::Sell => {
                    GameAction::Sell(Box::new(SellData::unpack(data, offset)?))
                }
                GameActionOpcode::OpenTradeNegotiations => GameAction::OpenTradeNegotiations(
                    Box::new(OpenTradeNegotiationsData::unpack(data, offset)?),
                ),
                GameActionOpcode::CloseTradeNegotiations => GameAction::CloseTradeNegotiations(
                    Box::new(CloseTradeNegotiationsData::unpack(data, offset)?),
                ),
                GameActionOpcode::AddToTrade => {
                    GameAction::AddToTrade(Box::new(AddToTradeData::unpack(data, offset)?))
                }
                GameActionOpcode::AcceptTrade => {
                    GameAction::AcceptTrade(Box::new(AcceptTradeData::unpack(data, offset)?))
                }
                GameActionOpcode::DeclineTrade => {
                    GameAction::DeclineTrade(Box::new(DeclineTradeData::unpack(data, offset)?))
                }
                GameActionOpcode::ResetTrade => {
                    GameAction::ResetTrade(Box::new(ResetTradeData::unpack(data, offset)?))
                }
                GameActionOpcode::ApproachVendor => GameAction::ApproachVendor(Box::new(
                    ApproachVendorActionData::unpack(data, offset)?,
                )),
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
            GameAction::Use(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::Use as u32)
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
            GameAction::LoginComplete(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::LoginComplete as u32)
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
            GameAction::ApproachVendor(data) => {
                buf.write_u32::<LittleEndian>(GameActionOpcode::ApproachVendor as u32)
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
