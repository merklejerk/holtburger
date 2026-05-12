import type {
	AssetErrorCode,
	AssetLookupRequestDto,
	AssetLookupResponseDto,
	AssetProvenanceSource,
	Vec3Dto,
} from "../host/contracts";

export type AssetPreparationStatus = "idle" | "pending" | "ready" | "error";

export type AssetResidencyKind =
	| "outdoor-landblock"
	| "indoor-env-cell"
	| "unknown";

export interface PreparedAssetProvenance {
	source: AssetProvenanceSource;
	sourceAssetKind: string | null;
	errorCode: AssetErrorCode | null;
	detail: string | null;
}

export interface PreparedTerrainTriangle {
	a: number;
	b: number;
	c: number;
	terrainType: number;
	averageHeight: number;
}

export interface PreparedTerrainMesh {
	landblockId: number;
	gridSize: number;
	tileSize: number;
	vertices: Vec3Dto[];
	triangles: PreparedTerrainTriangle[];
	minHeight: number;
	maxHeight: number;
}

interface PreparedAssetPayloadBase {
	kind: string;
	residencyKind: AssetResidencyKind;
	provenance: PreparedAssetProvenance;
}

export interface PreparedDebugPresentation {
	primitive: string;
	paletteKey: string;
}

export interface PreparedTerrainLandblockPayload extends PreparedAssetPayloadBase {
	kind: "terrain-landblock";
	sourceAssetKind: "cell-landblock";
	debugPresentation: PreparedDebugPresentation;
	terrainMesh: PreparedTerrainMesh;
}

export interface PreparedIndoorEnvCellPayload extends PreparedAssetPayloadBase {
	kind: "indoor-env-cell";
	sourceAssetKind: "env-cell";
	debugPresentation: PreparedDebugPresentation;
	envCellId: number;
	environmentId: number | null;
	cellStructureId: number | null;
	visibleCellIds: number[];
	seenOutside: boolean | null;
	surfaceIds: number[];
	portalCount: number;
	staticObjectCount: number;
}

export interface PreparedEnvironmentPayload extends PreparedAssetPayloadBase {
	kind: "environment";
	sourceAssetKind: "environment";
	debugPresentation: PreparedDebugPresentation;
	environmentId: number;
	cellStructureIds: number[];
}

export interface PreparedCellStructurePayload extends PreparedAssetPayloadBase {
	kind: "cell-structure";
	sourceAssetKind: "cell-structure";
	debugPresentation: PreparedDebugPresentation;
	environmentId: number | null;
	cellStructureId: number;
	polygonCount: number | null;
	portalCount: number | null;
	hasCellBsp: boolean;
	hasPhysicsBsp: boolean;
	hasDrawingBsp: boolean;
}

export interface PreparedGfxObjUv {
	u: number;
	v: number;
}

export interface PreparedGfxObjVertex {
	id: number;
	origin: Vec3Dto;
	normal: Vec3Dto;
	uvs: PreparedGfxObjUv[];
}

export interface PreparedGfxObjVertexArray {
	vertexType: number | null;
	vertexCount: number;
	vertices: PreparedGfxObjVertex[];
}

export interface PreparedGfxObjPolygon {
	id: number;
	numPts: number;
	stippling: number;
	sidesType: number;
	posSurface: number;
	negSurface: number;
	vertexIds: number[];
	posUvIndices: number[];
	negUvIndices: number[];
}

export interface PreparedGfxObjBspNode {
	kind: string;
	[key: string]: unknown;
}

export interface PreparedGfxObjPhysicsWitness {
	polygonCount: number;
	hasBsp: boolean;
}

export interface PreparedGfxObjRenderTriangle {
	polygonId: number;
	surfaceId: number | null;
	firstVertex: number;
}

export interface PreparedGfxObjRenderBounds {
	min: Vec3Dto;
	max: Vec3Dto;
}

export interface PreparedGfxObjRenderGeometry {
	gfxObjId: number;
	vertexCount: number;
	triangleCount: number;
	positions: number[];
	normals: number[];
	uvs: number[];
	triangles: PreparedGfxObjRenderTriangle[];
	surfaceIds: number[];
	bounds: PreparedGfxObjRenderBounds | null;
}

export interface PreparedGfxObjPayload extends PreparedAssetPayloadBase {
	kind: "gfx-obj";
	sourceAssetKind: "gfx-obj";
	gfxObjId: number;
	flags: number | null;
	surfaceIds: number[];
	vertexArray: PreparedGfxObjVertexArray;
	drawingPolygons: PreparedGfxObjPolygon[];
	drawingBsp: PreparedGfxObjBspNode | null;
	physicsWitness: PreparedGfxObjPhysicsWitness;
	renderGeometry: PreparedGfxObjRenderGeometry;
	sortCenter: Vec3Dto | null;
	didDegrade: number | null;
}

export interface PreparedVisualAssetStubPayload extends PreparedAssetPayloadBase {
	kind: "visual-asset-stub";
	sourceAssetKind: string | null;
	debugPresentation: PreparedDebugPresentation;
}

export interface PreparedDependencyManifestPayload extends PreparedAssetPayloadBase {
	kind: "dependency-manifest";
	sourceAssetKind: "dependency-manifest";
	dependencyAssetIds: string[];
}

export interface PreparedUnknownAssetPayload extends PreparedAssetPayloadBase {
	kind: "unknown";
	sourceAssetKind: string | null;
	rawKind: string;
	debugPresentation: PreparedDebugPresentation | null;
}

export type PreparedAssetPayload =
	| PreparedTerrainLandblockPayload
	| PreparedIndoorEnvCellPayload
	| PreparedEnvironmentPayload
	| PreparedCellStructurePayload
	| PreparedGfxObjPayload
	| PreparedVisualAssetStubPayload
	| PreparedDependencyManifestPayload
	| PreparedUnknownAssetPayload;

export interface PreparedAssetRecord {
	request: AssetLookupRequestDto;
	response: AssetLookupResponseDto;
	payload: PreparedAssetPayload;
	preparedAt: string;
}

export interface PreparedAssetDependency {
	assetId: string;
}

export type PreparedAssetDependencyReadiness =
	| "ready"
	| "awaiting-dependency"
	| "partial-ready";

export interface PreparedAssetDependencyStatus {
	status: PreparedAssetDependencyReadiness;
	dependencyAssetIds: string[];
	readyAssetIds: string[];
	missingAssetIds: string[];
	pendingAssetIds: string[];
}

export function isPreparedTerrainLandblock(
	asset: PreparedAssetRecord,
): asset is PreparedAssetRecord & { payload: PreparedTerrainLandblockPayload } {
	return asset.payload.kind === "terrain-landblock";
}

export function describePreparedAssetPayload(
	payload: PreparedAssetPayload,
): string {
	return "debugPresentation" in payload
		? (payload.debugPresentation?.primitive ?? payload.kind)
		: payload.kind;
}

export function getPreparedAssetDependencies(
	asset: PreparedAssetRecord,
): PreparedAssetDependency[] {
	if (asset.payload.kind === "dependency-manifest") {
		return asset.payload.dependencyAssetIds.map((assetId) => ({ assetId }));
	}

	return [];
}

export function derivePreparedAssetDependencyStatus(
	asset: PreparedAssetRecord,
	preparedByAssetId: Record<string, PreparedAssetRecord>,
	pendingAssetIds: string[] = [],
): PreparedAssetDependencyStatus {
	const pendingAssetIdSet = new Set(pendingAssetIds);
	const dependencyAssetIds = getPreparedAssetDependencies(asset).map(
		(dependency) => dependency.assetId,
	);
	const readyAssetIds = dependencyAssetIds.filter(
		(assetId) => preparedByAssetId[assetId] !== undefined,
	);
	const missingAssetIds = dependencyAssetIds.filter(
		(assetId) =>
			preparedByAssetId[assetId] === undefined &&
			!pendingAssetIdSet.has(assetId),
	);
	const pendingDependencyAssetIds = dependencyAssetIds.filter(
		(assetId) =>
			preparedByAssetId[assetId] === undefined &&
			pendingAssetIdSet.has(assetId),
	);

	if (missingAssetIds.length === 0 && pendingDependencyAssetIds.length === 0) {
		return {
			status: "ready",
			dependencyAssetIds,
			readyAssetIds,
			missingAssetIds,
			pendingAssetIds: pendingDependencyAssetIds,
		};
	}

	return {
		status: readyAssetIds.length > 0 ? "partial-ready" : "awaiting-dependency",
		dependencyAssetIds,
		readyAssetIds,
		missingAssetIds,
		pendingAssetIds: pendingDependencyAssetIds,
	};
}

export type AssetActivityStatus = "requested" | "prepared" | "failed";

export interface AssetActivityRecord {
	requestId: string;
	assetId: string;
	priority: AssetLookupRequestDto["priority"];
	status: AssetActivityStatus;
	channel: string;
	timestamp: string;
}

export interface AssetChannelState {
	channel: string;
	status: AssetPreparationStatus;
	activeRequest: AssetLookupRequestDto | null;
	preparedAsset: PreparedAssetRecord | null;
	preparedByPriority: Record<
		AssetLookupRequestDto["priority"],
		PreparedAssetRecord | null
	>;
	preparedByAssetId: Record<string, PreparedAssetRecord>;
	lastResponse: AssetLookupResponseDto | null;
	errorMessage: string | null;
	history: AssetActivityRecord[];
}

export function createInitialAssetChannelState(
	channel = "asset",
): AssetChannelState {
	return {
		channel,
		status: "idle",
		activeRequest: null,
		preparedAsset: null,
		preparedByPriority: {
			bootstrap: null,
			streaming: null,
			prefetch: null,
		},
		preparedByAssetId: {},
		lastResponse: null,
		errorMessage: null,
		history: [],
	};
}
