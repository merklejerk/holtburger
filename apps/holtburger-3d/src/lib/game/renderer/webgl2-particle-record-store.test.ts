import { describe, expect, it, vi } from "vitest";
import {
	PARTICLE_RECORD_TEXELS,
	PARTICLE_RECORDS_PER_ROW,
} from "./particle-instance-stream";
import { WebGL2ParticleRecordStore } from "./webgl2-particle-record-store";

const FLOATS_PER_ROW = PARTICLE_RECORDS_PER_ROW * PARTICLE_RECORD_TEXELS * 4;

function fakeGl() {
	const calls = {
		texImage2D: vi.fn(),
		texSubImage2D: vi.fn(),
	};
	const gl = {
		CLAMP_TO_EDGE: 1,
		FLOAT: 2,
		NEAREST: 3,
		RGBA: 4,
		RGBA32F: 5,
		TEXTURE_2D: 6,
		TEXTURE_MAG_FILTER: 7,
		TEXTURE_MIN_FILTER: 8,
		TEXTURE_WRAP_S: 9,
		TEXTURE_WRAP_T: 10,
		bindTexture: () => undefined,
		createTexture: () => ({}) as WebGLTexture,
		deleteTexture: () => undefined,
		texImage2D: calls.texImage2D,
		texParameteri: () => undefined,
		texSubImage2D: calls.texSubImage2D,
	} as unknown as WebGL2RenderingContext;
	return { calls, gl };
}

function store() {
	const { calls, gl } = fakeGl();
	return {
		calls,
		store: new WebGL2ParticleRecordStore(gl, PARTICLE_RECORDS_PER_ROW),
	};
}

describe("WebGL2ParticleRecordStore", () => {
	it("allocates and uploads the whole mirror when it first appears", () => {
		const { calls, store: records } = store();

		records.sync(new Float32Array(FLOATS_PER_ROW * 2), null);

		expect(calls.texImage2D).toHaveBeenCalledTimes(1);
		expect(records.uploadedRowCount).toBe(2);
	});

	// A grown mirror is a different texture, so a dirty range describing the old one must not be
	// trusted to bound the upload.
	it("uploads every row when the mirror grows, ignoring the dirty range", () => {
		const { calls, store: records } = store();
		records.sync(new Float32Array(FLOATS_PER_ROW), null);

		records.sync(new Float32Array(FLOATS_PER_ROW * 3), { first: 0, last: 0 });

		expect(calls.texImage2D).toHaveBeenCalledTimes(2);
		expect(records.uploadedRowCount).toBe(3);
	});

	it("uploads only the rows covering the dirty slots", () => {
		const { calls, store: records } = store();
		const mirror = new Float32Array(FLOATS_PER_ROW * 4);
		records.sync(mirror, null);
		calls.texImage2D.mockClear();

		// Slots inside rows 1 and 2 of a four-row store.
		records.sync(mirror, {
			first: PARTICLE_RECORDS_PER_ROW,
			last: PARTICLE_RECORDS_PER_ROW * 2 + 5,
		});

		expect(calls.texImage2D).not.toHaveBeenCalled();
		expect(calls.texSubImage2D).toHaveBeenCalledTimes(1);
		expect(records.uploadedRowCount).toBe(2);
	});

	it("uploads nothing when no record changed", () => {
		const { calls, store: records } = store();
		const mirror = new Float32Array(FLOATS_PER_ROW);
		records.sync(mirror, null);
		calls.texImage2D.mockClear();

		records.sync(mirror, null);

		expect(calls.texImage2D).not.toHaveBeenCalled();
		expect(calls.texSubImage2D).not.toHaveBeenCalled();
		expect(records.uploadedRowCount).toBe(0);
	});

	it("refuses use after destruction", () => {
		const { store: records } = store();

		records.destroy();

		expect(() => records.sync(new Float32Array(FLOATS_PER_ROW), null)).toThrow(
			/destroyed/,
		);
	});
});
