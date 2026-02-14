use std::collections::{HashMap, HashSet};

use holtburger_common::Guid;
use holtburger_common::position::WorldPosition;
use holtburger_core::world::entity::Entity;

use crate::entities::classification;

#[derive(Clone, Copy)]
pub enum EntityFilter {
    World,
    Inventory,
}

pub fn filter_entities<'a>(
    entities: &'a HashMap<Guid, Entity>,
    player_guid: Option<Guid>,
    inventory: &HashSet<Guid>,
    player_pos: Option<&'a WorldPosition>,
    filter: EntityFilter,
) -> Vec<(&'a Entity, f32, usize)> {
    let candidates: Vec<_> = entities
        .values()
        .filter(|e| match filter {
            EntityFilter::World => {
                if inventory.contains(&e.guid) {
                    return false;
                }
                if let Some(pguid) = player_guid
                    && e.guid == pguid
                {
                    return false;
                }
                classification::is_targetable(e) && e.position.landblock_id != Guid::NULL
            }
            EntityFilter::Inventory => inventory.contains(&e.guid) && !e.name.is_empty(),
        })
        .collect();

    if candidates.is_empty() {
        return Vec::new();
    }

    // Build parent-child mapping for the subset
    let mut children_map: HashMap<Guid, Vec<Guid>> = HashMap::new();
    let mut roots = Vec::new();

    let candidate_guids: HashSet<Guid> = candidates.iter().map(|e| e.guid).collect();

    for e in &candidates {
        let parent_id = match filter {
            EntityFilter::World => e.container_id.or(e.wielder_id).or(e.physics_parent_id),
            EntityFilter::Inventory => e.container_id,
        };

        let is_root = if let Some(pid) = parent_id {
            if Some(pid) == player_guid {
                true
            } else {
                !candidate_guids.contains(&pid)
            }
        } else {
            true
        };

        if is_root {
            roots.push(e.guid);
        } else {
            children_map
                .entry(parent_id.unwrap())
                .or_default()
                .push(e.guid);
        }
    }

    // Sort roots (by distance for Entities, by name for Inventory)
    roots.sort_by(|&a, &b| {
        let ea = &entities[&a];
        let eb = &entities[&b];
        match filter {
            EntityFilter::World => {
                let da = if let Some(p) = player_pos {
                    ea.position.distance_to(p)
                } else {
                    999.0
                };
                let db = if let Some(p) = player_pos {
                    eb.position.distance_to(p)
                } else {
                    999.0
                };
                da.partial_cmp(&db).unwrap_or(std::cmp::Ordering::Equal)
            }
            EntityFilter::Inventory => ea.name.cmp(&eb.name),
        }
    });

    // Flatten with depth using DFS
    let mut result = Vec::new();
    let mut stack: Vec<(Guid, usize)> = roots.into_iter().rev().map(|id| (id, 0)).collect();

    while let Some((guid, depth)) = stack.pop() {
        let e = &entities[&guid];
        let dist = if let Some(p) = player_pos {
            e.position.distance_to(p)
        } else {
            0.0
        };
        result.push((e, dist, depth));

        if let Some(mut children) = children_map.remove(&guid) {
            children.sort_by(|&a, &b| entities[&a].name.cmp(&entities[&b].name));
            for child_guid in children.into_iter().rev() {
                stack.push((child_guid, depth + 1));
            }
        }
    }

    result
}
