import type {
	SummonVisualLevel,
	SummonLeashTuning,
	SummonFlickerTuning,
} from "../../lib/game/runtime/summon-presentation";
import { CLIENT_SUMMON_TUNING } from "../settings/tuning";
import type { ClientSummonLeashColors } from "../combat/summon-leash-appearance";
import type { RealizedEntitySelectionSource } from "../../lib/game/selection/entity-selection-bounds";
import type {
	CycleCandidate,
	CycleSelectionPresentationFrame,
} from "../combat/target-acquisition";
import type { ClientLockFeedbackFrame } from "../inventory/lock-feedback";
import {
	EMPTY_ENTITY_OVERLAY_FRAME,
	type EntityOverlayFrame,
} from "../../lib/game/renderer/entity-overlay-policy";
import type { NameplateMode } from "../world/entity-overlays";
import type { BarberPreview } from "../character/barber-state";
import type { DynamicPresentationOverride } from "../../lib/game/runtime/dynamic-presentation-override";
import {
	abortError,
	isAbortError,
	awaitWithAbort,
} from "../../lib/async-lifetime";
import type { SceneInterestMembership } from "../../lib/game/runtime/render-scene-interest-controller";
import { formatError } from "../../lib/format-error";
import type {
	CombatEffectOutcome,
	CombatEffectsAppearance,
	CombatEffectsTuning,
} from "../../lib/game/systems/combat-effects-system";
import type { ActiveRegionSource } from "../../lib/assets/active-region-source";
import type { LandblockProfileSource } from "../../lib/assets/landblock-profile-source";
import type { ResolvedSceneEnvironment } from "../../lib/game/environment/scene-environment";
import type {
	ClientEnvironmentReadout,
	ClientWeatherPreset,
} from "../settings/environment";
import type { ClientEnvironmentOverrides } from "../settings/environment-settings";
import type {
	DynamicEntityRealizationDisposition,
	DynamicEntityRealizationResults,
} from "../../lib/game/runtime/dynamic-entity-presentation";
import type {
	DynamicEntityTickBatch,
	DynamicEntityEvent,
	DynamicEntityView,
} from "../../lib/game/runtime/dynamic-entity-feed";
import type { SceneInterestRequest } from "../../lib/game/runtime/scene-interest";
import type {
	AudioListenerPlacement,
	PrimaryCameraView,
	SceneInterestRadii,
} from "../../lib/game/runtime/types";
import type {
	ResolvedSceneOrigin,
	ScenePlacement,
	SceneResidency,
} from "../../lib/game/scene";
import type { NameplateContent } from "../../lib/game/systems/dynamic-presentation-source";
import type { RenderExtent } from "../../lib/game/renderer/render-extent";
import type {
	SceneActivationReceipt,
	SceneActivationRequest,
	SceneActivationStatus,
} from "../../lib/game/runtime/scene-availability";
import type {
	ClientCurrentState,
	ClientCameraTick,
	ClientDynamicScriptCue,
	ClientDynamicSoundCue,
	ClientPresentationDiscontinuity,
	ClientEntitySelectionQueryRequest,
} from "./host-contract";
import type {
	ClientPreciseJumpRay,
	ClientPreciseJumpSnapshot,
} from "../combat/precise-jump-session";
import {
	ClientLifecycleSession,
	type ClientLifecycleSessionEvent,
} from "./lifecycle-session";
import type {
	ClientCameraStatus,
	ClientCameraTarget,
} from "../../lib/game/camera/client-camera-session";
import type { PossessionCameraController } from "../../lib/game/camera/possession-camera-controller";
import type { HostKinematicBoomPresentation } from "../../lib/game/motion/host-kinematic-boom-path";
import type {
	PortalTransitionPresentationPlan,
	PortalTransitionPresentationReceipt,
} from "../../lib/client/portal-transition-presentation";
import type {
	FrameSelectionMetrics,
	RendererFrameDiagnosticsSnapshot,
	WorldIndicatorInput,
} from "../../lib/game/renderer/renderer";
import type { MinimapFrame } from "../../app/minimap-frame";
import type { MapEntity } from "../../lib/game/map/map-blips";
import type { MapTerrainSource } from "../../lib/game/map/map-renderer";
import type {
	EntitySelectionGeometry,
	EntitySelectionRefinement,
	PresentedSelectionRay,
} from "../../lib/game/selection/entity-selection-intersection";
import type {
	PortalTransitionRuntimeDiagnostics,
	DynamicEntityPresentationState,
} from "../../lib/game/runtime/game-presentation-runtime";
import type { ClientSelectedEntityTrackingStatus } from "../world/selection-tracking";
import type {
	ClientCombatTargetFrame,
	ClientTargetIndicatorFrame,
} from "../combat/target-indicator";
import { ClientEnvironmentPresenter } from "./presentation-environment";
import { ClientScenePortalCoordinator } from "./presentation-scene-portal";
import { ClientCameraAndSelectionPresenter } from "./presentation-camera-selection";
import { ClientCombatAndOverlayPresenter } from "./presentation-combat-overlays";

/** Presentation state exposed to the thin client shell. */
export type ClientGameplayPresentationStatusKind =
	| "starting"
	| "awaiting-snapshot"
	| "loading-player"
	| "loading-activation"
	| "ready"
	| "error"
	| "stopped";

export interface ClientGameplayPresentationStatus {
	readonly kind: ClientGameplayPresentationStatusKind;
	readonly diagnostic: string | null;
}

export interface ClientGameplayPresentationFrame {
	readonly rendered: boolean;
	readonly status: ClientGameplayPresentationStatus;
}

/** One coherent click ray sampled from the exact camera and viewport last presented. */
export interface ClientPresentedCameraRay {
	readonly query: Omit<ClientEntitySelectionQueryRequest, "sequence">;
	readonly refinement: PresentedSelectionRay;
}

/** Residency identity shown by the client diagnostics panel. */
export interface ClientDiagnosticResidency {
	readonly landblockId: string;
	readonly envCellId: string | null;
}

/** Cold, curated client diagnostics sampled only while the debug panel is open. */
export interface ClientGameplayPresentationDiagnostics {
	readonly playerGuid: number | null;
	readonly playerResidency: ClientDiagnosticResidency | null;
	readonly cameraResidency: ClientDiagnosticResidency | null;
	readonly cameraStatus: ReturnType<
		ClientGameplayPresentationCameraController["status"]
	>;
	readonly renderedFrameCount: number;
	readonly viewport: {
		readonly cssWidth: number;
		readonly cssHeight: number;
		readonly drawingBufferWidth: number;
		readonly drawingBufferHeight: number;
	};
	/** Shared resource totals for cold resident-memory comparisons in client profiles. */
	readonly residentResources:
		PortalTransitionRuntimeDiagnostics["persistent"] | null;
	/** Complete renderer diagnostics, including opt-in CPU/GPU phase clocks and workload counters. */
	readonly renderer: RendererFrameDiagnosticsSnapshot | null;
	readonly draw: null | {
		readonly entitySelection: FrameSelectionMetrics["entitySelection"];
		readonly viewCount: number;
		readonly visibleSceneEntries: number;
		readonly visibleStaticNodes: number;
		readonly visibleDynamicEntities: number;
		readonly visibleDynamicSourceRanges: number;
		readonly objectDrawCalls: number;
		readonly dynamicDrawCalls: number;
		readonly particleBatches: number;
	};
}

/** Client-local camera controller exposed only to the client shell's semantic input handlers. */
export type ClientGameplayPresentationCameraController =
	PossessionCameraController<
		ClientCameraTarget,
		ClientCameraTick,
		HostKinematicBoomPresentation,
		ClientCameraStatus
	>;

/** Runtime surface consumed by the client orchestration seam and injected by focused tests. */
export interface ClientGameplayRuntime
	extends MapTerrainSource, RealizedEntitySelectionSource {
	setDynamicPresentationOverride(
		level: DynamicPresentationOverride | null,
	): Promise<void>;
	/** Accept every desired record before returning the visual-realization promise. */
	replaceDynamicEntitySnapshot(
		entities: readonly DynamicEntityView[],
	): Promise<DynamicEntityRealizationResults>;
	/** Accept this desired level before returning the visual-realization promise. */
	upsertDynamicEntity(
		entity: DynamicEntityView,
	): Promise<DynamicEntityRealizationDisposition>;
	removeDynamicEntity(guid: number, generation: number): void;
	playDynamicEntityScriptCue(cue: ClientDynamicScriptCue): void;
	playDynamicEntitySoundCue(
		cue: ClientDynamicSoundCue,
		receivedAtMs: number,
	): void;
	clearDynamicEntityCues(): void;
	reevaluateDynamicEntityEligibility(): Promise<DynamicEntityRealizationResults>;
	applyDynamicEntityTick(
		batch: DynamicEntityTickBatch,
		receivedAtMs: number,
	): void;
	/** Scene demand source retained independently from realized entities. */
	sceneInterestMembership(): SceneInterestMembership;
	updateSceneInterest(request: SceneInterestRequest): unknown;
	activateScene(
		request: SceneActivationRequest,
	): Promise<SceneActivationReceipt>;
	sceneActivationStatus(receipt: SceneActivationReceipt): SceneActivationStatus;
	completeSceneActivation(generation: number): void;
	clearSceneInterest(): unknown;
	resolveViewportExtent(cssWidth: number, cssHeight: number): RenderExtent;
	setPrimaryView(view: PrimaryCameraView): void;
	setWorldIndicator(indicator: WorldIndicatorInput | null): void;
	setAudioListener(placement: AudioListenerPlacement | null): void;
	setSceneEnvironment(environment: ResolvedSceneEnvironment): void;
	setViewerEntity(guid: number | null): void;
	setSelectedEntityGuid(guid: number | null): void;
	/** Force the hovered entity's nameplate without selecting it. */
	setHoveredEntityGuid(guid: number | null): void;
	/** Replace summon effects from the current semantic level without rebuilding presentation. */
	setSummonVisuals(
		levels: readonly SummonVisualLevel[],
		tuning: {
			readonly leash: SummonLeashTuning;
			readonly flicker: SummonFlickerTuning;
		},
	): void;
	/** Apply or clear app-owned name decoration without rebuilding presentation. */
	setDynamicEntityNameplateDecoration(
		guid: number,
		decoration: Pick<
			NameplateContent,
			"indicators" | "strikeThrough" | "nameColor"
		>,
	): void;
	/** Install the active scene driver's entity overlay frame for the next render. */
	setEntityOverlayFrame(frame: EntityOverlayFrame): void;
	dynamicEntityPresentationState(guid: number): DynamicEntityPresentationState;
	/** Latest authority-backed display value for one desired dynamic entity. */
	setPortalTransition(
		transition: PortalTransitionPresentationPlan | undefined,
	): void;
	/** Play a validated head-locked portal transition cue when the runtime owns audio. */
	playPortalTransitionSound?(kind: "enter" | "exit"): void;
	dynamicEntityOrigin(guid: number): ResolvedSceneOrigin | null;
	/** A rejected body without a usable previous appearance blocks player readiness. */
	dynamicEntityBodyFailure(guid: number): Error | null;
	/** Current scene placement of one realized dynamic entity. */
	spawnedEntityPlacement(guid: number): ScenePlacement | null;
	withSpawnedEntitySelectionGeometry<T>(
		guid: number,
		visit: (geometry: EntitySelectionGeometry) => T,
	): T | null;
	/** Every realized entity paired with the placement used by the current scene. */
	listPresentedSpawnedEntities(): Iterable<MapEntity>;
	/** Monotonic change fact for live dynamic placements. */
	readonly dynamicEntityPlacementRevision: number;
	/** Monotonic change fact for the overhead map's entity and radar picture. */
	readonly mapEntityRevision: number;
	/** Whether the exact indoor cell required by a player or camera is installed. */
	hasEnvCellScope(residency: SceneResidency): boolean;
	/** Commit pending loading artifacts without advancing live world presentation. */
	pollPortalTransitionLoading(): void;
	/** Forward confirmed outcomes and reset transient visual state. */
	acceptCombatOutcome(
		outcome: CombatEffectOutcome,
		target: number | null,
		tuning: CombatEffectsTuning,
		nowMs: number,
	): void;
	clearCombatEffects(): void;
	setCombatEffectsAppearance(appearance: CombatEffectsAppearance): void;
	refreshCombatEffectsFontAtlas(): void;
	/** Age transient visuals even when scene readiness holds the ordinary tick. */
	advanceCombatEffects(nowMs: number): void;
	tick(nowMs: number): void;
	clearPresentation(): void;
	/** Present portal space without requiring or advancing a committed world view. */
	renderPortalTransition(
		timeSeconds: number,
		extent: RenderExtent,
	): PortalTransitionPresentationReceipt | null;
	render(timeSeconds: number): PortalTransitionPresentationReceipt | null;
	/** Optional cold renderer counters used only by explicitly enabled client diagnostics. */
	getRendererFrameDiagnostics?(): RendererFrameDiagnosticsSnapshot | null;
	/** Reuse existing runtime resource accounting without adding a frame-hot collector. */
	getPortalTransitionDiagnostics?(): PortalTransitionRuntimeDiagnostics;
}

/** Borrowed presentation capabilities consumed by gameplay; browser-resource lifetime stays in the root. */
export interface ClientGameplayPresentationResources {
	readonly activeRegion: ActiveRegionSource;
	readonly profileSource: LandblockProfileSource;
	readonly runtime: ClientGameplayRuntime;
}

export interface ClientGameplayPresentationDependencies {
	readonly session: ClientLifecycleSession;
	readonly canvas: HTMLCanvasElement;
	readonly onError?: (error: unknown) => void;
	/** Wake the mounted lock overlay after one accepted transient feedback event. */
	readonly onLockFeedback?: () => void;
	/** Bind/unbind the runtime-owned scene demand source for app-local consumers. */
	readonly onSceneMembership?: (source: SceneInterestMembership | null) => void;
	/** Cold preset catalog published when content is installed or retired. */
	readonly onWeatherPresets?: (presets: readonly ClientWeatherPreset[]) => void;
	/** Saved-content mismatch is a settings issue, not a terminal rendering failure. */
	readonly onEnvironmentIssue?: (issue: string | null) => void;
	/** App-owned resources borrowed only for this gameplay adapter's lifetime. */
	readonly resources: ClientGameplayPresentationResources;
	/** Cold initial nameplate presentation mode; live edits arrive via `setNameplateMode`. */
	readonly nameplateMode?: NameplateMode;
	/** Imperative reader for currently enabled Nearby alert matches; absent alerts mean empty set. */
	readonly trackedAlertGuids?: () => ReadonlySet<number>;
	/** Shared acquisition candidate sampler reused by passive Smart immediate preview. */
	readonly sampleImmediateTargetCandidates?: (
		frame: CycleSelectionPresentationFrame,
	) => readonly CycleCandidate[] | null;
}

/**
 * Bridges one client authority session into the shared renderer runtime.
 *
 * This class owns no game state. The lifecycle session remains the authority mirror; this adapter
 * delegates domain presentation to focused collaborators and drains its own work before another
 * scene controller takes over.
 */
export class ClientGameplayPresentation {
	readonly camera: ClientGameplayPresentationCameraController;
	readonly #session: ClientLifecycleSession;
	readonly #canvas: HTMLCanvasElement;
	readonly #onError: (error: unknown) => void;
	readonly #resources: ClientGameplayPresentationResources;
	/** Adapter-started work must settle before another driver borrows the runtime. */
	readonly #pendingWork = new Set<Promise<void>>();
	/** Borrow admitted by start and withdrawn before the next driver takes over. */
	#activeResources: ClientGameplayPresentationResources | null = null;
	readonly #environment: ClientEnvironmentPresenter;
	readonly #scenePortal: ClientScenePortalCoordinator;
	readonly #cameraSelection: ClientCameraAndSelectionPresenter;
	readonly #combatOverlays: ClientCombatAndOverlayPresenter;
	#unsubscribe: (() => void) | null = null;
	#playerGuid: number | null = null;
	#startPromise: Promise<void> | null = null;
	#hasRenderedFrame = false;
	#renderedFrameCount = 0;
	#status: ClientGameplayPresentationStatus = {
		kind: "starting",
		diagnostic: null,
	};
	/** Terminal visual failure retained until this presentation session is replaced. */
	#terminalPresentationError: string | null = null;
	#destroyed = false;
	/** Withdraw waits whose mutable publication is fenced by driver/runtime ownership. */
	readonly #lifetime = new AbortController();
	#retirement: Promise<void> | null = null;

	constructor(dependencies: ClientGameplayPresentationDependencies) {
		this.#session = dependencies.session;
		this.#canvas = dependencies.canvas;
		this.#onError = dependencies.onError ?? (() => undefined);
		this.#resources = dependencies.resources;
		this.#environment = new ClientEnvironmentPresenter({
			onWeatherPresets: dependencies.onWeatherPresets,
			onEnvironmentIssue: dependencies.onEnvironmentIssue,
		});
		this.#scenePortal = new ClientScenePortalCoordinator({
			onSceneMembership: dependencies.onSceneMembership,
			isActiveResources: (resources) => this.#activeResources === resources,
			isDestroyed: () => this.#destroyed,
			isAwaitingSnapshot: () => this.#session.mirror.isAwaitingSnapshot(),
			playerGuid: () => this.#playerGuid,
			worldGeneration: () => this.#session.state().worldGeneration,
			authoritativePlayer: (guid) => this.#authoritativePlayer(guid),
			observeWork: (completion) =>
				this.#observePresentationCompletion(completion),
			onError: (error) => this.#reportError(error),
		});
		this.#cameraSelection = new ClientCameraAndSelectionPresenter({
			session: this.#session,
			canvas: this.#canvas,
		});
		this.camera = this.#cameraSelection.camera;
		this.#combatOverlays = new ClientCombatAndOverlayPresenter({
			session: this.#session,
			canvas: this.#canvas,
			onLockFeedback: dependencies.onLockFeedback,
			nameplateMode: dependencies.nameplateMode,
			trackedAlertGuids: dependencies.trackedAlertGuids,
			sampleImmediateTargetCandidates:
				dependencies.sampleImmediateTargetCandidates,
		});
	}

	/** Attach gameplay authority and presentation to already-built world resources. */
	start(): Promise<void> {
		if (this.#destroyed) {
			return Promise.reject(
				new Error("Cannot start a destroyed client presentation."),
			);
		}
		if (this.#startPromise !== null) return this.#startPromise;
		this.#playerGuid = this.#session.state().playerGuid;
		this.#status = { kind: "starting", diagnostic: null };
		this.#startPromise = this.#initialize();
		return this.#startPromise;
	}

	/** Current presentation status consumed by the client shell's notice policy. */
	status(): ClientGameplayPresentationStatus {
		return this.#status;
	}

	/** True server display facts; this capability is never routed through the override adapter. */
	readServerEnvironment(): ClientEnvironmentReadout | null {
		return this.#environment.readServerEnvironment();
	}

	/** Replace only the local presentation binding; the server source and runtime survive. */
	setEnvironmentOverrides(overrides: ClientEnvironmentOverrides): void {
		this.#environment.setEnvironmentOverrides(overrides);
	}

	/** Pull one coherent radar frame from the same presentation facts the world scene draws. */
	readMinimapFrame(): MinimapFrame {
		return this.#cameraSelection.readMinimapFrame(
			this.#activeResources,
			this.#playerGuid,
			this.#scenePortal.fieldOfView(),
		);
	}

	/** Sample diagnostic poses on demand without publishing frame-hot data through Svelte. */
	readLocationReport(): string {
		const player =
			this.#playerGuid === null
				? null
				: this.#authoritativePlayer(this.#playerGuid);
		return this.#cameraSelection.readLocationReport(player, this.#status.kind);
	}

	/** Cold UI mode update; stops passive preview immediately when leaving Smart. */
	setNameplateMode(mode: NameplateMode): void {
		this.#combatOverlays.setNameplateMode(mode);
	}

	/** Invalidate passive preview immediately after input targeting preferences change. */
	invalidateImmediateOverlayPreview(): void {
		this.#combatOverlays.invalidateImmediateOverlayPreview();
	}

	/** Forward the cold identity level once; presentation resolves realization and pose per frame. */
	setSelectedEntityGuid(guid: number | null): void {
		this.#cameraSelection.setSelectedEntityGuid(
			guid,
			this.#activeResources?.runtime,
		);
		this.#combatOverlays.setSelectedTarget(guid);
	}

	/** Pull target-local overlays against the same presented camera as combat indicators. */
	readLockFeedbackFrames(): readonly ClientLockFeedbackFrame[] {
		return this.#combatOverlays.readLockFeedbackFrames(
			this.#cameraSelection.lastPrimaryView(),
			this.#activeResources?.runtime,
		);
	}

	/** A clipped feedback still needs polling until its existing lifetime expires. */
	hasActiveLockFeedback(): boolean {
		return this.#combatOverlays.hasActiveLockFeedback();
	}

	/** Pull the combat bound and presented camera without publishing frame-hot UI state. */
	readCombatTargetFrame(): ClientCombatTargetFrame | null {
		return this.#combatOverlays.readCombatTargetFrame(
			this.#cameraSelection.lastPrimaryView(),
			this.#activeResources?.runtime,
		);
	}

	setHoveredEntityGuid(guid: number | null): void {
		this.#cameraSelection.setHoveredEntityGuid(
			guid,
			this.#activeResources?.runtime,
		);
	}

	/** Read one coherent residency and camera-distance fact for app-local selection policy. */
	selectedEntityTrackingStatus(
		guid: number,
	): ClientSelectedEntityTrackingStatus {
		return this.#cameraSelection.selectedEntityTrackingStatus(
			guid,
			this.#activeResources?.runtime,
		);
	}

	/** Project the exact current selected bound through the exact primary view last presented. */
	readTargetIndicatorFrame(): ClientTargetIndicatorFrame | null {
		return this.#cameraSelection.readTargetIndicatorFrame(
			this.#activeResources?.runtime,
		);
	}

	/** Pull one bounded diagnostics snapshot without making frame-hot facts reactive. */
	readDiagnostics(): ClientGameplayPresentationDiagnostics {
		const resources = this.#activeResources;
		const playerPlacement =
			resources === null || this.#playerGuid === null
				? null
				: resources.runtime.spawnedEntityPlacement(this.#playerGuid);
		const frame = resources?.runtime.getRendererFrameDiagnostics?.() ?? null;
		const selection = frame?.selectionMetrics;
		return {
			playerGuid: this.#playerGuid,
			playerResidency:
				playerPlacement === null
					? null
					: {
							landblockId: playerPlacement.landblockId,
							envCellId: playerPlacement.envCellId,
						},
			cameraResidency: this.#cameraSelection.lastCameraResidency(),
			cameraStatus: this.camera.status(),
			renderedFrameCount: this.#renderedFrameCount,
			viewport: {
				cssWidth: this.#canvas.clientWidth,
				cssHeight: this.#canvas.clientHeight,
				drawingBufferWidth: this.#canvas.width,
				drawingBufferHeight: this.#canvas.height,
			},
			residentResources:
				resources?.runtime.getPortalTransitionDiagnostics?.().persistent ??
				null,
			renderer: frame,
			draw:
				selection === undefined
					? null
					: {
							entitySelection: { ...selection.entitySelection },
							viewCount: selection.viewCount,
							visibleSceneEntries: selection.visibleSceneEntries,
							visibleStaticNodes: selection.visibleStaticNodeCount,
							visibleDynamicEntities: selection.visibleDynamicEntityCount,
							visibleDynamicSourceRanges:
								selection.visibleDynamicSourceRangeCount,
							objectDrawCalls: selection.objectDrawCalls,
							dynamicDrawCalls: selection.submittedDynamicDrawCount,
							particleBatches: selection.submittedParticleBatchCount,
						},
		};
	}

	/** Capture one acquisition owner; geometry remains borrowed inside the synchronous callback. */
	withCycleSelectionFrame<T>(
		visit: (frame: CycleSelectionPresentationFrame) => T,
	): T | null {
		return this.#cameraSelection.withCycleSelectionFrame(
			this.#activeResources?.runtime,
			!this.#destroyed && this.#status.kind === "ready",
			visit,
		);
	}

	/** Sample host-query and exact-render rays from the exact camera and viewport last presented. */
	samplePresentedCameraRay(
		clientX: number,
		clientY: number,
	): ClientPresentedCameraRay | null {
		return this.#cameraSelection.samplePresentedCameraRay(clientX, clientY);
	}

	/** Preserve precise-jump's established host contract through the shared camera sampler. */
	samplePreciseJumpRay(
		clientX: number,
		clientY: number,
	): ClientPreciseJumpRay | null {
		return this.#cameraSelection.samplePreciseJumpRay(clientX, clientY);
	}

	/** Refine a host candidate set against current posed browser geometry. */
	refineEntitySelection(
		ray: PresentedSelectionRay,
		candidateGuids: readonly number[],
		staticLimitDistance: number,
	): EntitySelectionRefinement {
		return this.#cameraSelection.refineEntitySelection(
			this.#activeResources?.runtime,
			ray,
			candidateGuids,
			staticLimitDistance,
		);
	}

	/** Publish one accepted atomic marker and optional reachable trajectory. */
	setPreciseJumpPresentation(snapshot: ClientPreciseJumpSnapshot): void {
		this.#cameraSelection.setPreciseJumpPresentation(
			snapshot,
			this.#activeResources?.runtime,
		);
	}

	/** Apply gameplay effect appearance when attached and when preferences change. */
	setCombatEffectsAppearance(appearance: CombatEffectsAppearance): void {
		this.#combatOverlays.setCombatEffectsAppearance(
			appearance,
			this.#activeResources?.runtime,
		);
	}

	refreshCombatEffectsFontAtlas(): void {
		this.#combatOverlays.refreshCombatEffectsFontAtlas(
			this.#activeResources?.runtime,
		);
	}

	/** Theme changes update existing leashes without replacing the runtime or its GPU resources. */
	setSummonLeashColors(colors: ClientSummonLeashColors): void {
		this.#combatOverlays.setSummonLeashColors(
			colors,
			this.#activeResources?.runtime,
		);
	}

	/** Reissue static demand on the next frame even if the player has not moved. */
	setSceneInterestRadii(radii: SceneInterestRadii): void {
		this.#scenePortal.setSceneInterestRadii(radii);
	}

	/** The host acknowledges a projection revision before the new FOV becomes visible. */
	setFieldOfView(degrees: number): void {
		this.#scenePortal.setFieldOfView(degrees);
	}

	/** Install only the current opening/revision's visual, leaving all authoritative facts untouched. */
	async setBarberPreview(preview: BarberPreview | null): Promise<void> {
		this.#combatOverlays.setBarberPreview(preview);
		if (preview !== null && this.#activeResources === null) await this.start();
		await this.#combatOverlays.reconcileBarberPresentation(
			this.#session.barberSnapshot(),
			this.#playerGuid,
			this.#activeResources?.runtime,
		);
	}

	/**
	 * Tick and render one browser frame on the `performance.now()` monotonic clock shared with
	 * host event receipt timestamps.
	 *
	 * The authoritative entity selects residency and the interpolated scene origin selects the
	 * camera eye. If visual realization or EnvCell topology is not ready, the frame is held rather
	 * than inventing a free-fly camera.
	 */
	frame(nowMs: number): ClientGameplayPresentationFrame {
		const resources = this.#activeResources;
		const playerGuid = this.#playerGuid;
		if (this.#destroyed || resources === null) {
			return { rendered: false, status: this.#status };
		}
		resources.runtime.advanceCombatEffects(nowMs);
		if (this.#terminalPresentationError !== null) {
			this.#setStatus("error", this.#terminalPresentationError);
			return { rendered: false, status: this.#status };
		}
		this.#environment.refreshIfDue(nowMs);
		if (this.#session.mirror.isAwaitingSnapshot()) {
			this.#setStatus("awaiting-snapshot");
			return { rendered: false, status: this.#status };
		}
		const lifecycle = this.#session.state().lifecycle;
		const portal = lifecycle?.kind === "portal-space";
		if (
			lifecycle?.kind !== "entering-world" &&
			lifecycle?.kind !== "in-world" &&
			!portal
		) {
			this.#setStatus("stopped");
			return { rendered: false, status: this.#status };
		}
		if (portal) {
			this.#scenePortal.ensurePortalTransition(
				resources,
				lifecycle,
				this.#hasRenderedFrame,
				() => {
					// The core resets its camera at the same generation edge. Drop the frontend registration too
					// so the next seed is accepted even when the player instance itself was reused by the server.
					this.#cameraSelection.resetTarget(true, (error) =>
						this.#reportError(error),
					);
				},
			);
		}
		const portalGeneration = this.#scenePortal.activePortalGeneration();
		if (portal) {
			resources.runtime.pollPortalTransitionLoading();
		}
		if (playerGuid === null) {
			this.#setStatus(
				"loading-player",
				"Waiting for the server to establish local-player identity.",
			);
			return portal
				? this.#renderPortalLoadingFrame(resources, nowMs)
				: { rendered: false, status: this.#status };
		}
		if (lifecycle.kind === "entering-world") {
			this.#setStatus(
				"loading-player",
				"Local-player identity is established, but authority has not entered portal space.",
			);
			return portal
				? this.#renderPortalLoadingFrame(resources, nowMs)
				: { rendered: false, status: this.#status };
		}
		const player = this.#authoritativePlayer(playerGuid);
		if (player === null) {
			resources.runtime.setViewerEntity(null);
			this.#scenePortal.clearSceneDemand(resources);
			this.#setStatus(
				"loading-player",
				`Local player 0x${playerGuid.toString(16).padStart(8, "0")} is absent from the authoritative dynamic mirror.`,
			);
			return portal
				? this.#renderPortalLoadingFrame(resources, nowMs)
				: { rendered: false, status: this.#status };
		}
		if (player.placement.kind !== "world") {
			resources.runtime.setViewerEntity(null);
			this.#scenePortal.clearSceneDemand(resources);
			this.#setStatus(
				"loading-player",
				`Local player has ${player.placement.kind} placement instead of world placement.`,
			);
			return portal
				? this.#renderPortalLoadingFrame(resources, nowMs)
				: { rendered: false, status: this.#status };
		}
		if (portal) {
			if (portalGeneration === null) {
				throw new Error(
					"Portal presentation is active without a generation-owned transition.",
				);
			}
			this.#scenePortal.syncSceneActivation(
				resources,
				player,
				portalGeneration,
			);
		} else {
			this.#scenePortal.exitPortalToWorld(resources);
			this.#scenePortal.syncSceneInterest(resources, player);
		}
		resources.runtime.setViewerEntity(playerGuid);
		if (!portal) {
			this.#combatOverlays.reconcileCombatHealth(nowMs);
			resources.runtime.tick(nowMs);
		}
		const primaryView = portal
			? this.#resolvePortalFrame(
					resources,
					player,
					playerGuid,
					portalGeneration!,
					nowMs,
				)
			: this.#resolveWorldFrame(resources, player, playerGuid, nowMs);
		if ("earlyReturn" in primaryView) {
			return primaryView.earlyReturn;
		}
		this.#cameraSelection.commitPrimaryView(
			resources.runtime,
			primaryView.view,
			!portal,
		);
		if (portal) {
			this.#combatOverlays.clearOverlayPresentation(resources.runtime);
		} else {
			this.#combatOverlays.publishEntityOverlays(
				resources.runtime,
				player,
				nowMs,
				this.#cameraSelection.selectedEntityGuid(),
				this.#cameraSelection.hoveredEntityGuid(),
				this.#status.kind === "ready" && this.camera.status().kind === "active",
				(visit) => this.withCycleSelectionFrame(visit),
			);
		}
		const transitionReceipt = resources.runtime.render(nowMs / 1_000);
		this.#hasRenderedFrame = true;
		this.#renderedFrameCount += 1;
		this.#setStatus("ready");
		if (portal) {
			const acknowledgedGeneration =
				this.#scenePortal.claimPortalRevealAcknowledgement(transitionReceipt);
			if (acknowledgedGeneration !== null) {
				void this.#session
					.acknowledgeWorldReveal(acknowledgedGeneration)
					.catch((error: unknown) => this.#reportError(error));
			}
		}
		return {
			rendered: true,
			status: this.#status,
		};
	}

	/** Detach authority and drain gameplay work without destroying borrowed renderer resources. */
	destroy(): Promise<void> {
		return (this.#retirement ??= this.#destroy());
	}

	async #destroy(): Promise<void> {
		this.#cameraSelection.clearPreciseJumpMarker();
		this.#destroyed = true;
		this.#lifetime.abort(abortError("Gameplay presentation retired."));
		this.#cameraSelection.resetTarget(false);
		const failures: unknown[] = [];
		const labels: string[] = [];
		const attempt = async (
			label: string,
			operation: () => void | Promise<void>,
		) => {
			try {
				await operation();
			} catch (error) {
				failures.push(error);
				labels.push(label);
			}
		};
		// Revoke camera registration before joining work that may depend on its receipt.
		await attempt("camera-stop", () => this.camera.stop());
		// Withdraw desired entities before awaiting startup/realization so late visuals cannot publish.
		this.#combatOverlays.destroy();
		this.#combatOverlays.clearOverlayPresentation(
			this.#activeResources?.runtime,
		);
		this.#unsubscribe?.();
		this.#unsubscribe = null;
		this.#scenePortal.invalidateCoordinator();
		await attempt("withdraw-local-appearance", () =>
			this.#activeResources?.runtime.setDynamicPresentationOverride(null),
		);
		await attempt("withdraw-live-entities", () =>
			this.#activeResources?.runtime
				.replaceDynamicEntitySnapshot([])
				.then(() => undefined),
		);
		await attempt("pending-gameplay-work", () =>
			Promise.allSettled([...this.#pendingWork]).then((results) => {
				const failed = results.filter(
					(result): result is PromiseRejectedResult =>
						result.status === "rejected",
				);
				if (failed.length) {
					throw new AggregateError(
						failed.map((result) => result.reason),
						"Gameplay work retirement failed.",
					);
				}
			}),
		);
		await attempt("camera-synchronization", () =>
			this.#cameraSelection.awaitSynchronization(),
		);
		await attempt("camera-destroy", () => this.camera.destroy());
		// Startup failure belongs to start()/onError; it must not prevent later scene retry.
		if (this.#startPromise !== null) {
			await Promise.allSettled([this.#startPromise]);
		}
		const resources = this.#activeResources;
		this.#activeResources = null;
		this.#scenePortal.detach(null);
		this.#environment.detach();
		this.#combatOverlays.clearOverlays();
		if (resources !== null) {
			resources.runtime.setEntityOverlayFrame(EMPTY_ENTITY_OVERLAY_FRAME);
			resources.runtime.clearDynamicEntityCues();
			resources.runtime.clearCombatEffects();
			resources.runtime.setSummonVisuals([], CLIENT_SUMMON_TUNING);
			resources.runtime.setWorldIndicator(null);
			resources.runtime.setViewerEntity(null);
			resources.runtime.setSelectedEntityGuid(null);
			resources.runtime.setHoveredEntityGuid(null);
			resources.runtime.setPortalTransition(undefined);
			resources.runtime.setAudioListener(null);
			resources.runtime.clearSceneInterest();
		}
		this.#status = { kind: "stopped", diagnostic: null };
		if (failures.length > 0) {
			throw new AggregateError(
				failures,
				`Client presentation shutdown failed for: ${labels.join(", ")}.`,
			);
		}
	}

	async #initialize(): Promise<void> {
		this.#unsubscribe = this.#session.subscribe((event) =>
			this.#receive(event),
		);
		try {
			const resources = this.#resources;
			if (this.#destroyed) return;
			this.#activeResources = resources;
			await this.#combatOverlays.reconcileBarberPresentation(
				this.#session.barberSnapshot(),
				this.#playerGuid,
				resources.runtime,
			);
			// Appearance work may outlive withdrawal; never republish a retired driver's demand.
			if (this.#destroyed) return;
			this.#environment.attach(resources, (timeMs) =>
				this.#session.readServerTime(timeMs),
			);
			resources.runtime.setEntityOverlayFrame(EMPTY_ENTITY_OVERLAY_FRAME);
			this.#combatOverlays.clearOverlays();
			this.#cameraSelection.applySelectionToRuntime(resources.runtime);
			this.#combatOverlays.syncCombatHealthWorld(true);
			this.#combatOverlays.setSelectedTarget(
				this.#cameraSelection.selectedEntityGuid(),
			);
			this.#combatOverlays.reconcileEntityPresentationPolicy(resources.runtime);
			this.#scenePortal.attach(resources);
			const lifecycle = this.#session.state().lifecycle;
			if (
				lifecycle?.kind !== "entering-world" &&
				lifecycle?.kind !== "in-world" &&
				lifecycle?.kind !== "portal-space"
			) {
				this.#activeResources = null;
				this.#scenePortal.detach(null);
				this.#environment.detach();
				this.#status = { kind: "stopped", diagnostic: null };
				return;
			}
			this.#environment.refreshNow(performance.now());
			await awaitWithAbort(
				this.#requestDynamicSnapshotReplacement(
					this.#session.mirror.entities(),
				),
				this.#lifetime.signal,
			);
		} catch (error) {
			if (this.#destroyed && isAbortError(error)) return;
			this.#reportError(error);
			throw error;
		}
	}

	#receive(event: ClientLifecycleSessionEvent): void {
		if (this.#destroyed) return;
		switch (event.type) {
			case "lock-feedback":
				this.#combatOverlays.acceptLockFeedback(event.feedback);
				return;
			case "combat-outcome":
				this.#combatOverlays.acceptCombatOutcome(
					event.outcome,
					event.receivedAtMs,
					this.#activeResources?.runtime,
				);
				return;
			case "resyncing":
				this.#activeResources?.runtime.setSummonVisuals(
					[],
					CLIENT_SUMMON_TUNING,
				);
				this.#combatOverlays.clearLockFeedback();
				this.#combatOverlays.clearOverlayPresentation(
					this.#activeResources?.runtime,
				);
				this.#combatOverlays.syncCombatHealthWorld(true);
				this.#activeResources?.runtime.clearCombatEffects();
				return;
			case "barber-updated":
				this.#observePresentationCompletion(
					this.#combatOverlays.reconcileBarberPresentation(
						event.barber,
						this.#playerGuid,
						this.#activeResources?.runtime,
					),
				);
				return;
			case "combat-mode":
				this.#combatOverlays.setCombatMode(event.mode);
				return;
			case "party-presence":
				// Fellowship creation/dissolution/HUD presence invalidates immediately; mid-party roster
				// changes settle on the next 10 Hz preview sample without subscribing to vital ticks.
				this.#combatOverlays.invalidateImmediateOverlayPreview();
				return;
			case "combat":
				this.#combatOverlays.setCombatTarget(
					event.status.desired?.target ?? null,
				);
				return;
			case "entity-combat-observed":
				this.#combatOverlays.acceptCombatObserved(event.combat);
				return;
			case "appraisal-facts-settled":
				this.#combatOverlays.acceptAppraisalFactsSettled(event.guid);
				return;
			case "current-state":
				this.#combatOverlays.clearLockFeedback();
				this.#receiveCurrentState(event.state);
				this.#combatOverlays.syncCombatHealthWorld(true);
				this.#combatOverlays.reconcileEntityPresentationPolicy(
					this.#activeResources?.runtime,
				);
				return;
			case "entities":
				this.#combatOverlays.reconcileEntityPresentationPolicy(
					this.#activeResources?.runtime,
				);
				return;
			case "lifecycle":
				if (event.lifecycle.kind !== "in-world") {
					this.#combatOverlays.clearLockFeedback();
					this.#combatOverlays.clearOverlayPresentation(
						this.#activeResources?.runtime,
					);
					this.#combatOverlays.syncCombatHealthWorld(true);
				} else {
					this.#combatOverlays.syncCombatHealthWorld(false);
				}
				return;
			case "local-player-established":
				this.#playerGuid = event.identity.playerGuid;
				this.#combatOverlays.reconcileEntityPresentationPolicy(
					this.#activeResources?.runtime,
				);
				return;
			case "presentation-tick":
				if (event.tick.dynamic !== null) {
					this.#receiveDynamic(
						{ kind: "ticked", batch: event.tick.dynamic },
						event.receivedAtMs,
					);
				}
				return;
			case "dynamic":
				this.#receiveDynamic(event.event, performance.now());
				return;
			case "dynamic-sound-cue":
				this.#combatOverlays.deliverEntityCue(
					{
						kind: "sound",
						worldGeneration: event.cue.worldGeneration,
						receivedAtMs: performance.now(),
						cue: event.cue,
					},
					this.#destroyed,
					this.#activeResources?.runtime,
				);
				return;
			case "dynamic-script-cue":
				this.#combatOverlays.deliverEntityCue(
					{
						kind: "script",
						worldGeneration: this.#session.state().worldGeneration,
						cue: event.cue,
					},
					this.#destroyed,
					this.#activeResources?.runtime,
				);
				return;
			case "server-time":
				this.#environment.refreshNow(performance.now());
				this.#combatOverlays.reconcileEntityPresentationPolicy(
					this.#activeResources?.runtime,
				);
				return;
			case "presentation-discontinuity":
				this.#combatOverlays.clearLockFeedback();
				this.#combatOverlays.clearOverlayPresentation(
					this.#activeResources?.runtime,
				);
				this.#combatOverlays.syncCombatHealthWorld(true);
				this.#receivePresentationDiscontinuity(event.discontinuity);
				return;
			case "exit-requested":
				this.#combatOverlays.clearLockFeedback();
				// Session outcomes belong to ClientApp; ending authority is not a renderer failure.
				this.#setStatus("stopped", event.exit.diagnostic);
				return;
		}
	}

	#receiveCurrentState(state: ClientCurrentState): void {
		this.#playerGuid = state.localPlayerGuid;
		this.#observePresentationCompletion(
			this.#combatOverlays.reconcileBarberPresentation(
				state.barber,
				this.#playerGuid,
				this.#activeResources?.runtime,
			),
		);
		this.#environment.refreshNow(performance.now());
	}

	#receiveDynamic(event: DynamicEntityEvent, receivedAtMs: number): void {
		switch (event.kind) {
			case "ticked": {
				if (this.#session.mirror.isAwaitingSnapshot()) {
					this.#setStatus("awaiting-snapshot");
					return;
				}
				const retryDeferred = this.#scenePortal.prepareDynamicTickRetry();
				const resources = this.#activeResources;
				if (resources !== null) {
					resources.runtime.applyDynamicEntityTick(event.batch, receivedAtMs);
					if (retryDeferred) {
						this.#scenePortal.ensureScenePresentationConvergence(resources);
					}
				}
				return;
			}
			case "snapshot":
				this.#scenePortal.invalidatePlayerPresentationConvergence();
				this.#observePresentationCompletion(
					this.#requestDynamicSnapshotReplacement(event.snapshot.entities),
				);
				this.#combatOverlays.reconcileEntityPresentationPolicy(
					this.#activeResources?.runtime,
				);
				return;
			case "upserted":
				if (event.entity.identity.guid === this.#playerGuid) {
					this.#scenePortal.invalidatePlayerPresentationConvergence();
				}
				if (this.#activeResources !== null) {
					this.#observePresentationCompletion(
						this.#activeResources.runtime.upsertDynamicEntity(event.entity),
					);
				}
				this.#combatOverlays.reconcileEntityNameplate(
					event.entity.identity.guid,
					this.#activeResources?.runtime,
				);
				return;
			case "removed":
				this.#combatOverlays.removeEntity(event.guid, event.generation);
				if (event.guid === this.#playerGuid) {
					this.#scenePortal.invalidatePlayerPresentationConvergence();
				}
				this.#activeResources?.runtime.removeDynamicEntity(
					event.guid,
					event.generation,
				);
				return;
		}
	}

	#receivePresentationDiscontinuity(
		discontinuity: ClientPresentationDiscontinuity,
	): void {
		this.#activeResources?.runtime.clearCombatEffects();
		this.#cameraSelection.resetOnDiscontinuity((error) =>
			this.#reportError(error),
		);
		this.#scenePortal.resetOnDiscontinuity(this.#activeResources);
		this.#hasRenderedFrame = false;
		// The host's next reset/teleport batch owns placement invalidation. This edge only drops
		// frontend demand/camera history; no canonical pose is manufactured here.
		this.#activeResources?.runtime.clearDynamicEntityCues();
		void discontinuity;
	}

	#resolvePortalFrame(
		resources: ClientGameplayPresentationResources,
		player: DynamicEntityView,
		playerGuid: number,
		portalGeneration: number,
		nowMs: number,
	):
		| { readonly view: PrimaryCameraView }
		| { readonly earlyReturn: ClientGameplayPresentationFrame } {
		let primaryView =
			this.#scenePortal.portalDestinationFrame(portalGeneration);
		if (primaryView === null) {
			const activation = this.#scenePortal.checkPortalDestinationActivation(
				resources,
				playerGuid,
			);
			if (activation.kind === "failed") {
				return {
					earlyReturn: this.#failPortalPresentation(
						resources,
						activation.diagnostic,
					),
				};
			}
			if (activation.kind === "waiting") {
				this.#setStatus(activation.status, activation.diagnostic);
				return {
					earlyReturn: this.#renderPortalLoadingFrame(resources, nowMs),
				};
			}
			const cameraView =
				this.#cameraSelection.resolvePortalDestinationPrimaryView(
					resources,
					player,
					activation.origin,
					this.#scenePortal.fieldOfView(),
					nowMs,
					(error) => this.#reportError(error),
				);
			if (cameraView.kind === "waiting") {
				this.#setStatus(cameraView.status, cameraView.diagnostic);
				return {
					earlyReturn: this.#renderPortalLoadingFrame(resources, nowMs),
				};
			}
			primaryView = cameraView.primaryView;
			this.#scenePortal.setPortalDestinationFrame(
				portalGeneration,
				primaryView,
			);
		}
		const plan = this.#scenePortal.publishPortalTransition(
			resources,
			nowMs,
			true,
		);
		if (plan.kind === "origin-to-tunnel" || plan.kind === "tunnel-only") {
			this.#setStatus("loading-activation");
			return {
				earlyReturn: this.#renderPortalLoadingFrame(resources, nowMs, false),
			};
		}
		return { view: primaryView };
	}

	#resolveWorldFrame(
		resources: ClientGameplayPresentationResources,
		player: DynamicEntityView,
		playerGuid: number,
		nowMs: number,
	):
		| { readonly view: PrimaryCameraView }
		| { readonly earlyReturn: ClientGameplayPresentationFrame } {
		const resolvedOrigin = resources.runtime.dynamicEntityOrigin(playerGuid);
		if (resolvedOrigin === null) {
			const failure = resources.runtime.dynamicEntityBodyFailure(playerGuid);
			if (failure !== null) {
				this.#setStatus("error", formatError(failure));
				return { earlyReturn: { rendered: false, status: this.#status } };
			}
			this.#setStatus(
				"loading-player",
				"The authoritative local player has no installed runtime presentation.",
			);
			return { earlyReturn: { rendered: false, status: this.#status } };
		}
		if (
			resolvedOrigin.envCellId !== null &&
			!resources.runtime.hasEnvCellScope(resolvedOrigin)
		) {
			this.#setStatus("loading-activation");
			return { earlyReturn: { rendered: false, status: this.#status } };
		}
		const cameraView = this.#cameraSelection.resolveWorldPrimaryView(
			resources,
			player,
			resolvedOrigin,
			this.#scenePortal.fieldOfView(),
			nowMs,
			() => this.#destroyed,
			(error) => this.#reportError(error),
		);
		if (cameraView.kind === "waiting") {
			this.#setStatus(cameraView.status, cameraView.diagnostic);
			return { earlyReturn: { rendered: false, status: this.#status } };
		}
		return { view: cameraView.primaryView };
	}

	/** Present one portal-only frame while destination prerequisites remain unavailable. */
	#renderPortalLoadingFrame(
		resources: ClientGameplayPresentationResources,
		nowMs: number,
		advanceTransition = true,
	): ClientGameplayPresentationFrame {
		this.#combatOverlays.clearOverlayPresentation(resources.runtime);
		if (advanceTransition) {
			this.#scenePortal.publishPortalTransition(resources, nowMs, false);
		}
		const extent = resources.runtime.resolveViewportExtent(
			this.#canvas.clientWidth,
			this.#canvas.clientHeight,
		);
		const receipt = resources.runtime.renderPortalTransition(
			nowMs / 1_000,
			extent,
		);
		this.#scenePortal.acknowledgePresented(receipt);
		this.#hasRenderedFrame = true;
		this.#renderedFrameCount += 1;
		return { rendered: true, status: this.#status };
	}

	/** Retire every portal-owned presentation edge and latch the explicit black error surface. */
	#failPortalPresentation(
		resources: ClientGameplayPresentationResources,
		diagnostic: string,
	): ClientGameplayPresentationFrame {
		this.#scenePortal.failPortalPresentation(resources);
		resources.runtime.clearPresentation();
		this.#terminalPresentationError = diagnostic;
		this.#setStatus("error", diagnostic);
		return { rendered: false, status: this.#status };
	}

	#authoritativePlayer(guid: number): DynamicEntityView | null {
		return this.#session.mirror.entityByGuid(guid);
	}

	#requestDynamicSnapshotReplacement(
		entities: readonly DynamicEntityView[],
	): Promise<void> {
		const resources = this.#activeResources;
		if (resources === null) return Promise.resolve();
		// Snapshot acceptance is synchronous inside the runtime; this promise names only realization.
		return resources.runtime
			.replaceDynamicEntitySnapshot(entities)
			.then(() => undefined);
	}

	/** Observe asynchronous realization failures without ordering later accepted state behind them. */
	#observePresentationCompletion(completion: Promise<unknown>): void {
		const observed = awaitWithAbort(completion, this.#lifetime.signal)
			.then(() => undefined)
			.catch((error: unknown) => {
				if (this.#destroyed && isAbortError(error)) return;
				this.#reportError(error);
			});
		this.#pendingWork.add(observed);
		void observed.then(() => this.#pendingWork.delete(observed));
	}

	#setStatus(
		kind: ClientGameplayPresentationStatusKind,
		diagnostic: string | null = null,
	): void {
		const previous = this.#status;
		if (previous.kind === kind && previous.diagnostic === diagnostic) return;
		this.#status = { kind, diagnostic };
	}

	#reportError(error: unknown): void {
		this.#setStatus("error", formatError(error));
		this.#onError(error);
	}
}
