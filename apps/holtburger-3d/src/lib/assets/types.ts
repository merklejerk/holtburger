import type {
	AssetErrorCode,
	AssetLookupRequestDto,
	AssetLookupResponseDto,
	AssetProvenanceSource,
	PlacementTransformDto,
	SphereDto,
	Vec3Dto,
} from "../host/contracts";

type AssetPreparationStatus = "idle" | "pending" | "ready" | "error";

export type AssetResidencyKind =
	| "landblock"
	| "outdoor-landblock"
	| "interior-cell"
	| "unknown";

export interface PreparedAssetProvenance {
	source: AssetProvenanceSource;
	sourceAssetKind: string | null;
	errorCode: AssetErrorCode | null;
	detail: string | null;
}

interface PreparedTerrainTriangle {
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

interface PreparedDebugPresentation {
	primitive: string;
	paletteKey: string;
}

interface PreparedLandblockStaticSourceInstance {
	instanceId: string;
	owningLandblockId: number;
	sourceDid: number;
	sourceAssetId: string;
	sourceIndex: number;
	localPlacement: PlacementTransformDto;
}

export interface PreparedLandblockStaticBuildingPortal {
	portalId: string;
	sourceIndex: number;
	flags: number;
	otherCellId: number;
	otherPortalId: number;
	stabList: number[];
	linkedEnvCellIds: number[];
}

interface PreparedLandblockStaticBuilding extends PreparedLandblockStaticSourceInstance {
	numLeaves: number;
	portals: PreparedLandblockStaticBuildingPortal[];
}

export interface PreparedIndoorCellPortal {
	portalId: string;
	sourceIndex: number;
	flags: number;
	polygonId: number;
	otherCellId: number;
	otherPortalId: number;
	targetEnvCellId: number;
}

interface PreparedLandblockCellPortal {
	portalId: string;
	sourceIndex: number;
	flags: number;
	polygonId: number;
	otherCellId: number;
	otherPortalId: number;
	targetEnvCellId: number | null;
	isOutsideTransition: boolean;
}

export interface PreparedLandblockPackPayload extends PreparedAssetPayloadBase {
	kind: "landblock-pack";
	sourceAssetKind: "landblock-pack";
	residencyKind: "landblock";
	landblockId: number;
	landblockInfoId: number;
	classification: "outdoor" | "dungeon";
	sourceFacts: {
		buildings: PreparedLandblockStaticBuilding[];
	};
	prepared: {
		terrainMesh: PreparedTerrainMesh | null;
		outdoorStaticInstances: PreparedLandblockStaticInstance[];
		interiorCells: PreparedLandblockInteriorCell[];
		staticMeshes: PreparedLandblockStaticMesh[];
		spatialItems: PreparedLandblockSpatialItem[];
		staticLandblockBvh: PreparedLandblockBvh | null;
	};
	dependencies: {
		cellDatIds: number[];
		portalDatIds: number[];
		renderableAssetIds: string[];
	};
	diagnostics: {
		sourceRecords: {
			namespace: string;
			fileId: number;
			role: string;
			status: "loaded" | "missing" | "decode-failed";
		}[];
		errors: {
			namespace: string;
			fileId: number;
			role: string;
			errorCode: AssetErrorCode;
			detail: string;
		}[];
	};
}

export interface PreparedLandblockSummaryPayload extends PreparedAssetPayloadBase {
	kind: "landblock-summary";
	sourceAssetKind: "landblock-summary";
	residencyKind: "landblock";
	landblockId: number;
	landblockInfoId: number;
	classification: "outdoor" | "dungeon";
	sourceFacts: {
		buildings: PreparedLandblockSummaryBuilding[];
	};
	prepared: {
		terrainMesh: PreparedTerrainMesh | null;
	};
	dependencies: {
		cellDatIds: number[];
		renderableAssetIds: string[];
	};
	diagnostics: PreparedLandblockPackPayload["diagnostics"];
}

interface PreparedLandblockSummaryObject {
	instanceId: string;
	owningLandblockId: number;
	sourceDid: number;
	sourceAssetId: string | null;
	sourceIndex: number;
	localPlacement: PlacementTransformDto;
}

interface PreparedLandblockSummaryBuildingPortal {
	portalId: string;
	sourceIndex: number;
	flags: number;
	otherCellId: number;
	otherPortalId: number;
	stabList: number[];
	linkedEnvCellIds: number[];
}

export interface PreparedLandblockSummaryBuilding extends PreparedLandblockSummaryObject {
	numLeaves: number;
	portals: PreparedLandblockSummaryBuildingPortal[];
}

export interface PreparedLandblockInteriorCell {
	envCellId: number;
	environmentId: number;
	cellStructureId: number;
	localPlacement: PlacementTransformDto;
	surfaceIds: number[];
	portals: PreparedLandblockCellPortal[];
	portalApertures: PreparedPortalAperture[];
	staticObjectCount: number;
	cellBsp: PreparedPolygonSetBspNode;
	renderGeometry: PreparedPolygonSetRenderGeometry;
}

export interface PreparedPortalAperture {
	portalId: string;
	sourceIndex: number;
	polygonId: number;
	points: Vec3Dto[];
	plane: PreparedPortalAperturePlane | null;
}

interface PreparedPortalAperturePlane {
	normal: Vec3Dto;
	constant: number;
	source: "drawing-bsp-portal" | "derived-from-render-points";
}

type PreparedLandblockStaticInstanceKind =
	| "scenery"
	| "building"
	| "generated-scenery"
	| "indoor-static";

interface PreparedBounds {
	min: Vec3Dto;
	max: Vec3Dto;
}

export interface PreparedLandblockStaticInstance {
	instanceId: string;
	kind: PreparedLandblockStaticInstanceKind;
	owningLandblockId: number;
	owningEnvCellId: number | null;
	sourceDid: number;
	sourceAssetId: string;
	sourceIndex: number;
	localPlacement: PlacementTransformDto;
	sourceScale: Vec3Dto;
}

export interface PreparedLandblockStaticMesh {
	instanceId: string;
	kind: PreparedLandblockStaticInstanceKind;
	owningLandblockId: number;
	owningEnvCellId: number | null;
	sourceDid: number;
	sourceAssetId: string;
	sourceIndex: number;
	localPlacement: PlacementTransformDto;
	sourceScale: Vec3Dto;
	partIndex: number;
	gfxObjId: number;
	gfxObjAssetId: string;
	partPlacements: PlacementTransformDto[];
	partScale: Vec3Dto;
	sourceBounds: PreparedBounds | null;
	instanceBounds: PreparedBounds | null;
}

type PreparedLandblockSpatialItemKind =
	| "terrain"
	| "outdoor-static"
	| "building"
	| "env-cell"
	| "indoor-static"
	| "portal";

type PreparedLandblockSpatialItemMetadata =
	| { kind: "none" }
	| {
			kind: "terrain-quad";
			row: number;
			col: number;
			quadIndex: number;
			triangleIndices: [number, number];
	  };

export interface PreparedLandblockSpatialItem {
	id: string;
	kind: PreparedLandblockSpatialItemKind;
	ownerId: number | null;
	sourceAssetId: string | null;
	bounds: PreparedBounds;
	metadata: PreparedLandblockSpatialItemMetadata;
}

interface PreparedLandblockBvh {
	coordinateSpace: "landblock-render-local";
	landblockId: number;
	scope: "static-landblock";
	nodes: PreparedLandblockBvhNode[];
}

interface PreparedLandblockBvhNode {
	bounds: PreparedBounds;
	left: number | null;
	right: number | null;
	itemIndices: number[];
	kindMask: number;
}

interface PreparedPolygonSetUv {
	u: number;
	v: number;
}

interface PreparedPolygonSetVertex {
	id: number;
	origin: Vec3Dto;
	normal: Vec3Dto;
	uvs: PreparedPolygonSetUv[];
}

export interface PreparedPolygonSetVertexArray {
	vertexType: number | null;
	vertexCount: number;
	vertices: PreparedPolygonSetVertex[];
}

export interface PreparedPolygonSetPolygon {
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

export interface PreparedPolygonSetPlane {
	normal: Vec3Dto;
	d: number;
}

export interface PreparedPolygonSetPortalPoly {
	portalIndex: number;
	polyId: number;
}

export type PreparedPolygonSetBspNode =
	| {
			kind: "port";
			plane: PreparedPolygonSetPlane;
			pos: PreparedPolygonSetBspNode;
			neg: PreparedPolygonSetBspNode;
			sphere: SphereDto | null;
			polyIds: number[];
			portalPolys: PreparedPolygonSetPortalPoly[];
	  }
	| {
			kind: "leaf";
			index: number;
			solid: number;
			sphere: SphereDto | null;
			polyIds: number[];
	  }
	| {
			kind: "internal";
			tag: string;
			plane: PreparedPolygonSetPlane;
			pos: PreparedPolygonSetBspNode | null;
			neg: PreparedPolygonSetBspNode | null;
			sphere: SphereDto | null;
			polyIds: number[];
	  };

interface PreparedGfxObjPhysicsWitness {
	polygonCount: number;
	hasBsp: boolean;
	rootKind?: "port" | "leaf" | "internal" | null;
}

interface PreparedCellStructBspWitness {
	hasBsp: boolean;
	rootKind: "port" | "leaf" | "internal" | null;
}

export interface PreparedInteriorCellStructure {
	id: number;
	vertexArray: PreparedPolygonSetVertexArray;
	drawingPolygons: PreparedPolygonSetPolygon[];
	portalPolygonIds: number[];
	cellBspWitness: PreparedCellStructBspWitness;
	cellBsp: PreparedPolygonSetBspNode;
	physicsWitness: PreparedGfxObjPhysicsWitness;
	drawingBsp: PreparedPolygonSetBspNode | null;
	renderGeometry: PreparedPolygonSetRenderGeometry;
}

interface PreparedPolygonSetRenderTriangle {
	polygonId: number;
	surfaceId: number | null;
	firstVertex: number;
}

interface PreparedPolygonSetRenderBounds {
	min: Vec3Dto;
	max: Vec3Dto;
}

interface PreparedPolygonSetInvalidPolygon {
	polygonId: number;
	vertexIds: number[];
	missingVertexIds: number[];
}

export type PreparedFloat32Array = number[] | Float32Array;

export interface PreparedPolygonSetRenderGeometry {
	sourceId: number;
	vertexCount: number;
	triangleCount: number;
	/** Render-space coordinates: x is unchanged, y is AC z, z is negative AC y. */
	positions: PreparedFloat32Array;
	/** Render-space normals using the same basis as positions. */
	normals: PreparedFloat32Array;
	uvs: PreparedFloat32Array;
	triangles: PreparedPolygonSetRenderTriangle[];
	surfaceIds: number[];
	invalidPolygons?: PreparedPolygonSetInvalidPolygon[];
	skippedPolygonCount?: number;
	bounds: PreparedPolygonSetRenderBounds | null;
}

export interface PreparedGfxObjPayload extends PreparedAssetPayloadBase {
	kind: "gfx-obj";
	sourceAssetKind: "gfx-obj";
	gfxObjId: number;
	flags: number | null;
	surfaceIds: number[];
	vertexArray: PreparedPolygonSetVertexArray;
	drawingPolygons: PreparedPolygonSetPolygon[];
	drawingBsp: PreparedPolygonSetBspNode | null;
	physicsWitness: PreparedGfxObjPhysicsWitness;
	renderGeometry: PreparedPolygonSetRenderGeometry;
	sortCenter: Vec3Dto | null;
	didDegrade: number | null;
}

interface PreparedSetupModelPart {
	partIndex: number;
	gfxObjId: number;
	gfxObjAssetId: string;
	parentIndex: number | null;
	scale: Vec3Dto | null;
}

interface PreparedSetupModelLocation {
	key: number;
	partId: number;
	localPlacement: PlacementTransformDto;
}

interface PreparedSetupModelPlacementSet {
	key: number;
	localPlacements: PlacementTransformDto[];
	hookCount: number;
}

interface PreparedSetupModelLight {
	key: number;
	viewerSpaceLocation: PlacementTransformDto;
	color: number;
	intensity: number;
	falloff: number;
	coneAngle: number;
}

export interface PreparedSetupModelPayload extends PreparedAssetPayloadBase {
	kind: "setup-model";
	sourceAssetKind: "setup-model";
	setupModelId: number;
	flags: number | null;
	parts: PreparedSetupModelPart[];
	holdingLocations: PreparedSetupModelLocation[];
	connectionPoints: PreparedSetupModelLocation[];
	placementSets: PreparedSetupModelPlacementSet[];
	collisionWitness: {
		cylSphereCount: number;
		sphereCount: number;
	};
	height: number | null;
	radius: number | null;
	stepUp: number | null;
	stepDown: number | null;
	sortingSphere: SphereDto | null;
	selectionSphere: SphereDto | null;
	lights: PreparedSetupModelLight[];
	defaultAnimation: number | null;
	defaultScript: number | null;
	defaultMotionTable: number | null;
	defaultSoundTable: number | null;
	defaultScriptTable: number | null;
}

interface PreparedVisualAssetStubPayload extends PreparedAssetPayloadBase {
	kind: "visual-asset-stub";
	sourceAssetKind: string | null;
	debugPresentation: PreparedDebugPresentation;
}

interface PreparedDependencyManifestPayload extends PreparedAssetPayloadBase {
	kind: "dependency-manifest";
	sourceAssetKind: "dependency-manifest";
	dependencyAssetIds: string[];
}

interface PreparedUnknownAssetPayload extends PreparedAssetPayloadBase {
	kind: "unknown";
	sourceAssetKind: string | null;
	rawKind: string;
	debugPresentation: PreparedDebugPresentation | null;
}

export type PreparedAssetPayload =
	| PreparedLandblockPackPayload
	| PreparedLandblockSummaryPayload
	| PreparedGfxObjPayload
	| PreparedSetupModelPayload
	| PreparedVisualAssetStubPayload
	| PreparedDependencyManifestPayload
	| PreparedUnknownAssetPayload;

export type PreparedAssetKind = PreparedAssetPayload["kind"];

export interface PreparedAssetKindCounts {
	total: number;
	byKind: Partial<Record<PreparedAssetKind, number>>;
}

export interface PreparedAssetCacheDiagnostics {
	prepared: PreparedAssetKindCounts;
	retained: PreparedAssetKindCounts;
	evicted: PreparedAssetKindCounts;
}

export interface PreparedAssetRecord {
	request: AssetLookupRequestDto;
	response: AssetLookupResponseDto;
	payload: PreparedAssetPayload;
	preparedAt: string;
}

export interface PreparedAssetDependency {
	assetId: string;
}

type PreparedAssetDependencyReadiness =
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

	if (asset.payload.kind === "setup-model") {
		return [...new Set(asset.payload.parts.map((part) => part.gfxObjAssetId))]
			.sort()
			.map((assetId) => ({ assetId }));
	}

	if (asset.payload.kind === "landblock-pack") {
		return asset.payload.dependencies.renderableAssetIds.map((assetId) => ({
			assetId,
		}));
	}

	if (asset.payload.kind === "landblock-summary") {
		return [];
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

type AssetActivityStatus = "requested" | "prepared" | "failed";

export interface AssetActivityRecord {
	requestId: string;
	assetId: string;
	priority: AssetLookupRequestDto["priority"];
	status: AssetActivityStatus;
	channel: string;
	timestamp: string;
}

export interface PreparedAssetCacheMetadata {
	lastPreparedAtMs: number;
	lastRetainedAtMs: number;
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
	cacheMetadataByAssetId: Record<string, PreparedAssetCacheMetadata>;
	cacheDiagnostics: PreparedAssetCacheDiagnostics | null;
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
		cacheMetadataByAssetId: {},
		cacheDiagnostics: null,
		lastResponse: null,
		errorMessage: null,
		history: [],
	};
}
