import {
	compareFactsPriority,
	type AppraisalRequest,
	type FactsAppraisalPriority,
} from "../inventory/appraisal-requests";
import type {
	ClientCombatMode,
	ClientEntityCombatObserved,
} from "../session/host-contract";
import type { ClientCombatHealthTuning } from "../settings/tuning-contract";

/** Inputs needed to manage combat-interest episodes and background facts requests. */
export interface CombatHealthRequestCandidate {
	readonly guid: number;
	readonly generation: number;
	readonly isHostileMob: boolean;
	readonly distanceMeters: number | null;
	/** Authoritative fresh health timestamp in host ms when currently fresh, else null. */
	readonly freshObservedAtMs: number | null;
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

function cancelInFlight(episode: CombatInterestEpisode): void {
	const request = episode.inFlight;
	if (request === null) return;
	episode.inFlight = null;
	request.cancel();
}

/**
 * Coordinates combat-relevant background `FactsOnly` refresh scheduling for hostile monsters
 * (prioritizing recently attacked targets, then proximity) while deduplicating selected targets.
 */
export class ClientCombatHealthRequests {
	readonly #tuning: ClientCombatHealthTuning;
	readonly #requestFacts: (
		guid: number,
		priority: FactsAppraisalPriority,
	) => AppraisalRequest;

	#worldGeneration = 0;
	#combatMode: ClientCombatMode = "unknown";
	#combatTargetGuid: number | null = null;
	#selectedTargetGuid: number | null = null;

	readonly #interestByGuid = new Map<number, CombatInterestEpisode>();
	readonly #attackedAtByGuid = new Map<number, number>();
	readonly #eligible = new Map<number, CombatHealthRequestCandidate>();

	constructor(options: {
		readonly tuning: ClientCombatHealthTuning;
		readonly requestFacts: (
			guid: number,
			priority: FactsAppraisalPriority,
		) => AppraisalRequest;
	}) {
		this.#tuning = options.tuning;
		this.#requestFacts = options.requestFacts;
	}

	/** Active world generation currently accepted by combat health request tracking. */
	worldGeneration(): number {
		return this.#worldGeneration;
	}

	/** True when neither active combat nor retained episodes require reconciliation. */
	isIdle(): boolean {
		return (
			!isActiveCombatMode(this.#combatMode) && this.#interestByGuid.size === 0
		);
	}

	/** Cancel all in-flight requests and clear retained combat episodes across world changes. */
	resetWorld(worldGeneration: number): void {
		this.#worldGeneration = worldGeneration;
		this.#combatTargetGuid = null;
		this.#clearInterestState();
	}

	/** Update active player stance; leaving combat immediately cancels background requests. */
	setCombatMode(mode: ClientCombatMode): void {
		if (this.#combatMode === mode) return;
		this.#combatMode = mode;
		if (!isActiveCombatMode(mode)) {
			this.#clearInterestState();
		}
	}

	/** Update the player's current desired combat target, recording target switches as player attacks. */
	setCombatTarget(targetGuid: number | null, hostNowMs: number | null): void {
		const previous = this.#combatTargetGuid;
		this.#combatTargetGuid = targetGuid;
		if (
			targetGuid !== null &&
			targetGuid !== previous &&
			hostNowMs !== null &&
			isActiveCombatMode(this.#combatMode)
		) {
			this.#recordPlayerAttack(targetGuid, hostNowMs);
		}
	}

	/** Track selected identity so combat health requests do not duplicate selected QueryHealth. */
	setSelectedTarget(targetGuid: number | null): void {
		this.#selectedTargetGuid = targetGuid;
	}

	/** Record a player-initiated attack or attributed offensive outcome against `targetGuid`. */
	acceptPlayerAttack(targetGuid: number, hostNowMs: number | null): void {
		if (hostNowMs === null || !isActiveCombatMode(this.#combatMode)) return;
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
	acceptCombatObserved(event: ClientEntityCombatObserved): void {
		if (event.worldGeneration !== this.#worldGeneration) return;
		if (!isActiveCombatMode(this.#combatMode)) return;
		const observedAtMs = event.observedAt.seconds * 1_000;
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
	removeEntity(guid: number): void {
		const episode = this.#interestByGuid.get(guid);
		if (episode !== undefined) {
			cancelInFlight(episode);
			this.#interestByGuid.delete(guid);
		}
		this.#attackedAtByGuid.delete(guid);
	}

	/**
	 * Reconcile active combat interest episodes and schedule prioritized background refresh
	 * requests against visible candidates and the authoritative host clock.
	 */
	reconcile(
		candidates: Iterable<CombatHealthRequestCandidate>,
		hostNowMs: number | null,
	): void {
		if (hostNowMs === null) return;
		const activeCombat = isActiveCombatMode(this.#combatMode);
		const eligible = this.#eligible;
		eligible.clear();

		for (const candidate of candidates) {
			if (!candidate.isHostileMob) {
				// Drop attack recency immediately if a tracked entity stops being a living hostile mob.
				this.#attackedAtByGuid.delete(candidate.guid);
				continue;
			}
			if (
				activeCombat &&
				candidate.distanceMeters !== null &&
				candidate.distanceMeters <= this.#tuning.maxDistanceMeters
			) {
				eligible.set(candidate.guid, candidate);
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

		if (!activeCombat) {
			eligible.clear();
			return;
		}

		const refreshTargets: {
			readonly guid: number;
			readonly episode: CombatInterestEpisode;
			readonly freshObservedAtMs: number | null;
			readonly priority: FactsAppraisalPriority;
		}[] = [];

		for (const [guid, candidate] of eligible) {
			const episode = this.#interestByGuid.get(guid);
			if (episode === undefined) continue;
			refreshTargets.push({
				guid,
				episode,
				freshObservedAtMs: candidate.freshObservedAtMs,
				priority: {
					kind: "combat-health",
					lastAttackedAtMs: this.#attackedAtByGuid.get(guid) ?? null,
					distanceMeters: candidate.distanceMeters,
				},
			});
		}
		eligible.clear();

		refreshTargets.sort((a, b) => {
			const diff = compareFactsPriority(a.priority, b.priority);
			return diff !== 0 ? diff : a.guid - b.guid;
		});

		for (const target of refreshTargets) {
			this.#scheduleRefresh(
				target.guid,
				target.episode,
				target.freshObservedAtMs,
				hostNowMs,
				target.priority,
			);
		}
	}

	/** Cancel any outstanding background appraisals when tearing down presentation. */
	destroy(): void {
		this.#clearInterestState();
	}

	#clearInterestState(): void {
		for (const episode of this.#interestByGuid.values()) {
			cancelInFlight(episode);
		}
		this.#interestByGuid.clear();
		this.#attackedAtByGuid.clear();
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
		freshObservedAtMs: number | null,
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
			freshObservedAtMs !== null &&
			episode.lastRequestAtMs !== null &&
			freshObservedAtMs >= episode.lastRequestAtMs
		) {
			episode.inFlight.settle?.();
			episode.inFlight = null;
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
			if (this.#tuning.bootstrapOnCombatEnter && freshObservedAtMs === null) {
				this.#issueFactsRequest(guid, episode, hostNowMs, priority);
			}
			return;
		}
		if (episode.inFlight !== null) {
			episode.inFlight.setPriority?.(priority);
			return;
		}
		const lastActivityMs = Math.max(
			freshObservedAtMs ?? -Infinity,
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
}
