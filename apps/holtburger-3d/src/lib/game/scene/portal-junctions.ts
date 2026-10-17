import {
	createLandblockOffset,
	getLandblockCoordinates,
	OUTDOOR_LANDBLOCK_WORLD_SIZE,
} from "../landblocks";
import { Vec3 } from "../math/types";
import { crossVec3, dotVec3, normalizeVec3 } from "../math/vector-utils";
import type {
	ScenePortalCrossing,
	ScenePortalCrossingInput,
	SceneTopologyScope,
} from ".";
import { validatePlanarAperture } from "./planar-aperture";
import { scopeKey } from "./scope";
import {
	triangleMeshOverlapArea,
	type PlanePoint,
	type PlaneTriangleMesh,
} from "./triangle-mesh-overlap";

/** Existing junction proof tolerances, in metres and square metres, respectively. */
const JUNCTION_NORMAL_ALIGNMENT_EPSILON = 1e-3;
export const JUNCTION_PLANE_OFFSET_EPSILON = 0.05;
export const JUNCTION_OVERLAP_AREA_MINIMUM = 1e-4;

/** Numerical area dead zone in m², separate from the threshold that joins openings.
 * Ignores clipping residue and projection-dependent contacts in slightly nonplanar content.
 * Validated over 167 owners covering every reachable Environment/CellStruct template:
 * 158,541 crossings retained all junction assignments and all 923 ambiguity rejections.
 * This is an empirical geometry tolerance, not an exact-arithmetic guarantee.
 */
export const JUNCTION_OVERLAP_AREA_EPSILON = 1e-12;

type Aperture = ScenePortalCrossingInput["sourceAperture"];

/** One cold topology candidate; global bounds use JS doubles only for broad-phase sorting. */
interface JunctionCandidate {
	readonly crossing: ScenePortalCrossingInput;
	readonly domain: string;
	readonly minimumX: number;
	readonly maximumX: number;
	readonly minimumZ: number;
	readonly maximumZ: number;
}

/**
 * Assign equal-depth permissions once for a complete resident topology revision.
 * Geometry remains authored: grouping changes neither adjacency nor visibility islands.
 * Same-domain overlap triangles conservatively reject components with competing exits.
 */
export function resolvePortalJunctions(
	crossings: readonly ScenePortalCrossingInput[],
	scopes: readonly SceneTopologyScope[],
): readonly ScenePortalCrossing[] {
	const domains = new Map(
		scopes.map(({ scope, visibilityIslandId }) => {
			if (scope.kind === "env-cell" && visibilityIslandId === null)
				throw new Error(
					`Portal scope ${scopeKey(scope)} has no visibility island.`,
				);
			return [
				scopeKey(scope),
				scope.kind === "outdoor" ? "outdoor" : visibilityIslandId,
			];
		}),
	);
	const candidates = crossings.map((crossing): JunctionCandidate => {
		const domain = domains.get(scopeKey(crossing.source));
		if (domain === undefined || domain === null)
			throw new Error(
				`Portal crossing ${crossing.id} has no resident source domain.`,
			);
		const aperture = crossing.sourceAperture;
		validatePlanarAperture(aperture);
		const owner = getLandblockCoordinates(aperture.landblockId);
		const x = owner.x * OUTDOOR_LANDBLOCK_WORLD_SIZE;
		const z = -owner.y * OUTDOOR_LANDBLOCK_WORLD_SIZE;
		return {
			crossing,
			domain,
			minimumX: aperture.landblockBounds.min.x + x,
			maximumX: aperture.landblockBounds.max.x + x,
			minimumZ: aperture.landblockBounds.min.z + z,
			maximumZ: aperture.landblockBounds.max.z + z,
		};
	});
	const parents = candidates.map((_, index) => index);
	const overlaps = candidates.map(() => new Set<number>());
	const find = (index: number): number => {
		let root = index;
		while (parents[root] !== root) root = parents[root]!;
		while (parents[index] !== root) {
			const next = parents[index]!;
			parents[index] = root;
			index = next;
		}
		return root;
	};
	// A sweep prunes distant owners before polygon clipping; no camera participates in discovery.
	const ordered = candidates
		.map((_, index) => index)
		.sort((a, b) => candidates[a]!.minimumX - candidates[b]!.minimumX);
	for (let i = 0; i < ordered.length; i++) {
		const left = ordered[i]!;
		const a = candidates[left]!;
		for (let j = i + 1; j < ordered.length; j++) {
			const right = ordered[j]!;
			const b = candidates[right]!;
			if (b.minimumX > a.maximumX + JUNCTION_PLANE_OFFSET_EPSILON) break;
			if (!boundsOverlap(a, b)) continue;
			const area = apertureOverlapArea(
				a.crossing.sourceAperture,
				b.crossing.sourceAperture,
			);
			// Ambiguity includes meaningful overlaps below the component-formation threshold.
			if (area > JUNCTION_OVERLAP_AREA_EPSILON && a.domain === b.domain) {
				overlaps[left]!.add(right);
				overlaps[right]!.add(left);
			}
			if (area > JUNCTION_OVERLAP_AREA_MINIMUM)
				parents[find(right)] = find(left);
		}
	}
	const components = new Map<number, number[]>();
	candidates.forEach((_, index) => {
		const root = find(index);
		const members = components.get(root);
		if (members) members.push(index);
		else components.set(root, [index]);
	});
	const assignments = new Map<number, number>();
	let nextGroup = 1;
	for (const members of components.values()) {
		if (members.length < 2) continue;
		if (members.length === 2) {
			const a = candidates[members[0]!]!.crossing;
			const b = candidates[members[1]!]!.crossing;
			if (a.reciprocalCrossingId === b.id || b.reciprocalCrossingId === a.id) {
				if (a.reciprocalCrossingId !== b.id || b.reciprocalCrossingId !== a.id)
					throw new Error(
						`Portal crossings ${a.id}/${b.id} name a non-mutual reciprocal.`,
					);
				continue;
			}
		}
		const conflict = overlappingExitTriangle(members, overlaps);
		if (conflict !== null) {
			console.warn(
				`Portal junction declined: three same-domain exits overlap: ${conflict.map((index) => candidates[index]!.crossing.id).join(", ")}`,
			);
			continue;
		}
		for (let i = 0; i < members.length; i++)
			for (let j = i + 1; j < members.length; j++) {
				const a = candidates[members[i]!]!.crossing;
				const b = candidates[members[j]!]!.crossing;
				if (!planesCoincide(a.sourceAperture, b.sourceAperture))
					throw new Error(
						`Portal junction ${a.id}/${b.id} chains non-coincident planes.`,
					);
			}
		for (const member of members) assignments.set(member, nextGroup);
		nextGroup++;
	}
	return crossings.map((crossing, index) =>
		Object.freeze({
			...crossing,
			junctionGroupId: assignments.get(index) ?? null,
		}),
	);
}

function boundsOverlap(a: JunctionCandidate, b: JunctionCandidate): boolean {
	const slack = JUNCTION_PLANE_OFFSET_EPSILON;
	const left = a.crossing.sourceAperture.landblockBounds;
	const right = b.crossing.sourceAperture.landblockBounds;
	return (
		b.maximumX + slack >= a.minimumX &&
		b.minimumZ <= a.maximumZ + slack &&
		b.maximumZ + slack >= a.minimumZ &&
		left.min.y <= right.max.y + slack &&
		right.min.y <= left.max.y + slack
	);
}

/** Test planes in the left aperture's local owner frame to avoid large-coordinate cancellation. */
function planesCoincide(left: Aperture, right: Aperture): boolean {
	const a = left.plane;
	const b = right.plane;
	const alignment = dotVec3(a.normal, b.normal);
	const cosine =
		Math.abs(alignment) /
		(Math.hypot(a.normal.x, a.normal.y, a.normal.z) *
			Math.hypot(b.normal.x, b.normal.y, b.normal.z));
	if (1 - Math.min(1, cosine) > JUNCTION_NORMAL_ALIGNMENT_EPSILON) return false;
	const offset = createLandblockOffset(
		getLandblockCoordinates(right.landblockId),
		getLandblockCoordinates(left.landblockId),
	);
	const rightD = b.d - dotVec3(b.normal, offset);
	return (
		Math.abs(a.d - (alignment >= 0 ? rightD : -rightD)) <=
		JUNCTION_PLANE_OFFSET_EPSILON
	);
}

/** Project authored triangles into one nearby plane; source geometry remains unchanged. */
function apertureOverlapArea(left: Aperture, right: Aperture): number {
	if (!planesCoincide(left, right)) return 0;
	const normal = normalizeVec3(left.plane.normal);
	const axes = [new Vec3(1, 0, 0), new Vec3(0, 1, 0), new Vec3(0, 0, 1)];
	const reference = axes.reduce((best, axis) =>
		Math.abs(dotVec3(axis, normal)) < Math.abs(dotVec3(best, normal))
			? axis
			: best,
	);
	const horizontal = normalizeVec3(crossVec3(reference, normal));
	const vertical = crossVec3(normal, horizontal);
	const origin = new Vec3(
		left.vertices[0]!,
		left.vertices[1]!,
		left.vertices[2]!,
	);
	const offset = createLandblockOffset(
		getLandblockCoordinates(right.landblockId),
		getLandblockCoordinates(left.landblockId),
	);
	const project = (aperture: Aperture, offset: Vec3): PlaneTriangleMesh => {
		const vertices: PlanePoint[] = [];
		for (let i = 0; i < aperture.vertices.length; i += 3) {
			const point = new Vec3(
				aperture.vertices[i]! + offset.x - origin.x,
				aperture.vertices[i + 1]! - origin.y,
				aperture.vertices[i + 2]! + offset.z - origin.z,
			);
			vertices.push([dotVec3(point, horizontal), dotVec3(point, vertical)]);
		}
		return { vertices, indices: aperture.indices };
	};
	return triangleMeshOverlapArea(
		project(left, Vec3.zero()),
		project(right, offset),
	);
}

function overlappingExitTriangle(
	members: readonly number[],
	overlaps: readonly ReadonlySet<number>[],
): readonly number[] | null {
	const included = new Set(members);
	for (const left of members)
		for (const middle of overlaps[left]!) {
			if (middle <= left || !included.has(middle)) continue;
			for (const right of overlaps[middle]!)
				if (right > middle && included.has(right) && overlaps[left]!.has(right))
					return [left, middle, right];
		}
	return null;
}
