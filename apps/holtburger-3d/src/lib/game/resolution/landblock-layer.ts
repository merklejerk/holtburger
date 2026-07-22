import type { EnvCellId, LandblockId } from "../game-types";
import type { AABB3, Vec3 } from "../math/types";
import type { ScenePlacement } from "../scene";
import type {
	TerrainPresentationSource,
	TerrainGenerationSource,
} from "../terrain/types";
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
	/** Bounds in the object's root-local coordinate space. */
	readonly localBounds: AABB3 | null;
	readonly appearance: ResolvedObjectAppearance | null;
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

/** Environment-cell presentation composed from a reusable structure and cell facts. */
export interface ResolvedEnvCellPresentation {
	readonly id: EnvCellId;
	readonly structure: ResolvedCellStructure;
	/** Structure-local transform into the containing landblock. */
	readonly structureToLandblock: ScenePlacement;
	/** Conservative cell extent already expressed in the containing landblock. */
	readonly landblockBounds: AABB3;
	readonly materials: readonly ResolvedMaterial[];
	readonly embeddedStatics: readonly ResolvedObjectResident[];
}

/** Stable identity for one portal-graph scene residence. */
export type PortalGraphNodeId = `portal-node:${string}`;

/** Stable identity for one directed portal traversal edge. */
export type PortalGraphEdgeId = `portal-edge:${string}`;

/** Stable identity for indexed portal aperture geometry. */
export type PortalApertureId = `portal-aperture:${string}`;

/** A scene residence participating in portal traversal. */
export type ResolvedPortalGraphResidence =
	| { readonly kind: "outdoor"; readonly landblockId: LandblockId }
	| { readonly kind: "env-cell"; readonly envCellId: EnvCellId };

/** One residence node in the canonical portal graph. */
export interface ResolvedPortalGraphNode {
	readonly id: PortalGraphNodeId;
	readonly residence: ResolvedPortalGraphResidence;
}

/** Directed traversal edge optionally backed by aperture geometry. */
export interface ResolvedPortalGraphEdge {
	readonly id: PortalGraphEdgeId;
	readonly sourceNodeId: PortalGraphNodeId;
	readonly targetNodeId: PortalGraphNodeId;
	readonly apertureId: PortalApertureId | null;
}

/** Canonical traversal topology prepared by the host. */
export interface ResolvedPortalGraph {
	readonly nodes: ReadonlyMap<PortalGraphNodeId, ResolvedPortalGraphNode>;
	readonly edges: readonly ResolvedPortalGraphEdge[];
}

/** Indexed portal geometry in landblock-local coordinates. */
export interface ResolvedPortalAperture {
	readonly id: PortalApertureId;
	readonly kind: "env-cell" | "building-transition";
	readonly vertices: Float32Array;
	readonly indices: Uint32Array;
	readonly landblockBounds: AABB3;
	readonly visibleSide: "positive" | "negative" | "both";
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

/** Environment-cell layer containing structured interiors and embedded residents. */
export interface ResolvedEnvCellLayerSource {
	readonly kind: LandblockLayerKind.EnvCells;
	readonly landblockId: LandblockId;
	readonly cells: readonly ResolvedEnvCellPresentation[];
	readonly dynamicResidents: readonly ResolvedObjectResident[];
	readonly portalGraph: ResolvedPortalGraph;
	readonly portalApertures: readonly ResolvedPortalAperture[];
}

/** Canonical source union returned by the frontend layer resolver. */
export type ResolvedLandblockLayerSource =
	| ResolvedTerrainLayerSource
	| ResolvedObjectLayerSource
	| ResolvedEnvCellLayerSource;
