use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use ratatui::style::Style;
use ratatui::widgets::Block;
use ratatui_textarea::{CursorMove, TextArea};
use std::fmt;

#[derive(Clone)]
pub struct SingleLineTextInput {
    editor: TextArea<'static>,
}

impl SingleLineTextInput {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn text(&self) -> &str {
        self.editor.lines()[0].as_str()
    }

    pub fn set_text(&mut self, text: impl AsRef<str>) {
        self.editor = editor_with_text(text.as_ref());
    }

    pub fn clear(&mut self) {
        self.set_text("");
    }

    pub fn take_text(&mut self) -> String {
        let text = self.text().to_string();
        self.clear();
        text
    }

    pub fn is_empty(&self) -> bool {
        self.editor.is_empty()
    }

    pub fn cursor_col(&self) -> usize {
        self.editor.cursor().1
    }

    pub fn apply_key(&mut self, key: KeyEvent) -> bool {
        if should_ignore_single_line_key(key) {
            return false;
        }

        let before_text = self.text().to_string();
        let before_cursor = self.cursor_col();
        self.editor.input(key);

        self.text() != before_text || self.cursor_col() != before_cursor
    }

    pub fn apply_key_if(&mut self, key: KeyEvent, allow_char: impl Fn(char) -> bool) -> bool {
        if let KeyCode::Char(character) = key.code
            && !key
                .modifiers
                .intersects(KeyModifiers::CONTROL | KeyModifiers::ALT)
            && !allow_char(character)
        {
            return false;
        }

        self.apply_key(key)
    }

    pub fn rendered(&self, style: Style, focused: bool) -> TextArea<'static> {
        let mut editor = self.editor.clone();
        editor.set_style(style);
        editor.set_cursor_line_style(Style::default());
        if !focused {
            editor.set_cursor_style(style);
        }
        editor
    }

    pub fn rendered_with_block(
        &self,
        block: Block<'static>,
        style: Style,
        focused: bool,
    ) -> TextArea<'static> {
        let mut editor = self.rendered(style, focused);
        editor.set_block(block);
        editor
    }
}

impl Default for SingleLineTextInput {
    fn default() -> Self {
        Self {
            editor: editor_with_text(""),
        }
    }
}

impl fmt::Debug for SingleLineTextInput {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SingleLineTextInput")
            .field("text", &self.text())
            .field("cursor_col", &self.cursor_col())
            .finish()
    }
}

impl PartialEq for SingleLineTextInput {
    fn eq(&self, other: &Self) -> bool {
        self.text() == other.text() && self.cursor_col() == other.cursor_col()
    }
}

impl Eq for SingleLineTextInput {}

fn editor_with_text(text: &str) -> TextArea<'static> {
    let sanitized = text.replace(['\n', '\r'], " ");
    let mut editor = TextArea::from([sanitized]);
    editor.move_cursor(CursorMove::End);
    editor
}

fn should_ignore_single_line_key(key: KeyEvent) -> bool {
    matches!(key.code, KeyCode::Enter | KeyCode::Tab | KeyCode::BackTab)
        || matches!(key.code, KeyCode::Char('m')) && key.modifiers.contains(KeyModifiers::CONTROL)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn apply_key_moves_cursor_within_line() {
        let mut input = SingleLineTextInput::new();
        input.set_text("hello");

        assert!(input.apply_key(KeyEvent::new(KeyCode::Left, KeyModifiers::NONE)));
        assert!(input.apply_key(KeyEvent::new(KeyCode::Char('!'), KeyModifiers::NONE)));

        assert_eq!(input.text(), "hell!o");
    }

    #[test]
    fn rendered_hides_cursor_when_unfocused() {
        let mut input = SingleLineTextInput::new();
        input.set_text("abc");

        let widget = input.rendered(Style::default(), false);

        assert_eq!(widget.cursor_style(), Style::default());
    }
}
