import type {
	AppearanceManifestPayloadDto,
	AssetErrorCode,
	AssetLookupRequestDto,
	AssetLookupResponseDto,
	CellStructurePayloadDto,
	DependencyManifestPayloadDto,
	EnvironmentPayloadDto,
	IndoorEnvCellPayloadDto,
	TerrainLandblockPayloadDto,
} from "../lib/host/contracts";
import {
	appearanceManifestPayloadDtoSchema,
	assetProvenanceDtoSchema,
	cellStructurePayloadDtoSchema,
	dependencyManifestPayloadDtoSchema,
	environmentPayloadDtoSchema,
	genericAssetPayloadDtoSchema,
	indoorEnvCellPayloadDtoSchema,
	terrainLandblockPayloadDtoSchema,
} from "../lib/host/contracts";
import type {
	AssetResidencyKind,
	PreparedAssetRecord,
	PreparedAssetProvenance,
	PreparedAssetPayload,
	PreparedTerrainMesh,
	PreparedTerrainTriangle,
} from "../lib/assets/types";

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

	const cellStructurePayload = cellStructurePayloadDtoSchema.safeParse(
		response.payload,
	);
	if (cellStructurePayload.success) {
		return prepareCellStructure(request, response, cellStructurePayload.data);
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
	return {
		request,
		response,
		payload: {
			kind: "environment",
			sourceAssetKind: payload.sourceAssetKind,
			residencyKind: payload.residencyKind,
			provenance: parseProvenance(payload.provenance),
			debugPresentation: {
				primitive: "environment-reference",
				paletteKey: `environment-${payload.environmentId.toString(16).padStart(8, "0")}`,
			},
			environmentId: payload.environmentId,
			cellStructureIds: payload.cellStructureIds,
		},
		preparedAt: new Date().toISOString(),
	};
}

function prepareCellStructure(
	request: AssetLookupRequestDto,
	response: AssetLookupResponseDto,
	payload: CellStructurePayloadDto,
): PreparedAssetRecord {
	return {
		request,
		response,
		payload: {
			kind: "cell-structure",
			sourceAssetKind: payload.sourceAssetKind,
			residencyKind: payload.residencyKind,
			provenance: parseProvenance(payload.provenance),
			debugPresentation: {
				primitive: "cell-structure-summary",
				paletteKey: `cell-structure-${payload.cellStructureId.toString(16).padStart(4, "0")}`,
			},
			environmentId: payload.environmentId,
			cellStructureId: payload.cellStructureId,
			polygonCount: payload.polygonCount,
			portalCount: payload.portalCount,
			hasCellBsp: payload.hasCellBsp,
			hasPhysicsBsp: payload.hasPhysicsBsp,
			hasDrawingBsp: payload.hasDrawingBsp,
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
				paletteKey: `terrain-${landblockId.toString(16).padStart(8, "0")}`,
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
			const topLeft = row * gridSize + col;
			const topRight = topLeft + 1;
			const bottomLeft = topLeft + gridSize;
			const bottomRight = bottomLeft + 1;
			const terrainType = normalizedTerrainTypes[topLeft] ?? 0;
			const averageHeight =
				(normalizedHeights[topLeft] +
					normalizedHeights[topRight] +
					normalizedHeights[bottomLeft] +
					normalizedHeights[bottomRight]) /
				4;

			triangles.push({
				a: topLeft,
				b: topRight,
				c: bottomLeft,
				terrainType,
				averageHeight,
			});
			triangles.push({
				a: topRight,
				b: bottomRight,
				c: bottomLeft,
				terrainType,
				averageHeight,
			});
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
