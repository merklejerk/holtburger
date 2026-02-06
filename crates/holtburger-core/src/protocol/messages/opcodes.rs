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
/// S2C: Set stack size of an object.
pub const SET_STACK_SIZE: u32 = 0x0197;
/// S2C: Inventory object removal.
pub const INVENTORY_REMOVE_OBJECT: u32 = 0x0024;
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
/// S2C: Update public Skill level/experience.
pub const PUBLIC_UPDATE_SKILL: u32 = 0x02DE;
/// S2C: Update private Skill level (base value).
pub const PRIVATE_UPDATE_SKILL_LEVEL: u32 = 0x02DF;
/// S2C: Update public Skill level (base value).
pub const PUBLIC_UPDATE_SKILL_LEVEL: u32 = 0x02E0;
/// S2C: Update private Attribute value.
/// Updates base attributes (Strength, Stamina, etc).
pub const PRIVATE_UPDATE_ATTRIBUTE: u32 = 0x02E3;
/// S2C: Update public Attribute value.
pub const PUBLIC_UPDATE_ATTRIBUTE: u32 = 0x02E4;
/// S2C: Update private Vital value.
/// Updates max health, stamina, or mana.
pub const PRIVATE_UPDATE_VITAL: u32 = 0x02E7;
/// S2C: Update public Vital value.
pub const PUBLIC_UPDATE_VITAL: u32 = 0x02E8;
/// S2C: Update private Vital current value (tick).
/// Updates current health/stamina/mana levels.
pub const PRIVATE_UPDATE_VITAL_CURRENT: u32 = 0x02E9;
/// S2C: Update public Vital current value (tick).
pub const PUBLIC_UPDATE_VITAL_CURRENT: u32 = 0x02EA;
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

pub mod action_opcodes {
    // --- Communication & Chat ---
    /// C2S: Send chat message.
    pub const TALK: u32 = 0x0015;
    /// C2S: Send direct message/tell.
    pub const TELL: u32 = 0x005D;
    // /// C2S: Send direct message (similar to TELL).
    // pub const TALK_DIRECT: u32 = 0x0032;
    // /// C2S: Perform a character emote.
    // pub const EMOTE: u32 = 0x01DF;
    // /// C2S: Perform a visual "soul emote".
    // pub const SOUL_EMOTE: u32 = 0x01E1;
    // /// C2S: Toggle Away From Keyboard (AFK) status.
    // pub const SET_AFK_MODE: u32 = 0x000F;
    // /// C2S: Set the custom AFK message.
    // pub const SET_AFK_MESSAGE: u32 = 0x0010;
    // /// C2S: Add a custom chat channel.
    // pub const ADD_CHANNEL: u32 = 0x0145;
    // /// C2S: Remove a custom chat channel.
    // pub const REMOVE_CHANNEL: u32 = 0x0146;
    // /// C2S: Send message to a specific chat channel.
    // pub const CHAT_CHANNEL: u32 = 0x0147;
    // /// C2S: Request list of available chat channels.
    // pub const LIST_CHANNELS: u32 = 0x0148;
    // /// C2S: Request an index of chat channels.
    // pub const INDEX_CHANNELS: u32 = 0x0149;
    // /// C2S: Request the abuse report log.
    // pub const ABUSE_LOG_REQUEST: u32 = 0x0140;
    // /// C2S: Set the Message of the Day (MOTD).
    // pub const SET_MOTD: u32 = 0x0254;
    // /// C2S: Query the current Message of the Day (MOTD).
    // pub const QUERY_MOTD: u32 = 0x0255;
    // /// C2S: Clear the current Message of the Day (MOTD).
    // pub const CLEAR_MOTD: u32 = 0x0256;
    // /// C2S: Mute/squelch a specific character.
    // pub const MODIFY_CHARACTER_SQUELCH: u32 = 0x0058;
    // /// C2S: Mute/squelch an entire account.
    // pub const MODIFY_ACCOUNT_SQUELCH: u32 = 0x0059;
    // /// C2S: Mute/squelch a global chat channel.
    // pub const MODIFY_GLOBAL_SQUELCH: u32 = 0x005B;
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
    // /// C2S: Purchase item(s) from a vendor.
    // pub const BUY: u32 = 0x005F;
    // /// C2S: Sell item(s) to a vendor.
    // pub const SELL: u32 = 0x0060;
    // /// C2S: Merge two stacks of items.
    // pub const STACKABLE_MERGE: u32 = 0x0054;
    // /// C2S: Split an item stack into a container.
    // pub const STACKABLE_SPLIT_TO_CONTAINER: u32 = 0x0055;
    // /// C2S: Split an item stack onto the ground.
    // pub const STACKABLE_SPLIT_TO_3D: u32 = 0x0056;
    /// C2S: Split stackable items and wield.
    pub const STACKABLE_SPLIT_TO_WIELD: u32 = 0x019B;
    // /// C2S: Stop viewing a container's contents.
    // pub const NO_LONGER_VIEWING_CONTENTS: u32 = 0x0195;
    // /// C2S: Use components to create a tinkering tool.
    // pub const CREATE_TINKERING_TOOL: u32 = 0x027D;
    // /// C2S: Query current mana levels of an item.
    // pub const QUERY_ITEM_MANA: u32 = 0x0263;
    // /// C2S: Attempt to give an item to another player.
    // pub const GIVE_OBJECT_REQUEST: u32 = 0x00CD;

    // --- Books & Inscriptions ---
    // /// C2S: Request book metadata (title, author, etc).
    // pub const BOOK_DATA: u32 = 0x00AA;
    // /// C2S: Update the text of a book page.
    // pub const BOOK_MODIFY_PAGE: u32 = 0x00AB;
    // /// C2S: Add a new page to a book.
    // pub const BOOK_ADD_PAGE: u32 = 0x00AC;
    // /// C2S: Remove a page from a book.
    // pub const BOOK_DELETE_PAGE: u32 = 0x00AD;
    // /// C2S: Request the text content of a book page.
    // pub const BOOK_PAGE_DATA: u32 = 0x00AE;
    // /// C2S: Add an inscription to an item (Notes, Crafted items).
    // pub const SET_INSCRIPTION: u32 = 0x00BF;

    // --- Interaction & Login ---
    /// C2S: Sent when client finishes loading the world.
    /// Signals the server that the client is ready to receive world updates.
    pub const LOGIN_COMPLETE: u32 = 0x00A1;
    /// C2S: Use an object.
    /// Blanket action for clicking doors, Lifestones, or using inventory items.
    pub const USE: u32 = 0x0036;
    // /// C2S: Use an item on a specific target (e.g. lockpicking).
    // pub const USE_WITH_TARGET: u32 = 0x0035;
    /// C2S: Identify an object.
    /// Request full property details for an object (Assess).
    pub const IDENTIFY_OBJECT: u32 = 0x00C8;
    /// C2S: Change state (e.g. sit, stand).
    pub const MOVE_TO_STATE: u32 = 0xF61C;
    // /// C2S: Set character options/settings.
    // pub const SET_CHARACTER_OPTIONS: u32 = 0x01A1;
    // /// C2S: Toggles boolean character options (Appear Offline, Show Cloak, etc).
    // pub const SET_SINGLE_CHARACTER_OPTION: u32 = 0x0005;
    // /// C2S: Remove all characters from the friends list.
    // pub const REMOVE_ALL_FRIENDS: u32 = 0x0025;
    // /// C2S: Query a character's creation age.
    // pub const QUERY_AGE: u32 = 0x01C2;
    // /// C2S: Query a character's birth date.
    // pub const QUERY_BIRTH: u32 = 0x01C4;
    // /// C2S: Add an item or spell shortcut to the UI.
    // pub const ADD_SHORT_CUT: u32 = 0x019C;
    // /// C2S: Remove a shortcut from the UI.
    // pub const REMOVE_SHORT_CUT: u32 = 0x019D;
    // /// C2S: Response to a server confirmation dialog.
    // pub const CONFIRMATION_RESPONSE: u32 = 0x0275;
    // /// C2S: Response to an admin plugin list query.
    // pub const QUERY_PLUGIN_LIST_RESPONSE: u32 = 0x02AF;
    // /// C2S: Response to an admin plugin detail query.
    // pub const QUERY_PLUGIN_RESPONSE: u32 = 0x02B2;
    // /// C2S: Finalize character changes in a barber session.
    // pub const FINISH_BARBER: u32 = 0x0311;

    // --- Combat & Spells ---
    // /// C2S: Initiate a melee attack on a target.
    // pub const TARGETED_MELEE_ATTACK: u32 = 0x0008;
    // /// C2S: Initiate a missile attack on a target.
    // pub const TARGETED_MISSILE_ATTACK: u32 = 0x000A;
    // /// C2S: Cast a spell on a specific target.
    // pub const CAST_TARGETED_SPELL: u32 = 0x004A;
    // /// C2S: Cast a spell without a target (e.g. self-buff).
    // pub const CAST_UNTARGETED_SPELL: u32 = 0x0048;
    // /// C2S: Cycle through combat modes (Peace, Melee, Missile, Magic).
    // pub const CHANGE_COMBAT_MODE: u32 = 0x0053;
    // /// C2S: Cancel the current combat attack sequence.
    // pub const CANCEL_ATTACK: u32 = 0x01B7;
    // /// C2S: Remove a spell from the character's spellbook.
    // pub const REMOVE_SPELL_C2S: u32 = 0x01A8;
    // /// C2S: Mark a spell as a favorite in the spellbook.
    // pub const ADD_SPELL_FAVORITE: u32 = 0x01E3;
    // /// C2S: Remove a spell from the favorites list.
    // pub const REMOVE_SPELL_FAVORITE: u32 = 0x01E4;
    // /// C2S: Apply active filters to the spellbook view.
    // pub const SPELLBOOK_FILTER: u32 = 0x0286;
    // /// C2S: Forcibly kill the character.
    // pub const SUICIDE: u32 = 0x0279;

    // --- Stats & Skills ---
    // /// C2S: Increase a vital (Health, Stamina, Mana) using experience.
    // pub const RAISE_VITAL: u32 = 0x0044;
    // /// C2S: Increase an attribute (Strength, Endurance, etc) using experience.
    // pub const RAISE_ATTRIBUTE: u32 = 0x0045;
    // /// C2S: Increase a skill (Melee Defense, etc) using experience.
    // pub const RAISE_SKILL: u32 = 0x0046;
    // /// C2S: Spend skill points to train or untrain a skill.
    // pub const TRAIN_SKILL: u32 = 0x0047;
    // /// C2S: Set the desired material/component level for spellcasting.
    // pub const SET_DESIRED_COMPONENT_LEVEL: u32 = 0x0224;

    // --- Allegiance & Social ---
    // /// C2S: Swear allegiance to a patron.
    // pub const SWEAR_ALLEGIANCE: u32 = 0x001D;
    // /// C2S: Break allegiance from a patron/vassal.
    // pub const BREAK_ALLEGIANCE: u32 = 0x001E;
    // /// C2S: Request an update of allegiance information.
    // pub const ALLEGIANCE_UPDATE_REQUEST: u32 = 0x001F;
    // /// C2S: Add a player to the friends list.
    // pub const ADD_FRIEND: u32 = 0x0018;
    // /// C2S: Remove a player from the friends list.
    // pub const REMOVE_FRIEND: u32 = 0x0017;
    // /// C2S: Query detailed allegiance hierarchy and status.
    // pub const ALLEGIANCE_INFO_REQUEST: u32 = 0x027B;
    // /// C2S: Query the name of an allegiance member.
    // pub const QUERY_ALLEGIANCE_NAME: u32 = 0x0030;
    // /// C2S: Clear a custom name for an allegiance member.
    // pub const CLEAR_ALLEGIANCE_NAME: u32 = 0x0031;
    // /// C2S: Set a custom name for an allegiance member.
    // pub const SET_ALLEGIANCE_NAME: u32 = 0x0033;
    // /// C2S: Designate a vassal as an allegiance officer.
    // pub const SET_ALLEGIANCE_OFFICER: u32 = 0x003B;
    // /// C2S: Assign a custom title to an allegiance officer.
    // pub const SET_ALLEGIANCE_OFFICER_TITLE: u32 = 0x003C;
    // /// C2S: List all officer titles in the allegiance.
    // pub const LIST_ALLEGIANCE_OFFICER_TITLES: u32 = 0x003D;
    // /// C2S: Clear all custom officer titles.
    // pub const CLEAR_ALLEGIANCE_OFFICER_TITLES: u32 = 0x003E;
    // /// C2S: Toggle the allegiance lock (allowing/preventing new vassals).
    // pub const DO_ALLEGIANCE_LOCK_ACTION: u32 = 0x003F;
    // /// C2S: Add a player to the approved vassal list.
    // pub const SET_ALLEGIANCE_APPROVED_VASSAL: u32 = 0x0040;
    // /// C2S: Mute/gag a player in allegiance chat.
    // pub const ALLEGIANCE_CHAT_GAG: u32 = 0x0041;
    // /// C2S: Perform housing actions via allegiance (e.g. mansion recall).
    // pub const DO_ALLEGIANCE_HOUSE_ACTION: u32 = 0x0042;
    // /// C2S: Forcibly break allegiance with a vassal (boot).
    // pub const BREAK_ALLEGIANCE_BOOT: u32 = 0x0277;
    // /// C2S: Remove a player from allegiance chat.
    // pub const ALLEGIANCE_CHAT_BOOT: u32 = 0x02A0;
    // /// C2S: Add a permanent ban for a player from the allegiance.
    // pub const ADD_ALLEGIANCE_BAN: u32 = 0x02A1;
    // /// C2S: Remove a ban from the allegiance list.
    // pub const REMOVE_ALLEGIANCE_BAN: u32 = 0x02A2;
    // /// C2S: List all banned players for the allegiance.
    // pub const LIST_ALLEGIANCE_BANS: u32 = 0x02A3;
    // /// C2S: Remove the officer status from a vassal.
    // pub const REMOVE_ALLEGIANCE_OFFICER: u32 = 0x02A5;
    // /// C2S: List all current officers in the allegiance.
    // pub const LIST_ALLEGIANCE_OFFICERS: u32 = 0x02A6;
    // /// C2S: Remove all officers from their positions.
    // pub const CLEAR_ALLEGIANCE_OFFICERS: u32 = 0x02A7;
    // /// C2S: Recall the character to their allegiance hometown.
    // pub const RECALL_ALLEGIANCE_HOMETOWN: u32 = 0x02AB;
    // /// C2S: Select an active character title.
    // pub const TITLE_SET: u32 = 0x002C;
    // /// C2S: Query the current health/vitals of another player.
    // pub const QUERY_HEALTH: u32 = 0x01BF;

    // --- Fellowship ---
    // /// C2S: Create a new fellowship group.
    // pub const FELLOWSHIP_CREATE: u32 = 0x00A2;
    // /// C2S: Invite a player into the fellowship.
    // pub const FELLOWSHIP_RECRUIT: u32 = 0x00A5;
    // /// C2S: Leave the current fellowship.
    // pub const FELLOWSHIP_QUIT: u32 = 0x00A3;
    // /// C2S: Remove another player from the fellowship.
    // pub const FELLOWSHIP_DISMISS: u32 = 0x00A4;
    // /// C2S: Update fellowship configuration (open/closed, etc).
    // pub const FELLOWSHIP_UPDATE_REQUEST: u32 = 0x00A6;
    // /// C2S: Designate a new fellowship leader.
    // pub const FELLOWSHIP_ASSIGN_NEW_LEADER: u32 = 0x0290;
    // /// C2S: Toggle the fellowship's open/closed enrollment status.
    // pub const FELLOWSHIP_CHANGE_OPENNESS: u32 = 0x0291;

    // --- Trade ---
    // /// C2S: Initiate trade negotiation with another player.
    // pub const OPEN_TRADE_NEGOTIATIONS: u32 = 0x01F6;
    // /// C2S: Terminate the current trade negotiation.
    // pub const CLOSE_TRADE_NEGOTIATIONS: u32 = 0x01F7;
    // /// C2S: Add an item or stack to the trade window.
    // pub const ADD_TO_TRADE: u32 = 0x01F8;
    // /// C2S: Commit to the current trade agreement.
    // pub const ACCEPT_TRADE: u32 = 0x01FA;
    // /// C2S: Reject the current trade agreement.
    // pub const DECLINE_TRADE: u32 = 0x01FB;
    // /// C2S: Clear all items and status from the trade window.
    // pub const RESET_TRADE: u32 = 0x0204;

    // --- Housing ---
    // /// C2S: Purchase a selected house.
    // pub const BUY_HOUSE: u32 = 0x021C;
    // /// C2S: Query detailed information about a house.
    // pub const HOUSE_QUERY: u32 = 0x021E;
    // /// C2S: Evict oneself from currently owned house.
    // pub const ABANDON_HOUSE: u32 = 0x021F;
    // /// C2S: Pay the weekly rent for the house.
    // pub const RENT_HOUSE: u32 = 0x0221;
    // /// C2S: Add a player to the house's permanent guest list.
    // pub const ADD_PERMANENT_GUEST: u32 = 0x0245;
    // /// C2S: Remove a player from the permanent guest list.
    // pub const REMOVE_PERMANENT_GUEST: u32 = 0x0246;
    // /// C2S: Toggle "Open House" mode (allows anyone to enter).
    // pub const SET_OPEN_HOUSE_STATUS: u32 = 0x0247;
    // /// C2S: Update entry/storage permissions for house items.
    // pub const CHANGE_STORAGE_PERMISSION: u32 = 0x0249;
    // /// C2S: Forcibly remove a specific guest from the house.
    // pub const BOOT_SPECIFIC_HOUSE_GUEST: u32 = 0x024A;
    // /// C2S: Revoke storage permissions from all players.
    // pub const REMOVE_ALL_STORAGE_PERMISSION: u32 = 0x024C;
    // /// C2S: Request the full list of guests currently in the house.
    // pub const REQUEST_FULL_GUEST_LIST: u32 = 0x024D;
    // /// C2S: Query the owner/lord of a house.
    // pub const QUERY_LORD: u32 = 0x0258;
    // /// C2S: Grant storage permissions to every guest.
    // pub const ADD_ALL_STORAGE_PERMISSION: u32 = 0x025C;
    // /// C2S: Clear the entire permanent guest list.
    // pub const REMOVE_ALL_PERMANENT_GUESTS: u32 = 0x025E;
    // /// C2S: Forcibly remove all guests from the house.
    // pub const BOOT_EVERYONE: u32 = 0x025F;
    // /// C2S: Toggle the visibility of housing decor hooks.
    // pub const SET_HOOKS_VISIBILITY: u32 = 0x0266;
    // /// C2S: Grant/revoke house entry based on allegiance rank.
    // pub const MODIFY_ALLEGIANCE_GUEST_PERMISSION: u32 = 0x0267;
    // /// C2S: Grant/revoke storage access based on allegiance rank.
    // pub const MODIFY_ALLEGIANCE_STORAGE_PERMISSION: u32 = 0x0268;
    // /// C2S: Request a list of houses currently available for purchase.
    // pub const LIST_AVAILABLE_HOUSES: u32 = 0x0270;

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
    // /// C2S: Teleport to a PK-Lite arena.
    // pub const TELE_TO_PKL_ARENA: u32 = 0x0026;
    // /// C2S: Teleport to a PK arena.
    // pub const TELE_TO_PK_ARENA: u32 = 0x0027;
    // /// C2S: Teleport to the character's attuned Lifestone.
    // pub const TELE_TO_LIFESTONE: u32 = 0x0063;
    // /// C2S: Special advocate-only teleport command.
    // pub const ADVOCATE_TELEPORT: u32 = 0x00D6;
    // /// C2S: Teleport to the allegiance mansion.
    // pub const TELE_TO_MANSION: u32 = 0x0278;
    // /// C2S: Teleport to the Marketplace.
    // pub const TELE_TO_MARKET_PLACE: u32 = 0x028D;
    // /// C2S: Enter a PK-Lite zone or state.
    // pub const ENTER_PK_LITE: u32 = 0x028F;
    // /// C2S: Server-controlled or legacy jump command.
    // pub const JUMP_NON_AUTONOMOUS: u32 = 0xF7C9;

    // --- Unused / Legacy Movement ---
    // These opcodes are defined in the protocol but are strictly unused in ACE
    // and modern clients, which prefer MoveToState (0xF61C) for all movement updates.
    // /// C2S: Start a movement command (legacy).
    // pub const DO_MOVEMENT_COMMAND: u32 = 0xF61E;
    // /// C2S: Stop a movement command (legacy).
    // pub const STOP_MOVEMENT_COMMAND: u32 = 0xF661;

    // --- Miscellaneous & Permissions ---
    // /// C2S: Clear the list of players with corpse-looting consent.
    // pub const CLEAR_PLAYER_CONSENT_LIST: u32 = 0x0216;
    // /// C2S: Request the current corpse-looting consent list.
    // pub const DISPLAY_PLAYER_CONSENT_LIST: u32 = 0x0217;
    // /// C2S: Revoke corpse-looting consent from a player.
    // pub const REMOVE_FROM_PLAYER_CONSENT_LIST: u32 = 0x0218;
    // /// C2S: Add a specific interaction permission for a player.
    // pub const ADD_PLAYER_PERMISSION: u32 = 0x0219;
    // /// C2S: Revoke a specific interaction permission from a player.
    // pub const REMOVE_PLAYER_PERMISSION: u32 = 0x021A;
    // /// C2S: Join an active game of chess.
    // pub const CHESS_JOIN: u32 = 0x0269;
    // /// C2S: Terminate participation in a chess game.
    // pub const CHESS_QUIT: u32 = 0x026A;
    // /// C2S: Perform a piece move in chess.
    // pub const CHESS_MOVE: u32 = 0x026B;
    // /// C2S: Pass the turn to the opponent in chess.
    // pub const CHESS_MOVE_PASS: u32 = 0x026D;
    // /// C2S: Propose or accept a chess stalemate.
    // pub const CHESS_STALEMATE: u32 = 0x026E;
    // /// C2S: Forfeit an active quest contract.
    // pub const ABANDON_CONTRACT: u32 = 0x0316;
    // /// C2S: Request the server forcibly send an object's description.
    // pub const FORCE_OBJECT_DESC_SEND: u32 = 0xF6EA;
    // /// C2S: Internal server command to create an object.
    // pub const OBJECT_CREATE: u32 = 0xF745;
    // /// C2S: Internal server command to delete an object.
    // pub const OBJECT_DELETE: u32 = 0xF747;
    // /// C2S: Trigger an audio effect via the server.
    // pub const APPLY_SOUND_EFFECT: u32 = 0xF750;
    // /// C2S: Synchronize the client's autonomy level.
    // pub const AUTONOMY_LEVEL: u32 = 0xF752;
    // /// C2S: Trigger a visual particle effect via the server.
    // pub const APPLY_VISUAL_EFFECT: u32 = 0xF755;
}

pub mod game_event_opcodes {
    // --- Interaction & Login ---
    /// S2C: Detailed player description.
    /// Sent during login. Contains attributes, skills, and base stats.
    pub const PLAYER_DESCRIPTION: u32 = 0x0013;
    /// S2C: Start game message (after character enter).
    /// Final confirmation of successful entry. Usually triggers client-side login scripts.
    pub const START_GAME: u32 = 0x0282;
    /// S2C: Confirms that an object use operation is finished.
    pub const USE_DONE: u32 = 0x01C7;
    // /// S2C: Response to an age query.
    // pub const QUERY_AGE_RESPONSE: u32 = 0x01C3;
    // /// S2C: Request from server for character confirmation (e.g. before deletion).
    // pub const CHARACTER_CONFIRMATION_REQUEST: u32 = 0x0274;
    // /// S2C: Confirmation that a character management operation is done.
    // pub const CHARACTER_CONFIRMATION_DONE: u32 = 0x0276;
    // /// S2C: Confirms the player has joined the game session.
    // pub const JOIN_GAME_RESPONSE: u32 = 0x0281;

    // --- Social & Communication ---
    /// S2C: Broadcast channel message.
    /// Shared chat channels (General, Trade, etc).
    pub const CHANNEL_BROADCAST: u32 = 0x0147;
    // /// S2C: List of available chat channels.
    // pub const CHANNEL_LIST: u32 = 0x0148;
    // /// S2C: Index of a specific chat channel.
    // pub const CHANNEL_INDEX: u32 = 0x0149;
    /// S2C: Response to client ping request.
    pub const PING_RESPONSE: u32 = 0x01EA;
    /// S2C: Private tell message.
    pub const TELL: u32 = 0x02BD;
    // /// S2C: Displays a modal popup dialog with a message.
    // pub const POPUP_STRING: u32 = 0x0004;
    // /// S2C: Displays a temporary ticker-like message on the screen.
    // pub const COMMUNICATION_TRANSIENT_STRING: u32 = 0x02EB;
    // /// S2C: Triggers a character emote action.
    // pub const EMOTE: u32 = 0x01E2;
    // /// S2C: Synchronizes the client's squelch (ignore) list.
    // pub const SET_SQUELCH_DB: u32 = 0x01F4;
    // /// S2C: Configures the Turbine-specific chat channels.
    // pub const SET_TURBINE_CHAT_CHANNELS: u32 = 0x0295;

    // --- Allegiance & Social ---
    // /// S2C: Allegiance update operation was aborted.
    // pub const ALLEGIANCE_UPDATE_ABORTED: u32 = 0x0003;
    // /// S2C: Update to allegiance data (vassals, patrons).
    // pub const ALLEGIANCE_UPDATE: u32 = 0x0020;
    // /// S2C: Full update of the player's friends list.
    // pub const FRIENDS_LIST_UPDATE: u32 = 0x0021;
    // /// S2C: Detailed information about a character title.
    // pub const CHARACTER_TITLE: u32 = 0x0029;
    // /// S2C: Update to the current active title.
    // pub const UPDATE_TITLE: u32 = 0x002B;
    // /// S2C: Confirms that an allegiance data update is finished.
    // pub const ALLEGIANCE_ALLEGIANCE_UPDATE_DONE: u32 = 0x01C8;
    // /// S2C: Notifies the player that an allegiance member has logged in.
    // pub const ALLEGIANCE_LOGIN_NOTIFICATION: u32 = 0x027A;
    // /// S2C: Detailed response to an allegiance information request.
    // pub const ALLEGIANCE_INFO_RESPONSE: u32 = 0x027C;

    // --- Inventory & World ---
    /// S2C: List contents of a container.
    /// Sent when a player opens a chest or backpack.
    pub const VIEW_CONTENTS: u32 = 0x0196;
    /// S2C: Item moved into a container within the player's inventory.
    pub const INVENTORY_PUT_OBJ_IN_CONTAINER: u32 = 0x0022;
    /// S2C: Item dropped from inventory into the 3D world.
    pub const INVENTORY_PUT_OBJECT_IN_3D: u32 = 0x019A;
    /// S2C: Notification that an item has been equipped or wielded.
    pub const WIELD_OBJECT: u32 = 0x0023;
    // /// S2C: Contains vendor information and their shop inventory.
    // pub const VENDOR_INFO_EVENT: u32 = 0x0062;
    // /// S2C: Closes the view of a container on the ground.
    // pub const CLOSE_GROUND_CONTAINER: u32 = 0x0052;
    // /// S2C: Notification that an inventory save operation failed on the server.
    // pub const INVENTORY_SERVER_SAVE_FAILED: u32 = 0x00A0;

    // --- Visuals & Identification ---
    // /// S2C: Returns detailed identification data for an object (Identify spell).
    // pub const IDENTIFY_OBJECT_RESPONSE: u32 = 0x00C9;
    // /// S2C: Indicates the appraisal of an item is finished.
    // pub const ITEM_APPRAISE_DONE: u32 = 0x01CB;
    // /// S2C: Returns the inscription text for an object.
    // pub const GET_INSCRIPTION_RESPONSE: u32 = 0x00C3;

    // --- Books & Inscriptions ---
    // /// S2C: Response containing the metadata and content of a book.
    // pub const BOOK_DATA_RESPONSE: u32 = 0x00B4;
    // /// S2C: Result of a book page modification.
    // pub const BOOK_MODIFY_PAGE_RESPONSE: u32 = 0x00B5;
    // /// S2C: Result of adding a new page to a book.
    // pub const BOOK_ADD_PAGE_RESPONSE: u32 = 0x00B6;
    // /// S2C: Result of deleting a page from a book.
    // pub const BOOK_DELETE_PAGE_RESPONSE: u32 = 0x00B7;
    // /// S2C: Returns specific page data for a book.
    // pub const BOOK_PAGE_DATA_RESPONSE: u32 = 0x00B8;
    // /// S2C: Result of a salvaging operation.
    // pub const SALVAGE_OPERATIONS_RESULT: u32 = 0x02B4;

    // --- Combat & Stats ---
    // /// S2C: Notification that the current attack sequence is finished.
    // pub const ATTACK_DONE: u32 = 0x01A7;
    // /// S2C: Notifies the attacker about the result of their attack.
    // pub const ATTACKER_NOTIFICATION: u32 = 0x01B1;
    // /// S2C: Notifies the defender that they were attacked.
    // pub const DEFENDER_NOTIFICATION: u32 = 0x01B2;
    // /// S2C: Notifies the attacker that the target evaded.
    // pub const EVASION_ATTACKER_NOTIFICATION: u32 = 0x01B3;
    // /// S2C: Notifies the defender that they successfully evaded an attack.
    // pub const EVASION_DEFENDER_NOTIFICATION: u32 = 0x01B4;
    // /// S2C: Signals the start of an attack sequence.
    // pub const COMBAT_COMMENCE_ATTACK: u32 = 0x01B8;
    // /// S2C: Updates the health (Stamina) of an object.
    // pub const UPDATE_HEALTH: u32 = 0x01C0;
    // /// S2C: Sent to the victim when they die.
    // pub const VICTIM_NOTIFICATION: u32 = 0x01AC;
    // /// S2C: Sent to the killer when they defeat a target.
    // pub const KILLER_NOTIFICATION: u32 = 0x01AD;

    // --- Magic & Enchantments ---
    // /// S2C: Removes a spell from the player's spellbook.
    // pub const MAGIC_REMOVE_SPELL: u32 = 0x01A8;
    // /// S2C: Adds or updates a spell in the player's spellbook.
    // pub const MAGIC_UPDATE_SPELL: u32 = 0x02C1;
    /// S2C: Add or update an enchantment (buff/debuff).
    pub const MAGIC_UPDATE_ENCHANTMENT: u32 = 0x02C2;
    /// S2C: Remove an active enchantment.
    pub const MAGIC_REMOVE_ENCHANTMENT: u32 = 0x02C3;
    /// S2C: Batch update multiple enchantments.
    pub const MAGIC_UPDATE_MULTIPLE_ENCHANTMENTS: u32 = 0x02C4;
    /// S2C: Batch remove multiple enchantments.
    pub const MAGIC_REMOVE_MULTIPLE_ENCHANTMENTS: u32 = 0x02C5;
    /// S2C: Clears all active enchantments.
    pub const MAGIC_PURGE_ENCHANTMENTS: u32 = 0x02C6;
    // /// S2C: Dispels a specific active enchantment.
    // pub const MAGIC_DISPEL_ENCHANTMENT: u32 = 0x02C7;
    // /// S2C: Dispels multiple active enchantments.
    // pub const MAGIC_DISPEL_MULTIPLE_ENCHANTMENTS: u32 = 0x02C8;
    /// S2C: Purges all harmful enchantments (debuffs).
    pub const MAGIC_PURGE_BAD_ENCHANTMENTS: u32 = 0x0312;
    // /// S2C: Response to an item mana query.
    // pub const QUERY_ITEM_MANA_RESPONSE: u32 = 0x0264;
    // /// S2C: Alerts the client that a portal storm is starting to form due to crowding.
    // pub const MISC_PORTAL_STORM_BREWING: u32 = 0x02C9;
    // /// S2C: Alerts that a portal storm is about to trigger.
    // pub const MISC_PORTAL_STORM_IMMINENT: u32 = 0x02CA;
    // /// S2C: Notification that a portal storm has occurred (teleporting players).
    // pub const MISC_PORTAL_STORM: u32 = 0x02CB;
    // /// S2C: Notification that the portal storm has ended.
    // pub const MISC_PORTALSTORM_SUBSIDED: u32 = 0x02CC;

    // --- Trade ---
    // /// S2C: Registers a new trade session between two players.
    // pub const REGISTER_TRADE: u32 = 0x01FD;
    // /// S2C: Opens the trade window on the client.
    // pub const OPEN_TRADE: u32 = 0x01FE;
    // /// S2C: Closes the trade window.
    // pub const CLOSE_TRADE: u32 = 0x01FF;
    // /// S2C: Detailed status update for an ongoing trade session.
    // pub const TRADE_UPDATE: u32 = 0x01FA;
    // /// S2C: Notifies that an item was added to the trade offer.
    // pub const ADD_TO_TRADE: u32 = 0x0200;
    // /// S2C: Notifies that an item was removed from the trade offer.
    // pub const REMOVE_FROM_TRADE: u32 = 0x0201;
    // /// S2C: Notifies that the other player has accepted the current trade.
    // pub const ACCEPT_TRADE: u32 = 0x0202;
    // /// S2C: Notifies that the other player has declined the trade.
    // pub const DECLINE_TRADE: u32 = 0x0203;
    // /// S2C: Resets the trade agreement state.
    // pub const RESET_TRADE: u32 = 0x0205;
    // /// S2C: Notification that the trade operation failed.
    // pub const TRADE_FAILURE: u32 = 0x0207;
    // /// S2C: Clears the trade acceptance flag.
    // pub const CLEAR_TRADE_ACCEPTANCE: u32 = 0x0208;

    // --- Housing ---
    // /// S2C: Returns detailed profile and description of a house.
    // pub const HOUSE_PROFILE: u32 = 0x021D;
    // /// S2C: Detailed data for a specific house.
    // pub const HOUSE_DATA: u32 = 0x0225;
    // /// S2C: Updates the ownership and status of a house.
    // pub const HOUSE_STATUS: u32 = 0x0226;
    // /// S2C: Updates the remaining rent time for a property.
    // pub const UPDATE_RENT_TIME: u32 = 0x0227;
    // /// S2C: Confirms a rent payment was processed.
    // pub const UPDATE_RENT_PAYMENT: u32 = 0x0228;
    // /// S2C: Updates the guest and banning restrictions for a house.
    // pub const HOUSE_UPDATE_RESTRICTIONS: u32 = 0x0248;
    // /// S2C: Updates House Accessibility Rules (HAR) such as guest lists.
    // pub const UPDATE_HAR: u32 = 0x0257;
    // /// S2C: Response containing extended data for a house.
    // pub const HOUSE_DATA_RESPONSE: u32 = 0x022F;
    // /// S2C: Notification of a house-related transaction (purchase/sale).
    // pub const HOUSE_TRANSACTION: u32 = 0x0259;
    // /// S2C: Returns a list of currently available houses for purchase.
    // pub const AVAILABLE_HOUSES: u32 = 0x0271;

    // --- Fellowship ---
    // /// S2C: Notifies that a member has quit the fellowship.
    // pub const FELLOWSHIP_QUIT: u32 = 0x00A3;
    // /// S2C: Notifies that a member was dismissed from the fellowship.
    // pub const FELLOWSHIP_DISMISS: u32 = 0x00A4;
    // /// S2C: Confirms that a fellow's data update is complete.
    // pub const FELLOWSHIP_FELLOW_UPDATE_DONE: u32 = 0x01C9;
    // /// S2C: Confirms that a fellow's statistics update is complete.
    // pub const FELLOWSHIP_FELLOW_STATS_DONE: u32 = 0x01CA;
    // /// S2C: Provides a full synchronization of the fellowship's state.
    // pub const FELLOWSHIP_FULL_UPDATE: u32 = 0x02BE;
    // /// S2C: Notifies that the fellowship has been disbanded.
    // pub const FELLOWSHIP_DISBAND: u32 = 0x02BF;
    // /// S2C: Updates specific data for a fellowship member.
    // pub const FELLOWSHIP_UPDATE_FELLOW: u32 = 0x02C0;

    // --- Minigames (Chess) ---
    // /// S2C: Response to a movement or teleport request.
    // pub const MOVE_RESPONSE: u32 = 0x0283;
    // /// S2C: (Internal/Minigame) Signals that it is the opponent's turn.
    // pub const OPPONENT_TURN: u32 = 0x0284;
    // /// S2C: (Internal/Minigame) Signals a stalemate condition.
    // pub const OPPONENT_STALEMATE: u32 = 0x0285;
    // /// S2C: (Internal/Minigame) Signals that the game session has ended.
    // pub const GAME_OVER: u32 = 0x028C;

    // --- Admin & Plugins ---
    // /// S2C: Admin-only query for the server's plugin list.
    // pub const ADMIN_QUERY_PLUGIN_LIST: u32 = 0x02AE;
    // /// S2C: Admin-only query for a specific plugin's status.
    // pub const ADMIN_QUERY_PLUGIN: u32 = 0x02B1;
    // /// S2C: Admin-only response to a plugin query.
    // pub const ADMIN_QUERY_PLUGIN_RESPONSE: u32 = 0x02B3;

    // --- Contract Tracker ---
    // /// S2C: Sends the full contract tracker table defined by the server.
    // pub const SEND_CLIENT_CONTRACT_TRACKER_TABLE: u32 = 0x0314;
    // /// S2C: Updates specific contract tracker progress data.
    // pub const SEND_CLIENT_CONTRACT_TRACKER: u32 = 0x0315;

    // --- Errors ---
    /// S2C: Game error related to a specific weenie (world object).
    /// E.g. "You cannot pick that up."
    pub const WEENIE_ERROR: u32 = 0x028A;
    /// S2C: Game error related to a specific weenie with an extra parameter string.
    pub const WEENIE_ERROR_WITH_STRING: u32 = 0x028B;

    // --- Miscellaneous ---
    // /// S2C: Opens the character barber (customization) UI.
    // pub const START_BARBER: u32 = 0x0075;
}
