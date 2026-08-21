import { describe, expect, it } from "vitest";
import { AudioControlCadence } from "./audio-control-cadence";

describe("AudioControlCadence", () => {
	it("updates immediately, then at the configured cadence", () => {
		const cadence = new AudioControlCadence(1 / 30);

		expect(cadence.shouldUpdate(0, false)).toBe(true);
		expect(cadence.shouldUpdate(0.02, false)).toBe(false);
		expect(cadence.shouldUpdate(1 / 30, false)).toBe(true);
	});

	it("forces and rebases an update for a discrete audio-state change", () => {
		const cadence = new AudioControlCadence(1 / 30);
		cadence.shouldUpdate(0, false);

		expect(cadence.shouldUpdate(0.01, true)).toBe(true);
		expect(cadence.shouldUpdate(0.04, false)).toBe(false);
		expect(cadence.shouldUpdate(0.01 + 1 / 30, false)).toBe(true);
	});

	it("rebases after a clock regression and does not replay missed updates", () => {
		const cadence = new AudioControlCadence(1 / 30);
		cadence.shouldUpdate(10, false);

		expect(cadence.shouldUpdate(12, false)).toBe(true);
		expect(cadence.shouldUpdate(12.001, false)).toBe(false);
		expect(cadence.shouldUpdate(5, false)).toBe(true);
		expect(cadence.shouldUpdate(5.001, false)).toBe(false);
	});

	it("rejects invalid intervals and times", () => {
		expect(() => new AudioControlCadence(0)).toThrow("finite and positive");
		const cadence = new AudioControlCadence(1 / 30);
		expect(() => cadence.shouldUpdate(Number.NaN, false)).toThrow("finite");
	});
});
