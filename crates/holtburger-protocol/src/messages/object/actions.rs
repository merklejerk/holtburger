use crate::traits::{ProtocolPack, ProtocolUnpack};
use holtburger_common::Guid;

pub use crate::messages::object::types::{
    IdentifyObjectActionData, UseActionData, UseWithTargetActionData,
};

#[derive(Debug, Clone, PartialEq)]
pub struct QueryItemManaActionData {
    pub target_guid: Guid,
}

impl ProtocolUnpack for QueryItemManaActionData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let target_guid = Guid::unpack(data, offset)?;
        Some(Self { target_guid })
    }
}

impl ProtocolPack for QueryItemManaActionData {
    fn pack(&self, writer: &mut Vec<u8>) {
        self.target_guid.pack(writer);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::messages::game_action::{GameAction, GameActionMessage};
    use crate::messages::game_message::GameMessage;
    use crate::test_fixtures;
    use crate::test_helpers::assert_pack_unpack_parity;
    use holtburger_common::Guid;

    #[test]
    fn test_use_parity() {
        let action = GameMessage::GameAction(Box::new(GameActionMessage {
            sequence: 6,
            action: GameAction::Use(Box::new(UseActionData {
                guid: Guid(0x33333333),
            })),
        }));
        assert_pack_unpack_parity(test_fixtures::ACTION_USE, &action);
    }

    #[test]
    fn test_identify_object_parity() {
        let hex = "B1F7000007000000C800000044332211";
        let action = GameMessage::GameAction(Box::new(GameActionMessage {
            sequence: 7,
            action: GameAction::IdentifyObject(Box::new(IdentifyObjectActionData {
                guid: Guid(0x11223344),
            })),
        }));
        assert_pack_unpack_parity(&hex::decode(hex).unwrap(), &action);
    }

    #[test]
    fn test_query_item_mana_parity() {
        let action = GameMessage::GameAction(Box::new(GameActionMessage {
            sequence: 0,
            action: GameAction::QueryItemMana(Box::new(QueryItemManaActionData {
                target_guid: Guid(0x80000004),
            })),
        }));

        let fixture = hex::decode("B1F70000000000006302000004000080").unwrap();
        assert_pack_unpack_parity(&fixture, &action);
    }
}
