//! App-owned classification for compact item-inspector cantrip summaries.

use serde::Serialize;

const BENEFICIAL_SPELL: u32 = 0x4;

/// Conventional cantrip tiers plus a lossless bucket for nonstandard strengths.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CantripTier {
    Feeble,
    Minor,
    Moderate,
    Major,
    Epic,
    Legendary,
    Other,
}

use CantripTier::{Epic, Feeble, Legendary, Major, Minor, Moderate, Other};

/// Identify item-enchantment spell families and classify their authored strength.
///
/// The category and power profiles come from a full 2026-09-20 client DAT census,
/// checked against ACE's canonical loot spell families. Names are authoritative for
/// conventional prefixes; exact powers recover named variants without inventing
/// tiers between authored breakpoints.
pub(super) fn classify_cantrip(
    name: &str,
    category: u32,
    flags: u32,
    power: u32,
) -> Option<CantripTier> {
    if flags & BENEFICIAL_SPELL == 0 {
        return None;
    }

    match category_policy(category)? {
        CategoryPolicy::Other => Some(Other),
        CategoryPolicy::PrefixOnly => Some(tier_prefix(name).unwrap_or(Other)),
        CategoryPolicy::Conventional(profile) => Some(
            tier_prefix(name)
                .or_else(|| tier_for_power(profile, power))
                .unwrap_or(Other),
        ),
    }
}

#[derive(Clone, Copy)]
enum CategoryPolicy {
    Conventional(&'static [(u32, CantripTier)]),
    PrefixOnly,
    Other,
}

fn tier_prefix(name: &str) -> Option<CantripTier> {
    [
        ("Feeble ", Feeble),
        ("Minor ", Minor),
        ("Moderate ", Moderate),
        ("Major ", Major),
        ("Epic ", Epic),
        ("Legendary ", Legendary),
    ]
    .into_iter()
    .find_map(|(prefix, tier)| name.starts_with(prefix).then_some(tier))
}

fn tier_for_power(profile: &[(u32, CantripTier)], power: u32) -> Option<CantripTier> {
    profile
        .iter()
        .find_map(|&(candidate, tier)| (candidate == power).then_some(tier))
}

fn category_policy(category: u32) -> Option<CategoryPolicy> {
    let profile = match category {
        293 | 333 | 337 | 339 | 343 | 347 | 349 | 353 | 355 | 359 | 361 | 365 | 367 | 369 => {
            &[(1, Minor), (2, Major), (25, Epic), (35, Legendary)][..]
        }
        261 | 263 | 265 | 267 | 269 | 271 | 311 | 313 | 331 | 363 | 371 | 595 => &[
            (3, Feeble),
            (5, Minor),
            (10, Moderate),
            (15, Major),
            (25, Epic),
            (35, Legendary),
        ],
        251 | 253 | 255 | 299 | 335 | 351 | 357 | 646 => &[
            (5, Minor),
            (10, Moderate),
            (15, Major),
            (25, Epic),
            (35, Legendary),
        ],
        381 | 383 | 385 | 387 | 391 | 393 | 395 | 397 => {
            &[(1, Minor), (2, Major), (3, Epic), (4, Legendary)]
        }
        666 | 669 | 672 | 675 | 678 | 698 => &[
            (1, Minor),
            (2, Major),
            (10, Moderate),
            (25, Epic),
            (35, Legendary),
        ],
        287 | 289 | 401 | 405 => &[(10, Minor), (15, Major), (20, Epic), (25, Legendary)],
        257 | 259 | 407 => &[(15, Minor), (30, Major), (45, Epic), (60, Legendary)],
        285 | 291 => &[(1, Minor), (2, Major), (20, Epic), (25, Legendary)],
        297 | 602 => &[(10, Moderate)],
        329 | 389 => &[(3, Minor), (5, Major), (6, Epic), (9, Legendary)],
        377 | 654 => &[(5, Minor), (15, Major), (25, Epic), (35, Legendary)],
        // Power 4 is authored as both Major and Epic; only its name can resolve it.
        323 => &[
            (1, Minor),
            (2, Minor),
            (3, Major),
            (5, Epic),
            (7, Legendary),
            (10, Legendary),
        ],
        345 => &[(1, Minor), (15, Major), (25, Epic), (35, Legendary)],
        379 => &[(20, Minor), (40, Major), (60, Epic), (80, Legendary)],
        399 => &[(10, Minor), (20, Major), (25, Epic), (40, Legendary)],
        403 => &[
            (1, Minor),
            (2, Major),
            (20, Epic),
            (50, Epic),
            (25, Legendary),
        ],
        425 => &[
            (5, Feeble),
            (10, Minor),
            (15, Moderate),
            (20, Major),
            (25, Epic),
            (30, Legendary),
        ],
        437 => &[(5, Minor), (10, Major), (25, Epic), (35, Legendary)],
        422 | 423 => return Some(CategoryPolicy::PrefixOnly),
        413 | 414 | 415 | 416 | 428 | 517 | 527 => return Some(CategoryPolicy::Other),
        _ => return None,
    };
    Some(CategoryPolicy::Conventional(profile))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn requires_beneficial_flag_and_recognized_category() {
        assert_eq!(classify_cantrip("Minor Strength", 261, 0, 5), None);
        assert_eq!(
            classify_cantrip("Minor Strength", 999, BENEFICIAL_SPELL, 5),
            None
        );
        assert_eq!(
            classify_cantrip("Minor Strength", 261, BENEFICIAL_SPELL, 5),
            Some(Minor)
        );
    }

    #[test]
    fn conventional_prefix_wins_over_ambiguous_or_disagreeing_power() {
        assert_eq!(
            classify_cantrip("Epic Impregnability", 323, BENEFICIAL_SPELL, 4),
            Some(Epic)
        );
        assert_eq!(
            classify_cantrip("Minor Strength", 261, BENEFICIAL_SPELL, 35),
            Some(Minor)
        );
    }

    #[test]
    fn exact_category_power_recovers_named_variants() {
        assert_eq!(
            classify_cantrip("Conscript's Strength", 261, BENEFICIAL_SPELL, 10),
            Some(Moderate)
        );
        assert_eq!(
            classify_cantrip("Named Armor", 403, BENEFICIAL_SPELL, 50),
            Some(Epic)
        );
    }

    #[test]
    fn ambiguous_and_nonstandard_powers_are_other() {
        assert_eq!(
            classify_cantrip("Impenetrability", 323, BENEFICIAL_SPELL, 4),
            Some(Other)
        );
        assert_eq!(
            classify_cantrip("Thew of the Giant", 261, BENEFICIAL_SPELL, 8),
            Some(Other)
        );
    }

    #[test]
    fn special_categories_preserve_only_explicit_information() {
        assert_eq!(
            classify_cantrip("Major Test", 422, BENEFICIAL_SPELL, 500),
            Some(Major)
        );
        assert_eq!(
            classify_cantrip("Named Test", 422, BENEFICIAL_SPELL, 500),
            Some(Other)
        );
        assert_eq!(
            classify_cantrip("Legendary Burning Spirit", 517, BENEFICIAL_SPELL, 35),
            Some(Other)
        );
    }

    #[test]
    fn does_not_require_excluded_from_item_descriptions_flag() {
        // 0x400 controls description exclusion, not cantrip membership.
        assert_eq!(
            classify_cantrip("Minor Strength", 261, BENEFICIAL_SPELL, 5),
            Some(Minor)
        );
    }
}
