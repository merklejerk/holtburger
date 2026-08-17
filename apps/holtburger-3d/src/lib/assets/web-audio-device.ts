import type { DatAssetId } from "../game/game-types";
import type { AudioDevice, AudioVoice } from "../game/systems/audio-system";

/** Gain change below which a re-target is dropped; far under the smoothing ramp's own resolution. */
const GAIN_EPSILON = 1e-4;
/** Pan change below which a re-target is dropped. */
const PAN_EPSILON = 1e-3;

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
 *
 * Live placement updates go through `setTargetAtTime` rather than writing `AudioParam.value`: a
 * direct per-frame assignment steps the signal once per frame and zippers audibly. The smoothing
 * constant is injected because it is a tuning judgement, not an adapter detail.
 */
export class WebAudioDevice implements AudioDevice {
	readonly #context: AudioContext;
	readonly #source: AudioAssetSource;
	readonly #placementSmoothingSeconds: number;
	readonly #buffers = new Map<DatAssetId, AudioBuffer>();
	readonly #pending = new Set<DatAssetId>();
	#destroyed = false;

	constructor(
		context: AudioContext,
		source: AudioAssetSource,
		placementSmoothingSeconds: number,
	) {
		if (!(placementSmoothingSeconds > 0)) {
			throw new Error("Placement smoothing must be a positive duration.");
		}
		this.#context = context;
		this.#source = source;
		this.#placementSmoothingSeconds = placementSmoothingSeconds;
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
		let lastGain = gain;
		let lastPan = pan;
		return {
			get finished() {
				return finished;
			},
			setPlacement: (nextGain: number, nextPan: number) => {
				// A voice that ended or was stopped keeps its nodes only until GC; steering it is a
				// harmless no-op rather than an error, since the system sweeps lazily.
				if (finished || stopped) return;
				// Skip sub-audible re-targets: the system steers every voice every frame, and a
				// stationary listener would otherwise append thousands of no-op automation events
				// per second to the cross-thread param timelines. The ramp already converges, so
				// dropping a repeat is inaudible by construction.
				if (
					Math.abs(nextGain - lastGain) < GAIN_EPSILON &&
					Math.abs(nextPan - lastPan) < PAN_EPSILON
				) {
					return;
				}
				lastGain = nextGain;
				lastPan = nextPan;
				const now = this.#context.currentTime;
				const smoothing = this.#placementSmoothingSeconds;
				gainNode.gain.setTargetAtTime(nextGain, now, smoothing);
				panner.pan.setTargetAtTime(nextPan, now, smoothing);
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
