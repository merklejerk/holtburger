use crate::ui::Interaction;
use crate::pages::game::panels::dashboard::{assess, debug};
use crate::pages::game::{GameData, ViewState};
use crate::types::{CommandTarget, ContextView, UpdateResult, Verb};
use crossterm::event::KeyEvent;
use ratatui::Frame;
use ratatui::layout::Rect;
use ratatui::text::Line;

pub trait TabController {
    /// Renders the tab's content into the given area.
    fn render(&mut self, f: &mut Frame, data: &GameData, view: &ViewState, area: Rect);

    /// Returns the list of available verbs based on the tab's current internal selection.
    fn get_verbs(
        &self,
        _data: &GameData,
        _view: &ViewState,
        _interaction: &Option<Interaction>,
    ) -> Vec<Verb> {
        vec![]
    }

    /// Handles tab-specific input. Returns a list of commands to execute.
    fn handle_input(&mut self, key: KeyEvent, data: &GameData, view: &ViewState) -> Option<UpdateResult>;

    /// Returns the content to be displayed in the context panel for the current selection.
    fn get_context_panel_content(&self, data: &GameData, view: &ViewState) -> Vec<Line<'static>> {
        match view.context_view {
            ContextView::Assess(guid) => {
                if let Some(e) = data.entities.get(&guid) {
                    return assess::get_assess_info(e);
                }
                vec![]
            }
            ContextView::Custom => {
                let player_guid = data.player_guid;
                let target_guid = view.current_debug_guid.or(player_guid);

                if let Some(e) = target_guid.and_then(|guid| data.entities.get(&guid)) {
                    let guid = e.guid;
                    let target = CommandTarget::Entity(e, None);
                    let player_info = if Some(guid) == player_guid {
                        Some(debug::PlayerDebugInfo {
                            attributes: &data.attributes,
                            vitals: &data.vitals,
                            skills: &data.skills,
                            enchantments: &data.player_enchantments,
                        })
                    } else {
                        None
                    };

                    return debug::get_debug_info(
                        &target,
                        |id| {
                            data.entities
                                .get(&id)
                                .map(|e| e.name().to_string())
                                .or_else(|| {
                                    if Some(id) == player_guid {
                                        Some("You".to_string())
                                    } else {
                                        None
                                    }
                                })
                        },
                        Some(&data.spell_info),
                        player_info,
                    );
                }
                vec![]
            }
            ContextView::Spell(spell_id) => {
                let target = CommandTarget::Spell(spell_id);
                debug::get_debug_info(&target, |_| None, Some(&data.spell_info), None)
            }
            ContextView::Enchantment(enchant) => {
                let target = CommandTarget::Enchantment(enchant);
                debug::get_debug_info(&target, |_| None, Some(&data.spell_info), None)
            }
            _ => vec![],
        }
    }
}
