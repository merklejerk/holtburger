import type {
	CompiledObjectDrawDiagnostics,
	EntityShadowResourceDiagnostics,
	FrameInput,
	RendererFrameDiagnostics,
	RendererFrameDiagnosticsSnapshot,
} from "./renderer";
import {
	BakedDrawMergeCensusCollector,
	type BakedDrawMergeCensus,
} from "./baked-draw-merge-census";
import { WebGL2FrameProfiler } from "./webgl2-gpu-frame-profiler";
import type { WebGL2PortalScopeAtlasFrame } from "./webgl2-portal-scope-atlas-pipeline";
import type { WebGL2PortalScopeAtlasPipeline } from "./webgl2-portal-scope-atlas-pipeline";
import type { WebGL2TransitionSnapshot } from "./webgl2-transition-snapshot";
import type { WebGL2FlatSceneTarget } from "./webgl2-flat-scene-target";
import type { WebGL2EntitySelectionPass } from "./webgl2-entity-selection-pass";
import type { WebGL2SaoPass } from "./webgl2-sao-pass";
import type { EffectiveAmbientOcclusionPolicy } from "./ambient-occlusion-policy";
import type { FrameInstanceStreamArena } from "./frame-instance-stream-arena";
import type { MutableFrameSelectionMetrics } from "./webgl2-renderer-types";

export interface FrameDiagnosticsSnapshotSources {
	getAppearancesUsage(): RendererFrameDiagnosticsSnapshot["dynamicResources"]["appearances"];
	getPosesUsage(): RendererFrameDiagnosticsSnapshot["dynamicResources"]["poses"];
	getCompiledObjectDrawsDiagnostics(): CompiledObjectDrawDiagnostics;
	getOutdoorTargetsDiagnostics(): EntityShadowResourceDiagnostics["outdoorTargets"];
	getNameplateCacheDiagnostics(): RendererFrameDiagnosticsSnapshot["nameplates"]["cache"];
	getNameplateIconDiagnostics(): RendererFrameDiagnosticsSnapshot["nameplates"]["icons"];
}

export interface RenderTargetMetricsSources {
	readonly portalScopeAtlasPipeline: WebGL2PortalScopeAtlasPipeline | null;
	readonly transitionSnapshot: WebGL2TransitionSnapshot | null;
	readonly portalTransitionTarget: WebGL2FlatSceneTarget | null;
	readonly portalTransitionVisualInstalled: boolean;
	readonly activeTransition: FrameInput["portalTransition"] | null;
	readonly flatSceneTarget: WebGL2FlatSceneTarget | null;
	readonly saoPass: WebGL2SaoPass | null;
}

export class RendererFrameDiagnosticsAndProfiler {
	readonly #gl: WebGL2RenderingContext;
	readonly #assertDeviceReady: () => void;
	/** Explicit session; null avoids clocks, extension probes, and GPU query resources. */
	#frameProfiler: WebGL2FrameProfiler | null = null;
	/** Reused metrics record for the frame's effective AO distance interval. */
	readonly #ambientOcclusionDistanceFadeMetrics = {
		disabledAt: 0,
		fullStrengthUntil: 0,
	};
	/**
	 * One-frame baked-draw merge census in flight, or null on an ordinary frame.
	 *
	 * Collector and waiter are held together because neither is meaningful alone: the census
	 * spans exactly the frame between installation and the next frame finish.
	 */
	#mergeCensusRequest: {
		readonly collector: BakedDrawMergeCensusCollector;
		readonly resolve: (census: BakedDrawMergeCensus) => void;
	} | null = null;

	eligibleNameplateCandidateCount = 0;
	budgetRejectedNameplateCandidateCount = 0;
	eligibleHealthBarCandidateCount = 0;
	budgetRejectedHealthBarCandidateCount = 0;
	submittedEntityOverlayInstanceCount = 0;
	submittedEntityOverlayDrawCount = 0;

	/** Reused per-frame diagnostics; cold reads return a copied snapshot. */
	readonly metrics: MutableFrameSelectionMetrics = {
		ambientOcclusion: {
			activeBytes: 0,
			allocatedGenerationCount: 0,
			pixelCount: 0,
			applicationCount: 0,
			disposedGenerationCount: 0,
			effectiveDistanceFade: null,
		},
		entitySelection: {
			activeMaskBytes: 0,
			allocatedTargetGenerationCount: 0,
			compositeDrawCount: 0,
			disposedTargetGenerationCount: 0,
			maskDrawCount: 0,
			selectedSphereProxyCount: 0,
			selectedPartCount: 0,
			selectedTriangleCount: 0,
			skippedReason: "no-target",
		},
		envCellRenderMode: "flat",
		terrainFrameInputs: 0,
		viewCount: 0,
		visibleDynamicEntityCount: 0,
		visibleDynamicSourceRangeCount: 0,
		testedObjectPresentationCount: 0,
		retainedObjectPresentationCount: 0,
		rejectedObjectPresentationCount: 0,
		visibleEnvCellShells: 0,
		visibleEnvCellScopeCount: 0,
		visibleEnvCellResidentNodes: 0,
		submittedEnvCellShellDrawCount: 0,
		submittedEnvCellShellTriangleCount: 0,
		submittedEnvCellResidentDrawCount: 0,
		submittedEnvCellResidentTriangleCount: 0,
		envCellShellCullOverrideCount: 0,
		portalSelectedScopeCount: 0,
		portalSelectedCrossingCount: 0,
		portalCompletedCullDepth: 0,
		portalPropagationDrawCount: 0,
		portalProjectionPrimitiveCount: 0,
		portalAtlasTilePixelCount: 0,
		portalFrontierRetreatCount: 0,
		portalTruncatedViewCount: 0,
		portalFramebufferCount: 0,
		portalTargetBytes: 0,
		portalTransitionSnapshotBytes: 0,
		portalTransitionOriginCaptured: false,
		portalTransitionSnapshotAllocatedGenerationCount: 0,
		portalTransitionSnapshotDisposedGenerationCount: 0,
		portalTransitionFramebufferCount: 0,
		portalTransitionTargetBytes: 0,
		submittedPortalTransitionDrawCount: 0,
		portalTransitionVisualInstalled: false,
		portalTransitionGeneration: null,
		portalTransitionKind: null,
		portalTransitionOnlyFramePresented: false,
		flatSceneFramebufferCount: 0,
		flatSceneTargetBytes: 0,
		flatSceneAllocatedGenerationCount: 0,
		flatSceneDisposedGenerationCount: 0,
		visibleSceneEntries: 0,
		visibleStaticLayerCount: 0,
		visibleStaticNodeCount: 0,
		submittedStaticObjectDrawCount: 0,
		submittedStaticObjectTriangleCount: 0,
		submittedBakedStaticObjectDrawCount: 0,
		submittedBakedStaticObjectTriangleCount: 0,
		submittedInstancedSourceTriangleCount: 0,
		transparentObjectCandidateCount: 0,
		farTransparentObjectCandidateCount: 0,
		nearTransparentObjectCandidateCount: 0,
		transparentFrameRunCount: 0,
		farTransparentFrameRunCount: 0,
		nearTransparentFrameRunCount: 0,
		frameInstanceUploadCount: 0,
		frameInstanceUploadBytes: 0,
		submittedTransparentObjectDrawCount: 0,
		submittedTransparentInstanceCount: 0,
		submittedAdditiveObjectDrawCount: 0,
		submittedDynamicDrawCount: 0,
		submittedParticleBatchCount: 0,
		submittedParticleInstanceCount: 0,
		unresolvedParticleBatchCount: 0,
		uploadedParticleRecordRowCount: 0,
		frameInstanceCapacity: 0,
		frameInstanceGrowthCount: 0,
		frameInstanceViewHighWaterMark: 0,
		droppedLights: 0,
		staticLightBinds: 0,
		terrainLightMaskUploads: 0,
		farTerrainDraws: 0,
		farTerrainPaletteUploads: 0,
		farTerrainCutoffLandblocks: null,
		objectLightingBinds: 0,
		objectProgramChanges: 0,
		objectTextureBinds: 0,
		objectDrawCalls: 0,
		objectUniformUploads: 0,
		objectSuppressedUniformUploads: 0,
	};

	constructor(gl: WebGL2RenderingContext, assertDeviceReady: () => void) {
		this.#gl = gl;
		this.#assertDeviceReady = assertDeviceReady;
	}

	get profiler(): WebGL2FrameProfiler | null {
		return this.#frameProfiler;
	}

	get mergeCensusCollector(): BakedDrawMergeCensusCollector | null {
		return this.#mergeCensusRequest?.collector ?? null;
	}

	createCapability(
		sources: FrameDiagnosticsSnapshotSources,
	): RendererFrameDiagnostics {
		return {
			snapshot: () => this.getSnapshot(sources),
			setProfilingEnabled: (enabled) => this.setProfilingEnabled(enabled),
			resetProfile: () => this.resetProfile(),
			captureBakedDrawMergeCensus: () => this.captureBakedDrawMergeCensus(),
		};
	}

	getSnapshot(
		sources: FrameDiagnosticsSnapshotSources,
	): RendererFrameDiagnosticsSnapshot {
		return {
			dynamicResources: {
				appearances: sources.getAppearancesUsage(),
				poses: sources.getPosesUsage(),
			},
			compiledObjectDraws: sources.getCompiledObjectDrawsDiagnostics(),
			entityShadows: {
				outdoorTargets: sources.getOutdoorTargetsDiagnostics(),
			},
			nameplates: {
				budgetRejectedCandidateCount:
					this.budgetRejectedNameplateCandidateCount,
				cache: sources.getNameplateCacheDiagnostics(),
				eligibleCandidateCount: this.eligibleNameplateCandidateCount,
				icons: sources.getNameplateIconDiagnostics(),
			},
			healthBars: {
				budgetRejectedCandidateCount:
					this.budgetRejectedHealthBarCandidateCount,
				eligibleCandidateCount: this.eligibleHealthBarCandidateCount,
			},
			entityOverlays: {
				submittedDrawCount: this.submittedEntityOverlayDrawCount,
				submittedInstanceCount: this.submittedEntityOverlayInstanceCount,
			},
			profile: this.#frameProfiler?.getProfile() ?? null,
			profilingEnabled: this.#frameProfiler !== null,
			selectionMetrics: {
				...this.metrics,
				ambientOcclusion: {
					...this.metrics.ambientOcclusion,
					effectiveDistanceFade: this.metrics.ambientOcclusion
						.effectiveDistanceFade
						? {
								...this.metrics.ambientOcclusion.effectiveDistanceFade,
							}
						: null,
				},
				entitySelection: {
					...this.metrics.entitySelection,
				},
			},
		};
	}

	setProfilingEnabled(enabled: boolean): void {
		this.#assertDeviceReady();
		if (enabled) {
			this.#frameProfiler ??= new WebGL2FrameProfiler(this.#gl);
			return;
		}
		this.#frameProfiler?.destroy();
		this.#frameProfiler = null;
	}

	resetProfile(): void {
		this.#frameProfiler?.reset();
	}

	captureBakedDrawMergeCensus(): Promise<BakedDrawMergeCensus> {
		return new Promise<BakedDrawMergeCensus>((resolve) => {
			if (this.#mergeCensusRequest !== null) {
				throw new Error("A baked draw merge census is already in flight.");
			}
			this.#mergeCensusRequest = {
				collector: new BakedDrawMergeCensusCollector(),
				resolve,
			};
		});
	}

	resetFrameSelectionMetrics(
		viewCount: number,
		envCellRenderMode: FrameInput["frameSettings"]["envCellRenderMode"],
	): void {
		const metrics = this.metrics;
		this.eligibleNameplateCandidateCount = 0;
		this.budgetRejectedNameplateCandidateCount = 0;
		this.eligibleHealthBarCandidateCount = 0;
		this.budgetRejectedHealthBarCandidateCount = 0;
		this.submittedEntityOverlayInstanceCount = 0;
		this.submittedEntityOverlayDrawCount = 0;
		metrics.ambientOcclusion.activeBytes = 0;
		metrics.ambientOcclusion.allocatedGenerationCount = 0;
		metrics.ambientOcclusion.pixelCount = 0;
		metrics.ambientOcclusion.applicationCount = 0;
		metrics.ambientOcclusion.disposedGenerationCount = 0;
		metrics.ambientOcclusion.effectiveDistanceFade = null;
		metrics.entitySelection.compositeDrawCount = 0;
		metrics.entitySelection.maskDrawCount = 0;
		metrics.entitySelection.selectedSphereProxyCount = 0;
		metrics.entitySelection.selectedPartCount = 0;
		metrics.entitySelection.selectedTriangleCount = 0;
		metrics.entitySelection.skippedReason = "no-target";
		metrics.envCellRenderMode = envCellRenderMode;
		metrics.terrainFrameInputs = 0;
		metrics.viewCount = viewCount;
		metrics.visibleDynamicEntityCount = 0;
		metrics.visibleDynamicSourceRangeCount = 0;
		metrics.testedObjectPresentationCount = 0;
		metrics.retainedObjectPresentationCount = 0;
		metrics.rejectedObjectPresentationCount = 0;
		metrics.visibleEnvCellShells = 0;
		metrics.visibleEnvCellScopeCount = 0;
		metrics.visibleEnvCellResidentNodes = 0;
		metrics.submittedEnvCellShellDrawCount = 0;
		metrics.submittedEnvCellShellTriangleCount = 0;
		metrics.submittedEnvCellResidentDrawCount = 0;
		metrics.submittedEnvCellResidentTriangleCount = 0;
		metrics.envCellShellCullOverrideCount = 0;
		metrics.portalSelectedScopeCount = 0;
		metrics.portalSelectedCrossingCount = 0;
		metrics.portalCompletedCullDepth = 0;
		metrics.portalPropagationDrawCount = 0;
		metrics.portalProjectionPrimitiveCount = 0;
		metrics.portalAtlasTilePixelCount = 0;
		metrics.portalFrontierRetreatCount = 0;
		metrics.portalTruncatedViewCount = 0;
		metrics.portalFramebufferCount = 0;
		metrics.portalTargetBytes = 0;
		metrics.portalTransitionSnapshotBytes = 0;
		metrics.portalTransitionOriginCaptured = false;
		metrics.portalTransitionSnapshotAllocatedGenerationCount = 0;
		metrics.portalTransitionSnapshotDisposedGenerationCount = 0;
		metrics.portalTransitionFramebufferCount = 0;
		metrics.portalTransitionTargetBytes = 0;
		metrics.submittedPortalTransitionDrawCount = 0;
		metrics.portalTransitionVisualInstalled = false;
		metrics.portalTransitionGeneration = null;
		metrics.portalTransitionKind = null;
		metrics.portalTransitionOnlyFramePresented = false;
		metrics.flatSceneFramebufferCount = 0;
		metrics.flatSceneTargetBytes = 0;
		metrics.flatSceneAllocatedGenerationCount = 0;
		metrics.flatSceneDisposedGenerationCount = 0;
		metrics.visibleSceneEntries = 0;
		metrics.visibleStaticLayerCount = 0;
		metrics.visibleStaticNodeCount = 0;
		metrics.submittedStaticObjectDrawCount = 0;
		metrics.submittedStaticObjectTriangleCount = 0;
		metrics.submittedBakedStaticObjectDrawCount = 0;
		metrics.submittedBakedStaticObjectTriangleCount = 0;
		metrics.submittedInstancedSourceTriangleCount = 0;
		metrics.transparentObjectCandidateCount = 0;
		metrics.farTransparentObjectCandidateCount = 0;
		metrics.nearTransparentObjectCandidateCount = 0;
		metrics.transparentFrameRunCount = 0;
		metrics.farTransparentFrameRunCount = 0;
		metrics.nearTransparentFrameRunCount = 0;
		metrics.frameInstanceUploadCount = 0;
		metrics.frameInstanceUploadBytes = 0;
		metrics.submittedTransparentObjectDrawCount = 0;
		metrics.submittedTransparentInstanceCount = 0;
		metrics.submittedAdditiveObjectDrawCount = 0;
		metrics.submittedDynamicDrawCount = 0;
		metrics.submittedParticleBatchCount = 0;
		metrics.submittedParticleInstanceCount = 0;
		metrics.unresolvedParticleBatchCount = 0;
		metrics.uploadedParticleRecordRowCount = 0;
		metrics.frameInstanceCapacity = 0;
		metrics.frameInstanceGrowthCount = 0;
		metrics.frameInstanceViewHighWaterMark = 0;
		metrics.droppedLights = 0;
		metrics.staticLightBinds = 0;
		metrics.terrainLightMaskUploads = 0;
		metrics.farTerrainDraws = 0;
		metrics.farTerrainPaletteUploads = 0;
		metrics.farTerrainCutoffLandblocks = null;
		metrics.objectLightingBinds = 0;
		metrics.objectProgramChanges = 0;
		metrics.objectTextureBinds = 0;
		metrics.objectDrawCalls = 0;
		metrics.objectUniformUploads = 0;
		metrics.objectSuppressedUniformUploads = 0;
	}

	/** Finish counters shared by ordinary frames and explicit portal execution probes. */
	finishFrameSelectionMetrics(
		visibleStaticLayerCount: number,
		visibleEnvCellScopeCount: number,
		arena: ReturnType<FrameInstanceStreamArena["getDiagnostics"]>,
	): void {
		const census = this.#mergeCensusRequest;
		if (census !== null) {
			this.#mergeCensusRequest = null;
			census.resolve(census.collector.summarize());
		}
		this.metrics.visibleStaticLayerCount = visibleStaticLayerCount;
		this.metrics.visibleEnvCellScopeCount = visibleEnvCellScopeCount;
		this.metrics.frameInstanceCapacity = arena.capacity;
		this.metrics.frameInstanceGrowthCount = arena.growthCount;
		this.metrics.frameInstanceViewHighWaterMark = arena.viewHighWaterMark;
	}

	/** Aggregate one independent view's scope-atlas plan into the frame snapshot. */
	accumulatePortalScopeAtlasMetrics(frame: WebGL2PortalScopeAtlasFrame): void {
		const atlas = frame.atlas;
		const visibility = atlas.visibility;
		const metrics = this.metrics;
		metrics.portalSelectedScopeCount += visibility.selectedScopeCount;
		metrics.portalSelectedCrossingCount += visibility.selectedCrossingCount;
		metrics.portalCompletedCullDepth += visibility.completedDepth;
		metrics.portalPropagationDrawCount +=
			atlas.commands.maskPropagationCommandCount;
		metrics.portalProjectionPrimitiveCount += frame.projectionPrimitiveCount;
		metrics.portalAtlasTilePixelCount += atlas.trace.tilePixelCount;
		metrics.portalFrontierRetreatCount += atlas.trace.frontierRetreatCount;
		if (visibility.status === "truncated")
			metrics.portalTruncatedViewCount += 1;
	}

	/** Copy renderer-lifetime target ownership into the current diagnostics snapshot. */
	updateRenderTargetMetrics(
		targets: RenderTargetMetricsSources,
		entitySelectionPass: WebGL2EntitySelectionPass | null,
	): void {
		const diagnostics =
			targets.portalScopeAtlasPipeline?.getDiagnostics() ?? null;
		this.metrics.portalFramebufferCount =
			diagnostics?.activeFramebufferCount ?? 0;
		this.metrics.portalTargetBytes = diagnostics?.activeBytes ?? 0;
		const transitionSnapshot = targets.transitionSnapshot?.getDiagnostics();
		this.metrics.portalTransitionSnapshotBytes =
			transitionSnapshot?.activeBytes ?? 0;
		this.metrics.portalTransitionOriginCaptured =
			(transitionSnapshot?.activeBytes ?? 0) > 0;
		this.metrics.portalTransitionSnapshotAllocatedGenerationCount =
			transitionSnapshot?.allocatedGenerationCount ?? 0;
		this.metrics.portalTransitionSnapshotDisposedGenerationCount =
			transitionSnapshot?.disposedGenerationCount ?? 0;
		const transitionTarget = targets.portalTransitionTarget;
		this.metrics.portalTransitionFramebufferCount =
			transitionTarget?.activeFramebufferCount ?? 0;
		this.metrics.portalTransitionTargetBytes =
			transitionTarget?.activeBytes ?? 0;
		this.metrics.portalTransitionVisualInstalled =
			targets.portalTransitionVisualInstalled;
		this.metrics.portalTransitionGeneration =
			targets.activeTransition?.generation ?? null;
		this.metrics.portalTransitionKind = targets.activeTransition?.kind ?? null;
		const flatTarget = targets.flatSceneTarget;
		this.metrics.flatSceneFramebufferCount =
			flatTarget?.activeFramebufferCount ?? 0;
		this.metrics.flatSceneTargetBytes = flatTarget?.activeBytes ?? 0;
		this.metrics.flatSceneAllocatedGenerationCount =
			flatTarget?.allocatedGenerationCount ?? 0;
		this.metrics.flatSceneDisposedGenerationCount =
			flatTarget?.disposedGenerationCount ?? 0;
		const selectionDiagnostics = entitySelectionPass?.getDiagnostics();
		this.metrics.entitySelection.activeMaskBytes =
			selectionDiagnostics?.activeMaskBytes ?? 0;
		this.metrics.entitySelection.allocatedTargetGenerationCount =
			selectionDiagnostics?.allocatedTargetGenerationCount ?? 0;
		this.metrics.entitySelection.disposedTargetGenerationCount =
			selectionDiagnostics?.disposedTargetGenerationCount ?? 0;
		const saoPass = targets.saoPass;
		const ambientOcclusionMetrics = this.metrics.ambientOcclusion;
		ambientOcclusionMetrics.activeBytes = saoPass?.activeBytes ?? 0;
		ambientOcclusionMetrics.allocatedGenerationCount =
			saoPass?.allocatedGenerationCount ?? 0;
		ambientOcclusionMetrics.disposedGenerationCount =
			saoPass?.disposedGenerationCount ?? 0;
	}

	recordAmbientOcclusionDistanceFade(
		ambientOcclusion: EffectiveAmbientOcclusionPolicy,
	): void {
		if (ambientOcclusion.kind === "enabled") {
			this.#ambientOcclusionDistanceFadeMetrics.disabledAt =
				ambientOcclusion.distanceFade.disabledAt;
			this.#ambientOcclusionDistanceFadeMetrics.fullStrengthUntil =
				ambientOcclusion.distanceFade.fullStrengthUntil;
			this.metrics.ambientOcclusion.effectiveDistanceFade =
				this.#ambientOcclusionDistanceFadeMetrics;
		} else {
			this.metrics.ambientOcclusion.effectiveDistanceFade = null;
		}
	}

	/** Account for the exact full-resolution workload of one successful SAO invocation. */
	recordAmbientOcclusionWork(pixelCount: number): void {
		const metrics = this.metrics.ambientOcclusion;
		metrics.applicationCount += 1;
		metrics.pixelCount += pixelCount;
	}

	/**
	 * Account for one per-draw uniform write.
	 *
	 * Issued and suppressed are counted separately rather than derived from each other, because
	 * their sum is the uniform set a draw would send without filtering, and the ratio between them
	 * is what the filtering actually saves. A method rather than a closure so the submission path
	 * allocates nothing per draw.
	 */
	countUniformWrite(issued: boolean): void {
		const metrics = this.metrics;
		if (issued) metrics.objectUniformUploads += 1;
		else metrics.objectSuppressedUniformUploads += 1;
	}

	destroy(): void {
		this.#frameProfiler?.destroy();
		this.#frameProfiler = null;
	}
}
