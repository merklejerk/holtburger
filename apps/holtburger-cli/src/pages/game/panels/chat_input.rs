use crate::components::text_input::SingleLineTextInput;

#[derive(Debug, Default, Clone)]
pub struct ChatInputState {
    pub input: SingleLineTextInput,
    pub input_history: Vec<String>,
    pub history_index: Option<usize>,
}

impl ChatInputState {
    pub fn new() -> Self {
        Self::default()
    }
}
