/** Guide groups stay compact; only the current topic opens by default. */
export const navigation = [
	{
		title: 'Begin your journey',
		scopes: [
			'start',
			'3d',
			'tui',
			'about',
			'support',
			'reference',
			'scripting',
			'coming-from-retail'
		],
		links: [
			{ slug: 'coming-from-retail', label: 'Coming from retail & Decal' },
			{ slug: 'start', label: 'Start playing' },
			{ slug: 'start/content', label: 'Game data' },
			{ slug: 'start/connect', label: 'Connect' },
			{ slug: 'start/characters', label: 'Characters' }
		]
	},
	{
		title: 'Installation',
		scopes: ['start'],
		links: [
			{ slug: 'start/3d/windows', label: '3D · Windows' },
			{ slug: 'start/3d/macos', label: '3D · macOS' },
			{ slug: 'start/3d/linux', label: '3D · Linux' },
			{ slug: 'start/tui/windows', label: 'TUI · Windows' },
			{ slug: 'start/tui/macos', label: 'TUI · macOS' },
			{ slug: 'start/tui/linux', label: 'TUI · Linux' }
		]
	},
	{
		title: 'Movement & interaction',
		scopes: ['3d'],
		links: [
			{ slug: '3d', label: 'The 3D client' },
			{ slug: '3d/selection-interaction', label: 'Selection & interaction' },
			{ slug: '3d/movement-camera', label: 'Movement & camera' },
			{ slug: '3d/jumping', label: 'Jumping' }
		]
	},
	{
		title: 'Items & equipment',
		scopes: ['3d'],
		links: [
			{ slug: '3d/items', label: 'Item actions' },
			{ slug: '3d/inventory', label: 'Inventory & containers' },
			{ slug: '3d/equipment-loadouts', label: 'Equipment loadouts' },
			{ slug: '3d/action-bars', label: 'Action bars' },
			{ slug: '3d/locks', label: 'Keys & lockpicks' },
			{ slug: '3d/salvage', label: 'Salvaging' },
			{ slug: '3d/vendors-trading', label: 'Vendors & trading' }
		]
	},
	{
		title: 'Magic & combat',
		scopes: ['3d'],
		links: [
			{ slug: '3d/spells', label: 'Spells & spell bars' },
			{ slug: '3d/combat', label: 'Combat' },
			{ slug: '3d/enchantments', label: 'Enchantments' },
			{ slug: '3d/character', label: 'Character & progression' }
		]
	},
	{
		title: 'World & social',
		scopes: ['3d'],
		links: [
			{ slug: '3d/maps-travel', label: 'Maps & travel' },
			{ slug: '3d/housing', label: 'Housing' },
			{ slug: '3d/journal', label: 'Journal & contracts' },
			{ slug: '3d/death-corpses', label: 'Corpse recovery' },
			{ slug: '3d/social', label: 'Party & friends' }
		]
	},
	{
		title: 'Interface & chat',
		scopes: ['3d'],
		links: [
			{ slug: '3d/interface', label: 'Arrange the interface' },
			{ slug: '3d/nearby-alerts', label: 'Nearby & alerts' },
			{ slug: '3d/chat-emotes', label: 'Chat & emotes' }
		]
	},
	{
		title: 'Terminal client',
		scopes: ['tui', 'scripting'],
		links: [
			{ slug: 'tui', label: 'The terminal client' },
			{ slug: 'tui/basics', label: 'Find your way around' },
			{ slug: 'tui/gameplay', label: 'Gameplay' },
			{ slug: 'tui/running-scripts', label: 'Run scripts' },
			{ slug: 'tui/bundled-scripts', label: 'Fighter & mage' }
		]
	},
	{
		title: 'Scripting',
		scopes: ['tui', 'scripting'],
		links: [
			{ slug: 'scripting', label: 'Your first script' },
			{ slug: 'scripting/runtime', label: 'Runtime & persistence' },
			{ slug: 'scripting/reference', label: 'API reference' },
			{ slug: 'scripting/integrations', label: 'HTTP integrations' }
		]
	},
	{
		title: '3D reference',
		scopes: ['3d', 'reference'],
		links: [
			{ slug: 'reference/3d-controls', label: 'Controls' },
			{ slug: 'reference/3d-chat-commands', label: '3D chat commands' },
			{ slug: 'reference/3d-settings', label: 'Settings' }
		]
	},
	{
		title: 'TUI reference',
		scopes: ['tui', 'reference'],
		links: [
			{ slug: 'reference/tui-controls', label: 'Controls' },
			{ slug: 'reference/tui-chat-commands', label: 'TUI chat commands' },
			{ slug: 'reference/tui-options', label: 'Launch options' }
		]
	},
	{
		title: 'Help',
		scopes: ['support'],
		links: [
			{ slug: 'support', label: 'Help on the road' },
			{ slug: 'support/graphics', label: 'Graphics & startup' },
			{ slug: 'support/reporting', label: 'Report a problem' }
		]
	},
	{
		title: 'Other paths',
		scopes: [
			'start',
			'3d',
			'tui',
			'about',
			'support',
			'reference',
			'scripting',
			'coming-from-retail',
			'tools'
		],
		links: [
			{ slug: 'gallery', label: 'Gallery' },
			{ slug: 'reference', label: 'Controls & reference' },
			{ slug: 'support', label: 'Help' },
			{ slug: 'about/design', label: 'Design philosophy' },
			{ slug: 'tools', label: 'Explorer & tools' }
		]
	}
];
