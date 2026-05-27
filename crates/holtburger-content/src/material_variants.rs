pub const LEGACY_SAMPLER_CLAMP_MATERIAL_VARIANT_SIGNATURE: &str = "sampler=clamp";
pub const LEGACY_SAMPLER_REPEAT_MATERIAL_VARIANT_SIGNATURE: &str = "sampler=repeat";

pub fn legacy_sampler_material_variant_signature(repeats: bool) -> &'static str {
    if repeats {
        LEGACY_SAMPLER_REPEAT_MATERIAL_VARIANT_SIGNATURE
    } else {
        LEGACY_SAMPLER_CLAMP_MATERIAL_VARIANT_SIGNATURE
    }
}
