//! Object-to-object attachment vocabulary shared by the DAT, protocol, and world layers.
//!
//! Retail models two distinct tiers. Within one object, parts are flat: `CPartArray::UpdateParts`
//! (`acclient.c:314107`) composes every part directly against the object frame. Between objects
//! there is a real hierarchy: a child `CPhysicsObj` attaches to a named point on its parent, which
//! `CPhysicsObj::add_child` (`acclient.c:310340`) resolves through the parent setup's
//! holding-location table into a part index and an offset frame.
//!
//! The two enums here are the keys of that mechanism and are deliberately kept together: a wielded
//! item's [`ParentLocation`] selects where on the parent it hangs, while its [`Placement`] selects
//! which authored pose the item itself adopts. They vary independently.

use serde::{Deserialize, Serialize};
use strum_macros::{Display, FromRepr};

/// Named attach point on a parent object, keying that parent setup's holding-location table.
///
/// Values mirror `ACE/Source/ACE.Entity/Enum/ParentLocation.cs`. All ten are representable because
/// the server may send any of them; the retail archive authors every value except [`Self::Mouth`].
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    PartialOrd,
    Ord,
    Hash,
    FromRepr,
    Display,
    Serialize,
    Deserialize,
)]
#[repr(u32)]
#[strum(serialize_all = "kebab-case")]
#[serde(rename_all = "kebab-case")]
pub enum ParentLocation {
    /// Wire value a server sends when it names no attach point. Setups nonetheless author a real
    /// frame under this key, so it is a genuine table entry rather than a gap.
    None = 0,
    RightHand = 1,
    LeftHand = 2,
    Shield = 3,
    Belt = 4,
    Quiver = 5,
    /// ACE spells this `Hearldry`; the corrected spelling is used here.
    Heraldry = 6,
    /// In the enum but authored by no setup in the retail archive.
    Mouth = 7,
    LeftWeapon = 8,
    LeftUnarmed = 9,
}

impl ParentLocation {
    /// Resolve a wire or DAT attach-point key, rejecting values outside the enum.
    ///
    /// An unrecognized attach point is a real protocol or archive gap. Surfacing it beats
    /// defaulting to a location the object was never authored to hang from.
    pub fn from_key(key: u32) -> Option<Self> {
        Self::from_repr(key)
    }
}

/// Named authored pose, keying a setup's placement-frame table.
///
/// Values mirror `ACE/Source/ACE.Entity/Enum/Placement.cs`, whose key set matches the retail
/// archive exactly. Keys whose gameplay meaning is not established keep their numeric identity in
/// the name rather than being guessed at.
///
/// The wire carries this in the physics description's `ANIMFRAME` field, not in a field of its own:
/// ACE writes `Placement` there (`WorldObject_Networking.cs:341`) and retail reads it back as
/// `animframe_id`, handing it to `SetPlacementFrameInternal` (`acclient.c:310470`).
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    PartialOrd,
    Ord,
    Hash,
    FromRepr,
    Display,
    Serialize,
    Deserialize,
)]
#[repr(u32)]
#[strum(serialize_all = "kebab-case")]
#[serde(rename_all = "kebab-case")]
pub enum Placement {
    Default = 0,
    RightHandCombat = 1,
    RightHandNonCombat = 2,
    LeftHand = 3,
    Belt = 4,
    Quiver = 5,
    Shield = 6,
    LeftWeapon = 7,
    LeftUnarmed = 8,
    Unknown0A = 0x0A,
    Unknown0F = 0x0F,
    Unknown14 = 0x14,
    Unknown1E = 0x1E,
    Unknown20 = 0x20,
    /// ACE spells this `SpecialCrowssbowBolt`; the corrected spelling is used here.
    SpecialCrossbowBolt = 51,
    MissileFlight = 52,
    Unknown3C = 0x3C,
    Unknown63 = 0x63,
    /// The pose retail requests for an object at rest, at `CPhysicsObj::InitObjectEnd`
    /// (`acclient.c:305765`) and `CPartArray::CreateSetup` (`acclient.c:314434`).
    Resting = 101,
    Other = 102,
    Hook = 103,
    Unknown68 = 0x68,
    Unknown69 = 0x69,
    Unknown6A = 0x6A,
    Unknown78 = 0x78,
    Random1 = 121,
    Random2 = 122,
    Random3 = 123,
    Random4 = 124,
    Random5 = 125,
    Random6 = 126,
    Random7 = 127,
    Random8 = 128,
    Random9 = 129,
    Random10 = 130,
    Unknown84 = 0x84,
    UnknownF0 = 0xF0,
    Unknown3F2 = 0x3F2,
}

impl Placement {
    /// Resolve a wire or DAT placement key, rejecting values outside the enum.
    pub fn from_key(key: u32) -> Option<Self> {
        Self::from_repr(key)
    }
}

#[cfg(test)]
mod tests {
    use super::{ParentLocation, Placement};

    #[test]
    fn attach_point_keys_resolve_within_the_enum_and_fail_outside_it() {
        assert_eq!(
            ParentLocation::from_key(8),
            Some(ParentLocation::LeftWeapon)
        );
        assert_eq!(ParentLocation::from_key(10), None);
    }

    #[test]
    fn placement_keys_cover_the_archive_and_reject_unauthored_values() {
        // Every key observed across the 5,935 decodable setups in the retail archive.
        for key in [
            0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 15, 20, 30, 32, 51, 52, 60, 99, 101, 102, 103, 104, 105,
            106, 120, 121, 122, 123, 124, 125, 126, 127, 128, 129, 130, 132, 240, 1010,
        ] {
            assert!(
                Placement::from_key(key).is_some(),
                "archive placement key {key} is not representable"
            );
        }
        assert_eq!(Placement::from_key(0x65), Some(Placement::Resting));
        assert_eq!(Placement::from_key(9), None);
    }

    #[test]
    fn display_and_serde_agree_on_one_wire_spelling() {
        assert_eq!(ParentLocation::LeftWeapon.to_string(), "left-weapon");
        assert_eq!(
            serde_json::to_string(&ParentLocation::LeftWeapon).unwrap(),
            "\"left-weapon\""
        );
        assert_eq!(Placement::RightHandCombat.to_string(), "right-hand-combat");
        assert_eq!(Placement::Unknown3F2.to_string(), "unknown3-f2");
    }
}
