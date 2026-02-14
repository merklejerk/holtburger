pub use crate::messages::chat::actions::*;
pub use crate::messages::combat::actions::*;
pub use crate::messages::inventory::actions::*;
pub use crate::messages::magic::actions::*;
pub use crate::messages::misc::actions::*;
pub use crate::messages::movement::actions::*;
pub use crate::messages::object::actions::*;
pub use crate::messages::player::actions::*;

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
            GameAction::Unknown(opcode, data) => {
                buf.write_u32::<LittleEndian>(*opcode).unwrap();
                buf.extend_from_slice(data);
            }
        }
    }
}
