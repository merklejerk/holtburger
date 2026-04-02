use crate::{EOR_PORTAL_NAMESPACE, ResourceKey, StaticResourceKey};
use binrw::BinRead;

/// Experience Tables from client_portal.dat (file 0x0E000018).
#[derive(BinRead, Debug, Clone)]
#[br(little)]
pub struct XpTable {
    pub id: u32,
    pub attribute_count: i32,
    pub vital_count: i32,
    pub trained_skill_count: i32,
    pub specialized_skill_count: i32,
    pub level_count: u32,

    #[br(count = attribute_count + 1)]
    pub attribute_xp_list: Vec<u32>,

    #[br(count = vital_count + 1)]
    pub vital_xp_list: Vec<u32>,

    #[br(count = trained_skill_count + 1)]
    pub trained_skill_xp_list: Vec<u32>,

    #[br(count = specialized_skill_count + 1)]
    pub specialized_skill_xp_list: Vec<u32>,

    #[br(count = level_count + 1)]
    pub character_level_xp_list: Vec<u64>,

    #[br(count = level_count + 1)]
    pub character_level_skill_credit_list: Vec<u32>,
}

impl XpTable {
    pub const FILE_ID: u32 = 0x0E000018;

    pub fn get_next_attribute_rank_xp(&self, ranks: u32) -> Option<u32> {
        let next_rank = (ranks + 1) as usize;
        if next_rank < self.attribute_xp_list.len() {
            Some(self.attribute_xp_list[next_rank])
        } else {
            None
        }
    }

    pub fn get_next_vital_rank_xp(&self, ranks: u32) -> Option<u32> {
        let next_rank = (ranks + 1) as usize;
        if next_rank < self.vital_xp_list.len() {
            Some(self.vital_xp_list[next_rank])
        } else {
            None
        }
    }

    pub fn get_next_skill_rank_xp(&self, ranks: u32, is_specialized: bool) -> Option<u32> {
        let next_rank = (ranks + 1) as usize;
        if is_specialized {
            self.specialized_skill_xp_list.get(next_rank).copied()
        } else {
            self.trained_skill_xp_list.get(next_rank).copied()
        }
    }

    pub fn calc_attribute_rank(&self, xp: u32) -> u32 {
        for (i, &required_xp) in self.attribute_xp_list.iter().enumerate().rev() {
            if xp >= required_xp {
                return i as u32;
            }
        }
        0
    }

    pub fn calc_vital_rank(&self, xp: u32) -> u32 {
        for (i, &required_xp) in self.vital_xp_list.iter().enumerate().rev() {
            if xp >= required_xp {
                return i as u32;
            }
        }
        0
    }

    pub fn calc_skill_rank(&self, xp: u32, is_specialized: bool) -> u32 {
        let list = if is_specialized {
            &self.specialized_skill_xp_list
        } else {
            &self.trained_skill_xp_list
        };
        for (i, &required_xp) in list.iter().enumerate().rev() {
            if xp >= required_xp {
                return i as u32;
            }
        }
        0
    }
}

impl Default for XpTable {
    fn default() -> Self {
        Self {
            id: Self::FILE_ID,
            attribute_count: 0,
            vital_count: 0,
            trained_skill_count: 0,
            specialized_skill_count: 0,
            level_count: 0,
            attribute_xp_list: vec![0],
            vital_xp_list: vec![0],
            trained_skill_xp_list: vec![0],
            specialized_skill_xp_list: vec![0],
            character_level_xp_list: vec![0],
            character_level_skill_credit_list: vec![0],
        }
    }
}

impl StaticResourceKey for XpTable {
    const RESOURCE_KEY: ResourceKey<'static> =
        ResourceKey::new(EOR_PORTAL_NAMESPACE, Self::FILE_ID);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn test_parse_xp_table() {
        // Minimal XP table hex:
        // id (4), attr_count(4), vital_count(4), trained_count(4), spec_count(4), level_count(4)
        // followed by vectors (counts + 1)
        let mut data = Vec::new();
        data.extend_from_slice(&0x0E000018u32.to_le_bytes()); // id
        data.extend_from_slice(&1i32.to_le_bytes()); // attribute_count
        data.extend_from_slice(&1i32.to_le_bytes()); // vital_count
        data.extend_from_slice(&1i32.to_le_bytes()); // trained_skill_count
        data.extend_from_slice(&1i32.to_le_bytes()); // specialized_skill_count
        data.extend_from_slice(&1u32.to_le_bytes()); // level_count

        // attribute_xp_list (count+1 = 2)
        data.extend_from_slice(&0u32.to_le_bytes());
        data.extend_from_slice(&1000u32.to_le_bytes());

        // vital_xp_list (count+1 = 2)
        data.extend_from_slice(&0u32.to_le_bytes());
        data.extend_from_slice(&500u32.to_le_bytes());

        // trained_skill_xp_list (count+1 = 2)
        data.extend_from_slice(&0u32.to_le_bytes());
        data.extend_from_slice(&2000u32.to_le_bytes());

        // specialized_skill_xp_list (count+1 = 2)
        data.extend_from_slice(&0u32.to_le_bytes());
        data.extend_from_slice(&4000u32.to_le_bytes());

        // character_level_xp_list (count+1 = 2)
        data.extend_from_slice(&0u64.to_le_bytes());
        data.extend_from_slice(&10000u64.to_le_bytes());

        // character_level_skill_credit_list (count+1 = 2)
        data.extend_from_slice(&10u32.to_le_bytes());
        data.extend_from_slice(&20u32.to_le_bytes());

        let mut cursor = Cursor::new(data);
        let table = XpTable::read(&mut cursor).unwrap();

        assert_eq!(table.id, XpTable::FILE_ID);
        assert_eq!(table.attribute_xp_list[1], 1000);
        assert_eq!(table.get_next_attribute_rank_xp(0), Some(1000));
        assert_eq!(table.get_next_attribute_rank_xp(1), None);

        assert_eq!(table.calc_skill_rank(1500, false), 0);
        assert_eq!(table.calc_skill_rank(2000, false), 1);
        assert_eq!(table.calc_skill_rank(3999, true), 0);
        assert_eq!(table.calc_skill_rank(4000, true), 1);
    }
}
