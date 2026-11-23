import type { ExplorerHudPlacementKey } from "../settings/explorer-settings-contract";
import { createDefaultExplorerHudLayout } from "../settings/explorer-settings-defaults";

/** Independent floating windows launched from the Explorer Shortcut Dock. */
export type ExplorerWindowId =
	"navigation" | "scene" | "visuals" | "entities" | "diagnostics" | "settings";

/** Minimum logical dimensions for each Explorer HUD surface. */
export const EXPLORER_HUD_MINIMUMS: Readonly<
	Record<
		ExplorerHudPlacementKey,
		{ readonly width: number; readonly height: number }
	>
> = {
	navigation: { width: 360, height: 300 },
	scene: { width: 300, height: 240 },
	visuals: { width: 300, height: 240 },
	entities: { width: 320, height: 260 },
	inspection: { width: 300, height: 240 },
	diagnostics: { width: 280, height: 220 },
	settings: { width: 340, height: 300 },
	minimap: { width: 140, height: 140 },
	selectedEntity: { width: 240, height: 64 },
	shortcuts: { width: 252, height: 42 },
	frameRate: { width: 120, height: 24 },
	jumpPower: { width: 132, height: 184 },
	possessionRelease: { width: 96, height: 32 },
	toast: { width: 200, height: 64 },
};

export { createDefaultExplorerHudLayout };
