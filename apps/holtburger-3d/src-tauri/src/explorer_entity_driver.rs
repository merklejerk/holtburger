//! Catalog-backed Explorer entity preparation and serialized lifecycle operations.

use std::error::Error;
use std::fmt::{Display, Formatter};
use std::sync::{Arc, Mutex};
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
use holtburger_weenie_catalog::WeenieTemplate;
use holtburger_world::{
    CellTransitRequest, DynamicPhysicalBodyDefinition, EntityAppearance, EntityPartChange,
    EntityPhysicalIntent, EntityPhysicalTransitionAction, EntityPhysicsStateInput,
    EntityPhysicsStateOverrides, EntitySubPalette, EntityTextureChange,
    calculate_effective_entity_physics_state, resolve_effective_entity_physics_state,
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
}

/// Production DAT-backed preparation adapter.
pub struct DatExplorerEntityContentPreparer {
    content: Arc<ContentRepository>,
}

impl DatExplorerEntityContentPreparer {
    /// Binds preparation to the same immutable repository used by the Explorer host.
    pub fn new(content: Arc<ContentRepository>) -> Self {
        Self { content }
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
        let (definition, physical) = self.prepare_by_wcid(guid, request)?;
        self.entities
            .spawn_prepared(definition, request.physical_intent, physical)
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
        let (definition, physical) = self.prepare_by_wcid(request.guid, request.replacement)?;
        self.entities
            .replace_prepared(
                definition,
                request.generation,
                request.replacement.physical_intent,
                physical,
            )
            .map_err(ExplorerEntityDriverError::from)
    }

    fn prepare_by_wcid(
        &self,
        guid: Guid,
        request: ExplorerEntitySpawnRequest,
    ) -> Result<
        (
            DynamicEntityDefinition,
            Option<DynamicPhysicalBodyDefinition>,
        ),
        ExplorerEntityDriverError,
    > {
        let template = self
            .catalog
            .lookup(request.wcid)?
            .ok_or(ExplorerEntityDriverError::MissingWcid { wcid: request.wcid })?;
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
            calculate_effective_entity_physics_state(physics_input(&template), setup.physics);
        if !physics.supports_local_simulation() {
            return Err(ExplorerEntityDriverError::Preparation(
                DynamicEntityPhysicalPreparationError::UnsupportedPhysicsState {
                    wcid: template.wcid,
                    state: physics.semantic.bits(),
                    unsupported_bits: physics.unsupported_local_simulation.bits(),
                    unknown_bits: physics.unknown_bits,
                },
            ));
        }
        let mut definition = DynamicEntityDefinition::prepare(DynamicEntityDefinitionInput {
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
                setup_did,
                sound_table_did: template.sound_table_did,
                physics_effect_table_did: template.physics_effect_table_did,
            },
            appearance: appearance(&template),
            initial: DynamicEntityInitialState {
                pose: candidate_pose(request.camera_pose, request.candidate, request.rotation)?,
                velocity: Vector3::zero(),
                acceleration: Vector3::zero(),
                omega: Vector3::zero(),
                created_at: self.clock.now(),
            },
            object_scale,
            friction: optional_f32(template.wcid, "friction", template.friction)?,
            elasticity: optional_f32(template.wcid, "elasticity", template.elasticity)?,
            maximum_velocity: optional_f32(
                template.wcid,
                "maximum velocity",
                template.maximum_velocity,
            )?,
            rotation_speed: optional_f32(template.wcid, "rotation speed", template.rotation_speed)?,
            physics,
        })?;
        let physical = match request.physical_intent {
            EntityPhysicalIntent::PoseOnly => None,
            EntityPhysicalIntent::Simulated => Some(self.content.prepare_physical(&definition)?),
        };
        definition.initial.pose = resolve_spawn_placement(
            &self.simulation.snapshot(),
            request.camera_pose,
            definition.initial.pose,
            setup.movement_spheres.primary().center,
            setup.movement_spheres.primary().radius,
        )?;
        Ok((definition, physical))
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

fn appearance(template: &WeenieTemplate) -> EntityAppearance {
    EntityAppearance {
        palette_did: template.palette_base_did,
        sub_palettes: template
            .sub_palettes
            .iter()
            .map(|range| EntitySubPalette {
                palette_did: range.sub_palette_did,
                offset: u32::from(range.offset) * 8,
                color_count: u32::from(range.length) * 8,
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
    }
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
    use holtburger_content::{ColliderScale, LandblockCollisionAsset};
    use holtburger_weenie_catalog::{PhysicsBoolOverrides, TemplatePhysics};
    use holtburger_world::{
        DynamicBodyCollisionDefinition, EdgeProtection, EntityCollisionParticipation,
        EntityCollisionReportPolicy, EntityDynamicCollisionPolicy, EntityPhysicsScheduling,
        EntityPhysicsSetupFacts, PhysicalBodyResponsePolicy, PhysicalElasticity, PhysicalFriction,
        PhysicalRestitution, PhysicalSphereSet, PhysicalSurfaceMotion,
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
                provenance: "fixture".to_owned(),
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

    fn driver_with_catalog(
        catalog: Arc<dyn ExplorerWeenieCatalogSource>,
        physical: FixturePhysical,
    ) -> (Arc<ExplorerEntityRuntime>, ExplorerEntityDriver) {
        let simulation = Arc::new(HostSimulationRuntime::new(Arc::new(EmptyCollisionSource)));
        let entities = Arc::new(ExplorerEntityRuntime::new(Arc::clone(&simulation)));
        let driver = ExplorerEntityDriver::new(
            catalog,
            Arc::new(FixtureContent { physical }),
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
            survivor[0].input.participation,
            holtburger_world::PhysicalBodyParticipation::PoseOnly
        );
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
