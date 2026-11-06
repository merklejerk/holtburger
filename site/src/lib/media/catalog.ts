import type { asset } from '$app/paths';

/** Local assets resolve during rendering; remote media retains its published URL. */
type ImageSource =
	| { kind: 'local'; path: Parameters<typeof asset>[0] }
	| { kind: 'remote'; url: string };

/** Available media and planned captures share stable IDs across tours and guides. */
export type MediaAsset = { title: string } & (
	| {
			kind: 'image';
			source: ImageSource;
			alt: string;
			width: number;
			height: number;
	  }
	| {
			kind: 'video';
			src: string;
			poster: string;
			width: number;
			height: number;
			/** Required for instructional audio; null for a silent demonstration. */
			captions: { src: string; language: string; label: string } | null;
	  }
	| { kind: 'youtube'; videoId: string }
	| { kind: 'planned-image'; brief: string }
	| { kind: 'planned-video'; brief: string }
);

export const media = {
	holtburg: {
		kind: 'image',
		title: 'An afternoon in Holtburg',
		source: {
			kind: 'local',
			path: 'assets/screenshots/3d-holtburg.webp'
		},
		alt: 'Holtburg with nearby players, character appraisal and the world map.',
		width: 1740,
		height: 1189
	},
	outdoors: {
		kind: 'image',
		title: 'Out in Dereth',
		source: {
			kind: 'local',
			path: 'assets/screenshots/3d-outdoors.webp'
		},
		alt: 'Outdoor gameplay with a selected creature and inventory open.',
		width: 1740,
		height: 1174
	},
	map: {
		kind: 'image',
		title: 'Getting your bearings',
		source: {
			kind: 'local',
			path: 'assets/screenshots/3d-world-map.webp'
		},
		alt: 'A 3D landscape with character details and the world map.',
		width: 1740,
		height: 1186
	},
	combat: {
		kind: 'image',
		title: 'Into the dungeon',
		source: {
			kind: 'local',
			path: 'assets/screenshots/3d-combat.webp'
		},
		alt: 'Dungeon combat with spell effects and character skills.',
		width: 1740,
		height: 1189
	},
	jump: {
		kind: 'image',
		title: 'Plan the leap',
		source: {
			kind: 'local',
			path: 'assets/screenshots/3d-precise-jump.webp'
		},
		alt: 'Precise jump aiming with a trajectory preview between forest platforms.',
		width: 1740,
		height: 1189
	},
	characters: {
		kind: 'image',
		title: 'Choose your adventurer',
		source: {
			kind: 'local',
			path: 'assets/screenshots/3d-character-selection.webp'
		},
		alt: 'The 3D character selection screen.',
		width: 1740,
		height: 1189
	},
	terminal: {
		kind: 'image',
		title: 'Dereth in a terminal',
		source: {
			kind: 'local',
			path: 'assets/screenshots/tui.webp'
		},
		alt: 'Terminal gameplay with nearby creatures, item appraisal and combat feedback.',
		width: 1055,
		height: 818
	},
	'selection-outline': {
		kind: 'image',
		title: 'Keep your selection in sight',
		source: {
			kind: 'remote',
			url: 'https://merklejerk.github.io/holtburger-media/3d/selection-outline-v1.webp'
		},
		alt: 'Selected Unconquered Drudge outlined through an obstructing tree trunk.',
		width: 534,
		height: 490
	},
	'combat-reticle': {
		kind: 'image',
		title: 'Your active combat target',
		source: {
			kind: 'remote',
			url: 'https://merklejerk.github.io/holtburger-media/3d/combat-reticle-v1.webp'
		},
		alt: 'Combat target marked by a four-point reticle during a spell cast.',
		width: 367,
		height: 342
	},
	minimap: {
		kind: 'image',
		title: 'Terrain under your radar',
		source: {
			kind: 'remote',
			url: 'https://merklejerk.github.io/holtburger-media/3d/minimap-v1.webp'
		},
		alt: 'Outdoor minimap showing terrain, elevation contours, impassable areas and nearby radar markers.',
		width: 244,
		height: 254
	},
	'selected-hud': {
		kind: 'image',
		title: 'Selected-entity actions',
		source: {
			kind: 'remote',
			url: 'https://merklejerk.github.io/holtburger-media/3d/selected-hud-v1.webp'
		},
		alt: 'Selected player HUD with character details and social and trade actions.',
		width: 351,
		height: 246
	},
	'chat-completion': {
		kind: 'video',
		title: 'Find a command as you type',
		src: 'https://merklejerk.github.io/holtburger-media/3d/chat-completion-v2.mp4',
		poster:
			'https://merklejerk.github.io/holtburger-media/3d/chat-completion-poster-v2.webp',
		width: 424,
		height: 182,
		captions: null
	},
	'chat-links': {
		kind: 'image',
		title: 'A message becomes a destination or target',
		source: {
			kind: 'remote',
			url: 'https://merklejerk.github.io/holtburger-media/3d/chat-links-v1.webp'
		},
		alt: 'Clickable coordinates and an entity name in chat.',
		width: 400,
		height: 32
	},
	'nearby-button': {
		kind: 'image',
		title: 'Open Nearby',
		source: {
			kind: 'remote',
			url: 'https://merklejerk.github.io/holtburger-media/3d/nearby-button-v1.webp'
		},
		alt: 'Nearby entities and alerts button on the lower-left rim of the minimap.',
		width: 94,
		height: 90
	},

	'nearby-list': {
		kind: 'image',
		title: 'Find something nearby',
		source: {
			kind: 'remote',
			url: 'https://merklejerk.github.io/holtburger-media/3d/nearby-list-v2.webp'
		},
		alt: 'Nearby window with Entities, Tracked and Alerts tabs, name search, category filters, distance sorting and entity results.',
		width: 322,
		height: 569
	},
	'treestats-import': {
		kind: 'image',
		title: 'Choose a public server',
		source: {
			kind: 'remote',
			url: 'https://merklejerk.github.io/holtburger-media/3d/treestats-import-v1.webp'
		},
		alt: 'TreeStats server search with an expanded public server entry.',
		width: 560,
		height: 445
	},
	'profile-content': {
		kind: 'image',
		title: 'Set a server’s DAT folder',
		source: {
			kind: 'remote',
			url: 'https://merklejerk.github.io/holtburger-media/3d/server-content-v1.webp'
		},
		alt: 'Server editor with Advanced expanded, Content path override set to Use application default, a browse button and Save.',
		width: 347,
		height: 397
	},
	'crafting-confirmation': {
		kind: 'image',
		title: 'Review a crafting attempt',
		source: {
			kind: 'remote',
			url: 'https://merklejerk.github.io/holtburger-media/3d/crafting-confirmation-v1.webp'
		},
		alt: 'Flour and Water crafting confirmation showing a 100 percent success chance.',
		width: 420,
		height: 122
	},
	'world-map-controls': {
		kind: 'image',
		title: 'Read the world map',
		source: {
			kind: 'remote',
			url: 'https://merklejerk.github.io/holtburger-media/3d/world-map-controls-v1.webp'
		},
		alt: 'World map with navigation, search and waypoint controls.',
		width: 587,
		height: 587
	},
	'character-roster': {
		kind: 'image',
		title: 'Choose a character',
		source: {
			kind: 'remote',
			url: 'https://merklejerk.github.io/holtburger-media/3d/character-roster-v2.webp'
		},
		alt: 'Full character-selection screen with the roster, selected character’s equipped 3D preview, and Enter World and Create character controls.',
		width: 1279,
		height: 848
	},
	'smart-tab': {
		kind: 'video',
		title: 'Smart Tab in action',
		src: 'https://merklejerk.github.io/holtburger-media/3d/smart-tab-v1.mp4',
		poster:
			'https://merklejerk.github.io/holtburger-media/3d/smart-tab-poster-v1.webp',
		width: 714,
		height: 752,
		captions: null
	},
	'jump-demo': {
		kind: 'video',
		title: 'From preview to landing',
		src: 'https://merklejerk.github.io/holtburger-media/3d/precise-jump-v1.mp4',
		poster:
			'https://merklejerk.github.io/holtburger-media/3d/precise-jump-poster-v1.webp',
		width: 718,
		height: 552,
		captions: null
	},
	camera: {
		kind: 'video',
		title: 'Camera and mouse steering',
		src: 'https://merklejerk.github.io/holtburger-media/3d/camera-v1.mp4',
		poster:
			'https://merklejerk.github.io/holtburger-media/3d/camera-poster-v1.webp',
		width: 648,
		height: 606,
		captions: null
	},
	loadouts: {
		kind: 'video',
		title: 'Equipment loadouts',
		src: 'https://merklejerk.github.io/holtburger-media/3d/loadouts-v1.mp4',
		poster:
			'https://merklejerk.github.io/holtburger-media/3d/loadouts-poster-v1.webp',
		width: 378,
		height: 506,
		captions: null
	},
	'chat-overview': {
		kind: 'image',
		title: 'Chat history and controls',
		source: {
			kind: 'remote',
			url: 'https://merklejerk.github.io/holtburger-media/3d/chat-overview-v1.webp'
		},
		alt: 'Chat panel with message history, the interaction toggle, Chat and Combat filters, timestamp control and Say message composer.',
		width: 435,
		height: 426
	},

	'inventory-currencies': {
		kind: 'image',
		title: 'Alternate currency totals',
		source: {
			kind: 'remote',
			url: 'https://merklejerk.github.io/holtburger-media/3d/inventory-currencies-v1.webp'
		},
		alt: 'Inventory currency popup totaling Ancient Mhoire Coins, Small Olthoi Venom Sacs and trade notes.',
		width: 348,
		height: 251
	},

	'action-bar-intro': {
		kind: 'image',
		title: 'Item shortcuts with alternate actions',
		source: {
			kind: 'remote',
			url: 'https://merklejerk.github.io/holtburger-media/3d/action-bar-intro-v1.webp'
		},
		alt: 'Action bar with an Eternal Mana Charge tooltip showing its shortcut and Shift-click alternate action to use it on the selected target.',
		width: 437,
		height: 123
	},

	'spell-bar': {
		kind: 'image',
		title: 'Your spell shortcuts',
		source: {
			kind: 'remote',
			url: 'https://merklejerk.github.io/holtburger-media/3d/spell-bar-v1.webp'
		},
		alt: 'Spell bar with tab selectors above numbered shortcut cells and their key hints.',
		width: 436,
		height: 95
	},

	'spell-list': {
		kind: 'image',
		title: 'Find a spell or cast from the list',
		source: {
			kind: 'remote',
			url: 'https://merklejerk.github.io/holtburger-media/3d/spell-list-v1.webp'
		},
		alt: 'Spells tab with search and filters expanded, a Shock Wave spell’s details and Cast buttons beside the spell list.',
		width: 364,
		height: 728
	},

	spells: {
		kind: 'video',
		title: 'Find a spell and bind it',
		src: 'https://merklejerk.github.io/holtburger-media/3d/spells-v3.mp4',
		poster:
			'https://merklejerk.github.io/holtburger-media/3d/spells-poster-v3.webp',
		width: 500,
		height: 700,
		captions: null
	},
	'hud-showcase': {
		kind: 'image',
		title: 'Your HUD at a glance',
		source: {
			kind: 'remote',
			url: 'https://merklejerk.github.io/holtburger-media/3d/hud-showcase-v1.webp'
		},
		alt: 'Holtburger in Holtburg, showing player vitals and party members on the left, selected entity at the top, minimap and waypoint on the right, jump power in the center, and chat and shortcut bars below.',
		width: 1291,
		height: 850
	},

	hud: {
		kind: 'image',
		title: 'Make room for your HUD',
		source: {
			kind: 'remote',
			url: 'https://merklejerk.github.io/holtburger-media/3d/hud-v1.webp'
		},
		alt: 'Unlocked minimap with move and resize handles.',
		width: 215,
		height: 214
	},
	launcher: {
		kind: 'image',
		title: 'Choose your world',
		source: {
			kind: 'remote',
			url: 'https://merklejerk.github.io/holtburger-media/3d/launcher-v2.webp'
		},
		alt: 'Launcher with a selected server and profile, account field, masked password and Play button.',
		width: 1024,
		height: 640
	},
	'content-picker': {
		kind: 'image',
		title: 'Choose your game data',
		source: {
			kind: 'remote',
			url: 'https://merklejerk.github.io/holtburger-media/3d/content-picker-v1.webp'
		},
		alt: 'Game data folder field with Browse and Use application default controls.',
		width: 378,
		height: 238
	},
	'tui-workflow': {
		kind: 'planned-image',
		title: 'The TUI at a glance',
		brief: 'Keep pane boundaries, focus and footer shortcuts legible.'
	},
	'tui-script': {
		kind: 'planned-video',
		title: 'Run a bundled script',
		brief:
			'Start a fighter or mage, show its feedback, then stop it and resume manual control.'
	},
	'combat-controls': {
		kind: 'image',
		title: 'Melee combat HUD',
		source: {
			kind: 'remote',
			url: 'https://merklejerk.github.io/holtburger-media/3d/combat-controls-v1.webp'
		},
		alt: 'Melee HUD with the power arc, three attack-height choices, shortcut hints and Cancel attack control.',
		width: 347,
		height: 239
	},
	locks: {
		kind: 'video',
		title: 'Open a locked container',
		src: 'https://merklejerk.github.io/holtburger-media/3d/locks-v2.mp4',
		poster:
			'https://merklejerk.github.io/holtburger-media/3d/locks-poster-v2.webp',
		width: 380,
		height: 400,
		captions: null
	},
	salvage: {
		kind: 'image',
		title: 'Review a mixed salvage batch',
		source: {
			kind: 'remote',
			url: 'https://merklejerk.github.io/holtburger-media/3d/salvage-v1.webp'
		},
		alt: 'Salvage review listing items and estimated Steel and Sapphire output.',
		width: 341,
		height: 395
	},
	vendor: {
		kind: 'image',
		title: 'Review a vendor exchange',
		source: {
			kind: 'remote',
			url: 'https://merklejerk.github.io/holtburger-media/3d/vendor-v1.webp'
		},
		alt: 'Vendor review with a Leather Basinet purchase, Leather Cap sale and projected balance.',
		width: 362,
		height: 382
	},
	'player-trade': {
		kind: 'image',
		title: 'Review both offers',
		source: {
			kind: 'remote',
			url: 'https://merklejerk.github.io/holtburger-media/3d/player-trade-v1.webp'
		},
		alt: 'Player trade window showing Bread and Cup offers on opposite sides.',
		width: 413,
		height: 314
	},
	'character-title': {
		kind: 'image',
		title: 'Choose your title',
		source: {
			kind: 'remote',
			url: 'https://merklejerk.github.io/holtburger-media/3d/character-title-v1.webp'
		},
		alt: 'Character progression panel with the earned-title dropdown expanded.',
		width: 456,
		height: 312
	},

	'character-progression': {
		kind: 'image',
		title: 'Improve a stat',
		source: {
			kind: 'remote',
			url: 'https://merklejerk.github.io/holtburger-media/3d/character-progression-v2.webp'
		},
		alt: 'Progression tab with Focus expanded, showing improvement buttons, XP cost, skill contributions, starting value and spell bonus.',
		width: 366,
		height: 736
	},
	'recall-menu': {
		kind: 'image',
		title: 'Recall destinations',
		source: {
			kind: 'remote',
			url: 'https://merklejerk.github.io/holtburger-media/3d/recall-menu-v1.webp'
		},
		alt: 'World map recall menu listing Lifestone, Marketplace, House, Allegiance Housing and Allegiance Hometown.',
		width: 244,
		height: 243
	},

	waypoints: {
		kind: 'image',
		title: 'Your destination on the map',
		source: {
			kind: 'remote',
			url: 'https://merklejerk.github.io/holtburger-media/3d/waypoints-v1.webp'
		},
		alt: 'World map close-up with a destination pin and the player’s position arrow.',
		width: 134,
		height: 141
	},
	'housing-map': {
		kind: 'image',
		title: 'Search for housing on the map',
		source: {
			kind: 'remote',
			url: 'https://merklejerk.github.io/holtburger-media/3d/housing-map-v1.webp'
		},
		alt: 'World map with housing search results marked by house icons across Dereth.',
		width: 585,
		height: 673
	},

	'housing-payments': {
		kind: 'image',
		title: 'Prepare a house payment',
		source: {
			kind: 'remote',
			url: 'https://merklejerk.github.io/holtburger-media/3d/housing-payments-v1.webp'
		},
		alt: 'Cottage purchase requirements filled with pyreals, a Writ of Refuge and an Iron Heart.',
		width: 413,
		height: 486
	},
	'housing-management': {
		kind: 'image',
		title: 'Manage your house',
		source: {
			kind: 'remote',
			url: 'https://merklejerk.github.io/holtburger-media/3d/housing-management-v1.webp'
		},
		alt: 'Housing tab showing home location, maintenance payments, property details, access and guests, decorations and advanced controls.',
		width: 402,
		height: 729
	},
	journal: {
		kind: 'image',
		title: 'Track a contract',
		source: {
			kind: 'remote',
			url: 'https://merklejerk.github.io/holtburger-media/3d/journal-v1.webp'
		},
		alt: 'Expanded Find the Barkeeper contract with its status and contact details.',
		width: 450,
		height: 432
	},
	'corpse-recovery': {
		kind: 'image',
		title: 'Find your way back',
		source: {
			kind: 'remote',
			url: 'https://merklejerk.github.io/holtburger-media/3d/corpse-recovery-v1.webp'
		},
		alt: 'Chat output showing the last outdoor death location as clickable coordinates.',
		width: 424,
		height: 53
	},
	allegiance: {
		kind: 'image',
		title: 'Your allegiance',
		source: {
			kind: 'remote',
			url: 'https://merklejerk.github.io/holtburger-media/3d/allegiance-v1.webp'
		},
		alt: 'Allegiance tab showing membership totals, patron and vassal relationships, contributed experience and presence settings.',
		width: 336,
		height: 561
	},

	'party-hud': {
		kind: 'image',
		title: 'Party vitals at a glance',
		source: {
			kind: 'remote',
			url: 'https://merklejerk.github.io/holtburger-media/3d/party-hud-v1.webp'
		},
		alt: 'Compact party HUD showing eight teammates with health, stamina and mana bars in two columns.',
		width: 238,
		height: 263
	},

	party: {
		kind: 'image',
		title: 'Keep the party in view',
		source: {
			kind: 'remote',
			url: 'https://merklejerk.github.io/holtburger-media/3d/party-v1.webp'
		},
		alt: 'A two-member party with recruitment and experience-sharing controls.',
		width: 414,
		height: 432
	},
	chat: {
		kind: 'image',
		title: 'Activate chat history',
		source: {
			kind: 'remote',
			url: 'https://merklejerk.github.io/holtburger-media/3d/chat-v1.webp'
		},
		alt: 'The Interact with chat history icon button.',
		width: 40,
		height: 40
	},
	emotes: {
		kind: 'image',
		title: 'Choose an emote',
		source: {
			kind: 'remote',
			url: 'https://merklejerk.github.io/holtburger-media/3d/emotes-v1.webp'
		},
		alt: 'Radial emote menu with Greetings, Reactions, Signals, Attitude, Relax and play, and Recent categories.',
		width: 449,
		height: 432
	},
	'appearance-toggles': {
		kind: 'image',
		title: 'Helmet and cloak visibility',
		source: {
			kind: 'remote',
			url: 'https://merklejerk.github.io/holtburger-media/3d/appearance-toggles-v1.webp'
		},
		alt: 'Helmet and cloak visibility buttons beneath the inventory equipment strip.',
		width: 107,
		height: 116
	},

	barber: {
		kind: 'image',
		title: 'A change of appearance',
		source: {
			kind: 'remote',
			url: 'https://merklejerk.github.io/holtburger-media/3d/barber-v1.webp'
		},
		alt: 'Barbershop appearance choices with Apply and Cancel controls.',
		width: 359,
		height: 326
	},
	'tui-gameplay': {
		kind: 'planned-image',
		title: 'A TUI quantity prompt',
		brief: 'Show the prompt with relevant item and footer actions.'
	},
	'creature-appraisal': {
		kind: 'image',
		title: 'A closer look',
		source: {
			kind: 'remote',
			url: 'https://merklejerk.github.io/holtburger-media/3d/creature-appraisal-v1.webp'
		},
		alt: 'Player appraisal with a 3D character model, identity and vitals.',
		width: 378,
		height: 458
	},
	'item-appraisal': {
		kind: 'image',
		title: 'Inspect an item',
		source: {
			kind: 'remote',
			url: 'https://merklejerk.github.io/holtburger-media/3d/item-appraisal-v1.webp'
		},
		alt: 'Item appraisal with requirements, combat values and enchantments.',
		width: 379,
		height: 587
	},
	'inventory-overview': {
		kind: 'video',
		title: 'All your packs in one view',
		src: 'https://merklejerk.github.io/holtburger-media/3d/inventory-overview-v3.mp4',
		poster:
			'https://merklejerk.github.io/holtburger-media/3d/inventory-overview-poster-v3.webp',
		width: 378,
		height: 338,
		captions: null
	},
	'equipment-strip': {
		kind: 'image',
		title: 'The equipment strip',
		source: {
			kind: 'remote',
			url: 'https://merklejerk.github.io/holtburger-media/3d/equipment-strip-v4.webp'
		},
		alt: 'Equipment strip with worn slots, scroll controls and helmet, cloak and loadout buttons.',
		width: 77,
		height: 283
	},
	'inventory-merge': {
		kind: 'image',
		title: 'Auto-merge a bag',
		source: {
			kind: 'remote',
			url: 'https://merklejerk.github.io/holtburger-media/3d/inventory-merge-v1.webp'
		},
		alt: 'Main Pack context menu offering Auto-merge.',
		width: 164,
		height: 75
	},
	'action-bars': {
		kind: 'image',
		title: 'Action-bar menu',
		source: {
			kind: 'remote',
			url: 'https://merklejerk.github.io/holtburger-media/3d/action-bars-v1.webp'
		},
		alt: 'Action bar with Clear, Cycle, Clone and Delete in its expanded menu.',
		width: 244,
		height: 227
	},
	'character-creation': {
		kind: 'image',
		title: 'Race',
		source: {
			kind: 'remote',
			url: 'https://merklejerk.github.io/holtburger-media/3d/character-creation-v1.webp'
		},
		alt: 'Character builder Race page with heritage choices and the character preview.',
		width: 1342,
		height: 646
	},
	'hardware-info': {
		kind: 'image',
		title: 'Graphics troubleshooting',
		source: {
			kind: 'remote',
			url: 'https://merklejerk.github.io/holtburger-media/3d/hardware-info-v1.webp'
		},
		alt: 'Graphics settings showing current graphics information and Copy hardware info.',
		width: 418,
		height: 421
	},
	'inventory-split': {
		kind: 'image',
		title: 'Split a stack',
		source: {
			kind: 'remote',
			url: 'https://merklejerk.github.io/holtburger-media/3d/inventory-split-v1.webp'
		},
		alt: 'Split Bread dialog with quantity, slider and confirmation controls.',
		width: 248,
		height: 159
	},
	'creation-appearance': {
		kind: 'image',
		title: 'Appearance',
		source: {
			kind: 'remote',
			url: 'https://merklejerk.github.io/holtburger-media/3d/creation-appearance-v1.webp'
		},
		alt: 'Character builder Appearance page with the preview, facial features and clothing reroll.',
		width: 1342,
		height: 646
	},
	'creation-build': {
		kind: 'image',
		title: 'Skills & Stats',
		source: {
			kind: 'remote',
			url: 'https://merklejerk.github.io/holtburger-media/3d/creation-build-v1.webp'
		},
		alt: 'Character builder Skills & Stats page showing attributes, starting vitals and skill groups.',
		width: 1342,
		height: 646
	},
	'creation-review': {
		kind: 'image',
		title: 'Review',
		source: {
			kind: 'remote',
			url: 'https://merklejerk.github.io/holtburger-media/3d/creation-review-v1.webp'
		},
		alt: 'Character builder Review page with the final build, starting town and Create character button.',
		width: 1342,
		height: 646
	},
	'combat-controls-missile': {
		kind: 'image',
		title: 'Missile combat HUD',
		source: {
			kind: 'remote',
			url: 'https://merklejerk.github.io/holtburger-media/3d/combat-controls-missile-v1.webp'
		},
		alt: 'Missile HUD with the accuracy arc, attack-height choices, Cancel attack control and ammunition count.',
		width: 347,
		height: 239
	},
	'minimap-dungeon': {
		kind: 'image',
		title: 'Dungeon map and breadcrumbs',
		source: {
			kind: 'remote',
			url: 'https://merklejerk.github.io/holtburger-media/3d/minimap-dungeon-v1.webp'
		},
		alt: 'Dungeon minimap showing rooms, passages, radar markers and a breadcrumb trail, with a lever identified by its tooltip.',
		width: 244,
		height: 254
	},
	'waypoint-minimap': {
		kind: 'image',
		title: 'Follow the waypoint',
		source: {
			kind: 'remote',
			url: 'https://merklejerk.github.io/holtburger-media/3d/waypoint-minimap-v1.webp'
		},
		alt: 'Minimap with a waypoint direction arrow and destination coordinates and distance beneath it.',
		width: 242,
		height: 291
	},
	'run-casting': {
		kind: 'video',
		title: 'Cast on the run',
		src: 'https://merklejerk.github.io/holtburger-media/3d/run-casting-v1.mp4',
		poster:
			'https://merklejerk.github.io/holtburger-media/3d/run-casting-poster-v1.webp',
		width: 660,
		height: 650,
		captions: null
	},
	enchantments: {
		kind: 'image',
		title: 'Your active enchantments',
		source: {
			kind: 'remote',
			url: 'https://merklejerk.github.io/holtburger-media/3d/enchantments-v2.webp'
		},
		alt: 'Enchantments window with loaded spell icons, grouped effects, durations and an expanded armor description.',
		width: 347,
		height: 524
	}
} satisfies Record<string, MediaAsset>;

/** IDs are compile-checked wherever a guide places a capture. */
export type MediaId = keyof typeof media;
export function getMedia(id: MediaId): MediaAsset {
	return media[id];
}
export const galleryImages: MediaId[] = [
	'holtburg',
	'outdoors',
	'combat',
	'jump',
	'map',
	'characters',
	'terminal'
];
export const galleryClips: MediaId[] = [
	'smart-tab',
	'jump-demo',
	'loadouts',
	'tui-script'
];
