import type { DatAssetId } from "../game/game-types";
import type {
	AudioDevice,
	AudioVoice,
} from "../game/systems/audio-system";

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
 * Playback is best-effort by design. A sound whose buffer has not decoded yet is **skipped, not
 * queued**: these are ambient one-shots tied to a moment, and playing one late is worse than not
 * playing it. The first request starts the decode so later triggers of the same sound land.
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
		source.start();
		let stopped = false;
		return {
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

	/** Decode one sound so later triggers can play it immediately. */
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
