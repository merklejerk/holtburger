pub mod opcodes {
    // --- Connection & Character Selection ---
    /// S2C: List of characters for account.
    /// Sent by the server after a successful login/handshake to let the client choose a character.
    pub const CHARACTER_LIST: u32 = 0xF658;
    /// C2S: Request to enter world with character.
    /// Initiates the world login sequence. Server typically responds with SERVER_READY or an error.
    pub const CHARACTER_ENTER_WORLD_REQUEST: u32 = 0xF7C8;
    /// S2C: Server is ready for character to enter.
    /// Acknowledges the enter request and tells the client to load the 3D world.
    pub const CHARACTER_ENTER_WORLD_SERVER_READY: u32 = 0xF7DF;
    /// S2C: Final character enter world message.
    /// Confirms the client is now active in the world.
    pub const CHARACTER_ENTER_WORLD: u32 = 0xF657;
    // /// S2C: Response to character creation/restore.
    // pub const CHARACTER_CREATE_RESPONSE: u32 = 0xF643;
    // /// C2S: Request to create a new character.
    // pub const CHARACTER_CREATE: u32 = 0xF656;
    // /// C2S: Request to delete a character.
    // pub const CHARACTER_DELETE: u32 = 0xF655;
    // /// C2S: Request to restore a deleted character.
    // pub const CHARACTER_RESTORE: u32 = 0xF7D9;
    /// S2C: Error during character operations.
    /// Sent if a login request fails (e.g., character already in world).
    pub const CHARACTER_ERROR: u32 = 0xF659;

    // --- World & Object Lifecycle ---
    /// S2C: Create an object in the world.
    /// Used to spawn monsters, items on the ground, or other players. Includes full model and physics data.
    pub const OBJECT_CREATE: u32 = 0xF745;
    /// S2C: Create the player object.
    /// Identifies the player's own character to the client. Sent exactly once per session during login.
    pub const PLAYER_CREATE: u32 = 0xF746;
    /// S2C: Delete an object from the world.
    /// Sent when an object leaves the client's "bubble" or is destroyed/taken.
    pub const OBJECT_DELETE: u32 = 0xF747;
    /// S2C: Object parenting event.
    /// Used when an item is picked up (parented to player) or equipped.
    pub const PARENT_EVENT: u32 = 0xF749;
    /// S2C: Object pickup event.
    /// Notify client that an object was successfully picked up.
    pub const PICKUP_EVENT: u32 = 0xF74A;
    /// S2C: Update object properties.
    /// A heavy update that re-sends the visual description and physics state of an object.
    pub const UPDATE_OBJECT: u32 = 0xF7DB;
    // /// S2C: Set stack size of an object.
    // pub const SET_STACK_SIZE: u32 = 0x0197;
    // /// S2C: Inventory object removal.
    // pub const INVENTORY_REMOVE_OBJECT: u32 = 0x0024;
    /// S2C: Position and movement update (all-in-one packet).
    pub const POSITION_AND_MOVEMENT: u32 = 0xF619;
    /// S2C: Object description event.
    pub const OBJ_DESC_EVENT: u32 = 0xF625;
    /// S2C: Force object description send.
    pub const FORCE_OBJECT_DESC_SEND: u32 = 0xF6EA;

    // --- Movement & Physics ---
    /// S2C: Update object motion (animations).
    /// Syncs movement animations for monsters and other players.
    pub const UPDATE_MOTION: u32 = 0xF74C;
    /// S2C: Update object position.
    /// Periodic position sync for all objects in the bubble.
    pub const UPDATE_POSITION: u32 = 0xF748;
    /// S2C: Update object movement vector.
    /// Used for objects in flight (missiles) or performing continuous turns.
    pub const VECTOR_UPDATE: u32 = 0xF74E;
    /// S2C: Sync player's own position (Client's autonomous view).
    /// Used for resetting the player's position or confirming client-reported coordinates.
    pub const AUTONOMOUS_POSITION: u32 = 0xF753;
    /// S2C: Set the client's autonomy level (how much gravity/collision to trust client for).
    pub const AUTONOMY_LEVEL: u32 = 0xF752;
    /// S2C: Force player to teleport.
    /// Triggers the teleport screen and moves player to a new landblock.
    pub const PLAYER_TELEPORT: u32 = 0xF751;
    /// S2C: Update private position (for private houses/zones).
    pub const PRIVATE_UPDATE_POSITION: u32 = 0x02DB;
    /// S2C: Update public position.
    pub const PUBLIC_UPDATE_POSITION: u32 = 0x02DC;

    // --- Property Updates (Public/Private) ---
    /// S2C: Update private Int property.
    /// Property updates marked 'Private' are only sent to the owner of the object.
    pub const PRIVATE_UPDATE_PROPERTY_INT: u32 = 0x02CD;
    /// S2C: Update public Int property.
    /// Property updates marked 'Public' are broadcast to everyone who sees the object.
    pub const PUBLIC_UPDATE_PROPERTY_INT: u32 = 0x02CE;
    /// S2C: Update private Int64 property.
    pub const PRIVATE_UPDATE_PROPERTY_INT64: u32 = 0x02CF;
    /// S2C: Update public Int64 property.
    pub const PUBLIC_UPDATE_PROPERTY_INT64: u32 = 0x02D0;
    /// S2C: Update private Bool property.
    pub const PRIVATE_UPDATE_PROPERTY_BOOL: u32 = 0x02D1;
    /// S2C: Update public Bool property.
    pub const PUBLIC_UPDATE_PROPERTY_BOOL: u32 = 0x02D2;
    /// S2C: Update private Float property.
    pub const PRIVATE_UPDATE_PROPERTY_FLOAT: u32 = 0x02D3;
    /// S2C: Update public Float property.
    pub const PUBLIC_UPDATE_PROPERTY_FLOAT: u32 = 0x02D4;
    /// S2C: Update private String property.
    pub const PRIVATE_UPDATE_PROPERTY_STRING: u32 = 0x02D5;
    /// S2C: Update public String property.
    pub const PUBLIC_UPDATE_PROPERTY_STRING: u32 = 0x02D6;
    /// S2C: Update private DataID property.
    pub const PRIVATE_UPDATE_PROPERTY_DID: u32 = 0x02D7;
    /// S2C: Update public DataID property.
    pub const PUBLIC_UPDATE_PROPERTY_DID: u32 = 0x02D8;
    /// S2C: Update private InstanceID property.
    pub const PRIVATE_UPDATE_PROPERTY_IID: u32 = 0x02D9;
    /// S2C: Update public InstanceID property.
    pub const PUBLIC_UPDATE_PROPERTY_IID: u32 = 0x02DA;

    // --- Stats & Skills ---
    /// S2C: Update private Skill level/experience.
    /// Sent when a player trains or earns XP in a skill.
    pub const PRIVATE_UPDATE_SKILL: u32 = 0x02DD;
    // /// S2C: Update public Skill level/experience.
    // pub const PUBLIC_UPDATE_SKILL: u32 = 0x02DE;
    // /// S2C: Update private Skill level (base value).
    // pub const PRIVATE_UPDATE_SKILL_LEVEL: u32 = 0x02DF;
    // /// S2C: Update public Skill level (base value).
    // pub const PUBLIC_UPDATE_SKILL_LEVEL: u32 = 0x02E0;
    /// S2C: Update private Attribute value.
    /// Updates base attributes (Strength, Stamina, etc).
    pub const PRIVATE_UPDATE_ATTRIBUTE: u32 = 0x02E3;
    // /// S2C: Update public Attribute value.
    // pub const PUBLIC_UPDATE_ATTRIBUTE: u32 = 0x02E4;
    /// S2C: Update private Vital value.
    /// Updates max health, stamina, or mana.
    pub const PRIVATE_UPDATE_VITAL: u32 = 0x02E7;
    // /// S2C: Update public Vital value.
    // pub const PUBLIC_UPDATE_VITAL: u32 = 0x02E8;
    /// S2C: Update private Vital current value.
    /// Updates current health/stamina/mana levels.
    pub const PRIVATE_UPDATE_VITAL_CURRENT: u32 = 0x02E9;
    // /// S2C: Player was killed in combat.
    // pub const PLAYER_KILLED: u32 = 0x019E;

    // --- Communication & Chat ---
    /// S2C: System or chat message.
    /// Used for general server announcements, combat logs, and error messages.
    pub const SERVER_MESSAGE: u32 = 0xF7E0;
    /// S2C: Chat message heard by player.
    /// Standard local chat from other players or NPCs.
    pub const HEAR_SPEECH: u32 = 0x02BB;
    /// S2C: Ranged chat message heard by player.
    /// Used for shouts or long-distance local chat.
    pub const HEAR_RANGED_SPEECH: u32 = 0x02BC;
    /// S2C: Text emote.
    /// E.g., "The Olthoi growls at you."
    pub const EMOTE_TEXT: u32 = 0x01E0;
    /// S2C: Soul emote (visuals/text).
    /// Complex emotes involving animations and text.
    pub const SOUL_EMOTE: u32 = 0x01E2;
    // /// S2C: Turbine chat message.
    // pub const TURBINE_CHAT: u32 = 0xF7DE;

    // --- Visuals & Audio ---
    /// S2C: Set object state.
    /// Updates the visual/functional state of an object (e.g., door opening).
    pub const SET_STATE: u32 = 0xF74B;
    /// S2C: Play a visual effect.
    /// Triggers a particle system, overlay, or other visual script.
    pub const PLAY_EFFECT: u32 = 0xF755;
    /// S2C: Play a sound effect.
    /// Triggers a sound at the object's location.
    pub const SOUND: u32 = 0xF750;
    // /// S2C: Play a script by ID.
    // pub const PLAY_SCRIPT_ID: u32 = 0xF754;

    // --- Game Logic & Flow ---
    /// S2C: Wrapper for various game events.
    /// High-level container for asynchronous server-sent events like chat, tells, and world state changes.
    pub const GAME_EVENT: u32 = 0xF7B0;
    /// C2S: Wrapper for various game actions.
    /// High-level container for client-initiated actions such as using items, talking, or moving.
    pub const GAME_ACTION: u32 = 0xF7B1;
    // /// S2C: Admin environs (legacy admin tool).
    // pub const ADMIN_ENVIRONS: u32 = 0xEA60;

    // --- Data Download (DDD) ---
    /// S2C: Data download interrogation.
    /// Part of the DDD (Distribution Database Download) system for syncing game data.
    pub const DDD_INTERROGATION: u32 = 0xF7E5;
    /// C2S: Response to data download interrogation.
    pub const DDD_INTERROGATION_RESPONSE: u32 = 0xF7E6;
    // /// S2C/C2S: DDD data message.
    // pub const DDD_DATA_MESSAGE: u32 = 0xF7E2;
    // /// S2C/C2S: Request DDD data.
    // pub const DDD_REQUEST_DATA_MESSAGE: u32 = 0xF7E3;
    // /// S2C/C2S: DDD error message.
    // pub const DDD_ERROR_MESSAGE: u32 = 0xF7E4;
    // /// S2C/C2S: Begin DDD process.
    // pub const DDD_BEGIN_DDD: u32 = 0xF7E7;
    // /// S2C/C2S: Begin pull DDD process.
    // pub const DDD_BEGIN_PULL_DDD: u32 = 0xF7E8;
    // /// S2C/C2S: DDD iteration data.
    // pub const DDD_ITERATION_DATA: u32 = 0xF7E9;
    // /// S2C: End DDD process.
    // pub const DDD_END_DDD: u32 = 0xF7EA;

    // --- Server & Account Status ---
    /// S2C: Server name information.
    /// Sent during login to inform the client which shard it has connected to.
    pub const SERVER_NAME: u32 = 0xF7E1;
    // /// S2C: Account has been banned.
    // pub const ACCOUNT_BANNED: u32 = 0xF7C1;
    /// S2C: Kick player from server.
    /// Sent when the account is logged out or banned.
    pub const BOOT_ACCOUNT: u32 = 0xF7DC;
    // /// S2C: Force character log off.
    // pub const CHARACTER_LOG_OFF: u32 = 0xF653;
    // /// S2C: Get server version.
    // pub const GET_SERVER_VERSION: u32 = 0xF7CC;
    // /// S2C: Friends list (obsolete).
    // pub const FRIENDS_OLD: u32 = 0xF7CD;
}

pub mod actions {
    // --- Communication & Chat ---
    /// C2S: Send chat message.
    pub const TALK: u32 = 0x0015;
    /// C2S: Send direct message/tell.
    pub const TELL: u32 = 0x005D;
    // /// C2S: Set AFK mode.
    // pub const SET_AFK_MODE: u32 = 0x000F;
    // /// C2S: Set AFK message.
    // pub const SET_AFK_MESSAGE: u32 = 0x0010;
    /// C2S: Request a ping response.
    /// Used to measure latency and keep the connection alive.
    pub const PING_REQUEST: u32 = 0x01E9;

    // --- Inventory & Items ---
    /// C2S: Drop an item on the ground.
    pub const DROP_ITEM: u32 = 0x001B;
    /// C2S: Move an item into a container.
    /// Also used for picking up items from the ground (moving to backpack).
    pub const PUT_ITEM_IN_CONTAINER: u32 = 0x0019;
    /// C2S: Pick up and wield an item in one action.
    pub const GET_AND_WIELD_ITEM: u32 = 0x001A;
    // /// C2S: Buy item(s) from a vendor.
    // pub const BUY: u32 = 0x005F;
    // /// C2S: Sell item(s) to a vendor.
    // pub const SELL: u32 = 0x0060;
    // /// C2S: Merge stackable items.
    // pub const STACKABLE_MERGE: u32 = 0x0054;
    // /// C2S: Split stackable items to a container.
    // pub const STACKABLE_SPLIT_TO_CONTAINER: u32 = 0x0055;
    // /// C2S: Split stackable items to the ground.
    // pub const STACKABLE_SPLIT_TO_3D: u32 = 0x0056;
    /// C2S: Split stackable items and wield.
    pub const STACKABLE_SPLIT_TO_WIELD: u32 = 0x019B;
    // /// C2S: Give an object to another player.
    // pub const GIVE_OBJECT_REQUEST: u32 = 0x00CD;

    // --- Interaction & Login ---
    /// C2S: Sent when client finishes loading the world.
    /// Signals the server that the client is ready to receive world updates.
    pub const LOGIN_COMPLETE: u32 = 0x00A1;
    /// C2S: Use an object.
    /// Blanket action for clicking doors, Lifestones, or using inventory items.
    pub const USE: u32 = 0x0036;
    // /// C2S: Use an object on a specific target.
    // pub const USE_WITH_TARGET: u32 = 0x0035;
    /// C2S: Identify an object.
    /// Request full property details for an object (Assess).
    pub const IDENTIFY_OBJECT: u32 = 0x00C8;
    /// C2S: Change state (e.g. sit, stand).
    pub const MOVE_TO_STATE: u32 = 0xF61C;
    // /// C2S: Set character options/settings.
    // pub const SET_CHARACTER_OPTIONS: u32 = 0x01A1;
    // /// C2S: Set single character option.
    // pub const SET_SINGLE_CHARACTER_OPTION: u32 = 0x0005;

    // --- Combat & Spells ---
    // /// C2S: Target and attack with melee.
    // pub const TARGETED_MELEE_ATTACK: u32 = 0x0008;
    // /// C2S: Target and attack with missiles.
    // pub const TARGETED_MISSILE_ATTACK: u32 = 0x000A;
    // /// C2S: Cast spell on a target.
    // pub const CAST_TARGETED_SPELL: u32 = 0x004A;
    // /// C2S: Cast untargeted/self spell.
    // pub const CAST_UNTARGETED_SPELL: u32 = 0x0048;
    // /// C2S: Change combat mode (Peace, Melee, Missile, Magic).
    // pub const CHANGE_COMBAT_MODE: u32 = 0x0053;
    // /// C2S: Cancel current attack.
    // pub const CANCEL_ATTACK: u32 = 0x01B7;

    // --- Allegiance & Social ---
    // /// C2S: Swear allegiance to a patron.
    // pub const SWEAR_ALLEGIANCE: u32 = 0x001D;
    // /// C2S: Break allegiance from patron/vassal.
    // pub const BREAK_ALLEGIANCE: u32 = 0x001E;
    // /// C2S: Add a player to friends list.
    // pub const ADD_FRIEND: u32 = 0x0018;
    // /// C2S: Remove a player from friends list.
    // pub const REMOVE_FRIEND: u32 = 0x0017;
    // /// C2S: Query allegiance information.
    // pub const ALLEGIANCE_INFO_REQUEST: u32 = 0x027B;
    // /// C2S: Set/Update a character title.
    // pub const TITLE_SET: u32 = 0x002C;
    // /// C2S: Query a player's health.
    // pub const QUERY_HEALTH: u32 = 0x01BF;

    // --- Fellowship ---
    // /// C2S: Create a fellowship.
    // pub const FELLOWSHIP_CREATE: u32 = 0x00A2;
    // /// C2S: Recruit player to fellowship.
    // pub const FELLOWSHIP_RECRUIT: u32 = 0x00A5;
    // /// C2S: Quit current fellowship.
    // pub const FELLOWSHIP_QUIT: u32 = 0x00A3;
    // /// C2S: Dismiss player from fellowship.
    // pub const FELLOWSHIP_DISMISS: u32 = 0x00A4;
    // /// C2S: Update fellowship settings (open/closed, etc).
    // pub const FELLOWSHIP_UPDATE_REQUEST: u32 = 0x00A6;
    // /// C2S: Assign new leader.
    // pub const FELLOWSHIP_ASSIGN_NEW_LEADER: u32 = 0x0290;
    // /// C2S: Change fellowship openness.
    // pub const FELLOWSHIP_CHANGE_OPENNESS: u32 = 0x0291;

    // --- Trade ---
    // /// C2S: Open trade negotiations with another player.
    // pub const OPEN_TRADE_NEGOTIATIONS: u32 = 0x01F6;
    // /// C2S: Close trade window.
    // pub const CLOSE_TRADE_NEGOTIATIONS: u32 = 0x01F7;
    // /// C2S: Add an object to the trade window.
    // pub const ADD_TO_TRADE: u32 = 0x01F8;
    // /// C2S: Accept the current trade agreement.
    // pub const ACCEPT_TRADE: u32 = 0x01FA;
    // /// C2S: Decline the current trade agreement.
    // pub const DECLINE_TRADE: u32 = 0x01FB;

    // --- Housing ---
    // /// C2S: Buy a house.
    // pub const BUY_HOUSE: u32 = 0x021C;
    // /// C2S: Abandon current house.
    // pub const ABANDON_HOUSE: u32 = 0x021F;
    // /// C2S: Teleport to own house.
    // pub const TELE_TO_HOUSE: u32 = 0x0262;

    // --- Movement ---
    /// C2S: Client reports its position to server (~1Hz).
    /// Regular heartbeat for positional sync.
    pub const AUTONOMOUS_POSITION: u32 = 0xF753;
    /// C2S: Client movement event (jump, turn, etc).
    /// Individual movement packets for granular control.
    pub const UPDATE_MOTION: u32 = 0xF74C;
    /// C2S: Perform a jump.
    pub const JUMP: u32 = 0xF61B;
    /// S2C: Request the client to turn to a specific heading or object.
    pub const TURN_TO: u32 = 0xF649;

    // --- Unused / Legacy Movement ---
    // These opcodes are defined in the protocol but are strictly unused in ACE
    // and modern clients, which prefer MoveToState (0xF61C) for all movement updates.
    // /// C2S: Start a movement command (legacy).
    // pub const DO_MOVEMENT_COMMAND: u32 = 0xF61E;
    // /// C2S: Stop a movement command (legacy).
    // pub const STOP_MOVEMENT_COMMAND: u32 = 0xF661;
}

pub mod game_event_opcodes {
    // --- Social & Communication ---
    /// S2C: Detailed player description.
    /// Sent during login. Contains attributes, skills, and base stats.
    pub const PLAYER_DESCRIPTION: u32 = 0x0013;
    /// S2C: Start game message (after character enter).
    /// Final confirmation of successful entry. Usually triggers client-side login scripts.
    pub const START_GAME: u32 = 0x0282;
    /// S2C: Broadcast channel message.
    /// Shared chat channels (General, Trade, etc).
    pub const CHANNEL_BROADCAST: u32 = 0x0147;
    // /// S2C: List of available chat channels.
    // pub const CHANNEL_LIST: u32 = 0x0148;
    /// S2C: Response to client ping request.
    pub const PING_RESPONSE: u32 = 0x01EA;
    /// S2C: Private tell message.
    pub const TELL: u32 = 0x02BD;

    // --- Inventory & World ---
    /// S2C: List contents of a container.
    /// Sent when a player opens a chest or backpack.
    pub const VIEW_CONTENTS: u32 = 0x0196;
    // /// S2C: Item moved into a container in inventory.
    // pub const INVENTORY_PUT_OBJ_IN_CONTAINER: u32 = 0x0022;
    // /// S2C: Item dropped into the 3D world.
    // pub const INVENTORY_PUT_OBJECT_IN_3D: u32 = 0x019A;
    // /// S2C: Item equipped/wielded.
    // pub const WIELD_OBJECT: u32 = 0x0023;
    // /// S2C: Vendor information and shop inventory.
    // pub const VENDOR_INFO_EVENT: u32 = 0x0062;

    // --- Combat & Stats ---
    // /// S2C: Attack sequence finished.
    // pub const ATTACK_DONE: u32 = 0x01A7;
    // /// S2C: Attacker notification (You attacked X).
    // pub const ATTACKER_NOTIFICATION: u32 = 0x01B1;
    // /// S2C: Defender notification (You were attacked by X).
    // pub const DEFENDER_NOTIFICATION: u32 = 0x01B2;
    // /// S2C: Evasion attacker notification (X evaded your attack).
    // pub const EVASION_ATTACKER_NOTIFICATION: u32 = 0x01B3;
    // /// S2C: Evasion defender notification (You evaded X's attack).
    // pub const EVASION_DEFENDER_NOTIFICATION: u32 = 0x01B4;
    // /// S2C: Combat commence attack.
    // pub const COMBAT_COMMENCE_ATTACK: u32 = 0x01B8;
    // /// S2C: Update health of an object.
    // pub const UPDATE_HEALTH: u32 = 0x01C0;
    // /// S2C: Notification sent to a victim on death.
    // pub const VICTIM_NOTIFICATION: u32 = 0x01AC;
    // /// S2C: Notification sent to a killer on kill.
    // pub const KILLER_NOTIFICATION: u32 = 0x01AD;

    // --- Magic & Enchantments ---
    // /// S2C: Spell removal from spellbook.
    // pub const MAGIC_REMOVE_SPELL: u32 = 0x01A8;
    // /// S2C: Update/Add a spell in spellbook.
    // pub const MAGIC_UPDATE_SPELL: u32 = 0x02C1;
    /// S2C: Add or update an enchantment.
    pub const MAGIC_UPDATE_ENCHANTMENT: u32 = 0x02C2;
    /// S2C: Remove an enchantment.
    pub const MAGIC_REMOVE_ENCHANTMENT: u32 = 0x02C3;
    /// S2C: Update multiple enchantments at once.
    pub const MAGIC_UPDATE_MULTIPLE_ENCHANTMENTS: u32 = 0x02C4;
    /// S2C: Remove multiple enchantments at once.
    pub const MAGIC_REMOVE_MULTIPLE_ENCHANTMENTS: u32 = 0x02C5;
    /// S2C: Purge all enchantments.
    pub const MAGIC_PURGE_ENCHANTMENTS: u32 = 0x02C6;
    // /// S2C: Dispel a specific enchantment.
    // pub const MAGIC_DISPEL_ENCHANTMENT: u32 = 0x02C7;
    // /// S2C: Dispel multiple enchantments.
    // pub const MAGIC_DISPEL_MULTIPLE_ENCHANTMENTS: u32 = 0x02C8;
    /// S2C: Purge all negative enchantments.
    pub const MAGIC_PURGE_BAD_ENCHANTMENTS: u32 = 0x0312;

    // --- Trade ---
    // /// S2C: Open trade window.
    // pub const OPEN_TRADE: u32 = 0x01FE;
    // /// S2C: Close trade window.
    // pub const CLOSE_TRADE: u32 = 0x01FF;
    // /// S2C: Add item to trade offer.
    // pub const ADD_TO_TRADE: u32 = 0x0200;
    // /// S2C: Accept trade offer.
    // pub const ACCEPT_TRADE: u32 = 0x0202;

    // --- Housing ---
    // /// S2C: House profile/details.
    // pub const HOUSE_PROFILE: u32 = 0x021D;
    // /// S2C: House status and ownership.
    // pub const HOUSE_STATUS: u32 = 0x0226;

    // --- Errors ---
    /// S2C: Game error related to a specific weenie.
    /// E.g. "You cannot pick that up."
    pub const WEENIE_ERROR: u32 = 0x028A;
    /// S2C: Game error with an additional string.
    pub const WEENIE_ERROR_WITH_STRING: u32 = 0x028B;
}

pub mod character_error_codes {
    // --- Authentication & Session ---
    /// Account already logged on.
    pub const ACCOUNT_ALREADY_LOGGED_ON: u32 = 0x00000001;
    // /// Server could not access account information.
    // pub const ACCOUNT_LOGIN: u32 = 0x00000003;
    // /// Account name not valid.
    // pub const ACCOUNT_INVALID: u32 = 0x00000009;
    // /// Account doesn't exist.
    // pub const ACCOUNT_DOESNT_EXIST: u32 = 0x0000000A;
    // /// Subscription expired.
    // pub const SUBSCRIPTION_EXPIRED: u32 = 0x00000018;

    // --- Server & World Status ---
    // /// Server has disconnected (crash case 1).
    // pub const SERVER_CRASH1: u32 = 0x00000004;
    // /// Server is full.
    // pub const LOGON_SERVER_FULL: u32 = 0x00000015;
    // /// Starting server is down.
    // pub const ENTER_GAME_START_SERVER_DOWN: u32 = 0x00000013;

    // --- Character & World Entry ---
    /// Character already in world (try again soon).
    pub const ENTER_GAME_CHARACTER_IN_WORLD: u32 = 0x0000000D;
    /// Character already in world server (internal error).
    pub const ENTER_GAME_CHARACTER_IN_WORLD_SERVER: u32 = 0x00000010;
    // /// Generic enter game error.
    // pub const ENTER_GAME_GENERIC: u32 = 0x0000000B;
    // /// Stress character login denied.
    // pub const ENTER_GAME_STRESS_ACCOUNT: u32 = 0x0000000C;
    // /// Server unable to find player account.
    // pub const ENTER_GAME_PLAYER_ACCOUNT_MISSING: u32 = 0x0000000E;
    // /// You do not own this character.
    // pub const ENTER_GAME_CHARACTER_NOT_OWNED: u32 = 0x0000000F;
    // /// Old character version (force char select).
    // pub const ENTER_GAME_OLD_CHARACTER: u32 = 0x00000011;
    // /// Character data corrupted.
    // pub const ENTER_GAME_CORRUPT_CHARACTER: u32 = 0x00000012;
    // /// Couldn't place character in world.
    // pub const ENTER_GAME_COULDNT_PLACE_CHARACTER: u32 = 0x00000014;
    // /// Save in progress, character locked.
    // pub const ENTER_GAME_CHARACTER_LOCKED: u32 = 0x00000017;

    // --- Character Management ---
    // /// Server could not log off character.
    // pub const LOGOFF: u32 = 0x00000005;
    // /// Server could not delete character.
    // pub const DELETE: u32 = 0x00000006;
}
