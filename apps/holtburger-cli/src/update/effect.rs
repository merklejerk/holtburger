use holtburger_core::client::types::ClientCommand;
use crate::actions::AppAction;

#[derive(Debug, Default)]
pub struct UpdateResult {
    pub commands: Vec<ClientCommand>,
    pub actions: Vec<AppAction>,
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

    pub fn with_action(mut self, action: AppAction) -> Self {
        self.actions.push(action);
        self
    }

    pub fn redraw() -> Self {
        Self {
            commands: Vec::new(),
            actions: Vec::new(),
            needs_redraw: true,
        }
    }

    pub fn commands(commands: Vec<ClientCommand>) -> Self {
        Self {
            commands,
            actions: Vec::new(),
            needs_redraw: false,
        }
    }

    pub fn merge(&mut self, other: UpdateResult) {
        self.commands.extend(other.commands);
        self.actions.extend(other.actions);
        self.needs_redraw |= other.needs_redraw;
    }
}
