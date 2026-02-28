use crate::ui::ContextView;
use crate::ui::state::{AppState, ChatMessageKind};
use crate::pages::game::dashboard::tabs::classification;
use holtburger_common::Guid;
use holtburger_core::client::types::ClientCommand;
use holtburger_protocol::messages::magic::Enchantment;

#[derive(Debug)]
pub enum UIEffect {
    Command(ClientCommand),
    Commands(Vec<ClientCommand>),
    Assess(Guid),
    ActivateDebugSpell(u32),
    ActivateDebugEnchantment(Enchantment),
    ActivateDebugEntity(Guid),
    Move(Guid),
    Give(Guid),
    Heal(Guid),
    ApplyHealing(Guid),
    ApplyMoving(Guid),
    ApplyStacking(Guid),
    ApplyCombining(Guid),
    Target(Guid),
    CancelInteraction,
    ClearVendor,
    Log(ChatMessageKind, String),
    DisplayClientInfo,
    Combine(Guid),
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
        UIEffect::Command(cmd) => {
            if let Some(game) = state.game_option_mut() {
                match &cmd {
                    ClientCommand::Use(guid) => {
                        // Check if it's a vendor
                        if let Some(e) = game.data.entities.get(guid) {
                            let class = classification::classify_entity(e);
                            if class == classification::EntityClass::Vendor {
                                game.view.last_trade_initiation =
                                    Some((std::time::Instant::now(), *guid));
                            }
                        }
                    }
                    ClientCommand::OpenTrade(guid) => {
                        game.view.last_trade_initiation = Some((std::time::Instant::now(), *guid));
                    }
                    _ => {}
                }
            }
            vec![cmd]
        }
        UIEffect::Commands(cmds) => {
            if let Some(game) = state.game_option_mut() {
                for cmd in &cmds {
                    match cmd {
                        ClientCommand::Use(guid) => {
                            if let Some(e) = game.data.entities.get(guid) {
                                let class = classification::classify_entity(e);
                                if class == classification::EntityClass::Vendor {
                                    game.view.last_trade_initiation =
                                        Some((std::time::Instant::now(), *guid));
                                }
                            }
                        }
                        ClientCommand::OpenTrade(guid) => {
                            game.view.last_trade_initiation =
                                Some((std::time::Instant::now(), *guid));
                        }
                        _ => {}
                    }
                }
            }
            cmds
        }
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
        UIEffect::ActivateDebugEnchantment(enchant) => {
            if let Some(game) = state.game_option_mut() {
                game.view.context_view = ContextView::Enchantment(enchant);
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
            vec![ClientCommand::QueryEntityDebugInfo(guid)]
        }
        UIEffect::Heal(guid) => {
            if let Some(game) = state.game_option_mut() {
                game.view.active_interaction =
                    Some(crate::ui::Interaction::Healing { item_guid: guid });
            }
            vec![]
        }
        UIEffect::Move(guid) => {
            if let Some(game) = state.game_option_mut() {
                game.view.active_interaction =
                    Some(crate::ui::Interaction::Moving { item_guid: guid });
            }
            vec![]
        }
        UIEffect::Combine(guid) => {
            if let Some(game) = state.game_option_mut() {
                game.view.active_interaction =
                    Some(crate::ui::Interaction::Combining { item_guid: guid });
            }
            vec![]
        }
        UIEffect::Target(guid) => {
            if let Some(game) = state.game_option_mut() {
                game.view.active_interaction =
                    Some(crate::ui::Interaction::Targeting { target_guid: guid });
            }
            vec![]
        }
        UIEffect::Give(target_guid) => {
            if let Some(game) = state.game_option_mut()
                && let Some(crate::ui::Interaction::Moving { item_guid }) =
                    game.view.active_interaction
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
                && let Some(crate::ui::Interaction::Healing { item_guid }) =
                    game.view.active_interaction
            {
                let cmd = ClientCommand::UseWithTarget {
                    item: item_guid,
                    target: guid,
                };
                game.view.active_interaction = None;
                return vec![cmd];
            }
            vec![]
        }
        UIEffect::ApplyMoving(container_guid) => {
            if let Some(game) = state.game_option_mut()
                && let Some(crate::ui::Interaction::Moving { item_guid }) =
                    game.view.active_interaction
            {
                let cmd = ClientCommand::MoveItem {
                    item: item_guid,
                    container: container_guid,
                    placement: 0,
                };
                game.view.active_interaction = None;
                return vec![cmd];
            }
            vec![]
        }
        UIEffect::ApplyStacking(destination_guid) => {
            if let Some(game) = state.game_option_mut()
                && let Some(crate::ui::Interaction::Moving { item_guid }) =
                    game.view.active_interaction
            {
                let amount = if let (Some(source_e), Some(dest_e)) = (
                    game.data.entities.get(&item_guid),
                    game.data.entities.get(&destination_guid),
                ) {
                    let source_size = source_e.stack_size();
                    let dest_size = dest_e.stack_size();
                    let dest_max = dest_e.max_stack_size();
                    let space = dest_max.saturating_sub(dest_size);
                    source_size.min(space) as i32
                } else {
                    1
                };

                let cmd = ClientCommand::Stack {
                    source: item_guid,
                    destination: destination_guid,
                    amount,
                };
                game.view.active_interaction = None;
                return vec![cmd];
            }
            vec![]
        }
        UIEffect::ApplyCombining(destination_guid) => {
            if let Some(game) = state.game_option_mut()
                && let Some(crate::ui::Interaction::Combining { item_guid }) =
                    game.view.active_interaction
            {
                let cmd = ClientCommand::UseWithTarget {
                    item: item_guid,
                    target: destination_guid,
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
        UIEffect::ClearVendor => {
            if let Some(game) = state.game_option_mut() {
                game.data.vendor = None;
            }
            vec![]
        }
        UIEffect::Log(kind, msg) => {
            state.chat.log(kind, msg);
            vec![]
        }
        UIEffect::DisplayClientInfo => {
            state.display_client_info();
            vec![]
        }
    }
}
