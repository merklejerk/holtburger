//! Housing draft evaluation and conservative selection over current inventory facts.

use super::{ClientRuntime, ClientState, types::ClientViewEvent};
use holtburger_common::{
    Guid,
    properties::{ItemType, PropertyInt, WorldObjectExt, WorldObjectPropertyAccessors},
};
use holtburger_world::{
    context::WorldContext,
    housing::{
        HousingRequirement,
        payment::{
            HousingPaymentItem, HousingPaymentKind, HousingPaymentQuote,
            payment_matches_requirement, quote_payment,
        },
    },
    state::storage::{RosterCoverage, StorageLocation},
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

/// Which accepted crystal requirements the draft contributes toward.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HousingPaymentPurpose {
    /// Full purchase coverage is required at submission.
    Purchase,
    /// Maintenance can accept a partial contribution.
    Maintenance,
}

/// Identity-only intent; quantities and values are always resolved by core.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HousingPaymentDraft {
    /// Crystal supplying the current authoritative requirements.
    pub crystal: Guid,
    /// Purchase or maintenance; never chosen implicitly from ownership.
    pub purpose: HousingPaymentPurpose,
    /// Physical IDs in stable selection order, each at most once.
    pub items: Vec<Guid>,
}

/// Draft editing is evaluated against current inventory and requirement facts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum HousingPreviewOperation {
    /// Re-evaluate the existing physical selection without adding sources.
    Quote,
    /// Admit one physical source into the specified requirement row.
    Add {
        /// Requirement template in the draft's accepted purchase/maintenance purpose.
        wcid: u32,
        /// Actual carried inventory source, never a template identifier.
        item: Guid,
    },
    /// Fill only the specified requirement, preserving every existing source.
    Fill {
        /// Requirement template to fill without changing other rows.
        wcid: u32,
    },
}

/// Local correlation distinguishes obsolete previews from the current draft.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HousingPreviewRequest {
    /// Frontend request identity, echoed unchanged.
    pub sequence: u32,
    /// Existing selection, preserved by row additions and auto-fill.
    pub draft: HousingPaymentDraft,
    /// Explicit local edit; never dispatches a payment action.
    pub operation: HousingPreviewOperation,
}

/// Selected objects and accounting, or a specific evaluation refusal.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum HousingPreviewOutcome {
    /// Shortfalls remain visible rather than imply affordability.
    Ready {
        /// Existing IDs plus auto-filled IDs; no inventory transfer occurs.
        items: Vec<Guid>,
        /// World-owned consumption, contribution, excess, and shortfall.
        quote: HousingPaymentQuote,
        /// Auto-fill exclusions, such as missing descriptions, shown in draft feedback.
        unavailable: Vec<String>,
    },
    /// Current selection or interaction cannot be evaluated safely.
    Rejected {
        /// User-facing refusal, never parsed back into execution state.
        reason: String,
    },
}

/// Sequence- and crystal-bound receipt; it carries no opening intent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HousingPreviewResult {
    /// Echo of the request identity.
    pub sequence: u32,
    /// Reject receipts after crystal replacement.
    pub crystal: Guid,
    /// Accepted candidate or evaluation refusal.
    pub outcome: HousingPreviewOutcome,
}

impl ClientRuntime {
    fn housing_requirements(
        &self,
        draft: &HousingPaymentDraft,
    ) -> Result<&[HousingRequirement], String> {
        if self.state != ClientState::InWorld {
            return Err("Housing payment is only available in the world".into());
        }
        if self.pack_exchange.is_some() {
            return Err("Finish the pending operation before preparing payment".into());
        }
        let crystal = self
            .world
            .housing
            .crystal
            .as_ref()
            .filter(|profile| profile.crystal == draft.crystal)
            .ok_or("This crystal interaction is no longer available")?;
        if !crystal.active {
            return Err("This house crystal is disabled".into());
        }
        if !(1..=4).contains(&crystal.house_type) {
            return Err("This house type is not supported for payment".into());
        }
        match draft.purpose {
            HousingPaymentPurpose::Purchase if crystal.owner != Guid::NULL => {
                Err("This dwelling already has an owner".into())
            }
            HousingPaymentPurpose::Maintenance if crystal.owner == Guid::NULL => {
                Err("This dwelling has no owner to maintain".into())
            }
            HousingPaymentPurpose::Maintenance if crystal.maintenance_free => {
                Err("Maintenance is free this period".into())
            }
            HousingPaymentPurpose::Purchase => Ok(&crystal.buy),
            HousingPaymentPurpose::Maintenance => Ok(&crystal.rent),
        }
    }

    pub(super) fn resolve_housing_payment_item(
        &self,
        guid: Guid,
    ) -> Result<HousingPaymentItem, String> {
        if !self.world.is_stored_within(guid, self.world.player.guid) {
            return Err("Only carried inventory can be used for housing payment".into());
        }
        let mut ancestor = guid;
        while ancestor != self.world.player.guid {
            match self.world.storage_location(ancestor) {
                Some(StorageLocation::Contained { parent, .. }) => ancestor = parent,
                Some(StorageLocation::Equipped { .. }) => {
                    return Err("Equipped items cannot be used for housing payment".into());
                }
                None => return Err("Payment item ownership is no longer established".into()),
            }
        }
        let entity = self
            .world
            .entities
            .get(guid)
            .ok_or_else(|| format!("Payment item {guid} description is still pending"))?;
        if self.world.trade.as_ref().is_some_and(|trade| {
            trade
                .self_side
                .items
                .iter()
                .any(|offered| *offered == guid || self.world.is_stored_within(guid, *offered))
        }) {
            return Err(format!(
                "{} is already offered in a player trade",
                entity.name()
            ));
        }
        if self.world.storage_coverage(guid) == Some(RosterCoverage::Awaiting) {
            return Err(format!(
                "{}: container contents are still pending",
                entity.name()
            ));
        }
        if self.world.container_contents(guid).next().is_some() {
            return Err(format!("{} must be empty before payment", entity.name()));
        }
        let quantity = match entity.get_int_prop(PropertyInt::StackSize) {
            None => 1,
            Some(value) if value > 0 => value as u32,
            Some(_) => return Err(format!("{} has an invalid stack quantity", entity.name())),
        };
        let item_type = entity
            .item_type()
            .ok_or("Payment item type is not available")?;
        let kind = if item_type == ItemType::PROMISSORY_NOTE {
            let stack_value = entity
                .get_int_prop(PropertyInt::Value)
                .and_then(|value| u32::try_from(value).ok())
                .filter(|value| *value > 0)
                .ok_or("Trade note stack value is not available")?;
            let unit_value = entity
                .get_int_prop(PropertyInt::StackUnitValue)
                .and_then(|value| u32::try_from(value).ok())
                .filter(|value| *value > 0)
                .ok_or("Trade note denomination is not available")?;
            HousingPaymentKind::TradeNote {
                stack_value,
                unit_value,
            }
        } else {
            HousingPaymentKind::Item
        };
        Ok(HousingPaymentItem {
            guid,
            wcid: entity
                .wcid
                .ok_or("Payment item template is not available")?,
            quantity,
            kind,
        })
    }

    /// Reused at execution admission; previews do not reserve physical objects.
    pub(super) fn quote_housing_draft(
        &self,
        draft: &HousingPaymentDraft,
    ) -> Result<HousingPaymentQuote, String> {
        let requirements = self.housing_requirements(draft)?;
        let items = draft
            .items
            .iter()
            .map(|id| self.resolve_housing_payment_item(*id))
            .collect::<Result<Vec<_>, _>>()?;
        quote_payment(requirements, &items)
    }

    fn evaluate_housing_preview(
        &self,
        request: &HousingPreviewRequest,
    ) -> Result<HousingPreviewOutcome, String> {
        let requirements = self.housing_requirements(&request.draft)?;
        let target = match request.operation {
            HousingPreviewOperation::Quote => None,
            HousingPreviewOperation::Add { wcid, .. } | HousingPreviewOperation::Fill { wcid } => {
                Some(
                    requirements
                        .iter()
                        .position(|row| row.wcid == wcid)
                        .ok_or("This payment requirement is no longer available")?,
                )
            }
        };
        let mut draft = request.draft.clone();
        if let HousingPreviewOperation::Add { wcid, item } = request.operation {
            let facts = self.resolve_housing_payment_item(item)?;
            if !payment_matches_requirement(
                wcid,
                facts.wcid,
                matches!(facts.kind, HousingPaymentKind::TradeNote { .. }),
            ) {
                return Err("That item does not match this payment requirement".into());
            }
            if !draft.items.contains(&item) {
                draft.items.push(item);
            }
        }
        let mut quote = self.quote_housing_draft(&draft)?;
        let mut selected = draft.items;
        let mut unavailable = Vec::new();
        if let (HousingPreviewOperation::Fill { .. }, Some(target)) = (&request.operation, target)
            && quote.lines[target].shortfall > 0
        {
            let requirement = &requirements[target];
            let mut facts = selected
                .iter()
                .map(|id| self.resolve_housing_payment_item(*id))
                .collect::<Result<Vec<_>, _>>()?;
            let seen: BTreeSet<_> = selected.iter().copied().collect();
            let mut candidates = Vec::new();
            for guid in self.world.iter_inventory().filter(|id| !seen.contains(id)) {
                let relevant = self.world.entities.get(guid).is_none_or(|item| {
                    requirement.remaining > 0
                        && (item.wcid.is_none()
                            || item.wcid.is_some_and(|wcid| {
                                payment_matches_requirement(
                                    requirement.wcid,
                                    wcid,
                                    item.item_type() == Some(ItemType::PROMISSORY_NOTE),
                                )
                            }))
                });
                if !relevant {
                    continue;
                }
                match self.resolve_housing_payment_item(guid) {
                    Ok(item) => candidates.push(item),
                    Err(reason) => unavailable.push(reason),
                }
            }
            while quote.lines[target].shortfall > 0 {
                let credit = quote.lines[target].credited;
                let mut best = None;
                for (index, item) in candidates.iter().enumerate() {
                    facts.push(item.clone());
                    let candidate = quote_payment(requirements, &facts);
                    facts.pop();
                    let candidate = candidate?;
                    let contributed = candidate.lines[target].credited;
                    if candidate
                        .lines
                        .iter()
                        .zip(&quote.lines)
                        .enumerate()
                        .any(|(row, (next, previous))| row != target && next != previous)
                    {
                        continue;
                    }
                    if contributed <= credit {
                        continue;
                    }
                    let excess = candidate.lines[target].excess;
                    // Conservative greedy selection; actual consumption remains ACE's quote.
                    let score = (excess, std::cmp::Reverse(contributed), item.guid);
                    if best
                        .as_ref()
                        .is_none_or(|(_, previous, _)| score < *previous)
                    {
                        best = Some((index, score, candidate));
                    }
                }
                let Some((index, _, candidate)) = best else {
                    break;
                };
                let item = candidates.remove(index);
                selected.push(item.guid);
                facts.push(item);
                quote = candidate;
            }
        }
        Ok(HousingPreviewOutcome::Ready {
            items: selected,
            quote,
            unavailable,
        })
    }

    pub(super) fn preview_housing_payment(&self, request: HousingPreviewRequest) {
        let outcome = self
            .evaluate_housing_preview(&request)
            .unwrap_or_else(|reason| HousingPreviewOutcome::Rejected { reason });
        let _ = self
            .client_view_event_tx
            .send(ClientViewEvent::HousingPaymentPreview(
                HousingPreviewResult {
                    sequence: request.sequence,
                    crystal: request.draft.crystal,
                    outcome,
                },
            ));
    }
}

#[cfg(test)]
mod tests {
    use super::super::builder::build_test_client;
    use super::*;
    use holtburger_common::properties::{
        EquipMask, InventoryEntryKind, WorldObjectPropertyAccessorsMut,
    };
    use holtburger_protocol::messages::{
        GameEvent, GameEventMessage, GameMessage, HousePayment, HouseProfile,
        InventoryPutObjInContainerEventData, WieldObjectEventData,
    };
    use holtburger_world::{
        entity::Entity,
        housing::HousingCrystal,
        state::{TradeSide, TradeState},
    };

    const PLAYER: Guid = Guid(1);
    const CRYSTAL: Guid = Guid(100);

    fn client() -> ClientRuntime {
        let mut client = build_test_client(ClientState::InWorld);
        client
            .world
            .seed_local_player_entity(PLAYER, "Payer", Default::default());
        client.world.housing.crystal = Some(
            HousingCrystal::from_profile(
                CRYSTAL,
                &HouseProfile {
                    dwelling_id: 10,
                    owner: PLAYER,
                    owner_name: "Payer".into(),
                    flags: 1,
                    min_level: -1,
                    max_level: -1,
                    min_allegiance_rank: -1,
                    max_allegiance_rank: -1,
                    maintenance_free: false,
                    house_type: 1,
                    buy: vec![],
                    rent: vec![HousePayment {
                        wcid: holtburger_world::currency::PYREAL_WCID,
                        required: 13,
                        paid: 0,
                        name: "Pyreal".into(),
                        plural_name: "Pyreals".into(),
                    }],
                },
            )
            .unwrap(),
        );
        client
    }

    fn place(client: &mut ClientRuntime, guid: Guid, parent: Guid) {
        client
            .world
            .handle_message(&GameMessage::GameEvent(Box::new(GameEventMessage {
                target: PLAYER,
                sequence: 1,
                event: GameEvent::InventoryPutObjInContainer(Box::new(
                    InventoryPutObjInContainerEventData {
                        item_guid: guid,
                        container_guid: parent,
                        slot: 0,
                        container_type: InventoryEntryKind::Item,
                    },
                )),
            })));
    }

    fn source(client: &mut ClientRuntime, guid: Guid, count: i32, note: Option<i32>) {
        let mut item = Entity::new(guid, "Payment".into(), Default::default());
        item.wcid = Some(if note.is_some() {
            999
        } else {
            holtburger_world::currency::PYREAL_WCID
        });
        item.set_int_prop(
            PropertyInt::ItemType,
            if note.is_some() {
                ItemType::PROMISSORY_NOTE
            } else {
                ItemType::MONEY
            }
            .bits() as i32,
        );
        item.set_int_prop(PropertyInt::StackSize, count);
        if let Some(value) = note {
            item.set_int_prop(PropertyInt::Value, value * count);
            item.set_int_prop(PropertyInt::StackUnitValue, value);
        }
        client.world.add_entity(item);
        place(client, guid, PLAYER);
    }

    fn request(items: Vec<Guid>, fill: bool) -> HousingPreviewRequest {
        HousingPreviewRequest {
            sequence: 7,
            draft: HousingPaymentDraft {
                crystal: CRYSTAL,
                purpose: HousingPaymentPurpose::Maintenance,
                items,
            },
            operation: if fill {
                HousingPreviewOperation::Fill {
                    wcid: holtburger_world::currency::PYREAL_WCID,
                }
            } else {
                HousingPreviewOperation::Quote
            },
        }
    }

    #[test]
    fn auto_fill_preserves_manual_sources_and_avoids_unnecessary_note_excess() {
        let mut client = client();
        source(&mut client, Guid(10), 3, None);
        source(&mut client, Guid(11), 10, None);
        source(&mut client, Guid(12), 2, Some(20));
        let HousingPreviewOutcome::Ready {
            items,
            quote,
            unavailable,
        } = client
            .evaluate_housing_preview(&request(vec![Guid(10)], true))
            .unwrap()
        else {
            panic!("Expected candidate");
        };
        assert_eq!(items, vec![Guid(10), Guid(11)]);
        assert!(quote.complete && quote.contributes);
        assert_eq!(quote.lines[0].excess, 0);
        assert!(unavailable.is_empty());
        assert_eq!(
            quote,
            client
                .quote_housing_draft(&request(items, false).draft)
                .unwrap()
        );
        assert_eq!(client.session.game_action_sequence, 0);
    }

    #[test]
    fn auto_fill_reports_insufficiency_and_missing_descriptions_without_losing_selection() {
        let mut client = client();
        source(&mut client, Guid(10), 3, None);
        place(&mut client, Guid(11), PLAYER);
        let HousingPreviewOutcome::Ready {
            items,
            quote,
            unavailable,
        } = client
            .evaluate_housing_preview(&request(vec![Guid(10)], true))
            .unwrap()
        else {
            panic!("Expected candidate");
        };
        assert_eq!(items, vec![Guid(10)]);
        assert_eq!(quote.lines[0].shortfall, 10);
        assert_eq!(unavailable.len(), 1);
        assert!(unavailable[0].contains("description is still pending"));
        assert!(
            client
                .quote_housing_draft(&request(vec![Guid(11)], false).draft)
                .unwrap_err()
                .contains("description is still pending")
        );
    }

    #[test]
    fn targeted_fill_preserves_other_requirement_sources_and_accounting() {
        let mut client = client();
        client
            .world
            .housing
            .crystal
            .as_mut()
            .unwrap()
            .rent
            .push(HousingRequirement {
                wcid: 42,
                name: "Writ".into(),
                plural_name: "Writs".into(),
                required: 4,
                paid: 0,
                remaining: 4,
            });
        source(&mut client, Guid(10), 3, None);
        source(&mut client, Guid(11), 10, None);
        source(&mut client, Guid(12), 2, None);
        source(&mut client, Guid(13), 4, None);
        client.world.entities.get_mut(Guid(12)).unwrap().wcid = Some(42);
        client.world.entities.get_mut(Guid(13)).unwrap().wcid = Some(42);
        let mut request = request(vec![Guid(10), Guid(12)], true);
        let before = client.quote_housing_draft(&request.draft).unwrap();
        let HousingPreviewOutcome::Ready { items, quote, .. } =
            client.evaluate_housing_preview(&request).unwrap()
        else {
            panic!("Expected row preview");
        };
        assert_eq!(items, vec![Guid(10), Guid(12), Guid(11)]);
        assert_eq!(quote.lines[1], before.lines[1]);
        assert_eq!(quote.lines[0].shortfall, 0);
        assert!(!quote.complete);

        request.operation = HousingPreviewOperation::Fill { wcid: 42 };
        let HousingPreviewOutcome::Ready { items, quote, .. } =
            client.evaluate_housing_preview(&request).unwrap()
        else {
            panic!("Expected row preview");
        };
        assert_eq!(items, vec![Guid(10), Guid(12), Guid(13)]);
        assert_eq!(quote.lines[0], before.lines[0]);
        assert_eq!(quote.lines[1].shortfall, 0);
        assert_eq!(client.session.game_action_sequence, 0);
    }

    #[test]
    fn manual_row_admission_validates_matching_and_current_requirement_identity() {
        let mut client = client();
        source(&mut client, Guid(10), 3, None);
        source(&mut client, Guid(11), 2, Some(10));
        source(&mut client, Guid(12), 2, None);
        client.world.entities.get_mut(Guid(12)).unwrap().wcid = Some(42);
        let mut request = request(vec![], false);
        request.operation = HousingPreviewOperation::Add {
            wcid: holtburger_world::currency::PYREAL_WCID,
            item: Guid(12),
        };
        assert_eq!(
            client.evaluate_housing_preview(&request).unwrap_err(),
            "That item does not match this payment requirement"
        );
        request.operation = HousingPreviewOperation::Add {
            wcid: holtburger_world::currency::PYREAL_WCID,
            item: Guid(11),
        };
        let HousingPreviewOutcome::Ready { items, quote, .. } =
            client.evaluate_housing_preview(&request).unwrap()
        else {
            panic!("Expected note preview");
        };
        assert_eq!(items, vec![Guid(11)]);
        assert_eq!(quote.lines[0].excess, 7);
        request.operation = HousingPreviewOperation::Fill { wcid: 42 };
        assert_eq!(
            client.evaluate_housing_preview(&request).unwrap_err(),
            "This payment requirement is no longer available"
        );
        assert_eq!(client.session.game_action_sequence, 0);
    }

    #[test]
    fn current_ownership_quantity_and_duplicate_identity_are_revalidated() {
        let mut client = client();
        source(&mut client, Guid(10), 3, None);
        assert!(
            client
                .quote_housing_draft(&request(vec![Guid(10), Guid(10)], false).draft)
                .unwrap_err()
                .contains("more than once")
        );
        client
            .world
            .entities
            .get_mut(Guid(10))
            .unwrap()
            .set_int_prop(PropertyInt::StackSize, 0);
        assert!(
            client
                .quote_housing_draft(&request(vec![Guid(10)], false).draft)
                .unwrap_err()
                .contains("invalid stack quantity")
        );
        place(&mut client, Guid(10), Guid(99));
        assert!(
            client
                .quote_housing_draft(&request(vec![Guid(10)], false).draft)
                .unwrap_err()
                .contains("Only carried inventory")
        );
    }

    #[test]
    fn receipt_is_correlated_and_preview_never_sends_a_payment_action() {
        let mut client = client();
        source(&mut client, Guid(10), 2, Some(10));
        let mut events = client.subscribe_client_view_events();
        client.preview_housing_payment(request(vec![], true));
        let ClientViewEvent::HousingPaymentPreview(result) = events.try_recv().unwrap() else {
            panic!("Expected preview receipt");
        };
        assert_eq!(result.sequence, 7);
        assert_eq!(result.crystal, CRYSTAL);
        let HousingPreviewOutcome::Ready { quote, .. } = result.outcome else {
            panic!("Expected candidate");
        };
        assert_eq!(quote.lines[0].credited, 13);
        assert_eq!(quote.lines[0].excess, 7);
        assert_eq!(client.session.game_action_sequence, 0);
        assert!(client.active_busy_operation.is_none());
    }

    #[test]
    fn equipped_and_offered_sources_are_excluded_from_payment() {
        let mut client = client();
        source(&mut client, Guid(10), 10, None);
        client.world.trade = Some(TradeState {
            revision: 1,
            partner_guid: Guid(2),
            initiator_guid: PLAYER,
            trade_stamp: 0.0,
            self_side: TradeSide {
                guid: PLAYER,
                accepted: false,
                items: vec![Guid(10)],
            },
            partner_side: TradeSide::default(),
        });
        assert!(
            client
                .quote_housing_draft(&request(vec![Guid(10)], false).draft)
                .unwrap_err()
                .contains("offered in a player trade")
        );
        client.world.trade = None;
        client
            .world
            .handle_message(&GameMessage::GameEvent(Box::new(GameEventMessage {
                target: PLAYER,
                sequence: 2,
                event: GameEvent::WieldObject(Box::new(WieldObjectEventData {
                    object_guid: Guid(10),
                    equip_mask: EquipMask::MISSILE_AMMO,
                })),
            })));
        assert!(
            client
                .quote_housing_draft(&request(vec![Guid(10)], false).draft)
                .unwrap_err()
                .contains("Equipped items")
        );
    }

    #[test]
    fn read_only_quote_is_available_during_the_preceding_crystal_use() {
        let mut client = client();
        assert!(client.arm_busy_operation(super::super::PendingOperation::Use { source: CRYSTAL }));
        let quote = client
            .quote_housing_draft(&request(vec![], false).draft)
            .unwrap();
        assert_eq!(quote.lines[0].shortfall, 13);
        assert_eq!(client.session.game_action_sequence, 0);
        assert!(client.active_busy_operation.is_some());
    }

    #[test]
    fn unknown_dwelling_type_retains_facts_but_has_no_payment_quote() {
        let mut client = client();
        client.world.housing.crystal.as_mut().unwrap().house_type = 99;
        assert_eq!(
            client
                .quote_housing_draft(&request(vec![], false).draft)
                .unwrap_err(),
            "This house type is not supported for payment"
        );
    }
}
