

use holtburger_common::Guid;

pub mod dashboard;
pub mod data;
pub mod view;

use crate::state::pages::game::dashboard::DashboardState;

use self::data::GameData;
use self::view::ViewState;

#[derive(Debug, Clone, Default)]
pub struct GameState {
    pub data: GameData,
    pub dashboard: DashboardState,
    pub view: ViewState,
}

impl GameState {
    pub fn new(guid: Guid, name: String, world_name: String) -> Self {
        Self {
            data: GameData::new(guid, name, world_name),
            dashboard: DashboardState::default(),
            view: ViewState::default(),
        }
    }
}

