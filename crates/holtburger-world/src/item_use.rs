//! Public item-use semantics. Confirmation and targeting gestures belong to frontends.

use holtburger_common::{
    Guid,
    properties::{
        ItemType, ObjectDescriptionFlag, PropertyString, WorldObjectExt,
        WorldObjectPropertyAccessors,
    },
};
use serde::{Deserialize, Serialize};

use crate::{context::WorldContextExt, entity::Entity};

/// Authored use shape, independent of the current target and character busy state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ItemUseCapability {
    /// Required public description facts have not arrived.
    Unavailable,
    /// Public useability explicitly disallows use.
    Unsupported,
    /// Use the source without a second object.
    Direct,
    /// A separate compatible target is required.
    Targeted,
}

/// Classify from public semantics without restricting bindings to an item-type allowlist.
pub fn item_use_capability(entity: &Entity) -> ItemUseCapability {
    if entity.get_string_prop(PropertyString::Name).is_none() || entity.item_type().is_none() {
        return ItemUseCapability::Unavailable;
    }
    let usable = entity.usable_flags();
    if !usable.allows_direct_use() {
        ItemUseCapability::Unsupported
    } else if !usable.target_flags().is_empty() {
        if entity.target_item_type().is_some() && !usable.target_flags().location_flags().is_empty()
        {
            ItemUseCapability::Targeted
        } else {
            ItemUseCapability::Unavailable
        }
    } else {
        ItemUseCapability::Direct
    }
}

/// One explicit use operation; target selection and diagnostic policy are frontend decisions.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum ItemUseIntent {
    /// Ordinary non-targeted use; unrestricted retains the existing diagnostic override.
    Direct { source: Guid, unrestricted: bool },
    /// Use a source on exactly this target, regardless of later selection changes.
    Targeted { source: Guid, target: Guid },
}

/// Semantic execution precondition, not evidence that a user saw or accepted a question.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum ItemUseConsequence {
    /// No known destructive mana-drain consequence; normal consumption may still occur.
    Ordinary,
    /// Draining consumes one unit of the target, including a whole non-stackable item.
    DestroyItem { target: Guid, amount: u32 },
}

/// Evaluated facts supplied to frontend policy; only destruction has an affected name.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum ItemUseEvaluation {
    /// No known destructive mana drain.
    Ordinary,
    /// One unit of the named target is destroyed by draining it.
    DestroyItem {
        target: Guid,
        amount: u32,
        name: String,
    },
}

impl ItemUseEvaluation {
    /// Strip display-only facts before checking an execution expectation.
    pub fn consequence(&self) -> ItemUseConsequence {
        match self {
            Self::Ordinary => ItemUseConsequence::Ordinary,
            Self::DestroyItem { target, amount, .. } => ItemUseConsequence::DestroyItem {
                target: *target,
                amount: *amount,
            },
        }
    }
}

/// Evaluate cached compatibility and known consequences; the server still decides success.
pub fn evaluate_item_use(
    world: &impl WorldContextExt,
    intent: &ItemUseIntent,
) -> Result<ItemUseEvaluation, String> {
    let source = match intent {
        ItemUseIntent::Direct { source, .. } | ItemUseIntent::Targeted { source, .. } => *source,
    };
    let entity = world
        .get_entity(source)
        .ok_or("Source item is unavailable.")?;
    let capability = item_use_capability(entity);
    match intent {
        ItemUseIntent::Direct { unrestricted, .. } => {
            // The override permits direct NO use only; it never converts targeted use into direct use.
            if capability == ItemUseCapability::Targeted {
                return Err("This item requires a target.".into());
            }
            if capability == ItemUseCapability::Unavailable {
                return Err("Source item description is unavailable.".into());
            }
            if !unrestricted && !world.can_use(source) {
                return Err("This item cannot be used from its current location.".into());
            }
        }
        ItemUseIntent::Targeted { target, .. } => {
            if capability != ItemUseCapability::Targeted {
                return Err("This item does not support targeted use.".into());
            }
            let affected = world
                .get_entity(*target)
                .ok_or("Target item is unavailable.")?;
            if !world.can_use_with(source, *target) {
                return Err("This item cannot be used on that target.".into());
            }
            // Retail acclient.c:414615-414655 uses public MANA_STONE and magical effect bit 1,
            // not assessment-only mana totals. ACE ManaStone.cs broadcasts this effect on charge changes.
            if entity
                .item_type()
                .is_some_and(|kind| kind.intersects(ItemType::MANA_STONE))
                && entity.ui_effects().unwrap_or(0) & 1 == 0
            {
                if Some(*target) == world.get_player_guid() {
                    return Err("An empty mana stone cannot be used on yourself.".into());
                }
                if !world.is_owned_by_player(*target) {
                    return Err("Mana stones can only drain items you own.".into());
                }
                if affected.flags.contains(ObjectDescriptionFlag::RETAINED) {
                    return Err("A retained item cannot be drained.".into());
                }
                return Ok(ItemUseEvaluation::DestroyItem {
                    target: *target,
                    amount: 1,
                    name: affected.name().to_owned(),
                });
            }
        }
    }
    Ok(ItemUseEvaluation::Ordinary)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::WorldState;
    use holtburger_common::{
        position::WorldPosition,
        properties::{PropertyInt, Usable},
    };

    fn item(id: u32, kind: ItemType, usable: Usable) -> Entity {
        let mut entity = Entity::new(Guid(id), format!("Item {id}"), WorldPosition::default());
        entity
            .properties
            .ints
            .insert(PropertyInt::ItemType, kind.bits() as i32);
        entity
            .properties
            .ints
            .insert(PropertyInt::ItemUseable, usable.bits() as i32);
        entity
    }

    fn targeted_world(kind: ItemType, effects: Option<i32>) -> WorldState {
        let mut world = WorldState::synthetic();
        world.player.guid = Guid(1);
        world.add_entity(item(1, ItemType::CREATURE, Usable::NO));
        let mut source = item(2, kind, Usable::SOURCE_CONTAINED_TARGET_SELF_OR_CONTAINED);
        source.properties.ints.insert(
            PropertyInt::TargetType,
            (ItemType::CREATURE | ItemType::ARMOR).bits() as i32,
        );
        if let Some(effects) = effects {
            source
                .properties
                .ints
                .insert(PropertyInt::UiEffects, effects);
        }
        world.add_entity(source);
        world.add_entity(item(3, ItemType::ARMOR, Usable::NO));
        world.storage.announce_container(Guid(2), Guid(1));
        world.storage.announce_container(Guid(3), Guid(1));
        world
    }

    #[test]
    fn direct_capability_does_not_depend_on_current_location() {
        let mut world = WorldState::synthetic();
        world.player.guid = Guid(1);
        let food = item(2, ItemType::FOOD, Usable::CONTAINED);
        assert_eq!(item_use_capability(&food), ItemUseCapability::Direct);
        world.add_entity(food);
        let intent = ItemUseIntent::Direct {
            source: Guid(2),
            unrestricted: false,
        };
        assert!(evaluate_item_use(&world, &intent).is_err());
        world.storage.announce_container(Guid(2), Guid(1));
        assert_eq!(
            evaluate_item_use(&world, &intent).unwrap().consequence(),
            ItemUseConsequence::Ordinary
        );
    }

    #[test]
    fn undefined_useability_is_direct_but_no_is_unsupported() {
        assert_eq!(
            item_use_capability(&item(2, ItemType::FOOD, Usable::empty())),
            ItemUseCapability::Direct
        );
        assert_eq!(
            item_use_capability(&item(2, ItemType::FOOD, Usable::NO)),
            ItemUseCapability::Unsupported
        );
        let incomplete = item(
            2,
            ItemType::MANA_STONE,
            Usable::SOURCE_CONTAINED_TARGET_SELF_OR_CONTAINED,
        );
        assert_eq!(
            item_use_capability(&incomplete),
            ItemUseCapability::Unavailable
        );
    }

    #[test]
    fn public_magical_effect_distinguishes_drain_from_recharge() {
        let intent = ItemUseIntent::Targeted {
            source: Guid(2),
            target: Guid(3),
        };
        for effects in [None, Some(0), Some(2)] {
            let world = targeted_world(ItemType::MANA_STONE, effects);
            assert_eq!(
                evaluate_item_use(&world, &intent).unwrap(),
                ItemUseEvaluation::DestroyItem {
                    target: Guid(3),
                    amount: 1,
                    name: "Item 3".into()
                }
            );
        }
        let charged = targeted_world(ItemType::MANA_STONE, Some(1));
        assert_eq!(
            evaluate_item_use(&charged, &intent).unwrap().consequence(),
            ItemUseConsequence::Ordinary
        );
        assert!(
            evaluate_item_use(
                &charged,
                &ItemUseIntent::Targeted {
                    source: Guid(2),
                    target: Guid(1)
                }
            )
            .is_ok()
        );
    }

    #[test]
    fn invalid_drain_targets_do_not_produce_a_destructive_evaluation() {
        let mut world = targeted_world(ItemType::MANA_STONE, None);
        assert!(
            evaluate_item_use(
                &world,
                &ItemUseIntent::Targeted {
                    source: Guid(2),
                    target: Guid(1)
                }
            )
            .is_err()
        );
        let mut retained = item(3, ItemType::ARMOR, Usable::NO);
        retained.flags.insert(ObjectDescriptionFlag::RETAINED);
        world.add_entity(retained);
        assert!(
            evaluate_item_use(
                &world,
                &ItemUseIntent::Targeted {
                    source: Guid(2),
                    target: Guid(3)
                }
            )
            .is_err()
        );
        assert!(
            evaluate_item_use(
                &world,
                &ItemUseIntent::Targeted {
                    source: Guid(2),
                    target: Guid(99)
                }
            )
            .is_err()
        );
    }

    #[test]
    fn player_target_requires_creature_mask_even_when_self_location_is_allowed() {
        let mut world = targeted_world(ItemType::MISC, None);
        let intent = ItemUseIntent::Targeted {
            source: Guid(2),
            target: Guid(1),
        };
        let mut source = world.entities.get(Guid(2)).unwrap().clone();
        source
            .properties
            .ints
            .insert(PropertyInt::TargetType, ItemType::ARMOR.bits() as i32);
        world.add_entity(source.clone());
        assert!(evaluate_item_use(&world, &intent).is_err());
        source
            .properties
            .ints
            .insert(PropertyInt::TargetType, ItemType::CREATURE.bits() as i32);
        world.add_entity(source);
        assert_eq!(
            evaluate_item_use(&world, &intent).unwrap(),
            ItemUseEvaluation::Ordinary
        );
    }

    #[test]
    fn non_mana_tools_use_target_semantics_without_a_destructive_consequence() {
        let world = targeted_world(ItemType::MISC, None);
        assert_eq!(
            evaluate_item_use(
                &world,
                &ItemUseIntent::Targeted {
                    source: Guid(2),
                    target: Guid(1)
                }
            )
            .unwrap(),
            ItemUseEvaluation::Ordinary
        );
    }

    #[test]
    fn targeted_source_cannot_use_the_direct_diagnostic_override() {
        let world = targeted_world(ItemType::MANA_STONE, None);
        assert!(
            evaluate_item_use(
                &world,
                &ItemUseIntent::Direct {
                    source: Guid(2),
                    unrestricted: true
                }
            )
            .is_err()
        );
    }
}
