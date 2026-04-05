use crate::traits::{ProtocolPack, ProtocolUnpack};
use holtburger_common::Guid;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BookPageDataActionData {
    pub guid: Guid,
    pub page_index: i32,
}

impl ProtocolUnpack for BookPageDataActionData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        Some(Self {
            guid: Guid::unpack(data, offset)?,
            page_index: i32::unpack(data, offset)?,
        })
    }
}

impl ProtocolPack for BookPageDataActionData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.guid.pack(buf);
        self.page_index.pack(buf);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::messages::game_action::{GameAction, GameActionMessage};
    use crate::messages::game_message::GameMessage;
    use crate::test_helpers::assert_pack_unpack_parity;

    #[test]
    fn test_book_page_data_action_fixture() {
        // Generated from ACE: SyntheticProtocolTests.DumpBookProtocolFixtures
        let fixture = hex::decode("B1F7000011000000AE0000004433221101000000").unwrap();
        let expected = GameMessage::GameAction(Box::new(GameActionMessage {
            sequence: 0x11,
            action: GameAction::BookPageData(Box::new(BookPageDataActionData {
                guid: Guid(0x11223344),
                page_index: 1,
            })),
        }));
        assert_pack_unpack_parity(&fixture, &expected);
    }
}
