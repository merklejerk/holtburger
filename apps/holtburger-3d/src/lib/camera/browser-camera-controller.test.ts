import { describe, expect, it } from "vitest";

import { BrowserCameraController } from "./browser-camera-controller";
import { createFreeCameraState } from "./free-camera";

describe("browser camera controller", () => {
	it("rotates from primary-button pointer drag", () => {
		const controller = new BrowserCameraController({
			initialState: createFreeCameraState(),
			onChange() {},
		});
		const target = createPointerTarget();

		expect(
			controller.handlePointerDown(
				createPointerEvent({ button: 0, clientX: 10, clientY: 20 }),
				target,
			),
		).toBe(true);
		expect(
			controller.handlePointerMove(
				createPointerEvent({ clientX: 20, clientY: 10 }),
			),
		).toBe(true);

		const snapshot = controller.createSnapshot();
		expect(snapshot.yawRadians).toBeCloseTo(-0.06);
		expect(snapshot.pitchRadians).toBeCloseTo(-0.5);
		expect(snapshot.hasManualControl).toBe(true);
	});

	it("pans from auxiliary-button pointer drag", () => {
		const controller = new BrowserCameraController({
			initialState: {
				...createFreeCameraState(),
				position: [0, 0, 0],
				yawRadians: 0,
				pitchRadians: 0,
				focusDistance: 100,
			},
			onChange() {},
		});
		const target = createPointerTarget();

		controller.handlePointerDown(
			createPointerEvent({ button: 2, clientX: 10, clientY: 20 }),
			target,
		);
		controller.handlePointerMove(
			createPointerEvent({ button: 2, clientX: 20, clientY: 40 }),
		);

		const snapshot = controller.createSnapshot();
		expect(snapshot.position[0]).toBeCloseTo(-0.5);
		expect(snapshot.position[1]).toBeCloseTo(1);
		expect(snapshot.position[2]).toBeCloseTo(0);
	});

	it("moves along local up from wheel input", () => {
		const controller = new BrowserCameraController({
			initialState: {
				...createFreeCameraState(),
				position: [0, 0, 0],
				yawRadians: 0,
				pitchRadians: 0,
			},
			onChange() {},
		});

		expect(controller.handleWheel(createWheelEvent({ deltaY: 100 }))).toBe(
			true,
		);

		expect(controller.createSnapshot().position[1]).toBeCloseTo(2.5);
	});

	it("applies continuous keyboard movement through the scheduler", () => {
		const scheduler = createAnimationScheduler();
		const controller = new BrowserCameraController({
			initialState: {
				...createFreeCameraState(),
				position: [0, 0, 0],
				yawRadians: 0,
				pitchRadians: 0,
				moveSpeed: 10,
			},
			onChange() {},
			requestAnimationFrame: scheduler.requestAnimationFrame,
			cancelAnimationFrame: scheduler.cancelAnimationFrame,
		});

		expect(controller.handleKeyDown(createKeyboardEvent("w"))).toBe(true);
		scheduler.step(0);
		scheduler.step(1000);

		expect(controller.createSnapshot().position[2]).toBeCloseTo(-0.0625);
		expect(controller.handleKeyUp(createKeyboardEvent("w"))).toBe(true);
	});

	it("resets to the default camera", () => {
		const controller = new BrowserCameraController({
			initialState: {
				...createFreeCameraState(),
				position: [10, 20, 30],
				hasManualControl: true,
			},
			onChange() {},
		});

		controller.reset();

		expect(controller.createSnapshot()).toEqual(createFreeCameraState());
	});

	it("replaces camera state programmatically", () => {
		const nextState = {
			...createFreeCameraState(),
			position: [10, 20, 30] as const,
			pitchRadians: 0,
			yawRadians: 1,
		};
		const controller = new BrowserCameraController({
			initialState: createFreeCameraState(),
			onChange() {},
		});

		controller.setState(nextState);

		expect(controller.createSnapshot()).toEqual(nextState);
	});
});

function createPointerTarget(): HTMLElement {
	return {
		focus() {},
		hasPointerCapture() {
			return true;
		},
		releasePointerCapture() {},
		setPointerCapture() {},
	} as unknown as HTMLElement;
}

function createPointerEvent({
	button = 0,
	clientX,
	clientY,
	pointerId = 1,
	shiftKey = false,
}: {
	readonly button?: number;
	readonly clientX: number;
	readonly clientY: number;
	readonly pointerId?: number;
	readonly shiftKey?: boolean;
}): PointerEvent {
	return {
		button,
		clientX,
		clientY,
		pointerId,
		shiftKey,
	} as PointerEvent;
}

function createWheelEvent({
	deltaX = 0,
	deltaY = 0,
	shiftKey = false,
}: {
	readonly deltaX?: number;
	readonly deltaY?: number;
	readonly shiftKey?: boolean;
}): WheelEvent {
	return {
		deltaX,
		deltaY,
		shiftKey,
	} as WheelEvent;
}

function createKeyboardEvent(key: string, shiftKey = false): KeyboardEvent {
	return {
		key,
		shiftKey,
	} as KeyboardEvent;
}

function createAnimationScheduler(): {
	readonly requestAnimationFrame: (callback: FrameRequestCallback) => number;
	readonly cancelAnimationFrame: (handle: number) => void;
	readonly step: (frameAt: number) => void;
} {
	let nextHandle = 1;
	const callbacks = new Map<number, FrameRequestCallback>();

	return {
		requestAnimationFrame(callback) {
			const handle = nextHandle;
			nextHandle += 1;
			callbacks.set(handle, callback);
			return handle;
		},
		cancelAnimationFrame(handle) {
			callbacks.delete(handle);
		},
		step(frameAt) {
			const [handle, callback] = Array.from(callbacks.entries())[0] ?? [];
			if (handle === undefined || !callback) {
				throw new Error("No animation frame callback is queued.");
			}
			callbacks.delete(handle);
			callback(frameAt);
		},
	};
}
