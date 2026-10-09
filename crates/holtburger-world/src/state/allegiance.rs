//! Retained partial allegiance facts and relationship interpretation shared by clients.

pub mod titles;

use holtburger_common::Guid;
use holtburger_common::properties::{PropertyInstanceId, PropertyUpdate};
use holtburger_protocol::messages::allegiance::{
    AllegianceData, AllegianceNodes, AllegianceUpdateEventData,
};

/// Last authoritative relationship profile; unknown before the first server reply.
#[derive(Debug, Clone, PartialEq)]
pub struct AllegianceState {
    /// Receiving player's rank.
    pub rank: u32,
    /// Total members including monarch, not the disclosed node count.
    pub total_members: u32,
    /// All descendants of this player, not the direct-vassal count.
    pub total_descendants: u32,
    /// Server-reported allegiance name.
    pub name: String,
    /// Partial display tree retained without inventing undisclosed ancestors.
    pub nodes: AllegianceNodes,
}

/// Relationship roles resolved against the receiving character's identity.
#[derive(Debug, PartialEq)]
pub struct AllegianceRelationships<'a> {
    /// Monarch may be the receiving player or their patron.
    pub monarch: Option<&'a AllegianceData>,
    /// Immediate patron, absent for a monarch or an empty profile.
    pub patron: Option<&'a AllegianceData>,
    /// Receiving character's profile node.
    pub self_member: Option<&'a AllegianceData>,
    /// Only children linked to the receiving character.
    pub direct_vassals: Vec<&'a AllegianceData>,
}

impl From<&AllegianceUpdateEventData> for AllegianceState {
    fn from(profile: &AllegianceUpdateEventData) -> Self {
        Self {
            rank: profile.rank,
            total_members: profile.total_members,
            total_descendants: profile.total_descendants,
            name: profile.metadata.name.clone(),
            nodes: profile.nodes.clone(),
        }
    }
}

impl AllegianceState {
    /// A receiving character without a direct patron may request to swear.
    pub fn can_swear(&self, player: Guid) -> bool {
        self.relationships(player).patron.is_none()
    }

    /// Basic management covers only the direct patron and direct vassals.
    pub fn can_break(&self, player: Guid, target: Guid) -> bool {
        let roles = self.relationships(player);
        roles.patron.is_some_and(|node| node.guid == target)
            || roles.direct_vassals.iter().any(|node| node.guid == target)
    }

    /// Changed authoritative links invalidate this partial profile. Matching
    /// echoes and unrelated members do not imply a new relationship view.
    pub fn relationships_changed(
        &self,
        player: Guid,
        guid: Guid,
        updates: &[PropertyUpdate],
    ) -> bool {
        let roles = self.relationships(player);
        updates.iter().any(|update| match update {
            PropertyUpdate::InstanceId(PropertyInstanceId::Patron, patron) if guid == player => {
                roles.patron.map(|node| node.guid) != (*patron != Guid::NULL).then_some(*patron)
            }
            PropertyUpdate::InstanceId(PropertyInstanceId::Monarch, monarch) if guid == player => {
                roles.monarch.map(|node| node.guid) != (*monarch != Guid::NULL).then_some(*monarch)
            }
            PropertyUpdate::InstanceId(PropertyInstanceId::Patron, patron) => {
                roles.direct_vassals.iter().any(|node| node.guid == guid) != (*patron == player)
            }
            _ => false,
        })
    }

    /// Resolve roles from links, never from node ordering or total descendant count.
    pub fn relationships(&self, player: Guid) -> AllegianceRelationships<'_> {
        let AllegianceNodes::Tree { monarch, children } = &self.nodes else {
            return AllegianceRelationships {
                monarch: None,
                patron: None,
                self_member: None,
                direct_vassals: Vec::new(),
            };
        };
        let self_child = children.iter().find(|child| child.data.guid == player);
        let self_member = if monarch.guid == player {
            Some(monarch)
        } else {
            self_child.map(|child| &child.data)
        };
        let patron = self_child.and_then(|child| {
            if child.parent == monarch.guid {
                Some(monarch)
            } else {
                children
                    .iter()
                    .find(|node| node.data.guid == child.parent)
                    .map(|node| &node.data)
            }
        });
        AllegianceRelationships {
            monarch: Some(monarch),
            patron,
            self_member,
            direct_vassals: children
                .iter()
                .filter(|child| child.parent == player)
                .map(|child| &child.data)
                .collect(),
        }
    }

    /// Presence changes only disclosed nodes. Unknown members never create entries.
    pub fn update_presence(&mut self, guid: Guid, online: bool) -> bool {
        let AllegianceNodes::Tree { monarch, children } = &mut self.nodes else {
            return false;
        };
        let member = if monarch.guid == guid {
            Some(monarch)
        } else {
            children
                .iter_mut()
                .find(|child| child.data.guid == guid)
                .map(|child| &mut child.data)
        };
        let Some(member) = member else {
            return false;
        };
        let was_online = member.flags & AllegianceData::LOGGED_IN != 0;
        if online {
            member.flags |= AllegianceData::LOGGED_IN;
        } else {
            member.flags &= !AllegianceData::LOGGED_IN;
        }
        was_online != online
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_protocol::messages::allegiance::{AllegianceChild, AllegianceTime};

    const MONARCH: Guid = Guid(0x50000001);
    const PATRON: Guid = Guid(0x50000002);
    const PLAYER: Guid = Guid(0x50000003);
    const VASSAL: Guid = Guid(0x50000004);

    fn member(guid: Guid) -> AllegianceData {
        AllegianceData {
            guid,
            cached_xp: 1,
            contributed_xp: 2,
            flags: 0x80000000,
            gender: 1,
            heritage: 1,
            rank: 1,
            level: Some(10),
            loyalty: 100,
            leadership: 100,
            time: AllegianceTime::Age {
                time_online: 0,
                allegiance_age: 0,
            },
            name: format!("Member {guid}"),
        }
    }

    fn profile(nodes: AllegianceNodes) -> AllegianceState {
        AllegianceState {
            rank: 1,
            total_members: 20,
            total_descendants: 10,
            name: "Allegiance".into(),
            nodes,
        }
    }

    #[test]
    fn allegiance_roles_use_links_and_distinguish_direct_vassals_from_descendants() {
        let empty = profile(AllegianceNodes::Empty);
        let roles = empty.relationships(PLAYER);
        assert!(roles.monarch.is_none() && roles.patron.is_none() && roles.self_member.is_none());
        assert!(roles.direct_vassals.is_empty());

        for patron in [MONARCH, PATRON] {
            let mut children = vec![
                AllegianceChild {
                    parent: PLAYER,
                    data: member(VASSAL),
                },
                AllegianceChild {
                    parent: patron,
                    data: member(PLAYER),
                },
            ];
            if patron == PATRON {
                children.push(AllegianceChild {
                    parent: MONARCH,
                    data: member(PATRON),
                });
            }
            let state = profile(AllegianceNodes::Tree {
                monarch: member(MONARCH),
                children,
            });
            let roles = state.relationships(PLAYER);
            assert_eq!(roles.monarch.unwrap().guid, MONARCH);
            assert_eq!(roles.patron.unwrap().guid, patron);
            assert_eq!(roles.self_member.unwrap().guid, PLAYER);
            assert_eq!(
                roles
                    .direct_vassals
                    .iter()
                    .map(|node| node.guid)
                    .collect::<Vec<_>>(),
                vec![VASSAL]
            );
            assert_ne!(roles.direct_vassals.len() as u32, state.total_descendants);
        }

        let state = profile(AllegianceNodes::Tree {
            monarch: member(PLAYER),
            children: vec![AllegianceChild {
                parent: PLAYER,
                data: member(VASSAL),
            }],
        });
        let roles = state.relationships(PLAYER);
        assert_eq!(roles.monarch, roles.self_member);
        assert!(roles.patron.is_none());
        assert_eq!(roles.direct_vassals[0].guid, VASSAL);
    }

    #[test]
    fn allegiance_presence_changes_only_known_nodes_and_preserves_other_flags() {
        let mut state = profile(AllegianceNodes::Tree {
            monarch: member(MONARCH),
            children: vec![AllegianceChild {
                parent: MONARCH,
                data: member(PLAYER),
            }],
        });
        assert!(!state.update_presence(VASSAL, true));
        assert!(state.update_presence(PLAYER, true));
        assert!(!state.update_presence(PLAYER, true));
        assert_eq!(
            state.relationships(PLAYER).self_member.unwrap().flags,
            0x80000001
        );
        assert!(state.update_presence(PLAYER, false));
        assert_eq!(
            state.relationships(PLAYER).self_member.unwrap().flags,
            0x80000000
        );
        assert!(state.update_presence(MONARCH, true));
        assert_eq!(
            state.relationships(PLAYER).monarch.unwrap().flags,
            0x80000001
        );
        state.nodes = AllegianceNodes::Empty;
        assert!(!state.update_presence(PLAYER, true));
    }
}
