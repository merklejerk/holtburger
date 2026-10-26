import { SPELL_BAR_INDICES } from "./client-spell-bar-state";
import { CLIENT_ACTION_BAR_TUNING } from "./client-tuning";
import { COMBAT_GAUGE_SIZE } from "./client-combat-bar-state";
import type { ClientUiDefaults } from "./client-ui-contract";

/**
 * Initial client HUD arrangement, in CSS pixels.
 * Edge offsets point inward; centered offsets are signed (positive right/down).
 * Fitting and user edits live in client-hud-layout; visibility stays in Svelte.
 */
export const CLIENT_UI_DEFAULTS = {
	logopolis: {
		anchor: "center",
		offset: { x: 0, y: 0 },
		size: { width: 560, height: 460 },
		minSize: { width: 320, height: 280 },
	},
	spellBar: {
		anchor: "center",
		offset: { x: 0, y: CLIENT_ACTION_BAR_TUNING.initialCellSize + 96 },
		size: {
			width:
				CLIENT_ACTION_BAR_TUNING.initialCellSize * SPELL_BAR_INDICES.length,
			height: CLIENT_ACTION_BAR_TUNING.initialCellSize + 16,
		},
		minSize: {
			width: CLIENT_ACTION_BAR_TUNING.initialCellSize,
			height: CLIENT_ACTION_BAR_TUNING.initialCellSize + 16,
		},
	},
	combatBar: {
		anchor: "center",
		offset: { x: 0, y: CLIENT_ACTION_BAR_TUNING.initialCellSize + 96 },
		size: COMBAT_GAUGE_SIZE,
		minSize: COMBAT_GAUGE_SIZE,
	},
	character: {
		anchor: "top-left",
		offset: { x: 16, y: 16 },
		size: { width: 340, height: 72 },
		minSize: { width: 250, height: 63 },
		resizable: true,
	},
	partyHud: {
		anchor: "top-left",
		offset: { x: 16, y: 140 },
		// Initial window preference; live minimum dimensions are theme-owned.
		size: { width: 236, height: 312 },
		resizable: true,
	},
	statusTray: {
		anchor: "top-left",
		offset: { x: 16, y: 96 },
		size: { width: 158, height: 32 },
		minSize: { width: 158, height: 32 },
		resizable: false,
	},
	chat: {
		anchor: "bottom-left",
		offset: { x: 16, y: 16 },
		size: { width: 400, height: { viewportMinus: 188, min: 260, max: 450 } },
		minSize: { width: 280, height: 240 },
		resizable: true,
	},
	worldContainer: {
		anchor: "top-left",
		offset: { x: 370, y: 170 },
		size: { width: 370, height: 330 },
		minSize: { width: 240, height: 190 },
	},
	trade: {
		anchor: "top-left",
		offset: { x: 370, y: 170 },
		size: { width: 440, height: 330 },
		minSize: { width: 340, height: 192 },
	},
	salvage: {
		anchor: "top-left",
		offset: { x: 370, y: 170 },
		size: { width: 360, height: 420 },
		minSize: { width: 280, height: 260 },
	},
	vendor: {
		anchor: "top-left",
		offset: { x: 370, y: 170 },
		size: { width: 420, height: 500 },
		minSize: { width: 300, height: 260 },
	},
	houseCrystal: {
		anchor: "top-left",
		offset: { x: 370, y: 170 },
		size: { width: 440, height: 520 },
		minSize: { width: 340, height: 300 },
	},
	inspection: {
		anchor: "center-right",
		offset: { x: 32, y: 0 },
		size: { width: 410, height: 500 },
		minSize: { width: 300, height: 240 },
	},
	book: {
		anchor: "center",
		offset: { x: 0, y: 0 },
		size: { width: 480, height: 560 },
		minSize: { width: 300, height: 240 },
	},
	inventory: {
		anchor: "top-right",
		offset: { x: 16, y: 260 },
		size: { width: 350, height: 310 },
		minSize: { width: 350, height: 220 },
	},
	nearby: {
		anchor: "top-right",
		offset: { x: 16, y: 260 },
		size: { width: 420, height: 460 },
		minSize: { width: 320, height: 260 },
	},
	enchantments: {
		anchor: "center-right",
		offset: { x: 16, y: 0 },
		size: { width: 390, height: 460 },
		minSize: { width: 300, height: 250 },
	},
	journal: {
		anchor: "center-right",
		offset: { x: 16, y: 0 },
		size: { width: 480, height: 460 },
		minSize: { width: 340, height: 250 },
	},
	social: {
		anchor: "center-right",
		offset: { x: 16, y: 0 },
		size: { width: 440, height: 460 },
		minSize: { width: 340, height: 300 },
	},
	characterSheet: {
		anchor: "top-right",
		offset: { x: 16, y: 220 },
		size: { width: 480, height: 570 },
		minSize: { width: 350, height: 310 },
	},
	debug: {
		anchor: "top-right",
		offset: { x: 16, y: 260 },
		size: { width: 330, height: 310 },
		minSize: { width: 280, height: 220 },
	},
	world: {
		anchor: "center-right",
		offset: { x: 16, y: 0 },
		size: { width: 640, height: 640 },
		minSize: { width: 360, height: 300 },
	},
	settings: {
		anchor: "center-right",
		offset: { x: 16, y: 0 },
		size: { width: 430, height: 500 },
		minSize: { width: 340, height: 300 },
	},
	frameRate: {
		anchor: "top-center",
		offset: { x: 0, y: 8 },
		size: { width: 120, height: 26 },
		minSize: { width: 120, height: 24 },
		resizable: false,
	},
	jumpPower: {
		anchor: "center",
		offset: { x: 112, y: 0 },
		size: { width: 140, height: 184 },
		minSize: { width: 132, height: 184 },
		resizable: true,
	},
	minimap: {
		anchor: "top-right",
		offset: { x: 48, y: 16 },
		size: 220,
		minSize: 140,
		resizable: true,
	},
	selectedEntity: {
		anchor: "top-center",
		offset: { x: 0, y: 42 },
		size: { width: 360, height: 72 },
		minSize: { width: 240, height: 64 },
		resizable: false,
	},
	shortcuts: {
		anchor: "bottom-right",
		offset: { x: 16, y: 16 },
		size: { width: { perShortcut: 42 }, height: 42 },
		minSize: { width: 280, height: 36 },
		resizable: false,
	},
	toast: {
		anchor: "bottom-center",
		offset: { x: 0, y: 48 },
		size: { width: 420, height: 64 },
		minSize: { width: 200, height: 64 },
		resizable: false,
	},
} satisfies ClientUiDefaults;
