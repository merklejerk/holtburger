import { describe, expect, it } from "vitest";
import { createPerspectiveMat4, createTranslationMat4 } from "../math/matrices";
import { AABB3, Mat4, Vec3 } from "../math/types";
import type { StaticInstanceStreamData } from "../systems/static-resources";
import {
	classifyGeneratedInstanceEnvelope,
	GeneratedInstanceSelector,
} from "./generated-instance-selection";

const UNIT_ENVELOPE = new AABB3(
	new Vec3(-0.5, -0.5, -0.5),
	new Vec3(0.5, 0.5, 0.5),
);

describe("classifyGeneratedInstanceEnvelope", () => {
	it("retains large and threshold-equal visible envelopes", () => {
		const input = projectionInput({ minimumPixelArea: 2_500 });

		expect(classifyGeneratedInstanceEnvelope(input)).toBe("visible");
		expect(
			classifyGeneratedInstanceEnvelope({
				...input,
				minimumPixelArea: 2_501,
			}),
		).toBe("below-threshold");
	});

	it("separates proven outside envelopes from near-plane ambiguity", () => {
		expect(
			classifyGeneratedInstanceEnvelope(
				projectionInput({
					sourceToLandblock: createTranslationMat4(new Vec3(3, 0, 0)),
				}),
			),
		).toBe("outside-view");
		expect(
			classifyGeneratedInstanceEnvelope(
				projectionInput({
					clipFromAnchor: createPerspectiveMat4(90, 1, 1, 100),
					sourceToLandblock: createTranslationMat4(new Vec3(0, 0, -0.5)),
				}),
			),
		).toBe("near-plane-or-ambiguous");
	});

	it("keeps non-finite projections conservatively", () => {
		const invalid = Mat4.identity();
		invalid.m11 = Number.NaN;
		expect(
			classifyGeneratedInstanceEnvelope(
				projectionInput({ clipFromAnchor: invalid }),
			),
		).toBe("near-plane-or-ambiguous");
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
	overrides: Partial<
		Parameters<typeof classifyGeneratedInstanceEnvelope>[0]
	> = {},
): Parameters<typeof classifyGeneratedInstanceEnvelope>[0] {
	return {
		clipFromAnchor: Mat4.identity(),
		landblockOffsetX: 0,
		landblockOffsetY: 0,
		landblockOffsetZ: 0,
		minimumPixelArea: 1,
		sourceEnvelope: UNIT_ENVELOPE,
		sourceToLandblock: Mat4.identity(),
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
