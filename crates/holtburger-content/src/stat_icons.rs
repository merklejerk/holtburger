//! Static stat artwork identities, independent of character allocation and current values.

use std::num::NonZeroU32;

use holtburger_common::stats::{AttributeType, SkillType, VitalType};
use holtburger_dat::file_type::SkillTable;
use serde::Serialize;

use crate::ui_assets::{UiAssetError, UiAssetReader, UiAssets};

const ATTRIBUTE_ICONS: u32 = 0x1000_0002;
const VITAL_ICONS: u32 = 0x1000_0003;

/// Canonical stat identity shared by static artwork and character presentations.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum StatIconTarget {
    /// Primary attribute identity, independent of creation tuple ordering.
    Attribute(AttributeType),
    /// Maximum vital identity; artwork lookup uses the corresponding current vital.
    Vital(VitalType),
    /// Skill-table identity, restricted to skills offered by the current client.
    Skill(SkillType),
}

/// A missing graphic is explicit and does not remove the stat's identity or controls.
#[derive(Debug)]
pub struct StatIconReference {
    /// Identity supplied to both creation and progression consumers.
    pub target: StatIconTarget,
    /// Standalone RenderSurface or the precise content lookup failure.
    pub artwork: Result<NonZeroU32, UiAssetError>,
}

impl crate::ContentRepository {
    /// Discover stat artwork without requiring a character or loading world bootstrap data.
    pub fn read_stat_icon_references(&self) -> anyhow::Result<Vec<StatIconReference>> {
        let skills = self.read_asset::<SkillTable>("stat icon skills")?;
        Ok(stat_icon_references(&skills, &mut UiAssetReader::new(self)))
    }
}

fn nonzero(id: u32) -> Result<NonZeroU32, UiAssetError> {
    NonZeroU32::new(id).ok_or_else(|| UiAssetError::InvalidAsset {
        id,
        detail: "stat icon has no assigned graphic".to_owned(),
    })
}

/// Retail stat rows draw standalone graphics; no item background or effect layers apply.
fn stat_icon_references(skills: &SkillTable, assets: &mut impl UiAssets) -> Vec<StatIconReference> {
    use AttributeType::*;
    let mut references: Vec<_> = [
        StrengthAttr,
        EnduranceAttr,
        CoordinationAttr,
        QuicknessAttr,
        FocusAttr,
        SelfAttr,
    ]
    .into_iter()
    .map(|attribute| StatIconReference {
        target: StatIconTarget::Attribute(attribute),
        artwork: assets
            .enum_did(ATTRIBUTE_ICONS, attribute as u32)
            .and_then(nonzero),
    })
    .collect();
    // Retail artwork is keyed by current Health/Stamina/Mana, whereas stat calculations use maxima.
    for (vital, current_id) in [
        (VitalType::Health, 2),
        (VitalType::Stamina, 4),
        (VitalType::Mana, 6),
    ] {
        references.push(StatIconReference {
            target: StatIconTarget::Vital(vital),
            artwork: assets.enum_did(VITAL_ICONS, current_id).and_then(nonzero),
        });
    }
    let mut skill_ids: Vec<_> = skills.skill_base_hash.keys().copied().collect();
    skill_ids.sort_unstable();
    for id in skill_ids {
        // Unknown and retired DAT slots are not offered by either current-client screen.
        if let Some(skill) = SkillType::from_repr(id).filter(|skill| skill.is_eor()) {
            references.push(StatIconReference {
                target: StatIconTarget::Skill(skill),
                artwork: nonzero(skills.skill_base_hash[&id].icon_id),
            });
        }
    }
    references
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ui_assets::UiImage;
    use std::sync::Arc;

    struct Mappings(Vec<(u32, u32)>);
    impl UiAssets for Mappings {
        fn enum_did(&mut self, group: u32, entry: u32) -> Result<u32, UiAssetError> {
            self.0.push((group, entry));
            Ok(group + entry)
        }
        fn image(&mut self, _: u32) -> Result<Arc<UiImage>, UiAssetError> {
            panic!("Reference discovery must not decode images");
        }
    }

    #[test]
    fn preserves_creation_order_and_uses_current_vital_mapping_keys() {
        let mut assets = Mappings(Vec::new());
        let references = stat_icon_references(&SkillTable::default(), &mut assets);
        assert_eq!(
            &assets.0[..6],
            &[
                (ATTRIBUTE_ICONS, 1),
                (ATTRIBUTE_ICONS, 2),
                (ATTRIBUTE_ICONS, 4),
                (ATTRIBUTE_ICONS, 3),
                (ATTRIBUTE_ICONS, 5),
                (ATTRIBUTE_ICONS, 6)
            ]
        );
        assert_eq!(
            &assets.0[6..],
            &[(VITAL_ICONS, 2), (VITAL_ICONS, 4), (VITAL_ICONS, 6)]
        );
        assert_eq!(
            references[6].target,
            StatIconTarget::Vital(VitalType::Health)
        );
        assert_eq!(references.len(), 9);
    }
    #[test]
    fn preserves_authored_skill_artwork_and_reports_zero_graphics() {
        use holtburger_dat::file_type::skill_table::{SkillBase, SkillFormula};
        let skill = |icon_id| SkillBase {
            name: "Fixture".to_owned(),
            description: String::new(),
            _align1: (),
            _align2: (),
            icon_id,
            trained_cost: 1,
            specialized_cost: 2,
            category: 1,
            chargen_use: 1,
            min_level: 1,
            formula: SkillFormula {
                w: 0,
                x: 0,
                y: 0,
                z: 1,
                attr1: 0,
                attr2: 0,
            },
            upper_bound: 0.0,
            lower_bound: 0.0,
            learn_mod: 1.0,
        };
        let mut skills = SkillTable::default();
        let icon = 0x0600_0123;
        skills
            .skill_base_hash
            .insert(SkillType::MeleeDefense as u32, skill(icon));
        skills
            .skill_base_hash
            .insert(SkillType::MissileDefense as u32, skill(0));
        let references = stat_icon_references(&skills, &mut Mappings(Vec::new()));
        let melee = references
            .iter()
            .find(|reference| reference.target == StatIconTarget::Skill(SkillType::MeleeDefense))
            .unwrap();
        let missile = references
            .iter()
            .find(|reference| reference.target == StatIconTarget::Skill(SkillType::MissileDefense))
            .unwrap();
        assert_eq!(melee.artwork.as_ref().unwrap().get(), icon);
        assert!(matches!(
            missile.artwork,
            Err(UiAssetError::InvalidAsset { id: 0, .. })
        ));
    }
}
