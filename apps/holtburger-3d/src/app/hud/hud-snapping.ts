import type { HudViewport, ResolvedHudPlacement } from "./hud-geometry";

/** Logical UI attraction range and spacing between adjacent HUD surfaces. */
export interface HudSnapOptions {
	/** Maximum displacement on either axis from raw pointer-derived placement. */
	readonly distance: number;
	/** Separation between adjacent edges in a snapped placement. */
	readonly gap: number;
}

/** Shared HUD peer-snapping defaults used by both Client and Explorer layout modes. */
export const HUD_SNAP_TUNING = {
	distance: 8,
	gap: 4,
} as const satisfies HudSnapOptions;

/** Snap to a nearby peer side, optionally aligning its parallel edges. */
export function snapHudRectangle(
	moving: ResolvedHudPlacement,
	peers: readonly ResolvedHudPlacement[],
	viewport: HudViewport,
	options: HudSnapOptions,
): ResolvedHudPlacement {
	let best = moving;
	let bestDistance = Infinity;
	for (const peer of peers) {
		const left = alignNearbyEdge(
			moving.left,
			peer.left,
			peer.left + peer.width - moving.width,
			options.distance,
		);
		const top = alignNearbyEdge(
			moving.top,
			peer.top,
			peer.top + peer.height - moving.height,
			options.distance,
		);
		const sides = [
			[left, moving.left].map((candidateLeft) => ({
				left: candidateLeft,
				top: peer.top - moving.height - options.gap,
			})),
			[left, moving.left].map((candidateLeft) => ({
				left: candidateLeft,
				top: peer.top + peer.height + options.gap,
			})),
			[top, moving.top].map((candidateTop) => ({
				left: peer.left - moving.width - options.gap,
				top: candidateTop,
			})),
			[top, moving.top].map((candidateTop) => ({
				left: peer.left + peer.width + options.gap,
				top: candidateTop,
			})),
		];
		for (const candidates of sides) {
			for (const candidate of candidates) {
				const dx = Math.abs(candidate.left - moving.left);
				const dy = Math.abs(candidate.top - moving.top);
				if (dx > options.distance || dy > options.distance) continue;
				const rectangle = { ...moving, ...candidate };
				if (
					rectangle.left < 0 ||
					rectangle.top < 0 ||
					rectangle.left + rectangle.width > viewport.width ||
					rectangle.top + rectangle.height > viewport.height
				)
					continue;
				const overlaps = peers.some(
					(other) =>
						rectangle.left < other.left + other.width &&
						other.left < rectangle.left + rectangle.width &&
						rectangle.top < other.top + other.height &&
						other.top < rectangle.top + rectangle.height,
				);
				if (overlaps) continue;
				if (
					rectangle.left > peer.left + peer.width + options.gap ||
					rectangle.left + rectangle.width + options.gap < peer.left ||
					rectangle.top > peer.top + peer.height + options.gap ||
					rectangle.top + rectangle.height + options.gap < peer.top
				)
					continue;
				const distance = dx * dx + dy * dy;
				if (distance < bestDistance) {
					best = rectangle;
					bestDistance = distance;
				}
				break;
			}
		}
	}
	return best;
}

/** Align the parallel axis only when a matching edge is within attraction range. */
function alignNearbyEdge(
	value: number,
	start: number,
	end: number,
	distance: number,
): number {
	const closest =
		Math.abs(start - value) <= Math.abs(end - value) ? start : end;
	return Math.abs(closest - value) <= distance ? closest : value;
}
