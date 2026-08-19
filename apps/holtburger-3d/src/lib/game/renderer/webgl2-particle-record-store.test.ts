import { acVector3, renderVector3 } from "../../assets/ac-frame";
import { describe, expect, it, vi } from "vitest";
import {
	PARTICLE_RECORD_TEXELS,
	PARTICLE_RECORD_TEXTURE_WIDTH,
	type ParticleInstanceRecord,
} from "./particle-instance-stream";
import { WebGL2ParticleRecordStore } from "./webgl2-particle-record-store";

function record(birthTime: number): ParticleInstanceRecord {
	return {
		a: acVector3([1, 2, 3]),
		b: acVector3([4, 5, 6]),
		birthTime,
		c: acVector3([7, 8, 9]),
		finalScale: 11,
		finalTranslucency: 13,
		lifespan: 4,
		offset: acVector3([21, 22, 23]),
		origin: renderVector3([31, 32, 33]),
		startScale: 10,
		startTranslucency: 12,
	};
}

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

/** The mirror handed to the most recent upload, which is what the vertex stage will read. */
function uploadedMirror(
	calls: ReturnType<typeof fakeGl>["calls"],
): Float32Array {
	const lastCall = calls.texSubImage2D.mock.calls.at(-1);
	if (!lastCall) throw new Error("Expected a record upload.");
	return lastCall[8] as Float32Array;
}

describe("WebGL2ParticleRecordStore", () => {
	it("uploads every physical batch once and reports the frame record count", () => {
		const { calls, gl } = fakeGl();
		const store = new WebGL2ParticleRecordStore(gl);

		expect(
			store.prepareFrame([
				{ particles: [record(0)] },
				{ particles: [record(1)] },
			]),
		).toBe(2);
		expect(calls.texSubImage2D).toHaveBeenCalledTimes(1);
	});

	// The vertex stage reads a fixed texel count per record and indexes by record number, so a
	// record must start on its own texel boundary. Packing them tightly would misalign every
	// record after the first.
	it("places each record on its own texel stride", () => {
		const { calls, gl } = fakeGl();
		const store = new WebGL2ParticleRecordStore(gl);

		store.prepareFrame([{ particles: [record(100), record(200)] }]);

		const mirror = uploadedMirror(calls);
		const stride = PARTICLE_RECORD_TEXELS * 4;
		// Origin occupies the first three lanes and birth time the fourth, for every record.
		expect([...mirror.slice(0, 4)]).toEqual([31, 32, 33, 100]);
		expect([...mirror.slice(stride, stride + 4)]).toEqual([31, 32, 33, 200]);
	});

	it("grows capacity by doubling and never reallocates for a smaller frame", () => {
		const { calls, gl } = fakeGl();
		const store = new WebGL2ParticleRecordStore(gl);

		store.prepareFrame([{ particles: [record(0)] }]);
		expect(calls.texImage2D).toHaveBeenCalledTimes(1);

		store.prepareFrame([{ particles: [record(0)] }]);
		expect(calls.texImage2D).toHaveBeenCalledTimes(1);
	});

	it("uploads nothing for an empty cohort", () => {
		const { calls, gl } = fakeGl();
		const store = new WebGL2ParticleRecordStore(gl);

		expect(store.prepareFrame([])).toBe(0);
		expect(calls.texSubImage2D).not.toHaveBeenCalled();
		expect(store.uploadedFloatCount).toBe(0);
	});

	it("uploads whole rows and reports what it uploaded", () => {
		const { gl } = fakeGl();
		const store = new WebGL2ParticleRecordStore(gl);

		store.prepareFrame([{ particles: [record(0)] }]);

		// One record still costs its row, which is what makes upload volume worth reporting.
		expect(store.uploadedFloatCount).toBe(PARTICLE_RECORD_TEXTURE_WIDTH * 4);
	});

	it("refuses use after destruction", () => {
		const { gl } = fakeGl();
		const store = new WebGL2ParticleRecordStore(gl);

		store.destroy();

		expect(() => store.prepareFrame([])).toThrow(/destroyed/);
	});
});
