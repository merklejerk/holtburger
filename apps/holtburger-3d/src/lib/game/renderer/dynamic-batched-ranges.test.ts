import { describe, expect, it } from "vitest";
import { Mat4, Vec3 } from "../math/types";
import type { DynamicAppearance } from "../systems/dynamic-appearance";
import { TextureWrapMode } from "../textures/types";
import { compileDynamicIndexBatches } from "./dynamic-index-batches";
import { DynamicBatchedRanges } from "./dynamic-batched-ranges";

function fixture(additive = false) {
	const appearance: DynamicAppearance = {
		materials: [
			{
				source: {
					id: "material:opaque-test",
					kind: "solid-color",
					color: [1, 1, 1, 1],
					rawSurfaceFlags: additive ? 0x10100 : 0,
					translucency: 0,
					luminosity: 0,
					diffuseScale: 1,
				},
				detailRole: null,
				textures: { base: null, palette: null },
				sampler: { wrap: TextureWrapMode.Clamp },
				palettedClipMap: false,
			},
		],
		ranges: (
			[
				"opaque",
				"opaque",
				"opaque",
				"alpha-test",
				"transparent",
				"additive",
			] as const
		).map((ordering, partSelector) => ({
			transparentSort: { key: "fixture-order", center: Vec3.zero() },
			partSelector,
			materialSelector: 0,
			indexStart: partSelector * 3,
			indexCount: 3,
			ordering: additive ? "additive" : ordering,
			polygon: { cullFace: "back", stippled: false },
			retailVisibility:
				partSelector === 2 ? "degrade-hidden" : "normally-visible",
		})),
	};
	const plan = compileDynamicIndexBatches<WebGLTexture, WebGLSampler>(
		new Uint32Array(18),
		appearance,
		[
			{
				material: { kind: "solid-color", color: [1, 1, 1, 1] },
				alphaTest: 0,
				luminosity: 0,
				palettedClipMap: false,
				wrapRepeat: false,
			},
		],
	);
	const parts = appearance.ranges.map(() => ({
		frameInstance: {
			color: { a: 1, r: 1, g: 1, b: 1 },
			sourceToLandblock: Mat4.identity(),
		},
	}));
	return {
		plan,
		parts,
		cache: new DynamicBatchedRanges(additive ? "additive" : "opaque"),
	};
}

describe("DynamicBatchedRanges", () => {
	it("retains partial additive fades, splits hidden parts, and reselects an appearance replacement", () => {
		const { cache, plan, parts } = fixture(true);
		parts[0].frameInstance.color.a = 0.25;
		parts[1].frameInstance.color.a = 0;
		const selected = cache.prepare("scene-node:1", plan, parts, false);
		expect(selected.map((span) => span.indexCount)).toEqual([3, 9]);
		cache.beginFrame();
		parts[1].frameInstance.color.a = 0.5;
		expect(
			cache
				.prepare("scene-node:1", plan, parts, true)
				.map((span) => span.indexCount),
		).toEqual([15, 3]);
		cache.beginFrame();
		const replacement = fixture();
		expect(
			cache.prepare("scene-node:1", replacement.plan, replacement.parts, true),
		).toEqual([{ rangeIndex: 5, indexCount: 3 }]);
	});
	it("keeps separately prepared roots independent until the frame ends", () => {
		const { cache, plan, parts } = fixture();
		const first = cache.prepare("scene-node:1", plan, parts, false);
		const otherParts = parts.map((part) => ({
			frameInstance: {
				...part.frameInstance,
				color: { ...part.frameInstance.color, a: 0 },
			},
		}));
		otherParts[3].frameInstance.color.a = 0.4;
		expect(cache.prepare("scene-node:2", plan, otherParts, false)).toEqual([
			{ rangeIndex: 3, indexCount: 3 },
		]);
		expect(first).toEqual([
			{ rangeIndex: 0, indexCount: 6 },
			{ rangeIndex: 3, indexCount: 3 },
		]);
	});

	it("coalesces physical opaque neighbors while retaining alpha-test and excluding ordered residue", () => {
		const { cache, plan, parts } = fixture();
		expect(cache.prepare("scene-node:1", plan, parts, false)).toEqual([
			{ rangeIndex: 0, indexCount: 6 },
			{ rangeIndex: 3, indexCount: 3 },
		]);
	});

	it("splits around partial opaque fades but retains partially faded alpha-test", () => {
		const { cache, plan, parts } = fixture();
		parts[1].frameInstance.color.a = 0.4;
		parts[3].frameInstance.color.a = 0.4;
		expect(cache.prepare("scene-node:1", plan, parts, true)).toEqual([
			{ rangeIndex: 0, indexCount: 3 },
			{ rangeIndex: 2, indexCount: 3 },
			{ rangeIndex: 3, indexCount: 3 },
		]);
	});

	it("shares coherent frame results and reuses spans after resetting without retaining hidden draws", () => {
		const { cache, plan, parts } = fixture();
		const first = cache.prepare("scene-node:1", plan, parts, true);
		const span = first[0];
		expect(cache.prepare("scene-node:1", plan, parts, true)).toBe(first);
		cache.beginFrame();
		for (const part of parts) part.frameInstance.color.a = 0;
		expect(cache.prepare("scene-node:1", plan, parts, true)).toEqual([]);
		cache.beginFrame();
		parts[0].frameInstance.color.a = 1;
		const restored = cache.prepare("scene-node:1", plan, parts, true);
		expect(restored[0]).toBe(span);
		expect(restored).toEqual([{ rangeIndex: 0, indexCount: 3 }]);
	});
});
