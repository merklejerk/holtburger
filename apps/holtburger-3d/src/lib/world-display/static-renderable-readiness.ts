import type {
	PreparedAssetRecord,
	PreparedMaterialRecipePayload,
} from "../assets/types";
import type {
	StaticRenderablePart,
	StaticRenderableSceneModel,
} from "./static-renderables";
import type { RendererAssetReadModel } from "./renderer-asset-read-model";

export type StaticRenderableReadinessStatus =
	| "pending"
	| "resolved"
	| "fallback-resolved"
	| "failed";

export type StaticRenderableReadinessCommitPolicy =
	| "resolved-only"
	| "allow-fallback";

type StaticRenderableDependencyClass =
	| "source"
	| "setup-appearance"
	| "gfx-geometry"
	| "material-plan"
	| "surface-texture";

interface StaticRenderableReadinessRecord {
	key: string;
	status: StaticRenderableReadinessStatus;
	dependencyClass: StaticRenderableDependencyClass;
	part: StaticRenderablePart | null;
	assetId: string | null;
	reason: string;
	committed: boolean;
}

interface StaticRenderableReadinessMetrics {
	pendingCount: number;
	resolvedCount: number;
	fallbackResolvedCount: number;
	failedCount: number;
	committedPartCount: number;
	reasonSamples: string[];
}

export interface StaticRenderableReadinessModel {
	records: StaticRenderableReadinessRecord[];
	committedRecords: StaticRenderableReadinessRecord[];
	committedScene: StaticRenderableSceneModel;
	metrics: StaticRenderableReadinessMetrics;
}

const READINESS_REASON_SAMPLE_LIMIT = 12;

export function deriveStaticRenderableReadinessModel({
	assetReadModel,
	commitPolicy = "resolved-only",
	scene,
}: {
	assetReadModel: RendererAssetReadModel;
	commitPolicy?: StaticRenderableReadinessCommitPolicy;
	scene: StaticRenderableSceneModel;
}): StaticRenderableReadinessModel {
	const records: StaticRenderableReadinessRecord[] = [
		...deriveMissingDependencyRecords(scene),
		...scene.parts.map((part) =>
			derivePartReadinessRecord(assetReadModel, commitPolicy, part),
		),
	];
	const committedObjectKeys = deriveCommittedObjectKeys(scene.parts, records);
	const committedRecords = records.filter(
		(record) =>
			record.committed &&
			record.part !== null &&
			committedObjectKeys.has(staticRenderableObjectKey(record.part)),
	);
	const committedPartKeys = new Set(
		committedRecords
			.map((record) => record.part?.renderKey)
			.filter((renderKey): renderKey is string => renderKey !== undefined),
	);
	const committedScene = filterStaticRenderableSceneParts(
		scene,
		(part) => committedPartKeys.has(part.renderKey),
	);

	return {
		records,
		committedRecords,
		committedScene,
		metrics: deriveReadinessMetrics(records, committedScene.parts.length),
	};
}

function deriveCommittedObjectKeys(
	parts: readonly StaticRenderablePart[],
	records: readonly StaticRenderableReadinessRecord[],
): Set<string> {
	const partsByObjectKey = new Map<string, StaticRenderablePart[]>();
	for (const part of parts) {
		const objectKey = staticRenderableObjectKey(part);
		const objectParts = partsByObjectKey.get(objectKey);
		if (objectParts) {
			objectParts.push(part);
		} else {
			partsByObjectKey.set(objectKey, [part]);
		}
	}

	const committedPartKeys = new Set(
		records
			.filter((record) => record.committed)
			.map((record) => record.part?.renderKey)
			.filter((renderKey): renderKey is string => renderKey !== undefined),
	);
	const committedObjectKeys = new Set<string>();
	for (const [objectKey, objectParts] of partsByObjectKey) {
		if (objectParts.every((part) => committedPartKeys.has(part.renderKey))) {
			committedObjectKeys.add(objectKey);
		}
	}
	return committedObjectKeys;
}

function staticRenderableObjectKey(part: StaticRenderablePart): string {
	return [
		part.renderDomain,
		part.instanceId,
		part.sourceAssetId,
		part.owningLandblockId,
		part.owningEnvCellId ?? "outdoor",
		part.renderChunk.chunkKey,
	].join("|");
}

function deriveMissingDependencyRecords(
	scene: StaticRenderableSceneModel,
): StaticRenderableReadinessRecord[] {
	return [
		...scene.missingSourceAssetIds.map((assetId) =>
			createDependencyRecord({
				status: "pending",
				dependencyClass: "source",
				assetId,
				reason: "source asset is not prepared",
			}),
		),
		...scene.missingGfxAssetIds.map((assetId) =>
			createDependencyRecord({
				status: "pending",
				dependencyClass: "gfx-geometry",
				assetId,
				reason: "gfx geometry asset is not prepared",
			}),
		),
		...scene.missingSetupAppearanceAssetIds.map((assetId) =>
			createDependencyRecord({
				status: "fallback-resolved",
				dependencyClass: "setup-appearance",
				assetId,
				reason:
					"setup appearance is not prepared; base setup model parts remain renderable",
			}),
		),
	];
}

function derivePartReadinessRecord(
	assetReadModel: RendererAssetReadModel,
	commitPolicy: StaticRenderableReadinessCommitPolicy,
	part: StaticRenderablePart,
): StaticRenderableReadinessRecord {
	const gfxAsset = assetReadModel.get(part.gfxObjAssetId);
	if (!isPreparedGfxGeometryAsset(gfxAsset)) {
		return createPartRecord({
			status: "pending",
			dependencyClass: "gfx-geometry",
			commitPolicy,
			part,
			assetId: part.gfxObjAssetId,
			reason: "gfx geometry asset is not prepared",
		});
	}

	if (
		gfxAsset.payload.renderGeometry.vertexCount === 0 ||
		gfxAsset.payload.renderGeometry.triangleCount === 0
	) {
		return createPartRecord({
			status: "failed",
			dependencyClass: "gfx-geometry",
			commitPolicy,
			part,
			assetId: part.gfxObjAssetId,
			reason: "gfx geometry has no renderable triangles",
		});
	}

	const materialFallbackReason = findMaterialFallbackReason(assetReadModel, part);
	if (materialFallbackReason) {
		return createPartRecord({
			status: "fallback-resolved",
			dependencyClass: materialFallbackReason.dependencyClass,
			commitPolicy,
			part,
			assetId: materialFallbackReason.assetId,
			reason: materialFallbackReason.reason,
		});
	}

	return createPartRecord({
		status: "resolved",
		dependencyClass: "gfx-geometry",
		commitPolicy,
		part,
		assetId: part.gfxObjAssetId,
		reason: "all current static renderable dependencies are prepared",
	});
}

function findMaterialFallbackReason(
	assetReadModel: RendererAssetReadModel,
	part: StaticRenderablePart,
):
	| {
			dependencyClass: "material-plan" | "surface-texture";
			assetId: string;
			reason: string;
	  }
	| null {
	for (const slot of part.materialSlots) {
		const materialAsset = assetReadModel.get(slot.materialAssetId);
		if (!isPreparedMaterialRecipeAsset(materialAsset)) {
			return {
				dependencyClass: "material-plan",
				assetId: slot.materialAssetId,
				reason: "material recipe is not prepared; debug fallback material is valid",
			};
		}

		const missingTextureAssetId = [
			...materialAsset.payload.dependencies.surfaceTextureAssetIds,
			...materialAsset.payload.dependencies.renderSurfaceAssetIds,
			...materialAsset.payload.dependencies.paletteAssetIds,
		].find((assetId) => !assetReadModel.has(assetId));
		if (missingTextureAssetId) {
			return {
				dependencyClass: "surface-texture",
				assetId: missingTextureAssetId,
				reason:
					"material texture dependency is not prepared; debug fallback material is valid",
			};
		}
	}

	return null;
}

function createDependencyRecord({
	status,
	dependencyClass,
	assetId,
	reason,
}: {
	status: StaticRenderableReadinessStatus;
	dependencyClass: StaticRenderableDependencyClass;
	assetId: string;
	reason: string;
}): StaticRenderableReadinessRecord {
	return {
		key: `${dependencyClass}/${assetId}`,
		status,
		dependencyClass,
		part: null,
		assetId,
		reason,
		committed: false,
	};
}

function createPartRecord({
	status,
	dependencyClass,
	commitPolicy,
	part,
	assetId,
	reason,
}: {
	status: StaticRenderableReadinessStatus;
	dependencyClass: StaticRenderableDependencyClass;
	commitPolicy: StaticRenderableReadinessCommitPolicy;
	part: StaticRenderablePart;
	assetId: string;
	reason: string;
}): StaticRenderableReadinessRecord {
	return {
		key: `part/${part.renderKey}`,
		status,
		dependencyClass,
		part,
		assetId,
		reason,
		committed: isCommittedStatus(status, commitPolicy),
	};
}

function isCommittedStatus(
	status: StaticRenderableReadinessStatus,
	commitPolicy: StaticRenderableReadinessCommitPolicy,
): boolean {
	return (
		status === "resolved" ||
		(commitPolicy === "allow-fallback" && status === "fallback-resolved")
	);
}

function filterStaticRenderableSceneParts(
	scene: StaticRenderableSceneModel,
	includePart: (part: StaticRenderablePart) => boolean,
): StaticRenderableSceneModel {
	const parts = scene.parts.filter(includePart);
	const partSet = new Set(parts);
	const partsByRenderGroupKey = new Map<string, StaticRenderablePart[]>();
	for (const [groupKey, groupParts] of scene.partsByRenderGroupKey) {
		const committedGroupParts = groupParts.filter((part) => partSet.has(part));
		if (committedGroupParts.length > 0) {
			partsByRenderGroupKey.set(groupKey, committedGroupParts);
		}
	}

	return {
		...scene,
		parts,
		partsByRenderGroupKey,
	};
}

function deriveReadinessMetrics(
	records: readonly StaticRenderableReadinessRecord[],
	committedPartCount: number,
): StaticRenderableReadinessMetrics {
	return {
		pendingCount: records.filter((record) => record.status === "pending")
			.length,
		resolvedCount: records.filter((record) => record.status === "resolved")
			.length,
		fallbackResolvedCount: records.filter(
			(record) => record.status === "fallback-resolved",
		).length,
		failedCount: records.filter((record) => record.status === "failed").length,
		committedPartCount,
		reasonSamples: records
			.filter((record) => record.status !== "resolved")
			.slice(0, READINESS_REASON_SAMPLE_LIMIT)
			.map((record) =>
				record.assetId
					? `${record.dependencyClass}:${record.assetId}: ${record.reason}`
					: `${record.dependencyClass}: ${record.reason}`,
			),
	};
}

function isPreparedGfxGeometryAsset(
	asset: PreparedAssetRecord | null | undefined,
): asset is PreparedAssetRecord & {
	payload: { kind: "gfx-obj"; renderGeometry: { vertexCount: number; triangleCount: number } };
} {
	return asset?.payload.kind === "gfx-obj";
}

function isPreparedMaterialRecipeAsset(
	asset: PreparedAssetRecord | null | undefined,
): asset is PreparedAssetRecord & { payload: PreparedMaterialRecipePayload } {
	return asset?.payload.kind === "material-recipe";
}
