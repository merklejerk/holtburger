//! Deterministic housing payment accounting, matching ACE HousePayment.GetConsumeItems.

use super::HousingRequirement;
use crate::currency::PYREAL_WCID;
use holtburger_common::Guid;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

/// Currency semantics are present only for trade notes, rather than optional item fields.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HousingPaymentKind {
    /// Ordinary payment contributes its consumed item count.
    Item,
    /// Trade notes contribute currency and are consumed in whole denominations.
    TradeNote {
        /// Current value of the complete stack, as ACE reads Item.Value.
        stack_value: u32,
        /// Value of one trade note, as ACE reads StackUnitValue.
        unit_value: u32,
    },
}

/// Current inventory facts resolved by the caller before quoting a selected object.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HousingPaymentItem {
    /// Actual object identity, never a template ID.
    pub guid: Guid,
    /// Item template used to match non-currency requirements.
    pub wcid: u32,
    /// Actual positive stack count, or one for an unstacked object.
    pub quantity: u32,
    /// Item or denomination semantics validated from current inventory facts.
    pub kind: HousingPaymentKind,
}

/// One physical source consumed for a quoted requirement.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HousingPaymentConsumption {
    /// Inventory object whose stack will be consumed or split.
    pub item: Guid,
    /// Expected number of physical items consumed from that object.
    pub quantity: u32,
    /// Value consumed; denomination rounding may exceed the credited contribution.
    pub value: u64,
}

/// Requirement-specific consumption and shortfall, in server requirement order.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HousingPaymentLine {
    /// Requirement template; names and totals come from accepted housing facts.
    pub wcid: u32,
    /// All selected matching GUIDs in draft order, including sources not consumed.
    /// Requirement-row editing uses these identities rather than consumption amounts.
    pub sources: Vec<Guid>,
    /// Physical sources in ACE's consumption order.
    pub consumption: Vec<HousingPaymentConsumption>,
    /// Contribution credited toward the outstanding requirement.
    pub credited: u32,
    /// Already-paid progress plus this draft's effective contribution, for compact progress UI.
    pub effective_paid: u64,
    /// Remaining amount after this draft's contribution.
    pub shortfall: u32,
    /// Consumed value exceeding credited value, including rounded-up trade notes.
    pub excess: u64,
}

/// Shared quote read by draft presentation and submission admission.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HousingPaymentQuote {
    /// One result per requirement, including already-paid requirements.
    pub lines: Vec<HousingPaymentLine>,
    /// True when this draft covers every outstanding requirement.
    pub complete: bool,
    /// True when this draft would contribute at least one required item/value.
    pub contributes: bool,
}

/// Template compatibility shared by quoting and requirement-targeted draft admission.
/// Ownership, description readiness, and reservations remain the caller's responsibility.
pub fn payment_matches_requirement(
    requirement_wcid: u32,
    item_wcid: u32,
    is_trade_note: bool,
) -> bool {
    item_wcid == requirement_wcid || (requirement_wcid == PYREAL_WCID && is_trade_note)
}

/// Quote an already-resolved draft; inventory ownership and reservations belong to the caller.
pub fn quote_payment(
    requirements: &[HousingRequirement],
    items: &[HousingPaymentItem],
) -> Result<HousingPaymentQuote, String> {
    let mut seen = BTreeSet::new();
    for item in items {
        if !seen.insert(item.guid) {
            return Err("An inventory object was selected more than once".into());
        }
        if item.quantity == 0 {
            return Err("A payment stack has no items".into());
        }
        if let HousingPaymentKind::TradeNote { unit_value, .. } = item.kind
            && unit_value == 0
        {
            return Err("Trade note denomination is not positive".into());
        }
    }
    let mut templates = BTreeSet::new();
    let mut lines = Vec::with_capacity(requirements.len());
    for requirement in requirements {
        if !templates.insert(requirement.wcid) {
            return Err("Housing requirements repeat an item template".into());
        }
        lines.push(quote_line(requirement, items)?);
    }
    // ACE builds each requirement's consumption independently over the same list.
    // A note matching both currency and an exact-template row has no exclusive
    // allocation we can safely present or submit as a requirement-row draft.
    let mut allocated = BTreeSet::new();
    for line in &lines {
        for source in &line.sources {
            if !allocated.insert(*source) {
                return Err("A selected payment item matches multiple housing requirements".into());
            }
        }
    }
    Ok(HousingPaymentQuote {
        complete: lines.iter().all(|line| line.shortfall == 0),
        contributes: lines.iter().any(|line| line.credited > 0),
        lines,
    })
}

fn quote_line(
    requirement: &HousingRequirement,
    items: &[HousingPaymentItem],
) -> Result<HousingPaymentLine, String> {
    let mut matching: Vec<_> = items
        .iter()
        .filter(|item| {
            payment_matches_requirement(
                requirement.wcid,
                item.wcid,
                matches!(item.kind, HousingPaymentKind::TradeNote { .. }),
            )
        })
        .collect();
    let sources = matching.iter().map(|item| item.guid).collect();
    // ACE consumes exact-template stacks first, then substitute notes by denomination.
    // Stable sorting preserves request order when stack/denomination values tie.
    matching.sort_by_key(|item| match item.kind {
        HousingPaymentKind::TradeNote { unit_value, .. } if item.wcid != requirement.wcid => {
            (1, unit_value, item.quantity)
        }
        _ => (0, 0, item.quantity),
    });
    let mut remaining = requirement.remaining;
    let mut consumption = Vec::new();
    let mut spent = 0u64;
    for item in matching {
        if remaining == 0 {
            break;
        }
        let (quantity, value) = match item.kind {
            HousingPaymentKind::Item => {
                let quantity = remaining.min(item.quantity);
                (quantity, u64::from(quantity))
            }
            HousingPaymentKind::TradeNote {
                stack_value,
                unit_value,
            } => {
                if stack_value <= remaining {
                    (item.quantity, u64::from(stack_value))
                } else {
                    // ACE explicitly divides as float before ceiling. Keep its rounding
                    // for the selected set rather than substitute integer ceiling.
                    let quantity = (remaining as f32 / unit_value as f32).ceil() as u32;
                    if quantity > item.quantity {
                        return Err("Trade note value disagrees with its stack quantity".into());
                    }
                    (quantity, u64::from(quantity) * u64::from(unit_value))
                }
            }
        };
        if value == 0 {
            return Err("Selected trade note stack has no payment value".into());
        }
        // ACE stops selecting sources after a rounded partial note, even if float
        // precision made its consumed value fall short. Credit follows actual value
        // (the next profile), rather than treating that stop as full payment.
        remaining = match item.kind {
            HousingPaymentKind::TradeNote { stack_value, .. } if stack_value > remaining => 0,
            _ => remaining.saturating_sub(value.min(u64::from(remaining)) as u32),
        };
        spent += value;
        consumption.push(HousingPaymentConsumption {
            item: item.guid,
            quantity,
            value,
        });
    }
    let credited = spent.min(u64::from(requirement.remaining)) as u32;
    Ok(HousingPaymentLine {
        wcid: requirement.wcid,
        sources,
        consumption,
        credited,
        effective_paid: u64::from(requirement.paid) + u64::from(credited),
        shortfall: requirement.remaining - credited,
        excess: spent - u64::from(credited),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn requirement(wcid: u32, remaining: u32) -> HousingRequirement {
        HousingRequirement {
            wcid,
            required: remaining,
            paid: 0,
            remaining,
            name: "Payment".into(),
            plural_name: "Payments".into(),
        }
    }
    fn item(id: u32, wcid: u32, quantity: u32) -> HousingPaymentItem {
        HousingPaymentItem {
            guid: Guid(id),
            wcid,
            quantity,
            kind: HousingPaymentKind::Item,
        }
    }
    fn note(id: u32, denomination: u32, quantity: u32) -> HousingPaymentItem {
        HousingPaymentItem {
            guid: Guid(id),
            wcid: 1000 + id,
            quantity,
            kind: HousingPaymentKind::TradeNote {
                stack_value: denomination * quantity,
                unit_value: denomination,
            },
        }
    }

    #[test]
    fn coins_precede_notes_and_small_stacks_are_consumed_first() {
        let quote = quote_payment(
            &[requirement(PYREAL_WCID, 13)],
            &[
                note(3, 10, 2),
                item(1, PYREAL_WCID, 8),
                item(2, PYREAL_WCID, 3),
            ],
        )
        .unwrap();
        let line = &quote.lines[0];
        assert_eq!(
            line.consumption
                .iter()
                .map(|source| (source.item, source.quantity))
                .collect::<Vec<_>>(),
            vec![(Guid(2), 3), (Guid(1), 8), (Guid(3), 1)]
        );
        assert_eq!(line.credited, 13);
        assert_eq!(line.excess, 8);
        assert!(quote.complete && quote.contributes);
    }

    #[test]
    fn note_denominations_precede_stack_sizes_in_sort_order() {
        let quote = quote_payment(
            &[requirement(PYREAL_WCID, 35)],
            &[note(1, 20, 1), note(2, 10, 3)],
        )
        .unwrap();
        assert_eq!(quote.lines[0].consumption[0].item, Guid(2));
        assert_eq!(quote.lines[0].consumption[1].quantity, 1);
        assert_eq!(quote.lines[0].excess, 15);
    }

    #[test]
    fn separate_item_requirement_reports_partial_contribution() {
        let mut outstanding = requirement(42, 4);
        outstanding.required = 10;
        outstanding.paid = 6;
        let quote = quote_payment(&[outstanding], &[item(1, 42, 2), item(2, 99, 10)]).unwrap();
        assert!(!quote.complete);
        assert!(quote.contributes);
        assert_eq!(quote.lines[0].shortfall, 2);
        assert_eq!(quote.lines[0].effective_paid, 8);
        assert_eq!(quote.lines[0].consumption.len(), 1);
    }

    #[test]
    fn paid_requirements_do_not_consume_selected_items() {
        let quote = quote_payment(&[requirement(42, 0)], &[item(1, 42, 2)]).unwrap();
        assert!(quote.complete);
        assert!(!quote.contributes);
        assert!(quote.lines[0].consumption.is_empty());
        assert_eq!(quote.lines[0].sources, vec![Guid(1)]);
    }

    #[test]
    fn row_sources_retain_draft_order_and_unused_stacks() {
        let quote = quote_payment(
            &[requirement(42, 2), requirement(99, 1)],
            &[item(1, 42, 8), item(2, 99, 1), item(3, 42, 2)],
        )
        .unwrap();
        assert_eq!(quote.lines[0].sources, vec![Guid(1), Guid(3)]);
        assert_eq!(quote.lines[0].consumption[0].item, Guid(3));
        assert_eq!(quote.lines[0].consumption.len(), 1);
        assert_eq!(quote.lines[1].sources, vec![Guid(2)]);
    }

    #[test]
    fn overlapping_note_requirements_refuse_ambiguous_source_allocation() {
        let source = note(1, 10, 1);
        let error = quote_payment(
            &[requirement(PYREAL_WCID, 10), requirement(source.wcid, 1)],
            &[source],
        )
        .unwrap_err();
        assert_eq!(
            error,
            "A selected payment item matches multiple housing requirements"
        );
    }

    #[test]
    fn float_note_rounding_stops_selection_without_inventing_credit() {
        let quote = quote_payment(
            &[requirement(PYREAL_WCID, 16_777_217)],
            &[note(1, 1, 20_000_000), note(2, 2, 1)],
        )
        .unwrap();
        assert_eq!(quote.lines[0].consumption.len(), 1);
        assert_eq!(quote.lines[0].consumption[0].quantity, 16_777_216);
        assert_eq!(quote.lines[0].shortfall, 1);
        assert!(!quote.complete);
    }

    #[test]
    fn invalid_payment_sources_fail_with_distinct_reasons() {
        let requirement = requirement(PYREAL_WCID, 5);
        let source = item(1, PYREAL_WCID, 10);
        assert_eq!(
            quote_payment(
                std::slice::from_ref(&requirement),
                &[source.clone(), source]
            )
            .unwrap_err(),
            "An inventory object was selected more than once"
        );
        assert_eq!(
            quote_payment(
                std::slice::from_ref(&requirement),
                &[item(1, PYREAL_WCID, 0)]
            )
            .unwrap_err(),
            "A payment stack has no items"
        );
        assert_eq!(
            quote_payment(std::slice::from_ref(&requirement), &[note(1, 0, 1)]).unwrap_err(),
            "Trade note denomination is not positive"
        );
        assert_eq!(
            quote_payment(&[requirement.clone(), requirement], &[]).unwrap_err(),
            "Housing requirements repeat an item template"
        );
    }
}
