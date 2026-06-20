import type {
	StaticBakeBatchInput,
	StaticBakeBatchItem,
	StaticBakeBatchResult,
	StaticBakeTextureUse,
	StaticBaker,
	StaticSourceMappingRecord,
	StaticSpatialRecord,
	TerrainGeometryStaticDrawUnit,
	TerrainMaterialDrawSlice,
	TerrainMaterialFallbackReason,
	TerrainMaterialLayerPlan,
	TerrainMeshQuadFacts,
	TerrainMeshTriangleFacts,
	TerrainMeshVertexFacts,
	TerrainStaticScopePayload,
	TerrainTextureUseFacts,
} from "../../contracts";
import { classifyTerrainMaterialFamily } from "./terrain-material-family-classifier";
import { buildTerrainMaterialLayerPlan } from "./terrain-material-layer-planner";

const UINT16_MAX_INDEX = 65_535;

export class TerrainGeometryStaticBaker implements StaticBaker {
	async bake(input: StaticBakeBatchInput): Promise<StaticBakeBatchResult> {
		return bakeTerrainGeometry(input);
	}
}

export function bakeTerrainGeometry(
	input: StaticBakeBatchInput,
): StaticBakeBatchResult {
	if (input.domain !== "outdoor-terrain") {
		throw new Error(
			`Terrain geometry baker only supports outdoor terrain batches. Received ${input.domain}.`,
		);
	}

	const itemResults = input.items.map((item) =>
		bakeTerrainGeometryItem(input, item),
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
		staticAuthoredDynamicSeeds: [],
		staticPortalGraphs: [],
		staticPortalInteriorRecords: [],
		staticSourceMappings: createTerrainSourceMappingRecords(drawUnits),
		staticSpatialRecords: createTerrainSpatialRecords(drawUnits),
		staticVisibilityRecords: [],
		staticBatchId: input.staticBatchId,
		textureUses: itemResults.flatMap((result) => result.textureUses),
		transitionApertureBatches: [],
		works: input.items.map((item) => item.work),
	};
}

function createTerrainSourceMappingRecords(
	drawUnits: readonly TerrainGeometryStaticDrawUnit[],
): readonly StaticSourceMappingRecord[] {
	return drawUnits.flatMap((drawUnit) =>
		drawUnit.sourceTriangleIds.map((sourceTriangleId) => ({
			drawUnitId: drawUnit.drawUnitId,
			kind: "terrain-source-triangle" as const,
			owner: {
				drawUnitId: drawUnit.drawUnitId,
				kind: "draw-unit" as const,
			},
			sourceTriangleId,
		})),
	);
}

function createTerrainSpatialRecords(
	drawUnits: readonly TerrainGeometryStaticDrawUnit[],
): readonly StaticSpatialRecord[] {
	return drawUnits.map((drawUnit) => ({
		drawUnitId: drawUnit.drawUnitId,
		kind: "draw-unit-bounds",
		owner: {
			drawUnitId: drawUnit.drawUnitId,
			kind: "draw-unit",
		},
		triangleCount: drawUnit.triangleCount,
	}));
}

function bakeTerrainGeometryItem(
	input: StaticBakeBatchInput,
	item: StaticBakeBatchItem,
): {
	readonly drawUnits: readonly TerrainGeometryStaticDrawUnit[];
	readonly textureUses: readonly StaticBakeTextureUse[];
} {
	if (
		item.work.job.domain !== "outdoor-terrain" ||
		item.payload.scope.kind !== "terrain"
	) {
		throw new Error(
			`Terrain geometry baker only supports outdoor terrain payloads. Received ${item.work.job.domain}/${item.payload.scope.kind}.`,
		);
	}

	const drawUnits = createTerrainGeometryDrawUnits(
		item.work.workId,
		item.payload.scope,
		input.staticBatchId,
	);

	return {
		drawUnits,
		textureUses: createTerrainBakeTextureUses(input, item, drawUnits),
	};
}

function createTerrainGeometryDrawUnits(
	workId: string,
	payload: TerrainStaticScopePayload,
	staticBatchId: string,
): readonly TerrainGeometryStaticDrawUnit[] {
	const terrainMaterialPlan = buildTerrainMaterialLayerPlan({
		createTextureUseId: (textureUse) =>
			createTerrainTextureUseId(workId, textureUse),
		payload,
	});
	const slices = createTerrainGeometrySlices(payload, terrainMaterialPlan);
	const pcodeByQuadIndex = new Map(
		payload.mesh.quads.map((quad) => [quad.quadIndex, quad.pcode] as const),
	);
	const quadByIndex = new Map(
		payload.mesh.quads.map((quad) => [quad.quadIndex, quad] as const),
	);

	return slices.map((slice) =>
		createTerrainGeometryDrawUnit({
			drawUnitId:
				slices.length === 1
					? `${workId}:terrain-geometry`
					: `${workId}:terrain-geometry:${slice.slice.sliceId.replaceAll("/", "-")}`,
			landblockId: payload.landblock.landblockId,
			pcodeByQuadIndex,
			quadByIndex,
			staticBatchId,
			terrainMaterialPlan: slice.plan,
			triangles: slice.triangles,
			vertices: payload.mesh.vertices,
		}),
	);
}

function createTerrainGeometryDrawUnit({
	drawUnitId,
	landblockId,
	pcodeByQuadIndex,
	quadByIndex,
	staticBatchId,
	terrainMaterialPlan,
	triangles,
	vertices,
}: {
	readonly drawUnitId: string;
	readonly landblockId: number;
	readonly pcodeByQuadIndex: ReadonlyMap<number, number>;
	readonly quadByIndex: ReadonlyMap<number, TerrainMeshQuadFacts>;
	readonly staticBatchId: string;
	readonly terrainMaterialPlan: TerrainMaterialLayerPlan | null;
	readonly triangles: readonly TerrainMeshTriangleFacts[];
	readonly vertices: readonly TerrainMeshVertexFacts[];
}): TerrainGeometryStaticDrawUnit {
	const positions = new Float32Array(triangles.length * 9);
	const texCoords = new Float32Array(triangles.length * 6);
	const layerSlots = new Float32Array(triangles.length * 3);
	const sourceTriangleIds: string[] = [];
	const material = classifyTerrainMaterialFamily({
		domain: "outdoor-terrain",
		plan: terrainMaterialPlan,
		staticBatchId,
	});
	const layerSlotByPcode = new Map(
		terrainMaterialPlan?.layerEntries.map(
			(entry) => [entry.pcode, entry.slot] as const,
		) ?? [],
	);

	for (const [triangleIndex, triangle] of triangles.entries()) {
		writeTrianglePositions(
			layerSlots,
			positions,
			texCoords,
			layerSlotByPcode.get(pcodeByQuadIndex.get(triangle.quadIndex) ?? 0) ?? 0,
			triangleIndex,
			triangle,
			quadByIndex,
			vertices,
		);
		sourceTriangleIds.push(triangle.terrainTriangleId);
	}

	const vertexCount = triangles.length * 3;

	return {
		coordinateSpace: "landblock-render-local",
		domain: "outdoor-terrain",
		drawUnitId,
		indexType: vertexCount - 1 <= UINT16_MAX_INDEX ? "uint16" : "uint32",
		indices: createSequentialIndices(vertexCount),
		kind: "terrain-geometry",
		landblockId,
		layerSlots,
		materialBucketKey: material.materialBucketKey,
		materialFamily: material.materialFamily,
		primaryTextureUseId: material.primaryTextureUseId,
		positions,
		sourceTriangleIds,
		terrainFallbackReasons: material.terrainFallbackReasons,
		terrainMaterialPlan,
		texCoords,
		textureUseIds: material.textureUseIds,
		triangleCount: triangles.length,
		vertexCount,
	};
}

interface TerrainGeometrySlice {
	readonly plan: TerrainMaterialLayerPlan | null;
	readonly slice: TerrainMaterialDrawSlice;
	readonly triangles: readonly TerrainMeshTriangleFacts[];
}

function createTerrainGeometrySlices(
	payload: TerrainStaticScopePayload,
	plan: TerrainMaterialLayerPlan | null,
): readonly TerrainGeometrySlice[] {
	if (!plan || plan.layerEntries.length === 0 || plan.drawSlices.length === 0) {
		return [
			{
				plan,
				slice: {
					layerSlots: [],
					pcodes: [],
					reason:
						"terrain material unavailable; debug fallback uses full geometry",
					sliceId: "slice/0",
				},
				triangles: payload.mesh.triangles,
			},
		];
	}

	const quadPcodeByIndex = new Map(
		payload.mesh.quads.map((quad) => [quad.quadIndex, quad.pcode] as const),
	);

	return plan.drawSlices.map((slice) => {
		const slicePcodes = new Set(slice.pcodes);
		return {
			plan: createTerrainMaterialSlicePlan(plan, slice),
			slice,
			triangles: payload.mesh.triangles.filter((triangle) => {
				const pcode = quadPcodeByIndex.get(triangle.quadIndex);
				return pcode === undefined ? false : slicePcodes.has(pcode);
			}),
		};
	});
}

function createTerrainMaterialSlicePlan(
	plan: TerrainMaterialLayerPlan,
	slice: TerrainMaterialDrawSlice,
): TerrainMaterialLayerPlan {
	const sliceSlots = new Set(slice.layerSlots);
	const slotRemap = new Map(
		slice.layerSlots.map((slot, localSlot) => [slot, localSlot] as const),
	);
	const layerEntries = plan.layerEntries
		.filter((entry) => sliceSlots.has(entry.slot))
		.map((entry) => ({
			...entry,
			slot: slotRemap.get(entry.slot) ?? entry.slot,
		}));
	const slicePcodes = new Set(layerEntries.map((entry) => entry.pcode));
	const fallbackReasons = plan.fallbackReasons.filter((reason) =>
		isFallbackReasonRelevantToSlice(reason, slicePcodes),
	);

	return {
		detailRoles: plan.detailRoles,
		drawSlices: [
			{
				...slice,
				layerSlots: layerEntries.map((entry) => entry.slot),
				pcodes: layerEntries.map((entry) => entry.pcode),
				reason: `${slice.reason}; geometry partitioned before renderer material binding`,
			},
		],
		fallbackReasons,
		layerEntries,
		signature: `${plan.signature}|geometry-slice:${slice.sliceId}`,
	};
}

function isFallbackReasonRelevantToSlice(
	reason: TerrainMaterialFallbackReason,
	pcodes: ReadonlySet<number>,
): boolean {
	if (reason.code === "layer-overflow") {
		return false;
	}
	if (reason.pcode === null) {
		return true;
	}

	return pcodes.has(reason.pcode);
}

function writeTrianglePositions(
	layerSlots: Float32Array,
	positions: Float32Array,
	texCoords: Float32Array,
	layerSlot: number,
	triangleIndex: number,
	triangle: TerrainMeshTriangleFacts,
	quadByIndex: ReadonlyMap<number, TerrainMeshQuadFacts>,
	vertices: readonly TerrainMeshVertexFacts[],
): void {
	const quad = quadByIndex.get(triangle.quadIndex);
	if (!quad) {
		throw new Error(
			`Terrain triangle ${triangle.terrainTriangleId} references missing quad ${triangle.quadIndex}.`,
		);
	}

	for (let corner = 0; corner < triangle.vertexIndices.length; corner += 1) {
		const sourceVertexIndex = triangle.vertexIndices[corner];
		const vertex = vertices[sourceVertexIndex];
		if (!vertex) {
			throw new Error(
				`Terrain triangle ${triangle.terrainTriangleId} references missing vertex ${sourceVertexIndex}.`,
			);
		}

		const targetOffset = triangleIndex * 9 + corner * 3;
		positions[targetOffset] = vertex.x;
		positions[targetOffset + 1] = vertex.y;
		positions[targetOffset + 2] = vertex.z;

		const texCoordOffset = triangleIndex * 6 + corner * 2;
		const uv = terrainQuadUv(quad, sourceVertexIndex);
		texCoords[texCoordOffset] = uv[0];
		texCoords[texCoordOffset + 1] = uv[1];

		layerSlots[triangleIndex * 3 + corner] = layerSlot;
	}
}

function terrainQuadUv(
	quad: TerrainMeshQuadFacts,
	vertexIndex: number,
): readonly [number, number] {
	const cornerIndex = quad.vertexIndices.indexOf(vertexIndex);
	switch (cornerIndex) {
		case 0:
			return [0, 0];
		case 1:
			return [1, 0];
		case 2:
			return [1, 1];
		case 3:
			return [0, 1];
		default:
			throw new Error(
				`Terrain quad ${quad.terrainQuadId} does not contain vertex ${vertexIndex}.`,
			);
	}
}

function createTerrainBakeTextureUses(
	input: StaticBakeBatchInput,
	item: StaticBakeBatchItem,
	drawUnits: readonly TerrainGeometryStaticDrawUnit[],
): readonly StaticBakeTextureUse[] {
	if (item.payload.scope.kind !== "terrain") {
		return [];
	}

	const textureUsesById = new Map<string, StaticBakeTextureUse>();
	for (const drawUnit of drawUnits) {
		const boundTextureUseIds = new Set(drawUnit.textureUseIds);
		for (const textureUse of item.payload.scope.textureUses) {
			if (!textureUse.preparedTextureUse) {
				continue;
			}
			const textureUseId = createTerrainTextureUseId(
				item.work.workId,
				textureUse,
			);
			if (!boundTextureUseIds.has(textureUseId)) {
				continue;
			}

			const existing = textureUsesById.get(textureUseId);
			if (existing) {
				textureUsesById.set(textureUseId, {
					...existing,
					ownerDrawUnitIds: [...existing.ownerDrawUnitIds, drawUnit.drawUnitId],
				});
				continue;
			}

			textureUsesById.set(textureUseId, {
				domain: "outdoor-terrain",
				ownerDrawUnitIds: [drawUnit.drawUnitId],
				source: textureUse.preparedTextureUse,
				staticBatchId: input.staticBatchId,
				textureUseId,
			});
		}
	}

	return [...textureUsesById.values()];
}

function createTerrainTextureUseId(
	workId: string,
	textureUse: TerrainTextureUseFacts,
): string {
	if (!textureUse.preparedTextureUse) {
		throw new Error("Prepared texture use disappeared during terrain bake.");
	}

	return [
		workId,
		"prepared-texture",
		textureUse.role,
		textureUse.preparedTextureUse.usage,
		textureUse.preparedTextureUse.renderSurface.renderSurfaceId
			.toString(16)
			.padStart(8, "0"),
	].join(":");
}

function createSequentialIndices(
	vertexCount: number,
): Uint16Array | Uint32Array {
	const IndexArray =
		vertexCount - 1 <= UINT16_MAX_INDEX ? Uint16Array : Uint32Array;
	const indices = new IndexArray(vertexCount);

	for (let index = 0; index < vertexCount; index += 1) {
		indices[index] = index;
	}

	return indices;
}
