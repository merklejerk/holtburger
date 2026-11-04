import { asset } from '$app/paths';

/** Available media and planned captures share stable IDs across tours and guides. */
export type MediaAsset =
	| {
			kind: 'image';
			title: string;
			src: string;
			alt: string;
			width: number;
			height: number;
	  }
	| { kind: 'youtube'; title: string; videoId: string }
	| { kind: 'planned-image' | 'planned-video'; title: string; brief: string };

const media = {
	holtburg: {
		kind: 'image',
		title: 'An afternoon in Holtburg',
		src: asset('assets/screenshots/3d-holtburg.webp'),
		alt: 'Holtburg with nearby players, character appraisal and the world map.',
		width: 1740,
		height: 1189
	},
	outdoors: {
		kind: 'image',
		title: 'Out in Dereth',
		src: asset('assets/screenshots/3d-outdoors.webp'),
		alt: 'Outdoor gameplay with a selected creature and inventory open.',
		width: 1740,
		height: 1174
	},
	map: {
		kind: 'image',
		title: 'Getting your bearings',
		src: asset('assets/screenshots/3d-world-map.webp'),
		alt: 'A 3D landscape with character details and the world map.',
		width: 1740,
		height: 1186
	},
	combat: {
		kind: 'image',
		title: 'Into the dungeon',
		src: asset('assets/screenshots/3d-combat.webp'),
		alt: 'Dungeon combat with spell effects and character skills.',
		width: 1740,
		height: 1189
	},
	jump: {
		kind: 'image',
		title: 'Plan the leap',
		src: asset('assets/screenshots/3d-precise-jump.webp'),
		alt: 'Precise jump aiming with a trajectory preview between forest platforms.',
		width: 1740,
		height: 1189
	},
	characters: {
		kind: 'image',
		title: 'Choose your adventurer',
		src: asset('assets/screenshots/3d-character-selection.webp'),
		alt: 'The 3D character selection screen.',
		width: 1740,
		height: 1189
	},
	terminal: {
		kind: 'image',
		title: 'Dereth in a terminal',
		src: asset('assets/screenshots/tui.webp'),
		alt: 'Terminal gameplay with nearby creatures, item appraisal and combat feedback.',
		width: 1055,
		height: 818
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
	postures: {
		kind: 'planned-video',
		title: 'The N posture cycle',
		brief:
			'Cycle resting crouch/kneel → sit → lie down → stand, with the key press visible.'
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
	'input-settings': {
		kind: 'planned-image',
		title: 'Rebind the familiar actions',
		brief:
			'Show Settings → Input with movement, selection and interaction bindings in view.'
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
