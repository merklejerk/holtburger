import type { SceneVector3 } from "../../assets/ac-frame";
import type { DatAssetId } from "../game-types";
import type {
	AudioPlacementSource,
	AudioTrigger,
	AudioTriggerOutcome,
} from "./audio-system";
import type { UniformRoll } from "./particle-system";
import { AMBIENT_MIN_VOLUME } from "./ambient-weighting";
import { placeAmbientSound, type AmbientScanResult } from "./ambient-scan";
import type {
	AmbientDirection,
	AmbientDistanceBand,
} from "./ambient-weighting";

/**
 * Region ambience on its own clock, driven by what the surrounding terrain authors.
 *
 * A producer rather than an audio system: every sound it schedules leaves through the same
 * `AudioSystem.trigger` an authored hook sound does, in the `ambient` category. Retail models the two
 * descriptor kinds as subclasses (`IntermitSound` and `ConstantSound`, acclient.c:367217-367300);
 * they differ in so little — what the surroundings scale, whether a chance is rolled, and how the
 * interval is drawn — that one record with a branch is a fairer description than two classes.
 */

/**
 * One candidate chosen from a descriptor's sound table, ready to play.
 *
 * Deliberately carries no volume. The ambient path reads only the candidate's `probability`
 * (`stdata.probability_`) and plays at the *descriptor's* volume: `PlayAmbientSound` passes its own
 * `volume` argument straight to `PlaySoundInternal`, which never consults the table entry's gain
 * (acclient.c:366813 and 366489). Applying both would attenuate every ambient sound twice.
 */
interface AmbientSoundSelection {
	readonly soundId: DatAssetId;
	/** The table candidate's own play chance, which retail rolls in `PlayAmbientSound`. */
	readonly probability: number;
}

export interface AmbientSystemDependencies {
	readonly roll: UniformRoll;
	/** Resolve a descriptor's `SoundType` against its table, or `null` while the table is unstaged. */
	readonly resolveSound: (
		soundTableId: DatAssetId,
		soundType: number,
	) => AmbientSoundSelection | null;
	readonly play: (trigger: AudioTrigger) => AudioTriggerOutcome;
	/** Where an intermittent firing is placed relative to; the listener as of this frame. */
	readonly listenerPosition: () => SceneVector3;
	/**
	 * Fill `outWeights` with each slot's presence weight from the current listener; returns the
	 * total. Pure wiring to the baked terrain — the indoor gate is applied here, by the system,
	 * through `listenerHearsOutdoors`.
	 */
	readonly accumulateWeights: (outWeights: Float32Array) => number;
	/**
	 * Whether outdoor terrain ambience reaches the listener where it stands (retail's
	 * `SeenOutside` gate). One fact consumed by both cadences — the schedule and the per-frame bed
	 * weights — so the two can never disagree about being indoors; a bed fades at the dungeon door
	 * instead of following the listener in.
	 */
	readonly listenerHearsOutdoors: () => boolean;
}

/** One scheduled descriptor: what the scan found, plus when it next comes due. */
interface ScheduledAmbient {
	/** The descriptor's region-assigned slot, its identity across scan, schedule, and weights. */
	readonly slot: number;
	readonly soundTableId: DatAssetId;
	readonly soundType: number;
	readonly isContinuous: boolean;
	readonly minRate: number;
	readonly maxRate: number;
	/**
	 * The descriptor's authored volume: an intermittent firing's gain as-is, and the value live
	 * share re-scales each frame for a playing bed. Crossing-time share never persists here — it
	 * drives only the discrete audibility and retirement decisions inside `refresh`.
	 */
	readonly authoredVolume: number;
	/** Weighted play chance for an intermittent sound; unused by a continuous one, which always plays. */
	playChance: number;
	/** Clock time this descriptor next comes due. */
	dueAt: number;
	/**
	 * Per-direction distance bands from the most recent scan, rolled anew on every firing.
	 *
	 * Empty for a continuous descriptor, which retail plays centred; refreshed rather than retained,
	 * so a sound follows the ground as the listener moves through it.
	 */
	directions: ReadonlyMap<AmbientDirection, AmbientDistanceBand>;
}

export interface AmbientDiagnostics {
	readonly scheduledCount: number;
	/**
	 * Descriptors sent to the audio system, whatever became of them there.
	 *
	 * Separate from `playedCount` because conflating them makes silence undiagnosable: a scheduler
	 * that never fires and one whose every firing is judged inaudible are different faults with
	 * different causes, and counting only the sound that came out cannot tell them apart.
	 */
	readonly firedCount: number;
	readonly playedCount: number;
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
	readonly #scheduled = new Map<number, ScheduledAmbient>();
	/**
	 * Per-slot presence weights recomputed each `advance`, sized to the region's slot registry.
	 *
	 * `null` until a region installs; a bed supplier reading it then is a schedule that outlived
	 * its region, which `resetForRegion` prevents by clearing the schedule with the buffer.
	 */
	#liveWeights: Float32Array | null = null;
	/** Total of `#liveWeights` from the same pass; zero when nothing (or nothing outdoors) is heard. */
	#liveTotalWeight = 0;
	/** Continuous descriptors currently scheduled, maintained by `refresh`, read every frame. */
	#continuousScheduledCount = 0;
	#firedCount = 0;
	#playedCount = 0;
	#suppressedCount = 0;
	#unresolvedCount = 0;
	#retiredCount = 0;

	constructor(dependencies: AmbientSystemDependencies) {
		this.#dependencies = dependencies;
	}

	/**
	 * Adopt a freshly installed region's slot space.
	 *
	 * Clears the schedule outright: slots are meaningful only within one region's registry, and a
	 * surviving entry would silently mean a different sound. A bed still playing reads `0` from its
	 * supplier the moment its slot is gone, so old-region ambience fades rather than strands.
	 */
	resetForRegion(slotCount: number): void {
		this.#scheduled.clear();
		this.#continuousScheduledCount = 0;
		this.#liveWeights = new Float32Array(slotCount);
		this.#liveTotalWeight = 0;
	}

	/**
	 * Apply a fresh scan: re-weight what is still audible, schedule what has become audible, and
	 * retire what no longer has a contributor.
	 *
	 * Weights change as the listener moves, so this is where the surroundings reach the schedule.
	 * A descriptor that survives keeps its clock, so walking past a river does not restart its sound.
	 */
	refresh(scan: AmbientScanResult, timeSeconds: number): void {
		for (const [slot, accumulation] of scan.accumulations) {
			const { descriptor } = accumulation;
			// `total_weight` normalizes each descriptor's share of the surroundings
			// (`UpdateSound`, acclient.c:367445 and 367532).
			const share =
				scan.totalWeight > 0 ? accumulation.soundCount / scan.totalWeight : 0;
			const existing = this.#scheduled.get(slot);
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
					this.#scheduled.delete(slot);
					this.#retiredCount += 1;
				}
				continue;
			}
			if (existing) {
				existing.playChance = playChance;
				existing.directions = accumulation.directions;
				continue;
			}
			this.#scheduled.set(slot, {
				authoredVolume: descriptor.volume,
				dueAt:
					timeSeconds +
					this.#interval(
						descriptor.isContinuous,
						descriptor.minRate,
						descriptor.maxRate,
					),
				directions: accumulation.directions,
				isContinuous: descriptor.isContinuous,
				slot,
				maxRate: descriptor.maxRate,
				minRate: descriptor.minRate,
				playChance,
				soundTableId: descriptor.soundTableId as DatAssetId,
				soundType: descriptor.soundType,
			});
		}

		for (const slot of [...this.#scheduled.keys()]) {
			if (scan.accumulations.has(slot)) continue;
			this.#scheduled.delete(slot);
			this.#retiredCount += 1;
		}
		// Recomputed once per crossing so the per-frame weight gate is a single integer test.
		let continuousCount = 0;
		for (const scheduled of this.#scheduled.values()) {
			if (scheduled.isContinuous) continuousCount += 1;
		}
		this.#continuousScheduledCount = continuousCount;
	}

	/** Refresh live bed weights, then fire every descriptor that has come due and re-arm it. */
	advance(timeSeconds: number): void {
		this.#refreshLiveWeights();
		for (const scheduled of this.#scheduled.values()) {
			if (scheduled.dueAt > timeSeconds) continue;
			this.#fire(scheduled);
			this.#rearm(scheduled, timeSeconds);
		}
	}

	/**
	 * Recompute per-slot weights for playing beds, once per frame.
	 *
	 * Skipped entirely while no continuous descriptor is scheduled: intermittent sounds read their
	 * share at crossing time, so the per-frame pass would feed nothing.
	 */
	#refreshLiveWeights(): void {
		const weights = this.#liveWeights;
		if (weights === null) return;
		if (
			this.#continuousScheduledCount === 0 ||
			!this.#dependencies.listenerHearsOutdoors()
		) {
			// Suppliers read through the total, so zeroing it silences every bed without touching
			// the (stale, unread) weight buffer.
			this.#liveTotalWeight = 0;
			return;
		}
		this.#liveTotalWeight = this.#dependencies.accumulateWeights(weights);
	}

	/**
	 * A playing bed's gain right now: authored volume scaled by this frame's share.
	 *
	 * Reads through the schedule so a retired or region-cleared slot yields `0` and the voice fades
	 * out, rather than holding its last gain with no source behind it.
	 */
	#liveBedVolume(slot: number): number {
		const scheduled = this.#scheduled.get(slot);
		const weights = this.#liveWeights;
		if (!scheduled || weights === null || this.#liveTotalWeight <= 0) return 0;
		const weight = weights[slot] ?? 0;
		return (scheduled.authoredVolume * weight) / this.#liveTotalWeight;
	}

	getDiagnostics(): AmbientDiagnostics {
		return {
			firedCount: this.#firedCount,
			playedCount: this.#playedCount,
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
			probability: selection.probability,
			soundId: selection.soundId,
			source: this.#source(scheduled),
		});
		this.#firedCount += 1;
		if (outcome === "played") this.#playedCount += 1;
	}

	/**
	 * How one firing is placed: a bed is head-locked with live share as its gain, an intermittent
	 * sound lands inside the ground that authored it.
	 *
	 * One decision for mode and position, so they cannot disagree — the old shape synthesized a fake
	 * position at the listener for the continuous case, which live tracking would have dragged
	 * audibly behind a moving camera.
	 *
	 * Intermittent placement is rolled per firing rather than per scan, so successive calls of the
	 * same bird come from different points within the same stretch of forest.
	 */
	#source(scheduled: ScheduledAmbient): AudioPlacementSource {
		if (scheduled.isContinuous) {
			return {
				mode: "listener",
				volume: () => this.#liveBedVolume(scheduled.slot),
			};
		}
		const position = placeAmbientSound(
			scheduled.directions,
			this.#dependencies.listenerPosition(),
			this.#dependencies.roll,
		);
		if (position === null) {
			// An intermittent descriptor is only scheduled with contributors, and every contributor
			// widens at least one band; an empty placement here is a scan invariant broken.
			throw new Error(
				`Scheduled intermittent ambient slot ${scheduled.slot} has no directional contributors.`,
			);
		}
		return { mode: "world", position, volume: scheduled.authoredVolume };
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
