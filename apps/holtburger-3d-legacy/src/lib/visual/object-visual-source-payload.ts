import type {
	LandblockSourceIdentity,
	OutdoorStaticObjectDomain,
	PaletteIdentity,
	RegionDetailRoleFacts,
	RenderSurfaceIdentity,
	StaticBounds,
	StaticDomain,
	StaticMaterialSourceIdentity,
	SurfaceTextureIdentity,
} from "../static/contracts";

/** Shared pre-expansion source facts for object-like visual recipe emission. */
export interface ObjectVisualSourcePayload {
	readonly domain: Extract<
		StaticDomain,
		OutdoorStaticObjectDomain | "env-cell-system"
	>;
	readonly landblock: LandblockSourceIdentity;
	readonly regionRenderProfile: {
		readonly detailRoles: readonly RegionDetailRoleFacts[];
	};
	readonly objects: readonly ObjectVisualSourceObject[];
	readonly sourceAssets: readonly ObjectVisualSourceAssetFacts[];
	readonly paletteSources: readonly ObjectVisualPaletteSourceFacts[];
	readonly materialSlots: readonly ObjectVisualMaterialSlotFacts[];
	readonly materialSources: readonly ObjectVisualMaterialSourceFacts[];
	readonly textureRefs: readonly ObjectVisualTextureRefFacts[];
}

export interface ObjectVisualSourceIdentity {
	readonly kind: "static-object-source";
	readonly sourceAssetKind: "gfx-obj" | "setup-model" | "setup-appearance";
	readonly sourceDid: number;
}

export interface ObjectVisualObjectIdentity {
	readonly kind: "static-object-instance";
	readonly landblockId: number;
	readonly instanceId: string;
	readonly objectKind: "explicit-object" | "building" | "generated-scenery";
}

interface ObjectVisualPartIdentity {
	readonly kind: "static-object-part";
	readonly object: ObjectVisualObjectIdentity;
	readonly partIndex: number;
}

interface ObjectVisualMaterialSlotIdentity {
	readonly kind: "static-material-slot";
	readonly part: ObjectVisualPartIdentity;
	readonly slotIndex: number;
	readonly geometrySurfaceId: number;
	readonly materialSurfaceId: number;
}

export interface ObjectVisualPaletteViewFacts {
	readonly palette: PaletteIdentity;
	readonly firstIndex: number;
	readonly indexCount: number;
}

export interface ObjectVisualPaletteSourceFacts {
	readonly palette: PaletteIdentity;
	readonly colorCount: number;
}

interface ObjectVisualSourceObject {
	readonly identity: ObjectVisualObjectIdentity;
	readonly source: ObjectVisualSourceIdentity;
	readonly sourceIndex: number;
	readonly localPlacement: ObjectVisualPlacementTransform;
	readonly sourceScale: ObjectVisualVec3;
	readonly sourceBounds: StaticBounds | null;
	readonly instanceBounds: StaticBounds | null;
	readonly portalCount: number;
	readonly generated: ObjectVisualGeneratedFacts | null;
	readonly debug: ObjectVisualDebugProvenance;
	readonly owningEnvCellId?: number | null;
}

export interface ObjectVisualSourceAssetFacts {
	readonly identity: ObjectVisualSourceIdentity;
	readonly sourceAssetKind: ObjectVisualSourceIdentity["sourceAssetKind"];
	/** Default animation authored by setup-model sources. Direct gfx sources do not carry one. */
	readonly defaultAnimation: number | null;
	readonly partCount: number;
	readonly materialSlotCount: number;
	readonly renderTriangleCount: number;
	readonly skippedPolygonCount: number;
	readonly invalidPolygonCount: number;
	readonly physicsPolygonCount: number;
	readonly bounds: StaticBounds | null;
	readonly parts: readonly ObjectVisualPartSourceFacts[];
	readonly debug: ObjectVisualDebugProvenance;
}

export interface ObjectVisualPartSourceFacts {
	readonly partIndex: number;
	readonly source: ObjectVisualSourceIdentity;
	readonly gfxObj: ObjectVisualSourceIdentity;
	/** Source-local geometry lookup identity plus canonical raw gfx geometry identity. */
	readonly geometry: ObjectVisualSourceGeometryIdentity;
	readonly materialSlotCount: number;
	readonly renderTriangleCount: number;
	readonly skippedPolygonCount: number;
	readonly invalidPolygonCount: number;
	readonly physicsPolygonCount: number;
	readonly bounds: StaticBounds | null;
	readonly triangles: readonly ObjectVisualPartTriangleFacts[];
	readonly defaultPlacements: readonly ObjectVisualPlacementTransform[];
	readonly scale: ObjectVisualVec3;
	readonly materialSlots: readonly ObjectVisualPartMaterialSlotFacts[];
}

interface ObjectVisualSourceGeometryIdentity {
	readonly kind: "static-object-source-geometry";
	/** Higher-level source asset that authored this part reference. */
	readonly source: ObjectVisualSourceIdentity;
	/** Canonical raw gfx geometry payload used by object visual geometry sidecars. */
	readonly canonical: ObjectVisualCanonicalGeometryIdentity;
}

interface ObjectVisualCanonicalGeometryIdentity {
	readonly kind: "static-object-canonical-geometry";
	readonly gfxObj: ObjectVisualSourceIdentity;
	readonly partIndex: number;
}

interface ObjectVisualPartTriangleFacts {
	readonly polygonId: number;
	readonly geometrySurfaceId: number | null;
	readonly materialVariantSignature: string | null;
	readonly firstVertex: number;
}

export interface ObjectVisualPartMaterialSlotFacts {
	readonly slotIndex: number;
	readonly geometrySurfaceId: number;
	readonly materialSurfaceId: number;
	readonly material: StaticMaterialSourceIdentity;
	readonly materialVariantSignature: string | null;
	readonly paletteOverride: PaletteIdentity | null;
	readonly paletteViews: readonly ObjectVisualPaletteViewFacts[];
}

export interface ObjectVisualMaterialSlotFacts {
	readonly identity: ObjectVisualMaterialSlotIdentity;
	readonly object: ObjectVisualObjectIdentity;
	readonly source: ObjectVisualSourceIdentity;
	readonly gfxObj: ObjectVisualSourceIdentity;
	readonly material: StaticMaterialSourceIdentity;
	readonly materialVariantSignature: string | null;
	readonly paletteOverride: PaletteIdentity | null;
	readonly paletteViews: readonly ObjectVisualPaletteViewFacts[];
}

export interface ObjectVisualMaterialSourceFacts {
	readonly identity: StaticMaterialSourceIdentity;
	readonly surfaceId: number;
	readonly surfaceType: number;
	readonly source: ObjectVisualMaterialSourceKindFacts;
	readonly translucency: number;
	readonly luminosity: number;
	readonly diffuse: number;
}

type ObjectVisualMaterialSourceKindFacts =
	| {
			readonly kind: "solid-color";
			readonly argb: number;
	  }
	| {
			readonly kind: "texture";
			readonly texture: SurfaceTextureIdentity;
			readonly selectedRenderSurface: RenderSurfaceIdentity | null;
			readonly palette: PaletteIdentity | null;
			readonly renderSurfaceDefaultPalettes: readonly PaletteIdentity[];
	  };

export type ObjectVisualTextureRefFacts =
	| {
			readonly role: "surface-texture";
			readonly texture: SurfaceTextureIdentity;
			readonly renderSurface: RenderSurfaceIdentity | null;
			readonly palette: PaletteIdentity | null;
	  }
	| {
			readonly role: "render-surface";
			readonly renderSurface: RenderSurfaceIdentity;
			readonly width: number;
			readonly height: number;
			readonly format: string;
			readonly formatRaw: number;
			readonly palette: PaletteIdentity | null;
	  };

interface ObjectVisualGeneratedFacts {
	readonly terrainIndex: number;
	readonly sceneId: number;
	readonly sceneTemplateIndex: number;
}

interface ObjectVisualPlacementTransform {
	readonly origin: ObjectVisualVec3;
	readonly orientation: ObjectVisualQuaternion;
}

interface ObjectVisualVec3 {
	readonly x: number;
	readonly y: number;
	readonly z: number;
}

interface ObjectVisualQuaternion {
	readonly w: number;
	readonly x: number;
	readonly y: number;
	readonly z: number;
}

interface ObjectVisualDebugProvenance {
	readonly sourceAssetId: string;
}
