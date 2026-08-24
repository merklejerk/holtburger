import type { EnvCellId, LandblockId } from "../game-types";
import type { SceneResidency } from "../scene";
import type { MapGeometryStore } from "./map-geometry-store";
import {
	floodInteriorComponent,
	interiorComponentContains,
} from "./map-interior-component";

const EMPTY_INTERIOR_COMPONENT: ReadonlySet<EnvCellId> = new Set();

/**
 * The interior the map is currently showing, held across a whole dungeon walk.
 *
 * Undirected components are equivalence classes, so a flood stays correct for as long as the
 * anchor is still inside it — membership is a complete validity test. Re-flooding therefore
 * happens only when the anchor leaves the set, moves to another landblock, or the store's geometry
 * changes underneath it, rather than every time the anchor moves.
 */
export class MapInteriorSelection {
	#landblockId: LandblockId | null = null;
	#component: ReadonlySet<EnvCellId> = EMPTY_INTERIOR_COMPONENT;
	#storeRevision = -1;

	/** Cells of the interior the anchor occupies; empty when the anchor is outdoors. */
	select(
		store: MapGeometryStore,
		residency: SceneResidency | null,
	): ReadonlySet<EnvCellId> {
		if (!residency || residency.envCellId === null) {
			this.#landblockId = null;
			this.#component = EMPTY_INTERIOR_COMPONENT;
			return this.#component;
		}
		const unchanged =
			this.#landblockId === residency.landblockId &&
			this.#storeRevision === store.revision &&
			interiorComponentContains(this.#component, residency.envCellId);
		if (unchanged) return this.#component;

		const interior = store.interiorFor(residency.landblockId);
		this.#component = interior
			? floodInteriorComponent(interior.crossings, residency.envCellId)
			: new Set([residency.envCellId]);
		this.#landblockId = residency.landblockId;
		this.#storeRevision = store.revision;
		return this.#component;
	}
}
