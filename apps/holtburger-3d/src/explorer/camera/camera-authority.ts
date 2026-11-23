import type { CachedLandblockProfileSource } from "../../lib/assets/landblock-profile-source";
import { PossessionCameraController } from "../../lib/game/camera/possession-camera-controller";
import {
	hostKinematicBoomTransport,
	type HostKinematicBoomStatus,
} from "../../lib/game/camera/host-kinematic-boom-session";
import {
	createProjectionClearanceRevision,
	type ProjectionClearanceRevision,
} from "../../lib/game/camera/projection-clearance";
import type { CharacterInputController } from "../../lib/game/controls/character-input-controller";
import type { CharacterForwardSource } from "../../lib/game/controls/character-movement-arbiter";
import type { LandblockOwnerId } from "../../lib/game/game-types";
import { resolveCameraLookAtAngles } from "../../lib/game/math/camera-orientation";
import type { Vec3 } from "../../lib/game/math/types";
import {
	resolvePhysicalFlyViewDirection,
	resolvePhysicalFlyVelocity,
	resolvePhysicalFlyWheelDisplacement,
	type ExplorerCameraMode,
	type PhysicalFlyLocalMovement,
} from "../../lib/game/motion/host-physical-fly-path";
import type { HostCameraPlacement } from "../../lib/game/motion/host-placed-path";
import type { GamePresentationRuntime } from "../../lib/game/runtime/game-presentation-runtime";
import {
	SceneInterestRequestCoordinator,
	type SceneInterestTarget,
} from "../../lib/game/runtime/scene-target";
import type {
	PrimaryCameraView,
	SceneInterestRadii,
} from "../../lib/game/runtime/types";
import type { HostTransport } from "../../lib/host/host-transport";
import { AppInput } from "../../lib/input/app-input";
import type {
	CharacterAction,
	ClientMouseConfiguration,
	FlyAction,
	InputBindings,
	KeyBinding,
} from "../../lib/input/input-contract";
import { createInputDefaults } from "../../lib/input/input-defaults";
import { detectInputPlatform } from "../../lib/input/input-platform";
import type { KeyboardInputPolicy } from "../../lib/input/keyboard-input-policy";
import type { ViewportInputGate } from "../../lib/input/viewport-input-gate";
import {
	ExplorerCameraCoordinator,
	type ExplorerCameraFocusStatus,
	type ExplorerCameraResidencySync,
	type ExplorerSceneInterestSnapshot,
} from "./camera-coordinator";
import {
	ExplorerCameraInputController,
	type CharacterActionInput,
	type FrontendControlScheme,
	type PrimaryPointerOverlay,
} from "./camera-input-controller";
import {
	formatExplorerCameraResidency,
	type ExplorerCameraLocation,
} from "./camera-location";
import type { ExplorerPossession } from "../entities/entity-possession";
import type { ExplorerResidencyResolution } from "../world/residency";
import { EXPLORER_TUNING } from "../explorer-tuning";
import {
	PhysicalFlySession,
	type PhysicalFlyStatus,
} from "./physical-fly-session";
import { hostPhysicalFlyTransport } from "./physical-fly-transport";
import {
	SimulationInterestController,
	type SimulationInterestReceipt,
} from "../world/simulation-interest";
import { hostSimulationInterestTransport } from "../world/simulation-interest-transport";

export interface ExplorerPossessionOwnershipSnapshot {
	readonly input: CharacterInputController | undefined;
	readonly possessionGeneration: number | null;
}

/** Active Explorer scene context classified from the current landblock profile. */
export type ExplorerSceneContext = "outdoor" | "dungeon";

export interface ExplorerCameraAuthorityDependencies {
	readonly hostTransport: HostTransport;
	readonly isRuntimeReady: () => boolean;
	readonly hasPossession: () => boolean;
	readonly hasPossessionInput: () => boolean;
	readonly readPossessionOwnership: () => ExplorerPossessionOwnershipSnapshot;
	readonly readPossessedEntityFacingCameraYaw: () => number;
	readonly onCharacterInput: (input: CharacterActionInput) => void;
	readonly onPossessionForward?: (
		source: Exclude<CharacterForwardSource, "keyboard">,
		down: boolean,
	) => void;
	readonly onPossessionToggleAutoRun?: () => void;
	readonly onPossessionTurn?: (deltaRadians: number) => void;
	readonly onPossessionCancelTurn?: () => void;
	readonly onFlyAutoRunChange?: (enabled: boolean) => void;
	readonly onViewportClick?: (clientX: number, clientY: number) => void;
	readonly onViewportSecondaryClick?: (
		clientX: number,
		clientY: number,
	) => void;
	readonly primaryPointerOverlay?: PrimaryPointerOverlay;
	readonly onReleasePossession: () => Promise<unknown>;
	readonly onCameraFocusStatusChange: (
		status: ExplorerCameraFocusStatus,
	) => void;
	readonly onCameraResidencyLabelChange: (label: string | null) => void;
	readonly onSceneContextChange: (context: ExplorerSceneContext | null) => void;
	readonly onSceneInterestChange?: (
		interest: ExplorerSceneInterestSnapshot | null,
	) => void;
	readonly onCameraModeChange: (mode: ExplorerCameraMode) => void;
	readonly onCameraModePendingChange: (pending: boolean) => void;
	readonly onPhysicalCameraErrorChange: (error: string | null) => void;
	readonly onSceneInputBlockedChange: (blocked: boolean) => void;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Owns Explorer camera input, physical fly, boom camera, scene-interest requests, and
 * simulation-interest coordination outside Svelte reactive state.
 */
export class ExplorerCameraAuthorityController {
	sceneInterestCoordinator: SceneInterestRequestCoordinator | undefined;
	cameraCoordinator: ExplorerCameraCoordinator | undefined;
	cameraController: ExplorerCameraInputController | undefined;
	simulationInterestController: SimulationInterestController | undefined;
	physicalCameraSession: PhysicalFlySession | undefined;
	boomCameraSession: PossessionCameraController | undefined;
	cameraProjection: ProjectionClearanceRevision | undefined;
	private verticalFovDegrees: number = EXPLORER_TUNING.camera.framing.fov;
	private flySpeed: number = EXPLORER_TUNING.camera.controls.moveSpeed;
	cameraAuthorityReleaseForSceneChange: Promise<void> | undefined;
	physicalSimulationAnchor: string | null = null;
	cameraLocation: ExplorerCameraLocation | null = null;
	cameraYawRadians = 0;

	private physicalCameraStatus: PhysicalFlyStatus | null = null;
	private cameraMode: ExplorerCameraMode = "free-fly";
	private cameraModePending = false;
	private interestFollowsCamera = false;
	private lastPublishedResidencyLabel: string | null = null;
	private lastPublishedSceneContext: ExplorerSceneContext | null = null;
	private lastPublishedSceneInterest: ExplorerSceneInterestSnapshot | null =
		null;
	private canvasElement: HTMLCanvasElement | null = null;
	private gameRuntime: GamePresentationRuntime | undefined;

	constructor(private readonly deps: ExplorerCameraAuthorityDependencies) {}

	attachRuntime(params: {
		readonly canvas: HTMLCanvasElement;
		readonly gameRuntime: GamePresentationRuntime;
		readonly profileSource: CachedLandblockProfileSource;
		readonly inputGate: ViewportInputGate;
		readonly keyboard: KeyboardInputPolicy;
	}): void {
		this.canvasElement = params.canvas;
		this.gameRuntime = params.gameRuntime;
		this.sceneInterestCoordinator = new SceneInterestRequestCoordinator(
			params.profileSource,
		);
		this.cameraController = new ExplorerCameraInputController({
			inputGate: params.inputGate,
			keyboard: params.keyboard,
			input: new AppInput(
				createInputDefaults(detectInputPlatform(navigator.userAgent)),
			),
			canvas: params.canvas,
			keyboardYawRadiansPerSecond(precisionActive) {
				const controls = EXPLORER_TUNING.camera.controls;
				return (
					controls.keyboardYawRadiansPerSecond *
					(precisionActive ? controls.precisionSlowMultiplier : 1)
				);
			},
			onChange: (state) => {
				if (this.cameraCoordinator) {
					this.cameraCoordinator.handleCameraState(state);
				}
				this.sendPhysicalCameraIntent();
			},
			onCharacterInput: (input) => this.deps.onCharacterInput(input),
			onPhysicalWheel: (distance) => this.routeCameraWheel(distance),
			onFlyAutoRunChange: (enabled) => {
				this.deps.onFlyAutoRunChange?.(enabled);
			},
			onPossessionOrbitHeld: (held, nowMs) => {
				this.boomCameraSession?.setOrbitHeld(held, nowMs);
			},
			onPossessionFollowRear: (nowMs) => {
				this.boomCameraSession?.followRear(nowMs);
			},
			onPossessionPitch: (deltaY) => {
				this.boomCameraSession?.pitch(deltaY);
			},
			onPossessionOrbit: (deltaX, deltaY) => {
				this.boomCameraSession?.orbit(deltaX, deltaY, performance.now());
			},
			onPossessionTurn: (deltaRadians) => {
				this.deps.onPossessionTurn?.(deltaRadians);
			},
			onPossessionCancelTurn: () => {
				this.deps.onPossessionCancelTurn?.();
			},
			onPossessionForward: (source, down) => {
				this.deps.onPossessionForward?.(source, down);
			},
			onPossessionToggleAutoRun: () => {
				this.deps.onPossessionToggleAutoRun?.();
			},
			onPossessionWheel: (distance) => this.routeCameraWheel(distance),
			onViewportClick: (clientX, clientY) => {
				this.deps.onViewportClick?.(clientX, clientY);
			},
			onViewportSecondaryClick: (clientX, clientY) => {
				this.deps.onViewportSecondaryClick?.(clientX, clientY);
			},
			primaryPointerOverlay: this.deps.primaryPointerOverlay,
			onPointerLockError: (message) => {
				this.deps.onPhysicalCameraErrorChange(message);
			},
		});
		this.cameraController.setMoveSpeed(this.flySpeed);
		this.cameraCoordinator = new ExplorerCameraCoordinator(
			params.gameRuntime,
			this.cameraController,
			(status) => this.deps.onCameraFocusStatusChange(status),
		);
		this.simulationInterestController = new SimulationInterestController(
			hostSimulationInterestTransport(this.deps.hostTransport),
		);
	}

	async detach(): Promise<void> {
		const requestCoordinator = this.sceneInterestCoordinator;
		const coordinator = this.cameraCoordinator;
		const controller = this.cameraController;
		const physicalSession = this.physicalCameraSession;
		const boomSession = this.boomCameraSession;

		this.canvasElement = null;
		this.gameRuntime = undefined;
		this.publishCameraLocation(null);
		this.sceneInterestCoordinator = undefined;
		this.cameraCoordinator = undefined;
		this.cameraController = undefined;
		this.cameraProjection = undefined;
		this.physicalCameraSession = undefined;
		this.boomCameraSession = undefined;
		this.simulationInterestController = undefined;
		this.physicalSimulationAnchor = null;
		this.setCameraMode("free-fly");
		this.setCameraModePending(false);
		this.physicalCameraStatus = null;

		coordinator?.dispose();
		requestCoordinator?.invalidate();
		controller?.dispose();
		try {
			await boomSession?.stop();
		} finally {
			await physicalSession?.stop();
		}
	}

	private setCameraMode(mode: ExplorerCameraMode): void {
		this.cameraMode = mode;
		this.deps.onCameraModeChange(mode);
	}

	private setCameraModePending(pending: boolean): void {
		this.cameraModePending = pending;
		this.deps.onCameraModePendingChange(pending);
	}

	/** Apply saved/edited input bindings and mouse configuration live. */
	applyInputSettings(settings: {
		readonly flyBindings: InputBindings<FlyAction>;
		readonly characterBindings: InputBindings<CharacterAction>;
		readonly autoRunBindings: readonly KeyBinding[];
		readonly mouseConfig: ClientMouseConfiguration;
		readonly flyMouseConfig: {
			readonly invertFlyHorizontal: boolean;
			readonly invertFlyVertical: boolean;
		};
	}): void {
		this.cameraController?.replaceFlyBindings(settings.flyBindings);
		this.cameraController?.replaceCharacterBindings(settings.characterBindings);
		this.cameraController?.replaceAutoRunBindings(settings.autoRunBindings);
		this.cameraController?.setMouseConfiguration(settings.mouseConfig);
		this.cameraController?.setFlyMouseConfiguration(settings.flyMouseConfig);
	}

	/** Publish one frame's camera location, deriving its label so the two never drift apart. */
	publishCameraLocation(location: ExplorerCameraLocation | null): void {
		this.cameraLocation = location;
		const label =
			location === null
				? null
				: formatExplorerCameraResidency(location.residency);
		if (label !== this.lastPublishedResidencyLabel) {
			this.lastPublishedResidencyLabel = label;
			this.deps.onCameraResidencyLabelChange(label);
		}
		const sceneInterest =
			location === null
				? null
				: (this.cameraCoordinator?.sceneInterest() ?? null);
		const sceneContext: ExplorerSceneContext | null =
			sceneInterest?.target.kind ?? null;
		if (sceneContext !== this.lastPublishedSceneContext) {
			this.lastPublishedSceneContext = sceneContext;
			this.deps.onSceneContextChange(sceneContext);
		}
		if (sceneInterest !== this.lastPublishedSceneInterest) {
			this.lastPublishedSceneInterest = sceneInterest;
			this.deps.onSceneInterestChange?.(sceneInterest);
		}
	}

	setInterestFollowsCamera(enabled: boolean): void {
		this.interestFollowsCamera = enabled;
	}

	setAudioFollowsCamera(enabled: boolean): void {
		this.cameraCoordinator?.setAudioFollowsCamera(enabled);
	}

	/** Update outdoor streaming radii live without re-focusing or re-triggering portal transitions. */
	updateSceneInterestRadii(radii: SceneInterestRadii): void {
		const coordinator = this.cameraCoordinator;
		const requestCoordinator = this.sceneInterestCoordinator;
		const current = coordinator?.sceneInterest();
		if (!coordinator || !requestCoordinator || !current) return;
		const request = requestCoordinator.request(current.target.requested, radii);
		void request.promise
			.then((resolved) => {
				if (!requestCoordinator.isCurrent(request.revision)) return;
				if (!coordinator.applySceneInterestRadii(resolved)) return;
				const next = coordinator.sceneInterest();
				if (next !== this.lastPublishedSceneInterest) {
					this.lastPublishedSceneInterest = next;
					this.deps.onSceneInterestChange?.(next);
				}
			})
			.catch((error: unknown) => {
				if (requestCoordinator.isCurrent(request.revision)) {
					this.deps.onPhysicalCameraErrorChange(errorMessage(error));
				}
			});
	}

	readPhysicalCameraStatus(): PhysicalFlyStatus | null {
		return this.physicalCameraStatus;
	}

	readBoomCameraStatus(): HostKinematicBoomStatus | null {
		return this.boomCameraSession?.status() ?? null;
	}

	presentedPlacement(): HostCameraPlacement | null {
		return this.cameraCoordinator?.presentedPlacement() ?? null;
	}

	/** Exact camera/extent pair most recently presented to the renderer. */
	lastPrimaryView(): PrimaryCameraView | null {
		return this.cameraCoordinator?.lastPrimaryView() ?? null;
	}

	/** Cancel any active overlay primary drag (Escape, HUD hide, selection switch). */
	cancelPrimaryDrag(): boolean {
		return this.cameraController?.cancelPrimaryDrag() ?? false;
	}

	sceneInterestSnapshot() {
		return this.cameraCoordinator?.sceneInterest() ?? null;
	}

	cameraSnapshotState() {
		return this.cameraController?.snapshotState() ?? null;
	}

	pollSceneActivation(): void {
		this.cameraCoordinator?.pollSceneActivation();
	}

	activationReady(): boolean {
		return this.cameraCoordinator?.activationReady() ?? false;
	}

	activationPending(): boolean {
		return this.cameraCoordinator?.activationPending() ?? false;
	}

	completeSceneActivation(): void {
		this.cameraCoordinator?.completeSceneActivation();
	}

	hasActiveBoomCamera(): boolean {
		return this.boomCameraSession !== undefined;
	}

	receiveBoomFrame(
		boom: Parameters<PossessionCameraController["receive"]>[0],
		durationMs: number,
		receivedAtMs: number,
	): void {
		this.boomCameraSession?.receive(boom, durationMs, receivedAtMs);
	}

	setBoomTranslationIntent(active: boolean, nowMs: number): void {
		this.boomCameraSession?.setTranslationIntent(active, nowMs);
	}

	pollPhysicalCamera(): HostCameraPlacement | null {
		const activePhysicalSession = this.physicalCameraSession;
		const terminalError = activePhysicalSession?.takeTerminalError() ?? null;
		if (
			terminalError !== null &&
			this.physicalCameraSession === activePhysicalSession
		) {
			this.deps.onPhysicalCameraErrorChange(errorMessage(terminalError));
			void this.leavePhysicalCamera(true);
		}
		const physicalPlacement = this.physicalCameraSession?.placement() ?? null;
		if (physicalPlacement && this.cameraController) {
			this.cameraController.applyPresentedPosition(physicalPlacement.position);
			this.physicalCameraStatus = this.physicalCameraSession?.status() ?? null;
			this.followPhysicalSimulationInterest(
				physicalPlacement.residency.landblockId,
			);
		}
		return physicalPlacement;
	}

	syncFrameCamera(
		physicalPlacement: HostCameraPlacement | null,
		gameRuntime: GamePresentationRuntime,
		canvas: HTMLCanvasElement,
		nowMs: number,
	): ExplorerCameraResidencySync {
		const projection = this.resolveCameraProjection(gameRuntime, canvas);
		const residencySync = this.syncActiveCamera(
			physicalPlacement,
			nowMs,
			projection,
		);
		if (!residencySync) {
			throw new Error(
				"Explorer camera coordinator is unavailable during rendering.",
			);
		}
		this.publishCameraLocation(residencySync.location);
		// Only the free-fly controller's yaw is authoritative here; while a boom runs it
		// publishes its own, because the controller is not the one turning.
		if (this.boomCameraSession === undefined) {
			this.cameraYawRadians =
				this.cameraController?.snapshotState().yawRadians ??
				this.cameraYawRadians;
		}
		const followResidency = residencySync.location?.residency;
		if (this.interestFollowsCamera && followResidency) {
			this.followCameraSceneInterest(followResidency);
		}
		return residencySync;
	}

	/**
	 * Carry follow-mode re-anchoring into simulation interest, which the coordinator does not own.
	 *
	 * The coordinator holds the target snapshot and decides whether the camera's residency is a
	 * crossing worth following, so this only mirrors a move it already made.
	 */
	followCameraSceneInterest(resolution: ExplorerResidencyResolution): void {
		const coordinator = this.cameraCoordinator;
		const requestCoordinator = this.sceneInterestCoordinator;
		const pending = coordinator?.prepareFollowCameraResidency(resolution);
		if (!coordinator || !requestCoordinator || !pending) return;
		const request = requestCoordinator.request(pending.target, pending.radii);
		void request.promise
			.then((resolved) => {
				if (!requestCoordinator.isCurrent(request.revision)) {
					coordinator.rejectFollowCameraResidency(pending);
					return;
				}
				if (!coordinator.applyFollowCameraResidency(pending, resolved)) return;
				void this.requestSimulationInterest(
					pending.residency.landblockId,
					"follow",
				).catch((error: unknown) => {
					this.deps.onPhysicalCameraErrorChange(errorMessage(error));
				});
			})
			.catch((error: unknown) => {
				coordinator.rejectFollowCameraResidency(pending);
				if (requestCoordinator.isCurrent(request.revision)) {
					this.deps.onPhysicalCameraErrorChange(errorMessage(error));
				}
			});
	}

	requestSceneInterest(
		target: SceneInterestTarget,
		radii: SceneInterestRadii,
	): void {
		const requestCoordinator = this.sceneInterestCoordinator;
		if (!requestCoordinator) {
			this.deps.onPhysicalCameraErrorChange(
				"Scene-interest resolution is not initialized.",
			);
			return;
		}
		// Reserve the revision before releasing camera authority so a newer target supersedes this
		// request while the handoff is in flight; the resolved target is not applied until release.
		const request = requestCoordinator.request(target, radii);
		void (async () => {
			try {
				if (this.deps.hasPossession() || this.boomCameraSession !== undefined) {
					this.deps.onCameraFocusStatusChange(
						"Releasing possession before scene-interest change.",
					);
				}
				await this.releaseCameraAuthorityForSceneChange();
			} catch (error: unknown) {
				if (!requestCoordinator.isCurrent(request.revision)) return;
				this.deps.onCameraFocusStatusChange(
					`Scene-interest change failed: Could not release camera authority: ${errorMessage(error)}`,
				);
				return;
			}

			try {
				const resolved = await request.promise;
				if (!requestCoordinator.isCurrent(request.revision)) return;
				void this.requestSimulationInterest(
					resolved.target.requested.landblockId,
					"replace",
				).catch((error: unknown) => {
					this.deps.onPhysicalCameraErrorChange(errorMessage(error));
				});
				this.deps.onSceneInputBlockedChange(true);
				if (this.cameraCoordinator !== undefined) {
					await this.cameraCoordinator.requestSceneInterest(
						resolved,
						request.revision,
					);
				}
			} catch (error: unknown) {
				if (!requestCoordinator.isCurrent(request.revision)) return;
				this.deps.onCameraFocusStatusChange(
					`Scene target unavailable: ${errorMessage(error)}`,
				);
			}
		})();
	}

	async resolveSpawnAuthority(): Promise<{
		readonly placement: HostCameraPlacement;
		readonly viewDirection: [number, number, number];
	}> {
		const coordinator = this.cameraCoordinator;
		const controller = this.cameraController;
		if (!coordinator || !controller) {
			throw new Error("Explorer entity spawning requires an active runtime.");
		}
		const initialPlacement = coordinator.presentedPlacement();
		if (initialPlacement === null) {
			throw new Error("Spawn requires a currently presented camera placement.");
		}
		const ownership = this.deps.readPossessionOwnership();
		const interest = await this.awaitCurrentSimulationInterest(
			initialPlacement.residency.landblockId,
		);
		const placement = this.requireStablePresentedPlacement(
			initialPlacement,
			coordinator.presentedPlacement(),
			interest,
		);
		this.requireStableCameraOwnership(ownership);
		return {
			placement,
			viewDirection: this.physicalCameraInput(controller).viewDirection,
		};
	}

	private async requestSimulationInterest(
		anchorLandblockId: LandblockOwnerId,
		mode: "ensure" | "follow" | "replace",
	): Promise<SimulationInterestReceipt> {
		const controller = this.simulationInterestController;
		if (!controller) {
			throw new Error("Simulation-interest policy is not initialized.");
		}
		const receipt = await controller[mode](anchorLandblockId);
		// A newer application anchor superseding this request is ordinary asynchronous currentness.
		if (!receipt.committed) return receipt;
		if (
			receipt.unavailableLandblockIds.some(
				(owner) => owner.toLowerCase() === anchorLandblockId.toLowerCase(),
			)
		) {
			throw new Error(
				`Collision content is unavailable for ${anchorLandblockId}.`,
			);
		}
		return receipt;
	}

	/** Await collision authority for a mutation that is about to enter the host. */
	private async awaitCurrentSimulationInterest(
		anchorLandblockId: LandblockOwnerId,
	): Promise<SimulationInterestReceipt> {
		const receipt = await this.requestSimulationInterest(
			anchorLandblockId,
			"ensure",
		);
		if (!receipt.committed) {
			throw new Error(
				`Collision interest for ${anchorLandblockId} was superseded before the operation could start.`,
			);
		}
		const controller = this.simulationInterestController;
		if (
			controller === undefined ||
			!controller.isCurrent(anchorLandblockId, receipt.revision)
		) {
			throw new Error(
				`Collision interest for ${anchorLandblockId} changed before the operation could start.`,
			);
		}
		return receipt;
	}

	/** A handoff is valid only when the exact presented pose and residency survived the await. */
	private requireStablePresentedPlacement(
		before: HostCameraPlacement,
		after: HostCameraPlacement | null,
		interest: SimulationInterestReceipt,
	): HostCameraPlacement {
		const controller = this.simulationInterestController;
		if (after === null) {
			throw new Error(
				"Camera placement disappeared while collision interest loaded.",
			);
		}
		if (
			controller === undefined ||
			!controller.isCurrent(before.residency.landblockId, interest.revision)
		) {
			throw new Error(
				"Camera placement changed while collision interest loaded.",
			);
		}
		if (
			after.residency.landblockId !== before.residency.landblockId ||
			after.residency.envCellId !== before.residency.envCellId ||
			after.position.x !== before.position.x ||
			after.position.y !== before.position.y ||
			after.position.z !== before.position.z
		) {
			throw new Error(
				"Camera placement changed while collision interest loaded.",
			);
		}
		return after;
	}

	private requireStableCameraOwnership(
		token: ExplorerPossessionOwnershipSnapshot,
	): void {
		const current = this.deps.readPossessionOwnership();
		if (
			current.input !== token.input ||
			current.possessionGeneration !== token.possessionGeneration
		) {
			throw new Error(
				"Camera ownership changed while collision interest loaded.",
			);
		}
	}

	private followPhysicalSimulationInterest(
		anchorLandblockId: LandblockOwnerId,
	): void {
		if (this.physicalSimulationAnchor === anchorLandblockId) return;
		this.physicalSimulationAnchor = anchorLandblockId;
		void this.requestSimulationInterest(anchorLandblockId, "follow").catch(
			(error: unknown) => {
				if (this.physicalSimulationAnchor === anchorLandblockId) {
					this.physicalSimulationAnchor = null;
				}
				this.deps.onPhysicalCameraErrorChange(errorMessage(error));
			},
		);
	}

	private physicalCameraInput(controller: ExplorerCameraInputController): {
		readonly basis: {
			readonly forward: [number, number, number];
			readonly right: [number, number, number];
			readonly up: [number, number, number];
		};
		readonly viewDirection: [number, number, number];
		readonly worldVelocity: [number, number, number];
	} {
		const { basis, movement, precision } = controller.physicalFlyInput();
		const tuple = (vector: Vec3): [number, number, number] => [
			vector.x,
			vector.y,
			vector.z,
		];
		const cameraBasis = {
			forward: tuple(basis.forward),
			right: tuple(basis.right),
			up: tuple(basis.up),
		};
		const worldVelocity = resolvePhysicalFlyVelocity(
			movement as PhysicalFlyLocalMovement,
			cameraBasis,
			this.flySpeed *
				(precision
					? EXPLORER_TUNING.camera.controls.precisionSlowMultiplier
					: 1),
		);
		return {
			basis: cameraBasis,
			viewDirection: resolvePhysicalFlyViewDirection(cameraBasis),
			worldVelocity,
		};
	}

	private sendPhysicalCameraIntent(): void {
		const session = this.physicalCameraSession;
		const controller = this.cameraController;
		if (!session?.running || !controller) return;
		const input = this.physicalCameraInput(controller);
		void session.setIntent(input.worldVelocity).catch((error: unknown) => {
			if (this.physicalCameraSession !== session) return;
			this.deps.onPhysicalCameraErrorChange(errorMessage(error));
		});
	}

	routeCameraWheel(localUpDistance: number): void {
		if (this.boomCameraSession) {
			this.boomCameraSession.zoom(
				-localUpDistance * EXPLORER_TUNING.camera.boom.zoomDistanceMultiplier,
			);
			return;
		}
		const session = this.physicalCameraSession;
		const controller = this.cameraController;
		if (!session?.running || !controller) return;
		const input = this.physicalCameraInput(controller);
		void session
			.addDisplacement(
				resolvePhysicalFlyWheelDisplacement(input.basis, localUpDistance),
				input.worldVelocity,
			)
			.catch((error: unknown) => {
				if (this.physicalCameraSession !== session) return;
				this.deps.onPhysicalCameraErrorChange(errorMessage(error));
			});
	}

	private controlSchemeForCameraMode(
		mode: ExplorerCameraMode,
	): FrontendControlScheme {
		if (mode === "free-fly") return { kind: "free-fly" };
		return { kind: "physical-fly" };
	}

	private restoreCameraControlScheme(): void {
		const controller = this.cameraController;
		if (controller === undefined) return;
		if (this.deps.hasPossessionInput()) {
			controller.setControlScheme({ kind: "possessed-character" });
			return;
		}
		if (this.physicalCameraSession !== undefined) {
			controller.setControlScheme(
				this.controlSchemeForCameraMode(this.cameraMode),
			);
			return;
		}
		controller.setControlScheme({ kind: "free-fly" });
	}

	private nonPossessionCameraControlScheme(): FrontendControlScheme {
		return this.physicalCameraSession === undefined
			? { kind: "free-fly" }
			: this.controlSchemeForCameraMode(this.cameraMode);
	}

	setPossessedControlScheme(): void {
		this.cameraController?.setControlScheme({ kind: "possessed-character" });
	}

	restoreNonPossessionControlScheme(): void {
		this.cameraController?.setControlScheme(
			this.nonPossessionCameraControlScheme(),
		);
	}

	async enterPhysicalCamera(): Promise<void> {
		const controller = this.cameraController;
		if (!controller || this.physicalCameraSession || this.cameraModePending)
			return;
		const placement = this.cameraCoordinator?.presentedPlacement() ?? null;
		if (placement === null) {
			this.deps.onPhysicalCameraErrorChange(
				"Physical camera requires a currently rendered camera placement.",
			);
			return;
		}
		const ownership = this.deps.readPossessionOwnership();
		this.setCameraModePending(true);
		this.deps.onPhysicalCameraErrorChange(null);
		controller.setControlScheme(
			this.deps.hasPossessionInput()
				? { kind: "possessed-character" }
				: this.controlSchemeForCameraMode("physical-fly"),
		);
		const session = new PhysicalFlySession(
			hostPhysicalFlyTransport(this.deps.hostTransport),
		);
		try {
			const interest = await this.awaitCurrentSimulationInterest(
				placement.residency.landblockId,
			);
			const stablePlacement = this.requireStablePresentedPlacement(
				placement,
				this.cameraCoordinator?.presentedPlacement() ?? null,
				interest,
			);
			this.requireStableCameraOwnership(ownership);
			await session.start(stablePlacement);
			const currentOwnership = this.deps.readPossessionOwnership();
			if (
				this.cameraController !== controller ||
				!this.deps.isRuntimeReady() ||
				currentOwnership.input !== ownership.input ||
				currentOwnership.possessionGeneration !== ownership.possessionGeneration
			) {
				await session.stop();
				this.setCameraMode("free-fly");
				this.restoreCameraControlScheme();
				return;
			}
			this.physicalCameraSession = session;
			this.setCameraMode("physical-fly");
			this.restoreCameraControlScheme();
			this.sendPhysicalCameraIntent();
		} catch (error) {
			this.restoreCameraControlScheme();
			this.deps.onPhysicalCameraErrorChange(errorMessage(error));
		} finally {
			this.setCameraModePending(false);
		}
	}

	async leavePhysicalCamera(preserveResidency: boolean): Promise<void> {
		const session = this.physicalCameraSession;
		const controller = this.cameraController;
		if (!session || !controller) return;
		const lastHostResidency =
			this.cameraCoordinator?.presentedPlacement()?.residency ??
			session.placement()?.residency ??
			null;
		// Detach presentation first: no late segment can move the frontend pose after handoff.
		controller.setControlScheme(
			this.deps.hasPossessionInput()
				? { kind: "possessed-character" }
				: { kind: "free-fly" },
		);
		this.physicalCameraSession = undefined;
		const presented = controller.snapshotState();
		controller.adoptPresentedPose(presented);
		if (preserveResidency && lastHostResidency !== null) {
			this.cameraCoordinator?.seedFreeFlyResidency(lastHostResidency);
		}
		this.setCameraMode("free-fly");
		this.restoreCameraControlScheme();
		this.physicalCameraStatus = null;
		try {
			await session.stop();
		} catch (error) {
			this.deps.onPhysicalCameraErrorChange(errorMessage(error));
		}
	}

	updateCameraMode(mode: ExplorerCameraMode): void {
		if (mode === this.cameraMode || this.cameraModePending) return;
		if (mode === "free-fly") {
			void this.leavePhysicalCamera(true);
		} else if (!this.physicalCameraSession) {
			void this.enterPhysicalCamera();
		}
	}

	async beginBoomCamera(possession: ExplorerPossession): Promise<void> {
		if (possession.guid === null) {
			throw new Error("A released possession cannot start a host boom.");
		}
		// The same authority transfer a physical camera performs: the drive keys belong to the
		// possessed entity, so free fly must stop translating or both would consume them.
		this.cameraController?.setControlScheme({ kind: "possessed-character" });
		const previous = this.boomCameraSession;
		this.boomCameraSession = undefined;
		await previous?.stop();
		const controller = this.cameraController;
		if (controller === undefined) {
			throw new Error(
				"Host boom registration requires an active camera controller.",
			);
		}
		const state = controller.snapshotState();
		const controls = EXPLORER_TUNING.camera.controls;
		const boom = new PossessionCameraController({
			initialLook: state,
			orbit: {
				maximumPitchRadians: controls.maximumPitchRadians,
				pitchRadiansPerPixel: controls.pointerPitchRadiansPerPixel,
				yawRadiansPerPixel: controls.pointerYawRadiansPerPixel,
			},
			recenter: {
				delayMs: EXPLORER_TUNING.camera.boom.recenterDelayMs,
				durationMs: EXPLORER_TUNING.camera.boom.recenterDurationMs,
			},
			transport: hostKinematicBoomTransport(this.deps.hostTransport),
		});
		this.boomCameraSession = boom;
		const runtime = this.gameRuntime;
		const canvas = this.canvasElement;
		if (runtime === undefined || canvas === null) {
			throw new Error("Host boom registration requires an active viewport.");
		}
		const initialPlacement =
			this.cameraCoordinator?.presentedPlacement() ?? null;
		if (initialPlacement === null) {
			throw new Error(
				"Host boom registration requires a presented camera placement.",
			);
		}
		const ownership = this.deps.readPossessionOwnership();
		const interest = await this.awaitCurrentSimulationInterest(
			initialPlacement.residency.landblockId,
		);
		this.requireStablePresentedPlacement(
			initialPlacement,
			this.cameraCoordinator?.presentedPlacement() ?? null,
			interest,
		);
		this.requireStableCameraOwnership(ownership);
		const projection = this.resolveCameraProjection(runtime, canvas);
		await boom.start(
			{
				possessionGeneration: possession.possessionGeneration,
				guid: possession.guid,
				entityGeneration: possession.entityGeneration,
			},
			EXPLORER_TUNING.camera.boom.distance,
			projection,
		);
	}

	async endBoomCamera(): Promise<void> {
		// Free fly resumes from wherever the boom left the camera, because `applyPresentedPosition`
		// has been writing that position every frame; only translation authority returns here.
		const boom = this.boomCameraSession;
		this.boomCameraSession = undefined;
		const controller = this.cameraController;
		if (boom !== undefined && controller !== undefined) {
			const state = controller.snapshotState();
			controller.adoptPresentedPose({
				...boom.desiredLook(),
				position: state.position,
			});
		}
		this.restoreCameraControlScheme();
		await boom?.stop();
	}

	/**
	 * Route one frame to whichever camera currently owns position.
	 *
	 * Three owners in priority order, and the order matters: a boom outranks a physical session
	 * because possession is the more specific state. A possessed entity that is momentarily
	 * unpresented — an ordinary condition while presentation realizes — falls through to free
	 * fly, which holds still rather than drifting, since the boom has been writing its position
	 * into the controller every frame and possession has taken the drive keys away.
	 */
	syncActiveCamera(
		physicalPlacement: HostCameraPlacement | null,
		nowMs: number,
		projection: ProjectionClearanceRevision,
	): ExplorerCameraResidencySync | undefined {
		if (this.boomCameraSession) return this.syncBoomCamera(nowMs, projection);
		if (this.physicalCameraSession || this.cameraModePending) {
			return this.cameraCoordinator?.syncPhysicalCamera(
				physicalPlacement,
				projection,
			);
		}
		return this.cameraCoordinator?.syncFreeFlyCamera(projection);
	}

	/**
	 * Sample the host boom and hand its atomic position, pivot, and residency to the coordinator.
	 *
	 * The look controller retains the operator's desired yaw/pitch for subsequent host intent. The
	 * rendered orientation instead follows the same host path as position, preventing desired input
	 * from visually outrunning collision-safe boom motion.
	 */
	syncBoomCamera(
		nowMs: number,
		projection: ProjectionClearanceRevision,
	): ExplorerCameraResidencySync | undefined {
		const boom = this.boomCameraSession;
		const controller = this.cameraController;
		const coordinator = this.cameraCoordinator;
		if (!boom || !controller || !coordinator) return undefined;
		void boom
			.synchronize(
				projection,
				nowMs,
				this.deps.readPossessedEntityFacingCameraYaw(),
			)
			.catch((error: unknown) => {
				if (this.boomCameraSession === boom) {
					this.deps.onPhysicalCameraErrorChange(errorMessage(error));
				}
			});
		const desiredOrientation = boom.desiredLook();
		const presentation = boom.presentation(nowMs);
		const acknowledgedProjection = boom.acknowledgedProjection(nowMs);
		if (acknowledgedProjection === null) {
			return {
				location: null,
				renderable: false,
				requiresFlatEnvCellRenderMode: false,
			};
		}
		if (presentation === null) {
			const placement = coordinator.presentedPlacement();
			if (placement === null) return undefined;
			this.cameraYawRadians = desiredOrientation.yawRadians;
			return coordinator.syncBoomCamera(
				placement,
				desiredOrientation.yawRadians,
				desiredOrientation.pitchRadians,
				acknowledgedProjection,
			);
		}
		const { placement, visualPivot } = presentation;
		// A reseed instant carries no look direction. The operator's desired orbit is what the boom
		// is about to spring back out along, which is what the unpresented branch above uses too.
		const orientation =
			resolveCameraLookAtAngles(placement.position, visualPivot) ??
			desiredOrientation;
		controller.applyPresentedPosition(placement.position);
		// Published where it is decided: the boom owns orientation while it is running, and the
		// free-fly controller only receives position, so reading yaw from that controller here
		// would hand the map a bearing from before possession began.
		this.cameraYawRadians = orientation.yawRadians;
		return coordinator.syncBoomCamera(
			placement,
			orientation.yawRadians,
			orientation.pitchRadians,
			acknowledgedProjection,
		);
	}

	setVerticalFovDegrees(fov: number): void {
		if (!Number.isFinite(fov) || fov <= 0) return;
		this.verticalFovDegrees = fov;
	}

	getFlySpeed(): number {
		return this.flySpeed;
	}

	setFlySpeed(speed: number): void {
		if (!Number.isFinite(speed) || speed <= 0) return;
		this.flySpeed = speed;
		this.cameraController?.setMoveSpeed(speed);
	}

	private resolveCameraProjection(
		runtime: GamePresentationRuntime,
		canvas: HTMLCanvasElement,
	): ProjectionClearanceRevision {
		const extent = runtime.resolveViewportExtent(
			canvas.clientWidth,
			canvas.clientHeight,
		);
		const framing = EXPLORER_TUNING.camera.framing;
		const fov = this.verticalFovDegrees;
		const current = this.cameraProjection;
		if (
			current !== undefined &&
			current.fov === fov &&
			current.near === framing.near &&
			current.extent.width === extent.width &&
			current.extent.height === extent.height
		) {
			return current;
		}
		const revision = (current === undefined ? 0 : current.revision) + 1;
		if (!Number.isSafeInteger(revision)) {
			throw new Error("Explorer camera projection revision exhausted.");
		}
		this.cameraProjection = createProjectionClearanceRevision(
			revision,
			{ ...framing, fov },
			extent,
		);
		return this.cameraProjection;
	}

	/** Return camera authority to the frontend before a target focus can replace the scene. */
	async releaseCameraAuthorityForSceneChange(): Promise<void> {
		const pendingRelease = this.cameraAuthorityReleaseForSceneChange;
		if (pendingRelease !== undefined) {
			await pendingRelease;
			return;
		}
		if (
			this.physicalCameraSession === undefined &&
			!this.deps.hasPossession() &&
			this.boomCameraSession === undefined
		) {
			return;
		}

		const release = (async () => {
			// Physical fly and possession can briefly overlap while an authority handoff is pending;
			// stop the host camera before releasing the character so neither can overwrite the focus pose.
			if (this.physicalCameraSession !== undefined) {
				await this.leavePhysicalCamera(false);
			}
			if (this.deps.hasPossession() || this.boomCameraSession !== undefined) {
				await this.deps.onReleasePossession();
			}
		})();
		this.cameraAuthorityReleaseForSceneChange = release;
		try {
			await release;
		} finally {
			if (this.cameraAuthorityReleaseForSceneChange === release) {
				this.cameraAuthorityReleaseForSceneChange = undefined;
			}
		}
	}
}
