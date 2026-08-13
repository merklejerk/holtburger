import { describe, expect, it, vi } from "vitest";
import { Vec3 } from "../lib/game/math/types";
import { FreeFlyCameraController } from "./free-fly-camera-controller";

function controllerHarness() {
	const listeners = new Map<string, EventListener>();
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
	const controller = new FreeFlyCameraController({
		canvas,
		onChange: changes,
		onPhysicalWheel: physicalWheel,
		requestAnimationFrame: () => 1,
		cancelAnimationFrame: vi.fn(),
	});
	const dispatch = (type: string, event: object): void => {
		listeners.get(type)?.({
			preventDefault: vi.fn(),
			...event,
		} as unknown as Event);
	};
	return { changes, controller, dispatch, physicalWheel };
}

describe("FreeFlyCameraController physical handoff", () => {
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
