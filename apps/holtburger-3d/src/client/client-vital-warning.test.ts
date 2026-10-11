import { describe, expect, it } from "vitest";
import {
	ClientVitalWarningPolicy,
	type ClientVitalWarningTuning,
} from "./client-vital-warning";
import type { ClientVital } from "./client-host-contract";
import { CLIENT_VITAL_WARNING_RECOVERY_MARGIN_PERCENT } from "./client-settings-values";

const tuning: ClientVitalWarningTuning = {
	selectionMargin: 0.03,
};
const thresholdPercent = 20;
const thresholds = {
	health: thresholdPercent,
	stamina: thresholdPercent,
	mana: thresholdPercent,
};
const recoveryPercent =
	thresholdPercent + CLIENT_VITAL_WARNING_RECOVERY_MARGIN_PERCENT;
const vital = (kind: ClientVital["kind"], percent: number): ClientVital => ({
	kind,
	current: percent,
	maximum: 100,
});

describe("critical-vital presentation policy", () => {
	it.each(["health", "stamina", "mana"] as const)(
		"activates %s at its threshold and retains it until recovery",
		(kind) => {
			const policy = new ClientVitalWarningPolicy(tuning);
			const update = (percent: number) =>
				policy.update([vital(kind, percent)], true, thresholds);
			expect(update(thresholdPercent + 1)).toBeNull();
			const full = { kind };
			expect(update(thresholdPercent)).toEqual(full);
			expect(update(thresholdPercent / 2)).toEqual(full);
			expect(update(0)).toEqual(full);
			expect(update(recoveryPercent - 1)).toEqual(full);
			expect(update(recoveryPercent)).toBeNull();
		},
	);
	it("keeps health ahead of more depleted resources, including zero health", () => {
		const policy = new ClientVitalWarningPolicy(tuning);
		expect(policy.update([vital("mana", 0)], true, thresholds)?.kind).toBe(
			"mana",
		);
		expect(
			policy.update(
				[vital("health", thresholdPercent), vital("mana", 0)],
				true,
				thresholds,
			)?.kind,
		).toBe("health");
		expect(policy.update([vital("health", 0)], true, thresholds)?.kind).toBe(
			"health",
		);
	});
	it("chooses the lower resource, gives stamina initial ties, and retains near ties", () => {
		const policy = new ClientVitalWarningPolicy(tuning);
		const update = (stamina: number, mana: number) =>
			policy.update(
				[vital("mana", mana), vital("stamina", stamina)],
				true,
				thresholds,
			);
		expect(update(15, 15)?.kind).toBe("stamina");
		expect(update(15, 13)?.kind).toBe("stamina");
		expect(update(15, 10)?.kind).toBe("mana");
		expect(update(10, 10)?.kind).toBe("mana");
		expect(update(10, recoveryPercent)?.kind).toBe("stamina");
	});
	it("tracks recovery for resources hidden by health priority", () => {
		const policy = new ClientVitalWarningPolicy(tuning);
		policy.update([vital("health", 10), vital("mana", 10)], true, thresholds);
		expect(
			policy.update(
				[vital("health", recoveryPercent), vital("mana", recoveryPercent - 1)],
				true,
				thresholds,
			)?.kind,
		).toBe("mana");
	});
	it("discards missing and zero-maximum vitals without treating them as depleted", () => {
		const policy = new ClientVitalWarningPolicy(tuning);
		policy.update([vital("health", 10)], true, thresholds);
		expect(
			policy.update(
				[{ kind: "health", current: 0, maximum: 0 }],
				true,
				thresholds,
			),
		).toBeNull();
		expect(
			policy.update([vital("health", recoveryPercent - 1)], true, thresholds),
		).toBeNull();
		policy.update([vital("mana", 10)], true, thresholds);
		expect(policy.update([], true, thresholds)).toBeNull();
	});
	it("resets retained state when gameplay is suppressed", () => {
		const policy = new ClientVitalWarningPolicy(tuning);
		policy.update([vital("health", 10), vital("mana", 10)], true, thresholds);
		expect(policy.update([vital("health", 10)], false, thresholds)).toBeNull();
		expect(
			policy.update(
				[
					vital("health", recoveryPercent - 1),
					vital("mana", recoveryPercent - 1),
				],
				true,
				thresholds,
			),
		).toBeNull();
	});
	it("applies independent edits immediately while preserving another vital's recovery state", () => {
		const policy = new ClientVitalWarningPolicy(tuning);
		const values = [vital("health", 35), vital("mana", 35)];
		expect(policy.update(values, true, thresholds)).toBeNull();
		const customized = { ...thresholds, mana: 40 };
		expect(policy.update(values, true, customized)?.kind).toBe("mana");
		expect(policy.update(values, true, thresholds)).toBeNull();
		policy.update([vital("health", 10)], true, thresholds);
		expect(
			policy.update([vital("health", recoveryPercent - 1)], true, customized)
				?.kind,
		).toBe("health");
	});
});
