import type { ClientMouseConfiguration } from "../lib/input/input-contract";
import type { ViewportInputGate } from "../lib/input/viewport-input-gate";
import type { ClientForwardSource } from "./client-input-arbiter";
import {
	advanceClientViewportPointerGesture,
	beginClientViewportPointerGesture,
	type ClientViewportCameraController,
	type ClientViewportPointerGesture,
} from "./client-viewport-pointer-gesture";

/** Semantic mouse movement port composed by the client app. */
export interface ClientMouseMovementInput {
	/** Physical forward sources enter the ordinary client arbiter. */
	readonly onForward: (
		source: Exclude<ClientForwardSource, "keyboard">,
		down: boolean,
	) => void;
	/** Signed AC yaw displacement; the host owns the current heading. */
	readonly onTurn: (deltaRadians: number) => void;
	/** Drop queued steering on cancellation, independently of ordinary button release. */
	readonly onCancelTurn: () => void;
	/** Surface pointer-lock refusal through the app's existing notice owner. */
	readonly onError: (message: string) => void;
}

interface ClientViewportMouseOptions {
	/** DOM surface that can start world gestures; releases are observed on its window. */
	readonly canvas: HTMLCanvasElement;
	/** Shared admission and cancellation boundary. */
	readonly gate: ViewportInputGate;
	/** Cold policy read at event time, without reconstructing the owner. */
	readonly settings: () => ClientMouseConfiguration;
	/** Current presentation camera, absent while presentation is unavailable. */
	readonly camera: () => ClientViewportCameraController | null;
	/** Precise targeting retains click activation and suppresses forward in the arbiter. */
	readonly precise: () => boolean;
	/** Existing tuning, converted to AC yaw before it crosses the host boundary. */
	readonly yawRadiansPerPixel: number;
	/** App-owned semantic movement and dispatch cancellation. */
	readonly movement: ClientMouseMovementInput;
	/** Existing viewport click destinations. */
	readonly onSelect: (x: number, y: number) => void;
	readonly onExamine: (x: number, y: number) => void;
	readonly onJump: () => void;
	/** Maintain unlocked cursor/precise aim without publishing hot Svelte state. */
	readonly onPosition: (x: number, y: number, aiming: boolean) => void;
}

const LEFT = 1;
const RIGHT = 2;
const MIDDLE = 4;

/** Sole client viewport mouse owner: clicks, orbit, held movement, lock, and cancellation. */
export class ClientViewportMouseController {
	readonly #options: ClientViewportMouseOptions;
	readonly #document: Document;
	readonly #window: Window;
	readonly #detachGate: () => void;
	#buttons = 0;
	#middleForward = false;
	#bothForward = false;
	#mode: "orbit" | "steer" | null = null;
	#motion: ClientViewportPointerGesture | null = null;
	#click: {
		readonly button: number;
		readonly kind: "select" | "examine" | "jump";
	} | null = null;
	#lockGeneration = 0;
	#lockWanted = false;
	#lockPending = false;

	constructor(options: ClientViewportMouseOptions) {
		this.#options = options;
		this.#document = options.canvas.ownerDocument;
		const view = this.#document.defaultView;
		if (view === null)
			throw new Error("Viewport mouse input requires a mounted document.");
		this.#window = view;
		// Mouse edges report every button, including chord changes emitted as pointermove.
		view.addEventListener("mousedown", this.#down);
		view.addEventListener("mousemove", this.#move);
		view.addEventListener("mouseup", this.#up);
		options.canvas.addEventListener("pointercancel", this.cancel);
		options.canvas.addEventListener("auxclick", this.#preventMiddleDefault);
		this.#document.addEventListener("pointerlockchange", this.#lockChanged);
		this.#detachGate = options.gate.attach(this.cancel);
	}

	/** Selection hover and precise aim yield while a mouse movement gesture owns the cursor. */
	get active(): boolean {
		return this.#buttons !== 0;
	}

	readonly #preventMiddleDefault = (event: MouseEvent): void => {
		if (event.button === 1) event.preventDefault();
	};

	readonly #down = (event: MouseEvent): void => {
		if (!this.#options.gate.allowed) return;
		if (!this.active && event.target !== this.#options.canvas) return;
		if (event.button < 0 || event.button > 2) return;
		const mask =
			event.button === 0 ? LEFT : event.button === 1 ? MIDDLE : RIGHT;
		if ((this.#buttons & mask) !== 0) return;
		const wasActive = this.active;
		if (!wasActive) {
			this.#motion = beginClientViewportPointerGesture(
				event.clientX,
				event.clientY,
			);
		}
		this.#buttons |= mask;
		event.preventDefault();
		this.#click =
			wasActive || event.button === 1
				? null
				: {
						button: event.button,
						kind:
							event.button === 2
								? "examine"
								: this.#options.precise()
									? "jump"
									: "select",
					};
		this.#update(event);
	};

	#update(event: MouseEvent): void {
		const settings = this.#options.settings();
		const middle =
			settings.middleButtonForward && (this.#buttons & MIDDLE) !== 0;
		const both =
			settings.bothButtonsForward &&
			(this.#buttons & (LEFT | RIGHT)) === (LEFT | RIGHT);
		if (middle || both) this.#click = null;
		if (middle !== this.#middleForward) {
			this.#middleForward = middle;
			this.#options.movement.onForward("middle-button", middle);
		}
		if (both !== this.#bothForward) {
			this.#bothForward = both;
			this.#options.movement.onForward("both-buttons", both);
		}
		const mode =
			settings.rightButtonSteering && (this.#buttons & RIGHT) !== 0
				? "steer"
				: (this.#buttons & LEFT) !== 0
					? "orbit"
					: null;
		if (mode === this.#mode) return;
		if (this.#mode === "steer") this.#unlock();
		this.#mode = mode;
		this.#motion =
			mode === null
				? null
				: beginClientViewportPointerGesture(event.clientX, event.clientY);
		if (mode === "steer") this.#options.camera()?.followRear(performance.now());
	}

	readonly #move = (event: MouseEvent): void => {
		if (!this.#options.gate.allowed) return;
		const locked = this.#document.pointerLockElement === this.#options.canvas;
		if (!this.active) return;
		// Missing releases cannot resurrect a held source on a later movement sample.
		if ((this.#buttons & event.buttons) !== this.#buttons) {
			this.#buttons &= event.buttons;
			this.#click = null;
			this.#update(event);
		}
		if (locked && this.#mode === "steer") {
			this.#steer(event.movementX, event.movementY);
			return;
		}
		this.#advanceMotion(event, true);
	};

	#advanceMotion(event: MouseEvent, allowLock: boolean): void {
		const motion = this.#motion;
		if (motion === null) return;
		const advance = advanceClientViewportPointerGesture(
			motion,
			event.clientX,
			event.clientY,
		);
		this.#motion = advance.gesture;
		this.#options.onPosition(
			event.clientX,
			event.clientY,
			advance.gesture.dragging && this.#mode === "orbit",
		);
		if (advance.dragDelta === null) return;
		this.#click = null;
		if (this.#mode === "steer") {
			this.#steer(advance.dragDelta.x, advance.dragDelta.y);
			if (allowLock) this.#requestLock();
		} else if (this.#mode === "orbit") {
			this.#options
				.camera()
				?.orbit(advance.dragDelta.x, -advance.dragDelta.y, performance.now());
		}
	}

	#steer(deltaX: number, deltaY: number): void {
		if (deltaX !== 0)
			this.#options.movement.onTurn(deltaX * this.#options.yawRadiansPerPixel);
		if (deltaY !== 0) this.#options.camera()?.pitch(-deltaY);
	}

	readonly #up = (event: MouseEvent): void => {
		if (!this.active) return;
		// A release can carry displacement not previously delivered by mousemove.
		if (this.#document.pointerLockElement !== this.#options.canvas)
			this.#advanceMotion(event, false);
		const click = this.#click;
		this.#buttons &= event.buttons;
		this.#click = null;
		this.#update(event);
		if (click?.button !== event.button || !this.#options.gate.allowed) return;
		if (click.kind === "examine")
			this.#options.onExamine(event.clientX, event.clientY);
		else if (click.kind === "jump") this.#options.onJump();
		else this.#options.onSelect(event.clientX, event.clientY);
	};

	#requestLock(): void {
		if (
			this.#lockPending ||
			this.#document.pointerLockElement === this.#options.canvas
		)
			return;
		this.#lockWanted = true;
		const generation = this.#lockGeneration;
		this.#lockPending = true;
		this.#options.canvas
			.requestPointerLock()
			.then(() => {
				if (generation !== this.#lockGeneration || !this.#lockWanted) {
					if (this.#document.pointerLockElement === this.#options.canvas)
						this.#document.exitPointerLock();
				}
			})
			.catch((error: unknown) => {
				if (generation !== this.#lockGeneration) return;
				this.#endSteering();
				this.#options.movement.onError(
					`Mouse steering could not capture the pointer: ${String(error)}`,
				);
			})
			.finally(() => {
				this.#lockPending = false;
			});
	}

	readonly #lockChanged = (): void => {
		// Locked movement has no absolute drag origin. Keeping it would turn cursor restoration
		// on release into another character rotation before pointerlockchange finishes cleanup.
		if (this.#document.pointerLockElement === this.#options.canvas)
			this.#motion = null;
		if (
			this.#document.pointerLockElement !== this.#options.canvas &&
			this.#lockWanted
		)
			this.#endSteering();
	};

	#unlock(): void {
		this.#lockWanted = false;
		this.#lockGeneration += 1;
		if (this.#document.pointerLockElement === this.#options.canvas)
			this.#document.exitPointerLock();
	}

	/** Retire capture and queued yaw while the physical forward buttons remain held.
	 * A cleared drag origin prevents re-locking until a fresh steering hold starts.
	 */
	#endSteering(): void {
		this.#motion = null;
		this.#click = null;
		this.#unlock();
		this.#options.movement.onCancelTurn();
	}

	/** Cancel physical sources and pending clicks without manufacturing a jump release. */
	readonly cancel = (): void => {
		this.#buttons = 0;
		this.#mode = null;
		if (this.#middleForward)
			this.#options.movement.onForward("middle-button", false);
		if (this.#bothForward)
			this.#options.movement.onForward("both-buttons", false);
		this.#middleForward = false;
		this.#bothForward = false;
		this.#endSteering();
	};

	/** Release every listener and the shared viewport cancellation registration. */
	destroy(): void {
		this.#detachGate();
		this.#window.removeEventListener("mousedown", this.#down);
		this.#window.removeEventListener("mousemove", this.#move);
		this.#window.removeEventListener("mouseup", this.#up);
		this.#options.canvas.removeEventListener("pointercancel", this.cancel);
		this.#options.canvas.removeEventListener(
			"auxclick",
			this.#preventMiddleDefault,
		);
		this.#document.removeEventListener("pointerlockchange", this.#lockChanged);
	}
}
