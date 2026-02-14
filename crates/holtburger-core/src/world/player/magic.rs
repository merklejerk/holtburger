use super::PlayerState;
use holtburger_protocol::messages::magic::Enchantment;
use std::collections::HashMap;

impl PlayerState {
    /// Returns the current enchantments that are currently "winning" their categories.
    ///
    /// According to ACE source (PropertiesEnchantmentRegistryExtensions.cs),
    /// the winner is determined by PowerLevel, then StartTime. LayerId is
    /// preserved as a sequence number for the stack but isn't the primary arbiter.
    pub fn get_active_enchantments(&self) -> Vec<Enchantment> {
        let mut by_category: HashMap<u16, Enchantment> = HashMap::new();

        for e in &self.enchantments {
            let existing = by_category.get(&e.spell_category);
            match existing {
                Some(best) => {
                    if e.is_better_than(best) {
                        by_category.insert(e.spell_category, *e);
                    }
                }
                None => {
                    by_category.insert(e.spell_category, *e);
                }
            }
        }

        by_category.into_values().collect()
    }
}
