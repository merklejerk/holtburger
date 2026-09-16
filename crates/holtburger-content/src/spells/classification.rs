//! Static discovery classifications. These are not castability or combat rules.

use holtburger_dat::file_type::spell_table::{SpellBase, component_power_tier};
use serde::Serialize;

/// Damage or protection association used to narrow a spell reference list.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum SpellDamageAssociation {
    /// Direct health loss, including Harm and hostile health transfers.
    Direct,
    /// Verified general armor, damage modifiers/protection, and non-elemental periodic damage.
    Misc,
    /// Acid damage, resistance, or vulnerability.
    Acid,
    /// Bludgeoning damage, resistance, or vulnerability.
    Bludgeoning,
    /// Frost damage, resistance, or vulnerability.
    Frost,
    /// Lightning damage, resistance, or vulnerability.
    Lightning,
    /// Fire damage, resistance, or vulnerability.
    Fire,
    /// Piercing damage, resistance, or vulnerability.
    Piercing,
    /// Slashing damage, resistance, or vulnerability.
    Slashing,
    /// Nether damage, resistance, or vulnerability.
    Nether,
}

/// Authored recipient association, independent of how a cast selects its target.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum SpellRecipientAssociation {
    /// Authored creature target mask; this can also describe self spells.
    Creature,
    /// Authored non-creature target mask; some spells permit redirection.
    Item,
}

/// Immutable reference facts, independent of character knowledge and icon availability.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpellClassification {
    /// ACE Spell.IsBeneficial: flag 0x4; harmful is its complement, independent of target.
    pub beneficial: bool,
    /// Retail spellbook filter level; unknown components have no level.
    pub level: Option<u32>,
    /// Authored recipient category; zero and unfamiliar masks remain unclassified.
    pub recipient: Option<SpellRecipientAssociation>,
    /// Fellowship flag or fellowship effect type, independent of self targeting.
    pub fellowship: bool,
    /// Reviewed category association, corrected for verified authored exceptions.
    pub damage: Option<SpellDamageAssociation>,
}

/// Derive static discovery facts once at the content-reference boundary.
pub fn classify(id: u32, spell: &SpellBase) -> SpellClassification {
    let tier = component_power_tier(spell.components[0]);
    // acclient.c:429357: this differs from both the icon tier and server difficulty.
    let level = match tier {
        0 => None,
        1..=6 => Some(tier),
        7..=8 => Some(tier - 1),
        _ => Some(tier - 2),
    };
    // ACE Player_Magic.cs:1379 validates authored recipient masks. A zero mask
    // does not establish whether the client requires a selection to cast.
    let recipient = match spell.non_component_target_type {
        16 => Some(SpellRecipientAssociation::Creature),
        6 | 257 | 640 | 32768 | 33025 | 65536 | 3013615 | 268435456 => {
            Some(SpellRecipientAssociation::Item)
        }
        _ => None,
    };
    SpellClassification {
        beneficial: spell.bitfield & 4 != 0,
        level,
        recipient,
        // ACE Entity/Spell.cs:135: six authored fellowship spells lack the flag.
        fellowship: spell.bitfield & 8192 != 0 || (11..=14).contains(&spell.meta_spell_type),
        // ACE WorldObject_Magic.cs:710: category87 transfers remove health from
        // their source. The 2026-09-15 census verified all25 non-beneficial
        // records use a target source; the16 beneficial records are self conversions.
        damage: if spell.category == 87 && spell.bitfield & 4 == 0 {
            Some(SpellDamageAssociation::Direct)
        } else {
            damage_association(id, spell.category)
        },
    }
}

/// Category mappings follow ACE SpellCategory; exception identities were checked
/// against local ACE ace_world.spell.EType on 2026-09-15 (all 6,266 IDs present).
/// There were 35 disagreements among mapped projectile categories. Protection
/// associations had no disagreements with Float StatModKey resistance/armor fields.
/// This reflects installed reference content, not arbitrary server customizations.
fn damage_association(id: u32, category: u32) -> Option<SpellDamageAssociation> {
    use SpellDamageAssociation::*;
    // Bind corrections to both identity and expected category so a changed category
    // is not overwritten by an exception for an older definition.
    match (id, category) {
        // Saved ACE stat census: category 530 mixes bleeding with a projectile
        // enchantment; 610 includes a vital effect. Classify only verified records.
        // 6174 has an unnamed category but modifies CritDamageRating (314).
        (4722 | 4723, 530) | (5138..=5140, 610) | (6174, 703) => return Some(Misc),
        // ACE damage_Type=Health with negative Boost (3047), or EType=Health
        // projectiles (3914,3931,3998), verified against local ace_world.spell.
        (3047, 84) | (3914 | 3931 | 3998, 223) => return Some(Direct),
        // Projectile effects in generic vital categories; EType verified in the same census.
        (3908, 84) | (3911, 80) | (4067, 80) | (4113, 80) | (4239, 80) | (6156, 80) => {
            return Some(Bludgeoning);
        }
        (2030, 122) => return Some(Fire),      // Flaming Blaze
        (2032, 122) => return Some(Lightning), // Electric Blaze
        (2033, 122) => return Some(Acid),      // Acidic Spray
        (2038, 135) => return Some(Frost),     // Exploding Ice
        (2674, 237) => return Some(Piercing),  // Vicious Rebuke
        (2701, 237) => return Some(Fire),      // Elemental Fury
        (2702, 237) => return Some(Frost),     // Elemental Fury
        (2703, 237) => return Some(Acid),      // Elemental Fury
        (2704, 237) => return Some(Lightning), // Elemental Fury
        (2781, 237) => return Some(Acid),      // Lesser Elemental Fury
        (2782, 237) => return Some(Fire),      // Lesser Elemental Fury
        (2783, 237) => return Some(Frost),     // Lesser Elemental Fury
        (2784, 237) => return Some(Lightning), // Lesser Elemental Fury
        (3457, 118) => return Some(Frost),     // Mana Bolt
        (3458, 223) => return Some(Frost),     // Mana Purge
        (3857, 237) => return Some(Frost),     // Pumpkin Rain
        (3904, 237) => return Some(Acid),      // Essence's Fury
        (3905, 237) => return Some(Acid),      // Essence's Fury
        (3906, 237) => return Some(Acid),      // Essence's Fury
        (3907, 237) => return Some(Acid),      // Essence's Fury
        (4092, 241) => return Some(Fire),      // Flame Grenade
        (4269, 118) => return Some(Slashing),  // Present
        (4270, 118) => return Some(Piercing),  // Table
        (5370, 246) => return Some(Nether),    // Incantation of Nether Streak
        (5524, 237) => return Some(Piercing),  // Falling stalactite
        (5544, 135) => return Some(Nether),    // Nether Blast I
        (5545, 135) => return Some(Nether),    // Nether Blast II
        (5546, 135) => return Some(Nether),    // Nether Blast III
        (5547, 135) => return Some(Nether),    // Nether Blast IV
        (5548, 135) => return Some(Nether),    // Nether Blast V
        (5549, 135) => return Some(Nether),    // Nether Blast VI
        (5550, 135) => return Some(Nether),    // Nether Blast VII
        (5551, 135) => return Some(Nether),    // Incantation of Nether Blast
        (5762, 117) => return Some(Frost),     // Rolling Death
        (6187, 132) => return Some(Piercing),  // Screeching Howl
        _ => {}
    }
    // Fireworks and healing-only curses have no damage/protection association.
    // EType alone is insufficient for non-damaging effects. Names/descriptions
    // are never parsed: Clouded Soul's nether description conflicts with ACE's
    // electric EType, while Flame Blast 3662 and Volcanic Blast 2710 remain fire.
    match category {
        // HealthLowering:43 health boosts,9 life projectiles,11 health projectiles,
        // one hostile health transfer; the five bludgeoning exceptions above win.
        // ACE WorldObject_Magic.cs:514 records Harm as DamageType.Health.
        80 => Some(Direct),
        // ACE SpellCategory and saved server StatModType/Key census (2026-09-16):
        // body armor, item ArmorLevel, weapon damage, general/critical damage
        // ratings, drain/DoT resistance, and WeaknessRating. These effects are
        // not associated with a single elemental type.
        115 | 116 | 154 | 155 | 160 | 161 | 190 | 323 | 325 | 379 | 391 | 457 | 458 | 473 | 513
        | 611 | 620 | 621 | 626 | 628 | 629 | 633 | 634 | 642 | 650 | 651 | 653 | 657 | 658
        | 694 | 695 | 711 | 712 | 713 | 714 | 728 | 729 | 732 | 733 => Some(Misc),
        // EnchantmentManager.cs:1234 ticks DamageOverTime as Undef, not Nether.
        // Category 618 also contains Spectral Fountain Sip's negative HealOverTime
        // (:1294), which causes periodic health loss through the healing path.
        618 | 631 | 685 => Some(Misc),
        101 | 102 | 117 | 124 | 131 | 138 | 145 | 162 | 163 | 188 | 189 | 207 | 222 | 229 | 236
        | 243 | 285 | 286 | 381 | 382 | 448 | 449 | 581 => Some(Acid),
        103 | 104 | 118 | 125 | 132 | 139 | 146 | 164 | 165 | 176 | 177 | 208 | 223 | 230 | 237
        | 244 | 383 | 384 | 401 | 402 | 463 | 464 | 578 => Some(Bludgeoning),
        105 | 106 | 119 | 126 | 133 | 140 | 147 | 166 | 167 | 184 | 185 | 209 | 224 | 231 | 238
        | 245 | 289 | 290 | 387 | 388 | 466 | 467 | 582 => Some(Frost),
        107 | 108 | 120 | 127 | 134 | 141 | 148 | 168 | 169 | 182 | 183 | 210 | 225 | 232 | 239
        | 246 | 291 | 292 | 397 | 398 | 476 | 477 | 583 => Some(Lightning),
        109 | 110 | 121 | 128 | 135 | 142 | 149 | 170 | 171 | 186 | 187 | 211 | 226 | 233 | 240
        | 247 | 287 | 288 | 385 | 386 | 479 | 480 | 580 => Some(Fire),
        111 | 112 | 122 | 129 | 136 | 143 | 150 | 172 | 173 | 180 | 181 | 212 | 227 | 234 | 241
        | 248 | 393 | 394 | 405 | 406 | 497 | 498 | 579 => Some(Piercing),
        113 | 114 | 123 | 130 | 137 | 144 | 151 | 174 | 175 | 178 | 179 | 213 | 228 | 235 | 242
        | 249 | 395 | 396 | 403 | 404 | 502 | 503 | 577 => Some(Slashing),
        636..=641 => Some(Nether),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn direct_health_damage_excludes_healing_and_self_conversion() {
        for (id, category, flags, expected) in [
            (7, 80, 19, Some(SpellDamageAssociation::Direct)),
            (8, 80, 26, Some(SpellDamageAssociation::Direct)),
            (5, 79, 4, None),
            (1278, 87, 14, None),
            (1237, 87, 19, Some(SpellDamageAssociation::Direct)),
            (4067, 80, 2067, Some(SpellDamageAssociation::Bludgeoning)),
            (3914, 223, 147, Some(SpellDamageAssociation::Direct)),
            (3047, 84, 147, Some(SpellDamageAssociation::Direct)),
        ] {
            let spell = SpellBase {
                category,
                bitfield: flags,
                ..Default::default()
            };
            assert_eq!(classify(id, &spell).damage, expected);
        }
    }

    #[test]
    fn miscellaneous_effects_require_verified_damage_or_protection() {
        for (id, category) in [
            (1, 115),
            (1, 116),
            (1, 160),
            (1, 161), // Armor, Imperil, Impenetrability, Brittlemail.
            (1, 154),
            (1, 695),
            (1, 621),
            (1, 658), // Weapon damage and general protection.
            (1, 618),
            (1, 631),
            (1, 685), // Non-elemental periodic damage.
            (4722, 530),
            (4723, 530),
            (5138, 610),
            (5140, 610),
            (6174, 703),
        ] {
            assert_eq!(
                damage_association(id, category),
                Some(SpellDamageAssociation::Misc)
            );
        }
        for (id, category) in [
            (1, 1),
            (1, 55),
            (1, 79),
            (1, 617), // Skills, armor tinkering, healing.
            (1, 643),
            (1, 409),
            (1, 9999), // Healing reduction, fireworks, unknown.
            (6158, 530),
            (5174, 610),
            (1, 703), // Mixed/unknown category identities.
            (4722, 9999),
            (6174, 9999), // Changed definitions do not inherit exceptions.
        ] {
            assert_eq!(damage_association(id, category), None);
        }
        assert_eq!(
            damage_association(1, 636),
            Some(SpellDamageAssociation::Nether)
        );
    }

    #[test]
    fn beneficial_and_harmful_are_independent_of_self_targeting() {
        for (flags, beneficial) in [(0, false), (4, true), (8, false), (12, true)] {
            let spell = SpellBase {
                bitfield: flags,
                ..Default::default()
            };
            assert_eq!(classify(1, &spell).beneficial, beneficial);
        }
    }

    #[test]
    fn retail_levels_are_independent_of_names_and_icon_tiers() {
        for (component, level) in [
            (0, None),
            (1, Some(1)),
            (6, Some(6)),
            (110, Some(6)),
            (112, Some(7)),
            (192, Some(7)),
            (193, Some(8)),
            (999, None),
        ] {
            let mut spell = SpellBase {
                name: "Summon Primary Portal I".into(),
                ..Default::default()
            };
            spell.components[0] = component;
            assert_eq!(classify(1, &spell).level, level);
        }
    }

    #[test]
    fn targeting_keeps_fellowship_and_recipient_distinctions() {
        for (flags, target, meta, expected, fellowship) in [
            (8, 65536, 7, Some(SpellRecipientAssociation::Item), false),
            (0, 16, 1, Some(SpellRecipientAssociation::Creature), false),
            (0, 6, 1, Some(SpellRecipientAssociation::Item), false),
            (0, 0, 2, None, false),
            (8, 16, 12, Some(SpellRecipientAssociation::Creature), true),
            (8192, 16, 1, Some(SpellRecipientAssociation::Creature), true),
            (0, 123456, 1, None, false),
        ] {
            let spell = SpellBase {
                bitfield: flags,
                non_component_target_type: target,
                meta_spell_type: meta,
                ..Default::default()
            };
            let result = classify(1, &spell);
            assert_eq!(
                (result.recipient, result.fellowship),
                (expected, fellowship)
            );
        }
    }

    #[test]
    fn reviewed_damage_categories_and_exceptions_do_not_parse_names() {
        use SpellDamageAssociation::*;
        for (id, category, expected) in [
            (1, 101, Some(Acid)),
            (1, 166, Some(Frost)),
            (1, 107, Some(Lightning)),
            (5544, 135, Some(Nether)),
            (5544, 101, Some(Acid)),
            (3905, 237, Some(Acid)),
            (5331, 225, Some(Lightning)),
            (3662, 135, Some(Fire)),
            (1, 409, None),
            (1, 642, Some(Misc)),
            (1, 643, None),
            (1, 700, None),
            (1, 9999, None),
        ] {
            assert_eq!(damage_association(id, category), expected);
        }
    }
}
