use super::super::*;

impl WorldState {
    pub(crate) fn handle_login_event(
        &mut self,
        _msg: &GameMessage,
        ev: &GameEventMessage,
        events: &mut Vec<StateEvent>,
    ) -> bool {
        match &ev.event {
            GameEvent::PlayerDescription(data) => {
                self.apply_player_description_world_state(
                    data.guid,
                    &data.name,
                    data.pos,
                    events,
                );
            }
            _ => return false,
        }
        true
    }
}
