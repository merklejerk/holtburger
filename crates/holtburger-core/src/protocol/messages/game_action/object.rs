pub use crate::protocol::messages::common::{IdentifyObjectData, UseData};

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::fixtures;
    use crate::protocol::messages::game_action::{GameAction, GameActionMessage};
    use crate::protocol::messages::game_message::GameMessage;
    use crate::protocol::messages::test_helpers::assert_pack_unpack_parity;
    use crate::world::Guid;

    #[test]
    fn test_use_parity() {
        let action = GameMessage::GameAction(Box::new(GameActionMessage {
            sequence: 6,
            action: GameAction::Use(Box::new(UseData {
                guid: Guid(0x33333333),
            })),
        }));
        assert_pack_unpack_parity(fixtures::ACTION_USE, &action);
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
