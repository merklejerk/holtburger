import type {
	OpenWorldStreamingAtlasInspectionSnapshot,
	OpenWorldStreamingDiagnosticsSnapshot,
	OpenWorldStreamingStaticTaskStageTiming,
	OpenWorldStreamingStaticTaskDiagnostics,
} from "../diagnostics/contracts";
import type { Renderer } from "../../../renderer/types";
import { StaticSceneQuery } from "../../../runtime/static-scene-query";
import { planStaticDemand } from "../../../static/demand-planner";
import type {
	EnvCellSystemPayloadSummary,
	OutdoorStaticObjectsPayloadSummary,
	StaticDemandPlan,
	StaticBaker,
	StaticLandblockSceneLodResolution,
	StaticLandblockSceneLodSourceProjectionEvent,
	StaticLandblockSceneLodSourceRequest,
	StaticLandblockSceneLodSourceResolver,
	StaticLayerTaskRequest,
	TerrainStaticScopePayloadSummary,
} from "../../../static/contracts";
import { MaterializationOwnerRegistry } from "../owners/owner-registry";
import type { MaterializationOwnerToken } from "../owners/owner-registry";
import {
	createStaticLayerMaterializationOwner,
	type MaterializationOwnerId,
} from "../owners/owner-id";
import { OpenWorldTextureClaimRegistry } from "../texture-residency/claims/texture-claim-registry";
import {
	OpenWorldTerrainArtifactRunner,
	type OpenWorldTerrainLayerCommit,
} from "../static-layers/terrain/terrain-artifact-runner";
import {
	OpenWorldOutdoorObjectArtifactRunner,
	type OpenWorldOutdoorObjectLayerCommit,
} from "../static-layers/outdoor-objects/outdoor-object-artifact-runner";
import {
	OpenWorldEnvCellArtifactRunner,
	type OpenWorldEnvCellSystemLayerCommit,
} from "../static-layers/env-cells/env-cell-artifact-runner";
import type { PreparedAssetReader } from "../../../assets/contracts";
import { applyOpenWorldStreamingTextureCommit } from "../texture-residency/commits/texture-commit-applier";
import {
	createEnvCellResourceMembershipIndex,
	createEnvCellResourceMembershipSnapshot,
	type EnvCellResourceMembership,
} from "../../../runtime/env-cell-resource-membership";
import type {
	ScenePickHit,
	ScenePickRequest,
} from "../../../runtime/scene-query/merged-scene-query-contracts";
import type { StaticSceneEnvCellBounds } from "../../../runtime/scene-query/contracts";
import type { TexturePacker } from "../../../textures/packing/packer";
import {
	DirectOpenWorldObjectVisualAtlasBuilder,
	type OpenWorldObjectVisualAtlasBuilder,
} from "../texture-residency/placement/object-visual-atlas-builder";
import type {
	DynamicEntityId,
	DynamicEntityRenderResidence,
	DynamicRuntimeSnapshot,
} from "../../../dynamic/contracts";
import type { RuntimeDynamicSpawnRequest } from "../../../dynamic/dynamic-entity-controller";
import type { DynamicVisualBaker } from "../../../dynamic/visual-baker";
import type { DynamicVisualRecipeResolver } from "../../../dynamic/visual-recipe-resolver";
import {
	OpenWorldRuntimeEntitySystem,
	type OpenWorldRuntimeEntityDiagnosticsSnapshot,
} from "../runtime-entities/runtime-entity-system";

export interface OpenWorldStreamingControllerOptions {
	readonly assetReader: PreparedAssetReader;
	readonly renderer: Pick<
		Renderer,
		| "applyTexturePlacementUpdate"
		| "setStaticRenderAnchorLandblockId"
		| "setOutdoorBuildingsLayer"
		| "setOutdoorExplicitObjectsLayer"
		| "setOutdoorGeneratedSceneryLayer"
		| "setEnvCellSystemLayer"
		| "setTerrainLayer"
		| "commitDynamicResources"
		| "commitDynamicInstances"
	>;
	readonly createDynamicVisualBaker: () => DynamicVisualBaker;
	readonly createDynamicVisualRecipeResolver: () => DynamicVisualRecipeResolver;
	readonly createTexturePacker: () => TexturePacker;
	readonly createObjectVisualAtlasBuilder?: () => OpenWorldObjectVisualAtlasBuilder;
	readonly createStaticBaker: () => StaticBaker;
	readonly createStaticResolver: () => StaticLandblockSceneLodSourceResolver;
	readonly staticPublicationMode?: OpenWorldStreamingStaticPublicationMode;
}

export type OpenWorldStreamingStaticPublicationMode =
	| "normal"
	| "suppress-dense-renderer"
	| "defer-dense-renderer-until-ready";

export interface OpenWorldStreamingTerrainInterest {
	readonly anchorLandblockId: number;
	readonly radius: number;
	readonly revision: number;
}

export interface OpenWorldStreamingStaticInterest {
	readonly anchorLandblockId: number;
	readonly lod: {
		readonly buildings: number;
		readonly envCells: number;
		readonly explicitObjects: number;
		readonly generatedScenery: number;
		readonly terrain: number;
	};
	readonly revision: number;
}

export interface OpenWorldStreamingControllerSnapshot {
	readonly dynamic: DynamicRuntimeSnapshot;
	readonly envCells: OpenWorldStreamingEnvCellProgressSnapshot;
	readonly outdoorObjects: OpenWorldStreamingOutdoorObjectProgressSnapshot;
	readonly staticSceneQuery: ReturnType<StaticSceneQuery["createSnapshot"]>;
	readonly staticSceneQueryOverview: ReturnType<
		StaticSceneQuery["createOverviewSnapshot"]
	>;
	readonly terrain: OpenWorldStreamingTerrainProgressSnapshot;
}

interface OpenWorldStreamingTerrainProgressSnapshot {
	readonly baking: number;
	readonly committed: number;
	readonly failed: number;
	readonly installedDrawUnits: number;
	readonly latestTerrainPayload: TerrainStaticScopePayloadSummary | null;
	readonly requested: number;
	readonly resolving: number;
	readonly sourceDrawUnits: number;
}

interface OpenWorldStreamingOutdoorObjectProgressSnapshot {
	readonly baking: number;
	readonly committed: number;
	readonly failed: number;
	readonly installedDrawUnits: number;
	readonly latestOutdoorObjectPayload: OutdoorStaticObjectsPayloadSummary | null;
	readonly requested: number;
	readonly resolving: number;
	readonly sourceDrawUnits: number;
}

interface OpenWorldStreamingEnvCellProgressSnapshot {
	readonly baking: number;
	readonly committed: number;
	readonly failed: number;
	readonly installedDrawUnits: number;
	readonly latestEnvCellSystemPayload: EnvCellSystemPayloadSummary | null;
	readonly requested: number;
	readonly resolving: number;
	readonly sourceDrawUnits: number;
}

interface ActiveStaticTaskTiming {
	readonly domain: StaticLayerTaskRequest["domain"];
	readonly ownerId: MaterializationOwnerId;
	readonly phase: "materializing" | "applying";
	readonly startedAtMs: number;
	readonly taskId: string;
}

interface StaticTaskTiming {
	readonly applyMs: number;
	readonly domain: StaticLayerTaskRequest["domain"];
	readonly drawUnits: number;
	readonly durationMs: number;
	readonly error: string | null;
	readonly ownerId: MaterializationOwnerId;
	readonly stages: readonly OpenWorldStreamingStaticTaskStageTiming[];
	readonly status: "committed" | "failed" | "stale-rejected";
	readonly taskId: string;
}

interface StaticLayerRunRequest {
	readonly owner: {
		readonly id: MaterializationOwnerId;
	};
	readonly task: StaticLayerTaskRequest;
	readonly token: MaterializationOwnerToken;
}

const STATIC_MATERIALIZATION_CONCURRENCY = 1;
const DEFAULT_STATIC_PUBLICATION_MODE: OpenWorldStreamingStaticPublicationMode =
	"defer-dense-renderer-until-ready";

export class OpenWorldStreamingController {
	readonly #owners = new MaterializationOwnerRegistry();
	readonly #options: OpenWorldStreamingControllerOptions;
	readonly #renderer: OpenWorldStreamingControllerOptions["renderer"];
	readonly #staticSceneQuery = new StaticSceneQuery();
	#envCellResourceMembershipByLandblock = createEnvCellResourceMembershipIndex(
		[],
	);
	#envCellRunner: OpenWorldEnvCellArtifactRunner | null = null;
	#outdoorObjectRunner: OpenWorldOutdoorObjectArtifactRunner | null = null;
	#staticSourceResolver: StaticLandblockSceneLodSourceResolver | null = null;
	readonly #sourceResolutionCache = new OpenWorldStaticSourceResolutionCache({
		resolveProjectedSources: (request, onProjection) => {
			const resolver = this.#requireStaticSourceResolver();
			return resolver.resolveProjectedSources?.(request, onProjection) ?? null;
		},
		resolveSource: (request) =>
			this.#requireStaticSourceResolver().resolveSource(request),
	});
	#terrainRunner: OpenWorldTerrainArtifactRunner | null = null;
	#runtimeEntities: OpenWorldRuntimeEntitySystem | null = null;
	#objectVisualAtlasBuilder: OpenWorldObjectVisualAtlasBuilder | null = null;
	#texturePacker: TexturePacker | null = null;
	#frameBudgetYieldedPasses = 0;
	readonly #deferredOutdoorRendererLayers = {
		buildings: new Map<
			number,
			Extract<
				OpenWorldOutdoorObjectLayerCommit["payload"],
				{ readonly kind: "outdoor-buildings" }
			>
		>(),
		explicitObjects: new Map<
			number,
			Extract<
				OpenWorldOutdoorObjectLayerCommit["payload"],
				{ readonly kind: "outdoor-explicit-objects" }
			>
		>(),
		generatedScenery: new Map<
			number,
			Extract<
				OpenWorldOutdoorObjectLayerCommit["payload"],
				{ readonly kind: "outdoor-generated-scenery" }
			>
		>(),
	};
	readonly #deferredEnvCellRendererLayers = new Map<
		number,
		OpenWorldEnvCellSystemLayerCommit["payload"]
	>();
	readonly #textureClaims = new OpenWorldTextureClaimRegistry();
	readonly #activeStaticTasksByTaskId = new Map<
		string,
		ActiveStaticTaskTiming
	>();
	#disposed = false;
	#recentStaticTaskTimings: StaticTaskTiming[] = [];
	#activeSceneInterest = false;
	#runSequence = 0;
	#terrainProgress: OpenWorldStreamingTerrainProgressSnapshot = {
		baking: 0,
		committed: 0,
		failed: 0,
		installedDrawUnits: 0,
		latestTerrainPayload: null,
		requested: 0,
		resolving: 0,
		sourceDrawUnits: 0,
	};
	#outdoorObjectProgress: OpenWorldStreamingOutdoorObjectProgressSnapshot = {
		baking: 0,
		committed: 0,
		failed: 0,
		installedDrawUnits: 0,
		latestOutdoorObjectPayload: null,
		requested: 0,
		resolving: 0,
		sourceDrawUnits: 0,
	};
	#envCellProgress: OpenWorldStreamingEnvCellProgressSnapshot = {
		baking: 0,
		committed: 0,
		failed: 0,
		installedDrawUnits: 0,
		latestEnvCellSystemPayload: null,
		requested: 0,
		resolving: 0,
		sourceDrawUnits: 0,
	};

	constructor(options: OpenWorldStreamingControllerOptions) {
		this.#options = options;
		this.#renderer = options.renderer;
	}

	updateSceneInterest(active: boolean): void {
		this.#assertUsable();
		this.#activeSceneInterest = active;
	}

	updateTerrainInterest(
		interest: OpenWorldStreamingTerrainInterest | null,
	): void {
		this.updateStaticInterest(
			interest
				? {
						anchorLandblockId: interest.anchorLandblockId,
						lod: {
							buildings: -1,
							envCells: -1,
							explicitObjects: -1,
							generatedScenery: -1,
							terrain: interest.radius,
						},
						revision: interest.revision,
					}
				: null,
		);
	}

	updateStaticInterest(
		interest: OpenWorldStreamingStaticInterest | null,
	): void {
		this.#assertUsable();
		this.#activeSceneInterest = interest !== null;
		const runId = ++this.#runSequence;
		if (!interest) {
			this.#terrainProgress = createEmptyTerrainProgress();
			this.#outdoorObjectProgress = createEmptyOutdoorObjectProgress();
			this.#envCellProgress = createEmptyEnvCellProgress();
			this.#activeStaticTasksByTaskId.clear();
			this.#envCellResourceMembershipByLandblock =
				createEnvCellResourceMembershipIndex([]);
			this.#renderer.setStaticRenderAnchorLandblockId(null);
			return;
		}

		this.#renderer.setStaticRenderAnchorLandblockId(interest.anchorLandblockId);
		void this.#runStaticInterest(runId, interest);
	}

	createRuntimeEntity(request: RuntimeDynamicSpawnRequest): DynamicEntityId {
		this.#assertUsable();
		return this.#requireRuntimeEntities().createRuntimeEntity(request);
	}

	destroyRuntimeEntity(entityId: DynamicEntityId): boolean {
		this.#assertUsable();
		return this.#requireRuntimeEntities().destroyRuntimeEntity(entityId);
	}

	updateRuntimeEntityRenderResidence(
		entityId: DynamicEntityId,
		renderResidence: DynamicEntityRenderResidence,
		frameTimeSeconds: number,
	): boolean {
		this.#assertUsable();
		return this.#requireRuntimeEntities().updateRuntimeEntityRenderResidence(
			entityId,
			renderResidence,
			frameTimeSeconds,
		);
	}

	tickFrame(timeSeconds: number): void {
		this.#assertUsable();
		this.#runtimeEntities?.tick(timeSeconds);
	}

	queryTerrainLandblockBounds(
		options: Parameters<StaticSceneQuery["queryTerrainLandblockBounds"]>[0],
	): ReturnType<StaticSceneQuery["queryTerrainLandblockBounds"]> {
		return this.#staticSceneQuery.queryTerrainLandblockBounds(options);
	}

	queryEnvCellBounds(options: {
		readonly envCellId: number;
		readonly landblockId: number;
	}): StaticSceneEnvCellBounds | null {
		return this.#staticSceneQuery.queryEnvCellBounds(options);
	}

	queryEnvCellResourceMembership(options: {
		readonly envCellId: number;
		readonly landblockId: number;
	}): EnvCellResourceMembership | null {
		return (
			this.#envCellResourceMembershipByLandblock
				.get(options.landblockId)
				?.get(options.envCellId) ?? null
		);
	}

	pickSceneRay(request: ScenePickRequest): ScenePickHit | null {
		const staticHit = this.#staticSceneQuery.pickRay({
			context: request.context,
			filters: request.filters,
			ray: request.ray,
		});
		if (!staticHit) {
			return null;
		}
		return {
			bounds: staticHit.bounds,
			distance: staticHit.distance,
			hitPoint: staticHit.hitPoint,
			kind: "scene-pick-hit",
			source: "static",
			staticHit,
		};
	}

	createSnapshot(): OpenWorldStreamingControllerSnapshot {
		return {
			dynamic:
				this.#runtimeEntities?.createSnapshot() ??
				createEmptyDynamicRuntimeSnapshot(),
			envCells: this.#envCellProgress,
			outdoorObjects: this.#outdoorObjectProgress,
			staticSceneQuery: this.#staticSceneQuery.createSnapshot(),
			staticSceneQueryOverview: this.#staticSceneQuery.createOverviewSnapshot(),
			terrain: this.#terrainProgress,
		};
	}

	createDiagnosticsSnapshot(): OpenWorldStreamingDiagnosticsSnapshot {
		const ownerSnapshot = this.#owners.createSnapshot();
		const textureSnapshot = this.#textureClaims.createSnapshot();
		const dynamicSnapshot =
			this.#runtimeEntities?.createSnapshot() ??
			createEmptyDynamicRuntimeSnapshot();
		const runtimeEntityDiagnostics =
			this.#runtimeEntities?.createDiagnosticsSnapshot() ??
			createEmptyRuntimeEntityDiagnosticsSnapshot();
		return {
			artifacts: {
				inFlight:
					this.#terrainProgress.resolving +
					this.#terrainProgress.baking +
					this.#outdoorObjectProgress.resolving +
					this.#outdoorObjectProgress.baking +
					this.#envCellProgress.resolving +
					this.#envCellProgress.baking,
				ready:
					this.#terrainProgress.committed +
					this.#outdoorObjectProgress.committed +
					this.#envCellProgress.committed,
				staleRejected: 0,
			},
			compatibilityShims: [],
			frameBudget: {
				yieldedPasses: this.#frameBudgetYieldedPasses,
			},
			kind: "open-world-streaming-diagnostics",
			owners: {
				current: ownerSnapshot.current.length,
				evicted: ownerSnapshot.evictedCount,
			},
			pipeline: {
				selectedRuntimePipeline: "open-world-streaming",
				staticPublicationMode: this.#staticPublicationMode(),
				status: this.#disposed
					? "disposed"
					: this.#activeSceneInterest
						? "active"
						: "idle",
			},
			sceneCommits: {
				applied:
					this.#terrainProgress.committed +
					this.#outdoorObjectProgress.committed +
					this.#envCellProgress.committed,
				pending: Math.max(
					0,
					this.#terrainProgress.requested -
						this.#terrainProgress.committed -
						this.#terrainProgress.failed +
						this.#outdoorObjectProgress.requested -
						this.#outdoorObjectProgress.committed -
						this.#outdoorObjectProgress.failed +
						this.#envCellProgress.requested -
						this.#envCellProgress.committed -
						this.#envCellProgress.failed,
				),
			},
			sourceResolution: this.#sourceResolutionCache.createDiagnosticsSnapshot(),
			textureResidency: {
				byteEstimate: {
					approximateBytes: null,
					reason: "page-size-not-yet-canonical",
				},
				bucketCount: textureSnapshot.bucketCount,
				claimCount: textureSnapshot.claimCount,
				entryCount: textureSnapshot.entryCount,
				pages: {
					...textureSnapshot.pageCountByState,
					total: textureSnapshot.pageCount,
				},
				pageBuildsInFlight: textureSnapshot.pageBuildsInFlight,
			},
			runtimeEntities: {
				active: dynamicSnapshot.activeEntityCount,
				animation: runtimeEntityDiagnostics.animation,
				commits: runtimeEntityDiagnostics.commits,
				nonRenderable: dynamicSnapshot.nonRenderableEntityCount,
				prep: runtimeEntityDiagnostics.prep,
				runtimeAuthored: dynamicSnapshot.runtimeSpawnCount,
				staticAuthored: dynamicSnapshot.staticAuthoredCount,
			},
			staticTasks: createStaticTaskDiagnostics({
				active: [...this.#activeStaticTasksByTaskId.values()],
				nowMs: nowMs(),
				recent: this.#recentStaticTaskTimings,
				requested:
					this.#terrainProgress.requested +
					this.#outdoorObjectProgress.requested +
					this.#envCellProgress.requested,
			}),
		};
	}

	createAtlasInspectionSnapshot(input: {
		readonly bucketKey: string;
		readonly pageId: string;
	}): OpenWorldStreamingAtlasInspectionSnapshot {
		return {
			bucketKey: input.bucketKey,
			claims: [],
			kind: "open-world-streaming-atlas-page",
			pageId: input.pageId,
			state: "missing",
		};
	}

	dispose(): void {
		this.#disposed = true;
		this.#objectVisualAtlasBuilder?.dispose?.();
		this.#texturePacker?.dispose?.();
	}

	async #runStaticInterest(
		runId: number,
		interest: OpenWorldStreamingStaticInterest,
	): Promise<void> {
		this.#frameBudgetYieldedPasses = 0;
		const staticDemandPlan = createStaticDemandPlan(interest);
		this.#sourceResolutionCache.reset(staticDemandPlan.sourceRequests);
		const tasks = staticDemandPlan.layerTasks.filter(
			(task) =>
				task.domain === "outdoor-terrain" ||
				isOutdoorObjectTask(task) ||
				isEnvCellTask(task),
		);
		const terrainTasks = tasks.filter(
			(task) => task.domain === "outdoor-terrain",
		);
		const outdoorObjectTasks = tasks.filter(isOutdoorObjectTask);
		const envCellTasks = tasks.filter(isEnvCellTask);
		this.#terrainProgress = {
			...createEmptyTerrainProgress(),
			requested: terrainTasks.length,
		};
		this.#outdoorObjectProgress = {
			...createEmptyOutdoorObjectProgress(),
			requested: outdoorObjectTasks.length,
		};
		this.#envCellProgress = {
			...createEmptyEnvCellProgress(),
			requested: envCellTasks.length,
		};
		this.#clearDeferredDenseRendererLayers();
		const targetOwnerIds = new Set<MaterializationOwnerId>();
		const requests = tasks.map((task) => {
			const owner = createStaticLayerMaterializationOwner({
				landblockId: task.scope.landblockId,
				layerKind: toStaticLayerOwnerKind(task),
			});
			targetOwnerIds.add(owner.id);
			return {
				owner,
				task,
				token: this.#owners.retain(owner),
			};
		});
		for (const owner of this.#owners.createSnapshot().current) {
			if (owner.kind === "static-layer" && !targetOwnerIds.has(owner.id)) {
				this.#runtimeEntities?.removeStaticAuthoredChildrenForParent(owner.id);
				this.#owners.evict(owner.id);
			}
		}

		let nextRequestIndex = 0;
		const workerCount = Math.min(
			STATIC_MATERIALIZATION_CONCURRENCY,
			requests.length,
		);
		await Promise.all(
			Array.from({ length: workerCount }, async () => {
				while (this.#isCurrentRun(runId)) {
					const request = requests[nextRequestIndex];
					nextRequestIndex += 1;
					if (!request) {
						return;
					}
					await this.#runStaticLayerRequest(runId, interest, request);
				}
			}),
		);
	}

	async #runStaticLayerRequest(
		runId: number,
		interest: OpenWorldStreamingStaticInterest,
		request: StaticLayerRunRequest,
	): Promise<void> {
		if (!this.#isCurrentRun(runId)) {
			return;
		}
		const startedAtMs = nowMs();
		this.#activeStaticTasksByTaskId.set(request.task.taskId, {
			domain: request.task.domain,
			ownerId: request.owner.id,
			phase: "materializing",
			startedAtMs,
			taskId: request.task.taskId,
		});
		this.#terrainProgress = {
			...this.#terrainProgress,
			resolving:
				request.task.domain === "outdoor-terrain"
					? this.#terrainProgress.resolving + 1
					: this.#terrainProgress.resolving,
		};
		this.#outdoorObjectProgress = {
			...this.#outdoorObjectProgress,
			resolving: isOutdoorObjectTask(request.task)
				? this.#outdoorObjectProgress.resolving + 1
				: this.#outdoorObjectProgress.resolving,
		};
		this.#envCellProgress = {
			...this.#envCellProgress,
			resolving: isEnvCellTask(request.task)
				? this.#envCellProgress.resolving + 1
				: this.#envCellProgress.resolving,
		};
		try {
			const commit =
				request.task.domain === "outdoor-terrain"
					? await this.#requireTerrainRunner().run({
							ownerId: request.owner.id,
							task: request.task,
						})
					: isOutdoorObjectTask(request.task)
						? await this.#requireOutdoorObjectRunner().run({
								ownerId: request.owner.id,
								task: request.task,
							})
						: isEnvCellTask(request.task)
							? await this.#requireEnvCellRunner().run({
									ownerId: request.owner.id,
									task: request.task,
								})
							: null;
			if (
				!this.#isCurrentRun(runId) ||
				!this.#owners.isCurrent({
					ownerId: request.owner.id,
					token: request.token,
				})
			) {
				this.#recordStaticTaskTiming({
					applyMs: 0,
					drawUnits: 0,
					durationMs: nowMs() - startedAtMs,
					error: null,
					request,
					stages: getStaticCommitStageTimings(commit),
					status: "stale-rejected",
				});
				return;
			}
			if (commit?.kind === "terrain-layer-commit") {
				this.#recordApplyTiming({
					apply: () =>
						this.#applyTerrainCommit(commit, interest.anchorLandblockId),
					drawUnits: commit.payload.drawUnits.length,
					request,
					stages: getStaticCommitStageTimings(commit),
					startedAtMs,
				});
			} else if (commit?.kind === "outdoor-object-layer-commit") {
				this.#recordApplyTiming({
					apply: () => this.#applyOutdoorObjectCommit(commit),
					drawUnits: commit.payload.drawUnits.length,
					request,
					stages: getStaticCommitStageTimings(commit),
					startedAtMs,
				});
			} else if (commit?.kind === "env-cell-system-layer-commit") {
				this.#recordApplyTiming({
					apply: () => this.#applyEnvCellCommit(commit),
					drawUnits:
						commit.payload.structuredInteriorDrawUnits.length +
						commit.payload.envCellStaticObjectDrawUnits.length,
					request,
					stages: getStaticCommitStageTimings(commit),
					startedAtMs,
				});
			}
		} catch (error) {
			if (!this.#isCurrentRun(runId)) {
				return;
			}
			this.#recordStaticTaskTiming({
				applyMs: 0,
				drawUnits: 0,
				durationMs: nowMs() - startedAtMs,
				error: stringifyError(error),
				request,
				stages: [],
				status: "failed",
			});
			console.warn("[holtburger-3d][open-world-static]", error);
			if (request.task.domain === "outdoor-terrain") {
				this.#terrainProgress = {
					...this.#terrainProgress,
					failed: this.#terrainProgress.failed + 1,
				};
			} else if (isOutdoorObjectTask(request.task)) {
				this.#outdoorObjectProgress = {
					...this.#outdoorObjectProgress,
					failed: this.#outdoorObjectProgress.failed + 1,
				};
			} else if (isEnvCellTask(request.task)) {
				this.#envCellProgress = {
					...this.#envCellProgress,
					failed: this.#envCellProgress.failed + 1,
				};
			}
		} finally {
			if (this.#isCurrentRun(runId)) {
				this.#activeStaticTasksByTaskId.delete(request.task.taskId);
				this.#terrainProgress = {
					...this.#terrainProgress,
					baking: 0,
					resolving:
						request.task.domain === "outdoor-terrain"
							? Math.max(0, this.#terrainProgress.resolving - 1)
							: this.#terrainProgress.resolving,
				};
				this.#outdoorObjectProgress = {
					...this.#outdoorObjectProgress,
					baking: 0,
					resolving: isOutdoorObjectTask(request.task)
						? Math.max(0, this.#outdoorObjectProgress.resolving - 1)
						: this.#outdoorObjectProgress.resolving,
				};
				this.#envCellProgress = {
					...this.#envCellProgress,
					baking: 0,
					resolving: isEnvCellTask(request.task)
						? Math.max(0, this.#envCellProgress.resolving - 1)
						: this.#envCellProgress.resolving,
				};
			}
		}
	}

	#recordApplyTiming(options: {
		readonly apply: () => void;
		readonly drawUnits: number;
		readonly request: {
			readonly owner: { readonly id: MaterializationOwnerId };
			readonly task: StaticLayerTaskRequest;
		};
		readonly stages: readonly OpenWorldStreamingStaticTaskStageTiming[];
		readonly startedAtMs: number;
	}): void {
		const applyStartedAtMs = nowMs();
		this.#activeStaticTasksByTaskId.set(options.request.task.taskId, {
			domain: options.request.task.domain,
			ownerId: options.request.owner.id,
			phase: "applying",
			startedAtMs: applyStartedAtMs,
			taskId: options.request.task.taskId,
		});
		options.apply();
		this.#publishDeferredDenseRendererLayersIfStaticReady();
		const completedAtMs = nowMs();
		this.#recordStaticTaskTiming({
			applyMs: completedAtMs - applyStartedAtMs,
			drawUnits: options.drawUnits,
			durationMs: completedAtMs - options.startedAtMs,
			error: null,
			request: options.request,
			stages: options.stages,
			status: "committed",
		});
	}

	#recordStaticTaskTiming(input: {
		readonly applyMs: number;
		readonly drawUnits: number;
		readonly durationMs: number;
		readonly error: string | null;
		readonly request: {
			readonly owner: { readonly id: MaterializationOwnerId };
			readonly task: StaticLayerTaskRequest;
		};
		readonly stages: readonly OpenWorldStreamingStaticTaskStageTiming[];
		readonly status: StaticTaskTiming["status"];
	}): void {
		this.#recentStaticTaskTimings = [
			...this.#recentStaticTaskTimings,
			{
				applyMs: input.applyMs,
				domain: input.request.task.domain,
				drawUnits: input.drawUnits,
				durationMs: input.durationMs,
				error: input.error,
				ownerId: input.request.owner.id,
				stages: input.stages,
				status: input.status,
				taskId: input.request.task.taskId,
			},
		].slice(-80);
	}

	#applyEnvCellCommit(commit: OpenWorldEnvCellSystemLayerCommit): void {
		for (const textureCommit of commit.textureCommits) {
			applyOpenWorldStreamingTextureCommit(this.#renderer, textureCommit, {
				revision:
					this.#terrainProgress.committed +
					this.#outdoorObjectProgress.committed +
					this.#envCellProgress.committed +
					1,
			});
		}
		this.#staticSceneQuery.setEnvCellSystemLayer(commit.payload);
		this.#envCellResourceMembershipByLandblock =
			createEnvCellResourceMembershipIndex([
				...queryEnvCellResourceMembershipExceptLandblock(
					this.#envCellResourceMembershipByLandblock,
					commit.payload.landblockId,
				),
				...createEnvCellResourceMembershipSnapshot([
					...commit.payload.structuredInteriorDrawUnits,
					...commit.payload.envCellStaticObjectDrawUnits,
				]),
			]);
		this.#publishOrDeferEnvCellRendererLayer(commit.payload);
		this.#requireRuntimeEntities().ingestStaticAuthoredPlacements({
			parentOwnerId: commit.ownerId,
			placements: commit.staticAuthoredDynamicPlacements,
		});
		const drawUnitCount =
			commit.payload.structuredInteriorDrawUnits.length +
			commit.payload.envCellStaticObjectDrawUnits.length;
		this.#envCellProgress = {
			...this.#envCellProgress,
			committed: this.#envCellProgress.committed + 1,
			installedDrawUnits:
				this.#envCellProgress.installedDrawUnits + drawUnitCount,
			latestEnvCellSystemPayload: createEnvCellPayloadSummary(
				commit.sourcePayload,
			),
			sourceDrawUnits: this.#envCellProgress.sourceDrawUnits + drawUnitCount,
		};
	}

	#applyOutdoorObjectCommit(commit: OpenWorldOutdoorObjectLayerCommit): void {
		for (const textureCommit of commit.textureCommits) {
			applyOpenWorldStreamingTextureCommit(this.#renderer, textureCommit, {
				revision:
					this.#terrainProgress.committed +
					this.#outdoorObjectProgress.committed +
					this.#envCellProgress.committed +
					1,
			});
		}
		this.#staticSceneQuery.applyStaticPeerRecords({
			sourceMappings: commit.payload.sourceMappingRecords,
			spatialRecords: commit.payload.spatialRecords,
		});
		switch (commit.payload.kind) {
			case "outdoor-buildings":
				this.#publishOrDeferOutdoorBuildingsRendererLayer(commit.payload);
				break;
			case "outdoor-explicit-objects":
				this.#publishOrDeferOutdoorExplicitObjectsRendererLayer(commit.payload);
				break;
			case "outdoor-generated-scenery":
				this.#publishOrDeferOutdoorGeneratedSceneryRendererLayer(
					commit.payload,
				);
				break;
		}
		this.#requireRuntimeEntities().ingestStaticAuthoredPlacements({
			parentOwnerId: commit.ownerId,
			placements: commit.staticAuthoredDynamicPlacements,
		});
		this.#outdoorObjectProgress = {
			...this.#outdoorObjectProgress,
			committed: this.#outdoorObjectProgress.committed + 1,
			installedDrawUnits:
				this.#outdoorObjectProgress.installedDrawUnits +
				commit.payload.drawUnits.length,
			latestOutdoorObjectPayload: createOutdoorObjectPayloadSummary(
				commit.sourcePayload,
			),
			sourceDrawUnits:
				this.#outdoorObjectProgress.sourceDrawUnits +
				commit.payload.drawUnits.length,
		};
	}

	#applyTerrainCommit(
		commit: OpenWorldTerrainLayerCommit,
		anchorLandblockId: number,
	): void {
		if (commit.textureCommit) {
			applyOpenWorldStreamingTextureCommit(
				this.#renderer,
				commit.textureCommit,
				{
					revision: this.#terrainProgress.committed + 1,
				},
			);
		}
		this.#staticSceneQuery.ingestTerrain(
			commit.sourcePayload,
			anchorLandblockId,
		);
		this.#staticSceneQuery.applyStaticPeerRecords({
			sourceMappings: commit.payload.sourceMappingRecords,
			spatialRecords: commit.payload.spatialRecords,
		});
		this.#renderer.setTerrainLayer(commit.payload.landblockId, commit.payload);
		this.#terrainProgress = {
			...this.#terrainProgress,
			committed: this.#terrainProgress.committed + 1,
			installedDrawUnits:
				this.#terrainProgress.installedDrawUnits +
				commit.payload.drawUnits.length,
			latestTerrainPayload: createTerrainPayloadSummary(commit.sourcePayload),
			sourceDrawUnits:
				this.#terrainProgress.sourceDrawUnits + commit.payload.drawUnits.length,
		};
	}

	#publishOrDeferEnvCellRendererLayer(
		payload: OpenWorldEnvCellSystemLayerCommit["payload"],
	): void {
		if (this.#staticPublicationMode() === "suppress-dense-renderer") {
			return;
		}
		if (this.#shouldDeferDenseRendererPublication()) {
			this.#deferredEnvCellRendererLayers.set(payload.landblockId, payload);
			return;
		}
		this.#renderer.setEnvCellSystemLayer(payload.landblockId, payload);
	}

	#publishOrDeferOutdoorBuildingsRendererLayer(
		payload: Extract<
			OpenWorldOutdoorObjectLayerCommit["payload"],
			{ readonly kind: "outdoor-buildings" }
		>,
	): void {
		if (this.#staticPublicationMode() === "suppress-dense-renderer") {
			return;
		}
		if (this.#shouldDeferDenseRendererPublication()) {
			this.#deferredOutdoorRendererLayers.buildings.set(
				payload.landblockId,
				payload,
			);
			return;
		}
		this.#renderer.setOutdoorBuildingsLayer(payload.landblockId, payload);
	}

	#publishOrDeferOutdoorExplicitObjectsRendererLayer(
		payload: Extract<
			OpenWorldOutdoorObjectLayerCommit["payload"],
			{ readonly kind: "outdoor-explicit-objects" }
		>,
	): void {
		if (this.#staticPublicationMode() === "suppress-dense-renderer") {
			return;
		}
		if (this.#shouldDeferDenseRendererPublication()) {
			this.#deferredOutdoorRendererLayers.explicitObjects.set(
				payload.landblockId,
				payload,
			);
			return;
		}
		this.#renderer.setOutdoorExplicitObjectsLayer(payload.landblockId, payload);
	}

	#publishOrDeferOutdoorGeneratedSceneryRendererLayer(
		payload: Extract<
			OpenWorldOutdoorObjectLayerCommit["payload"],
			{ readonly kind: "outdoor-generated-scenery" }
		>,
	): void {
		if (this.#staticPublicationMode() === "suppress-dense-renderer") {
			return;
		}
		if (this.#shouldDeferDenseRendererPublication()) {
			this.#deferredOutdoorRendererLayers.generatedScenery.set(
				payload.landblockId,
				payload,
			);
			return;
		}
		this.#renderer.setOutdoorGeneratedSceneryLayer(
			payload.landblockId,
			payload,
		);
	}

	#publishDeferredDenseRendererLayersIfStaticReady(): void {
		if (
			this.#staticPublicationMode() !== "defer-dense-renderer-until-ready" ||
			!this.#allRequestedStaticTasksSettled()
		) {
			return;
		}
		for (const [landblockId, payload] of this.#deferredOutdoorRendererLayers
			.buildings) {
			this.#renderer.setOutdoorBuildingsLayer(landblockId, payload);
		}
		for (const [landblockId, payload] of this.#deferredOutdoorRendererLayers
			.explicitObjects) {
			this.#renderer.setOutdoorExplicitObjectsLayer(landblockId, payload);
		}
		for (const [landblockId, payload] of this.#deferredOutdoorRendererLayers
			.generatedScenery) {
			this.#renderer.setOutdoorGeneratedSceneryLayer(landblockId, payload);
		}
		for (const [landblockId, payload] of this.#deferredEnvCellRendererLayers) {
			this.#renderer.setEnvCellSystemLayer(landblockId, payload);
		}
		this.#clearDeferredDenseRendererLayers();
	}

	#shouldDeferDenseRendererPublication(): boolean {
		return (
			this.#staticPublicationMode() === "defer-dense-renderer-until-ready" &&
			!this.#allRequestedStaticTasksSettled()
		);
	}

	#allRequestedStaticTasksSettled(): boolean {
		const requested =
			this.#terrainProgress.requested +
			this.#outdoorObjectProgress.requested +
			this.#envCellProgress.requested;
		if (requested === 0) {
			return false;
		}
		const settled =
			this.#terrainProgress.committed +
			this.#terrainProgress.failed +
			this.#outdoorObjectProgress.committed +
			this.#outdoorObjectProgress.failed +
			this.#envCellProgress.committed +
			this.#envCellProgress.failed;
		return settled >= requested;
	}

	#clearDeferredDenseRendererLayers(): void {
		this.#deferredOutdoorRendererLayers.buildings.clear();
		this.#deferredOutdoorRendererLayers.explicitObjects.clear();
		this.#deferredOutdoorRendererLayers.generatedScenery.clear();
		this.#deferredEnvCellRendererLayers.clear();
	}

	#staticPublicationMode(): OpenWorldStreamingStaticPublicationMode {
		return (
			this.#options.staticPublicationMode ?? DEFAULT_STATIC_PUBLICATION_MODE
		);
	}

	#isCurrentRun(runId: number): boolean {
		return !this.#disposed && this.#runSequence === runId;
	}

	#requireTerrainRunner(): OpenWorldTerrainArtifactRunner {
		if (!this.#terrainRunner) {
			this.#terrainRunner = new OpenWorldTerrainArtifactRunner({
				assetReader: this.#options.assetReader,
				baker: this.#options.createStaticBaker(),
				frameBudget: {
					yieldToFrameBudget: () => this.#yieldToFrameBudget(),
				},
				resolver: this.#sourceResolutionCache,
				textureClaims: this.#textureClaims,
			});
		}
		return this.#terrainRunner;
	}

	#requireOutdoorObjectRunner(): OpenWorldOutdoorObjectArtifactRunner {
		if (!this.#outdoorObjectRunner) {
			this.#outdoorObjectRunner = new OpenWorldOutdoorObjectArtifactRunner({
				assetReader: this.#options.assetReader,
				baker: this.#options.createStaticBaker(),
				frameBudget: {
					yieldToFrameBudget: () => this.#yieldToFrameBudget(),
				},
				objectVisualAtlasBuilder: this.#requireObjectVisualAtlasBuilder(),
				resolver: this.#sourceResolutionCache,
				textureClaims: this.#textureClaims,
			});
		}
		return this.#outdoorObjectRunner;
	}

	#requireEnvCellRunner(): OpenWorldEnvCellArtifactRunner {
		if (!this.#envCellRunner) {
			this.#envCellRunner = new OpenWorldEnvCellArtifactRunner({
				assetReader: this.#options.assetReader,
				baker: this.#options.createStaticBaker(),
				frameBudget: {
					yieldToFrameBudget: () => this.#yieldToFrameBudget(),
				},
				objectVisualAtlasBuilder: this.#requireObjectVisualAtlasBuilder(),
				resolver: this.#sourceResolutionCache,
				textureClaims: this.#textureClaims,
			});
		}
		return this.#envCellRunner;
	}

	async #yieldToFrameBudget(): Promise<void> {
		this.#frameBudgetYieldedPasses += 1;
		await new Promise<void>((resolve) => {
			globalThis.setTimeout(resolve, 0);
		});
	}

	#requireRuntimeEntities(): OpenWorldRuntimeEntitySystem {
		if (!this.#runtimeEntities) {
			this.#runtimeEntities = new OpenWorldRuntimeEntitySystem({
				assetReader: this.#options.assetReader,
				createDynamicVisualBaker: this.#options.createDynamicVisualBaker,
				createDynamicVisualRecipeResolver:
					this.#options.createDynamicVisualRecipeResolver,
				objectVisualAtlasBuilder: this.#requireObjectVisualAtlasBuilder(),
				owners: this.#owners,
				renderer: this.#renderer,
				textureClaims: this.#textureClaims,
			});
		}
		return this.#runtimeEntities;
	}

	#requireObjectVisualAtlasBuilder(): OpenWorldObjectVisualAtlasBuilder {
		if (!this.#objectVisualAtlasBuilder) {
			this.#objectVisualAtlasBuilder =
				this.#options.createObjectVisualAtlasBuilder?.() ??
				new DirectOpenWorldObjectVisualAtlasBuilder({
					assetReader: this.#options.assetReader,
					texturePacker: this.#requireTexturePacker(),
				});
		}
		return this.#objectVisualAtlasBuilder;
	}

	#requireTexturePacker(): TexturePacker {
		if (!this.#texturePacker) {
			this.#texturePacker = this.#options.createTexturePacker();
		}
		return this.#texturePacker;
	}

	#requireStaticSourceResolver(): StaticLandblockSceneLodSourceResolver {
		if (!this.#staticSourceResolver) {
			this.#staticSourceResolver = this.#options.createStaticResolver();
		}
		return this.#staticSourceResolver;
	}

	#assertUsable(): void {
		if (this.#disposed) {
			throw new Error("Open world streaming controller has been disposed.");
		}
	}
}

function createStaticDemandPlan(
	interest: OpenWorldStreamingStaticInterest,
): StaticDemandPlan {
	return planStaticDemand(
		{
			location: {
				kind: "outdoor-landblock",
				landblockId: interest.anchorLandblockId,
			},
			lod: {
				buildings: interest.lod.buildings,
				envCells: interest.lod.envCells,
				explicitObjects: interest.lod.explicitObjects,
				generatedScenery: interest.lod.generatedScenery,
				terrain: interest.lod.terrain,
			},
		},
		interest.revision,
	);
}

class OpenWorldStaticSourceResolutionCache implements StaticLandblockSceneLodSourceResolver {
	readonly #resolveSource: (
		request: StaticLandblockSceneLodSourceRequest,
	) => Promise<StaticLandblockSceneLodResolution>;
	readonly #resolveProjectedSources: (
		request: StaticLandblockSceneLodSourceRequest,
		onProjection: (event: StaticLandblockSceneLodSourceProjectionEvent) => void,
	) => Promise<void> | null;
	readonly #inFlightByKey = new Map<
		string,
		Promise<StaticLandblockSceneLodResolution>
	>();
	readonly #completedProjectedByKey = new Map<
		string,
		StaticLandblockSceneLodResolution
	>();
	readonly #projectedWaitersByKey = new Map<
		string,
		Array<{
			readonly reject: (error: Error) => void;
			readonly resolve: (resolution: StaticLandblockSceneLodResolution) => void;
		}>
	>();
	readonly #streamsByKey = new Map<string, Promise<void>>();
	#plannedRequests: readonly StaticLandblockSceneLodSourceRequest[] = [];
	#directRequests = 0;
	#sourceStreamRequests = 0;
	#projectedResults = 0;
	#reusedRequests = 0;
	#projectedRecipeCount = 0;
	#projectedDynamicPlacementCount = 0;
	#projectedDynamicRecipeCount = 0;
	#projectedMs = 0;
	#maxProjectedMs = 0;
	#projectedDeliveryMs = 0;
	#maxProjectedDeliveryMs = 0;
	#projectedAssimilationMs = 0;
	#maxProjectedAssimilationMs = 0;
	#projectedWaiterReleaseCount = 0;
	#maxProjectedWaitersReleased = 0;

	constructor(options: {
		readonly resolveProjectedSources: (
			request: StaticLandblockSceneLodSourceRequest,
			onProjection: (
				event: StaticLandblockSceneLodSourceProjectionEvent,
			) => void,
		) => Promise<void> | null;
		readonly resolveSource: (
			request: StaticLandblockSceneLodSourceRequest,
		) => Promise<StaticLandblockSceneLodResolution>;
	}) {
		this.#resolveProjectedSources = options.resolveProjectedSources;
		this.#resolveSource = options.resolveSource;
	}

	reset(
		plannedRequests: readonly StaticLandblockSceneLodSourceRequest[],
	): void {
		const staleError = new Error("Projected source request was superseded.");
		for (const waiters of this.#projectedWaitersByKey.values()) {
			for (const waiter of waiters) {
				waiter.reject(staleError);
			}
		}
		this.#completedProjectedByKey.clear();
		this.#inFlightByKey.clear();
		this.#plannedRequests = plannedRequests;
		this.#projectedWaitersByKey.clear();
		this.#streamsByKey.clear();
		this.#directRequests = 0;
		this.#sourceStreamRequests = 0;
		this.#projectedResults = 0;
		this.#reusedRequests = 0;
		this.#projectedRecipeCount = 0;
		this.#projectedDynamicPlacementCount = 0;
		this.#projectedDynamicRecipeCount = 0;
		this.#projectedMs = 0;
		this.#maxProjectedMs = 0;
		this.#projectedDeliveryMs = 0;
		this.#maxProjectedDeliveryMs = 0;
		this.#projectedAssimilationMs = 0;
		this.#maxProjectedAssimilationMs = 0;
		this.#projectedWaiterReleaseCount = 0;
		this.#maxProjectedWaitersReleased = 0;
	}

	createDiagnosticsSnapshot(): OpenWorldStreamingDiagnosticsSnapshot["sourceResolution"] {
		return {
			directRequests: this.#directRequests,
			maxProjectedAssimilationMs: this.#maxProjectedAssimilationMs,
			maxProjectedDeliveryMs: this.#maxProjectedDeliveryMs,
			maxProjectedMs: this.#maxProjectedMs,
			maxProjectedWaitersReleased: this.#maxProjectedWaitersReleased,
			projectedAssimilationMs: this.#projectedAssimilationMs,
			projectedDeliveryMs: this.#projectedDeliveryMs,
			projectedDynamicPlacementCount: this.#projectedDynamicPlacementCount,
			projectedDynamicRecipeCount: this.#projectedDynamicRecipeCount,
			projectedMs: this.#projectedMs,
			projectedRecipeCount: this.#projectedRecipeCount,
			projectedResults: this.#projectedResults,
			projectedWaiterReleaseCount: this.#projectedWaiterReleaseCount,
			reusedRequests: this.#reusedRequests,
			sourceStreamRequests: this.#sourceStreamRequests,
		};
	}

	resolveSource(
		request: StaticLandblockSceneLodSourceRequest,
	): Promise<StaticLandblockSceneLodResolution> {
		const requestKey = createStaticSourceRequestKey(request);
		const projected = this.#completedProjectedByKey.get(requestKey);
		if (projected) {
			this.#projectedResults += 1;
			this.#reusedRequests += 1;
			return Promise.resolve(projected);
		}
		const coalescedRequest = this.#findReusablePlannedRequest(request);
		if (coalescedRequest) {
			this.#projectedResults += 1;
			const streamKey = createStaticSourceRequestKey(coalescedRequest);
			if (this.#streamsByKey.has(streamKey)) {
				this.#reusedRequests += 1;
			} else if (
				!this.#startProjectedSourceStream(streamKey, coalescedRequest)
			) {
				this.#projectedResults -= 1;
				return this.#resolveDirectSource(request, requestKey);
			}
			return this.#waitForProjectedResolution(requestKey);
		}

		return this.#resolveDirectSource(request, requestKey);
	}

	#resolveDirectSource(
		request: StaticLandblockSceneLodSourceRequest,
		requestKey: string,
	): Promise<StaticLandblockSceneLodResolution> {
		const existing = this.#inFlightByKey.get(requestKey);
		if (existing) {
			this.#reusedRequests += 1;
			return existing;
		}
		this.#directRequests += 1;
		const pending = this.#resolveSource(request);
		this.#inFlightByKey.set(requestKey, pending);
		return pending;
	}

	#findReusablePlannedRequest(
		request: StaticLandblockSceneLodSourceRequest,
	): StaticLandblockSceneLodSourceRequest | null {
		const requestKey = createStaticSourceRequestKey(request);
		const candidate = this.#plannedRequests.find((plannedRequest) => {
			if (createStaticSourceRequestKey(plannedRequest) === requestKey) {
				return false;
			}
			return (
				plannedRequest.context === request.context &&
				plannedRequest.landblockId === request.landblockId &&
				plannedRequest.sourceLod >= request.sourceLod &&
				request.requestedLayers.every((requestedLayer) =>
					plannedRequest.requestedLayers.some((candidateLayer) =>
						containsStaticSourceLayer(candidateLayer, requestedLayer),
					),
				)
			);
		});
		return candidate ?? null;
	}

	#startProjectedSourceStream(
		streamKey: string,
		request: StaticLandblockSceneLodSourceRequest,
	): boolean {
		const expectedProjectionKeys = new Set(
			request.requestedLayers.map((layerRequest) =>
				createStaticSourceRequestKey({
					context: request.context,
					landblockId: request.landblockId,
					requestedLayers: [layerRequest],
					sourceLod: sourceLodForProjectedLayer(layerRequest.kind),
				}),
			),
		);
		const stream = this.#resolveProjectedSources(request, (event) => {
			const assimilationStartedAtMs = nowMs();
			if (event.diagnostics.completedAtEpochMs !== undefined) {
				const deliveryMs = Math.max(
					0,
					Date.now() - event.diagnostics.completedAtEpochMs,
				);
				this.#projectedDeliveryMs += deliveryMs;
				this.#maxProjectedDeliveryMs = Math.max(
					this.#maxProjectedDeliveryMs,
					deliveryMs,
				);
			}
			const projectionKey = createStaticSourceRequestKey(
				event.resolution.request,
			);
			expectedProjectionKeys.delete(projectionKey);
			this.#completedProjectedByKey.set(projectionKey, event.resolution);
			this.#projectedRecipeCount += event.diagnostics.recipeCount;
			this.#projectedDynamicPlacementCount +=
				event.diagnostics.dynamicPlacementCount;
			this.#projectedDynamicRecipeCount += event.diagnostics.dynamicRecipeCount;
			this.#projectedMs += event.diagnostics.projectionMs;
			this.#maxProjectedMs = Math.max(
				this.#maxProjectedMs,
				event.diagnostics.projectionMs,
			);
			const waiters = this.#projectedWaitersByKey.get(projectionKey);
			const waiterCount = waiters?.length ?? 0;
			this.#projectedWaiterReleaseCount += waiterCount;
			this.#maxProjectedWaitersReleased = Math.max(
				this.#maxProjectedWaitersReleased,
				waiterCount,
			);
			if (waiters) {
				this.#projectedWaitersByKey.delete(projectionKey);
				for (const waiter of waiters) {
					waiter.resolve(event.resolution);
				}
			}
			const assimilationMs = nowMs() - assimilationStartedAtMs;
			this.#projectedAssimilationMs += assimilationMs;
			this.#maxProjectedAssimilationMs = Math.max(
				this.#maxProjectedAssimilationMs,
				assimilationMs,
			);
		});
		if (!stream) {
			return false;
		}
		this.#sourceStreamRequests += 1;
		const pending = stream
			.then(() => {
				if (expectedProjectionKeys.size === 0) {
					return;
				}
				const missingError = new Error(
					"Projected source stream completed without producing every requested runner result.",
				);
				for (const projectionKey of expectedProjectionKeys) {
					const waiters = this.#projectedWaitersByKey.get(projectionKey);
					if (!waiters) {
						continue;
					}
					this.#projectedWaitersByKey.delete(projectionKey);
					for (const waiter of waiters) {
						waiter.reject(missingError);
					}
				}
			})
			.catch((error: unknown) => {
				const normalizedError =
					error instanceof Error ? error : new Error(String(error));
				for (const projectionKey of expectedProjectionKeys) {
					const waiters = this.#projectedWaitersByKey.get(projectionKey);
					if (!waiters) {
						continue;
					}
					this.#projectedWaitersByKey.delete(projectionKey);
					for (const waiter of waiters) {
						waiter.reject(normalizedError);
					}
				}
			})
			.finally(() => {
				this.#streamsByKey.delete(streamKey);
			});
		this.#streamsByKey.set(streamKey, pending);
		return true;
	}

	#waitForProjectedResolution(
		requestKey: string,
	): Promise<StaticLandblockSceneLodResolution> {
		const projected = this.#completedProjectedByKey.get(requestKey);
		if (projected) {
			return Promise.resolve(projected);
		}
		return new Promise((resolve, reject) => {
			const waiters = this.#projectedWaitersByKey.get(requestKey);
			if (waiters) {
				waiters.push({ reject, resolve });
			} else {
				this.#projectedWaitersByKey.set(requestKey, [{ reject, resolve }]);
			}
		});
	}
}

function sourceLodForProjectedLayer(
	layerKind: StaticLandblockSceneLodSourceRequest["requestedLayers"][number]["kind"],
): StaticLandblockSceneLodSourceRequest["sourceLod"] {
	if (layerKind === "terrain") {
		return 0;
	}
	if (layerKind === "outdoor-buildings") {
		return 1;
	}
	if (layerKind === "outdoor-explicit-objects") {
		return 2;
	}
	if (layerKind === "outdoor-generated-scenery") {
		return 3;
	}
	return 4;
}

function containsStaticSourceLayer(
	candidate: StaticLandblockSceneLodSourceRequest["requestedLayers"][number],
	requested: StaticLandblockSceneLodSourceRequest["requestedLayers"][number],
): boolean {
	return (
		candidate.kind === requested.kind &&
		candidate.targetOwnerKey.kind === requested.targetOwnerKey.kind &&
		candidate.targetOwnerKey.landblockId ===
			requested.targetOwnerKey.landblockId
	);
}

function createStaticSourceRequestKey(
	request: StaticLandblockSceneLodSourceRequest,
): string {
	return [
		request.context,
		String(request.landblockId),
		String(request.sourceLod),
		...request.requestedLayers.map(
			(layer) =>
				`${layer.kind}:${layer.targetOwnerKey.kind}:${layer.targetOwnerKey.landblockId}`,
		),
	].join("|");
}

function createEmptyTerrainProgress(): OpenWorldStreamingTerrainProgressSnapshot {
	return {
		baking: 0,
		committed: 0,
		failed: 0,
		installedDrawUnits: 0,
		latestTerrainPayload: null,
		requested: 0,
		resolving: 0,
		sourceDrawUnits: 0,
	};
}

function createEmptyOutdoorObjectProgress(): OpenWorldStreamingOutdoorObjectProgressSnapshot {
	return {
		baking: 0,
		committed: 0,
		failed: 0,
		installedDrawUnits: 0,
		latestOutdoorObjectPayload: null,
		requested: 0,
		resolving: 0,
		sourceDrawUnits: 0,
	};
}

function createEmptyEnvCellProgress(): OpenWorldStreamingEnvCellProgressSnapshot {
	return {
		baking: 0,
		committed: 0,
		failed: 0,
		installedDrawUnits: 0,
		latestEnvCellSystemPayload: null,
		requested: 0,
		resolving: 0,
		sourceDrawUnits: 0,
	};
}

function createEmptyDynamicRuntimeSnapshot(): DynamicRuntimeSnapshot {
	return {
		activeEntityCount: 0,
		nonRenderableEntityCount: 0,
		records: [],
		runtimeSpawnCount: 0,
		staticAuthoredCount: 0,
	};
}

function createTerrainPayloadSummary(
	payload: OpenWorldTerrainLayerCommit["sourcePayload"],
): TerrainStaticScopePayloadSummary {
	return {
		landblockId: payload.landblock.landblockId,
		missingRefCount: payload.missingRefs.length,
		quadCount: payload.mesh.quadCount,
		regionNumber: payload.terrainMaterial.identity.regionNumber,
		textureUseCount: payload.textureUses.length,
		triangleCount: payload.mesh.triangleCount,
		vertexCount: payload.mesh.vertexCount,
	};
}

function createOutdoorObjectPayloadSummary(
	payload: OpenWorldOutdoorObjectLayerCommit["sourcePayload"],
): OutdoorStaticObjectsPayloadSummary {
	return {
		domain: payload.domain,
		landblockId: payload.landblock.landblockId,
		materialSlotCount: payload.materialSlots.length,
		materialSourceCount: payload.materialSources.length,
		missingRefCount: payload.missingRefs.length,
		objectCount: payload.objects.length,
		objectKindCounts: {
			building: payload.objects.filter(
				(object) => object.identity.objectKind === "building",
			).length,
			"explicit-object": payload.objects.filter(
				(object) => object.identity.objectKind === "explicit-object",
			).length,
			"generated-scenery": payload.objects.filter(
				(object) => object.identity.objectKind === "generated-scenery",
			).length,
		},
		sourceAssetCount: payload.sourceAssets.length,
		textureRefCount: payload.textureRefs.length,
	};
}

function createEnvCellPayloadSummary(
	payload: OpenWorldEnvCellSystemLayerCommit["sourcePayload"],
): EnvCellSystemPayloadSummary {
	return {
		acceptedEnvCellCount: payload.acceptedEnvCellIds.length,
		envCellCount: payload.envCells.length,
		landblockId: payload.landblock.landblockId,
		missingRefCount: payload.missingRefs.length,
		portalCount: payload.envCells.reduce(
			(total, envCell) => total + envCell.portals.length,
			0,
		),
		portalLinkCount: payload.portalLinks.length,
		staticObjectPlacementCount: payload.envCells.reduce(
			(total, envCell) => total + envCell.staticObjectPlacements.length,
			0,
		),
		visibilityDiagnosticCount: payload.visibilityDiagnostics.length,
		visibleCellCount: payload.envCells.filter(
			(envCell) => envCell.visibleEnvCellIds.length > 0,
		).length,
	};
}

function createStaticTaskDiagnostics(input: {
	readonly active: readonly ActiveStaticTaskTiming[];
	readonly nowMs: number;
	readonly recent: readonly StaticTaskTiming[];
	readonly requested: number;
}): OpenWorldStreamingStaticTaskDiagnostics {
	const completed = input.recent.filter(
		(timing) => timing.status === "committed",
	);
	const failed = input.recent.filter((timing) => timing.status === "failed");
	return {
		active: input.active.map((active) => ({
			domain: active.domain,
			elapsedMs: input.nowMs - active.startedAtMs,
			ownerId: active.ownerId,
			phase: active.phase,
			taskId: active.taskId,
		})),
		recent: input.recent.map((timing) => ({
			applyMs: timing.applyMs,
			domain: timing.domain,
			drawUnits: timing.drawUnits,
			durationMs: timing.durationMs,
			error: timing.error,
			ownerId: timing.ownerId,
			stages: timing.stages,
			status: timing.status,
			taskId: timing.taskId,
		})),
		summary: {
			active: input.active.length,
			completed: completed.length,
			failed: failed.length,
			maxApplyMs: maxOrZero(input.recent.map((timing) => timing.applyMs)),
			maxDurationMs: maxOrZero(input.recent.map((timing) => timing.durationMs)),
			requested: input.requested,
			totalApplyMs: sum(input.recent.map((timing) => timing.applyMs)),
			totalDurationMs: sum(input.recent.map((timing) => timing.durationMs)),
		},
	};
}

function createEmptyRuntimeEntityDiagnosticsSnapshot(): OpenWorldRuntimeEntityDiagnosticsSnapshot {
	return {
		animation: {
			catchUpTruncationCount: 0,
			droppedHookFrameCount: 0,
			recentCatchUpTruncations: [],
		},
		commits: {
			dynamicInstanceCommitCount: 0,
			dynamicResourceCommitCount: 0,
			maxInstancesPerCommit: 0,
			maxResourcesPerCommit: 0,
		},
		prep: {
			bakeFailureCount: 0,
			bakeSuccessCount: 0,
			failed: 0,
			recipeResolvedCount: 0,
			recentFailures: [],
			skippedVisualCount: 0,
			started: 0,
		},
	};
}

function getStaticCommitStageTimings(
	commit:
		| OpenWorldTerrainLayerCommit
		| OpenWorldOutdoorObjectLayerCommit
		| OpenWorldEnvCellSystemLayerCommit
		| null,
): readonly OpenWorldStreamingStaticTaskStageTiming[] {
	if (
		commit?.kind === "terrain-layer-commit" ||
		commit?.kind === "outdoor-object-layer-commit" ||
		commit?.kind === "env-cell-system-layer-commit"
	) {
		return commit.stageTimings;
	}
	return [];
}

function queryEnvCellResourceMembershipExceptLandblock(
	index: ReadonlyMap<number, ReadonlyMap<number, EnvCellResourceMembership>>,
	landblockId: number,
): readonly EnvCellResourceMembership[] {
	return [...index.entries()].flatMap(
		([candidateLandblockId, membershipsByEnvCell]) =>
			candidateLandblockId === landblockId
				? []
				: [...membershipsByEnvCell.values()],
	);
}

function maxOrZero(values: readonly number[]): number {
	return values.length === 0 ? 0 : Math.max(...values);
}

function sum(values: readonly number[]): number {
	return values.reduce((total, value) => total + value, 0);
}

function nowMs(): number {
	return globalThis.performance?.now() ?? Date.now();
}

function stringifyError(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}

function isOutdoorObjectTask(task: StaticLayerTaskRequest): boolean {
	return (
		task.domain === "outdoor-buildings" ||
		task.domain === "outdoor-explicit-objects" ||
		task.domain === "outdoor-generated-scenery"
	);
}

function isEnvCellTask(task: StaticLayerTaskRequest): boolean {
	return task.domain === "env-cell-system";
}

function toStaticLayerOwnerKind(
	task: StaticLayerTaskRequest,
): Parameters<typeof createStaticLayerMaterializationOwner>[0]["layerKind"] {
	switch (task.domain) {
		case "outdoor-terrain":
			return "terrain";
		case "outdoor-buildings":
			return "outdoor-buildings";
		case "outdoor-explicit-objects":
			return "outdoor-explicit-objects";
		case "outdoor-generated-scenery":
			return "outdoor-generated-scenery";
		case "env-cell-system":
			return "env-cell-system";
	}
}
