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
            if next_rank < self.specialized_skill_xp_list.len() {
                Some(self.specialized_skill_xp_list[next_rank])
            } else {
                None
            }
        } else {
            if next_rank < self.trained_skill_xp_list.len() {
                Some(self.trained_skill_xp_list[next_rank])
            } else {
                None
            }
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
