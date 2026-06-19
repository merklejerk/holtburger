import {
	createV2FreeCameraFrameStateCamera,
	createV2FreeCameraState,
	getV2FreeCameraKeyboardMoveSpeedMultiplier,
	getV2FreeCameraSpeedMultiplier,
	moveV2FreeCameraLocal,
	moveV2FreeCameraLocalUpByWheel,
	panV2FreeCamera,
	rotateV2FreeCamera,
	rotateV2FreeCameraAroundWorldUp,
	type V2FreeCameraConfig,
	type V2FreeCameraState,
} from "./free-camera";
import type { FrameState } from "../renderer/types";

type CameraDragMode = "rotate" | "pan";
type CameraControlKey =
	| "w"
	| "a"
	| "s"
	| "d"
	| "z"
	| "c"
	| "pageup"
	| "pagedown"
	| "space";

interface ActiveCameraDrag {
	readonly pointerId: number;
	readonly lastX: number;
	readonly lastY: number;
	readonly mode: CameraDragMode;
}

export interface V2BrowserCameraControllerOptions {
	readonly onChange: (state: V2FreeCameraState) => void;
	readonly initialState?: V2FreeCameraState;
	readonly config?: V2FreeCameraConfig;
	readonly requestAnimationFrame?: (callback: FrameRequestCallback) => number;
	readonly cancelAnimationFrame?: (handle: number) => void;
}

export class V2BrowserCameraController {
	readonly #onChange: (state: V2FreeCameraState) => void;
	readonly #config: V2FreeCameraConfig | undefined;
	readonly #requestAnimationFrame: (callback: FrameRequestCallback) => number;
	readonly #cancelAnimationFrame: (handle: number) => void;
	readonly #pressedKeys = new Set<CameraControlKey>();
	#state: V2FreeCameraState;
	#activeDrag: ActiveCameraDrag | null = null;
	#movementFrameId: number | null = null;
	#lastMovementFrameAt: number | null = null;
	#linearMovementStartedAt: number | null = null;
	#slowModifierActive = false;

	constructor(options: V2BrowserCameraControllerOptions) {
		this.#onChange = options.onChange;
		this.#config = options.config;
		this.#state =
			options.initialState ?? createV2FreeCameraState(options.config);
		this.#requestAnimationFrame =
			options.requestAnimationFrame ??
			((callback) => window.requestAnimationFrame(callback));
		this.#cancelAnimationFrame =
			options.cancelAnimationFrame ??
			((handle) => {
				window.cancelAnimationFrame(handle);
			});
	}

	createFrameStateCamera(): FrameState["camera"] {
		return createV2FreeCameraFrameStateCamera(this.#state);
	}

	createSnapshot(): V2FreeCameraState {
		return this.#state;
	}

	reset(): void {
		this.#stopMovement();
		this.#setState(createV2FreeCameraState(this.#config));
	}

	setState(state: V2FreeCameraState): void {
		this.#stopMovement();
		this.#setState(state);
	}

	setPosition(position: V2FreeCameraState["position"]): void {
		this.#setState({
			...this.#state,
			position,
		});
	}

	dispose(): void {
		this.#stopMovement();
		this.#pressedKeys.clear();
		this.#activeDrag = null;
	}

	handlePointerDown(event: PointerEvent, target: HTMLElement): boolean {
		if (event.button !== 0 && event.button !== 1 && event.button !== 2) {
			return false;
		}

		target.focus();
		target.setPointerCapture(event.pointerId);
		this.#activeDrag = {
			pointerId: event.pointerId,
			lastX: event.clientX,
			lastY: event.clientY,
			mode: event.button === 0 ? "rotate" : "pan",
		};

		return true;
	}

	handlePointerMove(event: PointerEvent): boolean {
		const drag = this.#activeDrag;
		if (!drag || drag.pointerId !== event.pointerId) {
			return false;
		}

		const delta = {
			x: event.clientX - drag.lastX,
			y: event.clientY - drag.lastY,
		};
		if (delta.x === 0 && delta.y === 0) {
			return false;
		}

		this.#activeDrag = {
			...drag,
			lastX: event.clientX,
			lastY: event.clientY,
		};
		const speedMultiplier = getV2FreeCameraSpeedMultiplier(
			event.shiftKey,
			this.#config,
		);
		this.#setState(
			drag.mode === "rotate"
				? rotateV2FreeCamera(this.#state, delta, speedMultiplier, this.#config)
				: panV2FreeCamera(this.#state, delta, speedMultiplier, this.#config),
		);

		return true;
	}

	handlePointerUp(event: PointerEvent, target: HTMLElement): boolean {
		const drag = this.#activeDrag;
		if (!drag || drag.pointerId !== event.pointerId) {
			return false;
		}

		if (target.hasPointerCapture(event.pointerId)) {
			target.releasePointerCapture(event.pointerId);
		}
		this.#activeDrag = null;

		return true;
	}

	handleWheel(event: WheelEvent): boolean {
		const wheelDelta = event.deltaY !== 0 ? event.deltaY : event.deltaX;
		this.#setState(
			moveV2FreeCameraLocalUpByWheel(
				this.#state,
				wheelDelta,
				getV2FreeCameraSpeedMultiplier(event.shiftKey, this.#config),
				this.#config,
			),
		);

		return true;
	}

	handleKeyDown(event: KeyboardEvent): boolean {
		this.#slowModifierActive = event.shiftKey;
		const movementKey = normalizeCameraControlKey(event.key);
		if (!movementKey) {
			return false;
		}

		this.#pressedKeys.add(movementKey);
		this.#startMovement();

		return true;
	}

	handleKeyUp(event: KeyboardEvent): boolean {
		this.#slowModifierActive = event.key === "Shift" ? false : event.shiftKey;
		const movementKey = normalizeCameraControlKey(event.key);
		if (!movementKey) {
			return false;
		}

		this.#pressedKeys.delete(movementKey);
		if (this.#pressedKeys.size === 0) {
			this.#stopMovement();
		}

		return true;
	}

	handleBlur(): void {
		this.#stopMovement();
		this.#activeDrag = null;
	}

	#setState(nextState: V2FreeCameraState): void {
		this.#state = nextState;
		this.#onChange(nextState);
	}

	#startMovement(): void {
		if (this.#movementFrameId !== null) {
			return;
		}

		this.#lastMovementFrameAt = null;
		this.#movementFrameId = this.#requestAnimationFrame((frameAt) => {
			this.#applyMovement(frameAt);
		});
	}

	#stopMovement(): void {
		if (this.#movementFrameId !== null) {
			this.#cancelAnimationFrame(this.#movementFrameId);
		}
		this.#movementFrameId = null;
		this.#lastMovementFrameAt = null;
		this.#linearMovementStartedAt = null;
		this.#pressedKeys.clear();
	}

	#applyMovement(frameAt: number): void {
		this.#movementFrameId =
			this.#pressedKeys.size === 0
				? null
				: this.#requestAnimationFrame((nextFrameAt) => {
						this.#applyMovement(nextFrameAt);
					});
		if (this.#pressedKeys.size === 0) {
			this.#lastMovementFrameAt = null;
			return;
		}

		const deltaSeconds =
			this.#lastMovementFrameAt === null
				? 0
				: Math.min((frameAt - this.#lastMovementFrameAt) / 1000, 0.05);
		this.#lastMovementFrameAt = frameAt;
		if (deltaSeconds === 0) {
			return;
		}

		let nextState = this.#state;
		const movement = this.#deriveMovementVector();
		const yawDirection = this.#deriveYawDirection();
		const speedMultiplier = getV2FreeCameraSpeedMultiplier(
			this.#slowModifierActive,
			this.#config,
		);
		if (movement.right !== 0 || movement.up !== 0 || movement.forward !== 0) {
			this.#linearMovementStartedAt ??= frameAt;
			nextState = moveV2FreeCameraLocal(
				nextState,
				movement,
				deltaSeconds,
				speedMultiplier *
					getV2FreeCameraKeyboardMoveSpeedMultiplier(
						(frameAt - this.#linearMovementStartedAt) / 1000,
						this.#config,
					),
			);
		} else {
			this.#linearMovementStartedAt = null;
		}
		if (yawDirection !== 0) {
			nextState = rotateV2FreeCameraAroundWorldUp(
				nextState,
				yawDirection,
				deltaSeconds,
				speedMultiplier,
				this.#config,
			);
		}
		if (nextState !== this.#state) {
			this.#setState(nextState);
		}
	}

	#deriveMovementVector(): {
		readonly right: number;
		readonly up: number;
		readonly forward: number;
	} {
		return {
			right:
				(this.#pressedKeys.has("c") ? 1 : 0) -
				(this.#pressedKeys.has("z") ? 1 : 0),
			up:
				(this.#pressedKeys.has("space") || this.#pressedKeys.has("pageup")
					? 1
					: 0) - (this.#pressedKeys.has("pagedown") ? 1 : 0),
			forward:
				(this.#pressedKeys.has("w") ? 1 : 0) -
				(this.#pressedKeys.has("s") ? 1 : 0),
		};
	}

	#deriveYawDirection(): -1 | 0 | 1 {
		const direction =
			(this.#pressedKeys.has("d") ? 1 : 0) -
			(this.#pressedKeys.has("a") ? 1 : 0);

		return direction === 0 ? 0 : direction > 0 ? 1 : -1;
	}
}

function normalizeCameraControlKey(key: string): CameraControlKey | null {
	const normalizedKey = key.toLowerCase();
	if (
		normalizedKey === "w" ||
		normalizedKey === "a" ||
		normalizedKey === "s" ||
		normalizedKey === "d" ||
		normalizedKey === "z" ||
		normalizedKey === "c" ||
		normalizedKey === "pageup" ||
		normalizedKey === "pagedown"
	) {
		return normalizedKey;
	}

	return key === " " ? "space" : null;
}
