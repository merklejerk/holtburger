import type { LandblockOwnerId } from "../game-types";
import type { Frustum } from "../math/frustum";
import type { SceneNodeId } from "../scene";
import type { ObjectInstanceData } from "../systems/static-resources";
import type { GeometryResourceKey } from "./resource-manager";
import type { RenderWorld } from "./render-world";
import { isEntityShadowCasterCategory } from "./entity-shadow-policy";
import { formGroupedObjectInstanceRuns } from "./object-rendering-policy";

const OUTDOOR_SCOPE = [{ kind: "outdoor" }] as const;
const DYNAMIC_CULLING_GROUP = "dynamic";

/** RenderWorld operations needed by one independent outdoor caster query. */
export type OutdoorPssmCasterWorld = Pick<
	RenderWorld,
	| "expandDynamicContributions"
	| "getRenderContributionDescriptor"
	| "queryScopesScene"
	| "resolveDynamicContributions"
>;

/** One visible rigid-part instance admitted to one cascade's material-free depth pass. */
export interface OutdoorPssmCasterPart {
	/** Effective authored face rejection; color/material sampling remains absent. */
	readonly cullFace: "back" | "front";
	readonly geometry: GeometryResourceKey;
	readonly indexCount: number;
	readonly indexStart: number;
	readonly instance: ObjectInstanceData;
	readonly landblockId: LandblockOwnerId;
}

/** One compatible instanced depth submission into the current cascade layer. */
interface OutdoorPssmCasterRun {
	readonly cullFace: "back" | "front";
	readonly firstInstance: number;
	readonly geometry: GeometryResourceKey;
	readonly indexCount: number;
	readonly indexStart: number;
	readonly instanceCount: number;
	readonly landblockId: LandblockOwnerId;
}

/** Caller-owned compact storage repopulated for exactly one cascade. */
export interface OutdoorPssmCasterBatch {
	readonly instances: ObjectInstanceData[];
	readonly parts: OutdoorPssmCasterPart[];
	readonly runs: OutdoorPssmCasterRun[];
}

/** Allocate reusable CPU storage for sequential cascade selection and submission. */
export function createOutdoorPssmCasterBatch(): OutdoorPssmCasterBatch {
	return { instances: [], parts: [], runs: [] };
}

/**
 * Consume one light-frustum query before SceneGraph reuses its entry storage.
 *
 * Category and outdoor-domain checks happen before expansion where possible. A root enters the
 * shared animation-liveness set only after at least one draw-visible outdoor part survives.
 */
export function collectOutdoorPssmCasters(
	world: OutdoorPssmCasterWorld,
	frustum: Frustum,
	anchorLandblockId: LandblockOwnerId,
	selectedDynamicNodeIds: Set<SceneNodeId>,
	batch: OutdoorPssmCasterBatch,
): OutdoorPssmCasterBatch {
	batch.parts.length = 0;
	batch.instances.length = 0;
	batch.runs.length = 0;
	const visible = world.queryScopesScene(
		frustum,
		anchorLandblockId,
		OUTDOOR_SCOPE,
		isDynamicCullingGroup,
	);
	for (const nodeId of visible.entries) {
		const descriptor = world.getRenderContributionDescriptor(nodeId);
		if (
			descriptor?.kind !== "dynamic" ||
			!isEntityShadowCasterCategory(descriptor.category)
		) {
			continue;
		}
		let retainedRoot = false;
		const contributions = world.expandDynamicContributions(nodeId);
		for (const resolved of world.resolveDynamicContributions(contributions)) {
			const contribution = resolved.drawUnit;
			if (!contribution.renderScopes.some(isOutdoorScope)) continue;
			const drawUnit = contribution.drawUnit;
			batch.parts.push({
				cullFace: drawUnit.material.polygon.cullFace,
				geometry: resolved.geometry,
				indexCount: drawUnit.indexCount,
				indexStart: drawUnit.indexStart,
				instance: contribution.instance,
				landblockId: contribution.landblockId,
			});
			retainedRoot = true;
		}
		if (retainedRoot) selectedDynamicNodeIds.add(nodeId);
	}
	formOutdoorPssmCasterRuns(batch);
	return batch;
}

/** Group compatible caster records and flatten their transforms into one contiguous upload. */
export function formOutdoorPssmCasterRuns(
	batch: OutdoorPssmCasterBatch,
): OutdoorPssmCasterBatch {
	batch.instances.length = 0;
	batch.runs.length = 0;
	const submissions = formGroupedObjectInstanceRuns(
		batch.parts,
		() => true,
		casterBatchKey,
		castersAreCompatible,
	);
	for (const submission of submissions) {
		if (submission.kind !== "frame-instance-run") {
			throw new Error(
				"Outdoor caster batching produced a non-instanced submission.",
			);
		}
		const first = submission.values[0];
		const firstInstance = batch.instances.length;
		for (const part of submission.values) batch.instances.push(part.instance);
		batch.runs.push({
			cullFace: first.cullFace,
			firstInstance,
			geometry: first.geometry,
			indexCount: first.indexCount,
			indexStart: first.indexStart,
			instanceCount: submission.values.length,
			landblockId: first.landblockId,
		});
	}
	return batch;
}

function isDynamicCullingGroup(cullingGroup: string): boolean {
	return cullingGroup === DYNAMIC_CULLING_GROUP;
}

function isOutdoorScope(scope: { readonly kind: string }): boolean {
	return scope.kind === "outdoor";
}

function casterBatchKey(caster: OutdoorPssmCasterPart): string {
	return [
		caster.landblockId,
		caster.geometry,
		caster.indexStart,
		caster.indexCount,
		caster.cullFace,
	].join("/");
}

function castersAreCompatible(
	left: OutdoorPssmCasterPart,
	right: OutdoorPssmCasterPart,
): boolean {
	return (
		left.landblockId === right.landblockId &&
		left.geometry === right.geometry &&
		left.indexStart === right.indexStart &&
		left.indexCount === right.indexCount &&
		left.cullFace === right.cullFace
	);
}
