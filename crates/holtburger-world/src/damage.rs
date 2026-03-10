use holtburger_common::properties::DamageType;
use holtburger_protocol::messages::object::types::WeaponProfile;

pub struct DamageRange {
    pub min: f64,
    pub max: f64,
    pub damage_type: DamageType,
}

/// Computes the damage range for a weapon entity.
///
/// Based on ACE Server logic:
/// MinDamage = MaxDamage * (1.0 - Variance)
pub fn compute_damage_range(
    max_damage: Option<i32>,
    variance: Option<f64>,
    damage_type_bits: Option<u32>,
    weapon_profile: Option<&WeaponProfile>,
) -> Option<DamageRange> {
    let max_damage = if let Some(damage) = max_damage {
        damage as f64
    } else if let Some(profile) = weapon_profile {
        profile.damage as f64
    } else {
        return None;
    };

    let variance = if let Some(v) = variance {
        v
    } else if let Some(profile) = weapon_profile {
        profile.damage_variance
    } else {
        0.0
    };

    let damage_type_raw = if let Some(dt) = damage_type_bits {
        dt
    } else if let Some(profile) = weapon_profile {
        profile.damage_type
    } else {
        DamageType::SLASH.bits()
    };

    let damage_type = DamageType::from_bits_truncate(damage_type_raw);

    // ACE logic: MinDamage => MaxDamage * (1.0f - Variance)
    let min_damage = max_damage * (1.0 - variance);

    Some(DamageRange {
        min: min_damage,
        max: max_damage,
        damage_type,
    })
}
