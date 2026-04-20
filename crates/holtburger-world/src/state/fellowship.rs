use holtburger_common::Guid;
use holtburger_protocol::messages::{
    FellowshipDepartedMemberData, FellowshipFullUpdateEventData, FellowshipLockData,
    FellowshipLockEntryData, FellowshipMemberData,
};

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct FellowshipMemberState {
    pub guid: Guid,
    pub name: String,
    pub level: u32,
    pub cached_cp: u32,
    pub cached_luminance: u32,
    pub max_health: u32,
    pub max_stamina: u32,
    pub max_mana: u32,
    pub current_health: u32,
    pub current_stamina: u32,
    pub current_mana: u32,
    pub share_loot: bool,
}

impl From<&FellowshipMemberData> for FellowshipMemberState {
    fn from(value: &FellowshipMemberData) -> Self {
        Self {
            guid: value.guid,
            name: value.name.clone(),
            level: value.level,
            cached_cp: value.cached_cp,
            cached_luminance: value.cached_luminance,
            max_health: value.max_health,
            max_stamina: value.max_stamina,
            max_mana: value.max_mana,
            current_health: value.current_health,
            current_stamina: value.current_stamina,
            current_mana: value.current_mana,
            share_loot: value.share_loot_enabled(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct FellowshipDepartedMemberState {
    pub guid: Guid,
    pub departed_timestamp: u32,
}

impl From<&FellowshipDepartedMemberData> for FellowshipDepartedMemberState {
    fn from(value: &FellowshipDepartedMemberData) -> Self {
        Self {
            guid: value.guid,
            departed_timestamp: value.departed_timestamp,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct FellowshipLockState {
    pub unknown_1: u32,
    pub unknown_2: u32,
    pub unknown_3: u32,
    pub timestamp: u32,
    pub sequence: u32,
}

impl From<&FellowshipLockData> for FellowshipLockState {
    fn from(value: &FellowshipLockData) -> Self {
        Self {
            unknown_1: value.unknown_1,
            unknown_2: value.unknown_2,
            unknown_3: value.unknown_3,
            timestamp: value.timestamp,
            sequence: value.sequence,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct FellowshipLockEntryState {
    pub name: String,
    pub lock: FellowshipLockState,
}

impl From<&FellowshipLockEntryData> for FellowshipLockEntryState {
    fn from(value: &FellowshipLockEntryData) -> Self {
        Self {
            name: value.name.clone(),
            lock: FellowshipLockState::from(&value.lock),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct FellowshipState {
    pub name: String,
    pub leader_guid: Guid,
    pub share_xp: bool,
    pub even_share: bool,
    pub open: bool,
    pub is_locked: bool,
    pub members: Vec<FellowshipMemberState>,
    pub departed_members: Vec<FellowshipDepartedMemberState>,
    pub locks: Vec<FellowshipLockEntryState>,
}

impl FellowshipState {
    pub fn unknown_with_member(member: FellowshipMemberState) -> Self {
        Self {
            name: String::new(),
            leader_guid: Guid::NULL,
            share_xp: false,
            even_share: false,
            open: false,
            is_locked: false,
            members: vec![member],
            departed_members: Vec::new(),
            locks: Vec::new(),
        }
    }

    pub fn upsert_member(&mut self, member: FellowshipMemberState) {
        if let Some(existing) = self
            .members
            .iter_mut()
            .find(|existing| existing.guid == member.guid)
        {
            *existing = member;
        } else {
            self.members.push(member);
        }
        self.members.sort_by_key(|member| member.guid.0);
    }

    pub fn remove_member(&mut self, guid: Guid) {
        self.members.retain(|member| member.guid != guid);
    }

    pub fn reassess_leader_after_departure(&mut self, departed_guid: Guid) {
        if self.leader_guid != departed_guid {
            return;
        }

        self.leader_guid = self
            .members
            .first()
            .map(|member| member.guid)
            .unwrap_or(Guid::NULL);
    }
}

impl From<&FellowshipFullUpdateEventData> for FellowshipState {
    fn from(value: &FellowshipFullUpdateEventData) -> Self {
        let mut members = value
            .fellows
            .iter()
            .map(FellowshipMemberState::from)
            .collect::<Vec<_>>();
        members.sort_by_key(|member| member.guid.0);

        Self {
            name: value.fellowship_name.clone(),
            leader_guid: value.leader_guid,
            share_xp: value.share_xp,
            even_share: value.even_share,
            open: value.open,
            is_locked: value.is_locked,
            members,
            departed_members: value
                .departed_members
                .iter()
                .map(FellowshipDepartedMemberState::from)
                .collect(),
            locks: value
                .fellowship_locks
                .iter()
                .map(FellowshipLockEntryState::from)
                .collect(),
        }
    }
}
