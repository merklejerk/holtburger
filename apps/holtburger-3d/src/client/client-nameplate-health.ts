import {
	compareFactsPriority,
	type AppraisalRequest,
	type FactsAppraisalPriority,
} from "./client-appraisal-requests";
import type {
	ClientCombatMode,
	ClientEntityCombatObserved,
	ClientEntityHealth,
} from "./client-host-contract";
import type { ClientNameplateHealthTuning } from "./client-tuning-contract";

export interface NameplateHealthCandidate {
	readonly guid: number;
	readonly generation: number;
	readonly isHostileMob: boolean;
	readonly distanceMeters: number | null;
}

export interface NameplateHealthUpdate {
	readonly guid: number;
	readonly healthFraction: number | null;
}

interface StoredHealth {
	readonly worldGeneration: number;
	readonly instanceSequence: number;
	readonly fraction: number;
	readonly observedAtMs: number;
}

interface CombatInterestEpisode {
	readonly worldGeneration: number;
	readonly instanceSequence: number;
	untilMs: number;
	bootstrapped: boolean;
	lastRequestAtMs: number | null;
	inFlight: AppraisalRequest | null;
}

function isActiveCombatMode(mode: ClientCombatMode): boolean {
	return mode === "melee" || mode === "missile" || mode === "magic";
}

function clampHealthFraction(fraction: number): number {
	if (!Number.isFinite(fraction)) return 0;
	return Math.max(0, Math.min(1, fraction));
}

function cancelInFlight(episode: CombatInterestEpisode): void {
	const request = episode.inFlight;
	if (request === null) return;
	episode.inFlight = null;
	request.cancel();
}

/**
 * Coordinates combat-relevant nameplate health visibility and prioritized background
 * `FactsOnly` refreshes for hostile monsters (most recently attacked by the player,
 * then proximity).
 */
export class ClientNameplateHealth {
	readonly #tuning: ClientNameplateHealthTuning;
	readonly #requestFacts: (
		guid: number,
		priority: FactsAppraisalPriority,
	) => AppraisalRequest;

	#worldGeneration = 0;
	#combatMode: ClientCombatMode = "unknown";
	#combatTargetGuid: number | null = null;
	#selectedTargetGuid: number | null = null;
	#hostOffsetMs: number | null = null;
	#lastHostNowMs = 0;

	readonly #healthByGuid = new Map<number, StoredHealth>();
	readonly #interestByGuid = new Map<number, CombatInterestEpisode>();
	readonly #attackedAtByGuid = new Map<number, number>();
	readonly #displayedByGuid = new Map<number, number>();

	constructor(options: {
		readonly tuning: ClientNameplateHealthTuning;
		readonly requestFacts: (
			guid: number,
			priority: FactsAppraisalPriority,
		) => AppraisalRequest;
	}) {
		this.#tuning = options.tuning;
		this.#requestFacts = options.requestFacts;
	}

	/** Active world generation currently accepted by nameplate health tracking. */
	worldGeneration(): number {
		return this.#worldGeneration;
	}

	/** Reset all retained combat interest and health history across world changes. */
	resetWorld(worldGeneration: number): readonly NameplateHealthUpdate[] {
		this.#worldGeneration = worldGeneration;
		this.#combatTargetGuid = null;
		this.#hostOffsetMs = null;
		this.#lastHostNowMs = 0;
		for (const episode of this.#interestByGuid.values()) {
			cancelInFlight(episode);
		}
		this.#interestByGuid.clear();
		this.#attackedAtByGuid.clear();
		this.#healthByGuid.clear();
		return this.#clearAllDisplayed();
	}

	/** Update active player stance; leaving combat immediately withdraws health bars and polling. */
	setCombatMode(mode: ClientCombatMode): void {
		if (this.#combatMode === mode) return;
		this.#combatMode = mode;
		if (!isActiveCombatMode(mode)) {
			for (const episode of this.#interestByGuid.values()) {
				cancelInFlight(episode);
			}
			this.#interestByGuid.clear();
			this.#attackedAtByGuid.clear();
		}
	}

	/** Update the player's current desired combat target, recording target switches as player attacks. */
	setCombatTarget(targetGuid: number | null, localNowMs?: number): void {
		const previous = this.#combatTargetGuid;
		this.#combatTargetGuid = targetGuid;
		if (
			targetGuid !== null &&
			targetGuid !== previous &&
			localNowMs !== undefined &&
			isActiveCombatMode(this.#combatMode)
		) {
			this.#recordPlayerAttack(targetGuid, this.#syncHostTime(localNowMs));
		}
	}

	setSelectedTarget(targetGuid: number | null): void {
		this.#selectedTargetGuid = targetGuid;
	}

	/** Record an authoritative entity health sample on the shared host timeline. */
	acceptEntityHealth(event: ClientEntityHealth, localNowMs: number): void {
		if (event.worldGeneration !== this.#worldGeneration) return;
		const observedAtMs = this.#syncHostTime(
			localNowMs,
			event.observedAt.seconds,
		);
		const existing = this.#healthByGuid.get(event.guid);
		if (
			existing !== undefined &&
			existing.worldGeneration === event.worldGeneration &&
			existing.instanceSequence === event.instanceSequence &&
			existing.observedAtMs > observedAtMs
		) {
			return;
		}
		this.#healthByGuid.set(event.guid, {
			worldGeneration: event.worldGeneration,
			instanceSequence: event.instanceSequence,
			fraction: clampHealthFraction(event.healthFraction),
			observedAtMs,
		});
		const episode = this.#interestByGuid.get(event.guid);
		if (
			episode !== undefined &&
			episode.worldGeneration === event.worldGeneration &&
			episode.instanceSequence === event.instanceSequence
		) {
			episode.inFlight = null;
		}
	}

	/** Record a player-initiated attack or attributed offensive outcome against `targetGuid`. */
	acceptPlayerAttack(targetGuid: number, localNowMs: number): void {
		const hostNowMs = this.#syncHostTime(localNowMs);
		if (!isActiveCombatMode(this.#combatMode)) return;
		this.#recordPlayerAttack(targetGuid, hostNowMs);
		const existing = this.#interestByGuid.get(targetGuid);
		if (existing !== undefined) {
			existing.untilMs = Math.max(
				existing.untilMs,
				hostNowMs + this.#tuning.combatInterestMs,
			);
		}
	}

	/** Start or extend a hostile mob combat interest episode from combat observation. */
	acceptCombatObserved(
		event: ClientEntityCombatObserved,
		localNowMs: number,
	): void {
		if (event.worldGeneration !== this.#worldGeneration) return;
		const observedAtMs = this.#syncHostTime(
			localNowMs,
			event.observedAt.seconds,
		);
		if (!isActiveCombatMode(this.#combatMode)) return;
		this.#touchInterest(
			event.guid,
			event.instanceSequence,
			observedAtMs + this.#tuning.combatInterestMs,
		);
	}

	/** Clear an inflight background request when core settles it without emitting health. */
	acceptAppraisalFactsSettled(guid: number): void {
		const episode = this.#interestByGuid.get(guid);
		if (
			episode !== undefined &&
			episode.worldGeneration === this.#worldGeneration
		) {
			episode.inFlight = null;
		}
	}

	/** Prune entity state after despawn or removal. */
	removeEntity(guid: number): readonly NameplateHealthUpdate[] {
		const episode = this.#interestByGuid.get(guid);
		if (episode !== undefined) {
			cancelInFlight(episode);
			this.#interestByGuid.delete(guid);
		}
		this.#attackedAtByGuid.delete(guid);
		this.#healthByGuid.delete(guid);
		if (!this.#displayedByGuid.has(guid)) return [];
		this.#displayedByGuid.delete(guid);
		return [{ guid, healthFraction: null }];
	}

	/**
	 * Reconcile desired nameplate health fractions and prioritized background refresh
	 * requests against current visible entities and monotonic time.
	 */
	reconcile(
		candidates: Iterable<NameplateHealthCandidate>,
		localNowMs: number,
	): readonly NameplateHealthUpdate[] {
		const hostNowMs = this.#syncHostTime(localNowMs);
		const activeCombat = isActiveCombatMode(this.#combatMode);
		const present = new Map<number, NameplateHealthCandidate>();
		const eligible = new Map<number, NameplateHealthCandidate>();

		for (const candidate of candidates) {
			present.set(candidate.guid, candidate);
			if (
				activeCombat &&
				candidate.isHostileMob &&
				candidate.distanceMeters !== null &&
				candidate.distanceMeters <= this.#tuning.maxDistanceMeters
			) {
				eligible.set(candidate.guid, candidate);
			}
		}

		// Drop health if an entity stops being a living hostile mob or increments generation.
		for (const [guid, health] of this.#healthByGuid) {
			const candidate = present.get(guid);
			if (candidate === undefined) continue;
			if (
				!candidate.isHostileMob ||
				candidate.generation !== health.instanceSequence
			) {
				this.#healthByGuid.delete(guid);
				this.#attackedAtByGuid.delete(guid);
			}
		}

		if (activeCombat && this.#combatTargetGuid !== null) {
			const combatTarget = eligible.get(this.#combatTargetGuid);
			if (combatTarget !== undefined) {
				this.#touchInterest(
					combatTarget.guid,
					combatTarget.generation,
					hostNowMs + this.#tuning.combatInterestMs,
				);
			}
		}

		for (const [guid, episode] of this.#interestByGuid) {
			const candidate = eligible.get(guid);
			if (
				!activeCombat ||
				candidate === undefined ||
				candidate.generation !== episode.instanceSequence ||
				episode.untilMs <= hostNowMs
			) {
				cancelInFlight(episode);
				this.#interestByGuid.delete(guid);
				this.#attackedAtByGuid.delete(guid);
			}
		}

		const nextDisplayed = new Map<number, number>();
		if (activeCombat) {
			const refreshTargets: {
				readonly guid: number;
				readonly episode: CombatInterestEpisode;
				readonly recentHealth: StoredHealth | undefined;
				readonly priority: FactsAppraisalPriority;
			}[] = [];

			for (const [guid, candidate] of eligible) {
				const health = this.#healthByGuid.get(guid);
				const hasRecentHealth =
					health !== undefined &&
					health.worldGeneration === this.#worldGeneration &&
					health.instanceSequence === candidate.generation &&
					hostNowMs - health.observedAtMs < this.#tuning.recentWindowMs;
				const episode = this.#interestByGuid.get(guid);
				const combatRelevant =
					episode !== undefined || guid === this.#selectedTargetGuid;

				if (combatRelevant && hasRecentHealth) {
					nextDisplayed.set(guid, health.fraction);
				}

				if (episode !== undefined) {
					refreshTargets.push({
						guid,
						episode,
						recentHealth: hasRecentHealth ? health : undefined,
						priority: {
							kind: "combat-health",
							lastAttackedAtMs: this.#attackedAtByGuid.get(guid) ?? null,
							distanceMeters: candidate.distanceMeters,
						},
					});
				}
			}

			refreshTargets.sort((a, b) => {
				const diff = compareFactsPriority(a.priority, b.priority);
				return diff !== 0 ? diff : a.guid - b.guid;
			});

			for (const target of refreshTargets) {
				this.#scheduleRefresh(
					target.guid,
					target.episode,
					target.recentHealth,
					hostNowMs,
					target.priority,
				);
			}
		}

		return this.#commitDisplayed(nextDisplayed);
	}

	/** Cancel any outstanding background appraisals when tearing down presentation. */
	destroy(): readonly NameplateHealthUpdate[] {
		for (const episode of this.#interestByGuid.values()) {
			cancelInFlight(episode);
		}
		this.#interestByGuid.clear();
		this.#attackedAtByGuid.clear();
		this.#healthByGuid.clear();
		return this.#clearAllDisplayed();
	}

	#recordPlayerAttack(targetGuid: number, hostNowMs: number): void {
		const previous = this.#attackedAtByGuid.get(targetGuid);
		this.#attackedAtByGuid.set(
			targetGuid,
			previous === undefined ? hostNowMs : Math.max(previous, hostNowMs),
		);
	}

	#touchInterest(
		guid: number,
		instanceSequence: number,
		untilMs: number,
	): CombatInterestEpisode {
		const existing = this.#interestByGuid.get(guid);
		if (
			existing !== undefined &&
			existing.worldGeneration === this.#worldGeneration &&
			existing.instanceSequence === instanceSequence
		) {
			existing.untilMs = Math.max(existing.untilMs, untilMs);
			return existing;
		}
		if (existing !== undefined) {
			cancelInFlight(existing);
			this.#attackedAtByGuid.delete(guid);
		}
		const created: CombatInterestEpisode = {
			worldGeneration: this.#worldGeneration,
			instanceSequence,
			untilMs,
			bootstrapped: false,
			lastRequestAtMs: null,
			inFlight: null,
		};
		this.#interestByGuid.set(guid, created);
		return created;
	}

	#scheduleRefresh(
		guid: number,
		episode: CombatInterestEpisode,
		recentHealth: StoredHealth | undefined,
		hostNowMs: number,
		priority: FactsAppraisalPriority,
	): void {
		if (guid === this.#selectedTargetGuid) {
			// Selected targets already receive periodic QueryHealth from ClientSelectedEntityTracking.
			cancelInFlight(episode);
			return;
		}
		if (
			episode.inFlight !== null &&
			episode.lastRequestAtMs !== null &&
			hostNowMs - episode.lastRequestAtMs >= this.#tuning.recentWindowMs
		) {
			cancelInFlight(episode);
		}
		if (!episode.bootstrapped) {
			episode.bootstrapped = true;
			if (this.#tuning.bootstrapOnCombatEnter && recentHealth === undefined) {
				this.#issueFactsRequest(guid, episode, hostNowMs, priority);
			}
			return;
		}
		if (episode.inFlight !== null) {
			episode.inFlight.setPriority?.(priority);
			return;
		}
		const lastActivityMs = Math.max(
			recentHealth?.observedAtMs ?? -Infinity,
			episode.lastRequestAtMs ?? -Infinity,
		);
		if (hostNowMs - lastActivityMs >= this.#tuning.refreshIntervalMs) {
			this.#issueFactsRequest(guid, episode, hostNowMs, priority);
		}
	}

	#issueFactsRequest(
		guid: number,
		episode: CombatInterestEpisode,
		hostNowMs: number,
		priority: FactsAppraisalPriority,
	): void {
		cancelInFlight(episode);
		episode.lastRequestAtMs = hostNowMs;
		const request = this.#requestFacts(guid, priority);
		episode.inFlight = request;
		void request.sent.catch(() => {
			if (episode.inFlight === request) {
				episode.inFlight = null;
			}
		});
	}

	#syncHostTime(localNowMs: number, hostSeconds?: number): number {
		if (hostSeconds !== undefined) {
			const hostMs = hostSeconds * 1_000;
			const offset = hostMs - localNowMs;
			if (this.#hostOffsetMs === null || offset > this.#hostOffsetMs) {
				this.#hostOffsetMs = offset;
			}
			this.#lastHostNowMs = Math.max(this.#lastHostNowMs, hostMs);
			return hostMs;
		}
		if (this.#hostOffsetMs === null) {
			this.#lastHostNowMs = Math.max(this.#lastHostNowMs, localNowMs);
			return this.#lastHostNowMs;
		}
		this.#lastHostNowMs = Math.max(
			this.#lastHostNowMs,
			localNowMs + this.#hostOffsetMs,
		);
		return this.#lastHostNowMs;
	}

	#commitDisplayed(
		nextDisplayed: ReadonlyMap<number, number>,
	): readonly NameplateHealthUpdate[] {
		const updates: NameplateHealthUpdate[] = [];
		for (const guid of this.#displayedByGuid.keys()) {
			if (!nextDisplayed.has(guid)) {
				updates.push({ guid, healthFraction: null });
			}
		}
		for (const [guid, fraction] of nextDisplayed) {
			if (this.#displayedByGuid.get(guid) !== fraction) {
				updates.push({ guid, healthFraction: fraction });
			}
		}
		this.#displayedByGuid.clear();
		for (const [guid, fraction] of nextDisplayed) {
			this.#displayedByGuid.set(guid, fraction);
		}
		return updates;
	}

	#clearAllDisplayed(): readonly NameplateHealthUpdate[] {
		if (this.#displayedByGuid.size === 0) return [];
		const updates: NameplateHealthUpdate[] = [];
		for (const guid of this.#displayedByGuid.keys()) {
			updates.push({ guid, healthFraction: null });
		}
		this.#displayedByGuid.clear();
		return updates;
	}
}
