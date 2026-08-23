import { describe, expect, it, vi } from "vitest";
import { Vec3 } from "../lib/game/math/types";
import { ExplorerCameraInputController } from "./explorer-camera-input-controller";

function controllerHarness(
	keyboardYawRadiansPerSecond?: (shiftActive: boolean) => number,
) {
	const listeners = new Map<string, EventListener>();
	let animationFrame: FrameRequestCallback | null = null;
	const canvas = {
		addEventListener: (
			type: string,
			listener: EventListenerOrEventListenerObject,
		) => {
			if (typeof listener === "function") listeners.set(type, listener);
		},
		removeEventListener: vi.fn(),
		focus: vi.fn(),
		setPointerCapture: vi.fn(),
		hasPointerCapture: () => false,
		releasePointerCapture: vi.fn(),
	} as unknown as HTMLCanvasElement;
	const changes = vi.fn();
	const physicalWheel = vi.fn();
	const characterInput = vi.fn();
	const possessionOrbit = vi.fn();
	const possessionWheel = vi.fn();
	const controller = new ExplorerCameraInputController({
		canvas,
		keyboardYawRadiansPerSecond,
		onChange: changes,
		onCharacterInput: characterInput,
		onPhysicalWheel: physicalWheel,
		onPossessionOrbit: possessionOrbit,
		onPossessionWheel: possessionWheel,
		requestAnimationFrame: (callback) => {
			animationFrame = callback;
			return 1;
		},
		cancelAnimationFrame: vi.fn(),
	});
	const dispatch = (type: string, event: object): void => {
		listeners.get(type)?.({
			preventDefault: vi.fn(),
			...event,
		} as unknown as Event);
	};
	return {
		changes,
		characterInput,
		controller,
		dispatch,
		physicalWheel,
		possessionOrbit,
		possessionWheel,
		tick(frameAt: number) {
			const callback = animationFrame;
			animationFrame = null;
			callback?.(frameAt);
		},
	};
}

describe("ExplorerCameraInputController scheme routing", () => {
	it("delegates the complete keyboard-yaw rate to the active app regime", () => {
		const walking = controllerHarness((shiftActive) =>
			shiftActive ? 1.5 : 2.25,
		);
		walking.controller.setControlScheme({ kind: "physical-fly" });
		walking.dispatch("keydown", {
			key: "Shift",
			shiftKey: true,
			repeat: false,
		});
		walking.dispatch("keydown", { key: "d", shiftKey: true, repeat: false });
		walking.tick(0);
		walking.tick(50);

		const running = controllerHarness((shiftActive) =>
			shiftActive ? 1.5 : 2.25,
		);
		running.controller.setControlScheme({ kind: "physical-fly" });
		running.dispatch("keydown", { key: "d", shiftKey: false, repeat: false });
		running.tick(0);
		running.tick(50);

		expect(walking.controller.snapshotState().yawRadians).toBeCloseTo(0.075);
		expect(running.controller.snapshotState().yawRadians).toBeCloseTo(0.1125);
	});

	it("publishes normalized character edges and focus reset without assigning semantics", () => {
		const test = controllerHarness();
		test.controller.setControlScheme({ kind: "possessed-character" });
		test.characterInput.mockClear();
		test.dispatch("keydown", { key: " ", repeat: false, shiftKey: false });
		test.dispatch("keyup", { key: " ", shiftKey: false });
		test.dispatch("blur", {});

		expect(test.characterInput.mock.calls.map(([input]) => input)).toEqual([
			{ key: "space", kind: "key", pressed: true, repeat: false },
			{ key: "space", kind: "key", pressed: false, repeat: false },
			{ kind: "reset" },
		]);
	});

	it("publishes held local input while host position authority is active", () => {
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

	it("routes wheel distance to host policy while host position authority is active", () => {
		const test = controllerHarness();
		test.controller.setControlScheme({ kind: "physical-fly" });

		test.dispatch("wheel", { deltaX: 0, deltaY: 100, shiftKey: false });

		expect(test.physicalWheel).toHaveBeenCalledWith(2.5);
		expect(test.controller.snapshotState().position).toEqual(Vec3.zero());
		expect(test.changes).not.toHaveBeenCalled();
	});

	it("routes possessed orbit and wheel without mutating Explorer free-camera look", () => {
		const test = controllerHarness();
		test.controller.setControlScheme({ kind: "possessed-character" });
		test.dispatch("pointerdown", {
			button: 0,
			clientX: 10,
			clientY: 20,
			pointerId: 1,
		});
		test.dispatch("pointermove", {
			clientX: 14,
			clientY: 17,
			pointerId: 1,
		});
		test.dispatch("wheel", { deltaX: 0, deltaY: 100, shiftKey: false });

		expect(test.possessionOrbit).toHaveBeenCalledWith(4, -3);
		expect(test.possessionWheel).toHaveBeenCalledWith(2.5);
		expect(test.controller.snapshotState().yawRadians).toBe(0);
	});

	it("routes possessed A/D only to character turn and keeps keyboard camera yaw fixed", () => {
		const test = controllerHarness();
		test.controller.setControlScheme({ kind: "possessed-character" });
		test.characterInput.mockClear();

		test.dispatch("keydown", { key: "a", shiftKey: false, repeat: false });
		test.tick(0);
		test.tick(50);

		expect(test.characterInput).toHaveBeenCalledWith({
			key: "a",
			kind: "key",
			pressed: true,
			repeat: false,
		});
		expect(test.controller.snapshotState().yawRadians).toBe(0);
	});

	it("routes the complete possessed keyboard profile and ignores camera-only vertical keys", () => {
		const test = controllerHarness();
		test.controller.setControlScheme({ kind: "possessed-character" });
		test.characterInput.mockClear();

		for (const key of ["w", "s", "z", "c", "a", "d", "Shift", " "])
			test.dispatch("keydown", {
				key,
				repeat: false,
				shiftKey: key === "Shift",
			});
		test.dispatch("keydown", { key: "PageUp", repeat: false, shiftKey: false });
		test.dispatch("keydown", {
			key: "PageDown",
			repeat: false,
			shiftKey: false,
		});

		expect(
			test.characterInput.mock.calls.map(([input]) =>
				input.kind === "key" ? input.key : input.kind,
			),
		).toEqual(["w", "s", "z", "c", "a", "d", "shift", "space"]);
		expect(test.controller.physicalFlyInput().movement).toEqual({
			forward: 0,
			right: 0,
			up: 0,
		});
	});

	it("uses primary drag and host wheel only while disabling possessed pan", () => {
		const test = controllerHarness();
		test.controller.setControlScheme({ kind: "possessed-character" });
		const initial = test.controller.snapshotState();

		test.dispatch("pointerdown", {
			button: 2,
			clientX: 0,
			clientY: 0,
			pointerId: 1,
		});
		test.dispatch("pointermove", {
			clientX: 20,
			clientY: 20,
			pointerId: 1,
			shiftKey: false,
		});
		test.dispatch("wheel", { deltaX: 0, deltaY: 100, shiftKey: true });

		expect(test.controller.snapshotState()).toEqual(initial);
		expect(test.possessionWheel).toHaveBeenCalledWith(2.5);
	});

	it("does not apply Shift precision to possessed pointer orbit", () => {
		const normal = controllerHarness();
		normal.controller.setControlScheme({ kind: "possessed-character" });
		normal.dispatch("pointerdown", {
			button: 0,
			clientX: 0,
			clientY: 0,
			pointerId: 1,
		});
		normal.dispatch("pointermove", {
			clientX: 10,
			clientY: 0,
			pointerId: 1,
			shiftKey: false,
		});

		const shifted = controllerHarness();
		shifted.controller.setControlScheme({ kind: "possessed-character" });
		shifted.dispatch("pointerdown", {
			button: 0,
			clientX: 0,
			clientY: 0,
			pointerId: 1,
		});
		shifted.dispatch("pointermove", {
			clientX: 10,
			clientY: 0,
			pointerId: 1,
			shiftKey: true,
		});

		expect(shifted.controller.snapshotState().yawRadians).toBe(
			normal.controller.snapshotState().yawRadians,
		);
	});

	it("resets the outgoing character owner exactly once on scheme transition", () => {
		const test = controllerHarness();
		test.controller.setControlScheme({ kind: "possessed-character" });
		test.characterInput.mockClear();

		test.controller.setControlScheme({ kind: "free-fly" });

		expect(test.characterInput).toHaveBeenCalledOnce();
		expect(test.characterInput).toHaveBeenCalledWith({ kind: "reset" });
	});
});
