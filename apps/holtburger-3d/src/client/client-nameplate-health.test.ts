import { describe, expect, it, vi } from "vitest";
import type {
	AppraisalRequest,
	FactsAppraisalPriority,
} from "./client-appraisal-requests";
import {
	ClientNameplateHealth,
	type NameplateHealthCandidate,
} from "./client-nameplate-health";
import type { ClientNameplateHealthTuning } from "./client-tuning-contract";

const TUNING: ClientNameplateHealthTuning = {
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
	}[] = [];
	const policy = new ClientNameplateHealth({
		tuning: TUNING,
		requestFacts(guid, priority): AppraisalRequest {
			requests.push({ guid, priority });
			const cancel = vi.fn();
			const setPriority = vi.fn();
			cancels.set(guid, cancel);
			setPriorities.set(guid, setPriority);
			return {
				sent: Promise.resolve(),
				cancel,
				setPriority,
			};
		},
	});
	return { policy, requests, cancels, setPriorities };
}

function mob(
	guid: number,
	distanceMeters = TUNING.maxDistanceMeters / 2,
	generation = 1,
): NameplateHealthCandidate {
	return {
		guid,
		generation,
		isHostileMob: true,
		distanceMeters,
	};
}

describe("ClientNameplateHealth", () => {
	it("shows bars only in combat mode, for hostile mobs within distance and recent window", () => {
		const { policy, requests } = createController();
		policy.resetWorld(1);
		let nowMs = 1_000;

		const nonCombatMob = mob(10);
		const farMob = mob(11, TUNING.maxDistanceMeters + 1);
		const friendlyNpc: NameplateHealthCandidate = {
			guid: 12,
			generation: 1,
			isHostileMob: false,
			distanceMeters: TUNING.maxDistanceMeters / 2,
		};

		// Peace mode ignores combat interest and hides all bars.
		policy.setCombatMode("peace");
		policy.acceptCombatObserved(
			{
				guid: 10,
				worldGeneration: 1,
				instanceSequence: 1,
				observedAt: { seconds: nowMs / 1_000 },
			},
			nowMs,
		);
		policy.acceptEntityHealth(
			{
				guid: 10,
				worldGeneration: 1,
				instanceSequence: 1,
				healthFraction: 0.75,
				observedAt: { seconds: nowMs / 1_000 },
			},
			nowMs,
		);
		expect(
			policy.reconcile([nonCombatMob, farMob, friendlyNpc], nowMs),
		).toEqual([]);
		expect(requests).toEqual([]);

		// Enter melee mode and observe combat on 10, 11 (too far), and 12 (non-mob).
		policy.setCombatMode("melee");
		for (const guid of [10, 11, 12]) {
			policy.acceptCombatObserved(
				{
					guid,
					worldGeneration: 1,
					instanceSequence: 1,
					observedAt: { seconds: nowMs / 1_000 },
				},
				nowMs,
			);
			policy.acceptEntityHealth(
				{
					guid,
					worldGeneration: 1,
					instanceSequence: 1,
					healthFraction: 0.5,
					observedAt: { seconds: nowMs / 1_000 },
				},
				nowMs,
			);
		}
		expect(
			policy.reconcile([nonCombatMob, farMob, friendlyNpc], nowMs),
		).toEqual([{ guid: 10, healthFraction: 0.5 }]);

		// Expire health recency window cleanly when no newer health arrives.
		nowMs += TUNING.recentWindowMs;
		expect(policy.reconcile([nonCombatMob], nowMs)).toEqual([
			{ guid: 10, healthFraction: null },
		]);
		policy.destroy();
	});

	it("issues one bootstrap request per combat interest episode, refreshes at interval, and avoids duplicating selected QueryHealth", () => {
		const { policy, requests, cancels } = createController();
		policy.resetWorld(2);
		policy.setCombatMode("magic");

		let nowMs = 5_000;
		const mobA = mob(20);
		const selectedMob = mob(21);
		policy.setSelectedTarget(21);

		// Combat observed on unselected mobA -> 1 immediate bootstrap facts request.
		policy.acceptCombatObserved(
			{
				guid: 20,
				worldGeneration: 2,
				instanceSequence: 1,
				observedAt: { seconds: nowMs / 1_000 },
			},
			nowMs,
		);
		// Combat observed on selectedMob -> handled by SelectedEntityTracking QueryHealth, no background facts request.
		policy.acceptCombatObserved(
			{
				guid: 21,
				worldGeneration: 2,
				instanceSequence: 1,
				observedAt: { seconds: nowMs / 1_000 },
			},
			nowMs,
		);

		expect(policy.reconcile([mobA, selectedMob], nowMs)).toEqual([]);
		expect(requests.map((r) => r.guid)).toEqual([20]);

		// Re-observing combat before refreshIntervalMs does not spam extra requests.
		nowMs += Math.floor(TUNING.refreshIntervalMs / 2);
		policy.acceptCombatObserved(
			{
				guid: 20,
				worldGeneration: 2,
				instanceSequence: 1,
				observedAt: { seconds: nowMs / 1_000 },
			},
			nowMs,
		);
		expect(policy.reconcile([mobA, selectedMob], nowMs)).toEqual([]);
		expect(requests.map((r) => r.guid)).toEqual([20]);

		// Health arrives for both mobs -> both display immediately.
		policy.acceptEntityHealth(
			{
				guid: 20,
				worldGeneration: 2,
				instanceSequence: 1,
				healthFraction: 0.8,
				observedAt: { seconds: nowMs / 1_000 },
			},
			nowMs,
		);
		policy.acceptEntityHealth(
			{
				guid: 21,
				worldGeneration: 2,
				instanceSequence: 1,
				healthFraction: 0.6,
				observedAt: { seconds: nowMs / 1_000 },
			},
			nowMs,
		);
		expect(policy.reconcile([mobA, selectedMob], nowMs)).toEqual([
			{ guid: 20, healthFraction: 0.8 },
			{ guid: 21, healthFraction: 0.6 },
		]);

		// Advancing refreshIntervalMs schedules 1 background refresh for unselected mobA only.
		nowMs += TUNING.refreshIntervalMs;
		policy.reconcile([mobA, selectedMob], nowMs);
		expect(requests.map((r) => r.guid)).toEqual([20, 20]);

		// Leaving combat mode cancels outstanding requests and withdraws bars immediately.
		policy.setCombatMode("peace");
		expect(policy.reconcile([mobA, selectedMob], nowMs)).toEqual([
			{ guid: 20, healthFraction: null },
			{ guid: 21, healthFraction: null },
		]);
		expect(cancels.get(20)).toHaveBeenCalledTimes(1);
		policy.destroy();
	});

	it("drops health and ignores stale out-of-order samples across incarnation or world resets", () => {
		const { policy } = createController();
		policy.resetWorld(3);
		policy.setCombatMode("missile");
		const nowMs = 10_000;

		policy.setCombatTarget(30);
		policy.acceptEntityHealth(
			{
				guid: 30,
				worldGeneration: 3,
				instanceSequence: 1,
				healthFraction: 0.4,
				observedAt: { seconds: 10 },
			},
			nowMs,
		);
		// Older out-of-order timestamp must not overwrite 0.4 with 0.9.
		policy.acceptEntityHealth(
			{
				guid: 30,
				worldGeneration: 3,
				instanceSequence: 1,
				healthFraction: 0.9,
				observedAt: { seconds: 9 },
			},
			nowMs,
		);
		expect(policy.reconcile([mob(30, 10, 1)], nowMs)).toEqual([
			{ guid: 30, healthFraction: 0.4 },
		]);

		// Incarnation increment clears stale generation-1 health immediately.
		expect(policy.reconcile([mob(30, 10, 2)], nowMs)).toEqual([
			{ guid: 30, healthFraction: null },
		]);
		policy.destroy();
	});

	it("prioritizes player-attacked mobs by attack recency then proximity, ignoring remote swing recency", () => {
		const { policy, requests, setPriorities } = createController();
		policy.resetWorld(4);
		policy.setCombatMode("melee");

		let nowMs = 1_000;
		// Mobs 41 (far, older player attack), 42 (mid, newest player attack),
		// 43 (very close, only remote swing), 44 (far, only remote swing).
		for (const guid of [44, 41, 43, 42]) {
			policy.acceptCombatObserved(
				{
					guid,
					worldGeneration: 4,
					instanceSequence: 1,
					observedAt: { seconds: nowMs / 1_000 },
				},
				nowMs,
			);
		}
		policy.acceptPlayerAttack(41, 1_100);
		policy.acceptPlayerAttack(42, 1_300);
		// Later remote swing on 44 must not make 44 appear attacked by the player.
		policy.acceptCombatObserved(
			{
				guid: 44,
				worldGeneration: 4,
				instanceSequence: 1,
				observedAt: { seconds: 1.5 },
			},
			1_500,
		);
		nowMs = 1_500;

		policy.reconcile(
			[mob(44, 25), mob(41, 20), mob(43, 3), mob(42, 15)],
			nowMs,
		);

		expect(requests).toEqual([
			{
				guid: 42,
				priority: {
					kind: "combat-health",
					lastAttackedAtMs: 1_300,
					distanceMeters: 15,
				},
			},
			{
				guid: 41,
				priority: {
					kind: "combat-health",
					lastAttackedAtMs: 1_100,
					distanceMeters: 20,
				},
			},
			{
				guid: 43,
				priority: {
					kind: "combat-health",
					lastAttackedAtMs: null,
					distanceMeters: 3,
				},
			},
			{
				guid: 44,
				priority: {
					kind: "combat-health",
					lastAttackedAtMs: null,
					distanceMeters: 25,
				},
			},
		]);

		// Switching desired combat target promotes 43 and updates its in-flight priority on reconcile.
		nowMs = 1_600;
		policy.setCombatTarget(43, nowMs);
		policy.reconcile(
			[mob(44, 25), mob(41, 20), mob(43, 2), mob(42, 15)],
			nowMs,
		);
		expect(setPriorities.get(43)).toHaveBeenCalledWith({
			kind: "combat-health",
			lastAttackedAtMs: 1_600,
			distanceMeters: 2,
		});

		// Settling an unanswered background request clears inFlight so periodic refresh can retry.
		policy.acceptAppraisalFactsSettled(43);
		nowMs += TUNING.refreshIntervalMs;
		policy.reconcile([mob(43, 2)], nowMs);
		expect(requests.at(-1)?.guid).toBe(43);

		policy.destroy();
	});
});
