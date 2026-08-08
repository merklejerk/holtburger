import type { SceneVector3 } from "../../assets/ac-frame";
import type { DatAssetId } from "../game-types";
import type { AudioTrigger, AudioTriggerOutcome } from "./audio-system";
import type { UniformRoll } from "./particle-system";
import { AMBIENT_MIN_VOLUME } from "./ambient-weighting";
import type { AmbientScanResult } from "./ambient-scan";

/**
 * Region ambience on its own clock, driven by what the surrounding terrain authors.
 *
 * A producer rather than an audio system: every sound it schedules leaves through the same
 * `AudioSystem.trigger` an authored hook sound does, in the `ambient` category. Retail models the two
 * descriptor kinds as subclasses (`IntermitSound` and `ConstantSound`, acclient.c:367217-367300);
 * they differ in so little — what the surroundings scale, whether a chance is rolled, and how the
 * interval is drawn — that one record with a branch is a fairer description than two classes.
 */

/** One candidate chosen from a descriptor's sound table, ready to play. */
interface AmbientSoundSelection {
	readonly soundId: DatAssetId;
	/** The table candidate's own play chance, which retail rolls in `PlayAmbientSound`. */
	readonly probability: number;
	/** The candidate's authored gain, before the descriptor's own volume scales it. */
	readonly volume: number;
}

export interface AmbientSystemDependencies {
	readonly roll: UniformRoll;
	/** Resolve a descriptor's `SoundType` against its table, or `null` while the table is unstaged. */
	readonly resolveSound: (
		soundTableId: DatAssetId,
		soundType: number,
	) => AmbientSoundSelection | null;
	readonly play: (trigger: AudioTrigger) => AudioTriggerOutcome;
	/** Where to centre a sound that has no direction of its own. */
	readonly listenerPosition: () => SceneVector3;
}

/** One scheduled descriptor: what the scan found, plus when it next comes due. */
interface ScheduledAmbient {
	readonly key: string;
	readonly soundTableId: DatAssetId;
	readonly soundType: number;
	readonly isContinuous: boolean;
	readonly minRate: number;
	readonly maxRate: number;
	/**
	 * Gain for a continuous sound, or the authored volume for an intermittent one.
	 *
	 * The surroundings scale exactly one of gain and probability, never both: a constant sound gets
	 * louder where more of the ground authors it, an intermittent one gets likelier.
	 */
	volume: number;
	/** Weighted play chance for an intermittent sound; unused by a continuous one, which always plays. */
	playChance: number;
	/** Clock time this descriptor next comes due. */
	dueAt: number;
}

export interface AmbientDiagnostics {
	readonly scheduledCount: number;
	readonly firedCount: number;
	/** Due descriptors that lost their chance roll, which is correct behaviour rather than a fault. */
	readonly suppressedCount: number;
	/** Due descriptors whose sound table had not staged yet. */
	readonly unresolvedCount: number;
	readonly retiredCount: number;
}

/**
 * How far behind schedule a descriptor may fall before its clock resynchronizes.
 *
 * Intervals advance by whole steps rather than from "now", so a continuous sound authored at exactly
 * its wave's length stays seamless instead of accumulating a gap per fire. That only works while the
 * clock is being served; after a stall, replaying every missed fire would burst. One interval of
 * slack absorbs ordinary jitter and anything worse restarts the cadence.
 */
const MAXIMUM_SCHEDULE_LAG_INTERVALS = 1;

export class AmbientSystem {
	readonly #dependencies: AmbientSystemDependencies;
	readonly #scheduled = new Map<string, ScheduledAmbient>();
	#firedCount = 0;
	#suppressedCount = 0;
	#unresolvedCount = 0;
	#retiredCount = 0;

	constructor(dependencies: AmbientSystemDependencies) {
		this.#dependencies = dependencies;
	}

	/**
	 * Apply a fresh scan: re-weight what is still audible, schedule what has become audible, and
	 * retire what no longer has a contributor.
	 *
	 * Weights change as the listener moves, so this is where the surroundings reach the schedule.
	 * A descriptor that survives keeps its clock, so walking past a river does not restart its sound.
	 */
	refresh(scan: AmbientScanResult, timeSeconds: number): void {
		for (const [key, accumulation] of scan.accumulations) {
			const { descriptor } = accumulation;
			// `total_weight` normalizes each descriptor's share of the surroundings
			// (`UpdateSound`, acclient.c:367445 and 367532).
			const share =
				scan.totalWeight > 0 ? accumulation.soundCount / scan.totalWeight : 0;
			const existing = this.#scheduled.get(key);
			const volume = descriptor.isContinuous
				? descriptor.volume * share
				: descriptor.volume;
			const playChance = descriptor.isContinuous
				? 1
				: descriptor.baseChance * share;
			// Retail's `CanHear`: a constant sound below the audible floor is not scheduled at all,
			// and an intermittent one with no chance can never fire.
			const audible = descriptor.isContinuous
				? volume >= AMBIENT_MIN_VOLUME
				: playChance > 0;
			if (!audible) {
				if (existing) {
					this.#scheduled.delete(key);
					this.#retiredCount += 1;
				}
				continue;
			}
			if (existing) {
				existing.volume = volume;
				existing.playChance = playChance;
				continue;
			}
			this.#scheduled.set(key, {
				dueAt:
					timeSeconds +
					this.#interval(
						descriptor.isContinuous,
						descriptor.minRate,
						descriptor.maxRate,
					),
				isContinuous: descriptor.isContinuous,
				key,
				maxRate: descriptor.maxRate,
				minRate: descriptor.minRate,
				playChance,
				soundTableId: descriptor.soundTableId as DatAssetId,
				soundType: descriptor.soundType,
				volume,
			});
		}

		for (const key of [...this.#scheduled.keys()]) {
			if (scan.accumulations.has(key)) continue;
			this.#scheduled.delete(key);
			this.#retiredCount += 1;
		}
	}

	/** Fire every descriptor that has come due, and re-arm it. */
	advance(timeSeconds: number): void {
		for (const scheduled of this.#scheduled.values()) {
			if (scheduled.dueAt > timeSeconds) continue;
			this.#fire(scheduled);
			this.#rearm(scheduled, timeSeconds);
		}
	}

	getDiagnostics(): AmbientDiagnostics {
		return {
			firedCount: this.#firedCount,
			retiredCount: this.#retiredCount,
			scheduledCount: this.#scheduled.size,
			suppressedCount: this.#suppressedCount,
			unresolvedCount: this.#unresolvedCount,
		};
	}

	#fire(scheduled: ScheduledAmbient): void {
		// A continuous sound has no chance to roll; an intermittent one rolls its weighted chance
		// (`IntermitSound::PlayNow`, acclient.c:367217).
		if (
			!scheduled.isContinuous &&
			this.#dependencies.roll() > scheduled.playChance
		) {
			this.#suppressedCount += 1;
			return;
		}
		const selection = this.#dependencies.resolveSound(
			scheduled.soundTableId,
			scheduled.soundType,
		);
		if (!selection) {
			this.#unresolvedCount += 1;
			return;
		}
		const outcome = this.#dependencies.play({
			category: "ambient",
			// Centred on the listener; intermittent sounds gain their own direction in 10.5.
			position: this.#dependencies.listenerPosition(),
			probability: selection.probability,
			soundId: selection.soundId,
			volume: selection.volume * scheduled.volume,
		});
		if (outcome === "played") this.#firedCount += 1;
	}

	#rearm(scheduled: ScheduledAmbient, timeSeconds: number): void {
		const interval = this.#interval(
			scheduled.isContinuous,
			scheduled.minRate,
			scheduled.maxRate,
		);
		const advanced = scheduled.dueAt + interval;
		scheduled.dueAt =
			advanced < timeSeconds - interval * MAXIMUM_SCHEDULE_LAG_INTERVALS
				? timeSeconds + interval
				: advanced;
	}

	/**
	 * Seconds until this descriptor next comes due.
	 *
	 * A continuous sound uses its flat `min_rate` and never rolls (`ConstantSound::GetPlayInterval`,
	 * acclient.c:367280); an intermittent one rolls across the authored range.
	 */
	#interval(isContinuous: boolean, minRate: number, maxRate: number): number {
		if (isContinuous) return Math.max(0, minRate);
		const span = Math.max(0, maxRate - minRate);
		return Math.max(0, minRate + this.#dependencies.roll() * span);
	}
}
