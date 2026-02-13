/// Returns `true` if `candidate` is newer than `current` for a wrapping `u16` sequence.
///
/// Uses half-range ordering semantics: differences in `(0, 0x8000)` are considered forward,
/// and differences in `[0x8000, 0xFFFF]` are considered older/ambiguous.
#[inline]
pub fn is_newer_u16(candidate: u16, current: u16) -> bool {
    let delta = candidate.wrapping_sub(current);
    delta != 0 && delta < 0x8000
}

/// Returns `true` if `candidate` is newer than `current` for a wrapping `u32` sequence.
///
/// Uses half-range ordering semantics: differences in `(0, 0x8000_0000)` are considered forward,
/// and differences in `[0x8000_0000, 0xFFFF_FFFF]` are considered older/ambiguous.
#[inline]
pub fn is_newer_u32(candidate: u32, current: u32) -> bool {
    let delta = candidate.wrapping_sub(current);
    delta != 0 && delta < 0x8000_0000
}

#[cfg(test)]
mod tests {
    use super::{is_newer_u16, is_newer_u32};

    #[test]
    fn u16_basic_ordering() {
        assert!(is_newer_u16(11, 10));
        assert!(!is_newer_u16(10, 10));
        assert!(!is_newer_u16(10, 11));
    }

    #[test]
    fn u16_wrap_ordering() {
        assert!(is_newer_u16(0, u16::MAX));
        assert!(is_newer_u16(1, u16::MAX));
        assert!(!is_newer_u16(u16::MAX, 0));
    }

    #[test]
    fn u16_half_range_is_not_newer() {
        assert!(!is_newer_u16(0x8000, 0));
        assert!(!is_newer_u16(0, 0x8000));
    }

    #[test]
    fn u32_basic_ordering() {
        assert!(is_newer_u32(11, 10));
        assert!(!is_newer_u32(10, 10));
        assert!(!is_newer_u32(10, 11));
    }

    #[test]
    fn u32_wrap_ordering() {
        assert!(is_newer_u32(0, u32::MAX));
        assert!(is_newer_u32(1, u32::MAX));
        assert!(!is_newer_u32(u32::MAX, 0));
    }

    #[test]
    fn u32_half_range_is_not_newer() {
        assert!(!is_newer_u32(0x8000_0000, 0));
        assert!(!is_newer_u32(0, 0x8000_0000));
    }
}
