import type {
	AppearanceManifestPayloadDto,
	AssetErrorCode,
	AssetLookupRequestDto,
	AssetLookupResponseDto,
	DependencyManifestPayloadDto,
	EnvironmentPayloadDto,
	GfxObjPayloadDto,
	IndoorEnvCellPayloadDto,
	LandblockPackPayloadDto,
	LandblockSummaryPayloadDto,
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
	landblockPackPayloadDtoSchema,
	landblockSummaryPayloadDtoSchema,
	outdoorStaticScenePayloadDtoSchema,
	setupModelPayloadDtoSchema,
	terrainLandblockPayloadDtoSchema,
} from "../lib/host/contracts";
import type {
	AssetResidencyKind,
	PreparedAssetRecord,
	PreparedAssetProvenance,
	PreparedAssetPayload,
	PreparedPolygonSetBspNode,
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

	const landblockPackPayload = landblockPackPayloadDtoSchema.safeParse(
		response.payload,
	);
	if (landblockPackPayload.success) {
		return prepareLandblockPack(request, response, landblockPackPayload.data);
	}

	const landblockSummaryPayload = landblockSummaryPayloadDtoSchema.safeParse(
		response.payload,
	);
	if (landblockSummaryPayload.success) {
		return prepareLandblockSummary(
			request,
			response,
			landblockSummaryPayload.data,
		);
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

function prepareLandblockPack(
	request: AssetLookupRequestDto,
	response: AssetLookupResponseDto,
	payload: LandblockPackPayloadDto,
): PreparedAssetRecord {
	return {
		request,
		response,
		payload: {
			kind: "landblock-pack",
			sourceAssetKind: payload.sourceAssetKind,
			residencyKind: payload.residencyKind,
			provenance: parseProvenance(payload.provenance),
			landblockId: payload.landblockId,
			landblockInfoId: payload.landblockInfoId,
			classification: payload.classification,
			sourceFacts: {
				cellLandblock: payload.sourceFacts.cellLandblock,
				landblockInfo: payload.sourceFacts.landblockInfo,
				outdoor: payload.sourceFacts.outdoor,
				interiors: payload.sourceFacts.interiors,
			},
			prepared: payload.prepared,
			dependencies: {
				cellDatIds: payload.dependencies.cellDatIds,
				portalDatIds: payload.dependencies.portalDatIds,
				renderableAssetIds: payload.dependencies.renderableAssetIds,
			},
			diagnostics: {
				sourceRecords: payload.diagnostics.sourceRecords,
				errors: payload.diagnostics.errors,
			},
		},
		preparedAt: new Date().toISOString(),
	};
}

function prepareLandblockSummary(
	request: AssetLookupRequestDto,
	response: AssetLookupResponseDto,
	payload: LandblockSummaryPayloadDto,
): PreparedAssetRecord {
	return {
		request,
		response,
		payload: {
			kind: "landblock-summary",
			sourceAssetKind: payload.sourceAssetKind,
			residencyKind: payload.residencyKind,
			provenance: parseProvenance(payload.provenance),
			landblockId: payload.landblockId,
			landblockInfoId: payload.landblockInfoId,
			classification: payload.classification,
			sourceFacts: payload.sourceFacts,
			prepared: payload.prepared,
			dependencies: payload.dependencies,
			diagnostics: {
				sourceRecords: payload.diagnostics.sourceRecords,
				errors: payload.diagnostics.errors,
			},
		},
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
			landblockEnvCellIds: payload.landblockEnvCellIds,
			seenOutside: payload.seenOutside,
			surfaceIds: payload.surfaceIds,
			portalCount: payload.portalCount,
			portals: payload.portals,
			staticObjectCount: payload.staticObjectCount,
			staticObjects: payload.staticObjects,
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
			renderPolygonIds: collectDrawingBspRenderablePolygonIds(
				cellStructure.drawingBsp,
			),
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
		renderPolygonIds: collectDrawingBspRenderablePolygonIds(payload.drawingBsp),
		renderUvlessPositiveSides: true,
		duplicateCullModeNoneBackfaces: true,
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
	renderPolygonIds?: ReadonlySet<number>;
	renderUvlessPositiveSides?: boolean;
	duplicateCullModeNoneBackfaces?: boolean;
}

const STIPPLING_NO_POS = 0x04;
const STIPPLING_NO_NEG = 0x08;
const CULL_MODE_NONE = 1;
const CULL_MODE_CLOCKWISE = 2;
const CULL_MODE_COUNTER_CLOCKWISE = 3;

interface PolygonRenderSide {
	surfaceId: number | null;
	uvIndices: readonly number[] | null;
	vertexOffsets: (vertexIndex: number) => [number, number, number];
	normalScale: 1 | -1;
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
	let skippedPolygonCount = 0;
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let minZ = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	let maxZ = Number.NEGATIVE_INFINITY;

	for (const polygon of source.drawingPolygons) {
		if (
			source.renderPolygonIds !== undefined &&
			!source.renderPolygonIds.has(polygon.id)
		) {
			continue;
		}
		if (polygon.numPts !== polygon.vertexIds.length) {
			throw new Error(
				`${source.sourceLabel} polygon ${polygon.id} declares ${polygon.numPts} points but provides ${polygon.vertexIds.length} vertices.`,
			);
		}
		if (polygon.vertexIds.length < 3) {
			continue;
		}
		const renderSides = derivePolygonRenderSides(source, polygon);
		if (renderSides.length === 0) {
			skippedPolygonCount += 1;
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
			skippedPolygonCount += 1;
			continue;
		}

		for (const renderSide of renderSides) {
			if (renderSide.surfaceId !== null) {
				surfaceIdSet.add(renderSide.surfaceId);
			}

			for (
				let vertexIndex = 1;
				vertexIndex < polygon.vertexIds.length - 1;
				vertexIndex += 1
			) {
				const triangleVertexOffsets = renderSide.vertexOffsets(vertexIndex);
				triangles.push({
					polygonId: polygon.id,
					surfaceId: renderSide.surfaceId,
					firstVertex: positions.length / 3,
				});

				for (const polygonVertexOffset of triangleVertexOffsets) {
					const vertex = polygonVertices[polygonVertexOffset];
					if (!vertex) {
						throw new Error(
							`${source.sourceLabel} polygon ${polygon.id} failed internal vertex validation.`,
						);
					}

					const renderPosition = convertAcVectorToRenderSpace(vertex.origin);
					const renderNormal = convertAcVectorToRenderSpace(vertex.normal);
					positions.push(renderPosition.x, renderPosition.y, renderPosition.z);
					normals.push(
						scaleNormalComponent(renderNormal.x, renderSide.normalScale),
						scaleNormalComponent(renderNormal.y, renderSide.normalScale),
						scaleNormalComponent(renderNormal.z, renderSide.normalScale),
					);
					const uvIndex = renderSide.uvIndices?.[polygonVertexOffset] ?? null;
					const uv = uvIndex === null ? null : vertex.uvs[uvIndex];
					if (uvIndex !== null && !uv) {
						throw new Error(
							`${source.sourceLabel} polygon ${polygon.id} references missing UV ${uvIndex} on vertex ${vertex.id}.`,
						);
					}
					uvs.push(uv?.u ?? 0, uv?.v ?? 0);

					minX = Math.min(minX, renderPosition.x);
					minY = Math.min(minY, renderPosition.y);
					minZ = Math.min(minZ, renderPosition.z);
					maxX = Math.max(maxX, renderPosition.x);
					maxY = Math.max(maxY, renderPosition.y);
					maxZ = Math.max(maxZ, renderPosition.z);
				}
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
		skippedPolygonCount,
		bounds:
			vertexCount === 0
				? null
				: {
						min: { x: minX, y: minY, z: minZ },
						max: { x: maxX, y: maxY, z: maxZ },
					},
	};
}

function collectDrawingBspRenderablePolygonIds(
	node: PreparedPolygonSetBspNode | null,
): ReadonlySet<number> | undefined {
	if (node === null) {
		return undefined;
	}

	const polygonIds = new Set<number>();
	collectDrawingBspNodePolygonIds(node, polygonIds);
	return polygonIds;
}

function collectDrawingBspNodePolygonIds(
	node: PreparedPolygonSetBspNode,
	polygonIds: Set<number>,
): void {
	for (const polygonId of node.polyIds) {
		polygonIds.add(polygonId);
	}

	if (node.kind === "port") {
		collectDrawingBspNodePolygonIds(node.pos, polygonIds);
		collectDrawingBspNodePolygonIds(node.neg, polygonIds);
		return;
	}

	if (node.kind === "internal") {
		if (node.pos !== null) {
			collectDrawingBspNodePolygonIds(node.pos, polygonIds);
		}
		if (node.neg !== null) {
			collectDrawingBspNodePolygonIds(node.neg, polygonIds);
		}
	}
}

function scaleNormalComponent(value: number, scale: 1 | -1): number {
	const scaled = value * scale;
	return scaled === 0 ? 0 : scaled;
}

function derivePolygonRenderSides(
	source: PolygonSetGeometrySource,
	polygon: GfxObjPayloadDto["drawingPolygons"][number],
): PolygonRenderSide[] {
	const sides: PolygonRenderSide[] = [];
	let positiveSide: PolygonRenderSide | null = null;
	if (
		(polygon.stippling & STIPPLING_NO_POS) === 0 ||
		source.renderUvlessPositiveSides
	) {
		const uvIndices =
			(polygon.stippling & STIPPLING_NO_POS) === 0
				? requireUvIndicesAvailable(source.sourceLabel, polygon, "positive")
				: null;
		const isCounterClockwiseCulled =
			polygon.sidesType === CULL_MODE_COUNTER_CLOCKWISE;
		positiveSide = {
			surfaceId: normalizeSurfaceId(polygon.posSurface),
			uvIndices,
			vertexOffsets: isCounterClockwiseCulled
				? (vertexIndex) => [0, vertexIndex + 1, vertexIndex]
				: (vertexIndex) => [0, vertexIndex, vertexIndex + 1],
			normalScale: isCounterClockwiseCulled ? -1 : 1,
		};
		sides.push(positiveSide);
	}

	if (
		source.duplicateCullModeNoneBackfaces &&
		polygon.sidesType === CULL_MODE_NONE &&
		positiveSide !== null
	) {
		sides.push({
			surfaceId: positiveSide.surfaceId,
			uvIndices: positiveSide.uvIndices,
			vertexOffsets: (vertexIndex) => [0, vertexIndex + 1, vertexIndex],
			normalScale: -1,
		});
	}

	if (
		polygon.sidesType === CULL_MODE_CLOCKWISE &&
		(polygon.stippling & STIPPLING_NO_NEG) === 0
	) {
		const uvIndices = requireUvIndicesAvailable(
			source.sourceLabel,
			polygon,
			"negative",
		);
		sides.push({
			surfaceId: normalizeSurfaceId(polygon.negSurface),
			uvIndices,
			vertexOffsets: (vertexIndex) => [0, vertexIndex + 1, vertexIndex],
			normalScale: -1,
		});
	}

	return sides;
}

function requireUvIndicesAvailable(
	sourceLabel: string,
	polygon: GfxObjPayloadDto["drawingPolygons"][number],
	side: "positive" | "negative",
): readonly number[] {
	const uvIndices =
		side === "positive" ? polygon.posUvIndices : polygon.negUvIndices;
	if (uvIndices.length !== polygon.vertexIds.length) {
		throw new Error(
			`${sourceLabel} polygon ${polygon.id} has a renderable ${side} side but provides ${uvIndices.length} UV indices for ${polygon.vertexIds.length} vertices.`,
		);
	}

	return uvIndices;
}

function convertAcVectorToRenderSpace(vector: {
	x: number;
	y: number;
	z: number;
}) {
	return {
		x: vector.x,
		y: vector.z,
		z: vector.y === 0 ? 0 : -vector.y,
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
		value === "landblock" ||
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
