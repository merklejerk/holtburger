import type {
	OpenWorldStreamingAtlasInspectionSnapshot,
	OpenWorldStreamingDiagnosticsSnapshot,
} from "../diagnostics/contracts";
import type { Renderer } from "../../../renderer/types";
import { StaticSceneQuery } from "../../../runtime/static-scene-query";
import { planStaticDemand } from "../../../static/demand-planner";
import type {
	StaticBaker,
	StaticLandblockSceneLodSourceResolver,
	StaticLayerTaskRequest,
	TerrainStaticScopePayloadSummary,
} from "../../../static/contracts";
import { MaterializationOwnerRegistry } from "../owners/owner-registry";
import {
	createStaticLayerMaterializationOwner,
	type MaterializationOwnerId,
} from "../owners/owner-id";
import { OpenWorldTextureClaimRegistry } from "../texture-residency/claims/texture-claim-registry";
import {
	OpenWorldTerrainArtifactRunner,
	type OpenWorldTerrainLayerCommit,
} from "../static-layers/terrain/terrain-artifact-runner";
import type { PreparedAssetReader } from "../../../assets/contracts";
import { applyOpenWorldStreamingTextureCommit } from "../texture-residency/commits/texture-commit-applier";

export interface OpenWorldStreamingControllerOptions {
	readonly assetReader: PreparedAssetReader;
	readonly renderer: Pick<
		Renderer,
		| "applyTexturePlacementUpdate"
		| "setStaticRenderAnchorLandblockId"
		| "setTerrainLayer"
	>;
	readonly createStaticBaker: () => StaticBaker;
	readonly createStaticResolver: () => StaticLandblockSceneLodSourceResolver;
}

export interface OpenWorldStreamingTerrainInterest {
	readonly anchorLandblockId: number;
	readonly radius: number;
	readonly revision: number;
}

export interface OpenWorldStreamingControllerSnapshot {
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

export class OpenWorldStreamingController {
	readonly #owners = new MaterializationOwnerRegistry();
	readonly #options: OpenWorldStreamingControllerOptions;
	readonly #renderer: OpenWorldStreamingControllerOptions["renderer"];
	readonly #staticSceneQuery = new StaticSceneQuery();
	#terrainRunner: OpenWorldTerrainArtifactRunner | null = null;
	readonly #textureClaims = new OpenWorldTextureClaimRegistry();
	#disposed = false;
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
		this.#assertUsable();
		this.#activeSceneInterest = interest !== null;
		const runId = ++this.#runSequence;
		if (!interest) {
			this.#terrainProgress = createEmptyTerrainProgress();
			this.#renderer.setStaticRenderAnchorLandblockId(null);
			return;
		}

		this.#renderer.setStaticRenderAnchorLandblockId(interest.anchorLandblockId);
		void this.#runTerrainInterest(runId, interest);
	}

	queryTerrainLandblockBounds(
		options: Parameters<StaticSceneQuery["queryTerrainLandblockBounds"]>[0],
	): ReturnType<StaticSceneQuery["queryTerrainLandblockBounds"]> {
		return this.#staticSceneQuery.queryTerrainLandblockBounds(options);
	}

	createSnapshot(): OpenWorldStreamingControllerSnapshot {
		return {
			staticSceneQuery: this.#staticSceneQuery.createSnapshot(),
			staticSceneQueryOverview: this.#staticSceneQuery.createOverviewSnapshot(),
			terrain: this.#terrainProgress,
		};
	}

	createDiagnosticsSnapshot(): OpenWorldStreamingDiagnosticsSnapshot {
		const ownerSnapshot = this.#owners.createSnapshot();
		return {
			artifacts: {
				inFlight:
					this.#terrainProgress.resolving + this.#terrainProgress.baking,
				ready: this.#terrainProgress.committed,
				staleRejected: 0,
			},
			compatibilityShims: [
				{
					deletionTarget: "Phase 14 browser runtime cutover",
					kind: "compatibility-shim",
					owner: "browser-runtime-adapter",
					reason:
						"ClientRuntime still requires legacy-shaped overview and diagnostics snapshots.",
				},
			],
			frameBudget: {
				yieldedPasses: 0,
			},
			kind: "open-world-streaming-diagnostics",
			owners: {
				current: ownerSnapshot.current.length,
				evicted: ownerSnapshot.evictedCount,
			},
			pipeline: {
				selectedRuntimePipeline: "open-world-streaming",
				status: this.#disposed
					? "disposed"
					: this.#activeSceneInterest
						? "active"
						: "idle",
			},
			sceneCommits: {
				applied: this.#terrainProgress.committed,
				pending: Math.max(
					0,
					this.#terrainProgress.requested -
						this.#terrainProgress.committed -
						this.#terrainProgress.failed,
				),
			},
			textureResidency: {
				bucketCount: 0,
				claimCount: 0,
				pageBuildsInFlight: 0,
			},
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
	}

	async #runTerrainInterest(
		runId: number,
		interest: OpenWorldStreamingTerrainInterest,
	): Promise<void> {
		const tasks = createTerrainLayerTasks(interest);
		this.#terrainProgress = {
			...createEmptyTerrainProgress(),
			requested: tasks.length,
		};
		const targetOwnerIds = new Set<MaterializationOwnerId>();
		const requests = tasks.map((task) => {
			const owner = createStaticLayerMaterializationOwner({
				landblockId: task.scope.landblockId,
				layerKind: "terrain",
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
				this.#owners.evict(owner.id);
			}
		}

		for (const request of requests) {
			if (!this.#isCurrentRun(runId)) {
				return;
			}
			this.#terrainProgress = {
				...this.#terrainProgress,
				resolving: this.#terrainProgress.resolving + 1,
			};
			try {
				const commit = await this.#requireTerrainRunner().run({
					ownerId: request.owner.id,
					task: request.task,
				});
				if (
					!this.#isCurrentRun(runId) ||
					!this.#owners.isCurrent({
						ownerId: request.owner.id,
						token: request.token,
					})
				) {
					return;
				}
				this.#applyTerrainCommit(commit, interest.anchorLandblockId);
			} catch (error) {
				if (!this.#isCurrentRun(runId)) {
					return;
				}
				console.warn("[holtburger-3d][open-world-terrain]", error);
				this.#terrainProgress = {
					...this.#terrainProgress,
					failed: this.#terrainProgress.failed + 1,
				};
			} finally {
				if (this.#isCurrentRun(runId)) {
					this.#terrainProgress = {
						...this.#terrainProgress,
						baking: 0,
						resolving: Math.max(0, this.#terrainProgress.resolving - 1),
					};
				}
			}
		}
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

	#isCurrentRun(runId: number): boolean {
		return !this.#disposed && this.#runSequence === runId;
	}

	#requireTerrainRunner(): OpenWorldTerrainArtifactRunner {
		if (!this.#terrainRunner) {
			this.#terrainRunner = new OpenWorldTerrainArtifactRunner({
				assetReader: this.#options.assetReader,
				baker: this.#options.createStaticBaker(),
				resolver: this.#options.createStaticResolver(),
				textureClaims: this.#textureClaims,
			});
		}
		return this.#terrainRunner;
	}

	#assertUsable(): void {
		if (this.#disposed) {
			throw new Error("Open world streaming controller has been disposed.");
		}
	}
}

function createTerrainLayerTasks(
	interest: OpenWorldStreamingTerrainInterest,
): readonly StaticLayerTaskRequest[] {
	return planStaticDemand(
		{
			location: {
				kind: "outdoor-landblock",
				landblockId: interest.anchorLandblockId,
			},
			lod: {
				buildings: -1,
				envCells: -1,
				explicitObjects: -1,
				generatedScenery: -1,
				terrain: interest.radius,
			},
		},
		interest.revision,
	).layerTasks.filter((task) => task.domain === "outdoor-terrain");
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
