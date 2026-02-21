use byteorder::{ByteOrder, LittleEndian, WriteBytesExt};
use holtburger_common::Guid;
use holtburger_common::traits::{ProtocolPack, ProtocolUnpack};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct ItemProfile {
    pub amount: i32,
    pub object_guid: Guid,
}

impl ProtocolUnpack for ItemProfile {
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

impl ProtocolPack for ItemProfile {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.write_i32::<LittleEndian>(self.amount).unwrap();
        self.object_guid.pack(buf);
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct BuyData {
    pub vendor_guid: Guid,
    pub items: Vec<ItemProfile>,
}

impl ProtocolUnpack for BuyData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let vendor_guid = Guid::unpack(data, offset)?;
        if *offset + 4 > data.len() {
            return None;
        }
        let num_items = LittleEndian::read_u32(&data[*offset..*offset + 4]) as usize;
        *offset += 4;
        let mut items = Vec::with_capacity(num_items);
        for _ in 0..num_items {
            items.push(ItemProfile::unpack(data, offset)?);
        }
        Some(Self { vendor_guid, items })
    }
}

impl ProtocolPack for BuyData {
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
pub struct SellData {
    pub vendor_guid: Guid,
    pub items: Vec<ItemProfile>,
}

impl ProtocolUnpack for SellData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let vendor_guid = Guid::unpack(data, offset)?;
        if *offset + 4 > data.len() {
            return None;
        }
        let num_items = LittleEndian::read_u32(&data[*offset..*offset + 4]) as usize;
        *offset += 4;
        let mut items = Vec::with_capacity(num_items);
        for _ in 0..num_items {
            items.push(ItemProfile::unpack(data, offset)?);
        }
        Some(Self { vendor_guid, items })
    }
}

impl ProtocolPack for SellData {
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
pub struct OpenTradeNegotiationsData {
    pub trade_partner_guid: Guid,
}

impl ProtocolUnpack for OpenTradeNegotiationsData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let trade_partner_guid = Guid::unpack(data, offset)?;
        Some(Self { trade_partner_guid })
    }
}

impl ProtocolPack for OpenTradeNegotiationsData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.trade_partner_guid.pack(buf);
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct CloseTradeNegotiationsData {}

impl ProtocolUnpack for CloseTradeNegotiationsData {
    fn unpack(_data: &[u8], _offset: &mut usize) -> Option<Self> {
        Some(Self {})
    }
}

impl ProtocolPack for CloseTradeNegotiationsData {
    fn pack(&self, _buf: &mut Vec<u8>) {}
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct AddToTradeData {
    pub item_guid: Guid,
    pub trade_slot: u32,
}

impl ProtocolUnpack for AddToTradeData {
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

impl ProtocolPack for AddToTradeData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.item_guid.pack(buf);
        buf.write_u32::<LittleEndian>(self.trade_slot).unwrap();
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct AcceptTradeData {
    pub partner_guid: Guid,
    pub trade_stamp: f64,
    pub trade_status: u32,
    pub initiator_guid: Guid,
    pub initiator_accepts: u32,
    pub partner_accepts: u32,
}

impl ProtocolUnpack for AcceptTradeData {
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

impl ProtocolPack for AcceptTradeData {
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
pub struct DeclineTradeData {}

impl ProtocolUnpack for DeclineTradeData {
    fn unpack(_data: &[u8], _offset: &mut usize) -> Option<Self> {
        Some(Self {})
    }
}

impl ProtocolPack for DeclineTradeData {
    fn pack(&self, _buf: &mut Vec<u8>) {}
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct ResetTradeData {}

impl ProtocolUnpack for ResetTradeData {
    fn unpack(_data: &[u8], _offset: &mut usize) -> Option<Self> {
        Some(Self {})
    }
}

impl ProtocolPack for ResetTradeData {
    fn pack(&self, _buf: &mut Vec<u8>) {}
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct ApproachVendorActionData {
    pub vendor_guid: Guid,
}

impl ProtocolUnpack for ApproachVendorActionData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let vendor_guid = Guid::unpack(data, offset)?;
        Some(Self { vendor_guid })
    }
}

impl ProtocolPack for ApproachVendorActionData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.vendor_guid.pack(buf);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_helpers::assert_pack_unpack_parity;

    #[test]
    fn test_add_to_trade_action_roundtrip() {
        let fixture = [0x10, 0x00, 0x00, 0x50, 0x00, 0x00, 0x00, 0x00];
        let data = AddToTradeData {
            item_guid: Guid::from(0x50000010),
            trade_slot: 0,
        };
        assert_pack_unpack_parity(&fixture, &data);
    }

    #[test]
    fn test_open_trade_negotiations_roundtrip() {
        let fixture = [0x01, 0x00, 0x00, 0x50];
        let data = OpenTradeNegotiationsData {
            trade_partner_guid: Guid::from(0x50000001),
        };
        assert_pack_unpack_parity(&fixture, &data);
    }

    #[test]
    fn test_close_trade_negotiations_roundtrip() {
        let fixture = [];
        let data = CloseTradeNegotiationsData {};
        assert_pack_unpack_parity(&fixture, &data);
    }

    #[test]
    fn test_accept_trade_action_roundtrip() {
        // From synthetic test: 02 00 00 50 00 00 00 C0 29 8C 67 41 01 00 00 00 01 00 00 50 01 00 00 00 00 00 00 00
        let fixture = [
            0x02, 0x00, 0x00, 0x50, 0x00, 0x00, 0x00, 0xC0, 0x29, 0x8C, 0x67, 0x41, 0x01, 0x00,
            0x00, 0x00, 0x01, 0x00, 0x00, 0x50, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        ];
        let data = AcceptTradeData {
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
        let data = DeclineTradeData {};
        assert_pack_unpack_parity(&fixture, &data);
    }

    #[test]
    fn test_reset_trade_action_roundtrip() {
        let fixture = [];
        let data = ResetTradeData {};
        assert_pack_unpack_parity(&fixture, &data);
    }

    #[test]
    fn test_approach_vendor_action_roundtrip() {
        let fixture = [0x01, 0x00, 0x00, 0x50];
        let data = ApproachVendorActionData {
            vendor_guid: Guid::from(0x50000001),
        };
        assert_pack_unpack_parity(&fixture, &data);
    }

    #[test]
    fn test_buy_action_roundtrip() {
        let fixture = [
            0x01, 0x00, 0x00, 0x50, 0x01, 0x00, 0x00, 0x00, 0x64, 0x00, 0x00, 0x00, 0x10, 0x00,
            0x00, 0x50,
        ];
        let data = BuyData {
            vendor_guid: Guid::from(0x50000001),
            items: vec![ItemProfile {
                amount: 100,
                object_guid: Guid::from(0x50000010),
            }],
        };
        assert_pack_unpack_parity(&fixture, &data);
    }

    #[test]
    fn test_item_profile_roundtrip() {
        let fixture = [0x64, 0x00, 0x00, 0x00, 0x10, 0x00, 0x00, 0x50];
        let data = ItemProfile {
            amount: 100,
            object_guid: Guid::from(0x50000010),
        };
        assert_pack_unpack_parity(&fixture, &data);
    }
}
