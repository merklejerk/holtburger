use crate::dat::DatDatabase;
use crate::dat::file_type::gfx_obj::GfxObj;
use crate::dat::landblock::LandblockInfo;
use crate::world::position::WorldPosition;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Instant;

/// The SpatialScene is responsible for managing the "where" of everything.
/// It tracks entity positions by landblock and handles spatial queries.
pub struct SpatialScene {
    /// Entities indexed by LandblockID for fast local queries.
    pub landblock_map: HashMap<u32, HashSet<u32>>,

    /// Cache of object-level geometry (GfxObj from portal.dat).
    pub object_geometry: HashMap<u32, Arc<GeometryCacheEntry>>,

    /// Cache of landblock-level physical info (Stabs, buildings from cell.dat).
    pub landblock_info: HashMap<u32, Arc<LandblockInfo>>,
}

pub struct GeometryCacheEntry {
    pub gfx_obj: Arc<GfxObj>,
    pub last_accessed: Instant,
}

impl Default for SpatialScene {
    fn default() -> Self {
        Self::new()
    }
}

impl SpatialScene {
    pub fn new() -> Self {
        Self {
            landblock_map: HashMap::new(),
            object_geometry: HashMap::new(),
            landblock_info: HashMap::new(),
        }
    }

    pub fn get_landblock_info(
        &mut self,
        dat: &DatDatabase,
        lb_id: u32,
    ) -> Option<Arc<LandblockInfo>> {
        if let Some(info) = self.landblock_info.get(&lb_id) {
            return Some(info.clone());
        }

        // Outdoor landblock IDs end in 0xFFFF.
        // LandblockInfo is usually stored with the ID as its key in the cell.dat.
        if let Ok(data) = dat.get_file(lb_id)
            && let Ok(info) = LandblockInfo::unpack(&data)
        {
            let arc = Arc::new(info);
            self.landblock_info.insert(lb_id, arc.clone());
            return Some(arc);
        }
        None
    }

    /// Load or retrieve GfxObj geometry from the portal dat.
    pub fn get_object_geometry(&mut self, dat: &DatDatabase, gfx_id: u32) -> Option<Arc<GfxObj>> {
        if let Some(entry) = self.object_geometry.get_mut(&gfx_id) {
            // This is annoying because of borrow checker if we try to update last_accessed
            // but we'll worry about that if we actually add pruning.
            return Some(entry.gfx_obj.clone());
        }

        // Try to load from DAT
        if let Ok(data) = dat.get_file(gfx_id) {
            let mut cursor = std::io::Cursor::new(data);
            if let Ok(gfx) = GfxObj::unpack(&mut cursor) {
                let gfx_arc = Arc::new(gfx);
                self.object_geometry.insert(
                    gfx_id,
                    Arc::new(GeometryCacheEntry {
                        gfx_obj: gfx_arc.clone(),
                        last_accessed: Instant::now(),
                    }),
                );
                return Some(gfx_arc);
            }
        }

        None
    }

    pub fn update_entity(&mut self, guid: u32, old_lb: u32, new_lb: u32) {
        if old_lb != new_lb
            && let Some(set) = self.landblock_map.get_mut(&old_lb)
        {
            set.remove(&guid);
        }
        self.landblock_map.entry(new_lb).or_default().insert(guid);
    }

    pub fn remove_entity(&mut self, guid: u32, lb: u32) {
        if let Some(set) = self.landblock_map.get_mut(&lb) {
            set.remove(&guid);
        }
    }

    /// Find all entities in a given landblock.
    pub fn get_in_landblock(&self, lb: u32) -> Option<&HashSet<u32>> {
        self.landblock_map.get(&lb)
    }

    /// Get all entities in the landblock and its 8 immediate neighbors.
    /// Useful for coarse filtering before doing fine-grained distance checks.
    pub fn get_nearby_entities(&self, lb: u32) -> HashSet<u32> {
        let mut nearby = HashSet::new();

        let x = (lb >> 24) & 0xFF;
        let y = (lb >> 16) & 0xFF;

        for dx in -1..=1 {
            for dy in -1..=1 {
                let nx = x as i32 + dx;
                let ny = y as i32 + dy;
                // Outdoor bounds 0x01..0xFE
                if nx > 0 && nx < 255 && ny > 0 && ny < 255 {
                    // Try to add outdoor landblock (identifed by 0xFFFF)
                    let neighbor_lb = ((nx as u32) << 24) | ((ny as u32) << 16) | 0xFFFF;
                    if let Some(set) = self.landblock_map.get(&neighbor_lb) {
                        for &guid in set {
                            nearby.insert(guid);
                        }
                    }
                }
            }
        }

        // Also check the specific lb passed (might be an indoor cell)
        if let Some(set) = self.landblock_map.get(&lb) {
            for &guid in set {
                nearby.insert(guid);
            }
        }

        nearby
    }

    /// Query entities within a certain radius.
    pub fn get_entities_in_range(&self, _pos: &WorldPosition, _radius: f32) -> Vec<u32> {
        // TODO: Implement distance calculations once we have access to Entity positions
        Vec::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_spatial_neighbors() {
        let mut scene = SpatialScene::new();
        let guid_a = 0x11223344;
        let guid_b = 0x55667788;

        // Landblock (10, 10)
        let lb_a = (10 << 24) | (10 << 16) | 0xFFFF;
        // Landblock (11, 10) - direct neighbor to the east
        let lb_b = (11 << 24) | (10 << 16) | 0xFFFF;

        scene.update_entity(guid_a, lb_a, lb_a);
        scene.update_entity(guid_b, lb_b, lb_b);

        let nearby_a = scene.get_nearby_entities(lb_a);
        assert!(nearby_a.contains(&guid_a));
        assert!(
            nearby_a.contains(&guid_b),
            "Should find neighbor in adjacent landblock"
        );

        // Random landblock (50, 50) - far away
        let lb_far = (50 << 24) | (50 << 16) | 0xFFFF;
        let nearby_far = scene.get_nearby_entities(lb_far);
        assert!(nearby_far.is_empty());
    }
}
