//! Shared interpretation of ordered appearance substitutions against authored setup parts.

/// Resolves effective GfxObj identities, preserving setup slots and substitution order.
///
/// Out-of-range indices are ignored; the last substitution for a valid slot wins.
/// This resolves identities only: callers load and validate the selected resources.
pub fn resolve_setup_parts(
    parts: &[u32],
    changes: impl IntoIterator<Item = (u8, u32)>,
) -> Vec<u32> {
    let mut effective_parts = parts.to_vec();
    for (part_index, gfx_obj_did) in changes {
        // RETAIL QUIRK: Retail behavior is to skip out-of-range part substitutions and
        // continue applying valid changes; the visual-description caller ignores the failure
        // result. Rejecting the whole appearance would discard otherwise valid geometry.
        // Census 2026-09-17: 57 catalog templates have an own-clothing table naming a part
        // beyond their setup.
        if let Some(part) = effective_parts.get_mut(usize::from(part_index)) {
            *part = gfx_obj_did;
        }
    }
    effective_parts
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn substitutions_preserve_slots_and_order_while_skipping_missing_parts() {
        let parts = [0x0100_0001, 0x0100_0002];
        let changes = [
            (9, 0x0100_0003),
            (0, 0x0100_0004),
            (2, 0x0100_0005),
            (0, 0x0100_0006),
        ];
        assert_eq!(
            resolve_setup_parts(&parts, changes),
            [0x0100_0006, parts[1]]
        );
        assert_eq!(resolve_setup_parts(&parts, []), parts);
        assert!(resolve_setup_parts(&[], changes).is_empty());
    }
}
