import type { AssetService } from "../../../assets/contracts";
import type { DynamicEntityId } from "../../../dynamic/contracts";
import type { RuntimeHost } from "../../../host/runtime-contracts";
import { createLegacyPortalFrameWorkPlan } from "../../../renderer/portal-frame-work-plan";
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
	type RuntimeDiagnosticsSnapshot,
	type RuntimeEvent,
	type RuntimeOverviewSnapshot,
	type RuntimeSceneInterest,
} from "../../../runtime/client-runtime";
import { EMPTY_RUNTIME_PORTAL_OVERLAP_RESIDENCY } from "../../../runtime/portal-base-overlap";
import type {
	StaticSceneEnvCellBounds,
	StaticSceneTerrainLandblockBounds,
} from "../../../runtime/scene-query/contracts";
import type { EnvCellResourceMembership } from "../../../runtime/env-cell-resource-membership";
import type { ScenePickHit } from "../../../runtime/scene-query/merged-scene-query-contracts";
import type { TextureFilteringMode } from "../../../textures/sampling-policy";
import type { TextureAtlasPageInspectionSnapshot } from "../../../textures/texture-manager";
import type { OpenWorldStreamingBoundaryAdapters } from "../adapters/browser-boundaries";
import {
	createEmptyLegacyDynamicRuntimeSnapshot,
	createEmptyLegacyStaticDiagnosticsSnapshot,
	createEmptyLegacyStaticOverviewSnapshot,
	createEmptyLegacyStaticSceneQueryDiagnosticsSnapshot,
	createEmptyLegacyStaticSceneQueryOverviewSnapshot,
} from "../testing/empty-runtime-snapshots";
import { OpenWorldStreamingController } from "./open-world-streaming-controller";

export interface OpenWorldStreamingClientRuntimeOptions {
	readonly adapters: OpenWorldStreamingBoundaryAdapters;
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
	return new OpenWorldStreamingClientRuntimeAdapter(options.adapters);
}

class OpenWorldStreamingClientRuntimeAdapter implements ClientRuntime {
	readonly #assetService: AssetService;
	readonly #controller = new OpenWorldStreamingController();
	readonly #eventListeners = new Set<RuntimeEventListener>();
	readonly #host: RuntimeHost;
	readonly #renderer: Renderer;
	readonly #unsubscribeRendererTelemetry: () => void;
	#currentCamera: FrameState["camera"] = DEFAULT_CAMERA;
	#currentCameraResidency: RuntimeCameraResidency = DEFAULT_CAMERA_RESIDENCY;
	#disposed = false;
	#envCellAabbDebugOverlayVisible = false;
	#envCellPortalDebugOverlayVisible = false;
	#flatVisionModeEnabled = false;
	#sceneInterest: RuntimeSceneInterest = { kind: "none" };
	#sceneInterestRevision = 0;
	#textureFilteringMode: TextureFilteringMode = DEFAULT_TEXTURE_FILTERING_MODE;

	constructor(adapters: OpenWorldStreamingBoundaryAdapters) {
		this.#assetService = adapters.assets.assetService;
		this.#host = adapters.assets.host;
		this.#renderer = adapters.renderer.renderer;
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

	createRuntimeSpawn(): DynamicEntityId {
		throw new Error(
			"Runtime-authored dynamic entities are not implemented in the open-world streaming pipeline yet.",
		);
	}

	removeRuntimeSpawn(): boolean {
		this.#assertUsable();
		return false;
	}

	updateRuntimeSpawnRenderResidence(): boolean {
		this.#assertUsable();
		return false;
	}

	updateSceneInterest(interest: RuntimeSceneInterest): void {
		this.#assertUsable();
		this.#sceneInterest = interest;
		this.#sceneInterestRevision += 1;
		this.#controller.updateSceneInterest(interest.kind !== "none");
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

	queryEnvCellBounds(): StaticSceneEnvCellBounds | null {
		this.#assertUsable();
		return null;
	}

	queryTerrainLandblockBounds(): StaticSceneTerrainLandblockBounds | null {
		this.#assertUsable();
		return null;
	}

	queryEnvCellResourceMembership(): EnvCellResourceMembership | null {
		this.#assertUsable();
		return null;
	}

	setCurrentCameraResidency(residency: RuntimeCameraResidency): void {
		this.#assertUsable();
		this.#currentCameraResidency = residency;
	}

	pickSceneRay(): ScenePickHit | null {
		this.#assertUsable();
		return null;
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

	createTextureAtlasPageInspectionSnapshot(input: {
		readonly bucketId: string;
		readonly pageId: string;
	}): TextureAtlasPageInspectionSnapshot | null {
		this.#assertUsable();
		this.#controller.createAtlasInspectionSnapshot({
			bucketKey: input.bucketId,
			pageId: input.pageId,
		});
		return null;
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
		this.#renderer.updateFrameState({
			camera: this.#currentCamera,
			timeSeconds,
		});
	}

	createOverviewSnapshot(): RuntimeOverviewSnapshot {
		const rendererResources = this.#renderer.createResourceSnapshot();
		const staticOverview = createEmptyLegacyStaticOverviewSnapshot();
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
				atlas: {
					buckets: [],
					summary: {
						activeBucketCount: 0,
						approximateBytes: 0,
						bucketCount: 0,
						pageLifecycle: {
							absorbed: 0,
							created: 0,
							reclaimed: 0,
							retained: 0,
						},
						registryEntryCount: 0,
						texturePageCount: 0,
					},
				},
				renderer: rendererResources,
			},
			sceneInterest: this.#sceneInterest,
			static: staticOverview,
			staticSceneQuery: createEmptyLegacyStaticSceneQueryOverviewSnapshot(),
			status: this.#createStatus(),
		};
	}

	createDiagnosticsSnapshot(): RuntimeDiagnosticsSnapshot {
		return {
			assets: this.#assetService.createSnapshot(),
			currentCameraResidency: this.#currentCameraResidency,
			currentPortalOverlapResidency: EMPTY_RUNTIME_PORTAL_OVERLAP_RESIDENCY,
			debugOverlays: {
				envCellAabbCount: 0,
				envCellAabbsVisible: this.#envCellAabbDebugOverlayVisible,
				flatVisionModeEnabled: this.#flatVisionModeEnabled,
				portalCount: 0,
				portalsVisible: this.#envCellPortalDebugOverlayVisible,
			},
			dynamic: createEmptyLegacyDynamicRuntimeSnapshot(),
			host: this.#host.createSnapshot(),
			portalFrameWorkPlan: this.#createPortalFrameWorkPlan(),
			renderPassPlan: DEFAULT_RENDER_PASS_PLAN,
			renderPolicy: {
				textureFilteringMode: this.#textureFilteringMode,
			},
			renderer: this.#renderer.createDiagnosticsSnapshot(),
			sceneInterest: this.#sceneInterest,
			static: createEmptyLegacyStaticDiagnosticsSnapshot(),
			staticCommitInstall: {
				committedCommits: [],
				committedStaticDirectDrawUnits: 0,
				envCellResourceMembershipRevision: 0,
				failedCommits: [],
				pendingCommits: [],
				sourceStaticDirectDrawUnits: 0,
			},
			staticSceneQuery: createEmptyLegacyStaticSceneQueryDiagnosticsSnapshot(),
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
					},
				},
			],
			kind: "runtime-diagnostics-report",
			runtime: {
				committedStaticCommitInstallCount:
					nativeDiagnostics.sceneCommits.applied,
				envCellResourceMembershipRevision: 0,
				installedStaticDrawUnits: 0,
				pendingStaticCommitInstallCount: nativeDiagnostics.sceneCommits.pending,
				portalFrameWorkPlan: {
					kind: "legacy-render-pass",
					mode: "single-surface-resident",
					renderPassKind: DEFAULT_RENDER_PASS_PLAN.kind,
				},
				renderPassKind: DEFAULT_RENDER_PASS_PLAN.kind,
				sceneInterest:
					this.#sceneInterest.kind === "none" ? null : this.#sceneInterest.kind,
				sourceStaticDrawUnits: 0,
				status: this.#createStatus(),
				textureFilteringMode: this.#textureFilteringMode,
			},
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
		typeof createLegacyPortalFrameWorkPlan
	> {
		return createLegacyPortalFrameWorkPlan({
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
