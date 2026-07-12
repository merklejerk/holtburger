import type { DatAssetId, EnvCellId, LandblockId } from "../game-types";
import type { AABB3, Vec3 } from "../math/types";
import type { ScenePlacement } from "../scene";
import { LandblockLayerKind } from "../runtime/scene-interest";
import type {
	ResolvedGeometry,
	ResolvedMaterial,
	ResolvedObjectAppearance,
	ResolvedObjectPresentation,
} from "./presentation";

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
