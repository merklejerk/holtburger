use super::PlayerState;

impl PlayerState {
    /// Increments and returns the next movement sequence.
    pub fn next_move_seq(&mut self) -> u16 {
        self.movement_sequence = self.movement_sequence.wrapping_add(1);
        self.movement_sequence
    }
}
