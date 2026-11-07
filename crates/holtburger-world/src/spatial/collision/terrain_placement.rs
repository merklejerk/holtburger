//! Terrain penetration is a height-field constraint, independent of finite-object step admission.

use super::*;
use crate::spatial::bsp_query::CONTACT_EPSILON;

impl CollisionScene {
    /// Return the required vertical correction from the polygon under the primary sphere's bottom.
    ///
    /// Retail behavior is to lift a penetrating outdoor body to this polygon without applying
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
        let Some(owner) = outdoor_landblock_owner_at(request.anchor, request.center) else {
            return Ok(None);
        };
        let asset = self
            .landblock_asset(owner)
            .ok_or(CollisionQueryError::UnavailableOwner { owner: owner.0 })?;
        if asset.terrain.cells.is_empty() {
            return Ok(None);
        }
        let center = anchor_to_landblock(request.center, request.anchor, owner);
        let Some(triangle) = overlapped_terrain_cells(&asset.terrain, center, 0.0)
            .flat_map(|cell| &cell.triangles)
            .find(|triangle| {
                (0..3).all(|index| {
                    let start = triangle.vertices[index];
                    let end = triangle.vertices[(index + 1) % 3];
                    (end.x - start.x) * (center.y - start.y)
                        - (end.y - start.y) * (center.x - start.x)
                        >= -CONTACT_EPSILON
                })
            })
        else {
            return Ok(None);
        };
        let distance = triangle.normal.dot(&(center - triangle.vertices[0]));
        let bottom_distance = distance - request.radius * triangle.normal.z;
        if bottom_distance >= -CONTACT_EPSILON {
            return Ok(None);
        }
        // Preserve the established full-sphere resting clearance on slopes. Penetration
        // selection uses retail's vertical bottom; finite footprint support stays bounded.
        Ok(Some((request.radius - distance) / triangle.normal.z))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_content::{
        LandblockTerrain, TERRAIN_GRID_CELLS, TerrainCellDiagonals, TerrainCollisionSurface,
    };

    #[test]
    fn recovery_samples_the_polygon_under_the_bottom_instead_of_the_sphere_footprint() {
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
        // The footprint straddles the diagonal, but its center lies over the flat first polygon.
        let center = Vector3::new(
            (column as f32 + if southwest_cut { 0.51 } else { 0.49 }) * tile,
            (row as f32 + 0.49) * tile,
            0.25,
        );
        let placement = SpatialMembership::outdoor();
        assert_eq!(
            scene
                .terrain_penetration(PlacementRequest {
                    anchor: owner,
                    center,
                    radius: 0.5,
                    placement: &placement,
                })
                .unwrap(),
            Some(0.25)
        );
    }
}
