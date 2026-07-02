import type {
	StaticLayerPeerRecordOwner,
	StaticObjectDrawUnitOwnership,
	StaticObjectGeometryStaticDrawUnit,
	StaticObjectRenderInstance,
	StaticObjectSourceGeometryIdentity,
	StaticObjectSortMetadata,
	StaticObjectSourceMappingCoverage,
	StaticSpatialRecord,
	StructuredInteriorMaterialPlanEntry,
	StructuredInteriorGeometryStaticDrawUnit,
} from "../static/contracts";

type Brand<TValue, TBrand extends string> = TValue & {
	readonly __brand: TBrand;
};

export type ObjectVisualPartInstanceIndex = Brand<
	number,
	"ObjectVisualPartInstanceIndex"
>;
export type ObjectVisualStaticResourceGroupId = Brand<
	number,
	"ObjectVisualStaticResourceGroupId"
>;

export interface ObjectVisualStaticPublicationMetadata {
	/** Direct, non-instanced static object draw-unit publication facts. */
	readonly directStaticObjectDrawUnits: readonly ObjectVisualStaticObjectDirectDrawUnitMetadata[];
	/** Reusable static object resource groups evaluated after renderer-legal partitioning. */
	readonly instancedResourceGroups: readonly ObjectVisualStaticInstancedResourceGroupMetadata[];
	/** Static object render-instance facts for reusable resource publication. */
	readonly instancedRenderInstances: readonly ObjectVisualStaticInstancedRenderInstanceMetadata[];
	/** Direct structured-interior draw-unit publication facts. */
	readonly structuredInteriorDrawUnits: readonly ObjectVisualStructuredInteriorDirectDrawUnitMetadata[];
	/** Ownership/residency links for non-visual sidecars kept outside the visual recipe graph. */
	readonly sidecarResidencies: readonly ObjectVisualStaticSidecarResidencyMetadata[];
}

export interface ObjectVisualStaticObjectDirectDrawUnitMetadata {
	readonly domain: StaticObjectGeometryStaticDrawUnit["domain"];
	/** Stable id seed used when a partition becomes a direct draw unit. */
	readonly drawUnitIdSeed: string;
	readonly kind: "static-object-direct-draw-unit";
	readonly landblockId: number;
	readonly ownership: StaticObjectDrawUnitOwnership;
	/** Part instances contributing primitives to this publication candidate. */
	readonly partInstanceIndices: readonly ObjectVisualPartInstanceIndex[];
	readonly sort: StaticObjectSortMetadata;
	/** Source coverage remains visual metadata; source-mapping records remain sidecars. */
	readonly sourceMappingCoverage: readonly StaticObjectSourceMappingCoverage[];
	/** Optional renderer-side spatial record for direct draw units. */
	readonly spatialRecord: StaticSpatialRecord | null;
}

export interface ObjectVisualStaticInstancedResourceGroupMetadata {
	readonly geometry: StaticObjectSourceGeometryIdentity;
	/** Stable group id referenced by render instances without string joins. */
	readonly groupId: ObjectVisualStaticResourceGroupId;
	readonly kind: "static-object-instanced-resource-group";
	/** Human-readable seed retained for diagnostics and resource id construction. */
	readonly resourceIdSeed: string;
	/** Minimum profitable instance count for this resource group. */
	readonly minimumInstanceCount: number;
	/** Transparent/additive groups need explicit opt-in because sort anchors can block reuse. */
	readonly transparentReuseAllowed: boolean;
}

export interface ObjectVisualStaticInstancedRenderInstanceMetadata {
	readonly bounds: StaticObjectRenderInstance["bounds"];
	readonly domain: StaticObjectRenderInstance["domain"];
	readonly generated: StaticObjectRenderInstance["generated"];
	readonly groupId: ObjectVisualStaticResourceGroupId;
	readonly instanceIdSeed: string;
	readonly kind: "static-object-instanced-render-instance";
	readonly landblockId: number;
	readonly partInstanceIndex: ObjectVisualPartInstanceIndex;
	readonly sortCenter: StaticObjectRenderInstance["sortCenter"];
	readonly source: StaticObjectRenderInstance["source"];
	readonly sourceToLandblockMatrix: StaticObjectRenderInstance["sourceToLandblockMatrix"];
	readonly transform: StaticObjectRenderInstance["transform"];
	readonly transparency: StaticObjectRenderInstance["transparency"];
}

export interface ObjectVisualStructuredInteriorDirectDrawUnitMetadata {
	readonly cellStructure: StructuredInteriorGeometryStaticDrawUnit["cellStructure"];
	readonly drawUnitIdSeed: string;
	readonly envCellId: number;
	readonly environment: StructuredInteriorGeometryStaticDrawUnit["environment"];
	readonly kind: "structured-interior-direct-draw-unit";
	readonly landblockId: number;
	readonly localPlacement: StructuredInteriorGeometryStaticDrawUnit["localPlacement"];
	readonly materialPlan: readonly StructuredInteriorMaterialPlanEntry[];
	readonly memberId: string;
	readonly partInstanceIndices: readonly ObjectVisualPartInstanceIndex[];
	readonly sourceTriangleIds: readonly string[];
	readonly surfaceIds: readonly number[];
}

type ObjectVisualStaticSidecarKind =
	| "portal"
	| "source-mapping"
	| "spatial"
	| "visibility";

export interface ObjectVisualStaticSidecarResidencyMetadata {
	readonly envCellId: number | null;
	readonly kind: "static-sidecar-residency";
	readonly landblockId: number;
	readonly owner: StaticLayerPeerRecordOwner;
	readonly partInstanceIndices: readonly ObjectVisualPartInstanceIndex[];
	readonly sidecarKind: ObjectVisualStaticSidecarKind;
}

export function createObjectVisualPartInstanceIndex(
	value: number,
): ObjectVisualPartInstanceIndex {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new Error(
			`Object visual part-instance indices must be safe non-negative integers: ${value}.`,
		);
	}
	return value as ObjectVisualPartInstanceIndex;
}

export function createObjectVisualStaticResourceGroupId(
	value: number,
): ObjectVisualStaticResourceGroupId {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new Error(
			`Object visual static resource group ids must be safe non-negative integers: ${value}.`,
		);
	}
	return value as ObjectVisualStaticResourceGroupId;
}

export function createObjectVisualStaticPublicationMetadata(input: {
	readonly directStaticObjectDrawUnits?: readonly ObjectVisualStaticObjectDirectDrawUnitMetadata[];
	readonly instancedRenderInstances?: readonly ObjectVisualStaticInstancedRenderInstanceMetadata[];
	readonly instancedResourceGroups?: readonly ObjectVisualStaticInstancedResourceGroupMetadata[];
	readonly partInstanceCount: number;
	readonly sidecarResidencies?: readonly ObjectVisualStaticSidecarResidencyMetadata[];
	readonly structuredInteriorDrawUnits?: readonly ObjectVisualStructuredInteriorDirectDrawUnitMetadata[];
}): ObjectVisualStaticPublicationMetadata {
	if (
		!Number.isSafeInteger(input.partInstanceCount) ||
		input.partInstanceCount < 0
	) {
		throw new Error(
			`Object visual static publication metadata requires a safe non-negative part-instance count: ${input.partInstanceCount}.`,
		);
	}
	const metadata: ObjectVisualStaticPublicationMetadata = {
		directStaticObjectDrawUnits: input.directStaticObjectDrawUnits ?? [],
		instancedRenderInstances: input.instancedRenderInstances ?? [],
		instancedResourceGroups: input.instancedResourceGroups ?? [],
		sidecarResidencies: input.sidecarResidencies ?? [],
		structuredInteriorDrawUnits: input.structuredInteriorDrawUnits ?? [],
	};
	const resourceGroupIds = new Set(
		metadata.instancedResourceGroups.map((group) => group.groupId),
	);

	for (const drawUnit of metadata.directStaticObjectDrawUnits) {
		assertNonEmptyPartInstanceIndices(
			drawUnit.partInstanceIndices,
			`Direct static object draw unit ${drawUnit.drawUnitIdSeed}`,
		);
		assertPartInstanceIndicesInRange(
			drawUnit.partInstanceIndices,
			input.partInstanceCount,
			`Direct static object draw unit ${drawUnit.drawUnitIdSeed}`,
		);
	}
	for (const drawUnit of metadata.structuredInteriorDrawUnits) {
		assertNonEmptyPartInstanceIndices(
			drawUnit.partInstanceIndices,
			`Structured interior draw unit ${drawUnit.drawUnitIdSeed}`,
		);
		assertPartInstanceIndicesInRange(
			drawUnit.partInstanceIndices,
			input.partInstanceCount,
			`Structured interior draw unit ${drawUnit.drawUnitIdSeed}`,
		);
	}
	for (const instance of metadata.instancedRenderInstances) {
		assertPartInstanceIndicesInRange(
			[instance.partInstanceIndex],
			input.partInstanceCount,
			`Static object render instance ${instance.instanceIdSeed}`,
		);
		if (!resourceGroupIds.has(instance.groupId)) {
			throw new Error(
				`Static object render instance ${instance.instanceIdSeed} references missing resource group ${instance.groupId}.`,
			);
		}
	}
	for (const sidecar of metadata.sidecarResidencies) {
		assertPartInstanceIndicesInRange(
			sidecar.partInstanceIndices,
			input.partInstanceCount,
			`Static sidecar ${sidecar.sidecarKind}`,
		);
	}

	return metadata;
}

function assertNonEmptyPartInstanceIndices(
	indices: readonly ObjectVisualPartInstanceIndex[],
	subject: string,
): void {
	if (indices.length === 0) {
		throw new Error(`${subject} must reference at least one part instance.`);
	}
}

function assertPartInstanceIndicesInRange(
	indices: readonly ObjectVisualPartInstanceIndex[],
	partInstanceCount: number,
	subject: string,
): void {
	for (const index of indices) {
		if (index >= partInstanceCount) {
			throw new Error(
				`${subject} references part-instance index ${index}, but only ${partInstanceCount} part instances exist.`,
			);
		}
	}
}
