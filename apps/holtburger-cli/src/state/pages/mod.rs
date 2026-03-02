pub mod game;
pub mod selection;

pub use self::game::GameState;
pub use self::selection::SelectionState;

pub enum Page {
    Selection(SelectionState),
    Game(Box<GameState>),
}
