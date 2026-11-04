//! Authored server visibility, independent of renderer and predicted remote-body placement.

use std::collections::{HashMap, HashSet};

use crate::{CollisionScene, WorldState};
use holtburger_common::{Guid, position::WorldPosition};

/// Evidence for one entity at the world-tick boundary; missing data never proves exclusion.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum EntityVisibility {
    /// Included by the observer's current cell or its outdoor contribution.
    Visible,
    /// Excluded by complete facts needed for this candidate.
    Outside,
    /// At least one fact required to decide inclusion is absent.
    Unavailable,
}

/// Tick-local observations are shared by expiry and deadline maintenance, never retained as state.
pub(super) struct VisibilitySnapshot {
    /// Accepted network pose guards observations against deferred placement changes in this tick.
    entities: HashMap<Guid, (WorldPosition, EntityVisibility)>,
}

impl VisibilitySnapshot {
    pub fn capture(world: &WorldState, scene: Option<&CollisionScene>) -> Self {
        let scope = ObserverScope::new(world.local_player_runtime_pose(), scene);
        Self {
            entities: world
                .entities
                .iter()
                .map(|entity| {
                    (
                        entity.guid,
                        (entity.position, scope.classify(entity.position, scene)),
                    )
                })
                .collect(),
        }
    }

    pub fn get(&self, guid: Guid, position: WorldPosition) -> EntityVisibility {
        match self.entities.get(&guid) {
            Some((observed, visibility)) if *observed == position => *visibility,
            // A deferred position will be classified against its new room on the next tick.
            _ => EntityVisibility::Unavailable,
        }
    }
}

/// One observer's directed indoor set and optional outdoor-neighborhood contribution.
enum ObserverScope {
    /// No accepted observer position or no authored metadata for its current interior cell.
    Unavailable,
    /// Complete observer facts; candidate SeenOutside metadata may still be unavailable.
    Ready {
        /// Committed local position, matching the local movement publication domain.
        position: WorldPosition,
        /// Direct authored cell IDs including the observer's cell; empty for outdoor observers.
        indoor_cells: HashSet<Guid>,
        /// Whether the outdoor neighborhood contributes to this scope.
        outdoors: bool,
    },
}

impl ObserverScope {
    fn new(position: Option<WorldPosition>, scene: Option<&CollisionScene>) -> Self {
        let Some(position) = position.filter(|pose| pose.landblock_id != Guid::NULL) else {
            return Self::Unavailable;
        };
        if !is_env_cell(position) {
            return Self::Ready {
                position,
                indoor_cells: HashSet::new(),
                outdoors: true,
            };
        }
        let Some(cell) = scene.and_then(|scene| scene.cell_visibility(position.landblock_id))
        else {
            return Self::Unavailable;
        };
        let owner = position.landblock_id.0 & 0xffff_0000;
        let mut indoor_cells: HashSet<_> = cell
            .visible_cell_selectors
            .iter()
            .map(|cell| Guid(owner | u32::from(*cell)))
            .collect();
        indoor_cells.insert(position.landblock_id);
        Self::Ready {
            position,
            indoor_cells,
            outdoors: cell.seen_outside,
        }
    }

    fn classify(
        &self,
        candidate: WorldPosition,
        scene: Option<&CollisionScene>,
    ) -> EntityVisibility {
        let Self::Ready {
            position,
            indoor_cells,
            outdoors,
        } = self
        else {
            return EntityVisibility::Unavailable;
        };
        if candidate.landblock_id == Guid::NULL {
            return EntityVisibility::Unavailable;
        }
        if indoor_cells.contains(&candidate.landblock_id) {
            return EntityVisibility::Visible;
        }
        if !outdoors
            || position
                .landblock_chebyshev_distance_to(&candidate)
                .is_none_or(|distance| distance > 1)
        {
            return EntityVisibility::Outside;
        }
        if !is_env_cell(candidate) {
            return EntityVisibility::Visible;
        }
        match scene.and_then(|scene| scene.cell_visibility(candidate.landblock_id)) {
            Some(cell) if cell.seen_outside => EntityVisibility::Visible,
            Some(_) => EntityVisibility::Outside,
            None => EntityVisibility::Unavailable,
        }
    }
}

/// Normalized outdoor owner IDs are valid positions but are not EnvCells.
fn is_env_cell(position: WorldPosition) -> bool {
    position.is_indoors() && position.landblock_id.0 & 0xffff != 0xffff
}

#[cfg(test)]
mod tests;
