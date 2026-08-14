import { describe, expect, it, vi } from "vitest";
import { Vec3 } from "../lib/game/math/types";
import { FreeFlyCameraController } from "./free-fly-camera-controller";

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
	const controller = new FreeFlyCameraController({
		canvas,
		keyboardYawRadiansPerSecond,
		onChange: changes,
		onCharacterInput: characterInput,
		onPhysicalWheel: physicalWheel,
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
		tick(frameAt: number) {
			const callback = animationFrame;
			animationFrame = null;
			callback?.(frameAt);
		},
	};
}

describe("FreeFlyCameraController physical handoff", () => {
	it("delegates the complete keyboard-yaw rate to the active app regime", () => {
		const walking = controllerHarness((shiftActive) =>
			shiftActive ? 1.5 : 2.25,
		);
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
		running.dispatch("keydown", { key: "d", shiftKey: false, repeat: false });
		running.tick(0);
		running.tick(50);

		expect(walking.controller.snapshotState().yawRadians).toBeCloseTo(0.075);
		expect(running.controller.snapshotState().yawRadians).toBeCloseTo(0.1125);
	});

	it("publishes normalized character edges and focus reset without assigning semantics", () => {
		const test = controllerHarness();
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
		test.controller.setLocalTranslationEnabled(false);

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
		test.controller.setLocalTranslationEnabled(false);

		test.dispatch("wheel", { deltaX: 0, deltaY: 100, shiftKey: false });

		expect(test.physicalWheel).toHaveBeenCalledWith(2.5);
		expect(test.controller.snapshotState().position).toEqual(Vec3.zero());
		expect(test.changes).not.toHaveBeenCalled();
	});
});
