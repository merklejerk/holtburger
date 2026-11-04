//! Last complete player appearance, published on cold accepted changes and recoverable after lag.

use super::object_preview::{ObjectPreviewSource, capture_saved_player_visual};
use holtburger_common::{
    Guid,
    properties::{PropertyDataId, PropertyFloat, PropertyUpdate},
};
use holtburger_world::{WorldEvent, WorldState, context::WorldContextExt};
use serde::{Deserialize, Serialize};

/// Immutable capture and character identity travel together through recovery and local persistence.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerVisualCapture {
    /// Endpoint scoping belongs to the frontend's launch/persistence owner.
    pub guid: Guid,
    /// Complete body and separately rendered equipment, independent of later world retention.
    pub source: Box<ObjectPreviewSource>,
}

/// A character may be known before its first complete equipment description is available.
struct TrackedPlayerVisual {
    /// The active character, including while its first complete capture is pending.
    guid: Guid,
    /// Prior complete source survives incomplete updates within this same identity.
    source: Option<Box<ObjectPreviewSource>>,
}

/// Packet-level invalidation never serializes movement or overwrites a complete capture with a partial one.
#[derive(Default)]
pub(super) struct PlayerVisualPublication {
    /// Character ownership and optional captured value have a single replacement lifetime.
    current: Option<TrackedPlayerVisual>,
    /// Cleared after one evaluation of a complete message's accepted facts.
    dirty: bool,
}

impl PlayerVisualPublication {
    pub(super) fn snapshot(&self) -> Option<PlayerVisualCapture> {
        let current = self.current.as_ref()?;
        Some(PlayerVisualCapture {
            guid: current.guid,
            source: current.source.clone()?,
        })
    }

    pub(super) fn invalidate(&mut self) {
        self.dirty = true;
    }

    pub(super) fn observe(&mut self, world: &WorldState, event: &WorldEvent) {
        let guid = match event {
            WorldEvent::PlayerInfo(data) => Some(data.entity.guid),
            WorldEvent::EntitySpawned(entity) | WorldEvent::EntityReplaced(entity) => {
                Some(entity.guid)
            }
            WorldEvent::EntityAppearanceUpdated { guid }
            | WorldEvent::EntityScenePlacementChanged { guid, .. }
            | WorldEvent::EntityDespawned { guid, .. } => Some(*guid),
            WorldEvent::PropertiesUpdated { guid, updates }
                if updates.iter().any(|update| {
                    matches!(
                        update,
                        PropertyUpdate::DataId(
                            PropertyDataId::Setup | PropertyDataId::MotionTable,
                            _
                        ) | PropertyUpdate::Float(PropertyFloat::DefaultScale, _)
                    )
                }) =>
            {
                Some(*guid)
            }
            _ => None,
        };
        if guid.is_some_and(|guid| guid == world.player.guid || world.is_owned_by_player(guid)) {
            self.invalidate();
        }
    }

    /// Run after the complete message mutation and the sole storage-change collection.
    /// Returns whether a replacement level (including retirement) must be published.
    pub(super) fn collect(&mut self, world: &WorldState, active: bool) -> bool {
        let owner = (active && world.player.guid != Guid::NULL).then_some(world.player.guid);
        let mut changed = false;
        if self.current.as_ref().map(|current| current.guid) != owner {
            changed = self
                .current
                .as_ref()
                .is_some_and(|current| current.source.is_some());
            self.current = owner.map(|guid| TrackedPlayerVisual { guid, source: None });
            self.dirty = true;
        }
        if !self.dirty {
            return changed;
        }
        self.dirty = false;
        let Some(current) = &mut self.current else {
            return changed;
        };
        let Some(source) = capture_saved_player_visual(world) else {
            return changed;
        };
        if current.source.as_deref() != Some(&source) {
            current.source = Some(Box::new(source));
            changed = true;
        }
        changed
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::properties::{EquipMask, WorldObjectPropertyAccessorsMut};
    use holtburger_common::{ParentLocation, Placement};
    use holtburger_protocol::messages::{
        GameEvent, GameEventMessage, GameMessage, InventoryPutObjInContainerEventData,
        PlayerDescriptionEventData, WieldObjectEventData,
    };
    use holtburger_world::{PhysicsAttachment, entity::Entity};

    const PLAYER: Guid = Guid(1);
    const WEAPON: Guid = Guid(2);

    fn event(event: GameEvent) -> GameMessage {
        GameMessage::GameEvent(Box::new(GameEventMessage {
            target: PLAYER,
            sequence: 0,
            event,
        }))
    }

    fn world() -> WorldState {
        let mut world = WorldState::synthetic();
        world.handle_message(&event(GameEvent::PlayerDescription(Box::new(
            PlayerDescriptionEventData {
                guid: PLAYER,
                sequence: 0,
                name: "Player".into(),
                wee_type: 1,
                pos: None,
                properties: Default::default(),
                positions: Default::default(),
                attributes: Default::default(),
                skills: Default::default(),
                enchantments: Vec::new(),
                spells: Default::default(),
                has_health: true,
                options1: Default::default(),
                options2: Default::default(),
                shortcuts: Vec::new(),
                hotbar_spells: Vec::new(),
                desired_comps: Vec::new(),
                spellbook_filters: 0,
                gameplay_options: Vec::new(),
                inventory: Vec::new(),
                equipped_objects: Vec::new(),
            },
        ))));
        let mut entity = Entity::new(PLAYER, "Player".into(), Default::default());
        entity.set_did_prop(PropertyDataId::Setup, 0x02000001.into());
        entity.set_float_prop(PropertyFloat::DefaultScale, 1.25);
        entity.set_float_prop(PropertyFloat::Translucency, 0.8);
        world.add_entity(entity);
        world
    }

    fn wield(world: &mut WorldState) {
        world.handle_message(&event(GameEvent::WieldObject(Box::new(
            WieldObjectEventData {
                object_guid: WEAPON,
                equip_mask: EquipMask::MELEE_WEAPON,
            },
        ))));
    }

    fn hydrate_weapon(world: &mut WorldState) {
        let mut weapon = Entity::new(WEAPON, "Weapon".into(), Default::default());
        weapon.set_did_prop(PropertyDataId::Setup, 0x02000002.into());
        weapon.set_attachment(Some(PhysicsAttachment {
            parent: PLAYER,
            location: ParentLocation::RightHand,
            placement: Placement::RightHandCombat,
        }));
        world.add_entity(weapon);
    }

    #[test]
    fn saved_visual_uses_server_scale_and_opaque_visibility_without_transient_script_scale() {
        let mut world = world();
        world
            .apply_entity_script_scale(PLAYER, 3.0, 0.0, 1.0)
            .unwrap();
        let mut owner = PlayerVisualPublication::default();
        assert!(owner.collect(&world, true));
        let capture = owner.snapshot().unwrap();
        assert_eq!(capture.source.body.scale, 1.25);
        assert_eq!(capture.source.body.translucency, 0.0);
        assert!(!owner.collect(&world, true));
    }

    #[test]
    fn incomplete_equipment_keeps_previous_capture_then_hydration_and_removal_replace_it() {
        let mut world = world();
        let mut owner = PlayerVisualPublication::default();
        assert!(owner.collect(&world, true));
        let previous = owner.snapshot().unwrap();
        wield(&mut world);
        owner.invalidate();
        assert!(!owner.collect(&world, true));
        assert_eq!(owner.snapshot(), Some(previous));
        hydrate_weapon(&mut world);
        owner.invalidate();
        assert!(owner.collect(&world, true));
        assert_eq!(owner.snapshot().unwrap().source.attachments.len(), 1);
        world.handle_message(&event(GameEvent::InventoryPutObjInContainer(Box::new(
            InventoryPutObjInContainerEventData {
                item_guid: WEAPON,
                container_guid: PLAYER,
                slot: 0,
                container_type: holtburger_common::properties::InventoryEntryKind::Item,
            },
        ))));
        owner.invalidate();
        assert!(owner.collect(&world, true));
        assert!(owner.snapshot().unwrap().source.attachments.is_empty());
    }

    #[test]
    fn movement_does_not_invalidate_but_server_scale_and_appearance_do() {
        let mut world = world();
        let mut owner = PlayerVisualPublication::default();
        owner.collect(&world, true);
        owner.observe(
            &world,
            &WorldEvent::EntityMoved {
                guid: PLAYER,
                pos: Default::default(),
            },
        );
        assert!(!owner.dirty);
        world
            .entities
            .get_mut(PLAYER)
            .unwrap()
            .set_float_prop(PropertyFloat::DefaultScale, 0.75);
        owner.observe(
            &world,
            &WorldEvent::PropertiesUpdated {
                guid: PLAYER,
                updates: vec![PropertyUpdate::Float(PropertyFloat::DefaultScale, 0.75)],
            },
        );
        assert!(owner.collect(&world, true));
        assert_eq!(owner.snapshot().unwrap().source.body.scale, 0.75);
        world
            .entities
            .get_mut(PLAYER)
            .unwrap()
            .appearance
            .palette_did = Some(0x04000001);
        owner.observe(
            &world,
            &WorldEvent::EntityAppearanceUpdated { guid: PLAYER },
        );
        assert!(owner.collect(&world, true));
        assert_eq!(
            owner.snapshot().unwrap().source.body.appearance.palette_did,
            Some(0x04000001)
        );
    }

    #[test]
    fn character_retirement_clears_recovery_without_destroying_the_captured_value() {
        let mut world = world();
        let mut owner = PlayerVisualPublication::default();
        owner.collect(&world, true);
        let captured = owner.snapshot().unwrap();
        assert!(owner.collect(&world, false));
        assert_eq!(owner.snapshot(), None);
        world.player.guid = Guid(3);
        assert!(!owner.collect(&world, true));
        assert_eq!(owner.snapshot(), None);
        assert_eq!(captured.guid, PLAYER);
        assert_eq!(captured.source.body.setup_did, 0x02000001);
    }

    #[test]
    fn application_snapshot_retains_capture_and_storage_only_changes_use_the_existing_collector() {
        let mut client =
            super::super::builder::build_test_client(super::super::ClientState::InWorld);
        client.world = world();
        client.publish_entity_facts();
        let baseline = client.application_snapshot().player_visual_capture.unwrap();
        wield(&mut client.world);
        // The missing item produced no hydrated entity event. Storage still invalidates capture.
        client.publish_entity_facts();
        assert_eq!(
            client.application_snapshot().player_visual_capture,
            Some(baseline)
        );
        hydrate_weapon(&mut client.world);
        let entity = client.world.entities.get(WEAPON).unwrap().clone();
        client.handle_world_event(&WorldEvent::EntitySpawned(Box::new(entity)));
        assert_eq!(
            client
                .application_snapshot()
                .player_visual_capture
                .unwrap()
                .source
                .attachments
                .len(),
            1
        );
    }
}
