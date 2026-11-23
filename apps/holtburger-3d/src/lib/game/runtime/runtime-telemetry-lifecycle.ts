import { formatError } from "../../format-error";
import { isContentFailure } from "../../host/host-command-result";
import type { StaticObjectLayerDiagnostics } from "../commit/artifacts";
import type { EnvCellMaterializationDiagnostics } from "../commit/env-cell-materialization";
import type { StaticObjectGeometryDiagnostics } from "../commit/artifacts";
import type { LandblockOwnerId } from "../game-types";
import type { GeometryManager } from "../geometry/geometry-manager";
import type { OutdoorLightIndex } from "../environment/outdoor-light-index";
import type { Renderer } from "../renderer/renderer";
import type { StaticObjectSystem } from "../systems/static-object-system";
import type {
	TextureAtlasPageDiagnostics,
	TextureManager,
} from "../textures/texture-manager";
import type {
	EnvCellBehaviorOwnerId,
	OwnerId,
	ResourceOwnerId,
} from "./owner-ids";
import {
	type PresentationProfile,
	PresentationProfiler,
} from "./presentation-profiler";
import {
	completePresentationOperations,
	PresentationTeardownStack,
} from "./presentation-teardown";
import type {
	LandblockLayerKind,
	OutdoorStaticLayerKind,
} from "./scene-interest";

/** One activated authored-dynamic resident or valid static visual fallback. */
export interface AuthoredDynamicResidentDiagnostic {
	readonly layer: LandblockLayerKind;
	readonly landblockId: LandblockOwnerId;
	readonly residentId: string;
	readonly setupSourceId: string;
	readonly defaultAnimationId: string | null;
	readonly presentationMode: "animated" | "static-visual-fallback";
	readonly blockingHooks: readonly {
		readonly animationId: string;
		readonly frameIndex: number;
		readonly authoredOrder: number;
		readonly command: string;
	}[];
}

/** One installed outdoor-static layer's source-to-runtime diagnostic snapshot. */
export interface StaticObjectLayerRuntimeDiagnostics extends StaticObjectLayerDiagnostics {
	/** Concrete SceneGraph culling group selected for this independently installed layer. */
	readonly cullingGroup: OutdoorStaticLayerKind;
	readonly layer: OutdoorStaticLayerKind;
	readonly landblockId: LandblockOwnerId;
	/** Scene nodes published by this exact layer revision. */
	readonly sceneNodeCount: number;
	/** Promoted residents owned by the authored dynamic runtime. */
	readonly runtimeDynamicResidentCount: number;
	/** Whether this source emitted a static artifact rather than only promoted residents. */
	readonly staticArtifactInstalled: boolean;
}

/** One realized EnvCell source plan plus worker consumption facts. */
export interface EnvCellLayerRuntimeDiagnostics
	extends EnvCellMaterializationDiagnostics, StaticObjectGeometryDiagnostics {
	/** Directed seams proven safe for ordinary depth continuity. */
	readonly indoorDepthContinuousCrossingCount: number;
	/** Directed indoor seams that retain a topology-mask boundary. */
	readonly indoorTopologyBoundaryCrossingCount: number;
	/** Directed indoor/outdoor transitions that always retain a scene-domain boundary. */
	readonly exteriorTransitionCrossingCount: number;
	readonly landblockId: LandblockOwnerId;
	/** Total authored potentially-visible EnvCell references across resident scopes. */
	readonly potentiallyVisibleReferenceCount: number;
	readonly sceneShellNodeCount: number;
	readonly sceneResidentNodeCount: number;
	/** Connected components joined only through proven depth-continuous seams. */
	readonly visibilityIslandCount: number;
}

/** Aggregate outdoor-static resource and arbitration facts for app-local diagnostics. */
export interface StaticObjectRuntimeDiagnostics {
	readonly layers: readonly StaticObjectLayerRuntimeDiagnostics[];
	readonly envCellLayers: readonly EnvCellLayerRuntimeDiagnostics[];
	readonly geometryResourceCount: number;
	/** Uploaded vertex and index payload bytes across every resident geometry. */
	readonly geometryResourceBytes: number;
	readonly staticObjectOwnerCount: number;
	/**
	 * Outdoor static layer publications since startup.
	 *
	 * Each publication is one synchronous main-thread install, so streaming frame timing is only
	 * comparable between runs that published a similar number of layers in the window.
	 */
	readonly staticLayerPublicationCount: number;
	readonly staticObjectNodeCount: number;
	/** Landblock layers owning outdoor lights; growth across relocations means evicted lamps leaked. */
	readonly outdoorLightScopeCount: number;
	/** Synchronous texture-fact collection before building realization dispatch. */
	readonly textureFactCollectionDurationMs: number;
	readonly textureFactCollectionCount: number;
	readonly texture: ReturnType<
		TextureManager<ResourceOwnerId>["getDiagnostics"]
	>;
	/** Active packed atlas pages, exposed as resource-free Explorer diagnostics. */
	readonly textureAtlasPages: readonly TextureAtlasPageDiagnostics[];
}

export interface ContentFailureSubscribable {
	listenContentFailures(listener: (error: Error) => void): () => void;
}

export interface RuntimeTeardownHooks {
	readonly removeAllCellBehaviors: () => void;
	readonly collectSpawnedDemandRevocations: () => readonly (() => void)[];
	readonly clearTransientStateSync: () => void;
	readonly destroyGeometry: () => void;
	readonly clearStaticDetails: () => void;
	readonly assertNoRetainedSetupVisuals: () => void;
	readonly destroyTextures: () => Promise<void>;
	readonly destroyResidentAtlas: () => void;
	readonly destroyTerrainWorker: () => Promise<void>;
	readonly destroyTerrain: () => Promise<void>;
	readonly destroyOcean: () => void;
	readonly destroyEnvCells: () => void;
	readonly clearTargetSoundTables: () => void;
	readonly destroyParticleMeshes: () => void;
	readonly destroyPhysicsScriptTables: () => void;
	readonly destroySoundTables: () => void;
	readonly clearAmbientState: () => void;
	readonly releaseAmbientHandles: () => void;
	readonly destroyVisualTemplates: () => Promise<void>;
	readonly destroyDynamicEntities: () => Promise<void>;
	readonly destroyAudio: () => void;
	readonly destroyWorldPhysicsScripts: () => void;
	readonly destroyPhysicsScripts: () => void;
	readonly destroyAnimation: () => void;
	readonly clearAnimationSelection: () => void;
	readonly clearPortalState: () => void;
	readonly destroyRenderer: () => Promise<void> | undefined;
	readonly disposeCombatEffects: () => void;
	readonly destroySkyScripts: () => Promise<void>;
	readonly destroyEnvCellLayers: () => Promise<void>;
	readonly destroyStaticLayers: () => Promise<void>;
	readonly clearCommitArtifacts: () => void;
	readonly destroySceneInterest: () => void;
	readonly destroyLocalModels: (
		onRejected: (reason: unknown) => void,
	) => Promise<void>;
}

/**
 * Owns async continuation/failure tracking, diagnostics snapshots, opt-in profiling,
 * and reverse-order runtime shutdown coordination.
 */
export class RuntimeTelemetryAndLifecycle {
	/** Resource continuations awaited before runtime-owned sources and renderer state are destroyed. */
	readonly #realizationContinuations = new Set<Promise<unknown>>();
	/** Asynchronous preparation and eviction failures surfaced by the next runtime tick. */
	readonly #presentationFailures: unknown[] = [];
	/** Cold source observations replay to a new frontend error surface and reset on explicit retry. */
	readonly #contentFailures = new Map<unknown, Error>();
	readonly #contentFailureListeners = new Set<(error: Error) => void>();
	readonly #contentUnsubscriptions = new Set<() => void>();
	#presentationProfiler: PresentationProfiler | undefined;
	/** Active authored-dynamic residents grouped by their source owner. */
	readonly #authoredDynamicResidents = new Map<
		OwnerId | EnvCellBehaviorOwnerId,
		AuthoredDynamicResidentDiagnostic[]
	>();
	/** Source-to-runtime outdoor-static snapshots removed with their layer owner. */
	readonly #staticObjectLayerDiagnostics = new Map<
		OwnerId,
		StaticObjectLayerRuntimeDiagnostics
	>();
	readonly #envCellLayerDiagnostics = new Map<
		OwnerId,
		EnvCellLayerRuntimeDiagnostics
	>();
	#textureFactCollectionDurationMs = 0;
	#textureFactCollectionCount = 0;
	/** Outdoor static layer publications; each one is a synchronous main-thread install. */
	#staticLayerPublicationCount = 0;
	/** Prevents new work and late async publication after runtime shutdown begins. */
	#destroyed = false;
	/** Every shutdown caller joins the same completion, including any collected release failures. */
	#retirement: Promise<void> | null = null;

	get destroyed(): boolean {
		return this.#destroyed;
	}

	get presentationProfiler(): PresentationProfiler | undefined {
		return this.#presentationProfiler;
	}

	pushPresentationFailure(cause: unknown): void {
		this.#presentationFailures.push(cause);
	}

	throwPendingPresentationFailures(): void {
		const failures = this.#presentationFailures.splice(0);
		if (failures.length === 1) throw failures[0];
		if (failures.length > 1) {
			throw new AggregateError(
				failures,
				`${failures.length} asynchronous presentation operations failed.`,
			);
		}
	}

	recordStaticLayerPublication(): void {
		this.#staticLayerPublicationCount += 1;
	}

	recordTextureFactCollection(durationMs: number): void {
		this.#textureFactCollectionDurationMs += durationMs;
		this.#textureFactCollectionCount += 1;
	}

	setAuthoredDynamicResidents(
		ownerId: OwnerId | EnvCellBehaviorOwnerId,
		diagnostics: AuthoredDynamicResidentDiagnostic[],
	): void {
		this.#authoredDynamicResidents.set(ownerId, diagnostics);
	}

	deleteAuthoredDynamicResidents(
		ownerId: OwnerId | EnvCellBehaviorOwnerId,
	): void {
		this.#authoredDynamicResidents.delete(ownerId);
	}

	setStaticObjectLayerDiagnostics(
		ownerId: OwnerId,
		diagnostics: StaticObjectLayerRuntimeDiagnostics,
	): void {
		this.#staticObjectLayerDiagnostics.set(ownerId, diagnostics);
	}

	hasStaticObjectLayerDiagnostics(ownerId: OwnerId): boolean {
		return this.#staticObjectLayerDiagnostics.has(ownerId);
	}

	setEnvCellLayerDiagnostics(
		ownerId: OwnerId,
		diagnostics: EnvCellLayerRuntimeDiagnostics,
	): void {
		this.#envCellLayerDiagnostics.set(ownerId, diagnostics);
	}

	hasEnvCellLayerDiagnostics(ownerId: OwnerId): boolean {
		return this.#envCellLayerDiagnostics.has(ownerId);
	}

	clearLayerDiagnostics(ownerId: OwnerId): void {
		this.#authoredDynamicResidents.delete(ownerId);
		this.#staticObjectLayerDiagnostics.delete(ownerId);
		this.#envCellLayerDiagnostics.delete(ownerId);
	}

	/** Operational failures never enter the nonfatal content channel. */
	reportContentFailure(error: Error): void {
		if (!isContentFailure(error)) throw error;
		const key = error.cause === undefined ? error : error.cause;
		if (this.#destroyed || this.#contentFailures.has(key)) return;
		this.#contentFailures.set(key, error);
		console.warn(formatError(error), error);
		for (const listener of this.#contentFailureListeners) listener(error);
	}

	/** Connect existing chat/debug error surfaces without a frame-rate UI graph. */
	subscribeContentFailures(
		listener: (error: Error) => void,
		repositories: readonly ContentFailureSubscribable[],
	): () => void {
		const observe = (error: Error) => listener(error);
		this.#contentFailureListeners.add(observe);
		for (const error of this.#contentFailures.values()) observe(error);
		const subscriptions = repositories.map((repository) =>
			repository.listenContentFailures(observe),
		);
		const unsubscribe = () => {
			this.#contentFailureListeners.delete(observe);
			for (const unsub of subscriptions) unsub();
			this.#contentUnsubscriptions.delete(unsubscribe);
		};
		this.#contentUnsubscriptions.add(unsubscribe);
		return unsubscribe;
	}

	clearContentFailures(): void {
		this.#contentFailures.clear();
	}

	/** Enable or tear down presentation and renderer profiling as one diagnostic capability. */
	setFrameProfilingEnabled(enabled: boolean, renderer: Renderer | null): void {
		if (!renderer) throw new Error("Renderer is unavailable.");
		if (!renderer.frameDiagnostics) {
			throw new Error("Renderer does not support explicit frame profiling.");
		}
		renderer.frameDiagnostics.setProfilingEnabled(enabled);
		if (enabled) {
			if (!this.#presentationProfiler)
				this.#presentationProfiler = new PresentationProfiler();
		} else this.#presentationProfiler = undefined;
	}

	/** Reset presentation work and renderer measurements at the same browser boundary. */
	resetFrameProfile(renderer: Renderer | null): void {
		renderer?.frameDiagnostics?.resetProfile();
		this.#presentationProfiler?.reset();
	}

	/** Per-phase presentation timing; null outside an explicit profiling capture. */
	getPresentationProfile(): PresentationProfile | null {
		return this.#presentationProfiler?.getProfile() ?? null;
	}

	/** Snapshot active authored dynamics and any hook-blocked static visual fallbacks. */
	getAuthoredDynamicResidentDiagnostics(): readonly AuthoredDynamicResidentDiagnostic[] {
		return [...this.#authoredDynamicResidents.values()].flat();
	}

	/** Snapshot app-local outdoor-static lifecycle, resource, and atlas-arbitration diagnostics. */
	getStaticObjectRuntimeDiagnostics(systems: {
		readonly staticObjects: StaticObjectSystem<OwnerId, ResourceOwnerId>;
		readonly geometry: GeometryManager<ResourceOwnerId>;
		readonly outdoorLights: OutdoorLightIndex;
		readonly textures: TextureManager<ResourceOwnerId>;
	}): StaticObjectRuntimeDiagnostics {
		const staticObjects = systems.staticObjects.getDiagnostics();
		return {
			envCellLayers: [...this.#envCellLayerDiagnostics.values()].sort(
				(left, right) => left.landblockId.localeCompare(right.landblockId),
			),
			geometryResourceCount: systems.geometry.getResourceCount(),
			geometryResourceBytes: systems.geometry.getResourceBytes(),
			layers: [...this.#staticObjectLayerDiagnostics.values()].sort(
				(left, right) =>
					left.landblockId.localeCompare(right.landblockId) ||
					left.layer.localeCompare(right.layer),
			),
			staticObjectNodeCount: staticObjects.nodeCount,
			staticObjectOwnerCount: staticObjects.ownerCount,
			staticLayerPublicationCount: this.#staticLayerPublicationCount,
			outdoorLightScopeCount: systems.outdoorLights.ownedScopeCount,
			textureFactCollectionDurationMs: this.#textureFactCollectionDurationMs,
			textureFactCollectionCount: this.#textureFactCollectionCount,
			texture: systems.textures.getDiagnostics(),
			textureAtlasPages: systems.textures.getAtlasPageDiagnostics(),
		};
	}

	/** Drain background presentation work before its resources are destroyed and surface failures on tick. */
	trackPresentationWork(work: Promise<void>): void {
		this.trackRealizationContinuation(
			work.catch((error: unknown) => {
				this.#presentationFailures.push(error);
			}),
		);
	}

	trackRealizationContinuation(continuation: Promise<unknown>): void {
		this.#realizationContinuations.add(continuation);
		void continuation.then(
			() => this.#realizationContinuations.delete(continuation),
			() => this.#realizationContinuations.delete(continuation),
		);
	}

	destroy(hooks: RuntimeTeardownHooks): Promise<void> {
		return (this.#retirement ??= this.#destroy(hooks));
	}

	async #destroy(hooks: RuntimeTeardownHooks): Promise<void> {
		this.#destroyed = true;
		hooks.removeAllCellBehaviors();
		const spawned = hooks.collectSpawnedDemandRevocations();
		// Revoke demand synchronously before any release awaits in-flight publication.
		try {
			completePresentationOperations([
				...this.#contentUnsubscriptions,
				...spawned,
			]);
		} catch (error) {
			this.#presentationFailures.push(error);
		}
		this.#contentFailures.clear();
		hooks.clearTransientStateSync();
		// Register repositories before their users; reverse-order teardown retires users first,
		// attempts every release, and preserves the original dependency order on failure.
		const teardown = new PresentationTeardownStack();
		teardown.add("asynchronous-presentation", () => {
			if (this.#presentationFailures.length > 0)
				throw new AggregateError(
					this.#presentationFailures.splice(0),
					"Asynchronous presentation work failed during retirement.",
				);
		});
		teardown.add("geometry", hooks.destroyGeometry);
		teardown.add("static-details", hooks.clearStaticDetails);
		teardown.add("setup-visual-users", hooks.assertNoRetainedSetupVisuals);
		teardown.add("textures", hooks.destroyTextures);
		teardown.add("resident-atlas", hooks.destroyResidentAtlas);
		teardown.add("terrain-worker", hooks.destroyTerrainWorker);
		teardown.add("terrain", hooks.destroyTerrain);
		teardown.add("ocean", hooks.destroyOcean);
		teardown.add("env-cells", hooks.destroyEnvCells);
		teardown.add("target-sound-tables", hooks.clearTargetSoundTables);
		teardown.add("particle-meshes", hooks.destroyParticleMeshes);
		teardown.add("physics-script-tables", hooks.destroyPhysicsScriptTables);
		teardown.add("sound-tables", hooks.destroySoundTables);
		teardown.add("ambient-state", hooks.clearAmbientState);
		teardown.add("ambient-handles", hooks.releaseAmbientHandles);
		teardown.add("visual-templates", hooks.destroyVisualTemplates);
		teardown.add("dynamic-entities", hooks.destroyDynamicEntities);
		teardown.add("audio", hooks.destroyAudio);
		teardown.add("world-physics-scripts", hooks.destroyWorldPhysicsScripts);
		teardown.add("physics-scripts", hooks.destroyPhysicsScripts);
		teardown.add("animation", hooks.destroyAnimation);
		teardown.add("animation-selection", hooks.clearAnimationSelection);
		teardown.add("portal-state", hooks.clearPortalState);
		teardown.add("renderer", hooks.destroyRenderer);
		teardown.add("combat-effects", hooks.disposeCombatEffects);
		teardown.add("sky-scripts", hooks.destroySkyScripts);
		teardown.add("realization-continuations", async () => {
			await Promise.allSettled([...this.#realizationContinuations]);
		});
		teardown.add("env-cell-layers", hooks.destroyEnvCellLayers);
		teardown.add("static-layers", hooks.destroyStaticLayers);
		teardown.add("commit-artifacts", hooks.clearCommitArtifacts);
		teardown.add("scene-interest", hooks.destroySceneInterest);
		teardown.add("local-models", () =>
			hooks.destroyLocalModels((reason) => {
				this.#presentationFailures.push(reason);
			}),
		);
		await teardown.close();
	}
}
