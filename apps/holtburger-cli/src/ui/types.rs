use holtburger_core::ClientEvent;
use crossterm::event::{KeyEvent, MouseEvent};
use ratatui::layout::Rect;

// Layout constants
pub const STATUS_BAR_HEIGHT: u16 = 3;
pub const INPUT_AREA_HEIGHT: u16 = 3;
pub const MIN_MAIN_AREA_HEIGHT: u16 = 10;
pub const WIDTH_BREAKPOINT: u16 = 150;

pub const LAYOUT_WIDE_NEARBY_PCT: u16 = 25;
pub const LAYOUT_WIDE_CHAT_PCT: u16 = 50;
pub const LAYOUT_WIDE_CONTEXT_PCT: u16 = 25;

pub const LAYOUT_NARROW_TOP_ROW_PCT: u16 = 50;
pub const LAYOUT_NARROW_BOTTOM_ROW_PCT: u16 = 50;
pub const LAYOUT_NARROW_DASHBOARD_PCT: u16 = 50;
pub const LAYOUT_NARROW_CONTEXT_PCT: u16 = 50;

// Chat constants
pub const CHAT_HISTORY_WINDOW_SIZE: usize = 10000;

// Interaction constants
pub const SCROLL_STEP: usize = 3;

#[derive(Debug)]
pub enum AppAction {
    Tick(f64),
    KeyPress(KeyEvent, u16, u16, Vec<Rect>), // key, width, height, main_chunks
    Mouse(MouseEvent, Vec<Rect>, Vec<Rect>), // mouse, chunks, main_chunks
    ReceivedEvent(ClientEvent),
}

#[derive(PartialEq, Debug)]
pub enum UIState {
    Chat,
    CharacterSelection,
}

#[derive(PartialEq, Debug, Clone, Copy)]
pub enum DashboardTab {
    Entities,
    Inventory,
    Character,
    Effects,
}

#[derive(PartialEq, Debug, Clone, Copy)]
pub enum FocusedPane {
    Chat,
    Context,
    Input,
    Dashboard,
}

#[derive(PartialEq, Debug, Clone, Copy)]
pub enum ContextView {
    Default,
    Custom,
}
