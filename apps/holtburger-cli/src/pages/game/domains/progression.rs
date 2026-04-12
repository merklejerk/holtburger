use super::*;

pub(super) fn reduce_action(_state: &mut GameState, action: AppAction) -> UpdateResult {
    let mut result = UpdateResult::new();

    match action {
        AppAction::LevelUpStat {
            stat,
            amount: xp_spent,
        } => match stat {
            crate::types::StatType::Attribute(attribute) => {
                result.commands.push(ClientCommand::RaiseAttribute {
                    attribute,
                    xp_spent,
                });
            }
            crate::types::StatType::Vital(vital) => {
                result
                    .commands
                    .push(ClientCommand::RaiseVital { vital, xp_spent });
            }
            crate::types::StatType::Skill(skill) => {
                result
                    .commands
                    .push(ClientCommand::RaiseSkill { skill, xp_spent });
            }
        },
        AppAction::TrainSkill {
            skill,
            amount: credits,
        } => {
            result
                .commands
                .push(ClientCommand::TrainSkill { skill, credits });
        }
        _ => {}
    }

    result
}
