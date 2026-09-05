import { describe, expect, it, vi } from "vitest";
import { Mat4 } from "../math/types";
import {
	DYNAMIC_POSE_TEXELS,
	WebGL2DynamicPosePages,
} from "./webgl2-dynamic-pose-pages";

const PAGE_ROWS = 8;

function parts(count: number) {
	return Array.from({ length: count }, (_, index) => {
		const matrix = Mat4.identity();
		matrix.m11 = 2;
		matrix.m22 = 3;
		matrix.m33 = 4;
		matrix.m41 = index + 10;
		return {
			frameInstance: {
				sourceToLandblock: matrix,
				color: { r: 0.25, g: 0.5, b: 1, a: index === 0 ? 0 : 0.75 },
			},
		};
	});
}

function setup() {
	let next = 0;
	const gl = {
		MAX_TEXTURE_SIZE: 0x0d33,
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
		getParameter: vi.fn(() => PAGE_ROWS),
		createTexture: vi.fn(
			(): WebGLTexture | null => ({ id: next++ }) as WebGLTexture,
		),
		deleteTexture: vi.fn(),
		activeTexture: vi.fn(),
		bindTexture: vi.fn(),
		texParameteri: vi.fn(),
		texStorage2D: vi.fn(),
		texSubImage2D: vi.fn(),
	};
	return {
		gl,
		pages: new WebGL2DynamicPosePages<string>(
			gl as unknown as WebGL2RenderingContext,
		),
	};
}

describe("packed dynamic pose pages", () => {
	it("keeps entities whole across pages, including an exact last-row fit", () => {
		const { gl, pages } = setup();
		pages.upload(
			new Map([
				["a", parts(4)],
				["b", parts(5)],
				["c", parts(3)],
			]),
		);
		expect(pages.get("a").firstRow).toBe(0);
		expect(pages.get("b").firstRow).toBe(0);
		expect(pages.get("c").firstRow).toBe(5);
		expect(pages.get("a").texture).not.toBe(pages.get("b").texture);
		expect(pages.get("b").texture).toBe(pages.get("c").texture);
		expect(gl.texSubImage2D.mock.calls.map((call) => call[5])).toEqual([
			4,
			PAGE_ROWS,
		]);
		expect(gl.texStorage2D).toHaveBeenCalledTimes(2);
		pages.destroy();
		expect(gl.deleteTexture).toHaveBeenCalledTimes(2);
	});
	it("writes column-major nonuniform transforms and zero/full part modifiers", () => {
		const { gl, pages } = setup();
		pages.upload(new Map([["pose", parts(2)]]));
		const data = gl.texSubImage2D.mock.lastCall?.[8] as Float32Array;
		expect([...data.slice(0, 16)]).toEqual([
			2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 10, 0, 0, 1,
		]);
		expect([...data.slice(16, 20)]).toEqual([0.25, 0.5, 1, 0]);
		expect(data[DYNAMIC_POSE_TEXELS * 4 + 12]).toBe(11);
		expect(data[DYNAMIC_POSE_TEXELS * 4 + 19]).toBe(0.75);
	});
	it("reuses allocated storage but uploads only current used rows and removes stale addresses", () => {
		const { gl, pages } = setup();
		pages.upload(
			new Map([
				["a", parts(PAGE_ROWS)],
				["b", parts(1)],
			]),
		);
		const firstPage = pages.get("a").texture;
		const rowBytes = DYNAMIC_POSE_TEXELS * 4 * Float32Array.BYTES_PER_ELEMENT;
		expect(pages.getResourceUsage()).toEqual({
			allocatedBytes: 2 * PAGE_ROWS * rowBytes,
			uploadedBytes: (PAGE_ROWS + 1) * rowBytes,
		});
		gl.texSubImage2D.mockClear();
		pages.upload(new Map([["c", parts(2)]]));
		expect(pages.get("c").texture).toBe(firstPage);
		expect(gl.texStorage2D).toHaveBeenCalledTimes(2);
		expect(gl.texSubImage2D).toHaveBeenCalledTimes(1);
		expect(gl.texSubImage2D.mock.lastCall?.[5]).toBe(2);
		expect(() => pages.get("a")).toThrow("not included in the pose upload");
		expect(pages.getResourceUsage()).toEqual({
			allocatedBytes: 2 * PAGE_ROWS * rowBytes,
			uploadedBytes: 2 * rowBytes,
		});
		pages.upload(new Map());
		expect(pages.getResourceUsage()).toEqual({
			allocatedBytes: 2 * PAGE_ROWS * rowBytes,
			uploadedBytes: 0,
		});
		pages.destroy();
		expect(pages.getResourceUsage()).toEqual({
			allocatedBytes: 0,
			uploadedBytes: 0,
		});
	});
	it("rejects a single oversized entity before allocating a page", () => {
		const { gl, pages } = setup();
		expect(() =>
			pages.upload(new Map([["oversized", parts(PAGE_ROWS + 1)]])),
		).toThrow(
			`requires ${PAGE_ROWS + 1} pose rows; device limit is ${PAGE_ROWS}`,
		);
		expect(gl.createTexture).not.toHaveBeenCalled();
	});
	it("does not allocate or upload for empty selections", () => {
		const { gl, pages } = setup();
		pages.upload(new Map([["empty", []]]));
		expect(gl.createTexture).not.toHaveBeenCalled();
		expect(gl.texSubImage2D).not.toHaveBeenCalled();
		expect(() => pages.get("empty")).toThrow("not included in the pose upload");
	});
	it("propagates page allocation failure without publishing an address", () => {
		const { gl, pages } = setup();
		gl.createTexture.mockReturnValueOnce(null);
		expect(() => pages.upload(new Map([["a", parts(1)]]))).toThrow(
			"Failed to allocate",
		);
		expect(() => pages.get("a")).toThrow("not included in the pose upload");
	});
});
