import {
	renderVector3,
	sceneVector3,
	type RenderVector3,
	type SceneVector3,
} from "../../assets/ac-frame";
import type { DatAssetId } from "../game-types";
import { placeSpatialAudio } from "./audio-spatialization";
import type { SpatialAudioPlacement } from "./audio-spatialization";

/** A playing voice, from the system's point of view: steerable while it lives. */
export interface AudioVoice {
	stop(): void;
	/**
	 * Update the voice's gain and pan mid-playback.
	 *
	 * Called once per frame while the voice lives; on a finished or stopped voice it is a no-op
	 * rather than an error, because the system sweeps lazily and a race here has no consequence.
	 */
	setPlacement(gain: number, pan: number): void;
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
 * Where a sound's gain and pan come from, for its whole playback.
 *
 * A discriminated union so the illegal states cannot be spelled: an ordinary world sound has a
 * fixed emitting point and authored volume; a live world sound keeps that point but reads a live
 * volume owned by its producer; a listener-locked bed has neither a world position nor fixed gain.
 * The live variants are re-read on each audio-control tick, so withdrawing their producer's
 * eligibility silences an existing voice rather than merely suppressing the next trigger.
 */
export type AudioPlacementSource =
	| {
			readonly mode: "world";
			/** Scene space, matching the listener; spatialization is purely relative. */
			readonly position: SceneVector3;
			readonly volume: number;
	  }
	| {
			readonly mode: "world-live";
			/** Fixed scene-space point sampled when the authored sound command fired. */
			readonly position: SceneVector3;
			/** Live authored gain after producer-owned eligibility policy. */
			readonly volume: () => number;
	  }
	| {
			readonly mode: "listener";
			/**
			 * Live gain for a head-locked sound, read on each control tick and at trigger time.
			 *
			 * A supplier rather than a number because the value belongs to its producer — ambient
			 * share re-weighted as the listener moves — and reads `0` once that producer retires it,
			 * which fades the voice out instead of stranding it at its last gain.
			 */
			readonly volume: () => number;
	  };

/**
 * A playing voice plus the facts needed to re-place it on each audio-control tick.
 *
 * Facts, not derived results: gain and pan are recomputed from these against the current listener,
 * never stored. A world position is the emitting point sampled at trigger time — voices deliberately
 * do not follow their emitters, only the listener.
 */
interface LiveVoice {
	readonly voice: AudioVoice;
	readonly source: AudioPlacementSource;
	readonly category: AudioCategory;
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
	/** Exact decoder-ready payload bytes retained for one prepared sound, when observable. */
	getPreparedSourceBytes?(soundId: DatAssetId): number | null;
}

/**
 * Retail sound categories we produce, each with its own user volume.
 *
 * Retail carries a third, interface, for UI sound; it appears when its producer does.
 */
export type AudioCategory = "effect" | "ambient";

/**
 * User audio settings, one entry per retail sound category we produce.
 *
 * Authored hook sounds are effect sounds (`SoundManager::PlaySoundA` gates on
 * `effect_sounds_enabled` and passes `is_ambient = 0`); region-driven ambience is its own category
 * with its own slider, as retail's options screen has.
 */
export interface AudioSettings {
	/** Linear multiplier on effect gain in [0, 1]; zero silences the category as retail's flag does. */
	readonly effectVolume: number;
	/**
	 * Linear multiplier on ambient gain in [0, 1].
	 *
	 * RETAIL DIVERGENCE: retail applies this **twice**. `PlayAmbientSound` pre-multiplies its volume
	 * by `ambient_sound_volume` (acclient.c:366824) and also passes `is_ambient = 1`, so
	 * `GetAttenuation` multiplies by it a second time (acclient.c:366440) — a half-volume setting
	 * yields a quarter of the gain. We apply it once, giving a linear slider.
	 *
	 * Safe to depart from: this is a user setting rather than authored content, so no content can
	 * observe the difference, and the doubling is a defect rather than a tuning choice — the same
	 * `GetAttenuation` call applies the effect category exactly once for the non-ambient path.
	 */
	readonly ambientVolume: number;
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
	/** Where gain and pan come from, at trigger time and for the whole playback. */
	readonly source: AudioPlacementSource;
	/** Selects which user volume scales this sound; retail's `is_ambient` as a name rather than a flag. */
	readonly category: AudioCategory;
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
	/**
	 * Below retail's audible floor for the listener pose at the moment of placement — at trigger
	 * time, or at replay time for a warmed sound whose listener moved out of earshot mid-decode.
	 */
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
 * that produces triggers through the same door.
 *
 * RETAIL DIVERGENCE: retail never updates a playing voice's spatial parameters. `GetAttenuation`
 * has exactly four call sites in the whole binary (acclient.c:366516, 366859, 366879, 366904),
 * every one inside a sound-*starting* function; gain and pan were fixed at trigger time for the
 * voice's whole life. We re-place every live voice against the current listener on a bounded
 * audio-control cadence (`updatePlacements`). Safe to depart: no shipped content can depend on a
 * sound *failing* to track a
 * listener — the difference is pure presentation — and a free-flying camera makes frozen placement
 * audibly wrong within a single multi-second voice. The 1999 constraint (DirectSound buffers, CPU
 * budget) no longer applies.
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
	readonly #voices: LiveVoice[] = [];
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
	#settings: AudioSettings = { ambientVolume: 1, effectVolume: 1 };
	#listener: AudioListener = {
		// The scene origin facing +X, which is only ever right by accident. A frontend that wants
		// audible sound must place the listener; `inaudibleCount` reports when it has not.
		position: sceneVector3([0, 0, 0]),
		right: renderVector3([1, 0, 0]),
	};

	/**
	 * @param voiceLimit Maximum simultaneous voices; the quietest is stolen when the budget is
	 * full (see `#claimVoiceSlot` for the divergence from retail's priority-and-age stealing).
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
		for (const [category, volume] of [
			["Effect", settings.effectVolume],
			["Ambient", settings.ambientVolume],
		] as const) {
			if (!(volume >= 0 && volume <= 1)) {
				throw new Error(`${category} volume must be within [0, 1].`);
			}
		}
		this.#settings = settings;
	}

	/** The user volume for one category, which is the only thing the category selects. */
	#categoryVolume(category: AudioCategory): number {
		return category === "ambient"
			? this.#settings.ambientVolume
			: this.#settings.effectVolume;
	}

	/** Roll, place, and play one authored sound, reporting exactly what happened. */
	trigger(trigger: AudioTrigger): AudioTriggerOutcome {
		// Retail rolls the probability before doing any spatial work at all.
		if (trigger.probability < 1 && this.#roll() >= trigger.probability) {
			this.#lostProbabilityRollCount += 1;
			return "lost-probability-roll";
		}
		const placement = this.#place(trigger.source, trigger.category);
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
			this.#warmAndReplay(trigger, this.#clock());
			this.#deviceRefusedCount += 1;
			return "device-refused";
		}
		this.#retain(voice, trigger);
		return "played";
	}

	/** Play a head-locked UI/effect sound while a frontend temporarily owns no listener pose. */
	triggerListenerLocked(
		soundId: DatAssetId,
		volume = 1,
		probability = 1,
	): AudioTriggerOutcome {
		if (!(Number.isFinite(volume) && volume >= 0)) {
			throw new Error(
				"Listener-locked sound volume must be finite and non-negative.",
			);
		}
		return this.trigger({
			category: "effect",
			probability,
			soundId,
			source: { mode: "listener", volume: () => volume },
		});
	}

	/** Record a started voice with the facts `updatePlacements` re-places it from. */
	#retain(voice: AudioVoice, trigger: AudioTrigger): void {
		this.#voices.push({
			category: trigger.category,
			source: trigger.source,
			voice,
		});
		this.#playedCount += 1;
	}

	/**
	 * One placement from one source, against the listener as it is right now.
	 *
	 * A listener-locked source is placed at the listener's own position, which lands in the flat
	 * radius — full supplied gain, zero pan — without any special case in the retail curve.
	 */
	#place(
		source: AudioPlacementSource,
		category: AudioCategory,
	): SpatialAudioPlacement | null {
		const listener = this.#listener;
		let sourcePosition: SceneVector3;
		let sourceVolume: number;
		switch (source.mode) {
			case "world":
				sourcePosition = source.position;
				sourceVolume = source.volume;
				break;
			case "world-live":
				sourcePosition = source.position;
				sourceVolume = source.volume();
				break;
			case "listener":
				sourcePosition = listener.position;
				sourceVolume = source.volume();
				break;
		}
		return placeSpatialAudio(
			sourcePosition,
			listener.position,
			listener.right,
			sourceVolume,
			this.#categoryVolume(category),
		);
	}

	/**
	 * Re-place every live voice against the current listener on one audio-control tick.
	 *
	 * Takes no clock: placement is a pure function of the listener pose and settings as they are
	 * right now. A voice that has receded below the audible floor is silenced rather than stopped —
	 * a free-flying camera routinely leaves and re-enters earshot, and stopping would make the
	 * return trip silently lossy.
	 */
	updatePlacements(): void {
		this.#sweepFinishedVoices();
		for (const live of this.#voices) {
			const placement = this.#place(live.source, live.category);
			live.voice.setPlacement(placement?.gain ?? 0, placement?.pan ?? 0);
		}
	}

	/** Fade live voices to silence while a presentation mode owns no listener. */
	silence(): void {
		this.#sweepFinishedVoices();
		for (const live of this.#voices) live.voice.setPlacement(0, 0);
	}

	/** Retire voices that ended on their own; shared by the control path and the budget path. */
	#sweepFinishedVoices(): void {
		for (let index = this.#voices.length - 1; index >= 0; index -= 1) {
			if (this.#voices[index]!.voice.finished) this.#voices.splice(index, 1);
		}
	}

	/**
	 * Decode a cold sound, then play it once if the moment has not passed.
	 *
	 * Placement is computed at replay time from the trigger's facts, not carried from the trigger:
	 * the listener may have moved during the decode, and a voice must start where it would already
	 * have been steered to. A sound that fell below the audible floor during the decode is not
	 * started — the same gate the trigger applies, at the moment that now matters.
	 */
	#warmAndReplay(trigger: AudioTrigger, triggeredAt: number): void {
		void this.#device.prepare(trigger.soundId).then(() => {
			if (this.#destroyed) return;
			if (this.#clock() - triggeredAt > this.#maximumWarmupReplaySeconds) {
				this.#warmupExpiredCount += 1;
				return;
			}
			const placement = this.#place(trigger.source, trigger.category);
			if (placement === null) {
				this.#inaudibleCount += 1;
				return;
			}
			this.#claimVoiceSlot();
			const voice = this.#device.playOneShot(
				trigger.soundId,
				placement.gain,
				placement.pan,
			);
			if (voice === null) {
				// `prepare` resolving is the device's promise that `playOneShot` will accept, so
				// reaching here means the device broke that contract rather than being late.
				this.#warmupRefusedCount += 1;
				return;
			}
			this.#retain(voice, trigger);
			this.#warmedPlayedCount += 1;
		});
	}

	/**
	 * Retire voices that ended on their own, then steal the quietest if the budget is still full.
	 *
	 * RETAIL DIVERGENCE: retail steals by priority and age. Stealing by *current gain* — which the
	 * retained facts let us compute at this instant — cuts the voice contributing least to the mix,
	 * so an overflow is as close to inaudible as a steal can be; a voice already silenced below the
	 * audible floor is the ideal victim. Ties go to the oldest, which preserves retail's behavior
	 * exactly when every contender is equally loud.
	 *
	 * Sweeping here rather than continuously is deliberate: the budget is read at exactly this
	 * instant, and a voice that finished between triggers is not competing with anything until now.
	 */
	#claimVoiceSlot(): void {
		this.#sweepFinishedVoices();
		if (this.#voices.length < this.#voiceLimit) return;
		let quietestIndex = 0;
		let quietestGain = Infinity;
		for (let index = 0; index < this.#voices.length; index += 1) {
			const live = this.#voices[index]!;
			const gain = this.#place(live.source, live.category)?.gain ?? 0;
			// Strict comparison: the earliest voice at the minimum wins, so equal-gain contests
			// steal the oldest.
			if (gain < quietestGain) {
				quietestGain = gain;
				quietestIndex = index;
			}
		}
		this.#voices.splice(quietestIndex, 1)[0]?.voice.stop();
		this.#stolenCount += 1;
	}

	/**
	 * Stop everything, for runtime shutdown only.
	 *
	 * Deliberately not called on owner removal: voices outlive their owners in retail.
	 */
	destroy(): void {
		this.#destroyed = true;
		for (const live of this.#voices) live.voice.stop();
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
