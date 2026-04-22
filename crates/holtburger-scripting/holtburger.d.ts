type JsonPrimitive = string | number | boolean | null;
interface JsonObject {
  [key: string]: any;
}
interface JsonArray extends Array<any> {}
type JsonValue = JsonPrimitive | JsonObject | JsonArray;

type ScriptPostErrorCode =
  | "invalid_request"
  | "policy_denied"
  | "timeout"
  | "transport"
  | "response_too_large"
  | "invalid_json_response";

interface ScriptPostRequest {
  url: string;
  bodyJson?: JsonValue;
  timeoutMs?: number;
}

interface ScriptPostResponse {
  ok: boolean;
  status: number;
  bodyJson: JsonValue | null;
}

interface ScriptPostError extends Error {
  code: ScriptPostErrorCode;
}

type Guid = number;

type PropertyBool = number;
type PropertyInt = number;
type PropertyInt64 = number;
type PropertyFloat = number;
type PropertyString = number;
type PropertyDataId = number;
type PropertyInstanceId = number;

type ScriptMessageStyleInput =
  | "trace"
  | "debug"
  | "info"
  | "warn"
  | "warning"
  | "error"
  | "system"
  | "chat"
  | "combat"
  | "tell"
  | "emote"
  | "party"
  | "guild"
  | "trade"
  | "help"
  | "society"
  | "magic";
type ScriptEntityKind =
  | "player"
  | "npc"
  | "vendor"
  | "monster"
  | "weapon"
  | "apparel"
  | "container"
  | "item"
  | "consumable"
  | "money"
  | "key"
  | "writable"
  | "healing_kit"
  | "mana_stone"
  | "door"
  | "portal"
  | "life_stone"
  | "chest"
  | "wand"
  | "tool"
  | "static_object"
  | "unknown";

type ScriptEquipmentSlotKind =
  | "head_wear"
  | "chest_wear"
  | "abdomen_wear"
  | "upper_arm_wear"
  | "lower_arm_wear"
  | "hand_wear"
  | "upper_leg_wear"
  | "lower_leg_wear"
  | "foot_wear"
  | "chest_armor"
  | "abdomen_armor"
  | "upper_arm_armor"
  | "lower_arm_armor"
  | "upper_leg_armor"
  | "lower_leg_armor"
  | "neck_wear"
  | "left_wrist"
  | "right_wrist"
  | "left_finger"
  | "right_finger"
  | "melee_weapon"
  | "shield"
  | "missile_weapon"
  | "missile_ammo"
  | "caster"
  | "two_handed"
  | "trinket_one"
  | "cloak"
  | "sigil_one"
  | "sigil_two"
  | "sigil_three";

type ScriptBusyOperation =
  | "none"
  | "use"
  | "use_with_target"
  | "salvage"
  | "spell_cast"
  | "buy"
  | "sell";

type ScriptChatChannelKind =
  | "Say"
  | "Tell"
  | "Emote"
  | "Fellowship"
  | "Allegiance"
  | "Vassals"
  | "Patron"
  | "Monarch"
  | "CoVassals"
  | "General"
  | "Trade"
  | "Lfg"
  | "Roleplay"
  | "Society"
  | "Olthoi"
  | "System"
  | "Unknown";

type AttackHeight = "High" | "Medium" | "Low";

type CombatMode = "Undef" | "NonCombat" | "Melee" | "Missile" | "Magic";

type ConfirmationType =
  | "Undefined"
  | "SwearAllegiance"
  | "AlterSkill"
  | "AlterAttribute"
  | "Fellowship"
  | "CraftInteraction"
  | "Augmentation"
  | "YesNo";

type AttributeType =
  | "StrengthAttr"
  | "EnduranceAttr"
  | "QuicknessAttr"
  | "CoordinationAttr"
  | "FocusAttr"
  | "SelfAttr";

type VitalType = "Health" | "Stamina" | "Mana";

type TrainingLevel = "Unusable" | "Untrained" | "Trained" | "Specialized";

type SkillType =
  | "Axe"
  | "Bow"
  | "Crossbow"
  | "Dagger"
  | "Mace"
  | "MeleeDefense"
  | "MissileDefense"
  | "Sling"
  | "Spear"
  | "Staff"
  | "Sword"
  | "ThrownWeapon"
  | "UnarmedCombat"
  | "ArcaneLore"
  | "MagicDefense"
  | "ManaConversion"
  | "Spellcraft"
  | "ItemTinkering"
  | "AssessPerson"
  | "Deception"
  | "Healing"
  | "Jump"
  | "Lockpick"
  | "Run"
  | "Awareness"
  | "ArmsAndArmorRepair"
  | "AssessCreature"
  | "WeaponTinkering"
  | "ArmorTinkering"
  | "MagicItemTinkering"
  | "CreatureEnchantment"
  | "ItemEnchantment"
  | "LifeMagic"
  | "WarMagic"
  | "Leadership"
  | "Loyalty"
  | "Fletching"
  | "Alchemy"
  | "Cooking"
  | "Salvaging"
  | "TwoHandedCombat"
  | "Gearcraft"
  | "VoidMagic"
  | "HeavyWeapons"
  | "LightWeapons"
  | "FinesseWeapons"
  | "MissileWeapons"
  | "Shield"
  | "DualWield"
  | "Recklessness"
  | "SneakAttack"
  | "DirtyFighting"
  | "Challenge"
  | "Summoning";

type WeenieError = string;
type DamageType = number;
type AttackConditions = number;
type DamageLocation = number;

type ScriptLocalConfirmationKind = { kind: "unswear" } | { kind: "other"; data: string };

interface Vector3 {
  x: number;
  y: number;
  z: number;
}

interface Quaternion {
  w: number;
  x: number;
  y: number;
  z: number;
}

interface WorldPosition {
  landblockId: Guid;
  coords: Vector3;
  rotation: Quaternion;
}

type ScriptPositionRef = Guid | WorldPosition;

interface ScriptSelfView {
  guid: Guid;
  name: string;
  position: WorldPosition;
  health: number;
  healthMax: number;
  stamina: number;
  staminaMax: number;
  mana: number;
  manaMax: number;
  encumbrance: number;
  capacity: number;
  busyOperation: ScriptBusyOperation;
  heading: number;
  combatMode: CombatMode;
}

interface ScriptCharacterSheetView {
  attributes: ScriptCharacterAttributeView[];
  vitals: ScriptCharacterVitalView[];
  skills: ScriptCharacterSkillView[];
}

interface ScriptCharacterAttributeView {
  attributeType: AttributeType;
  base: number;
  effective: number;
}

interface ScriptCharacterVitalView {
  vitalType: VitalType;
  base: number;
  effective: number;
  current: number;
}

interface ScriptCharacterSkillView {
  skillType: SkillType;
  base: number;
  effective: number;
  training: TrainingLevel;
}

interface ScriptCombatInfo {
  combatMode: CombatMode;
  isEngaged: boolean;
  target: Guid | null;
  power: number;
  height: AttackHeight;
  lastAttackTime: number | null;
}

interface ScriptClientInteractionTargetEntity {
  kind: "TargetEntity";
  data: {
    guid: Guid;
  };
}

interface ScriptClientInteractionApproach {
  kind: "Approach";
  data: {
    guid: Guid;
  };
}

interface ScriptClientInteractionFollow {
  kind: "Follow";
  data: {
    guid: Guid;
  };
}

interface ScriptClientInteractionAttack {
  kind: "Attack";
  data: {
    guid: Guid;
  };
}

type ScriptClientInteraction =
  | ScriptClientInteractionTargetEntity
  | ScriptClientInteractionApproach
  | ScriptClientInteractionFollow
  | ScriptClientInteractionAttack;

interface ScriptEnchantmentView {
  spellId: number;
  endTime: number;
}

interface ArmorProfile {
  slashing: number;
  piercing: number;
  bludgeoning: number;
  cold: number;
  fire: number;
  acid: number;
  nether: number;
  lightning: number;
}

interface CreatureAttributes {
  strength: number;
  endurance: number;
  quickness: number;
  coordination: number;
  focus: number;
  selfAttr: number;
  stamina: number;
  mana: number;
  staminaMax: number;
  manaMax: number;
}

interface CreatureBuffs {
  highlights: number;
  colors: number;
}

interface CreatureProfile {
  flags: number;
  health: number;
  healthMax: number;
  attributes: CreatureAttributes | null;
  buffs: CreatureBuffs | null;
}

interface WeaponProfile {
  damageType: number;
  weaponTime: number;
  weaponSkill: number;
  damage: number;
  damageVariance: number;
  damageMod: number;
  weaponLength: number;
  maxVelocity: number;
  weaponOffense: number;
  maxVelocityEstimated: number;
}

interface ScriptEntityArmorProfile {
  kind: "armor";
  data: ArmorProfile;
}

interface ScriptEntityCreatureProfile {
  kind: "creature";
  data: CreatureProfile;
}

interface ScriptEntityWeaponProfile {
  kind: "weapon";
  data: WeaponProfile;
}

// Serialized with the Rust enum variant names.
type ScriptEntityProfile =
  | ScriptEntityArmorProfile
  | ScriptEntityCreatureProfile
  | ScriptEntityWeaponProfile;

interface ScriptMotionCommandNone {
  kind: "none";
}

interface ScriptMotionCommandStop {
  kind: "stop";
}

interface ScriptMotionCommandWalkForward {
  kind: "walk_forward";
}

interface ScriptMotionCommandWalkBackwards {
  kind: "walk_backwards";
}

interface ScriptMotionCommandRunForward {
  kind: "run_forward";
}

interface ScriptMotionCommandTurnRight {
  kind: "turn_right";
}

interface ScriptMotionCommandTurnLeft {
  kind: "turn_left";
}

interface ScriptMotionCommandSidestepRight {
  kind: "sidestep_right";
}

interface ScriptMotionCommandSidestepLeft {
  kind: "sidestep_left";
}

interface ScriptMotionCommandDead {
  kind: "dead";
}

interface ScriptMotionCommandOther {
  kind: "other";
  data: number;
}

type ScriptMotionCommand =
  | ScriptMotionCommandNone
  | ScriptMotionCommandStop
  | ScriptMotionCommandWalkForward
  | ScriptMotionCommandWalkBackwards
  | ScriptMotionCommandRunForward
  | ScriptMotionCommandTurnRight
  | ScriptMotionCommandTurnLeft
  | ScriptMotionCommandSidestepRight
  | ScriptMotionCommandSidestepLeft
  | ScriptMotionCommandDead
  | ScriptMotionCommandOther;

interface ScriptEntityView {
  guid: Guid;
  name: string | null;
  kind: ScriptEntityKind;
  weenieId: number | null;
  position: WorldPosition;
  profile: ScriptEntityProfile | null;
  container: Guid;
  wielder: Guid;
  distanceToSelf: number;
  motionCommand: ScriptMotionCommand;
}

interface ScriptContainerView {
  containerGuid: Guid;
  slots: number;
  items: Guid[];
}

interface ScriptEquipmentSlotState {
  equipMask: number;
  itemGuid: Guid | null;
}

interface ScriptTradeInfo {
  partnerGuid: Guid;
  partnerName: string | null;
  ourItems: Guid[];
  theirItems: Guid[];
}

interface ScriptPartyMemberView {
  guid: Guid;
  name: string | null;
  healthPercent: number | null;
  staminaPercent: number | null;
  manaPercent: number | null;
}

interface ScriptPartyView {
  leaderGuid: Guid;
  members: ScriptPartyMemberView[];
}

interface ScriptChatEvent {
  channel: ScriptChatChannelKind;
  sender: string | null;
  message: string;
}

interface ActiveCharacterConfirmation {
  confirmation_type: ConfirmationType;
  context: number;
  text: string;
}

interface ScriptCharacterConfirmation {
  kind: "character";
  data: ActiveCharacterConfirmation;
}

interface ScriptLocalConfirmation {
  kind: ScriptLocalConfirmationKind;
  text: string;
}

interface ScriptLocalConfirmationWrapper {
  kind: "local";
  data: ScriptLocalConfirmation;
}

type ScriptConfirmation = ScriptCharacterConfirmation | ScriptLocalConfirmationWrapper;

interface ScriptLifecycleStartedEvent {
  kind: "started";
  data: {
    args: string;
  };
}

interface ScriptLifecycleStoppedEvent {
  kind: "stopped";
}

interface ScriptLifecycleTickEvent {
  kind: "tick";
  data: {
    elapsedSeconds: number;
  };
}

type ScriptLifecycleEvent =
  | ScriptLifecycleStartedEvent
  | ScriptLifecycleStoppedEvent
  | ScriptLifecycleTickEvent;

interface ScriptWorkflowConfirmationOpenedEvent {
  kind: "confirmation_opened";
  data: {
    confirmation: ScriptConfirmation;
  };
}

interface ScriptWorkflowConfirmationClosedEvent {
  kind: "confirmation_closed";
}

interface ScriptWorkflowBusyOperationChangedEvent {
  kind: "busy_operation_changed";
  data: {
    busy: ScriptBusyOperation;
  };
}

interface ScriptWorkflowTargetEntityChangedEvent {
  kind: "target_entity_changed";
  data: {
    guid: Guid | null;
  };
}

type ScriptWorkflowEvent =
  | ScriptWorkflowConfirmationOpenedEvent
  | ScriptWorkflowConfirmationClosedEvent
  | ScriptWorkflowBusyOperationChangedEvent
  | ScriptWorkflowTargetEntityChangedEvent;

interface ScriptChatMessageEvent {
  kind: "chat_message";
  data: ScriptChatEvent;
}

interface ScriptCombatFeedbackAttackDone {
  kind: "attack_done";
  data: {
    error: WeenieError;
  };
}

interface ScriptCombatFeedbackAttackCommenced {
  kind: "attack_commenced";
}

interface ScriptCombatFeedbackAttackerNotification {
  kind: "attacker_notification";
  data: {
    defender_name: string;
    damage_type: DamageType;
    health_percent: number;
    damage: number;
    critical_hit: boolean;
    attack_conditions: AttackConditions;
  };
}

interface ScriptCombatFeedbackDefenderNotification {
  kind: "defender_notification";
  data: {
    attacker_name: string;
    damage_type: DamageType;
    health_percent: number;
    damage: number;
    damage_location: DamageLocation;
    critical_hit: boolean;
    attack_conditions: AttackConditions;
  };
}

interface ScriptCombatFeedbackEvasionAttackerNotification {
  kind: "evasion_attacker_notification";
  data: {
    defender_name: string;
  };
}

interface ScriptCombatFeedbackEvasionDefenderNotification {
  kind: "evasion_defender_notification";
  data: {
    attacker_name: string;
  };
}

interface ScriptCombatFeedbackVictimNotification {
  kind: "victim_notification";
  data: {
    death_message: string;
  };
}

interface ScriptCombatFeedbackKillerNotification {
  kind: "killer_notification";
  data: {
    death_message: string;
  };
}

type ScriptCombatFeedback =
  | ScriptCombatFeedbackAttackDone
  | ScriptCombatFeedbackAttackCommenced
  | ScriptCombatFeedbackAttackerNotification
  | ScriptCombatFeedbackDefenderNotification
  | ScriptCombatFeedbackEvasionAttackerNotification
  | ScriptCombatFeedbackEvasionDefenderNotification
  | ScriptCombatFeedbackVictimNotification
  | ScriptCombatFeedbackKillerNotification;

interface ScriptCombatFeedbackEvent {
  kind: "combat_feedback";
  data: ScriptCombatFeedback;
}

interface ScriptEventLifecycle {
  kind: "lifecycle";
  data: ScriptLifecycleEvent;
}

interface ScriptEventWorkflow {
  kind: "workflow";
  data: ScriptWorkflowEvent;
}

interface ScriptEventCommand {
  kind: "command";
  data: {
    msg: string;
  };
}

interface ScriptEventWeenieError {
  kind: "weenie_error";
  data: {
    error: WeenieError;
  };
}

interface ScriptEventSelfVitalsChanged {
  kind: "self_vitals_changed";
}

interface ScriptEventEntityAppeared {
  kind: "entity_appeared";
  data: {
    guid: Guid;
  };
}

interface ScriptEventEntityDisappeared {
  kind: "entity_disappeared";
  data: {
    guid: Guid;
  };
}

interface ScriptEventEntityUpdated {
  kind: "entity_updated";
  data: {
    guid: Guid;
  };
}

interface ScriptEventTeleportStarted {
  kind: "teleport_started";
  data: {
    sequence: number;
  };
}

interface ScriptEventPlayerKilled {
  kind: "player_killed";
  data: {
    death_message: string;
    victim_id: Guid;
    killer_id: Guid;
  };
}

interface ScriptEventInventoryChanged {
  kind: "inventory_changed";
  data: {
    added: Guid[];
    removed: Guid[];
  };
}

interface ScriptEventSpellbookChanged {
  kind: "spellbook_changed";
}

interface ScriptEventPartyChanged {
  kind: "party_changed";
}

type ScriptEvent =
  | ScriptChatMessageEvent
  | ScriptCombatFeedbackEvent
  | ScriptEventLifecycle
  | ScriptEventWorkflow
  | ScriptEventCommand
  | ScriptEventWeenieError
  | ScriptEventSelfVitalsChanged
  | ScriptEventEntityAppeared
  | ScriptEventEntityDisappeared
  | ScriptEventEntityUpdated
  | ScriptEventTeleportStarted
  | ScriptEventPlayerKilled
  | ScriptEventInventoryChanged
  | ScriptEventSpellbookChanged
  | ScriptEventPartyChanged;

type ScriptEventHandler = (event: ScriptEvent) => void;

interface HoltburgerApi {
  onEvent(handler: ScriptEventHandler): void;

  selfEntity(): ScriptSelfView | null;
  characterSheet(): ScriptCharacterSheetView | null;
  postJson(request: ScriptPostRequest): Promise<ScriptPostResponse>;
  currentInteraction(): ScriptClientInteraction | null;
  combatInfo(): ScriptCombatInfo;
  currentTradeInfo(): ScriptTradeInfo | null;
  party(): ScriptPartyView | null;
  currentOpenContainer(): Guid | null;
  serverTime(): number;
  pendingConfirmation(): ScriptConfirmation | null;
  busyOperation(): ScriptBusyOperation;
  inventory(): ScriptContainerView[];
  equipment(): Map<ScriptEquipmentSlotKind, ScriptEquipmentSlotState>;

  entity(guid: Guid): ScriptEntityView | null;
  entityExists(guid: Guid): boolean;
  nearbyEntities(maxDistance?: number | null, classifications?: ScriptEntityKind[] | null): ScriptEntityView[];
  distance(from: ScriptPositionRef, to: ScriptPositionRef): number;
  headingTo(from: ScriptPositionRef, to: ScriptPositionRef): number;

  enchantments(): ScriptEnchantmentView[];
  spellbook(): number[];
  inSpellbook(spellId: number): boolean;

  entityBoolProp(guid: Guid, prop: PropertyBool): boolean | null;
  entityIntProp(guid: Guid, prop: PropertyInt): number | null;
  entityInt64Prop(guid: Guid, prop: PropertyInt64): number | null;
  entityFloatProp(guid: Guid, prop: PropertyFloat): number | null;
  entityStringProp(guid: Guid, prop: PropertyString): string | null;
  entityDataProp(guid: Guid, prop: PropertyDataId): Guid | null;
  entityInstanceProp(guid: Guid, prop: PropertyInstanceId): Guid | null;

  loadConfig(): JsonValue | null;
  loadData(): JsonValue | null;
  loadDataBin(): Uint8Array | null;
  writeConfig(contents: string | JsonValue): boolean;

  print(style: ScriptMessageStyleInput, message: string): void;
  debugLog(message: string): void;
  say(message: string): void;
  emote(message: string): void;
  soulEmote(token: string): void;

  targetEntity(guid: Guid): void;
  approach(guid: Guid): void;
  follow(guid: Guid): void;
  setCombatMode(on: boolean): void;
  attack(guid: Guid): void;
  cancelInteraction(): void;

  snapHeading(heading: number): void;
  scoot(distanceMeters: number): void;
  castSpell(spellId: number, target?: Guid | null): void;
  respondToConfirmation(accepted: boolean): void;

  openContainer(guid: Guid): void;
  closeContainer(guid: Guid): void;
  moveItem(item: Guid, container: Guid): void;
  stackItems(source: Guid, destination: Guid, amount: number): void;
  splitItem(item: Guid, container: Guid, amount: number): void;
  combine(source: Guid, dest: Guid): void;
  useWith(source: Guid, dest: Guid): void;
  salvage(tool: Guid, items: Guid[]): void;
  assess(target: Guid): void;
  drop(item: Guid): void;
  pickup(item: Guid, container?: Guid | null): void;
  equip(guid: Guid, slot: ScriptEquipmentSlotKind): void;
  unequip(guid: Guid): void;

  openTrade(guid: Guid): void;
  addToTrade(item: Guid): void;
  acceptTrade(): void;
  declineTrade(): void;
  resetTrade(): void;
  exitTrade(): void;
}

declare const HB: HoltburgerApi;
declare const Holtburger: HoltburgerApi;
