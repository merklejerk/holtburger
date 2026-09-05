import { Vec3 } from "../math/types";
import { describe, expect, it, vi } from "vitest";
import type { DynamicLayout } from "../geometry/dynamic-layout";
import { createObjectGeometryKey } from "../geometry/types";
import type { DynamicAppearance } from "../systems/dynamic-appearance";
import { TextureWrapMode } from "../textures/types";
import { WebGL2DynamicAppearances } from "./webgl2-dynamic-appearances";
import { DYNAMIC_MATERIAL_TEXELS } from "./dynamic-material-table";
import type { PreparedObjectSurface } from "./object-rendering-policy";

const layout: DynamicLayout = {
	key: createObjectGeometryKey("dynamic-layout:fixture"),
	geometry: {
		kind: "dynamic-parts",
		partCount: 1,
		materialCount: 1,
		positions: new Float32Array(9),
		normals: new Float32Array(9),
		textureCoordinates: new Float32Array(6),
		indices: new Uint32Array([0, 1, 2]),
		partSelectors: new Uint32Array(3),
		materialSelectors: new Uint32Array(3),
	},
	parts: [{ partIndex: 0, indexStart: 0, indexCount: 3 }],
};

function appearance(): DynamicAppearance {
	return {
		materials: [
			{
				source: {
					id: "material:fixture",
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
		ranges: [
			{
				transparentSort: { key: "fixture-order", center: Vec3.zero() },
				partSelector: 0,
				materialSelector: 0,
				indexStart: 0,
				indexCount: 3,
				ordering: "opaque",
				polygon: { cullFace: "back", stippled: false },
				retailVisibility: "normally-visible",
			},
		],
	};
}

function setup() {
	let next = 0;
	const gl = {
		TEXTURE0: 0x84c0,
		TEXTURE_2D: 0x0de1,
		TEXTURE_MIN_FILTER: 0x2801,
		TEXTURE_MAG_FILTER: 0x2800,
		TEXTURE_WRAP_S: 0x2802,
		TEXTURE_WRAP_T: 0x2803,
		NEAREST: 0x2600,
		CLAMP_TO_EDGE: 0x812f,
		RGBA32F: 0x8814,
		RGBA: 0x1908,
		FLOAT: 0x1406,
		ELEMENT_ARRAY_BUFFER: 0x8893,
		STATIC_DRAW: 0x88e4,
		createTexture: vi.fn(
			(): WebGLTexture | null => ({ id: next++ }) as WebGLTexture,
		),
		createBuffer: vi.fn(
			(): WebGLBuffer | null => ({ id: next++ }) as WebGLBuffer,
		),
		deleteTexture: vi.fn(),
		deleteBuffer: vi.fn(),
		activeTexture: vi.fn(),
		bindTexture: vi.fn(),
		texParameteri: vi.fn(),
		texImage2D: vi.fn(),
		bindVertexArray: vi.fn(),
		bindBuffer: vi.fn(),
		bufferData: vi.fn(),
	};
	const prepare = vi.fn(
		(): PreparedObjectSurface<WebGLTexture, WebGLSampler> => ({
			material: { kind: "solid-color", color: [1, 1, 1, 1] },
			alphaTest: 0,
			luminosity: 0,
			palettedClipMap: false,
			wrapRepeat: false,
		}),
	);
	return {
		gl,
		prepare,
		resources: new WebGL2DynamicAppearances(
			gl as unknown as WebGL2RenderingContext,
			prepare,
		),
	};
}

describe("template-retained dynamic appearance resources", () => {
	it("shares table and index allocation until the last explicit release", () => {
		const { gl, resources } = setup();
		const visual = appearance();
		const first = resources.retain(layout, visual);
		const second = resources.retain(layout, visual);
		const expectedBytes = {
			indexBytes: layout.geometry.indices.byteLength,
			materialBytes:
				visual.materials.length *
				DYNAMIC_MATERIAL_TEXELS *
				4 *
				Float32Array.BYTES_PER_ELEMENT,
		};
		expect(resources.getResourceUsage()).toEqual(expectedBytes);
		expect(gl.createTexture).toHaveBeenCalledTimes(1);
		expect(gl.createBuffer).toHaveBeenCalledTimes(1);
		first();
		expect(resources.getResourceUsage()).toEqual(expectedBytes);
		expect(gl.deleteTexture).not.toHaveBeenCalled();
		expect(resources.get(visual).kind).toBe("drawable");
		second();
		second();
		expect(gl.deleteTexture).toHaveBeenCalledTimes(1);
		expect(gl.deleteBuffer).toHaveBeenCalledTimes(1);
		expect(() => resources.get(visual)).toThrow("not retained");
		expect(resources.getResourceUsage()).toEqual({
			indexBytes: 0,
			materialBytes: 0,
		});
	});
	it("keeps every old generation when rebuilding a later appearance fails", () => {
		const { gl, resources, prepare } = setup();
		const a = appearance(),
			b = appearance();
		resources.retain(layout, a);
		resources.retain(layout, b);
		const beforeA = resources.get(a),
			beforeB = resources.get(b);
		prepare.mockImplementationOnce(() => ({
			material: { kind: "solid-color", color: [0, 1, 0, 1] },
			alphaTest: 0,
			luminosity: 0,
			palettedClipMap: false,
			wrapRepeat: false,
		}));
		prepare.mockImplementationOnce(() => {
			throw new Error("atlas lookup failed");
		});
		expect(() => resources.rebuild()).toThrow("atlas lookup failed");
		expect(resources.get(a)).toBe(beforeA);
		expect(resources.get(b)).toBe(beforeB);
		expect(gl.deleteTexture).toHaveBeenCalledTimes(1);
		resources.rebuild();
		expect(resources.get(a)).not.toBe(beforeA);
		expect(resources.get(b)).not.toBe(beforeB);
		resources.destroy();
		expect(gl.deleteTexture).toHaveBeenCalledTimes(5);
	});
	it("rebuilds table coordinates and physical bindings without modifying source indices", () => {
		const { gl, resources, prepare } = setup();
		const visual = appearance();
		resources.retain(layout, visual);
		const texture = {} as WebGLTexture,
			sampler = {} as WebGLSampler;
		prepare.mockReturnValue({
			material: {
				kind: "direct-color",
				color: [1, 1, 1, 1],
				base: { texture, sampler, rect: [8, 4, 16, 16] },
			},
			alphaTest: 0,
			luminosity: 0,
			palettedClipMap: false,
			wrapRepeat: false,
		});
		resources.rebuild();
		const current = resources.get(visual);
		if (current.kind !== "drawable")
			throw new Error("Fixture requires geometry.");
		expect(current.plan.batches[0]?.material).toMatchObject({
			base: { texture, sampler },
		});
		const data = gl.texImage2D.mock.lastCall?.[8] as Float32Array;
		expect([...data.slice(4, 8)]).toEqual([8, 4, 16, 16]);
		expect([...layout.geometry.indices]).toEqual([0, 1, 2]);
		expect(gl.bindVertexArray).toHaveBeenCalledWith(null);
		resources.destroy();
	});
	it("rolls back partial allocation and does not retain a failed appearance", () => {
		const { gl, resources } = setup();
		const visual = appearance();
		gl.createBuffer.mockReturnValueOnce(null);
		expect(() => resources.retain(layout, visual)).toThrow(
			"Failed to allocate",
		);
		expect(gl.deleteTexture).toHaveBeenCalledTimes(1);
		expect(() => resources.get(visual)).toThrow("not retained");
	});
	it("does not allocate zero-height tables for empty visuals or double-release after shutdown", () => {
		const { gl, resources } = setup();
		const empty: DynamicAppearance = { materials: [], ranges: [] };
		const releaseEmpty = resources.retain(layout, empty);
		expect(resources.get(empty)).toEqual({ kind: "empty" });
		expect(gl.createTexture).not.toHaveBeenCalled();
		const release = resources.retain(layout, appearance());
		resources.destroy();
		release();
		releaseEmpty();
		expect(gl.deleteTexture).toHaveBeenCalledTimes(1);
	});
});
