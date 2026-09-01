use holtburger_common::properties::DamageType;
use holtburger_protocol::messages::combat::{AttackConditions, DamageLocation};

use super::types::CombatFeedback;

/// Damage relative to maximum health above which a hit receives visual emphasis.
const COMBAT_EMPHASIS_DAMAGE_FRACTION: f64 = 0.1;

/// Player-facing combat text plus presentation-relevant combat semantics.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CombatFeedbackMessage {
    /// Fully formatted text shared by graphical and terminal clients.
    text: String,
    /// Whether this hit is unusually damaging or critical.
    emphasized: bool,
}

impl CombatFeedbackMessage {
    pub fn into_text_and_emphasis(self) -> (String, bool) {
        (self.text, self.emphasized)
    }
}

/// Formats player-facing combat feedback shared by graphical and terminal clients.
///
/// Attack lifecycle edges return `None`: they are diagnostics, not combat-buffer messages.
pub fn combat_feedback_message(feedback: &CombatFeedback) -> Option<CombatFeedbackMessage> {
    match feedback {
        CombatFeedback::AttackDone { .. } | CombatFeedback::AttackCommenced => None,
        CombatFeedback::AttackerNotification {
            defender_name,
            damage_type,
            health_percent,
            damage,
            critical_hit,
            attack_conditions,
        } => Some(CombatFeedbackMessage {
            text: format!(
                "You hit {} for {} {} damage.{}{}",
                defender_name,
                damage,
                format_damage_type(*damage_type),
                if *critical_hit { " Critical hit." } else { "" },
                format_attack_conditions_suffix(*attack_conditions),
            ),
            emphasized: *health_percent > COMBAT_EMPHASIS_DAMAGE_FRACTION || *critical_hit,
        }),
        CombatFeedback::DefenderNotification {
            attacker_name,
            damage_type,
            health_percent,
            damage,
            damage_location,
            critical_hit,
            attack_conditions,
        } => Some(CombatFeedbackMessage {
            text: format!(
                "{} hit you for {} {} damage to your {}.{}{}",
                attacker_name,
                damage,
                format_damage_type(*damage_type),
                format_damage_location(*damage_location),
                if *critical_hit { " Critical hit." } else { "" },
                format_attack_conditions_suffix(*attack_conditions),
            ),
            emphasized: *health_percent > COMBAT_EMPHASIS_DAMAGE_FRACTION || *critical_hit,
        }),
        CombatFeedback::EvasionAttackerNotification { defender_name } => Some(
            unemphasized_message(format!("{} evaded your attack.", defender_name)),
        ),
        CombatFeedback::EvasionDefenderNotification { attacker_name } => Some(
            unemphasized_message(format!("You evaded {}'s attack.", attacker_name)),
        ),
        CombatFeedback::VictimNotification { death_message }
        | CombatFeedback::KillerNotification { death_message }
        | CombatFeedback::PlayerKilled { death_message, .. } => {
            Some(unemphasized_message(death_message.clone()))
        }
    }
}

fn unemphasized_message(text: String) -> CombatFeedbackMessage {
    CombatFeedbackMessage {
        text,
        emphasized: false,
    }
}

fn format_damage_type(damage_type: DamageType) -> String {
    let names: Vec<_> = damage_type.iter_display_names().collect();
    if names.is_empty() {
        "unknown".to_string()
    } else {
        names.join("/").to_ascii_lowercase()
    }
}

fn format_damage_location(location: DamageLocation) -> &'static str {
    match location {
        DamageLocation::Head => "head",
        DamageLocation::Chest => "chest",
        DamageLocation::Abdomen => "abdomen",
        DamageLocation::UpperArm => "upper arm",
        DamageLocation::LowerArm => "lower arm",
        DamageLocation::Hand => "hand",
        DamageLocation::UpperLeg => "upper leg",
        DamageLocation::LowerLeg => "lower leg",
        DamageLocation::Foot => "foot",
    }
}

fn format_attack_conditions_suffix(attack_conditions: AttackConditions) -> String {
    let names: Vec<_> = attack_conditions.iter_display_names().collect();
    if names.is_empty() {
        String::new()
    } else {
        format!(" [{}]", names.join(", "))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn damage_summary_preserves_authored_semantics() {
        let message = combat_feedback_message(&CombatFeedback::AttackerNotification {
            defender_name: "Drudge".to_string(),
            damage_type: DamageType::SLASH,
            health_percent: 0.25,
            damage: 37,
            critical_hit: true,
            attack_conditions: AttackConditions::RECKLESSNESS | AttackConditions::SNEAK_ATTACK,
        });

        assert_eq!(
            message.as_ref().map(|message| message.text.as_str()),
            Some(
                "You hit Drudge for 37 slashing damage. Critical hit. [Recklessness, Sneak Attack]"
            )
        );
        assert_eq!(message.map(|message| message.emphasized), Some(true));
    }

    #[test]
    fn damage_emphasis_requires_over_ten_percent_or_a_critical_hit() {
        let message_at_threshold = combat_feedback_message(&CombatFeedback::AttackerNotification {
            defender_name: "Drudge".to_string(),
            damage_type: DamageType::SLASH,
            health_percent: COMBAT_EMPHASIS_DAMAGE_FRACTION,
            damage: 10,
            critical_hit: false,
            attack_conditions: AttackConditions::NONE,
        })
        .expect("damage feedback should produce a message");
        let message_over_threshold =
            combat_feedback_message(&CombatFeedback::AttackerNotification {
                defender_name: "Drudge".to_string(),
                damage_type: DamageType::SLASH,
                health_percent: COMBAT_EMPHASIS_DAMAGE_FRACTION + f64::EPSILON,
                damage: 11,
                critical_hit: false,
                attack_conditions: AttackConditions::NONE,
            })
            .expect("damage feedback should produce a message");
        let critical_message = combat_feedback_message(&CombatFeedback::AttackerNotification {
            defender_name: "Drudge".to_string(),
            damage_type: DamageType::SLASH,
            health_percent: 0.01,
            damage: 1,
            critical_hit: true,
            attack_conditions: AttackConditions::NONE,
        })
        .expect("damage feedback should produce a message");

        assert!(!message_at_threshold.emphasized);
        assert!(message_over_threshold.emphasized);
        assert!(critical_message.emphasized);
    }

    #[test]
    fn attack_lifecycle_edges_are_not_player_facing_messages() {
        assert_eq!(
            combat_feedback_message(&CombatFeedback::AttackCommenced),
            None
        );
    }
}
