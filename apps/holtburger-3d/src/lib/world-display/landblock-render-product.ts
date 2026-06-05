import type {
	PreparedEnvCellPayload,
	PreparedLandblockTopologyPayload,
	PreparedPolygonSetBspNode,
	PreparedPolygonSetRenderGeometry,
	PreparedPortalAperture,
} from "../assets/types";
import type { PlacementTransformDto, Vec3Dto } from "../host/contracts";
import type { RenderBvhItemKey } from "./prepared-bvh-visibility";
import type { RenderChunkPlacement } from "./render-chunks";
import type { StaticLandblockRenderBundleLayer } from "./static-bundle-layer";
import type { AtlasLayoutPolicy } from "./texture-pages/atlas-layout-planner";
import type { LandblockTerrainRenderArtifact } from "./terrain-render-artifact";

export type LandblockRenderProduct =
	| "outdoor"
	| "outdoor-env-cells"
	| "dungeon-env-cells";

export type LandblockRenderProductPriority = "resident-now" | "prefetch";

export interface LandblockRenderProductBuildPolicy {
	atlasLayout: AtlasLayoutPolicy;
	terrainMaxLayerEntries: number;
}

export interface DesiredLandblockRenderProduct {
	landblockId: number;
	product: LandblockRenderProduct;
	priority: LandblockRenderProductPriority;
	requestId: string;
	buildPolicyRevision: string;
	texturePagePolicyRevision: string;
	buildPolicy: LandblockRenderProductBuildPolicy;
}

export interface LandblockRenderProductWorkerJob {
	type: "build-landblock-render-product";
	jobId: string;
	landblockId: number;
	product: LandblockRenderProduct;
	requestId: string;
	buildPolicyRevision: string;
	texturePagePolicyRevision: string;
	buildPolicy: LandblockRenderProductBuildPolicy;
}

interface LandblockRenderProductWorkerResultBase {
	type: "landblock-render-product-built";
	jobId: string;
	landblockId: number;
	requestId: string;
	buildPolicyRevision: string;
	texturePagePolicyRevision: string;
	terrainArtifact: LandblockTerrainRenderArtifact | null;
	staticBundleLayers: readonly StaticLandblockRenderBundleLayer[];
	diagnostics: LandblockRenderProductWorkerDiagnostics;
}

interface OutdoorLandblockRenderProductWorkerResult extends LandblockRenderProductWorkerResultBase {
	product: "outdoor";
	detailedArtifacts?: never;
}

interface TopologyLandblockRenderProductWorkerResult extends LandblockRenderProductWorkerResultBase {
	product: "outdoor-env-cells" | "dungeon-env-cells";
	detailedArtifacts: DetailedLandblockRenderArtifacts;
}

export type LandblockRenderProductWorkerResult =
	| OutdoorLandblockRenderProductWorkerResult
	| TopologyLandblockRenderProductWorkerResult;

interface LandblockRenderProductWorkerDiagnostics {
	status: "ready" | "partial" | "failed";
	messages: readonly string[];
}

type LandblockTopologyPortalEndpoint =
	PreparedLandblockTopologyPayload["portalLinks"][number]["source"];

type LandblockTopologyEnvCellResidencyBvh =
	PreparedLandblockTopologyPayload["envCellResidencyBvh"];

type EnvCellLocalBvh = PreparedEnvCellPayload["localBvh"];

export interface DetailedLandblockRenderArtifacts {
	key: string;
	landblockId: number;
	product: "outdoor-env-cells" | "dungeon-env-cells";
	requestId: string;
	buildPolicyRevision: string;
	texturePagePolicyRevision: string;
	selectedEnvCellIds: readonly number[];
	structuredInteriorCells: readonly DetailedStructuredInteriorCellArtifact[];
	cellStructureMetadata: readonly DetailedCellStructureMetadata[];
	portalLinks: readonly DetailedPortalLinkSidecar[];
	portalApertures: readonly DetailedPortalApertureSidecar[];
	visibility: DetailedLandblockVisibilitySidecars;
	spatial: DetailedLandblockSpatialSidecars;
	diagnostics?: DetailedLandblockDebugDiagnostics;
}

interface DetailedStructuredInteriorCellArtifact {
	key: string;
	envCellId: number;
	landblockId: number;
	regionNumber: number;
	environmentId: number;
	cellStructureId: number;
	renderChunk: RenderChunkPlacement;
	localPlacement: PlacementTransformDto;
	surfaceIds: readonly number[];
	portals: readonly DetailedEnvCellPortalSidecar[];
	portalApertureKeys: readonly string[];
	staticObjectCount: number;
	cellBsp: PreparedPolygonSetBspNode;
	renderGeometry: PreparedPolygonSetRenderGeometry;
}

interface DetailedCellStructureMetadata {
	key: string;
	envCellId: number;
	cellStructureId: number;
	environmentId: number;
	regionNumber: number;
	surfaceIds: readonly number[];
	portalIds: readonly string[];
	localPlacement: PlacementTransformDto;
}

interface DetailedEnvCellPortalSidecar {
	key: string;
	envCellId: number;
	portalId: string;
	sourceIndex: number;
	flags: number;
	polygonId: number;
	otherCellId: number;
	otherPortalId: number;
	targetEnvCellId: number | null;
	isOutsideTransition: boolean;
}

interface DetailedPortalLinkSidecar {
	key: string;
	landblockId: number;
	source: LandblockTopologyPortalEndpoint;
	target: LandblockTopologyPortalEndpoint;
	flags: number;
	otherCellId: number;
	otherPortalId: number;
	polygonId: number | null;
	sourceIndex: number;
}

interface DetailedPortalApertureSidecar {
	key: string;
	envCellId: number;
	portalId: string;
	sourceIndex: number;
	polygonId: number;
	points: readonly Vec3Dto[];
	plane: PreparedPortalAperture["plane"];
}

interface DetailedLandblockVisibilitySidecars {
	objectVisibilityRecords: readonly DetailedObjectVisibilityRecord[];
	cellVisibilityRecords: readonly DetailedCellVisibilityRecord[];
}

interface DetailedObjectVisibilityRecord {
	objectKey: string;
	owningLandblockId: number;
	owningEnvCellId: number | null;
	visibilityKeys: readonly RenderBvhItemKey[];
}

interface DetailedCellVisibilityRecord {
	envCellId: number;
	visibilityKeys: readonly RenderBvhItemKey[];
	visibleEnvCellIds: readonly number[];
}

interface DetailedLandblockSpatialSidecars {
	envCellResidencyBvh: LandblockTopologyEnvCellResidencyBvh;
	envCellLocalBvhs: readonly DetailedEnvCellLocalBvhSidecar[];
}

interface DetailedEnvCellLocalBvhSidecar {
	key: string;
	envCellId: number;
	localPlacement: PlacementTransformDto;
	localBvh: EnvCellLocalBvh;
}

interface DetailedLandblockDebugDiagnostics {
	messages: readonly string[];
}

export function createLandblockRenderProductWorkerJob(
	desired: DesiredLandblockRenderProduct,
): LandblockRenderProductWorkerJob {
	return {
		type: "build-landblock-render-product",
		jobId: [
			"landblock-render-product",
			desired.landblockId,
			desired.product,
			desired.requestId,
		].join(":"),
		landblockId: desired.landblockId,
		product: desired.product,
		requestId: desired.requestId,
		buildPolicyRevision: desired.buildPolicyRevision,
		texturePagePolicyRevision: desired.texturePagePolicyRevision,
		buildPolicy: desired.buildPolicy,
	};
}

export function compareDesiredLandblockRenderProducts(
	left: DesiredLandblockRenderProduct,
	right: DesiredLandblockRenderProduct,
): number {
	const priority = compareProductPriority(left.priority, right.priority);
	if (priority !== 0) {
		return priority;
	}
	if (left.landblockId !== right.landblockId) {
		return left.landblockId - right.landblockId;
	}
	return compareProductOrder(left.product, right.product);
}

function compareProductPriority(
	left: LandblockRenderProductPriority,
	right: LandblockRenderProductPriority,
): number {
	if (left === right) {
		return 0;
	}
	return left === "resident-now" ? -1 : 1;
}

function compareProductOrder(
	left: LandblockRenderProduct,
	right: LandblockRenderProduct,
): number {
	return productRank(left) - productRank(right);
}

function productRank(product: LandblockRenderProduct): number {
	switch (product) {
		case "outdoor":
			return 0;
		case "outdoor-env-cells":
			return 1;
		case "dungeon-env-cells":
			return 2;
	}
}
