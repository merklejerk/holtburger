use crate::entity::Entity;
use crate::stats::{Skill, SkillType, TrainingLevel};
use holtburger_common::properties::{ItemType, MaterialType, PropertyInt, WorldObjectExt};

/// Retail and ACE cap each resulting salvage bag at one hundred units.
pub const MAX_SALVAGE_BAG_UNITS: u32 = 100;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
/// Character yield inputs, normalized once by the shared profile builder.
pub struct SalvageSkillProfile {
    /// Current salvaging skill, including accepted modifiers.
    pub salvaging_skill: u32,
    /// Highest-current tinkering skill when that chosen skill is trained.
    pub tinkering_skill: u32,
    /// Ciandra augmentation count, used by the salvaging branch only.
    pub augmentation_bonus_salvage: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
/// Lossless predictor evidence shared by candidate publication and reviewed submission.
pub struct SalvageItemInput {
    /// Exact type selects original items versus existing salvage bags; always serialized as u32 bits.
    #[serde(with = "item_type_bits")]
    pub item_type: ItemType,
    /// Concrete output material; category-header materials are rejected by admission.
    pub material_type: MaterialType,
    /// Whole source stack quantity, never a partial destruction amount.
    pub stack_size: u32,
    /// Existing material units; zero for ordinary item yield calculation.
    pub structure: u32,
    /// Raw aggregate integer total from appraisal/property evidence.
    pub item_workmanship: u32,
    /// Positive contributor count paired with the raw workmanship total.
    pub num_items_in_material: u32,
}

// Bitflags' default serde representation depends on the format. Reviews cross both
// MessagePack events and JSON command parsing, so their evidence must use one shape.
mod item_type_bits {
    use super::ItemType;
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<S: Serializer>(value: &ItemType, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_u32(value.bits())
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<ItemType, D::Error> {
        Ok(ItemType::from_bits_retain(u32::deserialize(deserializer)?))
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct SalvagePreview {
    pub item_count: usize,
    pub bags: Vec<SalvagePreviewBag>,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
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
    /// Normalize only proven raw quantities; a public display average is insufficient.
    pub fn from_entity(entity: &Entity) -> Option<Self> {
        use holtburger_common::properties::WorldObjectPropertyAccessors;
        let contributors = match entity.get_int_prop(PropertyInt::NumItemsInMaterial) {
            Some(value) if value > 0 => value as u32,
            Some(_) => return None,
            None => return None,
        };
        let stack_size = match entity.get_int_prop(PropertyInt::StackSize) {
            Some(value) if value > 0 => value as u32,
            Some(_) => return None,
            None if !entity.is_stackable() => 1,
            None => return None,
        };
        let item_type = entity.item_type()?;
        Some(Self {
            item_type,
            material_type: entity.material_type()?,
            stack_size,
            structure: if item_type == ItemType::TINKERING_MATERIAL {
                entity.structure()?
            } else {
                0
            },
            item_workmanship: u32::try_from(entity.get_int_prop(PropertyInt::ItemWorkmanship)?)
                .ok()?,
            num_items_in_material: contributors,
        })
    }

    pub fn average_workmanship(&self) -> f64 {
        f64::from(self.item_workmanship as f32 / self.num_items_in_material.max(1) as f32)
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
            f64::from(self.item_workmanship as f32 / self.num_items_in_material as f32)
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

/// ACE GetMaxSkill uses the first skill in this fixed order to break equal-current ties.
pub fn salvage_tinkering_skill<'a>(skills: impl IntoIterator<Item = &'a Skill>) -> u32 {
    const ORDER: [SkillType; 4] = [
        SkillType::ArmorTinkering,
        SkillType::WeaponTinkering,
        SkillType::ItemTinkering,
        SkillType::MagicItemTinkering,
    ];
    skills
        .into_iter()
        .filter_map(|skill| {
            ORDER
                .iter()
                .position(|kind| *kind == skill.skill_type)
                .map(|order| (skill, order))
        })
        .max_by_key(|(skill, order)| (skill.current, std::cmp::Reverse(*order)))
        .filter(|(skill, _)| {
            matches!(
                skill.training,
                TrainingLevel::Trained | TrainingLevel::Specialized
            )
        })
        .map_or(0, |(skill, _)| skill.current)
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
    // ACE Player_Crafting.CalcNumUnits evaluates its products in single precision before floor.
    1 + ((skill as f32 / 194.0) * workmanship as f32 * (1.0 + 0.25 * num_augs as f32)).floor()
        as u32
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
    let tinkering_amount = calc_num_units(skills.tinkering_skill, workmanship, 0)
        .min(workmanship.round_ties_even() as u32)
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
            let mut scalar = space as f32 / try_amount as f32;
            let mut new_items = (item_num_items as f32 * scalar).ceil() as u32;
            scalar = new_items as f32 / item_num_items as f32;
            let prev_num_items = item_num_items;
            item_num_items = new_items;

            bag.item_workmanship = bag.item_workmanship.saturating_sub(
                ((item_workmanship as f64) * (1.0 - f64::from(scalar))).round_ties_even() as u32,
            );

            if prev_num_items == new_items && new_items > 0 {
                new_items -= 1;
            }

            let item_avg_workmanship = item.average_workmanship();
            item.num_items_in_material = item.num_items_in_material.saturating_sub(new_items);
            item.item_workmanship = (item.num_items_in_material as f32
                * item_avg_workmanship as f32)
                .round_ties_even() as u32;
        }
    }

    bag.num_items_in_material += item_num_items;
    amount
}

/// ACE's Ust template, rather than the broader tinkering-tool item type.
pub const UST_WCID: u32 = 20_646;

/// Stable tool identity bound into a reviewed operation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SalvageTool {
    /// Owned tool instance.
    pub guid: holtburger_common::Guid,
    /// Server incarnation; recycling a GUID cannot preserve approval.
    pub instance: u16,
}

/// One normalized whole-item source, shared by approval and prediction.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SalvageSource {
    /// Carried item identity.
    pub guid: holtburger_common::Guid,
    /// Accepted source incarnation.
    pub instance: u16,
    /// Authoritative raw input, never synthesized from a public average.
    pub input: SalvageItemInput,
}

/// Item admission is independent of tool ownership and the current skill profile.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum SalvageCandidate {
    /// Known rejection, consumed by drag refusal and draft invalidation.
    Ineligible { reason: String },
    /// Public evidence permits queuing, but appraisal is needed before destruction.
    PendingDetails { material: MaterialType },
    /// Complete source facts, consumed by review and dependency comparison.
    Ready { source: SalvageSource },
}

impl SalvageCandidate {
    /// Material-bearing admission without reading raw properties.
    pub fn material(&self) -> Option<MaterialType> {
        match self {
            Self::Ineligible { .. } => None,
            Self::PendingDetails { material } => Some(*material),
            Self::Ready { source } => Some(source.input.material_type),
        }
    }
}

/// Cold player inputs published independently of per-item eligibility.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SalvageContext {
    /// World-owned normalized yield inputs.
    pub skills: SalvageSkillProfile,
}

/// Exact facts reviewed by a caller; core always constructs and compares a fresh value.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SalvageReview {
    /// Originating character.
    pub player: holtburger_common::Guid,
    /// Exact tool incarnation.
    pub tool: SalvageTool,
    /// Ordered whole-item sources; order affects resulting bag composition.
    pub sources: Vec<SalvageSource>,
    /// Skills and augmentation at review time.
    pub skills: SalvageSkillProfile,
}

/// Current batch evaluation; preview readiness is distinct from candidate admission.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub enum SalvageEvaluation {
    /// A coherent estimate and its execution precondition.
    Ready {
        review: SalvageReview,
        bags: Vec<SalvagePreviewBag>,
    },
    /// Candidate identities needing Examine; no sources were silently omitted.
    PendingDetails {
        tool: SalvageTool,
        items: Vec<holtburger_common::Guid>,
    },
    /// The proposed batch cannot be accepted.
    Rejected { reason: String },
}

/// Retail IsValidMaterialType and ACE's nonzero MaterialSalvage mappings agree.
pub fn is_salvage_material(material: MaterialType) -> bool {
    !matches!(
        material,
        MaterialType::Unknown
            | MaterialType::Cloth
            | MaterialType::Gem
            | MaterialType::Metal
            | MaterialType::Stone
            | MaterialType::Wood
    )
}

/// Classify authored tool semantics without embedding a frontend window action.
pub fn is_salvage_tool(entity: &Entity) -> bool {
    entity.wcid == Some(UST_WCID)
}

/// Recursive ownership comes from the existing context, not container GUID heuristics.
pub fn find_salvage_tool(
    context: &impl crate::context::WorldContext,
    preferred: Option<holtburger_common::Guid>,
) -> Option<SalvageTool> {
    use crate::context::WorldContextExt;
    let read = |guid| {
        let entity = context.get_visible_entity(guid)?;
        (context.is_owned_by_player(guid) && is_salvage_tool(entity)).then_some(SalvageTool {
            guid,
            instance: entity.instance_sequence(),
        })
    };
    if let Some(tool) = preferred.and_then(read) {
        return Some(tool);
    }
    context
        .iter_inventory()
        .filter_map(read)
        .min_by_key(|tool| tool.guid)
}

impl SalvageSkillProfile {
    /// ACE chooses the highest current tinkering skill before checking its training.
    pub fn from_skills<'a>(skills: impl IntoIterator<Item = &'a Skill>, augmentation: u32) -> Self {
        let skills: Vec<_> = skills.into_iter().collect();
        Self {
            salvaging_skill: skills
                .iter()
                .find(|skill| skill.skill_type == SkillType::Salvaging)
                .map_or(0, |skill| skill.current),
            tinkering_skill: salvage_tinkering_skill(skills.iter().copied()),
            augmentation_bonus_salvage: augmentation,
        }
    }
}

impl crate::WorldState {
    /// Normalized yield profile, also used by fresh submission evaluation.
    pub fn salvage_context(&self) -> SalvageContext {
        use holtburger_common::properties::WorldObjectPropertyAccessors;
        let augmentation = self
            .get_visible_entity(self.player.guid)
            .and_then(|entity| entity.get_int_prop(PropertyInt::AugmentationBonusSalvage))
            .unwrap_or(0)
            .max(0) as u32;
        SalvageContext {
            skills: SalvageSkillProfile::from_skills(self.player.skills.values(), augmentation),
        }
    }

    /// Shared admission over accepted storage, trade state, and disclosed item facts.
    pub fn salvage_candidate(&self, guid: holtburger_common::Guid) -> SalvageCandidate {
        use crate::context::{WorldContext, WorldContextExt};
        use crate::state::storage::RosterCoverage;
        let reject = |reason: &str| SalvageCandidate::Ineligible {
            reason: reason.into(),
        };
        let Some(entity) = self.get_visible_entity(guid) else {
            return reject("Item details are unavailable.");
        };
        if self.is_equipped_item(guid) {
            return reject("Unequip the item before salvaging it.");
        }
        if !self.is_in_player_inventory(guid) {
            return reject("You are not carrying that item.");
        }
        if entity.is_retained() {
            return reject("Retained items cannot be salvaged.");
        }
        if self
            .trade
            .as_ref()
            .is_some_and(|trade| trade.self_side.items.contains(&guid))
        {
            return reject("Remove the item from trade before salvaging it.");
        }
        let Some(kind) = entity.item_type() else {
            return reject("Item type is unavailable.");
        };
        if kind.contains(ItemType::CONTAINER) {
            if self.storage_coverage(guid) != Some(RosterCoverage::Announced) {
                return reject("Container contents are not yet known.");
            }
            if !self.is_container_empty(guid) {
                return reject("Empty the container before salvaging it.");
            }
        }
        let Some(material) = entity
            .material_type()
            .filter(|material| is_salvage_material(*material))
        else {
            return reject("This item has no salvageable material.");
        };
        if kind == ItemType::TINKERING_MATERIAL {
            match entity.structure() {
                Some(units) if units >= MAX_SALVAGE_BAG_UNITS => {
                    return reject("Full salvage bags cannot be combined.");
                }
                Some(0) => return reject("This salvage bag is empty."),
                None => return SalvageCandidate::PendingDetails { material },
                _ => {}
            }
        }
        if entity.display_workmanship().is_none() {
            return reject("Item workmanship is unavailable.");
        }
        let Some(input) = SalvageItemInput::from_entity(entity) else {
            return SalvageCandidate::PendingDetails { material };
        };
        SalvageCandidate::Ready {
            source: SalvageSource {
                guid,
                instance: entity.instance_sequence(),
                input,
            },
        }
    }

    /// Evaluate all inputs atomically locally; the server still owns actual processing.
    pub fn evaluate_salvage(
        &self,
        tool: SalvageTool,
        items: &[holtburger_common::Guid],
    ) -> SalvageEvaluation {
        let rejected = |reason: &str| SalvageEvaluation::Rejected {
            reason: reason.into(),
        };
        if find_salvage_tool(self, Some(tool.guid)) != Some(tool) {
            return rejected("The salvage tool is no longer available.");
        }
        let mut seen = std::collections::BTreeSet::new();
        let mut sources = Vec::with_capacity(items.len());
        let mut pending = Vec::new();
        for guid in items {
            if !seen.insert(*guid) {
                return rejected("The salvage batch contains a duplicate item.");
            }
            if *guid == tool.guid {
                return rejected("The Ust cannot salvage itself.");
            }
            match self.salvage_candidate(*guid) {
                SalvageCandidate::Ineligible { reason } => {
                    return SalvageEvaluation::Rejected { reason };
                }
                SalvageCandidate::PendingDetails { .. } => pending.push(*guid),
                SalvageCandidate::Ready { source } => sources.push(source),
            }
        }
        if !pending.is_empty() {
            return SalvageEvaluation::PendingDetails {
                tool,
                items: pending,
            };
        }
        let skills = self.salvage_context().skills;
        let inputs: Vec<_> = sources.iter().map(|source| source.input.clone()).collect();
        SalvageEvaluation::Ready {
            review: SalvageReview {
                player: self.player.guid,
                tool,
                sources,
                skills,
            },
            bags: predict_salvage_preview(&inputs, skills).bags,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::context::WorldContext;
    use crate::state::storage::StorageSlot;
    use holtburger_common::{
        Guid,
        properties::{PropertyBool, WorldObjectPropertyAccessors, WorldObjectPropertyAccessorsMut},
    };

    fn carried_world() -> crate::WorldState {
        let mut world = crate::WorldState::synthetic();
        world.seed_local_player_entity(Guid(1), "Player", Default::default());
        let mut tool = Entity::new(Guid(2), "Ust".into(), Default::default());
        tool.wcid = Some(UST_WCID);
        world.add_entity(tool);
        world
            .storage
            .place(Guid(2), Guid(1), StorageSlot::Item { index: 0 });
        let mut item = Entity::new(Guid(3), "Steel sword".into(), Default::default());
        item.set_int_prop(PropertyInt::ItemType, ItemType::MELEE_WEAPON.bits() as i32);
        item.set_int_prop(PropertyInt::MaterialType, MaterialType::Steel as i32);
        item.set_int_prop(PropertyInt::ItemWorkmanship, 58);
        item.set_int_prop(PropertyInt::NumItemsInMaterial, 8);
        world.add_entity(item);
        world
            .storage
            .place(Guid(3), Guid(1), StorageSlot::Item { index: 1 });
        world
    }

    #[test]
    fn material_predicate_excludes_category_headers_and_unknown() {
        let valid: Vec<_> = (0..=MaterialType::Teak as u32)
            .filter_map(MaterialType::from_repr)
            .filter(|material| is_salvage_material(*material))
            .collect();
        // ACE MaterialSalvage and retail IsValidMaterialType contain the same concrete materials.
        assert_eq!(valid.len(), MaterialType::Teak as usize - 5);
        for header in [
            MaterialType::Unknown,
            MaterialType::Cloth,
            MaterialType::Gem,
            MaterialType::Metal,
            MaterialType::Stone,
            MaterialType::Wood,
        ] {
            assert!(!is_salvage_material(header));
        }
    }

    #[test]
    fn discovery_uses_exact_template_and_recursive_ownership() {
        let mut world = carried_world();
        let tool = find_salvage_tool(&world, None).unwrap();
        assert_eq!(tool.guid, Guid(2));
        world
            .storage
            .place(Guid(2), Guid(3), StorageSlot::Item { index: 0 });
        assert_eq!(find_salvage_tool(&world, None), Some(tool));
        world.entities.get_mut(Guid(2)).unwrap().wcid = Some(UST_WCID - 1);
        assert_eq!(find_salvage_tool(&world, None), None);
    }

    #[test]
    fn raw_sources_reject_retained_equipped_and_unowned_items() {
        let mut world = carried_world();
        assert!(matches!(
            world.salvage_candidate(Guid(3)),
            SalvageCandidate::Ready { .. }
        ));
        world
            .entities
            .get_mut(Guid(3))
            .unwrap()
            .set_bool_prop(PropertyBool::Retained, true);
        assert!(matches!(
            world.salvage_candidate(Guid(3)),
            SalvageCandidate::Ineligible { .. }
        ));
        world
            .entities
            .get_mut(Guid(3))
            .unwrap()
            .set_bool_prop(PropertyBool::Retained, false);
        world.storage.equip(Guid(3), Guid(1), None);
        assert!(matches!(
            world.salvage_candidate(Guid(3)),
            SalvageCandidate::Ineligible { .. }
        ));
        world.storage.withdraw(Guid(3));
        assert!(matches!(
            world.salvage_candidate(Guid(3)),
            SalvageCandidate::Ineligible { .. }
        ));
    }

    #[test]
    fn pending_public_average_never_becomes_a_raw_total() {
        use crate::entity_public_description::EntityPublicDescription;
        use holtburger_protocol::messages::object::messages::description::PublicWeenieDescription;
        let mut world = carried_world();
        let item = world.entities.get_mut(Guid(3)).unwrap();
        item.properties.ints.0.remove(&PropertyInt::ItemWorkmanship);
        item.properties
            .ints
            .0
            .remove(&PropertyInt::NumItemsInMaterial);
        item.public_description = Some(EntityPublicDescription::from_description(
            &PublicWeenieDescription {
                workmanship: Some(7.25),
                ..Default::default()
            },
        ));
        assert_eq!(item.display_workmanship(), Some(7.25));
        let tool = find_salvage_tool(&world, None).unwrap();
        assert!(
            matches!(world.evaluate_salvage(tool, &[Guid(3)]), SalvageEvaluation::PendingDetails { items, .. } if items == [Guid(3)])
        );
    }

    #[test]
    fn public_hydration_preserves_appraised_total_and_fractional_display_average() {
        use crate::hydration::WorldObjectPropertiesHydrationExt;
        use holtburger_protocol::messages::object::messages::description::PublicWeenieDescription;
        let mut world = carried_world();
        let item = world.entities.get_mut(Guid(3)).unwrap();
        item.properties.hydrate_from_pwd(&PublicWeenieDescription {
            workmanship: Some(7.25),
            ..Default::default()
        });
        assert_eq!(item.get_int_prop(PropertyInt::ItemWorkmanship), Some(58));
        assert_eq!(item.display_workmanship(), Some(7.25));
    }

    #[test]
    fn successful_appraisal_replaces_older_raw_total_and_contributor_defaults() {
        use holtburger_protocol::messages::object::events::IdentifyObjectResponseEventData;
        let mut world = carried_world();
        let item = world.entities.get_mut(Guid(3)).unwrap();
        let mut appraisal = IdentifyObjectResponseEventData {
            success: true,
            ..Default::default()
        };
        appraisal
            .properties
            .set_int_prop(PropertyInt::ItemWorkmanship, 7);
        assert!(item.apply_identify_response(&appraisal));
        let input = SalvageItemInput::from_entity(item).unwrap();
        assert_eq!(
            (input.item_workmanship, input.num_items_in_material),
            (7, 1)
        );
        assert!(
            item.apply_identify_response(&IdentifyObjectResponseEventData {
                success: true,
                ..Default::default()
            })
        );
        assert!(SalvageItemInput::from_entity(item).is_none());
    }

    #[test]
    fn partial_material_bags_are_candidates_but_full_and_empty_bags_are_not() {
        let mut world = carried_world();
        let item = world.entities.get_mut(Guid(3)).unwrap();
        item.set_int_prop(
            PropertyInt::ItemType,
            ItemType::TINKERING_MATERIAL.bits() as i32,
        );
        item.set_int_prop(PropertyInt::Structure, (MAX_SALVAGE_BAG_UNITS / 2) as i32);
        assert!(matches!(
            world.salvage_candidate(Guid(3)),
            SalvageCandidate::Ready { .. }
        ));
        world
            .entities
            .get_mut(Guid(3))
            .unwrap()
            .set_int_prop(PropertyInt::Structure, MAX_SALVAGE_BAG_UNITS as i32);
        assert!(matches!(
            world.salvage_candidate(Guid(3)),
            SalvageCandidate::Ineligible { .. }
        ));
        world
            .entities
            .get_mut(Guid(3))
            .unwrap()
            .set_int_prop(PropertyInt::Structure, 0);
        assert!(matches!(
            world.salvage_candidate(Guid(3)),
            SalvageCandidate::Ineligible { .. }
        ));
    }

    #[test]
    fn offered_items_are_ineligible_without_losing_their_owned_identity() {
        use crate::state::{TradeSide, TradeState};
        let mut world = carried_world();
        world.trade = Some(TradeState {
            revision: 1,
            partner_guid: Guid(9),
            initiator_guid: Guid(1),
            trade_stamp: 0.0,
            self_side: TradeSide {
                guid: Guid(1),
                accepted: false,
                items: vec![Guid(3)],
            },
            partner_side: TradeSide {
                guid: Guid(9),
                accepted: false,
                items: vec![],
            },
        });
        assert!(matches!(
            world.salvage_candidate(Guid(3)),
            SalvageCandidate::Ineligible { .. }
        ));
        world.trade = None;
        assert!(matches!(
            world.salvage_candidate(Guid(3)),
            SalvageCandidate::Ready { .. }
        ));
    }

    #[test]
    fn duplicate_batch_is_rejected_and_review_changes_with_quantity() {
        let mut world = carried_world();
        let tool = find_salvage_tool(&world, None).unwrap();
        assert!(matches!(
            world.evaluate_salvage(tool, &[Guid(3), Guid(3)]),
            SalvageEvaluation::Rejected { .. }
        ));
        let before = world.evaluate_salvage(tool, &[Guid(3)]);
        world
            .entities
            .get_mut(Guid(3))
            .unwrap()
            .set_int_prop(PropertyInt::StackSize, 2);
        assert_ne!(before, world.evaluate_salvage(tool, &[Guid(3)]));
        assert_eq!(world.iter_inventory().count(), 2);
    }

    #[test]
    fn yield_uses_ace_single_precision_before_floor_and_even_rounding() {
        // At this fractional boundary a double-precision implementation incorrectly yields two.
        assert_eq!(calc_num_units(24, 97.0 / 12.0, 0), 1);
        let input = SalvageItemInput {
            item_type: ItemType::MELEE_WEAPON,
            material_type: MaterialType::Steel,
            stack_size: 1,
            structure: 0,
            item_workmanship: 5,
            num_items_in_material: 2,
        };
        assert_eq!(get_structure(&input, skill_profile(0, 500)), 2);
    }

    fn skill_profile(salvaging_skill: u32, tinkering_skill: u32) -> SalvageSkillProfile {
        SalvageSkillProfile {
            salvaging_skill,
            tinkering_skill,
            augmentation_bonus_salvage: 0,
        }
    }

    #[test]
    fn highest_untrained_tinkering_skill_does_not_fall_back_to_lower_trained_skill() {
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
                breakdown: Default::default(),
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
                breakdown: Default::default(),
            },
        ];

        assert_eq!(salvage_tinkering_skill(skills.iter()), 0);
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
