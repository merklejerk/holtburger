//! Catalog-backed Explorer entity preparation and serialized lifecycle operations.

use std::error::Error;
use std::fmt::{Display, Formatter};
use std::io::Cursor;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Instant;

use holtburger_common::position::WorldPosition;
use holtburger_common::properties::{PhysicsState, WeenieType};
use holtburger_common::{Guid, Quaternion, Vector3};
use holtburger_content::ContentRepository;
use holtburger_core::{
    DynamicEntityContent, DynamicEntityDefinition, DynamicEntityDefinitionError,
    DynamicEntityDefinitionInput, DynamicEntityIdentity, DynamicEntityInitialState,
    DynamicEntityLaunchError, DynamicEntityPhysicalPreparationError, DynamicEntitySetupPreparation,
    prepare_dynamic_entity_physics, prepare_dynamic_entity_setup, resolve_dynamic_entity_launch,
};
use holtburger_dat::file_type::{CharGen, ClothingTable, PaletteSet};
use holtburger_dat::{EOR_PORTAL_NAMESPACE, ResourceKey};
use holtburger_weenie_catalog::WeenieTemplate;
use holtburger_world::{
    CellTransitRequest, DynamicPhysicalBodyDefinition, EffectiveEntityPhysicsState,
    EntityAppearance, EntityPartChange, EntityPhysicalIntent, EntityPhysicalTransitionAction,
    EntityPhysicsStateInput, EntityPhysicsStateOverrides, EntityPlacement, EntitySubPalette,
    EntityTextureChange, WieldedItemClassification, WieldedItemClassificationError,
    WieldedItemSlotFacts, calculate_effective_entity_physics_state, classify_wielded_item,
    resolve_effective_entity_physics_state,
};
use serde::Deserialize;

use crate::explorer_entity_runtime::{
    ExplorerEntityDespawnOutcome, ExplorerEntityLaunchOutcome, ExplorerEntityPhysicsStateOutcome,
    ExplorerEntityRelocationOutcome, ExplorerEntityReplacementOutcome, ExplorerEntityRuntime,
    ExplorerEntityRuntimeError, ExplorerEntitySpawnOutcome,
};
use crate::explorer_weenie_catalog::{
    ExplorerCatalogCapability, ExplorerCatalogLookupError, ExplorerWeenieCatalogSource,
};
use crate::host_simulation_runtime::HostSimulationRuntime;
use crate::weenie_appearance::{
    ClothingError, ClothingPaletteSelection, ClothingSource, WieldedItem, apply_clothing_base,
    requires_character_generation, resolve_authored_appearance, resolve_template_appearance,
    resolve_worn_equipment, select_wielded,
};

struct SelectedWieldedItem {
    template: WeenieTemplate,
    item: WieldedItem,
}

struct ResolvedSpawnAppearance {
    wearer: EntityAppearance,
    wielded: Vec<SelectedWieldedItem>,
}

/// Explicit host-owned spawn placement; `candidate` uses the camera pose's landblock frame.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplorerEntitySpawnRequest {
    /// WCID selected for one exact catalog point lookup.
    pub wcid: u32,
    /// Current host-projected camera pose, used only as portal-history and coordinate anchor.
    pub camera_pose: WorldPosition,
    /// Explicit candidate root point in `camera_pose`'s landblock frame.
    pub candidate: Vector3,
    /// Explicit candidate root orientation.
    pub rotation: Quaternion,
    /// Whether to enable local solver participation or retain a canonical pose-only body.
    pub physical_intent: EntityPhysicalIntent,
}

/// One exact-generation launch using catalog-authored speed and explicit world direction.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplorerEntityLaunchRequest {
    /// Exact current entity identity.
    pub guid: Guid,
    /// Exact current instance generation.
    pub generation: u64,
    /// Finite nonzero world-space direction; magnitude is intentionally ignored.
    pub direction: Vector3,
}

/// Explicit correction semantics for one discontinuous Explorer relocation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ExplorerEntityRelocationKind {
    /// Ordinary discontinuous placement that supersedes interpolation.
    Teleport,
    /// Forced authority/timeline correction that also clears prediction state.
    Reset,
}

impl ExplorerEntityRelocationKind {
    /// Projects app-local command vocabulary into the source-neutral feed contract.
    pub const fn advance_kind(self) -> holtburger_core::DynamicEntityPlacementAdvanceKind {
        match self {
            Self::Teleport => holtburger_core::DynamicEntityPlacementAdvanceKind::Teleport,
            Self::Reset => holtburger_core::DynamicEntityPlacementAdvanceKind::Reset,
        }
    }
}

/// One exact-generation host-resolved teleport or forced reset.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExplorerEntityRelocationRequest {
    /// Exact current entity identity.
    pub guid: Guid,
    /// Exact current instance generation.
    pub generation: u64,
    /// Current host-projected camera pose used as portal history and coordinate anchor.
    pub camera_pose: WorldPosition,
    /// Candidate root point in `camera_pose`'s landblock frame.
    pub candidate: Vector3,
    /// Explicit candidate root orientation.
    pub rotation: Quaternion,
    /// Frontend correction semantics for this discontinuity.
    pub kind: ExplorerEntityRelocationKind,
}

/// One exact live generation plus the complete catalog-backed facts for its successor.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ExplorerEntityReplaceRequest {
    /// Existing Explorer identity retained across complete replacement.
    pub guid: Guid,
    /// Current generation that must be retired by this operation.
    pub generation: u64,
    /// Complete source request used to prepare the successor before mutation.
    pub replacement: ExplorerEntitySpawnRequest,
}

/// Failure from one serialized catalog-backed Explorer entity operation.
#[derive(Debug)]
pub enum ExplorerEntityDriverError {
    /// Optional catalog capability is unavailable or one indexed record cannot be decoded.
    Catalog(ExplorerCatalogLookupError),
    /// The selected validated catalog contains no record for the requested WCID.
    MissingWcid { wcid: u32 },
    /// The template lacks a display name; class provenance is not an implicit fallback.
    MissingName { wcid: u32 },
    /// The template lacks the SetupModel required by presentation and placement.
    MissingSetup { wcid: u32 },
    /// The catalog contains a numeric WeenieType outside ACE's authoritative enum.
    InvalidWeenieType { wcid: u32, value: i32 },
    /// A catalog double cannot enter the validated single-precision runtime contract.
    InvalidScalar { wcid: u32, field: &'static str },
    /// The source-neutral definition rejected catalog/request facts.
    Definition(DynamicEntityDefinitionError),
    /// Immutable catalog facts or the requested direction cannot produce a launch.
    Launch(DynamicEntityLaunchError),
    /// DAT/setup or physical preparation rejected the selected template.
    Preparation(DynamicEntityPhysicalPreparationError),
    /// Candidate normalization or portal placement failed.
    Placement(String),
    /// Ordered registry/body lifecycle rejected the operation.
    Runtime(ExplorerEntityRuntimeError),
    /// Appearance resolution needed content the mount does not provide.
    AppearanceContent(ExplorerAppearanceContentError),
    /// A wielded item names a WCID absent from the catalog.
    MissingWieldedItem { wcid: u32, item_wcid: u32 },
    /// A wielded item lacks a catalog fact required by its exact held slot.
    EquipmentClassification {
        wcid: u32,
        item_wcid: u32,
        source: WieldedItemClassificationError,
    },
    /// A clothing base could not be resolved, whether the wearer's own or a wielded item's.
    Clothing { wcid: u32, source: ClothingError },
}

impl From<ExplorerAppearanceContentError> for ExplorerEntityDriverError {
    fn from(value: ExplorerAppearanceContentError) -> Self {
        Self::AppearanceContent(value)
    }
}

impl Display for ExplorerEntityDriverError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Catalog(source) => Display::fmt(source, formatter),
            Self::MissingWcid { wcid } => write!(formatter, "weenie catalog has no WCID {wcid}"),
            Self::MissingName { wcid } => {
                write!(formatter, "WCID {wcid} has no display name")
            }
            Self::MissingSetup { wcid } => {
                write!(formatter, "WCID {wcid} has no setup-model data ID")
            }
            Self::InvalidWeenieType { wcid, value } => {
                write!(
                    formatter,
                    "WCID {wcid} has unsupported WeenieType value {value}"
                )
            }
            Self::InvalidScalar { wcid, field } => {
                write!(
                    formatter,
                    "WCID {wcid} {field} cannot be represented as finite f32"
                )
            }
            Self::Definition(source) => Display::fmt(source, formatter),
            Self::Launch(source) => Display::fmt(source, formatter),
            Self::Preparation(source) => Display::fmt(source, formatter),
            Self::Placement(reason) => formatter.write_str(reason),
            Self::Runtime(source) => Display::fmt(source, formatter),
            Self::AppearanceContent(source) => Display::fmt(source, formatter),
            Self::MissingWieldedItem { wcid, item_wcid } => write!(
                formatter,
                "WCID {wcid} wields item {item_wcid}, which the catalog does not contain"
            ),
            Self::EquipmentClassification {
                wcid,
                item_wcid,
                source,
            } => write!(
                formatter,
                "WCID {wcid} wielded item {item_wcid} cannot be classified: {source}"
            ),
            Self::Clothing { wcid, source } => {
                write!(formatter, "WCID {wcid} clothing failed: {source}")
            }
        }
    }
}

impl Error for ExplorerEntityDriverError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Catalog(source) => Some(source),
            Self::Definition(source) => Some(source),
            Self::Launch(source) => Some(source),
            Self::Preparation(source) => Some(source),
            Self::Runtime(source) => Some(source),
            _ => None,
        }
    }
}

impl From<ExplorerCatalogLookupError> for ExplorerEntityDriverError {
    fn from(value: ExplorerCatalogLookupError) -> Self {
        Self::Catalog(value)
    }
}

impl From<DynamicEntityDefinitionError> for ExplorerEntityDriverError {
    fn from(value: DynamicEntityDefinitionError) -> Self {
        Self::Definition(value)
    }
}

impl From<DynamicEntityLaunchError> for ExplorerEntityDriverError {
    fn from(value: DynamicEntityLaunchError) -> Self {
        Self::Launch(value)
    }
}

impl From<DynamicEntityPhysicalPreparationError> for ExplorerEntityDriverError {
    fn from(value: DynamicEntityPhysicalPreparationError) -> Self {
        Self::Preparation(value)
    }
}

impl From<ExplorerEntityRuntimeError> for ExplorerEntityDriverError {
    fn from(value: ExplorerEntityRuntimeError) -> Self {
        Self::Runtime(value)
    }
}

/// Injected DAT/setup preparation boundary for production content and focused host fixtures.
pub trait ExplorerEntityContentPreparer: Send + Sync {
    /// Resolves setup-owned state facts and placement spheres.
    fn prepare_setup(
        &self,
        wcid: u32,
        setup_did: u32,
        object_scale: f32,
    ) -> Result<DynamicEntitySetupPreparation, DynamicEntityPhysicalPreparationError>;

    /// Resolves complete stable solver facts for simulated intent.
    fn prepare_physical(
        &self,
        definition: &DynamicEntityDefinition,
    ) -> Result<DynamicPhysicalBodyDefinition, DynamicEntityPhysicalPreparationError>;

    /// Immutable character-generation table used to fill unauthored appearance features.
    ///
    /// Absence is a loud content failure rather than a silent bare-setup fallback, because a
    /// humanoid template that reaches generation cannot be realized correctly without it.
    fn char_gen(&self) -> Result<Arc<CharGen>, ExplorerAppearanceContentError>;

    /// Resolves one `PaletteSet` resource to the palette matching a hue.
    fn palette_set(&self, palette_set_did: u32, hue: f64) -> Option<u32>;

    /// Reads one clothing table for the equipment merge.
    fn clothing_table(&self, clothing_base_did: u32) -> Option<ClothingTable>;
}

/// Content required by appearance resolution that mounted content did not supply.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExplorerAppearanceContentError {
    /// The character-generation table is missing or undecodable.
    CharGenUnavailable { reason: String },
}

impl Display for ExplorerAppearanceContentError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::CharGenUnavailable { reason } => {
                write!(
                    formatter,
                    "character generation table unavailable: {reason}"
                )
            }
        }
    }
}

impl Error for ExplorerAppearanceContentError {}

/// Production DAT-backed preparation adapter.
pub struct DatExplorerEntityContentPreparer {
    content: Arc<ContentRepository>,
    /// `ContentRepository::read_asset` parses on every call, so the immutable table is retained
    /// once here rather than re-decoded per spawn. This is retained content, not entity state.
    char_gen: OnceLock<Arc<CharGen>>,
}

impl DatExplorerEntityContentPreparer {
    /// Binds preparation to the same immutable repository used by the Explorer host.
    pub fn new(content: Arc<ContentRepository>) -> Self {
        Self {
            content,
            char_gen: OnceLock::new(),
        }
    }
}

impl ExplorerEntityContentPreparer for DatExplorerEntityContentPreparer {
    fn prepare_setup(
        &self,
        wcid: u32,
        setup_did: u32,
        object_scale: f32,
    ) -> Result<DynamicEntitySetupPreparation, DynamicEntityPhysicalPreparationError> {
        prepare_dynamic_entity_setup(wcid, setup_did, object_scale, &self.content)
    }

    fn prepare_physical(
        &self,
        definition: &DynamicEntityDefinition,
    ) -> Result<DynamicPhysicalBodyDefinition, DynamicEntityPhysicalPreparationError> {
        prepare_dynamic_entity_physics(definition, &self.content)
    }

    fn char_gen(&self) -> Result<Arc<CharGen>, ExplorerAppearanceContentError> {
        if let Some(char_gen) = self.char_gen.get() {
            return Ok(Arc::clone(char_gen));
        }
        let char_gen = Arc::new(
            self.content
                .read_asset::<CharGen>("character generator table")
                .map_err(|error| ExplorerAppearanceContentError::CharGenUnavailable {
                    reason: format!("{error:#}"),
                })?,
        );
        Ok(Arc::clone(self.char_gen.get_or_init(|| char_gen)))
    }

    fn palette_set(&self, palette_set_did: u32, hue: f64) -> Option<u32> {
        self.content
            .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, palette_set_did))
            .ok()
            .and_then(|resource| PaletteSet::unpack(&mut Cursor::new(resource.bytes)).ok())
            .and_then(|set| set.palette_id_for_shade(hue))
    }

    fn clothing_table(&self, clothing_base_did: u32) -> Option<ClothingTable> {
        self.content
            .read_resource(ResourceKey::new(EOR_PORTAL_NAMESPACE, clothing_base_did))
            .ok()
            .and_then(|resource| ClothingTable::unpack(&mut Cursor::new(resource.bytes)).ok())
    }
}

/// Injected monotonic clock used to make definition equality and host tests deterministic.
pub trait ExplorerEntityClock: Send + Sync {
    /// Returns the creation instant for the next fully prepared instance.
    fn now(&self) -> Instant;
}

/// Production monotonic host clock.
#[derive(Debug, Default)]
pub struct SystemExplorerEntityClock;

impl ExplorerEntityClock for SystemExplorerEntityClock {
    fn now(&self) -> Instant {
        Instant::now()
    }
}

/// Serialized app-local driver for catalog lookup, preparation, placement, and lifecycle.
pub struct ExplorerEntityDriver {
    catalog: Arc<dyn ExplorerWeenieCatalogSource>,
    content: Arc<dyn ExplorerEntityContentPreparer>,
    clock: Arc<dyn ExplorerEntityClock>,
    entities: Arc<ExplorerEntityRuntime>,
    simulation: Arc<HostSimulationRuntime>,
    operation: Mutex<()>,
}

impl ExplorerEntityDriver {
    /// Composes the driver from independently injectable app-local dependencies.
    pub fn new(
        catalog: Arc<dyn ExplorerWeenieCatalogSource>,
        content: Arc<dyn ExplorerEntityContentPreparer>,
        clock: Arc<dyn ExplorerEntityClock>,
        entities: Arc<ExplorerEntityRuntime>,
        simulation: Arc<HostSimulationRuntime>,
    ) -> Self {
        Self {
            catalog,
            content,
            clock,
            entities,
            simulation,
            operation: Mutex::new(()),
        }
    }

    /// Returns catalog capability without touching entity or solver state.
    pub fn catalog_capability(&self) -> ExplorerCatalogCapability {
        self.catalog.capability()
    }

    /// Looks up, validates, places, and publishes one WCID under a fresh Explorer identity.
    pub fn spawn_by_wcid(
        &self,
        request: ExplorerEntitySpawnRequest,
    ) -> Result<ExplorerEntitySpawnOutcome, ExplorerEntityDriverError> {
        let _operation = self
            .operation
            .lock()
            .expect("Explorer entity driver lock poisoned");
        let guid = self.entities.reserve_guid()?;
        let (definition, physical, children) = self.prepare_by_wcid(guid, request)?;
        self.entities
            .spawn_prepared_group(definition, request.physical_intent, physical, children)
            .map_err(ExplorerEntityDriverError::from)
    }

    /// Fully prepares and atomically replaces one exact generation under its existing GUID.
    pub fn replace_by_wcid(
        &self,
        request: ExplorerEntityReplaceRequest,
    ) -> Result<ExplorerEntityReplacementOutcome, ExplorerEntityDriverError> {
        let _operation = self
            .operation
            .lock()
            .expect("Explorer entity driver lock poisoned");
        self.entities.instance(request.guid, request.generation)?;
        let (definition, physical, children) =
            self.prepare_by_wcid(request.guid, request.replacement)?;
        self.entities
            .replace_prepared_group(
                definition,
                request.generation,
                request.replacement.physical_intent,
                physical,
                children,
            )
            .map_err(ExplorerEntityDriverError::from)
    }

    /// Resolves the template facts every realized entity derives the same way: required setup,
    /// authored-or-default scale, prepared setup state, and the effective physics composition.
    fn prepare_template_content(
        &self,
        template: &WeenieTemplate,
    ) -> Result<PreparedTemplateContent, ExplorerEntityDriverError> {
        let object_scale =
            optional_f32(template.wcid, "default scale", template.default_scale)?.unwrap_or(1.0); // ACE PhysicsGlobals.DefaultScale.
        let setup_did = template
            .setup_did
            .ok_or(ExplorerEntityDriverError::MissingSetup {
                wcid: template.wcid,
            })?;
        let setup = self
            .content
            .prepare_setup(template.wcid, setup_did, object_scale)?;
        let physics =
            calculate_effective_entity_physics_state(physics_input(template), setup.physics);
        Ok(PreparedTemplateContent {
            setup_did,
            object_scale,
            setup,
            physics,
        })
    }

    fn prepare_by_wcid(
        &self,
        guid: Guid,
        request: ExplorerEntitySpawnRequest,
    ) -> Result<
        (
            DynamicEntityDefinition,
            Option<DynamicPhysicalBodyDefinition>,
            Vec<DynamicEntityDefinition>,
        ),
        ExplorerEntityDriverError,
    > {
        let template = self
            .catalog
            .lookup(request.wcid)?
            .ok_or(ExplorerEntityDriverError::MissingWcid { wcid: request.wcid })?;
        let content = self.prepare_template_content(&template)?;
        if !content.physics.supports_local_simulation() {
            return Err(ExplorerEntityDriverError::Preparation(
                DynamicEntityPhysicalPreparationError::UnsupportedPhysicsState {
                    wcid: template.wcid,
                    state: content.physics.semantic.bits(),
                    unsupported_bits: content.physics.unsupported_local_simulation.bits(),
                    unknown_bits: content.physics.unknown_bits,
                },
            ));
        }
        let resolved_appearance = self.resolve_appearance(guid, &template, content.setup_did)?;
        let placement = EntityPlacement::World(DynamicEntityInitialState {
            pose: candidate_pose(request.camera_pose, request.candidate, request.rotation)?,
            velocity: Vector3::zero(),
            acceleration: Vector3::zero(),
            omega: Vector3::zero(),
            created_at: self.clock.now(),
        });
        let mut definition = DynamicEntityDefinition::prepare(template_definition_input(
            &template,
            guid,
            &content,
            resolved_appearance.wearer,
            placement,
        )?)?;
        let physical = match request.physical_intent {
            EntityPhysicalIntent::PoseOnly => None,
            EntityPhysicalIntent::Simulated => Some(self.content.prepare_physical(&definition)?),
        };
        let initial = definition
            .placement
            .world_mut()
            .expect("root spawn definition must own world placement");
        initial.pose = resolve_spawn_placement(
            &self.simulation.snapshot(),
            request.camera_pose,
            initial.pose,
            content.setup.movement_spheres.primary().center,
            content.setup.movement_spheres.primary().radius,
        )?;
        let children = self.prepare_held_children(guid, resolved_appearance.wielded)?;
        Ok((definition, physical, children))
    }

    fn prepare_held_children(
        &self,
        parent: Guid,
        wielded: Vec<SelectedWieldedItem>,
    ) -> Result<Vec<DynamicEntityDefinition>, ExplorerEntityDriverError> {
        let mut children = Vec::new();
        for selected in wielded {
            let Some(WieldedItemClassification::Held(held)) = selected.item.classification else {
                continue;
            };
            let template = selected.template;
            let guid = self.entities.reserve_guid()?;
            let content = self.prepare_template_content(&template)?;
            let mut appearance =
                resolve_authored_appearance(template.palette_base_did, &template.appearance);
            append_template_obj_desc(&mut appearance, &template);
            // A held item is its own object: it paints its own setup through its own ClothingBase,
            // exactly as ACE's base `CalculateObjDesc` does for any non-creature.
            if let Some(source) = selected.item.clothing_source() {
                apply_clothing_base(
                    &mut appearance,
                    content.setup_did,
                    source,
                    |clothing_base| self.content.clothing_table(clothing_base),
                    |set, hue| self.content.palette_set(set, hue),
                )
                .map_err(|source| ExplorerEntityDriverError::Clothing {
                    wcid: template.wcid,
                    source,
                })?;
            }
            children.push(DynamicEntityDefinition::prepare(
                template_definition_input(
                    &template,
                    guid,
                    &content,
                    appearance,
                    EntityPlacement::Attached(held.attach_to(parent)),
                )?,
            )?);
        }
        Ok(children)
    }

    /// Despawns one exact current instance generation through the serialized driver.
    pub fn despawn(
        &self,
        guid: Guid,
        generation: u64,
    ) -> Result<ExplorerEntityDespawnOutcome, ExplorerEntityDriverError> {
        let _operation = self
            .operation
            .lock()
            .expect("Explorer entity driver lock poisoned");
        self.entities
            .despawn(guid, generation)
            .map_err(ExplorerEntityDriverError::from)
    }

    /// Applies one complete effective physics-state mask through shared transition decisions.
    pub fn replace_physics_state(
        &self,
        guid: Guid,
        generation: u64,
        semantic: PhysicsState,
        physical_intent: EntityPhysicalIntent,
    ) -> Result<ExplorerEntityPhysicsStateOutcome, ExplorerEntityDriverError> {
        let _operation = self
            .operation
            .lock()
            .expect("Explorer entity driver lock poisoned");
        let next = resolve_effective_entity_physics_state(semantic);
        if !next.supports_local_simulation() {
            let current = self.entities.instance(guid, generation)?;
            return Err(ExplorerEntityDriverError::Preparation(
                DynamicEntityPhysicalPreparationError::UnsupportedPhysicsState {
                    wcid: current.definition.identity.wcid,
                    state: semantic.bits(),
                    unsupported_bits: next.unsupported_local_simulation.bits(),
                    unknown_bits: next.unknown_bits,
                },
            ));
        }
        let decision = self
            .entities
            .plan_physics_state(guid, generation, next, physical_intent)?;
        let replacement = if matches!(
            decision.action,
            EntityPhysicalTransitionAction::EnableSolverParticipation
                | EntityPhysicalTransitionAction::Reconfigure
        ) {
            let mut definition = self.entities.instance(guid, generation)?.definition;
            definition.physics = next;
            Some(self.content.prepare_physical(&definition)?)
        } else {
            None
        };
        self.entities
            .replace_physics_state(guid, generation, next, physical_intent, replacement)
            .map_err(ExplorerEntityDriverError::from)
    }

    /// Resolves and applies one exact-generation catalog-speed launch.
    pub fn launch(
        &self,
        request: ExplorerEntityLaunchRequest,
    ) -> Result<ExplorerEntityLaunchOutcome, ExplorerEntityDriverError> {
        let _operation = self
            .operation
            .lock()
            .expect("Explorer entity driver lock poisoned");
        let instance = self.entities.instance(request.guid, request.generation)?;
        let launch = resolve_dynamic_entity_launch(&instance.definition, request.direction)?;
        self.entities
            .launch(request.guid, request.generation, launch, self.clock.now())
            .map_err(ExplorerEntityDriverError::from)
    }

    /// Host-resolves and applies one exact-generation discontinuous relocation.
    pub fn relocate(
        &self,
        request: ExplorerEntityRelocationRequest,
    ) -> Result<ExplorerEntityRelocationOutcome, ExplorerEntityDriverError> {
        let _operation = self
            .operation
            .lock()
            .expect("Explorer entity driver lock poisoned");
        let instance = self.entities.instance(request.guid, request.generation)?;
        let setup = self.content.prepare_setup(
            instance.definition.identity.wcid,
            instance.definition.content.setup_did,
            instance.definition.object_scale,
        )?;
        let candidate = candidate_pose(request.camera_pose, request.candidate, request.rotation)?;
        let pose = resolve_spawn_placement(
            &self.simulation.snapshot(),
            request.camera_pose,
            candidate,
            setup.movement_spheres.primary().center,
            setup.movement_spheres.primary().radius,
        )?;
        self.entities
            .relocate(request.guid, request.generation, pose, self.clock.now())
            .map_err(ExplorerEntityDriverError::from)
    }

    /// Clears every Explorer entity while preserving monotonic generation history.
    pub fn reset(&self) -> Result<(), ExplorerEntityDriverError> {
        let _operation = self
            .operation
            .lock()
            .expect("Explorer entity driver lock poisoned");
        self.entities.reset()?;
        Ok(())
    }
}

fn optional_f32(
    wcid: u32,
    field: &'static str,
    value: Option<f64>,
) -> Result<Option<f32>, ExplorerEntityDriverError> {
    value
        .map(|value| {
            let narrowed = value as f32;
            if !value.is_finite() || !narrowed.is_finite() {
                return Err(ExplorerEntityDriverError::InvalidScalar { wcid, field });
            }
            Ok(narrowed)
        })
        .transpose()
}

fn physics_input(template: &WeenieTemplate) -> EntityPhysicsStateInput {
    let overrides = &template.physics.overrides;
    EntityPhysicsStateInput {
        base: template
            .physics
            .base_mask
            .map(PhysicsState::from_bits_retain),
        overrides: EntityPhysicsStateOverrides {
            ethereal: overrides.ethereal,
            report_collisions: overrides.report_collisions,
            ignore_collisions: overrides.ignore_collisions,
            no_draw: overrides.no_draw,
            gravity: overrides.gravity,
            lighting: overrides.lighting,
            scripted_collision: overrides.scripted_collision,
            inelastic: overrides.inelastic,
            report_collisions_as_environment: overrides.report_collisions_as_environment,
            edge_slide: overrides.allow_edge_slide,
            frozen: overrides.frozen,
        },
    }
}

impl ExplorerEntityDriver {
    /// Assemble one entity's complete appearance the way an ACE server would before serializing.
    ///
    /// Order follows `Creature_Networking.CalculateObjDesc`: generated and authored body layers
    /// first, then worn equipment. When nothing worn paints this body, ACE falls back to the
    /// template's own ObjDesc rows, so we do the same.
    fn resolve_appearance(
        &self,
        guid: Guid,
        template: &WeenieTemplate,
        setup_did: u32,
    ) -> Result<ResolvedSpawnAppearance, ExplorerEntityDriverError> {
        let seed = u64::from(guid.0);
        // Only humanoids consult character generation; a crate never needs it, so its absence is
        // not an error for templates that resolve no heritage and gender.
        let mut appearance = if requires_character_generation(&template.appearance) {
            let char_gen = self.content.char_gen()?;
            resolve_template_appearance(
                template.palette_base_did,
                &template.appearance,
                &char_gen,
                seed,
                |set, hue| self.content.palette_set(set, hue),
            )
            .0
        } else {
            resolve_authored_appearance(template.palette_base_did, &template.appearance)
        };

        let wielded = select_wielded(&template.wielded, seed);
        let mut wielded_items = Vec::with_capacity(wielded.len());
        for entry in &wielded {
            let Some(item) = self.catalog.lookup(entry.wcid)? else {
                return Err(ExplorerEntityDriverError::MissingWieldedItem {
                    wcid: template.wcid,
                    item_wcid: entry.wcid,
                });
            };
            let item_facts = WieldedItem {
                wcid: item.wcid,
                clothing_base_did: item.appearance.clothing_base_did,
                classification: classify_wielded_item(WieldedItemSlotFacts {
                    valid_locations: item.appearance.valid_locations,
                    item_type: item.appearance.item_type,
                    default_combat_style: item.appearance.default_combat_style,
                })
                .map_err(|source| {
                    ExplorerEntityDriverError::EquipmentClassification {
                        wcid: template.wcid,
                        item_wcid: item.wcid,
                        source,
                    }
                })?,
                clothing_priority: item.appearance.clothing_priority,
                palette: ClothingPaletteSelection::overlay(entry, &item.appearance),
            };
            wielded_items.push(SelectedWieldedItem {
                template: item,
                item: item_facts,
            });
        }

        let items = wielded_items
            .iter()
            .map(|selected| selected.item)
            .collect::<Vec<_>>();
        // ACE's `eo`: the equipped objects that can cover the model at all
        // (`Creature_Networking.cs:127`). Membership is by wield slot, not by carrying a clothing
        // table; census 2026-08-22 found zero wield rows in a paintable slot whose item lacks a
        // `ClothingBase`, so the two readings coincide on shipped content.
        let equipped_paintable = items.iter().any(|item| {
            matches!(
                item.classification,
                Some(WieldedItemClassification::Painted(_))
            )
        });
        // ACE consults the template's own ObjDesc rows only when nothing paintable is equipped, and
        // returns immediately when it finds any (`Creature_Networking.cs:129-141`).
        let has_biota_rows = !template.sub_palettes.is_empty()
            || !template.texture_changes.is_empty()
            || !template.anim_part_changes.is_empty();
        if !equipped_paintable && has_biota_rows {
            append_template_obj_desc(&mut appearance, template);
            return Ok(ResolvedSpawnAppearance {
                wearer: appearance,
                wielded: wielded_items,
            });
        }

        let worn = resolve_worn_equipment(
            setup_did,
            &items,
            |clothing_base| self.content.clothing_table(clothing_base),
            |set, hue| self.content.palette_set(set, hue),
        )
        .map_err(|source| ExplorerEntityDriverError::Clothing {
            wcid: template.wcid,
            source,
        })?;

        match (worn.paints_body(), template.appearance.clothing_base_did) {
            // Nothing worn actually painted the body, so the wearer paints itself
            // (`Creature_Networking.cs:239` into `WorldObject_Networking.cs:916-973`). ACE also
            // discards the worn layer here; we simply never apply it, which is the same result for
            // every case this plan measured.
            (false, Some(clothing_base_did)) => apply_clothing_base(
                &mut appearance,
                setup_did,
                ClothingSource {
                    wcid: template.wcid,
                    clothing_base_did,
                    palette: ClothingPaletteSelection::from_own_properties(&template.appearance),
                },
                |clothing_base| self.content.clothing_table(clothing_base),
                |set, hue| self.content.palette_set(set, hue),
            )
            .map_err(|source| ExplorerEntityDriverError::Clothing {
                wcid: template.wcid,
                source,
            })?,
            _ => worn.apply(&mut appearance),
        }
        Ok(ResolvedSpawnAppearance {
            wearer: appearance,
            wielded: wielded_items,
        })
    }
}

fn append_template_obj_desc(appearance: &mut EntityAppearance, template: &WeenieTemplate) {
    let raw = EntityAppearance {
        palette_did: template.palette_base_did,
        sub_palettes: template
            .sub_palettes
            .iter()
            .map(|range| {
                EntitySubPalette::from_groups(
                    range.sub_palette_did,
                    u32::from(range.offset),
                    u32::from(range.length),
                )
            })
            .collect(),
        texture_changes: template
            .texture_changes
            .iter()
            .map(|change| EntityTextureChange {
                part_index: change.part_index,
                old_texture_did: change.old_texture_did,
                new_texture_did: change.new_texture_did,
            })
            .collect(),
        part_changes: template
            .anim_part_changes
            .iter()
            .map(|change| EntityPartChange {
                part_index: change.part_index,
                gfx_obj_did: change.animation_part_did,
            })
            .collect(),
    };
    if appearance.palette_did.is_none() {
        appearance.palette_did = raw.palette_did;
    }
    appearance.sub_palettes.extend(raw.sub_palettes);
    appearance.texture_changes.extend(raw.texture_changes);
    appearance.part_changes.extend(raw.part_changes);
}

fn candidate_pose(
    camera_pose: WorldPosition,
    candidate: Vector3,
    rotation: Quaternion,
) -> Result<WorldPosition, ExplorerEntityDriverError> {
    if camera_pose.landblock_id == Guid::NULL {
        return Err(ExplorerEntityDriverError::Placement(
            "Explorer entity candidate camera pose has no landblock".to_owned(),
        ));
    }
    WorldPosition {
        landblock_id: Guid(camera_pose.landblock_id.0 & 0xffff_0000),
        coords: candidate,
        rotation,
    }
    .normalize_outdoor_landblock_frame()
    .map_err(|error| ExplorerEntityDriverError::Placement(error.to_string()))
}

/// Once-derived template content facts shared by a wearer and each of its held children.
struct PreparedTemplateContent {
    /// Required authored setup identity.
    setup_did: u32,
    /// Authored default scale, or ACE's implicit 1.0.
    object_scale: f32,
    /// Setup-owned state facts and placement spheres.
    setup: DynamicEntitySetupPreparation,
    /// Complete effective physics composition.
    physics: EffectiveEntityPhysicsState,
}

/// Assembles the template-derived definition input identically for every placement arm.
fn template_definition_input(
    template: &WeenieTemplate,
    guid: Guid,
    content: &PreparedTemplateContent,
    appearance: EntityAppearance,
    placement: EntityPlacement<DynamicEntityInitialState>,
) -> Result<DynamicEntityDefinitionInput, ExplorerEntityDriverError> {
    Ok(DynamicEntityDefinitionInput {
        identity: DynamicEntityIdentity {
            guid,
            wcid: template.wcid,
            name: template
                .name
                .clone()
                .ok_or(ExplorerEntityDriverError::MissingName {
                    wcid: template.wcid,
                })?,
            weenie_type: WeenieType::from_repr(template.weenie_type).ok_or(
                ExplorerEntityDriverError::InvalidWeenieType {
                    wcid: template.wcid,
                    value: template.weenie_type,
                },
            )?,
        },
        content: DynamicEntityContent {
            setup_did: content.setup_did,
            motion_table_did: template.motion_table_did,
            sound_table_did: template.sound_table_did,
            physics_effect_table_did: template.physics_effect_table_did,
        },
        appearance,
        placement,
        object_scale: content.object_scale,
        friction: optional_f32(template.wcid, "friction", template.friction)?,
        elasticity: optional_f32(template.wcid, "elasticity", template.elasticity)?,
        maximum_velocity: optional_f32(
            template.wcid,
            "maximum velocity",
            template.maximum_velocity,
        )?,
        rotation_speed: optional_f32(template.wcid, "rotation speed", template.rotation_speed)?,
        physics: content.physics,
    })
}

fn resolve_spawn_placement(
    collision: &holtburger_world::CollisionScene,
    camera_pose: WorldPosition,
    mut candidate_pose: WorldPosition,
    local_sphere_center: Vector3,
    sphere_radius: f32,
) -> Result<WorldPosition, ExplorerEntityDriverError> {
    let anchor = Guid((candidate_pose.landblock_id.0 & 0xffff_0000) | 0xffff);
    let center = candidate_pose.coords + candidate_pose.rotation.rotate_vector(local_sphere_center);
    let placement = collision
        .transit_cell(CellTransitRequest {
            previous_cell: camera_pose.is_indoors().then_some(camera_pose.landblock_id),
            anchor,
            center,
            radius: sphere_radius,
        })
        .map_err(|error| ExplorerEntityDriverError::Placement(error.to_string()))?;
    candidate_pose.landblock_id = placement
        .committed_cell()
        .unwrap_or(candidate_pose.landblock_id);
    Ok(candidate_pose.normalize_outdoor_cell())
}

#[cfg(test)]
mod tests {
    use super::*;
    use anyhow::anyhow;
    use holtburger_common::Sphere;
    use holtburger_common::properties::{EquipMask, ItemType};
    use holtburger_common::{ParentLocation, Placement};
    use holtburger_content::{ColliderScale, LandblockCollisionAsset};
    use holtburger_weenie_catalog::WieldEntry;
    use holtburger_weenie_catalog::{PhysicsBoolOverrides, TemplatePhysics};
    use holtburger_world::{
        DynamicBodyCollisionDefinition, EdgeProtection, EntityCollisionParticipation,
        EntityCollisionReportPolicy, EntityDynamicCollisionPolicy, EntityPhysicsScheduling,
        EntityPhysicsSetupFacts, PhysicalBodyResponsePolicy, PhysicalElasticity, PhysicalFriction,
        PhysicalRestitution, PhysicalSphereSet, PhysicalSurfaceMotion, PhysicsAttachment,
        PreparedEntityTargetGeometry,
    };
    use std::collections::BTreeMap;

    #[derive(Default)]
    struct EmptyCollisionSource;

    impl crate::host_simulation_runtime::CollisionSource for EmptyCollisionSource {
        fn load_collision(
            &self,
            _landblock_id: u32,
        ) -> anyhow::Result<Option<LandblockCollisionAsset>> {
            Ok(None)
        }
    }

    struct FixedClock(Instant);

    impl ExplorerEntityClock for FixedClock {
        fn now(&self) -> Instant {
            self.0
        }
    }

    struct MemoryCatalog {
        templates: BTreeMap<u32, WeenieTemplate>,
    }

    impl ExplorerWeenieCatalogSource for MemoryCatalog {
        fn capability(&self) -> ExplorerCatalogCapability {
            ExplorerCatalogCapability::Available {
                path: "memory.hwc".into(),
                record_count: self.templates.len(),
            }
        }

        fn lookup(&self, wcid: u32) -> Result<Option<WeenieTemplate>, ExplorerCatalogLookupError> {
            Ok(self.templates.get(&wcid).cloned())
        }
    }

    /// Injected outcome of physical preparation, so each rejection reaches the driver by its own
    /// typed reason rather than one opaque failure flag.
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    enum FixturePhysical {
        /// Preparation succeeds and yields the ordinary grounded fixture body.
        Prepares,
        /// Generic DAT/content failure.
        FailsContent,
        /// The measured WCID 52077 boundary: a default animation moves physics-BSP parts.
        FailsAnimatedPhysicsBsp,
    }

    struct FixtureContent {
        physical: FixturePhysical,
        /// Absent by default so existing tests keep their bare-setup appearance.
        char_gen: Option<Arc<CharGen>>,
        /// Clothing tables keyed by `ClothingBase`, for the equipment merge.
        clothing: BTreeMap<u32, ClothingTable>,
    }

    impl ExplorerEntityContentPreparer for FixtureContent {
        fn prepare_setup(
            &self,
            _wcid: u32,
            _setup_did: u32,
            _object_scale: f32,
        ) -> Result<DynamicEntitySetupPreparation, DynamicEntityPhysicalPreparationError> {
            Ok(DynamicEntitySetupPreparation {
                physics: EntityPhysicsSetupFacts::default(),
                movement_spheres: PhysicalSphereSet::new(
                    Sphere {
                        center: Vector3::new(0.0, 0.0, 0.5),
                        radius: 0.5,
                    },
                    None,
                )
                .unwrap(),
            })
        }

        fn prepare_physical(
            &self,
            definition: &DynamicEntityDefinition,
        ) -> Result<DynamicPhysicalBodyDefinition, DynamicEntityPhysicalPreparationError> {
            match self.physical {
                FixturePhysical::Prepares => {}
                FixturePhysical::FailsContent => {
                    return Err(DynamicEntityPhysicalPreparationError::Content {
                        wcid: definition.identity.wcid,
                        resource_did: definition.content.setup_did,
                        source: anyhow!("injected physical preparation failure"),
                    });
                }
                FixturePhysical::FailsAnimatedPhysicsBsp => {
                    return Err(DynamicEntityPhysicalPreparationError::AnimatedPhysicsBsp {
                        wcid: definition.identity.wcid,
                        setup_did: definition.content.setup_did,
                        animation_did: 0x0300_0227,
                        moving_part_indices: vec![3],
                    });
                }
            }
            let mut physical = physical();
            physical.entity_collision.scheduling = definition.physics.scheduling;
            physical.entity_collision.dynamic_collision = definition.physics.dynamic_collision;
            physical.entity_collision.reporting = definition.physics.reporting;
            physical.entity_collision.uses_physics_bsp = definition.physics.uses_physics_bsp;
            Ok(physical)
        }

        fn char_gen(&self) -> Result<Arc<CharGen>, ExplorerAppearanceContentError> {
            self.char_gen.clone().ok_or_else(|| {
                ExplorerAppearanceContentError::CharGenUnavailable {
                    reason: "fixture supplies no character generation table".to_owned(),
                }
            })
        }

        fn palette_set(&self, palette_set_did: u32, hue: f64) -> Option<u32> {
            // Deterministic synthetic palette so a test can attribute a layer to its source set.
            Some(palette_set_did ^ ((hue * 1024.0) as u32))
        }

        fn clothing_table(&self, clothing_base_did: u32) -> Option<ClothingTable> {
            self.clothing.get(&clothing_base_did).cloned()
        }
    }

    fn physical() -> DynamicPhysicalBodyDefinition {
        let response_policy = PhysicalBodyResponsePolicy {
            restitution: PhysicalRestitution::Elastic(PhysicalElasticity::DEFAULT),
            friction: PhysicalFriction::DEFAULT,
            surface_motion: PhysicalSurfaceMotion::Stable,
            align_path: false,
        };
        let movement = holtburger_core::retail_grounded_body_with_policy(
            PhysicalSphereSet::new(
                Sphere {
                    center: Vector3::new(0.0, 0.0, 0.5),
                    radius: 0.5,
                },
                None,
            )
            .unwrap(),
            EdgeProtection::Creature,
            -9.8,
            response_policy,
        )
        .unwrap()
        .definition;
        DynamicPhysicalBodyDefinition {
            movement,
            response_policy,
            entity_collision: DynamicBodyCollisionDefinition {
                target_geometry: PreparedEntityTargetGeometry {
                    physics_bsp_parts: Vec::new(),
                    fallback_setup_did: 0x0200_0001,
                    fallback_shapes: Vec::new(),
                    fallback_scale: ColliderScale::uniform(1.0).unwrap(),
                },
                scheduling: EntityPhysicsScheduling::Eligible,
                dynamic_collision: EntityDynamicCollisionPolicy {
                    target: EntityCollisionParticipation::Solid,
                    mover_accepts_response: true,
                    accepts_peer_reports: true,
                    missile: false,
                    path_clipped: false,
                },
                reporting: EntityCollisionReportPolicy {
                    enabled: false,
                    as_environment: false,
                },
                uses_physics_bsp: false,
                weenie_type: WeenieType::Creature,
                elasticity: PhysicalElasticity::DEFAULT,
                default_animation_available: false,
                default_script_available: false,
            },
        }
    }

    fn template(wcid: u32) -> WeenieTemplate {
        WeenieTemplate {
            wcid,
            class_name: format!("class_{wcid}"),
            weenie_type: WeenieType::Creature as i32,
            name: Some(format!("Template {wcid}")),
            setup_did: Some(0x0200_0001),
            motion_table_did: Some(0x0900_0001),
            sound_table_did: None,
            physics_effect_table_did: None,
            palette_base_did: None,
            default_scale: None,
            friction: None,
            elasticity: None,
            maximum_velocity: None,
            rotation_speed: None,
            appearance: Default::default(),
            wielded: Vec::new(),
            physics: TemplatePhysics {
                base_mask: Some(PhysicsState::GRAVITY.bits()),
                overrides: PhysicsBoolOverrides::default(),
            },
            sub_palettes: Vec::new(),
            texture_changes: Vec::new(),
            anim_part_changes: Vec::new(),
        }
    }

    fn driver(
        templates: Vec<WeenieTemplate>,
        physical: FixturePhysical,
    ) -> (Arc<ExplorerEntityRuntime>, ExplorerEntityDriver) {
        driver_with_catalog(
            Arc::new(MemoryCatalog {
                templates: templates
                    .into_iter()
                    .map(|template| (template.wcid, template))
                    .collect(),
            }),
            physical,
        )
    }

    /// Driver whose content supplies a synthetic CharGen and one shirt clothing table, so
    /// appearance resolution runs for real without touching mounted DAT content.
    fn driver_with_appearance(
        templates: Vec<WeenieTemplate>,
    ) -> (Arc<ExplorerEntityRuntime>, ExplorerEntityDriver) {
        use crate::weenie_appearance::test_support::{
            clothing_with_palette_template, pure_recolour_clothing, synthetic_char_gen,
            synthetic_clothing,
        };

        let simulation = Arc::new(HostSimulationRuntime::new(Arc::new(EmptyCollisionSource)));
        let entities = Arc::new(ExplorerEntityRuntime::new(
            Arc::clone(&simulation),
            Default::default(),
            crate::explorer_possession_control::ExplorerPossessionControlProfile::standard()
                .expect("standard Explorer possession profile is valid"),
        ));
        let mut clothing = BTreeMap::new();
        clothing.insert(0x1000_0001, synthetic_clothing(0x0200_0001));
        clothing.insert(0x1000_0002, synthetic_clothing(0x0200_0002));
        // Paints a chest part and offers template 61, so it both covers and recolours.
        clothing.insert(
            0x1000_0003,
            clothing_with_palette_template(0x0200_0001, 61, 0x0F00_0001),
        );
        // The rabbit's shape: recolours through template 61 while painting no body part.
        clothing.insert(
            0x1000_0004,
            pure_recolour_clothing(0x0200_0001, 61, 0x0F00_0001),
        );
        let driver = ExplorerEntityDriver::new(
            Arc::new(MemoryCatalog {
                templates: templates
                    .into_iter()
                    .map(|template| (template.wcid, template))
                    .collect(),
            }),
            Arc::new(FixtureContent {
                physical: FixturePhysical::Prepares,
                char_gen: Some(Arc::new(synthetic_char_gen())),
                clothing,
            }),
            Arc::new(FixedClock(Instant::now())),
            Arc::clone(&entities),
            simulation,
        );
        (entities, driver)
    }

    fn driver_with_catalog(
        catalog: Arc<dyn ExplorerWeenieCatalogSource>,
        physical: FixturePhysical,
    ) -> (Arc<ExplorerEntityRuntime>, ExplorerEntityDriver) {
        let simulation = Arc::new(HostSimulationRuntime::new(Arc::new(EmptyCollisionSource)));
        let entities = Arc::new(ExplorerEntityRuntime::new(
            Arc::clone(&simulation),
            Default::default(),
            crate::explorer_possession_control::ExplorerPossessionControlProfile::standard()
                .expect("standard Explorer possession profile is valid"),
        ));
        let driver = ExplorerEntityDriver::new(
            catalog,
            Arc::new(FixtureContent {
                physical,
                char_gen: None,
                clothing: BTreeMap::new(),
            }),
            Arc::new(FixedClock(Instant::now())),
            Arc::clone(&entities),
            simulation,
        );
        (entities, driver)
    }

    fn request(wcid: u32, intent: EntityPhysicalIntent) -> ExplorerEntitySpawnRequest {
        ExplorerEntitySpawnRequest {
            wcid,
            camera_pose: WorldPosition {
                landblock_id: Guid(0xda55_0020),
                coords: Vector3::new(96.0, 96.0, 10.0),
                rotation: Quaternion::identity(),
            },
            candidate: Vector3::new(200.0, 96.0, 10.0),
            rotation: Quaternion::identity(),
            physical_intent: intent,
        }
    }

    #[test]
    fn missing_wcid_and_preparation_failure_leave_no_entity_or_body() {
        let (entities, driver) = driver(vec![template(7)], FixturePhysical::FailsContent);
        assert!(matches!(
            driver.spawn_by_wcid(request(8, EntityPhysicalIntent::Simulated)),
            Err(ExplorerEntityDriverError::MissingWcid { wcid: 8 })
        ));
        assert!(matches!(
            driver.spawn_by_wcid(request(7, EntityPhysicalIntent::Simulated)),
            Err(ExplorerEntityDriverError::Preparation(_))
        ));
        assert!(entities.snapshot().unwrap().is_empty());
    }

    #[test]
    fn repeated_wcid_spawns_are_equal_except_for_identity_and_keep_host_placement() {
        let (entities, driver) = driver(vec![template(42)], FixturePhysical::Prepares);
        let first = driver
            .spawn_by_wcid(request(42, EntityPhysicalIntent::Simulated))
            .unwrap();
        let second = driver
            .spawn_by_wcid(request(42, EntityPhysicalIntent::Simulated))
            .unwrap();

        assert_ne!(
            first.instance.definition.identity.guid,
            second.instance.definition.identity.guid
        );
        let mut normalized_definition = second.instance.definition.clone();
        normalized_definition.identity.guid = first.instance.definition.identity.guid;
        assert_eq!(first.instance.definition, normalized_definition);
        let mut normalized_body = second.body.clone();
        normalized_body.body.body_id = first.body.body.body_id;
        assert_eq!(first.body, normalized_body);
        assert_eq!(
            first.body.body.runtime_pose.landblock_id,
            Guid(0xdb55_0005),
            "host must normalize the candidate into its eastern landblock"
        );
        assert_eq!(entities.snapshot().unwrap().len(), 2);
        let delivery =
            crate::explorer_entity_delivery::ExplorerEntityDelivery::new(Arc::clone(&entities));
        let snapshot = delivery.snapshot().unwrap();
        assert_eq!(
            snapshot
                .entities
                .iter()
                .map(|entity| entity.identity.guid)
                .collect::<Vec<_>>(),
            vec![
                first.instance.definition.identity.guid,
                second.instance.definition.identity.guid
            ]
        );
        let wire = serde_json::to_value(
            crate::explorer_entity_delivery::ExplorerEntityDelivery::new(Arc::clone(&entities))
                .snapshot_event()
                .unwrap(),
        )
        .unwrap();
        assert_eq!(wire["kind"], "snapshot");
        assert_eq!(
            wire["snapshot"]["entities"][0]["placement"]["pose"]["landblockId"],
            first.body.body.runtime_pose.landblock_id.0
        );
    }

    #[test]
    fn launch_applies_catalog_speed_and_spin_without_invalidating_pose_only_spawns() {
        let mut flame_bolt = template(239);
        flame_bolt.maximum_velocity = Some(15.0);
        let mut whirling_blade = template(300);
        whirling_blade.maximum_velocity = Some(15.0);
        whirling_blade.rotation_speed = Some(2.0);
        whirling_blade.physics.base_mask =
            Some((PhysicsState::GRAVITY | PhysicsState::ALIGN_PATH).bits());
        let mut rockfall = template(301);
        rockfall.maximum_velocity = Some(0.0);
        let gem_setting = template(302);
        let (entities, driver) = driver(
            vec![flame_bolt, whirling_blade, rockfall, gem_setting],
            FixturePhysical::Prepares,
        );

        let flame = driver
            .spawn_by_wcid(request(239, EntityPhysicalIntent::Simulated))
            .unwrap();
        let flame_launch = driver
            .launch(ExplorerEntityLaunchRequest {
                guid: flame.instance.definition.identity.guid,
                generation: flame.instance.generation,
                direction: Vector3::new(3.0, 4.0, 0.0),
            })
            .unwrap();
        assert_eq!(flame_launch.body.velocity, Vector3::new(9.0, 12.0, 0.0));

        let blade = driver
            .spawn_by_wcid(request(300, EntityPhysicalIntent::Simulated))
            .unwrap();
        let blade_launch = driver
            .launch(ExplorerEntityLaunchRequest {
                guid: blade.instance.definition.identity.guid,
                generation: blade.instance.generation,
                direction: Vector3::new(1.0, 0.0, 0.0),
            })
            .unwrap();
        assert_eq!(
            blade_launch.body.omega,
            Vector3::new(2.0 * std::f32::consts::TAU, 0.0, 0.0)
        );
        assert!(
            !blade_launch
                .instance
                .definition
                .physics
                .semantic
                .contains(PhysicsState::ALIGN_PATH)
        );

        for (wcid, expected) in [
            (301, DynamicEntityLaunchError::ZeroMaximumVelocity),
            (302, DynamicEntityLaunchError::MissingMaximumVelocity),
        ] {
            let spawned = driver
                .spawn_by_wcid(request(wcid, EntityPhysicalIntent::PoseOnly))
                .unwrap();
            assert!(matches!(
                driver.launch(ExplorerEntityLaunchRequest {
                    guid: spawned.instance.definition.identity.guid,
                    generation: spawned.instance.generation,
                    direction: Vector3::new(1.0, 0.0, 0.0),
                }),
                Err(ExplorerEntityDriverError::Launch(actual)) if actual == expected
            ));
            assert_eq!(
                entities
                    .instance(
                        spawned.instance.definition.identity.guid,
                        spawned.instance.generation,
                    )
                    .unwrap(),
                spawned.instance
            );
        }
    }

    #[test]
    fn relocation_preserves_generation_and_publishes_an_explicit_snap_kind() {
        let mut launchable = template(239);
        launchable.maximum_velocity = Some(15.0);
        let (entities, driver) = driver(vec![launchable], FixturePhysical::Prepares);
        let spawned = driver
            .spawn_by_wcid(request(239, EntityPhysicalIntent::Simulated))
            .unwrap();
        let guid = spawned.instance.definition.identity.guid;
        driver
            .launch(ExplorerEntityLaunchRequest {
                guid,
                generation: spawned.instance.generation,
                direction: Vector3::new(1.0, 0.0, 0.0),
            })
            .unwrap();
        let relocation = ExplorerEntityRelocationRequest {
            guid,
            generation: spawned.instance.generation,
            camera_pose: request(239, EntityPhysicalIntent::Simulated).camera_pose,
            candidate: Vector3::new(10.0, 20.0, 30.0),
            rotation: Quaternion::identity(),
            kind: ExplorerEntityRelocationKind::Teleport,
        };

        let relocated = driver.relocate(relocation).unwrap();

        assert_eq!(relocated.instance.generation, spawned.instance.generation);
        assert_eq!(relocated.body.runtime_pose.coords, relocation.candidate);
        assert_eq!(relocated.body.velocity, Vector3::zero());
        assert_eq!(relocated.body.acceleration, Vector3::zero());
        assert_eq!(relocated.body.omega, Vector3::zero());
        let correction = crate::explorer_entity_delivery::ExplorerEntityDelivery::new(entities)
            .corrected(guid, relocation.kind.advance_kind())
            .unwrap();
        let wire = serde_json::to_value(correction).unwrap();
        assert_eq!(wire["kind"], "advanced");
        assert_eq!(wire["batch"]["durationMs"], 0.0);
        assert_eq!(wire["batch"]["advances"][0]["kind"], "teleport");
        assert_eq!(
            wire["batch"]["advances"][0]["path"]["legs"][0]["end"]["pose"]["coords"]["x"],
            10.0
        );
    }

    #[test]
    fn catalog_backed_replacement_retains_guid_and_retires_the_exact_generation() {
        let (entities, driver) =
            driver(vec![template(42), template(43)], FixturePhysical::Prepares);
        let first = driver
            .spawn_by_wcid(request(42, EntityPhysicalIntent::Simulated))
            .unwrap();
        let guid = first.instance.definition.identity.guid;
        let replaced = driver
            .replace_by_wcid(ExplorerEntityReplaceRequest {
                guid,
                generation: first.instance.generation,
                replacement: request(43, EntityPhysicalIntent::PoseOnly),
            })
            .unwrap();

        assert_eq!(replaced.removed, first.instance);
        assert_eq!(replaced.installed.definition.identity.guid, guid);
        assert_eq!(replaced.installed.definition.identity.wcid, 43);
        assert_ne!(replaced.installed.generation, replaced.removed.generation);
        assert_eq!(
            replaced.body.installed.participation,
            holtburger_world::PhysicalBodyParticipation::PoseOnly
        );
        assert_eq!(entities.snapshot().unwrap().len(), 1);
        assert!(matches!(
            driver.despawn(guid, first.instance.generation),
            Err(ExplorerEntityDriverError::Runtime(
                ExplorerEntityRuntimeError::StaleGeneration { .. }
            ))
        ));
    }

    #[test]
    fn pose_only_spawn_and_exact_generation_despawn_use_the_same_driver() {
        let (entities, driver) = driver(vec![template(9)], FixturePhysical::Prepares);
        let spawned = driver
            .spawn_by_wcid(request(9, EntityPhysicalIntent::PoseOnly))
            .unwrap();
        assert_eq!(
            spawned.body.participation,
            holtburger_world::PhysicalBodyParticipation::PoseOnly
        );
        driver
            .despawn(
                spawned.instance.definition.identity.guid,
                spawned.instance.generation,
            )
            .unwrap();
        assert!(entities.snapshot().unwrap().is_empty());
    }

    #[test]
    fn invalid_type_is_rejected_before_registry_publication() {
        let mut invalid = template(10);
        invalid.weenie_type = 999;
        let (entities, driver) = driver(vec![invalid], FixturePhysical::Prepares);
        assert!(matches!(
            driver.spawn_by_wcid(request(10, EntityPhysicalIntent::PoseOnly)),
            Err(ExplorerEntityDriverError::InvalidWeenieType {
                wcid: 10,
                value: 999
            })
        ));
        assert!(entities.snapshot().unwrap().is_empty());
    }

    #[test]
    fn complete_physics_state_replacement_enables_reconfigures_and_disables_participation() {
        let (_entities, driver) = driver(vec![template(12)], FixturePhysical::Prepares);
        let spawned = driver
            .spawn_by_wcid(request(12, EntityPhysicalIntent::PoseOnly))
            .unwrap();
        let guid = spawned.instance.definition.identity.guid;
        let generation = spawned.instance.generation;

        let enabled = driver
            .replace_physics_state(
                guid,
                generation,
                PhysicsState::GRAVITY,
                EntityPhysicalIntent::Simulated,
            )
            .unwrap();
        assert_eq!(
            enabled.body.physical_change.change,
            holtburger_world::PhysicalBodyReconfiguration::SolverParticipationEnabled
        );
        let reconfigured = driver
            .replace_physics_state(
                guid,
                generation,
                PhysicsState::GRAVITY | PhysicsState::FROZEN,
                EntityPhysicalIntent::Simulated,
            )
            .unwrap();
        assert_eq!(
            reconfigured.body.physical_change.change,
            holtburger_world::PhysicalBodyReconfiguration::Reconfigured
        );
        let disabled = driver
            .replace_physics_state(
                guid,
                generation,
                PhysicsState::GRAVITY | PhysicsState::FROZEN,
                EntityPhysicalIntent::PoseOnly,
            )
            .unwrap();
        assert_eq!(
            disabled.body.physical_change.change,
            holtburger_world::PhysicalBodyReconfiguration::SolverParticipationDisabled
        );
        assert_eq!(
            disabled.instance.physical_intent,
            EntityPhysicalIntent::PoseOnly
        );
    }

    #[test]
    fn lifecycle_body_errors_remain_typed() {
        let (_entities, driver) = driver(vec![template(11)], FixturePhysical::Prepares);
        let error = driver.despawn(Guid(0xf000_0001), 1).unwrap_err();
        assert!(matches!(
            error,
            ExplorerEntityDriverError::Runtime(ExplorerEntityRuntimeError::NotRegistered { .. })
        ));
    }

    /// The measured WCID 52077 boundary. Moving physics-BSP geometry has no supported target
    /// representation, so solver participation must be refused at both entry points while the
    /// template stays a valid pose-only visual.
    #[test]
    fn animated_physics_bsp_rejects_solver_participation_but_remains_a_valid_visual() {
        let (entities, driver) = driver(
            vec![template(52077)],
            FixturePhysical::FailsAnimatedPhysicsBsp,
        );

        let simulated = driver
            .spawn_by_wcid(request(52077, EntityPhysicalIntent::Simulated))
            .unwrap_err();
        assert!(
            matches!(
                simulated,
                ExplorerEntityDriverError::Preparation(
                    DynamicEntityPhysicalPreparationError::AnimatedPhysicsBsp { wcid, .. }
                ) if wcid == 52077
            ),
            "simulated spawn must name the moving physics-BSP reason, got {simulated:?}"
        );
        assert!(
            entities.snapshot().unwrap().is_empty(),
            "a rejected solver spawn must not leave a registry or body record"
        );

        // The same template still realizes as a pose-only entity: the rejection is about local
        // physical simulation, not about the object existing or animating.
        let visual = driver
            .spawn_by_wcid(request(52077, EntityPhysicalIntent::PoseOnly))
            .unwrap();
        assert_eq!(
            visual.body.participation,
            holtburger_world::PhysicalBodyParticipation::PoseOnly
        );
        assert_eq!(entities.snapshot().unwrap().len(), 1);

        // Later solver enablement rejects with the same typed reason and leaves the live pose-only
        // entity untouched, so a failed upgrade cannot strand a half-physical instance.
        let upgrade = driver
            .replace_physics_state(
                visual.instance.definition.identity.guid,
                visual.instance.generation,
                PhysicsState::GRAVITY,
                EntityPhysicalIntent::Simulated,
            )
            .unwrap_err();
        assert!(
            matches!(
                upgrade,
                ExplorerEntityDriverError::Preparation(
                    DynamicEntityPhysicalPreparationError::AnimatedPhysicsBsp { wcid, .. }
                ) if wcid == 52077
            ),
            "later solver enablement must reject for the same reason, got {upgrade:?}"
        );
        let survivor = entities.snapshot().unwrap();
        assert_eq!(survivor.len(), 1, "the pose-only entity must survive");
        assert_eq!(
            survivor[0].input.placement.world().unwrap().participation,
            holtburger_world::PhysicalBodyParticipation::PoseOnly
        );
    }

    /// The White Rabbit case: a weenie wearing nothing paints itself through its own
    /// `ClothingBase`, which is ACE's base `CalculateObjDesc` reached from
    /// `Creature_Networking.cs:239`. Census 2026-08-22: 12,331 shipped weenies carry the facts this
    /// path reads.
    #[test]
    fn a_weenie_that_wears_nothing_paints_itself_through_its_own_clothing_base() {
        let mut rabbit = template(2568);
        rabbit.appearance.clothing_base_did = Some(0x1000_0004);
        rabbit.appearance.palette_template = Some(61);
        rabbit.appearance.shade = Some(0.5);

        let (_entities, driver) = driver_with_appearance(vec![rabbit]);
        let spawned = driver
            .spawn_by_wcid(request(2568, EntityPhysicalIntent::PoseOnly))
            .unwrap();

        assert!(
            !spawned
                .instance
                .definition
                .appearance
                .sub_palettes
                .is_empty(),
            "the weenie's own ClothingBase must recolour it"
        );
    }

    /// The Black Rabbit invariant: the same clothing base with no authored template or shade paints
    /// no palette. Retail selects nothing for a zero key (`acclient.c:444343`), and 1,479 shipped
    /// weenies carry a `ClothingBase` with neither property.
    #[test]
    fn a_weenie_authoring_no_palette_facts_keeps_its_base_palette() {
        let mut rabbit = template(2566);
        rabbit.appearance.clothing_base_did = Some(0x1000_0004);

        let (_entities, driver) = driver_with_appearance(vec![rabbit]);
        let spawned = driver
            .spawn_by_wcid(request(2566, EntityPhysicalIntent::PoseOnly))
            .unwrap();

        assert!(
            spawned
                .instance
                .definition
                .appearance
                .sub_palettes
                .is_empty(),
            "an unauthored palette template must select nothing"
        );
    }

    /// Worn equipment that paints a body part suppresses the wearer's own clothing base, exactly as
    /// ACE only falls back to the base path when its coverage set is empty.
    #[test]
    fn worn_equipment_that_paints_suppresses_the_wearers_own_clothing_base() {
        let mut wearer = template(3921);
        wearer.appearance.clothing_base_did = Some(0x1000_0004);
        wearer.appearance.palette_template = Some(61);
        wearer.appearance.shade = Some(0.5);
        wearer.wielded = vec![WieldEntry {
            wcid: 130,
            destination_type: 2,
            palette_template: 0,
            shade: 0.0,
        }];
        let mut shirt = template(130);
        shirt.appearance.clothing_base_did = Some(0x1000_0001);
        shirt.appearance.item_type = Some(ItemType::CLOTHING.bits() as i32);
        shirt.appearance.valid_locations = Some(0x1E);

        let (_entities, driver) = driver_with_appearance(vec![wearer, shirt]);
        let spawned = driver
            .spawn_by_wcid(request(3921, EntityPhysicalIntent::PoseOnly))
            .unwrap();
        let appearance = &spawned.instance.definition.appearance;

        // The shirt paints a part; `synthetic_clothing` defines no palette template, so the only
        // way a subpalette could appear here is the wearer's own clothing base leaking through.
        assert!(!appearance.part_changes.is_empty());
        assert!(
            appearance.sub_palettes.is_empty(),
            "a painted body must not also apply the wearer's own clothing base"
        );
    }

    /// Worn equipment that only recolours paints no body part, so ACE's coverage set stays empty and
    /// the wearer's own clothing base still applies. This is the distinction between what was worn
    /// and what was painted.
    #[test]
    fn worn_equipment_that_paints_nothing_yields_to_the_wearers_own_clothing_base() {
        let mut wearer = template(3921);
        wearer.appearance.clothing_base_did = Some(0x1000_0003);
        wearer.appearance.palette_template = Some(61);
        wearer.appearance.shade = Some(0.5);
        wearer.wielded = vec![WieldEntry {
            wcid: 130,
            destination_type: 2,
            palette_template: 0,
            shade: 0.0,
        }];
        let mut shirt = template(130);
        // A pure recolour: dresses this body, paints no part.
        shirt.appearance.clothing_base_did = Some(0x1000_0004);
        shirt.appearance.item_type = Some(ItemType::CLOTHING.bits() as i32);
        shirt.appearance.valid_locations = Some(0x1E);

        let (_entities, driver) = driver_with_appearance(vec![wearer, shirt]);
        let spawned = driver
            .spawn_by_wcid(request(3921, EntityPhysicalIntent::PoseOnly))
            .unwrap();
        let appearance = &spawned.instance.definition.appearance;

        assert!(
            appearance
                .part_changes
                .iter()
                .any(|change| change.part_index != 0x10),
            "the wearer's own clothing base painted its body"
        );
    }

    /// A humanoid spawn resolves a full face and its worn outfit; the same GUID reproduces both.
    #[test]
    fn humanoid_spawn_resolves_a_seeded_face_and_its_worn_outfit() {
        let mut collector = template(3921);
        collector.appearance.heritage_group_name = Some("Gharu'ndim".to_owned());
        collector.appearance.sex = Some("Male".to_owned());
        collector.wielded = vec![WieldEntry {
            wcid: 130,
            destination_type: 2,
            palette_template: 5,
            shade: 0.67,
        }];
        let mut shirt = template(130);
        shirt.appearance.clothing_base_did = Some(0x1000_0001);
        // WCID 130's own ACE properties: ItemType::Clothing, chest and arm Wear slots.
        shirt.appearance.item_type = Some(ItemType::CLOTHING.bits() as i32);
        shirt.appearance.valid_locations = Some(0x1E);

        let (entities, driver) = driver_with_appearance(vec![collector, shirt]);
        let spawned = driver
            .spawn_by_wcid(request(3921, EntityPhysicalIntent::PoseOnly))
            .unwrap();
        let appearance = &spawned.instance.definition.appearance;

        // Generated body layers land at ACE's skin, hair, and eye ranges, expanded into the color
        // units this contract carries. ACE authors those three offsets packed (0x0, 0x18, 0x20),
        // so asserting the packed values here would accept a missing expansion.
        for offset_groups in [0x0_u32, 0x18, 0x20] {
            let offset = offset_groups * EntitySubPalette::GROUP_COLORS;
            assert!(
                appearance
                    .sub_palettes
                    .iter()
                    .any(|entry| entry.offset == offset),
                "expected a generated palette layer at color offset {offset}"
            );
        }
        // The worn shirt painted the body on top of the face.
        assert!(
            appearance
                .texture_changes
                .iter()
                .any(|change| change.part_index != 0x10),
            "worn clothing must paint a non-head part"
        );

        // Same identity, same appearance.
        let repeat = driver_with_appearance(vec![
            {
                let mut again = template(3921);
                again.appearance.heritage_group_name = Some("Gharu'ndim".to_owned());
                again.appearance.sex = Some("Male".to_owned());
                again.wielded = vec![WieldEntry {
                    wcid: 130,
                    destination_type: 2,
                    palette_template: 5,
                    shade: 0.67,
                }];
                again
            },
            {
                let mut again = template(130);
                again.appearance.clothing_base_did = Some(0x1000_0001);
                again.appearance.item_type = Some(ItemType::CLOTHING.bits() as i32);
                again.appearance.valid_locations = Some(0x1E);
                again
            },
        ]);
        let second = repeat
            .1
            .spawn_by_wcid(request(3921, EntityPhysicalIntent::PoseOnly))
            .unwrap();
        assert_eq!(
            &second.instance.definition.appearance, appearance,
            "the same GUID must reproduce the same appearance"
        );
        assert_eq!(entities.snapshot().unwrap().len(), 1);
    }

    /// A held item is a separate bodyless entity. Its CLO is evaluated against the item's own
    /// setup; applying it to the wearer would silently erase the weapon model substitution.
    #[test]
    fn held_item_uses_its_own_setup_appearance_and_attaches_to_the_wearer() {
        let mut wearer = template(3921);
        wearer.wielded = vec![WieldEntry {
            wcid: 359,
            destination_type: 2,
            palette_template: 0,
            shade: 0.0,
        }];
        let mut sword = template(359);
        sword.weenie_type = WeenieType::MeleeWeapon as i32;
        sword.setup_did = Some(0x0200_0002);
        sword.appearance.clothing_base_did = Some(0x1000_0002);
        sword.appearance.item_type = Some(ItemType::MELEE_WEAPON.bits() as i32);
        sword.appearance.valid_locations = Some(EquipMask::MELEE_WEAPON.bits() as i32);

        let (entities, driver) = driver_with_appearance(vec![wearer, sword]);
        let spawned = driver
            .spawn_by_wcid(request(3921, EntityPhysicalIntent::PoseOnly))
            .unwrap();

        assert_eq!(spawned.children.len(), 1);
        let child = &spawned.children[0];
        assert_eq!(child.definition.identity.wcid, 359);
        assert_eq!(child.definition.content.setup_did, 0x0200_0002);
        assert_eq!(
            child.definition.placement.attachment().copied(),
            Some(PhysicsAttachment {
                parent: spawned.instance.definition.identity.guid,
                location: ParentLocation::RightHand,
                placement: Placement::RightHandCombat,
            })
        );
        assert!(
            child
                .definition
                .appearance
                .part_changes
                .iter()
                .any(|change| change.part_index != 0x10),
            "the held item's CLO must paint its own setup"
        );
        assert!(
            spawned
                .instance
                .definition
                .appearance
                .part_changes
                .is_empty(),
            "the held item's CLO must not paint the wearer"
        );
        assert_eq!(entities.snapshot().unwrap().len(), 2);
    }

    /// A non-humanoid never consults character generation, so a mount without it still spawns.
    #[test]
    fn non_humanoid_spawns_without_character_generation() {
        let (_entities, driver) = driver(vec![template(147)], FixturePhysical::Prepares);

        let spawned = driver
            .spawn_by_wcid(request(147, EntityPhysicalIntent::PoseOnly))
            .unwrap();

        assert!(
            spawned
                .instance
                .definition
                .appearance
                .texture_changes
                .is_empty()
        );
    }

    /// A humanoid whose mount lacks character generation fails loudly rather than spawning bare.
    #[test]
    fn humanoid_without_character_generation_fails_loudly() {
        let mut humanoid = template(3922);
        humanoid.appearance.heritage_group_name = Some("Gharu'ndim".to_owned());
        humanoid.appearance.sex = Some("Male".to_owned());
        let (entities, driver) = driver(vec![humanoid], FixturePhysical::Prepares);

        let error = driver
            .spawn_by_wcid(request(3922, EntityPhysicalIntent::PoseOnly))
            .unwrap_err();

        assert!(matches!(
            error,
            ExplorerEntityDriverError::AppearanceContent(
                ExplorerAppearanceContentError::CharGenUnavailable { .. }
            )
        ));
        assert!(entities.snapshot().unwrap().is_empty());
    }

    /// A wielded item missing from the catalog is a content fault naming both weenies.
    #[test]
    fn missing_wielded_item_names_wearer_and_item() {
        let mut wearer = template(3921);
        wearer.wielded = vec![WieldEntry {
            wcid: 9999,
            destination_type: 2,
            palette_template: 0,
            shade: 0.0,
        }];
        let (_entities, driver) = driver_with_appearance(vec![wearer]);

        let error = driver
            .spawn_by_wcid(request(3921, EntityPhysicalIntent::PoseOnly))
            .unwrap_err();

        assert!(matches!(
            error,
            ExplorerEntityDriverError::MissingWieldedItem {
                wcid: 3921,
                item_wcid: 9999
            }
        ));
        assert!(error.to_string().contains("9999"));
    }

    /// An absent catalog is a capability boundary, not a spawn that silently produces nothing.
    #[test]
    fn unavailable_catalog_reports_its_reason_and_refuses_every_spawn() {
        use crate::explorer_weenie_catalog::ExplorerCatalogUnavailableKind;

        struct UnavailableCatalog;

        impl ExplorerWeenieCatalogSource for UnavailableCatalog {
            fn capability(&self) -> ExplorerCatalogCapability {
                ExplorerCatalogCapability::Unavailable {
                    path: None,
                    kind: ExplorerCatalogUnavailableKind::MissingContentLocation,
                    reason: "no weenie catalog beside the selected content".to_owned(),
                }
            }

            fn lookup(
                &self,
                _wcid: u32,
            ) -> Result<Option<WeenieTemplate>, ExplorerCatalogLookupError> {
                Err(ExplorerCatalogLookupError::Unavailable {
                    reason: "no weenie catalog beside the selected content".to_owned(),
                })
            }
        }

        let (entities, driver) =
            driver_with_catalog(Arc::new(UnavailableCatalog), FixturePhysical::Prepares);

        assert!(matches!(
            driver.catalog_capability(),
            ExplorerCatalogCapability::Unavailable { .. }
        ));
        let error = driver
            .spawn_by_wcid(request(1, EntityPhysicalIntent::Simulated))
            .unwrap_err();
        assert!(
            matches!(
                error,
                ExplorerEntityDriverError::Catalog(ExplorerCatalogLookupError::Unavailable { .. })
            ),
            "spawning must surface the exact capability reason, got {error:?}"
        );
        assert!(
            entities.snapshot().unwrap().is_empty(),
            "an unavailable catalog must never produce a fallback entity"
        );
    }
}
