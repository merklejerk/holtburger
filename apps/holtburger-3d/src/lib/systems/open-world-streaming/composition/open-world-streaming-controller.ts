import type {
	OpenWorldStreamingAtlasInspectionSnapshot,
	OpenWorldStreamingDiagnosticsSnapshot,
} from "../diagnostics/contracts";
import type { Renderer } from "../../../renderer/types";
import { StaticSceneQuery } from "../../../runtime/static-scene-query";
import { planStaticDemand } from "../../../static/demand-planner";
import type {
	OutdoorStaticObjectsPayloadSummary,
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
import {
	OpenWorldOutdoorObjectArtifactRunner,
	type OpenWorldOutdoorObjectLayerCommit,
} from "../static-layers/outdoor-objects/outdoor-object-artifact-runner";
import type { PreparedAssetReader } from "../../../assets/contracts";
import { applyOpenWorldStreamingTextureCommit } from "../texture-residency/commits/texture-commit-applier";

export interface OpenWorldStreamingControllerOptions {
	readonly assetReader: PreparedAssetReader;
	readonly renderer: Pick<
		Renderer,
		| "applyTexturePlacementUpdate"
		| "setStaticRenderAnchorLandblockId"
		| "setOutdoorBuildingsLayer"
		| "setOutdoorExplicitObjectsLayer"
		| "setOutdoorGeneratedSceneryLayer"
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

export interface OpenWorldStreamingStaticInterest {
	readonly anchorLandblockId: number;
	readonly lod: {
		readonly buildings: number;
		readonly explicitObjects: number;
		readonly generatedScenery: number;
		readonly terrain: number;
	};
	readonly revision: number;
}

export interface OpenWorldStreamingControllerSnapshot {
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

export class OpenWorldStreamingController {
	readonly #owners = new MaterializationOwnerRegistry();
	readonly #options: OpenWorldStreamingControllerOptions;
	readonly #renderer: OpenWorldStreamingControllerOptions["renderer"];
	readonly #staticSceneQuery = new StaticSceneQuery();
	#outdoorObjectRunner: OpenWorldOutdoorObjectArtifactRunner | null = null;
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
			this.#renderer.setStaticRenderAnchorLandblockId(null);
			return;
		}

		this.#renderer.setStaticRenderAnchorLandblockId(interest.anchorLandblockId);
		void this.#runStaticInterest(runId, interest);
	}

	queryTerrainLandblockBounds(
		options: Parameters<StaticSceneQuery["queryTerrainLandblockBounds"]>[0],
	): ReturnType<StaticSceneQuery["queryTerrainLandblockBounds"]> {
		return this.#staticSceneQuery.queryTerrainLandblockBounds(options);
	}

	createSnapshot(): OpenWorldStreamingControllerSnapshot {
		return {
			outdoorObjects: this.#outdoorObjectProgress,
			staticSceneQuery: this.#staticSceneQuery.createSnapshot(),
			staticSceneQueryOverview: this.#staticSceneQuery.createOverviewSnapshot(),
			terrain: this.#terrainProgress,
		};
	}

	createDiagnosticsSnapshot(): OpenWorldStreamingDiagnosticsSnapshot {
		const ownerSnapshot = this.#owners.createSnapshot();
		const textureSnapshot = this.#textureClaims.createSnapshot();
		return {
			artifacts: {
				inFlight:
					this.#terrainProgress.resolving +
					this.#terrainProgress.baking +
					this.#outdoorObjectProgress.resolving +
					this.#outdoorObjectProgress.baking,
				ready:
					this.#terrainProgress.committed +
					this.#outdoorObjectProgress.committed,
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
				applied:
					this.#terrainProgress.committed +
					this.#outdoorObjectProgress.committed,
				pending: Math.max(
					0,
					this.#terrainProgress.requested -
						this.#terrainProgress.committed -
						this.#terrainProgress.failed +
						this.#outdoorObjectProgress.requested -
						this.#outdoorObjectProgress.committed -
						this.#outdoorObjectProgress.failed,
				),
			},
			textureResidency: {
				bucketCount: textureSnapshot.bucketCount,
				claimCount: textureSnapshot.claimCount,
				pageBuildsInFlight: textureSnapshot.pageBuildsInFlight,
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

	async #runStaticInterest(
		runId: number,
		interest: OpenWorldStreamingStaticInterest,
	): Promise<void> {
		const tasks = createStaticLayerTasks(interest);
		const terrainTasks = tasks.filter(
			(task) => task.domain === "outdoor-terrain",
		);
		const outdoorObjectTasks = tasks.filter(isOutdoorObjectTask);
		this.#terrainProgress = {
			...createEmptyTerrainProgress(),
			requested: terrainTasks.length,
		};
		this.#outdoorObjectProgress = {
			...createEmptyOutdoorObjectProgress(),
			requested: outdoorObjectTasks.length,
		};
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
				this.#owners.evict(owner.id);
			}
		}

		for (const request of requests) {
			if (!this.#isCurrentRun(runId)) {
				return;
			}
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
							: null;
				if (
					!this.#isCurrentRun(runId) ||
					!this.#owners.isCurrent({
						ownerId: request.owner.id,
						token: request.token,
					})
				) {
					return;
				}
				if (commit?.kind === "terrain-layer-commit") {
					this.#applyTerrainCommit(commit, interest.anchorLandblockId);
				} else if (commit?.kind === "outdoor-object-layer-commit") {
					this.#applyOutdoorObjectCommit(commit);
				}
			} catch (error) {
				if (!this.#isCurrentRun(runId)) {
					return;
				}
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
				}
			} finally {
				if (this.#isCurrentRun(runId)) {
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
				}
			}
		}
	}

	#applyOutdoorObjectCommit(commit: OpenWorldOutdoorObjectLayerCommit): void {
		for (const textureCommit of commit.textureCommits) {
			applyOpenWorldStreamingTextureCommit(this.#renderer, textureCommit, {
				revision:
					this.#terrainProgress.committed +
					this.#outdoorObjectProgress.committed +
					1,
			});
		}
		this.#staticSceneQuery.applyStaticPeerRecords({
			sourceMappings: commit.payload.sourceMappingRecords,
			spatialRecords: commit.payload.spatialRecords,
		});
		switch (commit.payload.kind) {
			case "outdoor-buildings":
				this.#renderer.setOutdoorBuildingsLayer(
					commit.payload.landblockId,
					commit.payload,
				);
				break;
			case "outdoor-explicit-objects":
				this.#renderer.setOutdoorExplicitObjectsLayer(
					commit.payload.landblockId,
					commit.payload,
				);
				break;
			case "outdoor-generated-scenery":
				this.#renderer.setOutdoorGeneratedSceneryLayer(
					commit.payload.landblockId,
					commit.payload,
				);
				break;
		}
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

	#requireOutdoorObjectRunner(): OpenWorldOutdoorObjectArtifactRunner {
		if (!this.#outdoorObjectRunner) {
			this.#outdoorObjectRunner = new OpenWorldOutdoorObjectArtifactRunner({
				assetReader: this.#options.assetReader,
				baker: this.#options.createStaticBaker(),
				resolver: this.#options.createStaticResolver(),
				textureClaims: this.#textureClaims,
			});
		}
		return this.#outdoorObjectRunner;
	}

	#assertUsable(): void {
		if (this.#disposed) {
			throw new Error("Open world streaming controller has been disposed.");
		}
	}
}

function createStaticLayerTasks(
	interest: OpenWorldStreamingStaticInterest,
): readonly StaticLayerTaskRequest[] {
	return planStaticDemand(
		{
			location: {
				kind: "outdoor-landblock",
				landblockId: interest.anchorLandblockId,
			},
			lod: {
				buildings: interest.lod.buildings,
				envCells: -1,
				explicitObjects: interest.lod.explicitObjects,
				generatedScenery: interest.lod.generatedScenery,
				terrain: interest.lod.terrain,
			},
		},
		interest.revision,
	).layerTasks.filter(
		(task) => task.domain === "outdoor-terrain" || isOutdoorObjectTask(task),
	);
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

function isOutdoorObjectTask(task: StaticLayerTaskRequest): boolean {
	return (
		task.domain === "outdoor-buildings" ||
		task.domain === "outdoor-explicit-objects" ||
		task.domain === "outdoor-generated-scenery"
	);
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
			throw new Error(
				"Env-cell system is not wired into open-world streaming yet.",
			);
	}
}
