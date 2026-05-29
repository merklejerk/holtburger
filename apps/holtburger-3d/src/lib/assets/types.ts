import type {
	AssetErrorCode,
	AssetLookupRequestDto,
	AssetLookupResponseDto,
	AssetProvenanceSource,
	PlacementTransformDto,
	SphereDto,
	Vec3Dto,
} from "../host/contracts";
import {
	formatHex32,
	formatRegionRenderProfileAssetId,
	formatTerrainMaterialAssetId,
} from "../landblocks";

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
	quadIndex: number;
	triangleInQuad: 0 | 1;
	debugTerrainPcode: number;
	averageHeight: number;
}

export interface PreparedTerrainMesh {
	landblockId: number;
	gridSize: number;
	tileSize: number;
	vertices: Vec3Dto[];
	triangles: PreparedTerrainTriangle[];
	quads: PreparedTerrainQuad[];
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

export interface PreparedIndoorCellPortal {
	portalId: string;
	sourceIndex: number;
	flags: number;
	polygonId: number;
	otherCellId: number;
	otherPortalId: number;
	targetEnvCellId: number;
}

interface PreparedSourceRecordDiagnostic {
	namespace: string;
	fileId: number;
	role: string;
	status: "loaded" | "missing" | "decode-failed";
}

interface PreparedSourceOmissionDiagnostic {
	namespace: string;
	fileId: number;
	role: string;
	reason: string;
	detail: string;
}

interface PreparedSourceLoadErrorDiagnostic {
	namespace: string;
	fileId: number;
	role: string;
	errorCode: AssetErrorCode;
	detail: string;
}

interface PreparedContentSourceDiagnostics {
	sourceRecords: PreparedSourceRecordDiagnostic[];
	omissions: PreparedSourceOmissionDiagnostic[];
	errors: PreparedSourceLoadErrorDiagnostic[];
}

export interface PreparedTerrainBvhItem {
	row: number;
	col: number;
	quadIndex: number;
	triangleIndices: [number, number];
}

export interface PreparedTerrainBvh {
	coordinateSpace: "landblock-outdoor-terrain-local";
	nodes: PreparedLandblockBvhNode[];
	items: PreparedTerrainBvhItem[];
}

interface PreparedOutdoorTerrainTriangle {
	terrainTriangleId: string;
	quadIndex: number;
	triangleInQuad: 0 | 1;
	vertexIndices: [number, number, number];
	averageHeight: number;
	bounds: PreparedBounds;
}

export interface PreparedTerrainQuad {
	terrainQuadId: string;
	row: number;
	col: number;
	quadIndex: number;
	sourceTerrainIndices: [number, number, number, number];
	vertexIndices: [number, number, number, number];
	triangleIndices: [number, number];
	diagonal: "southwest-northeast" | "southeast-northwest";
	cornerTerrainCodes: [number, number, number, number];
	pcode: number;
	averageHeight: number;
	bounds: PreparedBounds;
}

interface PreparedOutdoorTerrain {
	gridSize: number;
	tileSize: number;
	vertices: Vec3Dto[];
	triangles: PreparedOutdoorTerrainTriangle[];
	quads: PreparedTerrainQuad[];
	terrainBvh: PreparedTerrainBvh;
	minHeight: number;
	maxHeight: number;
	bounds: PreparedBounds | null;
}

interface PreparedLandblockOutdoorBuildingFacts {
	numLeaves: number;
	portals: PreparedLandblockBuildingPortal[];
}

interface PreparedLandblockGeneratedSceneryFacts {
	terrainIndex: number;
	sceneId: number;
	sceneTemplateIndex: number;
}

interface PreparedLandblockOutdoorStaticMember {
	kind: "explicit-object" | "building" | "generated-scenery";
	instanceId: string;
	sourceDid: number;
	sourceAssetId: string;
	sourceIndex: number;
	localPlacement: PlacementTransformDto;
	sourceScale: Vec3Dto;
	sourceBounds: PreparedBounds | null;
	instanceBounds: PreparedBounds | null;
	building: PreparedLandblockOutdoorBuildingFacts | null;
	generated: PreparedLandblockGeneratedSceneryFacts | null;
}

interface PreparedLandblockOutdoorDependencies {
	renderableSourceAssetIds: string[];
	materialAssetIds: string[];
}

export interface PreparedLandblockOutdoorPayload extends PreparedAssetPayloadBase {
	kind: "landblock-outdoor";
	sourceAssetKind: "landblock-outdoor";
	residencyKind: "outdoor-landblock";
	landblockId: number;
	regionId: number;
	regionNumber: number;
	classification: "outdoor";
	terrain: PreparedOutdoorTerrain;
	statics: PreparedLandblockOutdoorStaticMember[];
	outdoorBvh: PreparedOutdoorBvh | null;
	dependencies: PreparedLandblockOutdoorDependencies;
	diagnostics: PreparedContentSourceDiagnostics;
}

interface PreparedEnvCellResidencyBvhItem {
	envCellId: number;
	memberId: string;
	assetId: string;
	source: "building-portal-link" | "env-cell-placement" | "derived";
}

interface PreparedEnvCellResidencyBvh {
	coordinateSpace: "landblock-topology-residency";
	nodes: PreparedLandblockBvhNode[];
	items: PreparedEnvCellResidencyBvhItem[];
}

export type PreparedOutdoorBvhItem =
	| { kind: "static"; instanceId: string }
	| { kind: "building"; instanceId: string };

export interface PreparedOutdoorBvh {
	coordinateSpace: "landblock-render-local";
	nodes: PreparedLandblockBvhNode[];
	items: PreparedOutdoorBvhItem[];
}

interface PreparedLandblockBuildingPortal {
	portalId: string;
	sourceIndex: number;
	flags: number;
	otherCellId: number;
	otherPortalId: number;
	stabLocalCellIds: number[];
	linkedEnvCellIds: number[];
}

interface PreparedLandblockTopologyEnvCellMember {
	memberId: string;
	envCellId: number;
	assetId: string;
	localPlacement: PlacementTransformDto;
	visibleEnvCellIds: number[];
	restrictionObjectId: number | null;
	seenOutside: boolean | null;
}

type PreparedLandblockTopologyPortalEndpoint =
	| { kind: "landblock-building"; instanceId: string; portalId: string }
	| { kind: "env-cell"; envCellId: number; portalId: string }
	| { kind: "outside"; landblockId: number };

interface PreparedLandblockTopologyPortalLink {
	linkId: string;
	source: PreparedLandblockTopologyPortalEndpoint;
	target: PreparedLandblockTopologyPortalEndpoint;
	flags: number;
	otherCellId: number;
	otherPortalId: number;
	polygonId: number | null;
	sourceIndex: number;
}

export interface PreparedLandblockTopologyPayload extends PreparedAssetPayloadBase {
	kind: "landblock-topology";
	sourceAssetKind: "landblock-topology";
	residencyKind: "landblock";
	landblockId: number;
	landblockInfoId: number;
	classification: "outdoor" | "dungeon";
	envCells: PreparedLandblockTopologyEnvCellMember[];
	portalLinks: PreparedLandblockTopologyPortalLink[];
	envCellResidencyBvh: PreparedEnvCellResidencyBvh;
	diagnostics: PreparedContentSourceDiagnostics;
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

export interface PreparedBounds {
	min: Vec3Dto;
	max: Vec3Dto;
}

export interface PreparedLandblockBvhNode {
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
	materialVariantSignature?: string | null;
	firstVertex: number;
}

interface PreparedPolygonSetRenderBounds {
	min: Vec3Dto;
	max: Vec3Dto;
}

interface PreparedPolygonSetInvalidPolygon {
	polygonId: number;
	reason: string;
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

interface PreparedEnvCellSurfaceSlot {
	slotId: number;
	surfaceId: number;
	materialAssetId: string;
}

interface PreparedEnvCellPortal {
	portalId: string;
	sourceIndex: number;
	flags: number;
	polygonId: number;
	otherCellId: number;
	otherPortalId: number;
	targetEnvCellId: number | null;
	isOutsideTransition: boolean;
}

interface PreparedEnvCellStaticMember {
	instanceId: string;
	sourceDid: number;
	sourceAssetId: string;
	sourceIndex: number;
	localPlacement: PlacementTransformDto;
	sourceScale: Vec3Dto;
	sourceBounds: PreparedBounds | null;
	instanceBounds: PreparedBounds | null;
}

export type PreparedEnvCellBvhItem =
	| {
			kind: "render-geometry";
			polygonId: number | null;
			triangleRange: [number, number];
	  }
	| { kind: "static"; instanceId: string }
	| { kind: "portal"; portalId: string };

interface PreparedEnvCellBvh {
	coordinateSpace: "env-cell-local";
	nodes: PreparedLandblockBvhNode[];
	items: PreparedEnvCellBvhItem[];
}

interface PreparedEnvCellDependencies {
	renderableSourceAssetIds: string[];
	materialAssetIds: string[];
}

export interface PreparedEnvCellPayload extends PreparedAssetPayloadBase {
	kind: "env-cell";
	sourceAssetKind: "env-cell";
	residencyKind: "interior-cell";
	envCellId: number;
	regionId: number;
	regionNumber: number;
	environmentId: number;
	cellStructureId: number;
	localPlacement: PlacementTransformDto;
	surfaces: PreparedEnvCellSurfaceSlot[];
	portals: PreparedEnvCellPortal[];
	visibleEnvCellIds: number[];
	portalApertures: PreparedPortalAperture[];
	statics: PreparedEnvCellStaticMember[];
	renderGeometry: PreparedPolygonSetRenderGeometry;
	cellBsp: PreparedPolygonSetBspNode;
	localBvh: PreparedEnvCellBvh;
	dependencies: PreparedEnvCellDependencies;
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
	dependencies?: {
		materialAssetIds: string[];
	};
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
	textureVelocities: PreparedTextureVelocity[];
}

export type PreparedTextureVelocity =
	| {
			kind: "all-parts";
			uSpeed: number;
			vSpeed: number;
	  }
	| {
			kind: "part";
			partIndex: number;
			uSpeed: number;
			vSpeed: number;
	  };

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
	dependencies?: {
		gfxObjAssetIds: string[];
	};
}

export interface PreparedMaterialRecipePayload extends PreparedAssetPayloadBase {
	kind: "material-recipe";
	sourceAssetKind: "material-recipe";
	surfaceId: number;
	surfaceType: number;
	source:
		| { kind: "solid-color"; argb: number }
		| {
				kind: "texture";
				surfaceTextureId: number;
				selectedRenderSurfaceId: number | null;
				paletteId: number | null;
				renderSurfaceDefaultPaletteIds: number[];
		  };
	translucency: number;
	luminosity: number;
	diffuse: number;
	dependencies: {
		surfaceTextureAssetIds: string[];
		renderSurfaceAssetIds: string[];
		paletteAssetIds: string[];
	};
}

export interface PreparedSetupAppearancePayload extends PreparedAssetPayloadBase {
	kind: "setup-appearance";
	sourceAssetKind: "setup-appearance";
	setupModelId: number;
	appearanceKey: string;
	parts: {
		partIndex: number;
		gfxObjId: number;
		gfxObjAssetId: string;
		materialSlots: {
			slotIndex: number;
			surfaceId: number;
			materialAssetId: string;
		}[];
	}[];
	textureChanges: {
		partIndex: number;
		oldTexture: number;
		newTexture: number;
	}[];
	animPartChanges: {
		partIndex: number;
		partId: number;
	}[];
	paletteId: number | null;
	subPalettes: {
		subId: number;
		offset: number;
		numColors: number;
	}[];
	dependencies: {
		materialAssetIds: string[];
		paletteAssetIds: string[];
	};
}

export interface PreparedRegionDetailRole {
	role: "landscape" | "building" | "environment" | "object";
	sourceTerrainDescIndex: number;
	textureAssetId: string;
	textureDid: number;
	tiling: number;
	fadeNear: number;
	fadeFar: number;
}

interface PreparedTerrainColorVariation {
	minVertBright: number;
	maxVertBright: number;
	minVertSaturate: number;
	maxVertSaturate: number;
	minVertHue: number;
	maxVertHue: number;
	activeRenderPath: false;
}

export interface PreparedTerrainMaterialTypeEntry {
	terrainType: number;
	textureAssetId: string;
	textureDid: number;
	tiling: number;
	colorVariation: PreparedTerrainColorVariation | null;
}

interface PreparedTerrainAlphaMapEntry {
	alphaIndex: number;
	alphaTextureAssetId: string;
	alphaTextureDid: number;
	selector: number;
}

export interface PreparedTerrainRoadAlphaMapEntry {
	roadIndex: number;
	roadTextureAssetId: string;
	roadTextureDid: number;
	alphaTextureAssetId: string;
	alphaTextureDid: number;
	selector: number;
}

interface PreparedTerrainPcodeEncoding {
	terrainCodeBits: 5;
	roadCodeBits: 2;
	sizeBitMask: number;
}

interface PreparedRenderResourceDependencies {
	surfaceTextureAssetIds: string[];
	renderSurfaceAssetIds: string[];
	paletteAssetIds: string[];
}

export interface PreparedTerrainMaterialTablePayload extends PreparedAssetPayloadBase {
	kind: "terrain-material";
	sourceAssetKind: "terrain-material";
	residencyKind: "unknown";
	regionNumber: number;
	materialKind: "tex-merge-table";
	terrainTypes: PreparedTerrainMaterialTypeEntry[];
	terrainAlphaMaps: PreparedTerrainAlphaMapEntry[];
	roadAlphaMaps: PreparedTerrainRoadAlphaMapEntry[];
	pcodeEncoding: PreparedTerrainPcodeEncoding;
	dependencies: PreparedRenderResourceDependencies;
}

interface PreparedRegionRenderProfilePayload extends PreparedAssetPayloadBase {
	kind: "region-render-profile";
	sourceAssetKind: "region-render-profile";
	residencyKind: "unknown";
	regionId?: number;
	regionNumber: number;
	detailRoles: {
		landscape: PreparedRegionDetailRole | null;
		building: PreparedRegionDetailRole | null;
		environment: PreparedRegionDetailRole | null;
		object: PreparedRegionDetailRole | null;
	};
	dependencies: PreparedRenderResourceDependencies;
}

export interface PreparedSurfaceTexturePayload extends PreparedAssetPayloadBase {
	kind: "surface-texture";
	sourceAssetKind: "surface-texture";
	surfaceTextureId: number;
	textureType: number;
	unknown: number;
	selectedRenderSurfaceId: number | null;
	renderSurfaceIds: number[];
	dependencies: {
		renderSurfaceAssetIds: string[];
	};
}

export interface PreparedRenderSurfacePayload extends PreparedAssetPayloadBase {
	kind: "render-surface";
	sourceAssetKind: "render-surface";
	renderSurfaceId: number;
	unknown: number;
	width: number;
	height: number;
	formatRaw: number;
	format: string;
	sourceByteLength: number;
	sourceBytes: Uint8Array;
	defaultPaletteId: number | null;
	dependencies: {
		paletteAssetIds: string[];
	};
}

interface PreparedTextureMipLevel {
	level: number;
	width: number;
	height: number;
	formatRaw: number;
	format: string;
	byteLength: number;
	bytes: Uint8Array;
}

export interface PreparedTexturePayload extends PreparedAssetPayloadBase {
	kind: "prepared-texture";
	sourceAssetKind: "prepared-texture";
	renderSurfaceId: number;
	usage: "color" | "detail" | "mask" | "raw";
	outputFormat: "dxt1" | "dxt3" | "dxt5" | "r8" | "rgba8";
	mipPolicy: "none" | "retail4";
	colorSpace: "srgb" | "data" | "linear" | "source";
	sourceFormatRaw: number;
	sourceFormat: string;
	sourceWidth: number;
	sourceHeight: number;
	sourceByteLength: number;
	sourceHash: string;
	levels: PreparedTextureMipLevel[];
	dependencies: {
		renderSurfaceAssetIds: string[];
	};
	diagnostics: {
		generatedLevelCount: number;
		generatedByteLength: number;
		decodeMs: number;
		downsampleMs: number;
		encodeMs: number;
		totalMs: number;
	};
}

export interface PreparedPalettePayload extends PreparedAssetPayloadBase {
	kind: "palette";
	sourceAssetKind: "palette";
	paletteId: number;
	colorCount: number;
	colorsArgb: Uint32Array;
}

interface PreparedVisualAssetStubPayload extends PreparedAssetPayloadBase {
	kind: "visual-asset-stub";
	sourceAssetKind: string | null;
	debugPresentation: PreparedDebugPresentation;
}

interface PreparedUnknownAssetPayload extends PreparedAssetPayloadBase {
	kind: "unknown";
	sourceAssetKind: string | null;
	rawKind: string;
	debugPresentation: PreparedDebugPresentation | null;
}

export type PreparedAssetPayload =
	| PreparedLandblockOutdoorPayload
	| PreparedLandblockTopologyPayload
	| PreparedEnvCellPayload
	| PreparedGfxObjPayload
	| PreparedSetupModelPayload
	| PreparedMaterialRecipePayload
	| PreparedSetupAppearancePayload
	| PreparedTerrainMaterialTablePayload
	| PreparedRegionRenderProfilePayload
	| PreparedSurfaceTexturePayload
	| PreparedRenderSurfacePayload
	| PreparedTexturePayload
	| PreparedPalettePayload
	| PreparedVisualAssetStubPayload
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
	if (asset.payload.kind === "landblock-outdoor") {
		return uniqueSortedAssetIds([
			formatTerrainMaterialAssetId(asset.payload.regionNumber),
			formatRegionRenderProfileAssetId(asset.payload.regionNumber),
			...asset.payload.statics.map((member) => member.sourceAssetId),
		]);
	}

	if (asset.payload.kind === "landblock-topology") {
		return uniqueSortedAssetIds(
			asset.payload.envCells.map((member) => member.assetId),
		);
	}

	if (asset.payload.kind === "env-cell") {
		return uniqueSortedAssetIds([
			formatRegionRenderProfileAssetId(asset.payload.regionNumber),
			...asset.payload.surfaces.map((surface) => surface.materialAssetId),
			...asset.payload.statics.map((member) => member.sourceAssetId),
		]);
	}

	if (asset.payload.kind === "setup-model") {
		const dependencies = asset.payload.dependencies;
		if (!dependencies) {
			return uniqueSortedAssetIds(
				asset.payload.parts.map((part) => part.gfxObjAssetId),
			);
		}
		return uniqueSortedAssetIds(dependencies.gfxObjAssetIds);
	}

	if (asset.payload.kind === "gfx-obj") {
		return uniqueSortedAssetIds(
			asset.payload.dependencies?.materialAssetIds ?? [],
		);
	}

	if (asset.payload.kind === "setup-appearance") {
		return uniqueSortedAssetIds([
			...asset.payload.dependencies.materialAssetIds,
			...asset.payload.dependencies.paletteAssetIds,
		]);
	}

	if (asset.payload.kind === "material-recipe") {
		return uniqueSortedAssetIds([
			...asset.payload.dependencies.surfaceTextureAssetIds,
			...asset.payload.dependencies.renderSurfaceAssetIds,
			...asset.payload.dependencies.paletteAssetIds,
		]);
	}

	if (asset.payload.kind === "terrain-material") {
		return uniqueSortedAssetIds([
			...asset.payload.dependencies.surfaceTextureAssetIds,
			...asset.payload.dependencies.renderSurfaceAssetIds,
			...asset.payload.dependencies.paletteAssetIds,
		]);
	}

	if (asset.payload.kind === "region-render-profile") {
		return uniqueSortedAssetIds([
			...asset.payload.dependencies.surfaceTextureAssetIds,
			...asset.payload.dependencies.renderSurfaceAssetIds,
			...asset.payload.dependencies.paletteAssetIds,
		]);
	}

	if (asset.payload.kind === "surface-texture") {
		return uniqueSortedAssetIds(
			asset.payload.dependencies.renderSurfaceAssetIds,
		);
	}

	if (asset.payload.kind === "render-surface") {
		return uniqueSortedAssetIds(asset.payload.dependencies.paletteAssetIds);
	}

	if (asset.payload.kind === "prepared-texture") {
		return [];
	}

	return [];
}

export function preparedDxtOutputFormat(
	formatRaw: number,
): Exclude<PreparedTexturePayload["outputFormat"], "r8" | "rgba8"> | null {
	switch (formatRaw) {
		case 0x3154_5844:
			return "dxt1";
		case 0x3354_5844:
			return "dxt3";
		case 0x3554_5844:
			return "dxt5";
		default:
			return null;
	}
}

export function formatAtlasReadyPreparedTextureAssetId(options: {
	renderSurfaceId: number;
	usage: PreparedTexturePayload["usage"];
}): string {
	return formatPreparedTextureAssetId({
		renderSurfaceId: options.renderSurfaceId,
		usage: options.usage,
		outputFormat: "rgba8",
		mipPolicy: "none",
		colorSpace: "linear",
	});
}

export function formatPreparedTextureAssetId(options: {
	renderSurfaceId: number;
	usage: PreparedTexturePayload["usage"];
	outputFormat: PreparedTexturePayload["outputFormat"];
	mipPolicy: PreparedTexturePayload["mipPolicy"];
	colorSpace: PreparedTexturePayload["colorSpace"];
}): string {
	return `prepared-texture/${formatHex32(options.renderSurfaceId)}?usage=${options.usage}&out=${options.outputFormat}&mips=${options.mipPolicy}&cs=${options.colorSpace}`;
}

function uniqueSortedAssetIds(
	assetIds: readonly string[],
): PreparedAssetDependency[] {
	return [...new Set(assetIds)].sort().map((assetId) => ({ assetId }));
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
