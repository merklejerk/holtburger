import type { AssetService } from "../../../assets/contracts";
import type { DynamicEntityId } from "../../../dynamic/contracts";
import { createRenderPassPortalFrameWorkPlan } from "../../../renderer/portal-frame-work-plan";
import type {
	FrameState,
	Renderer,
	RendererFrameTelemetry,
	RendererSnapshot,
	RendererStaticLayerVisibility,
	RenderPassPlan,
} from "../../../renderer/types";
import type {
	RendererDiagnosticsSummary,
	RuntimeDiagnosticsReport,
} from "../../../runtime/diagnostics";
import {
	type ClientRuntime,
	type RuntimeCameraResidency,
	type RuntimeEvent,
	type RuntimeOverviewSnapshot,
	type RuntimeSceneInterest,
	type RuntimeTexturePageInspectionSnapshot,
} from "../../../runtime/client-runtime";
import { EMPTY_RUNTIME_PORTAL_OVERLAP_RESIDENCY } from "../../../runtime/portal-base-overlap";
import type {
	StaticSceneEnvCellBounds,
	StaticSceneTerrainLandblockBounds,
} from "../../../runtime/scene-query/contracts";
import type { EnvCellResourceMembership } from "../../../runtime/env-cell-resource-membership";
import type {
	ScenePickHit,
	ScenePickRequest,
} from "../../../runtime/scene-query/merged-scene-query-contracts";
import type { TextureFilteringMode } from "../../../textures/sampling-policy";
import type { OpenWorldStreamingBoundaryAdapters } from "../adapters/browser-boundaries";
import {
	parseOpenWorldTextureBucketKey,
	type OpenWorldTextureBucketKey,
} from "../texture-residency/claims/bucket-key";
import { OpenWorldStreamingController } from "./open-world-streaming-controller";
import type {
	OpenWorldStreamingStaticInterest,
	OpenWorldStreamingStaticPublicationMode,
} from "./open-world-streaming-controller";

export interface OpenWorldStreamingClientRuntimeOptions {
	readonly adapters: OpenWorldStreamingBoundaryAdapters;
	readonly staticPublicationMode?: OpenWorldStreamingStaticPublicationMode;
}

type RuntimeFrameTelemetryListener = (
	telemetry: RendererFrameTelemetry,
) => void;
type RuntimeEventListener = (event: RuntimeEvent) => void;

const DEFAULT_RENDER_PASS_PLAN: RenderPassPlan = {
	kind: "single-surface-resident",
};
const DEFAULT_CAMERA: FrameState["camera"] = {
	pitchRadians: 0,
	position: [0, 0, 0],
	yawRadians: 0,
};
const DEFAULT_CAMERA_RESIDENCY: RuntimeCameraResidency = {
	kind: "unknown",
	landblockId: null,
};

const DEFAULT_TEXTURE_FILTERING_MODE: TextureFilteringMode = "nearest";

export function createOpenWorldStreamingClientRuntime(
	options: OpenWorldStreamingClientRuntimeOptions,
): ClientRuntime {
	return new OpenWorldStreamingClientRuntimeAdapter(options);
}

class OpenWorldStreamingClientRuntimeAdapter implements ClientRuntime {
	readonly #assetService: AssetService;
	readonly #controller: OpenWorldStreamingController;
	readonly #eventListeners = new Set<RuntimeEventListener>();
	readonly #renderer: Renderer;
	readonly #unsubscribeRendererTelemetry: () => void;
	#currentCamera: FrameState["camera"] = DEFAULT_CAMERA;
	#currentCameraResidency: RuntimeCameraResidency = DEFAULT_CAMERA_RESIDENCY;
	#disposed = false;
	#envCellAabbDebugOverlayVisible = false;
	#envCellPortalDebugOverlayVisible = false;
	#flatVisionModeEnabled = false;
	#lastFrameTimeSeconds = 0;
	#sceneInterest: RuntimeSceneInterest = { kind: "none" };
	#sceneInterestRevision = 0;
	#textureFilteringMode: TextureFilteringMode = DEFAULT_TEXTURE_FILTERING_MODE;

	constructor(options: OpenWorldStreamingClientRuntimeOptions) {
		const adapters = options.adapters;
		this.#assetService = adapters.assets.assetService;
		this.#renderer = adapters.renderer.renderer;
		this.#controller = new OpenWorldStreamingController({
			assetReader: adapters.assets.assetService,
			createDynamicVisualPrepper: adapters.workers.createDynamicVisualPrepper,
			createDynamicVisualRecipeResolver:
				adapters.workers.createDynamicVisualRecipeResolver,
			createObjectVisualAtlasBuilder:
				adapters.workers.createObjectVisualAtlasBuilder,
			createStaticBaker: adapters.workers.createStaticBaker,
			createStaticResolver: adapters.workers.createStaticSourceResolver,
			createTexturePageBuilder: adapters.workers.createTexturePageBuilder,
			renderer: this.#renderer,
			staticPublicationMode: options.staticPublicationMode,
		});
		this.#unsubscribeRendererTelemetry = this.#renderer.subscribeTelemetry(
			(telemetry) => {
				for (const listener of this.#frameTelemetryListeners) {
					listener(telemetry);
				}
			},
		);
		this.#renderer.setRenderPassPlan(DEFAULT_RENDER_PASS_PLAN);
		this.#renderer.setPortalFrameWorkPlan(this.#createPortalFrameWorkPlan());
	}

	readonly #frameTelemetryListeners = new Set<RuntimeFrameTelemetryListener>();

	createRuntimeSpawn(
		request: Parameters<ClientRuntime["createRuntimeSpawn"]>[0],
	): DynamicEntityId {
		this.#assertUsable();
		return this.#controller.createRuntimeEntity(request);
	}

	removeRuntimeSpawn(entityId: DynamicEntityId): boolean {
		this.#assertUsable();
		return this.#controller.destroyRuntimeEntity(entityId);
	}

	updateRuntimeSpawnRenderResidence(
		entityId: DynamicEntityId,
		renderResidence: Parameters<
			ClientRuntime["updateRuntimeSpawnRenderResidence"]
		>[1],
	): boolean {
		this.#assertUsable();
		return this.#controller.updateRuntimeEntityRenderResidence(
			entityId,
			renderResidence,
			this.#lastFrameTimeSeconds,
		);
	}

	updateSceneInterest(interest: RuntimeSceneInterest): void {
		this.#assertUsable();
		this.#sceneInterest = interest;
		this.#sceneInterestRevision += 1;
		this.#controller.updateStaticInterest(
			createStaticInterestFromRuntimeSceneInterest(
				interest,
				this.#sceneInterestRevision,
			),
		);
		this.#emitEvent({
			interest,
			kind: "scene-interest-updated",
			revision: this.#sceneInterestRevision,
			source: interest.kind === "none" ? "none" : interest.source,
		});
	}

	queryCameraResidencyAtPoint(): RuntimeCameraResidency {
		this.#assertUsable();
		return DEFAULT_CAMERA_RESIDENCY;
	}

	queryCameraResidencyAtLandblockPoint(): RuntimeCameraResidency {
		this.#assertUsable();
		return DEFAULT_CAMERA_RESIDENCY;
	}

	queryEnvCellBounds(options: {
		readonly envCellId: number;
		readonly landblockId: number;
	}): StaticSceneEnvCellBounds | null {
		this.#assertUsable();
		return this.#controller.queryEnvCellBounds(options);
	}

	queryTerrainLandblockBounds(options: {
		readonly landblockId: number;
	}): StaticSceneTerrainLandblockBounds | null {
		this.#assertUsable();
		return this.#controller.queryTerrainLandblockBounds(options);
	}

	queryEnvCellResourceMembership(options: {
		readonly envCellId: number;
		readonly landblockId: number;
	}): EnvCellResourceMembership | null {
		this.#assertUsable();
		return this.#controller.queryEnvCellResourceMembership(options);
	}

	setCurrentCameraResidency(residency: RuntimeCameraResidency): void {
		this.#assertUsable();
		this.#currentCameraResidency = residency;
	}

	pickSceneRay(request: ScenePickRequest): ScenePickHit | null {
		this.#assertUsable();
		return this.#controller.pickSceneRay({
			...request,
			filters: {
				...request.filters,
				includeEnvCellPortals: this.#envCellPortalDebugOverlayVisible,
			},
		});
	}

	createStaticSelectionDiagnosticsReport(): ReturnType<
		ClientRuntime["createStaticSelectionDiagnosticsReport"]
	> {
		throw new Error(
			"Static selection diagnostics are not implemented in the open-world streaming pipeline yet.",
		);
	}

	createDynamicSelectionDiagnosticsReport(): ReturnType<
		ClientRuntime["createDynamicSelectionDiagnosticsReport"]
	> {
		throw new Error(
			"Dynamic selection diagnostics are not implemented in the open-world streaming pipeline yet.",
		);
	}

	setSceneDebugSelection(): void {
		this.#assertUsable();
	}

	setEnvCellAabbDebugOverlayVisible(visible: boolean): void {
		this.#assertUsable();
		this.#envCellAabbDebugOverlayVisible = visible;
	}

	setEnvCellPortalDebugOverlayVisible(visible: boolean): void {
		this.#assertUsable();
		this.#envCellPortalDebugOverlayVisible = visible;
	}

	setDirectEnvCellPortalMaxDepth(): void {
		this.#assertUsable();
	}

	setFlatVisionModeEnabled(enabled: boolean): void {
		this.#assertUsable();
		this.#flatVisionModeEnabled = enabled;
		this.#renderer.setFlatVisionModeEnabled(enabled);
		this.#renderer.setPortalFrameWorkPlan(this.#createPortalFrameWorkPlan());
	}

	setStaticLayerVisibility(visibility: RendererStaticLayerVisibility): void {
		this.#assertUsable();
		this.#renderer.setStaticLayerVisibility(visibility);
	}

	setTextureFilteringMode(filteringMode: TextureFilteringMode): void {
		this.#assertUsable();
		this.#textureFilteringMode = filteringMode;
	}

	updateCameraState(camera: FrameState["camera"]): void {
		this.#assertUsable();
		this.#currentCamera = camera;
	}

	tickFrame(timeSeconds: number): void {
		if (this.#disposed) {
			return;
		}
		this.#lastFrameTimeSeconds = timeSeconds;
		this.#controller.tickFrame(timeSeconds);
		this.#renderer.updateFrameState({
			camera: this.#currentCamera,
			timeSeconds,
		});
	}

	createOverviewSnapshot(): RuntimeOverviewSnapshot {
		const rendererResources = this.#renderer.createResourceSnapshot();
		const controller = this.#controller.createSnapshot();
		return {
			assets: this.#assetService.createOverviewSnapshot(),
			currentCameraResidency: this.#currentCameraResidency,
			currentPortalOverlapResidency: EMPTY_RUNTIME_PORTAL_OVERLAP_RESIDENCY,
			debugOverlays: {
				envCellAabbCount: 0,
				envCellAabbsVisible: this.#envCellAabbDebugOverlayVisible,
				flatVisionModeEnabled: this.#flatVisionModeEnabled,
				portalCount: 0,
				portalsVisible: this.#envCellPortalDebugOverlayVisible,
			},
			portalFrameWorkPlan: this.#createPortalFrameWorkPlan(),
			renderPolicy: {
				textureFilteringMode: this.#textureFilteringMode,
			},
			resources: {
				textureResidency: createRuntimeTextureResidencyOverview(
					this.#controller.createDiagnosticsSnapshot().textureResidency,
				),
				renderer: rendererResources,
			},
			sceneInterest: this.#sceneInterest,
			staticSceneQuery: controller.staticSceneQueryOverview,
			status: this.#createStatus(),
		};
	}

	createDiagnosticsReport(): RuntimeDiagnosticsReport {
		const renderer = this.#renderer.createDiagnosticsSnapshot();
		const nativeDiagnostics = this.#controller.createDiagnosticsSnapshot();
		return {
			domains: [
				{
					kind: "renderer",
					summary: {
						backend: renderer.backend,
						canvasHeight: renderer.canvasHeight,
						canvasWidth: renderer.canvasWidth,
						debugOverlayPrimitives: renderer.debugOverlayPrimitives,
						directEnvCellDrawCalls: renderer.directEnvCellDrawCalls,
						dynamicInstances: renderer.dynamicInstances,
						dynamicVisualResourceTextureUses:
							renderer.dynamicVisualResourceTextureUses,
						dynamicVisualResources: renderer.dynamicVisualResources,
						error: renderer.error,
						frameCount: renderer.frameCount,
						frameHandlerMs: renderer.frameHandlerMs,
						isRunning: renderer.isRunning,
						outdoorGeneratedSceneryStaticObjectBakedDirectDrawCalls:
							renderer.outdoorGeneratedSceneryStaticObjectBakedDirectDrawCalls,
						outdoorGeneratedSceneryStaticObjectBakedDirectDrawCallsByPass:
							renderer.outdoorGeneratedSceneryStaticObjectBakedDirectDrawCallsByPass,
						outdoorGeneratedSceneryStaticObjectRenderInstances:
							renderer.outdoorGeneratedSceneryStaticObjectRenderInstances,
						outdoorGeneratedSceneryStaticObjectResources:
							renderer.outdoorGeneratedSceneryStaticObjectResources,
						outdoorGeneratedSceneryStaticObjectUploadedBufferBytes:
							renderer.outdoorGeneratedSceneryStaticObjectUploadedBufferBytes,
						outdoorGeneratedSceneryStaticObjectVisualResources:
							renderer.outdoorGeneratedSceneryStaticObjectVisualResources,
						renderedTriangles: renderer.renderedTriangles,
						renderPassKind: renderer.renderPassPlan.kind,
						skippedDynamicSubmissions: renderer.skippedDynamicSubmissions,
						staticDrawUnits: renderer.staticDrawUnits,
						staticObjectBakedDirectDrawCalls:
							renderer.staticObjectBakedDirectDrawCalls,
						staticObjectDirectRenderInstanceDrawCalls:
							renderer.staticObjectDirectRenderInstanceDrawCalls,
						staticObjectFarTransparentDirectRenderInstanceDrawCalls:
							renderer.staticObjectFarTransparentDirectRenderInstanceDrawCalls,
						staticObjectFarTransparentInstancedRenderInstanceDrawCalls:
							renderer.staticObjectFarTransparentInstancedRenderInstanceDrawCalls,
						staticObjectFarTransparentInstancedRenderInstances:
							renderer.staticObjectFarTransparentInstancedRenderInstances,
						staticObjectInstancedRenderInstanceDrawCalls:
							renderer.staticObjectInstancedRenderInstanceDrawCalls,
						staticObjectInstancedRenderInstances:
							renderer.staticObjectInstancedRenderInstances,
						staticObjectNearTransparentDirectRenderInstanceDrawCalls:
							renderer.staticObjectNearTransparentDirectRenderInstanceDrawCalls,
						staticObjectRenderInstances: renderer.staticObjectRenderInstances,
						staticObjectResources: renderer.staticObjectResources,
						staticObjectUploadedBufferBytes:
							renderer.staticObjectUploadedBufferBytes,
						staticObjectUploadSummary: {
							largestUpload: createStaticObjectUploadSample(
								renderer.recentStaticObjectUploads.at(-1) ?? null,
							),
							recentUploadCount: renderer.recentStaticObjectUploads.length,
							totalDrawUnits: renderer.recentStaticObjectUploads.reduce(
								(total, upload) => total + upload.drawUnitCount,
								0,
							),
							totalUploadMs: renderer.recentStaticObjectUploads.reduce(
								(total, upload) => total + upload.uploadMs,
								0,
							),
							totalUploadedBufferBytes:
								renderer.recentStaticObjectUploads.reduce(
									(total, upload) => total + upload.uploadedBufferBytes,
									0,
								),
						},
						staticObjectVisualResources: renderer.staticObjectVisualResources,
						terrainDrawUnits: renderer.terrainDrawUnits,
						terrainMaterialDiagnostics:
							renderer.terrainMaterialDiagnostics,
					},
				},
				{
					kind: "open-world-streaming",
					summary: nativeDiagnostics,
				},
			],
			kind: "runtime-diagnostics-report",
			runtime: {
				sceneInterest:
					this.#sceneInterest.kind === "none" ? null : this.#sceneInterest.kind,
				status: this.#createStatus(),
				textureFilteringMode: this.#textureFilteringMode,
			},
		};
	}

	createTexturePageInspectionSnapshot(input: {
		readonly bucketKey: string;
		readonly pageId: string;
	}): RuntimeTexturePageInspectionSnapshot {
		const nativeSnapshot =
			this.#controller.createTexturePageInspectionSnapshot(input);
		const bucketParts = parseOpenWorldTextureBucketKey(
			nativeSnapshot.bucketKey as OpenWorldTextureBucketKey,
		);
		return {
			assignedPixelCount: nativeSnapshot.assignedPixelCount,
			assignedPixelRatio: createAssignedPixelRatio({
				assignedPixelCount: nativeSnapshot.assignedPixelCount,
				texturePixelCount: nativeSnapshot.texturePixelCount,
			}),
			bucket: {
				domain: bucketParts.domain,
				key: nativeSnapshot.bucketKey,
				purpose: bucketParts.purpose,
				scope: bucketParts.scope,
			},
			entries: nativeSnapshot.entries.map((entry) => ({
				bindingIds: entry.bindingIds,
				id: entry.id,
				ownerIds: entry.ownerIds,
				pageClass: entry.pageClass,
				purpose: entry.purpose,
				sourceKey: entry.sourceKey,
				state: entry.state,
				textureKey: entry.textureKey,
			})),
			kind: "runtime-texture-page-inspection",
			pageId: nativeSnapshot.pageId,
			preview:
				nativeSnapshot.preview === null
					? null
					: {
							format: nativeSnapshot.preview.format,
							height: nativeSnapshot.preview.height,
							pixels: nativeSnapshot.preview.pixels,
							placements: nativeSnapshot.preview.placements,
							sampleClass: nativeSnapshot.preview.sampleClass,
							width: nativeSnapshot.preview.width,
							wrapS: nativeSnapshot.preview.wrapS,
							wrapT: nativeSnapshot.preview.wrapT,
						},
			state: nativeSnapshot.state,
			texturePixelCount: nativeSnapshot.texturePixelCount,
		};
	}

	subscribeFrameTelemetry(listener: RuntimeFrameTelemetryListener): () => void {
		this.#assertUsable();
		this.#frameTelemetryListeners.add(listener);
		return () => {
			this.#frameTelemetryListeners.delete(listener);
		};
	}

	subscribeEvents(listener: RuntimeEventListener): () => void {
		this.#assertUsable();
		this.#eventListeners.add(listener);
		return () => {
			this.#eventListeners.delete(listener);
		};
	}

	dispose(): void {
		if (this.#disposed) {
			return;
		}
		this.#disposed = true;
		this.#unsubscribeRendererTelemetry();
		this.#eventListeners.clear();
		this.#frameTelemetryListeners.clear();
		this.#controller.dispose();
		this.#renderer.dispose();
	}

	#createStatus(): RuntimeOverviewSnapshot["status"] {
		if (this.#disposed) {
			return "disposed";
		}
		if (this.#sceneInterest.kind !== "none") {
			return "static-active";
		}
		return "idle";
	}

	#createPortalFrameWorkPlan(): ReturnType<
		typeof createRenderPassPortalFrameWorkPlan
	> {
		return createRenderPassPortalFrameWorkPlan({
			flatVisionModeEnabled: this.#flatVisionModeEnabled,
			renderPassPlan: DEFAULT_RENDER_PASS_PLAN,
		});
	}

	#emitEvent(event: RuntimeEvent): void {
		for (const listener of this.#eventListeners) {
			listener(event);
		}
	}

	#assertUsable(): void {
		if (this.#disposed) {
			throw new Error("Open world streaming runtime has been disposed.");
		}
	}
}

type OpenWorldTextureResidencyOverview = ReturnType<
	OpenWorldStreamingController["createDiagnosticsSnapshot"]
>["textureResidency"];

function createRuntimeTextureResidencyOverview(
	textureResidency: OpenWorldTextureResidencyOverview,
): RuntimeOverviewSnapshot["resources"]["textureResidency"] {
	return {
		buckets: textureResidency.buckets.map(createRuntimeTextureBucketOverview),
		summary: {
			activeBucketCount: textureResidency.bucketCount,
			approximateBytes: textureResidency.byteEstimate.approximateBytes,
			bucketCount: textureResidency.bucketCount,
			pageStates: {
				building: textureResidency.pages.building,
				planned: textureResidency.pages.planned,
				reclaimable: textureResidency.pages.reclaimable,
				resident: textureResidency.pages.resident,
			},
			registryEntryCount: textureResidency.entryCount,
			texturePageCount: textureResidency.pages.total,
		},
	};
}

function createRuntimeTextureBucketOverview(
	bucket: OpenWorldTextureResidencyOverview["buckets"][number],
): RuntimeOverviewSnapshot["resources"]["textureResidency"]["buckets"][number] {
	const bucketParts = parseOpenWorldTextureBucketKey(bucket.bucketKey);
	const ownerIds = new Set(bucket.entries.flatMap((entry) => entry.ownerIds));
	const sourceKeys = new Set(bucket.entries.map((entry) => entry.sourceKey));
	const entriesById = new Map(bucket.entries.map((entry) => [entry.id, entry]));
	return {
		bucketKey: bucket.bucketKey,
		domain: bucketParts.domain,
		entryCount: bucket.entries.length,
		ownerCount: ownerIds.size,
		pageCount: bucket.pages.length,
		pages: bucket.pages.map((page) => {
			const pageEntries = page.entryIds.map((entryId) => {
				const entry = entriesById.get(entryId);
				if (!entry) {
					throw new Error(
						`Texture page ${page.id} references missing entry ${entryId}.`,
					);
				}
				return entry;
			});
			return {
				assignedPixelCount: page.assignedPixelCount,
				assignedPixelRatio: createAssignedPixelRatio({
					assignedPixelCount: page.assignedPixelCount,
					texturePixelCount: page.texturePixelCount,
				}),
				bindingCount: sumCounts(
					pageEntries,
					(entry) => entry.bindingIds.length,
				),
				bucketKey: bucket.bucketKey,
				domain: bucketParts.domain,
				entryCount: page.entryIds.length,
				hasBuildReservation: page.reservationToken !== null,
				ownerCount: uniqueCount(pageEntries.flatMap((entry) => entry.ownerIds)),
				ownerlessRetainedState: page.ownerlessRetainedState,
				pageClasses: uniqueSorted(pageEntries.map((entry) => entry.pageClass)),
				pageId: page.id,
				purposes: uniqueSorted(pageEntries.map((entry) => entry.purpose)),
				scope: bucketParts.scope,
				sourceCount: uniqueCount(pageEntries.map((entry) => entry.sourceKey)),
				state: page.state,
				texturePixelCount: page.texturePixelCount,
			};
		}),
		purpose: bucketParts.purpose,
		scope: bucketParts.scope,
		uniqueSourceCount: sourceKeys.size,
	};
}

function uniqueSorted(values: readonly string[]): readonly string[] {
	return [...new Set(values)].sort();
}

function uniqueCount(values: readonly string[]): number {
	return new Set(values).size;
}

function sumCounts<T>(
	values: readonly T[],
	count: (value: T) => number,
): number {
	return values.reduce((total, value) => total + count(value), 0);
}

function createAssignedPixelRatio(input: {
	readonly assignedPixelCount: number;
	readonly texturePixelCount: number | null;
}): number | null {
	if (input.texturePixelCount === null || input.texturePixelCount <= 0) {
		return null;
	}
	return input.assignedPixelCount / input.texturePixelCount;
}

function createStaticObjectUploadSample(
	upload: RendererSnapshot["recentStaticObjectUploads"][number] | null,
): RendererDiagnosticsSummary["staticObjectUploadSummary"]["largestUpload"] {
	if (upload === null) {
		return null;
	}
	return {
		domain: upload.domain,
		drawUnitCount: upload.drawUnitCount,
		landblockId: `0x${upload.landblockId.toString(16).padStart(8, "0")}`,
		uploadMs: upload.uploadMs,
		uploadedBufferBytes: upload.uploadedBufferBytes,
	};
}

function createStaticInterestFromRuntimeSceneInterest(
	interest: RuntimeSceneInterest,
	revision: number,
): OpenWorldStreamingStaticInterest | null {
	if (interest.kind !== "outdoor-anchor") {
		return null;
	}
	return {
		anchorLandblockId: interest.anchorLandblockId,
		lod: {
			buildings: interest.domains.includes("buildings")
				? (interest.lod?.buildings ?? 0)
				: -1,
			envCells: interest.domains.includes("env-cells")
				? (interest.lod?.envCells ?? 0)
				: -1,
			explicitObjects: interest.domains.includes("explicit-objects")
				? (interest.lod?.explicitObjects ?? 0)
				: -1,
			generatedScenery: interest.domains.includes("generated-scenery")
				? (interest.lod?.generatedScenery ?? 0)
				: -1,
			terrain: interest.domains.includes("terrain")
				? (interest.lod?.terrain ?? 0)
				: -1,
		},
		revision,
	};
}
