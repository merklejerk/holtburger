import type { EnvCellId, LandblockId } from "../game-types";
import type { AABB3, Vec3 } from "../math/types";
import type { ScenePlacement, SceneScope } from "../scene";
import type {
	TerrainPresentationSource,
	TerrainGenerationSource,
} from "../terrain/types";
import {
	LandblockLayerKind,
	type OutdoorStaticLayerKind,
} from "../runtime/scene-interest";
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
	/** Bounds in the object's root-local coordinate space. */
	readonly localBounds: AABB3 | null;
	readonly appearance: ResolvedObjectAppearance | null;
}

/** Reusable structured-interior definition embedded by environment cells. */
export interface ResolvedCellStructure {
	readonly id: string;
	readonly geometry: ResolvedGeometry;
	readonly surfaceSlotCount: number;
	/** Positive-chain containment planes encoded as normalized [nx, ny, nz, d] tuples. */
	readonly containmentPlanes: Float32Array;
	readonly portalPolygons: readonly {
		readonly cellStructPortalIndex: number;
		readonly polygonId: number;
	}[];
}

/** One object source resident with authored landblock-space placement and EnvCell residency. */
export interface ResolvedEnvCellResidentSource {
	readonly id: string;
	readonly sourceDid: string;
	readonly presentation: ResolvedObjectPresentation;
	readonly placement: ScenePlacement;
	readonly scale: Vec3;
	readonly localBounds: AABB3 | null;
	readonly appearance: ResolvedObjectAppearance | null;
}

/** Environment-cell presentation composed from a reusable structure and cell facts. */
export interface ResolvedEnvCellPresentation {
	readonly id: EnvCellId;
	readonly flags: number;
	readonly authoredCellId: number;
	readonly structure: ResolvedCellStructure;
	/** Structure-local transform into the containing landblock. */
	readonly structureToLandblock: ScenePlacement;
	/** Conservative cell extent already expressed in the containing landblock. */
	readonly landblockBounds: AABB3;
	readonly materials: readonly ResolvedMaterial[];
	readonly residents: readonly ResolvedEnvCellResidentSource[];
	readonly potentiallyVisibleEnvCellIds: ReadonlySet<EnvCellId>;
}

/** Stable identity for indexed portal aperture geometry. */
export type PortalApertureId = `portal-aperture:${string}`;

/** Indexed portal geometry in landblock-local coordinates. */
export interface ResolvedPortalAperture {
	readonly id: PortalApertureId;
	readonly kind: "env-cell" | "building-transition" | "effective-visibility";
	readonly positions: Float32Array;
	readonly triangleIndices: Uint32Array;
	readonly plane: {
		readonly normal: Vec3;
		readonly d: number;
	};
	readonly landblockBounds: AABB3;
	readonly polygonIds: readonly number[];
}

export type IndoorTopologyBoundaryReason =
	| "missing-reciprocal-identity"
	| "source-not-exact-match"
	| "target-not-exact-match"
	| "apertures-differ"
	| "accepted-sides-not-opposed"
	| "missing-source-cell-bounds"
	| "missing-target-cell-bounds"
	| "source-cell-crosses-portal-plane"
	| "target-cell-crosses-portal-plane";

export type PortalSpatialRelationship =
	| {
			readonly kind: "indoor-depth-continuous";
			readonly reciprocalApertureIndex: number;
	  }
	| {
			readonly kind: "indoor-topology-boundary";
			readonly reason: IndoorTopologyBoundaryReason;
	  }
	| {
			readonly kind: "exterior-transition";
			readonly exteriorLandblockId: LandblockId;
	  };

/** One host-validated directed crossing between scene scopes. */
export interface ResolvedPortalCrossing {
	readonly id: `portal-crossing:${string}`;
	readonly source: SceneScope;
	readonly target: SceneScope;
	/** Authored directed aperture used by topology, point, segment, and residency queries. */
	readonly sourceApertureIndex: number;
	/** Host-preprocessed aperture used by portal-window planning and material-free masks. */
	readonly visibilityApertureIndex: number;
	/** Static evidence explaining why the visibility aperture differs, if it does. */
	readonly visibilityProvenance:
		| {
				readonly kind: "authored-source";
		  }
		| {
				readonly kind: "reciprocal-intersection";
				readonly reciprocalApertureIndex: number;
				readonly maximumPlaneDeviation: number;
				readonly absoluteNormalDot: number;
				readonly componentCount: number;
		  };
	readonly acceptedSide: "positive" | "negative";
	readonly exactMatch: boolean;
	/** Whether an authored visible source surface owns fragments tying the aperture depth. */
	readonly maskDepthPolicy: "allow-equal-depth" | "reject-equal-depth";
	readonly reciprocalCrossingIndex: number | null;
	readonly sourcePortal:
		| {
				readonly kind: "env-cell";
				readonly envCellId: EnvCellId;
				readonly portalIndex: number;
				readonly polygonId: number;
				readonly flags: number;
		  }
		| {
				readonly kind: "building-transition";
				readonly buildingIndex: number;
				readonly buildingSourceDid: string;
				readonly portalIndex: number;
				readonly flags: number;
		  };
	readonly spatialRelationship: PortalSpatialRelationship;
}

/** Source-only terrain layer consumed by runtime texture and terrain residency. */
export interface ResolvedTerrainLayerSource {
	readonly kind: LandblockLayerKind.Terrain;
	readonly landblockId: LandblockId;
	/** Canonical landblock facts consumed by the terrain generator. */
	readonly generation: TerrainGenerationSource;
	/** Stable regional composition and deterministic texture facts for presentation. */
	readonly presentation: TerrainPresentationSource;
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
}

/** Outdoor-static source kinds admitted by shared geometry preparation and realization contracts. */
export type ResolvedOutdoorStaticLayerSource = ResolvedObjectLayerSource & {
	readonly kind: OutdoorStaticLayerKind;
};

/** One EnvCell-owned resident partition after every transform is expressed in landblock space. */
export interface ResolvedEnvCellStaticObjectSource {
	readonly kind: LandblockLayerKind.EnvCells;
	readonly landblockId: LandblockId;
	readonly envCellId: EnvCellId;
	readonly staticResidents: readonly ResolvedObjectResident[];
	/** Default-animated authored residents remain on the existing explicit deferral seam. */
	readonly dynamicResidents: readonly ResolvedObjectResident[];
}

/** Static-object source shape shared by outdoor layers and one exact EnvCell scope. */
export type ResolvedStaticObjectLayerSource =
	| ResolvedOutdoorStaticLayerSource
	| ResolvedEnvCellStaticObjectSource;

/** Environment-cell layer containing structured interiors and embedded residents. */
export interface ResolvedEnvCellLayerSource {
	readonly kind: LandblockLayerKind.EnvCells;
	readonly landblockId: LandblockId;
	readonly cells: readonly ResolvedEnvCellPresentation[];
	readonly portalApertures: readonly ResolvedPortalAperture[];
	readonly portalCrossings: readonly ResolvedPortalCrossing[];
	readonly diagnostics: {
		readonly unresolvedOutsideEndpoints: readonly {
			readonly envCellId: EnvCellId;
			readonly portalIndex: number;
			readonly polygonId: number;
		}[];
		readonly unresolvedVisibilityReciprocals: readonly {
			readonly crossingIndex: number;
			readonly sourceApertureId: PortalApertureId;
		}[];
		readonly visibilityApertureCounts: {
			readonly authoredSourceCrossings: number;
			readonly reciprocalIntersectionCrossings: number;
			readonly synthesizedIntersectionGeometries: number;
		};
	};
}

/** Canonical source union returned by the frontend layer resolver. */
export type ResolvedLandblockLayerSource =
	| ResolvedTerrainLayerSource
	| ResolvedObjectLayerSource
	| ResolvedEnvCellLayerSource;
