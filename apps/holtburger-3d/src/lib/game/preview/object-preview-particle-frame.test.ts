import { describe, expect, it } from "vitest";
import { PARTICLE_INSTANCE_FLOAT_COUNT } from "../renderer/particle-record-layout";
import type { ParticleDrawRange } from "../renderer/particle-render-routing";
import { datAssetId } from "../runtime/dynamic-entity-presentation";
import { ObjectPreviewParticleFrame } from "./object-preview-particle-frame";

function model(capacity: number, marker: number, slot: number) {
	const data = new Float32Array(capacity * PARTICLE_INSTANCE_FLOAT_COUNT);
	data[0] = marker;
	const range: ParticleDrawRange = {
		baseSlot: slot,
		count: 1,
		frame: { kind: "record" },
		hwGfxObjId: datAssetId(0x01000001),
		motionType: 1,
	};
	return {
		particleRecords: { data, dirtyRows: null },
		particleRanges: [range],
	};
}

describe("preview particle composition", () => {
	it("remaps independent model slots and copies only changed spawn records", () => {
		const merge = new ObjectPreviewParticleFrame();
		const body = model(2, 10, 1);
		const equipment = model(1, 20, 0);
		const first = merge.merge([body, equipment]);
		const data = first.particleRecords.data;
		expect(first.particleRanges.map((range) => range.baseSlot)).toEqual([1, 2]);
		expect(first.particleRecords.dirtyRows).toEqual(new Uint32Array([1]));
		expect(data[2 * PARTICLE_INSTANCE_FLOAT_COUNT]).toBe(20);
		equipment.particleRecords.data[0] = 30;
		const edited = merge.merge([
			body,
			{
				...equipment,
				particleRecords: {
					data: equipment.particleRecords.data,
					dirtyRows: new Uint32Array([1]),
				},
			},
		]);
		expect(edited.particleRecords.data).toBe(data);
		expect(edited.particleRecords.dirtyRows).toEqual(new Uint32Array([1]));
		expect(data[0]).toBe(10);
		expect(data[2 * PARTICLE_INSTANCE_FLOAT_COUNT]).toBe(30);
		expect(merge.merge([body, equipment]).particleRecords.dirtyRows).toBeNull();
	});

	it("rebuilds offsets on pool growth even when a displaced model has no dirty rows", () => {
		const merge = new ObjectPreviewParticleFrame();
		const equipment = model(1, 20, 0);
		merge.merge([model(1, 10, 0), equipment]);
		const grown = merge.merge([model(3, 11, 2), equipment]);
		expect(grown.particleRanges.map((range) => range.baseSlot)).toEqual([2, 3]);
		expect(grown.particleRecords.data[3 * PARTICLE_INSTANCE_FLOAT_COUNT]).toBe(
			20,
		);
		expect(grown.particleRecords.dirtyRows).toEqual(new Uint32Array([1]));
	});

	it("leaves empty pools without a fabricated dirty interval", () => {
		const merge = new ObjectPreviewParticleFrame();
		const result = merge.merge([
			{
				particleRanges: [],
				particleRecords: { data: new Float32Array(0), dirtyRows: null },
			},
		]);
		expect(result.particleRanges).toEqual([]);
		expect(result.particleRecords.data.length).toBe(0);
		expect(result.particleRecords.dirtyRows).toBeNull();
	});
});
