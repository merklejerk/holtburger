use std::time::Instant;
use crate::ui::layout::NET_PULSE_HISTORY_SIZE;

pub struct NetStats {
    pub bytes_in: u64,
    pub bytes_out: u64,
    pub history_in: Vec<u64>,
    pub history_out: Vec<u64>,
    pub last_update: Option<Instant>,
}

impl Default for NetStats {
    fn default() -> Self {
        Self {
            bytes_in: 0,
            bytes_out: 0,
            history_in: vec![0; NET_PULSE_HISTORY_SIZE],
            history_out: vec![0; NET_PULSE_HISTORY_SIZE],
            last_update: None,
        }
    }
}
