use crossterm::event::{KeyCode, KeyEvent};
use ratatui::Frame;
use ratatui::layout::Rect;

use super::render::render_spells_tab;
use crate::pages::game::{GameData, ViewState};
use crate::types::{
    AppAction, AppUiAction, ContextView, DashboardTab, FilterInputSession, FooterVerbVisibility,
    Interaction, TabController, TabFilterState, UpdateResult, Verb, VerbInputEvent, VerbInputState,
};
use crate::utils::{fuzzy_subsequence_match, normalize_filter_tokens};

#[derive(Default, Debug, Clone)]
pub struct SpellsTab {
    pub selected_index: usize,
    pub list_state: ratatui::widgets::ListState,
    active_filter: Option<TabFilterState>,
    filter_input: Option<FilterInputSession>,
}

impl SpellsTab {
    pub(crate) fn visible_spell_ids(&self, data: &GameData) -> Vec<u32> {
        let mut spells = data.player_spells.clone();
        spells.sort_by_key(|&sid| data.spell_name_or_fallback(sid));

        let Some(active_filter) = &self.active_filter else {
            return spells;
        };

        if active_filter.tokens.is_empty() {
            return spells;
        }

        spells
            .into_iter()
            .filter(|&spell_id| {
                let spell_name = data.spell_name_or_fallback(spell_id);
                active_filter
                    .tokens
                    .iter()
                    .any(|token| fuzzy_subsequence_match(token, &spell_name))
            })
            .collect()
    }

    fn clamp_selected_index(&mut self, data: &GameData) {
        let count = self.visible_spell_ids(data).len();
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

    fn get_selected_spell_id(&self, data: &GameData) -> Option<u32> {
        let spells = self.visible_spell_ids(data);
        spells.get(self.selected_index).copied()
    }

    fn item_count(&self, data: &GameData, _view: &ViewState) -> usize {
        self.visible_spell_ids(data).len()
    }
}

impl TabController for SpellsTab {
    fn render(&mut self, f: &mut Frame, data: &GameData, view: &ViewState, area: Rect) {
        render_spells_tab(self, f, data, view, area);
    }

    fn get_verbs(
        &self,
        data: &GameData,
        _view: &ViewState,
        interaction: &Option<Interaction>,
    ) -> Vec<Verb> {
        let mut verbs = Vec::new();
        let spell_id = self.get_selected_spell_id(data);

        verbs.push(
            Verb::new(
                AppAction::UiAction {
                    action: AppUiAction::BeginTabFilterInput {
                        tab: DashboardTab::Spells,
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
        );

        match interaction {
            Some(Interaction::Targeting { target_guid }) => {
                if let Some(spell_id) = spell_id {
                    verbs.push(Verb::new(
                        vec![AppAction::CastSpell {
                            spell_id,
                            target: Some(*target_guid),
                        }],
                        'c',
                        "Cast on target",
                    ));
                }
                return verbs;
            }
            Some(_) => {
                // No actions when there's an active interaction other than targeting
                return verbs;
            }
            _ => {}
        }

        if let Some(spell_id) = spell_id {
            if let Some(player_guid) = data.player_guid {
                verbs.push(Verb::new(
                    vec![AppAction::CastSpell {
                        spell_id,
                        target: Some(player_guid),
                    }],
                    'c',
                    "Cast on self",
                ));
            } else {
                verbs.push(Verb::new(
                    vec![AppAction::CastSpell {
                        spell_id,
                        target: None,
                    }],
                    'c',
                    "Cast",
                ));
            }

            verbs.push(Verb::new(
                vec![AppAction::ViewDetails {
                    view: ContextView::Spell(spell_id),
                }],
                'd',
                "Details",
            ));
            verbs.push(Verb::new(
                vec![AppAction::UiAction {
                    action: AppUiAction::ChangeContextView {
                        view: ContextView::DebugSpell(spell_id),
                    },
                }],
                'g',
                "Debug",
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
                let verb = verbs.into_iter().find(|v| v.shortcut == shortcut)?;
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
                tab: DashboardTab::Spells,
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
