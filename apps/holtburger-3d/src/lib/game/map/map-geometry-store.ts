import type { EnvCellId, LandblockId } from "../game-types";
import type {
	ResolvedBuildingLayerSource,
	ResolvedPortalAperture,
	ResolvedPortalCrossing,
} from "../resolution/landblock-layer";
import type { ResolvedMapSurface } from "../resolution/presentation";
import type { ScenePlacement } from "../scene";
import { MAP_TRANSITION_ACCENT_THICKNESS } from "./map-appearance";
import { buildTransitionAccentSurface } from "./map-transition-accent";

/**
 * One derived surface paired with the landblock-local transform that places it.
 *
 * The host deduplicates map geometry by source — one silhouette per building model, one floor per
 * cell structure — so the map draws instances rather than a merged mesh, and this is one instance.
 */
export interface MapSurfaceInstance {
	readonly surface: ResolvedMapSurface;
	readonly placement: ScenePlacement;
}

/** One env-cell floor instance, tagged so the interior flood can select it. */
interface MapFloorInstance extends MapSurfaceInstance {
	readonly envCellId: EnvCellId;
}

/**
 * The narrow shape the store needs to install one interior.
 *
 * Structural rather than named after the materialization plan that happens to satisfy it, so the
 * map depends on no pipeline type and the pipeline knows nothing about the map.
 */
export interface MapInteriorInstallation {
	readonly landblockId: LandblockId;
	readonly shells: readonly {
		readonly envCellId: EnvCellId;
		readonly placement: ScenePlacement;
		readonly mapFloor: ResolvedMapSurface;
	}[];
	readonly crossings: readonly ResolvedPortalCrossing[];
	readonly apertures: readonly ResolvedPortalAperture[];
}

/**
 * One doorway stroke, tagged with the cell it belongs to.
 *
 * Indoors the map shows only the anchor's own interior, so an exit is filtered by the same
 * component membership its floor is; outdoors every entrance is worth marking.
 */
interface MapTransitionAccent {
	readonly envCellId: EnvCellId;
	readonly surface: ResolvedMapSurface;
}

/** Everything the map needs about one landblock's interior. */
export interface MapLandblockInterior {
	readonly floors: readonly MapFloorInstance[];
	/** Portal adjacency, kept whole so the flood reads it without a second decode. */
	readonly crossings: readonly ResolvedPortalCrossing[];
	/**
	 * Doorways between inside and outside, already widened into drawable strokes.
	 *
	 * Landblock-local like the apertures they come from, so they need no placement of their own.
	 */
	readonly transitions: readonly MapTransitionAccent[];
}

/**
 * Derived overhead-map geometry, held for exactly as long as the layers it came from.
 *
 * A sibling output of the materialization pipeline rather than scene content: map geometry is
 * installed and evicted on the same events as the layers it derives from, but never enters the
 * scene graph, so it cannot pick up scene-node lifetime by accident.
 *
 * `revision` changes whenever residency changes, giving the map renderer the same cheap dirty flag
 * that `installationRevision` gives it for terrain.
 */
export class MapGeometryStore {
	readonly #blockers = new Map<LandblockId, readonly MapSurfaceInstance[]>();
	readonly #interiors = new Map<LandblockId, MapLandblockInterior>();
	#revision = 0;

	/** Changes whenever installed map geometry changes. */
	get revision(): number {
		return this.#revision;
	}

	/**
	 * Retain blocker instances for one buildings layer.
	 *
	 * A source with no physics polygons still has an empty derived surface; a missing source is a
	 * broken host/frontend contract and fails loudly.
	 */
	installBuildings(source: ResolvedBuildingLayerSource): void {
		const instances: MapSurfaceInstance[] = [];
		for (const resident of source.staticResidents) {
			const surface = source.mapBlockers.get(
				resident.presentation.sourceAssetId,
			);
			if (!surface) {
				throw new Error(
					`Outdoor map geometry is missing source ${resident.presentation.sourceAssetId}.`,
				);
			}
			if (surface.indices.length === 0) continue;
			instances.push({ placement: resident.placement, surface });
		}
		if (instances.length === 0) {
			if (this.#blockers.delete(source.landblockId)) this.#revision += 1;
			return;
		}
		this.#blockers.set(source.landblockId, instances);
		this.#revision += 1;
	}

	/**
	 * Retain floor instances and portal adjacency for one landblock's interior.
	 *
	 * Cells whose structure has no walkable surface contribute no instance — roughly a fifth of
	 * authored structures per the shipped census — but their portals still carry adjacency, so the
	 * crossings are retained whole.
	 */
	installInterior(installation: MapInteriorInstallation): void {
		const floors: MapFloorInstance[] = [];
		for (const shell of installation.shells) {
			if (shell.mapFloor.indices.length === 0) continue;
			floors.push({
				envCellId: shell.envCellId,
				placement: shell.placement,
				surface: shell.mapFloor,
			});
		}
		this.#interiors.set(installation.landblockId, {
			crossings: installation.crossings,
			floors,
			transitions: buildTransitionAccents(installation),
		});
		this.#revision += 1;
	}

	/** Release one buildings layer's blocker geometry, if installed. */
	evictBuildings(landblockId: LandblockId): void {
		if (this.#blockers.delete(landblockId)) this.#revision += 1;
	}

	/** Release one EnvCell layer's interior geometry, if installed. */
	evictInterior(landblockId: LandblockId): void {
		if (this.#interiors.delete(landblockId)) this.#revision += 1;
	}

	/** Building blockers by landblock, for the outdoor map. */
	listBlockers(): Iterable<
		readonly [LandblockId, readonly MapSurfaceInstance[]]
	> {
		return this.#blockers.entries();
	}

	/** Interiors by landblock, for component selection and the indoor map. */
	listInteriors(): Iterable<readonly [LandblockId, MapLandblockInterior]> {
		return this.#interiors.entries();
	}

	interiorFor(landblockId: LandblockId): MapLandblockInterior | null {
		return this.#interiors.get(landblockId) ?? null;
	}

	clear(): void {
		if (this.#blockers.size === 0 && this.#interiors.size === 0) return;
		this.#blockers.clear();
		this.#interiors.clear();
		this.#revision += 1;
	}
}

/**
 * Widen every outdoor doorway in one interior into a drawable stroke.
 *
 * Only exterior transitions qualify: a doorway between two rooms is already legible as a gap in the
 * floor, while the way in or out of a building is the thing a map reader is hunting for.
 */
function buildTransitionAccents(
	installation: MapInteriorInstallation,
): readonly MapTransitionAccent[] {
	const accents: MapTransitionAccent[] = [];
	const seen = new Set<number>();
	for (const crossing of installation.crossings) {
		if (crossing.spatialRelationship.kind !== "exterior-transition") continue;
		// Exterior transitions arrive as a reciprocal pair naming one aperture, so the first side
		// seen owns the accent and the second is skipped.
		if (seen.has(crossing.sourceApertureIndex)) continue;
		const inside =
			crossing.source.kind === "env-cell" ? crossing.source : crossing.target;
		if (inside.kind !== "env-cell") {
			throw new Error("Exterior map transition has no interior endpoint.");
		}
		const aperture = installation.apertures[crossing.sourceApertureIndex];
		if (!aperture) {
			throw new Error(
				`Exterior map transition references missing aperture ${crossing.sourceApertureIndex}.`,
			);
		}
		seen.add(crossing.sourceApertureIndex);
		accents.push({
			envCellId: inside.envCellId,
			surface: buildTransitionAccentSurface(
				aperture.landblockBounds,
				MAP_TRANSITION_ACCENT_THICKNESS,
			),
		});
	}
	return accents;
}
