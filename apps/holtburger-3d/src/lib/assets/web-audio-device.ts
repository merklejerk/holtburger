import type { DatAssetId } from "../game/game-types";
import type { AudioDevice, AudioVoice } from "../game/systems/audio-system";

/** Loads one authored sound's decoder-ready bytes and its media type. */
export interface AudioAssetSource {
	loadAudio(soundId: DatAssetId): Promise<ArrayBuffer>;
	destroy(): void;
}

/**
 * Web Audio adapter for authored one-shot sounds.
 *
 * Deliberately thin: it owns decoding, buffer reuse, and voice construction, and knows nothing
 * about probability, attenuation, or voice budgets — those are game semantics that live in
 * `AudioSystem`.
 *
 * A sound whose buffer has not decoded yet is **refused, not queued**. Refusal is a signal rather
 * than a failure: `AudioSystem` warms the sound and replays it once, within a bound it owns, so the
 * decision about how late is too late stays with game policy rather than with the adapter.
 */
export class WebAudioDevice implements AudioDevice {
	readonly #context: AudioContext;
	readonly #source: AudioAssetSource;
	readonly #buffers = new Map<DatAssetId, AudioBuffer>();
	readonly #pending = new Set<DatAssetId>();
	#destroyed = false;

	constructor(context: AudioContext, source: AudioAssetSource) {
		this.#context = context;
		this.#source = source;
	}

	playOneShot(
		soundId: DatAssetId,
		gain: number,
		pan: number,
	): AudioVoice | null {
		if (this.#destroyed) return null;
		const buffer = this.#buffers.get(soundId);
		if (!buffer) {
			void this.#prepare(soundId);
			return null;
		}
		const source = this.#context.createBufferSource();
		source.buffer = buffer;
		const gainNode = this.#context.createGain();
		gainNode.gain.value = gain;
		const panner = this.#context.createStereoPanner();
		panner.pan.value = pan;
		source.connect(gainNode).connect(panner).connect(this.#context.destination);
		let finished = false;
		// Web Audio reports the exact end, including a stop we requested, so the voice needs no
		// duration bookkeeping to know it is done.
		source.onended = () => {
			finished = true;
			source.disconnect();
		};
		source.start();
		let stopped = false;
		return {
			get finished() {
				return finished;
			},
			stop: () => {
				if (stopped) return;
				stopped = true;
				// A voice that already ended throws on stop; ending twice is not an error here.
				try {
					source.stop();
				} catch {
					// Already finished.
				}
				source.disconnect();
			},
		};
	}

	/** Decode one sound, resolving exactly when `playOneShot` will accept it. */
	async prepare(soundId: DatAssetId): Promise<void> {
		await this.#prepare(soundId);
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.#buffers.clear();
		this.#pending.clear();
		this.#source.destroy();
	}

	async #prepare(soundId: DatAssetId): Promise<void> {
		if (this.#destroyed) return;
		if (this.#buffers.has(soundId) || this.#pending.has(soundId)) return;
		this.#pending.add(soundId);
		try {
			const bytes = await this.#source.loadAudio(soundId);
			const buffer = await this.#context.decodeAudioData(bytes);
			if (!this.#destroyed) this.#buffers.set(soundId, buffer);
		} finally {
			this.#pending.delete(soundId);
		}
	}
}
