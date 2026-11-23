import { isAbortError } from "../../lib/async-lifetime";
import {
	type LandblockVector3,
	acVector3,
	acVectorToRender,
	sceneVec3,
	sceneVector3,
} from "../../lib/assets/ac-frame";
import {
	createLandblockWorldOrigin,
	normalizeLandblockOwner,
} from "../../lib/game/landblocks";
import {
	createCameraAxesRadians,
	createCameraRotationRadians,
	createEntityFacingCameraYaw,
	resolveCameraLookAtAngles,
} from "../../lib/game/math/camera-orientation";
import { Quat, Vec3 } from "../../lib/game/math/types";
import {
	ClientCameraSession,
	type ClientCameraTarget,
} from "../../lib/game/camera/client-camera-session";
import { PossessionCameraController } from "../../lib/game/camera/possession-camera-controller";
import {
	createProjectionClearanceRevision,
	type ProjectionClearanceRevision,
} from "../../lib/game/camera/projection-clearance";
import type { HostKinematicBoomPresentation } from "../../lib/game/motion/host-kinematic-boom-path";
import type { MapAnchor } from "../../lib/game/map/map-view";
import { mapHeadingFromSceneTransform } from "../../lib/game/map/map-view";
import type { MinimapFrame } from "../../app/minimap/frame";
import type { RenderExtent } from "../../lib/game/renderer/render-extent";
import type {
	WorldCurveTrajectoryInput,
	WorldIndicatorInput,
	WorldTrajectoryInput,
} from "../../lib/game/renderer/renderer";
import type { DynamicEntityView } from "../../lib/game/runtime/dynamic-entity-feed";
import type {
	AudioListenerPlacement,
	Camera,
	PrimaryCameraView,
} from "../../lib/game/runtime/types";
import type { ResolvedSceneOrigin, ScenePlacement } from "../../lib/game/scene";
import {
	refineEntitySelectionCandidates,
	type EntitySelectionRefinement,
	type PresentedSelectionRay,
} from "../../lib/game/selection/entity-selection-intersection";
import { samplePresentedCameraRay as sampleSharedPresentedCameraRay } from "../../lib/game/selection/presented-camera-ray";
import type { ClientLifecycleSession } from "./lifecycle-session";
import { formatClientLocation } from "./location-command";
import type {
	ClientPreciseJumpRay,
	ClientPreciseJumpSnapshot,
} from "../combat/precise-jump-session";
import {
	clientSelectedEntityDistance,
	type ClientSelectedEntityTrackingStatus,
} from "../world/selection-tracking";
import {
	projectClientTargetIndicator,
	type ClientTargetIndicatorFrame,
} from "../combat/target-indicator";
import type { CycleSelectionPresentationFrame } from "../combat/target-acquisition";
import { CLIENT_IDLE_CAMERA_ORBIT_DELAY_SECONDS } from "../settings/settings-defaults";
import { CLIENT_TUNING } from "../settings/tuning";
import type {
	ClientDiagnosticResidency,
	ClientGameplayPresentationCameraController,
	ClientGameplayPresentationResources,
	ClientGameplayPresentationStatusKind,
	ClientGameplayRuntime,
	ClientPresentedCameraRay,
} from "./gameplay-presentation";

export type CameraViewResolution =
	| {
			readonly kind: "waiting";
			readonly status: "loading-activation" | "loading-player";
			readonly diagnostic: string;
	  }
	| {
			readonly kind: "ready";
			readonly primaryView: PrimaryCameraView;
	  };

/**
 * Owns camera registration/projection, ray sampling, entity selection, minimap/location
 * sampling, and precise-jump indicator presentation.
 */
export class ClientCameraAndSelectionPresenter {
	readonly camera: ClientGameplayPresentationCameraController;
	readonly #canvas: HTMLCanvasElement;
	#cameraTarget: ClientCameraTarget | null = null;
	#cameraProjection: ProjectionClearanceRevision | null = null;
	#cameraSynchronization: Promise<void> = Promise.resolve();
	/** Exact camera/extent pair used by the most recently presented frame. */
	#lastPrimaryView: PrimaryCameraView | null = null;
	#lastCameraResidency: ClientDiagnosticResidency | null = null;
	#selectedEntityGuid: number | null = null;
	/** Retained across gameplay initialization, like selected identity. */
	#hoveredEntityGuid: number | null = null;
	/** Last picked location retained as pending feedback between replacement surface picks. */
	#preciseJumpMarker: WorldIndicatorInput["marker"] | null = null;
	/** Suppresses idle camera orbit while the player is aiming a precise jump. */
	#preciseJumpActive = false;
	/** Scalar root-pose history used to detect any world movement/turning without allocation. */
	#hasLastPlayerPose = false;
	#lastPlayerLandblockId: string | null = null;
	#lastPlayerEnvCellId: string | null = null;
	#lastPlayerOriginX = 0;
	#lastPlayerOriginY = 0;
	#lastPlayerOriginZ = 0;
	#lastPlayerFacingYaw = 0;

	constructor(options: {
		readonly session: ClientLifecycleSession;
		readonly canvas: HTMLCanvasElement;
		readonly idleOrbitDelayMs?: number;
	}) {
		this.#canvas = options.canvas;
		const cameraSession = new ClientCameraSession(options.session);
		this.camera = new PossessionCameraController({
			initialLook: {
				pitchRadians: CLIENT_TUNING.camera.pitchRadians,
				yawRadians: 0,
			},
			orbit: CLIENT_TUNING.camera.orbit,
			recenter: CLIENT_TUNING.camera.recenter,
			idleOrbit: CLIENT_TUNING.camera.idleOrbit,
			idleOrbitDelayMs:
				options.idleOrbitDelayMs ??
				CLIENT_IDLE_CAMERA_ORBIT_DELAY_SECONDS.initial * 1_000,
			session: cameraSession,
		});
	}

	selectedEntityGuid(): number | null {
		return this.#selectedEntityGuid;
	}

	hoveredEntityGuid(): number | null {
		return this.#hoveredEntityGuid;
	}

	lastPrimaryView(): PrimaryCameraView | null {
		return this.#lastPrimaryView;
	}

	lastCameraResidency(): ClientDiagnosticResidency | null {
		return this.#lastCameraResidency;
	}

	setSelectedEntityGuid(
		guid: number | null,
		runtime: ClientGameplayRuntime | undefined,
	): void {
		this.#selectedEntityGuid = guid;
		runtime?.setSelectedEntityGuid(guid);
	}

	setHoveredEntityGuid(
		guid: number | null,
		runtime: ClientGameplayRuntime | undefined,
	): void {
		this.#hoveredEntityGuid = guid;
		runtime?.setHoveredEntityGuid(guid);
	}

	applySelectionToRuntime(runtime: ClientGameplayRuntime): void {
		runtime.setSelectedEntityGuid(this.#selectedEntityGuid);
		runtime.setHoveredEntityGuid(this.#hoveredEntityGuid);
	}

	/** Pull one coherent radar frame from the same presentation facts the world scene draws. */
	readMinimapFrame(
		resources: ClientGameplayPresentationResources | null,
		playerGuid: number | null,
		fieldOfView: number,
	): MinimapFrame {
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
				((this.#lastPrimaryView?.camera.fov ?? fieldOfView) * Math.PI) / 180,
			cameraHeadingRadians: this.camera.desiredLook().yawRadians,
			presentedEntities: () =>
				resources?.runtime.listPresentedSpawnedEntities() ?? [],
			presentedEntitiesRevision: resources?.runtime.mapEntityRevision ?? 0,
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
	readLocationReport(
		player: DynamicEntityView | null,
		statusKind: ClientGameplayPresentationStatusKind,
	): string {
		if (player === null || player.placement.kind !== "world") {
			throw new Error("Player location is unavailable.");
		}
		if (statusKind !== "ready" || this.#lastPrimaryView === null) {
			throw new Error("Presented camera location is unavailable.");
		}
		return formatClientLocation(
			player.placement.pose,
			this.#lastPrimaryView.camera.placement,
		);
	}

	/** Read one coherent residency and camera-distance fact for app-local selection policy. */
	selectedEntityTrackingStatus(
		guid: number,
		runtime: ClientGameplayRuntime | undefined,
	): ClientSelectedEntityTrackingStatus {
		const view = this.#lastPrimaryView;
		const state = runtime?.dynamicEntityPresentationState(guid);
		if (state?.kind === "frontend-evicted") return state;
		if (view === null || state?.kind !== "realized") {
			return { kind: "temporarily-unrealized" };
		}
		return {
			distance: clientSelectedEntityDistance(view, state.frame),
			kind: "tracked",
		};
	}

	/** Project the exact current selected bound through the exact primary view last presented. */
	readTargetIndicatorFrame(
		runtime: ClientGameplayRuntime | undefined,
	): ClientTargetIndicatorFrame | null {
		const view = this.#lastPrimaryView;
		const state =
			this.#selectedEntityGuid === null
				? null
				: (runtime?.dynamicEntityPresentationState(this.#selectedEntityGuid) ??
					null);
		const selected = state?.kind === "realized" ? state.frame : null;
		// An absent target needs no projection or synchronous browser layout read.
		if (view === null || selected === null) return null;
		const cssWidth = this.#canvas.clientWidth;
		const cssHeight = this.#canvas.clientHeight;
		if (cssWidth <= 0 || cssHeight <= 0) return null;
		return projectClientTargetIndicator({
			bounds: selected.localBounds,
			cssHeight,
			cssWidth,
			placement: selected.placement,
			tuning: CLIENT_TUNING.entitySelection.offscreenIndicator,
			view,
		});
	}

	/** Capture one acquisition owner; geometry remains borrowed inside the synchronous callback. */
	withCycleSelectionFrame<T>(
		runtime: ClientGameplayRuntime | undefined,
		ready: boolean,
		visit: (frame: CycleSelectionPresentationFrame) => T,
	): T | null {
		if (runtime === undefined || !ready) return null;
		return visit({
			view:
				this.camera.status().kind === "active" ? this.#lastPrimaryView : null,
			visitRealizedEntitySelectionBounds: (consume) =>
				runtime.visitRealizedEntitySelectionBounds(consume),
		});
	}

	/** Sample host-query and exact-render rays from the exact camera and viewport last presented. */
	samplePresentedCameraRay(
		clientX: number,
		clientY: number,
	): ClientPresentedCameraRay | null {
		const view = this.#lastPrimaryView;
		const cameraStatus = this.camera.status();
		if (view === null || cameraStatus.kind !== "active") return null;
		const sampled = sampleSharedPresentedCameraRay(
			view,
			this.#canvas,
			clientX,
			clientY,
		);
		if (sampled === null) return null;
		return {
			query: {
				camera: cameraStatus.identity,
				anchor: parseCellId(view.camera.placement.landblockId),
				start: sampled.acStart,
				direction: sampled.acDirection,
				previousCell:
					view.camera.placement.envCellId === null
						? null
						: parseCellId(view.camera.placement.envCellId),
			},
			refinement: sampled.refinement,
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
		runtime: ClientGameplayRuntime | undefined,
		ray: PresentedSelectionRay,
		candidateGuids: readonly number[],
		staticLimitDistance: number,
	): EntitySelectionRefinement {
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
	setPreciseJumpPresentation(
		snapshot: ClientPreciseJumpSnapshot,
		runtime: ClientGameplayRuntime | undefined,
	): void {
		this.#preciseJumpActive = snapshot.active;
		if (snapshot.active) {
			this.#canvas.dataset.preciseJump = "active";
		} else {
			this.clearPreciseJumpMarker();
		}
		const evaluation = snapshot.marker;
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

	clearPreciseJumpMarker(): void {
		delete this.#canvas.dataset.preciseJump;
		this.#preciseJumpMarker = null;
		this.#preciseJumpActive = false;
	}

	resolveWorldPrimaryView(
		resources: ClientGameplayPresentationResources,
		player: DynamicEntityView,
		resolvedOrigin: ResolvedSceneOrigin,
		fieldOfView: number,
		nowMs: number,
		worldIdleBlocked: boolean,
		isDestroyed: () => boolean,
		onError: (error: unknown) => void,
	): CameraViewResolution {
		if (player.placement.kind !== "world") {
			throw new Error("Client camera requires a world-placed player.");
		}
		const extent = resources.runtime.resolveViewportExtent(
			this.#canvas.clientWidth,
			this.#canvas.clientHeight,
		);
		const projection = this.#resolveCameraProjection(extent, fieldOfView);
		this.#ensureCamera(player, projection, onError);
		const facingYaw = createEntityFacingCameraYaw(
			player.placement.pose.rotation,
		);
		const playerMovedOrTurned = this.#observePlayerMotion(
			resolvedOrigin,
			facingYaw,
		);
		const idleBlocked =
			worldIdleBlocked ||
			this.#preciseJumpActive ||
			playerMovedOrTurned ||
			player.placement.contact !== "grounded" ||
			this.camera.status().kind !== "active";
		this.camera.advance(nowMs, facingYaw, { idleBlocked });
		const submitCamera = this.camera.queueSynchronization(projection);
		if (submitCamera !== null) {
			this.#cameraSynchronization = this.#cameraSynchronization
				.then(() => {
					if (!isDestroyed()) return submitCamera();
				})
				.catch((error: unknown) => onError(error));
		}
		const presentation = this.camera.presentation(nowMs);
		if (presentation === null) {
			const cameraStatus = this.camera.status();
			return {
				kind: "waiting",
				status:
					cameraStatus.kind === "awaiting-first-path"
						? "loading-activation"
						: "loading-player",
				diagnostic: clientCameraWaitDiagnostic(cameraStatus),
			};
		}
		const camera = createClientCamera(
			player,
			resolvedOrigin,
			presentation,
			this.camera.acknowledgedProjection(nowMs),
			fieldOfView,
		);
		// A third-person boom can cross a cell boundary before the player's room changes.
		if (
			camera.placement.envCellId !== null &&
			!resources.runtime.hasEnvCellScope(camera.placement)
		) {
			return {
				kind: "waiting",
				status: "loading-activation",
				diagnostic: "Waiting for the camera's room to load.",
			};
		}
		return { kind: "ready", primaryView: { camera, extent } };
	}

	resolvePortalDestinationPrimaryView(
		resources: ClientGameplayPresentationResources,
		player: DynamicEntityView,
		origin: ResolvedSceneOrigin,
		fieldOfView: number,
		nowMs: number,
		onError: (error: unknown) => void,
	): CameraViewResolution {
		const extent = resources.runtime.resolveViewportExtent(
			this.#canvas.clientWidth,
			this.#canvas.clientHeight,
		);
		const projection = this.#resolveCameraProjection(extent, fieldOfView);
		this.#ensureCamera(player, projection, onError);
		const cameraPresentation = this.camera.presentation(nowMs);
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
		const camera = createClientCamera(
			player,
			origin,
			cameraPresentation,
			this.camera.acknowledgedProjection(nowMs),
			fieldOfView,
		);
		if (
			camera.placement.envCellId !== null &&
			!resources.runtime.hasEnvCellScope(camera.placement)
		) {
			return {
				kind: "waiting",
				status: "loading-activation",
				diagnostic: "Waiting for the destination camera's room to load.",
			};
		}
		return { kind: "ready", primaryView: { camera, extent } };
	}

	commitPrimaryView(
		runtime: ClientGameplayRuntime,
		primaryView: PrimaryCameraView,
		applyAudioListener: boolean,
	): void {
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
		runtime.setPrimaryView(primaryView);
		this.#lastPrimaryView = primaryView;
		if (applyAudioListener) {
			runtime.setAudioListener(audioListenerFor(camera));
		}
	}

	resetTarget(stopCamera: boolean, onError?: (error: unknown) => void): void {
		if (stopCamera) {
			void this.camera.stop().catch((error: unknown) => onError?.(error));
		}
		this.#cameraTarget = null;
		this.#hasLastPlayerPose = false;
	}

	resetOnDiscontinuity(onError: (error: unknown) => void): void {
		void this.camera.stop().catch((error: unknown) => onError(error));
		this.#cameraTarget = null;
		this.#cameraProjection = null;
		this.#lastPrimaryView = null;
		this.#hasLastPlayerPose = false;
	}

	awaitSynchronization(): Promise<void> {
		return this.#cameraSynchronization;
	}

	#observePlayerMotion(
		origin: ResolvedSceneOrigin,
		facingYaw: number,
	): boolean {
		const x = origin.landblockOrigin.x;
		const y = origin.landblockOrigin.y;
		const z = origin.landblockOrigin.z;
		let movedOrTurned = false;
		if (this.#hasLastPlayerPose) {
			const cellChanged =
				this.#lastPlayerLandblockId !== origin.landblockId ||
				this.#lastPlayerEnvCellId !== origin.envCellId;
			const dx = x - this.#lastPlayerOriginX;
			const dy = y - this.#lastPlayerOriginY;
			const dz = z - this.#lastPlayerOriginZ;
			const { positionThresholdMeters, yawThresholdRadians } =
				CLIENT_TUNING.camera.idleOrbit;
			const moved =
				cellChanged ||
				dx * dx + dy * dy + dz * dz >
					positionThresholdMeters * positionThresholdMeters;
			const yawDelta = Math.atan2(
				Math.sin(facingYaw - this.#lastPlayerFacingYaw),
				Math.cos(facingYaw - this.#lastPlayerFacingYaw),
			);
			movedOrTurned = moved || Math.abs(yawDelta) > yawThresholdRadians;
		}
		this.#hasLastPlayerPose = true;
		this.#lastPlayerLandblockId = origin.landblockId;
		this.#lastPlayerEnvCellId = origin.envCellId;
		this.#lastPlayerOriginX = x;
		this.#lastPlayerOriginY = y;
		this.#lastPlayerOriginZ = z;
		this.#lastPlayerFacingYaw = facingYaw;
		return movedOrTurned;
	}

	#resolveCameraProjection(
		extent: RenderExtent,
		fieldOfView: number,
	): ProjectionClearanceRevision {
		const current = this.#cameraProjection;
		if (
			current !== null &&
			current.extent.width === extent.width &&
			current.extent.height === extent.height &&
			current.fov === fieldOfView
		) {
			return current;
		}
		const projection = createProjectionClearanceRevision(
			(current?.revision ?? 0) + 1,
			{ fov: fieldOfView, near: CLIENT_TUNING.camera.near },
			extent,
		);
		this.#cameraProjection = projection;
		return projection;
	}

	#ensureCamera(
		player: DynamicEntityView,
		projection: ProjectionClearanceRevision,
		onError: (error: unknown) => void,
	): void {
		if (player.placement.kind !== "world") return;
		const target: ClientCameraTarget = {
			playerGuid: player.identity.guid,
			entityGeneration: player.generation,
		};
		if (
			this.#cameraTarget?.playerGuid === target.playerGuid &&
			this.#cameraTarget.entityGeneration === target.entityGeneration
		) {
			return;
		}
		this.#cameraTarget = target;
		this.#hasLastPlayerPose = false;
		this.camera.replaceLook({
			pitchRadians: CLIENT_TUNING.camera.pitchRadians,
			yawRadians: createEntityFacingCameraYaw(player.placement.pose.rotation),
		});
		void this.camera
			.start(target, CLIENT_TUNING.camera.distance, projection)
			.catch((error: unknown) => {
				if (this.#cameraTarget === target && !isAbortError(error)) {
					onError(error);
				}
			});
	}
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
		near: projection?.near ?? CLIENT_TUNING.camera.near,
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
	if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 0xffff_ffff) {
		throw new Error(`Client camera placement has invalid cell id ${value}.`);
	}
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
