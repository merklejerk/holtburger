use crate::traits::{ProtocolPack, ProtocolUnpack};
use byteorder::{ByteOrder, LittleEndian, WriteBytesExt};
use holtburger_common::Guid;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct ItemProfileActionData {
    pub amount: i32,
    pub object_guid: Guid,
}

impl ProtocolUnpack for ItemProfileActionData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 8 > data.len() {
            return None;
        }
        let amount = LittleEndian::read_i32(&data[*offset..*offset + 4]);
        *offset += 4;
        let object_guid = Guid::unpack(data, offset)?;
        Some(Self {
            amount,
            object_guid,
        })
    }
}

impl ProtocolPack for ItemProfileActionData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.write_i32::<LittleEndian>(self.amount).unwrap();
        self.object_guid.pack(buf);
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct BuyActionData {
    pub vendor_guid: Guid,
    pub items: Vec<ItemProfileActionData>,
}

impl ProtocolUnpack for BuyActionData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let vendor_guid = Guid::unpack(data, offset)?;
        if *offset + 4 > data.len() {
            return None;
        }
        let num_items = LittleEndian::read_u32(&data[*offset..*offset + 4]) as usize;
        *offset += 4;
        let mut items = Vec::with_capacity(num_items);
        for _ in 0..num_items {
            items.push(ItemProfileActionData::unpack(data, offset)?);
        }
        Some(Self { vendor_guid, items })
    }
}

impl ProtocolPack for BuyActionData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.vendor_guid.pack(buf);
        buf.write_u32::<LittleEndian>(self.items.len() as u32)
            .unwrap();
        for item in &self.items {
            item.pack(buf);
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct SellActionData {
    pub vendor_guid: Guid,
    pub items: Vec<ItemProfileActionData>,
}

impl ProtocolUnpack for SellActionData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let vendor_guid = Guid::unpack(data, offset)?;
        if *offset + 4 > data.len() {
            return None;
        }
        let num_items = LittleEndian::read_u32(&data[*offset..*offset + 4]) as usize;
        *offset += 4;
        let mut items = Vec::with_capacity(num_items);
        for _ in 0..num_items {
            items.push(ItemProfileActionData::unpack(data, offset)?);
        }
        Some(Self { vendor_guid, items })
    }
}

impl ProtocolPack for SellActionData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.vendor_guid.pack(buf);
        buf.write_u32::<LittleEndian>(self.items.len() as u32)
            .unwrap();
        for item in &self.items {
            item.pack(buf);
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct OpenTradeNegotiationsActionData {
    pub trade_partner_guid: Guid,
}

impl ProtocolUnpack for OpenTradeNegotiationsActionData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let trade_partner_guid = Guid::unpack(data, offset)?;
        Some(Self { trade_partner_guid })
    }
}

impl ProtocolPack for OpenTradeNegotiationsActionData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.trade_partner_guid.pack(buf);
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct CloseTradeNegotiationsActionData {}

impl ProtocolUnpack for CloseTradeNegotiationsActionData {
    fn unpack(_data: &[u8], _offset: &mut usize) -> Option<Self> {
        Some(Self {})
    }
}

impl ProtocolPack for CloseTradeNegotiationsActionData {
    fn pack(&self, _buf: &mut Vec<u8>) {}
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct AddToTradeActionData {
    pub item_guid: Guid,
    pub trade_slot: u32,
}

impl ProtocolUnpack for AddToTradeActionData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let item_guid = Guid::unpack(data, offset)?;
        if *offset + 4 > data.len() {
            return None;
        }
        let trade_slot = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        Some(Self {
            item_guid,
            trade_slot,
        })
    }
}

impl ProtocolPack for AddToTradeActionData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.item_guid.pack(buf);
        buf.write_u32::<LittleEndian>(self.trade_slot).unwrap();
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct AcceptTradeActionData {
    pub partner_guid: Guid,
    pub trade_stamp: f64,
    pub trade_status: u32,
    pub initiator_guid: Guid,
    pub initiator_accepts: u32,
    pub partner_accepts: u32,
}

impl ProtocolUnpack for AcceptTradeActionData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let partner_guid = Guid::unpack(data, offset)?;
        if *offset + 24 > data.len() {
            return None;
        }
        let trade_stamp = LittleEndian::read_f64(&data[*offset..*offset + 8]);
        *offset += 8;
        let trade_status = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let initiator_guid = Guid::unpack(data, offset)?;
        let initiator_accepts = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let partner_accepts = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        Some(Self {
            partner_guid,
            trade_stamp,
            trade_status,
            initiator_guid,
            initiator_accepts,
            partner_accepts,
        })
    }
}

impl ProtocolPack for AcceptTradeActionData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.partner_guid.pack(buf);
        buf.write_f64::<LittleEndian>(self.trade_stamp).unwrap();
        buf.write_u32::<LittleEndian>(self.trade_status).unwrap();
        self.initiator_guid.pack(buf);
        buf.write_u32::<LittleEndian>(self.initiator_accepts)
            .unwrap();
        buf.write_u32::<LittleEndian>(self.partner_accepts).unwrap();
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct DeclineTradeActionData {}

impl ProtocolUnpack for DeclineTradeActionData {
    fn unpack(_data: &[u8], _offset: &mut usize) -> Option<Self> {
        Some(Self {})
    }
}

impl ProtocolPack for DeclineTradeActionData {
    fn pack(&self, _buf: &mut Vec<u8>) {}
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct ResetTradeActionData {}

impl ProtocolUnpack for ResetTradeActionData {
    fn unpack(_data: &[u8], _offset: &mut usize) -> Option<Self> {
        Some(Self {})
    }
}

impl ProtocolPack for ResetTradeActionData {
    fn pack(&self, _buf: &mut Vec<u8>) {}
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_helpers::assert_pack_unpack_parity;

    #[test]
    fn test_add_to_trade_action_roundtrip() {
        let fixture = [0x10, 0x00, 0x00, 0x50, 0x00, 0x00, 0x00, 0x00];
        let data = AddToTradeActionData {
            item_guid: Guid::from(0x50000010),
            trade_slot: 0,
        };
        assert_pack_unpack_parity(&fixture, &data);
    }

    #[test]
    fn test_open_trade_negotiations_roundtrip() {
        let fixture = [0x01, 0x00, 0x00, 0x50];
        let data = OpenTradeNegotiationsActionData {
            trade_partner_guid: Guid::from(0x50000001),
        };
        assert_pack_unpack_parity(&fixture, &data);
    }

    #[test]
    fn test_close_trade_negotiations_roundtrip() {
        let fixture = [];
        let data = CloseTradeNegotiationsActionData {};
        assert_pack_unpack_parity(&fixture, &data);
    }

    #[test]
    fn test_accept_trade_action_roundtrip() {
        // From synthetic test: 02 00 00 50 00 00 00 C0 29 8C 67 41 01 00 00 00 01 00 00 50 01 00 00 00 00 00 00 00
        let fixture = [
            0x02, 0x00, 0x00, 0x50, 0x00, 0x00, 0x00, 0xC0, 0x29, 0x8C, 0x67, 0x41, 0x01, 0x00,
            0x00, 0x00, 0x01, 0x00, 0x00, 0x50, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        ];
        let data = AcceptTradeActionData {
            partner_guid: Guid::from(0x50000002),
            trade_stamp: 12345678.0,
            trade_status: 1,
            initiator_guid: Guid::from(0x50000001),
            initiator_accepts: 1,
            partner_accepts: 0,
        };
        assert_pack_unpack_parity(&fixture, &data);
    }

    #[test]
    fn test_decline_trade_action_roundtrip() {
        let fixture = [];
        let data = DeclineTradeActionData {};
        assert_pack_unpack_parity(&fixture, &data);
    }

    #[test]
    fn test_reset_trade_action_roundtrip() {
        let fixture = [];
        let data = ResetTradeActionData {};
        assert_pack_unpack_parity(&fixture, &data);
    }

    #[test]
    fn test_buy_action_roundtrip() {
        let fixture = [
            0x01, 0x00, 0x00, 0x50, 0x01, 0x00, 0x00, 0x00, 0x64, 0x00, 0x00, 0x00, 0x10, 0x00,
            0x00, 0x50,
        ];
        let data = BuyActionData {
            vendor_guid: Guid::from(0x50000001),
            items: vec![ItemProfileActionData {
                amount: 100,
                object_guid: Guid::from(0x50000010),
            }],
        };
        assert_pack_unpack_parity(&fixture, &data);
    }

    #[test]
    fn test_item_profile_roundtrip() {
        let fixture = [0x64, 0x00, 0x00, 0x00, 0x10, 0x00, 0x00, 0x50];
        let data = ItemProfileActionData {
            amount: 100,
            object_guid: Guid::from(0x50000010),
        };
        assert_pack_unpack_parity(&fixture, &data);
    }
}
