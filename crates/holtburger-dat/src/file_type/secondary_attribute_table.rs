use super::skill_table::SkillFormula;
use crate::{EOR_PORTAL_NAMESPACE, ResourceKey, StaticResourceKey};
use binrw::BinRead;

/// Authored max-vital formulas from client_portal.dat record 0x0E000003.
#[derive(BinRead, Debug, Clone)]
#[br(little)]
pub struct SecondaryAttributeTable {
    pub id: u32,
    pub max_health: SkillFormula,
    pub max_stamina: SkillFormula,
    pub max_mana: SkillFormula,
}

impl SecondaryAttributeTable {
    pub const FILE_ID: u32 = 0x0E000003;

    /// Reference formulas for synthetic worlds without client assets.
    pub fn synthetic() -> Self {
        fn formula(attribute: u32, divisor: u32) -> SkillFormula {
            SkillFormula {
                w: 0,
                x: 1,
                y: 0,
                z: divisor,
                attr1: attribute,
                attr2: 0,
            }
        }
        Self {
            id: Self::FILE_ID,
            max_health: formula(2, 2),
            max_stamina: formula(2, 1),
            max_mana: formula(6, 1),
        }
    }
}

impl StaticResourceKey for SecondaryAttributeTable {
    const RESOURCE_KEY: ResourceKey<'static> =
        ResourceKey::new(EOR_PORTAL_NAMESPACE, Self::FILE_ID);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn decodes_three_authored_vital_formulas_in_ace_order() {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(&SecondaryAttributeTable::FILE_ID.to_le_bytes());
        for attribute in [2_u32, 2, 6] {
            for field in [0, 1, 0, 2, attribute, 0] {
                bytes.extend_from_slice(&field.to_le_bytes());
            }
        }
        let table = SecondaryAttributeTable::read(&mut Cursor::new(bytes)).unwrap();
        assert_eq!(table.id, SecondaryAttributeTable::FILE_ID);
        assert_eq!(table.max_health.w, 0);
        assert_eq!(table.max_health.x, 1);
        assert_eq!(table.max_health.y, 0);
        assert_eq!(table.max_health.attr1, 2);
        assert_eq!(table.max_health.z, 2);
        assert_eq!(table.max_health.attr2, 0);
        assert_eq!(table.max_stamina.attr1, 2);
        assert_eq!(table.max_mana.attr1, 6);
    }
}
