import type { LandblockOwnerId } from "../game-types";
import {
	createLandblockWorldOrigin,
	OUTDOOR_LANDBLOCK_WORLD_SIZE,
} from "../landblocks";
import { getMat4Translation, transformAABB3 } from "../math/matrices";
import { AABB3, Vec3 } from "../math/types";
import type { DynamicEntityPresentationClass } from "../dynamic-entity-presentation-class";
import type {
	ResolvedScenePlacement,
	SceneScope,
	SceneSpatialMembership,
	SceneTopologyView,
	SceneVisibilityIslandId,
} from "../scene";
import { scopeKey } from "../scene/scope";
import {
	MAX_ENTITY_ANALYTIC_SHADOW_CASTERS_PER_RECEIVER,
	isEntityShadowCasterClass,
	type IndoorGroundingSettings,
	type OutdoorDirectionalShadowSettings,
} from "./entity-shadow-policy";
import {
	outdoorShadowCastLength,
	type ResolvedOutdoorShadowProjection,
} from "./outdoor-pssm";

/** Shared immutable rigid-pose facts consumed by either analytic shadow mechanism. */
export interface EntityShadowCasterShape {
	/** Producer-stable identity used only for deterministic overflow ties. */
	readonly identity: string;
	/** Animated horizontal center plus authoritative root-contact height. */
	readonly contactAnchor: Vec3;
	/** Current rigid-pose height before outdoor projection-policy clamping. */
	readonly height: number;
	readonly radius: number;
}

/** One visible dynamic's indoor radial-grounding proxy in canonical scene coordinates. */
export interface EntityGroundingCaster extends EntityShadowCasterShape {
	/** Conservative receiver influence used only for CPU cell intersection. */
	readonly influenceBounds: AABB3;
	/** Every proof-backed indoor island reached by the entity's plural spatial membership. */
	readonly visibilityIslandIds: readonly SceneVisibilityIslandId[];
}

/** One dynamic root's shared shape plus independently eligible receiver projections. */
export interface ResolvedEntityShadowCaster {
	readonly indoorGrounding: EntityGroundingCaster | null;
	readonly reachesOutdoors: boolean;
	readonly shape: EntityShadowCasterShape;
}

/** One selected root's complete terrain-only sun-aligned capsule. */
export interface OutdoorDirectionalShadowCaster extends EntityShadowCasterShape {
	/** Projected capsule endpoint in the same canonical scene frame as the contact anchor. */
	readonly projectedEnd: Vec3;
	/** Conservative receiver influence containing the full projected capsule. */
	readonly influenceBounds: AABB3;
}

/** One visible EnvCell shell's immutable grounding-selection facts. */
export interface IndoorGroundingCell {
	readonly bounds: AABB3;
	readonly scopeKey: string;
	readonly visibilityIslandId: SceneVisibilityIslandId;
}

/** One visible terrain landblock's canonical horizontal grounding-selection facts. */
export interface OutdoorDirectionalShadowTerrain {
	readonly landblockId: LandblockOwnerId;
	readonly maximumX: number;
	readonly maximumZ: number;
	readonly minimumX: number;
	readonly minimumZ: number;
}

/** Fixed GPU-ready capsule records selected for one terrain receiver. */
export interface OutdoorDirectionalShadowSelection {
	count: number;
	readonly anchorsAndRadii: Float32Array;
	readonly projectedEnds: Float32Array;
}

/** Caller-owned directional selection storage reused across terrain receivers. */
export interface OutdoorDirectionalShadowSelectionScratch {
	readonly eligible: OutdoorDirectionalShadowCaster[];
	readonly nearest: OutdoorDirectionalShadowCaster[];
}

/** Fixed GPU-ready contact-anchor/radius records selected for one receiver. */
export interface EntityGroundingSelection {
	count: number;
	readonly records: Float32Array;
}

/** Caller-owned temporary storage reused across every visible cell in one view. */
export interface EntityGroundingSelectionScratch {
	readonly eligible: EntityGroundingCaster[];
	readonly nearest: EntityGroundingCaster[];
}

/** Index stable visibility-island authority once for all candidate and cell decisions in a view. */
export function indexIndoorVisibilityIslands(
	topology: SceneTopologyView,
	out: Map<string, SceneVisibilityIslandId> = new Map(),
): Map<string, SceneVisibilityIslandId> {
	out.clear();
	for (const entry of topology.scopes) {
		if (entry.visibilityIslandId !== null) {
			out.set(scopeKey(entry.scope), entry.visibilityIslandId);
		}
	}
	return out;
}

/** Construct one world-space proxy from rigid horizontal bounds and stable root height. */
export function resolveEntityShadowCaster(
	input: {
		readonly entityClass: DynamicEntityPresentationClass;
		readonly identity: string;
		readonly rigidBounds: AABB3;
		readonly placement: ResolvedScenePlacement;
		readonly spatialMembership: SceneSpatialMembership;
	},
	visibilityIslands: ReadonlyMap<string, SceneVisibilityIslandId>,
	settings: IndoorGroundingSettings,
): ResolvedEntityShadowCaster | null {
	if (!isEntityShadowCasterClass(input.entityClass)) return null;
	const islandIds: SceneVisibilityIslandId[] = [];
	let reachesOutdoors = false;
	for (const scope of input.spatialMembership.scopes) {
		if (scope.kind === "outdoor") reachesOutdoors = true;
		const islandId = visibilityIslands.get(scopeKey(scope));
		if (islandId !== undefined && !islandIds.includes(islandId)) {
			islandIds.push(islandId);
		}
	}
	if (!reachesOutdoors && islandIds.length === 0) return null;

	const worldRigidBounds = transformAABB3(
		input.placement.localToLandblock,
		input.rigidBounds,
	);
	const rootPosition = getMat4Translation(input.placement.localToLandblock);
	const landblockOrigin = createLandblockWorldOrigin(
		input.placement.landblockId,
	);
	worldRigidBounds.min.x += landblockOrigin.x;
	worldRigidBounds.min.z += landblockOrigin.z;
	worldRigidBounds.max.x += landblockOrigin.x;
	worldRigidBounds.max.z += landblockOrigin.z;
	const radius =
		Math.max(
			worldRigidBounds.max.x - worldRigidBounds.min.x,
			worldRigidBounds.max.z - worldRigidBounds.min.z,
		) * 0.5;
	const height = worldRigidBounds.max.y - worldRigidBounds.min.y;
	if (
		!Number.isFinite(radius) ||
		radius <= 0 ||
		!Number.isFinite(height) ||
		height <= 0
	)
		return null;
	const contactAnchor = new Vec3(
		(worldRigidBounds.min.x + worldRigidBounds.max.x) * 0.5,
		rootPosition.y + landblockOrigin.y,
		(worldRigidBounds.min.z + worldRigidBounds.max.z) * 0.5,
	);
	const shape = { contactAnchor, height, identity: input.identity, radius };
	const influenceRadius =
		radius * settings.radiusScale * (1 + settings.dropSpread);
	return {
		indoorGrounding:
			islandIds.length === 0
				? null
				: {
						...shape,
						influenceBounds: new AABB3(
							new Vec3(
								contactAnchor.x - influenceRadius,
								contactAnchor.y - settings.maximumDrop,
								contactAnchor.z - influenceRadius,
							),
							new Vec3(
								contactAnchor.x + influenceRadius,
								contactAnchor.y + settings.contactBias,
								contactAnchor.z + influenceRadius,
							),
						),
						visibilityIslandIds: islandIds,
					},
		reachesOutdoors,
		shape,
	};
}

/** Resolve one EnvCell scope to its proof-backed island and immutable world bounds. */
export function createIndoorGroundingCell(
	scope: Extract<SceneScope, { readonly kind: "env-cell" }>,
	bounds: AABB3,
	visibilityIslands: ReadonlyMap<string, SceneVisibilityIslandId>,
): IndoorGroundingCell {
	const key = scopeKey(scope);
	const visibilityIslandId = visibilityIslands.get(key);
	if (visibilityIslandId === undefined) {
		throw new Error(`EnvCell grounding scope ${key} has no visibility island.`);
	}
	return { bounds, scopeKey: key, visibilityIslandId };
}

/** Resolve one terrain landblock to its canonical horizontal world footprint. */
export function createOutdoorDirectionalShadowTerrain(
	landblockId: LandblockOwnerId,
): OutdoorDirectionalShadowTerrain {
	const origin = createLandblockWorldOrigin(landblockId);
	return {
		landblockId,
		maximumX: origin.x + OUTDOOR_LANDBLOCK_WORLD_SIZE,
		maximumZ: origin.z,
		minimumX: origin.x,
		minimumZ: origin.z - OUTDOOR_LANDBLOCK_WORLD_SIZE,
	};
}

/** Project one rigid root into a bounded directional capsule in its existing coordinate frame. */
export function createOutdoorDirectionalShadowCaster(
	shape: EntityShadowCasterShape,
	projection: ResolvedOutdoorShadowProjection,
	settings: OutdoorDirectionalShadowSettings,
): OutdoorDirectionalShadowCaster {
	const castLength = outdoorShadowCastLength(projection, shape.height);
	const projectedEnd = new Vec3(
		shape.contactAnchor.x + projection.horizontalCastDirection.x * castLength,
		shape.contactAnchor.y,
		shape.contactAnchor.z + projection.horizontalCastDirection.z * castLength,
	);
	const influenceRadius = shape.radius * settings.radiusScale;
	return {
		...shape,
		influenceBounds: new AABB3(
			new Vec3(
				Math.min(shape.contactAnchor.x, projectedEnd.x) - influenceRadius,
				shape.contactAnchor.y - settings.maximumReceiverDrop,
				Math.min(shape.contactAnchor.z, projectedEnd.z) - influenceRadius,
			),
			new Vec3(
				Math.max(shape.contactAnchor.x, projectedEnd.x) + influenceRadius,
				shape.contactAnchor.y + settings.contactBias,
				Math.max(shape.contactAnchor.z, projectedEnd.z) + influenceRadius,
			),
		),
		projectedEnd,
	};
}

export function createOutdoorDirectionalShadowSelection(): OutdoorDirectionalShadowSelection {
	return {
		anchorsAndRadii: new Float32Array(
			MAX_ENTITY_ANALYTIC_SHADOW_CASTERS_PER_RECEIVER * 4,
		),
		count: 0,
		projectedEnds: new Float32Array(
			MAX_ENTITY_ANALYTIC_SHADOW_CASTERS_PER_RECEIVER * 2,
		),
	};
}

export function createOutdoorDirectionalShadowSelectionScratch(): OutdoorDirectionalShadowSelectionScratch {
	return { eligible: [], nearest: [] };
}

export function createEntityGroundingSelection(): EntityGroundingSelection {
	return {
		count: 0,
		records: new Float32Array(
			MAX_ENTITY_ANALYTIC_SHADOW_CASTERS_PER_RECEIVER * 4,
		),
	};
}

export function createEntityGroundingSelectionScratch(): EntityGroundingSelectionScratch {
	return { eligible: [], nearest: [] };
}

/** Select one cell's candidates, preserving common-path order and ranking only on overflow. */
export function selectIndoorGroundingCasters(
	cell: IndoorGroundingCell,
	casters: readonly EntityGroundingCaster[],
	cameraPosition: Vec3,
	anchorOrigin: Vec3,
	out: EntityGroundingSelection,
	scratch: EntityGroundingSelectionScratch,
): EntityGroundingSelection {
	const eligible = scratch.eligible;
	eligible.length = 0;
	for (const caster of casters) {
		if (
			caster.visibilityIslandIds.includes(cell.visibilityIslandId) &&
			boundsIntersect(caster.influenceBounds, cell.bounds)
		) {
			eligible.push(caster);
		}
	}
	return writeGroundingSelection(
		eligible,
		cameraPosition,
		anchorOrigin,
		out,
		scratch.nearest,
	);
}

/** Select one terrain landblock's outdoor candidates with the same overflow-only budget. */
export function selectOutdoorDirectionalShadowCasters(
	landblock: OutdoorDirectionalShadowTerrain,
	casters: readonly OutdoorDirectionalShadowCaster[],
	cameraPosition: Vec3,
	anchorOrigin: Vec3,
	out: OutdoorDirectionalShadowSelection,
	scratch: OutdoorDirectionalShadowSelectionScratch,
): OutdoorDirectionalShadowSelection {
	const eligible = scratch.eligible;
	eligible.length = 0;
	for (const caster of casters) {
		if (horizontalBoundsIntersect(caster.influenceBounds, landblock)) {
			eligible.push(caster);
		}
	}
	const retained = retainNearestCasters(
		eligible,
		cameraPosition,
		scratch.nearest,
	);
	out.count = retained.length;
	let index = 0;
	for (const caster of retained) {
		const anchorOffset = index * 4;
		out.anchorsAndRadii[anchorOffset] = caster.contactAnchor.x - anchorOrigin.x;
		out.anchorsAndRadii[anchorOffset + 1] =
			caster.contactAnchor.y - anchorOrigin.y;
		out.anchorsAndRadii[anchorOffset + 2] =
			caster.contactAnchor.z - anchorOrigin.z;
		out.anchorsAndRadii[anchorOffset + 3] = caster.radius;
		const endOffset = index * 2;
		out.projectedEnds[endOffset] = caster.projectedEnd.x - anchorOrigin.x;
		out.projectedEnds[endOffset + 1] = caster.projectedEnd.z - anchorOrigin.z;
		index += 1;
	}
	return out;
}

/** Retain common-path order, rank only overflow, and write one anchor-relative GPU set. */
function writeGroundingSelection(
	eligible: readonly EntityGroundingCaster[],
	cameraPosition: Vec3,
	anchorOrigin: Vec3,
	out: EntityGroundingSelection,
	nearest: EntityGroundingCaster[],
): EntityGroundingSelection {
	const retained = retainNearestCasters(eligible, cameraPosition, nearest);
	out.count = retained.length;
	let index = 0;
	for (const caster of retained) {
		const offset = index * 4;
		out.records[offset] = caster.contactAnchor.x - anchorOrigin.x;
		out.records[offset + 1] = caster.contactAnchor.y - anchorOrigin.y;
		out.records[offset + 2] = caster.contactAnchor.z - anchorOrigin.z;
		out.records[offset + 3] = caster.radius;
		index += 1;
	}
	return out;
}

function retainNearestCasters<T extends EntityShadowCasterShape>(
	eligible: readonly T[],
	cameraPosition: Vec3,
	nearest: T[],
): readonly T[] {
	if (eligible.length <= MAX_ENTITY_ANALYTIC_SHADOW_CASTERS_PER_RECEIVER)
		return eligible;
	nearest.length = 0;
	for (const caster of eligible) {
		const distance = distanceSquared(caster.contactAnchor, cameraPosition);
		let insertion = 0;
		for (const retained of nearest) {
			if (
				compareCasterDistance(retained, caster, cameraPosition, distance) > 0
			) {
				break;
			}
			insertion += 1;
		}
		if (insertion < MAX_ENTITY_ANALYTIC_SHADOW_CASTERS_PER_RECEIVER) {
			nearest.splice(insertion, 0, caster);
			if (nearest.length > MAX_ENTITY_ANALYTIC_SHADOW_CASTERS_PER_RECEIVER)
				nearest.pop();
		}
	}
	return nearest;
}

function compareCasterDistance(
	left: EntityShadowCasterShape,
	right: EntityShadowCasterShape,
	cameraPosition: Vec3,
	rightDistance: number,
): number {
	const distanceOrder =
		distanceSquared(left.contactAnchor, cameraPosition) - rightDistance;
	return distanceOrder === 0
		? left.identity.localeCompare(right.identity)
		: distanceOrder;
}

function distanceSquared(left: Vec3, right: Vec3): number {
	const x = left.x - right.x;
	const y = left.y - right.y;
	const z = left.z - right.z;
	return x * x + y * y + z * z;
}

function boundsIntersect(left: AABB3, right: AABB3): boolean {
	return !(
		left.max.x < right.min.x ||
		left.min.x > right.max.x ||
		left.max.y < right.min.y ||
		left.min.y > right.max.y ||
		left.max.z < right.min.z ||
		left.min.z > right.max.z
	);
}

function horizontalBoundsIntersect(
	left: AABB3,
	right: OutdoorDirectionalShadowTerrain,
): boolean {
	return !(
		left.max.x < right.minimumX ||
		left.min.x > right.maximumX ||
		left.max.z < right.minimumZ ||
		left.min.z > right.maximumZ
	);
}
