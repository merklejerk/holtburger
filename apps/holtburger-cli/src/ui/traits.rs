use crate::ui::model::AppState;
use crate::ui::types::{CommandTarget, UIEffect};
use crate::ui::widgets::dashboard::{Action, Verb, input::handle_common_dashboard_input};
use crossterm::event::KeyEvent;
use holtburger_core::ClientCommand;
use ratatui::Frame;
use ratatui::layout::Rect;
use ratatui::text::Line;

pub trait TabController {
    /// Renders the tab's content into the given area.
    fn render(&self, f: &mut Frame, state: &mut AppState, area: Rect);

    /// Returns the list of available verbs for the item at the specified index.
    fn get_verbs(&self, state: &AppState, index: usize) -> Vec<Verb>;

    /// Returns the command target (e.g. Entity, Spell) at the specified index.
    fn get_target_at_index<'a>(&self, state: &'a AppState, index: usize) -> CommandTarget<'a>;

    /// Returns the total number of items in the tab.
    fn get_item_count(&self, state: &AppState) -> usize;

    /// Dispatches an action for the tab.
    fn handle_action(
        &self,
        action: &Action,
        index: usize,
        state: &mut AppState,
    ) -> Option<UIEffect>;

    /// Optional: Handles tab-specific input. Returns a list of commands to execute.
    fn handle_input(&self, key: KeyEvent, state: &mut AppState) -> Option<Vec<ClientCommand>> {
        handle_common_dashboard_input(self, key, state)
    }

    /// Returns the content to be displayed in the context panel for the current selection.
    fn get_context_panel_content(&self, state: &AppState) -> Vec<Line<'static>> {
        crate::ui::widgets::dashboard::tabs::common::get_context_content_for_view(state)
    }
}
