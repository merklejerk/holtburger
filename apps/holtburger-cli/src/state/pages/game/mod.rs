

use holtburger_common::Guid;

pub mod data;

use crate::pages::game::dashboard::DashboardState;

use self::data::GameData;
use crate::pages::game::view::ViewState;

use crate::pages::game::panels::chat::ChatState;

#[derive(Default)]
pub struct GameState {
    pub data: GameData,
    pub dashboard: DashboardState,
    pub view: ViewState,
    pub chat: ChatState,
    pub input: String,
    pub input_history: Vec<String>,
    pub history_index: Option<usize>,
}

impl GameState {
    pub fn new(guid: Guid, name: String, world_name: String) -> Self {
        Self {
            data: GameData::new(guid, name, world_name),
            dashboard: DashboardState::default(),
            view: ViewState::default(),
            chat: ChatState::default(),
            input: String::new(),
            input_history: Vec::new(),
            history_index: None,
        }
    }
}

