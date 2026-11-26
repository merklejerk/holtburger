//! Transport-free Live API engine shared by REST, WebSocket, and in-process V8 scripting.

use std::collections::{BTreeMap, HashSet};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::time::Duration;

use holtburger_common::Guid;
use holtburger_common::properties::{EquipMask, WorldObjectExt as _};
use holtburger_core::client::appraisal::AppraisalOutputDemand;
use holtburger_core::client::container_auto_merge::AutoMergePolicy;
use holtburger_core::client::corpse::DeathLocationQuery;
use holtburger_core::client::equipment_set::EquipmentBinding;
use holtburger_core::client::inventory_storage::EquipmentStoragePolicy;
use holtburger_core::client::item_use::ItemUseRequest;
use holtburger_core::client::movement_types::{CharacterDrive, PlayerDriveIntent};
use holtburger_core::client::recall::RecallDestination;
use holtburger_core::client::salvage::SalvageToolSelection;
use holtburger_core::client::types::ClientAttackProfile;
use holtburger_core::client::vendor_transaction::VendorTradeRequest;
use holtburger_core::{
    BusyOperationKind, ClientCommand, ClientLifecycleState, ClientRuntimeHandle, CommandAdmission,
    CommandRejection, ControlSource, JumpExtent, TargetedJumpFinished, TargetedJumpOutcome,
    TargetedJumpRequest, TargetedJumpTarget, solve_targeted_jump,
};
use holtburger_protocol::messages::combat::{AttackHeight, CombatMode};
use holtburger_world::crafting::salvage::{SalvageEvaluation, find_salvage_tool};
use holtburger_world::entity::Entity;
use holtburger_world::entity_facts::{
    ClientEntityFacts, EntityDescription, EntityStorageLocation, StorageCoverage,
};
use holtburger_world::item_use::{ItemUseIntent, evaluate_item_use};
use holtburger_world::motion::RestPosture;
use holtburger_world::spell::SpellExtrasInfo;
use holtburger_world::state::allegiance::AllegianceMember;
use holtburger_world::state::squelch::SquelchScope;
use holtburger_world::state::storage::{PackEntryKind, StorageSlot};
use holtburger_world::stats::VitalType;
use holtburger_world::vendor::{VendorDraft, VendorPurchase};
use serde_json::Value;
use tokio::sync::broadcast;

use crate::event_log::{
    EventLog, ingest_client_view_event, project_confirmation, project_lifecycle, project_trade,
    project_vendor,
};
use crate::hooks::{
    ApiError, ApiErrorCode, ApiResult, ClientHudHook, ClientUiHook, HudScreenshotRequest,
    HudScreenshotResponse, HudWaypointView, StaticReferenceCatalogs, validate_marker_namespace,
    validate_markers_request,
};
use crate::types::{
    AllegianceCommandSpec, AllegianceMemberView, AllegianceProfileView, AllegianceView, ApiCommand,
    ApiEvent, ApiEventEnvelope, ApiEventTopic, ApiInfo, ApiPreviewRequest, ApiPreviewResponse,
    ApiQuery, AppraisalOutcome, AttackHeightSpec, AttackProfileSpec, BusyOperationOutcome,
    CellPortalView, CellTopologyView, CharacterOptionsView, ChatCommandSpec, CombatModeOutcome,
    CombatModeSpec, CombatView, CommandOutcome, CommandResponse, ContainerView,
    CorpseConsentCommandSpec, DEFAULT_SPHERE_SWEEP_RADIUS, DeathLocationsView, EntityDetail,
    EntityFactsView, EntityFilter, EntityPropertiesView, EntitySummary, EquipmentView,
    EquippedItemView, EventsPage, FellowshipCommandSpec, FellowshipMemberView, FellowshipView,
    FriendView, FriendsCommandSpec, InventoryOutcome, InventoryView, ItemUseCapabilityView,
    ItemUseTargetPreview, JumpToPreview, LIVE_API_VERSION, LifecycleOutcome, LifecyclePhaseView,
    LockToolView,
    MAX_DRIVE_PULSE_MS, MAX_RAYCAST_BATCH, MAX_WAIT_TIMEOUT_MS, OutdoorCoordsPreview,
    OutdoorCoordsView, RaycastHitView, RaycastPreview, RaycastSpec, RestPostureSpec,
    SalvagePreview, SelectionView, SelfView, SkillDefinitionView, SocialView,
    SpellCastReadinessView, SpellCastingRouteView, SpellDefinitionView, SpellFormulaPreview,
    SpellInspectionPreview, SpellbookView, SphereSweepPreview, SquelchCharacterView,
    SquelchCommandSpec, SquelchGlobalView, SquelchView, TradeView, VendorTradeSpec, VendorView,
    WaitPolicy, WaitUntil, WaypointView, WeaponProfileView, WorldCellsView, camelize_json,
    to_camel_json,
};

/// Live metadata snapshot pushed whenever lifecycle, world, or character changes (e.g., for discovery).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiscoveryMetadataSnapshot {
    pub lifecycle: String,
    pub world: Option<String>,
    pub account: String,
    pub character: Option<String>,
}

/// Configuration for building a `LiveApiEngine`.
pub struct LiveApiEngineConfig {
    pub client_kind: &'static str,
    pub catalogs: Option<StaticReferenceCatalogs>,
    pub ui: Option<Arc<dyn ClientUiHook>>,
    pub hud: Option<Arc<dyn ClientHudHook>>,
}

/// Transport-neutral Live API core shared by REST, WebSocket, and TUI V8 scripting.
#[derive(Clone)]
pub struct LiveApiEngine {
    inner: Arc<LiveApiEngineInner>,
}

struct LiveApiEngineInner {
    client_kind: &'static str,
    started_at: std::time::Instant,
    handle: ClientRuntimeHandle,
    event_log: EventLog,
    catalogs: Option<StaticReferenceCatalogs>,
    ui: Option<Arc<dyn ClientUiHook>>,
    hud: Option<Arc<dyn ClientHudHook>>,
    next_request_seq: AtomicU32,
    pump_task: tokio::task::JoinHandle<()>,
}

impl Drop for LiveApiEngineInner {
    fn drop(&mut self) {
        self.pump_task.abort();
    }
}

/// Snapshots current lifecycle/world/character metadata for PID discovery files.
pub(crate) fn snapshot_discovery_metadata(
    ctx: &holtburger_core::client::control::ClientReadContext<'_>,
) -> DiscoveryMetadataSnapshot {
    DiscoveryMetadataSnapshot {
        lifecycle: project_lifecycle(&ctx.lifecycle()).phase_label().into(),
        world: ctx.world_name().map(str::to_string),
        account: ctx.account_name().to_string(),
        character: ctx.world().player_entity().map(|e| e.name().to_string()),
    }
}

impl LiveApiEngine {
    /// Creates a new `LiveApiEngine` and starts its background `ClientViewEvent` ingestion task.
    pub fn start(handle: ClientRuntimeHandle, config: LiveApiEngineConfig) -> Self {
        Self::start_with_metadata_hook(handle, config, None)
    }

    /// Creates a `LiveApiEngine` with an optional callback fired on lifecycle/world/character edges.
    pub fn start_with_metadata_hook(
        handle: ClientRuntimeHandle,
        config: LiveApiEngineConfig,
        on_metadata_changed: Option<Arc<dyn Fn(DiscoveryMetadataSnapshot) + Send + Sync>>,
    ) -> Self {
        let event_log = EventLog::new();
        let mut rx = handle.subscribe();
        let pump_log = event_log.clone();
        let pump_handle = handle.clone();

        let task = tokio::spawn(async move {
            // Hydrate initial discovery metadata asynchronously so callers like h3d can bind the
            // Live API server before spawning the ClientRuntime task without deadlocking.
            if let Some(callback) = &on_metadata_changed
                && let Ok(meta) = pump_handle.read(snapshot_discovery_metadata).await
            {
                callback(meta);
            }
            loop {
                match rx.recv().await {
                    Ok(event) => {
                        let metadata_edge = matches!(
                            event,
                            holtburger_core::ClientViewEvent::LifecycleChanged(_)
                                | holtburger_core::ClientViewEvent::WorldNameUpdated(_)
                                | holtburger_core::ClientViewEvent::PlayerEntered { .. }
                                | holtburger_core::ClientViewEvent::LocalPlayerEstablished { .. }
                        );
                        ingest_client_view_event(&pump_log, &event);
                        if metadata_edge
                            && let Some(callback) = &on_metadata_changed
                            && let Ok(meta) = pump_handle.read(snapshot_discovery_metadata).await
                        {
                            callback(meta);
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        });

        Self {
            inner: Arc::new(LiveApiEngineInner {
                client_kind: config.client_kind,
                started_at: std::time::Instant::now(),
                handle,
                event_log,
                catalogs: config.catalogs,
                ui: config.ui,
                hud: config.hud,
                next_request_seq: AtomicU32::new(1),
                pump_task: task,
            }),
        }
    }

    pub fn client_kind(&self) -> &'static str {
        self.inner.client_kind
    }

    pub fn runtime_handle(&self) -> &ClientRuntimeHandle {
        &self.inner.handle
    }

    pub fn event_log(&self) -> &EventLog {
        &self.inner.event_log
    }

    /// Emits a `selection` event into the semantic log when the frontend's selected entity changes.
    pub fn notify_selection_changed(&self, guid: Option<Guid>) {
        self.inner.event_log.push(
            ApiEventTopic::Selection,
            ApiEvent::SelectionChanged { guid },
        );
    }

    /// Emits a `hud` event into the semantic log when the frontend's outdoor navigation waypoint changes.
    pub fn notify_waypoint_changed(&self, waypoint: Option<HudWaypointView>) {
        self.inner
            .event_log
            .push(ApiEventTopic::Hud, ApiEvent::WaypointChanged { waypoint });
    }

    /// Emits a local `user-message` event on `automation` for `/api say` and `/bot`.
    pub fn emit_user_message(&self, text: String) -> ApiEventEnvelope {
        self.inner
            .event_log
            .push(ApiEventTopic::Automation, ApiEvent::UserMessage { text })
    }

    /// Computes capabilities directly from mounted hooks and catalogs (impossible to drift).
    pub fn capabilities(&self) -> Vec<String> {
        let mut caps = vec![
            "core.session".into(),
            "core.self".into(),
            "core.world".into(),
            "core.inventory".into(),
            "core.combat".into(),
            "core.magic".into(),
            "core.crafting".into(),
            "core.trade".into(),
            "core.social".into(),
            "core.movement".into(),
        ];
        if self.inner.catalogs.is_some() {
            caps.push("content.spells".into());
            caps.push("content.skills".into());
        }
        if self.inner.ui.is_some() {
            caps.push("ui.selection".into());
            caps.push("ui.print".into());
        }
        if self.inner.hud.is_some() {
            caps.push("h3d.hud".into());
        }
        caps
    }

    fn next_seq(&self) -> u32 {
        self.inner.next_request_seq.fetch_add(1, Ordering::Relaxed)
    }

    pub async fn poll_events(
        &self,
        since: u64,
        topics: Option<&HashSet<ApiEventTopic>>,
        limit: usize,
        wait_ms: u32,
    ) -> EventsPage {
        self.inner
            .event_log
            .poll(since, topics, limit, wait_ms)
            .await
    }

    /// Unified read dispatcher used by WebSocket and V8 scripting (`op_query`).
    pub async fn query(&self, query: ApiQuery) -> ApiResult<Value> {
        match query {
            ApiQuery::Info => to_json(self.info().await?),
            ApiQuery::Characters => to_json(self.characters().await?),
            ApiQuery::SelfState => to_json(self.self_state().await?),
            ApiQuery::CharacterSheet => to_json(self.character_sheet().await?),
            ApiQuery::Enchantments => to_json(self.enchantments().await?),
            ApiQuery::Spellbook => to_json(self.spellbook().await?),
            ApiQuery::Recalls => to_json(self.recalls().await?),
            ApiQuery::CharacterOptions => to_json(self.character_options().await?),
            ApiQuery::DeathLocations => to_json(self.death_locations().await?),
            ApiQuery::Entities { filter } => to_json(self.entities(filter).await?),
            ApiQuery::EntityDetail {
                guid,
                include_properties,
            } => to_json(self.entity_detail(guid, include_properties).await?),
            ApiQuery::Inventory => to_json(self.inventory().await?),
            ApiQuery::Equipment => to_json(self.equipment().await?),
            ApiQuery::Combat => to_json(self.combat().await?),
            ApiQuery::Trade => to_json(self.trade().await?),
            ApiQuery::Vendor => to_json(self.vendor().await?),
            ApiQuery::Social => to_json(self.social().await?),
            ApiQuery::Selection => to_json(self.selection().await?),
            ApiQuery::Waypoint => to_json(self.waypoint().await?),
            ApiQuery::WorldCells { landblock } => to_json(self.world_cells(landblock).await?),
            ApiQuery::ContentSpells {
                search,
                school,
                known,
            } => to_json(
                self.content_spells(search.as_deref(), school.as_deref(), known)
                    .await?,
            ),
            ApiQuery::ContentSpell { id } => to_json(self.content_spell(id)?),
            ApiQuery::ContentSkills => to_json(self.content_skills()?),
        }
    }

    pub async fn info(&self) -> ApiResult<ApiInfo> {
        let client = self.inner.client_kind.to_string();
        let mut capabilities = self.capabilities();
        let latest_event_seq = self.inner.event_log.latest_seq();

        self.inner
            .handle
            .read(move |ctx| {
                if ctx.collision_scene().is_some() {
                    capabilities.push("world.spatial".into());
                }
                let player_guid = ctx.world().player.guid;
                let character_guid = (!player_guid.is_null()).then_some(player_guid);
                let character_name = ctx
                    .world()
                    .player_entity()
                    .map(|entity| entity.name().to_string());
                ApiInfo {
                    api_version: LIVE_API_VERSION.into(),
                    client,
                    capabilities,
                    lifecycle: project_lifecycle(&ctx.lifecycle()),
                    world_generation: ctx.world_generation(),
                    world_name: ctx.world_name().map(str::to_string),
                    account_name: ctx.account_name().to_string(),
                    character_guid,
                    character_name,
                    automation_paused: ctx.automation_paused(),
                    entity_collision_enabled: ctx.entity_collision_enabled(),
                    latest_event_seq,
                }
            })
            .await
            .map_err(|e| ApiError::runtime(e.to_string()))
    }

    pub async fn characters(&self) -> ApiResult<Vec<holtburger_core::ClientCharacterSummary>> {
        self.inner
            .handle
            .read(|ctx| match ctx.lifecycle() {
                ClientLifecycleState::CharacterSelection { characters, .. } => characters,
                _ => Vec::new(),
            })
            .await
            .map_err(|e| ApiError::runtime(e.to_string()))
    }

    pub async fn self_state(&self) -> ApiResult<SelfView> {
        self.inner
            .handle
            .read(|ctx| {
                let world = ctx.world();
                let guid = world.player.guid;
                let entity = world.player_entity();
                let position = local_player_pose(world);
                let heading = position.map(|p| p.rotation.to_heading());
                let summary = world.player_entity_summary();
                let vital = |ty: VitalType| -> (u32, u32) {
                    world
                        .player
                        .vitals
                        .get(&ty)
                        .map_or((0, 0), |v| (v.current, v.buffed_max))
                };
                let (health, health_max) = vital(VitalType::Health);
                let (stamina, stamina_max) = vital(VitalType::Stamina);
                let (mana, mana_max) = vital(VitalType::Mana);
                SelfView {
                    guid,
                    name: entity.map(|e| e.name().to_string()),
                    position,
                    outdoor_coords: position.and_then(project_outdoor_coords),
                    heading,
                    health,
                    health_max,
                    stamina,
                    stamina_max,
                    mana,
                    mana_max,
                    pyreals: summary.pyreal_balance,
                    burden: summary.burden,
                    combat_mode: format_combat_mode(world.player_combat_mode()).into(),
                    busy: ctx.busy(),
                    confirmation: ctx.confirmation().map(project_confirmation),
                    spell_cast_target: ctx.spell_cast_target(),
                    navigation: ctx.navigation(),
                    jump: ctx.active_targeted_jump(),
                    airborne: ctx.player_is_airborne(),
                    server_time: ctx.server_time(),
                }
            })
            .await
            .map_err(|e| ApiError::runtime(e.to_string()))
    }

    pub async fn character_sheet(&self) -> ApiResult<Option<Value>> {
        self.inner
            .handle
            .read(|ctx| ctx.character_sheet().and_then(to_camel_json))
            .await
            .map_err(|e| ApiError::runtime(e.to_string()))
    }

    pub async fn enchantments(&self) -> ApiResult<Option<Value>> {
        self.inner
            .handle
            .read(|ctx| ctx.enchantments().and_then(to_camel_json))
            .await
            .map_err(|e| ApiError::runtime(e.to_string()))
    }

    pub async fn spellbook(&self) -> ApiResult<SpellbookView> {
        self.inner
            .handle
            .read(|ctx| SpellbookView {
                known_spells: ctx.known_spells(),
                cast_target: ctx.spell_cast_target(),
            })
            .await
            .map_err(|e| ApiError::runtime(e.to_string()))
    }

    pub async fn recalls(&self) -> ApiResult<Vec<RecallDestination>> {
        self.inner
            .handle
            .read(|ctx| ctx.recall_destinations())
            .await
            .map_err(|e| ApiError::runtime(e.to_string()))
    }

    pub async fn character_options(&self) -> ApiResult<CharacterOptionsView> {
        self.inner
            .handle
            .read(|ctx| {
                let raw = ctx.world().player.character_options;
                let mut options = BTreeMap::new();
                for repr in 0..=0x34u32 {
                    if let Some(opt) = holtburger_common::CharacterOption::from_repr(repr) {
                        options.insert(opt.to_string(), raw.is_enabled(opt));
                    }
                }
                CharacterOptionsView {
                    options1_mask: raw.options1.bits(),
                    options2_mask: raw.options2.bits(),
                    options,
                }
            })
            .await
            .map_err(|e| ApiError::runtime(e.to_string()))
    }

    pub async fn death_locations(&self) -> ApiResult<DeathLocationsView> {
        self.inner
            .handle
            .read(|ctx| {
                let last_outdoor = ctx.query_death_locations(DeathLocationQuery::LastOutdoor);
                let recent = ctx.query_death_locations(DeathLocationQuery::Recent);
                DeathLocationsView {
                    last_outdoor: to_camel_json(last_outdoor),
                    recent: to_camel_json(recent),
                }
            })
            .await
            .map_err(|e| ApiError::runtime(e.to_string()))
    }

    pub async fn entities(&self, filter: EntityFilter) -> ApiResult<Vec<EntitySummary>> {
        self.inner
            .handle
            .read(move |ctx| {
                let world = ctx.world();
                let self_pos = world.local_player_runtime_pose();
                let allowed_categories: Option<HashSet<String>> =
                    filter.category.as_ref().map(|s| {
                        s.split(',')
                            .map(|part| part.trim().to_ascii_lowercase())
                            .filter(|part| !part.is_empty())
                            .collect()
                    });
                let name_needle = filter.name.as_ref().map(|n| n.to_ascii_lowercase());

                let mut out = Vec::new();
                for entity in world.entities.iter() {
                    let facts = world.client_entity_facts(entity.guid).ok().flatten();
                    let summary = build_entity_summary(entity, facts.as_ref(), self_pos);
                    if let Some(max_dist) = filter.max_distance
                        && summary.distance_to_self.is_none_or(|d| d > max_dist)
                    {
                        continue;
                    }
                    if let Some(cats) = &allowed_categories
                        && !cats.contains(&summary.category)
                    {
                        continue;
                    }
                    if let Some(needle) = &name_needle
                        && !summary.name.to_ascii_lowercase().contains(needle)
                    {
                        continue;
                    }
                    if let Some(wcid) = filter.wcid
                        && summary.wcid != Some(wcid)
                    {
                        continue;
                    }
                    if let Some(container) = filter.container
                        && summary.container != Some(container)
                    {
                        continue;
                    }
                    out.push(summary);
                }
                out.sort_by(|a, b| {
                    a.distance_to_self
                        .unwrap_or(f32::MAX)
                        .total_cmp(&b.distance_to_self.unwrap_or(f32::MAX))
                        .then_with(|| a.guid.cmp(&b.guid))
                });
                if let Some(limit) = filter.limit {
                    out.truncate(limit);
                }
                out
            })
            .await
            .map_err(|e| ApiError::runtime(e.to_string()))
    }

    pub async fn entity_detail(
        &self,
        guid: Guid,
        include_properties: bool,
    ) -> ApiResult<EntityDetail> {
        let host_origin = self.inner.started_at;
        let detail = self
            .inner
            .handle
            .read(move |ctx| {
                let world = ctx.world();
                let entity = world.entities.get(guid)?;
                let facts = world
                    .client_entity_facts_with_host_origin(guid, host_origin)
                    .ok()
                    .flatten();
                let summary =
                    build_entity_summary(entity, facts.as_ref(), world.local_player_runtime_pose());
                Some(EntityDetail {
                    summary,
                    facts: facts.as_ref().map(|f| project_entity_facts(entity, f)),
                    armor_profile: entity.armor_profile.as_ref().and_then(to_camel_json),
                    creature_profile: entity.creature_profile.as_ref().and_then(to_camel_json),
                    weapon_profile: entity.weapon_profile.as_ref().map(project_weapon_profile),
                    spell_book: entity.spell_book.clone(),
                    properties: include_properties.then(|| extract_entity_properties(entity)),
                })
            })
            .await
            .map_err(|e| ApiError::runtime(e.to_string()))?;
        detail.ok_or_else(|| ApiError::not_found(format!("entity {} not found", guid.0)))
    }

    pub async fn inventory(&self) -> ApiResult<InventoryView> {
        self.inner
            .handle
            .read(|ctx| {
                let world = ctx.world();
                let player_guid = world.player.guid;
                let summary = world.player_entity_summary();
                let world_container = world.world_container();
                let mut container_items: BTreeMap<Guid, Vec<Guid>> = BTreeMap::new();
                if !player_guid.is_null() {
                    container_items.entry(player_guid).or_default();
                }

                let mut owned_containers = Vec::new();
                if !player_guid.is_null() {
                    owned_containers.push(player_guid);
                }

                for entity in world.entities.iter() {
                    if let Ok(Some(facts)) = world.client_entity_facts(entity.guid) {
                        if let EntityStorageLocation::Contained { parent_guid, .. } = facts.location
                        {
                            container_items
                                .entry(parent_guid)
                                .or_default()
                                .push(entity.guid);
                        }
                        if facts.owned_by_player
                            && matches!(facts.storage, StorageCoverage::Container { .. })
                            && entity.guid != player_guid
                        {
                            owned_containers.push(entity.guid);
                        }
                    }
                }
                if let Some(open_root) = world_container.root()
                    && !owned_containers.contains(&open_root)
                {
                    owned_containers.push(open_root);
                }

                let containers = owned_containers
                    .into_iter()
                    .map(|guid| {
                        let entity = world.entities.get(guid);
                        let (item_capacity, pack_capacity) = world
                            .client_entity_facts(guid)
                            .ok()
                            .flatten()
                            .map_or((None, None), |f| match f.storage {
                                StorageCoverage::Container {
                                    item_capacity,
                                    pack_capacity,
                                    ..
                                } => (item_capacity, pack_capacity),
                                StorageCoverage::NotEstablished => (None, None),
                            });
                        ContainerView {
                            guid,
                            name: entity.map(|e| e.name().to_string()),
                            item_capacity,
                            pack_capacity,
                            items: container_items.remove(&guid).unwrap_or_default(),
                        }
                    })
                    .collect();

                InventoryView {
                    pyreals: summary.pyreal_balance,
                    burden: summary.burden,
                    containers,
                    open_world_container: world_container.root(),
                    projectile_supply: to_camel_json(world.projectile_supply())
                        .unwrap_or(Value::Null),
                }
            })
            .await
            .map_err(|e| ApiError::runtime(e.to_string()))
    }

    pub async fn equipment(&self) -> ApiResult<EquipmentView> {
        self.inner
            .handle
            .read(|ctx| {
                let world = ctx.world();
                let player_guid = world.player.guid;
                let mut items = Vec::new();
                for entity in world.entities.iter() {
                    if let Ok(Some(facts)) = world.client_entity_facts(entity.guid)
                        && let EntityStorageLocation::Equipped { wearer_guid, mask } =
                            facts.location
                        && wearer_guid == player_guid
                    {
                        let raw_mask = mask.unwrap_or(0);
                        let slots = EquipMask::from_bits_truncate(raw_mask)
                            .iter_names()
                            .map(|(name, _)| name.to_ascii_lowercase().replace('_', "-"))
                            .collect();
                        items.push(EquippedItemView {
                            guid: entity.guid,
                            name: Some(entity.name().to_string()),
                            equip_mask: raw_mask,
                            slots,
                        });
                    }
                }
                items.sort_by_key(|item| item.guid);
                EquipmentView { items }
            })
            .await
            .map_err(|e| ApiError::runtime(e.to_string()))
    }

    pub async fn combat(&self) -> ApiResult<CombatView> {
        self.inner
            .handle
            .read(|ctx| {
                let status = ctx.combat();
                CombatView {
                    combat_mode: format_combat_mode(ctx.world().player_combat_mode()).into(),
                    state: status.state,
                    target: status.desired.map(|d| d.target),
                    profile: status.desired.map(|d| from_core_attack_profile(d.profile)),
                }
            })
            .await
            .map_err(|e| ApiError::runtime(e.to_string()))
    }

    pub async fn trade(&self) -> ApiResult<TradeView> {
        self.inner
            .handle
            .read(|ctx| project_trade(&ctx.trade()))
            .await
            .map_err(|e| ApiError::runtime(e.to_string()))
    }

    pub async fn vendor(&self) -> ApiResult<Option<VendorView>> {
        self.inner
            .handle
            .read(|ctx| ctx.world().vendor.as_ref().map(project_vendor))
            .await
            .map_err(|e| ApiError::runtime(e.to_string()))
    }

    pub async fn social(&self) -> ApiResult<SocialView> {
        self.inner
            .handle
            .read(|ctx| SocialView {
                fellowship: ctx.world().fellowship.as_ref().map(project_fellowship),
                allegiance: project_allegiance(&ctx.allegiance()),
                friends: ctx.world().friends.as_ref().map(project_friends),
                squelch: ctx.world().squelch.as_ref().map(project_squelch),
                contracts: ctx.contracts().and_then(to_camel_json),
            })
            .await
            .map_err(|e| ApiError::runtime(e.to_string()))
    }

    pub async fn selection(&self) -> ApiResult<SelectionView> {
        let Some(ui) = &self.inner.ui else {
            return Err(ApiError::unsupported("ui.selection"));
        };
        Ok(SelectionView {
            guid: ui.get_selection().await?,
        })
    }

    pub async fn waypoint(&self) -> ApiResult<WaypointView> {
        let Some(hud) = &self.inner.hud else {
            return Err(ApiError::unsupported("h3d.hud"));
        };
        Ok(WaypointView {
            waypoint: hud.get_waypoint().await?,
        })
    }

    pub async fn capture_screenshot(
        &self,
        req: HudScreenshotRequest,
    ) -> ApiResult<HudScreenshotResponse> {
        let Some(hud) = &self.inner.hud else {
            return Err(ApiError::unsupported("h3d.hud"));
        };
        hud.capture_screenshot(req).await
    }

    /// Returns the resident indoor cell-portal topology for `landblock` (or the player's current landblock).
    pub async fn world_cells(&self, landblock: Option<Guid>) -> ApiResult<WorldCellsView> {
        self.inner
            .handle
            .read(move |ctx| -> ApiResult<WorldCellsView> {
                let Some(scene) = ctx.collision_scene() else {
                    return Err(ApiError::unsupported("world.spatial"));
                };
                let player_pos = local_player_pose(ctx.world());
                let target_id = landblock
                    .or_else(|| player_pos.map(|p| p.landblock_id))
                    .ok_or_else(|| {
                        ApiError::new(
                            ApiErrorCode::NotInWorld,
                            "no landblock specified and player position is unavailable",
                        )
                    })?;
                if target_id.is_null() {
                    return Err(ApiError::invalid("landblockId must be non-null"));
                }
                let (normalized_owner, _) = spatial_anchor_and_cell(target_id);
                let player_cell = player_pos.map(|p| p.landblock_id);
                let is_outdoor = player_cell.is_none_or(|c| (c.0 & 0xffff) < 0x0100);
                let current_cell_id = player_cell.filter(|c| {
                    (c.0 & 0xffff) >= 0x0100
                        && (c.0 & 0xffff_0000) == (normalized_owner.0 & 0xffff_0000)
                });
                let cells = scene
                    .resident_cell_topology(normalized_owner)
                    .ok_or_else(|| {
                        ApiError::not_found(format!(
                            "landblock {} is not currently resident in the collision scene",
                            normalized_owner.0
                        ))
                    })?
                    .into_iter()
                    .map(|cell| CellTopologyView {
                        cell_id: cell.cell_id,
                        origin: cell.origin,
                        seen_outside: cell.seen_outside,
                        visible_cells: cell.visible_cells,
                        portals: cell
                            .portals
                            .into_iter()
                            .map(|p| CellPortalView {
                                other_cell_id: p.other_cell_id,
                                is_outdoor: p.is_outdoor,
                                center: p.center,
                                vertices: p.vertices,
                            })
                            .collect(),
                    })
                    .collect();
                Ok(WorldCellsView {
                    landblock_id: normalized_owner,
                    current_cell_id,
                    is_outdoor,
                    cells,
                })
            })
            .await
            .map_err(|e| ApiError::runtime(e.to_string()))?
    }

    pub async fn content_spells(
        &self,
        search: Option<&str>,
        school: Option<&str>,
        known_only: bool,
    ) -> ApiResult<Vec<SpellDefinitionView>> {
        let Some(catalogs) = &self.inner.catalogs else {
            return Err(ApiError::unsupported("content.spells"));
        };
        let known_ids: Option<HashSet<u32>> = if known_only {
            let ids = self
                .inner
                .handle
                .read(|ctx| ctx.known_spells().unwrap_or_default())
                .await
                .map_err(|e| ApiError::runtime(e.to_string()))?;
            Some(ids.into_iter().collect())
        } else {
            None
        };
        let search_lc = search.map(str::to_ascii_lowercase);
        let school_lc = school.map(str::to_ascii_lowercase);
        let mut out: Vec<_> = catalogs
            .spells
            .spells
            .iter()
            .filter_map(|(&id, info)| {
                if let Some(known) = &known_ids
                    && !known.contains(&id)
                {
                    return None;
                }
                let school_name = format!("{:?}", info.school);
                if let Some(needle) = &search_lc
                    && !info.name.to_ascii_lowercase().contains(needle)
                {
                    return None;
                }
                if let Some(s) = &school_lc
                    && !school_name.to_ascii_lowercase().contains(s)
                {
                    return None;
                }
                Some(spell_view(id, info))
            })
            .collect();
        out.sort_by_key(|s| s.id);
        Ok(out)
    }

    pub fn content_spell(&self, id: u32) -> ApiResult<SpellDefinitionView> {
        let Some(catalogs) = &self.inner.catalogs else {
            return Err(ApiError::unsupported("content.spells"));
        };
        let info = catalogs
            .spells
            .get(id)
            .ok_or_else(|| ApiError::not_found(format!("spell {id} not found")))?;
        Ok(spell_view(id & 0x7FFF_FFFF, info))
    }

    pub fn content_skills(&self) -> ApiResult<Vec<SkillDefinitionView>> {
        let Some(catalogs) = &self.inner.catalogs else {
            return Err(ApiError::unsupported("content.skills"));
        };
        let mut out: Vec<_> = catalogs
            .skills
            .skill_base_hash
            .iter()
            .map(|(&id, base)| SkillDefinitionView {
                id,
                name: base.name.clone(),
                description: base.description.clone(),
                trained_cost: base.trained_cost,
                specialized_cost: base.specialized_cost,
            })
            .collect();
        out.sort_by_key(|s| s.id);
        Ok(out)
    }

    /// Evaluates pure read-only world previews synchronously via `handle.read(...)`.
    pub async fn preview(&self, request: ApiPreviewRequest) -> ApiResult<ApiPreviewResponse> {
        match request {
            ApiPreviewRequest::ItemUseTarget { source, target } => {
                let (eligible, lockpick_success_percent) = self
                    .inner
                    .handle
                    .read(move |ctx| ctx.evaluate_item_use_target(source, target))
                    .await
                    .map_err(|e| ApiError::runtime(e.to_string()))?;
                Ok(ApiPreviewResponse::ItemUseTarget(ItemUseTargetPreview {
                    eligible,
                    lockpick_success_percent,
                }))
            }
            ApiPreviewRequest::Salvage { tool, items } => {
                let selection = match tool {
                    Some(guid) => SalvageToolSelection::Exact { guid },
                    None => SalvageToolSelection::Discover { preferred: None },
                };
                let eval = self
                    .inner
                    .handle
                    .read(move |ctx| ctx.preview_salvage(selection, &items))
                    .await
                    .map_err(|e| ApiError::runtime(e.to_string()))?;
                Ok(ApiPreviewResponse::Salvage(project_salvage_evaluation(
                    &eval,
                )))
            }
            ApiPreviewRequest::Vendor { trade } => {
                let req = VendorTradeRequest {
                    sequence: 0,
                    draft: into_vendor_draft(trade),
                };
                let result = self
                    .inner
                    .handle
                    .read(move |ctx| ctx.preview_vendor_trade(req))
                    .await
                    .map_err(|e| ApiError::runtime(e.to_string()))?;
                to_json(result)
                    .map(camelize_json)
                    .map(ApiPreviewResponse::Dynamic)
            }
            ApiPreviewRequest::SpellInspection { spell_id } => {
                let catalog_base_mana = self
                    .inner
                    .catalogs
                    .as_ref()
                    .and_then(|c| c.spells.get(spell_id))
                    .map(|s| s.base_mana);
                let (outcome, readiness) = self
                    .inner
                    .handle
                    .read(move |ctx| {
                        use holtburger_world::context::WorldContext as _;
                        let outcome = ctx.inspect_spell(spell_id);
                        let world = ctx.world();
                        let player_guid = world.player.guid;
                        let known = ctx.known_spells().map(|ids| ids.contains(&spell_id));
                        let has_caster_equipped = !player_guid.is_null()
                            && world.entities.iter().any(|entity| {
                                world.equipment_mask(entity.guid).is_some_and(|mask| {
                                    mask.intersects(EquipMask::CASTER)
                                        && entity.wielder_id() == Some(player_guid)
                                })
                            });
                        let in_magic_mode = world.player_combat_mode() == CombatMode::Magic;
                        let base_mana = catalog_base_mana
                            .or_else(|| world.spell_catalog.get(spell_id).map(|s| s.base_mana));
                        let current_mana =
                            world.player.vitals.get(&VitalType::Mana).map(|v| v.current);
                        let sufficient_mana =
                            base_mana.zip(current_mana).map(|(cost, mana)| mana >= cost);
                        (
                            outcome,
                            SpellCastReadinessView {
                                known,
                                has_caster_equipped,
                                in_magic_mode,
                                sufficient_mana,
                            },
                        )
                    })
                    .await
                    .map_err(|e| ApiError::runtime(e.to_string()))?;
                Ok(ApiPreviewResponse::SpellInspection(
                    project_spell_inspection(outcome, readiness),
                ))
            }
            ApiPreviewRequest::Raycast { rays } => {
                if rays.is_empty() || rays.len() > MAX_RAYCAST_BATCH {
                    return Err(ApiError::invalid(format!(
                        "raycast batch size must be in 1..={MAX_RAYCAST_BATCH}"
                    )));
                }
                self.inner
                    .handle
                    .read(move |ctx| -> ApiResult<ApiPreviewResponse> {
                        let Some(scene) = ctx.collision_scene() else {
                            return Err(ApiError::unsupported("world.spatial"));
                        };
                        let default_origin = local_player_pose(ctx.world()).map(|mut p| {
                            p.coords.z += 1.5;
                            p
                        });
                        let mut results = Vec::with_capacity(rays.len());
                        for RaycastSpec { from, to } in rays {
                            let origin = from.or(default_origin).ok_or_else(|| {
                                ApiError::invalid(
                                    "raycast `from` omitted and local player position is unavailable",
                                )
                            })?;
                            if origin.landblock_id.is_null() || to.landblock_id.is_null() {
                                return Err(ApiError::invalid(
                                    "raycast `from` and `to` require non-null landblockId",
                                ));
                            }
                            let displacement = to.global_coords() - origin.global_coords();
                            let distance = displacement.length();
                            if !distance.is_finite() {
                                return Err(ApiError::invalid("raycast coordinates must be finite"));
                            }
                            let (anchor, previous_cell) = spatial_anchor_and_cell(origin.landblock_id);
                            if distance <= 1e-5 {
                                results.push(RaycastHitView {
                                    hit: false,
                                    anchor,
                                    distance: None,
                                    point: None,
                                    normal: None,
                                    cell_id: None,
                                    uncovered: false,
                                });
                                continue;
                            }
                            let req = holtburger_world::StaticSurfaceRayRequest {
                                anchor,
                                start: origin.coords,
                                direction: displacement * (1.0 / distance),
                                maximum_distance: distance,
                                previous_cell,
                                filter: holtburger_world::PhysicalCollisionFilter::ALL,
                            };
                            let query = scene
                                .cast_static_surface_ray_with_policy(
                                    req,
                                    holtburger_world::CollisionQueryPolicy::AllowUncoveredQuery,
                                )
                                .map_err(|e| ApiError::invalid(e.to_string()))?;
                            let entry = match query.value {
                                Some(hit) => RaycastHitView {
                                    hit: true,
                                    anchor,
                                    distance: Some(hit.distance),
                                    point: Some(hit.point),
                                    normal: Some(hit.normal),
                                    cell_id: hit.placement.committed_cell(),
                                    uncovered: query.unavailable_owner.is_some(),
                                },
                                None => RaycastHitView {
                                    hit: false,
                                    anchor,
                                    distance: None,
                                    point: None,
                                    normal: None,
                                    cell_id: None,
                                    uncovered: query.unavailable_owner.is_some(),
                                },
                            };
                            results.push(entry);
                        }
                        Ok(ApiPreviewResponse::Raycast(RaycastPreview { results }))
                    })
                    .await
                    .map_err(|e| ApiError::runtime(e.to_string()))?
            }
            ApiPreviewRequest::SphereSweep { from, to, radius } => {
                let radius = radius.unwrap_or(DEFAULT_SPHERE_SWEEP_RADIUS);
                if !radius.is_finite() || radius <= 0.01 || radius > 5.0 {
                    return Err(ApiError::invalid(
                        "sphere-sweep radius must be finite and in (0.01, 5.0]",
                    ));
                }
                self.inner
                    .handle
                    .read(move |ctx| -> ApiResult<ApiPreviewResponse> {
                        let Some(scene) = ctx.collision_scene() else {
                            return Err(ApiError::unsupported("world.spatial"));
                        };
                        let origin = from
                            .or_else(|| {
                                local_player_pose(ctx.world()).map(|mut p| {
                                    p.coords.z += 0.5;
                                    p
                                })
                            })
                            .ok_or_else(|| {
                                ApiError::invalid(
                                    "sphere-sweep `from` omitted and local player position is unavailable",
                                )
                            })?;
                        if origin.landblock_id.is_null() || to.landblock_id.is_null() {
                            return Err(ApiError::invalid(
                                "sphere-sweep `from` and `to` require non-null landblockId",
                            ));
                        }
                        let displacement = to.global_coords() - origin.global_coords();
                        if !displacement.length().is_finite() {
                            return Err(ApiError::invalid(
                                "sphere-sweep coordinates must be finite",
                            ));
                        }
                        let (anchor, previous_cell) = spatial_anchor_and_cell(origin.landblock_id);
                        let req = holtburger_world::StaticSphereSweepRequest {
                            anchor,
                            start: origin.coords,
                            displacement,
                            previous_cell,
                            radius,
                            filter: holtburger_world::PhysicalCollisionFilter::ALL,
                        };
                        let query = scene
                            .sweep_static_sphere_with_policy(
                                req,
                                holtburger_world::CollisionQueryPolicy::AllowUncoveredQuery,
                            )
                            .map_err(|e| ApiError::invalid(e.to_string()))?;
                        let (blocked, fraction, normal) = match query.value {
                            Some(hit) => (true, hit.time_of_impact, Some(hit.normal)),
                            None => (false, 1.0, None),
                        };
                        let point = origin.coords + displacement * fraction;
                        Ok(ApiPreviewResponse::SphereSweep(SphereSweepPreview {
                            blocked,
                            anchor,
                            fraction,
                            point,
                            normal,
                            uncovered: query.unavailable_owner.is_some(),
                        }))
                    })
                    .await
                    .map_err(|e| ApiError::runtime(e.to_string()))?
            }
            ApiPreviewRequest::OutdoorCoords { coords, position } => {
                let mut target_pos = match (coords, position) {
                    (Some(text), None) => {
                        let (lat, lon) = holtburger_common::position::parse_printed_outdoor_coords(
                            &text,
                        )
                        .ok_or_else(|| {
                            ApiError::invalid(format!(
                                "invalid outdoor coordinates '{text}'; expected format like '42.3N, 15.8E'"
                            ))
                        })?;
                        holtburger_common::position::WorldPosition::from_outdoor_degrees(
                            lat, lon, 0.0,
                        )
                        .ok_or_else(|| {
                            ApiError::invalid(format!(
                                "outdoor coordinates '{text}' are outside Dereth bounds"
                            ))
                        })?
                    }
                    (None, Some(pos)) => {
                        if !pos.coords.x.is_finite()
                            || !pos.coords.y.is_finite()
                            || !pos.coords.z.is_finite()
                        {
                            return Err(ApiError::invalid(
                                "outdoor-coords `position` coordinates must be finite",
                            ));
                        }
                        let normalized = pos.normalize_outdoor_landblock_frame().map_err(|_| {
                            ApiError::invalid(
                                "outdoor-coords `position` must be a valid outdoor WorldPosition",
                            )
                        })?;
                        normalized.normalize_outdoor_cell()
                    }
                    _ => {
                        return Err(ApiError::invalid(
                            "outdoor-coords requires exactly one of `coords` or `position`",
                        ));
                    }
                };
                let sample_terrain = position.is_none();
                self.inner
                    .handle
                    .read(move |ctx| -> ApiResult<ApiPreviewResponse> {
                        let mut terrain_resident = false;
                        if sample_terrain && let Some(scene) = ctx.collision_scene() {
                            let (anchor, previous_cell) =
                                spatial_anchor_and_cell(target_pos.landblock_id);
                            let req = holtburger_world::StaticSurfaceRayRequest {
                                anchor,
                                start: holtburger_common::math::Vector3::new(
                                    target_pos.coords.x,
                                    target_pos.coords.y,
                                    1000.0,
                                ),
                                direction: holtburger_common::math::Vector3::new(0.0, 0.0, -1.0),
                                maximum_distance: 2000.0,
                                previous_cell,
                                filter: holtburger_world::PhysicalCollisionFilter::ALL,
                            };
                            if let Ok(query) = scene.cast_static_surface_ray_with_policy(
                                req,
                                holtburger_world::CollisionQueryPolicy::AllowUncoveredQuery,
                            ) && query.unavailable_owner.is_none()
                                && let Some(hit) = query.value
                            {
                                terrain_resident = true;
                                target_pos.coords.z = hit.point.z;
                            }
                        }
                        let outdoor_coords =
                            project_outdoor_coords(target_pos).ok_or_else(|| {
                                ApiError::invalid(
                                    "position could not be converted to outdoor coords",
                                )
                            })?;
                        Ok(ApiPreviewResponse::OutdoorCoords(OutdoorCoordsPreview {
                            position: target_pos,
                            outdoor_coords,
                            terrain_resident,
                        }))
                    })
                    .await
                    .map_err(|e| ApiError::runtime(e.to_string()))?
            }
            ApiPreviewRequest::JumpTo {
                target,
                normal,
                power,
            } => {
                let jump_target = TargetedJumpTarget::new(target, normal).map_err(ApiError::invalid)?;
                let jump_power = validate_optional_jump_power(power)?;
                let snapshot = self
                    .inner
                    .handle
                    .read(|ctx| -> ApiResult<holtburger_core::TargetedJumpSnapshot> {
                        if ctx.collision_scene().is_none() {
                            return Err(ApiError::unsupported("world.spatial"));
                        }
                        ctx.targeted_jump_snapshot().map_err(map_rejection)
                    })
                    .await
                    .map_err(|e| ApiError::runtime(e.to_string()))??;
                let solution = run_targeted_jump_solver(snapshot, jump_target, jump_power).await?;
                Ok(ApiPreviewResponse::JumpTo(JumpToPreview {
                    reachable: solution.reachable,
                    power: solution.power.map(JumpExtent::get),
                    landed_position: solution.landed_position,
                    apex_z: solution.apex_z,
                    flight_duration_ms: solution.flight_duration_ms,
                    reason: solution.reason,
                    attempts: solution.attempts,
                }))
            }
        }
    }

    /// Unified mutation executor shared by `POST /v1/command`, `WS /v1/ws`, and V8 scripting.
    pub async fn execute(
        &self,
        command: ApiCommand,
        wait: WaitPolicy,
    ) -> ApiResult<CommandResponse> {
        // Frontend UI/HUD hooks are handled directly without going through ClientRuntime.
        match command {
            ApiCommand::SetSelection { guid } => {
                let ui = self
                    .inner
                    .ui
                    .as_ref()
                    .ok_or_else(|| ApiError::unsupported("ui.selection"))?;
                if let Some(target) = guid {
                    self.inner
                        .handle
                        .read(move |ctx| -> ApiResult<()> {
                            if !matches!(ctx.lifecycle(), ClientLifecycleState::InWorld) {
                                return Err(ApiError::new(
                                    ApiErrorCode::NotInWorld,
                                    "cannot select an entity while not in-world",
                                ));
                            }
                            if ctx.world().entities.get(target).is_none() {
                                return Err(ApiError::not_found(format!(
                                    "entity {} not found in world state",
                                    target.0
                                )));
                            }
                            Ok(())
                        })
                        .await
                        .map_err(|e| ApiError::runtime(e.to_string()))??;
                }
                let previous = ui.get_selection().await.ok().flatten();
                ui.set_selection(guid).await?;
                if previous != guid {
                    self.notify_selection_changed(guid);
                }
                Ok(immediate_accepted(self.inner.event_log.latest_seq()))
            }
            ApiCommand::UiPrint { request } => {
                let ui = self
                    .inner
                    .ui
                    .as_ref()
                    .ok_or_else(|| ApiError::unsupported("ui.print"))?;
                if request.message.trim().is_empty() {
                    return Err(ApiError::invalid("ui-print `message` must not be empty"));
                }
                ui.print(request).await?;
                Ok(immediate_accepted(self.inner.event_log.latest_seq()))
            }
            ApiCommand::HudToast { request } => {
                let hud = self
                    .inner
                    .hud
                    .as_ref()
                    .ok_or_else(|| ApiError::unsupported("h3d.hud"))?;
                if request.message.trim().is_empty() {
                    return Err(ApiError::invalid("hud-toast `message` must not be empty"));
                }
                hud.toast(request).await?;
                Ok(immediate_accepted(self.inner.event_log.latest_seq()))
            }
            ApiCommand::HudUpsertMarkers { request } => {
                let hud = self
                    .inner
                    .hud
                    .as_ref()
                    .ok_or_else(|| ApiError::unsupported("h3d.hud"))?;
                validate_markers_request(&request)?;
                hud.upsert_markers(request).await?;
                Ok(immediate_accepted(self.inner.event_log.latest_seq()))
            }
            ApiCommand::HudClearMarkers { namespace } => {
                let hud = self
                    .inner
                    .hud
                    .as_ref()
                    .ok_or_else(|| ApiError::unsupported("h3d.hud"))?;
                validate_marker_namespace(namespace.as_deref())?;
                hud.clear_markers(namespace).await?;
                Ok(immediate_accepted(self.inner.event_log.latest_seq()))
            }
            ApiCommand::HudSetWaypoint { waypoint } => {
                let hud = self
                    .inner
                    .hud
                    .as_ref()
                    .ok_or_else(|| ApiError::unsupported("h3d.hud"))?;
                if waypoint.is_some() {
                    let in_world = self
                        .inner
                        .handle
                        .read(|ctx| matches!(ctx.lifecycle(), ClientLifecycleState::InWorld))
                        .await
                        .map_err(|e| ApiError::runtime(e.to_string()))?;
                    if !in_world {
                        return Err(ApiError::new(
                            ApiErrorCode::NotInWorld,
                            "cannot set a navigation waypoint while not in-world",
                        ));
                    }
                }
                let previous = hud.get_waypoint().await.ok().flatten();
                let next = hud.set_waypoint(waypoint).await?;
                if previous != next {
                    self.notify_waypoint_changed(next);
                }
                Ok(immediate_accepted(self.inner.event_log.latest_seq()))
            }
            ApiCommand::HudPlayCue { request } => {
                let hud = self
                    .inner
                    .hud
                    .as_ref()
                    .ok_or_else(|| ApiError::unsupported("h3d.hud"))?;
                hud.play_cue(request).await?;
                Ok(immediate_accepted(self.inner.event_log.latest_seq()))
            }
            ApiCommand::JumpTo {
                target,
                normal,
                power,
            } => self.execute_jump_to(target, normal, power, wait).await,
            other => self.execute_core_command(other, wait).await,
        }
    }

    fn rejected_jump_response(
        &self,
        outcome: TargetedJumpOutcome,
        position: Option<holtburger_common::position::WorldPosition>,
        predicted_landing: Option<holtburger_common::position::WorldPosition>,
        unreachable_reason: Option<holtburger_core::TargetedJumpUnreachableReason>,
    ) -> CommandResponse {
        CommandResponse {
            accepted: false,
            correlation_id: None,
            settled: true,
            timed_out: false,
            outcome: Some(CommandOutcome::Jump(TargetedJumpFinished {
                correlation_id: None,
                origin: ControlSource::Automation,
                outcome,
                power: None,
                position,
                predicted_landing,
                matched_target: false,
                unreachable_reason,
            })),
            latest_event_seq: self.inner.event_log.latest_seq(),
        }
    }

    async fn execute_jump_to(
        &self,
        target: holtburger_common::position::WorldPosition,
        normal: Option<holtburger_common::Vector3>,
        power: Option<f32>,
        wait: WaitPolicy,
    ) -> ApiResult<CommandResponse> {
        enum JumpPrep {
            Airborne(Option<holtburger_common::position::WorldPosition>),
            Explicit(JumpExtent),
            AutoSolve(Box<holtburger_core::TargetedJumpSnapshot>),
        }

        let jump_target = TargetedJumpTarget::new(target, normal).map_err(ApiError::invalid)?;
        let explicit_power = validate_optional_jump_power(power)?;

        // Single runtime read: enforce pause/lifecycle/airborne preconditions and, when power is
        // omitted, capture the immutable collision snapshot without a second round-trip.
        let prep = self
            .inner
            .handle
            .read(move |ctx| -> ApiResult<JumpPrep> {
                if ctx.automation_paused() {
                    return Err(map_rejection(CommandRejection::AutomationPaused));
                }
                if !matches!(ctx.lifecycle(), ClientLifecycleState::InWorld) {
                    return Err(map_rejection(CommandRejection::NotInWorld));
                }
                if ctx.player_is_airborne() || ctx.active_targeted_jump().is_some() {
                    return Ok(JumpPrep::Airborne(local_player_pose(ctx.world())));
                }
                match explicit_power {
                    Some(p) => Ok(JumpPrep::Explicit(p)),
                    None => {
                        if ctx.collision_scene().is_none() {
                            return Err(ApiError::unsupported("world.spatial"));
                        }
                        Ok(JumpPrep::AutoSolve(Box::new(
                            ctx.targeted_jump_snapshot().map_err(map_rejection)?,
                        )))
                    }
                }
            })
            .await
            .map_err(|e| ApiError::runtime(e.to_string()))??;

        let (resolved_power, expected_world_generation) = match prep {
            JumpPrep::Airborne(position) => {
                return Ok(self.rejected_jump_response(
                    TargetedJumpOutcome::RejectedAirborne,
                    position,
                    None,
                    None,
                ));
            }
            JumpPrep::Explicit(p) => (p, None),
            JumpPrep::AutoSolve(snapshot) => {
                let world_generation = snapshot.world_generation;
                let start_pose = snapshot.body.pose;
                let solution = run_targeted_jump_solver(*snapshot, jump_target, None).await?;
                if !solution.reachable {
                    return Ok(self.rejected_jump_response(
                        TargetedJumpOutcome::RejectedUnreachable,
                        Some(start_pose),
                        solution.landed_position,
                        solution.reason,
                    ));
                }
                let solved = solution.power.ok_or_else(|| {
                    ApiError::runtime("reachable targeted jump solution missing power")
                })?;
                (solved, Some(world_generation))
            }
        };

        let core_cmd = ClientCommand::JumpTo(TargetedJumpRequest {
            target: jump_target,
            power: resolved_power,
            expected_world_generation,
        });
        self.submit_and_wait_core_command(core_cmd, Some(SettlementMatcher::Jump), wait)
            .await
    }

    async fn execute_core_command(
        &self,
        command: ApiCommand,
        wait: WaitPolicy,
    ) -> ApiResult<CommandResponse> {
        // Fast-path no-ops and fail-fast checks for async-settling combat-mode / inventory commands
        // so `wait.until = "settled"` never hangs when the character is already in the desired state.
        if let Some(short_circuit) = self.precheck_settling_command(&command, wait).await? {
            return Ok(short_circuit);
        }

        let waiter_kind = settlement_matcher(&command);
        let core_cmd = self.translate_command(command).await?;
        self.submit_and_wait_core_command(core_cmd, waiter_kind, wait)
            .await
    }

    async fn submit_and_wait_core_command(
        &self,
        core_cmd: ClientCommand,
        waiter_kind: Option<SettlementMatcher>,
        wait: WaitPolicy,
    ) -> ApiResult<CommandResponse> {

        // Subscribe BEFORE enqueueing the command so fast synchronous completions cannot race.
        let mut live_rx = (wait.until == WaitUntil::Settled && waiter_kind.is_some())
            .then(|| self.inner.event_log.subscribe_live());

        let admission = self
            .inner
            .handle
            .send_automation(core_cmd)
            .await
            .map_err(|e| ApiError::runtime(e.to_string()))?;

        let correlation_id = match admission {
            CommandAdmission::Accepted { correlation_id } => correlation_id,
            CommandAdmission::Rejected(rejection) => return Err(map_rejection(rejection)),
        };

        if wait.until == WaitUntil::Accepted || waiter_kind.is_none() {
            return Ok(CommandResponse {
                accepted: true,
                correlation_id,
                settled: false,
                timed_out: false,
                outcome: None,
                latest_event_seq: self.inner.event_log.latest_seq(),
            });
        }

        let matcher = waiter_kind.expect("checked is_some above");
        let timeout = Duration::from_millis(u64::from(wait.timeout_ms.min(MAX_WAIT_TIMEOUT_MS)));
        let deadline = tokio::time::Instant::now() + timeout;
        let rx = live_rx.as_mut().expect("subscribed before send");

        loop {
            let now = tokio::time::Instant::now();
            if now >= deadline {
                return Ok(CommandResponse {
                    accepted: true,
                    correlation_id,
                    settled: false,
                    timed_out: true,
                    outcome: None,
                    latest_event_seq: self.inner.event_log.latest_seq(),
                });
            }
            let remaining = deadline.saturating_duration_since(now);
            match tokio::time::timeout(remaining, rx.recv()).await {
                Ok(Ok(envelope)) => {
                    if let Some(outcome) = match_settlement(&matcher, correlation_id, &envelope) {
                        return Ok(CommandResponse {
                            accepted: true,
                            correlation_id,
                            settled: true,
                            timed_out: false,
                            outcome: Some(outcome),
                            latest_event_seq: envelope.seq,
                        });
                    }
                }
                Ok(Err(broadcast::error::RecvError::Lagged(_))) => continue,
                Ok(Err(broadcast::error::RecvError::Closed)) | Err(_) => {
                    return Ok(CommandResponse {
                        accepted: true,
                        correlation_id,
                        settled: false,
                        timed_out: true,
                        outcome: None,
                        latest_event_seq: self.inner.event_log.latest_seq(),
                    });
                }
            }
        }
    }

    async fn precheck_settling_command(
        &self,
        command: &ApiCommand,
        wait: WaitPolicy,
    ) -> ApiResult<Option<CommandResponse>> {
        if wait.until != WaitUntil::Settled {
            return Ok(None);
        }
        if !matches!(
            command,
            ApiCommand::SetCombatMode { .. } | ApiCommand::Inventory { .. }
        ) {
            return Ok(None);
        }
        if self.inner.handle.is_automation_paused() {
            return Err(map_rejection(CommandRejection::AutomationPaused));
        }
        match command {
            ApiCommand::SetCombatMode { mode } => {
                let requested = combat_mode_spec_to_core(*mode);
                let (in_world, current) = self
                    .inner
                    .handle
                    .read(|ctx| {
                        (
                            matches!(ctx.lifecycle(), ClientLifecycleState::InWorld),
                            ctx.world().player_combat_mode(),
                        )
                    })
                    .await
                    .map_err(|e| ApiError::runtime(e.to_string()))?;
                if !in_world {
                    return Err(map_rejection(CommandRejection::NotInWorld));
                }
                if current == requested {
                    return Ok(Some(CommandResponse {
                        accepted: true,
                        correlation_id: None,
                        settled: true,
                        timed_out: false,
                        outcome: Some(CommandOutcome::CombatMode(CombatModeOutcome {
                            mode: format_combat_mode(current).into(),
                            matched: true,
                        })),
                        latest_event_seq: self.inner.event_log.latest_seq(),
                    }));
                }
            }
            ApiCommand::Inventory { intent } => {
                use holtburger_core::client::inventory_plan::InventoryTarget;
                use holtburger_world::context::WorldContext as _;
                let item_guid = intent.item;
                let target = intent.target;
                let (in_world, exists, already_in_target) = self
                    .inner
                    .handle
                    .read(move |ctx| {
                        if !matches!(ctx.lifecycle(), ClientLifecycleState::InWorld) {
                            return (false, false, false);
                        }
                        let world = ctx.world();
                        if world.entities.get(item_guid).is_none() {
                            return (true, false, false);
                        }
                        let already = match target {
                            InventoryTarget::Container { guid } => matches!(
                                world.storage_location(item_guid),
                                Some(holtburger_world::state::storage::StorageLocation::Contained {
                                    parent,
                                    ..
                                }) if parent == guid
                            ),
                            InventoryTarget::Equipment { mask } => {
                                world.equipment_mask(item_guid)
                                    == Some(EquipMask::from_bits_retain(mask))
                            }
                            InventoryTarget::EquipPreferred { alternate: false } => {
                                world.equipment_mask(item_guid).is_some()
                            }
                            InventoryTarget::Item { guid } | InventoryTarget::Pack { guid } => {
                                guid == item_guid
                            }
                            _ => false,
                        };
                        (true, true, already)
                    })
                    .await
                    .map_err(|e| ApiError::runtime(e.to_string()))?;
                if !in_world {
                    return Err(map_rejection(CommandRejection::NotInWorld));
                }
                if !exists {
                    return Err(ApiError::not_found(format!(
                        "inventory item {} not found",
                        item_guid.0
                    )));
                }
                if already_in_target {
                    return Ok(Some(CommandResponse {
                        accepted: true,
                        correlation_id: None,
                        settled: true,
                        timed_out: false,
                        outcome: Some(CommandOutcome::Inventory(InventoryOutcome {
                            item: item_guid,
                            settled_by: "already-in-target".into(),
                            error: None,
                        })),
                        latest_event_seq: self.inner.event_log.latest_seq(),
                    }));
                }
            }
            _ => {}
        }
        Ok(None)
    }

    async fn translate_command(&self, command: ApiCommand) -> ApiResult<ClientCommand> {
        Ok(match command {
            ApiCommand::SelectCharacter { guid } => ClientCommand::SelectCharacter(guid),
            ApiCommand::Logout => ClientCommand::Logout,
            ApiCommand::RespondConfirmation {
                request_id,
                accepted,
            } => ClientCommand::RespondToConfirmation {
                request_id,
                accepted,
            },
            ApiCommand::Chat { action } => match action {
                ChatCommandSpec::Say { message } => ClientCommand::Talk(message),
                ChatCommandSpec::Tell { target, message } => {
                    ClientCommand::Tell { target, message }
                }
                ChatCommandSpec::Channel { channel, message } => {
                    ClientCommand::ChannelMessage { channel, message }
                }
                ChatCommandSpec::Emote { message } => ClientCommand::Emote(message),
                ChatCommandSpec::SoulEmote { token } => ClientCommand::SoulEmote {
                    token,
                    request_id: None,
                },
            },
            ApiCommand::Fellowship { action } => match action {
                FellowshipCommandSpec::Create { name } => ClientCommand::CreateParty { name },
                FellowshipCommandSpec::Invite { target } => ClientCommand::InviteToParty { target },
                FellowshipCommandSpec::Uninvite { target } => {
                    ClientCommand::UninviteFromParty { target }
                }
                FellowshipCommandSpec::PromoteLeader { target } => {
                    ClientCommand::PromotePartyLeader { target }
                }
                FellowshipCommandSpec::Leave => ClientCommand::LeaveParty,
                FellowshipCommandSpec::Disband => ClientCommand::DisbandParty,
                FellowshipCommandSpec::SetOpen { open } => ClientCommand::SetPartyOpenness { open },
            },
            ApiCommand::Allegiance { action } => match action {
                AllegianceCommandSpec::Query => ClientCommand::QueryAllegiance,
                AllegianceCommandSpec::Swear { target } => {
                    ClientCommand::SwearAllegiance { target }
                }
                AllegianceCommandSpec::Unswear { target } => ClientCommand::Unswear { target },
            },
            ApiCommand::Friends { action } => match action {
                FriendsCommandSpec::Add { name } => ClientCommand::AddFriend { name },
                FriendsCommandSpec::Remove { guid } => ClientCommand::RemoveFriend { guid },
            },
            ApiCommand::Squelch { action } => match action {
                SquelchCommandSpec::Add { name } => ClientCommand::AddIgnore {
                    name,
                    scope: SquelchScope::Account,
                },
                SquelchCommandSpec::Remove { guid } => ClientCommand::RemoveIgnore {
                    guid,
                    scope: SquelchScope::Account,
                },
            },
            ApiCommand::CorpseConsent { action } => match action {
                CorpseConsentCommandSpec::Grant { player_name } => {
                    ClientCommand::AddPlayerPermission { player_name }
                }
                CorpseConsentCommandSpec::Revoke { player_name } => {
                    ClientCommand::RemovePlayerPermission { player_name }
                }
            },
            ApiCommand::AbandonContract { id } => ClientCommand::AbandonContract { id },
            ApiCommand::SetCharacterOption { option, value } => {
                if matches!(
                    option,
                    holtburger_common::CharacterOption::CharacterOptions1Default
                        | holtburger_common::CharacterOption::CharacterOptions2Default
                ) {
                    return Err(ApiError::invalid(format!(
                        "{option} is a default bitmask sentinel, not a toggleable character option"
                    )));
                }
                ClientCommand::SetCharacterOption { option, value }
            }
            ApiCommand::SetCombatMode { mode } => {
                ClientCommand::SetCombatMode(combat_mode_spec_to_core(mode))
            }
            ApiCommand::BeginCombat { target, profile } => ClientCommand::BeginCombatEngagement {
                intent_sequence: 0,
                target,
                profile: into_core_attack_profile(profile)?,
            },
            ApiCommand::UpdateCombatProfile { profile } => {
                ClientCommand::UpdateCombatProfile(into_core_attack_profile(profile)?)
            }
            ApiCommand::StopCombat => ClientCommand::StopCombatEngagement { intent_sequence: 0 },
            ApiCommand::CastSpell { spell_id, aim } => ClientCommand::CastSpell { spell_id, aim },
            ApiCommand::SetRestPosture { posture } => {
                ClientCommand::SetRestPosture(match posture {
                    RestPostureSpec::Standing => RestPosture::Standing,
                    RestPostureSpec::Crouching => RestPosture::Crouching,
                    RestPostureSpec::Sitting => RestPosture::Sitting,
                    RestPostureSpec::Lying => RestPosture::Lying,
                })
            }
            ApiCommand::CancelRestPosture => ClientCommand::CancelRestPosture,
            ApiCommand::Recall { destination } => ClientCommand::Recall(destination),
            ApiCommand::UseEntity { guid, unrestricted } => {
                if !unrestricted {
                    let rejection = self
                        .inner
                        .handle
                        .read(move |ctx| {
                            holtburger_world::interaction::entity_use_rejection(ctx.world(), guid)
                        })
                        .await
                        .map_err(|e| ApiError::runtime(e.to_string()))?;
                    if let Some(rejection) = rejection {
                        return Err(ApiError::invalid(rejection.to_string()));
                    }
                }
                ClientCommand::Use { guid, unrestricted }
            }
            ApiCommand::RequestAppraisal { guid, facts_only } => ClientCommand::RequestAppraisal {
                guid,
                output: if facts_only {
                    AppraisalOutputDemand::FactsOnly
                } else {
                    AppraisalOutputDemand::Full
                },
                allow_cached_preview: true,
            },
            ApiCommand::QueryHealth { guid } => ClientCommand::QueryHealth(guid),
            ApiCommand::ReadBookPage { book, page_index } => {
                if i32::try_from(page_index).is_err() {
                    return Err(ApiError::invalid(format!(
                        "pageIndex {page_index} exceeds i32 wire range"
                    )));
                }
                let player = self
                    .inner
                    .handle
                    .read(|ctx| ctx.world().player.guid)
                    .await
                    .map_err(|e| ApiError::runtime(e.to_string()))?;
                if player.is_null() {
                    return Err(ApiError::new(
                        ApiErrorCode::NotInWorld,
                        "cannot read book page while not in-world",
                    ));
                }
                ClientCommand::ReadBookPage {
                    player,
                    book,
                    page_index,
                }
            }
            ApiCommand::UseItem { source, target } => {
                let intent = match target {
                    Some(target) => ItemUseIntent::Targeted { source, target },
                    None => ItemUseIntent::Direct {
                        source,
                        unrestricted: false,
                    },
                };
                let sequence = self.next_seq();
                let request = self
                    .inner
                    .handle
                    .read(move |ctx| -> Result<ItemUseRequest, String> {
                        let world = ctx.world();
                        let eval = evaluate_item_use(world, &intent).map_err(|e| e.to_string())?;
                        let source_owned = world
                            .client_entity_facts(source)
                            .ok()
                            .flatten()
                            .is_some_and(|f| f.owned_by_player);
                        Ok(ItemUseRequest {
                            sequence,
                            player: world.player.guid,
                            source_owned,
                            intent,
                            expected: eval.consequence(),
                        })
                    })
                    .await
                    .map_err(|e| ApiError::runtime(e.to_string()))?
                    .map_err(ApiError::invalid)?;
                ClientCommand::SubmitItemUse(request)
            }
            ApiCommand::Salvage { tool, items } => {
                let resolved_tool = match tool {
                    Some(guid) => guid,
                    None => self
                        .inner
                        .handle
                        .read(|ctx| find_salvage_tool(ctx.world(), None).map(|t| t.guid))
                        .await
                        .map_err(|e| ApiError::runtime(e.to_string()))?
                        .ok_or_else(|| {
                            ApiError::invalid("no Ust salvage tool found in inventory")
                        })?,
                };
                ClientCommand::SalvageItemsWith {
                    tool: resolved_tool,
                    items,
                }
            }
            ApiCommand::Inventory { intent } => {
                let storage = self
                    .inner
                    .handle
                    .read(|ctx| default_equipment_storage_policy(ctx.world()))
                    .await
                    .map_err(|e| ApiError::runtime(e.to_string()))?;
                ClientCommand::SubmitInventory { intent, storage }
            }
            ApiCommand::ApplyEquipmentSet { bindings } => {
                let storage = self
                    .inner
                    .handle
                    .read(|ctx| default_equipment_storage_policy(ctx.world()))
                    .await
                    .map_err(|e| ApiError::runtime(e.to_string()))?;
                ClientCommand::ApplyEquipmentSet {
                    bindings: bindings
                        .into_iter()
                        .map(|b| EquipmentBinding {
                            item: b.item,
                            target: EquipMask::from_bits_truncate(b.equip_mask),
                        })
                        .collect(),
                    storage,
                }
            }
            ApiCommand::AutoMergeContainer { container } => ClientCommand::AutoMergeContainer {
                container,
                policy: AutoMergePolicy {
                    step_timeout_ms: 2_500,
                    operation_timeout_ms: 15_000,
                },
            },
            ApiCommand::CloseContainer { guid } => ClientCommand::CloseContainer(guid),
            ApiCommand::Trade { action } => ClientCommand::Trade(action),
            ApiCommand::VendorTrade { trade } => ClientCommand::VendorTrade(VendorTradeRequest {
                sequence: self.next_seq(),
                draft: into_vendor_draft(trade),
            }),
            ApiCommand::Steer { request } => ClientCommand::StartLocalSteering(request),
            ApiCommand::StopMovement => ClientCommand::StopLocalSteering,
            ApiCommand::DrivePulse { pulse } => {
                let duration_ms = pulse.duration_ms.clamp(50, MAX_DRIVE_PULSE_MS);
                ClientCommand::DriveSelf(PlayerDriveIntent::ManualPulse {
                    state: CharacterDrive {
                        gait: pulse.gait,
                        longitudinal: pulse.longitudinal,
                        lateral: pulse.lateral,
                        turning: pulse.turning,
                        turn_rate_scalar: None,
                    },
                    duration: Duration::from_millis(u64::from(duration_ms)),
                })
            }
            ApiCommand::SnapFacing { heading } => {
                if !heading.is_finite() {
                    return Err(ApiError::invalid("heading must be finite"));
                }
                ClientCommand::DriveSelf(PlayerDriveIntent::SnapFacing { heading })
            }
            ApiCommand::JumpTo { .. }
            | ApiCommand::SetSelection { .. }
            | ApiCommand::UiPrint { .. }
            | ApiCommand::HudToast { .. }
            | ApiCommand::HudUpsertMarkers { .. }
            | ApiCommand::HudClearMarkers { .. }
            | ApiCommand::HudSetWaypoint { .. }
            | ApiCommand::HudPlayCue { .. } => {
                unreachable!("direct/UI/HUD commands handled before translate_command")
            }
        })
    }
}

enum SettlementMatcher {
    Busy(BusyOperationKind),
    ItemUse,
    Appraisal { guid: Guid, facts_only: bool },
    Navigation,
    Jump,
    VendorTrade,
    CombatMode { expected: &'static str },
    Inventory { item: Guid },
    SelectCharacter,
    Logout,
}

fn settlement_matcher(command: &ApiCommand) -> Option<SettlementMatcher> {
    match command {
        ApiCommand::CastSpell { .. } => Some(SettlementMatcher::Busy(BusyOperationKind::SpellCast)),
        ApiCommand::UseEntity { .. } => Some(SettlementMatcher::Busy(BusyOperationKind::Use)),
        ApiCommand::UseItem { .. } => Some(SettlementMatcher::ItemUse),
        ApiCommand::RequestAppraisal { guid, facts_only } => Some(SettlementMatcher::Appraisal {
            guid: *guid,
            facts_only: *facts_only,
        }),
        // Continuous `Follow` never emits `LocalNavigationFinished` on arrival, so do not wait.
        ApiCommand::Steer { request }
            if !matches!(
                request.goal,
                holtburger_core::client::steering::LocalSteeringGoal::Follow { .. }
            ) =>
        {
            Some(SettlementMatcher::Navigation)
        }
        ApiCommand::VendorTrade { .. } => Some(SettlementMatcher::VendorTrade),
        ApiCommand::SetCombatMode { mode } => Some(SettlementMatcher::CombatMode {
            expected: format_combat_mode(combat_mode_spec_to_core(*mode)),
        }),
        ApiCommand::Inventory { intent } => {
            Some(SettlementMatcher::Inventory { item: intent.item })
        }
        ApiCommand::SelectCharacter { .. } => Some(SettlementMatcher::SelectCharacter),
        ApiCommand::Logout => Some(SettlementMatcher::Logout),
        _ => None,
    }
}

fn match_settlement(
    matcher: &SettlementMatcher,
    correlation_id: Option<u64>,
    envelope: &ApiEventEnvelope,
) -> Option<CommandOutcome> {
    match (matcher, &envelope.event) {
        (
            SettlementMatcher::Busy(expected),
            ApiEvent::BusyOperationFinished {
                operation,
                succeeded,
                error,
                timed_out,
            },
        ) if operation == expected => Some(CommandOutcome::Busy(BusyOperationOutcome {
            operation: *operation,
            succeeded: *succeeded,
            error: error.clone(),
            timed_out: *timed_out,
            teleported: None,
        })),
        (
            SettlementMatcher::Busy(expected),
            ApiEvent::LifecycleChanged {
                lifecycle: LifecyclePhaseView::PortalSpace { .. },
            },
        ) => Some(CommandOutcome::Busy(BusyOperationOutcome {
            operation: *expected,
            succeeded: *expected == BusyOperationKind::Use,
            error: (*expected != BusyOperationKind::Use)
                .then(|| "operation interrupted by portal transition".into()),
            timed_out: false,
            teleported: Some(true),
        })),
        (
            SettlementMatcher::Busy(expected),
            ApiEvent::LifecycleChanged {
                lifecycle:
                    LifecyclePhaseView::LoggingOut
                    | LifecyclePhaseView::CharacterSelection { .. }
                    | LifecyclePhaseView::Exiting { .. },
            },
        ) => Some(CommandOutcome::Busy(BusyOperationOutcome {
            operation: *expected,
            succeeded: false,
            error: Some("operation aborted by lifecycle transition".into()),
            timed_out: false,
            teleported: None,
        })),
        (SettlementMatcher::ItemUse, ApiEvent::ItemUseFinished { sequence, outcome })
            if correlation_id == Some(u64::from(*sequence)) =>
        {
            Some(CommandOutcome::Dynamic(outcome.clone()))
        }
        (
            SettlementMatcher::Appraisal { guid, facts_only },
            ApiEvent::AppraisalCompleted {
                guid: event_guid,
                facts_only: event_facts_only,
                status,
                reason,
                inspection,
            },
        ) if event_guid == guid && (*facts_only || !*event_facts_only) => {
            Some(CommandOutcome::Appraisal(AppraisalOutcome {
                guid: *event_guid,
                facts_only: *event_facts_only,
                status: *status,
                reason: reason.clone(),
                inspection: inspection.clone(),
            }))
        }
        (SettlementMatcher::Navigation, ApiEvent::NavigationFinished { finished })
            if correlation_id == Some(finished.correlation_id) =>
        {
            Some(CommandOutcome::Navigation(*finished))
        }
        (SettlementMatcher::Jump, ApiEvent::JumpFinished { finished })
            if correlation_id.is_some() && finished.correlation_id == correlation_id =>
        {
            Some(CommandOutcome::Jump(*finished))
        }
        (SettlementMatcher::VendorTrade, ApiEvent::VendorTradeFinished { sequence, result })
            if correlation_id == Some(u64::from(*sequence)) =>
        {
            Some(CommandOutcome::Dynamic(result.clone()))
        }
        (SettlementMatcher::CombatMode { expected }, ApiEvent::CombatModeUpdated { mode })
            if mode == expected || mode == "peace" =>
        {
            Some(CommandOutcome::CombatMode(CombatModeOutcome {
                matched: mode == expected,
                mode: mode.clone(),
            }))
        }
        (
            SettlementMatcher::Inventory { item },
            ApiEvent::EntityFactsChanged { upserted, removed },
        ) if upserted.contains(item) || removed.contains(item) => {
            Some(CommandOutcome::Inventory(InventoryOutcome {
                item: *item,
                settled_by: "updated".into(),
                error: None,
            }))
        }
        (SettlementMatcher::Inventory { item }, ApiEvent::EntityDespawned { guid })
            if guid == item =>
        {
            Some(CommandOutcome::Inventory(InventoryOutcome {
                item: *item,
                settled_by: "despawned".into(),
                error: None,
            }))
        }
        (SettlementMatcher::Inventory { item }, ApiEvent::ErrorNotice { source, message })
            if source != "chat" =>
        {
            Some(CommandOutcome::Inventory(InventoryOutcome {
                item: *item,
                settled_by: "rejected".into(),
                error: Some(message.clone()),
            }))
        }
        (
            SettlementMatcher::SelectCharacter,
            ApiEvent::LifecycleChanged {
                lifecycle: lifecycle @ LifecyclePhaseView::InWorld,
            },
        ) => Some(CommandOutcome::Lifecycle(LifecycleOutcome {
            lifecycle: lifecycle.phase_label().into(),
            rejection: None,
        })),
        (
            SettlementMatcher::SelectCharacter,
            ApiEvent::LifecycleChanged {
                lifecycle:
                    lifecycle @ LifecyclePhaseView::CharacterSelection {
                        rejection: Some(reason),
                        ..
                    },
            },
        ) => Some(CommandOutcome::Lifecycle(LifecycleOutcome {
            lifecycle: lifecycle.phase_label().into(),
            rejection: Some(reason.clone()),
        })),
        (
            SettlementMatcher::Logout,
            ApiEvent::LifecycleChanged {
                lifecycle: lifecycle @ LifecyclePhaseView::CharacterSelection { .. },
            },
        ) => Some(CommandOutcome::Lifecycle(LifecycleOutcome {
            lifecycle: lifecycle.phase_label().into(),
            rejection: None,
        })),
        _ => None,
    }
}

fn immediate_accepted(latest_event_seq: u64) -> CommandResponse {
    CommandResponse {
        accepted: true,
        correlation_id: None,
        settled: true,
        timed_out: false,
        outcome: None,
        latest_event_seq,
    }
}

fn map_rejection(rejection: CommandRejection) -> ApiError {
    match rejection {
        CommandRejection::AutomationPaused => ApiError::new(
            ApiErrorCode::AutomationPaused,
            "automation is paused by the user",
        ),
        CommandRejection::NotInWorld => ApiError::new(
            ApiErrorCode::NotInWorld,
            "character is not currently in the world",
        ),
        CommandRejection::InvalidLifecycleState { expected } => ApiError::new(
            ApiErrorCode::InvalidLifecycleState,
            format!("invalid lifecycle state; expected {expected}"),
        ),
        CommandRejection::Busy { active } => ApiError::new(
            ApiErrorCode::Busy,
            format!("character is busy ({active:?})"),
        ),
        CommandRejection::Validation { message } => ApiError::invalid(message),
        CommandRejection::Failed { message } => ApiError::new(ApiErrorCode::Internal, message),
    }
}

fn local_player_pose(
    world: &holtburger_world::WorldState,
) -> Option<holtburger_common::position::WorldPosition> {
    world
        .local_player_runtime_pose()
        .or_else(|| world.player_entity().map(|e| e.position))
}

async fn run_targeted_jump_solver(
    snapshot: holtburger_core::TargetedJumpSnapshot,
    target: TargetedJumpTarget,
    power: Option<JumpExtent>,
) -> ApiResult<holtburger_core::TargetedJumpSolution> {
    tokio::task::spawn_blocking(move || {
        let cancelled = AtomicBool::new(false);
        solve_targeted_jump(&snapshot, target, power, &cancelled)
    })
    .await
    .map_err(|e| ApiError::runtime(format!("targeted jump solver panicked: {e}")))?
    .map_err(|e| ApiError::runtime(format!("targeted jump solver failed: {e}")))
}

fn validate_optional_jump_power(power: Option<f32>) -> ApiResult<Option<JumpExtent>> {
    match power {
        Some(value) => JumpExtent::new(value).map(Some).map_err(|_| {
            ApiError::invalid("jump-to `power` must be finite and within [0.001, 1.0]")
        }),
        None => Ok(None),
    }
}

fn spatial_anchor_and_cell(landblock_id: Guid) -> (Guid, Option<Guid>) {
    let anchor = Guid((landblock_id.0 & 0xffff_0000) | 0xffff);
    let cell = ((landblock_id.0 & 0xffff) >= 0x0100).then_some(landblock_id);
    (anchor, cell)
}

fn to_json<T: serde::Serialize>(value: T) -> ApiResult<Value> {
    serde_json::to_value(value).map_err(|e| ApiError::new(ApiErrorCode::Internal, e.to_string()))
}

pub(crate) fn format_combat_mode(mode: CombatMode) -> &'static str {
    match mode {
        CombatMode::NonCombat => "peace",
        CombatMode::Melee => "melee",
        CombatMode::Missile => "missile",
        CombatMode::Magic => "magic",
        CombatMode::Undef => "undef",
    }
}

fn combat_mode_spec_to_core(mode: CombatModeSpec) -> CombatMode {
    match mode {
        CombatModeSpec::Peace => CombatMode::NonCombat,
        CombatModeSpec::Melee => CombatMode::Melee,
        CombatModeSpec::Missile => CombatMode::Missile,
        CombatModeSpec::Magic => CombatMode::Magic,
    }
}

fn project_weapon_profile(
    profile: &holtburger_protocol::messages::object::types::WeaponProfile,
) -> WeaponProfileView {
    let weapon_skill_name = holtburger_common::stats::SkillType::from_repr(profile.weapon_skill)
        .map(|s| format!("{s:?}"));
    WeaponProfileView {
        damage_type: profile.damage_type,
        weapon_time: profile.weapon_time,
        weapon_skill: profile.weapon_skill,
        weapon_skill_name,
        damage: profile.damage,
        damage_variance: profile.damage_variance,
        damage_mod: profile.damage_mod,
        weapon_length: profile.weapon_length,
        max_velocity: profile.max_velocity,
        weapon_offense: profile.weapon_offense,
        max_velocity_estimated: profile.max_velocity_estimated,
    }
}

fn into_core_attack_profile(spec: AttackProfileSpec) -> ApiResult<ClientAttackProfile> {
    let profile = match spec {
        AttackProfileSpec::Melee { height, power } => ClientAttackProfile::Melee {
            height: into_core_height(height),
            power,
        },
        AttackProfileSpec::Missile { height, accuracy } => ClientAttackProfile::Missile {
            height: into_core_height(height),
            accuracy,
        },
    };
    profile.validated().map_err(ApiError::invalid)
}

fn from_core_attack_profile(profile: ClientAttackProfile) -> AttackProfileSpec {
    match profile {
        ClientAttackProfile::Melee { height, power } => AttackProfileSpec::Melee {
            height: from_core_height(height),
            power,
        },
        ClientAttackProfile::Missile { height, accuracy } => AttackProfileSpec::Missile {
            height: from_core_height(height),
            accuracy,
        },
    }
}

fn into_core_height(height: AttackHeightSpec) -> AttackHeight {
    match height {
        AttackHeightSpec::Low => AttackHeight::Low,
        AttackHeightSpec::Medium => AttackHeight::Medium,
        AttackHeightSpec::High => AttackHeight::High,
    }
}

fn from_core_height(height: AttackHeight) -> AttackHeightSpec {
    match height {
        AttackHeight::Low => AttackHeightSpec::Low,
        AttackHeight::Medium => AttackHeightSpec::Medium,
        AttackHeight::High => AttackHeightSpec::High,
    }
}

fn into_vendor_draft(trade: VendorTradeSpec) -> VendorDraft {
    VendorDraft {
        vendor: trade.vendor,
        buys: trade
            .buys
            .into_iter()
            .map(|line| VendorPurchase {
                item: line.item,
                amount: line.amount,
            })
            .collect(),
        sells: trade.sells,
    }
}

fn build_entity_summary(
    entity: &Entity,
    facts: Option<&ClientEntityFacts>,
    self_pos: Option<holtburger_common::position::WorldPosition>,
) -> EntitySummary {
    let class = holtburger_world::entity_classification::classify_entity(entity);
    let category = serde_json::to_value(class)
        .ok()
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_else(|| "unknown".into());
    let is_vendor = class == holtburger_world::entity_classification::EntityClass::Vendor
        || facts
            .and_then(|f| f.nearby.as_ref())
            .is_some_and(|n| n.vendor);
    let is_hostile = facts.is_some_and(|f| f.is_hostile);
    let is_dead = entity.motion_command().is_some_and(|cmd| cmd.is_dead())
        || entity
            .creature_profile
            .as_ref()
            .is_some_and(|p| p.health == 0);
    let stack_count = facts.and_then(|f| match &f.description {
        EntityDescription::Known { stack_count, .. } => *stack_count,
        EntityDescription::Pending => None,
    });
    let (container, wielder) = match facts.map(|f| f.location) {
        Some(EntityStorageLocation::Contained { parent_guid, .. }) => (Some(parent_guid), None),
        Some(EntityStorageLocation::Equipped { wearer_guid, .. }) => (None, Some(wearer_guid)),
        _ => (None, None),
    };
    let distance_to_self =
        (container.is_none() && wielder.is_none() && !entity.position.landblock_id.is_null())
            .then(|| self_pos.map(|p| p.distance_to(&entity.position)))
            .flatten();
    EntitySummary {
        guid: entity.guid,
        name: entity.name().to_string(),
        wcid: entity.wcid,
        category,
        is_hostile,
        is_dead,
        is_vendor,
        position: entity.position,
        distance_to_self,
        health_fraction: entity.health.map(|h| h.fraction),
        stack_count,
        container,
        wielder,
    }
}

fn extract_entity_properties(entity: &Entity) -> EntityPropertiesView {
    let props = &entity.properties;
    EntityPropertiesView {
        ints: props
            .ints
            .iter()
            .map(|(k, &v)| (format!("{k:?}"), v))
            .collect(),
        int64s: props
            .int64s
            .iter()
            .map(|(k, &v)| (format!("{k:?}"), v))
            .collect(),
        floats: props
            .floats
            .iter()
            .map(|(k, &v)| (format!("{k:?}"), v))
            .collect(),
        bools: props
            .bools
            .iter()
            .map(|(k, &v)| (format!("{k:?}"), v))
            .collect(),
        strings: props
            .strings
            .iter()
            .map(|(k, v)| (format!("{k:?}"), v.clone()))
            .collect(),
        dids: props
            .dids
            .iter()
            .map(|(k, &v)| (format!("{k:?}"), v))
            .collect(),
        iids: props
            .iids
            .iter()
            .map(|(k, &v)| (format!("{k:?}"), v))
            .collect(),
    }
}

fn spell_view(id: u32, info: &holtburger_world::spell::SpellInfo) -> SpellDefinitionView {
    let duration = match &info.extras {
        SpellExtrasInfo::Enchantment { duration, .. } => Some(*duration),
        _ => None,
    };
    let casting_route = match info.casting_route() {
        holtburger_world::spell::SpellCastingRoute::SelfTarget => SpellCastingRouteView::SelfTarget,
        holtburger_world::spell::SpellCastingRoute::Untargeted => SpellCastingRouteView::Untargeted,
        holtburger_world::spell::SpellCastingRoute::SelectedTarget => {
            SpellCastingRouteView::SelectedTarget
        }
    };
    SpellDefinitionView {
        id,
        name: info.name.clone(),
        description: info.description.clone(),
        school: format!("{:?}", info.school),
        icon_id: info.icon_id,
        category: info.category,
        bitfield: info.bitfield,
        is_beneficial: info.is_beneficial(),
        casting_route,
        base_mana: info.base_mana,
        base_range_constant: info.base_range_constant,
        base_range_mod: info.base_range_mod,
        power: info.power,
        components: info
            .components
            .iter()
            .copied()
            .filter(|&c| c != 0)
            .collect(),
        duration,
    }
}

fn project_entity_facts(entity: &Entity, facts: &ClientEntityFacts) -> EntityFactsView {
    use holtburger_common::properties::{PropertyBool, WorldObjectPropertyAccessors as _};
    let use_capability = match &facts.description {
        EntityDescription::Pending => ItemUseCapabilityView::Unavailable,
        EntityDescription::Known { use_capability, .. } => match use_capability {
            holtburger_world::item_use::ItemUseCapability::Unavailable => {
                ItemUseCapabilityView::Unavailable
            }
            holtburger_world::item_use::ItemUseCapability::Unsupported => {
                ItemUseCapabilityView::Unsupported
            }
            holtburger_world::item_use::ItemUseCapability::Direct => ItemUseCapabilityView::Direct,
            holtburger_world::item_use::ItemUseCapability::SalvageTool => {
                ItemUseCapabilityView::SalvageTool
            }
            holtburger_world::item_use::ItemUseCapability::Targeted => {
                ItemUseCapabilityView::Targeted
            }
        },
    };
    let lock_tool = facts.lock_tool.as_ref().map(|tool| match tool {
        holtburger_world::entity_facts::LockToolFacts::Key => LockToolView::Key,
        holtburger_world::entity_facts::LockToolFacts::Lockpick { bonus } => {
            LockToolView::Lockpick { bonus: *bonus }
        }
    });
    let (item_capacity, pack_capacity) = match facts.storage {
        StorageCoverage::Container {
            item_capacity,
            pack_capacity,
            ..
        } => (item_capacity, pack_capacity),
        StorageCoverage::NotEstablished => (None, None),
    };
    let (is_corpse, corpse_open) = match &facts.corpse {
        Some(holtburger_world::entity_facts::CorpseState::Opened) => (true, true),
        Some(holtburger_world::entity_facts::CorpseState::Unopened) => (true, false),
        None => (false, false),
    };
    let dynamic_collision = entity.physics.effective().dynamic_collision;
    let blocks_movement = matches!(facts.location, EntityStorageLocation::None)
        && !entity.position.landblock_id.is_null()
        && !dynamic_collision.missile
        && dynamic_collision.target == holtburger_world::EntityCollisionParticipation::Solid;
    EntityFactsView {
        use_capability,
        is_locked: facts.is_locked,
        is_open: entity.get_bool_prop_opt(PropertyBool::Open),
        blocks_movement,
        lock_tool,
        owned_by_player: facts.owned_by_player,
        can_pick_up: facts.can_pick_up,
        world_container_content: facts.world_container_content,
        can_receive_give: facts.can_receive_give,
        can_trade: facts.can_trade,
        can_offer_trade: facts.can_offer_trade,
        is_hostile: facts.is_hostile,
        is_corpse,
        corpse_open,
        item_capacity,
        pack_capacity,
        summon_owner: facts.summon.as_ref().map(|s| s.owner),
    }
}

fn project_spell_inspection(
    outcome: holtburger_core::client::spell_inspection::SpellInspectionOutcome,
    readiness: SpellCastReadinessView,
) -> SpellInspectionPreview {
    use holtburger_core::client::spell_inspection::{SpellFormulaResult, SpellInspectionOutcome};
    match outcome {
        SpellInspectionOutcome::Pending => SpellInspectionPreview::Pending,
        SpellInspectionOutcome::Missing => SpellInspectionPreview::Missing,
        SpellInspectionOutcome::Ready {
            range_metres,
            formula,
        } => SpellInspectionPreview::Ready {
            range_metres,
            formula: match formula {
                SpellFormulaResult::Pending => SpellFormulaPreview::Pending,
                SpellFormulaResult::Ready { components } => {
                    SpellFormulaPreview::Ready { components }
                }
                SpellFormulaResult::Failed { detail } => SpellFormulaPreview::Failed { detail },
            },
            readiness,
        },
    }
}

fn project_fellowship(
    fellowship: &holtburger_world::state::fellowship::FellowshipState,
) -> FellowshipView {
    FellowshipView {
        name: fellowship.name.clone(),
        leader_guid: fellowship.leader_guid,
        share_xp: fellowship.share_xp,
        even_share: fellowship.even_share,
        open: fellowship.open,
        is_locked: fellowship.is_locked,
        members: fellowship
            .members
            .iter()
            .map(|m| FellowshipMemberView {
                guid: m.guid,
                name: m.name.clone(),
                level: m.level,
                max_health: m.max_health,
                max_stamina: m.max_stamina,
                max_mana: m.max_mana,
                current_health: m.current_health,
                current_stamina: m.current_stamina,
                current_mana: m.current_mana,
                share_loot: m.share_loot,
            })
            .collect(),
    }
}

fn project_friends(friends: &holtburger_world::state::friends::FriendsState) -> Vec<FriendView> {
    friends
        .members
        .values()
        .map(|f| FriendView {
            guid: f.guid,
            name: f.name.clone(),
            online: f.online,
        })
        .collect()
}

fn project_allegiance_member(member: AllegianceMember) -> AllegianceMemberView {
    AllegianceMemberView {
        guid: member.guid,
        name: member.name,
        title: member.title.map(str::to_string),
        rank: member.rank,
        level: member.level,
        online: member.online,
        contributed_xp: member.contributed_xp,
    }
}

fn default_equipment_storage_policy(
    world: &holtburger_world::WorldState,
) -> EquipmentStoragePolicy {
    let mut packs: Vec<_> = world
        .container_contents(world.player.guid)
        .filter_map(|(guid, slot)| match slot {
            StorageSlot::Pack {
                index,
                kind: PackEntryKind::Container,
            } => Some((index, guid)),
            _ => None,
        })
        .collect();
    packs.sort_unstable();
    EquipmentStoragePolicy {
        preferred: BTreeMap::new(),
        fallback: std::iter::once(world.player.guid)
            .chain(packs.into_iter().map(|(_, guid)| guid))
            .collect(),
    }
}

fn project_allegiance(
    snapshot: &holtburger_core::client::allegiance::AllegianceSnapshot,
) -> AllegianceView {
    let profile = snapshot.profile.as_ref().map(|p| {
        let roles = snapshot.player_guid.map(|player| p.relationships(player));
        AllegianceProfileView {
            name: p.name.clone(),
            rank: p.rank,
            total_members: p.total_members,
            total_descendants: p.total_descendants,
            monarch: roles
                .as_ref()
                .and_then(|r| r.monarch)
                .map(AllegianceMember::from)
                .map(project_allegiance_member),
            patron: roles
                .as_ref()
                .and_then(|r| r.patron)
                .map(AllegianceMember::from)
                .map(project_allegiance_member),
            self_member: roles
                .as_ref()
                .and_then(|r| r.self_member)
                .map(AllegianceMember::from)
                .map(project_allegiance_member),
            direct_vassals: roles
                .as_ref()
                .map(|r| {
                    r.direct_vassals
                        .iter()
                        .copied()
                        .map(AllegianceMember::from)
                        .map(project_allegiance_member)
                        .collect()
                })
                .unwrap_or_default(),
        }
    });
    AllegianceView {
        player_guid: snapshot.player_guid,
        refreshing: snapshot.refreshing,
        can_swear: snapshot.can_swear,
        profile,
    }
}

fn project_squelch(squelch: &holtburger_world::state::squelch::SquelchState) -> SquelchView {
    let characters = squelch
        .characters
        .iter()
        .map(|(&guid, rec)| {
            let mgmt = rec.management();
            SquelchCharacterView {
                guid,
                name: rec.name.clone(),
                account: rec.account,
                coverage: format!("{:?}", mgmt.coverage),
                removal_scope: mgmt.removal_scope.map(|s| format!("{s:?}")),
            }
        })
        .collect();
    SquelchView {
        accounts: squelch.accounts.clone(),
        characters,
        globals: SquelchGlobalView {
            name: squelch.globals.name.clone(),
            coverage: format!("{:?}", squelch.globals.filter.coverage()),
        },
    }
}

fn project_outdoor_coords(
    pos: holtburger_common::position::WorldPosition,
) -> Option<OutdoorCoordsView> {
    if pos.landblock_id.is_null() || pos.is_indoors() {
        return None;
    }
    let coords = pos.to_world_coords();
    match coords {
        holtburger_common::position::WorldCoordinates::Outdoor { lat, lon, alt } => {
            let label = coords.outdoor_label()?;
            Some(OutdoorCoordsView {
                lat,
                lon,
                alt,
                label,
            })
        }
        holtburger_common::position::WorldCoordinates::Indoor { .. } => None,
    }
}

fn project_salvage_evaluation(eval: &SalvageEvaluation) -> SalvagePreview {
    match eval {
        SalvageEvaluation::Ready { review, bags } => SalvagePreview::Ready {
            tool: review.tool.guid,
            bags: to_camel_json(bags).unwrap_or(Value::Null),
        },
        SalvageEvaluation::PendingDetails { tool, items } => SalvagePreview::PendingDetails {
            tool: tool.guid,
            items: items.clone(),
        },
        SalvageEvaluation::Rejected { reason } => SalvagePreview::Rejected {
            reason: reason.clone(),
        },
    }
}
