import { renderVector3, type RenderVector3 } from "../../assets/ac-frame";
import type { DatAssetId } from "../game-types";
import { placeSpatialAudio } from "./audio-spatialization";

/** A playing voice, from the system's point of view. */
export interface AudioVoice {
	stop(): void;
}

/**
 * The narrow device surface the system needs.
 *
 * Injected so playback policy — probability, spatialization, voice budget — is testable without a
 * browser, and so the Web Audio adapter stays free of game semantics.
 */
export interface AudioDevice {
	/** Play one decoded sound immediately at the given gain and pan. */
	playOneShot(
		soundId: DatAssetId,
		gain: number,
		pan: number,
	): AudioVoice | null;
}

/** Where the listener is and which way its right hand points. */
export interface AudioListener {
	readonly position: RenderVector3;
	readonly right: RenderVector3;
}

/** One authored sound request, already resolved to a concrete asset. */
export interface AudioTrigger {
	readonly soundId: DatAssetId;
	/** Play chance rolled once at trigger time. */
	readonly probability: number;
	readonly volume: number;
	readonly position: RenderVector3;
}

export type AudioTriggerOutcome =
	"played" | "lost-probability-roll" | "inaudible" | "device-refused";

export interface AudioDiagnostics {
	readonly activeVoiceCount: number;
	readonly playedCount: number;
	readonly stolenCount: number;
	readonly suppressedCount: number;
}

/**
 * Plays authored one-shot sounds, and deliberately does nothing else.
 *
 * The evidence-backed scope is small on purpose: no looping, no streaming, no mixing graph, no stop
 * API. Retail's hook path has none of those — repeating ambience is a separate `Ambient` scheduler
 * that is out of scope — and spatial parameters are computed once at trigger time and never
 * updated, so a moving source does not re-pan.
 *
 * Voices deliberately **outlive their emitting owner**. Retail's playing voices are fire-and-forget
 * copies with no back-pointer, so a sound triggered by an object finishes after that object is
 * destroyed (acclient.c:366405-366407). Cutting them off on owner removal would be a divergence,
 * not a cleanup.
 */
export class AudioSystem {
	readonly #device: AudioDevice;
	readonly #roll: () => number;
	readonly #voiceLimit: number;
	readonly #voices: AudioVoice[] = [];
	#playedCount = 0;
	#stolenCount = 0;
	#suppressedCount = 0;
	#listener: AudioListener = {
		// The renderer's own axes, not authored data.
		position: renderVector3([0, 0, 0]),
		right: renderVector3([1, 0, 0]),
	};

	/**
	 * @param voiceLimit Maximum simultaneous voices; the oldest is stolen when the budget is full.
	 * Retail runs 16 voices with priority-based stealing, but hook sounds all carry priority 0 and
	 * lose every contest, so a plain oldest-steal is the same behavior with less machinery.
	 */
	constructor(device: AudioDevice, roll: () => number, voiceLimit: number) {
		if (!Number.isInteger(voiceLimit) || voiceLimit <= 0)
			throw new Error("Audio voice limit must be a positive integer.");
		this.#device = device;
		this.#roll = roll;
		this.#voiceLimit = voiceLimit;
	}

	setListener(listener: AudioListener): void {
		this.#listener = listener;
	}

	/** Roll, place, and play one authored sound, reporting exactly what happened. */
	trigger(trigger: AudioTrigger): AudioTriggerOutcome {
		// Retail rolls the probability before doing any spatial work at all.
		if (trigger.probability < 1 && this.#roll() >= trigger.probability) {
			this.#suppressedCount += 1;
			return "lost-probability-roll";
		}
		const placement = placeSpatialAudio(
			trigger.position,
			this.#listener.position,
			this.#listener.right,
			trigger.volume,
		);
		// Below retail's audible floor the sound is not played at all, rather than played silently.
		if (placement === null) {
			this.#suppressedCount += 1;
			return "inaudible";
		}
		if (this.#voices.length >= this.#voiceLimit) {
			this.#voices.shift()?.stop();
			this.#stolenCount += 1;
		}
		const voice = this.#device.playOneShot(
			trigger.soundId,
			placement.gain,
			placement.pan,
		);
		if (voice === null) return "device-refused";
		this.#voices.push(voice);
		this.#playedCount += 1;
		return "played";
	}

	/** Drop a finished voice from the budget without stopping it. */
	release(voice: AudioVoice): void {
		const index = this.#voices.indexOf(voice);
		if (index >= 0) this.#voices.splice(index, 1);
	}

	/**
	 * Stop everything, for runtime shutdown only.
	 *
	 * Deliberately not called on owner removal: voices outlive their owners in retail.
	 */
	destroy(): void {
		for (const voice of this.#voices) voice.stop();
		this.#voices.length = 0;
	}

	getDiagnostics(): AudioDiagnostics {
		return {
			activeVoiceCount: this.#voices.length,
			playedCount: this.#playedCount,
			stolenCount: this.#stolenCount,
			suppressedCount: this.#suppressedCount,
		};
	}
}
