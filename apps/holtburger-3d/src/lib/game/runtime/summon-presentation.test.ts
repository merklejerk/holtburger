import { describe, expect, it } from "vitest";
import {
	summonOpacityAt,
	type SummonFlickerTuning,
} from "./summon-presentation";
import { createSummonChainLink } from "../renderer/summon-chain-geometry";

const FLICKER: SummonFlickerTuning = {
	leadInSeconds: 4,
	initialHertz: 1,
	finalHertz: 5,
	dutyCycle: 0.5,
};

describe("summon expiry presentation", () => {
	it("leaves undisclosed lifetimes and pre-window models unchanged", () => {
		expect(summonOpacityAt(1000, null, FLICKER)).toBe(1);
		expect(summonOpacityAt(95, 100, FLICKER)).toBe(1);
		expect(summonOpacityAt(96, 100, FLICKER)).toBe(1);
	});

	it("hard-flickers with increasing frequency and continues after estimated expiration", () => {
		const countTransitions = (start: number, end: number) => {
			let previous = summonOpacityAt(start, 100, FLICKER);
			let transitions = 0;
			for (let time = start + 0.005; time < end; time += 0.005) {
				const opacity = summonOpacityAt(time, 100, FLICKER);
				if (opacity !== previous) transitions++;
				previous = opacity;
			}
			return transitions;
		};
		expect(countTransitions(99, 100)).toBeGreaterThan(countTransitions(96, 97));
		expect(countTransitions(101, 102)).toBeGreaterThan(0);
		const fractionalPhase = { ...FLICKER, finalHertz: 4.6 };
		expect(summonOpacityAt(100 - 1e-8, 100, fractionalPhase)).toBe(
			summonOpacityAt(100 + 1e-8, 100, fractionalPhase),
		);
	});

	it("generates finite three-dimensional closed tubular link triangles", () => {
		const vertices = createSummonChainLink();
		expect(vertices.length % 9).toBe(0);
		expect(vertices.every(Number.isFinite)).toBe(true);
		const zs = vertices.filter((_, index) => index % 3 === 2);
		expect(Math.min(...zs)).toBeLessThan(0);
		expect(Math.max(...zs)).toBeGreaterThan(0);
	});
});
