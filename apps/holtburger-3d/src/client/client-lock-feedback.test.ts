import { describe, expect, it } from "vitest";
import { ClientLockFeedbackEffects } from "./client-lock-feedback";
import type { ClientLockFeedback } from "./client-lock-feedback-contract";

const timing = { successLifetimeMs: 100, failureLifetimeMs: 50 };
const failed: ClientLockFeedback = {
	target: 7,
	generation: 2,
	worldGeneration: 3,
	outcome: "failed",
};
const point = () => ({ x: 12, y: 24 });

describe("target-local lock feedback", () => {
	it("restarts repeated failures in one slot and lets success replace them", () => {
		const effects = new ClientLockFeedbackEffects();
		effects.accept(failed, 0, timing);
		const first = effects.readFrames(10, 3, point)[0];
		effects.accept(failed, 15, timing);
		const repeated = effects.readFrames(20, 3, point);
		expect(repeated).toHaveLength(1);
		expect(repeated[0].revision).not.toBe(first.revision);
		expect(repeated[0].elapsedMs).toBe(5);
		effects.accept({ ...failed, outcome: "unlocked" }, 25, timing);
		expect(effects.readFrames(30, 3, point)).toEqual([
			expect.objectContaining({
				target: 7,
				outcome: "unlocked",
				lifetimeMs: timing.successLifetimeMs,
			}),
		]);
	});
	it("keeps independent targets and expires hidden effects without replay", () => {
		const effects = new ClientLockFeedbackEffects();
		effects.accept(failed, 0, timing);
		effects.accept({ ...failed, target: 8, outcome: "unlocked" }, 0, timing);
		expect(effects.readFrames(10, 3, () => null)).toEqual([]);
		expect(
			effects
				.readFrames(timing.failureLifetimeMs, 3, point)
				.map((frame) => frame.target),
		).toEqual([8]);
		expect(effects.readFrames(timing.successLifetimeMs, 3, point)).toEqual([]);
	});
	it("retires only the removed target incarnation", () => {
		const effects = new ClientLockFeedbackEffects();
		effects.accept(failed, 0, timing);
		effects.remove(failed.target, failed.generation + 1);
		expect(effects.readFrames(1, failed.worldGeneration, point)).toHaveLength(
			1,
		);
		effects.remove(failed.target, failed.generation);
		expect(effects.readFrames(2, failed.worldGeneration, point)).toEqual([]);
	});
	it("drops old worlds and explicit resets", () => {
		const effects = new ClientLockFeedbackEffects();
		effects.accept(failed, 0, timing);
		expect(effects.readFrames(1, 4, point)).toEqual([]);
		expect(effects.readFrames(2, 3, point)).toEqual([]);
		effects.accept(failed, 3, timing);
		effects.clear();
		expect(effects.readFrames(4, 3, point)).toEqual([]);
	});
});
