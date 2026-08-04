import type { LandblockId } from "../game-types";
import type { OutdoorStaticLayerKind } from "../runtime/scene-interest";
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
 * Effective sets are memoized and invalidated wholesale whenever any owned set changes, because
 * a single landblock's lights can reach into eight others and residency changes are rare relative
 * to frames.
 */
export class OutdoorLightIndex {
	readonly #owned = new Map<OwnedLightScope, OwnedLights>();
	readonly #effective = new Map<LandblockId, readonly RuntimeLight[]>();

	/**
	 * Replace one landblock layer's emitted lights. Passing an empty list removes its entry.
	 *
	 * Keyed by layer as well as landblock because all three outdoor static layers publish here
	 * independently. Only the Objects layer ever emits, but Buildings and Generated still publish
	 * empty sets for the same landblock, and a landblock-only key let whichever published last
	 * erase the lamps.
	 */
	install(
		landblockId: LandblockId,
		layer: OutdoorStaticLayerKind,
		lights: readonly RuntimeLight[],
	): void {
		const scope: OwnedLightScope = `${landblockId}/${layer}`;
		if (lights.length === 0) {
			if (!this.#owned.delete(scope)) return;
		} else {
			this.#owned.set(scope, { landblockId, lights });
		}
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
		for (const owned of this.#owned.values()) {
			const owner = getLandblockCoordinates(owned.landblockId);
			// Only the eight neighbours can reach in: a light's range is a small fraction of a
			// landblock edge, so anything further cannot cross two boundaries.
			if (
				Math.abs(owner.x - coordinates.x) > 1 ||
				Math.abs(owner.y - coordinates.y) > 1
			) {
				continue;
			}
			for (const light of owned.lights) {
				if (
					owned.landblockId === landblockId ||
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

/** One publishing layer's key: outdoor static layers publish per landblock, independently. */
type OwnedLightScope = `${LandblockId}/${OutdoorStaticLayerKind}`;

/** Owned lights alongside their landblock, so gathering never re-parses the scope key. */
interface OwnedLights {
	readonly landblockId: LandblockId;
	readonly lights: readonly RuntimeLight[];
}

const EMPTY: readonly RuntimeLight[] = [];
