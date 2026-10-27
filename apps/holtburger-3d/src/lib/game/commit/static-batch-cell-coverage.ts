import type { EnvCellId } from "../game-types";
import { inverseTransformRigidPoint3, transformAABB3 } from "../math/matrices";
import { type AABB3, Vec3 } from "../math/types";
import type {
	SceneEnvCellScopeInput,
	ScenePlacement,
	SceneSpatialMembership,
} from "../scene";
import {
	PORTAL_QUERY_EPSILON,
	type PlanarAperturePlane,
} from "../scene/planar-aperture";
import type { EnvCellLayerArtifact } from "./artifacts";

/** Prepared same-island cell adjacency, independent of camera and resource ownership. */
interface CoverageCell {
	readonly source: SceneEnvCellScopeInput;
	readonly neighbors: CoverageCrossing[];
}

/** A proven ordinary-depth seam whose plane is already in landblock render coordinates. */
interface CoverageCrossing {
	readonly target: CoverageCell;
	readonly plane: PlanarAperturePlane;
	readonly acceptedSide: "positive" | "negative";
}

/**
 * Resolve conservative coverage once per finalized static batch, before scene publication.
 *
 * The authored cell still owns the batch. Additional cells only index the same scene node.
 * Traversal is restricted to proven ordinary-depth seams within that cell's render island;
 * it never licenses a topology-boundary, exterior, or cross-landblock draw.
 */
export class StaticBatchCellCoverage {
	readonly #cells = new Map<EnvCellId, CoverageCell>();

	constructor(environment: Pick<EnvCellLayerArtifact, "scopes" | "crossings">) {
		for (const source of environment.scopes) {
			if (this.#cells.has(source.scope.envCellId)) {
				throw new Error(
					`Duplicate static coverage cell ${source.scope.envCellId}.`,
				);
			}
			if (
				source.containmentPlanes !== null &&
				source.containmentPlanes.length % 4 !== 0
			) {
				throw new Error(
					`Static coverage cell ${source.scope.envCellId} has incomplete planes.`,
				);
			}
			this.#cells.set(source.scope.envCellId, { source, neighbors: [] });
		}
		for (const crossing of environment.crossings) {
			if (
				crossing.source.kind !== "env-cell" ||
				crossing.target.kind !== "env-cell" ||
				crossing.spatialRelationship.kind !== "indoor-depth-continuous" ||
				crossing.source.landblockId !== crossing.target.landblockId
			)
				continue;
			const source = this.#cell(crossing.source.envCellId);
			const target = this.#cell(crossing.target.envCellId);
			if (source.source.visibilityIslandId !== target.source.visibilityIslandId)
				continue;
			source.neighbors.push({
				target,
				plane: crossing.sourceAperture.plane,
				acceptedSide: crossing.acceptedSide,
			});
		}
	}

	/** Bounds are object-root local; placement is applied exactly once to obtain landblock bounds. */
	resolve(
		placement: ScenePlacement,
		localBounds: AABB3,
	): SceneSpatialMembership {
		if (placement.envCellId === null) {
			throw new Error("Static interior coverage requires an EnvCell owner.");
		}
		const owner = this.#cell(placement.envCellId);
		if (owner.source.scope.landblockId !== placement.landblockId) {
			throw new Error(
				`Static coverage owner ${placement.envCellId} belongs to another landblock.`,
			);
		}
		const bounds = transformAABB3(placement.localTransform, localBounds);
		const reached = new Set([owner]);
		const queue = [owner];
		for (let index = 0; index < queue.length; index += 1) {
			const cell = queue[index]!;
			for (const crossing of cell.neighbors) {
				if (reached.has(crossing.target)) continue;
				// The source occupies its accepted half-space. Coverage needs at least one
				// bound corner on or beyond that half-space's boundary, including contact.
				const direction = crossing.acceptedSide === "positive" ? -1 : 1;
				if (
					maximumPlaneDistance(bounds, crossing.plane, direction) <
					-PORTAL_QUERY_EPSILON
				)
					continue;
				if (!intersectsCell(bounds, crossing.target.source)) continue;
				reached.add(crossing.target);
				queue.push(crossing.target);
			}
		}
		return { scopes: queue.map((cell) => cell.source.scope) };
	}

	#cell(id: EnvCellId): CoverageCell {
		const cell = this.#cells.get(id);
		if (!cell) throw new Error(`Static coverage cell ${id} is unavailable.`);
		return cell;
	}
}

/** Support of an axis-aligned bound along either orientation of a normalized plane. */
function maximumPlaneDistance(
	bounds: AABB3,
	plane: PlanarAperturePlane,
	direction: 1 | -1,
): number {
	const x = direction * plane.normal.x;
	const y = direction * plane.normal.y;
	const z = direction * plane.normal.z;
	return (
		x * (x >= 0 ? bounds.max.x : bounds.min.x) +
		y * (y >= 0 ? bounds.max.y : bounds.min.y) +
		z * (z >= 0 ? bounds.max.z : bounds.min.z) +
		direction * plane.d
	);
}

/** Conservative hull separation: reject only when one cell plane excludes the entire batch. */
function intersectsCell(bounds: AABB3, cell: SceneEnvCellScopeInput): boolean {
	const shell = cell.landblockBounds;
	const planes = cell.containmentPlanes;
	// Shell bounds describe rendered polygons, not a proven enclosure of the cell's
	// containment region. Prefer the authored hull whenever it is available.
	if (
		planes === null &&
		shell !== null &&
		(bounds.max.x < shell.min.x - PORTAL_QUERY_EPSILON ||
			bounds.min.x > shell.max.x + PORTAL_QUERY_EPSILON ||
			bounds.max.y < shell.min.y - PORTAL_QUERY_EPSILON ||
			bounds.min.y > shell.max.y + PORTAL_QUERY_EPSILON ||
			bounds.max.z < shell.min.z - PORTAL_QUERY_EPSILON ||
			bounds.min.z > shell.max.z + PORTAL_QUERY_EPSILON)
	)
		return false;
	if (planes === null) {
		// Portal-less cells cannot own point residency, but their render bounds still
		// conservatively bound visible geometry. This does not grant physical membership.
		if (shell === null)
			throw new Error(
				`Static coverage cell ${cell.scope.envCellId} has no hull or bounds.`,
			);
		return true;
	}
	const corners: Vec3[] = [];
	for (let corner = 0; corner < 8; corner += 1) {
		const point = inverseTransformRigidPoint3(
			cell.structureToLandblock,
			new Vec3(
				(corner & 4) === 0 ? bounds.min.x : bounds.max.x,
				(corner & 2) === 0 ? bounds.min.y : bounds.max.y,
				(corner & 1) === 0 ? bounds.min.z : bounds.max.z,
			),
		);
		// CellStruct planes retain AC axes: renderer (x,y,z) becomes AC (x,-z,y).
		corners.push(new Vec3(point.x, -point.z, point.y));
	}
	for (let index = 0; index < planes.length; index += 4) {
		if (
			corners.every(
				(p) =>
					planes[index]! * p.x +
						planes[index + 1]! * p.y +
						planes[index + 2]! * p.z +
						planes[index + 3]! <
					-PORTAL_QUERY_EPSILON,
			)
		)
			return false;
	}
	return true;
}
