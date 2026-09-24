//! Shared interpretation of the player's live enchantment registry.
//!
//! ACE filters by affected stat and modifier operation before choosing a winner
//! for each spell category. The same spell can therefore contribute under several
//! headings, and several categories can contribute under one heading.

use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::sync::Arc;
use std::time::Instant;

use holtburger_common::properties::{EnchantmentTypeFlags as Flags, PropertyFloat, PropertyInt};
use holtburger_protocol::messages::magic::Enchantment;
use serde::Serialize;

use crate::inspection::VitalType as VitalPropertyType;
use crate::spell::SpellCatalog;
use crate::stats::{AttributeType, SkillType, VitalType};

/// The first spell ID ACE considers when building its set-spell membership from DAT tiers.
/// ACE Server/Entity/SpellSet.cs:22.
const FIRST_SET_SPELL_ID: u32 = 4730;

/// Equal-power self auras preferred to their Other counterparts by ACE.
/// ACE Entity/Models/PropertiesEnchantmentRegistryExtensions.cs:130.
const PREFERRED_SELF_AURAS: [u16; 6] = [4395, 4400, 4405, 4414, 4417, 4418];

/// Identity used by update and removal packets; layer is not stacking priority.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnchantmentKey {
    pub spell_id: u16,
    pub layer: u16,
}

impl From<&Enchantment> for EnchantmentKey {
    fn from(value: &Enchantment) -> Self {
        Self {
            spell_id: value.spell_id,
            layer: value.layer,
        }
    }
}

/// A wire sample plus the local monotonic instant at which its relative age was received.
#[derive(Debug, Clone, Copy)]
pub struct EnchantmentObservation {
    pub enchantment: Enchantment,
    pub received_at: Instant,
}

/// Player-owned registry. Each wire value and its receipt time form one atomic record.
#[derive(Debug, Clone, Default)]
pub struct PlayerEnchantments {
    observations: Vec<EnchantmentObservation>,
    rules: Arc<EnchantmentRules>,
}

impl PlayerEnchantments {
    pub fn with_rules(rules: EnchantmentRules) -> Self {
        Self {
            rules: Arc::new(rules),
            ..Self::default()
        }
    }

    pub fn replace(&mut self, enchantments: &[Enchantment]) {
        let now = Instant::now();
        self.observations = enchantments
            .iter()
            .copied()
            .map(|enchantment| EnchantmentObservation {
                enchantment,
                received_at: now,
            })
            .collect();
    }

    pub fn upsert(&mut self, enchantment: Enchantment) {
        let observation = EnchantmentObservation::new(enchantment);
        let key = EnchantmentKey::from(&enchantment);
        if let Some(index) = self
            .observations
            .iter()
            .position(|existing| EnchantmentKey::from(&existing.enchantment) == key)
        {
            self.observations[index] = observation;
        } else {
            self.observations.push(observation);
        }
    }

    pub fn retain(&mut self, mut predicate: impl FnMut(&Enchantment) -> bool) {
        self.observations
            .retain(|observation| predicate(&observation.enchantment));
    }

    pub fn resolved(&self, now: Instant) -> ResolvedEnchantments {
        resolve_enchantments(&self.observations, &self.rules, now)
    }

    pub fn wire(&self) -> Vec<Enchantment> {
        self.iter().copied().collect()
    }

    pub fn iter(&self) -> impl Iterator<Item = &Enchantment> {
        self.observations
            .iter()
            .map(|observation| &observation.enchantment)
    }

    /// ACE's modifier query: filter candidates before choosing one per category.
    /// `handle_multiple` admits key-zero all-stat modifiers for this affected key.
    pub fn top_for(
        &self,
        required_flags: u32,
        key: u32,
        handle_multiple: bool,
        keyless: bool,
    ) -> Vec<&Enchantment> {
        let now = Instant::now();
        let query = EnchantmentQuery {
            required_flags,
            key,
            handle_multiple,
            keyless,
        };
        let mut winners: BTreeMap<u16, usize> = BTreeMap::new();
        for (index, observation) in self.observations.iter().enumerate() {
            let enchantment = &observation.enchantment;
            if !query.matches(enchantment) {
                continue;
            }
            winners
                .entry(enchantment.spell_category)
                .and_modify(|current| {
                    if self
                        .rules
                        .challenger_wins(self.observations[*current], *observation, now)
                    {
                        *current = index;
                    }
                })
                .or_insert(index);
        }
        winners
            .into_values()
            .map(|index| &self.observations[index].enchantment)
            .collect()
    }

    /// ACE adds attack/defense-wide additive queries after the ordinary skill query.
    /// ACE Server/WorldObjects/Managers/EnchantmentManager.cs:759-772,1104-1122.
    pub fn skill_wide_additive(&self, skill: SkillType) -> f32 {
        let channel = if ATTACK_SKILLS.contains(&skill) {
            Some(Flags::ATTACK_SKILLS)
        } else if DEFENSE_SKILLS.contains(&skill) {
            Some(Flags::DEFENSE_SKILLS)
        } else {
            None
        };
        channel.map_or(0.0, |flag| {
            self.top_for(
                (Flags::SKILL | Flags::ADDITIVE | flag).bits(),
                0,
                false,
                false,
            )
            .into_iter()
            .map(|enchantment| enchantment.stat_mod_value)
            .sum::<f32>()
            .round_ties_even()
        })
    }

    #[cfg(test)]
    pub fn push(&mut self, enchantment: Enchantment) {
        self.observations
            .push(EnchantmentObservation::new(enchantment));
    }
}

/// Candidate predicate shared by gameplay queries and exported contribution groups.
/// ACE Entity/Models/PropertiesEnchantmentRegistryExtensions.cs:198-226.
#[derive(Clone, Copy)]
struct EnchantmentQuery {
    required_flags: u32,
    key: u32,
    handle_multiple: bool,
    keyless: bool,
}

impl EnchantmentQuery {
    fn matches(self, enchantment: &Enchantment) -> bool {
        let flags = enchantment.stat_mod_type;
        let single = (flags & self.required_flags) == self.required_flags
            && (self.keyless || enchantment.stat_mod_key == self.key)
            && (!self.handle_multiple || (flags & Flags::SINGLE_STAT.bits()) != 0);
        let multiple = self.handle_multiple
            && (flags & (self.required_flags | Flags::MULTIPLE_STAT.bits()))
                == (self.required_flags | Flags::MULTIPLE_STAT.bits())
            && (flags & Flags::VITAE.bits()) == 0
            && enchantment.stat_mod_key == 0;
        single || multiple
    }
}

impl EnchantmentObservation {
    pub fn new(enchantment: Enchantment) -> Self {
        Self {
            enchantment,
            received_at: Instant::now(),
        }
    }

    /// The wire start offset expressed at `now`, for comparing separate receipts.
    pub fn start_offset_at(self, now: Instant) -> f64 {
        self.enchantment.start_time - now.duration_since(self.received_at).as_secs_f64()
    }

    pub fn remaining_seconds(self, now: Instant) -> Option<f64> {
        (self.enchantment.duration >= 0.0)
            .then(|| (self.enchantment.duration + self.start_offset_at(now)).max(0.0))
    }
}

/// The direct stat/property heading affected by a modifier.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(tag = "kind", content = "key", rename_all = "camelCase")]
pub enum AffectedStat {
    Attribute(u32),
    Vital(u32),
    Skill(u32),
    IntProperty(u32),
    FloatProperty(u32),
    Armor,
    Damage,
    DamageVariance,
    /// Preserve effects whose modifier cannot yet be assigned to a typed heading.
    Other(u32, u32),
}

/// ACE resolves additive and multiplicative modifiers in separate query contexts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum EnchantmentOperation {
    Additive,
    Multiplicative,
    Other,
}

/// Independent ACE query that contributes beneath an affected-stat heading.
/// Attack/defense-wide skill effects are added after the ordinary skill query.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum EnchantmentChannel {
    Ordinary,
    AttackSkills,
    DefenseSkills,
}

/// Classification of a live registry record before ordinary-spell stacking.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum EnchantmentKind {
    Beneficial,
    Harmful,
    Vitae,
    Cooldown,
}

impl EnchantmentKind {
    pub fn of(enchantment: &Enchantment) -> Self {
        let flags = Flags::from_bits_retain(enchantment.stat_mod_type);
        if flags.contains(Flags::VITAE) || enchantment.spell_id == 666 {
            Self::Vitae
        } else if flags.contains(Flags::COOLDOWN) || enchantment.spell_id >= 0x8000 {
            Self::Cooldown
        } else if flags.contains(Flags::BENEFICIAL) {
            Self::Beneficial
        } else {
            Self::Harmful
        }
    }
}

/// One record retained exactly once even if several affected-stat groups refer to it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedEnchantment {
    pub key: EnchantmentKey,
    pub spell_category: u16,
    pub power_level: u32,
    pub kind: EnchantmentKind,
    pub remaining_seconds: Option<f64>,
    pub stat_mod_type: u32,
    pub stat_mod_key: u32,
    pub stat_mod_value: f32,
}

/// One independently effective category in one affected-stat/operation context.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnchantmentLayerGroup {
    pub affected_stat: AffectedStat,
    /// Shared display name for a known stat or property key; UIs choose final wording.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stat_name: Option<String>,
    pub operation: EnchantmentOperation,
    /// Distinguishes independent ACE queries beneath the same stat and category.
    pub channel: EnchantmentChannel,
    pub spell_category: u16,
    pub effective: EnchantmentKey,
    pub overridden: Vec<EnchantmentKey>,
}

/// Reusable semantic snapshot; frontends choose labels, filters and display order.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedEnchantments {
    pub instances: Vec<ResolvedEnchantment>,
    pub groups: Vec<EnchantmentLayerGroup>,
}

/// Authored set-spell membership used by ACE's tie rule.
#[derive(Debug, Clone, Default)]
pub struct EnchantmentRules {
    set_spells: HashSet<u16>,
}

impl EnchantmentRules {
    pub fn from_catalog(catalog: &SpellCatalog) -> Self {
        let set_spells = catalog
            .spell_sets
            .values()
            .flat_map(|set| set.tiers.values())
            .flat_map(|tier| tier.spells.iter().copied())
            .filter(|id| *id >= FIRST_SET_SPELL_ID)
            .filter_map(|id| u16::try_from(id).ok())
            .collect();
        Self { set_spells }
    }

    /// Compare only gameplay priority. Complete ties retain the earlier registry entry.
    fn challenger_wins(
        &self,
        current: EnchantmentObservation,
        challenger: EnchantmentObservation,
        now: Instant,
    ) -> bool {
        let a = &current.enchantment;
        let b = &challenger.enchantment;
        // RETAIL DIVERGENCE: acclient.c:478674-478718 duels by power and start time alone.
        // ACE's self-aura/set tie corrections represent the server's effective stats; using
        // retail's order here would show the wrong effective row on that server. The local DAT
        // census found six self/other aura pairs and 45 tied category/power set-spell groups
        // (278 definitions); it did not measure simultaneous live instances.
        if a.power_level != b.power_level {
            return b.power_level > a.power_level;
        }
        let a_self = PREFERRED_SELF_AURAS.contains(&a.spell_id);
        let b_self = PREFERRED_SELF_AURAS.contains(&b.spell_id);
        if a_self != b_self {
            return b_self;
        }
        let a_key = if self.set_spells.contains(&a.spell_id) {
            f64::from(a.spell_id)
        } else {
            current.start_offset_at(now)
        };
        let b_key = if self.set_spells.contains(&b.spell_id) {
            f64::from(b.spell_id)
        } else {
            challenger.start_offset_at(now)
        };
        b_key > a_key
    }
}

/// Produce shared instance facts and one family per contributing stat/category.
pub fn resolve_enchantments(
    observations: &[EnchantmentObservation],
    rules: &EnchantmentRules,
    now: Instant,
) -> ResolvedEnchantments {
    let instances = observations
        .iter()
        .map(|observation| {
            let enchantment = &observation.enchantment;
            ResolvedEnchantment {
                key: enchantment.into(),
                spell_category: enchantment.spell_category,
                power_level: enchantment.power_level,
                kind: EnchantmentKind::of(enchantment),
                remaining_seconds: observation.remaining_seconds(now),
                stat_mod_type: enchantment.stat_mod_type,
                stat_mod_key: enchantment.stat_mod_key,
                stat_mod_value: enchantment.stat_mod_value,
            }
        })
        .collect();

    let mut candidates: BTreeMap<
        (AffectedStat, EnchantmentOperation, EnchantmentChannel, u16),
        Vec<usize>,
    > = BTreeMap::new();
    for (index, observation) in observations.iter().enumerate() {
        let enchantment = &observation.enchantment;
        if !matches!(
            EnchantmentKind::of(enchantment),
            EnchantmentKind::Beneficial | EnchantmentKind::Harmful
        ) {
            continue;
        }
        for operation in operations(enchantment.stat_mod_type) {
            for (affected_stat, channel) in affected_contributions(enchantment) {
                if !query_for(affected_stat, operation, channel, enchantment).matches(enchantment) {
                    continue;
                }
                candidates
                    .entry((
                        affected_stat,
                        operation,
                        channel,
                        enchantment.spell_category,
                    ))
                    .or_default()
                    .push(index);
            }
        }
    }

    let groups = candidates
        .into_iter()
        .map(
            |((affected_stat, operation, channel, spell_category), indices)| {
                let mut winner = indices[0];
                for &index in indices.iter().skip(1) {
                    if rules.challenger_wins(observations[winner], observations[index], now) {
                        winner = index;
                    }
                }
                EnchantmentLayerGroup {
                    affected_stat,
                    stat_name: stat_name(affected_stat),
                    operation,
                    channel,
                    spell_category,
                    effective: (&observations[winner].enchantment).into(),
                    overridden: indices
                        .into_iter()
                        .filter(|index| *index != winner)
                        .map(|index| (&observations[index].enchantment).into())
                        .collect(),
                }
            },
        )
        .collect();
    ResolvedEnchantments { instances, groups }
}

fn stat_name(stat: AffectedStat) -> Option<String> {
    match stat {
        AffectedStat::Attribute(key) => {
            AttributeType::from_repr(key).map(|value| value.to_string())
        }
        AffectedStat::Vital(key) => usize::try_from(key)
            .ok()
            .and_then(VitalPropertyType::from_repr)
            .map(|value| value.to_string()),
        AffectedStat::Skill(key) => SkillType::from_repr(key).map(|value| value.to_string()),
        AffectedStat::IntProperty(key) => {
            PropertyInt::from_repr(key).map(|value| value.to_string())
        }
        AffectedStat::FloatProperty(key) => {
            PropertyFloat::from_repr(key).map(|value| value.to_string())
        }
        _ => None,
    }
}

fn operations(stat_mod_type: u32) -> impl Iterator<Item = EnchantmentOperation> {
    let flags = Flags::from_bits_retain(stat_mod_type);
    let additive = flags.contains(Flags::ADDITIVE);
    let multiplicative = flags.contains(Flags::MULTIPLICATIVE);
    [
        additive.then_some(EnchantmentOperation::Additive),
        multiplicative.then_some(EnchantmentOperation::Multiplicative),
        (!additive && !multiplicative).then_some(EnchantmentOperation::Other),
    ]
    .into_iter()
    .flatten()
}

fn query_for(
    affected_stat: AffectedStat,
    operation: EnchantmentOperation,
    channel: EnchantmentChannel,
    enchantment: &Enchantment,
) -> EnchantmentQuery {
    let operation_flag = match operation {
        EnchantmentOperation::Additive => Flags::ADDITIVE.bits(),
        EnchantmentOperation::Multiplicative => Flags::MULTIPLICATIVE.bits(),
        EnchantmentOperation::Other => 0,
    };
    let (stat_flag, key, handle_multiple, keyless) = match channel {
        EnchantmentChannel::AttackSkills => (
            Flags::SKILL.bits() | Flags::ATTACK_SKILLS.bits(),
            0,
            false,
            false,
        ),
        EnchantmentChannel::DefenseSkills => (
            Flags::SKILL.bits() | Flags::DEFENSE_SKILLS.bits(),
            0,
            false,
            false,
        ),
        EnchantmentChannel::Ordinary => match affected_stat {
            AffectedStat::Attribute(key) => (Flags::ATTRIBUTE.bits(), key, true, false),
            AffectedStat::Vital(key) => (Flags::SECOND_ATT.bits(), key, true, false),
            AffectedStat::Skill(key) => (Flags::SKILL.bits(), key, true, false),
            AffectedStat::IntProperty(key) => (Flags::INT.bits(), key, false, false),
            AffectedStat::FloatProperty(key) => (Flags::FLOAT.bits(), key, false, false),
            AffectedStat::Armor => (Flags::BODY_ARMOR_VALUE.bits(), 0, false, true),
            AffectedStat::Damage => (Flags::BODY_DAMAGE_VALUE.bits(), 0, false, true),
            AffectedStat::DamageVariance => (Flags::BODY_DAMAGE_VARIANCE.bits(), 0, false, true),
            AffectedStat::Other(_, key) => (enchantment.stat_mod_type, key, false, false),
        },
    };
    EnchantmentQuery {
        required_flags: stat_flag | operation_flag,
        key,
        handle_multiple,
        keyless,
    }
}

fn affected_contributions(
    enchantment: &Enchantment,
) -> BTreeSet<(AffectedStat, EnchantmentChannel)> {
    let flags = Flags::from_bits_retain(enchantment.stat_mod_type);
    let key = enchantment.stat_mod_key;
    let mut targets = BTreeSet::new();
    let multiple = flags.contains(Flags::MULTIPLE_STAT) && key == 0;
    let ordinary = |stat| (stat, EnchantmentChannel::Ordinary);

    if flags.contains(Flags::ATTRIBUTE) {
        if multiple {
            targets.extend((1..=6).map(|key| ordinary(AffectedStat::Attribute(key))));
        } else {
            targets.insert(ordinary(AffectedStat::Attribute(key)));
        }
    }
    if flags.contains(Flags::SECOND_ATT) {
        if multiple {
            targets.extend(
                [VitalType::Health, VitalType::Stamina, VitalType::Mana]
                    .map(|vital| ordinary(AffectedStat::Vital(vital as u32))),
            );
        } else {
            targets.insert(ordinary(AffectedStat::Vital(key)));
        }
    }
    if flags.contains(Flags::SKILL) {
        if multiple {
            targets.extend(
                (1..=54)
                    .filter_map(SkillType::from_repr)
                    .map(|skill| ordinary(AffectedStat::Skill(skill as u32))),
            );
        } else if flags.contains(Flags::SINGLE_STAT) {
            targets.insert(ordinary(AffectedStat::Skill(key)));
        }
        if flags.contains(Flags::ATTACK_SKILLS) {
            targets.extend(ATTACK_SKILLS.map(|skill| {
                (
                    AffectedStat::Skill(skill as u32),
                    EnchantmentChannel::AttackSkills,
                )
            }));
        }
        if flags.contains(Flags::DEFENSE_SKILLS) {
            targets.extend(DEFENSE_SKILLS.map(|skill| {
                (
                    AffectedStat::Skill(skill as u32),
                    EnchantmentChannel::DefenseSkills,
                )
            }));
        }
    }
    if flags.contains(Flags::INT) {
        targets.insert(ordinary(AffectedStat::IntProperty(key)));
    }
    if flags.contains(Flags::FLOAT) {
        targets.insert(ordinary(AffectedStat::FloatProperty(key)));
    }
    if flags.contains(Flags::BODY_ARMOR_VALUE) {
        targets.insert(ordinary(AffectedStat::Armor));
    }
    if flags.contains(Flags::BODY_DAMAGE_VALUE) {
        targets.insert(ordinary(AffectedStat::Damage));
    }
    if flags.contains(Flags::BODY_DAMAGE_VARIANCE) {
        targets.insert(ordinary(AffectedStat::DamageVariance));
    }
    if targets.is_empty() {
        targets.insert(ordinary(AffectedStat::Other(
            enchantment.stat_mod_type,
            key,
        )));
    }
    targets
}

// ACE Entity/Enum/Skill.cs:263 and :290; includes legacy skills supported by ACE.
const ATTACK_SKILLS: [SkillType; 20] = [
    SkillType::Axe,
    SkillType::Bow,
    SkillType::Crossbow,
    SkillType::Dagger,
    SkillType::Mace,
    SkillType::Sling,
    SkillType::Spear,
    SkillType::Staff,
    SkillType::Sword,
    SkillType::ThrownWeapon,
    SkillType::UnarmedCombat,
    SkillType::FinesseWeapons,
    SkillType::HeavyWeapons,
    SkillType::LightWeapons,
    SkillType::MissileWeapons,
    SkillType::TwoHandedCombat,
    SkillType::WarMagic,
    SkillType::LifeMagic,
    SkillType::VoidMagic,
    SkillType::DualWield,
];
const DEFENSE_SKILLS: [SkillType; 4] = [
    SkillType::MeleeDefense,
    SkillType::MissileDefense,
    SkillType::MagicDefense,
    SkillType::Shield,
];

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(spell_id: u16, category: u16, power: u32, flags: Flags, key: u32) -> Enchantment {
        Enchantment {
            spell_id,
            spell_category: category,
            power_level: power,
            stat_mod_type: flags.bits(),
            stat_mod_key: key,
            duration: 60.0,
            ..Default::default()
        }
    }

    #[test]
    fn independent_categories_and_multiple_stats_share_instances() {
        let now = Instant::now();
        let flags = Flags::ATTRIBUTE | Flags::ADDITIVE | Flags::MULTIPLE_STAT | Flags::BENEFICIAL;
        let observations = [
            EnchantmentObservation {
                enchantment: sample(1, 10, 100, flags, 0),
                received_at: now,
            },
            EnchantmentObservation {
                enchantment: sample(2, 10, 50, flags, 0),
                received_at: now,
            },
            EnchantmentObservation {
                enchantment: sample(3, 20, 80, flags, 0),
                received_at: now,
            },
        ];
        let resolved = resolve_enchantments(&observations, &EnchantmentRules::default(), now);
        assert_eq!(resolved.instances.len(), 3);
        assert_eq!(resolved.groups.len(), 12);
        for stat in 1..=6 {
            let groups: Vec<_> = resolved
                .groups
                .iter()
                .filter(|group| group.affected_stat == AffectedStat::Attribute(stat))
                .collect();
            assert_eq!(groups.len(), 2);
            assert_eq!(groups[0].effective.spell_id, 1);
            assert_eq!(groups[0].overridden[0].spell_id, 2);
            assert_eq!(groups[1].effective.spell_id, 3);
        }
    }

    #[test]
    fn set_and_self_aura_ties_use_ace_priority() {
        let now = Instant::now();
        let flags = Flags::ATTRIBUTE | Flags::ADDITIVE | Flags::SINGLE_STAT;
        let observations = [
            EnchantmentObservation {
                enchantment: sample(6330, 729, 1, flags, 1),
                received_at: now,
            },
            EnchantmentObservation {
                enchantment: sample(6331, 729, 1, flags, 1),
                received_at: now,
            },
            EnchantmentObservation {
                enchantment: sample(5997, 154, 400, flags, 1),
                received_at: now,
            },
            EnchantmentObservation {
                enchantment: sample(4395, 154, 400, flags, 1),
                received_at: now,
            },
        ];
        let rules = EnchantmentRules {
            set_spells: HashSet::from([6330, 6331]),
        };
        let resolved = resolve_enchantments(&observations, &rules, now);
        assert_eq!(resolved.groups[0].effective.spell_id, 4395);
        assert_eq!(resolved.groups[1].effective.spell_id, 6331);
    }

    #[test]
    fn receipt_time_preserves_recency_and_zero_does_not_remove() {
        let now = Instant::now();
        let flags = Flags::ATTRIBUTE | Flags::ADDITIVE | Flags::SINGLE_STAT;
        let older = EnchantmentObservation {
            enchantment: sample(1, 10, 100, flags, 1),
            received_at: now - std::time::Duration::from_secs(20),
        };
        let newer = EnchantmentObservation {
            enchantment: sample(2, 10, 100, flags, 1),
            received_at: now,
        };
        let resolved = resolve_enchantments(&[older, newer], &EnchantmentRules::default(), now);
        assert_eq!(resolved.groups[0].effective.spell_id, 2);
        assert_eq!(resolved.instances.len(), 2);
        assert_eq!(older.remaining_seconds(now), Some(40.0));
    }

    #[test]
    fn same_category_ordinary_and_attack_queries_both_contribute_to_axe() {
        let mut player = crate::player::PlayerState::new();
        let mut ordinary = sample(
            11,
            88,
            10,
            Flags::SKILL | Flags::ADDITIVE | Flags::SINGLE_STAT,
            SkillType::Axe as u32,
        );
        ordinary.stat_mod_value = 7.0;
        let mut attack = sample(
            12,
            88,
            20,
            Flags::SKILL | Flags::ADDITIVE | Flags::ATTACK_SKILLS,
            0,
        );
        attack.stat_mod_value = -3.0;
        player.enchantments.push(ordinary);
        player.enchantments.push(attack);

        let axe_groups: Vec<_> = player
            .enchantments
            .resolved(Instant::now())
            .groups
            .into_iter()
            .filter(|group| group.affected_stat == AffectedStat::Skill(SkillType::Axe as u32))
            .collect();
        assert_eq!(axe_groups.len(), 2);
        assert_eq!(axe_groups[0].channel, EnchantmentChannel::Ordinary);
        assert_eq!(axe_groups[0].effective.spell_id, 11);
        assert_eq!(axe_groups[1].channel, EnchantmentChannel::AttackSkills);
        assert_eq!(axe_groups[1].effective.spell_id, 12);
        assert_eq!(player.get_skill_additive(SkillType::Axe), 4.0);
        assert_eq!(player.get_skill_additive(SkillType::Shield), 0.0);
    }

    #[test]
    fn combined_modifier_flags_contribute_to_both_operation_queries() {
        let now = Instant::now();
        let enchantment = sample(
            13,
            89,
            10,
            Flags::ATTRIBUTE | Flags::ADDITIVE | Flags::MULTIPLICATIVE | Flags::SINGLE_STAT,
            1,
        );
        let resolved = resolve_enchantments(
            &[EnchantmentObservation {
                enchantment,
                received_at: now,
            }],
            &EnchantmentRules::default(),
            now,
        );
        assert_eq!(resolved.instances.len(), 1);
        assert_eq!(resolved.groups.len(), 2);
        assert_eq!(resolved.groups[0].operation, EnchantmentOperation::Additive);
        assert_eq!(
            resolved.groups[1].operation,
            EnchantmentOperation::Multiplicative
        );
    }

    #[test]
    fn groups_carry_canonical_stat_names_without_guessing_unknown_keys() {
        let now = Instant::now();
        let observations = [
            EnchantmentObservation {
                enchantment: sample(
                    17,
                    93,
                    10,
                    Flags::ATTRIBUTE | Flags::ADDITIVE | Flags::SINGLE_STAT,
                    1,
                ),
                received_at: now,
            },
            EnchantmentObservation {
                enchantment: sample(
                    18,
                    94,
                    10,
                    Flags::SECOND_ATT | Flags::ADDITIVE | Flags::SINGLE_STAT,
                    2,
                ),
                received_at: now,
            },
            EnchantmentObservation {
                enchantment: sample(
                    19,
                    95,
                    10,
                    Flags::SKILL | Flags::ADDITIVE | Flags::SINGLE_STAT,
                    1,
                ),
                received_at: now,
            },
            EnchantmentObservation {
                enchantment: sample(14, 90, 10, Flags::INT | Flags::ADDITIVE, 360),
                received_at: now,
            },
            EnchantmentObservation {
                enchantment: sample(15, 91, 10, Flags::FLOAT | Flags::MULTIPLICATIVE, 64),
                received_at: now,
            },
            EnchantmentObservation {
                enchantment: sample(16, 92, 10, Flags::FLOAT | Flags::ADDITIVE, 999),
                received_at: now,
            },
        ];
        let resolved = resolve_enchantments(&observations, &EnchantmentRules::default(), now);
        let symbols: Vec<_> = resolved
            .groups
            .iter()
            .map(|group| group.stat_name.as_deref())
            .collect();
        assert_eq!(
            symbols,
            [
                Some("Strength"),
                Some("Health"),
                Some("Axe"),
                Some("WeaponAuraDamage"),
                Some("ResistSlash"),
                None,
            ]
        );
    }

    #[test]
    fn zero_countdown_waits_for_removal_then_promotes_the_overridden_spell() {
        let mut registry = PlayerEnchantments::default();
        let flags = Flags::ATTRIBUTE | Flags::ADDITIVE | Flags::SINGLE_STAT | Flags::BENEFICIAL;
        let mut stronger = sample(21, 9, 8, flags, 1);
        stronger.duration = 10.0;
        stronger.start_time = -10.0;
        let weaker = sample(22, 9, 6, flags, 1);
        registry.replace(&[stronger, weaker]);

        let pending = registry.resolved(Instant::now());
        assert_eq!(pending.groups[0].effective.spell_id, 21);
        assert_eq!(pending.instances[0].remaining_seconds, Some(0.0));
        assert_eq!(
            pending.groups[0].overridden,
            vec![EnchantmentKey::from(&weaker)]
        );

        registry.retain(|enchantment| {
            EnchantmentKey::from(enchantment) != EnchantmentKey::from(&stronger)
        });
        let removed = registry.resolved(Instant::now());
        assert_eq!(removed.groups[0].effective.spell_id, 22);
        assert!(removed.groups[0].overridden.is_empty());
    }

    #[test]
    fn refresh_reanchors_only_its_identity_and_purge_keeps_special_records_typed() {
        let mut registry = PlayerEnchantments::default();
        let flags = Flags::ATTRIBUTE | Flags::ADDITIVE | Flags::SINGLE_STAT;
        let first = sample(31, 9, 8, flags, 1);
        let second = sample(32, 10, 8, flags, 1);
        let vitae = sample(666, 204, 30, Flags::VITAE | Flags::MULTIPLICATIVE, 0);
        registry.replace(&[first, second, vitae]);
        let original_second = registry.observations[1].received_at;
        registry.upsert(Enchantment {
            duration: 120.0,
            ..first
        });
        assert_eq!(registry.observations[1].received_at, original_second);
        assert_eq!(registry.wire()[0].duration, 120.0);

        registry.retain(|enchantment| enchantment.spell_id == 666);
        let purged = registry.resolved(Instant::now());
        assert!(purged.groups.is_empty());
        assert_eq!(purged.instances.len(), 1);
        assert_eq!(purged.instances[0].kind, EnchantmentKind::Vitae);
    }
}
