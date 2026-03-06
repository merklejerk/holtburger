use super::*;

mod inventory;
mod movement;
mod properties;

impl WorldState {
    pub fn handle_message(&mut self, msg: &GameMessage) -> Vec<StateEvent> {
        let mut events = Vec::new();
        crate::handlers::handle_message(self, msg, &mut events);
        events
    }

    pub(crate) fn handle_message_legacy(&mut self, msg: &GameMessage, events: &mut Vec<StateEvent>) {
        match msg {
            GameMessage::GameEvent(ev) => {
                let _ = self.handle_inventory_event(msg, ev, events);
            }
            _ => {
                let _ = self.handle_movement_message(msg, events)
                    || self.handle_property_message(msg, events)
                    || self.handle_inventory_message(msg, events);
            }
        }
    }
}
