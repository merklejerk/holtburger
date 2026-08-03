import { describe, expect, it } from "vitest";
import { createPerspectiveMat4, createTranslationMat4 } from "../math/matrices";
import { AABB3, Mat4, Vec3 } from "../math/types";
import type { StaticInstanceStreamData } from "../systems/static-resources";
import { GeneratedInstanceSelector } from "./generated-instance-selection";
import {
	classifyObjectFootprint,
	retainsProjectedObjectFootprint,
} from "./object-footprint";

const UNIT_ENVELOPE = new AABB3(
	new Vec3(-0.5, -0.5, -0.5),
	new Vec3(0.5, 0.5, 0.5),
);

describe("classifyObjectFootprint", () => {
	it("retains large and threshold-equal visible envelopes", () => {
		const input = projectionInput({ minimumPixelArea: 2_500 });

		expect(classifyObjectFootprint(input)).toBe("visible");
		expect(
			classifyObjectFootprint({
				...input,
				minimumPixelArea: 2_501,
			}),
		).toBe("below-threshold");
	});

	it("separates proven outside envelopes from near-plane ambiguity", () => {
		expect(
			classifyObjectFootprint(
				projectionInput({
					localToLandblock: createTranslationMat4(new Vec3(3, 0, 0)),
				}),
			),
		).toBe("outside-view");
		expect(
			classifyObjectFootprint(
				projectionInput({
					clipFromAnchor: createPerspectiveMat4(90, 1, 1, 100),
					localToLandblock: createTranslationMat4(new Vec3(0, 0, -0.5)),
				}),
			),
		).toBe("near-plane-or-ambiguous");
	});

	it("keeps non-finite projections conservatively", () => {
		const invalid = Mat4.identity();
		invalid.m11 = Number.NaN;
		expect(
			classifyObjectFootprint(projectionInput({ clipFromAnchor: invalid })),
		).toBe("near-plane-or-ambiguous");
	});

	it("preserves exact zero-disabled and explicitly exempt behavior", () => {
		const invalidEnvelope = projectionInput({
			viewportWidth: 0,
		});
		expect(retainsProjectedObjectFootprint(invalidEnvelope, 0)).toBe(true);
		expect(retainsProjectedObjectFootprint(null, 64)).toBe(true);
		expect(() => retainsProjectedObjectFootprint(null, -1)).toThrow(
			"pixel area is invalid",
		);
	});
});

describe("GeneratedInstanceSelector", () => {
	it("computes one selection per stream and reuses its index storage", () => {
		let classificationCount = 0;
		const selector = new GeneratedInstanceSelector(() => {
			classificationCount += 1;
			return classificationCount === 2 ? "below-threshold" : "visible";
		});
		const stream = instanceStream(3);
		selector.beginView(Mat4.identity(), 100, 100, 1);

		const first = selector.select(stream, 0, 0, 0);
		const sharedPartition = selector.select(stream, 0, 0, 0);

		expect(first).toEqual([0, 2]);
		expect(sharedPartition).toBe(first);
		expect(classificationCount).toBe(3);
		expect(selector.testedCount).toBe(3);
		expect(selector.retainedCount).toBe(2);
		expect(selector.rejectedCount).toBe(1);

		selector.beginView(Mat4.identity(), 100, 100, 1);
		const sequentialView = selector.select(stream, 0, 0, 0);
		expect(sequentialView).toBe(first);
		expect(classificationCount).toBe(6);
		expect(selector.testedCount).toBe(3);
	});

	it("preserves the complete ordered upload population at a zero threshold", () => {
		let classificationCount = 0;
		const selector = new GeneratedInstanceSelector(() => {
			classificationCount += 1;
			return "outside-view";
		});
		const stream = instanceStream(3);
		selector.beginView(Mat4.identity(), 100, 100, 0);

		expect(selector.select(stream, 0, 0, 0)).toEqual([0, 1, 2]);
		expect(classificationCount).toBe(0);
		expect(selector.testedCount).toBe(0);
		expect(selector.retainedCount).toBe(0);
		expect(selector.rejectedCount).toBe(0);
	});

	it("rejects reusing one immutable stream across landblock render frames", () => {
		const selector = new GeneratedInstanceSelector(() => "visible");
		const stream = instanceStream(1);
		selector.beginView(Mat4.identity(), 100, 100, 1);
		selector.select(stream, 0, 0, 0);

		expect(() => selector.select(stream, 192, 0, 0)).toThrow(
			"crossed landblock render frames",
		);
	});
});

function projectionInput(
	overrides: Partial<Parameters<typeof classifyObjectFootprint>[0]> = {},
): Parameters<typeof classifyObjectFootprint>[0] {
	return {
		bounds: UNIT_ENVELOPE,
		clipFromAnchor: Mat4.identity(),
		landblockOffsetX: 0,
		landblockOffsetY: 0,
		landblockOffsetZ: 0,
		minimumPixelArea: 1,
		localToLandblock: Mat4.identity(),
		viewportHeight: 100,
		viewportWidth: 100,
		...overrides,
	};
}

function instanceStream(count: number): StaticInstanceStreamData {
	return {
		instances: Array.from({ length: count }, () => ({
			color: { a: 1, b: 1, g: 1, r: 1 },
			sourceToLandblock: Mat4.identity(),
		})),
		sourceEnvelope: UNIT_ENVELOPE,
	};
}
