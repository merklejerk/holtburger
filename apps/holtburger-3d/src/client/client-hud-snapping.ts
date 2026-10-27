import type {
	ClientHudViewport,
	ResolvedClientHudPlacement,
} from "./client-hud-layout";

/** CSS-pixel attraction range and spacing between adjacent HUD surfaces. */
export interface HudSnapOptions {
	/** Maximum displacement on either axis from raw pointer-derived placement. */
	readonly distance: number;
	/** Separation between adjacent edges in a snapped placement. */
	readonly gap: number;
}

/** Snap to a nearby peer side, optionally aligning its parallel edges. */
export function snapClientHudRectangle(
	moving: ResolvedClientHudPlacement,
	peers: readonly ResolvedClientHudPlacement[],
	viewport: ClientHudViewport,
	options: HudSnapOptions,
): ResolvedClientHudPlacement {
	let best = moving;
	let bestDistance = Infinity;
	for (const peer of peers) {
		// Each candidate belongs to one adjacent side; unrelated distant alignment lines
		// cannot attract a bar, and the two axes cannot select incompatible peers.
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
			[left, moving.left].map((left) => ({
				left,
				top: peer.top - moving.height - options.gap,
			})),
			[left, moving.left].map((left) => ({
				left,
				top: peer.top + peer.height + options.gap,
			})),
			[top, moving.top].map((top) => ({
				left: peer.left - moving.width - options.gap,
				top,
			})),
			[top, moving.top].map((top) => ({
				left: peer.left + peer.width + options.gap,
				top,
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
				// Require nearby spans as well as nearby edges, so distant collinear bars
				// cannot attract each other. A shared corner is a valid adjacency.
				if (
					rectangle.left > peer.left + peer.width + options.gap ||
					rectangle.left + rectangle.width + options.gap < peer.left ||
					rectangle.top > peer.top + peer.height + options.gap ||
					rectangle.top + rectangle.height + options.gap < peer.top
				)
					continue;
				const distance = dx * dx + dy * dy;
				// Stable input order breaks exact ties without retaining gesture state.
				if (distance < bestDistance) {
					best = rectangle;
					bestDistance = distance;
				}
				// Prefer matching parallel edges, but retain the unaligned side snap when
				// alignment is blocked by the viewport or another surface.
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
