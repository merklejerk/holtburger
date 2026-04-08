use super::*;

pub(super) fn reduce_trade_action(state: &mut GameState, action: AppAction) -> UpdateResult {
    let mut result = UpdateResult::new();

    match action {
        AppAction::InviteToParty { target } => {
            result.commands.push(ClientCommand::InviteToParty { target });
        }
        AppAction::UninviteFromParty { target } => {
            result.commands.push(ClientCommand::UninviteFromParty { target });
        }
        AppAction::SwearAllegiance { target } => {
            result.commands.push(ClientCommand::SwearAllegiance { target });
        }
        AppAction::Unswear { target } => {
            result.commands.push(ClientCommand::Unswear { target });
        }
        AppAction::OpenTrade { guid } => match state.try_enter_combat_mode(CombatMode::NonCombat) {
            EnterCombatModeResult::Failed(res) => {
                result.merge(res);
            }
            EnterCombatModeResult::Success(res) => {
                result.merge(res);
                state.runtime.last_trade_initiation = Some((Instant::now(), guid));
                result.commands.push(ClientCommand::OpenTrade(guid));
            }
        },
        AppAction::AddToTrade { guid } => {
            result.commands.push(ClientCommand::AddToTrade { item: guid });
        }
        AppAction::OpenShop { vendor } => {
            if state.data.trade.is_some() {
                result.actions.push(AppAction::Log {
                    chat_tags: ChatMessageTags::warning(),
                    message: "You are currently in a trade.".to_string(),
                });
            } else {
                state.runtime.last_trade_initiation = Some((Instant::now(), vendor));
                result.commands.push(ClientCommand::Use(vendor));
            }
        }
        AppAction::SellToVendor {
            vendor,
            item,
            amount,
        } => {
            result.commands.push(ClientCommand::Sell {
                vendor,
                items: vec![ItemProfileActionData {
                    object_guid: item,
                    amount: amount as i32,
                }],
            });
        }
        AppAction::BuyFromVendor {
            vendor,
            item,
            amount,
        } => {
            result.commands.push(ClientCommand::Buy {
                vendor,
                items: vec![ItemProfileActionData {
                    object_guid: item,
                    amount: amount as i32,
                }],
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
        _ => unreachable!("unsupported trade action"),
    }

    result
}