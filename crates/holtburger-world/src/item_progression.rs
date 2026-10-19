//! Item advancement derived from appraisal properties, shared by every client.

use holtburger_common::properties::{
    PropertyInt, PropertyInt64, WorldObjectProperties, WorldObjectPropertyAccessors,
};

/// Item level and exact XP facts disclosed by a successful appraisal.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemProgression {
    /// Earned item level, independent of the ordinary Level property.
    pub level: u32,
    /// Highest level this particular item can attain.
    pub max_level: u32,
    /// Accumulated XP, transported losslessly to JavaScript.
    #[serde(with = "crate::progression::decimal_u64")]
    pub total_xp: u64,
    /// Thresholds appropriate to an advancing or fully leveled item.
    pub advancement: ItemAdvancement,
}

/// Mutually exclusive item advancement states; consumers never infer the cap themselves.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ItemAdvancement {
    /// Progress toward the next level, measured between cumulative thresholds.
    Advancing {
        /// Cumulative XP at the beginning of the current level.
        #[serde(with = "crate::progression::decimal_u64")]
        level_start_xp: u64,
        /// Cumulative XP required to attain the next level.
        #[serde(with = "crate::progression::decimal_u64")]
        next_level_xp: u64,
    },
    /// No further advancement is possible.
    Maximum {
        /// Cumulative XP required to attain the maximum level.
        #[serde(with = "crate::progression::decimal_u64")]
        max_level_xp: u64,
    },
}

/// Malformed or unsupported disclosed progression must not become fabricated display facts.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ItemProgressionError {
    /// The wire supplied a signed XP total below zero.
    #[error("negative accumulated item XP: {0}")]
    NegativeXp(i64),
    /// No proven formula is implemented for the disclosed style.
    #[error("unsupported item XP style: {0}")]
    UnsupportedStyle(i32),
    /// The next display threshold cannot be represented by the XP contract.
    #[error("item XP threshold exceeds the unsigned 64-bit range")]
    ThresholdOverflow,
}

/// Proven ACE item formulas; invalid wire discriminants never reach threshold arithmetic.
#[derive(Clone, Copy)]
enum ItemXpStyle {
    Fixed,
    ScalesWithLevel,
}

impl ItemProgression {
    pub(crate) fn from_properties(
        properties: &WorldObjectProperties,
    ) -> Result<Option<Self>, ItemProgressionError> {
        // Retail ItemExamineUI::Appraisal_ShowItemLevelInfo (acclient.c:222671)
        // requires all three configuration properties; omitted total XP means zero.
        let Some(base) = properties
            .get_int64_prop(PropertyInt64::ItemBaseXp)
            .filter(|v| *v > 0)
        else {
            return Ok(None);
        };
        let Some(max_level) = properties
            .get_int_prop(PropertyInt::ItemMaxLevel)
            .filter(|v| *v > 0)
        else {
            return Ok(None);
        };
        let Some(style) = properties
            .get_int_prop(PropertyInt::ItemXpStyle)
            .filter(|v| *v > 0)
        else {
            return Ok(None);
        };
        // ACE ExperienceSystem.cs and retail acclient.c:475720 agree on styles 1/2.
        // Style 3 is an unsupported gap: ACE and retail disagree on its thresholds.
        // Local ACE World census (2026-10-19): 133 style-1 templates, 18 style-2, no others.
        let style = match style {
            1 => ItemXpStyle::Fixed,
            2 => ItemXpStyle::ScalesWithLevel,
            other => return Err(ItemProgressionError::UnsupportedStyle(other)),
        };
        let total = properties
            .get_int64_prop(PropertyInt64::ItemTotalXp)
            .unwrap_or(0);
        let total_xp = u64::try_from(total).map_err(|_| ItemProgressionError::NegativeXp(total))?;
        let base = base as u64;
        let max_level = max_level as u32;
        // Bounded search avoids work proportional to a server-supplied maximum level.
        // Overflowed thresholds are above any representable accumulated XP.
        let mut level = 0;
        let mut upper = max_level;
        while level < upper {
            let candidate = level + (upper - level).div_ceil(2);
            if threshold(base, style, candidate).is_some_and(|xp| xp <= total_xp) {
                level = candidate;
            } else {
                upper = candidate - 1;
            }
        }
        let advancement = if level == max_level {
            ItemAdvancement::Maximum {
                max_level_xp: threshold(base, style, level)
                    .ok_or(ItemProgressionError::ThresholdOverflow)?,
            }
        } else {
            ItemAdvancement::Advancing {
                level_start_xp: threshold(base, style, level)
                    .ok_or(ItemProgressionError::ThresholdOverflow)?,
                next_level_xp: threshold(base, style, level + 1)
                    .ok_or(ItemProgressionError::ThresholdOverflow)?,
            }
        };
        Ok(Some(Self {
            level,
            max_level,
            total_xp,
            advancement,
        }))
    }
}

fn threshold(base: u64, style: ItemXpStyle, level: u32) -> Option<u64> {
    let multiplier = match style {
        ItemXpStyle::Fixed => u128::from(level),
        ItemXpStyle::ScalesWithLevel => 1_u128.checked_shl(level)?.checked_sub(1)?,
    };
    u64::try_from(u128::from(base).checked_mul(multiplier)?).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_common::properties::WorldObjectPropertyAccessorsMut;

    fn properties(
        style: i32,
        base: i64,
        maximum: i32,
        total: Option<i64>,
    ) -> WorldObjectProperties {
        let mut properties = WorldObjectProperties::default();
        properties.set_int_prop(PropertyInt::ItemXpStyle, style);
        properties.set_int_prop(PropertyInt::ItemMaxLevel, maximum);
        properties.set_int64_prop(PropertyInt64::ItemBaseXp, base);
        if let Some(total) = total {
            properties.set_int64_prop(PropertyInt64::ItemTotalXp, total);
        }
        properties
    }

    #[test]
    fn fixed_and_scaling_levels_use_cumulative_thresholds() {
        // ACE ExperienceSystem.cs: fixed thresholds n*base; scaling (2^n-1)*base.
        for (style, total, level, start, next) in [
            (1, 0, 0, 0, 100),
            (1, 99, 0, 0, 100),
            (1, 100, 1, 100, 200),
            (1, 250, 2, 200, 300),
            (2, 99, 0, 0, 100),
            (2, 100, 1, 100, 300),
            (2, 299, 1, 100, 300),
            (2, 300, 2, 300, 700),
            (2, 350, 2, 300, 700),
        ] {
            let progression =
                ItemProgression::from_properties(&properties(style, 100, 5, Some(total)))
                    .unwrap()
                    .unwrap();
            assert_eq!(progression.level, level);
            assert_eq!(
                progression.advancement,
                ItemAdvancement::Advancing {
                    level_start_xp: start,
                    next_level_xp: next,
                }
            );
        }
    }

    #[test]
    fn maximum_level_is_explicit_even_if_server_total_exceeds_cap() {
        for (style, cap) in [(1, 300), (2, 700)] {
            for total in [cap, cap + 1] {
                let progression =
                    ItemProgression::from_properties(&properties(style, 100, 3, Some(total)))
                        .unwrap()
                        .unwrap();
                assert_eq!(progression.level, 3);
                assert_eq!(progression.total_xp, total as u64);
                assert_eq!(
                    progression.advancement,
                    ItemAdvancement::Maximum {
                        max_level_xp: cap as u64
                    }
                );
            }
        }
    }

    #[test]
    fn absent_total_starts_at_zero_but_absent_configuration_is_not_progression() {
        let progression = ItemProgression::from_properties(&properties(2, 100, 5, None))
            .unwrap()
            .unwrap();
        assert_eq!(progression.level, 0);
        assert_eq!(progression.total_xp, 0);
        assert_eq!(
            ItemProgression::from_properties(&WorldObjectProperties::default()),
            Ok(None)
        );
        for (style, base, maximum) in [(0, 100, 5), (2, 0, 5), (2, 100, 0)] {
            assert_eq!(
                ItemProgression::from_properties(&properties(style, base, maximum, None)),
                Ok(None)
            );
        }
        for missing in [PropertyInt::ItemMaxLevel, PropertyInt::ItemXpStyle] {
            let mut incomplete = properties(2, 100, 5, None);
            incomplete.ints.0.remove(&missing);
            assert_eq!(ItemProgression::from_properties(&incomplete), Ok(None));
        }
    }

    #[test]
    fn invalid_disclosed_progression_fails_explicitly() {
        assert_eq!(
            ItemProgression::from_properties(&properties(3, 100, 5, Some(0))),
            Err(ItemProgressionError::UnsupportedStyle(3))
        );
        assert_eq!(
            ItemProgression::from_properties(&properties(1, 100, 5, Some(-1))),
            Err(ItemProgressionError::NegativeXp(-1))
        );
        assert_eq!(
            ItemProgression::from_properties(&properties(2, i64::MAX, 5, Some(i64::MAX))),
            Err(ItemProgressionError::ThresholdOverflow)
        );
    }

    #[test]
    fn large_totals_are_exact_and_large_maximums_do_not_require_linear_work() {
        let total = 9_007_199_254_740_993;
        let progression =
            ItemProgression::from_properties(&properties(2, 1, i32::MAX, Some(total)))
                .unwrap()
                .unwrap();
        assert_eq!(progression.level, 53);
        assert_eq!(
            progression.advancement,
            ItemAdvancement::Advancing {
                level_start_xp: 9_007_199_254_740_991,
                next_level_xp: 18_014_398_509_481_983,
            }
        );
        let fixed = ItemProgression::from_properties(&properties(1, 1, i32::MAX, Some(i64::MAX)))
            .unwrap()
            .unwrap();
        assert_eq!(fixed.level, i32::MAX as u32);
    }
}
