//! Coordinated equipment requests; saved snapshots and shortcut policy remain frontend-owned.

use super::{
    ClientRuntime, ClientState,
    equipment_runtime::EQUIPMENT_STEP_TIMEOUT,
    types::{ActionResultReason, ActionResultSource},
};
use super::{
    equipment_plan::{
        EquipmentPlanError, EquipmentReplacement, EquipmentUnequip, resolve_equipment_change,
    },
    inventory_storage::{StorageDestination, allocate_storage_with_reservations},
    types::TargetSlot,
};
use anyhow::Result as RuntimeResult;
use holtburger_common::{
    Guid,
    properties::{EquipMask, WorldObjectExt},
};
use holtburger_protocol::messages::{
    combat::CombatMode,
    game_action::{
        ChangeCombatModeActionData, GameAction, GetAndWieldItemActionData,
        PutItemInContainerActionData,
    },
};
use holtburger_world::context::WorldContextExt;
use holtburger_world::{
    WorldState, context::WorldContext, equipment::MAIN_HAND_LOCATIONS,
    state::storage::StorageLocation,
};
use std::{collections::BTreeMap, time::Instant};

/// One exact item and requested equipment location, independent of saved-loadout metadata.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EquipmentBinding {
    /// Exact player-owned instance, or None to leave the requested location empty.
    pub item: Option<Guid>,
    /// Requested destination; apparel resolution may expand this to full coverage.
    pub target: EquipMask,
}

/// One locally rejected binding; other admissible requests can still be submitted.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct EquipmentSetIssue {
    /// Original request consumed by frontend item/slot feedback.
    pub binding: EquipmentBinding,
    /// Local planning explanation; server admission remains separate.
    pub reason: EquipmentSetIssueReason,
}

/// Distinct equipment-set admission failures, without frontend names or labels.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub(super) enum EquipmentSetIssueReason {
    /// Existing single-item resolution/storage rules rejected the request.
    #[error(transparent)]
    Planning(#[from] EquipmentPlanError),
    /// Two desired bindings would conflict, or one GUID requests different destinations.
    #[error("Requested equipment conflicts with an earlier binding")]
    ConflictingTargets,
}

/// One whole-item wield, retaining all original rows for feedback attribution.
#[derive(Debug)]
pub(super) struct EquipmentSetWield {
    /// Requested identities; multi-slot apparel is wielded only once.
    pub bindings: Vec<EquipmentBinding>,
    /// Resolved whole-item replacement semantics.
    pub replacement: EquipmentReplacement,
}

/// One reserved removal with its original requested-slot attribution.
#[derive(Debug)]
pub(super) struct EquipmentSetRemoval {
    /// Exact whole-item inventory destination.
    pub step: EquipmentUnequip,
    /// Original equip/empty requests consumed by server refusal feedback.
    pub bindings: Vec<EquipmentBinding>,
}

/// Disposable command plan; none of its assumptions mutate authoritative world state.
#[derive(Debug)]
pub(super) struct EquipmentSetPlan {
    /// Each displaced item has exactly one reserved inventory destination.
    pub removals: Vec<EquipmentSetRemoval>,
    /// Admitted equipment requests in caller order; already-satisfied requests are omitted.
    pub wields: Vec<EquipmentSetWield>,
    /// Rejected requests consumed by named per-binding feedback.
    pub issues: Vec<EquipmentSetIssue>,
    /// Hand changes and ammo removals cannot run alongside an unresolved stance request.
    pub requires_stable_stance: bool,
    /// Planned stance-affecting changes need peace when the player began in combat.
    pub requires_peace: bool,
}

/// Plan one best-effort set using confirmed capacity; never assume a future wield frees space.
pub(super) fn plan_equipment_set(
    world: &WorldState,
    bindings: &[EquipmentBinding],
) -> EquipmentSetPlan {
    let mut admitted: Vec<EquipmentSetWield> = Vec::new();
    let mut removals: Vec<EquipmentSetRemoval> = Vec::new();
    let mut reserved: Vec<(StorageDestination, bool)> = Vec::new();
    let mut issues = Vec::new();
    let mut empty_targets = EquipMask::NONE;
    for &binding in bindings {
        let result = match binding.item {
            Some(item) => admit_binding(
                world,
                item,
                binding,
                empty_targets,
                &mut admitted,
                &mut removals,
                &mut reserved,
            ),
            None => admit_empty_binding(world, binding, &admitted, &mut removals, &mut reserved)
                .map(|()| empty_targets |= binding.target),
        };
        if let Err(reason) = result {
            issues.push(EquipmentSetIssue { binding, reason });
        }
    }
    let wields: Vec<_> = admitted
        .into_iter()
        .filter(|entry| {
            world.equipment_mask(entry.replacement.item) != Some(entry.replacement.target)
                || removals
                    .iter()
                    .any(|removal| removal.step.item == entry.replacement.item)
        })
        .collect();
    let hands = MAIN_HAND_LOCATIONS | EquipMask::SHIELD;
    let affects_hands = removals.iter().any(|removal| removal.step.from.intersects(hands))
        || wields.iter().any(|entry| {
            entry.replacement.target.intersects(hands)
                || matches!(entry.replacement.source, StorageLocation::Equipped { mask: Some(mask), .. } if mask.intersects(hands))
        });
    let mode = world.player_combat_mode();
    // ACE changes missile combat to peace after ammunition removal even though
    // equip itself does not shuffle stance (Player_Inventory.cs:438-450).
    let ammo_changes_stance = mode == CombatMode::Missile
        && removals
            .iter()
            .any(|removal| removal.step.from == EquipMask::MISSILE_AMMO);
    let requires_peace = matches!(
        mode,
        CombatMode::Melee | CombatMode::Missile | CombatMode::Magic
    ) && (affects_hands || ammo_changes_stance);
    let requires_stable_stance = affects_hands
        || removals
            .iter()
            .any(|removal| removal.step.from == EquipMask::MISSILE_AMMO);
    EquipmentSetPlan {
        removals,
        wields,
        issues,
        requires_stable_stance,
        requires_peace,
    }
}

/// Admit atomically: rejected requests must neither consume capacity nor schedule removals.
fn admit_binding(
    world: &WorldState,
    item: Guid,
    binding: EquipmentBinding,
    empty_targets: EquipMask,
    admitted: &mut Vec<EquipmentSetWield>,
    removals: &mut Vec<EquipmentSetRemoval>,
    reserved: &mut Vec<(StorageDestination, bool)>,
) -> Result<(), EquipmentSetIssueReason> {
    let incoming =
        resolve_equipment_change(world, item, Some(TargetSlot::EquipMask(binding.target)))?;
    if incoming.target.intersects(empty_targets) {
        return Err(EquipmentSetIssueReason::ConflictingTargets);
    }
    if let Some(previous) = admitted
        .iter_mut()
        .find(|entry| entry.replacement.item == incoming.item)
    {
        if previous.replacement.target != incoming.target {
            return Err(EquipmentSetIssueReason::ConflictingTargets);
        }
        if !previous.bindings.contains(&binding) {
            previous.bindings.push(binding);
        }
        return Ok(());
    }
    if admitted.iter().any(|entry| {
        let previous = &entry.replacement;
        incoming
            .facts
            .conflicts_with(incoming.target, previous.facts, previous.target)
            || previous
                .facts
                .conflicts_with(previous.target, incoming.facts, incoming.target)
    }) {
        return Err(EquipmentSetIssueReason::ConflictingTargets);
    }
    let preferred = match incoming.source {
        StorageLocation::Contained { parent, .. } => parent,
        StorageLocation::Equipped { wearer, .. } => wearer,
    };
    reserve_removals(
        world,
        preferred,
        &incoming.conflicts,
        binding,
        removals,
        reserved,
    )?;
    admitted.push(EquipmentSetWield {
        bindings: vec![binding],
        replacement: incoming,
    });
    Ok(())
}

/// An empty request removes whole items; partial apparel unequips do not exist on the wire.
fn admit_empty_binding(
    world: &WorldState,
    binding: EquipmentBinding,
    admitted: &[EquipmentSetWield],
    removals: &mut Vec<EquipmentSetRemoval>,
    reserved: &mut Vec<(StorageDestination, bool)>,
) -> Result<(), EquipmentSetIssueReason> {
    if binding.target.is_empty() {
        return Err(EquipmentPlanError::InvalidTarget.into());
    }
    if admitted
        .iter()
        .any(|entry| entry.replacement.target.intersects(binding.target))
    {
        return Err(EquipmentSetIssueReason::ConflictingTargets);
    }
    let mut conflicts = Vec::new();
    for item in world.iter_equipment() {
        let mask = world
            .equipment_mask(item)
            .ok_or(EquipmentPlanError::MissingEntity(item))?;
        if mask.intersects(binding.target) {
            conflicts.push((item, mask));
        }
    }
    reserve_removals(
        world,
        world.player.guid,
        &conflicts,
        binding,
        removals,
        reserved,
    )
}

/// Reserve all new removals before attributing any of them, so failure leaves prior requests intact.
fn reserve_removals(
    world: &WorldState,
    preferred: Guid,
    conflicts: &[(Guid, EquipMask)],
    binding: EquipmentBinding,
    removals: &mut Vec<EquipmentSetRemoval>,
    reserved: &mut Vec<(StorageDestination, bool)>,
) -> Result<(), EquipmentSetIssueReason> {
    let new_conflicts: Vec<_> = conflicts
        .iter()
        .copied()
        .filter(|(guid, _)| !removals.iter().any(|removal| removal.step.item == *guid))
        .collect();
    let pack_slots = new_conflicts
        .iter()
        .map(|(guid, _)| {
            world
                .entities
                .get(*guid)
                .map(|entity| entity.uses_player_container_slot())
                .ok_or(EquipmentPlanError::MissingEntity(*guid))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let destinations = allocate_storage_with_reservations(world, preferred, &pack_slots, reserved)
        .map_err(EquipmentPlanError::from)?;
    for (((item, from), destination), pack_slot) in
        new_conflicts.into_iter().zip(destinations).zip(pack_slots)
    {
        removals.push(EquipmentSetRemoval {
            step: EquipmentUnequip {
                item,
                from,
                container: destination.container,
                placement: destination.placement,
            },
            bindings: Vec::new(),
        });
        reserved.push((destination, pack_slot));
    }
    for removal in removals
        .iter_mut()
        .filter(|removal| conflicts.iter().any(|(item, _)| *item == removal.step.item))
    {
        if !removal.bindings.contains(&binding) {
            removal.bindings.push(binding);
        }
    }
    Ok(())
}

/// Equipment submission waits only for peace, never for individual inventory receipts.
#[derive(Debug)]
struct PendingEquipmentPeace {
    /// Original requests are replanned against fresh confirmed state after peace.
    bindings: Vec<EquipmentBinding>,
    /// Bounded prerequisite; timeout submits no equipment changes.
    deadline: Instant,
}

/// Session-owned prerequisite and recent feedback, not a loadout registry or completion job.
#[derive(Debug, Default)]
pub(super) struct EquipmentSetState {
    /// Present only while a hand-affecting swap waits for peace.
    peace: Option<PendingEquipmentPeace>,
    /// Wire item -> requested bindings; latest submission replaces the entire table.
    feedback: BTreeMap<Guid, EquipmentSetAttribution>,
}

/// A displaced desired item can receive both containment and wield responses.
#[derive(Debug, Default)]
struct EquipmentSetAttribution {
    /// Bindings whose preparation depends on removing this wire item.
    removal: Vec<EquipmentBinding>,
    /// Original requests for this wire item's destination.
    wield: Vec<EquipmentBinding>,
}

impl EquipmentSetState {
    pub(super) fn awaiting_peace(&self) -> bool {
        self.peace.is_some()
    }

    /// Authoritative completion retires attribution without triggering further work.
    pub(super) fn confirmed_wield(&mut self, item: Guid) {
        self.feedback.remove(&item);
    }

    /// A successful removal must not retire attribution for a subsequently rejected wield.
    pub(super) fn confirmed_removal(&mut self, item: Guid) {
        if let Some(attribution) = self.feedback.get_mut(&item) {
            attribution.removal.clear();
            if attribution.wield.is_empty() {
                self.feedback.remove(&item);
            }
        }
    }

    /// Unrelated item commands must not inherit a preceding submission's attribution.
    pub(super) fn supersede_item(&mut self, item: Guid) {
        self.feedback.remove(&item);
    }
}

impl ClientRuntime {
    pub(super) fn equipment_change_pending(&self) -> bool {
        self.equipment_operation.is_some() || self.equipment_set.awaiting_peace()
    }

    fn equipment_set_failure(&mut self, bindings: Vec<EquipmentBinding>, message: String) {
        self.emit_action_result(
            ActionResultSource::Client,
            ActionResultReason::EquipmentSet { bindings, message },
        );
    }

    pub(super) async fn apply_equipment_set(
        &mut self,
        bindings: Vec<EquipmentBinding>,
    ) -> RuntimeResult<()> {
        if self.equipment_change_pending()
            || self.pack_exchange.is_some()
            || self.active_busy_operation.is_some()
        {
            self.equipment_set_failure(
                bindings,
                "Another inventory operation is still pending".into(),
            );
            return Ok(());
        }
        if !matches!(self.state, ClientState::InWorld) || self.activation.is_some() {
            self.equipment_set_failure(
                bindings,
                "Equipment changes require an active world".into(),
            );
            return Ok(());
        }
        let plan = plan_equipment_set(&self.world, &bindings);
        if plan.requires_stable_stance && self.pending_combat_mode.is_some() {
            self.equipment_set_failure(
                bindings,
                "A combat-mode request is still pending; activate again after stance confirmation"
                    .into(),
            );
            return Ok(());
        }
        self.equipment_set.feedback.clear();
        if plan.requires_peace {
            self.equipment_set.peace = Some(PendingEquipmentPeace {
                bindings,
                deadline: Instant::now() + EQUIPMENT_STEP_TIMEOUT,
            });
            if let Err(error) = self
                .send_game_action(GameAction::ChangeCombatMode(Box::new(
                    ChangeCombatModeActionData {
                        mode: CombatMode::NonCombat,
                    },
                )))
                .await
            {
                self.equipment_set.peace = None;
                return Err(error);
            }
            return Ok(());
        }
        self.submit_equipment_set(plan, false).await
    }

    pub(super) async fn advance_equipment_set(&mut self, now: Instant) -> RuntimeResult<()> {
        let Some(pending) = self.equipment_set.peace.take() else {
            return Ok(());
        };
        if !matches!(self.state, ClientState::InWorld) || self.activation.is_some() {
            self.equipment_set = Default::default();
            return Ok(());
        }
        let confirmed = self.world.player_combat_mode() == CombatMode::NonCombat;
        if !confirmed && now < pending.deadline {
            self.equipment_set.peace = Some(pending);
            return Ok(());
        }
        if !confirmed {
            self.equipment_set_failure(
                pending.bindings,
                "Timed out waiting for peace; no equipment changes were submitted".into(),
            );
            return Ok(());
        }
        let plan = plan_equipment_set(&self.world, &pending.bindings);
        self.submit_equipment_set(plan, true).await
    }

    /// An explicit stance command supersedes the prerequisite, before any equipment is sent.
    pub(super) fn cancel_equipment_set_peace(&mut self) {
        if let Some(pending) = self.equipment_set.peace.take() {
            self.equipment_set_failure(
                pending.bindings,
                "Equipment submission cancelled by another combat-mode command".into(),
            );
        }
    }

    async fn submit_equipment_set(
        &mut self,
        plan: EquipmentSetPlan,
        resume_combat: bool,
    ) -> RuntimeResult<()> {
        for issue in &plan.issues {
            self.equipment_set_failure(vec![issue.binding], issue.reason.to_string());
        }
        let intended = self
            .world
            .iter_equipment()
            .filter(|guid| {
                !plan
                    .removals
                    .iter()
                    .any(|removal| removal.step.item == *guid)
                    && !plan
                        .wields
                        .iter()
                        .any(|entry| entry.replacement.item == *guid)
            })
            .map(|guid| (guid, self.world.equipment_mask(guid)))
            .chain(
                plan.wields
                    .iter()
                    .map(|entry| (entry.replacement.item, Some(entry.replacement.target))),
            );
        let resume_mode = self.world.get_suggested_combat_mode_for_equipment(intended);
        for removal in &plan.removals {
            self.equipment_set.feedback.insert(
                removal.step.item,
                EquipmentSetAttribution {
                    removal: removal.bindings.clone(),
                    wield: Vec::new(),
                },
            );
        }
        for entry in &plan.wields {
            let feedback = self
                .equipment_set
                .feedback
                .entry(entry.replacement.item)
                .or_default();
            for &binding in &entry.bindings {
                if !feedback.wield.contains(&binding) {
                    feedback.wield.push(binding);
                }
            }
        }
        // The runtime command handler owns the complete burst. No receipt or timer paces it.
        for removal in plan.removals {
            self.send_game_action(GameAction::PutItemInContainer(Box::new(
                PutItemInContainerActionData {
                    item_guid: removal.step.item,
                    container_guid: removal.step.container,
                    placement: removal.step.placement,
                },
            )))
            .await?;
        }
        for entry in plan.wields {
            self.send_game_action(GameAction::GetAndWieldItem(Box::new(
                GetAndWieldItemActionData {
                    item_guid: entry.replacement.item,
                    equip_mask: entry.replacement.target,
                },
            )))
            .await?;
        }
        if resume_combat {
            self.send_game_action(GameAction::ChangeCombatMode(Box::new(
                ChangeCombatModeActionData { mode: resume_mode },
            )))
            .await?;
        }
        Ok(())
    }

    /// Consume a relevant refusal; ordinary feedback handles unrelated wire items.
    pub(super) fn reject_equipment_set_item(
        &mut self,
        item: Guid,
        error: holtburger_protocol::errors::WeenieError,
    ) -> bool {
        let Some(attribution) = self.equipment_set.feedback.remove(&item) else {
            return false;
        };
        let mut bindings = attribution.removal;
        for binding in attribution.wield {
            if !bindings.contains(&binding) {
                bindings.push(binding);
            }
        }
        let message = if error == holtburger_protocol::errors::WeenieError::None {
            "The server rejected the equipment request".into()
        } else {
            crate::errors::format_weenie_error(error, None)
        };
        self.equipment_set_failure(bindings, message);
        true
    }
}

#[cfg(test)]
mod tests {
    use super::super::{
        builder::build_test_client,
        equipment_plan::tests::{event, outfit},
    };
    use super::*;
    use holtburger_common::properties::{ItemType, PropertyInt};
    use holtburger_protocol::messages::GameEvent;

    const PLAYER: Guid = Guid(1);
    const INCOMING: Guid = Guid(3);

    #[tokio::test]
    async fn pending_stance_rejects_hand_activation_without_equipment_commands() {
        let mut client = build_test_client(ClientState::InWorld);
        client.world = weapon_world(CombatMode::NonCombat);
        let mut events = client.subscribe_client_view_events();
        client
            .handle_command(super::super::types::ClientCommand::SetCombatMode(
                CombatMode::Magic,
            ))
            .await
            .unwrap();
        assert_eq!(client.pending_combat_mode, Some(CombatMode::Magic));
        client
            .apply_equipment_set(vec![binding(INCOMING, EquipMask::MELEE_WEAPON)])
            .await
            .unwrap();
        assert_eq!(client.session.game_action_sequence, 1);
        assert!(!client.equipment_set.awaiting_peace());
        assert_eq!(client.world.equipment_mask(INCOMING), None);
        assert!(std::iter::from_fn(|| events.try_recv().ok()).any(|event| matches!(event,
            super::super::types::ClientViewEvent::ActionResult { reason: ActionResultReason::EquipmentSet { message, .. }, .. }
                if message.contains("combat-mode request is still pending"))));
        client.handle_world_event(&holtburger_world::WorldEvent::CombatModeUpdated(
            CombatMode::Magic,
        ));
        client
            .world
            .entities
            .get_mut(PLAYER)
            .unwrap()
            .properties
            .ints
            .insert(PropertyInt::CombatMode, CombatMode::Magic as i32);
        client
            .apply_equipment_set(vec![binding(INCOMING, EquipMask::MELEE_WEAPON)])
            .await
            .unwrap();
        assert!(client.equipment_set.awaiting_peace());
        assert_eq!(client.session.game_action_sequence, 2);
    }

    #[tokio::test]
    async fn stance_requests_coalesce_and_retire_on_confirmation_or_denial() {
        let mut client = build_test_client(ClientState::InWorld);
        client.world = weapon_world(CombatMode::NonCombat);
        for mode in [CombatMode::Magic, CombatMode::Magic, CombatMode::Melee] {
            client
                .handle_command(super::super::types::ClientCommand::SetCombatMode(mode))
                .await
                .unwrap();
        }
        assert_eq!(client.session.game_action_sequence, 1);
        assert_eq!(client.pending_combat_mode, Some(CombatMode::Magic));
        client.handle_world_event(&holtburger_world::WorldEvent::CombatModeUpdated(
            CombatMode::Melee,
        ));
        assert_eq!(client.pending_combat_mode, Some(CombatMode::Magic));
        client.handle_world_event(&holtburger_world::WorldEvent::CombatModeUpdated(
            CombatMode::NonCombat,
        ));
        assert_eq!(client.pending_combat_mode, None);
        client
            .handle_command(super::super::types::ClientCommand::SetCombatMode(
                CombatMode::Magic,
            ))
            .await
            .unwrap();
        client.start_world_activation(super::super::ClientWorldActivationState::Teleport, PLAYER);
        assert_eq!(client.pending_combat_mode, None);
    }

    #[tokio::test]
    async fn pending_stance_does_not_block_armor_only_sets() {
        let mut client = build_test_client(ClientState::InWorld);
        client.world = outfit(2, 1);
        client
            .handle_command(super::super::types::ClientCommand::SetCombatMode(
                CombatMode::Magic,
            ))
            .await
            .unwrap();
        client
            .apply_equipment_set(vec![binding(INCOMING, EquipMask::CHEST_ARMOR)])
            .await
            .unwrap();
        assert_eq!(client.session.game_action_sequence, 4);
        assert_eq!(client.pending_combat_mode, Some(CombatMode::Magic));
        assert!(!client.equipment_set.awaiting_peace());
    }

    fn empty(target: EquipMask) -> EquipmentBinding {
        EquipmentBinding { item: None, target }
    }

    #[test]
    fn empty_bindings_remove_whole_items_once_and_keep_slot_attribution() {
        let world = outfit(2, 1);
        let requested = [
            empty(EquipMask::CHEST_ARMOR),
            empty(EquipMask::UPPER_ARM_ARMOR),
        ];
        let plan = plan_equipment_set(&world, &requested);
        assert!(plan.issues.is_empty());
        assert!(plan.wields.is_empty());
        assert_eq!(plan.removals.len(), 2);
        assert_eq!(plan.removals[0].bindings, vec![requested[0]]);
        assert_eq!(plan.removals[1].bindings, vec![requested[1]]);
        let mut world = world;
        let coverage = EquipMask::CHEST_ARMOR | EquipMask::FOOT_WEAR;
        event(
            &mut world,
            GameEvent::WieldObject(Box::new(
                holtburger_protocol::messages::WieldObjectEventData {
                    object_guid: Guid(4),
                    equip_mask: coverage,
                },
            )),
        );
        let partial = plan_equipment_set(&world, &[empty(EquipMask::FOOT_WEAR)]);
        assert_eq!(partial.removals.len(), 1);
        assert_eq!(partial.removals[0].step.from, coverage);
        assert!(partial.wields.is_empty());
    }

    #[test]
    fn empty_and_occupied_requests_conflict_in_either_order() {
        let world = outfit(2, 1);
        let clear = empty(EquipMask::CHEST_ARMOR);
        let equip = binding(INCOMING, EquipMask::CHEST_ARMOR);
        for requested in [[clear, equip], [equip, clear]] {
            let plan = plan_equipment_set(&world, &requested);
            assert_eq!(plan.issues.len(), 1);
            assert_eq!(plan.issues[0].binding, requested[1]);
            assert_eq!(
                plan.issues[0].reason,
                EquipmentSetIssueReason::ConflictingTargets
            );
        }
    }

    #[test]
    fn capacity_failure_for_empty_binding_does_not_block_other_equips() {
        let mut world = outfit(0, 1);
        let incoming = world.entities.get_mut(INCOMING).unwrap();
        incoming.properties.ints.insert(
            PropertyInt::ValidLocations,
            EquipMask::NECK_WEAR.bits() as i32,
        );
        incoming
            .properties
            .ints
            .insert(PropertyInt::ItemType, ItemType::JEWELRY.bits() as i32);
        let clear = empty(EquipMask::CHEST_ARMOR);
        let plan = plan_equipment_set(&world, &[clear, binding(INCOMING, EquipMask::NECK_WEAR)]);
        assert_eq!(plan.issues.len(), 1);
        assert_eq!(plan.issues[0].binding, clear);
        assert!(plan.removals.is_empty());
        assert_eq!(plan.wields.len(), 1);
    }

    #[tokio::test]
    async fn hand_clear_uses_peace_and_attributes_a_removal_refusal_to_empty_slot() {
        let mut client = build_test_client(ClientState::InWorld);
        client.world = weapon_world(CombatMode::Melee);
        event(
            &mut client.world,
            GameEvent::WieldObject(Box::new(
                holtburger_protocol::messages::WieldObjectEventData {
                    object_guid: INCOMING,
                    equip_mask: EquipMask::MELEE_WEAPON,
                },
            )),
        );
        let requested = empty(MAIN_HAND_LOCATIONS);
        client.apply_equipment_set(vec![requested]).await.unwrap();
        assert!(client.equipment_set.awaiting_peace());
        client
            .world
            .entities
            .get_mut(PLAYER)
            .unwrap()
            .properties
            .ints
            .insert(PropertyInt::CombatMode, CombatMode::NonCombat as i32);
        client.handle_world_event(&holtburger_world::WorldEvent::CombatModeUpdated(
            CombatMode::NonCombat,
        ));
        client.advance_equipment_set(Instant::now()).await.unwrap();
        assert_eq!(client.session.game_action_sequence, 3);
        assert_eq!(client.equipment_set.feedback.len(), 1);
        assert!(
            client
                .equipment_set
                .feedback
                .values()
                .all(|attribution| attribution.removal == vec![requested])
        );
        let removed = *client.equipment_set.feedback.keys().next().unwrap();
        assert!(
            client
                .reject_equipment_set_item(removed, holtburger_protocol::errors::WeenieError::None)
        );
    }

    #[test]
    fn containment_does_not_clear_a_desired_items_later_wield_failure() {
        let incoming = binding(INCOMING, EquipMask::SHIELD);
        let dependent = binding(Guid(4), EquipMask::MELEE_WEAPON);
        let mut state = EquipmentSetState::default();
        state.feedback.insert(
            INCOMING,
            EquipmentSetAttribution {
                removal: vec![dependent],
                wield: vec![incoming],
            },
        );
        state.confirmed_removal(INCOMING);
        let remaining = state.feedback.get(&INCOMING).unwrap();
        assert!(remaining.removal.is_empty());
        assert_eq!(remaining.wield, vec![incoming]);
        state.confirmed_wield(INCOMING);
        assert!(state.feedback.is_empty());
    }

    fn binding(item: Guid, target: EquipMask) -> EquipmentBinding {
        EquipmentBinding {
            item: Some(item),
            target,
        }
    }

    fn weapon_world(mode: CombatMode) -> WorldState {
        let mut world = outfit(2, 1);
        world
            .entities
            .get_mut(PLAYER)
            .unwrap()
            .properties
            .ints
            .insert(PropertyInt::CombatMode, mode as i32);
        let incoming = world.entities.get_mut(INCOMING).unwrap();
        incoming
            .properties
            .ints
            .0
            .remove(&PropertyInt::ClothingPriority);
        incoming.properties.ints.insert(
            PropertyInt::ValidLocations,
            EquipMask::MELEE_WEAPON.bits() as i32,
        );
        incoming
            .properties
            .ints
            .insert(PropertyInt::ItemType, ItemType::MELEE_WEAPON.bits() as i32);
        world
    }

    #[test]
    fn apparel_rows_collapse_to_one_wield_and_unique_removals() {
        let world = outfit(2, 1);
        let plan = plan_equipment_set(
            &world,
            &[
                binding(INCOMING, EquipMask::CHEST_ARMOR),
                binding(INCOMING, EquipMask::UPPER_ARM_ARMOR),
            ],
        );
        assert!(plan.issues.is_empty());
        assert_eq!(plan.wields.len(), 1);
        assert_eq!(plan.wields[0].bindings.len(), 2);
        assert_eq!(plan.removals.len(), 2);
        assert_ne!(
            plan.removals[0].step.placement,
            plan.removals[1].step.placement
        );
        assert!(!plan.requires_peace);
        assert_eq!(world.equipment_mask(INCOMING), None);
    }

    #[test]
    fn missing_and_conflicting_requests_do_not_prevent_valid_binding() {
        let world = outfit(2, 1);
        let plan = plan_equipment_set(
            &world,
            &[
                binding(Guid(99), EquipMask::CHEST_ARMOR),
                binding(INCOMING, EquipMask::CHEST_ARMOR),
                binding(Guid(4), EquipMask::CHEST_ARMOR),
            ],
        );
        assert_eq!(plan.wields.len(), 1);
        assert_eq!(plan.issues.len(), 2);
        assert_eq!(
            plan.issues[1].reason,
            EquipmentSetIssueReason::ConflictingTargets
        );
    }

    #[test]
    fn satisfied_bindings_send_nothing_and_protect_desired_compatibility() {
        let world = outfit(2, 1);
        let plan = plan_equipment_set(&world, &[binding(Guid(4), EquipMask::CHEST_ARMOR)]);
        assert!(plan.wields.is_empty());
        assert!(plan.removals.is_empty());
        assert!(!plan.requires_peace);
    }

    #[test]
    fn full_storage_rejects_only_requests_requiring_displacement() {
        let world = outfit(0, 1);
        let plan = plan_equipment_set(
            &world,
            &[
                binding(INCOMING, EquipMask::CHEST_ARMOR),
                binding(Guid(4), EquipMask::CHEST_ARMOR),
            ],
        );
        assert_eq!(plan.issues.len(), 1);
        assert!(plan.wields.is_empty());
        assert!(plan.removals.is_empty());
    }

    #[tokio::test]
    async fn hand_swap_waits_for_peace_once_then_sends_without_wield_receipts() {
        let mut client = build_test_client(ClientState::InWorld);
        client.world = weapon_world(CombatMode::Magic);
        client
            .apply_equipment_set(vec![binding(INCOMING, EquipMask::MELEE_WEAPON)])
            .await
            .unwrap();
        assert!(client.equipment_set.awaiting_peace());
        assert_eq!(client.session.game_action_sequence, 1);
        client.advance_equipment_set(Instant::now()).await.unwrap();
        assert_eq!(client.session.game_action_sequence, 1);
        client
            .world
            .entities
            .get_mut(PLAYER)
            .unwrap()
            .properties
            .ints
            .insert(PropertyInt::CombatMode, CombatMode::NonCombat as i32);
        client.handle_world_event(&holtburger_world::WorldEvent::CombatModeUpdated(
            CombatMode::NonCombat,
        ));
        client.advance_equipment_set(Instant::now()).await.unwrap();
        assert!(!client.equipment_set.awaiting_peace());
        // Peace, whole-item wield, and equipment-derived combat restoration.
        assert_eq!(client.session.game_action_sequence, 3);
        assert_eq!(client.world.equipment_mask(INCOMING), None);
        assert!(
            client.reject_equipment_set_item(
                INCOMING,
                holtburger_protocol::errors::WeenieError::None
            )
        );
    }

    #[tokio::test]
    async fn hand_swap_started_in_peace_stays_in_peace() {
        let mut client = build_test_client(ClientState::InWorld);
        client.world = weapon_world(CombatMode::NonCombat);
        client
            .apply_equipment_set(vec![binding(INCOMING, EquipMask::MELEE_WEAPON)])
            .await
            .unwrap();
        assert!(!client.equipment_set.awaiting_peace());
        assert_eq!(client.session.game_action_sequence, 1);
    }

    #[test]
    fn ammunition_removal_requires_peace_only_in_missile_combat() {
        for mode in [
            CombatMode::Missile,
            CombatMode::Melee,
            CombatMode::NonCombat,
        ] {
            let mut world = weapon_world(mode);
            for guid in [INCOMING, Guid(4)] {
                let item = world.entities.get_mut(guid).unwrap();
                item.properties
                    .ints
                    .0
                    .remove(&PropertyInt::ClothingPriority);
                item.properties.ints.insert(
                    PropertyInt::ValidLocations,
                    EquipMask::MISSILE_AMMO.bits() as i32,
                );
                item.properties.ints.insert(
                    PropertyInt::ItemType,
                    ItemType::MISSILE_WEAPON.bits() as i32,
                );
            }
            event(
                &mut world,
                GameEvent::WieldObject(Box::new(
                    holtburger_protocol::messages::WieldObjectEventData {
                        object_guid: Guid(4),
                        equip_mask: EquipMask::MISSILE_AMMO,
                    },
                )),
            );
            let plan = plan_equipment_set(&world, &[binding(INCOMING, EquipMask::MISSILE_AMMO)]);
            assert!(plan.issues.is_empty());
            assert_eq!(plan.requires_peace, mode == CombatMode::Missile);
        }
    }

    #[tokio::test]
    async fn confirmed_peace_replans_before_sending_equipment() {
        let mut client = build_test_client(ClientState::InWorld);
        client.world = weapon_world(CombatMode::Magic);
        client
            .apply_equipment_set(vec![binding(INCOMING, EquipMask::MELEE_WEAPON)])
            .await
            .unwrap();
        client
            .world
            .entities
            .get_mut(INCOMING)
            .unwrap()
            .properties
            .ints
            .insert(
                PropertyInt::ValidLocations,
                EquipMask::NECK_WEAR.bits() as i32,
            );
        client
            .world
            .entities
            .get_mut(PLAYER)
            .unwrap()
            .properties
            .ints
            .insert(PropertyInt::CombatMode, CombatMode::NonCombat as i32);
        client.handle_world_event(&holtburger_world::WorldEvent::CombatModeUpdated(
            CombatMode::NonCombat,
        ));
        client.advance_equipment_set(Instant::now()).await.unwrap();
        assert!(!client.equipment_set.awaiting_peace());
        // The invalidated binding sends nothing: only peace and combat restoration were requested.
        assert_eq!(client.session.game_action_sequence, 2);
        assert!(client.equipment_set.feedback.is_empty());
    }

    #[tokio::test]
    async fn armor_change_in_combat_does_not_enter_peace_or_wait_for_removal_receipts() {
        let mut client = build_test_client(ClientState::InWorld);
        client.world = outfit(2, 1);
        client
            .world
            .entities
            .get_mut(PLAYER)
            .unwrap()
            .properties
            .ints
            .insert(PropertyInt::CombatMode, CombatMode::Magic as i32);
        client
            .apply_equipment_set(vec![binding(INCOMING, EquipMask::CHEST_ARMOR)])
            .await
            .unwrap();
        assert!(!client.equipment_set.awaiting_peace());
        assert_eq!(client.session.game_action_sequence, 3);
        assert_eq!(
            client.world.equipment_mask(Guid(4)),
            Some(EquipMask::CHEST_ARMOR)
        );
    }

    #[tokio::test]
    async fn peace_timeout_sends_no_equipment_and_lifecycle_retires_prerequisite() {
        let mut client = build_test_client(ClientState::InWorld);
        client.world = weapon_world(CombatMode::Magic);
        client
            .apply_equipment_set(vec![binding(INCOMING, EquipMask::MELEE_WEAPON)])
            .await
            .unwrap();
        let deadline = client.equipment_set.peace.as_ref().unwrap().deadline;
        client.advance_equipment_set(deadline).await.unwrap();
        assert!(!client.equipment_set.awaiting_peace());
        assert_eq!(client.session.game_action_sequence, 1);
        client.handle_world_event(&holtburger_world::WorldEvent::CombatModeUpdated(
            CombatMode::NonCombat,
        ));
        client
            .apply_equipment_set(vec![binding(INCOMING, EquipMask::MELEE_WEAPON)])
            .await
            .unwrap();
        client.set_exit_cause(super::super::types::ClientExitCause::ExplicitDisconnect);
        assert!(!client.equipment_set.awaiting_peace());
        assert!(client.equipment_set.feedback.is_empty());
    }

    #[test]
    fn paired_jewelry_swaps_reserve_each_displacement_once() {
        for (left, right) in [
            (EquipMask::FINGER_WEAR_LEFT, EquipMask::FINGER_WEAR_RIGHT),
            (EquipMask::WRIST_WEAR_LEFT, EquipMask::WRIST_WEAR_RIGHT),
        ] {
            let mut world = outfit(2, 1);
            for (item, mask) in [(Guid(4), left), (Guid(5), right)] {
                let entity = world.entities.get_mut(item).unwrap();
                entity
                    .properties
                    .ints
                    .insert(PropertyInt::ValidLocations, (left | right).bits() as i32);
                entity
                    .properties
                    .ints
                    .insert(PropertyInt::ItemType, ItemType::JEWELRY.bits() as i32);
                event(
                    &mut world,
                    GameEvent::WieldObject(Box::new(
                        holtburger_protocol::messages::WieldObjectEventData {
                            object_guid: item,
                            equip_mask: mask,
                        },
                    )),
                );
            }
            let plan =
                plan_equipment_set(&world, &[binding(Guid(4), right), binding(Guid(5), left)]);
            assert!(plan.issues.is_empty());
            assert_eq!(plan.removals.len(), 2);
            assert_eq!(plan.wields.len(), 2);
            assert_ne!(plan.removals[0].step.item, plan.removals[1].step.item);
            assert_ne!(
                plan.removals[0].step.placement,
                plan.removals[1].step.placement
            );
            assert_eq!(plan.wields[0].replacement.target, right);
            assert_eq!(plan.wields[1].replacement.target, left);
            assert!(!plan.requires_stable_stance);
            assert!(!plan.requires_peace);
        }
    }

    #[test]
    fn a_moved_equipped_item_requests_its_explicit_new_side() {
        let mut world = weapon_world(CombatMode::NonCombat);
        event(
            &mut world,
            GameEvent::WieldObject(Box::new(
                holtburger_protocol::messages::WieldObjectEventData {
                    object_guid: INCOMING,
                    equip_mask: EquipMask::MELEE_WEAPON,
                },
            )),
        );
        let plan = plan_equipment_set(&world, &[binding(INCOMING, EquipMask::SHIELD)]);
        assert!(plan.issues.is_empty());
        assert!(plan.removals.is_empty());
        assert_eq!(plan.wields[0].replacement.target, EquipMask::SHIELD);
    }
}
