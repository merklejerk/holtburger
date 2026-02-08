use crossterm::event::{KeyEvent, MouseEvent};
use holtburger_core::ClientEvent;
use ratatui::layout::Rect;

#[derive(Debug)]
pub enum AppAction {
    Tick(f64),
    KeyPress(KeyEvent, u16, u16, Vec<Rect>), // key, width, height, main_chunks
    Mouse(MouseEvent, Vec<Rect>, Vec<Rect>), // mouse, chunks, main_chunks
    ReceivedEvent(ClientEvent),
}
