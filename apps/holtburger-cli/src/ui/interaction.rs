use holtburger_common::Guid;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Interaction {
    Moving { item_guid: Guid },
    Healing { item_guid: Guid },
    Targeting { target_guid: Guid },
    Combining { item_guid: Guid },
    Splitting { item_guid: Guid, max_amount: i32 },
}

impl Interaction {}
