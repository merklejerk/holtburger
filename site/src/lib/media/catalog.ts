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
		kind: 'planned-image',
		title: 'Selected-entity actions',
		brief:
			'Show a tight crop of the selected name, health bar, magnifying glass and open actions menu.'
	},
	'chat-completion': {
		kind: 'planned-video',
		title: 'Find a command as you type',
		brief:
			'Type a partial command, browse suggestions and accept one. Keep the input and suggestion list in frame.'
	},
	'chat-links': {
		kind: 'planned-image',
		title: 'A message becomes a destination or target',
		brief:
			'Show coordinate and entity-alert links in the chat buffer with history interaction enabled.'
	},
	'nearby-list': {
		kind: 'planned-image',
		title: 'Find something nearby',
		brief: 'Show the Nearby name search, useful filters and matching results.'
	},
	'treestats-import': {
		kind: 'planned-image',
		title: 'Choose a public server',
		brief:
			'Show the TreeStats search results, server software and import action.'
	},
	'profile-content': {
		kind: 'planned-image',
		title: 'Save a DAT folder with a profile',
		brief:
			'Show the profile’s content-folder control and the action that saves the change.'
	},
	'crafting-confirmation': {
		kind: 'planned-image',
		title: 'Review a crafting attempt',
		brief:
			'Show the target, success chance and confirmation for a crafting attempt.'
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
		kind: 'planned-video',
		title: 'Find a spell and bind it',
		brief:
			'Search and filter the spellbook, then drag a spell into an action bar.'
	},
	hud: {
		kind: 'planned-image',
		title: 'Make room for your HUD',
		brief:
			'Show rearranged panels and the difference between UI scaling and text scaling.'
	},
	launcher: {
		kind: 'planned-image',
		title: 'Add your server',
		brief:
			'Show the launcher server entry and Play action using sample connection details.'
	},
	'content-picker': {
		kind: 'planned-image',
		title: 'Choose your game data',
		brief:
			'Show the first-launch folder picker with a complete retail DAT folder selected.'
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
		kind: 'planned-image',
		title: 'Review a mixed salvage batch',
		brief:
			'Show two materials, their estimated outputs, and one queued stack with its full quantity.'
	},
	vendor: {
		kind: 'planned-video',
		title: 'Buy and sell',
		brief:
			'Queue a purchase and a sale, adjust quantities, review balances, and show the completed trade.'
	},
	'player-trade': {
		kind: 'planned-image',
		title: 'Review both offers',
		brief:
			'Show both trade offers, acceptance status, and the withdraw/reset controls using sample participants.'
	},
	'character-progression': {
		kind: 'planned-image',
		title: 'Plan a skill improvement',
		brief:
			'Show a skill detail and its cost, plus the separate confirmation for training a new skill.'
	},
	waypoints: {
		kind: 'planned-video',
		title: 'Mark the next stop',
		brief:
			'Set a waypoint from chat coordinates, then follow its direction and distance on the minimap.'
	},
	'housing-payments': {
		kind: 'planned-image',
		title: 'Prepare a house payment',
		brief:
			'Show a house crystal requirement, carried payment items, Auto-fill and the prepared amounts.'
	},
	'housing-access': {
		kind: 'planned-image',
		title: 'Separate entry from storage',
		brief:
			'Show guest entry and storage permissions with sample names and the current house owner.'
	},
	journal: {
		kind: 'planned-image',
		title: 'Track a contract',
		brief:
			'Show a filtered contract with progress, repeat or deadline timer, and its map destination.'
	},
	'corpse-recovery': {
		kind: 'planned-video',
		title: 'Find your way back',
		brief:
			'Show a real outdoor death location, /corpse output, a coordinate link becoming a waypoint, and nearby corpse cycling.'
	},
	party: {
		kind: 'planned-image',
		title: 'Keep the party in view',
		brief:
			'Show the party roster and in-world party HUD, including leader and recruitment controls.'
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
		kind: 'planned-image',
		title: 'A change of appearance',
		brief:
			'Show the Barbershop appearance controls, heritage-specific choices and Apply/Cancel actions.'
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
		kind: 'planned-image',
		title: 'Inspect an item',
		brief:
			'Show item requirements and effective values in a readable appraisal window.'
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
		kind: 'planned-image',
		title: 'Graphics troubleshooting',
		brief: 'Show the launcher graphics settings and Copy hardware info action.'
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
