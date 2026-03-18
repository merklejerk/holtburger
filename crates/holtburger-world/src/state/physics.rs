use super::*;
use std::collections::HashSet;

const ACE_DESTRUCTION_TIMEOUT_SECS: f64 = 25.0;
const CONSERVATIVE_VISIBILITY_DISTANCE_M: f32 = 384.0;

impl WorldState {
    fn current_visible_world_guids(&self) -> HashSet<Guid> {
        if self.player.guid == Guid::NULL {
            return HashSet::new();
        }

        let player_landblock = self.player.position.landblock_id;
        if player_landblock == Guid::NULL {
            return HashSet::new();
        }

        let nearby_guids = self.scene.get_nearby_entities(player_landblock);

        self.entities
            .iter()
            .filter(|entity| entity.guid != self.player.guid)
            .filter(|entity| entity.position.landblock_id != Guid::NULL)
            .filter(|entity| self.is_entity_world_participant(entity.guid))
            .filter(|entity| self.is_conservatively_visible_world_entity(entity, &nearby_guids))
            .map(|entity| entity.guid)
            .collect()
    }

    // TODO: Replace this conservative approximation with ACE-parity cell visibility.
    // ACE decides visibility from the current ObjCell, not just from landblock adjacency.
    // Proper parity here requires consulting cell.dat envcell records so we can:
    // 1. detect whether the player's current cell is an EnvCell,
    // 2. read SeenOutside for that cell,
    // 3. union the current envcell with its VisibleCells,
    // 4. merge outdoor landblock-neighborhood visibility only for SeenOutside envcells.
    // Until we wire that up, prefer retaining too much over pruning too aggressively.
    fn is_conservatively_visible_world_entity(
        &self,
        entity: &Entity,
        nearby_guids: &HashSet<Guid>,
    ) -> bool {
        nearby_guids.contains(&entity.guid)
            || self.player.position.distance_to(&entity.position)
                <= CONSERVATIVE_VISIBILITY_DISTANCE_M
    }

    fn maintain_visibility_prune_deadlines(&mut self, now: f64) {
        let visible_guids = self.current_visible_world_guids();
        let world_entity_guids: Vec<_> = self
            .entities
            .iter()
            .filter(|entity| entity.guid != self.player.guid)
            .filter(|entity| entity.position.landblock_id != Guid::NULL)
            .map(|entity| entity.guid)
            .collect();

        for guid in world_entity_guids {
            if visible_guids.contains(&guid) {
                self.clear_entity_prune_deadline(guid);
                continue;
            }

            let Some(snapshot) = self.retention_snapshot(guid, now) else {
                continue;
            };

            if snapshot.explicit_delete_requested || snapshot.has_nonworld_retention() {
                self.clear_entity_prune_deadline(guid);
                continue;
            }

            if self
                .entity_lifecycle_state(guid)
                .and_then(|state| state.prune_deadline)
                .is_none()
            {
                self.set_entity_prune_deadline(guid, now + ACE_DESTRUCTION_TIMEOUT_SECS);
            }
        }
    }

    pub fn get_nearby_entities(&self) -> Vec<Entity> {
        if self.player.guid == Guid::NULL {
            return Vec::new();
        }

        let lb = self.player.position.landblock_id;

        let nearby_guids = self.scene.get_nearby_entities(lb);
        nearby_guids
            .into_iter()
            .filter(|guid| self.is_entity_world_participant(*guid))
            .filter_map(|guid| self.entities.get(guid).cloned())
            .collect()
    }
    pub fn is_colliding(&mut self, pos: &Vector3, lb: Guid, radius: f32) -> bool {
        let nearby = self.scene.get_nearby_entities(lb);
        for guid in nearby {
            if guid == self.player.guid {
                continue;
            }

            if !self.is_entity_world_participant(guid) {
                continue;
            }

            if let Some(entity) = self.entities.get(guid)
                && let Some(gfx_id) = entity.gfx_id
            {
                let mut gfx = self
                    .scene
                    .object_geometry
                    .get(&gfx_id)
                    .map(|e| e.gfx_obj.clone());

                if gfx.is_none()
                    && let Some(dat) = &self.portal_dat
                {
                    gfx = self.scene.get_object_geometry(dat.as_ref(), gfx_id);
                }

                if let Some(gfx_obj) = gfx
                    && let Some(bsp) = &gfx_obj.physics_bsp
                {
                    let local_pos = *pos - entity.position.coords;
                    if bsp.intersects_solid(&local_pos, radius) {
                        return true;
                    }
                }
            }
        }

        false
    }
    pub fn tick(&mut self, dt: f32, radius: f32) -> Vec<WorldEvent> {
        let mut events = Vec::new();
        let now = self.current_server_time();
        self.sweep_eviction_queue(now, &mut events);
        self.maintain_visibility_prune_deadlines(now);

        if self.player.guid == Guid::NULL {
            return events;
        }

        let (vel, coords, lb) = if let Some(player) = self.entities.get(self.player.guid) {
            (
                player.velocity,
                player.position.coords,
                player.position.landblock_id,
            )
        } else {
            return events;
        };

        if vel.length_squared() < 0.0001 {
            return events;
        }

        let step = vel * dt;
        let next_coords = coords + step;

        if self.player.noclip || !self.is_colliding(&next_coords, lb, radius) {
            let mut next_pos = self.player.position;
            next_pos.coords = next_coords;
            events.extend(self.set_player_position(next_pos));
        } else {
            events.extend(self.set_player_velocity(Vector3::zero()));
        }

        events
    }
    /// Updates the player's position, ensuring the record in PlayerState,
    /// the mirrored Entity, and the SpatialScene stay in sync.
    pub fn set_player_position(&mut self, mut pos: WorldPosition) -> Vec<WorldEvent> {
        let mut events = Vec::new();
        let guid = self.player.guid;
        if guid == Guid::NULL {
            return events;
        }

        if !pos.rotation.w.is_finite()
            || !pos.rotation.x.is_finite()
            || !pos.rotation.y.is_finite()
            || !pos.rotation.z.is_finite()
        {
            pos.rotation = self.player.position.rotation;
        }

        let old_lb = self.player.position.landblock_id;
        self.player.position = pos;

        if let Some(entity) = self.entities.get_mut(guid) {
            entity.position = pos;
        }
        self.scene.update_entity(guid, old_lb, pos.landblock_id);

        events.push(WorldEvent::EntityMoved { guid, pos });
        events
    }

    /// Synchronizes the player's mirrored position without emitting movement events.
    ///
    /// This is intended for hydration/bootstrap flows where the client is seeding authoritative
    /// state rather than reacting to a live movement update packet.
    pub fn sync_player_position(&mut self, mut pos: WorldPosition) {
        let guid = self.player.guid;
        if guid == Guid::NULL {
            return;
        }

        if !pos.rotation.w.is_finite()
            || !pos.rotation.x.is_finite()
            || !pos.rotation.y.is_finite()
            || !pos.rotation.z.is_finite()
        {
            pos.rotation = self.player.position.rotation;
        }

        let old_lb = self.player.position.landblock_id;
        self.player.position = pos;

        if let Some(entity) = self.entities.get_mut(guid) {
            entity.position = pos;
        }
        self.scene.update_entity(guid, old_lb, pos.landblock_id);
    }

    /// Updates the player's velocity in both PlayerState (if mirrored) and the Entity map.
    pub fn set_player_velocity(&mut self, velocity: Vector3) -> Vec<WorldEvent> {
        let mut events = Vec::new();
        let guid = self.player.guid;
        if guid == Guid::NULL {
            return events;
        }

        if let Some(entity) = self.entities.get_mut(guid) {
            entity.velocity = velocity;
            events.push(WorldEvent::EntityVectorUpdated {
                guid,
                velocity,
                omega: Vector3::zero(), // Entities don't currently store omega
            });
        }
        events
    }

    pub fn set_player_vector(&mut self, velocity: Vector3, omega: Vector3) -> Vec<WorldEvent> {
        let mut events = Vec::new();
        let guid = self.player.guid;
        if guid == Guid::NULL {
            return events;
        }

        if let Some(entity) = self.entities.get_mut(guid) {
            entity.velocity = velocity;
            entity.omega = omega;
            events.push(WorldEvent::EntityVectorUpdated {
                guid,
                velocity,
                omega,
            });
        }

        events
    }
    /// Applies an authoritative server-side movement sync to the player.
    pub fn apply_player_autonomous_position(
        &mut self,
        data: &ServerAutonomousPositionData,
    ) -> Vec<WorldEvent> {
        let accepted = self.player.should_accept_server_position_sequences(
            data.teleport_sequence,
            data.force_position_sequence,
        );

        if !accepted {
            return Vec::new();
        }

        let mut events = vec![WorldEvent::SelfAutonomousPosition {
            teleport_sequence: data.teleport_sequence,
            force_position_sequence: data.force_position_sequence,
            server_control_sequence: data.server_control_sequence,
        }];

        events.extend(self.set_player_position(data.position));

        self.player.instance_sequence = data.instance_sequence;
        self.player.server_control_sequence = data.server_control_sequence;
        self.player.teleport_sequence = data.teleport_sequence;
        self.player.force_position_sequence = data.force_position_sequence;

        events
    }
}
