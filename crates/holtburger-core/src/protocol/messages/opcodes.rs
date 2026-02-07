use strum_macros::FromRepr;

#[derive(Debug, Clone, Copy, PartialEq, Eq, FromRepr)]
#[repr(u32)]
pub enum GameOpcode {
    // --- Connection & Character Selection ---
    // /// C2S: Request to create a new character.
    // CharacterCreate = 0xF656,
    // /// C2S: Request to delete a character.
    // CharacterDelete = 0xF655,
    /// S2C: Final character enter world message.
    /// Confirms the client is now active in the world.
    CharacterEnterWorld = 0xF657,
    /// S2C: List of characters for account.
    /// Sent by the server after a successful login/handshake to let the client choose a character.
    CharacterList = 0xF658,
    /// S2C: Error during character operations.
    /// Sent if a login request fails (e.g., character already in world).
    CharacterError = 0xF659,
    // /// S2C: Response to character creation/restore.
    // CharacterCreateResponse = 0xF643,
    // /// C2S: Request to restore a deleted character.
    // CharacterRestore = 0xF7D9,
    /// C2S: Request to enter world with character.
    /// Initiates the world login sequence. Server typically responds with SERVER_READY or an error.
    CharacterEnterWorldRequest = 0xF7C8,
    /// S2C: Server is ready for character to enter.
    /// Acknowledges the enter request and tells the client to load the 3D world.
    CharacterEnterWorldServerReady = 0xF7DF,

    // --- World & Object Lifecycle ---
    /// S2C: Inventory object removal.
    InventoryRemoveObject = 0x0024,
    /// S2C: Set stack size of an object.
    SetStackSize = 0x0197,
    /// S2C: Create an object in the world.
    /// Used to spawn monsters, items on the ground, or other players. Includes full model and physics data.
    ObjectCreate = 0xF745,
    /// S2C: Create the player object.
    /// Identifies the player's own character to the client. Sent exactly once per session during login.
    PlayerCreate = 0xF746,
    /// S2C: Delete an object from the world.
    /// Sent when an object leaves the client's "bubble" or is destroyed/taken.
    ObjectDelete = 0xF747,
    /// S2C: Object parenting event.
    /// Used when an item is picked up (parented to player) or equipped.
    ParentEvent = 0xF749,
    /// S2C: Object pickup event.
    /// Notify client that an object was successfully picked up.
    PickupEvent = 0xF74A,
    /// S2C: Update object properties.
    /// A heavy update that re-sends the visual description and physics state of an object.
    UpdateObject = 0xF7DB,
    // /// S2C: Position and movement update (all-in-one packet).
    // /// This is a "ghost" opcode—defined in headers but not implemented or used in modern emulators.
    // PositionAndMovement = 0xF619,
    /// S2C: Object description event.
    ObjDescEvent = 0xF625,
    /// S2C: Force object description send.
    ForceObjectDescSend = 0xF6EA,

    // --- Movement & Physics ---
    /// S2C: Update object position.
    /// Periodic position sync for all objects in the bubble.
    UpdatePosition = 0xF748,
    /// S2C: Update object motion (animations).
    /// Syncs movement animations for monsters and other players.
    UpdateMotion = 0xF74C,
    /// S2C: Update object movement vector.
    /// Used for objects in flight (missiles) or performing continuous turns.
    VectorUpdate = 0xF74E,
    /// S2C: Set the client's autonomy level (how much gravity/collision to trust client for).
    AutonomyLevel = 0xF752,
    /// S2C: Sync player's own position (Server-forced resync).
    /// Used for resetting the player's position or confirming client-reported coordinates.
    AutonomousPosition = 0xF753,
    /// S2C: Force player to teleport.
    /// Triggers the teleport screen and moves player to a new landblock.
    PlayerTeleport = 0xF751,
    // /// S2C: Request the client to turn to a specific heading or object.
    // /// This appears to be an invalid or unused opcode.
    // TurnTo = 0xF649,
    /// S2C: Update private position (for private houses/zones).
    PrivateUpdatePosition = 0x02DB,
    /// S2C: Update public position.
    PublicUpdatePosition = 0x02DC,

    // --- Property Updates (Public/Private) ---
    /// S2C: Update private Int property.
    /// Property updates marked 'Private' are only sent to the owner of the object.
    PrivateUpdatePropertyInt = 0x02CD,
    /// S2C: Update public Int property.
    /// Property updates marked 'Public' are broadcast to everyone who sees the object.
    PublicUpdatePropertyInt = 0x02CE,
    /// S2C: Update private Int64 property.
    PrivateUpdatePropertyInt64 = 0x02CF,
    /// S2C: Update public Int64 property.
    PublicUpdatePropertyInt64 = 0x02D0,
    /// S2C: Update private Bool property.
    PrivateUpdatePropertyBool = 0x02D1,
    /// S2C: Update public Bool property.
    PublicUpdatePropertyBool = 0x02D2,
    /// S2C: Update private Float property.
    PrivateUpdatePropertyFloat = 0x02D3,
    /// S2C: Update public Float property.
    PublicUpdatePropertyFloat = 0x02D4,
    /// S2C: Update private String property.
    PrivateUpdatePropertyString = 0x02D5,
    /// S2C: Update public String property.
    PublicUpdatePropertyString = 0x02D6,
    /// S2C: Update private DataID property.
    PrivateUpdatePropertyDid = 0x02D7,
    /// S2C: Update public DataID property.
    PublicUpdatePropertyDid = 0x02D8,
    /// S2C: Update private InstanceID property.
    PrivateUpdatePropertyIid = 0x02D9,
    /// S2C: Update public InstanceID property.
    PublicUpdatePropertyIid = 0x02DA,

    // --- Stats & Skills ---
    /// S2C: Update private Skill level/experience.
    /// Sent when a player trains or earns XP in a skill.
    PrivateUpdateSkill = 0x02DD,
    /// S2C: Update public Skill level/experience.
    PublicUpdateSkill = 0x02DE,
    /// S2C: Update private Skill level (base value).
    PrivateUpdateSkillLevel = 0x02DF,
    /// S2C: Update public Skill level (base value).
    PublicUpdateSkillLevel = 0x02E0,
    /// S2C: Update private Attribute value.
    /// Updates base attributes (Strength, Stamina, etc).
    PrivateUpdateAttribute = 0x02E3,
    /// S2C: Update public Attribute value.
    PublicUpdateAttribute = 0x02E4,
    /// S2C: Update private Vital value.
    /// Updates max health, stamina, or mana.
    PrivateUpdateVital = 0x02E7,
    /// S2C: Update public Vital value.
    PublicUpdateVital = 0x02E8,
    /// Updates current health/stamina/mana levels.
    PrivateUpdateVitalCurrent = 0x02E9,
    // /// S2C: Update public Vital current value (tick). (Note: Confirmed GHOST, 0x02EA is unused in ACE)
    // PublicUpdateVitalCurrentGhost = 0x02EA,
    // /// S2C: Player was killed in combat.
    // PlayerKilled = 0x019E,

    // --- Communication & Chat ---
    /// S2C: Text emote.
    /// E.g., "The Olthoi growls at you."
    EmoteText = 0x01E0,
    /// S2C: Soul emote (visuals/text).
    /// Complex emotes involving animations and text.
    SoulEmote = 0x01E2,
    /// S2C: Chat message heard by player.
    /// Standard local chat from other players or NPCs.
    HearSpeech = 0x02BB,
    /// S2C: Ranged chat message heard by player.
    /// Used for shouts or long-distance local chat.
    HearRangedSpeech = 0x02BC,
    /// S2C: System or chat message.
    /// Used for general server announcements, combat logs, and error messages.
    ServerMessage = 0xF7E0,
    // /// S2C: Turbine chat message.
    // TurbineChat = 0xF7DE,

    // --- Visuals & Audio ---
    /// S2C: Play a sound effect.
    /// Triggers a sound at the object's location.
    Sound = 0xF750,
    /// S2C: Set object state.
    /// Updates the visual/functional state of an object (e.g., door opening).
    SetState = 0xF74B,
    // /// S2C: Play a script by ID.
    // PlayScriptId = 0xF754,
    /// S2C: Play a visual effect.
    /// Triggers a particle system, overlay, or other visual script.
    PlayEffect = 0xF755,

    // --- Game Logic & Flow ---
    /// S2C: Wrapper for various game events.
    /// High-level container for asynchronous server-sent events like chat, tells, and world state changes.
    GameEvent = 0xF7B0,
    /// C2S: Wrapper for various game actions.
    /// High-level container for client-initiated actions such as using items, talking, or moving.
    GameAction = 0xF7B1,
    // /// S2C: Admin environs (legacy admin tool).
    // AdminEnvirons = 0xEA60,

    // --- Data Download (DDD) ---
    /// S2C: Data download interrogation.
    /// Part of the DDD (Distribution Database Download) system for syncing game data.
    DddInterrogation = 0xF7E5,
    /// C2S: Response to data download interrogation.
    DddInterrogationResponse = 0xF7E6,
    // /// S2C/C2S: DDD data message.
    // DddDataMessage = 0xF7E2,
    // /// S2C/C2S: Request DDD data.
    // DddRequestDataMessage = 0xF7E3,
    // /// S2C/C2S: DDD error message.
    // DddErrorMessage = 0xF7E4,
    // /// S2C/C2S: Begin DDD process.
    // DddBeginDdd = 0xF7E7,
    // /// S2C/C2S: Begin pull DDD process.
    // DddBeginPullDdd = 0xF7E8,
    // /// S2C/C2S: DDD iteration data.
    // DddIterationData = 0xF7E9,
    // /// S2C: End DDD process.
    // DddEndDdd = 0xF7EA,

    // --- Server & Account Status ---
    // /// S2C: Account has been banned.
    // AccountBanned = 0xF7C1,
    /// S2C: Kick player from server.
    /// Sent when the account is logged out or banned.
    BootAccount = 0xF7DC,
    /// S2C: Server name information.
    /// Sent during login to inform the client which shard it has connected to.
    ServerName = 0xF7E1,
    // /// S2C: Force character log off.
    // CharacterLogOff = 0xF653,
    // /// S2C: Get server version.
    // GetServerVersion = 0xF7CC,
    // /// S2C: Friends list (obsolete).
    // FriendsOld = 0xF7CD,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, FromRepr, Hash)]
#[repr(u32)]
pub enum GameActionOpcode {
    // --- Communication & Chat ---
    // /// C2S: Toggle Away From Keyboard (AFK) status.
    // SetAfkMode = 0x000F,
    // /// C2S: Set the custom AFK message.
    // SetAfkMessage = 0x0010,
    /// C2S: Send chat message.
    Talk = 0x0015,
    // /// C2S: Send direct message (similar to TELL).
    // TalkDirect = 0x0032,
    /// C2S: Send direct message/tell.
    Tell = 0x005D,
    // /// C2S: Add a custom chat channel.
    // AddChannel = 0x0145,
    // /// C2S: Remove a custom chat channel.
    // RemoveChannel = 0x0146,
    // /// C2S: Send message to a specific chat channel.
    // ChatChannel = 0x0147,
    // /// C2S: Request list of available chat channels.
    // ListChannels = 0x0148,
    // /// C2S: Request an index of chat channels.
    // IndexChannels = 0x0149,
    // /// C2S: Request the abuse report log.
    // AbuseLogRequest = 0x0140,
    // /// C2S: Set the Message of the Day (MOTD).
    // SetMotd = 0x0254,
    // /// C2S: Query the current Message of the Day (MOTD).
    // QueryMotd = 0x0255,
    // /// C2S: Clear the current Message of the Day (MOTD).
    // ClearMotd = 0x0256,
    // /// C2S: Mute/squelch a specific character.
    // ModifyCharacterSquelch = 0x0058,
    // /// C2S: Mute/squelch an entire account.
    // ModifyAccountSquelch = 0x0059,
    // /// C2S: Mute/squelch a global chat channel.
    // ModifyGlobalSquelch = 0x005B,
    // /// C2S: Perform a character emote.
    // Emote = 0x01DF,
    // /// C2S: Perform a visual "soul emote".
    // SoulEmote = 0x01E1,
    /// C2S: Request a ping response.
    /// Used to measure latency and keep the connection alive.
    PingRequest = 0x01E9,

    // --- Inventory & Items ---
    /// C2S: Move an item into a container.
    /// Also used for picking up items from the ground (moving to backpack).
    PutItemInContainer = 0x0019,
    /// C2S: Pick up and wield an item in one action.
    GetAndWieldItem = 0x001A,
    /// C2S: Drop an item on the ground.
    DropItem = 0x001B,
    // /// C2S: Purchase item(s) from a vendor.
    // Buy = 0x005F,
    // /// C2S: Sell item(s) to a vendor.
    // Sell = 0x0060,
    // /// C2S: Merge two stacks of items.
    // StackableMerge = 0x0054,
    // /// C2S: Split an item stack into a container.
    // StackableSplitToContainer = 0x0055,
    // /// C2S: Split an item stack onto the ground.
    // StackableSplitTo3D = 0x0056,
    /// C2S: Split stackable items and wield.
    StackableSplitToWield = 0x019B,
    // /// C2S: Stop viewing a container's contents.
    // NoLongerViewingContents = 0x0195,
    // /// C2S: Use components to create a tinkering tool.
    // CreateTinkeringTool = 0x027D,
    // /// C2S: Query current mana levels of an item.
    // QueryItemMana = 0x0263,
    // /// C2S: Attempt to give an item to another player.
    // GiveObjectRequest = 0x00CD,

    // --- Books & Inscriptions ---
    // /// C2S: Request book metadata (title, author, etc).
    // BookData = 0x00AA,
    // /// C2S: Update the text of a book page.
    // BookModifyPage = 0x00AB,
    // /// C2S: Add a new page to a book.
    // BookAddPage = 0x00AC,
    // /// C2S: Remove a page from a book.
    // BookDeletePage = 0x00AD,
    // /// C2S: Request the text content of a book page.
    // BookPageData = 0x00AE,
    // /// C2S: Add an inscription to an item (Notes, Crafted items).
    // SetInscription = 0x00BF,

    // --- Interaction & Login ---
    // /// C2S: Toggles boolean character options (Appear Offline, Show Cloak, etc).
    // SetSingleCharacterOption = 0x0005,
    /// C2S: Sent when client finishes loading the world.
    /// Signals the server that the client is ready to receive world updates.
    LoginComplete = 0x00A1,
    /// C2S: Use an object.
    /// Blanket action for clicking doors, Lifestones, or using inventory items.
    Use = 0x0036,
    // /// C2S: Use an item on a specific target (e.g. lockpicking).
    // UseWithTarget = 0x0035,
    /// C2S: Identify an object.
    /// Request full property details for an object (Assess).
    IdentifyObject = 0x00C8,
    // /// C2S: Set character options/settings.
    // SetCharacterOptions = 0x01A1,
    // /// C2S: Remove all characters from the friends list.
    // RemoveAllFriends = 0x0025,
    // /// C2S: Query a character's creation age.
    // QueryAge = 0x01C2,
    // /// C2S: Query a character's birth date.
    // QueryBirth = 0x01C4,
    // /// C2S: Add an item or spell shortcut to the UI.
    // AddShortCut = 0x019C,
    // /// C2S: Remove a shortcut from the UI.
    // RemoveShortCut = 0x019D,
    // /// C2S: Response to a server confirmation dialog.
    // ConfirmationResponse = 0x0275,
    // /// C2S: Response to an admin plugin list query.
    // QueryPluginListResponse = 0x02AF,
    // /// C2S: Response to an admin plugin detail query.
    // QueryPluginResponse = 0x02B2,
    // /// C2S: Finalize character changes in a barber session.
    // FinishBarber = 0x0311,
    /// C2S: Change state (e.g. sit, stand).
    MoveToState = 0xF61C,
    /// C2S: Perform a jump.
    Jump = 0xF61B,
    /// C2S: Periodic position pulse (Heartbeat).
    AutonomousPosition = 0xF753,
    // --- Combat & Spells ---
    // /// C2S: Initiate a melee attack on a target.
    // TargetedMeleeAttack = 0x0008,
    // /// C2S: Initiate a missile attack on a target.
    // TargetedMissileAttack = 0x000A,
    // /// C2S: Cast a spell on a specific target.
    // CastTargetedSpell = 0x004A,
    // /// C2S: Cast a spell without a target (e.g. self-buff).
    // CastUntargetedSpell = 0x0048,
    // /// C2S: Cycle through combat modes (Peace, Melee, Missile, Magic).
    // ChangeCombatMode = 0x0053,
    // /// C2S: Cancel the current combat attack sequence.
    // CancelAttack = 0x01B7,
    // /// C2S: Remove a spell from the character's spellbook.
    // RemoveSpellC2S = 0x01A8,
    // /// C2S: Mark a spell as a favorite in the spellbook.
    // AddSpellFavorite = 0x01E3,
    // /// C2S: Remove a spell from the favorites list.
    // RemoveSpellFavorite = 0x01E4,
    // /// C2S: Apply active filters to the spellbook view.
    // SpellbookFilter = 0x0286,
    // /// C2S: Forcibly kill the character.
    // Suicide = 0x0279,
    // /// C2S: Increase a vital (Health, Stamina, Mana) using experience.
    // RaiseVital = 0x0044,
    // /// C2S: Increase an attribute (Strength, Endurance, etc) using experience.
    // RaiseAttribute = 0x0045,
    // /// C2S: Increase a skill (Melee Defense, etc) using experience.
    // RaiseSkill = 0x0046,
    // /// C2S: Spend skill points to train or untrain a skill.
    // TrainSkill = 0x0047,
    // /// C2S: Set the desired material/component level for spellcasting.
    // SetDesiredComponentLevel = 0x0224,

    // --- Allegiance & Social ---
    // /// C2S: Swear allegiance to a patron.
    // SwearAllegiance = 0x001D,
    // /// C2S: Break allegiance from a patron/vassal.
    // BreakAllegiance = 0x001E,
    // /// C2S: Request an update of allegiance information.
    // AllegianceUpdateRequest = 0x001F,
    // /// C2S: Add a player to the friends list.
    // AddFriend = 0x0018,
    // /// C2S: Remove a player from the friends list.
    // RemoveFriend = 0x0017,
    // /// C2S: Query detailed allegiance hierarchy and status.
    // AllegianceInfoRequest = 0x027B,
    // /// C2S: Query the name of an allegiance member.
    // QueryAllegianceName = 0x0030,
    // /// C2S: Clear a custom name for an allegiance member.
    // ClearAllegianceName = 0x0031,
    // /// C2S: Set a custom name for an allegiance member.
    // SetAllegianceName = 0x0033,
    // /// C2S: Designate a vassal as an allegiance officer.
    // SetAllegianceOfficer = 0x003B,
    // /// C2S: Assign a custom title to an allegiance officer.
    // SetAllegianceOfficerTitle = 0x003C,
    // /// C2S: List all officer titles in the allegiance.
    // ListAllegianceOfficerTitles = 0x003D,
    // /// C2S: Clear all custom officer titles.
    // ClearAllegianceOfficerTitles = 0x003E,
    // /// C2S: Toggle the allegiance lock (allowing/preventing new vassals).
    // DoAllegianceLockAction = 0x003F,
    // /// C2S: Add a player to the approved vassal list.
    // SetAllegianceApprovedVassal = 0x0040,
    // /// C2S: Mute/gag a player in allegiance chat.
    // AllegianceChatGag = 0x0041,
    // /// C2S: Perform housing actions via allegiance (e.g. mansion recall).
    // DoAllegianceHouseAction = 0x0042,
    // /// C2S: Forcibly break allegiance with a vassal (boot).
    // BreakAllegianceBoot = 0x0277,
    // /// C2S: Remove a player from allegiance chat.
    // AllegianceChatBoot = 0x02A0,
    // /// C2S: Add a permanent ban for a player from the allegiance.
    // AddAllegianceBan = 0x02A1,
    // /// C2S: Remove a ban from the allegiance list.
    // RemoveAllegianceBan = 0x02A2,
    // /// C2S: List all banned players for the allegiance.
    // ListAllegianceBans = 0x02A3,
    // /// C2S: Remove the officer status from a vassal.
    // RemoveAllegianceOfficer = 0x02A5,
    // /// C2S: List all current officers in the allegiance.
    // ListAllegianceOfficers = 0x02A6,
    // /// C2S: Remove all officers from their positions.
    // ClearAllegianceOfficers = 0x02A7,
    // /// C2S: Recall the character to their allegiance hometown.
    // RecallAllegianceHometown = 0x02AB,
    // /// C2S: Select an active character title.
    // TitleSet = 0x002C,
    // /// C2S: Query the current health/vitals of another player.
    // QueryHealth = 0x01BF,

    // --- Fellowship ---
    // /// C2S: Create a new fellowship group.
    // FellowshipCreate = 0x00A2,
    // /// C2S: Invite a player into the fellowship.
    // FellowshipRecruit = 0x00A5,
    // /// C2S: Leave the current fellowship.
    // FellowshipQuit = 0x00A3,
    // /// C2S: Remove another player from the fellowship.
    // FellowshipDismiss = 0x00A4,
    // /// C2S: Update fellowship configuration (open/closed, etc).
    // FellowshipUpdateRequest = 0x00A6,
    // /// C2S: Designate a new fellowship leader.
    // FellowshipAssignNewLeader = 0x0290,
    // /// C2S: Toggle the fellowship's open/closed enrollment status.
    // FellowshipChangeOpenness = 0x0291,

    // --- Trade ---
    // /// C2S: Initiate trade negotiation with another player.
    // OpenTradeNegotiations = 0x01F6,
    // /// C2S: Terminate the current trade negotiation.
    // CloseTradeNegotiations = 0x01F7,
    // /// C2S: Add an item or stack to the trade window.
    // AddToTrade = 0x01F8,
    // /// C2S: Commit to the current trade agreement.
    // AcceptTrade = 0x01FA,
    // /// C2S: Reject the current trade agreement.
    // DeclineTrade = 0x01FB,
    // /// C2S: Clear all items and status from the trade window.
    // ResetTrade = 0x0204,

    // --- Housing ---
    // /// C2S: Purchase a selected house.
    // BuyHouse = 0x021C,
    // /// C2S: Query detailed information about a house.
    // HouseQuery = 0x021E,
    // /// C2S: Evict oneself from currently owned house.
    // AbandonHouse = 0x021F,
    // /// C2S: Pay the weekly rent for the house.
    // RentHouse = 0x0221,
    // /// C2S: Add a player to the house's permanent guest list.
    // AddPermanentGuest = 0x0245,
    // /// C2S: Remove a player from the permanent guest list.
    // RemovePermanentGuest = 0x0246,
    // /// C2S: Toggle "Open House" mode (allows anyone to enter).
    // SetOpenHouseStatus = 0x0247,
    // /// C2S: Update entry/storage permissions for house items.
    // ChangeStoragePermission = 0x0249,
    // /// C2S: Forcibly remove a specific guest from the house.
    // BootSpecificHouseGuest = 0x024A,
    // /// C2S: Revoke storage permissions from all players.
    // RemoveAllStoragePermission = 0x024C,
    // /// C2S: Request the full list of guests currently in the house.
    // RequestFullGuestList = 0x024D,
    // /// C2S: Query the owner/lord of a house.
    // QueryLord = 0x0258,
    // /// C2S: Grant storage permissions to every guest.
    // AddAllStoragePermission = 0x025C,
    // /// C2S: Clear the entire permanent guest list.
    // RemoveAllPermanentGuests = 0x025E,
    // /// C2S: Forcibly remove all guests from the house.
    // BootEveryone = 0x025F,
    // /// C2S: Toggle the visibility of housing decor hooks.
    // SetHooksVisibility = 0x0266,
    // /// C2S: Grant/revoke house entry based on allegiance rank.
    // ModifyAllegianceGuestPermission = 0x0267,
    // /// C2S: Grant/revoke storage access based on allegiance rank.
    // ModifyAllegianceStoragePermission = 0x0268,
    // /// C2S: Request a list of houses currently available for purchase.
    // ListAvailableHouses = 0x0270,

    // --- Movement (Extra) ---
    // /// C2S: Teleport to a PK-Lite arena.
    // TeleToPklArena = 0x0026,
    // /// C2S: Teleport to a PK arena.
    // TeleToPkArena = 0x0027,
    // /// C2S: Teleport to the character's attuned Lifestone.
    // TeleToLifestone = 0x0063,
    // /// C2S: Special advocate-only teleport command.
    // AdvocateTeleport = 0x00D6,
    // /// C2S: Teleport to the allegiance mansion.
    // TeleToMansion = 0x0278,
    // /// C2S: Teleport to the Marketplace.
    // TeleToMarketPlace = 0x028D,
    // /// C2S: Enter a PK-Lite zone or state.
    // EnterPkLite = 0x028F,
    // /// C2S: Server-controlled or legacy jump command.
    // JumpNonAutonomous = 0xF7C9,
    // /// C2S: Start a movement command (legacy).
    // DoMovementCommand = 0xF61E,
    // /// C2S: Stop a movement command (legacy).
    // StopMovementCommand = 0xF661,

    // --- Miscellaneous & Permissions ---
    // /// C2S: Clear the list of players with corpse-looting consent.
    // ClearPlayerConsentList = 0x0216,
    // /// C2S: Request the current corpse-looting consent list.
    // DisplayPlayerConsentList = 0x0217,
    // /// C2S: Revoke corpse-looting consent from a player.
    // RemoveFromPlayerConsentList = 0x0218,
    // /// C2S: Add a specific interaction permission for a player.
    // AddPlayerPermission = 0x0219,
    // /// C2S: Revoke a specific interaction permission from a player.
    // RemovePlayerPermission = 0x021A,
    // /// C2S: Join an active game of chess.
    // ChessJoin = 0x0269,
    // /// C2S: Terminate participation in a chess game.
    // ChessQuit = 0x026A,
    // /// C2S: Perform a piece move in chess.
    // ChessMove = 0x026B,
    // /// C2S: Pass the turn to the opponent in chess.
    // ChessMovePass = 0x026D,
    // /// C2S: Propose or accept a chess stalemate.
    // ChessStalemate = 0x026E,
    // /// C2S: Forfeit an active quest contract.
    // AbandonContract = 0x0316,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, FromRepr, Hash)]
#[repr(u32)]
pub enum GameEventOpcode {
    // --- High Level Events ---
    /// S2C: Player description data.
    PlayerDescription = 0x0013,
    /// S2C: Response to a ping request.
    PingResponse = 0x01EA,
    /// S2C: List container contents.
    ViewContents = 0x0196,
    /// S2C: Notify client that an object entered a container.
    InventoryPutObjInContainer = 0x0022,
    /// S2C: Notify client that an object was placed in the 3D world.
    InventoryPutObjectIn3D = 0x019A,
    /// S2C: Notify client that an object was wielded.
    WieldObject = 0x0023,
    /// S2C: Receive a tell from another player.
    Tell = 0x02BD,
    /// S2C: Broadcast message on a channel.
    ChannelBroadcast = 0x0147,
    /// S2C: Signals that the world has finished loading.
    StartGame = 0x0282,

    // --- Magic & Enchantments ---
    /// S2C: Update an active enchantment.
    MagicUpdateEnchantment = 0x02C2,
    /// S2C: Update multiple active enchantments.
    MagicUpdateMultipleEnchantments = 0x02C4,
    /// S2C: Remove an active enchantment.
    MagicRemoveEnchantment = 0x02C3,
    /// S2C: Remove multiple active enchantments.
    MagicRemoveMultipleEnchantments = 0x02C5,
    /// S2C: Purge all enchantments.
    MagicPurgeEnchantments = 0x02C6,
    /// S2C: Purge all negative enchantments.
    MagicPurgeBadEnchantments = 0x0312,

    // --- Errors & Feedback ---
    /// S2C: Generic error from the game engine.
    WeenieError = 0x028A,
    /// S2C: Error from the game engine with an extra description.
    WeenieErrorWithString = 0x028B,

    // --- Fellowship ---
    // /// S2C: Complete fellowship update.
    // FellowshipFullUpdate = 0x02BE,
    // /// S2C: Fellowship has been disbanded.
    // FellowshipDisband = 0x02BF,
    // /// S2C: Update for a specific fellowship member.
    // FellowshipUpdateFellow = 0x02C0,

    // --- Vendor & Trade ---
    // /// S2C: Vendor information event / Approach vendor. (Note: ACE uses 0x0062 for both)
    // VendorInfoEvent = 0x0062,

    // --- Interaction & Login (Extra) ---
    // /// S2C: Response to an age query.
    // QueryAgeResponse = 0x01C3,
    // /// S2C: Request from server for character confirmation (e.g. before deletion).
    // CharacterConfirmationRequest = 0x0274,
    // /// S2C: Confirmation that a character management operation is done.
    // CharacterConfirmationDone = 0x0276,
    // /// S2C: Confirms the player has joined the game session.
    // JoinGameResponse = 0x0281,
    /// S2C: Acknowledge that an action (Use) is complete.
    UseDone = 0x01C7,
    /// S2C: Result of an object appraisal (Assess/Identify).
    /// Includes full properties on success, or a failure flag if skill check failed.
    IdentifyObjectResponse = 0x00C9,

    // --- Social & Communication (Extra) ---
    // /// S2C: List of available chat channels.
    // ChannelList = 0x0148,
    // /// S2C: Index of a specific chat channel.
    // ChannelIndex = 0x0149,
    // /// S2C: Displays a modal popup dialog with a message.
    // PopupString = 0x0004,
    // /// S2C: Displays a temporary ticker-like message on the screen.
    // CommunicationTransientString = 0x02EB,
    // /// S2C: Triggers a character emote action.
    // Emote = 0x01E2,
    // /// S2C: Synchronizes the client's squelch (ignore) list.
    // SetSquelchDb = 0x01F4,
    // /// S2C: Configures the Turbine-specific chat channels.
    // SetTurbineChatChannels = 0x0295,

    // --- Allegiance & Social ---
    // /// S2C: Allegiance update operation was aborted.
    // AllegianceUpdateAborted = 0x0003,
    // /// S2C: Update to allegiance data (vassals, patrons).
    // AllegianceUpdate = 0x0020,
    // /// S2C: Full update of the player's friends list.
    // FriendsListUpdate = 0x0021,
    // /// S2C: Detailed information about a character title.
    // CharacterTitle = 0x0029,
    // /// S2C: Update to the current active title.
    // UpdateTitle = 0x002B,
    // /// S2C: Confirms that an allegiance data update is finished.
    // AllegianceAllegianceUpdateDone = 0x01C8,
    // /// S2C: Notifies the player that an allegiance member has logged in.
    // AllegianceLoginNotification = 0x027A,
    // /// S2C: Detailed response to an allegiance information request.
    // AllegianceInfoResponse = 0x027C,

    // --- Inventory & World (Extra) ---
    // /// S2C: Closes the view of a container on the ground.
    // CloseGroundContainer = 0x0052,
    /// S2C: Notification that an inventory save operation failed on the server.
    InventoryServerSaveFailed = 0x00A0,
    // --- Visuals & Identification ---
    // /// S2C: Returns the inscription text for an object.
    // GetInscriptionResponse = 0x00C3,

    // --- Books & Inscriptions ---
    // /// S2C: Response containing the metadata and content of a book.
    // BookDataResponse = 0x00B4,
    // /// S2C: Result of a book page modification.
    // BookModifyPageResponse = 0x00B5,
    // /// S2C: Result of adding a new page to a book.
    // BookAddPageResponse = 0x00B6,
    // /// S2C: Result of deleting a page from a book.
    // BookDeletePageResponse = 0x00B7,
    // /// S2C: Returns specific page data for a book.
    // BookPageDataResponse = 0x00B8,
    // /// S2C: Result of a salvaging operation.
    // SalvageOperationsResult = 0x02B4,

    // --- Combat & Stats ---
    // /// S2C: Notification that the current attack sequence is finished.
    // AttackDone = 0x01A7,
    // /// S2C: Notifies the attacker about the result of their attack.
    // AttackerNotification = 0x01B1,
    // /// S2C: Notifies the defender that they were attacked.
    // DefenderNotification = 0x01B2,
    // /// S2C: Notifies the attacker that the target evaded.
    // EvasionAttackerNotification = 0x01B3,
    // /// S2C: Notifies the defender that they successfully evaded an attack.
    // EvasionDefenderNotification = 0x01B4,
    // /// S2C: Signals the start of an attack sequence.
    // CombatCommenceAttack = 0x01B8,
    // /// S2C: Updates the health (Stamina) of an object.
    // UpdateHealth = 0x01C0,
    // /// S2C: Sent to the victim when they die.
    // VictimNotification = 0x01AC,
    // /// S2C: Sent to the killer when they defeat a target.
    // KillerNotification = 0x01AD,

    // --- Magic & Enchantments (Extra) ---
    // /// S2C: Removes a spell from the player's spellbook.
    // MagicRemoveSpell = 0x01A8,
    // /// S2C: Adds or updates a spell in the player's spellbook.
    // MagicUpdateSpell = 0x02C1,
    // /// S2C: Dispels a specific active enchantment.
    // MagicDispelEnchantment = 0x02C7,
    // /// S2C: Dispels multiple active enchantments.
    // MagicDispelMultipleEnchantments = 0x02C8,
    // /// S2C: Response to an item mana query.
    // QueryItemManaResponse = 0x0264,
    // /// S2C: Alerts the client that a portal storm is starting to form due to crowding.
    // MiscPortalStormBrewing = 0x02C9,
    // /// S2C: Alerts that a portal storm is about to trigger.
    // MiscPortalStormImminent = 0x02CA,
    // /// S2C: Notification that a portal storm has occurred (teleporting players).
    // MiscPortalStorm = 0x02CB,
    // /// S2C: Notification that the portal storm has ended.
    // MiscPortalstormSubsided = 0x02CC,

    // --- Trade ---
    // /// S2C: Registers a new trade session between two players.
    // RegisterTrade = 0x01FD,
    // /// S2C: Opens the trade window on the client.
    // OpenTrade = 0x01FE,
    // /// S2C: Closes the trade window.
    // CloseTrade = 0x01FF,
    // /// S2C: Detailed status update for an ongoing trade session.
    // TradeUpdate = 0x01FA,
    // /// S2C: Notifies that an item was added to the trade offer.
    // AddToTrade = 0x0200,
    // /// S2C: Notifies that an item was removed from the trade offer.
    // RemoveFromTrade = 0x0201,
    // /// S2C: Notifies that the other player has accepted the current trade.
    // AcceptTrade = 0x0202,
    // /// S2C: Notifies that the other player has declined the trade.
    // DeclineTrade = 0x0203,
    // /// S2C: Resets the trade agreement state.
    // ResetTrade = 0x0205,
    // /// S2C: Notification that the trade operation failed.
    // TradeFailure = 0x0207,
    // /// S2C: Clears the trade acceptance flag.
    // ClearTradeAcceptance = 0x0208,

    // --- Housing ---
    // /// S2C: Returns detailed profile and description of a house.
    // HouseProfile = 0x021D,
    // /// S2C: Detailed data for a specific house.
    // HouseData = 0x0225,
    // /// S2C: Updates the ownership and status of a house.
    // HouseStatus = 0x0226,
    // /// S2C: Updates the remaining rent time for a property.
    // UpdateRentTime = 0x0227,
    // /// S2C: Confirms a rent payment was processed.
    // UpdateRentPayment = 0x0228,
    // /// S2C: Updates the guest and banning restrictions for a house.
    // HouseUpdateRestrictions = 0x0248,
    // /// S2C: Updates House Accessibility Rules (HAR) such as guest lists.
    // UpdateHar = 0x0257,
    // /// S2C: Response containing extended data for a house.
    // HouseDataResponse = 0x022F,
    // /// S2C: Notification of a house-related transaction (purchase/sale).
    // HouseTransaction = 0x0259,
    // /// S2C: Returns a list of currently available houses for purchase.
    // AvailableHouses = 0x0271,

    // --- Fellowship (Extra) ---
    // /// S2C: Notifies that a member has quit the fellowship.
    // FellowshipQuit = 0x00A3,
    // /// S2C: Notifies that a member was dismissed from the fellowship.
    // FellowshipDismiss = 0x00A4,
    // /// S2C: Confirms that a fellow's data update is complete.
    // FellowshipFellowUpdateDone = 0x01C9,
    // /// S2C: Confirms that a fellow's statistics update is complete.
    // FellowshipFellowStatsDone = 0x01CA,
    // // (Already present: FellowshipFullUpdate, Disband, UpdateFellow)

    // --- Minigames (Chess) ---
    // /// S2C: Response to a movement or teleport request.
    // MoveResponse = 0x0283,
    // /// S2C: (Internal/Minigame) Signals that it is the opponent's turn.
    // OpponentTurn = 0x0284,
    // /// S2C: (Internal/Minigame) Signals a stalemate condition.
    // OpponentStalemate = 0x0285,
    // /// S2C: (Internal/Minigame) Signals that the game session has ended.
    // GameOver = 0x028C,

    // --- Admin & Plugins ---
    // /// S2C: Admin-only query for the server's plugin list.
    // AdminQueryPluginList = 0x02AE,
    // /// S2C: Admin-only query for a specific plugin's status.
    // AdminQueryPlugin = 0x02B1,
    // /// S2C: Admin-only response to a plugin query.
    // AdminQueryPluginResponse = 0x02B3,

    // --- Contract Tracker ---
    // /// S2C: Sends the full contract tracker table defined by the server.
    // SendClientContractTrackerTable = 0x0314,
    // /// S2C: Updates specific contract tracker progress data.
    // SendClientContractTracker = 0x0315,

    // --- Miscellaneous ---
    // /// S2C: Opens the character barber (customization) UI.
    // StartBarber = 0x0075,

    // --- Unused ---
    // /// This is a "ghost" opcode—defined in headers but not implemented or used in ACE.
    // ItemAppraiseDone = 0x01CB,
}
