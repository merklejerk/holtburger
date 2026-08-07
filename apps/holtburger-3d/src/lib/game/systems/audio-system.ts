import {
	renderVector3,
	sceneVector3,
	type RenderVector3,
	type SceneVector3,
} from "../../assets/ac-frame";
import type { DatAssetId } from "../game-types";
import { placeSpatialAudio } from "./audio-spatialization";
import type { SpatialAudioPlacement } from "./audio-spatialization";

/** A playing voice, from the system's point of view. */
export interface AudioVoice {
	stop(): void;
	/**
	 * Whether playback has ended on its own.
	 *
	 * Pulled rather than pushed. The budget is consulted at exactly one instant — the next trigger —
	 * so a callback would deliver this continuously to a consumer that reads it once, and would need
	 * guarding against firing after a steal or after shutdown. A flag has no lifetime question.
	 */
	readonly finished: boolean;
}

/**
 * The narrow device surface the system needs.
 *
 * Injected so playback policy — probability, spatialization, voice budget — is testable without a
 * browser, and so the Web Audio adapter stays free of game semantics.
 */
export interface AudioDevice {
	/**
	 * Play one sound immediately, or refuse with `null` when its buffer is not decoded yet.
	 *
	 * Refusal is a signal, not a failure: the system warms the sound and replays it.
	 */
	playOneShot(
		soundId: DatAssetId,
		gain: number,
		pan: number,
	): AudioVoice | null;
	/** Decode one sound, resolving exactly when `playOneShot` will accept it. */
	prepare(soundId: DatAssetId): Promise<void>;
}

/**
 * User audio settings, one entry per retail sound category we produce.
 *
 * Retail carries three — effect, ambient, and interface — each with its own enable flag and volume.
 * Only effect exists here, because authored hook sounds are effect sounds
 * (`SoundManager::PlaySoundA` gates on `effect_sounds_enabled` and passes `is_ambient = 0`). Ambient
 * is a separate region-driven scheduler and interface is UI; entries appear when their producers do.
 */
export interface AudioSettings {
	/** Linear multiplier on effect gain in [0, 1]; zero silences the category as retail's flag does. */
	readonly effectVolume: number;
}

/** Where the listener is and which way its right hand points. */
export interface AudioListener {
	/** Scene space, so the listener survives the render anchor moving underneath it. */
	readonly position: SceneVector3;
	/** A direction, which the anchor's pure translation cannot affect. */
	readonly right: RenderVector3;
}

/** One authored sound request, already resolved to a concrete asset. */
export interface AudioTrigger {
	readonly soundId: DatAssetId;
	/** Play chance rolled once at trigger time. */
	readonly probability: number;
	readonly volume: number;
	/** Scene space, matching the listener; spatialization is purely relative. */
	readonly position: SceneVector3;
}

export type AudioTriggerOutcome =
	"played" | "lost-probability-roll" | "inaudible" | "device-refused";

/**
 * Why triggers did not become sound, counted separately.
 *
 * One counter per outcome, because "suppressed" spans causes with nothing in common: an authored
 * probability that declined to play is correct behaviour, a trigger below the audible floor points
 * at the listener pose, and a refused device points at the device. Conflating them makes silence
 * undiagnosable, which is exactly what happened.
 */
export interface AudioDiagnostics {
	readonly activeVoiceCount: number;
	readonly playedCount: number;
	readonly stolenCount: number;
	/** Declined by the authored probability roll before any spatial work. */
	readonly lostProbabilityRollCount: number;
	/** Below retail's audible floor for the current listener pose. */
	readonly inaudibleCount: number;
	/** Placed audibly, but the device had no buffer ready; each of these is warmed and retried. */
	readonly deviceRefusedCount: number;
	/** Refused once, then decoded and played in time. A subset of `playedCount`. */
	readonly warmedPlayedCount: number;
	/** Refused, then decoded too late for the moment it belonged to. */
	readonly warmupExpiredCount: number;
	/** Refused, then refused again after `prepare` resolved: the device broke its contract. */
	readonly warmupRefusedCount: number;
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
	readonly #clock: () => number;
	readonly #maximumWarmupReplaySeconds: number;
	#playedCount = 0;
	#stolenCount = 0;
	#lostProbabilityRollCount = 0;
	#inaudibleCount = 0;
	#deviceRefusedCount = 0;
	#warmedPlayedCount = 0;
	#warmupExpiredCount = 0;
	#warmupRefusedCount = 0;
	#destroyed = false;
	#settings: AudioSettings = { effectVolume: 1 };
	#listener: AudioListener = {
		// The scene origin facing +X, which is only ever right by accident. A frontend that wants
		// audible sound must place the listener; `inaudibleCount` reports when it has not.
		position: sceneVector3([0, 0, 0]),
		right: renderVector3([1, 0, 0]),
	};

	/**
	 * @param voiceLimit Maximum simultaneous voices; the oldest is stolen when the budget is full.
	 * Retail runs 16 voices with priority-based stealing, but hook sounds all carry priority 0 and
	 * lose every contest, so a plain oldest-steal is the same behavior with less machinery.
	 */
	constructor(
		device: AudioDevice,
		roll: () => number,
		voiceLimit: number,
		clock: () => number,
		maximumWarmupReplaySeconds: number,
	) {
		if (!Number.isInteger(voiceLimit) || voiceLimit <= 0)
			throw new Error("Audio voice limit must be a positive integer.");
		if (!(maximumWarmupReplaySeconds >= 0))
			throw new Error("Audio warmup replay bound must be non-negative.");
		this.#device = device;
		this.#roll = roll;
		this.#voiceLimit = voiceLimit;
		this.#clock = clock;
		this.#maximumWarmupReplaySeconds = maximumWarmupReplaySeconds;
	}

	setListener(listener: AudioListener): void {
		this.#listener = listener;
	}

	/** Apply user audio settings, which scale gain and therefore range, as retail's do. */
	setSettings(settings: AudioSettings): void {
		if (!(settings.effectVolume >= 0 && settings.effectVolume <= 1)) {
			throw new Error("Effect volume must be within [0, 1].");
		}
		this.#settings = settings;
	}

	/** Roll, place, and play one authored sound, reporting exactly what happened. */
	trigger(trigger: AudioTrigger): AudioTriggerOutcome {
		// Retail rolls the probability before doing any spatial work at all.
		if (trigger.probability < 1 && this.#roll() >= trigger.probability) {
			this.#lostProbabilityRollCount += 1;
			return "lost-probability-roll";
		}
		const placement = placeSpatialAudio(
			trigger.position,
			this.#listener.position,
			this.#listener.right,
			trigger.volume,
			this.#settings.effectVolume,
		);
		// Below retail's audible floor the sound is not played at all, rather than played silently.
		if (placement === null) {
			this.#inaudibleCount += 1;
			return "inaudible";
		}
		this.#claimVoiceSlot();
		const voice = this.#device.playOneShot(
			trigger.soundId,
			placement.gain,
			placement.pan,
		);
		if (voice === null) {
			// The buffer is not decoded yet. Warm it and replay, rather than dropping the sound
			// outright: the same path serves authored hooks and anything the network triggers
			// later, neither of which can be enumerated ahead of time.
			this.#warmAndReplay(trigger.soundId, placement, this.#clock());
			this.#deviceRefusedCount += 1;
			return "device-refused";
		}
		this.#voices.push(voice);
		this.#playedCount += 1;
		return "played";
	}

	/**
	 * Decode a cold sound, then play it once if the moment has not passed.
	 *
	 * Gain and pan are the ones resolved at trigger time, which is retail's rule: spatial
	 * parameters are fixed when the sound fires and never updated, so replaying with them is the
	 * same sound arriving late rather than a differently-placed one.
	 */
	#warmAndReplay(
		soundId: DatAssetId,
		placement: SpatialAudioPlacement,
		triggeredAt: number,
	): void {
		void this.#device.prepare(soundId).then(() => {
			if (this.#destroyed) return;
			if (this.#clock() - triggeredAt > this.#maximumWarmupReplaySeconds) {
				this.#warmupExpiredCount += 1;
				return;
			}
			this.#claimVoiceSlot();
			const voice = this.#device.playOneShot(
				soundId,
				placement.gain,
				placement.pan,
			);
			if (voice === null) {
				// `prepare` resolving is the device's promise that `playOneShot` will accept, so
				// reaching here means the device broke that contract rather than being late.
				this.#warmupRefusedCount += 1;
				return;
			}
			this.#voices.push(voice);
			this.#playedCount += 1;
			this.#warmedPlayedCount += 1;
		});
	}

	/**
	 * Retire voices that ended on their own, then steal the oldest if the budget is still full.
	 *
	 * Sweeping here rather than continuously is deliberate: the budget is read at exactly this
	 * instant, and a voice that finished between triggers is not competing with anything until now.
	 */
	#claimVoiceSlot(): void {
		for (let index = this.#voices.length - 1; index >= 0; index -= 1) {
			if (this.#voices[index]!.finished) this.#voices.splice(index, 1);
		}
		if (this.#voices.length < this.#voiceLimit) return;
		this.#voices.shift()?.stop();
		this.#stolenCount += 1;
	}

	/**
	 * Stop everything, for runtime shutdown only.
	 *
	 * Deliberately not called on owner removal: voices outlive their owners in retail.
	 */
	destroy(): void {
		this.#destroyed = true;
		for (const voice of this.#voices) voice.stop();
		this.#voices.length = 0;
	}

	getDiagnostics(): AudioDiagnostics {
		return {
			activeVoiceCount: this.#voices.length,
			deviceRefusedCount: this.#deviceRefusedCount,
			warmedPlayedCount: this.#warmedPlayedCount,
			warmupExpiredCount: this.#warmupExpiredCount,
			warmupRefusedCount: this.#warmupRefusedCount,
			inaudibleCount: this.#inaudibleCount,
			lostProbabilityRollCount: this.#lostProbabilityRollCount,
			playedCount: this.#playedCount,
			stolenCount: this.#stolenCount,
		};
	}
}
