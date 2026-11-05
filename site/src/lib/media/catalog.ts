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
		source: { kind: 'local', path: 'assets/screenshots/3d-holtburg.webp' },
		alt: 'Holtburg with nearby players, character appraisal and the world map.',
		width: 1740,
		height: 1189
	},
	outdoors: {
		kind: 'image',
		title: 'Out in Dereth',
		source: { kind: 'local', path: 'assets/screenshots/3d-outdoors.webp' },
		alt: 'Outdoor gameplay with a selected creature and inventory open.',
		width: 1740,
		height: 1174
	},
	map: {
		kind: 'image',
		title: 'Getting your bearings',
		source: { kind: 'local', path: 'assets/screenshots/3d-world-map.webp' },
		alt: 'A 3D landscape with character details and the world map.',
		width: 1740,
		height: 1186
	},
	combat: {
		kind: 'image',
		title: 'Into the dungeon',
		source: { kind: 'local', path: 'assets/screenshots/3d-combat.webp' },
		alt: 'Dungeon combat with spell effects and character skills.',
		width: 1740,
		height: 1189
	},
	jump: {
		kind: 'image',
		title: 'Plan the leap',
		source: { kind: 'local', path: 'assets/screenshots/3d-precise-jump.webp' },
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
		source: { kind: 'local', path: 'assets/screenshots/tui.webp' },
		alt: 'Terminal gameplay with nearby creatures, item appraisal and combat feedback.',
		width: 1055,
		height: 818
	},
	'target-indicators': {
		kind: 'planned-video',
		title: 'Selection and combat at a glance',
		brief:
			'Show selection and combat indicators alongside the selected-entity HUD and its changing player/item actions.'
	},
	'mobile-combat': {
		kind: 'planned-video',
		title: 'Keep moving through the windup',
		brief:
			'Show running while casting, then archery while moving, with normal movement keys visible.'
	},
	minimap: {
		kind: 'planned-video',
		title: 'Read the ground ahead',
		brief:
			'Show outdoor terrain, buildings, impassable areas and elevation, then follow a dungeon passage with the breadcrumb trail visible.'
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
	'nearby-list': {
		kind: 'image',
		title: 'Find something nearby',
		source: {
			kind: 'remote',
			url: 'https://merklejerk.github.io/holtburger-media/3d/nearby-list-v1.webp'
		},
		alt: 'Nearby entities filtered by Guard, with category and alert controls.',
		width: 396,
		height: 431
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
		title: 'Save a DAT folder with a profile',
		source: {
			kind: 'remote',
			url: 'https://merklejerk.github.io/holtburger-media/3d/profile-content-v1.webp'
		},
		alt: 'Profile-specific game data folder and profile save controls.',
		width: 378,
		height: 273
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
	'jump-preview': {
		kind: 'image',
		title: 'Read the jump preview',
		source: {
			kind: 'remote',
			url: 'https://merklejerk.github.io/holtburger-media/3d/jump-preview-v1.webp'
		},
		alt: 'Precise-jump trajectory and landing preview in the 3D world.',
		width: 562,
		height: 544
	},
	'character-roster': {
		kind: 'image',
		title: 'Choose a character',
		source: {
			kind: 'remote',
			url: 'https://merklejerk.github.io/holtburger-media/3d/character-roster-v1.webp'
		},
		alt: 'Character roster with a selected character and Enter World and Create character controls.',
		width: 337,
		height: 449
	},
	'smart-tab': {
		kind: 'planned-video',
		title: 'Smart Tab in action',
		brief:
			'Hold to acquire a target, tap to cycle, then interact or attack. Show selection separately from the action.'
	},
	'jump-demo': {
		kind: 'planned-video',
		title: 'From preview to landing',
		brief:
			'Choose a target and power, inspect the jump trajectory, then execute the leap.'
	},
	camera: {
		kind: 'planned-video',
		title: 'Camera and mouse steering',
		brief:
			'Compare left-drag orbit, right-drag turning, and mouse-button movement.'
	},
	loadouts: {
		kind: 'planned-video',
		title: 'Equipment loadouts',
		brief:
			'Choose which slots a loadout includes, bind it, and show the resulting equipment change.'
	},
	spells: {
		kind: 'video',
		title: 'Find a spell and bind it',
		src: 'https://merklejerk.github.io/holtburger-media/3d/spells-v2.mp4',
		poster:
			'https://merklejerk.github.io/holtburger-media/3d/spells-poster-v2.webp',
		width: 452,
		height: 484,
		captions: null
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
		title: 'Add your server',
		source: {
			kind: 'remote',
			url: 'https://merklejerk.github.io/holtburger-media/3d/launcher-v1.webp'
		},
		alt: 'Launcher with a selected server and profile, account field, masked password and Play button.',
		width: 418,
		height: 444
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
		kind: 'planned-video',
		title: 'Around the terminal dashboard',
		brief:
			'Move between nearby entities, inventory and appraisal; show focus and the available footer actions.'
	},
	'tui-script': {
		kind: 'planned-video',
		title: 'Run a bundled script',
		brief:
			'Start a fighter or mage, show its feedback, then stop it and resume manual control.'
	},
	'combat-controls': {
		kind: 'planned-video',
		title: 'The combat HUD',
		brief:
			'Show the curved power/accuracy arc, height buttons and play/pause control, then use them through a short melee and missile encounter.'
	},
	locks: {
		kind: 'planned-video',
		title: 'Open a locked container',
		brief:
			'Show the key action and lockpick estimate at a real locked chest, with the outcome visible.'
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
		kind: 'planned-video',
		title: 'Buy and sell',
		brief:
			'Queue a purchase and a sale, adjust quantities, review balances, and show the completed trade.'
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
	'character-progression': {
		kind: 'image',
		title: 'Plan a skill improvement',
		source: {
			kind: 'remote',
			url: 'https://merklejerk.github.io/holtburger-media/3d/character-progression-v1.webp'
		},
		alt: 'Character progression panel with an attribute expanded to show its values and advancement controls.',
		width: 450,
		height: 531
	},
	waypoints: {
		kind: 'planned-video',
		title: 'Mark the next stop',
		brief:
			'Set a waypoint from chat coordinates, then follow its direction and distance on the minimap.'
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
	'housing-access': {
		kind: 'image',
		title: 'Separate entry from storage',
		source: {
			kind: 'remote',
			url: 'https://merklejerk.github.io/holtburger-media/3d/housing-access-v1.webp'
		},
		alt: 'House guest permissions with separate entry and storage access controls.',
		width: 565,
		height: 324
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
		kind: 'planned-video',
		title: 'Find your way back',
		brief:
			'Show a real outdoor death location, /corpse output, a coordinate link becoming a waypoint, and nearby corpse cycling.'
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
	'nearby-alerts': {
		kind: 'planned-video',
		title: 'Watch for a name',
		brief:
			'Create an alert using a glob, show its match preview, then show a real matching encounter notification.'
	},
	chat: {
		kind: 'planned-video',
		title: 'From playing to reading chat',
		brief:
			'Show command autocomplete with syntax and descriptions, then temporary history interaction and returning to play.'
	},
	emotes: {
		kind: 'planned-video',
		title: 'Choose an emote',
		brief:
			'Open the T emote wheel, perform an emote, and show the previous combat stance returning.'
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
		kind: 'planned-video',
		title: 'A task through the TUI',
		brief:
			'Move an inventory item, inspect its details, and show a quantity prompt or vendor review with the changing footer actions.'
	},
	'creature-appraisal': {
		kind: 'planned-video',
		title: 'Keep inspecting while targets change',
		brief:
			'Rotate a creature or player preview, then change selection while keeping the appraisal open.'
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
	'inventory-moves': {
		kind: 'planned-video',
		title: 'Pack and equip',
		brief:
			'Use Native sorting to move an item between packs, merge a stack, equip and unequip.'
	},
	'inventory-merge': {
		kind: 'planned-video',
		title: 'Make space in a bag',
		brief:
			'Split a stack with Y, then request bag Auto-merge and show the resulting stack and freed-slot feedback.'
	},
	'action-bars': {
		kind: 'planned-video',
		title: 'Build a useful action bar',
		brief:
			'Bind an item and a loadout, clone and rotate a bar, then focus it and activate a cell by keyboard.'
	},
	'character-creation': {
		kind: 'planned-video',
		title: 'Create an adventurer',
		brief:
			'Show appearance, Skills & Stats, and review; finish at the selected new character before entering the world.'
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
