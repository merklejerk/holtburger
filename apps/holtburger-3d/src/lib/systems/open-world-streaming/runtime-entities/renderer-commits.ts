import type {
	DynamicEntitySummaryDto,
	DynamicEntityRenderResidence,
} from "../../../dynamic/contracts";
import { createDynamicVisualResourceId } from "../../../dynamic/contracts";
import type {
	DynamicRendererInstance,
	DynamicRendererVisualResource,
} from "../../../renderer/types";
import { AC_UNIT_SCALE, buildAcPlacementMatrix, multiplyMat4 } from "../../../math/ac-placement-transform";
import type { PlacementTransformDto } from "../../../host/contracts";

const IDENTITY_DYNAMIC_PART_PLACEMENT: PlacementTransformDto = {
	orientation: { w: 1, x: 0, y: 0, z: 0 },
	origin: { x: 0, y: 0, z: 0 },
};

/** Projects replacement dynamic state into the renderer's direct dynamic resource port. */
export function createDynamicRendererVisualResources(
	record: DynamicEntitySummaryDto,
): readonly DynamicRendererVisualResource[] {
	const visual = record.resources.visual;
	if (visual.status !== "ready") {
		return [];
	}
	return [
		{
			entityId: record.id,
			materialPlan: {
				skipped: [],
				textureUses: visual.textureRequirements.map((requirement) => ({
					bindingId: requirement.bindingId,
					ownerIds: requirement.ownerIds,
					pageClass: requirement.pageClass,
					role: requirement.role,
					samplingPolicy: requirement.samplingPolicy,
					source: requirement.dataUse,
					textureKey: requirement.textureKey,
				})),
			},
			parts: visual.renderParts.map((part) => ({
				bounds: part.bounds,
				indices: part.indices,
				indexType: part.indexType,
				materialEntries: part.materialEntries,
				materialFamily: part.materialFamily,
				materialPass: part.materialPass,
				materialSlotIndices: part.materialSlotIndices,
				partIndex: part.partIndex,
				positions: part.positions,
				renderState: part.renderState,
				renderPartId: part.renderPartId,
				sourceAssetId: part.sourceAssetId,
				texCoords: part.texCoords,
				textureBindingIds: part.textureBindingIds,
				triangleCount: part.triangleCount,
				vertexCount: part.vertexCount,
			})),
			resourceId: createDynamicRendererVisualResourceId(record),
			textureDependencies: visual.textureDependencies,
		},
	];
}

/** Projects ready dynamic records into renderer instances without owning entity lifetime. */
export function createDynamicRendererInstances(
	record: DynamicEntitySummaryDto,
): readonly DynamicRendererInstance[] {
	if (
		record.resources.visual.status !== "ready" ||
		record.renderability.reasons.length > 0 ||
		record.effectiveResidence.kind === "no-residence"
	) {
		return [];
	}
	const partToObjectMatrices = createDynamicPartToObjectMatrices(record);
	if (partToObjectMatrices.length === 0) {
		return [];
	}
	return [
		{
			entityId: record.id,
			instanceId: createDynamicRendererInstanceId(record),
			objectToRenderMatrix: Array.from(createDynamicObjectToRenderMatrix(record)),
			partToObjectMatrices,
			renderResidence: toRendererResidence(record.effectiveResidence),
			resourceId: createDynamicRendererVisualResourceId(record),
		},
	];
}

export function createDynamicRendererVisualResourceId(
	record: Pick<DynamicEntitySummaryDto, "id">,
): string {
	return createDynamicVisualResourceId(record.id);
}

function createDynamicRendererInstanceId(
	record: Pick<DynamicEntitySummaryDto, "id">,
): string {
	return `dynamic-instance:${record.id}`;
}

function createDynamicObjectToRenderMatrix(
	record: DynamicEntitySummaryDto,
): Float32Array {
	const baseMatrix = buildAcPlacementMatrix(
		record.baseTransform.baseLocalPlacement,
		record.baseTransform.sourceScale,
	);
	if (record.animation.playback.status !== "playing") {
		return baseMatrix;
	}
	const playback = record.animation.playback;
	return multiplyMat4(
		multiplyMat4(
			baseMatrix,
			buildAcPlacementMatrix(playback.objectRootPose, AC_UNIT_SCALE),
		),
		buildAcPlacementMatrix(
			createDynamicObjectRootOmegaPlacement(
				playback.transformEffects.activeOmega?.objectRootRotation ?? null,
			),
			AC_UNIT_SCALE,
		),
	);
}

function createDynamicPartToObjectMatrices(
	record: DynamicEntitySummaryDto,
): DynamicRendererInstance["partToObjectMatrices"] {
	if (record.animation.playback.status === "playing") {
		return record.animation.playback.partPoses.map((pose) => ({
			matrix: Array.from(buildAcPlacementMatrix(pose.localPlacement, AC_UNIT_SCALE)),
			partIndex: pose.partIndex,
		}));
	}
	if (record.resources.visual.status !== "ready") {
		return [];
	}
	const sourceAsset = record.resources.visual.sourceAssets[0] ?? null;
	if (sourceAsset === null) {
		return [];
	}
	return record.resources.visual.renderParts.map((part) => {
		const sourcePart = sourceAsset.parts.find(
			(candidate) => candidate.partIndex === part.partIndex,
		);
		const partPlacement =
			sourcePart?.defaultPlacements[0] ?? IDENTITY_DYNAMIC_PART_PLACEMENT;
		return {
			matrix: Array.from(buildAcPlacementMatrix(partPlacement, AC_UNIT_SCALE)),
			partIndex: part.partIndex,
		};
	});
}

function createDynamicObjectRootOmegaPlacement(
	objectRootRotation: PlacementTransformDto["orientation"] | null,
): PlacementTransformDto {
	return {
		orientation: objectRootRotation ?? { w: 1, x: 0, y: 0, z: 0 },
		origin: { x: 0, y: 0, z: 0 },
	};
}

function toRendererResidence(
	residence: Exclude<DynamicEntityRenderResidence, { readonly kind: "no-residence" }>,
): DynamicRendererInstance["renderResidence"] {
	return residence;
}
