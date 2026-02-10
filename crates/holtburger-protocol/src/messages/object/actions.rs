pub use crate::messages::object::types::{IdentifyObjectData, UseData};

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_fixtures;
    use crate::messages::game_message::GameMessage;
    use crate::messages::game_action::{GameAction, GameActionMessage};
    use crate::test_helpers::assert_pack_unpack_parity;
    use holtburger_common::Guid;

    #[test]
    fn test_use_parity() {
        let action = GameMessage::GameAction(Box::new(GameActionMessage {
            sequence: 6,
            action: GameAction::Use(Box::new(UseData {
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
            action: GameAction::IdentifyObject(Box::new(IdentifyObjectData {
                guid: Guid(0x11223344),
            })),
        }));
        assert_pack_unpack_parity(&hex::decode(hex).unwrap(), &action);
    }
}
