use super::super::*;

impl WorldState {
    pub(crate) fn handle_movement_message(
        &mut self,
        msg: &GameMessage,
        events: &mut Vec<StateEvent>,
    ) -> bool {
        match msg {
            GameMessage::UpdatePosition(data) => {
                let guid = data.guid;
                if guid == self.player.guid {
                    events.extend(self.set_player_position(data.pos.pos));
                    // Sequence updates are partly handled by PlayerState::handle_message
                } else if let Some(entity) = self.entities.get_mut(guid) {
                    let old_lb = entity.position.landblock_id;
                    entity.position = data.pos.pos;
                    self.scene
                        .update_entity(guid, old_lb, data.pos.pos.landblock_id);

                    events.push(StateEvent::EntityMoved {
                        guid,
                        pos: data.pos.pos,
                    });
                }
            }
            GameMessage::PrivateUpdatePosition(data) => {
                events.extend(self.set_player_position(data.pos));
            }
            GameMessage::PublicUpdatePosition(data) => {
                let guid = data.guid;
                if guid == self.player.guid {
                    events.extend(self.set_player_position(data.pos));
                } else if let Some(entity) = self.entities.get_mut(guid) {
                    let old_lb = entity.position.landblock_id;
                    entity.position = data.pos;
                    self.scene
                        .update_entity(guid, old_lb, data.pos.landblock_id);

                    events.push(StateEvent::EntityMoved {
                        guid,
                        pos: data.pos,
                    });
                }
            }
            GameMessage::AutonomousPosition(data) => {
                if data.guid == self.player.guid {
                    events.extend(self.apply_player_autonomous_position(data));
                } else if let Some(entity) = self.entities.get_mut(data.guid) {
                    let old_lb = entity.position.landblock_id;
                    entity.position = data.position;
                    self.scene
                        .update_entity(data.guid, old_lb, data.position.landblock_id);

                    events.push(StateEvent::EntityMoved {
                        guid: data.guid,
                        pos: data.position,
                    });
                }
            }
            GameMessage::UpdateMotion(data) => {
                let guid = data.guid;

                // Pre-fetch target info for TurnToObject to avoid borrow checker conflicts
                let mut target_info = None;
                if let MovementTypeData::TurnToObject(tto) = &data.data
                    && tto.desired_heading.abs() <= 1e-6
                    && let Some(target) = self.entities.get(tto.target)
                {
                    target_info = Some((target.position.landblock_id, target.position.coords));
                }

                if let Some(entity) = self.entities.get_mut(guid) {
                    use holtburger_common::math::Quaternion;

                    match &data.data {
                        MovementTypeData::TurnToHeading(turn) => {
                            if turn.params.desired_heading.is_finite() {
                                let new_rot = Quaternion::from_heading(turn.params.desired_heading);
                                if guid == self.player.guid {
                                    let mut pos = self.player.position;
                                    pos.rotation = new_rot;
                                    events.extend(self.set_player_position(pos));
                                } else {
                                    entity.position.rotation = new_rot;
                                    events.push(StateEvent::EntityMoved {
                                        guid,
                                        pos: entity.position,
                                    });
                                }
                            }
                        }
                        MovementTypeData::TurnToObject(turn) => {
                            let mut new_rot = entity.position.rotation;

                            if turn.desired_heading.is_finite() && turn.desired_heading.abs() > 1e-6
                            {
                                new_rot = Quaternion::from_heading(turn.desired_heading);
                            } else if let Some((target_lb, target_coords)) = target_info
                                && target_lb == entity.position.landblock_id
                            {
                                let heading = entity.position.coords.heading_to(&target_coords);
                                new_rot = Quaternion::from_heading(heading);
                            }

                            if guid == self.player.guid {
                                let mut pos = self.player.position;
                                pos.rotation = new_rot;
                                events.extend(self.set_player_position(pos));
                            } else {
                                entity.position.rotation = new_rot;
                                events.push(StateEvent::EntityMoved {
                                    guid,
                                    pos: entity.position,
                                });
                            }
                        }
                        _ => {}
                    }
                }
            }
            GameMessage::VectorUpdate(data) => {
                let guid = data.guid;

                if guid == self.player.guid {
                    events.extend(self.set_player_velocity(data.velocity));
                } else if let Some(entity) = self.entities.get_mut(guid) {
                    entity.velocity = data.velocity;
                    entity.omega = data.omega;
                    events.push(StateEvent::EntityVectorUpdated {
                        guid,
                        velocity: data.velocity,
                        omega: data.omega,
                    });
                }
            }
            _ => return false,
        }
        true
    }
}
