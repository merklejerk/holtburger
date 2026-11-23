import { describe, expect, it, vi } from "vitest";
import { Vec3 } from "../../lib/game/math/types";
import { AppInput } from "../../lib/input/app-input";
import { createInputDefaults } from "../../lib/input/input-defaults";
import { KeyboardInputPolicy } from "../../lib/input/keyboard-input-policy";
import { ViewportInputGate } from "../../lib/input/viewport-input-gate";
import { VIEWPORT_DRAG_THRESHOLD_PIXELS } from "../../lib/input/viewport-pointer-gesture";
import { EXPLORER_TUNING } from "../explorer-tuning";
import {
	ExplorerCameraInputController,
	type PrimaryPointerOverlay,
} from "./camera-input-controller";

const WHEEL_DELTA = 100;
const WHEEL_DISTANCE =
	-Math.min(WHEEL_DELTA, EXPLORER_TUNING.camera.controls.wheelDeltaClamp) *
	EXPLORER_TUNING.camera.controls.wheelLocalUpUnitsPerDelta;

function controllerHarness(
	keyboardYawRadiansPerSecond?: (precisionActive: boolean) => number,
	primaryPointerOverlay?: PrimaryPointerOverlay,
) {
	const canvasListeners = new Map<string, EventListener>();
	const windowListeners = new Map<string, EventListener>();
	const documentListeners = new Map<string, EventListener>();
	let animationFrame: FrameRequestCallback | null = null;
	let pointerLockElement: HTMLCanvasElement | null = null;

	const exitPointerLock = vi.fn(() => {
		pointerLockElement = null;
		documentListeners.get("pointerlockchange")?.(
			new Event("pointerlockchange"),
		);
	});

	const fakeWindow = {
		addEventListener: (
			type: string,
			listener: EventListenerOrEventListenerObject,
		) => {
			if (typeof listener === "function") windowListeners.set(type, listener);
		},
		removeEventListener: vi.fn(),
	};

	const fakeDocument = {
		defaultView: fakeWindow,
		get pointerLockElement() {
			return pointerLockElement;
		},
		exitPointerLock,
		addEventListener: (
			type: string,
			listener: EventListenerOrEventListenerObject,
		) => {
			if (typeof listener === "function") documentListeners.set(type, listener);
		},
		removeEventListener: vi.fn(),
	};

	const canvas = {
		ownerDocument: fakeDocument,
		addEventListener: (
			type: string,
			listener: EventListenerOrEventListenerObject,
		) => {
			if (typeof listener === "function") canvasListeners.set(type, listener);
		},
		removeEventListener: vi.fn(),
		toggleAttribute: vi.fn(),
		removeAttribute: vi.fn(),
		requestPointerLock: vi.fn(() => {
			pointerLockElement = canvas;
			documentListeners.get("pointerlockchange")?.(
				new Event("pointerlockchange"),
			);
			return Promise.resolve();
		}),
	} as unknown as HTMLCanvasElement;

	const changes = vi.fn();
	const physicalWheel = vi.fn();
	const characterInput = vi.fn();
	const possessionOrbit = vi.fn();
	const possessionOrbitHeld = vi.fn();
	const possessionFollowRear = vi.fn();
	const possessionPitch = vi.fn();
	const possessionTurn = vi.fn();
	const possessionCancelTurn = vi.fn();
	const possessionForward = vi.fn();
	const possessionToggleAutoRun = vi.fn();
	const possessionWheel = vi.fn();
	const viewportClick = vi.fn();
	const viewportSecondaryClick = vi.fn();

	const inputGate = new ViewportInputGate();
	const keyboard = new KeyboardInputPolicy(inputGate);
	const controller = new ExplorerCameraInputController({
		inputGate,
		keyboard,
		input: new AppInput(createInputDefaults("windows")),
		canvas,
		keyboardYawRadiansPerSecond,
		onChange: changes,
		onPhysicalWheel: physicalWheel,
		onCharacterInput: characterInput,
		onPossessionOrbit: possessionOrbit,
		onPossessionOrbitHeld: possessionOrbitHeld,
		onPossessionFollowRear: possessionFollowRear,
		onPossessionPitch: possessionPitch,
		onPossessionTurn: possessionTurn,
		onPossessionCancelTurn: possessionCancelTurn,
		onPossessionForward: possessionForward,
		onPossessionToggleAutoRun: possessionToggleAutoRun,
		onPossessionWheel: possessionWheel,
		onViewportClick: viewportClick,
		onViewportSecondaryClick: viewportSecondaryClick,
		primaryPointerOverlay,
		requestAnimationFrame: (callback) => {
			animationFrame = callback;
			return 1;
		},
		cancelAnimationFrame: vi.fn(),
	});

	const dispatch = (type: string, event: object): void => {
		const payload = {
			target: canvas,
			buttons: 0,
			movementX: 0,
			movementY: 0,
			clientX: 0,
			clientY: 0,
			stopImmediatePropagation: vi.fn(),
			preventDefault: vi.fn(),
			getModifierState: (key: string) =>
				key === "Shift" && "shiftKey" in event && event.shiftKey === true,
			...event,
		};
		if (type === "keydown") {
			keyboard.keydown(payload as unknown as KeyboardEvent);
			return;
		}
		if (type === "keyup") {
			keyboard.keyup(payload as unknown as KeyboardEvent);
			return;
		}
		if (type === "blur") {
			inputGate.cancel("release-held");
			return;
		}
		const handler = windowListeners.get(type) ?? canvasListeners.get(type);
		handler?.(payload as unknown as Event);
	};

	return {
		canvas,
		inputGate,
		changes,
		physicalWheel,
		characterInput,
		controller,
		dispatch,
		exitPointerLock,
		possessionOrbit,
		possessionOrbitHeld,
		possessionFollowRear,
		possessionPitch,
		possessionTurn,
		possessionCancelTurn,
		possessionForward,
		possessionToggleAutoRun,
		possessionWheel,
		viewportClick,
		viewportSecondaryClick,
		tick(frameAt: number) {
			const callback = animationFrame;
			animationFrame = null;
			callback?.(frameAt);
		},
	};
}

describe("ExplorerCameraInputController scheme routing", () => {
	it("locks the pointer on fly drag and keeps dragging when movement keys release", () => {
		const test = controllerHarness();
		test.dispatch("mousedown", { button: 0, buttons: 1 });
		test.dispatch("keydown", { key: "w", shiftKey: false });
		test.dispatch("keyup", { key: "w", shiftKey: false });
		test.dispatch("mousemove", {
			buttons: 1,
			movementX: VIEWPORT_DRAG_THRESHOLD_PIXELS + 10,
			movementY: 0,
		});
		expect(test.exitPointerLock).not.toHaveBeenCalled();
		expect(test.controller.snapshotState().yawRadians).not.toBe(
			EXPLORER_TUNING.camera.initialOrientation.yawRadians,
		);
	});

	it("unlocks pointer capture when input is withdrawn", () => {
		const test = controllerHarness();
		test.dispatch("mousedown", { button: 0, buttons: 1 });

		test.inputGate.block();

		expect(test.exitPointerLock).toHaveBeenCalled();
	});

	it("fires onViewportClick for an undragged left click and suppresses it after a drag", () => {
		const test = controllerHarness();
		test.dispatch("mousedown", {
			button: 0,
			buttons: 1,
			clientX: 120,
			clientY: 80,
		});
		test.dispatch("mouseup", {
			button: 0,
			buttons: 0,
			clientX: 120,
			clientY: 80,
		});
		expect(test.viewportClick).toHaveBeenCalledWith(120, 80);

		test.viewportClick.mockClear();
		test.dispatch("mousedown", { button: 0, buttons: 1 });
		test.dispatch("mousemove", {
			buttons: 1,
			movementX: VIEWPORT_DRAG_THRESHOLD_PIXELS + 5,
			movementY: 0,
		});
		test.dispatch("mouseup", {
			button: 0,
			buttons: 0,
			clientX: 140,
			clientY: 80,
		});
		expect(test.viewportClick).not.toHaveBeenCalled();
	});

	it("fires onViewportSecondaryClick for an undragged right click and suppresses it after drag or chord", () => {
		const test = controllerHarness();
		test.dispatch("mousedown", {
			button: 2,
			buttons: 2,
			clientX: 210,
			clientY: 145,
		});
		test.dispatch("mouseup", {
			button: 2,
			buttons: 0,
			clientX: 210,
			clientY: 145,
		});
		expect(test.viewportSecondaryClick).toHaveBeenCalledWith(210, 145);
		expect(test.viewportClick).not.toHaveBeenCalled();

		// Right-drag suppresses secondary click.
		test.viewportSecondaryClick.mockClear();
		test.dispatch("mousedown", { button: 2, buttons: 2 });
		test.dispatch("mousemove", {
			buttons: 2,
			movementX: VIEWPORT_DRAG_THRESHOLD_PIXELS + 5,
			movementY: 0,
		});
		test.dispatch("mouseup", {
			button: 2,
			buttons: 0,
			clientX: 230,
			clientY: 145,
		});
		expect(test.viewportSecondaryClick).not.toHaveBeenCalled();

		// Left+right chord suppresses secondary click.
		test.dispatch("mousedown", { button: 2, buttons: 2 });
		test.dispatch("mousedown", { button: 0, buttons: 3 });
		test.dispatch("mouseup", { button: 0, buttons: 2 });
		test.dispatch("mouseup", { button: 2, buttons: 0 });
		expect(test.viewportSecondaryClick).not.toHaveBeenCalled();
		expect(test.viewportClick).not.toHaveBeenCalled();
	});

	it("defers possession followRear on a lone right press until dragging begins", () => {
		const test = controllerHarness();
		test.controller.setControlScheme({ kind: "possessed-character" });

		// Undragged right-click inspects without snapping the camera behind the character.
		test.dispatch("mousedown", {
			button: 2,
			buttons: 2,
			clientX: 90,
			clientY: 60,
		});
		expect(test.possessionFollowRear).not.toHaveBeenCalled();
		test.dispatch("mouseup", {
			button: 2,
			buttons: 0,
			clientX: 90,
			clientY: 60,
		});
		expect(test.possessionFollowRear).not.toHaveBeenCalled();
		expect(test.viewportSecondaryClick).toHaveBeenCalledWith(90, 60);

		// Crossing the drag threshold commits followRear and cancels the secondary click.
		test.viewportSecondaryClick.mockClear();
		test.dispatch("mousedown", { button: 2, buttons: 2 });
		expect(test.possessionFollowRear).not.toHaveBeenCalled();
		test.dispatch("mousemove", {
			buttons: 2,
			movementX: VIEWPORT_DRAG_THRESHOLD_PIXELS + 4,
			movementY: 0,
		});
		expect(test.possessionFollowRear).toHaveBeenCalledTimes(1);
		test.dispatch("mouseup", { button: 2, buttons: 0 });
		expect(test.viewportSecondaryClick).not.toHaveBeenCalled();
	});

	it("raises and lowers the camera on scroll wheel in free-fly and routes to onPhysicalWheel in physical-fly", () => {
		const test = controllerHarness();
		test.controller.setAutomaticPose({
			position: new Vec3(0, 10, 0),
			pitchRadians: 0,
			yawRadians: 0,
		});
		const initialSpeed = test.controller.getMoveSpeed();
		test.dispatch("wheel", { deltaX: 0, deltaY: -WHEEL_DELTA });
		expect(test.controller.getMoveSpeed()).toBe(initialSpeed);
		expect(test.controller.snapshotState().position.y).toBeCloseTo(
			10 - WHEEL_DISTANCE,
		);

		test.controller.setControlScheme({ kind: "physical-fly" });
		test.dispatch("wheel", { deltaX: 0, deltaY: WHEEL_DELTA });
		expect(test.physicalWheel).toHaveBeenCalledWith(WHEEL_DISTANCE);
	});

	it("looks right/down by default on fly drag and uses Explorer-only fly inversion independent of orbit inversion", () => {
		const test = controllerHarness();
		test.controller.setAutomaticPose({
			position: new Vec3(0, 0, 0),
			pitchRadians: 0,
			yawRadians: 0,
		});
		// Flipping Client orbit inversion must not invert Explorer fly-look.
		test.controller.setMouseConfiguration({
			mouseMovement: true,
			invertCameraHorizontal: true,
			invertCameraVertical: true,
			invertSteeringHorizontal: false,
			invertSteeringVertical: false,
		});
		test.dispatch("mousedown", {
			button: 0,
			buttons: 1,
			clientX: 100,
			clientY: 100,
		});
		test.dispatch("mousemove", {
			buttons: 1,
			movementX: VIEWPORT_DRAG_THRESHOLD_PIXELS + 10,
			movementY: VIEWPORT_DRAG_THRESHOLD_PIXELS + 10,
		});
		const normalLook = test.controller.snapshotState();
		expect(normalLook.yawRadians).toBeGreaterThan(0);
		expect(normalLook.pitchRadians).toBeLessThan(0);
		test.dispatch("mouseup", { button: 0, buttons: 0 });

		// Now invert Explorer fly-look explicitly.
		test.controller.setAutomaticPose({
			position: new Vec3(0, 0, 0),
			pitchRadians: 0,
			yawRadians: 0,
		});
		test.controller.setFlyMouseConfiguration({
			invertFlyHorizontal: true,
			invertFlyVertical: true,
		});
		test.dispatch("mousedown", {
			button: 0,
			buttons: 1,
			clientX: 100,
			clientY: 100,
		});
		test.dispatch("mousemove", {
			buttons: 1,
			movementX: VIEWPORT_DRAG_THRESHOLD_PIXELS + 10,
			movementY: VIEWPORT_DRAG_THRESHOLD_PIXELS + 10,
		});
		const invertedLook = test.controller.snapshotState();
		expect(invertedLook.yawRadians).toBeLessThan(0);
		expect(invertedLook.pitchRadians).toBeGreaterThan(0);
		test.dispatch("mouseup", { button: 0, buttons: 0 });
	});

	it("delegates keyboard-yaw rate to the active app regime using ArrowRight", () => {
		const walking = controllerHarness((precisionActive) =>
			precisionActive ? 1.5 : 2.25,
		);
		walking.controller.setControlScheme({ kind: "physical-fly" });
		walking.dispatch("keydown", {
			key: "Shift",
			shiftKey: true,
			repeat: false,
		});
		walking.dispatch("keydown", {
			key: "ArrowRight",
			shiftKey: true,
			repeat: false,
		});
		walking.tick(0);
		walking.tick(50);

		const running = controllerHarness((precisionActive) =>
			precisionActive ? 1.5 : 2.25,
		);
		running.controller.setControlScheme({ kind: "physical-fly" });
		running.dispatch("keydown", {
			key: "ArrowRight",
			shiftKey: false,
			repeat: false,
		});
		running.tick(0);
		running.tick(50);

		expect(walking.controller.snapshotState().yawRadians).toBeCloseTo(0.075);
		expect(running.controller.snapshotState().yawRadians).toBeCloseTo(0.1125);
	});

	it("publishes normalized character edges and focus reset without assigning semantics", () => {
		const test = controllerHarness();
		test.controller.setControlScheme({ kind: "possessed-character" });
		test.characterInput.mockClear();
		test.dispatch("keydown", {
			key: " ",
			code: "Space",
			repeat: false,
			shiftKey: false,
		});
		test.dispatch("keyup", { key: " ", code: "Space", shiftKey: false });
		test.dispatch("blur", {});

		expect(test.characterInput.mock.calls.map(([input]) => input)).toEqual([
			{ action: "jump", kind: "action", pressed: true },
			{ action: "jump", kind: "action", pressed: false },
			{ kind: "reset" },
		]);
	});

	it("routes held local input while host position authority is active", () => {
		const test = controllerHarness();
		test.controller.setControlScheme({ kind: "physical-fly" });

		test.dispatch("keydown", { key: "w", shiftKey: false });
		expect(test.controller.physicalFlyInput().movement.forward).toBe(1);
		expect(test.changes).toHaveBeenCalledOnce();

		test.dispatch("keyup", { key: "w", shiftKey: false });
		expect(test.controller.physicalFlyInput().movement.forward).toBe(0);
		expect(test.changes).toHaveBeenCalledTimes(2);
	});

	it("applies solved presentation without feeding it back as user input", () => {
		const test = controllerHarness();
		test.controller.applyPresentedPosition(new Vec3(10, 20, 30));

		expect(test.controller.snapshotState().position).toEqual(
			new Vec3(10, 20, 30),
		);
		expect(test.changes).not.toHaveBeenCalled();
	});

	it("routes possessed left-drag orbit, right-drag steering, mouse forward, autorun, and wheel", () => {
		const test = controllerHarness();
		test.controller.setControlScheme({ kind: "possessed-character" });

		// Left-drag orbits and signals orbitHeld.
		test.dispatch("mousedown", { button: 0, buttons: 1 });
		expect(test.possessionOrbitHeld).toHaveBeenCalledWith(
			true,
			expect.any(Number),
		);
		test.dispatch("mousemove", { buttons: 1, movementX: 10, movementY: -6 });
		expect(test.possessionOrbit).toHaveBeenCalledWith(-10, 6);
		test.dispatch("mouseup", { button: 0, buttons: 0 });
		expect(test.possessionOrbitHeld).toHaveBeenLastCalledWith(
			false,
			expect.any(Number),
		);

		// Right-drag steers facing yaw and pitches camera, entering rear follow once dragging begins.
		test.dispatch("mousedown", { button: 2, buttons: 2 });
		test.dispatch("mousemove", { buttons: 2, movementX: 8, movementY: 5 });
		expect(test.possessionFollowRear).toHaveBeenCalled();
		expect(test.possessionTurn).toHaveBeenCalledWith(
			8 * EXPLORER_TUNING.camera.controls.pointerYawRadiansPerPixel,
		);
		expect(test.possessionPitch).toHaveBeenCalledWith(-5);
		test.dispatch("mouseup", { button: 2, buttons: 0 });

		// Middle button drives forward.
		test.dispatch("mousedown", { button: 1, buttons: 4 });
		expect(test.possessionForward).toHaveBeenCalledWith("middle-button", true);
		test.dispatch("mouseup", { button: 1, buttons: 0 });
		expect(test.possessionForward).toHaveBeenCalledWith("middle-button", false);

		// Autorun key toggles autorun.
		test.dispatch("keydown", { key: "q", repeat: false });
		expect(test.possessionToggleAutoRun).toHaveBeenCalledOnce();

		// Wheel zooms boom reach.
		test.dispatch("wheel", { deltaX: 0, deltaY: WHEEL_DELTA });
		expect(test.possessionWheel).toHaveBeenCalledWith(WHEEL_DISTANCE);
		expect(test.controller.snapshotState().yawRadians).toBe(0);
	});

	it("toggles fly autorun with Q and retires it on W/S, and maps Space / Ctrl+Space to ascend / descend", () => {
		const test = controllerHarness();
		test.controller.setControlScheme({ kind: "physical-fly" });

		test.dispatch("keydown", { key: "q", repeat: false });
		expect(test.controller.physicalFlyInput().movement.forward).toBe(1);

		test.dispatch("keydown", { key: "s", repeat: false });
		expect(test.controller.physicalFlyInput().movement.forward).toBe(-1);
		test.dispatch("keyup", { key: "s" });
		expect(test.controller.physicalFlyInput().movement.forward).toBe(0);

		test.dispatch("keydown", {
			key: " ",
			code: "Space",
			ctrlKey: false,
			repeat: false,
		});
		expect(test.controller.physicalFlyInput().movement.up).toBe(1);
		test.dispatch("keyup", { key: " ", code: "Space", ctrlKey: false });

		test.dispatch("keydown", {
			key: " ",
			code: "Space",
			ctrlKey: true,
			repeat: false,
		});
		expect(test.controller.physicalFlyInput().movement.up).toBe(-1);
		test.dispatch("keyup", { key: " ", code: "Space", ctrlKey: true });
		expect(test.controller.physicalFlyInput().movement.up).toBe(0);
	});

	it("resets the outgoing character owner exactly once on scheme transition", () => {
		const test = controllerHarness();
		test.controller.setControlScheme({ kind: "possessed-character" });
		test.characterInput.mockClear();

		test.controller.setControlScheme({ kind: "free-fly" });

		expect(test.characterInput).toHaveBeenCalledOnce();
		expect(test.characterInput).toHaveBeenCalledWith({ kind: "reset" });
	});

	it("preempts pointer lock, camera look, and click selection when a primary gizmo drag claims mousedown", () => {
		const overlay = {
			onHover: vi.fn(),
			onHoverLeave: vi.fn(),
			tryBeginDrag: vi.fn(() => true),
			onDragMove: vi.fn(),
			onDragEnd: vi.fn(),
		};
		const test = controllerHarness(undefined, overlay);

		// Unlocked hover reaches gizmo hover callback.
		test.dispatch("mousemove", { buttons: 0, clientX: 120, clientY: 240 });
		expect(overlay.onHover).toHaveBeenCalledWith(120, 240);

		// Claimed left-mousedown starts primary drag without pointer lock or camera rotation.
		test.dispatch("mousedown", {
			button: 0,
			buttons: 1,
			clientX: 120,
			clientY: 240,
		});
		expect(overlay.tryBeginDrag).toHaveBeenCalledWith(120, 240);
		expect(test.canvas.requestPointerLock).not.toHaveBeenCalled();

		test.dispatch("mousemove", {
			buttons: 1,
			clientX: 180,
			clientY: 250,
			movementX: 60,
			movementY: 10,
			shiftKey: true,
		});
		expect(overlay.onDragMove).toHaveBeenCalledWith(180, 250, true);
		expect(test.changes).not.toHaveBeenCalled();

		// Release commits primary drag and never fires click-to-select.
		test.dispatch("mouseup", {
			button: 0,
			buttons: 0,
			clientX: 180,
			clientY: 250,
		});
		expect(overlay.onDragEnd).toHaveBeenCalledWith(true);
		expect(test.viewportClick).not.toHaveBeenCalled();
	});

	it("cancels an active primary drag cleanly via cancelPrimaryDrag or input gate block without leaking mouseup", () => {
		const overlay = {
			onHover: vi.fn(),
			onHoverLeave: vi.fn(),
			tryBeginDrag: vi.fn(() => true),
			onDragMove: vi.fn(),
			onDragEnd: vi.fn(),
		};
		const test = controllerHarness(undefined, overlay);

		// Cancel mid-drag (e.g. Escape) while LMB is still held.
		test.dispatch("mousedown", { button: 0, buttons: 1 });
		expect(test.controller.cancelPrimaryDrag()).toBe(true);
		expect(overlay.onDragEnd).toHaveBeenCalledWith(false);
		expect(test.controller.cancelPrimaryDrag()).toBe(false);

		// Further mousemove/mouseup from that cancelled press never re-trigger drag or click.
		test.dispatch("mousemove", { buttons: 1, clientX: 200, clientY: 200 });
		test.dispatch("mouseup", { button: 0, buttons: 0 });
		expect(overlay.onDragMove).not.toHaveBeenCalled();
		expect(overlay.onDragEnd).toHaveBeenCalledTimes(1);
		expect(test.viewportClick).not.toHaveBeenCalled();

		// Gate block also cancels an active primary drag.
		test.dispatch("mousedown", { button: 0, buttons: 1 });
		const release = test.inputGate.block();
		expect(overlay.onDragEnd).toHaveBeenLastCalledWith(false);
		release();

		// Miss falls back cleanly to normal viewport click.
		const missHarness = controllerHarness(undefined, {
			onHover: vi.fn(),
			onHoverLeave: vi.fn(),
			tryBeginDrag: () => false,
			onDragMove: vi.fn(),
			onDragEnd: vi.fn(),
		});
		missHarness.dispatch("mousedown", {
			button: 0,
			buttons: 1,
			clientX: 50,
			clientY: 60,
		});
		missHarness.dispatch("mouseup", {
			button: 0,
			buttons: 0,
			clientX: 50,
			clientY: 60,
		});
		expect(missHarness.viewportClick).toHaveBeenCalledWith(50, 60);
	});
});
