use anyhow::Result;
use holtburger_common::math::{Quaternion, Vector3};
use holtburger_dat::file_type::{GfxObj, RegionDesc, SceneObjectTemplate, SetupModel};
use holtburger_dat::landblock::{CellLandblock, LandblockInfo};
use std::collections::HashSet;

use crate::ContentRepository;
use crate::source_reader::ContentSourceReader;

const GENERATED_SCENERY_CELL_SIZE: f32 = 24.0;
const GENERATED_SCENERY_BLOCK_SIZE: f32 = 192.0;
const GENERATED_SCENERY_MIN_POINT_SPACING_SQUARED: f32 = 4.0;
const GENERATED_SCENERY_RANDOM_UNIT: f64 = 2.328_306_4e-10;

#[derive(Debug, Default, Clone, Copy)]
pub struct StaticOutdoorSceneAssembler;

#[derive(Debug, Clone)]
pub struct StaticOutdoorScene {
    pub landblock_id: u32,
    pub explicit_objects: Vec<StaticOutdoorInstance>,
    pub buildings: Vec<StaticOutdoorBuilding>,
    pub generated_scenery: Vec<GeneratedOutdoorSceneryInstance>,
    pub diagnostics: StaticOutdoorSceneDiagnostics,
}

#[derive(Debug, Clone)]
pub struct StaticOutdoorInstance {
    pub identity: StaticOutdoorInstanceIdentity,
    pub owning_landblock_id: u32,
    pub source: StaticRenderableSourceRef,
    pub source_index: usize,
    pub frame: StaticOutdoorFrame,
}

#[derive(Debug, Clone)]
pub struct StaticOutdoorBuilding {
    pub instance: StaticOutdoorInstance,
    pub num_leaves: u32,
    pub portals: Vec<StaticOutdoorBuildingPortal>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StaticOutdoorBuildingPortal {
    pub source_index: usize,
    pub flags: u16,
    pub other_cell_id: u16,
    pub other_portal_id: u16,
    pub stab_list: Vec<u16>,
    pub linked_env_cell_ids: Vec<u32>,
}

#[derive(Debug, Clone)]
pub struct GeneratedOutdoorSceneryInstance {
    pub instance: StaticOutdoorInstance,
    pub terrain_index: usize,
    pub scene_id: u32,
    pub scene_template_index: usize,
    pub scale: f32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StaticOutdoorInstanceIdentity {
    ExplicitObject {
        landblock_id: u32,
        source_index: usize,
        source_did: u32,
    },
    Building {
        landblock_id: u32,
        source_index: usize,
        source_did: u32,
    },
    GeneratedScenery {
        landblock_id: u32,
        scene_id: u32,
        terrain_index: usize,
        template_index: usize,
        source_did: u32,
    },
}

impl StaticOutdoorInstanceIdentity {
    pub fn stable_id(&self) -> String {
        match self {
            Self::ExplicitObject {
                landblock_id,
                source_index,
                source_did,
            } => format!(
                "outdoor-static-scene/{landblock_id:08x}/object/{source_index:04x}/{source_did:08x}"
            ),
            Self::Building {
                landblock_id,
                source_index,
                source_did,
            } => format!(
                "outdoor-static-scene/{landblock_id:08x}/building/{source_index:04x}/{source_did:08x}"
            ),
            Self::GeneratedScenery {
                landblock_id,
                scene_id,
                terrain_index,
                template_index,
                source_did,
            } => format!(
                "outdoor-static-scene/{landblock_id:08x}/generated/scene/{scene_id:08x}/cell/{terrain_index:02x}/template/{template_index:04x}/{source_did:08x}"
            ),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StaticRenderableSourceRef {
    pub did: u32,
    pub family: StaticRenderableSourceFamily,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StaticRenderableSourceFamily {
    GfxObj,
    SetupModel,
    Unsupported,
}

impl StaticRenderableSourceRef {
    pub fn from_did(did: u32) -> Self {
        let family = match did >> 24 {
            0x01 => StaticRenderableSourceFamily::GfxObj,
            0x02 => StaticRenderableSourceFamily::SetupModel,
            _ => StaticRenderableSourceFamily::Unsupported,
        };
        Self { did, family }
    }

    pub fn is_renderable(self) -> bool {
        self.family != StaticRenderableSourceFamily::Unsupported
    }
}

#[derive(Debug, Clone, Copy)]
pub struct StaticOutdoorFrame {
    pub origin: Vector3,
    pub orientation: Quaternion,
}

#[derive(Debug, Default, Clone)]
pub struct StaticOutdoorSceneDiagnostics {
    pub landblock_info_available: bool,
    pub landblock_info_error: Option<String>,
    pub explicit: StaticOutdoorLayerDiagnostics,
    pub buildings: StaticOutdoorLayerDiagnostics,
    pub generated: GeneratedOutdoorSceneryDiagnostics,
}

#[derive(Debug, Default, Clone)]
pub struct StaticOutdoorLayerDiagnostics {
    pub attempted: usize,
    pub accepted: usize,
    pub rejected_unsupported_source: usize,
}

#[derive(Debug, Default, Clone)]
pub struct GeneratedOutdoorSceneryDiagnostics {
    pub attempted: usize,
    pub accepted: usize,
    pub skipped_weenie_obj: usize,
    pub rejected_frequency: usize,
    pub rejected_bounds: usize,
    pub rejected_building_occupancy: usize,
    pub rejected_object_bounds: usize,
    pub object_bounds_unavailable: usize,
    pub rejected_road: usize,
    pub rejected_slope: usize,
    pub rejected_overlap: usize,
    pub rejected_unsupported_source: usize,
}

impl StaticOutdoorSceneAssembler {
    pub fn new() -> Self {
        Self
    }

    pub fn assemble_landblock(
        &self,
        content: &ContentRepository,
        raw_landblock_id: u32,
    ) -> Result<StaticOutdoorScene> {
        let mut source = ContentSourceReader::new(content);
        self.assemble_landblock_with_source(&mut source, raw_landblock_id)
    }

    pub(crate) fn assemble_landblock_with_source(
        &self,
        source: &mut ContentSourceReader<'_>,
        raw_landblock_id: u32,
    ) -> Result<StaticOutdoorScene> {
        let landblock_id = normalize_landblock_id(raw_landblock_id);
        let landblock = source.cell_landblock(landblock_id)?;
        let landblock_info_id = normalize_landblock_id(landblock_id) & 0xffff_fffe;
        let landblock_info = match source.landblock_info(landblock_info_id) {
            Ok(info) => Some(info),
            Err(error) => {
                let region = source.region_desc()?;
                return self.assemble_from_loaded(
                    source,
                    landblock_id,
                    &landblock,
                    None,
                    Some(error.to_string()),
                    &region,
                );
            }
        };
        let region = source.region_desc()?;

        self.assemble_from_loaded(
            source,
            landblock_id,
            &landblock,
            landblock_info.as_ref(),
            None,
            &region,
        )
    }

    fn assemble_from_loaded(
        &self,
        source: &mut ContentSourceReader<'_>,
        landblock_id: u32,
        landblock: &CellLandblock,
        landblock_info: Option<&LandblockInfo>,
        landblock_info_error: Option<String>,
        region: &RegionDesc,
    ) -> Result<StaticOutdoorScene> {
        let mut diagnostics = StaticOutdoorSceneDiagnostics {
            landblock_info_available: landblock_info.is_some(),
            landblock_info_error,
            ..StaticOutdoorSceneDiagnostics::default()
        };

        let explicit_objects =
            derive_explicit_objects(landblock_id, landblock_info, &mut diagnostics.explicit);
        let buildings = derive_buildings(landblock_id, landblock_info, &mut diagnostics.buildings);
        let generated_scenery = derive_generated_scenery(
            source,
            landblock_id,
            landblock,
            landblock_info,
            region,
            &mut diagnostics.generated,
        )?;

        Ok(StaticOutdoorScene {
            landblock_id,
            explicit_objects,
            buildings,
            generated_scenery,
            diagnostics,
        })
    }
}

fn derive_explicit_objects(
    landblock_id: u32,
    landblock_info: Option<&LandblockInfo>,
    diagnostics: &mut StaticOutdoorLayerDiagnostics,
) -> Vec<StaticOutdoorInstance> {
    let Some(landblock_info) = landblock_info else {
        return Vec::new();
    };

    landblock_info
        .objects
        .iter()
        .enumerate()
        .filter_map(|(source_index, object)| {
            diagnostics.attempted += 1;
            let source = StaticRenderableSourceRef::from_did(object.id);
            if !source.is_renderable() {
                diagnostics.rejected_unsupported_source += 1;
                return None;
            }

            diagnostics.accepted += 1;
            Some(StaticOutdoorInstance {
                identity: StaticOutdoorInstanceIdentity::ExplicitObject {
                    landblock_id,
                    source_index,
                    source_did: object.id,
                },
                owning_landblock_id: landblock_id,
                source,
                source_index,
                frame: StaticOutdoorFrame {
                    origin: object.frame.origin,
                    orientation: object.frame.orientation,
                },
            })
        })
        .collect()
}

fn derive_buildings(
    landblock_id: u32,
    landblock_info: Option<&LandblockInfo>,
    diagnostics: &mut StaticOutdoorLayerDiagnostics,
) -> Vec<StaticOutdoorBuilding> {
    let Some(landblock_info) = landblock_info else {
        return Vec::new();
    };

    landblock_info
        .buildings
        .iter()
        .enumerate()
        .filter_map(|(source_index, building)| {
            diagnostics.attempted += 1;
            let source = StaticRenderableSourceRef::from_did(building.model_id);
            if !source.is_renderable() {
                diagnostics.rejected_unsupported_source += 1;
                return None;
            }

            diagnostics.accepted += 1;
            let portals = building
                .portals
                .iter()
                .enumerate()
                .map(|(portal_index, portal)| StaticOutdoorBuildingPortal {
                    source_index: portal_index,
                    flags: portal.flags,
                    other_cell_id: portal.other_cell_id,
                    other_portal_id: portal.other_portal_id,
                    stab_list: portal.stab_list.clone(),
                    linked_env_cell_ids: portal
                        .stab_list
                        .iter()
                        .copied()
                        .map(|stab| normalize_landblock_env_cell_id(landblock_id, stab))
                        .collect(),
                })
                .collect();
            Some(StaticOutdoorBuilding {
                instance: StaticOutdoorInstance {
                    identity: StaticOutdoorInstanceIdentity::Building {
                        landblock_id,
                        source_index,
                        source_did: building.model_id,
                    },
                    owning_landblock_id: landblock_id,
                    source,
                    source_index,
                    frame: StaticOutdoorFrame {
                        origin: building.frame.origin,
                        orientation: building.frame.orientation,
                    },
                },
                num_leaves: building.num_leaves,
                portals,
            })
        })
        .collect()
}

fn derive_generated_scenery(
    source_reader: &mut ContentSourceReader<'_>,
    landblock_id: u32,
    landblock: &CellLandblock,
    landblock_info: Option<&LandblockInfo>,
    region: &RegionDesc,
    diagnostics: &mut GeneratedOutdoorSceneryDiagnostics,
) -> Result<Vec<GeneratedOutdoorSceneryInstance>> {
    let mut instances = Vec::new();
    let mut occupied_points = landblock_info
        .into_iter()
        .flat_map(|info| {
            info.objects
                .iter()
                .map(|object| object.frame.origin)
                .chain(info.buildings.iter().map(|building| building.frame.origin))
        })
        .map(|origin| (origin.x, origin.y))
        .collect::<Vec<_>>();
    let occupied_building_cells = occupied_building_cells(landblock_info);
    let block_x = (landblock_id >> 24) * 8;
    let block_y = ((landblock_id >> 16) & 0xff) * 8;

    for (terrain_index, terrain) in landblock.terrain.iter().copied().enumerate() {
        let terrain_type = usize::from((terrain >> 2) & 0x1f);
        let scenery_type = usize::from(terrain >> 11);
        let Some(scene_info_index) = region
            .terrain_info
            .terrain_types
            .get(terrain_type)
            .and_then(|terrain_type| terrain_type.scene_types.get(scenery_type))
            .copied()
        else {
            continue;
        };
        let Some(scene_type) = region.scene_info.scene_types.get(scene_info_index as usize) else {
            continue;
        };
        if scene_type.scenes.is_empty() {
            continue;
        }

        let cell_x = (terrain_index / 9) as u32;
        let cell_y = (terrain_index % 9) as u32;
        let global_cell_x = block_x + cell_x;
        let global_cell_y = block_y + cell_y;
        let scene_id = select_generated_scene_id(&scene_type.scenes, global_cell_x, global_cell_y);
        let scene = source_reader.scene(scene_id)?;

        for (template_index, template) in scene.object_templates.iter().enumerate() {
            diagnostics.attempted += 1;
            if template.weenie_object_id != 0 {
                diagnostics.skipped_weenie_obj += 1;
                continue;
            }
            if generated_template_noise(global_cell_x, global_cell_y, template_index as u32)
                >= template.frequency
            {
                diagnostics.rejected_frequency += 1;
                continue;
            }

            let local_position = displace_generated_template(
                template,
                global_cell_x,
                global_cell_y,
                template_index as u32,
            );
            let local_x = cell_x as f32 * GENERATED_SCENERY_CELL_SIZE + local_position.x;
            let local_y = cell_y as f32 * GENERATED_SCENERY_CELL_SIZE + local_position.y;
            if !(0.0..GENERATED_SCENERY_BLOCK_SIZE).contains(&local_x)
                || !(0.0..GENERATED_SCENERY_BLOCK_SIZE).contains(&local_y)
            {
                diagnostics.rejected_bounds += 1;
                continue;
            }
            if generated_scenery_on_road(landblock, local_x, local_y) {
                diagnostics.rejected_road += 1;
                continue;
            }
            if occupied_building_cells.contains(&cell_for_local_position(local_x, local_y)) {
                diagnostics.rejected_building_occupancy += 1;
                continue;
            }

            let source = StaticRenderableSourceRef::from_did(template.object_id);
            if !source.is_renderable() {
                diagnostics.rejected_unsupported_source += 1;
                continue;
            }

            let terrain_sample = sample_landblock_terrain(landblock, local_x, local_y);
            if !generated_template_matches_slope(template, terrain_sample.normal_z) {
                diagnostics.rejected_slope += 1;
                continue;
            }
            if occupied_points.iter().any(|(x, y)| {
                let dx = local_x - *x;
                let dy = local_y - *y;
                dx * dx + dy * dy < GENERATED_SCENERY_MIN_POINT_SPACING_SQUARED
            }) {
                diagnostics.rejected_overlap += 1;
                continue;
            }

            let scale = scale_generated_template(
                template,
                global_cell_x,
                global_cell_y,
                template_index as u32,
            );
            let frame = build_generated_template_frame(
                template,
                global_cell_x,
                global_cell_y,
                template_index as u32,
                Vector3::new(local_x, local_y, terrain_sample.height + local_position.z),
                terrain_sample.normal,
            );
            match object_bounds_within_landblock(source_reader, source, &frame, scale) {
                Ok(Some(false)) => {
                    diagnostics.rejected_object_bounds += 1;
                    continue;
                }
                Ok(None) => {
                    diagnostics.object_bounds_unavailable += 1;
                }
                Ok(Some(true)) => {}
                Err(_) => {
                    diagnostics.object_bounds_unavailable += 1;
                }
            }

            occupied_points.push((local_x, local_y));
            let source_index = instances.len();
            diagnostics.accepted += 1;
            instances.push(GeneratedOutdoorSceneryInstance {
                instance: StaticOutdoorInstance {
                    identity: StaticOutdoorInstanceIdentity::GeneratedScenery {
                        landblock_id,
                        scene_id,
                        terrain_index,
                        template_index,
                        source_did: template.object_id,
                    },
                    owning_landblock_id: landblock_id,
                    source,
                    source_index,
                    frame,
                },
                terrain_index,
                scene_id,
                scene_template_index: template_index,
                scale,
            });
        }
    }

    Ok(instances)
}

pub fn normalize_landblock_id(raw_landblock_id: u32) -> u32 {
    (raw_landblock_id & 0xffff_0000) | 0xffff
}

pub fn normalize_landblock_env_cell_id(raw_landblock_id: u32, local_cell_id: u16) -> u32 {
    (normalize_landblock_id(raw_landblock_id) & 0xffff_0000) | u32::from(local_cell_id)
}

struct TerrainSample {
    height: f32,
    normal: Vector3,
    normal_z: f32,
}

fn occupied_building_cells(landblock_info: Option<&LandblockInfo>) -> HashSet<(usize, usize)> {
    landblock_info
        .into_iter()
        .flat_map(|info| info.buildings.iter())
        .map(|building| cell_for_local_position(building.frame.origin.x, building.frame.origin.y))
        .collect()
}

fn cell_for_local_position(x: f32, y: f32) -> (usize, usize) {
    (
        (x / GENERATED_SCENERY_CELL_SIZE).floor().clamp(0.0, 7.0) as usize,
        (y / GENERATED_SCENERY_CELL_SIZE).floor().clamp(0.0, 7.0) as usize,
    )
}

fn select_generated_scene_id(scenes: &[u32], global_cell_x: u32, global_cell_y: u32) -> u32 {
    let cell_mat = global_cell_y
        .wrapping_mul(
            712_977_289u32
                .wrapping_mul(global_cell_x)
                .wrapping_add(1_813_693_831),
        )
        .wrapping_sub(1_109_124_029u32.wrapping_mul(global_cell_x))
        .wrapping_add(2_139_937_281);
    let offset = f64::from(cell_mat) * GENERATED_SCENERY_RANDOM_UNIT;
    let scene_index = (scenes.len() as f64 * offset) as usize;
    scenes.get(scene_index).copied().unwrap_or(scenes[0])
}

fn generated_template_noise(global_cell_x: u32, global_cell_y: u32, template_index: u32) -> f32 {
    let cell_x_mat = 0u32.wrapping_sub(1_109_124_029u32.wrapping_mul(global_cell_x));
    let cell_y_mat = 1_813_693_831u32.wrapping_mul(global_cell_y);
    let cell_mat = 1_360_117_743u32
        .wrapping_mul(global_cell_x)
        .wrapping_mul(global_cell_y)
        .wrapping_add(1_888_038_839);
    f64::from(
        cell_x_mat
            .wrapping_add(cell_y_mat)
            .wrapping_sub(cell_mat.wrapping_mul(23_399u32.wrapping_add(template_index))),
    )
    .mul_add(GENERATED_SCENERY_RANDOM_UNIT, 0.0) as f32
}

fn displace_generated_template(
    template: &SceneObjectTemplate,
    global_cell_x: u32,
    global_cell_y: u32,
    template_index: u32,
) -> Vector3 {
    let base = template.base_frame.origin;
    let x = if template.displace_x <= 0.0 {
        base.x
    } else {
        (generated_template_random(global_cell_x, global_cell_y, template_index, 45_773)
            * f64::from(template.displace_x)) as f32
            + base.x
    };
    let y = if template.displace_y <= 0.0 {
        base.y
    } else {
        (generated_template_random(global_cell_x, global_cell_y, template_index, 72_719)
            * f64::from(template.displace_y)) as f32
            + base.y
    };
    let quadrant = f64::from(
        1_813_693_831u32
            .wrapping_mul(global_cell_y)
            .wrapping_sub(
                global_cell_x.wrapping_mul(
                    1_870_387_557u32
                        .wrapping_mul(global_cell_y)
                        .wrapping_add(1_109_124_029),
                ),
            )
            .wrapping_sub(402_451_965),
    ) * GENERATED_SCENERY_RANDOM_UNIT;

    if quadrant >= 0.75 {
        Vector3::new(y, -x, base.z)
    } else if quadrant >= 0.5 {
        Vector3::new(-x, -y, base.z)
    } else if quadrant >= 0.25 {
        Vector3::new(-y, x, base.z)
    } else {
        Vector3::new(x, y, base.z)
    }
}

fn scale_generated_template(
    template: &SceneObjectTemplate,
    global_cell_x: u32,
    global_cell_y: u32,
    template_index: u32,
) -> f32 {
    if (template.min_scale - template.max_scale).abs() <= f32::EPSILON {
        return template.max_scale;
    }

    (f64::from(template.max_scale / template.min_scale).powf(generated_template_random(
        global_cell_x,
        global_cell_y,
        template_index,
        32_593,
    )) as f32)
        * template.min_scale
}

fn build_generated_template_frame(
    template: &SceneObjectTemplate,
    global_cell_x: u32,
    global_cell_y: u32,
    template_index: u32,
    origin: Vector3,
    terrain_normal: Vector3,
) -> StaticOutdoorFrame {
    let orientation = if template.align != 0 {
        terrain_normal_alignment(terrain_normal)
    } else if template.max_rotation_degrees > 0.0 {
        let heading_degrees =
            (generated_template_random(global_cell_x, global_cell_y, template_index, 63_127)
                * f64::from(template.max_rotation_degrees)) as f32;
        Quaternion::from_heading(heading_degrees.to_radians())
    } else {
        template.base_frame.orientation
    };

    StaticOutdoorFrame {
        origin,
        orientation,
    }
}

fn terrain_normal_alignment(terrain_normal: Vector3) -> Quaternion {
    let downhill = Vector3::new(-terrain_normal.x, -terrain_normal.y, 0.0);
    if downhill.length_squared() < 1e-6 {
        Quaternion::identity()
    } else {
        Quaternion::from_heading(Vector3::zero().heading_to(&downhill))
    }
}

fn object_bounds_within_landblock(
    source_reader: &mut ContentSourceReader<'_>,
    source: StaticRenderableSourceRef,
    frame: &StaticOutdoorFrame,
    scale: f32,
) -> Result<Option<bool>> {
    match source.family {
        StaticRenderableSourceFamily::SetupModel => {
            let setup_model = source_reader.setup_model(source.did)?;
            Ok(setup_model_within_landblock(&setup_model, frame, scale))
        }
        StaticRenderableSourceFamily::GfxObj => {
            let gfx_obj = source_reader.gfx_obj(source.did)?;
            Ok(gfx_obj_within_landblock(&gfx_obj, frame, scale))
        }
        StaticRenderableSourceFamily::Unsupported => Ok(None),
    }
}

fn setup_model_within_landblock(
    setup_model: &SetupModel,
    frame: &StaticOutdoorFrame,
    scale: f32,
) -> Option<bool> {
    if !setup_model.cyl_spheres.is_empty() {
        return Some(setup_model.cyl_spheres.iter().all(|sphere| {
            placed_circle_within_landblock(frame, sphere.origin, scale, sphere.radius * scale)
        }));
    }

    if !setup_model.spheres.is_empty() {
        return Some(setup_model.spheres.iter().all(|sphere| {
            placed_circle_within_landblock(frame, sphere.center, scale, sphere.radius * scale)
        }));
    }

    if setup_model.sorting_sphere.radius > 0.0 {
        return Some(placed_circle_within_landblock(
            frame,
            setup_model.sorting_sphere.center,
            scale,
            setup_model.sorting_sphere.radius * scale,
        ));
    }

    None
}

fn gfx_obj_within_landblock(
    gfx_obj: &GfxObj,
    frame: &StaticOutdoorFrame,
    scale: f32,
) -> Option<bool> {
    let physics_vertex_ids = gfx_obj
        .physics_polygons
        .values()
        .flat_map(|polygon| polygon.vertex_ids.iter().copied())
        .collect::<HashSet<_>>();
    let vertex_ids = if physics_vertex_ids.is_empty() {
        None
    } else {
        Some(physics_vertex_ids)
    };
    let mut checked_any = false;
    for (vertex_id, vertex) in &gfx_obj.vertex_array.vertices {
        if vertex_ids
            .as_ref()
            .is_some_and(|ids| !ids.contains(vertex_id))
        {
            continue;
        }
        checked_any = true;
        let point = transform_local_point(frame, vertex.origin, scale);
        if !point_inside_landblock(point.x, point.y) {
            return Some(false);
        }
    }

    checked_any.then_some(true)
}

fn placed_circle_within_landblock(
    frame: &StaticOutdoorFrame,
    local_center: Vector3,
    scale: f32,
    radius: f32,
) -> bool {
    let center = transform_local_point(frame, local_center, scale);
    center.x >= radius
        && center.y >= radius
        && center.x < GENERATED_SCENERY_BLOCK_SIZE - radius
        && center.y < GENERATED_SCENERY_BLOCK_SIZE - radius
}

fn transform_local_point(frame: &StaticOutdoorFrame, point: Vector3, scale: f32) -> Vector3 {
    let scaled = point * scale;
    let heading = frame.orientation.to_heading();
    let theta = (450.0f32).to_radians() - heading;
    let (sin_theta, cos_theta) = theta.sin_cos();
    Vector3::new(
        frame.origin.x + scaled.x * cos_theta - scaled.y * sin_theta,
        frame.origin.y + scaled.x * sin_theta + scaled.y * cos_theta,
        frame.origin.z + scaled.z,
    )
}

fn point_inside_landblock(x: f32, y: f32) -> bool {
    (0.0..GENERATED_SCENERY_BLOCK_SIZE).contains(&x)
        && (0.0..GENERATED_SCENERY_BLOCK_SIZE).contains(&y)
}

fn generated_template_random(
    global_cell_x: u32,
    global_cell_y: u32,
    template_index: u32,
    salt: u32,
) -> f64 {
    f64::from(
        1_813_693_831u32
            .wrapping_mul(global_cell_y)
            .wrapping_sub(
                template_index.wrapping_add(salt).wrapping_mul(
                    1_360_117_743u32
                        .wrapping_mul(global_cell_y)
                        .wrapping_mul(global_cell_x)
                        .wrapping_add(1_888_038_839),
                ),
            )
            .wrapping_sub(1_109_124_029u32.wrapping_mul(global_cell_x)),
    ) * GENERATED_SCENERY_RANDOM_UNIT
}

fn generated_scenery_on_road(landblock: &CellLandblock, x: f32, y: f32) -> bool {
    let cell_x = (x / GENERATED_SCENERY_CELL_SIZE).floor() as i32;
    let cell_y = (y / GENERATED_SCENERY_CELL_SIZE).floor() as i32;
    let road_width = 5.0;
    let road_min = road_width;
    let road_max = GENERATED_SCENERY_CELL_SIZE - road_width;
    let roads = [
        get_road(landblock, cell_x, cell_y),
        get_road(landblock, cell_x, cell_y + 1),
        get_road(landblock, cell_x + 1, cell_y),
        get_road(landblock, cell_x + 1, cell_y + 1),
    ];
    if roads.iter().all(|road| *road == 0) {
        return false;
    }

    let dx = x - cell_x as f32 * GENERATED_SCENERY_CELL_SIZE;
    let dy = y - cell_y as f32 * GENERATED_SCENERY_CELL_SIZE;
    match (roads[0] > 0, roads[1] > 0, roads[2] > 0, roads[3] > 0) {
        (true, true, true, true) => true,
        (true, true, true, false) => dx < road_min || dy < road_min,
        (true, true, false, true) => dx < road_min || dy > road_max,
        (true, true, false, false) => dx < road_min,
        (true, false, true, true) => dx > road_max || dy < road_min,
        (true, false, true, false) => dy < road_min,
        (true, false, false, true) => (dx - dy).abs() < road_min,
        (true, false, false, false) => dx + dy < road_min,
        (false, true, true, true) => dx > road_max || dy > road_max,
        (false, true, true, false) => (dx + dy - GENERATED_SCENERY_CELL_SIZE).abs() < road_min,
        (false, true, false, true) => dy > road_max,
        (false, true, false, false) => GENERATED_SCENERY_CELL_SIZE + dx - dy < road_min,
        (false, false, true, true) => dx > road_max,
        (false, false, true, false) => GENERATED_SCENERY_CELL_SIZE - dx + dy < road_min,
        (false, false, false, true) => GENERATED_SCENERY_CELL_SIZE * 2.0 - dx - dy < road_min,
        (false, false, false, false) => false,
    }
}

fn get_road(landblock: &CellLandblock, x: i32, y: i32) -> u16 {
    if !(0..9).contains(&x) || !(0..9).contains(&y) {
        return 0;
    }
    landblock.terrain[x as usize * 9 + y as usize] & 0x03
}

fn sample_landblock_terrain(landblock: &CellLandblock, x: f32, y: f32) -> TerrainSample {
    let cell_x = (x / GENERATED_SCENERY_CELL_SIZE).floor().clamp(0.0, 7.0) as usize;
    let cell_y = (y / GENERATED_SCENERY_CELL_SIZE).floor().clamp(0.0, 7.0) as usize;
    let local_x = (x - cell_x as f32 * GENERATED_SCENERY_CELL_SIZE) / GENERATED_SCENERY_CELL_SIZE;
    let local_y = (y - cell_y as f32 * GENERATED_SCENERY_CELL_SIZE) / GENERATED_SCENERY_CELL_SIZE;
    let h00 = landblock.get_height(cell_x, cell_y);
    let h10 = landblock.get_height(cell_x + 1, cell_y);
    let h01 = landblock.get_height(cell_x, cell_y + 1);
    let h11 = landblock.get_height(cell_x + 1, cell_y + 1);
    let west = h00 + (h01 - h00) * local_y;
    let east = h10 + (h11 - h10) * local_y;
    let height = west + (east - west) * local_x;
    let dz_dx = (east - west) / GENERATED_SCENERY_CELL_SIZE;
    let south = h00 + (h10 - h00) * local_x;
    let north = h01 + (h11 - h01) * local_x;
    let dz_dy = (north - south) / GENERATED_SCENERY_CELL_SIZE;
    let normal = Vector3::new(-dz_dx, -dz_dy, 1.0).normalize();
    TerrainSample {
        height,
        normal,
        normal_z: normal.z,
    }
}

fn generated_template_matches_slope(template: &SceneObjectTemplate, normal_z: f32) -> bool {
    normal_z >= template.min_slope && normal_z <= template.max_slope
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::Sphere;
    use holtburger_dat::file_type::setup_model::CylSphere;
    use std::collections::HashMap;

    #[test]
    fn stable_ids_do_not_use_frontend_asset_families() {
        let id = StaticOutdoorInstanceIdentity::GeneratedScenery {
            landblock_id: 0xda55ffff,
            scene_id: 0x12000001,
            terrain_index: 4,
            template_index: 9,
            source_did: 0x02000001,
        };

        assert_eq!(
            id.stable_id(),
            "outdoor-static-scene/da55ffff/generated/scene/12000001/cell/04/template/0009/02000001"
        );
    }

    #[test]
    fn source_refs_are_typed_without_frontend_ids() {
        assert_eq!(
            StaticRenderableSourceRef::from_did(0x01000001).family,
            StaticRenderableSourceFamily::GfxObj
        );
        assert_eq!(
            StaticRenderableSourceRef::from_did(0x02000001).family,
            StaticRenderableSourceFamily::SetupModel
        );
        assert_eq!(
            StaticRenderableSourceRef::from_did(0x03000001).family,
            StaticRenderableSourceFamily::Unsupported
        );
    }

    #[test]
    fn normalizes_building_portal_stab_ids_to_landblock_env_cell_ids() {
        assert_eq!(
            normalize_landblock_env_cell_id(0xda55ffff, 0x012e),
            0xda55012e
        );
        assert_eq!(
            normalize_landblock_env_cell_id(0xda550123, 0x012e),
            0xda55012e
        );
    }

    #[test]
    fn setup_model_bounds_reject_spheres_crossing_landblock_edges() {
        let setup_model = SetupModel {
            id: 0x02000001,
            flags: 0,
            parts: Vec::new(),
            parent_index: Vec::new(),
            default_scale: Vec::new(),
            holding_locations: HashMap::new(),
            connection_points: HashMap::new(),
            placement_frames: HashMap::new(),
            cyl_spheres: vec![CylSphere {
                origin: Vector3::zero(),
                radius: 3.0,
                height: 6.0,
            }],
            spheres: Vec::new(),
            height: 6.0,
            radius: 3.0,
            step_up: 0.0,
            step_down: 0.0,
            sorting_sphere: Sphere {
                center: Vector3::zero(),
                radius: 3.0,
            },
            selection_sphere: Sphere {
                center: Vector3::zero(),
                radius: 3.0,
            },
            lights: HashMap::new(),
            default_animation: None,
            default_script: None,
            default_motion_table: None,
            default_sound_table: None,
            default_script_table: None,
        };

        let inside_frame = StaticOutdoorFrame {
            origin: Vector3::new(10.0, 10.0, 0.0),
            orientation: Quaternion::identity(),
        };
        let edge_frame = StaticOutdoorFrame {
            origin: Vector3::new(1.0, 10.0, 0.0),
            orientation: Quaternion::identity(),
        };

        assert_eq!(
            setup_model_within_landblock(&setup_model, &inside_frame, 1.0),
            Some(true)
        );
        assert_eq!(
            setup_model_within_landblock(&setup_model, &edge_frame, 1.0),
            Some(false)
        );
    }

    #[test]
    fn terrain_alignment_uses_downhill_heading() {
        let normal = Vector3::new(-0.5, 0.0, 0.866_025_4).normalize();
        let orientation = terrain_normal_alignment(normal);
        let heading_degrees = orientation.to_heading().to_degrees();

        assert!((heading_degrees - 180.0).abs() < 0.01);
    }
}
