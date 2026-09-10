import type { ClientUiDefaults } from "./client-ui-contract";

/**
 * Initial client HUD arrangement, in CSS pixels.
 * Edge offsets point inward; centered offsets are signed (positive right/down).
 * Fitting and user edits live in client-hud-layout; visibility stays in Svelte.
 */
export const CLIENT_UI_DEFAULTS = {
	character: {
		anchor: "top-left",
		offset: { x: 16, y: 16 },
		size: { width: 340, height: 132 },
		minSize: { width: 250, height: 116 },
		resizable: true,
	},
	chat: {
		anchor: "bottom-left",
		offset: { x: 16, y: 16 },
		size: { width: 400, height: { viewportMinus: 188, min: 260, max: 450 } },
		minSize: { width: 280, height: 240 },
		resizable: true,
	},
	diagnostics: {
		anchor: "top-right",
		offset: { x: 16, y: 260 },
		size: { width: 330, height: 310 },
		minSize: { width: 280, height: 220 },
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
		offset: { x: 96, y: 0 },
		size: { width: 38, height: 132 },
		minSize: { width: 38, height: 132 },
		resizable: false,
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
		resizable: true,
	},
	toast: {
		anchor: "bottom-center",
		offset: { x: 0, y: 48 },
		size: { width: 420, height: 64 },
		minSize: { width: 200, height: 64 },
		resizable: false,
	},
} satisfies ClientUiDefaults;
