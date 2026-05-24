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

interface PreparedTerrainBvhItem {
	row: number;
	col: number;
	quadIndex: number;
	triangleIndices: [number, number];
}

interface PreparedTerrainBvh {
	coordinateSpace: "landblock-terrain-local";
	nodes: PreparedLandblockBvhNode[];
	items: PreparedTerrainBvhItem[];
}

interface PreparedLandblockTerrainTriangle {
	terrainTriangleId: string;
	quadIndex: number;
	triangleInQuad: 0 | 1;
	vertexIndices: [number, number, number];
	averageHeight: number;
	bounds: PreparedBounds;
}

interface PreparedTerrainQuad {
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

interface PreparedLandblockTerrain {
	gridSize: number;
	tileSize: number;
	vertices: Vec3Dto[];
	triangles: PreparedLandblockTerrainTriangle[];
	quads: PreparedTerrainQuad[];
	terrainBvh: PreparedTerrainBvh;
	minHeight: number;
	maxHeight: number;
	bounds: PreparedBounds | null;
}

export interface PreparedLandblockTerrainPayload extends PreparedAssetPayloadBase {
	kind: "landblock-terrain";
	sourceAssetKind: "landblock-terrain";
	residencyKind: "outdoor-landblock";
	landblockId: number;
	regionId: number;
	regionNumber: number;
	terrain: PreparedLandblockTerrain;
	diagnostics: PreparedLandblockPackPayload["diagnostics"];
}

interface PreparedLandblockBuildingShellBvhItem {
	kind: "building-shell";
	shellId: string;
}

interface PreparedLandblockBuildingShellBvh {
	coordinateSpace: "landblock-local";
	nodes: PreparedLandblockBvhNode[];
	items: PreparedLandblockBuildingShellBvhItem[];
}

interface PreparedLandblockBuildingShellMember {
	shellId: string;
	buildingIndex: number;
	sourceDid: number;
	sourceAssetId: string;
	localPlacement: PlacementTransformDto;
	sourceScale: Vec3Dto;
	sourceBounds: PreparedBounds | null;
	instanceBounds: PreparedBounds | null;
}

export interface PreparedLandblockBuildingShellsPayload extends PreparedAssetPayloadBase {
	kind: "landblock-building-shells";
	sourceAssetKind: "landblock-building-shells";
	residencyKind: "outdoor-landblock";
	landblockId: number;
	shells: PreparedLandblockBuildingShellMember[];
	shellBvh: PreparedLandblockBuildingShellBvh;
	diagnostics: PreparedLandblockPackPayload["diagnostics"];
}

interface PreparedEnvCellResidencyBvhItem {
	envCellId: number;
	memberId: string;
	assetId: string;
	source: "building-portal-link" | "env-cell-placement" | "derived";
}

interface PreparedEnvCellResidencyBvh {
	coordinateSpace: "landblock-scene-residency";
	nodes: PreparedLandblockBvhNode[];
	items: PreparedEnvCellResidencyBvhItem[];
}

type PreparedOutdoorBvhItem =
	| { kind: "static"; instanceId: string }
	| { kind: "building"; instanceId: string }
	| { kind: "building-portal-anchor"; portalId: string };

interface PreparedOutdoorBvh {
	coordinateSpace: "landblock-render-local";
	nodes: PreparedLandblockBvhNode[];
	items: PreparedOutdoorBvhItem[];
}

interface PreparedLandblockScenePlacedSourceMemberBase {
	instanceId: string;
	memberId: string;
	sourceDid: number;
	sourceAssetId: string;
	sourceIndex: number;
	localPlacement: PlacementTransformDto;
	sourceScale: Vec3Dto;
	sourceBounds: PreparedBounds | null;
	instanceBounds: PreparedBounds | null;
}

interface PreparedLandblockSceneStaticMember extends PreparedLandblockScenePlacedSourceMemberBase {
	kind: "scenery" | "generated-scenery";
}

interface PreparedLandblockSceneBuildingPortal {
	portalId: string;
	sourceIndex: number;
	flags: number;
	otherCellId: number;
	otherPortalId: number;
	stabLocalCellIds: number[];
	linkedEnvCellIds: number[];
}

interface PreparedLandblockSceneBuildingMember extends PreparedLandblockScenePlacedSourceMemberBase {
	kind: "building";
	numLeaves: number;
	portals: PreparedLandblockSceneBuildingPortal[];
}

interface PreparedLandblockSceneEnvCellMember {
	memberId: string;
	envCellId: number;
	assetId: string;
	localPlacement: PlacementTransformDto;
	visibleEnvCellIds: number[];
	restrictionObjectId: number | null;
	seenOutside: boolean | null;
}

type PreparedLandblockScenePortalEndpoint =
	| { kind: "landblock-building"; instanceId: string; portalId: string }
	| { kind: "env-cell"; envCellId: number; portalId: string }
	| { kind: "outside"; landblockId: number };

interface PreparedLandblockScenePortalLink {
	linkId: string;
	source: PreparedLandblockScenePortalEndpoint;
	target: PreparedLandblockScenePortalEndpoint;
	flags: number;
	otherCellId: number;
	otherPortalId: number;
	polygonId: number | null;
	sourceIndex: number;
}

export interface PreparedLandblockScenePayload extends PreparedAssetPayloadBase {
	kind: "landblock-scene";
	sourceAssetKind: "landblock-scene";
	residencyKind: "landblock";
	landblockId: number;
	landblockInfoId: number;
	classification: "outdoor" | "dungeon";
	statics: PreparedLandblockSceneStaticMember[];
	buildings: PreparedLandblockSceneBuildingMember[];
	envCells: PreparedLandblockSceneEnvCellMember[];
	portalLinks: PreparedLandblockScenePortalLink[];
	envCellResidencyBvh: PreparedEnvCellResidencyBvh;
	outdoorBvh: PreparedOutdoorBvh | null;
	diagnostics: PreparedLandblockPackPayload["diagnostics"];
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

type PreparedEnvCellBvhItem =
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

export interface PreparedEnvCellPayload extends PreparedAssetPayloadBase {
	kind: "env-cell";
	sourceAssetKind: "env-cell";
	residencyKind: "interior-cell";
	envCellId: number;
	environmentId: number;
	cellStructureId: number;
	surfaces: PreparedEnvCellSurfaceSlot[];
	portals: PreparedEnvCellPortal[];
	visibleEnvCellIds: number[];
	portalApertures: PreparedPortalAperture[];
	statics: PreparedEnvCellStaticMember[];
	renderGeometry: PreparedPolygonSetRenderGeometry;
	cellBsp: PreparedPolygonSetBspNode;
	localBvh: PreparedEnvCellBvh;
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
	dependencies?: {
		gfxObjAssetIds: string[];
		setupAppearanceAssetId: string;
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
				renderTextureId: number;
				renderSurfaceIds: number[];
				paletteId: number | null;
				renderSurfaceDefaultPaletteIds: number[];
		  };
	translucency: number;
	luminosity: number;
	diffuse: number;
	dependencies: {
		renderTextureAssetIds: string[];
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

interface PreparedTerrainDetailLayer {
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

interface PreparedTerrainMaterialTypeEntry {
	terrainType: number;
	textureAssetId: string;
	textureDid: number;
	tiling: number;
	detail: PreparedTerrainDetailLayer | null;
	colorVariation: PreparedTerrainColorVariation | null;
}

interface PreparedTerrainAlphaMapEntry {
	alphaIndex: number;
	alphaTextureAssetId: string;
	alphaTextureDid: number;
	selector: number;
}

interface PreparedTerrainRoadAlphaMapEntry {
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

interface PreparedTerrainMaterialDependencies {
	renderTextureAssetIds: string[];
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
	dependencies: PreparedTerrainMaterialDependencies;
}

export interface PreparedRenderTexturePayload extends PreparedAssetPayloadBase {
	kind: "render-texture";
	sourceAssetKind: "render-texture";
	renderTextureId: number;
	textureType: number;
	unknown: number;
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

export interface PreparedPalettePayload extends PreparedAssetPayloadBase {
	kind: "palette";
	sourceAssetKind: "palette";
	paletteId: number;
	colorCount: number;
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
	| PreparedLandblockTerrainPayload
	| PreparedLandblockBuildingShellsPayload
	| PreparedLandblockScenePayload
	| PreparedEnvCellPayload
	| PreparedGfxObjPayload
	| PreparedSetupModelPayload
	| PreparedMaterialRecipePayload
	| PreparedSetupAppearancePayload
	| PreparedTerrainMaterialTablePayload
	| PreparedRenderTexturePayload
	| PreparedRenderSurfacePayload
	| PreparedPalettePayload
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

	if (asset.payload.kind === "landblock-terrain") {
		const payload = asset.payload;
		return uniqueSortedAssetIds([
			formatTerrainMaterialDependencyAssetId(payload.regionNumber),
		]);
	}

	if (asset.payload.kind === "landblock-building-shells") {
		return uniqueSortedAssetIds(
			asset.payload.shells.map((shell) => shell.sourceAssetId),
		);
	}

	if (asset.payload.kind === "landblock-scene") {
		return uniqueSortedAssetIds([
			...asset.payload.statics.map((member) => member.sourceAssetId),
			...asset.payload.buildings.map((member) => member.sourceAssetId),
			...asset.payload.envCells.map((member) => member.assetId),
		]);
	}

	if (asset.payload.kind === "env-cell") {
		return uniqueSortedAssetIds([
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
			...asset.payload.dependencies.renderTextureAssetIds,
			...asset.payload.dependencies.renderSurfaceAssetIds,
			...asset.payload.dependencies.paletteAssetIds,
		]);
	}

	if (asset.payload.kind === "terrain-material") {
		return uniqueSortedAssetIds([
			...asset.payload.dependencies.renderTextureAssetIds,
			...asset.payload.dependencies.renderSurfaceAssetIds,
			...asset.payload.dependencies.paletteAssetIds,
		]);
	}

	if (asset.payload.kind === "render-texture") {
		return uniqueSortedAssetIds(
			asset.payload.dependencies.renderSurfaceAssetIds,
		);
	}

	if (asset.payload.kind === "render-surface") {
		return uniqueSortedAssetIds(asset.payload.dependencies.paletteAssetIds);
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

function uniqueSortedAssetIds(
	assetIds: readonly string[],
): PreparedAssetDependency[] {
	return [...new Set(assetIds)].sort().map((assetId) => ({ assetId }));
}

function formatTerrainMaterialDependencyAssetId(regionNumber: number): string {
	return `terrain-material/${Math.trunc(regionNumber)}`;
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
