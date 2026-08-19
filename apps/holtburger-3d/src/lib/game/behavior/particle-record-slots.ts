import {
	PARTICLE_INSTANCE_FLOAT_COUNT,
	PARTICLE_RECORD_TEXELS,
	PARTICLE_RECORDS_PER_ROW,
	writeParticleInstance,
	type ParticleInstanceRecord,
} from "../renderer/particle-instance-stream";

/** RGBA32F carries four floats per texel. */
const FLOATS_PER_TEXEL = 4;

/** Floats one record occupies once padded to whole texels. */
export const PARTICLE_RECORD_STRIDE_FLOATS =
	PARTICLE_RECORD_TEXELS * FLOATS_PER_TEXEL;

/** Records the store grows by when it runs out of room. */
const GROWTH_RECORDS = PARTICLE_RECORDS_PER_ROW;

/** A contiguous run of free slots, held so adjacent frees can merge back together. */
interface FreeSpan {
	base: number;
	capacity: number;
}

/**
 * One emitter's reserved run of record slots.
 *
 * Reserved for the emitter's lifetime rather than per frame, which is the whole point: a record is
 * written when its particle is born and read by the GPU every frame after, so nothing walks the
 * particle population once it is resident.
 */
export interface ParticleSlotRegion {
	readonly base: number;
	readonly capacity: number;
}

/**
 * Slot allocation and record storage for live particles, free of any GPU dependency.
 *
 * Owns the CPU-side mirror the renderer uploads. Deliberately not a GL object: the emitter runtime
 * that writes records lives outside the renderer, and giving it a device handle would put device
 * lifetime in the middle of emitter lifetime.
 *
 * Slots are handed out in contiguous per-emitter regions so a draw covers one emitter as a range,
 * addressed by base slot and count rather than by a per-particle index list.
 */
export class ParticleRecordSlots {
	#data = new Float32Array(0);
	/** Slots the store can currently hold. */
	#capacity = 0;
	/** Free spans in ascending base order, which is what lets neighbours merge on release. */
	#freeSpans: FreeSpan[] = [];
	/** Lowest and highest slot written since the last `takeDirtySlotRange`. */
	#dirtyFirstSlot = Number.POSITIVE_INFINITY;
	#dirtyLastSlot = -1;

	/** Backing mirror, in the exact layout the record texture holds. */
	get data(): Float32Array {
		return this.#data;
	}

	get capacity(): number {
		return this.#capacity;
	}

	/** Slots currently reserved by regions, for occupancy diagnostics. */
	get reservedSlotCount(): number {
		let free = 0;
		for (const span of this.#freeSpans) free += span.capacity;
		return this.#capacity - free;
	}

	/**
	 * Reserve a contiguous region, growing the store when no existing span fits.
	 *
	 * First fit rather than best fit: emitter regions are small and similar in size, so the search
	 * order barely changes packing while first fit keeps release-time merging simple.
	 */
	allocate(capacity: number): ParticleSlotRegion {
		if (!Number.isSafeInteger(capacity) || capacity <= 0) {
			throw new Error(
				`Particle slot region needs a positive capacity, got ${capacity}.`,
			);
		}
		for (let index = 0; index < this.#freeSpans.length; index += 1) {
			const span = this.#freeSpans[index]!;
			if (span.capacity < capacity) continue;
			const base = span.base;
			if (span.capacity === capacity) this.#freeSpans.splice(index, 1);
			else {
				span.base += capacity;
				span.capacity -= capacity;
			}
			return { base, capacity };
		}
		const base = this.#grow(capacity);
		return { base, capacity };
	}

	/** Return a region's slots to the free list, merging with any adjacent free span. */
	release(region: ParticleSlotRegion): void {
		const span: FreeSpan = { base: region.base, capacity: region.capacity };
		let index = 0;
		while (
			index < this.#freeSpans.length &&
			this.#freeSpans[index]!.base < span.base
		) {
			index += 1;
		}
		this.#freeSpans.splice(index, 0, span);
		this.#mergeSpanWithNeighbours(index);
	}

	/** Write one particle's record into an absolute slot and mark it for upload. */
	writeRecord(slot: number, record: ParticleInstanceRecord): void {
		if (!Number.isSafeInteger(slot) || slot < 0 || slot >= this.#capacity) {
			throw new Error(`Particle record slot ${slot} is out of range.`);
		}
		writeParticleInstance(
			this.#data,
			slot * PARTICLE_RECORD_STRIDE_FLOATS,
			record,
		);
		this.#markDirty(slot);
	}

	/** Copy one record over another, which is how a death compacts its region. */
	moveRecord(fromSlot: number, toSlot: number): void {
		if (fromSlot === toSlot) return;
		const stride = PARTICLE_RECORD_STRIDE_FLOATS;
		// The whole stride, not just the written fields: the two are equal only while the record
		// happens to fill its texels exactly, and a move that copied the smaller of them would
		// silently truncate the day any padding came back.
		this.#data.copyWithin(
			toSlot * stride,
			fromSlot * stride,
			fromSlot * stride + stride,
		);
		this.#markDirty(toSlot);
	}

	/** Overwrite one float of an already-written record, for the fields a suspension shifts. */
	patchRecordFloat(slot: number, floatOffset: number, value: number): void {
		if (floatOffset < 0 || floatOffset >= PARTICLE_INSTANCE_FLOAT_COUNT) {
			throw new Error(`Particle record float ${floatOffset} is out of range.`);
		}
		this.#data[slot * PARTICLE_RECORD_STRIDE_FLOATS + floatOffset] = value;
		this.#markDirty(slot);
	}

	/**
	 * Take the slot range written since the last call, or `null` when nothing changed.
	 *
	 * A range rather than a set: spawns and deaths are rare relative to frames, and uploading one
	 * span keeps the per-frame cost to a single texture call.
	 */
	takeDirtySlotRange(): {
		readonly first: number;
		readonly last: number;
	} | null {
		if (this.#dirtyLastSlot < 0) return null;
		const range = { first: this.#dirtyFirstSlot, last: this.#dirtyLastSlot };
		this.#dirtyFirstSlot = Number.POSITIVE_INFINITY;
		this.#dirtyLastSlot = -1;
		return range;
	}

	#markDirty(slot: number): void {
		if (slot < this.#dirtyFirstSlot) this.#dirtyFirstSlot = slot;
		if (slot > this.#dirtyLastSlot) this.#dirtyLastSlot = slot;
	}

	#mergeSpanWithNeighbours(index: number): void {
		const spans = this.#freeSpans;
		const span = spans[index]!;
		const next = spans[index + 1];
		if (next && span.base + span.capacity === next.base) {
			span.capacity += next.capacity;
			spans.splice(index + 1, 1);
		}
		const previous = spans[index - 1];
		if (previous && previous.base + previous.capacity === span.base) {
			previous.capacity += span.capacity;
			spans.splice(index, 1);
		}
	}

	/** Extend the store by at least `required` slots and return the base of the new run. */
	#grow(required: number): number {
		const base = this.#capacity;
		const added = Math.max(required, GROWTH_RECORDS);
		this.#capacity += added;
		const grown = new Float32Array(
			this.#capacity * PARTICLE_RECORD_STRIDE_FLOATS,
		);
		grown.set(this.#data);
		this.#data = grown;
		if (added > required) {
			this.release({ base: base + required, capacity: added - required });
		}
		return base;
	}
}
