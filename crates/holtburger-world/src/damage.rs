use holtburger_common::properties::{DamageType, PropertyFloat, PropertyInt, WorldObjectPropertyAccessors};
use crate::entity::Entity;

pub struct DamageRange {
    pub min: f64,
    pub max: f64,
    pub damage_type: DamageType,
}

/// Computes the damage range for a weapon entity.
/// 
/// Based on ACE Server logic:
/// MinDamage = MaxDamage * (1.0 - Variance)
pub fn compute_damage_range(entity: &Entity) -> Option<DamageRange> {
    let max_damage = if let Some(damage) = entity.get_int_prop(PropertyInt::Damage) {
        damage as f64
    } else if let Some(profile) = &entity.weapon_profile {
        profile.damage as f64
    } else {
        return None;
    };

    let variance = if let Some(v) = entity.get_float_prop(PropertyFloat::DamageVariance) {
        v
    } else if let Some(profile) = &entity.weapon_profile {
        profile.damage_variance
    } else {
        0.0
    };

    let damage_type_raw = if let Some(dt) = entity.get_int_prop(PropertyInt::DamageType) {
        dt as u32
    } else if let Some(profile) = &entity.weapon_profile {
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
