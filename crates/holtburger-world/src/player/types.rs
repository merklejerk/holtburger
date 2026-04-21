use crate::stats;
use holtburger_common::{CharacterOption, CharacterOptions1, CharacterOptions2, Guid};
use holtburger_protocol::messages::EquipMask;
use holtburger_protocol::messages::magic::Enchantment;
use holtburger_protocol::messages::movement::{MotionStance, PositionType};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq)]
pub struct SkillBase {
    pub ranks: u32,
    pub init: u32,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq)]
pub struct VitalBase {
    pub ranks: u32,
    pub start: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(crate) struct LastSentStats {
    pub attributes: Vec<stats::Attribute>,
    pub vitals: Vec<stats::Vital>,
    pub skills: Vec<stats::Skill>,
    pub resistances: stats::Resistances,
    pub armor: i32,
    pub vitae: f32,
}

enum CharacterOptionMask {
    Options1(CharacterOptions1),
    Options2(CharacterOptions2),
}

fn character_option_mask(option: CharacterOption) -> CharacterOptionMask {
    match option {
        CharacterOption::AutoRepeatAttacks => {
            CharacterOptionMask::Options1(CharacterOptions1::AUTO_REPEAT_ATTACK)
        }
        CharacterOption::IgnoreAllegianceRequests => {
            CharacterOptionMask::Options1(CharacterOptions1::IGNORE_ALLEGIANCE_REQUESTS)
        }
        CharacterOption::IgnoreFellowshipRequests => {
            CharacterOptionMask::Options1(CharacterOptions1::IGNORE_FELLOWSHIP_REQUESTS)
        }
        CharacterOption::IgnoreAllTradeRequests => {
            CharacterOptionMask::Options1(CharacterOptions1::IGNORE_TRADE_REQUESTS)
        }
        CharacterOption::DisableMostWeatherEffects => {
            CharacterOptionMask::Options1(CharacterOptions1::DISABLE_MOST_WEATHER_EFFECTS)
        }
        CharacterOption::AlwaysDaylightOutdoors => {
            CharacterOptionMask::Options2(CharacterOptions2::PERSISTENT_AT_DAY)
        }
        CharacterOption::LetOtherPlayersGiveYouItems => {
            CharacterOptionMask::Options1(CharacterOptions1::ALLOW_GIVE)
        }
        CharacterOption::KeepCombatTargetsInView => {
            CharacterOptionMask::Options1(CharacterOptions1::VIEW_COMBAT_TARGET)
        }
        CharacterOption::Display3dTooltips => {
            CharacterOptionMask::Options1(CharacterOptions1::SHOW_TOOLTIPS)
        }
        CharacterOption::AttemptToDeceiveOtherPlayers => {
            CharacterOptionMask::Options1(CharacterOptions1::USE_DECEPTION)
        }
        CharacterOption::RunAsDefaultMovement => {
            CharacterOptionMask::Options1(CharacterOptions1::TOGGLE_RUN)
        }
        CharacterOption::StayInChatModeAfterSendingMessage => {
            CharacterOptionMask::Options1(CharacterOptions1::STAY_IN_CHAT_MODE)
        }
        CharacterOption::AdvancedCombatInterface => {
            CharacterOptionMask::Options1(CharacterOptions1::ADVANCED_COMBAT_UI)
        }
        CharacterOption::AutoTarget => {
            CharacterOptionMask::Options1(CharacterOptions1::AUTO_TARGET)
        }
        CharacterOption::VividTargetingIndicator => {
            CharacterOptionMask::Options1(CharacterOptions1::VIVID_TARGETING_INDICATOR)
        }
        CharacterOption::ShareFellowshipExpAndLuminance => {
            CharacterOptionMask::Options1(CharacterOptions1::FELLOWSHIP_SHARE_XP)
        }
        CharacterOption::AcceptCorpseLootingPermissions => {
            CharacterOptionMask::Options1(CharacterOptions1::ACCEPT_LOOT_PERMITS)
        }
        CharacterOption::ShareFellowshipLoot => {
            CharacterOptionMask::Options1(CharacterOptions1::FELLOWSHIP_SHARE_LOOT)
        }
        CharacterOption::AutomaticallyAcceptFellowshipRequests => {
            CharacterOptionMask::Options1(CharacterOptions1::AUTO_ACCEPT_FELLOW_REQUEST)
        }
        CharacterOption::SideBySideVitals => {
            CharacterOptionMask::Options1(CharacterOptions1::SIDE_BY_SIDE_VITALS)
        }
        CharacterOption::ShowCoordinatesByTheRadar => {
            CharacterOptionMask::Options1(CharacterOptions1::COORDINATES_ON_RADAR)
        }
        CharacterOption::DisplaySpellDurations => {
            CharacterOptionMask::Options1(CharacterOptions1::SPELL_DURATION)
        }
        CharacterOption::DisableHouseRestrictionEffects => {
            CharacterOptionMask::Options1(CharacterOptions1::DISABLE_HOUSE_RESTRICTION_EFFECTS)
        }
        CharacterOption::DragItemToPlayerOpensTrade => {
            CharacterOptionMask::Options1(CharacterOptions1::DRAG_ITEM_ON_PLAYER_OPENS_SECURE_TRADE)
        }
        CharacterOption::ShowAllegianceLogons => {
            CharacterOptionMask::Options1(CharacterOptions1::DISPLAY_ALLEGIANCE_LOGON_NOTIFICATIONS)
        }
        CharacterOption::UseChargeAttack => {
            CharacterOptionMask::Options1(CharacterOptions1::USE_CHARGE_ATTACK)
        }
        CharacterOption::UseCraftingChanceOfSuccessDialog => {
            CharacterOptionMask::Options1(CharacterOptions1::USE_CRAFT_SUCCESS_DIALOG)
        }
        CharacterOption::ListenToAllegianceChat => {
            CharacterOptionMask::Options1(CharacterOptions1::HEAR_ALLEGIANCE_CHAT)
        }
        CharacterOption::AllowOthersToSeeYourDateOfBirth => {
            CharacterOptionMask::Options2(CharacterOptions2::DISPLAY_DATE_OF_BIRTH)
        }
        CharacterOption::AllowOthersToSeeYourAge => {
            CharacterOptionMask::Options2(CharacterOptions2::DISPLAY_AGE)
        }
        CharacterOption::AllowOthersToSeeYourChessRank => {
            CharacterOptionMask::Options2(CharacterOptions2::DISPLAY_CHESS_RANK)
        }
        CharacterOption::AllowOthersToSeeYourFishingSkill => {
            CharacterOptionMask::Options2(CharacterOptions2::DISPLAY_FISHING_SKILL)
        }
        CharacterOption::AllowOthersToSeeYourNumberOfDeaths => {
            CharacterOptionMask::Options2(CharacterOptions2::DISPLAY_NUMBER_DEATHS)
        }
        CharacterOption::DisplayTimestamps => {
            CharacterOptionMask::Options2(CharacterOptions2::TIME_STAMP)
        }
        CharacterOption::SalvageMultipleMaterialsAtOnce => {
            CharacterOptionMask::Options2(CharacterOptions2::SALVAGE_MULTIPLE)
        }
        CharacterOption::ListenToGeneralChat => {
            CharacterOptionMask::Options2(CharacterOptions2::HEAR_GENERAL_CHAT)
        }
        CharacterOption::ListenToTradeChat => {
            CharacterOptionMask::Options2(CharacterOptions2::HEAR_TRADE_CHAT)
        }
        CharacterOption::ListenToLFGChat => {
            CharacterOptionMask::Options2(CharacterOptions2::HEAR_LFG_CHAT)
        }
        CharacterOption::ListenToRoleplayChat => {
            CharacterOptionMask::Options2(CharacterOptions2::HEAR_ROLEPLAY_CHAT)
        }
        CharacterOption::AppearOffline => {
            CharacterOptionMask::Options2(CharacterOptions2::APPEAR_OFFLINE)
        }
        CharacterOption::AllowOthersToSeeYourNumberOfTitles => {
            CharacterOptionMask::Options2(CharacterOptions2::DISPLAY_NUMBER_CHARACTER_TITLES)
        }
        CharacterOption::UseMainPackAsDefaultForPickingUpItems => {
            CharacterOptionMask::Options2(CharacterOptions2::MAIN_PACK_PREFERRED)
        }
        CharacterOption::LeadMissileTargets => {
            CharacterOptionMask::Options2(CharacterOptions2::LEAD_MISSILE_TARGETS)
        }
        CharacterOption::UseFastMissiles => {
            CharacterOptionMask::Options2(CharacterOptions2::USE_FAST_MISSILES)
        }
        CharacterOption::FilterLanguage => {
            CharacterOptionMask::Options2(CharacterOptions2::FILTER_LANGUAGE)
        }
        CharacterOption::ConfirmUseOfRareGems => {
            CharacterOptionMask::Options2(CharacterOptions2::CONFIRM_VOLATILE_RARE_USE)
        }
        CharacterOption::ListenToSocietyChat => {
            CharacterOptionMask::Options2(CharacterOptions2::HEAR_SOCIETY_CHAT)
        }
        CharacterOption::ShowYourHelmOrHeadGear => {
            CharacterOptionMask::Options2(CharacterOptions2::SHOW_HELM)
        }
        CharacterOption::DisableDistanceFog => {
            CharacterOptionMask::Options2(CharacterOptions2::DISABLE_DISTANCE_FOG)
        }
        CharacterOption::UseMouseTurning => {
            CharacterOptionMask::Options2(CharacterOptions2::USE_MOUSE_TURNING)
        }
        CharacterOption::ShowYourCloak => {
            CharacterOptionMask::Options2(CharacterOptions2::SHOW_CLOAK)
        }
        CharacterOption::LockUI => CharacterOptionMask::Options2(CharacterOptions2::LOCK_UI),
        CharacterOption::ListenToPKDeathMessages => {
            CharacterOptionMask::Options2(CharacterOptions2::HEAR_PK_DEATH)
        }
        CharacterOption::CharacterOptions1Default => {
            CharacterOptionMask::Options1(CharacterOptions1::DEFAULT)
        }
        CharacterOption::CharacterOptions2Default => {
            CharacterOptionMask::Options2(CharacterOptions2::DEFAULT)
        }
    }
}

/// Session-local player model and derived player-facing state.
///
/// `PlayerState` owns player-specific data such as attributes, vitals, spells, inventory, and
/// protocol sequence tracking. It is intentionally **not** a second world object: authoritative
/// entity/object state lives on the player `Entity`, while `PlayerState` retains only local-player
/// overlays and session sequencing. Feature handlers under `crate::handlers` orchestrate message
/// flows and call into focused mutation methods on `PlayerState` and `WorldState`.
///
#[derive(Debug, Clone)]
pub struct PlayerState {
    /// Unique identifier for the player's character.
    pub guid: Guid,
    /// Computed attribute values (Strength, Endurance, etc.) including buffs.
    pub attributes: HashMap<stats::AttributeType, stats::Attribute>,
    /// Computed vital values (Health, Stamina, Mana) including current/max/buffed states.
    pub vitals: HashMap<stats::VitalType, stats::Vital>,
    /// Stores the raw ranks and start for vitals so they can be recalculated during stat updates.
    pub vital_bases: HashMap<stats::VitalType, VitalBase>,
    /// Computed skill values (Melee Defense, War Magic, etc.) including training level and buffs.
    pub skills: HashMap<stats::SkillType, stats::Skill>,
    /// Stores the raw ranks and init for skills so they can be recalculated during stat updates.
    pub skill_bases: HashMap<stats::SkillType, SkillBase>,
    /// Sequence for object instantiation/removal.
    pub instance_sequence: u16,
    /// Sequence for server-controlled movement/actions.
    pub server_control_sequence: u16,
    /// Last non-zero server-reported motion stance/style cached for outbound movement packets.
    pub last_server_motion_style: Option<MotionStance>,
    /// Sequence for teleportation events to ignore stale position updates.
    pub teleport_sequence: u16,
    /// Sequence for server-forced repositions (e.g. rubberbanding or physics corrections).
    pub force_position_sequence: u16,
    /// Sequence for client-initiated position updates.
    pub position_sequence: u16,
    /// Last grounded bit reported by authoritative self movement updates.
    pub last_server_grounded: Option<bool>,
    /// Monotonically increasing sequence for autonomous movement steps.
    pub movement_sequence: u16,
    /// Session-local private position overlays keyed by packet `PositionType`.
    pub local_position_overlays: HashMap<PositionType, holtburger_common::position::WorldPosition>,
    /// List of all active enchantments (buffs/debuffs) currently affecting the player.
    pub enchantments: Vec<Enchantment>,
    /// Master list of known spells (Knowledge). Maps SpellID -> Power/Modifier level.
    pub spells: BTreeMap<u32, f32>,
    /// Primary character option mask retained from PlayerDescription.
    pub options1: CharacterOptions1,
    /// Secondary character option mask retained from PlayerDescription.
    pub options2: CharacterOptions2,
    /// Content of the 8 spellbook hotbars (Organization). Each inner vec corresponds to a UI hotbar.
    pub hotbar_spells: Vec<Vec<u32>>,
    /// Desired material component counts retained from PlayerDescription.
    pub desired_comps: Vec<(u32, u32)>,
    /// Spellbook filter bitfield retained from PlayerDescription.
    pub spellbook_filters: u32,
    /// Opaque gameplay options blob retained from PlayerDescription.
    pub gameplay_options: Vec<u8>,

    /// Flat set of all item GUIDs currently owned by the player (in pack or containers).
    pub inventory: HashSet<Guid>,
    /// Items currently equipped, mapped by their primary slot mask.
    pub equipment: HashMap<Guid, EquipMask>,

    /// Dirty tracking for emitted derived-stat snapshots.
    pub(crate) last_emitted_derived_stats: Option<LastSentStats>,
}

impl Default for PlayerState {
    fn default() -> Self {
        Self::new()
    }
}

impl PlayerState {
    pub fn new() -> Self {
        Self {
            guid: Guid::NULL,
            attributes: HashMap::new(),
            vitals: HashMap::new(),
            vital_bases: HashMap::new(),
            skills: HashMap::new(),
            skill_bases: HashMap::new(),
            instance_sequence: 0,
            server_control_sequence: 0,
            last_server_motion_style: None,
            teleport_sequence: 0,
            force_position_sequence: 0,
            position_sequence: 0,
            last_server_grounded: None,
            movement_sequence: 0,
            local_position_overlays: HashMap::new(),
            enchantments: Vec::new(),
            spells: BTreeMap::new(),
            options1: CharacterOptions1::empty(),
            options2: CharacterOptions2::empty(),
            hotbar_spells: vec![Vec::new(); 8],
            desired_comps: Vec::new(),
            spellbook_filters: 0,
            gameplay_options: Vec::new(),
            inventory: HashSet::new(),
            equipment: HashMap::new(),
            last_emitted_derived_stats: None,
        }
    }

    pub fn vitae(&self) -> f32 {
        crate::magic::get_total_vitae(&self.enchantments)
    }

    pub fn local_position_overlay(
        &self,
        position_type: PositionType,
    ) -> Option<holtburger_common::position::WorldPosition> {
        self.local_position_overlays.get(&position_type).copied()
    }

    pub fn set_local_position_overlay(
        &mut self,
        position_type: PositionType,
        position: holtburger_common::position::WorldPosition,
    ) {
        self.local_position_overlays.insert(position_type, position);
    }
}

impl PlayerState {
    /// Adds an item to the player's inventory tracking.
    pub fn add_to_inventory(&mut self, item: Guid) {
        self.inventory.insert(item);
    }

    /// Removes an item from the player's inventory tracking and equipment.
    pub fn remove_from_inventory(&mut self, item: Guid) {
        self.inventory.remove(&item);
        self.equipment.remove(&item);
    }

    /// Marks an item as equipped.
    pub fn wield_item(&mut self, item: Guid, slot: EquipMask) {
        self.inventory.insert(item);
        self.equipment.insert(item, slot);
    }

    /// Marks an item as unequipped.
    pub fn unwield_item(&mut self, item: Guid) {
        self.equipment.remove(&item);
    }

    pub fn attribute_snapshot(&self) -> Vec<stats::Attribute> {
        let mut attr_objs: Vec<_> = self.attributes.values().cloned().collect();
        attr_objs.sort_by_key(|a| a.attr_type as u32);
        attr_objs
    }

    pub fn vital_snapshot(&self) -> Vec<stats::Vital> {
        let mut vitals: Vec<_> = self.vitals.values().cloned().collect();
        vitals.sort_by_key(|v| v.vital_type as u32);
        vitals
    }

    pub fn skill_snapshot(&self) -> Vec<stats::Skill> {
        let mut skills: Vec<_> = self.skills.values().cloned().collect();
        skills.sort_by_key(|s| s.skill_type as u32);
        skills
    }

    pub fn character_option_enabled(&self, option: CharacterOption) -> bool {
        match character_option_mask(option) {
            CharacterOptionMask::Options1(flag) => self.options1.contains(flag),
            CharacterOptionMask::Options2(flag) => self.options2.contains(flag),
        }
    }

    pub fn set_character_option_enabled(&mut self, option: CharacterOption, enabled: bool) {
        match character_option_mask(option) {
            CharacterOptionMask::Options1(flag) => {
                self.options1.set(flag, enabled);
            }
            CharacterOptionMask::Options2(flag) => {
                self.options2.set(flag, enabled);
            }
        }
    }
}
