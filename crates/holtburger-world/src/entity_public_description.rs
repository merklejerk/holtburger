//! Small public-description record, deliberately isolated from merged appraisal properties.

use holtburger_common::properties::{
    ItemType, ObjectDescriptionFlag, PropertyBool, PropertyInt, PropertyString, PropertyUpdate,
    Usable,
};
use holtburger_protocol::messages::object::messages::description::PublicWeenieDescription;

/// Spawn/update facts consumed by nearby discovery; identification never mutates this record.
#[derive(Debug, Clone)]
pub(crate) struct EntityPublicDescription {
    /// Public display identity used for catalog search and alert matching.
    pub name: Option<String>,
    /// Public classification used for catalog grouping.
    pub item_type: ItemType,
    /// Public use admission for nearby grouping; appraisal never overrides it.
    pub usable: Usable,
    /// Public visibility admission; ordinary updates can supersede the spawn flag.
    pub ui_hidden: bool,
    /// Current publicly disclosed quantity, independently absent from its maximum.
    pub stack_count: Option<u32>,
    /// Public stackability evidence, consumed when projecting quantity.
    pub max_stack_count: Option<u32>,
    /// Public remaining structure/uses displayed in catalog details.
    pub structure: Option<u32>,
    /// Public structure capacity displayed independently of remaining uses.
    pub max_structure: Option<u32>,
    /// Public average workmanship, distinct from appraised integer total/count.
    pub workmanship: Option<f32>,
}

impl EntityPublicDescription {
    /// A complete new public description replaces the previous public-only level.
    pub fn from_description(description: &PublicWeenieDescription) -> Self {
        Self {
            name: description.name.clone(),
            item_type: ItemType::from_bits_retain(description.item_type),
            usable: description
                .usable
                .map(Usable::from_raw)
                .unwrap_or(Usable::UNDEF),
            ui_hidden: description
                .obj_desc_flags
                .contains(ObjectDescriptionFlag::UI_HIDDEN),
            stack_count: description.stack_size,
            max_stack_count: description.max_stack_size,
            structure: description.structure,
            max_structure: description.max_structure,
            workmanship: description.workmanship,
        }
    }

    /// Ordinary property updates are admitted before the general merged store is changed.
    pub fn apply(&mut self, update: &PropertyUpdate) {
        match update {
            PropertyUpdate::Bool(PropertyBool::UiHidden, value) => self.ui_hidden = *value,
            PropertyUpdate::String(PropertyString::Name, value) => self.name = Some(value.clone()),
            PropertyUpdate::Int(PropertyInt::ItemType, value) => {
                self.item_type = ItemType::from_bits_retain(*value as u32);
            }
            PropertyUpdate::Int(PropertyInt::ItemUseable, value) => {
                self.usable = Usable::from_raw(*value as u32);
            }
            PropertyUpdate::Int(property, value) => {
                let target = match property {
                    PropertyInt::StackSize => &mut self.stack_count,
                    PropertyInt::MaxStackSize => &mut self.max_stack_count,
                    PropertyInt::Structure => &mut self.structure,
                    PropertyInt::MaxStructure => &mut self.max_structure,
                    _ => return,
                };
                // Negative wire values do not establish a usable public quantity.
                *target = u32::try_from(*value).ok();
            }
            _ => {}
        }
    }
}
