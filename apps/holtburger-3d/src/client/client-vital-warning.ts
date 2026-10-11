import type { ClientVital } from "./client-host-contract";
import type { ClientVitalWarningThresholds } from "./client-settings-contract";
import {
	CLIENT_VITAL_WARNING_KINDS,
	CLIENT_VITAL_WARNING_RECOVERY_MARGIN_PERCENT,
} from "./client-settings-values";

/** Client-owned arbitration; appearance belongs to the CSS theme. */
export interface ClientVitalWarningTuning {
	/** Fractional lead required for another resource to replace the current winner. */
	readonly selectionMargin: number;
}

/** Single frontend activation decision shared by the vignette and veins. */
export interface ClientVitalWarning {
	/** Vital whose existing HUD theme color identifies both vignette and veins. */
	readonly kind: ClientVital["kind"];
}

/** Retains per-vital hysteresis and resource arbitration only between UI updates. */
export class ClientVitalWarningPolicy {
	private readonly critical = new Set<ClientVital["kind"]>();
	private selected: ClientVital["kind"] | null = null;
	/** Previous thresholds invalidate only the vital whose activation band changed. */
	private thresholds: ClientVitalWarningThresholds | null = null;

	constructor(private readonly tuning: ClientVitalWarningTuning) {}

	/** Inactive lifecycle phases discard hysteresis as well as presentation. */
	update(
		vitals: readonly ClientVital[],
		enabled: boolean,
		thresholds: ClientVitalWarningThresholds,
	): ClientVitalWarning | null {
		const previous = this.thresholds;
		this.thresholds = thresholds;
		if (!enabled) {
			this.critical.clear();
			this.selected = null;
			return null;
		}
		const fractions = new Map<ClientVital["kind"], number>();
		for (const { kind } of CLIENT_VITAL_WARNING_KINDS) {
			if (previous !== null && previous[kind] !== thresholds[kind])
				this.critical.delete(kind);
			const activateFraction = thresholds[kind] / 100;
			const clearFraction =
				(thresholds[kind] + CLIENT_VITAL_WARNING_RECOVERY_MARGIN_PERCENT) / 100;
			const vital = vitals.find((value) => value.kind === kind);
			if (vital === undefined || vital.maximum === 0) {
				this.critical.delete(kind);
				continue;
			}
			const fraction = Math.min(1, vital.current / vital.maximum);
			if (fraction <= activateFraction) this.critical.add(kind);
			else if (fraction >= clearFraction) this.critical.delete(kind);
			if (this.critical.has(kind)) fractions.set(kind, fraction);
		}

		// Iteration order gives health priority and stamina the initial resource tie.
		let winner: { kind: ClientVital["kind"]; fraction: number } | null = null;
		for (const [kind, fraction] of fractions) {
			if (winner?.kind === "health") break;
			if (winner === null || fraction < winner.fraction)
				winner = { kind, fraction };
		}
		if (winner !== null && winner.kind !== "health" && this.selected !== null) {
			const retained = fractions.get(this.selected);
			// Retain a resource on near ties; health takes over immediately regardless of margin.
			if (
				retained !== undefined &&
				retained - winner.fraction <= this.tuning.selectionMargin
			)
				winner = { kind: this.selected, fraction: retained };
		}
		this.selected = winner?.kind ?? null;
		if (winner === null) return null;
		return {
			kind: winner.kind,
		};
	}
}
