import type { LandblockId } from "../game-types";
import {
	getLandblockCoordinates,
	OUTDOOR_LANDBLOCK_WORLD_SIZE,
} from "../landblocks";
import type { RuntimeLight } from "./runtime-lights";

/**
 * Per-landblock outdoor light sets, including lights owned by neighbours that reach across the
 * boundary.
 *
 * The landblock grid is the spatial index: content residency already partitions the world, so a
 * lookup is a map read and neighbour spill is a fixed nine-cell fan-out. There is deliberately no
 * tree or light grid — see the plan's Spatial Scope section.
 *
 * Effective sets are memoized and invalidated wholesale whenever any landblock's owned lights
 * change, because a single landblock's lights can reach into eight others and residency changes
 * are rare relative to frames.
 */
export class OutdoorLightIndex {
	readonly #owned = new Map<LandblockId, readonly RuntimeLight[]>();
	readonly #effective = new Map<LandblockId, readonly RuntimeLight[]>();

	/** Replace one landblock's emitted lights. Passing an empty list removes its entry. */
	install(landblockId: LandblockId, lights: readonly RuntimeLight[]): void {
		const existing = this.#owned.get(landblockId);
		if (lights.length === 0) {
			if (existing === undefined) return;
			this.#owned.delete(landblockId);
		} else {
			this.#owned.set(landblockId, lights);
		}
		this.#effective.clear();
	}

	/** Drop one landblock's contribution when its layer is withdrawn. */
	remove(landblockId: LandblockId): void {
		if (!this.#owned.delete(landblockId)) return;
		this.#effective.clear();
	}

	/** True when no landblock emits any light, so callers can skip binding entirely. */
	get isEmpty(): boolean {
		return this.#owned.size === 0;
	}

	/**
	 * Every light reaching the given landblock, its own plus any neighbour's that crosses in.
	 *
	 * Returns a shared empty array for unlit landblocks so the common case allocates nothing.
	 */
	resolve(landblockId: LandblockId): readonly RuntimeLight[] {
		const memoized = this.#effective.get(landblockId);
		if (memoized !== undefined) return memoized;
		if (this.#owned.size === 0) return EMPTY;
		const resolved = this.#gather(landblockId);
		this.#effective.set(landblockId, resolved);
		return resolved;
	}

	#gather(landblockId: LandblockId): readonly RuntimeLight[] {
		const coordinates = getLandblockCoordinates(landblockId);
		const minimumX = coordinates.x * OUTDOOR_LANDBLOCK_WORLD_SIZE;
		const maximumZ = -coordinates.y * OUTDOOR_LANDBLOCK_WORLD_SIZE;
		const minimumZ = maximumZ - OUTDOOR_LANDBLOCK_WORLD_SIZE;
		const maximumX = minimumX + OUTDOOR_LANDBLOCK_WORLD_SIZE;
		const gathered: RuntimeLight[] = [];
		for (const [ownerId, lights] of this.#owned) {
			const owner = getLandblockCoordinates(ownerId);
			// Only the eight neighbours can reach in: a light's range is a small fraction of a
			// landblock edge, so anything further cannot cross two boundaries.
			if (
				Math.abs(owner.x - coordinates.x) > 1 ||
				Math.abs(owner.y - coordinates.y) > 1
			) {
				continue;
			}
			for (const light of lights) {
				if (
					ownerId === landblockId ||
					reachesBounds(light, minimumX, maximumX, minimumZ, maximumZ)
				) {
					gathered.push(light);
				}
			}
		}
		return gathered.length === 0 ? EMPTY : gathered;
	}
}

/** Whether a light's sphere intersects a landblock's horizontal extent. */
function reachesBounds(
	light: RuntimeLight,
	minimumX: number,
	maximumX: number,
	minimumZ: number,
	maximumZ: number,
): boolean {
	const nearestX = Math.min(Math.max(light.position.x, minimumX), maximumX);
	const nearestZ = Math.min(Math.max(light.position.z, minimumZ), maximumZ);
	const dx = light.position.x - nearestX;
	const dz = light.position.z - nearestZ;
	// Vertical extent is deliberately ignored: terrain height is unbounded in the index, and a
	// light that is horizontally in range but vertically distant is culled by the shader anyway.
	return dx * dx + dz * dz < light.range * light.range;
}

const EMPTY: readonly RuntimeLight[] = [];
