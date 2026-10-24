import { PARTICLE_INSTANCE_FLOAT_COUNT } from "../renderer/particle-record-layout";
import type { ParticleDrawRange } from "../renderer/particle-render-routing";
import type { ParticleRecordFrame } from "../renderer/webgl2-particle-pass";

type MutableRange = {
	-readonly [Key in keyof ParticleDrawRange]: ParticleDrawRange[Key];
};

/** One model's borrowed particle publication before composition-local slot remapping. */
interface ModelParticles {
	/** Draw ranges address this model's independent record pool. */
	readonly particleRanges: readonly ParticleDrawRange[];
	/** Spawn constants and the exact dirty interval produced by that model. */
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
		let first = Number.POSITIVE_INFINITY;
		let last = Number.NEGATIVE_INFINITY;
		this.#ranges.length = 0;
		let used = 0;
		for (const [index, model] of models.entries()) {
			const offset = this.#slotOffsets[index];
			if (offset === undefined)
				throw new Error("Prepared preview particle layout lost a model.");
			const records = model.particleRecords;
			if (changed) {
				this.#data.set(records.data, offset * PARTICLE_INSTANCE_FLOAT_COUNT);
				if (records.data.length > 0) {
					first = 0;
					last = this.#data.length / PARTICLE_INSTANCE_FLOAT_COUNT - 1;
				}
			} else if (records.dirtySlots !== null) {
				const start = records.dirtySlots.first;
				const end = records.dirtySlots.last + 1;
				this.#data.set(
					records.data.subarray(
						start * PARTICLE_INSTANCE_FLOAT_COUNT,
						end * PARTICLE_INSTANCE_FLOAT_COUNT,
					),
					(offset + start) * PARTICLE_INSTANCE_FLOAT_COUNT,
				);
				first = Math.min(first, offset + start);
				last = Math.max(last, offset + end - 1);
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
		return {
			particleRanges: this.#ranges,
			particleRecords: {
				data: this.#data,
				dirtySlots: Number.isFinite(first) ? { first, last } : null,
			},
		};
	}
}
