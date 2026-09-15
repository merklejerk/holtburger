//! Player formula semantics over already decoded fixed slots.

use holtburger_dat::file_type::spell_table::component_power_tier;
use std::num::Wrapping;

/// Malformed authored formulas cannot become plausible component requirements.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum FormulaError {
    #[error("Formula version {version} has a zero divisor")]
    ZeroDivisor { version: u32 },
}

/// Account customization uses the legacy signed-byte hash computed by the caller.
/// Retail acclient.c:465137/465244/465281; fixed slots preserve short version-3 formulas.
pub fn customize(
    mut slots: [u32; 8],
    version: u32,
    account_hash: u32,
) -> Result<[u32; 8], FormulaError> {
    let c = slots.map(Wrapping);
    let seed = Wrapping(account_hash % 0x13D573);
    let taper = |value: Wrapping<u32>| (value.0 % 12) + 63;
    let divide = |numerator: Wrapping<u32>, denominator: Wrapping<u32>| {
        numerator
            .0
            .checked_div(denominator.0)
            .map(Wrapping)
            .ok_or(FormulaError::ZeroDivisor { version })
    };
    match version {
        1 => {
            let count = slots.iter().filter(|&&id| id != 0).count();
            let herb_index = if count > 5 { 2 } else { 1 };
            let powder_index = herb_index + if count > 6 { 2 } else { 1 };
            let mut scarab = c[0];
            let herb = c[herb_index];
            let powder = c[powder_index];
            let potion = c[powder_index + 1];
            let talisman = c[powder_index + if count > 7 { 3 } else { 2 }];
            if count > 5 {
                if (scarab + herb).0 == 0 {
                    scarab = Wrapping(1);
                }
                slots[1] = taper(scarab + powder + potion + talisman + Wrapping(2) * herb);
            }
            if count > 6 {
                let pair = powder + potion;
                if (scarab + pair).0 == 0 {
                    scarab = Wrapping(1);
                }
                slots[3] = taper(
                    (scarab + herb + talisman + Wrapping(2) * pair) * divide(seed, scarab + pair)?,
                );
            }
            if count > 7 {
                if (talisman + scarab).0 == 0 {
                    scarab = Wrapping(1);
                }
                slots[6] = taper(
                    (scarab + herb + powder + potion + Wrapping(2) * talisman)
                        * divide(seed, talisman + scarab)?,
                );
            }
        }
        2 => {
            slots[3] =
                taper(c[1] + c[2] + c[0] + c[7] + Wrapping(2) * c[0] + Wrapping(2) * c[4] * c[5]);
            slots[6] = taper(
                (c[4] + c[0] * c[2] + c[7] + Wrapping(2) * c[0] * c[2] + Wrapping(2) * c[5])
                    * divide(seed, c[1] * c[7] + Wrapping(2) * c[4])?,
            );
        }
        3 => {
            let [a, b, d, e, f, g] = [
                (0x13D573, 0),
                (0x4AEFD, 1),
                (0x96A7F, 2),
                (0x100A03, 4),
                (0xEB2EF, 5),
                (0x121E7D, 7),
            ]
            .map(|(modulus, index)| Wrapping((Wrapping(account_hash % modulus) + c[index]).0 % 12));
            slots[3] = taper(a + b + d + e + f + d * f + a * b + g * (e + Wrapping(1)));
            slots[6] = taper(
                a + b
                    + d
                    + e
                    + Wrapping(account_hash % 0x65039 % 12)
                    + g * (e * (a * b * d * f + Wrapping(7)) + Wrapping(1))
                    + f
                    + Wrapping(5) * a * b
                    + Wrapping(11) * d * f,
            );
        }
        _ => {}
    }
    Ok(slots)
}

/// Scarabs and chorizite followed by repeated prismatic tapers.
/// acclient.c:429258; strongest retained power component determines taper count.
pub fn foci(slots: [u32; 8]) -> [u32; 8] {
    let mut result = [0; 8];
    let mut length = 0;
    let mut tier = 0;
    for id in slots.into_iter().take_while(|&id| id != 0) {
        if matches!(id, 1..=6 | 110..=112 | 192..=193) {
            result[length] = id;
            length += 1;
            tier = tier.max(component_power_tier(id));
        }
    }
    let tapers = match tier {
        1 => 1,
        2 => 2,
        3 | 4 | 7 => 3,
        5 | 6 | 8 | 9 | 10 => 4,
        _ => 0,
    };
    // RETAIL QUIRK: InqScarabOnlyFormula ignores SetComponent's rejected writes
    // past slot eight (acclient.c:429331, :464902). Expanding the formula would
    // change inspected requirements for 23 of 6,266 local spell definitions.
    let end = (length + tapers).min(result.len());
    result[length..end].fill(188);
    result
}

/// Current foci route for a school after the caller establishes player description readiness.
/// Retail MagicPackIsOwned (acclient.c:418534) scans the direct pack roster,
/// not recursively nested items; CObjectInventory::_containersList is at offset 36.
pub fn has_foci(world: &crate::WorldState, school: super::MagicSchool) -> Option<bool> {
    use super::MagicSchool;
    use crate::state::storage::{RosterCoverage, StorageSlot};
    use holtburger_common::properties::PropertyInt;
    let (property, wcid) = match school {
        MagicSchool::CreatureEnchantment => (PropertyInt::AugmentationInfusedCreatureMagic, 15268),
        MagicSchool::ItemEnchantment => (PropertyInt::AugmentationInfusedItemMagic, 15269),
        MagicSchool::LifeMagic => (PropertyInt::AugmentationInfusedLifeMagic, 15270),
        MagicSchool::WarMagic => (PropertyInt::AugmentationInfusedWarMagic, 15271),
        MagicSchool::VoidMagic => (PropertyInt::AugmentationInfusedVoidMagic, 43173),
        MagicSchool::None => return Some(false),
    };
    world.player_properties()?;
    if world
        .player_int_property(property)
        .is_some_and(|value| value > 0)
    {
        return Some(true);
    }
    let mut complete = world.storage_coverage(world.player.guid) == Some(RosterCoverage::Announced);
    for (guid, slot) in world.container_contents(world.player.guid) {
        match slot {
            StorageSlot::Item { .. } => continue,
            StorageSlot::Pending => {
                complete = false;
                continue;
            }
            StorageSlot::Pack { .. } => {}
        }
        match world.entities.get(guid).and_then(|entity| entity.wcid) {
            Some(id) if id == wcid => return Some(true),
            Some(_) => {}
            None => complete = false,
        }
    }
    complete.then_some(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn account_versions_match_independent_scalar_fixtures() {
        let authored = [6, 63, 10, 64, 20, 30, 65, 40];
        for (version, hash, expected) in [
            (1, 0, [6, 71, 10, 63, 20, 30, 63, 40]),
            (1, 123456, [6, 71, 10, 63, 20, 30, 65, 40]),
            (2, 0, [6, 63, 10, 74, 20, 30, 63, 40]),
            (3, 0, [6, 63, 10, 66, 20, 30, 66, 40]),
        ] {
            assert_eq!(customize(authored, version, hash).unwrap(), expected);
        }
        assert_eq!(customize(authored, 0, 123456).unwrap(), authored);
        assert_eq!(
            customize([0; 8], 2, 1),
            Err(FormulaError::ZeroDivisor { version: 2 })
        );
    }

    #[test]
    fn foci_preserves_scarabs_chorizite_and_repeated_tapers() {
        assert_eq!(
            foci([1, 111, 112, 10, 20, 30, 40, 0]),
            [1, 111, 112, 188, 188, 188, 188, 0]
        );
        assert_eq!(
            foci([1, 10, 20, 30, 40, 0, 0, 0]),
            [1, 188, 0, 0, 0, 0, 0, 0]
        );
        assert_eq!(foci([193; 8]), [193; 8]);
    }
}

#[cfg(test)]
mod foci_tests {
    use super::*;
    use crate::{WorldState, entity::Entity, spell::MagicSchool};
    use holtburger_common::{
        Guid,
        properties::{InventoryEntryKind, PropertyInt},
    };

    #[test]
    fn distinguishes_unannounced_unhydrated_owned_and_augmented_foci() {
        let mut world = WorldState::synthetic();
        let player = Guid(1);
        let focus = Guid(2);
        world.seed_local_player_entity(player, "Player", Default::default());
        assert_eq!(has_foci(&world, MagicSchool::WarMagic), None);
        world
            .storage
            .replace_contents(player, &[(focus, InventoryEntryKind::Foci)]);
        assert_eq!(has_foci(&world, MagicSchool::WarMagic), None);
        let mut entity = Entity::new(focus, "Focus".into(), Default::default());
        entity.wcid = Some(15271);
        world.add_entity(entity);
        assert_eq!(has_foci(&world, MagicSchool::WarMagic), Some(true));
        assert_eq!(has_foci(&world, MagicSchool::LifeMagic), Some(false));
        world.storage.replace_contents(player, &[]);
        assert_eq!(has_foci(&world, MagicSchool::WarMagic), Some(false));
        world
            .entities
            .get_mut(player)
            .unwrap()
            .properties
            .ints
            .insert(PropertyInt::AugmentationInfusedWarMagic, 1);
        assert_eq!(has_foci(&world, MagicSchool::WarMagic), Some(true));
    }
}
