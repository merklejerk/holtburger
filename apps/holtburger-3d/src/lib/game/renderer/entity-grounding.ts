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
	MAX_ENTITY_GROUNDING_CASTERS_PER_RECEIVER,
	isEntityShadowCasterClass,
	type EntityGroundingSettings,
} from "./entity-shadow-policy";

/** One visible dynamic's analytic grounding proxy in canonical scene coordinates. */
export interface EntityGroundingCaster {
	/** Producer-stable identity used only for deterministic overflow ties. */
	readonly identity: string;
	/** Animated horizontal center plus authoritative root-contact height. */
	readonly contactAnchor: Vec3;
	/** Conservative receiver influence used only for CPU cell intersection. */
	readonly influenceBounds: AABB3;
	readonly radius: number;
	/** Whether the entity's plural spatial membership reaches the outdoor domain. */
	readonly reachesOutdoors: boolean;
	/** Every proof-backed indoor island reached by the entity's plural spatial membership. */
	readonly visibilityIslandIds: readonly SceneVisibilityIslandId[];
}

/** One visible EnvCell shell's immutable grounding-selection facts. */
export interface IndoorGroundingCell {
	readonly bounds: AABB3;
	readonly scopeKey: string;
	readonly visibilityIslandId: SceneVisibilityIslandId;
}

/** One visible terrain landblock's canonical horizontal grounding-selection facts. */
export interface OutdoorGroundingLandblock {
	readonly landblockId: LandblockOwnerId;
	readonly maximumX: number;
	readonly maximumZ: number;
	readonly minimumX: number;
	readonly minimumZ: number;
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
export function createEntityGroundingCaster(
	input: {
		readonly entityClass: DynamicEntityPresentationClass;
		readonly identity: string;
		readonly rigidBounds: AABB3;
		readonly placement: ResolvedScenePlacement;
		readonly spatialMembership: SceneSpatialMembership;
	},
	visibilityIslands: ReadonlyMap<string, SceneVisibilityIslandId>,
	settings: EntityGroundingSettings,
): EntityGroundingCaster | null {
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
	if (!Number.isFinite(radius) || radius <= 0) return null;
	const contactAnchor = new Vec3(
		(worldRigidBounds.min.x + worldRigidBounds.max.x) * 0.5,
		rootPosition.y + landblockOrigin.y,
		(worldRigidBounds.min.z + worldRigidBounds.max.z) * 0.5,
	);
	const influenceRadius =
		radius * settings.radiusScale * (1 + settings.dropSpread);
	return {
		contactAnchor,
		identity: input.identity,
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
		radius,
		reachesOutdoors,
		visibilityIslandIds: islandIds,
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
export function createOutdoorGroundingLandblock(
	landblockId: LandblockOwnerId,
): OutdoorGroundingLandblock {
	const origin = createLandblockWorldOrigin(landblockId);
	return {
		landblockId,
		maximumX: origin.x + OUTDOOR_LANDBLOCK_WORLD_SIZE,
		maximumZ: origin.z,
		minimumX: origin.x,
		minimumZ: origin.z - OUTDOOR_LANDBLOCK_WORLD_SIZE,
	};
}

export function createEntityGroundingSelection(): EntityGroundingSelection {
	return {
		count: 0,
		records: new Float32Array(MAX_ENTITY_GROUNDING_CASTERS_PER_RECEIVER * 4),
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
export function selectOutdoorGroundingCasters(
	landblock: OutdoorGroundingLandblock,
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
			caster.reachesOutdoors &&
			horizontalBoundsIntersect(caster.influenceBounds, landblock)
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

/** Retain common-path order, rank only overflow, and write one anchor-relative GPU set. */
function writeGroundingSelection(
	eligible: readonly EntityGroundingCaster[],
	cameraPosition: Vec3,
	anchorOrigin: Vec3,
	out: EntityGroundingSelection,
	nearest: EntityGroundingCaster[],
): EntityGroundingSelection {
	let retained = eligible;
	if (eligible.length > MAX_ENTITY_GROUNDING_CASTERS_PER_RECEIVER) {
		nearest.length = 0;
		for (const caster of eligible) {
			const distance = distanceSquared(caster.contactAnchor, cameraPosition);
			let insertion = 0;
			while (
				insertion < nearest.length &&
				compareCasterDistance(
					nearest[insertion]!,
					caster,
					cameraPosition,
					distance,
				) <= 0
			) {
				insertion += 1;
			}
			if (insertion < MAX_ENTITY_GROUNDING_CASTERS_PER_RECEIVER) {
				nearest.splice(insertion, 0, caster);
				if (nearest.length > MAX_ENTITY_GROUNDING_CASTERS_PER_RECEIVER) {
					nearest.pop();
				}
			}
		}
		retained = nearest;
	}
	out.count = retained.length;
	for (let index = 0; index < retained.length; index += 1) {
		const caster = retained[index]!;
		const offset = index * 4;
		out.records[offset] = caster.contactAnchor.x - anchorOrigin.x;
		out.records[offset + 1] = caster.contactAnchor.y - anchorOrigin.y;
		out.records[offset + 2] = caster.contactAnchor.z - anchorOrigin.z;
		out.records[offset + 3] = caster.radius;
	}
	return out;
}

function compareCasterDistance(
	left: EntityGroundingCaster,
	right: EntityGroundingCaster,
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
	right: OutdoorGroundingLandblock,
): boolean {
	return !(
		left.max.x < right.minimumX ||
		left.min.x > right.maximumX ||
		left.max.z < right.minimumZ ||
		left.min.z > right.maximumZ
	);
}
