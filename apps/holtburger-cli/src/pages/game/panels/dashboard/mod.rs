pub mod tabs;

pub use self::tabs::{
    CharacterTab, EquipTab, InventoryTab, NearbyTab, PartyTab, SpellsTab, TradeTab,
};

pub mod assess;
pub mod debug;
pub mod render;
pub mod state;

pub use self::render::render_dashboard_pane;
pub use self::state::DashboardState;
