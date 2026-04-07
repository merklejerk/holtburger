use crossterm::event::{KeyCode, KeyEvent};
use holtburger_common::Guid;
use holtburger_core::ClientCommand;
use holtburger_world::state::FellowshipMemberState;
use ratatui::Frame;
use ratatui::layout::Rect;

use super::render::render_party_tab;
use crate::pages::game::{GameData, ViewState};
use crate::types::{AppAction, InspectTarget, Interaction, TabController, UpdateResult, Verb};

#[derive(Debug, Clone)]
pub struct PartyListEntry<'a> {
    pub member: &'a FellowshipMemberState,
    pub is_leader: bool,
    pub is_self: bool,
    pub shares_loot: bool,
    pub nearby: bool,
    pub distance_m: Option<f32>,
}

#[derive(Default, Debug, Clone)]
pub struct PartyTab {
    pub selected_index: usize,
    pub list_state: ratatui::widgets::ListState,
}

impl PartyTab {
    pub(crate) fn clamped_selected_index_for_len(&self, len: usize) -> Option<usize> {
        if len == 0 {
            None
        } else {
            Some(self.selected_index.min(len - 1))
        }
    }

    pub(crate) fn visible_members<'a>(&self, data: &'a GameData) -> Vec<PartyListEntry<'a>> {
        let Some(party) = data.party.as_ref() else {
            return Vec::new();
        };

        let mut members: Vec<_> = party
            .members
            .iter()
            .map(|member| self.build_member_entry(data, member, party.leader_guid))
            .collect();

        members.sort_by(|left, right| {
            left.member
                .name
                .to_lowercase()
                .cmp(&right.member.name.to_lowercase())
                .then_with(|| left.member.guid.0.cmp(&right.member.guid.0))
        });

        members
    }

    fn build_member_entry<'a>(
        &self,
        data: &'a GameData,
        member: &'a FellowshipMemberState,
        leader_guid: Guid,
    ) -> PartyListEntry<'a> {
        let is_self = Some(member.guid) == data.player_guid;
        let nearby = self.is_member_nearby(data, member.guid);

        PartyListEntry {
            member,
            is_leader: member.guid == leader_guid,
            is_self,
            shares_loot: member.share_loot,
            nearby,
            distance_m: self.member_distance(data, member.guid),
        }
    }

    fn member_distance(&self, data: &GameData, guid: Guid) -> Option<f32> {
        if Some(guid) == data.player_guid {
            return Some(0.0);
        }

        let player_pos = data.runtime_player_position()?;
        let entity_pos = data.distance_position_for_guid(guid)?;
        (entity_pos.landblock_id != Guid::NULL).then(|| entity_pos.distance_to(&player_pos))
    }

    fn is_member_nearby(&self, data: &GameData, guid: Guid) -> bool {
        if Some(guid) == data.player_guid {
            return true;
        }

        let Some(player_pos) = data.runtime_player_position() else {
            return false;
        };
        let Some(entity_pos) = data.distance_position_for_guid(guid) else {
            return false;
        };

        entity_pos
            .landblock_chebyshev_distance_to(&player_pos)
            .is_some_and(|distance| distance <= 1)
    }

    fn selected_member<'a>(&self, data: &'a GameData) -> Option<PartyListEntry<'a>> {
        let members = self.visible_members(data);
        let selected_index = self.clamped_selected_index_for_len(members.len())?;
        members.into_iter().nth(selected_index)
    }

    fn is_party_leader(&self, data: &GameData) -> bool {
        data.party
            .as_ref()
            .is_some_and(|party| Some(party.leader_guid) == data.player_guid)
    }

    fn item_count(&self, data: &GameData, _view: &ViewState) -> usize {
        self.visible_members(data).len()
    }
}

impl TabController for PartyTab {
    fn render(&mut self, f: &mut Frame, data: &GameData, view: &ViewState, area: Rect) {
        render_party_tab(self, f, data, view, area);
    }

    fn get_verbs(
        &self,
        data: &GameData,
        _view: &ViewState,
        _interaction: &Option<Interaction>,
    ) -> Vec<Verb> {
        let Some(selected) = self.selected_member(data) else {
            return Vec::new();
        };

        let mut verbs = Vec::new();

        if selected.is_self {
            verbs.push(Verb::new(
                AppAction::SendCommands {
                    commands: vec![ClientCommand::LeaveParty],
                },
                'l',
                "Leave",
            ));
        }

        verbs.extend([
            Verb::new(
                AppAction::Assess {
                    target: InspectTarget::Entity(selected.member.guid),
                },
                'a',
                "Assess",
            ),
            Verb::new(
                AppAction::QueryDebugInfo {
                    target: InspectTarget::Entity(selected.member.guid),
                },
                'g',
                "Debug",
            ),
        ]);

        if selected.nearby && Some(selected.member.guid) != data.player_guid {
            verbs.extend([
                Verb::new(
                    AppAction::Approach {
                        guid: selected.member.guid,
                    },
                    'r',
                    "Approach",
                ),
                Verb::new(
                    AppAction::Follow {
                        guid: selected.member.guid,
                    },
                    'w',
                    "Follow",
                ),
                Verb::new(
                    AppAction::OpenTrade {
                        guid: selected.member.guid,
                    },
                    'd',
                    "Trade",
                ),
            ]);
        }

        if self.is_party_leader(data) && Some(selected.member.guid) != data.player_guid {
            verbs.push(Verb::new(
                AppAction::UninviteFromParty {
                    target: selected.member.guid,
                },
                'k',
                "Kick",
            ));
        }

        verbs
    }

    fn handle_input(
        &mut self,
        key: KeyEvent,
        data: &GameData,
        view: &ViewState,
    ) -> Option<UpdateResult> {
        let count = self.item_count(data, view);
        match key.code {
            KeyCode::Down => {
                if count > 0 {
                    self.selected_index = (self.selected_index + 1).min(count - 1);
                }
                Some(UpdateResult::new())
            }
            KeyCode::Up => {
                self.selected_index = self.selected_index.saturating_sub(1);
                Some(UpdateResult::new())
            }
            KeyCode::Home => {
                self.selected_index = 0;
                Some(UpdateResult::new())
            }
            KeyCode::End => {
                if count > 0 {
                    self.selected_index = count - 1;
                }
                Some(UpdateResult::new())
            }
            KeyCode::PageUp => {
                self.selected_index = self.selected_index.saturating_sub(10);
                Some(UpdateResult::new())
            }
            KeyCode::PageDown => {
                if count > 0 {
                    self.selected_index = (self.selected_index + 10).min(count - 1);
                }
                Some(UpdateResult::new())
            }
            KeyCode::Enter | KeyCode::Char(_) => {
                let shortcut = match key.code {
                    KeyCode::Enter => '\r',
                    KeyCode::Char(c) => c,
                    _ => return None,
                };
                let verbs = self.get_verbs(data, view, &view.active_interaction);
                let verb = verbs.into_iter().find(|verb| verb.shortcut == shortcut)?;
                Some(UpdateResult::new().with_action(verb.action))
            }
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::position::WorldPosition;
    use holtburger_core::ClientViewEvent;
    use holtburger_world::entity::Entity;
    use holtburger_world::state::FellowshipState;
    use holtburger_world::{RuntimeSpatialBodyView, SpatialBodyId, SpatialSampleMode};
    use std::time::Instant;

    fn select_member(tab: &mut PartyTab, data: &GameData, name: &str) {
        tab.selected_index = tab
            .visible_members(data)
            .iter()
            .position(|entry| entry.member.name == name)
            .expect("member should be visible");
    }

    fn seed_runtime_body(
        data: &mut GameData,
        body_id: SpatialBodyId,
        authoritative_pose: WorldPosition,
        runtime_pose: WorldPosition,
    ) {
        data.runtime_body_cache.apply_view_event(
            &ClientViewEvent::RuntimeBodyUpserted {
                body: Box::new(RuntimeSpatialBodyView {
                    body_id,
                    authoritative_pose: Some(authoritative_pose),
                    runtime_pose,
                    velocity: holtburger_common::Vector3::zero(),
                    omega: holtburger_common::Vector3::zero(),
                    motion_state: None,
                    contact: holtburger_world::ContactState::Grounded,
                    sample_mode: SpatialSampleMode::SimulatingMotionState,
                }),
            },
            Instant::now(),
        );
    }

    #[test]
    fn visible_members_are_sorted_by_name() {
        let player_guid = Guid(0x50000001);
        let member_guid = Guid(0x50000002);
        let mut data = GameData::new(player_guid, "Player".to_string(), "World".to_string());
        data.party = Some(FellowshipState {
            members: vec![
                FellowshipMemberState {
                    guid: player_guid,
                    name: "Zulu".to_string(),
                    level: 275,
                    cached_cp: 0,
                    cached_luminance: 0,
                    max_health: 300,
                    max_stamina: 250,
                    max_mana: 200,
                    current_health: 300,
                    current_stamina: 250,
                    current_mana: 200,
                    share_loot: true,
                },
                FellowshipMemberState {
                    guid: member_guid,
                    name: "alpha".to_string(),
                    level: 274,
                    cached_cp: 0,
                    cached_luminance: 0,
                    max_health: 280,
                    max_stamina: 220,
                    max_mana: 180,
                    current_health: 250,
                    current_stamina: 200,
                    current_mana: 175,
                    share_loot: false,
                },
            ],
            ..party_state(player_guid, member_guid)
        });

        let tab = PartyTab::default();
        let visible_names: Vec<_> = tab
            .visible_members(&data)
            .into_iter()
            .map(|entry| entry.member.name.clone())
            .collect();

        assert_eq!(visible_names, vec!["alpha".to_string(), "Zulu".to_string()]);
    }

    #[test]
    fn clamped_selected_index_returns_none_for_empty_list() {
        let tab = PartyTab::default();

        assert_eq!(tab.clamped_selected_index_for_len(0), None);
    }

    #[test]
    fn get_verbs_is_empty_when_party_has_no_members() {
        let mut data = GameData::new(Guid(0x50000001), "Player".to_string(), "World".to_string());
        data.party = Some(FellowshipState {
            name: "Raid Bus".to_string(),
            leader_guid: Guid(0x50000001),
            share_xp: true,
            even_share: true,
            open: false,
            is_locked: false,
            members: Vec::new(),
            departed_members: Vec::new(),
            locks: Vec::new(),
        });

        let verbs = PartyTab::default().get_verbs(&data, &ViewState::default(), &None);

        assert!(verbs.is_empty());
    }

    #[test]
    fn nearby_member_shows_social_verbs() {
        let player_guid = Guid(0x50000001);
        let nearby_guid = Guid(0x50000002);
        let mut data = GameData::new(player_guid, "Player".to_string(), "World".to_string());
        data.player_pos = Some(world_pos(0.0));
        data.party = Some(party_state(player_guid, nearby_guid));
        data.entities.insert(
            nearby_guid,
            Entity::new(nearby_guid, "Bestie".to_string(), world_pos(3.0)),
        );

        let mut tab = PartyTab::default();
        select_member(&mut tab, &data, "Bestie");
        let verbs = tab.get_verbs(&data, &ViewState::default(), &None);

        assert!(has_label(&verbs, "Approach"));
        assert!(has_label(&verbs, "Follow"));
        assert!(has_label(&verbs, "Trade"));
        assert!(has_label(&verbs, "Kick"));
        assert!(!has_label(&verbs, "Leave"));
    }

    #[test]
    fn member_distance_uses_runtime_self_but_authoritative_other_member_pose() {
        let player_guid = Guid(0x50000001);
        let member_guid = Guid(0x50000002);
        let mut data = GameData::new(player_guid, "Player".to_string(), "World".to_string());
        data.player_pos = Some(world_pos(0.0));
        data.party = Some(party_state(player_guid, member_guid));

        let authoritative_member = world_pos(50.0);
        data.entities.insert(
            member_guid,
            Entity::new(member_guid, "Bestie".to_string(), authoritative_member),
        );

        seed_runtime_body(
            &mut data,
            SpatialBodyId::LocalPlayer(player_guid),
            world_pos(0.0),
            world_pos(10.0),
        );
        seed_runtime_body(
            &mut data,
            SpatialBodyId::Entity(member_guid),
            authoritative_member,
            world_pos(12.0),
        );

        let tab = PartyTab::default();

        assert_eq!(tab.member_distance(&data, member_guid), Some(40.0));
    }

    #[test]
    fn selecting_self_offers_leave_but_not_kick() {
        let player_guid = Guid(0x50000001);
        let member_guid = Guid(0x50000002);
        let mut data = GameData::new(player_guid, "Player".to_string(), "World".to_string());
        data.party = Some(party_state(player_guid, member_guid));

        let mut tab = PartyTab::default();
        select_member(&mut tab, &data, "Player");
        let verbs = tab.get_verbs(&data, &ViewState::default(), &None);

        assert!(has_label(&verbs, "Leave"));
        assert!(!has_label(&verbs, "Kick"));
    }

    #[test]
    fn selecting_other_as_non_leader_offers_neither_leave_nor_kick() {
        let player_guid = Guid(0x50000001);
        let leader_guid = Guid(0x50000009);
        let member_guid = Guid(0x50000002);
        let mut data = GameData::new(player_guid, "Player".to_string(), "World".to_string());
        data.party = Some(FellowshipState {
            leader_guid,
            ..party_state(player_guid, member_guid)
        });

        let mut tab = PartyTab::default();
        select_member(&mut tab, &data, "Bestie");
        let verbs = tab.get_verbs(&data, &ViewState::default(), &None);

        assert!(!has_label(&verbs, "Leave"));
        assert!(!has_label(&verbs, "Kick"));
    }

    #[test]
    fn selected_member_clamps_when_party_list_shrinks() {
        let player_guid = Guid(0x50000001);
        let member_guid = Guid(0x50000002);
        let mut data = GameData::new(player_guid, "Player".to_string(), "World".to_string());
        data.party = Some(party_state(player_guid, member_guid));

        let mut tab = PartyTab::default();
        select_member(&mut tab, &data, "Bestie");

        data.party = Some(FellowshipState {
            members: vec![FellowshipMemberState {
                guid: player_guid,
                name: "Player".to_string(),
                level: 275,
                cached_cp: 0,
                cached_luminance: 0,
                max_health: 300,
                max_stamina: 250,
                max_mana: 200,
                current_health: 300,
                current_stamina: 250,
                current_mana: 200,
                share_loot: true,
            }],
            ..party_state(player_guid, member_guid)
        });

        let selected = tab
            .selected_member(&data)
            .expect("selection should clamp to remaining member");
        let verbs = tab.get_verbs(&data, &ViewState::default(), &None);

        assert_eq!(selected.member.name, "Player");
        assert!(has_label(&verbs, "Leave"));
    }

    #[test]
    fn distant_member_hides_social_verbs() {
        let player_guid = Guid(0x50000001);
        let remote_guid = Guid(0x50000002);
        let mut data = GameData::new(player_guid, "Player".to_string(), "World".to_string());
        data.player_pos = Some(world_pos(0.0));
        data.party = Some(party_state(player_guid, remote_guid));
        data.entities.insert(
            remote_guid,
            Entity::new(
                remote_guid,
                "Bestie".to_string(),
                WorldPosition {
                    landblock_id: Guid(0x03000000),
                    ..world_pos(0.0)
                },
            ),
        );

        let mut tab = PartyTab::default();
        select_member(&mut tab, &data, "Bestie");
        let verbs = tab.get_verbs(&data, &ViewState::default(), &None);

        assert!(!has_label(&verbs, "Approach"));
        assert!(!has_label(&verbs, "Follow"));
        assert!(!has_label(&verbs, "Trade"));
        assert!(has_label(&verbs, "Assess"));
        assert!(has_label(&verbs, "Debug"));
    }

    #[test]
    fn adjacent_landblock_counts_as_nearby() {
        let player_guid = Guid(0x50000001);
        let nearby_guid = Guid(0x50000002);
        let mut data = GameData::new(player_guid, "Player".to_string(), "World".to_string());
        data.player_pos = Some(world_pos(0.0));
        data.party = Some(party_state(player_guid, nearby_guid));
        data.entities.insert(
            nearby_guid,
            Entity::new(
                nearby_guid,
                "Bestie".to_string(),
                WorldPosition {
                    landblock_id: Guid(0x02010000),
                    ..world_pos(3.0)
                },
            ),
        );

        let mut tab = PartyTab::default();
        select_member(&mut tab, &data, "Bestie");

        assert!(tab.selected_member(&data).is_some_and(|entry| entry.nearby));
        assert!(has_label(
            &tab.get_verbs(&data, &ViewState::default(), &None),
            "Approach"
        ));
    }

    #[test]
    fn two_landblocks_away_is_not_nearby() {
        let player_guid = Guid(0x50000001);
        let remote_guid = Guid(0x50000002);
        let mut data = GameData::new(player_guid, "Player".to_string(), "World".to_string());
        data.player_pos = Some(world_pos(0.0));
        data.party = Some(party_state(player_guid, remote_guid));
        data.entities.insert(
            remote_guid,
            Entity::new(
                remote_guid,
                "Bestie".to_string(),
                WorldPosition {
                    landblock_id: Guid(0x03010000),
                    ..world_pos(3.0)
                },
            ),
        );

        let mut tab = PartyTab::default();
        select_member(&mut tab, &data, "Bestie");

        assert!(
            tab.selected_member(&data)
                .is_some_and(|entry| !entry.nearby)
        );
        assert!(!has_label(
            &tab.get_verbs(&data, &ViewState::default(), &None),
            "Approach"
        ));
    }

    #[test]
    fn non_leader_cannot_remove_members() {
        let player_guid = Guid(0x50000001);
        let leader_guid = Guid(0x50000009);
        let member_guid = Guid(0x50000002);
        let mut data = GameData::new(player_guid, "Player".to_string(), "World".to_string());
        data.party = Some(FellowshipState {
            leader_guid,
            ..party_state(player_guid, member_guid)
        });

        let mut tab = PartyTab::default();
        select_member(&mut tab, &data, "Bestie");
        let verbs = tab.get_verbs(&data, &ViewState::default(), &None);

        assert!(!has_label(&verbs, "Kick"));
        assert!(!has_label(&verbs, "Leave"));
    }

    fn has_label(verbs: &[Verb], label: &str) -> bool {
        verbs.iter().any(|verb| verb.label == label)
    }

    fn world_pos(x: f32) -> WorldPosition {
        WorldPosition {
            landblock_id: Guid(0x01000000),
            coords: holtburger_common::Vector3::new(x, 0.0, 0.0),
            ..WorldPosition::default()
        }
    }

    fn party_state(player_guid: Guid, member_guid: Guid) -> FellowshipState {
        FellowshipState {
            name: "Raid Bus".to_string(),
            leader_guid: player_guid,
            share_xp: true,
            even_share: true,
            open: false,
            is_locked: false,
            members: vec![
                FellowshipMemberState {
                    guid: player_guid,
                    name: "Player".to_string(),
                    level: 275,
                    cached_cp: 0,
                    cached_luminance: 0,
                    max_health: 300,
                    max_stamina: 250,
                    max_mana: 200,
                    current_health: 300,
                    current_stamina: 250,
                    current_mana: 200,
                    share_loot: true,
                },
                FellowshipMemberState {
                    guid: member_guid,
                    name: "Bestie".to_string(),
                    level: 274,
                    cached_cp: 0,
                    cached_luminance: 0,
                    max_health: 280,
                    max_stamina: 220,
                    max_mana: 180,
                    current_health: 250,
                    current_stamina: 200,
                    current_mana: 175,
                    share_loot: false,
                },
            ],
            departed_members: Vec::new(),
            locks: Vec::new(),
        }
    }
}
