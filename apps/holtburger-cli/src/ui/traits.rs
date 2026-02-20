use crate::ui::model::{AppState, GameState};
use crate::ui::types::{CommandTarget, UIEffect, UpdateResult};
use crate::ui::widgets::dashboard::{Action, Verb, input::handle_common_dashboard_input};
use crossterm::event::KeyEvent;
use ratatui::Frame;
use ratatui::layout::Rect;
use ratatui::text::Line;

pub trait TabController {
    /// Renders the tab's content into the given area.
    fn render(&self, f: &mut Frame, game: &mut GameState, app: &mut AppState, area: Rect);

    /// Returns the list of available verbs for the item at the specified index.
    fn get_verbs(&self, game: &GameState, app: &AppState, index: usize) -> Vec<Verb>;

    /// Returns the command target (e.g. Entity, Spell) at the specified index.
    fn get_target_at_index<'a>(
        &self,
        game: &'a GameState,
        app: &'a AppState,
        index: usize,
    ) -> CommandTarget<'a>;

    /// Returns the total number of items in the tab.
    fn get_item_count(&self, game: &GameState, app: &AppState) -> usize;

    /// Dispatches an action for the tab.
    fn handle_action(
        &self,
        action: &Action,
        index: usize,
        game: &mut GameState,
        app: &mut AppState,
    ) -> Option<UIEffect>;

    /// Optional: Handles tab-specific input. Returns a list of commands to execute.
    fn handle_input(
        &self,
        key: KeyEvent,
        game: &mut GameState,
        app: &mut AppState,
    ) -> Option<UpdateResult> {
        handle_common_dashboard_input(self, key, game, app)
    }

    /// Returns the content to be displayed in the context panel for the current selection.
    fn get_context_panel_content(&self, game: &GameState, app: &AppState) -> Vec<Line<'static>> {
        crate::ui::widgets::dashboard::tabs::common::get_context_content_for_view(game, app)
    }
}
