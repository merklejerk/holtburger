use super::*;

mod inventory;
mod login;
mod movement;
mod properties;
mod trade;

impl WorldState {
    pub fn handle_message(&mut self, msg: &GameMessage) -> Vec<StateEvent> {
        let mut events = Vec::new();
        crate::handlers::handle_message(self, msg, &mut events);
        events
    }

    pub(crate) fn handle_message_legacy(&mut self, msg: &GameMessage, events: &mut Vec<StateEvent>) {
        // Delegate player-specific messages first
        if self.player.handle_message(
            msg,
            events,
            self.xp_table.as_ref(),
            self.skill_table.as_deref(),
        ) {
            for ev in events.iter_mut() {
                match ev {
                    StateEvent::SpellUpdated { spell_id, name } if name.is_none() => {
                        *name = self.resolve_spell_name(*spell_id);
                    }
                    _ => {}
                }
            }
            return;
        }

        match msg {
            GameMessage::GameEvent(ev) => {
                let _ = self.handle_login_event(msg, ev, events)
                    || self.handle_inventory_event(msg, ev, events)
                    || self.handle_trade_message(msg, ev, events);
            }
            _ => {
                let _ = self.handle_movement_message(msg, events)
                    || self.handle_property_message(msg, events)
                    || self.handle_inventory_message(msg, events);
            }
        }
    }
}
