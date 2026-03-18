use super::*;
use holtburger_common::math::Quaternion;
use holtburger_common::position::WorldPosition;
use holtburger_common::properties::WorldObjectExt as _;
use holtburger_protocol::messages::movement::PositionType;

impl WorldState {
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

        self.set_entity_prune_deadline(guid, now);
        true
    }

    pub(crate) fn sync_player_ownership_for_entity(&mut self, guid: Guid) {
        let Some((container_id, wielder_id, equip_mask)) = self.entities.get(guid).map(|entity| {
            (
                entity.container_id(),
                entity.wielder_id(),
                entity.wield_location(),
            )
        }) else {
            return;
        };

        let held_by_player = container_id.is_some_and(|owner_guid| {
            owner_guid == self.player.guid || self.player.inventory.contains(&owner_guid)
        });
        let wielded_by_player = wielder_id == Some(self.player.guid);

        self.update_player_inventory_recursive(guid, held_by_player || wielded_by_player);

        if wielded_by_player {
            self.player.wield_item(guid, equip_mask);
        } else {
            self.player.unwield_item(guid);
        }
    }

    pub(crate) fn emit_level_info(&self, events: &mut Vec<WorldEvent>) {
        if let Some(info) = self.get_level_info() {
            events.push(WorldEvent::LevelInfoUpdated(info));
        }
    }

    pub(crate) fn emit_player_info(
        &self,
        guid: Guid,
        name: String,
        pos: Option<WorldPosition>,
        events: &mut Vec<WorldEvent>,
    ) {
        events.push(WorldEvent::PlayerInfo(Box::new(crate::PlayerInfoData {
            guid,
            name,
            pos,
            player_entity: self.entities.get(guid).map(|entity| Box::new(entity.clone())),
            attributes: self.player.get_attributes(),
            vitals: self.player.get_vitals(),
            skills: self.player.get_skills(),
            enchantments: self.player.enchantments.clone(),
            spells: self.player.spells.keys().cloned().collect(),
            level_info: self.get_level_info().unwrap_or_default(),
            resistances: self.player.resistances(),
            armor: self.player.armor(),
            vitae: self.player.vitae(),
            spell_names: self.get_player_spell_names(),
            inventory: self.player.inventory.clone(),
            equipment: self.player.equipment.clone(),
        })));
    }

    pub(crate) fn apply_player_description_world_state(
        &mut self,
        guid: Guid,
        name: &str,
        pos: Option<WorldPosition>,
        events: &mut Vec<WorldEvent>,
    ) {
        if let Some(entity) = self.entities.get_mut(guid) {
            entity.set_string_prop(PropertyString::Name, name.to_string());
        }

        if let Some(position) = pos {
            events.extend(self.set_player_position(position));
        }

        self.emit_player_info(guid, name.to_string(), pos, events);
        self.emit_level_info(events);
    }

    pub(crate) fn update_player_inventory_recursive(&mut self, root: Guid, owned: bool) {
        let mut stack = vec![root];
        while let Some(current) = stack.pop() {
            if owned {
                self.player.add_to_inventory(current);
            } else {
                self.player.remove_from_inventory(current);
            }

            for (&guid, entity) in &self.entities.entities {
                if entity.container_id() == Some(current) {
                    stack.push(guid);
                }
            }
        }
    }

    pub(crate) fn move_entity_to_position(
        &mut self,
        guid: Guid,
        pos: WorldPosition,
        events: &mut Vec<WorldEvent>,
    ) -> bool {
        if let Some(entity) = self.entities.get_mut(guid) {
            let old_lb = entity.position.landblock_id;
            entity.position = pos;
            self.scene.update_entity(guid, old_lb, pos.landblock_id);
            events.push(WorldEvent::EntityMoved { guid, pos });
            true
        } else {
            false
        }
    }

    pub(crate) fn apply_private_position_update(
        &mut self,
        position_type: PositionType,
        position: WorldPosition,
        events: &mut Vec<WorldEvent>,
    ) {
        if position_type == PositionType::Location {
            events.extend(self.set_player_position(position));
            return;
        }

        self.player.set_position_property(position_type, position);
    }

    pub(crate) fn apply_public_position_update(
        &mut self,
        guid: Guid,
        position_type: PositionType,
        position: WorldPosition,
        events: &mut Vec<WorldEvent>,
    ) -> bool {
        if position_type == PositionType::Location {
            if guid == self.player.guid {
                events.extend(self.set_player_position(position));
                return true;
            }

            return self.move_entity_to_position(guid, position, events);
        }

        if guid == self.player.guid {
            self.player.set_position_property(position_type, position);
        }

        true
    }

    pub(crate) fn update_entity_velocity(
        &mut self,
        guid: Guid,
        velocity: Vector3,
        omega: Vector3,
        events: &mut Vec<WorldEvent>,
    ) -> bool {
        if let Some(entity) = self.entities.get_mut(guid) {
            entity.velocity = velocity;
            entity.omega = omega;
            events.push(WorldEvent::EntityVectorUpdated {
                guid,
                velocity,
                omega,
            });
            true
        } else {
            false
        }
    }

    pub(crate) fn set_entity_rotation(
        &mut self,
        guid: Guid,
        rotation: Quaternion,
        events: &mut Vec<WorldEvent>,
    ) -> bool {
        if let Some(entity) = self.entities.get_mut(guid) {
            entity.position.rotation = rotation;
            events.push(WorldEvent::EntityMoved {
                guid,
                pos: entity.position,
            });
            true
        } else {
            false
        }
    }

    pub(crate) fn clear_entity_world_presence(&mut self, guid: Guid) -> bool {
        if let Some(entity) = self.entities.get_mut(guid) {
            let old_lb = entity.position.landblock_id;
            entity.position.landblock_id = Guid::NULL;
            self.scene.remove_entity(guid, old_lb);
            true
        } else {
            false
        }
    }

    pub(crate) fn move_entity_into_container(
        &mut self,
        item_guid: Guid,
        container_guid: Guid,
        events: &mut Vec<WorldEvent>,
    ) -> bool {
        if let Some(entity) = self.entities.get_mut(item_guid) {
            entity.set_iid_prop(PropertyInstanceId::Container, container_guid);
            entity.set_iid_prop(PropertyInstanceId::Wielder, Guid::NULL);
            entity.set_int_prop(
                PropertyInt::CurrentWieldedLocation,
                EquipMask::NONE.bits() as i32,
            );
        } else {
            return false;
        }

        let _ = self.clear_entity_world_presence(item_guid);
        self.sync_player_ownership_for_entity(item_guid);
        let _ = self.reconcile_entity_retention(item_guid);

        events.push(WorldEvent::PropertiesUpdated {
            guid: item_guid,
            updates: vec![
                PropertyUpdate::InstanceId(PropertyInstanceId::Container, container_guid),
                PropertyUpdate::InstanceId(PropertyInstanceId::Wielder, Guid::NULL),
                PropertyUpdate::Int(
                    PropertyInt::CurrentWieldedLocation,
                    EquipMask::NONE.bits() as i32,
                ),
            ],
        });

        true
    }

    pub(crate) fn move_entity_into_world(
        &mut self,
        guid: Guid,
        events: &mut Vec<WorldEvent>,
    ) -> bool {
        if let Some(entity) = self.entities.get_mut(guid) {
            entity.set_iid_prop(PropertyInstanceId::Container, Guid::NULL);
            entity.set_iid_prop(PropertyInstanceId::Wielder, Guid::NULL);
            entity.set_int_prop(
                PropertyInt::CurrentWieldedLocation,
                EquipMask::NONE.bits() as i32,
            );
        } else {
            return false;
        }
        self.sync_player_ownership_for_entity(guid);
        let _ = self.reconcile_entity_retention(guid);

        events.push(WorldEvent::PropertiesUpdated {
            guid,
            updates: vec![
                PropertyUpdate::InstanceId(PropertyInstanceId::Container, Guid::NULL),
                PropertyUpdate::InstanceId(PropertyInstanceId::Wielder, Guid::NULL),
                PropertyUpdate::Int(
                    PropertyInt::CurrentWieldedLocation,
                    EquipMask::NONE.bits() as i32,
                ),
            ],
        });

        true
    }

    pub(crate) fn wield_entity_for(
        &mut self,
        object_guid: Guid,
        wielder_guid: Guid,
        equip_mask: EquipMask,
        events: &mut Vec<WorldEvent>,
    ) -> bool {
        if let Some(entity) = self.entities.get_mut(object_guid) {
            entity.set_iid_prop(PropertyInstanceId::Wielder, wielder_guid);
            entity.set_iid_prop(PropertyInstanceId::Container, Guid::NULL);
            entity.set_int_prop(
                PropertyInt::CurrentWieldedLocation,
                equip_mask.bits() as i32,
            );
        } else {
            return false;
        }

        let _ = self.clear_entity_world_presence(object_guid);
        self.sync_player_ownership_for_entity(object_guid);
        let _ = self.reconcile_entity_retention(object_guid);

        events.push(WorldEvent::PropertiesUpdated {
            guid: object_guid,
            updates: vec![
                PropertyUpdate::InstanceId(PropertyInstanceId::Wielder, wielder_guid),
                PropertyUpdate::InstanceId(PropertyInstanceId::Container, Guid::NULL),
                PropertyUpdate::Int(
                    PropertyInt::CurrentWieldedLocation,
                    equip_mask.bits() as i32,
                ),
            ],
        });

        true
    }

    pub(crate) fn resolve_property_target_guid(&self, guid: Guid) -> Guid {
        if guid == Guid::NULL {
            self.player.guid
        } else {
            guid
        }
    }

    pub(crate) fn apply_property_update_to_target(
        &mut self,
        guid: Guid,
        update: &PropertyUpdate,
        mirror_player: bool,
    ) -> Guid {
        let target_guid = self.resolve_property_target_guid(guid);

        if let Some(entity) = self.entities.get_mut(target_guid) {
            entity.set_property(update.clone());
        } else if let Some(vendor) = self.vendor.as_mut()
            && let Some(item) = vendor
                .items
                .iter_mut()
                .find(|item| item.guid == target_guid)
        {
            item.set_property(update.clone());
        }

        if mirror_player && target_guid == self.player.guid {
            self.player.set_property(update.clone());
        }

        target_guid
    }

    pub(crate) fn apply_instance_id_side_effect(
        &mut self,
        target_guid: Guid,
        property: PropertyInstanceId,
        value: Guid,
    ) {
        let mut clear_world_presence = false;

        if let Some(entity) = self.entities.get_mut(target_guid) {
            match property {
                PropertyInstanceId::Container => {
                    if value != Guid::NULL && target_guid != self.player.guid {
                        clear_world_presence = true;
                    }
                }
                PropertyInstanceId::Wielder => {
                    if value == Guid::NULL {
                        entity.physics_parent_id = None;
                    }

                    if value != Guid::NULL && target_guid != self.player.guid {
                        clear_world_presence = true;
                    }
                }
                _ => {}
            }
        }

        if clear_world_presence {
            let _ = self.clear_entity_world_presence(target_guid);
        }

        match property {
            PropertyInstanceId::Container | PropertyInstanceId::Wielder => {
                if property == PropertyInstanceId::Container {
                    if value == Guid::NULL {
                        self.clear_container_preview(target_guid);
                    } else if self.open_containers.contains(&value) {
                        self.mark_container_preview(target_guid);
                    }
                }

                self.sync_player_ownership_for_entity(target_guid);
                let _ = self.reconcile_entity_retention(target_guid);
            }
            _ => {}
        }
    }

    pub(crate) fn apply_set_state_update(
        &mut self,
        data: &SetStateData,
        events: &mut Vec<WorldEvent>,
    ) -> bool {
        if let Some(entity) = self.entities.get_mut(data.guid) {
            entity.physics_state = data.physics_state;
            entity.properties.hydrate_from_set_state(data);
            events.push(WorldEvent::EntityStateUpdated {
                guid: data.guid,
                physics_state: data.physics_state,
            });
            true
        } else {
            false
        }
    }

    pub(crate) fn handle_trade_complete(&mut self, events: &mut Vec<WorldEvent>) {
        let trade_item_guids = self.current_trade_item_guids();
        self.mark_trade_preview_entities_for_prune(&trade_item_guids);

        if let Some(trade) = self.trade.as_mut() {
            trade.self_side.accepted = false;
            trade.partner_side.accepted = false;
            trade.self_side.items.clear();
            trade.partner_side.items.clear();
            events.push(WorldEvent::TradeStateUpdated(Some(trade.clone())));
        }
    }

    pub(crate) fn register_trade(
        &mut self,
        initiator: Guid,
        partner: Guid,
        events: &mut Vec<WorldEvent>,
    ) {
        let partner_guid = if initiator == self.player.guid {
            partner
        } else {
            initiator
        };

        let trade_state = TradeState {
            partner_guid,
            initiator_guid: initiator,
            trade_stamp: 0.0,
            self_side: TradeSide {
                guid: self.player.guid,
                accepted: false,
                items: Vec::new(),
            },
            partner_side: TradeSide {
                guid: partner_guid,
                accepted: false,
                items: Vec::new(),
            },
        };

        self.trade = Some(trade_state.clone());
        events.push(WorldEvent::TradeStateUpdated(Some(trade_state)));
    }

    pub(crate) fn add_trade_item(
        &mut self,
        trade_side: u32,
        object_guid: Guid,
        events: &mut Vec<WorldEvent>,
    ) {
        let should_mark_preview = self
            .retention_snapshot(object_guid, self.current_server_time())
            .is_none_or(|snapshot| !snapshot.has_authoritative_retention());

        if let Some(trade) = self.trade.as_mut() {
            if trade_side == 0x01 {
                trade.self_side.items.push(object_guid);
            } else {
                trade.partner_side.items.push(object_guid);
            }
            trade.self_side.accepted = false;
            trade.partner_side.accepted = false;
            events.push(WorldEvent::TradeStateUpdated(Some(trade.clone())));
        }

        if should_mark_preview {
            self.mark_trade_preview(object_guid);
        }
    }

    pub(crate) fn accept_trade(&mut self, who_accepted: Guid, events: &mut Vec<WorldEvent>) {
        if let Some(trade) = self.trade.as_mut() {
            if who_accepted == self.player.guid {
                trade.self_side.accepted = true;
            } else {
                trade.partner_side.accepted = true;
            }
            events.push(WorldEvent::TradeStateUpdated(Some(trade.clone())));
        }
    }

    pub(crate) fn reset_trade(&mut self, events: &mut Vec<WorldEvent>) {
        let trade_item_guids = self.current_trade_item_guids();
        self.mark_trade_preview_entities_for_prune(&trade_item_guids);

        if let Some(trade) = self.trade.as_mut() {
            trade.self_side.accepted = false;
            trade.partner_side.accepted = false;
            trade.self_side.items.clear();
            trade.partner_side.items.clear();
            events.push(WorldEvent::TradeStateUpdated(Some(trade.clone())));
        }
    }

    pub(crate) fn clear_trade_acceptance(&mut self, events: &mut Vec<WorldEvent>) {
        if let Some(trade) = self.trade.as_mut() {
            trade.self_side.accepted = false;
            trade.partner_side.accepted = false;
            events.push(WorldEvent::TradeStateUpdated(Some(trade.clone())));
        }
    }

    pub(crate) fn close_trade(&mut self, events: &mut Vec<WorldEvent>) {
        let trade_item_guids = self.current_trade_item_guids();
        self.mark_trade_preview_entities_for_prune(&trade_item_guids);
        self.trade = None;
        events.push(WorldEvent::TradeStateUpdated(None));
    }

    pub(crate) fn current_trade_item_guids(&self) -> Vec<Guid> {
        let mut item_guids = Vec::new();

        if let Some(trade) = self.trade.as_ref() {
            item_guids.extend(trade.self_side.items.iter().copied());
            item_guids.extend(trade.partner_side.items.iter().copied());
        }

        item_guids.sort_unstable_by_key(|guid| guid.0);
        item_guids.dedup();
        item_guids
    }

    pub(crate) fn current_container_preview_item_guids(&self, container_guid: Guid) -> Vec<Guid> {
        let mut item_guids: Vec<_> = self
            .entities
            .iter()
            .filter(|entity| entity.container_id() == Some(container_guid))
            .filter(|entity| {
                self.entity_lifecycle_state(entity.guid)
                    .is_some_and(|state| state.container_preview)
            })
            .map(|entity| entity.guid)
            .collect();

        item_guids.sort_unstable_by_key(|guid| guid.0);
        item_guids.dedup();
        item_guids
    }

    pub(crate) fn mark_trade_preview_entities_for_prune(&mut self, item_guids: &[Guid]) {
        for &guid in item_guids {
            self.clear_trade_preview(guid);
            let _ = self.mark_entity_immediately_eligible_for_pruning_if_unretained(guid);
        }
    }

    pub(crate) fn mark_container_preview_entities_for_prune(&mut self, item_guids: &[Guid]) {
        let now = self.current_server_time();

        for &guid in item_guids {
            let Some(snapshot) = self.reconcile_entity_retention(guid) else {
                continue;
            };

            if snapshot.has_authoritative_retention() {
                self.clear_container_preview(guid);
                let _ = self.reconcile_entity_retention(guid);
                continue;
            }

            if let Some(entity) = self.entities.get_mut(guid) {
                entity.set_iid_prop(PropertyInstanceId::Container, Guid::NULL);
            }

            self.clear_container_preview(guid);
            self.set_entity_prune_deadline(guid, now);
        }
    }

    pub(crate) fn set_vendor_state(
        &mut self,
        data: &ApproachVendorEventData,
        events: &mut Vec<WorldEvent>,
    ) {
        let items = data
            .items
            .iter()
            .map(CoreVendorItem::from_protocol)
            .collect();

        let vendor_state = VendorState {
            vendor_guid: data.vendor_guid,
            items,
            buy_multiplier: data.buy_multiplier,
            sell_multiplier: data.sell_multiplier,
            merchandise_item_types: data.merchandise_item_types,
            alternate_currency_wcid: data.alternate_currency_wcid,
            alternate_currency_amount: data.alternate_currency_amount,
            alternate_currency_name: data.alternate_currency_name.clone(),
        };

        self.vendor = Some(vendor_state.clone());
        events.push(WorldEvent::VendorStateUpdated(Some(vendor_state)));
    }
}
