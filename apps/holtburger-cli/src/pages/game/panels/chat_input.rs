use crate::components::text_input::SingleLineTextInput;

#[derive(Debug, Default, Clone)]
pub struct ChatInputState {
    pub input: SingleLineTextInput,
    pub input_history: Vec<String>,
    pub history_index: Option<usize>,
    pub history_draft: Option<String>,
    pub pending_history_submission: Option<String>,
}

impl ChatInputState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn begin_history_navigation(&mut self) {
        if self.history_index.is_none() {
            self.history_draft = Some(self.input.text().to_string());
        }
    }

    pub fn record_history_submission(&mut self, command: &str) {
        self.input_history.push(command.to_string());
        self.history_index = None;
        self.history_draft = None;
        self.pending_history_submission = Some(command.to_string());
    }

    pub fn restore_history_draft(&mut self) {
        let draft = self.history_draft.take().unwrap_or_default();
        self.input.set_text(draft);
        self.history_index = None;
    }
}
