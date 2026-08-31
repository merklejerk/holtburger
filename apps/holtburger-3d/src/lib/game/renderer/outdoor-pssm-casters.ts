import type { LandblockOwnerId } from "../game-types";
import type { Frustum } from "../math/frustum";
import { Mat4 } from "../math/types";
import type { SceneNodeId } from "../scene";
import type { RigidPartDepthDrawUnit } from "../systems/components";
import type { ObjectInstanceData } from "../systems/static-resources";
import type { GeometryResourceKey } from "./resource-manager";
import type { RenderWorld } from "./render-world";
import { isEntityShadowCasterCategory } from "./entity-shadow-policy";
import { retainsRetailGeometry } from "./retail-geometry-visibility";

const OUTDOOR_SCOPE = [{ kind: "outdoor" }] as const;
const DYNAMIC_CULLING_GROUP = "dynamic";
const RELEASED_OBJECT_INSTANCE: ObjectInstanceData = {
	color: { a: 1, b: 1, g: 1, r: 1 },
	sourceToLandblock: Mat4.identity(),
};

/** RenderWorld operations needed by one independent outdoor caster query. */
export type OutdoorPssmCasterWorld = Pick<
	RenderWorld,
	| "expandDynamicContributions"
	| "getRenderContributionDescriptor"
	| "queryScopesScene"
	| "resolveGeometry"
>;

/** One visible rigid-part instance admitted to one cascade's material-free depth pass. */
export interface OutdoorPssmCasterPart {
	/** Effective authored face rejection; color/material sampling remains absent. */
	readonly cullFace: "back" | "front";
	/** Compiled batch partition containing only immutable state consumed by the depth pass. */
	readonly depthBatchKey: string;
	readonly geometry: GeometryResourceKey;
	readonly indexCount: number;
	readonly indexStart: number;
	readonly instance: ObjectInstanceData;
	readonly landblockId: LandblockOwnerId;
}

/** One compatible instanced depth submission into the current cascade layer. */
interface OutdoorPssmCasterRun {
	cullFace: "back" | "front";
	firstInstance: number;
	geometry: GeometryResourceKey;
	indexCount: number;
	indexStart: number;
	instanceCount: number;
	landblockId: LandblockOwnerId;
}

/** Caller-owned compact storage repopulated for exactly one cascade. */
export interface OutdoorPssmCasterBatch {
	readonly instances: ObjectInstanceData[];
	readonly parts: OutdoorPssmCasterPart[];
	readonly runs: OutdoorPssmCasterRun[];
}

/** Reusable frame scratch for consuming reused cascade-query storage into owned membership. */
interface OutdoorPssmCasterSelectionScratch {
	/** Active prefix whose instance references must be released if the next frame shrinks. */
	activeCasterPartCount: number;
	/** Bit `n` means the root was selected by cascade array index `n`. */
	readonly rootCascadeMasks: Map<SceneNodeId, number>;
	/** High-water caster records republished only after the prior frame is fully consumed. */
	readonly casterParts: MutableOutdoorPssmCasterPart[];
}

type MutableOutdoorPssmCasterPart = {
	-readonly [Key in keyof OutdoorPssmCasterPart]: OutdoorPssmCasterPart[Key];
};

interface OutdoorPssmCasterRunGroup {
	first: OutdoorPssmCasterPart | null;
	readonly instances: ObjectInstanceData[];
}

interface OutdoorPssmCasterRunScratch {
	readonly activeGroups: OutdoorPssmCasterRunGroup[];
	readonly groupsByDepthBatchKey: Map<
		string,
		Map<LandblockOwnerId, OutdoorPssmCasterRunGroup>
	>;
	readonly groupPool: OutdoorPssmCasterRunGroup[];
	readonly landblockMapPool: Map<LandblockOwnerId, OutdoorPssmCasterRunGroup>[];
}

const OUTDOOR_PSSM_RUN_SCRATCH = new WeakMap<
	OutdoorPssmCasterBatch,
	OutdoorPssmCasterRunScratch
>();

/** Structural work and retained output produced by one all-cascade selection. */
interface OutdoorPssmCasterCollectionMetrics {
	/** Cascade-frustum queries issued by the collector. */
	readonly cascadeQueryCount: number;
	/** Eligible root selections summed across cascades, including overlap. */
	readonly cascadeSelectedRootCount: number;
	/** Compatible depth runs formed across every cascade. */
	readonly compatibleDepthRunCount: number;
	/** Unique eligible roots expanded after all cascade queries are consumed. */
	readonly uniqueSelectedRootCount: number;
	/** Unique expanded roots that retained at least one outdoor caster part. */
	readonly retainedCasterRootCount: number;
	/** Caster parts retained across cascades, counting one part per intersected cascade. */
	readonly selectedCasterPartCount: number;
}

/** Optional caller-owned profiling sink; absent frames perform no collection accounting. */
type OutdoorPssmCasterCollectionMetricsSink = {
	-readonly [Key in keyof OutdoorPssmCasterCollectionMetrics]: number;
};

interface CompiledOutdoorPssmDepthDraw {
	readonly batchKey: string;
	readonly cullFace: OutdoorPssmCasterPart["cullFace"];
	readonly geometry: GeometryResourceKey;
	readonly indexCount: number;
	readonly indexStart: number;
}

/** Renderer-lifetime owner for material-free depth facts compiled from stable rigid draw units. */
export class OutdoorPssmDepthDrawCatalog {
	#draws = new WeakMap<RigidPartDepthDrawUnit, CompiledOutdoorPssmDepthDraw>();

	resolve(
		world: Pick<OutdoorPssmCasterWorld, "resolveGeometry">,
		drawUnit: RigidPartDepthDrawUnit,
	): CompiledOutdoorPssmDepthDraw {
		const existing = this.#draws.get(drawUnit);
		if (existing !== undefined) return existing;
		const geometry = world.resolveGeometry(drawUnit.geometry);
		const compiled: CompiledOutdoorPssmDepthDraw = {
			batchKey: `${geometry}\0${drawUnit.indexStart}\0${drawUnit.indexCount}\0${drawUnit.cullFace}`,
			cullFace: drawUnit.cullFace,
			geometry,
			indexCount: drawUnit.indexCount,
			indexStart: drawUnit.indexStart,
		};
		this.#draws.set(drawUnit, compiled);
		return compiled;
	}

	clear(): void {
		this.#draws = new WeakMap();
	}
}

/** Allocate reusable CPU storage for sequential cascade selection and submission. */
export function createOutdoorPssmCasterBatch(): OutdoorPssmCasterBatch {
	const batch = { instances: [], parts: [], runs: [] };
	OUTDOOR_PSSM_RUN_SCRATCH.set(batch, {
		activeGroups: [],
		groupsByDepthBatchKey: new Map(),
		groupPool: [],
		landblockMapPool: [],
	});
	return batch;
}

/** Allocate reusable membership scratch owned beside the cascade batches that consume it. */
export function createOutdoorPssmCasterSelectionScratch(): OutdoorPssmCasterSelectionScratch {
	return {
		activeCasterPartCount: 0,
		casterParts: [],
		rootCascadeMasks: new Map(),
	};
}

/**
 * Consume one light-frustum query before SceneGraph reuses its entry storage.
 *
 * Category and outdoor-domain checks happen before expansion where possible. A root enters the
 * shared animation-liveness set only after at least one draw-visible outdoor part survives.
 */
export function collectOutdoorPssmCastersForCascades(
	world: OutdoorPssmCasterWorld,
	cascadeFrusta: readonly Frustum[],
	anchorLandblockId: LandblockOwnerId,
	selectedDynamicNodeIds: Set<SceneNodeId>,
	showRetailHiddenGeometry: boolean,
	batches: readonly OutdoorPssmCasterBatch[],
	scratch: OutdoorPssmCasterSelectionScratch,
	depthDraws: OutdoorPssmDepthDrawCatalog,
	metrics: OutdoorPssmCasterCollectionMetricsSink | null,
): void {
	if (cascadeFrusta.length !== batches.length) {
		throw new Error(
			`Outdoor PSSM received ${cascadeFrusta.length} frusta for ${batches.length} batches.`,
		);
	}
	if (cascadeFrusta.length > 31) {
		throw new Error(
			"Outdoor PSSM supports at most 31 cascade-membership bits.",
		);
	}
	for (const batch of batches) {
		batch.parts.length = 0;
		batch.instances.length = 0;
		batch.runs.length = 0;
	}
	const rootCascadeMasks = scratch.rootCascadeMasks;
	rootCascadeMasks.clear();
	if (metrics !== null) metrics.cascadeQueryCount += cascadeFrusta.length;
	for (
		let cascadeIndex = 0;
		cascadeIndex < cascadeFrusta.length;
		cascadeIndex += 1
	) {
		const frustum = cascadeFrusta[cascadeIndex];
		if (frustum === undefined) {
			throw new Error(`Outdoor PSSM cascade ${cascadeIndex} has no frustum.`);
		}
		const visible = world.queryScopesScene(
			frustum,
			anchorLandblockId,
			OUTDOOR_SCOPE,
			isDynamicCullingGroup,
		);
		const cascadeBit = 1 << cascadeIndex;
		// SceneGraph reuses `entries`, so consume every root before issuing the next query.
		for (const nodeId of visible.entries) {
			rootCascadeMasks.set(
				nodeId,
				(rootCascadeMasks.get(nodeId) ?? 0) | cascadeBit,
			);
		}
	}
	let casterPartCount = 0;
	for (const [nodeId, cascadeMask] of rootCascadeMasks) {
		const descriptor = world.getRenderContributionDescriptor(nodeId);
		if (
			descriptor?.kind !== "dynamic" ||
			!isEntityShadowCasterCategory(descriptor.category)
		) {
			continue;
		}
		if (metrics !== null) {
			metrics.uniqueSelectedRootCount += 1;
			metrics.cascadeSelectedRootCount += countSetBits(cascadeMask);
		}
		let retainedRoot = false;
		const contributions = world.expandDynamicContributions(nodeId, true);
		if (
			contributions.kind === "hidden" ||
			!contributions.renderScopes.some(isOutdoorScope)
		) {
			continue;
		}
		for (const contribution of contributions.depth) {
			if (
				!retainsRetailGeometry(
					contribution.drawUnit.retailVisibility,
					showRetailHiddenGeometry,
				)
			)
				continue;
			const depthDraw = depthDraws.resolve(world, contribution.drawUnit);
			let part = scratch.casterParts[casterPartCount];
			if (part === undefined) {
				part = {
					cullFace: depthDraw.cullFace,
					depthBatchKey: depthDraw.batchKey,
					geometry: depthDraw.geometry,
					indexCount: depthDraw.indexCount,
					indexStart: depthDraw.indexStart,
					instance: contribution.instance,
					landblockId: contributions.landblockId,
				};
				scratch.casterParts.push(part);
			} else {
				part.cullFace = depthDraw.cullFace;
				part.depthBatchKey = depthDraw.batchKey;
				part.geometry = depthDraw.geometry;
				part.indexCount = depthDraw.indexCount;
				part.indexStart = depthDraw.indexStart;
				part.instance = contribution.instance;
				part.landblockId = contributions.landblockId;
			}
			casterPartCount += 1;
			for (
				let cascadeIndex = 0;
				cascadeIndex < batches.length;
				cascadeIndex += 1
			) {
				if ((cascadeMask & (1 << cascadeIndex)) === 0) continue;
				const batch = batches[cascadeIndex];
				if (batch === undefined) {
					throw new Error(`Outdoor PSSM cascade ${cascadeIndex} has no batch.`);
				}
				batch.parts.push(part);
				if (metrics !== null) metrics.selectedCasterPartCount += 1;
			}
			retainedRoot = true;
		}
		if (retainedRoot) {
			selectedDynamicNodeIds.add(nodeId);
			if (metrics !== null) metrics.retainedCasterRootCount += 1;
		}
	}
	for (const batch of batches) {
		formOutdoorPssmCasterRuns(batch);
		if (metrics !== null) {
			metrics.compatibleDepthRunCount += batch.runs.length;
		}
	}
	for (
		let index = casterPartCount;
		index < scratch.activeCasterPartCount;
		index += 1
	) {
		const retired = scratch.casterParts[index];
		if (retired !== undefined) retired.instance = RELEASED_OBJECT_INSTANCE;
	}
	scratch.activeCasterPartCount = casterPartCount;
}

/** Group compatible caster records and flatten their transforms into one contiguous upload. */
export function formOutdoorPssmCasterRuns(
	batch: OutdoorPssmCasterBatch,
): OutdoorPssmCasterBatch {
	const scratch = OUTDOOR_PSSM_RUN_SCRATCH.get(batch);
	if (scratch === undefined) {
		throw new Error(
			"Outdoor PSSM caster batch was not created by its factory.",
		);
	}
	batch.instances.length = 0;
	scratch.activeGroups.length = 0;
	scratch.groupsByDepthBatchKey.clear();
	let usedLandblockMapCount = 0;
	for (const part of batch.parts) {
		let groupsByLandblock = scratch.groupsByDepthBatchKey.get(
			part.depthBatchKey,
		);
		if (groupsByLandblock === undefined) {
			groupsByLandblock = scratch.landblockMapPool[usedLandblockMapCount];
			if (groupsByLandblock === undefined) {
				groupsByLandblock = new Map();
				scratch.landblockMapPool.push(groupsByLandblock);
			} else {
				groupsByLandblock.clear();
			}
			usedLandblockMapCount += 1;
			scratch.groupsByDepthBatchKey.set(part.depthBatchKey, groupsByLandblock);
		}
		let group = groupsByLandblock.get(part.landblockId);
		if (group === undefined) {
			group = scratch.groupPool[scratch.activeGroups.length];
			if (group === undefined) {
				group = { first: part, instances: [] };
				scratch.groupPool.push(group);
			} else {
				group.first = part;
				group.instances.length = 0;
			}
			scratch.activeGroups.push(group);
			groupsByLandblock.set(part.landblockId, group);
		}
		group.instances.push(part.instance);
	}
	let runIndex = 0;
	for (const group of scratch.activeGroups) {
		const first = group.first;
		if (first === null) {
			throw new Error("Outdoor PSSM active run group has no first part.");
		}
		const firstInstance = batch.instances.length;
		for (const instance of group.instances) batch.instances.push(instance);
		let run = batch.runs[runIndex];
		if (run === undefined) {
			run = {
				cullFace: first.cullFace,
				firstInstance,
				geometry: first.geometry,
				indexCount: first.indexCount,
				indexStart: first.indexStart,
				instanceCount: group.instances.length,
				landblockId: first.landblockId,
			};
			batch.runs.push(run);
		} else {
			run.cullFace = first.cullFace;
			run.firstInstance = firstInstance;
			run.geometry = first.geometry;
			run.indexCount = first.indexCount;
			run.indexStart = first.indexStart;
			run.instanceCount = group.instances.length;
			run.landblockId = first.landblockId;
		}
		runIndex += 1;
		group.first = null;
		group.instances.length = 0;
	}
	batch.runs.length = runIndex;
	scratch.activeGroups.length = 0;
	scratch.groupsByDepthBatchKey.clear();
	for (let index = 0; index < usedLandblockMapCount; index += 1) {
		scratch.landblockMapPool[index]?.clear();
	}
	return batch;
}

function isDynamicCullingGroup(cullingGroup: string): boolean {
	return cullingGroup === DYNAMIC_CULLING_GROUP;
}

function isOutdoorScope(scope: { readonly kind: string }): boolean {
	return scope.kind === "outdoor";
}

function countSetBits(value: number): number {
	let remaining = value >>> 0;
	let count = 0;
	while (remaining !== 0) {
		remaining &= remaining - 1;
		count += 1;
	}
	return count;
}
