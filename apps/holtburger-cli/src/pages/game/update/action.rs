use super::super::*;

#[path = "action_combat.rs"]
mod combat_actions;
#[path = "action_detail.rs"]
mod detail_actions;
#[path = "action_interaction.rs"]
mod interaction_actions;
#[path = "action_inventory.rs"]
mod inventory_actions;
#[path = "action_progression.rs"]
mod progression_actions;
#[path = "action_trade.rs"]
mod trade_actions;

pub(in super::super) fn reduce_action(
    state: &mut GameState,
    action: AppAction,
) -> Option<UpdateResult> {
    match action {
        action @ (AppAction::Assess { .. }
        | AppAction::Read { .. }
        | AppAction::Use { .. }
        | AppAction::TalkTo { .. }
        | AppAction::Open { .. }
        | AppAction::Close { .. }
        | AppAction::QueryDebugInfo { .. }
        | AppAction::ViewDetails { .. }
        | AppAction::ClearVendor) => Some(detail_actions::reduce_detail_action(state, action)),

        action @ (AppAction::QueueSalvageItem { .. }
        | AppAction::UnqueueSalvageItem { .. }
        | AppAction::SalvageItems { .. }
        | AppAction::Drop { .. }
        | AppAction::Equip { .. }
        | AppAction::EquipInSlot { .. }
        | AppAction::Unequip { .. }
        | AppAction::MoveItem { .. }
        | AppAction::StackItems { .. }
        | AppAction::SplitItem { .. }
        | AppAction::PickUp { .. }
        | AppAction::Give { .. }
        | AppAction::UseWith { .. }) => {
            Some(inventory_actions::reduce_inventory_action(state, action))
        }

        action @ (AppAction::Approach { .. }
        | AppAction::Follow { .. }
        | AppAction::Scoot { .. }
        | AppAction::BeginInteraction { .. }
        | AppAction::CancelInteraction) => {
            Some(interaction_actions::reduce_interaction_action(state, action))
        }

        action @ (AppAction::OpenTrade { .. }
        | AppAction::AddToTrade { .. }
        | AppAction::OpenShop { .. }
        | AppAction::SellToVendor { .. }
        | AppAction::BuyFromVendor { .. }
        | AppAction::InviteToParty { .. }
        | AppAction::UninviteFromParty { .. }
        | AppAction::SwearAllegiance { .. }
        | AppAction::Unswear { .. }
        | AppAction::AcceptTrade
        | AppAction::DeclineTrade
        | AppAction::ResetTrade
        | AppAction::ExitTrade) => Some(trade_actions::reduce_trade_action(state, action)),

        action @ (AppAction::CastSpell { .. }
        | AppAction::CycleCombatProfileLevel
        | AppAction::CycleCombatAttackHeight
        | AppAction::SetCombatMode { .. }) => {
            Some(combat_actions::reduce_combat_action(state, action))
        }

        action @ (AppAction::LevelUpStat { .. } | AppAction::TrainSkill { .. }) => {
            Some(progression_actions::reduce_progression_action(state, action))
        }

        AppAction::UiAction { action } => Some(state.handle_ui_action(action)),

        AppAction::Sequence { actions } => {
            let mut result = UpdateResult::new();
            for inner_action in actions {
                if let Some(inner_result) = state.handle_action(inner_action) {
                    result.merge(inner_result);
                }
            }
            Some(result)
        }

        _ => None,
    }
}