use crate::ui::CommandTarget;
use crate::ui::state::GameState;
use crate::ui::types::{Action, ContextView, Verb};
use crate::ui::update::{UpdateResult, effect::UIEffect};
use crate::ui::widgets::dashboard::{assess, debug, input::handle_common_dashboard_input};
use crossterm::event::KeyEvent;
use ratatui::Frame;
use ratatui::layout::Rect;
use ratatui::text::Line;

pub trait TabController {
    /// Renders the tab's content into the given area.
    fn render(&self, f: &mut Frame, game: &mut GameState, area: Rect);

    /// Returns the list of available verbs for the item at the specified index.
    fn get_verbs(&self, game: &GameState, index: usize) -> Vec<Verb>;

    /// Returns the command target (e.g. Entity, Spell) at the specified index.
    fn get_target_at_index<'a>(&self, game: &'a GameState, index: usize) -> CommandTarget<'a>;

    /// Returns the total number of items in the tab.
    fn get_item_count(&self, game: &GameState) -> usize;

    /// Dispatches an action for the tab.
    fn handle_action(
        &self,
        _action: &Action,
        _index: usize,
        _game: &mut GameState,
    ) -> Option<UIEffect> {
        None
    }

    /// Optional: Handles tab-specific input. Returns a list of commands to execute.
    fn handle_input(&self, key: KeyEvent, game: &mut GameState) -> Option<UpdateResult> {
        handle_common_dashboard_input(self, key, game)
    }

    /// Returns the content to be displayed in the context panel for the current selection.
    fn get_context_panel_content(&self, game: &GameState) -> Vec<Line<'static>> {
        match game.view.context_view {
            ContextView::Assess(guid) => {
                if let Some(e) = game.data.entities.get(&guid) {
                    return assess::get_assess_info(e);
                }
                vec![]
            }
            ContextView::Custom => {
                let player_guid = game.data.player_guid;
                let target_guid = game.view.current_debug_guid.or(player_guid);

                if let Some(e) = target_guid.and_then(|guid| game.data.entities.get(&guid)) {
                    let guid = e.guid;
                    let target = CommandTarget::Entity(e, None);
                    let player_info = if Some(guid) == player_guid {
                        Some(debug::PlayerDebugInfo {
                            attributes: &game.data.attributes,
                            vitals: &game.data.vitals,
                            skills: &game.data.skills,
                            enchantments: &game.data.player_enchantments,
                        })
                    } else {
                        None
                    };

                    return debug::get_debug_info(
                        &target,
                        |id| {
                            game.data
                                .entities
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
                        Some(&game.data.spell_info),
                        player_info,
                    );
                }
                vec![]
            }
            ContextView::Spell(spell_id) => {
                let target = CommandTarget::Spell(spell_id);
                debug::get_debug_info(&target, |_| None, Some(&game.data.spell_info), None)
            }
            ContextView::Enchantment(enchant) => {
                let target = CommandTarget::Enchantment(enchant);
                debug::get_debug_info(&target, |_| None, Some(&game.data.spell_info), None)
            }
            _ => vec![],
        }
    }
}
