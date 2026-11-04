import { renderVector3, sceneVector3 } from "../../assets/ac-frame";
import { describe, expect, it } from "vitest";
import { audibleRadiusMeters, placeSpatialAudio } from "./audio-spatialization";

const LISTENER = sceneVector3([0, 0, 0]);
const RIGHT = renderVector3([1, 0, 0]);

describe("placeSpatialAudio", () => {
	it("applies no attenuation or panning inside the flat radius", () => {
		// Retail leaves everything within 5 m at full authored volume, centred.
		const placement = placeSpatialAudio(
			sceneVector3([3, 0, 0]),
			LISTENER,
			RIGHT,
			0.8,
			1,
		);

		expect(placement).toEqual({ gain: 0.8, pan: 0 });
	});

	it("centres a sound at the listener's own position rather than dividing by zero", () => {
		expect(placeSpatialAudio(LISTENER, LISTENER, RIGHT, 1, 1)).toEqual({
			gain: 1,
			pan: 0,
		});
	});

	it("falls off as 25 x volume over distance squared beyond the flat radius", () => {
		const placement = placeSpatialAudio(
			sceneVector3([10, 0, 0]),
			LISTENER,
			RIGHT,
			1,
			1,
		);

		expect(placement!.gain).toBeCloseTo(25 / 100);
	});

	it("pans by the source's projection onto the listener's right", () => {
		expect(
			placeSpatialAudio(sceneVector3([10, 0, 0]), LISTENER, RIGHT, 1, 1)!.pan,
		).toBeCloseTo(1);
		expect(
			placeSpatialAudio(sceneVector3([-10, 0, 0]), LISTENER, RIGHT, 1, 1)!.pan,
		).toBeCloseTo(-1);
		// Directly ahead: no lateral component, so centred despite being far away.
		expect(
			placeSpatialAudio(sceneVector3([0, 0, 10]), LISTENER, RIGHT, 1, 1)!.pan,
		).toBeCloseTo(0);
	});

	it("clamps an authored volume above one instead of overdriving the device", () => {
		// 45 shipped candidates author a volume above 1.0, the loudest at 10.0. Retail clamps after
		// attenuation, so the extra volume buys range rather than near-field loudness.
		expect(
			placeSpatialAudio(sceneVector3([1, 0, 0]), LISTENER, RIGHT, 10, 1)!.gain,
		).toBe(1);
		expect(
			placeSpatialAudio(sceneVector3([10, 0, 0]), LISTENER, RIGHT, 10, 1)!.gain,
		).toBe(1);
		// Far enough out that the falloff has taken it back below the ceiling.
		expect(
			placeSpatialAudio(sceneVector3([100, 0, 0]), LISTENER, RIGHT, 10, 1)!
				.gain,
		).toBeCloseTo(0.025);
		// ...and it still carries far past where a volume of 1 would have cut off.
		expect(
			placeSpatialAudio(sceneVector3([200, 0, 0]), LISTENER, RIGHT, 10, 1),
		).not.toBeNull();
		expect(
			placeSpatialAudio(sceneVector3([200, 0, 0]), LISTENER, RIGHT, 1, 1),
		).toBeNull();
	});

	it("refuses to place a sound below retail's audible floor", () => {
		// Well past the ~89 m cutoff at full volume, where retail does not play at all.
		expect(
			placeSpatialAudio(sceneVector3([500, 0, 0]), LISTENER, RIGHT, 1, 1),
		).toBeNull();
	});

	it("refuses a silent source rather than placing an inaudible voice", () => {
		expect(
			placeSpatialAudio(sceneVector3([1, 0, 0]), LISTENER, RIGHT, 0, 1),
		).toBeNull();
	});
});

describe("audibleRadiusMeters", () => {
	it("puts full volume near retail's stated ~89 m cutoff", () => {
		expect(audibleRadiusMeters(1)).toBeGreaterThan(85);
		expect(audibleRadiusMeters(1)).toBeLessThan(95);
	});

	it("never reports less than the flat radius", () => {
		expect(audibleRadiusMeters(0.0001)).toBe(5);
	});

	it("reports nothing audible for a silent source", () => {
		expect(audibleRadiusMeters(0)).toBe(0);
	});
});
