//! Lossless source-neutral appearance facts owned by a live entity.

use holtburger_common::properties::{EquipMask, ItemType};
use holtburger_common::{Guid, ParentLocation, Placement};
use holtburger_protocol::messages::object::types::ModelData;
use serde::{Deserialize, Serialize};

/// Raw catalog facts that decide whether and how one wielded item is presented.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WieldedItemSlotFacts {
    /// `PropertyInt::ValidLocations`; ACE expects one exact held slot for child items.
    pub valid_locations: Option<i32>,
    /// `PropertyInt::ItemType`; distinct from `WeenieType`.
    pub item_type: Option<i32>,
    /// `PropertyInt::DefaultCombatStyle`; consulted only for missile weapons.
    pub default_combat_style: Option<i32>,
}

/// The one presentation mechanism selected for a wielded item.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WieldedItemClassification {
    /// Paint the item into its wearer's setup through the CLO pipeline.
    Painted(PaintedWieldedItem),
    /// Render the item as its own entity at this parent location and placement pose.
    Held(HeldItemPlacement),
}

/// ACE's two ordered buckets for items painted into their wearer's setup.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PaintedWieldedItem {
    /// Painted first and ordered by `ClothingPriority`.
    Clothing,
    /// Painted last and ordered by visual coverage.
    Armor,
}

/// Parent-side attach point plus child-side authored placement pose.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HeldItemPlacement {
    /// Which holding location on the wearer carries the item.
    pub parent_location: ParentLocation,
    /// Which placement-frame key poses the held item's own setup.
    pub placement: Placement,
}

impl HeldItemPlacement {
    /// Bind the classified slot facts to one live wearer identity.
    pub const fn attach_to(self, parent: Guid) -> crate::attachment::PhysicsAttachment {
        crate::attachment::PhysicsAttachment {
            parent,
            location: self.parent_location,
            placement: self.placement,
        }
    }
}

/// A required ACE classification fact was absent from a held-item template.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum WieldedItemClassificationError {
    /// Shield placement cannot be selected without distinguishing armor from non-armor.
    #[error("shield item is missing PropertyInt::ItemType")]
    MissingShieldItemType,
    /// Missile-weapon handedness cannot be selected without its authored combat style.
    #[error("missile weapon is missing PropertyInt::DefaultCombatStyle")]
    MissingMissileCombatStyle,
}

/// `EquipMask::Clothing | Armor | Cloak`, the slots whose contents paint the wearer's model
/// (`Creature_Networking.cs:153`). Any other slot never contributes ObjDesc paint however its
/// clothing table is authored.
const EQUIP_MASK_PAINTABLE: EquipMask = EquipMask::from_bits_retain(0x8800_7fff);
/// `EquipMask` bits ACE treats as armor (`0x7e00 | FootWear`) or extremity
/// (`HandWear | HeadWear | FootWear`) when partitioning worn items (`Creature_Networking.cs:110`).
const EQUIP_MASK_ARMOR_OR_EXTREMITY: EquipMask = EquipMask::from_bits_retain(0x0000_7f21);
/// `CombatStyle::Bow`/`Crossbow` (`ACE.Entity/Enum/CombatStyle.cs:16`), the missile styles ACE
/// carries in the left hand; every other style rides the right.
const COMBAT_STYLE_BOW: i32 = 0x10;
const COMBAT_STYLE_CROSSBOW: i32 = 0x20;

/// Select the only presentation mechanism ACE permits for one wielded item.
///
/// Painted ordering follows `Creature_Networking.cs:110,122,153`. Held placement ports
/// `Creature_Equipment.GetPlacementLocation` (`Creature_Equipment.cs:515-556`) branch for branch.
/// A slot in neither family, including `MissileAmmo`, has no presentation classification.
pub fn classify_wielded_item(
    facts: WieldedItemSlotFacts,
) -> Result<Option<WieldedItemClassification>, WieldedItemClassificationError> {
    let Some(raw_locations) = facts.valid_locations else {
        return Ok(None);
    };
    let locations = EquipMask::from_bits_retain(raw_locations as u32);

    let held = if [
        // ACE `EquipMask::Held` is named `CASTER` in Holtburger's existing protocol vocabulary.
        EquipMask::MELEE_WEAPON,
        EquipMask::CASTER,
        EquipMask::TWO_HANDED,
    ]
    .contains(&locations)
    {
        Some(HeldItemPlacement {
            parent_location: ParentLocation::RightHand,
            placement: Placement::RightHandCombat,
        })
    } else if locations == EquipMask::SHIELD {
        let item_type = facts
            .item_type
            .ok_or(WieldedItemClassificationError::MissingShieldItemType)?;
        Some(if item_type == ItemType::ARMOR.bits() as i32 {
            HeldItemPlacement {
                parent_location: ParentLocation::Shield,
                placement: Placement::Shield,
            }
        } else {
            HeldItemPlacement {
                parent_location: ParentLocation::LeftWeapon,
                placement: Placement::RightHandNonCombat,
            }
        })
    } else if locations == EquipMask::MISSILE_WEAPON {
        let combat_style = facts
            .default_combat_style
            .ok_or(WieldedItemClassificationError::MissingMissileCombatStyle)?;
        Some(
            if matches!(combat_style, COMBAT_STYLE_BOW | COMBAT_STYLE_CROSSBOW) {
                HeldItemPlacement {
                    parent_location: ParentLocation::LeftHand,
                    placement: Placement::LeftHand,
                }
            } else {
                HeldItemPlacement {
                    parent_location: ParentLocation::RightHand,
                    placement: Placement::RightHandCombat,
                }
            },
        )
    } else {
        None
    };
    if let Some(held) = held {
        return Ok(Some(WieldedItemClassification::Held(held)));
    }

    if !locations.intersects(EQUIP_MASK_PAINTABLE) {
        return Ok(None);
    }
    if facts.item_type == Some(ItemType::ARMOR.bits() as i32)
        || locations.intersects(EQUIP_MASK_ARMOR_OR_EXTREMITY)
    {
        return Ok(Some(WieldedItemClassification::Painted(
            PaintedWieldedItem::Armor,
        )));
    }
    if facts.item_type == Some(ItemType::CLOTHING.bits() as i32) {
        return Ok(Some(WieldedItemClassification::Painted(
            PaintedWieldedItem::Clothing,
        )));
    }
    Ok(None)
}

/// Ordered semantic appearance substitutions for one live entity.
///
/// Values use expanded palette color units and full content identities. Protocol packing and
/// catalog storage conventions are normalized by their source adapters before this value is built.
#[derive(Debug, Clone, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntityAppearance {
    /// Optional base palette applied before subpalette ranges.
    pub palette_did: Option<u32>,
    /// Ordered palette range substitutions.
    pub sub_palettes: Vec<EntitySubPalette>,
    /// Ordered setup-part texture substitutions.
    pub texture_changes: Vec<EntityTextureChange>,
    /// Ordered setup-part GfxObj substitutions.
    pub part_changes: Vec<EntityPartChange>,
}

/// One replacement palette applied to an expanded color interval.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntitySubPalette {
    /// Replacement palette resource id.
    pub palette_did: u32,
    /// First color in the base palette.
    pub offset: u32,
    /// Number of colors replaced; zero is an explicit no-op interval.
    pub color_count: u32,
}

impl EntitySubPalette {
    /// Colors in one retail palette group.
    ///
    /// Retail counts palette ranges in eight-color groups everywhere it stores them — the wire
    /// `ModelData`, CLO tables, and ACE's authored face constants alike. This contract carries
    /// expanded colors, so every adapter expands exactly once, here.
    pub const GROUP_COLORS: u32 = 8;

    /// Build one range from a retail packed group offset and group count.
    pub fn from_groups(palette_did: u32, offset_groups: u32, group_count: u32) -> Self {
        Self {
            palette_did,
            offset: offset_groups * Self::GROUP_COLORS,
            color_count: group_count * Self::GROUP_COLORS,
        }
    }
}

/// One texture substitution addressed within a setup part.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntityTextureChange {
    /// Zero-based setup part index.
    pub part_index: u8,
    /// Authored texture resource to replace.
    pub old_texture_did: u32,
    /// Replacement texture resource.
    pub new_texture_did: u32,
}

/// One setup-part GfxObj substitution.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntityPartChange {
    /// Zero-based setup part index.
    pub part_index: u8,
    /// Replacement GfxObj resource id.
    pub gfx_obj_did: u32,
}

impl From<&ModelData> for EntityAppearance {
    fn from(model: &ModelData) -> Self {
        Self {
            palette_did: model.palette_id,
            sub_palettes: model
                .sub_palettes
                .iter()
                .map(|palette| {
                    EntitySubPalette::from_groups(
                        palette.id,
                        u32::from(palette.offset),
                        // Retail's packed zero byte represents all 256 eight-color groups.
                        u32::from(if palette.length == 0 {
                            256
                        } else {
                            u16::from(palette.length)
                        }),
                    )
                })
                .collect(),
            texture_changes: model
                .texture_changes
                .iter()
                .map(|change| EntityTextureChange {
                    part_index: change.part_index,
                    old_texture_did: change.old_id,
                    new_texture_did: change.new_id,
                })
                .collect(),
            part_changes: model
                .model_changes
                .iter()
                .map(|change| EntityPartChange {
                    part_index: change.index,
                    gfx_obj_did: change.animation_id,
                })
                .collect(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use holtburger_protocol::messages::object::types::{ModelChange, SubPalette, TextureChange};

    fn facts(
        valid_locations: i32,
        item_type: i32,
        default_combat_style: Option<i32>,
    ) -> WieldedItemSlotFacts {
        WieldedItemSlotFacts {
            valid_locations: Some(valid_locations),
            item_type: Some(item_type),
            default_combat_style,
        }
    }

    fn held(facts: WieldedItemSlotFacts, parent_location: ParentLocation, placement: Placement) {
        assert_eq!(
            classify_wielded_item(facts),
            Ok(Some(WieldedItemClassification::Held(HeldItemPlacement {
                parent_location,
                placement,
            })))
        );
    }

    #[test]
    fn melee_held_and_two_handed_items_use_right_hand_combat() {
        // Live catalog examples: melee 359, held caster 8904, and two-handed 52631.
        for item in [
            facts(1_048_576, 1, Some(2)),
            facts(16_777_216, 32_768, Some(512)),
            facts(33_554_432, 1, Some(8)),
        ] {
            held(item, ParentLocation::RightHand, Placement::RightHandCombat);
        }
    }

    #[test]
    fn armor_and_nonarmor_shields_take_distinct_ace_branches() {
        // Live armor shield 93 and non-armor shield 52636 differ only in ItemType semantics.
        held(
            facts(2_097_152, 2, None),
            ParentLocation::Shield,
            Placement::Shield,
        );
        held(
            facts(2_097_152, 1, None),
            ParentLocation::LeftWeapon,
            Placement::RightHandNonCombat,
        );
        assert_ne!(
            classify_wielded_item(facts(2_097_152, 2, None)),
            classify_wielded_item(facts(2_097_152, 1, None)),
            "inverting the ItemType branch must change both attachment facts"
        );
    }

    #[test]
    fn bow_and_thrown_missiles_take_distinct_ace_hands() {
        // Live bow 306 carries style 16; live thrown weapon 320 carries style 128.
        held(
            facts(4_194_304, 256, Some(16)),
            ParentLocation::LeftHand,
            Placement::LeftHand,
        );
        held(
            facts(4_194_304, 256, Some(128)),
            ParentLocation::RightHand,
            Placement::RightHandCombat,
        );
        assert_ne!(
            classify_wielded_item(facts(4_194_304, 256, Some(16))),
            classify_wielded_item(facts(4_194_304, 256, Some(128))),
            "inverting the combat-style branch must change the hand"
        );
    }

    #[test]
    fn painted_buckets_preserve_real_pathwarden_slot_classification() {
        // WCID 33614's plate 54, shirt 130, and sollerets 107.
        assert_eq!(
            classify_wielded_item(facts(0x600, 2, None)),
            Ok(Some(WieldedItemClassification::Painted(
                PaintedWieldedItem::Armor
            )))
        );
        assert_eq!(
            classify_wielded_item(facts(0x1e, 4, None)),
            Ok(Some(WieldedItemClassification::Painted(
                PaintedWieldedItem::Clothing
            )))
        );
        assert_eq!(
            classify_wielded_item(facts(0x100, 4, None)),
            Ok(Some(WieldedItemClassification::Painted(
                PaintedWieldedItem::Armor
            )))
        );
        assert_ne!(
            classify_wielded_item(facts(0x600, 2, None)),
            classify_wielded_item(facts(0x1e, 4, None)),
            "inverting the painted branch must change its ordering bucket"
        );
    }

    #[test]
    fn missile_ammo_and_nonpainted_slots_have_no_presentation_classification() {
        // Live bow ammunition 300 and jewelry both remain separate from held-child emission.
        assert_eq!(classify_wielded_item(facts(8_388_608, 256, None)), Ok(None));
        assert_eq!(classify_wielded_item(facts(0x8000, 8, None)), Ok(None));
        assert_eq!(
            classify_wielded_item(WieldedItemSlotFacts {
                valid_locations: None,
                item_type: Some(1),
                default_combat_style: Some(2),
            }),
            Ok(None)
        );
    }

    #[test]
    fn held_branches_fail_loudly_only_for_the_fact_the_branch_consumes() {
        assert_eq!(
            classify_wielded_item(WieldedItemSlotFacts {
                valid_locations: Some(2_097_152),
                item_type: None,
                default_combat_style: None,
            }),
            Err(WieldedItemClassificationError::MissingShieldItemType)
        );
        assert_eq!(
            classify_wielded_item(WieldedItemSlotFacts {
                valid_locations: Some(4_194_304),
                item_type: Some(256),
                default_combat_style: None,
            }),
            Err(WieldedItemClassificationError::MissingMissileCombatStyle)
        );
        held(
            WieldedItemSlotFacts {
                valid_locations: Some(1_048_576),
                item_type: None,
                default_combat_style: None,
            },
            ParentLocation::RightHand,
            Placement::RightHandCombat,
        );
    }

    #[test]
    fn wire_model_data_normalizes_units_without_reordering() {
        let model = ModelData {
            header: 0x11,
            extra: [2, 1, 1],
            palette_id: Some(0x0400_0001),
            sub_palettes: vec![
                SubPalette {
                    id: 0x0400_0002,
                    offset: 3,
                    length: 4,
                },
                SubPalette {
                    id: 0x0400_0003,
                    offset: 0,
                    length: 0,
                },
            ],
            texture_changes: vec![TextureChange {
                part_index: 5,
                old_id: 0x0500_0001,
                new_id: 0x0500_0002,
            }],
            model_changes: vec![ModelChange {
                index: 6,
                animation_id: 0x0100_0001,
            }],
        };

        let appearance = EntityAppearance::from(&model);

        assert_eq!(appearance.palette_did, Some(0x0400_0001));
        assert_eq!(appearance.sub_palettes[0].offset, 24);
        assert_eq!(appearance.sub_palettes[0].color_count, 32);
        assert_eq!(appearance.sub_palettes[1].color_count, 2048);
        assert_eq!(appearance.texture_changes[0].part_index, 5);
        assert_eq!(appearance.part_changes[0].part_index, 6);
    }
}
