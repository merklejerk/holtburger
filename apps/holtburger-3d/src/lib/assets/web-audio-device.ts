import type { DatAssetId } from "../game/game-types";
import type { AudioDevice, AudioVoice } from "../game/systems/audio-system";

/** Gain change below which a re-target is dropped; far under the smoothing ramp's own resolution. */
const GAIN_EPSILON = 1e-4;
/** Pan change below which a re-target is dropped. */
const PAN_EPSILON = 1e-3;

/**
 * RETAIL QUIRK: the far channel is attenuated by at most 15 dB, and the near channel is never
 * attenuated at all. `SoundBuf::Play` clamps pan to ±15 and hands DirectSound `SetPan(100 × pan)`
 * (acclient.c:369202-369232) — hundredths-of-a-dB units that turn one channel down and leave the
 * other alone. "Correcting" this to an equal-power panner drops every centred sound (every ambient
 * bed, everything inside the flat radius) by 3 dB in both ears and silences the far ear completely
 * at full pan; the entire shipped mix was tuned against full-both-channels playback and audibly
 * thins without it.
 */
const MAXIMUM_PAN_SHADOW_DECIBELS = 15;

/** The far channel's gain under retail's pan law; the near channel is always 1. */
function panShadowGain(pan: number): number {
	return 10 ** ((-MAXIMUM_PAN_SHADOW_DECIBELS * Math.abs(pan)) / 20);
}

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
 *
 * Panning follows retail's single-channel-attenuation law rather than an equal-power panner (see
 * MAXIMUM_PAN_SHADOW_DECIBELS). Stereo-authored buffers are mixed down by the channel fan-out,
 * matching how retail's mono hook and ambient waves actually shipped.
 */
export class WebAudioDevice implements AudioDevice {
	readonly #context: AudioContext;
	readonly #source: AudioAssetSource;
	readonly #placementSmoothingSeconds: number;
	readonly #loudnessCurveExponent: number;
	readonly #buffers = new Map<DatAssetId, AudioBuffer>();
	/** Decoder-ready payload sizes retained alongside the corresponding Web Audio buffers. */
	readonly #bufferSourceBytes = new Map<DatAssetId, number>();
	readonly #pending = new Set<DatAssetId>();
	#destroyed = false;

	constructor(
		context: AudioContext,
		source: AudioAssetSource,
		placementSmoothingSeconds: number,
		loudnessCurveExponent: number,
	) {
		if (!(placementSmoothingSeconds > 0)) {
			throw new Error("Placement smoothing must be a positive duration.");
		}
		if (!(loudnessCurveExponent > 0)) {
			throw new Error("Loudness curve exponent must be positive.");
		}
		this.#context = context;
		this.#source = source;
		this.#placementSmoothingSeconds = placementSmoothingSeconds;
		this.#loudnessCurveExponent = loudnessCurveExponent;
	}

	/**
	 * Presentation loudness contour over the retail-linear gain (see the tuning constant).
	 *
	 * Applied at the last moment before the param write, so game policy — the audibility floor,
	 * diagnostics, steal decisions — all reason in unshaped retail gain.
	 */
	#shapeGain(gain: number): number {
		return gain ** this.#loudnessCurveExponent;
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
		gainNode.gain.value = this.#shapeGain(gain);
		// Retail's pan law needs independent channel gains (see MAXIMUM_PAN_SHADOW_DECIBELS), which
		// no StereoPannerNode can express: master gain fans out to a left and a right gain, merged
		// into the two output channels.
		const leftGain = this.#context.createGain();
		const rightGain = this.#context.createGain();
		const shadow = panShadowGain(pan);
		leftGain.gain.value = pan > 0 ? shadow : 1;
		rightGain.gain.value = pan < 0 ? shadow : 1;
		const merger = this.#context.createChannelMerger(2);
		source.connect(gainNode);
		gainNode.connect(leftGain);
		gainNode.connect(rightGain);
		leftGain.connect(merger, 0, 0);
		rightGain.connect(merger, 0, 1);
		merger.connect(this.#context.destination);
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
				const nextShadow = panShadowGain(nextPan);
				gainNode.gain.setTargetAtTime(
					this.#shapeGain(nextGain),
					now,
					smoothing,
				);
				leftGain.gain.setTargetAtTime(
					nextPan > 0 ? nextShadow : 1,
					now,
					smoothing,
				);
				rightGain.gain.setTargetAtTime(
					nextPan < 0 ? nextShadow : 1,
					now,
					smoothing,
				);
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

	getPreparedSourceBytes(soundId: DatAssetId): number | null {
		return this.#bufferSourceBytes.get(soundId) ?? null;
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.#buffers.clear();
		this.#bufferSourceBytes.clear();
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
			if (!this.#destroyed) {
				this.#buffers.set(soundId, buffer);
				this.#bufferSourceBytes.set(soundId, bytes.byteLength);
			}
		} finally {
			this.#pending.delete(soundId);
		}
	}
}
