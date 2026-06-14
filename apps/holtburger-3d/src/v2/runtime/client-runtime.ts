import { HostBackedAssetService } from "../assets/asset-service";
import type { AssetService, AssetServiceSnapshot } from "../assets/contracts";
import type { RuntimeHost, RuntimeHostSnapshot } from "../host/contracts";
import type { Renderer, RendererSnapshot } from "../renderer/types";
import type { DebugOverlayPrimitive, FrameState } from "../renderer/types";
import { formatHex32, normalizeOutdoorLandblockId } from "../../lib/landblocks";
import { TextureManager } from "../textures/texture-manager";
import type { TexturePacker } from "../textures/packing/packer";
import type { TextureFilteringMode } from "../textures/sampling-policy";
import {
	createConsoleRuntimeDiagnostics,
	type RuntimeDiagnostics,
	type RuntimeDiagnosticsReport,
	type StaticCoordinatorDiagnosticsReport,
	type TerrainTextureDiagnosticsReport,
	type TerrainTextureFallbackDiagnostics,
} from "./diagnostics";
import {
	ImmediateStaticBaker,
	ImmediateStaticResolver,
} from "../static/fake-workers";
import { StaticCoordinator } from "../static/coordinator/static-coordinator";
import type {
	StaticCoordinatorSnapshot,
	StaticCoordinatorCommitDelta,
	StaticDemand,
	StaticBounds,
	StaticDrawUnit,
	StaticLodRadii,
	StaticMaterialCoverageReport,
	StaticMaterialUnrenderedBucket,
	ScheduledStaticWorkStatus,
} from "../static/contracts";
import {
	materializeStaticCommit,
	type StaticMaterializationResult,
} from "./static-materializer";
import {
	StaticSceneQuery,
	describeStaticSceneSelectionKey,
	type StaticScenePickRequest,
	type StaticScenePickHit,
	type StaticSceneQuerySnapshot,
	type StaticSceneQueryRetainedScope,
	type StaticSceneSelectionKey,
} from "./static-scene-query";

const STATIC_DIAGNOSTICS_FAILURE_LIMIT = 8;
const TERRAIN_TEXTURE_DIAGNOSTICS_EVENT_LIMIT = 8;
const BLENDED_STATIC_AUDIT_WARNING_BUCKET_LIMIT = 8;

export type ManualStaticDomain =
	| "terrain"
	| "buildings"
	| "detail"
	| "env-cells";

export type RuntimeSceneInterest =
	| {
			readonly kind: "none";
	  }
	| {
			readonly kind: "outdoor-anchor";
			readonly anchorLandblockId: number;
			readonly domains: readonly ManualStaticDomain[];
			readonly lod?: Partial<StaticLodRadii>;
			readonly source: "manual" | "follow";
	  }
	| {
			readonly kind: "interior-cell";
			readonly landblockId: number;
			readonly envCellId: number;
			readonly source: "manual" | "follow";
	  };

export interface RuntimeSnapshot {
	readonly status: "idle" | "static-active" | "disposed";
	readonly renderPolicy: RuntimeRenderPolicySnapshot;
	readonly sceneInterest: RuntimeSceneInterest;
	readonly assets: AssetServiceSnapshot;
	readonly host: RuntimeHostSnapshot;
	readonly renderer: RendererSnapshot;
	readonly static: StaticCoordinatorSnapshot;
	readonly staticSceneQuery: StaticSceneQuerySnapshot;
	readonly staticMaterialization: StaticMaterializationSnapshot;
}

type RuntimeSnapshotListener = (snapshot: RuntimeSnapshot) => void;

interface RuntimeRenderPolicySnapshot {
	readonly textureFilteringMode: TextureFilteringMode;
}

interface StaticMaterializationSnapshot {
	readonly pendingRevisions: readonly number[];
	readonly committedRevisions: readonly number[];
	readonly failed: readonly StaticMaterializationFailureSnapshot[];
	readonly materializedDrawUnits: number;
	readonly sourceDrawUnits: number;
}

interface StaticMaterializationFailureSnapshot {
	readonly revision: number;
	readonly message: string;
}

export interface ClientRuntime {
	updateSceneInterest(interest: RuntimeSceneInterest): void;
	pickStaticRay(request: StaticScenePickRequest): StaticScenePickHit | null;
	setStaticDebugSelection(selectionKey: StaticSceneSelectionKey | null): void;
	setTextureFilteringMode(filteringMode: TextureFilteringMode): void;
	updateFrameState(state: FrameState): void;
	createDiagnosticsReport(): RuntimeDiagnosticsReport;
	subscribe(listener: RuntimeSnapshotListener): () => void;
	dispose(): void;
}

export interface ClientRuntimeOptions {
	readonly renderer: Renderer;
	readonly host: RuntimeHost;
	readonly assetService?: AssetService;
	readonly diagnostics?: RuntimeDiagnostics;
	readonly staticCoordinator?: StaticCoordinator;
	readonly texturePacker?: TexturePacker;
}

export function createClientRuntime(
	options: ClientRuntimeOptions,
): ClientRuntime {
	const staticCoordinator =
		options.staticCoordinator ??
		new StaticCoordinator({
			baker: new ImmediateStaticBaker(),
			resolver: new ImmediateStaticResolver(),
		});
	const assetService =
		options.assetService ?? new HostBackedAssetService({ host: options.host });

	return new ClientRuntimeImpl(
		options.renderer,
		options.host,
		assetService,
		staticCoordinator,
		options.texturePacker,
		options.diagnostics ?? createConsoleRuntimeDiagnostics(),
	);
}

class ClientRuntimeImpl implements ClientRuntime {
	readonly #renderer: Renderer;
	readonly #host: RuntimeHost;
	readonly #assetService: AssetService;
	readonly #diagnostics: RuntimeDiagnostics;
	readonly #textureManager: TextureManager;
	readonly #staticCoordinator: StaticCoordinator;
	readonly #staticSceneQuery = new StaticSceneQuery();
	readonly #listeners = new Set<RuntimeSnapshotListener>();
	readonly #unsubscribeRenderer: () => void;
	readonly #unsubscribeStaticCoordinator: () => void;
	readonly #unsubscribeStaticCommits: () => void;
	readonly #unsubscribeStaticSourcePayloads: () => void;
	#lastRendererSnapshot: RendererSnapshot;
	#lastStaticSnapshot: StaticCoordinatorSnapshot;
	#sceneInterest: RuntimeSceneInterest = { kind: "none" };
	#renderAnchorLandblockId: number | null = null;
	#staticMaterializationQueue: Promise<void> = Promise.resolve();
	#pendingStaticMaterializations = new Set<number>();
	#committedStaticMaterializations: number[] = [];
	#failedStaticMaterializations: StaticMaterializationFailureSnapshot[] = [];
	#materializedDrawUnitIdsBySourceDrawUnitId = new Map<
		string,
		readonly string[]
	>();
	readonly #materializedDrawUnitsById = new Map<string, StaticDrawUnit>();
	#recentTerrainTextureFallbacks: TerrainTextureFallbackDiagnostics[] = [];
	readonly #reportedStaticResolverFailures = new Set<string>();
	#staticDebugSelectionKey: StaticSceneSelectionKey | null = null;
	#disposed = false;

	constructor(
		renderer: Renderer,
		host: RuntimeHost,
		assetService: AssetService,
		staticCoordinator: StaticCoordinator,
		texturePacker: TexturePacker | undefined,
		diagnostics: RuntimeDiagnostics,
	) {
		this.#renderer = renderer;
		this.#host = host;
		this.#assetService = assetService;
		this.#diagnostics = diagnostics;
		this.#textureManager = new TextureManager({ assetService, texturePacker });
		this.#staticCoordinator = staticCoordinator;
		this.#staticCoordinator.setAtlasSnapshotProvider(
			(payloads, staticBatchId) =>
				this.#textureManager.createStaticAtlasBatchSnapshot(
					payloads,
					staticBatchId,
				),
		);
		this.#lastRendererSnapshot = {
			backend: "webgl2",
			canvasWidth: 0,
			canvasHeight: 0,
			debugOverlayPrimitives: 0,
			error: null,
			frameCount: 0,
			frameHandlerMs: 0,
			isRunning: true,
			renderedTriangles: 0,
			staticDrawUnits: 0,
			terrainDrawUnits: 0,
		};
		this.#lastStaticSnapshot = staticCoordinator.createSnapshot();
		this.#unsubscribeRenderer = renderer.subscribe((snapshot) => {
			this.#lastRendererSnapshot = snapshot;
			this.#emit();
		});
		this.#unsubscribeStaticCoordinator = staticCoordinator.subscribe(
			(snapshot) => {
				this.#lastStaticSnapshot = snapshot;
				this.#warnAboutStaticResolverFailure(snapshot);
				this.#emit();
			},
		);
		this.#unsubscribeStaticCommits = staticCoordinator.subscribeCommits(
			(delta) => {
				this.#enqueueStaticMaterialization(delta);
			},
		);
		this.#unsubscribeStaticSourcePayloads =
			staticCoordinator.subscribeSourcePayloads((delta) => {
				this.#staticSceneQuery.ingestSourcePayload(delta.payload, {
					outdoorAnchorLandblockId: this.#renderAnchorLandblockId,
				});
				this.#refreshStaticDebugOverlay();
				this.#emit();
			});
	}

	updateSceneInterest(interest: RuntimeSceneInterest): void {
		this.#assertActive();
		this.#sceneInterest = normalizeSceneInterest(interest);
		const nextAnchor =
			this.#sceneInterest.kind === "outdoor-anchor"
				? normalizeOutdoorLandblockId(this.#sceneInterest.anchorLandblockId)
				: null;
		this.#setRenderAnchorLandblockId(nextAnchor);
		const activeWork = this.#staticCoordinator.requestStaticDemand(
			createStaticDemandFromSceneInterest(this.#sceneInterest),
		);
		this.#staticSceneQuery.retainScopes(
			activeWork.map(
				(work): StaticSceneQueryRetainedScope => ({
					domain: work.job.domain,
					landblockId: work.job.scope.landblockId,
				}),
			),
		);
		this.#refreshStaticDebugOverlay();
		this.#emit();
	}

	pickStaticRay(request: StaticScenePickRequest): StaticScenePickHit | null {
		this.#assertActive();
		return this.#staticSceneQuery.pickRay(request);
	}

	setStaticDebugSelection(
		selectionKey: StaticSceneSelectionKey | null,
	): void {
		this.#assertActive();
		this.#staticDebugSelectionKey = selectionKey;
		this.#refreshStaticDebugOverlay();
		this.#emit();
	}

	setTextureFilteringMode(filteringMode: TextureFilteringMode): void {
		this.#assertActive();
		const samplerUpdate = this.#textureManager.setFilteringMode(filteringMode);
		if (samplerUpdate) {
			this.#renderer.applySamplerPolicyUpdate(samplerUpdate);
		}
		this.#emit();
	}

	updateFrameState(state: FrameState): void {
		this.#assertActive();
		this.#renderer.updateFrameState(state);
	}

	createDiagnosticsReport(): RuntimeDiagnosticsReport {
		const snapshot = this.#createSnapshot();

		return {
			domains: [
				{
					kind: "renderer",
					summary: this.#lastRendererSnapshot,
				},
				{
					kind: "static-coordinator",
					...createStaticCoordinatorDiagnosticsReport(this.#lastStaticSnapshot),
				},
				this.#textureManager.createDiagnosticsReport(),
				createTerrainTextureDiagnosticsReport(
					this.#recentTerrainTextureFallbacks,
				),
			],
			kind: "runtime-diagnostics-report",
			runtime: {
				committedStaticMaterializationRevisions:
					snapshot.staticMaterialization.committedRevisions,
				failedStaticMaterializations: snapshot.staticMaterialization.failed,
				sceneInterest: createSceneInterestSummary(snapshot.sceneInterest),
				materializedStaticDrawUnits:
					snapshot.staticMaterialization.materializedDrawUnits,
				pendingStaticMaterializationRevisions:
					snapshot.staticMaterialization.pendingRevisions,
				sourceStaticDrawUnits: snapshot.staticMaterialization.sourceDrawUnits,
				status: snapshot.status,
				textureFilteringMode: snapshot.renderPolicy.textureFilteringMode,
			},
		};
	}

	subscribe(listener: RuntimeSnapshotListener): () => void {
		this.#listeners.add(listener);
		listener(this.#createSnapshot());

		return () => {
			this.#listeners.delete(listener);
		};
	}

	dispose(): void {
		if (this.#disposed) {
			return;
		}

		this.#disposed = true;
		this.#unsubscribeRenderer();
		this.#unsubscribeStaticCoordinator();
		this.#unsubscribeStaticCommits();
		this.#unsubscribeStaticSourcePayloads();
		this.#renderer.setDebugOverlayPrimitives([]);
		this.#staticCoordinator.dispose();
		this.#textureManager.dispose();
		this.#renderer.dispose();
		this.#emit();
		this.#listeners.clear();
	}

	#assertActive(): void {
		if (this.#disposed) {
			throw new Error("ClientRuntime has been disposed.");
		}
	}

	#setRenderAnchorLandblockId(nextAnchorLandblockId: number | null): void {
		if (this.#renderAnchorLandblockId === nextAnchorLandblockId) {
			return;
		}

		this.#renderAnchorLandblockId = nextAnchorLandblockId;
		this.#staticSceneQuery.setOutdoorAnchorLandblockId(nextAnchorLandblockId);
		this.#renderer.setStaticRenderAnchorLandblockId(nextAnchorLandblockId);
		this.#refreshStaticDebugOverlay();
	}

	#createSnapshot(): RuntimeSnapshot {
		return {
			assets: this.#assetService.createSnapshot(),
			host: this.#host.createSnapshot(),
			renderPolicy: {
				textureFilteringMode: this.#textureManager.filteringMode,
			},
			renderer: this.#lastRendererSnapshot,
			sceneInterest: this.#sceneInterest,
			static: this.#lastStaticSnapshot,
			staticSceneQuery: this.#staticSceneQuery.createSnapshot(),
			staticMaterialization: {
				committedRevisions: this.#committedStaticMaterializations,
				failed: this.#failedStaticMaterializations,
				materializedDrawUnits: countMaterializedDrawUnits(
					this.#materializedDrawUnitIdsBySourceDrawUnitId,
				),
				pendingRevisions: Array.from(this.#pendingStaticMaterializations).sort(
					(a, b) => a - b,
				),
				sourceDrawUnits: this.#materializedDrawUnitIdsBySourceDrawUnitId.size,
			},
			status: this.#disposed
				? "disposed"
				: this.#lastStaticSnapshot.requested > 0
					? "static-active"
					: "idle",
		};
	}

	#emit(): void {
		const snapshot = this.#createSnapshot();

		for (const listener of this.#listeners) {
			listener(snapshot);
		}
	}

	#enqueueStaticMaterialization(delta: StaticCoordinatorCommitDelta): void {
		this.#warnAboutDeferredStaticMaterialCoverage(delta);
		this.#pendingStaticMaterializations.add(delta.revision);
		this.#emit();
		this.#staticMaterializationQueue = this.#staticMaterializationQueue
			.then(() => this.#materializeStaticCommit(delta))
			.catch((error: unknown) => {
				this.#recordStaticMaterializationFailure(delta.revision, error);
			});
	}

	#warnAboutDeferredStaticMaterialCoverage(
		delta: StaticCoordinatorCommitDelta,
	): void {
		for (const coverage of delta.materialCoverage) {
			const buckets = coverage.unrenderedBuckets
				.filter(isBlendedStaticAuditBucket)
				.slice(0, BLENDED_STATIC_AUDIT_WARNING_BUCKET_LIMIT);
			if (buckets.length === 0) {
				continue;
			}

			this.#diagnostics.warn({
				buckets,
				domain: coverage.domain,
				kind: "static-material-coverage-deferred",
				landblockId: coverage.landblockId,
				revision: delta.revision,
			});
		}
	}

	#warnAboutStaticResolverFailure(snapshot: StaticCoordinatorSnapshot): void {
		const failure = snapshot.latestResolverFailure;
		if (!failure) {
			return;
		}

		const warningKey = [
			failure.revision,
			failure.workId,
			failure.domain,
			failure.scopeKey,
			failure.message,
		].join("|");
		if (this.#reportedStaticResolverFailures.has(warningKey)) {
			return;
		}

		this.#reportedStaticResolverFailures.add(warningKey);
		this.#diagnostics.warn({
			domain: failure.domain,
			kind: "static-resolver-failed",
			message: failure.message,
			revision: failure.revision,
			scopeKey: failure.scopeKey,
			workId: failure.workId,
		});
	}

	async #materializeStaticCommit(
		delta: StaticCoordinatorCommitDelta,
	): Promise<void> {
		const textureUpdate =
			await this.#textureManager.applyStaticCommitDelta(delta);
		if (this.#disposed) {
			return;
		}

		const materialized = materializeStaticCommit({
			commit: delta,
			materializedDrawUnitIdsBySourceDrawUnitId:
				this.#materializedDrawUnitIdsBySourceDrawUnitId,
			textureUpdate,
		});
		this.#updateMaterializedDrawUnitIdMappings(delta, materialized);
		this.#warnAboutStaticFallbacks(delta);
		applyMaterializedStaticCommit(this.#renderer, materialized);
		this.#pendingStaticMaterializations.delete(delta.revision);
		this.#committedStaticMaterializations = appendBoundedRevision(
			this.#committedStaticMaterializations,
			delta.revision,
		);
		this.#emit();
	}

	#recordStaticMaterializationFailure(revision: number, error: unknown): void {
		this.#pendingStaticMaterializations.delete(revision);
		const message = error instanceof Error ? error.message : String(error);
		this.#failedStaticMaterializations = appendBoundedFailure(
			this.#failedStaticMaterializations,
			{ message, revision },
		);
		this.#diagnostics.warn({
			error,
			kind: "static-materialization-failed",
			message,
			revision,
		});
		this.#emit();
	}

	#updateMaterializedDrawUnitIdMappings(
		delta: StaticCoordinatorCommitDelta,
		materialized: StaticMaterializationResult,
	): void {
		for (const removedDrawUnitId of delta.removedDrawUnitIds) {
			const materializedDrawUnitIds =
				this.#materializedDrawUnitIdsBySourceDrawUnitId.get(
					removedDrawUnitId,
				) ?? [removedDrawUnitId];
			this.#materializedDrawUnitIdsBySourceDrawUnitId.delete(removedDrawUnitId);
			for (const materializedDrawUnitId of materializedDrawUnitIds) {
				this.#materializedDrawUnitsById.delete(materializedDrawUnitId);
			}
		}
		for (const mapping of materialized.drawUnitIdMappings) {
			this.#materializedDrawUnitIdsBySourceDrawUnitId.set(
				mapping.sourceDrawUnitId,
				mapping.materializedDrawUnitIds,
			);
		}
		for (const drawUnit of materialized.staticDelta.addedDrawUnits) {
			this.#materializedDrawUnitsById.set(
				drawUnit.drawUnitId,
				drawUnit,
			);
		}
	}

	#warnAboutStaticFallbacks(delta: StaticCoordinatorCommitDelta): void {
		for (const drawUnit of delta.addedDrawUnits) {
			if (
				drawUnit.kind !== "terrain-geometry" ||
				drawUnit.terrainFallbackReasons.length === 0
			) {
				continue;
			}

			const fallback: TerrainTextureFallbackDiagnostics = {
				drawUnitId: drawUnit.drawUnitId,
				materialBucketKey: drawUnit.materialBucketKey,
				materialFamily: drawUnit.materialFamily,
				reasons: drawUnit.terrainFallbackReasons,
				revision: delta.revision,
			};
			this.#recentTerrainTextureFallbacks = appendBounded(
				this.#recentTerrainTextureFallbacks,
				fallback,
				TERRAIN_TEXTURE_DIAGNOSTICS_EVENT_LIMIT,
			);
			this.#diagnostics.warn({
				drawUnitId: fallback.drawUnitId,
				kind: "terrain-renderable-fallback",
				materialBucketKey: fallback.materialBucketKey,
				materialFamily: fallback.materialFamily,
				reasons: fallback.reasons,
				revision: fallback.revision,
			});
		}
	}

	#refreshStaticDebugOverlay(): void {
		if (!this.#staticDebugSelectionKey) {
			this.#renderer.setDebugOverlayPrimitives([]);
			return;
		}

		const debugBounds = this.#staticSceneQuery.querySelectionDebugBounds(
			this.#staticDebugSelectionKey,
		);
		if (!debugBounds) {
			const selectionKey = describeStaticSceneSelectionKey(
				this.#staticDebugSelectionKey,
			);
			this.#diagnostics.warn({
				kind: "static-debug-selection-unresolved",
				reason: "missing-query-bounds",
				selectionKey,
			});
			this.#renderer.setDebugOverlayPrimitives([]);
			return;
		}

		this.#renderer.setDebugOverlayPrimitives([
			createStaticDebugBoundsOverlayPrimitive(debugBounds.bounds, {
				id: describeStaticSceneSelectionKey(debugBounds.selectionKey),
			}),
		]);
	}
}

function createStaticDebugBoundsOverlayPrimitive(
	bounds: StaticBounds,
	options: { readonly id: string },
): DebugOverlayPrimitive {
	return {
		color: [1, 0.85, 0.1, 1],
		id: options.id,
		kind: "aabb",
		max: [bounds.max.x, bounds.max.y, bounds.max.z],
		min: [bounds.min.x, bounds.min.y, bounds.min.z],
	};
}

function isBlendedStaticAuditBucket(
	bucket: StaticMaterialUnrenderedBucket,
): boolean {
	return (
		bucket.triangleCount > 0 &&
		bucket.outcome === "render-deferred" &&
		(bucket.pass === "transparent" || bucket.pass === "additive")
	);
}

function createTerrainTextureDiagnosticsReport(
	recentFallbacks: readonly TerrainTextureFallbackDiagnostics[],
): TerrainTextureDiagnosticsReport {
	return {
		kind: "terrain-textures",
		recentFallbacks,
		summary: {
			recentFallbackCount: recentFallbacks.length,
		},
	};
}

function applyMaterializedStaticCommit(
	renderer: Renderer,
	materialized: StaticMaterializationResult,
): void {
	if (materialized.textureUpdate) {
		renderer.applyTexturePlacementUpdate(materialized.textureUpdate);
	}
	renderer.applyStaticDelta(materialized.staticDelta);
}

function appendBoundedRevision(
	revisions: readonly number[],
	revision: number,
): number[] {
	return [...revisions, revision].slice(-8);
}

function countMaterializedDrawUnits(
	drawUnitIdsBySourceDrawUnitId: ReadonlyMap<string, readonly string[]>,
): number {
	return [...drawUnitIdsBySourceDrawUnitId.values()].reduce(
		(count, drawUnitIds) => count + drawUnitIds.length,
		0,
	);
}

function appendBoundedFailure(
	failures: readonly StaticMaterializationFailureSnapshot[],
	failure: StaticMaterializationFailureSnapshot,
): StaticMaterializationFailureSnapshot[] {
	return [...failures, failure].slice(-8);
}

function appendBounded<T>(entries: readonly T[], entry: T, limit: number): T[] {
	return [...entries, entry].slice(-limit);
}

function normalizeSceneInterest(
	interest: RuntimeSceneInterest,
): RuntimeSceneInterest {
	if (interest.kind === "none") {
		return interest;
	}

	if (interest.kind === "interior-cell") {
		return {
			envCellId: interest.envCellId >>> 0,
			kind: "interior-cell",
			landblockId: normalizeOutdoorLandblockId(interest.landblockId),
			source: interest.source,
		};
	}

	return {
		anchorLandblockId: normalizeOutdoorLandblockId(interest.anchorLandblockId),
		domains: Array.from(new Set(interest.domains)).sort(),
		...(interest.lod ? { lod: interest.lod } : {}),
		kind: "outdoor-anchor",
		source: interest.source,
	};
}

function createSceneInterestSummary(
	interest: RuntimeSceneInterest,
): string | null {
	if (interest.kind === "none") {
		return null;
	}

	if (interest.kind === "interior-cell") {
		return [
			interest.source,
			"interior-cell",
			`0x${formatHex32(interest.landblockId)}`,
			`0x${formatHex32(interest.envCellId)}`,
		].join("|");
	}

	return [
		interest.source,
		"outdoor-anchor",
		`0x${formatHex32(interest.anchorLandblockId)}`,
		interest.domains.join(","),
	].join("|");
}

function createStaticCoordinatorDiagnosticsReport(
	snapshot: StaticCoordinatorSnapshot,
): Omit<StaticCoordinatorDiagnosticsReport, "kind"> {
	const inFlightWork = snapshot.activeWork
		.filter(isInFlightStaticWorkStatus)
		.map((work) => createStaticCoordinatorWorkDiagnostics(work));
	const recentFailures = snapshot.activeWork
		.filter(isFailedStaticWorkStatus)
		.slice(-STATIC_DIAGNOSTICS_FAILURE_LIMIT)
		.map((work) => createStaticCoordinatorWorkDiagnostics(work));

	return {
		inFlightWork,
		materialCoverage: snapshot.materialCoverage.map(
			createStaticMaterialCoverageDiagnostics,
		),
		recentFailures,
		summary: {
			baking: snapshot.baking,
			committed: snapshot.committed,
			committedDrawUnits: snapshot.committedDrawUnits,
			failed: snapshot.failed,
			latestLandblockEnvCellsPayload: snapshot.latestLandblockEnvCellsPayload
				? `lb ${formatHex(snapshot.latestLandblockEnvCellsPayload.landblockId)} cells ${snapshot.latestLandblockEnvCellsPayload.envCellCount} accepted ${snapshot.latestLandblockEnvCellsPayload.acceptedEnvCellCount} visible ${snapshot.latestLandblockEnvCellsPayload.visibleCellCount} portals ${snapshot.latestLandblockEnvCellsPayload.portalCount} links ${snapshot.latestLandblockEnvCellsPayload.portalLinkCount} seeds ${snapshot.latestLandblockEnvCellsPayload.staticObjectSeedCount} missing ${snapshot.latestLandblockEnvCellsPayload.missingRefCount}`
				: null,
			latestOutdoorStaticObjectsPayload:
				snapshot.latestOutdoorStaticObjectsPayload
					? `lb ${formatHex(snapshot.latestOutdoorStaticObjectsPayload.landblockId)} ${snapshot.latestOutdoorStaticObjectsPayload.domain} objects ${snapshot.latestOutdoorStaticObjectsPayload.objectCount} kinds b:${snapshot.latestOutdoorStaticObjectsPayload.objectKindCounts.building}/g:${snapshot.latestOutdoorStaticObjectsPayload.objectKindCounts["generated-scenery"]}/e:${snapshot.latestOutdoorStaticObjectsPayload.objectKindCounts["explicit-object"]} sources ${snapshot.latestOutdoorStaticObjectsPayload.sourceAssetCount} slots ${snapshot.latestOutdoorStaticObjectsPayload.materialSlotCount} materials ${snapshot.latestOutdoorStaticObjectsPayload.materialSourceCount} tex ${snapshot.latestOutdoorStaticObjectsPayload.textureRefCount} missing ${snapshot.latestOutdoorStaticObjectsPayload.missingRefCount}`
					: null,
			latestResolverFailure: snapshot.latestResolverFailure
				? `${snapshot.latestResolverFailure.workId}: ${snapshot.latestResolverFailure.message}`
				: null,
			latestTerrainPayload: snapshot.latestTerrainPayload
				? `lb ${formatHex(snapshot.latestTerrainPayload.landblockId)} region ${snapshot.latestTerrainPayload.regionNumber} mesh ${snapshot.latestTerrainPayload.vertexCount}v/${snapshot.latestTerrainPayload.triangleCount}t quads ${snapshot.latestTerrainPayload.quadCount} tex ${snapshot.latestTerrainPayload.textureUseCount} missing ${snapshot.latestTerrainPayload.missingRefCount}`
				: null,
			requested: snapshot.requested,
			resolving: snapshot.resolving,
			revision: snapshot.revision,
			staleBakeResults: snapshot.staleBakeResults,
			staleResolverResults: snapshot.staleResolverResults,
		},
	};
}

function createStaticMaterialCoverageDiagnostics(
	coverage: StaticMaterialCoverageReport,
): StaticCoordinatorDiagnosticsReport["materialCoverage"][number] {
	return {
		buckets: coverage.buckets.map((bucket) => ({
			family: bucket.family,
			filteringMode: bucket.filteringMode,
			materials: bucket.materialCount,
			outcome: bucket.outcome,
			partitions: bucket.partitionCount,
			pass: bucket.pass,
			textureRoles: bucket.textureRoleCount,
			triangles: bucket.triangleCount,
		})),
		deferredTriangles: coverage.deferredTriangleCount,
		detailRoleCount: coverage.detailRoleCount,
		domain: coverage.domain,
		fallbackReasonCount: coverage.fallbackReasonCount,
		fallbackReasons: Object.fromEntries(
			coverage.fallbackReasonCounts.map((reason) => [
				reason.code,
				reason.count,
			]),
		),
		landblockId:
			coverage.landblockId === null ? null : formatHex(coverage.landblockId),
		materialCount: coverage.materialCount,
		partitionCount: coverage.partitionCount,
		renderedTriangles: coverage.renderedTriangleCount,
		triangleCount: coverage.triangleCount,
		unrenderedBuckets: coverage.unrenderedBuckets.map((bucket) => ({
			family: bucket.family,
			materials: bucket.materialCount,
			outcome: bucket.outcome,
			partitions: bucket.partitionCount,
			pass: bucket.pass,
			reasonCodes: bucket.reasonCodes,
			triangles: bucket.triangleCount,
		})),
		unsupportedTriangles: coverage.unsupportedTriangleCount,
	};
}

type StaticCoordinatorReportWorkStatus = Exclude<
	ScheduledStaticWorkStatus["status"],
	"committed" | "source-committed"
>;

type StaticCoordinatorReportWork = ScheduledStaticWorkStatus & {
	readonly status: StaticCoordinatorReportWorkStatus;
};

function isInFlightStaticWorkStatus(
	work: ScheduledStaticWorkStatus,
): work is ScheduledStaticWorkStatus & {
	readonly status: "baking" | "requested" | "resolving";
} {
	return (
		work.status === "requested" ||
		work.status === "resolving" ||
		work.status === "baking"
	);
}

function isFailedStaticWorkStatus(
	work: ScheduledStaticWorkStatus,
): work is ScheduledStaticWorkStatus & { readonly status: "failed" } {
	return work.status === "failed";
}

function createStaticCoordinatorWorkDiagnostics(
	work: StaticCoordinatorReportWork,
): StaticCoordinatorDiagnosticsReport["inFlightWork"][number] {
	return {
		domain: work.domain,
		failureMessage: work.failureMessage,
		revision: work.revision,
		scopeKey: work.scopeKey,
		status: work.status,
		workId: work.workId,
	};
}

function formatHex(value: number): string {
	return `0x${value.toString(16).padStart(8, "0")}`;
}

function createStaticDemandFromSceneInterest(
	interest: RuntimeSceneInterest,
): StaticDemand {
	if (interest.kind === "none") {
		return {
			location: null,
			lod: {
				buildings: -1,
				detail: -1,
				envCells: -1,
				terrain: -1,
			},
		};
	}

	if (interest.kind === "interior-cell") {
		return {
			location: {
				envCellId: interest.envCellId,
				kind: "interior-cell",
				landblockId: interest.landblockId,
			},
			lod: {
				buildings: -1,
				detail: -1,
				envCells: 0,
				terrain: -1,
			},
		};
	}

	const lod: StaticLodRadii = {
		buildings: interest.domains.includes("buildings")
			? (interest.lod?.buildings ?? 0)
			: -1,
		detail: interest.domains.includes("detail")
			? (interest.lod?.detail ?? 0)
			: -1,
		terrain: interest.domains.includes("terrain")
			? (interest.lod?.terrain ?? 0)
			: -1,
		envCells: interest.domains.includes("env-cells")
			? (interest.lod?.envCells ?? 0)
			: -1,
	};

	return {
		location: {
			kind: "outdoor-landblock",
			landblockId: interest.anchorLandblockId,
		},
		lod,
	};
}
