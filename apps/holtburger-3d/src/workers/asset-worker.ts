import type {
	AppearanceManifestPayloadDto,
	AssetErrorCode,
	AssetLookupRequestDto,
	AssetLookupResponseDto,
	CellStructurePayloadDto,
	EnvironmentPayloadDto,
	IndoorEnvCellPayloadDto,
	TerrainLandblockPayloadDto,
} from "../lib/host/contracts";
import {
	appearanceManifestPayloadDtoSchema,
	assetProvenanceDtoSchema,
	cellStructurePayloadDtoSchema,
	environmentPayloadDtoSchema,
	genericAssetPayloadDtoSchema,
	indoorEnvCellPayloadDtoSchema,
	terrainLandblockPayloadDtoSchema,
} from "../lib/host/contracts";
import type {
	AssetResidencyKind,
	PreparedAssetRecord,
	PreparedAssetProvenance,
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
	const terrainPayload = terrainLandblockPayloadDtoSchema.safeParse(response.payload);
	if (terrainPayload.success) {
		return prepareTerrainLandblock(request, response, terrainPayload.data);
	}

	const indoorEnvCellPayload = indoorEnvCellPayloadDtoSchema.safeParse(response.payload);
	if (indoorEnvCellPayload.success) {
		return prepareIndoorEnvCell(request, response, indoorEnvCellPayload.data);
	}

	const environmentPayload = environmentPayloadDtoSchema.safeParse(response.payload);
	if (environmentPayload.success) {
		return prepareEnvironment(request, response, environmentPayload.data);
	}

	const cellStructurePayload = cellStructurePayloadDtoSchema.safeParse(response.payload);
	if (cellStructurePayload.success) {
		return prepareCellStructure(request, response, cellStructurePayload.data);
	}

	const appearancePayload = appearanceManifestPayloadDtoSchema.safeParse(response.payload);
	if (appearancePayload.success) {
		return prepareAppearanceManifest(request, response, appearancePayload.data);
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
		assetKind: assetKind === "visual-asset-stub" ? "visual-asset-stub" : "unknown",
		residencyKind,
		debugPrimitive,
		paletteKey,
		provenance,
		terrainMesh: null,
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
		assetKind: "indoor-env-cell",
		residencyKind: payload.residencyKind,
		debugPrimitive: "indoor-env-cell-metadata",
		paletteKey: `env-cell-${payload.envCellId.toString(16).padStart(8, "0")}`,
		provenance: parseProvenance(payload.provenance),
		terrainMesh: null,
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
		assetKind: "environment",
		residencyKind: payload.residencyKind,
		debugPrimitive: "environment-reference",
		paletteKey: `environment-${payload.environmentId.toString(16).padStart(8, "0")}`,
		provenance: parseProvenance(payload.provenance),
		terrainMesh: null,
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
		assetKind: "cell-structure",
		residencyKind: payload.residencyKind,
		debugPrimitive: "cell-structure-summary",
		paletteKey: `cell-structure-${payload.cellStructureId.toString(16).padStart(4, "0")}`,
		provenance: parseProvenance(payload.provenance),
		terrainMesh: null,
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
		assetKind: "unknown",
		residencyKind: parseResidencyKind(payload.residencyKind),
		debugPrimitive: payload.debugPrimitive,
		paletteKey: payload.paletteKey,
		provenance: parseProvenance(payload.provenance),
		terrainMesh: null,
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
		throw new Error("Terrain payload must provide 81 height samples for a landblock.");
	}
	if (terrainTypes.length !== gridSize * gridSize) {
		throw new Error("Terrain payload must provide 81 terrain-type samples for a landblock.");
	}

	const terrainMesh = buildTerrainMesh(landblockId, gridSize, tileSize, heights, terrainTypes);
	const provenance = parseProvenance(payload.provenance);

	return {
		request,
		response,
		assetKind: "terrain-landblock",
		residencyKind: parseResidencyKind(payload.residencyKind),
		debugPrimitive: "terrain-landblock-mesh",
		paletteKey: `terrain-${landblockId.toString(16).padStart(8, "0")}`,
		provenance,
		terrainMesh,
		preparedAt: new Date().toISOString(),
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
				(
					normalizedHeights[topLeft] +
					normalizedHeights[topRight] +
					normalizedHeights[bottomLeft] +
					normalizedHeights[bottomRight]
				) /
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
			const asset = prepareAssetPayload(event.data.request, event.data.response);
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
