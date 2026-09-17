//! Cached entity facts governing pickup/use admission and feedback.

use holtburger_common::Guid;
use holtburger_common::properties::{
    ObjectDescriptionFlag, PropertyString, Usable, WorldObjectExt, WorldObjectPropertyAccessors,
};

use crate::context::WorldContextExt;

/// Known loose object or accessible external contents eligible for a pickup attempt.
/// ACE Player_Inventory.cs:831 rejects static objects, creatures, and Stuck objects.
/// Accepted root access admits stored items; otherwise independent world placement is required;
/// burden, busy state, and other server restrictions can still reject the attempt.
pub fn pickup_candidate(world: &crate::WorldState, guid: Guid) -> Option<&crate::entity::Entity> {
    let entity = world.get_visible_entity(guid)?;
    (guid.is_dynamic_object()
        && entity.get_string_prop(PropertyString::Name).is_some()
        && entity.item_type().is_some()
        && !entity.is_creature()
        && !entity.is_stuck()
        && !world.is_owned_by_player(guid)
        && (world.is_world_container_content(guid)
            || (world.storage_location(guid).is_none()
                && entity.placement_intent == crate::EntityPlacementIntent::Independent
                && entity.position.landblock_id != Guid::NULL)))
        .then_some(entity)
}

/// Coarse world recipient admission, not a prediction of item-specific acceptance.
/// Players and non-attackable creatures follow the existing TUI recipient policy;
/// ACE Player_Inventory.cs:3190 owns approach and final give acceptance.
pub fn give_recipient_candidate(world: &crate::WorldState, guid: Guid) -> bool {
    let Some(entity) = world.get_visible_entity(guid) else {
        return false;
    };
    guid != world.player.guid
        && entity.get_string_prop(PropertyString::Name).is_some()
        && entity.item_type().is_some()
        && (entity.flags.contains(ObjectDescriptionFlag::PLAYER)
            || (entity.is_creature() && !entity.flags.contains(ObjectDescriptionFlag::ATTACKABLE)))
        && !world.is_owned_by_player(guid)
        && world.storage_location(guid).is_none()
        && entity.placement_intent == crate::EntityPlacementIntent::Independent
        && entity.position.landblock_id != Guid::NULL
}

/// A known object whose authored useability prohibits a direct Use request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EntityUseRejection {
    /// Door explicitly disallowing direct use; another activation mechanism is not guaranteed.
    Door { name: String },
    /// Other object with the explicit NO useability bit.
    Object { name: String },
}

/// Reject explicit NO useability; absent objects and unspecified useability supply no rejection.
pub fn entity_use_rejection(
    world: &impl WorldContextExt,
    guid: Guid,
) -> Option<EntityUseRejection> {
    let entity = world.get_entity(guid)?;
    // ItemUses::IsUseable tests only NO (acclient.c:286680-286683). Missing public useability
    // initializes to UNDEF, not NO. Lock state is a separate server-owned activation constraint.
    if entity.usable_flags().allows_direct_use() {
        return None;
    }
    let name = entity.name().to_owned();
    Some(if entity.flags.contains(ObjectDescriptionFlag::DOOR) {
        EntityUseRejection::Door { name }
    } else {
        EntityUseRejection::Object { name }
    })
}

/// Local use understanding, without deciding how a frontend presents concurrent notices.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EntityUseFeedback {
    /// Retail describes using a creature as approaching it, regardless of current distance.
    Approaching { name: String },
    /// Progress for an object use; the server owns lock and access failures.
    Using {
        /// Authoritative target name captured for this command.
        name: String,
    },
}

/// Describe the proven non-targeted retail Use path; this never authorizes or rejects a command.
pub fn describe_entity_use(world: &impl WorldContextExt, guid: Guid) -> Option<EntityUseFeedback> {
    let entity = world.get_entity(guid)?;
    let usable = entity.usable_flags();
    // acclient.c:286680,286703,383329: usable source, no target mask. Missing public useability
    // initializes to USEABLE_UNDEF (0) in PublicWeenieDesc, acclient.c:449683.
    if usable.contains(Usable::NO) || !usable.target_flags().is_empty() {
        return None;
    }
    let name = entity.name().to_owned();
    // acclient.c:413273's vtable slot 11 is IsCreature (acclient.h:21281), implemented via
    // ITEM_TYPE::CREATURE at acclient.c:418067. Creatures never receive the locked notice.
    if entity.is_creature() {
        return Some(EntityUseFeedback::Approaching { name });
    }
    // RETAIL DIVERGENCE: acclient.c:413273 emits a locked notice from missing OPENABLE.
    // ACE key/lockpick updates Locked without refreshing that flag. Census: direct uses of
    // non-owned pack-slot/capacity containers; creatures and owned inventory were excluded.
    // Omitting this prediction removes stale warnings; server rejection feedback still applies.
    Some(EntityUseFeedback::Using { name })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{WorldState, entity::Entity};
    use holtburger_common::{
        position::WorldPosition,
        properties::{ItemType, PropertyInt},
    };

    #[test]
    fn give_recipient_requires_known_unstored_player_or_peaceful_creature() {
        let mut world = WorldState::synthetic();
        world.player.guid = Guid(1);
        let guid = Guid(0x8000_0042);
        let mut entity = Entity::new(guid, "Recipient".into(), WorldPosition::default());
        entity.position.landblock_id = Guid(0x1234_0001);
        entity
            .properties
            .ints
            .insert(PropertyInt::ItemType, ItemType::CREATURE.bits() as i32);
        world.add_entity(entity.clone());
        assert!(give_recipient_candidate(&world, guid));
        for (flags, expected) in [
            (ObjectDescriptionFlag::ATTACKABLE, false),
            (
                ObjectDescriptionFlag::PLAYER | ObjectDescriptionFlag::ATTACKABLE,
                true,
            ),
            (ObjectDescriptionFlag::VENDOR, true),
        ] {
            entity.flags = flags;
            world.add_entity(entity.clone());
            assert_eq!(give_recipient_candidate(&world, guid), expected);
            assert_eq!(
                world
                    .client_entity_facts(guid)
                    .unwrap()
                    .unwrap()
                    .can_receive_give,
                expected
            );
        }
        world.storage.announce_container(guid, Guid(2));
        assert!(!give_recipient_candidate(&world, guid));
        world.storage.withdraw(guid);
        entity.position.landblock_id = Guid::NULL;
        world.add_entity(entity.clone());
        assert!(!give_recipient_candidate(&world, guid));
        entity.position.landblock_id = Guid(0x1234_0001);
        entity.properties.strings.0.remove(&PropertyString::Name);
        world.add_entity(entity.clone());
        assert!(!give_recipient_candidate(&world, guid));
        entity
            .properties
            .strings
            .insert(PropertyString::Name, "Self".into());
        entity.guid = world.player.guid;
        world.add_entity(entity);
        assert!(!give_recipient_candidate(&world, world.player.guid));
    }

    #[test]
    fn pickup_requires_known_loose_dynamic_non_creature_authority() {
        use holtburger_common::properties::{PropertyBool, PropertyString};
        let mut world = WorldState::synthetic();
        world.player.guid = Guid(1);
        let guid = Guid(0x8000_0042);
        let mut entity = Entity::new(guid, "Loose item".into(), WorldPosition::default());
        entity.position.landblock_id = Guid(0x1234_0001);
        entity
            .properties
            .ints
            .insert(PropertyInt::ItemType, ItemType::FOOD.bits() as i32);
        world.add_entity(entity.clone());
        assert!(pickup_candidate(&world, guid).is_some());
        assert!(
            world
                .client_entity_facts(guid)
                .expect("placement")
                .expect("known")
                .can_pick_up
        );

        // Independent counterexamples to each pickup prerequisite.
        type Mutation = fn(&mut Entity);
        let cases: [(&str, Mutation); 7] = [
            ("stuck", |item| {
                item.properties.bools.insert(PropertyBool::Stuck, true);
            }),
            ("creature", |item| {
                item.properties
                    .ints
                    .insert(PropertyInt::ItemType, ItemType::CREATURE.bits() as i32);
            }),
            ("unknown type", |item| {
                item.properties.ints.0.remove(&PropertyInt::ItemType);
            }),
            ("unknown name", |item| {
                item.properties.strings.0.remove(&PropertyString::Name);
            }),
            ("unplaced", |item| {
                item.position.landblock_id = Guid::NULL;
            }),
            ("withdrawn", |item| {
                item.placement_intent = crate::EntityPlacementIntent::Withdrawn;
            }),
            ("static", |item| {
                item.guid = Guid(0x7000_0042);
            }),
        ];
        for (label, mutate) in cases {
            let mut candidate = entity.clone();
            mutate(&mut candidate);
            let target = candidate.guid;
            world.add_entity(candidate);
            assert!(pickup_candidate(&world, target).is_none(), "{label}");
        }
        world.add_entity(entity);
        world.storage.announce_container(guid, Guid(2));
        assert!(
            pickup_candidate(&world, guid).is_none(),
            "another object's contained item"
        );
        world.storage.withdraw(guid);
        assert!(pickup_candidate(&world, guid).is_some());
        world.storage.equip(
            guid,
            Guid(2),
            Some(holtburger_common::properties::EquipMask::MELEE_WEAPON),
        );
        assert!(
            pickup_candidate(&world, guid).is_none(),
            "equipped by another creature"
        );
        world.storage.withdraw(guid);
        world.storage.announce_container(guid, world.player.guid);
        assert!(pickup_candidate(&world, guid).is_none(), "owned item");
    }

    #[test]
    fn use_progress_is_independent_of_cached_lock_flags_and_ownership() {
        let mut world = WorldState::synthetic();
        world.player.guid = Guid(1);
        let guid = Guid(7);
        let mut entity = Entity::new(guid, "Chest".into(), WorldPosition::default());
        entity
            .flags
            .insert(ObjectDescriptionFlag::REQUIRES_PACK_SLOT);
        entity
            .properties
            .ints
            .insert(PropertyInt::ItemUseable, Usable::REMOTE.bits() as i32);
        world.add_entity(entity.clone());
        assert_eq!(
            describe_entity_use(&world, guid),
            Some(EntityUseFeedback::Using {
                name: "Chest".into(),
            })
        );
        world.storage.announce_container(guid, world.player.guid);
        assert_eq!(
            describe_entity_use(&world, guid),
            Some(EntityUseFeedback::Using {
                name: "Chest".into(),
            })
        );
        world.storage.withdraw(guid);
        entity.flags.insert(ObjectDescriptionFlag::OPENABLE);
        world.add_entity(entity.clone());
        assert_eq!(
            describe_entity_use(&world, guid),
            Some(EntityUseFeedback::Using {
                name: "Chest".into(),
            })
        );
        entity.flags.remove(ObjectDescriptionFlag::OPENABLE);
        entity
            .properties
            .ints
            .insert(PropertyInt::ItemType, ItemType::CREATURE.bits() as i32);
        world.add_entity(entity.clone());
        assert_eq!(
            describe_entity_use(&world, guid),
            Some(EntityUseFeedback::Approaching {
                name: "Chest".into()
            })
        );
        entity.properties.ints.insert(
            PropertyInt::ItemUseable,
            Usable::SOURCE_CONTAINED_TARGET_REMOTE.bits() as i32,
        );
        world.add_entity(entity);
        assert_eq!(describe_entity_use(&world, guid), None);
    }

    #[test]
    fn use_progress_requires_a_known_directly_usable_object() {
        let mut world = WorldState::synthetic();
        let guid = Guid(7);
        let mut entity = Entity::new(guid, "Door".into(), WorldPosition::default());
        entity.flags = ObjectDescriptionFlag::DOOR;
        world.add_entity(entity.clone());
        assert_eq!(
            describe_entity_use(&world, guid),
            Some(EntityUseFeedback::Using {
                name: "Door".into(),
            })
        );
        entity.flags = ObjectDescriptionFlag::empty();
        entity
            .properties
            .ints
            .insert(PropertyInt::ContainersCapacity, 2);
        world.add_entity(entity.clone());
        assert_eq!(
            describe_entity_use(&world, guid),
            Some(EntityUseFeedback::Using {
                name: "Door".into(),
            })
        );
        entity
            .properties
            .ints
            .insert(PropertyInt::ItemUseable, Usable::NO.bits() as i32);
        world.add_entity(entity);
        assert_eq!(describe_entity_use(&world, guid), None);
        assert_eq!(describe_entity_use(&world, Guid(8)), None);
    }
}
