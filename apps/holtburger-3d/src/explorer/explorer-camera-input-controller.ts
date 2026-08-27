import { FRONTEND_TUNING } from "../lib/frontend-tuning";
import { createCameraAxesRadians } from "../lib/game/math/camera-orientation";
import { Vec3 } from "../lib/game/math/types";
import { clamp, normalizeVec3, scaleVec3 } from "../lib/game/math/vector-utils";
import { CameraLookController } from "../lib/game/controls/camera-look-controller";
import { THIRD_PERSON_CHARACTER_CONTROL_PROFILE } from "../lib/game/controls/third-person-character-profile";

type DragMode = "pan" | "rotate";
type MovementKey =
	"a" | "c" | "d" | "pagedown" | "pageup" | "s" | "space" | "w" | "z";

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
	readonly onChange: (state: FreeFlyCameraState) => void;
	/** Sends wheel translation to the current host-owned camera policy. */
	readonly onPhysicalWheel: (localUpDistance: number) => void;
	/** Forwards raw orbit deltas only while Explorer has delegated to possession camera policy. */
	readonly onPossessionOrbit: (deltaX: number, deltaY: number) => void;
	/** Forwards wheel distance only while Explorer has delegated to possession camera policy. */
	readonly onPossessionWheel: (localUpDistance: number) => void;
	/** Publishes normalized raw character keys without assigning grounded semantics here. */
	readonly onCharacterInput: (input: CharacterKeyInput) => void;
	/** Resolves the app regime's complete keyboard-yaw rate without teaching this controller its modes. */
	readonly keyboardYawRadiansPerSecond?: (shiftActive: boolean) => number;
	readonly requestAnimationFrame?: (callback: FrameRequestCallback) => number;
	readonly cancelAnimationFrame?: (handle: number) => void;
}

/** Raw keyboard lifecycle consumed only when the app selects a character-control regime. */
export type CharacterKeyInput =
	| {
			readonly key: "a" | "c" | "d" | "s" | "shift" | "space" | "w" | "z";
			readonly kind: "key";
			readonly pressed: boolean;
			readonly repeat: boolean;
	  }
	| { readonly kind: "reset" };

const DEFAULT_STATE: FreeFlyCameraState = {
	hasManualControl: false,
	pitchRadians: FRONTEND_TUNING.explorer.camera.initialOrientation.pitchRadians,
	position: Vec3.zero(),
	yawRadians: FRONTEND_TUNING.explorer.camera.initialOrientation.yawRadians,
};
const CAMERA_CONTROL_TUNING = FRONTEND_TUNING.explorer.camera.controls;

/**
 * Explorer-local port of the legacy fly controls: left drag rotates, middle/right drag pans,
 * wheel moves along local up, WASD-style keys fly, and Shift slows every movement.
 */
export class ExplorerCameraInputController {
	readonly #canvas: HTMLCanvasElement;
	readonly #onChange: (state: FreeFlyCameraState) => void;
	readonly #onPhysicalWheel: (localUpDistance: number) => void;
	readonly #onPossessionOrbit: (deltaX: number, deltaY: number) => void;
	readonly #onPossessionWheel: (localUpDistance: number) => void;
	readonly #onCharacterInput: (input: CharacterKeyInput) => void;
	readonly #keyboardYawRadiansPerSecond: (shiftActive: boolean) => number;
	readonly #requestAnimationFrame: (callback: FrameRequestCallback) => number;
	readonly #cancelAnimationFrame: (handle: number) => void;
	readonly #pressedKeys = new Set<MovementKey>();
	#activeDrag: ActiveDrag | null = null;
	#lastMovementAt: number | null = null;
	#linearMovementStartedAt: number | null = null;
	#movementFrame: number | null = null;
	#shiftActive = false;
	#inputEnabled = true;
	#scheme: FrontendControlScheme = { kind: "free-fly" };
	readonly #look = new CameraLookController(DEFAULT_STATE);
	#state: FreeFlyCameraState = DEFAULT_STATE;

	constructor(options: ExplorerCameraInputControllerOptions) {
		this.#canvas = options.canvas;
		this.#onChange = options.onChange;
		this.#onPhysicalWheel = options.onPhysicalWheel;
		this.#onPossessionOrbit = options.onPossessionOrbit;
		this.#onPossessionWheel = options.onPossessionWheel;
		this.#onCharacterInput = options.onCharacterInput;
		this.#keyboardYawRadiansPerSecond =
			options.keyboardYawRadiansPerSecond ??
			((shiftActive) =>
				CAMERA_CONTROL_TUNING.keyboardYawRadiansPerSecond *
				this.#speedMultiplier(shiftActive));
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
		this.#canvas.addEventListener("keydown", this.#handleKeyDown);
		this.#canvas.addEventListener("keyup", this.#handleKeyUp);
		this.#canvas.addEventListener("blur", this.#handleBlur);
	}

	/** Replace the pose for automatic focus without marking it as user-controlled. */
	setAutomaticPose(pose: FreeFlyCameraPose): void {
		this.#stopMovement();
		this.#look.replace(pose);
		this.#setState({ ...pose, hasManualControl: false });
	}

	/** Applies a host-presented position without turning it into fresh user input. */
	applyPresentedPosition(position: Vec3): void {
		this.#state = { ...this.#state, position };
	}

	/** Seeds frontend free fly from the exact physical pose presented on the prior frame. */
	adoptPresentedPose(pose: FreeFlyCameraPose): void {
		this.#stopMovement();
		this.#look.replace(pose);
		this.#state = { ...pose, hasManualControl: true };
	}

	/** Atomically clears the outgoing owner before installing a complete input-routing scheme. */
	setControlScheme(scheme: FrontendControlScheme): void {
		if (this.#scheme.kind === scheme.kind) return;
		if (this.#isCharacterScheme()) this.#onCharacterInput({ kind: "reset" });
		this.#stopMovement();
		this.#shiftActive = false;
		this.#scheme = scheme;
	}

	/** Withdraw every Explorer input edge while a replacement scene is installing or revealing. */
	setInputEnabled(enabled: boolean): void {
		if (this.#inputEnabled === enabled) return;
		this.#inputEnabled = enabled;
		if (enabled) return;
		if (this.#isCharacterScheme()) this.#onCharacterInput({ kind: "reset" });
		this.#stopMovement();
		this.#shiftActive = false;
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
			precision: this.#scheme.kind === "physical-fly" && this.#shiftActive,
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
		this.#stopMovement();
		this.#canvas.removeEventListener("pointerdown", this.#handlePointerDown);
		this.#canvas.removeEventListener("pointermove", this.#handlePointerMove);
		this.#canvas.removeEventListener("pointerup", this.#handlePointerUp);
		this.#canvas.removeEventListener(
			"pointercancel",
			this.#handlePointerCancel,
		);
		this.#canvas.removeEventListener("wheel", this.#handleWheel);
		this.#canvas.removeEventListener("keydown", this.#handleKeyDown);
		this.#canvas.removeEventListener("keyup", this.#handleKeyUp);
		this.#canvas.removeEventListener("blur", this.#handleBlur);
	}

	readonly #handlePointerDown = (event: PointerEvent): void => {
		if (!this.#inputEnabled) return;
		if (event.button !== 0 && event.button !== 1 && event.button !== 2) return;
		if (
			this.#isCharacterScheme() &&
			event.button !== THIRD_PERSON_CHARACTER_CONTROL_PROFILE.orbitPointerButton
		)
			return;
		this.#canvas.focus();
		this.#canvas.setPointerCapture(event.pointerId);
		this.#activeDrag = {
			lastX: event.clientX,
			lastY: event.clientY,
			mode: event.button === 0 ? "rotate" : "pan",
			pointerId: event.pointerId,
		};
		event.preventDefault();
	};

	readonly #handlePointerMove = (event: PointerEvent): void => {
		if (!this.#inputEnabled) return;
		const drag = this.#activeDrag;
		if (!drag || drag.pointerId !== event.pointerId) return;
		const deltaX = event.clientX - drag.lastX;
		const deltaY = event.clientY - drag.lastY;
		this.#activeDrag = { ...drag, lastX: event.clientX, lastY: event.clientY };
		if (deltaX === 0 && deltaY === 0) return;
		const speed = this.#isCharacterScheme()
			? 1
			: this.#speedMultiplier(event.shiftKey);
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
		if (!this.#inputEnabled) return;
		if (!this.#finishDrag(event.pointerId)) return;
		event.preventDefault();
	};

	readonly #handlePointerCancel = (event: PointerEvent): void => {
		if (!this.#inputEnabled) return;
		this.#finishDrag(event.pointerId);
	};

	readonly #handleWheel = (event: WheelEvent): void => {
		if (!this.#inputEnabled) {
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
			(this.#isCharacterScheme() ? 1 : this.#speedMultiplier(event.shiftKey));
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
		if (!this.#inputEnabled) {
			event.preventDefault();
			return;
		}
		this.#shiftActive = event.shiftKey;
		const semanticKey = this.#isCharacterScheme()
			? THIRD_PERSON_CHARACTER_CONTROL_PROFILE.characterKey(event.key)
			: null;
		if (semanticKey !== null) {
			this.#onCharacterInput({
				key: semanticKey,
				kind: "key",
				pressed: true,
				repeat: event.repeat,
			});
		}
		const key = this.#acceptsCameraKeys() ? movementKey(event.key) : null;
		if (!key) {
			if (event.key === "Shift" && this.#scheme.kind === "physical-fly")
				this.#onChange(this.#state);
			if (semanticKey !== null) event.preventDefault();
			return;
		}
		this.#pressedKeys.add(key);
		this.#startMovement();
		if (this.#scheme.kind === "physical-fly") this.#onChange(this.#state);
		event.preventDefault();
	};

	readonly #handleKeyUp = (event: KeyboardEvent): void => {
		if (!this.#inputEnabled) {
			event.preventDefault();
			return;
		}
		this.#shiftActive = event.key === "Shift" ? false : event.shiftKey;
		const semanticKey = this.#isCharacterScheme()
			? THIRD_PERSON_CHARACTER_CONTROL_PROFILE.characterKey(event.key)
			: null;
		if (semanticKey !== null) {
			this.#onCharacterInput({
				key: semanticKey,
				kind: "key",
				pressed: false,
				repeat: false,
			});
		}
		const key = this.#acceptsCameraKeys() ? movementKey(event.key) : null;
		if (!key) {
			if (event.key === "Shift" && this.#scheme.kind === "physical-fly")
				this.#onChange(this.#state);
			if (semanticKey !== null) event.preventDefault();
			return;
		}
		this.#pressedKeys.delete(key);
		if (this.#pressedKeys.size === 0) {
			// Preserve the empty held set long enough for the physical adapter to send a stop intent.
			if (this.#scheme.kind === "physical-fly") this.#onChange(this.#state);
			this.#stopMovement();
		} else if (this.#scheme.kind === "physical-fly") {
			this.#onChange(this.#state);
		}
		event.preventDefault();
	};

	readonly #handleBlur = (): void => {
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
		const drag = this.#activeDrag;
		if (drag !== null && this.#canvas.hasPointerCapture(drag.pointerId)) {
			this.#canvas.releasePointerCapture(drag.pointerId);
		}
		this.#movementFrame = null;
		this.#lastMovementAt = null;
		this.#linearMovementStartedAt = null;
		this.#pressedKeys.clear();
		this.#activeDrag = null;
	}

	readonly #applyMovement = (frameAt: number): void => {
		if (!this.#inputEnabled) return;
		this.#movementFrame =
			this.#pressedKeys.size === 0
				? null
				: this.#requestAnimationFrame(this.#applyMovement);
		if (this.#pressedKeys.size === 0) return;
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
				this.#speedMultiplier(this.#shiftActive) *
				keyboardAcceleration((frameAt - this.#linearMovementStartedAt) / 1_000);
			next = {
				...next,
				position: next.position.add(scaleVec3(direction, speed * deltaSeconds)),
			};
		} else {
			this.#linearMovementStartedAt = null;
		}
		const yawDirection = this.#acceptsKeyboardYaw()
			? (this.#pressedKeys.has("d") ? 1 : 0) -
				(this.#pressedKeys.has("a") ? 1 : 0)
			: 0;
		if (yawDirection !== 0) {
			const look = this.#look.replace({
				pitchRadians: next.pitchRadians,
				yawRadians:
					next.yawRadians +
					yawDirection *
						this.#keyboardYawRadiansPerSecond(this.#shiftActive) *
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
				(this.#pressedKeys.has("w") ? 1 : 0) -
				(this.#pressedKeys.has("s") ? 1 : 0),
			right:
				(this.#pressedKeys.has("c") ? 1 : 0) -
				(this.#pressedKeys.has("z") ? 1 : 0),
			up:
				(this.#pressedKeys.has("space") || this.#pressedKeys.has("pageup")
					? 1
					: 0) - (this.#pressedKeys.has("pagedown") ? 1 : 0),
		};
	}

	#speedMultiplier(isShiftActive: boolean): number {
		return isShiftActive ? CAMERA_CONTROL_TUNING.shiftSlowMultiplier : 1;
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

function movementKey(key: string): MovementKey | null {
	const normalized = key.toLowerCase();
	if (["w", "a", "s", "d", "z", "c", "pageup", "pagedown"].includes(normalized))
		return normalized as MovementKey;
	return key === " " ? "space" : null;
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
