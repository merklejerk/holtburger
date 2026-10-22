//! Asynchronous content preparation for core-owned dynamic object-state scripts.

use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use anyhow::{Context, Result, anyhow};
use holtburger_common::Guid;
use holtburger_common::properties::WorldObjectExt as _;
use holtburger_dat::file_type::{PhysicsScript, PhysicsScriptTable, SetupModel};
use tokio::sync::mpsc::{self, UnboundedReceiver, UnboundedSender};

use crate::{
    ContentAsset, ContentAssetRequest, ContentAssetService, DynamicScriptActivation,
    DynamicScriptCommand, DynamicScriptController, DynamicScriptTarget,
    PreparedDynamicScriptTimeline, prepare_dynamic_script_timeline,
};

/// Immutable entity facts captured before script preparation leaves the runtime thread.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ClientDynamicScriptFacts {
    pub target: DynamicScriptTarget,
    pub setup_did: u32,
    /// Entity override; setup default is resolved by the source when absent.
    pub physics_script_table_did: Option<u32>,
}

/// Generation defaults prepared without starting a simulation timeline.
#[derive(Debug, Clone)]
pub struct PreparedClientDynamicScript {
    pub target: DynamicScriptTarget,
    /// Effective table retained for later live cue resolution.
    pub physics_script_table_did: Option<u32>,
    /// Non-empty setup-direct timelines activated with the entity generation.
    pub timelines: Vec<Arc<PreparedDynamicScriptTimeline>>,
}

/// Synchronous content seam run outside the fixed simulation turn.
pub trait ClientDynamicScriptSource: Send + Sync + 'static {
    fn prepare_generation(
        &self,
        facts: ClientDynamicScriptFacts,
    ) -> Result<PreparedClientDynamicScript>;

    fn prepare_cue(
        &self,
        table_did: u32,
        cue: u32,
        intensity: f32,
    ) -> Result<Option<Arc<PreparedDynamicScriptTimeline>>>;
}

/// Content-service implementation with immutable decoded script/table reuse.
pub struct ContentClientDynamicScriptSource {
    service: Arc<ContentAssetService>,
    scripts: Mutex<BTreeMap<u32, Arc<PhysicsScript>>>,
    tables: Mutex<BTreeMap<u32, Arc<PhysicsScriptTable>>>,
}

impl ContentClientDynamicScriptSource {
    pub fn new(service: Arc<ContentAssetService>) -> Self {
        Self {
            service,
            scripts: Mutex::new(BTreeMap::new()),
            tables: Mutex::new(BTreeMap::new()),
        }
    }

    fn setup(&self, setup_did: u32) -> Result<Arc<SetupModel>> {
        match self
            .service
            .load(ContentAssetRequest::SetupModel(setup_did))?
        {
            ContentAsset::SetupModel(setup) => Ok(setup),
            other => Err(anyhow!(
                "SetupModel request 0x{setup_did:08X} returned {other:?}"
            )),
        }
    }

    fn table(&self, table_did: u32) -> Result<Arc<PhysicsScriptTable>> {
        if let Some(table) = self
            .tables
            .lock()
            .expect("dynamic script table cache lock should not be poisoned")
            .get(&table_did)
            .cloned()
        {
            return Ok(table);
        }
        let loaded = match self
            .service
            .load(ContentAssetRequest::PhysicsScriptTable(table_did))?
        {
            ContentAsset::PhysicsScriptTable(table) => Arc::new(*table),
            other => {
                return Err(anyhow!(
                    "PhysicsScriptTable request 0x{table_did:08X} returned {other:?}"
                ));
            }
        };
        let mut tables = self
            .tables
            .lock()
            .expect("dynamic script table cache lock should not be poisoned");
        Ok(Arc::clone(tables.entry(table_did).or_insert(loaded)))
    }

    fn script(&self, script_did: u32) -> Result<Arc<PhysicsScript>> {
        if let Some(script) = self
            .scripts
            .lock()
            .expect("dynamic script cache lock should not be poisoned")
            .get(&script_did)
            .cloned()
        {
            return Ok(script);
        }
        let loaded = match self
            .service
            .load(ContentAssetRequest::PhysicsScript(script_did))?
        {
            ContentAsset::PhysicsScript(script) => Arc::new(*script),
            other => {
                return Err(anyhow!(
                    "PhysicsScript request 0x{script_did:08X} returned {other:?}"
                ));
            }
        };
        let mut scripts = self
            .scripts
            .lock()
            .expect("dynamic script cache lock should not be poisoned");
        Ok(Arc::clone(scripts.entry(script_did).or_insert(loaded)))
    }

    /// Extracts direct object-state commands from the activated root.
    fn timeline(&self, root_script_did: u32) -> Result<Arc<PreparedDynamicScriptTimeline>> {
        let script = self.script(root_script_did).with_context(|| {
            format!("could not prepare dynamic script root 0x{root_script_did:08X}")
        })?;
        Ok(Arc::new(prepare_dynamic_script_timeline(&script)?))
    }
}

impl ClientDynamicScriptSource for ContentClientDynamicScriptSource {
    fn prepare_generation(
        &self,
        facts: ClientDynamicScriptFacts,
    ) -> Result<PreparedClientDynamicScript> {
        let setup = self.setup(facts.setup_did)?;
        let table_did = facts
            .physics_script_table_did
            .or(setup.default_script_table);
        let mut timelines = Vec::new();
        if let Some(root_script_did) = setup.default_script_did {
            let timeline = self.timeline(root_script_did)?;
            if !timeline.is_empty() {
                timelines.push(timeline);
            }
        }
        Ok(PreparedClientDynamicScript {
            target: facts.target,
            physics_script_table_did: table_did,
            timelines,
        })
    }

    fn prepare_cue(
        &self,
        table_did: u32,
        cue: u32,
        intensity: f32,
    ) -> Result<Option<Arc<PreparedDynamicScriptTimeline>>> {
        if !intensity.is_finite() {
            return Err(anyhow!("PhysicsScript cue intensity is not finite"));
        }
        let Some(script_did) = self.table(table_did)?.select(cue, intensity) else {
            return Ok(None);
        };
        let timeline = self.timeline(script_did)?;
        Ok((!timeline.is_empty()).then_some(timeline))
    }
}

/// Extracts script preparation facts from one current authoritative entity.
fn client_dynamic_script_facts(
    world: &holtburger_world::WorldState,
    guid: Guid,
) -> Result<ClientDynamicScriptFacts> {
    let entity = world
        .entities
        .get(guid)
        .ok_or_else(|| anyhow!("dynamic script entity 0x{guid:08X} is not registered"))?;
    let setup_did = entity
        .csetup_id()
        .map(|did| did.0)
        .ok_or_else(|| anyhow!("dynamic script entity 0x{guid:08X} has no setup DID"))?;
    Ok(ClientDynamicScriptFacts {
        target: DynamicScriptTarget {
            guid,
            instance_sequence: entity.instance_sequence(),
        },
        setup_did,
        physics_script_table_did: entity.petable_id().map(|did| did.0),
    })
}

#[derive(Debug)]
struct GenerationCompletion {
    facts: ClientDynamicScriptFacts,
    /// Authority epoch at the request boundary, before the content worker runs.
    physics_revision: u64,
    result: std::result::Result<PreparedClientDynamicScript, String>,
}

#[derive(Debug)]
struct CueCompletion {
    activation: DynamicScriptActivation,
    result: std::result::Result<Option<Arc<PreparedDynamicScriptTimeline>>, String>,
}

#[derive(Debug)]
enum PreparationCompletion {
    Generation(GenerationCompletion),
    Cue(CueCompletion),
}

#[derive(Debug, Clone, Copy)]
struct QueuedCue {
    cue: u32,
    intensity: f32,
    /// Retained across both the table-readiness queue and asynchronous root preparation.
    physics_revision: u64,
}

struct GenerationDemand {
    facts: ClientDynamicScriptFacts,
    effective_table_did: Option<u32>,
    queued_cues: VecDeque<QueuedCue>,
    worker: Option<tokio::task::JoinHandle<()>>,
}

struct CueWorker {
    target: DynamicScriptTarget,
    task: tokio::task::JoinHandle<()>,
}

/// Joins off-turn script preparation back to exact authoritative entity instances.
pub(super) struct ClientDynamicScriptCoordinator {
    source: Arc<dyn ClientDynamicScriptSource>,
    completion_tx: UnboundedSender<PreparationCompletion>,
    completion_rx: UnboundedReceiver<PreparationCompletion>,
    demands: BTreeMap<Guid, GenerationDemand>,
    cue_workers: BTreeMap<Guid, CueWorker>,
    controller: DynamicScriptController,
    /// Sparse set of world ramps that need another authority-clock sample.
    active_ramps: BTreeSet<Guid>,
}

impl ClientDynamicScriptCoordinator {
    pub(super) fn new(source: Arc<dyn ClientDynamicScriptSource>) -> Self {
        let (completion_tx, completion_rx) = mpsc::unbounded_channel();
        Self {
            source,
            completion_tx,
            completion_rx,
            demands: BTreeMap::new(),
            cue_workers: BTreeMap::new(),
            controller: DynamicScriptController::default(),
            active_ramps: BTreeSet::new(),
        }
    }

    /// Starts preparation only when content-relevant facts or instance identity changed.
    pub fn observe_entity(
        &mut self,
        world: &holtburger_world::WorldState,
        guid: Guid,
    ) -> Result<()> {
        let facts = match client_dynamic_script_facts(world, guid) {
            Ok(facts) => facts,
            Err(error) => {
                self.retire_guid(guid);
                return Err(error);
            }
        };
        if self
            .demands
            .get(&guid)
            .is_some_and(|demand| demand.facts == facts)
        {
            return Ok(());
        }

        self.retire_guid(guid);
        self.controller.install_target(facts.target);
        let physics_revision = world
            .entities
            .get(guid)
            .expect("prepared script facts require an entity")
            .physics
            .authoritative_revision();
        let source = Arc::clone(&self.source);
        let completion_tx = self.completion_tx.clone();
        let worker = tokio::spawn(async move {
            let result = tokio::task::spawn_blocking(move || source.prepare_generation(facts))
                .await
                .map_err(|error| format!("dynamic script preparation task failed: {error}"))
                .and_then(|result| result.map_err(|error| error.to_string()));
            let _ = completion_tx.send(PreparationCompletion::Generation(GenerationCompletion {
                facts,
                physics_revision,
                result,
            }));
        });
        self.demands.insert(
            guid,
            GenerationDemand {
                facts,
                effective_table_did: None,
                queued_cues: VecDeque::new(),
                worker: Some(worker),
            },
        );
        Ok(())
    }

    /// Queues an entity cue until the exact instance's effective table is known.
    pub fn play_cue(
        &mut self,
        world: &holtburger_world::WorldState,
        guid: Guid,
        cue: u32,
        intensity: f32,
    ) -> Result<()> {
        self.observe_entity(world, guid)?;
        self.demands
            .get_mut(&guid)
            .expect("observed dynamic script demand disappeared")
            .queued_cues
            .push_back(QueuedCue {
                cue,
                intensity,
                physics_revision: world
                    .entities
                    .get(guid)
                    .expect("observed script target is registered")
                    .physics
                    .authoritative_revision(),
            });
        self.start_next_cue_preparation(guid);
        Ok(())
    }

    /// Removes only the named instance; stale world removals cannot retire a replacement.
    pub fn remove_entity(&mut self, target: DynamicScriptTarget) {
        if self
            .demands
            .get(&target.guid)
            .is_some_and(|demand| demand.facts.target == target)
        {
            self.retire_guid(target.guid);
        }
    }

    fn retire_guid(&mut self, guid: Guid) {
        let target = self.demands.remove(&guid).map(|mut demand| {
            demand.worker.take().inspect(|worker| worker.abort());
            demand.facts.target
        });
        self.cue_workers
            .remove(&guid)
            .inspect(|worker| worker.task.abort());
        if let Some(target) = target {
            self.controller.remove_target(target);
        }
        self.active_ramps.remove(&guid);
    }

    /// Installs completed immutable timelines only if authoritative facts are still exact.
    pub fn poll(
        &mut self,
        world: &holtburger_world::WorldState,
        now: Duration,
    ) -> Vec<std::result::Result<(), String>> {
        let mut outcomes = Vec::new();
        while let Ok(completion) = self.completion_rx.try_recv() {
            match completion {
                PreparationCompletion::Generation(completion) => {
                    let current = client_dynamic_script_facts(world, completion.facts.target.guid)
                        .ok()
                        .is_some_and(|facts| facts == completion.facts);
                    let exact_demand = self
                        .demands
                        .get(&completion.facts.target.guid)
                        .is_some_and(|demand| demand.facts == completion.facts);
                    if !current || !exact_demand {
                        continue;
                    }
                    let prepared = match completion.result {
                        Ok(prepared) => prepared,
                        Err(error) => {
                            self.retire_guid(completion.facts.target.guid);
                            outcomes.push(Err(error));
                            continue;
                        }
                    };
                    {
                        let demand = self
                            .demands
                            .get_mut(&prepared.target.guid)
                            .expect("validated dynamic script demand disappeared");
                        demand.worker = None;
                        demand.effective_table_did = prepared.physics_script_table_did;
                        if demand.effective_table_did.is_none() {
                            // The generation has definitively resolved no table; its queued high-level
                            // cues have no host-owned object-state work.
                            demand.queued_cues.clear();
                        }
                    }
                    for timeline in prepared.timelines {
                        outcomes.push(
                            self.controller
                                .activate(
                                    DynamicScriptActivation {
                                        target: prepared.target,
                                        physics_revision: completion.physics_revision,
                                    },
                                    timeline,
                                    now,
                                )
                                .map_err(|error| error.to_string()),
                        );
                    }
                    self.start_next_cue_preparation(prepared.target.guid);
                }
                PreparationCompletion::Cue(completion) => {
                    let exact_worker = self
                        .cue_workers
                        .get(&completion.activation.target.guid)
                        .is_some_and(|worker| worker.target == completion.activation.target);
                    if !exact_worker {
                        continue;
                    }
                    self.cue_workers.remove(&completion.activation.target.guid);
                    if !self.controller.holds(completion.activation.target) {
                        continue;
                    }
                    match completion.result {
                        Ok(Some(timeline)) => outcomes.push(
                            self.controller
                                .activate(completion.activation, timeline, now)
                                .map_err(|error| error.to_string()),
                        ),
                        Ok(None) => {}
                        Err(error) => outcomes.push(Err(error)),
                    }
                    self.start_next_cue_preparation(completion.activation.target.guid);
                }
            }
        }
        outcomes
    }

    /// Applies due commands and samples only the sparse set of still-active world ramps.
    pub fn advance_world_to(
        &mut self,
        world: &mut holtburger_world::WorldState,
        now: Duration,
    ) -> Result<BTreeSet<Guid>> {
        let mut changed = BTreeSet::new();
        // Retail stops UpdateScripts without a cell (acclient.c:311146), retaining absolute
        // hook times for catch-up on admission (316431). SetScale starts a ramp when the hook
        // executes, not at its overdue scheduled time (308862).
        for command in self
            .controller
            .advance_to(now, |target| world.is_entity_world_participant(target.guid))?
        {
            let guid = command.activation.target.guid;
            match command.command {
                DynamicScriptCommand::Scale(scale) => {
                    let update = world.apply_entity_script_scale(
                        guid,
                        scale.end,
                        scale.duration_seconds,
                        now.as_secs_f64(),
                    )?;
                    if update.effective_changed {
                        changed.insert(guid);
                    }
                    if update.ramp_active {
                        self.active_ramps.insert(guid);
                    } else {
                        self.active_ramps.remove(&guid);
                    }
                }
                DynamicScriptCommand::Presentation(change) => {
                    if world.apply_entity_script_presentation(
                        guid,
                        command.activation.physics_revision,
                        change,
                    )? {
                        changed.insert(guid);
                    }
                }
            }
        }
        let active = self.active_ramps.iter().copied().collect::<Vec<_>>();
        for guid in active {
            if !world.is_entity_world_participant(guid) {
                continue;
            }
            let update = world.advance_entity_script_scale(guid, now.as_secs_f64())?;
            if update.effective_changed {
                changed.insert(guid);
            }
            if !update.ramp_active {
                self.active_ramps.remove(&guid);
            }
        }
        Ok(changed)
    }

    fn start_next_cue_preparation(&mut self, guid: Guid) {
        if self.cue_workers.contains_key(&guid) {
            return;
        }
        let Some(demand) = self.demands.get_mut(&guid) else {
            return;
        };
        let Some(table_did) = demand.effective_table_did else {
            return;
        };
        let target = demand.facts.target;
        let Some(cue) = demand.queued_cues.pop_front() else {
            return;
        };
        let source = Arc::clone(&self.source);
        let completion_tx = self.completion_tx.clone();
        let worker = tokio::spawn(async move {
            let result = tokio::task::spawn_blocking(move || {
                source.prepare_cue(table_did, cue.cue, cue.intensity)
            })
            .await
            .map_err(|error| format!("dynamic script cue preparation task failed: {error}"))
            .and_then(|result| result.map_err(|error| error.to_string()));
            let _ = completion_tx.send(PreparationCompletion::Cue(CueCompletion {
                activation: DynamicScriptActivation {
                    target,
                    physics_revision: cue.physics_revision,
                },
                result,
            }));
        });
        self.cue_workers.insert(
            guid,
            CueWorker {
                target,
                task: worker,
            },
        );
    }
}

impl super::ClientRuntime {
    pub(super) fn dynamic_script_time(&self) -> Duration {
        self.dynamic_entity_time_origin.elapsed()
    }

    pub(super) fn observe_dynamic_script_entity(&mut self, guid: Guid) {
        if !self.world.is_entity_world_participant(guid) {
            return;
        }
        if let Some(Err(error)) = self
            .dynamic_script_coordinator
            .as_mut()
            .map(|coordinator| coordinator.observe_entity(&self.world, guid))
        {
            log::debug!("dynamic script unavailable for {guid}: {error:#}");
        }
    }

    pub(super) fn remove_dynamic_script_entity(&mut self, target: DynamicScriptTarget) {
        if let Some(coordinator) = self.dynamic_script_coordinator.as_mut() {
            coordinator.remove_entity(target);
        }
    }

    pub(super) fn play_dynamic_script_cue(
        &mut self,
        guid: Guid,
        cue: u32,
        intensity: f32,
    ) -> Result<()> {
        if let Some(coordinator) = self.dynamic_script_coordinator.as_mut() {
            coordinator.play_cue(&self.world, guid, cue, intensity)?;
        }
        Ok(())
    }

    /// Polls prepared roots, applies due object-state commands, then advances scale ramps before physics.
    pub(super) fn advance_dynamic_scripts(&mut self, now: Duration) -> Result<()> {
        let Some(coordinator) = self.dynamic_script_coordinator.as_mut() else {
            return Ok(());
        };
        for outcome in coordinator.poll(&self.world, now) {
            if let Err(error) = outcome {
                log::warn!("dynamic script preparation rejected: {error}");
            }
        }
        for guid in coordinator.advance_world_to(&mut self.world, now)? {
            self.emit_dynamic_entity_upsert(guid);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::position::WorldPosition;
    use holtburger_common::properties::{PhysicsState, PropertyDataId, PropertyUpdate};
    use holtburger_dat::file_type::PhysicsScriptRecord;
    use holtburger_dat::file_type::setup_model::{AnimationHook, AnimationHookPayload};
    use holtburger_protocol::messages::{GameMessage, SetStateData};
    use holtburger_protocol::traits::ProtocolPack;
    use holtburger_world::entity::Entity;
    use std::sync::Condvar;

    struct EmptySource;

    /// Synthetic collision root with the same two state commands as retail Flame Bolt.
    struct CollisionStateSource;

    impl ClientDynamicScriptSource for CollisionStateSource {
        fn prepare_generation(
            &self,
            facts: ClientDynamicScriptFacts,
        ) -> Result<PreparedClientDynamicScript> {
            EmptySource.prepare_generation(facts)
        }

        fn prepare_cue(
            &self,
            _table_did: u32,
            cue: u32,
            _intensity: f32,
        ) -> Result<Option<Arc<PreparedDynamicScriptTimeline>>> {
            assert_eq!(cue, 0x5a);
            let root = PhysicsScript {
                id: 0x3300_0001,
                records: [
                    (16, AnimationHookPayload::NoDraw(true)),
                    (25, AnimationHookPayload::SetLight(false)),
                ]
                .into_iter()
                .enumerate()
                .map(
                    |(authored_order, (hook_type, payload))| PhysicsScriptRecord {
                        start_time: 0.0,
                        authored_order,
                        hook: AnimationHook {
                            hook_type,
                            direction: -1,
                            payload,
                        },
                    },
                )
                .collect(),
            };
            Ok(Some(Arc::new(prepare_dynamic_script_timeline(&root)?)))
        }
    }

    #[tokio::test]
    async fn collision_script_updates_projected_flags_and_server_state_reconciles_them() {
        let guid = Guid(0x7000_0001);
        let mut client =
            crate::client::builder::build_test_client(crate::client::ClientState::InWorld);
        let pose = WorldPosition {
            landblock_id: Guid(0xda55_0001),
            ..WorldPosition::default()
        };
        let mut entity = Entity::new(guid, "Projectile".into(), pose);
        entity.wcid = Some(42);
        for (key, value) in [
            (PropertyDataId::Setup, 0x0200_0001),
            (PropertyDataId::PhysicsEffectTable, 0x3400_0001),
            (PropertyDataId::PhysicsScript, 0x5a),
        ] {
            entity.set_property(PropertyUpdate::DataId(key, Guid(value)));
        }
        let flags = PhysicsState::SCRIPTED_COLLISION
            | PhysicsState::REPORT_COLLISIONS
            | PhysicsState::LIGHTING_ON;
        entity
            .physics
            .reconcile(holtburger_world::resolve_effective_entity_physics_state(
                flags,
            ));
        client.world.add_entity(entity);
        client.dynamic_script_coordinator = Some(ClientDynamicScriptCoordinator::new(Arc::new(
            CollisionStateSource,
        )));
        let report = holtburger_world::CollisionReportOutcome {
            contact: holtburger_world::CollisionReportContact {
                recipient: holtburger_world::SpatialBodyId::Entity(guid),
                source: holtburger_world::CollisionReportSource::StaticEnvironment,
            },
            phase: holtburger_world::CollisionReportPhase::Started,
        };
        let mut events = client.subscribe_client_view_events();
        for cue in
            super::super::entity_cues::collision_script_cues(&client.world, &[report]).unwrap()
        {
            client.dispatch_script_cue(cue).unwrap();
        }
        tokio::time::timeout(Duration::from_secs(1), async {
            loop {
                client
                    .advance_dynamic_scripts(Duration::from_secs(1))
                    .unwrap();
                if client
                    .world
                    .entities
                    .get(guid)
                    .unwrap()
                    .physics
                    .effective()
                    .presentation
                    .no_draw
                {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("collision state preparation should complete");
        let mut published = false;
        while let Ok(event) = events.try_recv() {
            if let crate::ClientViewEvent::DynamicEntity(crate::DynamicEntityEvent::Upserted {
                entity,
            }) = event
            {
                assert!(entity.physics.no_draw);
                assert!(!entity.physics.lighting);
                published = true;
            }
        }
        assert!(published, "state hooks must reach the entity-view consumer");
        let mut packet = Vec::new();
        GameMessage::SetState(Box::new(SetStateData {
            guid,
            physics_state: flags,
            instance_sequence: 0,
            state_sequence: 1,
        }))
        .pack(&mut packet);
        client.handle_message(&packet).await.unwrap();
        let reconciled = client.world.entities.get(guid).unwrap().physics.effective();
        assert!(!reconciled.presentation.no_draw);
        assert!(reconciled.presentation.lighting);

        // A complete server update can overtake asset readiness, including an update whose
        // values equal the previous authority. The queued local prediction must remain obsolete.
        for cue in
            super::super::entity_cues::collision_script_cues(&client.world, &[report]).unwrap()
        {
            client.dispatch_script_cue(cue).unwrap();
        }
        let mut packet = Vec::new();
        GameMessage::SetState(Box::new(SetStateData {
            guid,
            physics_state: flags,
            instance_sequence: 0,
            state_sequence: 2,
        }))
        .pack(&mut packet);
        client.handle_message(&packet).await.unwrap();
        tokio::time::timeout(Duration::from_secs(1), async {
            loop {
                client
                    .advance_dynamic_scripts(Duration::from_secs(2))
                    .unwrap();
                if client
                    .dynamic_script_coordinator
                    .as_ref()
                    .unwrap()
                    .cue_workers
                    .is_empty()
                {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("overtaken collision root should finish preparation");
        let reconciled = client.world.entities.get(guid).unwrap().physics.effective();
        assert!(
            !reconciled.presentation.no_draw,
            "late preparation must not reverse server reconciliation"
        );
        assert!(reconciled.presentation.lighting);
    }

    #[test]
    fn withdrawn_scale_waits_then_catches_up_without_backdating_new_ramps() {
        let guid = Guid(1);
        let mut world = holtburger_world::WorldState::synthetic();
        world.add_entity(Entity::new(
            guid,
            "scripted".into(),
            WorldPosition {
                landblock_id: Guid(0xda55_0001),
                ..WorldPosition::default()
            },
        ));
        let target = DynamicScriptTarget {
            guid,
            instance_sequence: world.entities.get(guid).unwrap().instance_sequence(),
        };
        let mut coordinator = ClientDynamicScriptCoordinator::new(Arc::new(EmptySource));
        coordinator.controller.install_target(target);
        let records = [(0, 3.0, 4.0), (5, 7.0, 2.0)]
            .into_iter()
            .enumerate()
            .map(
                |(order, (seconds, end, duration_seconds))| crate::PreparedScriptRecord {
                    start_time: Duration::from_secs(seconds),
                    authored_order: order,
                    command: DynamicScriptCommand::Scale(
                        holtburger_dat::file_type::setup_model::ScaleHookPayload {
                            end,
                            duration_seconds,
                        },
                    ),
                },
            )
            .collect();
        coordinator
            .controller
            .activate(
                DynamicScriptActivation {
                    target,
                    physics_revision: world
                        .entities
                        .get(guid)
                        .unwrap()
                        .physics
                        .authoritative_revision(),
                },
                Arc::new(PreparedDynamicScriptTimeline::new(records)),
                Duration::ZERO,
            )
            .unwrap();
        coordinator
            .advance_world_to(&mut world, Duration::ZERO)
            .unwrap();
        world.entities.get_mut(guid).unwrap().set_attachment(None);
        assert!(
            coordinator
                .advance_world_to(&mut world, Duration::from_secs(10))
                .unwrap()
                .is_empty()
        );
        assert_eq!(world.entities.get(guid).unwrap().scale.effective(), 1.0);

        world.entities.get_mut(guid).unwrap().placement_intent =
            holtburger_world::EntityPlacementIntent::Independent;
        coordinator
            .advance_world_to(&mut world, Duration::from_secs(10))
            .unwrap();
        assert_eq!(world.entities.get(guid).unwrap().scale.effective(), 3.0);
        coordinator
            .advance_world_to(&mut world, Duration::from_secs(11))
            .unwrap();
        assert_eq!(world.entities.get(guid).unwrap().scale.effective(), 5.0);
        coordinator
            .advance_world_to(&mut world, Duration::from_secs(12))
            .unwrap();
        assert_eq!(world.entities.get(guid).unwrap().scale.effective(), 7.0);
    }

    impl ClientDynamicScriptSource for EmptySource {
        fn prepare_generation(
            &self,
            facts: ClientDynamicScriptFacts,
        ) -> Result<PreparedClientDynamicScript> {
            Ok(PreparedClientDynamicScript {
                target: facts.target,
                physics_script_table_did: facts.physics_script_table_did,
                timelines: Vec::new(),
            })
        }

        fn prepare_cue(
            &self,
            _table_did: u32,
            _cue: u32,
            _intensity: f32,
        ) -> Result<Option<Arc<PreparedDynamicScriptTimeline>>> {
            Ok(None)
        }
    }

    struct ImmediateScaleSource;

    impl ClientDynamicScriptSource for ImmediateScaleSource {
        fn prepare_generation(
            &self,
            facts: ClientDynamicScriptFacts,
        ) -> Result<PreparedClientDynamicScript> {
            Ok(PreparedClientDynamicScript {
                target: facts.target,
                physics_script_table_did: facts.physics_script_table_did,
                timelines: vec![Arc::new(PreparedDynamicScriptTimeline::new(vec![
                    crate::PreparedScriptRecord {
                        start_time: Duration::ZERO,
                        authored_order: 0,
                        command: DynamicScriptCommand::Scale(
                            holtburger_dat::file_type::setup_model::ScaleHookPayload {
                                end: 3.0,
                                duration_seconds: 0.0,
                            },
                        ),
                    },
                ]))],
            })
        }

        fn prepare_cue(
            &self,
            _table_did: u32,
            _cue: u32,
            _intensity: f32,
        ) -> Result<Option<Arc<PreparedDynamicScriptTimeline>>> {
            Ok(None)
        }
    }

    struct OrderedCueSource {
        calls: Arc<Mutex<Vec<u32>>>,
        first_release: Arc<(Mutex<bool>, Condvar)>,
    }

    impl ClientDynamicScriptSource for OrderedCueSource {
        fn prepare_generation(
            &self,
            facts: ClientDynamicScriptFacts,
        ) -> Result<PreparedClientDynamicScript> {
            Ok(PreparedClientDynamicScript {
                target: facts.target,
                physics_script_table_did: facts.physics_script_table_did,
                timelines: Vec::new(),
            })
        }

        fn prepare_cue(
            &self,
            _table_did: u32,
            cue: u32,
            _intensity: f32,
        ) -> Result<Option<Arc<PreparedDynamicScriptTimeline>>> {
            self.calls.lock().unwrap().push(cue);
            if cue == 7 {
                let (released, wake) = &*self.first_release;
                let mut released = released.lock().unwrap();
                while !*released {
                    released = wake.wait(released).unwrap();
                }
            }
            Ok(None)
        }
    }

    #[tokio::test]
    async fn coordinator_establishes_target_before_async_timelines_arrive() {
        let guid = Guid(0x7000_0001);
        let mut world = holtburger_world::WorldState::synthetic();
        let mut entity = Entity::new(
            guid,
            "scripted".to_owned(),
            WorldPosition {
                landblock_id: Guid(0xda55_0001),
                coords: holtburger_common::Vector3::new(12.0, 24.0, 3.0),
                rotation: holtburger_common::Quaternion::identity(),
            },
        );
        entity.set_property(PropertyUpdate::DataId(
            PropertyDataId::Setup,
            Guid(0x0200_0001),
        ));
        world.entities.insert(entity);
        let mut coordinator = ClientDynamicScriptCoordinator::new(Arc::new(EmptySource));

        coordinator.observe_entity(&world, guid).unwrap();
        assert!(coordinator.controller.holds(DynamicScriptTarget {
            guid,
            instance_sequence: 0,
        }));

        tokio::task::yield_now().await;
        assert!(
            coordinator
                .poll(&world, Duration::from_secs(3))
                .iter()
                .all(Result::is_ok)
        );
    }

    #[tokio::test]
    async fn coordinator_prepares_entity_cues_in_request_order() {
        let guid = Guid(0x7000_0001);
        let mut world = holtburger_world::WorldState::synthetic();
        let mut entity = Entity::new(guid, "scripted".to_owned(), WorldPosition::default());
        entity.set_property(PropertyUpdate::DataId(
            PropertyDataId::Setup,
            Guid(0x0200_0001),
        ));
        entity.set_property(PropertyUpdate::DataId(
            PropertyDataId::PhysicsEffectTable,
            Guid(0x3400_0001),
        ));
        world.entities.insert(entity);
        let calls = Arc::new(Mutex::new(Vec::new()));
        let first_release = Arc::new((Mutex::new(false), Condvar::new()));
        let mut coordinator = ClientDynamicScriptCoordinator::new(Arc::new(OrderedCueSource {
            calls: Arc::clone(&calls),
            first_release: Arc::clone(&first_release),
        }));
        coordinator.observe_entity(&world, guid).unwrap();
        tokio::time::timeout(Duration::from_secs(1), async {
            loop {
                coordinator.poll(&world, Duration::ZERO);
                if coordinator
                    .demands
                    .values()
                    .all(|demand| demand.worker.is_none())
                {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();

        coordinator.play_cue(&world, guid, 7, 0.5).unwrap();
        coordinator.play_cue(&world, guid, 8, 0.5).unwrap();
        tokio::time::timeout(Duration::from_secs(1), async {
            while calls.lock().unwrap().as_slice() != [7] {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        assert_eq!(coordinator.demands[&guid].queued_cues.len(), 1);

        let (released, wake) = &*first_release;
        *released.lock().unwrap() = true;
        wake.notify_one();
        tokio::time::timeout(Duration::from_secs(1), async {
            loop {
                coordinator.poll(&world, Duration::ZERO);
                if calls.lock().unwrap().as_slice() == [7, 8] {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn runtime_publishes_an_immediate_scale_that_precedes_tick_diff_capture() {
        let guid = Guid(0x7000_0001);
        let mut client =
            crate::client::builder::build_test_client(crate::client::ClientState::InWorld);
        let mut entity = Entity::new(
            guid,
            "scripted".to_owned(),
            WorldPosition {
                landblock_id: Guid(0xda55_0001),
                coords: holtburger_common::Vector3::new(12.0, 24.0, 3.0),
                rotation: holtburger_common::Quaternion::identity(),
            },
        );
        entity.wcid = Some(42);
        entity.set_property(PropertyUpdate::DataId(
            PropertyDataId::Setup,
            Guid(0x0200_0001),
        ));
        client.world.add_entity(entity);
        crate::client::dynamic_entity_view::project_client_dynamic_entity(&client.world, guid)
            .unwrap();
        client.dynamic_script_coordinator = Some(ClientDynamicScriptCoordinator::new(Arc::new(
            ImmediateScaleSource,
        )));
        let mut events = client.client_view_event_tx.subscribe();

        client.observe_dynamic_script_entity(guid);
        tokio::time::timeout(Duration::from_secs(1), async {
            loop {
                client
                    .advance_dynamic_scripts(Duration::from_secs(1))
                    .unwrap();
                if client.world.entities.get(guid).unwrap().scale.effective() == 3.0 {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("script preparation should complete");

        assert_eq!(
            client.world.entities.get(guid).unwrap().scale.effective(),
            3.0
        );
        let event = events.try_recv().unwrap();
        let crate::client::ClientViewEvent::DynamicEntity(crate::DynamicEntityEvent::Upserted {
            entity,
        }) = event
        else {
            panic!("immediate scale must publish a dynamic-entity upsert");
        };
        assert_eq!(entity.presentation.object_scale, 3.0);
    }
}
