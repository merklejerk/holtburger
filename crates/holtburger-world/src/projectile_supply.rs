//! Remaining projectiles resolved from accepted equipment and live item facts.

use holtburger_common::{
    Guid,
    properties::{CombatUse, EquipMask, PropertyBool, WorldObjectExt},
};
use serde::{Deserialize, Serialize};

use crate::{WorldState, context::WorldContext, state::storage::RosterCoverage};

/// Reusable missile supply, independent of combat controls and HUD formatting.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum ProjectileSupply {
    /// Equipment or consumption facts are incomplete; never present this as zero.
    Pending {
        /// Core may appraise this source to establish its consumption policy.
        appraisal: Option<Guid>,
    },
    /// No missile weapon is equipped.
    NotApplicable,
    /// Server-confirmed remaining projectiles, including a non-stackable single item.
    Finite {
        /// Quantity of the equipped ammunition or thrown weapon, excluding reserves.
        count: u32,
    },
    /// The equipped projectile source is confirmed not to be consumed by firing.
    Unlimited,
}

impl Default for ProjectileSupply {
    fn default() -> Self {
        Self::Pending { appraisal: None }
    }
}

impl WorldState {
    /// Select the projectile source once, using public missile/ammo facts rather than
    /// server-only DefaultCombatStyle. Retail distinguishes launchers by nonzero
    /// AmmoType (acclient.c:378453, 382041); ACE Player_Missile.cs:156 selects their
    /// separate ammunition and consumes the weapon itself otherwise.
    pub fn projectile_supply(&self) -> ProjectileSupply {
        if self.player.guid == Guid::NULL
            || self.storage_coverage(self.player.guid) != Some(RosterCoverage::Announced)
        {
            return ProjectileSupply::default();
        }
        let mut weapon = None;
        let mut ammunition = None;
        for guid in self.iter_equipment() {
            let Some(mask) = self.equipment_mask(guid) else {
                return ProjectileSupply::default();
            };
            if mask.intersects(EquipMask::MISSILE_WEAPON) {
                assert!(
                    weapon.replace(guid).is_none(),
                    "Multiple equipped missile weapons"
                );
            }
            if mask.intersects(EquipMask::MISSILE_AMMO) {
                assert!(
                    ammunition.replace(guid).is_none(),
                    "Multiple equipped ammunition sources"
                );
            }
        }
        let Some(weapon) = weapon else {
            return ProjectileSupply::NotApplicable;
        };
        let Some(weapon) = self
            .entities
            .get(weapon)
            .filter(|entity| entity.item_type().is_some())
        else {
            return ProjectileSupply::default();
        };
        if weapon.combat_use() != Some(CombatUse::Missile as u32) {
            return ProjectileSupply::NotApplicable;
        }
        let source = if weapon.ammo_type().is_some_and(|ammo| ammo != 0) {
            let Some(ammunition) = ammunition else {
                return ProjectileSupply::Finite { count: 0 };
            };
            let Some(entity) = self
                .entities
                .get(ammunition)
                .filter(|entity| entity.item_type().is_some())
            else {
                return ProjectileSupply::default();
            };
            entity
        } else {
            weapon
        };
        match source
            .properties
            .bools
            .get(&PropertyBool::UnlimitedUse)
            .copied()
        {
            Some(true) => ProjectileSupply::Unlimited,
            Some(false) => ProjectileSupply::Finite {
                count: source.stack_size(),
            },
            None => ProjectileSupply::Pending {
                appraisal: Some(source.guid),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::entity::Entity;
    use holtburger_common::properties::{ItemType, PropertyInt};
    use holtburger_protocol::messages::IdentifyObjectResponseEventData;

    const PLAYER: Guid = Guid(1);
    const WEAPON: Guid = Guid(2);
    const AMMO: Guid = Guid(3);

    fn world(ammo_type: Option<i32>) -> WorldState {
        let mut world = WorldState::synthetic();
        world.seed_local_player_entity(PLAYER, "Player", Default::default());
        world.storage.replace_contents(PLAYER, &[]);
        let mut weapon = Entity::new(WEAPON, "Missile weapon".into(), Default::default());
        weapon.properties.ints.insert(
            PropertyInt::ItemType,
            ItemType::MISSILE_WEAPON.bits() as i32,
        );
        weapon
            .properties
            .ints
            .insert(PropertyInt::CombatUse, CombatUse::Missile as i32);
        if let Some(ammo_type) = ammo_type {
            weapon
                .properties
                .ints
                .insert(PropertyInt::AmmoType, ammo_type);
        }
        world.entities.insert(weapon);
        world
            .storage
            .equip(WEAPON, PLAYER, Some(EquipMask::MISSILE_WEAPON));
        world
    }

    fn appraise(world: &mut WorldState, guid: Guid, success: bool, unlimited: Option<bool>) {
        let mut response = IdentifyObjectResponseEventData {
            object_guid: guid,
            success,
            ..Default::default()
        };
        if let Some(unlimited) = unlimited {
            response
                .properties
                .bools
                .insert(PropertyBool::UnlimitedUse, unlimited);
        }
        world
            .entities
            .get_mut(guid)
            .unwrap()
            .apply_identify_response(&response);
    }

    #[test]
    fn separate_ammunition_for_bows_crossbows_and_atlatls_tracks_only_equipped_supply() {
        // ACE AmmoType: Arrow=1, Bolt=2, Atlatl=4; these are wire inputs, not UI tuning.
        for ammo_type in [1, 2, 4] {
            let mut world = world(Some(ammo_type));
            assert_eq!(
                world.projectile_supply(),
                ProjectileSupply::Finite { count: 0 }
            );
            let mut ammo = Entity::new(AMMO, "Ammunition".into(), Default::default());
            ammo.properties.ints.insert(
                PropertyInt::ItemType,
                ItemType::MISSILE_WEAPON.bits() as i32,
            );
            ammo.properties.ints.insert(PropertyInt::StackSize, 147);
            world.entities.insert(ammo);
            world
                .storage
                .equip(AMMO, PLAYER, Some(EquipMask::MISSILE_AMMO));
            assert_eq!(
                world.projectile_supply(),
                ProjectileSupply::Pending {
                    appraisal: Some(AMMO)
                }
            );
            appraise(&mut world, AMMO, true, None);
            assert_eq!(
                world.projectile_supply(),
                ProjectileSupply::Finite { count: 147 }
            );
            world
                .entities
                .get_mut(AMMO)
                .unwrap()
                .properties
                .ints
                .insert(PropertyInt::StackSize, 146);
            assert_eq!(
                world.projectile_supply(),
                ProjectileSupply::Finite { count: 146 }
            );
            world.storage.withdraw(AMMO);
            assert_eq!(
                world.projectile_supply(),
                ProjectileSupply::Finite { count: 0 }
            );
        }
    }

    #[test]
    fn throws_require_confirmed_consumption_and_include_single_items() {
        let mut world = world(None);
        assert_eq!(
            world.projectile_supply(),
            ProjectileSupply::Pending {
                appraisal: Some(WEAPON)
            }
        );
        appraise(&mut world, WEAPON, false, None);
        assert_eq!(
            world.projectile_supply(),
            ProjectileSupply::Pending {
                appraisal: Some(WEAPON)
            }
        );
        appraise(&mut world, WEAPON, true, None);
        assert_eq!(
            world.projectile_supply(),
            ProjectileSupply::Finite { count: 1 }
        );
        world
            .entities
            .get_mut(WEAPON)
            .unwrap()
            .properties
            .ints
            .insert(PropertyInt::StackSize, 12);
        assert_eq!(
            world.projectile_supply(),
            ProjectileSupply::Finite { count: 12 }
        );
        appraise(&mut world, WEAPON, true, Some(true));
        assert_eq!(world.projectile_supply(), ProjectileSupply::Unlimited);
        // A new successful assessment replaces the old true flag even when omitted.
        appraise(&mut world, WEAPON, true, None);
        assert_eq!(
            world.projectile_supply(),
            ProjectileSupply::Finite { count: 12 }
        );
        world.storage.withdraw(WEAPON);
        assert_eq!(world.projectile_supply(), ProjectileSupply::NotApplicable);
    }

    #[test]
    fn incomplete_equipment_never_claims_empty_supply() {
        assert_eq!(
            WorldState::synthetic().projectile_supply(),
            ProjectileSupply::default()
        );
        let mut world = world(Some(1));
        world.storage.equip(AMMO, PLAYER, None);
        assert_eq!(world.projectile_supply(), ProjectileSupply::default());
        world
            .storage
            .equip(AMMO, PLAYER, Some(EquipMask::MISSILE_AMMO));
        assert_eq!(world.projectile_supply(), ProjectileSupply::default());
    }
}
