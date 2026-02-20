use crate::ui::state::{AppState, ChatMessageKind};
use crate::ui::{ActiveInteraction, ContextView, InteractionMode};
use holtburger_common::Guid;
use holtburger_core::client::types::ClientCommand;

#[derive(Debug)]
pub enum UIEffect {
    Command(ClientCommand),
    Commands(Vec<ClientCommand>),
    Assess(Guid),
    ActivateDebugSpell(u32),
    ActivateDebugEntity(Guid),
    Move(Guid),
    Give(Guid),
    Heal(Guid),
    ApplyHealing(Guid),
    ApplyMoving(Guid),
    Target(Guid),
    CancelInteraction,
    Log(ChatMessageKind, String),
}

#[derive(Debug, Default)]
pub struct UpdateResult {
    pub commands: Vec<ClientCommand>,
    pub effect: Option<UIEffect>,
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

    pub fn with_effect(mut self, effect: UIEffect) -> Self {
        self.effect = Some(effect);
        self
    }

    pub fn redraw() -> Self {
        Self {
            commands: Vec::new(),
            effect: None,
            needs_redraw: true,
        }
    }

    pub fn commands(commands: Vec<ClientCommand>) -> Self {
        Self {
            commands,
            effect: None,
            needs_redraw: false,
        }
    }

    pub fn merge(&mut self, other: UpdateResult) {
        self.commands.extend(other.commands);
        if other.effect.is_some() {
            self.effect = other.effect;
        }
        self.needs_redraw |= other.needs_redraw;
    }
}

/// Applies a UI effect to the app state and returns any resulting client commands.
pub fn apply_ui_effect(state: &mut AppState, effect: UIEffect) -> Vec<ClientCommand> {
    match effect {
        UIEffect::Command(cmd) => vec![cmd],
        UIEffect::Commands(cmds) => cmds,
        UIEffect::Assess(guid) => {
            if let Some(game) = state.game_option_mut() {
                game.view.context_view = ContextView::Assess(guid);
                game.view.context_scroll_offset = 0;
            }
            vec![ClientCommand::Identify(guid)]
        }
        UIEffect::ActivateDebugSpell(spell_id) => {
            if let Some(game) = state.game_option_mut() {
                game.view.context_view = ContextView::Spell(spell_id);
                game.view.context_scroll_offset = 0;
            }
            vec![]
        }
        UIEffect::ActivateDebugEntity(guid) => {
            if let Some(game) = state.game_option_mut() {
                game.view.current_debug_guid = Some(guid);
                game.view.context_view = ContextView::Custom;
                game.view.context_scroll_offset = 0;
            }
            vec![]
        }
        UIEffect::Heal(guid) => {
            if let Some(game) = state.game_option_mut() {
                game.view.active_interaction = Some(ActiveInteraction {
                    guid,
                    mode: InteractionMode::Healing,
                });
            }
            vec![]
        }
        UIEffect::Move(guid) => {
            if let Some(game) = state.game_option_mut() {
                game.view.active_interaction = Some(ActiveInteraction {
                    guid,
                    mode: InteractionMode::Moving,
                });
            }
            vec![]
        }
        UIEffect::Target(guid) => {
            if let Some(game) = state.game_option_mut() {
                game.view.active_interaction = Some(ActiveInteraction {
                    guid,
                    mode: InteractionMode::Target,
                });
            }
            vec![]
        }
        UIEffect::Give(target_guid) => {
            if let Some(game) = state.game_option_mut()
                && let Some(ActiveInteraction {
                    guid: item_guid,
                    mode: InteractionMode::Moving,
                }) = game.view.active_interaction
            {
                let cmd = ClientCommand::GiveObjectRequest {
                    target: target_guid,
                    item: item_guid,
                    amount: 1, // Assume 1 for now.
                };
                game.view.active_interaction = None;
                return vec![cmd];
            }
            vec![]
        }
        UIEffect::ApplyHealing(guid) => {
            if let Some(game) = state.game_option_mut()
                && let Some(interaction) = game.view.active_interaction
            {
                let cmd = ClientCommand::UseWithTarget {
                    item: interaction.guid,
                    target: guid,
                };
                game.view.active_interaction = None;
                return vec![cmd];
            }
            vec![]
        }
        UIEffect::ApplyMoving(container_guid) => {
            if let Some(game) = state.game_option_mut()
                && let Some(interaction) = game.view.active_interaction
            {
                let cmd = ClientCommand::MoveItem {
                    item: interaction.guid,
                    container: container_guid,
                    placement: 0,
                };
                game.view.active_interaction = None;
                return vec![cmd];
            }
            vec![]
        }
        UIEffect::CancelInteraction => {
            if let Some(game) = state.game_option_mut() {
                game.view.active_interaction = None;
            }
            vec![]
        }
        UIEffect::Log(kind, msg) => {
            state.chat.log(kind, msg);
            vec![]
        }
    }
}
