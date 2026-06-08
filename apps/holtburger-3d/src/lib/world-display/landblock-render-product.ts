import type {
	PreparedEnvCellPayload,
	PreparedFloat32Array,
	PreparedLandblockTopologyPayload,
	PreparedPolygonSetBspNode,
	PreparedPolygonSetRenderGeometry,
	PreparedPortalAperture,
} from "../assets/types";
import type { PlacementTransformDto, Vec3Dto } from "../host/contracts";
import type { RenderBvhItemKey } from "./prepared-bvh-visibility";
import type { RenderChunkPlacement } from "./render-chunks";
import type {
	StaticBundleMaterialRecord,
	StaticBundleTexturePage,
	StaticObjectBundleArtifact,
	VirtualTexturePageRef,
} from "./static-bundle-layer";
import type { AtlasLayoutPolicy } from "./texture-pages/atlas-layout-planner";
import type { LandblockTerrainRenderArtifact } from "./terrain-render-artifact";
import type { RenderArtifactDiagnosticFamily } from "./render-regression-diagnostics";

export type LandblockRenderProduct =
	| "outdoor"
	| "outdoor-env-cells"
	| "dungeon-env-cells";

export interface StaticLandblockProductKey {
	landblockId: number;
	product: LandblockRenderProduct;
	buildPolicyRevision: string;
	texturePagePolicyRevision: string;
}

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
	artifactFilter: readonly RenderArtifactDiagnosticFamily[] | null;
}

export type LandblockRenderArtifact =
	| LandblockTerrainRenderArtifact
	| StaticObjectBundleArtifact
	| DetailedLandblockRenderArtifacts;

export interface LandblockRenderProductWorkerResult {
	type: "landblock-render-product-built";
	jobId: string;
	landblockId: number;
	product: LandblockRenderProduct;
	requestId: string;
	buildPolicyRevision: string;
	texturePagePolicyRevision: string;
	artifacts: readonly LandblockRenderArtifact[];
	diagnostics: LandblockRenderProductWorkerDiagnostics;
}

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
	artifactKind: "detailed-landblock";
	key: string;
	landblockId: number;
	product: "outdoor-env-cells" | "dungeon-env-cells";
	requestId: string;
	buildPolicyRevision: string;
	texturePagePolicyRevision: string;
	selectedEnvCellIds: readonly number[];
	structuredInteriorMaterialRecords: readonly StaticBundleMaterialRecord[];
	structuredInteriorTexturePageRefs: readonly VirtualTexturePageRef[];
	structuredInteriorTexturePages: readonly StaticBundleTexturePage[];
	structuredInteriorCells: readonly DetailedStructuredInteriorCellArtifact[];
	cellStructureMetadata: readonly DetailedCellStructureMetadata[];
	portalLinks: readonly DetailedPortalLinkSidecar[];
	portalApertures: readonly DetailedPortalApertureSidecar[];
	visibility: DetailedLandblockVisibilitySidecars;
	spatial: DetailedLandblockSpatialSidecars;
	diagnostics?: DetailedLandblockDebugDiagnostics;
}

export function getLandblockTerrainRenderArtifact(
	result: LandblockRenderProductWorkerResult,
): LandblockTerrainRenderArtifact | null {
	return result.artifacts.find(isLandblockTerrainRenderArtifact) ?? null;
}

export function getStaticObjectBundleArtifacts(
	result: LandblockRenderProductWorkerResult,
): readonly StaticObjectBundleArtifact[] {
	return result.artifacts.filter(isStaticObjectBundleArtifact);
}

export function getDetailedLandblockRenderArtifacts(
	result: LandblockRenderProductWorkerResult,
): DetailedLandblockRenderArtifacts | null {
	return result.artifacts.find(isDetailedLandblockRenderArtifacts) ?? null;
}

function isLandblockTerrainRenderArtifact(
	artifact: LandblockRenderArtifact,
): artifact is LandblockTerrainRenderArtifact {
	return artifact.artifactKind === "terrain";
}

function isStaticObjectBundleArtifact(
	artifact: LandblockRenderArtifact,
): artifact is StaticObjectBundleArtifact {
	return artifact.artifactKind === "static-object-bundle";
}

function isDetailedLandblockRenderArtifacts(
	artifact: LandblockRenderArtifact,
): artifact is DetailedLandblockRenderArtifacts {
	return artifact.artifactKind === "detailed-landblock";
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
	materialSlices: readonly DetailedStructuredInteriorMaterialSlice[];
	portals: readonly DetailedEnvCellPortalSidecar[];
	portalApertureKeys: readonly string[];
	staticObjectCount: number;
	cellBsp: PreparedPolygonSetBspNode;
	renderGeometry: PreparedPolygonSetRenderGeometry;
}

interface DetailedStructuredInteriorMaterialSlice {
	key: string;
	cellKey: string;
	envCellId: number;
	materialSlotIndex: number;
	surfaceId: number;
	geometrySurfaceId: number;
	materialRecordKey: string;
	materialVariantSignature: string | null;
	positions: PreparedFloat32Array;
	uvs: PreparedFloat32Array;
	indices: Uint16Array | Uint32Array;
	triangleCount: number;
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
	artifactFilter: ReadonlySet<RenderArtifactDiagnosticFamily> | null = null,
): LandblockRenderProductWorkerJob {
	const artifactFilterValues = artifactFilter ? [...artifactFilter].sort() : null;
	const artifactFilterLabel =
		artifactFilterValues === null
			? "all"
			: artifactFilterValues.length > 0
				? artifactFilterValues.join(",")
				: "none";
	return {
		type: "build-landblock-render-product",
		jobId: [
			formatStaticLandblockProductKey(createStaticLandblockProductKey(desired)),
			`artifacts:${artifactFilterLabel}`,
		].join(":"),
		landblockId: desired.landblockId,
		product: desired.product,
		requestId: desired.requestId,
		buildPolicyRevision: desired.buildPolicyRevision,
		texturePagePolicyRevision: desired.texturePagePolicyRevision,
		buildPolicy: desired.buildPolicy,
		artifactFilter: artifactFilterValues,
	};
}

export function createStaticLandblockProductKey(
	input: StaticLandblockProductKey,
): StaticLandblockProductKey {
	return {
		landblockId: input.landblockId,
		product: input.product,
		buildPolicyRevision: input.buildPolicyRevision,
		texturePagePolicyRevision: input.texturePagePolicyRevision,
	};
}

export function createStaticLandblockProductKeyFromResult(
	result: LandblockRenderProductWorkerResult,
): StaticLandblockProductKey {
	return createStaticLandblockProductKey(result);
}

export function formatStaticLandblockProductKey(
	key: StaticLandblockProductKey,
): string {
	return [
		"landblock-render-product",
		key.landblockId,
		key.product,
		key.buildPolicyRevision,
		key.texturePagePolicyRevision,
	].join(":");
}

export function compareStaticLandblockProductKeys(
	left: StaticLandblockProductKey,
	right: StaticLandblockProductKey,
): number {
	if (left.landblockId !== right.landblockId) {
		return left.landblockId - right.landblockId;
	}
	const productOrder = compareProductOrder(left.product, right.product);
	if (productOrder !== 0) {
		return productOrder;
	}
	const buildPolicyOrder = left.buildPolicyRevision.localeCompare(
		right.buildPolicyRevision,
	);
	if (buildPolicyOrder !== 0) {
		return buildPolicyOrder;
	}
	return left.texturePagePolicyRevision.localeCompare(
		right.texturePagePolicyRevision,
	);
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
