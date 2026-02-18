use crate::Guid;
use bitflags::bitflags;
use serde::{Deserialize, Serialize};
use strum_macros::{Display, FromRepr};

#[derive(Debug, Clone, Copy, PartialEq, Eq, FromRepr, Display)]
#[repr(u32)]
pub enum PropertyBool {
    Undef = 0,
    Stuck = 1,
    Open = 2,
    Locked = 3,
    RotProof = 4,
    AllegianceUpdateRequest = 5,
    AiUsesMana = 6,
    AiUseHumanMagicAnimations = 7,
    AllowGive = 8,
    CurrentlyAttacking = 9,
    AttackerAi = 10,
    IgnoreCollisions = 11,
    ReportCollisions = 12,
    Ethereal = 13,
    GravityStatus = 14,
    LightsStatus = 15,
    ScriptedCollision = 16,
    Inelastic = 17,
    Visibility = 18,
    Attackable = 19,
    SafeSpellComponents = 20,
    AdvocateState = 21,
    Inscribable = 22,
    DestroyOnSell = 23,
    UiHidden = 24,
    IgnoreHouseBarriers = 25,
    HiddenAdmin = 26,
    PkWounder = 27,
    PkKiller = 28,
    NoCorpse = 29,
    UnderLifestoneProtection = 30,
    ItemManaUpdatePending = 31,
    GeneratorStatus = 32,
    ResetMessagePending = 33,
    DefaultOpen = 34,
    DefaultLocked = 35,
    DefaultOn = 36,
    OpenForBusiness = 37,
    IsFrozen = 38,
    DealMagicalItems = 39,
    LogoffImDead = 40,
    ReportCollisionsAsEnvironment = 41,
    AllowEdgeSlide = 42,
    AdvocateQuest = 43,
    IsAdmin = 44,
    IsArch = 45,
    IsSentinel = 46,
    IsAdvocate = 47,
    CurrentlyPoweringUp = 48,
    GeneratorEnteredWorld = 49,
    NeverFailCasting = 50,
    VendorService = 51,
    AiImmobile = 52,
    DamagedByCollisions = 53,
    IsDynamic = 54,
    IsHot = 55,
    IsAffecting = 56,
    AffectsAis = 57,
    SpellQueueActive = 58,
    GeneratorDisabled = 59,
    IsAcceptingTells = 60,
    LoggingChannel = 61,
    OpensAnyLock = 62,
    UnlimitedUse = 63,
    GeneratedTreasureItem = 64,
    IgnoreMagicResist = 65,
    IgnoreMagicArmor = 66,
    AiAllowTrade = 67,
    SpellComponentsRequired = 68,
    IsSellable = 69,
    IgnoreShieldsBySkill = 70,
    NoDraw = 71,
    ActivationUntargeted = 72,
    HouseHasGottenPriorityBootPos = 73,
    GeneratorAutomaticDestruction = 74,
    HouseHooksVisible = 75,
    HouseRequiresMonarch = 76,
    HouseHooksEnabled = 77,
    HouseNotifiedHudOfHookCount = 78,
    AiAcceptEverything = 79,
    IgnorePortalRestrictions = 80,
    RequiresBackpackSlot = 81,
    DontTurnOrMoveWhenGiving = 82,
    NpcLooksLikeObject = 83,
    IgnoreCloIcons = 84,
    AppraisalHasAllowedWielder = 85,
    ChestRegenOnClose = 86,
    LogoffInMinigame = 87,
    PortalShowDestination = 88,
    PortalIgnoresPkAttackTimer = 89,
    NpcInteractsSilently = 90,
    Retained = 91,
    IgnoreAuthor = 92,
    Limbo = 93,
    AppraisalHasAllowedActivator = 94,
    ExistedBeforeAllegianceXpChanges = 95,
    IsDeaf = 96,
    IsPsr = 97,
    Invincible = 98,
    Ivoryable = 99,
    Dyable = 100,
    CanGenerateRare = 101,
    CorpseGeneratedRare = 102,
    NonProjectileMagicImmune = 103,
    ActdReceivedItems = 104,
    Unknown105 = 105,
    FirstEnterWorldDone = 106,
    RecallsDisabled = 107,
    RareUsesTimer = 108,
    ActdPreorderReceivedItems = 109,
    Afk = 110,
    IsGagged = 111,
    ProcSpellSelfTargeted = 112,
    IsAllegianceGagged = 113,
    EquipmentSetTriggerPiece = 114,
    Uninscribe = 115,
    WieldOnUse = 116,
    ChestClearedWhenClosed = 117,
    NeverAttack = 118,
    SuppressGenerateEffect = 119,
    TreasureCorpse = 120,
    EquipmentSetAddLevel = 121,
    BarberActive = 122,
    TopLayerPriority = 123,
    NoHeldItemShown = 124,
    LoginAtLifestone = 125,
    OlthoiPk = 126,
    Account15Days = 127,
    HadNoVitae = 128,
    NoOlthoiTalk = 129,
    AutowieldLeft = 130,
    LinkedPortalOneSummon = 9001,
    LinkedPortalTwoSummon = 9002,
    HouseEvicted = 9003,
    UntrainedSkills = 9004,
    IsEnvoy = 9005,
    UnspecializedSkills = 9006,
    FreeSkillResetRenewed = 9007,
    FreeAttributeResetRenewed = 9008,
    SkillTemplesTimerReset = 9009,
    FreeMasteryResetRenewed = 9010,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, FromRepr, Display)]
#[repr(u32)]
pub enum PropertyInt {
    Undef = 0,
    ItemType = 1,
    CreatureType = 2,
    PaletteTemplate = 3,
    ClothingPriority = 4,
    EncumbranceVal = 5,
    ItemsCapacity = 6,
    ContainersCapacity = 7,
    Mass = 8,
    ValidLocations = 9,
    CurrentWieldedLocation = 10,
    MaxStackSize = 11,
    StackSize = 12,
    StackUnitEncumbrance = 13,
    StackUnitMass = 14,
    StackUnitValue = 15,
    ItemUseable = 16,
    RareId = 17,
    UiEffects = 18,
    Value = 19,
    CoinValue = 20,
    TotalExperience = 21,
    AvailableCharacter = 22,
    TotalSkillCredits = 23,
    AvailableSkillCredits = 24,
    Level = 25,
    AccountRequirements = 26,
    ArmorType = 27,
    ArmorLevel = 28,
    AllegianceCpPool = 29,
    AllegianceRank = 30,
    ChannelsAllowed = 31,
    ChannelsActive = 32,
    Bonded = 33,
    MonarchsRank = 34,
    AllegianceFollowers = 35,
    ResistMagic = 36,
    ResistItemAppraisal = 37,
    ResistLockpick = 38,
    DeprecatedResistRepair = 39,
    CombatMode = 40,
    CurrentAttackHeight = 41,
    CombatCollisions = 42,
    NumDeaths = 43,
    Damage = 44,
    DamageType = 45,
    DefaultCombatStyle = 46,
    AttackType = 47,
    WeaponSkill = 48,
    WeaponTime = 49,
    AmmoType = 50,
    CombatUse = 51,
    ParentLocation = 52,
    PlacementPosition = 53,
    WeaponEncumbrance = 54,
    WeaponMass = 55,
    ShieldValue = 56,
    ShieldEncumbrance = 57,
    MissileInventoryLocation = 58,
    FullDamageType = 59,
    WeaponRange = 60,
    AttackersSkill = 61,
    DefendersSkill = 62,
    AttackersSkillValue = 63,
    AttackersClass = 64,
    Placement = 65,
    CheckpointStatus = 66,
    Tolerance = 67,
    TargetingTactic = 68,
    CombatTactic = 69,
    HomesickTargetingTactic = 70,
    NumFollowFailures = 71,
    FriendType = 72,
    FoeType = 73,
    MerchandiseItemTypes = 74,
    MerchandiseMinValue = 75,
    MerchandiseMaxValue = 76,
    NumItemsSold = 77,
    NumItemsBought = 78,
    MoneyIncome = 79,
    MoneyOutflow = 80,
    MaxGeneratedObjects = 81,
    InitGeneratedObjects = 82,
    ActivationResponse = 83,
    OriginalValue = 84,
    NumMoveFailures = 85,
    MinLevel = 86,
    MaxLevel = 87,
    LockpickMod = 88,
    BoosterEnum = 89,
    BoostValue = 90,
    MaxStructure = 91,
    Structure = 92,
    PhysicsState = 93,
    TargetType = 94,
    RadarBlipColor = 95,
    EncumbranceCapacity = 96,
    LoginTimestamp = 97,
    CreationTimestamp = 98,
    PkLevelModifier = 99,
    GeneratorType = 100,
    AiAllowedCombatStyle = 101,
    LogoffTimestamp = 102,
    GeneratorDestructionType = 103,
    ActivationCreateClass = 104,
    ItemWorkmanship = 105,
    ItemSpellcraft = 106,
    ItemCurMana = 107,
    ItemMaxMana = 108,
    ItemDifficulty = 109,
    ItemAllegianceRankLimit = 110,
    PortalBitmask = 111,
    AdvocateLevel = 112,
    Gender = 113,
    Attuned = 114,
    ItemSkillLevelLimit = 115,
    GateLogic = 116,
    ItemManaCost = 117,
    Logoff = 118,
    Active = 119,
    AttackHeight = 120,
    NumAttackFailures = 121,
    AiCpThreshold = 122,
    AiAdvancementStrategy = 123,
    Version = 124,
    Age = 125,
    VendorHappyMean = 126,
    VendorHappyVariance = 127,
    CloakStatus = 128,
    VitaeCpPool = 129,
    NumServicesSold = 130,
    MaterialType = 131,
    NumAllegianceBreaks = 132,
    ShowableOnRadar = 133,
    PlayerKillerStatus = 134,
    VendorHappyMaxItems = 135,
    ScorePageNum = 136,
    ScoreConfigNum = 137,
    ScoreNumScores = 138,
    DeathLevel = 139,
    AiOptions = 140,
    OpenToEveryone = 141,
    GeneratorTimeType = 142,
    GeneratorStartTime = 143,
    GeneratorEndTime = 144,
    GeneratorEndDestructionType = 145,
    XpOverride = 146,
    NumCrashAndTurns = 147,
    ComponentWarningThreshold = 148,
    HouseStatus = 149,
    HookPlacement = 150,
    HookType = 151,
    HookItemType = 152,
    AiPpThreshold = 153,
    GeneratorVersion = 154,
    HouseType = 155,
    PickupEmoteOffset = 156,
    WeenieIteration = 157,
    WieldRequirements = 158,
    WieldSkillType = 159,
    WieldDifficulty = 160,
    HouseMaxHooksUsable = 161,
    HouseCurrentHooksUsable = 162,
    AllegianceMinLevel = 163,
    AllegianceMaxLevel = 164,
    HouseRelinkHookCount = 165,
    SlayerCreatureType = 166,
    ConfirmationInProgress = 167,
    ConfirmationTypeInProgress = 168,
    TsysMutationData = 169,
    NumItemsInMaterial = 170,
    NumTimesTinkered = 171,
    AppraisalLongDescDecoration = 172,
    AppraisalLockpickSuccessPercent = 173,
    AppraisalPages = 174,
    AppraisalMaxPages = 175,
    AppraisalItemSkill = 176,
    GemCount = 177,
    GemType = 178,
    ImbuedEffect = 179,
    AttackersRawSkillValue = 180,
    ChessRank = 181,
    ChessTotalGames = 182,
    ChessGamesWon = 183,
    ChessGamesLost = 184,
    TypeOfAlteration = 185,
    SkillToBeAltered = 186,
    SkillAlterationCount = 187,
    HeritageGroup = 188,
    TransferFromAttribute = 189,
    TransferToAttribute = 190,
    AttributeTransferCount = 191,
    FakeFishingSkill = 192,
    NumKeys = 193,
    DeathTimestamp = 194,
    PkTimestamp = 195,
    VictimTimestamp = 196,
    HookGroup = 197,
    AllegianceSwearTimestamp = 198,
    HousePurchaseTimestamp = 199,
    RedirectableEquippedArmorCount = 200,
    MeleeDefenseImbuedEffectTypeCache = 201,
    MissileDefenseImbuedEffectTypeCache = 202,
    MagicDefenseImbuedEffectTypeCache = 203,
    ElementalDamageBonus = 204,
    ImbueAttempts = 205,
    ImbueSuccesses = 206,
    CreatureKills = 207,
    PlayerKillsPk = 208,
    PlayerKillsPkl = 209,
    RaresTierOne = 210,
    RaresTierTwo = 211,
    RaresTierThree = 212,
    RaresTierFour = 213,
    RaresTierFive = 214,
    AugmentationStat = 215,
    AugmentationFamilyStat = 216,
    AugmentationInnateFamily = 217,
    AugmentationInnateStrength = 218,
    AugmentationInnateEndurance = 219,
    AugmentationInnateCoordination = 220,
    AugmentationInnateQuickness = 221,
    AugmentationInnateFocus = 222,
    AugmentationInnateSelf = 223,
    AugmentationSpecializeSalvaging = 224,
    AugmentationSpecializeItemTinkering = 225,
    AugmentationSpecializeArmorTinkering = 226,
    AugmentationSpecializeMagicItemTinkering = 227,
    AugmentationSpecializeWeaponTinkering = 228,
    AugmentationExtraPackSlot = 229,
    AugmentationIncreasedCarryingCapacity = 230,
    AugmentationLessDeathItemLoss = 231,
    AugmentationSpellsRemainPastDeath = 232,
    AugmentationCriticalDefense = 233,
    AugmentationBonusXp = 234,
    AugmentationBonusSalvage = 235,
    AugmentationBonusImbueChance = 236,
    AugmentationFasterRegen = 237,
    AugmentationIncreasedSpellDuration = 238,
    AugmentationResistanceFamily = 239,
    AugmentationResistanceSlash = 240,
    AugmentationResistancePierce = 241,
    AugmentationResistanceBlunt = 242,
    AugmentationResistanceAcid = 243,
    AugmentationResistanceFire = 244,
    AugmentationResistanceFrost = 245,
    AugmentationResistanceLightning = 246,
    RaresTierOneLogin = 247,
    RaresTierTwoLogin = 248,
    RaresTierThreeLogin = 249,
    RaresTierFourLogin = 250,
    RaresTierFiveLogin = 251,
    RaresLoginTimestamp = 252,
    RaresTierSix = 253,
    RaresTierSeven = 254,
    RaresTierSixLogin = 255,
    RaresTierSevenLogin = 256,
    ItemAttributeLimit = 257,
    ItemAttributeLevelLimit = 258,
    ItemAttribute2ndLimit = 259,
    ItemAttribute2ndLevelLimit = 260,
    CharacterTitleId = 261,
    NumCharacterTitles = 262,
    ResistanceModifierType = 263,
    FreeTinkersBitfield = 264,
    EquipmentSetId = 265,
    PetClass = 266,
    Lifespan = 267,
    RemainingLifespan = 268,
    UseCreateQuantity = 269,
    WieldRequirements2 = 270,
    WieldSkillType2 = 271,
    WieldDifficulty2 = 272,
    WieldRequirements3 = 273,
    WieldSkillType3 = 274,
    WieldDifficulty3 = 275,
    WieldRequirements4 = 276,
    WieldSkillType4 = 277,
    WieldDifficulty4 = 278,
    Unique = 279,
    SharedCooldown = 280,
    Faction1Bits = 281,
    Faction2Bits = 282,
    Faction3Bits = 283,
    Hatred1Bits = 284,
    Hatred2Bits = 285,
    Hatred3Bits = 286,
    SocietyRankCelhan = 287,
    SocietyRankEldweb = 288,
    SocietyRankRadblo = 289,
    HearLocalSignals = 290,
    HearLocalSignalsRadius = 291,
    Cleaving = 292,
    AugmentationSpecializeGearcraft = 293,
    AugmentationInfusedCreatureMagic = 294,
    AugmentationInfusedItemMagic = 295,
    AugmentationInfusedLifeMagic = 296,
    AugmentationInfusedWarMagic = 297,
    AugmentationCriticalExpertise = 298,
    AugmentationCriticalPower = 299,
    AugmentationSkilledMelee = 300,
    AugmentationSkilledMissile = 301,
    AugmentationSkilledMagic = 302,
    ImbuedEffect2 = 303,
    ImbuedEffect3 = 304,
    ImbuedEffect4 = 305,
    ImbuedEffect5 = 306,
    DamageRating = 307,
    DamageResistRating = 308,
    AugmentationDamageBonus = 309,
    AugmentationDamageReduction = 310,
    ImbueStackingBits = 311,
    HealOverTime = 312,
    CritRating = 313,
    CritDamageRating = 314,
    CritResistRating = 315,
    CritDamageResistRating = 316,
    HealingResistRating = 317,
    DamageOverTime = 318,
    ItemMaxLevel = 319,
    ItemXpStyle = 320,
    EquipmentSetExtra = 321,
    AetheriaBitfield = 322,
    HealingBoostRating = 323,
    HeritageSpecificArmor = 324,
    AlternateRacialSkills = 325,
    AugmentationJackOfAllTrades = 326,
    AugmentationResistanceNether = 327,
    AugmentationInfusedVoidMagic = 328,
    WeaknessRating = 329,
    NetherOverTime = 330,
    NetherResistRating = 331,
    LuminanceAward = 332,
    LumAugDamageRating = 333,
    LumAugDamageReductionRating = 334,
    LumAugCritDamageRating = 335,
    LumAugCritReductionRating = 336,
    LumAugSurgeEffectRating = 337,
    LumAugSurgeChanceRating = 338,
    LumAugItemManaUsage = 339,
    LumAugItemManaGain = 340,
    LumAugVitality = 341,
    LumAugHealingRating = 342,
    LumAugSkilledCraft = 343,
    LumAugSkilledSpec = 344,
    LumAugNoDestroyCraft = 345,
    RestrictInteraction = 346,
    OlthoiLootTimestamp = 347,
    OlthoiLootStep = 348,
    UseCreatesContractId = 349,
    DotResistRating = 350,
    LifeResistRating = 351,
    CloakWeaveProc = 352,
    WeaponType = 353,
    MeleeMastery = 354,
    RangedMastery = 355,
    SneakAttackRating = 356,
    RecklessnessRating = 357,
    DeceptionRating = 358,
    CombatPetRange = 359,
    WeaponAuraDamage = 360,
    WeaponAuraSpeed = 361,
    SummoningMastery = 362,
    HeartbeatLifespan = 363,
    UseLevelRequirement = 364,
    LumAugAllSkills = 365,
    UseRequiresSkill = 366,
    UseRequiresSkillLevel = 367,
    UseRequiresSkillSpec = 368,
    UseRequiresLevel = 369,
    GearDamage = 370,
    GearDamageResist = 371,
    GearCrit = 372,
    GearCritResist = 373,
    GearCritDamage = 374,
    GearCritDamageResist = 375,
    GearHealingBoost = 376,
    GearNetherResist = 377,
    GearLifeResist = 378,
    GearMaxHealth = 379,
    Unknown380 = 380,
    PkDamageRating = 381,
    PkDamageResistRating = 382,
    GearPkDamageRating = 383,
    GearPkDamageResistRating = 384,
    Unknown385 = 385,
    Overpower = 386,
    OverpowerResist = 387,
    GearOverpower = 388,
    GearOverpowerResist = 389,
    Enlightenment = 390,
    PcapRecordedAutonomousMovement = 8007,
    PcapRecordedMaxVelocityEstimated = 8030,
    PcapRecordedPlacement = 8041,
    PcapRecordedAppraisalPages = 8042,
    PcapRecordedAppraisalMaxPages = 8043,
    CurrentLoyaltyAtLastLogoff = 9008,
    CurrentLeadershipAtLastLogoff = 9009,
    AllegianceOfficerRank = 9010,
    HouseRentTimestamp = 9011,
    Hairstyle = 9012,
    VisualClothingPriority = 9013,
    SquelchGlobal = 9014,
    InventoryOrder = 9015,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, FromRepr, Display)]
#[repr(u32)]
pub enum PropertyInt64 {
    Undef = 0,
    TotalExperience = 1,
    AvailableExperience = 2,
    AugmentationCost = 3,
    ItemTotalXp = 4,
    ItemBaseXp = 5,
    AvailableLuminance = 6,
    MaximumLuminance = 7,
    InteractionReqs = 8,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, FromRepr, Display)]
#[repr(u32)]
pub enum PropertyFloat {
    Undef = 0,
    HeartbeatInterval = 1,
    HeartbeatTimestamp = 2,
    HealthRate = 3,
    StaminaRate = 4,
    ManaRate = 5,
    HealthUponResurrection = 6,
    StaminaUponResurrection = 7,
    ManaUponResurrection = 8,
    StartTime = 9,
    StopTime = 10,
    ResetInterval = 11,
    Shade = 12,
    ArmorModVsSlash = 13,
    ArmorModVsPierce = 14,
    ArmorModVsBludgeon = 15,
    ArmorModVsCold = 16,
    ArmorModVsFire = 17,
    ArmorModVsAcid = 18,
    ArmorModVsElectric = 19,
    CombatSpeed = 20,
    WeaponLength = 21,
    DamageVariance = 22,
    CurrentPowerMod = 23,
    AccuracyMod = 24,
    StrengthMod = 25,
    MaximumVelocity = 26,
    RotationSpeed = 27,
    MotionTimestamp = 28,
    WeaponDefense = 29,
    WimpyLevel = 30,
    VisualAwarenessRange = 31,
    AuralAwarenessRange = 32,
    PerceptionLevel = 33,
    PowerupTime = 34,
    MaxChargeDistance = 35,
    ChargeSpeed = 36,
    BuyPrice = 37,
    SellPrice = 38,
    DefaultScale = 39,
    LockpickMod = 40,
    RegenerationInterval = 41,
    RegenerationTimestamp = 42,
    GeneratorRadius = 43,
    TimeToRot = 44,
    DeathTimestamp = 45,
    PkTimestamp = 46,
    VictimTimestamp = 47,
    LoginTimestamp = 48,
    CreationTimestamp = 49,
    MinimumTimeSincePk = 50,
    AbuseLoggingTimestamp = 52,
    LastPortalTeleportTimestamp = 53,
    UseRadius = 54,
    HomeRadius = 55,
    ReleasedTimestamp = 56,
    MinHomeRadius = 57,
    Facing = 58,
    ResetTimestamp = 59,
    LogoffTimestamp = 60,
    EconRecoveryInterval = 61,
    WeaponOffense = 62,
    DamageMod = 63,
    ResistSlash = 64,
    ResistPierce = 65,
    ResistBludgeon = 66,
    ResistFire = 67,
    ResistCold = 68,
    ResistAcid = 69,
    ResistElectric = 70,
    ResistHealthBoost = 71,
    ResistStaminaDrain = 72,
    ResistStaminaBoost = 73,
    ResistManaDrain = 74,
    ResistManaBoost = 75,
    Translucency = 76,
    PhysicsScriptIntensity = 77,
    Friction = 78,
    Elasticity = 79,
    AiUseMagicDelay = 80,
    ItemMinSpellcraftMod = 81,
    ItemMaxSpellcraftMod = 82,
    ItemRankProbability = 83,
    Shade2 = 84,
    Shade3 = 85,
    Shade4 = 86,
    ItemEfficiency = 87,
    ItemManaUpdateTimestamp = 88,
    SpellGestureSpeedMod = 89,
    SpellStanceSpeedMod = 90,
    AllegianceAppraisalTimestamp = 91,
    PowerLevel = 92,
    AccuracyLevel = 93,
    AttackAngle = 94,
    AttackTimestamp = 95,
    CheckpointTimestamp = 96,
    SoldTimestamp = 97,
    UseTimestamp = 98,
    UseLockTimestamp = 99,
    HealkitMod = 100,
    FrozenTimestamp = 101,
    HealthRateMod = 102,
    AllegianceSwearTimestamp = 103,
    ObviousRadarRange = 104,
    HotspotCycleTime = 105,
    HotspotCycleTimeVariance = 106,
    SpamTimestamp = 107,
    SpamRate = 108,
    BondWieldedTreasure = 109,
    BulkMod = 110,
    SizeMod = 111,
    GagTimestamp = 112,
    GeneratorUpdateTimestamp = 113,
    DeathSpamTimestamp = 114,
    DeathSpamRate = 115,
    WildAttackProbability = 116,
    FocusedProbability = 117,
    CrashAndTurnProbability = 118,
    CrashAndTurnRadius = 119,
    CrashAndTurnBias = 120,
    GeneratorInitialDelay = 121,
    AiAcquireHealth = 122,
    AiAcquireStamina = 123,
    AiAcquireMana = 124,
    ResistHealthDrain = 125,
    LifestoneProtectionTimestamp = 126,
    AiCounteractEnchantment = 127,
    AiDispelEnchantment = 128,
    TradeTimestamp = 129,
    AiTargetedDetectionRadius = 130,
    EmotePriority = 131,
    LastTeleportStartTimestamp = 132,
    EventSpamTimestamp = 133,
    EventSpamRate = 134,
    InventoryOffset = 135,
    CriticalMultiplier = 136,
    ManaStoneDestroyChance = 137,
    SlayerDamageBonus = 138,
    AllegianceInfoSpamTimestamp = 139,
    AllegianceInfoSpamRate = 140,
    NextSpellcastTimestamp = 141,
    AppraisalRequestedTimestamp = 142,
    AppraisalHeartbeatDueTimestamp = 143,
    ManaConversionMod = 144,
    LastPkAttackTimestamp = 145,
    FellowshipUpdateTimestamp = 146,
    CriticalFrequency = 147,
    LimboStartTimestamp = 148,
    WeaponMissileDefense = 149,
    WeaponMagicDefense = 150,
    IgnoreShield = 151,
    ElementalDamageMod = 152,
    StartMissileAttackTimestamp = 153,
    LastRareUsedTimestamp = 154,
    IgnoreArmor = 155,
    ProcSpellRate = 156,
    ResistanceModifier = 157,
    AllegianceGagTimestamp = 158,
    AbsorbMagicDamage = 159,
    CachedMaxAbsorbMagicDamage = 160,
    GagDuration = 161,
    AllegianceGagDuration = 162,
    GlobalXpMod = 163,
    HealingModifier = 164,
    ArmorModVsNether = 165,
    ResistNether = 166,
    CooldownDuration = 167,
    WeaponAuraOffense = 168,
    WeaponAuraDefense = 169,
    WeaponAuraElemental = 170,
    WeaponAuraManaConv = 171,
    PcapRecordedWorkmanship = 8004,
    PcapRecordedVelocityX = 8010,
    PcapRecordedVelocityY = 8011,
    PcapRecordedVelocityZ = 8012,
    PcapRecordedAccelerationX = 8013,
    PcapRecordedAccelerationY = 8014,
    PcapRecordedAccelerationZ = 8015,
    PcapRecordeOmegaX = 8016,
    PcapRecordeOmegaY = 8017,
    PcapRecordeOmegaZ = 8018,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, FromRepr, Display)]
#[repr(u32)]
pub enum PropertyString {
    Undef = 0,
    Name = 1,
    Title = 2,
    Sex = 3,
    HeritageGroup = 4,
    Template = 5,
    AttackersName = 6,
    Inscription = 7,
    ScribeName = 8,
    VendorsName = 9,
    Fellowship = 10,
    MonarchsName = 11,
    LockCode = 12,
    KeyCode = 13,
    Use = 14,
    ShortDesc = 15,
    LongDesc = 16,
    ActivationTalk = 17,
    UseMessage = 18,
    ItemHeritageGroupRestriction = 19,
    PluralName = 20,
    MonarchsTitle = 21,
    ActivationFailure = 22,
    ScribeAccount = 23,
    TownName = 24,
    CraftsmanName = 25,
    UsePkServerError = 26,
    ScoreCachedText = 27,
    ScoreDefaultEntryFormat = 28,
    ScoreFirstEntryFormat = 29,
    ScoreLastEntryFormat = 30,
    ScoreOnlyEntryFormat = 31,
    ScoreNoEntry = 32,
    Quest = 33,
    GeneratorEvent = 34,
    PatronsTitle = 35,
    HouseOwnerName = 36,
    QuestRestriction = 37,
    AppraisalPortalDestination = 38,
    TinkerName = 39,
    ImbuerName = 40,
    HouseOwnerAccount = 41,
    DisplayName = 42,
    DateOfBirth = 43,
    ThirdPartyApi = 44,
    KillQuest = 45,
    Afk = 46,
    AllegianceName = 47,
    AugmentationAddQuest = 48,
    KillQuest2 = 49,
    KillQuest3 = 50,
    UseSendsSignal = 51,
    GearPlatingName = 52,
    PcapRecordedCurrentMotionState = 8006,
    PcapRecordedServerName = 8031,
    PcapRecordedCharacterName = 8032,
    AllegianceMotd = 9001,
    AllegianceMotdSetBy = 9002,
    AllegianceSpeakerTitle = 9003,
    AllegianceSeneschalTitle = 9004,
    AllegianceCastellanTitle = 9005,
    GodState = 9006,
    TinkerLog = 9007,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, FromRepr, Display)]
#[repr(u32)]
pub enum PropertyDataId {
    Undef = 0,
    Setup = 1,
    MotionTable = 2,
    SoundTable = 3,
    CombatTable = 4,
    QualityFilter = 5,
    PaletteBase = 6,
    ClothingBase = 7,
    Icon = 8,
    EyesTexture = 9,
    NoseTexture = 10,
    MouthTexture = 11,
    DefaultEyesTexture = 12,
    DefaultNoseTexture = 13,
    DefaultMouthTexture = 14,
    HairPalette = 15,
    EyesPalette = 16,
    SkinPalette = 17,
    HeadObject = 18,
    ActivationAnimation = 19,
    InitMotion = 20,
    ActivationSound = 21,
    PhysicsEffectTable = 22,
    UseSound = 23,
    UseTargetAnimation = 24,
    UseTargetSuccessAnimation = 25,
    UseTargetFailureAnimation = 26,
    UseUserAnimation = 27,
    Spell = 28,
    SpellComponent = 29,
    PhysicsScript = 30,
    LinkedPortalOne = 31,
    WieldedTreasureType = 32,
    InventoryTreasureType = 33,
    ShopTreasureType = 34,
    DeathTreasureType = 35,
    MutateFilter = 36,
    ItemSkillLimit = 37,
    UseCreateItem = 38,
    DeathSpell = 39,
    VendorsClassId = 40,
    ItemSpecializedOnly = 41,
    HouseId = 42,
    AccountHouseId = 43,
    RestrictionEffect = 44,
    CreationMutationFilter = 45,
    TsysMutationFilter = 46,
    LastPortal = 47,
    LinkedPortalTwo = 48,
    OriginalPortal = 49,
    IconOverlay = 50,
    IconOverlaySecondary = 51,
    IconUnderlay = 52,
    AugmentationMutationFilter = 53,
    AugmentationEffect = 54,
    ProcSpell = 55,
    AugmentationCreateItem = 56,
    AlternateCurrency = 57,
    BlueSurgeSpell = 58,
    YellowSurgeSpell = 59,
    RedSurgeSpell = 60,
    OlthoiDeathTreasureType = 61,
    PcapRecordedWeenieHeader = 8001,
    PcapRecordedWeenieHeader2 = 8002,
    PcapRecordedObjectDesc = 8003,
    PcapRecordedPhysicsDesc = 8005,
    PcapRecordedParentLocation = 8009,
    PcapRecordedDefaultScript = 8019,
    PcapRecordedTimestamp0 = 8020,
    PcapRecordedTimestamp1 = 8021,
    PcapRecordedTimestamp2 = 8022,
    PcapRecordedTimestamp3 = 8023,
    PcapRecordedTimestamp4 = 8024,
    PcapRecordedTimestamp5 = 8025,
    PcapRecordedTimestamp6 = 8026,
    PcapRecordedTimestamp7 = 8027,
    PcapRecordedTimestamp8 = 8028,
    PcapRecordedTimestamp9 = 8029,
    PcapRecordedMaxVelocityEstimated = 8030,
    PcapPhysicsDidDataTemplatedFrom = 8044,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, FromRepr, Display)]
#[repr(u32)]
pub enum PropertyInstanceId {
    Undef = 0,
    Owner = 1,
    Container = 2,
    Wielder = 3,
    Freezer = 4,
    Viewer = 5,
    Generator = 6,
    Scribe = 7,
    CurrentCombatTarget = 8,
    CurrentEnemy = 9,
    ProjectileLauncher = 10,
    CurrentAttacker = 11,
    CurrentDamager = 12,
    CurrentFollowTarget = 13,
    CurrentAppraisalTarget = 14,
    CurrentFellowshipAppraisalTarget = 15,
    ActivationTarget = 16,
    Creator = 17,
    Victim = 18,
    Killer = 19,
    Vendor = 20,
    Customer = 21,
    Bonded = 22,
    Wounder = 23,
    Allegiance = 24,
    Patron = 25,
    Monarch = 26,
    CombatTarget = 27,
    HealthQueryTarget = 28,
    LastUnlocker = 29,
    CrashAndTurnTarget = 30,
    AllowedActivator = 31,
    HouseOwner = 32,
    House = 33,
    Slumlord = 34,
    ManaQueryTarget = 35,
    CurrentGame = 36,
    RequestedAppraisalTarget = 37,
    AllowedWielder = 38,
    AssignedTarget = 39,
    LimboSource = 40,
    Snooper = 41,
    TeleportedCharacter = 42,
    Pet = 43,
    PetOwner = 44,
    PetDevice = 45,
    PcapRecordedObjectIid = 8000,
    PcapRecordedParentIid = 8008,
}

bitflags! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
    pub struct ItemType: u32 {
        const MELEE_WEAPON = 0x00000001;
        const ARMOR = 0x00000002;
        const CLOTHING = 0x00000004;
        const JEWELRY = 0x00000008;
        const CREATURE = 0x00000010;
        const FOOD = 0x00000020;
        const MONEY = 0x00000040;
        const MISC = 0x00000080;
        const MISSILE_WEAPON = 0x00000100;
        const CONTAINER = 0x00000200;
        const USELESS = 0x00000400;
        const GEM = 0x00000800;
        const SPELL_COMPONENTS = 0x00001000;
        const WRITABLE = 0x00002000;
        const KEY = 0x00004000;
        const CASTER = 0x00008000;
        const PORTAL = 0x00010000;
        const LOCKABLE = 0x00020000;
        const PROMISSORY_NOTE = 0x00040000;
        const MANA_STONE = 0x00080000;
        const SERVICE = 0x00100000;
        const MAGIC_WIELDABLE = 0x00200000;
        const CRAFT_COOKING_BASE = 0x00400000;
        const CRAFT_ALCHEMY_BASE = 0x00800000;
        const CRAFT_FLETCHING_BASE = 0x02000000;
        const CRAFT_ALCHEMY_INTERMEDIATE = 0x04000000;
        const CRAFT_FLETCHING_INTERMEDIATE = 0x08000000;
        const LIFE_STONE = 0x10000000;
        const TINKERING_TOOL = 0x20000000;
        const TINKERING_MATERIAL = 0x40000000;
        const GAMEBOARD = 0x80000000;
    }
}

bitflags! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
    pub struct ObjectDescriptionFlag: u32 {
        const NONE = 0x00000000;
        const OPENABLE = 0x00000001;
        const INSCRIBABLE = 0x00000002;
        const STUCK = 0x00000004;
        const PLAYER = 0x00000008;
        const ATTACKABLE = 0x00000010;
        const PLAYER_KILLER = 0x00000020;
        const HIDDEN_ADMIN = 0x00000040;
        const UI_HIDDEN = 0x00000080;
        const BOOK = 0x00000100;
        const VENDOR = 0x00000200;
        const PK_SWITCH = 0x00000400;
        const NPK_SWITCH = 0x00000800;
        const DOOR = 0x00001000;
        const CORPSE = 0x00002000;
        const LIFE_STONE = 0x00004000;
        const FOOD = 0x00008000;
        const HEALER = 0x00010000;
        const LOCKPICK = 0x00020000;
        const PORTAL = 0x00040000;
        const ADMIN = 0x00100000;
        const FREE_PK_STATUS = 0x00200000;
        const IMMUNE_CELL_RESTRICTIONS = 0x00400000;
        const REQUIRES_PACK_SLOT = 0x00800000;
        const RETAINED = 0x01000000;
        const PK_LITE_STATUS = 0x02000000;
        const INCLUDES_SECOND_HEADER = 0x04000000;
        const BIND_STONE = 0x08000000;
        const VOLATILE_RARE = 0x10000000;
        const WIELD_ON_USE = 0x20000000;
        const WIELD_LEFT = 0x40000000;
    }
}

bitflags! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
    pub struct PhysicsState: u32 {
        const NONE                          = 0x00000000;
        const STATIC                        = 0x00000001;
        const UNUSED1                       = 0x00000002;
        const ETHEREAL                      = 0x00000004;
        const REPORT_COLLISIONS              = 0x00000008;
        const IGNORE_COLLISIONS              = 0x00000010;
        const NO_DRAW                        = 0x00000020;
        const MISSILE                       = 0x00000040;
        const PUSHABLE                      = 0x00000080;
        const ALIGN_PATH                     = 0x00000100;
        const PATH_CLIPPED                   = 0x00000200;
        const GRAVITY                       = 0x00000400;
        const LIGHTING_ON                    = 0x00000800;
        const PARTICLE_EMITTER               = 0x00001000;
        const UNUSED2                       = 0x00002000;
        const HIDDEN                        = 0x00004000;
        const SCRIPTED_COLLISION             = 0x00008000;
        const HAS_PHYSICS_BSP                 = 0x00010000;
        const INELASTIC                     = 0x00020000;
        const HAS_DEFAULT_ANIM                = 0x00040000;
        const HAS_DEFAULT_SCRIPT              = 0x00080000;
        const CLOAKED                       = 0x00100000;
        const REPORT_COLLISIONS_AS_ENVIRONMENT = 0x00200000;
        const EDGE_SLIDE                     = 0x00400000;
        const SLEDDING                      = 0x00800000;
        const FROZEN                        = 0x01000000;
    }
}

bitflags! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
    pub struct EnchantmentTypeFlags: u32 {
        const UNDEF                  = 0x0000000;
        const ATTRIBUTE              = 0x0000001;
        const SECOND_ATT              = 0x0000002;
        const INT                    = 0x0000004;
        const FLOAT                  = 0x0000008;
        const SKILL                  = 0x0000010;
        const BODY_DAMAGE_VALUE        = 0x0000020;
        const BODY_DAMAGE_VARIANCE     = 0x0000040;
        const BODY_ARMOR_VALUE         = 0x0000080;
        const SINGLE_STAT             = 0x0001000;
        const MULTIPLE_STAT           = 0x0002000;
        const MULTIPLICATIVE         = 0x0004000;
        const ADDITIVE               = 0x0008000;
        const ATTACK_SKILLS           = 0x0010000;
        const DEFENSE_SKILLS          = 0x0020000;
        const MULTIPLICATIVE_DEGRADE = 0x0100000;
        const ADDITIVE_DEGRADE       = 0x0200000;
        const VITAE                  = 0x0800000;
        const COOLDOWN               = 0x1000000;
        const BENEFICIAL             = 0x2000000;
        const STAT_TYPES              = 0x00000FF;
    }
}

bitflags! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
    pub struct WeenieHeaderFlag: u32 {
        const NONE = 0x00000000;
        const PLURAL_NAME = 0x00000001;
        const ITEMS_CAPACITY = 0x00000002;
        const CONTAINERS_CAPACITY = 0x00000004;
        const VALUE = 0x00000008;
        const USABLE = 0x00000010;
        const USE_RADIUS = 0x00000020;
        const MONARCH = 0x00000040;
        const UI_EFFECTS = 0x00000080;
        const AMMO_TYPE = 0x00000100;
        const COMBAT_USE = 0x00000200;
        const STRUCTURE = 0x00000400;
        const MAX_STRUCTURE = 0x00000800;
        const STACK_SIZE = 0x00001000;
        const MAX_STACK_SIZE = 0x00002000;
        const CONTAINER = 0x00004000;
        const WIELDER = 0x00008000;
        const VALID_LOCATIONS = 0x00010000;
        const CURRENTLY_WIELDED_LOCATION = 0x00020000;
        const PRIORITY = 0x00040000;
        const TARGET_TYPE = 0x00080000;
        const RADAR_BLIP_COLOR = 0x00100000;
        const BURDEN = 0x00200000;
        const SPELL = 0x00400000;
        const RADAR_BEHAVIOR = 0x00800000;
        const WORKMANSHIP = 0x01000000;
        const HOUSE_OWNER = 0x02000000;
        const HOUSE_RESTRICTIONS = 0x04000000;
        const PSCRIPT = 0x08000000;
        const HOOK_TYPE = 0x10000000;
        const HOOK_ITEM_TYPES = 0x20000000;
        const ICON_OVERLAY = 0x40000000;
        const MATERIAL_TYPE = 0x80000000;
    }
}

bitflags! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
    pub struct WeenieHeaderFlag2: u32 {
        const NONE = 0x00;
        const ICON_UNDERLAY = 0x01;
        const COOLDOWN = 0x02;
        const COOLDOWN_DURATION = 0x04;
        const PET_OWNER = 0x08;
    }
}

bitflags! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
    pub struct PhysicsDescriptionFlag: u32 {
        const NONE = 0x000000;
        const CSETUP = 0x000001;
        const MTABLE = 0x000002;
        const VELOCITY = 0x000004;
        const ACCELERATION = 0x000008;
        const OMEGA = 0x000010;
        const PARENT = 0x000020;
        const CHILDREN = 0x000040;
        const OBJSCALE = 0x000080;
        const FRICTION = 0x000100;
        const ELASTICITY = 0x000200;
        const TIMESTAMPS = 0x000400;
        const STABLE = 0x000800;
        const PETABLE = 0x001000;
        const DEFAULT_SCRIPT = 0x002000;
        const DEFAULT_SCRIPT_INTENSITY = 0x004000;
        const POSITION = 0x008000;
        const MOVEMENT = 0x010000;
        const ANIMATION_FRAME = 0x020000;
        const TRANSLUCENCY = 0x040000;
    }
}

bitflags! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
    pub struct UpdatePositionFlag: u32 {
        const NONE = 0x00;
        const HAS_VELOCITY = 0x01;
        const HAS_PLACEMENT_ID = 0x02;
        const IS_GROUNDED = 0x04;
        const ORIENTATION_HAS_NO_W = 0x08;
        const ORIENTATION_HAS_NO_X = 0x10;
        const ORIENTATION_HAS_NO_Y = 0x20;
        const ORIENTATION_HAS_NO_Z = 0x40;
    }
}

bitflags! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
    pub struct IdentifyResponseFlags: u32 {
        const NONE = 0x0000;
        const INT_STATS_TABLE = 0x0001;
        const BOOL_STATS_TABLE = 0x0002;
        const FLOAT_STATS_TABLE = 0x0004;
        const STRING_STATS_TABLE = 0x0008;
        const SPELL_BOOK = 0x0010;
        const WEAPON_PROFILE = 0x0020;
        const HOOK_PROFILE = 0x0040;
        const ARMOR_PROFILE = 0x0080;
        const CREATURE_PROFILE = 0x0100;
        const ARMOR_ENCHANTMENT_BITFIELD = 0x0200;
        const RESIST_ENCHANTMENT_BITFIELD = 0x0400;
        const WEAPON_ENCHANTMENT_BITFIELD = 0x0800;
        const DID_STATS_TABLE = 0x1000;
        const INT64_STATS_TABLE = 0x2000;
        const ARMOR_LEVELS = 0x4000;
    }
}

bitflags! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
    pub struct GfxObjFlags: u32 {
        const NONE = 0x00000000;
        const HAS_PHYSICS = 0x00000001;
        const HAS_DRAWING = 0x00000002;
        const UNKNOWN = 0x00000004;
        const HAS_DID_DEGRADE = 0x00000008;
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum WeenieType {
    Undef = 0,
    Generic = 1,
    Clothing = 2,
    MissileLauncher = 3,
    Missile = 4,
    Ammunition = 5,
    MeleeWeapon = 6,
    Portal = 7,
    Book = 8,
    Coin = 9,
    Creature = 10,
    Admin = 11,
    Vendor = 12,
    HotSpot = 13,
    Corpse = 14,
    Cow = 15,
    AI = 16,
    Machine = 17,
    Food = 18,
    Door = 19,
    Chest = 20,
    Container = 21,
    Key = 22,
    Lockpick = 23,
    PressurePlate = 24,
    LifeStone = 25,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, FromRepr, Display)]
#[repr(u8)]
pub enum RadarColor {
    Default = 0x00,
    Blue = 0x01,
    Gold = 0x02,
    White = 0x03,
    Purple = 0x04,
    Red = 0x05,
    Pink = 0x06,
    Green = 0x07,
    Yellow = 0x08,
    Cyan = 0x09,
    BrightGreen = 0x10,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, FromRepr, Display)]
#[repr(u8)]
pub enum RadarBehavior {
    ShowNever = 0,
    ShowAlways = 1,
    ShowDistance = 2,
}

bitflags! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, Default)]
    pub struct EquipMask: u32 {
        const NONE = 0x00000000;
        const HEAD_WEAR = 0x00000001;
        const CHEST_WEAR = 0x00000002;
        const ABDOMEN_WEAR = 0x00000004;
        const UPPER_ARM_WEAR = 0x00000008;
        const LOWER_ARM_WEAR = 0x00000010;
        const HAND_WEAR = 0x00000020;
        const UPPER_LEG_WEAR = 0x00000040;
        const LOWER_LEG_WEAR = 0x00000080;
        const FOOT_WEAR = 0x00000100;
        const CHEST_ARMOR = 0x00000200;
        const ABDOMEN_ARMOR = 0x00000400;
        const UPPER_ARM_ARMOR = 0x00000800;
        const LOWER_ARM_ARMOR = 0x00001000;
        const UPPER_LEG_ARMOR = 0x00002000;
        const LOWER_LEG_ARMOR = 0x00004000;
        const NECK_WEAR = 0x00008000;
        const WRIST_WEAR_LEFT = 0x00010000;
        const WRIST_WEAR_RIGHT = 0x00020000;
        const FINGER_WEAR_LEFT = 0x00040000;
        const FINGER_WEAR_RIGHT = 0x00080000;
        const MELEE_WEAPON = 0x00100000;
        const SHIELD = 0x00200000;
        const MISSILE_WEAPON = 0x00400000;
        const MISSILE_AMMO = 0x00800000;
        const HELD = 0x01000000; // Casters and offhand?
        const TWO_HANDED = 0x02000000;
        const TRINKET_ONE = 0x04000000;
        const CLOAK = 0x08000000;
        const SIGIL_ONE = 0x10000000;
        const SIGIL_TWO = 0x20000000;
        const SIGIL_THREE = 0x40000000;

        const TOP_CLOTHES = Self::CHEST_WEAR.bits() | Self::UPPER_ARM_WEAR.bits() | Self::LOWER_ARM_WEAR.bits();
        const BOTTOM_CLOTHES = Self::UPPER_LEG_WEAR.bits() | Self::LOWER_LEG_WEAR.bits();
        const CLOTHES = Self::TOP_CLOTHES.bits() | Self::BOTTOM_CLOTHES.bits() | Self::ABDOMEN_WEAR.bits();
        const COMBAT_IMPLEMENTS = Self::MELEE_WEAPON.bits() | Self::SHIELD.bits() | Self::MISSILE_WEAPON.bits() | Self::HELD.bits() | Self::TWO_HANDED.bits();
        const MAIN_HAND_EXCLUSIVE = Self::TWO_HANDED.bits() | Self::MISSILE_WEAPON.bits() | Self::HELD.bits();
        const MAIN_HAND_IMPLEMENTS = Self::COMBAT_IMPLEMENTS.bits() & !(Self::SHIELD.bits());
        const OFF_HAND_IMPLEMENTS = Self::COMBAT_IMPLEMENTS.bits() & (Self::SHIELD.bits() | Self::MELEE_WEAPON.bits());
        const MAIN_HAND_ONLY = Self::MAIN_HAND_IMPLEMENTS.bits() & !(Self::OFF_HAND_IMPLEMENTS.bits());
        const OFF_HAND_ONLY = Self::OFF_HAND_IMPLEMENTS.bits() & !(Self::MAIN_HAND_IMPLEMENTS.bits());
        const OFF_HAND_SLOT = Self::SHIELD.bits();
        const CLOTHING = 0x80000000 | Self::HEAD_WEAR.bits() | Self::CHEST_WEAR.bits() | Self::ABDOMEN_WEAR.bits() | Self::UPPER_ARM_WEAR.bits() | Self::LOWER_ARM_WEAR.bits() | Self::HAND_WEAR.bits() | Self::UPPER_LEG_WEAR.bits() | Self::LOWER_LEG_WEAR.bits() | Self::FOOT_WEAR.bits();
        const ARMOR = Self::CHEST_ARMOR.bits() | Self::ABDOMEN_ARMOR.bits() | Self::UPPER_ARM_ARMOR.bits() | Self::LOWER_ARM_ARMOR.bits() | Self::UPPER_LEG_ARMOR.bits() | Self::LOWER_LEG_ARMOR.bits() | Self::FOOT_WEAR.bits();
        const JEWELRY = Self::NECK_WEAR.bits() | Self::WRIST_WEAR_LEFT.bits() | Self::WRIST_WEAR_RIGHT.bits() | Self::FINGER_WEAR_LEFT.bits() | Self::FINGER_WEAR_RIGHT.bits() | Self::TRINKET_ONE.bits() | Self::CLOAK.bits() | Self::SIGIL_ONE.bits() | Self::SIGIL_TWO.bits() | Self::SIGIL_THREE.bits();
        const WRIST_WEAR = Self::WRIST_WEAR_LEFT.bits() | Self::WRIST_WEAR_RIGHT.bits();
        const FINGER_WEAR = Self::FINGER_WEAR_LEFT.bits() | Self::FINGER_WEAR_RIGHT.bits();
        const SIGIL = Self::SIGIL_ONE.bits() | Self::SIGIL_TWO.bits() | Self::SIGIL_THREE.bits();
        const ALL = 0x7FFFFFFF;
        const CAN_GO_IN_READY_SLOT = 0x7FFFFFFF;
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, FromRepr, Display, Serialize, Deserialize, Default)]
#[repr(u8)]
pub enum CombatUse {
    #[default]
    None = 0,
    Melee = 1,
    Missile = 2,
    Ammo = 3,
    Shield = 4,
    TwoHanded = 5,
}

bitflags! {
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
    pub struct Usable: u32 {
        const UNDEF       = 0x00;
        const NO          = 0x01;
        const SELF        = 0x02;
        const WIELDED     = 0x04;
        const CONTAINED   = 0x08;
        const VIEWED      = 0x10;
        const REMOTE      = 0x20;
        const NEVER_WALK   = 0x40;
        const OBJ_SELF     = 0x80;

        const SOURCE_MASK = 0x0000FFFF;
        const TARGET_MASK = 0xFFFF0000;

        const CONTAINED_VIEWED                 = 0x08 | 0x10;
        const CONTAINED_VIEWED_REMOTE           = 0x08 | 0x10 | 0x20;
        const CONTAINED_VIEWED_REMOTE_NEVER_WALK  = 0x08 | 0x10 | 0x20 | 0x40;

        const VIEWED_REMOTE                    = 0x10 | 0x20;
        const VIEWED_REMOTE_NEVER_WALK           = 0x10 | 0x20 | 0x40;

        const REMOTE_NEVER_WALK                 = 0x20 | 0x40;

        const SOURCE_WIELDED_TARGET_WIELDED              = 0x040004;
        const SOURCE_WIELDED_TARGET_CONTAINED            = 0x080004;
        const SOURCE_WIELDED_TARGET_VIEWED               = 0x100004;
        const SOURCE_WIELDED_TARGET_REMOTE               = 0x200004;
        const SOURCE_WIELDED_TARGET_REMOTE_NEVER_WALK    = 0x600004;

        const SOURCE_CONTAINED_TARGET_WIELDED            = 0x040008;
        const SOURCE_CONTAINED_TARGET_CONTAINED          = 0x080008;
        const SOURCE_CONTAINED_TARGET_OBJSELF_OR_CONTAINED = 0x880008;
        const SOURCE_CONTAINED_TARGET_SELF_OR_CONTAINED    = 0x0A0008;
        const SOURCE_CONTAINED_TARGET_VIEWED             = 0x100008;
        const SOURCE_CONTAINED_TARGET_REMOTE             = 0x200008;
        const SOURCE_CONTAINED_TARGET_REMOTE_NEVER_WALK  = 0x600008;
        const SOURCE_CONTAINED_TARGET_REMOTE_OR_SELF       = 0x220008;

        const SOURCE_VIEWED_TARGET_WIELDED               = 0x040010;
        const SOURCE_VIEWED_TARGET_CONTAINED             = 0x080010;
        const SOURCE_VIEWED_TARGET_VIEWED                = 0x100010;
        const SOURCE_VIEWED_TARGET_REMOTE                = 0x200010;

        const SOURCE_REMOTE_TARGET_WIELDED               = 0x040020;
        const SOURCE_REMOTE_TARGET_CONTAINED             = 0x080020;
        const SOURCE_REMOTE_TARGET_VIEWED                = 0x100020;
        const SOURCE_REMOTE_TARGET_REMOTE                = 0x200020;
        const SOURCE_REMOTE_TARGET_REMOTE_NEVER_WALK     = 0x600020;
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum PropertyValue {
    Int(i32),
    Int64(i64),
    Bool(bool),
    Float(f64),
    String(String),
    DID(Guid),
    IID(Guid),
}
