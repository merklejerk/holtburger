//! Standard lockpick template defaults, independent of optional server snapshots.

/// ACE World lockpick templates' integer LockpickMod (88), consumed by ACE Lock.cs.
/// These WCIDs were verified against the ten lockpick records in the local ACE snapshot.
/// They are estimates: custom servers and per-instance overrides can differ. Unknowns stay
/// absent so world/UI policy can explicitly assume zero without claiming an authored bonus.
pub fn lockpick_bonus(wcid: u32) -> Option<i32> {
    match wcid {
        510 | 511 => Some(-10),  // Flimsy / Crude
        512 => Some(5),          // Good
        513 | 545 => Some(0),    // Plain / Reliable
        514 | 515 => Some(10),   // Excellent / Superb
        516 | 30253 => Some(20), // Peerless / Limitless
        27672 => Some(30),       // Carved Gemstone
        _ => None,
    }
}
