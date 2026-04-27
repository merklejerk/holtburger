import type {
	AssetLookupRequestDto,
	AssetLookupResponseDto,
} from "../lib/host/contracts";
import type {
	AssetResidencyKind,
	PreparedAssetRecord,
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
	const payload = asRecord(response.payload);
	const assetKind = asString(payload.kind) ?? "unknown";

	if (assetKind === "terrain-landblock") {
		return prepareTerrainLandblock(request, response, payload);
	}

	const residencyKind = parseResidencyKind(payload.residencyKind);
	const debugPrimitive = asString(payload.debugPrimitive) ?? "json-manifest";
	const paletteKey = asString(payload.paletteKey) ?? "debug-default";
	const notes = asStringArray(payload.notes);

	return {
		request,
		response,
		assetKind: assetKind === "visual-asset-stub" ? "visual-asset-stub" : "unknown",
		residencyKind,
		debugPrimitive,
		paletteKey,
		terrainMesh: null,
		summary: `Prepared ${request.assetId} as ${debugPrimitive} for ${residencyKind}.`,
		notes,
		preparedAt: new Date().toISOString(),
	};
}

function prepareTerrainLandblock(
	request: AssetLookupRequestDto,
	response: AssetLookupResponseDto,
	payload: Record<string, unknown>,
): PreparedAssetRecord {
	const landblockId = asNumber(payload.landblockId);
	if (landblockId === null) {
		throw new Error("Terrain payload is missing a numeric landblockId.");
	}

	const gridSize = asNumber(payload.gridSize) ?? 9;
	if (gridSize !== 9) {
		throw new Error(`Terrain payload gridSize ${gridSize} is unsupported.`);
	}

	const tileSize = asNumber(payload.tileSize) ?? 24;
	const heights = asNumberArray(payload.heights);
	const terrainTypes = asNumberArray(payload.terrainTypes);
	if (heights.length !== gridSize * gridSize) {
		throw new Error("Terrain payload must provide 81 height samples for a landblock.");
	}
	if (terrainTypes.length !== gridSize * gridSize) {
		throw new Error("Terrain payload must provide 81 terrain-type samples for a landblock.");
	}

	const terrainMesh = buildTerrainMesh(landblockId, gridSize, tileSize, heights, terrainTypes);
	const notes = asStringArray(payload.notes);

	return {
		request,
		response,
		assetKind: "terrain-landblock",
		residencyKind: parseResidencyKind(payload.residencyKind),
		debugPrimitive: "terrain-landblock-mesh",
		paletteKey: `terrain-${landblockId.toString(16).padStart(8, "0")}`,
		terrainMesh,
		summary: `Prepared ${request.assetId} as a landblock terrain mesh with ${terrainMesh.vertices.length} vertices and ${terrainMesh.triangles.length} triangles.`,
		notes,
		preparedAt: new Date().toISOString(),
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

function asRecord(value: unknown): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("Asset worker expected an object payload for CPU-side preparation.");
	}

	return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
	return typeof value === "string" ? value : null;
}

function asStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return value.filter((entry): entry is string => typeof entry === "string");
}

function asNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asNumberArray(value: unknown): number[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return value.filter((entry): entry is number => typeof entry === "number");
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
