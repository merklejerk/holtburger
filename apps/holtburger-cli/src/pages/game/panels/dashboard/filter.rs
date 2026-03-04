use std::collections::{HashMap, HashSet};

use holtburger_common::Guid;
use holtburger_common::position::WorldPosition;
use holtburger_common::properties::PseudoEquipMask;
use holtburger_world::entity::Entity;

#[derive(Clone, Copy)]
pub enum EntityFilter {
    World,
    Inventory,
}

pub fn filter_entities<'a>(
    entities: &'a HashMap<Guid, Entity>,
    inventory: &HashSet<Guid>,
    equipment: &HashMap<Guid, holtburger_common::properties::EquipMask>,
    player_pos: Option<&'a WorldPosition>,
    open_containers: Option<&HashSet<Guid>>,
    filter: EntityFilter,
) -> Vec<(&'a Entity, f32, usize)> {
    let candidates: Vec<_> = entities
        .values()
        .filter(|e| match filter {
            EntityFilter::World => {
                let loc = e.valid_locations();
                let is_combat_implement =
                    (loc.bits() & PseudoEquipMask::COMBAT_IMPLEMENTS.bits()) != 0;

                let in_open_container = if let Some(open) = open_containers
                    && let Some(cid) = e.container_id()
                {
                    open.contains(&cid)
                } else {
                    false
                };

                (e.position.landblock_id != Guid::NULL
                    || (e.wielder_id().is_some() && is_combat_implement)
                    || e.physics_parent_id.is_some())
                    || in_open_container
            }
            EntityFilter::Inventory => {
                (inventory.contains(&e.guid) || equipment.contains_key(&e.guid))
                    && !e.name().is_empty()
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
            EntityFilter::World => e.container_id().or(e.wielder_id()).or(e.physics_parent_id),
            EntityFilter::Inventory => e.container_id(),
        };

        let is_root = if let Some(pid) = parent_id {
            !candidate_guids.contains(&pid)
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
            EntityFilter::Inventory => ea.name().cmp(eb.name()),
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
            children.sort_by(|&a, &b| entities[&a].name().cmp(entities[&b].name()));
            for child_guid in children.into_iter().rev() {
                stack.push((child_guid, depth + 1));
            }
        }
    }

    result
}
