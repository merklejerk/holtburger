use super::super::liveness::EntityPruneReason;
use super::super::*;
use holtburger_common::position::WorldPosition;

impl WorldState {
    /// Returns whether every object named by the player's recursive inventory closure is
    /// hydrated. This mirrors retail `AllContainedObjectsExist`: an absent nested item keeps
    /// world activation pending rather than exposing a partially materialized player.
    pub fn all_player_contained_objects_exist(&self) -> bool {
        let player_guid = self.player.guid;
        if player_guid == Guid::NULL || self.entities.get(player_guid).is_none() {
            return false;
        }

        self.storage
            .owned_items(player_guid)
            .all(|guid| self.entities.get(guid).is_some())
    }

    pub(crate) fn mark_entity_immediately_eligible_for_pruning_if_unretained(
        &mut self,
        guid: Guid,
    ) -> bool {
        let now = self.current_server_time();

        let Some(snapshot) = self.reconcile_entity_retention(guid) else {
            return false;
        };

        if snapshot.is_retained() {
            return false;
        }

        self.request_unretained_entity_prune(guid, now);
        true
    }

    pub(crate) fn clear_entity_world_presence(&mut self, guid: Guid) -> Option<WorldPosition> {
        if let Some(entity) = self.entities.get_mut(guid) {
            // Inventory/pickup authority withdraws any prior parent link as well as its body.
            entity.placement_intent = crate::EntityPlacementIntent::Withdrawn;
            let old_lb = entity.position.landblock_id;
            if old_lb == Guid::NULL {
                return None;
            }

            entity.position.landblock_id = Guid::NULL;
            let position = entity.position;
            self.retire_authoritative_body_for_guid(guid);
            Some(position)
        } else {
            None
        }
    }

    pub(super) fn emit_entity_world_presence_cleared(
        &mut self,
        guid: Guid,
        events: &mut Vec<WorldEvent>,
    ) {
        if let Some(pos) = self.clear_entity_world_presence(guid) {
            if let Some(body_id) = self.runtime_body_id_for_guid(guid) {
                Self::emit_runtime_body_removed(events, body_id);
            }
            events.push(WorldEvent::EntityMoved { guid, pos });
        }
    }

    fn set_entity_inventory_location(
        &mut self,
        guid: Guid,
        container_guid: Guid,
        wielder_guid: Guid,
        equip_mask: EquipMask,
    ) -> bool {
        let Some(entity) = self.entities.get_mut(guid) else {
            return false;
        };

        entity.set_iid_prop(PropertyInstanceId::Container, container_guid);
        entity.set_iid_prop(PropertyInstanceId::Wielder, wielder_guid);
        entity.set_int_prop(
            PropertyInt::CurrentWieldedLocation,
            equip_mask.bits() as i32,
        );

        true
    }

    fn finalize_entity_inventory_location_update(
        &mut self,
        guid: Guid,
        clear_world_presence: bool,
        updates: Vec<PropertyUpdate>,
        events: &mut Vec<WorldEvent>,
    ) {
        if clear_world_presence {
            self.emit_entity_world_presence_cleared(guid, events);
        }

        let _ = self.reconcile_entity_retention(guid);

        events.push(WorldEvent::PropertiesUpdated { guid, updates });
    }

    /// Publish immediate inventory withdrawal while lifecycle cleanup retains the description.
    pub(in super::super) fn withdraw_entity_inventory_location(
        &mut self,
        guid: Guid,
        events: &mut Vec<WorldEvent>,
    ) {
        if !self.set_entity_inventory_location(guid, Guid::NULL, Guid::NULL, EquipMask::NONE) {
            return;
        }
        self.finalize_entity_inventory_location_update(
            guid,
            true,
            vec![
                PropertyUpdate::InstanceId(PropertyInstanceId::Container, Guid::NULL),
                PropertyUpdate::InstanceId(PropertyInstanceId::Wielder, Guid::NULL),
                PropertyUpdate::Int(
                    PropertyInt::CurrentWieldedLocation,
                    EquipMask::NONE.bits() as i32,
                ),
            ],
            events,
        );
    }

    pub(crate) fn move_entity_into_container(
        &mut self,
        item_guid: Guid,
        container_guid: Guid,
        events: &mut Vec<WorldEvent>,
    ) -> bool {
        self.storage.announce_container(item_guid, container_guid);
        if !self.set_entity_inventory_location(
            item_guid,
            container_guid,
            Guid::NULL,
            EquipMask::NONE,
        ) {
            return false;
        }

        self.finalize_entity_inventory_location_update(
            item_guid,
            true,
            vec![
                PropertyUpdate::InstanceId(PropertyInstanceId::Container, container_guid),
                PropertyUpdate::InstanceId(PropertyInstanceId::Wielder, Guid::NULL),
                PropertyUpdate::Int(
                    PropertyInt::CurrentWieldedLocation,
                    EquipMask::NONE.bits() as i32,
                ),
            ],
            events,
        );

        true
    }

    pub(crate) fn move_entity_into_world(
        &mut self,
        guid: Guid,
        events: &mut Vec<WorldEvent>,
    ) -> bool {
        self.clear_entity_prune_reason(guid, EntityPruneReason::InventoryRemoval);
        self.storage.withdraw(guid);
        if !self.set_entity_inventory_location(guid, Guid::NULL, Guid::NULL, EquipMask::NONE) {
            return false;
        }

        self.finalize_entity_inventory_location_update(
            guid,
            false,
            vec![
                PropertyUpdate::InstanceId(PropertyInstanceId::Container, Guid::NULL),
                PropertyUpdate::InstanceId(PropertyInstanceId::Wielder, Guid::NULL),
                PropertyUpdate::Int(
                    PropertyInt::CurrentWieldedLocation,
                    EquipMask::NONE.bits() as i32,
                ),
            ],
            events,
        );

        true
    }

    pub(crate) fn wield_entity_for(
        &mut self,
        object_guid: Guid,
        wielder_guid: Guid,
        equip_mask: EquipMask,
        events: &mut Vec<WorldEvent>,
    ) -> bool {
        self.storage
            .equip(object_guid, wielder_guid, Some(equip_mask));
        if !self.set_entity_inventory_location(object_guid, Guid::NULL, wielder_guid, equip_mask) {
            return false;
        }

        self.finalize_entity_inventory_location_update(
            object_guid,
            true,
            vec![
                PropertyUpdate::InstanceId(PropertyInstanceId::Wielder, wielder_guid),
                PropertyUpdate::InstanceId(PropertyInstanceId::Container, Guid::NULL),
                PropertyUpdate::Int(
                    PropertyInt::CurrentWieldedLocation,
                    equip_mask.bits() as i32,
                ),
            ],
            events,
        );

        true
    }

    pub(crate) fn mark_container_preview_entities_for_prune(&mut self, item_guids: &[Guid]) {
        let now = self.current_server_time();
        for &guid in item_guids {
            self.mark_container_preview(guid);
            if self
                .retention_snapshot(guid, now)
                .is_some_and(|snapshot| snapshot.has_authoritative_retention())
            {
                self.clear_container_preview(guid);
            } else {
                // Preserve preview provenance through descriptions arriving after closure.
                self.request_unretained_entity_prune(guid, now);
            }
        }
    }
}
