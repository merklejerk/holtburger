import {
	PARTICLE_INSTANCE_FLOAT_COUNT,
	PARTICLE_RECORD_TEXELS,
	PARTICLE_RECORDS_PER_ROW,
	writeParticleRecord,
	type ParticleInstanceRecord,
} from "../renderer/passes/particle-record-layout";

/** RGBA32F carries four floats per texel. */
const FLOATS_PER_TEXEL = 4;

/** Floats one record occupies once padded to whole texels. */
export const PARTICLE_RECORD_STRIDE_FLOATS =
	PARTICLE_RECORD_TEXELS * FLOATS_PER_TEXEL;

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
	/** One bit per texture row; scattered writes do not bridge untouched rows. */
	#dirtyRows = new Uint32Array(0);

	/** Backing mirror padded to complete texture rows; spare slots remain available for reuse. */
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
		writeParticleRecord(
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

	/** Snapshot dirty texture rows and clear them for the next publication. */
	takeDirtyRows(): Uint32Array | null {
		if (!this.#dirtyRows.some((word) => word !== 0)) return null;
		const rows = this.#dirtyRows.slice();
		this.#dirtyRows.fill(0);
		return rows;
	}

	#markDirty(slot: number): void {
		const row = Math.floor(slot / PARTICLE_RECORDS_PER_ROW);
		this.#dirtyRows[row >>> 5] |= 1 << (row & 31);
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
		// GPU uploads consume complete rows, including unused slots in the final row.
		const added =
			Math.ceil(required / PARTICLE_RECORDS_PER_ROW) * PARTICLE_RECORDS_PER_ROW;
		this.#capacity += added;
		const grown = new Float32Array(
			this.#capacity * PARTICLE_RECORD_STRIDE_FLOATS,
		);
		grown.set(this.#data);
		this.#data = grown;
		const rowCount = this.#capacity / PARTICLE_RECORDS_PER_ROW;
		const wordCount = Math.ceil(rowCount / 32);
		if (wordCount > this.#dirtyRows.length) {
			const bits = new Uint32Array(wordCount);
			bits.set(this.#dirtyRows);
			this.#dirtyRows = bits;
		}
		if (added > required) {
			this.release({ base: base + required, capacity: added - required });
		}
		return base;
	}
}
