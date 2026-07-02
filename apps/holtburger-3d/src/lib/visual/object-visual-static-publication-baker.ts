import type {
	StaticMaterialTableEntry,
	StaticObjectGeometryStaticDrawUnit,
	StaticSpatialRecord,
	StructuredInteriorGeometryStaticDrawUnit,
} from "../static/contracts";
import {
	createObjectVisualInstallSet,
	type ObjectVisualInstallSet,
	type ObjectVisualRenderInstance,
	type ObjectVisualResource,
} from "./object-visual-install-set";
import type {
	ObjectVisualBakeResult,
	ObjectVisualBakedRenderPart,
} from "./object-visual-baker";
import type { VisualGeometryPayload } from "./visual-geometry";
import type {
	ObjectVisualPartInstanceIndex,
	ObjectVisualStaticInstancedRenderInstanceMetadata,
	ObjectVisualStaticInstancedResourceGroupMetadata,
	ObjectVisualStaticObjectDirectPublicationMetadata,
	ObjectVisualStaticPublicationMetadata,
	ObjectVisualStructuredInteriorPublicationMetadata,
} from "./object-visual-static-publication";

export interface ObjectVisualStaticPublicationBakeInput {
	readonly bakeResult: ObjectVisualBakeResult;
	readonly metadata: ObjectVisualStaticPublicationMetadata;
}

export function createObjectVisualStaticInstallSet(
	input: ObjectVisualStaticPublicationBakeInput,
): ObjectVisualInstallSet {
	const renderPartsByPartInstanceIndex = createRenderPartsByPartInstanceIndex(
		input.bakeResult.renderParts,
	);
	const directStaticObjectDrawUnits =
		input.metadata.directStaticObjectPublications.flatMap((metadata) =>
			createDirectStaticObjectDrawUnits({
				metadata,
				renderPartsByPartInstanceIndex,
			}),
		);
	const structuredInteriorDrawUnits =
		input.metadata.structuredInteriorPublications.flatMap((metadata) =>
			createStructuredInteriorDrawUnits({
				metadata,
				renderPartsByPartInstanceIndex,
			}),
		);
	const instanced = createInstancedStaticObjectPublications({
		metadata: input.metadata,
		renderPartsByPartInstanceIndex,
	});

	return createObjectVisualInstallSet({
		directDrawUnits: [
			...directStaticObjectDrawUnits,
			...structuredInteriorDrawUnits,
		],
		dynamicAnimationPartBindings: input.bakeResult.animationPartBindings,
		renderInstances: instanced.renderInstances,
		textureDependencies: input.bakeResult.textureDependencies,
		visualResources: instanced.visualResources,
	});
}

function createDirectStaticObjectDrawUnits(options: {
	readonly metadata: ObjectVisualStaticObjectDirectPublicationMetadata;
	readonly renderPartsByPartInstanceIndex: ReadonlyMap<
		ObjectVisualPartInstanceIndex,
		readonly ObjectVisualBakedRenderPart[]
	>;
}): readonly StaticObjectGeometryStaticDrawUnit[] {
	return selectRenderPartsForPartInstances({
		partInstanceIndices: options.metadata.partInstanceIndices,
		renderPartsByPartInstanceIndex: options.renderPartsByPartInstanceIndex,
		subject: `Direct static object publication ${options.metadata.publicationIdSeed}`,
	}).map((renderPart, index) => {
		const drawUnitId = createPartitionedId(
			options.metadata.publicationIdSeed,
			renderPart.renderPartId,
			index,
		);
		return {
			...createStaticDrawUnitPayload(renderPart),
			coordinateSpace: "landblock-render-local",
			domain: options.metadata.domain,
			drawUnitId,
			kind: "static-object-geometry",
			landblockId: options.metadata.landblockId,
			materialBucketKey: renderPart.renderPartId,
			materialIds: createMaterialIds(renderPart.materialEntries),
			ownership: options.metadata.ownership,
			sort: options.metadata.sort,
			sourceMappingCoverage: options.metadata.sourceMappingCoverage,
			spatialRecord: remapDrawUnitSpatialRecord(
				options.metadata.spatialRecord,
				drawUnitId,
			),
		};
	});
}

function createStructuredInteriorDrawUnits(options: {
	readonly metadata: ObjectVisualStructuredInteriorPublicationMetadata;
	readonly renderPartsByPartInstanceIndex: ReadonlyMap<
		ObjectVisualPartInstanceIndex,
		readonly ObjectVisualBakedRenderPart[]
	>;
}): readonly StructuredInteriorGeometryStaticDrawUnit[] {
	return selectRenderPartsForPartInstances({
		partInstanceIndices: options.metadata.partInstanceIndices,
		renderPartsByPartInstanceIndex: options.renderPartsByPartInstanceIndex,
		subject: `Structured interior publication ${options.metadata.publicationIdSeed}`,
	}).map((renderPart, index) => ({
		...createStaticDrawUnitPayload(renderPart),
		cellStructure: options.metadata.cellStructure,
		coordinateSpace: "landblock-render-local",
		domain: "env-cell-system",
		drawUnitId: createPartitionedId(
			options.metadata.publicationIdSeed,
			renderPart.renderPartId,
			index,
		),
		envCellId: options.metadata.envCellId,
		environment: options.metadata.environment,
		kind: "structured-interior-geometry",
		landblockId: options.metadata.landblockId,
		localPlacement: options.metadata.localPlacement,
		materialBucketKey: renderPart.renderPartId,
		materialIds: createMaterialIds(renderPart.materialEntries),
		materialPlan: options.metadata.materialPlan,
		memberId: options.metadata.memberId,
		sourceTriangleIds: options.metadata.sourceTriangleIds,
		surfaceIds: options.metadata.surfaceIds,
	}));
}

function createInstancedStaticObjectPublications(options: {
	readonly metadata: ObjectVisualStaticPublicationMetadata;
	readonly renderPartsByPartInstanceIndex: ReadonlyMap<
		ObjectVisualPartInstanceIndex,
		readonly ObjectVisualBakedRenderPart[]
	>;
}): {
	readonly renderInstances: readonly ObjectVisualRenderInstance[];
	readonly visualResources: readonly ObjectVisualResource[];
} {
	const groupsById = new Map(
		options.metadata.instancedResourceGroups.map((group) => [
			group.groupId,
			group,
		]),
	);
	const visualResources: ObjectVisualResource[] = [];
	const renderInstances: ObjectVisualRenderInstance[] = [];
	const resourceIds = new Set<string>();
	const instancesByGroupId = new Map<
		ObjectVisualStaticInstancedResourceGroupMetadata["groupId"],
		readonly ObjectVisualStaticInstancedRenderInstanceMetadata[]
	>();
	for (const instance of options.metadata.instancedRenderInstances) {
		instancesByGroupId.set(instance.groupId, [
			...(instancesByGroupId.get(instance.groupId) ?? []),
			instance,
		]);
	}

	for (const group of options.metadata.instancedResourceGroups) {
		const groupInstances = instancesByGroupId.get(group.groupId) ?? [];
		if (groupInstances.length === 0) {
			continue;
		}
		const renderParts = selectRenderPartsForPartInstances({
			partInstanceIndices: groupInstances.map(
				(instance) => instance.partInstanceIndex,
			),
			renderPartsByPartInstanceIndex: options.renderPartsByPartInstanceIndex,
			subject: `Static object resource group ${group.resourceIdSeed}`,
		});
		for (const [index, renderPart] of renderParts.entries()) {
			const resourceId = createPartitionedId(
				group.resourceIdSeed,
				renderPart.renderPartId,
				index,
			);
			if (!resourceIds.has(resourceId)) {
				visualResources.push(
					createObjectVisualResource(group, renderPart, resourceId),
				);
				resourceIds.add(resourceId);
			}
			for (const instanceMetadata of groupInstances) {
				if (
					!renderPart.partInstanceIndices.includes(
						instanceMetadata.partInstanceIndex,
					)
				) {
					continue;
				}
				renderInstances.push(
					createObjectVisualRenderInstance(
						instanceMetadata,
						resourceId,
						renderPart,
						index,
					),
				);
			}
		}
	}
	for (const instanceMetadata of options.metadata.instancedRenderInstances) {
		if (!groupsById.has(instanceMetadata.groupId)) {
			throw new Error(
				`Static object render instance ${instanceMetadata.instanceIdSeed} references missing resource group ${instanceMetadata.groupId}.`,
			);
		}
	}
	return { renderInstances, visualResources };
}

function createObjectVisualResource(
	group: ObjectVisualStaticInstancedResourceGroupMetadata,
	renderPart: ObjectVisualBakedRenderPart,
	resourceId: string,
): ObjectVisualResource {
	return {
		...createVisualResourcePayload(renderPart.sourceLocalPayload),
		coordinateSpace: "static-object-source-local",
		geometry: group.geometry,
		key: {
			geometry: group.geometry,
			indexType: renderPart.indexType,
			kind: "static-object-visual-resource-key",
			materialEntries: renderPart.materialEntries,
			materialFamily: renderPart.materialFamily,
			materialPass: renderPart.materialPass,
			renderState: renderPart.renderState,
			textureUseIds: renderPart.textureUseIds,
		},
		kind: "static-object-visual-resource",
		resourceId,
	};
}

function createObjectVisualRenderInstance(
	metadata: ObjectVisualStaticInstancedRenderInstanceMetadata,
	resourceId: string,
	renderPart: ObjectVisualBakedRenderPart,
	index: number,
): ObjectVisualRenderInstance {
	return {
		bounds: metadata.bounds,
		domain: metadata.domain,
		generated: metadata.generated,
		instanceId: createPartitionedId(
			metadata.instanceIdSeed,
			renderPart.renderPartId,
			index,
		),
		kind: "static-object-render-instance",
		landblockId: metadata.landblockId,
		resourceId,
		sortCenter: metadata.sortCenter,
		source: metadata.source,
		sourceToLandblockMatrix: metadata.sourceToLandblockMatrix,
		transform: metadata.transform,
		transparency: createInstancedRenderTransparency(metadata, renderPart),
	};
}

function createInstancedRenderTransparency(
	metadata: ObjectVisualStaticInstancedRenderInstanceMetadata,
	renderPart: ObjectVisualBakedRenderPart,
): ObjectVisualRenderInstance["transparency"] {
	if (
		renderPart.materialPass === "transparent" ||
		renderPart.materialPass === "additive"
	) {
		return {
			kind: "direct-sorted-transparent",
			sortCenter: metadata.sortCenter,
		};
	}
	return metadata.transparency;
}

type StaticObjectVisualPayloadFields = Pick<
	StaticObjectGeometryStaticDrawUnit,
	| "indexType"
	| "indices"
	| "materialEntries"
	| "materialFamily"
	| "materialPass"
	| "materialSlotIndices"
	| "positions"
	| "renderState"
	| "texCoords"
	| "textureUseIds"
	| "triangleCount"
	| "vertexCount"
>;

function createStaticDrawUnitPayload(
	renderPart: ObjectVisualBakedRenderPart,
): StaticObjectVisualPayloadFields {
	return createVisualResourcePayload(renderPart);
}

function createVisualResourcePayload(
	renderPart: VisualGeometryPayload,
): StaticObjectVisualPayloadFields & Pick<ObjectVisualResource, "bounds"> {
	return {
		bounds: renderPart.bounds,
		indexType: renderPart.indexType,
		indices: renderPart.indices,
		materialEntries: renderPart.materialEntries,
		materialFamily: renderPart.materialFamily,
		materialPass: renderPart.materialPass,
		materialSlotIndices: renderPart.materialSlotIndices,
		positions: renderPart.positions,
		renderState: renderPart.renderState,
		texCoords: renderPart.texCoords,
		textureUseIds: renderPart.textureUseIds,
		triangleCount: renderPart.triangleCount,
		vertexCount: renderPart.vertexCount,
	};
}

function createRenderPartsByPartInstanceIndex(
	renderParts: readonly ObjectVisualBakedRenderPart[],
): ReadonlyMap<
	ObjectVisualPartInstanceIndex,
	readonly ObjectVisualBakedRenderPart[]
> {
	const byIndex = new Map<
		ObjectVisualPartInstanceIndex,
		ObjectVisualBakedRenderPart[]
	>();
	for (const renderPart of renderParts) {
		for (const partInstanceIndex of renderPart.partInstanceIndices) {
			const brandedIndex = partInstanceIndex as ObjectVisualPartInstanceIndex;
			const parts = byIndex.get(brandedIndex) ?? [];
			parts.push(renderPart);
			byIndex.set(brandedIndex, parts);
		}
	}
	return byIndex;
}

function selectRenderPartsForPartInstances(options: {
	readonly partInstanceIndices: readonly ObjectVisualPartInstanceIndex[];
	readonly renderPartsByPartInstanceIndex: ReadonlyMap<
		ObjectVisualPartInstanceIndex,
		readonly ObjectVisualBakedRenderPart[]
	>;
	readonly subject: string;
}): readonly ObjectVisualBakedRenderPart[] {
	const renderParts = uniqueRenderParts(
		options.partInstanceIndices.flatMap((partInstanceIndex) => {
			const parts =
				options.renderPartsByPartInstanceIndex.get(partInstanceIndex);
			if (!parts) {
				return [];
			}
			return parts;
		}),
	);
	for (const renderPart of renderParts) {
		const outsideIndices = renderPart.partInstanceIndices.filter(
			(index) =>
				!options.partInstanceIndices.includes(
					index as ObjectVisualPartInstanceIndex,
				),
		);
		if (outsideIndices.length > 0) {
			throw new Error(
				`${options.subject} cannot publish render part ${renderPart.renderPartId} because it also contains part-instance indices ${outsideIndices.join(", ")}.`,
			);
		}
	}
	return renderParts;
}

function uniqueRenderParts(
	renderParts: readonly ObjectVisualBakedRenderPart[],
): readonly ObjectVisualBakedRenderPart[] {
	const byId = new Map(
		renderParts.map((renderPart) => [renderPart.renderPartId, renderPart]),
	);
	return [...byId.values()].sort((left, right) =>
		left.renderPartId.localeCompare(right.renderPartId),
	);
}

function createMaterialIds(
	materialEntries: readonly StaticMaterialTableEntry[],
): readonly number[] {
	return [
		...new Set(materialEntries.flatMap((entry) => entry.materialIds)),
	].sort((left, right) => left - right);
}

function remapDrawUnitSpatialRecord(
	spatialRecord: StaticSpatialRecord | null,
	drawUnitId: string,
): StaticSpatialRecord | null {
	if (!spatialRecord || spatialRecord.kind !== "draw-unit-bounds") {
		return spatialRecord;
	}
	return {
		...spatialRecord,
		drawUnitId,
		owner: {
			drawUnitId,
			kind: "draw-unit",
		},
	};
}

function createPartitionedId(
	seed: string,
	renderPartId: string,
	index: number,
): string {
	return `${seed}:${renderPartId.replaceAll(":", "-")}:${index}`;
}
