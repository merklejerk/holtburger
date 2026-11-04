//! Software Gouraud baking with the minimap's proven boundary-normal policy.

use anyhow::{Context, Result, ensure};
use holtburger_content::{
    ActiveRegionData, ContentDecodeCache, ContentRepository, LandblockTerrain, TexturePixelFormat,
};
use std::{
    collections::HashMap,
    sync::atomic::{AtomicBool, Ordering},
};

use super::format::{CELLS, SIDE, TERRAIN_TYPES, VERTICES};

pub(super) fn check_running(stop: &AtomicBool) -> Result<()> {
    ensure!(
        !stop.load(Ordering::Acquire),
        "world-map preparation stopped"
    );
    Ok(())
}

pub(super) fn palette(
    repository: &ContentRepository,
    region: &ActiveRegionData,
    stop: &AtomicBool,
) -> Result<[[f32; 3]; TERRAIN_TYPES]> {
    let materials = repository.resolve_terrain_material_table(region.descriptor.region_number)?;
    let mut colors = [None; TERRAIN_TYPES];
    let mut means = HashMap::new();
    for material in materials.terrain_types {
        check_running(stop)?;
        let code = material.terrain_type as usize;
        if code >= TERRAIN_TYPES {
            continue;
        } // The separate road surface is not map ground cover.
        let mean = match means.get(&material.texture_id) {
            Some(mean) => *mean,
            None => {
                let surface = repository.resolve_surface_texture_pixels(
                    material.texture_id,
                    TexturePixelFormat::Rgba8,
                )?;
                let mean = crate::terrain_color::mean_rgb_rgba8(
                    surface.width,
                    surface.height,
                    &surface.pixels,
                )?;
                means.insert(material.texture_id, mean);
                mean
            }
        };
        ensure!(
            colors[code].replace(mean).is_none(),
            "duplicate terrain diffuse code {code}"
        );
    }
    let mut palette = [[0.0; 3]; TERRAIN_TYPES];
    for (code, color) in colors.into_iter().enumerate() {
        palette[code] = color.with_context(|| format!("missing terrain diffuse code {code}"))?;
    }
    Ok(palette)
}

fn normal_at(heights: &[f32], spacing: f32, row: usize, column: usize) -> [f32; 3] {
    // Match map-terrain-mesh.ts: crossing gradients vanish at a block edge, while the
    // along-edge gradient remains. Renderer Z is the negative of canonical north.
    let dx = if column == 0 || column == SIDE - 1 {
        0.0
    } else {
        (heights[row * SIDE + column + 1] - heights[row * SIDE + column - 1]) / (2.0 * spacing)
    };
    let dz = if row == 0 || row == SIDE - 1 {
        0.0
    } else {
        -(heights[(row + 1) * SIDE + column] - heights[(row - 1) * SIDE + column]) / (2.0 * spacing)
    };
    let length = dx.hypot(1.0).hypot(dz);
    [-dx / length, 1.0 / length, -dz / length]
}

/// Temporary per-block Gouraud inputs, dropped at the end of each image tile.
struct LitBlock {
    /// Already-lit diffuse color at the canonical south-first vertices.
    colors: [[f32; 3]; VERTICES],
    /// Canonical finest-cell diagonals for triangle interpolation.
    diagonals: [u8; CELLS * CELLS],
}

/// Bake a tile using the authored terrain query regardless of scene classification and job-local decode cache.
pub(super) fn generate_tile(
    repository: &ContentRepository,
    cache: &ContentDecodeCache,
    region: &ActiveRegionData,
    spec: &super::format::BakeSpec,
    tile: &super::format::ImageTile,
    colors: &[[f32; 3]; TERRAIN_TYPES],
    stop: &AtomicBool,
) -> Result<Vec<u8>> {
    bake_tile(spec, tile, colors, stop, |id| {
        holtburger_content::landblock::read_landblock_terrain(repository, cache, region, id)
    })
}

fn light_block(
    terrain: &LandblockTerrain,
    palette: &[[f32; 3]; TERRAIN_TYPES],
    sun: [f32; 3],
    ambient: f32,
) -> Result<LitBlock> {
    ensure!(
        terrain.grid_size == SIDE
            && terrain.heights.len() == VERTICES
            && terrain.terrain_samples.len() == VERTICES,
        "world-map terrain grid shape mismatch"
    );
    ensure!(
        terrain.tile_size == super::format::TILE_METERS,
        "world-map terrain spacing mismatch"
    );
    ensure!(
        terrain.heights.iter().all(|height| height.is_finite()),
        "world-map terrain height is not finite"
    );
    let mut colors = [[0.0; 3]; VERTICES];
    for (vertex, color) in colors.iter_mut().enumerate() {
        let normal = normal_at(
            &terrain.heights,
            terrain.tile_size,
            vertex / SIDE,
            vertex % SIDE,
        );
        ensure!(
            normal.iter().all(|value| value.is_finite()),
            "world-map terrain normal is not finite"
        );
        let dot = normal.iter().zip(sun).map(|(a, b)| a * b).sum::<f32>();
        let light = ambient + (1.0 - ambient) * dot.max(0.0);
        let code = usize::from((terrain.terrain_samples[vertex] >> 2) & 0x1f);
        *color = palette[code].map(|value| value * light);
    }
    Ok(LitBlock {
        colors,
        diagonals: std::array::from_fn(|cell| {
            u8::from(
                terrain
                    .cell_diagonals
                    .uses_southwest_to_northeast_cut(cell % CELLS, cell / CELLS),
            )
        }),
    })
}

fn interpolate_cell(block: &LitBlock, x: f64, north: f64) -> [f32; 3] {
    let column = x.floor() as usize;
    let row = north.floor() as usize;
    let u = (x - column as f64) as f32;
    let v = (north - row as f64) as f32;
    let sw = row * SIDE + column;
    let se = sw + 1;
    let nw = sw + SIDE;
    let ne = nw + 1;
    let (vertices, weights) = if block.diagonals[row * CELLS + column] == 1 {
        if v <= u {
            ([sw, se, ne], [1.0 - u, u - v, v])
        } else {
            ([sw, ne, nw], [1.0 - v, u, v - u])
        }
    } else if u + v <= 1.0 {
        ([sw, se, nw], [1.0 - u - v, u, v])
    } else {
        ([ne, nw, se], [u + v - 1.0, 1.0 - u, 1.0 - v])
    };
    std::array::from_fn(|axis| {
        vertices
            .into_iter()
            .zip(weights)
            .map(|(vertex, weight)| block.colors[vertex][axis] * weight)
            .sum()
    })
}

/// Sample global pixel centers, so independent tile boundaries never alter source coordinates.
fn bake_tile(
    spec: &super::format::BakeSpec,
    tile: &super::format::ImageTile,
    palette: &[[f32; 3]; TERRAIN_TYPES],
    stop: &AtomicBool,
    mut read_terrain: impl FnMut(u32) -> Result<Option<LandblockTerrain>>,
) -> Result<Vec<u8>> {
    let length = spec
        .sun_direction
        .into_iter()
        .map(|value| value * value)
        .sum::<f32>()
        .sqrt();
    let sun = spec.sun_direction.map(|value| value / length);
    let mut blocks: HashMap<u32, Option<LitBlock>> = HashMap::new();
    let mut pixels = vec![0; tile.width * tile.height * 4];
    let block_meters = f64::from(super::format::BLOCK_METERS);
    let cell_meters = f64::from(super::format::TILE_METERS);
    for y in 0..tile.height {
        check_running(stop)?;
        let z = f64::from(spec.bounds.min_z)
            + ((tile.y + y) as f64 + 0.5) * f64::from(spec.bounds.max_z - spec.bounds.min_z)
                / spec.height as f64;
        let block_north = (-z / block_meters).floor() as u32;
        let local_north = (-z - f64::from(block_north) * block_meters) / cell_meters;
        for x in 0..tile.width {
            let world_x = f64::from(spec.bounds.min_x)
                + ((tile.x + x) as f64 + 0.5) * f64::from(spec.bounds.max_x - spec.bounds.min_x)
                    / spec.width as f64;
            let block_east = (world_x / block_meters).floor() as u32;
            let id = (block_east << 24) | (block_north << 16) | 0xffff;
            let block = match blocks.entry(id) {
                std::collections::hash_map::Entry::Occupied(entry) => entry.into_mut(),
                std::collections::hash_map::Entry::Vacant(entry) => {
                    check_running(stop)?;
                    entry.insert(
                        read_terrain(id)
                            .with_context(|| format!("world-map terrain {id:08x}"))?
                            .map(|terrain| light_block(&terrain, palette, sun, spec.ambient))
                            .transpose()
                            .with_context(|| format!("world-map terrain {id:08x}"))?,
                    )
                }
            };
            if let Some(block) = block {
                let local_x = (world_x - f64::from(block_east) * block_meters) / cell_meters;
                let color = interpolate_cell(block, local_x, local_north);
                let offset = (y * tile.width + x) * 4;
                for (target, value) in pixels[offset..offset + 3].iter_mut().zip(color) {
                    *target = (value.clamp(0.0, 1.0) * 255.0).round() as u8;
                }
                pixels[offset + 3] = 255;
            }
        }
    }
    Ok(pixels)
}

#[cfg(test)]
mod raster_tests {
    use super::super::format::{BakeSpec, ImageTile, MapBounds};
    use super::*;

    fn terrain(code: usize) -> LandblockTerrain {
        LandblockTerrain {
            grid_size: SIDE,
            tile_size: super::super::format::TILE_METERS,
            height_indices: vec![0; VERTICES],
            heights: vec![0.0; VERTICES],
            terrain_samples: vec![(code as u16) << 2; VERTICES],
            cell_diagonals: holtburger_content::TerrainCellDiagonals::for_landblock(0x0105_ffff),
        }
    }

    fn spec(width: usize, height: usize, blocks: f32) -> BakeSpec {
        let extent = blocks * super::super::format::BLOCK_METERS;
        BakeSpec {
            width,
            height,
            bounds: MapBounds {
                min_x: 0.0,
                min_z: -extent,
                max_x: extent,
                max_z: 0.0,
            },
            sun_direction: [-1.0, 1.0, -1.0],
            ambient: 1.0,
        }
    }

    #[test]
    fn canonical_triangles_interpolate_lit_vertex_colors() {
        let mut block = LitBlock {
            colors: [[0.0; 3]; VERTICES],
            diagonals: [0; CELLS * CELLS],
        };
        block.colors[0] = [1.0, 0.0, 0.0];
        block.colors[1] = [0.0, 1.0, 0.0];
        block.colors[SIDE] = [0.0, 0.0, 1.0];
        block.colors[SIDE + 1] = [1.0, 1.0, 1.0];
        assert_eq!(interpolate_cell(&block, 0.25, 0.25), [0.5, 0.25, 0.25]);
        assert_eq!(interpolate_cell(&block, 0.75, 0.75), [0.5, 0.75, 0.75]);
        block.diagonals[0] = 1;
        assert_eq!(interpolate_cell(&block, 0.75, 0.25), [0.5, 0.75, 0.25]);
        assert_eq!(interpolate_cell(&block, 0.25, 0.75), [0.5, 0.25, 0.75]);
    }

    #[test]
    fn north_up_pixels_use_global_coordinates_and_preserve_absence() {
        let spec = spec(2, 2, 2.0);
        let tile = ImageTile {
            x: 0,
            y: 0,
            width: 2,
            height: 2,
        };
        let mut palette = [[0.0; 3]; TERRAIN_TYPES];
        palette[0] = [1.0, 0.0, 0.0];
        palette[1] = [0.0, 1.0, 0.0];
        palette[2] = [0.0, 0.0, 1.0];
        let mut reads = Vec::new();
        let pixels = bake_tile(&spec, &tile, &palette, &AtomicBool::new(false), |id| {
            reads.push(id);
            let east = id >> 24;
            let north = (id >> 16) & 0xff;
            Ok(if east == 1 && north == 0 {
                None
            } else {
                Some(terrain((north * 2 + east) as usize))
            })
        })
        .unwrap();
        assert_eq!(reads, [0x0001_ffff, 0x0101_ffff, 0x0000_ffff, 0x0100_ffff]);
        assert_eq!(
            pixels,
            [0, 0, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255, 0, 0, 0, 0]
        );
    }

    #[test]
    fn independent_tiles_match_one_image_and_decode_each_intersecting_block_once() {
        let spec = spec(4, 3, 1.0);
        let palette = std::array::from_fn(|code| [code as f32 / CELLS as f32, 0.0, 0.0]);
        let bake = |tile: ImageTile| {
            let mut reads = 0;
            let result = bake_tile(&spec, &tile, &palette, &AtomicBool::new(false), |_| {
                reads += 1;
                let mut t = terrain(0);
                for (vertex, sample) in t.terrain_samples.iter_mut().enumerate() {
                    *sample = ((vertex % SIDE) as u16) << 2;
                }
                Ok(Some(t))
            })
            .unwrap();
            assert_eq!(reads, 1);
            result
        };
        let whole = bake(ImageTile {
            x: 0,
            y: 0,
            width: 4,
            height: 3,
        });
        let left = bake(ImageTile {
            x: 0,
            y: 0,
            width: 2,
            height: 3,
        });
        let right = bake(ImageTile {
            x: 2,
            y: 0,
            width: 2,
            height: 3,
        });
        for row in 0..3 {
            assert_eq!(&whole[row * 16..row * 16 + 8], &left[row * 8..row * 8 + 8]);
            assert_eq!(
                &whole[row * 16 + 8..row * 16 + 16],
                &right[row * 8..row * 8 + 8]
            );
        }
    }

    #[test]
    fn plane_normals_and_fixed_lighting_match_the_existing_convention() {
        let mut t = terrain(0);
        t.heights = (0..VERTICES)
            .map(|i| (2 * (i % SIDE) + 3 * (i / SIDE)) as f32 * t.tile_size)
            .collect();
        let length = 14.0_f32.sqrt();
        let normal = normal_at(&t.heights, t.tile_size, 4, 4);
        for (actual, expected) in
            normal
                .into_iter()
                .zip([-2.0 / length, 1.0 / length, 3.0 / length])
        {
            assert!((actual - expected).abs() < 0.00001);
        }
        assert_eq!(normal_at(&t.heights, t.tile_size, 0, 0), [0.0, 1.0, 0.0]);
        let palette = [[0.5; 3]; TERRAIN_TYPES];
        let lit = light_block(&t, &palette, [0.0, 1.0, 0.0], 0.25).unwrap();
        let expected = 0.5 * (0.25 + 0.75 / length);
        assert!((lit.colors[4 * SIDE + 4][0] - expected).abs() < 0.00001);
    }

    #[test]
    fn invalid_terrain_and_cancellation_fail_instead_of_painting_black() {
        let spec = spec(1, 1, 1.0);
        let tile = ImageTile {
            x: 0,
            y: 0,
            width: 1,
            height: 1,
        };
        let palette = [[0.5; 3]; TERRAIN_TYPES];
        let mut invalid = terrain(0);
        invalid.heights[0] = f32::NAN;
        assert!(
            bake_tile(&spec, &tile, &palette, &AtomicBool::new(false), |_| Ok(
                Some(invalid.clone())
            ))
            .unwrap_err()
            .to_string()
            .contains("0000ffff")
        );
        assert!(
            bake_tile(&spec, &tile, &palette, &AtomicBool::new(true), |_| Ok(
                Some(terrain(0))
            ))
            .unwrap_err()
            .to_string()
            .contains("stopped")
        );
    }

    #[test]
    fn world_tiles_partition_the_image_without_padding_the_source_domain() {
        let spec = BakeSpec::world();
        let tiles = spec.tiles();
        assert_eq!(
            tiles.len(),
            (spec.width / super::super::format::IMAGE_TILE_SIDE).pow(2)
        );
        let mut covered = vec![false; spec.width * spec.height];
        for tile in tiles {
            for row in tile.y..tile.y + tile.height {
                for column in tile.x..tile.x + tile.width {
                    let index = row * spec.width + column;
                    assert!(!covered[index]);
                    covered[index] = true;
                }
            }
        }
        assert!(covered.into_iter().all(|value| value));
        assert_eq!(
            spec.bounds.max_x,
            super::super::format::BLOCKS_PER_AXIS as f32 * super::super::format::BLOCK_METERS
        );
    }
}
