import {
	resolveNormalizedPreparedTextureAssetIds,
	type MaterialTextureUsage,
} from "../lib/assets/material-texture-preparation-policy";
import {
	createInitialAssetChannelState,
	type AssetChannelState,
	type PreparedAssetRecord,
	type PreparedRenderSurfacePayload,
} from "../lib/assets/types";
import {
	formatEnvCellAssetId,
	formatHex32,
	formatLandblockOutdoorAssetId,
	formatLandblockTopologyAssetId,
} from "../lib/landblocks";
import type { AssetLookupRequestDto } from "../lib/host/contracts";
import {
	envRenderGeometryBvhItemKey,
	residencyCellBvhItemKey,
} from "../lib/world-display/prepared-bvh-visibility";
import { deriveStructuredCellRenderChunk } from "../lib/world-display/render-chunks";
import { buildStaticObjectBundleArtifact } from "../lib/world-display/static-bundle-layer-builder";
import type {
	StaticBundleLayerWorkerJob,
	StaticObjectBundleArtifact,
} from "../lib/world-display/static-bundle-layer";
import { buildLandblockTerrainRenderArtifact } from "../lib/world-display/terrain-render-artifact";
import type {
	DetailedLandblockRenderArtifacts,
	LandblockRenderArtifact,
	LandblockRenderProductWorkerJob,
	LandblockRenderProductWorkerResult,
} from "../lib/world-display/landblock-render-product";
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

const workerScope = globalThis as unknown as StaticLandblockRenderWorkerScope;
const STATIC_LANDBLOCK_RENDER_WORKER_DIAGNOSTIC_BUILD =
	"static-landblock-render-worker-2026-06-04a";
const STATIC_MATERIAL_TEXTURE_USAGES: readonly MaterialTextureUsage[] = [
	"raw",
	"detail",
];

export async function runStaticLandblockRenderWorkerJob(
	job: LandblockRenderProductWorkerJob,
	lookup: StaticLandblockRenderWorkerLookup,
): Promise<LandblockRenderProductWorkerResult> {
	const responseByAssetId = new Map<
		string,
		import("../lib/host/contracts").AssetLookupResponseDto
	>();
	const preparedByAssetId = new Map<string, PreparedAssetRecord>();

	await loadProductRoots({ job, lookup, responseByAssetId });

	prepareResponses(job, responseByAssetId, preparedByAssetId);
	await loadPreparedCompanionClosure({
		job,
		lookup,
		responseByAssetId,
		preparedByAssetId,
	});

	const assetState = createWorkerAssetState(preparedByAssetId);
	const terrainArtifact =
		job.product === "outdoor"
			? buildOutdoorTerrainArtifact(job, preparedByAssetId, assetState)
			: null;
	const staticObjectBundles = buildProductStaticBundleLayers(
		job,
		preparedByAssetId,
	);
	const artifacts: LandblockRenderArtifact[] = [
		...(terrainArtifact ? [terrainArtifact] : []),
		...staticObjectBundles,
	];

	if (
		job.product === "outdoor-env-cells" ||
		job.product === "dungeon-env-cells"
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
	while (true) {
		const companionAssetIds = uniqueSortedStrings([
			...collectSetupAppearanceCompanionAssetIds(options.preparedByAssetId),
			...collectNormalizedPreparedTextureAssetIds(options.preparedByAssetId),
		]).filter((assetId) => !options.responseByAssetId.has(assetId));
		if (companionAssetIds.length === 0) {
			return;
		}
		await loadClosureRoots({
			rootAssetIds: companionAssetIds,
			job: options.job,
			lookup: options.lookup,
			responseByAssetId: options.responseByAssetId,
		});
		prepareResponses(
			options.job,
			options.responseByAssetId,
			options.preparedByAssetId,
		);
	}
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

function collectNormalizedPreparedTextureAssetIds(
	preparedByAssetId: ReadonlyMap<string, PreparedAssetRecord>,
): string[] {
	return [...preparedByAssetId.values()].flatMap((asset) => {
		if (asset.payload.kind !== "material-recipe") {
			return [];
		}
		return asset.payload.dependencies.renderSurfaceAssetIds.flatMap(
			(renderSurfaceAssetId: string) => {
				const renderSurface = preparedByAssetId.get(renderSurfaceAssetId);
				if (renderSurface?.payload.kind !== "render-surface") {
					return [];
				}
				return STATIC_MATERIAL_TEXTURE_USAGES.flatMap((usage) =>
					resolveNormalizedPreparedTextureAssetIds({
						renderSurface:
							renderSurface.payload as PreparedRenderSurfacePayload,
						usage,
					}),
				);
			},
		);
	});
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
	return topology.payload.envCells.map((envCell) =>
		buildStaticObjectBundle(job, preparedByAssetId, "env-cell-static", {
			envCellId: envCell.envCellId,
		}),
	);
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

	return {
		artifactKind: "detailed-landblock",
		key: [
			"detailed-landblock",
			formatHex32(options.job.landblockId),
			options.job.requestId,
			options.job.buildPolicyRevision,
			options.job.texturePagePolicyRevision,
		].join(":"),
		landblockId: options.job.landblockId,
		product: options.product,
		requestId: options.job.requestId,
		buildPolicyRevision: options.job.buildPolicyRevision,
		texturePagePolicyRevision: options.job.texturePagePolicyRevision,
		selectedEnvCellIds: envCells.map((envCell) => envCell.envCellId),
		structuredInteriorCells: envCells.map((envCell) =>
			createStructuredInteriorCellArtifact(options.job.landblockId, envCell),
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

function createStructuredInteriorCellArtifact(
	landblockId: number,
	envCell: Extract<PreparedAssetRecord["payload"], { kind: "env-cell" }>,
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

if (
	typeof workerScope.postMessage === "function" &&
	typeof workerScope.document === "undefined"
) {
	const hostBridge = new WorkerHostAssetBridge(workerScope, {
		requestIdPrefix: "static-landblock-render-worker-host",
		profileLabelPrefix: "static-landblock-render-worker",
	});
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
		void runStaticLandblockRenderWorkerJob(message.job, hostBridge)
			.then((result) => {
				workerScope.postMessage(
					{
						type: "landblock-render-product-job-complete",
						requestId: message.requestId,
						result,
					},
					collectStaticLandblockRenderWorkerResultTransferables(result),
				);
			})
			.catch((error) => {
				workerScope.postMessage({
					type: "landblock-render-product-job-error",
					requestId: message.requestId,
					message: formatWorkerDiagnosticError(error),
				});
			});
	};
}
