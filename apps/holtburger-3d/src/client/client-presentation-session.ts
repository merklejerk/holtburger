import { sceneVec3, sceneVector3 } from "../lib/assets/ac-frame";
import type { ActiveRegionSource } from "../lib/assets/active-region-source";
import type { LandblockProfileSource } from "../lib/assets/landblock-profile-source";
import { FRONTEND_TUNING } from "../lib/frontend-tuning";
import { resolveDayFraction } from "../lib/game/environment/game-clock";
import {
	resolveSceneEnvironment,
	type ResolvedSceneEnvironment,
} from "../lib/game/environment/scene-environment";
import { createLandblockWorldOrigin } from "../lib/game/landblocks";
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
import { datAssetId } from "../lib/game/runtime/dynamic-entity-presentation";
import type {
	DynamicEntityAdvanceBatch,
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
	ClientCurrentState,
	ClientCameraTick,
	ClientLifecycle,
	ClientWorldDiscontinuity,
} from "./client-host-contract";
import {
	ClientLifecycleSession,
	type ClientLifecycleSessionEvent,
} from "./client-lifecycle-session";
import {
	ClientCameraSession,
	type ClientCameraDistancePolicy,
	type ClientCameraStatus,
	type ClientCameraTarget,
} from "../lib/game/camera/client-camera-session";
import {
	PossessionCameraController,
	type PossessionCameraOrbitPolicy,
	type PossessionCameraRecenterPolicy,
} from "../lib/game/camera/possession-camera-controller";
import {
	createProjectionClearanceRevision,
	type ProjectionClearanceRevision,
} from "../lib/game/camera/projection-clearance";
import type { HostKinematicBoomPresentation } from "../lib/game/motion/host-kinematic-boom-path";

/** Client presentation projection and the frontend's small reach/orbit policy. */
const CLIENT_CAMERA = {
	far: 2_000,
	fov: 75,
	height: 2,
	near: 0.1,
	pitchRadians: -0.2,
	rearDistance: 4.5,
	distance: {
		initial: 4.5,
		minimum: 1.2,
		maximum: 8,
	} satisfies ClientCameraDistancePolicy,
	orbit: {
		maximumPitchRadians: 1.35,
		pitchRadiansPerPixel: 0.004,
		yawRadiansPerPixel: 0.004,
	} satisfies PossessionCameraOrbitPolicy,
	recenter: {
		delayMs: 350,
		durationMs: 180,
	} satisfies PossessionCameraRecenterPolicy,
} as const;

/** Static demand follows the authoritative player, not the interpolated camera. */
const CLIENT_SCENE_INTEREST = {
	buildingRadius: 2,
	envCellRadius: 1,
	explicitObjectRadius: 2,
	generatedObjectRadius: 2,
	terrainRadius: 3,
} as const;

/** Presentation state exposed to the thin client shell. */
export type ClientPresentationStatusKind =
	| "starting"
	| "awaiting-snapshot"
	| "loading-player"
	| "loading-scene"
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

/** Client-local camera controller exposed only to the client shell's semantic input handlers. */
export type ClientPresentationCameraController = PossessionCameraController<
	ClientCameraTarget,
	ClientCameraTick,
	HostKinematicBoomPresentation,
	ClientCameraStatus
>;

/** Runtime surface consumed by the client orchestration seam and injected by focused tests. */
export interface ClientPresentationRuntime {
	reconcileDynamicEntities(
		entities: readonly DynamicEntityView[],
	): Promise<void>;
	applyDynamicEntityAdvances(
		batch: DynamicEntityAdvanceBatch,
		receivedAtMs: number,
	): void;
	updateSceneInterest(request: SceneInterestRequest): unknown;
	clearSceneInterest(): unknown;
	resolveViewportExtent(cssWidth: number, cssHeight: number): RenderExtent;
	setPrimaryView(view: PrimaryCameraView): void;
	setAudioListener(placement: AudioListenerPlacement): void;
	setSceneEnvironment(environment: ResolvedSceneEnvironment): void;
	setViewerLightCarrier(guid: number | null): void;
	dynamicEntityOrigin(guid: number): ResolvedSceneOrigin | null;
	hasEnvCellScope(residency: ResolvedSceneOrigin): boolean;
	tick(): void;
	render(timeSeconds: number): void;
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
 * only schedules reconciliation, interpolation application, camera projection, environment, and
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
	#sceneInterestCoordinator: SceneInterestRequestCoordinator | null = null;
	#unsubscribe: (() => void) | null = null;
	#playerGuid: number | null = null;
	#startPromise: Promise<void> | null = null;
	#mutationQueue: Promise<void> = Promise.resolve();
	#reconciliationRevision = 0;
	#sceneTargetKey: string | null = null;
	#sceneResolvedKey: string | null = null;
	#status: ClientPresentationStatus = {
		kind: "starting",
		diagnostic: null,
	};
	#destroyed = false;
	#cameraTarget: ClientCameraTarget | null = null;
	#cameraProjection: ProjectionClearanceRevision | null = null;
	#cameraSynchronization: Promise<void> = Promise.resolve();
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
				pitchRadians: CLIENT_CAMERA.pitchRadians,
				yawRadians: 0,
			},
			orbit: CLIENT_CAMERA.orbit,
			recenter: CLIENT_CAMERA.recenter,
			session: cameraSession,
		});
	}

	/** Build the shared presentation only after the host has published an in-world player GUID. */
	start(playerGuid: number): Promise<void> {
		if (this.#destroyed) {
			return Promise.reject(
				new Error("Cannot start a destroyed client presentation."),
			);
		}
		if (!Number.isInteger(playerGuid) || playerGuid < 0) {
			return Promise.reject(
				new Error("Client presentation player GUID must be non-negative."),
			);
		}
		if (this.#startPromise !== null) return this.#startPromise;
		this.#playerGuid = playerGuid;
		this.#status = { kind: "starting", diagnostic: null };
		this.#startPromise = this.#initialize();
		return this.#startPromise;
	}

	/** Current presentation status for the minimal client overlay. */
	status(): ClientPresentationStatus {
		return this.#status;
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
		if (this.#destroyed || owner === null || playerGuid === null) {
			return { rendered: false, status: this.#status };
		}
		if (this.#session.mirror.isAwaitingSnapshot()) {
			this.#setStatus("awaiting-snapshot");
			return { rendered: false, status: this.#status };
		}
		const lifecycle = this.#session.state().lifecycle;
		if (lifecycle?.kind !== "in-world" || lifecycle.playerGuid !== playerGuid) {
			this.#setStatus("stopped");
			return { rendered: false, status: this.#status };
		}
		const player = this.#authoritativePlayer(playerGuid);
		if (player === null) {
			owner.runtime.setViewerLightCarrier(null);
			this.#clearSceneDemand(owner);
			this.#setStatus("loading-player");
			return { rendered: false, status: this.#status };
		}
		if (player.placement.kind !== "world") {
			owner.runtime.setViewerLightCarrier(null);
			this.#clearSceneDemand(owner);
			this.#setStatus("loading-player");
			return { rendered: false, status: this.#status };
		}
		this.#syncSceneInterest(player);
		owner.runtime.setViewerLightCarrier(playerGuid);
		owner.runtime.tick();
		const origin = owner.runtime.dynamicEntityOrigin(playerGuid);
		if (origin === null) {
			this.#setStatus("loading-player");
			return { rendered: false, status: this.#status };
		}
		if (origin.envCellId !== null && !owner.runtime.hasEnvCellScope(origin)) {
			this.#setStatus("loading-scene");
			return { rendered: false, status: this.#status };
		}
		const extent = owner.runtime.resolveViewportExtent(
			this.#canvas.clientWidth,
			this.#canvas.clientHeight,
		);
		const projection = this.#resolveCameraProjection(extent);
		this.#ensureCamera(player, projection);
		const facingYaw = createEntityFacingCameraYaw(
			player.placement.pose.rotation,
		);
		this.#cameraSynchronization = this.#cameraSynchronization
			.then(() => this.camera.synchronize(projection, timeMs, facingYaw))
			.catch((error: unknown) => this.#reportError(error));
		const cameraPresentation = this.camera.presentation(timeMs);
		if (cameraPresentation === null) {
			this.#setStatus(
				this.camera.status().kind === "awaiting-first-path"
					? "loading-scene"
					: "loading-player",
			);
			return { rendered: false, status: this.#status };
		}
		const camera = createClientCamera(
			player,
			origin,
			cameraPresentation,
			this.camera.acknowledgedProjection(timeMs),
		);
		owner.runtime.setPrimaryView({ camera, extent });
		owner.runtime.setAudioListener(audioListenerFor(camera));
		owner.runtime.render(timeMs / 1_000);
		this.#setStatus(
			this.#sceneResolvedKey === this.#sceneTargetKey
				? "ready"
				: "loading-scene",
		);
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
		this.#reconciliationRevision += 1;
		await attempt("scene-interest-coordinator", () =>
			this.#sceneInterestCoordinator?.destroy(),
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
				audioTuning: {
					placementSmoothingSeconds:
						FRONTEND_TUNING.audio.placementSmoothingSeconds,
					loudnessCurveExponent: FRONTEND_TUNING.audio.loudnessCurveExponent,
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
				lifecycle?.kind !== "in-world" ||
				lifecycle.playerGuid !== this.#playerGuid
			) {
				await owner.destroy();
				this.#status = { kind: "stopped", diagnostic: null };
				return;
			}
			this.#applyServerEnvironment(this.#session.state().serverTime);
			await this.#requestReconciliation();
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
				this.#receiveLifecycle(event.lifecycle);
				return;
			case "dynamic":
				this.#receiveDynamic(event.event);
				return;
			case "server-time":
				this.#enqueueMutation(async () => {
					this.#applyServerEnvironment(event.time);
				});
				return;
			case "world-discontinuity":
				this.#receiveDiscontinuity(event.discontinuity);
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
		if (state.lifecycle.kind === "in-world") {
			this.#playerGuid = state.lifecycle.playerGuid;
		} else if (state.lifecycle.kind !== "entering-world") {
			this.#playerGuid = null;
		}
		this.#applyServerEnvironment(state.serverTime);
	}

	#receiveLifecycle(lifecycle: ClientLifecycle): void {
		if (lifecycle.kind === "in-world") {
			this.#playerGuid = lifecycle.playerGuid;
			return;
		}
		if (lifecycle.kind !== "entering-world") this.#playerGuid = null;
	}

	#receiveDynamic(event: DynamicEntityEvent): void {
		if (event.kind === "advanced") {
			if (this.#session.mirror.isAwaitingSnapshot()) {
				this.#setStatus("awaiting-snapshot");
				return;
			}
			this.#enqueueMutation(async () => {
				if (this.#owner === null || this.#session.mirror.isAwaitingSnapshot())
					return;
				this.#owner.runtime.applyDynamicEntityAdvances(
					event.batch,
					performance.now(),
				);
			});
			return;
		}
		void this.#requestReconciliation();
	}

	#receiveDiscontinuity(discontinuity: ClientWorldDiscontinuity): void {
		void this.camera.stop().catch((error: unknown) => this.#reportError(error));
		this.#cameraTarget = null;
		this.#cameraProjection = null;
		this.#sceneTargetKey = null;
		this.#sceneResolvedKey = null;
		this.#sceneInterestCoordinator?.destroy();
		this.#enqueueMutation(async () => {
			if (this.#owner === null) return;
			this.#owner.runtime.clearSceneInterest();
		});
		// The host's next reset/teleport batch owns placement invalidation. This edge only drops
		// frontend demand/camera history; no canonical pose is manufactured here.
		void discontinuity;
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
			{ fov: CLIENT_CAMERA.fov, near: CLIENT_CAMERA.near },
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
			pitchRadians: CLIENT_CAMERA.pitchRadians,
			yawRadians: createEntityFacingCameraYaw(player.placement.pose.rotation),
		});
		void this.camera
			.start(target, CLIENT_CAMERA.distance, projection)
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

	#requestReconciliation(): Promise<void> {
		const revision = ++this.#reconciliationRevision;
		return this.#enqueueMutation(async () => {
			if (
				this.#owner === null ||
				this.#session.mirror.isAwaitingSnapshot() ||
				revision !== this.#reconciliationRevision
			)
				return;
			await this.#owner.runtime.reconcileDynamicEntities(
				this.#session.mirror.entities(),
			);
		});
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
		this.#sceneResolvedKey = null;
		const request = coordinator.request(target, CLIENT_SCENE_INTEREST);
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
				this.#sceneResolvedKey = key;
			})
			.catch((error: unknown) => {
				if (!this.#destroyed && coordinator.isCurrent(request.revision)) {
					this.#sceneResolvedKey = null;
					this.#reportError(error);
				}
			});
	}

	#clearSceneDemand(owner: ClientPresentationOwner | null): void {
		if (this.#sceneTargetKey === null && this.#sceneResolvedKey === null)
			return;
		this.#sceneTargetKey = null;
		this.#sceneResolvedKey = null;
		this.#sceneInterestCoordinator?.destroy();
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
	const landblockId = datAssetId(
		(cellId & 0xffff_0000) | 0xffff,
	) as `0x${string}`;
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
		CLIENT_CAMERA.pitchRadians,
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
			far: CLIENT_CAMERA.far,
			fov: projection?.fov ?? CLIENT_CAMERA.fov,
			near: projection?.near ?? CLIENT_CAMERA.near,
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
	const axes = createCameraAxesRadians(fallbackYaw, CLIENT_CAMERA.pitchRadians);
	const originWorld = createLandblockWorldOrigin(origin.landblockId).add(
		origin.landblockOrigin,
	);
	const position = sceneVec3(
		new Vec3(
			originWorld.x - axes.forward.x * CLIENT_CAMERA.rearDistance,
			originWorld.y +
				CLIENT_CAMERA.height -
				axes.forward.y * CLIENT_CAMERA.rearDistance,
			originWorld.z - axes.forward.z * CLIENT_CAMERA.rearDistance,
		),
	);
	return {
		far: CLIENT_CAMERA.far,
		fov: CLIENT_CAMERA.fov,
		near: CLIENT_CAMERA.near,
		placement: {
			envCellId: origin.envCellId,
			landblockId: origin.landblockId,
			position,
			rotation: fallbackRotation,
		},
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
