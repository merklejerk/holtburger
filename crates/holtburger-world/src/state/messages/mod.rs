use super::*;

mod inventory;
mod login;
mod movement;
mod properties;
mod trade;

impl WorldState {
    pub fn handle_message(&mut self, msg: &GameMessage) -> Vec<StateEvent> {
        let mut events = Vec::new();

        // Delegate player-specific messages first
        if self
            .player
            .handle_message(msg, &mut events, self.xp_table.as_ref())
        {
            for ev in &mut events {
                match ev {
                    StateEvent::SpellUpdated { spell_id, name } if name.is_none() => {
                        *name = self.resolve_spell_name(*spell_id);
                    }
                    _ => {}
                }
            }
            return events;
        }

        match msg {
            GameMessage::GameEvent(ev) => {
                let _ = self.handle_login_event(msg, ev, &mut events)
                    || self.handle_inventory_event(msg, ev, &mut events)
                    || self.handle_trade_message(msg, ev, &mut events);
            }
            _ => {
                let _ = self.handle_movement_message(msg, &mut events)
                    || self.handle_property_message(msg, &mut events)
                    || self.handle_inventory_message(msg, &mut events);
            }
        }

        events
    }
}
