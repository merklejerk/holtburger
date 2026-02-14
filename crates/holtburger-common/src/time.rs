pub const DERETH_TICKS_PER_HOUR: f64 = 476.25;
pub const DERETH_HOURS_PER_DAY: f64 = 16.0;
pub const DERETH_DAY_LENGTH: f64 = DERETH_TICKS_PER_HOUR * DERETH_HOURS_PER_DAY; // 7620.0

/// 0 raw server ticks corresponds to 'Morntide-and-Half' (Hour 8),
/// but there's a 210 tick adjustment in the reference client memory.
/// Derived as: -210 + (476.25 * 8) = 3600.
pub const DERETH_TIME_OFFSET: f64 = 3600.0;
