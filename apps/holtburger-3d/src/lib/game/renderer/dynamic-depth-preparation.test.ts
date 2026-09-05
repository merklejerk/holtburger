import { describe, expect, it, vi } from "vitest";
import { Mat4, Vec3 } from "../math/types";
import { createObjectGeometryKey } from "../geometry/types";
import type { SceneNodeId } from "../scene";
import type { DynamicAppearance } from "../systems/dynamic-appearance";
import { TextureWrapMode } from "../textures/types";
import { compileDynamicIndexBatches } from "./dynamic-index-batches";
import { DynamicDepthPreparations } from "./dynamic-depth-preparation";

const NODE_ID = "scene-node:selection-test" as SceneNodeId;

function fixture() {
	const appearance: DynamicAppearance = {
		materials: [
			{
				source: {
					id: "material:test",
					kind: "solid-color",
					color: [1, 1, 1, 1],
					rawSurfaceFlags: 0,
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
		ranges: [0, 1, 2, 3].map((partSelector) => ({
			transparentSort: { key: "fixture-order", center: Vec3.zero() },
			partSelector,
			materialSelector: 0,
			indexStart: partSelector * 3,
			indexCount: 3,
			ordering: "opaque",
			polygon: {
				cullFace: partSelector === 3 ? "front" : "back",
				stippled: false,
			},
			retailVisibility:
				partSelector === 2 ? "degrade-hidden" : "normally-visible",
		})),
	};
	const plan = compileDynamicIndexBatches<WebGLTexture, WebGLSampler>(
		new Uint32Array(12),
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
	const parts = [1, 0.4, 1, 1].map((a) => ({
		frameInstance: {
			color: { a, r: 1, g: 1, b: 1 },
			sourceToLandblock: Mat4.identity(),
		},
	}));
	const visible = {
		landblockId: "0x0000ffff" as const,
		renderScopes: [{ kind: "outdoor" as const }],
		visual: {
			layout: { key: createObjectGeometryKey("selection-test") },
			appearance,
			parts,
		},
	};
	const read = vi.fn(() => visible);
	const pass = new DynamicDepthPreparations(read, () => ({
		kind: "drawable",
		table: {} as WebGLTexture,
		indexBuffer: {} as WebGLBuffer,
		plan,
	}));
	return { pass, read, parts };
}

describe("DynamicDepthPreparations", () => {
	it("coalesces physical spans while preserving culling, retail visibility, and partial fades", () => {
		const { pass, read } = fixture();
		const selected = pass.prepare(NODE_ID, false);
		if (selected === null) throw new Error("Fixture requires rigid selection.");
		expect(selected.ranges).toEqual([
			{ indexStart: 0, indexCount: 6, cullFace: "back" },
			{ indexStart: 9, indexCount: 3, cullFace: "front" },
		]);
		expect(selected.selectedPartCount).toBe(3);
		expect(selected.selectedTriangleCount).toBe(3);
		expect(pass.prepare(NODE_ID, false)).toBe(selected);
		expect(read).toHaveBeenCalledTimes(1);
		const records = selected.ranges;
		const span = records[0];
		pass.beginFrame();
		expect(records).toHaveLength(0);
		const debug = pass.prepare(NODE_ID, true);
		if (debug === null) throw new Error("Fixture requires rigid selection.");
		expect(debug.ranges).toBe(records);
		expect(debug.ranges[0]).toBe(span);
		expect(debug.ranges).toEqual([
			{ indexStart: 0, indexCount: 9, cullFace: "back" },
			{ indexStart: 9, indexCount: 3, cullFace: "front" },
		]);
		expect(debug.selectedPartCount).toBe(4);
		pass.beginFrame();
	});
	it("does not merge across a fully hidden part and excludes it from exact work", () => {
		const { pass, parts } = fixture();
		const faded = parts[1];
		if (faded === undefined) throw new Error("Fixture requires a faded part.");
		faded.frameInstance.color.a = 0;
		const selected = pass.prepare(NODE_ID, true);
		if (selected === null) throw new Error("Fixture requires rigid selection.");
		expect(
			selected.ranges.map(({ indexStart, indexCount }) => [
				indexStart,
				indexCount,
			]),
		).toEqual([
			[0, 3],
			[6, 3],
			[9, 3],
		]);
		expect(selected.selectedPartCount).toBe(3);
		expect(selected.selectedTriangleCount).toBe(3);
		pass.beginFrame();
	});
	it("retires prior frame references and caches hidden roots without reading appearance resources", () => {
		const read = vi.fn(() => null);
		const pass = new DynamicDepthPreparations(read, () => {
			throw new Error("Hidden root has no appearance.");
		});
		expect(pass.prepare(NODE_ID, false)).toBeNull();
		expect(pass.prepare(NODE_ID, false)).toBeNull();
		expect(read).toHaveBeenCalledTimes(1);
		pass.beginFrame();
		expect(pass.prepare(NODE_ID, false)).toBeNull();
		expect(read).toHaveBeenCalledTimes(2);
	});
	it("retains independent root spans until frame reset", () => {
		const { pass, parts } = fixture();
		const first = pass.prepare(NODE_ID, true);
		if (first === null) throw new Error("Fixture requires depth geometry.");
		const saved = first.ranges.map((range) => ({ ...range }));
		for (const part of parts) part.frameInstance.color.a = 0;
		expect(pass.prepare("scene-node:other" as SceneNodeId, true)).toBeNull();
		expect(first.ranges).toEqual(saved);
		pass.beginFrame();
		expect(first.ranges).toHaveLength(0);
	});
});
