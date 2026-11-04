//! Retained authoritative housing facts and their shared interpretation.

pub mod management;
pub mod payment;

use holtburger_common::{Guid, position::WorldPosition};
use holtburger_protocol::messages::housing::{HouseData, HousePayment, HouseProfile};
use serde::{Deserialize, Serialize};

/// Landscape maintenance period in ACE House.RentInterval and retail HouseSystem.
pub const LANDSCAPE_MAINTENANCE_SECONDS: u64 = 30 * 24 * 60 * 60;

/// Accepted home facts and failed decoding retain which baseline the wire packet supplied.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HousingHomeUpdateSource {
    /// HouseData or the interpreted empty HouseStatus supplies a complete effective-home reply.
    Complete,
    /// Rent time/payment modifies an existing baseline without answering a complete home query.
    Maintenance,
}

/// Validated requirement and its single authoritative remaining-payment calculation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HousingRequirement {
    /// Required item template; pyreal requirements can accept trade notes.
    pub wcid: u32,
    /// Singular display name disclosed by the server.
    pub name: String,
    /// Plural display name disclosed by the server.
    pub plural_name: String,
    /// Total amount required for this period or purchase.
    pub required: u32,
    /// Amount the server has credited, including contributions by other players.
    pub paid: u32,
    /// Outstanding amount, capped at zero when the server credits excess payment.
    pub remaining: u32,
}

impl TryFrom<&HousePayment> for HousingRequirement {
    type Error = String;

    fn try_from(payment: &HousePayment) -> Result<Self, Self::Error> {
        let required = u32::try_from(payment.required)
            .map_err(|_| "Housing payment requirement is negative".to_string())?;
        let paid = u32::try_from(payment.paid)
            .map_err(|_| "Housing credited payment is negative".to_string())?;
        Ok(Self {
            wcid: payment.wcid,
            name: payment.name.clone(),
            plural_name: payment.plural_name.clone(),
            required,
            paid,
            remaining: required.saturating_sub(paid),
        })
    }
}

fn requirements(payments: &[HousePayment]) -> Result<Vec<HousingRequirement>, String> {
    payments.iter().map(HousingRequirement::try_from).collect()
}

/// Effective-home query knowledge. Unqueried is distinct from an authoritative absence.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum HomeKnowledge {
    /// No home-query response has been accepted for this character.
    #[default]
    Unqueried,
    /// ACE replied to a home query with no effective home.
    None,
    /// Full effective-home information, independent of the player's scene residency.
    Owned {
        /// Current authoritative home data and derived maintenance facts.
        home: Box<HousingHome>,
    },
}

/// Current maintenance interval and next deadline, calculated at the world boundary.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HousingMaintenancePeriod {
    /// Beginning of the server's current period, in Unix seconds.
    pub start: u32,
    /// End of the current period, in Unix seconds.
    pub end: u64,
    /// Next due date; no date is due while maintenance is explicitly free.
    pub next_due: Option<u64>,
}

/// Own-home information; the wire contract does not disclose its owner or dwelling ID.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HousingHome {
    /// Raw house type, retaining unknown types without inventing maintenance rules.
    pub house_type: u32,
    /// Known landscape purchase date; ACE does not set apartment purchase dates.
    pub bought_at: Option<u32>,
    /// Maintenance exemption disclosed by the effective-home query.
    pub maintenance_free: bool,
    /// Historical purchase requirements.
    pub buy: Vec<HousingRequirement>,
    /// Current-period maintenance requirements.
    pub rent: Vec<HousingRequirement>,
    /// True when every maintenance requirement has been satisfied.
    pub maintenance_paid: bool,
    /// Exact home position, also retained for apartments without map presentation.
    pub position: WorldPosition,
    /// Known maintenance timing, absent for unknown house types.
    pub period: Option<HousingMaintenancePeriod>,
}

impl TryFrom<&HouseData> for HousingHome {
    type Error = String;

    fn try_from(data: &HouseData) -> Result<Self, Self::Error> {
        let mut home = Self {
            house_type: data.house_type,
            bought_at: (data.buy_time != 0 && data.house_type != 4).then_some(data.buy_time),
            maintenance_free: data.maintenance_free,
            buy: requirements(&data.buy)?,
            rent: requirements(&data.rent)?,
            maintenance_paid: false,
            position: data.position,
            period: None,
        };
        home.update_period(data.rent_time);
        Ok(home)
    }
}

impl HousingHome {
    /// Compare the identity disclosed by home queries, excluding changing maintenance facts.
    /// The wire omits dwelling and owner IDs; explicit ownership events still invalidate access.
    pub fn same_dwelling_as(&self, other: &Self) -> bool {
        self.position == other.position
            && self.house_type == other.house_type
            && self.bought_at == other.bought_at
    }

    fn update_period(&mut self, start: u32) {
        self.maintenance_paid = self.rent.iter().all(|payment| payment.remaining == 0);
        let duration = match self.house_type {
            1..=3 => LANDSCAPE_MAINTENANCE_SECONDS,
            4 => LANDSCAPE_MAINTENANCE_SECONDS * 3,
            _ => {
                self.period = None;
                return;
            }
        };
        let end = u64::from(start) + duration;
        self.period = Some(HousingMaintenancePeriod {
            start,
            end,
            next_due: (!self.maintenance_free)
                .then_some(end + if self.maintenance_paid { duration } else { 0 }),
        });
    }

    /// Apply a wire period replacement without changing payment progress.
    pub(crate) fn update_rent_time(&mut self, start: u32) {
        self.update_period(start);
    }

    /// Apply an explicit payment list, including an empty list, atomically.
    pub(crate) fn update_rent(&mut self, payments: &[HousePayment]) -> Result<(), String> {
        let rent = requirements(payments)?;
        self.rent = rent;
        if let Some(period) = &self.period {
            self.update_period(period.start);
        } else {
            self.maintenance_paid = self.rent.iter().all(|payment| payment.remaining == 0);
        }
        Ok(())
    }
}

/// One crystal's authoritative profile; account relationship is classified in core.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HousingCrystal {
    /// Crystal object used for wire payment actions.
    pub crystal: Guid,
    /// Authored dwelling ID, distinct from the crystal object identity.
    pub dwelling_id: u32,
    /// Owning character, or Guid::NULL when available.
    pub owner: Guid,
    /// Display name of the owner, without inferring account identity.
    pub owner_name: String,
    /// Raw HouseBitfield retained for unknown flags.
    pub flags: u32,
    /// Whether the server allows transactions at this dwelling.
    pub active: bool,
    /// Whether purchase requires a monarch.
    pub requires_monarch: bool,
    /// Raw house type, retaining unknown values.
    pub house_type: u32,
    /// Maintenance exemption disclosed by the crystal profile.
    pub maintenance_free: bool,
    /// All maintenance requirements have been credited in this accepted profile.
    pub maintenance_paid: bool,
    /// Minimum purchase level; -1 is the wire's unbounded sentinel.
    pub min_level: i32,
    /// Maximum purchase level; -1 is the wire's unbounded sentinel.
    pub max_level: i32,
    /// Minimum purchase allegiance rank; -1 is unbounded.
    pub min_allegiance_rank: i32,
    /// Maximum purchase allegiance rank; -1 is unbounded.
    pub max_allegiance_rank: i32,
    /// Validated purchase requirements with derived remaining amounts.
    pub buy: Vec<HousingRequirement>,
    /// Validated maintenance requirements with derived remaining amounts.
    pub rent: Vec<HousingRequirement>,
}

impl HousingCrystal {
    /// Validate a profile before replacing the accepted crystal facts.
    pub fn from_profile(crystal: Guid, profile: &HouseProfile) -> Result<Self, String> {
        let buy = requirements(&profile.buy)?;
        let rent = requirements(&profile.rent)?;
        Ok(Self {
            crystal,
            dwelling_id: profile.dwelling_id,
            owner: profile.owner,
            owner_name: profile.owner_name.clone(),
            flags: profile.flags,
            active: profile.flags & 1 != 0,
            requires_monarch: profile.flags & 2 != 0,
            house_type: profile.house_type,
            maintenance_free: profile.maintenance_free,
            maintenance_paid: rent.iter().all(|payment| payment.remaining == 0),
            min_level: profile.min_level,
            max_level: profile.max_level,
            min_allegiance_rank: profile.min_allegiance_rank,
            max_allegiance_rank: profile.max_allegiance_rank,
            buy,
            rent,
        })
    }
}

/// Character-scoped housing knowledge, independent of UI window lifetime.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct HousingState {
    /// Effective home query knowledge.
    pub home: HomeKnowledge,
    /// Most recently accepted crystal profile; retention does not imply an open HUD.
    pub crystal: Option<HousingCrystal>,
    /// Most recently accepted named effective-home access records; core owns request admission.
    pub access: Option<management::HousingAccessRecords>,
    /// Local access-admission epoch; changes when effective-home identity may have changed.
    pub access_generation: u64,
    /// Last accepted area search, retaining its disclosed type independently of UI selection.
    pub search: Option<management::HousingSearchResults>,
}

impl HousingState {
    /// Changed effective-home facts retire access knowledge without linking a nearby crystal.
    pub(crate) fn replace_home(&mut self, home: HomeKnowledge) {
        let same_dwelling = matches!((&self.home, &home),
            (HomeKnowledge::Owned { home: before }, HomeKnowledge::Owned { home: after })
            if before.same_dwelling_as(after));
        if !same_dwelling {
            self.invalidate_access();
        }
        self.home = home;
    }

    /// Explicit ownership transitions must retire access even when wire home positions coincide.
    pub fn invalidate_access(&mut self) {
        self.access = None;
        self.access_generation = self
            .access_generation
            .checked_add(1)
            .expect("housing access generation exhausted");
    }
}
