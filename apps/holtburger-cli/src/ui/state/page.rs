use super::GameState;
use super::SelectionState;

pub enum Page {
    Selection(SelectionState),
    Game(Box<GameState>),
}
