use super::super::*;
use holtburger_common::properties::WorldObjectExt as _;

impl WorldState {
    /// Apply one authored presentation flag; ordinary entity publication carries the effective result.
    pub fn apply_entity_script_presentation(
        &mut self,
        guid: Guid,
        authoritative_revision: u64,
        change: crate::EntityPresentationChange,
    ) -> anyhow::Result<bool> {
        let entity = self
            .entities
            .get_mut(guid)
            .ok_or_else(|| anyhow::anyhow!("script presentation target {guid} is absent"))?;
        // A newer complete server state supersedes this prediction, even if its flag values
        // equal those at activation. Asset readiness must never reverse reconciliation order.
        if entity.physics.authoritative_revision() != authoritative_revision {
            return Ok(false);
        }
        Ok(entity.physics.apply_authored_presentation(change))
    }

    /// Apply a server selection or optimistic local selection through the private property path.
    pub fn set_player_character_title(&mut self, title_id: u32) -> WorldEvent {
        // PropertyInt stores the same 32 wire bits in a signed slot.
        let update = PropertyUpdate::Int(PropertyInt::CharacterTitleId, title_id as i32);
        self.player_entity_mut()
            .expect("title selection requires a described player entity")
            .set_property(update.clone());
        self.player.property_retention.observe(&update);
        WorldEvent::PropertiesUpdated {
            guid: self.player.guid,
            updates: vec![update],
        }
    }

    pub(crate) fn update_health_fraction_at(
        &mut self,
        guid: Guid,
        health_fraction: f32,
        observed_at: std::time::Instant,
        events: &mut Vec<WorldEvent>,
    ) -> bool {
        if guid == Guid::NULL || !health_fraction.is_finite() {
            return false;
        }

        let health_fraction = health_fraction.clamp(0.0, 1.0);
        let mut updated = false;

        if guid == self.player.guid
            && let Some(vital_obj) = self.player.vitals.get_mut(&crate::stats::VitalType::Health)
        {
            let new_current = (health_fraction * vital_obj.buffed_max as f32) as u32;
            if vital_obj.current != new_current {
                vital_obj.current = new_current;
                events.push(WorldEvent::VitalUpdated(vital_obj.clone()));
                updated = true;
            }
        }

        if health_fraction == 0.0 {
            self.end_summon(guid, crate::summon::SummonEndCause::Death, events);
        }

        if let Some(entity) = self.entities.get_mut(guid) {
            let instance_sequence = entity.instance_sequence();
            // QueryHealth also starts a subscription. Its response must reach a newly selected
            // target's consumer even when the world already holds the same health fraction.
            entity.health = Some(crate::entity::HealthObservation {
                fraction: health_fraction,
                observed_at,
            });
            events.push(WorldEvent::EntityHealthUpdated {
                guid,
                instance_sequence,
                health_fraction,
                observed_at,
            });
            updated = true;
        }

        updated
    }

    pub(crate) fn resolve_property_target_guid(&self, guid: Guid) -> Guid {
        if guid == Guid::NULL {
            self.player.guid
        } else {
            guid
        }
    }

    /// Joins current public collision identity to an installed body without changing its
    /// geometry, motion, or sampling. Called after installation and admitted PK updates.
    pub fn synchronize_entity_contact_status(&mut self, guid: Guid) {
        let Some(entity) = self.entities.get(guid) else {
            return;
        };
        let status = crate::PlayerCollisionStatus::from_description(entity.flags);
        let Some(body_id) = self.runtime_body_id_for_guid(guid) else {
            return;
        };
        self.scene.set_player_collision_status(body_id, status);
    }

    pub(crate) fn apply_property_update_to_target(
        &mut self,
        guid: Guid,
        update: &PropertyUpdate,
    ) -> Guid {
        let target_guid = self.resolve_property_target_guid(guid);

        let scale_changed = matches!(
            update,
            PropertyUpdate::Float(
                holtburger_common::properties::PropertyFloat::DefaultScale,
                _
            )
        );
        if let Some(entity) = self.entities.get_mut(target_guid) {
            entity.set_property(update.clone());
        } else if let Some(vendor) = self.vendor.as_mut()
            && let Some(item) = vendor
                .items
                .iter_mut()
                .find(|item| item.guid == target_guid)
        {
            item.set_property(update.clone());
            item.refresh_equipment_cantrip(&self.spell_catalog);
        }
        if let PropertyUpdate::Int(PropertyInt::CurrentWieldedLocation, mask) = update
            && let Some(super::super::storage::StorageLocation::Equipped { wearer, .. }) =
                self.storage.location(target_guid)
        {
            self.storage.equip(
                target_guid,
                wearer,
                Some(EquipMask::from_bits(*mask as u32).expect("invalid accepted equipment mask")),
            );
        }
        if matches!(update, PropertyUpdate::Int(PropertyInt::ItemsCapacity, _))
            && self
                .entities
                .get(target_guid)
                .is_some_and(|entity| entity.can_hold_items())
        {
            self.storage.establish_container(target_guid);
        }
        if matches!(
            update,
            PropertyUpdate::Int(PropertyInt::PlayerKillerStatus, _)
        ) {
            self.synchronize_entity_contact_status(target_guid);
        }
        if scale_changed {
            self.synchronize_entity_body_scale(target_guid);
        }

        target_guid
    }

    pub(crate) fn apply_instance_id_side_effect(
        &mut self,
        target_guid: Guid,
        property: PropertyInstanceId,
        value: Guid,
        events: &mut Vec<WorldEvent>,
    ) {
        let mut clear_world_presence = false;

        if let Some(entity) = self.entities.get_mut(target_guid) {
            match property {
                PropertyInstanceId::Container
                    if value != Guid::NULL && target_guid != self.player.guid =>
                {
                    clear_world_presence = true;
                }
                PropertyInstanceId::Wielder => {
                    if value == Guid::NULL {
                        entity.set_attachment(None);
                    }

                    if value != Guid::NULL && target_guid != self.player.guid {
                        clear_world_presence = true;
                    }
                }
                _ => {}
            }
        }

        if clear_world_presence {
            self.emit_entity_world_presence_cleared(target_guid, events);
        }

        match property {
            PropertyInstanceId::Container | PropertyInstanceId::Wielder => {
                if property == PropertyInstanceId::Container {
                    if value == Guid::NULL {
                        self.clear_container_preview(target_guid);
                    } else if self.has_world_container_access(value) {
                        self.mark_container_preview(target_guid);
                    }
                }

                match property {
                    PropertyInstanceId::Container => {
                        self.storage.announce_container(target_guid, value)
                    }
                    PropertyInstanceId::Wielder if value != Guid::NULL => {
                        self.storage.equip(target_guid, value, None)
                    }
                    PropertyInstanceId::Wielder
                        if matches!(
                            self.storage.location(target_guid),
                            Some(super::super::storage::StorageLocation::Equipped { .. })
                        ) =>
                    {
                        self.storage.withdraw(target_guid)
                    }
                    _ => {}
                }
                let _ = self.reconcile_entity_retention(target_guid);
            }
            _ => {}
        }
    }

    pub(crate) fn set_vendor_state(
        &mut self,
        data: &ApproachVendorEventData,
        events: &mut Vec<WorldEvent>,
    ) {
        let spell_catalog = &self.spell_catalog;
        let items = data
            .items
            .iter()
            .map(|entry| {
                let mut item = CoreVendorItem::from_protocol(entry);
                item.refresh_equipment_cantrip(spell_catalog);
                item
            })
            .collect();

        let vendor_state = VendorState {
            vendor_guid: data.vendor_guid,
            items,
            buy_multiplier: data.buy_multiplier,
            sell_multiplier: data.sell_multiplier,
            merchandise_item_types: data.merchandise_item_types,
            value_limits: crate::vendor::VendorValueLimits::from_wire(
                data.merchandise_min_value,
                data.merchandise_max_value,
            ),
            alternate_currency_wcid: data.alternate_currency_wcid,
            alternate_currency_amount: data.alternate_currency_amount,
            alternate_currency_name: data.alternate_currency_name.clone(),
        };

        self.vendor = Some(vendor_state.clone());
        events.push(WorldEvent::VendorApproached(vendor_state));
    }
}
