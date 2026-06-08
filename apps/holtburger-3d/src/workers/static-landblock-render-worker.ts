import {
	formatAtlasReadyPreparedTextureAssetId,
	createInitialAssetChannelState,
	type PreparedRegionDetailRole,
	type PreparedRenderSurfacePayload,
	type AssetChannelState,
	type PreparedAssetRecord,
} from "../lib/assets/types";
import { resolveNormalizedPreparedTextureAssetIds } from "../lib/assets/material-texture-preparation-policy";
import {
	formatEnvCellAssetId,
	formatHex32,
	formatLandblockOutdoorAssetId,
	formatLandblockTopologyAssetId,
	formatRegionRenderProfileAssetId,
	formatTerrainMaterialAssetId,
} from "../lib/landblocks";
import type { AssetLookupRequestDto } from "../lib/host/contracts";
import {
	envRenderGeometryBvhItemKey,
	residencyCellBvhItemKey,
} from "../lib/world-display/prepared-bvh-visibility";
import { deriveStructuredCellRenderChunk } from "../lib/world-display/render-chunks";
import { buildStaticObjectBundleArtifact } from "../lib/world-display/static-bundle-layer-builder";
import { buildStaticBundleLayerTexturePages } from "../lib/world-display/static-bundle-layer-texture-pages";
import {
	collectStaticMaterialTexturePageRefs,
	collectStaticMaterialTextureRoutes,
	collectStaticPreparedTextureRouteAssetIds,
	findStaticMaterialTextureRefs,
	formatStaticMaterialFamilyKey,
	resolveStaticMaterialColor,
	resolveStaticIndexedMaterialRecord,
	resolveStaticMaterialReadiness,
	type StaticMaterialTextureRoute,
} from "../lib/world-display/static-material-artifacts";
import type {
	StaticBundleLayerWorkerJob,
	StaticBundleMaterialRecord,
	StaticObjectBundleArtifact,
	VirtualTexturePageRef,
} from "../lib/world-display/static-bundle-layer";
import { createCompactionEligibility } from "../lib/world-display/compaction/compaction-family-planner";
import { buildPolygonSetRenderGeometry } from "../lib/world-display/indexed-render-geometry";
import { buildLandblockTerrainRenderArtifact } from "../lib/world-display/terrain-render-artifact";
import type {
	DetailedLandblockRenderArtifacts,
	LandblockRenderArtifact,
	LandblockRenderProductWorkerJob,
	LandblockRenderProductWorkerResult,
} from "../lib/world-display/landblock-render-product";
import type { RenderArtifactDiagnosticFamily } from "../lib/world-display/render-regression-diagnostics";
import { loadWorkerAssetClosure } from "./shared/asset-closure-loader";
import { prepareAssetPayload } from "./shared/asset-prepare";
import type {
	WorkerHostBinaryEnvelope,
	WorkerHostLookupBinaryCompleteMessage,
	WorkerHostLookupBinaryErrorMessage,
	WorkerHostLookupBinaryRequestMessage,
} from "./shared/host-asset-bridge";
import { WorkerHostAssetBridge } from "./shared/host-asset-bridge";

export type StaticLandblockRenderWorkerHostBinaryEnvelope =
	WorkerHostBinaryEnvelope;
export type StaticLandblockRenderWorkerHostLookupBinaryRequestMessage =
	WorkerHostLookupBinaryRequestMessage;
export type StaticLandblockRenderWorkerHostLookupBinaryCompleteMessage =
	WorkerHostLookupBinaryCompleteMessage;
export type StaticLandblockRenderWorkerHostLookupBinaryErrorMessage =
	WorkerHostLookupBinaryErrorMessage;

export interface StaticLandblockRenderWorkerRunJobMessage {
	type: "run-landblock-render-product-job";
	requestId: string;
	job: LandblockRenderProductWorkerJob;
}

export interface StaticLandblockRenderWorkerCancelJobMessage {
	type: "cancel-landblock-render-product-job";
	requestId: string;
}

export interface StaticLandblockRenderWorkerJobCompleteMessage {
	type: "landblock-render-product-job-complete";
	requestId: string;
	result: LandblockRenderProductWorkerResult;
}

export interface StaticLandblockRenderWorkerJobErrorMessage {
	type: "landblock-render-product-job-error";
	requestId: string;
	message: string;
}

export type StaticLandblockRenderWorkerRequestMessage =
	| StaticLandblockRenderWorkerRunJobMessage
	| StaticLandblockRenderWorkerCancelJobMessage
	| WorkerHostLookupBinaryCompleteMessage
	| WorkerHostLookupBinaryErrorMessage;

export type StaticLandblockRenderWorkerResponseMessage =
	| StaticLandblockRenderWorkerJobCompleteMessage
	| StaticLandblockRenderWorkerJobErrorMessage
	| WorkerHostLookupBinaryRequestMessage;

interface StaticLandblockRenderWorkerScope {
	onmessage:
		| ((event: MessageEvent<StaticLandblockRenderWorkerRequestMessage>) => void)
		| null;
	postMessage(
		message: StaticLandblockRenderWorkerResponseMessage,
		transferables?: Transferable[],
	): void;
	document?: unknown;
}

interface StaticLandblockRenderWorkerLookup {
	lookupBinaryAssets(requests: readonly AssetLookupRequestDto[]): Promise<{
		responses: readonly import("../lib/host/contracts").AssetLookupResponseDto[];
	}>;
}

interface StaticLandblockRenderWorkerRunOptions {
	isCanceled?: () => boolean;
}

interface QueuedStaticLandblockRenderWorkerJob {
	requestId: string;
	job: LandblockRenderProductWorkerJob;
}

const workerScope = globalThis as unknown as StaticLandblockRenderWorkerScope;
const STATIC_LANDBLOCK_RENDER_WORKER_DIAGNOSTIC_BUILD =
	"static-landblock-render-worker-2026-06-04a";

export async function runStaticLandblockRenderWorkerJob(
	job: LandblockRenderProductWorkerJob,
	lookup: StaticLandblockRenderWorkerLookup,
	options: StaticLandblockRenderWorkerRunOptions = {},
): Promise<LandblockRenderProductWorkerResult> {
	const responseByAssetId = new Map<
		string,
		import("../lib/host/contracts").AssetLookupResponseDto
	>();
	const preparedByAssetId = new Map<string, PreparedAssetRecord>();

	throwIfWorkerJobCanceled(options);
	await loadProductRoots({ job, lookup, responseByAssetId });

	throwIfWorkerJobCanceled(options);
	prepareResponses(job, responseByAssetId, preparedByAssetId);
	await loadPreparedCompanionClosure({
		job,
		lookup,
		responseByAssetId,
		preparedByAssetId,
	});

	throwIfWorkerJobCanceled(options);
	const assetState = createWorkerAssetState(preparedByAssetId);
	const terrainArtifact =
		job.product === "outdoor" && shouldBuildArtifact(job, "terrain")
			? buildOutdoorTerrainArtifact(job, preparedByAssetId, assetState)
			: null;
	const staticObjectBundles = buildProductStaticBundleLayers(job, preparedByAssetId);
	const artifacts: LandblockRenderArtifact[] = [
		...(terrainArtifact ? [terrainArtifact] : []),
		...staticObjectBundles,
	];

	throwIfWorkerJobCanceled(options);
	if (
		(job.product === "outdoor-env-cells" ||
			job.product === "dungeon-env-cells") &&
		shouldBuildArtifact(job, "cell-structures")
	) {
		artifacts.push(
			buildDetailedLandblockRenderArtifacts({
				job,
				product: job.product,
				preparedByAssetId,
				staticObjectBundles,
			}),
		);
	}

	throwIfWorkerJobCanceled(options);
	return {
		type: "landblock-render-product-built",
		jobId: job.jobId,
		landblockId: job.landblockId,
		product: job.product,
		requestId: job.requestId,
		buildPolicyRevision: job.buildPolicyRevision,
		texturePagePolicyRevision: job.texturePagePolicyRevision,
		artifacts,
		diagnostics: {
			status: "ready",
			messages: [
				`prepared ${preparedByAssetId.size} assets for ${formatHex32(
					job.landblockId,
				)} ${job.product}`,
			],
		},
	};
}

async function loadProductRoots(options: {
	job: LandblockRenderProductWorkerJob;
	lookup: StaticLandblockRenderWorkerLookup;
	responseByAssetId: Map<
		string,
		import("../lib/host/contracts").AssetLookupResponseDto
	>;
}): Promise<void> {
	if (options.job.product === "outdoor") {
		await loadClosureRoots({
			rootAssetIds: [formatLandblockOutdoorAssetId(options.job.landblockId)],
			job: options.job,
			lookup: options.lookup,
			responseByAssetId: options.responseByAssetId,
			shouldExpandResponse: shouldLoadOutdoorRootOnly(options.job)
				? () => false
				: undefined,
		});
		return;
	}

	const topologyAssetId = formatLandblockTopologyAssetId(
		options.job.landblockId,
	);
	await loadClosureRoots({
		rootAssetIds: [topologyAssetId],
		job: options.job,
		lookup: options.lookup,
		responseByAssetId: options.responseByAssetId,
		shouldExpandResponse: (response) => response.assetId !== topologyAssetId,
	});
	const topology = prepareAssetPayload(
		createAssetRequest(options.job, topologyAssetId),
		getResponse(options.responseByAssetId, topologyAssetId),
	);
	if (topology.payload.kind !== "landblock-topology") {
		throw new Error(
			`Landblock product worker expected ${topologyAssetId} to prepare as landblock-topology.`,
		);
	}
	await loadClosureRoots({
		rootAssetIds: topology.payload.envCells.map((envCell) => envCell.assetId),
		job: options.job,
		lookup: options.lookup,
		responseByAssetId: options.responseByAssetId,
	});
}

export function collectStaticLandblockRenderWorkerResultTransferables(
	result: LandblockRenderProductWorkerResult,
): Transferable[] {
	const transferables: Transferable[] = [];
	const transferredBuffers = new Set<ArrayBuffer>();
	collectTransferableArrayBuffers(result, transferables, transferredBuffers);
	return transferables;
}

async function loadClosureRoots(options: {
	rootAssetIds: readonly string[];
	job: LandblockRenderProductWorkerJob;
	lookup: StaticLandblockRenderWorkerLookup;
	responseByAssetId: Map<
		string,
		import("../lib/host/contracts").AssetLookupResponseDto
	>;
	shouldExpandResponse?: (
		response: import("../lib/host/contracts").AssetLookupResponseDto,
	) => boolean;
}): Promise<void> {
	const missingRootAssetIds = options.rootAssetIds.filter(
		(assetId) => !options.responseByAssetId.has(assetId),
	);
	if (missingRootAssetIds.length === 0) {
		return;
	}
	const closure = await loadWorkerAssetClosure({
		rootAssetIds: missingRootAssetIds,
		createRequest: (assetId) => createAssetRequest(options.job, assetId),
		lookup: options.lookup,
		shouldExpandResponse: options.shouldExpandResponse,
	});
	for (const response of closure.responses) {
		options.responseByAssetId.set(response.assetId, response);
	}
	const stillMissingRootAssetIds = missingRootAssetIds.filter(
		(assetId) => !options.responseByAssetId.has(assetId),
	);
	if (stillMissingRootAssetIds.length > 0) {
		throw new Error(
			`Landblock product worker did not receive ${stillMissingRootAssetIds.length} requested closure root response(s): ${formatAssetIdSample(
				stillMissingRootAssetIds,
			)}.`,
		);
	}
}

function prepareResponses(
	job: LandblockRenderProductWorkerJob,
	responseByAssetId: ReadonlyMap<
		string,
		import("../lib/host/contracts").AssetLookupResponseDto
	>,
	preparedByAssetId: Map<string, PreparedAssetRecord>,
): void {
	for (const response of responseByAssetId.values()) {
		if (preparedByAssetId.has(response.assetId)) {
			continue;
		}
		preparedByAssetId.set(
			response.assetId,
			prepareAssetPayload(createAssetRequest(job, response.assetId), response),
		);
	}
}

async function loadPreparedCompanionClosure(options: {
	job: LandblockRenderProductWorkerJob;
	lookup: StaticLandblockRenderWorkerLookup;
	responseByAssetId: Map<
		string,
		import("../lib/host/contracts").AssetLookupResponseDto
	>;
	preparedByAssetId: Map<string, PreparedAssetRecord>;
}): Promise<void> {
	let pass = 1;
	while (true) {
		const companionAssetIds = uniqueSortedStrings([
			...collectTerrainCompanionAssetIds(options.preparedByAssetId).filter(
				() => shouldBuildArtifact(options.job, "terrain"),
			),
			...collectSetupAppearanceCompanionAssetIds(options.preparedByAssetId),
			...collectStaticPreparedTextureAssetIds(options.preparedByAssetId),
		]).filter((assetId) => !options.responseByAssetId.has(assetId));
		if (companionAssetIds.length === 0) {
			return;
		}
		const responseCountBefore = options.responseByAssetId.size;
		await loadClosureRoots({
			rootAssetIds: companionAssetIds,
			job: options.job,
			lookup: options.lookup,
			responseByAssetId: options.responseByAssetId,
		});
		const unresolvedCompanionAssetIds = companionAssetIds.filter(
			(assetId) => !options.responseByAssetId.has(assetId),
		);
		if (
			unresolvedCompanionAssetIds.length > 0 ||
			options.responseByAssetId.size === responseCountBefore
		) {
			throw new Error(
				`Landblock product worker companion closure pass ${pass} made no usable progress; missing ${unresolvedCompanionAssetIds.length} companion response(s): ${formatAssetIdSample(
					unresolvedCompanionAssetIds.length > 0
						? unresolvedCompanionAssetIds
						: companionAssetIds,
				)}.`,
			);
		}
		prepareResponses(
			options.job,
			options.responseByAssetId,
			options.preparedByAssetId,
		);
		pass += 1;
	}
}

function shouldLoadOutdoorRootOnly(
	job: LandblockRenderProductWorkerJob,
): boolean {
	return (
		job.product === "outdoor" &&
		shouldBuildArtifact(job, "terrain") &&
		!shouldBuildArtifact(job, "static-objects")
	);
}

function collectTerrainCompanionAssetIds(
	preparedByAssetId: ReadonlyMap<string, PreparedAssetRecord>,
): string[] {
	const terrainMaterialAssetIds = [...preparedByAssetId.values()].flatMap((asset) =>
		asset.payload.kind === "landblock-outdoor"
			? [formatTerrainMaterialAssetId(asset.payload.regionNumber)]
			: [],
	);
	const terrainPreparedTextureAssetIds = [...preparedByAssetId.values()].flatMap(
		(asset) =>
			asset.payload.kind === "terrain-material"
				? asset.payload.dependencies.renderSurfaceAssetIds.map((assetId) => {
						const renderSurface = preparedByAssetId.get(assetId);
						if (renderSurface?.payload.kind !== "render-surface") {
							return null;
						}
						return formatAtlasReadyPreparedTextureAssetId({
							renderSurfaceId: renderSurface.payload.renderSurfaceId,
							usage: "raw",
						});
					})
				: [],
	);
	return uniqueSortedStrings([
		...terrainMaterialAssetIds,
		...terrainPreparedTextureAssetIds.filter(
			(assetId): assetId is string => assetId !== null,
		),
	]);
}

function collectSetupAppearanceCompanionAssetIds(
	preparedByAssetId: ReadonlyMap<string, PreparedAssetRecord>,
): string[] {
	return [...preparedByAssetId.values()].flatMap((asset) =>
		asset.payload.kind === "setup-model"
			? [`setup-appearance/${formatHex32(asset.payload.setupModelId)}`]
			: [],
	);
}

function collectStaticPreparedTextureAssetIds(
	preparedByAssetId: ReadonlyMap<string, PreparedAssetRecord>,
): string[] {
	return [...preparedByAssetId.values()].flatMap((asset) =>
		collectStaticPreparedTextureRouteAssetIds(asset, preparedByAssetId),
	);
}

function buildStaticObjectBundle(
	job: LandblockRenderProductWorkerJob,
	preparedByAssetId: ReadonlyMap<string, PreparedAssetRecord>,
	bundleKind: "outdoor-buildings" | "outdoor-detail" | "env-cell-static",
	envCellScope?: { envCellId: number },
): StaticObjectBundleArtifact {
	const layerJob = createStaticBundleLayerWorkerJob(
		job,
		bundleKind,
		envCellScope,
	);
	return buildStaticObjectBundleArtifact({
		job: layerJob,
		preparedAssets: [...preparedByAssetId.values()],
		policy: {
			buildPolicyRevision: job.buildPolicyRevision,
			cpuTexturePagePolicyRevision: job.texturePagePolicyRevision,
			atlasLayout: job.buildPolicy.atlasLayout,
		},
	});
}

function buildOutdoorTerrainArtifact(
	job: LandblockRenderProductWorkerJob,
	preparedByAssetId: ReadonlyMap<string, PreparedAssetRecord>,
	assetState: AssetChannelState,
) {
	const outdoorAssetId = formatLandblockOutdoorAssetId(job.landblockId);
	const outdoor = preparedByAssetId.get(outdoorAssetId);
	if (outdoor?.payload.kind !== "landblock-outdoor") {
		throw new Error(
			`Landblock product worker expected ${outdoorAssetId} to prepare as landblock-outdoor.`,
		);
	}
	return buildLandblockTerrainRenderArtifact({
		assetState,
		outdoor: outdoor.payload,
		policy: {
			buildPolicyRevision: job.buildPolicyRevision,
			cpuTexturePagePolicyRevision: job.texturePagePolicyRevision,
			maxLayerEntries: job.buildPolicy.terrainMaxLayerEntries,
		},
		requestId: job.requestId,
	});
}

function buildProductStaticBundleLayers(
	job: LandblockRenderProductWorkerJob,
	preparedByAssetId: ReadonlyMap<string, PreparedAssetRecord>,
): StaticObjectBundleArtifact[] {
	if (!shouldBuildArtifact(job, "static-objects")) {
		return [];
	}
	if (job.product === "outdoor") {
		return [
			buildStaticObjectBundle(job, preparedByAssetId, "outdoor-buildings"),
			buildStaticObjectBundle(job, preparedByAssetId, "outdoor-detail"),
		];
	}

	const topology = preparedByAssetId.get(
		formatLandblockTopologyAssetId(job.landblockId),
	);
	if (topology?.payload.kind !== "landblock-topology") {
		throw new Error(
			`Landblock product worker missing prepared topology for ${formatHex32(
				job.landblockId,
			)}.`,
		);
	}
	const bundles: StaticObjectBundleArtifact[] = [];
	for (const envCell of topology.payload.envCells) {
		const asset = preparedByAssetId.get(envCell.assetId);
		if (asset?.payload.kind !== "env-cell") {
			throw new Error(
				`Landblock product worker cannot build env-cell static bundles without ${envCell.assetId}.`,
			);
		}
		if (asset.payload.statics.length === 0) {
			continue;
		}
		bundles.push(
			buildStaticObjectBundle(job, preparedByAssetId, "env-cell-static", {
				envCellId: envCell.envCellId,
			}),
		);
	}
	return bundles;
}

function shouldBuildArtifact(
	job: LandblockRenderProductWorkerJob,
	family: RenderArtifactDiagnosticFamily,
): boolean {
	return job.artifactFilter === null || job.artifactFilter.includes(family);
}

function buildDetailedLandblockRenderArtifacts(options: {
	job: LandblockRenderProductWorkerJob;
	product: "outdoor-env-cells" | "dungeon-env-cells";
	preparedByAssetId: ReadonlyMap<string, PreparedAssetRecord>;
	staticObjectBundles: readonly StaticObjectBundleArtifact[];
}): DetailedLandblockRenderArtifacts {
	const topologyAssetId = formatLandblockTopologyAssetId(
		options.job.landblockId,
	);
	const topology = options.preparedByAssetId.get(topologyAssetId);
	if (topology?.payload.kind !== "landblock-topology") {
		throw new Error(
			`Landblock product worker cannot build detailed artifacts without ${topologyAssetId}.`,
		);
	}
	const topologyPayload = topology.payload;

	const envCells = topologyPayload.envCells
		.map((member) => {
			const asset = options.preparedByAssetId.get(member.assetId);
			if (asset?.payload.kind !== "env-cell") {
				throw new Error(
					`Landblock product worker cannot build detailed artifacts without ${member.assetId}.`,
				);
			}
			return asset.payload;
		})
		.sort((left, right) => left.envCellId - right.envCellId);
	const materialContext = buildStructuredInteriorMaterialContext({
		job: options.job,
		envCells,
		preparedByAssetId: options.preparedByAssetId,
	});

	return {
		artifactKind: "detailed-landblock",
		key: [
			"detailed-landblock",
			formatHex32(options.job.landblockId),
			options.product,
			options.job.buildPolicyRevision,
			options.job.texturePagePolicyRevision,
		].join(":"),
		landblockId: options.job.landblockId,
		product: options.product,
		requestId: options.job.requestId,
		buildPolicyRevision: options.job.buildPolicyRevision,
		texturePagePolicyRevision: options.job.texturePagePolicyRevision,
		selectedEnvCellIds: envCells.map((envCell) => envCell.envCellId),
		structuredInteriorMaterialRecords: materialContext.materialRecords,
		structuredInteriorTexturePageRefs: materialContext.texturePageRefs,
		structuredInteriorTexturePages: materialContext.texturePages,
		structuredInteriorCells: envCells.map((envCell) =>
			createStructuredInteriorCellArtifact(
				options.job.landblockId,
				envCell,
				materialContext.slicesByEnvCellId.get(envCell.envCellId) ?? [],
			),
		),
		cellStructureMetadata: envCells.map((envCell) => ({
			key: `cell-structure:${formatHex32(envCell.envCellId)}:${formatHex32(
				envCell.cellStructureId,
			)}`,
			envCellId: envCell.envCellId,
			cellStructureId: envCell.cellStructureId,
			environmentId: envCell.environmentId,
			regionNumber: envCell.regionNumber,
			surfaceIds: envCell.surfaces.map((surface) => surface.surfaceId),
			portalIds: envCell.portals.map((portal) => portal.portalId),
			localPlacement: envCell.localPlacement,
		})),
		portalLinks: topologyPayload.portalLinks.map((portalLink) => ({
			key: portalLink.linkId,
			landblockId: topologyPayload.landblockId,
			source: portalLink.source,
			target: portalLink.target,
			flags: portalLink.flags,
			otherCellId: portalLink.otherCellId,
			otherPortalId: portalLink.otherPortalId,
			polygonId: portalLink.polygonId,
			sourceIndex: portalLink.sourceIndex,
		})),
		portalApertures: envCells.flatMap((envCell) =>
			envCell.portalApertures.map((aperture) => ({
				key: `portal-aperture:${formatHex32(envCell.envCellId)}:${aperture.portalId}`,
				envCellId: envCell.envCellId,
				portalId: aperture.portalId,
				sourceIndex: aperture.sourceIndex,
				polygonId: aperture.polygonId,
				points: aperture.points,
				plane: aperture.plane,
			})),
		),
		visibility: {
			objectVisibilityRecords: options.staticObjectBundles.flatMap((layer) =>
				layer.objectRecords.map((objectRecord) => ({
					objectKey: objectRecord.objectKey,
					owningLandblockId: objectRecord.owningLandblockId,
					owningEnvCellId: objectRecord.owningEnvCellId,
					visibilityKeys: objectRecord.visibilityKeys,
				})),
			),
			cellVisibilityRecords: envCells.map((envCell) => ({
				envCellId: envCell.envCellId,
				visibilityKeys: [
					residencyCellBvhItemKey(envCell.envCellId),
					envRenderGeometryBvhItemKey(envCell.envCellId),
				],
				visibleEnvCellIds: envCell.visibleEnvCellIds,
			})),
		},
		spatial: {
			envCellResidencyBvh: topologyPayload.envCellResidencyBvh,
			envCellLocalBvhs: envCells.map((envCell) => ({
				key: `env-cell-local-bvh:${formatHex32(envCell.envCellId)}`,
				envCellId: envCell.envCellId,
				localPlacement: envCell.localPlacement,
				localBvh: envCell.localBvh,
			})),
		},
	};
}

type PreparedEnvCellPayload = Extract<
	PreparedAssetRecord["payload"],
	{ kind: "env-cell" }
>;

type DetailedStructuredInteriorMaterialSlice =
	DetailedLandblockRenderArtifacts["structuredInteriorCells"][number]["materialSlices"][number];

interface StructuredInteriorMaterialContext {
	materialRecords: readonly StaticBundleMaterialRecord[];
	texturePageRefs: readonly VirtualTexturePageRef[];
	texturePages: DetailedLandblockRenderArtifacts["structuredInteriorTexturePages"];
	slicesByEnvCellId: ReadonlyMap<
		number,
		readonly DetailedStructuredInteriorMaterialSlice[]
	>;
}

interface StructuredInteriorMaterialSlot {
	regionNumber: number;
	slotId: number;
	surfaceId: number;
	materialAssetId: string;
	materialVariantSignature: string | null;
}

function buildStructuredInteriorMaterialContext(options: {
	job: LandblockRenderProductWorkerJob;
	envCells: readonly PreparedEnvCellPayload[];
	preparedByAssetId: ReadonlyMap<string, PreparedAssetRecord>;
}): StructuredInteriorMaterialContext {
	const materialSlots = options.envCells.flatMap((envCell) =>
		collectStructuredInteriorMaterialSlots(envCell),
	);
	const materialTextureRoutes = collectStaticMaterialTextureRoutes(
		materialSlots.map((slot) => ({
			materialAssetId: slot.materialAssetId,
			materialRecordKey: formatStructuredInteriorMaterialTextureRecordKey(slot),
			materialVariantSignature: slot.materialVariantSignature,
		})),
		options.preparedByAssetId,
	);
	const materialTexturePageRefs = collectStaticMaterialTexturePageRefs(
		materialTextureRoutes,
		options.preparedByAssetId,
	);
	const detailTexturePageRefs = collectStructuredInteriorDetailTexturePageRefs({
		envCells: options.envCells,
		preparedByAssetId: options.preparedByAssetId,
	});
	const texturePageRefs = uniqueTexturePageRefs([
		...materialTexturePageRefs,
		...detailTexturePageRefs,
	]);
	const scopeKey = [
		"structured-interior",
		formatHex32(options.job.landblockId),
		options.job.product,
		options.job.requestId,
		options.job.texturePagePolicyRevision,
	].join(":");
	const texturePages = buildStaticBundleLayerTexturePages({
		scopeKey,
		texturePageRefs,
		policy: options.job.buildPolicy.atlasLayout,
	});
	const materialRecords = buildStructuredInteriorMaterialRecords({
		materialSlots,
		materialTextureRoutes,
		preparedByAssetId: options.preparedByAssetId,
		texturePageRefs,
		landblockId: options.job.landblockId,
	});
	const materialRecordByKey = new Map(
		materialRecords.map((record) => [record.key, record]),
	);
	const slicesByEnvCellId = new Map<
		number,
		readonly DetailedStructuredInteriorMaterialSlice[]
	>();
	for (const envCell of options.envCells) {
		slicesByEnvCellId.set(
			envCell.envCellId,
			buildStructuredInteriorMaterialSlices({
				envCell,
				materialRecordByKey,
				texturePageRefs,
				preparedByAssetId: options.preparedByAssetId,
			}),
		);
	}
	return {
		materialRecords,
		texturePageRefs,
		texturePages,
		slicesByEnvCellId,
	};
}

function buildStructuredInteriorMaterialRecords(options: {
	materialSlots: readonly StructuredInteriorMaterialSlot[];
	materialTextureRoutes: readonly StaticMaterialTextureRoute[];
	preparedByAssetId: ReadonlyMap<string, PreparedAssetRecord>;
	texturePageRefs: readonly VirtualTexturePageRef[];
	landblockId: number;
}): StaticBundleMaterialRecord[] {
	const recordsByKey = new Map<string, StaticBundleMaterialRecord>();
	for (const slot of uniqueStructuredInteriorMaterialSlots(options.materialSlots)) {
		const detail = resolveStructuredInteriorEnvironmentDetail({
			regionNumber: slot.regionNumber,
			texturePageRefs: options.texturePageRefs,
			preparedByAssetId: options.preparedByAssetId,
		});
		const materialTextureRecordKey =
			formatStructuredInteriorMaterialTextureRecordKey(slot);
		const key = formatStructuredInteriorMaterialRecordKey({
			slot,
			detailTextureRefKey: detail?.textureRefKey ?? null,
		});
		const materialReadiness = resolveStaticMaterialReadiness({
			materialAssetId: slot.materialAssetId,
			materialRecordKey: materialTextureRecordKey,
			materialVariantSignature: slot.materialVariantSignature,
			preparedByAssetId: options.preparedByAssetId,
			texturePageRefs: options.texturePageRefs,
			materialTextureRoutes: options.materialTextureRoutes,
		});
		const material = getPreparedPayload(
			options.preparedByAssetId,
			slot.materialAssetId,
			"material-recipe",
		);
		const compactionEligibility = createCompactionEligibility({
			geometry: {
				kind: "static",
				owningLandblockId: options.landblockId,
				hasUvBuffer: true,
			},
			material: materialReadiness,
		});
		const textureRefKeys = findStaticMaterialTextureRefs(
			materialTextureRecordKey,
			options.texturePageRefs,
			options.materialTextureRoutes,
		)
			.map((ref) => ref.key)
			.concat(detail?.textureRefKey ?? []);
		recordsByKey.set(key, {
			key,
			familyKey: formatStaticMaterialFamilyKey(compactionEligibility),
			color: resolveStaticMaterialColor({
				material,
				behavior: materialReadiness.behavior,
			}),
			texturePageRefKeys: textureRefKeys,
			detailTextureRefKey: detail?.textureRefKey ?? null,
			detailTiling: detail?.tiling ?? 1,
			isTransparent:
				compactionEligibility.material.alphaPolicy === "transparent-blend" ||
				compactionEligibility.material.alphaPolicy === "opacity-translucent",
			indexedMaterial: resolveStaticIndexedMaterialRecord({
				materialAssetId: slot.materialAssetId,
				materialRecordKey: materialTextureRecordKey,
				materialTextureRoutes: options.materialTextureRoutes,
				preparedByAssetId: options.preparedByAssetId,
			}),
		});
	}
	return [...recordsByKey.values()].sort((left, right) =>
		left.key.localeCompare(right.key),
	);
}

function buildStructuredInteriorMaterialSlices(options: {
	envCell: PreparedEnvCellPayload;
	materialRecordByKey: ReadonlyMap<string, StaticBundleMaterialRecord>;
	texturePageRefs: readonly VirtualTexturePageRef[];
	preparedByAssetId: ReadonlyMap<string, PreparedAssetRecord>;
}): readonly DetailedStructuredInteriorMaterialSlice[] {
	const surfaceBySlotId = new Map(
		options.envCell.surfaces.map((surface) => [surface.slotId, surface]),
	);
	const keys = new Map<
		string,
		{
			geometrySurfaceId: number;
			materialVariantSignature: string | null;
			materialAssetId: string;
			materialSlotIndex: number;
			surfaceId: number;
		}
	>();
	for (const triangle of options.envCell.renderGeometry.triangles) {
		if (triangle.surfaceId === null) {
			continue;
		}
		const surface = surfaceBySlotId.get(triangle.surfaceId);
		if (!surface) {
			continue;
		}
		const materialVariantSignature =
			triangle.materialVariantSignature ?? null;
		const key = [
			surface.slotId,
			surface.surfaceId,
			triangle.surfaceId,
			materialVariantSignature ?? "base",
		].join("|");
		keys.set(key, {
			geometrySurfaceId: triangle.surfaceId,
			materialVariantSignature,
			materialAssetId: surface.materialAssetId,
			materialSlotIndex: surface.slotId,
			surfaceId: surface.surfaceId,
		});
	}
	return [...keys.values()]
		.map((surfaceKey): DetailedStructuredInteriorMaterialSlice | null => {
			const detail = resolveStructuredInteriorEnvironmentDetail({
				regionNumber: options.envCell.regionNumber,
				texturePageRefs: options.texturePageRefs,
				preparedByAssetId: options.preparedByAssetId,
			});
			const materialRecordKey = formatStructuredInteriorMaterialRecordKey({
				slot: {
					materialAssetId: surfaceKey.materialAssetId,
					materialVariantSignature: surfaceKey.materialVariantSignature,
				},
				detailTextureRefKey: detail?.textureRefKey ?? null,
			});
			const materialRecord = options.materialRecordByKey.get(materialRecordKey);
			if (!materialRecord) {
				return null;
			}
			const geometry = buildPolygonSetRenderGeometry(
				options.envCell.renderGeometry,
				{
					surfaceId: surfaceKey.geometrySurfaceId,
					materialVariantSignature: surfaceKey.materialVariantSignature,
					sourceSignature: `env-cell:${formatHex32(options.envCell.envCellId)}`,
				},
			);
			if (geometry.triangleCount === 0) {
				return null;
			}
			const cellKey = `structured-interior-cell:${formatHex32(
				options.envCell.envCellId,
			)}`;
			return {
				key: [
					cellKey,
					`slot=${surfaceKey.materialSlotIndex}`,
					`surface=${surfaceKey.surfaceId}`,
					`geometry-surface=${surfaceKey.geometrySurfaceId}`,
					`variant=${surfaceKey.materialVariantSignature ?? "base"}`,
				].join(":"),
				cellKey,
				envCellId: options.envCell.envCellId,
				materialSlotIndex: surfaceKey.materialSlotIndex,
				surfaceId: surfaceKey.surfaceId,
				geometrySurfaceId: surfaceKey.geometrySurfaceId,
				materialRecordKey: materialRecord.key,
				materialVariantSignature: surfaceKey.materialVariantSignature,
				positions: geometry.positions,
				uvs: geometry.uvs ?? new Float32Array(),
				normals: geometry.normals ?? new Float32Array(),
				indices: geometry.indices,
				triangleCount: geometry.triangleCount,
			};
		})
		.filter(
			(slice): slice is DetailedStructuredInteriorMaterialSlice =>
				slice !== null,
		)
		.sort((left, right) => left.key.localeCompare(right.key));
}

function collectStructuredInteriorMaterialSlots(
	envCell: PreparedEnvCellPayload,
): StructuredInteriorMaterialSlot[] {
	const variantsBySlotId = new Map<number, Set<string | null>>();
	for (const triangle of envCell.renderGeometry.triangles) {
		if (triangle.surfaceId === null) {
			continue;
		}
		let variants = variantsBySlotId.get(triangle.surfaceId);
		if (!variants) {
			variants = new Set();
			variantsBySlotId.set(triangle.surfaceId, variants);
		}
		variants.add(triangle.materialVariantSignature ?? null);
	}
	return envCell.surfaces.flatMap((surface) => {
		const variants = variantsBySlotId.get(surface.slotId);
		if (!variants || variants.size === 0) {
			return [
				{
					regionNumber: envCell.regionNumber,
					slotId: surface.slotId,
					surfaceId: surface.surfaceId,
					materialAssetId: surface.materialAssetId,
					materialVariantSignature: null,
				},
			];
		}
		return [...variants]
			.sort(compareStructuredInteriorMaterialVariantSignatures)
			.map((materialVariantSignature) => ({
				regionNumber: envCell.regionNumber,
				slotId: surface.slotId,
				surfaceId: surface.surfaceId,
				materialAssetId: surface.materialAssetId,
				materialVariantSignature,
			}));
	});
}

function uniqueStructuredInteriorMaterialSlots(
	slots: readonly StructuredInteriorMaterialSlot[],
): StructuredInteriorMaterialSlot[] {
	const byKey = new Map<string, StructuredInteriorMaterialSlot>();
	for (const slot of slots) {
		byKey.set(
			[
				slot.regionNumber,
				formatStructuredInteriorMaterialTextureRecordKey(slot),
			].join(":"),
			slot,
		);
	}
	return [...byKey.values()].sort((left, right) =>
		[
			left.regionNumber,
			formatStructuredInteriorMaterialTextureRecordKey(left),
		]
			.join(":")
			.localeCompare(
				[
					right.regionNumber,
					formatStructuredInteriorMaterialTextureRecordKey(right),
				].join(":"),
			),
	);
}

function collectStructuredInteriorDetailTexturePageRefs({
	envCells,
	preparedByAssetId,
}: {
	envCells: readonly PreparedEnvCellPayload[];
	preparedByAssetId: ReadonlyMap<string, PreparedAssetRecord>;
}): VirtualTexturePageRef[] {
	return uniqueTexturePageRefs(
		envCells
			.map((envCell) =>
				resolveStructuredInteriorEnvironmentDetailTextureRef({
					regionNumber: envCell.regionNumber,
					preparedByAssetId,
				}),
			)
			.filter((ref): ref is VirtualTexturePageRef => ref !== null),
	);
}

function resolveStructuredInteriorEnvironmentDetail({
	regionNumber,
	texturePageRefs,
	preparedByAssetId,
}: {
	regionNumber: number;
	texturePageRefs: readonly VirtualTexturePageRef[];
	preparedByAssetId: ReadonlyMap<string, PreparedAssetRecord>;
}): { textureRefKey: string; tiling: number } | null {
	const role = resolveStructuredInteriorEnvironmentDetailRole({
		regionNumber,
		preparedByAssetId,
	});
	if (!role || role.tiling <= 0) {
		return null;
	}
	const detailRef = resolveStructuredInteriorEnvironmentDetailTextureRef({
		regionNumber,
		preparedByAssetId,
	});
	if (!detailRef || !texturePageRefs.some((ref) => ref.key === detailRef.key)) {
		return null;
	}
	return {
		textureRefKey: detailRef.key,
		tiling: role.tiling,
	};
}

function resolveStructuredInteriorEnvironmentDetailTextureRef({
	regionNumber,
	preparedByAssetId,
}: {
	regionNumber: number;
	preparedByAssetId: ReadonlyMap<string, PreparedAssetRecord>;
}): VirtualTexturePageRef | null {
	const role = resolveStructuredInteriorEnvironmentDetailRole({
		regionNumber,
		preparedByAssetId,
	});
	if (!role || role.tiling <= 0) {
		return null;
	}
	const renderSurface = resolveStructuredInteriorDetailRenderSurface({
		role,
		preparedByAssetId,
	});
	if (!renderSurface) {
		return null;
	}
	const preparedTextureAssetId = resolveNormalizedPreparedTextureAssetIds({
		renderSurface,
		usage: "detail",
	})[0];
	if (!preparedTextureAssetId) {
		return null;
	}
	const preparedTexture = getPreparedPayload(
		preparedByAssetId,
		preparedTextureAssetId,
		"prepared-texture",
	);
	const level = preparedTexture.levels[0];
	if (!level) {
		throw new Error(
			`Structured interior detail texture ${preparedTextureAssetId} has no mip level 0.`,
		);
	}
	return {
		key: formatStructuredInteriorDetailTextureRefKey({
			regionNumber,
			preparedTextureAssetId,
		}),
		sourceAssetId: preparedTextureAssetId,
		role: "detail",
		sampleClass: "rgba-color",
		width: level.width,
		height: level.height,
		wrapS: "repeat",
		wrapT: "repeat",
		samplingDomain: "color",
		lookup: "color-filtered",
		bytes: level.bytes,
	};
}

function resolveStructuredInteriorEnvironmentDetailRole({
	regionNumber,
	preparedByAssetId,
}: {
	regionNumber: number;
	preparedByAssetId: ReadonlyMap<string, PreparedAssetRecord>;
}): PreparedRegionDetailRole | null {
	const profile = preparedByAssetId.get(formatRegionRenderProfileAssetId(regionNumber));
	if (profile?.payload.kind !== "region-render-profile") {
		return null;
	}
	if (profile.payload.regionNumber !== regionNumber) {
		return null;
	}
	return profile.payload.detailRoles.environment;
}

function resolveStructuredInteriorDetailRenderSurface({
	role,
	preparedByAssetId,
}: {
	role: PreparedRegionDetailRole;
	preparedByAssetId: ReadonlyMap<string, PreparedAssetRecord>;
}): PreparedRenderSurfacePayload | null {
	const surfaceTexture = preparedByAssetId.get(role.textureAssetId);
	if (surfaceTexture?.payload.kind !== "surface-texture") {
		return null;
	}
	const preferredRenderSurfaceIds =
		surfaceTexture.payload.renderSurfaceIds.length <= 1
			? [
					...surfaceTexture.payload.renderSurfaceIds,
					...(surfaceTexture.payload.selectedRenderSurfaceId === null
						? []
						: [surfaceTexture.payload.selectedRenderSurfaceId]),
				]
			: [
					surfaceTexture.payload.renderSurfaceIds[1],
					...surfaceTexture.payload.renderSurfaceIds.slice(2),
					surfaceTexture.payload.renderSurfaceIds[0],
					...(surfaceTexture.payload.selectedRenderSurfaceId === null
						? []
						: [surfaceTexture.payload.selectedRenderSurfaceId]),
				];
	for (const renderSurfaceId of preferredRenderSurfaceIds) {
		if (renderSurfaceId === undefined) {
			continue;
		}
		const renderSurface = preparedByAssetId.get(
			`render-surface/${formatHex32(renderSurfaceId)}`,
		);
		if (renderSurface?.payload.kind === "render-surface") {
			return renderSurface.payload;
		}
	}
	return null;
}

function formatStructuredInteriorDetailTextureRefKey({
	regionNumber,
	preparedTextureAssetId,
}: {
	regionNumber: number;
	preparedTextureAssetId: string;
}): string {
	return [
		"texture",
		"region-detail",
		regionNumber,
		"environment",
		preparedTextureAssetId,
	].join(":");
}

function formatStructuredInteriorMaterialTextureRecordKey(
	slot: Pick<
		StructuredInteriorMaterialSlot,
		"materialAssetId" | "materialVariantSignature"
	>,
): string {
	return [
		`material:${slot.materialAssetId}`,
		`variant:${slot.materialVariantSignature ?? "base"}`,
	].join(":");
}

function formatStructuredInteriorMaterialRecordKey(options: {
	slot: Pick<
		StructuredInteriorMaterialSlot,
		"materialAssetId" | "materialVariantSignature"
	>;
	detailTextureRefKey: string | null;
}): string {
	const base = formatStructuredInteriorMaterialTextureRecordKey(options.slot);
	return options.detailTextureRefKey
		? `${base}:detail=${options.detailTextureRefKey}`
		: base;
}

function compareStructuredInteriorMaterialVariantSignatures(
	left: string | null,
	right: string | null,
): number {
	return (left ?? "").localeCompare(right ?? "");
}

function createStructuredInteriorCellArtifact(
	landblockId: number,
	envCell: PreparedEnvCellPayload,
	materialSlices: DetailedLandblockRenderArtifacts["structuredInteriorCells"][number]["materialSlices"],
): DetailedLandblockRenderArtifacts["structuredInteriorCells"][number] {
	return {
		key: `structured-interior-cell:${formatHex32(envCell.envCellId)}`,
		envCellId: envCell.envCellId,
		landblockId,
		regionNumber: envCell.regionNumber,
		environmentId: envCell.environmentId,
		cellStructureId: envCell.cellStructureId,
		renderChunk: deriveStructuredCellRenderChunk(envCell.envCellId),
		localPlacement: envCell.localPlacement,
		surfaceIds: envCell.surfaces.map((surface) => surface.surfaceId),
		materialSlices,
		portals: envCell.portals.map((portal) => ({
			key: `env-cell-portal:${formatHex32(envCell.envCellId)}:${portal.portalId}`,
			envCellId: envCell.envCellId,
			portalId: portal.portalId,
			sourceIndex: portal.sourceIndex,
			flags: portal.flags,
			polygonId: portal.polygonId,
			otherCellId: portal.otherCellId,
			otherPortalId: portal.otherPortalId,
			targetEnvCellId: portal.targetEnvCellId,
			isOutsideTransition: portal.isOutsideTransition,
		})),
		portalApertureKeys: envCell.portalApertures.map(
			(aperture) =>
				`portal-aperture:${formatHex32(envCell.envCellId)}:${aperture.portalId}`,
		),
		staticObjectCount: envCell.statics.length,
		cellBsp: envCell.cellBsp,
		renderGeometry: envCell.renderGeometry,
	};
}

function getPreparedPayload<
	TKind extends PreparedAssetRecord["payload"]["kind"],
>(
	preparedByAssetId: ReadonlyMap<string, PreparedAssetRecord>,
	assetId: string,
	kind: TKind,
): Extract<PreparedAssetRecord["payload"], { kind: TKind }> {
	const asset = preparedByAssetId.get(assetId);
	if (!asset) {
		throw new Error(`Static render worker is missing required asset ${assetId}.`);
	}
	if (asset.payload.kind !== kind) {
		throw new Error(
			`Static render worker asset ${assetId} was ${asset.payload.kind}, expected ${kind}.`,
		);
	}
	return asset.payload as Extract<
		PreparedAssetRecord["payload"],
		{ kind: TKind }
	>;
}

function createStaticBundleLayerWorkerJob(
	job: LandblockRenderProductWorkerJob,
	bundleKind: "outdoor-buildings" | "outdoor-detail" | "env-cell-static",
	envCellScope?: { envCellId: number },
): StaticBundleLayerWorkerJob {
	const scope =
		bundleKind === "env-cell-static"
			? {
					kind: "env-cell" as const,
					landblockId: job.landblockId,
					envCellId: requiredEnvCellId(envCellScope),
					bundleKind,
				}
			: {
					kind: "landblock" as const,
					landblockId: job.landblockId,
					bundleKind,
				};
	return {
		type: "build-static-bundle-layer",
		jobId: `${job.jobId}:${bundleKind}${
			envCellScope ? `:${formatHex32(envCellScope.envCellId)}` : ""
		}`,
		scope,
		rootAssetIds:
			bundleKind === "env-cell-static"
				? [
						formatLandblockTopologyAssetId(job.landblockId),
						formatEnvCellAssetId(requiredEnvCellId(envCellScope)),
					]
				: [formatLandblockOutdoorAssetId(job.landblockId)],
		sourceRevision: job.jobId,
		buildPolicyRevision: job.buildPolicyRevision,
		cpuTexturePagePolicyRevision: job.texturePagePolicyRevision,
	};
}

function requiredEnvCellId(envCellScope?: { envCellId: number }): number {
	if (!envCellScope) {
		throw new Error("Env-cell static bundle layer requires an env-cell scope.");
	}
	return envCellScope.envCellId;
}

function createWorkerAssetState(
	preparedByAssetId: ReadonlyMap<string, PreparedAssetRecord>,
): AssetChannelState {
	const state = createInitialAssetChannelState(
		"static-landblock-render-worker",
	);
	state.preparedByAssetId = Object.fromEntries(preparedByAssetId);
	return state;
}

function createAssetRequest(
	job: LandblockRenderProductWorkerJob,
	assetId: string,
): AssetLookupRequestDto {
	return {
		requestId: `${job.requestId}:landblock-render-worker:${assetId}`,
		assetId,
		priority: "streaming",
	};
}

function getResponse(
	responseByAssetId: ReadonlyMap<
		string,
		import("../lib/host/contracts").AssetLookupResponseDto
	>,
	assetId: string,
): import("../lib/host/contracts").AssetLookupResponseDto {
	const response = responseByAssetId.get(assetId);
	if (!response) {
		throw new Error(`Landblock product worker missing response ${assetId}.`);
	}
	return response;
}

function uniqueSortedStrings(values: readonly string[]): string[] {
	return [...new Set(values)].sort();
}

function uniqueTexturePageRefs(
	refs: readonly VirtualTexturePageRef[],
): VirtualTexturePageRef[] {
	return [
		...new Map(refs.map((ref) => [ref.key, ref] as const)).values(),
	].sort((left, right) => left.key.localeCompare(right.key));
}

function formatAssetIdSample(assetIds: readonly string[]): string {
	if (assetIds.length === 0) {
		return "none";
	}
	const sample = assetIds.slice(0, 8).join(", ");
	return assetIds.length > 8
		? `${sample}, ... +${assetIds.length - 8} more`
		: sample;
}

function collectTransferableArrayBuffers(
	value: unknown,
	transferables: Transferable[],
	transferredBuffers: Set<ArrayBuffer>,
	visitedObjects = new WeakSet<object>(),
): void {
	if (value === null || value === undefined) {
		return;
	}
	if (ArrayBuffer.isView(value)) {
		const buffer = value.buffer;
		if (
			value.byteLength > 0 &&
			value.byteOffset === 0 &&
			value.byteLength === buffer.byteLength &&
			isTransferableArrayBuffer(buffer) &&
			!transferredBuffers.has(buffer)
		) {
			transferredBuffers.add(buffer);
			transferables.push(buffer);
		}
		return;
	}
	if (typeof value !== "object") {
		return;
	}
	if (visitedObjects.has(value)) {
		return;
	}
	visitedObjects.add(value);
	if (Array.isArray(value)) {
		for (const item of value) {
			collectTransferableArrayBuffers(
				item,
				transferables,
				transferredBuffers,
				visitedObjects,
			);
		}
		return;
	}
	for (const item of Object.values(value as Record<string, unknown>)) {
		collectTransferableArrayBuffers(
			item,
			transferables,
			transferredBuffers,
			visitedObjects,
		);
	}
}

function isTransferableArrayBuffer(
	buffer: ArrayBufferLike,
): buffer is ArrayBuffer {
	return Object.prototype.toString.call(buffer) === "[object ArrayBuffer]";
}

function formatWorkerDiagnosticError(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return `[${STATIC_LANDBLOCK_RENDER_WORKER_DIAGNOSTIC_BUILD}] ${message}`;
}

function throwIfWorkerJobCanceled(
	options: StaticLandblockRenderWorkerRunOptions,
): void {
	if (options.isCanceled?.() === true) {
		throw new Error("Static landblock render product job was canceled.");
	}
}

if (
	typeof workerScope.postMessage === "function" &&
	typeof workerScope.document === "undefined"
) {
	const hostBridge = new WorkerHostAssetBridge(workerScope, {
		requestIdPrefix: "static-landblock-render-worker-host",
		profileLabelPrefix: "static-landblock-render-worker",
	});
	const queuedJobs: QueuedStaticLandblockRenderWorkerJob[] = [];
	const canceledRequestIds = new Set<string>();
	let activeJob: QueuedStaticLandblockRenderWorkerJob | null = null;

	function pumpQueuedWorkerJobs(): void {
		if (activeJob !== null) {
			return;
		}
		while (queuedJobs.length > 0) {
			const nextJob = queuedJobs.shift();
			if (!nextJob || canceledRequestIds.has(nextJob.requestId)) {
				continue;
			}
			activeJob = nextJob;
			void runStaticLandblockRenderWorkerJob(nextJob.job, hostBridge, {
				isCanceled: () => canceledRequestIds.has(nextJob.requestId),
			})
				.then((result) => {
					if (canceledRequestIds.has(nextJob.requestId)) {
						return;
					}
					const transferables =
						collectStaticLandblockRenderWorkerResultTransferables(result);
					workerScope.postMessage(
						{
							type: "landblock-render-product-job-complete",
							requestId: nextJob.requestId,
							result,
						},
						transferables,
					);
				})
				.catch((error) => {
					if (canceledRequestIds.has(nextJob.requestId)) {
						return;
					}
					workerScope.postMessage({
						type: "landblock-render-product-job-error",
						requestId: nextJob.requestId,
						message: formatWorkerDiagnosticError(error),
					});
				})
				.finally(() => {
					activeJob = null;
					canceledRequestIds.delete(nextJob.requestId);
					pumpQueuedWorkerJobs();
				});
			return;
		}
	}

	workerScope.onmessage = (event) => {
		const message = event.data;
		if (message.type === "host-lookup-assets-binary-complete") {
			hostBridge.resolve(message);
			return;
		}
		if (message.type === "host-lookup-assets-binary-error") {
			hostBridge.reject(message);
			return;
		}
		if (message.type === "cancel-landblock-render-product-job") {
			canceledRequestIds.add(message.requestId);
			const queuedIndex = queuedJobs.findIndex(
				(job) => job.requestId === message.requestId,
			);
			if (queuedIndex >= 0) {
				queuedJobs.splice(queuedIndex, 1);
				canceledRequestIds.delete(message.requestId);
			}
			return;
		}
		queuedJobs.push({
			requestId: message.requestId,
			job: message.job,
		});
		pumpQueuedWorkerJobs();
	};
}
