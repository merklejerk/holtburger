//! Cached entity facts governing use admission and feedback.

use holtburger_common::Guid;
use holtburger_common::properties::{ObjectDescriptionFlag, Usable, WorldObjectExt};

use crate::context::WorldContextExt;

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
    /// An object use may also have a specific cached container notice.
    Using {
        /// Authoritative target name captured for this command.
        name: String,
        /// Non-owned, non-creature container lacking the cached Openable flag.
        locked_container: bool,
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
    // acclient.c:210543: RequiresPackSlot or either capacity. IDA prints the 0x00800000 mask as
    // aActivationType; statics.txt:9005 proves that symbol's address. Doors alone are not containers.
    let container = entity
        .flags
        .contains(ObjectDescriptionFlag::REQUIRES_PACK_SLOT)
        || entity.items_capacity().is_some_and(|capacity| capacity > 0)
        || entity
            .containers_capacity()
            .is_some_and(|capacity| capacity > 0);
    let locked_container = container
        && !world.is_owned_by_player(guid)
        && !entity.flags.contains(ObjectDescriptionFlag::OPENABLE);
    Some(EntityUseFeedback::Using {
        name,
        locked_container,
    })
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
    fn container_feedback_respects_openability_ownership_targeting_and_creature_exception() {
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
                locked_container: true
            })
        );
        world.storage.announce_container(guid, world.player.guid);
        assert_eq!(
            describe_entity_use(&world, guid),
            Some(EntityUseFeedback::Using {
                name: "Chest".into(),
                locked_container: false
            })
        );
        world.storage.withdraw(guid);
        entity.flags.insert(ObjectDescriptionFlag::OPENABLE);
        world.add_entity(entity.clone());
        assert_eq!(
            describe_entity_use(&world, guid),
            Some(EntityUseFeedback::Using {
                name: "Chest".into(),
                locked_container: false
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
    fn capacity_only_containers_get_feedback_but_locked_doors_do_not_inherit_the_rule() {
        let mut world = WorldState::synthetic();
        let guid = Guid(7);
        let mut entity = Entity::new(guid, "Door".into(), WorldPosition::default());
        entity.flags = ObjectDescriptionFlag::DOOR;
        world.add_entity(entity.clone());
        assert_eq!(
            describe_entity_use(&world, guid),
            Some(EntityUseFeedback::Using {
                name: "Door".into(),
                locked_container: false
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
                locked_container: true
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
