use holtburger_common::Guid;
use holtburger_protocol::messages::{
    FellowshipDepartedMemberData, FellowshipFullUpdateEventData, FellowshipLockData,
    FellowshipLockEntryData, FellowshipMemberData,
};

/// ACE's ordinary fellowship capacity (ACE.Server/Entity/Fellowship.cs:26).
pub const FELLOWSHIP_MEMBER_LIMIT: usize = 9;

/// Locally knowable actor permissions; recipient privacy and locked-party rejoin remain server-owned.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FellowshipCapabilities {
    /// Retain actor identity internally so member checks cannot use a different actor.
    #[serde(skip)]
    player: Option<Guid>,
    /// Leadership permits disbanding and managing other roster members.
    pub is_leader: bool,
    /// Recruitment permission and capacity, excluding recipient-specific restrictions.
    pub can_recruit: bool,
    /// Only the leader of an unlocked fellowship can change recruitment policy.
    pub can_change_openness: bool,
}

impl FellowshipCapabilities {
    /// The supplied target must be a current roster member; self-management uses quit instead.
    pub fn can_manage_member(self, member: &FellowshipMemberState) -> bool {
        self.is_leader && self.player.is_some_and(|player| player != member.guid)
    }
}

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
    /// Last server-reported leader; absent before a full snapshot or after that leader departs.
    pub leader_guid: Option<Guid>,
    pub share_xp: bool,
    pub even_share: bool,
    pub open: bool,
    pub is_locked: bool,
    pub members: Vec<FellowshipMemberState>,
    pub departed_members: Vec<FellowshipDepartedMemberState>,
    pub locks: Vec<FellowshipLockEntryState>,
}

impl FellowshipState {
    /// Shared game rules from Player_Fellowship.cs; no frontend pending or focus policy belongs here.
    pub fn capabilities(&self, player: Option<Guid>) -> FellowshipCapabilities {
        let is_member = player.is_some_and(|player| self.members.iter().any(|m| m.guid == player));
        let is_leader = is_member && self.leader_guid.is_some() && self.leader_guid == player;
        FellowshipCapabilities {
            player,
            is_leader,
            // Locked parties can recruit recent departed members; ACE owns that time-sensitive check.
            can_recruit: is_member
                && (is_leader || self.open)
                && self.members.len() < FELLOWSHIP_MEMBER_LIMIT,
            can_change_openness: is_leader && !self.is_locked,
        }
    }

    pub fn unknown_with_member(member: FellowshipMemberState) -> Self {
        Self {
            name: String::new(),
            leader_guid: None,
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

    /// Departure cannot establish a successor. ACE follows with an authoritative full update.
    pub fn retire_departed_leader(&mut self, departed_guid: Guid) {
        if self.leader_guid == Some(departed_guid) {
            self.leader_guid = None;
        }
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
            leader_guid: (value.leader_guid != Guid::NULL).then_some(value.leader_guid),
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

#[cfg(test)]
mod capability_tests {
    use super::*;

    fn party() -> FellowshipState {
        let member = |guid| FellowshipMemberState {
            guid: Guid(guid),
            name: format!("Member {guid}"),
            level: 1,
            cached_cp: 0,
            cached_luminance: 0,
            max_health: 0,
            max_stamina: 0,
            max_mana: 0,
            current_health: 0,
            current_stamina: 0,
            current_mana: 0,
            share_loot: false,
        };
        let mut party = FellowshipState::unknown_with_member(member(1));
        party.upsert_member(member(2));
        party.leader_guid = Some(Guid(1));
        party
    }

    #[test]
    fn fellowship_capabilities_distinguish_leader_member_and_unknown_actor() {
        let mut party = party();
        let leader = party.capabilities(Some(Guid(1)));
        assert!(leader.is_leader && leader.can_recruit && leader.can_change_openness);
        assert!(!leader.can_manage_member(&party.members[0]));
        assert!(leader.can_manage_member(&party.members[1]));
        for actor in [None, Some(Guid(2)), Some(Guid(99))] {
            let capabilities = party.capabilities(actor);
            assert!(!capabilities.is_leader);
            assert!(!capabilities.can_recruit);
            assert!(!capabilities.can_change_openness);
            assert!(!capabilities.can_manage_member(&party.members[0]));
        }
        party.open = true;
        assert!(party.capabilities(Some(Guid(2))).can_recruit);
        assert!(!party.capabilities(Some(Guid(99))).can_recruit);
        party.leader_guid = None;
        assert!(!party.capabilities(Some(Guid(1))).is_leader);
        assert!(party.capabilities(Some(Guid(1))).can_recruit);
        party.open = false;
        assert!(!party.capabilities(Some(Guid(1))).can_recruit);
    }

    #[test]
    fn fellowship_capabilities_keep_locked_rejoin_server_owned_and_enforce_capacity() {
        let mut party = party();
        party.is_locked = true;
        let leader = party.capabilities(Some(Guid(1)));
        assert!(leader.can_recruit);
        assert!(!leader.can_change_openness);
        assert!(leader.can_manage_member(&party.members[1]));
        while party.members.len() < FELLOWSHIP_MEMBER_LIMIT {
            let mut member = party.members[1].clone();
            member.guid = Guid(party.members.len() as u32 + 1);
            party.upsert_member(member);
        }
        assert!(!party.capabilities(Some(Guid(1))).can_recruit);
        party.open = true;
        assert!(!party.capabilities(Some(Guid(2))).can_recruit);
    }
}
