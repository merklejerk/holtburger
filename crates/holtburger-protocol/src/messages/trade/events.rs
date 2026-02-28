use crate::errors::WeenieError;
use crate::messages::object::messages::PublicWeenieDescription;
use crate::messages::utils::{read_string16, write_string16};
use crate::traits::{ProtocolPack, ProtocolUnpack};
use byteorder::{ByteOrder, LittleEndian, WriteBytesExt};
use holtburger_common::Guid;
use serde::{Deserialize, Serialize};
use strum_macros::FromRepr;

#[derive(Debug, Clone, Copy, PartialEq, Eq, FromRepr, Serialize, Deserialize)]
#[repr(u32)]
pub enum TradeSide {
    SelfSide = 0x1,
    PartnerSide = 0x2,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, FromRepr, Serialize, Deserialize)]
#[repr(u32)]
pub enum EndTradeReason {
    Normal = 0x1,
    EnteredCombat = 0x2,
    Canceled = 0x51,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct RegisterTradeEventData {
    pub initiator: Guid,
    pub partner: Guid,
    pub unknown: u64, // Always 0 in ACE
}

impl ProtocolUnpack for RegisterTradeEventData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let initiator = Guid::unpack(data, offset)?;
        let partner = Guid::unpack(data, offset)?;
        if *offset + 8 > data.len() {
            return None;
        }
        let unknown = LittleEndian::read_u64(&data[*offset..*offset + 8]);
        *offset += 8;
        Some(Self {
            initiator,
            partner,
            unknown,
        })
    }
}

impl ProtocolPack for RegisterTradeEventData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.initiator.pack(buf);
        self.partner.pack(buf);
        buf.write_u64::<LittleEndian>(self.unknown).unwrap();
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct CloseTradeEventData {
    pub reason: u32, // EndTradeReason
}

impl ProtocolUnpack for CloseTradeEventData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }
        let reason = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        Some(Self { reason })
    }
}

impl ProtocolPack for CloseTradeEventData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.write_u32::<LittleEndian>(self.reason).unwrap();
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct AddToTradeEventData {
    pub object_guid: Guid,
    pub trade_side: u32, // TradeSide
    pub slot: u32,       // Always 0 in ACE
}

impl ProtocolUnpack for AddToTradeEventData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let object_guid = Guid::unpack(data, offset)?;
        if *offset + 8 > data.len() {
            return None;
        }
        let trade_side = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        let slot = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]);
        *offset += 8;
        Some(Self {
            object_guid,
            trade_side,
            slot,
        })
    }
}

impl ProtocolPack for AddToTradeEventData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.object_guid.pack(buf);
        buf.write_u32::<LittleEndian>(self.trade_side).unwrap();
        buf.write_u32::<LittleEndian>(self.slot).unwrap();
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct AcceptTradeEventData {
    pub who_accepted: Guid,
}

impl ProtocolUnpack for AcceptTradeEventData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let who_accepted = Guid::unpack(data, offset)?;
        Some(Self { who_accepted })
    }
}

impl ProtocolPack for AcceptTradeEventData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.who_accepted.pack(buf);
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct TradeFailureEventData {
    pub object_guid: Guid,
    pub reason: WeenieError,
}

impl ProtocolUnpack for TradeFailureEventData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let object_guid = Guid::unpack(data, offset)?;
        if *offset + 4 > data.len() {
            return None;
        }
        let reason_raw = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let reason = WeenieError::from_repr(reason_raw).unwrap_or(WeenieError::None);
        Some(Self {
            object_guid,
            reason,
        })
    }
}

impl ProtocolPack for TradeFailureEventData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.object_guid.pack(buf);
        buf.write_u32::<LittleEndian>(self.reason as u32).unwrap();
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct ResetTradeEventData {
    pub who_reset: Guid,
}

impl ProtocolUnpack for ResetTradeEventData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let who_reset = Guid::unpack(data, offset)?;
        Some(Self { who_reset })
    }
}

impl ProtocolPack for ResetTradeEventData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.who_reset.pack(buf);
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct DeclineTradeEventData {
    pub who_declined: Guid,
}

impl ProtocolUnpack for DeclineTradeEventData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let who_declined = Guid::unpack(data, offset)?;
        Some(Self { who_declined })
    }
}

impl ProtocolPack for DeclineTradeEventData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.who_declined.pack(buf);
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct OpenTradeEventData {
    pub partner_guid: Guid,
}

impl ProtocolUnpack for OpenTradeEventData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let partner_guid = Guid::unpack(data, offset)?;
        Some(Self { partner_guid })
    }
}

impl ProtocolPack for OpenTradeEventData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.partner_guid.pack(buf);
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct VendorItemEventData {
    pub packed_stack_size: u32,
    pub description: PublicWeenieDescription,
}

impl ProtocolUnpack for VendorItemEventData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        if *offset + 4 > data.len() {
            return None;
        }
        let packed_stack_size = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        *offset += 4;
        let description = PublicWeenieDescription::unpack(data, offset)?;
        Some(Self {
            packed_stack_size,
            description,
        })
    }
}

impl ProtocolPack for VendorItemEventData {
    fn pack(&self, buf: &mut Vec<u8>) {
        buf.write_u32::<LittleEndian>(self.packed_stack_size)
            .unwrap();
        self.description.pack(buf);
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct ApproachVendorEventData {
    pub vendor_guid: Guid,
    pub merchandise_item_types: u32,
    pub merchandise_min_value: u32,
    pub merchandise_max_value: u32,
    pub deal_magical_items: u32,
    pub buy_multiplier: f32,
    pub sell_multiplier: f32,
    pub alternate_currency_wcid: u32,
    pub alternate_currency_amount: u32,
    pub alternate_currency_name: String,
    pub items: Vec<VendorItemEventData>,
}

impl ProtocolUnpack for ApproachVendorEventData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        let vendor_guid = Guid::unpack(data, offset)?;
        if *offset + 20 > data.len() {
            return None;
        }
        let merchandise_item_types = LittleEndian::read_u32(&data[*offset..*offset + 4]);
        let merchandise_min_value = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]);
        let merchandise_max_value = LittleEndian::read_u32(&data[*offset + 8..*offset + 12]);
        let deal_magical_items = LittleEndian::read_u32(&data[*offset + 12..*offset + 16]);
        let buy_multiplier = LittleEndian::read_f32(&data[*offset + 16..*offset + 20]);
        *offset += 20;

        if *offset + 12 > data.len() {
            return None;
        }
        let sell_multiplier = LittleEndian::read_f32(&data[*offset..*offset + 4]);
        let alternate_currency_wcid = LittleEndian::read_u32(&data[*offset + 4..*offset + 8]);
        let alternate_currency_amount = LittleEndian::read_u32(&data[*offset + 8..*offset + 12]);
        *offset += 12;

        let alternate_currency_name = read_string16(data, offset)?;

        if *offset + 4 > data.len() {
            return None;
        }
        let num_items = LittleEndian::read_u32(&data[*offset..*offset + 4]) as usize;
        *offset += 4;

        let mut items = Vec::with_capacity(num_items);
        for _ in 0..num_items {
            items.push(VendorItemEventData::unpack(data, offset)?);
        }

        Some(Self {
            vendor_guid,
            merchandise_item_types,
            merchandise_min_value,
            merchandise_max_value,
            deal_magical_items,
            buy_multiplier,
            sell_multiplier,
            alternate_currency_wcid,
            alternate_currency_amount,
            alternate_currency_name,
            items,
        })
    }
}

impl ProtocolPack for ApproachVendorEventData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.vendor_guid.pack(buf);
        buf.write_u32::<LittleEndian>(self.merchandise_item_types)
            .unwrap();
        buf.write_u32::<LittleEndian>(self.merchandise_min_value)
            .unwrap();
        buf.write_u32::<LittleEndian>(self.merchandise_max_value)
            .unwrap();
        buf.write_u32::<LittleEndian>(self.deal_magical_items)
            .unwrap();
        buf.write_f32::<LittleEndian>(self.buy_multiplier).unwrap();
        buf.write_f32::<LittleEndian>(self.sell_multiplier).unwrap();
        buf.write_u32::<LittleEndian>(self.alternate_currency_wcid)
            .unwrap();
        buf.write_u32::<LittleEndian>(self.alternate_currency_amount)
            .unwrap();
        write_string16(buf, &self.alternate_currency_name);
        buf.write_u32::<LittleEndian>(self.items.len() as u32)
            .unwrap();
        for item in &self.items {
            item.pack(buf);
        }
        crate::messages::utils::pad_to_4(buf);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_helpers::assert_pack_unpack_parity;

    #[test]
    fn test_register_trade_roundtrip() {
        let fixture = [
            0x01, 0x00, 0x00, 0x50, 0x02, 0x00, 0x00, 0x50, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00,
        ];
        let data = RegisterTradeEventData {
            initiator: Guid::from(0x50000001),
            partner: Guid::from(0x50000002),
            unknown: 0,
        };
        assert_pack_unpack_parity(&fixture, &data);
    }

    #[test]
    fn test_add_to_trade_event_roundtrip() {
        let fixture = [
            0x10, 0x00, 0x00, 0x50, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        ];
        let data = AddToTradeEventData {
            object_guid: Guid::from(0x50000010),
            trade_side: 1, // Self
            slot: 0,
        };
        assert_pack_unpack_parity(&fixture, &data);
    }

    #[test]
    fn test_approach_vendor_roundtrip() {
        let fixture = [
            0x01, 0x00, 0x00, 0x50, 0xFF, 0xFF, 0xFF, 0xFF, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0xA0, 0x3F, 0x00, 0x00, 0x40, 0x3F,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00,
        ];
        let data = ApproachVendorEventData {
            vendor_guid: Guid::from(0x50000001),
            merchandise_item_types: 0xFFFFFFFF,
            merchandise_min_value: 0,
            merchandise_max_value: 0,
            deal_magical_items: 1,
            buy_multiplier: 1.25,
            sell_multiplier: 0.75,
            alternate_currency_wcid: 0,
            alternate_currency_amount: 0,
            alternate_currency_name: "".to_string(),
            items: vec![],
        };
        assert_pack_unpack_parity(&fixture, &data);
    }

    #[test]
    fn test_close_trade_roundtrip() {
        let fixture = [0x01, 0x00, 0x00, 0x00];
        let data = CloseTradeEventData { reason: 1 };
        assert_pack_unpack_parity(&fixture, &data);
    }

    #[test]
    fn test_accept_trade_event_roundtrip() {
        let fixture = [0x01, 0x00, 0x00, 0x50];
        let data = AcceptTradeEventData {
            who_accepted: Guid::from(0x50000001),
        };
        assert_pack_unpack_parity(&fixture, &data);
    }

    #[test]
    fn test_trade_failure_roundtrip() {
        let fixture = [0x10, 0x00, 0x00, 0x50, 0x50, 0x04, 0x00, 0x00];
        let data = TradeFailureEventData {
            object_guid: Guid::from(0x50000010),
            reason: WeenieError::TradeBusy,
        };
        assert_pack_unpack_parity(&fixture, &data);
    }

    #[test]
    fn test_decline_trade_event_roundtrip() {
        let fixture = [0x01, 0x00, 0x00, 0x50];
        let data = DeclineTradeEventData {
            who_declined: Guid::from(0x50000001),
        };
        assert_pack_unpack_parity(&fixture, &data);
    }

    #[test]
    fn test_open_trade_roundtrip() {
        let fixture = [0x02, 0x00, 0x00, 0x50];
        let data = OpenTradeEventData {
            partner_guid: Guid::from(0x50000002),
        };
        assert_pack_unpack_parity(&fixture, &data);
    }
}
