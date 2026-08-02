import { createCameraAxesRadians } from "../lib/game/math/camera-orientation";
import { Vec3 } from "../lib/game/math/types";
import { clamp, normalizeVec3, scaleVec3 } from "../lib/game/math/vector-utils";

type DragMode = "pan" | "rotate";
type MovementKey =
	"a" | "c" | "d" | "pagedown" | "pageup" | "s" | "space" | "w" | "z";

interface ActiveDrag {
	readonly lastX: number;
	readonly lastY: number;
	readonly mode: DragMode;
	readonly pointerId: number;
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

export interface FreeFlyCameraControllerOptions {
	readonly canvas: HTMLCanvasElement;
	readonly onChange: (state: FreeFlyCameraState) => void;
	readonly requestAnimationFrame?: (callback: FrameRequestCallback) => number;
	readonly cancelAnimationFrame?: (handle: number) => void;
}

const DEFAULT_STATE: FreeFlyCameraState = {
	hasManualControl: false,
	pitchRadians: -0.45,
	position: Vec3.zero(),
	yawRadians: 0,
};
const MOVE_SPEED = 150;
const INITIAL_KEYBOARD_SPEED_MULTIPLIER = 0.125;
const KEYBOARD_ACCELERATION_SECONDS = 2;
const KEYBOARD_YAW_RADIANS_PER_SECOND = 1.8;
const MAX_PITCH_RADIANS = 1.38;
const POINTER_PITCH_RADIANS_PER_PIXEL = 0.005;
const POINTER_YAW_RADIANS_PER_PIXEL = 0.006;
const SHIFT_SLOW_MULTIPLIER = 0.05;
const WHEEL_LOCAL_UP_UNITS_PER_DELTA = -0.025;
const WHEEL_DELTA_CLAMP = 900;
const PAN_SCALE_PER_PIXEL = 0.18;

/**
 * Explorer-local port of the legacy fly controls: left drag rotates, middle/right drag pans,
 * wheel moves along local up, WASD-style keys fly, and Shift slows every movement.
 */
export class FreeFlyCameraController {
	readonly #canvas: HTMLCanvasElement;
	readonly #onChange: (state: FreeFlyCameraState) => void;
	readonly #requestAnimationFrame: (callback: FrameRequestCallback) => number;
	readonly #cancelAnimationFrame: (handle: number) => void;
	readonly #pressedKeys = new Set<MovementKey>();
	#activeDrag: ActiveDrag | null = null;
	#lastMovementAt: number | null = null;
	#linearMovementStartedAt: number | null = null;
	#movementFrame: number | null = null;
	#shiftActive = false;
	#state: FreeFlyCameraState = DEFAULT_STATE;

	constructor(options: FreeFlyCameraControllerOptions) {
		this.#canvas = options.canvas;
		this.#onChange = options.onChange;
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
		this.#setState({ ...pose, hasManualControl: false });
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
		if (event.button !== 0 && event.button !== 1 && event.button !== 2) return;
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
		const drag = this.#activeDrag;
		if (!drag || drag.pointerId !== event.pointerId) return;
		const deltaX = event.clientX - drag.lastX;
		const deltaY = event.clientY - drag.lastY;
		this.#activeDrag = { ...drag, lastX: event.clientX, lastY: event.clientY };
		if (deltaX === 0 && deltaY === 0) return;
		const speed = this.#speedMultiplier(event.shiftKey);
		if (drag.mode === "rotate") {
			this.#setManualState({
				...this.#state,
				pitchRadians: clamp(
					this.#state.pitchRadians +
						deltaY * POINTER_PITCH_RADIANS_PER_PIXEL * speed,
					-MAX_PITCH_RADIANS,
					MAX_PITCH_RADIANS,
				),
				yawRadians:
					this.#state.yawRadians -
					deltaX * POINTER_YAW_RADIANS_PER_PIXEL * speed,
			});
		} else {
			const { right, up } = cameraAxes(this.#state);
			this.#setManualState({
				...this.#state,
				position: this.#state.position.add(
					scaleVec3(right, -deltaX * PAN_SCALE_PER_PIXEL * speed).add(
						scaleVec3(up, deltaY * PAN_SCALE_PER_PIXEL * speed),
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
		const { up } = cameraAxes(this.#state);
		const delta = event.deltaY !== 0 ? event.deltaY : event.deltaX;
		const distance =
			-clamp(delta, -WHEEL_DELTA_CLAMP, WHEEL_DELTA_CLAMP) *
			WHEEL_LOCAL_UP_UNITS_PER_DELTA *
			this.#speedMultiplier(event.shiftKey);
		this.#setManualState({
			...this.#state,
			position: this.#state.position.add(scaleVec3(up, distance)),
		});
		event.preventDefault();
	};

	readonly #handleKeyDown = (event: KeyboardEvent): void => {
		this.#shiftActive = event.shiftKey;
		const key = movementKey(event.key);
		if (!key) return;
		this.#pressedKeys.add(key);
		this.#startMovement();
		event.preventDefault();
	};

	readonly #handleKeyUp = (event: KeyboardEvent): void => {
		this.#shiftActive = event.key === "Shift" ? false : event.shiftKey;
		const key = movementKey(event.key);
		if (!key) return;
		this.#pressedKeys.delete(key);
		if (this.#pressedKeys.size === 0) this.#stopMovement();
		event.preventDefault();
	};

	readonly #handleBlur = (): void => this.#stopMovement();

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
		this.#pressedKeys.clear();
		this.#activeDrag = null;
	}

	readonly #applyMovement = (frameAt: number): void => {
		this.#movementFrame =
			this.#pressedKeys.size === 0
				? null
				: this.#requestAnimationFrame(this.#applyMovement);
		if (this.#pressedKeys.size === 0) return;
		const deltaSeconds =
			this.#lastMovementAt === null
				? 0
				: Math.min((frameAt - this.#lastMovementAt) / 1_000, 0.05);
		this.#lastMovementAt = frameAt;
		if (deltaSeconds === 0) return;

		const movement = this.#movementVector();
		let next = this.#state;
		if (movement.right !== 0 || movement.up !== 0 || movement.forward !== 0) {
			this.#linearMovementStartedAt ??= frameAt;
			const direction = localMovementDirection(this.#state, movement);
			const speed =
				MOVE_SPEED *
				this.#speedMultiplier(this.#shiftActive) *
				keyboardAcceleration((frameAt - this.#linearMovementStartedAt) / 1_000);
			next = {
				...next,
				position: next.position.add(scaleVec3(direction, speed * deltaSeconds)),
			};
		} else {
			this.#linearMovementStartedAt = null;
		}
		const yawDirection =
			(this.#pressedKeys.has("d") ? 1 : 0) -
			(this.#pressedKeys.has("a") ? 1 : 0);
		if (yawDirection !== 0) {
			next = {
				...next,
				yawRadians:
					next.yawRadians +
					yawDirection *
						KEYBOARD_YAW_RADIANS_PER_SECOND *
						deltaSeconds *
						this.#speedMultiplier(this.#shiftActive),
			};
		}
		this.#setManualState(next);
	};

	#movementVector(): {
		readonly forward: number;
		readonly right: number;
		readonly up: number;
	} {
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
		return isShiftActive ? SHIFT_SLOW_MULTIPLIER : 1;
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
		INITIAL_KEYBOARD_SPEED_MULTIPLIER +
		(1 - INITIAL_KEYBOARD_SPEED_MULTIPLIER) *
			clamp(elapsedSeconds / KEYBOARD_ACCELERATION_SECONDS, 0, 1)
	);
}
