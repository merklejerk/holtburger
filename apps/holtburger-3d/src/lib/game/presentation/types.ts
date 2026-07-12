import type { DatAssetId, EnvCellId, LandblockId } from "../game-types";
import type { AABB3, Mat4, Vec3 } from "../math/types";
import type { ScenePlacement } from "../scene";
import type { LandblockLayerKind } from "../runtime/scene-interest";

/** Stable identity for one reusable resident presentation definition. */
export type ResolvedPresentationId = `presentation:${string}`;

/** Stable identity for canonical geometry prepared by the host. */
export type ResolvedGeometryId = `geometry:${string}`;

/** Stable identity for one normalized material source. */
export type ResolvedMaterialId = `material:${string}`;

/** Geometry buffers shared by object parts and embedded structures. */
export interface ResolvedGeometry {
	readonly id: ResolvedGeometryId;
	readonly positions: Float32Array;
	readonly normals: Float32Array;
	readonly textureCoordinates: Float32Array;
	readonly indices: Uint32Array;
	readonly materialSlotIndices: Uint16Array;
	readonly bounds: AABB3 | null;
}

/** Material source before texture atlas placement is assigned. */
export type ResolvedMaterial =
	| {
			readonly id: ResolvedMaterialId;
			readonly kind: "solid-color";
			readonly color: readonly [number, number, number, number];
	  }
	| {
			readonly id: ResolvedMaterialId;
			readonly kind: "texture";
			readonly colorTextureId: DatAssetId;
			readonly paletteTextureId: DatAssetId | null;
			readonly detailTextureId: DatAssetId | null;
	  };

/** One part in a setup-backed presentation hierarchy. */
export interface ResolvedObjectPart {
	readonly partIndex: number;
	readonly parentPartIndex: number | null;
	readonly geometry: ResolvedGeometry;
	readonly defaultScale: Vec3;
	readonly materials: readonly ResolvedMaterial[];
}

/** Named setup placement containing a local transform for every part. */
export interface ResolvedPlacementPose {
	readonly placementId: number;
	readonly partTransforms: readonly Mat4[];
}

/** Demand-loadable animation slice referenced by a motion graph. */
export interface ResolvedMotionClipRef {
	readonly animationId: DatAssetId;
	readonly firstFrame: number;
	readonly lastFrame: number | null;
	readonly frameRate: number;
}

/** Motion sequence plus authored root linear/angular velocity. */
export interface ResolvedMotionSequence {
	readonly key: string;
	readonly clips: readonly ResolvedMotionClipRef[];
	readonly velocity: Vec3 | null;
	readonly angularVelocity: Vec3 | null;
}

/** Normalized motion-table graph shared by dynamic residents. */
export interface ResolvedMotionGraph {
	readonly motionTableId: DatAssetId;
	readonly defaultStyle: number;
	readonly styleDefaults: ReadonlyMap<number, number>;
	readonly cycles: ReadonlyMap<string, ResolvedMotionSequence>;
	readonly modifiers: ReadonlyMap<string, ResolvedMotionSequence>;
	readonly transitions: ReadonlyMap<string, ResolvedMotionSequence>;
}

/** Setup defaults used by animation, audio, and effect systems. */
export interface ResolvedObjectEffectDefaults {
	readonly animationId: DatAssetId | null;
	readonly physicsScriptId: DatAssetId | null;
	readonly physicsScriptTableId: DatAssetId | null;
	readonly soundTableId: DatAssetId | null;
}

/** Immutable shared definition for a setup- or gfx-backed resident. */
export interface ResolvedObjectPresentation {
	readonly id: ResolvedPresentationId;
	readonly sourceAssetId: DatAssetId;
	readonly parts: readonly ResolvedObjectPart[];
	readonly placementPoses: ReadonlyMap<number, ResolvedPlacementPose>;
	readonly motion: ResolvedMotionGraph | null;
	readonly effects: ResolvedObjectEffectDefaults;
	readonly selectionBounds: AABB3 | null;
	readonly sortingBounds: AABB3 | null;
}

/** Per-resident palette, texture, and part substitutions. */
export interface ResolvedObjectAppearance {
	readonly paletteId: DatAssetId | null;
	readonly subPalettes: readonly {
		readonly paletteId: DatAssetId;
		readonly firstIndex: number;
		readonly indexCount: number;
	}[];
	readonly textureChanges: readonly {
		readonly partIndex: number;
		readonly oldTextureId: DatAssetId;
		readonly newTextureId: DatAssetId;
	}[];
	readonly partChanges: readonly {
		readonly partIndex: number;
		readonly geometryId: ResolvedGeometryId;
	}[];
}

/** One placed object resident resolved from a layer source. */
export interface ResolvedObjectResident {
	readonly id: string;
	readonly presentation: ResolvedObjectPresentation;
	readonly placement: ScenePlacement;
	readonly scale: Vec3;
	readonly bounds: AABB3 | null;
	readonly appearance: ResolvedObjectAppearance | null;
}

/** Building aperture connecting outdoor and environment-cell scenes. */
export interface ResolvedBuildingTransition {
	readonly id: string;
	readonly buildingResidentId: string;
	readonly bounds: AABB3;
	readonly targetEnvCellId: EnvCellId | null;
}

/** Reusable structured-interior definition embedded by environment cells. */
export interface ResolvedCellStructure {
	readonly id: string;
	readonly geometry: ResolvedGeometry;
	readonly surfaceSlotCount: number;
	readonly portalPolygonIndices: readonly number[];
	readonly cellBsp: unknown;
	readonly drawingBsp: unknown | null;
	readonly physicsBsp: unknown;
}

/** Portal edge belonging to one environment-cell resident. */
export interface ResolvedEnvCellPortal {
	readonly id: string;
	readonly polygonIndex: number;
	readonly targetEnvCellId: EnvCellId | null;
	readonly targetPortalId: string | null;
	readonly bounds: AABB3 | null;
}

/** Environment-cell presentation composed from a reusable structure and cell facts. */
export interface ResolvedEnvCellPresentation {
	readonly id: EnvCellId;
	readonly structure: ResolvedCellStructure;
	readonly placement: ScenePlacement;
	readonly bounds: AABB3;
	readonly materials: readonly ResolvedMaterial[];
	readonly portals: readonly ResolvedEnvCellPortal[];
	readonly embeddedStatics: readonly ResolvedObjectResident[];
}

/** Terrain feature metadata retained for runtime-generated meshes. */
export interface ResolvedTerrainFeature {
	readonly roadMaskTextureId: DatAssetId;
	readonly colorTextureIds: readonly DatAssetId[];
	readonly detailTextureId: DatAssetId;
}

/** Metadata-only terrain source consumed by the terrain service. */
export interface ResolvedTerrainLayerSource {
	readonly kind: LandblockLayerKind.Terrain;
	readonly landblockId: LandblockId;
	readonly features: readonly ResolvedTerrainFeature[];
	readonly heights: Float32Array;
	readonly featureIndices: Uint8Array;
}

/** Outdoor static layer containing residents backed by shared object definitions. */
export interface ResolvedObjectLayerSource {
	readonly kind:
		| LandblockLayerKind.Buildings
		| LandblockLayerKind.Objects
		| LandblockLayerKind.Generated;
	readonly landblockId: LandblockId;
	readonly staticResidents: readonly ResolvedObjectResident[];
	readonly dynamicResidents: readonly ResolvedObjectResident[];
	readonly buildingTransitions: readonly ResolvedBuildingTransition[];
}

/** Environment-cell layer containing structured interiors and embedded residents. */
export interface ResolvedEnvCellLayerSource {
	readonly kind: LandblockLayerKind.EnvCells;
	readonly landblockId: LandblockId;
	readonly cells: readonly ResolvedEnvCellPresentation[];
	readonly dynamicResidents: readonly ResolvedObjectResident[];
}

/** Canonical source union returned by the frontend layer resolver. */
export type ResolvedLandblockLayerSource =
	| ResolvedTerrainLayerSource
	| ResolvedObjectLayerSource
	| ResolvedEnvCellLayerSource;
