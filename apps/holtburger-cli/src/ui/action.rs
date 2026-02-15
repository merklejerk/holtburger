use crossterm::event::{KeyEvent, MouseEvent};
use holtburger_core::{ClientViewEvent, StateEvent, WireEvent};
use ratatui::layout::Rect;

#[derive(Debug)]
pub enum AppAction {
    Tick(f64),
    KeyPress(KeyEvent, u16, u16, Vec<Rect>, Rect), // key, width, height, main_chunks, dynamic_chunk
    Mouse(MouseEvent, Vec<Rect>, Vec<Rect>, Rect), // mouse, chunks, main_chunks, dynamic_chunk
    ReceivedEvent(WireEvent),
    ReceivedStateEvent(StateEvent),
    ReceivedViewEvent(ClientViewEvent),
}
