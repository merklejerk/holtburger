//! Terrain penetration is a height-field constraint, independent of finite-object step admission.

use super::*;
use crate::spatial::bsp_query::{CONTACT_EPSILON, SupportProbe};

impl CollisionScene {
    /// Return the vertical correction that clears terrain across the primary sphere footprint.
    ///
    /// Retail behavior is to lift a penetrating outdoor body to its terrain polygon without applying
    /// the step-height limit. Collision reinsertion validates the corrected endpoint; the lift
    /// does not sweep the intervening space. A census of 1,577 evaluable outdoor portal templates
    /// found 101 arrivals at 28 distinct destinations over 0.6 units below rendered terrain.
    /// These are candidates rather than confirmed failures; water and stale templates qualify
    /// that count. The terrain/ceiling reference fixture establishes endpoint-only admission.
    pub(in crate::spatial) fn terrain_penetration(
        &self,
        request: PlacementRequest<'_>,
    ) -> Result<Option<f32>, CollisionQueryError> {
        if !request.placement.reaches_outdoors() {
            return Ok(None);
        }
        let touched = touched_landblocks(SphereSweep {
            anchor: request.anchor,
            start: request.center,
            end: request.center,
            radius: request.radius,
        });
        self.require_query_coverage(&touched, request.placement)?;
        // Terrain reinsertion has no step-height cap. Reuse standing terrain's finite
        // footprint admission and plane clearance rather than selecting only the center face.
        let probe = SupportProbe::Column {
            maximum_drop: 0.0,
            maximum_rise: f32::MAX,
        };
        let mut correction: Option<f32> = None;
        for owner in touched {
            let asset = self
                .landblock_asset(owner)
                .ok_or(CollisionQueryError::UnavailableOwner { owner: owner.0 })?;
            let center = anchor_to_landblock(request.center, request.anchor, owner);
            for cell in overlapped_terrain_cells(&asset.terrain, center, request.radius) {
                for triangle in &cell.immersed_triangles {
                    let plane_d = -triangle.normal.dot(&triangle.vertices[0]);
                    if let Some(support) = probe.on_polygon(
                        || triangle.vertices.iter().copied(),
                        triangle.normal,
                        plane_d,
                        center,
                        request.radius,
                    ) && support.height_delta * triangle.normal.z > CONTACT_EPSILON
                    {
                        correction = Some(correction.map_or(support.height_delta, |current| {
                            current.max(support.height_delta)
                        }));
                    }
                }
            }
        }
        Ok(correction)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_content::{
        LandblockTerrain, TERRAIN_GRID_CELLS, TerrainCellDiagonals, TerrainCollisionSurface,
    };

    #[test]
    fn terrain_recovery_clears_a_sphere_straddling_a_diagonal_in_another_anchor() {
        let owner = Guid(0xda55_ffff);
        let side = TERRAIN_GRID_CELLS + 1;
        let tile = METERS_PER_LANDBLOCK / TERRAIN_GRID_CELLS as f32;
        let diagonals = TerrainCellDiagonals::for_landblock(owner.0);
        let (column, row) = (3, 3);
        let southwest_cut = diagonals.uses_southwest_to_northeast_cut(column, row);
        let mut heights = vec![0.0; side * side];
        let high_vertex = if southwest_cut {
            (column, row + 1)
        } else {
            (column + 1, row + 1)
        };
        heights[high_vertex.1 * side + high_vertex.0] = tile;
        let terrain = TerrainCollisionSurface::from_terrain(&LandblockTerrain {
            grid_size: side,
            tile_size: tile,
            height_indices: vec![0; side * side],
            heights,
            terrain_samples: vec![0; side * side],
            cell_diagonals: diagonals,
        })
        .unwrap();
        let mut scene = CollisionScene::new();
        scene
            .insert(LandblockCollisionAsset {
                landblock_id: owner.0,
                terrain,
                static_geometry: Default::default(),
            })
            .unwrap();
        // The center lies over the flat polygon, but the sphere also reaches its sloped neighbor.
        let center = Vector3::new(
            (column as f32 + if southwest_cut { 0.501 } else { 0.499 }) * tile,
            (row as f32 + 0.499) * tile,
            0.25,
        );
        let placement = SpatialMembership::outdoor();
        for anchor in [owner, Guid(owner.0 - (1 << 24))] {
            let center = center
                + Vector3::new(
                    if anchor == owner {
                        0.0
                    } else {
                        METERS_PER_LANDBLOCK
                    },
                    0.0,
                    0.0,
                );
            let request = PlacementRequest {
                anchor,
                center,
                radius: 0.5,
                placement: &placement,
            };
            let lift = scene.terrain_penetration(request).unwrap().unwrap();
            assert!(
                lift > request.radius - request.center.z,
                "the adjacent slope must raise the sphere above the flat plane"
            );
            let corrected = PlacementRequest {
                center: center + Vector3::new(0.0, 0.0, lift),
                ..request
            };
            let contacts = scene.placement_contacts(corrected).unwrap();
            assert!(
                contacts
                    .iter()
                    .all(|contact| contact.depth <= CONTACT_EPSILON),
                "corrected sphere still overlaps terrain: {contacts:?}"
            );
            assert_eq!(
                scene.terrain_penetration(corrected).unwrap(),
                None,
                "a clear sphere must not be raised again"
            );
        }
    }
}
