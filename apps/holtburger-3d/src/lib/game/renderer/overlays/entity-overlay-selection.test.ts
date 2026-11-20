import { describe, expect, it } from "vitest";

import { Mat4, Vec3 } from "../../math/types";
import type { EntityOverlayPriority } from "./entity-overlay-policy";
import {
	isOverlayAnchorInFrustum,
	maximumLegibleOverlayDepth,
	retainLegibleOverlays,
	retainOverlayBudget,
} from "./entity-overlay-selection";

/** W equals the anchor's z coordinate, so tests choose depths directly. */
function depthClip(): Mat4 {
	const clip = Mat4.zero();
	clip.m34 = 1;
	return clip;
}

function ranked(
	identity: string,
	distanceSquared: number,
	priority: EntityOverlayPriority = "ambient",
) {
	return { distanceSquared, identity, priority };
}

describe("entity overlay selection", () => {
	it("clips portal-bypass overlay anchors strictly against the forward frustum", () => {
		// Identity x/y with w = z puts NDC at (x / z, y / z).
		const clip = Mat4.identity();
		clip.m34 = 1;
		clip.m44 = 0;
		expect(isOverlayAnchorInFrustum(new Vec3(0, 0, 5), clip)).toBe(true);
		expect(isOverlayAnchorInFrustum(new Vec3(5, -5, 5), clip)).toBe(true);
		expect(isOverlayAnchorInFrustum(new Vec3(5.1, 0, 5), clip)).toBe(false);
		expect(isOverlayAnchorInFrustum(new Vec3(0, -5.1, 5), clip)).toBe(false);
		expect(isOverlayAnchorInFrustum(new Vec3(0, 0, 0), clip)).toBe(false);
		expect(isOverlayAnchorInFrustum(new Vec3(0, 0, -5), clip)).toBe(false);
	});

	it("derives the perspective depth where authored pixels reach the threshold", () => {
		expect(maximumLegibleOverlayDepth(4, 48, 4)).toBe(48);
		expect(maximumLegibleOverlayDepth(2, 10, 5)).toBe(4);
	});

	it("applies the legibility depth and rejects anchors behind the camera", () => {
		const maximumDepth = 10;
		const candidates = [
			{
				anchor: new Vec3(0, 0, maximumDepth),
				identity: "threshold",
				priority: "ambient" as const,
			},
			{
				anchor: new Vec3(0, 0, maximumDepth + 0.01),
				identity: "tiny",
				priority: "ambient" as const,
			},
			{
				anchor: new Vec3(0, 0, -1),
				identity: "behind",
				priority: "focus" as const,
			},
		];
		retainLegibleOverlays(candidates, depthClip(), maximumDepth, true);
		expect(candidates.map(({ identity }) => identity)).toEqual(["threshold"]);
	});

	it("lets focus and alert bypass legibility only when the component policy allows it", () => {
		const make = () => [
			{
				anchor: new Vec3(0, 0, 30),
				identity: "focus",
				priority: "focus" as const,
			},
			{
				anchor: new Vec3(0, 0, 30),
				identity: "alert",
				priority: "alert" as const,
			},
		];
		const labels = make();
		retainLegibleOverlays(labels, depthClip(), 10, true);
		expect(labels.map(({ identity }) => identity)).toEqual(["focus", "alert"]);
		const bars = make();
		retainLegibleOverlays(bars, depthClip(), 10, false);
		expect(bars).toHaveLength(0);
	});

	it("retains nearest ordinary candidates in deterministic back-to-front order", () => {
		const candidates = [
			ranked("too-far", 9),
			ranked("d", 4),
			ranked("b", 1),
			ranked("a", 1),
		];
		retainOverlayBudget(candidates, 3);
		expect(candidates.map(({ identity }) => identity)).toEqual(["d", "b", "a"]);
	});

	it("accepts zero as a complete ordinary cutoff while focus survives", () => {
		const candidates = [ranked("a", 1), ranked("selected", 100, "focus")];
		retainOverlayBudget(candidates, 0);
		expect(candidates.map(({ identity }) => identity)).toEqual(["selected"]);
	});

	it("admits focus outside the ordinary budget, then alerts before nearer ambient", () => {
		const candidates = [
			ranked("near-ambient", 1),
			ranked("far-alert", 16, "alert"),
			ranked("middle-ambient", 4),
			ranked("selected", 25, "focus"),
		];
		retainOverlayBudget(candidates, 2);
		expect(candidates.map(({ identity }) => identity)).toEqual([
			"selected",
			"far-alert",
			"near-ambient",
		]);
	});

	it("rejects malformed budgets", () => {
		expect(() => retainOverlayBudget([], -1)).toThrow("budget");
		expect(() => retainOverlayBudget([], 1.5)).toThrow("budget");
	});
});
