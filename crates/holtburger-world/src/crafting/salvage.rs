use crate::entity::Entity;
use crate::stats::{Skill, SkillType, TrainingLevel};
use holtburger_common::properties::{ItemType, MaterialType, PropertyInt, WorldObjectExt};

const MAX_SALVAGE_BAG_UNITS: u32 = 100;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SalvageSkillProfile {
    pub salvaging_skill: u32,
    pub best_tinkering_skill: u32,
    pub augmentation_bonus_salvage: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SalvageItemInput {
    pub item_type: ItemType,
    pub material_type: MaterialType,
    pub stack_size: u32,
    pub structure: u32,
    pub item_workmanship: u32,
    pub num_items_in_material: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SalvagePreview {
    pub item_count: usize,
    pub bags: Vec<SalvagePreviewBag>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SalvagePreviewBag {
    pub material_type: MaterialType,
    pub units: u32,
    pub workmanship: f64,
}

#[derive(Debug, Clone)]
struct WorkingBag {
    material_type: MaterialType,
    units: u32,
    item_workmanship: u32,
    num_items_in_material: u32,
}

impl SalvageItemInput {
    pub fn from_world_object<T: WorldObjectExt>(entity: &T) -> Option<Self> {
        Some(Self {
            item_type: entity.item_type()?,
            material_type: entity.material_type()?,
            stack_size: entity.stack_size().max(1),
            structure: entity.structure().unwrap_or_default(),
            item_workmanship: entity.get_int_prop(PropertyInt::ItemWorkmanship)?.max(0) as u32,
            num_items_in_material: entity
                .get_int_prop(PropertyInt::NumItemsInMaterial)
                .unwrap_or(1)
                .max(1) as u32,
        })
    }

    pub fn from_entity(entity: &Entity) -> Option<Self> {
        Self::from_world_object(entity)
    }

    pub fn average_workmanship(&self) -> f64 {
        self.item_workmanship as f64 / self.num_items_in_material.max(1) as f64
    }
}

impl WorkingBag {
    fn new(material_type: MaterialType) -> Self {
        Self {
            material_type,
            units: 0,
            item_workmanship: 0,
            num_items_in_material: 0,
        }
    }

    fn has_space(&self) -> bool {
        self.units < MAX_SALVAGE_BAG_UNITS
    }

    fn workmanship(&self) -> f64 {
        if self.num_items_in_material == 0 {
            0.0
        } else {
            self.item_workmanship as f64 / self.num_items_in_material as f64
        }
    }

    fn to_preview(&self) -> SalvagePreviewBag {
        SalvagePreviewBag {
            material_type: self.material_type,
            units: self.units,
            workmanship: self.workmanship(),
        }
    }
}

pub fn best_trained_tinkering_skill<'a>(skills: impl IntoIterator<Item = &'a Skill>) -> u32 {
    skills
        .into_iter()
        .filter(|skill| {
            matches!(
                skill.skill_type,
                SkillType::ArmorTinkering
                    | SkillType::WeaponTinkering
                    | SkillType::ItemTinkering
                    | SkillType::MagicItemTinkering
            ) && matches!(
                skill.training,
                TrainingLevel::Trained | TrainingLevel::Specialized
            )
        })
        .map(|skill| skill.current)
        .max()
        .unwrap_or_default()
}

pub fn predict_salvage_preview(
    items: &[SalvageItemInput],
    skills: SalvageSkillProfile,
) -> SalvagePreview {
    let mut bags = Vec::new();

    for item in items {
        let mut item = item.clone();
        let mut remaining = get_structure(&item, skills);

        while remaining > 0 {
            let bag = get_or_create_bag(item.material_type, &mut bags);
            let added = try_add_salvage(bag, &mut item, remaining);
            remaining -= added;
        }
    }

    SalvagePreview {
        item_count: items.len(),
        bags: bags.into_iter().map(|bag| bag.to_preview()).collect(),
    }
}

pub fn get_material_name(material_type: MaterialType) -> String {
    material_type.to_string()
}

fn calc_num_units(skill: u32, workmanship: f64, num_augs: u32) -> u32 {
    1 + ((skill as f64 / 194.0) * workmanship * (1.0 + 0.25 * num_augs as f64)).floor() as u32
}

fn get_structure(item: &SalvageItemInput, skills: SalvageSkillProfile) -> u32 {
    if item.item_type == ItemType::TINKERING_MATERIAL {
        return item.structure;
    }

    let workmanship = item.average_workmanship();
    let salvage_amount = calc_num_units(
        skills.salvaging_skill,
        workmanship,
        skills.augmentation_bonus_salvage,
    ) * item.stack_size.max(1);
    let tinkering_amount = calc_num_units(skills.best_tinkering_skill, workmanship, 0)
        .min(workmanship.round().max(1.0) as u32)
        * item.stack_size.max(1);

    salvage_amount.max(tinkering_amount)
}

fn get_or_create_bag(material_type: MaterialType, bags: &mut Vec<WorkingBag>) -> &mut WorkingBag {
    if let Some(index) = bags
        .iter()
        .position(|bag| bag.material_type == material_type && bag.has_space())
    {
        return &mut bags[index];
    }

    bags.push(WorkingBag::new(material_type));
    bags.last_mut().expect("bag was just pushed")
}

fn try_add_salvage(bag: &mut WorkingBag, item: &mut SalvageItemInput, try_amount: u32) -> u32 {
    let space = MAX_SALVAGE_BAG_UNITS.saturating_sub(bag.units);
    let amount = try_amount.min(space);

    bag.units += amount;

    let mut item_num_items = item.stack_size.max(1);
    let item_workmanship = item.item_workmanship;
    bag.item_workmanship += item_workmanship.saturating_mul(item_num_items);

    if item.item_type == ItemType::TINKERING_MATERIAL {
        item_num_items = item.num_items_in_material.max(1);

        if try_amount > space && space > 0 {
            let mut scalar = space as f64 / try_amount as f64;
            let mut new_items = (item_num_items as f64 * scalar).ceil() as u32;
            scalar = new_items as f64 / item_num_items as f64;
            let prev_num_items = item_num_items;
            item_num_items = new_items;

            bag.item_workmanship = bag
                .item_workmanship
                .saturating_sub(((item_workmanship as f64) * (1.0 - scalar)).round() as u32);

            if prev_num_items == new_items && new_items > 0 {
                new_items -= 1;
            }

            let item_avg_workmanship = item.average_workmanship();
            item.num_items_in_material = item.num_items_in_material.saturating_sub(new_items);
            item.item_workmanship =
                (item.num_items_in_material as f64 * item_avg_workmanship).round() as u32;
        }
    }

    bag.num_items_in_material += item_num_items;
    amount
}

#[cfg(test)]
mod tests {
    use super::*;

    fn skill_profile(salvaging_skill: u32, best_tinkering_skill: u32) -> SalvageSkillProfile {
        SalvageSkillProfile {
            salvaging_skill,
            best_tinkering_skill,
            augmentation_bonus_salvage: 0,
        }
    }

    #[test]
    fn best_trained_tinkering_skill_ignores_untrained_entries() {
        let skills = [
            Skill {
                skill_type: SkillType::ItemTinkering,
                ranks: 0,
                init: 0,
                spent_xp: 0,
                next_rank_xp: None,
                base: 300,
                current: 300,
                training: TrainingLevel::Untrained,
                trained_cost: 0,
                specialized_cost: 0,
            },
            Skill {
                skill_type: SkillType::WeaponTinkering,
                ranks: 0,
                init: 0,
                spent_xp: 0,
                next_rank_xp: None,
                base: 250,
                current: 250,
                training: TrainingLevel::Trained,
                trained_cost: 0,
                specialized_cost: 0,
            },
        ];

        assert_eq!(best_trained_tinkering_skill(skills.iter()), 250);
    }

    #[test]
    fn preview_splits_large_salvage_output_into_multiple_bags() {
        let items = vec![SalvageItemInput {
            item_type: ItemType::MISSILE_WEAPON,
            material_type: MaterialType::Steel,
            stack_size: 6,
            structure: 0,
            item_workmanship: 10,
            num_items_in_material: 1,
        }];

        let preview = predict_salvage_preview(&items, skill_profile(387, 50));

        assert_eq!(preview.item_count, 1);
        assert_eq!(preview.bags.len(), 2);
        assert_eq!(preview.bags[0].material_type, MaterialType::Steel);
        assert_eq!(preview.bags[0].units, 100);
        assert!((preview.bags[0].workmanship - 10.0).abs() < f64::EPSILON);
        assert_eq!(preview.bags[1].units, 20);
        assert!((preview.bags[1].workmanship - 10.0).abs() < f64::EPSILON);
    }

    #[test]
    fn preview_matches_ace_overage_behavior_when_combining_salvage_bags() {
        let items = vec![
            SalvageItemInput {
                item_type: ItemType::MISSILE_WEAPON,
                material_type: MaterialType::Steel,
                stack_size: 3,
                structure: 0,
                item_workmanship: 10,
                num_items_in_material: 1,
            },
            SalvageItemInput {
                item_type: ItemType::TINKERING_MATERIAL,
                material_type: MaterialType::Steel,
                stack_size: 1,
                structure: 80,
                item_workmanship: 40,
                num_items_in_material: 8,
            },
        ];

        let preview = predict_salvage_preview(&items, skill_profile(387, 0));

        assert_eq!(preview.item_count, 2);
        assert_eq!(preview.bags.len(), 2);
        assert_eq!(preview.bags[0].units, 100);
        assert!((preview.bags[0].workmanship - (50.0 / 7.0)).abs() < 0.001);
        assert_eq!(preview.bags[1].units, 40);
        assert!((preview.bags[1].workmanship - 5.0).abs() < 0.001);
    }
}
