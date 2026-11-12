//! Narrow retained entity facts shared by inventory and selected-identity consumers.

use std::collections::BTreeSet;

use holtburger_common::{
    Guid,
    properties::{
        ObjectDescriptionFlag, PropertyBool, PropertyDataId, PropertyInt, PropertyString,
        WorldObjectExt, WorldObjectPropertyAccessors,
    },
};
use serde::{Deserialize, Serialize};

use crate::{
    WorldState,
    context::WorldContextExt,
    entity_classification::{
        DynamicEntityMapBlipCategory, semantic_dynamic_entity_map_blip_category,
    },
    spell::{CantripTier, RankedCantripTier},
    state::{
        ScenePlacementError,
        storage::{RosterCoverage, StorageLocation, StorageSlot},
    },
};

/// World-derived intrinsic equipment cantrip status, synchronized with appraisals and updates.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum EquipmentCantripState {
    /// No successful full appraisal is retained for the current entity incarnation.
    Unappraised,
    /// Full appraisal arrived, but at least one intrinsic item spell is missing from `spell_catalog`.
    Incomplete,
    /// Full appraisal resolved every intrinsic item spell against `spell_catalog`.
    Known {
        #[serde(rename = "highestTier")]
        highest_tier: Option<RankedCantripTier>,
    },
}

/// Whether the server supports a health subscription for the described object.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HealthQueryEligibility {
    /// Public creature semantics; ACE health queries accept Creature instances.
    Eligible,
    /// A described non-creature has no creature-health subscription.
    Ineligible,
}

/// Server-authored inputs for UI icon composition, independent of scene appearance.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntityIconAppearance {
    /// Base image DID; absent when no nonzero icon is supplied.
    pub base: Option<u32>,
    /// Authored artwork above the base, excluding the server's secondary-overlay scratch value.
    pub overlay: Option<u32>,
    /// Authored artwork below the working base/effects image.
    pub underlay: Option<u32>,
    /// Complete server effects mask; presentation chooses the retail mapping.
    pub ui_effects: u32,
}

impl EntityIconAppearance {
    /// Collect lossless icon-composition inputs from any retained world-object property source.
    pub fn from_properties(object: &impl WorldObjectPropertyAccessors) -> Self {
        Self {
            base: object.get_data_prop(PropertyDataId::Icon).map(|id| id.0),
            overlay: object
                .get_data_prop(PropertyDataId::IconOverlay)
                .map(|id| id.0),
            underlay: object
                .get_data_prop(PropertyDataId::IconUnderlay)
                .map(|id| id.0),
            ui_effects: object.get_int_prop(PropertyInt::UiEffects).unwrap_or(0) as u32,
        }
    }
}

/// Independently optional server structure properties, consumed by item and selected-entity UI.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EntityStructure {
    /// Remaining uses/structure; absence is distinct from an exhausted item.
    pub current: Option<u32>,
    /// Full capacity, which the server may publish independently of the current value.
    pub max: Option<u32>,
}

/// Display facts become known independently of storage announcements.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum EntityDescription {
    /// Identity exists but its public name/type are not yet known.
    Pending,
    /// Server-authored name and world-derived health applicability.
    Known {
        /// Consumed by item cells, container headers, and the selected HUD.
        name: String,
        /// Current quantity when MaxStackSize establishes stackability; consumed by item cells.
        #[serde(rename = "stackCount")]
        stack_count: Option<u32>,
        /// Lossless structure properties for item indicators and selected-entity labels.
        structure: EntityStructure,
        /// Shared reuse group and configured duration, consumed by item cooldown UI.
        cooldown: Option<crate::item_cooldowns::ItemCooldownDefinition>,
        /// Consumed by inventory and other UI item-image presentation.
        icon: EntityIconAppearance,
        /// Public item classification consumed by frontend inventory type sorting.
        #[serde(rename = "itemType")]
        item_type: u32,
        /// Color-independent category shared with map markers, consumed by selected-name styling.
        #[serde(rename = "mapCategory")]
        map_category: DynamicEntityMapBlipCategory,
        /// Slot compatibility for inventory hover presentation, including off-hand melee use.
        /// Does not establish skill/level admission; absent before valid locations arrive.
        #[serde(rename = "equipLocations")]
        equip_locations: Option<u32>,
        /// World-derived intrinsic cantrip tier for equippable items; absent on non-equipment.
        #[serde(rename = "equipmentCantrip")]
        equipment_cantrip: Option<EquipmentCantripState>,
        /// Whether known equipment facts offer a distinct alternate-side request for action cells.
        #[serde(rename = "hasAlternateEquipSide")]
        has_alternate_equip_side: bool,
        /// Authored use shape consumed by inventory and action interaction entry points.
        #[serde(rename = "useCapability")]
        use_capability: crate::item_use::ItemUseCapability,
        /// Public activation spell, consumed by caster shortcuts independently of learned spells.
        #[serde(rename = "builtInSpell")]
        built_in_spell: Option<u32>,
        /// Template identity and remaining supply for consumable consumers.
        consumable: Option<crate::item_use::ConsumableFacts>,
        /// Public object-description flags consumed by selected-entity diagnostics.
        #[serde(rename = "objectFlags")]
        object_flags: u32,
        /// Received template identity consumed by selected diagnostics and inventory grouping.
        wcid: Option<u32>,
        /// Server-maintained coin total across the player's packs, unknown before receipt.
        #[serde(rename = "pyrealBalance")]
        pyreal_balance: Option<u32>,
        /// Local player's encumbrance/capacity ratio for inventory presentation; absent until
        /// the root roster and required world inputs arrive, and on non-player entities.
        burden: Option<f32>,
        /// Local-player sigil activation for equipment UI; absent before PlayerDescription
        /// and on non-player entities. Consumers never interpret raw property bits.
        #[serde(rename = "aetheriaActivation")]
        aetheria_activation: Option<crate::equipment::AetheriaActivation>,
        /// Consumed by the effective health subscription controller.
        #[serde(rename = "healthQuery")]
        health_query: HealthQueryEligibility,
    },
}

/// Accepted storage relationship exposed to identity and inventory consumers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum EntityStorageLocation {
    /// No accepted containment or equipment relationship.
    None,
    /// Direct parent and independently hydrated slot information.
    Contained {
        /// Parent identity used by frontend section grouping.
        #[serde(rename = "parentGuid")]
        parent_guid: Guid,
        /// Server placement category/order, not inferred from capacity.
        slot: StorageSlot,
    },
    /// Equipped items remain owned but do not occupy inventory grid cells.
    Equipped {
        /// Creature wearing the item, not implicitly the current player.
        #[serde(rename = "wearerGuid")]
        wearer_guid: Guid,
        /// Accepted current equipment locations; absent until the slot declaration arrives.
        mask: Option<u32>,
    },
}

/// Storage existence and roster receipt, independent of child description hydration.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum StorageCoverage {
    /// Neither received roster nor hydrated storage capability establishes storage.
    NotEstablished,
    /// World knows this object supplies storage, which may still await its roster.
    Container {
        /// Distinguishes known-empty storage from unknown contents.
        roster: ContainerRoster,
        /// Ordinary item-slot capacity for inventory section headers; absent before hydration.
        #[serde(rename = "itemCapacity")]
        item_capacity: Option<u32>,
        /// Pack-slot limit for the inventory container strip; absent before hydration.
        #[serde(rename = "packCapacity")]
        pack_capacity: Option<u32>,
    },
}

/// Roster coverage serialized separately from per-item pending descriptions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ContainerRoster {
    /// No complete roster received.
    Awaiting,
    /// Complete direct roster received.
    Announced,
}

/// World placement availability is not renderer mesh residency.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SceneAvailability {
    /// An independent or resolved attached placement exists.
    Available,
    /// The retained identity cannot currently be placed in the scene.
    Unavailable,
}

/// World-owned category for direct world-entity acquisition, independent of draw visibility.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum EntityTargetingCategory {
    /// Missing public type, hidden identity, or no independent world placement.
    Ineligible,
    /// Non-projectile public ItemType::CREATURE, including players and friendly creatures.
    Creature,
    /// Server-classified missile, retained through local impact retirement until reconciliation.
    Projectile,
    /// An eligible non-projectile world entity without the creature item-type bit.
    NonCreature,
}

/// Session-local interaction state for a corpse visible to client conveniences.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CorpseState {
    /// The corpse has not produced a successful contents response for this session.
    Unopened,
    /// This client has successfully opened the corpse during this session.
    Opened,
}

/// Broad world-object semantics; frontends choose pill labels and presentation order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum NearbyEntityCategory {
    Player,
    Npc,
    Monster,
    /// Public corpse identity, distinct from ordinary storage containers.
    Corpse,
    Container,
    Item,
    Portal,
    Lifestone,
    /// Door identity, independent of direct-use capability.
    Door,
    /// Otherwise generic object explicitly advertising untargeted use from the world.
    Useable,
}

/// Minimal public-description projection, with no dependency on appraisal property storage.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NearbyEntityFacts {
    /// Public name used by catalog search and alert rules.
    pub name: String,
    /// Shared broad classification used by catalog category pills.
    pub category: NearbyEntityCategory,
    /// Public vendor distinction displayed inside the NPC group.
    pub vendor: bool,
    /// Public quantity, absent until stackability and current count are disclosed.
    pub stack_count: Option<u32>,
    /// Public remaining uses and capacity, both independently optional.
    pub structure: EntityStructure,
}

fn nearby_category(
    flags: holtburger_common::properties::ObjectDescriptionFlag,
    item_type: holtburger_common::properties::ItemType,
    usable: holtburger_common::properties::Usable,
) -> NearbyEntityCategory {
    use crate::entity_classification::{
        DynamicEntityPresentationClass as Class, semantic_dynamic_entity_presentation_class,
    };
    use NearbyEntityCategory as Category;
    use holtburger_common::properties::{ItemType, ObjectDescriptionFlag as Flag, Usable};
    if flags.contains(Flag::CORPSE) && !flags.intersects(Flag::PLAYER | Flag::VENDOR) {
        return Category::Corpse;
    }
    if flags.contains(Flag::DOOR) {
        return Category::Door;
    }
    match semantic_dynamic_entity_presentation_class(flags, Some(item_type)) {
        Class::Player => Category::Player,
        Class::Npc => Category::Npc,
        Class::Mob => Category::Monster,
        Class::Portal => Category::Portal,
        Class::Other
            if flags.intersects(Flag::LIFE_STONE | Flag::BIND_STONE)
                || item_type.contains(ItemType::LIFE_STONE) =>
        {
            Category::Lifestone
        }
        Class::Other if item_type.contains(ItemType::CONTAINER) => Category::Container,
        // Retail permits attempting UNDEF, but it supplies no explicit affordance. Require a
        // public world-use location and no target requirement.
        Class::Other
            if usable.allows_direct_use()
                && usable.intersects(Usable::VIEWED | Usable::REMOTE)
                && usable.target_flags().is_empty() =>
        {
            Category::Useable
        }
        Class::Other => Category::Item,
    }
}

/// Public tool classification and authored template knowledge for targeted lock interactions.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum LockToolFacts {
    /// Template grouping and use policy remain frontend concerns.
    Key,
    /// Authored additive template bonus; None means the WCID/property is unavailable.
    Lockpick { bonus: Option<i32> },
}

pub(crate) fn lock_tool_facts(
    flags: holtburger_common::properties::ObjectDescriptionFlag,
    item_type: Option<holtburger_common::properties::ItemType>,
    wcid: Option<u32>,
) -> Option<LockToolFacts> {
    use holtburger_common::properties::{ItemType, ObjectDescriptionFlag};
    // ACE Lockpick.cs supplies this specific flag; it takes precedence over broad item bits.
    if flags.contains(ObjectDescriptionFlag::LOCKPICK) {
        Some(LockToolFacts::Lockpick {
            bonus: wcid.and_then(holtburger_content::lockpick_bonus),
        })
    } else if item_type.is_some_and(|kind| kind.intersects(ItemType::KEY)) {
        Some(LockToolFacts::Key)
    } else {
        None
    }
}

/// Whole-source sale admission tied to the vendor whose terms produced it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VendorSaleEligibility {
    /// Interaction identity prevents a frontend applying a verdict to a different vendor.
    pub vendor: Guid,
    /// Whether the source can enter a sale draft under the current world facts.
    pub accepted: bool,
}

/// Incarnation-scoped entity health sample projected into the host monotonic clock.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntityHealthFacts {
    /// Server entity incarnation that produced this sample.
    pub instance_sequence: u16,
    /// Clamped health fraction in `[0, 1]`.
    pub fraction: f32,
    /// Monotonic host-clock timestamp in seconds (`DynamicEntityHostTime::seconds`).
    pub observed_at_seconds: f64,
}

/// One accepted identity's facts; browser consumers never replay raw entity properties.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientEntityFacts {
    /// Stable key shared with selection and rendering.
    pub guid: Guid,
    /// Summon ownership and observed activity/timing; absent without nonzero pet ownership.
    pub summon: Option<crate::summon::SummonFacts>,
    /// Retained entity health observation projected into monotonic host time for snapshot recovery.
    pub health: Option<EntityHealthFacts>,
    /// Public-only independent-world catalog facts; absent for contents and attachments.
    pub nearby: Option<NearbyEntityFacts>,
    /// Cell/header/HUD and health subscription facts.
    pub description: EntityDescription,
    /// Direct containment/equipment relationship for inventory grouping.
    pub location: EntityStorageLocation,
    /// Accepted recursive ownership, including unhydrated declarations.
    pub owned_by_player: bool,
    /// Shared loose-world or external-contents pickup admission.
    pub can_pick_up: bool,
    /// Accepted descendant of the confirmed external root, including pending contents.
    pub world_container_content: bool,
    /// Coarse recipient admission consumed by give gestures; server acceptance may differ.
    pub can_receive_give: bool,
    /// Other-player interaction admission consumed by the selected HUD.
    pub can_trade: bool,
    /// Whole-item trade admission consumed by inventory drops.
    pub can_offer_trade: bool,
    /// Current vendor's whole-source verdict for owned items; absent without vendor terms.
    pub vendor_sale: Option<VendorSaleEligibility>,
    /// Shared whole-item salvage admission and normalized review inputs.
    pub salvage: crate::crafting::salvage::SalvageCandidate,
    /// Tool classification and template bonus consumed by lock interactions.
    pub lock_tool: Option<LockToolFacts>,
    /// Current authoritative lock state; absent until supplied by the server.
    pub is_locked: Option<bool>,
    /// Scene capability independent of loaded renderer assets.
    pub scene_placement: SceneAvailability,
    /// Consumed by keyboard acquisition; not a renderer visibility decision.
    pub targeting: EntityTargetingCategory,
    /// Another player whose public PvP status permits harming us; ignores range and temporary protections.
    /// Consumed by stance-aware frontend targeting.
    pub player_threat: bool,
    /// Corpse identity and this session's confirmed-open state; absent for other entities.
    pub corpse: Option<CorpseState>,
    /// Section existence and loading state.
    pub storage: StorageCoverage,
}

/// ACE Player_Combat.cs CheckPKStatusVsTarget permits harmful player actions for matching
/// PK/PKLite types, or either Free participant. Missing player identity cannot establish a threat.
fn player_pvp_threat(player: ObjectDescriptionFlag, target: ObjectDescriptionFlag) -> bool {
    if !player.contains(ObjectDescriptionFlag::PLAYER)
        || !target.contains(ObjectDescriptionFlag::PLAYER)
    {
        return false;
    }
    let free = ObjectDescriptionFlag::FREE_PK_STATUS;
    let types = ObjectDescriptionFlag::PLAYER_KILLER | ObjectDescriptionFlag::PK_LITE_STATUS;
    (player | target).intersects(free)
        || (!(player & types).is_empty() && player & types == target & types)
}

impl WorldState {
    /// Retained visible entities plus owned declarations and the established player root.
    pub fn client_entity_guids(&self) -> BTreeSet<Guid> {
        let mut guids: BTreeSet<_> = self
            .iter_visible_entities()
            .map(|entity| entity.guid)
            .collect();
        guids.extend(self.storage.owned_items(self.player.guid));
        guids.extend(self.world_container_contents());
        guids.extend(self.current_trade_item_guids());
        if self.player.guid != Guid::NULL {
            guids.insert(self.player.guid);
        }
        guids
    }

    /// Project accepted facts without requiring rendering content or a physics body.
    pub fn client_entity_facts(
        &self,
        guid: Guid,
    ) -> Result<Option<ClientEntityFacts>, ScenePlacementError> {
        self.client_entity_facts_inner(guid, None)
    }

    /// Project accepted facts with monotonic host-clock health stamps for core snapshot recovery.
    pub fn client_entity_facts_with_host_origin(
        &self,
        guid: Guid,
        host_origin: std::time::Instant,
    ) -> Result<Option<ClientEntityFacts>, ScenePlacementError> {
        self.client_entity_facts_inner(guid, Some(host_origin))
    }

    fn client_entity_facts_inner(
        &self,
        guid: Guid,
        host_origin: Option<std::time::Instant>,
    ) -> Result<Option<ClientEntityFacts>, ScenePlacementError> {
        let entity = self.get_visible_entity(guid);
        let owned_by_player = self.storage.owned_by(guid, self.player.guid);
        // Deletion retires the old storage links at acceptance. Any later owned declaration
        // establishes a pending identity even while its deleted description awaits eviction.
        let external = self.is_world_container_content(guid);
        let retired_preview = self
            .entity_lifecycle_state(guid)
            .is_some_and(|state| state.container_preview)
            && !external
            && !owned_by_player
            && !self
                .retention_snapshot(guid, self.current_server_time())
                // An in-flight pickup retains its description, not access to closed contents.
                .is_some_and(|snapshot| {
                    snapshot.has_authoritative_retention() || snapshot.has_preview_retention()
                });
        if retired_preview
            || (entity.is_none()
                && !owned_by_player
                && !external
                && !self.trade_contains_item(guid)
                && (guid == Guid::NULL || guid != self.player.guid))
        {
            return Ok(None);
        }
        let creature = entity
            .and_then(|entity| entity.item_type())
            .map(|kind| kind.contains(holtburger_common::properties::ItemType::CREATURE));
        let description = match entity.and_then(|entity| {
            let name = entity.get_string_prop(PropertyString::Name)?;
            let item_type = entity.item_type()?;
            Some((entity, name, item_type))
        }) {
            Some((entity, name, item_type)) => {
                let equipment = crate::equipment::EquipmentFacts::from_entity(entity).ok();
                let equip_locations =
                    entity
                        .get_int_prop(PropertyInt::ValidLocations)
                        .map(|mask| {
                            equipment
                                .map_or(mask as u32, |facts| facts.compatible_locations().bits())
                        });
                let equipment_cantrip = self.item_equipment_cantrip_state(
                    entity,
                    entity.flags,
                    entity.inspection_supplement.as_ref(),
                    &entity.spell_book,
                );
                EntityDescription::Known {
                    name: name.to_owned(),
                    stack_count: entity.is_stackable().then(|| entity.stack_size()),
                    structure: EntityStructure {
                        current: entity.structure(),
                        max: entity.max_structure(),
                    },
                    cooldown: crate::item_cooldowns::ItemCooldownDefinition::from_properties(
                        entity,
                    ),
                    icon: EntityIconAppearance::from_properties(entity),
                    map_category: semantic_dynamic_entity_map_blip_category(
                        entity.flags,
                        Some(item_type),
                        entity.usable_flags(),
                    ),
                    item_type: item_type.bits(),
                    has_alternate_equip_side: equipment.is_some_and(|facts| {
                        facts.preferred_side_request(false) != facts.preferred_side_request(true)
                    }),
                    use_capability: crate::item_use::item_use_capability(entity),
                    built_in_spell: entity.spell().filter(|id| *id != Guid::NULL).map(|id| id.0),
                    consumable: crate::item_use::consumable_facts(entity),
                    // Apparel target hints need declared coverage, not the clothing priority
                    // required for replacement planning. Incomplete conflict facts must not
                    // make a known equippable item lose its equipment action classification.
                    equip_locations,
                    equipment_cantrip,
                    object_flags: entity.flags.bits(),
                    wcid: entity.wcid,
                    pyreal_balance: entity.get_int_prop(PropertyInt::CoinValue).map(|value| {
                        u32::try_from(value).expect("coin balance must be non-negative")
                    }),
                    burden: if guid == self.player.guid
                        && self.storage_coverage(guid) == Some(RosterCoverage::Announced)
                    {
                        self.player_burden()
                    } else {
                        None
                    },
                    aetheria_activation: if guid == self.player.guid {
                        self.player_aetheria_activation()
                    } else {
                        None
                    },
                    health_query: if creature == Some(true) {
                        HealthQueryEligibility::Eligible
                    } else {
                        HealthQueryEligibility::Ineligible
                    },
                }
            }
            None => EntityDescription::Pending,
        };
        let location = match self.storage_location(guid) {
            Some(StorageLocation::Contained { parent, slot }) => EntityStorageLocation::Contained {
                parent_guid: parent,
                slot,
            },
            Some(StorageLocation::Equipped { wearer, mask }) => EntityStorageLocation::Equipped {
                wearer_guid: wearer,
                mask: mask.map(|mask| mask.bits()),
            },
            None => EntityStorageLocation::None,
        };
        let storage = match self.storage_coverage(guid) {
            Some(coverage) => StorageCoverage::Container {
                item_capacity: entity.and_then(|entity| entity.items_capacity()),
                pack_capacity: entity.and_then(|entity| entity.containers_capacity()),
                roster: match coverage {
                    RosterCoverage::Awaiting => ContainerRoster::Awaiting,
                    RosterCoverage::Announced => ContainerRoster::Announced,
                },
            },
            None if entity.is_some_and(|entity| entity.can_hold_items()) => {
                StorageCoverage::Container {
                    roster: ContainerRoster::Awaiting,
                    item_capacity: entity.and_then(|entity| entity.items_capacity()),
                    pack_capacity: entity.and_then(|entity| entity.containers_capacity()),
                }
            }
            None => StorageCoverage::NotEstablished,
        };
        let resolved = self.resolve_scene_placement(guid)?;
        let scene_placement = match resolved {
            crate::ResolvedScenePlacement::Unresolved(_) => SceneAvailability::Unavailable,
            _ => SceneAvailability::Available,
        };
        // ACE.Entity/Enum/ItemType.cs defines Creature = 0x10; disposition is independent.
        // Selection rays also reject UiHidden. Storage/attachments are not independent targets.
        let targeting = match entity.zip(creature) {
            Some((entity, is_creature))
                if !entity.get_bool_prop(PropertyBool::UiHidden)
                    && matches!(location, EntityStorageLocation::None)
                    && matches!(resolved, crate::ResolvedScenePlacement::Independent) =>
            {
                if entity.physics.is_authoritative_projectile() {
                    EntityTargetingCategory::Projectile
                } else if is_creature {
                    EntityTargetingCategory::Creature
                } else {
                    EntityTargetingCategory::NonCreature
                }
            }
            _ => EntityTargetingCategory::Ineligible,
        };
        Ok(Some(ClientEntityFacts {
            guid,
            nearby: entity
                .filter(|_| {
                    matches!(resolved, crate::ResolvedScenePlacement::Independent)
                        && matches!(location, EntityStorageLocation::None)
                })
                .and_then(|entity| {
                    let public = entity.public_description.as_ref()?;
                    if public.ui_hidden {
                        return None;
                    }
                    Some(NearbyEntityFacts {
                        name: public.name.clone()?,
                        category: nearby_category(entity.flags, public.item_type, public.usable),
                        vendor: entity
                            .flags
                            .contains(holtburger_common::properties::ObjectDescriptionFlag::VENDOR),
                        stack_count: public
                            .max_stack_count
                            .filter(|max| *max > 1)
                            .and(public.stack_count),
                        structure: EntityStructure {
                            current: public.structure,
                            max: public.max_structure,
                        },
                    })
                }),
            description,
            summon: entity.and_then(|entity| entity.summon_facts()),
            health: host_origin.and_then(|origin| {
                entity.and_then(|entity| {
                    entity.health.map(|health| EntityHealthFacts {
                        instance_sequence: entity.instance_sequence(),
                        fraction: health.fraction,
                        observed_at_seconds: health
                            .observed_at
                            .saturating_duration_since(origin)
                            .as_secs_f64(),
                    })
                })
            }),
            location,
            owned_by_player,
            can_pick_up: crate::interaction::pickup_candidate(self, guid).is_some(),
            world_container_content: external,
            can_receive_give: crate::interaction::give_recipient_candidate(self, guid),
            can_trade: self.trade_partner_candidate(guid),
            can_offer_trade: self.can_offer_trade_item(guid),
            vendor_sale: self
                .vendor
                .as_ref()
                .filter(|_| owned_by_player)
                .map(|vendor| VendorSaleEligibility {
                    vendor: vendor.vendor_guid,
                    accepted: self.quote_vendor_sale(vendor, guid).is_ok(),
                }),
            salvage: self.salvage_candidate(guid),
            lock_tool: entity
                .and_then(|entity| lock_tool_facts(entity.flags, entity.item_type(), entity.wcid)),
            is_locked: entity.and_then(|entity| entity.get_bool_prop_opt(PropertyBool::Locked)),
            scene_placement,
            targeting,
            player_threat: guid != self.player.guid
                && entity.is_some_and(|target| {
                    self.get_visible_entity(self.player.guid)
                        .is_some_and(|player| player_pvp_threat(player.flags, target.flags))
                }),
            corpse: entity.and_then(|entity| {
                entity
                    .flags
                    .contains(holtburger_common::properties::ObjectDescriptionFlag::CORPSE)
                    .then_some(CorpseState::Unopened)
            }),
            storage,
        }))
    }

    fn item_equipment_cantrip_state(
        &self,
        item: &impl WorldObjectExt,
        flags: ObjectDescriptionFlag,
        inspection_supplement: Option<&crate::inspection::InspectionSupplement>,
        spell_book: &[u32],
    ) -> Option<EquipmentCantripState> {
        compute_equipment_cantrip_state(
            &self.spell_catalog,
            item,
            flags,
            inspection_supplement,
            spell_book,
        )
    }
}

/// Computes intrinsic equipment cantrip state for any described world or vendor item.
pub(crate) fn compute_equipment_cantrip_state(
    spell_catalog: &crate::spell::SpellCatalog,
    item: &impl WorldObjectExt,
    flags: ObjectDescriptionFlag,
    inspection_supplement: Option<&crate::inspection::InspectionSupplement>,
    spell_book: &[u32],
) -> Option<EquipmentCantripState> {
    let equippable = item
        .get_int_prop(PropertyInt::ValidLocations)
        .is_some_and(|mask| mask != 0);
    if !equippable {
        return None;
    }
    if inspection_supplement.is_none() {
        return Some(EquipmentCantripState::Unappraised);
    }
    let mut highest_tier: Option<RankedCantripTier> = None;
    for spell in crate::inspection::decode_item_spell_book(
        flags,
        item.spell(),
        item.get_data_prop(PropertyDataId::ProcSpell),
        spell_book,
    ) {
        if spell.role != crate::inspection::InspectionSpellRole::Item {
            continue;
        }
        let Some(info) = spell_catalog.get(spell.id) else {
            return Some(EquipmentCantripState::Incomplete);
        };
        if let Some(ranked) = info.cantrip_tier().and_then(CantripTier::ranked) {
            highest_tier = Some(highest_tier.map_or(ranked, |current| current.max(ranked)));
        }
    }
    Some(EquipmentCantripState::Known { highest_tier })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{PhysicsAttachment, entity::Entity};
    use holtburger_common::{
        ParentLocation, Placement,
        properties::{
            EquipMask, ItemType, ObjectDescriptionFlag, PropertyInt, Usable,
            WorldObjectPropertyAccessorsMut,
        },
    };

    #[test]
    fn lock_tools_share_reference_bonuses_with_inspection() {
        use crate::inspection::{InspectionContext, ObjectInspection, ObjectInspectionDetails};
        let mut world = WorldState::synthetic();
        let guid = Guid(12);
        let mut item = Entity::new(guid, "Tool".into(), Default::default());
        item.set_int_prop(PropertyInt::ItemType, ItemType::KEY.bits() as i32);
        assert_eq!(
            lock_tool_facts(item.flags, item.item_type(), item.wcid),
            Some(LockToolFacts::Key)
        );
        item.flags.insert(ObjectDescriptionFlag::LOCKPICK);
        world.entities.insert(item);
        for wcid in [
            Some(510),
            Some(512),
            Some(513),
            Some(27672),
            Some(999),
            None,
        ] {
            world.entities.get_mut(guid).expect("tool").wcid = wcid;
            let facts = world
                .client_entity_facts(guid)
                .expect("placement")
                .expect("facts");
            let inspection = ObjectInspection::from_entity(
                world.entities.get(guid).expect("tool"),
                InspectionContext::new(&world.character_titles),
            )
            .expect("inspection");
            let ObjectInspectionDetails::Item(item) = inspection.details else {
                panic!("item inspection")
            };
            assert_eq!(
                facts.lock_tool,
                Some(LockToolFacts::Lockpick {
                    bonus: wcid.and_then(holtburger_content::lockpick_bonus)
                })
            );
            assert_eq!(item.lock_tool, facts.lock_tool);
        }
        assert_eq!(
            lock_tool_facts(
                ObjectDescriptionFlag::empty(),
                Some(ItemType::CONTAINER),
                Some(512)
            ),
            None
        );
    }

    #[test]
    fn nearby_public_facts_ignore_appraisal_and_accept_ordinary_updates() {
        use holtburger_common::properties::PropertyUpdate;
        use holtburger_protocol::messages::object::events::IdentifyObjectResponseEventData;
        use holtburger_protocol::messages::object::messages::description::{
            ObjectDescriptionData, PublicWeenieDescription,
        };

        let mut world = WorldState::synthetic();
        let guid = Guid(7);
        let mut entity = Entity::new(
            guid,
            "Original".into(),
            holtburger_common::position::WorldPosition {
                landblock_id: Guid(0xda55_0001),
                ..Default::default()
            },
        );
        entity.apply_description(&ObjectDescriptionData {
            pos: Some(holtburger_common::position::WorldPosition {
                landblock_id: Guid(0xda55_0001),
                ..Default::default()
            }),
            public_weenie_desc: PublicWeenieDescription {
                guid,
                name: Some("Public Chest".into()),
                item_type: ItemType::CONTAINER.bits(),
                stack_size: Some(2),
                max_stack_size: Some(10),
                usable: Some(Usable::REMOTE.bits()),
                ..Default::default()
            },
            ..Default::default()
        });
        world.entities.insert(entity);
        let before = world
            .client_entity_facts(guid)
            .unwrap()
            .unwrap()
            .nearby
            .unwrap();
        assert_eq!(before.category, NearbyEntityCategory::Container);
        assert_eq!(before.stack_count, Some(2));
        let mut appraisal = IdentifyObjectResponseEventData {
            success: true,
            ..Default::default()
        };
        appraisal
            .properties
            .set_string_prop(PropertyString::Name, "Appraised Name".into());
        appraisal
            .properties
            .set_int_prop(PropertyInt::ItemType, ItemType::CREATURE.bits() as i32);
        appraisal.properties.set_int_prop(PropertyInt::StackSize, 9);
        appraisal
            .properties
            .set_int_prop(PropertyInt::Structure, 99);
        appraisal
            .properties
            .set_int_prop(PropertyInt::ItemUseable, Usable::NO.bits() as i32);
        assert!(
            world
                .entities
                .get_mut(guid)
                .unwrap()
                .apply_identify_response(&appraisal)
        );
        assert_eq!(
            world.client_entity_facts(guid).unwrap().unwrap().nearby,
            Some(before)
        );
        world
            .entities
            .get_mut(guid)
            .unwrap()
            .set_property(PropertyUpdate::Int(PropertyInt::StackSize, 4));
        assert_eq!(
            world
                .client_entity_facts(guid)
                .unwrap()
                .unwrap()
                .nearby
                .unwrap()
                .stack_count,
            Some(4)
        );

        world
            .entities
            .get_mut(guid)
            .unwrap()
            .set_property(PropertyUpdate::Bool(PropertyBool::UiHidden, true));
        assert!(
            world
                .client_entity_facts(guid)
                .unwrap()
                .unwrap()
                .nearby
                .is_none()
        );
        world
            .entities
            .get_mut(guid)
            .unwrap()
            .set_property(PropertyUpdate::Bool(PropertyBool::UiHidden, false));
        assert!(
            world
                .client_entity_facts(guid)
                .unwrap()
                .unwrap()
                .nearby
                .is_some()
        );

        // Resolved attachment transforms do not turn equipment into independent catalog roots.
        let parent_guid = Guid(99);
        world.entities.insert(Entity::new(
            parent_guid,
            "Parent".into(),
            world.entities.get(guid).unwrap().position,
        ));
        world.entities.get_mut(guid).unwrap().placement_intent =
            crate::attachment::EntityPlacementIntent::Attached(
                PhysicsAttachment::from_wire(parent_guid, 1, 0).unwrap(),
            );
        assert!(
            matches!(world.resolve_scene_placement(guid).unwrap(), crate::ResolvedScenePlacement::Attached { root, .. } if root == parent_guid)
        );
        assert!(
            world
                .client_entity_facts(guid)
                .unwrap()
                .unwrap()
                .nearby
                .is_none()
        );
    }

    #[test]
    fn nearby_categories_prioritize_identity_over_broad_item_bits() {
        for (flags, item_type, usable, expected) in [
            (
                ObjectDescriptionFlag::PLAYER | ObjectDescriptionFlag::ATTACKABLE,
                ItemType::CREATURE,
                Usable::VIEWED_REMOTE,
                NearbyEntityCategory::Player,
            ),
            (
                ObjectDescriptionFlag::VENDOR | ObjectDescriptionFlag::ATTACKABLE,
                ItemType::CREATURE,
                Usable::VIEWED_REMOTE,
                NearbyEntityCategory::Npc,
            ),
            (
                ObjectDescriptionFlag::ATTACKABLE,
                ItemType::CREATURE,
                Usable::VIEWED_REMOTE,
                NearbyEntityCategory::Monster,
            ),
            (
                ObjectDescriptionFlag::empty(),
                ItemType::CREATURE,
                Usable::VIEWED_REMOTE,
                NearbyEntityCategory::Npc,
            ),
            (
                ObjectDescriptionFlag::CORPSE,
                ItemType::CONTAINER,
                Usable::VIEWED_REMOTE,
                NearbyEntityCategory::Corpse,
            ),
            (
                ObjectDescriptionFlag::empty(),
                ItemType::CONTAINER,
                Usable::VIEWED_REMOTE,
                NearbyEntityCategory::Container,
            ),
            (
                ObjectDescriptionFlag::PORTAL,
                ItemType::MISC,
                Usable::VIEWED_REMOTE,
                NearbyEntityCategory::Portal,
            ),
            (
                ObjectDescriptionFlag::BIND_STONE,
                ItemType::MISC,
                Usable::VIEWED_REMOTE,
                NearbyEntityCategory::Lifestone,
            ),
            (
                ObjectDescriptionFlag::DOOR,
                ItemType::MISC,
                Usable::VIEWED_REMOTE,
                NearbyEntityCategory::Door,
            ),
            (
                ObjectDescriptionFlag::empty(),
                ItemType::MISC,
                Usable::VIEWED_REMOTE,
                NearbyEntityCategory::Useable,
            ),
            (
                ObjectDescriptionFlag::empty(),
                ItemType::MISC,
                Usable::UNDEF,
                NearbyEntityCategory::Item,
            ),
        ] {
            assert_eq!(nearby_category(flags, item_type, usable), expected);
        }
    }

    #[test]
    fn nearby_useable_requires_explicit_untargeted_world_use() {
        for (usable, expected) in [
            (Usable::VIEWED, NearbyEntityCategory::Useable),
            (Usable::REMOTE, NearbyEntityCategory::Useable),
            (Usable::UNDEF, NearbyEntityCategory::Item),
            (Usable::NO | Usable::REMOTE, NearbyEntityCategory::Item),
            (Usable::CONTAINED, NearbyEntityCategory::Item),
            (Usable::WIELDED, NearbyEntityCategory::Item),
            (Usable::NEVER_WALK, NearbyEntityCategory::Item),
            (
                Usable::SOURCE_REMOTE_TARGET_REMOTE,
                NearbyEntityCategory::Item,
            ),
        ] {
            assert_eq!(
                nearby_category(ObjectDescriptionFlag::STUCK, ItemType::MISC, usable),
                expected
            );
        }
    }

    #[test]
    fn nearby_levers_use_public_usability_without_a_catalog_or_appraisal() {
        use holtburger_common::properties::PropertyUpdate;
        use holtburger_protocol::messages::object::events::IdentifyObjectResponseEventData;
        use holtburger_protocol::messages::object::messages::description::{
            ObjectDescriptionData, PublicWeenieDescription,
        };

        let mut world = WorldState::synthetic();
        for wcid in [286, 2609] {
            let guid = Guid(wcid);
            let mut entity = Entity::new(
                guid,
                "Lever".into(),
                holtburger_common::position::WorldPosition {
                    landblock_id: Guid(0xda55_0001),
                    ..Default::default()
                },
            );
            entity.apply_description(&ObjectDescriptionData {
                pos: Some(holtburger_common::position::WorldPosition {
                    landblock_id: Guid(0xda55_0001),
                    ..Default::default()
                }),
                public_weenie_desc: PublicWeenieDescription {
                    guid,
                    wcid,
                    name: Some("Lever".into()),
                    item_type: ItemType::MISC.bits(),
                    obj_desc_flags: ObjectDescriptionFlag::STUCK
                        | ObjectDescriptionFlag::ATTACKABLE,
                    usable: Some(Usable::VIEWED_REMOTE.bits()),
                    ..Default::default()
                },
                ..Default::default()
            });
            world.entities.insert(entity);
            let category = |world: &WorldState| {
                world
                    .client_entity_facts(guid)
                    .unwrap()
                    .unwrap()
                    .nearby
                    .unwrap()
                    .category
            };
            assert_eq!(category(&world), NearbyEntityCategory::Useable);
            let mut appraisal = IdentifyObjectResponseEventData {
                success: true,
                ..Default::default()
            };
            appraisal
                .properties
                .set_int_prop(PropertyInt::ItemUseable, Usable::NO.bits() as i32);
            let entity = world.entities.get_mut(guid).unwrap();
            assert!(entity.apply_identify_response(&appraisal));
            assert_eq!(category(&world), NearbyEntityCategory::Useable);
            world
                .entities
                .get_mut(guid)
                .unwrap()
                .set_property(PropertyUpdate::Int(
                    PropertyInt::ItemUseable,
                    Usable::NO.bits() as i32,
                ));
            assert_eq!(category(&world), NearbyEntityCategory::Item);
        }
    }

    #[test]
    fn selected_category_preserves_door_useability_independently_of_use_capability() {
        let mut world = WorldState::synthetic();
        let guid = Guid(7);
        let mut door = Entity::new(guid, "Door".into(), Default::default());
        door.flags = ObjectDescriptionFlag::DOOR;
        door.set_int_prop(PropertyInt::ItemType, ItemType::MISC.bits() as i32);
        world.entities.insert(door);
        for (usable, expected) in [
            (Usable::REMOTE, DynamicEntityMapBlipCategory::Door),
            // Targeted use without target metadata is unavailable, but direct-use admission
            // still determines the map category. Consumers must not reconstruct it from capability.
            (
                Usable::SOURCE_REMOTE_TARGET_REMOTE,
                DynamicEntityMapBlipCategory::Door,
            ),
            (Usable::NO, DynamicEntityMapBlipCategory::DoorNoDirectUse),
        ] {
            world
                .entities
                .get_mut(guid)
                .unwrap()
                .set_int_prop(PropertyInt::ItemUseable, usable.bits() as i32);
            let EntityDescription::Known { map_category, .. } = world
                .client_entity_facts(guid)
                .unwrap()
                .unwrap()
                .description
            else {
                panic!("door description must be known");
            };
            assert_eq!(map_category, expected);
        }
    }

    #[test]
    fn player_threat_uses_both_pvp_statuses_and_excludes_self_and_nonplayers() {
        use holtburger_common::properties::PropertyUpdate;
        let mut world = WorldState::synthetic();
        let player = Guid(1);
        let peer = Guid(2);
        world.seed_local_player_entity(player, "Player", Default::default());
        world.entities.get_mut(player).unwrap().flags = ObjectDescriptionFlag::PLAYER;
        let mut other = Entity::new(peer, "Peer".into(), Default::default());
        other.flags = ObjectDescriptionFlag::PLAYER;
        other.set_int_prop(PropertyInt::ItemType, ItemType::CREATURE.bits() as i32);
        world.entities.insert(other);
        let statuses = [0x02, 0x04, 0x40, 0x20]; // ACE NPK, PK, PKLite, Free.
        for local in statuses {
            world
                .entities
                .get_mut(player)
                .unwrap()
                .set_property(PropertyUpdate::Int(PropertyInt::PlayerKillerStatus, local));
            for remote in statuses {
                world
                    .entities
                    .get_mut(peer)
                    .unwrap()
                    .set_property(PropertyUpdate::Int(PropertyInt::PlayerKillerStatus, remote));
                let expected =
                    local == 0x20 || remote == 0x20 || (local == remote && local != 0x02);
                assert_eq!(
                    world
                        .client_entity_facts(peer)
                        .unwrap()
                        .unwrap()
                        .player_threat,
                    expected,
                    "local {local:#x}, remote {remote:#x}"
                );
                assert!(
                    !world
                        .client_entity_facts(player)
                        .unwrap()
                        .unwrap()
                        .player_threat
                );
            }
        }
        world
            .entities
            .get_mut(peer)
            .unwrap()
            .flags
            .remove(ObjectDescriptionFlag::PLAYER);
        assert!(
            !world
                .client_entity_facts(peer)
                .unwrap()
                .unwrap()
                .player_threat
        );
    }

    #[test]
    fn targeting_uses_public_creature_type_and_independent_nonhidden_placement() {
        let mut world = WorldState::synthetic();
        for (id, item_type, expected) in [
            (1, ItemType::CREATURE, EntityTargetingCategory::Creature),
            (
                2,
                ItemType::MELEE_WEAPON,
                EntityTargetingCategory::NonCreature,
            ),
        ] {
            let guid = Guid(id);
            let mut entity = Entity::new(guid, "Target".into(), Default::default());
            entity.position.landblock_id = Guid(0xda55_0100 + id);
            entity.set_int_prop(PropertyInt::ItemType, item_type.bits() as i32);
            world.entities.insert(entity);
            assert_eq!(
                world.client_entity_facts(guid).unwrap().unwrap().targeting,
                expected
            );
            world
                .entities
                .get_mut(guid)
                .unwrap()
                .set_bool_prop(PropertyBool::UiHidden, true);
            assert_eq!(
                world.client_entity_facts(guid).unwrap().unwrap().targeting,
                EntityTargetingCategory::Ineligible
            );
        }
        let unknown = Guid(3);
        let mut entity = Entity::new(unknown, "Unknown".into(), Default::default());
        entity.position.landblock_id = Guid(0xda55_0103);
        world.entities.insert(entity);
        assert_eq!(
            world
                .client_entity_facts(unknown)
                .unwrap()
                .unwrap()
                .targeting,
            EntityTargetingCategory::Ineligible
        );
    }

    #[test]
    fn targeting_retains_projectile_classification_until_server_reconciliation() {
        use crate::entity_physics::resolve_effective_entity_physics_state;
        use holtburger_common::properties::PhysicsState;

        let mut world = WorldState::synthetic();
        let guid = Guid(4);
        let mut entity = Entity::new(guid, "Projectile".into(), Default::default());
        entity.position.landblock_id = Guid(0xda55_0104);
        entity.set_int_prop(PropertyInt::ItemType, ItemType::MELEE_WEAPON.bits() as i32);
        entity
            .physics
            .reconcile(resolve_effective_entity_physics_state(
                PhysicsState::MISSILE,
            ));
        world.entities.insert(entity);
        assert_eq!(
            world.client_entity_facts(guid).unwrap().unwrap().targeting,
            EntityTargetingCategory::Projectile
        );
        world
            .entities
            .get_mut(guid)
            .unwrap()
            .physics
            .clear_after_collision(PhysicsState::MISSILE);
        assert_eq!(
            world.client_entity_facts(guid).unwrap().unwrap().targeting,
            EntityTargetingCategory::Projectile
        );
        world
            .entities
            .get_mut(guid)
            .unwrap()
            .physics
            .reconcile(resolve_effective_entity_physics_state(PhysicsState::empty()));
        assert_eq!(
            world.client_entity_facts(guid).unwrap().unwrap().targeting,
            EntityTargetingCategory::NonCreature
        );
    }

    #[test]
    fn equipment_slot_compatibility_preserves_unknown_and_allows_off_hand_melee() {
        let mut world = WorldState::synthetic();
        let guid = Guid(2);
        let mut entity = Entity::new(guid, "Weapon".into(), Default::default());
        entity.set_int_prop(PropertyInt::ItemType, ItemType::MELEE_WEAPON.bits() as i32);
        world.entities.insert(entity);
        let locations = |world: &WorldState| match world
            .client_entity_facts(guid)
            .unwrap()
            .unwrap()
            .description
        {
            EntityDescription::Known {
                equip_locations, ..
            } => equip_locations,
            EntityDescription::Pending => panic!("fixture must be hydrated"),
        };
        assert_eq!(locations(&world), None);
        for (valid, expected) in [
            (
                EquipMask::MELEE_WEAPON,
                EquipMask::MELEE_WEAPON | EquipMask::SHIELD,
            ),
            (EquipMask::TWO_HANDED, EquipMask::TWO_HANDED),
            (
                EquipMask::CHEST_ARMOR | EquipMask::UPPER_ARM_ARMOR,
                EquipMask::CHEST_ARMOR | EquipMask::UPPER_ARM_ARMOR,
            ),
            (EquipMask::NONE, EquipMask::NONE),
        ] {
            world
                .entities
                .get_mut(guid)
                .unwrap()
                .set_int_prop(PropertyInt::ValidLocations, valid.bits() as i32);
            assert_eq!(locations(&world), Some(expected.bits()));
        }
        let weapon = world.entities.get_mut(guid).unwrap();
        weapon.set_int_prop(
            PropertyInt::ValidLocations,
            EquipMask::MELEE_WEAPON.bits() as i32,
        );
        weapon.set_int_prop(
            PropertyInt::CombatUse,
            holtburger_common::properties::CombatUse::TwoHanded as i32,
        );
        assert_eq!(locations(&world), Some(EquipMask::MELEE_WEAPON.bits()));
    }

    #[test]
    fn player_coin_total_is_unknown_until_the_server_supplies_it() {
        let mut world = WorldState::synthetic();
        let player = Guid(1);
        world.player.guid = player;
        let mut entity = Entity::new(player, "Player".into(), Default::default());
        entity.set_int_prop(PropertyInt::ItemType, ItemType::CREATURE.bits() as i32);
        world.entities.insert(entity);
        assert!(matches!(
            world
                .client_entity_facts(player)
                .unwrap()
                .unwrap()
                .description,
            EntityDescription::Known {
                object_flags: 0,
                wcid: None,
                pyreal_balance: None,
                burden: None,
                aetheria_activation: None,
                ..
            }
        ));
        world
            .entities
            .get_mut(player)
            .unwrap()
            .set_int_prop(PropertyInt::CoinValue, 12345);
        assert!(matches!(
            world
                .client_entity_facts(player)
                .unwrap()
                .unwrap()
                .description,
            EntityDescription::Known {
                pyreal_balance: Some(12345),
                ..
            }
        ));
    }

    #[test]
    fn container_capacity_tracks_hydration_and_property_updates() {
        let mut world = WorldState::synthetic();
        let player = Guid(1);
        let bag = Guid(2);
        world.player.guid = player;
        world.storage.announce_container(bag, player);
        world.storage.replace_contents(bag, &[]);
        let storage = |world: &WorldState| world.client_entity_facts(bag).unwrap().unwrap().storage;
        assert_eq!(
            storage(&world),
            StorageCoverage::Container {
                roster: ContainerRoster::Announced,
                item_capacity: None,
                pack_capacity: None,
            }
        );
        let mut entity = Entity::new(bag, "Bag".into(), Default::default());
        entity.set_int_prop(PropertyInt::ItemsCapacity, 24);
        entity.set_int_prop(PropertyInt::ContainersCapacity, 7);
        world.entities.insert(entity);
        assert_eq!(
            storage(&world),
            StorageCoverage::Container {
                roster: ContainerRoster::Announced,
                item_capacity: Some(24),
                pack_capacity: Some(7),
            }
        );
        world
            .entities
            .get_mut(bag)
            .unwrap()
            .set_int_prop(PropertyInt::ItemsCapacity, 30);
        assert_eq!(
            storage(&world),
            StorageCoverage::Container {
                roster: ContainerRoster::Announced,
                item_capacity: Some(30),
                pack_capacity: Some(7),
            }
        );
    }

    #[test]
    fn equipped_identity_can_be_owned_and_scene_available_after_pending_hydration() {
        let mut world = WorldState::synthetic();
        let player = Guid(1);
        let sword = Guid(2);
        world.player.guid = player;
        world
            .storage
            .equip(sword, player, Some(EquipMask::MELEE_WEAPON));
        let pending = world.client_entity_facts(sword).unwrap().unwrap();
        assert_eq!(pending.description, EntityDescription::Pending);
        assert_eq!(
            pending.location,
            EntityStorageLocation::Equipped {
                wearer_guid: player,
                mask: Some(EquipMask::MELEE_WEAPON.bits()),
            }
        );
        assert!(pending.owned_by_player);
        assert_eq!(pending.scene_placement, SceneAvailability::Unavailable);
        assert_eq!(world.client_entity_guids(), BTreeSet::from([player, sword]));

        let mut root = Entity::new(player, "Player".into(), Default::default());
        root.position.landblock_id = Guid(0xda55_0001);
        world.entities.insert(root);
        let mut entity = Entity::new(sword, "Sword".into(), Default::default());
        entity.set_int_prop(PropertyInt::ItemType, ItemType::MELEE_WEAPON.bits() as i32);
        entity.wcid = Some(123);
        entity.flags = holtburger_common::properties::ObjectDescriptionFlag::ATTACKABLE;
        entity.set_attachment(Some(PhysicsAttachment {
            parent: player,
            location: ParentLocation::RightHand,
            placement: Placement::RightHandCombat,
        }));
        world.entities.insert(entity);
        let hydrated = world.client_entity_facts(sword).unwrap().unwrap();
        assert_eq!(
            hydrated.description,
            EntityDescription::Known {
                name: "Sword".into(),
                cooldown: None,
                stack_count: None,
                structure: EntityStructure {
                    current: None,
                    max: None
                },
                icon: EntityIconAppearance {
                    base: None,
                    overlay: None,
                    underlay: None,
                    ui_effects: 0
                },
                item_type: ItemType::MELEE_WEAPON.bits(),
                map_category: DynamicEntityMapBlipCategory::Other,
                equip_locations: None,
                equipment_cantrip: None,
                has_alternate_equip_side: false,
                use_capability: crate::item_use::ItemUseCapability::Direct,
                built_in_spell: None,
                consumable: None,
                object_flags: holtburger_common::properties::ObjectDescriptionFlag::ATTACKABLE
                    .bits(),
                wcid: Some(123),
                pyreal_balance: None,
                burden: None,
                aetheria_activation: None,
                health_query: HealthQueryEligibility::Ineligible,
            }
        );
        assert_eq!(hydrated.targeting, EntityTargetingCategory::Ineligible);
        assert!(hydrated.owned_by_player);
        assert_eq!(hydrated.scene_placement, SceneAvailability::Available);
        world.mark_entity_explicit_delete(sword);
        assert!(world.entities.get(sword).is_some());
        assert_eq!(world.client_entity_facts(sword).unwrap(), None);
    }

    #[test]
    fn missing_ancestor_does_not_delete_retained_creature_or_fabricate_parent_record() {
        let mut world = WorldState::synthetic();
        let creature = Guid(3);
        let absent_parent = Guid(4);
        let mut entity = Entity::new(creature, "Creature".into(), Default::default());
        entity.set_int_prop(PropertyInt::ItemType, ItemType::CREATURE.bits() as i32);
        entity.set_attachment(Some(PhysicsAttachment {
            parent: absent_parent,
            location: ParentLocation::RightHand,
            placement: Placement::RightHandCombat,
        }));
        world.entities.insert(entity);
        let facts = world.client_entity_facts(creature).unwrap().unwrap();
        assert_eq!(
            facts.description,
            EntityDescription::Known {
                name: "Creature".into(),
                cooldown: None,
                stack_count: None,
                structure: EntityStructure {
                    current: None,
                    max: None
                },
                icon: EntityIconAppearance {
                    base: None,
                    overlay: None,
                    underlay: None,
                    ui_effects: 0
                },
                item_type: ItemType::CREATURE.bits(),
                map_category: DynamicEntityMapBlipCategory::Npc,
                equip_locations: None,
                equipment_cantrip: None,
                has_alternate_equip_side: false,
                use_capability: crate::item_use::ItemUseCapability::Direct,
                built_in_spell: None,
                consumable: None,
                object_flags: 0,
                wcid: None,
                pyreal_balance: None,
                burden: None,
                aetheria_activation: None,
                health_query: HealthQueryEligibility::Eligible,
            }
        );
        assert_eq!(facts.scene_placement, SceneAvailability::Unavailable);
        assert!(!facts.owned_by_player);
        assert_eq!(world.client_entity_facts(absent_parent).unwrap(), None);
        assert_eq!(world.client_entity_guids(), BTreeSet::from([creature]));
    }

    #[test]
    fn equipment_cantrip_tracks_highest_ranked_tier_exclusions_and_update_invalidation() {
        use std::sync::Arc;

        use holtburger_common::properties::{EquipMask, ItemType, WorldObjectPropertyAccessorsMut};
        use holtburger_dat::file_type::spell_table::SpellBase as DatSpellBase;
        use holtburger_protocol::messages::{
            GameEvent, GameEventMessage, GameMessage, ObjectDescriptionData,
            PublicWeenieDescription,
            object::events::{IdentifyObjectResponseEventData, IdentifyResponseFlags},
        };

        use crate::spell::{SpellCatalog, SpellInfo};

        fn cantrip_spell(name: &str, category: u32, bitfield: u32, power: u32) -> SpellInfo {
            SpellInfo::from(DatSpellBase {
                name: name.to_owned(),
                category,
                bitfield,
                power,
                ..DatSpellBase::default()
            })
        }

        let mut catalog = SpellCatalog::default();
        // Category 261 + beneficial bit 0x4: power 5 = Minor, power 25 = Epic, power 8 = Other
        catalog
            .spells
            .insert(10, cantrip_spell("Minor Strength", 261, 0x4, 5));
        catalog
            .spells
            .insert(11, cantrip_spell("Epic Strength", 261, 0x4, 25));
        catalog
            .spells
            .insert(12, cantrip_spell("Thew of the Giant", 261, 0x4, 8));
        // Excluded active enchantment / proc / on-use spells even if legendary cantrip
        catalog
            .spells
            .insert(20, cantrip_spell("Legendary Strength", 261, 0x4, 35));
        catalog
            .spells
            .insert(21, cantrip_spell("Legendary Quickness", 261, 0x4, 35));

        let mut world = WorldState::synthetic();
        world.spell_catalog = Arc::new(catalog);

        let armor_guid = Guid(0x5000_0001);
        let armor_desc = || ObjectDescriptionData {
            pos: Some(Default::default()),
            public_weenie_desc: PublicWeenieDescription {
                guid: armor_guid,
                name: Some("Covenant Breastplate".into()),
                wcid: 9001,
                item_type: ItemType::ARMOR.bits(),
                valid_locations: Some(EquipMask::CHEST_ARMOR.bits()),
                priority: Some(0x10),
                ..Default::default()
            },
            ..Default::default()
        };

        world.handle_message(&GameMessage::ObjectCreate(Box::new(armor_desc())));
        let initial = world.client_entity_facts(armor_guid).unwrap().unwrap();
        let EntityDescription::Known {
            equipment_cantrip, ..
        } = initial.description
        else {
            panic!("expected known description");
        };
        assert_eq!(equipment_cantrip, Some(EquipmentCantripState::Unappraised));

        let identify = |spell_book: Vec<u32>, proc_spell: Option<u32>| {
            let mut properties = holtburger_common::properties::WorldObjectProperties::default();
            if let Some(proc_id) = proc_spell {
                properties
                    .dids
                    .insert(PropertyDataId::ProcSpell, Guid(proc_id));
            }
            GameMessage::GameEvent(Box::new(GameEventMessage {
                target: armor_guid,
                sequence: 1,
                event: GameEvent::IdentifyObjectResponse(Box::new(
                    IdentifyObjectResponseEventData {
                        object_guid: armor_guid,
                        flags: IdentifyResponseFlags::SPELL_BOOK,
                        success: true,
                        properties,
                        spell_book,
                        ..IdentifyObjectResponseEventData::default()
                    },
                )),
            }))
        };

        // 1. Mixed intrinsic cantrips + excluded active enchantment (high bit) + proc + missing excluded ID:
        //    only intrinsic item spells count, Other is ignored cleanly, Epic wins over Minor.
        world.handle_message(&identify(
            vec![10, 12, 11, 20 | 0x8000_0000, 21, 9999 | 0x8000_0000],
            Some(21),
        ));
        let identified = world.client_entity_facts(armor_guid).unwrap().unwrap();
        assert!(matches!(
            identified.description,
            EntityDescription::Known {
                equipment_cantrip: Some(EquipmentCantripState::Known {
                    highest_tier: Some(RankedCantripTier::Epic),
                }),
                ..
            }
        ));

        // 2. Same-GUID UpdateObject drops appraisal state back to Unappraised, then reappraisal restores Known.
        world.handle_message(&GameMessage::UpdateObject(Box::new(armor_desc())));
        let updated = world.client_entity_facts(armor_guid).unwrap().unwrap();
        assert!(matches!(
            updated.description,
            EntityDescription::Known {
                equipment_cantrip: Some(EquipmentCantripState::Unappraised),
                ..
            }
        ));

        // 3. Missing intrinsic Item spell in catalog yields Incomplete rather than pretending None.
        world.handle_message(&identify(vec![10, 8888], None));
        let incomplete = world.client_entity_facts(armor_guid).unwrap().unwrap();
        assert!(matches!(
            incomplete.description,
            EntityDescription::Known {
                equipment_cantrip: Some(EquipmentCantripState::Incomplete),
                ..
            }
        ));

        // 4. Appraised empty spellbook (or nonstandard-only Other) yields Known { highest_tier: None }.
        world.handle_message(&identify(vec![12], None));
        let nonstandard_only = world.client_entity_facts(armor_guid).unwrap().unwrap();
        assert!(matches!(
            nonstandard_only.description,
            EntityDescription::Known {
                equipment_cantrip: Some(EquipmentCantripState::Known { highest_tier: None }),
                ..
            }
        ));

        // 5. Food / non-equippable item carries equipment_cantrip: None even after appraisal.
        let potion_guid = Guid(0x5000_0002);
        let mut potion = Entity::new(potion_guid, "Healing Potion".into(), Default::default());
        potion.flags = ObjectDescriptionFlag::FOOD;
        potion.set_int_prop(PropertyInt::ItemType, ItemType::FOOD.bits() as i32);
        potion.spell_book = vec![11];
        potion.inspection_supplement = Some(Default::default());
        world.entities.insert(potion);
        let potion_facts = world.client_entity_facts(potion_guid).unwrap().unwrap();
        assert!(matches!(
            potion_facts.description,
            EntityDescription::Known {
                equipment_cantrip: None,
                ..
            }
        ));

        // 6. Open vendor offers share the exact same classification helper.
        let vendor_guid = Guid(0x6000_0001);
        let mut vendor_item = crate::vendor::CoreVendorItem::from_protocol(
            &holtburger_protocol::messages::trade::events::VendorItemEventData {
                packed_stack_size: 1,
                description: PublicWeenieDescription {
                    guid: vendor_guid,
                    name: Some("Vendor Cuirass".into()),
                    item_type: ItemType::ARMOR.bits(),
                    valid_locations: Some(EquipMask::UPPER_LEG_WEAR.bits()),
                    ..Default::default()
                },
            },
        );
        assert_eq!(
            vendor_item.equipment_cantrip,
            Some(EquipmentCantripState::Unappraised)
        );
        vendor_item.inspection_supplement = Some(Default::default());
        vendor_item.spell_book = vec![10, 11];
        vendor_item.refresh_equipment_cantrip(&world.spell_catalog);
        assert_eq!(
            vendor_item.equipment_cantrip,
            Some(EquipmentCantripState::Known {
                highest_tier: Some(RankedCantripTier::Epic),
            })
        );
    }

    #[test]
    fn rejected_creature_appraisal_admits_health_and_same_incarnation_retains_it() {
        use std::time::{Duration, Instant};

        use crate::WorldEvent;
        use holtburger_common::properties::ItemType;
        use holtburger_protocol::messages::{
            GameEvent, GameEventMessage, GameMessage, ObjectDescriptionData,
            PublicWeenieDescription,
            object::{
                events::{IdentifyObjectResponseEventData, IdentifyResponseFlags},
                types::{CreatureProfile, CreatureProfileFlags},
            },
        };

        let mut world = WorldState::synthetic();
        let origin = Instant::now();
        let creature_guid = Guid(0x7000_0001);
        let monster_desc = |instance_sequence: u16| {
            let mut desc = ObjectDescriptionData {
                pos: Some(Default::default()),
                public_weenie_desc: PublicWeenieDescription {
                    guid: creature_guid,
                    name: Some("Drudge Lurker".into()),
                    wcid: 200,
                    item_type: ItemType::CREATURE.bits(),
                    ..Default::default()
                },
                ..Default::default()
            };
            desc.sequences[8] = instance_sequence;
            desc
        };

        world.handle_message_at(
            &GameMessage::ObjectCreate(Box::new(monster_desc(3))),
            origin,
        );

        let rejected = |health: u32, health_max: u32| {
            GameMessage::GameEvent(Box::new(GameEventMessage {
                target: creature_guid,
                sequence: 1,
                event: GameEvent::IdentifyObjectResponse(Box::new(
                    IdentifyObjectResponseEventData {
                        object_guid: creature_guid,
                        flags: IdentifyResponseFlags::CREATURE_PROFILE,
                        success: false,
                        creature_profile: Some(CreatureProfile {
                            flags: CreatureProfileFlags::empty(),
                            health,
                            health_max,
                            attributes: None,
                            buffs: None,
                        }),
                        ..Default::default()
                    },
                )),
            }))
        };

        let sample_time = origin + Duration::from_secs(5);
        let events = world.handle_message_at(&rejected(60, 200), sample_time);
        assert!(events.iter().any(|event| matches!(
            event,
            WorldEvent::EntityHealthUpdated {
                guid,
                instance_sequence: 3,
                health_fraction,
                observed_at,
            } if *guid == creature_guid && (*health_fraction - 0.3).abs() < 1e-6 && *observed_at == sample_time
        )));
        assert!(events.iter().any(|event| matches!(
            event,
            WorldEvent::ObjectInspectionResult(result)
                if result.guid == creature_guid
                    && matches!(result.outcome, crate::inspection::ObjectInspectionOutcome::Rejected)
        )));
        assert!(
            !events
                .iter()
                .any(|event| matches!(event, WorldEvent::EntityIdentified(_)))
        );

        // Zero health_max is ignored cleanly.
        let invalid_events =
            world.handle_message_at(&rejected(50, 0), origin + Duration::from_secs(6));
        assert!(
            !invalid_events
                .iter()
                .any(|event| matches!(event, WorldEvent::EntityHealthUpdated { .. }))
        );

        // Same-incarnation UpdateObject preserves health and monotonic age, while clearing supplement.
        world
            .entities
            .get_mut(creature_guid)
            .unwrap()
            .inspection_supplement = Some(Default::default());
        world.handle_message_at(
            &GameMessage::UpdateObject(Box::new(monster_desc(3))),
            origin + Duration::from_secs(8),
        );
        assert!(
            world
                .entities
                .get(creature_guid)
                .unwrap()
                .inspection_supplement
                .is_none()
        );
        let same_incarnation = world
            .client_entity_facts_with_host_origin(creature_guid, origin)
            .unwrap()
            .unwrap();
        assert_eq!(
            same_incarnation.health,
            Some(EntityHealthFacts {
                instance_sequence: 3,
                fraction: 0.3,
                observed_at_seconds: 5.0,
            })
        );

        // New incarnation drops stale health from the previous incarnation.
        world.handle_message_at(
            &GameMessage::UpdateObject(Box::new(monster_desc(4))),
            origin + Duration::from_secs(9),
        );
        let new_incarnation = world
            .client_entity_facts_with_host_origin(creature_guid, origin)
            .unwrap()
            .unwrap();
        assert_eq!(new_incarnation.health, None);
    }

    #[test]
    fn remote_hostile_attack_motion_emits_combat_observed_only_for_targeted_attacks() {
        use std::time::{Duration, Instant};

        use crate::WorldEvent;
        use holtburger_common::properties::ItemType;
        use holtburger_protocol::messages::{
            GameMessage, MovementEventData, MovementType, MovementTypeData,
            movement::{
                InterpretedMotionState, MotionItem, MovementInvalid, MovementStateFlags,
                TurnToObject, TurnToParameters,
            },
        };

        let mut world = WorldState::synthetic();
        let origin = Instant::now();
        let player = Guid(0x5000_0001);
        let monster = Guid(0x7000_0002);
        let bystander = Guid(0x7000_0003);
        world.player.guid = player;

        for (guid, name) in [(player, "Hero"), (monster, "Drudge"), (bystander, "Other")] {
            let mut entity = Entity::new(guid, name.into(), Default::default());
            entity.sequences[8] = 11;
            entity.set_int_prop(PropertyInt::ItemType, ItemType::CREATURE.bits() as i32);
            world.add_entity(entity);
        }

        // Generic TurnToObject does not establish hostile combat.
        let turn_events = world.handle_message_at(
            &GameMessage::UpdateMotion(Box::new(MovementEventData {
                guid: monster,
                object_instance_sequence: 11,
                movement_sequence: 1,
                server_control_sequence: 1,
                is_autonomous: false,
                movement_type: MovementType::TurnToObject,
                motion_flags: 0,
                current_style: 0x003c,
                data: MovementTypeData::TurnToObject(TurnToObject {
                    target: player,
                    desired_heading: 0.0,
                    params: TurnToParameters::default(),
                }),
            })),
            origin + Duration::from_secs(1),
        );
        assert!(
            !turn_events
                .iter()
                .any(|e| matches!(e, WorldEvent::EntityCombatObserved { .. }))
        );

        // Untargeted attack motion (no sticky target) does not emit combat observation.
        let swing_untargeted = GameMessage::UpdateMotion(Box::new(MovementEventData {
            guid: monster,
            object_instance_sequence: 11,
            movement_sequence: 2,
            server_control_sequence: 2,
            is_autonomous: false,
            movement_type: MovementType::Invalid,
            motion_flags: 0,
            current_style: 0x003c,
            data: MovementTypeData::Invalid(MovementInvalid {
                state: InterpretedMotionState {
                    flags: MovementStateFlags::INVALID,
                    num_commands: 1,
                    commands: vec![MotionItem::new(0x005bu16, 1, false, 1.0)],
                    ..Default::default()
                },
                sticky_object: None,
            }),
        }));
        let untargeted_events =
            world.handle_message_at(&swing_untargeted, origin + Duration::from_secs(2));
        assert!(
            !untargeted_events
                .iter()
                .any(|e| matches!(e, WorldEvent::EntityCombatObserved { .. }))
        );

        // Melee swing sticky-targeting any victim (bystander or local player) emits EntityCombatObserved.
        let bystander_combat_time = origin + Duration::from_secs(3);
        let swing_other = GameMessage::UpdateMotion(Box::new(MovementEventData {
            guid: monster,
            object_instance_sequence: 11,
            movement_sequence: 3,
            server_control_sequence: 3,
            is_autonomous: false,
            movement_type: MovementType::Invalid,
            motion_flags: 0,
            current_style: 0x003c,
            data: MovementTypeData::Invalid(MovementInvalid {
                state: InterpretedMotionState {
                    flags: MovementStateFlags::INVALID,
                    num_commands: 1,
                    commands: vec![MotionItem::new(0x005bu16, 2, false, 1.0)],
                    ..Default::default()
                },
                sticky_object: Some(bystander),
            }),
        }));
        let other_events = world.handle_message_at(&swing_other, bystander_combat_time);
        assert!(other_events.iter().any(|event| matches!(
            event,
            WorldEvent::EntityCombatObserved {
                guid,
                instance_sequence: 11,
                observed_at,
            } if *guid == monster && *observed_at == bystander_combat_time
        )));

        // Melee swing targeting local player emits EntityCombatObserved with instance + timestamp.
        let swing_player = GameMessage::UpdateMotion(Box::new(MovementEventData {
            guid: monster,
            object_instance_sequence: 11,
            movement_sequence: 4,
            server_control_sequence: 4,
            is_autonomous: false,
            movement_type: MovementType::Invalid,
            motion_flags: 0,
            current_style: 0x003c,
            data: MovementTypeData::Invalid(MovementInvalid {
                state: InterpretedMotionState {
                    flags: MovementStateFlags::INVALID,
                    num_commands: 1,
                    commands: vec![MotionItem::new(0x005bu16, 3, false, 1.0)],
                    ..Default::default()
                },
                sticky_object: Some(player),
            }),
        }));
        let combat_time = origin + Duration::from_secs(4);
        let hit_events = world.handle_message_at(&swing_player, combat_time);
        assert!(hit_events.iter().any(|event| matches!(
            event,
            WorldEvent::EntityCombatObserved {
                guid,
                instance_sequence: 11,
                observed_at,
            } if *guid == monster && *observed_at == combat_time
        )));
    }
}
