use std::collections::{HashMap, HashSet};

use holtburger_core::world::entity::Entity;
use holtburger_core::world::guid::Guid;
use holtburger_core::world::position::WorldPosition;

use crate::entities::classification;

#[derive(Clone, Copy)]
pub enum EntityFilter {
    World,
    Inventory,
}

pub fn is_owned_by_player(
    entity_guid: Guid,
    entities: &HashMap<Guid, Entity>,
    player_guid: Guid,
) -> bool {
    let mut current_guid = entity_guid;
    let mut visited = HashSet::new();
    while visited.insert(current_guid) {
        if current_guid == player_guid {
            return true;
        }
        if let Some(ent) = entities.get(&current_guid) {
            if let Some(cid) = ent.container_id {
                current_guid = cid;
            } else if let Some(wid) = ent.wielder_id {
                current_guid = wid;
            } else {
                break;
            }
        } else {
            break;
        }
    }
    false
}

pub fn filter_entities<'a>(
    entities: &'a HashMap<Guid, Entity>,
    player_guid: Option<Guid>,
    player_pos: Option<&'a WorldPosition>,
    filter: EntityFilter,
) -> Vec<(&'a Entity, f32, usize)> {
    let candidates: Vec<_> = entities
        .values()
        .filter(|e| match filter {
            EntityFilter::World => {
                if let Some(pguid) = player_guid
                    && e.guid != pguid
                    && is_owned_by_player(e.guid, entities, pguid)
                {
                    return false;
                }
                classification::is_targetable(e) && e.position.landblock_id != Guid::NULL
            }
            EntityFilter::Inventory => {
                if e.position.landblock_id != Guid::NULL || e.name.is_empty() {
                    return false;
                }
                if let Some(pguid) = player_guid {
                    is_owned_by_player(e.guid, entities, pguid)
                } else {
                    false
                }
            }
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
