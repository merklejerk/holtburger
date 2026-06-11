import type {
	StaticBakeInput,
	StaticBakeResult,
	StaticBakeTextureUse,
	StaticBakerClient,
	TerrainGeometryStaticDrawUnit,
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

	const drawUnit = createTerrainGeometryDrawUnit(
		input.work.workId,
		input.payload.scope,
		input.atlasSnapshot.revision,
	);
	const textureUses = createTerrainBakeTextureUses(input, drawUnit);

	return {
		atlasRegistryUpdates: [],
		buildRevision: input.payload.sourceRevision,
		drawUnits: [drawUnit],
		staticAuthoredDynamicSeeds: [],
		staticPortalInteriorRecords: [],
		staticSourceMappings: drawUnit.sourceTriangleIds.map(
			(triangleId) => `${drawUnit.drawUnitId}:source:${triangleId}`,
		),
		staticSpatialRecords: [`${drawUnit.drawUnitId}:bounds`],
		staticVisibilityRecords: [],
		textureUses,
		work: input.work,
	};
}

function createTerrainGeometryDrawUnit(
	workId: string,
	payload: TerrainStaticScopePayload,
	placementRevisionAssumption: number,
): TerrainGeometryStaticDrawUnit {
	const positions = new Float32Array(payload.mesh.triangles.length * 9);
	const texCoords = new Float32Array(payload.mesh.triangles.length * 6);
	const sourceTriangleIds: string[] = [];
	const terrainMaterialPlan = buildTerrainMaterialLayerPlan({
		createTextureUseId: (textureUse) =>
			createTerrainTextureUseId(workId, textureUse),
		payload,
	});
	const material = classifyTerrainMaterialFamily({
		domain: "outdoor-terrain",
		placementRevisionAssumption,
		plan: terrainMaterialPlan,
	});

	for (const [triangleIndex, triangle] of payload.mesh.triangles.entries()) {
		writeTrianglePositions(
			positions,
			texCoords,
			triangleIndex,
			triangle,
			payload.mesh.vertices,
		);
		sourceTriangleIds.push(triangle.terrainTriangleId);
	}

	const vertexCount = payload.mesh.triangles.length * 3;

	return {
		coordinateSpace: "landblock-render-local",
		domain: "outdoor-terrain",
		drawUnitId: `${workId}:terrain-geometry`,
		indexType: vertexCount - 1 <= UINT16_MAX_INDEX ? "uint16" : "uint32",
		indices: createSequentialIndices(vertexCount),
		kind: "terrain-geometry",
		landblockId: payload.landblock.landblockId,
		materialBucketKey: material.materialBucketKey,
		materialFamily: material.materialFamily,
		primaryTextureUseId: material.primaryTextureUseId,
		positions,
		sourceTriangleIds,
		terrainFallbackReasons: material.terrainFallbackReasons,
		terrainMaterialPlan,
		texCoords,
		textureUseIds: material.textureUseIds,
		triangleCount: payload.mesh.triangles.length,
		vertexCount,
	};
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
	drawUnit: TerrainGeometryStaticDrawUnit,
): readonly StaticBakeTextureUse[] {
	if (input.payload.scope.kind !== "terrain") {
		return [];
	}

	const boundTextureUseIds = new Set(drawUnit.textureUseIds);
	return input.payload.scope.textureUses.flatMap((textureUse) => {
		if (!textureUse.preparedTextureUse) {
			return [];
		}
		const textureUseId = createTerrainTextureUseId(
			input.work.workId,
			textureUse,
		);
		if (!boundTextureUseIds.has(textureUseId)) {
			return [];
		}

		return [
			{
				domain: "outdoor-terrain",
				ownerDrawUnitIds: [drawUnit.drawUnitId],
				placementRevisionAssumption: input.atlasSnapshot.revision,
				source: textureUse.preparedTextureUse,
				textureUseId,
			},
		];
	});
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
