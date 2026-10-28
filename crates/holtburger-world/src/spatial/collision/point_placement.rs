//! Point containment independent of portal history, body shapes, and contact solving.

use holtburger_common::{Guid, position::WorldPosition};
use holtburger_content::LandblockCollisionAsset;

use super::{
    CollisionQueryError, CollisionScene, SphereSweep, anchor_to_landblock, landblock_key,
    outdoor_landblock_owner_at, validate_point_sweep, volume_reaches,
};

/// Complete geometric outcomes for one point in the current immutable scene snapshot.
#[derive(Debug, Clone, PartialEq)]
pub enum PointPlacement {
    /// One containing interior cell, or canonical outdoor placement where terrain exists.
    Unique(WorldPosition),
    /// Several containing cells, sorted by identity; the caller owns preference/history policy.
    Overlapping { candidates: Vec<WorldPosition> },
    /// All required geometry is available, but the point has no valid domain.
    Outside,
    /// Coverage must be acquired before this point can be classified.
    Unavailable { owner: Guid },
}

impl CollisionScene {
    /// Resolves a point without requiring a swept path from its previous placement.
    ///
    /// The caller chooses the reference point (for example a reported body origin or a sphere
    /// center). Search the authored owner first: dungeon coordinates can be negative or outside
    /// its geographic square. Only outdoor-capable geometry permits geographic reanchoring.
    pub fn point_placement(
        &self,
        candidate: WorldPosition,
    ) -> Result<PointPlacement, CollisionQueryError> {
        if candidate.landblock_id == Guid::NULL {
            return Err(CollisionQueryError::NullPlacement);
        }
        validate_point_sweep(SphereSweep {
            anchor: candidate.landblock_id,
            start: candidate.coords,
            end: candidate.coords,
            radius: 0.0,
        })?;
        let owner = landblock_key(candidate.landblock_id);
        let Some(asset) = self.landblock_asset(owner) else {
            return Ok(PointPlacement::Unavailable { owner });
        };
        if let Some(placement) = containing_placement(asset, candidate) {
            return Ok(placement);
        }
        // An empty terrain surface explicitly represents an owner with no outdoor domain.
        // Never turn dungeon voids into outdoor cells based only on their X/Y coordinates.
        if asset.terrain.cells.is_empty() {
            return Ok(PointPlacement::Outside);
        }
        let Some(outdoor_owner) = outdoor_landblock_owner_at(owner, candidate.coords) else {
            return Ok(PointPlacement::Outside);
        };
        let local = anchor_to_landblock(candidate.coords, owner, outdoor_owner);
        let reanchored =
            WorldPosition::from_outdoor_frame(outdoor_owner, local, candidate.rotation);
        let Some(outdoor_asset) = self.landblock_asset(outdoor_owner) else {
            return Ok(PointPlacement::Unavailable {
                owner: outdoor_owner,
            });
        };
        if outdoor_owner != owner
            && let Some(placement) = containing_placement(outdoor_asset, reanchored)
        {
            return Ok(placement);
        }
        Ok(if outdoor_asset.terrain.cells.is_empty() {
            PointPlacement::Outside
        } else {
            PointPlacement::Unique(reanchored)
        })
    }
}

fn containing_placement(
    asset: &LandblockCollisionAsset,
    candidate: WorldPosition,
) -> Option<PointPlacement> {
    let mut candidates = asset
        .static_geometry
        .cell_volumes()
        .iter()
        .filter(|volume| volume_reaches(volume, candidate.coords, 0.0))
        .map(|volume| WorldPosition {
            landblock_id: Guid(
                (asset.landblock_id & 0xffff_0000) | u32::from(volume.cell_selector),
            ),
            ..candidate
        })
        .collect::<Vec<_>>();
    candidates.sort_by_key(|pose| pose.landblock_id);
    candidates.dedup_by_key(|pose| pose.landblock_id);
    match candidates.as_slice() {
        [] => None,
        [pose] => Some(PointPlacement::Unique(*pose)),
        _ => Some(PointPlacement::Overlapping { candidates }),
    }
}

#[cfg(test)]
mod tests;
