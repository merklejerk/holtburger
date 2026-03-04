use crate::state::AppState;
use crate::types::AppAction;
use crate::types::{ContextView, UpdateResult};
use holtburger_common::Guid;
use holtburger_core::client::types::ClientCommand;
use holtburger_protocol::messages::trade::actions::ItemProfileActionData;
use holtburger_world::context::WorldContextExt;

impl AppState {
    pub fn handle_app_action(&mut self, action: AppAction) -> UpdateResult {
        let mut result = UpdateResult::new();
        match action {
            AppAction::Identify(guid) => {
                result.commands.push(ClientCommand::Identify(guid));
            }
            AppAction::Assess(guid) => {
                result.commands.push(ClientCommand::Identify(guid));
                result.merge(
                    self.handle_app_action(AppAction::ChangeContextView(ContextView::Assess(guid))),
                );
            }
            AppAction::Use(guid) => {
                result.commands.push(ClientCommand::Use(guid));
            }
            AppAction::UseOn(item, target) => {
                result
                    .commands
                    .push(ClientCommand::UseWithTarget { item, target });
            }
            AppAction::Approach(guid) => {
                result.commands.push(ClientCommand::MoveTo { target: guid });
            }
            AppAction::PickUp(guid) => {
                result.commands.push(ClientCommand::MoveItem {
                    item: guid,
                    container: Guid::NULL,
                    placement: 0,
                });
            }
            AppAction::Drop(guid) => {
                result.commands.push(ClientCommand::Drop(guid));
            }
            AppAction::Equip(guid) => {
                result.commands.push(ClientCommand::GetAndWield {
                    item: guid,
                    slot: None,
                });
            }
            AppAction::Unequip(guid) => {
                result.commands.push(ClientCommand::MoveItem {
                    item: guid,
                    container: Guid::NULL,
                    placement: 0,
                });
            }
            AppAction::TalkTo(guid) => {
                result.commands.push(ClientCommand::Use(guid));
            }
            AppAction::Open(guid) => {
                result.commands.push(ClientCommand::Use(guid));
            }
            AppAction::Close(guid) => {
                result.commands.push(ClientCommand::CloseContainer(guid));
            }
            AppAction::OpenTrade(guid) => {
                result.commands.push(ClientCommand::OpenTrade(guid));
            }
            AppAction::AddToTrade(guid) => {
                result
                    .commands
                    .push(ClientCommand::AddToTrade { item: guid });
            }
            AppAction::SellToVendor(vendor, item, amount) => {
                result.commands.push(ClientCommand::Sell {
                    vendor,
                    items: vec![ItemProfileActionData {
                        object_guid: item,
                        amount: amount as i32,
                    }],
                });
            }
            AppAction::BuyFromVendor(vendor, item, amount) => {
                result.commands.push(ClientCommand::Buy {
                    vendor,
                    items: vec![ItemProfileActionData {
                        object_guid: item,
                        amount: amount as i32,
                    }],
                });
            }
            AppAction::MoveItem(item, container) => {
                result.commands.push(ClientCommand::MoveItem {
                    item,
                    container,
                    placement: 0,
                });
            }
            AppAction::StackItems(source, destination, amount) => {
                result.commands.push(ClientCommand::Stack {
                    source,
                    destination,
                    amount,
                });
            }
            AppAction::SplitItem(item, container) => {
                result.commands.push(ClientCommand::Split {
                    item,
                    container,
                    amount: 1, // TODO
                });
            }
            AppAction::BeginInteraction(interaction) => {
                if let Some(game) = self.game_option_mut() {
                    game.view.active_interaction = Some(interaction);
                }
                result.needs_redraw = true;
            }
            AppAction::UseWith(item, target) => {
                result
                    .commands
                    .push(ClientCommand::UseWithTarget { item, target });
            }
            AppAction::QueryDebugInfo(guid) => {
                result
                    .commands
                    .push(ClientCommand::QueryEntityDebugInfo(guid));
                result.merge(self.handle_app_action(AppAction::RequestDebugContext(Some(guid))));
            }
            AppAction::CancelInteraction => {
                if let Some(game) = self.game_option_mut() {
                    game.view.active_interaction = None;
                }
                result.needs_redraw = true;
            }
            AppAction::CastSpell(spell_id, target) => {
                // TODO: Auto toggle combat mode.
                if let Some(target) = target {
                    result
                        .commands
                        .push(ClientCommand::CastTargetedSpell { spell_id, target });
                } else {
                    result
                        .commands
                        .push(ClientCommand::CastUntargetedSpell { spell_id });
                }
            }
            AppAction::SetCombatMode(mode) => {
                result.commands.push(ClientCommand::SetCombatMode(mode));
            }
            AppAction::ViewDetails(view) => {
                result.merge(self.handle_app_action(AppAction::ChangeContextView(view)));
            }
            AppAction::Log(kind, text) => {
                self.log(kind, text);
                result.needs_redraw = true;
            }
            AppAction::SendCommands(cmds) => {
                result.commands.extend(cmds);
            }
            AppAction::ChangeContextView(view) => {
                if let Some(game) = self.game_option_mut() {
                    game.view.context_view = view;
                    game.view.context_scroll_offset = 0;
                    result.needs_redraw = true;
                    self.refresh_context_buffer();
                }
            }
            AppAction::RequestDebugContext(guid) => {
                if let Some(game) = self.game_option_mut() {
                    game.view.current_debug_guid = guid;
                    game.view.context_view = ContextView::Custom;
                    game.view.context_scroll_offset = 0;
                    result.needs_redraw = true;
                    self.refresh_context_buffer();
                }
            }
            AppAction::ClearVendor => {
                if let Some(game) = self.game_option_mut() {
                    game.view.vendor = None;
                }
            }
            AppAction::DisplayClientInfo => {
                self.display_client_info();
            }
            AppAction::Sequence(actions) => {
                for sub in actions {
                    result.merge(self.handle_app_action(sub));
                }
            }
            AppAction::Pickup(guid) => {
                if let Some(game) = self.game_option_mut()
                    && let Some(container_id) = game.data.find_non_full_pack(None)
                {
                    result.commands.push(ClientCommand::MoveItem {
                        item: guid,
                        container: container_id,
                        placement: 0,
                    });
                }
            }
            AppAction::Give(item, recipient, amount) => {
                result.commands.push(ClientCommand::GiveObjectRequest {
                    target: recipient,
                    item,
                    amount,
                });
            }
            AppAction::AcceptTrade => {
                result.commands.push(ClientCommand::AcceptTrade);
            }
            AppAction::DeclineTrade => {
                result.commands.push(ClientCommand::DeclineTrade);
            }
            AppAction::ResetTrade => {
                result.commands.push(ClientCommand::ResetTrade);
            }
            AppAction::ExitTrade => {
                result.commands.push(ClientCommand::CloseTrade);
            }
        }
        result
    }
}
