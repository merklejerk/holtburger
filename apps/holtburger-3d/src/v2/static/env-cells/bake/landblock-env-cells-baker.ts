import type {
	LandblockEnvCellStaticFacts,
	LandblockEnvCellsStaticScopePayload,
	ScheduledStaticWork,
	StaticAuthoredDynamicSeedRecord,
	StaticBakeBatchInput,
	StaticBakeBatchItem,
	StaticBakeBatchResult,
	StaticBaker,
	StaticDrawUnit,
	EnvCellCellStructureGeometryAttachment,
	StaticPortalInteriorRecord,
	StaticSourceMappingRecord,
	StaticSpatialRecord,
	StructuredInteriorGeometryStaticDrawUnit,
	StaticVisibilityRecord,
	StaticWorkPeerRecordOwner,
} from "../../contracts";
import {
	AC_UNIT_SCALE,
	buildAcPlacementMatrix,
	writeTexCoord,
	writeTransformedPosition,
} from "../../bake/ac-placement-transform";
import {
	createEnvCellCellStructureGeometryIdentity,
	describeEnvCellCellStructureGeometryIdentity,
} from "./landblock-env-cell-geometry-attachments";

export class LandblockEnvCellsBaker implements StaticBaker {
	async bake(input: StaticBakeBatchInput): Promise<StaticBakeBatchResult> {
		return bakeLandblockEnvCells(input);
	}
}

export function bakeLandblockEnvCells(
	input: StaticBakeBatchInput,
): StaticBakeBatchResult {
	if (input.domain !== "landblock-env-cells") {
		throw new Error(
			`Landblock env-cell baker only supports landblock env-cell batches. Received ${input.domain}.`,
		);
	}

	validateGeometryAttachments(input);

	const itemResults = input.items.map((item) =>
		bakeLandblockEnvCellItem(input, item),
	);
	const drawUnits = itemResults.flatMap((result) => result.drawUnits);

	return {
		atlasRegistryUpdates: [],
		buildRevision: Math.max(
			...input.items.map((item) => item.payload.sourceRevision),
			0,
		),
		domain: input.domain,
		drawUnits,
		materialCoverage: [],
		revision: input.revision,
		staticAuthoredDynamicSeeds: itemResults.flatMap(
			(result) => result.staticAuthoredDynamicSeeds,
		),
		staticBatchId: input.staticBatchId,
		staticPortalInteriorRecords: itemResults.flatMap(
			(result) => result.staticPortalInteriorRecords,
		),
		staticSourceMappings: itemResults.flatMap(
			(result) => result.staticSourceMappings,
		),
		staticSpatialRecords: itemResults.flatMap(
			(result) => result.staticSpatialRecords,
		),
		staticVisibilityRecords: itemResults.flatMap(
			(result) => result.staticVisibilityRecords,
		),
		textureUses: [],
		works: input.items.map((item) => item.work),
	};
}

function validateGeometryAttachments(input: StaticBakeBatchInput): void {
	for (const item of input.items) {
		if (item.payload.scope.kind !== "landblock-env-cells") {
			continue;
		}

		for (const envCell of item.payload.scope.envCells) {
			if (envCell.renderGeometry.triangleCount === 0) {
				continue;
			}

			const identity = createEnvCellCellStructureGeometryIdentity({ envCell });
			const identityKey =
				describeEnvCellCellStructureGeometryIdentity(identity);
			const attachment = input.attachments.envCellCellStructureGeometry.find(
				(candidate) =>
					describeEnvCellCellStructureGeometryIdentity(candidate.identity) ===
					identityKey,
			);
			if (!attachment) {
				throw new Error(
					`Missing env-cell cell-structure geometry attachment ${identityKey}.`,
				);
			}

			if (
				attachment.sourceId !== envCell.renderGeometry.sourceId ||
				attachment.vertexCount !== envCell.renderGeometry.vertexCount ||
				attachment.triangleCount !== envCell.renderGeometry.triangleCount
			) {
				throw new Error(
					`Stale env-cell cell-structure geometry attachment ${identityKey}; source/count metadata does not match resolver facts.`,
				);
			}
		}
	}
}

function bakeLandblockEnvCellItem(
	input: StaticBakeBatchInput,
	item: StaticBakeBatchItem,
): {
	readonly drawUnits: readonly StaticDrawUnit[];
	readonly staticAuthoredDynamicSeeds: readonly StaticAuthoredDynamicSeedRecord[];
	readonly staticPortalInteriorRecords: readonly StaticPortalInteriorRecord[];
	readonly staticSourceMappings: readonly StaticSourceMappingRecord[];
	readonly staticSpatialRecords: readonly StaticSpatialRecord[];
	readonly staticVisibilityRecords: readonly StaticVisibilityRecord[];
} {
	if (
		item.work.job.domain !== "landblock-env-cells" ||
		item.payload.scope.kind !== "landblock-env-cells"
	) {
		throw new Error(
			`Landblock env-cell baker only supports landblock env-cell payloads. Received ${item.work.job.domain}/${item.payload.scope.kind}.`,
		);
	}

	const owner = createWorkPeerRecordOwner(item.work);
	const payload = item.payload.scope;

	return {
		drawUnits: createStructuredInteriorDrawUnits(input, item.work, payload),
		staticAuthoredDynamicSeeds: createAuthoredDynamicSeedRecords(owner, payload),
		staticPortalInteriorRecords: [createPortalInteriorRecord(owner, payload)],
		staticSourceMappings: createSourceMappingRecords(owner, payload),
		staticSpatialRecords: createSpatialRecords(owner, payload),
		staticVisibilityRecords: [createVisibilityRecord(owner, payload)],
	};
}

function createStructuredInteriorDrawUnits(
	input: StaticBakeBatchInput,
	work: ScheduledStaticWork,
	payload: LandblockEnvCellsStaticScopePayload,
): readonly StructuredInteriorGeometryStaticDrawUnit[] {
	return payload.envCells.flatMap((envCell) => {
		if (envCell.renderGeometry.triangleCount === 0) {
			return [];
		}

		const attachment = requireGeometryAttachment(input, envCell);
		return [
			createStructuredInteriorDrawUnit({
				attachment,
				envCell,
				landblockId: payload.landblock.landblockId,
				work,
			}),
		];
	});
}

function createStructuredInteriorDrawUnit(options: {
	readonly attachment: EnvCellCellStructureGeometryAttachment;
	readonly envCell: LandblockEnvCellStaticFacts;
	readonly landblockId: number;
	readonly work: ScheduledStaticWork;
}): StructuredInteriorGeometryStaticDrawUnit {
	const geometry = bakeCellStructureGeometry(
		options.envCell,
		options.attachment,
	);
	const materialIds = uniqueSortedNumbers(
		options.envCell.surfaces.map((surface) => surface.material.materialId),
	);

	return {
		cellStructure: options.envCell.cellStructure,
		coordinateSpace: "landblock-render-local",
		debugColor: createDebugColor(options.envCell.identity.envCellId),
		domain: "landblock-env-cells",
		drawUnitId: createStructuredInteriorDrawUnitId(options.work, options.envCell),
		envCellId: options.envCell.identity.envCellId,
		environment: options.envCell.environment,
		indexType: geometry.indices instanceof Uint16Array ? "uint16" : "uint32",
		indices: geometry.indices,
		kind: "structured-interior-geometry",
		landblockId: options.landblockId,
		localPlacement: options.envCell.localPlacement,
		materialBucketKey: "structured-interior-debug-flat",
		materialFamily: "structured-interior-debug-flat",
		materialIds,
		memberId: options.envCell.memberId,
		positions: geometry.positions,
		sourceTriangleIds: geometry.sourceTriangleIds,
		surfaceIds: uniqueSortedNumbers(options.attachment.surfaceIds),
		texCoords: geometry.texCoords,
		textureUseIds: [],
		triangleCount: options.attachment.triangleCount,
		vertexCount: options.attachment.vertexCount,
	};
}

function bakeCellStructureGeometry(
	envCell: LandblockEnvCellStaticFacts,
	attachment: EnvCellCellStructureGeometryAttachment,
): {
	readonly positions: Float32Array;
	readonly texCoords: Float32Array;
	readonly indices: Uint16Array | Uint32Array;
	readonly sourceTriangleIds: readonly string[];
} {
	if (
		attachment.triangleCount > 0 &&
		attachment.triangles.length !== attachment.triangleCount
	) {
		throw new Error(
			`Env-cell cell-structure geometry ${describeEnvCellCellStructureGeometryIdentity(
				attachment.identity,
			)} expected ${attachment.triangleCount} triangle metadata records, got ${attachment.triangles.length}.`,
		);
	}

	const matrix = buildAcPlacementMatrix(envCell.localPlacement, AC_UNIT_SCALE);
	const positions = new Float32Array(attachment.vertexCount * 3);
	const texCoords = new Float32Array(attachment.vertexCount * 2);
	for (
		let vertexIndex = 0;
		vertexIndex < attachment.vertexCount;
		vertexIndex += 1
	) {
		writeTransformedPosition({
			matrix,
			positions,
			source: attachment.positions,
			sourceVertexIndex: vertexIndex,
			targetVertexIndex: vertexIndex,
		});
		writeTexCoord({
			source: attachment.uvs,
			sourceVertexIndex: vertexIndex,
			target: texCoords,
			targetVertexIndex: vertexIndex,
		});
	}

	return {
		indices: createTriangleIndices(attachment),
		positions,
		sourceTriangleIds: attachment.triangles.map(createSourceTriangleId),
		texCoords,
	};
}

function createTriangleIndices(
	attachment: EnvCellCellStructureGeometryAttachment,
): Uint16Array | Uint32Array {
	const indices = createIndexArray(attachment.vertexCount, attachment.triangleCount * 3);
	for (const [triangleIndex, triangle] of attachment.triangles.entries()) {
		const firstVertex = triangle.firstVertex;
		if (firstVertex + 2 >= attachment.vertexCount) {
			throw new Error(
				`Env-cell cell-structure geometry ${describeEnvCellCellStructureGeometryIdentity(
					attachment.identity,
				)} triangle ${triangleIndex} references vertex ${firstVertex + 2}, but attachment has ${attachment.vertexCount} vertices.`,
			);
		}
		const offset = triangleIndex * 3;
		indices[offset] = firstVertex;
		indices[offset + 1] = firstVertex + 1;
		indices[offset + 2] = firstVertex + 2;
	}

	return indices;
}

function createIndexArray(
	vertexCount: number,
	indexCount: number,
): Uint16Array | Uint32Array {
	return vertexCount <= 0xffff
		? new Uint16Array(indexCount)
		: new Uint32Array(indexCount);
}

function createSourceTriangleId(
	triangle: EnvCellCellStructureGeometryAttachment["triangles"][number],
): string {
	return [
		`polygon:${triangle.polygonId}`,
		`surface:${triangle.surfaceId ?? "none"}`,
		`first:${triangle.firstVertex}`,
		`variant:${triangle.materialVariantSignature ?? "none"}`,
	].join("|");
}

function requireGeometryAttachment(
	input: StaticBakeBatchInput,
	envCell: LandblockEnvCellStaticFacts,
): EnvCellCellStructureGeometryAttachment {
	const identity = createEnvCellCellStructureGeometryIdentity({ envCell });
	const identityKey = describeEnvCellCellStructureGeometryIdentity(identity);
	const attachment = input.attachments.envCellCellStructureGeometry.find(
		(candidate) =>
			describeEnvCellCellStructureGeometryIdentity(candidate.identity) ===
			identityKey,
	);
	if (!attachment) {
		throw new Error(
			`Missing env-cell cell-structure geometry attachment ${identityKey}.`,
		);
	}

	return attachment;
}

function createStructuredInteriorDrawUnitId(
	work: ScheduledStaticWork,
	envCell: LandblockEnvCellStaticFacts,
): string {
	return [
		work.workId,
		"structured-interior",
		formatHex32(envCell.identity.envCellId),
		formatHex32(envCell.cellStructure.cellStructureId),
	].join(":");
}

function createDebugColor(
	envCellId: number,
): readonly [number, number, number, number] {
	const hue = (envCellId >>> 0) % 3;
	if (hue === 0) {
		return [0.42, 0.72, 1, 1];
	}
	if (hue === 1) {
		return [0.52, 0.86, 0.56, 1];
	}
	return [0.95, 0.68, 0.36, 1];
}

function uniqueSortedNumbers(values: readonly number[]): readonly number[] {
	return [...new Set(values)].sort((left, right) => left - right);
}

function createSpatialRecords(
	owner: StaticWorkPeerRecordOwner,
	payload: LandblockEnvCellsStaticScopePayload,
): readonly StaticSpatialRecord[] {
	return payload.envCells.map((envCell) => ({
		cellStructure: envCell.cellStructure,
		envCellId: envCell.identity.envCellId,
		environment: envCell.environment,
		kind: "env-cell-spatial",
		landblockId: payload.landblock.landblockId,
		localBvhItemCount: envCell.localSpatial.localBvhItemCount,
		localBvhNodeCount: envCell.localSpatial.localBvhNodeCount,
		memberId: envCell.memberId,
		owner,
		renderBounds: envCell.renderGeometry.bounds,
		residencyBvhItemCount:
			payload.residencySpatial.landblockEnvCellBvhItemCount,
		residencyBvhNodeCount:
			payload.residencySpatial.landblockEnvCellBvhNodeCount,
	}));
}

function createVisibilityRecord(
	owner: StaticWorkPeerRecordOwner,
	payload: LandblockEnvCellsStaticScopePayload,
): StaticVisibilityRecord {
	return {
		acceptedEnvCellIds: payload.acceptedEnvCellIds,
		diagnostics: payload.visibilityDiagnostics,
		kind: "env-cell-visibility",
		landblockId: payload.landblock.landblockId,
		owner,
		visibleLinks: payload.envCells.flatMap((envCell) =>
			envCell.visibleEnvCellIds.map((targetEnvCellId) => ({
				sourceEnvCellId: envCell.identity.envCellId,
				targetEnvCellId,
			})),
		),
	};
}

function createPortalInteriorRecord(
	owner: StaticWorkPeerRecordOwner,
	payload: LandblockEnvCellsStaticScopePayload,
): StaticPortalInteriorRecord {
	return {
		envCells: payload.envCells.map((envCell) => ({
			envCellId: envCell.identity.envCellId,
			portalApertures: envCell.portalApertures,
			portals: envCell.portals,
		})),
		kind: "env-cell-portal-interior",
		landblockId: payload.landblock.landblockId,
		owner,
		portalLinks: payload.portalLinks,
	};
}

function createSourceMappingRecords(
	owner: StaticWorkPeerRecordOwner,
	payload: LandblockEnvCellsStaticScopePayload,
): readonly StaticSourceMappingRecord[] {
	return payload.envCells.map((envCell) => ({
		cellStructure: envCell.cellStructure,
		envCellId: envCell.identity.envCellId,
		environment: envCell.environment,
		kind: "env-cell-source",
		landblockId: payload.landblock.landblockId,
		memberId: envCell.memberId,
		owner,
		surfaces: envCell.surfaces,
	}));
}

function createAuthoredDynamicSeedRecords(
	owner: StaticWorkPeerRecordOwner,
	payload: LandblockEnvCellsStaticScopePayload,
): readonly StaticAuthoredDynamicSeedRecord[] {
	return payload.envCells.flatMap((envCell) =>
		envCell.staticObjectSeeds.map((seed) =>
			createAuthoredDynamicSeedRecord(owner, payload, envCell, seed),
		),
	);
}

function createAuthoredDynamicSeedRecord(
	owner: StaticWorkPeerRecordOwner,
	payload: LandblockEnvCellsStaticScopePayload,
	envCell: LandblockEnvCellStaticFacts,
	seed: LandblockEnvCellStaticFacts["staticObjectSeeds"][number],
): StaticAuthoredDynamicSeedRecord {
	return {
		envCellId: envCell.identity.envCellId,
		kind: "env-cell-static-object-seed",
		landblockId: payload.landblock.landblockId,
		owner,
		seed,
	};
}

function createWorkPeerRecordOwner(
	work: ScheduledStaticWork,
): StaticWorkPeerRecordOwner {
	return {
		domain: work.job.domain,
		kind: "work",
		scope: work.job.scope,
		scopeKey: describeStaticScopeKey(work.job.scope),
		workId: work.workId,
	};
}

function describeStaticScopeKey(scope: ScheduledStaticWork["job"]["scope"]): string {
	return `landblock:${formatHex32(scope.landblockId)}`;
}

function formatHex32(value: number): string {
	return (value >>> 0).toString(16).padStart(8, "0");
}
