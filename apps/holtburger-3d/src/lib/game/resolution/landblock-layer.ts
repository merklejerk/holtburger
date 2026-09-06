import type { PlacedStaticLight } from "./presentation";
import type { DatAssetId, EnvCellId, LandblockOwnerId } from "../game-types";
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
	ResolvedMapSurface,
	ResolvedMaterial,
	ResolvedObjectPresentation,
} from "./presentation";

/** Landblock-scoped identity of one DAT-authored resident. */
export interface ResolvedResidentIdentity {
	readonly kind: "authored";
	readonly sourceId: string;
}

/** Stable string key for resource addressing and diagnostics, derived from the identity. */
export function residentKey(identity: ResolvedResidentIdentity): string {
	return identity.sourceId;
}

interface ResolvedBehaviorIds {
	/** Setup default sound table retained for the authored-effects plan. */
	readonly soundTableId: DatAssetId | null;
	/**
	 * Motion table this resident animates from, or `null` when it has none.
	 *
	 * Only live entities carry one. Retail installs a setup's motion table for any non-static
	 * object and reserves `DefaultAnimation` for static ones, so static scenery keeps animating from
	 * its default clip and stages no motion closure.
	 */
	readonly motionTableId: DatAssetId | null;
}

type ResolvedScriptIds =
	| {
			readonly physicsScriptId: DatAssetId;
			readonly physicsScriptTableId: DatAssetId | null;
	  }
	| {
			readonly physicsScriptId: null;
			readonly physicsScriptTableId: DatAssetId;
	  };

/** Closed setup-default capability classification, computed once at the decode boundary. */
export type ResolvedObjectBehavior = ResolvedBehaviorIds &
	(
		| {
				readonly kind: "none";
				readonly animationId: null;
				readonly physicsScriptId: null;
				readonly physicsScriptTableId: null;
		  }
		| {
				readonly kind: "animation-only";
				readonly animationId: DatAssetId;
				readonly physicsScriptId: null;
				readonly physicsScriptTableId: null;
		  }
		| (ResolvedScriptIds & {
				readonly kind: "script-only";
				readonly animationId: null;
		  })
		| (ResolvedScriptIds & {
				readonly kind: "animation-and-script";
				readonly animationId: DatAssetId;
		  })
	);

/** One placed object resident resolved from a layer source. */
export interface ResolvedObjectResident {
	readonly identity: ResolvedResidentIdentity;
	/** Setup DAT identity, or null for a direct GfxObj presentation. */
	readonly setupId: DatAssetId | null;
	readonly presentation: ResolvedObjectPresentation;
	/** IDs only; decoded animation/script payloads remain behind content asset requests. */
	readonly behavior: ResolvedObjectBehavior;
	readonly placement: ScenePlacement;
	readonly scale: Vec3;
	/** Bounds in the object's root-local coordinate space. */
	readonly localBounds: AABB3 | null;
}

/** Authored resident promoted from static baking because its setup owns a default animation. */
export interface AuthoredDynamicSource {
	readonly identity: ResolvedResidentIdentity;
	/** Exact SetupModel DAT identity used to load setup-default behavior assets. */
	readonly setupId: DatAssetId;
	/** Resolved visual selection; immutable resources are shared by canonical appearance identity. */
	readonly presentation: ResolvedObjectPresentation;
	readonly scale: Vec3;
	readonly placement: ScenePlacement;
	readonly localBounds: AABB3 | null;
	/**
	 * Setup-default behavior that warrants promotion; decoded payloads are deliberately absent.
	 *
	 * Includes `script-only`: a resident whose setup owns a physics script but no animation is
	 * still dynamic, because its script can emit particles, play sounds, and chain further scripts.
	 * Its parts simply keep their authored pose.
	 */
	readonly behavior: Extract<
		ResolvedObjectBehavior,
		{
			readonly kind: "animation-only" | "animation-and-script" | "script-only";
		}
	>;
}

/** Reusable structured-interior definition embedded by environment cells. */
export interface ResolvedCellStructure {
	readonly id: string;
	readonly geometry: ResolvedGeometry;
	readonly surfaceSlotCount: number;
	/** Positive-chain containment planes encoded as normalized [nx, ny, nz, d] tuples. */
	readonly containmentPlanes: Float32Array;
	/**
	 * Host-derived walkable floor for the overhead map, in structure-local coordinates.
	 *
	 * Empty for structures with no walkable surface at all — shafts and solid fills — which the
	 * shipped census found for roughly a fifth of authored structures.
	 */
	readonly mapFloor: ResolvedMapSurface;
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
	readonly setupId: DatAssetId | null;
	readonly behavior: ResolvedObjectBehavior;
	readonly placement: ScenePlacement;
	readonly scale: Vec3;
	readonly localBounds: AABB3 | null;
}

/** Environment-cell presentation composed from a reusable structure and cell facts. */
export interface ResolvedEnvCellPresentation {
	readonly id: EnvCellId;
	readonly flags: number;
	readonly authoredCellId: number;
	/** Host-derived depth-continuous visibility island, as a record-local dense ordinal. */
	readonly visibilityIslandOrdinal: number;
	readonly structure: ResolvedCellStructure;
	/** Structure-local transform into the containing landblock. */
	readonly structureToLandblock: ScenePlacement;
	/** Shell extent in the containing landblock, absent for a non-rendering cell. */
	readonly landblockBounds: AABB3 | null;
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
			readonly exteriorLandblockId: LandblockOwnerId;
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
	/**
	 * Host-proven coincident-junction identity shared by every crossing on one coplanar
	 * overlapping footprint, or null. Equal ids license the compositor's equal-depth advance.
	 */
	readonly junctionGroupId: number | null;
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
	readonly landblockId: LandblockOwnerId;
	/** Canonical landblock facts consumed by the terrain generator. */
	readonly generation: TerrainGenerationSource;
	/** Stable regional composition and deterministic texture facts for presentation. */
	readonly presentation: TerrainPresentationSource;
}

/** Fields shared by outdoor static layers backed by object presentations. */
interface ResolvedOutdoorStaticLayerSourceFields<
	TKind extends OutdoorStaticLayerKind,
> {
	readonly kind: TKind;
	readonly landblockId: LandblockOwnerId;
	readonly staticResidents: readonly ResolvedObjectResident[];
	readonly dynamicSources: readonly AuthoredDynamicSource[];
}

/** Building source with the derived blocker geometry consumed by the overhead map. */
export interface ResolvedBuildingLayerSource extends ResolvedOutdoorStaticLayerSourceFields<LandblockLayerKind.Buildings> {
	/**
	 * Host-derived overhead-map blocker silhouettes keyed by presentation source identity.
	 *
	 * Keyed by source rather than resident because one building model is placed many times and the
	 * silhouette is identical for every placement; the key is the resident's presentation identity,
	 * so the join needs no parsing.
	 */
	readonly mapBlockers: ReadonlyMap<string, ResolvedMapSurface>;
}

/** Compiler-only constraint preventing scenery from masquerading as a map-geometry producer. */
interface BlockerFreeMapSource {
	readonly mapBlockers?: never;
}

/** Scenery source deliberately excluded from overhead-map geometry. */
export type ResolvedSceneryLayerSource =
	| (ResolvedOutdoorStaticLayerSourceFields<LandblockLayerKind.Objects> &
			BlockerFreeMapSource)
	| (ResolvedOutdoorStaticLayerSourceFields<LandblockLayerKind.Generated> &
			BlockerFreeMapSource);

/** Closed outdoor-static source union consumed by preparation and realization. */
export type ResolvedOutdoorStaticLayerSource =
	ResolvedBuildingLayerSource | ResolvedSceneryLayerSource;

/** One EnvCell-owned resident partition after every transform is expressed in landblock space. */
export interface ResolvedEnvCellStaticObjectSource {
	readonly kind: LandblockLayerKind.EnvCells;
	readonly landblockId: LandblockOwnerId;
	readonly envCellId: EnvCellId;
	readonly staticResidents: readonly ResolvedObjectResident[];
	/** Animation sources retained so worker transfer cannot detach their shared visual buffers. */
	readonly dynamicSources: readonly AuthoredDynamicSource[];
	/**
	 * Authored lights to bake into this cell's residents, in landblock space.
	 *
	 * Carried on the source rather than passed beside it so the lights travel with the geometry
	 * they light: a resident job cannot be prepared without them and silently render unlit.
	 * Outdoor sources have no equivalent field: their authored lights are evaluated at draw time
	 * rather than baked, so they are gathered from the residents themselves instead of riding
	 * along with the geometry.
	 */
	readonly staticLights: readonly PlacedStaticLight[];
}

/** Static-object source shape shared by outdoor layers and one exact EnvCell scope. */
export type ResolvedStaticObjectLayerSource =
	ResolvedOutdoorStaticLayerSource | ResolvedEnvCellStaticObjectSource;

/** Environment-cell layer containing structured interiors and embedded residents. */
export interface ResolvedEnvCellLayerSource {
	readonly kind: LandblockLayerKind.EnvCells;
	readonly landblockId: LandblockOwnerId;
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
	| ResolvedOutdoorStaticLayerSource
	| ResolvedEnvCellLayerSource;
