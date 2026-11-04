/**
 * Canonical z-index layer bands for the 3D client viewport.
 *
 * Spacing between layers ensures that dynamic sub-stacks (such as multiple
 * floating windows) have ample headroom without colliding into higher tiers.
 */
export const CLIENT_UI_LAYERS = {
	/** Underlying 3D canvas and baseline background. */
	canvas: 0,
	/** Fixed HUD panels (character vitals, chat, shortcuts dock, action bars). */
	hudPanel: 10,
	/** Base z-index for floating windows; stacked windows occupy windowBase + depth. */
	windowBase: 100,
	/** Maximum headroom allocated to floating window stacking. */
	windowMax: 199,
	/** Viewport-level controls and tools (e.g. HUD layout lock button). */
	viewportControls: 500,
	/** Modal dialogs and blocking overlays. */
	modal: 1000,
	/** Interactive drag-and-drop ghosts. */
	dragGhost: 10000,
} as const;
