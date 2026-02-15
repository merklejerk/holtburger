use crossterm::event::{KeyEvent, MouseEvent};
use holtburger_core::{ClientEvent, ClientViewEvent};
use ratatui::layout::Rect;

#[derive(Debug)]
pub enum AppAction {
    Tick(f64),
    KeyPress(KeyEvent, u16, u16, Vec<Rect>, Rect), // key, width, height, main_chunks, dynamic_chunk
    Mouse(MouseEvent, Vec<Rect>, Vec<Rect>, Rect), // mouse, chunks, main_chunks, dynamic_chunk
    ReceivedEvent(ClientEvent),
    ReceivedViewEvent(ClientViewEvent),
}
