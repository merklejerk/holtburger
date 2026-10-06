//! Shared interpretation of disclosed housing permissions and available search areas.

use holtburger_common::Guid;
use holtburger_protocol::messages::housing::{
    HouseAccess, HouseAccessFormat, HouseAvailableHouses,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

/// Named entry permission and optional storage grant, independent of nearby occupants.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HousingGuestAccess {
    /// Permitted character, not the house owner.
    pub character: Guid,
    /// Server-provided name accepted by guest/storage/boot actions.
    pub name: String,
    /// This named guest can also use storage.
    pub storage_allowed: bool,
}

/// Versioned HAR provides these facts; legacy records leave the whole disclosure absent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HousingAllegianceAccess {
    /// Raw HARBitfield, retaining any rules beyond the currently understood bits.
    pub flags: u32,
    /// Server-disclosed monarch; this is not the effective-home owner.
    pub monarch: Guid,
    /// Storage permission also implies entry, per ACE HouseAccess flag construction.
    pub entry_allowed: bool,
    /// Allegiance storage permission is explicitly disclosed.
    pub storage_allowed: bool,
}

/// Retained permission facts do not establish which account character may administer them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HousingAccessRecords {
    /// Public entry, distinct from storage permission.
    pub public_entry: bool,
    /// Named guest entries; hash bucket metadata has no game permission meaning.
    pub guests: Vec<HousingGuestAccess>,
    /// Absent when an older wire format did not disclose allegiance rules.
    pub allegiance: Option<HousingAllegianceAccess>,
    /// Account roommates, excluding the owner; absent when not disclosed by that wire version.
    pub roommates: Option<Vec<Guid>>,
}

impl TryFrom<&HouseAccess> for HousingAccessRecords {
    type Error = String;

    fn try_from(access: &HouseAccess) -> Result<Self, Self::Error> {
        let mut seen = BTreeSet::new();
        let guests = access
            .guests
            .entries
            .iter()
            .map(|guest| {
                if !seen.insert(guest.character) {
                    return Err("Housing access records repeat a guest identity".into());
                }
                Ok(HousingGuestAccess {
                    character: guest.character,
                    name: guest.name.clone(),
                    storage_allowed: guest.storage_allowed,
                })
            })
            .collect::<Result<Vec<_>, String>>()?;
        let (public_entry, allegiance, roommates) = match &access.format {
            HouseAccessFormat::Legacy { open_status } => (*open_status != 0, None, None),
            HouseAccessFormat::Version1 { flags, monarch }
            | HouseAccessFormat::Version2 { flags, monarch, .. } => {
                let roommates = match &access.format {
                    HouseAccessFormat::Version2 { roommates, .. } => Some(roommates.clone()),
                    _ => None,
                };
                (
                    *flags & 1 != 0,
                    Some(HousingAllegianceAccess {
                        flags: *flags,
                        monarch: *monarch,
                        entry_allowed: *flags & 6 != 0,
                        storage_allowed: *flags & 4 != 0,
                    }),
                    roommates,
                )
            }
        };
        Ok(Self {
            public_entry,
            guests,
            allegiance,
            roommates,
        })
    }
}

/// Available locations describe areas; the server's total counts individual houses.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HousingSearchResults {
    /// Raw searched HouseType, including unsupported future types as retained knowledge.
    pub house_type: u32,
    /// Distinct location cells in server order, never precise crystal identities.
    pub areas: Vec<Guid>,
    /// Number of available houses, independent of area count.
    pub total_available: u32,
}

impl TryFrom<&HouseAvailableHouses> for HousingSearchResults {
    type Error = String;

    fn try_from(result: &HouseAvailableHouses) -> Result<Self, Self::Error> {
        let total_available = u32::try_from(result.total_available)
            .map_err(|_| "Available housing count is negative".to_string())?;
        let mut seen = BTreeSet::new();
        let areas: Vec<_> = result
            .locations
            .iter()
            .filter(|cell| seen.insert(**cell))
            .map(|cell| Guid(*cell))
            .collect();
        if areas.len() > total_available as usize {
            return Err("Available housing areas exceed the total house count".into());
        }
        Ok(Self {
            house_type: result.house_type,
            areas,
            total_available,
        })
    }
}
