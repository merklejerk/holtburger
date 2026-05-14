import type {
	AppearanceManifestPayloadDto,
	AssetErrorCode,
	AssetLookupRequestDto,
	AssetLookupResponseDto,
	DependencyManifestPayloadDto,
	EnvironmentPayloadDto,
	GfxObjPayloadDto,
	IndoorEnvCellPayloadDto,
	OutdoorStaticScenePayloadDto,
	SetupModelPayloadDto,
	TerrainLandblockPayloadDto,
} from "../lib/host/contracts";
import {
	appearanceManifestPayloadDtoSchema,
	assetProvenanceDtoSchema,
	dependencyManifestPayloadDtoSchema,
	environmentPayloadDtoSchema,
	genericAssetPayloadDtoSchema,
	gfxObjPayloadDtoSchema,
	indoorEnvCellPayloadDtoSchema,
	outdoorStaticScenePayloadDtoSchema,
	setupModelPayloadDtoSchema,
	terrainLandblockPayloadDtoSchema,
} from "../lib/host/contracts";
import type {
	AssetResidencyKind,
	PreparedAssetRecord,
	PreparedAssetProvenance,
	PreparedAssetPayload,
	PreparedPolygonSetRenderGeometry,
	PreparedTerrainMesh,
	PreparedTerrainTriangle,
} from "../lib/assets/types";
import { formatHex32 } from "../lib/landblocks";

export interface AssetWorkerPrepareRequest {
	type: "prepare-asset";
	request: AssetLookupRequestDto;
	response: AssetLookupResponseDto;
}

export interface AssetWorkerReadyMessage {
	type: "asset-ready";
	asset: PreparedAssetRecord;
}

export interface AssetWorkerErrorMessage {
	type: "asset-error";
	requestId: string;
	assetId: string;
	message: string;
}

export type AssetWorkerRequestMessage = AssetWorkerPrepareRequest;
export type AssetWorkerResponseMessage =
	| AssetWorkerReadyMessage
	| AssetWorkerErrorMessage;

export function prepareAssetPayload(
	request: AssetLookupRequestDto,
	response: AssetLookupResponseDto,
): PreparedAssetRecord {
	const terrainPayload = terrainLandblockPayloadDtoSchema.safeParse(
		response.payload,
	);
	if (terrainPayload.success) {
		return prepareTerrainLandblock(request, response, terrainPayload.data);
	}

	const outdoorStaticScenePayload =
		outdoorStaticScenePayloadDtoSchema.safeParse(response.payload);
	if (outdoorStaticScenePayload.success) {
		return prepareOutdoorStaticScene(
			request,
			response,
			outdoorStaticScenePayload.data,
		);
	}

	const indoorEnvCellPayload = indoorEnvCellPayloadDtoSchema.safeParse(
		response.payload,
	);
	if (indoorEnvCellPayload.success) {
		return prepareIndoorEnvCell(request, response, indoorEnvCellPayload.data);
	}

	const environmentPayload = environmentPayloadDtoSchema.safeParse(
		response.payload,
	);
	if (environmentPayload.success) {
		return prepareEnvironment(request, response, environmentPayload.data);
	}

	const gfxObjPayload = gfxObjPayloadDtoSchema.safeParse(response.payload);
	if (gfxObjPayload.success) {
		return prepareGfxObj(request, response, gfxObjPayload.data);
	}

	const setupModelPayload = setupModelPayloadDtoSchema.safeParse(
		response.payload,
	);
	if (setupModelPayload.success) {
		return prepareSetupModel(request, response, setupModelPayload.data);
	}

	const appearancePayload = appearanceManifestPayloadDtoSchema.safeParse(
		response.payload,
	);
	if (appearancePayload.success) {
		return prepareAppearanceManifest(request, response, appearancePayload.data);
	}

	const dependencyManifestPayload =
		dependencyManifestPayloadDtoSchema.safeParse(response.payload);
	if (dependencyManifestPayload.success) {
		return prepareDependencyManifest(
			request,
			response,
			dependencyManifestPayload.data,
		);
	}

	const payload = genericAssetPayloadDtoSchema.parse(response.payload);
	const assetKind = payload.kind;
	const provenance = parseProvenance(payload.provenance);
	const residencyKind = parseResidencyKind(payload.residencyKind);
	const debugPrimitive = payload.debugPrimitive ?? "json-manifest";
	const paletteKey = payload.paletteKey ?? "debug-default";

	return {
		request,
		response,
		payload:
			assetKind === "visual-asset-stub"
				? {
						kind: "visual-asset-stub",
						sourceAssetKind: provenance.sourceAssetKind,
						residencyKind,
						provenance,
						debugPresentation: {
							primitive: debugPrimitive,
							paletteKey,
						},
					}
				: createUnknownAssetPayload({
						rawKind: assetKind,
						sourceAssetKind: provenance.sourceAssetKind,
						residencyKind,
						debugPrimitive,
						paletteKey,
						provenance,
					}),
		preparedAt: new Date().toISOString(),
	};
}

function prepareOutdoorStaticScene(
	request: AssetLookupRequestDto,
	response: AssetLookupResponseDto,
	payload: OutdoorStaticScenePayloadDto,
): PreparedAssetRecord {
	return {
		request,
		response,
		payload: {
			kind: "outdoor-static-scene",
			sourceAssetKind: payload.sourceAssetKind,
			residencyKind: payload.residencyKind,
			provenance: parseProvenance(payload.provenance),
			landblockId: payload.landblockId,
			sceneryInstances: payload.sceneryInstances,
			buildingInstances: payload.buildingInstances,
			generatedSceneryInstances: payload.generatedSceneryInstances,
			diagnostics: payload.diagnostics,
		},
		preparedAt: new Date().toISOString(),
	};
}

function prepareIndoorEnvCell(
	request: AssetLookupRequestDto,
	response: AssetLookupResponseDto,
	payload: IndoorEnvCellPayloadDto,
): PreparedAssetRecord {
	return {
		request,
		response,
		payload: {
			kind: "indoor-env-cell",
			sourceAssetKind: payload.sourceAssetKind,
			residencyKind: payload.residencyKind,
			provenance: parseProvenance(payload.provenance),
			debugPresentation: {
				primitive: "indoor-env-cell-metadata",
				paletteKey: `env-cell-${payload.envCellId.toString(16).padStart(8, "0")}`,
			},
			envCellId: payload.envCellId,
			environmentId: payload.environmentId,
			cellStructureId: payload.cellStructureId,
			localPlacement: payload.localPlacement,
			visibleCellIds: payload.visibleCellIds,
			seenOutside: payload.seenOutside,
			surfaceIds: payload.surfaceIds,
			portalCount: payload.portalCount,
			staticObjectCount: payload.staticObjectCount,
		},
		preparedAt: new Date().toISOString(),
	};
}

function prepareEnvironment(
	request: AssetLookupRequestDto,
	response: AssetLookupResponseDto,
	payload: EnvironmentPayloadDto,
): PreparedAssetRecord {
	const cellStructures = payload.cellStructures.map((cellStructure) => ({
		...cellStructure,
		renderGeometry: buildPolygonSetRenderGeometry({
			sourceLabel: `Environment ${formatHexId(payload.environmentId)} cell structure ${cellStructure.id}`,
			sourceId: cellStructure.id,
			vertexArray: cellStructure.vertexArray,
			drawingPolygons: cellStructure.drawingPolygons,
		}),
	}));

	return {
		request,
		response,
		payload: {
			kind: "environment",
			sourceAssetKind: payload.sourceAssetKind,
			residencyKind: payload.residencyKind,
			provenance: parseProvenance(payload.provenance),
			debugPresentation: {
				primitive: "environment",
				paletteKey: `environment-${payload.environmentId.toString(16).padStart(8, "0")}`,
			},
			environmentId: payload.environmentId,
			cellStructureIds: payload.cellStructureIds,
			cellStructures,
		},
		preparedAt: new Date().toISOString(),
	};
}

function prepareGfxObj(
	request: AssetLookupRequestDto,
	response: AssetLookupResponseDto,
	payload: GfxObjPayloadDto,
): PreparedAssetRecord {
	const renderGeometry = buildPolygonSetRenderGeometry({
		sourceLabel: `GfxObj ${formatHexId(payload.gfxObjId)}`,
		sourceId: payload.gfxObjId,
		vertexArray: payload.vertexArray,
		drawingPolygons: payload.drawingPolygons,
	});

	return {
		request,
		response,
		payload: {
			kind: "gfx-obj",
			sourceAssetKind: payload.sourceAssetKind,
			residencyKind: payload.residencyKind,
			provenance: parseProvenance(payload.provenance),
			gfxObjId: payload.gfxObjId,
			flags: payload.flags,
			surfaceIds: payload.surfaceIds,
			vertexArray: payload.vertexArray,
			drawingPolygons: payload.drawingPolygons,
			drawingBsp: payload.drawingBsp,
			physicsWitness: payload.physicsWitness,
			renderGeometry,
			sortCenter: payload.sortCenter,
			didDegrade: payload.didDegrade,
		},
		preparedAt: new Date().toISOString(),
	};
}

function prepareSetupModel(
	request: AssetLookupRequestDto,
	response: AssetLookupResponseDto,
	payload: SetupModelPayloadDto,
): PreparedAssetRecord {
	return {
		request,
		response,
		payload: {
			kind: "setup-model",
			sourceAssetKind: payload.sourceAssetKind,
			residencyKind: payload.residencyKind,
			provenance: parseProvenance(payload.provenance),
			setupModelId: payload.setupModelId,
			flags: payload.flags,
			parts: payload.parts,
			holdingLocations: payload.holdingLocations,
			connectionPoints: payload.connectionPoints,
			placementSets: payload.placementSets,
			collisionWitness: payload.collisionWitness,
			height: payload.height,
			radius: payload.radius,
			stepUp: payload.stepUp,
			stepDown: payload.stepDown,
			sortingSphere: payload.sortingSphere,
			selectionSphere: payload.selectionSphere,
			lights: payload.lights,
			defaultAnimation: payload.defaultAnimation,
			defaultScript: payload.defaultScript,
			defaultMotionTable: payload.defaultMotionTable,
			defaultSoundTable: payload.defaultSoundTable,
			defaultScriptTable: payload.defaultScriptTable,
		},
		preparedAt: new Date().toISOString(),
	};
}

function prepareAppearanceManifest(
	request: AssetLookupRequestDto,
	response: AssetLookupResponseDto,
	payload: AppearanceManifestPayloadDto,
): PreparedAssetRecord {
	return {
		request,
		response,
		payload: createUnknownAssetPayload({
			rawKind: payload.kind,
			sourceAssetKind: payload.provenance.sourceAssetKind,
			residencyKind: parseResidencyKind(payload.residencyKind),
			debugPrimitive: payload.debugPrimitive,
			paletteKey: payload.paletteKey,
			provenance: parseProvenance(payload.provenance),
		}),
		preparedAt: new Date().toISOString(),
	};
}

function prepareDependencyManifest(
	request: AssetLookupRequestDto,
	response: AssetLookupResponseDto,
	payload: DependencyManifestPayloadDto,
): PreparedAssetRecord {
	return {
		request,
		response,
		payload: {
			kind: "dependency-manifest",
			sourceAssetKind: "dependency-manifest",
			residencyKind: parseResidencyKind(payload.residencyKind),
			provenance: parseProvenance(payload.provenance),
			dependencyAssetIds: parseDependencies(payload.dependencyAssetIds),
		},
		preparedAt: new Date().toISOString(),
	};
}

function prepareTerrainLandblock(
	request: AssetLookupRequestDto,
	response: AssetLookupResponseDto,
	payload: TerrainLandblockPayloadDto,
): PreparedAssetRecord {
	const landblockId = payload.landblockId;
	const gridSize = payload.gridSize;
	if (gridSize !== 9) {
		throw new Error(`Terrain payload gridSize ${gridSize} is unsupported.`);
	}

	const tileSize = payload.tileSize;
	const heights = payload.heights;
	const terrainTypes = payload.terrainTypes;
	if (heights.length !== gridSize * gridSize) {
		throw new Error(
			"Terrain payload must provide 81 height samples for a landblock.",
		);
	}
	if (terrainTypes.length !== gridSize * gridSize) {
		throw new Error(
			"Terrain payload must provide 81 terrain-type samples for a landblock.",
		);
	}

	const terrainMesh = buildTerrainMesh(
		landblockId,
		gridSize,
		tileSize,
		heights,
		terrainTypes,
	);
	const provenance = parseProvenance(payload.provenance);

	return {
		request,
		response,
		payload: {
			kind: "terrain-landblock",
			sourceAssetKind: payload.sourceAssetKind,
			residencyKind: parseResidencyKind(payload.residencyKind),
			provenance,
			debugPresentation: {
				primitive: "terrain-landblock-mesh",
				paletteKey: `terrain-${formatHex32(landblockId)}`,
			},
			terrainMesh,
		},
		preparedAt: new Date().toISOString(),
	};
}

function createUnknownAssetPayload({
	rawKind,
	sourceAssetKind,
	residencyKind,
	debugPrimitive,
	paletteKey,
	provenance,
}: {
	rawKind: string;
	sourceAssetKind: string | null;
	residencyKind: AssetResidencyKind;
	debugPrimitive: string;
	paletteKey: string;
	provenance: PreparedAssetProvenance;
}): PreparedAssetPayload {
	return {
		kind: "unknown",
		rawKind,
		sourceAssetKind,
		residencyKind,
		provenance,
		debugPresentation: {
			primitive: debugPrimitive,
			paletteKey,
		},
	};
}

function parseProvenance(value: unknown): PreparedAssetProvenance {
	const provenance = assetProvenanceDtoSchema.safeParse(value);
	if (!provenance.success) {
		return {
			source: "unknown",
			sourceAssetKind: null,
			errorCode: null,
			detail: null,
		};
	}

	return {
		source: parseProvenanceSource(provenance.data.source),
		sourceAssetKind: provenance.data.sourceAssetKind,
		errorCode: parseErrorCode(provenance.data.errorCode),
		detail: provenance.data.detail,
	};
}

function parseDependencies(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return [
		...new Set(
			value.filter(
				(assetId): assetId is string =>
					typeof assetId === "string" && assetId.length > 0,
			),
		),
	].sort();
}

function buildTerrainMesh(
	landblockId: number,
	gridSize: number,
	tileSize: number,
	heights: number[],
	terrainTypes: number[],
): PreparedTerrainMesh {
	const normalizedHeights: number[] = [];
	const normalizedTerrainTypes: number[] = [];
	for (let row = 0; row < gridSize; row += 1) {
		for (let col = 0; col < gridSize; col += 1) {
			const sourceIndex = col * gridSize + row;
			normalizedHeights.push(heights[sourceIndex] ?? 0);
			normalizedTerrainTypes.push(terrainTypes[sourceIndex] ?? 0);
		}
	}

	const vertices = normalizedHeights.map((height, index) => {
		const row = Math.floor(index / gridSize);
		const col = index % gridSize;
		return {
			x: col * tileSize,
			y: row * tileSize,
			z: height,
		};
	});

	const triangles: PreparedTerrainTriangle[] = [];
	for (let row = 0; row < gridSize - 1; row += 1) {
		for (let col = 0; col < gridSize - 1; col += 1) {
			const southwest = row * gridSize + col;
			const southeast = southwest + 1;
			const northwest = southwest + gridSize;
			const northeast = northwest + 1;
			const terrainType = normalizedTerrainTypes[southwest] ?? 0;
			const averageHeight =
				(normalizedHeights[southwest] +
					normalizedHeights[southeast] +
					normalizedHeights[northwest] +
					normalizedHeights[northeast]) /
				4;

			if (usesSouthwestToNortheastCut(landblockId, col, row)) {
				triangles.push({
					a: southwest,
					b: southeast,
					c: northeast,
					terrainType,
					averageHeight,
				});
				triangles.push({
					a: southwest,
					b: northeast,
					c: northwest,
					terrainType,
					averageHeight,
				});
			} else {
				triangles.push({
					a: southwest,
					b: southeast,
					c: northwest,
					terrainType,
					averageHeight,
				});
				triangles.push({
					a: northeast,
					b: northwest,
					c: southeast,
					terrainType,
					averageHeight,
				});
			}
		}
	}

	return {
		landblockId,
		gridSize,
		tileSize,
		vertices,
		triangles,
		minHeight: Math.min(...normalizedHeights),
		maxHeight: Math.max(...normalizedHeights),
	};
}

function usesSouthwestToNortheastCut(
	landblockId: number,
	cellX: number,
	cellY: number,
): boolean {
	const landblockX = (landblockId >>> 24) & 0xff;
	const landblockY = (landblockId >>> 16) & 0xff;
	const globalCellX = landblockX * 8 + cellX;
	const globalCellY = landblockY * 8 + cellY;
	const magicA = Math.imul(globalCellX, 214614067) + 1813693831;
	const magicB = Math.imul(globalCellX, 1109124029);
	const splitDirection =
		(Math.imul(globalCellY, magicA) - magicB - 1369149221) >>> 0;

	return splitDirection >= 0x80000000;
}

interface PolygonSetGeometrySource {
	sourceLabel: string;
	sourceId: number;
	vertexArray: GfxObjPayloadDto["vertexArray"];
	drawingPolygons: GfxObjPayloadDto["drawingPolygons"];
}

function buildPolygonSetRenderGeometry(
	source: PolygonSetGeometrySource,
): PreparedPolygonSetRenderGeometry {
	const verticesById = new Map(
		source.vertexArray.vertices.map((vertex) => [vertex.id, vertex]),
	);
	const positions: number[] = [];
	const normals: number[] = [];
	const uvs: number[] = [];
	const triangles: PreparedPolygonSetRenderGeometry["triangles"] = [];
	const surfaceIdSet = new Set<number>();
	const invalidPolygons: NonNullable<
		PreparedPolygonSetRenderGeometry["invalidPolygons"]
	> = [];
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let minZ = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	let maxZ = Number.NEGATIVE_INFINITY;

	for (const polygon of source.drawingPolygons) {
		if (polygon.numPts !== polygon.vertexIds.length) {
			throw new Error(
				`${source.sourceLabel} polygon ${polygon.id} declares ${polygon.numPts} points but provides ${polygon.vertexIds.length} vertices.`,
			);
		}
		if (polygon.vertexIds.length < 3) {
			continue;
		}

		const polygonVertices = polygon.vertexIds.map((vertexId) =>
			verticesById.get(vertexId),
		);
		const missingVertexIds = polygon.vertexIds.filter(
			(vertexId) => !verticesById.has(vertexId),
		);
		if (missingVertexIds.length > 0) {
			invalidPolygons.push({
				polygonId: polygon.id,
				vertexIds: polygon.vertexIds,
				missingVertexIds,
			});
			continue;
		}

		const surfaceId = normalizeSurfaceId(polygon.posSurface);
		if (surfaceId !== null) {
			surfaceIdSet.add(surfaceId);
		}

		for (
			let vertexIndex = 1;
			vertexIndex < polygon.vertexIds.length - 1;
			vertexIndex += 1
		) {
			const triangleVertexOffsets = [0, vertexIndex, vertexIndex + 1];
			triangles.push({
				polygonId: polygon.id,
				surfaceId,
				firstVertex: positions.length / 3,
			});

			for (const polygonVertexOffset of triangleVertexOffsets) {
				const vertex = polygonVertices[polygonVertexOffset];
				if (!vertex) {
					throw new Error(
						`${source.sourceLabel} polygon ${polygon.id} failed internal vertex validation.`,
					);
				}

				positions.push(vertex.origin.x, vertex.origin.y, vertex.origin.z);
				normals.push(vertex.normal.x, vertex.normal.y, vertex.normal.z);
				const uvIndex = polygon.posUvIndices[polygonVertexOffset] ?? 0;
				const uv = vertex.uvs[uvIndex] ?? { u: 0, v: 0 };
				uvs.push(uv.u, uv.v);

				minX = Math.min(minX, vertex.origin.x);
				minY = Math.min(minY, vertex.origin.y);
				minZ = Math.min(minZ, vertex.origin.z);
				maxX = Math.max(maxX, vertex.origin.x);
				maxY = Math.max(maxY, vertex.origin.y);
				maxZ = Math.max(maxZ, vertex.origin.z);
			}
		}
	}

	const vertexCount = positions.length / 3;
	return {
		sourceId: source.sourceId,
		vertexCount,
		triangleCount: triangles.length,
		positions,
		normals,
		uvs,
		triangles,
		surfaceIds: [...surfaceIdSet].sort((left, right) => left - right),
		invalidPolygons,
		skippedPolygonCount: invalidPolygons.length,
		bounds:
			vertexCount === 0
				? null
				: {
						min: { x: minX, y: minY, z: minZ },
						max: { x: maxX, y: maxY, z: maxZ },
					},
	};
}

function normalizeSurfaceId(surfaceId: number): number | null {
	return surfaceId > 0 ? surfaceId : null;
}

function formatHexId(id: number): string {
	return `0x${formatHex32(id)}`;
}

function parseResidencyKind(value: unknown): AssetResidencyKind {
	if (
		value === "outdoor-landblock" ||
		value === "indoor-env-cell" ||
		value === "unknown"
	) {
		return value;
	}

	return "unknown";
}

function parseProvenanceSource(
	value: unknown,
): PreparedAssetProvenance["source"] {
	if (
		value === "repo-local-hba" ||
		value === "generated-fallback" ||
		value === "app-local-stub" ||
		value === "unknown"
	) {
		return value;
	}

	return "unknown";
}

function parseErrorCode(value: unknown): AssetErrorCode | null {
	if (
		value === "asset-id-unknown" ||
		value === "asset-archive-open-failed" ||
		value === "asset-read-failed" ||
		value === "asset-decode-failed" ||
		value === "cell-landblock-unavailable"
	) {
		return value;
	}

	return null;
}

const workerScope = globalThis as typeof globalThis & {
	onmessage?: ((event: MessageEvent<AssetWorkerRequestMessage>) => void) | null;
	postMessage?: (message: AssetWorkerResponseMessage) => void;
	document?: unknown;
};

if (
	typeof workerScope.postMessage === "function" &&
	typeof workerScope.document === "undefined"
) {
	workerScope.onmessage = (event: MessageEvent<AssetWorkerRequestMessage>) => {
		try {
			const asset = prepareAssetPayload(
				event.data.request,
				event.data.response,
			);
			workerScope.postMessage?.({
				type: "asset-ready",
				asset,
			});
		} catch (error) {
			workerScope.postMessage?.({
				type: "asset-error",
				requestId: event.data.request.requestId,
				assetId: event.data.request.assetId,
				message: error instanceof Error ? error.message : String(error),
			});
		}
	};
}
