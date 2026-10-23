//! Canonical retail-derived generated-scenery resolution.

use anyhow::{Context, Result};
use holtburger_common::math::{Quaternion, Vector3};
use holtburger_dat::EOR_PORTAL_NAMESPACE;
use holtburger_dat::file_type::{GfxObj, RegionDesc, SceneObjectTemplate, SetupModel};
use holtburger_dat::physics::BspNode;
use std::collections::HashSet;

use crate::ContentRepository;
use crate::source_reader::ContentSourceReader;
use crate::{LandblockAsset, LandblockObjectSourceFamily, LandblockPlacement, LandblockTerrain};

const GENERATED_SCENERY_CELL_SIZE: f32 = 24.0;
const GENERATED_SCENERY_BLOCK_SIZE: f32 = 192.0;
const GENERATED_SCENERY_MIN_POINT_SPACING_SQUARED: f32 = 4.0;
const GENERATED_SCENERY_RANDOM_UNIT: f64 = 2.328_306_4e-10;

/// Complete shallow generated-scenery result for one landblock.
#[derive(Debug, Clone)]
pub struct GeneratedSceneryAsset {
    /// Normalized owning landblock DID.
    pub landblock_id: u32,
    /// Retail-accepted generated placements in retail enumeration order.
    pub objects: Vec<GeneratedSceneryObject>,
}

/// One retail-accepted generated scenery placement.
#[derive(Debug, Clone)]
pub struct GeneratedSceneryObject {
    /// Stable source-derived identity.
    pub identity: GeneratedSceneryIdentity,
    /// Authored object DID selected by the Scene template.
    pub source_did: u32,
    /// DID-family classification retained without presentation enrichment.
    pub source_family: LandblockObjectSourceFamily,
    /// Generated landblock-local placement before the template scale is applied.
    pub placement: LandblockPlacement,
    /// Template scale applied by retail only after boundary acceptance.
    pub scale: f32,
}

/// Stable provenance for one generated scenery placement.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GeneratedSceneryIdentity {
    /// Owning normalized landblock DID.
    pub landblock_id: u32,
    /// Selected Scene DID.
    pub scene_id: u32,
    /// CellLandblock source-order terrain index.
    pub terrain_index: usize,
    /// Scene object-template ordinal.
    pub template_index: usize,
}

/// Resolves retail generated scenery over an already assembled shallow landblock.
#[derive(Debug, Default, Clone, Copy)]
pub struct GeneratedSceneryAssetAssembler;

impl GeneratedSceneryAssetAssembler {
    /// Resolves generated candidates without reloading or rederiving the shallow foundation.
    pub fn assemble(
        self,
        content: &ContentRepository,
        decode_cache: &crate::ContentDecodeCache,
        landblock: &LandblockAsset,
        active_region: &crate::ActiveRegionData,
    ) -> Result<GeneratedSceneryAsset> {
        let mut source_reader = ContentSourceReader::with_decode_cache(content, decode_cache);
        resolve_generated_scenery_from_source(
            &mut source_reader,
            landblock,
            &active_region.descriptor,
        )
        .with_context(|| {
            format!(
                "Could not resolve generated scenery for landblock 0x{:08X}",
                landblock.landblock_id
            )
        })
    }
}

pub(crate) fn resolve_generated_scenery_from_source(
    source_reader: &mut ContentSourceReader<'_>,
    landblock: &LandblockAsset,
    region: &RegionDesc,
) -> Result<GeneratedSceneryAsset> {
    let mut objects = Vec::new();
    let mut occupied_points = landblock
        .explicit_objects
        .iter()
        .map(|object| object.placement.origin)
        .chain(
            landblock
                .buildings
                .iter()
                .map(|building| building.placement.origin),
        )
        .map(|origin| (origin.x, origin.y))
        .collect::<Vec<_>>();
    let occupied_building_cells = landblock
        .buildings
        .iter()
        .map(|building| {
            cell_for_local_position(building.placement.origin.x, building.placement.origin.y)
        })
        .collect::<HashSet<_>>();
    let landblock_id = landblock.landblock_id;
    let block_x = (landblock_id >> 24) * 8;
    let block_y = ((landblock_id >> 16) & 0xff) * 8;
    let terrain_info = region
        .terrain_info
        .as_ref()
        .context("RegionDesc has no terrain payload required for generated scenery")?;
    let scene_info = region
        .scene_info
        .as_ref()
        .context("RegionDesc has no scene payload required for generated scenery")?;

    // Retail enumerates CellLandblock samples in x-major DAT order. The foundation stores
    // canonical row-major samples, so preserve retail ordering explicitly while indexing the
    // canonical grid.
    for terrain_index in 0..landblock.terrain.terrain_samples.len() {
        let cell_x = terrain_index / landblock.terrain.grid_size;
        let cell_y = terrain_index % landblock.terrain.grid_size;
        let canonical_index = cell_y * landblock.terrain.grid_size + cell_x;
        let terrain = landblock.terrain.terrain_samples[canonical_index];
        let terrain_type = usize::from((terrain >> 2) & 0x1f);
        let scenery_type = usize::from(terrain >> 11);
        let Some(scene_info_index) = terrain_info
            .terrain_types
            .get(terrain_type)
            .and_then(|terrain_type| terrain_type.scene_types.get(scenery_type))
            .copied()
        else {
            continue;
        };
        let Some(scene_type) = scene_info.scene_types.get(scene_info_index as usize) else {
            continue;
        };
        if scene_type.scenes.is_empty() {
            continue;
        }

        let cell_x = cell_x as u32;
        let cell_y = cell_y as u32;
        let global_cell_x = block_x + cell_x;
        let global_cell_y = block_y + cell_y;
        let scene_id = select_generated_scene_id(&scene_type.scenes, global_cell_x, global_cell_y);
        let scene = source_reader.scene(scene_id)?;

        for (template_index, template) in scene.object_templates.iter().enumerate() {
            if template.weenie_object_id != 0 {
                continue;
            }
            if generated_template_noise(global_cell_x, global_cell_y, template_index as u32)
                >= template.frequency
            {
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
                continue;
            }
            if generated_scenery_on_road(&landblock.terrain, local_x, local_y) {
                continue;
            }
            if occupied_building_cells.contains(&cell_for_local_position(local_x, local_y)) {
                continue;
            }

            let source_family = LandblockObjectSourceFamily::from_did(template.object_id);
            if matches!(source_family, LandblockObjectSourceFamily::Other(_)) {
                continue;
            }

            let terrain_sample = sample_landblock_terrain(&landblock.terrain, local_x, local_y)?;
            if !generated_template_matches_slope(template, terrain_sample.normal.z) {
                continue;
            }
            if occupied_points.iter().any(|(x, y)| {
                let dx = local_x - *x;
                let dy = local_y - *y;
                dx * dx + dy * dy < GENERATED_SCENERY_MIN_POINT_SPACING_SQUARED
            }) {
                continue;
            }

            let frame = build_generated_template_frame(
                template,
                global_cell_x,
                global_cell_y,
                template_index as u32,
                terrain_sample,
            );
            if !generated_source_within_landblock(
                source_reader,
                template.object_id,
                source_family,
                &frame,
            )? {
                continue;
            }

            occupied_points.push((local_x, local_y));
            objects.push(GeneratedSceneryObject {
                identity: GeneratedSceneryIdentity {
                    landblock_id,
                    scene_id,
                    terrain_index,
                    template_index,
                },
                source_did: template.object_id,
                source_family,
                placement: LandblockPlacement {
                    origin: frame.origin,
                    orientation: frame.orientation,
                },
                // Retail calls SetScaleStatic only after obj_within_block accepts the unscaled
                // object. Keeping this below the predicate prevents scale-dependent population.
                scale: scale_generated_template(
                    template,
                    global_cell_x,
                    global_cell_y,
                    template_index as u32,
                ),
            });
        }
    }

    Ok(GeneratedSceneryAsset {
        landblock_id,
        objects,
    })
}

/// One candidate projected onto an authored terrain polygon.
struct TerrainSample {
    /// Landblock-local origin whose Z lies on the selected polygon.
    origin: Vector3,
    /// Unit face normal used by both slope acceptance and alignment.
    normal: Vector3,
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
    terrain_sample: TerrainSample,
) -> LandblockPlacement {
    let orientation = if template.align != 0 {
        let downhill = Vector3::new(-terrain_sample.normal.x, -terrain_sample.normal.y, 0.0);
        // Vector3::get_heading returns zero for a near-zero XY vector, including flat ground
        // (acclient.c:141871-141886, normalize_check_small at 137456).
        let heading = if downhill.length() < 0.0002 {
            0.0
        } else {
            downhill.x.atan2(downhill.y).to_degrees().rem_euclid(360.0)
        };
        set_generated_heading(template.base_frame.orientation, heading)
    } else if template.max_rotation_degrees > 0.0 {
        let heading_degrees =
            (generated_template_random(global_cell_x, global_cell_y, template_index, 63_127)
                * f64::from(template.max_rotation_degrees)) as f32;
        set_generated_heading(template.base_frame.orientation, heading_degrees)
    } else {
        template.base_frame.orientation
    };

    LandblockPlacement {
        origin: terrain_sample.origin,
        orientation,
    }
}

/// Retail Frame::set_heading / set_vector_heading (acclient.c:342872-342908).
/// Heading zero is +Y, increasing toward +X. Retail retains the base forward-vector Z,
/// normalizes `(sin(heading), cos(heading), z)`, then reconstructs pitch and yaw without roll.
fn set_generated_heading(base: Quaternion, degrees: f32) -> Quaternion {
    let forward_z = base.rotate_vector(Vector3::new(0.0, 1.0, 0.0)).z;
    // asin(z / sqrt(1 + z*z)) simplifies to atan(z); the XY heading is unit length.
    let pitch = forward_z.atan();
    let (sin_pitch, cos_pitch) = (pitch * 0.5).sin_cos();
    let (sin_yaw, cos_yaw) = (-degrees.to_radians() * 0.5).sin_cos();
    Quaternion {
        w: cos_yaw * cos_pitch,
        x: cos_yaw * sin_pitch,
        y: sin_yaw * sin_pitch,
        z: sin_yaw * cos_pitch,
    }
}

fn generated_source_within_landblock(
    source_reader: &mut ContentSourceReader<'_>,
    source_did: u32,
    source_family: LandblockObjectSourceFamily,
    frame: &LandblockPlacement,
) -> Result<bool> {
    if !source_reader.resource_exists(EOR_PORTAL_NAMESPACE, source_did) {
        return Ok(false);
    }

    match source_family {
        LandblockObjectSourceFamily::SetupModel => {
            let setup_model = source_reader.setup_model(source_did)?;
            setup_model_within_landblock(source_reader, &setup_model, frame)
        }
        LandblockObjectSourceFamily::GfxObj => {
            let gfx_obj = source_reader.gfx_obj(source_did)?;
            gfx_obj_within_landblock(&gfx_obj, frame)
        }
        LandblockObjectSourceFamily::Other(_) => Ok(false),
    }
}

fn setup_model_within_landblock(
    source_reader: &mut ContentSourceReader<'_>,
    setup_model: &SetupModel,
    frame: &LandblockPlacement,
) -> Result<bool> {
    let mut any_part_has_physics = false;
    for part_id in &setup_model.parts {
        if !source_reader.resource_exists(EOR_PORTAL_NAMESPACE, *part_id) {
            return Ok(false);
        }
        let part = source_reader.gfx_obj(*part_id)?;
        any_part_has_physics |= part.physics_bsp.is_some();
    }

    Ok(setup_model_boundary_within_landblock(
        setup_model,
        any_part_has_physics,
        frame,
    ))
}

fn setup_model_boundary_within_landblock(
    setup_model: &SetupModel,
    any_part_has_physics: bool,
    frame: &LandblockPlacement,
) -> bool {
    if any_part_has_physics {
        return placed_circle_within_landblock(
            frame,
            setup_model.sorting_sphere.center,
            setup_model.sorting_sphere.radius,
        );
    }

    if !setup_model.cyl_spheres.is_empty() {
        return setup_model
            .cyl_spheres
            .iter()
            .all(|sphere| placed_circle_within_landblock(frame, sphere.origin, sphere.radius));
    }

    if !setup_model.spheres.is_empty() {
        return placed_circle_within_landblock(
            frame,
            setup_model.sorting_sphere.center,
            setup_model.sorting_sphere.radius,
        );
    }

    point_inside_landblock(frame.origin.x, frame.origin.y)
}

fn gfx_obj_within_landblock(gfx_obj: &GfxObj, frame: &LandblockPlacement) -> Result<bool> {
    if let Some(physics_bsp) = &gfx_obj.physics_bsp {
        let sphere = bsp_root_sphere(physics_bsp).with_context(|| {
            format!(
                "GfxObj 0x{:08X} physics BSP root has no sorting sphere",
                gfx_obj.id
            )
        })?;
        Ok(placed_circle_within_landblock(
            frame,
            sphere.center,
            sphere.radius,
        ))
    } else {
        // Retail's synthetic simple setup has no sphere/cylinder arrays in this branch, so
        // obj_within_block tests the unscaled object origin. The drawing BSP sphere is irrelevant.
        Ok(point_inside_landblock(frame.origin.x, frame.origin.y))
    }
}

fn bsp_root_sphere(node: &BspNode) -> Option<&holtburger_common::Sphere> {
    match node {
        BspNode::Port(portal) => portal.sphere.as_ref(),
        BspNode::Leaf(leaf) => leaf.sphere.as_ref(),
        BspNode::Internal(internal) => internal.sphere.as_ref(),
    }
}

fn placed_circle_within_landblock(
    frame: &LandblockPlacement,
    local_center: Vector3,
    radius: f32,
) -> bool {
    let center = frame.origin + frame.orientation.rotate_vector(local_center);
    center.x >= radius
        && center.y >= radius
        && center.x < GENERATED_SCENERY_BLOCK_SIZE - radius
        && center.y < GENERATED_SCENERY_BLOCK_SIZE - radius
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

fn generated_scenery_on_road(terrain: &LandblockTerrain, x: f32, y: f32) -> bool {
    let cell_x = (x / GENERATED_SCENERY_CELL_SIZE).floor() as i32;
    let cell_y = (y / GENERATED_SCENERY_CELL_SIZE).floor() as i32;
    let road_width = 5.0;
    let road_min = road_width;
    let road_max = GENERATED_SCENERY_CELL_SIZE - road_width;
    let roads = [
        get_road(terrain, cell_x, cell_y),
        get_road(terrain, cell_x, cell_y + 1),
        get_road(terrain, cell_x + 1, cell_y),
        get_road(terrain, cell_x + 1, cell_y + 1),
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

fn get_road(terrain: &LandblockTerrain, x: i32, y: i32) -> u16 {
    if !(0..9).contains(&x) || !(0..9).contains(&y) {
        return 0;
    }
    terrain.terrain_samples[y as usize * terrain.grid_size + x as usize] & 0x03
}

fn sample_landblock_terrain(terrain: &LandblockTerrain, x: f32, y: f32) -> Result<TerrainSample> {
    // Candidates have already passed the half-open landblock bounds check. Use the foundation's
    // authored vertices, not the water-adjusted collision surface (acclient.c:338228-338237).
    let cell_x = (x / terrain.tile_size).floor() as usize;
    let cell_y = (y / terrain.tile_size).floor() as usize;
    let local_x = (x - cell_x as f32 * terrain.tile_size) / terrain.tile_size;
    let local_y = (y - cell_y as f32 * terrain.tile_size) / terrain.tile_size;
    let vertex_at = |vertex_x, vertex_y| -> Result<Vector3> {
        let height = terrain
            .heights
            .get(vertex_y * terrain.grid_size + vertex_x)
            .copied()
            .ok_or_else(|| {
                anyhow::anyhow!(
                    "Landblock terrain is missing resolved height at ({vertex_x}, {vertex_y})"
                )
            })?;
        Ok(Vector3::new(
            vertex_x as f32 * terrain.tile_size,
            vertex_y as f32 * terrain.tile_size,
            height,
        ))
    };
    let triangles = terrain.cell_diagonals.cell_triangles(
        cell_x,
        cell_y,
        [
            vertex_at(cell_x, cell_y)?,
            vertex_at(cell_x + 1, cell_y)?,
            vertex_at(cell_x, cell_y + 1)?,
            vertex_at(cell_x + 1, cell_y + 1)?,
        ],
    );
    let index = terrain
        .cell_diagonals
        .triangle_index_at(cell_x, cell_y, local_x, local_y);
    let [a, b, c] = triangles[index];
    let normal = (b - a).cross(&(c - a)).normalize();
    let height = a.z - ((x - a.x) * normal.x + (y - a.y) * normal.y) / normal.z;
    // Retail's Plane::set_height replaces Z; template Z is not an additive offset
    // (acclient.c:338233, 337037-337044).
    Ok(TerrainSample {
        origin: Vector3::new(x, y, height),
        normal,
    })
}

fn generated_template_matches_slope(template: &SceneObjectTemplate, normal_z: f32) -> bool {
    normal_z >= template.min_slope && normal_z <= template.max_slope
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::Sphere;
    use holtburger_common::properties::GfxObjFlags;
    use holtburger_dat::file_type::setup_model::CylSphere;
    use holtburger_dat::physics::BspLeaf;
    use std::collections::HashMap;

    #[test]
    fn setup_model_bounds_reject_spheres_crossing_landblock_edges() {
        let setup_model = test_setup_model();

        let inside_frame = LandblockPlacement {
            origin: Vector3::new(10.0, 10.0, 0.0),
            orientation: Quaternion::identity(),
        };
        let edge_frame = LandblockPlacement {
            origin: Vector3::new(1.0, 10.0, 0.0),
            orientation: Quaternion::identity(),
        };

        assert!(setup_model_boundary_within_landblock(
            &setup_model,
            false,
            &inside_frame
        ));
        assert!(!setup_model_boundary_within_landblock(
            &setup_model,
            false,
            &edge_frame
        ));
    }

    #[test]
    fn setup_model_physics_parts_select_the_unscaled_sorting_sphere() {
        let mut setup_model = test_setup_model();
        setup_model.sorting_sphere.radius = 12.0;
        let frame = LandblockPlacement {
            origin: Vector3::new(10.0, 20.0, 0.0),
            orientation: Quaternion::identity(),
        };

        assert!(setup_model_boundary_within_landblock(
            &setup_model,
            false,
            &frame
        ));
        assert!(!setup_model_boundary_within_landblock(
            &setup_model,
            true,
            &frame
        ));
    }

    #[test]
    fn setup_model_sphere_array_selects_sorting_sphere_not_member_spheres() {
        let mut setup_model = test_setup_model();
        setup_model.cyl_spheres.clear();
        setup_model.spheres.push(Sphere {
            center: Vector3::zero(),
            radius: 1.0,
        });
        setup_model.sorting_sphere.radius = 12.0;
        let frame = LandblockPlacement {
            origin: Vector3::new(10.0, 20.0, 0.0),
            orientation: Quaternion::identity(),
        };

        assert!(!setup_model_boundary_within_landblock(
            &setup_model,
            false,
            &frame
        ));
    }

    #[test]
    fn direct_gfx_without_physics_uses_origin_and_ignores_drawing_sphere() {
        let mut gfx_obj = test_gfx_obj();
        gfx_obj.drawing_bsp = Some(test_leaf_bsp(Vector3::zero(), 100.0));
        let frame = LandblockPlacement {
            origin: Vector3::new(1.0, 1.0, 0.0),
            orientation: Quaternion::identity(),
        };

        assert!(
            gfx_obj_within_landblock(&gfx_obj, &frame)
                .expect("origin-only direct GfxObj predicate should resolve")
        );
    }

    #[test]
    fn direct_gfx_physics_uses_unscaled_root_sphere() {
        let mut gfx_obj = test_gfx_obj();
        gfx_obj.physics_bsp = Some(test_leaf_bsp(Vector3::zero(), 3.0));
        let frame = LandblockPlacement {
            origin: Vector3::new(1.0, 10.0, 0.0),
            orientation: Quaternion::identity(),
        };

        assert!(
            !gfx_obj_within_landblock(&gfx_obj, &frame)
                .expect("physics-sphere direct GfxObj predicate should resolve")
        );
    }

    #[test]
    fn terrain_sampling_uses_each_authored_triangle_and_first_polygon_at_diagonal() {
        for southwest_to_northeast in [false, true] {
            let (terrain, column, row) = test_terrain(southwest_to_northeast);
            let cases = if southwest_to_northeast {
                [
                    (0.75, 0.25, 23.0, Vector3::new(-0.25, 0.25, 1.0)),
                    (0.25, 0.75, 20.0, Vector3::new(0.0, 0.0, 1.0)),
                    (0.5, 0.5, 20.0, Vector3::new(-0.25, 0.25, 1.0)),
                ]
            } else {
                [
                    (0.25, 0.25, 21.5, Vector3::new(-0.25, 0.0, 1.0)),
                    (0.75, 0.75, 21.5, Vector3::new(0.0, 0.25, 1.0)),
                    (0.5, 0.5, 23.0, Vector3::new(-0.25, 0.0, 1.0)),
                ]
            };
            for (x, y, height, normal) in cases {
                let sample = sample_landblock_terrain(
                    &terrain,
                    (column as f32 + x) * terrain.tile_size,
                    (row as f32 + y) * terrain.tile_size,
                )
                .expect("synthetic terrain should sample");
                assert!((sample.origin.z - height).abs() < 1e-5);
                assert_vector_near(sample.normal, normal.normalize());
            }
        }
    }

    #[test]
    fn triangle_normal_drives_slope_acceptance_and_flat_alignment() {
        let (terrain, column, row) = test_terrain(true);
        let mut template = test_template();
        template.align = 1;
        template.min_slope = 0.99;
        template.base_frame.origin.z = 123.0;
        let sample = |x, y| {
            sample_landblock_terrain(
                &terrain,
                (column as f32 + x) * terrain.tile_size,
                (row as f32 + y) * terrain.tile_size,
            )
            .expect("synthetic terrain should sample")
        };
        let flat = sample(0.25, 0.75);
        let slope = sample(0.75, 0.25);
        assert!(generated_template_matches_slope(&template, flat.normal.z));
        assert!(!generated_template_matches_slope(&template, slope.normal.z));
        let expected_origin = Vector3::new(
            (column as f32 + 0.25) * terrain.tile_size,
            (row as f32 + 0.75) * terrain.tile_size,
            20.0,
        );
        let frame = build_generated_template_frame(&template, 0, 0, 0, flat);
        assert_eq!(frame.origin, expected_origin);
        assert_vector_near(
            frame.orientation.rotate_vector(Vector3::new(0.0, 1.0, 0.0)),
            Vector3::new(0.0, 1.0, 0.0),
        );
    }

    #[test]
    fn aligned_scenery_faces_downhill_in_authored_axes() {
        let mut template = test_template();
        template.align = 1;
        for downhill in [
            Vector3::new(1.0, 0.0, 0.0),
            Vector3::new(0.0, -1.0, 0.0),
            Vector3::new(-1.0, 1.0, 0.0),
        ] {
            let frame = build_generated_template_frame(
                &template,
                0,
                0,
                0,
                TerrainSample {
                    origin: Vector3::zero(),
                    normal: Vector3::new(-downhill.x, -downhill.y, 1.0).normalize(),
                },
            );
            assert_vector_near(
                frame.orientation.rotate_vector(Vector3::new(0.0, 1.0, 0.0)),
                downhill.normalize(),
            );
        }
    }

    #[test]
    fn scenery_uses_authored_heights_on_water() {
        let (mut terrain, column, row) = test_terrain(true);
        terrain.terrain_samples.fill(0x10 << 2);
        let sample = sample_landblock_terrain(
            &terrain,
            (column as f32 + 0.25) * terrain.tile_size,
            (row as f32 + 0.75) * terrain.tile_size,
        )
        .expect("authored water terrain should sample");
        assert_eq!(sample.origin.z, 20.0);
        assert_vector_near(sample.normal, Vector3::new(0.0, 0.0, 1.0));
    }

    #[test]
    fn random_rotation_uses_retail_clockwise_heading() {
        let frame = build_generated_template_frame(
            &test_template(),
            0,
            0,
            0,
            TerrainSample {
                origin: Vector3::zero(),
                normal: Vector3::new(0.0, 0.0, 1.0),
            },
        );
        // Retail ObjectDesc::GetObjFrame for x=y=k=0 and max_rot=360.
        let radians = 285.792_88_f32.to_radians();
        assert_vector_near(
            frame.orientation.rotate_vector(Vector3::new(0.0, 1.0, 0.0)),
            Vector3::new(radians.sin(), radians.cos(), 0.0),
        );
    }

    #[test]
    fn heading_reconstruction_retains_normalized_forward_pitch_and_removes_roll() {
        let (sin, cos) = (std::f32::consts::FRAC_PI_4).sin_cos();
        let base = Quaternion {
            w: cos,
            x: sin,
            y: 0.0,
            z: 0.0,
        };
        let pitched = set_generated_heading(base, 90.0);
        let diagonal = std::f32::consts::FRAC_1_SQRT_2;
        assert_vector_near(
            pitched.rotate_vector(Vector3::new(0.0, 1.0, 0.0)),
            Vector3::new(diagonal, 0.0, diagonal),
        );
        let rolled = Quaternion {
            w: cos,
            x: 0.0,
            y: sin,
            z: 0.0,
        };
        assert_vector_near(
            set_generated_heading(rolled, 0.0).rotate_vector(Vector3::new(0.0, 0.0, 1.0)),
            Vector3::new(0.0, 0.0, 1.0),
        );
    }

    #[test]
    fn unrotated_template_preserves_authored_orientation() {
        let mut template = test_template();
        template.max_rotation_degrees = 0.0;
        template.base_frame.orientation = Quaternion {
            w: 0.5,
            x: 0.5,
            y: 0.5,
            z: 0.5,
        };
        let frame = build_generated_template_frame(
            &template,
            0,
            0,
            0,
            TerrainSample {
                origin: Vector3::zero(),
                normal: Vector3::new(0.0, 0.0, 1.0),
            },
        );
        assert_eq!(frame.orientation, template.base_frame.orientation);
    }

    #[test]
    fn boundary_acceptance_rotates_sphere_center_with_pitch() {
        let frame = LandblockPlacement {
            origin: Vector3::new(10.0, 1.0, 0.0),
            orientation: Quaternion {
                w: std::f32::consts::FRAC_1_SQRT_2,
                x: std::f32::consts::FRAC_1_SQRT_2,
                y: 0.0,
                z: 0.0,
            },
        };
        // Pitch rotates the elevated local center south across the block edge.
        assert!(!placed_circle_within_landblock(
            &frame,
            Vector3::new(0.0, 0.0, 3.0),
            0.5
        ));
    }

    fn assert_vector_near(actual: Vector3, expected: Vector3) {
        assert!(
            (actual - expected).length() < 1e-5,
            "actual {actual:?}, expected {expected:?}"
        );
    }

    fn test_template() -> SceneObjectTemplate {
        SceneObjectTemplate {
            object_id: 0x01000001,
            base_frame: holtburger_dat::file_type::scene::SceneFrame {
                origin: Vector3::zero(),
                orientation: Quaternion::identity(),
            },
            frequency: 1.0,
            displace_x: 0.0,
            displace_y: 0.0,
            min_scale: 1.0,
            max_scale: 1.0,
            max_rotation_degrees: 360.0,
            min_slope: 0.0,
            max_slope: 1.0,
            align: 0,
            orient: 0,
            weenie_object_id: 0,
        }
    }

    fn test_terrain(southwest_to_northeast: bool) -> (LandblockTerrain, usize, usize) {
        let grid_size = crate::TERRAIN_GRID_CELLS + 1;
        let mut terrain = LandblockTerrain {
            grid_size,
            tile_size: GENERATED_SCENERY_CELL_SIZE,
            height_indices: vec![0; grid_size * grid_size],
            heights: vec![20.0; grid_size * grid_size],
            terrain_samples: vec![0; grid_size * grid_size],
            cell_diagonals: crate::TerrainCellDiagonals::for_landblock(0xa25fffff),
        };
        for row in 0..crate::TERRAIN_GRID_CELLS {
            for column in 0..crate::TERRAIN_GRID_CELLS {
                if terrain
                    .cell_diagonals
                    .uses_southwest_to_northeast_cut(column, row)
                    == southwest_to_northeast
                {
                    terrain.heights[row * grid_size + column + 1] = 26.0;
                    return (terrain, column, row);
                }
            }
        }
        panic!("fixture landblock must have both diagonal directions");
    }

    fn test_setup_model() -> SetupModel {
        SetupModel {
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
            lights: Vec::new(),
            default_animation: None,
            default_script_did: None,
            default_motion_table: None,
            default_sound_table: None,
            default_script_table: None,
        }
    }

    fn test_gfx_obj() -> GfxObj {
        GfxObj {
            id: 0x0100_0001,
            flags: GfxObjFlags::empty(),
            surfaces: Vec::new(),
            vertex_array: holtburger_dat::graphics::CVertexArray::new(),
            physics_polygons: HashMap::new(),
            physics_bsp: None,
            sort_center: Vector3::zero(),
            polygons: HashMap::new(),
            drawing_bsp: None,
            did_degrade: None,
        }
    }

    fn test_leaf_bsp(center: Vector3, radius: f32) -> BspNode {
        BspNode::Leaf(BspLeaf {
            index: 0,
            solid: 0,
            sphere: Some(Sphere { center, radius }),
            poly_ids: Vec::new(),
        })
    }
}
