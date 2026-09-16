//! Contact edges retire obsolete actions without executing skipped animation hooks.
use super::*;
use holtburger_common::properties::{ItemType, PhysicsState, PropertyInt};

#[test]
fn support_edges_interrupt_cast_backlog_without_replaying_hooks() {
    let mut cast = animation(ACTION_ANIM, 4, 0.25);
    cast.part_frames[1].hooks.push(AnimationHook {
        hook_type: 6,
        direction: 1,
        payload: AnimationHookPayload::Ethereal(EtherealHookPayload { ethereal: true }),
    });
    let catalog = catalog_with_action_animation(STAND, 10.0, cast);
    let table = catalog.table(0x0900_0001).unwrap();
    let guid = holtburger_common::Guid(1);
    for (previous, current, creature, gravity, interrupted) in [
        (
            ContactState::Grounded,
            ContactState::Airborne,
            true,
            true,
            true,
        ),
        (
            ContactState::Airborne,
            ContactState::Grounded,
            true,
            true,
            true,
        ),
        (
            ContactState::Grounded,
            ContactState::Sliding,
            true,
            true,
            true,
        ),
        (
            ContactState::Sliding,
            ContactState::Grounded,
            true,
            true,
            true,
        ),
        (
            ContactState::Grounded,
            ContactState::Grounded,
            true,
            true,
            false,
        ),
        (
            ContactState::Airborne,
            ContactState::Sliding,
            true,
            true,
            false,
        ),
        (
            ContactState::Unknown,
            ContactState::Grounded,
            true,
            true,
            false,
        ),
        (
            ContactState::Grounded,
            ContactState::Airborne,
            false,
            true,
            false,
        ),
        (
            ContactState::Grounded,
            ContactState::Airborne,
            true,
            false,
            false,
        ),
    ] {
        let mut world = crate::WorldState::synthetic();
        let mut entity = crate::entity::Entity::new(
            guid,
            "Caster".into(),
            holtburger_common::position::WorldPosition {
                landblock_id: holtburger_common::Guid(0x1234_0000),
                ..Default::default()
            },
        );
        entity.set_int_prop(
            PropertyInt::ItemType,
            if creature {
                ItemType::CREATURE.bits() as i32
            } else {
                0
            },
        );
        entity
            .physics
            .reconcile(crate::resolve_effective_entity_physics_state(if gravity {
                PhysicsState::GRAVITY
            } else {
                PhysicsState::empty()
            }));
        world.entities.insert(entity);
        world.motion_runtimes.enqueue_action(table, guid, action(1));
        world.motion_runtimes.enqueue_action(table, guid, action(2));
        world
            .motion_runtimes
            .drive(table, guid, MotionOrder::default(), 0.01);
        world.interrupt_motion_on_support_change(guid, previous, current);
        assert_eq!(
            world.motion_runtimes.get(guid).unwrap().action_count(),
            if interrupted { 0 } else { 2 }
        );
        if interrupted {
            let tick = world
                .motion_runtimes
                .drive(table, guid, MotionOrder::default(), 1.0);
            assert!(!tick.action_completed);
            assert!(tick.hooks.is_empty());
            assert_eq!(
                world
                    .motion_runtimes
                    .motion_playback(guid)
                    .and_then(|motion| motion.ordinary)
                    .map(|layer| layer.clip)
                    .unwrap()
                    .animation_id(),
                STAND_ANIM
            );
            // A later server gesture is fresh work; a repeated contact level must not retire it.
            world.motion_runtimes.enqueue_action(table, guid, action(3));
            world.interrupt_motion_on_support_change(guid, current, current);
            assert_eq!(world.motion_runtimes.get(guid).unwrap().action_count(), 1);
        }
    }
}

#[test]
fn published_contact_event_retires_existing_playback() {
    let mut world = crate::WorldState::synthetic();
    let catalog = catalog();
    let table = catalog.table(0x0900_0001).unwrap();
    let guid = holtburger_common::Guid(1);
    let mut entity = crate::entity::Entity::new(
        guid,
        "Caster".into(),
        holtburger_common::position::WorldPosition {
            landblock_id: holtburger_common::Guid(0x1234_0000),
            ..Default::default()
        },
    );
    entity.set_int_prop(PropertyInt::ItemType, ItemType::CREATURE.bits() as i32);
    entity
        .physics
        .reconcile(crate::resolve_effective_entity_physics_state(
            PhysicsState::GRAVITY,
        ));
    world.add_entity(entity);
    let event = |contact| crate::SpatialBodyEvent::ContactChanged {
        body_id: crate::SpatialBodyId::Entity(guid),
        contact,
    };
    world.apply_spatial_body_event(&event(ContactState::Grounded));
    world.motion_runtimes.enqueue_action(table, guid, action(1));
    world
        .motion_runtimes
        .drive(table, guid, MotionOrder::default(), 0.01);
    world.apply_spatial_body_event(&event(ContactState::Airborne));
    assert_eq!(world.motion_runtimes.get(guid).unwrap().action_count(), 0);
    world.motion_runtimes.enqueue_action(table, guid, action(2));
    world.apply_spatial_body_event(&event(ContactState::Airborne));
    assert_eq!(world.motion_runtimes.get(guid).unwrap().action_count(), 1);
    world.apply_spatial_body_event(&event(ContactState::Grounded));
    assert_eq!(world.motion_runtimes.get(guid).unwrap().action_count(), 0);
}
