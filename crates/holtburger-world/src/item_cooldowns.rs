//! Shared item cooldown definitions and player-owned group timers.

use std::{collections::BTreeMap, time::Instant};

use holtburger_common::properties::{PropertyFloat, PropertyInt, WorldObjectPropertyAccessors};
use serde::{Deserialize, Serialize};

use crate::enchantments::{EnchantmentKind, EnchantmentObservation};

/// Item properties are independently disclosed; missing duration still permits a countdown.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemCooldownDefinition {
    /// Shared group used to look up the player's timer, absent for duration-only appraisal.
    pub group_id: Option<u32>,
    /// Configured seconds after use, consumed by inspection and percentage overlays.
    pub duration_seconds: Option<f64>,
}

impl ItemCooldownDefinition {
    /// Read the same definition from a live entity or an appraisal source.
    pub fn from_properties(properties: &impl WorldObjectPropertyAccessors) -> Option<Self> {
        let group_id = properties
            .get_int_prop(PropertyInt::SharedCooldown)
            .filter(|value| *value > 0)
            .map(|value| value as u32);
        let duration_seconds = properties.get_float_prop(PropertyFloat::CooldownDuration);
        (group_id.is_some() || duration_seconds.is_some()).then_some(Self {
            group_id,
            duration_seconds,
        })
    }
}

/// One selected server timer per group, sampled at the enclosing snapshot's receipt clock.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupCooldown {
    /// ACE encodes the shared group in the low fifteen bits of the cooldown spell ID.
    pub group_id: u32,
    /// Seconds left at snapshot time; zero remains harmless until server removal arrives.
    pub remaining_seconds: f64,
}

/// Select group timers once, keeping frontend lookups independent of wire layering.
pub(crate) fn resolve_cooldowns(
    observations: &[EnchantmentObservation],
    now: Instant,
) -> Vec<GroupCooldown> {
    let mut groups = BTreeMap::new();
    for observation in observations {
        if EnchantmentKind::from_wire(&observation.enchantment).is_some() {
            continue;
        }
        let Some(remaining_seconds) = observation.remaining_seconds(now) else {
            continue;
        };
        let group_id = u32::from(observation.enchantment.spell_id & 0x7fff);
        // Retail acclient.c:426298-426326 returns the first matching registry record,
        // including an expired record pending removal; it does not compare layers.
        // ACE normally uses layer one (EnchantmentManager.cs:302), but the wire permits
        // several layers. Resolve that ambiguity here so every frontend agrees.
        groups.entry(group_id).or_insert(GroupCooldown {
            group_id,
            remaining_seconds,
        });
    }
    groups.into_values().collect()
}

/// Query a received snapshot without mutating the authoritative registry or its clocks.
pub fn remaining_seconds(
    definition: &ItemCooldownDefinition,
    cooldowns: &[GroupCooldown],
    elapsed_seconds: f64,
) -> Option<f64> {
    let group_id = definition.group_id?;
    cooldowns
        .iter()
        .find(|cooldown| cooldown.group_id == group_id)
        .map(|cooldown| (cooldown.remaining_seconds - elapsed_seconds).max(0.0))
        .filter(|seconds| *seconds > 0.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    use holtburger_common::{Guid, properties::WorldObjectPropertyAccessorsMut};
    use holtburger_protocol::messages::magic::Enchantment;

    use crate::{
        enchantments::{EnchantmentRules, resolve_enchantments},
        entity::Entity,
    };

    #[test]
    fn independently_disclosed_definition_survives_appraisal_and_missing_duration() {
        let mut entity = Entity::new(Guid(1), "Essence".into(), Default::default());
        assert_eq!(ItemCooldownDefinition::from_properties(&entity), None);
        entity.set_float_prop(PropertyFloat::CooldownDuration, 45.0);
        assert_eq!(
            ItemCooldownDefinition::from_properties(&entity),
            Some(ItemCooldownDefinition {
                group_id: None,
                duration_seconds: Some(45.0),
            })
        );
        entity.set_int_prop(PropertyInt::SharedCooldown, 213);
        let definition = ItemCooldownDefinition::from_properties(&entity).unwrap();
        assert_eq!(definition.group_id, Some(213));
        let titles = holtburger_content::CharacterTitleCatalog::default();
        let inspection = crate::inspection::ObjectInspection::from_entity(
            &entity,
            crate::inspection::InspectionContext::new(&titles),
        )
        .unwrap();
        let crate::inspection::ObjectInspectionDetails::Item(item) = inspection.details else {
            panic!("item inspection");
        };
        assert_eq!(item.cooldown, Some(definition));
    }

    #[test]
    fn registry_snapshot_ages_shared_groups_without_item_local_timers() {
        let received_at = Instant::now();
        let observations = [EnchantmentObservation {
            enchantment: Enchantment {
                spell_id: 0x8000 | 213,
                layer: 1,
                duration: 45.0,
                start_time: -10.0,
                ..Default::default()
            },
            received_at,
        }];
        let resolved = resolve_enchantments(
            &observations,
            &EnchantmentRules::default(),
            received_at + Duration::from_secs(5),
        );
        assert!(resolved.instances.is_empty());
        assert_eq!(
            resolved.cooldowns,
            vec![GroupCooldown {
                group_id: 213,
                remaining_seconds: 30.0
            }]
        );
        for duration_seconds in [Some(45.0), Some(90.0), None] {
            let item = ItemCooldownDefinition {
                group_id: Some(213),
                duration_seconds,
            };
            assert_eq!(
                remaining_seconds(&item, &resolved.cooldowns, 7.0),
                Some(23.0)
            );
            assert_eq!(remaining_seconds(&item, &resolved.cooldowns, 30.0), None);
        }
        assert_eq!(
            remaining_seconds(
                &ItemCooldownDefinition {
                    group_id: Some(1000),
                    duration_seconds: Some(15.0)
                },
                &resolved.cooldowns,
                0.0,
            ),
            None
        );
    }

    #[test]
    fn group_selection_uses_the_first_registry_layer_until_server_removal() {
        let now = Instant::now();
        let first = EnchantmentObservation {
            enchantment: Enchantment {
                spell_id: 0x8000 | 213,
                layer: 1,
                duration: 45.0,
                start_time: -45.0,
                ..Default::default()
            },
            received_at: now,
        };
        let second = EnchantmentObservation {
            enchantment: Enchantment {
                layer: 2,
                start_time: -10.0,
                ..first.enchantment
            },
            received_at: now,
        };
        assert_eq!(
            resolve_cooldowns(&[first, second], now),
            vec![GroupCooldown {
                group_id: 213,
                remaining_seconds: 0.0,
            }]
        );
        assert_eq!(
            resolve_cooldowns(&[second], now),
            vec![GroupCooldown {
                group_id: 213,
                remaining_seconds: 35.0,
            }]
        );
    }
}
