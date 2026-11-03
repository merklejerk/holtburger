//! App-local projection of static stat artwork for both character-creation and progression UI.

use holtburger_common::stats::{AttributeType, VitalType};
use holtburger_content::stat_icons::StatIconTarget;
use serde::Serialize;

use crate::ui_icons::{UiIconArtwork, UiIconSpec};

/// One reference bridges canonical stat identity with the creator's allocation index.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatIconReference {
    /// Matches progression's typed stat targets without parsing display names.
    target: StatIconTarget,
    /// Attribute/vital tuple index, or numeric skill slot, consumed by character creation.
    creation_id: u32,
    /// Standalone graphic recipe or an explicit lookup failure.
    artwork: UiIconArtwork,
}

/// Both screens use one static source; current stat values never carry artwork payloads.
pub fn load_stat_icons(
    repository: &holtburger_content::ContentRepository,
) -> anyhow::Result<Vec<StatIconReference>> {
    Ok(repository
        .read_stat_icon_references()?
        .into_iter()
        .map(|reference| StatIconReference {
            target: reference.target,
            creation_id: creation_id(reference.target),
            artwork: match reference.artwork {
                Ok(base) => UiIconArtwork::Ready {
                    spec: UiIconSpec::Base { base },
                },
                Err(error) => UiIconArtwork::Failed {
                    detail: error.to_string().chars().take(1024).collect(),
                },
            },
        })
        .collect())
}

/// Resolve allocation indices at the adapter boundary, not in either UI.
fn creation_id(target: StatIconTarget) -> u32 {
    match target {
        StatIconTarget::Attribute(attribute) => match attribute {
            AttributeType::StrengthAttr => 0,
            AttributeType::EnduranceAttr => 1,
            AttributeType::CoordinationAttr => 2,
            AttributeType::QuicknessAttr => 3,
            AttributeType::FocusAttr => 4,
            AttributeType::SelfAttr => 5,
        },
        StatIconTarget::Vital(vital) => match vital {
            VitalType::Health => 0,
            VitalType::Stamina => 1,
            VitalType::Mana => 2,
        },
        StatIconTarget::Skill(skill) => skill as u32,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::stats::SkillType;
    #[test]
    fn creation_identity_does_not_reuse_attribute_or_maximum_vital_numbering() {
        assert_eq!(
            creation_id(StatIconTarget::Attribute(AttributeType::CoordinationAttr)),
            2
        );
        assert_eq!(
            creation_id(StatIconTarget::Attribute(AttributeType::QuicknessAttr)),
            3
        );
        assert_eq!(creation_id(StatIconTarget::Vital(VitalType::Health)), 0);
        assert_eq!(creation_id(StatIconTarget::Vital(VitalType::Stamina)), 1);
        assert_eq!(
            creation_id(StatIconTarget::Skill(SkillType::MeleeDefense)),
            SkillType::MeleeDefense as u32
        );
    }
}
