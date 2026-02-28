use holtburger_core::client::types::ClientCommand;


#[derive(Debug, Default)]
pub struct UpdateResult {
    pub commands: Vec<ClientCommand>,
    pub ui_messages: Vec<crate::ui::UiMessage>,
    pub needs_redraw: bool,
}

impl UpdateResult {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_redraw(mut self, needs_redraw: bool) -> Self {
        self.needs_redraw = needs_redraw;
        self
    }

    pub fn with_ui_messages(mut self, msgs: Vec<crate::ui::UiMessage>) -> Self {
        self.ui_messages.extend(msgs);
        self
    }

    pub fn redraw() -> Self {
        Self {
            commands: Vec::new(),
            ui_messages: Vec::new(),
            needs_redraw: true,
        }
    }

    pub fn commands(commands: Vec<ClientCommand>) -> Self {
        Self {
            commands,
            ui_messages: Vec::new(),
            needs_redraw: false,
        }
    }

    pub fn merge(&mut self, other: UpdateResult) {
        self.commands.extend(other.commands);
        self.ui_messages.extend(other.ui_messages);
        self.needs_redraw |= other.needs_redraw;
    }
}

