import {
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
import { CLIENT_TUNING } from "./client-tuning";
import { resolveDayFraction } from "../lib/game/environment/game-clock";
import {
	resolveSceneEnvironment,
	type ResolvedSceneEnvironment,
} from "../lib/game/environment/scene-environment";
import {
	createLandblockWorldOrigin,
	normalizeLandblockOwner,
} from "../lib/game/landblocks";
import {
	createCameraAxesRadians,
	createCameraRotationRadians,
	resolveCameraLookAtAngles,
	createEntityFacingCameraYaw,
} from "../lib/game/math/camera-orientation";
import { Quat, Vec3 } from "../lib/game/math/types";
import {
	GamePresentationOwner,
	type GamePresentationOwnerDependencies,
} from "../lib/game/runtime/game-presentation-owner";
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
import type {
	AudioListenerPlacement,
	Camera,
	PrimaryCameraView,
} from "../lib/game/runtime/types";
import type { ResolvedSceneOrigin } from "../lib/game/scene";
import type { RenderExtent } from "../lib/game/renderer/render-extent";
import type { HostTransport } from "../lib/host/host-transport";
import type {
	SceneActivationReceipt,
	SceneActivationRequest,
	SceneActivationStatus,
} from "../lib/game/runtime/scene-availability";
import type {
	ClientCurrentState,
	ClientCameraTick,
	ClientLifecycle,
	ClientPresentationDiscontinuity,
	ClientPreciseJumpEvaluation,
} from "./client-host-contract";
import type { ClientPreciseJumpRay } from "./client-precise-jump-session";
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
import {
	PortalTransitionController,
	type PortalTransitionState,
} from "../lib/client/portal-transition-controller";
import type {
	FrameSettings,
	PortalTransitionFrame,
	RendererFrameDiagnosticsSnapshot,
	WorldIndicatorInput,
} from "../lib/game/renderer/renderer";
import type { MapPanelFrame } from "../app/map-panel-frame";
import type { MapEntity } from "../lib/game/map/map-blips";
import type { MapTerrainSource } from "../lib/game/map/map-renderer";
import { mapHeadingFromSceneTransform } from "../lib/game/map/map-view";
import type { ScenePlacement } from "../lib/game/scene";

/** Presentation state exposed to the thin client shell. */
export type ClientPresentationStatusKind =
	| "starting"
	| "awaiting-snapshot"
	| "loading-player"
	| "loading-activation"
	| "ready"
	| "error"
	| "stopped";

export interface ClientPresentationStatus {
	readonly kind: ClientPresentationStatusKind;
	readonly diagnostic: string | null;
}

export interface ClientPresentationFrame {
	readonly rendered: boolean;
	readonly status: ClientPresentationStatus;
}

/** Residency identity shown by the client diagnostics panel. */
export interface ClientDiagnosticResidency {
	readonly landblockId: string;
	readonly envCellId: string | null;
}

/** Cold, curated client diagnostics sampled only while the debug panel is open. */
export interface ClientPresentationDiagnostics {
	readonly playerGuid: number | null;
	readonly playerResidency: ClientDiagnosticResidency | null;
	readonly cameraResidency: ClientDiagnosticResidency | null;
	readonly cameraStatus: ReturnType<
		ClientPresentationCameraController["status"]
	>;
	readonly renderedFrameCount: number;
	readonly viewport: {
		readonly cssWidth: number;
		readonly cssHeight: number;
		readonly drawingBufferWidth: number;
		readonly drawingBufferHeight: number;
	};
	readonly draw: null | {
		readonly viewCount: number;
		readonly visibleSceneEntries: number;
		readonly visibleStaticNodes: number;
		readonly visibleDynamicEntities: number;
		readonly visibleDynamicParts: number;
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

/** Client-local camera controller exposed only to the client shell's semantic input handlers. */
export type ClientPresentationCameraController = PossessionCameraController<
	ClientCameraTarget,
	ClientCameraTick,
	HostKinematicBoomPresentation,
	ClientCameraStatus
>;

/** Runtime surface consumed by the client orchestration seam and injected by focused tests. */
export interface ClientPresentationRuntime extends MapTerrainSource {
	setFrameSettings(settings: FrameSettings): void;
	replaceDynamicEntitySnapshot(
		entities: readonly DynamicEntityView[],
	): Promise<DynamicEntityRealizationResults>;
	upsertDynamicEntity(
		entity: DynamicEntityView,
	): Promise<DynamicEntityRealizationDisposition>;
	removeDynamicEntity(guid: number, generation: number): void;
	reevaluateDynamicEntityEligibility(): Promise<DynamicEntityRealizationResults>;
	applyDynamicEntityTick(
		batch: DynamicEntityTickBatch,
		receivedAtMs: number,
	): void;
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
	setViewerLightCarrier(guid: number | null): void;
	setPortalTransition(transition: PortalTransitionFrame | undefined): void;
	/** Play a validated head-locked portal transition cue when the runtime owns audio. */
	playPortalTransitionSound?(kind: "enter" | "exit"): void;
	dynamicEntityOrigin(guid: number): ResolvedSceneOrigin | null;
	/** Current scene placement of one realized dynamic entity. */
	spawnedEntityPlacement(guid: number): ScenePlacement | null;
	/** Every realized entity paired with the placement used by the current scene. */
	listPresentedSpawnedEntities(): Iterable<MapEntity>;
	/** Monotonic change fact for live dynamic placements. */
	readonly dynamicEntityPlacementRevision: number;
	hasEnvCellScope(residency: ResolvedSceneOrigin): boolean;
	tick(): void;
	render(timeSeconds: number): void;
	/** Optional cold renderer counters used only by explicitly enabled client diagnostics. */
	getRendererFrameDiagnostics?(): RendererFrameDiagnosticsSnapshot | null;
}

/** Minimal owner surface; keeping it structural makes the feed behavior testable without WebGL. */
export interface ClientPresentationOwner {
	readonly activeRegion: ActiveRegionSource;
	readonly profileSource: LandblockProfileSource;
	readonly runtime: ClientPresentationRuntime;
	destroy(): Promise<void>;
}

export interface ClientPresentationOwnerFactory {
	(
		dependencies: GamePresentationOwnerDependencies,
	): Promise<ClientPresentationOwner>;
}

export interface ClientPresentationSessionDependencies {
	readonly session: ClientLifecycleSession;
	readonly canvas: HTMLCanvasElement;
	readonly hostTransport: HostTransport;
	readonly onError?: (error: unknown) => void;
	readonly ownerFactory?: ClientPresentationOwnerFactory;
}

/**
 * Bridges one client authority session into the shared renderer runtime.
 *
 * This class owns no game state. The lifecycle session remains the authority mirror; this owner
 * only schedules realization, interpolation application, camera projection, environment, and
 * static-content demand. It is intentionally disposable so a terminal client event cannot leave a
 * renderer or scene-interest request alive while Electron is shutting down.
 */
export class ClientPresentationSession {
	readonly camera: ClientPresentationCameraController;
	readonly #session: ClientLifecycleSession;
	readonly #canvas: HTMLCanvasElement;
	readonly #hostTransport: HostTransport;
	readonly #onError: (error: unknown) => void;
	readonly #ownerFactory: ClientPresentationOwnerFactory;
	#owner: ClientPresentationOwner | null = null;
	#frameSettings: FrameSettings = CLIENT_TUNING.frameSettings;
	#sceneInterestCoordinator: SceneInterestRequestCoordinator | null = null;
	#unsubscribe: (() => void) | null = null;
	#playerGuid: number | null = null;
	#startPromise: Promise<void> | null = null;
	#mutationQueue: Promise<void> = Promise.resolve();
	#sceneTargetKey: string | null = null;
	#portalSceneActivation: PortalSceneActivation | null = null;
	readonly #portalTransition = new PortalTransitionController();
	#hasRenderedFrame = false;
	#renderedFrameCount = 0;
	#lastCameraResidency: ClientPresentationDiagnostics["cameraResidency"] = null;
	#status: ClientPresentationStatus = {
		kind: "starting",
		diagnostic: null,
	};
	#destroyed = false;
	#cameraTarget: ClientCameraTarget | null = null;
	#cameraProjection: ProjectionClearanceRevision | null = null;
	#cameraSynchronization: Promise<void> = Promise.resolve();
	/** Exact camera/extent pair used by the most recently presented frame. */
	#lastPrimaryView: PrimaryCameraView | null = null;
	readonly #constructionAbortController = new AbortController();

	constructor(dependencies: ClientPresentationSessionDependencies) {
		this.#session = dependencies.session;
		this.#canvas = dependencies.canvas;
		this.#hostTransport = dependencies.hostTransport;
		this.#onError = dependencies.onError ?? (() => undefined);
		this.#ownerFactory =
			dependencies.ownerFactory ?? defaultClientPresentationOwnerFactory;
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

	/** Build the shared presentation when the frontend enters its world-presentation phase. */
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

	/** Current presentation status for the minimal client overlay. */
	status(): ClientPresentationStatus {
		return this.#status;
	}

	/** Pull one coherent radar frame from the same presentation facts the world scene draws. */
	readMapPanelFrame(): MapPanelFrame {
		const owner = this.#owner;
		const playerGuid = this.#playerGuid;
		const placement =
			owner === null || playerGuid === null
				? null
				: owner.runtime.spawnedEntityPlacement(playerGuid);
		return {
			anchor: placement === null ? null : mapAnchorFromPlacement(placement),
			cameraFovRadians: (CLIENT_TUNING.camera.fov * Math.PI) / 180,
			cameraHeadingRadians: this.camera.desiredLook().yawRadians,
			presentedEntities: () =>
				owner?.runtime.listPresentedSpawnedEntities() ?? [],
			presentedEntityRevision:
				owner?.runtime.dynamicEntityPlacementRevision ?? 0,
			source: owner?.runtime ?? null,
		};
	}

	/** Pull one bounded diagnostics snapshot without making frame-hot facts reactive. */
	readDiagnostics(): ClientPresentationDiagnostics {
		const owner = this.#owner;
		const playerPlacement =
			owner === null || this.#playerGuid === null
				? null
				: owner.runtime.spawnedEntityPlacement(this.#playerGuid);
		const frame = owner?.runtime.getRendererFrameDiagnostics?.() ?? null;
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
			draw:
				selection === undefined
					? null
					: {
							viewCount: selection.viewCount,
							visibleSceneEntries: selection.visibleSceneEntries,
							visibleStaticNodes: selection.visibleStaticNodeCount,
							visibleDynamicEntities: selection.visibleDynamicEntityCount,
							visibleDynamicParts: selection.visibleDynamicPartCount,
							objectDrawCalls: selection.objectDrawCalls,
							dynamicDrawCalls: selection.submittedDynamicDrawCount,
							particleBatches: selection.submittedParticleBatchCount,
						},
		};
	}

	/** Sample an anchored AC-axis ray from the exact camera and viewport last presented. */
	samplePreciseJumpRay(
		clientX: number,
		clientY: number,
	): ClientPreciseJumpRay | null {
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
			camera: cameraStatus.identity,
			anchor: parseCellId(view.camera.placement.landblockId),
			start: landblockVector3(acStart),
			direction: acDirection,
			maximumDistance: CLIENT_TUNING.preciseJump.maximumAimDistance,
			previousCell:
				view.camera.placement.envCellId === null
					? null
					: parseCellId(view.camera.placement.envCellId),
		};
	}

	/** Publish one accepted atomic marker and optional reachable trajectory. */
	setPreciseJumpMarker(evaluation: ClientPreciseJumpEvaluation | null): void {
		const runtime = this.#owner?.runtime;
		if (runtime === undefined) return;
		if (evaluation === null || evaluation.target === null) {
			runtime.setWorldIndicator(null);
			return;
		}
		const target = evaluation.target;
		const landblockId = normalizeLandblockOwner(
			`0x${target.anchor.toString(16).padStart(8, "0")}`,
		);
		const origin = createLandblockWorldOrigin(landblockId);
		const local = acVectorToRender(acVector3(target.point));
		const normal = acVectorToRender(acVector3(target.normal));
		const color = preciseJumpMarkerColor(evaluation.status);
		const marker: WorldIndicatorInput["marker"] = {
			color,
			normal: sceneVector3([normal[0], normal[1], normal[2]]),
			position: sceneVec3(origin.add(new Vec3(local[0], local[1], local[2]))),
			radius: CLIENT_TUNING.preciseJump.markerRadius,
			renderScopeKey:
				target.committedCell === null
					? "outdoor"
					: `0x${target.committedCell.toString(16).padStart(8, "0")}`,
		};
		if (evaluation.status !== "reachable") {
			runtime.setWorldIndicator({ marker });
			return;
		}
		const trajectoryAnchor = normalizeLandblockOwner(
			`0x${evaluation.trajectory.anchor.toString(16).padStart(8, "0")}`,
		);
		const trajectoryOrigin = createLandblockWorldOrigin(trajectoryAnchor);
		const trajectoryLocal = acVectorToRender(
			acVector3(evaluation.trajectory.origin),
		);
		const velocity = acVectorToRender(
			acVector3(evaluation.trajectory.velocity),
		);
		const acceleration = acVectorToRender(
			acVector3(evaluation.trajectory.acceleration),
		);
		runtime.setWorldIndicator({
			marker,
			trajectory: {
				revision: evaluation.evaluationId,
				color,
				origin: sceneVec3(
					trajectoryOrigin.add(
						new Vec3(
							trajectoryLocal[0],
							trajectoryLocal[1],
							trajectoryLocal[2],
						),
					),
				),
				velocity: [velocity[0], velocity[1], velocity[2]],
				acceleration: [acceleration[0], acceleration[1], acceleration[2]],
				durationSeconds: evaluation.trajectory.durationSeconds,
				placements: evaluation.trajectory.placements.map((placement) => ({
					startFraction: placement.startFraction,
					endFraction: placement.endFraction,
					renderScopeKey:
						placement.committedCell === null
							? "outdoor"
							: `0x${placement.committedCell.toString(16).padStart(8, "0")}`,
				})),
			},
		});
	}

	/** Replace cold presentation policy immediately, or retain it until owner construction lands. */
	setFrameSettings(settings: FrameSettings): void {
		this.#frameSettings = settings;
		this.#owner?.runtime.setFrameSettings(settings);
	}

	/**
	 * Tick and render one browser frame.
	 *
	 * The authoritative entity selects residency and the interpolated scene origin selects the
	 * camera eye. If visual realization or EnvCell topology is not ready, the frame is held rather
	 * than inventing a free-fly camera.
	 */
	frame(timeMs: number): ClientPresentationFrame {
		const owner = this.#owner;
		const playerGuid = this.#playerGuid;
		if (this.#destroyed || owner === null) {
			return { rendered: false, status: this.#status };
		}
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
		if (playerGuid === null) {
			this.#setStatus(
				"loading-player",
				"Waiting for the server to establish local-player identity.",
			);
			return { rendered: false, status: this.#status };
		}
		if (lifecycle.kind === "entering-world") {
			this.#setStatus(
				"loading-player",
				"Local-player identity is established, but authority has not entered portal space.",
			);
			return { rendered: false, status: this.#status };
		}
		const player = this.#authoritativePlayer(playerGuid);
		if (player === null) {
			owner.runtime.setViewerLightCarrier(null);
			this.#clearSceneDemand(owner);
			this.#setStatus(
				"loading-player",
				`Local player 0x${playerGuid.toString(16).padStart(8, "0")} is absent from the authoritative dynamic mirror.`,
			);
			return { rendered: false, status: this.#status };
		}
		if (player.placement.kind !== "world") {
			owner.runtime.setViewerLightCarrier(null);
			this.#clearSceneDemand(owner);
			this.#setStatus(
				"loading-player",
				`Local player has ${player.placement.kind} placement instead of world placement.`,
			);
			return { rendered: false, status: this.#status };
		}
		if (portal) {
			this.#ensurePortalTransition(owner, lifecycle);
			this.#syncSceneActivation(player, lifecycle.worldGeneration);
		} else {
			this.#portalTransition.reset();
			owner.runtime.setPortalTransition(undefined);
			if (this.#portalSceneActivation?.kind === "accepted") {
				owner.runtime.completeSceneActivation(
					this.#portalSceneActivation.generation,
				);
			}
			this.#portalSceneActivation = null;
			this.#syncSceneInterest(player);
		}
		owner.runtime.setViewerLightCarrier(playerGuid);
		owner.runtime.tick();
		if (portal) {
			const sceneActivation = this.#portalSceneActivation;
			if (sceneActivation?.kind !== "accepted") {
				this.#setStatus("loading-activation");
				return { rendered: false, status: this.#status };
			}
			const receipt = sceneActivation.receipt;
			const activation = owner.runtime.sceneActivationStatus(receipt);
			if (activation.kind === "failed") {
				this.#setStatus("error", activation.diagnostic);
				return { rendered: false, status: this.#status };
			}
			if (activation.kind !== "ready") {
				this.#publishPortalTransition(owner, timeMs, false, false);
				this.#setStatus("loading-activation");
				return { rendered: false, status: this.#status };
			}
			this.#ensureScenePresentationConvergence();
			if (this.#portalSceneActivation?.kind !== "accepted") {
				this.#setStatus("loading-activation");
				return { rendered: false, status: this.#status };
			}
			if (this.#portalSceneActivation.realization !== "ready") {
				this.#setStatus("loading-player");
				return { rendered: false, status: this.#status };
			}
		}
		const origin = owner.runtime.dynamicEntityOrigin(playerGuid);
		if (origin === null) {
			this.#setStatus(
				"loading-player",
				"The authoritative local player has no installed runtime presentation.",
			);
			return { rendered: false, status: this.#status };
		}
		if (origin.envCellId !== null && !owner.runtime.hasEnvCellScope(origin)) {
			this.#setStatus("loading-activation");
			return { rendered: false, status: this.#status };
		}
		const extent = owner.runtime.resolveViewportExtent(
			this.#canvas.clientWidth,
			this.#canvas.clientHeight,
		);
		const projection = this.#resolveCameraProjection(extent);
		let cameraPresentation: HostKinematicBoomPresentation | null;
		if (portal) {
			// Portal activation requires one generation-current host-authored camera placement.
			// It may be either projection-proven or the controller's explicit target fallback;
			// absence and stale-generation output remain non-presentable.
			this.#ensureCamera(player, projection);
			cameraPresentation = this.camera.presentation(timeMs);
			if (cameraPresentation === null) {
				this.#publishPortalTransition(owner, timeMs, false, false);
				this.#setStatus("loading-activation");
				return { rendered: false, status: this.#status };
			}
		} else {
			this.#ensureCamera(player, projection);
			const facingYaw = createEntityFacingCameraYaw(
				player.placement.pose.rotation,
			);
			this.#cameraSynchronization = this.#cameraSynchronization
				.then(() => this.camera.synchronize(projection, timeMs, facingYaw))
				.catch((error: unknown) => this.#reportError(error));
			cameraPresentation = this.camera.presentation(timeMs);
			if (cameraPresentation === null) {
				const cameraStatus = this.camera.status();
				this.#setStatus(
					cameraStatus.kind === "awaiting-first-path"
						? "loading-activation"
						: "loading-player",
					clientCameraWaitDiagnostic(cameraStatus),
				);
				return { rendered: false, status: this.#status };
			}
		}
		if (portal) this.#publishPortalTransition(owner, timeMs, true, false);
		const camera = createClientCamera(
			player,
			origin,
			cameraPresentation,
			this.camera.acknowledgedProjection(timeMs),
		);
		if (
			this.#lastCameraResidency?.landblockId !== camera.placement.landblockId ||
			this.#lastCameraResidency.envCellId !== camera.placement.envCellId
		) {
			this.#lastCameraResidency = {
				landblockId: camera.placement.landblockId,
				envCellId: camera.placement.envCellId,
			};
		}
		const primaryView = { camera, extent };
		owner.runtime.setPrimaryView(primaryView);
		this.#lastPrimaryView = primaryView;
		if (!portal) owner.runtime.setAudioListener(audioListenerFor(camera));
		owner.runtime.render(timeMs / 1_000);
		this.#hasRenderedFrame = true;
		this.#renderedFrameCount += 1;
		this.#setStatus("ready");
		if (portal && this.#portalSceneActivation?.kind === "accepted") {
			const sceneActivation = this.#portalSceneActivation;
			const generation = sceneActivation.generation;
			const update = this.#portalTransition.tick({
				nowMs: timeMs,
				activationReady: true,
				destinationFrameRendered: true,
			});
			if (update.audio !== undefined) {
				owner.runtime.playPortalTransitionSound?.(update.audio);
			}
			owner.runtime.setPortalTransition(
				this.#portalTransitionFrame(update.state),
			);
			if (update.reveal !== null && !sceneActivation.revealAcknowledged) {
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

	/** Dispose subscriptions, scene demand, and shared renderer resources in order. */
	async destroy(): Promise<void> {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.#constructionAbortController.abort();
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
		await attempt("camera-stop", () => this.camera.stop());
		await attempt("camera-destroy", () => this.camera.destroy());
		await attempt("lifecycle-unsubscribe", () => this.#unsubscribe?.());
		this.#unsubscribe = null;
		await attempt("scene-interest-coordinator", () =>
			this.#sceneInterestCoordinator?.invalidate(),
		);
		this.#sceneInterestCoordinator = null;
		await this.#startPromise?.catch((error: unknown) => {
			if (!isPresentationCancellation(error)) {
				failures.push(error);
				labels.push("presentation-start");
			}
		});
		const owner = this.#owner;
		this.#owner = null;
		if (owner !== null)
			await attempt("presentation-owner", () => owner.destroy());
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
			const owner = await this.#ownerFactory({
				canvas: this.#canvas,
				hostTransport: this.#hostTransport,
				signal: this.#constructionAbortController.signal,
				frameSettings: this.#frameSettings,
				audioTuning: {
					placementSmoothingSeconds:
						CLIENT_TUNING.audio.placementSmoothingSeconds,
					loudnessCurveExponent: CLIENT_TUNING.audio.loudnessCurveExponent,
				},
			});
			if (this.#destroyed) {
				await owner.destroy();
				return;
			}
			this.#owner = owner;
			this.#sceneInterestCoordinator = new SceneInterestRequestCoordinator(
				owner.profileSource,
			);
			const lifecycle = this.#session.state().lifecycle;
			if (
				lifecycle?.kind !== "entering-world" &&
				lifecycle?.kind !== "in-world" &&
				lifecycle?.kind !== "portal-space"
			) {
				await owner.destroy();
				this.#status = { kind: "stopped", diagnostic: null };
				return;
			}
			this.#applyServerEnvironment(this.#session.state().serverTime);
			await this.#requestDynamicSnapshotReplacement(
				this.#session.mirror.entities(),
			);
		} catch (error) {
			if (this.#destroyed && isPresentationCancellation(error)) return;
			this.#reportError(error);
			throw error;
		}
	}

	#receive(event: ClientLifecycleSessionEvent): void {
		if (this.#destroyed) return;
		switch (event.type) {
			case "current-state":
				this.#receiveCurrentState(event.state);
				return;
			case "lifecycle":
				return;
			case "local-player-established":
				this.#playerGuid = event.identity.playerGuid;
				return;
			case "dynamic":
				this.#receiveDynamic(event.event);
				return;
			case "server-time":
				this.#enqueueMutation(async () => {
					this.#applyServerEnvironment(event.time);
				});
				return;
			case "presentation-discontinuity":
				this.#receivePresentationDiscontinuity(event.discontinuity);
				return;
			case "exit-requested":
				this.#setStatus(
					event.exit.cause === "explicit-disconnect" ||
						event.exit.cause === "host-shutdown"
						? "stopped"
						: "error",
					event.exit.diagnostic,
				);
				return;
		}
	}

	#receiveCurrentState(state: ClientCurrentState): void {
		this.#playerGuid = state.localPlayerGuid;
		this.#applyServerEnvironment(state.serverTime);
	}

	#receiveDynamic(event: DynamicEntityEvent): void {
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
				this.#enqueueMutation(async () => {
					if (this.#owner === null || this.#session.mirror.isAwaitingSnapshot())
						return;
					this.#owner.runtime.applyDynamicEntityTick(
						event.batch,
						performance.now(),
					);
				});
				if (retryDeferred) this.#ensureScenePresentationConvergence();
				return;
			}
			case "snapshot":
				this.#invalidatePlayerPresentationConvergence();
				void this.#requestDynamicSnapshotReplacement(event.snapshot.entities);
				return;
			case "upserted":
				if (event.entity.identity.guid === this.#playerGuid)
					this.#invalidatePlayerPresentationConvergence();
				this.#enqueueMutation(async () => {
					await this.#owner?.runtime.upsertDynamicEntity(event.entity);
				});
				return;
			case "removed":
				if (event.guid === this.#playerGuid)
					this.#invalidatePlayerPresentationConvergence();
				this.#enqueueMutation(() => {
					this.#owner?.runtime.removeDynamicEntity(
						event.guid,
						event.generation,
					);
				});
				return;
		}
	}

	#receivePresentationDiscontinuity(
		discontinuity: ClientPresentationDiscontinuity,
	): void {
		void this.camera.stop().catch((error: unknown) => this.#reportError(error));
		this.#cameraTarget = null;
		this.#cameraProjection = null;
		this.#sceneTargetKey = null;
		this.#portalSceneActivation = null;
		this.#portalTransition.reset();
		this.#hasRenderedFrame = false;
		this.#lastPrimaryView = null;
		this.#sceneInterestCoordinator?.invalidate();
		this.#enqueueMutation(async () => {
			if (this.#owner === null) return;
			this.#owner.runtime.clearSceneInterest();
		});
		// The host's next reset/teleport batch owns placement invalidation. This edge only drops
		// frontend demand/camera history; no canonical pose is manufactured here.
		void discontinuity;
	}

	/** Start one generation-keyed portal presentation edge and choose outgoing capture policy. */
	#ensurePortalTransition(
		owner: ClientPresentationOwner,
		lifecycle: Extract<ClientLifecycle, { kind: "portal-space" }>,
	): void {
		const state = this.#portalTransition.state();
		if (state?.generation === lifecycle.worldGeneration) return;
		if (this.#portalSceneActivation?.kind === "accepted") {
			owner.runtime.completeSceneActivation(
				this.#portalSceneActivation.generation,
			);
		}
		this.#portalSceneActivation = null;
		owner.runtime.setAudioListener(null);
		// The core resets its camera at the same generation edge. Drop the frontend registration too
		// so the next seed is accepted even when the player instance itself was reused by the server.
		void this.camera.stop().catch((error: unknown) => this.#reportError(error));
		this.#cameraTarget = null;
		const outgoingAvailable =
			state === null &&
			lifecycle.cause === "teleport" &&
			this.#hasRenderedFrame;
		this.#portalTransition.begin(lifecycle.worldGeneration, outgoingAvailable);
		owner.runtime.playPortalTransitionSound?.("enter");
	}

	/** Advance the presentation state before a portal frame; waiting has no timeout. */
	#publishPortalTransition(
		owner: ClientPresentationOwner,
		nowMs: number,
		activationReady: boolean,
		destinationFrameRendered: boolean,
	): void {
		const update = this.#portalTransition.tick({
			nowMs,
			activationReady,
			destinationFrameRendered,
		});
		if (update.audio !== undefined) {
			owner.runtime.playPortalTransitionSound?.(update.audio);
		}
		owner.runtime.setPortalTransition(
			this.#portalTransitionFrame(update.state),
		);
	}

	#portalTransitionFrame(state: PortalTransitionState): PortalTransitionFrame {
		return {
			generation: state.generation,
			outgoingAvailable:
				state.kind !== "revealed-awaiting-handoff" && state.outgoingCaptured,
			phase: state.kind,
			progress:
				state.kind === "exiting"
					? state.progress
					: state.kind === "revealed-awaiting-handoff"
						? 1
						: 0,
		};
	}

	#resolveCameraProjection(extent: RenderExtent): ProjectionClearanceRevision {
		const current = this.#cameraProjection;
		if (
			current !== null &&
			current.extent.width === extent.width &&
			current.extent.height === extent.height
		)
			return current;
		const projection = createProjectionClearanceRevision(
			(current?.revision ?? 0) + 1,
			{ fov: CLIENT_TUNING.camera.fov, near: CLIENT_TUNING.camera.near },
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
				if (this.#cameraTarget === target) this.#reportError(error);
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
		return this.#enqueueMutation(async () => {
			if (this.#owner === null) return;
			await this.#owner.runtime.replaceDynamicEntitySnapshot(entities);
		});
	}

	#requestDynamicEligibilityReevaluation(): Promise<void> {
		return this.#enqueueMutation(async () => {
			if (this.#owner === null || this.#session.mirror.isAwaitingSnapshot())
				return;
			const lifecycle = this.#session.state().lifecycle;
			const portalActivation = this.#portalSceneActivation;
			if (
				lifecycle?.kind === "portal-space" &&
				(portalActivation?.kind !== "accepted" ||
					portalActivation.realization !== "pending")
			)
				return;
			const results =
				await this.#owner.runtime.reevaluateDynamicEntityEligibility();
			if (
				lifecycle?.kind !== "portal-space" ||
				portalActivation?.kind !== "accepted"
			)
				return;
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
		});
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
		void this.#requestDynamicEligibilityReevaluation();
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

	#enqueueMutation(operation: () => void | Promise<void>): Promise<void> {
		const next = this.#mutationQueue.then(async () => {
			if (this.#destroyed) return;
			await operation();
		});
		this.#mutationQueue = next.catch((error: unknown) => {
			this.#reportError(error);
		});
		return next;
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
		const owner = this.#owner;
		if (coordinator === null || owner === null) return;
		if (this.#portalSceneActivation !== null) {
			// A later destination within the same authority generation supersedes any fade progress
			// earned by the provisional scene. Only the replacement may produce the reveal frame.
			this.#portalTransition.begin(worldGeneration, false);
		}
		if (this.#portalSceneActivation?.kind === "accepted") {
			owner.runtime.completeSceneActivation(
				this.#portalSceneActivation.generation,
			);
		}
		this.#portalSceneActivation = {
			kind: "requesting",
			generation: worldGeneration,
			key,
		};
		const request = coordinator.request(target, CLIENT_TUNING.sceneInterest);
		void request.promise
			.then((resolved) =>
				owner.runtime.activateScene({
					generation: worldGeneration,
					target: resolved,
				}),
			)
			.then((receipt) => {
				const current = this.#portalSceneActivation;
				if (
					this.#destroyed ||
					this.#owner !== owner ||
					!coordinator.isCurrent(request.revision) ||
					current?.kind !== "requesting" ||
					current.key !== key ||
					!isCurrentPortalGeneration(
						this.#session.state().lifecycle,
						worldGeneration,
					)
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

	#syncSceneInterest(player: DynamicEntityView): void {
		if (player.placement.kind !== "world") {
			this.#clearSceneDemand(this.#owner);
			return;
		}
		const target = clientSceneInterestTarget(player.placement);
		const key = sceneInterestTargetKey(target);
		if (key === this.#sceneTargetKey) return;
		const coordinator = this.#sceneInterestCoordinator;
		const owner = this.#owner;
		if (coordinator === null || owner === null) return;
		this.#sceneTargetKey = key;
		const request = coordinator.request(target, CLIENT_TUNING.sceneInterest);
		void request.promise
			.then((resolved) => {
				if (
					this.#destroyed ||
					this.#owner !== owner ||
					!coordinator.isCurrent(request.revision) ||
					this.#sceneTargetKey !== key
				)
					return;
				owner.runtime.updateSceneInterest(resolved);
			})
			.catch((error: unknown) => {
				if (!this.#destroyed && coordinator.isCurrent(request.revision)) {
					this.#reportError(error);
				}
			});
	}

	#clearSceneDemand(owner: ClientPresentationOwner | null): void {
		if (this.#sceneTargetKey === null && this.#portalSceneActivation === null)
			return;
		this.#sceneTargetKey = null;
		if (owner !== null && this.#portalSceneActivation?.kind === "accepted") {
			owner.runtime.completeSceneActivation(
				this.#portalSceneActivation.generation,
			);
		}
		this.#portalSceneActivation = null;
		this.#sceneInterestCoordinator?.invalidate();
		if (owner !== null) owner.runtime.clearSceneInterest();
	}

	#applyServerEnvironment(serverTime: number | null): void {
		const owner = this.#owner;
		if (owner === null || serverTime === null) return;
		const selection = resolveClientEnvironmentSelection(
			owner.activeRegion,
			serverTime,
		);
		// The client protocol currently publishes no weather/player-option override. Authored sky
		// weather therefore remains the explicit renderer default; wall-clock time is never used.
		owner.runtime.setSceneEnvironment(
			resolveSceneEnvironment(owner.activeRegion, selection),
		);
	}

	#setStatus(
		kind: ClientPresentationStatusKind,
		diagnostic: string | null = null,
	): void {
		const previous = this.#status;
		if (previous.kind === kind && previous.diagnostic === diagnostic) return;
		if (
			this.#hasRenderedFrame &&
			this.#session.state().lifecycle?.kind === "in-world" &&
			kind === "loading-player" &&
			(previous.kind !== kind || previous.diagnostic !== diagnostic)
		) {
			console.warn(
				`Client presentation is unavailable after world handoff: ${diagnostic ?? "no diagnostic supplied"}`,
			);
		}
		this.#status = { kind, diagnostic };
	}

	#reportError(error: unknown): void {
		this.#setStatus("error", errorMessage(error));
		this.#onError(error);
	}
}

/** Convert ACE's synchronized portal-year clock into the region resolver's day selection. */
export function resolveClientEnvironmentSelection(
	activeRegion: ActiveRegionSource,
	serverTime: number,
): {
	readonly dayIndex: number;
	readonly timeOfDay: number;
	readonly dayGroupOverride: null;
} {
	if (!Number.isFinite(serverTime)) {
		throw new Error("Client server time must be finite.");
	}
	const { dayLength, zeroTimeOfYear } = activeRegion.data.calendar;
	const elapsed = serverTime + zeroTimeOfYear;
	if (elapsed < 0) {
		throw new Error("Client server time precedes the active-region calendar.");
	}
	return {
		dayIndex: Math.floor(elapsed / dayLength),
		timeOfDay: resolveDayFraction(elapsed, dayLength),
		dayGroupOverride: null,
	};
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

function isCurrentPortalGeneration(
	lifecycle: ClientLifecycle | null,
	generation: number,
): boolean {
	return (
		lifecycle?.kind === "portal-space" &&
		lifecycle.worldGeneration === generation
	);
}

/** Exact non-rendering camera prerequisite surfaced by the client instead of one vague wait. */
function clientCameraWaitDiagnostic(
	status: ReturnType<ClientPresentationCameraController["status"]>,
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
			fov: projection?.fov ?? CLIENT_TUNING.camera.fov,
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
		fov: CLIENT_TUNING.camera.fov,
		near: CLIENT_TUNING.camera.near,
		placement: {
			envCellId: origin.envCellId,
			landblockId: origin.landblockId,
			position,
			rotation: fallbackRotation,
		},
	};
}

function rotateRenderVector(vector: Vec3, rotation: Quat): Vec3 {
	const length = Math.hypot(rotation.w, rotation.x, rotation.y, rotation.z);
	if (!Number.isFinite(length) || length <= Number.EPSILON)
		throw new Error("Client camera rotation must be finite and non-zero.");
	const w = rotation.w / length;
	const x = rotation.x / length;
	const y = rotation.y / length;
	const z = rotation.z / length;
	const tx = 2 * (y * vector.z - z * vector.y);
	const ty = 2 * (z * vector.x - x * vector.z);
	const tz = 2 * (x * vector.y - y * vector.x);
	return new Vec3(
		vector.x + w * tx + (y * tz - z * ty),
		vector.y + w * ty + (z * tx - x * tz),
		vector.z + w * tz + (x * ty - y * tx),
	);
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
	status: ClientPreciseJumpEvaluation["status"],
): readonly [number, number, number, number] {
	switch (status) {
		case "reachable":
			return [0.08, 0.48, 1, 0.9];
		case "unreachable":
			return [1, 0.12, 0.08, 0.9];
		default:
			return [0.62, 0.68, 0.75, 0.8];
	}
}

/** Convert the player's live scene placement into the world-space subject used by the radar. */
function mapAnchorFromPlacement(
	placement: ScenePlacement,
): NonNullable<MapPanelFrame["anchor"]> {
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

function isPresentationCancellation(error: unknown): boolean {
	return error instanceof Error && error.name === "AbortError";
}

function defaultClientPresentationOwnerFactory(
	dependencies: GamePresentationOwnerDependencies,
): Promise<ClientPresentationOwner> {
	return GamePresentationOwner.build(dependencies);
}
