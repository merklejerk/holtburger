use crossterm::event::{KeyCode, KeyEvent};
use holtburger_common::Guid;
use holtburger_core::ClientCommand;
use holtburger_world::state::FellowshipMemberState;
use ratatui::Frame;
use ratatui::layout::Rect;

use super::render::render_party_tab;
use crate::pages::game::{GameData, ViewState};
use crate::types::{
    AppAction, AppUiAction, DashboardTab, FilterInputSession, FooterVerbVisibility, InspectTarget,
    Interaction, TabController, TabFilterState, UpdateResult, Verb, VerbInputEvent,
    VerbInputState,
};
use crate::utils::{fuzzy_subsequence_match, normalize_filter_tokens};

#[derive(Debug, Clone)]
pub struct PartyListEntry<'a> {
    pub member: &'a FellowshipMemberState,
    pub badges: String,
    pub distance_suffix: String,
    nearby: bool,
}

#[derive(Default, Debug, Clone)]
pub struct PartyTab {
    pub selected_index: usize,
    pub list_state: ratatui::widgets::ListState,
    active_filter: Option<TabFilterState>,
    filter_input: Option<FilterInputSession>,
}

impl PartyTab {
    pub(crate) fn visible_members<'a>(&self, data: &'a GameData) -> Vec<PartyListEntry<'a>> {
        let Some(party) = data.party.as_ref() else {
            return Vec::new();
        };

        party
            .members
            .iter()
            .filter(|member| self.matches_active_filter(&member.name))
            .map(|member| self.build_member_entry(data, member, party.leader_guid))
            .collect()
    }

    fn build_member_entry<'a>(
        &self,
        data: &'a GameData,
        member: &'a FellowshipMemberState,
        leader_guid: Guid,
    ) -> PartyListEntry<'a> {
        let is_self = Some(member.guid) == data.player_guid;
        let nearby = self.is_member_nearby(data, member.guid);
        let distance_suffix = self
            .member_distance(data, member.guid)
            .map(|distance| format!("  [{distance:.1}m]"))
            .unwrap_or_else(|| {
                if nearby && !is_self {
                    "  [nearby]".to_string()
                } else if !is_self {
                    "  [far]".to_string()
                } else {
                    String::new()
                }
            });

        let mut badges = String::new();
        if member.guid == leader_guid {
            badges.push('👑');
        }
        if is_self {
            badges.push('🫵');
        }
        if member.share_loot {
            badges.push('💰');
        }
        if nearby && !is_self {
            badges.push('📍');
        }
        if badges.is_empty() {
            badges.push('·');
        }

        PartyListEntry {
            member,
            badges,
            distance_suffix,
            nearby,
        }
    }

    fn matches_active_filter(&self, name: &str) -> bool {
        let Some(active_filter) = &self.active_filter else {
            return true;
        };

        if active_filter.tokens.is_empty() {
            return true;
        }

        active_filter
            .tokens
            .iter()
            .any(|token| fuzzy_subsequence_match(token, name))
    }

    fn member_distance(&self, data: &GameData, guid: Guid) -> Option<f32> {
        if Some(guid) == data.player_guid {
            return Some(0.0);
        }

        let player_pos = data.player_pos?;
        let entity = data.entities.get(&guid)?;
        (entity.position.landblock_id != Guid::NULL).then(|| entity.position.distance_to(&player_pos))
    }

    fn is_member_nearby(&self, data: &GameData, guid: Guid) -> bool {
        if Some(guid) == data.player_guid {
            return true;
        }

        data.entities
            .get(&guid)
            .is_some_and(|entity| entity.position.landblock_id != Guid::NULL)
    }

    fn selected_member<'a>(&self, data: &'a GameData) -> Option<PartyListEntry<'a>> {
        self.visible_members(data).into_iter().nth(self.selected_index)
    }

    fn is_party_leader(&self, data: &GameData) -> bool {
        data.party.as_ref().is_some_and(|party| Some(party.leader_guid) == data.player_guid)
    }

    fn clamp_selected_index(&mut self, data: &GameData) {
        let count = self.visible_members(data).len();
        if count == 0 {
            self.selected_index = 0;
        } else {
            self.selected_index = self.selected_index.min(count - 1);
        }
    }

    fn begin_filter_input(&mut self, _view: &ViewState) -> Option<UpdateResult> {
        let mut input = VerbInputState::text("Filter");
        if let Some(active_filter) = &self.active_filter {
            input.input.set_text(&active_filter.raw_pattern);
        }

        self.filter_input = Some(FilterInputSession {
            input,
            clears_active_filter_on_cancel: self.active_filter.is_some(),
        });

        Some(UpdateResult::new().with_redraw(true))
    }

    fn apply_filter_input(&mut self, raw_pattern: String, data: &GameData) -> UpdateResult {
        let trimmed = raw_pattern.trim().to_string();
        self.active_filter = if trimmed.is_empty() {
            None
        } else {
            Some(TabFilterState {
                tokens: normalize_filter_tokens(&trimmed),
                raw_pattern: trimmed,
            })
        };
        self.filter_input = None;
        self.clamp_selected_index(data);
        UpdateResult::new().with_redraw(true)
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
        interaction: &Option<Interaction>,
    ) -> Vec<Verb> {
        let Some(selected) = self.selected_member(data) else {
            return Vec::new();
        };

        let mut verbs = vec![
            Verb::new(
                AppAction::UiAction {
                    action: AppUiAction::BeginTabFilterInput {
                        tab: DashboardTab::Party,
                    },
                },
                'f',
                "Filter",
            )
            .with_footer_visibility(if self.active_filter.is_some() {
                FooterVerbVisibility::Hidden
            } else {
                FooterVerbVisibility::Visible
            }),
            Verb::new(
                AppAction::SendCommands {
                    commands: vec![ClientCommand::LeaveParty],
                },
                'l',
                "Leave",
            ),
        ];

        if !matches!(interaction, None | Some(Interaction::Targeting { .. })) {
            return verbs;
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
                    't',
                    "Trade",
                ),
            ]);
        }

        if self.is_party_leader(data) && Some(selected.member.guid) != data.player_guid {
            verbs.push(Verb::new(
                AppAction::SendCommands {
                    commands: vec![ClientCommand::UninviteFromParty {
                        player: selected.member.name.clone(),
                    }],
                },
                'm',
                "Remove",
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

    fn handle_ui_action(
        &mut self,
        action: &AppUiAction,
        _data: &GameData,
        view: &ViewState,
    ) -> Option<UpdateResult> {
        match action {
            AppUiAction::BeginTabFilterInput {
                tab: DashboardTab::Party,
            } => self.begin_filter_input(view),
            _ => None,
        }
    }

    fn footer_input(&self) -> Option<&VerbInputState> {
        self.filter_input.as_ref().map(|session| &session.input)
    }

    fn footer_header(&self) -> Option<String> {
        self.active_filter
            .as_ref()
            .map(|filter| format!("[F]ilter: {}", filter.raw_pattern))
    }

    fn handle_footer_input(
        &mut self,
        key: KeyEvent,
        data: &GameData,
        _view: &ViewState,
    ) -> Option<UpdateResult> {
        let session = self.filter_input.as_mut()?;

        match session.input.handle_key(key) {
            VerbInputEvent::Changed | VerbInputEvent::Ignored => {
                Some(UpdateResult::new().with_redraw(true))
            }
            VerbInputEvent::Cancelled => {
                if session.clears_active_filter_on_cancel {
                    self.active_filter = None;
                    self.clamp_selected_index(data);
                }
                self.filter_input = None;
                Some(UpdateResult::new().with_redraw(true))
            }
            VerbInputEvent::SubmittedText(raw_pattern) => {
                Some(self.apply_filter_input(raw_pattern, data))
            }
            VerbInputEvent::Invalid(_) | VerbInputEvent::SubmittedQuantity(_) => {
                Some(UpdateResult::new().with_redraw(true))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::position::WorldPosition;
    use holtburger_world::entity::Entity;
    use holtburger_world::state::FellowshipState;

    #[test]
    fn nearby_member_shows_social_verbs() {
        let player_guid = Guid(0x50000001);
        let nearby_guid = Guid(0x50000002);
        let mut data = GameData::new(player_guid, "Player".to_string(), "World".to_string());
        data.player_pos = Some(world_pos(0.0));
        data.party = Some(party_state(player_guid, nearby_guid));
        data.entities
            .insert(nearby_guid, Entity::new(nearby_guid, "Bestie".to_string(), world_pos(3.0)));

        let mut tab = PartyTab::default();
        tab.selected_index = 1;
        let verbs = tab.get_verbs(&data, &ViewState::default(), &None);

        assert!(has_label(&verbs, "Approach"));
        assert!(has_label(&verbs, "Follow"));
        assert!(has_label(&verbs, "Trade"));
        assert!(has_label(&verbs, "Remove"));
        assert!(has_label(&verbs, "Leave"));
    }

    #[test]
    fn distant_member_hides_social_verbs() {
        let player_guid = Guid(0x50000001);
        let remote_guid = Guid(0x50000002);
        let mut data = GameData::new(player_guid, "Player".to_string(), "World".to_string());
        data.party = Some(party_state(player_guid, remote_guid));

        let mut tab = PartyTab::default();
        tab.selected_index = 1;
        let verbs = tab.get_verbs(&data, &ViewState::default(), &None);

        assert!(!has_label(&verbs, "Approach"));
        assert!(!has_label(&verbs, "Follow"));
        assert!(!has_label(&verbs, "Trade"));
        assert!(has_label(&verbs, "Assess"));
        assert!(has_label(&verbs, "Debug"));
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
        tab.selected_index = 1;
        let verbs = tab.get_verbs(&data, &ViewState::default(), &None);

        assert!(!has_label(&verbs, "Remove"));
        assert!(has_label(&verbs, "Leave"));
    }

    #[test]
    fn filter_applies_to_party_members() {
        let player_guid = Guid(0x50000001);
        let member_guid = Guid(0x50000002);
        let mut data = GameData::new(player_guid, "Player".to_string(), "World".to_string());
        data.party = Some(party_state(player_guid, member_guid));
        let view = ViewState::default();
        let mut tab = PartyTab::default();

        let result = tab.apply_filter_input("best".to_string(), &data);

        assert!(result.needs_redraw);
        assert_eq!(tab.visible_members(&data).len(), 1);
        assert_eq!(tab.visible_members(&data)[0].member.name, "Bestie");

        let _ = tab.begin_filter_input(&view);
        let result = tab.handle_footer_input(KeyEvent::from(KeyCode::Esc), &data, &view);
        assert!(result.is_some_and(|update| update.needs_redraw));
        assert!(tab.active_filter.is_none());
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