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
	navigation: { width: 420, height: 360 },
	scene: { width: 300, height: 320 },
	visuals: { width: 320, height: 360 },
	entities: { width: 340, height: 380 },
	inspection: { width: 320, height: 340 },
	diagnostics: { width: 360, height: 320 },
	settings: { width: 480, height: 400 },
	minimap: { width: 140, height: 140 },
	selectedEntity: { width: 240, height: 64 },
	shortcuts: { width: 252, height: 42 },
	frameRate: { width: 120, height: 24 },
	jumpPower: { width: 132, height: 184 },
	possessionRelease: { width: 96, height: 32 },
	toast: { width: 200, height: 64 },
};

export { createDefaultExplorerHudLayout };
