import type {
	StaticBakeInput,
	StaticBakeResult,
	StaticBakeTextureUse,
	StaticBakerClient,
	TerrainGeometryStaticDrawUnit,
	TerrainMaterialDrawSlice,
	TerrainMaterialFallbackReason,
	TerrainMaterialLayerPlan,
	TerrainMeshTriangleFacts,
	TerrainMeshVertexFacts,
	TerrainStaticScopePayload,
	TerrainTextureUseFacts,
} from "../../contracts";
import { classifyTerrainMaterialFamily } from "./terrain-material-family-classifier";
import { buildTerrainMaterialLayerPlan } from "./terrain-material-layer-planner";

const UINT16_MAX_INDEX = 65_535;

export class TerrainGeometryStaticBaker implements StaticBakerClient {
	async bake(input: StaticBakeInput): Promise<StaticBakeResult> {
		return bakeTerrainGeometry(input);
	}
}

export function bakeTerrainGeometry(input: StaticBakeInput): StaticBakeResult {
	if (
		input.work.job.domain !== "outdoor-terrain" ||
		input.payload.scope.kind !== "terrain"
	) {
		throw new Error(
			`Terrain geometry baker only supports outdoor terrain payloads. Received ${input.work.job.domain}/${input.payload.scope.kind}.`,
		);
	}

	const drawUnits = createTerrainGeometryDrawUnits(
		input.work.workId,
		input.payload.scope,
		input.atlasSnapshot.revision,
	);
	const textureUses = createTerrainBakeTextureUses(input, drawUnits);

	return {
		atlasRegistryUpdates: [],
		buildRevision: input.payload.sourceRevision,
		drawUnits,
		staticAuthoredDynamicSeeds: [],
		staticPortalInteriorRecords: [],
		staticSourceMappings: drawUnits.flatMap((drawUnit) =>
			drawUnit.sourceTriangleIds.map(
				(triangleId) => `${drawUnit.drawUnitId}:source:${triangleId}`,
			),
		),
		staticSpatialRecords: drawUnits.map(
			(drawUnit) => `${drawUnit.drawUnitId}:bounds`,
		),
		staticVisibilityRecords: [],
		textureUses,
		work: input.work,
	};
}

function createTerrainGeometryDrawUnits(
	workId: string,
	payload: TerrainStaticScopePayload,
	placementRevisionAssumption: number,
): readonly TerrainGeometryStaticDrawUnit[] {
	const terrainMaterialPlan = buildTerrainMaterialLayerPlan({
		createTextureUseId: (textureUse) =>
			createTerrainTextureUseId(workId, textureUse),
		payload,
	});
	const slices = createTerrainGeometrySlices(payload, terrainMaterialPlan);

	return slices.map((slice) =>
		createTerrainGeometryDrawUnit({
			drawUnitId:
				slices.length === 1
					? `${workId}:terrain-geometry`
					: `${workId}:terrain-geometry:${slice.slice.sliceId.replaceAll("/", "-")}`,
			landblockId: payload.landblock.landblockId,
			placementRevisionAssumption,
			terrainMaterialPlan: slice.plan,
			triangles: slice.triangles,
			vertices: payload.mesh.vertices,
		}),
	);
}

function createTerrainGeometryDrawUnit({
	drawUnitId,
	landblockId,
	placementRevisionAssumption,
	terrainMaterialPlan,
	triangles,
	vertices,
}: {
	readonly drawUnitId: string;
	readonly landblockId: number;
	readonly placementRevisionAssumption: number;
	readonly terrainMaterialPlan: TerrainMaterialLayerPlan | null;
	readonly triangles: readonly TerrainMeshTriangleFacts[];
	readonly vertices: readonly TerrainMeshVertexFacts[];
}): TerrainGeometryStaticDrawUnit {
	const positions = new Float32Array(triangles.length * 9);
	const texCoords = new Float32Array(triangles.length * 6);
	const sourceTriangleIds: string[] = [];
	const material = classifyTerrainMaterialFamily({
		domain: "outdoor-terrain",
		placementRevisionAssumption,
		plan: terrainMaterialPlan,
	});

	for (const [triangleIndex, triangle] of triangles.entries()) {
		writeTrianglePositions(
			positions,
			texCoords,
			triangleIndex,
			triangle,
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
	positions: Float32Array,
	texCoords: Float32Array,
	triangleIndex: number,
	triangle: TerrainMeshTriangleFacts,
	vertices: readonly TerrainMeshVertexFacts[],
): void {
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
		positions[targetOffset + 1] = vertex.z;
		positions[targetOffset + 2] = -vertex.y;

		const texCoordOffset = triangleIndex * 6 + corner * 2;
		texCoords[texCoordOffset] = vertex.x / 192;
		texCoords[texCoordOffset + 1] = vertex.y / 192;
	}
}

function createTerrainBakeTextureUses(
	input: StaticBakeInput,
	drawUnits: readonly TerrainGeometryStaticDrawUnit[],
): readonly StaticBakeTextureUse[] {
	if (input.payload.scope.kind !== "terrain") {
		return [];
	}

	const textureUsesById = new Map<string, StaticBakeTextureUse>();
	for (const drawUnit of drawUnits) {
		const boundTextureUseIds = new Set(drawUnit.textureUseIds);
		for (const textureUse of input.payload.scope.textureUses) {
			if (!textureUse.preparedTextureUse) {
				continue;
			}
			const textureUseId = createTerrainTextureUseId(
				input.work.workId,
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
				placementRevisionAssumption: input.atlasSnapshot.revision,
				source: textureUse.preparedTextureUse,
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
		textureUse.preparedTextureUse.renderSurfaceId.toString(16).padStart(8, "0"),
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
