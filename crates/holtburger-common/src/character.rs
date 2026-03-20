use bitflags::bitflags;
use serde::{Deserialize, Serialize};
use strum_macros::{Display, FromRepr};

bitflags! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, Default)]
    pub struct CharacterOptions1: u32 {
        const NONE = 0x00000000;
        const NOT_USED1 = 0x00000001;
        const AUTO_REPEAT_ATTACK = 0x00000002;
        const IGNORE_ALLEGIANCE_REQUESTS = 0x00000004;
        const IGNORE_FELLOWSHIP_REQUESTS = 0x00000008;
        const NOT_USED2 = 0x00000010;
        const NOT_USED3 = 0x00000020;
        const ALLOW_GIVE = 0x00000040;
        const VIEW_COMBAT_TARGET = 0x00000080;
        const SHOW_TOOLTIPS = 0x00000100;
        const USE_DECEPTION = 0x00000200;
        const TOGGLE_RUN = 0x00000400;
        const STAY_IN_CHAT_MODE = 0x00000800;
        const ADVANCED_COMBAT_UI = 0x00001000;
        const AUTO_TARGET = 0x00002000;
        const NOT_USED4 = 0x00004000;
        const VIVID_TARGETING_INDICATOR = 0x00008000;
        const DISABLE_MOST_WEATHER_EFFECTS = 0x00010000;
        const IGNORE_TRADE_REQUESTS = 0x00020000;
        const FELLOWSHIP_SHARE_XP = 0x00040000;
        const ACCEPT_LOOT_PERMITS = 0x00080000;
        const FELLOWSHIP_SHARE_LOOT = 0x00100000;
        const SIDE_BY_SIDE_VITALS = 0x00200000;
        const COORDINATES_ON_RADAR = 0x00400000;
        const SPELL_DURATION = 0x00800000;
        const NOT_USED5 = 0x01000000;
        const DISABLE_HOUSE_RESTRICTION_EFFECTS = 0x02000000;
        const DRAG_ITEM_ON_PLAYER_OPENS_SECURE_TRADE = 0x04000000;
        const DISPLAY_ALLEGIANCE_LOGON_NOTIFICATIONS = 0x08000000;
        const USE_CHARGE_ATTACK = 0x10000000;
        const AUTO_ACCEPT_FELLOW_REQUEST = 0x20000000;
        const HEAR_ALLEGIANCE_CHAT = 0x40000000;
        const USE_CRAFT_SUCCESS_DIALOG = 0x80000000;
        const DEFAULT = Self::AUTO_REPEAT_ATTACK.bits()
            | Self::IGNORE_FELLOWSHIP_REQUESTS.bits()
            | Self::ALLOW_GIVE.bits()
            | Self::SHOW_TOOLTIPS.bits()
            | Self::TOGGLE_RUN.bits()
            | Self::AUTO_TARGET.bits()
            | Self::VIVID_TARGETING_INDICATOR.bits()
            | Self::FELLOWSHIP_SHARE_XP.bits()
            | Self::COORDINATES_ON_RADAR.bits()
            | Self::SPELL_DURATION.bits()
            | Self::USE_CHARGE_ATTACK.bits()
            | Self::HEAR_ALLEGIANCE_CHAT.bits();
    }
}

bitflags! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, Default)]
    pub struct CharacterOptions2: u32 {
        const NONE = 0x00000000;
        const PERSISTENT_AT_DAY = 0x00000001;
        const DISPLAY_DATE_OF_BIRTH = 0x00000002;
        const DISPLAY_CHESS_RANK = 0x00000004;
        const DISPLAY_FISHING_SKILL = 0x00000008;
        const DISPLAY_NUMBER_DEATHS = 0x00000010;
        const DISPLAY_AGE = 0x00000020;
        const TIME_STAMP = 0x00000040;
        const SALVAGE_MULTIPLE = 0x00000080;
        const HEAR_GENERAL_CHAT = 0x00000100;
        const HEAR_TRADE_CHAT = 0x00000200;
        const HEAR_LFG_CHAT = 0x00000400;
        const HEAR_ROLEPLAY_CHAT = 0x00000800;
        const APPEAR_OFFLINE = 0x00001000;
        const DISPLAY_NUMBER_CHARACTER_TITLES = 0x00002000;
        const MAIN_PACK_PREFERRED = 0x00004000;
        const LEAD_MISSILE_TARGETS = 0x00008000;
        const USE_FAST_MISSILES = 0x00010000;
        const FILTER_LANGUAGE = 0x00020000;
        const CONFIRM_VOLATILE_RARE_USE = 0x00040000;
        const HEAR_SOCIETY_CHAT = 0x00080000;
        const SHOW_HELM = 0x00100000;
        const DISABLE_DISTANCE_FOG = 0x00200000;
        const USE_MOUSE_TURNING = 0x00400000;
        const SHOW_CLOAK = 0x00800000;
        const LOCK_UI = 0x01000000;
        const HEAR_PK_DEATH = 0x02000000;
        const NOT_USED1 = 0x04000000;
        const NOT_USED2 = 0x08000000;
        const NOT_USED3 = 0x10000000;
        const NOT_USED4 = 0x20000000;
        const NOT_USED5 = 0x40000000;
        const NOT_USED6 = 0x80000000;
        const DEFAULT = Self::HEAR_GENERAL_CHAT.bits()
            | Self::HEAR_TRADE_CHAT.bits()
            | Self::HEAR_LFG_CHAT.bits()
            | Self::LEAD_MISSILE_TARGETS.bits()
            | Self::CONFIRM_VOLATILE_RARE_USE.bits()
            | Self::SHOW_HELM.bits()
            | Self::SHOW_CLOAK.bits();
    }
}

#[repr(u32)]
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    PartialOrd,
    Ord,
    Hash,
    Serialize,
    Deserialize,
    Display,
    FromRepr,
)]
pub enum CharacterOption {
    AutoRepeatAttacks = 0x00,
    IgnoreAllegianceRequests = 0x01,
    IgnoreFellowshipRequests = 0x02,
    IgnoreAllTradeRequests = 0x03,
    DisableMostWeatherEffects = 0x04,
    AlwaysDaylightOutdoors = 0x05,
    LetOtherPlayersGiveYouItems = 0x06,
    KeepCombatTargetsInView = 0x07,
    Display3dTooltips = 0x08,
    AttemptToDeceiveOtherPlayers = 0x09,
    RunAsDefaultMovement = 0x0A,
    StayInChatModeAfterSendingMessage = 0x0B,
    AdvancedCombatInterface = 0x0C,
    AutoTarget = 0x0D,
    VividTargetingIndicator = 0x0E,
    ShareFellowshipExpAndLuminance = 0x0F,
    AcceptCorpseLootingPermissions = 0x10,
    ShareFellowshipLoot = 0x11,
    AutomaticallyAcceptFellowshipRequests = 0x12,
    SideBySideVitals = 0x13,
    ShowCoordinatesByTheRadar = 0x14,
    DisplaySpellDurations = 0x15,
    DisableHouseRestrictionEffects = 0x16,
    DragItemToPlayerOpensTrade = 0x17,
    ShowAllegianceLogons = 0x18,
    UseChargeAttack = 0x19,
    UseCraftingChanceOfSuccessDialog = 0x1A,
    ListenToAllegianceChat = 0x1B,
    AllowOthersToSeeYourDateOfBirth = 0x1C,
    AllowOthersToSeeYourAge = 0x1D,
    AllowOthersToSeeYourChessRank = 0x1E,
    AllowOthersToSeeYourFishingSkill = 0x1F,
    AllowOthersToSeeYourNumberOfDeaths = 0x20,
    DisplayTimestamps = 0x21,
    SalvageMultipleMaterialsAtOnce = 0x22,
    ListenToGeneralChat = 0x23,
    ListenToTradeChat = 0x24,
    ListenToLFGChat = 0x25,
    ListenToRoleplayChat = 0x26,
    AppearOffline = 0x27,
    AllowOthersToSeeYourNumberOfTitles = 0x28,
    UseMainPackAsDefaultForPickingUpItems = 0x29,
    LeadMissileTargets = 0x2A,
    UseFastMissiles = 0x2B,
    FilterLanguage = 0x2C,
    ConfirmUseOfRareGems = 0x2D,
    ListenToSocietyChat = 0x2E,
    ShowYourHelmOrHeadGear = 0x2F,
    DisableDistanceFog = 0x30,
    UseMouseTurning = 0x31,
    ShowYourCloak = 0x32,
    LockUI = 0x33,
    ListenToPKDeathMessages = 0x34,
    CharacterOptions1Default = 0x35,
    CharacterOptions2Default = 0x36,
}

#[repr(u32)]
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    PartialOrd,
    Ord,
    Hash,
    Serialize,
    Deserialize,
    Display,
    FromRepr,
)]
pub enum ConfirmationType {
    Undefined = 0x00,
    SwearAllegiance = 0x01,
    AlterSkill = 0x02,
    AlterAttribute = 0x03,
    Fellowship = 0x04,
    CraftInteraction = 0x05,
    Augmentation = 0x06,
    YesNo = 0x07,
}
