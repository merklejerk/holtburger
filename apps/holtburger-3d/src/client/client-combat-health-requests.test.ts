import { describe, expect, it, vi } from "vitest";
import type {
	AppraisalRequest,
	FactsAppraisalPriority,
} from "./client-appraisal-requests";
import {
	ClientCombatHealthRequests,
	type CombatHealthRequestCandidate,
} from "./client-combat-health-requests";
import type { ClientCombatHealthTuning } from "./client-tuning-contract";

const TEST_TUNING: ClientCombatHealthTuning = {
	maxDistanceMeters: 30,
	combatInterestMs: 12_000,
	recentWindowMs: 10_000,
	refreshIntervalMs: 1_500,
	bootstrapOnCombatEnter: true,
};

function createController() {
	const cancels = new Map<number, ReturnType<typeof vi.fn>>();
	const setPriorities = new Map<number, ReturnType<typeof vi.fn>>();
	const requests: {
		readonly guid: number;
		readonly priority: FactsAppraisalPriority;
		rejectSent?: (reason?: unknown) => void;
	}[] = [];
	const coordinator = new ClientCombatHealthRequests({
		tuning: TEST_TUNING,
		requestFacts(guid, priority): AppraisalRequest {
			const cancel = vi.fn();
			const setPriority = vi.fn();
			cancels.set(guid, cancel);
			setPriorities.set(guid, setPriority);
			let rejectSent!: (reason?: unknown) => void;
			const sent = new Promise<void>((_resolve, reject) => {
				rejectSent = reject;
			});
			void sent.catch(() => undefined);
			requests.push({ guid, priority, rejectSent });
			return {
				sent,
				cancel,
				setPriority,
			};
		},
	});
	return { coordinator, requests, cancels, setPriorities };
}

function mob(
	guid: number,
	distanceMeters = TEST_TUNING.maxDistanceMeters / 2,
	generation = 1,
	freshObservedAtMs: number | null = null,
): CombatHealthRequestCandidate {
	return {
		guid,
		generation,
		isHostileMob: true,
		distanceMeters,
		freshObservedAtMs,
	};
}

describe("ClientCombatHealthRequests", () => {
	it("suppresses background demand outside combat mode and cancels active episodes on peace", () => {
		const { coordinator, requests, cancels } = createController();
		coordinator.resetWorld(1);
		const hostNowMs = 5_000;

		coordinator.setCombatMode("peace");
		expect(coordinator.isIdle()).toBe(true);
		coordinator.acceptCombatObserved({
			guid: 10,
			worldGeneration: 1,
			instanceSequence: 1,
			observedAt: { seconds: hostNowMs / 1_000 },
		});
		coordinator.reconcile([mob(10)], hostNowMs);
		expect(requests).toEqual([]);

		coordinator.setCombatMode("melee");
		expect(coordinator.isIdle()).toBe(false);
		coordinator.acceptCombatObserved({
			guid: 10,
			worldGeneration: 1,
			instanceSequence: 1,
			observedAt: { seconds: hostNowMs / 1_000 },
		});
		coordinator.reconcile([mob(10)], hostNowMs);
		expect(requests.map((r) => r.guid)).toEqual([10]);

		coordinator.setCombatMode("peace");
		expect(cancels.get(10)).toHaveBeenCalledTimes(1);
		expect(coordinator.isIdle()).toBe(true);
		coordinator.destroy();
	});

	it("bootstraps when fresh health is absent, refreshes at cadence, and skips selected target duplication", () => {
		const { coordinator, requests, cancels } = createController();
		coordinator.resetWorld(2);
		coordinator.setCombatMode("magic");

		let hostNowMs = 10_000;
		const mobA = mob(20);
		const mobSelected = mob(21);
		coordinator.setSelectedTarget(21);

		coordinator.acceptCombatObserved({
			guid: 20,
			worldGeneration: 2,
			instanceSequence: 1,
			observedAt: { seconds: hostNowMs / 1_000 },
		});
		coordinator.acceptCombatObserved({
			guid: 21,
			worldGeneration: 2,
			instanceSequence: 1,
			observedAt: { seconds: hostNowMs / 1_000 },
		});

		coordinator.reconcile([mobA, mobSelected], hostNowMs);
		expect(requests.map((r) => r.guid)).toEqual([20]);

		// Authoritative health settles the inflight request and counts toward refresh cooldown.
		coordinator.acceptEntityHealth({
			guid: 20,
			worldGeneration: 2,
			instanceSequence: 1,
			healthFraction: 0.8,
			observedAt: { seconds: hostNowMs / 1_000 },
		});
		hostNowMs += TEST_TUNING.refreshIntervalMs - 1;
		coordinator.reconcile(
			[mob(20, TEST_TUNING.maxDistanceMeters / 2, 1, 10_000), mobSelected],
			hostNowMs,
		);
		expect(requests.map((r) => r.guid)).toEqual([20]);

		hostNowMs += 1;
		coordinator.reconcile(
			[mob(20, TEST_TUNING.maxDistanceMeters / 2, 1, 10_000), mobSelected],
			hostNowMs,
		);
		expect(requests.map((r) => r.guid)).toEqual([20, 20]);

		// Selecting mob 20 cancels its background combat request immediately.
		coordinator.setSelectedTarget(20);
		coordinator.reconcile([mob(20), mobSelected], hostNowMs);
		expect(cancels.get(20)).toHaveBeenCalledTimes(1);
		coordinator.destroy();
	});

	it("skips bootstrap when already fresh, orders recently attacked first, and drops non-hostile/out-of-range targets", () => {
		const { coordinator, requests, cancels } = createController();
		coordinator.resetWorld(3);
		coordinator.setCombatMode("melee");

		const hostNowMs = 20_000;
		const farAttacked = mob(30, TEST_TUNING.maxDistanceMeters - 1, 1, null);
		const nearbyOther = mob(31, 3, 1, null);
		const alreadyFresh = mob(32, 4, 1, hostNowMs - 100);
		const nonHostile: CombatHealthRequestCandidate = {
			guid: 33,
			generation: 1,
			isHostileMob: false,
			distanceMeters: 2,
			freshObservedAtMs: null,
		};
		const tooFar = mob(34, TEST_TUNING.maxDistanceMeters + 1, 1, null);

		coordinator.acceptCombatObserved({
			guid: 30,
			worldGeneration: 3,
			instanceSequence: 1,
			observedAt: { seconds: hostNowMs / 1_000 },
		});
		coordinator.acceptCombatObserved({
			guid: 31,
			worldGeneration: 3,
			instanceSequence: 1,
			observedAt: { seconds: hostNowMs / 1_000 },
		});
		coordinator.acceptCombatObserved({
			guid: 32,
			worldGeneration: 3,
			instanceSequence: 1,
			observedAt: { seconds: hostNowMs / 1_000 },
		});
		coordinator.acceptPlayerAttack(30, hostNowMs);

		coordinator.reconcile(
			[nearbyOther, farAttacked, alreadyFresh, nonHostile, tooFar],
			hostNowMs,
		);
		expect(requests.map((r) => r.guid)).toEqual([30, 31]);

		// Generation increment cancels old episode.
		coordinator.reconcile([mob(30, 5, 2), mob(31, 3, 1)], hostNowMs + 100);
		expect(cancels.get(30)).toHaveBeenCalledTimes(1);
		coordinator.destroy();
	});
});
