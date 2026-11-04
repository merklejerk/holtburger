import { describe, expect, it, vi } from "vitest";
import { mountModelRotation } from "./client-model-rotation";

class Surface extends EventTarget {
	readonly attributes = new Map<string, string>();
	readonly capture = new Set<number>();
	readonly focus = vi.fn();
	setAttribute(name: string, value: string) {
		this.attributes.set(name, value);
	}
	setPointerCapture(id: number) {
		this.capture.add(id);
	}
	hasPointerCapture(id: number) {
		return this.capture.has(id);
	}
	releasePointerCapture(id: number) {
		this.capture.delete(id);
	}
}
const input = {
	initialYawRadians: 0,
	yawRadiansPerPixel: 0.01,
	keyboardYawStepRadians: 0.2,
};
function dispatch(
	surface: Surface,
	type: string,
	fields: Record<string, number | string>,
) {
	const event = Object.assign(new Event(type, { cancelable: true }), fields);
	surface.dispatchEvent(event);
	return event;
}

describe("shared model rotation input", () => {
	it("rotates only the captured pointer without acquiring keyboard focus, and retires capture/listeners", () => {
		const surface = new Surface();
		const changed = vi.fn();
		const gesture = mountModelRotation(surface, {
			...input,
			keyboardNavigation: false,
			onHeading: changed,
		});
		dispatch(surface, "pointerdown", { button: 0, pointerId: 1, clientX: 10 });
		expect(surface.capture.has(1)).toBe(true);
		expect(surface.focus).not.toHaveBeenCalled();
		dispatch(surface, "pointermove", { pointerId: 2, clientX: 100 });
		expect(changed).not.toHaveBeenCalled();
		dispatch(surface, "pointermove", { pointerId: 1, clientX: 30 });
		expect(gesture.heading()).toBeCloseTo(20 * input.yawRadiansPerPixel);
		expect(changed).toHaveBeenCalledOnce();
		surface.dispatchEvent(new Event("blur"));
		expect(surface.capture.size).toBe(0);
		dispatch(surface, "pointermove", { pointerId: 1, clientX: 50 });
		expect(changed).toHaveBeenCalledOnce();
		dispatch(surface, "pointerdown", { button: 0, pointerId: 3, clientX: 40 });
		gesture.destroy();
		expect(surface.capture.size).toBe(0);
		dispatch(surface, "pointerdown", { button: 0, pointerId: 4, clientX: 40 });
		expect(surface.capture.size).toBe(0);
	});
	it.each([true, false])(
		"restricts arrow-key rotation to keyboard-enabled inspection (%s)",
		(keyboardNavigation) => {
			const surface = new Surface();
			const changed = vi.fn();
			const gesture = mountModelRotation(surface, {
				...input,
				keyboardNavigation,
				onHeading: changed,
			});
			const event = dispatch(surface, "keydown", { key: "ArrowRight" });
			expect(gesture.heading()).toBe(
				keyboardNavigation
					? input.keyboardYawStepRadians
					: input.initialYawRadians,
			);
			expect(event.defaultPrevented).toBe(keyboardNavigation);
			gesture.destroy();
		},
	);
});
