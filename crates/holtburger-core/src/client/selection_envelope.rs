//! Asynchronous preparation and reuse of conservative animated selection envelopes.

use std::collections::BTreeMap;
use std::sync::Arc;

use anyhow::{Context, Result, anyhow};
use holtburger_common::Guid;
use holtburger_content::{
    SelectionEnvelopeProfile, compute_selection_envelope_radius, resolve_selection_envelope_profile,
};
use holtburger_dat::file_type::{Animation, GfxObj, MotionTable, SetupModel};
use holtburger_world::SelectionEnvelope;
use tokio::sync::mpsc::{self, UnboundedReceiver, UnboundedSender};

use crate::{ContentAsset, ContentAssetRequest, ContentAssetService, DynamicScaleTarget};

/// Final geometry identity for a reusable unit-scale selection envelope.
pub type ClientSelectionEnvelopeProfile = SelectionEnvelopeProfile;

/// Authoritative generation facts captured before content preparation leaves the world turn.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClientSelectionEnvelopeFacts {
    pub target: DynamicScaleTarget,
    pub setup_did: u32,
    /// Only geometry-changing appearance state participates in this product.
    pub part_changes: Vec<holtburger_world::EntityPartChange>,
    pub motion_table_did: Option<u32>,
}

/// Synchronous content seam run only on blocking workers.
pub trait ClientSelectionEnvelopeSource: Send + Sync + 'static {
    fn resolve_profile(
        &self,
        facts: &ClientSelectionEnvelopeFacts,
    ) -> Result<ClientSelectionEnvelopeProfile>;

    fn prepare_envelope(
        &self,
        profile: &ClientSelectionEnvelopeProfile,
    ) -> Result<SelectionEnvelope>;
}

/// Content-backed profile resolver and animation-closure calculator.
pub struct ContentClientSelectionEnvelopeSource {
    service: Arc<ContentAssetService>,
}

impl ContentClientSelectionEnvelopeSource {
    pub fn new(service: Arc<ContentAssetService>) -> Self {
        Self { service }
    }

    fn setup(&self, did: u32) -> Result<Arc<SetupModel>> {
        match self.service.load(ContentAssetRequest::SetupModel(did))? {
            ContentAsset::SetupModel(setup) => Ok(setup),
            other => Err(anyhow!("SetupModel request 0x{did:08X} returned {other:?}")),
        }
    }

    fn gfx_obj(&self, did: u32) -> Result<Arc<GfxObj>> {
        match self.service.load(ContentAssetRequest::GfxObj(did))? {
            ContentAsset::GfxObj(gfx) => Ok(gfx),
            other => Err(anyhow!("GfxObj request 0x{did:08X} returned {other:?}")),
        }
    }

    fn animation(&self, did: u32) -> Result<Arc<Animation>> {
        match self.service.load(ContentAssetRequest::Animation(did))? {
            ContentAsset::Animation(animation) => Ok(animation),
            other => Err(anyhow!("Animation request 0x{did:08X} returned {other:?}")),
        }
    }

    fn motion_table(&self, did: u32) -> Result<Arc<MotionTable>> {
        match self.service.load(ContentAssetRequest::MotionTable(did))? {
            ContentAsset::MotionTable(table) => Ok(table),
            other => Err(anyhow!(
                "MotionTable request 0x{did:08X} returned {other:?}"
            )),
        }
    }
}

impl ClientSelectionEnvelopeSource for ContentClientSelectionEnvelopeSource {
    fn resolve_profile(
        &self,
        facts: &ClientSelectionEnvelopeFacts,
    ) -> Result<ClientSelectionEnvelopeProfile> {
        let setup = self.setup(facts.setup_did)?;
        resolve_selection_envelope_profile(
            &setup,
            facts
                .part_changes
                .iter()
                .map(|change| (change.part_index, change.gfx_obj_did)),
            facts.motion_table_did,
        )
        .with_context(|| {
            format!(
                "could not resolve entity 0x{:08X} profile",
                facts.target.guid
            )
        })
    }

    fn prepare_envelope(
        &self,
        profile: &ClientSelectionEnvelopeProfile,
    ) -> Result<SelectionEnvelope> {
        let setup = self.setup(profile.setup_did)?;
        let motion_table = profile
            .motion_table_did
            .map(|did| self.motion_table(did))
            .transpose()?;
        let radius = compute_selection_envelope_radius(
            &setup,
            profile,
            motion_table.as_deref(),
            |did| self.animation(did),
            |did| self.gfx_obj(did),
        )?;
        SelectionEnvelope::new(radius).map_err(Into::into)
    }
}

/// Captures only facts that change the unit-scale geometry profile.
fn client_selection_envelope_facts(
    world: &holtburger_world::WorldState,
    guid: Guid,
) -> Result<ClientSelectionEnvelopeFacts> {
    use holtburger_common::properties::WorldObjectExt as _;

    let entity = world
        .entities
        .get(guid)
        .ok_or_else(|| anyhow!("selection-envelope entity 0x{guid:08X} is not registered"))?;
    let setup_did = entity
        .csetup_id()
        .map(u32::from)
        .ok_or_else(|| anyhow!("selection-envelope entity 0x{guid:08X} has no setup DID"))?;
    Ok(ClientSelectionEnvelopeFacts {
        target: DynamicScaleTarget {
            guid,
            instance_sequence: entity.instance_sequence(),
        },
        setup_did,
        part_changes: entity.appearance.part_changes.clone(),
        motion_table_did: world.effective_motion_table_id_for_guid(guid),
    })
}

#[derive(Debug)]
enum Completion {
    Profile {
        facts: ClientSelectionEnvelopeFacts,
        result: std::result::Result<ClientSelectionEnvelopeProfile, String>,
    },
    Envelope {
        profile: ClientSelectionEnvelopeProfile,
        result: std::result::Result<SelectionEnvelope, String>,
    },
}

struct Demand {
    facts: ClientSelectionEnvelopeFacts,
    profile: Option<ClientSelectionEnvelopeProfile>,
    worker: Option<tokio::task::JoinHandle<()>>,
}

enum CachedEnvelope {
    Preparing,
    Ready(SelectionEnvelope),
    Unavailable,
}

/// Owns off-turn profile resolution and persistent final-profile envelope reuse.
pub(super) struct ClientSelectionEnvelopeCoordinator {
    source: Arc<dyn ClientSelectionEnvelopeSource>,
    completion_tx: UnboundedSender<Completion>,
    completion_rx: UnboundedReceiver<Completion>,
    demands: BTreeMap<Guid, Demand>,
    cache: BTreeMap<ClientSelectionEnvelopeProfile, CachedEnvelope>,
}

impl ClientSelectionEnvelopeCoordinator {
    pub(super) fn new(source: Arc<dyn ClientSelectionEnvelopeSource>) -> Self {
        let (completion_tx, completion_rx) = mpsc::unbounded_channel();
        Self {
            source,
            completion_tx,
            completion_rx,
            demands: BTreeMap::new(),
            cache: BTreeMap::new(),
        }
    }

    pub fn observe_entity(
        &mut self,
        world: &mut holtburger_world::WorldState,
        guid: Guid,
    ) -> Result<()> {
        if world
            .entities
            .get(guid)
            .is_some_and(|entity| entity.attachment.is_some())
        {
            // Attached candidates inherit their world ancestor's reached scope and bypass host
            // sphere testing; only the browser owns their animated attachment transform.
            self.retire_demand(guid);
            world.clear_entity_selection_envelope(guid);
            return Ok(());
        }
        let facts = match client_selection_envelope_facts(world, guid) {
            Ok(facts) => facts,
            Err(error) => {
                self.retire_demand(guid);
                world.clear_entity_selection_envelope(guid);
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
        self.retire_demand(guid);
        world.clear_entity_selection_envelope(guid);
        let source = Arc::clone(&self.source);
        let completion_tx = self.completion_tx.clone();
        let worker_facts = facts.clone();
        let completion_facts = facts.clone();
        let worker = tokio::spawn(async move {
            let result = tokio::task::spawn_blocking(move || source.resolve_profile(&worker_facts))
                .await
                .map_err(|error| format!("selection profile task failed: {error}"))
                .and_then(|result| result.map_err(|error| error.to_string()));
            let _ = completion_tx.send(Completion::Profile {
                facts: completion_facts,
                result,
            });
        });
        self.demands.insert(
            guid,
            Demand {
                facts,
                profile: None,
                worker: Some(worker),
            },
        );
        Ok(())
    }

    pub fn remove_entity(&mut self, target: DynamicScaleTarget) {
        if self
            .demands
            .get(&target.guid)
            .is_some_and(|demand| demand.facts.target == target)
        {
            self.retire_demand(target.guid);
        }
    }

    fn retire_demand(&mut self, guid: Guid) {
        if let Some(demand) = self.demands.remove(&guid)
            && let Some(worker) = demand.worker
        {
            worker.abort();
        }
    }

    pub fn poll(&mut self, world: &mut holtburger_world::WorldState) -> Vec<String> {
        let mut errors = Vec::new();
        while let Ok(completion) = self.completion_rx.try_recv() {
            match completion {
                Completion::Profile { facts, result } => {
                    if !self.exact(world, &facts) {
                        continue;
                    }
                    self.demands
                        .get_mut(&facts.target.guid)
                        .expect("validated selection demand disappeared")
                        .worker = None;
                    let profile = match result {
                        Ok(profile) => profile,
                        Err(error) => {
                            errors.push(error);
                            continue;
                        }
                    };
                    let demand = self
                        .demands
                        .get_mut(&facts.target.guid)
                        .expect("validated selection demand disappeared");
                    demand.profile = Some(profile.clone());
                    match self.cache.get(&profile) {
                        Some(CachedEnvelope::Ready(envelope)) => {
                            world.install_entity_selection_envelope(
                                facts.target.guid,
                                facts.target.instance_sequence,
                                *envelope,
                            );
                        }
                        Some(CachedEnvelope::Unavailable | CachedEnvelope::Preparing) => {}
                        None => {
                            self.start_envelope_preparation(profile);
                        }
                    }
                }
                Completion::Envelope { profile, result } => {
                    let envelope = match result {
                        Ok(envelope) => {
                            self.cache
                                .insert(profile.clone(), CachedEnvelope::Ready(envelope));
                            Some(envelope)
                        }
                        Err(error) => {
                            self.cache
                                .insert(profile.clone(), CachedEnvelope::Unavailable);
                            errors.push(error);
                            None
                        }
                    };
                    if let Some(envelope) = envelope {
                        let targets = self
                            .demands
                            .values()
                            .filter(|demand| demand.profile.as_ref() == Some(&profile))
                            .map(|demand| demand.facts.target)
                            .collect::<Vec<_>>();
                        for target in targets {
                            world.install_entity_selection_envelope(
                                target.guid,
                                target.instance_sequence,
                                envelope,
                            );
                        }
                    }
                }
            }
        }
        errors
    }

    fn exact(
        &self,
        world: &holtburger_world::WorldState,
        facts: &ClientSelectionEnvelopeFacts,
    ) -> bool {
        self.demands
            .get(&facts.target.guid)
            .is_some_and(|demand| demand.facts == *facts)
            && client_selection_envelope_facts(world, facts.target.guid)
                .is_ok_and(|current| current == *facts)
    }

    fn start_envelope_preparation(&mut self, profile: ClientSelectionEnvelopeProfile) {
        self.cache
            .insert(profile.clone(), CachedEnvelope::Preparing);
        let source = Arc::clone(&self.source);
        let completion_tx = self.completion_tx.clone();
        tokio::spawn(async move {
            let worker_profile = profile.clone();
            let result =
                tokio::task::spawn_blocking(move || source.prepare_envelope(&worker_profile))
                    .await
                    .map_err(|error| format!("selection envelope task failed: {error}"))
                    .and_then(|result| result.map_err(|error| error.to_string()));
            let _ = completion_tx.send(Completion::Envelope { profile, result });
        });
    }
}

impl super::ClientRuntime {
    pub(super) fn observe_selection_envelope_entity(&mut self, guid: Guid) {
        let Some(mut coordinator) = self.selection_envelope_coordinator.take() else {
            return;
        };
        if let Err(error) = coordinator.observe_entity(&mut self.world, guid) {
            log::debug!("selection envelope unavailable for {guid}: {error:#}");
        }
        self.selection_envelope_coordinator = Some(coordinator);
    }

    pub(super) fn remove_selection_envelope_entity(&mut self, target: DynamicScaleTarget) {
        if let Some(coordinator) = self.selection_envelope_coordinator.as_mut() {
            coordinator.remove_entity(target);
        }
    }

    pub(super) fn poll_selection_envelopes(&mut self) {
        let Some(mut coordinator) = self.selection_envelope_coordinator.take() else {
            return;
        };
        for error in coordinator.poll(&mut self.world) {
            log::warn!("selection envelope preparation rejected: {error}");
        }
        self.selection_envelope_coordinator = Some(coordinator);
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use holtburger_common::position::WorldPosition;
    use holtburger_common::properties::{PropertyDataId, PropertyUpdate};
    use holtburger_common::{ParentLocation, Placement};
    use holtburger_world::entity::Entity;

    use super::*;

    struct SharedProfileSource {
        preparations: Arc<AtomicUsize>,
    }

    impl ClientSelectionEnvelopeSource for SharedProfileSource {
        fn resolve_profile(
            &self,
            facts: &ClientSelectionEnvelopeFacts,
        ) -> Result<ClientSelectionEnvelopeProfile> {
            Ok(ClientSelectionEnvelopeProfile {
                setup_did: facts.setup_did,
                effective_parts: vec![0x0100_0001],
                motion_table_did: facts.motion_table_did,
            })
        }

        fn prepare_envelope(
            &self,
            _profile: &ClientSelectionEnvelopeProfile,
        ) -> Result<SelectionEnvelope> {
            self.preparations.fetch_add(1, Ordering::SeqCst);
            Ok(SelectionEnvelope::new(3.5)?)
        }
    }

    fn setup_entity(guid: Guid) -> Entity {
        let mut entity = Entity::new(guid, "candidate".to_owned(), WorldPosition::default());
        entity.set_property(PropertyUpdate::DataId(
            PropertyDataId::Setup,
            Guid(0x0200_0001),
        ));
        entity
    }

    #[tokio::test]
    async fn coordinator_prepares_one_envelope_for_a_shared_resolved_profile() {
        let mut world = holtburger_world::WorldState::synthetic();
        let first = Guid(0x7000_0001);
        let second = Guid(0x7000_0002);
        world.entities.insert(setup_entity(first));
        world.entities.insert(setup_entity(second));
        let preparations = Arc::new(AtomicUsize::new(0));
        let mut coordinator =
            ClientSelectionEnvelopeCoordinator::new(Arc::new(SharedProfileSource {
                preparations: Arc::clone(&preparations),
            }));

        coordinator.observe_entity(&mut world, first).unwrap();
        coordinator.observe_entity(&mut world, second).unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(1), async {
            loop {
                assert!(coordinator.poll(&mut world).is_empty());
                let both_ready = [first, second].into_iter().all(|guid| {
                    world
                        .entities
                        .get(guid)
                        .and_then(|entity| entity.selection_envelope)
                        .is_some_and(|envelope| envelope.radius() == 3.5)
                });
                if both_ready {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("shared profile preparation should complete");

        assert_eq!(preparations.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn losing_profile_facts_retires_the_old_demand() {
        let guid = Guid(0x7000_0001);
        let mut world = holtburger_world::WorldState::synthetic();
        world.entities.insert(setup_entity(guid));
        let mut coordinator =
            ClientSelectionEnvelopeCoordinator::new(Arc::new(SharedProfileSource {
                preparations: Arc::new(AtomicUsize::new(0)),
            }));
        coordinator.observe_entity(&mut world, guid).unwrap();

        world
            .entities
            .get_mut(guid)
            .unwrap()
            .properties
            .dids
            .0
            .remove(&PropertyDataId::Setup);

        assert!(coordinator.observe_entity(&mut world, guid).is_err());
        assert!(coordinator.demands.is_empty());
    }

    #[test]
    fn coordinator_does_not_prepare_browser_placed_attachments() {
        let guid = Guid(0x7000_0001);
        let mut world = holtburger_world::WorldState::synthetic();
        let mut entity = setup_entity(guid);
        entity.attachment = Some(holtburger_world::PhysicsAttachment {
            parent: Guid(0x7000_0002),
            location: ParentLocation::RightHand,
            placement: Placement::RightHandCombat,
        });
        world.entities.insert(entity);
        let preparations = Arc::new(AtomicUsize::new(0));
        let mut coordinator =
            ClientSelectionEnvelopeCoordinator::new(Arc::new(SharedProfileSource {
                preparations: Arc::clone(&preparations),
            }));

        coordinator.observe_entity(&mut world, guid).unwrap();

        assert!(coordinator.demands.is_empty());
        assert_eq!(preparations.load(Ordering::SeqCst), 0);
        assert!(
            world
                .entities
                .get(guid)
                .unwrap()
                .selection_envelope
                .is_none()
        );
    }
}
