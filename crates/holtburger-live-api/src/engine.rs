//! Transport-free Live API engine shared by REST, WebSocket, and in-process V8 scripting.

use std::collections::{BTreeMap, HashSet};
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};
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
    CommandRejection,
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
use serde_json::{Value, json};
use tokio::sync::broadcast;

use crate::event_log::{
    EventLog, ingest_client_view_event, project_confirmation, project_lifecycle, project_trade,
    project_vendor,
};
use crate::hooks::{
    ApiError, ApiErrorCode, ApiResult, ClientHudHook, ClientUiHook, HudScreenshotRequest,
    HudScreenshotResponse, StaticReferenceCatalogs,
};
use crate::types::{
    AllegianceCommandSpec, ApiCommand, ApiEvent, ApiEventEnvelope, ApiEventTopic, ApiInfo,
    ApiPreviewRequest, ApiQuery, AttackHeightSpec, AttackProfileSpec, CellPortalView,
    CellTopologyView, ChatCommandSpec, CombatModeSpec, CombatView, CommandResponse, ContainerView,
    CorpseConsentCommandSpec, DEFAULT_SPHERE_SWEEP_RADIUS, DeathLocationsView, EntityDetail,
    EntityFilter, EntityPropertiesView, EntitySummary, EquipmentView, EquippedItemView, EventsPage,
    FellowshipCommandSpec, FriendsCommandSpec, InventoryView, LIVE_API_VERSION, LifecyclePhaseView,
    MAX_DRIVE_PULSE_MS, MAX_RAYCAST_BATCH, MAX_WAIT_TIMEOUT_MS, RaycastSpec, RestPostureSpec,
    SelectionView, SelfView, SkillDefinitionView, SocialView, SpellDefinitionView, SpellbookView,
    SquelchCommandSpec, TradeView, VendorTradeSpec, VendorView, WaitPolicy, WaitUntil,
    WorldCellsView, CharacterOptionsView, camelize_json, to_camel_json,
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
        lifecycle: lifecycle_label(&ctx.lifecycle()).into(),
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
        self.inner
            .event_log
            .push(ApiEventTopic::Selection, ApiEvent::SelectionChanged { guid });
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
                let position = world.local_player_runtime_pose().or_else(|| entity.map(|e| e.position));
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
                let allowed_categories: Option<HashSet<String>> = filter.category.as_ref().map(|s| {
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
                    facts: facts.and_then(to_camel_json),
                    armor_profile: entity.armor_profile.as_ref().and_then(to_camel_json),
                    creature_profile: entity.creature_profile.as_ref().and_then(to_camel_json),
                    weapon_profile: entity.weapon_profile.as_ref().and_then(to_camel_json),
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
                        items.push(EquippedItemView {
                            guid: entity.guid,
                            name: Some(entity.name().to_string()),
                            equip_mask: mask.unwrap_or(0),
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
                fellowship: ctx.world().fellowship.as_ref().and_then(to_camel_json),
                allegiance: project_allegiance(&ctx.allegiance()),
                friends: ctx.world().friends.as_ref().and_then(to_camel_json),
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
    pub async fn preview(&self, request: ApiPreviewRequest) -> ApiResult<Value> {
        match request {
            ApiPreviewRequest::ItemUseTarget { source, target } => {
                let (eligible, lockpick_success_percent) = self
                    .inner
                    .handle
                    .read(move |ctx| ctx.evaluate_item_use_target(source, target))
                    .await
                    .map_err(|e| ApiError::runtime(e.to_string()))?;
                Ok(json!({
                    "eligible": eligible,
                    "lockpickSuccessPercent": lockpick_success_percent,
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
                Ok(project_salvage_evaluation(&eval))
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
                to_json(result).map(camelize_json)
            }
            ApiPreviewRequest::SpellInspection { spell_id } => {
                let outcome = self
                    .inner
                    .handle
                    .read(move |ctx| ctx.inspect_spell(spell_id))
                    .await
                    .map_err(|e| ApiError::runtime(e.to_string()))?;
                to_json(outcome).map(camelize_json)
            }
            ApiPreviewRequest::Raycast { rays } => {
                if rays.is_empty() || rays.len() > MAX_RAYCAST_BATCH {
                    return Err(ApiError::invalid(format!(
                        "raycast batch size must be in 1..={MAX_RAYCAST_BATCH}"
                    )));
                }
                self.inner
                    .handle
                    .read(move |ctx| -> ApiResult<Value> {
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
                                results.push(json!({
                                    "hit": false,
                                    "anchor": anchor,
                                    "distance": null,
                                    "point": null,
                                    "normal": null,
                                    "cellId": null,
                                    "uncovered": false,
                                }));
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
                                Some(hit) => json!({
                                    "hit": true,
                                    "anchor": anchor,
                                    "distance": hit.distance,
                                    "point": hit.point,
                                    "normal": hit.normal,
                                    "cellId": hit.placement.committed_cell(),
                                    "uncovered": query.unavailable_owner.is_some(),
                                }),
                                None => json!({
                                    "hit": false,
                                    "anchor": anchor,
                                    "distance": null,
                                    "point": null,
                                    "normal": null,
                                    "cellId": null,
                                    "uncovered": query.unavailable_owner.is_some(),
                                }),
                            };
                            results.push(entry);
                        }
                        Ok(json!({ "results": results }))
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
                    .read(move |ctx| -> ApiResult<Value> {
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
                        Ok(json!({
                            "blocked": blocked,
                            "anchor": anchor,
                            "fraction": fraction,
                            "point": point,
                            "normal": normal,
                            "uncovered": query.unavailable_owner.is_some(),
                        }))
                    })
                    .await
                    .map_err(|e| ApiError::runtime(e.to_string()))?
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
                if guid.is_some() {
                    let in_world = self
                        .inner
                        .handle
                        .read(|ctx| matches!(ctx.lifecycle(), ClientLifecycleState::InWorld))
                        .await
                        .map_err(|e| ApiError::runtime(e.to_string()))?;
                    if !in_world {
                        return Err(ApiError::new(
                            ApiErrorCode::NotInWorld,
                            "cannot select an entity while not in-world",
                        ));
                    }
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
                ui.print(request).await?;
                Ok(immediate_accepted(self.inner.event_log.latest_seq()))
            }
            ApiCommand::HudToast { request } => {
                let hud = self
                    .inner
                    .hud
                    .as_ref()
                    .ok_or_else(|| ApiError::unsupported("h3d.hud"))?;
                hud.toast(request).await?;
                Ok(immediate_accepted(self.inner.event_log.latest_seq()))
            }
            ApiCommand::HudUpsertMarkers { request } => {
                let hud = self
                    .inner
                    .hud
                    .as_ref()
                    .ok_or_else(|| ApiError::unsupported("h3d.hud"))?;
                hud.upsert_markers(request).await?;
                Ok(immediate_accepted(self.inner.event_log.latest_seq()))
            }
            ApiCommand::HudClearMarkers { namespace } => {
                let hud = self
                    .inner
                    .hud
                    .as_ref()
                    .ok_or_else(|| ApiError::unsupported("h3d.hud"))?;
                hud.clear_markers(namespace).await?;
                Ok(immediate_accepted(self.inner.event_log.latest_seq()))
            }
            other => self.execute_core_command(other, wait).await,
        }
    }

    async fn execute_core_command(
        &self,
        command: ApiCommand,
        wait: WaitPolicy,
    ) -> ApiResult<CommandResponse> {
        let waiter_kind = settlement_matcher(&command);
        let core_cmd = self.translate_command(command).await?;

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
                FellowshipCommandSpec::Invite { target } => {
                    ClientCommand::InviteToParty { target }
                }
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
            ApiCommand::SetCombatMode { mode } => ClientCommand::SetCombatMode(match mode {
                CombatModeSpec::Peace => CombatMode::NonCombat,
                CombatModeSpec::Melee => CombatMode::Melee,
                CombatModeSpec::Missile => CombatMode::Missile,
                CombatModeSpec::Magic => CombatMode::Magic,
            }),
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
            ApiCommand::SetRestPosture { posture } => ClientCommand::SetRestPosture(match posture {
                RestPostureSpec::Standing => RestPosture::Standing,
                RestPostureSpec::Crouching => RestPosture::Crouching,
                RestPostureSpec::Sitting => RestPosture::Sitting,
                RestPostureSpec::Lying => RestPosture::Lying,
            }),
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
            ApiCommand::SetSelection { .. }
            | ApiCommand::UiPrint { .. }
            | ApiCommand::HudToast { .. }
            | ApiCommand::HudUpsertMarkers { .. }
            | ApiCommand::HudClearMarkers { .. } => {
                unreachable!("UI/HUD hook commands handled before translate_command")
            }
        })
    }
}

enum SettlementMatcher {
    Busy(BusyOperationKind),
    ItemUse,
    Appraisal { guid: Guid, facts_only: bool },
    Navigation,
    VendorTrade,
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
        ApiCommand::SelectCharacter { .. } => Some(SettlementMatcher::SelectCharacter),
        ApiCommand::Logout => Some(SettlementMatcher::Logout),
        _ => None,
    }
}

fn match_settlement(
    matcher: &SettlementMatcher,
    correlation_id: Option<u64>,
    envelope: &ApiEventEnvelope,
) -> Option<Value> {
    match (matcher, &envelope.event) {
        (
            SettlementMatcher::Busy(expected),
            ApiEvent::BusyOperationFinished {
                operation,
                succeeded,
                error,
                timed_out,
            },
        ) if operation == expected => Some(json!({
            "operation": operation,
            "succeeded": succeeded,
            "error": error,
            "timedOut": timed_out,
        })),
        (
            SettlementMatcher::Busy(expected),
            ApiEvent::LifecycleChanged {
                lifecycle: LifecyclePhaseView::PortalSpace { .. },
            },
        ) => Some(json!({
            "operation": expected,
            "succeeded": *expected == BusyOperationKind::Use,
            "error": (*expected != BusyOperationKind::Use).then_some("operation interrupted by portal transition"),
            "timedOut": false,
            "teleported": true,
        })),
        (
            SettlementMatcher::Busy(expected),
            ApiEvent::LifecycleChanged {
                lifecycle:
                    LifecyclePhaseView::LoggingOut
                    | LifecyclePhaseView::CharacterSelection { .. }
                    | LifecyclePhaseView::Exiting { .. },
            },
        ) => Some(json!({
            "operation": expected,
            "succeeded": false,
            "error": "operation aborted by lifecycle transition",
            "timedOut": false,
        })),
        (SettlementMatcher::ItemUse, ApiEvent::ItemUseFinished { sequence, outcome })
            if correlation_id == Some(u64::from(*sequence)) =>
        {
            Some(outcome.clone())
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
            let mut obj = serde_json::Map::new();
            obj.insert("guid".into(), json!(event_guid));
            obj.insert("factsOnly".into(), json!(event_facts_only));
            obj.insert("status".into(), json!(status));
            if let Some(reason) = reason {
                obj.insert("reason".into(), json!(reason));
            }
            if let Some(inspection) = inspection {
                obj.insert("inspection".into(), inspection.clone());
            }
            Some(Value::Object(obj))
        }
        (SettlementMatcher::Navigation, ApiEvent::NavigationFinished { finished })
            if correlation_id == Some(finished.correlation_id) =>
        {
            serde_json::to_value(finished).ok()
        }
        (
            SettlementMatcher::VendorTrade,
            ApiEvent::VendorTradeFinished { sequence, result },
        ) if correlation_id == Some(u64::from(*sequence)) => Some(result.clone()),
        (
            SettlementMatcher::SelectCharacter,
            ApiEvent::LifecycleChanged {
                lifecycle: LifecyclePhaseView::InWorld,
            },
        ) => Some(json!({ "lifecycle": "in-world" })),
        (
            SettlementMatcher::SelectCharacter,
            ApiEvent::LifecycleChanged {
                lifecycle:
                    LifecyclePhaseView::CharacterSelection {
                        rejection: Some(reason),
                        ..
                    },
            },
        ) => Some(json!({ "lifecycle": "character-selection", "rejection": reason })),
        (
            SettlementMatcher::Logout,
            ApiEvent::LifecycleChanged {
                lifecycle: LifecyclePhaseView::CharacterSelection { .. },
            },
        ) => Some(json!({ "lifecycle": "character-selection" })),
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
        CommandRejection::AutomationPaused => {
            ApiError::new(ApiErrorCode::AutomationPaused, "automation is paused by the user")
        }
        CommandRejection::NotInWorld => {
            ApiError::new(ApiErrorCode::NotInWorld, "character is not currently in the world")
        }
        CommandRejection::InvalidLifecycleState { expected } => ApiError::new(
            ApiErrorCode::InvalidLifecycleState,
            format!("invalid lifecycle state; expected {expected}"),
        ),
        CommandRejection::Busy { active } => {
            ApiError::new(ApiErrorCode::Busy, format!("character is busy ({active:?})"))
        }
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

fn spatial_anchor_and_cell(landblock_id: Guid) -> (Guid, Option<Guid>) {
    let anchor = Guid((landblock_id.0 & 0xffff_0000) | 0xffff);
    let cell = ((landblock_id.0 & 0xffff) >= 0x0100).then_some(landblock_id);
    (anchor, cell)
}

fn to_json<T: serde::Serialize>(value: T) -> ApiResult<Value> {
    serde_json::to_value(value).map_err(|e| ApiError::new(ApiErrorCode::Internal, e.to_string()))
}

fn lifecycle_label(state: &ClientLifecycleState) -> &'static str {
    match state {
        ClientLifecycleState::Connecting => "connecting",
        ClientLifecycleState::Authenticating => "authenticating",
        ClientLifecycleState::CharacterSelection { .. } => "character-selection",
        ClientLifecycleState::EnteringWorld { .. } => "entering-world",
        ClientLifecycleState::PortalSpace { .. } => "portal-space",
        ClientLifecycleState::InWorld => "in-world",
        ClientLifecycleState::LoggingOut => "logging-out",
        ClientLifecycleState::Exiting { .. } => "exiting",
    }
}

fn format_combat_mode(mode: CombatMode) -> &'static str {
    match mode {
        CombatMode::NonCombat => "peace",
        CombatMode::Melee => "melee",
        CombatMode::Missile => "missile",
        CombatMode::Magic => "magic",
        CombatMode::Undef => "undef",
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
        || entity.creature_profile.as_ref().is_some_and(|p| p.health == 0);
    let stack_count = facts.and_then(|f| match &f.description {
        EntityDescription::Known { stack_count, .. } => *stack_count,
        EntityDescription::Pending => None,
    });
    let (container, wielder) = match facts.map(|f| f.location) {
        Some(EntityStorageLocation::Contained { parent_guid, .. }) => (Some(parent_guid), None),
        Some(EntityStorageLocation::Equipped { wearer_guid, .. }) => (None, Some(wearer_guid)),
        _ => (None, None),
    };
    let distance_to_self = (container.is_none()
        && wielder.is_none()
        && !entity.position.landblock_id.is_null())
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
    SpellDefinitionView {
        id,
        name: info.name.clone(),
        description: info.description.clone(),
        school: format!("{:?}", info.school),
        icon_id: info.icon_id,
        category: info.category,
        bitfield: info.bitfield,
        base_mana: info.base_mana,
        base_range_constant: info.base_range_constant,
        base_range_mod: info.base_range_mod,
        power: info.power,
        components: info.components.iter().copied().filter(|&c| c != 0).collect(),
        duration,
    }
}

fn default_equipment_storage_policy(world: &holtburger_world::WorldState) -> EquipmentStoragePolicy {
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

fn project_allegiance(snapshot: &holtburger_core::client::allegiance::AllegianceSnapshot) -> Value {
    let profile = snapshot.profile.as_ref().map(|p| {
        let roles = snapshot
            .player_guid
            .map(|player| p.relationships(player));
        json!({
            "name": p.name,
            "rank": p.rank,
            "totalMembers": p.total_members,
            "totalDescendants": p.total_descendants,
            "monarch": roles.as_ref().and_then(|r| r.monarch).map(AllegianceMember::from),
            "patron": roles.as_ref().and_then(|r| r.patron).map(AllegianceMember::from),
            "self": roles.as_ref().and_then(|r| r.self_member).map(AllegianceMember::from),
            "directVassals": roles
                .as_ref()
                .map(|r| r.direct_vassals.iter().copied().map(AllegianceMember::from).collect::<Vec<_>>())
                .unwrap_or_default(),
        })
    });
    json!({
        "playerGuid": snapshot.player_guid,
        "refreshing": snapshot.refreshing,
        "canSwear": snapshot.can_swear,
        "profile": profile,
    })
}

fn project_squelch(squelch: &holtburger_world::state::squelch::SquelchState) -> Value {
    let characters: Vec<_> = squelch
        .characters
        .iter()
        .map(|(&guid, rec)| {
            let mgmt = rec.management();
            json!({
                "guid": guid,
                "name": rec.name,
                "account": rec.account,
                "coverage": mgmt.coverage,
                "removalScope": mgmt.removal_scope,
            })
        })
        .collect();
    json!({
        "accounts": squelch.accounts,
        "characters": characters,
        "globals": {
            "name": squelch.globals.name,
            "coverage": squelch.globals.filter.coverage(),
        },
    })
}

fn project_salvage_evaluation(eval: &SalvageEvaluation) -> Value {
    match eval {
        SalvageEvaluation::Ready { review, bags } => json!({
            "kind": "ready",
            "tool": review.tool.guid,
            "bags": bags,
        }),
        SalvageEvaluation::PendingDetails { tool, items } => json!({
            "kind": "pending-details",
            "tool": tool.guid,
            "items": items,
        }),
        SalvageEvaluation::Rejected { reason } => json!({
            "kind": "rejected",
            "reason": reason,
        }),
    }
}
