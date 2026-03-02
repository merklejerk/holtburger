#[derive(Debug, Default, Clone)]
pub struct ChatInputState {
    pub input: String,
    pub input_history: Vec<String>,
    pub history_index: Option<usize>,
}

impl ChatInputState {
    pub fn new() -> Self {
        Self::default()
    }
}
