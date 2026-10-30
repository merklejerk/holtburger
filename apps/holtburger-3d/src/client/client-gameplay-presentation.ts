import {
	abortError,
	isAbortError,
	awaitWithAbort,
} from "../lib/async-lifetime";
import type { SceneInterestMembership } from "../lib/game/runtime/render-scene-interest-controller";
import type {
	CombatEffectOutcome,
	CombatEffectsAppearance,
	CombatEffectsTuning,
} from "../lib/game/systems/combat-effects-system";
import { formatClientLocation } from "./client-location-command";
import {
	type LandblockVector3,
	acVector3,
	acVectorToRender,
	landblockVector3,
	renderVector3,
	renderVectorToAc,
	sceneVec3,
	sceneVector3,
} from "../lib/assets/ac-frame";
import type { ActiveRegionSource } from "../lib/assets/active-region-source";
import type { LandblockProfileSource } from "../lib/assets/landblock-profile-source";
import { CLIENT_TUNING, CLIENT_COMBAT_EFFECTS_TUNING } from "./client-tuning";
import type { ResolvedSceneEnvironment } from "../lib/game/environment/scene-environment";
import {
	bindClientPresentationEnvironment,
	clientWeatherPresets,
	createClientServerEnvironmentSource,
	CLIENT_ENVIRONMENT_INTERVAL_MS,
	type ClientEnvironmentReadout,
	type ClientEnvironmentSource,
	type ClientServerEnvironmentSource,
	type ClientWeatherPreset,
} from "./client-environment";
import {
	CLIENT_ENVIRONMENT_OVERRIDES_DEFAULT,
	type ClientEnvironmentOverrides,
} from "./client-environment-settings";
import {
	createLandblockWorldOrigin,
	normalizeLandblockOwner,
} from "../lib/game/landblocks";
import {
	createCameraAxesRadians,
	rotateRenderVector,
	createCameraRotationRadians,
	resolveCameraLookAtAngles,
	createEntityFacingCameraYaw,
} from "../lib/game/math/camera-orientation";
import { Quat, Vec3 } from "../lib/game/math/types";
import {
	datAssetId,
	type DynamicEntityRealizationDisposition,
	type DynamicEntityRealizationResults,
} from "../lib/game/runtime/dynamic-entity-presentation";
import type {
	DynamicEntityTickBatch,
	DynamicEntityEvent,
	DynamicEntityView,
	DynamicEntityWorldPlacement,
} from "../lib/game/runtime/dynamic-entity-feed";
import {
	SceneInterestRequestCoordinator,
	type SceneInterestTarget,
} from "../lib/game/runtime/scene-target";
import type { SceneInterestRequest } from "../lib/game/runtime/scene-interest";
import { validateSceneInterestRadiiOrThrow } from "../lib/game/runtime/scene-interest";
import type { SceneInterestRadii } from "../lib/game/runtime/types";
import {
	CLIENT_GRAPHICS_DEFAULTS,
	clientSceneInterestRadii,
} from "./client-settings-policy";
import { CLIENT_GRAPHICS_RANGES } from "./client-settings-values";
import type {
	AudioListenerPlacement,
	Camera,
	PrimaryCameraView,
} from "../lib/game/runtime/types";
import type { ResolvedSceneOrigin } from "../lib/game/scene";
import type { NameplateContent } from "../lib/game/systems/dynamic-presentation-source";
import type { RenderExtent } from "../lib/game/renderer/render-extent";
import type {
	SceneActivationReceipt,
	SceneActivationRequest,
	SceneActivationStatus,
} from "../lib/game/runtime/scene-availability";
import type {
	ClientCurrentState,
	ClientCameraTick,
	ClientDynamicScriptCue,
	ClientDynamicSoundCue,
	ClientLifecycle,
	ClientPresentationDiscontinuity,
	ClientEntitySelectionQueryRequest,
} from "./client-host-contract";
import type {
	ClientPreciseJumpRay,
	ClientPreciseJumpSnapshot,
} from "./client-precise-jump-session";
import {
	ClientLifecycleSession,
	type ClientLifecycleSessionEvent,
} from "./client-lifecycle-session";
import {
	ClientCameraSession,
	type ClientCameraStatus,
	type ClientCameraTarget,
} from "../lib/game/camera/client-camera-session";
import { PossessionCameraController } from "../lib/game/camera/possession-camera-controller";
import {
	createProjectionClearanceRevision,
	type ProjectionClearanceRevision,
} from "../lib/game/camera/projection-clearance";
import type { HostKinematicBoomPresentation } from "../lib/game/motion/host-kinematic-boom-path";
import { PortalTransitionController } from "../lib/client/portal-transition-controller";
import type {
	PortalRevealReceipt,
	PortalTransitionPresentationPlan,
	PortalTransitionPresentationReceipt,
} from "../lib/client/portal-transition-presentation";
import type {
	FrameSelectionMetrics,
	RendererFrameDiagnosticsSnapshot,
	WorldIndicatorInput,
	WorldCurveTrajectoryInput,
	WorldTrajectoryInput,
} from "../lib/game/renderer/renderer";
import type { RuntimeTickProfile } from "../lib/game/runtime/runtime-tick-profiler";
import type { MinimapFrame } from "../app/minimap-frame";
import type { MapEntity } from "../lib/game/map/map-blips";
import type { MapTerrainSource } from "../lib/game/map/map-renderer";
import {
	type MapAnchor,
	mapHeadingFromSceneTransform,
} from "../lib/game/map/map-view";
import type { ScenePlacement } from "../lib/game/scene";
import {
	refineEntitySelectionCandidates,
	type EntitySelectionGeometry,
	type EntitySelectionRefinement,
	type PresentedSelectionRay,
} from "../lib/game/selection/entity-selection-intersection";
import type {
	PortalTransitionRuntimeDiagnostics,
	DynamicEntityPresentationState,
} from "../lib/game/runtime/game-presentation-runtime";
import {
	clientSelectedEntityDistance,
	type ClientSelectedEntityTrackingStatus,
} from "./client-selection-tracking";
import {
	projectClientTargetIndicator,
	projectClientCombatTarget,
	type ClientCombatTargetFrame,
	type ClientTargetIndicatorFrame,
} from "./client-target-indicator";

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
	/** Existing shared runtime clocks, injected only for an explicitly debug-enabled client. */
	readonly tickProfile: RuntimeTickProfile | null;
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

/** One exact portal destination's static acceptance and dynamic installation progress. */
type PortalSceneActivation =
	| {
			readonly kind: "requesting";
			readonly generation: number;
			readonly key: string;
	  }
	| {
			readonly kind: "accepted";
			readonly generation: number;
			readonly key: string;
			readonly receipt: SceneActivationReceipt;
			readonly realization: "idle" | "pending" | "deferred" | "ready";
			/** Exact player residency/membership facts used by the latest realization attempt. */
			readonly realizedPlayerPlacementKey: string | null;
			readonly revealAcknowledged: boolean;
	  };

/** One generation-current answer to whether the destination may begin portal exit rendering. */
type PortalDestinationReadiness =
	| {
			readonly kind: "waiting";
			readonly status: "loading-activation" | "loading-player";
			readonly diagnostic?: string;
	  }
	| { readonly kind: "failed"; readonly diagnostic: string }
	| {
			readonly kind: "ready";
			readonly origin: ResolvedSceneOrigin;
			readonly extent: RenderExtent;
			readonly cameraPresentation: HostKinematicBoomPresentation;
	  };

/** Settled destination view retained unchanged for every frame of one portal exit. */
interface PortalDestinationFrame {
	readonly generation: number;
	readonly primaryView: PrimaryCameraView;
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
export interface ClientGameplayRuntime extends MapTerrainSource {
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
	/** Apply or clear app-owned semantic decoration without rebuilding presentation. */
	setDynamicEntityNameplateDecoration(
		guid: number,
		decoration: Pick<NameplateContent, "indicators" | "strikeThrough">,
	): void;
	dynamicEntityPresentationState(guid: number): DynamicEntityPresentationState;
	/** Latest authority-backed display value for one desired dynamic entity. */
	setPortalTransition(
		transition: PortalTransitionPresentationPlan | undefined,
	): void;
	/** Play a validated head-locked portal transition cue when the runtime owns audio. */
	playPortalTransitionSound?(kind: "enter" | "exit"): void;
	dynamicEntityOrigin(guid: number): ResolvedSceneOrigin | null;
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
	hasEnvCellScope(residency: ResolvedSceneOrigin): boolean;
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
	tick(): void;
	clearPresentation(): void;
	/** Present portal space without requiring or advancing a committed world view. */
	renderPortalTransition(
		timeSeconds: number,
		extent: RenderExtent,
	): PortalTransitionPresentationReceipt | null;
	render(timeSeconds: number): PortalTransitionPresentationReceipt | null;
	/** Optional cold renderer counters used only by explicitly enabled client diagnostics. */
	getRendererFrameDiagnostics?(): RendererFrameDiagnosticsSnapshot | null;
	/** Optional shared runtime timing injected only by a diagnostics-oriented frontend. */
	getTickProfile?(): RuntimeTickProfile | null;
	/** Reuse existing runtime resource accounting without adding a frame-hot collector. */
	getPortalTransitionDiagnostics?(): PortalTransitionRuntimeDiagnostics;
	/** Explicitly create or tear down the existing renderer profiling session. */
	setRendererFrameProfilingEnabled?(enabled: boolean): void;
	/** Delimit the renderer measurement mean without rebuilding presentation. */
	resetRendererFrameProfile?(): void;
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
	/** Bind/unbind the runtime-owned scene demand source for app-local consumers. */
	readonly onSceneMembership?: (source: SceneInterestMembership | null) => void;
	/** Cold preset catalog published when content is installed or retired. */
	readonly onWeatherPresets?: (presets: readonly ClientWeatherPreset[]) => void;
	/** Saved-content mismatch is a settings issue, not a terminal rendering failure. */
	readonly onEnvironmentIssue?: (issue: string | null) => void;
	/** App-owned resources borrowed only for this gameplay adapter's lifetime. */
	readonly resources: ClientGameplayPresentationResources;
}

/** One authority-scoped sound or script cue delivered to the borrowed runtime. */
type GameplayPresentationCue =
	| {
			readonly kind: "script";
			readonly worldGeneration: number;
			readonly cue: ClientDynamicScriptCue;
	  }
	| {
			readonly kind: "sound";
			readonly worldGeneration: number;
			readonly receivedAtMs: number;
			readonly cue: ClientDynamicSoundCue;
	  };

/**
 * Bridges one client authority session into the shared renderer runtime.
 *
 * This class owns no game state. The lifecycle session remains the authority mirror; this adapter
 * only schedules realization, interpolation, camera, environment and static demand. It borrows
 * app-owned rendering resources and drains its own work before another scene controller takes over.
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
	/** Last picked location retained as pending feedback between replacement surface picks. */
	#preciseJumpMarker: WorldIndicatorInput["marker"] | null = null;
	/** Source composition owns one server sample; the adapter retains no resolved output. */
	#environmentSources: {
		readonly server: ClientServerEnvironmentSource;
		presentation: ClientEnvironmentSource;
	} | null = null;
	/** Cold preferences seed the borrowed runtime when gameplay starts. */
	#environmentOverrides: ClientEnvironmentOverrides =
		CLIENT_ENVIRONMENT_OVERRIDES_DEFAULT;
	#lastEnvironmentAtMs = Number.NEGATIVE_INFINITY;
	readonly #onSceneMembership: ClientGameplayPresentationDependencies["onSceneMembership"];
	readonly #onWeatherPresets: ClientGameplayPresentationDependencies["onWeatherPresets"];
	readonly #onEnvironmentIssue: ClientGameplayPresentationDependencies["onEnvironmentIssue"];
	#combatEffectsTuning: CombatEffectsTuning = CLIENT_COMBAT_EFFECTS_TUNING;
	#sceneInterestRadii: SceneInterestRadii = clientSceneInterestRadii(
		CLIENT_GRAPHICS_DEFAULTS.viewDistance,
	);
	#sceneInterestRevision = 0;
	#fieldOfView: number = CLIENT_GRAPHICS_DEFAULTS.verticalFovDegrees;
	#pendingFieldOfView: number | null = null;
	#sceneInterestCoordinator: SceneInterestRequestCoordinator | null = null;
	#unsubscribe: (() => void) | null = null;
	#playerGuid: number | null = null;
	#startPromise: Promise<void> | null = null;
	#sceneTargetKey: string | null = null;
	#portalSceneActivation: PortalSceneActivation | null = null;
	#portalDestinationFrame: PortalDestinationFrame | null = null;
	readonly #portalTransition = new PortalTransitionController(
		CLIENT_TUNING.portalTransition.timing,
	);
	#hasRenderedFrame = false;
	#renderedFrameCount = 0;
	#lastCameraResidency: ClientGameplayPresentationDiagnostics["cameraResidency"] =
		null;
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
	#cameraTarget: ClientCameraTarget | null = null;
	#cameraProjection: ProjectionClearanceRevision | null = null;
	#cameraSynchronization: Promise<void> = Promise.resolve();
	/** Exact camera/extent pair used by the most recently presented frame. */
	#lastPrimaryView: PrimaryCameraView | null = null;
	#selectedEntityGuid: number | null = null;
	/** Retained across gameplay initialization, like selected identity. */
	#hoveredEntityGuid: number | null = null;

	constructor(dependencies: ClientGameplayPresentationDependencies) {
		this.#session = dependencies.session;
		this.#onSceneMembership = dependencies.onSceneMembership;
		this.#onWeatherPresets = dependencies.onWeatherPresets;
		this.#onEnvironmentIssue = dependencies.onEnvironmentIssue;
		this.#canvas = dependencies.canvas;
		this.#onError = dependencies.onError ?? (() => undefined);
		this.#resources = dependencies.resources;
		const cameraSession = new ClientCameraSession(this.#session);
		this.camera = new PossessionCameraController({
			initialLook: {
				pitchRadians: CLIENT_TUNING.camera.pitchRadians,
				yawRadians: 0,
			},
			orbit: CLIENT_TUNING.camera.orbit,
			recenter: CLIENT_TUNING.camera.recenter,
			session: cameraSession,
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
		return this.#environmentSources?.server.readout() ?? null;
	}

	/** Replace only the local presentation binding; the server source and runtime survive. */
	setEnvironmentOverrides(overrides: ClientEnvironmentOverrides): void {
		this.#environmentOverrides = overrides;
		this.#bindEnvironment();
		this.#applyEnvironment();
	}

	/** Pull one coherent radar frame from the same presentation facts the world scene draws. */
	readMinimapFrame(): MinimapFrame {
		const resources = this.#activeResources;
		const playerGuid = this.#playerGuid;
		const placement =
			resources === null || playerGuid === null
				? null
				: resources.runtime.spawnedEntityPlacement(playerGuid);
		return {
			surfaceMapEligible:
				resources !== null &&
				placement !== null &&
				resources.runtime
					.sceneInterestMembership()
					.surfaceMapEligible(placement) === true,
			waypoint: null,
			cameraFovRadians:
				((this.#lastPrimaryView?.camera.fov ?? this.#fieldOfView) * Math.PI) /
				180,
			cameraHeadingRadians: this.camera.desiredLook().yawRadians,
			presentedEntities: () =>
				resources?.runtime.listPresentedSpawnedEntities() ?? [],
			selectedGuid: this.#selectedEntityGuid,
			source: resources?.runtime ?? null,
			subject:
				placement === null || playerGuid === null
					? null
					: {
							anchor: mapAnchorFromPlacement(placement),
							guid: playerGuid,
							kind: "controlled-entity",
						},
		};
	}

	/** Sample diagnostic poses on demand without publishing frame-hot data through Svelte. */
	readLocationReport(): string {
		const player =
			this.#playerGuid === null
				? null
				: this.#authoritativePlayer(this.#playerGuid);
		if (player === null || player.placement.kind !== "world")
			throw new Error("Player location is unavailable.");
		if (this.#status.kind !== "ready" || this.#lastPrimaryView === null)
			throw new Error("Presented camera location is unavailable.");
		return formatClientLocation(
			player.placement.pose,
			this.#lastPrimaryView.camera.placement,
		);
	}

	/** Forward the cold identity level once; presentation resolves realization and pose per frame. */
	setSelectedEntityGuid(guid: number | null): void {
		this.#selectedEntityGuid = guid;
		this.#activeResources?.runtime.setSelectedEntityGuid(guid);
	}

	/** Pull the combat bound and presented camera without publishing frame-hot UI state. */
	readCombatTargetFrame(): ClientCombatTargetFrame | null {
		const view = this.#lastPrimaryView;
		const { spellCastTarget, combat } = this.#session.state();
		// A pending non-self cast takes presentation priority without changing auto-attack intent.
		const engagement =
			spellCastTarget !== null
				? { target: spellCastTarget, combatType: "magic" as const }
				: combat.desired === null
					? null
					: {
							target: combat.desired.target,
							combatType: combat.desired.profile.kind,
						};
		const state =
			engagement === null
				? null
				: this.#activeResources?.runtime.dynamicEntityPresentationState(
						engagement.target,
					);
		if (view === null || engagement === null || state?.kind !== "realized")
			return null;
		const projection = projectClientCombatTarget({
			tuning: CLIENT_TUNING.combatTargetIndicator,
			bounds: state.frame.localBounds,
			placement: state.frame.placement,
			view,
			cssWidth: this.#canvas.clientWidth,
			cssHeight: this.#canvas.clientHeight,
		});
		return projection === null
			? null
			: { ...projection, combatType: engagement.combatType };
	}

	setHoveredEntityGuid(guid: number | null): void {
		this.#hoveredEntityGuid = guid;
		this.#activeResources?.runtime.setHoveredEntityGuid(guid);
	}

	/** Read one coherent residency and camera-distance fact for app-local selection policy. */
	selectedEntityTrackingStatus(
		guid: number,
	): ClientSelectedEntityTrackingStatus {
		const view = this.#lastPrimaryView;
		const state =
			this.#activeResources?.runtime.dynamicEntityPresentationState(guid);
		if (state?.kind === "frontend-evicted") return state;
		if (view === null || state?.kind !== "realized")
			return { kind: "temporarily-unrealized" };
		return {
			distance: clientSelectedEntityDistance(view, state.frame),
			kind: "tracked",
		};
	}

	/** Project the exact current selected bound through the exact primary view last presented. */
	readTargetIndicatorFrame(): ClientTargetIndicatorFrame | null {
		const view = this.#lastPrimaryView;
		const state =
			this.#selectedEntityGuid === null
				? null
				: (this.#activeResources?.runtime.dynamicEntityPresentationState(
						this.#selectedEntityGuid,
					) ?? null);
		const selected = state?.kind === "realized" ? state.frame : null;
		const cssWidth = this.#canvas.clientWidth;
		const cssHeight = this.#canvas.clientHeight;
		if (view === null || selected === null || cssWidth <= 0 || cssHeight <= 0) {
			return null;
		}
		return projectClientTargetIndicator({
			bounds: selected.localBounds,
			cssHeight,
			cssWidth,
			placement: selected.placement,
			tuning: CLIENT_TUNING.entitySelection.offscreenIndicator,
			view,
		});
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
			cameraResidency: this.#lastCameraResidency,
			cameraStatus: this.camera.status(),
			renderedFrameCount: this.#renderedFrameCount,
			viewport: {
				cssWidth: this.#canvas.clientWidth,
				cssHeight: this.#canvas.clientHeight,
				drawingBufferWidth: this.#canvas.width,
				drawingBufferHeight: this.#canvas.height,
			},
			tickProfile: resources?.runtime.getTickProfile?.() ?? null,
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

	/** Enable the existing renderer phase clocks for an explicit live-client investigation. */
	setRendererFrameProfilingEnabled(enabled: boolean): void {
		const runtime = this.#activeResources?.runtime;
		if (runtime === undefined)
			throw new Error("Client presentation is unavailable.");
		if (runtime.setRendererFrameProfilingEnabled === undefined) {
			throw new Error("Client renderer profiling is unavailable.");
		}
		runtime.setRendererFrameProfilingEnabled(enabled);
	}

	/** Reset the active renderer window immediately before a bounded measurement. */
	resetRendererFrameProfile(): void {
		this.#activeResources?.runtime.resetRendererFrameProfile?.();
	}

	/** Borrow the primary camera last presented; no portal-clipped views enter targeting. */
	targetingView(): PrimaryCameraView | null {
		return this.camera.status().kind === "active"
			? this.#lastPrimaryView
			: null;
	}

	/** Sample host-query and exact-render rays from the exact camera and viewport last presented. */
	samplePresentedCameraRay(
		clientX: number,
		clientY: number,
	): ClientPresentedCameraRay | null {
		const view = this.#lastPrimaryView;
		const cameraStatus = this.camera.status();
		if (view === null || cameraStatus.kind !== "active") return null;
		const bounds = this.#canvas.getBoundingClientRect();
		if (bounds.width <= 0 || bounds.height <= 0) return null;
		const normalizedX = ((clientX - bounds.left) / bounds.width) * 2 - 1;
		const normalizedY = 1 - ((clientY - bounds.top) / bounds.height) * 2;
		if (!Number.isFinite(normalizedX) || !Number.isFinite(normalizedY))
			return null;
		const tangent = Math.tan((view.camera.fov * Math.PI) / 360);
		const aspect = view.extent.width / view.extent.height;
		const localDirection = new Vec3(
			normalizedX * tangent * aspect,
			normalizedY * tangent,
			-1,
		);
		const localLength = Math.hypot(
			localDirection.x,
			localDirection.y,
			localDirection.z,
		);
		const renderDirection = rotateRenderVector(
			new Vec3(
				localDirection.x / localLength,
				localDirection.y / localLength,
				localDirection.z / localLength,
			),
			view.camera.placement.rotation,
		);
		const acDirection = renderVectorToAc(
			renderVector3([renderDirection.x, renderDirection.y, renderDirection.z]),
		);
		const landblockOrigin = createLandblockWorldOrigin(
			view.camera.placement.landblockId,
		);
		const acStart = renderVectorToAc(
			renderVector3([
				view.camera.placement.position.x - landblockOrigin.x,
				view.camera.placement.position.y - landblockOrigin.y,
				view.camera.placement.position.z - landblockOrigin.z,
			]),
		);
		return {
			query: {
				camera: cameraStatus.identity,
				anchor: parseCellId(view.camera.placement.landblockId),
				start: landblockVector3(acStart),
				direction: acDirection,
				previousCell:
					view.camera.placement.envCellId === null
						? null
						: parseCellId(view.camera.placement.envCellId),
			},
			refinement: {
				direction: renderDirection,
				start: view.camera.placement.position.clone(),
			},
		};
	}

	/** Preserve precise-jump's established host contract through the shared camera sampler. */
	samplePreciseJumpRay(
		clientX: number,
		clientY: number,
	): ClientPreciseJumpRay | null {
		const sampled = this.samplePresentedCameraRay(clientX, clientY);
		return sampled === null
			? null
			: {
					...sampled.query,
					maximumDistance: CLIENT_TUNING.preciseJump.maximumAimDistance,
				};
	}

	/** Refine a host candidate set against current posed browser geometry. */
	refineEntitySelection(
		ray: PresentedSelectionRay,
		candidateGuids: readonly number[],
		staticLimitDistance: number,
	): EntitySelectionRefinement {
		const runtime = this.#activeResources?.runtime;
		return runtime === undefined
			? {
					complete: false,
					distance: null,
					selectedGuid: null,
				}
			: refineEntitySelectionCandidates(
					runtime,
					ray,
					candidateGuids,
					staticLimitDistance,
				);
	}

	/** Publish one accepted atomic marker and optional reachable trajectory. */
	setPreciseJumpPresentation(snapshot: ClientPreciseJumpSnapshot): void {
		if (snapshot.active) {
			this.#canvas.dataset.preciseJump = "active";
		} else {
			delete this.#canvas.dataset.preciseJump;
			this.#preciseJumpMarker = null;
		}
		const evaluation = snapshot.marker;
		const runtime = this.#activeResources?.runtime;
		if (runtime === undefined) return;
		if (!snapshot.active) {
			runtime.setWorldIndicator(null);
			return;
		}
		if (evaluation === null) {
			// Pending input has already lost launch authority. Preserve only its last
			// picked location, with neutral animation and no old trajectory.
			const previous = this.#preciseJumpMarker;
			runtime.setWorldIndicator(
				previous === null
					? null
					: {
							marker: {
								...previous,
								pending: true,
								color: preciseJumpMarkerColor("neutral"),
							},
						},
			);
			return;
		}
		if (!("launch" in evaluation)) {
			this.#preciseJumpMarker = null;
			runtime.setWorldIndicator(null);
			return;
		}
		if (snapshot.refreshing) {
			const previous = this.#preciseJumpMarker;
			runtime.setWorldIndicator(
				previous === null
					? null
					: {
							marker: {
								...previous,
								pending: true,
								color: preciseJumpMarkerColor("neutral"),
							},
						},
			);
			return;
		}
		const launch = evaluation.launch;
		const target = launch.target;
		const neutral = preciseJumpMarkerColor("neutral");
		const success =
			evaluation.phase === "completed" &&
			evaluation.status === "predicted" &&
			evaluation.flight.outcome.kind === "landed" &&
			evaluation.flight.outcome.matchesTarget;
		const pending = evaluation.phase === "launch-resolved";
		const worldPosition = (anchor: number, point: LandblockVector3) => {
			const landblockId = normalizeLandblockOwner(
				`0x${anchor.toString(16).padStart(8, "0")}`,
			);
			const origin = createLandblockWorldOrigin(landblockId);
			const local = acVectorToRender(acVector3(point));
			return sceneVec3(origin.add(new Vec3(local[0], local[1], local[2])));
		};
		const scope = (cell: number | null) =>
			cell === null ? "outdoor" : `0x${cell.toString(16).padStart(8, "0")}`;
		const renderNormal = (normal: readonly [number, number, number]) => {
			const vector = acVectorToRender(acVector3(normal));
			return sceneVector3([vector[0], vector[1], vector[2]]);
		};
		const marker: WorldIndicatorInput["marker"] = {
			shape: "target",
			pending,
			color: success ? preciseJumpMarkerColor("success") : neutral,
			normal: renderNormal(target.normal),
			position: worldPosition(target.anchor, target.point),
			radius: CLIENT_TUNING.preciseJump.markerRadius,
			renderScopeKey: scope(target.committedCell),
		};
		this.#preciseJumpMarker = marker;
		const curve = (
			input: typeof launch.preview.curve,
			color: readonly [number, number, number, number],
		): WorldCurveTrajectoryInput => {
			const velocity = acVectorToRender(acVector3(input.velocity));
			const acceleration = acVectorToRender(acVector3(input.acceleration));
			return {
				kind: "curve",
				style: "dashed",
				revision: evaluation.sequence,
				color,
				origin: worldPosition(input.anchor, input.origin),
				velocity: [velocity[0], velocity[1], velocity[2]],
				acceleration: [acceleration[0], acceleration[1], acceleration[2]],
				durationSeconds: input.durationSeconds,
				placements: input.placements.map((p) => ({
					startFraction: p.startFraction,
					endFraction: p.endFraction,
					renderScopeKey: scope(p.committedCell),
				})),
			};
		};
		if (
			evaluation.phase === "completed" &&
			evaluation.status === "prediction-failed"
		) {
			runtime.setWorldIndicator({ marker });
			return;
		}
		const desiredTrajectory =
			launch.preview.kind === "below-height"
				? undefined
				: curve(launch.preview.curve, [0.62, 0.68, 0.75, 0.35]);
		if (evaluation.phase !== "completed" || evaluation.status !== "predicted") {
			runtime.setWorldIndicator({
				marker,
				desiredTrajectory,
				trajectory:
					launch.preview.kind === "below-height"
						? curve(launch.preview.curve, neutral)
						: undefined,
			});
			return;
		}
		const flight = evaluation.flight;
		const trajectory: WorldTrajectoryInput = {
			kind: "polyline",
			style: "solid",
			revision: evaluation.sequence,
			color: success ? preciseJumpMarkerColor("success") : neutral,
			segments: flight.segments.map((segment) => ({
				start: worldPosition(flight.anchor, segment.start),
				end: worldPosition(flight.anchor, segment.end),
				renderScopeKey: scope(segment.committedCell),
			})),
		};
		const outcome = flight.outcome;
		const landingMarker: WorldIndicatorInput["landingMarker"] =
			outcome.kind === "landed" && !outcome.matchesTarget
				? {
						shape: "miss",
						pending: false,
						color: preciseJumpMarkerColor("miss"),
						normal: renderNormal(outcome.normal),
						position: worldPosition(flight.anchor, outcome.contactPoint),
						radius: CLIENT_TUNING.preciseJump.markerRadius,
						renderScopeKey: scope(outcome.committedCell),
					}
				: undefined;
		runtime.setWorldIndicator({
			marker,
			desiredTrajectory,
			trajectory,
			landingMarker,
		});
	}

	/** Apply gameplay effect appearance when attached and when preferences change. */
	setCombatEffectsAppearance(appearance: CombatEffectsAppearance): void {
		this.#combatEffectsTuning = { ...this.#combatEffectsTuning, ...appearance };
		this.#activeResources?.runtime.setCombatEffectsAppearance(appearance);
	}

	refreshCombatEffectsFontAtlas(): void {
		this.#activeResources?.runtime.refreshCombatEffectsFontAtlas();
	}

	/** Reissue static demand on the next frame even if the player has not moved. */
	setSceneInterestRadii(radii: SceneInterestRadii): void {
		validateSceneInterestRadiiOrThrow(radii);
		if (
			this.#sceneInterestRadii.terrainRadius === radii.terrainRadius &&
			this.#sceneInterestRadii.buildingRadius === radii.buildingRadius &&
			this.#sceneInterestRadii.explicitObjectRadius ===
				radii.explicitObjectRadius &&
			this.#sceneInterestRadii.generatedObjectRadius ===
				radii.generatedObjectRadius &&
			this.#sceneInterestRadii.envCellRadius === radii.envCellRadius
		)
			return;
		this.#sceneInterestRadii = radii;
		this.#sceneInterestRevision += 1;
	}

	/** The host acknowledges a projection revision before the new FOV becomes visible. */
	setFieldOfView(degrees: number): void {
		if (
			!Number.isFinite(degrees) ||
			degrees < CLIENT_GRAPHICS_RANGES.verticalFovDegrees.minimum ||
			degrees > CLIENT_GRAPHICS_RANGES.verticalFovDegrees.maximum
		)
			throw new Error(
				"Client vertical field of view is outside the configurable range.",
			);
		if (this.#portalTransition.activeGeneration() !== null)
			this.#pendingFieldOfView = degrees;
		else this.#fieldOfView = degrees;
	}

	/**
	 * Tick and render one browser frame.
	 *
	 * The authoritative entity selects residency and the interpolated scene origin selects the
	 * camera eye. If visual realization or EnvCell topology is not ready, the frame is held rather
	 * than inventing a free-fly camera.
	 */
	frame(timeMs: number): ClientGameplayPresentationFrame {
		const resources = this.#activeResources;
		const playerGuid = this.#playerGuid;
		if (this.#destroyed || resources === null) {
			return { rendered: false, status: this.#status };
		}
		resources.runtime.advanceCombatEffects(timeMs);
		if (this.#terminalPresentationError !== null) {
			this.#setStatus("error", this.#terminalPresentationError);
			return { rendered: false, status: this.#status };
		}
		if (timeMs - this.#lastEnvironmentAtMs >= CLIENT_ENVIRONMENT_INTERVAL_MS)
			this.#refreshEnvironment(timeMs);
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
			this.#ensurePortalTransition(resources, lifecycle);
		}
		const portalGeneration = this.#portalTransition.activeGeneration();
		if (portal) {
			resources.runtime.pollPortalTransitionLoading();
		}
		if (playerGuid === null) {
			this.#setStatus(
				"loading-player",
				"Waiting for the server to establish local-player identity.",
			);
			return portal
				? this.#renderPortalLoadingFrame(resources, timeMs)
				: { rendered: false, status: this.#status };
		}
		if (lifecycle.kind === "entering-world") {
			this.#setStatus(
				"loading-player",
				"Local-player identity is established, but authority has not entered portal space.",
			);
			return portal
				? this.#renderPortalLoadingFrame(resources, timeMs)
				: { rendered: false, status: this.#status };
		}
		const player = this.#authoritativePlayer(playerGuid);
		if (player === null) {
			resources.runtime.setViewerEntity(null);
			this.#clearSceneDemand(resources);
			this.#setStatus(
				"loading-player",
				`Local player 0x${playerGuid.toString(16).padStart(8, "0")} is absent from the authoritative dynamic mirror.`,
			);
			return portal
				? this.#renderPortalLoadingFrame(resources, timeMs)
				: { rendered: false, status: this.#status };
		}
		if (player.placement.kind !== "world") {
			resources.runtime.setViewerEntity(null);
			this.#clearSceneDemand(resources);
			this.#setStatus(
				"loading-player",
				`Local player has ${player.placement.kind} placement instead of world placement.`,
			);
			return portal
				? this.#renderPortalLoadingFrame(resources, timeMs)
				: { rendered: false, status: this.#status };
		}
		if (portal) {
			if (portalGeneration === null) {
				throw new Error(
					"Portal presentation is active without a generation-owned transition.",
				);
			}
			this.#syncSceneActivation(player, portalGeneration);
		} else {
			this.#portalTransition.reset();
			if (this.#pendingFieldOfView !== null) {
				this.#fieldOfView = this.#pendingFieldOfView;
				this.#pendingFieldOfView = null;
			}
			resources.runtime.setPortalTransition(undefined);
			if (this.#portalSceneActivation?.kind === "accepted") {
				resources.runtime.completeSceneActivation(
					this.#portalSceneActivation.generation,
				);
			}
			this.#portalSceneActivation = null;
			this.#syncSceneInterest(player);
		}
		resources.runtime.setViewerEntity(playerGuid);
		if (!portal) resources.runtime.tick();
		let primaryView: PrimaryCameraView;
		if (portal) {
			if (portalGeneration === null) {
				throw new Error(
					"Portal destination rendering requires an active generation.",
				);
			}
			const destinationFrame =
				this.#portalDestinationFrame?.generation === portalGeneration
					? this.#portalDestinationFrame
					: null;
			if (destinationFrame !== null) {
				primaryView = destinationFrame.primaryView;
			} else {
				const readiness = this.#portalDestinationReadiness(
					resources,
					player,
					playerGuid,
					timeMs,
				);
				if (readiness.kind === "failed") {
					return this.#failPortalPresentation(resources, readiness.diagnostic);
				}
				if (readiness.kind === "waiting") {
					this.#setStatus(readiness.status, readiness.diagnostic);
					return this.#renderPortalLoadingFrame(resources, timeMs);
				}
				const camera = createClientCamera(
					player,
					readiness.origin,
					readiness.cameraPresentation,
					this.camera.acknowledgedProjection(timeMs),
					this.#fieldOfView,
				);
				primaryView = { camera, extent: readiness.extent };
				this.#portalDestinationFrame = {
					generation: portalGeneration,
					primaryView,
				};
			}
			const plan = this.#publishPortalTransition(resources, timeMs, true);
			if (plan.kind === "origin-to-tunnel" || plan.kind === "tunnel-only") {
				this.#setStatus("loading-activation");
				return this.#renderPortalLoadingFrame(resources, timeMs, false);
			}
		} else {
			this.#portalDestinationFrame = null;
			const resolvedOrigin = resources.runtime.dynamicEntityOrigin(playerGuid);
			if (resolvedOrigin === null) {
				this.#setStatus(
					"loading-player",
					"The authoritative local player has no installed runtime presentation.",
				);
				return { rendered: false, status: this.#status };
			}
			if (
				resolvedOrigin.envCellId !== null &&
				!resources.runtime.hasEnvCellScope(resolvedOrigin)
			) {
				this.#setStatus("loading-activation");
				return { rendered: false, status: this.#status };
			}
			const extent = resources.runtime.resolveViewportExtent(
				this.#canvas.clientWidth,
				this.#canvas.clientHeight,
			);
			const projection = this.#resolveCameraProjection(extent);
			this.#ensureCamera(player, projection);
			const facingYaw = createEntityFacingCameraYaw(
				player.placement.pose.rotation,
			);
			this.#cameraSynchronization = this.#cameraSynchronization
				.then(() => {
					if (!this.#destroyed)
						return this.camera.synchronize(projection, timeMs, facingYaw);
				})
				.catch((error: unknown) => this.#reportError(error));
			const presentation = this.camera.presentation(timeMs);
			if (presentation === null) {
				const cameraStatus = this.camera.status();
				this.#setStatus(
					cameraStatus.kind === "awaiting-first-path"
						? "loading-activation"
						: "loading-player",
					clientCameraWaitDiagnostic(cameraStatus),
				);
				return { rendered: false, status: this.#status };
			}
			const camera = createClientCamera(
				player,
				resolvedOrigin,
				presentation,
				this.camera.acknowledgedProjection(timeMs),
				this.#fieldOfView,
			);
			primaryView = { camera, extent };
		}
		const { camera } = primaryView;
		if (
			this.#lastCameraResidency?.landblockId !== camera.placement.landblockId ||
			this.#lastCameraResidency.envCellId !== camera.placement.envCellId
		) {
			this.#lastCameraResidency = {
				landblockId: camera.placement.landblockId,
				envCellId: camera.placement.envCellId,
			};
		}
		resources.runtime.setPrimaryView(primaryView);
		this.#lastPrimaryView = primaryView;
		if (!portal) resources.runtime.setAudioListener(audioListenerFor(camera));
		const transitionReceipt = resources.runtime.render(timeMs / 1_000);
		this.#hasRenderedFrame = true;
		this.#renderedFrameCount += 1;
		this.#setStatus("ready");
		if (portal && this.#portalSceneActivation?.kind === "accepted") {
			const sceneActivation = this.#portalSceneActivation;
			const generation = sceneActivation.generation;
			const reveal = this.#acknowledgePortalPresentation(transitionReceipt);
			if (reveal !== null && !sceneActivation.revealAcknowledged) {
				this.#portalSceneActivation = {
					...sceneActivation,
					revealAcknowledged: true,
				};
				void this.#session
					.acknowledgeWorldReveal(generation)
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
		delete this.#canvas.dataset.preciseJump;
		this.#preciseJumpMarker = null;
		this.#destroyed = true;
		this.#lifetime.abort(abortError("Gameplay presentation retired."));
		this.#cameraTarget = null;
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
		this.#unsubscribe?.();
		this.#unsubscribe = null;
		this.#sceneInterestCoordinator?.invalidate();
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
				if (failed.length)
					throw new AggregateError(
						failed.map((result) => result.reason),
						"Gameplay work retirement failed.",
					);
			}),
		);
		await attempt("camera-synchronization", () => this.#cameraSynchronization);
		await attempt("camera-destroy", () => this.camera.destroy());
		this.#sceneInterestCoordinator = null;
		// Startup failure belongs to start()/onError; it must not prevent later scene retry.
		if (this.#startPromise !== null)
			await Promise.allSettled([this.#startPromise]);
		const resources = this.#activeResources;
		this.#activeResources = null;
		this.#onSceneMembership?.(null);
		this.#environmentSources = null;
		this.#onWeatherPresets?.([]);
		this.#onEnvironmentIssue?.(null);
		if (resources !== null) {
			resources.runtime.clearDynamicEntityCues();
			resources.runtime.clearCombatEffects();
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
			this.#onSceneMembership?.(resources.runtime.sceneInterestMembership());
			const server = createClientServerEnvironmentSource(
				resources.activeRegion,
				(timeMs) => this.#session.readServerTime(timeMs),
			);
			this.#environmentSources = { server, presentation: server };
			this.#onWeatherPresets?.(clientWeatherPresets(resources.activeRegion));
			this.#bindEnvironment();
			resources.runtime.setSelectedEntityGuid(this.#selectedEntityGuid);
			resources.runtime.setHoveredEntityGuid(this.#hoveredEntityGuid);
			this.#reconcileEntityNameplates();
			this.#sceneInterestCoordinator = new SceneInterestRequestCoordinator(
				resources.profileSource,
			);
			const lifecycle = this.#session.state().lifecycle;
			if (
				lifecycle?.kind !== "entering-world" &&
				lifecycle?.kind !== "in-world" &&
				lifecycle?.kind !== "portal-space"
			) {
				this.#activeResources = null;
				this.#onSceneMembership?.(null);
				this.#environmentSources = null;
				this.#onWeatherPresets?.([]);
				this.#onEnvironmentIssue?.(null);
				this.#status = { kind: "stopped", diagnostic: null };
				return;
			}
			this.#refreshEnvironment(performance.now());
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
			case "combat-outcome":
				if (
					this.#session.mirror.isAwaitingSnapshot() ||
					event.outcome.worldGeneration !==
						this.#session.state().worldGeneration
				) {
					return;
				}
				this.#activeResources?.runtime.acceptCombatOutcome(
					event.outcome.outcome,
					event.outcome.attribution.kind === "attributed"
						? event.outcome.attribution.target
						: null,
					this.#combatEffectsTuning,
					event.receivedAtMs,
				);
				return;
			case "resyncing":
				this.#activeResources?.runtime.clearCombatEffects();
				return;
			case "current-state":
				this.#receiveCurrentState(event.state);
				this.#reconcileEntityNameplates();
				return;
			case "entities":
				this.#reconcileEntityNameplates();
				return;
			case "lifecycle":
				return;
			case "local-player-established":
				this.#playerGuid = event.identity.playerGuid;
				return;
			case "presentation-tick":
				if (event.tick.dynamic !== null)
					this.#receiveDynamic(
						{ kind: "ticked", batch: event.tick.dynamic },
						event.receivedAtMs,
					);
				return;
			case "dynamic":
				this.#receiveDynamic(event.event, performance.now());
				return;
			case "dynamic-sound-cue":
				this.#deliverEntityCue({
					kind: "sound",
					worldGeneration: event.cue.worldGeneration,
					receivedAtMs: performance.now(),
					cue: event.cue,
				});
				return;
			case "dynamic-script-cue":
				this.#deliverEntityCue({
					kind: "script",
					worldGeneration: this.#session.state().worldGeneration,
					cue: event.cue,
				});
				return;
			case "server-time":
				this.#refreshEnvironment(performance.now());
				return;
			case "presentation-discontinuity":
				this.#receivePresentationDiscontinuity(event.discontinuity);
				return;
			case "exit-requested":
				// Session outcomes belong to ClientApp; ending authority is not a renderer failure.
				this.#setStatus("stopped", event.exit.diagnostic);
				return;
		}
	}

	#receiveCurrentState(state: ClientCurrentState): void {
		this.#playerGuid = state.localPlayerGuid;
		this.#refreshEnvironment(performance.now());
	}

	#receiveDynamic(event: DynamicEntityEvent, receivedAtMs: number): void {
		switch (event.kind) {
			case "ticked": {
				if (this.#session.mirror.isAwaitingSnapshot()) {
					this.#setStatus("awaiting-snapshot");
					return;
				}
				const activation = this.#portalSceneActivation;
				const retryDeferred =
					activation?.kind === "accepted" &&
					activation.realization === "deferred" &&
					activation.realizedPlayerPlacementKey !==
						this.#authoritativePlayerConvergenceKey();
				if (retryDeferred) {
					this.#portalSceneActivation = {
						...activation,
						realization: "idle",
					};
				}
				if (this.#activeResources !== null) {
					this.#activeResources.runtime.applyDynamicEntityTick(
						event.batch,
						receivedAtMs,
					);
				}
				if (retryDeferred) this.#ensureScenePresentationConvergence();
				return;
			}
			case "snapshot":
				this.#invalidatePlayerPresentationConvergence();
				this.#observePresentationCompletion(
					this.#requestDynamicSnapshotReplacement(event.snapshot.entities),
				);
				this.#reconcileEntityNameplates();
				return;
			case "upserted":
				if (event.entity.identity.guid === this.#playerGuid)
					this.#invalidatePlayerPresentationConvergence();
				if (this.#activeResources !== null) {
					this.#observePresentationCompletion(
						this.#activeResources.runtime.upsertDynamicEntity(event.entity),
					);
				}
				this.#reconcileEntityNameplate(event.entity.identity.guid);
				return;
			case "removed":
				if (event.guid === this.#playerGuid)
					this.#invalidatePlayerPresentationConvergence();
				this.#activeResources?.runtime.removeDynamicEntity(
					event.guid,
					event.generation,
				);
				return;
		}
	}

	/** Reconcile a complete semantic baseline, including decorations that were cleared. */
	#reconcileEntityNameplates(): void {
		for (const dynamic of this.#session.mirror.currentEntities())
			this.#reconcileEntityNameplate(dynamic.identity.guid);
	}

	/** Project semantic corpse history into app-local decoration without copying display facts. */
	#reconcileEntityNameplate(guid: number): void {
		const runtime = this.#activeResources?.runtime;
		const entities = this.#session.entities.read();
		if (runtime === undefined || entities.kind !== "current") return;
		const opened = entities.level.entities.get(guid)?.corpse === "opened";
		runtime.setDynamicEntityNameplateDecoration(guid, {
			indicators: [],
			strikeThrough: opened,
		});
	}

	#deliverEntityCue(pending: GameplayPresentationCue): void {
		if (
			this.#destroyed ||
			pending.worldGeneration !== this.#session.state().worldGeneration
		)
			return;
		const runtime = this.#activeResources?.runtime;
		if (runtime === undefined) return;
		if (pending.kind === "script")
			runtime.playDynamicEntityScriptCue(pending.cue);
		else runtime.playDynamicEntitySoundCue(pending.cue, pending.receivedAtMs);
	}

	#receivePresentationDiscontinuity(
		discontinuity: ClientPresentationDiscontinuity,
	): void {
		this.#activeResources?.runtime.clearCombatEffects();
		void this.camera.stop().catch((error: unknown) => this.#reportError(error));
		this.#cameraTarget = null;
		this.#cameraProjection = null;
		this.#sceneTargetKey = null;
		this.#portalSceneActivation = null;
		this.#portalDestinationFrame = null;
		this.#portalTransition.reset();
		this.#hasRenderedFrame = false;
		this.#lastPrimaryView = null;
		this.#sceneInterestCoordinator?.invalidate();
		this.#activeResources?.runtime.clearSceneInterest();
		// The host's next reset/teleport batch owns placement invalidation. This edge only drops
		// frontend demand/camera history; no canonical pose is manufactured here.
		this.#activeResources?.runtime.clearDynamicEntityCues();
		void discontinuity;
	}

	/** Start one generation-keyed portal presentation edge and choose outgoing capture policy. */
	#ensurePortalTransition(
		resources: ClientGameplayPresentationResources,
		lifecycle: Extract<ClientLifecycle, { kind: "portal-space" }>,
	): void {
		const generation = this.#portalTransition.activeGeneration();
		if (generation === lifecycle.worldGeneration) return;
		if (this.#portalSceneActivation?.kind === "accepted") {
			resources.runtime.completeSceneActivation(
				this.#portalSceneActivation.generation,
			);
		}
		this.#portalSceneActivation = null;
		this.#portalDestinationFrame = null;
		resources.runtime.setAudioListener(null);
		// The core resets its camera at the same generation edge. Drop the frontend registration too
		// so the next seed is accepted even when the player instance itself was reused by the server.
		void this.camera.stop().catch((error: unknown) => this.#reportError(error));
		this.#cameraTarget = null;
		const origin =
			generation === null &&
			lifecycle.cause === "teleport" &&
			this.#hasRenderedFrame
				? { kind: "capture-last-world" as const }
				: { kind: "absent" as const };
		this.#portalTransition.begin(lifecycle.worldGeneration, origin);
		resources.runtime.playPortalTransitionSound?.("enter");
	}

	/** Advance the presentation state before a portal frame; waiting has no timeout. */
	#publishPortalTransition(
		resources: ClientGameplayPresentationResources,
		nowMs: number,
		destinationReady: boolean,
	): PortalTransitionPresentationPlan {
		const update = this.#portalTransition.advance({ nowMs, destinationReady });
		if (update.audio !== undefined) {
			resources.runtime.playPortalTransitionSound?.(update.audio);
		}
		resources.runtime.setPortalTransition(update.plan);
		return update.plan;
	}

	#portalDestinationReadiness(
		resources: ClientGameplayPresentationResources,
		player: DynamicEntityView,
		playerGuid: number,
		timeMs: number,
	): PortalDestinationReadiness {
		const sceneActivation = this.#portalSceneActivation;
		if (sceneActivation?.kind !== "accepted") {
			return { kind: "waiting", status: "loading-activation" };
		}
		const activation = resources.runtime.sceneActivationStatus(
			sceneActivation.receipt,
		);
		if (activation.kind === "failed") {
			return { kind: "failed", diagnostic: activation.diagnostic };
		}
		if (activation.kind !== "ready") {
			return { kind: "waiting", status: "loading-activation" };
		}
		this.#ensureScenePresentationConvergence();
		const convergedActivation = this.#portalSceneActivation;
		if (convergedActivation?.kind !== "accepted") {
			return { kind: "waiting", status: "loading-activation" };
		}
		if (convergedActivation.realization !== "ready") {
			return { kind: "waiting", status: "loading-player" };
		}
		const origin = resources.runtime.dynamicEntityOrigin(playerGuid);
		if (origin === null) {
			return {
				kind: "waiting",
				status: "loading-player",
				diagnostic:
					"The authoritative local player has no installed runtime presentation.",
			};
		}
		if (
			origin.envCellId !== null &&
			!resources.runtime.hasEnvCellScope(origin)
		) {
			return { kind: "waiting", status: "loading-activation" };
		}
		const extent = resources.runtime.resolveViewportExtent(
			this.#canvas.clientWidth,
			this.#canvas.clientHeight,
		);
		const projection = this.#resolveCameraProjection(extent);
		this.#ensureCamera(player, projection);
		const cameraPresentation = this.camera.presentation(timeMs);
		const cameraStatus = this.camera.status();
		if (
			cameraPresentation === null ||
			cameraStatus.kind !== "active" ||
			cameraStatus.convergence !== "settled"
		) {
			return {
				kind: "waiting",
				status: "loading-activation",
				diagnostic: "Waiting for the destination boom camera to settle.",
			};
		}
		return { kind: "ready", origin, extent, cameraPresentation };
	}

	/** Present one portal-only frame while destination prerequisites remain unavailable. */
	#renderPortalLoadingFrame(
		resources: ClientGameplayPresentationResources,
		timeMs: number,
		advanceTransition = true,
	): ClientGameplayPresentationFrame {
		if (advanceTransition) {
			this.#publishPortalTransition(resources, timeMs, false);
		}
		const extent = resources.runtime.resolveViewportExtent(
			this.#canvas.clientWidth,
			this.#canvas.clientHeight,
		);
		const receipt = resources.runtime.renderPortalTransition(
			timeMs / 1_000,
			extent,
		);
		this.#acknowledgePortalPresentation(receipt);
		this.#hasRenderedFrame = true;
		this.#renderedFrameCount += 1;
		return { rendered: true, status: this.#status };
	}

	#acknowledgePortalPresentation(
		receipt: PortalTransitionPresentationReceipt | null,
	): PortalRevealReceipt | null {
		return receipt === null
			? null
			: this.#portalTransition.acknowledgePresented(receipt);
	}

	/** Retire every portal-owned presentation edge and latch the explicit black error surface. */
	#failPortalPresentation(
		resources: ClientGameplayPresentationResources,
		diagnostic: string,
	): ClientGameplayPresentationFrame {
		if (this.#portalSceneActivation?.kind === "accepted") {
			resources.runtime.completeSceneActivation(
				this.#portalSceneActivation.generation,
			);
		}
		this.#portalSceneActivation = null;
		this.#portalDestinationFrame = null;
		this.#portalTransition.reset();
		resources.runtime.setPortalTransition(undefined);
		resources.runtime.clearPresentation();
		this.#terminalPresentationError = diagnostic;
		this.#setStatus("error", diagnostic);
		return { rendered: false, status: this.#status };
	}

	#resolveCameraProjection(extent: RenderExtent): ProjectionClearanceRevision {
		const current = this.#cameraProjection;
		if (
			current !== null &&
			current.extent.width === extent.width &&
			current.extent.height === extent.height &&
			current.fov === this.#fieldOfView
		)
			return current;
		const projection = createProjectionClearanceRevision(
			(current?.revision ?? 0) + 1,
			{ fov: this.#fieldOfView, near: CLIENT_TUNING.camera.near },
			extent,
		);
		this.#cameraProjection = projection;
		return projection;
	}

	#ensureCamera(
		player: DynamicEntityView,
		projection: ProjectionClearanceRevision,
	): void {
		if (player.placement.kind !== "world") return;
		const target: ClientCameraTarget = {
			playerGuid: player.identity.guid,
			entityGeneration: player.generation,
		};
		if (
			this.#cameraTarget?.playerGuid === target.playerGuid &&
			this.#cameraTarget.entityGeneration === target.entityGeneration
		)
			return;
		this.#cameraTarget = target;
		this.camera.replaceLook({
			pitchRadians: CLIENT_TUNING.camera.pitchRadians,
			yawRadians: createEntityFacingCameraYaw(player.placement.pose.rotation),
		});
		void this.camera
			.start(target, CLIENT_TUNING.camera.distance, projection)
			.catch((error: unknown) => {
				if (this.#cameraTarget === target && !isAbortError(error))
					this.#reportError(error);
			});
	}

	#authoritativePlayer(guid: number): DynamicEntityView | null {
		return (
			this.#session.mirror
				.entities()
				.find((entity) => entity.identity.guid === guid) ?? null
		);
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

	async #requestDynamicEligibilityReevaluation(): Promise<void> {
		if (
			this.#activeResources === null ||
			this.#session.mirror.isAwaitingSnapshot()
		)
			return;
		const portalActivation = this.#portalSceneActivation;
		if (
			portalActivation?.kind !== "accepted" ||
			portalActivation.realization !== "pending" ||
			!this.#isCurrentPortalPresentation(portalActivation.generation)
		)
			return;
		const results =
			await this.#activeResources.runtime.reevaluateDynamicEntityEligibility();
		if (!this.#isCurrentPortalPresentation(portalActivation.generation)) return;
		const current = this.#portalSceneActivation;
		if (
			current?.kind !== "accepted" ||
			current.receipt !== portalActivation.receipt
		)
			return;
		const realization = this.#localPlayerInstalled(results)
			? "ready"
			: "deferred";
		this.#portalSceneActivation = {
			...current,
			realization,
		};
		if (
			realization === "deferred" &&
			current.realizedPlayerPlacementKey !==
				this.#authoritativePlayerConvergenceKey()
		) {
			this.#portalSceneActivation = {
				...this.#portalSceneActivation,
				realization: "idle",
			};
			this.#ensureScenePresentationConvergence();
		}
	}

	/** Force the exact local-player installation barrier to observe its latest desired level. */
	#invalidatePlayerPresentationConvergence(): void {
		const activation = this.#portalSceneActivation;
		if (activation?.kind !== "accepted") return;
		this.#portalSceneActivation = {
			...activation,
			realization: "idle",
			realizedPlayerPlacementKey: null,
		};
	}

	/** Begin normal dynamic eligibility only after the destination's static products are installed. */
	#ensureScenePresentationConvergence(): void {
		const activation = this.#portalSceneActivation;
		if (activation?.kind !== "accepted" || activation.realization !== "idle")
			return;
		this.#portalSceneActivation = {
			...activation,
			realization: "pending",
			realizedPlayerPlacementKey: this.#authoritativePlayerConvergenceKey(),
		};
		this.#observePresentationCompletion(
			this.#requestDynamicEligibilityReevaluation(),
		);
	}

	#localPlayerInstalled(results: DynamicEntityRealizationResults): boolean {
		return (
			this.#playerGuid !== null && results.get(this.#playerGuid) === "installed"
		);
	}

	#authoritativePlayerConvergenceKey(): string | null {
		return this.#playerGuid === null
			? null
			: playerPresentationConvergenceKey(
					this.#authoritativePlayer(this.#playerGuid),
				);
	}

	/** Observe asynchronous realization failures without ordering later accepted state behind them. */
	#observePresentationCompletion(completion: Promise<unknown>): void {
		const observed = awaitWithAbort(completion, this.#lifetime.signal)
			.then(() => undefined)
			.catch((error: unknown) => {
				if (!this.#destroyed || !isAbortError(error)) this.#reportError(error);
			});
		this.#pendingWork.add(observed);
		void observed.then(() => this.#pendingWork.delete(observed));
	}

	/** Resolve and install one exact destination before any portal frame is acknowledged. */
	#syncSceneActivation(
		player: DynamicEntityView,
		worldGeneration: number,
	): void {
		if (player.placement.kind !== "world") return;
		const target = clientSceneInterestTarget(player.placement);
		const key = `${worldGeneration}:${sceneInterestTargetKey(target)}`;
		if (this.#portalSceneActivation?.key === key) return;
		const coordinator = this.#sceneInterestCoordinator;
		const resources = this.#activeResources;
		if (coordinator === null || resources === null) return;
		if (this.#portalSceneActivation !== null) {
			// A later destination within the same authority generation supersedes any fade progress
			// earned by the provisional scene. Only the replacement may produce the reveal frame.
			this.#portalTransition.begin(worldGeneration, { kind: "absent" });
			this.#portalDestinationFrame = null;
		}
		if (this.#portalSceneActivation?.kind === "accepted") {
			resources.runtime.completeSceneActivation(
				this.#portalSceneActivation.generation,
			);
		}
		this.#portalSceneActivation = {
			kind: "requesting",
			generation: worldGeneration,
			key,
		};
		const request = coordinator.request(target, this.#sceneInterestRadii);
		void request.promise
			.then((resolved) => {
				if (
					this.#destroyed ||
					this.#activeResources !== resources ||
					!coordinator.isCurrent(request.revision)
				)
					return null;
				return resources.runtime.activateScene({
					generation: worldGeneration,
					target: resolved,
				});
			})
			.then((receipt) => {
				if (receipt === null) return;
				const current = this.#portalSceneActivation;
				if (
					this.#destroyed ||
					this.#activeResources !== resources ||
					!coordinator.isCurrent(request.revision) ||
					current?.kind !== "requesting" ||
					current.key !== key ||
					!this.#isCurrentPortalPresentation(worldGeneration)
				)
					return;
				this.#portalSceneActivation = {
					kind: "accepted",
					generation: worldGeneration,
					key,
					receipt,
					realization: "idle",
					realizedPlayerPlacementKey: null,
					revealAcknowledged: false,
				};
			})
			.catch((error: unknown) => {
				if (!this.#destroyed && coordinator.isCurrent(request.revision))
					this.#reportError(error);
			});
	}

	/** Whether one controller generation still owns the session's current presentation barrier. */
	#isCurrentPortalPresentation(generation: number): boolean {
		return (
			this.#portalTransition.activeGeneration() === generation &&
			this.#session.state().worldGeneration === generation
		);
	}

	#syncSceneInterest(player: DynamicEntityView): void {
		if (player.placement.kind !== "world") {
			this.#clearSceneDemand(this.#activeResources);
			return;
		}
		const target = clientSceneInterestTarget(player.placement);
		const key = `${this.#sceneInterestRevision}:${sceneInterestTargetKey(target)}`;
		if (key === this.#sceneTargetKey) return;
		const coordinator = this.#sceneInterestCoordinator;
		const resources = this.#activeResources;
		if (coordinator === null || resources === null) return;
		this.#sceneTargetKey = key;
		const request = coordinator.request(target, this.#sceneInterestRadii);
		void request.promise
			.then((resolved) => {
				if (
					this.#destroyed ||
					this.#activeResources !== resources ||
					!coordinator.isCurrent(request.revision) ||
					this.#sceneTargetKey !== key
				)
					return;
				resources.runtime.updateSceneInterest(resolved);
			})
			.catch((error: unknown) => {
				if (!this.#destroyed && coordinator.isCurrent(request.revision)) {
					this.#reportError(error);
				}
			});
	}

	#clearSceneDemand(
		resources: ClientGameplayPresentationResources | null,
	): void {
		if (this.#sceneTargetKey === null && this.#portalSceneActivation === null)
			return;
		this.#sceneTargetKey = null;
		if (
			resources !== null &&
			this.#portalSceneActivation?.kind === "accepted"
		) {
			resources.runtime.completeSceneActivation(
				this.#portalSceneActivation.generation,
			);
		}
		this.#portalSceneActivation = null;
		this.#portalDestinationFrame = null;
		this.#sceneInterestCoordinator?.invalidate();
		if (resources !== null) resources.runtime.clearSceneInterest();
	}

	#bindEnvironment(): void {
		const resources = this.#activeResources;
		const sources = this.#environmentSources;
		if (resources === null || sources === null) return;
		const binding = bindClientPresentationEnvironment(
			sources.server,
			resources.activeRegion,
			this.#environmentOverrides,
		);
		sources.presentation = binding.source;
		this.#onEnvironmentIssue?.(binding.issue);
	}

	#refreshEnvironment(timeMs: number): void {
		const resources = this.#activeResources;
		const sources = this.#environmentSources;
		if (resources === null || sources === null) return;
		sources.server.refresh(timeMs);
		this.#lastEnvironmentAtMs = timeMs;
		this.#applyEnvironment();
	}

	/** Renderer application is shared by cold binding changes and server-source refresh. */
	#applyEnvironment(): void {
		const resources = this.#activeResources;
		const sources = this.#environmentSources;
		if (resources === null || sources === null) return;
		const sample = sources.presentation.read();
		if (sample !== null)
			resources.runtime.setSceneEnvironment(sample.environment);
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
		this.#setStatus("error", errorMessage(error));
		this.#onError(error);
	}
}

function clientSceneInterestTarget(
	placement: DynamicEntityWorldPlacement,
): SceneInterestTarget {
	const cellId = placement.pose.landblockId >>> 0;
	const landblockId = normalizeLandblockOwner(
		datAssetId((cellId & 0xffff_0000) | 0xffff),
	);
	const envCellId = cellId & 0xffff;
	return envCellId >= 0x0100
		? {
				kind: "env-cell",
				landblockId,
				envCellId: datAssetId(cellId) as `0x${string}`,
			}
		: { kind: "automatic-landblock", landblockId };
}

function sceneInterestTargetKey(target: SceneInterestTarget): string {
	return target.kind === "env-cell"
		? `${target.kind}:${target.landblockId}:${target.envCellId}`
		: `${target.kind}:${target.landblockId}`;
}

/** Stable retry identity for player facts that can change dynamic scope eligibility. */
function playerPresentationConvergenceKey(
	player: DynamicEntityView | null,
): string | null {
	if (player?.placement.kind !== "world") return null;
	const membership = player.placement.spatialMembership;
	return [
		player.generation,
		player.placement.pose.landblockId,
		membership.reachesOutdoors ? "outdoor" : "interior",
		...membership.reachedEnvCellIds,
	].join(":");
}

/** Exact non-rendering camera prerequisite surfaced by the client instead of one vague wait. */
function clientCameraWaitDiagnostic(
	status: ReturnType<ClientGameplayPresentationCameraController["status"]>,
): string {
	switch (status.kind) {
		case "stopped":
			return "The local-player camera is stopped.";
		case "awaiting-registration":
			return "Waiting for local-player camera registration.";
		case "awaiting-first-path":
			return "Waiting for the first host-authored camera path.";
		case "active":
			return status.placementOutcome?.kind === "held"
				? `The camera withdrew its rendered path while held for ${status.placementOutcome.reason}.`
				: "The active camera has no renderable playback path.";
	}
}

function createClientCamera(
	player: DynamicEntityView,
	origin: ResolvedSceneOrigin,
	boom: HostKinematicBoomPresentation | null,
	projection: ProjectionClearanceRevision | null,
	requestedFieldOfView: number,
): Camera {
	if (player.placement.kind !== "world") {
		throw new Error("Client camera requires a world-placed player.");
	}
	const fallbackYaw = createEntityFacingCameraYaw(
		player.placement.pose.rotation,
	);
	const fallbackRotation = createCameraRotationRadians(
		fallbackYaw,
		CLIENT_TUNING.camera.pitchRadians,
	);
	if (boom !== null) {
		const look = resolveCameraLookAtAngles(
			new Vec3(
				boom.placement.position.x,
				boom.placement.position.y,
				boom.placement.position.z,
			),
			new Vec3(boom.visualPivot.x, boom.visualPivot.y, boom.visualPivot.z),
		);
		return {
			far: CLIENT_TUNING.camera.far,
			fov: projection?.fov ?? requestedFieldOfView,
			near: projection?.near ?? CLIENT_TUNING.camera.near,
			placement: {
				...boom.placement.residency,
				position: boom.placement.position,
				rotation:
					look === null
						? fallbackRotation
						: createCameraRotationRadians(look.yawRadians, look.pitchRadians),
			},
		};
	}
	const axes = createCameraAxesRadians(
		fallbackYaw,
		CLIENT_TUNING.camera.pitchRadians,
	);
	const originWorld = createLandblockWorldOrigin(origin.landblockId).add(
		origin.landblockOrigin,
	);
	const position = sceneVec3(
		new Vec3(
			originWorld.x - axes.forward.x * CLIENT_TUNING.camera.rearDistance,
			originWorld.y +
				CLIENT_TUNING.camera.height -
				axes.forward.y * CLIENT_TUNING.camera.rearDistance,
			originWorld.z - axes.forward.z * CLIENT_TUNING.camera.rearDistance,
		),
	);
	return {
		far: CLIENT_TUNING.camera.far,
		fov: projection?.fov ?? requestedFieldOfView,
		near: CLIENT_TUNING.camera.near,
		placement: {
			envCellId: origin.envCellId,
			landblockId: origin.landblockId,
			position,
			rotation: fallbackRotation,
		},
	};
}

function parseCellId(value: string): number {
	const parsed = Number.parseInt(
		value.startsWith("0x") ? value.slice(2) : value,
		16,
	);
	if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 0xffff_ffff)
		throw new Error(`Client camera placement has invalid cell id ${value}.`);
	return parsed;
}

function preciseJumpMarkerColor(
	status: "neutral" | "success" | "miss",
): readonly [number, number, number, number] {
	switch (status) {
		case "success":
			return [0.08, 0.48, 1, 0.9];
		case "miss":
			return [1, 0.12, 0.08, 0.9];
		default:
			return [0.62, 0.68, 0.75, 0.8];
	}
}

/** Convert the player's live scene placement into the world-space subject used by the radar. */
function mapAnchorFromPlacement(placement: ScenePlacement): MapAnchor {
	const origin = createLandblockWorldOrigin(placement.landblockId);
	return {
		headingRadians: mapHeadingFromSceneTransform(placement.localTransform),
		residency: {
			envCellId: placement.envCellId,
			landblockId: placement.landblockId,
		},
		worldX: origin.x + placement.localTransform.m41,
		worldY: origin.y + placement.localTransform.m42,
		worldZ: origin.z + placement.localTransform.m43,
	};
}

function audioListenerFor(camera: Camera): AudioListenerPlacement {
	return {
		envCellId: camera.placement.envCellId,
		position: sceneVector3([
			camera.placement.position.x,
			camera.placement.position.y,
			camera.placement.position.z,
		]),
		rotation: new Quat(
			camera.placement.rotation.w,
			camera.placement.rotation.x,
			camera.placement.rotation.y,
			camera.placement.rotation.z,
		),
	};
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : "Client presentation failed.";
}
