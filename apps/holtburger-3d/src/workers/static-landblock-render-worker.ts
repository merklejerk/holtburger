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
import {
	buildStaticLandblockRenderBundleLayer,
} from "../lib/world-display/static-bundle-layer-builder";
import type { StaticBundleLayerWorkerJob } from "../lib/world-display/static-bundle-layer";
import {
	buildLandblockTerrainRenderArtifact,
} from "../lib/world-display/terrain-render-artifact";
import type {
	DetailedLandblockRenderArtifacts,
	LandblockRenderPresetWorkerJob,
	LandblockRenderPresetWorkerResult,
} from "../lib/world-display/landblock-render-preset";
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
	type: "run-landblock-render-preset-job";
	requestId: string;
	job: LandblockRenderPresetWorkerJob;
}

export interface StaticLandblockRenderWorkerJobCompleteMessage {
	type: "landblock-render-preset-job-complete";
	requestId: string;
	result: LandblockRenderPresetWorkerResult;
}

export interface StaticLandblockRenderWorkerJobErrorMessage {
	type: "landblock-render-preset-job-error";
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
		| ((
				event: MessageEvent<StaticLandblockRenderWorkerRequestMessage>,
		  ) => void)
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
	job: LandblockRenderPresetWorkerJob,
	lookup: StaticLandblockRenderWorkerLookup,
): Promise<LandblockRenderPresetWorkerResult> {
	const responseByAssetId = new Map<
		string,
		import("../lib/host/contracts").AssetLookupResponseDto
	>();
	const preparedByAssetId = new Map<string, PreparedAssetRecord>();
	const outdoorAssetId = formatLandblockOutdoorAssetId(job.landblockId);

	await loadClosureRoots({
		rootAssetIds: [outdoorAssetId],
		job,
		lookup,
		responseByAssetId,
	});

	if (job.preset === "outdoor-with-env-cells") {
		const topologyAssetId = formatLandblockTopologyAssetId(job.landblockId);
		await loadClosureRoots({
			rootAssetIds: [topologyAssetId],
			job,
			lookup,
			responseByAssetId,
			shouldExpandResponse: (response) => response.assetId !== topologyAssetId,
		});
		const topology = prepareAssetPayload(
			createAssetRequest(job, topologyAssetId),
			getResponse(responseByAssetId, topologyAssetId),
		);
		if (topology.payload.kind !== "landblock-topology") {
			throw new Error(
				`Landblock preset worker expected ${topologyAssetId} to prepare as landblock-topology.`,
			);
		}
		await loadClosureRoots({
			rootAssetIds: topology.payload.envCells.map((envCell) => envCell.assetId),
			job,
			lookup,
			responseByAssetId,
		});
	}

	prepareResponses(job, responseByAssetId, preparedByAssetId);
	await loadPreparedCompanionClosure({
		job,
		lookup,
		responseByAssetId,
		preparedByAssetId,
	});

	const assetState = createWorkerAssetState(preparedByAssetId);
	const outdoor = preparedByAssetId.get(outdoorAssetId);
	if (outdoor?.payload.kind !== "landblock-outdoor") {
		throw new Error(
			`Landblock preset worker expected ${outdoorAssetId} to prepare as landblock-outdoor.`,
		);
	}

	const terrainArtifact = buildLandblockTerrainRenderArtifact({
		assetState,
		outdoor: outdoor.payload,
		policy: {
			buildPolicyRevision: job.buildPolicyRevision,
			cpuTexturePagePolicyRevision: job.texturePagePolicyRevision,
			maxLayerEntries: job.buildPolicy.terrainMaxLayerEntries,
		},
		requestId: job.requestId,
	});
	const staticBundleLayers = [
		buildStaticBundleLayer(job, preparedByAssetId, "outdoor-buildings"),
		buildStaticBundleLayer(job, preparedByAssetId, "outdoor-detail"),
	];

	if (job.preset === "outdoor-with-env-cells") {
		const topology = preparedByAssetId.get(
			formatLandblockTopologyAssetId(job.landblockId),
		);
		if (topology?.payload.kind !== "landblock-topology") {
			throw new Error(
				`Landblock preset worker missing prepared topology for ${formatHex32(
					job.landblockId,
				)}.`,
			);
		}
		for (const envCell of topology.payload.envCells) {
			staticBundleLayers.push(
				buildStaticBundleLayer(job, preparedByAssetId, "env-cell-static", {
					envCellId: envCell.envCellId,
				}),
			);
		}
	}

	const baseResult = {
		type: "landblock-render-preset-built",
		jobId: job.jobId,
		landblockId: job.landblockId,
		requestId: job.requestId,
		buildPolicyRevision: job.buildPolicyRevision,
		texturePagePolicyRevision: job.texturePagePolicyRevision,
		terrainArtifact,
		staticBundleLayers,
		diagnostics: {
			status: "ready",
			messages: [
				`prepared ${preparedByAssetId.size} assets for ${formatHex32(
					job.landblockId,
				)} ${job.preset}`,
			],
		},
	} satisfies Omit<LandblockRenderPresetWorkerResult, "preset" | "detailedArtifacts">;

	if (job.preset === "outdoor-with-env-cells") {
		return {
			...baseResult,
			preset: job.preset,
			detailedArtifacts: buildDetailedLandblockRenderArtifacts({
				job,
				preparedByAssetId,
				staticBundleLayers,
			}),
		};
	}

	return {
		...baseResult,
		preset: job.preset,
	};
}

export function collectStaticLandblockRenderWorkerResultTransferables(
	result: LandblockRenderPresetWorkerResult,
): Transferable[] {
	const transferables: Transferable[] = [];
	const transferredBuffers = new Set<ArrayBuffer>();
	collectTransferableArrayBuffers(result, transferables, transferredBuffers);
	return transferables;
}

async function loadClosureRoots(options: {
	rootAssetIds: readonly string[];
	job: LandblockRenderPresetWorkerJob;
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
	job: LandblockRenderPresetWorkerJob,
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
	job: LandblockRenderPresetWorkerJob;
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
		prepareResponses(options.job, options.responseByAssetId, options.preparedByAssetId);
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
						renderSurface: renderSurface.payload as PreparedRenderSurfacePayload,
						usage,
					}),
				);
			},
		);
	});
}

function buildStaticBundleLayer(
	job: LandblockRenderPresetWorkerJob,
	preparedByAssetId: ReadonlyMap<string, PreparedAssetRecord>,
	layerKind: "outdoor-buildings" | "outdoor-detail" | "env-cell-static",
	envCellScope?: { envCellId: number },
) {
	const layerJob = createStaticBundleLayerWorkerJob(job, layerKind, envCellScope);
	return buildStaticLandblockRenderBundleLayer({
		job: layerJob,
		preparedAssets: [...preparedByAssetId.values()],
		policy: {
			buildPolicyRevision: job.buildPolicyRevision,
			cpuTexturePagePolicyRevision: job.texturePagePolicyRevision,
			atlasLayout: job.buildPolicy.atlasLayout,
		},
	});
}

function buildDetailedLandblockRenderArtifacts(options: {
	job: LandblockRenderPresetWorkerJob;
	preparedByAssetId: ReadonlyMap<string, PreparedAssetRecord>;
	staticBundleLayers: readonly ReturnType<typeof buildStaticBundleLayer>[];
}): DetailedLandblockRenderArtifacts {
	const topologyAssetId = formatLandblockTopologyAssetId(options.job.landblockId);
	const topology = options.preparedByAssetId.get(topologyAssetId);
	if (topology?.payload.kind !== "landblock-topology") {
		throw new Error(
			`Landblock preset worker cannot build detailed artifacts without ${topologyAssetId}.`,
		);
	}
	const topologyPayload = topology.payload;

	const envCells = topologyPayload.envCells
		.map((member) => {
			const asset = options.preparedByAssetId.get(member.assetId);
			if (asset?.payload.kind !== "env-cell") {
				throw new Error(
					`Landblock preset worker cannot build detailed artifacts without ${member.assetId}.`,
				);
			}
			return asset.payload;
		})
		.sort((left, right) => left.envCellId - right.envCellId);

	return {
		key: [
			"detailed-landblock",
			formatHex32(options.job.landblockId),
			options.job.requestId,
			options.job.buildPolicyRevision,
			options.job.texturePagePolicyRevision,
		].join(":"),
		landblockId: options.job.landblockId,
		preset: "outdoor-with-env-cells",
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
			objectVisibilityRecords: options.staticBundleLayers.flatMap((layer) =>
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
	job: LandblockRenderPresetWorkerJob,
	layerKind: "outdoor-buildings" | "outdoor-detail" | "env-cell-static",
	envCellScope?: { envCellId: number },
): StaticBundleLayerWorkerJob {
	const scope =
		layerKind === "env-cell-static"
			? {
					kind: "env-cell" as const,
					landblockId: job.landblockId,
					envCellId: requiredEnvCellId(envCellScope),
					layerKind,
				}
			: {
					kind: "landblock" as const,
					landblockId: job.landblockId,
					layerKind,
				};
	return {
		type: "build-static-bundle-layer",
		jobId: `${job.jobId}:${layerKind}${
			envCellScope ? `:${formatHex32(envCellScope.envCellId)}` : ""
		}`,
		scope,
		rootAssetIds:
			layerKind === "env-cell-static"
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
	const state = createInitialAssetChannelState("static-landblock-render-worker");
	state.preparedByAssetId = Object.fromEntries(preparedByAssetId);
	return state;
}

function createAssetRequest(
	job: LandblockRenderPresetWorkerJob,
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
		throw new Error(`Landblock preset worker missing response ${assetId}.`);
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
						type: "landblock-render-preset-job-complete",
						requestId: message.requestId,
						result,
					},
					collectStaticLandblockRenderWorkerResultTransferables(result),
				);
			})
			.catch((error) => {
				workerScope.postMessage({
					type: "landblock-render-preset-job-error",
					requestId: message.requestId,
					message: formatWorkerDiagnosticError(error),
				});
			});
	};
}
