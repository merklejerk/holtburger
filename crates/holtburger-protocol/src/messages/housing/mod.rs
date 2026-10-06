//! Housing wire contracts, following ACE Network/Structure and GameAction/GameEvent writers.

mod access;
mod management;
pub use access::*;
pub use management::*;

use crate::messages::utils::{read_string16, write_string16};
use crate::traits::{ProtocolPack, ProtocolUnpack};
use holtburger_common::{Guid, position::WorldPosition};
use serde::{Deserialize, Serialize};

/// One purchase or maintenance requirement, including authoritative paid progress.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HousePayment {
    /// Quantity required; signed as on the wire.
    pub required: i32,
    /// Quantity already credited by the server.
    pub paid: i32,
    /// Required item template; pyreals also accept trade notes.
    pub wcid: u32,
    /// Singular payment item name.
    pub name: String,
    /// Server-provided plural payment item name.
    pub plural_name: String,
}

impl ProtocolUnpack for HousePayment {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        Some(Self {
            required: i32::unpack(data, offset)?,
            paid: i32::unpack(data, offset)?,
            wcid: u32::unpack(data, offset)?,
            name: read_string16(data, offset)?,
            plural_name: read_string16(data, offset)?,
        })
    }
}

impl ProtocolPack for HousePayment {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.required.pack(buf);
        self.paid.pack(buf);
        self.wcid.pack(buf);
        write_string16(buf, &self.name);
        write_string16(buf, &self.plural_name);
    }
}

/// A crystal profile; zero owner means the dwelling is unowned.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HouseProfile {
    /// Authored dwelling identity, distinct from crystal object identity.
    pub dwelling_id: u32,
    /// Owning character, or Guid::NULL for available housing.
    pub owner: Guid,
    /// Raw HouseBitfield, retaining unknown flags.
    pub flags: u32,
    /// Minimum character level; -1 means no requirement.
    pub min_level: i32,
    /// Maximum character level; -1 means no requirement.
    pub max_level: i32,
    /// Minimum allegiance rank; -1 means no requirement.
    pub min_allegiance_rank: i32,
    /// Maximum allegiance rank; -1 means no requirement.
    pub max_allegiance_rank: i32,
    /// Server maintenance exemption for this dwelling.
    pub maintenance_free: bool,
    /// Raw HouseType: 1 cottage, 2 villa, 3 mansion, 4 apartment.
    pub house_type: u32,
    /// Display name of the owning character.
    pub owner_name: String,
    /// Purchase requirements and credited progress.
    pub buy: Vec<HousePayment>,
    /// Maintenance requirements and credited progress.
    pub rent: Vec<HousePayment>,
}

impl ProtocolUnpack for HouseProfile {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        Some(Self {
            dwelling_id: u32::unpack(data, offset)?,
            owner: Guid::unpack(data, offset)?,
            flags: u32::unpack(data, offset)?,
            min_level: i32::unpack(data, offset)?,
            max_level: i32::unpack(data, offset)?,
            min_allegiance_rank: i32::unpack(data, offset)?,
            max_allegiance_rank: i32::unpack(data, offset)?,
            maintenance_free: bool::unpack(data, offset)?,
            house_type: u32::unpack(data, offset)?,
            owner_name: read_string16(data, offset)?,
            buy: unpack_list(data, offset)?,
            rent: unpack_list(data, offset)?,
        })
    }
}

impl ProtocolPack for HouseProfile {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.dwelling_id.pack(buf);
        self.owner.pack(buf);
        self.flags.pack(buf);
        self.min_level.pack(buf);
        self.max_level.pack(buf);
        self.min_allegiance_rank.pack(buf);
        self.max_allegiance_rank.pack(buf);
        self.maintenance_free.pack(buf);
        self.house_type.pack(buf);
        write_string16(buf, &self.owner_name);
        pack_list(&self.buy, buf);
        pack_list(&self.rent, buf);
    }
}

/// Effective home information returned by HouseQuery, without owner or dwelling identity.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HouseData {
    /// Purchase Unix timestamp; zero is not a known purchase date.
    pub buy_time: u32,
    /// Beginning of the current maintenance period, in Unix seconds.
    pub rent_time: u32,
    /// Raw house type, retaining unknown values.
    pub house_type: u32,
    /// Effective maintenance exemption, including global server policy.
    pub maintenance_free: bool,
    /// Historical purchase requirements and credited progress.
    pub buy: Vec<HousePayment>,
    /// Current maintenance requirements and credited progress.
    pub rent: Vec<HousePayment>,
    /// Home position, independent of current player location.
    pub position: WorldPosition,
}

impl ProtocolUnpack for HouseData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        Some(Self {
            buy_time: u32::unpack(data, offset)?,
            rent_time: u32::unpack(data, offset)?,
            house_type: u32::unpack(data, offset)?,
            maintenance_free: bool::unpack(data, offset)?,
            buy: unpack_list(data, offset)?,
            rent: unpack_list(data, offset)?,
            position: WorldPosition::unpack(data, offset)?,
        })
    }
}

impl ProtocolPack for HouseData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.buy_time.pack(buf);
        self.rent_time.pack(buf);
        self.house_type.pack(buf);
        self.maintenance_free.pack(buf);
        pack_list(&self.buy, buf);
        pack_list(&self.rent, buf);
        self.position.pack(buf);
    }
}

/// Profile response identifies the interacted crystal.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HouseProfileEventData {
    /// Server object used for purchase or maintenance.
    pub crystal: Guid,
    /// Current server-owned dwelling profile.
    pub profile: HouseProfile,
}

impl ProtocolUnpack for HouseProfileEventData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        Some(Self {
            crystal: Guid::unpack(data, offset)?,
            profile: HouseProfile::unpack(data, offset)?,
        })
    }
}

impl ProtocolPack for HouseProfileEventData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.crystal.pack(buf);
        self.profile.pack(buf);
    }
}

/// Housing notice; its error value is interpreted by the runtime, not the decoder.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HouseStatusEventData {
    /// Raw WeenieError; ACE uses BadParam for no effective home.
    pub status: u32,
}

impl ProtocolUnpack for HouseStatusEventData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        Some(Self {
            status: u32::unpack(data, offset)?,
        })
    }
}

impl ProtocolPack for HouseStatusEventData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.status.pack(buf);
    }
}

/// Incremental replacement of the maintenance period start.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HouseRentTimeEventData {
    /// Beginning of the maintenance period in Unix seconds.
    pub rent_time: u32,
}

impl ProtocolUnpack for HouseRentTimeEventData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        Some(Self {
            rent_time: u32::unpack(data, offset)?,
        })
    }
}

impl ProtocolPack for HouseRentTimeEventData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.rent_time.pack(buf);
    }
}

/// Incremental replacement of maintenance payment requirements.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HouseRentPaymentEventData {
    /// Actual payment list; an empty list is an explicit update.
    pub payments: Vec<HousePayment>,
}

impl ProtocolUnpack for HouseRentPaymentEventData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        Some(Self {
            payments: unpack_list(data, offset)?,
        })
    }
}

impl ProtocolPack for HouseRentPaymentEventData {
    fn pack(&self, buf: &mut Vec<u8>) {
        pack_list(&self.payments, buf);
    }
}

/// Retail transaction notice, not proof of inventory consumption.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HouseTransactionEventData {
    /// Raw transaction notice type.
    pub notice: u32,
}

impl ProtocolUnpack for HouseTransactionEventData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        Some(Self {
            notice: u32::unpack(data, offset)?,
        })
    }
}

impl ProtocolPack for HouseTransactionEventData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.notice.pack(buf);
    }
}

/// Purchase or rent submission; ACE determines quantities consumed from the selected objects.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HousePaymentActionData {
    /// Crystal receiving this payment.
    pub crystal: Guid,
    /// Selected actual inventory object identities, not template IDs.
    pub items: Vec<Guid>,
}

impl ProtocolUnpack for HousePaymentActionData {
    fn unpack(data: &[u8], offset: &mut usize) -> Option<Self> {
        Some(Self {
            crystal: Guid::unpack(data, offset)?,
            items: unpack_list(data, offset)?,
        })
    }
}

impl ProtocolPack for HousePaymentActionData {
    fn pack(&self, buf: &mut Vec<u8>) {
        self.crystal.pack(buf);
        pack_list(&self.items, buf);
    }
}

// Every housing list element contains at least one u32. Bound allocation by the
// available payload before decoding, including malformed count-only packets.
fn unpack_list<T: ProtocolUnpack>(data: &[u8], offset: &mut usize) -> Option<Vec<T>> {
    let count = u32::unpack(data, offset)? as usize;
    if count > data.len().checked_sub(*offset)? / 4 {
        return None;
    }
    (0..count).map(|_| T::unpack(data, offset)).collect()
}

fn pack_list<T: ProtocolPack>(items: &[T], buf: &mut Vec<u8>) {
    (items.len() as u32).pack(buf);
    for item in items {
        item.pack(buf);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn payment_fixture_preserves_signed_fields_and_aligned_names() {
        // ACE HousePaymentExtensions.Write: int Num, int Paid, uint WCID,
        // followed by two aligned String16L values.
        let fixture = hex::decode("0300000001000000110100000100410002004173").unwrap();
        let expected = HousePayment {
            required: 3,
            paid: 1,
            wcid: 273,
            name: "A".into(),
            plural_name: "As".into(),
        };
        let mut offset = 0;
        assert_eq!(
            HousePayment::unpack(&fixture, &mut offset),
            Some(expected.clone())
        );
        assert_eq!(offset, fixture.len());
        let mut packed = Vec::new();
        expected.pack(&mut packed);
        assert_eq!(packed, fixture);
        for length in 0..fixture.len() {
            assert!(
                HousePayment::unpack(&fixture[..length], &mut 0).is_none(),
                "length {length}"
            );
        }
    }

    #[test]
    fn profile_fixture_preserves_unbounded_requirements_and_unknown_flags() {
        // ACE HouseProfileExtensions.Write, empty owner name and requirement lists.
        let fixture = hex::decode(concat!(
            "443322110000000003000080ffffffffffffffffffffffffffffffff",
            "0100000004000000000000000000000000000000"
        ))
        .unwrap();
        let profile = HouseProfile::unpack(&fixture, &mut 0).unwrap();
        assert_eq!(profile.dwelling_id, 0x11223344);
        assert_eq!(profile.owner, Guid::NULL);
        assert_eq!(profile.flags, 0x80000003);
        assert_eq!(profile.min_level, -1);
        assert_eq!(profile.max_level, -1);
        assert_eq!(profile.min_allegiance_rank, -1);
        assert_eq!(profile.max_allegiance_rank, -1);
        assert!(profile.maintenance_free);
        assert_eq!(profile.house_type, 4);
        assert!(profile.buy.is_empty() && profile.rent.is_empty());
        let mut packed = Vec::new();
        profile.pack(&mut packed);
        assert_eq!(packed, fixture);
        for length in 0..fixture.len() {
            assert!(HouseProfile::unpack(&fixture[..length], &mut 0).is_none());
        }
    }

    #[test]
    fn payment_submission_fixture_uses_inventory_ids() {
        let fixture = hex::decode("44332211020000000100005002000050").unwrap();
        let expected = HousePaymentActionData {
            crystal: Guid(0x11223344),
            items: vec![Guid(0x50000001), Guid(0x50000002)],
        };
        assert_eq!(
            HousePaymentActionData::unpack(&fixture, &mut 0),
            Some(expected.clone())
        );
        let mut packed = Vec::new();
        expected.pack(&mut packed);
        assert_eq!(packed, fixture);
        assert!(
            HousePaymentActionData::unpack(&hex::decode("44332211ffffffff").unwrap(), &mut 0)
                .is_none()
        );
    }

    #[test]
    fn housing_opcodes_dispatch_typed_messages() {
        use crate::messages::{GameAction, GameActionMessage, GameEvent, GameEventMessage};
        let query = hex::decode("010000001e020000").unwrap();
        assert!(matches!(
            GameActionMessage::unpack(&query, &mut 0).unwrap().action,
            GameAction::HouseQuery
        ));
        let status = hex::decode("01000050010000002602000002000000").unwrap();
        assert!(
            matches!(GameEventMessage::unpack(&status, &mut 0).unwrap().event, GameEvent::HouseStatus(data) if data.status == 2)
        );
    }
}
