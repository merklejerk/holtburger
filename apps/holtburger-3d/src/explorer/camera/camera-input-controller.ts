import { EXPLORER_TUNING } from "../explorer-tuning";
import { EXPLORER_FLY_SPEED_RANGE } from "../settings/explorer-settings-defaults";
import { createCameraAxesRadians } from "../../lib/game/math/camera-orientation";
import { Vec3 } from "../../lib/game/math/types";
import {
	clamp,
	normalizeVec3,
	scaleVec3,
} from "../../lib/game/math/vector-utils";
import { CameraLookController } from "../../lib/game/controls/camera-look-controller";
import type { CharacterForwardSource } from "../../lib/game/controls/character-movement-arbiter";
import type { KeyboardInputPolicy } from "../../lib/input/keyboard-input-policy";
import { InputContext } from "../../lib/input/input-context";
import type { AppInput } from "../../lib/input/app-input";
import type { ViewportInputGate } from "../../lib/input/viewport-input-gate";
import {
	advanceViewportPointerGesture,
	beginViewportPointerGesture,
	type ViewportPointerGesture,
} from "../../lib/input/viewport-pointer-gesture";
import { PointerLockSession } from "../../lib/input/viewport-pointer-lock";
import {
	type CharacterAction,
	type ClientMouseConfiguration,
	type FlyAction,
	type InputBindings,
	type KeyBinding,
} from "../../lib/input/input-contract";

type MovementAction = Exclude<FlyAction, "precision">;

const LEFT = 1;
const RIGHT = 2;
const MIDDLE = 4;

/** Dimensionless local translation input shared with the host-solved camera adapter. */
export interface CameraLocalMovement {
	readonly forward: number;
	readonly right: number;
	readonly up: number;
}

/** Explorer-owned camera pose, independent of runtime residency and camera framing. */
export interface FreeFlyCameraPose {
	readonly pitchRadians: number;
	readonly position: Vec3;
	readonly yawRadians: number;
}

export interface FreeFlyCameraState extends FreeFlyCameraPose {
	/** True after user input, allowing pending automatic placement to be cancelled. */
	readonly hasManualControl: boolean;
}

/** Complete, mutually exclusive canvas-input owner selected by the entry point. */
export type FrontendControlScheme =
	| { readonly kind: "free-fly" }
	| { readonly kind: "physical-fly" }
	| { readonly kind: "possessed-character" };

/** Explorer-owned fly-camera look inversion, independent of Client's orbit camera. */
export interface ExplorerFlyMouseConfiguration {
	readonly invertFlyHorizontal: boolean;
	readonly invertFlyVertical: boolean;
}

const DEFAULT_MOUSE_CONFIG: ClientMouseConfiguration = {
	mouseMovement: true,
	invertCameraHorizontal: false,
	invertCameraVertical: false,
	invertSteeringHorizontal: false,
	invertSteeringVertical: false,
};

const DEFAULT_FLY_MOUSE_CONFIG: ExplorerFlyMouseConfiguration = {
	invertFlyHorizontal: false,
	invertFlyVertical: false,
};

export interface ExplorerCameraInputControllerOptions {
	readonly canvas: HTMLCanvasElement;
	/** Resolved app input policy supplied by the composition root. */
	readonly input: AppInput;
	/** Shared viewport availability and cancellation boundary for this mounted app. */
	readonly inputGate: ViewportInputGate;
	/** App-owned keyboard routing, independent of canvas focus. */
	readonly keyboard: KeyboardInputPolicy;
	readonly onChange: (state: FreeFlyCameraState) => void;
	/** Sends vertical wheel displacement to the host-owned physical-fly camera policy. */
	readonly onPhysicalWheel?: (localUpDistance: number) => void;
	/** Notifies when fly-camera autorun is toggled or retired. */
	readonly onFlyAutoRunChange?: (enabled: boolean) => void;
	/** Suspends/resumes automatic boom recentering during held orbit. */
	readonly onPossessionOrbitHeld?: (held: boolean, nowMs: number) => void;
	/** Enters sticky rear-follow during right-drag or mouse-forward steering. */
	readonly onPossessionFollowRear?: (nowMs: number) => void;
	/** Vertical pitch delta during right-drag steering. */
	readonly onPossessionPitch?: (deltaY: number) => void;
	/** Forwards raw orbit deltas only while Explorer has delegated to possession camera policy. */
	readonly onPossessionOrbit: (deltaX: number, deltaY: number) => void;
	/** Relative AC facing yaw displacement in radians during right-drag steering. */
	readonly onPossessionTurn?: (deltaRadians: number) => void;
	/** Cancels queued steering yaw on capture loss. */
	readonly onPossessionCancelTurn?: () => void;
	/** Mouse-button forward sources (middle button or left+right chord) in possession mode. */
	readonly onPossessionForward?: (
		source: Exclude<CharacterForwardSource, "keyboard">,
		down: boolean,
	) => void;
	/** Toggles persistent autorun in possession mode. */
	readonly onPossessionToggleAutoRun?: () => void;
	/** Forwards wheel distance only while Explorer has delegated to possession camera policy. */
	readonly onPossessionWheel: (localUpDistance: number) => void;
	/** Publishes character actions without assigning grounded movement behavior here. */
	readonly onCharacterInput: (input: CharacterActionInput) => void;
	/** Fires on an undragged left-click on the viewport canvas (used for 3D entity selection). */
	readonly onViewportClick?: (clientX: number, clientY: number) => void;
	/** Fires on an undragged right-click on the viewport canvas (used for 3D entity inspection). */
	readonly onViewportSecondaryClick?: (
		clientX: number,
		clientY: number,
	) => void;
	/** Surface pointer-lock errors without swallowing them. */
	readonly onPointerLockError?: (message: string) => void;
	/** Resolves the app regime's complete keyboard-yaw rate without teaching this controller its modes. */
	readonly keyboardYawRadiansPerSecond?: (precisionActive: boolean) => number;
	readonly requestAnimationFrame?: (callback: FrameRequestCallback) => number;
	readonly cancelAnimationFrame?: (handle: number) => void;
}

/** Semantic action lifecycle consumed only when the app selects a character-control regime. */
export type CharacterActionInput =
	| {
			readonly action: CharacterAction;
			readonly kind: "action";
			readonly pressed: boolean;
	  }
	| { readonly kind: "reset" };

const DEFAULT_STATE: FreeFlyCameraState = {
	hasManualControl: false,
	pitchRadians: EXPLORER_TUNING.camera.initialOrientation.pitchRadians,
	position: Vec3.zero(),
	yawRadians: EXPLORER_TUNING.camera.initialOrientation.yawRadians,
};
const CAMERA_CONTROL_TUNING = EXPLORER_TUNING.camera.controls;

/**
 * Explorer camera behavior consumes configured fly/character actions and pointer-locked
 * viewport gestures. Grounded possession movement, steering yaw, and 3D picking remain
 * delegated to their own owners.
 */
export class ExplorerCameraInputController {
	readonly #inputGate: ViewportInputGate;
	readonly #detachGestures: () => void;
	readonly #detachKeyboard: () => void;
	readonly #canvas: HTMLCanvasElement;
	readonly #window: Window;
	readonly #pointerLock: PointerLockSession;
	readonly #onChange: (state: FreeFlyCameraState) => void;
	readonly #onPhysicalWheel: ((localUpDistance: number) => void) | undefined;
	readonly #onFlyAutoRunChange: ((enabled: boolean) => void) | undefined;
	readonly #onPossessionOrbitHeld:
		((held: boolean, nowMs: number) => void) | undefined;
	readonly #onPossessionFollowRear: ((nowMs: number) => void) | undefined;
	readonly #onPossessionPitch: ((deltaY: number) => void) | undefined;
	readonly #onPossessionOrbit: (deltaX: number, deltaY: number) => void;
	readonly #onPossessionTurn: ((deltaRadians: number) => void) | undefined;
	readonly #onPossessionCancelTurn: (() => void) | undefined;
	readonly #onPossessionForward:
		| ((
				source: Exclude<CharacterForwardSource, "keyboard">,
				down: boolean,
		  ) => void)
		| undefined;
	readonly #onPossessionToggleAutoRun: (() => void) | undefined;
	readonly #onPossessionWheel: (localUpDistance: number) => void;
	readonly #onCharacterInput: (input: CharacterActionInput) => void;
	readonly #onViewportClick:
		((clientX: number, clientY: number) => void) | undefined;
	readonly #onViewportSecondaryClick:
		((clientX: number, clientY: number) => void) | undefined;
	readonly #keyboardYawRadiansPerSecond: (precisionActive: boolean) => number;
	readonly #requestAnimationFrame: (callback: FrameRequestCallback) => number;
	readonly #cancelAnimationFrame: (handle: number) => void;
	readonly #pressedActions = new Set<MovementAction>();
	readonly #characterInput: InputContext<CharacterAction>;
	readonly #flyInput: InputContext<FlyAction>;
	readonly #autoRunInput: InputContext<"toggleAutoRun">;
	#mouseConfig: ClientMouseConfiguration = DEFAULT_MOUSE_CONFIG;
	#flyMouseConfig: ExplorerFlyMouseConfiguration = DEFAULT_FLY_MOUSE_CONFIG;
	#buttons = 0;
	#middleForward = false;
	#bothForward = false;
	#gestureMode: "orbit" | "steer" | "fly-look" | "fly-pan" | null = null;
	#motion: ViewportPointerGesture | null = null;
	#clickCandidate: "primary" | "secondary" | null = null;
	#lastMovementAt: number | null = null;
	#linearMovementStartedAt: number | null = null;
	#movementFrame: number | null = null;
	#moveSpeed: number = CAMERA_CONTROL_TUNING.moveSpeed;
	#precisionActive = false;
	#flyAutoRun = false;
	#scheme: FrontendControlScheme = { kind: "free-fly" };
	readonly #look = new CameraLookController(DEFAULT_STATE);
	#state: FreeFlyCameraState = DEFAULT_STATE;

	constructor(options: ExplorerCameraInputControllerOptions) {
		const view = options.canvas.ownerDocument.defaultView;
		if (view === null)
			throw new Error("Explorer camera input requires a mounted document.");
		this.#window = view;
		this.#inputGate = options.inputGate;
		this.#canvas = options.canvas;
		this.#characterInput = options.input.characterContext((action, pressed) => {
			this.#onCharacterInput({
				action,
				kind: "action",
				pressed,
			});
		});
		this.#flyInput = options.input.flyContext((action, pressed) => {
			if (action === "precision") {
				this.#precisionActive = pressed;
				if (this.#scheme.kind === "physical-fly") this.#onChange(this.#state);
				return;
			}
			if (
				pressed &&
				(action === "forward" || action === "backward") &&
				this.#flyAutoRun
			) {
				this.#flyAutoRun = false;
				this.#onFlyAutoRunChange?.(false);
			}
			if (pressed) this.#pressedActions.add(action);
			else this.#pressedActions.delete(action);
			if (this.#hasActiveMovement()) this.#startMovement();
			else this.#stopMovement();
			if (this.#scheme.kind === "physical-fly") this.#onChange(this.#state);
		});
		this.#autoRunInput = new InputContext<"toggleAutoRun">(
			{ toggleAutoRun: [{ key: "q" }] },
			(_action, pressed) => {
				if (!pressed) return;
				if (this.#isCharacterScheme()) {
					this.#onPossessionToggleAutoRun?.();
					return;
				}
				if (this.#acceptsCameraKeys()) {
					this.#flyAutoRun = !this.#flyAutoRun;
					this.#onFlyAutoRunChange?.(this.#flyAutoRun);
					if (this.#hasActiveMovement()) this.#startMovement();
					else this.#stopMovement();
					if (this.#scheme.kind === "physical-fly") this.#onChange(this.#state);
				}
			},
		);
		this.#onChange = options.onChange;
		this.#onPhysicalWheel = options.onPhysicalWheel;
		this.#onFlyAutoRunChange = options.onFlyAutoRunChange;
		this.#onPossessionOrbitHeld = options.onPossessionOrbitHeld;
		this.#onPossessionFollowRear = options.onPossessionFollowRear;
		this.#onPossessionPitch = options.onPossessionPitch;
		this.#onPossessionOrbit = options.onPossessionOrbit;
		this.#onPossessionTurn = options.onPossessionTurn;
		this.#onPossessionCancelTurn = options.onPossessionCancelTurn;
		this.#onPossessionForward = options.onPossessionForward;
		this.#onPossessionToggleAutoRun = options.onPossessionToggleAutoRun;
		this.#onPossessionWheel = options.onPossessionWheel;
		this.#onCharacterInput = options.onCharacterInput;
		this.#onViewportClick = options.onViewportClick;
		this.#onViewportSecondaryClick = options.onViewportSecondaryClick;
		this.#keyboardYawRadiansPerSecond =
			options.keyboardYawRadiansPerSecond ??
			((precisionActive) =>
				CAMERA_CONTROL_TUNING.keyboardYawRadiansPerSecond *
				this.#speedMultiplier(precisionActive));
		this.#requestAnimationFrame =
			options.requestAnimationFrame ??
			window.requestAnimationFrame.bind(window);
		this.#cancelAnimationFrame =
			options.cancelAnimationFrame ?? window.cancelAnimationFrame.bind(window);
		this.#pointerLock = new PointerLockSession({
			canvas: this.#canvas,
			onLost: () => this.#endCapture(),
			onError: (message) => options.onPointerLockError?.(message),
		});

		this.#window.addEventListener("mousedown", this.#handleMouseDown);
		this.#window.addEventListener("mousemove", this.#handleMouseMove);
		this.#window.addEventListener("mouseup", this.#handleMouseUp);
		this.#canvas.addEventListener("pointercancel", this.#cancelPointer);
		this.#canvas.addEventListener("auxclick", this.#preventMiddleDefault);
		this.#canvas.addEventListener("contextmenu", this.#preventContextMenu);
		this.#canvas.addEventListener("wheel", this.#handleWheel, {
			passive: false,
		});
		this.#detachGestures = this.#inputGate.attach(this.#cancelPointer);
		this.#detachKeyboard = options.keyboard.bindGame({
			keydown: this.#handleKeyDown,
			keyup: this.#handleKeyUp,
			cancel: this.#cancelKeyboard,
		});
	}

	/** Update free-fly linear movement speed without disrupting active motion. */
	setMoveSpeed(speed: number): void {
		if (!Number.isFinite(speed) || speed <= 0) return;
		this.#moveSpeed = clamp(
			speed,
			EXPLORER_FLY_SPEED_RANGE.minimum,
			EXPLORER_FLY_SPEED_RANGE.maximum,
		);
	}

	/** Current linear fly speed in meters/second. */
	getMoveSpeed(): number {
		return this.#moveSpeed;
	}

	/** Replace fly keybindings live from Explorer settings. */
	replaceFlyBindings(bindings: InputBindings<FlyAction>): void {
		this.#flyInput.replaceBindings(bindings);
	}

	/** Replace grounded character keybindings live from shared settings. */
	replaceCharacterBindings(bindings: InputBindings<CharacterAction>): void {
		this.#characterInput.replaceBindings(bindings);
	}

	/** Replace possession autorun bindings live from shared client settings. */
	replaceAutoRunBindings(bindings: readonly KeyBinding[]): void {
		this.#autoRunInput.replaceBindings({ toggleAutoRun: bindings });
	}

	/** Update shared mouse steering/inversion preferences live (possession orbit & steer). */
	setMouseConfiguration(config: ClientMouseConfiguration): void {
		this.#mouseConfig = config;
	}

	/** Update Explorer-owned fly-look inversion preferences live. */
	setFlyMouseConfiguration(config: ExplorerFlyMouseConfiguration): void {
		this.#flyMouseConfig = config;
	}

	/** Replace the pose for automatic focus without marking it as user-controlled. */
	setAutomaticPose(pose: FreeFlyCameraPose): void {
		this.#inputGate.cancel("reset");
		this.#look.replace(pose);
		this.#setState({ ...pose, hasManualControl: false });
	}

	/** Applies a host-presented position without turning it into fresh user input. */
	applyPresentedPosition(position: Vec3): void {
		this.#state = { ...this.#state, position };
	}

	/** Seeds frontend free fly from the exact physical pose presented on the prior frame. */
	adoptPresentedPose(pose: FreeFlyCameraPose): void {
		this.#inputGate.cancel("reset");
		this.#look.replace(pose);
		this.#state = { ...pose, hasManualControl: true };
	}

	/** Atomically clears the outgoing owner before installing a complete input-routing scheme. */
	setControlScheme(scheme: FrontendControlScheme): void {
		if (this.#scheme.kind === scheme.kind) return;
		this.#inputGate.cancel("reset");
		this.#scheme = scheme;
	}

	/** Current local input, camera basis, and precision modifier for physical-camera policy. */
	physicalFlyInput(): {
		readonly basis: {
			readonly forward: Vec3;
			readonly right: Vec3;
			readonly up: Vec3;
		};
		readonly movement: CameraLocalMovement;
		readonly precision: boolean;
	} {
		return {
			basis: cameraAxes(this.#state),
			movement:
				this.#scheme.kind === "physical-fly"
					? this.#movementVector()
					: { forward: 0, right: 0, up: 0 },
			precision: this.#scheme.kind === "physical-fly" && this.#precisionActive,
		};
	}

	/** Copy the latest controller state for frame-ordered residency resolution. */
	snapshotState(): FreeFlyCameraState {
		return {
			...this.#state,
			position: this.#state.position.clone(),
		};
	}

	dispose(): void {
		this.#detachKeyboard();
		this.#detachGestures();
		this.#pointerLock.destroy();
		this.#window.removeEventListener("mousedown", this.#handleMouseDown);
		this.#window.removeEventListener("mousemove", this.#handleMouseMove);
		this.#window.removeEventListener("mouseup", this.#handleMouseUp);
		this.#canvas.removeEventListener("pointercancel", this.#cancelPointer);
		this.#canvas.removeEventListener("auxclick", this.#preventMiddleDefault);
		this.#canvas.removeEventListener("contextmenu", this.#preventContextMenu);
		this.#canvas.removeEventListener("wheel", this.#handleWheel);
	}

	readonly #preventMiddleDefault = (event: MouseEvent): void => {
		if (event.button === 1) event.preventDefault();
	};

	readonly #preventContextMenu = (event: MouseEvent): void => {
		event.preventDefault();
	};

	readonly #handleMouseDown = (event: MouseEvent): void => {
		if (!this.#inputGate.allowed) return;
		const active = this.#buttons !== 0;
		if (!active && event.target !== this.#canvas) return;
		if (event.button < 0 || event.button > 2) return;
		const mask =
			event.button === 0 ? LEFT : event.button === 1 ? MIDDLE : RIGHT;
		if ((this.#buttons & mask) !== 0) return;
		if (!active) this.#motion = beginViewportPointerGesture();
		this.#buttons |= mask;
		event.preventDefault();
		this.#clickCandidate =
			active || event.button === 1
				? null
				: event.button === 0
					? "primary"
					: "secondary";
		this.#updatePointerMode();
	};

	#updatePointerMode(): void {
		this.#canvas.toggleAttribute("data-mouse-active", this.#buttons !== 0);
		if (this.#isCharacterScheme()) {
			const movementEnabled = this.#mouseConfig.mouseMovement;
			const middle = movementEnabled && (this.#buttons & MIDDLE) !== 0;
			const both =
				movementEnabled && (this.#buttons & (LEFT | RIGHT)) === (LEFT | RIGHT);
			const startedForward =
				(middle && !this.#middleForward) || (both && !this.#bothForward);
			if (middle || both) this.#clickCandidate = null;
			if (middle !== this.#middleForward) {
				this.#middleForward = middle;
				this.#onPossessionForward?.("middle-button", middle);
			}
			if (both !== this.#bothForward) {
				this.#bothForward = both;
				this.#onPossessionForward?.("both-buttons", both);
			}
			const nextMode: "orbit" | "steer" | null =
				movementEnabled && (this.#buttons & (MIDDLE | RIGHT)) !== 0
					? "steer"
					: (this.#buttons & LEFT) !== 0
						? "orbit"
						: null;
			if (nextMode !== this.#gestureMode) {
				this.#onPossessionOrbitHeld?.(nextMode === "orbit", performance.now());
			}
			// A lone right press retains secondary-click inspection until dragging; movement chords commit immediately.
			if (
				nextMode === "steer" &&
				(startedForward ||
					(nextMode !== this.#gestureMode && this.#clickCandidate === null))
			) {
				this.#onPossessionFollowRear?.(performance.now());
			}
			this.#applyGestureMode(nextMode);
			return;
		}

		// Free-fly & Physical-fly: Left or Right drag looks; Middle drag pans in free-fly.
		const nextMode: "fly-look" | "fly-pan" | null =
			(this.#buttons & (LEFT | RIGHT)) !== 0
				? "fly-look"
				: this.#scheme.kind === "free-fly" && (this.#buttons & MIDDLE) !== 0
					? "fly-pan"
					: null;
		this.#applyGestureMode(nextMode);
	}

	#applyGestureMode(
		nextMode: "orbit" | "steer" | "fly-look" | "fly-pan" | null,
	): void {
		if (nextMode === this.#gestureMode) return;
		const hadGesture = this.#gestureMode !== null;
		this.#gestureMode = nextMode;
		if (nextMode === null) {
			this.#motion = null;
			this.#pointerLock.unlock();
			return;
		}
		if (!hadGesture || this.#motion === null) {
			this.#motion = beginViewportPointerGesture();
		}
		this.#pointerLock.request();
	}

	readonly #handleMouseMove = (event: MouseEvent): void => {
		if (!this.#inputGate.allowed) return;
		if (this.#buttons === 0) return;
		if ((this.#buttons & event.buttons) !== this.#buttons) {
			this.#buttons &= event.buttons;
			this.#clickCandidate = null;
			this.#updatePointerMode();
		}
		if (this.#gestureMode !== null && !this.#pointerLock.locked) {
			if (this.#motion !== null) this.#pointerLock.request();
			return;
		}
		this.#advanceMotion(event);
	};

	#advanceMotion(event: MouseEvent): void {
		const motion = this.#motion;
		if (motion === null) return;
		const advance = advanceViewportPointerGesture(
			motion,
			event.movementX,
			event.movementY,
		);
		this.#motion = advance.gesture;
		if (advance.dragDelta === null) return;
		if (this.#gestureMode === "steer" && this.#clickCandidate === "secondary") {
			this.#onPossessionFollowRear?.(performance.now());
		}
		this.#clickCandidate = null;
		const { x: deltaX, y: deltaY } = advance.dragDelta;

		if (this.#gestureMode === "steer") {
			if (deltaX !== 0) {
				this.#onPossessionTurn?.(
					deltaX *
						CAMERA_CONTROL_TUNING.pointerYawRadiansPerPixel *
						(this.#mouseConfig.invertSteeringHorizontal ? -1 : 1),
				);
			}
			if (deltaY !== 0) {
				this.#onPossessionPitch?.(
					deltaY * (this.#mouseConfig.invertSteeringVertical ? 1 : -1),
				);
			}
			return;
		}

		if (this.#gestureMode === "orbit") {
			this.#onPossessionOrbit(
				deltaX * (this.#mouseConfig.invertCameraHorizontal ? 1 : -1),
				deltaY * (this.#mouseConfig.invertCameraVertical ? 1 : -1),
			);
			return;
		}

		const speed = this.#speedMultiplier(
			this.#precisionActive ||
				this.#flyInput.modifierActive("precision", event),
		);
		if (this.#gestureMode === "fly-look") {
			const look = this.#look.rotate(
				deltaX * (this.#flyMouseConfig.invertFlyHorizontal ? 1 : -1),
				deltaY * (this.#flyMouseConfig.invertFlyVertical ? 1 : -1),
				CAMERA_CONTROL_TUNING.pointerYawRadiansPerPixel * speed,
				CAMERA_CONTROL_TUNING.pointerPitchRadiansPerPixel * speed,
				CAMERA_CONTROL_TUNING.maximumPitchRadians,
			);
			this.#setManualState({
				...this.#state,
				...look,
			});
		} else if (
			this.#gestureMode === "fly-pan" &&
			this.#scheme.kind === "free-fly"
		) {
			const { right, up } = cameraAxes(this.#state);
			this.#setManualState({
				...this.#state,
				position: this.#state.position.add(
					scaleVec3(
						right,
						-deltaX * CAMERA_CONTROL_TUNING.panUnitsPerPixel * speed,
					).add(
						scaleVec3(
							up,
							deltaY * CAMERA_CONTROL_TUNING.panUnitsPerPixel * speed,
						),
					),
				),
			});
		}
	}

	readonly #handleMouseUp = (event: MouseEvent): void => {
		if (this.#buttons === 0) return;
		const candidate = this.#clickCandidate;
		this.#buttons &= event.buttons;
		this.#clickCandidate = null;
		this.#updatePointerMode();
		if (!this.#inputGate.allowed) return;
		if (candidate === "primary" && event.button === 0) {
			this.#onViewportClick?.(event.clientX, event.clientY);
		} else if (candidate === "secondary" && event.button === 2) {
			this.#onViewportSecondaryClick?.(event.clientX, event.clientY);
		}
	};

	readonly #handleWheel = (event: WheelEvent): void => {
		if (!this.#inputGate.allowed) {
			event.preventDefault();
			return;
		}
		const delta = event.deltaY !== 0 ? event.deltaY : event.deltaX;
		const clampedDelta = clamp(
			delta,
			-CAMERA_CONTROL_TUNING.wheelDeltaClamp,
			CAMERA_CONTROL_TUNING.wheelDeltaClamp,
		);
		const distance =
			-clampedDelta * CAMERA_CONTROL_TUNING.wheelLocalUpUnitsPerDelta;
		if (this.#isCharacterScheme()) {
			if (distance !== 0) this.#onPossessionWheel(distance);
			event.preventDefault();
			return;
		}
		if (distance !== 0) {
			const scaledDistance =
				distance * this.#speedMultiplier(this.#precisionActive);
			if (this.#scheme.kind === "physical-fly") {
				this.#onPhysicalWheel?.(scaledDistance);
			} else {
				const axes = cameraAxes(this.#state);
				this.#setManualState({
					...this.#state,
					position: this.#state.position.add(
						scaleVec3(axes.up, scaledDistance),
					),
				});
			}
		}
		event.preventDefault();
	};

	readonly #handleKeyDown = (event: KeyboardEvent): void => {
		if (this.#autoRunInput.apply(event, true)) {
			event.preventDefault();
			return;
		}
		if (this.#activeInput().apply(event, true)) event.preventDefault();
	};

	readonly #handleKeyUp = (event: KeyboardEvent): void => {
		if (this.#autoRunInput.apply(event, false)) {
			event.preventDefault();
			return;
		}
		if (this.#activeInput().apply(event, false)) event.preventDefault();
	};

	#activeInput(): InputContext<CharacterAction> | InputContext<FlyAction> {
		return this.#isCharacterScheme() ? this.#characterInput : this.#flyInput;
	}

	readonly #cancelKeyboard = (): void => {
		this.#characterInput.reset();
		this.#flyInput.reset();
		this.#autoRunInput.reset();
		this.#precisionActive = false;
		this.#flyAutoRun = false;
		if (this.#isCharacterScheme()) this.#onCharacterInput({ kind: "reset" });
		this.#stopMovement();
		if (this.#scheme.kind === "physical-fly") this.#onChange(this.#state);
	};

	#endCapture(): void {
		this.#onPossessionOrbitHeld?.(false, performance.now());
		this.#motion = null;
		this.#clickCandidate = null;
		this.#pointerLock.unlock();
		this.#onPossessionCancelTurn?.();
	}

	readonly #cancelPointer = (): void => {
		this.#buttons = 0;
		this.#canvas.removeAttribute("data-mouse-active");
		this.#gestureMode = null;
		if (this.#middleForward) {
			this.#onPossessionForward?.("middle-button", false);
		}
		if (this.#bothForward) {
			this.#onPossessionForward?.("both-buttons", false);
		}
		this.#middleForward = false;
		this.#bothForward = false;
		this.#endCapture();
	};

	#startMovement(): void {
		if (this.#movementFrame !== null) return;
		this.#lastMovementAt = null;
		this.#movementFrame = this.#requestAnimationFrame(this.#applyMovement);
	}

	#stopMovement(): void {
		if (this.#movementFrame !== null)
			this.#cancelAnimationFrame(this.#movementFrame);
		this.#movementFrame = null;
		this.#lastMovementAt = null;
		this.#linearMovementStartedAt = null;
		this.#pressedActions.clear();
	}

	#hasActiveMovement(): boolean {
		return this.#pressedActions.size > 0 || this.#flyAutoRun;
	}

	readonly #applyMovement = (frameAt: number): void => {
		if (!this.#inputGate.allowed) return;
		this.#movementFrame = !this.#hasActiveMovement()
			? null
			: this.#requestAnimationFrame(this.#applyMovement);
		if (!this.#hasActiveMovement()) return;
		const deltaSeconds =
			this.#lastMovementAt === null
				? 0
				: Math.min(
						(frameAt - this.#lastMovementAt) / 1_000,
						CAMERA_CONTROL_TUNING.maximumFrameDeltaSeconds,
					);
		this.#lastMovementAt = frameAt;
		if (deltaSeconds === 0) return;

		const movement =
			this.#scheme.kind === "free-fly"
				? this.#movementVector()
				: { forward: 0, right: 0, up: 0 };
		let next = this.#state;
		if (movement.right !== 0 || movement.up !== 0 || movement.forward !== 0) {
			this.#linearMovementStartedAt ??= frameAt;
			const direction = localMovementDirection(this.#state, movement);
			const speed =
				this.#moveSpeed *
				this.#speedMultiplier(this.#precisionActive) *
				keyboardAcceleration((frameAt - this.#linearMovementStartedAt) / 1_000);
			next = {
				...next,
				position: next.position.add(scaleVec3(direction, speed * deltaSeconds)),
			};
		} else {
			this.#linearMovementStartedAt = null;
		}
		const yawDirection = this.#acceptsKeyboardYaw()
			? (this.#pressedActions.has("turnRight") ? 1 : 0) -
				(this.#pressedActions.has("turnLeft") ? 1 : 0)
			: 0;
		if (yawDirection !== 0) {
			const look = this.#look.replace({
				pitchRadians: next.pitchRadians,
				yawRadians:
					next.yawRadians +
					yawDirection *
						this.#keyboardYawRadiansPerSecond(this.#precisionActive) *
						deltaSeconds,
			});
			next = {
				...next,
				...look,
			};
		}
		this.#setManualState(next);
	};

	#movementVector(): CameraLocalMovement {
		const forward =
			(this.#pressedActions.has("forward") || this.#flyAutoRun ? 1 : 0) -
			(this.#pressedActions.has("backward") ? 1 : 0);
		return {
			forward,
			right:
				(this.#pressedActions.has("strafeRight") ? 1 : 0) -
				(this.#pressedActions.has("strafeLeft") ? 1 : 0),
			up:
				(this.#pressedActions.has("ascend") ? 1 : 0) -
				(this.#pressedActions.has("descend") ? 1 : 0),
		};
	}

	#speedMultiplier(isPrecisionActive: boolean): number {
		return isPrecisionActive
			? CAMERA_CONTROL_TUNING.precisionSlowMultiplier
			: 1;
	}

	#acceptsCameraKeys(): boolean {
		return (
			this.#scheme.kind === "free-fly" || this.#scheme.kind === "physical-fly"
		);
	}

	#acceptsKeyboardYaw(): boolean {
		return this.#acceptsCameraKeys();
	}

	#isCharacterScheme(): boolean {
		return this.#scheme.kind === "possessed-character";
	}

	#setManualState(state: FreeFlyCameraPose): void {
		this.#setState({ ...state, hasManualControl: true });
	}

	#setState(state: FreeFlyCameraState): void {
		this.#state = state;
		this.#onChange(state);
	}
}

function cameraAxes(
	pose: Pick<FreeFlyCameraPose, "pitchRadians" | "yawRadians">,
): {
	readonly forward: Vec3;
	readonly right: Vec3;
	readonly up: Vec3;
} {
	return createCameraAxesRadians(pose.yawRadians, pose.pitchRadians);
}

function localMovementDirection(
	pose: FreeFlyCameraPose,
	movement: {
		readonly forward: number;
		readonly right: number;
		readonly up: number;
	},
): Vec3 {
	const { forward, right, up } = cameraAxes(pose);
	return normalizeVec3(
		scaleVec3(right, movement.right)
			.add(scaleVec3(up, movement.up))
			.add(scaleVec3(forward, movement.forward)),
	);
}

function keyboardAcceleration(elapsedSeconds: number): number {
	return (
		CAMERA_CONTROL_TUNING.keyboardInitialSpeedMultiplier +
		(1 - CAMERA_CONTROL_TUNING.keyboardInitialSpeedMultiplier) *
			clamp(
				elapsedSeconds / CAMERA_CONTROL_TUNING.keyboardAccelerationSeconds,
				0,
				1,
			)
	);
}
