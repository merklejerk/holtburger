import {
	PARTICLE_INSTANCE_FLOAT_COUNT,
	PARTICLE_RECORDS_PER_ROW,
} from "../renderer/passes/particle-record-layout";
import type { ParticleDrawRange } from "../renderer/passes/particle-render-routing";
import type { ParticleRecordFrame } from "../renderer/passes/webgl2-particle-pass";

type MutableRange = {
	-readonly [Key in keyof ParticleDrawRange]: ParticleDrawRange[Key];
};

/** One model's borrowed particle publication before composition-local slot remapping. */
interface ModelParticles {
	/** Draw ranges address this model's independent record pool. */
	readonly particleRanges: readonly ParticleDrawRange[];
	/** Spawn constants and touched texture rows produced by that model. */
	readonly particleRecords: ParticleRecordFrame;
}

/** Merge private model pools into one GPU record stream without scanning live particles. */
export class ObjectPreviewParticleFrame {
	readonly #lengths: number[] = [];
	readonly #slotOffsets: number[] = [];
	readonly #rangePool: MutableRange[] = [];
	readonly #ranges: ParticleDrawRange[] = [];
	#data = new Float32Array(0);

	/** Copy changed spawn constants only; a capacity change rebuilds the combined layout once. */
	merge(models: readonly ModelParticles[]): {
		readonly particleRanges: readonly ParticleDrawRange[];
		readonly particleRecords: ParticleRecordFrame;
	} {
		const changed =
			models.length !== this.#lengths.length ||
			models.some(
				(model, index) =>
					model.particleRecords.data.length !== this.#lengths[index],
			);
		if (changed) {
			let floats = 0;
			this.#lengths.length = models.length;
			this.#slotOffsets.length = models.length;
			for (const [index, model] of models.entries()) {
				const length = model.particleRecords.data.length;
				if (length % PARTICLE_INSTANCE_FLOAT_COUNT !== 0)
					throw new Error("Preview particle pool has an incomplete record.");
				this.#lengths[index] = length;
				this.#slotOffsets[index] = floats / PARTICLE_INSTANCE_FLOAT_COUNT;
				floats += length;
			}
			this.#data = new Float32Array(floats);
		}
		const rowCount = Math.ceil(
			this.#data.length /
				PARTICLE_INSTANCE_FLOAT_COUNT /
				PARTICLE_RECORDS_PER_ROW,
		);
		const dirtyRows = new Uint32Array(Math.ceil(rowCount / 32));
		const markRows = (firstSlot: number, lastSlotExclusive: number): void => {
			for (
				let row = Math.floor(firstSlot / PARTICLE_RECORDS_PER_ROW);
				row <= Math.floor((lastSlotExclusive - 1) / PARTICLE_RECORDS_PER_ROW);
				row += 1
			)
				dirtyRows[row >>> 5] |= 1 << (row & 31);
		};
		this.#ranges.length = 0;
		let used = 0;
		for (const [index, model] of models.entries()) {
			const offset = this.#slotOffsets[index];
			if (offset === undefined)
				throw new Error("Prepared preview particle layout lost a model.");
			const records = model.particleRecords;
			if (changed) {
				this.#data.set(records.data, offset * PARTICLE_INSTANCE_FLOAT_COUNT);
			} else if (records.dirtyRows !== null) {
				const modelSlots = records.data.length / PARTICLE_INSTANCE_FLOAT_COUNT;
				for (
					let wordIndex = 0;
					wordIndex < records.dirtyRows.length;
					wordIndex += 1
				) {
					let word = records.dirtyRows[wordIndex] ?? 0;
					while (word !== 0) {
						const bit = 31 - Math.clz32(word & -word);
						const start = (wordIndex * 32 + bit) * PARTICLE_RECORDS_PER_ROW;
						const end = Math.min(start + PARTICLE_RECORDS_PER_ROW, modelSlots);
						if (start < end) {
							this.#data.set(
								records.data.subarray(
									start * PARTICLE_INSTANCE_FLOAT_COUNT,
									end * PARTICLE_INSTANCE_FLOAT_COUNT,
								),
								(offset + start) * PARTICLE_INSTANCE_FLOAT_COUNT,
							);
							markRows(offset + start, offset + end);
						}
						word &= word - 1;
					}
				}
			}
			for (const source of model.particleRanges) {
				const range = (this.#rangePool[used] ??= { ...source });
				range.baseSlot = offset + source.baseSlot;
				range.count = source.count;
				range.frame = source.frame;
				range.hwGfxObjId = source.hwGfxObjId;
				range.motionType = source.motionType;
				this.#ranges.push(range);
				used++;
			}
		}
		if (changed && this.#data.length > 0)
			markRows(0, this.#data.length / PARTICLE_INSTANCE_FLOAT_COUNT);
		return {
			particleRanges: this.#ranges,
			particleRecords: {
				data: this.#data,
				dirtyRows: dirtyRows.some((word) => word !== 0) ? dirtyRows : null,
			},
		};
	}
}
