//! Static spell references, independent of player knowledge and UI layout.

use holtburger_dat::file_type::{SpellTable, spell_table::component_power_tier};

/// Source facts consumed by the app host's spell artwork projection.
pub struct SpellReference<'a> {
    /// Authored display name.
    pub name: &'a str,
    /// Base RenderSurface identity.
    pub icon_id: u32,
    /// Decoded formula tier, including retail's unknown-component zero result.
    pub power_tier: u32,
    /// Authored flags; the app host owns visual interpretation.
    pub flags: u32,
}

/// Query an already parsed table without consulting live character membership.
pub fn spell_reference(table: &SpellTable, id: u32) -> Option<SpellReference<'_>> {
    table.spells.get(&id).map(|spell| SpellReference {
        name: &spell.name,
        icon_id: spell.icon_id,
        power_tier: component_power_tier(spell.components[0]),
        flags: spell.bitfield,
    })
}
