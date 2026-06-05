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

export type LandblockRenderLodPreset = "outdoor" | "outdoor-with-env-cells";

export type LandblockRenderPresetPriority = "resident-now" | "prefetch";

export interface LandblockRenderPresetBuildPolicy {
	atlasLayout: AtlasLayoutPolicy;
	terrainMaxLayerEntries: number;
}

export interface DesiredLandblockRenderPreset {
	landblockId: number;
	preset: LandblockRenderLodPreset;
	priority: LandblockRenderPresetPriority;
	requestId: string;
	buildPolicyRevision: string;
	texturePagePolicyRevision: string;
	buildPolicy: LandblockRenderPresetBuildPolicy;
}

export interface LandblockRenderPresetWorkerJob {
	type: "build-landblock-render-preset";
	jobId: string;
	landblockId: number;
	preset: LandblockRenderLodPreset;
	requestId: string;
	buildPolicyRevision: string;
	texturePagePolicyRevision: string;
	buildPolicy: LandblockRenderPresetBuildPolicy;
}

interface LandblockRenderPresetWorkerResultBase {
	type: "landblock-render-preset-built";
	jobId: string;
	landblockId: number;
	requestId: string;
	buildPolicyRevision: string;
	texturePagePolicyRevision: string;
	terrainArtifact: LandblockTerrainRenderArtifact | null;
	staticBundleLayers: readonly StaticLandblockRenderBundleLayer[];
	diagnostics: LandblockRenderPresetWorkerDiagnostics;
}

interface OutdoorLandblockRenderPresetWorkerResult
	extends LandblockRenderPresetWorkerResultBase {
	preset: "outdoor";
}

interface DetailedLandblockRenderPresetWorkerResult
	extends LandblockRenderPresetWorkerResultBase {
	preset: "outdoor-with-env-cells";
	detailedArtifacts: DetailedLandblockRenderArtifacts;
}

export type LandblockRenderPresetWorkerResult =
	| OutdoorLandblockRenderPresetWorkerResult
	| DetailedLandblockRenderPresetWorkerResult;

interface LandblockRenderPresetWorkerDiagnostics {
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
	preset: "outdoor-with-env-cells";
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

export function createLandblockRenderPresetWorkerJob(
	desired: DesiredLandblockRenderPreset,
): LandblockRenderPresetWorkerJob {
	return {
		type: "build-landblock-render-preset",
		jobId: [
			"landblock-render-preset",
			desired.landblockId,
			desired.preset,
			desired.requestId,
		].join(":"),
		landblockId: desired.landblockId,
		preset: desired.preset,
		requestId: desired.requestId,
		buildPolicyRevision: desired.buildPolicyRevision,
		texturePagePolicyRevision: desired.texturePagePolicyRevision,
		buildPolicy: desired.buildPolicy,
	};
}

export function compareDesiredLandblockRenderPresets(
	left: DesiredLandblockRenderPreset,
	right: DesiredLandblockRenderPreset,
): number {
	const priority = comparePresetPriority(left.priority, right.priority);
	if (priority !== 0) {
		return priority;
	}
	if (left.landblockId !== right.landblockId) {
		return left.landblockId - right.landblockId;
	}
	return comparePresetSpecificity(left.preset, right.preset);
}

export function chooseMoreDetailedLandblockPreset(
	left: LandblockRenderLodPreset,
	right: LandblockRenderLodPreset,
): LandblockRenderLodPreset {
	return presetRank(left) >= presetRank(right) ? left : right;
}

function comparePresetPriority(
	left: LandblockRenderPresetPriority,
	right: LandblockRenderPresetPriority,
): number {
	if (left === right) {
		return 0;
	}
	return left === "resident-now" ? -1 : 1;
}

function comparePresetSpecificity(
	left: LandblockRenderLodPreset,
	right: LandblockRenderLodPreset,
): number {
	return presetRank(right) - presetRank(left);
}

function presetRank(preset: LandblockRenderLodPreset): number {
	switch (preset) {
		case "outdoor":
			return 0;
		case "outdoor-with-env-cells":
			return 1;
	}
}
