use super::GameData;
use holtburger_common::Guid;
use holtburger_common::properties::ItemType;
use holtburger_common::properties::{PropertyInt, WorldObjectPropertyAccessors};
use holtburger_world::crafting::salvage::{
    SalvageItemInput, SalvagePreviewBag, SalvageSkillProfile, best_trained_tinkering_skill,
    is_salvage_candidate, material_name, predict_salvage_preview,
};

impl GameData {
    pub fn find_salvage_tool_guid(&self) -> Option<Guid> {
        let mut tools = self.inventory.iter().copied().filter(|guid| {
            self.entities.get(guid).is_some_and(|entity| {
                entity
                    .item_type()
                    .is_some_and(|item_type| item_type.intersects(ItemType::TINKERING_TOOL))
            })
        });

        let first = tools.next()?;
        Some(tools.fold(first, |acc, guid| acc.min(guid)))
    }

    pub fn is_salvage_candidate(&self, guid: Guid) -> bool {
        let Some(entity) = self.entities.get(&guid) else {
            return false;
        };

        is_salvage_candidate(
            entity,
            self.trade
                .as_ref()
                .is_some_and(|trade| trade.self_side.items.contains(&guid)),
        )
    }

    pub fn salvage_preview(
        &self,
        item_guids: &[Guid],
    ) -> holtburger_world::crafting::salvage::SalvagePreview {
        let items = item_guids
            .iter()
            .filter_map(|guid| self.entities.get(guid))
            .filter_map(SalvageItemInput::from_entity)
            .collect::<Vec<_>>();

        let salvaging_skill = self
            .skills
            .get(&holtburger_world::stats::SkillType::Salvaging)
            .map(|skill| skill.current)
            .unwrap_or_default();

        let augmentation_bonus_salvage = self
            .player_guid
            .and_then(|guid| self.entities.get(&guid))
            .and_then(|entity| entity.get_int_prop(PropertyInt::AugmentationBonusSalvage))
            .unwrap_or_default()
            .max(0) as u32;

        predict_salvage_preview(
            &items,
            SalvageSkillProfile {
                salvaging_skill,
                best_tinkering_skill: best_trained_tinkering_skill(self.skills.values()),
                augmentation_bonus_salvage,
            },
        )
    }
}

pub fn format_salvage_results(bags: &[SalvagePreviewBag]) -> String {
    if bags.is_empty() {
        return "no salvage".to_string();
    }

    bags.iter()
        .map(|bag| {
            format!(
                "{} {}u @ {:.2} WS",
                material_name(bag.material_type),
                bag.units,
                bag.workmanship
            )
        })
        .collect::<Vec<_>>()
        .join(", ")
}
