import {
	acVector3,
	landblockVector3,
	sceneVector3,
} from "../../assets/ac-frame";
import { describe, expect, it } from "vitest";
import {
	PARTICLE_RECORDS_PER_ROW,
	type ParticleInstanceRecord,
} from "../renderer/passes/particle-record-layout";
import {
	ParticleRecordSlots,
	PARTICLE_RECORD_STRIDE_FLOATS,
} from "./particle-record-slots";

function record(birthTime: number): ParticleInstanceRecord {
	return {
		a: acVector3([1, 0, 0]),
		b: acVector3([0, 0, 0]),
		birthTime,
		c: acVector3([0, 0, 0]),
		finalScale: 1,
		finalTranslucency: 1,
		landblockOrigin: sceneVector3([0, 0, 0]),
		lifespan: 4,
		localOrigin: landblockVector3([0, 0, 0]),
		offset: acVector3([0, 0, 0]),
		rotation: { w: 1, x: 0, y: 0, z: 0 },
		startScale: 1,
		startTranslucency: 0,
	};
}

/** Birth time is the fourth float of a record, so it identifies which record sits in a slot. */
function birthTimeAt(slots: ParticleRecordSlots, slot: number): number {
	return slots.data[slot * PARTICLE_RECORD_STRIDE_FLOATS + 3]!;
}

describe("ParticleRecordSlots", () => {
	it("reuses padding after a reservation larger than one row", () => {
		const slots = new ParticleRecordSlots();
		const requested = PARTICLE_RECORDS_PER_ROW + 1;
		slots.allocate(requested);
		const mirror = slots.data;
		const spare = slots.allocate(PARTICLE_RECORDS_PER_ROW - 1);
		expect(spare.base).toBe(requested);
		expect(slots.data).toBe(mirror);
		expect(slots.reservedSlotCount).toBe(PARTICLE_RECORDS_PER_ROW * 2);
	});

	it("hands out non-overlapping regions", () => {
		const slots = new ParticleRecordSlots();

		const first = slots.allocate(4);
		const second = slots.allocate(4);

		expect(second.base).toBeGreaterThanOrEqual(first.base + first.capacity);
		expect(slots.reservedSlotCount).toBe(8);
	});

	it("reuses a released region rather than growing", () => {
		const slots = new ParticleRecordSlots();
		const first = slots.allocate(4);
		const capacityBefore = slots.capacity;

		slots.release(first);
		const reused = slots.allocate(4);

		expect(reused.base).toBe(first.base);
		expect(slots.capacity).toBe(capacityBefore);
	});

	// Without merging, an emitter population that churns would fragment the store into runs too
	// small to reserve, and it would grow forever despite most of it being free.
	it("merges adjacent released regions into one usable span", () => {
		const slots = new ParticleRecordSlots();
		const first = slots.allocate(4);
		const second = slots.allocate(4);
		const capacityBefore = slots.capacity;

		slots.release(first);
		slots.release(second);
		const merged = slots.allocate(8);

		expect(merged.base).toBe(first.base);
		expect(slots.capacity).toBe(capacityBefore);
	});

	it("keeps written records when the store grows", () => {
		const slots = new ParticleRecordSlots();
		const region = slots.allocate(2);
		slots.writeRecord(region.base, record(42));

		// Force growth past the initial block.
		slots.allocate(PARTICLE_RECORDS_PER_ROW + 1);

		expect(birthTimeAt(slots, region.base)).toBe(42);
	});

	it("moves a record between slots, which is how a death compacts its region", () => {
		const slots = new ParticleRecordSlots();
		const region = slots.allocate(3);
		slots.writeRecord(region.base, record(1));
		slots.writeRecord(region.base + 2, record(3));

		slots.moveRecord(region.base + 2, region.base);

		expect(birthTimeAt(slots, region.base)).toBe(3);
	});

	it("reports touched texture rows once and then forgets them", () => {
		const slots = new ParticleRecordSlots();
		const region = slots.allocate(8);

		slots.writeRecord(region.base + 5, record(1));
		slots.writeRecord(region.base + 2, record(2));

		expect(slots.takeDirtyRows()).toEqual(new Uint32Array([1]));
		// Nothing written since, so the next frame uploads nothing.
		expect(slots.takeDirtyRows()).toBeNull();
	});

	it("marks distant rows without marking intervening rows", () => {
		const slots = new ParticleRecordSlots();
		const region = slots.allocate(PARTICLE_RECORDS_PER_ROW * 4);
		slots.writeRecord(region.base, record(1));
		slots.writeRecord(region.base + PARTICLE_RECORDS_PER_ROW * 3, record(2));
		expect(slots.takeDirtyRows()).toEqual(new Uint32Array([0b1001]));
	});

	it("refuses a slot outside the store rather than corrupting a neighbour", () => {
		const slots = new ParticleRecordSlots();
		const region = slots.allocate(2);

		expect(() => slots.writeRecord(slots.capacity, record(1))).toThrow(
			/out of range/,
		);
		expect(region.capacity).toBe(2);
	});
});
