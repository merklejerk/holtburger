//! Request correlation and close coordination for external storage access.

use std::time::{Duration, Instant};

use anyhow::Result;
use holtburger_common::{
    Guid,
    properties::{ItemType, ObjectDescriptionFlag, WorldObjectExt},
};
use holtburger_protocol::messages::{
    GameAction, GameEvent, GameMessage, NoLongerViewingContentsActionData,
};
use holtburger_world::context::WorldContextExt;

use super::{
    ClientRuntime, ClientState, PendingOperation,
    types::{ActionResultReason, ActionResultSource, ClientViewEvent},
};

/// Small session-local FIFO with deduplicated membership for corpse convenience state.
#[derive(Default)]
pub(super) struct OpenedCorpseHistory {
    order: std::collections::VecDeque<Guid>,
    members: std::collections::BTreeSet<Guid>,
}

impl OpenedCorpseHistory {
    const LIMIT: usize = 100;

    fn remember(&mut self, guid: Guid) -> Option<Guid> {
        if !self.members.insert(guid) {
            return None;
        }
        self.order.push_back(guid);
        if self.order.len() <= Self::LIMIT {
            return None;
        }
        let expired = self
            .order
            .pop_front()
            .expect("corpse history above its limit must contain an oldest GUID");
        self.members.remove(&expired);
        Some(expired)
    }

    fn iter(&self) -> impl Iterator<Item = Guid> + '_ {
        self.order.iter().copied()
    }

    pub(super) fn ids(&self) -> &std::collections::BTreeSet<Guid> {
        &self.members
    }

    fn clear(&mut self) {
        self.order.clear();
        self.members.clear();
    }
}

/// Limit pending-close admission, not a claim that the server completed its animation.
const CONTAINER_CLOSE_TIMEOUT: Duration = Duration::from_secs(10);

impl ClientRuntime {
    /// Root eligibility independent of cached lock/openability flags.
    fn is_external_root(&self, guid: Guid) -> bool {
        self.world.get_visible_entity(guid).is_some_and(|entity| {
            !entity.flags.contains(ObjectDescriptionFlag::VENDOR)
                && !self.world.is_owned_by_player(guid)
                && self.world.storage_location(guid).is_none()
        })
    }

    pub(super) async fn prepare_container_use(&mut self, source: Guid) -> Result<()> {
        self.poll_container_close_timeout(Instant::now());
        anyhow::ensure!(
            !self.closing_containers.contains_key(&source),
            "This container is still closing. Try again after it closes."
        );
        // Only storage candidates replace another surface before the server responds.
        let storage_candidate = self.world.get_visible_entity(source).is_some_and(|entity| {
            entity.flags.contains(ObjectDescriptionFlag::OPENABLE)
                || entity
                    .item_type()
                    .is_some_and(|kind| kind.contains(ItemType::CONTAINER))
        });
        if !storage_candidate || !self.is_external_root(source) {
            return Ok(());
        }
        self.replace_container_surface(source).await
    }

    /// Apply peer replacement at both early preparation and authoritative confirmation.
    /// Cached descriptions can miss a storage candidate; a confirmed open still owns this rule.
    async fn replace_container_surface(&mut self, source: Guid) -> Result<()> {
        if let Some(root) = self.world.world_container().root()
            && root != source
        {
            self.close_container(root).await?;
        }
        if self.world.vendor.take().is_some() {
            let _ = self
                .client_view_event_tx
                .send(ClientViewEvent::VendorStateUpdated { vendor: None });
        }
        Ok(())
    }

    // RETAIL DIVERGENCE: acclient.c:242368/242498 hides the panel through UseObject,
    // while :384417 switches roots through NoLongerViewingContents. Use can activate a
    // hidden hook's item instead of closing it. All our close paths use the explicit viewer
    // close supported by ACE Player_Use::HandleActionNoLongerViewingContents. Source-path
    // census: dismissal, container/vendor switching, range exit, teleport, and root transfer.
    pub(super) async fn close_container(&mut self, root: Guid) -> Result<()> {
        if self.world.world_container().root() != Some(root) {
            return Ok(());
        }
        self.world.close_world_container();
        self.send_container_close(root).await
    }

    /// World may already have revoked access during an authoritative lifetime transition.
    async fn send_container_close(&mut self, root: Guid) -> Result<()> {
        if matches!(
            self.state,
            ClientState::Disconnected | ClientState::CharacterSelection(_)
        ) {
            self.publish_entity_facts();
            return Ok(());
        }
        self.closing_containers
            .insert(root, Instant::now() + CONTAINER_CLOSE_TIMEOUT);
        let result = self
            .send_game_action(GameAction::NoLongerViewingContents(Box::new(
                NoLongerViewingContentsActionData {
                    container_guid: root,
                },
            )))
            .await;
        if result.is_err() {
            self.closing_containers.remove(&root);
        }
        self.publish_entity_facts();
        result
    }

    /// Sampled by the shared runtime's existing one-second network cadence.
    pub(super) async fn maintain_container_range(&mut self) -> Result<()> {
        if self.state == ClientState::InWorld
            && self.activation.is_none()
            && let Some(root) = self.world.world_container().root()
            && self.world.within_use_radius(self.world.player.guid, root) == Some(false)
        {
            self.close_container(root).await?;
        }
        Ok(())
    }

    /// Terminal character/session transitions cannot wait for, or send, old close requests.
    pub(super) fn reset_container_access(&mut self) {
        self.world.close_world_container();
        self.world.clear_inventory_transfers();
        self.closing_containers.clear();
        for guid in self.opened_corpses.iter() {
            self.entity_facts.invalidate(guid);
        }
        self.opened_corpses.clear();
        self.publish_entity_facts();
    }

    pub(super) fn poll_container_close_timeout(&mut self, now: Instant) {
        let previous = self.closing_containers.len();
        self.closing_containers
            .retain(|_, deadline| now < *deadline);
        if self.closing_containers.len() != previous {
            self.emit_action_result(ActionResultSource::Client, ActionResultReason::General(
                "Container close was not confirmed. Access remains closed; you may try using the container again.".into(),
            ));
        }
    }

    /// Roster storage has already been accepted by world; only a matching use grants access.
    pub(super) async fn observe_container_message(
        &mut self,
        message: &GameMessage,
        previous_root: Option<Guid>,
    ) -> Result<()> {
        let teleported = matches!(message, GameMessage::PlayerTeleport(_));
        if teleported
            && self
                .active_busy_operation
                .as_ref()
                .is_some_and(|pending| matches!(pending.operation, PendingOperation::Use { .. }))
        {
            self.clear_busy_operation();
        }
        if let Some(root) = previous_root
            && self.world.world_container().root() != Some(root)
            && (teleported
                || (self.world.get_visible_entity(root).is_some()
                    && self.world.storage_location(root).is_some()))
        {
            self.send_container_close(root).await?;
        }
        if let GameMessage::GameEvent(event) = message {
            match &event.event {
                GameEvent::ViewContents(data) => {
                    let matches_use = self.active_busy_operation.as_ref().is_some_and(|pending| {
                        matches!(pending.operation, PendingOperation::Use { source } if source == data.container)
                            && pending.pending_error.is_none()
                    });
                    // RETAIL DIVERGENCE: acclient.c:413266 gates ground containers on OPENABLE.
                    // ACE Lock.cs unlocks with a Locked property update, leaving that description
                    // flag stale. Trust the correlated server roster instead. Source-path census:
                    // key unlock, lockpick unlock, and root ViewContents admission; no content
                    // can observe a difference except that successful opens now display contents.
                    if matches_use
                        && self.state == ClientState::InWorld
                        && self.activation.is_none()
                        && self.is_external_root(data.container)
                        && !self.closing_containers.contains_key(&data.container)
                    {
                        self.replace_container_surface(data.container).await?;
                        self.world.confirm_world_container(data.container);
                        if self
                            .world
                            .get_visible_entity(data.container)
                            .is_some_and(|entity| {
                                entity.flags.contains(
                                    holtburger_common::properties::ObjectDescriptionFlag::CORPSE,
                                )
                            })
                        {
                            if let Some(expired) = self.opened_corpses.remember(data.container) {
                                self.entity_facts.invalidate(expired);
                            }
                            self.entity_facts.invalidate(data.container);
                        }
                    }
                }
                GameEvent::CloseGroundContainer(data) => {
                    self.closing_containers.remove(&data.container_guid);
                }
                GameEvent::ApproachVendor(_) => {
                    if let Some(root) = self.world.world_container().root() {
                        self.close_container(root).await?;
                    }
                }
                _ => {}
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::client::builder::build_test_client;
    use holtburger_common::properties::{InventoryEntryKind, ItemType, PropertyInt};
    use holtburger_protocol::{
        errors::WeenieError,
        messages::{
            ApproachVendorEventData, CloseGroundContainerEventData, GameEventMessage,
            UseDoneEventData, ViewContentsEventData, ViewContentsEventItem,
        },
    };
    use holtburger_world::{entity::Entity, item_use::ItemUseIntent};

    const ROOT: Guid = Guid(0x80000010);
    const OTHER: Guid = Guid(0x80000011);
    const PACK: Guid = Guid(0x80000012);
    const PLAYER: Guid = Guid(0x50000001);

    fn fixture() -> ClientRuntime {
        let mut client = build_test_client(ClientState::InWorld);
        client.world.player.guid = PLAYER;
        for guid in [ROOT, OTHER, PACK] {
            let mut entity = Entity::new(guid, "Container".into(), Default::default());
            entity.flags = ObjectDescriptionFlag::OPENABLE;
            entity
                .properties
                .ints
                .insert(PropertyInt::ItemType, ItemType::CONTAINER.bits() as i32);
            client.world.add_entity(entity);
        }
        client
    }

    fn roster(root: Guid, children: &[Guid]) -> GameEvent {
        GameEvent::ViewContents(Box::new(ViewContentsEventData {
            container: root,
            items: children
                .iter()
                .map(|&guid| ViewContentsEventItem {
                    guid,
                    container_type: InventoryEntryKind::Container,
                })
                .collect(),
        }))
    }

    #[test]
    fn opened_corpse_history_is_bounded_and_deduplicated() {
        let mut history = OpenedCorpseHistory::default();
        for value in 0..OpenedCorpseHistory::LIMIT {
            assert_eq!(history.remember(Guid(value as u32)), None);
        }
        assert_eq!(
            history.remember(Guid((OpenedCorpseHistory::LIMIT / 2) as u32)),
            None
        );
        let newest = Guid(OpenedCorpseHistory::LIMIT as u32);
        assert_eq!(history.remember(newest), Some(Guid(0)));
        assert_eq!(history.order.len(), OpenedCorpseHistory::LIMIT);
        assert!(!history.ids().contains(&Guid(0)));
        assert!(history.ids().contains(&newest));
    }

    async fn receive(client: &mut ClientRuntime, event: GameEvent) {
        use holtburger_protocol::traits::ProtocolPack;
        let message = GameMessage::GameEvent(Box::new(GameEventMessage {
            target: PLAYER,
            sequence: 0,
            event,
        }));
        let mut bytes = Vec::new();
        message.pack(&mut bytes);
        client.handle_message(&bytes).await.unwrap();
    }

    async fn use_root(client: &mut ClientRuntime, root: Guid) {
        assert!(
            client
                .dispatch_item_use(&ItemUseIntent::Direct {
                    source: root,
                    unrestricted: false
                })
                .await
                .unwrap()
        );
    }

    #[tokio::test]
    async fn walking_out_of_prepared_use_range_closes_once_but_loading_does_not() {
        use holtburger_common::{Vector3, position::WorldPosition};
        use holtburger_world::{PhysicalCollisionFilter, SpatialBodyId};
        let mut client = fixture();
        let pose = WorldPosition {
            landblock_id: Guid(0xda55_0020),
            ..Default::default()
        };
        client
            .world
            .seed_local_player_entity(PLAYER, "Player", pose);
        client.world.add_entity(Entity::new(
            ROOT,
            "Chest".into(),
            WorldPosition {
                coords: Vector3::new(3.0, 0.0, 0.0),
                ..pose
            },
        ));
        client.world.confirm_world_container(ROOT);
        client.maintain_container_range().await.unwrap();
        assert_eq!(client.world.world_container().root(), Some(ROOT));
        let definition = crate::client::tests::stable_dynamic_body_definition();
        for guid in [PLAYER, ROOT] {
            client
                .world
                .scene
                .set_dynamic_physical_body(
                    if guid == PLAYER {
                        SpatialBodyId::LocalPlayer(guid)
                    } else {
                        SpatialBodyId::Entity(guid)
                    },
                    Some(definition.clone()),
                    PhysicalCollisionFilter::ALL,
                    None,
                )
                .unwrap();
        }
        let actions = client.session.game_action_sequence;
        client.maintain_container_range().await.unwrap();
        assert_eq!(client.world.world_container().root(), None);
        assert!(client.closing_containers.contains_key(&ROOT));
        assert_eq!(client.session.game_action_sequence, actions + 1);
        client.maintain_container_range().await.unwrap();
        assert_eq!(client.session.game_action_sequence, actions + 1);
    }

    #[tokio::test]
    async fn teleport_closes_and_late_use_roster_cannot_reopen_old_access() {
        use holtburger_protocol::{messages::PlayerTeleportData, traits::ProtocolPack};
        let mut client = fixture();
        use_root(&mut client, ROOT).await;
        receive(&mut client, roster(ROOT, &[PACK])).await;
        let actions = client.session.game_action_sequence;
        let mut bytes = Vec::new();
        GameMessage::PlayerTeleport(Box::new(PlayerTeleportData {
            teleport_sequence: 1,
        }))
        .pack(&mut bytes);
        client.handle_message(&bytes).await.unwrap();
        assert_eq!(client.world.world_container().root(), None);
        assert!(!client.world.is_world_container_content(PACK));
        assert!(client.active_busy_operation.is_none());
        assert_eq!(client.session.game_action_sequence, actions + 1);
        receive(&mut client, roster(ROOT, &[PACK])).await;
        assert_eq!(client.world.world_container().root(), None);
    }

    #[tokio::test]
    async fn root_transfer_closes_but_retains_newly_owned_contents() {
        use holtburger_protocol::messages::InventoryPutObjInContainerEventData;
        let mut client = fixture();
        receive(&mut client, roster(ROOT, &[PACK])).await;
        client.world.confirm_world_container(ROOT);
        let actions = client.session.game_action_sequence;
        receive(
            &mut client,
            GameEvent::InventoryPutObjInContainer(Box::new(InventoryPutObjInContainerEventData {
                item_guid: ROOT,
                container_guid: PLAYER,
                slot: 0,
                container_type: InventoryEntryKind::Container,
            })),
        )
        .await;
        assert_eq!(client.world.world_container().root(), None);
        assert!(client.world.is_owned_by_player(PACK));
        assert_eq!(client.session.game_action_sequence, actions + 1);
    }

    #[tokio::test]
    async fn terminal_sessions_revoke_access_without_sending_or_waiting_for_closes() {
        for state in [
            ClientState::Disconnected,
            ClientState::CharacterSelection(Vec::new()),
        ] {
            let mut client = fixture();
            use_root(&mut client, ROOT).await;
            receive(&mut client, roster(ROOT, &[PACK])).await;
            client
                .closing_containers
                .insert(OTHER, Instant::now() + CONTAINER_CLOSE_TIMEOUT);
            let actions = client.session.game_action_sequence;
            client.state = state;
            client.send_status_event();
            assert_eq!(client.world.world_container().root(), None);
            assert!(client.closing_containers.is_empty());
            assert_eq!(client.session.game_action_sequence, actions);
            receive(&mut client, roster(ROOT, &[PACK])).await;
            assert_eq!(client.world.world_container().root(), None);
        }
        let mut client = fixture();
        client.world.confirm_world_container(ROOT);
        client.character_selection.character_id = Some(OTHER);
        client.begin_world_entry_transition().await.unwrap();
        assert_eq!(client.world.world_container().root(), None);
        assert!(client.closing_containers.is_empty());
    }

    #[tokio::test]
    async fn unlocking_without_refreshing_description_accepts_server_contents() {
        use holtburger_common::properties::PropertyBool;
        use holtburger_protocol::{messages::PublicUpdatePropertyBoolData, traits::ProtocolPack};

        let mut client = fixture();
        let mut chest = client.world.get_visible_entity(ROOT).unwrap().clone();
        chest.flags.remove(ObjectDescriptionFlag::OPENABLE);
        chest.properties.bools.insert(PropertyBool::Locked, true);
        client.world.add_entity(chest);

        // Both ACE key and lockpick success send this property update, not a new description.
        let unlock =
            GameMessage::PublicUpdatePropertyBool(Box::new(PublicUpdatePropertyBoolData {
                sequence: 1,
                guid: ROOT,
                property: PropertyBool::Locked as u32,
                value: false,
            }));
        let mut bytes = Vec::new();
        unlock.pack(&mut bytes);
        client.handle_message(&bytes).await.unwrap();
        assert!(
            !client
                .world
                .get_visible_entity(ROOT)
                .unwrap()
                .flags
                .contains(ObjectDescriptionFlag::OPENABLE)
        );

        use_root(&mut client, ROOT).await;
        assert_eq!(client.world.world_container().root(), None);
        receive(&mut client, roster(ROOT, &[PACK])).await;
        assert_eq!(client.world.world_container().root(), Some(ROOT));
    }

    #[tokio::test]
    async fn only_matching_dispatched_use_opens_root_and_child_rosters_do_not_replace_it() {
        let mut client = fixture();
        receive(&mut client, roster(ROOT, &[PACK])).await;
        assert_eq!(client.world.world_container().root(), None);
        use_root(&mut client, ROOT).await;
        receive(&mut client, roster(OTHER, &[])).await;
        assert_eq!(client.world.world_container().root(), None);
        receive(&mut client, roster(ROOT, &[PACK])).await;
        receive(&mut client, roster(PACK, &[])).await;
        assert_eq!(client.world.world_container().root(), Some(ROOT));
        receive(
            &mut client,
            GameEvent::UseDone(Box::new(UseDoneEventData {
                error: WeenieError::None,
            })),
        )
        .await;
        assert_eq!(client.world.world_container().root(), Some(ROOT));
    }

    #[tokio::test]
    async fn successful_corpse_roster_records_session_open_history() {
        let mut client = fixture();
        client.world.entities.get_mut(ROOT).unwrap().flags |= ObjectDescriptionFlag::CORPSE;

        use_root(&mut client, ROOT).await;
        receive(&mut client, roster(ROOT, &[])).await;

        assert!(client.opened_corpses.ids().contains(&ROOT));
        assert_eq!(client.opened_corpses.iter().collect::<Vec<_>>(), [ROOT]);
        assert_eq!(
            client
                .application_snapshot()
                .entities
                .entities
                .iter()
                .find(|facts| facts.guid == ROOT)
                .and_then(|facts| facts.corpse),
            Some(holtburger_world::entity_facts::CorpseState::Opened)
        );
        client.reset_container_access();
        assert!(client.opened_corpses.ids().is_empty());
        assert_eq!(
            client
                .application_snapshot()
                .entities
                .entities
                .iter()
                .find(|facts| facts.guid == ROOT)
                .and_then(|facts| facts.corpse),
            Some(holtburger_world::entity_facts::CorpseState::Unopened)
        );
    }

    #[tokio::test]
    async fn denied_use_or_hook_activation_without_contents_does_not_open_storage() {
        for error in [WeenieError::None, WeenieError::YoureTooBusy] {
            let mut client = fixture();
            use_root(&mut client, ROOT).await;
            receive(
                &mut client,
                GameEvent::UseDone(Box::new(UseDoneEventData { error })),
            )
            .await;
            assert_eq!(client.world.world_container().root(), None);
            receive(&mut client, roster(ROOT, &[])).await;
            assert_eq!(client.world.world_container().root(), None);
        }
    }

    #[tokio::test]
    async fn switch_closes_old_root_once_and_late_close_preserves_new_root() {
        let mut client = fixture();
        use_root(&mut client, ROOT).await;
        receive(&mut client, roster(ROOT, &[])).await;
        receive(
            &mut client,
            GameEvent::UseDone(Box::new(UseDoneEventData {
                error: WeenieError::None,
            })),
        )
        .await;
        use_root(&mut client, OTHER).await;
        assert_eq!(client.world.world_container().root(), None);
        let deadline = client.closing_containers[&ROOT];
        client.close_container(ROOT).await.unwrap();
        assert_eq!(client.closing_containers[&ROOT], deadline);
        receive(&mut client, roster(OTHER, &[])).await;
        receive(
            &mut client,
            GameEvent::CloseGroundContainer(Box::new(CloseGroundContainerEventData {
                container_guid: ROOT,
            })),
        )
        .await;
        assert_eq!(client.world.world_container().root(), Some(OTHER));
        assert!(!client.closing_containers.contains_key(&ROOT));
    }

    #[tokio::test]
    async fn server_confirmed_storage_replaces_a_root_not_identified_during_preparation() {
        let mut client = fixture();
        client.world.confirm_world_container(ROOT);
        // The server response, not cached classification, establishes this target as storage.
        client.world.add_entity(Entity::new(
            OTHER,
            "Unclassified storage".into(),
            Default::default(),
        ));
        use_root(&mut client, OTHER).await;
        assert_eq!(client.world.world_container().root(), Some(ROOT));
        let before = client.session.game_action_sequence;
        receive(&mut client, roster(OTHER, &[])).await;
        assert_eq!(client.world.world_container().root(), Some(OTHER));
        assert!(client.closing_containers.contains_key(&ROOT));
        assert_eq!(client.session.game_action_sequence, before + 1);
        receive(&mut client, roster(OTHER, &[])).await;
        assert_eq!(client.session.game_action_sequence, before + 1);
    }

    #[tokio::test]
    async fn same_root_reopen_waits_for_ack_or_reported_timeout_and_requires_explicit_retry() {
        let mut client = fixture();
        client.world.confirm_world_container(ROOT);
        client.close_container(ROOT).await.unwrap();
        let intent = ItemUseIntent::Direct {
            source: ROOT,
            unrestricted: false,
        };
        assert!(client.dispatch_item_use(&intent).await.is_err());
        assert!(client.active_busy_operation.is_none());
        let mut events = client.subscribe_client_view_events();
        client.poll_container_close_timeout(Instant::now() + CONTAINER_CLOSE_TIMEOUT);
        assert!(events.try_recv().is_ok());
        assert_eq!(client.world.world_container().root(), None);
        assert!(client.dispatch_item_use(&intent).await.unwrap());
        assert_eq!(client.world.world_container().root(), None);
        receive(&mut client, roster(ROOT, &[])).await;
        assert_eq!(client.world.world_container().root(), Some(ROOT));
    }

    #[tokio::test]
    async fn send_failures_release_request_tracking_without_restoring_access() {
        let mut client = fixture();
        // IPv4-bound Session cannot send to this IPv6 loopback destination.
        client.session = holtburger_session::Session::new("[::1]:9000".parse().unwrap())
            .await
            .unwrap();
        let intent = ItemUseIntent::Direct {
            source: ROOT,
            unrestricted: false,
        };
        assert!(client.dispatch_item_use(&intent).await.is_err());
        assert!(client.active_busy_operation.is_none());
        receive(&mut client, roster(ROOT, &[PACK])).await;
        client.world.confirm_world_container(ROOT);
        assert!(
            client
                .send_game_action(GameAction::PutItemInContainer(Box::new(
                    holtburger_protocol::messages::PutItemInContainerActionData {
                        item_guid: PACK,
                        container_guid: PLAYER,
                        placement: 0,
                    }
                )))
                .await
                .is_err()
        );
        assert!(client.close_container(ROOT).await.is_err());
        client.world.tick();
        assert!(client.world.entities.get(PACK).is_none());
        assert!(client.closing_containers.is_empty());
        assert_eq!(client.world.world_container().root(), None);
    }

    #[tokio::test]
    async fn external_merge_after_close_updates_the_existing_owned_stack_without_moving_identity() {
        use crate::client::inventory_plan::{InventoryIntent, InventoryTarget};
        use holtburger_protocol::{
            messages::{InventoryRemoveObjectData, SetStackSizeData},
            traits::ProtocolPack,
        };
        use holtburger_world::entity_facts::EntityDescription;
        const OWNED_STACK: Guid = Guid(3);
        for source_quantity in [5, 15] {
            let mut client = fixture();
            client.world = crate::client::equipment_plan::tests::outfit(1, 1);
            let mut source = Entity::new(PACK, "External stack".into(), Default::default());
            source
                .properties
                .ints
                .insert(PropertyInt::ItemType, ItemType::MISC.bits() as i32);
            client.world.add_entity(source);
            for (guid, quantity) in [(PACK, source_quantity), (OWNED_STACK, 10)] {
                let entity = client.world.entities.get_mut(guid).unwrap();
                entity.wcid = Some(100);
                entity
                    .properties
                    .ints
                    .insert(PropertyInt::StackSize, quantity);
                entity.properties.ints.insert(PropertyInt::MaxStackSize, 20);
            }
            receive(&mut client, roster(ROOT, &[PACK])).await;
            client.world.confirm_world_container(ROOT);
            let location = client.world.storage_location(OWNED_STACK);
            client
                .submit_inventory_intent(InventoryIntent {
                    item: PACK,
                    target: InventoryTarget::Stack { guid: OWNED_STACK },
                })
                .await
                .unwrap();
            assert_eq!(client.session.game_action_sequence, 1);
            client.close_container(ROOT).await.unwrap();
            client.world.tick();
            // ACE removes a consumed source, or updates both quantities. Neither branch
            // sends containment of the source into the player's inventory.
            let remaining = source_quantity - source_quantity.min(10);
            let source_update = if remaining == 0 {
                GameMessage::InventoryRemoveObject(Box::new(InventoryRemoveObjectData {
                    object_guid: PACK,
                }))
            } else {
                GameMessage::SetStackSize(Box::new(SetStackSizeData {
                    sequence: 1,
                    object_guid: PACK,
                    stack_size: remaining as u32,
                    value: 0,
                }))
            };
            let target_quantity = 10 + source_quantity.min(10) as u32;
            for message in [
                source_update,
                GameMessage::SetStackSize(Box::new(SetStackSizeData {
                    sequence: 1,
                    object_guid: OWNED_STACK,
                    stack_size: target_quantity,
                    value: 0,
                })),
            ] {
                let mut bytes = Vec::new();
                message.pack(&mut bytes);
                client.handle_message(&bytes).await.unwrap();
            }
            assert_eq!(client.world.storage_location(OWNED_STACK), location);
            let facts = client
                .world
                .client_entity_facts(OWNED_STACK)
                .unwrap()
                .unwrap();
            assert!(facts.owned_by_player);
            assert!(
                matches!(facts.description, EntityDescription::Known { stack_count: Some(quantity), .. } if quantity == target_quantity)
            );
            assert!(!client.world.is_owned_by_player(PACK));
            assert!(client.world.client_entity_facts(PACK).unwrap().is_none());
        }
    }

    #[tokio::test]
    async fn deposited_items_wait_for_authority_and_late_success_leaves_closed_contents() {
        use crate::client::inventory_plan::{InventoryIntent, InventoryTarget};
        use holtburger_protocol::messages::{
            InventoryPutObjInContainerEventData, InventoryServerSaveFailedEventData,
        };
        use holtburger_world::entity_facts::EntityDescription;
        const OWNED_ITEM: Guid = Guid(3);
        for accepted in [true, false] {
            let mut client = fixture();
            client.world = crate::client::equipment_plan::tests::outfit(4, 4);
            let mut root = Entity::new(ROOT, "External container".into(), Default::default());
            root.properties.ints.insert(PropertyInt::ItemsCapacity, 4);
            client.world.add_entity(root);
            receive(&mut client, roster(ROOT, &[])).await;
            client.world.confirm_world_container(ROOT);
            let original = client.world.storage_location(OWNED_ITEM);
            client
                .submit_inventory_intent(InventoryIntent {
                    item: OWNED_ITEM,
                    target: InventoryTarget::Container { guid: ROOT },
                })
                .await
                .unwrap();
            assert_eq!(client.session.game_action_sequence, 1);
            assert_eq!(client.world.storage_location(OWNED_ITEM), original);
            client.close_container(ROOT).await.unwrap();
            client.world.tick();
            assert!(client.world.is_owned_by_player(OWNED_ITEM));
            if accepted {
                receive(
                    &mut client,
                    GameEvent::InventoryPutObjInContainer(Box::new(
                        InventoryPutObjInContainerEventData {
                            item_guid: OWNED_ITEM,
                            container_guid: ROOT,
                            slot: 0,
                            container_type: InventoryEntryKind::Item,
                        },
                    )),
                )
                .await;
                assert!(!client.world.is_owned_by_player(OWNED_ITEM));
                assert!(
                    client
                        .world
                        .client_entity_facts(OWNED_ITEM)
                        .unwrap()
                        .is_none()
                );
                client.world.tick();
                assert!(client.world.entities.get(OWNED_ITEM).is_none());
            } else {
                let mut published = client.subscribe_client_view_events();
                receive(
                    &mut client,
                    GameEvent::InventoryServerSaveFailed(Box::new(
                        InventoryServerSaveFailedEventData {
                            item_guid: OWNED_ITEM,
                            error: WeenieError::ActionCancelled,
                        },
                    )),
                )
                .await;
                assert_eq!(client.world.storage_location(OWNED_ITEM), original);
                let facts = client
                    .world
                    .client_entity_facts(OWNED_ITEM)
                    .unwrap()
                    .unwrap();
                assert!(facts.owned_by_player);
                assert!(matches!(facts.description, EntityDescription::Known { .. }));
                let mut reported = false;
                while let Ok(event) = published.try_recv() {
                    if let ClientViewEvent::ActionResult { reason, .. } = event {
                        reported |= matches!(
                            reason,
                            ActionResultReason::InventoryServerSaveFailed {
                                item_guid: OWNED_ITEM,
                                ..
                            }
                        );
                    }
                }
                assert!(reported);
            }
        }
    }

    #[tokio::test]
    async fn pickup_completion_after_closing_and_eviction_keeps_the_item_description() {
        use crate::client::inventory_plan::{InventoryIntent, InventoryTarget};
        use holtburger_protocol::messages::InventoryPutObjInContainerEventData;
        use holtburger_world::entity_facts::EntityDescription;
        for explicit in [false, true] {
            let mut client = fixture();
            client.world = crate::client::equipment_plan::tests::outfit(1, 1);
            let mut item = Entity::new(PACK, "Corpse loot".into(), Default::default());
            item.properties
                .ints
                .insert(PropertyInt::ItemType, ItemType::MISC.bits() as i32);
            client.world.add_entity(item);
            receive(
                &mut client,
                GameEvent::ViewContents(Box::new(ViewContentsEventData {
                    container: ROOT,
                    items: vec![ViewContentsEventItem {
                        guid: PACK,
                        container_type: InventoryEntryKind::Item,
                    }],
                })),
            )
            .await;
            client.world.confirm_world_container(ROOT);
            client
                .submit_inventory_intent(InventoryIntent {
                    item: PACK,
                    target: if explicit {
                        InventoryTarget::Container {
                            guid: client.world.player.guid,
                        }
                    } else {
                        InventoryTarget::Pickup { container: None }
                    },
                })
                .await
                .unwrap();
            assert_eq!(
                client.session.game_action_sequence, 1,
                "withdrawal must be dispatched"
            );
            client.close_container(ROOT).await.unwrap();
            let events = client.world.tick();
            client.handle_world_events(events).await.unwrap();
            assert!(!client.world.has_world_container_access(PACK));
            assert!(client.world.client_entity_facts(PACK).unwrap().is_none());
            let mut published = client.subscribe_client_view_events();
            let player = client.world.player.guid;
            receive(
                &mut client,
                GameEvent::InventoryPutObjInContainer(Box::new(
                    InventoryPutObjInContainerEventData {
                        item_guid: PACK,
                        container_guid: player,
                        slot: 0,
                        container_type: InventoryEntryKind::Item,
                    },
                )),
            )
            .await;
            let facts = client.world.client_entity_facts(PACK).unwrap().unwrap();
            assert!(facts.owned_by_player);
            assert!(
                matches!(facts.description, EntityDescription::Known { .. }),
                "{facts:?}"
            );
            let mut known_inventory_update = false;
            while let Ok(event) = published.try_recv() {
                if let ClientViewEvent::EntityFactsChanged(delta) = event {
                    known_inventory_update |= delta.upserts.iter().any(|facts| {
                        facts.guid == PACK
                            && facts.owned_by_player
                            && matches!(facts.description, EntityDescription::Known { .. })
                    });
                }
            }
            assert!(
                known_inventory_update,
                "pickup must publish the retained description to inventory"
            );
        }
    }

    #[tokio::test]
    async fn refused_pickup_preserves_source_and_use_timeout_does_not_admit_late_roster() {
        use crate::client::inventory_plan::{InventoryIntent, InventoryTarget};
        use holtburger_protocol::messages::InventoryServerSaveFailedEventData;
        use holtburger_world::state::storage::StorageLocation;
        let mut client = fixture();
        client.world = crate::client::equipment_plan::tests::outfit(1, 1);
        let mut item = Entity::new(PACK, "Loot".into(), Default::default());
        item.properties
            .ints
            .insert(PropertyInt::ItemType, ItemType::MISC.bits() as i32);
        client.world.add_entity(item);
        receive(&mut client, roster(ROOT, &[PACK])).await;
        client.world.confirm_world_container(ROOT);
        client
            .submit_inventory_intent(InventoryIntent {
                item: PACK,
                target: InventoryTarget::Pickup { container: None },
            })
            .await
            .unwrap();
        receive(
            &mut client,
            GameEvent::InventoryServerSaveFailed(Box::new(InventoryServerSaveFailedEventData {
                item_guid: PACK,
                error: WeenieError::YoureTooBusy,
            })),
        )
        .await;
        assert!(matches!(
            client.world.storage_location(PACK),
            Some(StorageLocation::Contained { parent: ROOT, .. })
        ));
        assert!(client.world.is_world_container_content(PACK));

        let mut client = fixture();
        use_root(&mut client, ROOT).await;
        client.poll_busy_timeout(Instant::now() + crate::client::BUSY_OPERATION_TIMEOUT);
        receive(&mut client, roster(ROOT, &[])).await;
        assert!(client.active_busy_operation.is_none());
        assert_eq!(client.world.world_container().root(), None);
    }

    #[tokio::test]
    async fn vendor_and_storage_replace_each_other_without_sharing_contents() {
        for known_candidate in [true, false] {
            let mut client = fixture();
            let offer = Guid(0x80000013);
            client.world.confirm_world_container(ROOT);
            receive(
                &mut client,
                GameEvent::ApproachVendor(Box::new(ApproachVendorEventData {
                    vendor_guid: OTHER,
                    merchandise_item_types: 0,
                    merchandise_min_value: 0,
                    merchandise_max_value: 0,
                    deal_magical_items: 0,
                    buy_multiplier: 1.0,
                    sell_multiplier: 1.0,
                    alternate_currency_wcid: 0,
                    alternate_currency_amount: 0,
                    alternate_currency_name: String::new(),
                    items: vec![
                        holtburger_protocol::messages::trade::events::VendorItemEventData {
                            packed_stack_size: 1,
                            description: holtburger_protocol::messages::PublicWeenieDescription {
                                guid: offer,
                                name: Some("Vendor offer".into()),
                                item_type: ItemType::MISC.bits(),
                                ..Default::default()
                            },
                        },
                    ],
                })),
            )
            .await;
            assert_eq!(client.world.world_container().root(), None);
            assert_eq!(client.world.vendor.as_ref().unwrap().vendor_guid, OTHER);
            assert_eq!(client.world.vendor.as_ref().unwrap().items[0].guid, offer);
            assert!(
                holtburger_world::interaction::pickup_candidate(&client.world, offer).is_none()
            );
            assert!(!client.world.has_world_container_access(offer));
            receive(
                &mut client,
                GameEvent::CloseGroundContainer(Box::new(CloseGroundContainerEventData {
                    container_guid: ROOT,
                })),
            )
            .await;
            if !known_candidate {
                client.world.add_entity(Entity::new(
                    ROOT,
                    "Unclassified storage".into(),
                    Default::default(),
                ));
            }
            use_root(&mut client, ROOT).await;
            assert_eq!(client.world.vendor.is_none(), known_candidate);
            receive(&mut client, roster(ROOT, &[])).await;
            assert_eq!(client.world.world_container().root(), Some(ROOT));
            assert!(client.world.vendor.is_none());
        }
    }
}
