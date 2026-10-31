//! Shared barber interaction admission; editable drafts and visual overrides remain frontend-owned.

use super::{ClientRuntime, ClientState};
use crate::ClientViewEvent;
use anyhow::{Context, Result, ensure};
use holtburger_common::Guid;
use holtburger_common::properties::{PropertyInt, WorldObjectPropertyAccessors};
use holtburger_content::ContentRepository;
use holtburger_content::character_gen::barber::{
    AppearanceTexturePair, BarberAppearanceAssets, BarberAppearanceCatalog,
    BarberAppearanceChoices, BarberAppearanceRules, BarberParticleChange, ResolvedBarberAppearance,
};
use holtburger_dat::file_type::material::ObjDesc;
use holtburger_protocol::messages::{BarberAppearanceData, GameAction};
use holtburger_world::{EntityAppearance, WorldState};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::mpsc;

/// An interaction belongs to an exact character incarnation, not merely a reusable GUID.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BarberSubject {
    /// Active player identity.
    pub guid: Guid,
    /// Accepted server object instance stamp.
    pub instance: u16,
}

/// Cold editor state recovered through the same snapshot path as the opening notification.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum BarberPhase {
    /// Static content is loading outside the authority turn.
    Loading,
    /// Complete immutable opening choices and control data; the frontend retains its own draft.
    Editing {
        /// Highest observed draft revision; a recreated editor starts above it.
        revision: u32,
        /// Original choices used to initialize a new editor or recover after remount.
        original: BarberAppearanceChoices,
        /// Body-specific style capability and palette swatches.
        catalog: BarberAppearanceCatalog,
    },
    /// Submission is owned by core; duplicate Apply is no longer admissible.
    Sending,
    /// Opening could not be interpreted; never substitute a random/default body.
    Unavailable {
        /// Specific content or interpretation failure.
        message: String,
    },
}

/// One server-granted editing session, replaced atomically on a subsequent opening.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BarberInteraction {
    /// Process-local opening identity; never sent to ACE.
    pub id: u32,
    /// Character incarnation authorizing commands and preview installation.
    pub subject: BarberSubject,
    /// Explicit content/submission readiness.
    pub phase: BarberPhase,
}

/// Final local submission outcome; none of these claim that ACE accepted the appearance.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum BarberSubmissionOutcome {
    /// FinishBarber was sent once; normal server updates own the resulting appearance.
    Submitted,
    /// Validation/admission failed before any attempt to send.
    Rejected {
        /// Correctable local failure.
        message: String,
    },
    /// The transport failed after possible reliable enqueue. Never automatically retry.
    Uncertain {
        /// Transport failure and uncertainty explanation.
        message: String,
    },
}

/// Retained terminal feedback, correlated to the editor that initiated it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BarberSubmissionResult {
    /// Original opening identity.
    pub id: u32,
    /// Local send/admission outcome.
    pub outcome: BarberSubmissionOutcome,
}

/// Committed retail particle selection survives editor closure but not player replacement.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BarberCommittedParticles {
    /// Apply identity used to prevent replay on snapshot recovery.
    pub revision: u32,
    /// Exact target incarnation.
    pub subject: BarberSubject,
    /// Default script to play after clearing live particles; absent means clear without replay.
    pub script: Option<u32>,
}

/// Cold interaction, feedback, and persistent local racial effects form one recovery publication.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BarberSnapshot {
    /// Absent after cancellation, submission, or character retirement.
    pub interaction: Option<BarberInteraction>,
    /// Latest local submission feedback, cleared by the next opening.
    pub result: Option<BarberSubmissionResult>,
    /// Last committed particle selection for this player instance.
    pub particles: Option<BarberCommittedParticles>,
}

/// Exact frontend candidate identity; Apply is resolved from these choices, not a preview cache.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BarberDraft {
    /// Monotonic editor revision; zero identifies the initial unedited candidate.
    pub revision: u32,
    /// Semantic candidate with no unchecked wire assets.
    pub choices: BarberAppearanceChoices,
}

/// Shared commands carry the opening identity so delayed UI work cannot affect a later opening.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum BarberRequest {
    /// Interpret a candidate without sending anything to the game server.
    Preview {
        /// Opening identity.
        id: u32,
        /// Exact candidate.
        draft: BarberDraft,
    },
    /// Validate the exact final candidate and attempt FinishBarber once.
    Apply {
        /// Opening identity.
        id: u32,
        /// Exact candidate.
        draft: BarberDraft,
    },
    /// Local retirement; retail has no barber cancellation action.
    Cancel {
        /// Opening identity.
        id: u32,
    },
}

/// Preview failure is feature feedback, never a silently substituted appearance.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum BarberPreviewOutcome {
    /// Bare-body visual facts, independent of live placement, equipment, and simulation.
    Ready {
        /// Effective preview setup.
        setup: u32,
        /// Complete body substitutions.
        appearance: EntityAppearance,
        /// Preview racial particle selection.
        particles: BarberParticleChange,
    },
    /// Specific input/resolution failure; retain the last-good preview.
    Rejected {
        /// User-facing reason.
        message: String,
    },
}

/// A cold candidate result is installed only if its opening, instance, and revision remain current.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BarberPreviewResult {
    /// Opening identity.
    pub id: u32,
    /// Exact target incarnation.
    pub subject: BarberSubject,
    /// Frontend draft revision.
    pub revision: u32,
    /// Resolved body or explicit failure.
    pub outcome: BarberPreviewOutcome,
}

/// Immutable wire/world facts captured before loading content outside the runtime turn.
pub struct BarberOpening {
    /// Existing player heritage.
    pub heritage: u32,
    /// Existing player gender key.
    pub gender: u32,
    /// Complete original appearance supplied by ACE.
    pub assets: BarberAppearanceAssets,
    /// Lossless accepted body rows used to identify a disabled nonhuman style.
    pub accepted: ObjDesc,
}

/// Complete parsed rules and their opening interpretation, prepared as one product.
pub struct PreparedBarberInteraction {
    /// Reusable pure body resolver.
    pub rules: Arc<BarberAppearanceRules>,
    /// Static display/control data.
    pub catalog: BarberAppearanceCatalog,
    /// Original choices matched to the actual server assets.
    pub original: BarberAppearanceChoices,
}

/// Synchronous static preparation seam; the runtime invokes it on a blocking worker.
pub trait ClientBarberSource: Send + Sync + 'static {
    /// Load the body/palette closure and interpret the captured original appearance.
    fn prepare(&self, opening: BarberOpening) -> Result<PreparedBarberInteraction>;
}

/// Content implementation; all discovery/archive policy remains with the configured repository.
pub struct ContentClientBarberSource {
    /// Existing shared repository, without a second discovery or archive family.
    content: Arc<ContentRepository>,
}

impl ContentClientBarberSource {
    /// Inject the already selected content family.
    pub fn new(content: Arc<ContentRepository>) -> Self {
        Self { content }
    }
}

impl ClientBarberSource for ContentClientBarberSource {
    fn prepare(&self, opening: BarberOpening) -> Result<PreparedBarberInteraction> {
        let rules = Arc::new(
            self.content
                .read_barber_appearance_rules(opening.heritage, opening.gender)?,
        );
        let original = rules.interpret(&opening.assets, &opening.accepted)?;
        let catalog = rules.catalog(&self.content)?;
        Ok(PreparedBarberInteraction {
            rules,
            catalog,
            original,
        })
    }
}

/// Only successfully prepared rules can admit a preview or submission.
enum OwnedBarberPhase {
    Loading(tokio::task::JoinHandle<()>),
    Editing {
        prepared: Box<PreparedBarberInteraction>,
        latest: BarberDraft,
    },
    Sending,
    Unavailable(String),
}

struct OwnedBarberInteraction {
    id: u32,
    subject: BarberSubject,
    phase: OwnedBarberPhase,
}

impl Drop for OwnedBarberInteraction {
    fn drop(&mut self) {
        if let OwnedBarberPhase::Loading(worker) = &self.phase {
            worker.abort();
        }
    }
}

struct OpeningCompletion {
    id: u32,
    result: std::result::Result<PreparedBarberInteraction, String>,
}

/// Sole owner of an active barber interaction; rendering policy never enters this state.
pub(super) struct BarberRuntime {
    source: Option<Arc<dyn ClientBarberSource>>,
    next_id: u32,
    active: Option<OwnedBarberInteraction>,
    result: Option<BarberSubmissionResult>,
    particles: Option<BarberCommittedParticles>,
    completion_tx: mpsc::UnboundedSender<OpeningCompletion>,
    completion_rx: mpsc::UnboundedReceiver<OpeningCompletion>,
}

impl BarberRuntime {
    pub(super) fn new(source: Option<Arc<dyn ClientBarberSource>>) -> Self {
        let (completion_tx, completion_rx) = mpsc::unbounded_channel();
        Self {
            source,
            next_id: 0,
            active: None,
            result: None,
            particles: None,
            completion_tx,
            completion_rx,
        }
    }

    pub(super) fn snapshot(&self) -> BarberSnapshot {
        BarberSnapshot {
            interaction: self.active.as_ref().map(|active| BarberInteraction {
                id: active.id,
                subject: active.subject,
                phase: match &active.phase {
                    OwnedBarberPhase::Loading(_) => BarberPhase::Loading,
                    OwnedBarberPhase::Editing { prepared, latest } => BarberPhase::Editing {
                        revision: latest.revision,
                        original: prepared.original.clone(),
                        catalog: prepared.catalog.clone(),
                    },
                    OwnedBarberPhase::Sending => BarberPhase::Sending,
                    OwnedBarberPhase::Unavailable(message) => BarberPhase::Unavailable {
                        message: message.clone(),
                    },
                },
            }),
            result: self.result.clone(),
            particles: self.particles.clone(),
        }
    }

    fn open(&mut self, subject: BarberSubject, opening: BarberOpening) -> Result<()> {
        self.next_id = self
            .next_id
            .checked_add(1)
            .context("barber interaction identities exhausted")?;
        let id = self.next_id;
        self.result = None;
        self.active = None;
        let phase = if let Some(source) = self.source.clone() {
            let sender = self.completion_tx.clone();
            OwnedBarberPhase::Loading(tokio::spawn(async move {
                let prepared = tokio::task::spawn_blocking(move || source.prepare(opening)).await;
                let result = match prepared {
                    Ok(result) => result.map_err(|error| format!("{error:#}")),
                    Err(error) => Err(format!("barber content worker failed: {error}")),
                };
                // A retired runtime has no observer; dropping this completion releases its assets.
                let _ = sender.send(OpeningCompletion { id, result });
            }))
        } else {
            OwnedBarberPhase::Unavailable(
                "Barber content is unavailable in this client composition.".into(),
            )
        };
        self.active = Some(OwnedBarberInteraction { id, subject, phase });
        Ok(())
    }

    fn poll(&mut self) -> bool {
        let mut changed = false;
        while let Ok(completion) = self.completion_rx.try_recv() {
            let Some(active) = self
                .active
                .as_mut()
                .filter(|active| active.id == completion.id)
            else {
                continue;
            };
            if !matches!(active.phase, OwnedBarberPhase::Loading(_)) {
                continue;
            }
            active.phase = match completion.result {
                Ok(prepared) => OwnedBarberPhase::Editing {
                    latest: BarberDraft {
                        revision: 0,
                        choices: prepared.original.clone(),
                    },
                    prepared: Box::new(prepared),
                },
                Err(message) => OwnedBarberPhase::Unavailable(message),
            };
            changed = true;
        }
        changed
    }

    fn resolve(
        &mut self,
        id: u32,
        draft: &BarberDraft,
    ) -> Result<(BarberSubject, ResolvedBarberAppearance)> {
        let active = self
            .active
            .as_mut()
            .filter(|active| active.id == id)
            .context("The barber interaction has ended or changed.")?;
        let OwnedBarberPhase::Editing { prepared, latest } = &mut active.phase else {
            anyhow::bail!("The barber is not ready for editing.");
        };
        ensure!(
            draft.revision >= latest.revision,
            "The barber draft has been superseded by a newer edit."
        );
        ensure!(
            draft.revision != latest.revision || draft.choices == latest.choices,
            "The barber draft changed without a new revision."
        );
        *latest = draft.clone();
        let resolved = prepared.rules.resolve(&prepared.original, &draft.choices)?;
        Ok((active.subject, resolved))
    }

    fn reset(&mut self) -> bool {
        let changed = self.active.is_some() || self.result.is_some() || self.particles.is_some();
        self.active = None;
        self.result = None;
        self.particles = None;
        changed
    }

    fn reconcile(&mut self, world: &WorldState, state: &ClientState) -> bool {
        if matches!(
            state,
            ClientState::Disconnected | ClientState::LoggingOut | ClientState::CharacterSelection
        ) {
            return self.reset();
        }
        let current = |subject: BarberSubject| {
            subject.guid == world.player.guid
                && world
                    .entities
                    .get(subject.guid)
                    .is_none_or(|entity| entity.instance_sequence() == subject.instance)
        };
        // A portal can temporarily withdraw the entity without ending this same-character session.
        let retire_active = self
            .active
            .as_ref()
            .is_some_and(|active| !current(active.subject));
        let retire_particles = self
            .particles
            .as_ref()
            .is_some_and(|particles| !current(particles.subject));
        if retire_active {
            self.active = None;
            self.result = None;
        }
        if retire_particles {
            self.particles = None;
        }
        retire_active || retire_particles
    }
}

impl ClientRuntime {
    pub(super) fn publish_barber(&self) {
        let _ = self
            .client_view_event_tx
            .send(ClientViewEvent::BarberUpdated(self.barber.snapshot()));
    }

    pub(super) fn reset_barber(&mut self) {
        if self.barber.reset() {
            self.publish_barber();
        }
    }

    pub(super) fn poll_barber(&mut self) {
        let mut changed = self.barber.reconcile(&self.world, &self.state);
        changed |= self.barber.poll();
        if changed {
            self.publish_barber();
        }
    }

    pub(super) fn start_barber(&mut self, payload: &BarberAppearanceData) -> Result<()> {
        ensure!(
            matches!(
                self.state,
                ClientState::InWorld | ClientState::EnteringWorld
            ),
            "Barber opening requires a character session."
        );
        let entity = self
            .world
            .player_entity()
            .context("Barber opening has no established player entity.")?;
        let heritage = entity
            .get_int_prop(PropertyInt::HeritageGroup)
            .context("Barber player has no heritage.")?;
        let gender = entity
            .get_int_prop(PropertyInt::Gender)
            .context("Barber player has no gender.")?;
        let subject = BarberSubject {
            guid: entity.guid,
            instance: entity.instance_sequence(),
        };
        let opening = BarberOpening {
            heritage: u32::try_from(heritage)?,
            gender: u32::try_from(gender)?,
            assets: content_assets(payload),
            accepted: crate::dynamic_entity::entity_obj_desc(&entity.appearance),
        };
        self.barber.open(subject, opening)?;
        self.publish_barber();
        Ok(())
    }

    pub(super) async fn handle_barber_request(&mut self, request: BarberRequest) -> Result<()> {
        self.poll_barber();
        match request {
            BarberRequest::Cancel { id } => {
                if self
                    .barber
                    .active
                    .as_ref()
                    .is_some_and(|active| active.id == id)
                {
                    self.barber.active = None;
                    self.publish_barber();
                }
            }
            BarberRequest::Preview { id, draft } => {
                let subject = self
                    .barber
                    .active
                    .as_ref()
                    .filter(|active| active.id == id)
                    .map(|active| active.subject);
                let Some(subject) = subject else {
                    return Ok(());
                };
                let outcome = match self.barber.resolve(id, &draft) {
                    Ok((_, resolved)) => BarberPreviewOutcome::Ready {
                        setup: resolved.assets.setup,
                        appearance: EntityAppearance::from(&resolved.appearance),
                        particles: resolved.particles,
                    },
                    Err(error) => BarberPreviewOutcome::Rejected {
                        message: format!("{error:#}"),
                    },
                };
                let _ = self
                    .client_view_event_tx
                    .send(ClientViewEvent::BarberPreview(BarberPreviewResult {
                        id,
                        subject,
                        revision: draft.revision,
                        outcome,
                    }));
            }
            BarberRequest::Apply { id, draft } => {
                let prepared = (|| -> Result<_> {
                    ensure!(
                        matches!(self.state, ClientState::InWorld) && self.activation.is_none(),
                        "Wait for the player to enter the world before applying barber changes."
                    );
                    let (subject, resolved) = self.barber.resolve(id, &draft)?;
                    let entity = self
                        .world
                        .player_entity()
                        .context("The player is not currently available.")?;
                    ensure!(
                        entity.guid == subject.guid
                            && entity.instance_sequence() == subject.instance,
                        "The barber player instance has changed."
                    );
                    Ok((subject, resolved))
                })();
                let (subject, resolved) = match prepared {
                    Ok(prepared) => prepared,
                    Err(error) => {
                        self.barber.result = Some(BarberSubmissionResult {
                            id,
                            outcome: BarberSubmissionOutcome::Rejected {
                                message: format!("{error:#}"),
                            },
                        });
                        self.publish_barber();
                        return Ok(());
                    }
                };
                if let BarberParticleChange::Replace { script } = &resolved.particles {
                    self.barber.particles = Some(BarberCommittedParticles {
                        revision: id,
                        subject,
                        script: *script,
                    });
                }
                if let Some(active) = &mut self.barber.active {
                    active.phase = OwnedBarberPhase::Sending;
                }
                self.publish_barber();
                let outcome = match self
                    .send_game_action(GameAction::FinishBarber(Box::new(wire_assets(
                        resolved.assets,
                    ))))
                    .await
                {
                    Ok(()) => BarberSubmissionOutcome::Submitted,
                    Err(error) => BarberSubmissionOutcome::Uncertain {
                        message: format!(
                            "Barber submission may have been sent; do not retry automatically: {error:#}"
                        ),
                    },
                };
                self.barber.active = None;
                self.barber.result = Some(BarberSubmissionResult { id, outcome });
                self.publish_barber();
            }
        }
        Ok(())
    }
}

fn content_assets(wire: &BarberAppearanceData) -> BarberAppearanceAssets {
    BarberAppearanceAssets {
        base_palette: wire.base_palette,
        head_object: wire.head_object,
        hair: AppearanceTexturePair {
            current: wire.hair_texture,
            original: wire.default_hair_texture,
        },
        eyes: AppearanceTexturePair {
            current: wire.eyes_texture,
            original: wire.default_eyes_texture,
        },
        nose: AppearanceTexturePair {
            current: wire.nose_texture,
            original: wire.default_nose_texture,
        },
        mouth: AppearanceTexturePair {
            current: wire.mouth_texture,
            original: wire.default_mouth_texture,
        },
        skin_palette: wire.skin_palette,
        hair_palette: wire.hair_palette,
        eyes_palette: wire.eyes_palette,
        setup: wire.setup,
        option1: wire.option1,
    }
}

fn wire_assets(assets: BarberAppearanceAssets) -> BarberAppearanceData {
    BarberAppearanceData {
        base_palette: assets.base_palette,
        head_object: assets.head_object,
        hair_texture: assets.hair.current,
        default_hair_texture: assets.hair.original,
        eyes_texture: assets.eyes.current,
        default_eyes_texture: assets.eyes.original,
        nose_texture: assets.nose.current,
        default_nose_texture: assets.nose.original,
        mouth_texture: assets.mouth.current,
        default_mouth_texture: assets.mouth.original,
        skin_palette: assets.skin_palette,
        hair_palette: assets.hair_palette,
        eyes_palette: assets.eyes_palette,
        setup: assets.setup,
        option1: assets.option1,
        option2: 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{ClientCommand, client::builder::build_test_client};
    use holtburger_common::properties::WorldObjectPropertyAccessorsMut;
    use holtburger_content::character_gen::barber::{BarberRacialChoice, BarberStyleOptions};
    use holtburger_content::character_gen::body::BodyAppearanceChoices;
    use holtburger_dat::file_type::char_gen::{CharacterGenGender, EyeStrip, FaceStrip, HairStyle};
    use holtburger_dat::file_type::material::{AnimationPartChange, PaletteSet, TextureMapChange};
    use holtburger_protocol::messages::{
        GameActionMessage, GameEvent, GameEventMessage, GameMessage,
    };
    use holtburger_protocol::traits::ProtocolPack;
    use holtburger_world::entity::Entity;
    use std::collections::BTreeMap;

    const PLAYER: Guid = Guid(1);
    const SETUP: u32 = 0x0200_0001;
    const HEAD: u32 = 0x0100_0100;
    const SKIN_SET: u32 = 0x0f00_0001;
    const HAIR_SET: u32 = 0x0f00_0002;
    const SKIN: u32 = 0x0400_0100;
    const HAIR: u32 = 0x0400_0200;
    const EYE: u32 = 0x0400_0300;

    struct FixtureSource {
        heritage: u32,
        rules: Arc<BarberAppearanceRules>,
    }

    impl ClientBarberSource for FixtureSource {
        fn prepare(&self, opening: BarberOpening) -> Result<PreparedBarberInteraction> {
            ensure!(
                opening.heritage == self.heritage && opening.gender == 1,
                "unexpected fixture identity"
            );
            let original = self.rules.interpret(&opening.assets, &opening.accepted)?;
            Ok(PreparedBarberInteraction {
                rules: self.rules.clone(),
                original,
                catalog: BarberAppearanceCatalog {
                    styles: BarberStyleOptions::Editable {
                        hair: 1,
                        eyes: 1,
                        noses: 1,
                        mouths: 1,
                    },
                    hair_colors: vec![vec![[1, 2, 3]]],
                    skin_colors: vec![[4, 5, 6]],
                    eye_colors: vec![[7, 8, 9]],
                },
            })
        }
    }

    fn fixture() -> (ClientRuntime, BarberAppearanceData, BarberAppearanceChoices) {
        racial_fixture(1, BarberRacialChoice::Standard)
    }

    fn racial_fixture(
        heritage: u32,
        racial: BarberRacialChoice,
    ) -> (ClientRuntime, BarberAppearanceData, BarberAppearanceChoices) {
        let descriptor = |texture| ObjDesc {
            anim_part_changes: vec![AnimationPartChange {
                part_index: 16,
                part_id: HEAD,
            }],
            texture_changes: vec![TextureMapChange {
                part_index: 16,
                old_texture: texture,
                new_texture: texture + 1,
            }],
            ..ObjDesc::empty()
        };
        let gender = CharacterGenGender {
            name: "Fixture".into(),
            scale: 100,
            setup_id: SETUP,
            sound_table: 0,
            icon_image: 0,
            base_palette: SKIN,
            skin_palette_set: SKIN_SET,
            physics_table: 0,
            motion_table: 0,
            combat_table: 0,
            base_obj_desc: ObjDesc::empty(),
            hair_color_list: vec![HAIR_SET],
            hair_style_list: vec![HairStyle {
                icon_image: 0,
                bald: false,
                alternate_setup: 0,
                obj_desc: descriptor(0x0500_0100),
            }],
            eye_color_list: vec![EYE],
            eye_strip_list: vec![EyeStrip {
                icon_image: 0,
                icon_image_bald: 0,
                obj_desc: descriptor(0x0500_0200),
                obj_desc_bald: descriptor(0x0500_0200),
            }],
            nose_strip_list: vec![FaceStrip {
                icon_image: 0,
                obj_desc: descriptor(0x0500_0300),
            }],
            mouth_strip_list: vec![FaceStrip {
                icon_image: 0,
                obj_desc: descriptor(0x0500_0400),
            }],
            headgear_list: vec![],
            shirt_list: vec![],
            pants_list: vec![],
            footwear_list: vec![],
            clothing_colors_list: vec![],
        };
        let rules = Arc::new(
            BarberAppearanceRules::from_assets(
                heritage,
                1,
                gender,
                BTreeMap::from([
                    (
                        SKIN_SET,
                        PaletteSet {
                            id: SKIN_SET,
                            palette_ids: vec![SKIN],
                        },
                    ),
                    (
                        HAIR_SET,
                        PaletteSet {
                            id: HAIR_SET,
                            palette_ids: vec![HAIR],
                        },
                    ),
                ]),
            )
            .unwrap(),
        );
        let original = BarberAppearanceChoices {
            body: BodyAppearanceChoices {
                eyes: 0,
                nose: 0,
                mouth: 0,
                hair_color: 0,
                eye_color: 0,
                hair_style: 0,
                skin_hue: 0.5,
                hair_hue: 0.5,
            },
            racial,
        };
        let resolved = rules.resolve(&original, &original).unwrap();
        let mut client = build_test_client(ClientState::InWorld);
        client.world.player.guid = PLAYER;
        let mut entity = Entity::new(PLAYER, "Fixture".into(), Default::default());
        entity.set_int_prop(PropertyInt::HeritageGroup, heritage as i32);
        entity.set_int_prop(PropertyInt::Gender, 1);
        entity.appearance = EntityAppearance::from(&resolved.appearance);
        client.world.add_entity(entity);
        client.barber = BarberRuntime::new(Some(Arc::new(FixtureSource { heritage, rules })));
        (client, wire_assets(resolved.assets), original)
    }

    async fn settle(client: &mut ClientRuntime) {
        if let OwnedBarberPhase::Loading(worker) = &mut client.barber.active.as_mut().unwrap().phase
        {
            worker.await.unwrap();
        }
        client.poll_barber();
    }

    #[tokio::test]
    async fn empyrean_motion_waits_for_the_private_property_update_and_needs_no_ack_if_unchanged() {
        use holtburger_common::properties::PropertyDataId;
        use holtburger_protocol::messages::PrivateUpdatePropertyDataIdData;
        const FLOATING: u32 = 0x0900_020B;
        const EARTHBOUND: u32 = 0x0900_020E;
        let (mut client, payload, original) =
            racial_fixture(9, BarberRacialChoice::Empyrean { earthbound: false });
        client
            .world
            .entities
            .get_mut(PLAYER)
            .unwrap()
            .set_did_prop(PropertyDataId::MotionTable, Guid(FLOATING));
        client.start_barber(&payload).unwrap();
        settle(&mut client).await;
        let id = client.barber.snapshot().interaction.unwrap().id;
        let choices = BarberAppearanceChoices {
            racial: BarberRacialChoice::Empyrean { earthbound: true },
            ..original
        };
        client
            .handle_barber_request(BarberRequest::Apply {
                id,
                draft: BarberDraft {
                    revision: 1,
                    choices: choices.clone(),
                },
            })
            .await
            .unwrap();
        assert_eq!(
            client.world.effective_motion_table_id_for_guid(PLAYER),
            Some(FLOATING)
        );
        assert!(client.barber.snapshot().interaction.is_none());
        let update =
            GameMessage::PrivateUpdatePropertyDataId(Box::new(PrivateUpdatePropertyDataIdData {
                guid: Guid::NULL,
                sequence: 1,
                property: PropertyDataId::MotionTable as u32,
                value: Guid(EARTHBOUND),
            }));
        let mut bytes = Vec::new();
        update.pack(&mut bytes);
        client.handle_message(&bytes).await.unwrap();
        assert_eq!(
            client.world.effective_motion_table_id_for_guid(PLAYER),
            Some(EARTHBOUND)
        );
        let payload = BarberAppearanceData {
            option1: 1,
            ..payload
        };
        client.start_barber(&payload).unwrap();
        settle(&mut client).await;
        let id = client.barber.snapshot().interaction.unwrap().id;
        client
            .handle_barber_request(BarberRequest::Apply {
                id,
                draft: BarberDraft {
                    revision: 1,
                    choices,
                },
            })
            .await
            .unwrap();
        assert_eq!(
            client.world.effective_motion_table_id_for_guid(PLAYER),
            Some(EARTHBOUND)
        );
        assert!(client.barber.snapshot().interaction.is_none());
        assert!(matches!(
            client.barber.snapshot().result.unwrap().outcome,
            BarberSubmissionOutcome::Submitted
        ));
    }

    #[tokio::test]
    async fn decoded_opening_preview_apply_and_duplicate_share_one_authority() {
        let (mut client, payload, original) = fixture();
        let opening = GameMessage::GameEvent(Box::new(GameEventMessage {
            target: PLAYER,
            sequence: 1,
            event: GameEvent::StartBarber(Box::new(payload.clone())),
        }));
        let mut bytes = Vec::new();
        opening.pack(&mut bytes);
        client.handle_message(&bytes).await.unwrap();
        assert!(matches!(
            client.barber.snapshot().interaction.unwrap().phase,
            BarberPhase::Loading
        ));
        settle(&mut client).await;
        let view = client.application_snapshot().barber.interaction.unwrap();
        assert!(matches!(view.phase, BarberPhase::Editing { .. }));
        let draft = BarberDraft {
            revision: 1,
            choices: original,
        };
        client
            .handle_command(ClientCommand::Barber(BarberRequest::Preview {
                id: view.id,
                draft: draft.clone(),
            }))
            .await
            .unwrap();
        assert_eq!(client.session.bytes_out, 0);
        let capture = tempfile::NamedTempFile::new().unwrap();
        client
            .session
            .set_capture(capture.path().to_str().unwrap())
            .unwrap();
        let before = client.session.fragment_sequence;
        client
            .handle_command(ClientCommand::Barber(BarberRequest::Apply {
                id: view.id,
                draft: draft.clone(),
            }))
            .await
            .unwrap();
        assert_eq!(client.session.fragment_sequence, before + 1);
        assert!(client.barber.snapshot().interaction.is_none());
        assert_eq!(
            client.barber.snapshot().result.unwrap().outcome,
            BarberSubmissionOutcome::Submitted
        );
        let mut expected = Vec::new();
        GameMessage::GameAction(Box::new(GameActionMessage {
            sequence: 1,
            action: GameAction::FinishBarber(Box::new(payload)),
        }))
        .pack(&mut expected);
        let captured = std::fs::read(capture.path()).unwrap();
        assert!(
            captured.ends_with(&expected),
            "captured datagram must contain the exact complete FinishBarber action"
        );
        client
            .handle_command(ClientCommand::Barber(BarberRequest::Apply {
                id: view.id,
                draft,
            }))
            .await
            .unwrap();
        assert_eq!(client.session.fragment_sequence, before + 1);
    }

    #[tokio::test]
    async fn canceled_openings_and_stale_ids_cannot_restore_or_submit_an_editor() {
        let (mut client, payload, original) = fixture();
        client.start_barber(&payload).unwrap();
        let old = client.barber.snapshot().interaction.unwrap().id;
        client
            .handle_barber_request(BarberRequest::Cancel { id: old })
            .await
            .unwrap();
        assert!(client.application_snapshot().barber.interaction.is_none());
        client.start_barber(&payload).unwrap();
        settle(&mut client).await;
        let current = client.barber.snapshot().interaction.unwrap().id;
        assert_ne!(current, old);
        client
            .handle_barber_request(BarberRequest::Apply {
                id: old,
                draft: BarberDraft {
                    revision: 1,
                    choices: original,
                },
            })
            .await
            .unwrap();
        assert_eq!(client.barber.snapshot().interaction.unwrap().id, current);
        assert_eq!(client.session.bytes_out, 0);
        client
            .handle_barber_request(BarberRequest::Cancel { id: current })
            .await
            .unwrap();
        client.poll_barber();
        assert!(client.application_snapshot().barber.interaction.is_none());
    }

    #[tokio::test]
    async fn validation_failure_retains_editing_and_newer_revisions_supersede_old_requests() {
        let (mut client, payload, original) = fixture();
        client.start_barber(&payload).unwrap();
        settle(&mut client).await;
        let id = client.barber.snapshot().interaction.unwrap().id;
        let mut invalid = original.clone();
        invalid.body.nose = u32::MAX;
        client
            .handle_barber_request(BarberRequest::Apply {
                id,
                draft: BarberDraft {
                    revision: 2,
                    choices: invalid,
                },
            })
            .await
            .unwrap();
        assert!(matches!(
            client.barber.snapshot().interaction.unwrap().phase,
            BarberPhase::Editing { .. }
        ));
        assert!(matches!(
            client.barber.snapshot().result.unwrap().outcome,
            BarberSubmissionOutcome::Rejected { .. }
        ));
        assert!(
            client
                .barber
                .resolve(
                    id,
                    &BarberDraft {
                        revision: 1,
                        choices: original.clone()
                    }
                )
                .is_err()
        );
        assert!(
            client
                .barber
                .resolve(
                    id,
                    &BarberDraft {
                        revision: 2,
                        choices: original.clone()
                    }
                )
                .is_err()
        );
        assert!(
            client
                .barber
                .resolve(
                    id,
                    &BarberDraft {
                        revision: 3,
                        choices: original
                    }
                )
                .is_ok()
        );
        assert_eq!(client.session.bytes_out, 0);
        assert!(matches!(
            client.barber.snapshot().interaction.unwrap().phase,
            BarberPhase::Editing { revision: 3, .. }
        ));
        client.state = ClientState::Disconnected;
        client.poll_barber();
        assert_eq!(client.barber.snapshot(), BarberSnapshot::default());
    }

    #[tokio::test]
    async fn uncertain_send_consumes_the_interaction_without_automatic_retry() {
        let (mut client, payload, original) = fixture();
        client.start_barber(&payload).unwrap();
        settle(&mut client).await;
        let id = client.barber.snapshot().interaction.unwrap().id;
        // Existing transport tests use this IPv4-bound socket/IPv6-destination failure boundary.
        client.session = holtburger_session::Session::new("[::1]:9000".parse().unwrap())
            .await
            .unwrap();
        let draft = BarberDraft {
            revision: 1,
            choices: original,
        };
        client
            .handle_barber_request(BarberRequest::Apply {
                id,
                draft: draft.clone(),
            })
            .await
            .unwrap();
        assert!(matches!(
            client.barber.snapshot().result.unwrap().outcome,
            BarberSubmissionOutcome::Uncertain { .. }
        ));
        assert!(client.barber.snapshot().interaction.is_none());
        let sequence = client.session.fragment_sequence;
        client
            .handle_barber_request(BarberRequest::Apply { id, draft })
            .await
            .unwrap();
        assert_eq!(client.session.fragment_sequence, sequence);
    }
}
