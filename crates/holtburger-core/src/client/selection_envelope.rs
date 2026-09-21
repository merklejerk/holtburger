//! Asynchronous preparation and reuse of conservative animated selection envelopes.

use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;

use anyhow::{Result, anyhow};
use holtburger_common::Guid;
use holtburger_content::{
    SelectionEnvelopeProfile, compute_selection_envelope_radius, resolve_selection_envelope_profile,
};
use holtburger_dat::file_type::{Animation, GfxObj, MotionTable, SetupModel};
use holtburger_world::{SelectionEnvelope, SelectionGeometry};
use tokio::sync::mpsc::{self, UnboundedReceiver, UnboundedSender};

use crate::{ContentAsset, ContentAssetRequest, ContentAssetService};

/// Final geometry identity for a reusable unit-scale selection envelope.
pub type ClientSelectionEnvelopeProfile = SelectionEnvelopeProfile;

/// Synchronous content seam run only on blocking workers.
pub trait ClientSelectionEnvelopeSource: Send + Sync + 'static {
    fn resolve_profile(
        &self,
        geometry: &SelectionGeometry,
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
        geometry: &SelectionGeometry,
    ) -> Result<ClientSelectionEnvelopeProfile> {
        let setup = self.setup(geometry.setup_did)?;
        Ok(resolve_selection_envelope_profile(
            &setup,
            geometry
                .part_changes
                .iter()
                .map(|change| (change.part_index, change.gfx_obj_did)),
            geometry.motion_table_did,
        ))
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

#[derive(Debug)]
enum Completion {
    Profile {
        geometry: SelectionGeometry,
        result: std::result::Result<ClientSelectionEnvelopeProfile, String>,
    },
    Envelope {
        profile: ClientSelectionEnvelopeProfile,
        result: std::result::Result<SelectionEnvelope, String>,
    },
}

/// Resolution is shared by all entities with the same content inputs.
enum ProfileResolution {
    Preparing,
    Resolved(ClientSelectionEnvelopeProfile),
    Unavailable,
}

/// The sole owner of prepared bounds for a resolved content profile.
enum CachedEnvelope {
    Preparing,
    Ready(SelectionEnvelope),
    Unavailable,
}

/// Resolves geometry inputs once and shares envelopes by final content profile.
/// Async work never targets an entity, so replacement and removal cannot invalidate its result.
pub(super) struct ClientSelectionEnvelopeCoordinator {
    source: Arc<dyn ClientSelectionEnvelopeSource>,
    completion_tx: UnboundedSender<Completion>,
    completion_rx: UnboundedReceiver<Completion>,
    profiles: HashMap<SelectionGeometry, ProfileResolution>,
    cache: BTreeMap<ClientSelectionEnvelopeProfile, CachedEnvelope>,
}

impl ClientSelectionEnvelopeCoordinator {
    pub(super) fn new(source: Arc<dyn ClientSelectionEnvelopeSource>) -> Self {
        let (completion_tx, completion_rx) = mpsc::unbounded_channel();
        Self {
            source,
            completion_tx,
            completion_rx,
            profiles: HashMap::new(),
            cache: BTreeMap::new(),
        }
    }

    /// Reads bounds for exactly these geometry inputs, scheduling preparation on first demand.
    /// Pending and failed preparation remain unavailable to the selection query.
    pub(super) fn request_envelope(
        &mut self,
        geometry: &SelectionGeometry,
    ) -> Option<SelectionEnvelope> {
        match self.profiles.get(geometry) {
            Some(ProfileResolution::Resolved(profile)) => match self
                .cache
                .get(profile)
                .expect("resolved selection profiles have an envelope preparation entry")
            {
                CachedEnvelope::Ready(envelope) => Some(*envelope),
                CachedEnvelope::Preparing | CachedEnvelope::Unavailable => None,
            },
            Some(ProfileResolution::Preparing | ProfileResolution::Unavailable) => None,
            None => {
                self.start_profile_resolution(geometry.clone());
                None
            }
        }
    }

    fn start_profile_resolution(&mut self, geometry: SelectionGeometry) {
        self.profiles
            .insert(geometry.clone(), ProfileResolution::Preparing);
        let source = Arc::clone(&self.source);
        let completion_tx = self.completion_tx.clone();
        tokio::spawn(async move {
            let worker_geometry = geometry.clone();
            let result =
                tokio::task::spawn_blocking(move || source.resolve_profile(&worker_geometry))
                    .await
                    .map_err(|error| format!("selection profile task failed: {error}"))
                    .and_then(|result| result.map_err(|error| format!("{error:#}")));
            let _ = completion_tx.send(Completion::Profile { geometry, result });
        });
    }

    pub(super) fn poll(&mut self) -> Vec<String> {
        let mut errors = Vec::new();
        while let Ok(completion) = self.completion_rx.try_recv() {
            match completion {
                Completion::Profile { geometry, result } => {
                    let state = match result {
                        Ok(profile) => {
                            if !self.cache.contains_key(&profile) {
                                self.start_envelope_preparation(profile.clone());
                            }
                            ProfileResolution::Resolved(profile)
                        }
                        Err(error) => {
                            errors.push(error);
                            ProfileResolution::Unavailable
                        }
                    };
                    self.profiles.insert(geometry, state);
                }
                Completion::Envelope { profile, result } => {
                    let state = match result {
                        Ok(envelope) => CachedEnvelope::Ready(envelope),
                        Err(error) => {
                            errors.push(error);
                            CachedEnvelope::Unavailable
                        }
                    };
                    self.cache.insert(profile, state);
                }
            }
        }
        errors
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
                    .and_then(|result| result.map_err(|error| format!("{error:#}")));
            let _ = completion_tx.send(Completion::Envelope { profile, result });
        });
    }
}

impl super::ClientRuntime {
    pub(super) fn observe_selection_envelope_entity(&mut self, guid: Guid) {
        if let Some(coordinator) = self.selection_envelope_coordinator.as_mut()
            && let Some(geometry) = self.world.selection_geometry(guid)
        {
            coordinator.request_envelope(&geometry);
        }
    }

    pub(super) fn poll_selection_envelopes(&mut self) {
        if let Some(coordinator) = self.selection_envelope_coordinator.as_mut() {
            for error in coordinator.poll() {
                log::warn!("selection envelope preparation rejected: {error}");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use holtburger_common::{
        position::WorldPosition,
        properties::{PropertyDataId, WorldObjectPropertyAccessorsMut as _},
    };
    use holtburger_protocol::messages::{GameMessage, ObjectDescriptionData};
    use holtburger_world::{EntityPartChange, WorldEvent, WorldState, entity::Entity};

    use super::*;

    const SETUP: Guid = Guid(0x0200_0001);
    const PART: u32 = 0x0100_0001;
    const RADIUS: f32 = 3.5;

    struct TestSource {
        preparations: Arc<AtomicUsize>,
    }

    impl ClientSelectionEnvelopeSource for TestSource {
        fn resolve_profile(
            &self,
            geometry: &SelectionGeometry,
        ) -> Result<ClientSelectionEnvelopeProfile> {
            let mut parts = vec![PART];
            for change in &geometry.part_changes {
                if let Some(part) = parts.get_mut(usize::from(change.part_index)) {
                    *part = change.gfx_obj_did;
                }
            }
            Ok(ClientSelectionEnvelopeProfile {
                setup_did: geometry.setup_did,
                effective_parts: parts,
                motion_table_did: geometry.motion_table_did,
            })
        }

        fn prepare_envelope(
            &self,
            _profile: &ClientSelectionEnvelopeProfile,
        ) -> Result<SelectionEnvelope> {
            self.preparations.fetch_add(1, Ordering::SeqCst);
            Ok(SelectionEnvelope::new(RADIUS)?)
        }
    }

    fn setup_entity(guid: Guid) -> Entity {
        let mut entity = Entity::new(guid, "candidate".to_owned(), WorldPosition::default());
        entity.set_did_prop(PropertyDataId::Setup, SETUP);
        entity
    }

    fn coordinator() -> (ClientSelectionEnvelopeCoordinator, Arc<AtomicUsize>) {
        let preparations = Arc::new(AtomicUsize::new(0));
        (
            ClientSelectionEnvelopeCoordinator::new(Arc::new(TestSource {
                preparations: Arc::clone(&preparations),
            })),
            preparations,
        )
    }

    async fn prepared(
        coordinator: &mut ClientSelectionEnvelopeCoordinator,
        geometry: &SelectionGeometry,
    ) -> SelectionEnvelope {
        tokio::time::timeout(std::time::Duration::from_secs(1), async {
            loop {
                assert!(coordinator.poll().is_empty());
                if let Some(envelope) = coordinator.request_envelope(geometry) {
                    break envelope;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("synthetic profile preparation should complete")
    }

    #[tokio::test]
    async fn prepared_geometry_survives_same_instance_create_and_guid_reuse() {
        let mut world = WorldState::synthetic();
        let guid = Guid(0x7000_0001);
        world.entities.insert(setup_entity(guid));
        let (mut coordinator, preparations) = coordinator();
        let geometry = world.selection_geometry(guid).unwrap();
        let envelope = prepared(&mut coordinator, &geometry).await;

        let mut description = ObjectDescriptionData::with_guid(guid);
        description.csetup_id = Some(SETUP.0);
        let events = world.handle_message(&GameMessage::ObjectCreate(Box::new(description)));
        assert!(
            events
                .iter()
                .any(|event| matches!(event, WorldEvent::EntityReplaced(_)))
        );
        // No coordinator observation or repair runs between replacement and lookup.
        assert_eq!(
            coordinator.request_envelope(&world.selection_geometry(guid).unwrap()),
            Some(envelope)
        );

        world.remove_entity(guid);
        let mut replacement = setup_entity(guid);
        replacement.sequences[8] = 1;
        world.entities.insert(replacement);
        assert_eq!(
            coordinator.request_envelope(&world.selection_geometry(guid).unwrap()),
            Some(envelope)
        );
        assert_eq!(preparations.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn equivalent_geometry_inputs_share_final_profile_preparation() {
        let mut world = WorldState::synthetic();
        let first = Guid(0x7000_0001);
        let second = Guid(0x7000_0002);
        world.entities.insert(setup_entity(first));
        let mut equivalent = setup_entity(second);
        equivalent.appearance.part_changes.push(EntityPartChange {
            part_index: 0,
            gfx_obj_did: PART,
        });
        world.entities.insert(equivalent);
        let first_geometry = world.selection_geometry(first).unwrap();
        let second_geometry = world.selection_geometry(second).unwrap();
        assert_ne!(first_geometry, second_geometry);
        let (mut coordinator, preparations) = coordinator();
        coordinator.request_envelope(&first_geometry);
        coordinator.request_envelope(&second_geometry);
        assert_eq!(
            prepared(&mut coordinator, &first_geometry).await.radius(),
            RADIUS
        );
        assert_eq!(
            prepared(&mut coordinator, &second_geometry).await.radius(),
            RADIUS
        );
        assert_eq!(preparations.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn late_completions_cannot_supply_bounds_for_changed_geometry() {
        let mut world = WorldState::synthetic();
        let guid = Guid(0x7000_0001);
        world.entities.insert(setup_entity(guid));
        let (mut coordinator, preparations) = coordinator();
        let original = world.selection_geometry(guid).unwrap();
        assert_eq!(coordinator.request_envelope(&original), None);

        world
            .entities
            .get_mut(guid)
            .unwrap()
            .set_did_prop(PropertyDataId::Setup, Guid(0x0200_0002));
        let changed_setup = world.selection_geometry(guid).unwrap();
        // Deliver the old result only after the world's geometry has changed.
        prepared(&mut coordinator, &original).await;
        assert_eq!(coordinator.request_envelope(&changed_setup), None);

        world
            .entities
            .get_mut(guid)
            .unwrap()
            .set_did_prop(PropertyDataId::MotionTable, Guid(0x0900_0001));
        let changed_motion = world.selection_geometry(guid).unwrap();
        prepared(&mut coordinator, &changed_setup).await;
        assert_eq!(coordinator.request_envelope(&changed_motion), None);

        world
            .entities
            .get_mut(guid)
            .unwrap()
            .appearance
            .part_changes
            .push(EntityPartChange {
                part_index: 0,
                gfx_obj_did: 0x0100_0002,
            });
        let changed_parts = world.selection_geometry(guid).unwrap();
        prepared(&mut coordinator, &changed_motion).await;
        assert_eq!(coordinator.request_envelope(&changed_parts), None);
        assert_eq!(
            prepared(&mut coordinator, &changed_parts).await.radius(),
            RADIUS
        );
        assert_eq!(preparations.load(Ordering::SeqCst), 4);
    }
}
