import { describe, expect, it } from "vitest";
import type { AssetService, HostAssetKey } from "../../../assets/contracts";
import type { RuntimeHost } from "../../../host/runtime-contracts";
import type {
	FrameState,
	Renderer,
	RendererFrameTelemetryListener,
	RendererResourceSnapshot,
	RendererSnapshot,
	RenderPassPlan,
	PortalFrameWorkPlan,
} from "../../../renderer/types";
import { createLegacyPortalFrameWorkPlan } from "../../../renderer/portal-frame-work-plan";
import { createOpenWorldStreamingClientRuntime } from "./client-runtime-adapter";
import {
	DEFAULT_BROWSER_RUNTIME_PIPELINE,
	parseBrowserRuntimePipelineMode,
} from "./runtime-pipeline";
import {
	describeOpenWorldStreamingSceneCommit,
	summarizeOpenWorldStreamingTextureCommit,
} from "..";
import type { OpenWorldStreamingSceneCommit } from "../scene-commits/contracts";
import type {
	OpenWorldStreamingTextureBindingReadiness,
	OpenWorldStreamingTextureCommit,
} from "../texture-residency/commits/contracts";

describe("open-world streaming runtime pipeline composition", () => {
	it("parses explicit browser runtime pipeline modes", () => {
		expect(parseBrowserRuntimePipelineMode(null)).toBe(
			DEFAULT_BROWSER_RUNTIME_PIPELINE,
		);
		expect(parseBrowserRuntimePipelineMode("legacy")).toBe("legacy");
		expect(parseBrowserRuntimePipelineMode("open-world-streaming")).toBe(
			"open-world-streaming",
		);
		expect(() => parseBrowserRuntimePipelineMode("static-coordinator")).toThrow(
			/Unsupported browser runtime pipeline/,
		);
	});

	it("creates the replacement ClientRuntime boundary without eager worker use", () => {
		const renderer = new FixtureRenderer();
		const runtime = createOpenWorldStreamingClientRuntime({
			adapters: {
				assets: {
					assetService: new FixtureAssetService(),
					host: new FixtureRuntimeHost(),
				},
				renderer: {
					renderer,
				},
				workers: {
					createDynamicVisualBaker: failIfWorkerFactoryIsCalled,
					createDynamicVisualRecipeResolver: failIfWorkerFactoryIsCalled,
					createStaticBaker: failIfWorkerFactoryIsCalled,
					createStaticSourceResolver: failIfWorkerFactoryIsCalled,
					createTexturePacker: failIfWorkerFactoryIsCalled,
				},
			},
		});

		expect(runtime.createOverviewSnapshot()).toMatchObject({
			status: "idle",
		});
		expect(runtime.createDiagnosticsReport()).toMatchObject({
			kind: "runtime-diagnostics-report",
			runtime: {
				status: "idle",
			},
		});

		runtime.dispose();

		expect(renderer.disposed).toBe(true);
	});

	it("exposes direct commit and readiness contracts without legacy placement snapshots", () => {
		const sceneCommit: OpenWorldStreamingSceneCommit = {
			envelope: {
				currentnessToken: "owner-current:1",
				emittedAtMs: 1,
				ownerId: "terrain:0xda55ffff",
			},
			kind: "terrain-layer-commit",
		};
		const readiness: OpenWorldStreamingTextureBindingReadiness = {
			kind: "pending",
			reason: "page-building",
		};
		const textureCommit: OpenWorldStreamingTextureCommit = {
			bindingRemovals: [],
			bindingUpdates: [
				{
					bindingId: "terrain:color:0",
					readiness,
				},
			],
			bucketKey: "terrain:0xda55ffff",
			kind: "texture-commit",
			pageRemovals: [],
			pageUpdates: [],
		};

		expect(sceneCommit.kind).toBe("terrain-layer-commit");
		expect(textureCommit.bindingUpdates[0]?.readiness.kind).toBe("pending");
		expect(describeOpenWorldStreamingSceneCommit(sceneCommit)).toBe(
			"terrain-layer-commit:terrain:0xda55ffff",
		);
		expect(summarizeOpenWorldStreamingTextureCommit(textureCommit)).toEqual({
			bindingRemovalCount: 0,
			bindingUpdateCount: 1,
			pageRemovalCount: 0,
			pageUpdateCount: 0,
		});
	});
});

function failIfWorkerFactoryIsCalled(): never {
	throw new Error("Phase 1 replacement composition must not start workers.");
}

class FixtureAssetService implements AssetService {
	requestPreparedAsset(key: HostAssetKey) {
		return Promise.reject(
			new Error(`Fixture asset service cannot load ${key.kind}:${key.id}.`),
		);
	}

	acquirePreparedAssetLease(key: HostAssetKey) {
		return {
			key,
			release() {},
		};
	}

	pruneExpiredWarmAssets(): number {
		return 0;
	}

	createOverviewSnapshot() {
		return {
			committedCount: 0,
			pendingCount: 0,
		};
	}

	createSnapshot() {
		return {
			committed: [],
			pending: [],
		};
	}
}

class FixtureRuntimeHost implements RuntimeHost {
	lookupAsset(key: HostAssetKey) {
		return Promise.reject(
			new Error(`Fixture runtime host cannot load ${key.kind}:${key.id}.`),
		);
	}

	createSnapshot() {
		return {
			failure: null,
			isAvailable: true,
		};
	}
}

class FixtureRenderer implements Renderer {
	disposed = false;
	#frameCount = 0;
	#frameHandlerMs = 0;
	#renderPassPlan: RenderPassPlan = { kind: "single-surface-resident" };
	#portalFrameWorkPlan: PortalFrameWorkPlan = createLegacyPortalFrameWorkPlan({
		flatVisionModeEnabled: false,
		renderPassPlan: this.#renderPassPlan,
	});
	readonly #listeners = new Set<RendererFrameTelemetryListener>();

	applyTexturePlacementUpdate(): void {}

	applySamplerPolicyUpdate(): void {}

	setTerrainLayer(): void {}

	setOutdoorBuildingsLayer(): void {}

	setOutdoorExplicitObjectsLayer(): void {}

	setOutdoorGeneratedSceneryLayer(): void {}

	setEnvCellSystemLayer(): void {}

	commitDynamicResources(): void {}

	commitDynamicInstances(): void {}

	setStaticLayerVisibility(): void {}

	setStaticRenderAnchorLandblockId(): void {}

	setFlatVisionModeEnabled(): void {}

	setRenderPassPlan(plan: RenderPassPlan): void {
		this.#renderPassPlan = plan;
	}

	setPortalFrameWorkPlan(plan: PortalFrameWorkPlan): void {
		this.#portalFrameWorkPlan = plan;
	}

	setDebugOverlayPrimitives(): void {}

	updateFrameState(state: FrameState): void {
		this.#frameCount += 1;
		for (const listener of this.#listeners) {
			listener({
				directEnvCellDrawCalls: 0,
				frameCount: this.#frameCount,
				frameHandlerMs: this.#frameHandlerMs + state.timeSeconds * 0,
			});
		}
	}

	subscribeTelemetry(listener: RendererFrameTelemetryListener): () => void {
		this.#listeners.add(listener);
		return () => {
			this.#listeners.delete(listener);
		};
	}

	createResourceSnapshot(): RendererResourceSnapshot {
		return {
			directEnvCellDrawCalls: 0,
			dynamicDrawCalls: 0,
			dynamicInstances: 0,
			dynamicVisualResources: 0,
			staticDrawUnits: 0,
			terrainDrawUnits: 0,
		};
	}

	createObjectMaterialTextureDiagnostics() {
		return [];
	}

	createDiagnosticsSnapshot(): RendererSnapshot {
		return {
			backend: "webgl2",
			canvasHeight: 1,
			canvasWidth: 1,
			debugOverlayPrimitives: 0,
			directEnvCellDrawCalls: 0,
			dynamicDrawCalls: 0,
			dynamicInstances: 0,
			dynamicVisualResourceTextureUses: 0,
			dynamicVisualResources: 0,
			error: null,
			frameCount: this.#frameCount,
			frameHandlerMs: this.#frameHandlerMs,
			isRunning: true,
			outdoorGeneratedSceneryStaticObjectBakedDirectDrawCalls: 0,
			outdoorGeneratedSceneryStaticObjectBakedDirectDrawCallsByPass: {
				additive: 0,
				alphaTest: 0,
				opaque: 0,
				transparent: 0,
			},
			outdoorGeneratedSceneryStaticObjectRenderInstances: 0,
			outdoorGeneratedSceneryStaticObjectResources: 0,
			outdoorGeneratedSceneryStaticObjectUploadedBufferBytes: 0,
			outdoorGeneratedSceneryStaticObjectVisualResources: 0,
			portalFrameWorkPlan: this.#portalFrameWorkPlan,
			recentDynamicResourceCommits: [],
			recentStaticObjectUploads: [],
			renderedTriangles: 0,
			renderPassPlan: this.#renderPassPlan,
			sceneDomainTargets: {
				active: false,
				apertureBatchDrawCalls: 0,
				colorFormat: "rgb8",
				compositingMode: "none",
				compositePasses: 0,
				depthFormat: "depth24-stencil8",
				envCellOutdoorCrossingColorBase: false,
				executedCompositeDepth: 0,
				exteriorDrawCalls: 0,
				exteriorSuffixCompositeDepth: 0,
				exteriorSuffixCompositePasses: 0,
				height: 1,
				interiorDrawCalls: 0,
				outdoorCrossingSource: "none",
				width: 1,
			},
			skippedDynamicSubmissions: 0,
			staticDrawUnits: 0,
			staticObjectBakedDirectDrawCalls: 0,
			staticObjectDirectRenderInstanceDrawCalls: 0,
			staticObjectFarTransparentDirectRenderInstanceDrawCalls: 0,
			staticObjectFarTransparentInstancedRenderInstanceDrawCalls: 0,
			staticObjectFarTransparentInstancedRenderInstances: 0,
			staticObjectInstancedRenderInstanceDrawCalls: 0,
			staticObjectInstancedRenderInstances: 0,
			staticObjectNearTransparentDirectRenderInstanceDrawCalls: 0,
			staticObjectRenderInstances: 0,
			staticObjectResources: 0,
			staticObjectUploadedBufferBytes: 0,
			staticObjectVisualResources: 0,
			terrainDrawUnits: 0,
		};
	}

	dispose(): void {
		this.disposed = true;
	}
}
