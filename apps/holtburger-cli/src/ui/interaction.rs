use holtburger_common::Guid;

use crate::ui::state::GameState;
use crate::ui::types::{Action, CommandTarget};
use crate::ui::update::effect::UIEffect;
use crate::pages::game::dashboard::tabs::classification;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Interaction {
    Moving { item_guid: Guid },
    Healing { item_guid: Guid },
    Targeting { target_guid: Guid },
    Combining { item_guid: Guid },
}

impl Interaction {
    pub fn handle_action(
        &self,
        action: &Action,
        target: &CommandTarget,
        game: &GameState,
    ) -> Option<UIEffect> {
        let player_guid = game.data.player_guid;

        match (action, target) {
            (Action::ConfirmInteraction, _) => match self {
                Self::Healing { item_guid } => match target {
                    CommandTarget::Entity(e, _) => {
                        if e.guid == *item_guid {
                            player_guid.map(UIEffect::ApplyHealing)
                        } else {
                            Some(UIEffect::ApplyHealing(e.guid))
                        }
                    }
                    _ => player_guid.map(UIEffect::ApplyHealing),
                },
                Self::Moving { item_guid } => match target {
                    CommandTarget::Entity(e, _) if e.guid != *item_guid => {
                        if let Some(source_e) = game.data.entities.get(item_guid)
                            && source_e.is_stackable()
                            && source_e.wcid == e.wcid
                            && e.stack_size() < e.max_stack_size()
                        {
                            return Some(UIEffect::ApplyStacking(e.guid));
                        }

                        let class = classification::classify_entity(e);
                        match class {
                            classification::EntityClass::Container
                            | classification::EntityClass::Chest => {
                                Some(UIEffect::ApplyMoving(e.guid))
                            }
                            _ => Some(UIEffect::Give(e.guid)),
                        }
                    }
                    _ => {
                        if game.dashboard.active_tab == crate::ui::DashboardTab::Trade {
                            Some(UIEffect::Command(
                                holtburger_core::client::types::ClientCommand::AddToTrade {
                                    item: *item_guid,
                                },
                            ))
                        } else {
                            player_guid.map(UIEffect::ApplyMoving)
                        }
                    }
                },
                Self::Combining { .. } => match target {
                    CommandTarget::Entity(e, _) => Some(UIEffect::ApplyCombining(e.guid)),
                    _ => None,
                },
                Self::Targeting { .. } => match target {
                    CommandTarget::Entity(e, _) => Some(UIEffect::Target(e.guid)),
                    _ => None,
                },
            },
            (Action::CancelInteraction, _) => Some(UIEffect::CancelInteraction),
            _ => None,
        }
    }

    pub fn status_text(&self) -> &'static str {
        match self {
            Self::Moving { .. } => " Moving Item | [ESC] to cancel ",
            Self::Healing { .. } => " Healing | [ESC] to cancel ",
            Self::Targeting { .. } => " Targeting | [ESC] to cancel ",
            Self::Combining { .. } => " Combining Items | [ESC] to cancel ",
        }
    }
}
