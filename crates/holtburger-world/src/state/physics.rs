use super::*;

impl WorldState {
    pub fn get_nearby_entities(&self) -> Vec<Entity> {
        if self.player.guid == Guid::NULL {
            return Vec::new();
        }

        let lb = self.player.position.landblock_id;

        let nearby_guids = self.scene.get_nearby_entities(lb);
        nearby_guids
            .into_iter()
            .filter_map(|guid| self.entities.get(guid).cloned())
            .collect()
    }
    pub fn is_colliding(&mut self, pos: &Vector3, lb: Guid, radius: f32) -> bool {
        let nearby = self.scene.get_nearby_entities(lb);
        for guid in nearby {
            if guid == self.player.guid {
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
    pub fn tick(&mut self, dt: f32, radius: f32) -> Vec<StateEvent> {
        let mut events = Vec::new();
        let now = self.current_server_time();
        self.sweep_eviction_queue(now, &mut events);

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
    pub fn set_player_position(&mut self, mut pos: WorldPosition) -> Vec<StateEvent> {
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

        events.push(StateEvent::EntityMoved { guid, pos });
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
    pub fn set_player_velocity(&mut self, velocity: Vector3) -> Vec<StateEvent> {
        let mut events = Vec::new();
        let guid = self.player.guid;
        if guid == Guid::NULL {
            return events;
        }

        if let Some(entity) = self.entities.get_mut(guid) {
            entity.velocity = velocity;
            events.push(StateEvent::EntityVectorUpdated {
                guid,
                velocity,
                omega: Vector3::zero(), // Entities don't currently store omega
            });
        }
        events
    }

    pub fn set_player_vector(&mut self, velocity: Vector3, omega: Vector3) -> Vec<StateEvent> {
        let mut events = Vec::new();
        let guid = self.player.guid;
        if guid == Guid::NULL {
            return events;
        }

        if let Some(entity) = self.entities.get_mut(guid) {
            entity.velocity = velocity;
            entity.omega = omega;
            events.push(StateEvent::EntityVectorUpdated {
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
    ) -> Vec<StateEvent> {
        let events = self.set_player_position(data.position);

        self.player.instance_sequence = data.instance_sequence;
        self.player.server_control_sequence = data.server_control_sequence;
        self.player.teleport_sequence = data.teleport_sequence;
        self.player.force_position_sequence = data.force_position_sequence;

        events
    }
}
