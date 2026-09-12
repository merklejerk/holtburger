import { EXPLORER_TUNING } from "./explorer-tuning";
import { createCameraAxesRadians } from "../lib/game/math/camera-orientation";
import { Vec3 } from "../lib/game/math/types";
import { clamp, normalizeVec3, scaleVec3 } from "../lib/game/math/vector-utils";
import { CameraLookController } from "../lib/game/controls/camera-look-controller";
import type { KeyboardInputPolicy } from "../lib/input/keyboard-input-policy";
import type { InputContext } from "../lib/input/input-context";
import type { AppInput } from "../lib/input/app-input";
import type { ViewportInputGate } from "../lib/input/viewport-input-gate";
import {
	type CharacterAction,
	type FlyAction,
} from "../lib/input/input-contract";

type DragMode = "pan" | "rotate";
type MovementAction = Exclude<FlyAction, "precision">;

interface ActiveDrag {
	readonly lastX: number;
	readonly lastY: number;
	readonly mode: DragMode;
	readonly pointerId: number;
}

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

export interface ExplorerCameraInputControllerOptions {
	readonly canvas: HTMLCanvasElement;
	/** Resolved app input policy supplied by the composition root. */
	readonly input: AppInput;
	/** Shared viewport availability and cancellation boundary for this mounted app. */
	readonly inputGate: ViewportInputGate;
	/** App-owned keyboard routing, independent of canvas focus. */
	readonly keyboard: KeyboardInputPolicy;
	readonly onChange: (state: FreeFlyCameraState) => void;
	/** Sends wheel translation to the current host-owned camera policy. */
	readonly onPhysicalWheel: (localUpDistance: number) => void;
	/** Forwards raw orbit deltas only while Explorer has delegated to possession camera policy. */
	readonly onPossessionOrbit: (deltaX: number, deltaY: number) => void;
	/** Forwards wheel distance only while Explorer has delegated to possession camera policy. */
	readonly onPossessionWheel: (localUpDistance: number) => void;
	/** Publishes character actions without assigning grounded movement behavior here. */
	readonly onCharacterInput: (input: CharacterActionInput) => void;
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
 * Explorer camera behavior consumes configured fly actions and viewport gestures.
 * Grounded actions and possession orbit remain delegated to their own owners.
 */
export class ExplorerCameraInputController {
	readonly #input: AppInput;
	/** All keyboard and pointer actions consult the app-owned gate. */
	readonly #inputGate: ViewportInputGate;
	/** Unregister and cancel this controller's pointer gestures on disposal. */
	readonly #detachGestures: () => void;
	/** Release the registered keyboard consumer with this controller. */
	readonly #detachKeyboard: () => void;
	readonly #canvas: HTMLCanvasElement;
	readonly #onChange: (state: FreeFlyCameraState) => void;
	readonly #onPhysicalWheel: (localUpDistance: number) => void;
	readonly #onPossessionOrbit: (deltaX: number, deltaY: number) => void;
	readonly #onPossessionWheel: (localUpDistance: number) => void;
	readonly #onCharacterInput: (input: CharacterActionInput) => void;
	readonly #keyboardYawRadiansPerSecond: (precisionActive: boolean) => number;
	readonly #requestAnimationFrame: (callback: FrameRequestCallback) => number;
	readonly #cancelAnimationFrame: (handle: number) => void;
	readonly #pressedActions = new Set<MovementAction>();
	readonly #characterInput: InputContext<CharacterAction>;
	readonly #flyInput: InputContext<FlyAction>;
	#activeDrag: ActiveDrag | null = null;
	#lastMovementAt: number | null = null;
	#linearMovementStartedAt: number | null = null;
	#movementFrame: number | null = null;
	#precisionActive = false;
	#scheme: FrontendControlScheme = { kind: "free-fly" };
	readonly #look = new CameraLookController(DEFAULT_STATE);
	#state: FreeFlyCameraState = DEFAULT_STATE;

	constructor(options: ExplorerCameraInputControllerOptions) {
		this.#inputGate = options.inputGate;
		this.#input = options.input;
		this.#characterInput = this.#input.characterContext((action, pressed) => {
			this.#onCharacterInput({
				action,
				kind: "action",
				pressed,
			});
		});
		this.#flyInput = this.#input.flyContext((action, pressed) => {
			if (action === "precision") {
				this.#precisionActive = pressed;
				if (this.#scheme.kind === "physical-fly") this.#onChange(this.#state);
				return;
			}
			if (pressed) this.#pressedActions.add(action);
			else this.#pressedActions.delete(action);
			if (this.#pressedActions.size > 0) this.#startMovement();
			else this.#stopMovement();
			if (this.#scheme.kind === "physical-fly") this.#onChange(this.#state);
		});
		this.#canvas = options.canvas;
		this.#onChange = options.onChange;
		this.#onPhysicalWheel = options.onPhysicalWheel;
		this.#onPossessionOrbit = options.onPossessionOrbit;
		this.#onPossessionWheel = options.onPossessionWheel;
		this.#onCharacterInput = options.onCharacterInput;
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
		this.#canvas.addEventListener("pointerdown", this.#handlePointerDown);
		this.#canvas.addEventListener("pointermove", this.#handlePointerMove);
		this.#canvas.addEventListener("pointerup", this.#handlePointerUp);
		this.#canvas.addEventListener("pointercancel", this.#handlePointerCancel);
		this.#canvas.addEventListener("wheel", this.#handleWheel, {
			passive: false,
		});
		this.#detachGestures = this.#inputGate.attach(() => {
			if (this.#activeDrag !== null)
				this.#finishDrag(this.#activeDrag.pointerId);
		});
		this.#detachKeyboard = options.keyboard.bindGame({
			keydown: this.#handleKeyDown,
			keyup: this.#handleKeyUp,
			cancel: this.#cancelKeyboard,
		});
	}

	/** Replace the pose for automatic focus without marking it as user-controlled. */
	setAutomaticPose(pose: FreeFlyCameraPose): void {
		this.#inputGate.cancel();
		this.#look.replace(pose);
		this.#setState({ ...pose, hasManualControl: false });
	}

	/** Applies a host-presented position without turning it into fresh user input. */
	applyPresentedPosition(position: Vec3): void {
		this.#state = { ...this.#state, position };
	}

	/** Seeds frontend free fly from the exact physical pose presented on the prior frame. */
	adoptPresentedPose(pose: FreeFlyCameraPose): void {
		this.#inputGate.cancel();
		this.#look.replace(pose);
		this.#state = { ...pose, hasManualControl: true };
	}

	/** Atomically clears the outgoing owner before installing a complete input-routing scheme. */
	setControlScheme(scheme: FrontendControlScheme): void {
		if (this.#scheme.kind === scheme.kind) return;
		this.#inputGate.cancel();
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
		this.#canvas.removeEventListener("pointerdown", this.#handlePointerDown);
		this.#canvas.removeEventListener("pointermove", this.#handlePointerMove);
		this.#canvas.removeEventListener("pointerup", this.#handlePointerUp);
		this.#canvas.removeEventListener(
			"pointercancel",
			this.#handlePointerCancel,
		);
		this.#canvas.removeEventListener("wheel", this.#handleWheel);
	}

	readonly #handlePointerDown = (event: PointerEvent): void => {
		if (!this.#inputGate.allowed) return;
		const rotate = this.#input.pointer(
			this.#isCharacterScheme() ? "possessionOrbit" : "flyRotate",
			event,
		);
		const pan =
			!this.#isCharacterScheme() && this.#input.pointer("flyPan", event);
		if (!rotate && !pan) return;
		this.#canvas.setPointerCapture(event.pointerId);
		this.#activeDrag = {
			lastX: event.clientX,
			lastY: event.clientY,
			mode: rotate ? "rotate" : "pan",
			pointerId: event.pointerId,
		};
		event.preventDefault();
	};

	readonly #handlePointerMove = (event: PointerEvent): void => {
		if (!this.#inputGate.allowed) return;
		const drag = this.#activeDrag;
		if (!drag || drag.pointerId !== event.pointerId) return;
		const deltaX = event.clientX - drag.lastX;
		const deltaY = event.clientY - drag.lastY;
		this.#activeDrag = { ...drag, lastX: event.clientX, lastY: event.clientY };
		if (deltaX === 0 && deltaY === 0) return;
		const speed = this.#isCharacterScheme()
			? 1
			: this.#speedMultiplier(
					this.#precisionActive ||
						this.#flyInput.modifierActive("precision", event),
				);
		if (drag.mode === "rotate") {
			if (this.#isCharacterScheme()) {
				this.#onPossessionOrbit(deltaX, deltaY);
				event.preventDefault();
				return;
			}
			const look = this.#look.rotate(
				deltaX,
				deltaY,
				CAMERA_CONTROL_TUNING.pointerYawRadiansPerPixel * speed,
				CAMERA_CONTROL_TUNING.pointerPitchRadiansPerPixel * speed,
				CAMERA_CONTROL_TUNING.maximumPitchRadians,
			);
			this.#setManualState({
				...this.#state,
				...look,
			});
		} else if (this.#scheme.kind === "free-fly") {
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
		event.preventDefault();
	};

	readonly #handlePointerUp = (event: PointerEvent): void => {
		if (!this.#finishDrag(event.pointerId)) return;
		event.preventDefault();
	};

	readonly #handlePointerCancel = (event: PointerEvent): void => {
		this.#finishDrag(event.pointerId);
	};

	readonly #handleWheel = (event: WheelEvent): void => {
		if (!this.#inputGate.allowed) {
			event.preventDefault();
			return;
		}
		const delta = event.deltaY !== 0 ? event.deltaY : event.deltaX;
		const distance =
			-clamp(
				delta,
				-CAMERA_CONTROL_TUNING.wheelDeltaClamp,
				CAMERA_CONTROL_TUNING.wheelDeltaClamp,
			) *
			CAMERA_CONTROL_TUNING.wheelLocalUpUnitsPerDelta *
			(this.#isCharacterScheme()
				? 1
				: this.#speedMultiplier(
						this.#precisionActive ||
							this.#flyInput.modifierActive("precision", event),
					));
		if (this.#scheme.kind !== "free-fly") {
			if (distance !== 0) {
				if (this.#isCharacterScheme()) this.#onPossessionWheel(distance);
				else this.#onPhysicalWheel(distance);
			}
			event.preventDefault();
			return;
		}
		const { up } = cameraAxes(this.#state);
		this.#setManualState({
			...this.#state,
			position: this.#state.position.add(scaleVec3(up, distance)),
		});
		event.preventDefault();
	};

	readonly #handleKeyDown = (event: KeyboardEvent): void => {
		if (this.#activeInput().apply(event, true)) event.preventDefault();
	};

	readonly #handleKeyUp = (event: KeyboardEvent): void => {
		if (this.#activeInput().apply(event, false)) event.preventDefault();
	};

	#activeInput(): InputContext<CharacterAction> | InputContext<FlyAction> {
		return this.#isCharacterScheme() ? this.#characterInput : this.#flyInput;
	}

	readonly #cancelKeyboard = (): void => {
		this.#characterInput.reset();
		this.#flyInput.reset();
		this.#precisionActive = false;
		if (this.#isCharacterScheme()) this.#onCharacterInput({ kind: "reset" });
		this.#stopMovement();
		if (this.#scheme.kind === "physical-fly") this.#onChange(this.#state);
	};

	#finishDrag(pointerId: number): boolean {
		const drag = this.#activeDrag;
		if (!drag || drag.pointerId !== pointerId) return false;
		if (this.#canvas.hasPointerCapture(pointerId))
			this.#canvas.releasePointerCapture(pointerId);
		this.#activeDrag = null;
		return true;
	}

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

	readonly #applyMovement = (frameAt: number): void => {
		if (!this.#inputGate.allowed) return;
		this.#movementFrame =
			this.#pressedActions.size === 0
				? null
				: this.#requestAnimationFrame(this.#applyMovement);
		if (this.#pressedActions.size === 0) return;
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
				CAMERA_CONTROL_TUNING.moveSpeed *
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
		return {
			forward:
				(this.#pressedActions.has("forward") ? 1 : 0) -
				(this.#pressedActions.has("backward") ? 1 : 0),
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
