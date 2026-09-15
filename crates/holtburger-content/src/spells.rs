//! Static spell references, independent of player knowledge and UI layout.

use holtburger_dat::file_type::{SpellTable, spell_table::component_power_tier};

/// Source facts consumed by the app host's spell artwork projection.
pub struct SpellReference<'a> {
    /// Authored display name.
    pub name: &'a str,
    /// Authored inspection description.
    pub description: &'a str,
    /// Authored school identity.
    pub school: u32,
    /// Authored base mana, before casting economy adjustments.
    pub base_mana: u32,
    /// Additional authored mana per target.
    pub mana_mod: u32,
    /// Positive authored enchantment duration or portal lifetime, in seconds.
    pub duration_seconds: Option<f64>,
    /// Base RenderSurface identity.
    pub icon_id: u32,
    /// Decoded formula tier, including retail's unknown-component zero result.
    pub power_tier: u32,
    /// Authored flags; the app host owns visual interpretation.
    pub flags: u32,
}

/// Query an already parsed table without consulting live character membership.
pub fn spell_reference(table: &SpellTable, id: u32) -> Option<SpellReference<'_>> {
    table.spells.get(&id).map(|spell| SpellReference {
        name: &spell.name,
        description: &spell.description,
        school: spell.school,
        base_mana: spell.base_mana,
        mana_mod: spell.mana_mod,
        duration_seconds: match spell.extras {
            holtburger_dat::file_type::spell_table::SpellExtras::Enchantment {
                duration, ..
            } => Some(duration),
            holtburger_dat::file_type::spell_table::SpellExtras::PortalSummon {
                portal_lifetime,
            } => Some(portal_lifetime),
            holtburger_dat::file_type::spell_table::SpellExtras::None => None,
        }
        .filter(|duration| *duration > 0.0),
        icon_id: spell.icon_id,
        power_tier: component_power_tier(spell.components[0]),
        flags: spell.bitfield,
    })
}

/// Static component facts for formula inspection, independent of inventory instances.
pub fn spell_components(
    repository: &crate::ContentRepository,
) -> anyhow::Result<holtburger_dat::file_type::SpellComponentsTable> {
    repository.read_asset::<holtburger_dat::file_type::SpellComponentsTable>("spell components")
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_dat::file_type::spell_table::{SpellBase, SpellExtras};
    use std::collections::HashMap;

    #[test]
    fn inspection_preserves_authored_costs_and_only_applicable_positive_duration() {
        for (extras, expected) in [
            (SpellExtras::None, None),
            (
                SpellExtras::PortalSummon {
                    portal_lifetime: 120.0,
                },
                Some(120.0),
            ),
            (
                SpellExtras::Enchantment {
                    duration: 60.0,
                    degrade_modifier: 0.0,
                    degrade_limit: 0.0,
                },
                Some(60.0),
            ),
            (
                SpellExtras::Enchantment {
                    duration: -1.0,
                    degrade_modifier: 0.0,
                    degrade_limit: 0.0,
                },
                None,
            ),
        ] {
            let table = SpellTable {
                id: SpellTable::FILE_ID,
                spells: HashMap::from([(
                    1,
                    SpellBase {
                        description: "Authored description".into(),
                        school: 3,
                        base_mana: 10,
                        mana_mod: 2,
                        extras,
                        ..SpellBase::default()
                    },
                )]),
                spell_sets: HashMap::new(),
            };
            let reference = spell_reference(&table, 1).unwrap();
            assert_eq!(reference.description, "Authored description");
            assert_eq!(
                (reference.school, reference.base_mana, reference.mana_mod),
                (3, 10, 2)
            );
            assert_eq!(reference.duration_seconds, expected);
        }
    }
}
