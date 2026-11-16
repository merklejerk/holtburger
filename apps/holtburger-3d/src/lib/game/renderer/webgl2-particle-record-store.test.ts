import { ParticleRecordSlots } from "../behavior/particle-record-slots";
import { describe, expect, it, vi } from "vitest";
import {
	PARTICLE_RECORD_TEXELS,
	PARTICLE_RECORDS_PER_ROW,
} from "./particle-record-layout";
import { WebGL2ParticleRecordStore } from "./webgl2-particle-record-store";

const FLOATS_PER_ROW = PARTICLE_RECORDS_PER_ROW * PARTICLE_RECORD_TEXELS * 4;

function fakeGl() {
	const calls = {
		getError: vi.fn(() => 0),
		texImage2D: vi.fn(),
		texSubImage2D: vi.fn(),
	};
	const gl = {
		NO_ERROR: 0,
		getError: calls.getError,
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
	it.each([-1, 0, 1])(
		"uploads allocator output around a row boundary (%i)",
		(offset) => {
			const slots = new ParticleRecordSlots();
			const { calls, store: records } = store();
			// Exercise both initial allocation and growth with existing records.
			for (let growth = 0; growth < 2; growth += 1) {
				slots.allocate(PARTICLE_RECORDS_PER_ROW + offset);
				records.sync(slots.data, slots.takeDirtyRows());
				const call = calls.texImage2D.mock.calls.at(-1);
				if (!call) throw new Error("Expected a particle texture allocation.");
				expect(call[8]).toBe(slots.data);
				expect(slots.data.length).toBe(call[3] * call[4] * 4);
			}
		},
	);

	it("rejects incomplete rows before uploading", () => {
		const { calls, store: records } = store();
		expect(() =>
			records.sync(new Float32Array(FLOATS_PER_ROW + 1), null),
		).toThrow("complete texture rows");
		expect(calls.texImage2D).not.toHaveBeenCalled();
	});

	it("retries allocation after a driver rejection without publishing its height", () => {
		const { calls, store: records } = store();
		const mirror = new Float32Array(FLOATS_PER_ROW);
		calls.getError.mockReturnValueOnce(0).mockReturnValueOnce(0x502);
		expect(() => records.sync(mirror, null)).toThrow(
			"After particle record allocation",
		);
		expect(records.uploadedRowCount).toBe(0);
		records.sync(mirror, null);
		expect(calls.texImage2D).toHaveBeenCalledTimes(2);
		expect(calls.texSubImage2D).not.toHaveBeenCalled();
		expect(records.uploadedRowCount).toBe(1);
	});

	it("allocates and uploads the whole mirror when it first appears", () => {
		const { calls, store: records } = store();

		records.sync(new Float32Array(FLOATS_PER_ROW * 2), null);

		expect(calls.texImage2D).toHaveBeenCalledTimes(1);
		expect(records.uploadedRowCount).toBe(2);
	});

	// A grown mirror is a different texture, so dirty bits describing the old one must not be
	// trusted to bound the upload.
	it("uploads every row when the mirror grows, ignoring dirty bits", () => {
		const { calls, store: records } = store();
		records.sync(new Float32Array(FLOATS_PER_ROW), null);

		records.sync(new Float32Array(FLOATS_PER_ROW * 3), new Uint32Array([1]));

		expect(calls.texImage2D).toHaveBeenCalledTimes(2);
		expect(records.uploadedRowCount).toBe(3);
	});

	it("uploads only the rows covering the dirty slots", () => {
		const { calls, store: records } = store();
		const mirror = new Float32Array(FLOATS_PER_ROW * 4);
		records.sync(mirror, null);
		calls.texImage2D.mockClear();

		// Slots inside rows 1 and 2 of a four-row store.
		records.sync(mirror, new Uint32Array([0b110]));

		expect(calls.texImage2D).not.toHaveBeenCalled();
		expect(calls.texSubImage2D).toHaveBeenCalledTimes(1);
		expect(records.uploadedRowCount).toBe(2);
	});

	it("uploads distant dirty rows separately without copying the gap", () => {
		const { calls, store: records } = store();
		const mirror = new Float32Array(FLOATS_PER_ROW * 8);
		records.sync(mirror, null);
		calls.texSubImage2D.mockClear();

		records.sync(mirror, new Uint32Array([(1 << 1) | (1 << 7)]));

		expect(calls.texSubImage2D).toHaveBeenCalledTimes(2);
		expect(
			calls.texSubImage2D.mock.calls.map((call) => [call[3], call[5]]),
		).toEqual([
			[1, 1],
			[7, 1],
		]);
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
