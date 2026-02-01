# Property Systems

Asheron's Call uses a flexible property system to define entity traits. These are sent to the client via various update messages and the `0x0013 PlayerDescription` message.

## 1. Hybrid Property Model
Asheron's Call uses a hybrid approach to define entity state:
- **Static Properties (.dat)**: Defined in \`client_portal.dat\` weenie records. These include defaults like \`DefaultScale\`, \`Mass\`, and \`PhysicsState\`. The client looks these up using the \`wcid\` (Weenie Class ID).
- **Dynamic Properties (Network)**: Overrides or values that change, sent via \`0xF745 ObjectCreate\` or \`0xF7B0 PublicUpdateProperty\` messages.

---

## 2. Property Types
Entities maintain several hash tables for different data types.

### Attributes

Properties may have specific flags that dictate their behavior:

- **L** (SendOnLogin / Logic): This property is sent to the client as part of the initial object creation or login sequence (e.g., in `ObjectCreate` or `PlayerDescription` packets).
- **A** (AssessmentProperty): This property is only revealed when the object is successfully "Appraised" (assessed) by a player.
- **E** (Ephemeral): These properties are **not persisted to the database** (the "Shard"). 
    - They exist only in the server's memory while the object is instantiated.
    - They are lost upon server restart or when the object is disposed of (e.g., if a player logs out or an item is destroyed).
    - Examples include `Stuck` status or current `Visibility`.

### The Shard

In Asheron's Call terminology, a **Shard** refers to a specific game server instance (e.g., Frostfell, Thistledown). In the context of the emulator (ACE), "The Shard" or "Shard Database" refers to the SQL database (MySQL/MariaDB) that stores persistent game state, such as player inventory, coordinates, and persistent properties. Properties *not* marked as Ephemeral are written to the `biota_properties_*` tables in the shard database.

---

## 3. Property ID Reference
Source: `ACE.Entity.Enum.Properties`

### PropertyBool (Boolean)
| ID | Name | Attr | Description |
|---|---|---|---|
| 1 | Stuck | E | Object is immobile/stuck in place. |
| 2 | Open | A, E | Container, door, or portal is currently open. |
| 3 | Locked | A | Object is locked. |
| 4 | RotProof | | Item does not decay over time. |
| 5 | AllegianceUpdateRequest | | Triggered when a player requests an allegiance hierarchy update. |
| 6 | AiUsesMana | | AI creature utilizes mana for spellcasting. |
| 7 | AiUseHumanMagicAnimations | | AI creature uses human-like magic casting animations. |
| 8 | AllowGive | | Item can be given to this entity (usually NPCs). |
| 9 | CurrentlyAttacking | | Entity is carrying out an attack animation. |
| 10 | AttackerAi | | AI is actively in combat mode. |
| 11 | IgnoreCollisions | | Physics: Object ignore collision checks. |
| 12 | ReportCollisions | | Physics: Object reports collisions to server. |
| 13 | Ethereal | | Physics: Other objects can pass through this. |
| 14 | GravityStatus | | Physics: Object is affected by gravity. |
| 15 | LightsStatus | | Physics: Object has its lighting enabled. |
| 16 | ScriptedCollision | | Physics: Collisions are handled by a script rather than default physics. |
| 17 | Inelastic | | Physics: Object does not bounce or transfer momentum normally. |
| 18 | Visibility | E | Current visibility level (0 = invisible). |
| 19 | Attackable | | Entity can be targeted for combat. |
| 20 | SafeSpellComponents | | Staff/Admin: Special state allowing casting without consuming components. |
| 21 | AdvocateState | L | Special state for Advocate characters. |
| 22 | Inscribable | | Item can have custom text written on it by a player. |
| 23 | DestroyOnSell | | Item is deleted when sold to a vendor (rather than added to its inventory). |
| 24 | UiHidden | | Object and its icon are hidden from the inventory UI. |
| 25 | IgnoreHouseBarriers | | Physics: Entity can pass through house walls/barriers. |
| 26 | HiddenAdmin | | Staff/Admin: Character is hidden from /who and other player-facing lists. |
| 27 | PkWounder | | |
| 28 | PkKiller | | |
| 29 | NoCorpse | | Entity does not leave a corpse upon death. |
| 30 | UnderLifestoneProtection | | Temporary invulnerability granted after resurrecting at a lifestone. |
| 31 | ItemManaUpdatePending | | |
| 32 | GeneratorStatus | E | Runtime status of a generator (enabled/disabled). |
| 33 | ResetMessagePending | E | |
| 34 | DefaultOpen | | Container, door, or portal is open by default on spawn. |
| 35 | DefaultLocked | | Object is locked by default on spawn. |
| 36 | DefaultOn | | Object (e.g. lights) is active/on by default on spawn. |
| 37 | OpenForBusiness | | NPC is currently accepting trades or selling. |
| 38 | IsFrozen | | Object is physically frozen (cannot move or rotate). |
| 39 | DealMagicalItems | | Vendor deals in or buys magical items. |
| 40 | LogoffImDead | | If the player logs off while dead, they remain dead on next login. |
| 41 | ReportCollisionsAsEnvironment | | Physics: Object collisions are treated as static environment collisions. |
| 42 | AllowEdgeSlide | | Physics: Allows characters to slide along the edges of the object. |
| 43 | AdvocateQuest | | |
| 44 | IsAdmin | L, E | Character has Administrator permissions. |
| 45 | IsArch | L, E | |
| 46 | IsSentinel | L, E | |
| 47 | IsAdvocate | L | |
| 48 | CurrentlyPoweringUp | | |
| 49 | GeneratorEnteredWorld | E | |
| 50 | NeverFailCasting | | |
| 51 | VendorService | | NPC provides services (healing, spell-buying, etc). |
| 52 | AiImmobile | | AI is rooted to its spawn point and cannot move. |
| 53 | DamagedByCollisions | | Object takes damage from high-velocity collisions. |
| 54 | IsDynamic | | |
| 55 | IsHot | | Physics: Object is currently active or moving (e.g. active fire). |
| 56 | IsAffecting | | Item/Spell is currently active and potentially burning mana. |
| 57 | AffectsAis | | |
| 58 | SpellQueueActive | | |
| 59 | GeneratorDisabled | E | |
| 60 | IsAcceptingTells | | Player is currently accepting incoming private messages. |
| 61 | LoggingChannel | | |
| 62 | OpensAnyLock | | Skeleton Key: Item ignores LockCode matching on objects. |
| 63 | UnlimitedUse | A | Item does not consume charges or uses. |
| 64 | GeneratedTreasureItem | | |
| 65 | IgnoreMagicResist | | |
| 66 | IgnoreMagicArmor | | |
| 67 | AiAllowTrade | | |
| 68 | SpellComponentsRequired | L | If true, caster needs physical components (e.g. Mandragora). |
| 69 | IsSellable | A | Item can be sold to NPC vendors. |
| 70 | IgnoreShieldsBySkill | | |
| 71 | NoDraw | | Object is not rendered in the 3D world. |
| 72 | ActivationUntargeted | | Object can be used without being selected/targeted. |
| 73 | HouseHasGottenPriorityBootPos | | |
| 74 | GeneratorAutomaticDestruction | E | |
| 75 | HouseHooksVisible | | Individual house hooks (decoration slots) are visible. |
| 76 | HouseRequiresMonarch | | House can only be purchased by the Monarch of an allegiance. |
| 77 | HouseHooksEnabled | | Decorating via house hooks is currently enabled. |
| 78 | HouseNotifiedHudOfHookCount | | |
| 79 | AiAcceptEverything | | NPC will accept any item given to it (testing/special NPCs). |
| 80 | IgnorePortalRestrictions | | Entity can enter portals regardless of level or quest requirements. |
| 81 | RequiresBackpackSlot | | |
| 82 | DontTurnOrMoveWhenGiving | | |
| 83 | NpcLooksLikeObject | | NPC uses an inanimate object model rather than a creature model. |
| 84 | IgnoreCloIcons | | |
| 85 | AppraisalHasAllowedWielder | A | |
| 86 | ChestRegenOnClose | | Container refills/regenerates its contents when closed. |
| 87 | LogoffInMinigame | | Player is currently in a minigame (e.g. Chess). |
| 88 | PortalShowDestination | | Portal displays its destination when selected. |
| 89 | PortalIgnoresPkAttackTimer | | |
| 90 | NpcInteractsSilently | | |
| 91 | Retained | A | Item is not dropped on death (soulbound). |
| 92 | IgnoreAuthor | | |
| 93 | Limbo | | Entity is in a "Limbo" state (between worlds/regions). |
| 94 | AppraisalHasAllowedActivator | A | |
| 95 | ExistedBeforeAllegianceXpChanges | | |
| 96 | IsDeaf | | Entity does not hear chat or environmental sounds. |
| 97 | IsPsr | L, E | |
| 98 | Invincible | | Entity cannot take damage or be killed. |
| 99 | Ivoryable | A | Item can be treated with Ivory (to make it non-drop). |
| 100 | Dyable | A | Item can be dyed via pigment or other tools. |
| 101 | CanGenerateRare | | Creature has a chance to drop rare loot. |
| 102 | CorpseGeneratedRare | | Flag set if this specific corpse contains a Rare item. |
| 103 | NonProjectileMagicImmune | | Immune to magic spells that are not projectile-based. |
| 104 | ActdReceivedItems | L | |
| 105 | Unknown105 | | |
| 106 | FirstEnterWorldDone | E | |
| 107 | RecallsDisabled | | Recall/Lifestone teleportation is disabled for this entity. |
| 108 | RareUsesTimer | A | Usage of this rare item (e.g. Gem) triggers a global rare cooldown. |
| 109 | ActdPreorderReceivedItems | | |
| 110 | Afk | E | Player is set to 'Away From Keyboard' status. |
| 111 | IsGagged | | Player is muted/silenced in chat. |
| 112 | ProcSpellSelfTargeted | | The 'ProcSpell' on this item targets the user, not the victim. |
| 113 | IsAllegianceGagged | | |
| 114 | EquipmentSetTriggerPiece | | This item counts as the trigger piece for an equipment set bonus. |
| 115 | Uninscribe | | |
| 116 | WieldOnUse | | Item is automatically equipped when used. |
| 117 | ChestClearedWhenClosed | | Container contents are wiped when it is closed. |
| 118 | NeverAttack | | AI is strictly passive and will never initiate combat. |
| 119 | SuppressGenerateEffect | | Suppresses the visual 'poof' effect when the object spawns. |
| 120 | TreasureCorpse | | This corpse was generated with treasure/loot. |
| 121 | EquipmentSetAddLevel | | |
| 122 | BarberActive | | Player is currently in the barber shop interface. |
| 123 | TopLayerPriority | | Clothing item always renders on top of other layers. |
| 124 | NoHeldItemShown | L | Suppress rendering of the item held in the character's hand. |
| 125 | LoginAtLifestone | L | Player will respawn at their lifestone on next login. |
| 126 | OlthoiPk | | Character is in the specialized Olthoi Player Killer mode. |
| 127 | Account15Days | L | |
| 128 | HadNoVitae | | |
| 129 | NoOlthoiTalk | | |
| 130 | AutowieldLeft | A | Automatically equips to the left hand on pick up. |
| 9001 | LinkedPortalOneSummon | | |
| 9002 | LinkedPortalTwoSummon | | |
| 9003 | HouseEvicted | | |
| 9004 | UntrainedSkills | | |
| 9005 | IsEnvoy | E | |
| 9006 | UnspecializedSkills | | |
| 9007 | FreeSkillResetRenewed | | |
| 9008 | FreeAttributeResetRenewed | | |
| 9009 | SkillTemplesTimerReset | | |
| 9010 | FreeMasteryResetRenewed | | |


### PropertyInt (Integer)
| ID | Name | Attr | Description |
|---|---|---|---|
| 1 | ItemType | | Broad category of the item (e.g., Weapon, Armor, Container). |
| 2 | CreatureType | A | Classification of a creature (e.g., Olthoi, Undead). |
| 3 | PaletteTemplate | | ID for the base palette applied to the model. |
| 4 | ClothingPriority | | Layering priority for worn clothing items. |
| 5 | EncumbranceVal | A, L | Current weight/encumbrance value. |
| 6 | ItemsCapacity | | Number of item slots in a container. |
| 7 | ContainersCapacity | L | Number of sub-containers a pack can hold. |
| 8 | Mass | | Physical mass of the object. |
| 9 | ValidLocations | | Bitmask of body locations where this can be equipped. |
| 10 | CurrentWieldedLocation | | Bitmask of the location where it is currently equipped. |
| 11 | MaxStackSize | | Maximum number of items allowed in a single stack. |
| 12 | StackSize | | Current number of items in the stack. |
| 13 | StackUnitEncumbrance | | Encumbrance value per unit in a stack. |
| 14 | StackUnitMass | | Mass value per unit in a stack. |
| 15 | StackUnitValue | | Monetary value per unit in a stack. |
| 16 | ItemUseable | | Usage restrictions (bitmask of `Usable`). |
| 17 | RareId | A | Unique ID for Rare items. |
| 18 | UiEffects | | Visual effects triggered in the UI (bitmask of `UiEffects`). |
| 19 | Value | A | Base currency value of the item. |
| 20 | CoinValue | L, E | Current stack size of currency items (e.g. Pyreal). |
| 21 | TotalExperience | | Total XP earned by the character. |
| 22 | AvailableCharacter | | |
| 23 | TotalSkillCredits | | Total skill credits assigned to the character. |
| 24 | AvailableSkillCredits | L | Current unspent skill credits. |
| 25 | Level | L, A | Current level of the entity. |
| 26 | AccountRequirements | A | Subscription status required for the item (`SubscriptionStatus`). |
| 27 | ArmorType | | Category of armor (`ArmorType`). |
| 28 | ArmorLevel | A | Base armor value (AL) of the item. |
| 29 | AllegianceCpPool | | |
| 30 | AllegianceRank | L, A | Rank within the monarchy hierarchy. |
| 31 | ChannelsAllowed | | Chat channels the character is permitted to join. |
| 32 | ChannelsActive | | Chat channels the character is currently listening to. |
| 33 | Bonded | A | Item bonding status (`BondedStatus`). |
| 34 | MonarchsRank | | |
| 35 | AllegianceFollowers | A | Total followers in the allegiance hierarchy below this member. |
| 36 | ResistMagic | A | Resistance value against magic. |
| 37 | ResistItemAppraisal | | Difficulty for another player to appraise this item. |
| 38 | ResistLockpick | A | Difficulty to pick the lock on this object. |
| 40 | CombatMode | L | Current stance (bitmask of `CombatMode`). |
| 41 | CurrentAttackHeight | | Height of the current attack (High, Med, Low). |
| 42 | CombatCollisions | | |
| 43 | NumDeaths | L, A | Number of times the character has died. |
| 44 | Damage | | Base damage value for weapons. |
| 45 | DamageType | A | Damage category (bitmask of `DamageType`). |
| 46 | DefaultCombatStyle | | Default fighting style for the creature (`CombatStyle`). |
| 47 | AttackType | L, A | Specific attack animation/style currently in use. |
| 48 | WeaponSkill | | Skill ID used for weapon proficiency (`Skill`). |
| 49 | WeaponTime | | Speed/swing time of the weapon. |
| 50 | AmmoType | | Type of ammunition required (`AmmoType`). |
| 51 | CombatUse | | Specific usage type for combat items (`CombatUse`). |
| 52 | ParentLocation | | Body location where a child object is attached. |
| 53 | PlacementPosition | | Used for internal inventory order in the emulator. |
| 54 | WeaponEncumbrance | | |
| 55 | WeaponMass | | |
| 56 | ShieldValue | | Armor value provided by a shield. |
| 57 | ShieldEncumbrance | | |
| 58 | MissileInventoryLocation | | |
| 59 | FullDamageType | | |
| 60 | WeaponRange | | Maximum range of the weapon. |
| 61 | AttackersSkill | | |
| 62 | DefendersSkill | | |
| 63 | AttackersSkillValue | | |
| 64 | AttackersClass | | |
| 65 | Placement | | Current placement state of the object (`Placement`). |
| 66 | CheckpointStatus | | |
| 67 | Tolerance | | |
| 68 | TargetingTactic | | |
| 69 | CombatTactic | | |
| 70 | HomesickTargetingTactic | | |
| 71 | NumFollowFailures | | |
| 72 | FriendType | | Creature type this entity is friendly towards (`CreatureType`). |
| 73 | FoeType | | Creature type this entity treats as an enemy (`CreatureType`). |
| 74 | MerchandiseItemTypes | | Categories of items this vendor sells (bitmask of `ItemType`). |
| 75 | MerchandiseMinValue | | Minimum value of items this vendor will buy. |
| 76 | MerchandiseMaxValue | | Maximum value of items this vendor will buy. |
| 77 | NumItemsSold | | |
| 78 | NumItemsBought | | |
| 79 | MoneyIncome | | |
| 80 | MoneyOutflow | | |
| 81 | MaxGeneratedObjects | E | Maximum number of objects a generator can have active. |
| 82 | InitGeneratedObjects | E | Initial number of objects to generate on spawn. |
| 83 | ActivationResponse | | How the object responds to being used (`ActivationResponse`). |
| 84 | OriginalValue | | |
| 85 | NumMoveFailures | | |
| 86 | MinLevel | A | Minimum level requirement for use/entry. |
| 87 | MaxLevel | A | Maximum level requirement for use/entry. |
| 88 | LockpickMod | | Bonus or penalty to lockpicking for this object. |
| 89 | BoosterEnum | A | Secondary attribute boosted by a gem or item (`PropertyAttribute2nd`). |
| 90 | BoostValue | A | Numerical value of the boost provided. |
| 91 | MaxStructure | A | Maximum durability/uses of an item. |
| 92 | Structure | A | Current durability/uses remaining. |
| 93 | PhysicsState | | Compressed bitmask of various physics flags (`PhysicsState`). |
| 94 | TargetType | | Categories of items this object can be used on (bitmask of `ItemType`). |
| 95 | RadarBlipColor | | Color of the object's blip on the radar (`RadarColor`). |
| 96 | EncumbranceCapacity | | Weight capacity of the character before becoming encumbered. |
| 97 | LoginTimestamp | | Timestamp of the player's last login. |
| 98 | CreationTimestamp | L, A | Timestamp of when the entity was created. |
| 99 | PkLevelModifier | | Modifier applied to level for PK combat range. |
| 100 | GeneratorType | | Selection type for the generator (e.g. Weighted, Random) (`GeneratorType`). |
| 101 | AiAllowedCombatStyle | | Combat styles an AI is permitted to use (`CombatStyle`). |
| 102 | LogoffTimestamp | | Timestamp of the player's last logoff. |
| 103 | GeneratorDestructionType | | How objects generated are destroyed (`GeneratorDestruct`). |
| 104 | ActivationCreateClass | | Weenie class to create when the object is activated. |
| 105 | ItemWorkmanship | A | Crafting quality / workmanship level of the item. |
| 106 | ItemSpellcraft | A | Magic power level or spellcraft rating of an item. |
| 107 | ItemCurMana | A | Current mana stored in the item. |
| 108 | ItemMaxMana | A | Maximum mana capacity of the item. |
| 109 | ItemDifficulty | A | Difficulty rating for using or interacting with the item. |
| 110 | ItemAllegianceRankLimit | A | Minimum allegiance rank required to use the item. |
| 111 | PortalBitmask | A | Bitmask of restrictions or requirements for a portal (`PortalBitmask`). |
| 112 | AdvocateLevel | | Level of the advocate character. |
| 113 | Gender | L, A | Gender of the character (`Gender`). |
| 114 | Attuned | A | Attunement status (cannot be dropped/traded if attuned) (`AttunedStatus`). |
| 115 | ItemSkillLevelLimit | A | |
| 116 | GateLogic | | |
| 117 | ItemManaCost | A | Mana cost consumed per use of the item. |
| 118 | Logoff | | |
| 119 | Active | | |
| 120 | AttackHeight | | Target height for attacks (`AttackHeight`). |
| 121 | NumAttackFailures | | |
| 122 | AiCpThreshold | | |
| 123 | AiAdvancementStrategy | | |
| 124 | Version | | |
| 125 | Age | L, A | Total age of the character in seconds. |
| 126 | VendorHappyMean | | |
| 127 | VendorHappyVariance | | |
| 128 | CloakStatus | | |
| 129 | VitaeCpPool | L | Experience pool towards reducing Vitae penalty. |
| 130 | NumServicesSold | | |
| 131 | MaterialType | A | Material the item is primarily made of (`MaterialType`). |
| 132 | NumAllegianceBreaks | L | Number of times the character has left an allegiance. |
| 133 | ShowableOnRadar | E | Controls how the object appears on radar (`RadarBehavior`). |
| 134 | PlayerKillerStatus | L, A | Player killer status (NPK, PK, PKL) (`PlayerKillerStatus`). |
| 135 | VendorHappyMaxItems | | |
| 136 | ScorePageNum | | |
| 137 | ScoreConfigNum | | |
| 138 | ScoreNumScores | | |
| 139 | DeathLevel | L | Level penalty level (e.g. for Olthoi). |
| 140 | AiOptions | | |
| 141 | OpenToEveryone | | |
| 142 | GeneratorTimeType | | Timing logic for a generator (`GeneratorTimeType`). |
| 143 | GeneratorStartTime | | Scheduled start time for a generator (Unix timestamp). |
| 144 | GeneratorEndTime | | Scheduled end time for a generator (Unix timestamp). |
| 145 | GeneratorEndDestructionType | | How objects are destroyed when generator ends (`GeneratorDestruct`). |
| 146 | XpOverride | | |
| 147 | NumCrashAndTurns | | |
| 148 | ComponentWarningThreshold | | |
| 149 | HouseStatus | | Current status of the house (`HouseStatus`). |
| 150 | HookPlacement | | Placement logic for house hooks (`Placement`). |
| 151 | HookType | | Type of hook (e.g. Small, Large) (`HookType`). |
| 152 | HookItemType | | Categories of items allowed on this hook (bitmask of `ItemType`). |
| 153 | AiPpThreshold | | |
| 154 | GeneratorVersion | | |
| 155 | HouseType | | Category of house (e.g. Cottage, Villa) (`HouseType`). |
| 156 | PickupEmoteOffset | | |
| 157 | WeenieIteration | | |
| 158 | WieldRequirements | A | Bitmask of types of requirements to wield the item (`WieldRequirement`). |
| 159 | WieldSkillType | A | Skill ID required for wielding (`Skill`). |
| 160 | WieldDifficulty | A | Difficulty / Level of skill required for wielding. |
| 161 | HouseMaxHooksUsable | | |
| 162 | HouseCurrentHooksUsable | E | |
| 163 | AllegianceMinLevel | | |
| 164 | AllegianceMaxLevel | | |
| 165 | HouseRelinkHookCount | | |
| 166 | SlayerCreatureType | A | Creature type this item is specialized to kill (`CreatureType`). |
| 167 | ConfirmationInProgress | | |
| 168 | ConfirmationTypeInProgress | | |
| 169 | TsysMutationData | | |
| 170 | NumItemsInMaterial | A | |
| 171 | NumTimesTinkered | A | Number of times the item has been successfully tinkered. |
| 172 | AppraisalLongDescDecoration | A | |
| 173 | AppraisalLockpickSuccessPercent | A | |
| 174 | AppraisalPages | A, E | Current page of a multi-page book or document. |
| 175 | AppraisalMaxPages | A, E | Total pages in a multi-page book or document. |
| 176 | AppraisalItemSkill | A | Relevant skill displayed in appraisal (`Skill`). |
| 177 | GemCount | A | Number of gems currently in the item. |
| 178 | GemType | A | Type of gems this item accepts. |
| 179 | ImbuedEffect | A | Permanent magical effect applied to the item (`ImbuedEffectType`). |
| 180 | AttackersRawSkillValue | | |
| 181 | ChessRank | L, A | Skill rank for the Chess minigame. |
| 182 | ChessTotalGames | | Total Chess games played. |
| 183 | ChessGamesWon | | Total Chess games won. |
| 184 | ChessGamesLost | | Total Chess games lost. |
| 185 | TypeOfAlteration | | |
| 186 | SkillToBeAltered | | Skill targeted for alteration (`Skill`). |
| 187 | SkillAlterationCount | | |
| 188 | HeritageGroup | L, A | Character's race or heritage background (`HeritageGroup`). |
| 189 | TransferFromAttribute | | |
| 190 | TransferToAttribute | | |
| 191 | AttributeTransferCount | | |
| 192 | FakeFishingSkill | L, A | |
| 193 | NumKeys | A | Number of physical keys this object (e.g. key ring) holds. |
| 194 | DeathTimestamp | | Timestamp of death. |
| 195 | PkTimestamp | | Timestamp of becoming PK. |
| 196 | VictimTimestamp | | Timestamp of being a victim in PK. |
| 197 | HookGroup | | Group ID for a set of house hooks (`HookGroupType`). |
| 198 | AllegianceSwearTimestamp | | Timestamp of swearing to a patron. |
| 199 | HousePurchaseTimestamp | L | Timestamp when the player originally purchased their house. |
| 200 | RedirectableEquippedArmorCount | | |
| 201 | MeleeDefenseImbuedEffectTypeCache | | |
| 202 | MissileDefenseImbuedEffectTypeCache | | |
| 203 | MagicDefenseImbuedEffectTypeCache | | |
| 204 | ElementalDamageBonus | A | Flat damage bonus for elemental damage (e.g. on missile launchers). |
| 205 | ImbueAttempts | | Number of times imbuing has been attempted on the item. |
| 206 | ImbueSuccesses | | Number of successful imbuing operations on the item. |
| 207 | CreatureKills | | Total number of creatures killed by the character. |
| 208 | PlayerKillsPk | | Total number of player kills while in PK status. |
| 209 | PlayerKillsPkl | | Total number of player kills while in PKL status. |
| 210 | RaresTierOne | | Number of Tier 1 rares found. |
| 211 | RaresTierTwo | | Number of Tier 2 rares found. |
| 212 | RaresTierThree | | Number of Tier 3 rares found. |
| 213 | RaresTierFour | | Number of Tier 4 rares found. |
| 214 | RaresTierFive | | Number of Tier 5 rares found. |
| 215 | AugmentationStat | | Total number of augmentation gems used. |
| 216 | AugmentationFamilyStat | | |
| 217 | AugmentationInnateFamily | | Number of innate attribute augmentations applied (max 10). |
| 218 | AugmentationInnateStrength | L | Applied innate Strength augmentation. |
| 219 | AugmentationInnateEndurance | L | Applied innate Endurance augmentation. |
| 220 | AugmentationInnateCoordination | L | Applied innate Coordination augmentation. |
| 221 | AugmentationInnateQuickness | L | Applied innate Quickness augmentation. |
| 222 | AugmentationInnateFocus | L | Applied innate Focus augmentation. |
| 223 | AugmentationInnateSelf | L | Applied innate Self augmentation. |
| 224 | AugmentationSpecializeSalvaging | L | Specialized Salvaging skill via augmentation. |
| 225 | AugmentationSpecializeItemTinkering | L | Specialized Item Tinkering skill via augmentation. |
| 226 | AugmentationSpecializeArmorTinkering | L | Specialized Armor Tinkering skill via augmentation. |
| 227 | AugmentationSpecializeMagicItemTinkering | L | Specialized Magic Item Tinkering skill via augmentation. |
| 228 | AugmentationSpecializeWeaponTinkering | L | Specialized Weapon Tinkering skill via augmentation. |
| 229 | AugmentationExtraPackSlot | L | Extra (8th) pack slot granted via augmentation. |
| 230 | AugmentationIncreasedCarryingCapacity | L | Increased burden-carrying capacity via augmentation. |
| 231 | AugmentationLessDeathItemLoss | L | Fewer items lost on death via augmentation. |
| 232 | AugmentationSpellsRemainPastDeath | L | Enchantments persist after death via augmentation. |
| 233 | AugmentationCriticalDefense | L | Protection from critical hits via augmentation. |
| 234 | AugmentationBonusXp | L | Bonus experience earned via augmentation (+5%). |
| 235 | AugmentationBonusSalvage | L | Increased salvage material yield via augmentation. |
| 236 | AugmentationBonusImbueChance | L | Increased imbue success chance via augmentation. |
| 237 | AugmentationFasterRegen | L | Bonus to vital regeneration rate via augmentation. |
| 238 | AugmentationIncreasedSpellDuration | L | Increased spell duration via augmentation. |
| 239 | AugmentationResistanceFamily | | Number of resistance augmentations applied (max 2). |
| 240 | AugmentationResistanceSlash | L | Extra resistance to Slashing damage via augmentation. |
| 241 | AugmentationResistancePierce | L | Extra resistance to Piercing damage via augmentation. |
| 242 | AugmentationResistanceBlunt | L | Extra resistance to Bludgeoning damage via augmentation. |
| 243 | AugmentationResistanceAcid | L | Extra resistance to Acid damage via augmentation. |
| 244 | AugmentationResistanceFire | L | Extra resistance to Fire damage via augmentation. |
| 245 | AugmentationResistanceFrost | L | Extra resistance to Cold damage via augmentation. |
| 246 | AugmentationResistanceLightning | L | Extra resistance to Lightning damage via augmentation. |
| 247 | RaresTierOneLogin | | Timestamp of the last Tier 1 rare login generator skip. |
| 248 | RaresTierTwoLogin | | Timestamp of the last Tier 2 rare login generator skip. |
| 249 | RaresTierThreeLogin | | Timestamp of the last Tier 3 rare login generator skip. |
| 250 | RaresTierFourLogin | | Timestamp of the last Tier 4 rare login generator skip. |
| 251 | RaresTierFiveLogin | | Timestamp of the last Tier 5 rare login generator skip. |
| 252 | RaresLoginTimestamp | | Timestamp of the last rare login generator check. |
| 253 | RaresTierSix | | Number of Tier 6 rares found. |
| 254 | RaresTierSeven | | Number of Tier 7 rares found. |
| 255 | RaresTierSixLogin | | Timestamp of the last Tier 6 rare login generator skip. |
| 256 | RaresTierSevenLogin | | Timestamp of the last Tier 7 rare login generator skip. |
| 257 | ItemAttributeLimit | A | |
| 258 | ItemAttributeLevelLimit | A | |
| 259 | ItemAttribute2ndLimit | A | |
| 260 | ItemAttribute2ndLevelLimit | A | |
| 261 | CharacterTitleId | A | Active character title ID. |
| 262 | NumCharacterTitles | A | Total number of titles the character has unlocked. |
| 263 | ResistanceModifierType | A | Type of damage resistance being modified (`DamageType`). |
| 264 | FreeTinkersBitfield | | |
| 265 | EquipmentSetId | A | ID of the equipment set this item belongs to (`EquipmentSet`). |
| 266 | PetClass | | |
| 267 | Lifespan | A | Total lifespan of the object in seconds. |
| 268 | RemainingLifespan | A, E | Seconds remaining until the object expires. |
| 269 | UseCreateQuantity | | |
| 270 | WieldRequirements2 | A | Secondary wielding requirements (`WieldRequirement`). |
| 271 | WieldSkillType2 | A | Secondary skill ID required for wielding (`Skill`). |
| 272 | WieldDifficulty2 | A | Difficulty / Level of secondary skill required. |
| 273 | WieldRequirements3 | A | |
| 274 | WieldSkillType3 | A | |
| 275 | WieldDifficulty3 | A | |
| 276 | WieldRequirements4 | A | |
| 277 | WieldSkillType4 | A | |
| 278 | WieldDifficulty4 | A | |
| 279 | Unique | A | Item uniqueness status. |
| 280 | SharedCooldown | A | Shared cooldown ID for items that share usage timers. |
| 281 | Faction1Bits | L, A | Faction association bits (`FactionBits`). |
| 282 | Faction2Bits | | |
| 283 | Faction3Bits | | |
| 284 | Hatred1Bits | | Hatred/aggression bits towards specific groups (`FactionBits`). |
| 285 | Hatred2Bits | | |
| 286 | Hatred3Bits | | |
| 287 | SocietyRankCelhan | L, A | Rank within the Celestial Hand society. |
| 288 | SocietyRankEldweb | L, A | Rank within the Eldritch Web society. |
| 289 | SocietyRankRadblo | L, A | Rank within the Radiant Blood society. |
| 290 | HearLocalSignals | | |
| 291 | HearLocalSignalsRadius | | |
| 292 | Cleaving | A | Item possesses the Cleaving property (ignores a portion of AL). |
| 293 | AugmentationSpecializeGearcraft | | Specialized Gearcraft skill via augmentation. |
| 294 | AugmentationInfusedCreatureMagic | L | Creature Magic focus no longer required via augmentation. |
| 295 | AugmentationInfusedItemMagic | L | Item Magic focus no longer required via augmentation. |
| 296 | AugmentationInfusedLifeMagic | L | Life Magic focus no longer required via augmentation. |
| 297 | AugmentationInfusedWarMagic | L | War Magic focus no longer required via augmentation. |
| 298 | AugmentationCriticalExpertise | L | Increased critical hit chance (+1%) via augmentation. |
| 299 | AugmentationCriticalPower | L | Increased critical damage (+3%) via augmentation. |
| 300 | AugmentationSkilledMelee | L | Increased effective Melee skill (+10) via augmentation. |
| 301 | AugmentationSkilledMissile | L | Increased effective Missile skill (+10) via augmentation. |
| 302 | AugmentationSkilledMagic | L | Increased effective Magic skill (+10) via augmentation. |
| 303 | ImbuedEffect2 | A | Secondary imbued effect (`ImbuedEffectType`). |
| 304 | ImbuedEffect3 | A | |
| 305 | ImbuedEffect4 | A | |
| 306 | ImbuedEffect5 | A | |
| 307 | DamageRating | L, A | Offensive damage rating bonus. |
| 308 | DamageResistRating | L, A | Defensive damage reduction rating bonus. |
| 309 | AugmentationDamageBonus | L | Increased damage rating (+3) via augmentation. |
| 310 | AugmentationDamageReduction | L | Increased damage reduction rating (+3) via augmentation. |
| 311 | ImbueStackingBits | | Bitfield tracking which categories of imbues have been applied. |
| 312 | HealOverTime | L | Amount of health restored per tick via active effect. |
| 313 | CritRating | L, A | Critical hit chance rating. |
| 314 | CritDamageRating | L, A | Critical damage amount rating. |
| 315 | CritResistRating | L, A | Critical hit resistance rating. |
| 316 | CritDamageResistRating | L, A | Critical damage resistance rating. |
| 317 | HealingResistRating | L | Resistance modifier for incoming healing. |
| 318 | DamageOverTime | L | Amount of damage taken per tick via active effect. |
| 319 | ItemMaxLevel | A | Maximum level an item can reach via XP. |
| 320 | ItemXpStyle | A | Method by which an item earns XP (`ItemXpStyle`). |
| 321 | EquipmentSetExtra | | |
| 322 | AetheriaBitfield | | Bitfield of active Aetheria slots and states (`AetheriaBitfield`). |
| 323 | HealingBoostRating | L, A | Bonus to outgoing healing performance. |
| 324 | HeritageSpecificArmor | A | Heritage group requirement for this armor (`HeritageGroup`). |
| 325 | AlternateRacialSkills | | |
| 326 | AugmentationJackOfAllTrades | L | All skills increased by 5 via augmentation. |
| 327 | AugmentationResistanceNether | | Extra resistance to Nether damage via augmentation. |
| 328 | AugmentationInfusedVoidMagic | L | Void Magic focus no longer required via augmentation. |
| 329 | WeaknessRating | L | Rating reduction applied to the entity's offensive/defensive capabilities. |
| 330 | NetherOverTime | L | Amount of Nether damage taken per tick. |
| 331 | NetherResistRating | L | Resistance rating specifically against Nether damage. |
| 332 | LuminanceAward | | Amount of Luminance awarded for a task or kill. |
| 333 | LumAugDamageRating | L | Damage rating bonus from Luminance augmentation (max 5 stacks). |
| 334 | LumAugDamageReductionRating | L | Damage reduction rating bonus from Luminance augmentation. |
| 335 | LumAugCritDamageRating | L | Critical damage rating bonus from Luminance augmentation. |
| 336 | LumAugCritReductionRating | L | Critical damage reduction rating bonus from Luminance augmentation. |
| 337 | LumAugSurgeEffectRating | L | Increased effect of Aetheria surges via Luminance augmentation. |
| 338 | LumAugSurgeChanceRating | L | Increased chance for Aetheria surges via Luminance augmentation. |
| 339 | LumAugItemManaUsage | L | Reduced item mana consumption via Luminance augmentation. |
| 340 | LumAugItemManaGain | L | Increased mana gained from Mana Stones via Luminance augmentation. |
| 341 | LumAugVitality | L | Bonus to maximum health/stamina/mana via Luminance augmentation. |
| 342 | LumAugHealingRating | L | Increased incoming healing effect via Luminance augmentation. |
| 343 | LumAugSkilledCraft | L | Bonus to crafting and tinkering skills via Luminance augmentation. |
| 344 | LumAugSkilledSpec | L | Bonus to specialized skills via Luminance augmentation. |
| 345 | LumAugNoDestroyCraft | | Chance to not destroy materials on failed crafting via Luminance augmentation. |
| 346 | RestrictInteraction | | |
| 347 | OlthoiLootTimestamp | L | Timestamp for Olthoi player loot availability. |
| 348 | OlthoiLootStep | | Progress step for Olthoi player loot quests. |
| 349 | UseCreatesContractId | | Contract/Quest ID created when the item is used (`ContractId`). |
| 350 | DotResistRating | L, A | Resistance rating against Damage Over Time effects. |
| 351 | LifeResistRating | L, A | Resistance rating against Life Magic effects. |
| 352 | CloakWeaveProc | A | Proc effect triggered by a cloak. |
| 353 | WeaponType | A | Specific technical category of the weapon (`WeaponType`). |
| 354 | MeleeMastery | L | Skill ID for specialized Melee Mastery. |
| 355 | RangedMastery | L | Skill ID for specialized Ranged Mastery. |
| 356 | SneakAttackRating | | Bonus rating for Sneak Attack performance. |
| 357 | RecklessnessRating | | Bonus rating for Recklessness performance. |
| 358 | DeceptionRating | | Bonus rating for Deception performance. |
| 359 | CombatPetRange | | |
| 360 | WeaponAuraDamage | L | Damage bonus provided by a weapon aura. |
| 361 | WeaponAuraSpeed | L | Speed bonus provided by a weapon aura. |
| 362 | SummoningMastery | L | Skill ID for specialized Summoning Mastery (`SummoningMastery`). |
| 363 | HeartbeatLifespan | | |
| 364 | UseLevelRequirement | | |
| 365 | LumAugAllSkills | L | Bonus to all skills from Luminance augmentation (max 10 stacks). |
| 366 | UseRequiresSkill | A | Skill ID required to use the object (`Skill`). |
| 367 | UseRequiresSkillLevel | A | Minimum skill level required to use the object. |
| 368 | UseRequiresSkillSpec | A | Indicates if the required skill must be specialized (`Skill`). |
| 369 | UseRequiresLevel | A | Minimum character level required to use the object. |
| 370 | GearDamage | L, A | Damage rating bonus provided by equipment/gear. |
| 371 | GearDamageResist | L, A | Damage reduction rating bonus provided by gear. |
| 372 | GearCrit | L, A | Critical hit chance bonus provided by gear. |
| 373 | GearCritResist | L, A | Critical hit resistance bonus provided by gear. |
| 374 | GearCritDamage | L, A | Critical damage bonus provided by gear. |
| 375 | GearCritDamageResist | L, A | Critical damage resistance bonus provided by gear. |
| 376 | GearHealingBoost | L, A | Healing performance bonus provided by gear. |
| 377 | GearNetherResist | L, A | Nether resistance bonus provided by gear. |
| 378 | GearLifeResist | L, A | Life magic resistance bonus provided by gear. |
| 379 | GearMaxHealth | L, A | Maximum health bonus provided by gear. |
| 8007 | PCAPRecordedAutonomousMovement | | Recorded autonomous movement state from capture. |
| 8030 | PCAPRecordedMaxVelocityEstimated | | Estimated max velocity from physics packets. |
| 8041 | PCAPRecordedPlacement | | Recorded placement vector from packet capture. |
| 8042 | PCAPRecordedAppraisalPages | | Recorded current appraisal page from capture. |
| 8043 | PCAPRecordedAppraisalMaxPages | | Recorded total appraisal pages from capture. |
| 381 | PKDamageRating | L, A | Damage rating bonus effective only in PK combat. |
| 382 | PKDamageResistRating | L, A | Damage reduction rating bonus effective only in PK combat. |
| 383 | GearPKDamageRating | L, A | PK damage rating bonus provided by gear. |
| 384 | GearPKDamageResistRating | L, A | PK damage reduction bonus provided by gear. |
| 386 | Overpower | L, A | Chance percentage for endgame creatures to overpower defenders. |
| 387 | OverpowerResist | L, A | Chance percentage to resist an overpower attempt. |
| 388 | GearOverpower | L, A | Overpower bonus provided by gear. |
| 389 | GearOverpowerResist | L, A | Overpower resistance bonus provided by gear. |
| 390 | Enlightenment | L, A | The number of times a character has undergone Enlightenment. |
| 9008 | CurrentLoyaltyAtLastLogoff | | Character's Loyalty skill value at the time of logoff. |
| 9009 | CurrentLeadershipAtLastLogoff | | Character's Leadership skill value at last logoff. |
| 9010 | AllegianceOfficerRank | | Specific officer rank within the monarchy structure. |
| 9011 | HouseRentTimestamp | | Timestamp when the next house maintenance/rent is due. |
| 9012 | Hairstyle | | ID for the character's active hairstyle. |
| 9013 | VisualClothingPriority | E | Visual override for layer ordering of clothing items. |
| 9014 | SquelchGlobal | | Bitfield or status for global chat squelching. |
| 9015 | InventoryOrder | | Client-side or server-side ordering of items in inventory. |


### PropertyFloat (Float / Double)
| ID | Name | Attr | Description |
|---|---|---|---|
| 1 | HeartbeatInterval | | Frequency in seconds of "Heartbeat" logic execution (e.g. enchantment decay). |
| 2 | HeartbeatTimestamp | E | Unix time of the last heartbeat execution. |
| 3 | HealthRate | | Rate of passive health regeneration per second. |
| 4 | StaminaRate | | Rate of passive stamina regeneration per second. |
| 5 | ManaRate | A | Rate of passive mana regeneration per second. |
| 6 | HealthUponResurrection | | Health percentage restored upon resurrection. |
| 7 | StaminaUponResurrection | | Stamina percentage restored upon resurrection. |
| 8 | ManaUponResurrection | | Mana percentage restored upon resurrection. |
| 9 | StartTime | | Unix time when a temporary object was instantiated. |
| 10 | StopTime | | Unix time when a temporary object will be destroyed. |
| 11 | ResetInterval | | Time in seconds for an object (like a chest) to refill/reset. |
| 12 | Shade | | Visual color tint modifier for the object's model. |
| 13 | ArmorModVsSlash | | Multiplier for armor effectiveness against Slashing damage. |
| 14 | ArmorModVsPierce | | Multiplier for armor effectiveness against Piercing damage. |
| 15 | ArmorModVsBludgeon | | Multiplier for armor effectiveness against Bludgeoning damage. |
| 16 | ArmorModVsCold | | Multiplier for armor effectiveness against Cold damage. |
| 17 | ArmorModVsFire | | Multiplier for armor effectiveness against Fire damage. |
| 18 | ArmorModVsAcid | | Multiplier for armor effectiveness against Acid damage. |
| 19 | ArmorModVsElectric | | Multiplier for armor effectiveness against Lightning damage. |
| 20 | CombatSpeed | | Modifier for the playback speed of combat animations. |
| 21 | WeaponLength | | Physical length in meters of a melee weapon for reach. |
| 22 | DamageVariance | | Spread between min and max damage for weapon calculations. |
| 23 | CurrentPowerMod | | Current temporary modifier to character power. |
| 24 | AccuracyMod | | Modifier applied to hit chance calculations. |
| 25 | StrengthMod | | Temporary multiplier for character Strength. |
| 26 | MaximumVelocity | | Physics: Speed cap for the object's movement (m/s). |
| 27 | RotationSpeed | | Physics: Speed at which the object can turn. |
| 28 | MotionTimestamp | | Unix time of the last recorded physics/movement update. |
| 29 | WeaponDefense | A | Defense bonus provided by the weapon when held. |
| 30 | WimpyLevel | | Health percentage at which a monster will attempt to flee combat. |
| 31 | VisualAwarenessRange | | Range in meters at which a creature can visually detect targets. |
| 32 | AuralAwarenessRange | | Range in meters at which a creature can hear targets. |
| 33 | PerceptionLevel | | Difficulty modifier for being detected by a creature. |
| 34 | PowerupTime | | AI delay in seconds before performing an action or attack. |
| 35 | MaxChargeDistance | | Max distance in meters an object can "charge" during movement. |
| 36 | ChargeSpeed | | Movement speed modifier during a "charge" state. |
| 37 | BuyPrice | | Economics: Unit price for purchasing from a vendor. |
| 38 | SellPrice | | Economics: Unit price for selling to a vendor. |
| 39 | DefaultScale | | Global scaling factor for the model size (1.0 = normal). |
| 40 | LockpickMod | | Modifier for lockpicking success chance on this object. |
| 41 | RegenerationInterval | | Time in seconds between vital regeneration ticks. |
| 42 | RegenerationTimestamp | | Unix time of the last regeneration tick. |
| 43 | GeneratorRadius | | Max radius in meters for a generator to spawn objects. |
| 44 | TimeToRot | | Seconds until a corpse or ground item decays. |
| 45 | DeathTimestamp | | Unix time when the creature was killed. |
| 46 | PkTimestamp | | Unix time when the character last entered PK status. |
| 47 | VictimTimestamp | | Unix time when the player was last PK'd. |
| 48 | LoginTimestamp | | Unix time of last player login. |
| 49 | CreationTimestamp | | Unix time when the entity record was created. |
| 50 | MinimumTimeSincePk | | Cooldown time in seconds required before leaving PK status. |
| 52 | AbuseLoggingTimestamp | | |
| 53 | LastPortalTeleportTimestamp | E | Unix time of the last portal traversal for cooldowns. |
| 54 | UseRadius | | Max distance in meters for interaction (default ~5.0m). |
| 55 | HomeRadius | | Radius in meters that a creature will return to from its spawn. |
| 56 | ReleasedTimestamp | | Unix time when an item was dropped on the ground. |
| 57 | MinHomeRadius | | Minimum distance a creature stays from its spawn point. |
| 58 | Facing | | Direction the object is facing (Radians). |
| 59 | ResetTimestamp | E | Unix time when an object was last reset (e.g. chest refill). |
| 60 | LogoffTimestamp | | Unix time of last logoff. |
| 61 | EconRecoveryInterval | | Seconds until a vendor's inventory/pricing recovers. |
| 62 | WeaponOffense | A | Offense bonus modifier provided by the weapon. |
| 63 | DamageMod | A | Final damage multiplier for weapon strikes. |
| 64 | ResistSlash | | Resistance multiplier for incoming Slashing damage. |
| 65 | ResistPierce | | Resistance multiplier for incoming Piercing damage. |
| 66 | ResistBludgeon | | Resistance multiplier for incoming Bludgeoning damage. |
| 67 | ResistFire | | Resistance multiplier for incoming Fire damage. |
| 68 | ResistCold | | Resistance multiplier for incoming Cold damage. |
| 69 | ResistAcid | | Resistance multiplier for incoming Acid damage. |
| 70 | ResistElectric | | Resistance multiplier for incoming Lightning damage. |
| 71 | ResistHealthBoost | | Resistance against incoming health restoration (heals). |
| 72 | ResistStaminaDrain | | Resistance against stamina-stealing effects. |
| 73 | ResistStaminaBoost | | Resistance against incoming stamina restoration. |
| 74 | ResistManaDrain | | Resistance against mana-stealing effects. |
| 75 | ResistManaBoost | | Resistance against incoming mana restoration. |
| 76 | Translucency | | Transparency level (0.0 = transparent, 1.0 = opaque). |
| 77 | PhysicsScriptIntensity | | Power multiplier for physics-based visual scripts. |
| 78 | Friction | | Surface friction coefficient for movement. |
| 79 | Elasticity | | Bounciness coefficient for movement. |
| 80 | AiUseMagicDelay | | AI specific delay in seconds between spell casts. |
| 81 | ItemMinSpellcraftMod | | Minimum modifier for spellcrafting on temporary items. |
| 82 | ItemMaxSpellcraftMod | | Maximum modifier for spellcrafting on temporary items. |
| 83 | ItemRankProbability | | Probability factor for item quality rank. |
| 84 | Shade2 | | Secondary color tint modifier. |
| 85 | Shade3 | | Tertiary color tint modifier. |
| 86 | Shade4 | | Quaternary color tint modifier. |
| 87 | ItemEfficiency | A | Efficiency factor for mana-consuming items. |
| 88 | ItemManaUpdateTimestamp | | Unix time of the last item mana update. |
| 89 | SpellGestureSpeedMod | | Multiplier for the speed of spell-casting hand gestures. |
| 90 | SpellStanceSpeedMod | | Multiplier for the speed of entering/exiting spell-stance. |
| 91 | AllegianceAppraisalTimestamp | | Unix time of the last allegiance-wide appraisal. |
| 92 | PowerLevel | | Combat: Value used to determine "Power" attack stance selection. |
| 93 | AccuracyLevel | | Combat: Value used to determine "Accuracy" attack stance selection. |
| 94 | AttackAngle | | Combat: Horizontal arc in degrees covered by an attack. |
| 95 | AttackTimestamp | | Unix time of the last attack action. |
| 96 | CheckpointTimestamp | | Unix time of the last state-save checkpoint. |
| 97 | SoldTimestamp | | Unix time the item was last sold to a vendor. |
| 98 | UseTimestamp | | Unix time the item was last used. |
| 99 | UseLockTimestamp | | Unix time when usage was locked (e.g. during another action). |
| 100 | HealkitMod | A | Effectiveness multiplier for healing kits. |
| 101 | FrozenTimestamp | | Unix time when the object was "frozen" or disabled. |
| 102 | HealthRateMod | | Multiplier for character health regeneration rate. |
| 103 | AllegianceSwearTimestamp | | Unix time when the player swore into the monarchy. |
| 104 | ObviousRadarRange | | Range in meters at which the object is always visible on radar. |
| 105 | HotspotCycleTime | | Time in seconds for a hotspot (AI target) to move. |
| 106 | HotspotCycleTimeVariance | | Random variance added to `HotspotCycleTime`. |
| 107 | SpamTimestamp | | Unix time check for anti-spam filters. |
| 108 | SpamRate | | Maximum allowed frequency for spam-checked actions. |
| 109 | BondWieldedTreasure | | |
| 110 | BulkMod | | Multiplier for the physical volume/bulk of the object. |
| 111 | SizeMod | | Secondary scale multiplier for the object. |
| 112 | GagTimestamp | | Unix time when a chat "gag" was applied. |
| 113 | GeneratorUpdateTimestamp | | Unix time of the last generator spawn check. |
| 114 | DeathSpamTimestamp | | Unix time of the last death global message. |
| 115 | DeathSpamRate | | Frequency cap for death-related announcements. |
| 116 | WildAttackProbability | | Percentage chance for a creature to perform a "Wild" attack. |
| 117 | FocusedProbability | | Percentage chance for a creature to perform a "Focused" attack. |
| 118 | CrashAndTurnProbability | | Probability of a runner "Crashing and Turning" when hitting obstacles. |
| 119 | CrashAndTurnRadius | | Radius for the "Crash and Turn" physics move. |
| 120 | CrashAndTurnBias | | Directional bias for "Crash and Turn". |
| 121 | GeneratorInitialDelay | | Delay in seconds before a generator starts its first cycle. |
| 122 | AiAcquireHealth | | AI threshold for health at which it seeks healing. |
| 123 | AiAcquireStamina | | AI threshold for stamina at which it seeks replenishment. |
| 124 | AiAcquireMana | | AI threshold for mana at which it seeks mana boost. |
| 125 | ResistHealthDrain | L | Resistance multiplier against life-stealing/draining spells. |
| 126 | LifestoneProtectionTimestamp | | Unix time until which lifestone protection is active. |
| 127 | AiCounteractEnchantment | | AI priority for dispelling incoming debuffs. |
| 128 | AiDispelEnchantment | | AI priority for dispelling specific buff types. |
| 129 | TradeTimestamp | | Unix time of the last trade interaction. |
| 130 | AiTargetedDetectionRadius | | Modifier for detection radius when targets are already being tracked. |
| 131 | EmotePriority | | Priority level for playing idle vs reactive emotes. |
| 132 | LastTeleportStartTimestamp | E | Unix time of the last teleportation start. |
| 133 | EventSpamTimestamp | | Unix time of the last triggered world event. |
| 134 | EventSpamRate | | Frequency cap for repetitive world events. |
| 135 | InventoryOffset | | Offset used for sorting items in a container. |
| 136 | CriticalMultiplier | A | Multiplier for damage on critical hits (default 2.0). |
| 137 | ManaStoneDestroyChance | A | Percentage chance for a mana stone to shatter on use. |
| 138 | SlayerDamageBonus | | Multiplier vs `SlayerCreatureType` targets. |
| 139 | AllegianceInfoSpamTimestamp | | |
| 140 | AllegianceInfoSpamRate | | |
| 141 | NextSpellcastTimestamp | | Unix time when the character can cast their next spell. |
| 142 | AppraisalRequestedTimestamp | E | Unix time when a remote appraisal was requested. |
| 143 | AppraisalHeartbeatDueTimestamp | | |
| 144 | ManaConversionMod | A | Efficiency modifier for the Mana Conversion skill. |
| 145 | LastPkAttackTimestamp | | Unix time of the last PK interaction for combat timers. |
| 146 | FellowshipUpdateTimestamp | | Unix time of last fellowship roster change. |
| 147 | CriticalFrequency | A | Bonus to critical hit chance rating. |
| 148 | LimboStartTimestamp | | Unix time when the entity entered Limbo (e.g. portal traversal). |
| 149 | WeaponMissileDefense | A | Missile Defense modifier provided by the weapon. |
| 150 | WeaponMagicDefense | A | Magic Defense modifier provided by the weapon. |
| 151 | IgnoreShield | | Percentage chance for the weapon to bypass shield block. |
| 152 | ElementalDamageMod | A | Multiplier for magical/elemental damage dealt. |
| 153 | StartMissileAttackTimestamp | | Unix time when a missile (bow/xbow) was aimed. |
| 154 | LastRareUsedTimestamp | | Unix time when the character last triggered a Rare item. |
| 155 | IgnoreArmor | A | Percentage of armor value bypassed by weapon strikes. |
| 156 | ProcSpellRate | | Percentage chance for an imbued spell to trigger on hit. |
| 157 | ResistanceModifier | A | Generic modifier for multiple secondary resistance types. |
| 158 | AllegianceGagTimestamp | | Unix time until character is gagged in monarchy chat. |
| 159 | AbsorbMagicDamage | A | Percentage of incoming spell damage reduced. |
| 160 | CachedMaxAbsorbMagicDamage | | Calculated cap for magic damage absorption. |
| 161 | GagDuration | | Duration in seconds of an active chat gag. |
| 162 | AllegianceGagDuration | | Duration in seconds of monarchy chat silence. |
| 163 | GlobalXpMod | L | Server-wide or character-wide experience multiplier. |
| 164 | HealingModifier | | Modifier for outgoing healing performance. |
| 165 | ArmorModVsNether | | Multiplier for armor effectiveness against Nether damage. |
| 166 | ResistNether | | Resistance multiplier for incoming Nether damage. |
| 167 | CooldownDuration | A | Wait time in seconds for item usage cooldown. |
| 168 | WeaponAuraOffense | L | Offense bonus rating from a specialized weapon aura. |
| 169 | WeaponAuraDefense | L | Defense bonus rating from an active aura. |
| 170 | WeaponAuraElemental | L | Elemental damage bonus rating from an aura. |
| 171 | WeaponAuraManaConv | L | Mana Conversion bonus rating from an aura. |
| 8004 | PCAPRecordedWorkmanship | | Recorded workmanship value from a packet capture. |
| 8010 | PCAPRecordedVelocityX | | Recorded X-velocity for physics validation. |
| 8011 | PCAPRecordedVelocityY | | Recorded Y-velocity. |
| 8012 | PCAPRecordedVelocityZ | | Recorded Z-velocity. |
| 8013 | PCAPRecordedAccelerationX | | Recorded X-acceleration. |
| 8014 | PCAPRecordedAccelerationY | | Recorded Y-acceleration. |
| 8015 | PCAPRecordedAccelerationZ | | Recorded Z-acceleration. |
| 8016 | PCAPRecordedOmegaX | | Recorded X-angular velocity. |
| 8017 | PCAPRecordedOmegaY | | Recorded Y-angular velocity. |
| 8018 | PCAPRecordedOmegaZ | | Recorded Z-angular velocity. |

### PropertyDataId (Data ID / DID)
| ID | Name | Attr | Description |
|---|---|---|---|
| 1 | Setup | | DAT ID for the object's 3D model and visual setup. |
| 2 | MotionTable | L | DAT ID for movement and animation state machine. |
| 3 | SoundTable | | DAT ID mapping sound effects to actions. |
| 4 | CombatTable | L | DAT ID for combat-specific animations and logic. |
| 5 | QualityFilter | | |
| 6 | PaletteBase | | DAT ID for the starting palette template. |
| 7 | ClothingBase | | DAT ID for the character's clothing base visual. |
| 8 | Icon | | DAT ID for the 2D icon displayed in inventory. |
| 9 | EyesTexture | A | DAT ID for the eye texture visual. |
| 10 | NoseTexture | A | DAT ID for the nose texture visual. |
| 11 | MouthTexture | A | DAT ID for the mouth texture visual. |
| 12 | DefaultEyesTexture | | |
| 13 | DefaultNoseTexture | | |
| 14 | DefaultMouthTexture | | |
| 15 | HairPalette | A | DAT ID for the character's hair color palette. |
| 16 | EyesPalette | A | DAT ID for the character's eye color palette. |
| 17 | SkinPalette | A | DAT ID for the character's skin tone palette. |
| 18 | HeadObject | | DAT ID for the object visual used for the head. |
| 19 | ActivationAnimation | | DAT ID (MotionCommand) for the activation animation. |
| 20 | InitMotion | | DAT ID (MotionCommand) for the initial spawn animation. |
| 21 | ActivationSound | | DAT ID (Sound) for the activation sound effect. |
| 22 | PhysicsEffectTable | | DAT ID mapping physics effects to the object. |
| 23 | UseSound | | DAT ID (Sound) for the sound played when the item is used. |
| 24 | UseTargetAnimation | | DAT ID (MotionCommand) for target animation. |
| 25 | UseTargetSuccessAnimation | | DAT ID (MotionCommand) for success animation. |
| 26 | UseTargetFailureAnimation | | DAT ID (MotionCommand) for failure animation. |
| 27 | UseUserAnimation | | DAT ID (MotionCommand) for the user's animation. |
| 28 | Spell | | DAT ID (SpellId) for a spell associated with the object. |
| 29 | SpellComponent | | DAT ID for a required spell component. |
| 30 | PhysicsScript | | DAT ID (PlayScript) for a physics script effect. |
| 31 | LinkedPortalOne | | DAT ID for the primary recall/portal destination. |
| 32 | WieldedTreasureType | | |
| 33 | InventoryTreasureType | | |
| 34 | ShopTreasureType | | DAT ID for the treasure generation template for a vendor's shop. |
| 35 | DeathTreasureType | | DAT ID for the treasure generation template used when killed. |
| 36 | MutateFilter | | DAT ID for a filter that transforms object properties. |
| 37 | ItemSkillLimit | | Skill ID relevant for item limits (`Skill`). |
| 38 | UseCreateItem | | Weenie ID of the item created when this object is used. |
| 39 | DeathSpell | | Spell ID (SpellId) triggered automatically upon death. |
| 40 | VendorsClassId | | DAT ID for the class definition of a vendor. |
| 41 | ItemSpecializedOnly | A | Skill ID that must be specialized to use this item (`Skill`). |
| 42 | HouseId | | Unique world ID for a player house. |
| 43 | AccountHouseId | | Permanent ID linking a character's account to their house. |
| 44 | RestrictionEffect | | DAT ID (PlayScript) for visual effects of usage restrictions. |
| 45 | CreationMutationFilter | | DAT ID for a mutation filter applied at object creation. |
| 46 | TsysMutationFilter | | DAT ID for mutation filters in the technical system (TSys). |
| 47 | LastPortal | | DAT ID for the location of the last used portal. |
| 48 | LinkedPortalTwo | | DAT ID for a secondary recall or portal destination. |
| 49 | OriginalPortal | | DAT ID for the object's original spawning portal location. |
| 50 | IconOverlay | | DAT ID for a visual overlay on the inventory icon. |
| 51 | IconOverlaySecondary | | DAT ID for a secondary icon overlay. |
| 52 | IconUnderlay | | DAT ID for a visual underlay behind the icon. |
| 53 | AugmentationMutationFilter | | DAT ID for filters involved in augmentation logic. |
| 54 | AugmentationEffect | | DAT ID for visual effects of an active augmentation. |
| 55 | ProcSpell | A | Spell ID (SpellId) for a spell triggered by hitting or using the item. |
| 56 | AugmentationCreateItem | | Weenie ID of an item created via augmentation. |
| 57 | AlternateCurrency | | Weenie ID for the currency accepted by a vendor. |
| 58 | BlueSurgeSpell | | Spell ID (SpellId) for the Blue Aetheria surge. |
| 59 | YellowSurgeSpell | | Spell ID (SpellId) for the Yellow Aetheria surge. |
| 60 | RedSurgeSpell | | Spell ID (SpellId) for the Red Aetheria surge. |
| 61 | OlthoiDeathTreasureType | | Treasure template specifically for Olthoi death drops. |
| 8001 | PCAPRecordedWeenieHeader | | Recorded Weenie Header from packet capture. |
| 8002 | PCAPRecordedWeenieHeader2 | | Secondary Weenie Header from packet capture. |
| 8003 | PCAPRecordedObjectDesc | | Recorded Object Description from packet capture. |
| 8005 | PCAPRecordedPhysicsDesc | | Recorded Physics Description from packet capture. |
| 8009 | PCAPRecordedParentLocation | | ParentLocation ID recorded in capture. |
| 8019 | PCAPRecordedDefaultScript | | Default script (MotionCommand) recorded from capture. |
| 8020-8029 | PCAPRecordedTimestamp0-9 | | Series of timestamps recorded for packet sequencing. |
| 8030 | PCAPRecordedMaxVelEstimated | | Estimated max velocity from physics packets. |
| 8044 | PCAPPhysicsDIDDataTemplatedFrom | | The original DID from which physics data was templated. |


### PropertyString (String)
| ID | Name | Attr | Description |
|---|---|---|---|
| 1 | Name | L | The display name of the object. |
| 2 | Title | | The active title of a character (default "Adventurer"). |
| 3 | Sex | | The gender of the character/creature. |
| 4 | HeritageGroup | | The race or background of the character. |
| 5 | Template | L, A | The technical template or weenie name of the object. |
| 6 | AttackersName | | Name of the last entity to attack this object. |
| 7 | Inscription | A | Custom text inscribed on the item. |
| 8 | ScribeName | A | Name of the player who wrote the inscription. |
| 9 | VendorsName | | Name of the vendor who currently owns this item. |
| 10 | Fellowship | A | Name of the fellowship the character is currently in. |
| 11 | MonarchsName | | Name of the character's monarchy leader. |
| 12 | LockCode | | Secret code / key ID required to unlock this object. |
| 13 | KeyCode | | Code matching a `LockCode` to allow unlocking. |
| 14 | Use | A | Instruction text displayed about how to use an item. |
| 15 | ShortDesc | A | A brief summary description and item stats shown in UI. |
| 16 | LongDesc | A | The detailed background/lore text shown upon appraisal. |
| 17 | ActivationTalk | | Text spoken by an NPC or object when activated. |
| 18 | UseMessage | | Message displayed to the user when they successfully use an item. |
| 19 | ItemHeritageGroupRestriction | | String specifying heritage restrictions for item usage. |
| 20 | PluralName | | The plural form of the object's name. |
| 21 | MonarchsTitle | A | The technical title of the character's monarch leader. |
| 22 | ActivationFailure | | Message displayed when object activation requirements fail. |
| 23 | ScribeAccount | A | The account name of the person who inscribed the item. |
| 24 | TownName | | The name of the town associated with a portal or item. |
| 25 | CraftsmanName | A | Name of the player who originally crafted the item. |
| 26 | UsePkServerError | | Error message when a non-PK tries to use a PK item. |
| 27 | ScoreCachedText | | Cached score display for leaderboards. |
| 28 | ScoreDefaultEntryFormat | | Formatting string for scoreboard entries. |
| 29 | ScoreFirstEntryFormat | | Formatting for the top scoreboard entry. |
| 30 | ScoreLastEntryFormat | | Formatting for the bottom scoreboard entry. |
| 31 | ScoreOnlyEntryFormat | | Formatting for a single scoreboard entry. |
| 32 | ScoreNoEntry | | Message shown when a scoreboard is empty. |
| 33 | Quest | | Technical name of a quest associated with the object. |
| 34 | GeneratorEvent | | Name of an event triggered by a world generator. |
| 35 | PatronsTitle | A | The formal title of the character's direct patron. |
| 36 | HouseOwnerName | | Name of the player who currently owns the house. |
| 37 | QuestRestriction | | Details of quest-based usage requirements. |
| 38 | AppraisalPortalDestination | A | Name of the destination for a portal (visible on appraisal). |
| 39 | TinkerName | A | Name of the most recent player to tinker with the item. |
| 40 | ImbuerName | A | Name of the most recent player to imbue the item. |
| 41 | HouseOwnerAccount | | Account name of the house owner. |
| 42 | DisplayName | | An override name used for specific UI display. |
| 43 | DateOfBirth | A | Timestamp or string representation of character creation. |
| 44 | ThirdPartyApi | | Integration hook for 3rd party tools/scripts. |
| 45 | KillQuest | | Tracked kill quest name or status. |
| 46 | Afk | E | The custom status message set by the player while AFK. |
| 47 | AllegianceName | A | The name of the player's monarchy/allegiance. |
| 48 | AugmentationAddQuest | | Associated quest name for applying augmentations. |
| 49 | KillQuest2 | | Secondary tracked kill quest. |
| 50 | KillQuest3 | | Tertiary tracked kill quest. |
| 51 | UseSendsSignal | | Technical signal code sent to world logic when used. |
| 52 | GearPlatingName | A | Name of the cosmic plating applied to the item. |
| 8006 | PCAPRecordedCurrentMotionState | | Physics state recorded from a packet capture. |
| 8031 | PCAPRecordedServerName | | Original server name from packet capture logs. |
| 8032 | PCAPRecordedCharacterName | | Original character name from packet capture logs. |
| 9001 | AllegianceMotd | | Allegiance Message of the Day. |
| 9002 | AllegianceMotdSetBy | | Name of the leader who set the Allegiance MOTD. |
| 9003 | AllegianceSpeakerTitle | | Custom title for the Allegiance Speaker rank. |
| 9004 | AllegianceSeneschalTitle | | Custom title for the Allegiance Seneschal rank. |
| 9005 | AllegianceCastellanTitle | | Custom title for the Allegiance Castellan rank. |
| 9006 | GodState | | Administrative field for tracking server state. |
| 9007 | TinkerLog | | Historical record of all tinkers and imbuings on an item. |
| 9005 | AllegianceCastellanTitle | | Custom title for the castellan. |
| 9006 | GodState | | |
| 9007 | TinkerLog | | CSV-like log of tinkering attempts on an item. |


### PropertyInstanceId (Instance ID / IID / GUID)
| ID | Name | Attr | Description |
|---|---|---|---|
| 1 | Owner | | GUID of the player who owns this item. |
| 2 | Container | | GUID of the container (backpack, chest) holding this object. |
| 3 | Wielder | | GUID of the player currently equipping/wielding this item. |
| 4 | Freezer | | GUID of the entity that froze/disabled this object. |
| 5 | Viewer | E | GUID of the character currently appraising/viewing this object. |
| 6 | Generator | E | GUID of the generator object that spawned this entity. |
| 7 | Scribe | | GUID of the character who inscribed the item. |
| 8 | CurrentCombatTarget | E | GUID of the entity currently targeted in combat. |
| 9 | CurrentEnemy | E | GUID of the entity currently considered the primary enemy. |
| 10 | ProjectileLauncher | | GUID of the launcher (e.g. bow) that fired this projectile. |
| 11 | CurrentAttacker | E | GUID of the most recent entity to attack. |
| 12 | CurrentDamager | E | GUID of the most recent entity to deal damage. |
| 13 | CurrentFollowTarget | E | GUID of the entity currently being followed. |
| 14 | CurrentAppraisalTarget | E | GUID of the entity being appraised. |
| 15 | CurrentFellowshipAppraisalTarget | E | GUID of the fellowship member being appraised for stats. |
| 16 | ActivationTarget | | GUID of the target for an activation event. |
| 17 | Creator | | GUID of the player who crafted or created this item. |
| 18 | Victim | | GUID of the victim in a combat or PK event. |
| 19 | Killer | | GUID of the killer in a combat or PK event. |
| 20 | Vendor | | GUID of the vendor currently being interacted with. |
| 21 | Customer | | GUID of the player currently shopping at a vendor. |
| 22 | Bonded | | GUID of the character this item is permanently bonded to. |
| 23 | Wounder | | GUID of the entity that inflicted a specific wound. |
| 24 | Allegiance | L | GUID of the character's direct Allegiance/Monarchy link. |
| 25 | Patron | L | GUID of the character's direct Patron. |
| 26 | Monarch | | GUID of the character's Monarch (top of the monarchy tree). |
| 27 | CombatTarget | E | GUID used internally for combat targeting logic. |
| 28 | HealthQueryTarget | E | GUID for the target whose health is being queried by UI. |
| 29 | LastUnlocker | E | GUID of the last character who successfully unlocked this object. |
| 30 | CrashAndTurnTarget | | GUID of the obstacle used for "Crash and Turn" physics. |
| 31 | AllowedActivator | | GUID of the only character allowed to activate the object. |
| 32 | HouseOwner | | GUID of the player owning the house. |
| 33 | House | | GUID of the house instance itself. |
| 34 | Slumlord | | GUID of the entity managing a rental or house. |
| 35 | ManaQueryTarget | E | GUID for the target whose mana is being queried by UI. |
| 36 | CurrentGame | | GUID of the active minigame (e.g. Chess) instance. |
| 37 | RequestedAppraisalTarget | E | GUID of target requested for appraisal. |
| 38 | AllowedWielder | | GUID of the only character allowed to equip/wield the item. |
| 39 | AssignedTarget | | GUID of a target assigned by a generator or quest. |
| 40 | LimboSource | | GUID of the source that sent the entity into Limbo. |
| 41 | Snooper | | GUID of the player inspecting another's inventory. |
| 42 | TeleportedCharacter | | GUID of character being teleported. |
| 43 | Pet | E | GUID of the character's active combat pet. |
| 44 | PetOwner | | GUID of the owner of the pet. |
| 45 | PetDevice | E | GUID of the device/item that summoned the pet. |
| 8000 | PCAPRecordedObjectIID | | Recorded Object Instance ID from packet capture. |
| 8008 | PCAPRecordedParentIID | | Recorded Parent Instance ID from packet capture. |
| 37 | RequestedAppraisalTarget | E | |
| 38 | AllowedWielder | | |
| 39 | AssignedTarget | | |
| 40 | LimboSource | | |
| 41 | Snooper | | |
| 42 | TeleportedCharacter | | |
| 43 | Pet | E | GUID of the player's currently active pet. |
| 44 | PetOwner | | |
| 45 | PetDevice | E | |

### PropertyInt64 (64-bit Integer)
| ID | Name | Attr | Description |
|---|---|---|---|
| 1 | TotalExperience | L | Cumulative experience earned by the character. |
| 2 | AvailableExperience | L | Current unspent experience points. |
| 3 | AugmentationCost | A | Experience cost for the next augmentation. |
| 4 | ItemTotalXp | A | Total experience invested in or earned by an item. |
| 5 | ItemBaseXp | A | |
| 6 | AvailableLuminance | L | Current unspent Luminance points. |
| 7 | MaximumLuminance | L | Total Luminance points ever earned. |
| 8 | InteractionReqs | | |
| 9000 | AllegianceXPCached | | |
| 9001 | AllegianceXPGenerated | | |
| 9002 | AllegianceXPReceived | | |
| 9003 | VerifyXp | | |



---

## 4. Enum Value Reference
These tables provide the mapping for integer values used in various `PropertyInt` fields.

### CreatureType
Used in `CreatureType` (2), `SlayerCreatureType` (166), `FoeType` (73), and `FriendType` (72).

| Value | Name | Value | Name |
|---|---|---|---|
| 0 | Invalid | 52 | Empyrean |
| 1 | Olthoi | 53 | Hopeslayer |
| 2 | Banderling | 54 | Doll |
| 3 | Drudge | 55 | Marionette |
| 4 | Mosswart | 56 | Carenzi |
| 5 | Lugian | 57 | Siraluun |
| 6 | Tumerok | 58 | AunTumerok |
| 7 | Mite | 59 | HeaTumerok |
| 8 | Tusker | 60 | Simulacrum |
| 9 | PhyntosWasp | 61 | AcidElemental |
| 10 | Rat | 62 | FrostElemental |
| 11 | Auroch | 63 | Elemental |
| 12 | Cow | 64 | Statue |
| 13 | Golem | 65 | Wall |
| 14 | Undead | 66 | AlteredHuman |
| 15 | Gromnie | 67 | Device |
| 16 | Reedshark | 68 | Harbinger |
| 17 | Armoredillo | 69 | DarkSarcophagus |
| 18 | Fae | 70 | Chicken |
| 19 | Virindi | 71 | GotrokLugian |
| 20 | Wisp | 72 | Margul |
| 21 | Knathtead | 73 | BleachedRabbit |
| 22 | Shadow | 74 | NastyRabbit |
| 23 | Mattekar | 75 | GrimacingRabbit |
| 24 | Mumiyah | 76 | Burun |
| 25 | Rabbit | 77 | Target |
| 26 | Sclavus | 78 | Ghost |
| 27 | ShallowsShark | 79 | Fiun |
| 28 | Monouga | 80 | Eater |
| 29 | Zefir | 81 | Penguin |
| 30 | Skeleton | 82 | Ruschk |
| 31 | Human | 83 | Thrungus |
| 32 | Shreth | 84 | ViamontianKnight |
| 33 | Chittick | 85 | Remoran |
| 34 | Moarsman | 86 | Swarm |
| 35 | OlthoiLarvae | 87 | Moar |
| 36 | Slithis | 88 | EnchantedArms |
| 37 | Deru | 89 | Sleech |
| 38 | FireElemental | 90 | Mukkir |
| 39 | Snowman | 91 | Merwart |
| 40 | Unknown | 92 | Food |
| 41 | Bunny | 93 | ParadoxOlthoi |
| 42 | LightningElemental | 94 | Harvest |
| 43 | Rockslide | 95 | Energy |
| 44 | Grievver | 96 | Apparition |
| 45 | Niffis | 97 | Aerbax |
| 46 | Ursuin | 98 | Touched |
| 47 | Crystal | 99 | BlightedMoarsman |
| 48 | HollowMinion | 100 | GearKnight |
| 49 | Scarecrow | 101 | Gurog |
| 50 | Idol | 102 | Anekshay |

### WeaponType
Used in `WeaponType` (353).

| Value | Name |
|---|---|
| 0 | Undef |
| 1 | Unarmed |
| 2 | Sword |
| 3 | Axe |
| 4 | Mace |
| 5 | Spear |
| 6 | Dagger |
| 7 | Staff |
| 8 | Bow |
| 9 | Crossbow |
| 10 | Thrown |
| 11 | TwoHanded |
| 12 | Magic |

### ItemType
Used in `ItemType` (1). This is a bitmask.

| Bit (Hex) | Name |
|---|---|
| 0x01 | MeleeWeapon |
| 0x02 | Armor |
| 0x04 | Clothing |
| 0x08 | Jewelry |
| 0x10 | Creature |
| 0x20 | Food |
| 0x40 | Money |
| 0x80 | Misc |
| 0x100 | MissileWeapon |
| 0x200 | Container |
| 0x400 | Useless |
| 0x800 | Gem |
| 0x1000 | SpellComponents |
| 0x2000 | Writable |
| 0x4000 | Key |
| 0x8000 | Caster |
| 0x10000 | Portal |
| 0x20000 | Lockable |
| 0x40000 | PromissoryNote |
| 0x80000 | ManaStone |
| 0x100000 | Service |
| 0x200000 | MagicWieldable |
| 0x10000000 | LifeStone |
| 0x20000000 | TinkeringTool |
| 0x40000000 | TinkeringMaterial |
| 0x80000000 | Gameboard |

### DamageType
Used in `DamageType` (45). This is a bitmask.

| Bit (Hex) | Name |
|---|---|
| 0x01 | Slash |
| 0x02 | Pierce |
| 0x04 | Bludgeon |
| 0x08 | Cold |
| 0x10 | Fire |
| 0x20 | Acid |
| 0x40 | Electric |
| 0x80 | Health |
| 0x100 | Stamina |
| 0x200 | Mana |
| 0x400 | Nether |
| 0x10000000 | Base |

### CombatMode
Used in `CombatMode` (40). This is a bitmask.

| Bit (Hex) | Name |
|---|---|
| 0x01 | NonCombat |
| 0x02 | Melee |
| 0x04 | Missile |
| 0x08 | Magic |

### Skill
Used in `WeaponSkill` (48), `WieldSkillType` (159), etc.

| Value | Name | Value | Name |
|---|---|---|---|
| 0 | None | 28 | WeaponTinkering |
| 1 | Axe (Retired) | 29 | ArmorTinkering |
| 2 | Bow (Retired) | 30 | MagicItemTinkering |
| 3 | Crossbow (Retired) | 31 | CreatureEnchantment |
| 4 | Dagger (Retired) | 32 | ItemEnchantment |
| 5 | Mace (Retired) | 33 | LifeMagic |
| 6 | MeleeDefense | 34 | WarMagic |
| 7 | MissileDefense | 35 | Leadership |
| 8 | Sling (Retired) | 36 | Loyalty |
| 9 | Spear (Retired) | 37 | Fletching |
| 10 | Staff (Retired) | 38 | Alchemy |
| 11 | Sword (Retired) | 39 | Cooking |
| 12 | ThrownWeapon (Retired) | 40 | Salvaging |
| 13 | UnarmedCombat (Retired) | 41 | TwoHandedCombat |
| 14 | ArcaneLore | 42 | Gearcraft (Retired) |
| 15 | MagicDefense | 43 | VoidMagic |
| 16 | ManaConversion | 44 | HeavyWeapons |
| 17 | Spellcraft (Unused) | 45 | LightWeapons |
| 18 | ItemTinkering | 46 | FinesseWeapons |
| 19 | AssessPerson | 47 | MissileWeapons |
| 20 | Deception | 48 | Shield |
| 21 | Healing | 49 | DualWield |
| 22 | Jump | 50 | Recklessness |
| 23 | Lockpick | 51 | SneakAttack |
| 24 | Run | 52 | DirtyFighting |
| 25 | Awareness (Unused) | 53 | Challenge (Unused) |
| 26 | ArmsAndArmorRepair (Unused) | 54 | Summoning |
| 27 | AssessCreature | | |

### Attribute
The six primary character attributes.

| ID | Name | ID | Name |
|---|---|---|---|
| 1 | Strength | 4 | Quickness |
| 2 | Endurance | 5 | Focus |
| 3 | Coordination | 6 | Self |

### PropertyAttribute2nd
Used in `BoosterEnum` (89).

| Value | Name |
|---|---|
| 1 | MaxHealth |
| 2 | Health |
| 3 | MaxStamina |
| 4 | Stamina |
| 5 | MaxMana |
| 6 | Mana |

### WieldRequirement
Used in `WieldRequirements` (158, 270, 273, 276).

| Value | Name | Description |
|---|---|---|
| 1 | Skill | Requires a minimum skill level. |
| 2 | RawSkill | Requires a minimum base skill (without buffs). |
| 3 | Attrib | Requires a minimum attribute value. |
| 4 | RawAttrib | Requires a minimum base attribute. |
| 5 | SecondaryAttrib | Requires a minimum health/stamina/mana. |
| 6 | RawSecondaryAttrib | Requires a minimum base health/stamina/mana. |
| 7 | Level | Requires a minimum character level. |
| 8 | Training | Requires a skill to be trained or specialized. |
| 9 | IntStat | Matches a specific `PropertyInt` value. |
| 10 | BoolStat | Matches a specific `PropertyBool` value. |
| 11 | CreatureType | Requires specific `CreatureType`. |
| 12 | HeritageType | Requires specific `HeritageGroup`. |

### EquipMask
Used in `ValidLocations` (9) and `CurrentWieldedLocation` (10). This is a bitmask.

| Bit (Hex) | Name | Bit (Hex) | Name |
|---|---|---|---|
| 0x01 | HeadWear | 0x200 | ChestArmor |
| 0x02 | ChestWear | 0x400 | AbdomenArmor |
| 0x04 | AbdomenWear | 0x800 | UpperArmArmor |
| 0x08 | UpperArmWear | 0x1000 | LowerArmArmor |
| 0x10 | LowerArmWear | 0x2000 | UpperLegArmor |
| 0x20 | HandWear | 0x4000 | LowerLegArmor |
| 0x40 | UpperLegWear | 0x8000 | NeckWear |
| 0x80 | LowerLegWear | 0x10000 | WristWearLeft |
| 0x100 | FootWear | 0x20000 | WristWearRight |
| 0x40000 | FingerWearLeft| 0x80000 | FingerWearRight |
| 0x100000 | MeleeWeapon | 0x200000 | Shield |
| 0x400000 | MissileWeapon | 0x800000 | MissileAmmo |
| 0x1000000 | Held | 0x2000000 | TwoHanded |
| 0x4000000 | TrinketOne | 0x8000000 | Cloak |
| 0x10000000 | SigilOne | 0x20000000 | SigilTwo |
| 0x40000000 | SigilThree | | |

### AetheriaBitfield
Used in `AetheriaBitfield` (322). This is a bitmask.

| Bit (Hex) | Name |
|---|---|
| 0x1 | Blue |
| 0x2 | Yellow |
| 0x4 | Red |

### CreatureFlag
Used in the `ObjectCreate` message. This is a bitmask.

| Bit (Hex) | Name | Description |
|---|---|---|
| 0x01 | HasDetailedAppraisal | Indicates the creature has extra appraisal data. |
| 0x02 | IsNpc | Entity is a Non-Player Character. |
| 0x04 | IsPlayer | Entity is a Player Character. |
| 0x08 | IsVendor | Entity is a Vendor. |
| 0x10 | Unknown_10 | |
| 0x20 | IsPkid | |
| 0x40 | IsPk | Entity is a Player Killer. |
| 0x80 | IsNp | |
| 0x100 | IsFellowship | |
| 0x200 | IsAppraisalRoof | |

### StatusFlag
Used in the `ObjectCreate` message. This is a bitmask.

| Bit (Hex) | Name | Description |
|---|---|---|
| 0x00 | Normal | Default state. |
| 0x01 | Hidden | Object is not visible to most players. |
| 0x04 | Ghost | Object is in a ghost/death state. |
| 0x08 | IsPortaling | Object is currently in a portal transition. |
| 0x10 | OutOfSelectionRange | Object is too far to be selected. |
| 0x20 | IsCorpse | Object is a corpse. |
| 0x40 | IsLifestone | Object is a lifestone. |
| 0x80 | IsLifestoneWithGhost | |
| 0x100 | IsLifestoneWithAvatar | |
| 0x200 | IsPortal | Object is a portal. |
| 0x400 | IsAdmin | |
| 0x1000 | IsSentinal | |
| 0x2000 | IsAdvocate | |
| 0x4000 | ContactAdmin | |
| 0x8000 | IsCaster | Entity is a magic caster. |
| 0x10000 | IsPkid | |
| 0x20000 | IsPk | |
| 0x40000 | IsNp | |
| 0x100000 | IsFellowship | |
| 0x200000 | IsAppraisalRoof | |
| 0x400000 | IsAllegianceRoof | |
| 0x800000 | InHonor | |
| 0x1000000 | InQuest | |
